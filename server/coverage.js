// Coverage: no coin that starts running goes unseen.
//
// The Pulse columns each hold a slice of the market: New pairs the newest ~2 minutes of launches, Final
// stretch the coins at 50%+ of the curve, Migrated the bonded ones. A coin that wakes up ten minutes after
// launch at 20% of the curve fell between them (measured 2026-10-02: 19 of 79 actively traded coins in
// 3 minutes never appeared anywhere, one with 141 trades and 48 SOL). This keeps a rolling 5-minute window
// of every pump.fun trade on the live feed and ranks every coin that is actually moving, whatever its age
// or curve position.
import { onLiveTrade, live, feed, createStats } from "./livetrades.js";
import { launchFeeds } from "./engine.js";

const WINDOW = 5 * 60_000;
const now = () => Date.now();
const recent = new Map();    // mint -> [[t, sol, buy, user], ...] for the last 5 minutes

function onTrade(mint, s, sol, buy, x) {
  let a = recent.get(mint);
  if (!a) { a = []; recent.set(mint, a); }
  a.push([now(), sol, buy, x?.user || null]);
  if (a.length > 600) a.splice(0, a.length - 600);
}

function trim() {
  const cut = now() - WINDOW;
  for (const [m, a] of recent) {
    let i = 0;
    while (i < a.length && a[i][0] < cut) i++;
    if (i) a.splice(0, i);
    if (!a.length) recent.delete(m);
  }
}

// What a coin did in the last 5 minutes.
export function windowStats(mint) {
  const a = recent.get(mint);
  if (!a?.length) return null;
  let buySol = 0, sellSol = 0, buys = 0;
  const users = new Set();
  for (const [, sol, buy, user] of a) { buy ? (buySol += sol, buys++) : (sellSol += sol); if (user) users.add(user); }
  const s = live.get(mint);
  const then = s?.hist?.find(([t]) => now() - t <= WINDOW) || s?.hist?.[0];
  return { trades: a.length, buys, sells: a.length - buys, traders: users.size, buySol, sellSol, netSol: buySol - sellSol,
    chg: then && s?.mc ? (s.mc / then[1] - 1) * 100 : null, last: a[a.length - 1][0] };
}

// Moving = real demand in the last 5 minutes, not one wallet looping trades and not dust bots (dozens of
// wallets trading 0.0001 SOL each): 10+ trades from 6+ different wallets with at least half a SOL traded,
// or 3+ SOL of net buying.
const moving = (w) => (w.trades >= 10 && w.traders >= 6 && w.buySol + w.sellSol >= 0.5) || w.netSol >= 3;
const heat = (w) => w.traders * 2 + w.netSol * 3 + w.trades * 0.3 + Math.max(0, Math.min(w.chg ?? 0, 300)) * 0.1;

// Every coin moving right now, hottest first. `exclude` = mints already shown elsewhere (they are still
// counted, just not returned).
export function runners({ limit = 80, exclude = null } = {}) {
  const out = [];
  for (const m of recent.keys()) {
    const w = windowStats(m);
    if (!w || !moving(w) || exclude?.has(m)) continue;
    out.push({ mint: m, ...w, heat: Math.round(heat(w)) });
  }
  return out.sort((a, b) => b.heat - a.heat).slice(0, limit);
}

// How complete the radar's view is, for the Health page.
export function coverageStats() {
  let moved = 0;
  for (const m of recent.keys()) { const w = windowStats(m); if (w && moving(w)) moved++; }
  return { trading5m: recent.size, moving5m: moved, launches: { ...launchFeeds }, chainCreates: createStats.seen, createDecodeFailures: createStats.failed, feedConnected: feed.connected };
}

let started = false;
export function startCoverage() {
  if (started) return;
  started = true;
  onLiveTrade(onTrade);
  setInterval(trim, 10_000);
}
