// Grok through this PC's Grok CLI login (SuperGrok subscription, no API key). Same idea as the Claude
// login in ai.js: read the CLI's saved session from ~/.grok/auth.json and call the CLI chat proxy.
// The Responses endpoint runs xAI's own x_search / web_search tools server side, so Grok reads what
// X is saying about a coin right now. When the session expires, `grok models` refreshes it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DIR = path.join(os.homedir(), ".grok");
const BIN = path.join(DIR, "bin", process.platform === "win32" ? "grok.exe" : "grok");
const BASE = process.env.GROK_CLI_CHAT_PROXY_BASE_URL || "https://cli-chat-proxy.grok.com/v1";
export const GROK_MODELS = ["grok-4.7-build-fast", "grok-4.7", "grok-4.6"];

let version = "1.0.41";
let refreshing = null, cooling = 0;
const usage = { calls: 0, errors: 0, tokens: 0, searches: 0, lastMs: null, avgMs: null, lastModel: null, lastError: null, limits: null, tier: null };

export const grokInstalled = () => fs.existsSync(path.join(DIR, "auth.json"));
export const grokStatus = () => ({ installed: grokInstalled(), ...usage, coolingSecs: cooling > Date.now() ? Math.ceil((cooling - Date.now()) / 1000) : 0 });

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

async function post(model, body, retried = false, timeout = 90_000) {
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
  if (r.status === 401 && !retried) { await token(true); return post(model, body, true, timeout); }
  if (r.status === 426 && !retried) { await detectVersion(); return post(model, body, true, timeout); }
  if (r.status === 429) {
    const wait = Number(r.headers.get("retry-after")) || 60;
    cooling = Date.now() + wait * 1000;
    throw Object.assign(new Error(`Grok rate limited, back in ${wait}s`), { busy: true });
  }
  if (!r.ok) throw Object.assign(new Error(`Grok ${r.status}: ${txt.replace(/\s+/g, " ").slice(0, 200)}`), { status: r.status });
  const j = JSON.parse(txt);
  usage.calls++; usage.tokens += j.usage?.total_tokens || 0; usage.searches += j.usage?.num_server_side_tools_used || 0;
  usage.lastMs = ms; usage.avgMs = usage.avgMs == null ? ms : Math.round(usage.avgMs * 0.8 + ms * 0.2); usage.lastModel = model;
  return { text: textOf(j), model, ms, searches: j.usage?.num_server_side_tools_used || 0 };
}

// search: let Grok search X (and the web) itself before answering.
// maxSearches + low reasoning keep a searched read around 7-10s instead of 30s (it otherwise runs ~12 searches).
let plainSearch = false;
export async function askGrok(system, prompt, { model = GROK_MODELS[0], search = true, maxTokens = 2000, maxSearches = 3, effort = "low", chatEffort = null, timeout = 90_000 } = {}) {
  if (cooling > Date.now()) throw Object.assign(new Error("Grok is cooling down after a rate limit"), { busy: true });
  try {
    const speed = plainSearch ? {} : { max_tool_calls: maxSearches, reasoning: { effort } };
    if (search && !plainSearch) {
      try {
        return await post(model, { instructions: system, input: [{ role: "user", content: prompt }], tools: [{ type: "x_search" }, { type: "web_search" }], max_output_tokens: maxTokens, ...speed }, false, timeout);
      } catch (e) {
        if (e.status !== 400 || /model/i.test(e.message)) throw e;
        plainSearch = true;   // proxy rejected the speed options; search without them from now on
      }
    }
    return search
      ? await post(model, { instructions: system, input: [{ role: "user", content: prompt }], tools: [{ type: "x_search" }, { type: "web_search" }], max_output_tokens: maxTokens }, false, timeout)
      : await post(model, { messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: maxTokens, response_format: { type: "json_object" }, ...(chatEffort ? { reasoning_effort: chatEffort } : {}) }, false, timeout);
  } catch (e) {
    usage.errors++; usage.lastError = e.message;
    // A model the subscription doesn't have: try the next one.
    if ((e.status === 400 || e.status === 403 || e.status === 404) && /model/i.test(e.message)) {
      const next = GROK_MODELS[GROK_MODELS.indexOf(model) + 1];
      if (next) return askGrok(system, prompt, { model: next, search, maxTokens, maxSearches, effort, chatEffort, timeout });
    }
    throw e;
  }
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
