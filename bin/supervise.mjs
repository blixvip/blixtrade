// Keeps the radar running: restarts it if it exits, backing off if it keeps crashing.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
const logFile = path.join(ROOT, "data", "server.log");
let delay = 2000;

const up = () => fetch("http://localhost:4420/api/overview", { signal: AbortSignal.timeout(4000) }).then((r) => r.ok).catch(() => false);

async function run() {
  // Another copy is already serving: just keep an eye on it.
  if (await up()) return setTimeout(run, 30_000);
  // Keep the log bounded: start fresh once it passes 5 MB.
  try { if (fs.statSync(logFile).size > 5e6) fs.writeFileSync(logFile, ""); } catch {}
  const log = fs.openSync(logFile, "a");
  const started = Date.now();
  const child = spawn(process.execPath, ["--no-warnings", path.join(ROOT, "server", "server.js")], {
    cwd: ROOT, windowsHide: true, stdio: ["ignore", log, log],
  });
  child.on("exit", (code) => {
    fs.appendFileSync(logFile, `[supervisor] radar exited with ${code} at ${new Date().toISOString()}\n`);
    delay = Date.now() - started > 60_000 ? 2000 : Math.min(delay * 2, 60_000);
    setTimeout(run, delay);
  });
}
run();
