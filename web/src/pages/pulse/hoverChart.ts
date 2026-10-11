// Shared by the Pulse chart card (ChartHover.tsx, the layer) and its chart (MiniChart.tsx, a lazy chunk): the candle
// size the coin's real chart would open on, and the candles asked for the moment the pointer rests on a row, so the
// card's first frame has them.
import { apiAged, type Aged } from "@/lib/api";
import type { Coin } from "@/lib/pulse";
import { store } from "@/lib/utils";

export interface Row { time: number; open: number; high: number; low: number; close: number; value?: number; fill?: boolean }
export interface Candles { tf?: number; rows: Row[]; first?: number | null; partial?: boolean; live?: boolean; source?: string; note?: string | null; rev?: number }

export const TFS: [number, string][] = [[1, "1s"], [5, "5s"], [15, "15s"], [60, "1m"], [300, "5m"], [900, "15m"], [3600, "1h"]];
export const tfLabel = (tf: number) => TFS.find(([v]) => v === tf)?.[1] || `${tf}s`;

// The same size the coin's page opens its chart on (pages/Coin.tsx defaultTf, then the size last picked there), so
// the card moves at exactly the rate the real chart would: 1 s candles for a coin under 30 minutes on the curve, 15 s
// under 3 hours, 1 m past that or once bonded. "All" (-1) is not a size; it falls back to the default.
export function tfFor(coin: Coin): number {
  const age = Date.now() - (coin.born || Date.now());
  const def = !coin.graduated && age < 30 * 60_000 ? 1 : !coin.graduated && age < 3 * 3600e3 ? 15 : 60;
  const pick = store.get<number>("coin:tf", 0);
  return TFS.some(([v]) => v === pick) ? pick : def;
}

// Candles asked for ahead of the card (10 s fresh): the chart's first read takes this answer instead of asking again.
const primed = new Map<string, { p: Promise<Aged<Candles>>; at: number }>();
export function primeCandles(mint: string, tf: number): Promise<Aged<Candles>> {
  const key = `${mint}:${tf}`, got = primed.get(key);
  if (got && Date.now() - got.at < 10_000) return got.p;
  const p = apiAged<Candles>(`candles/${mint}?tf=${tf}`, undefined, 0, false);   // not one of the page's own reads (lib/api.ts noteRead)
  p.catch(() => { if (primed.get(key)?.p === p) primed.delete(key); });
  primed.set(key, { p, at: Date.now() });
  if (primed.size > 40) primed.delete(primed.keys().next().value!);
  return p;
}
