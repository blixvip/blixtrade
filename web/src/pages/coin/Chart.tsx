// The coin's candle chart: market cap in USD from real trades (/api/candles), drawn the way Axiom draws it
// and the same way as the classic page (public/trade.js, mountChart): fixed 9 px candles with the newest at
// the right, every interval present up to now (a quiet one is a flat candle at the last price), each candle
// opening at the previous close, volume as a faint band along the bottom, a price axis that always spans at
// least 3% of the price, and the time axis in this PC's time. Who traded where, as on Axiom: your own buys
// and sells (B / S arrows), the dev's (DB / DS badges), followed wallets (gold badges), snipers and bundles
// (small dots), alerts (muted squares) and DexScreener orders (DEX paid, ads, boosts: a dashed line with a
// pill). The icons are drawn by chartIcons.ts; hovering one says what it was. Your average buy and sell are
// dashed lines across it.
import { SiteLogo } from "@/components/logos";
import { EmptyState } from "@/components/page";
import { CandlestickSeries, LineSeries, ColorType, createChart, createSeriesMarkers, HistogramSeries, LineStyle, type AutoscaleInfo, type IPriceLine, type CandlestickData, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { api, apiAged } from "@/lib/api";
import { earlyBars, onLevel } from "@/lib/jupEarly";
import { onCoinTrade, onFomoBar, pushCoinMc, usePulse } from "@/lib/pulse";
import { pickStart, replaying, replayNow, startReplay, useReplay } from "@/lib/replay";
import { useRole } from "@/lib/role";
import { CHART_BG, geckoRes, mountGecko, unmountGecko } from "@/lib/gecko";
import { TV_TFS, firstBars, keepBars, keptBars, tvBars } from "@/lib/tvBars";
import { peek, solN, usdK, type Trades } from "@/lib/coin";
import { cn, store } from "@/lib/utils";
import { ChartIcons, type Badge, type Flag, type IconKind, type TipCard } from "./chartIcons";

const TFS: [number, string][] = [[1, "1s"], [5, "5s"], [15, "15s"], [60, "1m"], [300, "5m"], [900, "15m"], [3600, "1h"]];
// Fomo mode (the default): the coin's chart as fomo.family draws it, from the same bars Fomo draws (Mobula's,
// behind Fomo's proxy; server/fomochart.js, /api/fomo/bars) at Fomo's candle sizes, shown as market cap (price ×
// supply) the way Fomo shows it, and live: every change to the open bar arrives on the stream (`fbar`) the moment
// Fomo's feed sends it. Only bars with trades are drawn, side by side, as TradingView draws them on Fomo.
// Blix mode is the radar's own candles (every trade it reads from the chain, 1s to 1h, and All).
// Gecko (the default): GeckoTerminal's own chart in a frame, the official embed: TradingView with 1s to daily
// candles and a market-cap toggle, live over its socket, no sign-in and nothing to expire. Fomo and Blix as before.
// TradingView (tv): GeckoTerminal's candles drawn on this chart (TradingView's chart library), with the faces and
// marks on them: the embed is another site's page, so nothing of Blix's can be drawn over its candles. The embed
// stays one click away (GeckoTerminal) for its drawing tools and indicators.
type Src = "tv" | "gecko" | "fomo" | "blix";
// One chart per coin, no switch (the owner, 2026-10-10): a coin's first 24 hours on Blix live, after that the
// TradingView chart. The GeckoTerminal embed and Fomo mode stay in the code, not offered.
// GeckoTerminal candles already drawn, per coin and size, so a chart opened again draws on its first frame.
const gmemo = new Map<string, { raw: Row[]; at: number }>();
// Per coin: what Jupiter's market caps are multiplied by to sit on the header's level (1: the same supply).
const tvLevel = {
  m: new Map<string, number>(),
  has(mint: string) { return this.get(mint) != null; },
  get(mint: string): number | undefined { const v = this.m.get(mint); if (v != null) return v; try { const x = Number(localStorage.getItem(`tvk:${mint}`)); return x > 0 ? x : undefined; } catch { return undefined; } },
  set(mint: string, v: number) { this.m.set(mint, v); try { localStorage.setItem(`tvk:${mint}`, String(v)); } catch { /* blocked */ } },
};
// pump.fun's opening market cap, in SOL: 30 virtual SOL over 1.073B virtual tokens, on the 1B supply. Every pump
// coin's chart starts there, flat until its first trade, as pump.fun's own does.
const START_SOL = 27.96;
// The frames themselves live in lib/gecko.ts (warmed on hover, kept across pages, placed over the box here).
const FOMO_TFS: [string, string, number][] = [["1S", "1s", 1], ["15S", "15s", 15], ["30S", "30s", 30], ["1", "1m", 60], ["5", "5m", 300], ["15", "15m", 900], ["30", "30m", 1800], ["60", "1h", 3600], ["240", "4h", 14400], ["720", "12h", 43200], ["1D", "1d", 86400], ["7D", "1w", 604800]];
interface FomoBars { mint: string; res: string; secs: number; bars: [number, number, number, number, number, number][]; supply: number | null; t: number | null; partial?: boolean; first?: number | null; live?: boolean; error?: string | null; signedOut?: boolean }
// Fomo bars already drawn, per coin and size, so a chart opened again draws on its first frame.
const fmemo = new Map<string, { raw: Row[]; at: number }>();
// "All", as on Fomo: the coin's whole life on one screen. The finest size that shows it from launch in about
// ALL_CANDLES candles (3-4 px each on a normal chart: a shape you can read, not hairlines or a few fat bars),
// within the 900 or so the server sends for one size (Jupiter keeps a coin's latest 1,000 per size).
const ALL = -1, ALL_CANDLES = 220;
const allTf = (born?: number | null) => {
  const age = born && born > 0 ? (Date.now() - born) / 1000 : 30 * 86400;
  return TFS.find(([v]) => age / v <= ALL_CANDLES)?.[0] ?? 3600;
};
const ALL_TFS = [...TFS.map(([v]) => v), 14400, 86400];   // All alone goes to 4h and 1d candles
const label = (tf: number) => TFS.find(([v]) => v === tf)?.[1] || `${tf}s`;
const countdown = (secs: number) => (secs >= 3600 ? `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}` : secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : `${secs}s`);
const BAR = 9;             // candle width in pixels at rest: two candles look like two candles, not two walls
// A silence this long (in candles) is drawn flat, as any charting terminal does; only past it (8 hours of 1 s
// candles, 20 days of 1 m) does the chart start over after the silence. It used to be 300: five quiet minutes
// on a 1 s chart wiped the candles and restarted the chart, which read as the chart cutting out.
const FILL_MAX = 30_000;
// A read that failed (the server restarting, a refused request): the next one waits 1 s, then 2, 4, up to 10 s,
// rather than asking again several times a second; the first answer that comes back resets it.
const backoff = (fails: number) => Math.min(10_000, 1000 * 2 ** (fails - 1));
const LEAD = 120;          // ...with this many flat candles before the first trade after it
const MIN_RANGE = 0.03;    // the price axis always spans at least 3% of the price (12% squashed a $165M coin's
                           // 5% day into the middle third, with the axis running down to $148M)
// A tagged trade (the dev, a sniper, a bundle wallet, a followed wallet) and a DexScreener order.
export interface Mark { t: number; buy: boolean; kind: IconKind; label?: string | null; sol?: number | null; mc?: number | null; usd?: number | null }
// Faces (server/chartpeople.js): pump.fun accounts and Fomo traders who traded or called the coin.
export interface ChartPerson { id: string; src: "pump" | "fomo"; name: string; pic: string | null; followers?: number; dev?: boolean }
export interface ChartPeople { people: ChartPerson[]; trades: { t: number; buy: boolean; who: string; usd: number | null; mc: number | null }[]; calls: { t: number; who: string; mc: number | null; text: string | null; likes?: number | null }[] }
export interface ChartEvent { t: number; text: string; tone: "info" | "warn"; tip: string }
// `fill`: an interval with no trade, used while the rows are made continuous (each candle opening at the previous
// close) and then dropped: only traded intervals are drawn.
interface Row { time: number; open: number; high: number; low: number; close: number; value?: number; fill?: boolean }
interface Candles { tf?: number; rows: Row[]; first?: number | null; partial?: boolean; live?: boolean; source?: string; note?: string | null; rev?: number; gaps?: [number, number][] }

// Lightweight Charts reads hex/rgb only; the theme is OKLCH, so each token is resolved through a canvas.
function color(name: string, fallback: string) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) return fallback;
    const c = document.createElement("canvas"); c.width = c.height = 1;
    const x = c.getContext("2d")!; x.fillStyle = fallback; x.fillStyle = v; x.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data;
    return a ? `rgb(${r},${g},${b})` : fallback;
  } catch { return fallback; }
}
const alpha = (rgb: string, a: number) => rgb.replace(/^rgb\((.+)\)$/, `rgba($1,${a})`);

// Prices on the chart need more digits than anywhere else, or every label on a quiet coin's axis reads the
// same ("$3.5K" six times). Same steps as trade.js usdP; never negative (the room left for the volume band).
export const usdP = (n: number) => {
  if (n == null || !isFinite(n)) return "—";
  if (n < 0) return "";
  // Trailing zeros go ("$7.100K" reads "$7.1K", "$9.000K" "$9K"): two different labels never become the same.
  const t = (s: string) => s.replace(/(\.\d*?)0+(?=[KMB]?$)/, "$1").replace(/\.(?=[KMB]?$)/, "");
  return n >= 1e9 ? `$${t((n / 1e9).toFixed(3) + "B")}` : n >= 1e6 ? `$${t((n / 1e6).toFixed(3) + "M")}` : n >= 1e5 ? `$${t((n / 1e3).toFixed(1) + "K")}` : n >= 1e4 ? `$${t((n / 1e3).toFixed(2) + "K")}`
    : n >= 1e3 ? `$${t((n / 1e3).toFixed(3) + "K")}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(3)}`;
};
const pctF = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

