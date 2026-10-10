// SQLite store: tokens we track, their price history, signals we raised, and briefs.
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// RADAR_DATA points a second copy (tests, a trial run) at its own folder so it never touches the real data.
export const DATA = process.env.RADAR_DATA ? path.resolve(process.env.RADAR_DATA) : path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
export const DB_FILE = path.join(DATA, "radar.db");
export const db = new DatabaseSync(DB_FILE);
// Checkpoints on a thread of their own (dbcheckpoint.js). Not under test runs, which open throwaway copies.
export const checkpointStats = { runs: 0, pages: 0, busy: 0, maxMs: 0, lastMs: 0 };
if (!process.env.RADAR_DATA) {
  try {
    const w = new Worker(new URL("./dbcheckpoint.js", import.meta.url), { workerData: { file: DB_FILE, everyMs: 5000 } });
    w.on("message", (m) => Object.assign(checkpointStats, m));
    w.on("error", () => {});
    w.unref();
  } catch {}
  // No pass reported within a minute (the thread failed to start): SQLite's own checkpointing comes back on.
  setTimeout(() => { if (!checkpointStats.runs) try { db.exec("PRAGMA wal_autocheckpoint = 1000"); } catch {} }, 60_000).unref?.();
}
// The log is folded back by dbcheckpoint.js on its own thread, never at the end of one of the radar's writes.
db.exec(`PRAGMA wal_autocheckpoint = ${process.env.RADAR_DATA ? 1000 : 0}`);

// The radar asks the same few hundred questions over and over, many of them every second. Compiling the
// SQL each time made thousands of throwaway native statements a minute; each query is now compiled once
// and reused. Queries built on the fly (IN lists, filters) share a bounded pool, oldest dropped first.
const compile = db.prepare.bind(db);
const compiled = new Map();
export const dbStats = { compiled: 0, reused: 0, writers: [] };
// Which statements write the most (rows changed per statement, since start): the radar's own reads and
// writes share one thread with every live feed, so a statement run thousands of times a minute shows here.
const writes = new Map();
{
  const proto = Object.getPrototypeOf(compile("SELECT 1"));
  const run = proto.run;
  proto.run = function (...a) {
    const r = run.apply(this, a);
    const k = this.sourceSQL?.replace(/\s+/g, " ").slice(0, 90) || "?", w = writes.get(k);
    if (w) { w.n++; w.rows += r.changes || 0; } else if (writes.size < 400) writes.set(k, { n: 1, rows: r.changes || 0 });
    return r;
  };
  setInterval(() => { dbStats.writers = [...writes].sort((x, y) => y[1].n - x[1].n).slice(0, 10).map(([sql, w]) => ({ sql, ...w })); }, 10_000).unref?.();
}
db.prepare = (sql) => {
  let s = compiled.get(sql);
  if (s) { dbStats.reused++; compiled.delete(sql); compiled.set(sql, s); return s; }
  s = compile(sql);
  dbStats.compiled++;
  compiled.set(sql, s);
  if (compiled.size > 600) compiled.delete(compiled.keys().next().value);
  return s;
};

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA journal_size_limit = 67108864;
-- A 590 MB file: 64 MB of page cache and the file mapped into memory, so hot reads stop going to disk.
PRAGMA cache_size = -65536;
PRAGMA mmap_size = 268435456;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  symbol TEXT, name TEXT, description TEXT, image TEXT,
  source TEXT,                 -- where we first saw it
  first_seen INTEGER,          -- ms
  pair TEXT, dex TEXT, pair_created INTEGER,
  price REAL, mcap REAL, liquidity REAL,
  vol_m5 REAL, vol_h1 REAL, vol_h24 REAL,
  buys_m5 INTEGER, sells_m5 INTEGER, buys_h1 INTEGER, sells_h1 INTEGER,
  chg_m5 REAL, chg_h1 REAL, chg_h24 REAL,
  links TEXT,                  -- json [{type,url}]
  boosts INTEGER DEFAULT 0,
  safety TEXT,                 -- json from rugcheck
  safety_score INTEGER,        -- 0 (bad) .. 100 (clean)
  safety_checked INTEGER,
  score INTEGER DEFAULT 0,     -- momentum/quality score 0..100
  themes TEXT,                 -- json ["AI","Dog"]
  status TEXT DEFAULT 'active',-- active | dead
  graduated INTEGER DEFAULT 0,
  updated INTEGER,
  peak_mcap REAL
);
CREATE INDEX IF NOT EXISTS tokens_status ON tokens(status, updated);
CREATE INDEX IF NOT EXISTS tokens_score ON tokens(score);
-- "other coins with this ticker" (every coin page asks): without it each ask reads the whole table
CREATE INDEX IF NOT EXISTS tokens_symbol_lc ON tokens(lower(symbol));
-- Pulse's two candidate lists (research.js readCandidates), read every 3 s: coins still on the curve by market
-- cap, and bonded coins by bonding time. Without these each read sorted every active token.
CREATE INDEX IF NOT EXISTS tokens_curve_mcap ON tokens(mcap) WHERE status = 'active' AND dex = 'pumpfun' AND COALESCE(graduated, 0) = 0 AND pair IS NOT NULL;
CREATE INDEX IF NOT EXISTS tokens_bonded_t ON tokens(COALESCE(pair_created, first_seen)) WHERE status = 'active' AND graduated = 1 AND pair IS NOT NULL;

