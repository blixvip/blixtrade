import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createLivePrices } from './live-prices';
export type { LivePrice } from './live-prices';
const prices = createLivePrices();
const replayPrices = createLivePrices();
export const setPx = prices.set;
export const setReplayPx = replayPrices.set;
export const clearReplayPx = replayPrices.clear;
export function useLivePrice(mint: string | null | undefined) {
  return useSyncExternalStore(useCallback((fn: () => void) => mint ? prices.subscribe(mint, fn) : () => {}, [mint]), () => mint ? prices.get(mint) : undefined);
}
export function useLiveMc(mint: string | null | undefined) {
  const live = useLivePrice(mint);
  const replay = useSyncExternalStore(useCallback((fn: () => void) => mint ? replayPrices.subscribe(mint, fn) : () => {}, [mint]), () => mint ? replayPrices.get(mint) : undefined);
  return replay?.mc ?? live?.mc;
}
// Only subscribe to this wallet's coins; notify once per complete price batch.
export function useLivePrices(mints: string[]) {
  const key = [...new Set(mints)].sort().join(',');
  const ids = useMemo(() => key ? key.split(',') : [], [key]);
  const revision = useSyncExternalStore(useCallback((fn: () => void) => {
    const stops = ids.map(mint => prices.subscribe(mint, fn));
    return () => stops.forEach(stop => stop());
  }, [ids]), () => ids.reduce((max, mint) => Math.max(max, prices.get(mint)?.revision ?? 0), 0));
  return useMemo(() => Object.fromEntries(ids.map(mint => [mint, prices.get(mint)])), [ids, revision]);
}
