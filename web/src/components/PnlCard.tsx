// PnL cards: a picture of a result to save or paste anywhere, in Blix's card design (the chrome eye artwork):
// the blixvip.com mark top left, the coin's $SYMBOL, the return in a light box, and the SOL result with the chrome
// Solana mark. Two kinds: a trade card (your position in one coin, real, paper or Practice) and a Practice session
// card (the replay wallet since the run started). The card is live: while it is open its figures follow the position
// (0 before the first trade). A paper or Practice card says so next to the mark: a practice result is never
// presented as real money. Drawn on a canvas at the artwork's 1899x930.
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";

export interface CardData {
  kind: "trade" | "session";
  mint: string; symbol: string;
  mode: "practice" | "paper" | "real";
  pnlSol: number;            // the result, SOL (0 before any trade)
  baseSol: number;           // what the return is measured on: SOL bought (trade) or the starting balance (session)
  solUsd?: number | null;
}

const W = 1899, H = 930;
// Inter Tight (web/public/fonts, a tight grotesk close to the design's Helvetica Neue bold), loaded once before the
// first draw so every computer draws the same card; Helvetica / Arial only if it fails to load.
const FONT = `"BlixCard", "Helvetica Neue", Helvetica, Arial, sans-serif`;
const font = (px: number, weight = 700) => `${weight} ${px}px ${FONT}`;
let fontReady: Promise<unknown> | null = null;
const loadFont = () => (fontReady ||= (async () => {
  try { const f = new FontFace("BlixCard", "url(fonts/inter-tight-var.woff2)", { weight: "100 900" }); await f.load(); document.fonts.add(f); } catch { /* fall back */ }
})());

// "+306%", "-12%", "0%"; under 10% one decimal.
export function pctText(pnl: number, base: number) {
  const p = base > 0 ? (pnl / base) * 100 : 0;
  if (Math.abs(p) < 0.05) return "0%";
  const a = Math.abs(p), n = a >= 10 ? Math.round(a).toLocaleString("en-US") : a.toFixed(1);
  return `${p > 0 ? "+" : "-"}${n}%`;
}
// "+61.3 SOL", "-0.512 SOL", "0 SOL".
export function solText(v: number) {
  const a = Math.abs(v);
  if (a < 0.0005) return "0 SOL";
  return `${v > 0 ? "+" : "-"}${a >= 10 ? a.toFixed(1) : a >= 1 ? a.toFixed(2) : a.toFixed(3)} SOL`;
}
function usdText(v: number) {
  const a = Math.abs(v);
  if (a < 0.005) return "$0";
  return `${v > 0 ? "+" : "-"}$${a >= 1000 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2)}`;
}

const pics = new Map<string, Promise<HTMLImageElement | null>>();
const img = (src: string) => {
  let p = pics.get(src);
  if (!p) { p = (async () => { try { const im = new Image(); im.src = src; await im.decode(); return im; } catch { return null; } })(); pics.set(src, p); }
  return p;
};
// Text that fits: the size steps down until it is no wider than `max`.
function fit(x: CanvasRenderingContext2D, text: string, px: number, weight: number, max: number) {
  let s = px;
  x.font = font(s, weight);
  while (x.measureText(text).width > max && s > 20) { s -= 2; x.font = font(s, weight); }
  return s;
}
// The Solana mark in chrome: three slanted bars, each a dark glassy fill with a bright metal rim, and a glint on
// the top one, as in the design.
function solanaMark(x: CanvasRenderingContext2D, l: number, t: number, w: number) {
  const bh = w * 0.2, gap = w * 0.13, slant = w * 0.24;
  const bars: [number, boolean][] = [[t, true], [t + bh + gap, false], [t + 2 * (bh + gap), true]];   // true: slants right at the top
  bars.forEach(([y, right], i) => {
    x.beginPath();
    if (right) { x.moveTo(l + slant, y); x.lineTo(l + w, y); x.lineTo(l + w - slant, y + bh); x.lineTo(l, y + bh); }
    else { x.moveTo(l, y); x.lineTo(l + w - slant, y); x.lineTo(l + w, y + bh); x.lineTo(l + slant, y + bh); }
    x.closePath();
    const fill = x.createLinearGradient(l, y, l, y + bh); fill.addColorStop(0, "rgba(255,255,255,0.10)"); fill.addColorStop(1, "rgba(255,255,255,0.02)");
    x.fillStyle = fill; x.fill();
    const rim = x.createLinearGradient(l, y, l + w, y + bh);
    rim.addColorStop(0, "#9a9a9a"); rim.addColorStop(0.35, "#f4f4f4"); rim.addColorStop(0.6, "#8c8c8c"); rim.addColorStop(1, "#e6e6e6");
    x.strokeStyle = rim; x.lineWidth = Math.max(3, w * 0.028); x.lineJoin = "round"; x.stroke();
    if (i === 0) {
      const gx = l + w * 0.82, gy = y + 2, g = x.createRadialGradient(gx, gy, 0, gx, gy, w * 0.16);
      g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.25, "rgba(255,255,255,0.35)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(gx - w * 0.16, gy - w * 0.16, w * 0.32, w * 0.32);
    }
  });
}

