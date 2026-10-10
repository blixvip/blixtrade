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
import { slotTime } from "./feedlag.js";
import { db, DATA } from "./db.js";
import { gtGet, keyedStats } from "./gtgate.js";
import { jupCandles, jupCandlesBack, warmCandles, supplyOf as circulating, knownSupply } from "./jup.js";
import { watchPool } from "./poolwatch.js";
import * as store from "./candlestore.js";

const now = () => Date.now();
const STEP = 1;                       // seconds per stored bucket: the chart's finest candle
const KEEP = 3600;                    // buckets per coin (an hour of non-stop trading; far longer for most coins)
const book = new Map();               // mint -> { b: [[t, o, h, l, c, vUsd, buys, sells], ...], last }

// The curve's market cap is on 1B tokens; the chart's history (Jupiter) is on the coin's circulating supply (burns
// taken out), so live candles are put on that same scale, or they step away from the history where it ends.
// An open chart priced from its accounts (fastpx.js, set by server.js) takes its candles from that feed: a log
// copy of the same trade arriving seconds later on a busy link would be stamped late and drag the candle back.
let isFast = () => false;
export const setFastCheck = (fn) => { isFast = fn; };
function onTrade(mint, s, sol, buy, x) { if (isFast(mint)) return; addTrade(mint, s.mc * feed.solUsd * ((knownSupply(mint) ?? 1e9) / 1e9), sol * feed.solUsd, s.side === "b", slotTime(x?.slot) ?? now()); }

// One trade at market cap `mc` (USD) for `vol` USD: the curve feed above, and bonded coins' PumpSwap pool
// trades (pumpswap.js, through pulse.js), so a bonded coin's chart moves trade by trade too.
// cointape.js imports coin.js, which follows the live trade feed at load time: loading it from here (livetrades ->
// research -> ... -> candles) ran coin.js before livetrades.js had finished, and the radar would not start. Loaded on first use.
const poolLogs = (mint, pool) => import("./cointape.js").then((m) => m.watchPoolLogs(mint, pool)).catch(() => {});

export function addTrade(mint, mc, vol, buy, atMs = now()) {
  if (!(mc > 0)) return;
  const t = Math.floor(atMs / 1000 / STEP) * STEP;
  let e = book.get(mint);
  if (!e) { e = { b: [] }; book.set(mint, e); }
  const last = e.b[e.b.length - 1];
  if (last && last[0] === t) { last[2] = Math.max(last[2], mc); last[3] = Math.min(last[3], mc); last[4] = mc; last[5] += vol; buy ? last[6]++ : last[7]++; }
  else {
    // A new bucket opens at the previous close, so candles join up like a real chart.
    const o = last ? last[4] : mc;
    e.b.push([t, o, Math.max(o, mc), Math.min(o, mc), mc, vol, buy ? 1 : 0, buy ? 0 : 1]);
    if (e.b.length > KEEP) e.b.splice(0, e.b.length - KEEP);
  }
  e.last = now();
}

// A coin's trade buckets rebuilt from the trade journal (journal.js buckets(): the same rule as addTrade), after
// a restart or when a provisional trade turned out never to have happened.
// Where a coin's live trade buckets stand: when the last trade came in (ms) and the newest bucket's time (s).
export function bookAt(mint) {
  const e = book.get(mint);
  return e ? { at: e.last || 0, t: e.b[e.b.length - 1]?.[0] ?? 0 } : null;
}

