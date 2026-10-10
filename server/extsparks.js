// Lines for coins on other chains (Fomo's lists carry Base, BSC, Ethereum and more; the radar's own feed and
// Jupiter are Solana only). DexScreener (free, any chain, 30 addresses a call) gives each coin's price now and its
// change over 5 minutes, 1 hour, 6 hours and 24 hours: five real points across the day, which the page draws as a
// smooth line. Its biggest pool by liquidity speaks for the coin. Kept 15 s per address; read only when asked.
import { getJson } from "./sources.js";

const KEEP_MS = 15_000;
const now = () => Date.now();
const seen = new Map(); // address (lower case) -> { t, v }
let busy = null;

// Where each change figure sits on a 24-hour line (0 = a day ago, 1 = now).
const AT = [["h24", 0], ["h6", 18 / 24], ["h1", 23 / 24], ["m5", 1 - 5 / 1440]];

function line(pair) {
  const p = +pair.priceUsd, mc = pair.marketCap || pair.fdv || null;
  if (!(p > 0)) return null;
  // Prices in market-cap terms (the page's lines are market caps), so the right end matches the figure beside it.
  const k = mc && p ? mc / p : 1;
  const pts = [];
  for (const [key, x] of AT) { const c = pair.priceChange?.[key]; if (c != null && c > -100) pts.push([x, (p / (1 + c / 100)) * k]); }
  pts.push([1, p * k]);
  return { spark: pts, mc, chg: pair.priceChange?.h24 ?? null };
}

async function fetchMissing(list) {
  for (let i = 0; i < list.length; i += 30) {
    const chunk = list.slice(i, i + 30);
    const j = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`, { timeout: 10_000 }).catch(() => null);
    const best = new Map();
    for (const pr of j?.pairs || []) {
      const a = String(pr.baseToken?.address || "").toLowerCase();
      if (!chunk.includes(a)) continue;
      if (!best.has(a) || (pr.liquidity?.usd || 0) > (best.get(a).liquidity?.usd || 0)) best.set(a, pr);
    }
    for (const a of chunk) seen.set(a, { t: now(), v: best.has(a) ? line(best.get(a)) : null });
  }
  if (seen.size > 2000) for (const [k, x] of seen) if (now() - x.t > 10 * 60_000) seen.delete(k);
}

// GET /api/ext-sparks?m=<address>,...: { rows: { address: { spark, mc, chg } } } for the addresses known so far;
// stale or new ones are fetched in the background (the page asks again in a few seconds).
export function extSparks(param) {
  const addrs = [...new Set(String(param || "").split(",").map((a) => a.trim()).filter((a) => /^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(a)))].slice(0, 90);
  const stale = addrs.filter((a) => now() - (seen.get(a.toLowerCase())?.t || 0) > KEEP_MS).map((a) => a.toLowerCase());
  if (stale.length && !busy) busy = fetchMissing(stale).finally(() => { busy = null; });
  const rows = {};
  for (const a of addrs) { const v = seen.get(a.toLowerCase())?.v; if (v) rows[a] = v; }
  return { t: now(), rows };
}
