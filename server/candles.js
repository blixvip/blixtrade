// Candles for the coin chart, in market cap (USD), from real trades.
//
// Coins on the pump.fun curve: built here from every trade on the live feed, in 1-second buckets (only
// seconds with a trade are stored) for about the last hour of trading (exact: each trade's price is the
// curve's own price after it). Anything older, and every
// bonded coin, comes from GeckoTerminal's OHLCV for the coin's busiest pool (free, cached a minute).
// A coin that bonded minutes ago has neither (GeckoTerminal takes a while to chart a new pool), so the
// pool prices the Pulse reads every 2 s are kept as price-only candles until it does.
import fs from "node:fs";
import path from "node:path";
import { onLiveTrade, feed } from "./livetrades.js";
import { db, DATA } from "./db.js";
import { gtGet } from "./gtgate.js";
import { jupCandles } from "./jup.js";

const now = () => Date.now();
const STEP = 1;                       // seconds per stored bucket: the chart's finest candle
const KEEP = 3600;                    // buckets per coin (an hour of non-stop trading; far longer for most coins)
const book = new Map();               // mint -> { b: [[t, o, h, l, c, vUsd, buys, sells], ...], last }

function onTrade(mint, s, sol) {
  const mc = s.mc * feed.solUsd;
  if (!(mc > 0)) return;
  const t = Math.floor(now() / 1000 / STEP) * STEP;
  let e = book.get(mint);
  if (!e) { e = { b: [] }; book.set(mint, e); }
  const last = e.b[e.b.length - 1];
  const vol = sol * feed.solUsd;
  if (last && last[0] === t) { last[2] = Math.max(last[2], mc); last[3] = Math.min(last[3], mc); last[4] = mc; last[5] += vol; s.side === "b" ? last[6]++ : last[7]++; }
  else {
    // A new bucket opens at the previous close, so candles join up like a real chart.
    const o = last ? last[4] : mc;
    e.b.push([t, o, Math.max(o, mc), Math.min(o, mc), mc, vol, s.side === "b" ? 1 : 0, s.side === "b" ? 0 : 1]);
    if (e.b.length > KEEP) e.b.splice(0, e.b.length - KEEP);
  }
  e.last = now();
}

// ---------- bonded coins: price snapshots until GeckoTerminal charts the pool ----------
// pulse.js calls this with every pool price it reads (Jupiter, else DexScreener). No volume: these are
// prices, not trades, and the chart's volume pane shows nothing for them.
const ticks = new Map();              // mint -> { b: [[t, o, h, l, c], ...], last }
export function priceTick(mint, mc) {
  if (!(mc > 0)) return;
  const t = Math.floor(now() / 1000 / STEP) * STEP;
  let e = ticks.get(mint);
  if (!e) { e = { b: [] }; ticks.set(mint, e); }
  const last = e.b[e.b.length - 1];
  if (last && last[0] === t) { last[2] = Math.max(last[2], mc); last[3] = Math.min(last[3], mc); last[4] = mc; }
  else {
    const o = last ? last[4] : mc;
    e.b.push([t, o, Math.max(o, mc), Math.min(o, mc), mc]);
    if (e.b.length > KEEP) e.b.splice(0, e.b.length - KEEP);
  }
  e.last = now();
}

function prune() {
  for (const map of [book, ticks]) {
    for (const [m, e] of map) if (now() - e.last > 30 * 60_000) map.delete(m);
    if (map.size > 4000) [...map.entries()].sort((a, b) => a[1].last - b[1].last).slice(0, map.size - 3000).forEach(([m]) => map.delete(m));
  }
}

// Merge stored 1s buckets into `tf`-second candles.
function fromBook(mint, tf, map = book) {
  const e = map.get(mint);
  if (!e) return [];
  const out = [];
  for (const [t, o, h, l, c, v = 0, b = 0, s = 0] of e.b) {
    const k = Math.floor(t / tf) * tf, cur = out[out.length - 1];
    if (cur && cur.time === k) { cur.high = Math.max(cur.high, h); cur.low = Math.min(cur.low, l); cur.close = c; cur.value += v; cur.buys += b; cur.sells += s; }
    else out.push({ time: k, open: o, high: h, low: l, close: c, value: v, buys: b, sells: s });
  }
  return out;
}

