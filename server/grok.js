// Grok through this PC's Grok CLI login (SuperGrok subscription, no API key). Same idea as the Claude
// login in ai.js: read the CLI's saved session from ~/.grok/auth.json and call the CLI chat proxy.
// The Responses endpoint runs xAI's own x_search / web_search tools server side, so Grok reads what
// X is saying about a coin right now. When the session expires, `grok models` refreshes it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as health from "./health.js";
import { db } from "./db.js";
import { settings } from "./settings.js";

// Every Grok call is written down with what it cost. The subscription's allowance ran out once in about
// an hour of unmetered use, so each job ("lane") now spends against one daily budget, and the cheap,
// high-volume lanes stop first: narrative work can use all of it, per-coin reads only part.
db.exec("CREATE TABLE IF NOT EXISTS ai_spend (t INTEGER, provider TEXT, lane TEXT, model TEXT, ms INTEGER, tokens INTEGER, searches INTEGER, cost REAL)");
db.exec("CREATE INDEX IF NOT EXISTS ai_spend_t ON ai_spend(t)");
const TICKS_PER_USD = 1e10;                    // xAI reports cost in ticks
// The share of the daily budget at which each lane stops calling Grok.
export const LANE_CAP = { narrative: 1, scout: 0.6, review: 1, deep: 0.5, quick: 0.25, triage: 0.1, other: 0.5 };
// The steady per-coin lanes are also paced through the day, so the morning cannot spend the evening's share.
const PACED = new Set(["quick", "deep", "triage"]);
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
let spend = { day: 0, usd: 0, lanes: {} };
function spentToday() {
  const d0 = dayStart();
  if (spend.day !== d0) {
    spend = { day: d0, usd: 0, lanes: {} };
    for (const r of db.prepare("SELECT lane, SUM(cost) c, COUNT(*) n FROM ai_spend WHERE provider = 'grok' AND t >= ? GROUP BY lane").all(d0)) { spend.usd += r.c || 0; spend.lanes[r.lane] = { usd: r.c || 0, calls: r.n }; }
  }
  return spend;
}
export function record(lane, model, ms, u = {}) {
  const cost = (u.cost_in_usd_ticks || 0) / TICKS_PER_USD, s = spentToday();
  // The answer was paid for: a ledger write that fails must not throw it away.
  try { db.prepare("INSERT INTO ai_spend (t, provider, lane, model, ms, tokens, searches, cost) VALUES (?, 'grok', ?, ?, ?, ?, ?, ?)").run(Date.now(), lane, model, ms, u.total_tokens || 0, u.num_server_side_tools_used || 0, cost); } catch {}
  s.usd += cost;
  const l = (s.lanes[lane] ||= { usd: 0, calls: 0 });
  l.usd += cost; l.calls++;
  return cost;
}
// Why this lane may not call Grok right now, or null when it may. A budget of 0 switches the limit off.
export function grokOver(lane = "other") {
  const budget = +settings.grokDailyBudget || 0;
  if (!budget || lane === "bench") return null;
  const s = spentToday(), cap = budget * (LANE_CAP[lane] ?? LANE_CAP.other);
  if (s.usd >= budget) return `Grok's daily budget of $${budget.toFixed(2)} is spent`;
  if (PACED.has(lane)) {
    const mine = s.lanes[lane]?.usd || 0, sofar = cap * Math.min(1, (Date.now() - s.day) / 864e5 + 0.1);
    return mine >= sofar ? `Grok ${lane} reads have used $${mine.toFixed(2)} of the $${cap.toFixed(2)} set aside for them today; more opens up through the day` : null;
  }
  return s.usd >= cap ? `Grok has used $${s.usd.toFixed(2)} today; ${lane} calls stop at $${cap.toFixed(2)} of the $${budget.toFixed(2)} daily budget` : null;
}
export const grokSpend = () => { const s = spentToday(); return { today: +s.usd.toFixed(4), budget: +settings.grokDailyBudget || 0, lanes: s.lanes, caps: LANE_CAP }; };

const DIR = path.join(os.homedir(), ".grok");
const BIN = path.join(DIR, "bin", process.platform === "win32" ? "grok.exe" : "grok");
const BASE = process.env.GROK_CLI_CHAT_PROXY_BASE_URL || "https://cli-chat-proxy.grok.com/v1";
export const GROK_MODELS = ["grok-4.7-build-fast", "grok-4.7", "grok-4.6"];

