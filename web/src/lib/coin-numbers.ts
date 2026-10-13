import type { CoinData, Holder } from "./coin";
import type { MetricCoin } from "./metrics";
export interface MarketWindow { chg: number | null; buys: number | null; sells: number | null; buyVol: number | null; sellVol: number | null; traders: number | null; netBuyers: number | null }
export interface MarketWindows { t: number | null; mcap?: number | null; holders?: number | null; launchpad?: string | null; dev?: string | null; windows: Record<"5m" | "1h" | "6h" | "24h", MarketWindow> | null }
export interface LiveCoinFlow { mint: string; t: number; since?: number; complete: boolean; flow: NonNullable<CoinData["m5"]> }
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const positive = (x: unknown): x is number => finite(x) && x > 0;
const nonnegative = (x: unknown): x is number => finite(x) && x >= 0;
const freshPrice = (age: number | null | undefined) => nonnegative(age) && age <= 30_000;
const safe = (n: number) => Number.isFinite(n) ? n : null;

// A spot estimate is arithmetic, not an executable swap quote (fees, liquidity and slippage still matter).
export function spotTokens(usd: number | null, price: number | null, age: number | null | undefined) {
  return nonnegative(usd) && positive(price) && freshPrice(age) ? safe(usd / price) : null;
}

// Always mark the original snapshot; never accumulate deltas between renders. The server supplies the
// exact token portion included in the PnL window, which can be much smaller than the wallet's entire bag.
export function markHolder(h: Holder, price: number | null, solUsd: number | null, supply: number, age: number | null | undefined): Holder {
  if (!positive(price) || !freshPrice(age)) return h;
  const out = { ...h };
  if (nonnegative(h.tokens)) {
    out.valueUsd = safe(h.tokens * price);
    out.valueSol = out.valueUsd != null && positive(solUsd) ? safe(out.valueUsd / solUsd) : null;
    if (positive(supply)) out.pct = safe(h.tokens / supply * 100);
  }
  if (!nonnegative(h.pnlTokens)) return out;
  if (h.pnlBasis === 'usd' && finite(h.pnlUsd) && nonnegative(h.boughtUsd) && nonnegative(h.soldUsd)) {
    out.pnlUsd = safe(h.soldUsd + h.pnlTokens * price - h.boughtUsd);
    out.pnlSol = out.pnlUsd != null && positive(solUsd) ? safe(out.pnlUsd / solUsd) : null;
  } else if (h.pnlBasis === 'sol' && finite(h.pnlSol) && nonnegative(h.boughtSol) && nonnegative(h.soldSol) && positive(solUsd)) {
    out.pnlSol = safe(h.soldSol + h.pnlTokens * price / solUsd - h.boughtSol);
    out.pnlUsd = out.pnlSol != null ? safe(out.pnlSol * solUsd) : null;
    out.boughtUsd = safe(h.boughtSol * solUsd); out.soldUsd = safe(h.soldSol * solUsd);
  }
  return out;
}

export function markKnownHolder(x: { amount: number | null; value: number | null; pnl: number | null; cost: number | null }, mc: number | null, supply: number | null | undefined) {
  const value = nonnegative(x.amount) && positive(mc) && positive(supply) ? safe(x.amount * (mc / supply)) : x.value;
  const pnl = finite(x.pnl) && finite(x.value) && finite(value) ? safe(x.pnl + value - x.value) : x.pnl;
  return { value, pnl, ret: finite(pnl) && positive(x.cost) ? safe(pnl / x.cost * 100) : null };
}
// A delayed or expired push must never pin a newer polled figure to an old value.
export function currentMetric(coin: MetricCoin | undefined, key: string, now: number, after = 0) {
  const f = coin?.fields[key];
  return f && Number.isFinite(f.value) && Number.isFinite(f.observedAt) && f.observedAt >= after && now - f.observedAt <= f.maxAgeMs && f.observedAt <= now + 1000 ? f : null;
}
// Full-window totals, never a sum of the UI's capped 150 trade rows.
export function coinFlow(base: CoinData["m5"], market: MarketWindows | null, now: number, indexedPool = false, stream: LiveCoinFlow | null = null): CoinData["m5"] {
  if (stream?.complete && stream.t <= now + 1000 && now - stream.t <= 3000 && stream.t >= (base?.calculatedAt ?? 0)) return stream.flow;
  if (base?.complete && stream?.complete !== false && base.calculatedAt && now - base.calculatedAt <= 3000) return base;
  if (base?.complete) base = null;
  if (base?.source === "live" && !indexedPool) return base;
  const fallback = indexedPool && base?.source === "live" ? null : base;
  const w = market?.windows?.["5m"];
  if (!w || !market?.t || now - market.t > 60_000 || market.t > now + 1000) return fallback;
  const valid = (n: number | null): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (!valid(w.buys) || !valid(w.sells) || !valid(w.buyVol) || !valid(w.sellVol)) return fallback;
  return { source: "tracked", buys: w.buys, sells: w.sells, buyUsd: w.buyVol, sellUsd: w.sellVol, volUsd: w.buyVol + w.sellVol, netUsd: w.buyVol - w.sellVol, traders: w.traders };
}
