// Rolls the trade journal (journal.js: every pump.fun curve and PumpSwap trade, kept a day) into candles that
// are kept for good, on a thread of its own so the radar never waits on it. Every few seconds the trades heard
// since the last pass (and older than a short settling time, so the journal's confirmation sweep has run) are
// bucketed into 1 s, 5 s, 1 m, 5 m, 15 m and 1 h candles in data/candles.db. A coin's chart then has its whole
// history from the radar's own reading of the chain, the same on every timeframe, however long ago it traded.
// Node built-ins only: this thread reads radar.db (never writes it) and owns candles.db.
import { DatabaseSync } from "node:sqlite";
import { parentPort, workerData } from "node:worker_threads";

const { radarFile, candlesFile, everyMs = 5000 } = workerData;
export const TFS = [1, 5, 60, 300, 900, 3600];
const SETTLE_MS = 20_000;                 // trades younger than this are left for the next pass (not yet confirmed)
const KEEP = { 1: 2, 5: 7, 60: 60, 300: 365, 900: 730, 3600: 3650 };   // days each size is kept
const now = () => Date.now();
const post = (m) => { try { parentPort.postMessage(m); } catch {} };

const src = new DatabaseSync(radarFile, { readOnly: true });
src.exec("PRAGMA busy_timeout = 2000");
const db = new DatabaseSync(candlesFile);
db.exec(`
  PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 2000;
  CREATE TABLE IF NOT EXISTS c_mints (id INTEGER PRIMARY KEY, mint TEXT NOT NULL UNIQUE, first INTEGER, last INTEGER);
  CREATE TABLE IF NOT EXISTS c_candles (
    mid INTEGER NOT NULL, tf INTEGER NOT NULL, t INTEGER NOT NULL, o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
    v REAL NOT NULL, buys INTEGER NOT NULL, sells INTEGER NOT NULL, PRIMARY KEY (mid, tf, t)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS c_meta (k TEXT PRIMARY KEY, v);
`);
const getMeta = db.prepare("SELECT v FROM c_meta WHERE k = ?"), setMeta = db.prepare("INSERT INTO c_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");
const getMid = db.prepare("SELECT id FROM c_mints WHERE mint = ?"), addMid = db.prepare("INSERT OR IGNORE INTO c_mints (mint) VALUES (?)");
const touch = db.prepare("UPDATE c_mints SET first = MIN(COALESCE(first, ?), ?), last = MAX(COALESCE(last, 0), ?) WHERE id = ?");
const prevClose = db.prepare("SELECT c FROM c_candles WHERE mid = ? AND tf = ? AND t < ? ORDER BY t DESC LIMIT 1");
// A bucket already there grows with the new trades (its open stays); a new one is inserted whole.
const put = db.prepare(`INSERT INTO c_candles (mid, tf, t, o, h, l, c, v, buys, sells) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(mid, tf, t) DO UPDATE SET h = MAX(h, excluded.h), l = MIN(l, excluded.l), c = excluded.c, v = v + excluded.v, buys = buys + excluded.buys, sells = sells + excluded.sells`);
const wipe = db.prepare("DELETE FROM c_candles WHERE mid = ? AND t >= ?");
const activeMints = src.prepare("SELECT id, mint FROM j_mints WHERE last >= ?");
const tradesOf = src.prepare("SELECT t, mc, usd, buy FROM j_trades WHERE mid = ? AND t >= ? AND t < ? ORDER BY t, k");

const mids = new Map();
function midOf(mint) {
  let id = mids.get(mint);
  if (id != null) return id;
  id = getMid.get(mint)?.id;
  if (id == null) { addMid.run(mint); id = getMid.get(mint).id; }
  mids.set(mint, id); if (mids.size > 100_000) mids.clear();
  return id;
}

// `rows` (one coin's trades, oldest first, [fromMs, toMs)) into every size. A bucket opens at the previous
// one's close, as the live candles do (candles.js addTrade), so candles join up; the first bucket of a pass
// opens at the stored candle before it.
function roll(mid, rows, tfs = TFS) {
  if (!rows.length) return 0;
  let n = 0;
  for (const tf of tfs) {
    const step = tf * 1000, first = Math.floor(rows[0].t / step) * step;
    let last = null, prev = prevClose.get(mid, tf, first)?.c ?? null;
    const flush = () => { if (last) { put.run(mid, tf, last.t / 1000, last.o, last.h, last.l, last.c, last.v, last.b, last.s); n++; } };
    for (const r of rows) {
      const t = Math.floor(r.t / step) * step;
      if (last && last.t === t) { last.h = Math.max(last.h, r.mc); last.l = Math.min(last.l, r.mc); last.c = r.mc; last.v += r.usd; r.buy ? last.b++ : last.s++; }
      else {
        flush();
        const o = prev ?? r.mc;
        last = { t, o, h: Math.max(o, r.mc), l: Math.min(o, r.mc), c: r.mc, v: r.usd, b: r.buy ? 1 : 0, s: r.buy ? 0 : 1 };
      }
      prev = r.mc;
    }
    flush();
  }
  touch.run(Math.floor(rows[0].t / 1000), Math.floor(rows[0].t / 1000), Math.floor(rows[rows.length - 1].t / 1000), mid);
  return n;
}

