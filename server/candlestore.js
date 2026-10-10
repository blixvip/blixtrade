// The radar's own candle history: every pump.fun curve and PumpSwap trade the journal heard, rolled into candles
// that are kept (candleroll.js, on its own thread, into data/candles.db). This side only reads: the chart's
// history for any coin the radar has watched, from its first trade on, the same on every timeframe.
// Nothing here waits on the roll-up thread; a candle not rolled up yet (the last ~20 s) comes from the live
// book (candles.js), which the chart lays over these.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { DATA, DB_FILE } from "./db.js";

export const CANDLES_FILE = path.join(DATA, "candles.db");
export const TFS = [1, 5, 60, 300, 900, 3600];
// Sizes served from a finer stored one: 15 s from 5 s candles, 4 h and 1 d from 1 h.
const FROM = { 15: 5, 14400: 3600, 86400: 3600 };
const now = () => Date.now();
export const storeStats = { on: false, error: null, since: null };

let db = null, worker = null, since = null;
let q = { rows: null, first: null, mid: null };
function openDb() {
  if (db) return db;
  db = new DatabaseSync(CANDLES_FILE);
  db.exec("PRAGMA busy_timeout = 300");
  q.mid = db.prepare("SELECT id, first, last FROM c_mints WHERE mint = ?");
  q.rows = db.prepare("SELECT t, o, h, l, c, v, buys, sells FROM c_candles WHERE mid = ? AND tf = ? AND t >= ? ORDER BY t");
  try { since = Number(db.prepare("SELECT v FROM c_meta WHERE k = 'since'").get()?.v) || null; } catch {}
  storeStats.since = since;
  return db;
}

// How many candles a first answer reaches back: the seconds sizes further (a chart scrolls through them fast).
export const REACH = (tf) => (tf <= 5 ? 3000 : 1500);
// Stored candles of `mint` at size `tf` (seconds) from `fromSec` on, oldest first, in the chart's row shape.
// [] when the radar has nothing stored for it (not a pump.fun coin, or never heard trading).
export function read(mint, tf, fromSec = 0) {
  if (!storeStats.on) return [];
  const base = TFS.includes(tf) ? tf : FROM[tf];
  if (!base) return [];
  try {
    const m = openDb() && q.mid.get(mint);
    if (!m) return [];
    const rows = q.rows.all(m.id, base, Math.floor(fromSec / base) * base);
    if (base === tf) return rows.map((r) => ({ time: r.t, open: r.o, high: r.h, low: r.l, close: r.c, value: r.v, buys: r.buys, sells: r.sells }));
    const out = [];
    for (const r of rows) {
      const k = Math.floor(r.t / tf) * tf, cur = out[out.length - 1];
      if (cur && cur.time === k) { cur.high = Math.max(cur.high, r.h); cur.low = Math.min(cur.low, r.l); cur.close = r.c; cur.value += r.v; cur.buys += r.buys; cur.sells += r.sells; }
      else out.push({ time: k, open: r.o, high: r.h, low: r.l, close: r.c, value: r.v, buys: r.buys, sells: r.sells });
    }
    return out;
  } catch (e) { storeStats.error = e.message; return []; }
}
// When the radar first heard the coin trade (unix seconds), or null.
export function firstHeard(mint) {
  if (!storeStats.on) return null;
  try { return (openDb() && q.mid.get(mint))?.first ?? null; } catch { return null; }
}
// When the store began keeping candles (unix ms): a coin first heard after this has its whole life stored.
export const storeSince = () => since;

// A coin whose journal rows changed after the fact: its candles are made again (journal.js onRevised).
export const rebuild = (mint) => { try { worker?.postMessage({ op: "rebuild", mint }); } catch {} };
// How many times a coin's stored candles were made again: sent with its chart, so an open page re-reads the
// whole chart the moment trades read back from the chain are in (not on its every-20th-poll full read).
const revs = new Map();   // mint -> count
export const revisionOf = (mint) => revs.get(mint) || 0;
function bump(mint) { revs.set(mint, (revs.get(mint) || 0) + 1); if (revs.size > 2000) revs.delete(revs.keys().next().value); }

export function startCandleStore() {
  if (worker) return;
  try {
    worker = new Worker(new URL("./candleroll.js", import.meta.url), { workerData: { radarFile: DB_FILE, candlesFile: CANDLES_FILE } });
    worker.on("message", (m) => { if (m.op === "stats") { const { op, ...s } = m; Object.assign(storeStats, s, { on: true }); if (!since) openDb(); } else if (m.op === "rebuilt") bump(m.mint); });
    worker.on("error", (e) => { storeStats.error = e.message; });
    worker.on("exit", () => { worker = null; storeStats.on = false; setTimeout(startCandleStore, 10_000).unref?.(); });
    worker.unref?.();
  } catch (e) { storeStats.error = e.message; }
}
