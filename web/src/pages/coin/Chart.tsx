// The coin's candle chart: market cap in USD from real trades (/api/candles), drawn the way Axiom draws it
// and the same way as the classic page (public/trade.js, mountChart): fixed 9 px candles with the newest at
// the right, every interval present up to now (a quiet one is a flat candle at the last price), each candle
// opening at the previous close, volume as a faint band along the bottom, a price axis that always spans at
// least 12% of the price, and the time axis in this PC's time. Who traded where, as on Axiom: your own buys
// and sells (B / S arrows), the dev's (DB / DS badges), followed wallets (gold badges), snipers and bundles
// (small dots), alerts (muted squares) and DexScreener orders (DEX paid, ads, boosts: a dashed line with a
// pill). The icons are drawn by chartIcons.ts; hovering one says what it was. Your average buy and sell are
// dashed lines across it.
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, HistogramSeries, LineStyle, type AutoscaleInfo, type IPriceLine, type CandlestickData, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { solN, usdK } from "@/lib/coin";
import { cn, store } from "@/lib/utils";
import { ChartIcons, type Badge, type Flag, type IconKind } from "./chartIcons";

const TFS: [number, string][] = [[1, "1s"], [5, "5s"], [15, "15s"], [60, "1m"], [300, "5m"], [900, "15m"], [3600, "1h"]];
const label = (tf: number) => TFS.find(([v]) => v === tf)?.[1] || `${tf}s`;
const BAR = 9;             // candle width in pixels at rest: two candles look like two candles, not two walls
const FILL_MAX = 300;      // a longer silence starts the chart over after it (continuous)
const LEAD = 120;          // ...with this many flat candles before the first trade after it
const MIN_RANGE = 0.12;    // the price axis always spans at least 12% of the price
// A tagged trade (the dev, a sniper, a bundle wallet, a followed wallet) and a DexScreener order.
export interface Mark { t: number; buy: boolean; kind: IconKind; label?: string | null; sol?: number | null; mc?: number | null; usd?: number | null }
export interface ChartEvent { t: number; text: string; tone: "info" | "warn"; tip: string }
interface Row { time: number; open: number; high: number; low: number; close: number; value?: number }
interface Candles { tf?: number; rows: Row[]; first?: number | null; partial?: boolean; live?: boolean; source?: string; note?: string | null }

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
function continuous(rows: Row[], tf: number, nowSec = Date.now() / 1000): Row[] {
  let out: Row[] = [];
  const flat = (time: number, px: number): Row => ({ time, open: px, high: px, low: px, close: px, value: 0 });
  for (const x of rows) {
    const prev = out[out.length - 1];
    if (prev) {
      if (x.time <= prev.time) continue;
      const gap = Math.round((x.time - prev.time) / tf) - 1;
      if (gap > FILL_MAX) {
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
    if (gap > 0 && gap <= FILL_MAX) for (let i = 1; i <= gap; i++) out.push(flat(last.time + i * tf, last.close));
  }
  return out;
}

const sameRow = (a: Row | undefined, b: Row) => Boolean(a) && a!.open === b.open && a!.high === b.high && a!.low === b.low && a!.close === b.close && (a!.value || 0) === (b.value || 0);

// Candles already fetched, per coin and size, so a size draws at once: from its own last answer, or built from
// a finer size's (1s, 5s and 15s candles make up 1m ones, 1m make 5m...) while the server answers. A minute or
// more can wait seconds on GeckoTerminal's history, and the chart must not sit blank meanwhile.
const memo = new Map<string, { raw: Row[]; at: number }>();
const FRESH = 5 * 60_000;
function remember(key: string, raw: Row[]) {
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
function cached(mint: string, tf: number): Row[] | null {
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

export interface ChartPaper { t: number; exit_t?: number | null }
export interface ChartSignal { t: number }
// `migrate`: where a curve coin moves to its pool (pump.fun); drawn plain, kept in view from further away.
export interface Level { price: number; buy: boolean; title: string; migrate?: boolean }

export function CoinChart({ mint, marks, events, paper, signals, levels, defaultTf }: { mint: string; marks: Mark[]; events?: ChartEvent[]; paper?: ChartPaper[]; signals?: ChartSignal[]; levels?: Level[]; defaultTf: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [tf, setTfState] = useState<number>(() => store.get("coin:tf", 0) || defaultTf);
  const [hover, setHover] = useState<Row | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  // tf: the size these figures are for (until the new size's first candles are drawn, nothing is shown);
  // early: drawn from what was already here, the server's answer still to come.
  const [meta, setMeta] = useState<{ tf?: number; early?: boolean; source?: string; live?: boolean; note?: string | null; empty: boolean; last: Row | null }>({ empty: false, last: null });
  const lines = useRef<number[]>([]);      // the level prices, for the price axis to keep in view
  const migrateAt = useRef<number | null>(null);   // the migration market cap, kept in view from up to 4x away
  const s = useRef<{ chart?: IChartApi; candles?: ISeriesApi<"Candlestick">; markers?: ISeriesMarkersPluginApi<Time>; icons?: ChartIcons; byTime?: Map<number, Row>; first?: number; tf?: number }>({});
  const setTf = (v: number) => { store.set("coin:tf", v); setTfState(v); };

  // One chart per coin and candle size.
  useEffect(() => {
    if (!box.current) return;
    const ink = color("--color-ink", "#f2f4f7"), muted = color("--color-muted", "#8b93a1"), rule = color("--color-rule", "#232733"), paper4 = color("--color-paper-4", "#1c1f26");
    const up = color("--color-up", "#2ebd85"), down = color("--color-down", "#f6465d");
    const secs = tf < 60;
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: muted, fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', sans-serif", fontSize: 11, attributionLogo: false },
      // Quiet grid: faint level lines to read prices off, no vertical lines.
      grid: { vertLines: { visible: false }, horzLines: { color: alpha(rule, 0.55) } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.22 }, entireTextOnly: true },
      // The axis reads in this PC's time (the library's default is UTC, hours off from the trade list below it).
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: secs, rightOffset: 6, barSpacing: BAR, minBarSpacing: 1.5, shiftVisibleRangeOnNewBar: true,
        tickMarkFormatter: (t: Time) => new Date(Number(t) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: secs ? "2-digit" : undefined, hour12: false }) },
      crosshair: { mode: 0, vertLine: { color: alpha(ink, 0.25), width: 1, style: 3, labelBackgroundColor: paper4 }, horzLine: { color: alpha(ink, 0.25), width: 1, style: 3, labelBackgroundColor: paper4 } },
      localization: { priceFormatter: usdP, timeFormatter: (t: Time) => new Date(Number(t) * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: secs ? "2-digit" : undefined }) },
    });
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
        const mg = migrateAt.current;
        if (mg && mg > hi && mg < hi * 4) hi = mg;
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
      () => { const m = s.current.byTime; if (!m?.size || s.current.first == null) return null; let last = 0; for (const k of m.keys()) if (k > last) last = k; return [s.current.first, last]; });
    candles.attachPrimitive(icons);
    chart.subscribeCrosshairMove((p) => {
      const d = p?.seriesData?.get(candles) as CandlestickData<Time> | undefined;
      setHover(d ? s.current.byTime?.get(Number(d.time)) ?? null : null);
      const hit = p?.point ? icons.at(p.point.x, p.point.y) : null;
      setTip(hit ? { x: hit.x, y: hit.y, lines: hit.tip } : null);
    });
    s.current = { chart, candles, markers, icons, tf };

    let alive = true, timer = 0, first = true, framed = false, polls = 0;
    let raw: Row[] = [], rawFirst: number | null = null, src: string | undefined, firstTime: number | null = null, last: Row | null = null;
    const candle = ({ time, open, high, low, close }: Row) => ({ time: time as UTCTimestamp, open, high, low, close });
    const volume = (x: Row) => ({ time: x.time as UTCTimestamp, value: x.value || 0, color: alpha(x.close >= x.open ? up : down, 0.32) });
    // The first view: the newest 160 candles, or all of them at the resting width.
    // The first view shows the coin's whole history whenever its candles can stay at least 2 px wide, so
    // nothing (the launch, the DEX paid mark, the dev's first buy) starts off screen; a longer history shows
    // as many of the newest as fit at 2 px. A short one sits at the resting width.
    const frame = (n: number) => {
      framed = true;
      const width = (box.current?.clientWidth || 900) - 80, room = Math.max(60, Math.floor(width / 2));
      if (n * BAR <= width) { chart.timeScale().applyOptions({ barSpacing: BAR }); chart.timeScale().scrollToRealTime(); }
      else chart.timeScale().setVisibleLogicalRange({ from: Math.max(-1, n - room), to: n + 6 });
    };
    // Candles drawn before the server's answer: only the ones there are, no flat ones out to now until the
    // server says nothing happened since.
    const drawEarly = (from: Row[]) => {
      const rows = continuous(from, tf, from[from.length - 1].time);
      candles.setData(rows.map(candle)); vol.setData(rows.map(volume)); frame(rows.length);
      s.current.byTime = new Map(rows.map((x) => [x.time, x])); s.current.first = rows[0].time;
      setMeta({ tf, early: true, empty: false, last: rows[rows.length - 1] });
    };
    const key = `${mint}:${tf}`, early = cached(mint, tf);
    if (early?.length) drawEarly(early);
    else if (tf >= 60) {
      // Nothing here to build from: the 15s candles answer at once (the server's own trades, no
      // GeckoTerminal) and make up these until the full answer with the older history arrives.
      api<Candles>(`candles/${mint}?tf=15`).then((d) => {
        const got = d.rows.filter((x) => x.open > 0 && x.close > 0);
        if (!got.length) return;
        remember(`${mint}:15`, got);
        if (alive && first && !framed) drawEarly(bucket(got, tf));
      }).catch(() => { /* the full answer is on its way anyway */ });
    }
    const load = async (whole: boolean): Promise<void> => {
      // The fast refresh asks only for the candles from the last real one on (a few rows); every 20th pass
      // re-reads it all. A server without `since` answers in full, which is handled the same way.
      const since = !first && !whole && raw.length ? raw[raw.length - 1].time : null;
      const d = await api<Candles>(`candles/${mint}?tf=${tf}${since ? `&since=${since}` : ""}`);
      if (!alive) return;
      const got = d.rows.filter((x) => x.open > 0 && x.close > 0);
      if (d.partial && since != null && d.source === src && d.first === rawFirst) raw = [...raw.filter((x) => x.time < since), ...got];
      else if (d.partial) return load(true);
      else { raw = got; rawFirst = d.first ?? got[0]?.time ?? null; }
      const rows = continuous(raw, d.tf || tf);
      // Only the newest candles change between polls. Anything else redraws it all (setData keeps the view):
      // a new source, an earlier start, or a late trade landing in an interval already drawn (flat), which
      // series.update() cannot reach because it only takes the newest candle.
      const drawn = s.current.byTime, lastT = last?.time ?? Infinity;
      const late = Boolean(drawn) && rows.some((x) => x.time < lastT && x.time >= (since ?? -Infinity) && !sameRow(drawn!.get(x.time), x));
      if (first || !last || rows.length < 2 || d.source !== src || rows[0].time !== firstTime || late) {
        candles.setData(rows.map(candle));
        vol.setData(rows.map(volume));
        // The first full answer frames the chart again: the quick early draw had only the newest trades, and
        // the older history arriving now would otherwise start off screen to the left.
        if ((first || !framed) && rows.length) frame(rows.length);
      } else {
        for (const x of rows) if (x.time >= last.time) { candles.update(candle(x)); vol.update(volume(x)); }
      }
      s.current.byTime = new Map(rows.map((x) => [x.time, x]));
      s.current.first = rows[0]?.time;
      firstTime = rows[0]?.time ?? null;
      last = rows[rows.length - 1] ?? null;
      src = d.source;
      remember(key, raw);
      setMeta({ tf, source: d.source, live: d.live, note: d.note, empty: !rows.length, last });
      first = false;
    };
    const tick = async () => {
      if (!document.hidden) {
        try { await load(++polls % 20 === 0); }
        catch (e) { if (alive && first && !framed) setMeta({ tf, note: (e as Error).message, empty: true, last: null }); }
      }
      if (alive) timer = window.setTimeout(tick, tf <= 5 ? 400 : tf <= 15 ? 800 : 2000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); chart.remove(); s.current = {}; setHover(null); setTip(null); };
  }, [mint, tf]);

  // Your average buy and sell: dashed lines across the chart with their market cap on the price axis.
  const live = (levels || []).filter((l) => l.price > 0 && isFinite(l.price));
  const migrate = live.find((l) => l.migrate)?.price ?? null;
  const levelKey = live.map((l) => `${l.buy ? "b" : "s"}${l.price.toPrecision(6)}${l.title}`).join("|");
  useEffect(() => {
    const { candles } = s.current;
    lines.current = live.filter((l) => !l.migrate).map((l) => l.price);
    migrateAt.current = live.find((l) => l.migrate)?.price ?? null;
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
    const up = color("--color-up", "#2ebd85"), down = color("--color-down", "#f6465d"), muted = color("--color-muted", "#8b93a1");
    const snap = (ms: number) => Math.floor(ms / 1000 / ctf) * ctf;
    const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    const own = new Map<string, { time: number; buy: boolean; n: number }>();
    const addOwn = (ms: number, buy: boolean) => {
      const time = snap(ms), k = `${time}|${buy ? 1 : 0}`;
      const g = own.get(k) || { time, buy, n: 0 };
      g.n++; own.set(k, g);
    };
    // A partial sell splits a paper row and the parts keep the buy's time: each buy is marked once.
    const buys = new Set<number>();
    for (const p of paper || []) { if (!buys.has(p.t)) { buys.add(p.t); addOwn(p.t, true); } if (p.exit_t) addOwn(p.exit_t, false); }
    const list: SeriesMarker<Time>[] = [...own.values()].map((g) => ({ time: g.time as UTCTimestamp, position: g.buy ? "belowBar" : "aboveBar", color: g.buy ? up : down,
      shape: g.buy ? "arrowUp" : "arrowDown", size: 1, text: `${g.buy ? "B" : "S"}${g.n > 1 ? ` ×${g.n}` : ""}` }));
    for (const sg of (signals || []).slice(0, 40)) list.push({ time: snap(sg.t) as UTCTimestamp, position: "aboveBar", color: muted, shape: "square", size: 0.5, text: "" });
    markers.setMarkers(list.filter((x) => (x.time as number) >= (first ?? Infinity)).sort((a, b) => (a.time as number) - (b.time as number)));

    const WHO: Record<IconKind, string> = { dev: "Dev", tracked: "", sniper: "Sniper", bundle: "Bundle wallet", whale: "Big trade:" };
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
        tip: [`${g.who} ${g.buy ? "bought" : "sold"}${g.n > 1 ? ` ${g.n}×` : ""}${g.usd ? ` · $${Math.round(g.usd).toLocaleString()}` : ""}${g.sol ? ` · ${solN(g.sol)}` : ""}`,
          `${mc ? `${g.n > 1 ? "avg MC" : "MC"} ${usdP(mc)} · ` : ""}${clock(g.t0)}${g.t1 - g.t0 > 1000 ? ` – ${clock(g.t1)}` : ""}`] };
    })
      // Dots under badges, followed wallets on top of everything.
      .sort((x, y) => rank(x.kind) - rank(y.kind));
    const flags: Flag[] = (events || []).map((e) => ({ time: snap(e.t), text: e.text, tone: e.tone, tip: [e.tip, clock(e.t)], icon: "dex" as const }));
    // Big-trade bubbles: only the 40 largest on the chart, so the candles stay readable under them.
    const shown = badges.filter((x) => x.time >= (first ?? Infinity));
    const keep = new Set(shown.filter((x) => x.kind === "whale").sort((x, y) => (y.usd || 0) - (x.usd || 0)).slice(0, 40));
    icons.set(shown.filter((x) => x.kind !== "whale" || keep.has(x)), flags);
  }, [marks, events, paper, signals, tf, meta.empty, meta.source]);

  // The line above the chart: the candle under the pointer, or the newest one (of this size only).
  const shown = meta.tf === tf;
  const c = hover || (shown ? meta.last : null);
  const chg = c && c.open > 0 ? (c.close / c.open - 1) * 100 : 0;
  // Nothing to draw: said in the middle of the chart, where it is seen (on a phone the space under the chart
  // is off screen). The chart keeps asking every few seconds, so it fills in by itself.
  const why: [string, string, boolean] | null = !shown || !meta.empty ? null
    : meta.note && /GeckoTerminal/i.test(meta.note) ? ["Waiting for the price history", "This coin's candles come from GeckoTerminal, which is busy right now. Blix asks again every few seconds.", false]
    : meta.note ? ["Couldn't load the candles", `${meta.note.replace(/\.$/, "")}. Trying again every few seconds.`, false]
    : tf < 60 ? ["No live trades yet", "Second candles are built from the trades Blix sees live. 1m and longer show the coin's whole history.", true]
    : ["No candles yet", "No trades in this window yet. Candles appear with the first trade Blix sees.", false];
  return (
    <div className="flex flex-col gap-1.5 p-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Candle size" className="inline-flex overflow-hidden rounded-control border border-rule">
          {TFS.map(([v, l]) => (
            <button key={v} role="radio" aria-checked={tf === v} onClick={() => setTf(v)}
              className={cn("h-6 border-r border-rule px-2.5 text-xs font-semibold last:border-r-0", tf === v ? "bg-accent/20 text-ink" : "text-muted hover:text-ink")}>{l}</button>
          ))}
        </div>
        {c && (
          <span className="num text-xs text-muted">
            MC <b className="mr-1 font-semibold text-ink">{usdP(c.close)}</b><b className={cn("mr-2 font-semibold", c.close >= c.open ? "text-up" : "text-down")}>{pctF(chg)}</b>
            O <span className="mr-1.5 text-ink-2">{usdP(c.open)}</span>H <span className="mr-1.5 text-ink-2">{usdP(c.high)}</span>L <span className="mr-1.5 text-ink-2">{usdP(c.low)}</span>Vol <span className="text-ink-2">{usdK(c.value || 0)}</span>
          </span>
        )}
        {migrate && (
          <span className="num flex items-center gap-1.5 rounded-full border border-rule px-2 py-0.5 text-xs text-muted" title="pump.fun moves the coin to its own pool at this market cap">
            Migrates at <b className="font-semibold text-ink">{usdP(migrate)}</b>
            {c && c.close > 0 && c.close < migrate && <span className="text-ink-2">+{Math.round((migrate / c.close - 1) * 100)}%</span>}
          </span>
        )}
        <span className="ml-auto text-xs text-muted">{!shown || meta.early ? <span className="animate-pulse">loading {label(tf)} candles…</span> : <>{meta.live ? "● " : ""}{meta.source || ""}</>}</span>
      </div>
      <div className="relative">
        <div ref={box} data-coin-chart className="h-[clamp(340px,52vh,760px)] w-full" />
        {tip && (
          <div className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-control border border-rule-2 bg-paper-3/95 px-2 py-1 text-xs shadow-lg"
            style={{ left: tip.x, top: tip.y + 14 }}>
            <div className="font-semibold text-ink">{tip.lines[0]}</div>
            {tip.lines.slice(1).map((l) => <div key={l} className="num text-muted">{l}</div>)}
          </div>
        )}
        {!shown && <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted"><span className="animate-pulse">Loading {label(tf)} candles…</span></div>}
        {why && (
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="flex max-w-sm flex-col items-center gap-1.5 text-center">
              <b className="flex items-center gap-2 text-md font-semibold text-ink-2"><i className="size-1.5 animate-pulse rounded-full bg-muted" />{why[0]}</b>
              <span className="text-sm text-muted">{why[1]}</span>
              {why[2] && <button onClick={() => setTf(60)} className="mt-1.5 h-7 rounded-control border border-rule-2 px-3 text-sm font-semibold text-ink-2 hover:text-ink">Show 1m</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const rank = (k: IconKind) => (k === "whale" ? -1 : k === "sniper" || k === "bundle" ? 0 : k === "dev" ? 1 : 2);
// A followed wallet's badge: its label's first letter (two for two words), or a dot when it has no label.
function initials(label?: string | null) {
  const w = (label || "").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return !w.length ? "•" : w.length > 1 ? (w[0][0] + w[1][0]).toUpperCase() : w[0][0].toUpperCase();
}
