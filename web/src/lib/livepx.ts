import { useSyncExternalStore } from "react";

// Every coin's market cap from its latest trade, for the whole app: the stream's "px" events (every coin that
// traded in the last 100 ms, curve and pool alike), "mig" (Jupiter-priced pools) and the Pulse live rows.
// Components follow one coin each, so a price move re-renders only the numbers showing that coin.
const px = new Map<string, number>();
const subs = new Map<string, Set<() => void>>();

// `weak`: the Pulse rows ("live"), whose market cap is worked out apart from the trade price ("px", "mig") and can
// sit a few percent off it: a coin getting both flipped between the two ($9.8K, $10.3K, $9.8K...) on every page.
// A weak figure only counts for a coin no trade price has come for in the last 30 s.
const strongAt = new Map<string, number>();
export function setPx(u: [mint: string, mc: number][], weak = false) {
  if (px.size > 30_000) { px.clear(); strongAt.clear(); }
  const now = Date.now();
  for (const [m, mc] of u) {
    if (!(mc > 0)) continue;
    if (weak) { if (now - (strongAt.get(m) ?? 0) < 30_000) continue; } else strongAt.set(m, now);
    if (px.get(m) === mc) continue;
    px.set(m, mc);
    subs.get(m)?.forEach((fn) => fn());
  }
}

const none = () => () => {};
export function useLiveMc(mint: string | null | undefined): number | undefined {
  return useSyncExternalStore(
    mint ? (fn) => {
      let set = subs.get(mint);
      if (!set) subs.set(mint, (set = new Set()));
      set.add(fn);
      return () => { set!.delete(fn); if (!set!.size) subs.delete(mint); };
    } : none,
    () => (mint ? px.get(mint) : undefined),
  );
}