// ---------- GeckoTerminal history ----------
const pools = new Map();     // mint -> { pool, t }
const hist = new Map();      // `${mint}:${tf}` -> { rows, t }
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const GT_TF = { 60: ["minute", 1], 300: ["minute", 5], 900: ["minute", 15], 3600: ["hour", 1] };
// Through the page gate (gtgate.js), so the chart shares the one GeckoTerminal allowance with discovery and
// gives way to it. One request per address at a time.
const inflight = new Map();
function gecko(url) {
  if (!inflight.has(url)) inflight.set(url, gtGet(url, { timeout: 8000, rank: "high" }).finally(() => inflight.delete(url)));
  return inflight.get(url);
}
async function poolOf(mint) {
  const c = pools.get(mint);
  // A pool found is kept 30 minutes; "no pool yet" only 1 (a just-bonded coin's pool appears within minutes).
  if (c && now() - c.t < (c.pool ? 30 : 1) * 60_000) return c.pool;
  const j = await gecko(`${GT}/tokens/${mint}/pools?page=1`);
  const best = (j.data || []).sort((a, b) => (+b.attributes?.reserve_in_usd || 0) - (+a.attributes?.reserve_in_usd || 0))[0];
  const pool = best?.attributes?.address || null;
  pools.set(mint, { pool, t: now() });
  if (pools.size > 2000) for (const [k, v] of pools) if (now() - v.t > 30 * 60_000) pools.delete(k);
  return pool;
}
// Price to market cap: the radar's own reading if it has one, else pump.fun's fixed 1B supply.
function supplyOf(mint) {
  const t = db.prepare("SELECT price, mcap FROM tokens WHERE mint = ?").get(mint);
  return t?.price > 0 && t?.mcap > 0 ? t.mcap / t.price : 1e9;
}
// `ttl`: how long an answer is reused. A minute normally; five when the feed or pool prices already draw the
// newest candles, so the history only needs an occasional refresh.
async function geckoCandles(mint, tf, ttl = 60_000) {
  const g = GT_TF[tf] || GT_TF[60];
  const key = `${mint}:${tf}`, c = hist.get(key);
  if (c && now() - c.t < (c.rows.length ? ttl : 60_000)) return c.rows;   // "nothing yet" is asked again in a minute
  const pool = await poolOf(mint);
  if (!pool) { hist.set(key, { rows: [], t: now() }); return []; }
  const j = await gecko(`${GT}/pools/${pool}/ohlcv/${g[0]}?aggregate=${g[1]}&limit=300&currency=usd&token=${mint}`);
  const sup = supplyOf(mint);
  const rows = (j.data?.attributes?.ohlcv_list || []).map(([t, o, h, l, cl, v]) => ({ time: t, open: o * sup, high: h * sup, low: l * sup, close: cl * sup, value: v })).sort((a, b) => a.time - b.time);
  hist.set(key, { rows, t: now() });
  if (hist.size > 600) for (const [k, v] of hist) if (now() - v.t > 10 * 60_000) hist.delete(k);
  return rows;
}

