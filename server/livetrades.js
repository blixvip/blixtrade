// Live pump.fun trade feed, free: subscribe to the pump.fun program's logs over a Solana RPC websocket
// (the public one works, ~50 trades/s) and decode each TradeEvent (mint, SOL size, side, trader,
// virtual + real reserves). From that every coin on the bonding curve gets a live market cap, exact
// bonding progress, buys/sells, volume and trader count, pushed to the Pulse page as they happen.
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./db.js";
import { settings } from "./settings.js";
import { setSolPrice } from "./research.js";
import { jupiterGet } from "./jupiter.js";
import { startRpcStream } from "./rpc-stream.js";
import { quotedTrade, setLocalPrice } from "./pumpquote.js";
import { noteSlot, behindOf } from "./feedlag.js";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const TRADE = "bddb7fd34ee661ee";           // anchor discriminator of pump.fun's TradeEvent
const CREATE = "1b72a94ddeeb6376";          // ... and of its CreateEvent (name, symbol, uri, mint, curve, user)
const INITIAL_REAL_TOKENS = 793_100_000;     // tokens sold along the curve before it completes
// Without a key, each (re)connection takes the next public websocket in turn: the two feeds spread over two
// endpoints, and one that cuts us off ("data allowance" per IP per 30 s at tonight's volume, 2026-10-07)
// is left to rest while the other carries the feed.
// The first is preferred (publicnode trails the chain by 30-40 slots at busy hours); a reconnection soon
// after the last one handed out means that endpoint failed, so the next one is tried, and after a minute
// the preferred one is tried again.
const PUBLIC_WS_POOL = ["wss://api.mainnet-beta.solana.com", "wss://solana-rpc.publicnode.com"];
let wsLast = { i: 0, t: 0 };
function publicWs() {
  const t = now(), since = t - wsLast.t;
  // Several feeds connecting together at a start share the same endpoint; a reconnection within a minute of
  // the last handout moves on; after that, back to the preferred one.
  const i = since < 2000 ? wsLast.i : since < 60_000 ? (wsLast.i + 1) % PUBLIC_WS_POOL.length : 0;
  wsLast = { i, t };
  return PUBLIC_WS_POOL[i];
}
export const rpcWsUrl = () => settings.rpcWsUrl?.trim() || (settings.rpcUrl?.trim() ? settings.rpcUrl.trim().replace(/^http/, "ws") : publicWs());
// The twin feeds: the same program's logs on the OTHER public endpoint at the same time. Each free node drops
// notifications at random and says nothing (2026-10-09: publicnode's stream had 168 trades in one minute that
// the journal lacked); the first copy of a transaction counts, the second is dropped (sigGate). On logs this costs
// ~25x less of an endpoint's allowance per trade than reading whole blocks (blockworker.js). Off with a key set
// (one paid endpoint is whole) or settings.twinFeeds = false.
export const twinOn = () => settings.twinFeeds !== false && !settings.rpcWsUrl?.trim() && !settings.rpcUrl?.trim();
// The endpoint the main feed is NOT on (the same node drops the same notifications, so a twin there adds nothing).
export const twinOf = (main) => PUBLIC_WS_POOL.find((u) => u !== main) || PUBLIC_WS_POOL[1];
// A twin stream that keeps to the other endpoint: started, and started again on the other one whenever the main
// feed has moved onto its endpoint (checked every 10 s).
export function startTwin(stats, mainUrl, request, onEvent) {
  let stop = null;
  const go = () => { stop = startRpcStream({ url: () => (stats.url = twinOf(mainUrl())), request, onStatus: ({ connected }) => { stats.connected = connected; }, onEvent: (d) => { stats.msgs++; stats.lastMsg = now(); onEvent(d); } }); };
  go();
  setInterval(() => { if (stats.url && mainUrl() === stats.url) { stats.moved = (stats.moved || 0) + 1; try { stop?.(); } catch {} go(); } }, 10_000).unref?.();
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const now = () => Date.now();

// Base-256 to base-58 a byte at a time in small integers: six times faster than the BigInt way (43 ms vs 265 ms
// for 10K keys), and it runs for every trade decoded and every holder account read. Same output.
export function b58(buf) {
  let zeros = 0;
  while (zeros < buf.length && buf[zeros] === 0) zeros++;
  const d = new Uint8Array(((buf.length * 138) / 100 + 1) | 0);
  let len = 0;
  for (let i = zeros; i < buf.length; i++) {
    let c = buf[i];
    for (let j = 0; j < len; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; }
    while (c > 0) { d[len++] = c % 58; c = (c / 58) | 0; }
  }
  let s = "1".repeat(zeros);
  for (let j = len - 1; j >= 0; j--) s += B58[d[j]];
  return s;
}

export const live = new Map();   // mint -> stats
const dirty = new Set();
export const feed = { connected: false, trades: 0, perSec: 0, solUsd: 150, solKnown: false, solT: 0, since: now(), lastMsg: 0, url: null };
let sent = 0;
// Other parts of the radar can follow every trade as it lands (the early radar does).
const listeners = [];
export const onLiveTrade = (fn) => listeners.push(fn);
// fn(mint, s, sol, buy, { user, tokens, slot, sig }) for every PumpSwap pool trade of a bonded coin (recordPoolTrade):
// the holder ledger follows a coin into its pool on these, where the curve listeners above never look.
const poolListeners = [];
export const onPoolLedger = (fn) => poolListeners.push(fn);
// Every coin created on pump.fun, straight from the chain. PumpPortal (the launch feed) drops about one
// launch in seven (measured 2026-10-02: 18 of 129 in 150s), so the engine fills its gaps from here.
const createListeners = [];
export const onLiveCreate = (fn) => createListeners.push(fn);
export const createStats = { seen: 0, failed: 0 };
// A launch decoded by another launchpad's feed joins the same stream (it carries its own `pool` and `source`).
export const announceCreate = (c) => { for (const fn of createListeners) fn(c); };
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

function onTrade(buf, slot = null, sig = null) {
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
  // A curve quoted in another token (USDC, a stock token, another coin): priced in pumpquote.js, as SOL-equivalents.
  if (!vSol) {
    const q = quotedTrade(buf, feed.solUsd);
    if (q?.pending) return "pending";
    if (q) recordTrade({ mint, sol: q.sol, tokens, buy, user, mcSol: q.mcSol, progress: 1 - rTok / INITIAL_REAL_TOKENS, vSol: q.vSol, vTok, feeBps: null, slot, sig });
    return;
  }
  const mcSol = (vSol / vTok) * 1e9;                 // 1B supply
  // Coins created with a smaller virtual SOL reserve start at a tiny market cap (a few dollars) but are real
  // coins on the same curve (same 279.9M virtual token offset, same bonding point): about a fifth of all
  // trades. They used to be dropped here and never appeared anywhere. Only absurd readings are skipped now.
  // The fee it charged (protocol + creator, in basis points), so a buy or sell can be quoted exactly (quote.js).
  let feeBps = null;
  if (buf.length >= 225) { const bps = Number(buf.readBigUInt64LE(161)) + Number(buf.readBigUInt64LE(209)); if (bps > 0 && bps < 1000) feeBps = bps; }
  recordTrade({ mint, sol, tokens, buy, user, mcSol, progress: 1 - rTok / INITIAL_REAL_TOKENS, vSol, vTok, feeBps, slot, sig });
}

// One trade on a bonding curve, from whichever launchpad feed decoded it (pump.fun here, LaunchLab in
// launchlab.js). `user` is null when the feed does not say who traded; `pad` names a launchpad other than pump.fun.
export function recordTrade({ mint, sol, tokens, buy, user, mcSol, progress, vSol, vTok, feeBps, slot, pad, sig = null }) {
  if (!(mcSol > 0) || mcSol > 5e6 || sol > 5000) return;   // a 5,000 SOL trade on a curve is a misread event
  feed.trades++;
  let s = live.get(mint);
  if (!s) { s = { mint, first: now(), mc0: mcSol, ath: mcSol, buys: 0, sells: 0, vol: 0, traders: new Set(), hist: [] }; if (pad) s.pad = pad; live.set(mint, s); }
  s.mc = mcSol; s.ath = Math.max(s.ath, mcSol); s.last = now(); s.side = buy ? "b" : "s";
  s.progress = Math.max(0, Math.min(1, progress));
  // The curve's reserves after this trade, so a buy or sell can be quoted as the chain would fill it.
  s.vSol = vSol; s.vTok = vTok; s.resT = now();
  if (feeBps) s.feeBps = feeBps;
  buy ? s.buys++ : s.sells++;
  s.vol += sol;
  if (user && s.traders.size < 2000) s.traders.add(user);
  // a sample every ~10s for the 1-minute change
  if (!s.hist.length || now() - s.hist[s.hist.length - 1][0] > 10_000) { s.hist.push([now(), mcSol]); if (s.hist.length > 8) s.hist.shift(); }
  dirty.add(mint);
  // Listeners also get who traded, how many tokens, in which slot and transaction (holders.js builds balances from it).
  for (const fn of listeners) fn(mint, s, sol, buy, { user, tokens, slot, sig });
}

// A bonded coin's trade in its PumpSwap pool (pumpswap.js), kept on the same per-coin stats as its curve trades
// were: buys, sells, volume and traders carry on from the curve's figures, the market cap and the pool's depth
// move with every trade, and the row goes out on the next 100 ms push like any curve coin's. Before this a
// bonded coin's counts came from DexScreener (half a minute old) and its holders from RugCheck (minutes).
export function recordPoolTrade(mint, { mcSol, sol, tokens, buy, user, slot, sig, depth }) {
  if (!(mcSol > 0) || !(sol >= 0) || sol > 50_000) return;
  let s = live.get(mint);
  if (!s) { s = { mint, first: now(), mc0: mcSol, ath: mcSol, buys: 0, sells: 0, vol: 0, traders: new Set(), hist: [] }; live.set(mint, s); }
  s.mc = mcSol; s.ath = Math.max(s.ath, mcSol); s.last = now(); s.side = buy ? "b" : "s";
  s.progress = 1; s.pool = true;
  if (depth > 0) s.depth = depth;
  buy ? s.buys++ : s.sells++;
  s.vol += sol;
  if (user && s.traders.size < 2000) s.traders.add(user);
  if (!s.hist.length || now() - s.hist[s.hist.length - 1][0] > 10_000) { s.hist.push([now(), mcSol]); if (s.hist.length > 8) s.hist.shift(); }
  dirty.add(mint);
  for (const fn of poolListeners) fn(mint, s, sol, buy, { user, tokens, slot, sig });
}

// Liquidity (USD, both sides) of a standard pump.fun curve at a market cap, when no trade has been seen: the curve's
// constant product is fixed (30 virtual SOL × 1.073B virtual tokens), so the virtual SOL reserve is sqrt(k × cap).
const CURVE_K = 30 * 1.073e9;
export function curveLiqUsd(mcapUsd, usd = feed.solUsd) {
  const mcSol = mcapUsd / usd;
  if (!(mcSol > 0) || !(usd > 0)) return null;
  return 2 * Math.sqrt((CURVE_K * mcSol) / 1e9) * usd;
}

// What a row needs, in USD. `liq`: both sides of the pool, the way DexScreener and Axiom count it (on the curve
// the virtual SOL reserve, as /api/sparks already shows it; in a PumpSwap pool its SOL side), or null when unknown.
export function liveStats(mint) {
  const s = live.get(mint);
  if (!s) return null;
  const usd = feed.solUsd;
  const ago = s.hist.find(([t]) => now() - t <= 70_000) || s.hist[0];
  const liq = s.pool ? (s.depth > 0 ? 2 * s.depth * usd : null) : s.vSol > 0 ? 2 * s.vSol * usd : null;
  return { mc: s.mc * usd, ath: s.ath * usd, buys: s.buys, sells: s.sells, vol: s.vol * usd, traders: s.traders.size,
    progress: s.progress, side: s.side, last: s.last, chg1m: ago ? (s.mc / ago[1] - 1) * 100 : null, liq, pool: Boolean(s.pool) };
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
      out.push([m, Math.round(x.mc), x.buys, x.sells, Math.round(x.vol), x.traders, +(x.progress ?? 0).toFixed(4), x.side, x.chg1m == null ? null : +x.chg1m.toFixed(1), x.liq == null ? null : Math.round(x.liq)]);
    }
  }
  dirty.clear();
  return out;
}

