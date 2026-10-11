// Runs in its own thread (started by db.js): folds the write-ahead log back into radar.db every few seconds
// on a connection of its own. Done on the main thread (SQLite's automatic checkpoint at the end of whatever
// write crossed the limit), it copied tens of MB of a 590 MB file inside a random insert or update, which
// then took up to a second and held every live feed up with it. PASSIVE never waits for, or blocks, the
// radar's own reads and writes. PASSIVE alone does not truncate the physical WAL: a busy site can keep
// appending even after pages were copied. Try TRUNCATE above the size threshold without waiting on locks.
import { workerData, parentPort } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

const db = new DatabaseSync(workerData.file);
db.exec("PRAGMA busy_timeout = 0; PRAGMA journal_size_limit = 67108864;");
const limit = workerData.maxWalBytes ?? 256 * 1024 * 1024;
const stats = { runs: 0, pages: 0, busy: 0, maxMs: 0, lastMs: 0, walBytes: 0, truncated: 0, lastError: null };
setInterval(() => {
  const t0 = performance.now();
  try {
    const r = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").all()[0];
    stats.runs++; stats.pages += r?.checkpointed || 0; if (r?.busy) stats.busy++;
    stats.walBytes = fs.statSync(`${workerData.file}-wal`).size;
    // TRUNCATE holds the writer lock while it copies whatever was appended since the PASSIVE above and syncs: only
    // when that PASSIVE was quick (the disk is keeping up, little left to copy) and never in the first two minutes
    // after a start, when the radar restores its state in big writes and the log it inherited is still being folded
    // (every restart brought a burst of "database is locked" on the main thread, 2026-10-11).
    const passiveMs = performance.now() - t0, young = performance.now() < 120_000;
    if (stats.walBytes > limit && !r?.busy && r?.log === r?.checkpointed && passiveMs < 250 && !young) {
      // busy_timeout=0: a reader holding a snapshot makes this return busy; retry next pass.
      const cut = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all()[0];
      if (cut?.busy) stats.busy++;
      else stats.truncated++;
      stats.walBytes = fs.statSync(`${workerData.file}-wal`).size;
    }
    stats.lastError = null;
  } catch (e) { stats.busy++; stats.lastError = e.message; }
  stats.lastMs = Math.round(performance.now() - t0); stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
  parentPort.postMessage(stats);
}, workerData.everyMs || 5000);
