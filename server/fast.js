// Fast AI lane: Groq (free tier, key from console.groq.com/keys). Grades come back in about a second,
// so every candidate coin can be rated. Each Groq model has its own free quota, so when one model
// is rate limited we move to the next and come back after its cooldown.
// Gemini (settings.geminiKey, free tier from aistudio.google.com) answers the same calls through Google's
// OpenAI-compatible endpoint when there is no Groq key or every Groq model is cooling: same request shape, its
// own models and cooldowns, and at most settings.geminiPerDay calls a day so the free quota is never run dry.
import { settings } from "./settings.js";
import * as health from "./health.js";

const URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
// Checked 2026-10-08: 3.5-flash answers in ~1.5 s; the older 2.x names are retired for new keys.
// Each model has its own free quota on the key, so more of them is more reads a day: when the newest are spent
// (429), the older Flash models still answer (2026-10-09: 3.5/3.8 spent by evening, 3-flash-preview and 3.1-flash-lite
// fine). A retired model answers 404 and rests for a day on its own.
export const GEMINI_MODELS = ["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3-flash-preview", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const isGemini = (m) => m.startsWith("gemini-");
const gday = { day: "", calls: 0 };
const geminiLeft = () => { const d = new Date().toISOString().slice(0, 10); if (gday.day !== d) { gday.day = d; gday.calls = 0; } return (settings.geminiPerDay ?? 1000) - gday.calls; };
export const FAST_MODELS = ["openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];

const cooldown = new Map();          // model -> until (ms)
const plain = new Set();             // models that rejected the extra options; call them without
const usage = { calls: 0, errors: 0, tokens: 0, lastMs: null, avgMs: null, lastModel: null, lastError: null, limits: {} };

export const groqKeyReady = () => Boolean(settings.groqKey);
// Ready while a key is saved, the day's call budget lasts and at least one Gemini model is not cooling off after a
// refusal (its free quota answers 429): the status lines then stop naming Gemini as the lane that is reading.
export const geminiReady = () => Boolean(settings.geminiKey) && geminiLeft() > 0 && GEMINI_MODELS.some((m) => !(cooldown.get(m) > Date.now()));
export const fastReady = () => groqKeyReady() || geminiReady();
// Which provider the lane is on right now, for the status lines: Groq while it has a key and a model free.
export const fastProviderNow = () => (groqKeyReady() && order().length ? "groq" : geminiReady() ? "gemini" : groqKeyReady() ? "groq" : null);
export const fastStatus = () => ({
  ready: fastReady(), provider: fastProviderNow(), gemini: { ready: geminiReady(), usedToday: gday.calls, perDay: settings.geminiPerDay ?? 1000 }, ...usage,
  cooling: [...cooldown].filter(([, u]) => u > Date.now()).map(([m, u]) => ({ model: m, secs: Math.ceil((u - Date.now()) / 1000) })),
});

function order() {
  const first = settings.fastModel && FAST_MODELS.includes(settings.fastModel) ? [settings.fastModel] : [];
  return [...new Set([...first, ...FAST_MODELS])].filter((m) => !(cooldown.get(m) > Date.now()));
}

const secs = (v) => {
  // Groq sends "7.66s", "2m59.5s", or plain seconds
  if (!v) return null;
  const m = String(v).match(/(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?$/);
  if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return Number(v) || null;
};

// `json`: ask for a JSON object (every read does); false for prose (the market brief).
async function call(model, system, prompt, maxTokens, key, json = true) {
  const body = {
    model, temperature: 0.3, max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
  };
  if (!plain.has(model)) {
    if (json) body.response_format = { type: "json_object" };
    if (model.startsWith("openai/gpt-oss")) { body.reasoning_effort = "low"; body.include_reasoning = false; }
  }
  if (isGemini(model)) { delete body.temperature; body.temperature = 0.3; gday.calls++; }
  const t0 = Date.now();
  const r = await fetch(isGemini(model) ? GEMINI_URL : URL, {
    method: "POST", signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const res = await r.json().catch(() => ({}));
  usage.limits[model] = {
    requestsLeft: r.headers.get("x-ratelimit-remaining-requests"), tokensLeft: r.headers.get("x-ratelimit-remaining-tokens"),
  };
  if (r.status === 429 || r.status === 413 || r.status === 503) {
    const wait = secs(r.headers.get("retry-after")) ?? secs(r.headers.get("x-ratelimit-reset-tokens")) ?? 60;
    cooldown.set(model, Date.now() + Math.min(wait, 6 * 3600) * 1000 + 1000);
    const e = new Error(`${model} busy (${r.status}), cooling ${Math.round(wait)}s`); e.next = true; throw e;
  }
  if (r.status === 400 && !plain.has(model) && /response_format|reasoning|json/i.test(JSON.stringify(res))) {
    plain.add(model);
    return call(model, system, prompt, maxTokens, key, json);
  }
  if (r.status === 404 || (r.status === 400 && /model/i.test(res?.error?.message || ""))) {
    cooldown.set(model, Date.now() + 24 * 3600_000);   // model retired or not on this account
    const e = new Error(`${model} unavailable`); e.next = true; throw e;
  }
  const who = isGemini(model) ? "Gemini" : "Groq";
  if (r.status === 401 || r.status === 403) { const e = new Error(`${who} key was rejected. Check it in Settings.`); e.next = isGemini(model) ? false : r.status === 403; throw e; }
  if (!r.ok) { const e = new Error(res?.error?.message || `${who} ${r.status}`); e.next = r.status >= 500; throw e; }
  const text = res.choices?.[0]?.message?.content?.trim() || "";
  usage.calls++; usage.tokens += res.usage?.total_tokens || 0;
  usage.lastMs = ms; usage.avgMs = usage.avgMs == null ? ms : Math.round(usage.avgMs * 0.8 + ms * 0.2); usage.lastModel = model;
  return { text, model, ms };
}

export async function askFast(system, prompt, maxTokens = 900, { models, key = settings.groqKey, gemini = true, json = true } = {}) {
  let last;
  if (key) {
    const list = models ? [...new Set([...models, ...order()])].filter((m) => !(cooldown.get(m) > Date.now())) : order();
    for (const model of list) {
      try { const r = await call(model, system, prompt, maxTokens, key, json); health.ok("groq"); return r; }
      catch (e) { last = e; usage.errors++; usage.lastError = e.message; health.fail("groq", e); if (!e.next) break; }
    }
  }
  // No Groq key, or Groq is cooling / failed: Gemini takes the call (callers may opt out, e.g. the bulk triage).
  if (gemini && geminiReady()) {
    for (const model of [...new Set([...(models || []).filter(isGemini), ...GEMINI_MODELS])].filter((m) => !(cooldown.get(m) > Date.now()))) {
      if (geminiLeft() <= 0) break;
      try { const r = await call(model, system, prompt, Math.max(maxTokens * 2, 2400), settings.geminiKey, json); health.ok("gemini"); return r; }
      catch (e) { last = e; usage.errors++; usage.lastError = e.message; health.fail("gemini", e); if (!e.next) break; }
    }
  }
  if (!last && !key) throw Object.assign(new Error(settings.geminiKey ? (geminiLeft() <= 0 ? "Gemini's daily call budget is used up (geminiPerDay)" : "Gemini is rate limited (its free quota); no Groq key to fall back to") : "No fast AI key (Groq or Gemini)"), { busy: true });
  throw Object.assign(last || new Error("All fast models are cooling down"), { busy: true });
}

// Tests the key typed in the form (or the saved one when the field is blank) without saving anything.
export async function testFast(key) {
  try {
    const r = await askFast('Reply with JSON {"ok":true}.', "ping", 50, { key: key || undefined });
    return { ok: true, model: r.model, ms: r.ms };
  } catch (e) { return { ok: false, error: e.message }; }
}
