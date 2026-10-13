// Writes a consistent copy of the database from its own process, so the radar keeps answering while a
// few hundred megabytes are copied:  node bin/backup.mjs <database> <copy>
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { assertBackupSpace, freeBytes } from './storage-guard.mjs';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) { console.error("usage: backup.mjs <database> <copy>"); process.exit(2); }
const partial = `${dest}.${process.pid}.partial`;
try {
  assertBackupSpace(fs.statSync(src).size, freeBytes(path.dirname(dest)));
  const db = new DatabaseSync(src, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout = 15000");
    db.exec(`VACUUM INTO '${partial.replace(/'/g, "''")}'`);
  } finally { db.close(); }
  fs.renameSync(partial, dest);
} catch (e) {
  // Only this run's incomplete copy. A previously completed destination survives.
  try { fs.rmSync(partial, { force: true }); } catch {}
  console.error(e.message); process.exit(1);
}
