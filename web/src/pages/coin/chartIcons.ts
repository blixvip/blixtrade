// The chart's icons, drawn by a series primitive (on the chart's own canvas, so they pan and zoom with the
// candles), as Axiom draws them: round bubbles standing above the candle the trade happened in (stacked
// upward when several share a candle or crowd neighbouring ones, never overlapping), green for a buy and
// red for a sell, with two letters in white: DB / DS for the dev, SB / SS for snipers, BB / BS for bundle
// wallets, and a followed wallet's initials in a gold ring. Big trades by anyone else are small faint dots
// at the market cap they traded at, so the labelled ones stand out. DexScreener orders (DEX paid, ad,
// takeover, boosts) are a pill along the top and a bubble with DexScreener's logo on the candle (no line
// through the pane). A bubble is never drawn outside the pane. People (pump.fun accounts and Fomo
// traders, chartpeople.js) are their profile picture in a ring of the side's colour with a small B / S tag;
// a call (a pump.fun callout or a Fomo thesis) is the caller's picture in a blue ring with a small megaphone.
// Each icon keeps its hit box so the chart can show a tooltip under the pointer.
// Only candles with trades are drawn (Chart.tsx continuous), so an icon's time may fall where no candle is:
// every icon sits on the nearest drawn candle (its own when it has one), never on an empty x or nowhere.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from "lightweight-charts";

// "own": your own (paper or practice) buys and sells, Axiom's solid green B / red S. "migrate": the candle a
// pump.fun coin moved to its PumpSwap pool on, a blue M.
export type IconKind = "own" | "dev" | "tracked" | "sniper" | "bundle" | "whale" | "person" | "call" | "migrate";
// What the hover panel shows for a bubble (Chart.tsx draws it): who, what they did, how much, and a thesis in full.
export interface TipCard { name: string; pic?: string | null; tag: string; tone: "up" | "down" | "info" | "ink"; t: number; t1?: number; usd?: number; sol?: number; n?: number; mc?: number | null; text?: string | null; likes?: number | null; sub?: string }
export interface Badge { time: number; price: number | null; buy: boolean; kind: IconKind; text: string; n: number; tip: string[]; usd?: number; pic?: string | null; more?: number; card?: TipCard }
export interface Flag { time: number; text: string; tone: "info" | "warn"; tip: string[]; icon?: "dex" }
export interface Hit { x: number; y: number; r: number; tip: string[]; card?: TipCard }
export interface Palette { up: string; down: string; warn: string; info: string; dark: string; muted: string }
type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

const R = 11;           // labelled bubble radius
const MAX_STACK = 4;    // bubbles on one candle before the rest fold into a +n
const RP = 12;          // a person's picture
// The tags' glyphs (Lucide's arrow-up, arrow-down and megaphone, 24-unit boxes), drawn as paths so they stay sharp.
const GLYPH = {
  up: new Path2D("M12 19V5M5 12l7-7 7 7"),
  down: new Path2D("M12 5v14M19 12l-7 7-7-7"),
  call: new Path2D("M3 11l18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6"),
};
const DEX_LOGO = "brand/dexscreener.png";
const MIGRATE = "#5b6cf6";   // the migration bubble's blue
const FONT = "system-ui, 'Segoe UI Variable Text', 'Segoe UI', sans-serif";

