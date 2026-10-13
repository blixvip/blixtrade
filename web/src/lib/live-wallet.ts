import { useLivePrices } from './livepx';
import { useMetricInterests } from './metrics';
import { usePulse } from './pulse';
import { markHoldings, markPaperWallet, type AccountHoldings } from './wallet-values';
import { useTrade } from './mode';

export function useWalletPrices(mints: string[]) {
  useMetricInterests(mints);
  return useLivePrices(mints);
}
export function useMarkedHoldings<T extends AccountHoldings>(wallet: T | null | undefined) {
  const prices = useWalletPrices(wallet?.tokens?.map(t => t.mint) ?? []);
  const solUsd = usePulse(s => s.live.solUsd) || 0;
  return wallet ? markHoldings(wallet, prices, solUsd, Date.now()) : wallet;
}
export function useMarkedPaperWallet() {
  const wallet = useTrade(s => s.wallet);
  const prices = useWalletPrices(wallet?.valuationPositions?.map(t => t.mint) ?? []);
  const solUsd = usePulse(s => s.live.solUsd) || 0;
  return wallet ? markPaperWallet(wallet, prices, solUsd, Date.now()) : wallet;
}
