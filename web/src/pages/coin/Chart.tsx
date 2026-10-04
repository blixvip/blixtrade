// The coin's candle chart: market cap in USD from real trades (/api/candles), drawn the way Axiom draws it
// and the same way as the classic page (public/trade.js, mountChart): fixed 9 px candles with the newest at
// the right, every interval present up to now (a quiet one is a flat candle at the last price), each candle
// opening at the previous close, volume as a faint band along the bottom, a price axis that always spans at
// least 12% of the price, and the time axis in this PC's time. Who traded where are small dots, one per
// candle and side: your paper fills (B / S), the dev, snipers, bundles, followed wallets, and alerts.
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, HistogramSeries, type AutoscaleInfo, type CandlestickData, type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { usdK } from "@/lib/coin";
import { cn, store } from "@/lib/utils";

const TFS: [number, string][] = [[1, "1s"], [5, "5s"], [15, "15s"], [60, "1m"], [300, "5m"], [900, "15m"], [3600, "1h"]];
const BAR = 9;             // candle width in pixels at rest: two candles look like two candles, not two walls
const FILL_MAX = 300;      // longer silences are left as a break
const MIN_RANGE = 0.12;    // the price axis always spans at least 12% of the price
export interface Mark { t: number; buy: boolean; text: string }
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
  return n >= 1e9 ? `$${(n / 1e9).toFixed(3)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(3)}M` : n >= 1e5 ? `$${(n / 1e3).toFixed(1)}K` : n >= 1e4 ? `$${(n / 1e3).toFixed(2)}K`
    : n >= 1e3 ? `$${(n / 1e3).toFixed(3)}K` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(3)}`;
};
const pctF = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

// One candle for every interval up to now (a quiet one is flat at the last price, so time reads evenly and
// the chart keeps moving), each opening where the one before it closed. Same as trade.js continuous().
function continuous(rows: Row[], tf: number, nowSec = Date.now() / 1000): Row[] {
  const out: Row[] = [];
  const flat = (time: number, px: number): Row => ({ time, open: px, high: px, low: px, close: px, value: 0 });
  for (const x of rows) {
    const prev = out[out.length - 1];
    if (prev) {
      if (x.time <= prev.time) continue;
      const gap = Math.round((x.time - prev.time) / tf) - 1;
      if (gap > 0 && gap <= FILL_MAX) for (let i = 1; i <= gap; i++) out.push(flat(prev.time + i * tf, prev.close));
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

export interface ChartPaper { t: number; exit_t?: number | null }
export interface ChartSignal { t: number }

export function CoinChart({ mint, marks, paper, signals, defaultTf }: { mint: string; marks: Mark[]; paper?: ChartPaper[]; signals?: ChartSignal[]; defaultTf: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [tf, setTfState] = useState<number>(() => store.get("coin:tf", 0) || defaultTf);
  const [hover, setHover] = useState<Row | null>(null);
  const [meta, setMeta] = useState<{ source?: string; live?: boolean; note?: string | null; empty: boolean; last: Row | null }>({ empty: false, last: null });
  const s = useRef<{ chart?: IChartApi; candles?: ISeriesApi<"Candlestick">; markers?: ISeriesMarkersPluginApi<Time>; byTime?: Map<number, Row>; first?: number; tf?: number }>({});
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
      // A coin that moved 1% should look like it moved 1%, not fill the whole height.
      autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
        const o = original();
        if (!o?.priceRange) return o;
        const { minValue: lo, maxValue: hi } = o.priceRange, mid = (lo + hi) / 2, need = mid * MIN_RANGE;
        return hi - lo >= need ? o : { ...o, priceRange: { minValue: Math.max(0, mid - need / 2), maxValue: mid + need / 2 } };
      },
    });
    // Volume: faint bars along the bottom fifth, on their own hidden scale (it never touches the price axis).
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    const markers = createSeriesMarkers(candles, []);
    chart.subscribeCrosshairMove((p) => {
      const d = p?.seriesData?.get(candles) as CandlestickData<Time> | undefined;
      setHover(d ? s.current.byTime?.get(Number(d.time)) ?? null : null);
    });
    s.current = { chart, candles, markers, tf };

    let alive = true, timer = 0, first = true, polls = 0;
    let raw: Row[] = [], rawFirst: number | null = null, src: string | undefined, firstTime: number | null = null, last: Row | null = null;
    const candle = ({ time, open, high, low, close }: Row) => ({ time: time as UTCTimestamp, open, high, low, close });
    const volume = (x: Row) => ({ time: x.time as UTCTimestamp, value: x.value || 0, color: alpha(x.close >= x.open ? up : down, 0.32) });
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
        if (first) {
          const n = rows.length;
          if (n > 160) chart.timeScale().setVisibleLogicalRange({ from: n - 160, to: n + 6 });
          else { chart.timeScale().applyOptions({ barSpacing: BAR }); chart.timeScale().scrollToRealTime(); }
        }
      } else {
        for (const x of rows) if (x.time >= last.time) { candles.update(candle(x)); vol.update(volume(x)); }
      }
      s.current.byTime = new Map(rows.map((x) => [x.time, x]));
      s.current.first = rows[0]?.time;
      firstTime = rows[0]?.time ?? null;
      last = rows[rows.length - 1] ?? null;
      src = d.source;
      setMeta({ source: d.source, live: d.live, note: d.note, empty: !rows.length, last });
      first = false;
    };
    const tick = async () => {
      if (!document.hidden) {
        try { await load(++polls % 20 === 0); }
        catch (e) { if (alive && first) setMeta({ note: (e as Error).message, empty: true, last: null }); }
      }
      if (alive) timer = window.setTimeout(tick, tf <= 5 ? 400 : tf <= 15 ? 800 : 2000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); chart.remove(); s.current = {}; };
  }, [mint, tf]);

  // One small dot per candle, side and colour; several trades in the same candle are counted, not stacked.
  // Your paper fills in ink (B / S), tagged trades in green/red (DB, SS…; a followed wallet shows its label's
  // first letters or nothing), and alerts as plain muted squares.
  useEffect(() => {
    const { markers, first, tf: ctf } = s.current;
    if (!markers || ctf == null) return;
    const up = color("--color-up", "#2ebd85"), down = color("--color-down", "#f6465d"), ink = color("--color-ink", "#f2f4f7"), muted = color("--color-muted", "#8b93a1");
    const snap = (ms: number) => Math.floor(ms / 1000 / ctf) * ctf;
    const groups = new Map<string, { time: number; buy: boolean; color: string; texts: string[]; n: number }>();
    const add = (ms: number, buy: boolean, text: string, c: string) => {
      const time = snap(ms), k = `${time}|${buy ? 1 : 0}|${c}`;
      const g = groups.get(k) || { time, buy, color: c, texts: [], n: 0 };
      g.n++; if (text && !g.texts.includes(text)) g.texts.push(text);
      groups.set(k, g);
    };
    for (const p of paper || []) { add(p.t, true, "B", ink); if (p.exit_t) add(p.exit_t, false, "S", ink); }
    for (const m of marks) add(m.t, m.buy, m.text, m.buy ? up : down);
    const list: SeriesMarker<Time>[] = [...groups.values()].map((g) => ({ time: g.time as UTCTimestamp, position: g.buy ? "belowBar" : "aboveBar", color: g.color, shape: "circle", size: 0.6,
      text: g.texts.length ? `${g.texts.slice(0, 2).join(" ")}${g.n > g.texts.length ? ` ×${g.n}` : ""}` : "" }));
    for (const sg of (signals || []).slice(0, 40)) list.push({ time: snap(sg.t) as UTCTimestamp, position: "aboveBar", color: muted, shape: "square", size: 0.5, text: "" });
    markers.setMarkers(list.filter((x) => (x.time as number) >= (first ?? Infinity)).sort((a, b) => (a.time as number) - (b.time as number)));
  }, [marks, paper, signals, tf, meta.empty, meta.source]);

  // The line above the chart: the candle under the pointer, or the newest one.
  const c = hover || meta.last;
  const chg = c && c.open > 0 ? (c.close / c.open - 1) * 100 : 0;
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
        <span className="ml-auto text-xs text-muted">{meta.live ? "● " : ""}{meta.source || ""}</span>
      </div>
      <div ref={box} className="h-[clamp(340px,52vh,760px)] w-full" />
      {meta.empty && <p className="text-xs text-muted">{meta.note ? `No candles yet (${meta.note}).` : "No trades in this window yet. Candles appear with the first trade Blix sees."}</p>}
    </div>
  );
}
