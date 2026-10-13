import type { LivePrice } from './live-prices';
type Prices = Record<string, LivePrice | undefined>;
interface Bag { mint: string; held: number; value: number | null; unrealized: number | null; mcap: number | null; supply?: number | null; priceAt?: number | null; exitable?: boolean }
const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
function current(p: LivePrice | undefined, at: number | null | undefined, now: number) {
  return p && positive(p.mc) && p.t >= (at ?? 0) && p.t <= now + 1000 && now - p.t < 30_000 ? p : null;
}
export interface AccountHoldings { sol: number; solUsd?: number; tokensUsd?: number; tokens?: { mint: string; ui: number; usd?: number | null }[] }
export function markHoldings<T extends AccountHoldings>(wallet: T, prices: Prices, solUsd: number, now: number): T {
  let delta = 0;
  const tokens = wallet.tokens?.map(bag => {
    const p = current(prices[bag.mint], undefined, now);
    if (!p || !positive(p.supply) || !finite(bag.ui) || bag.ui < 0) return bag;
    const usd = bag.ui * p.mc / p.supply;
    if (!finite(usd)) return bag;
    delta += usd - (bag.usd ?? 0);
    return { ...bag, usd };
  });
  const tokensUsd = (wallet.tokensUsd ?? wallet.tokens?.reduce((s, b) => s + (b.usd ?? 0), 0) ?? 0) + delta;
  return { ...wallet, tokens, tokensUsd, solUsd: positive(solUsd) ? wallet.sol * solUsd : wallet.solUsd };
}
interface PaperValuation { cash: number; equity: number; pnl: number; realized: number; solUsd: number; valuationPositions?: { mint: string; valueSol: number | null; mcap: number | null; priceAt?: number | null }[] }
export function markPaperWallet<T extends PaperValuation>(wallet: T, prices: Prices, solUsd: number, now: number): T {
  let delta = 0;
  const usd = positive(solUsd) ? solUsd : wallet.solUsd;
  for (const bag of wallet.valuationPositions ?? []) {
    const p = current(prices[bag.mint], bag.priceAt, now);
    if (!p || !positive(bag.mcap) || !finite(bag.valueSol) || !positive(wallet.solUsd) || !positive(usd)) continue;
    const value = bag.valueSol * p.mc / bag.mcap * wallet.solUsd / usd;
    if (finite(value)) delta += value - bag.valueSol;
  }
  return { ...wallet, equity: wallet.equity + delta, pnl: wallet.pnl + delta, solUsd: usd };
}
interface TraderPosition { mint: string; chain: number; amount: number | null; price: number | null; mcap: number | null }
export function markTraderPositions<T extends TraderPosition>(positions: T[], prices: Prices, now: number): T[] {
  return positions.map(bag => {
    const p = bag.chain === 1399811149 ? current(prices[bag.mint], undefined, now) : null;
    if (!p) return bag;
    const price = positive(p.supply) ? p.mc / p.supply : positive(bag.price) && positive(bag.mcap) ? bag.price * p.mc / bag.mcap : null;
    return positive(price) ? { ...bag, price, mcap: p.mc } : bag;
  });
}
interface OpenHolding { amount: number | null; value: number | null; unrealized: number | null; pct: number | null; closed: string | null }
export function markOpenHolding<T extends OpenHolding>(bag: T, p: LivePrice | undefined, now: number): T {
  if (bag.closed || !current(p, undefined, now) || !positive(p?.supply) || !finite(bag.amount) || bag.amount < 0) return bag;
  const value = bag.amount * p.mc / p.supply;
  if (!finite(value)) return bag;
  const unrealized = finite(bag.unrealized) && finite(bag.value) ? bag.unrealized + value - bag.value : bag.unrealized;
  const cost = finite(bag.value) && finite(bag.unrealized) ? bag.value - bag.unrealized : null;
  return { ...bag, value, unrealized, pct: positive(cost) && finite(unrealized) ? unrealized / cost * 100 : bag.pct };
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
interface Portfolio { positions: { mint: string; amount: number; price: number | null; value: number | null; mcap: number | null; priceAt?: number | null }[]; tokensUsd: number; value: number; sol?: number | null; solUsd?: number }
export function markPortfolio<T extends Portfolio>(page: T, prices: Prices, now: number, solUsd?: number): T {
  let delta = 0;
  const positions = page.positions.map(bag => {
    const price = current(prices[bag.mint], bag.priceAt, now);
    if (!price || !positive(bag.price) || !positive(bag.mcap) || !finite(bag.value) || !finite(bag.amount) || bag.amount < 0) return bag;
    const unit = bag.price * price.mc / bag.mcap, value = bag.amount * unit;
    if (!finite(value) || !finite(unit)) return bag;
    delta += value - bag.value;
    return { ...bag, value, price: unit, mcap: price.mc };
  });
  const solDelta = finite(page.sol) && positive(page.solUsd) && positive(solUsd) ? page.sol * (solUsd - page.solUsd) : 0;
  return { ...page, positions, tokensUsd: page.tokensUsd + delta, value: page.value + delta + solDelta, ...(positive(solUsd) ? { solUsd } : {}) };
}
