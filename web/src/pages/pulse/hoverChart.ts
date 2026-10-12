// Shared by the Pulse chart card (ChartHover.tsx, the layer) and its chart (MiniChart.tsx, a lazy chunk): the two
// candle sizes the card uses, the candles of every row on the page read ahead of the pointer (warm), and the
// candles handed to the card the moment the pointer touches a row, so its first frame is drawn from memory.
import { apiAged, type Aged } from "@/lib/api";

export interface Row { time: number; open: number; high: number; low: number; close: number; value?: number; fill?: boolean }
export interface Candles { tf?: number; rows: Row[]; first?: number | null; partial?: boolean; live?: boolean; source?: string; note?: string | null; rev?: number }

// The card opens on the coin's whole chart in 1-minute candles for half a second, then zooms into the live 5-second
// chart (the user, 2026-10-11: "only be at the one minute for half a second and then go to the five second chart").
export const OVERVIEW_TF = 60, LIVE_TF = 5;
export const tfLabel = (tf: number) => (tf >= 3600 ? `${tf / 3600}h` : tf >= 60 ? `${tf / 60}m` : `${tf}s`);
// The live view reads the newest WINDOW candles only (`since`), never a coin's whole 5 s history.
export const WINDOW = 240;
// The chart box's ground (top to bottom), drawn by the card and painted into the hand-off snapshot so it is opaque.
export const CHART_BG = ["#0b0b0e", "#08080a"] as const;
export const windowSince = (tf: number) => Math.floor((Date.now() / 1000 - WINDOW * tf) / tf) * tf;

// ---------- warm: every row on the page has its candles in memory before the pointer gets there ----------
// The user (2026-10-11): "the chart should show up instantly … it needs to literally be instant". A read over the
// Internet is never instant, so the rows on screen (ChartHover watches each mounted row) are read in one request
// (/api/candles/warm: the radar's own candle store, no provider asked, no chart focused on the server) 120 ms after
// rows appear and again every REWARM_MS for what changed since, and the card's first frame takes these.
type Packed = [number, number, number, number, number, number][];
interface Warm { m: Row[]; s: Row[]; at: number }   // minute candles (the overview), 5 s candles (the live view), when read
const warm = new Map<string, Warm>();
const rows = new Set<string>();          // the coins whose rows are on the page now
const WARM_FRESH_MS = 60_000, REWARM_MS = 15_000, BATCH = 50;
let warmTimer = 0, warming = false;
const unpack = (p: Packed | undefined): Row[] => (Array.isArray(p) ? p.map(([time, open, high, low, close, value]) => ({ time, open, high, low, close, value })) : []);
// Newer rows laid over what was held: the refresh starts at the last held candle (still filling when it was read).
const merge = (old: Row[], add: Row[]) => (add.length ? [...old.filter((x) => x.time < add[0].time), ...add] : old);
function scheduleWarm(ms: number) { if (!warmTimer) warmTimer = window.setTimeout(() => { warmTimer = 0; void warmNow(); }, ms); }
async function warmNow() {
  if (warming) return;
  if (document.hidden) return;   // read again when the tab is back (below)
  const want = [...rows].filter((m) => { const w = warm.get(m); return !w || Date.now() - w.at > REWARM_MS - 500; });
  if (!want.length) return;
  warming = true;
  try {
    for (let i = 0; i < want.length; i += BATCH) {
      const part = want.slice(i, i + BATCH);
      const m = part.map((mint) => { const w = warm.get(mint); return w ? `${mint}:${w.m[w.m.length - 1]?.time || 0}:${w.s[w.s.length - 1]?.time || 0}` : mint; }).join(",");
      const r = (await apiAged<{ t: number; coins: Record<string, { m?: Packed; s?: Packed }> }>(`candles/warm?m=${m}`, undefined, 0, false)).data;
      const at = Date.now();
      for (const mint of part) {
        const c = r.coins?.[mint];
        if (!c) continue;
        const w = warm.get(mint);
        warm.set(mint, w ? { m: merge(w.m, unpack(c.m)).slice(-720), s: merge(w.s, unpack(c.s)).slice(-WINDOW), at } : { m: unpack(c.m), s: unpack(c.s), at });
      }
      // Rows gone from the page are let go once they are stale, so a long session never holds every coin seen.
      if (warm.size > 400) for (const [k, w] of warm) { if (!rows.has(k) && at - w.at > WARM_FRESH_MS) warm.delete(k); if (warm.size <= 300) break; }
    }
  } catch { /* the next sweep tries again; a card meanwhile reads the usual way */ }
  finally { warming = false; }
}
// A row on the page: its candles are read ahead; off the page: no longer kept fresh.
export function watchRow(mint: string) { rows.add(mint); if (!warm.has(mint)) scheduleWarm(120); }
export function unwatchRow(mint: string) { rows.delete(mint); }
if (typeof window !== "undefined") {
  setInterval(() => { if (rows.size && !document.hidden) scheduleWarm(0); }, REWARM_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && rows.size) scheduleWarm(300); });
}

// ---------- what the card opens on ----------
// `overviewNow` / `liveNow`: the warm candles, there at once (null when the row was not read ahead, or too long
// ago); the chart draws them in the same frame. `overview`: the same, or the usual read when there is none.
// `live`: always the usual windowed read of the 5 s candles, asked the moment the pointer touches the row: it also
// marks the chart open on the server (chartFocus), so the coin's trades reach the stream; `liveGot` is its answer
// once it is in (the chart takes it over the warm candles at the hand-off when it has arrived, ~1 s later).
export interface Primed { overview: Promise<Aged<Candles>>; live: Promise<Aged<Candles>>; overviewNow: Candles | null; liveNow: Candles | null; liveGot: Candles | null; at: number }
const primed = new Map<string, Primed>();
export function primeCandles(mint: string): Primed {
  const got = primed.get(mint);
  if (got && Date.now() - got.at < 10_000) return got;
  const w = warm.get(mint), fresh = w && Date.now() - w.at < WARM_FRESH_MS ? w : null;
  const overviewNow: Candles | null = fresh && fresh.m.length >= 2 ? { tf: OVERVIEW_TF, rows: fresh.m.slice(), first: fresh.m[0].time, source: "Blix", live: true } : null;
  const liveNow: Candles | null = fresh && fresh.s.length >= 2 ? { tf: LIVE_TF, rows: fresh.s.slice(), first: fresh.s[0].time, partial: true, source: "Blix", live: true } : null;
  // Not one of the page's own reads (lib/api.ts noteRead), so index.html never prefetches a coin's candles on Pulse.
  const overview = overviewNow ? Promise.resolve({ data: overviewNow, age: 0 }) : apiAged<Candles>(`candles/${mint}?tf=${OVERVIEW_TF}`, undefined, 0, false);
  const live = apiAged<Candles>(`candles/${mint}?tf=${LIVE_TF}&since=${windowSince(LIVE_TF)}`, undefined, 0, false);
  const p: Primed = { overview, live, overviewNow, liveNow, liveGot: null, at: Date.now() };
  overview.catch(() => { if (primed.get(mint) === p) primed.delete(mint); });
  live.then((r) => { p.liveGot = r.data; }, () => { if (primed.get(mint) === p) primed.delete(mint); });
  primed.set(mint, p);
  if (primed.size > 40) primed.delete(primed.keys().next().value!);
  return p;
}