// One candle for every interval up to now (a quiet one is flat at the last price, so time reads evenly and
// the chart keeps moving), each opening where the one before it closed. Same as trade.js continuous().
// A silence longer than FILL_MAX intervals starts the chart over after it: the history Jupiter sends for a
// quiet coin is its last 1,000 candles that had trades, which can reach back days, and drawing those
// across a break made the time axis jump (15:27, then 04:59, then 18:47) with a few lone candles.
// `fillMax`: the longest silence filled with flat candles; All passes Infinity, since its whole point is the whole life.
function continuous(rows: Row[], tf: number, nowSec = Date.now() / 1000, fillMax = FILL_MAX): Row[] {
  let out: Row[] = [];
  const flat = (time: number, px: number): Row => ({ time, open: px, high: px, low: px, close: px, value: 0, fill: true });
  for (const x of rows) {
    const prev = out[out.length - 1];
    if (prev) {
      if (x.time <= prev.time) continue;
      const gap = Math.round((x.time - prev.time) / tf) - 1;
      if (gap > fillMax) {
        // The price sat at the last close all through the silence: its last LEAD intervals stay on the chart as
        // a flat line, so a trade after it is not a lone candle in empty space.
        out = [];
        for (let i = LEAD; i >= 1; i--) out.push(flat(x.time - i * tf, prev.close));
      } else if (gap > 0) for (let i = 1; i <= gap; i++) out.push(flat(prev.time + i * tf, prev.close));
      const open = out[out.length - 1].close;
      out.push({ ...x, open, high: Math.max(x.high, open), low: Math.min(x.low, open) });
    } else out.push({ ...x });
  }
  const last = out[out.length - 1];
  if (last) {
    const until = Math.floor(nowSec / tf) * tf, gap = Math.round((until - last.time) / tf);
    if (gap > 0 && gap <= fillMax) for (let i = 1; i <= gap; i++) out.push(flat(last.time + i * tf, last.close));
  }
  // Only the intervals that traded are drawn, side by side (each still opening where the one before it closed):
  // the chart places candles by order, not by clock, so a quiet stretch is neither a hole nor a flat line, as on
  // Fomo's and TradingView's charts of the same coin. The time axis stretches between them.
  return out.filter((r) => !r.fill);
}

// Live trades arrive rounded (8 digits of market cap, cents of volume): within that, the same candle.
const near = (x: number, y: number) => Math.abs(x - y) <= Math.abs(y) * 1e-6;
const sameRow = (a: Row | undefined, b: Row) => Boolean(a) && near(a!.open, b.open) && near(a!.high, b.high) && near(a!.low, b.low) && near(a!.close, b.close) && Math.abs((a!.value || 0) - (b.value || 0)) < 0.05;

// Candles already fetched, per coin and size, so a size draws at once: from its own last answer, or built from
// a finer size's (1s, 5s and 15s candles make up 1m ones, 1m make 5m...) while the server answers. A minute or
// more can wait seconds on GeckoTerminal's history, and the chart must not sit blank meanwhile.
const memo = new Map<string, { raw: Row[]; at: number }>();
const FRESH = 5 * 60_000;
function remember(key: string, raw: Row[]) {
  if (replaying(key.split(":")[0])) return;
  memo.delete(key); memo.set(key, { raw, at: Date.now() });
  if (memo.size > 14) memo.delete(memo.keys().next().value!);
}
function bucket(rows: Row[], tf: number): Row[] {
  const out: Row[] = [];
  for (const x of rows) {
    const time = Math.floor(x.time / tf) * tf, cur = out[out.length - 1];
    if (cur && cur.time === time) { cur.high = Math.max(cur.high, x.high); cur.low = Math.min(cur.low, x.low); cur.close = x.close; cur.value = (cur.value || 0) + (x.value || 0); }
    else out.push({ time, open: x.open, high: x.high, low: x.low, close: x.close, value: x.value || 0 });
  }
  return out;
}
// Candles made from the coin's recent trades (the trade list, already in hand when the page opens): each trade's
// market cap, so the chart has its newest stretch on the first frame while the full history is fetched.
function fromTrades(mint: string, tf: number): Row[] | null {
  if (replaying(mint)) return null;
  const list = peek<Trades>(`coin/${mint}/trades?limit=150`)?.trades?.filter((x) => x.mcUsd && x.mcUsd > 0).sort((a, b) => a.t - b.t);
  if (!list?.length) return null;
  const out: Row[] = [];
  for (const x of list) {
    const time = Math.floor(x.t / 1000 / tf) * tf, mc = x.mcUsd!, cur = out[out.length - 1];
    if (cur && cur.time === time) { cur.high = Math.max(cur.high, mc); cur.low = Math.min(cur.low, mc); cur.close = mc; cur.value = (cur.value || 0) + (x.usd || 0); }
    else { const open = cur ? cur.close : mc; out.push({ time, open, high: Math.max(open, mc), low: Math.min(open, mc), close: mc, value: x.usd || 0 }); }
  }
  return out;
}
function cached(mint: string, tf: number): Row[] | null {
  if (replaying(mint)) return null;
  const own = memo.get(`${mint}:${tf}`);
  if (own && own.raw.length && Date.now() - own.at < FRESH) return own.raw;
  // The finer size reaching furthest back (only the 1m answer carries GeckoTerminal's older history).
  let best: Row[] | null = null;
  for (const [f] of TFS) {
    const m = memo.get(`${mint}:${f}`);
    if (f >= tf || tf % f || !m?.raw.length || Date.now() - m.at >= FRESH) continue;
    if (!best || m.raw[0].time <= best[0].time) best = m.raw;
  }
  return best ? bucket(best, tf) : null;
}

// Fetch a coin's candles ahead of time (the pointer resting on its link), so its chart draws on the first frame.
const warming = new Map<string, number>();
export function warmCandles(mint: string, tfs: number[]) {
  for (const tf of tfs) {
    const key = `${mint}:${tf}`, t = Date.now();
    if (t - (warming.get(key) || 0) < 10_000 || (memo.get(key) && t - memo.get(key)!.at < 10_000)) continue;
    warming.set(key, t);
    if (warming.size > 200) warming.delete(warming.keys().next().value!);
    apiAged<Candles>(`candles/${mint}?tf=${tf}`, undefined, 0, false).then(({ data: d }) => { const got = d.rows.filter((x) => x.open > 0 && x.close > 0); if (got.length) remember(key, got); }).catch(() => {});
  }
}

export interface ChartPaper { t: number; exit_t?: number | null }
export interface ChartSignal { t: number }
// `migrate`: where a curve coin moves to its pool (pump.fun); drawn plain, and never stretches the price axis.
export interface Level { price: number; buy: boolean; title: string; migrate?: boolean }

