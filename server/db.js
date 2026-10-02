// SQLite store: tokens we track, their price history, signals we raised, and briefs.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// RADAR_DATA points a second copy (tests, a trial run) at its own folder so it never touches the real data.
export const DATA = process.env.RADAR_DATA ? path.resolve(process.env.RADAR_DATA) : path.join(ROOT, "data");
fs.mkdirSync(DATA, { recursive: true });
export const DB_FILE = path.join(DATA, "radar.db");
export const db = new DatabaseSync(DB_FILE);

// The radar asks the same few hundred questions over and over, many of them every second. Compiling the
// SQL each time made thousands of throwaway native statements a minute; each query is now compiled once
// and reused. Queries built on the fly (IN lists, filters) share a bounded pool, oldest dropped first.
const compile = db.prepare.bind(db);
const compiled = new Map();
export const dbStats = { compiled: 0, reused: 0 };
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

CREATE TABLE IF NOT EXISTS snapshots (
  mint TEXT, t INTEGER, price REAL, mcap REAL, liquidity REAL, vol_m5 REAL
);
CREATE INDEX IF NOT EXISTS snap_mint ON snapshots(mint, t);

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

// Keeps the database small: old snapshots and dead tokens go after a few days.
export function prune() {
  const now = Date.now();
  db.prepare("DELETE FROM snapshots WHERE t < ?").run(now - 3 * 864e5);
  db.prepare("DELETE FROM tokens WHERE status = 'dead' AND updated < ? AND mint NOT IN (SELECT mint FROM signals)").run(now - 2 * 864e5);
  db.prepare("DELETE FROM events WHERE t < ?").run(now - 7 * 864e5);
  db.prepare("DELETE FROM deliveries WHERE t < ?").run(now - 14 * 864e5);
}

// A consistent copy of the database, safe to take while the radar runs. Keeps the newest `keep` copies.
const BACKUPS = path.join(DATA, "backups");
export function backups() {
  try {
    return fs.readdirSync(BACKUPS).filter((f) => /^radar-.*\.db$/.test(f)).sort().reverse()
      .map((f) => { const st = fs.statSync(path.join(BACKUPS, f)); return { file: path.join(BACKUPS, f), bytes: st.size, t: st.mtimeMs }; });
  } catch { return []; }
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
