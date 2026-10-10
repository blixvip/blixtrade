#!/usr/bin/env node
// Off-box backup of what cannot be fetched again: the databases (an online copy, consistent while the radar runs),
// settings, the Google and Fomo logins, the small state files and members' uploads. Logos (data/img, data/people)
// are re-fetchable and left out. One encrypted archive a night:
//   data/backups/off/blix-<date>.tgz.enc   (openssl aes-256-cbc, key = the file BLIX_BACKUP_KEY points at)
// kept 7 days here and, when rclone has a remote called "r2" (Cloudflare R2), copied to r2:<BLIX_BACKUP_BUCKET>
// (default blix-backups) with the same 7-day keep. Run by the blix-backup.timer systemd unit (deploy/); by hand:
//   BLIX_BACKUP_KEY=/etc/blix-backup.key node bin/offsite-backup.mjs
// Restore: openssl enc -d -aes-256-cbc -pbkdf2 -pass file:<key> -in blix-<date>.tgz.enc | tar -xz -C <empty dir>
// then copy the files over data/ while Blix is stopped.
// A failure is said on the Discord webhook in settings.json (discordWebhook), if there is one, and exits non-zero.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const DATA = process.env.RADAR_DATA ? path.resolve(process.env.RADAR_DATA) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const OUT = path.join(DATA, "backups", "off");
const KEY = process.env.BLIX_BACKUP_KEY || "";
const BUCKET = process.env.BLIX_BACKUP_BUCKET || "blix-backups";
const KEEP_DAYS = 7;
const DBS = ["radar.db", "candles.db", "accounts.db"];
const FILES = ["settings.json", "google.json", "fomo-session.json", "candles-state.json", "early-state.json", "holders-state.json", "live-state.json", "launchlab-pools.json", "fomolists.json", "chartstream-usage.json"];
const DIRS = ["profiles"];
const log = (...a) => console.log(new Date().toISOString(), ...a);

function settings() { try { return JSON.parse(fs.readFileSync(path.join(DATA, "settings.json"), "utf8")); } catch { return {}; } }
async function tell(text) {
  const hook = settings().discordWebhook;
  if (!hook) return;
  try { await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: `Blix backup: ${text}`.slice(0, 1900) }) }); } catch {}
}
const has = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;

async function run() {
  if (!KEY || !fs.existsSync(KEY)) throw new Error(`BLIX_BACKUP_KEY must name the key file (got "${KEY}")`);
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, (c) => (c === "T" ? "-" : c === ":" ? "" : "-"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blix-backup-"));
  try {
    for (const name of DBS) {
      const src = path.join(DATA, name);
      if (!fs.existsSync(src)) continue;
      // VACUUM INTO: one read of one snapshot, start to finish. The online backup API (node:sqlite backup) went back
      // to the start every time the radar wrote, which is all the time: the 2026-10-10 run was still going after
      // 8 hours and 1.1 TB of writes, and its open read kept radar.db's log from being folded back (4 GB), which
      // slowed the live site for everyone.
      const db = new DatabaseSync(src, { readOnly: true });
      try { db.exec(`VACUUM INTO '${path.join(tmp, name).replace(/'/g, "''")}'`); } finally { db.close(); }
      log("copied", name, `${(fs.statSync(path.join(tmp, name)).size / 1e6).toFixed(1)} MB`);
    }
    for (const name of FILES) { const src = path.join(DATA, name); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, name)); }
    for (const dir of DIRS) { const src = path.join(DATA, dir); if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, dir), { recursive: true }); }
    const archive = path.join(OUT, `blix-${stamp}.tgz.enc`);
    // tar | gzip | openssl in one pipe: the plain archive never touches the disk.
    execFileSync("sh", ["-c", `tar -C "${tmp}" -cf - . | gzip -6 | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:${KEY}" -out "${archive}"`], { stdio: ["ignore", "inherit", "inherit"] });
    const size = fs.statSync(archive).size;
    if (size < 1000) throw new Error("archive came out empty");
    log("wrote", archive, `${(size / 1e6).toFixed(1)} MB`);
    // Local keep.
    const cutoff = Date.now() - KEEP_DAYS * 86400_000;
    for (const f of fs.readdirSync(OUT)) { const full = path.join(OUT, f); if (/^blix-.*\.enc$/.test(f) && fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); log("removed old", f); } }
    // Off-box copy.
    if (has("rclone")) {
      const remotes = spawnSync("rclone", ["listremotes"], { encoding: "utf8" }).stdout || "";
      if (/^r2:$/m.test(remotes)) {
        execFileSync("rclone", ["copy", "--no-traverse", archive, `r2:${BUCKET}/`], { stdio: "inherit" });
        spawnSync("rclone", ["delete", "--min-age", `${KEEP_DAYS + 1}d`, `r2:${BUCKET}/`], { stdio: "inherit" });
        log("copied to", `r2:${BUCKET}/${path.basename(archive)}`);
      } else log("rclone has no remote named r2: kept locally only (rclone config → new remote r2, type s3, provider Cloudflare)");
    } else log("rclone not installed: kept locally only (sudo apt install rclone)");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

run().catch(async (e) => { log("FAILED", e.message); await tell(`FAILED on ${os.hostname()}: ${e.message}`); process.exit(1); });