export const stats = { passes: 0, rows: 0, candles: 0, coins: 0, lastMs: 0, maxMs: 0, cursor: 0, rebuilt: 0, errors: 0, lastError: null, pruned: 0 };
let cursor = Number(getMeta.get("cursor")?.v) || 0;
if (!cursor) {
  // First start: everything the journal holds (a day), read in slices by the first pass.
  cursor = now() - 24 * 3600e3;
  setMeta.run("since", now()); setMeta.run("cursor", cursor);
  for (const tf of TFS) setMeta.run(`has${tf}`, 1);   // every size is in the first pass: nothing to fill in later
}

// One pass: every coin with trades since the cursor, its trades in [cursor, now - SETTLE_MS), rolled up. Writes
// go in transactions of 100 coins, so a reader on the main thread never waits long. Returns when all is done.
let busy = false;
async function pass() {
  if (busy) return;
  busy = true;
  const t0 = performance.now(), upto = now() - SETTLE_MS;
  try {
    if (upto > cursor) {
      const mints = activeMints.all(cursor);
      let coins = 0, rows = 0, candles = 0;
      for (let i = 0; i < mints.length; i += 100) {
        db.exec("BEGIN");
        try {
          for (const m of mints.slice(i, i + 100)) {
            const rs = tradesOf.all(m.id, cursor, upto);
            if (!rs.length) continue;
            candles += roll(midOf(m.mint), rs); rows += rs.length; coins++;
          }
          db.exec("COMMIT");
        } catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
        await new Promise((go) => setImmediate(go));
      }
      cursor = upto; setMeta.run("cursor", cursor);
      stats.rows += rows; stats.candles += candles; stats.coins = coins;
    }
    stats.passes++;
  } catch (e) { stats.errors++; stats.lastError = e.message; }
  stats.lastMs = Math.round(performance.now() - t0); stats.maxMs = Math.max(stats.maxMs, stats.lastMs); stats.cursor = cursor;
  busy = false;
  post({ op: "stats", ...stats });
}

// A coin whose stored trades changed after the fact (a provisional trade dropped, an outage read back): its
// candles for the journal's whole window are made again from what the journal now holds, up to the cursor.
const rebuilds = new Set();
async function rebuild() {
  if (busy || !rebuilds.size) return;
  busy = true;
  try {
    for (const mint of [...rebuilds].slice(0, 50)) {
      rebuilds.delete(mint);
      const j = src.prepare("SELECT id FROM j_mints WHERE mint = ?").get(mint);
      if (!j) continue;
      const from = now() - 24 * 3600e3, mid = midOf(mint);
      const rs = tradesOf.all(j.id, from, cursor);
      db.exec("BEGIN");
      try { wipe.run(mid, Math.floor(from / 1000)); roll(mid, rs); db.exec("COMMIT"); stats.rebuilt++; post({ op: "rebuilt", mint }); }
      catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
      await new Promise((go) => setImmediate(go));
    }
  } catch (e) { stats.errors++; stats.lastError = e.message; }
  busy = false;
}

// The finest sizes are not kept forever: each size goes after its KEEP days (the coarser ones carry on).
function prune() {
  try {
    for (const tf of TFS) stats.pruned += Number(db.prepare("DELETE FROM c_candles WHERE tf = ? AND t < ?").run(tf, Math.floor(now() / 1000) - KEEP[tf] * 86400).changes);
  } catch (e) { stats.lastError = e.message; }
}

// A size added after the store began (1 s, 2026-10-06) is filled in once from what the journal still holds.
async function backfill(tf) {
  if (getMeta.get(`has${tf}`)?.v) return;
  const from = now() - 24 * 3600e3, mints = activeMints.all(from);
  for (let i = 0; i < mints.length; i += 100) {
    db.exec("BEGIN");
    try { for (const m of mints.slice(i, i + 100)) { const rs = tradesOf.all(m.id, from, cursor); if (rs.length) roll(midOf(m.mint), rs, [tf]); } db.exec("COMMIT"); }
    catch (e) { try { db.exec("ROLLBACK"); } catch {} stats.lastError = e.message; return; }
    await new Promise((go) => setImmediate(go));
  }
  setMeta.run(`has${tf}`, 1);
}

parentPort.on("message", (m) => { if (m.op === "rebuild" && m.mint) { rebuilds.add(m.mint); rebuild(); } });
setInterval(pass, everyMs);
setInterval(rebuild, 2000);
setInterval(prune, 3600e3);
pass().then(() => backfill(1));
