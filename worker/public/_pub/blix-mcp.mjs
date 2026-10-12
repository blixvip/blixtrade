#!/usr/bin/env node
// BLIX MCP connector: gives an MCP client (Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, VS Code, Windsurf,
// Zed) the BLIX API as tools, under your BLIX account. One file, no dependencies, Node 20 or newer.
//
//   1. Sign in at https://blixvip.com, open https://blixvip.com/developers and copy your session.
//   2. BLIX_SESSION=<your session> node blix-mcp.mjs       (BLIX_URL defaults to https://blixvip.com)
//
// Newline-delimited JSON-RPC 2.0 on stdio in, the BLIX API out. Read-only tools plus the paper desk: nothing here can
// spend real funds. Lists are capped (limit, default 10, max 50) and picture fields dropped so a model is not flooded.
import readline from "node:readline";

const BASE = (process.env.BLIX_URL || "https://blixvip.com").replace(/\/$/, "");
const SESSION = String(process.env.BLIX_SESSION || process.env.BLIX_COOKIE || "").trim();
const MAX_CHARS = 40_000;
const LIMIT = { type: "integer", description: "Most rows to return in any list (default 10, max 50)" };
const DROP = new Set(["image", "uri", "icon"]);
const MINT = { type: "string", description: "Solana mint address (base58)" };
const qs = (o) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")).toString(); return s ? `?${s}` : ""; };
const seg = encodeURIComponent;

// Each tool is one call of the BLIX API. `call` returns [method, path, body?].
const TOOLS = [
  { name: "blix_overview", description: "Market snapshot: launches per hour, coins tracked, signals in 24h, graduations, top movers, health issues.", call: () => ["GET", "overview"] },
  { name: "blix_pulse", description: "The live Pulse: new launches, final stretch, migrated and running coins, each with stats and the AI verdict.", call: () => ["GET", "pulse"] },
  { name: "blix_signals", description: "Latest signals, newest first.",
    props: { kind: { type: "string", description: "Signal type prefix to filter on" }, screen: { type: "string", enum: ["approved", "unscreened", "all"], description: "Safety screen (default approved)" } },
    call: (a) => ["GET", `signals${qs({ kind: a.kind, screen: a.screen, limit: a.limit })}`] },
  { name: "blix_coins", description: "Search or rank tracked coins. A search also finds dead and flagged coins.",
    props: { q: { type: "string", description: "Ticker, name or mint to search for" }, sort: { type: "string", description: "Column to sort by, e.g. mcap, vol_h1, chg_h1, safety_score" }, dir: { type: "string", enum: ["desc", "asc"] }, theme: { type: "string", description: "Narrative theme to filter on" } },
    call: (a) => ["GET", `tokens${qs({ q: a.q, sort: a.sort, dir: a.dir, theme: a.theme, limit: a.limit })}`] },
  { name: "blix_coin", description: "Everything on one coin: price history, safety report, holders summary, socials, research, signals.", props: { mint: MINT }, required: ["mint"], call: (a) => ["GET", `token/${seg(a.mint)}`] },
  { name: "blix_holders", description: "Live holder ledger for a coin: top holders tagged dev, sniper or bundle, and the top-10 share.", props: { mint: MINT }, required: ["mint"], call: (a) => ["GET", `holders/${seg(a.mint)}${qs({ top: a.limit })}`] },
  { name: "blix_candles", description: "Market-cap candles built from real trades, with volume. Returns the most recent candles.",
    props: { mint: MINT, tf: { type: "string", enum: ["1s", "5s", "15s", "1m", "5m", "15m", "1h"], description: "Candle size (default 1m)" } }, required: ["mint"], tail: true,
    call: (a) => ["GET", `candles/${seg(a.mint)}${qs({ tf: { "1s": 1, "5s": 5, "15s": 15, "1m": 60, "5m": 300, "15m": 900, "1h": 3600 }[a.tf] || 60 })}`] },
  { name: "blix_quote", description: "A real Jupiter quote for a buy or a sell: amount out, price impact, route. Nothing is traded.",
    props: { mint: MINT, side: { type: "string", enum: ["buy", "sell"] }, amount: { type: "number", description: "SOL to spend on a buy, tokens to sell on a sell" }, slip: { type: "integer", description: "Slippage in basis points" } }, required: ["mint", "side", "amount"],
    call: (a) => ["GET", `quote${qs({ mint: a.mint, side: a.side, amount: a.amount, slip: a.slip })}`] },
  { name: "blix_narratives", description: "Narratives right now: themes with heat, launch share, lift, emerging words and lead coins.", call: () => ["GET", "narratives"] },
  { name: "blix_briefs", description: "The latest market briefs written by the AI.", call: () => ["GET", "briefs"] },
  { name: "blix_research", description: "The AI reads on one coin: first read, deep read, grade, thesis, plan, sources.", props: { mint: MINT }, required: ["mint"], call: (a) => ["GET", `research/${seg(a.mint)}`] },
  { name: "blix_picks", description: "The AI picks scorecard: by stage, by call, by reason, by day, and the running result.", call: () => ["GET", "picks"] },
  { name: "blix_wallets", description: "The smart-money ranking (wallets that bought past runners early, by record) and what Fomo traders are buying.", call: () => ["GET", "wallets"] },
  { name: "blix_wallet", description: "Any Solana wallet, built from the chain: profile, holdings, latest swaps, positions, best closed trades, pump.fun leaderboard rank.", props: { address: { type: "string", description: "Solana wallet address" } }, required: ["address"], call: (a) => ["GET", `wallet-page/${seg(a.address)}`] },
  { name: "blix_fomo", description: "What Fomo app traders are buying, and the top Fomo traders.", call: () => ["GET", "fomo"] },
  { name: "blix_track_record", description: "How past signals did, per signal type: up 20%+, down 50%+, unsellable, median, reached 2x.", call: () => ["GET", "perf"] },
  { name: "blix_health", description: "Every dependency of the terminal: working or not, last success, last failure.", call: () => ["GET", "health"] },
  { name: "blix_paper_desk", description: "Your paper desk: open positions, today's and lifetime PnL. Paper money only.", call: () => ["GET", "paper"] },
  { name: "blix_paper_buy", description: "Open a paper position at the real quote. Paper money only: nothing is ever bought.", write: true,
    props: { mint: MINT, sol: { type: "number", description: "Paper SOL to spend" }, tp: { type: "number", description: "Take-profit multiple, e.g. 2" }, sl: { type: "number", description: "Stop-loss percent" }, trail: { type: "number", description: "Trailing stop percent" } }, required: ["mint", "sol"],
    call: (a) => ["POST", "paper/quoted", { mint: a.mint, sol: a.sol, tp: a.tp, sl: a.sl, trail: a.trail }] },
  { name: "blix_paper_sell", description: "Sell all or part of a paper position at the real quote. Paper money only.", write: true,
    props: { id: { type: "integer", description: "Position id from blix_paper_desk" }, pct: { type: "number", description: "Percent to sell (default 100)" } }, required: ["id"],
    call: (a) => ["POST", `paper/${seg(a.id)}/sellq`, { pct: a.pct ?? 100, why: "mcp" }] },
];

