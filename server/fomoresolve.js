// Which Solana wallet a Fomo trader really trades from. Fomo's leaderboard and profiles give an
// "address", but it is Fomo's own account id, not the wallet that signs (checked 2026-10-04: point farm
// capital's listed 6cerG… and swap address FgactY… hold nothing on chain; the STONK they show is in
// Beqv6d…). So the wallet is found the honest way, from the chain: take one of the trader's recent Fomo
// swaps (token, amount, time), read the transactions on that token's mint in that minute, and keep the
// wallet whose balance of the token moved by exactly that amount. A second swap must agree before the
// wallet counts as verified. Nothing is guessed: no match means no wallet.
import { db } from "./db.js";
import * as sol from "./solana.js";

db.exec(`CREATE TABLE IF NOT EXISTS fomo_wallets (
  uid TEXT PRIMARY KEY, handle TEXT, fomo_address TEXT, wallet TEXT, matches INTEGER, tried INTEGER, checked INTEGER, note TEXT
)`);

const SKIP = new Set([sol.WSOL, sol.USDC, sol.USDT]);
const SOLANA = 1399811149;
const amountOf = (b) => Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals;

// The owners whose balance of `mint` changed by `want` (bought: +want, sold: -want) in this transaction.
function movers(tx, mint, want) {
  if (!tx || tx.meta?.err) return [];
  const d = new Map();
  for (const b of tx.meta.preTokenBalances || []) if (b.mint === mint) d.set(b.owner, (d.get(b.owner) || 0) - amountOf(b));
  for (const b of tx.meta.postTokenBalances || []) if (b.mint === mint) d.set(b.owner, (d.get(b.owner) || 0) + amountOf(b));
  return [...d].filter(([, v]) => Math.abs(v - want) <= Math.max(Math.abs(want) * 0.005, 1e-6)).map(([o]) => o);
}

// Signatures on `mint` between t0 and t1 (seconds), newest first, paging back at most `pages` times.
async function sigsBetween(mint, t0, t1, pages = 10) {
  const out = [];
  let before;
  for (let p = 0; p < pages; p++) {
    const list = await sol.rpc("getSignaturesForAddress", [mint, { limit: 1000, ...(before ? { before } : {}) }]);
    if (!list?.length) break;
    for (const s of list) if (!s.err && s.blockTime >= t0 && s.blockTime <= t1) out.push(s.signature);
    const oldest = list[list.length - 1];
    if (oldest.blockTime < t0 || list.length < 1000) break;
    before = oldest.signature;
  }
  return out;
}

// One swap → the wallets that could have made it (usually exactly one).
async function candidates(swap) {
  const buy = !SKIP.has(swap.outTokenAddress);
  const mint = buy ? swap.outTokenAddress : swap.inTokenAddress;
  const want = buy ? swap.outHumanAmount : -swap.inHumanAmount;
  if (!mint || SKIP.has(mint) || !want) return null;
  const t = Math.floor(Date.parse(swap.createdAt) / 1000);
  const sigs = await sigsBetween(mint, t - 30, t + 120);
  if (!sigs.length || sigs.length > 60) return sigs.length ? null : new Set();   // too busy to check cheaply
  const found = new Set();
  for (const sig of sigs) {
    const tx = await sol.transaction(sig).catch(() => null);
    for (const o of movers(tx, mint, want)) found.add(o);
    if (found.size) break;
  }
  return found;
}

// swaps: Fomo's /v2/users/<id>/swaps list (newest first). Returns { wallet, matches, tried }.
export async function resolveWallet(swaps) {
  const onSol = (s) => s.networkId === SOLANA && (s.inNetworkId ?? SOLANA) === SOLANA && (s.outNetworkId ?? SOLANA) === SOLANA;
  const coin = (s) => (SKIP.has(s.outTokenAddress) ? s.inTokenAddress : s.outTokenAddress);
  const usable = (swaps || []).filter((s) => onSol(s) && !SKIP.has(coin(s)));
  // Different coins first: two swaps of the same coin in the same minute prove less.
  const first = new Map();
  for (const s of usable) if (!first.has(coin(s))) first.set(coin(s), s);
  const order = [...first.values(), ...usable.filter((s) => first.get(coin(s)) !== s)];
  const tally = new Map();
  let tried = 0;
  for (const s of order.slice(0, 8)) {
    if (tried >= 5) break;
    const c = await candidates(s).catch(() => null);
    if (c == null) continue;
    tried++;
    for (const w of c) tally.set(w, (tally.get(w) || 0) + 1);
    const best = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 2) return { wallet: best[0], matches: best[1], tried };
  }
  const best = [...tally].sort((a, b) => b[1] - a[1])[0];
  return { wallet: best && best[1] >= 1 && tally.size === 1 ? best[0] : null, matches: best?.[1] || 0, tried };
}

export const walletFor = (uid) => db.prepare("SELECT * FROM fomo_wallets WHERE uid = ?").get(uid) || null;

export async function resolveAndStore({ uid, handle, address, swaps }) {
  const r = await resolveWallet(swaps);
  db.prepare(`INSERT INTO fomo_wallets (uid, handle, fomo_address, wallet, matches, tried, checked, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uid) DO UPDATE SET handle = excluded.handle, fomo_address = excluded.fomo_address,
      wallet = COALESCE(excluded.wallet, fomo_wallets.wallet), matches = MAX(COALESCE(excluded.matches, 0), CASE WHEN excluded.wallet IS NULL OR excluded.wallet = fomo_wallets.wallet THEN COALESCE(fomo_wallets.matches, 0) ELSE 0 END),
      tried = excluded.tried, checked = excluded.checked, note = excluded.note`)
    .run(uid, handle || null, address || null, r.wallet, r.matches, r.tried, Date.now(), r.wallet ? (r.matches >= 2 ? "verified by 2+ swaps" : "matched 1 swap") : r.tried ? "no on-chain match yet" : "no recent Solana trades (trades on other chains)");
  return walletFor(uid);
}
