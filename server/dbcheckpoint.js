// Runs in its own thread (started by db.js): folds the write-ahead log back into radar.db every few seconds
// on a connection of its own. Done on the main thread (SQLite's automatic checkpoint at the end of whatever
// write crossed the limit), it copied tens of MB of a 590 MB file inside a random insert or update, which
// then took up to a second and held every live feed up with it. PASSIVE never waits for, or blocks, the
// radar's own reads and writes; the log file is cut back to journal_size_limit once a pass completes.
import { workerData, parentPort } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(workerData.file);
db.exec("PRAGMA busy_timeout = 0; PRAGMA journal_size_limit = 67108864;");
const stats = { runs: 0, pages: 0, busy: 0, maxMs: 0, lastMs: 0 };
setInterval(() => {
  const t0 = performance.now();
  try {
    const r = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
    stats.runs++; stats.pages += r?.checkpointed || 0; if (r?.busy) stats.busy++;
  } catch { stats.busy++; }
  stats.lastMs = Math.round(performance.now() - t0); stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
  parentPort.postMessage(stats);
}, workerData.everyMs || 5000);
