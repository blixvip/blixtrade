// Writes a consistent copy of the database from its own process, so the radar keeps answering while a
// few hundred megabytes are copied:  node bin/backup.mjs <database> <copy>
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { assertBackupSpace, freeBytes } from './storage-guard.mjs';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) { console.error("usage: backup.mjs <database> <copy>"); process.exit(2); }
try {
  assertBackupSpace(fs.statSync(src).size, freeBytes(path.dirname(dest)));
  if (fs.existsSync(dest)) fs.rmSync(dest);
  const db = new DatabaseSync(src);
  db.exec("PRAGMA busy_timeout = 15000");
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  db.close();
} catch (e) { console.error(e.message); process.exit(1); }
