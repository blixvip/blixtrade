// Creator rewards for a Blix wallet: what it earns as the creator of pump.fun coins, over time.
// What can be claimed right now comes from the vault (it reads the wallet's two creator vaults: SOL on the
// Pump program for coins on the curve, wrapped SOL on PumpSwap for coins that bonded). The history is read
// here from the chain: each transaction that touched either vault and how far it moved its balance (a trade
// pays in, a claim takes out). Each one is read once and kept in accounts.db.
import * as sol from "./solana.js";

const LAMPORTS = 1e9, VAULT_RENT = 890_880;
const READS_PER_LOOK = 40;           // transactions read per request; a busy coin's history fills in over a few looks
const SIGS_PER_VAULT = 1000;         // the newest this many per vault (one RPC page)

let db = null;
export function initCreator(adb) {
  db = adb;
  db.exec(`CREATE TABLE IF NOT EXISTS creator_txs (vault TEXT NOT NULL, sig TEXT NOT NULL, t INTEGER NOT NULL, lamports INTEGER NOT NULL, PRIMARY KEY (vault, sig));
    CREATE INDEX IF NOT EXISTS creator_txs_t ON creator_txs(vault, t);`);
}

// How far `tx` moved `vault`'s balance, in lamports: SOL for the curve vault, wrapped SOL (a token balance) for the pool's.
export function vaultDelta(tx, vault, token) {
  const keys = (tx?.transaction?.message?.accountKeys || []).map((k) => (typeof k === "string" ? k : k.pubkey));
  const i = keys.indexOf(vault);
  if (i < 0 || !tx.meta) return 0;
  if (!token) {
    const pre = tx.meta.preBalances[i] ?? 0, post = tx.meta.postBalances[i] ?? 0;
    return pre === 0 && post > 0 ? Math.max(0, post - VAULT_RENT) : post - pre;   // the trade that opened the vault also paid its rent
  }
  const amount = (list) => Number((list || []).find((b) => b.accountIndex === i)?.uiTokenAmount?.amount || 0);
  return amount(tx.meta.postTokenBalances) - amount(tx.meta.preTokenBalances);
}

// Lifetime earnings as a running total, one point per transaction that paid in (claims do not lower it).
export function earnedSeries(rows) {
  let sum = 0;
  return rows.filter((r) => r.lamports > 0).sort((a, b) => a.t - b.t).map((r) => [r.t, (sum += r.lamports) / LAMPORTS]);
}

const looking = new Map();
async function catchUp(vault, token) {
  const sigs = (await sol.rpc("getSignaturesForAddress", [vault, { limit: SIGS_PER_VAULT }]).catch(() => [])) || [];
  const have = new Set(db.prepare("SELECT sig FROM creator_txs WHERE vault = ?").all(vault).map((r) => r.sig));
  const todo = sigs.filter((s) => !s.err && !have.has(s.signature));
  const put = db.prepare("INSERT OR IGNORE INTO creator_txs (vault, sig, t, lamports) VALUES (?, ?, ?, ?)");
  for (const s of todo.slice(0, READS_PER_LOOK)) {
    const tx = await sol.transaction(s.signature).catch(() => null);
    if (!tx) continue;
    put.run(vault, s.signature, (tx.blockTime || s.blockTime || 0) * 1000, vaultDelta(tx, vault, token));
  }
  return Math.max(0, todo.length - READS_PER_LOOK);
}

// { unclaimed: { curve, pool, total }, earned, claimed, series, partial, coins }. `due` is the vault's answer
// (rewards), `txs` the wallet's ledger (launches and claims).
export async function creatorRewards(due, txs) {
  const vaults = [[due.curveVault, false], [due.poolVault, true]].filter(([v]) => v);
  const key = vaults.map(([v]) => v).join(",");
  if (!looking.has(key)) looking.set(key, Promise.all(vaults.map(([v, t]) => catchUp(v, t))).finally(() => looking.delete(key)));
  const left = await looking.get(key).catch(() => [1]);
  const rows = vaults.flatMap(([v]) => db.prepare("SELECT t, lamports FROM creator_txs WHERE vault = ? ORDER BY t").all(v));
  const ok = (txs || []).filter((x) => x.status === "confirmed" || x.status === "sent");
  const claimed = ok.filter((x) => x.kind === "claim").reduce((a, x) => a + (+x.sol || 0), 0);
  const series = earnedSeries(rows);
  const earned = Math.max(claimed + due.total, series.at(-1)?.[1] || 0);
  const coins = ok.filter((x) => x.kind === "launch" && x.mint).map((x) => ({ mint: x.mint, t: x.t, status: x.status }));
  return { unclaimed: { curve: due.curve, pool: due.pool, total: due.total }, earned, claimed, series, partial: left.some((n) => n > 0),
    coins, claims: ok.filter((x) => x.kind === "claim").map((x) => ({ t: x.t, sol: x.sol, sig: x.sig, status: x.status })) };
}
