// PnL cards: a picture of a result to save or paste anywhere, in Blix's card design (the chrome eye artwork):
// the blixvip.com mark top left, the coin's $SYMBOL, the return in a light box, and the SOL result with the chrome
// Solana mark. Two kinds: a trade card (your position in one coin, real, paper or Practice) and a Practice session
// card (the replay wallet since the run started). The card is live: while it is open its figures follow the position
// (0 before the first trade). A paper or Practice card says so next to the mark: a practice result is never
// presented as real money. Drawn on a 1680x1140 canvas (Axiom's card shape) over a background the person picks: the Blix eye
// artwork, the coin's own picture blurred, plain dark, or a picture of their own.
import { useEffect, useRef, useState } from "react";
import * as D from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { apiUrl, onDirectLine } from "@/lib/api";
import { useMe } from "@/lib/ui";
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

const W = 1680, H = 1140;
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
// The coin's picture, fetched (not an <img> from another address, which would taint the canvas and block Save).
const got = new Map<string, Promise<HTMLImageElement | null>>();
const fetched = (url: string) => {
  let p = got.get(url);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(url, { referrerPolicy: "no-referrer" });
        if (!r.ok) return null;
        return await img(URL.createObjectURL(await r.blob()));
      } catch { return null; }
    })();
    got.set(url, p);
  }
  return p;
};
const coinPic = (mint: string) => fetched(onDirectLine() ? apiUrl(`img/${mint}.webp`) : `img/${mint}`);

export type Bg = "eye" | "coin" | "dark" | "own";
const OWN_KEY = "pnlcard:own";   // the person's own picture, shrunk to the card's size, as a JPEG data URL
// A picture drawn to cover the card (cropped evenly, or around `fx`, the share of its width to keep in view).
function cover(x: CanvasRenderingContext2D, im: CanvasImageSource & { width: number; height: number }, fx = 0.5) {
  const s = Math.max(W / im.width, H / im.height), w = im.width * s, h = im.height * s;
  x.drawImage(im, Math.min(0, Math.max(W - w, W / 2 - w * fx)), (H - h) / 2, w, h);
}
// Soft blur that every browser draws the same: the picture shrunk to a few dozen pixels, then smoothed back up.
function blurred(x: CanvasRenderingContext2D, im: HTMLImageElement) {
  const t = document.createElement("canvas"); t.width = 40; t.height = 32;
  const tx = t.getContext("2d")!; tx.imageSmoothingQuality = "high";
  const s = Math.max(40 / im.width, 32 / im.height);
  tx.drawImage(im, (40 - im.width * s) / 2, (32 - im.height * s) / 2, im.width * s, im.height * s);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.drawImage(t, -60, -48, W + 120, H + 96);
}
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

// Who the card belongs to: their picture and @handle bottom left, and their invite link's saving on fees.
export interface Who { handle?: string | null; name?: string | null; picture?: string | null; savePct?: number | null }
// A short money figure: "+$122K", "-$1.2M", "+$45.10"; in SOL, solText's. `signed` false drops the plus.
function money(sol: number, usd: number | null, signed = true) {
  if (usd == null) { const t = solText(sol); return signed ? t : t.replace(/^\+/, ""); }
  const v = sol * usd, a = Math.abs(v), sign = v < 0 ? "-" : signed && a >= 0.005 ? "+" : "";
  if (a < 0.005) return "$0";
  const n = a >= 1e6 ? `${+(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${+(a / 1e3).toFixed(1)}K` : a >= 1000 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2);
  return `${sign}$${n}`;
}