function trim(v, n, tail) {
  if (Array.isArray(v)) return (tail ? v.slice(-n) : v.slice(0, n)).map((x) => trim(x, n, tail));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !DROP.has(k)).map(([k, x]) => [k, trim(x, n, tail)]));
  return typeof v === "string" && v.length > 800 ? `${v.slice(0, 800)}…` : v;
}

async function callTool(name, args = {}) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  for (const k of tool.required || []) if (args[k] === undefined || args[k] === "") throw new Error(`Missing argument: ${k}`);
  if (!SESSION) throw new Error("BLIX_SESSION is not set. Sign in at https://blixvip.com, open https://blixvip.com/developers and copy your session into BLIX_SESSION.");
  const limit = Math.min(Math.max(Math.round(+args.limit) || 10, 1), 50);
  const [method, path, body] = tool.call({ ...args, limit });
  let r;
  try {
    r = await fetch(`${BASE}/api/${path}`, { method, signal: AbortSignal.timeout(60_000),
      headers: { cookie: `blix_wait=${SESSION}`, accept: "application/json", "user-agent": "blix-mcp/1.0", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (e) { throw new Error(`BLIX is not answering at ${BASE} (${e.cause?.code || e.message}).`); }
  if (r.status === 401 || r.status === 403) throw new Error("Your BLIX session is missing or expired. Sign in at https://blixvip.com/developers and copy a fresh BLIX_SESSION.");
  const data = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  const text = JSON.stringify(trim(data, limit, tool.tail));
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[cut at ${MAX_CHARS} characters; ask again with a smaller limit]` : text;
}

const schema = (t) => ({ name: t.name, description: t.description,
  inputSchema: { type: "object", properties: { ...t.props, limit: LIMIT }, required: t.required || [] },
  annotations: { readOnlyHint: !t.write } });

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // a notification: nothing to answer
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  if (method === "initialize") return ok({ protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} },
    serverInfo: { name: "blix", version: "1.0.0" }, instructions: "Live view of the BLIX Solana memecoin terminal under the signed-in account, plus a paper-money desk. Nothing here can spend real funds." });
  if (method === "ping") return ok({});
  if (method === "tools/list") return ok({ tools: TOOLS.map(schema) });
  if (method === "tools/call") {
    try { return ok({ content: [{ type: "text", text: await callTool(params?.name, params?.arguments) }] }); }
    catch (e) { return ok({ content: [{ type: "text", text: e.message }], isError: true }); }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return out({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
  const res = await handle(msg).catch((e) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: e.message } }));
  if (res) out(res);
});
