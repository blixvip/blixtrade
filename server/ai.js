// AI write-ups (market briefs, single-coin takes) via Claude, using this PC's Claude Code login.
// Same approach as Buzzroll: direct Messages API call with the OAuth token, no separate API key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as health from "./health.js";

const MODEL = "claude-sonnet-5-5";
// The quick, light model on the same login: used for first reads when no other fast AI is available.
export const FAST_MODEL = "claude-haiku-4-5-20251001";
const IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
// The model thinks before it writes, and that thinking is billed against max_tokens. Without headroom a
// 1,400-token budget was being spent mostly on thinking and answers stopped mid-sentence.
const THINKING_ROOM = 4000;

const usage = { calls: 0, errors: 0, truncated: 0, lastOk: null, lastError: null, lastErrorAt: null, lastMs: null };

function token() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", ".credentials.json"), "utf8"));
    const o = c.claudeAiOauth;
    if (!o?.accessToken) return { error: "No Claude login found on this PC." };
    if (o.expiresAt && o.expiresAt < Date.now()) return { error: "Claude login expired. Open Claude Code once to refresh it." };
    return { token: o.accessToken };
  } catch {
    return { error: "No Claude login found on this PC." };
  }
}
export const claudeStatus = () => ({ ready: !token().error, loginError: token().error || null, model: MODEL, ...usage });

async function call(system, prompt, budget, model) {
  const t = token();
  if (t.error) throw new Error(t.error);
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(180_000),
    headers: {
      authorization: `Bearer ${t.token}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: budget,
      system: [{ type: "text", text: IDENTITY }, { type: "text", text: system }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body?.error?.message || `Claude API ${r.status}`), { status: r.status, busy: r.status === 429 || r.status === 529 });
  return { text: (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(), stop: body.stop_reason };
}

// maxTokens is the room for the answer itself. `truncated` is true when the model still ran out of
// room after one retry with a bigger budget: the caller must treat that text as partial.
export async function ask(system, prompt, maxTokens = 1400, { model = MODEL } = {}) {
  const t0 = Date.now();
  try {
    let r = await call(system, prompt, maxTokens + THINKING_ROOM, model);
    if (r.stop === "max_tokens") r = await call(system, prompt, maxTokens * 2 + THINKING_ROOM * 2, model);
    const truncated = r.stop === "max_tokens";
    usage.calls++; usage.lastOk = Date.now(); usage.lastMs = Date.now() - t0;
    if (truncated) usage.truncated++;
    health.ok("claude");
    return { text: r.text, model, stop: r.stop, truncated };
  } catch (e) {
    usage.errors++; usage.lastError = e.name === "TimeoutError" ? "timed out" : e.message; usage.lastErrorAt = Date.now();
    health.fail("claude", usage.lastError);
    throw e;
  }
}

// The first complete JSON object in a model's answer (models sometimes add prose or a second object after it).
export function extractJson(text) {
  const s = String(text || ""), start = s.indexOf("{");
  if (start < 0) throw new Error("the answer had no JSON in it");
  let depth = 0, str = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("the answer was cut off mid-JSON");
}

const SECTIONS = ["The tape", "Narratives heating up", "Coins to watch", "Red flags"];
const BRIEF_SYSTEM = `You write short market briefs for a memecoin scanner's owner. You get live data from the scanner.
Write in plain, punchy English. No hype, no emojis, no financial advice disclaimers beyond one short closing line.
Use exactly these markdown sections:
## The tape  (2-3 sentences: overall activity, launch pace, risk mood)
## Narratives heating up  (3-5 bullets: theme — why, with 1-2 example tickers)
## Coins to watch  (3-6 bullets: $TICKER — mcap, what it's doing, the main risk)
## Red flags  (1-3 bullets: dumps, pulled liquidity, crowded trades)
Only mention tickers that appear in the data. Numbers must come from the data.
Wording rules: a price falling 50% is a "dump" or "down 50%", never a "rug". Say "rugged" or "liquidity pulled" only when the
data explicitly says so (confirmedRugs, liquidityPulled). The track-record numbers are price moves after an alert, not trading
profits: never describe them as returns or winnings. Coins listed under unscreenedWalletBuys failed or skipped the safety
check; mention them only as a caution, never as coins to watch.`;

// Does a brief have all four sections and a finished last sentence?
export function briefProblem(text) {
  const t = String(text || "").trim();
  const missing = SECTIONS.filter((s) => !new RegExp(`^#{1,3}\\s*${s}`, "im").test(t));
  if (missing.length) return `missing section${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`;
  if (t.length < 400) return "too short";
  if (!/[.!?)"'’”%]$/.test(t)) return "stops mid-sentence";
  return null;
}

// Never publishes a cut-off brief as if it were whole: retries once, then says it is partial.
export async function writeBrief(data) {
  let last;
  for (let i = 0; i < 2; i++) {
    last = await ask(BRIEF_SYSTEM, `Scanner data (JSON):\n${JSON.stringify(data)}`, 1800);
    const problem = last.truncated ? "ran out of room" : briefProblem(last.text);
    if (!problem) return { ...last, status: "complete", problem: null };
    last.problem = problem;
  }
  return { ...last, status: "partial" };
}

const COIN_SYSTEM = `You explain a single memecoin to its scanner's owner in under 170 words: what the meme is,
how it is trading right now, what the safety check found, and the one thing to watch. Plain English, no hype, no emojis.
End with one short line on risk. Only use facts from the data.`;

export async function explainCoin(data) {
  return ask(COIN_SYSTEM, `Coin data (JSON):\n${JSON.stringify(data)}`, 500);
}
