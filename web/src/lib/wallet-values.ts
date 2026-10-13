import type { LivePrice } from './live-prices';
type Prices = Record<string, LivePrice | undefined>;
interface Bag { mint: string; held: number; value: number | null; unrealized: number | null; mcap: number | null; supply?: number | null; priceAt?: number | null; exitable?: boolean }
const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
function current(p: LivePrice | undefined, at: number | null | undefined, now: number) {
  return p && positive(p.mc) && p.t >= (at ?? 0) && p.t <= now + 1000 && now - p.t < 30_000 ? p : null;
}
function markBag<T extends Bag>(bag: T, prices: Prices, now: number): T {
  const price = current(prices[bag.mint], bag.priceAt, now);
  if (!price || !finite(bag.held) || bag.held < 0) return bag;
  const value = positive(bag.supply) ? bag.held * price.mc / bag.supply
    : finite(bag.value) && positive(bag.mcap) ? bag.value * price.mc / bag.mcap : null;
  if (!finite(value)) return bag;
  return { ...bag, value, mcap: price.mc, unrealized: finite(bag.unrealized) && finite(bag.value) ? bag.unrealized + value - bag.value : bag.unrealized };
}
interface Monitor { pnl: { positions: Bag[]; valuationPositions?: Bag[]; openValue: number; unrealized: number; realized: number } }
export function markMonitor<T extends Monitor>(wallet: T, prices: Prices, now: number): T {
  const base = wallet.pnl.valuationPositions ?? wallet.pnl.positions;
  let valueDelta = 0, pnlDelta = 0;
  const marked = new Map(base.map(bag => {
    const next = markBag(bag, prices, now);
    if (next !== bag) {
      // Match the server: unsellable bags do not count toward open value or known PnL.
      if (bag.exitable !== false && (bag.exitable === true || bag.unrealized != null)) {
        valueDelta += (next.value != null && next.value > 1 ? next.value : 0) - (bag.value != null && bag.value > 1 ? bag.value : 0);
      }
      if (finite(next.unrealized) && finite(bag.unrealized)) pnlDelta += next.unrealized - bag.unrealized;
    }
    return [bag.mint, next] as const;
  }));
  return { ...wallet, pnl: { ...wallet.pnl, positions: wallet.pnl.positions.map(bag => marked.get(bag.mint) ?? bag),
    openValue: wallet.pnl.openValue + valueDelta, unrealized: wallet.pnl.unrealized + pnlDelta } } as T;
}
interface Portfolio { positions: { mint: string; amount: number; price: number | null; value: number | null; mcap: number | null; priceAt?: number | null }[]; tokensUsd: number; value: number }
export function markPortfolio<T extends Portfolio>(page: T, prices: Prices, now: number): T {
  let delta = 0;
  const positions = page.positions.map(bag => {
    const price = current(prices[bag.mint], bag.priceAt, now);
    if (!price || !positive(bag.price) || !positive(bag.mcap) || !finite(bag.value) || !finite(bag.amount) || bag.amount < 0) return bag;
    const unit = bag.price * price.mc / bag.mcap, value = bag.amount * unit;
    if (!finite(value) || !finite(unit)) return bag;
    delta += value - bag.value;
    return { ...bag, value, price: unit, mcap: price.mc };
  });
  return { ...page, positions, tokensUsd: page.tokensUsd + delta, value: page.value + delta };
}