export function CoinChart({ mint, marks, people, events, paper, signals, levels, defaultTf, born, migrated }: { mint: string; marks: Mark[]; people?: ChartPeople | null; events?: ChartEvent[]; paper?: ChartPaper[]; signals?: ChartSignal[]; levels?: Level[]; defaultTf: number; born?: number | null; migrated?: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [pick, setTfState] = useState<number>(() => store.get("coin:tf", 0) || defaultTf);
  // All's candle size: from the coin's launch time (fixed while it is open, so a coin ageing past a boundary does
  // not rebuild the chart; set again when the real launch time arrives). If the first answer fills the server's
  // whole window, the start was cut off (the launch time was later than the truth): the next size up.
  const [allSize, setAllSize] = useState(() => allTf(born));
  useEffect(() => { setAllSize(allTf(born)); }, [mint, born]);
  // Fomo mode and its candle size (Fomo's own names: "1S", "1", "1D"...): a coin in its first half hour opens on
  // 1s candles, one still on the curve on 15s, everything else on 1m, as Blix mode does.
  // Which chart a coin opens on: a coin launched in the last 24 hours on Blix live (every trade from the chain,
  // the overlays), an older one on the TradingView chart by Gecko (its complete history matters more than the
  // last second). A switch made by hand holds for that coin while it is open.
  const firstDay = (b?: number | null) => Boolean(b && b > 0 && Date.now() - b < 24 * 3600e3);
  const autoSrc = (b?: number | null): Src => (firstDay(b) ? "blix" : "tv");
  // A coin a day old or more: the Gecko chart only. Blix's own candles (and the per-coin chain subscription they
  // hold on the server) are for coins in their first day, where the second-by-second feed is worth its cost.
  // A replay (lib/replay.ts): Blix's candles built from the replayed trades, read again on every jump (epoch).
  const owner = useRole() === "owner";
  const replayOn = useReplay((st) => st.mint === mint), replayEpoch = useReplay((st) => (st.mint === mint ? st.epoch : 0));
  const geckoOnly = !firstDay(born) && !replayOn;
  // Read inside the chart's loader (which does not re-run when the launch time arrives): a coin whose launch time is
  // still unknown is not yet known to be a day old.
  const geckoOnlyRef = useRef(geckoOnly); geckoOnlyRef.current = geckoOnly && Boolean(born && born > 0);
  const geckoOnlyNow = () => geckoOnlyRef.current;
  const [srcPicked, setSrcState] = useState<Src>(() => autoSrc(born));
  const src: Src = replayOn ? "blix" : srcPicked;
  const picked = useRef<string | null>(null);   // the coin whose source was chosen by hand
  useEffect(() => { if (picked.current !== mint) setSrcState(autoSrc(born)); }, [mint, born]);
  const [fres, setFresState] = useState<string>(() => { const v = store.get("coin:fres", ""); return FOMO_TFS.some(([r]) => r === v) ? v : defaultTf === 1 ? "1S" : defaultTf === 15 ? "15S" : "1"; });
  const setSrc = (v: Src) => { if (geckoOnly && v === "blix") return; picked.current = mint; setSrcState(v); setFomoDown(null); };
  // TradingView mode's candle size (GeckoTerminal's free sizes, 1m to 1d): by default the size its embed opens on.
  const [tvTf, setTvTfState] = useState<number>(() => { const v = store.get("coin:tvtf", 0); return TV_TFS.some(([x]) => x === v) ? v : ({ "1m": 60, "5m": 300, "15m": 900 } as Record<string, number>)[geckoRes(born)] ?? 60; });
  const setTvTf = (v: number) => { store.set("coin:tvtf", v); setTvTfState(v); };
  // Fomo's bars could not be had (the server's Fomo sign-in is out, Fomo is down): the chart shows Blix's own
  // candles for this visit and says so in a line, instead of an error where the chart should be.
  const [fomoDown, setFomoDown] = useState<string | null>(null);
  const setFres = (v: string) => { store.set("coin:fres", v); setFresState(v); };
  const fomo = src === "fomo", gecko = src === "gecko", tv = src === "tv";
  // Gecko mode: the coin's frame (loaded already when its row was hovered) placed over this box, and Gecko's own
  // price asked for every few seconds so the figures around the chart (header, ticker) say what the chart says.
  const geckoBox = useRef<HTMLDivElement>(null);
  const [geckoMc, setGeckoMc] = useState<number | null>(null);
  useEffect(() => {
    if (!gecko || !geckoBox.current) return;
    mountGecko(mint, geckoBox.current, born);
    let alive = true, timer = 0;
    const tick = async () => { try { const d = await api<{ mc: number | null }>(`gecko/price/${mint}`); if (alive && d.mc) { pushCoinMc(mint, d.mc); setGeckoMc(d.mc); } } catch {} if (alive) timer = window.setTimeout(tick, document.hidden ? 15_000 : 5_000); };
    tick();
    return () => { alive = false; clearTimeout(timer); unmountGecko(); setGeckoMc(null); };
  }, [gecko, mint]);
  const all = !fomo && !tv && pick === ALL, tf = fomo ? (FOMO_TFS.find(([r]) => r === fres)?.[2] ?? 60) : tv ? tvTf : all ? allSize : pick;
  const [hover, setHover] = useState<Row | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; r: number; lines: string[]; card?: TipCard } | null>(null);
  // tf: the size these figures are for (until the new size's first candles are drawn, nothing is shown);
  // early: drawn from what was already here, the server's answer still to come.
  const [meta, setMeta] = useState<{ tf?: number; early?: boolean; source?: string; live?: boolean; note?: string | null; empty: boolean; last: Row | null }>({ empty: false, last: null });
  const lines = useRef<number[]>([]);      // the level prices, for the price axis to keep in view
  const s = useRef<{ chart?: IChartApi; candles?: ISeriesApi<"Candlestick">; markers?: ISeriesMarkersPluginApi<Time>; icons?: ChartIcons; byTime?: Map<number, Row>; first?: number; tf?: number }>({});
  // The drawn candles' times in order, for placing icons on candles (chartIcons.ts): built again only when a
  // candle is added (the map's size changes) or the chart is reloaded (a new map).
  const sorted = useRef<{ m: Map<number, Row>; n: number; keys: number[] } | null>(null);
  const candleTimes = () => {
    const m = s.current.byTime;
    if (!m?.size) return [];
    const c = sorted.current;
    if (c && c.m === m && c.n === m.size) return c.keys;
    const keys = [...m.keys()].sort((a, b) => a - b);
    sorted.current = { m, n: m.size, keys };
    return keys;
  };
  // A trade's candle: its own (the candle its time falls in) when drawn, else the nearest drawn one (the earlier
  // of two as near). Only candles with trades are drawn, so a time may have none.
  const onCandle = (time: number) => {
    const keys = candleTimes();
    if (!keys.length) return time;
    let lo = 0, hi = keys.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[mid] < time) lo = mid + 1; else hi = mid; }
    return lo > 0 && time - keys[lo - 1] <= keys[lo] - time ? keys[lo - 1] : keys[lo];
  };
  const setTf = (v: number) => { store.set("coin:tf", v); setTfState(v); };
  // A replay opens on 1s candles (not remembered: the live chart keeps its own size).
  // Choosing where to start shows the day on 1m candles (a day of 1s ones is too fine to click); the replay itself
  // then plays on 1s.
  const picking = useReplay((st) => st.mint === mint && st.picking);
  useEffect(() => { if (replayOn) setTfState(picking ? 60 : 1); }, [replayOn, picking]);
  // Seconds until the current candle closes (the toolbar's countdown), once a second while the page is shown.
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (all) return;
    const go = () => { if (!document.hidden) setLeft(tf - (Math.floor(Date.now() / 1000) % tf)); };
    go();
    const id = window.setInterval(go, 1000);
    return () => clearInterval(id);
  }, [tf, all]);

  // One chart per coin and candle size.
  useEffect(() => {
    if (!box.current || gecko) return;
    const ink = color("--color-ink", "#f2f4f7"), muted = color("--color-muted", "#8b93a1"), rule = color("--color-rule", "#232733"), paper4 = color("--color-paper-4", "#1c1f26");
    const up = color("--color-up", "#2ebd85"), down = color("--color-down", "#f6465d");
    const secs = tf < 60 && !all;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: CHART_BG }, textColor: muted, fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', sans-serif", fontSize: 11, attributionLogo: false },
      // Quiet grid: faint level lines to read prices off, no vertical lines.
      grid: { vertLines: { visible: false }, horzLines: { color: alpha(rule, 0.55) } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.18, bottom: 0.22 }, entireTextOnly: true },
      // The axis reads in this PC's time (the library's default is UTC, hours off from the trade list below it).
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: secs, rightOffset: 6, barSpacing: BAR, minBarSpacing: 1.5, maxBarSpacing: 40, shiftVisibleRangeOnNewBar: true,
        // A new day, month or year on the axis reads as a date ("Oct 6"), so a long history is not "18:00" over and over.
        tickMarkFormatter: (t: Time, kind: number) => kind <= 2
          // Daily candles start at midnight UTC: read in UTC, or west of Greenwich every date is a day early.
          ? new Date(Number(t) * 1000).toLocaleDateString([], { ...(kind === 0 ? { year: "numeric" } : { month: "short", day: "numeric" }), ...(tf >= 86400 ? { timeZone: "UTC" } : {}) } as Intl.DateTimeFormatOptions)
          : new Date(Number(t) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: secs ? "2-digit" : undefined, hour12: false }) },
      crosshair: { mode: 0, vertLine: { color: alpha(ink, 0.25), width: 1, style: 3, labelBackgroundColor: paper4 }, horzLine: { color: alpha(ink, 0.25), width: 1, style: 3, labelBackgroundColor: paper4 } },
      localization: { priceFormatter: usdP, timeFormatter: (t: Time) => tf >= 86400 ? new Date(Number(t) * 1000).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : tf >= 900 ? new Date(Number(t) * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : new Date(Number(t) * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: secs ? "2-digit" : undefined }) },
    });
    // On the seconds sizes most candles are flat (no trade that second) and draw as 1 px ticks with gaps between
    // them, which reads as a broken line. A thin line through the closes, under the candles, keeps the price
    // continuous between trades, as it is.
    // (The thin close line through the second candles was taken out 2026-10-08: it read as a stray line under
    // the candles. `thread` stays null so the updates below are no-ops.)
    const thread = null as ISeriesApi<"Line"> | null;
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
      priceFormat: { type: "custom", formatter: usdP, minMove: 1e-9 },
      priceLineColor: alpha(ink, 0.5), priceLineStyle: 2, priceLineWidth: 1,
      // A coin that moved 1% should look like it moved 1%, not fill the whole height. Your average buy and
      // sell stay in view while they are near the candles (within 2x either way), never squashing them.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const o = original();
        if (!o?.priceRange) return o;
        let { minValue: lo, maxValue: hi } = o.priceRange;
        for (const p of lines.current) if (p > lo / 2 && p < hi * 2) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
        const mid = (lo + hi) / 2, need = mid * MIN_RANGE;
        return { ...o, priceRange: hi - lo >= need ? { minValue: lo, maxValue: hi } : { minValue: Math.max(0, mid - need / 2), maxValue: mid + need / 2 } };
      },
    });
    // Volume: faint bars along the bottom fifth, on their own hidden scale (it never touches the price axis).
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    const markers = createSeriesMarkers(candles, []);
    const icons = new ChartIcons(
      { up, down, warn: color("--color-warn", "#f0c94a"), info: color("--color-info", "#7cc4f5"), dark: color("--color-paper", "#0b0c0f"), muted },
      (time) => s.current.byTime?.get(time),
      () => { const m = s.current.byTime; if (!m?.size || s.current.first == null) return null; let last = 0; for (const k of m.keys()) if (k > last) last = k; return [s.current.first, last]; },
      () => s.current.tf,
      candleTimes);
    candles.attachPrimitive(icons);
    // chart.remove() does not detach primitives: a face picture loading after it (a size switch, leaving the page)
    // asked the removed chart to repaint ("Object is disposed"). The icons let go of the chart first.
    const removeChart = () => { try { candles.detachPrimitive(icons); } catch { /* already gone */ } chart.remove(); };
    chart.subscribeCrosshairMove((p) => {
      const d = p?.seriesData?.get(candles) as CandlestickData<Time> | undefined;
      setHover(d ? s.current.byTime?.get(Number(d.time)) ?? null : null);
      const hit = p?.point ? icons.at(p.point.x, p.point.y) : null;
      setTip(hit ? { x: hit.x, y: hit.y, r: hit.r, lines: hit.tip, card: hit.card } : null);
    });
    // Practice, choosing where to start (lib/replay.ts): a click on a candle starts the replay at its close.
    chart.subscribeClick((p) => { if (p?.time != null && replaying(mint) && useReplay.getState().picking) pickStart(Number(p.time), tf); });
    s.current = { chart, candles, markers, icons, tf };

    let alive = true, timer = 0, first = true, framed = false, polls = 0;
    let raw: Row[] = [], rawFirst: number | null = null, src: string | undefined, firstTime: number | null = null, last: Row | null = null;
    const candle = ({ time, open, high, low, close, fill }: Row) => (fill ? { time: time as UTCTimestamp } : { time: time as UTCTimestamp, open, high, low, close });
    // One huge bar (the pool's opening deposit, a launch block) used to set the volume pane's scale and flatten
    // every other bar to nothing: bars are drawn up to 4x the 90th percentile of the series. Display only.
    let volCap = Infinity;
    const capFrom = (rows: Row[]) => { const v = rows.map((x) => x.value || 0).filter((n) => n > 0).sort((a, b) => a - b); volCap = v.length >= 10 ? v[Math.floor(v.length * 0.9)] * 4 : Infinity; };
    const volume = (x: Row) => (x.fill ? { time: x.time as UTCTimestamp } : { time: x.time as UTCTimestamp, value: Math.min(x.value || 0, volCap), color: alpha(x.close >= x.open ? up : down, 0.32) });
    // The newest candle time on the chart's series. The poll, the clock's flat candles and the stream's trades all
    // add to the series; the library throws on a time before its newest ("Cannot update oldest data"), so every
    // addition goes through put(), and a whole redraw (draw()) sets where the series ends.
    let top = -Infinity;
    const put = (x: Row) => {
      if (x.time < top) return;
      const added = x.time > top;
      top = x.time;
      candles.update(candle(x)); thread?.update({ time: x.time as UTCTimestamp, value: x.close }); vol.update(volume(x));
      // A new candle on a chart nobody has moved: framed again if the view would start before the first candle
      // (a young coin's few candles spread across the box, never bunched to the right with space on the left).
      if (added) { drawnN++; if (!userMoved && framed) { const r = chart.timeScale().getVisibleLogicalRange(); if (r && r.from < -1) frame(drawnN); } }
    };
    const draw = (rows: Row[]) => {
      candles.setData(rows.map(candle)); thread?.setData(rows.map((x) => ({ time: x.time as UTCTimestamp, value: x.close })));
      capFrom(rows); vol.setData(rows.map(volume));
      top = rows.length ? rows[rows.length - 1].time : -Infinity;
      drawnN = rows.length;
    };
    // The first view: the newest 160 candles, or all of them at the resting width.
    // The first view shows the coin's whole history whenever its candles can stay at least 2 px wide, so
    // nothing (the launch, the DEX paid mark, the dev's first buy) starts off screen; a longer history shows
    // as many of the newest as fit at 2 px. A short one sits at the resting width.
    const frame = (n: number) => {
      framed = true;
      // All: every candle from launch to now on screen at once, however thin.
      // All: every candle from launch to now on screen at once, as thin as it takes, with a little room on the right.
      // Practice, choosing where to start: the whole day on screen, so any candle can be clicked.
      if (all || (replaying(mint) && useReplay.getState().picking)) { chart.timeScale().applyOptions({ minBarSpacing: 0.2, rightOffset: 3 }); chart.timeScale().fitContent(); return; }
      // The chart fills its box edge to edge, as Axiom's does: a short history is spread across the whole width
      // (fitContent, candles never wider than 3x the resting width), a long one shows its newest candles at the
      // resting width. It used to keep whatever range an earlier draw left, which showed the candles in the middle
      // third with empty space on both sides.
      const width = Math.max(200, (box.current?.clientWidth || 900) - 70), fit = Math.floor(width / BAR);
      if (n <= fit) chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: n + 3 });
      else chart.timeScale().setVisibleLogicalRange({ from: n - fit, to: n + 4 });
    };
    // Until the person pans or zooms the chart themselves, every redraw and resize frames it again.
    let userMoved = false, drawnN = 0;
    const moved = () => { userMoved = true; };
    const el = box.current;
    el.addEventListener("wheel", moved, { passive: true }); el.addEventListener("pointerdown", moved); el.addEventListener("touchstart", moved, { passive: true });
    const ro = new ResizeObserver(() => { if (!userMoved && drawnN && framed) frame(drawnN); });
    ro.observe(el);
    const unframe = () => { ro.disconnect(); el.removeEventListener("wheel", moved); el.removeEventListener("pointerdown", moved); el.removeEventListener("touchstart", moved); };
    // Candles drawn before the server's answer: only the ones there are, no flat ones out to now until the
    // server says nothing happened since.
    const drawEarly = (from: Row[]) => {
      const rows = continuous(from, tf, from[from.length - 1].time, all ? Infinity : FILL_MAX);
      draw(rows); frame(rows.length);
      s.current.byTime = new Map(rows.map((x) => [x.time, x])); s.current.first = rows[0].time;
      setMeta({ tf, early: true, empty: false, last: rows[rows.length - 1] });
    };
    if (fomo) {
      // ---- Fomo mode: Fomo's own bars. The history is one read; after it every change to the open bar comes on
      // the stream (`fbar`) and is drawn at once, and the bars are polled only as a check (every 5 s while the
      // feed is flowing, every second or two when it is not). A full answer is drawn whole; a later one brings
      // the last few bars again, and only a new or changed bar is drawn.
      const fkey = `${mint}:F${fres}`;
      let rows: Row[] = (() => { const m = fmemo.get(fkey); return m && Date.now() - m.at < FRESH ? m.raw : []; })();
      let fcatch = false;
      const paint = (list: Row[], reframe: boolean) => {
        const right = reframe || !framed ? null : chart.timeScale().scrollPosition();
        draw(list);
        s.current.byTime = new Map(list.map((x) => [x.time, x])); s.current.first = list[0]?.time;
        if (right != null) chart.timeScale().scrollToPosition(right, false);
        if (reframe && list.length) frame(list.length);
        last = list[list.length - 1] ?? null; firstTime = list[0]?.time ?? null;
        if (box.current) Object.assign(box.current.dataset, { last: String(last?.time ?? ""), n: String(list.length), first: String(firstTime ?? ""), src: "Fomo", polls: String(polls), close: String(last?.close ?? "") });
      };
      if (rows.length) { paint(rows, true); setMeta({ tf, early: true, source: "Fomo", empty: false, last: rows[rows.length - 1] }); }
      const fload = async () => {
        const since = !first && last ? last.time - 3 * tf : null;
        const path = `fomo/bars/${mint}?res=${fres}${since ? `&since=${since}` : ""}`;
        const kept = first ? await apiAged<FomoBars>(path) : null;
        const d = kept ? kept.data : await api<FomoBars>(path);
        fcatch = Boolean(kept && kept.age > 0);
        if (!alive) return;
        if (d.error && !d.bars?.length && !rows.length) {
          if (box.current) box.current.dataset.err = d.error;
          if (!first) { setMeta({ tf, source: "Fomo", note: d.error, empty: true, last: null }); return; }
          // The very first answer failed: Blix's candles instead, right away.
          setFomoDown(d.signedOut ? "Fomo's chart is signed out on the server; showing Blix's candles." : "Fomo's chart isn't available right now; showing Blix's candles.");
          setSrcState("blix");
          return;
        }
        const k = d.supply && d.supply > 0 ? d.supply : 1;
        const got: Row[] = (d.bars || []).filter((b) => b[1] > 0 && b[4] > 0).map(([t, o, h, l, c, v]) => ({ time: t, open: o * k, high: h * k, low: l * k, close: c * k, value: v || 0 }));
        if (!got.length && !rows.length) { setMeta({ tf, source: "Fomo", live: d.live, note: d.error || null, empty: true, last: null }); first = false; return; }
        let changedOld = false;
        if (since == null) rows = got;
        else {
          const by = new Map(rows.map((x) => [x.time, x]));
          for (const x of got) { const o = by.get(x.time); if (o && x.time < (last?.time ?? Infinity) && !sameRow(o, x)) changedOld = true; by.set(x.time, x); }
          rows = [...by.values()].sort((a, b) => a.time - b.time);
        }
        if (first || since == null || changedOld || !last) paint(rows, first || !framed);
        else {
          for (const x of got) if (x.time >= last.time) { put(x); s.current.byTime?.set(x.time, x); }
          last = rows[rows.length - 1];
          if (box.current) { box.current.dataset.last = String(last.time); box.current.dataset.close = String(last.close); box.current.dataset.polls = String(polls); }
        }
        fmemo.delete(fkey); fmemo.set(fkey, { raw: rows, at: Date.now() }); if (fmemo.size > 14) fmemo.delete(fmemo.keys().next().value!);
        setMeta({ tf, source: "Fomo", live: d.live, note: d.error || null, empty: !rows.length, last });
        first = false;
      };
      // Live: a bar from Fomo's feed, drawn the moment it arrives (once the history is here; before that the
      // first read brings it anyway). An older bar that changed is left to the next check, which redraws.
      let liveAt = 0;
      const offLive = onFomoBar(mint, fres, (d) => {
        if (!alive || first || !rows.length || !last) return;
        const k = d.supply && d.supply > 0 ? d.supply : 1;
        const [t, o, h, l, c, v] = d.bar;
        if (!(o > 0 && c > 0) || t < last.time) return;
        const x: Row = { time: t, open: o * k, high: h * k, low: l * k, close: c * k, value: v || 0 };
        if (t === last.time) rows[rows.length - 1] = x; else rows.push(x);
        s.current.byTime?.set(x.time, x);
        put(x);
        last = x; liveAt = Date.now();
        pushCoinMc(mint, x.close);   // the header's market cap follows the bar
        if (box.current) { box.current.dataset.last = String(x.time); box.current.dataset.close = String(x.close); box.current.dataset.live = "1"; }
        setMeta((m) => (m.live && m.last?.time === x.time && m.last.close === x.close ? m : { ...m, tf, source: "Fomo", live: true, empty: false, last: x }));
      });
      let ffails = 0;
      const ftick = async () => {
        fcatch = false;
        if (!document.hidden) {
          try { await fload(); polls++; ffails = 0; if (box.current) box.current.dataset.err = ""; }
          catch (e) {
            ffails++;
            if (box.current) box.current.dataset.err = (e as Error).message;
            // The first read failed outright (the server is away, a member's request was refused): Blix's candles
            // for this visit, with a line saying so, never an empty chart.
            if (alive && first && !framed) { setFomoDown("Fomo's chart isn't available right now; showing Blix's candles."); setSrcState("blix"); return; }
          }
        }
        if (alive) timer = window.setTimeout(ftick, ffails ? backoff(ffails) : fcatch ? 40 : first ? 1500 : Date.now() - liveAt < 15_000 ? 5000 : tf <= 30 ? 1000 : 2000);
      };
      ftick();
      return () => { alive = false; unframe(); offLive(); clearTimeout(timer); removeChart(); s.current = {}; setHover(null); setTip(null); };
    }
    if (tv) {
      // ---- TradingView mode (a coin past its first day): candles read by the browser (lib/tvBars.ts: Jupiter, else
      // GeckoTerminal, else Blix's server) on this chart, so the faces, dev and sniper marks sit on them.
      // Instant: this page's last copy, else this browser's kept copy (localStorage), else the read a link's hover
      // started, drawn at once; the fresh read replaces it. Then older history in the background (the view stays
      // put), the newest few candles every 2-3 s, and the open candle on Blix's price read in between.
      const gkey = `${mint}:T${tf}`;
      let rows: Row[] = (() => { const m = gmemo.get(gkey); return m && Date.now() - m.at < FRESH ? m.raw : keptBars(mint, tf) || []; })();
      let source = "";
      // Jupiter's market caps are on its own supply (circulating, for some coins far under the full supply Blix
      // shows): the candles are put on the header's level when the two differ by more than 15%.
      let k = tvLevel.get(mint) ?? 1;
      const scaled = (list: Row[]) => (k === 1 ? list : list.map((x) => ({ ...x, open: x.open * k, high: x.high * k, low: x.low * k, close: x.close * k })));
      const keep = () => { gmemo.delete(gkey); gmemo.set(gkey, { raw: rows, at: Date.now() }); if (gmemo.size > 14) gmemo.delete(gmemo.keys().next().value!); };
      const paint = (list: Row[], reframe: boolean) => {
        const right = reframe || !framed ? null : chart.timeScale().scrollPosition();
        draw(list);
        s.current.byTime = new Map(list.map((x) => [x.time, x])); s.current.first = list[0]?.time;
        if (right != null) chart.timeScale().scrollToPosition(right, false);
        if (reframe && list.length) frame(list.length);
        last = list[list.length - 1] ?? null; firstTime = list[0]?.time ?? null;
        if (box.current) Object.assign(box.current.dataset, { last: String(last?.time ?? ""), n: String(list.length), first: String(firstTime ?? ""), src: source || "kept", polls: String(polls), close: String(last?.close ?? "") });
      };
      if (rows.length) { paint(rows, true); setMeta({ tf, early: true, source: "TradingView", empty: false, last: rows[rows.length - 1] }); }
      // A new or changed newest candle: drawn in place; an older one that changed redraws the lot.
      const merge = (got: Row[]) => {
        let older = false;
        const by = new Map(rows.map((x) => [x.time, x]));
        for (const x of got) { const o = by.get(x.time); if (o && x.time < (last?.time ?? Infinity) && !sameRow(o, x)) older = true; by.set(x.time, x); }
        rows = [...by.values()].sort((a, b) => a.time - b.time);
        if (older || !last) paint(rows, false);
        else for (const x of got) if (x.time >= last.time) { put(x); s.current.byTime?.set(x.time, x); last = x; }
      };
      let loaded = false;
      const gload = async () => {
        if (!loaded) {
          const got = await firstBars(mint, tf);
          if (!alive) return;
          source = got.source;
          if (!got.rows.length) {
            first = false;
            if (rows.length) return;
            if (!geckoOnlyNow()) { setSrcState("blix"); return; }
            setMeta({ tf, source: "TradingView", note: "No candles for this coin yet", empty: true, last: null }); return;
          }
          loaded = true; first = false;
          rows = scaled(got.rows); paint(rows, true); keep(); keepBars(mint, tf, rows);
          setMeta({ tf, source: "TradingView", live: true, empty: false, last });
          // Older history, up to 5,000 candles more, a read every 0.4 s, the view kept.
          for (let i = 0; i < 5 && alive && got.rows.length >= 990; i++) {
            await new Promise((ok) => setTimeout(ok, 400));
            if (!alive || !rows.length) return;
            const older = await tvBars(mint, tf, { before: rows[0].time }).catch(() => null);
            const add = scaled((older?.rows || []).filter((x) => x.time < rows[0].time));
            if (!alive || !add.length) break;
            rows = [...add, ...rows]; paint(rows, false); keep();
            if (add.length < 990) break;
          }
          return;
        }
        const got = await tvBars(mint, tf, { limit: 5 });
        if (!alive || !got.rows.length) return;
        source = got.source;
        merge(scaled(got.rows)); keep();
        if (box.current && last) Object.assign(box.current.dataset, { last: String(last.time), close: String(last.close), src: source, polls: String(polls) });
        if (polls % 10 === 0) keepBars(mint, tf, rows);
        setMeta({ tf, source: "TradingView", live: true, empty: false, last });
      };
      // The open candle between reads: Blix's own read of the coin's market cap every 3 s. Its first answer also sets
      // the level (k) when Jupiter's caps sit on another supply.
      let ptimer = 0;
      const price = async () => {
        try {
          const d = await api<{ mc: number | null }>(`gecko/price/${mint}`);
          if (alive && d.mc && last && loaded) {
            const r = d.mc / last.close;
            if (k === 1 && !tvLevel.has(mint) && (r > 1.15 || r < 1 / 1.15) && r < 20 && r > 1 / 20) {
              k = r; tvLevel.set(mint, r);
              rows = rows.map((x) => ({ ...x, open: x.open * r, high: x.high * r, low: x.low * r, close: x.close * r }));
              paint(rows, false); keep(); keepBars(mint, tf, rows);
            } else if (!tvLevel.has(mint)) tvLevel.set(mint, 1);
            pushCoinMc(mint, d.mc);
            const time = Math.floor(Date.now() / 1000 / tf) * tf;
            if (time >= last.time && Math.abs(d.mc / last.close - 1) < 0.5) {
              const x: Row = time === last.time ? { ...last, high: Math.max(last.high, d.mc), low: Math.min(last.low, d.mc), close: d.mc } : { time, open: last.close, high: Math.max(last.close, d.mc), low: Math.min(last.close, d.mc), close: d.mc, value: 0 };
              if (time === last.time) rows[rows.length - 1] = x; else rows.push(x);
              put(x); s.current.byTime?.set(x.time, x); last = x;
              setMeta((m) => ({ ...m, last: x }));
              if (box.current) Object.assign(box.current.dataset, { last: String(x.time), close: String(x.close), px: String(Date.now()) });
            }
          }
        } catch { /* the next read */ }
        if (alive) ptimer = window.setTimeout(price, document.hidden ? 20_000 : 3_000);
      };
      let gfails = 0;
      const gtick = async () => {
        if (!document.hidden || !loaded) {
          try { await gload(); polls++; gfails = 0; if (box.current) box.current.dataset.err = ""; }
          catch (e) {
            gfails++;
            if (box.current) box.current.dataset.err = (e as Error).message;
            if (alive && !loaded && !rows.length) setMeta({ tf, source: "TradingView", note: "The chart's sources are busy", empty: true, last: null });
          }
        }
        if (alive) timer = window.setTimeout(gtick, gfails ? Math.min(10_000, 1000 * 2 ** gfails) : !loaded ? 800 : tf < 60 ? 2000 : 3000);
      };
      gtick(); price();
      return () => { alive = false; unframe(); clearTimeout(timer); clearTimeout(ptimer); removeChart(); s.current = {}; setHover(null); setTip(null); };
    }
    // Before the server's answer: only this size's own candles drawn before (a return to a size, instant and
    // identical). Candles built from the page's trades used to go first and were reframed a moment later by the
    // real answer, which read as a stray chart flashing between sizes.
    const key = `${mint}:${tf}`, early = cached(mint, tf);
    if (early?.length) drawEarly(early);
    else if (tf >= 60) {
      // Nothing here to build from: the 15s candles answer at once (the server's own trades, no
      // GeckoTerminal) and make up these until the full answer with the older history arrives.
      apiAged<Candles>(`candles/${mint}?tf=15`).then(({ data: d }) => {
        const got = d.rows.filter((x) => x.open > 0 && x.close > 0);
        if (!got.length) return;
        remember(`${mint}:15`, got);
        if (alive && first && !framed) drawEarly(bucket(got, tf));
      }).catch(() => { /* the full answer is on its way anyway */ });
    }
    let rev: number | null = null;
    const anchored = (rowsIn: Row[], tfIn: number): Row[] => {
      if (!born || !(born > 0) || !/pump$/.test(mint)) return rowsIn;
      const sol = usePulse.getState().live?.solUsd;
      if (!(sol && sol > 0)) return rowsIn;
      const t0 = Math.floor(born / 1000 / tfIn) * tfIn, px = START_SOL * sol;
      if (rowsIn.length && rowsIn[0].time <= t0 + tfIn) return rowsIn;
      // Only when the flat stretch fits what the chart fills (else continuous() would start the chart over anyway).
      if (rowsIn.length && !all && (rowsIn[0].time - t0) / tfIn > FILL_MAX) return rowsIn;
      return [{ time: t0, open: px, high: px, low: px, close: px, value: 0 }, ...rowsIn];
    };
    const load = async (whole: boolean): Promise<void> => {
      // The fast refresh asks only for the candles from the last real one on (a few rows); every 20th pass
      // re-reads it all. A server without `since` answers in full, which is handled the same way.
      // The refresh reaches back 30 s (a few candles) past the last one drawn: a second the live feed
      // under-reported is replaced by the store's settled candle on the next poll, not on the 20th.
      const since = !first && !whole && raw.length ? raw[raw.length - 1].time - Math.ceil(30 / tf) * tf : null;
      const path = `candles/${mint}?tf=${tf}${since ? `&since=${since}` : ""}`;
      // The first read may be the page server's kept copy (lib/api.ts): it is drawn at once and the read after it,
      // from its last candle on, brings it up to date. Any later full read replaces what is drawn, so it has to be
      // the radar's own.
      const kept = first ? await apiAged<Candles>(path) : null;
      const d = kept ? kept.data : await api<Candles>(path);
      catchUp = Boolean(kept && kept.age > 0);
      if (!alive) return;
      const got = d.rows.filter((x) => x.open > 0 && x.close > 0);
      // A launch day's stray quote (Fartcoin's first day "opens" at $1.2B, closes at $82M) is cut to that day's
      // close, so it does not flatten years of chart under it.
      if (tf >= 14400 && got.length > 5) {
        const ref = Math.max(...got.slice(1, 30).map((x) => x.high));
        for (const x of got.slice(0, 3)) if (x.high > ref * 3) { if (x.open > ref * 3) x.open = x.close; x.high = Math.max(x.open, x.close, ref); }
      }
      // All: a full window means the launch is further back than this size reaches; go one size up.
      // Past 1h (about 41 days) only for a coin still worth $50K: 4-hour candles, then daily ones. A dead coin's
      // whole life is no use to anyone; it keeps its last 41 days.
      if (all && first && since == null && got.length >= 950) {
        const up = ALL_TFS.find((v) => v > tf);
        if (up && (up <= 3600 || (got[got.length - 1]?.close ?? 0) >= 50_000)) { setAllSize(up); return; }
      }
      // The server's candles for this coin were made again (trades read back from the chain after a feed
      // outage): the whole chart is re-read now, so the flat line drawn through the outage gets its candles.
      if (d.partial && since != null && d.rev != null && rev != null && d.rev !== rev) { rev = d.rev; return load(true); }
      if (d.rev != null) rev = d.rev;
      if (d.partial && since != null && d.source === src && d.first === rawFirst) raw = [...raw.filter((x) => x.time < since), ...got];
      else if (d.partial) return load(true);
      else {
        // Jupiter sends a coin's latest 1,000 candles, so on a busy coin the window's start moves forward with
        // every poll and the chart lost its left end, then sat with empty space on the right (the view kept its
        // bar positions over fewer bars). Candles already drawn from the same source before the new start stay.
        const keep = got.length && d.source === src ? raw.filter((x) => x.time < got[0].time).slice(-20_000) : [];
        raw = [...keep, ...got]; rawFirst = d.first ?? got[0]?.time ?? null;
      }
      // A second chart whose history starts after the launch (the radar heard the coin late; Jupiter's window is
      // under 17 minutes at 1 s): the browser reads the minutes before from Jupiter (lib/jupEarly.ts) and they are
      // put on the server's level where the two meet. Asked on every poll until they are in; then the chart starts
      // at the launch and this no longer applies. Coins under 3 hours old, never in a replay.
      const bornS = born && born > 0 ? born / 1000 : 0;
      if (tf < 60 && !replayOn && bornS && Date.now() / 1000 - bornS < 3 * 3600 && raw.length && raw[0].time > bornS + 2 * tf && !/Jupiter before/.test(d.source || "")) {
        const e = earlyBars(mint, tf, raw[0].time), pre = e ? onLevel(e, raw) : [];
        if (pre.length) raw = [...pre, ...raw];
      }
      // A pump coin's chart begins at launch, at the opening cap, flat until the first trade the history holds:
      // a history that starts later (the radar met the coin mid-way, Jupiter's window) no longer opens the chart
      // on a lone candle at the wrong level.
      const base = anchored(raw, d.tf || tf);
      const rows = continuous(base, d.tf || tf, replayNow(mint) / 1000, all ? Infinity : FILL_MAX);
      // Only the newest candles change between polls. Anything else redraws it all (setData keeps the view):
      // a new source, an earlier start, or a late trade landing in an interval already drawn (flat), which
      // series.update() cannot reach because it only takes the newest candle.
      const drawn = s.current.byTime, lastT = last?.time ?? Infinity;
      const late = Boolean(drawn) && rows.some((x) => x.time < lastT && x.time >= (since ?? -Infinity) && !sameRow(drawn!.get(x.time), x));
      const redraw = first || !last || rows.length < 2 || d.source !== src || rows[0].time !== firstTime || late;
      if (redraw) {
        // A redraw keeps the newest candle where it was from the right edge (setData alone keeps bar
        // positions, which leaves a gap on the right when the history changes length).
        const right = first || !framed || !userMoved ? null : chart.timeScale().scrollPosition();
        draw(rows);
        if (right != null) chart.timeScale().scrollToPosition(right, false);
        // The first full answer frames the chart again (the quick early draw had only the newest trades), and so
        // does every redraw while the person has not moved the chart: it always fills the box.
        if ((first || !framed || !userMoved) && rows.length) frame(rows.length);
      } else {
        for (const x of rows) if (x.time >= last!.time) put(x);   // last: set whenever this is not a redraw
      }
      // The answer can end before what the clock and the stream have already drawn (flat candles out to now, a
      // trade a moment ago): those stay, and `last` never steps back behind them.
      const ahead = !redraw && last && rows.length && last.time > rows[rows.length - 1].time ? last : null;
      s.current.byTime = new Map(rows.map((x) => [x.time, x]));
      if (ahead) s.current.byTime.set(ahead.time, ahead);
      s.current.first = rows[0]?.time;
      firstTime = rows[0]?.time ?? null;
      last = ahead ?? rows[rows.length - 1] ?? null;
      src = d.source;
      // What the chart holds, readable from outside (scripts/chart-probe.mjs measures the live chart with it).
      if (box.current) Object.assign(box.current.dataset, { last: String(last?.time ?? ""), n: String(rows.length), first: String(firstTime ?? ""), src: d.source || "", polls: String(polls), close: String(last?.close ?? "") });
      remember(key, raw);
      setMeta({ tf, source: d.source, live: d.live, note: d.note, empty: !rows.length, last });
      first = false;
    };
    // While the stream is bringing this coin's trades it already moves the chart trade by trade, so the poll
    // only has to catch up (every 2 s); without it the poll is the chart's only source and runs fast.
    let streamT = 0, catchUp = false, fails = 0;   // catchUp: what was just drawn was a kept copy; read on from it at once
    const tick = async () => {
      catchUp = false;
      if (!document.hidden) {
        try { await load(++polls % 20 === 0); fails = 0; if (box.current) box.current.dataset.err = ""; }
        catch (e) { fails++; if (box.current) box.current.dataset.err = (e as Error).message; if (alive && first && !framed) setMeta({ tf, note: (e as Error).message, empty: true, last: null }); }
      }
      // Faster polls on every size: a coin with no stream (a non-pump pool) moves on the poll alone, and the
      // poll is cheap for the radar (the store answers from the last candle on).
      if (alive) timer = window.setTimeout(tick, fails ? backoff(fails) : catchUp ? 40 : Date.now() - streamT < 3000 ? 1500 : tf <= 5 ? 300 : tf <= 15 ? 500 : 1000);
    };
    tick();
    // No clock adding flat candles between trades: only traded intervals are drawn (continuous()), and flats put
    // here were dropped again by the next redraw, shifting the bars and making the time axis jump.
    // Between polls every trade moves the chart the moment the stream brings it (the server sends trades for
    // a coin whose candles were just asked for): the newest candle takes the trade, or a new one opens at the
    // last close (quiet intervals in between are not drawn). The next poll's answer is the same trades.
    let paint = 0, painted: Row | null = null;
    const untrade = onCoinTrade(mint, (x) => {
      const [, ms, mc, v] = x, slot = (x as unknown as (number | null)[])[5];
      streamT = Date.now();
      if (box.current) box.current.dataset.psrc = slot != null ? "logs" : "fast";   // which stream moved the chart last (probe)
      if (first || !last) return;
      const time = Math.floor(ms / 1000 / tf) * tf;
      if (time < last.time) return;
      if (time > last.time) {
        if (time - last.time > tf * FILL_MAX) return;   // a long silence: the next poll starts the chart over
        last = { time, open: last.close, high: Math.max(last.close, mc), low: Math.min(last.close, mc), close: mc, value: v };
      } else last = { ...last, high: Math.max(last.high, mc), low: Math.min(last.low, mc), close: mc, value: (last.value || 0) + v };
      put(last);
      s.current.byTime?.set(last.time, last);
      if (box.current) { box.current.dataset.last = String(last.time); box.current.dataset.close = String(last.close); box.current.dataset.pushed = String(Date.now()); }
      // The figures over the chart follow at most once a frame.
      painted = last;
      if (!paint) paint = requestAnimationFrame(() => { paint = 0; if (alive && painted) setMeta((m) => ({ ...m, last: painted })); });
    });
    return () => { alive = false; unframe(); untrade(); cancelAnimationFrame(paint); clearTimeout(timer); removeChart(); s.current = {}; setHover(null); setTip(null); };
  }, [mint, tf, all, src, replayEpoch]);   // src: a source switch ends the old loader before the new one starts (or none, for Gecko)

  // Your average buy and sell: dashed lines across the chart with their market cap on the price axis.
  const live = (levels || []).filter((l) => l.price > 0 && isFinite(l.price));
  const migrate = live.find((l) => l.migrate)?.price ?? null;
  const levelKey = live.map((l) => `${l.buy ? "b" : "s"}${l.price.toPrecision(6)}${l.title}`).join("|");
  useEffect(() => {
    const { candles } = s.current;
    lines.current = live.filter((l) => !l.migrate).map((l) => l.price);
    if (!candles) return;
    const up = color("--color-up", "#2ebd85"), down = color("--color-down", "#f6465d");
    const plain = alpha(color("--color-ink", "#e6e6e6"), 0.55);
    const made: IPriceLine[] = live.map((l) => candles.createPriceLine({ price: l.price, color: l.migrate ? plain : l.buy ? up : down, lineWidth: 1, lineStyle: l.migrate ? LineStyle.LargeDashed : LineStyle.Dashed, lineVisible: true, axisLabelVisible: true, title: l.title, axisLabelColor: "", axisLabelTextColor: "" }));
    // Lines go with their chart: removing one from a removed chart would schedule a paint on its dead canvas.
    return () => { if (s.current.candles === candles) for (const x of made) candles.removePriceLine(x); };
  }, [levelKey, tf, mint]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Your own buys and sells as green and red arrows (B / S) and alerts as plain muted squares, through the
  // library's markers; everyone else's trades and DexScreener's orders as icons (chartIcons.ts), one per
  // candle, kind, side and followed wallet, with how many trades it stands for.
  useEffect(() => {
    const { markers, icons, first, tf: ctf } = s.current;
    if (!markers || !icons || ctf == null) return;
    const muted = color("--color-muted", "#8b93a1");
    // Icons carry the start of the interval their trade happened in; the icon layer (chartIcons.ts) puts each on
    // that candle (or the last drawn one before it) when it draws, so an icon never moves to another candle.
    const snap = (ms: number) => Math.floor(ms / 1000 / ctf) * ctf;
    const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    // Your own buys and sells, as Axiom draws them: a green B / red S bubble over the candle, stacked with the rest
    // of that candle's icons (several in one candle: one bubble with the count).
    const ownBadges: Badge[] = [];
    const addOwn = (ms: number, buy: boolean) => ownBadges.push({ time: snap(ms), price: null, buy, kind: "own", text: buy ? "B" : "S", n: 1,
      tip: [`You ${buy ? "bought" : "sold"}${paper?.length ? " (paper)" : ""}`, clock(ms)],
      card: { name: "You", tag: buy ? "Buy" : "Sell", tone: buy ? "up" : "down", t: ms, sub: paper?.length ? "Paper trade" : undefined } });
    // A partial sell splits a paper row and the parts keep the buy's time: each buy is marked once.
    const buys = new Set<number>();
    for (const p of paper || []) { if (!buys.has(p.t)) { buys.add(p.t); addOwn(p.t, true); } if (p.exit_t) addOwn(p.exit_t, false); }
    // Signals stay the library's small squares, which need a drawn candle's own time.
    // (Alert squares were taken off 2026-10-09: older alerts all snapped onto the first candle as a grey column.)
    const list: SeriesMarker<Time>[] = [];
    void signals; void muted; void onCandle;
    markers.setMarkers(list);

    const WHO: Record<IconKind, string> = { own: "You", dev: "Dev", tracked: "", sniper: "Sniper", bundle: "Bundle wallet", whale: "Big trade:", person: "", call: "", migrate: "" };
    const groups = new Map<string, Badge & { sol: number; usd: number; mcs: number[]; t0: number; t1: number; who: string }>();
    for (const m of marks) {
      const time = snap(m.t), who = m.kind === "tracked" ? (m.label || "Followed wallet") : WHO[m.kind];
      const k = `${time}|${m.kind}|${m.buy ? 1 : 0}|${m.kind === "tracked" ? who : ""}`;
      const g = groups.get(k) || { time, price: null, buy: m.buy, kind: m.kind, n: 0, tip: [], sol: 0, usd: 0, mcs: [], t0: m.t, t1: m.t, who,
        text: m.kind === "dev" ? (m.buy ? "DB" : "DS") : m.kind === "sniper" ? (m.buy ? "SB" : "SS") : m.kind === "bundle" ? (m.buy ? "BB" : "BS") : m.kind === "tracked" ? initials(m.label) : "" };
      g.n++; g.sol += m.sol || 0; g.usd += m.usd || 0; if (m.mc) g.mcs.push(m.mc); g.t0 = Math.min(g.t0, m.t); g.t1 = Math.max(g.t1, m.t);
      groups.set(k, g);
    }
    const badges: Badge[] = [...groups.values()].map((g) => {
      const mc = g.mcs.length ? g.mcs.reduce((x, y) => x + y, 0) / g.mcs.length : null;
      return { time: g.time, price: mc, buy: g.buy, kind: g.kind, text: g.text, n: g.n, usd: g.usd,
        card: { name: g.who.replace(/:$/, "") || "Trader", tag: g.buy ? "Buy" : "Sell", tone: g.buy ? "up" as const : "down" as const, t: g.t0, t1: g.t1, usd: g.usd || undefined, sol: g.sol || undefined, n: g.n, mc },
        tip: [`${g.who} ${g.buy ? "bought" : "sold"}${g.n > 1 ? ` ${g.n}×` : ""}${g.usd ? ` · $${Math.round(g.usd).toLocaleString()}` : ""}${g.sol ? ` · ${solN(g.sol)}` : ""}`,
          `${mc ? `${g.n > 1 ? "avg MC" : "MC"} ${usdP(mc)} · ` : ""}${clock(g.t0)}${g.t1 - g.t0 > 1000 ? ` – ${clock(g.t1)}` : ""}`] };
    })
      // Dots under badges, followed wallets on top of everything.
      .sort((x, y) => rank(x.kind) - rank(y.kind));
    // Faces: one per candle, person and side (a call stands alone), at the market cap they traded at.
    const who = new Map((people?.people || []).map((p) => [p.id, p]));
    const faces = new Map<string, Badge & { usd: number; mcs: number[]; t0: number; t1: number; p: ChartPerson }>();
    // Only people worth a face for their trades: every Fomo trader and the 8 most followed
    // pump.fun accounts (100+ followers). Everyone who called it keeps the call's own face.
    // Anyone trading the coin more than 12 times is a bot (or farming volume): no face for them.
    const moved = new Map<string, number>(), count = new Map<string, number>();
    for (const x of people?.trades || []) { moved.set(x.who, (moved.get(x.who) || 0) + (x.usd || 0)); count.set(x.who, (count.get(x.who) || 0) + 1); }
    // Every Fomo trader with a picture gets a face on every buy and sell (never counted as a bot); pump.fun
    // accounts trading more than 12 times are bots.
    const pics = (people?.people || []).filter((p) => p.pic && (p.src === "fomo" || (count.get(p.id) || 0) <= 12));
    const keepIds = new Set([...pics.filter((p) => p.src === "fomo").map((p) => p.id),
      ...pics.filter((p) => p.src === "pump" && (p.followers || 0) >= 100).sort((a, b) => (b.followers || 0) - (a.followers || 0)).slice(0, 8).map((p) => p.id)]);
    for (const x of people?.trades || []) {
      const p = who.get(x.who); if (!p?.pic || !keepIds.has(x.who)) continue;
      // A face sits on the candle its trade happened in (9:44 → the 9:44 candle): one per person, side and candle.
      const time = snap(x.t), k = `${time}|${x.who}|${x.buy ? 1 : 0}`;
      const g = faces.get(k) || { time, price: null, buy: x.buy, kind: "person" as IconKind, text: initials(p.name), pic: p.pic, n: 0, tip: [], usd: 0, mcs: [], t0: x.t, t1: x.t, p };
      g.n++; g.usd += x.usd || 0; if (x.mc) g.mcs.push(x.mc); g.t0 = Math.min(g.t0, x.t); g.t1 = Math.max(g.t1, x.t);
      faces.set(k, g);
    }
    const src = (p: ChartPerson) => `${p.src === "fomo" ? "Fomo" : "pump.fun"}${p.followers && p.followers < 1e8 ? ` · ${p.followers.toLocaleString()} followers` : ""}${p.dev ? " · dev" : ""}`;
    // At most FACES people per candle and side, so a busy candle stays readable: Fomo traders first, then the
    // most followed, then the biggest trade. The rest are a +n on the last face, named in its tooltip.
    const FACES = 3;
    const slots = new Map<string, (typeof faces extends Map<string, infer V> ? V : never)[]>();
    for (const g of faces.values()) { const k = `${g.time}|${g.buy ? 1 : 0}`; slots.set(k, [...(slots.get(k) || []), g]); }
    const weight = (p: ChartPerson) => (p.src === "fomo" ? 1e12 : 0) + (p.followers || 0);
    for (const list of slots.values()) {
      list.sort((a, b) => weight(b.p) - weight(a.p) || b.usd - a.usd);
      const shown = list.slice(0, FACES), rest = list.slice(FACES);
      shown.forEach((g, i) => {
        const mc = g.mcs.length ? g.mcs.reduce((a, b) => a + b, 0) / g.mcs.length : null;
        const extra = i === shown.length - 1 && rest.length ? rest : [];
        badges.push({ time: g.time, price: mc, buy: g.buy, kind: "person", text: g.text, pic: g.pic, n: g.n, usd: g.usd, more: extra.length || undefined,
          card: { name: g.p.name, pic: g.pic, tag: g.buy ? "Buy" : "Sell", tone: g.buy ? "up" : "down", t: g.t0, t1: g.t1, usd: g.usd || undefined, n: g.n, mc },
          tip: [`${g.p.name} ${g.buy ? "bought" : "sold"}${g.n > 1 ? ` ${g.n}×` : ""}${g.usd ? ` · $${Math.round(g.usd).toLocaleString()}` : ""}`,
            `${mc ? `${g.n > 1 ? "avg MC" : "MC"} ${usdP(mc)} · ` : ""}${clock(g.t0)}${g.t1 - g.t0 > 1000 ? ` – ${clock(g.t1)}` : ""}`, src(g.p),
            ...(extra.length ? [`Also ${g.buy ? "buying" : "selling"}: ${extra.slice(0, 6).map((x) => x.p.name).join(", ")}${extra.length > 6 ? ` +${extra.length - 6}` : ""}`] : [])] });
      });
    }
    for (const x of people?.calls || []) {
      const p = who.get(x.who); if (!p?.pic) continue;
      const text = (x.text || "").replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, "@$1").replace(/\s+/g, " ").trim();
      badges.push({ time: snap(x.t), price: x.mc, buy: true, kind: "call", text: initials(p.name), pic: p.pic, n: 1,
        card: { name: p.name, pic: p.pic, tag: p.src === "fomo" ? "Thesis" : "Callout", tone: "info", t: x.t, mc: x.mc, text: text || null, likes: x.likes ?? null },
        tip: [`${p.name} called it${x.mc ? ` at ${usdP(x.mc)} MC` : ""}`, ...(text ? [text.length > 140 ? `${text.slice(0, 137)}…` : text] : []), `${clock(x.t)} · ${src(p)}`] });
    }
    // At most 80 faces on the chart (30 on coarse candles: All, 15m and up): trades first (Fomo traders' before
    // pump.fun's, the newest first), then calls. Stacks that run out of room fold into a +n (chartIcons.ts).
    const dense = all || ctf >= 900;
    const isFomo = (x: Badge) => (x.tip[2] || "").startsWith("Fomo");
    const faceList = badges.filter((x) => x.kind === "person" || x.kind === "call")
      .sort((x, y) => (x.kind === "call" ? 1 : 0) - (y.kind === "call" ? 1 : 0) || (isFomo(y) ? 1 : 0) - (isFomo(x) ? 1 : 0) || y.time - x.time);
    const drop = new Set(faceList.slice(dense ? 30 : 80));
    for (let i = badges.length - 1; i >= 0; i--) if (drop.has(badges[i])) badges.splice(i, 1);
    badges.push(...ownBadges);
    // The candle the coin migrated on (pump.fun curve full, moved to its PumpSwap pool): a blue M over it.
    if (migrated) badges.push({ time: snap(migrated), price: null, buy: true, kind: "migrate", text: "M", n: 1, tip: ["Migrated to PumpSwap", clock(migrated)], card: { name: "Migrated to PumpSwap", tag: "Migration", tone: "info", t: migrated } });
    badges.sort((x, y) => rank(x.kind) - rank(y.kind));
    // DexScreener orders (DEX paid, boosts) and big-trade dots are not drawn (2026-10-09): clutter, not trades.
    void events;
    const flags: Flag[] = [];
    const shown = badges.filter((x) => x.time >= (first ?? Infinity));
    icons.set(shown.filter((x) => x.kind !== "whale"), flags);
  }, [marks, people, events, paper, signals, tf, all, meta.empty, meta.source, migrated]);

  // The line above the chart: the candle under the pointer, or the newest one (of this size only).
  const shown = meta.tf === tf;
  const c = hover || (shown ? meta.last : null);
  const chg = c && c.open > 0 ? (c.close / c.open - 1) * 100 : 0;
  // Nothing to draw: said in the middle of the chart, where it is seen (on a phone the space under the chart
  // is off screen). The chart keeps asking every few seconds, so it fills in by itself.
  // [title, text, button]: the button switches to Blix's own candles in Fomo mode, to 1m candles in Blix mode.
  const why: [string, string, boolean] | null = gecko || !shown || !meta.empty ? null
    : tv && meta.note ? [/busy/i.test(meta.note) ? "Waiting for the chart" : "No candles yet", /busy/i.test(meta.note) ? "The chart's sources didn't answer. Blix asks again in a moment." : "There are no candles for this coin at this size yet. Try another size.", false]
    : fomo && meta.note ? ["Couldn't load Fomo's chart", `${meta.note.replace(/\.$/, "")}. Trying again every few seconds.`, true]
    : fomo ? ["No bars on Fomo yet", "Fomo has no candles for this coin at this size yet. Blix's own candles are built from every trade it reads from the chain.", true]
    : meta.note && /GeckoTerminal/i.test(meta.note) ? ["Waiting for the price history", "This coin's candles come from GeckoTerminal, which is busy right now. Blix asks again every few seconds.", false]
    : meta.note ? ["Couldn't load the candles", `${meta.note.replace(/\.$/, "")}. Trying again every few seconds.`, false]
    : tf < 60 ? ["No live trades yet", "Second candles are built from the trades Blix sees live. 1m and longer show the coin's whole history.", true]
    : ["No candles yet", "No trades in this window yet. Candles appear with the first trade Blix sees.", false];
  return (
    <div className="flex flex-col gap-1.5 p-2.5">
      <div className="flex flex-wrap items-center gap-3">
        {/* Developer only (the user, 2026-10-10). Replay this coin's last day from a bar you pick (lib/replay.ts opens on the whole day: click a candle). */}
        {owner && !replayOn && (
          <button onClick={() => void startReplay(mint)} title="Replay this coin: see its whole day, click the bar to start from, then play it forward and paper-trade it"
            className="flex h-7 items-center gap-1.5 rounded-full border border-rule bg-paper-3/70 px-3 text-xs font-semibold text-ink-2 transition-colors hover:border-accent hover:text-ink">
            <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2.5 2.5v2.6h2.6" /><path d="M7 5.8v4.4L10.4 8 7 5.8Z" fill="currentColor" /></svg>
            Replay
          </button>
        )}
          {fomoDown && !fomo && <span className="ml-2 truncate text-[11px] text-muted" title={fomoDown}>{fomoDown}</span>}
        {!gecko && <div role="radiogroup" aria-label="Candle size" className="relative inline-flex items-center gap-0.5 rounded-full border border-rule bg-paper-3/70 p-0.5">
          {tv ? TV_TFS.map(([v, l]) => (
            <button key={v} role="radio" aria-checked={tvTf === v} onClick={() => setTvTf(v)}
              className={cn("num flex h-6 min-w-8 items-center justify-center rounded-full px-2.5 text-xs font-semibold transition-colors duration-100", tvTf === v ? "bg-ink text-paper shadow-sm" : "text-muted hover:bg-paper-4/60 hover:text-ink")}>{l}</button>
          )) : fomo ? FOMO_TFS.map(([r, l]) => (
            <button key={r} role="radio" aria-checked={fres === r} onClick={() => setFres(r)}
              className={cn("num flex h-6 min-w-8 items-center justify-center rounded-full px-2.5 text-xs font-semibold transition-colors duration-100", fres === r ? "bg-ink text-paper shadow-sm" : "text-muted hover:bg-paper-4/60 hover:text-ink")}>{l}</button>
          )) : [...TFS, [ALL, "All"] as [number, string]].map(([v, l]) => (
            <button key={v} role="radio" aria-checked={pick === v} onClick={() => setTf(v)} title={v === ALL ? "The coin's whole history, from launch to now" : undefined}
              className={cn("num flex h-6 min-w-8 items-center justify-center rounded-full px-2.5 text-xs font-semibold transition-colors duration-100", pick === v ? "bg-ink text-paper shadow-sm" : "text-muted hover:bg-paper-4/60 hover:text-ink")}>{l}</button>
          ))}
        </div>}
        {/* The candle under the pointer (or the newest), quietly: its market cap and change, then open, high, low and
            volume in small muted labels. No boxes; colour only on the change. */}
        {c && (() => {
          const fig = (k: string, v: string, cls = "max-md:hidden") => (
            <span className={cn("flex items-baseline gap-1", cls)}><span className="text-[0.6875rem] text-muted">{k}</span><span className="text-ink-2">{v}</span></span>
          );
          return (
            <span className="num flex items-baseline gap-3 text-xs tracking-tight">
              <span className="flex items-baseline gap-1.5">
                <b className="text-[0.8125rem] font-semibold text-ink">{usdP(c.close)}</b>
                <span className={cn("font-medium", c.close >= c.open ? "text-up" : "text-down")}>{pctF(chg)}</span>
              </span>
              {fig("O", usdP(c.open))}{fig("H", usdP(c.high))}{fig("L", usdP(c.low))}{fig("V", usdK(c.value || 0), "max-lg:hidden")}
            </span>
          );
        })()}
        {/* pump.fun moves the coin to its own pool at this market cap: how far along it is, as a hairline. */}
        {migrate && (() => {
          const at = c && c.close > 0 ? Math.min(1, c.close / migrate) : null;
          return (
            <span className="num flex items-center gap-2 text-xs" title={`pump.fun moves the coin to its own pool at ${usdP(migrate)} market cap${c && c.close > 0 && c.close < migrate ? ` (+${Math.round((migrate / c.close - 1) * 100).toLocaleString()}% from here)` : ""}`}>
              <i aria-hidden className="h-3 w-px bg-rule-2" />
              <span className="text-[0.6875rem] text-muted">Migrates</span>
              {at != null && <span className="block h-0.5 w-12 overflow-hidden rounded-full bg-rule-2 max-sm:hidden"><i className="block h-full rounded-full bg-ink-2 transition-[width] duration-500" style={{ width: `${at * 100}%` }} /></span>}
              <span className="text-ink-2">{usdP(migrate)}</span>
            </span>
          );
        })()}
        {/* Blix live shows no countdown or source label here (the owner, 2026-10-10): the chart speaks for itself. */}
        {tv && <a href="https://www.tradingview.com/" target="_blank" rel="noopener" title="Charts by TradingView; candles from Jupiter, GeckoTerminal when Jupiter has none" className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-ink">Chart by TradingView ↗</a>}
        {gecko && <span className="ml-auto flex items-center gap-2 text-xs text-muted">
          <a href={`https://www.geckoterminal.com/solana/pools/${mint}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 hover:text-ink"><SiteLogo site="geckoterminal" className="size-3.5" />GeckoTerminal ↗</a>
        </span>}
      </div>
      <div className="relative">
        {gecko
          ? <>
            <div ref={geckoBox} data-coin-chart data-src="Gecko" className="h-[clamp(340px,52vh,760px)] w-full overflow-hidden rounded-control border border-rule" style={{ background: CHART_BG }} />
            {/* Your average buy and sell over GeckoTerminal's chart: its frame is another site's page, so no line can be
                drawn on its candles; pills in its corner instead, with how far the market cap is from each now. */}
            {live.some((l) => !l.migrate) && (
              <div className="pointer-events-none absolute top-[66px] right-[78px] z-[2] flex flex-wrap justify-end gap-1.5 max-sm:top-auto max-sm:right-auto max-sm:bottom-[64px] max-sm:left-12">
                {live.filter((l) => !l.migrate).map((l) => {
                  const d = geckoMc ? (geckoMc / l.price - 1) * 100 : null;
                  return (
                    <span key={l.title} className={cn("num flex items-center gap-1.5 rounded-full border bg-paper/85 py-1 pr-2.5 pl-2 text-xs font-semibold shadow-[var(--shadow-raised)] backdrop-blur-sm",
                      l.buy ? "border-up/50 text-up" : "border-down/50 text-down")}>
                      <i className={cn("h-0 w-3 border-t-2 border-dashed", l.buy ? "border-up" : "border-down")} />
                      <span className="text-ink-2">{l.title}</span><b className="text-ink">{usdP(l.price)}</b>
                      {d != null && <span className={d >= 0 ? "text-up" : "text-down"}>{d >= 0 ? "+" : "−"}{Math.abs(d) >= 1000 ? Math.round(Math.abs(d)).toLocaleString() : Math.abs(d).toFixed(1)}%</span>}
                    </span>
                  );
                })}
              </div>
            )}
          </>
          : <div ref={box} data-coin-chart className="h-[clamp(340px,52vh,760px)] w-full overflow-hidden rounded-control border border-rule" style={{ background: CHART_BG }} />}
        {tip && <TipPanel tip={tip} w={box.current?.clientWidth ?? 0} h={box.current?.clientHeight ?? 0} />}
        {why ? (
          <div className="absolute inset-0 z-[1]">
            <EmptyState icon="chart" loading={!why[2] && /^Waiting/.test(why[0])} title={why[0]} hint={why[1]}
              action={why[2] ? { label: fomo || tv ? "Use Blix's candles" : "Show 1m", onClick: () => (fomo || tv ? setSrc("blix") : setTf(60)) } : null} />
          </div>
        ) : !gecko && !shown ? (
          <div className="absolute inset-0 z-[1] bg-paper/60 backdrop-blur-[1px]">
            <EmptyState loading title="Loading chart…" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

const rank = (k: IconKind) => (k === "whale" ? -1 : k === "sniper" || k === "bundle" ? 0 : k === "dev" ? 1 : k === "tracked" ? 2 : k === "person" ? 3 : k === "migrate" ? 5 : 4);
// A followed wallet's badge: its label's first letter (two for two words), or a dot when it has no label.
function initials(label?: string | null) {
  const w = (label || "").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return !w.length ? "•" : w.length > 1 ? (w[0][0] + w[1][0]).toUpperCase() : w[0][0].toUpperCase();
}

// The hover panel over a chart bubble: frosted glass with the person, what they did and when, the trade's size
// and market cap, or a thesis / callout in full with its likes. Kept inside the chart: centred on the bubble,
// under it, or over it near the bottom edge. Bubbles without a card (none today) keep the plain lines.
const TONE: Record<TipCard["tone"], string> = { up: "bg-up/15 text-up", down: "bg-down/15 text-down", info: "bg-[#5b6cf6]/20 text-[#8f9bff]", ink: "bg-white/10 text-ink-2" };
const when = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function TipPanel({ tip, w, h }: { tip: { x: number; y: number; r: number; lines: string[]; card?: TipCard }; w: number; h: number }) {
  const c = tip.card, W = c?.text ? 340 : 280;
  const left = w ? Math.min(Math.max(tip.x, W / 2 + 8), w - W / 2 - 8) : tip.x;
  const above = h > 0 && tip.y > h * 0.55;
  const style = { left, top: above ? tip.y - tip.r - 10 : tip.y + tip.r + 10, width: c ? W : undefined };
  const glass = "pointer-events-none absolute z-20 -translate-x-1/2 rounded-2xl border border-white/10 bg-[rgba(18,18,22,0.55)] shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl backdrop-saturate-150";
  if (!c) return (
    <div className={cn(glass, "whitespace-nowrap px-3 py-2 text-xs", above && "-translate-y-full")} style={style}>
      <div className="font-semibold text-ink">{tip.lines[0]}</div>
      {tip.lines.slice(1).map((l) => <div key={l} className="num text-muted">{l}</div>)}
    </div>
  );
  const trade = c.tag === "Buy" || c.tag === "Sell";
  return (
    <div className={cn(glass, "px-4 py-3.5", above && "-translate-y-full")} style={style}>
      <div className="flex items-center gap-2.5">
        {c.pic ? <img src={c.pic} alt="" className="size-7 shrink-0 rounded-full object-cover ring-1 ring-white/15" />
          : <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold", TONE[c.tone])}>{c.name.slice(0, 1).toUpperCase()}</span>}
        <b className="min-w-0 truncate text-md font-semibold text-ink">{c.name}</b>
        <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold", TONE[c.tone])}>{c.tag}</span>
        <span className="num ml-auto shrink-0 text-xs text-muted">{when(c.t)}</span>
      </div>
      {trade && (c.usd || c.sol) ? (
        <div className="mt-2.5 flex items-baseline gap-2">
          <span className={cn("num text-xl leading-none font-semibold", c.tone === "up" ? "text-up" : "text-down")}>{c.tone === "down" ? "−" : "+"}{c.usd ? `$${Math.round(c.usd).toLocaleString()}` : solN(c.sol!)}</span>
          {c.usd && c.sol ? <span className="num text-sm text-muted">{c.tone === "down" ? "−" : "+"}{solN(c.sol)}</span> : null}
          {(c.n ?? 1) > 1 && <span className="num text-sm text-muted">· {c.n} {c.tag === "Buy" ? "buys" : "sells"}</span>}
        </div>
      ) : null}
      {c.text && <p className="mt-2 text-md leading-snug break-words whitespace-pre-line text-ink">{c.text}</p>}
      {(c.mc || c.sub || c.likes != null) && (
        <div className="num mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {c.likes != null && (
            <span className="flex items-center gap-1 text-ink-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>{c.likes}
            </span>
          )}
          {c.mc ? <span>{(c.n ?? 1) > 1 ? "avg " : ""}{usdP(c.mc)} MC</span> : null}
          {c.sub && <span className="truncate">{c.sub}</span>}
        </div>
      )}
    </div>
  );
}
