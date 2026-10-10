// Replay: everything the coin page needs to play a coin's last day back as if it were live (web/src/lib/replay.ts).
// Every trade the radar read from the chain for the coin in the journal's window (journal.js keeps a day), oldest
// first, with who made it, and the SOL price through that window, so the page can rebuild the chart, the trade
// list, the holders and traders, the market cap and paper fills at any moment of it.
import { db } from "./db.js";
import * as journal from "./journal.js";
import { pumpTrades } from "./replaywallets.js";

const MAX_TRADES = 80_000;   // a very busy coin's day; past this the oldest are left out (the replay starts later)
const solQ = db.prepare("SELECT t, px FROM j_sol WHERE t >= ? ORDER BY t");
// The coin's first PumpSwap trade in the window: when it left the curve (at or before the window's start if its
// first trade there was already in the pool).
const bondQ = db.prepare(`SELECT min(t) t FROM j_trades WHERE mid = ? AND t >= ? AND venue = ${journal.VENUE.pumpswap}`);
const curveQ = db.prepare(`SELECT 1 FROM j_trades WHERE mid = ? AND t >= ? AND venue = ${journal.VENUE.curve} LIMIT 1`);

// GET /api/replay/<mint>: { mint, t0, t1, trades: [[ms, mcUsd, usd, buy 1|0, wallet index or -1]], wallets: [address],
// sol: [[ms, usd]] }. Trades journaled before wallets were kept (2026-10-09) carry -1.
export function replayData(mint) {
  const from = Date.now() - journal.KEEP_MS;
  let rows = journal.tradesWithWallets(mint, from).filter((x) => x.mc > 0);
  if (rows.length > MAX_TRADES) rows = rows.slice(-MAX_TRADES);
  const r2 = (n) => Math.round(n * 100) / 100;
  const wallets = [], at = new Map();
  const wi = (w) => { if (!w) return -1; let i = at.get(w); if (i == null) { i = wallets.length; wallets.push(w); at.set(w, i); } return i; };
  // Trades journaled before wallets were kept: the wallet of the matching pump.fun trade (replaywallets.js reads
  // them in the background; the page asks again until `walletsDone`). Same side, within 3 s, the nearest size.
  let pf = null;
  const known = rows.filter((x) => x.w).length;
  if (rows.length && known < rows.length * 0.98) {
    let until = 0;
    for (const x of rows) if (!x.w) until = x.t;
    pf = pumpTrades(mint, rows[0].t - 60_000, until + 5000);
    const pt = pf.trades, used = new Uint8Array(pt.length);
    let lo = 0;
    for (const x of rows) {
      if (x.w) continue;
      while (lo < pt.length && pt[lo][0] < x.t - 3000) lo++;
      let best = -1, bestD = 0.12;
      for (let k = lo; k < pt.length && pt[k][0] <= x.t + 3000; k++) {
        if (used[k] || pt[k][4] !== (x.buy ? 1 : 0)) continue;
        const d = Math.abs(pt[k][3] - x.usd) / Math.max(0.01, x.usd);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best >= 0) { used[best] = 1; x.w = pf.wallets[pt[best][1]]; }
    }
  }
  // SOL's price a minute apart is plenty for turning dollars into SOL.
  const sol = [];
  for (const x of solQ.all(from - 3600e3)) if (!sol.length || x.t - sol[sol.length - 1][0] >= 60_000) sol.push([x.t, r2(x.px)]);
  return {
    mint, t0: rows[0]?.t ?? null, t1: rows[rows.length - 1]?.t ?? null, keepHours: journal.KEEP_MS / 3600e3,
    trades: rows.map((x) => [x.t, r2(x.mc), r2(x.usd), x.buy ? 1 : 0, wi(x.w)]), wallets, sol,
    walletsDone: !pf || pf.done, walletsBack: pf?.oldest ?? null, ...(() => { const mid = journal.midOf(mint, false); return mid == null ? {} : { bondedAt: bondQ.get(mid, from)?.t ?? null, curve: !!curveQ.get(mid, from) }; })(),
  };
}

// GET /api/replay/peaks?m=a,b,…: for the Practice list, each coin's all-time high and market cap now, and how many
// trades the journal holds for its day (what Practice can replay): { <mint>: { ath, athAt, mc, n, lastAt, partial } }. Coins the
// journal never saw are left out. The day's high is the highest trade that a second trade within a minute came close
// to (25%), so one misread trade can't set it; the radar's own peak (tokens.peak_mcap, kept since it first saw the
// coin) covers older highs and stretches the journal missed; tokens.mcap is the live figure.
const peakQ = db.prepare("SELECT t, mc FROM j_trades WHERE mid = ? AND t >= ? AND mc > 0 ORDER BY t");
const tokQ = db.prepare("SELECT mcap, peak_mcap, price_t FROM tokens WHERE mint = ?");
const peakKept = new Map();   // mint -> [at, answer]: lists ask every 30 s, a busy coin's day is tens of thousands of rows
export function replayPeaks(mints) {
  const from = Date.now() - journal.KEEP_MS, out = {};
  for (const [m, [at]] of peakKept) if (at < Date.now() - 20_000) peakKept.delete(m);
  for (const m of mints.slice(0, 60)) {
    const had = peakKept.get(m);
    if (had) { if (had[1]) out[m] = had[1]; continue; }
    peakKept.set(m, [Date.now(), null]);
    const mid = journal.midOf(m, false);
    if (mid == null) continue;
    const rows = peakQ.all(mid, from);
    if (!rows.length) continue;
    let ath = 0, athAt = null, lo = 0;
    for (let i = 0; i < rows.length; i++) {
      const x = rows[i];
      if (x.mc <= ath) continue;
      while (rows[lo].t < x.t - 60_000) lo++;
      let ok = false;
      for (let k = lo; k < rows.length && rows[k].t <= x.t + 60_000 && !ok; k++) if (k !== i && rows[k].mc >= x.mc * 0.75) ok = true;
      if (ok || rows.length === 1) { ath = x.mc; athAt = x.t; }
    }
    const last = rows[rows.length - 1], tok = tokQ.get(m);
    const mc = tok?.mcap > 0 && (tok.price_t || 0) > last.t ? tok.mcap : last.mc;
    if (tok?.peak_mcap > ath * 1.02) { ath = tok.peak_mcap; athAt = null; }
    if (mc > ath) { ath = mc; athAt = Date.now(); }
    // partial: the journal stopped hearing the coin while it kept trading (a PumpSwap pool quoted in another token
    // is not read, so such a coin's day ends where it left the curve): its replay would stop there.
    const partial = (tok?.price_t || 0) - last.t > 15 * 60e3;
    out[m] = { ath: Math.round(ath), athAt, mc: Math.round(mc), n: rows.length, lastAt: last.t, partial };
    peakKept.set(m, [Date.now(), out[m]]);
  }
  return out;
}