export async function drawCard(cv: HTMLCanvasElement, d: CardData, opt: { amounts: boolean; usd: boolean }) {
  const [bg, eye] = await Promise.all([img("brand/pnl-card-bg.webp"), img("brand/pnl-eye.png"), loadFont()]);
  const x = cv.getContext("2d")!;
  cv.width = W; cv.height = H;
  x.textBaseline = "alphabetic"; x.textAlign = "left";
  const spacing = (px: number) => { (x as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`; };
  x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
  // The artwork, filling the card's width (its top and bottom trimmed evenly), with a soft shade on the left so
  // the figures read cleanly over it.
  if (bg) { const h = (bg.height / bg.width) * W; x.drawImage(bg, 0, (H - h) / 2, W, h); }
  const shade = x.createLinearGradient(0, 0, W * 0.6, 0); shade.addColorStop(0, "rgba(0,0,0,0.45)"); shade.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = shade; x.fillRect(0, 0, W * 0.6, H);

  // Top left: the eye, a hairline, BLIXVIP.COM; a paper or Practice card adds what it is after a second hairline.
  if (eye) x.drawImage(eye, 10, 8, 96, 96);
  x.fillStyle = "rgba(255,255,255,0.28)"; x.fillRect(104, 30, 2, 52);
  x.fillStyle = "#ececec"; x.font = font(31, 700); spacing(0.6); x.fillText("BLIXVIP.COM", 124, 68);
  const tag = d.mode === "practice" ? "PRACTICE" : d.mode === "paper" ? "PAPER TRADE" : null;
  if (tag) {
    const l = 124 + x.measureText("BLIXVIP.COM").width + 22;
    x.fillStyle = "rgba(255,255,255,0.28)"; x.fillRect(l, 36, 2, 40);
    x.fillStyle = "rgba(255,255,255,0.62)"; x.font = font(22, 600); spacing(3); x.fillText(tag, l + 22, 66);
  }

  // The coin.
  const sym = `$${(d.symbol || "?").toUpperCase()}`;
  x.fillStyle = "#f4f4f4"; spacing(0.5); fit(x, sym, 64, 500, 760); x.fillText(sym, 104, 254);

  // The return, black on a light box as wide as it needs (never narrower than the design's), lifted a little off
  // the art with a soft shadow and a faint top-to-bottom sheen.
  const pct = pctText(d.pnlSol, d.baseSol);
  spacing(-2); x.font = font(118, 800);
  const pw = x.measureText(pct).width, bw = Math.max(664, pw + 190), bx = 106, by = 283, bh = 148;
  x.save(); x.shadowColor = "rgba(0,0,0,0.55)"; x.shadowBlur = 40; x.shadowOffsetY = 12;
  const box = x.createLinearGradient(0, by, 0, by + bh); box.addColorStop(0, "#efefef"); box.addColorStop(1, "#d3d3d3");
  x.fillStyle = box; x.fillRect(bx, by, bw, bh); x.restore();
  x.fillStyle = "rgba(255,255,255,0.7)"; x.fillRect(bx, by, bw, 2);
  x.fillStyle = "#0a0a0a"; x.textAlign = "center"; x.fillText(pct, bx + bw / 2, by + 117); x.textAlign = "left";

  // The result in SOL with the chrome Solana mark (or in dollars), in white with a slight metal fade.
  if (opt.amounts) {
    const inUsd = opt.usd && !!d.solUsd;
    // A result too small to show in SOL is 0 in dollars too, so the three figures always agree.
    const text = inUsd ? (Math.abs(d.pnlSol) < 0.0005 ? "$0" : usdText(d.pnlSol * d.solUsd!)) : solText(d.pnlSol);
    const left = inUsd ? 104 : 272;
    if (!inUsd) solanaMark(x, 104, 762, 136);
    spacing(-1.5);
    const size = fit(x, text, 144, 800, 1010 - left);
    const metal = x.createLinearGradient(0, 866 - size * 0.75, 0, 866); metal.addColorStop(0, "#ffffff"); metal.addColorStop(1, "#cfcfcf");
    x.fillStyle = metal; x.fillText(text, left, 866);
  }
  spacing(0);
}

// The card window: the live picture, SOL or USD, the amount shown or not, save and copy.
export function PnlCardDialog({ data, open, onOpenChange }: { data: CardData | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [amounts, setAmountsState] = useState(() => store.get<boolean>("pnlcard:amounts", true));
  const [inUsd, setUsdState] = useState(() => store.get<boolean>("pnlcard:usd", false));
  const setAmounts = (v: boolean) => { store.set("pnlcard:amounts", v); setAmountsState(v); };
  const setUsd = (v: boolean) => { store.set("pnlcard:usd", v); setUsdState(v); };
  const [ready, setReady] = useState(false);
  // Redrawn whenever what it shows changes (the position moves with every trade and price).
  const key = data ? `${data.kind}|${data.symbol}|${data.mode}|${pctText(data.pnlSol, data.baseSol)}|${solText(data.pnlSol)}|${data.solUsd ? usdText(data.pnlSol * data.solUsd) : ""}|${amounts}|${inUsd}` : "";
  useEffect(() => { if (!open) setReady(false); }, [open]);
  useEffect(() => {
    if (!open || !data) return;
    let alive = true;
    // The canvas mounts with the window: one frame later it is there to draw on.
    const t = requestAnimationFrame(() => { if (ref.current) void drawCard(ref.current, data, { amounts, usd: inUsd }).then(() => { if (alive) setReady(true); }); });
    return () => { alive = false; cancelAnimationFrame(t); };
  }, [open, key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const name = () => `blix-${data?.kind === "session" ? "practice" : "pnl"}-${data?.symbol || "coin"}.png`.replace(/[^\w.-]+/g, "");
  const save = () => { const cv = ref.current; if (!cv) return; const a = document.createElement("a"); a.download = name(); a.href = cv.toDataURL("image/png"); a.click(); };
  const copyImg = async () => {
    const cv = ref.current; if (!cv) return;
    try {
      const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, "image/png"));
      if (!blob || !("ClipboardItem" in window)) throw new Error("no clipboard");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("PnL card copied. Paste it anywhere.");
    } catch { toast("This browser can't copy pictures. Use Save instead."); }
  };
  const seg = (on: boolean) => cn("h-8 rounded-full px-3.5 text-xs font-semibold transition-colors", on ? "bg-ink text-on-fill" : "text-muted hover:text-ink");
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={data?.kind === "session" ? "Practice session card" : "PnL card"} wide>
      <div className="flex flex-col gap-4">
        <div className="relative overflow-hidden rounded-[14px] bg-black shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/10" style={{ aspectRatio: `${W} / ${H}` }}>
          <canvas ref={ref} width={W} height={H} className={cn("block h-full w-full transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")} />
          {!ready && <span className="absolute inset-0 grid place-items-center text-sm text-muted">Drawing…</span>}
          {/* Live: it follows the position while it is open. */}
          <span className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[0.6875rem] font-bold tracking-wide text-white/85 ring-1 ring-white/15 backdrop-blur">
            <i className="size-1.5 animate-pulse rounded-full bg-up" />LIVE
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="Currency" className="inline-flex rounded-full bg-paper-3 p-0.5 ring-1 ring-rule">
            <button role="radio" aria-checked={!inUsd} onClick={() => setUsd(false)} className={seg(!inUsd)}>SOL</button>
            <button role="radio" aria-checked={inUsd} onClick={() => setUsd(true)} disabled={!data?.solUsd} className={seg(inUsd)}>USD</button>
          </div>
          <button role="switch" aria-checked={amounts} onClick={() => setAmounts(!amounts)} className="flex items-center gap-2 text-sm font-medium text-ink-2 hover:text-ink">
            <span className={cn("relative h-5 w-9 rounded-full transition-colors", amounts ? "bg-up" : "bg-paper-4")}><i className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]", amounts ? "left-[18px]" : "left-0.5")} /></span>
            Show amount
          </button>
          <span className="ml-auto flex gap-2">
            <button onClick={copyImg} disabled={!ready} className="flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-ink-2 ring-1 ring-rule hover:text-ink hover:ring-rule-2 disabled:opacity-50"><Icon.copy className="size-3.5" />Copy</button>
            <button onClick={save} disabled={!ready} className="flex h-9 items-center gap-1.5 rounded-full bg-ink px-5 text-sm font-semibold text-on-fill hover:bg-focus disabled:opacity-50"><Icon.image className="size-3.5" />Save image</button>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
