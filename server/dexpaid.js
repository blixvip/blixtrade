// Whether a coin's DexScreener profile is paid ("DEX paid", what Axiom's Paid pill means), from DexScreener's
// own orders API (api.dexscreener.com/orders/v1/solana/<mint>), for the coins on screen in lists. A boost or a
// profile header on the token row is not the same thing: a coin can be paid without either, and boosts can
// be bought without a profile. Paced to one request every 1.2 s (DexScreener allows 60 a minute) across all
// coins asked for; a paid answer is kept 30 minutes, an unpaid one 5, and a failure is retried after a minute.
import { getJson } from "./sources.js";

const now = () => Date.now();
const cache = new Map();    // mint -> { t, paid: bool|null, types }
const queue = new Set();
let timer = null;

const PAID_TTL = 30 * 60_000, UNPAID_TTL = 5 * 60_000, FAIL_TTL = 60_000;
const due = (c) => !c || now() - c.t > (c.paid == null ? FAIL_TTL : c.paid ? PAID_TTL : UNPAID_TTL);

async function pump() {
  timer = null;
  const mint = queue.values().next().value;
  if (!mint) return;
  queue.delete(mint);
  try {
    const j = await getJson(`https://api.dexscreener.com/orders/v1/solana/${mint}`, { timeout: 8000 });
    const ok = (j?.orders || []).filter((o) => o.paymentTimestamp && o.status === "approved");
    cache.set(mint, { t: now(), paid: ok.some((o) => o.type === "tokenProfile"), types: ok.map((o) => o.type) });
  } catch { cache.set(mint, { t: now(), paid: cache.get(mint)?.paid ?? null, types: cache.get(mint)?.types || [] }); }
  if (cache.size > 5000) for (const [m, c] of cache) if (now() - c.t > PAID_TTL) cache.delete(m);
  if (queue.size) timer = setTimeout(pump, 1200);
}

// true / false once DexScreener has answered for this coin, null until then. Asking queues a (re)check.
export function dexPaid(mint) {
  const c = cache.get(mint);
  if (due(c) && queue.size < 400) { queue.add(mint); if (!timer) timer = setTimeout(pump, 50); }
  return c ? c.paid : null;
}