CREATE TABLE IF NOT EXISTS snapshots (
  mint TEXT, t INTEGER, price REAL, mcap REAL, liquidity REAL, vol_m5 REAL
);
CREATE INDEX IF NOT EXISTS snap_mint ON snapshots(mint, t);
-- prune and thinning select by time alone: without it each pass reads the whole table
CREATE INDEX IF NOT EXISTS snap_t ON snapshots(t);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint TEXT, kind TEXT, t INTEGER, title TEXT, detail TEXT,
  score INTEGER, price REAL, mcap REAL,
  p15 REAL, p1h REAL, p6h REAL, p24h REAL,   -- price multiples after the signal
  peak REAL,                                  -- best multiple seen within 24h
  notified INTEGER DEFAULT 0,
  hidden INTEGER DEFAULT 0     -- merged into another alert; kept for cooldowns only
);
CREATE INDEX IF NOT EXISTS signals_t ON signals(t);
CREATE INDEX IF NOT EXISTS signals_mint ON signals(mint, kind);

CREATE TABLE IF NOT EXISTS briefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, body TEXT, model TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, kind TEXT, text TEXT
);
`);

// Older databases: add columns introduced later.
try { db.exec("ALTER TABLE signals ADD COLUMN hidden INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN creator TEXT"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN dev_sol REAL"); } catch {}
try { db.exec("ALTER TABLE tokens ADD COLUMN header TEXT"); } catch {}
// Data quality: what the asset is, whether its latest price can be trusted, and when it was last really priced.
for (const c of ["asset_class TEXT", "class_user TEXT", "themes_user TEXT", "quarantine TEXT", "price_t INTEGER", "price_src TEXT"])
  try { db.exec(`ALTER TABLE tokens ADD COLUMN ${c}`); } catch {}
// ok = 1 when the reading came from a market someone could actually trade in.
try { db.exec("ALTER TABLE snapshots ADD COLUMN ok INTEGER"); } catch {}
// safe = 0: the coin did not pass the safety policy when the alert fired (raw activity, not an approved signal).
// illiq = 1: at some checkpoint the coin could not be sold, so that checkpoint counts as a total loss.
for (const c of ["safe INTEGER DEFAULT 1", "why_unsafe TEXT", "liq REAL", "illiq INTEGER DEFAULT 0", "pushed INTEGER DEFAULT 0"])
  try { db.exec(`ALTER TABLE signals ADD COLUMN ${c}`); } catch {}
for (const c of ["status TEXT DEFAULT 'complete'", "stop TEXT"])
  try { db.exec(`ALTER TABLE briefs ADD COLUMN ${c}`); } catch {}
db.exec(`
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT,   -- coin | wallet | kind
  target TEXT, effect TEXT,                           -- mute | always
  note TEXT, created INTEGER, UNIQUE (scope, target)
);
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, channel TEXT, kind TEXT, mint TEXT, title TEXT,
  ok INTEGER, error TEXT                              -- ok: 1 sent, 0 failed, NULL held back (error says why)
);
CREATE INDEX IF NOT EXISTS deliveries_t ON deliveries(t);
`);
export const meta = {
  get: (k, d = null) => db.prepare("SELECT v FROM meta WHERE k = ?").get(k)?.v ?? d,
  set: (k, v) => db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, String(v)),
};

export const q = {
  getToken: db.prepare("SELECT * FROM tokens WHERE mint = ?"),
  insertToken: db.prepare(`INSERT OR IGNORE INTO tokens (mint, symbol, name, description, image, source, first_seen, links, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  activeMints: db.prepare("SELECT mint, updated, score, first_seen FROM tokens WHERE status = 'active'"),
  snapshot: db.prepare("INSERT INTO snapshots (mint, t, price, mcap, liquidity, vol_m5, ok) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  addSignal: db.prepare(`INSERT INTO signals (mint, kind, t, title, detail, score, price, mcap, safe, why_unsafe, liq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  lastSignal: db.prepare("SELECT t FROM signals WHERE mint = ? AND kind = ? ORDER BY t DESC LIMIT 1"),
  openSignals: db.prepare("SELECT * FROM signals WHERE t > ? AND (p24h IS NULL) AND hidden = 0"),
  event: db.prepare("INSERT INTO events (t, kind, text) VALUES (?, ?, ?)"),
};

export function logEvent(kind, text) {
  q.event.run(Date.now(), kind, text);
}

export const json = (s, d = null) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// Price history older than a day is kept as the highest and lowest reading of each 5 minutes per coin,
// which is all the peak and outcome checks look at. Works forward one hour of history per call so it
// never holds the radar up for long.
const THIN_AFTER = 864e5, THIN_BUCKET = 5 * 60_000, THIN_STEP = 3600e3;
export function thinSnapshots(now = Date.now()) {
  const end = now - THIN_AFTER;
  let from = Number(meta.get("snap_thin_t", 0));
  if (!from) from = db.prepare("SELECT MIN(t) m FROM snapshots").get().m || end;
  const to = Math.min(end, from + THIN_STEP);
  if (to <= from) return 0;
  const n = db.prepare(`DELETE FROM snapshots WHERE t >= ?1 AND t < ?2 AND rowid NOT IN (
      SELECT rowid FROM (SELECT rowid, MAX(mcap) FROM snapshots WHERE t >= ?1 AND t < ?2 GROUP BY mint, t / ${THIN_BUCKET})
      UNION SELECT rowid FROM (SELECT rowid, MIN(mcap) FROM snapshots WHERE t >= ?1 AND t < ?2 GROUP BY mint, t / ${THIN_BUCKET}))`).run(from, to).changes;
  meta.set("snap_thin_t", to);
  return Number(n);
}

// Keeps the database small: old snapshots and dead tokens go after a few days. Deletes run in slices with a
// yield between them so the hourly pass never holds the radar up (one statement over the table took ~9 s).
const yieldNow = () => new Promise((r) => setImmediate(r));
async function sliced(sql, ...args) {
  const st = db.prepare(sql);
  for (let i = 0; i < 500; i++) { if (Number(st.run(...args).changes) < 2000) return; await yieldNow(); }
}
export async function prune() {
  const now = Date.now();
  await sliced("DELETE FROM snapshots WHERE rowid IN (SELECT rowid FROM snapshots WHERE t < ? LIMIT 2000)", now - 3 * 864e5);
  await sliced("DELETE FROM tokens WHERE rowid IN (SELECT rowid FROM tokens WHERE status = 'dead' AND updated < ? AND mint NOT IN (SELECT mint FROM signals) LIMIT 2000)", now - 2 * 864e5);
  await sliced("DELETE FROM events WHERE rowid IN (SELECT rowid FROM events WHERE t < ? LIMIT 2000)", now - 7 * 864e5);
  await sliced("DELETE FROM deliveries WHERE rowid IN (SELECT rowid FROM deliveries WHERE t < ? LIMIT 2000)", now - 14 * 864e5);
  try { db.prepare("DELETE FROM ai_spend WHERE t < ?").run(now - 60 * 864e5); } catch {}
  // Thinning in 1 h windows, one per yield, until caught up (each window is a few thousand rows).
  try { for (let i = 0; i < 48 && Number(meta.get("snap_thin_t", 0)) < now - THIN_AFTER; i++) { thinSnapshots(now); await yieldNow(); } } catch {}
  // A read keeps its grade and report; the raw pages it was written from are only useful for a few days.
  try { await sliced("UPDATE research SET sources = NULL WHERE rowid IN (SELECT rowid FROM research WHERE t < ? AND sources IS NOT NULL LIMIT 200)", now - 3 * 864e5); } catch {}
  await yieldNow();
  // The write-ahead log is folded back continuously by dbcheckpoint.js (a TRUNCATE here waited for every
  // reader and writer, on the main thread).
}

// A consistent copy of the database, safe to take while the radar runs. Keeps the newest `keep` copies.
const BACKUPS = path.join(DATA, "backups");
export function backups() {
  try {
    return fs.readdirSync(BACKUPS).filter((f) => /^radar-.*\.db$/.test(f)).sort().reverse()
      .map((f) => { const st = fs.statSync(path.join(BACKUPS, f)); return { file: path.join(BACKUPS, f), bytes: st.size, t: st.mtimeMs }; });
  } catch { return []; }
}
// The same copy, made by a separate process: copying the whole file here would hold the radar up for as
// long as it takes. Resolves with the new file once it is written.
let backingUp = null;
export function backupInBackground(keep = 2) {
  if (backingUp) return backingUp;
  fs.mkdirSync(BACKUPS, { recursive: true });
  const file = path.join(BACKUPS, `radar-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16)}.db`);
  backingUp = new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", path.join(ROOT, "bin", "backup.mjs"), DB_FILE, file], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(err.trim().slice(0, 200) || `backup exited with ${code}`));
      for (const b of backups().slice(keep)) fs.rmSync(b.file);
      meta.set("backup_t", Date.now());
      resolve({ file, bytes: fs.statSync(file).size });
    });
  }).finally(() => { backingUp = null; });
  return backingUp;
}
export function backup(keep = 2) {
  fs.mkdirSync(BACKUPS, { recursive: true });
  const file = path.join(BACKUPS, `radar-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16)}.db`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  for (const b of backups().slice(keep)) fs.rmSync(b.file);
  meta.set("backup_t", Date.now());
  return { file, bytes: fs.statSync(file).size };
}
