// What traders have paid to trade each coin, in SOL, on top of the trades themselves: the network fee (base +
// priority) and their tips and bot fees (blockworker.js feeOf), like Axiom's "F" (global fees paid). Fed by the
// block follower (journalfeed.js onBlock) with every pump.fun and PumpSwap transaction in the blocks it reads; a
// transaction trading several coins is split between them. The follower reads most blocks, not all (the free
// sources give ~2.5-3 of the chain's ~4.6 a second, 2026-10-09), so each block's share is scaled by the share of
// blocks read lately: an estimate, close on a busy coin. Counting began 2026-10-10: `since` says from when, so a
// coin older than that shows what it paid since. Kept in radar.db (coin_fees), 7 days after its last trade.
import { db } from "./db.js";

const KEEP = 7 * 86400_000;
db.exec("CREATE TABLE IF NOT EXISTS coin_fees (mint TEXT PRIMARY KEY, sol REAL NOT NULL, txs INTEGER NOT NULL, since INTEGER NOT NULL, at INTEGER NOT NULL)");
const fees = new Map();   // mint -> { sol, txs, since, at }
for (const r of db.prepare("SELECT mint, sol, txs, since, at FROM coin_fees WHERE at > ?").all(Date.now() - KEEP)) fees.set(r.mint, { sol: r.sol, txs: r.txs, since: r.since, at: r.at });
const dirty = new Set();
export const feeStats = { coins: 0, txs: 0, sol: 0, cover: 1 };

// `sol`: what one transaction paid toward this coin, already scaled for the blocks not read.
export function addFee(mint, sol, at = Date.now()) {
  if (!(sol > 0) || !mint) return;
  let f = fees.get(mint);
  if (!f) { f = { sol: 0, txs: 0, since: at, at }; fees.set(mint, f); }
  f.sol += sol; f.txs++; f.at = Math.max(f.at, at);
  dirty.add(mint);
  feeStats.txs++; feeStats.sol += sol;
}
// { sol, since } or null (no trade of it seen in a block yet).
export function feesOf(mint) {
  const f = fees.get(mint);
  return f ? { sol: Math.round(f.sol * 1000) / 1000, since: f.since } : null;
}

const putQ = db.prepare("INSERT INTO coin_fees (mint, sol, txs, since, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(mint) DO UPDATE SET sol = excluded.sol, txs = excluded.txs, at = excluded.at");
setInterval(() => {
  feeStats.coins = fees.size;
  if (!dirty.size) return;
  try {
    db.exec("BEGIN");
    for (const m of dirty) { const f = fees.get(m); if (f) putQ.run(m, f.sol, f.txs, f.since, f.at); }
    db.exec("COMMIT");
    dirty.clear();
  } catch { try { db.exec("ROLLBACK"); } catch {} }
}, 30_000).unref?.();
setInterval(() => {
  const cut = Date.now() - KEEP;
  for (const [m, f] of fees) if (f.at < cut) fees.delete(m);
  try { db.prepare("DELETE FROM coin_fees WHERE at < ?").run(cut); } catch {}
}, 3600_000).unref?.();
