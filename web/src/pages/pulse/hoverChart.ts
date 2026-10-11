// Shared by the Pulse chart card (ChartHover.tsx, the layer) and its chart (MiniChart.tsx, a lazy chunk): the two
// candle sizes the card uses, and the candles asked for the moment the pointer rests on a row, so the card's first
// frame has them.
import { apiAged, type Aged } from "@/lib/api";

export interface Row { time: number; open: number; high: number; low: number; close: number; value?: number; fill?: boolean }
export interface Candles { tf?: number; rows: Row[]; first?: number | null; partial?: boolean; live?: boolean; source?: string; note?: string | null; rev?: number }

// The card opens on the coin's whole chart in 1-minute candles for a second, then zooms into the live 5-second chart
// (the user, 2026-10-11: "it should show the 1min for 1 second then show the 5 second").
export const OVERVIEW_TF = 60, LIVE_TF = 5;
export const tfLabel = (tf: number) => (tf >= 3600 ? `${tf / 3600}h` : tf >= 60 ? `${tf / 60}m` : `${tf}s`);
// The live view reads the newest WINDOW candles only (`since`), never a coin's whole 5 s history.
export const WINDOW = 240;
export const windowSince = (tf: number) => Math.floor((Date.now() / 1000 - WINDOW * tf) / tf) * tf;

// Both reads asked for ahead of the card (10 s fresh): the overview (whole history, 1 m) and the live window (5 s).
// The chart's first reads take these answers instead of asking again.
interface Primed { overview: Promise<Aged<Candles>>; live: Promise<Aged<Candles>>; at: number }
const primed = new Map<string, Primed>();
export function primeCandles(mint: string): Primed {
  const got = primed.get(mint);
  if (got && Date.now() - got.at < 10_000) return got;
  // Not one of the page's own reads (lib/api.ts noteRead), so index.html never prefetches a coin's candles on Pulse.
  const overview = apiAged<Candles>(`candles/${mint}?tf=${OVERVIEW_TF}`, undefined, 0, false);
  const live = apiAged<Candles>(`candles/${mint}?tf=${LIVE_TF}&since=${windowSince(LIVE_TF)}`, undefined, 0, false);
  const p = { overview, live, at: Date.now() };
  overview.catch(() => { if (primed.get(mint) === p) primed.delete(mint); });
  live.catch(() => { if (primed.get(mint) === p) primed.delete(mint); });
  primed.set(mint, p);
  if (primed.size > 40) primed.delete(primed.keys().next().value!);
  return p;
}
