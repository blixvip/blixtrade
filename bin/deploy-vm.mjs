#!/usr/bin/env node
// Ship this checkout to the server (the Oracle VM, /opt/blix) in one step, safely, so a deploy never knocks the
// site over for longer than one restart and never overwrites work another session put on the server.
//
//   node bin/deploy-vm.mjs              build the web app, then ship what changed (asks nothing; refuses on danger)
//   node bin/deploy-vm.mjs --dry-run    show what would ship, change nothing
//   node bin/deploy-vm.mjs --no-build   skip the web build (web/dist as it is)
//   node bin/deploy-vm.mjs --no-web     server files only: no build, web/dist not shipped (another session's web work stays here)
//   node bin/deploy-vm.mjs --adopt      accept the server's current files as the baseline (first run, or after a
//                                       hand copy you have checked), then ship
//   node bin/deploy-vm.mjs --force a.js b.js   overwrite these server files even if they changed on the server
//   node bin/deploy-vm.mjs --only server/a.js  ship just these server files (others' unshipped work stays here)
//
// What it does:
// 1. Hashes server/*.js and bin/*.mjs here and there (line endings ignored). A file that differs from the server
//    and that the server changed since the last deploy by this script (data/deploy-manifest.json there) is
//    refused: someone shipped it by hand, so this copy may be missing their work. Merge it first, or --force.
// 2. Every `./x.js` a shipped server file imports must exist after the deploy (a missing module crash-loops).
// 3. web/dist goes first, assets before index.html, with no restart (static files).
// 4. Server files: the old ones are copied to data/deploy-backups/<time>/, the new ones put in place, blix
//    restarted once, and /api/health polled until it answers. No answer in 90 s: the backup goes back and blix
//    restarts again.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.BLIX_VM || "ubuntu@129.146.62.88";
const KEY = process.env.BLIX_VM_KEY || path.join(os.homedir(), ".ssh", "model_radar_vm");
const REMOTE = "/opt/blix";
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const forced = new Set(args.filter((a) => !a.startsWith("--")).map((a) => a.replace(/\\/g, "/").replace(/^\.\//, "")));
const DRY = flag("--dry-run"), ADOPT = flag("--adopt"), ONLY = flag("--only"), NO_WEB = flag("--no-web");
// --force with --only: the named files override "changed on the server" (without --only every named file is forced).
const FORCE = flag("--force");

const SSH = ["-i", KEY, "-o", "ConnectTimeout=20", "-o", "BatchMode=yes"];
const ssh = (cmd, input) => {
  const r = spawnSync("ssh", [...SSH, HOST, cmd], { input, encoding: input && typeof input !== "string" ? undefined : "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ssh failed (${r.status}): ${String(r.stderr || "").slice(0, 400)}`);
  return String(r.stdout || "");
};
const say = (s) => console.log(s);
const hash = (buf) => crypto.createHash("sha256").update(Buffer.from(String(buf).replace(/\r\n/g, "\n"))).digest("hex").slice(0, 16);

// ---------- 1. build ----------
if (!flag("--no-build") && !NO_WEB && !DRY) {
  say("Building the web app…");
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "build"], { cwd: path.join(ROOT, "web"), stdio: "inherit", shell: process.platform === "win32" });
}

// ---------- 2. what differs ----------
const local = new Map();
for (const dir of ["server", "bin"]) for (const f of fs.readdirSync(path.join(ROOT, dir))) {
  if (!/\.(m?js)$/.test(f)) continue;
  local.set(`${dir}/${f}`, hash(fs.readFileSync(path.join(ROOT, dir, f))));
}
const remoteHashes = new Map(), manifest = new Map();
const out = ssh(`cd ${REMOTE} && for f in server/*.js server/*.mjs bin/*.mjs bin/*.js; do [ -f "$f" ] && printf '%s ' "$f" && tr -d '\\r' < "$f" | sha256sum | cut -c1-16; done; echo '--manifest--'; cat data/deploy-manifest.json 2>/dev/null || echo '{}'`);
const [list, man] = out.split("--manifest--");
for (const line of list.trim().split("\n")) { const [f, h] = line.trim().split(/\s+/); if (f && h) remoteHashes.set(f, h); }
try { for (const [f, h] of Object.entries(JSON.parse(man.trim() || "{}"))) manifest.set(f, h); } catch {}

const ship = [], refused = [];
for (const [f, h] of local) {
  const there = remoteHashes.get(f);
  if (there === h) continue;
  if (ONLY && !forced.has(f)) continue;
  const touchedThere = there && manifest.size && manifest.get(f) !== there;
  if (there && (!manifest.size && !ADOPT) && !(forced.has(f) && (!ONLY || FORCE))) { refused.push(`${f} (no deploy record on the server yet: run with --adopt once you have checked it)`); continue; }
  if (touchedThere && !(forced.has(f) && (!ONLY || FORCE)) && !ADOPT) { refused.push(`${f} (changed on the server since the last deploy: merge that change first, or --force ${f})`); continue; }
  ship.push(f);
}
const serverOnly = [...remoteHashes.keys()].filter((f) => !local.has(f));

// ---------- 3. imports ----------
const after = new Set([...remoteHashes.keys(), ...ship]);
const missing = [];
for (const f of ship.filter((x) => x.startsWith("server/"))) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  for (const m of src.matchAll(/from\s+["']\.\/([\w.-]+\.m?js)["']|import\(\s*["']\.\/([\w.-]+\.m?js)["']\s*\)/g)) {
    const dep = `server/${m[1] || m[2]}`;
    if (!after.has(dep) && !local.has(dep)) missing.push(`${f} imports ${dep}, which exists nowhere`);
    else if (!after.has(dep)) { if (!ship.includes(dep)) ship.push(dep); after.add(dep); }
  }
}

say(`Server files to ship: ${ship.length ? ship.join(", ") : "none"}`);
if (refused.length) say(`Refused:\n  ${refused.join("\n  ")}`);
if (serverOnly.length) say(`On the server only (left alone): ${serverOnly.join(", ")}`);
if (missing.length) { say(`Stopped: ${missing.join("; ")}`); process.exit(1); }
if (refused.length && !ship.length && !fs.existsSync(path.join(ROOT, "web", "dist", "index.html"))) process.exit(1);
if (DRY) { say("Dry run: nothing changed."); process.exit(refused.length ? 2 : 0); }

// One deploy at a time on the server: an ssh session holds flock on data/deploy.lock until this script ends
// (or dies: the closed connection lets the lock go).
{
  const { spawn } = await import("node:child_process");
  const lock = spawn("ssh", [...SSH, HOST, `mkdir -p ${REMOTE}/data && exec flock -w 120 ${REMOTE}/data/deploy.lock sh -c 'echo LOCKED; cat >/dev/null'`], { stdio: ["pipe", "pipe", "inherit"] });
  const got = await new Promise((res) => {
    let out = "";
    lock.stdout.on("data", (b) => { out += b; if (out.includes("LOCKED")) res(true); });
    lock.on("exit", () => res(false));
  });
  if (!got) { say("Stopped: another deploy held the server lock for 120 s."); process.exit(1); }
  lock.stdout.removeAllListeners("data"); lock.stdout.resume(); lock.unref(); lock.stdout.unref?.(); lock.stdin.unref?.();
  process.on("exit", () => { try { lock.stdin.end(); lock.kill(); } catch {} });
  say("Holding the server deploy lock.");
}

// ---------- 4. web (no restart) ----------
const dist = path.join(ROOT, "web", "dist");
if (!NO_WEB && fs.existsSync(path.join(dist, "index.html"))) {
  // The page's scripts compressed at the best level ahead of time (the server sends those copies as they are).
  try { execFileSync(process.execPath, [path.join(ROOT, "scripts", "precompress.mjs")], { stdio: "inherit" }); } catch { say("precompress failed: the server compresses on first read instead"); }
  // index.html is read once, now: another session may rebuild web/dist mid-deploy, and the page must only ever
  // name files that are already on the server.
  const page = fs.readFileSync(path.join(dist, "index.html"));
  const named = [...new Set(String(page).match(/assets\/[A-Za-z0-9_.-]+\.[a-z0-9]+/g) || [])];
  // Only the built files the server does not have yet (hashed names never change content): web/dist/assets keeps
  // a week of older builds, ~50 MB, which used to go up whole on every deploy.
  const there = new Set(ssh(`ls ${REMOTE}/web/dist/assets 2>/dev/null || true`).split("\n").map((x) => x.trim()).filter(Boolean));
  const lost = named.filter((f) => !there.has(f.slice(7)) && !fs.existsSync(path.join(dist, f)));
  if (lost.length) { say(`Stopped: index.html names files that are neither built here nor on the server: ${lost.join(", ")}`); process.exit(1); }
  const fresh = fs.readdirSync(path.join(dist, "assets")).filter((f) => !there.has(f)).map((f) => `assets/${f}`);
  const rest = fs.readdirSync(dist).filter((x) => x !== "index.html" && x !== "assets" && !x.endsWith(".html.bak"));
  say(`Shipping web/dist (${fresh.length} new asset files, then index.html)…`);
  // The archive is named relative to its folder: Windows tar reads "C:" in a path as a remote host.
  const tgz = path.join(os.tmpdir(), `blix-dist-${process.pid}.tgz`);
  // The names go in a list file: thousands of asset files on the command line overflowed it (ENAMETOOLONG, 2026-10-11).
  const listFile = path.join(os.tmpdir(), "blix-dist-files.txt");
  fs.writeFileSync(listFile, [...rest, ...fresh].join(String.fromCharCode(10)) + String.fromCharCode(10));
  execFileSync("tar", ["czf", path.basename(tgz), "-C", dist, "-T", listFile], { cwd: os.tmpdir() });
  ssh(`mkdir -p /tmp/blix-dist && cat > /tmp/blix-dist/d.tgz && cd ${REMOTE}/web/dist && tar xzf /tmp/blix-dist/d.tgz`, fs.readFileSync(tgz));
  // The server checks every file the new page names before the page goes in; one missing and the old page stays.
  const check = named.map((f) => `[ -s ${f} ] || { echo "missing ${f}"; bad=1; }`).join("; ");
  const res = ssh(`cd ${REMOTE}/web/dist && cat > index.html.new && bad=0; ${check || "true"}; if [ $bad = 0 ]; then mv index.html.new index.html; echo SWAPPED; else rm -f index.html.new; fi`, page);
  if (!res.includes("SWAPPED")) { fs.rmSync(tgz, { force: true }); say(`Stopped: index.html not swapped, ${res.trim().split("\n").join("; ")}`); process.exit(1); }
  fs.rmSync(tgz, { force: true });
}

// ---------- 4b. the Forge (forge/: the editor, its runtime, the backgrounds; no restart) ----------
// Every file under forge/ the server lacks: the runtime, models and pictures by size (big, never edited), the
// editor's own files by content. --no-web leaves it alone too. forge/setup.mjs fetches the runtime here first.
if (!NO_WEB && fs.existsSync(path.join(ROOT, "forge", "index.html"))) {
  const FORGE_HEAVY = /^(vendor|models|bg|thumb|fonts)\//;
  const walk = (dir, base = "") => fs.readdirSync(dir).flatMap((n) => fs.statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n), base + n + "/") : [base + n]);   // statSync: follows linked folders
  const mine = walk(path.join(ROOT, "forge")).filter((f) => !/^(setup\.mjs|UPSTREAM)$/.test(f) && !/(^|\/)\./.test(f));
  const out = ssh(`cd ${REMOTE}/forge 2>/dev/null || exit 0; find . -type f -printf '%P %s\\n'; echo '--hashes--'; find . -type f -not -path './vendor/*' -not -path './models/*' -not -path './bg/*' -not -path './thumb/*' -not -path './fonts/*' -exec sh -c 'printf "%s " "$1"; tr -d "\\r" < "$1" | sha256sum | cut -c1-16' _ {} \\;`);
  const [sizes, hashes] = out.split("--hashes--");
  const thereSize = new Map(), thereHash = new Map();
  for (const l of (sizes || "").trim().split("\n")) { const [f, s] = l.trim().split(/\s+/); if (f) thereSize.set(f, Number(s)); }
  for (const l of (hashes || "").trim().split("\n")) { const [f, h] = l.trim().split(/\s+/); if (f && h) thereHash.set(f.replace(/^\.\//, ""), h); }
  const ship = mine.filter((f) => FORGE_HEAVY.test(f) ? thereSize.get(f) !== fs.statSync(path.join(ROOT, "forge", f)).size : thereHash.get(f) !== hash(fs.readFileSync(path.join(ROOT, "forge", f))));
  if (ship.length) {
    const bytes = ship.reduce((n, f) => n + fs.statSync(path.join(ROOT, "forge", f)).size, 0);
    say(`Shipping forge/ (${ship.length} files, ${(bytes / 1048576).toFixed(1)} MB)…`);
    const tgz = path.join(os.tmpdir(), `blix-forge-${process.pid}.tgz`), listFile = path.join(os.tmpdir(), "blix-forge-files.txt");
    fs.writeFileSync(listFile, ship.map((f) => `forge/${f}`).join(String.fromCharCode(10)) + String.fromCharCode(10));
    execFileSync("tar", ["czf", path.basename(tgz), "-C", ROOT, "-T", listFile], { cwd: os.tmpdir() });
    ssh(`mkdir -p /tmp/blix-dist ${REMOTE}/forge && cat > /tmp/blix-dist/f.tgz && cd ${REMOTE} && tar xzf /tmp/blix-dist/f.tgz && rm -f /tmp/blix-dist/f.tgz`, fs.readFileSync(tgz));
    fs.rmSync(tgz, { force: true });
  } else say("forge/: the server has every file.");
}

// ---------- 5. server (one restart, rollback on failure) ----------
const record = () => {
  const m = Object.fromEntries(manifest);
  for (const [f, h] of remoteHashes) if (!(f in m) || ADOPT) m[f] = h;
  for (const f of ship) m[f] = local.get(f);
  ssh(`cat > ${REMOTE}/data/deploy-manifest.json`, JSON.stringify(m, null, 1));
};
if (!ship.length) { if (ADOPT) record(); say("No server change: no restart."); process.exit(refused.length ? 2 : 0); }
// The test suite gates a server deploy (about 25 s): a file that breaks a test never reaches the VM. --no-test skips it.
if (!flag("--no-test") && !DRY) {
  say("Running the tests before shipping…");
  const t = spawnSync("npm", ["test"], { stdio: "inherit", shell: true });
  if (t.status !== 0) { say("Tests failed: nothing shipped (--no-test to ship anyway)."); process.exit(3); }
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const bak = `${REMOTE}/data/deploy-backups/${stamp}`;
const tgz = path.join(os.tmpdir(), `blix-server-${process.pid}.tgz`);
execFileSync("tar", ["czf", path.basename(tgz), "-C", ROOT, ...ship], { cwd: os.tmpdir() });
say(`Backing up and shipping ${ship.length} server file(s)…`);
ssh(`set -e; cd ${REMOTE}; mkdir -p ${bak}; for f in ${ship.join(" ")}; do [ -f "$f" ] && mkdir -p ${bak}/$(dirname $f) && cp -p "$f" ${bak}/$f || true; done; cat > /tmp/blix-server.tgz; tar xzf /tmp/blix-server.tgz -C ${REMOTE}`, fs.readFileSync(tgz));
fs.rmSync(tgz, { force: true });
for (const f of ship.filter((x) => x.startsWith("server/"))) {
  try { ssh(`cd ${REMOTE} && node --check ${f}`); } catch (e) { say(`Syntax check failed for ${f}: restoring.`); ssh(`cd ${REMOTE} && cp -rp ${bak}/. ${REMOTE}/`); process.exit(1); }
}
say("Restarting blix once…");
ssh("sudo systemctl restart blix");
const healthy = () => { try { return /"parts"/.test(ssh(`curl -s --max-time 8 http://127.0.0.1:4421/api/health`)); } catch { return false; } };
const t0 = Date.now();
let ok = false;
while (Date.now() - t0 < 90_000) { spawnSync(process.execPath, ["-e", "setTimeout(()=>{},4000)"]); if (healthy()) { ok = true; break; } }
if (!ok) {
  say("Health did not come back in 90 s: putting the old files back and restarting.");
  ssh(`cd ${REMOTE} && cp -rp ${bak}/. ${REMOTE}/ && for f in ${ship.join(" ")}; do [ -f ${bak}/$f ] || rm -f "$f"; done; sudo systemctl restart blix`);
  process.exit(1);
}
record();
say(`Done in ${Math.round((Date.now() - t0) / 1000)} s. Backup: ${bak}`);
