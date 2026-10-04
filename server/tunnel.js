// The public door: blixvip.com/trade. At startup Blix opens a Cloudflare quick tunnel to itself
// (`cloudflared tunnel --url http://localhost:4420`, no account needed), reads the trycloudflare.com
// address cloudflared prints, and registers it with the Worker on trade.blixvip.com (worker/index.js),
// which forwards every visitor there. The tunnel is restarted if it dies and re-registered whenever its
// address changes. Switched off by blanking settings.publicHost or settings.tunnelKey.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { settings } from "./settings.js";
import { logEvent } from "./db.js";
import * as health from "./health.js";

const CANDIDATES = ["C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe", "cloudflared"];
const now = () => Date.now();
export const tunnelStats = { on: false, exe: null, url: null, since: null, registered: null, registerError: null, restarts: 0, lastExit: null, lastError: null };
let child = null, delay = 3000, stopped = false;

function exe() { return CANDIDATES.find((c) => c === "cloudflared" || fs.existsSync(c)) || null; }
const enabled = () => Boolean(settings.publicHost && settings.tunnelKey);

async function register(url) {
  try {
    const r = await fetch(`https://${settings.publicHost}/__register`, { method: "POST", headers: { "content-type": "application/json", "x-reg-key": settings.tunnelKey }, body: JSON.stringify({ origin: url }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`register ${r.status}: ${(await r.text()).slice(0, 120)}`);
    tunnelStats.registered = now(); tunnelStats.registerError = null;
    health.ok("tunnel");
    logEvent("system", `Remote access live: https://${settings.publicHost} → ${url}`);
  } catch (e) {
    tunnelStats.registerError = e.message; health.fail("tunnel", e);
    logEvent("error", `tunnel register: ${e.message}`);
    setTimeout(() => { if (tunnelStats.url === url && !stopped) register(url); }, 30_000);
  }
}

function start(port) {
  if (stopped || !enabled()) return;
  const bin = exe();
  tunnelStats.exe = bin;
  if (!bin) { tunnelStats.lastError = "cloudflared is not installed"; health.fail("tunnel", tunnelStats.lastError); return; }
  tunnelStats.on = true;
  // http2 rather than the default QUIC transport: the live event stream never came through QUIC (held back until close).
  child = spawn(bin, ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://localhost:${port}`], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const started = now();
  let buf = "";
  const onLine = (chunk) => {
    buf += chunk.toString();
    const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== tunnelStats.url) { tunnelStats.url = m[0]; tunnelStats.since = now(); register(m[0]); }
    if (/error|failed/i.test(buf) && buf.length > 20_000) buf = buf.slice(-4000);
    if (buf.length > 60_000) buf = buf.slice(-8000);
  };
  child.stdout.on("data", onLine);
  child.stderr.on("data", onLine);
  child.on("exit", (code) => {
    child = null; tunnelStats.lastExit = { code, t: now() }; tunnelStats.url = null;
    if (stopped) return;
    tunnelStats.restarts++;
    delay = now() - started > 60_000 ? 3000 : Math.min(delay * 2, 60_000);
    health.fail("tunnel", `cloudflared exited with ${code}`);
    setTimeout(() => start(port), delay);
  });
}

export function startTunnel(port) {
  // Starts now if a public hostname and tunnel key are set, or as soon as they are saved in Settings.
  const tryStart = () => { if (!tunnelStats.on && enabled()) start(port); };
  tryStart();
  setInterval(tryStart, 30_000);
  // Re-register every 10 minutes in case the Worker's record was lost (a redeploy clears nothing, but be safe).
  setInterval(() => { if (tunnelStats.url) register(tunnelStats.url); }, 10 * 60_000);
}
export function stopTunnel() { stopped = true; try { child?.kill(); } catch {} }
