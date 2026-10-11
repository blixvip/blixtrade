#!/usr/bin/env node
// The owner's email alerts (blix-alertwatch.timer, every 5 minutes). Looks at what would mean the site is not
// running for people, and emails through the backup sink Worker's /alert (backup-sink/worker.js, locked to the
// owner's verified address) once a problem has lasted a few checks, then once more when it is fixed. A problem
// still there after 6 hours is said again. State in data/alertwatch.json.
//   BLIX_SINK_URL, BLIX_SINK_KEY (file with the key): the same settings the nightly backup uses.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const STATE = path.join(DATA, "alertwatch.json");
const SINK = (process.env.BLIX_SINK_URL || "").replace(/\/+$/, "");
const KEY = (() => { try { return fs.readFileSync(process.env.BLIX_SINK_KEY || "", "utf8").trim(); } catch { return ""; } })();
const REMIND = 6 * 3600e3;

const get = async (url, headers = {}, ms = 20000) => {
  try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms), redirect: "manual" }); return { status: r.status, body: await r.text().catch(() => "") }; }
  catch (e) { return { status: 0, body: String(e?.message || e) }; }
};
const unit = (name) => { try { return execFileSync("systemctl", ["is-active", name], { encoding: "utf8" }).trim(); } catch (e) { return String(e.stdout || "unknown").trim(); } };
const failed = (name) => { try { return execFileSync("systemctl", ["is-failed", name], { encoding: "utf8" }).trim() === "failed"; } catch { return false; } };

// Each check: [id, after how many bad checks in a row to email, () => problem text or null].
const CHECKS = [
  ["site", 2, async () => { const r = await get("https://blixvip.com/"); return r.status === 200 ? null : `blixvip.com answered ${r.status || "nothing"} (${r.body.slice(0, 120)})`; }],
  ["pages", 2, async () => { const r = await get("http://127.0.0.1:4421/api/health"); return r.status === 200 ? null : `The page server on the VM answered ${r.status || "nothing"}`; }],
  ["prices", 3, async () => {
    const r = await get("http://127.0.0.1:4420/api/health", { host: "localhost:4420" }, 30000);
    if (r.status !== 200) return `The radar's health check answered ${r.status || "nothing"}`;
    let j; try { j = JSON.parse(r.body); } catch { return "The radar's health check answered something unreadable"; }
    const f = j.parts?.find((p) => p.key === "freshness"), t = j.parts?.find((p) => p.key === "trades");
    if (f?.state === "down") return `Prices are stale: ${f.summary}`;
    if (t && t.state === "down") return `No trades coming in: ${t.summary}`;
    return null;
  }],
  ["disk", 1, async () => { const st = fs.statfsSync(DATA), free = (st.bavail * st.bsize) / 1e9; return free < 5 ? `Only ${free.toFixed(1)} GB free on the VM's disk (a full disk stops the site)` : null; }],
  ["services", 2, async () => { const down = ["blix", "blix-vault", "cloudflared"].filter((u) => unit(u) !== "active"); return down.length ? `Not running: ${down.join(", ")}` : null; }],
  ["backup", 1, async () => (failed("blix-backup") ? "Last night's backup failed (journalctl -u blix-backup on the VM says why)" : null)],
];

async function mail(subject, text) {
  if (!SINK || !KEY) { console.log("no sink set up:", subject); return false; }
  const r = await fetch(`${SINK}/alert`, { method: "POST", headers: { "x-sink-key": KEY, "content-type": "application/json" }, body: JSON.stringify({ subject, text }), signal: AbortSignal.timeout(30000) }).catch(() => null);
  return Boolean(r?.ok);
}

const state = (() => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; } })();
const now = Date.now(), lines = [];
for (const [id, after, check] of CHECKS) {
  const s = state[id] || (state[id] = { bad: 0, since: 0, sent: 0, text: "" });
  let problem = null;
  try { problem = await check(); } catch (e) { problem = `check failed: ${e.message}`; }
  if (problem) {
    s.bad++; s.text = problem; if (!s.since) s.since = now;
    if (s.bad >= after && (!s.sent || now - s.sent > REMIND)) {
      const again = s.sent ? " (still)" : "";
      if (await mail(`Blix: ${id} problem${again}`, `${problem}\n\nSince ${new Date(s.since).toUTCString()}. The VM restarts the site by itself when it stops answering; this email is so you know.`)) s.sent = now;
    }
  } else {
    if (s.sent) await mail(`Blix: ${id} fixed`, `Fixed: ${s.text}\n\nIt lasted from ${new Date(s.since).toUTCString()} to ${new Date(now).toUTCString()}.`);
    state[id] = { bad: 0, since: 0, sent: 0, text: "" };
  }
  lines.push(`${id}=${problem ? `BAD(${state[id].bad})` : "ok"}`);
}
fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
console.log(new Date().toISOString(), lines.join(" "));