// Laid out like Axiom's card: the mark top left and the name top right; the coin, the result in a light box,
// then PNL, Invested and Position; the owner's picture and @handle, and the site with their invite's saving.
export async function drawCard(cv: HTMLCanvasElement, d: CardData, opt: { amounts: boolean; usd: boolean; bg: Bg; own?: string | null; who?: Who | null }) {
  const who = opt.who;
  const [art, eye, coin, own, face] = await Promise.all([
    opt.bg === "eye" ? img("brand/pnl-card-bg.webp") : null, img("brand/pnl-eye.png"),
    opt.bg === "coin" && d.mint ? coinPic(d.mint) : null, opt.bg === "own" && opt.own ? img(opt.own) : null,
    who?.picture ? fetched(who.picture) : null, loadFont()]);
  const x = cv.getContext("2d")!;
  cv.width = W; cv.height = H;
  x.textBaseline = "alphabetic"; x.textAlign = "left";
  const spacing = (px: number) => { (x as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`; };
  // The background: the eye artwork (its eye kept in view on the right), the coin's picture blurred and dimmed,
  // the person's own picture dimmed a little, or plain dark (also whenever a picture is missing).
  const dark = x.createRadialGradient(W * 0.7, H * 0.3, 0, W * 0.7, H * 0.3, W * 0.95);
  dark.addColorStop(0, "#1c1c1f"); dark.addColorStop(1, "#000");
  x.fillStyle = dark; x.fillRect(0, 0, W, H);
  if (art) cover(x, art, 0.8);
  else if (coin) { blurred(x, coin); x.fillStyle = "rgba(0,0,0,0.5)"; x.fillRect(0, 0, W, H); }
  else if (own) { cover(x, own); x.fillStyle = "rgba(0,0,0,0.3)"; x.fillRect(0, 0, W, H); }
  // Shade on the left so the figures read cleanly over any picture.
  const left = x.createLinearGradient(0, 0, W * 0.65, 0); left.addColorStop(0, "rgba(0,0,0,0.6)"); left.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = left; x.fillRect(0, 0, W * 0.65, H);

  const M = 72;
  // Top left the eye; top right BLIXVIP, and under it PAPER TRADE or PRACTICE when it is not real money.
  if (eye) x.drawImage(eye, M - 22, 34, 150, 150);
  // A soft dark pool behind the corner so the name reads over the artwork's bright rim.
  const pool = x.createRadialGradient(W - M - 150, 120, 0, W - M - 150, 120, 340);
  pool.addColorStop(0, "rgba(0,0,0,0.7)"); pool.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = pool; x.fillRect(W - 560, 0, 560, 360);
  x.textAlign = "right"; spacing(2); x.font = font(60, 800);
  const name = x.createLinearGradient(0, 80, 0, 126); name.addColorStop(0, "#ffffff"); name.addColorStop(1, "#c9c9c9");
  x.save(); x.shadowColor = "rgba(0,0,0,0.6)"; x.shadowBlur = 18; x.fillStyle = name; x.fillText("BLIXVIP", W - M, 126); x.restore();
  const tag = d.mode === "practice" ? "PRACTICE" : d.mode === "paper" ? "PAPER TRADE" : null;
  if (tag) {
    // A small glassy pill, right-aligned under the name.
    x.font = font(22, 700); spacing(3.5);
    const tw = x.measureText(tag).width, ph = 42, pw = tw + 36, px = W - M - pw, py = 150;
    x.fillStyle = "rgba(255,255,255,0.1)"; x.beginPath(); x.roundRect(px, py, pw, ph, ph / 2); x.fill();
    x.strokeStyle = "rgba(255,255,255,0.18)"; x.lineWidth = 1.5; x.stroke();
    x.fillStyle = "rgba(255,255,255,0.85)"; x.fillText(tag, W - M - 18 + 1.75, py + 29);
  }
  spacing(0); x.textAlign = "left";

  // The coin.
  const sym = `$${(d.symbol || "?").toUpperCase()}`;
  x.fillStyle = "#f4f4f4"; spacing(0); fit(x, sym, 84, 700, W * 0.55); x.fillText(sym, M, 320);

  // The result, black on a light box: the amount (or the return when amounts are hidden).
  const usd = opt.usd && d.solUsd ? d.solUsd : null;
  const pct = pctText(d.pnlSol, d.baseSol);
  const big = opt.amounts ? money(d.pnlSol, usd) : pct;
  spacing(-2);
  const bs = fit(x, big, 136, 800, W * 0.62 - 96);
  const by = 356, bh = 178, bw = Math.max(W * 0.5, x.measureText(big).width + 110);
  x.save(); x.shadowColor = "rgba(0,0,0,0.5)"; x.shadowBlur = 40; x.shadowOffsetY = 12;
  const box = x.createLinearGradient(0, by, 0, by + bh); box.addColorStop(0, "#f2f2f2"); box.addColorStop(1, "#d4d4d4");
  x.fillStyle = box; x.fillRect(M, by, bw, bh); x.restore();
  x.fillStyle = "rgba(255,255,255,0.75)"; x.fillRect(M, by, bw, 2);
  x.fillStyle = "#0a0a0a"; x.fillText(big, M + 48, by + bh / 2 + bs * 0.36);

  // PNL, Invested, Position (what was put in, and what it is worth now with what was taken out).
  spacing(0);
  // Amounts hidden: the box already shows the return, so no rows.
  const rows: [string, string, string?][] = opt.amounts ? [["PNL", pct, d.pnlSol > 0 && pct !== "0%" ? "#4ee6a0" : d.pnlSol < 0 && pct !== "0%" ? "#ff6b6b" : "#f4f4f4"],
    ["Invested", money(d.baseSol, usd, false)], ["Position", money(d.baseSol + d.pnlSol, usd, false)]] : [];
  rows.forEach(([k, v, c], i) => {
    const y = 652 + i * 84;
    x.fillStyle = "#f4f4f4"; x.font = font(54, 600); x.fillText(k, M + 36, y);
    x.fillStyle = c || "#f4f4f4"; x.font = font(54, 700); x.fillText(v, M + 560, y);
  });

  // Bottom left: the owner's picture and @handle, then the site and what their invite link saves.
  const nameText = who?.handle ? `@${who.handle}` : who?.name?.trim() || "";
  if (nameText) {
    const s = 112, ax = M, ay = 900;
    x.save(); x.beginPath(); x.roundRect(ax, ay, s, s, 26); x.clip();
    if (face) { const k = Math.max(s / face.width, s / face.height); x.drawImage(face, ax + (s - face.width * k) / 2, ay + (s - face.height * k) / 2, face.width * k, face.height * k); }
    else { x.fillStyle = "#2a2a2e"; x.fillRect(ax, ay, s, s); x.fillStyle = "#f4f4f4"; x.font = font(56, 700); x.textAlign = "center"; x.fillText(Array.from(nameText.replace(/^@/, ""))[0]?.toUpperCase() || "?", ax + s / 2, ay + s / 2 + 20); x.textAlign = "left"; }
    x.restore();
    x.fillStyle = "#f4f4f4"; fit(x, nameText, 76, 800, W * 0.5); x.fillText(nameText, ax + s + 30, ay + s / 2 + 26);
  }
  const fy = 1082;
  // A small globe, then the site (the invite link when there is a handle).
  x.strokeStyle = "#f4f4f4"; x.lineWidth = 3;
  x.beginPath(); x.arc(M + 16, fy - 11, 15, 0, Math.PI * 2); x.moveTo(M + 1, fy - 11); x.lineTo(M + 31, fy - 11);
  x.ellipse(M + 16, fy - 11, 7, 15, 0, 0, Math.PI * 2); x.stroke();
  x.fillStyle = "#f4f4f4"; x.font = font(34, 700);
  const site = who?.handle ? `blixvip.com/@${who.handle}` : "blixvip.com", sw = x.measureText(site).width;
  x.fillText(site, M + 46, fy);
  if (who?.handle && who.savePct) { x.font = font(34, 600); x.fillStyle = "rgba(255,255,255,0.85)"; x.fillText(`Save ${who.savePct}% off fees`, M + 46 + sw + 40, fy); }
}

// (Dark is off the list since 2026-10-10; it is still what a missing picture falls back to.)
const BGS: [Bg, string][] = [["eye", "Auto"], ["coin", "Coin"], ["own", "Your own"]];
// The person's picture, shrunk to the card's size (a phone photo would not fit in browser storage).
async function shrink(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const im = await img(url);
    if (!im) return null;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    cover(c.getContext("2d")!, im);
    return c.toDataURL("image/jpeg", 0.85);
  } finally { pics.delete(url); URL.revokeObjectURL(url); }
}

// The signed-in member's picture, name, @handle (server/handles.js) and the fee saving their invite link gives
// (the wallet service's referral terms), asked once per page load. Signed out: nothing, and the card leaves it off.
let whoAsk: Promise<Who> | null = null;
function useWho(open: boolean) {
  const me = useMe((s) => s.me);
  const [who, setWho] = useState<Who | null>(null);
  useEffect(() => {
    if (!open || !me?.signedIn) return;
    whoAsk ??= (async () => {
      const j = (path: string) => fetch(path, { signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const [h, e] = await Promise.all([j("api/account/handle"), j("api/account/referral")]);
      // discountBps: the share of the fee an invited trader is let off, in basis points (2000 = 20%).
      const savePct = e?.on && e.discountBps > 0 ? +(e.discountBps / 100).toFixed(1) : null;
      return { handle: h?.handle ?? null, savePct };
    })();
    let alive = true;
    void whoAsk.then((w) => { if (alive) setWho({ ...w, name: me.name, picture: me.picture }); });
    return () => { alive = false; };
  }, [open, me?.signedIn, me?.name, me?.picture]);
  return me?.signedIn ? who : null;
}

// The card window: the page behind it blurred, the card floating on its own, and under it, as plain text, the
// background choice, SOL or USD, the amount shown or not, copy and save.
export function PnlCardDialog({ data, open, onOpenChange }: { data: CardData | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ref = useRef<HTMLCanvasElement>(null), file = useRef<HTMLInputElement>(null);
  const [amounts, setAmountsState] = useState(() => store.get<boolean>("pnlcard:amounts", true));
  const [inUsd, setUsdState] = useState(() => store.get<boolean>("pnlcard:usd", false));
  const [bg, setBgState] = useState<Bg>(() => { const b = store.get<Bg>("pnlcard:bg", "eye"); return BGS.some(([k]) => k === b) ? b : "eye"; });
  const [own, setOwn] = useState<string | null>(() => store.get<string | null>(OWN_KEY, null));
  const setAmounts = (v: boolean) => { store.set("pnlcard:amounts", v); setAmountsState(v); };
  const setUsd = (v: boolean) => { store.set("pnlcard:usd", v); setUsdState(v); };
  const setBg = (v: Bg) => { store.set("pnlcard:bg", v); setBgState(v); };
  const [coinSrc, setCoinSrc] = useState<string | null>(null);
  const mint = data?.mint || "";
  useEffect(() => { if (!open || !mint) return; let alive = true; void coinPic(mint).then((im) => { if (alive) setCoinSrc(im?.src ?? null); }); return () => { alive = false; }; }, [open, mint]);
  // "Your own" asks for a picture the first time, and again when pressed while already chosen (to change it).
  const pick = (b: Bg) => { if (b === "own" && (!own || bg === "own")) file.current?.click(); else setBg(b); };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    const url = await shrink(f);
    if (!url) { toast("That picture couldn't be opened. Try a JPG or PNG."); return; }
    setOwn(url); store.set(OWN_KEY, url); setBg("own");
  };
  const who = useWho(open);
  const [ready, setReady] = useState(false);
  // Redrawn whenever what it shows changes (the position moves with every trade and price).
  const key = data ? `${data.kind}|${data.symbol}|${data.mode}|${pctText(data.pnlSol, data.baseSol)}|${solText(data.pnlSol)}|${data.solUsd ? usdText(data.pnlSol * data.solUsd) : ""}|${amounts}|${inUsd}|${bg}|${bg === "own" ? own?.length : ""}|${bg === "coin" ? coinSrc : ""}|${who?.handle}|${who?.name}|${who?.picture}|${who?.savePct}` : "";
  useEffect(() => { if (!open) setReady(false); }, [open]);
  useEffect(() => {
    if (!open || !data) return;
    let alive = true;
    // The canvas mounts with the window: one frame later it is there to draw on.
    const t = requestAnimationFrame(() => { if (ref.current) void drawCard(ref.current, data, { amounts, usd: inUsd, bg, own, who }).then(() => { if (alive) setReady(true); }); });
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
  const txt = (on: boolean) => cn("text-sm font-semibold transition-colors disabled:opacity-40", on ? "text-white" : "text-white/45 hover:text-white/80");
  const swatch: Record<Bg, string | undefined> = { eye: "brand/pnl-card-bg.webp", coin: coinSrc ?? undefined, dark: undefined, own: own ?? undefined };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/45 backdrop-blur-md" />
        <D.Content aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(42rem,calc(100vw-2rem),calc((100dvh-13rem)*1.47))] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-5">
          <D.Title className="sr-only">{data?.kind === "session" ? "Practice session card" : "PnL card"}</D.Title>
          <div className="relative w-full overflow-hidden rounded-[22px] bg-black shadow-[0_40px_90px_-24px_rgba(0,0,0,0.95)]" style={{ aspectRatio: `${W} / ${H}` }}>
            <canvas ref={ref} width={W} height={H} className={cn("block h-full w-full transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")} />
            {!ready && <span className="absolute inset-0 grid place-items-center text-sm text-muted">Drawing…</span>}
          </div>
          {/* Backgrounds */}
          <div role="radiogroup" aria-label="Background" className="flex items-start justify-center gap-4">
            {BGS.filter(([b]) => b !== "coin" || coinSrc).map(([b, label]) => (
              <button key={b} role="radio" aria-checked={bg === b} onClick={() => pick(b)} className="group flex flex-col items-center gap-1.5">
                <span className={cn("relative block h-10 w-[50px] overflow-hidden rounded-lg bg-[radial-gradient(circle_at_70%_30%,#1c1c1f,#000)] transition-[opacity,transform]",
                  bg === b ? "scale-110 opacity-100" : "opacity-50 group-hover:opacity-85")}>
                  {swatch[b] && <img src={swatch[b]} alt="" className={cn("absolute inset-0 size-full object-cover", b === "eye" && "object-[78%_50%]", b === "coin" && "scale-125 blur-[3px] brightness-75")} />}
                  {b === "own" && !own && <span className="absolute inset-0 grid place-items-center text-lg text-white/70">+</span>}
                </span>
                <span className={cn("text-[0.6875rem] font-semibold", bg === b ? "text-white" : "text-white/45 group-hover:text-white/80")}>{b === "own" && own && bg === "own" ? "Change" : label}</span>
              </button>
            ))}
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          <div className="flex w-full flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <span role="radiogroup" aria-label="Currency" className="flex items-center gap-2">
              <button role="radio" aria-checked={!inUsd} onClick={() => setUsd(false)} className={txt(!inUsd)}>SOL</button>
              <span className="text-white/25">/</span>
              <button role="radio" aria-checked={inUsd} onClick={() => setUsd(true)} disabled={!data?.solUsd} className={txt(inUsd)}>USD</button>
            </span>
            <button role="switch" aria-checked={amounts} onClick={() => setAmounts(!amounts)} className={txt(amounts)}>{amounts ? "Amount shown" : "Amount hidden"}</button>
            <button onClick={copyImg} disabled={!ready} className={cn(txt(false), "flex items-center gap-1.5")}><Icon.copy className="size-3.5" />Copy</button>
            <button onClick={save} disabled={!ready} className={cn(txt(true), "flex items-center gap-1.5")}><Icon.image className="size-3.5" />Save image</button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
