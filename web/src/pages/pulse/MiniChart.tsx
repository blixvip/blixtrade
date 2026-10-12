// The live candle chart inside the Pulse chart card (ChartHover.tsx): the coin's real chart in miniature, on the
// same data and at the same rate.
// It opens on the coin's whole chart in 1-minute candles (OVERVIEW_TF) for a second, zooms into its newest five
// minutes (time window and price range gliding together), each minute candle becomes its twelve 5-second candles in
// the same pixels, and the view settles into the live 5-second chart (LIVE_TF): the newest candles at the resting width,
// moved by every trade the moment the radar hears it (the main stream carries a coin's trades while its candles
// are being asked for) and brought up to date by the same polls as the full chart (/api/candles with `since`,
// 300 ms on 5 s candles, 1.5 s while the stream is moving it). Drawn for a glance, not for work: no axes, grid or
// crosshair. Candles over a soft area of their closes in the move's colour, a dotted line at the last price with
// its figure in a pill at the right edge (it glides with the price), the high and low on screen as small tags, and
// faint volume along the bottom. Loaded as its own chunk (lightweight-charts) the first time a Pulse row is hovered.
import { AreaSeries, CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart, type AutoscaleInfo, type IPriceLine, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { validBar, validTrade, normalizeBars, continuousBars } from "../../../../server/chart-data.js";
import { api } from "@/lib/api";
import { usdP } from "@/lib/coin";
import { onCoinTrade, usePulse } from "@/lib/pulse";
import { cn } from "@/lib/utils";
import { CHART_BG, LIVE_TF, OVERVIEW_TF, primeCandles, windowSince, type Candles, type Row } from "./hoverChart";

export interface MiniState { last: Row | null; first: Row | null; empty: boolean; note?: string | null; liveAt: number; tf: number }
// What the overlays need: where the last price sits, and the drawn high and low.
interface Marks { y: number; close: number; hi: number; lo: number; up: boolean }

const BAR = 6;              // candle width at rest: 45 or so candles across the card, each still a candle
const MAX_BAR = 40;         // never wider: a coin a few minutes old shows a few readable candles, not three slabs
const PILL_PX = 84;         // room kept at the right edge for the last-price pill, so it never covers the newest candles
const INTRO_MS = 500, ZOOM_MS = 620, LAND_MS = 540;   // the overview is held (the user: "half a second"); the zoom into its newest minutes; the settle into the live view
const FADE_MS = 240;        // the crossfade at the hand-off: the zoom's last frame dissolving into the 5 s candles in the same pixels
const SLIDE_MS = 260;       // every later change of view (a new candle, a redraw) glides this long; nothing snaps (the user: "not cutty")
const FILL_MAX = 30_000;    // as the real chart: a silence this long (in candles) is drawn flat, past it the chart starts over
const MIN_RANGE = 0.03;     // the price axis spans at least 3% of the price, so a 1% move looks like 1%
const START_SOL = 27.96;    // pump.fun's opening market cap in SOL: a pump coin's chart starts there, flat until its first trade
const backoff = (fails: number) => Math.min(10_000, 1000 * 2 ** (fails - 1));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

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
// Live trades arrive rounded (8 digits of market cap, cents of volume): within that, the same candle.
const near = (x: number, y: number) => Math.abs(x - y) <= Math.abs(y) * 1e-6;
const sameRow = (a: Row | undefined, b: Row) => Boolean(a) && near(a!.open, b.open) && near(a!.high, b.high) && near(a!.low, b.low) && near(a!.close, b.close) && Math.abs((a!.value || 0) - (b.value || 0)) < 0.05;
// Only traded intervals are drawn, back to back (continuousBars, exactly as the full chart): a coin that trades a
// few times a minute is a dense chart at 5 s, not a few candles in a field of empty slots. (An earlier version gave
// every quiet 5 s slot an empty bar so the hand-off could be pixel-exact per minute; the user, 2026-10-11: "some
// coins are showing inconsistent charts".) The hand-off aligns the span of the zoomed minutes instead (frame).

export function MiniChart({ mint, born, onState }: { mint: string; born?: number | null; onState: (s: MiniState) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const snap = useRef<HTMLCanvasElement>(null);   // the crossfade's top layer at the hand-off (snapshot, below)
  const tell = useRef(onState);
  tell.current = onState;
  const [marks, setMarks] = useState<Marks | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setMarks(null);
    const ink = color("--color-ink", "#f2f4f7");
    const up = color("--color-up", "#2ebd85"), down = color("--color-down", "#f6465d");
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: ink, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false, scaleMargins: { top: 0.2, bottom: 0.2 } },
      leftPriceScale: { visible: false },
      // A new candle never shifts the view by itself (that is a one-frame jump): put() glides there (SLIDE_MS).
      timeScale: { visible: false, rightOffset: 2, barSpacing: BAR, minBarSpacing: 0.5, maxBarSpacing: MAX_BAR, shiftVisibleRangeOnNewBar: false },
      crosshair: { mode: CrosshairMode.Hidden },
      handleScroll: false, handleScale: false,
      localization: { priceFormatter: usdP },
    });
    // The price range is normally the library's own (the candles on screen), never narrower than MIN_RANGE. During
    // the opening it is pinned and moved by hand (`pin`), so the axis glides with the time window instead of
    // snapping at every step and at the change of candle size; the pin is let go on a range the library would
    // compute itself, so nothing moves when it is.
    type Span = { min: number; max: number };
    let pin: Span | null = null;
    const atLeast = (lo: number, hi: number): Span => { const mid = (lo + hi) / 2, need = mid * MIN_RANGE; return hi - lo >= need ? { min: lo, max: hi } : { min: Math.max(0, mid - need / 2), max: mid + need / 2 }; };
    const autoscale = (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
      if (pin) return { priceRange: { minValue: pin.min, maxValue: pin.max } };
      const o = original();
      if (!o?.priceRange) return o;
      const r = atLeast(o.priceRange.minValue, o.priceRange.maxValue);
      return { ...o, priceRange: { minValue: r.min, maxValue: r.max } };
    };
    // The soft area under the closes, in the move's colour; the candles sit on top of it.
    const area = chart.addSeries(AreaSeries, { lineVisible: false, lineWidth: 1, topColor: alpha(up, 0.22), bottomColor: alpha(up, 0), priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: autoscale });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderVisible: false, wickUpColor: alpha(up, 0.8), wickDownColor: alpha(down, 0.8),
      priceFormat: { type: "custom", formatter: usdP, minMove: 1e-9 },
      priceLineVisible: false, lastValueVisible: false,
      autoscaleInfoProvider: autoscale,
    });
    // Both series share the candles' scale, so the area sits exactly under them.
    area.applyOptions({ priceScaleId: "right" }); candles.applyOptions({ priceScaleId: "right" });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.88, bottom: 0 }, visible: false });
    // The last price: a dotted line across the chart (its figure is the pill drawn over the chart, below).
    let priceLine: IPriceLine | null = null;

    let alive = true, timer = 0, polls = 0, fails = 0, streamT = 0, catchUp = false, first = true, framed = false;
    let tf = OVERVIEW_TF;   // what is drawn now: the overview, then the live size
    let raw: Row[] = [], rawFirst: number | null = null, src: string | undefined, firstTime: number | null = null, firstRow: Row | null = null, last: Row | null = null, rev: number | null = null;
    let byTime: Map<number, Row> | null = null, top = -Infinity, n = 0, volCap = Infinity, liveAt = 0, wasUp: boolean | null = null, drawnRows: Row[] = [];
    const candle = (x: Row) => (x.fill || !validBar(x) ? { time: x.time as UTCTimestamp } : { time: x.time as UTCTimestamp, open: x.open, high: x.high, low: x.low, close: x.close });
    const point = (x: Row) => (Number.isFinite(x.close) ? { time: x.time as UTCTimestamp, value: x.close } : { time: x.time as UTCTimestamp });
    const capFrom = (rows: Row[]) => { const v = rows.map((x) => x.value || 0).filter((k) => k > 0).sort((a, b) => a - b); volCap = v.length >= 10 ? v[Math.floor(v.length * 0.9)] * 4 : Infinity; };
    const volume = (x: Row) => (x.fill ? { time: x.time as UTCTimestamp } : { time: x.time as UTCTimestamp, value: Math.min(Number.isFinite(x.value) && x.value! >= 0 ? x.value! : 0, volCap), color: alpha(x.close >= x.open ? up : down, 0.22) });
    // Views keep the newest candle PILL_PX clear of the right edge, where the last-price pill sits over the chart.
    const width = () => Math.max(120, el.clientWidth);
    // The whole set from `from`, the last candle (index lastIdx) landing PILL_PX in from the right edge.
    const wholeRange = (lastIdx: number, from = -1) => ({ from, to: from + (lastIdx + 0.5 - from) * (width() / (width() - PILL_PX)) });
    // The live view: a short history spread across the card, a long one its newest candles at the resting width.
    const liveRange = (count: number) => {
      const span = width() / BAR;
      if (count + 1 + PILL_PX / BAR <= span) return wholeRange(count - 1);
      const to = count - 0.5 + PILL_PX / BAR;
      return { from: to - span, to };
    };
    let zoomRaf = 0;   // the zoom under way (the view is its own until it lands)
    let hold = 0;      // the hand-off's hold while the crossfade runs (the view stays put until it is done)
    const busy = () => zoomRaf !== 0 || hold !== 0;
    let zoomed = false;   // the zoom has begun (the overview is no longer brought up to date in place)
    let lifeFirst: Row | null = null;   // the overview's first candle: the move's reference for the whole card
    // The high and low of candles a..b of `rows` (the price range they need, never narrower than MIN_RANGE).
    const spanOf = (rows: Row[], a: number, b: number): Span | null => {
      let h = -Infinity, l = Infinity;
      for (let i = Math.max(0, Math.floor(a)); i <= Math.min(rows.length - 1, Math.ceil(b)); i++) { const x = rows[i]; if (x && validBar(x)) { h = Math.max(h, x.high); l = Math.min(l, x.low); } }
      return Number.isFinite(h) && Number.isFinite(l) ? atLeast(l, h) : null;
    };
    // An eased move of the view from one logical range to another over `ms`, the pinned price range moving with it
    // from `pinA` to `pinB()` (read every step: the target may grow as candles arrive). `release`: let the pin go at
    // the end, on the range the library computes itself.
    type Range = { from: number; to: number };
    const animateRange = (a: Range, b: () => Range, ms: number, pinA: Span | null, pinB: () => Span | null, release: boolean, done?: () => void) => {
      cancelAnimationFrame(zoomRaf);
      const t0 = performance.now();
      const step = () => {
        zoomRaf = 0;
        if (!alive) return;
        const k = easeInOut(Math.min(1, (performance.now() - t0) / ms)), end = b(), pb = pinB();
        if (pinA && pb) pin = { min: pinA.min + (pb.min - pinA.min) * k, max: pinA.max + (pb.max - pinA.max) * k };
        if (k >= 1 && release) pin = null;
        chart.timeScale().setVisibleLogicalRange({ from: a.from + (end.from - a.from) * k, to: a.to + (end.to - a.to) * k });
        report();
        if (k < 1) zoomRaf = requestAnimationFrame(step); else done?.();
      };
      zoomRaf = requestAnimationFrame(step);
    };
    // The hand-off from the overview to the live candles: the zoom ends on `range` of the minute candles (`rows`);
    // the first live draw puts the same window on the 5 s candles, each minute candle's pixels given to the 5 s candles
    // inside that minute, the price range still pinned where it was. Only traded intervals are drawn (continuousBars,
    // as on the full chart), so a minute is not twelve 5 s bars: the 5 s bars from the first zoomed minute on are
    // spread over the same pixels those minutes took, first bar where the first minute was, last where the last was
    // (the crossfade dissolves one picture into the other). Then the view settles into the live view, pin let go.
    // tFirst: the first zoomed minute's time; xFirst / xLast: where that minute and the newest one sit on screen at
    // the end of the zoom (read off the library's own layout, which clamps bar spacing to MAX_BAR whatever was asked).
    let handoff: { tFirst: number; xFirst: number; xLast: number } | null = null;
    // The first index in `rows` whose time is at or after `t`.
    const lowerBound = (rows: Row[], t: number) => { let lo = 0, hi = rows.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].time < t) lo = mid + 1; else hi = mid; } return lo; };
    // The zoom's last frame, copied over the chart for the crossfade at the hand-off (the canvas in the JSX below).
    const snapshot = () => {
      const s = snap.current;
      if (!s) return false;
      // The pane's canvases, in DOM order (the library draws the chart on one and the crosshair layer on another of
      // the same size, both needed, in order: the one on top is transparent and alone would cover nothing).
      const all = [...el.querySelectorAll("canvas")].filter((c) => c.width > 10);
      const big = Math.max(0, ...all.map((c) => c.width * c.height)), cs = all.filter((c) => c.width * c.height === big);
      const c = cs[0];
      if (!c) return false;
      const r = c.getBoundingClientRect(), w = el.getBoundingClientRect(), x = s.getContext("2d");
      if (!x) return false;
      s.width = c.width; s.height = c.height;
      s.style.left = `${r.left - w.left}px`; s.style.top = `${r.top - w.top}px`; s.style.width = `${r.width}px`; s.style.height = `${r.height}px`;
      // Opaque: the box's own ground first, then the chart. A transparent copy over the identical chart doubled the
      // translucent parts (the area fill, anti-aliased edges) for a frame, a visible pulse at the hand-off.
      const g = x.createLinearGradient(0, 0, 0, s.height);
      g.addColorStop(0, CHART_BG[0]); g.addColorStop(1, CHART_BG[1]);
      x.fillStyle = g; x.fillRect(0, 0, s.width, s.height);
      for (const k of cs) x.drawImage(k, 0, 0);
      s.style.opacity = "1";
      return true;
    };
    const frame = (count: number) => {
      const was = framed;
      framed = true;
      el.dataset.frame = `${tf}:${count}:${handoff ? "land" : hold ? "hold" : zoomRaf ? "zooming" : "plain"}`;
      if (busy()) return;
      if (tf === LIVE_TF && handoff && drawnRows.length) {
        const { tFirst, xFirst, xLast } = handoff;
        handoff = null;
        // The 5 s bars from the first zoomed minute on, spread over the pixels those minutes took: the first of them
        // where the first minute sat, the newest where the newest minute sat; the bars between at the density the
        // coin really traded at. (Fewer than two such bars, or a width the library will not draw: the resting width.)
        const W = chart.timeScale().width() || width();
        const a0 = Math.min(drawnRows.length - 1, lowerBound(drawnRows, tFirst)), k = drawnRows.length - 1 - a0;
        let px5 = k >= 1 ? (xLast - xFirst) / k : BAR;
        if (!(px5 >= 0.5 && px5 <= MAX_BAR)) px5 = BAR;
        const same = { from: a0 - xFirst / px5, to: a0 - xFirst / px5 + W / px5 };
        chart.timeScale().setVisibleLogicalRange(same);
        // The crossfade: the zoom's last frame (snapshot, taken a frame before the hand-off) dissolves into the 5 s
        // candles beneath, which hold the same pixels for FADE_MS; then the view settles into the live view. A single
        // frame of minute candles becoming 5 s candles read as a cut (the user, 2026-10-11: "not cutty").
        const s = snap.current;
        if (s && s.style.opacity === "1") { const a = s.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: "ease-in-out", fill: "forwards" }); a.onfinish = () => { s.style.opacity = "0"; a.cancel(); }; }
        clearTimeout(hold);
        hold = window.setTimeout(() => {
          hold = 0;
          if (!alive) return;
          el.dataset.frame = `${tf}:${n}:land`;
          animateRange(chart.timeScale().getVisibleLogicalRange() ?? same, () => liveRange(n), LAND_MS, pin, () => { const r = liveRange(n); return spanOf(drawnRows, r.from, r.to); }, true);
        }, FADE_MS);
        el.dataset.frame = `${tf}:${count}:hold`;
        return;
      }
      // The view for what is drawn: the whole overview, or the live view. Set outright on the first frame; once on
      // screen it glides there (a new candle's room, a redraw's shift, the minute fallback zooming back out), and when
      // it is already there nothing moves at all.
      const target = () => (tf === OVERVIEW_TF ? wholeRange(n - 1) : liveRange(n));
      const cur = chart.timeScale().getVisibleLogicalRange(), r = target();
      if (!was || !cur || (Math.abs(cur.from - r.from) < 0.02 && Math.abs(cur.to - r.to) < 0.02)) { chart.timeScale().setVisibleLogicalRange(r); return; }
      animateRange(cur, target, pin ? LAND_MS : SLIDE_MS, pin, () => { const q = target(); return spanOf(drawnRows, q.from, q.to); }, true);
    };
    // The high and low of the candles on screen (not of the whole history: a launch spike would hide the live range).
    const visibleHiLo = () => {
      const r = chart.timeScale().getVisibleLogicalRange();
      let h = -Infinity, l = Infinity;
      const a = r ? Math.max(0, Math.floor(r.from)) : 0, b = r ? Math.min(drawnRows.length - 1, Math.ceil(r.to)) : drawnRows.length - 1;
      for (let i = a; i <= b; i++) { const x = drawnRows[i]; if (x && validBar(x)) { h = Math.max(h, x.high); l = Math.min(l, x.low); } }
      return [h, l] as const;
    };
    // What the chart holds, readable from outside (the same fields the real chart exposes for probes).
    const note = (x: Row | null, more: Record<string, string> = {}) => { Object.assign(el.dataset, { last: String(x?.time ?? ""), close: String(x?.close ?? ""), n: String(n), polls: String(polls), tf: String(tf), ...more }); };
    const put = (x: Row) => {
      if (!alive || !validBar(x) || x.time < top) return;
      const added = x.time > top;
      top = x.time;
      candles.update(candle(x)); area.update(point(x)); vol.update(volume(x));
      // A new candle: the view glides to make room for it (at the resting width one bar's worth, on a young coin's
      // spread-out chart a little tighter), never a one-frame shift.
      if (added) { n++; drawnRows.push(x); if (framed && !busy() && tf === LIVE_TF) { const r = chart.timeScale().getVisibleLogicalRange(); if (r) animateRange(r, () => liveRange(n), SLIDE_MS, null, () => null, false); } }
      else if (drawnRows.length) drawnRows[drawnRows.length - 1] = x;
    };
    const draw = (rows: Row[]) => {
      if (!alive) return;
      rows = normalizeBars(rows);
      candles.setData(rows.map(candle)); area.setData(rows.map(point)); capFrom(rows); vol.setData(rows.map(volume));
      top = rows.length ? rows[rows.length - 1].time : -Infinity;
      n = rows.length;
      drawnRows = rows;
      el.dataset.first = String(rows[0]?.time ?? "");   // for probes: where the drawn rows begin
    };
    // The figures over the chart follow at most once a frame: the card's header (React) at most four times a second,
    // the first answer at once; the overlays here (the last price's pill at its height, the high and low, the area's
    // colour when the move changes sign) every frame.
    let raf = 0, toldAt = 0, tellTimer = 0;
    const tellNow = (noteText?: string | null) => { toldAt = performance.now(); tell.current({ last, first: firstRow, empty: !last, note: noteText, liveAt, tf }); };
    const report = (noteText?: string | null) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!alive) return;
        if (!last || performance.now() - toldAt > 250) { clearTimeout(tellTimer); tellTimer = 0; tellNow(noteText); }
        else if (!tellTimer) tellTimer = window.setTimeout(() => { tellTimer = 0; if (alive) tellNow(noteText); }, 250);
        if (!last) return;
        const isUp = !firstRow || last.close >= firstRow.open;
        if (isUp !== wasUp) { wasUp = isUp; const c = isUp ? up : down; area.applyOptions({ topColor: alpha(c, 0.22), bottomColor: alpha(c, 0) }); }
        if (!priceLine) priceLine = candles.createPriceLine({ price: last.close, color: alpha(ink, 0.35), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
        else priceLine.applyOptions({ price: last.close });
        const y = candles.priceToCoordinate(last.close), [hi, lo] = visibleHiLo();
        const vr = chart.timeScale().getVisibleLogicalRange();   // for probes: the view, as asked for
        if (vr) el.dataset.range = `${vr.from.toFixed(2)},${vr.to.toFixed(2)}`;
        if (y != null && Number.isFinite(hi) && Number.isFinite(lo)) setMarks({ y, close: last.close, hi, lo, up: isUp });
      });
    };
    // A pump coin's chart begins at launch, at the opening cap, flat until its first trade: only when the history
    // really starts at the launch (its first candle within a minute of it), as the real chart does.
    const anchored = (rows: Row[], size: number): Row[] => {
      if (!born || !(born > 0) || !/pump$/.test(mint) || !rows.length) return rows;
      const sol = usePulse.getState().live?.solUsd;
      if (!(sol && sol > 0)) return rows;
      const t0 = Math.floor(born / 1000 / size) * size, px = START_SOL * sol;
      if (rows[0].time <= t0 + size || rows[0].time - born / 1000 > 60) return rows;
      return [{ time: t0, open: px, high: px, low: px, close: px, value: 0 }, ...rows];
    };
    // Takes an answer as what is drawn: the whole set (a base read) or the newest candles merged in (a refresh).
    const take = (d: Candles, got: Row[], since: number | null, base: boolean) => {
      // A refresh belongs to the history drawn (same source, same first candle), or the answer starts the chart over.
      // The first refresh after a warm base (hoverChart.ts: the same store's candles, read ahead) always belongs: it is
      // where the chart learns the history's source and first candle.
      // A refresh from another source or history (load() asks for the whole window again then, at most once in 10 s)
      // is otherwise merged like any other: it is never taken as the whole chart (the chart collapsed to the refresh's
      // one candle when a quiet coin's source changed, 2026-10-11).
      if (base) { raw = got; rawFirst = d.first ?? got[0]?.time ?? null; }
      else { raw = [...raw.filter((x) => x.time < since!), ...got]; if (fromWarm || d.first !== rawFirst) { rawFirst = d.first ?? rawFirst; fromWarm = false; } }
      const rows = continuousBars(anchored(raw, tf), tf, FILL_MAX) as Row[];
      const lastT = last?.time ?? Infinity;
      const late = Boolean(byTime) && !base && rows.some((x) => x.time < lastT && x.time >= (since ?? -Infinity) && !sameRow(byTime!.get(x.time), x));
      const redraw = base || !last || rows.length < 2 || d.source !== src || rows[0].time !== firstTime || late;
      if (redraw) { draw(rows); if (rows.length) frame(rows.length); }
      else for (const x of rows) if (x.time >= last!.time) put(x);
      const ahead = !redraw && last && rows.length && last.time > rows[rows.length - 1].time ? last : null;
      byTime = new Map(rows.map((x) => [x.time, x]));
      if (ahead) byTime.set(ahead.time, ahead);
      // The move's reference (the header's %, the area's colour) stays the coin's whole-life open once the overview
      // has shown it: the 5 s window's first candle is no reference, and switching to it flipped the colour at the
      // hand-off (a whole-canvas cut).
      firstTime = rows[0]?.time ?? null; firstRow = lifeFirst ?? rows[0] ?? null;
      last = ahead ?? rows[rows.length - 1] ?? null;
      src = d.source;
      note(last, { src: d.source || "" });
      report(d.note);
    };
    const primed = primeCandles(mint);
    let fromWarm = false;   // the live chart's base is the warm candles: its first refresh adopts the history (take)
    let rebasedAt = 0;      // when the whole window was last read again over a change of source (load)
    // ---- the live 5 s chart: the first draw from what was primed (the windowed read if it has answered by the
    // hand-off, else the warm candles at once, else that read awaited), then refreshes from 30 s before the last real
    // candle on. Only the 5 s size has primed candles; the minute fallback (below) reads its own window.
    const load = async (whole: boolean): Promise<void> => {
      const base = first || whole || !raw.length;
      const since = base ? windowSince(tf) : raw[raw.length - 1].time - Math.ceil(30 / tf) * tf;
      let d: Candles, kept = false;
      if (first && tf === LIVE_TF) {
        kept = true;
        if (primed.liveGot) d = primed.liveGot;
        else if (primed.liveNow) { d = primed.liveNow; fromWarm = true; }
        else d = (await primed.live).data;
      } else d = await api<Candles>(`candles/${mint}?tf=${tf}&since=${since}`);
      catchUp = kept;
      if (!alive) return;
      const got = normalizeBars(d.rows) as Row[];
      if (!got.length && last) { catchUp = false; return; }
      // No 5 s candles to speak of (a coin the radar only has minute candles for): the minute candles stay, live.
      // ...it zooms back out to them (frame glides from the zoomed view to the whole, the pin going with it), no restart.
      if (first && tf === LIVE_TF && got.length < 2) { tf = OVERVIEW_TF; handoff = null; cancelAnimationFrame(zoomRaf); zoomRaf = 0; if (snap.current) snap.current.style.opacity = "0"; raw = []; first = true; framed = true; return load(true); }
      if (!base && d.rev != null && rev != null && d.rev !== rev) { rev = d.rev; return load(true); }
      // The refresh comes from another source or history than what is drawn: the whole window is read again from
      // it (once in 10 s at most; a source that flaps is merged as it comes), so the chart changes over in one go.
      if (!base && !fromWarm && src != null && !(d.source === src && d.first === rawFirst) && Date.now() - rebasedAt > 10_000) { rebasedAt = Date.now(); return load(true); }
      if (d.rev != null) rev = d.rev;
      take(d, got, since, base);
      first = false;
    };
    const tick = async () => {
      catchUp = false;
      if (!document.hidden) {
        try { await load(false); polls++; fails = 0; }
        catch (e) { fails++; if (alive && first) report((e as Error).message); }
      }
      if (alive) timer = window.setTimeout(tick, fails ? backoff(fails) : catchUp ? 40 : Date.now() - streamT < 3000 ? 1500 : tf <= 5 ? 300 : tf <= 15 ? 500 : 1000);
    };
    const goLive = () => {
      if (!alive) return;
      tf = LIVE_TF; first = true; raw = []; rawFirst = null; src = undefined; firstTime = null; last = null; byTime = null; framed = false;
      tick();
    };
    // ---- the opening: the overview (1 m, whole history) for INTRO_MS, an eased zoom into its newest five minutes,
    // then those minutes become the live 5 s candles. No overview (a coin with no minute candles yet, a failed read):
    // straight to the live chart.
    let introTimer = 0;
    // The warm overview (read ahead for every row on the page) is drawn right here, in the same frame the card opens;
    // only a row read ahead by nothing waits for its read.
    (async () => {
      let rows: Row[] = [];
      try {
        const d = primed.overviewNow ?? (await primed.overview).data;
        if (!alive) return;
        rows = continuousBars(anchored(normalizeBars(d.rows) as Row[], OVERVIEW_TF), OVERVIEW_TF, Infinity) as Row[];
      } catch { /* straight to the live chart */ }
      if (!alive) return;
      if (rows.length < 2) return goLive();
      const pin0 = spanOf(rows, 0, rows.length - 1);
      pin = pin0;
      draw(rows); frame(rows.length);
      lifeFirst = firstRow = rows[0]; last = rows[rows.length - 1];
      note(last, { src: "overview" });
      report();
      introTimer = window.setTimeout(() => {
        if (!alive) return;
        // The zoom into the newest five minutes, the price range gliding to theirs; when it lands, those minutes
        // become the live 5 s candles (frame, above).
        // The library never draws bars wider than MAX_BAR, so the end view may be wider than asked: the price range
        // is settled for the candles that will really be on screen, and the hand-off takes the view as it is.
        const endFrom = Math.max(-1, n - 5.5), end = wholeRange(n - 1, endFrom);
        const pinEnd = spanOf(rows, Math.min(endFrom, end.to - width() / MAX_BAR), n - 1) ?? pin0;
        zoomed = true;
        animateRange(chart.timeScale().getVisibleLogicalRange() ?? wholeRange(n - 1), () => end, ZOOM_MS, pin0, () => pinEnd, false, () => {
          const vr = chart.timeScale().getVisibleLogicalRange();
          const i0 = Math.max(0, Math.min(n - 1, Math.ceil(vr?.from ?? Math.max(0, n - 5))));   // the first minute wholly on screen
          const xl = chart.timeScale().logicalToCoordinate((n - 1) as never) ?? width() - PILL_PX;
          const x0 = chart.timeScale().logicalToCoordinate(i0 as never) ?? xl - (n - 1 - i0) * MAX_BAR;
          const tFirst = drawnRows[i0]?.time ?? drawnRows[drawnRows.length - 1].time;
          // One frame on, so the zoom's last step is on the canvas: that frame is copied over the chart (the top
          // layer of the crossfade) and the live candles take over beneath it.
          requestAnimationFrame(() => { if (!alive) return; snapshot(); handoff = { tFirst, xFirst: x0, xLast: xl }; goLive(); });
        });
      }, INTRO_MS);
    })();
    // The live 5 s candles, once in (asked the moment the row was hovered): the overview's newest minutes are brought
    // up to them while it is still held (the read-ahead overview can be a minute behind the live store), so the
    // hand-off has nothing left to correct. Minutes a quiet gap away get their empty slots (fillGaps), so slots stay
    // linear in time for the hand-off. Once the zoom has begun nothing is touched: the 5 s candles lay the newest
    // minutes in themselves.
    primed.live.then((r) => {
      if (!alive || tf !== OVERVIEW_TF || zoomed || !drawnRows.length || !last) return;
      const mins = new Map<number, Row>();
      for (const x of normalizeBars(r.data.rows)) {
        const t = Math.floor(x.time / OVERVIEW_TF) * OVERVIEW_TF, m = mins.get(t);
        if (!m) mins.set(t, { time: t, open: x.open, high: x.high, low: x.low, close: x.close, value: x.value || 0 });
        else { m.high = Math.max(m.high, x.high); m.low = Math.min(m.low, x.low); m.close = x.close; m.value = (m.value || 0) + (x.value || 0); }
      }
      const lastT = last.time;
      let moved = false;
      for (const m of [...mins.values()].sort((a, b) => a.time - b.time)) {
        if (m.time < lastT) continue;
        if (m.time > lastT) { m.open = last!.close; m.high = Math.max(m.high, m.open); m.low = Math.min(m.low, m.open); }   // continuous, as continuousBars draws
        put(m); last = m; moved = true;
      }
      if (!moved) return;
      note(last, { src: "overview+live" });
      report();
    }).catch(() => {});
    // Between polls every trade moves the live chart the moment the stream brings it: the newest candle takes the
    // trade, or a new one opens at the last close. The main stream carries a coin's trades while its candles are
    // being asked for (server chartFocus), so the card opens no stream of its own (`false`): a per-coin stream for
    // every row hovered held a connection each, and on HTTP/1.1 (a dev server, a tunnel) those stalled every other read.
    // A price for the live chart now: a trade (its volume, from the stream) or a bare price (v = 0: the row's own
    // market cap, below). The newest candle takes it, or a new one opens at the last close.
    const move = (mc: number, v: number, ms: number, pushed: boolean) => {
      if (tf !== LIVE_TF || first || !last) return;
      // A price with no trade behind it far off the candles is a misread, never a move.
      if (!(mc > 0) || (!(v > 0) && Math.abs(mc / last.close - 1) > 0.3)) return;
      const time = Math.floor(ms / 1000 / tf) * tf;
      if (time < last.time) return;
      if (time > last.time) {
        if (time - last.time > tf * FILL_MAX) return;
        last = { time, open: last.close, high: Math.max(last.close, mc), low: Math.min(last.close, mc), close: mc, value: v };
      } else {
        if (!(v > 0) && near(mc, last.close)) return;
        last = { ...last, high: Math.max(last.high, mc), low: Math.min(last.low, mc), close: mc, value: (last.value || 0) + v };
      }
      put(last);
      byTime?.set(last.time, last);
      if (pushed) { liveAt = Date.now(); note(last, { pushed: String(liveAt) }); } else note(last);
      report();
    };
    const untrade = onCoinTrade(mint, (x) => {
      const [, ms, mc, v] = x;
      if (!alive || !validTrade(mc, v, ms)) return;
      streamT = Date.now();
      move(mc, v, ms, true);
    }, false);
    // The row's own market cap (the Pulse stream's price for every coin on the page, from the chain): the chart's
    // newest candle follows it as a bare price, so the card's chart never sits behind the row it hangs over (the
    // radar's own 5 s store misses trades the stream's price has seen; the user, 2026-10-11, saw a card at $7.3K
    // under a row at $7.6K).
    let rowMc = usePulse.getState().coins[mint]?.mcap ?? null;
    const unrow = usePulse.subscribe((s) => {
      const mc = s.coins[mint]?.mcap ?? null;
      if (mc === rowMc) return;
      rowMc = mc;
      if (alive && mc != null && mc > 0) move(mc, 0, Date.now(), false);
    });
    return () => { alive = false; untrade(); unrow(); clearTimeout(timer); clearTimeout(introTimer); clearTimeout(tellTimer); clearTimeout(hold); cancelAnimationFrame(raf); cancelAnimationFrame(zoomRaf); chart.remove(); };
  }, [mint, born]);

  return (
    <div className="relative size-full">
      <div ref={box} className="size-full" />
      {/* the hand-off's crossfade: the zoom's last frame, drawn here and faded out over the live candles (z above the
          library's canvases at 2, under the pill and tags at 10) */}
      <canvas ref={snap} aria-hidden className="pointer-events-none absolute top-0 left-0 z-[5] opacity-0" />
      {marks && (
        <>
          {/* The overlays sit above the chart's canvases (the library gives those z-index 2): z-10, or the candles and
              the dotted line paint over the pill. */}
          {/* the last price, in a pill at the right edge at the line's height (gliding with it) */}
          <span className={cn("pointer-events-none absolute right-1.5 z-10 -translate-y-1/2 rounded-md px-1.5 py-[3px] text-[11px] leading-none font-bold tabular-nums text-black shadow-[0_2px_8px_rgba(0,0,0,0.55)] ring-1 ring-black/30 transition-[top] duration-200 ease-out", marks.up ? "bg-up" : "bg-down")}
            style={{ top: Math.min(Math.max(marks.y, 10), CHART_PAD_BOTTOM) }}>{usdP(marks.close)}</span>
          {/* the high and low of what is on screen: the low above the volume band, not on it */}
          <span className="pointer-events-none absolute top-2 right-2 z-10 rounded bg-black/40 px-1 py-0.5 text-[10px] leading-none font-semibold tabular-nums text-muted backdrop-blur-sm">H {usdP(marks.hi)}</span>
          <span className="pointer-events-none absolute bottom-[15%] left-2 z-10 rounded bg-black/40 px-1 py-0.5 text-[10px] leading-none font-semibold tabular-nums text-muted backdrop-blur-sm">L {usdP(marks.lo)}</span>
        </>
      )}
    </div>
  );
}
// The pill never slides under the volume band at the bottom.
const CHART_PAD_BOTTOM = 160;
