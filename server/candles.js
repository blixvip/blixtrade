// Candles for the coin chart, in market cap (USD), from real trades.
//
// Coins on the pump.fun curve: built here from every trade on the live feed, in 5-second buckets for the
// last hour (exact: each trade's price is the curve's own price after it). Anything older, and every
// bonded coin, comes from GeckoTerminal's OHLCV for the coin's busiest pool (free, cached a minute).
import { onLiveTrade, feed } from "./livetrades.js";
import { db } from "./db.js";

const now = () => Date.now();
const STEP = 5;                       // seconds per stored bucket
const KEEP = 720;                     // buckets per coin (1 hour)
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

function prune() {
  for (const [m, e] of book) if (now() - e.last > 30 * 60_000) book.delete(m);
  if (book.size > 4000) [...book.entries()].sort((a, b) => a[1].last - b[1].last).slice(0, book.size - 3000).forEach(([m]) => book.delete(m));
}

// Merge stored 5s buckets into `tf`-second candles.
function fromBook(mint, tf) {
  const e = book.get(mint);
  if (!e) return [];
  const out = [];
  for (const [t, o, h, l, c, v, b, s] of e.b) {
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
async function gecko(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
  if (!r.ok) throw Object.assign(new Error(`GeckoTerminal ${r.status}`), { status: r.status });
  return r.json();
}
async function poolOf(mint) {
  const c = pools.get(mint);
  if (c && now() - c.t < 30 * 60_000) return c.pool;
  const j = await gecko(`${GT}/tokens/${mint}/pools?page=1`);
  const best = (j.data || []).sort((a, b) => (+b.attributes?.reserve_in_usd || 0) - (+a.attributes?.reserve_in_usd || 0))[0];
  const pool = best?.attributes?.address || null;
  pools.set(mint, { pool, t: now() });
  return pool;
}
// Price to market cap: the radar's own reading if it has one, else pump.fun's fixed 1B supply.
function supplyOf(mint) {
  const t = db.prepare("SELECT price, mcap FROM tokens WHERE mint = ?").get(mint);
  return t?.price > 0 && t?.mcap > 0 ? t.mcap / t.price : 1e9;
}
async function geckoCandles(mint, tf) {
  const g = GT_TF[tf] || GT_TF[60];
  const key = `${mint}:${tf}`, c = hist.get(key);
  if (c && now() - c.t < 60_000) return c.rows;
  const pool = await poolOf(mint);
  if (!pool) { hist.set(key, { rows: [], t: now() }); return []; }
  const j = await gecko(`${GT}/pools/${pool}/ohlcv/${g[0]}?aggregate=${g[1]}&limit=300&currency=usd&token=${mint}`);
  const sup = supplyOf(mint);
  const rows = (j.data?.attributes?.ohlcv_list || []).map(([t, o, h, l, cl, v]) => ({ time: t, open: o * sup, high: h * sup, low: l * sup, close: cl * sup, value: v })).sort((a, b) => a.time - b.time);
  hist.set(key, { rows, t: now() });
  if (hist.size > 600) for (const [k, v] of hist) if (now() - v.t > 10 * 60_000) hist.delete(k);
  return rows;
}

// Candles for the chart: tf in seconds (5, 15, 60, 300, 900, 3600).
export async function candles(mint, tf = 60) {
  tf = [5, 15, 60, 300, 900, 3600].includes(+tf) ? +tf : 60;
  const own = tf >= 5 ? fromBook(mint, Math.max(tf, STEP)) : [];
  let older = [], note = null;
  if (tf >= 60 && (!own.length || own[0].time > now() / 1000 - 50 * 60)) {
    try { older = await geckoCandles(mint, tf); } catch (e) { note = e.message; }
  }
  const start = own.length ? own[0].time : Infinity;
  const rows = [...older.filter((r) => r.time < start), ...own];
  return { mint, tf, rows, live: own.length > 0, source: own.length && older.length ? "live trades + GeckoTerminal" : own.length ? "live trades" : older.length ? "GeckoTerminal" : null, note, solUsd: feed.solUsd };
}

let started = false;
export function startCandles() {
  if (started) return;
  started = true;
  onLiveTrade(onTrade);
  setInterval(prune, 60_000);
}
