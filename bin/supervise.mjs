// Keeps the radar running: restarts it if it exits, backing off if it keeps crashing.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startWebApp } from "../server/webapp.js";
import { watchChild } from './process-watch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
const logFile = path.join(ROOT, "data", "server.log");
let delay = 2000;
let stopping = false;
const timers = new Set(), children = new Set();
const logLine = text => { try { fs.appendFileSync(logFile, text + '\n'); } catch { try { console.error(text); } catch {} } };
// One supervisor at a time. The keepalive task (every 5 min) and the login shortcut both start one when the radar
// does not answer; if that is only because the radar is restarting, the one already here keeps its job and the
// newcomer leaves. The pid file names the live one; a pid that is no longer a node process is stale.
const PID_FILE = path.join(ROOT, "data", "supervise.pid");
try {
  const other = Number(fs.readFileSync(PID_FILE, "utf8"));
  if (other > 0 && other !== process.pid) {
    const list = spawnSync("tasklist", ["/FI", `PID eq ${other}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).stdout || "";
    if (/node\.exe/i.test(list)) { logLine(`[supervisor] already running as pid ${other}; this one exits`); process.exit(0); }
  }
} catch { /* no pid file yet */ }
try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (e) { logLine(`[supervisor] could not write ${PID_FILE}: ${e.message}`); }
function schedule(fn, ms) {
  if (stopping) return;
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (!stopping) Promise.resolve().then(fn).catch(() => { logLine('[supervisor] start failed; retrying in 30s'); schedule(fn, 30000); });
  }, ms);
  timers.add(timer);
}
function shutdown() {
  if (stopping) return; stopping = true;
  for (const timer of timers) clearTimeout(timer);
  for (const child of children) child.stop();
  // Only this supervisor and the children it spawned; systemd owns remaining service resources.
  setTimeout(() => process.exit(0), 6000);
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

// The page (127.0.0.1:4421) is served from here, not from the radar, so it keeps loading while the radar restarts;
// /api is forwarded to the radar. If an older radar still holds the port, this takes it over within seconds of it exiting.
startWebApp(null, 4420, { retryMs: 2000 });

// Which Node the radar ran on, so a crash in the log can be tied to a runtime.
const versions = new Map();
function runtimeVersion(exe) {
  if (!versions.has(exe)) {
    let v = "?";
    try { v = exe === process.execPath ? process.version : spawnSync(exe, ["--version"], { windowsHide: true, encoding: "utf8" }).stdout.trim(); } catch {}
    versions.set(exe, v);
  }
  return versions.get(exe);
}

const check = async (url, timeout, anyStatus = false) => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(timeout) }); const ok = anyStatus || r.ok; await r.body?.cancel(); return ok; } catch { return false; }
};
const up = () => check("http://127.0.0.1:4420/api/overview", 4000);

// The lightest thing the radar serves (a file kept in memory): tells whether it is answering at all.
const alive = () => check("http://127.0.0.1:4420/tokens.css", 8000);

async function run() {
  // Another copy is already serving: just keep an eye on it.
  if (stopping) return;
  if (await up()) return schedule(run, 30_000);
  if (stopping) return;
  // Keep the log bounded: start fresh once it passes 5 MB.
  try { if (fs.statSync(logFile).size > 5e6) fs.writeFileSync(logFile, ""); } catch {}
  const log = fs.openSync(logFile, "a");
  const started = Date.now();
  // If Node itself gives up (out of memory, an internal fatal error) it leaves a report saying where.
  const reports = path.join(ROOT, "data", "reports");
  fs.mkdirSync(reports, { recursive: true });
  // A project-local Windows runtime lets Blix receive Node fixes without changing other apps.
  const localNode = path.join(ROOT, "data", "runtime", "node.exe");
  const runtime = process.env.BLIX_NODE || (process.platform === "win32" && fs.existsSync(localNode) ? localNode : process.execPath);
  // The radar sits at ~2.3 GB on the VM and died of "heap out of memory" there on 2026-10-09 (report in data/reports);
  // on a machine with room (the VM has 24 GB) it gets an 8 GB heap instead of Node's ~4.5 GB default.
  const heap = os.totalmem() > 16e9 ? ["--max-old-space-size=8192"] : [];
  const child = spawn(runtime, ["--no-warnings", ...heap, "--report-on-fatalerror", "--report-compact", `--report-directory=${reports}`, path.join(ROOT, "server", "server.js")], {
    cwd: ROOT, windowsHide: true, stdio: ["ignore", log, log], env: { ...process.env, BLIX_WEB_EXTERNAL: "1" },
  });
  // A radar that is running but no longer answers is as down as one that crashed, and would otherwise stay
  // that way: once it has answered at least once (or two minutes have passed), four unanswered checks in a
  // row (about a minute) get it stopped, and the exit below starts a fresh one.
  let hung = false;
  const watch = watchChild(child, { probe: alive, onHang: () => { hung = true; }, onExit: (code, signal, error) => {
    children.delete(watch);
    try { fs.closeSync(log); } catch {}
    // A native fault (0xC0000000 and up) or an abort is a crash; anything else is the radar being stopped on purpose.
    const kind = hung ? "hang: stopped answering for a minute" : code === 134 || (code >= 0xC0000000 && code < 0xFFFFFFFF) ? `crash 0x${code.toString(16).toUpperCase()}` : "stopped";
    logLine(`[supervisor] radar exited with ${code ?? signal ?? error?.code ?? 'error'} at ${new Date().toISOString()} after ${Math.round((Date.now() - started) / 60_000)}m (${kind}, node ${runtimeVersion(runtime)})`);
    delay = Date.now() - started > 60_000 ? 2000 : Math.min(delay * 2, 60_000);
    schedule(run, delay);
  } });
  children.add(watch);
}
schedule(run, 0);

// Blix Vault (C:\codelix-vault, beside this folder) signs real trades. Real buy and sell buttons need it,
// so it is kept running here too: started if nothing answers on its port, restarted if it exits.
const VAULT = path.join(ROOT, "..", "blix-vault");
const vaultUp = () => check("http://127.0.0.1:4470/", 3000, true);
let vaultDelay = 2000;
async function runVault() {
  if (stopping || !fs.existsSync(path.join(VAULT, "server", "server.js"))) return;
  if (await vaultUp()) return schedule(runVault, 30_000);
  if (stopping) return;
  const vlog = fs.openSync(path.join(ROOT, "data", "vault.log"), "a");
  const started = Date.now();
  const child = spawn(process.execPath, ["--no-warnings", path.join(VAULT, "server", "server.js")], { cwd: VAULT, windowsHide: true, stdio: ["ignore", vlog, vlog] });
  const watch = watchChild(child, { probe: vaultUp, onExit: (code, signal, error) => {
    children.delete(watch);
    try { fs.closeSync(vlog); } catch {}
    logLine(`[supervisor] vault exited with ${code ?? signal ?? error?.code ?? 'error'} at ${new Date().toISOString()}`);
    vaultDelay = Date.now() - started > 60_000 ? 2000 : Math.min(vaultDelay * 2, 60_000);
    schedule(runVault, vaultDelay);
  } });
  children.add(watch);
}
schedule(runVault, 0);
