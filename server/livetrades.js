// Live pump.fun trade feed, free: subscribe to the pump.fun program's logs over a Solana RPC websocket
// (the public one works, ~50 trades/s) and decode each TradeEvent (mint, SOL size, side, trader,
// virtual + real reserves). From that every coin on the bonding curve gets a live market cap, exact
// bonding progress, buys/sells, volume and trader count, pushed to the Pulse page as they happen.
import { settings } from "./settings.js";
import { setSolPrice } from "./research.js";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const TRADE = "bddb7fd34ee661ee";           // anchor discriminator of pump.fun's TradeEvent
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
export const feed = { connected: false, trades: 0, perSec: 0, solUsd: 150, since: now(), lastMsg: 0, url: null };
let sent = 0;

function onTrade(buf) {
  if (buf.length < 8 + 32 + 8 + 8 + 1 + 32 + 8 + 8 + 8 + 8 + 8) return;
  let o = 8;
  const mint = b58(buf.subarray(o, o += 32));
  const sol = Number(buf.readBigUInt64LE(o)) / 1e9; o += 8;
  o += 8;                                            // token amount
  const buy = buf[o] === 1; o += 1;
  const user = b58(buf.subarray(o, o += 32));
  o += 8;                                            // timestamp
  const vSol = Number(buf.readBigUInt64LE(o)) / 1e9; o += 8;
  const vTok = Number(buf.readBigUInt64LE(o)) / 1e6; o += 8;
  o += 8;                                            // real SOL reserves
  const rTok = Number(buf.readBigUInt64LE(o)) / 1e6;
  if (!vTok) return;
  const mcSol = (vSol / vTok) * 1e9;                 // 1B supply
  if (mcSol < 20 || mcSol > 5e6) return;             // other curve variants: skip rather than show nonsense
  feed.trades++;
  let s = live.get(mint);
  if (!s) { s = { mint, first: now(), mc0: mcSol, ath: mcSol, buys: 0, sells: 0, vol: 0, traders: new Set(), hist: [] }; live.set(mint, s); }
  s.mc = mcSol; s.ath = Math.max(s.ath, mcSol); s.last = now(); s.side = buy ? "b" : "s";
  s.progress = Math.max(0, Math.min(1, 1 - rTok / INITIAL_REAL_TOKENS));
  buy ? s.buys++ : s.sells++;
  s.vol += sol;
  if (s.traders.size < 2000) s.traders.add(user);
  // a sample every ~10s for the 1-minute change
  if (!s.hist.length || now() - s.hist[s.hist.length - 1][0] > 10_000) { s.hist.push([now(), mcSol]); if (s.hist.length > 8) s.hist.shift(); }
  dirty.add(mint);
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
    for (const l of d.params?.result?.value?.logs || []) {
      if (!l.startsWith("Program data: ")) continue;
      const buf = Buffer.from(l.slice(14), "base64");
      if (buf.length > 8 && buf.toString("hex", 0, 8) === TRADE) onTrade(buf);
    }
  };
  ws.onclose = () => { feed.connected = false; setTimeout(connect, 3000); };
  ws.onerror = () => { try { ws.close(); } catch {} };
  // Watchdog: a silent socket for 30s gets replaced.
  const dog = setInterval(() => { if (ws.readyState === 1 && now() - feed.lastMsg > 30_000) { clearInterval(dog); try { ws.close(); } catch {} } }, 10_000);
  ws.addEventListener("close", () => clearInterval(dog));
}

async function solPrice() {
  try {
    const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112", { signal: AbortSignal.timeout(10_000) });
    const j = await r.json();
    const best = (j.pairs || []).filter((p) => /USD/.test(p.quoteToken?.symbol || "") && p.baseToken?.symbol === "SOL").sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (best?.priceUsd) { feed.solUsd = +best.priceUsd; setSolPrice(feed.solUsd); }
  } catch {}
}

export function startLiveTrades() {
  connect();
  solPrice();
  setInterval(solPrice, 5 * 60_000);
  setInterval(() => {
    feed.perSec = +((feed.trades - sent) / 5).toFixed(1); sent = feed.trades;
    // Forget coins that went quiet 20+ minutes ago.
    if (live.size > 4000) for (const [m, s] of live) if (now() - s.last > 20 * 60_000) live.delete(m);
  }, 5000);
}
