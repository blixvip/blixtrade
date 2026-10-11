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
// While no off-box remote is set up the archives sit on the same disk as the live databases: only the newest few are
// kept (each is ~2.5 GB), and a run that would leave the disk short is skipped, since a full disk stops the radar's
// writes and takes the site down. A skipped or failed night says so on the Discord webhook when there is one.
const KEEP_LOCAL = 2;
const MIN_FREE_AFTER = 6e9;   // bytes the disk must still have once this run's copies and archive are written
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

// The backup sink (backup-sink/worker.js): BLIX_SINK_URL, and BLIX_SINK_KEY naming the file with its key. The archive
// goes up in equal 64 MB parts (each retried), then the newest KEEP_OFF archives stay there and older ones go.
const SINK = (process.env.BLIX_SINK_URL || "").replace(/\/+$/, "");
const SINK_KEY = (() => { try { return fs.readFileSync(process.env.BLIX_SINK_KEY || "", "utf8").trim(); } catch { return ""; } })();
const KEEP_OFF = 3, PART = 64 << 20;
async function sink(method, route, body) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(`${SINK}${route}`, { method, body, headers: { "x-sink-key": SINK_KEY }, signal: AbortSignal.timeout(300_000) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      if (r.status < 500 || i >= 3) throw new Error(`${route.split("?")[0]} ${r.status} ${j.error || ""}`);
    } catch (e) { if (i >= 3) throw e; }
    await new Promise((ok) => setTimeout(ok, 5000 * (i + 1)));
  }
}
async function push(file) {
  const key = path.basename(file), q = `key=${encodeURIComponent(key)}`;
  const { uploadId } = await sink("POST", `/mp/create?${q}`);
  const parts = [], fd = fs.openSync(file, "r"), size = fs.statSync(file).size;
  try {
    for (let n = 1, at = 0; at < size; n++, at += PART) {
      const buf = Buffer.alloc(Math.min(PART, size - at));
      fs.readSync(fd, buf, 0, buf.length, at);
      parts.push(await sink("PUT", `/mp/part?${q}&uploadId=${encodeURIComponent(uploadId)}&part=${n}`, buf));
    }
    const done = await sink("POST", `/mp/complete?${q}&uploadId=${encodeURIComponent(uploadId)}`, JSON.stringify(parts));
    if (done.size !== size) throw new Error(`sink has ${done.size} bytes, the archive is ${size}`);
  } catch (e) {
    await sink("POST", `/mp/abort?${q}&uploadId=${encodeURIComponent(uploadId)}`).catch(() => {});
    throw e;
  } finally { fs.closeSync(fd); }
  log("copied off-box", key, `${(size / 1e6).toFixed(1)} MB in ${parts.length} parts`);
  const there = (await sink("GET", "/list")).filter((o) => /^blix-.*\.enc$/.test(o.key)).sort((a, b) => String(b.uploaded).localeCompare(String(a.uploaded)));
  for (const o of there.slice(KEEP_OFF)) { await sink("DELETE", `/obj?key=${encodeURIComponent(o.key)}`); log("removed off-box", o.key); }
}

async function run() {
  if (!KEY || !fs.existsSync(KEY)) throw new Error(`BLIX_BACKUP_KEY must name the key file (got "${KEY}")`);
  fs.mkdirSync(OUT, { recursive: true });
  // Room check: the copies (about the size of the databases) plus the archive (about half that) must fit with
  // MIN_FREE_AFTER to spare. /tmp and data/ are the same disk on the VM.
  const need = DBS.reduce((t, n) => { try { return t + fs.statSync(path.join(DATA, n)).size; } catch { return t; } }, 0) * 1.6;
  const st = fs.statfsSync(DATA), free = st.bavail * st.bsize;
  if (free - need < MIN_FREE_AFTER) throw new Error(`skipped: ${(free / 1e9).toFixed(1)} GB free, this run needs about ${(need / 1e9).toFixed(1)} GB and ${MIN_FREE_AFTER / 1e9} GB must stay free`);
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
    // Local keep: KEEP_DAYS, and never more than the newest KEEP_LOCAL archives.
    const cutoff = Date.now() - KEEP_DAYS * 86400_000;
    const mine = fs.readdirSync(OUT).filter((f) => /^blix-.*\.enc$/.test(f)).map((f) => ({ f, full: path.join(OUT, f), t: fs.statSync(path.join(OUT, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    mine.forEach((a, i) => { if (i >= KEEP_LOCAL || a.t < cutoff) { fs.unlinkSync(a.full); log("removed old", a.f); } });
    // Off-box copy: the backup sink Worker (backup-sink/, R2 bucket blix-backups) when it is set up, else rclone.
    if (SINK && SINK_KEY) await push(archive);
    else if (has("rclone")) {
      const remotes = spawnSync("rclone", ["listremotes"], { encoding: "utf8" }).stdout || "";
      if (/^r2:$/m.test(remotes)) {
        execFileSync("rclone", ["copy", "--no-traverse", archive, `r2:${BUCKET}/`], { stdio: "inherit" });
        spawnSync("rclone", ["delete", "--min-age", `${KEEP_DAYS + 1}d`, `r2:${BUCKET}/`], { stdio: "inherit" });
        log("copied to", `r2:${BUCKET}/${path.basename(archive)}`);
      } else log("rclone has no remote named r2: kept locally only (rclone config → new remote r2, type s3, provider Cloudflare)");
    } else log("rclone not installed: kept locally only (sudo apt install rclone)");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// --push-latest: send the newest local archive to the sink without making a new one.
const latest = () => { const a = fs.readdirSync(OUT).filter((f) => /^blix-.*\.enc$/.test(f)).map((f) => path.join(OUT, f)).sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0]; if (!a) throw new Error("no local archive"); return a; };
(process.argv.includes("--push-latest") ? (async () => { if (!SINK || !SINK_KEY) throw new Error("BLIX_SINK_URL / BLIX_SINK_KEY not set"); await push(latest()); })() : run()).catch(async (e) => { log("FAILED", e.message); await tell(`FAILED on ${os.hostname()}: ${e.message}`); process.exit(1); });
