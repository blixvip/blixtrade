// Health registry: every outside dependency reports its successes and failures here, so the dashboard
// can show what is actually working (last success, last failure, why) instead of one error counter.
const parts = new Map();

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