let version = "1.0.41";
let refreshing = null, cooling = 0;
// Out of subscription credits ("spending-limit"): stop calling Grok entirely and re-check every 30 minutes.
let blockedUntil = 0, blockedReason = null;
export const grokBlocked = () => blockedUntil > Date.now();
const usage = { calls: 0, errors: 0, tokens: 0, searches: 0, lastMs: null, avgMs: null, lastModel: null, lastError: null, lastErrorAt: null, lastOk: null, blockedSince: null, limits: null, tier: null, billing: null };

export const grokInstalled = () => fs.existsSync(path.join(DIR, "auth.json"));
// Can this lane use Grok right now: logged in, not out of credits, and inside the daily budget.
export const grokReady = (lane) => grokInstalled() && !grokBlocked() && !grokOver(lane);
export const grokStatus = () => ({ installed: grokInstalled(), ...usage, coolingSecs: cooling > Date.now() ? Math.ceil((cooling - Date.now()) / 1000) : 0,
  blocked: grokBlocked() ? blockedReason : null, blockedUntil: grokBlocked() ? blockedUntil : null, spend: grokSpend() });

function run(args, ms) {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(BIN, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const kill = setTimeout(() => p.kill(), ms);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", () => { clearTimeout(kill); resolve(""); });
    p.on("close", () => { clearTimeout(kill); resolve(out); });
  });
}

// The proxy refuses requests that don't carry a current CLI version.
export async function detectVersion() {
  if (!fs.existsSync(BIN)) return version;
  const v = (await run(["--version"], 15_000)).match(/(\d+\.\d+\.\d+)/)?.[1];
  if (v) version = v;
  return version;
}

function readCred() {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(DIR, "auth.json"), "utf8"));
    return Object.values(auth).find((v) => v && typeof v === "object" && v.key) || null;
  } catch { return null; }
}

async function refresh() {
  // Running any CLI command makes the CLI rotate an expired session with its refresh token.
  refreshing ||= run(["models"], 60_000).finally(() => { refreshing = null; });
  await refreshing;
}

async function token(force = false) {
  let c = readCred();
  if (!c) throw new Error("Grok isn't logged in on this PC. Run `grok login` once.");
  if (force || (c.expires_at && Date.parse(c.expires_at) < Date.now() + 2 * 60_000)) {
    await refresh();
    c = readCred();
    if (!c || (c.expires_at && Date.parse(c.expires_at) < Date.now())) throw new Error("Grok login expired. Run `grok login` once.");
  }
  return c.key;
}

function textOf(j) {
  // Responses API: output[] has reasoning, tool calls, then the message; chat API: choices[0].message
  const msg = (j.output || []).filter((o) => o.type === "message").flatMap((o) => o.content || []).map((c) => c.text || "").join("");
  return (msg || j.choices?.[0]?.message?.content || j.output_text || "").trim();
}

async function post(model, body, retried = false, timeout = 90_000, lane = "other") {
  const t0 = Date.now();
  const endpoint = body.input ? "responses" : "chat/completions";
  const r = await fetch(`${BASE}/${endpoint}`, {
    method: "POST", signal: AbortSignal.timeout(timeout),
    headers: {
      "content-type": "application/json", authorization: `Bearer ${await token()}`,
      "x-xai-token-auth": "xai-grok-cli", "x-grok-model-override": model, "x-grok-client-version": version,
    },
    body: JSON.stringify({ model, stream: false, ...body }),
  });
  const ms = Date.now() - t0;
  const lim = r.headers.get("x-ratelimit-remaining-requests");
  if (lim != null) usage.limits = { requestsLeft: +lim, requestsLimit: +r.headers.get("x-ratelimit-limit-requests"), tokensLeft: +r.headers.get("x-ratelimit-remaining-tokens") };
  const txt = await r.text();
  if (r.status === 401 && !retried) { await token(true); return post(model, body, true, timeout, lane); }
  if (r.status === 426 && !retried) { await detectVersion(); return post(model, body, true, timeout, lane); }
  // Out of credits comes back as 403 "spending-limit" or 402 "usage balance exhausted", depending on the model.
  if ((r.status === 403 || r.status === 402) && /spending-limit|run out of credits|balance exhausted|payment required|insufficient/i.test(txt) || r.status === 402) {
    blockedUntil = Date.now() + 30 * 60_000;
    blockedReason = "Grok subscription credits used up for now";
    usage.blockedSince ||= Date.now();
    health.fail("grok", blockedReason);
    throw Object.assign(new Error(blockedReason), { busy: true, blocked: true });
  }
  if (r.status === 429) {
    const wait = Number(r.headers.get("retry-after")) || 60;
    cooling = Date.now() + wait * 1000;
    throw Object.assign(new Error(`Grok rate limited, back in ${wait}s`), { busy: true });
  }
  if (!r.ok) throw Object.assign(new Error(`Grok ${r.status}: ${txt.replace(/\s+/g, " ").slice(0, 200)}`), { status: r.status });
  const j = JSON.parse(txt);
  usage.calls++; usage.tokens += j.usage?.total_tokens || 0; usage.searches += j.usage?.num_server_side_tools_used || 0;
  usage.lastMs = ms; usage.avgMs = usage.avgMs == null ? ms : Math.round(usage.avgMs * 0.8 + ms * 0.2); usage.lastModel = model;
  usage.lastOk = Date.now(); usage.blockedSince = null;
  health.ok("grok");
  const cost = record(lane, model, ms, j.usage);
  return { text: textOf(j), model, ms, searches: j.usage?.num_server_side_tools_used || 0, cost, tokens: j.usage?.total_tokens || 0, outTokens: j.usage?.output_tokens ?? j.usage?.completion_tokens ?? null };
}

