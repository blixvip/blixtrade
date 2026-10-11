// Confirmed observed fees plus explicitly estimated missing-block coverage.
import { db } from './db.js';
import { createFeeLedger } from './fee-ledger.js';
import { metricState } from './metricstate.js';
const KEEP = 7 * 864e5;
db.exec('CREATE TABLE IF NOT EXISTS coin_fees (mint TEXT PRIMARY KEY, sol REAL NOT NULL, txs INTEGER NOT NULL, since INTEGER NOT NULL, at INTEGER NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS coin_fee_ledger (mint TEXT PRIMARY KEY, payload TEXT NOT NULL, at INTEGER NOT NULL)');
const ledger = createFeeLedger(), loaded = new Set(), dirty = new Set();
for (const row of db.prepare('SELECT mint,payload FROM coin_fee_ledger WHERE at > ?').all(Date.now() - KEEP)) {
  try { ledger.restore([JSON.parse(row.payload)]); loaded.add(row.mint); } catch {}
}
for (const row of db.prepare('SELECT * FROM coin_fees WHERE at > ?').all(Date.now() - KEEP)) if (!loaded.has(row.mint)) {
  ledger.restore([{ mint: row.mint, legacyEstimatedSol: row.sol, since: row.since, at: row.at, buckets: [] }]); dirty.add(row.mint);
}
export const feeStats = { coins: loaded.size, txs: 0, sol: 0, cover: 1 };
// Told the moment a coin's fees grow (server.js pushes them to open pages at once: the Pulse columns filter on them).
const feeHooks = [];
export const onFee = (fn) => { feeHooks.push(fn); };
export function addFee(mint, sol, at = Date.now(), signature) {
  if (ledger.add(mint, { sol, at, signature, coverage: feeStats.cover })) { feeStats.txs++; feeStats.sol += sol; for (const fn of feeHooks) fn(mint); }
}
export const updateFeeCoverage = (at, coverage) => ledger.setCoverage(at, coverage);
export const feesOf = mint => ledger.get(mint);
const put = db.prepare('INSERT INTO coin_fee_ledger(mint,payload,at) VALUES(?,?,?) ON CONFLICT(mint) DO UPDATE SET payload=excluded.payload,at=excluded.at');
function publish() {
  for (const mint of ledger.drain()) {
    dirty.add(mint); const f = ledger.get(mint); if (!f) continue;
    metricState.put(mint, { fees: f.sol, feesSince: f.since, feesObserved: f.observedSol, feesEstimated: f.estimatedSol },
      { source: 'confirmed-block-fees', rank: 3, observedAt: f.at, estimated: true, partial: true, coverage: f.coverage, maxAgeMs: 60_000 });
  }
}
setInterval(publish, 500).unref?.();
// Written a slice at a time (about 120 ms every 2 s): a payload is a week of per-minute buckets with their
// signatures, and writing every changed coin in one go held the event loop ~2.5 s every 5 s (Oct 2026, 646
// times in an hour); the rest stay dirty for the next tick.
setInterval(() => {
  publish(); if (!dirty.size) return;
  const t0 = Date.now(), done = [];
  try {
    db.exec('BEGIN');
    for (const mint of dirty) {
      const row = ledger.snapshotOne(mint);
      if (row) put.run(row.mint, JSON.stringify(row), row.at);
      done.push(mint);
      if (done.length % 10 === 0 && Date.now() - t0 > 80) break;
    }
    db.exec('COMMIT');
    for (const mint of done) dirty.delete(mint);
  } catch { try { db.exec('ROLLBACK'); } catch {} }
}, 4000).unref?.();   // 80 ms every 4 s: this writer was 7% of the main thread at 120 ms every 2 s (2026-10-11 profile)
setInterval(() => {
  ledger.prune();
  try { db.prepare('DELETE FROM coin_fee_ledger WHERE at < ?').run(Date.now() - KEEP); } catch {}
}, 3600_000).unref?.();
