// Live pump.fun trade feed, free: subscribe to the pump.fun program's logs over a Solana RPC websocket
// (the public one works, ~50 trades/s) and decode each TradeEvent (mint, SOL size, side, trader,
// virtual + real reserves). From that every coin on the bonding curve gets a live market cap, exact
// bonding progress, buys/sells, volume and trader count, pushed to the Pulse page as they happen.
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./db.js";
import { settings } from "./settings.js";
import { setSolPrice } from "./research.js";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const TRADE = "bddb7fd34ee661ee";           // anchor discriminator of pump.fun's TradeEvent
const CREATE = "1b72a94ddeeb6376";          // ... and of its CreateEvent (name, symbol, uri, mint, curve, user)
const INITIAL_REAL_TOKENS = 793_100_000;     // tokens sold along the curve before it completes
const PUBLIC_WS = "wss://api.mainnet-beta.solana.com";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const now = () => Date.now();

function b58(buf) {
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b) break; s = "1" + s; }
  return s;
}

export const live = new Map();   // mint -> stats
const dirty = new Set();
export const feed = { connected: false, trades: 0, perSec: 0, solUsd: 150, solKnown: false, solT: 0, since: now(), lastMsg: 0, url: null };
let sent = 0;
// Other parts of the radar can follow every trade as it lands (the early radar does).
const listeners = [];
export const onLiveTrade = (fn) => listeners.push(fn);
// Every coin created on pump.fun, straight from the chain. PumpPortal (the launch feed) drops about one
// launch in seven (measured 2026-10-02: 18 of 129 in 150s), so the engine fills its gaps from here.
const createListeners = [];
export const onLiveCreate = (fn) => createListeners.push(fn);
export const createStats = { seen: 0, failed: 0 };
function onCreate(buf) {
  try {
    let o = 8;
    const str = () => { const n = buf.readUInt32LE(o); const v = buf.toString("utf8", o + 4, o + 4 + n); o += 4 + n; return v; };
    const name = str(), symbol = str(), uri = str();
    const mint = b58(buf.subarray(o, o + 32));
    const creator = b58(buf.subarray(o + 64, o + 96));
    createStats.seen++;
    for (const fn of createListeners) fn({ mint, name: name.slice(0, 64), symbol: symbol.slice(0, 32), uri: uri.slice(0, 300), creator });
  } catch { createStats.failed++; }
}

