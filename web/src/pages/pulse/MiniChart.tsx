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
import { LIVE_TF, OVERVIEW_TF, primeCandles, windowSince, type Candles, type Row } from "./hoverChart";

export interface MiniState { last: Row | null; first: Row | null; empty: boolean; note?: string | null; liveAt: number; tf: number }
// What the overlays need: where the last price sits, and the drawn high and low.
interface Marks { y: number; close: number; hi: number; lo: number; up: boolean }

const BAR = 6;              // candle width at rest: 45 or so candles across the card, each still a candle
const MAX_BAR = 40;         // never wider: a coin a few minutes old shows a few readable candles, not three slabs
const PILL_PX = 84;         // room kept at the right edge for the last-price pill, so it never covers the newest candles
const INTRO_MS = 500, ZOOM_MS = 620, LAND_MS = 540;   // the overview is held (the user: "half a second"); the zoom into its newest minutes; the settle into the live view
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
// Every interval between the first and last candle gets a slot: a quiet one is an empty slot (`fill`: drawn as
// nothing, the area flat through it), so bar index is linear in time and the minute candles map exactly onto their
// 5 s candles at the hand-off. The full chart compresses quiet stretches instead; here time reads true. Capped, so
// a coin quiet for days never gets a slot per interval.
const FILL_CAP = 4000;
function fillGaps(rows: Row[], tf: number): Row[] {
  const out: Row[] = [];
  let added = 0;
  for (const x of rows) {
    const prev = out[out.length - 1];
    if (prev) {
      const gap = Math.round((x.time - prev.time) / tf) - 1;
      if (gap > 0 && added + gap <= FILL_CAP) { for (let k = 1; k <= gap; k++) out.push({ time: prev.time + k * tf, open: prev.close, high: prev.close, low: prev.close, close: prev.close, value: 0, fill: true }); added += gap; }
    }
    out.push(x);
  }
  return out;
}

