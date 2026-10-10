// The TradingView chart's candles (pages/coin/Chart.tsx, coins past their first day), read by the browser:
//  1. Jupiter's chart API (datapi.jup.ag, the source lib/jupEarly.ts already reads): market-cap candles from 1 s to
//     1 d, the coin's whole life, 150-500 ms a read, and it lets a visitor's browser through;
//  2. GeckoTerminal's (lib/geckoBars.ts) when Jupiter has nothing or refuses (minutes and up only);
//  3. Blix's own server candles as the last resort.
// The newest answer of each coin and size is also kept in this browser (localStorage), so a chart opened again
// draws on its first frame while the fresh read is on its way.
import { api } from "./api";
import { geckoBars } from "./geckoBars";

export interface TvBar { time: number; open: number; high: number; low: number; close: number; value?: number }
// [seconds, label, Jupiter's interval name]
export const TV_TFS: [number, string, string][] = [
  [1, "1s", "1_SECOND"], [15, "15s", "15_SECOND"], [30, "30s", "30_SECOND"], [60, "1m", "1_MINUTE"], [300, "5m", "5_MINUTE"],
  [900, "15m", "15_MINUTE"], [3600, "1h", "1_HOUR"], [14400, "4h", "4_HOUR"], [86400, "1d", "1_DAY"],
];
const JUP = "https://datapi.jup.ag/v2/charts/";

async function jupiter(mint: string, tf: number, toMs: number, n: number): Promise<TvBar[]> {
  const iv = TV_TFS.find(([s]) => s === tf)?.[2];
  if (!iv) return [];
  const r = await fetch(`${JUP}${mint}?interval=${iv}&to=${toMs}&candles=${n}&type=mcap&quote=usd`, { signal: AbortSignal.timeout(8_000) });
  if (!r.ok) throw Object.assign(new Error(`Jupiter ${r.status}`), { busy: r.status === 429 });
  const j = (await r.json()) as { candles?: { time: number; open: number; high: number; low: number; close: number; volume?: number }[] };
  return (j.candles || []).filter((c) => c.open > 0 && c.close > 0)
    .map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, value: c.volume || 0 }))
    .sort((a, b) => a.time - b.time);
}

// One read: `before` (seconds) for older history, `limit` candles. Which source answered comes back with them.
export async function tvBars(mint: string, tf: number, { before, limit = 1000 }: { before?: number; limit?: number } = {}): Promise<{ rows: TvBar[]; source: string }> {
  const toMs = before ? before * 1000 - 1 : Date.now() + 60_000;
  let err: unknown = null;
  try {
    const rows = await jupiter(mint, tf, toMs, limit);
    if (rows.length) return { rows: before ? rows.filter((x) => x.time < before) : rows, source: "Jupiter" };
  } catch (e) { err = e; }
  if (tf >= 60) {
    try {
      const rows = await geckoBars(mint, tf, before ? { before, limit } : { limit });
      if (rows.length) return { rows, source: "GeckoTerminal" };
    } catch (e) { err = err || e; }
  }
  if (!before) {
    try {
      const d = await api<{ rows: TvBar[] }>(`candles/${mint}?tf=${tf}`);
      const rows = (d.rows || []).filter((x) => x.open > 0 && x.close > 0).slice(-limit);
      if (rows.length) return { rows, source: "Blix" };
    } catch (e) { err = err || e; }
  }
  if (err) throw err;
  return { rows: [], source: "" };
}

// This browser's copy of a chart's newest candles (the last 800), kept 6 hours.
const KEY = (mint: string, tf: number) => `tv:${mint}:${tf}`;
export function keptBars(mint: string, tf: number): TvBar[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(mint, tf)) || "null") as { at: number; rows: TvBar[] } | null;
    return v && Date.now() - v.at < 6 * 3600e3 && v.rows?.length ? v.rows : null;
  } catch { return null; }
}
let keeps = 0;
export function keepBars(mint: string, tf: number, rows: TvBar[]) {
  try {
    localStorage.setItem(KEY(mint, tf), JSON.stringify({ at: Date.now(), rows: rows.slice(-800) }));
    // Now and then, drop the oldest copies past 40 charts.
    if (++keeps % 20 === 0) {
      const all: [string, number][] = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith("tv:")) { try { all.push([k, JSON.parse(localStorage.getItem(k)!).at || 0]); } catch { all.push([k, 0]); } } }
      all.sort((a, b) => b[1] - a[1]).slice(40).forEach(([k]) => localStorage.removeItem(k));
    }
  } catch { /* storage full or blocked: the chart reads fresh */ }
}

// The first read of a size, kept 30 s and shared: a link's hover (lib/coin.ts) starts it, the chart draws it.
const first = new Map<string, { at: number; p: Promise<{ rows: TvBar[]; source: string }> }>();
export function firstBars(mint: string, tf: number) {
  const k = `${mint}:${tf}`, c = first.get(k);
  if (c && Date.now() - c.at < 30_000) return c.p;
  const p = tvBars(mint, tf);
  p.then((x) => { if (x.rows.length) keepBars(mint, tf, x.rows); }, () => first.delete(k));
  first.set(k, { at: Date.now(), p });
  if (first.size > 40) first.delete(first.keys().next().value!);
  return p;
}
export const warmTvBars = (mint: string, tf: number) => { firstBars(mint, tf).catch(() => {}); };
