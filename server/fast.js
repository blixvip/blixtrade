// Fast AI lane: Groq (free tier, key from console.groq.com/keys). Grades come back in about a second,
// so every candidate coin can be rated. Each Groq model has its own free quota, so when one model
// is rate limited we move to the next and come back after its cooldown.
import { settings } from "./settings.js";

const URL = "https://api.groq.com/openai/v1/chat/completions";
export const FAST_MODELS = ["openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"];

const cooldown = new Map();          // model -> until (ms)
const plain = new Set();             // models that rejected the extra options; call them without
const usage = { calls: 0, errors: 0, tokens: 0, lastMs: null, avgMs: null, lastModel: null, lastError: null, limits: {} };

export const fastReady = () => Boolean(settings.groqKey);
export const fastStatus = () => ({
  ready: fastReady(), ...usage,
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

async function call(model, system, prompt, maxTokens) {
  const body = {
    model, temperature: 0.3, max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
  };
  if (!plain.has(model)) {
    body.response_format = { type: "json_object" };
    if (model.startsWith("openai/gpt-oss")) { body.reasoning_effort = "low"; body.include_reasoning = false; }
  }
  const t0 = Date.now();
  const r = await fetch(URL, {
    method: "POST", signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${settings.groqKey}`, "content-type": "application/json" },
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
    return call(model, system, prompt, maxTokens);
  }
  if (r.status === 404 || (r.status === 400 && /model/i.test(res?.error?.message || ""))) {
    cooldown.set(model, Date.now() + 24 * 3600_000);   // model retired or not on this account
    const e = new Error(`${model} unavailable`); e.next = true; throw e;
  }
  if (r.status === 401) throw new Error("Groq key was rejected. Check it in Settings.");
  if (!r.ok) { const e = new Error(res?.error?.message || `Groq ${r.status}`); e.next = r.status >= 500; throw e; }
  const text = res.choices?.[0]?.message?.content?.trim() || "";
  usage.calls++; usage.tokens += res.usage?.total_tokens || 0;
  usage.lastMs = ms; usage.avgMs = usage.avgMs == null ? ms : Math.round(usage.avgMs * 0.8 + ms * 0.2); usage.lastModel = model;
  return { text, model, ms };
}

export async function askFast(system, prompt, maxTokens = 900) {
  if (!fastReady()) throw new Error("No Groq key");
  let last;
  for (const model of order()) {
    try { return await call(model, system, prompt, maxTokens); }
    catch (e) { last = e; usage.errors++; usage.lastError = e.message; if (!e.next) throw e; }
  }
  throw last || new Error("All Groq models are cooling down");
}

export async function testFast() {
  try {
    const r = await askFast('Reply with JSON {"ok":true}.', "ping", 50);
    return { ok: true, model: r.model, ms: r.ms };
  } catch (e) { return { ok: false, error: e.message }; }
}
