// Independent of the trading process; run by blix-storage-guard.timer.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const HERE = fileURLToPath(import.meta.url);
const DATA = path.resolve(path.dirname(HERE), '../data');
const DATABASES = ['radar.db', 'candles.db', 'feed-history.db'];
const GB = 1024 ** 3;
export const freeBytes = (dir) => { const s = fs.statfsSync(dir); return s.bavail * s.bsize; };

export function assertBackupSpace(sourceBytes, availableBytes) {
  // Include headroom for WAL growth while VACUUM holds a read snapshot.
  if (availableBytes - sourceBytes * 2 < 6 * GB) throw new Error('Backup skipped: preserve 6 GiB free plus space for the copy and database log growth');
}

export function trimImageCache(data, { budget = 2 * GB, pressure = false, now = Date.now(), targetFree = 8 * GB, available = freeBytes } = {}) {
  const root = path.resolve(data, 'img');
  if (!fs.existsSync(root)) return { removed: 0, bytes: 0 };
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root) throw new Error('Refusing redirected image cache');
  const files = []; let total = 0;
  // Flat, generated token images only. Never recurse into uploads, profiles, or backups.
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-zA-Z0-9_-]+\.(webp|png|jpg|gif|avif)$/.test(entry.name)) continue;
    const file = path.join(root, entry.name);
    try { const s = fs.lstatSync(file); if (s.isFile()) { files.push({ file, size: s.size, t: s.mtimeMs }); total += s.size; } } catch {}
  }
  files.sort((a, b) => a.t - b.t);
  let removed = 0, bytes = 0;
  for (const f of files) {
    if (total <= budget && (!pressure || available(data) >= targetFree)) break;
    // Protect images generated within the last hour, even under pressure.
    if (now - f.t < 3600_000) continue;
    try {
      const current = fs.lstatSync(f.file);
      if (!current.isFile() || current.mtimeMs !== f.t) continue;
      fs.unlinkSync(f.file); total -= f.size; removed++; bytes += f.size;
    } catch {}
  }
  return { removed, bytes };
}

function checkpoint(name) {
  if (!DATABASES.includes(name)) throw new Error('Unknown database');
  const db = new DatabaseSync(path.join(DATA, name));
  try {
    db.exec('PRAGMA busy_timeout=0');
    // PASSIVE first: it copies the log's pages into the database without the writer lock, so the radar keeps writing
    // (and answering) meanwhile. A TRUNCATE straight away copied up to 320 MB of log under that lock and held every
    // radar write 3-6 s, a dozen times an hour; those writes then threw "database is locked" and the radar crashed on
    // the way to logging it (2026-10-11, every ~11 minutes). TRUNCATE only once nothing is left to copy, when it is
    // quick; a reader pinning the log (busy) is left for the next run.
    const passive = db.prepare('PRAGMA wal_checkpoint(PASSIVE)').all()[0];
    const clean = passive && !passive.busy && passive.log >= 0 && passive.log === passive.checkpointed;
    const truncate = clean ? db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all()[0] : null;
    console.log(JSON.stringify({ passive, truncate }));
  } finally { db.close(); }
}

function guard() {
  const report = { at: new Date().toISOString(), freeBefore: freeBytes(DATA), checkpoints: [], cache: null, errors: [] };
  for (const name of DATABASES) {
    const file = path.join(DATA, name);
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) continue;
    let size = 0;
    try { size = fs.statSync(file + '-wal').size; } catch {}
    if (size < 256 * 1024 ** 2) continue;
    const r = spawnSync(process.execPath, ['--no-warnings', HERE, '--checkpoint', name], { timeout: 20_000, encoding: 'utf8', windowsHide: true });
    report.checkpoints.push({ name, bytesBefore: size, status: r.status, result: r.stdout?.trim() });
    if (r.status !== 0) report.errors.push(`${name}: checkpoint failed or timed out`);
  }
  const stateFile = path.join(DATA, 'storage-guard.json');
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  report.lastCacheSweep = previous.lastCacheSweep || 0;
  const pressure = freeBytes(DATA) < 8 * GB;
  if (pressure || Date.now() - report.lastCacheSweep > 3600_000) {
    try { report.cache = trimImageCache(DATA, { pressure }); report.lastCacheSweep = Date.now(); }
    catch (e) { report.errors.push(e.message); }
  }
  report.freeAfter = freeBytes(DATA);
  report.lowSpace = report.freeAfter < 6 * GB;
  fs.writeFileSync(stateFile + '.tmp', JSON.stringify(report));
  fs.renameSync(stateFile + '.tmp', stateFile);
  console.log(JSON.stringify(report));
  if (report.lowSpace || report.errors.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === HERE) {
  if (process.argv[2] === '--checkpoint') checkpoint(process.argv[3]);
  else guard();
}
