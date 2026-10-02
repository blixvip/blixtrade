// Opens Blix in its own window, starting the radar hidden if it isn't running.
// `node bin/open.mjs --background` only makes sure the radar is running (used at login).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_ = `http://localhost:${process.env.RADAR_PORT || 4420}`;
const up = () => fetch(`${URL_}/api/overview`).then((r) => r.ok).catch(() => false);

if (!(await up())) {
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  const log = fs.openSync(path.join(ROOT, "data", "server.log"), "a");
  spawn(process.execPath, [path.join(ROOT, "bin", "supervise.mjs")], {
    cwd: ROOT, detached: true, windowsHide: true, stdio: ["ignore", log, log],
  }).unref();
  for (let i = 0; i < 40 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
}

if (!process.argv.includes("--background")) {
  const chrome = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  ].find((p) => fs.existsSync(p));
  if (chrome) spawn(chrome, [`--app=${URL_}`, "--window-size=1440,920"], { detached: true, stdio: "ignore" }).unref();
  else spawn("explorer.exe", [URL_], { detached: true, stdio: "ignore" }).unref();
}