export function setBook(mint, b) {
  if (b.length) book.set(mint, { b: b.slice(-KEEP), last: now() });
  else book.delete(mint);
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
const GT_TF = { 60: ["minute", 1], 300: ["minute", 5], 900: ["minute", 15], 3600: ["hour", 1], 14400: ["hour", 4], 86400: ["day", 1] };
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
  // A pool address does not change: with the keyed lane (credits count) a found one is kept a day.
  if (c && now() - c.t < (c.pool ? (keyedStats().on ? 1440 : 30) : 1) * 60_000) return c.pool;
  const j = await gecko(`${GT}/tokens/${mint}/pools?page=1`);
  const best = (j.data || []).sort((a, b) => (+b.attributes?.reserve_in_usd || 0) - (+a.attributes?.reserve_in_usd || 0))[0];
  const pool = best?.attributes?.address || null;
  pools.set(mint, { pool, t: now() });
  if (pools.size > 2000) for (const [k, v] of pools) if (now() - v.t > 30 * 60_000) pools.delete(k);
  return pool;
}
// Price to market cap: Jupiter's circulating supply (the scale its own candles are in), else the radar's own
// reading, else pump.fun's fixed 1B supply.
function supplyOf(mint) {
  const c = circulating(mint);
  if (c) return c;
  const t = db.prepare("SELECT price, mcap FROM tokens WHERE mint = ?").get(mint);
  return t?.price > 0 && t?.mcap > 0 ? t.mcap / t.price : 1e9;
}
// `ttl`: how long an answer is reused. A minute normally; five when the feed or pool prices already draw the
// newest candles, so the history only needs an occasional refresh.
// `pages`: how many 1,000-candle pages back (the hour and day sizes take two, so All reaches months).
async function geckoCandles(mint, tf, ttl = 60_000, pages = 1) {
  const g = GT_TF[tf] || GT_TF[60];
  const key = `${mint}:${tf}`, c = hist.get(key);
  if (c && now() - c.t < (c.rows.length ? ttl : 60_000) && (c.pages || 1) >= pages) return c.rows;   // "nothing yet" is asked again in a minute
  const pool = await poolOf(mint);
  if (!pool) { hist.set(key, { rows: [], t: now() }); return []; }
  const sup = supplyOf(mint);
  const page = async (before) => {
    const j = await gecko(`${GT}/pools/${pool}/ohlcv/${g[0]}?aggregate=${g[1]}&limit=1000&currency=usd&token=${mint}${before ? `&before_timestamp=${before}` : ""}`);
    return (j.data?.attributes?.ohlcv_list || []).map(([t, o, h, l, cl, v]) => ({ time: t, open: o * sup, high: h * sup, low: l * sup, close: cl * sup, value: v })).sort((a, b) => a.time - b.time);
  };
  let rows = await page(null);
  for (let i = 1; i < pages && rows.length >= 1000 * i; i++) {
    const older = await page(rows[0].time).catch(() => []);
    if (!older.length) break;
    rows = [...older.filter((r) => r.time < rows[0].time), ...rows];
  }
  hist.set(key, { rows, t: now(), pages });
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
// ---------- keeping every timeframe on one price ----------
// The radar's own live candles (decoded on-chain trades, pool prices) are drawn after Jupiter's newest candle.
// When the two read a coin at different levels (a pool decoded on another basis: ChatGPT's live trades sat at
// 0.85x Jupiter's, MINECLANK's at 0.62x), the chart jumped at the seam and each timeframe showed a different
// price. Where both have the same second, Jupiter's close over ours gives the factor that puts the live
// candles on Jupiter's level; a source more than 4x off is not drawn at all.
const levels = new Map();   // `${which}:${mint}` -> { k, t }
async function levelOf(mint, map, which) {
  const key = `${which}:${mint}`, c = levels.get(key);
  if (c && now() - c.t < 3000) return c.k;
  const e = map.get(mint);
  let k = 1;
  if (e?.b.length) {
    let j1 = [];
    try { j1 = await soon(jupCandles(mint, 1), 300); } catch {}
    if (j1 === SLOW) return c ? c.k : null;   // not kept, and not drawn on a guessed level: next poll has it
    const jm = new Map(j1.slice(0, -1).map((r) => [r.time, r.close]));   // the newest second may still be filling
    const ratios = [];
    for (let i = e.b.length - 1; i >= 0 && ratios.length < 40; i--) { const jc = jm.get(e.b[i][0]); if (jc > 0 && e.b[i][4] > 0) ratios.push(jc / e.b[i][4]); }
    if (ratios.length) { ratios.sort((a, b) => a - b); k = ratios[Math.floor(ratios.length / 2)]; }
    if (Math.abs(k - 1) < 0.005) k = 1;
    if (!(k > 0.25 && k < 4)) k = null;   // beyond 4x the two are not the same market: the live candles are not drawn
  }
  levels.set(key, { k, t: now() });
  if (levels.size > 400) levels.delete(levels.keys().next().value);
  return k;
}
// The same factor for everything else that shows this coin's price live (the chart's trade-by-trade push, the
// header, every list): known while its chart is open, 1 otherwise.
// The newest close the chart was given for each coin, so the header can show the same price.
const lastShown = new Map();   // mint -> { close, t }
export function chartClose(mint) {
  const c = lastShown.get(mint);
  return c && now() - c.t < 15_000 ? c.close : null;
}
export function levelNow(mint) {
  const c = levels.get(`book:${mint}`);
  return c && c.k != null && now() - c.t < 60_000 ? c.k : 1;
}
// A chart's answer does not wait on Jupiter or GeckoTerminal for more than `ms`: a coin's first chart waited
// 5-20 s on them (2026-10-06, Jupiter at 4-13 s an answer). The live trades go out at once instead, the slow
// call carries on behind it (jup.js keeps it), and the chart's next poll, a second later, has it.
const SLOW = Symbol("slow");
const soon = (p, ms) => Promise.race([p, new Promise((ok) => setTimeout(ok, ms, SLOW))]);
const scaled = (rows, k) => k === 1 ? rows : k == null ? [] : rows.map((r) => ({ ...r, open: r.open * k, high: r.high * k, low: r.low * k, close: r.close * k }));

// Jupiter answers each size from its own index, and they disagree: a 15 m candle with a low at $3.4K (pump.fun's
// starting price) over 5 m candles that never went under $44K, a 5 s high its 1 m candle does not have. So the
// same moment looked different on every timeframe. Each size's wicks are now kept within what the next finer one
// saw wherever that one covers the whole interval, so a print one index has and the others do not is dropped.
// Not 15 s from 1 s: Jupiter's 1 s series can be wrong around a migration (swordinu's read $49.6K and $3.6K
// on a $300K coin), and rebuilding from it spread that to every size. Wicks are only ever narrowed.
const FINER = { 60: 15, 300: 60, 900: 300, 3600: 900, 14400: 3600, 86400: 14400 };
async function reconciled(mint, tf) {
  let rows = [];
  try { rows = await jupCandles(mint, tf); } catch {}
  return trimWicks(mint, tf, rows);
}
async function trimWicks(mint, tf, rows) {
  const ft = FINER[tf];
  if (!ft || !rows.length) return rows;
  const fine = await soon(reconciled(mint, ft), 300);
  if (fine === SLOW || fine.length < 2) return rows;
  // Under the 1,000 Jupiter returns, the finer series is the coin's whole history: its first interval (where a
  // launch or migration print lands) is covered even though the finer series starts partway into it.
  const whole = fine.length < 1000, f0 = whole ? -Infinity : fine[0].time, fN = fine[fine.length - 1].time;
  const by = new Map();
  for (const r of fine) { const k = r.time - (r.time % tf), x = by.get(k); if (!x) by.set(k, { o: r.open, h: r.high, l: r.low, c: r.close }); else { x.h = Math.max(x.h, r.high); x.l = Math.min(x.l, r.low); x.c = r.close; } }
  return rows.map((r) => {
    if (r.time < f0 || r.time + tf > fN + ft) return r;
    const x = by.get(r.time);
    if (!x) return r;
    const high = r.high > x.h * 1.02 ? Math.max(x.h, r.open, r.close) : r.high, low = r.low < x.l / 1.02 ? Math.min(x.l, r.open, r.close) : r.low;
    return high === r.high && low === r.low ? r : { ...r, high, low };
  });
}
// Every candle's wick spans its body (a few of Jupiter's did not).
const sane = (rows) => rows.map((r) => (r.high >= Math.max(r.open, r.close) && r.low <= Math.min(r.open, r.close) ? r : { ...r, high: Math.max(r.high, r.open, r.close), low: Math.min(r.low, r.open, r.close) }));

// ---------- the radar's own history ----------
// Every trade the journal heard, rolled into candles that are kept (candlestore.js): a coin's chart from its
// first trade on, read from the chain by the radar itself, the same on every timeframe. The live book's newest
// seconds (not rolled up yet) are laid over the end. Jupiter is only asked for the part of a coin's life before
// the radar heard it (a coin older than the store), scaled onto our level where the two meet.
// What a chart was first told (its first candle's time), so a refresh (`since`) reports the same: the page
// keeps its history only while the answer's `first` and `source` do not change.
const firsts = new Map();   // `${mint}:${tf}` -> { first, t }
const prefixes = new Map(); // `${mint}:${tf}` -> { rows, t }: Jupiter's candles from before our first, on our level
const BIRTH_MC = 9000;      // a first candle opening under this is the curve's start: the coin's whole life is ours
// ...unless the coin is known to be older than our first candle (a cheap coin heard late, or one whose first
// trades were lost): then Jupiter is asked for what came before, like for any other coin.
let createdQ = null;   // prepared on first use (the coins table is coinindex.js's, made after this module loads)
// Gecko's candles as the chart, with what the chain saw since its last one on top: the candle Gecko is still
// filling takes the live book's high, low and close for that interval (its index trails the chain by seconds),
// and the book's newer candles follow it. `extra` (pool prices) bridge to now when the book has nothing newer.
function onGecko(gt, own, extra = []) {
  const gl = gt[gt.length - 1].time;
  const tail = own.find((r) => r.time === gl) || extra.find((r) => r.time === gl);
  const head = tail ? { ...gt[gt.length - 1], high: Math.max(gt[gt.length - 1].high, tail.high), low: Math.min(gt[gt.length - 1].low, tail.low), close: tail.close, value: Math.max(gt[gt.length - 1].value || 0, tail.value || 0) } : gt[gt.length - 1];
  const fresh = own.filter((r) => r.time > gl);
  const charted = Math.max(gl, fresh.length ? fresh[fresh.length - 1].time : -Infinity);
  const bridge = extra.filter((r) => r.time > charted);
  return { all: sane([...gt.slice(0, -1), head, ...fresh, ...bridge]), fresh, bridge, gl };
}
const GT_PAGES = (tf) => (tf >= 3600 ? 2 : 1);
// When the coin was made (ms), from the coin index or its pair, or 0.
function createdOf(mint) {
  try {
    createdQ ||= db.prepare("SELECT MIN(t) t FROM (SELECT created t FROM coins WHERE mint = ? AND created > 0 UNION ALL SELECT pair_created t FROM tokens WHERE mint = ? AND pair_created > 0)");
    return createdQ.get(mint, mint)?.t || 0;
  } catch { return 0; }
}
function bornBefore(mint, firstSec) {
  const t = createdOf(mint);
  return t > 0 && firstSec * 1000 - t > 10 * 60_000;
}
// A pump.fun coin: its trades are the radar's own from launch, whatever its address ends in. Most end in "pump",
// but a vanity address does not (1DOG, 13qh…Va5P2L), and those charts were Jupiter's alone, whose second sizes
// reach back under 17 minutes. Known from the coin index (coinindex.js, every pump.fun coin the radar heard made).
let pumpQ = null;
const pumpSeen = new Map();   // mint -> true/false, the index's answer
function isPumpCoin(mint) {
  if (/pump$/.test(mint)) return true;
  let v = pumpSeen.get(mint);
  if (v === undefined) {
    try { pumpQ ||= db.prepare("SELECT 1 FROM coins WHERE mint = ?"); v = Boolean(pumpQ.get(mint)); } catch { v = false; }
    // A "no" is asked again later (the index can hear a coin after its chart was first opened).
    if (v) pumpSeen.set(mint, v);
    if (pumpSeen.size > 5000) pumpSeen.delete(pumpSeen.keys().next().value);
  }
  return v;
}
async function ownHistory(mint, tf, since, own) {
  const key = `${mint}:${tf}`;
  // 1m and up: GeckoTerminal's candles are the chart (complete from the coin's first trade, read from the chain
  // by their indexer, re-read every 2 minutes), the live book only its newest edge. The radar's own gaps, feed
  // outages and retention never show in the history. Not yet on Gecko (a coin minutes old): the book's own.
  if (tf >= 60) {
    let gt = [];
    try { gt = await soon(geckoCandles(mint, tf, 5 * 60_000, GT_PAGES(tf)), since ? 0 : keyedStats().on ? 3000 : 800); } catch {}
    if (gt !== SLOW && gt.length) {
      const { all, fresh, gl } = onGecko(gt, own);
      levels.set(`book:${mint}`, { k: 1, t: now() });
      lastShown.set(mint, { close: all[all.length - 1].close, t: now() }); if (lastShown.size > 500) lastShown.delete(lastShown.keys().next().value);
      return { mint, tf, rows: since ? all.filter((r) => r.time >= since) : all, first: all[0].time, partial: Boolean(since), live: now() / 1000 - all[all.length - 1].time < 120,
        source: fresh.length ? "GeckoTerminal + Blix live" : "GeckoTerminal", note: null, solUsd: feed.solUsd, chainTo: gl + tf };
    }
  }
  // A second chart reaches back REACH candles (3,000 s at 1 s); a coin under 2 hours old is read from its launch
  // instead, so its chart starts where the coin did and its first candle stays put from one poll to the next.
  const bornS = tf < 60 ? Math.floor(createdOf(mint) / 1000) : 0, nowS = now() / 1000;
  const reach = tf < 60 && bornS > nowS - 7200 ? Math.min(bornS, nowS - store.REACH(tf) * tf) : nowS - store.REACH(tf) * tf;
  const stored = store.read(mint, tf, since ? since - tf : reach);
  if (!stored.length) return null;
  // The live book's buckets from the last stored candle on (it holds the same trades plus the newest ones).
  const lastT = stored[stored.length - 1].time, tail = own.filter((r) => r.time >= lastT);
  let rows = tail.length ? [...stored.filter((r) => r.time < tail[0].time), ...tail] : stored;
  // Before the radar heard the coin: Jupiter, once per 5 minutes, put on our level where the two meet. A slow
  // Jupiter (over 400 ms) is not waited for: the answer goes out without the prefix and is asked again on the
  // next poll; when it then arrives on a refresh, the whole chart is sent (the page redraws it from the start).
  let p = prefixes.get(key);
  // A refresh never works the prefix out itself (its rows start at `since`, not at our first candle): when the
  // prefix is missing, still to come or old, the whole chart is answered instead, with it.
  if (since && (!p || now() - p.t > 5 * 60_000)) return ownHistory(mint, tf, null, own);
  if (!p || now() - p.t > 5 * 60_000) {
    let pre = [], slow = false, failed = false;
    // Our first candle at the curve's starting price: the coin's whole life is ours, nothing to ask Jupiter for.
    if (!(rows[0].open < BIRTH_MC) || bornBefore(mint, rows[0].time)) {
      try {
        // Second sizes: Jupiter's pages back to the coin's launch (one page is under 17 minutes at 1 s).
        // Asked up to the next 5-minute mark (one key, so one set of calls, while the window's start moves).
        const upTo = Math.ceil((rows[0].time + 1) / 300) * 300;
        const j = await soon(tf < 60 ? jupCandlesBack(mint, tf, upTo, bornS || rows[0].time - 3600) : jupCandles(mint, tf), 400);
        if (j === SLOW) slow = true;
        else if (j.length) {
          const seam = j.filter((r) => r.time <= rows[0].time).pop();
          const k = seam && seam.close > 0 ? rows[0].open / seam.close : 1;
          if (k > 0.25 && k < 4) pre = j.filter((r) => r.time < rows[0].time).map((r) => (k === 1 ? r : { ...r, open: r.open * k, high: r.high * k, low: r.low * k, close: r.close * k }));
        }
      } catch { failed = true; }
    }
    // Jupiter refusing (429s on the server's address) is asked again in 30 s, not taken as "nothing before".
    if (failed) { p = { rows: p?.rows || [], t: now() - 5 * 60_000 + 30_000 }; prefixes.set(key, p); }
    else if (!slow) { p = { rows: pre, t: now() }; prefixes.set(key, p); }
    else if (!p) { p = { rows: [], t: 0 }; prefixes.set(key, p); }   // t 0: asked again on the next poll
    if (prefixes.size > 300) prefixes.delete(prefixes.keys().next().value);
  }
  const pre = p?.rows || [];
  const all = sane([...pre.filter((r) => r.time < rows[0].time), ...rows]);
  let f = firsts.get(key);
  if (!since || !f) { f = { first: all[0].time, t: now() }; firsts.set(key, f); if (firsts.size > 300) firsts.delete(firsts.keys().next().value); }
  f.t = now();
  // The chart's live pushes and the header stay on this level (ours): no scaling against Jupiter.
  levels.set(`book:${mint}`, { k: 1, t: now() });
  lastShown.set(mint, { close: all[all.length - 1].close, t: now() }); if (lastShown.size > 500) lastShown.delete(lastShown.keys().next().value);
  return { mint, tf, rows: since ? all.filter((r) => r.time >= since) : all, first: f.first, partial: Boolean(since), live: now() / 1000 - all[all.length - 1].time < 120,
    source: pre.length ? "Blix + Jupiter before" : "Blix", note: null, solUsd: feed.solUsd, chainTo: pre.length ? pre[pre.length - 1].time + tf : null };
}

export async function candles(mint, tf = 60, since = null) {
  tf = [1, 5, 15, 60, 300, 900, 3600, 14400, 86400].includes(+tf) ? +tf : 60;
  since = Number(since) > 0 ? Number(since) : null;
  if (isPumpCoin(mint)) { try { const h = await ownHistory(mint, tf, since, fromBook(mint, Math.max(tf, STEP))); if (h) return h; } catch (e) { store.storeStats.readError = e.message; } }
  // A bonded coin outside PumpSwap: its pool is read on-chain while the chart is open (poolwatch.js), since
  // Jupiter's candles trail the chain by 6-10 s. PumpSwap pools are already read trade by trade (pumpswap.js).
  const tok = db.prepare("SELECT graduated, dex, pair FROM tokens WHERE mint = ?").get(mint);
  if (tok?.graduated && tok.pair && tok.dex !== "pumpswap" && tok.dex !== "pumpfun") { watchPool(mint, tok.pair); poolLogs(mint, tok.pair); }
  const own = fromBook(mint, Math.max(tf, STEP));
  const snaps = fromBook(mint, Math.max(tf, STEP), ticks);
  const ownStart = own.length ? own[0].time : Infinity, ownEnd = own.length ? own[own.length - 1].time : -Infinity;
  // Jupiter has every coin's whole history at every size: draw it, then the live feed's and pool prices' newer
  // candles on top. GeckoTerminal (below) is only the fallback when Jupiter has nothing or is down.
  // 1m and up: GeckoTerminal first (complete, read from the chain by their indexer), the live book and pool
  // prices on its newest edge; Jupiter only when Gecko has nothing for the coin.
  if (tf >= 60) {
    let gt = [];
    try { gt = await soon(geckoCandles(mint, tf, 5 * 60_000, GT_PAGES(tf)), since ? 0 : keyedStats().on ? 3000 : 800); } catch {}
    if (gt !== SLOW && gt.length) {
      const { all, fresh, bridge, gl } = onGecko(gt, own, snaps);
      levels.set(`book:${mint}`, { k: 1, t: now() });
      lastShown.set(mint, { close: all[all.length - 1].close, t: now() }); if (lastShown.size > 500) lastShown.delete(lastShown.keys().next().value);
      const source = ["GeckoTerminal", fresh.length && "live trades", bridge.length && "pool prices"].filter(Boolean).join(" + ");
      return { mint, tf, rows: since ? all.filter((r) => r.time >= since) : all, first: all[0]?.time ?? null, partial: Boolean(since), live: now() / 1000 - all[all.length - 1].time < 120, source, note: null, solUsd: feed.solUsd, chainTo: gl + tf };
    }
  }
  if (!since) warmCandles(mint);
  let jup = [], jupErr = null;
  // The finer size (wick check) and the 1 s series (live level) are asked for at the same time as this size,
  // not after it: a cold coin's first chart took three Jupiter round trips in a row (5.8 s seen).
  // ...on a full load; a refresh (every second or so) needs only this size, or Jupiter's free allowance goes
  // in minutes with a few charts open (2026-10-07).
  if (!since) {
    jupCandles(mint, 1).catch(() => {});
    if (FINER[tf]) jupCandles(mint, FINER[tf]).catch(() => {});
  }
  try { jup = await soon(jupCandles(mint, tf), 400); } catch (e) { jupErr = e.message; }
  const jupSlow = jup === SLOW;
  if (jupSlow) jup = [];
  if (jup.length) {
    if (!since) jup = await trimWicks(mint, tf, jup);   // the finer series only on a full load (Jupiter allowance)
    const [kOwn, kSnap] = await Promise.all([levelOf(mint, book, "book"), levelOf(mint, ticks, "ticks")]);
    const ownS = scaled(own, kOwn), snapS = scaled(snaps, kSnap);
    const jl = jup[jup.length - 1].time, fresh = ownS.filter((r) => r.time > jl);
    const charted = Math.max(jl, fresh.length ? fresh[fresh.length - 1].time : -Infinity), bridge = snapS.filter((r) => r.time > charted);
    // Jupiter's newest candle is still filling (its index trails the chain): what the chain saw in that same
    // interval goes into it, so its high, low and close are not seconds stale. Its volume is the larger count.
    const tail = ownS.find((r) => r.time === jl) || snapS.find((r) => r.time === jl);
    const head = tail ? { ...jup[jup.length - 1], high: Math.max(jup[jup.length - 1].high, tail.high), low: Math.min(jup[jup.length - 1].low, tail.low), close: tail.close, value: Math.max(jup[jup.length - 1].value || 0, tail.value || 0) } : null;
    const all = sane([...(head ? [...jup.slice(0, -1), head] : jup), ...fresh, ...bridge]), rows = since ? all.filter((r) => r.time >= since) : all;
    if (all.length) { lastShown.set(mint, { close: all[all.length - 1].close, t: now() }); if (lastShown.size > 500) lastShown.delete(lastShown.keys().next().value); }
    const source = ["Jupiter", fresh.length && "live trades", bridge.length && "pool prices"].filter(Boolean).join(" + ");
    // `chainTo`: up to here the candles are Jupiter's, read from the chain itself, so a quiet interval in
    // them really was quiet (the radar's own feed outages do not apply before it).
    return { mint, tf, rows, first: all[0]?.time ?? null, partial: Boolean(since), live: now() / 1000 - all[all.length - 1].time < 120, source, note: null, solUsd: feed.solUsd, chainTo: jl + tf };
  }
  let gt = [], note = jupErr;
  if (tf >= 60 && (!own.length || own[0].time > now() / 1000 - 50 * 60 || snaps.length)) {
    const recent = Math.max(ownEnd, snaps.length ? snaps[snaps.length - 1].time : -Infinity) > now() / 1000 - 120;
    try { gt = await soon(geckoCandles(mint, tf, recent ? 5 * 60_000 : 60_000), jupSlow ? 0 : 400); } catch (e) { note = e.message; }
    if (gt === SLOW) { gt = []; note = "Loading the chart's history"; }
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
