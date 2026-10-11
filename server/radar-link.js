// What the page server's hosted-accounts routes need from the live radar, over HTTP instead of importing it.
// accounts.js used to import livetrades.js for migrationBlock() and feed.solUsd, which pulled the radar's whole
// module graph (engine, pulse, holders, the fee ledger...) into the page server: a second copy of every startup
// table, ~1.2 GB of heap, and the 2 GB heap limit crash loop of 2026-10-11. Now the radar answers /api/migrating
// (the coins migrating this moment and the SOL price) and this polls it every second; the answers are sync, a
// second old at most, and empty when the radar is away (the chain refuses a trade on a migrating curve anyway).
const RADAR = `http://127.0.0.1:${Number(process.env.BLIX_PORT) || 4420}`;
const MESSAGE = "This coin is migrating to its PumpSwap pool. Trading opens again in a few seconds, as soon as the pool is live.";
let migrating = new Set(), solUsd = 0, at = 0, timer = null;
export const linkStats = { polls: 0, failed: 0, lastOk: 0, lastError: null };

async function poll() {
  linkStats.polls++;
  try {
    const r = await fetch(`${RADAR}/api/migrating`, { signal: AbortSignal.timeout(1500), headers: { host: "localhost:4420" } });
    if (!r.ok) throw new Error(`radar ${r.status}`);
    const j = await r.json();
    migrating = new Set(Array.isArray(j.mints) ? j.mints : []);
    if (j.solUsd > 0) solUsd = j.solUsd;
    at = Date.now(); linkStats.lastOk = at; linkStats.lastError = null;
  } catch (e) { linkStats.failed++; linkStats.lastError = String(e?.message || e); }
}
export function startRadarLink() {
  if (timer) return;
  poll();
  timer = setInterval(poll, 1000);
  timer.unref?.();
}
// Why the coin cannot be traded this moment, else null (an answer older than 10 s is not trusted: nothing is blocked).
export function busyOf(mint) { return Date.now() - at < 10_000 && migrating.has(mint) ? MESSAGE : null; }
export function solUsdNow() { return solUsd; }