// Market cap points (USD) from `fromSec` on, for the list mini charts: every trade second from the live feed
// plus the pool prices of bonded coins, each second as its low and high (in the order they happened) so no
// spike is lost. [[unix seconds, mc], ...] in time order; empty when the radar has no live reading.
export function series(mint, fromSec) {
  const out = [];
  for (const map of [book, ticks]) {
    const e = map.get(mint);
    if (!e) continue;
    for (const [t, o, h, l, c] of e.b) {
      if (t < fromSec) continue;
      if (h === l) out.push([t, c]);
      else if (c >= o) out.push([t, l], [t + 0.5, h]);
      else out.push([t, h], [t + 0.5, l]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

// Volume (USD), buys and sells from `fromSec` on, from the live feed's trade seconds. `from` is the first
// second the feed holds for the coin: when it is after `fromSec` and the coin is older, the window is only
// partly covered and the caller should not present it as the whole window.
export function windowStats(mint, fromSec) {
  const e = book.get(mint);
  if (!e || !e.b.length) return null;
  let vol = 0, buys = 0, sells = 0;
  for (let i = e.b.length - 1; i >= 0; i--) {
    const [t, , , , , v = 0, b = 0, s = 0] = e.b[i];
    if (t < fromSec) break;
    vol += v; buys += b; sells += s;
  }
  return { vol, buys, sells, from: e.b[0][0], last: e.b[e.b.length - 1][0] };
}

// Candles for the chart: tf in seconds (1, 5, 15, 60, 300, 900, 3600). `since` (a candle time) asks for
// only the candles from that one on: the chart's fast refresh, a handful of rows several times a second. In time order: GeckoTerminal's from
// before the feed's first trade, the feed's own (the curve), GeckoTerminal's after the feed's last (the
// pool, once bonded), then pool prices for whatever GeckoTerminal has not charted yet.
export async function candles(mint, tf = 60, since = null) {
  tf = [1, 5, 15, 60, 300, 900, 3600].includes(+tf) ? +tf : 60;
  since = Number(since) > 0 ? Number(since) : null;
  const own = fromBook(mint, Math.max(tf, STEP));
  const snaps = fromBook(mint, Math.max(tf, STEP), ticks);
  const ownStart = own.length ? own[0].time : Infinity, ownEnd = own.length ? own[own.length - 1].time : -Infinity;
  // Jupiter has every coin's whole history at every size: draw it, then the live feed's and pool prices' newer
  // candles on top. GeckoTerminal (below) is only the fallback when Jupiter has nothing or is down.
  let jup = [], jupErr = null;
  try { jup = await jupCandles(mint, tf); } catch (e) { jupErr = e.message; }
  if (jup.length) {
    const jl = jup[jup.length - 1].time, fresh = own.filter((r) => r.time > jl);
    const charted = Math.max(jl, fresh.length ? fresh[fresh.length - 1].time : -Infinity), bridge = snaps.filter((r) => r.time > charted);
    const all = [...jup, ...fresh, ...bridge], rows = since ? all.filter((r) => r.time >= since) : all;
    const source = ["Jupiter", fresh.length && "live trades", bridge.length && "pool prices"].filter(Boolean).join(" + ");
    return { mint, tf, rows, first: all[0]?.time ?? null, partial: Boolean(since), live: now() / 1000 - all[all.length - 1].time < 120, source, note: null, solUsd: feed.solUsd };
  }
  let gt = [], note = jupErr;
  if (tf >= 60 && (!own.length || own[0].time > now() / 1000 - 50 * 60 || snaps.length)) {
    const recent = Math.max(ownEnd, snaps.length ? snaps[snaps.length - 1].time : -Infinity) > now() / 1000 - 120;
    try { gt = await geckoCandles(mint, tf, recent ? 5 * 60_000 : 60_000); } catch (e) { note = e.message; }
  }
  const before = gt.filter((r) => r.time < ownStart);
  const after = own.length ? gt.filter((r) => r.time > ownEnd) : [];
  const charted = Math.max(ownEnd, before.length ? before[before.length - 1].time : -Infinity, after.length ? after[after.length - 1].time : -Infinity);
  const bridge = snaps.filter((r) => r.time > charted);
  const all = [...before, ...own, ...after, ...bridge];
  const rows = since ? all.filter((r) => r.time >= since) : all;
  const source = [own.length && "live trades", (before.length || after.length) && "GeckoTerminal", bridge.length && "pool prices (no volume)"].filter(Boolean).join(" + ") || null;
  return { mint, tf, rows, first: all[0]?.time ?? null, partial: Boolean(since), live: own.length > 0 && now() / 1000 - ownEnd < 120, source, note, solUsd: feed.solUsd };
}

// The candles only exist in memory, so every restart used to hand the chart an empty page. They are written
// to disk twice a minute (a few coins at a time, so the radar keeps answering) and read back at start if the
// copy is under half an hour old; the gap while the radar was down shows as flat candles or a break.
const STATE_FILE = path.join(DATA, "candles-state.json");
const RESUME_MS = 30 * 60_000;
export const candleStats = { restored: 0, savedAt: 0 };
let saving = false;
async function saveState() {
  if (saving || (!book.size && !ticks.size)) return;
  saving = true;
  try {
    const t = now(), parts = [];
    let n = 0;
    for (const [name, map] of [["book", book], ["ticks", ticks]]) {
      const rows = [];
      for (const [mint, e] of map) {
        if (t - e.last > 20 * 60_000) continue;                   // a coin quiet that long is not being charted
        rows.push(JSON.stringify([mint, e.last, e.b.slice(-1800)]));
        if (++n % 25 === 0) await new Promise((go) => setImmediate(go));
      }
      parts.push(`"${name}":[${rows.join(",")}]`);
    }
    await fs.promises.writeFile(STATE_FILE + ".tmp", `{"t":${t},${parts.join(",")}}`);
    await fs.promises.rename(STATE_FILE + ".tmp", STATE_FILE);
    candleStats.savedAt = t;
  } catch {} finally { saving = false; }
}
export function loadState(file = STATE_FILE) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!(now() - j.t < RESUME_MS)) return 0;
    // Pool prices saved before 2026-10-05 for non-pump.fun coins could be scaled by a wrong 1B supply; those are
    // re-read within seconds, so only pump.fun coins' saved pool prices are kept.
    for (const [name, map] of [["book", book], ["ticks", ticks]]) for (const [mint, last, b] of j[name] || []) if (!map.has(mint) && Array.isArray(b) && (name === "book" || /pump$/.test(mint))) map.set(mint, { b, last });
    candleStats.restored = book.size + ticks.size;
  } catch {}
  return candleStats.restored;
}

let started = false;
export function startCandles() {
  if (started) return;
  started = true;
  loadState();
  setInterval(saveState, 30_000).unref?.();
  onLiveTrade(onTrade);
  setInterval(prune, 60_000).unref?.();   // never the reason a process (a test run) stays alive
}
