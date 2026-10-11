// The live candle chart inside the Pulse chart card (ChartHover.tsx): the coin's real chart in miniature, on the
// same data and at the same rate. The same candles (/api/candles, the store's own trades), the same size the coin's
// page would open on, the same poll cadence (300 ms on 1 s and 5 s candles, 500 ms on 15 s, 1 s above; 1.5 s while
// the stream is moving it) and the same per-coin fast stream (lib/pulse.ts onCoinTrade: /api/fast/stream), so every
// trade lands on the newest candle the moment the radar hears it, exactly as on pages/coin/Chart.tsx. No faces,
// marks or crosshair: a card you glance at, not one you work in. Loaded as its own chunk (lightweight-charts) the
// first time a Pulse row is hovered.
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, createChart, type AutoscaleInfo, type Time, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";
import { validBar, validTrade, normalizeBars, continuousBars } from "../../../../server/chart-data.js";
import { api } from "@/lib/api";
import { usdP } from "@/lib/coin";
import { CHART_BG } from "@/lib/gecko";
import { onCoinTrade, usePulse } from "@/lib/pulse";
import { primeCandles, type Candles, type Row } from "./hoverChart";

export interface MiniState { last: Row | null; first: Row | null; empty: boolean; note?: string | null; liveAt: number }

const BAR = 6;              // candle width at rest: 45 or so candles across the card, each still a candle
const FILL_MAX = 30_000;    // as the real chart: a silence this long (in candles) is drawn flat, past it the chart starts over
const MIN_RANGE = 0.03;     // the price axis spans at least 3% of the price, so a 1% move looks like 1%
const START_SOL = 27.96;    // pump.fun's opening market cap in SOL: a pump coin's chart starts there, flat until its first trade
const backoff = (fails: number) => Math.min(10_000, 1000 * 2 ** (fails - 1));

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