function onTrade(buf, slot = null) {
  if (buf.length < 8 + 32 + 8 + 8 + 1 + 32 + 8 + 8 + 8 + 8 + 8) return;
  let o = 8;
  const mint = b58(buf.subarray(o, o += 32));
  const sol = Number(buf.readBigUInt64LE(o)) / 1e9; o += 8;
  const tokens = Number(buf.readBigUInt64LE(o)) / 1e6; o += 8;   // token amount (6 decimals)
  const buy = buf[o] === 1; o += 1;
  const user = b58(buf.subarray(o, o += 32));
  o += 8;                                            // timestamp
  const vSol = Number(buf.readBigUInt64LE(o)) / 1e9; o += 8;
  const vTok = Number(buf.readBigUInt64LE(o)) / 1e6; o += 8;
  o += 8;                                            // real SOL reserves
  const rTok = Number(buf.readBigUInt64LE(o)) / 1e6;
  if (!vTok) return;
  const mcSol = (vSol / vTok) * 1e9;                 // 1B supply
  // Coins created with a smaller virtual SOL reserve start at a tiny market cap (a few dollars) but are real
  // coins on the same curve (same 279.9M virtual token offset, same bonding point): about a fifth of all
  // trades. They used to be dropped here and never appeared anywhere. Only absurd readings are skipped now.
  if (!(mcSol > 0) || mcSol > 5e6 || sol > 5000) return;   // a 5,000 SOL trade on a curve is a misread event
  feed.trades++;
  let s = live.get(mint);
  if (!s) { s = { mint, first: now(), mc0: mcSol, ath: mcSol, buys: 0, sells: 0, vol: 0, traders: new Set(), hist: [] }; live.set(mint, s); }
  s.mc = mcSol; s.ath = Math.max(s.ath, mcSol); s.last = now(); s.side = buy ? "b" : "s";
  s.progress = Math.max(0, Math.min(1, 1 - rTok / INITIAL_REAL_TOKENS));
  // The curve's reserves after this trade, and the fee it charged (protocol + creator, in basis points),
  // so a buy or sell can be quoted exactly as the chain would fill it (quote.js).
  s.vSol = vSol; s.vTok = vTok; s.resT = now();
  if (buf.length >= 225) { const bps = Number(buf.readBigUInt64LE(161)) + Number(buf.readBigUInt64LE(209)); if (bps > 0 && bps < 1000) s.feeBps = bps; }
  buy ? s.buys++ : s.sells++;
  s.vol += sol;
  if (s.traders.size < 2000) s.traders.add(user);
  // a sample every ~10s for the 1-minute change
  if (!s.hist.length || now() - s.hist[s.hist.length - 1][0] > 10_000) { s.hist.push([now(), mcSol]); if (s.hist.length > 8) s.hist.shift(); }
  dirty.add(mint);
  // Listeners also get who traded, how many tokens and in which slot (holders.js builds balances from it).
  for (const fn of listeners) fn(mint, s, sol, buy, { user, tokens, slot });
}

// What a row needs, in USD.
export function liveStats(mint) {
  const s = live.get(mint);
  if (!s) return null;
  const usd = feed.solUsd;
  const ago = s.hist.find(([t]) => now() - t <= 70_000) || s.hist[0];
  return { mc: s.mc * usd, ath: s.ath * usd, buys: s.buys, sells: s.sells, vol: s.vol * usd, traders: s.traders.size,
    progress: s.progress, side: s.side, last: s.last, chg1m: ago ? (s.mc / ago[1] - 1) * 100 : null };
}

// Every coin still on the bonding curve that is at least `min` of the way there and traded in the last
// `quietMs`, closest to bonding first. This is the whole market (every pump.fun trade passes through here),
// not only the coins the radar decided to track.
export function closeToBonding(min = 0.5, quietMs = 10 * 60_000, limit = 80) {
  const out = [];
  for (const s of live.values()) if (s.progress >= min && s.progress < 0.995 && now() - s.last < quietMs) out.push(s);
  return out.sort((a, b) => b.progress - a.progress).slice(0, limit).map((s) => s.mint);
}

// Updates for the page since the last call, limited to coins someone is looking at.
export function drainUpdates(watched) {
  const out = [];
  for (const m of dirty) {
    if (watched.has(m)) {
      const x = liveStats(m);
      out.push([m, Math.round(x.mc), x.buys, x.sells, Math.round(x.vol), x.traders, +(x.progress ?? 0).toFixed(4), x.side, x.chg1m == null ? null : +x.chg1m.toFixed(1)]);
    }
  }
  dirty.clear();
  return out;
}