// A transaction can arrive on more than one feed (the program's whole log stream and an open chart's own
// stream, chartstream.js): the first copy counts, later ones are dropped. One gate per decoder; signatures
// are remembered for the last ~`max`-to-2×`max` transactions.
export function sigGate(max = 100_000) {
  let cur = new Set(), old = new Set();
  const gate = (sig) => {
    if (!sig) return true;
    if (cur.has(sig) || old.has(sig)) return false;
    cur.add(sig);
    if (cur.size >= max) { old = cur; cur = new Set(); }
    return true;
  };
  gate.has = (sig) => cur.has(sig) || old.has(sig);   // asked without counting it as heard
  gate.forget = (sig) => { cur.delete(sig); old.delete(sig); };
  return gate;
}
const firstPump = sigGate();
// Whether a pump.fun transaction came on a live stream (journalfeed.js's sweep reads only the ones that did not).
export const pumpHeard = (sig) => firstPump.has(sig);
// A pump.fun coin as another curve's quote token: its live price in dollars (curve market cap on 1B tokens).
setLocalPrice((mint) => { const s = live.get(mint); return s && s.mc > 0 && feed.solUsd > 0 && Date.now() - s.last < 10 * 60_000 ? (s.mc * feed.solUsd) / 1e9 : null; });
export const dupes = { pump: 0 };
// The twin feed's own figures: messages, and trades it carried first (the main feed had skipped them, or not yet).
export const twin = { pump: { connected: false, msgs: 0, first: 0, lastMsg: 0 }, swap: { connected: false, msgs: 0, first: 0, lastMsg: 0 } };