export function MiniChart({ mint, tf, born, onState }: { mint: string; tf: number; born?: number | null; onState: (s: MiniState) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const tell = useRef(onState);
  tell.current = onState;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ink = color("--color-ink", "#f2f4f7"), muted = color("--color-muted", "#8b93a1"), rule = color("--color-rule", "#232733");
    const up = color("--color-up", "#2ebd85"), down = color("--color-down", "#f6465d");
    const secs = tf < 60;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: CHART_BG }, textColor: muted, fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', sans-serif", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: alpha(rule, 0.5) } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.22 }, entireTextOnly: true, minimumWidth: 48 },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: secs, rightOffset: 3, barSpacing: BAR, minBarSpacing: 1, maxBarSpacing: 18, shiftVisibleRangeOnNewBar: true,
        tickMarkFormatter: (t: Time) => new Date(Number(t) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: secs ? "2-digit" : undefined, hour12: false }) },
      crosshair: { mode: CrosshairMode.Hidden },
      handleScroll: false, handleScale: false,
      localization: { priceFormatter: usdP },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
      priceFormat: { type: "custom", formatter: usdP, minMove: 1e-9 },
      priceLineColor: alpha(ink, 0.45), priceLineStyle: 2, priceLineWidth: 1,
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const o = original();
        if (!o?.priceRange) return o;
        const { minValue: lo, maxValue: hi } = o.priceRange, mid = (lo + hi) / 2, need = mid * MIN_RANGE;
        return hi - lo >= need ? o : { ...o, priceRange: { minValue: Math.max(0, mid - need / 2), maxValue: mid + need / 2 } };
      },
    });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });

    let alive = true, timer = 0, polls = 0, fails = 0, streamT = 0, catchUp = false, first = true, framed = false;
    let raw: Row[] = [], rawFirst: number | null = null, src: string | undefined, firstTime: number | null = null, firstRow: Row | null = null, last: Row | null = null, rev: number | null = null;
    let byTime: Map<number, Row> | null = null, top = -Infinity, n = 0, volCap = Infinity, liveAt = 0;
    const candle = (x: Row) => (x.fill || !validBar(x) ? { time: x.time as UTCTimestamp } : { time: x.time as UTCTimestamp, open: x.open, high: x.high, low: x.low, close: x.close });
    const capFrom = (rows: Row[]) => { const v = rows.map((x) => x.value || 0).filter((k) => k > 0).sort((a, b) => a - b); volCap = v.length >= 10 ? v[Math.floor(v.length * 0.9)] * 4 : Infinity; };
    const volume = (x: Row) => (x.fill ? { time: x.time as UTCTimestamp } : { time: x.time as UTCTimestamp, value: Math.min(Number.isFinite(x.value) && x.value! >= 0 ? x.value! : 0, volCap), color: alpha(x.close >= x.open ? up : down, 0.32) });
    // The card fills edge to edge: a short history spread across it, a long one its newest candles at the resting width.
    const frame = (count: number) => {
      framed = true;
      const fit = Math.floor(Math.max(120, el.clientWidth - 52) / BAR);
      if (count <= fit) chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: count + 2 });
      else chart.timeScale().setVisibleLogicalRange({ from: count - fit, to: count + 3 });
    };
    // What the chart holds, readable from outside (the same fields the real chart exposes for probes).
    const note = (x: Row | null, more: Record<string, string> = {}) => { Object.assign(el.dataset, { last: String(x?.time ?? ""), close: String(x?.close ?? ""), n: String(n), polls: String(polls), ...more }); };
    const put = (x: Row) => {
      if (!alive || !validBar(x) || x.time < top) return;
      const added = x.time > top;
      top = x.time;
      candles.update(candle(x)); vol.update(volume(x));
      if (added) { n++; if (framed) { const r = chart.timeScale().getVisibleLogicalRange(); if (r && r.from < -1) frame(n); } }
    };
    const draw = (rows: Row[]) => {
      if (!alive) return;
      rows = normalizeBars(rows);
      candles.setData(rows.map(candle)); capFrom(rows); vol.setData(rows.map(volume));
      top = rows.length ? rows[rows.length - 1].time : -Infinity;
      n = rows.length;
    };
    // The figures over the chart follow at most once a frame.
    let raf = 0;
    const report = (note?: string | null) => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (alive) tell.current({ last, first: firstRow, empty: !last, note, liveAt }); }); };
    // A pump coin's chart begins at launch, at the opening cap, flat until its first trade: only when the history
    // really starts at the launch (its first candle within a minute of it), as the real chart does.
    const anchored = (rows: Row[]): Row[] => {
      if (!born || !(born > 0) || !/pump$/.test(mint) || !rows.length) return rows;
      const sol = usePulse.getState().live?.solUsd;
      if (!(sol && sol > 0)) return rows;
      const t0 = Math.floor(born / 1000 / tf) * tf, px = START_SOL * sol;
      if (rows[0].time <= t0 + tf || rows[0].time - born / 1000 > 60) return rows;
      return [{ time: t0, open: px, high: px, low: px, close: px, value: 0 }, ...rows];
    };
    const load = async (whole: boolean): Promise<void> => {
      // The fast refresh asks only for the candles from 30 s before the last real one on; every 20th pass re-reads it all.
      const since = !first && !whole && raw.length ? raw[raw.length - 1].time - Math.ceil(30 / tf) * tf : null;
      const path = `candles/${mint}?tf=${tf}${since ? `&since=${since}` : ""}`;
      // The first read is the one the hover started (hoverChart.ts), often already answered; the read right after
      // it brings the chart up to date from its last candle on.
      const kept = first ? await primeCandles(mint, tf) : null;
      const d = kept ? kept.data : await api<Candles>(path);
      catchUp = Boolean(kept);
      if (!alive) return;
      const got = normalizeBars(d.rows);
      if (!got.length && raw.length) throw new Error("Waiting for valid chart data");
      if (d.partial && since != null && d.rev != null && rev != null && d.rev !== rev) { rev = d.rev; return load(true); }
      if (d.rev != null) rev = d.rev;
      if (d.partial && since != null && d.source === src && d.first === rawFirst) raw = [...raw.filter((x) => x.time < since), ...got];
      else if (d.partial) { if (whole || since == null) throw new Error("Incomplete chart history; retrying"); return load(true); }
      else {
        const keep = got.length && d.source === src ? raw.filter((x) => x.time < got[0].time).slice(-20_000) : [];
        raw = [...keep, ...got]; rawFirst = d.first ?? got[0]?.time ?? null;
      }
      const rows = continuousBars(anchored(raw), d.tf || tf, FILL_MAX) as Row[];
      const lastT = last?.time ?? Infinity;
      const late = Boolean(byTime) && rows.some((x) => x.time < lastT && x.time >= (since ?? -Infinity) && !sameRow(byTime!.get(x.time), x));
      const redraw = first || !last || rows.length < 2 || d.source !== src || rows[0].time !== firstTime || late;
      if (redraw) { draw(rows); if (rows.length) frame(rows.length); }
      else for (const x of rows) if (x.time >= last!.time) put(x);
      // The answer can end before what the stream has already drawn: that stays, and `last` never steps back.
      const ahead = !redraw && last && rows.length && last.time > rows[rows.length - 1].time ? last : null;
      byTime = new Map(rows.map((x) => [x.time, x]));
      if (ahead) byTime.set(ahead.time, ahead);
      firstTime = rows[0]?.time ?? null; firstRow = rows[0] ?? null;
      last = ahead ?? rows[rows.length - 1] ?? null;
      src = d.source;
      note(last, { src: d.source || "" });
      report(d.note);
      first = false;
    };
    const tick = async () => {
      catchUp = false;
      if (!document.hidden) {
        try { await load(++polls % 20 === 0); fails = 0; }
        catch (e) { fails++; if (alive && first) report((e as Error).message); }
      }
      if (alive) timer = window.setTimeout(tick, fails ? backoff(fails) : catchUp ? 40 : Date.now() - streamT < 3000 ? 1500 : tf <= 5 ? 300 : tf <= 15 ? 500 : 1000);
    };
    tick();
    // Between polls every trade moves the chart the moment the stream brings it: the newest candle takes the trade,
    // or a new one opens at the last close.
    const untrade = onCoinTrade(mint, (x) => {
      const [, ms, mc, v] = x;
      if (!alive || !validTrade(mc, v, ms)) return;
      streamT = Date.now();
      if (first || !last) return;
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
    });
    return () => { alive = false; untrade(); clearTimeout(timer); cancelAnimationFrame(raf); chart.remove(); };
  }, [mint, tf, born]);

  return <div ref={box} className="size-full" />;
}
