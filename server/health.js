// Health registry: every outside dependency reports its successes and failures here, so the dashboard
// can show what is actually working (last success, last failure, why) instead of one error counter.
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const parts = new Map();

// ---------- responsiveness ----------
// The radar does everything on one thread, so any job that runs long holds up every page and every feed.
// Two records: how long the thread was actually held up (worst pause in each 10 seconds), and which named
// piece of work ran long (so a pause has a culprit).
const SLOW_MS = 250;
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
const pauses = [];                            // { t, ms }: 10-second windows whose worst pause passed 200 ms
setInterval(() => {
  const ms = loop.max / 1e6;
  loop.reset();
  if (ms > 200) { pauses.push({ t: Date.now(), ms: Math.round(ms) }); if (pauses.length > 600) pauses.shift(); }
}, 10_000).unref();
const slow = new Map();                       // name -> { name, n, worstMs, lastMs, lastT }
export function noteSlow(name, ms) {
  let s = slow.get(name);
  if (!s) { if (slow.size >= 200) return; s = { name, n: 0, worstMs: 0, lastMs: 0, lastT: 0 }; slow.set(name, s); }
  s.n++; s.lastMs = Math.round(ms); s.lastT = Date.now(); s.worstMs = Math.max(s.worstMs, s.lastMs);
}
// Wraps a piece of work so that a run holding the thread longer than a quarter second is recorded by name.
// For work that awaits, this is the time up to its first wait, which is the part that blocks.
export function timed(name, fn) {
  return function (...args) {
    const t = performance.now();
    try { return fn.apply(this, args); }
    finally { const ms = performance.now() - t; if (ms > SLOW_MS) noteSlow(name, ms); }
  };
}
export function responsiveness() {
  const now = Date.now(), within = (span) => pauses.filter((p) => now - p.t < span);
  const worst = (rows) => rows.reduce((m, p) => Math.max(m, p.ms), 0);
  const day = within(24 * 3600e3);
  return { worst10m: worst(within(10 * 60_000)), worst24h: worst(day), over1s: day.filter((p) => p.ms >= 1000).length,
    slow: [...slow.values()].filter((s) => now - s.lastT < 24 * 3600e3).sort((a, b) => b.worstMs - a.worstMs).slice(0, 8) };
}

function entry(name) {
  let p = parts.get(name);
  if (!p) { p = { name, ok: 0, fail: 0, lastOk: null, lastFail: null, lastError: null, streak: 0 }; parts.set(name, p); }
  return p;
}
export function ok(name) { const p = entry(name); p.ok++; p.lastOk = Date.now(); p.streak = 0; }
export function fail(name, error) { const p = entry(name); p.fail++; p.lastFail = Date.now(); p.lastError = String(error?.message || error || "failed").slice(0, 200); p.streak++; }
export const part = (name) => ({ ...entry(name) });

// ok | degraded | down | idle, from recent history. `staleMs`: how long without a success counts as down.
export function stateOf(name, staleMs = 5 * 60_000) {
  const p = entry(name), now = Date.now();
  if (!p.lastOk && !p.lastFail) return "idle";
  if (!p.lastOk) return "down";
  if (p.lastFail && p.lastFail > p.lastOk) return p.streak >= 3 || now - p.lastOk > staleMs ? "down" : "degraded";
  if (now - p.lastOk > staleMs) return "degraded";
  return p.lastFail && now - p.lastFail < 10 * 60_000 ? "degraded" : "ok";
}

// Gaps in the radar's own heartbeat: the PC slept, or the process was stopped.
export const gaps = [];
let beat = Date.now();
export function heartbeat() {
  const now = Date.now();
  if (now - beat > 3 * 60_000) { gaps.push({ from: beat, to: now }); if (gaps.length > 20) gaps.shift(); }
  beat = now;
  return gaps[gaps.length - 1];
}
