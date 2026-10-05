// The chart's icons, drawn by a series primitive (on the chart's own canvas, so they pan and zoom with the
// candles), as Axiom draws them: round bubbles at the market cap the trade happened at, green for a buy and
// red for a sell, with two letters in white: DB / DS for the dev, SB / SS for snipers, BB / BS for bundle
// wallets, and a followed wallet's initials in a gold ring. Big trades by anyone else are small faint dots
// so the labelled ones stand out. DexScreener orders (DEX paid, ad, takeover, boosts) are a dashed line, a
// pill along the top and a bubble with DexScreener's logo on the candle. A bubble is never drawn outside the
// pane: one past the top or bottom is pinned to the edge, fully visible. Each icon keeps its hit box so the
// chart can show a tooltip under the pointer.
import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time, UTCTimestamp } from "lightweight-charts";

export type IconKind = "dev" | "tracked" | "sniper" | "bundle" | "whale";
export interface Badge { time: number; price: number | null; buy: boolean; kind: IconKind; text: string; n: number; tip: string[]; usd?: number }
export interface Flag { time: number; text: string; tone: "info" | "warn"; tip: string[]; icon?: "dex" }
export interface Hit { x: number; y: number; r: number; tip: string[] }
export interface Palette { up: string; down: string; warn: string; info: string; dark: string; muted: string }
type Target = Parameters<IPrimitivePaneRenderer["draw"]>[0];

const R = 11;           // labelled bubble radius
const DEX_LOGO = "/brand/dexscreener.png";
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
  constructor(private pal: Palette, private bar: (time: number) => { high: number; low: number } | undefined, private span: () => [number, number] | null) {
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
    const ts = chart.timeScale(), span = this.span();
    target.useMediaCoordinateSpace(({ context: c, mediaSize: { width: W, height: H } }) => {
      const hits: Hit[] = [];
      // DexScreener orders: a dashed line through the pane and a pill along the top, one row per pill so two
      // close together do not cover each other.
      const pills: { x0: number; x1: number; row: number }[] = [];
      for (const f of this.flags) {
        if (!span) break;
        const time = Math.min(Math.max(f.time, span[0]), span[1]);
        const x = ts.timeToCoordinate(time as UTCTimestamp);
        if (x == null || x < 0 || x > W) continue;
        const col = f.tone === "info" ? pal.info : pal.warn;
        c.save();
        c.strokeStyle = col; c.globalAlpha = 0.55; c.setLineDash([3, 3]); c.lineWidth = 1;
        c.beginPath(); c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, H); c.stroke();
        c.restore();
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
          const r = 10, bx = Math.min(Math.max(x, r + 1), W - r - 1), y = Math.min(Math.max(py - r - 6, y0 + h + r + 4), H - r - 2);
          c.save();
          c.shadowColor = "rgba(0,0,0,0.6)"; c.shadowBlur = 5;
          c.fillStyle = "#0b0b0d"; c.beginPath(); c.arc(bx, y, r, 0, Math.PI * 2); c.fill();
          c.shadowBlur = 0; c.strokeStyle = col; c.lineWidth = 1.5; c.stroke();
          if (this.logo?.complete && this.logo.naturalWidth) { c.beginPath(); c.arc(bx, y, r - 2, 0, Math.PI * 2); c.clip(); c.drawImage(this.logo, bx - (r - 2), y - (r - 2), (r - 2) * 2, (r - 2) * 2); }
          c.restore();
          hits.push({ x: bx, y, r, tip: f.tip });
        }
      }

      // Badges at the market cap they traded at (a candle's low for a buy, high for a sell when unknown),
      // nudged apart when several land on the same spot.
      const taken: { x: number; y: number; r: number }[] = [];
      for (const b of this.badges) {
        const x0 = ts.timeToCoordinate(b.time as UTCTimestamp);
        if (x0 == null || x0 < -R || x0 > W + R) continue;
        const x = Math.min(Math.max(x0, R + 1), W - R - 1);   // never half off the pane's edge
        const k = this.bar(b.time);
        const price = b.price ?? (k ? (b.buy ? k.low : k.high) : null);
        if (price == null) continue;
        const py = series.priceToCoordinate(price);
        if (py == null) continue;
        // Big trades by anyone else: small faint dots, a little bigger the more dollars moved.
        const whale = b.kind === "whale";
        const r = whale ? Math.min(6, Math.max(3, 3 + Math.log10(Math.max(1, (b.usd || 1000) / 1000)) * 2)) : R;
        let y: number = Math.min(Math.max(py, r + 2), H - r - 2);
        const step = b.buy ? 1 : -1;
        for (let i = 0; i < 12 && taken.some((p) => Math.abs(p.x - x) < r + p.r && Math.abs(p.y - y) < r + p.r); i++) y = Math.min(Math.max(y + step * (r * 2 + 2), r + 2), H - r - 2);
        taken.push({ x, y, r });
        const side = b.buy ? pal.up : pal.down;
        c.save();
        if (whale) {
          c.globalAlpha = 0.55; c.fillStyle = side;
          c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        } else {
          // Axiom's bubble: the side's colour, a lighter ring, white letters.
          c.shadowColor = "rgba(0,0,0,0.6)"; c.shadowBlur = 6;
          c.fillStyle = side; c.globalAlpha = 0.92;
          c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
          c.shadowBlur = 0; c.globalAlpha = 1;
          c.fillStyle = "rgba(0,0,0,0.28)"; c.beginPath(); c.arc(x, y, r - 1.5, 0, Math.PI * 2); c.fill();
          c.lineWidth = 2; c.strokeStyle = b.kind === "tracked" ? pal.warn : "rgba(255,255,255,0.55)";
          c.beginPath(); c.arc(x, y, r - 1, 0, Math.PI * 2); c.stroke();
          c.fillStyle = "#fff"; c.font = `800 ${b.text.length > 1 ? 10 : 12}px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
          c.fillText(b.text, x, y + 0.5);
          if (b.n > 1) {
            const t = `${b.n}`; c.font = `800 9px ${FONT}`;
            const w = Math.max(14, c.measureText(t).width + 7);
            c.fillStyle = "#0b0b0d"; c.beginPath(); c.roundRect(x + r - 6, y - r - 3, w, 13, 6.5); c.fill();
            c.strokeStyle = side; c.lineWidth = 1; c.stroke();
            c.fillStyle = "#fff"; c.textAlign = "center"; c.fillText(t, x + r - 6 + w / 2, y - r + 3.5);
          }
        }
        c.restore();
        hits.push({ x, y, r: Math.max(r, 6), tip: b.tip });
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