// One logs notification's value ({ signature, err, logs }). A failed transaction's logs can still carry
// events from before it failed; nothing it says happened, so it is skipped whole.
export function pumpLogs(v, slot = null, src = null) {
  if (!v || v.err) return;
  if (!firstPump(v.signature)) { dupes.pump++; return; }
  if (src === "twin") twin.pump.first++;
  let pending = null;
  for (const l of v.logs || []) {
    if (!l.startsWith("Program data: ")) continue;
    const buf = Buffer.from(l.slice(14), "base64");
    if (buf.length <= 8) continue;
    const disc = buf.toString("hex", 0, 8);
    if (disc === TRADE) { if (onTrade(buf, slot, v.signature || null) === "pending") pending = true; else if (pending !== true) pending = false; }
    else if (disc === CREATE) onCreate(buf);
  }
  // A trade on a curve whose quote token has no price yet, and nothing else read from it: the transaction is left
  // unheard, so the sweep (journalfeed.js) reads it again once the price is in.
  if (pending === true) firstPump.forget(v.signature);
}

function connect() {
  startRpcStream({
    url: () => (feed.url = rpcWsUrl()),
    request: { method: "logsSubscribe", params: [{ mentions: [PUMP] }, { commitment: "processed" }] },
    behind: () => behindOf("pump"),   // minutes of queued logs are dropped for a fresh subscription (rpc-stream.js)
    onStatus: ({ connected, error }) => { feed.connected = connected; feed.lastError = error; if (connected) feed.lastMsg = now(); },
    onEvent: (d) => {
      feed.lastMsg = now();
      noteSlot("pump", d.params?.result?.context?.slot);
      pumpLogs(d.params?.result?.value, d.params?.result?.context?.slot ?? null);
    },
  });
  if (!twinOn()) return;
  startTwin(twin.pump, () => feed.url, { method: "logsSubscribe", params: [{ mentions: [PUMP] }, { commitment: "processed" }] }, (d) => {
    noteSlot("pump-twin", d.params?.result?.context?.slot);
    pumpLogs(d.params?.result?.value, d.params?.result?.context?.slot ?? null, "twin");
  });
}

// The SOL price turns every SOL figure into dollars, so it must be real: Jupiter's price first, DexScreener's
// deepest USD pair as the backup. Until one answers it is retried every 15 seconds (it used to wait 5 minutes
// after a failed start, leaving every dollar figure on the 150 placeholder), then refreshed every minute.
async function solPrice() {
  let px = null;
  try {
    const j = await jupiterGet("/price/v3?ids=So11111111111111111111111111111111111111112", { timeout: 6000, cacheMs: 30_000 });
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
    // Written a few coins at a time (as holders.js does): stringifying every coin and its traders in one go
    // held the radar up on every save.
    const coins = [], t = now();
    let n = 0;
    for (const s of live.values()) {
      if (t - s.last >= 30 * 60_000) continue;
      coins.push(JSON.stringify({ ...s, traders: [...s.traders] }));
      if (++n % 100 === 0) await new Promise((go) => setImmediate(go));
    }
    await fs.promises.writeFile(STATE_FILE + ".tmp", `{"t":${t},"solUsd":${JSON.stringify(feed.solUsd)},"coins":[${coins.join(",")}]}`);
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
