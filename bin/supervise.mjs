// Keeps the radar running: restarts it if it exits, backing off if it keeps crashing.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startWebApp } from "../server/webapp.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
const logFile = path.join(ROOT, "data", "server.log");
let delay = 2000;

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

const up = () => fetch("http://localhost:4420/api/overview", { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false);

// The lightest thing the radar serves (a file kept in memory): tells whether it is answering at all.
const alive = () => fetch("http://localhost:4420/tokens.css", { signal: AbortSignal.timeout(8000) }).then((r) => r.ok).catch(() => false);

async function run() {
  // Another copy is already serving: just keep an eye on it.
  if (await up()) return setTimeout(run, 30_000);
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
  const child = spawn(runtime, ["--no-warnings", "--report-on-fatalerror", "--report-compact", `--report-directory=${reports}`, path.join(ROOT, "server", "server.js")], {
    cwd: ROOT, windowsHide: true, stdio: ["ignore", log, log], env: { ...process.env, BLIX_WEB_EXTERNAL: "1" },
  });
  // A radar that is running but no longer answers is as down as one that crashed, and would otherwise stay
  // that way: once it has answered at least once (or two minutes have passed), four unanswered checks in a
  // row (about a minute) get it stopped, and the exit below starts a fresh one.
  let answered = false, misses = 0, hung = false;
  const watch = setInterval(async () => {
    if (await alive()) { answered = true; misses = 0; return; }
    if (!answered && Date.now() - started < 120_000) return;
    if (++misses >= 4 && !hung) { hung = true; child.kill(); }
  }, 15_000);
  child.on("exit", (code) => {
    clearInterval(watch);
    fs.closeSync(log);
    // A native fault (0xC0000000 and up) or an abort is a crash; anything else is the radar being stopped on purpose.
    const kind = hung ? "hang: stopped answering for a minute" : code === 134 || (code >= 0xC0000000 && code < 0xFFFFFFFF) ? `crash 0x${code.toString(16).toUpperCase()}` : "stopped";
    fs.appendFileSync(logFile, `[supervisor] radar exited with ${code} at ${new Date().toISOString()} after ${Math.round((Date.now() - started) / 60_000)}m (${kind}, node ${runtimeVersion(runtime)})\n`);
    delay = Date.now() - started > 60_000 ? 2000 : Math.min(delay * 2, 60_000);
    setTimeout(run, delay);
  });
}
run();