// search: let Grok search X (and the web) itself before answering.
// maxSearches + low reasoning keep a searched read around 7-10s instead of 30s (it otherwise runs ~12 searches).
let plainSearch = false;
export async function askGrok(system, prompt, { model = GROK_MODELS[0], search = true, maxTokens = 2000, maxSearches = 3, effort = "low", chatEffort = null, timeout = 90_000, lane = "other", fallback = true } = {}) {
  if (cooling > Date.now()) throw Object.assign(new Error("Grok is cooling down after a rate limit"), { busy: true });
  if (grokBlocked()) throw Object.assign(new Error(blockedReason), { busy: true, blocked: true });
  // Over the daily budget is treated like being out of credits: the caller falls back to another AI.
  const over = grokOver(lane);
  if (over) throw Object.assign(new Error(over), { busy: true, blocked: true, budget: true });
  try {
    const speed = plainSearch ? {} : { max_tool_calls: maxSearches, reasoning: { effort } };
    if (search && !plainSearch) {
      try {
        return await post(model, { instructions: system, input: [{ role: "user", content: prompt }], tools: [{ type: "x_search" }, { type: "web_search" }], max_output_tokens: maxTokens, ...speed }, false, timeout, lane);
      } catch (e) {
        if (e.status !== 400 || /model/i.test(e.message)) throw e;
        plainSearch = true;   // proxy rejected the speed options; search without them from now on
      }
    }
    return search
      ? await post(model, { instructions: system, input: [{ role: "user", content: prompt }], tools: [{ type: "x_search" }, { type: "web_search" }], max_output_tokens: maxTokens }, false, timeout, lane)
      : await post(model, { messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: maxTokens, response_format: { type: "json_object" }, ...(chatEffort ? { reasoning_effort: chatEffort } : {}) }, false, timeout, lane);
  } catch (e) {
    usage.errors++; usage.lastError = e.message; usage.lastErrorAt = Date.now();
    if (!e.blocked) health.fail("grok", e.message);
    // A model the subscription doesn't have: try the next one.
    if (fallback && (e.status === 400 || e.status === 403 || e.status === 404) && /model/i.test(e.message)) {
      const next = GROK_MODELS[GROK_MODELS.indexOf(model) + 1];
      if (next) return askGrok(system, prompt, { model: next, search, maxTokens, maxSearches, effort, chatEffort, timeout, lane });
    }
    throw e;
  }
}

// What the subscription itself says has been used this billing period (the radar's own ledger only
// knows about its own calls; the Grok CLI used by hand spends from the same allowance).
export async function grokBilling() {
  try {
    const r = await fetch(`${BASE}/billing`, { signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${await token()}`, "x-xai-token-auth": "xai-grok-cli", "x-grok-client-version": version } });
    const c = (await r.json()).config;
    if (c) usage.billing = { t: Date.now(), used: c.used?.val ?? null, monthlyLimit: c.monthlyLimit?.val ?? null, onDemandCap: c.onDemandCap?.val ?? null, periodEnd: c.billingPeriodEnd || null };
  } catch {}
  return usage.billing;
}

export async function grokTier() {
  try {
    const r = await fetch(`${BASE}/user?include=subscription`, { headers: { authorization: `Bearer ${await token()}`, "x-xai-token-auth": "xai-grok-cli", "x-grok-client-version": version } });
    usage.tier = (await r.json()).subscriptionTier || null;
  } catch {}
  return usage.tier;
}

export async function testGrok() {
  try {
    const r = await askGrok('Reply with JSON {"ok":true}.', "ping", { search: false, maxTokens: 50 });
    return { ok: true, model: r.model, ms: r.ms, tier: await grokTier() };
  } catch (e) { return { ok: false, error: e.message }; }
}