function connect() {
  const url = settings.rpcWsUrl?.trim() || (settings.rpcUrl?.trim() ? settings.rpcUrl.trim().replace(/^http/, "ws") : PUBLIC_WS);
  feed.url = url.replace(/api-key=[^&]+/, "api-key=…");
  let ws;
  try { ws = new WebSocket(url); } catch { return setTimeout(connect, 5000); }
  ws.onopen = () => {
    feed.connected = true;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "logsSubscribe", params: [{ mentions: [PUMP] }, { commitment: "processed" }] }));
  };
  ws.onmessage = (m) => {
    feed.lastMsg = now();
    const raw = typeof m.data === "string" ? m.data : "";
    // Cheap pre-filter: most messages carry several program logs; only parse those with event data.
    if (!raw.includes("Program data: ")) return;
    let d; try { d = JSON.parse(raw); } catch { return; }
    const slot = d.params?.result?.context?.slot ?? null;
    for (const l of d.params?.result?.value?.logs || []) {
      if (!l.startsWith("Program data: ")) continue;
      const buf = Buffer.from(l.slice(14), "base64");
      if (buf.length <= 8) continue;
      const disc = buf.toString("hex", 0, 8);
      if (disc === TRADE) onTrade(buf, slot);
      else if (disc === CREATE) onCreate(buf);
    }
  };
  ws.onclose = () => { feed.connected = false; setTimeout(connect, 3000); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  // Watchdog: a silent socket for 30s gets replaced.
  const dog = setInterval(() => { if (ws.readyState === 1 && now() - feed.lastMsg > 30_000) { clearInterval(dog); try { ws.close(); } catch {} } }, 10_000);
  ws.addEventListener("close", () => clearInterval(dog));
}

// The SOL price turns every SOL figure into dollars, so it must be real: Jupiter's price first, DexScreener's
// deepest USD pair as the backup. Until one answers it is retried every 15 seconds (it used to wait 5 minutes
// after a failed start, leaving every dollar figure on the 150 placeholder), then refreshed every minute.
async function solPrice() {
  let px = null;
  try {
    const j = await fetch("https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112", { signal: AbortSignal.timeout(6000) }).then((r) => r.json());
    px = +j["So11111111111111111111111111111111111111112"]?.usdPrice || null;
  } catch {}
  if (!(px > 0)) try {
    const j = await fetch("https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112", { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const best = (j.pairs || []).filter((p) => /USD/.test(p.quoteToken?.symbol || "") && p.baseToken?.symbol === "SOL").sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    px = +best?.priceUsd || null;
  } catch {}
  if (px > 10 && px < 10_000) { feed.solUsd = px; feed.solKnown = true; feed.solT = now(); setSolPrice(px); }
  setTimeout(solPrice, feed.solKnown && now() - feed.solT < 5 * 60_000 ? 60_000 : 15_000);
}

// The per-coin numbers only exist in memory, so a restart used to forget every coin's first price, high,
// traders and buy/sell counts. They are written to disk every 10 seconds and picked up again when the
// radar comes back within two minutes (a crash restart takes about two seconds).
const STATE_FILE = path.join(DATA, "live-state.json");
export const RESUME_MS = 2 * 60_000;
export const restored = { coins: 0, gapMs: null };
let saving = false;
async function saveState() {
  if (saving || !live.size) return;
  saving = true;
  try {
    const coins = [];
    for (const s of live.values()) if (now() - s.last < 30 * 60_000) coins.push({ ...s, traders: [...s.traders] });
    await fs.promises.writeFile(STATE_FILE + ".tmp", JSON.stringify({ t: now(), solUsd: feed.solUsd, coins }));
    await fs.promises.rename(STATE_FILE + ".tmp", STATE_FILE);
  } catch {} finally { saving = false; }
}
export function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!(now() - j.t < RESUME_MS)) return;
    for (const s of j.coins) live.set(s.mint, { ...s, traders: new Set(s.traders) });
    if (j.solUsd > 0 && j.solUsd !== 150) { feed.solUsd = j.solUsd; feed.solKnown = true; feed.solT = j.t; }
    restored.coins = live.size; restored.gapMs = now() - j.t;
  } catch {}
}

export function startLiveTrades() {
  loadState();
  setInterval(saveState, 10_000);
  connect();
  solPrice();
  setInterval(() => {
    feed.perSec = +((feed.trades - sent) / 5).toFixed(1); sent = feed.trades;
    // Forget coins that went quiet 20+ minutes ago.
    if (live.size > 4000) for (const [m, s] of live) if (now() - s.last > 20 * 60_000) live.delete(m);
  }, 5000);
}
