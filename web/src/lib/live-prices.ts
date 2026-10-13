export interface LivePrice { mc: number; t: number; revision: number; supply?: number }
// Commit every price in a batch before notifying any header or portfolio subscriber.
export function createLivePrices(now = () => Date.now()) {
  const prices = new Map<string, LivePrice>(), strong = new Map<string, number>(), canonical = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();
  let revision = 0;
  return {
    get: (mint: string) => prices.get(mint),
    clear(mint: string) { prices.delete(mint); strong.delete(mint); canonical.delete(mint); listeners.get(mint)?.forEach(fn => fn()); },
    subscribe(mint: string, fn: () => void) {
      let set = listeners.get(mint); if (!set) listeners.set(mint, set = new Set());
      set.add(fn); return () => { set.delete(fn); if (!set.size) listeners.delete(mint); };
    },
    set(rows: [string, number, number?][], weak = false, authoritative = false, observedAt = now()) {
      const t = now(), notify = new Set<() => void>();
      if (!Number.isFinite(observedAt) || observedAt > t + 1000 || observedAt < 0) return;
      const next = ++revision;
      for (const [mint, mc, supplied] of rows) {
        if (!mint || !Number.isFinite(mc) || mc <= 0 || observedAt < (prices.get(mint)?.t ?? 0)) continue;
        if (!authoritative && t - (canonical.get(mint) ?? -Infinity) < 10_000) continue;
        if (weak && t - (strong.get(mint) ?? -Infinity) < 30_000) continue;
        if (authoritative) canonical.set(mint, t);
        if (!weak) strong.set(mint, t);
        const old = prices.get(mint);
        const supply = supplied != null && Number.isFinite(supplied) && supplied > 0 ? supplied : old?.supply;
        if (old?.mc === mc && old.t === observedAt && old.supply === supply) continue;
        prices.set(mint, { mc, t: observedAt, revision: next, ...(supply ? { supply } : {}) });
        listeners.get(mint)?.forEach(fn => notify.add(fn));
      }
      if (prices.size > 30_000) for (const mint of prices.keys()) {
        if (!listeners.has(mint)) { prices.delete(mint); strong.delete(mint); canonical.delete(mint); }
        if (prices.size <= 20_000) break;
      }
      notify.forEach(fn => fn());
    },
  };
}
