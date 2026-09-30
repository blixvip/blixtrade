// SQLite store: tokens we track, their price history, signals we raised, and briefs.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
export const db = new DatabaseSync(path.join(ROOT, "data", "radar.db"));

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

export const q = {
  getToken: db.prepare("SELECT * FROM tokens WHERE mint = ?"),
  insertToken: db.prepare(`INSERT OR IGNORE INTO tokens (mint, symbol, name, description, image, source, first_seen, links, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  activeMints: db.prepare("SELECT mint, updated, score, first_seen FROM tokens WHERE status = 'active'"),
  snapshot: db.prepare("INSERT INTO snapshots (mint, t, price, mcap, liquidity, vol_m5) VALUES (?, ?, ?, ?, ?, ?)"),
  addSignal: db.prepare(`INSERT INTO signals (mint, kind, t, title, detail, score, price, mcap) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
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
}
