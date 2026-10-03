// Tape: a second-by-second price record of every coin that drew real traders, kept for a few days.
// The stored snapshots are a minute apart and these trades are over in five, so without this no entry
// or exit rule could be tested against what actually happened. bin/replay.mjs reads it.
//
// One bar = [seconds since the tape began, market cap in USD, buys so far, sells so far, traders so far].
// A bar is written when the second changes and something moved; flushed to SQLite in chunks once a minute.
import { db, logEvent } from "./db.js";
import { onLiveTrade, feed } from "./livetrades.js";

db.exec("CREATE TABLE IF NOT EXISTS tape (mint TEXT, t INTEGER, t0 INTEGER, bars TEXT)");
db.exec("CREATE INDEX IF NOT EXISTS tape_mint ON tape(mint, t)");
db.exec("CREATE INDEX IF NOT EXISTS tape_t ON tape(t)");

const MIN_TRADERS = 15;          // below this a coin is noise, and there are a thousand of them an hour
const LENGTH = 30 * 60_000;      // how long each coin is recorded from its first trade
const KEEP = 3 * 864e5;
const tapes = new Map();         // mint -> { t0, sec, last, buf: [] }
export const tapeStats = { recording: 0, bars: 0, flushed: 0, lastFlush: null };

function add(mint, t0, mcUsd, buys, sells, traders) {
  const t = Date.now();
  let r = tapes.get(mint);
  if (!r) { r = { t0, sec: -1, last: 0, buf: [] }; tapes.set(mint, r); }
  const sec = Math.round((t - r.t0) / 1000);
  // Within one second the last trade wins; a price that has not moved is not written again for 5 seconds.
  if (sec === r.sec && r.buf.length) { r.buf[r.buf.length - 1] = [sec, Math.round(mcUsd), buys, sells, traders]; r.last = mcUsd; return; }
  if (r.last && Math.abs(mcUsd / r.last - 1) < 0.003 && sec - r.sec < 5) return;
  r.buf.push([sec, Math.round(mcUsd), buys, sells, traders]);
  r.sec = sec; r.last = mcUsd; r.seen = t;
  tapeStats.bars++;
}

function onTrade(mint, s) {
  if (!tapes.has(mint) && (s.traders.size < MIN_TRADERS || Date.now() - s.first > LENGTH)) return;
  if (Date.now() - s.first > LENGTH) return;
  add(mint, s.first, s.mc * feed.solUsd, s.buys, s.sells, s.traders.size);
}
// Coins that left the bonding curve are priced by polling; the entry/exit watcher hands those prices in.
export function tapeNote(mint, mcapUsd) {
  if (!(mcapUsd > 0)) return;
  const r = tapes.get(mint);
  add(mint, r ? r.t0 : Date.now(), mcapUsd, null, null, null);
}

function flush() {
  const ins = db.prepare("INSERT INTO tape (mint, t, t0, bars) VALUES (?, ?, ?, ?)");
  let began = false;
  try {
    for (const [mint, r] of tapes) {
      if (r.buf.length) {
        if (!began) { db.exec("BEGIN"); began = true; }
        ins.run(mint, Date.now(), r.t0, JSON.stringify(r.buf));
        tapeStats.flushed += r.buf.length;
        r.buf = [];
      }
      // Finished (its 30 minutes are up) or abandoned (nothing for 10 minutes): stop holding it.
      if (Date.now() - r.t0 > LENGTH + 60_000 || Date.now() - (r.seen || r.t0) > 10 * 60_000) tapes.delete(mint);
    }
    if (began) db.exec("COMMIT");
  } catch (e) { if (began) try { db.exec("ROLLBACK"); } catch {} logEvent("error", `tape: ${e.message}`); }
  tapeStats.recording = tapes.size; tapeStats.lastFlush = Date.now();
}

// The whole record of one coin, oldest bar first: { t0, bars: [[sec, mcap, buys, sells, traders]] }.
export function readTape(mint, database = db) {
  const rows = database.prepare("SELECT t0, bars FROM tape WHERE mint = ? ORDER BY t").all(mint);
  if (!rows.length) return null;
  const t0 = Math.min(...rows.map((r) => r.t0)), bars = [];
  for (const r of rows) for (const b of JSON.parse(r.bars)) bars.push(r.t0 === t0 ? b : [b[0] + Math.round((r.t0 - t0) / 1000), ...b.slice(1)]);
  return { t0, bars: bars.sort((a, b) => a[0] - b[0]) };
}

export function startTape() {
  onLiveTrade(onTrade);
  setInterval(flush, 60_000);
  setInterval(() => { try { db.prepare("DELETE FROM tape WHERE t < ?").run(Date.now() - KEEP); } catch {} }, 60 * 60_000);
}
