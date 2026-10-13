// The market cap a coin's open chart is drawing right now: its newest candle's close, set every time the chart
// draws or moves that candle (pages/coin/Chart.tsx draw/put), whatever the source (Blix's candles, TradingView's,
// Fomo's). The coin's header shows exactly this while the chart is open (the user, 2026-10-10: "the price on the
// chart should be one-to-one to the price displayed, never different"), and its price is this over its supply.
import { create } from "zustand";
import { setPx } from './livepx';

export const useChartMc = create<Record<string, number>>(() => ({}));
// Only accepted live observations refresh position values; redrawing an old candle does not.
export function markChartPrice(mint: string, mc: number, t: number) {
  setPx([[mint, mc]], false, true, t);
}

export function setChartMc(mint: string, mc: number) {
  if (!(mc > 0) || !Number.isFinite(mc) || useChartMc.getState()[mint] === mc) return;
  useChartMc.setState({ [mint]: mc });
}
// The chart closed or switched size or source: the header goes back to its own figures until it draws again.
export function clearChartMc(mint: string) {
  if (!(mint in useChartMc.getState())) return;
  useChartMc.setState((s) => { const n = { ...s }; delete n[mint]; return n; }, true);
}
