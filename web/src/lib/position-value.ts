// Mark-to-market estimate. Executable sale proceeds still require a swap quote.
export function markValue(tokens: number | null | undefined, priceUsd: number | null | undefined, solUsd: number | null | undefined, ageMs: number | null | undefined): number | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0 || typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd <= 0 || typeof solUsd !== 'number' || !Number.isFinite(solUsd) || solUsd <= 0 || typeof ageMs !== 'number' || !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= 30_000) return null;
  const value = tokens * priceUsd / solUsd;
  return Number.isFinite(value) ? value : null;
}