export function MiniChart({ mint, born, onState }: { mint: string; born?: number | null; onState: (s: MiniState) => void }) {
  const box = useRef<HTMLDivElement>(null);
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
      timeScale: { visible: false, rightOffset: 2, barSpacing: BAR, minBarSpacing: 0.5, maxBarSpacing: MAX_BAR, shiftVisibleRangeOnNewBar: true },
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
    // as on the full chart), so bar index is not linear in time: the mapping goes through the rows themselves. Then
    // the view settles into the live view and the pin is let go.
    // px60: the minute spacing on screen at the end of the zoom, xB: where the current minute's left edge is (both
    // read off the library's own layout, which clamps bar spacing to MAX_BAR whatever range was asked for).
    let handoff: { px60: number; xB: number; rows: Row[] } | null = null;
    // The first index in `rows` whose time is at or after `t`.
    const lowerBound = (rows: Row[], t: number) => { let lo = 0, hi = rows.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].time < t) lo = mid + 1; else hi = mid; } return lo; };
    const frame = (count: number) => {
      framed = true;
      el.dataset.frame = `${tf}:${count}:${handoff ? "land" : zoomRaf ? "zooming" : "plain"}`;
      if (zoomRaf) return;
      if (tf === LIVE_TF && handoff && drawnRows.length) {
        const { px60, xB, rows: m } = handoff;
        handoff = null;
        // Slots are linear in time on both sides (fillGaps), so one minute bar is exactly twelve 5 s slots: the 5 s
        // spacing is a twelfth of the minute spacing on screen, anchored where the current minute begins. Every
        // whole minute then lands in its own pixels; the current minute's slots run from its left edge.
        const W = chart.timeScale().width() || width(), px5 = px60 / (OVERVIEW_TF / LIVE_TF);
        const aLast = lowerBound(drawnRows, m[m.length - 1].time);                 // the current minute's first 5 s slot
        const same = { from: aLast - 0.5 - xB / px5, to: aLast - 0.5 - xB / px5 + W / px5 };
        chart.timeScale().setVisibleLogicalRange(same);
        animateRange(same, () => liveRange(n), LAND_MS, pin, () => { const r = liveRange(n); return spanOf(drawnRows, r.from, r.to); }, true);
        return;
      }
      chart.timeScale().setVisibleLogicalRange(tf === OVERVIEW_TF ? wholeRange(count - 1) : liveRange(count));
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
      if (added) { n++; drawnRows.push(x); if (framed && !zoomRaf) { const r = chart.timeScale().getVisibleLogicalRange(); if (r && r.from < -1) frame(n); } }
      else if (drawnRows.length) drawnRows[drawnRows.length - 1] = x;
    };
    const draw = (rows: Row[]) => {
      if (!alive) return;
      rows = normalizeBars(rows);
      candles.setData(rows.map(candle)); area.setData(rows.map(point)); capFrom(rows); vol.setData(rows.map(volume));
      top = rows.length ? rows[rows.length - 1].time : -Infinity;
      n = rows.length;
      drawnRows = rows;
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
      if (base || !(d.source === src && d.first === rawFirst)) { raw = got; rawFirst = d.first ?? got[0]?.time ?? null; }
      else raw = [...raw.filter((x) => x.time < since!), ...got];
      const rows = fillGaps(continuousBars(anchored(raw, tf), tf, FILL_MAX) as Row[], tf);
      const lastT = last?.time ?? Infinity;
      const late = Boolean(byTime) && !base && rows.some((x) => x.time < lastT && x.time >= (since ?? -Infinity) && !sameRow(byTime!.get(x.time), x));
      const redraw = base || !last || rows.length < 2 || d.source !== src || rows[0].time !== firstTime || late;
      if (redraw) { draw(rows); if (rows.length) frame(rows.length); }
      else for (const x of rows) if (x.time >= last!.time) put(x);
      const ahead = !redraw && last && rows.length && last.time > rows[rows.length - 1].time ? last : null;
      byTime = new Map(rows.map((x) => [x.time, x]));
      if (ahead) byTime.set(ahead.time, ahead);
      firstTime = rows[0]?.time ?? null; firstRow = rows[0] ?? null;
      last = ahead ?? rows[rows.length - 1] ?? null;
      src = d.source;
      note(last, { src: d.source || "" });
      report(d.note);
    };
    const primed = primeCandles(mint);
    // ---- the live 5 s chart: the windowed first read (primed), then refreshes from 30 s before the last real candle on.
    const load = async (whole: boolean): Promise<void> => {
      const base = first || whole || !raw.length;
      const since = base ? windowSince(tf) : raw[raw.length - 1].time - Math.ceil(30 / tf) * tf;
      const kept = first ? await primed.live : null;
      const d = kept ? kept.data : await api<Candles>(`candles/${mint}?tf=${tf}&since=${since}`);
      catchUp = Boolean(kept);
      if (!alive) return;
      const got = d.rows.filter((x) => x.open > 0 && x.close > 0);
      // No 5 s candles to speak of (a coin the radar only has minute candles for): the minute candles stay, live.
      if (first && tf === LIVE_TF && got.length < 2) { tf = OVERVIEW_TF; handoff = null; pin = null; cancelAnimationFrame(zoomRaf); zoomRaf = 0; raw = []; first = true; return load(true); }
      if (!base && d.rev != null && rev != null && d.rev !== rev) { rev = d.rev; return load(true); }
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
    (async () => {
      let rows: Row[] = [];
      try {
        const d = (await primed.overview).data;
        if (!alive) return;
        rows = fillGaps(continuousBars(anchored(d.rows.filter((x) => x.open > 0 && x.close > 0), OVERVIEW_TF), OVERVIEW_TF, Infinity) as Row[], OVERVIEW_TF);
      } catch { /* straight to the live chart */ }
      if (!alive) return;
      if (rows.length < 2) return goLive();
      const pin0 = spanOf(rows, 0, rows.length - 1);
      pin = pin0;
      draw(rows); frame(rows.length);
      firstRow = rows[0]; last = rows[rows.length - 1];
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
        animateRange(chart.timeScale().getVisibleLogicalRange() ?? wholeRange(n - 1), () => end, ZOOM_MS, pin0, () => pinEnd, false, () => {
          const xl = chart.timeScale().logicalToCoordinate((n - 1) as never) ?? 0, xp = chart.timeScale().logicalToCoordinate((n - 2) as never) ?? xl - BAR;
          const px60 = Math.max(1, xl - xp);
          handoff = { px60, xB: xl - px60 / 2, rows: drawnRows }; goLive();
        });
      }, INTRO_MS);
    })();
    // Between polls every trade moves the live chart the moment the stream brings it: the newest candle takes the
    // trade, or a new one opens at the last close. The main stream carries a coin's trades while its candles are
    // being asked for (server chartFocus), so the card opens no stream of its own (`false`): a per-coin stream for
    // every row hovered held a connection each, and on HTTP/1.1 (a dev server, a tunnel) those stalled every other read.
    const untrade = onCoinTrade(mint, (x) => {
      const [, ms, mc, v] = x;
      if (!alive || !validTrade(mc, v, ms)) return;
      streamT = Date.now();
      if (tf !== LIVE_TF || first || !last) return;
      // A price with no trade behind it far off the candles is a misread, never a move.
      if (!(mc > 0) || (!(v > 0) && Math.abs(mc / last.close - 1) > 0.3)) return;
      const time = Math.floor(ms / 1000 / tf) * tf;
      if (time < last.time) return;
      if (time > last.time) {
        if (time - last.time > tf * FILL_MAX) return;
        last = { time, open: last.close, high: Math.max(last.close, mc), low: Math.min(last.close, mc), close: mc, value: v };
      } else last = { ...last, high: Math.max(last.high, mc), low: Math.min(last.low, mc), close: mc, value: (last.value || 0) + v };
      put(last);
      byTime?.set(last.time, last);
      liveAt = Date.now();
      note(last, { pushed: String(liveAt) });
      report();
    }, false);
    return () => { alive = false; untrade(); clearTimeout(timer); clearTimeout(introTimer); clearTimeout(tellTimer); cancelAnimationFrame(raf); cancelAnimationFrame(zoomRaf); chart.remove(); };
  }, [mint, born]);

  return (
    <div className="relative size-full">
      <div ref={box} className="size-full" />
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