export class ChartIcons implements ISeriesPrimitive<Time> {
  badges: Badge[] = [];
  flags: Flag[] = [];
  hits: Hit[] = [];
  private chart?: IChartApi;
  private series?: ISeriesApi<"Candlestick">;
  private redraw?: () => void;
  private view: IPrimitivePaneView;
  private logo?: HTMLImageElement;
  private pics = new Map<string, HTMLImageElement | null>();   // url -> loaded image (null: failed)
  private pic(url?: string | null) {
    if (!url) return null;
    if (!this.pics.has(url)) {
      if (this.pics.size > 400) this.pics.clear();
      const img = new Image(); img.decoding = "async"; img.referrerPolicy = "no-referrer";
      img.onload = () => this.redraw?.(); img.onerror = () => { this.pics.set(url, null); };
      img.src = url; this.pics.set(url, img);
    }
    const img = this.pics.get(url);
    return img && img.complete && img.naturalWidth ? img : null;
  }
  constructor(private pal: Palette, private bar: (time: number) => { high: number; low: number } | undefined, private span: () => [number, number] | null, private tf: () => number | undefined, private keys: () => number[]) {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t) };
    this.view = { zOrder: () => "top", renderer: () => renderer };
  }
  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart; this.series = p.series as ISeriesApi<"Candlestick">; this.redraw = p.requestUpdate;
    if (!this.logo) { const img = new Image(); img.onload = () => this.redraw?.(); img.src = DEX_LOGO; this.logo = img; }
  }
  detached() { this.chart = this.series = this.redraw = undefined; }
  paneViews() { return [this.view]; }
  updateAllViews() {}
  set(badges: Badge[], flags: Flag[]) { this.badges = badges; this.flags = flags; this.redraw?.(); }

  private draw(target: Target) {
    const { chart, series, pal } = this;
    this.hits = [];
    if (!chart || !series) return;
    const ts = chart.timeScale(), span = this.span(), keys = this.keys();
    if (!span || !keys.length) { this.hits = []; return; }
    // The drawn candle nearest a time (the earlier one when two are as near): its index in `keys`, and its time.
    const nearIdx = (time: number) => {
      let lo = 0, hi = keys.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (keys[mid] < time) lo = mid + 1; else hi = mid; }
      return lo > 0 && time - keys[lo - 1] <= keys[lo] - time ? lo - 1 : lo;
    };
    const near = (time: number) => keys[nearIdx(time)];
    // The candle a moment belongs to: its own, or (when that interval had no trade and so no candle) the last
    // drawn one before it. Never a later one, so an icon cannot hop to a newer candle as candles arrive.
    const ownIdx = (time: number) => {
      if (time < keys[0]) return -1;
      let lo = 0, hi = keys.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (keys[mid] <= time) lo = mid; else hi = mid - 1; }
      return lo;
    };
    // Bubbles follow the candles' width (zooming out shrinks them), so one candle's stack never spills over its
    // neighbours' and nothing has to be moved out of anyone's way.
    const spacing0 = ts.options().barSpacing;
    const size = (full: number, min = 6) => Math.max(min, Math.min(full, spacing0 / 2 - 0.5));
    // Each candle's stack: the y the next bubble's bottom must stay above, and its bubbles (to fold into).
    const stacks = new Map<number, { top: number; list: { y: number; r: number; more: number; tip: string[] }[] }>();
    target.useMediaCoordinateSpace(({ context: c, mediaSize: { width: W, height: H } }) => {
      const hits: Hit[] = [];
      // DexScreener orders: a pill along the top, one row per pill so two close together do not cover each
      // other, and the logo in a bubble over the candle.
      const pills: { x0: number; x1: number; row: number }[] = [];
      const dexBubbles: { x: number; y: number; r: number }[] = [];
      for (const f of this.flags) {
        const fi = ownIdx(Math.min(Math.max(f.time, span[0]), span[1]));
        if (fi < 0) continue;
        const time = keys[fi];
        const x = ts.timeToCoordinate(time as UTCTimestamp);
        if (x == null || x < 0 || x > W) continue;
        const col = f.tone === "info" ? pal.info : pal.warn;
        c.font = `700 9px ${FONT}`;
        const w = c.measureText(f.text).width + 12, h = 15;
        const x0 = Math.min(Math.max(x - w / 2, 2), W - w - 2);
        let row = 0;
        while (pills.some((p) => p.row === row && x0 < p.x1 + 3 && x0 + w > p.x0 - 3)) row++;
        pills.push({ x0, x1: x0 + w, row });
        const y0 = 4 + row * (h + 3);
        c.fillStyle = col; c.beginPath(); c.roundRect(x0, y0, w, h, 4); c.fill();
        c.fillStyle = pal.dark; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(f.text, x0 + w / 2, y0 + h / 2 + 0.5);
        hits.push({ x: x0 + w / 2, y: y0 + h / 2, r: Math.max(w / 2, 9), tip: f.tip });
        // DexScreener's logo in a bubble just above that candle.
        const k = this.bar(time), py = k ? series.priceToCoordinate(k.high) : null;
        if (f.icon === "dex" && py != null) {
          const r = size(10), bx = Math.min(Math.max(x, r + 1), W - r - 1), y = Math.min(Math.max(py - r - 6, y0 + h + r + 4), H - r - 2);
          // First in its candle's stack: the trade bubbles of that candle stack above it.
          const st = stacks.get(time) || { top: y - r, list: [] };
          st.top = Math.min(st.top, y - r); stacks.set(time, st);
          c.save();
          c.shadowColor = "rgba(0,0,0,0.6)"; c.shadowBlur = 5;
          c.fillStyle = "#0b0b0d"; c.beginPath(); c.arc(bx, y, r, 0, Math.PI * 2); c.fill();
          c.shadowBlur = 0; c.strokeStyle = col; c.lineWidth = 1.5; c.stroke();
          if (this.logo?.complete && this.logo.naturalWidth) { c.beginPath(); c.arc(bx, y, r - 2, 0, Math.PI * 2); c.clip(); c.drawImage(this.logo, bx - (r - 2), y - (r - 2), (r - 2) * 2, (r - 2) * 2); }
          c.restore();
          hits.push({ x: bx, y, r, tip: f.tip });
          dexBubbles.push({ x: bx, y, r });
        }
      }

      // Every icon belongs to one candle (the one its trade happened in) and stands above that candle only:
      // the first just clear of the candle's own wick, the rest of that candle's stacked straight up from it.
      // Nothing about a neighbour moves it, so panning and zooming never shift an icon, and an icon is never
      // between two candles. A stack that runs out of room at the top folds the rest into its highest bubble's
      // +n, named in its tooltip. Big-trade dots stay at the market cap they traded at, under everything.
      type Slot = { b: Badge; x: number; y: number; r: number; more: number; n: number; tip: string[]; also: number; time: number };
      // The same bubble again in the same candle (the dev buying twice, two of your buys): one bubble with the count.
      const same = (p: Badge, q: Badge) => p.kind === q.kind && p.buy === q.buy && p.text === q.text && (p.pic || "") === (q.pic || "");
      const placed: Slot[] = [], dots: { b: Badge; x: number; y: number; r: number }[] = [];
      const GAP = 4, STEP = 3;      // clear of the wick; between stacked bubbles
      // In a candle, nearest the candle first: your own trades, then calls, people, followed wallets, dev, snipers.
      const order = [...this.badges].sort((a, b) => a.time - b.time || weight(b) - weight(a));
      for (const b of order) {
        // On the candle its trade happened in (or the last drawn one before it, when that interval had no candle).
        // A trade from before the chart's first candle or after its newest is not drawn: it used to be clamped onto
        // the first or last candle, which piled unrelated bubbles there.
        if (b.time < span[0] || b.time >= span[1] + (this.tf() || 1)) continue;
        const i = ownIdx(b.time);
        if (i < 0) continue;
        const time = keys[i], x0 = ts.timeToCoordinate(time as UTCTimestamp);
        if (x0 == null || x0 < -R || x0 > W + R) continue;
        if (b.kind === "whale") {
          const price = b.price ?? this.bar(time)?.high ?? null, py = price == null ? null : series.priceToCoordinate(price);
          const r = Math.min(6, Math.max(3, 3 + Math.log10(Math.max(1, (b.usd || 1000) / 1000)) * 2));
          if (py != null) dots.push({ b, x: x0, y: Math.min(Math.max(py, r + 2), H - r - 2), r });
          continue;
        }
        const face = b.kind === "person" || b.kind === "call";
        // Faces stay big enough to see who it is (8 px radius at least), your own B / S always readable.
        const r = b.kind === "own" || b.kind === "migrate" ? size(R, 8.5) : face ? Math.max(11, Math.min(RP + 1, spacing0 * 0.9)) : size(R);
        const x = Math.min(Math.max(x0, r + 1), W - r - 1);   // never half off the pane's edge
        const twin = placed.find((p) => p.time === time && same(p.b, b));
        if (twin) {
          twin.n += b.n;
          if (twin.also < 6) twin.tip.push(`Also: ${b.tip[0]}`); else if (twin.also === 6) twin.tip.push("…and more");
          twin.also++;
          continue;
        }
        const k = this.bar(time), wick = k ? series.priceToCoordinate(k.high) : null;
        if (wick == null) continue;
        const st = stacks.get(time) || { top: wick - GAP + STEP, list: [] };
        // Right above its own candle's wick, always. Bubbles on neighbouring candles overlap like stacked cards (the
        // newer candle's on top) instead of being pushed up out of each other's way: pushed, they floated far above
        // the candles they belong to (the user, 2026-10-10).
        const y = Math.min(st.top - STEP - r, H - r - 2);
        // At most MAX_STACK bubbles on one candle (3 when candles are narrower than a bubble): the rest fold into the
        // top one's tooltip, so a busy candle never grows a tower up the chart.
        const cap = spacing0 >= 2 * r + 2 ? MAX_STACK : 3;
        if (y < r + 2 || placed.filter((p) => p.time === time).length >= cap) {
          const into = placed.filter((p) => p.time === time).sort((p, q) => p.y - q.y)[0];
          if (into) into.more += b.more || 1;   // folded in quietly: the card shows only its own trade
          continue;
        }
        st.top = y - r; stacks.set(time, st);
        placed.push({ b, x, y, r, more: b.more || 0, n: b.n, tip: [...b.tip], also: 0, time });
      }

      for (const d of dots) {
        c.save(); c.globalAlpha = 0.55; c.fillStyle = d.b.buy ? pal.up : pal.down;
        c.beginPath(); c.arc(d.x, d.y, d.r, 0, Math.PI * 2); c.fill(); c.restore();
        hits.push({ x: d.x, y: d.y, r: Math.max(d.r, 6), tip: d.b.tip, card: d.b.card });
      }
      for (const { b, x, y, r, more, n, tip } of placed) {
        const face = b.kind === "person" || b.kind === "call";
        const side = b.buy ? pal.up : pal.down;
        c.save();
        if (face) {
          // The person's picture filling the bubble, in a thin ring of the side's colour (blue for a call): the picture
          // is centre-cropped to a square (never stretched) and drawn smooth at the screen's resolution. The old
          // ring + dark gap took 2.75 px of the radius, leaving a 10 px picture in a crowded chart.
          const ring = b.kind === "call" ? pal.info : side, img = this.pic(b.pic), pr = r - 2;
          // A dark outline first, so faces that overlap on neighbouring candles read as separate coins, not a blob.
          c.shadowColor = "rgba(0,0,0,0.75)"; c.shadowBlur = 7; c.shadowOffsetY = 1;
          c.fillStyle = "#08080a"; c.beginPath(); c.arc(x, y, r + 1.25, 0, Math.PI * 2); c.fill();
          c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetY = 0;
          c.fillStyle = ring; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
          c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetY = 0;
          c.save(); c.beginPath(); c.arc(x, y, pr, 0, Math.PI * 2); c.clip();
          c.fillStyle = "#24262c"; c.fillRect(x - r, y - r, r * 2, r * 2);
          if (img) {
            const w = img.naturalWidth, h = img.naturalHeight, side0 = Math.min(w, h);
            c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
            c.drawImage(img, (w - side0) / 2, (h - side0) / 2, side0, side0, x - pr, y - pr, pr * 2, pr * 2);
          } else { c.fillStyle = "#e8e9ec"; c.font = `700 ${Math.round(pr * 0.95)}px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(b.text, x, y + 0.5); }
          c.restore();
          // Just the bubble (the user, 2026-10-10): no corner tag, no ×n / +n pill; the tooltip still names every trade.
        } else if (b.kind === "migrate") {
          // Migration: a solid blue circle with a dark M (the user's picture, 2026-10-10).
          c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = 4;
          c.fillStyle = MIGRATE; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
          c.shadowBlur = 0; c.lineWidth = 1.5; c.strokeStyle = "#0b0b0d"; c.stroke();
          if (r >= 6) { c.fillStyle = "#0b0b14"; c.font = `800 ${Math.round(r * 1.15)}px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("M", x, y + 0.5); }
        } else if (b.kind === "own") {
          // Your own trade, as Axiom draws it: a solid green (buy) or red (sell) circle, a white B or S, a thin
          // dark edge so it reads on top of a candle of its own colour.
          c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = 4;
          c.fillStyle = side; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
          c.shadowBlur = 0; c.lineWidth = 1.5; c.strokeStyle = "#0b0b0d"; c.stroke();
          if (r >= 6) { c.fillStyle = "#fff"; c.font = `800 ${Math.round(r * 1.15)}px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(b.buy ? "B" : "S", x, y + 0.5); }
          countPill(c, more ? `+${more}` : n > 1 ? `${n}` : "", x, y, r, side);
        } else {
          // Axiom's bubble: the side's colour, a lighter ring, white letters.
          c.shadowColor = "rgba(0,0,0,0.6)"; c.shadowBlur = 6;
          c.fillStyle = side; c.globalAlpha = 0.92;
          c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
          c.shadowBlur = 0; c.globalAlpha = 1;
          c.fillStyle = "rgba(0,0,0,0.28)"; c.beginPath(); c.arc(x, y, r - 1.5, 0, Math.PI * 2); c.fill();
          c.lineWidth = 2; c.strokeStyle = b.kind === "tracked" ? pal.warn : "rgba(255,255,255,0.55)";
          c.beginPath(); c.arc(x, y, r - 1, 0, Math.PI * 2); c.stroke();
          c.fillStyle = "#fff"; c.font = `800 ${Math.round((b.text.length > 1 ? 10 : 12) * r / R)}px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
          if (r >= 7) c.fillText(b.text, x, y + 0.5);   // zoomed far out the letters would be a smudge
          countPill(c, more ? `+${more}` : n > 1 ? `${n}` : "", x, y, r, side);
        }
        c.restore();
        hits.push({ x, y, r, tip, card: b.card });
      }
      this.hits = hits;
    });
  }

  // The icon under a point in the pane (media pixels), the nearest one when several overlap.
  at(x: number, y: number): Hit | null {
    let best: Hit | null = null, d = Infinity;
    for (const h of this.hits) {
      const e = Math.hypot(h.x - x, h.y - y);
      if (e <= h.r + 2 && e < d) { best = h; d = e; }
    }
    return best;
  }
}

// Which bubble sits nearest its candle when several share one: calls, then people, followed wallets, the dev,
// snipers and bundles.
const weight = (b: Badge) => ({ migrate: 8, own: 7, call: 6, person: 5, tracked: 4, dev: 3, sniper: 2, bundle: 1, whale: 0 })[b.kind];

// A count in a small dark pill over the bubble's top left (×n trades, +n more bubbles folded in).
function countPill(c: CanvasRenderingContext2D, t: string, x: number, y: number, r: number, ring: string) {
  if (!t) return;
  c.font = `700 8.5px ${FONT}`;
  const w = Math.max(15, c.measureText(t).width + 8), px = x - r - w + 7, py = y - r - 3;
  c.fillStyle = "#0b0b0d"; c.beginPath(); c.roundRect(px, py, w, 12, 6); c.fill();
  c.strokeStyle = ring; c.lineWidth = 1; c.stroke();
  c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(t, px + w / 2, py + 6.5);
}
