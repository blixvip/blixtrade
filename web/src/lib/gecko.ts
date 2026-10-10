// GeckoTerminal's chart frames, kept and placed. An iframe reloads whenever it moves in the DOM, so the frames
// live in one fixed layer over the page and are only positioned over the chart's box: a coin's frame warmed on
// hover (lib/coin.ts prefetchCoin) is fully loaded by the time its page opens, and the frame of a coin you leave
// stays loaded for a while, so going back is instant. Up to FRAMES frames are kept, the least recently used
// let go. The embed's own footer line sits below the box's bottom edge, out of view.
// The candle size by the coin's age: the embed opens on a fixed number of bars (several hundred on a wide
// screen), so a size with fewer bars than that leaves the left of the chart empty. 1m until 36 hours (a day
// of 1m candles fills a wide screen), 5m until a week, 15m after.
export const geckoRes = (born?: number | null) => { const age = born && born > 0 ? Date.now() - born : Infinity; return age < 36 * 3600e3 ? "1m" : age < 7 * 86400e3 ? "5m" : "15m"; };
// Every chart's background (Blix's own and GeckoTerminal's, which takes it as bg_color): near black, darker than
// the panels around it, as Axiom draws its charts.
export const CHART_BG = "#08080a";
export const geckoUrl = (mint: string, born?: number | null) => `https://www.geckoterminal.com/solana/pools/${mint}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&chart_type=market_cap&resolution=${geckoRes(born)}&bg_color=${CHART_BG.slice(1)}`;

// 4 preloaded (preloadGecko: Discover's running day-old coins) + 4 for hover and coins recently left.
const FRAMES = 8;
const PRELOAD = 4;
const FOOT = 44;   // px of the embed below the box: its "Powered by" line

interface Frame { mint: string; wrap: HTMLDivElement; iframe: HTMLIFrameElement; at: number; shown: boolean; w: number; h: number; res: string; pre?: boolean }
const frames = new Map<string, Frame>();
// The chart box's last size: a frame warmed before its page opens is built at that size, so TradingView lays
// its bars out for the real width (a frame built small and then stretched kept the small layout and left the
// left half empty). Remembered per browser; a frame still off by more than a tenth is loaded again once.
let boxSize = { w: 1400, h: 700 };
try { const v = JSON.parse(localStorage.getItem("blix:gecko:box") || "null"); if (v && v.w > 300 && v.h > 200) boxSize = v; } catch {}
let host: HTMLDivElement | null = null, shown: Frame | null = null, anchor: HTMLElement | null = null, ro: ResizeObserver | null = null, raf = 0;

function hostEl() {
  if (!host) {
    host = document.createElement("div");
    host.id = "gecko-frames";
    host.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:1;pointer-events:none";
    host.appendChild(colorFilter());
    document.body.appendChild(host);
  }
  return host;
}

// Blix's candle colours on GeckoTerminal's chart. Its embed draws TradingView's own green and red (#089981, #f23645)
// and takes no colour settings, and the frame is another site's page, so its pixels are recoloured by an SVG filter:
// only the green and red ones (candles, volume bars, the price tags), which one colour matrix turns into
// --color-up and --color-down exactly. Everything else (background, grid, text, TradingView's blue and purple) is
// left as it is: a single matrix over the whole chart tinted them. Chrome does not run an SVG filter on a frame's
// own pixels (a filter: url() on the iframe is ignored), so it is the backdrop of a click-through layer laid over
// the frame. Where a browser cannot do that either, the chart keeps TradingView's colours.
const TV_UP = [0x08, 0x99, 0x81], TV_DOWN = [0xf2, 0x36, 0x45];
function rgbOf(cssVar: string, fallback: number[]): number[] {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    const c = document.createElement("canvas"); c.width = c.height = 1;
    const x = c.getContext("2d")!; x.fillStyle = "#000"; x.fillStyle = v || "#000"; x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return v ? [d[0], d[1], d[2]] : fallback;
  } catch { return fallback; }
}
// M with M·white = white, M·from[i] = to[i]: M = Y·X⁻¹, columns of X = white, from[0], from[1].
export function colorMatrix(from: number[][], to: number[][]): number[] | null {
  const col = (v: number[]) => v.map((n) => n / 255);
  const X = [[1, 1, 1], col(from[0]), col(from[1])], Y = [[1, 1, 1], col(to[0]), col(to[1])];   // as columns
  const a = (r: number, c: number) => X[c][r];
  const det = a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
  if (Math.abs(det) < 1e-6) return null;
  const inv = [
    [(a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) / det, (a(0, 2) * a(2, 1) - a(0, 1) * a(2, 2)) / det, (a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1)) / det],
    [(a(1, 2) * a(2, 0) - a(1, 0) * a(2, 2)) / det, (a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0)) / det, (a(0, 2) * a(1, 0) - a(0, 0) * a(1, 2)) / det],
    [(a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0)) / det, (a(0, 1) * a(2, 0) - a(0, 0) * a(2, 1)) / det, (a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0)) / det],
  ];
  const m: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) { let v = 0; for (let k = 0; k < 3; k++) v += Y[k][r] * inv[k][c]; m.push(+v.toFixed(5)); }
    m.push(0, 0);
  }
  return [...m, 0, 0, 0, 1, 0];
}
function colorFilter(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0";
  const m = colorMatrix([TV_UP, TV_DOWN], [rgbOf("--color-up", [0x38, 0xc7, 0x89]), rgbOf("--color-down", [0xf7, 0x52, 0x65])]);
  if (m) {
    const f = document.createElementNS(ns, "filter");
    f.id = "blix-tv-colors"; f.setAttribute("color-interpolation-filters", "sRGB");
    f.setAttribute("x", "0"); f.setAttribute("y", "0"); f.setAttribute("width", "100%"); f.setAttribute("height", "100%");
    const el = (tag: string, attrs: Record<string, string>) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); f.appendChild(e); };
    // The recoloured chart, right only where the pixel is TradingView's green or red (or one of them over the dark
    // background: volume bars, the edges of candles).
    el("feColorMatrix", { in: "SourceGraphic", type: "matrix", values: m.join(" "), result: "mapped" });
    // How green (G well above R and B) and how red (R well above G and B) each pixel is, as its alpha: 0 on greys,
    // blue and purple; 1 on the candles and on volume bars.
    el("feColorMatrix", { in: "SourceGraphic", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -5 10 -5 0 0", result: "green" });
    el("feColorMatrix", { in: "SourceGraphic", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  6 -3 -3 0 0", result: "red" });
    el("feComposite", { in: "green", in2: "red", operator: "arithmetic", k1: "0", k2: "1", k3: "1", k4: "0", result: "mask" });
    el("feComposite", { in: "mapped", in2: "mask", operator: "in", result: "candles" });
    el("feComposite", { in: "candles", in2: "SourceGraphic", operator: "over" });
    svg.appendChild(f);
  }
  return svg;
}
function make(mint: string, born?: number | null): Frame {
  const wrap = document.createElement("div");
  wrap.style.cssText = `position:fixed;left:-10000px;top:0;width:${boxSize.w}px;height:${boxSize.h}px;overflow:hidden;visibility:hidden;pointer-events:none;border-radius:8px;background:transparent`;
  const iframe = document.createElement("iframe");
  iframe.src = geckoUrl(mint, born);
  iframe.title = "GeckoTerminal chart";
  iframe.allow = "clipboard-write";
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  iframe.style.cssText = `border:0;display:block;width:100%;height:calc(100% + ${FOOT}px)`;
  wrap.appendChild(iframe);
  const tint = document.createElement("div");
  tint.style.cssText = "position:absolute;inset:0;pointer-events:none;backdrop-filter:url(#blix-tv-colors);-webkit-backdrop-filter:url(#blix-tv-colors)";
  wrap.appendChild(tint);
  hostEl().appendChild(wrap);
  const f: Frame = { mint, wrap, iframe, at: Date.now(), shown: false, w: boxSize.w, h: boxSize.h, res: geckoRes(born) };
  frames.set(mint, f);
  evict();
  return f;
}
function drop(f: Frame) { f.wrap.remove(); frames.delete(f.mint); }
function evict() {
  while (frames.size > FRAMES) {
    let old: Frame | null = null;
    for (const f of frames.values()) if (!f.shown && (!old || f.at < old.at)) old = f;
    if (!old) break;
    drop(old);
  }
}
// Start loading a coin's chart now (on hover, before its page opens).
export function warmGecko(mint: string, born?: number | null) {
  const f = frames.get(mint);
  if (f) { f.at = Date.now(); f.pre = false; return; }
  make(mint, born);
}
// Keep the charts of these coins loaded ahead of any hover (Discover: coins a day old or more that still trade and
// hold their cap). Called with the current picks each time the list refreshes: the first PRELOAD not loaded yet
// start one at a time, 1.5 s apart, so they never crowd the page's own requests; a preloaded frame whose coin
// left the picks is let go unless it is on screen or was hovered since.
let preTimer = 0, preQueue: { mint: string; born?: number | null }[] = [];
export function preloadGecko(coins: { mint: string; born?: number | null }[]) {
  const want = coins.slice(0, PRELOAD), keep = new Set(want.map((c) => c.mint));
  for (const f of [...frames.values()]) if (f.pre && !f.shown && !keep.has(f.mint)) drop(f);
  preQueue = want.filter((c) => !frames.has(c.mint));
  const next = () => {
    preTimer = 0;
    if (document.visibilityState !== "visible") { preTimer = window.setTimeout(next, 3000); return; }
    const c = preQueue.shift();
    if (!c) return;
    if (!frames.has(c.mint)) { const f = make(c.mint, c.born); f.pre = true; f.at = Date.now() - 60_000; }
    if (preQueue.length) preTimer = window.setTimeout(next, 1500);
  };
  if (!preTimer && preQueue.length) preTimer = window.setTimeout(next, 800);
}
function place() {
  if (!shown || !anchor) return;
  const r = anchor.getBoundingClientRect(), w = shown.wrap.style;
  w.left = `${r.left}px`; w.top = `${r.top}px`; w.width = `${r.width}px`; w.height = `${r.height}px`;
}
const onMove = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); };
// Show the coin's chart over `el` (loaded already if it was warmed), following it as the page scrolls or resizes.
export function mountGecko(mint: string, el: HTMLElement, born?: number | null) {
  unmountGecko();
  const r0 = el.getBoundingClientRect();
  if (r0.width > 300 && r0.height > 200 && (Math.abs(r0.width - boxSize.w) > 8 || Math.abs(r0.height - boxSize.h) > 8)) { boxSize = { w: Math.round(r0.width), h: Math.round(r0.height) }; try { localStorage.setItem("blix:gecko:box", JSON.stringify(boxSize)); } catch {} }
  const f = frames.get(mint) || make(mint, born);
  // Built for a different size (an earlier layout, a resized window) or candle size: loaded again, once.
  const res = geckoRes(born);
  if (Math.abs(f.w - boxSize.w) > boxSize.w * 0.1 || Math.abs(f.h - boxSize.h) > boxSize.h * 0.1 || f.res !== res) { f.w = boxSize.w; f.h = boxSize.h; f.res = res; f.iframe.src = geckoUrl(mint, born); }
  f.at = Date.now(); f.shown = true; shown = f; anchor = el;
  f.wrap.style.visibility = "visible"; f.wrap.style.pointerEvents = "auto";
  place();
  ro = new ResizeObserver(onMove); ro.observe(el);
  addEventListener("scroll", onMove, { capture: true, passive: true });
  addEventListener("resize", onMove);
}
export function unmountGecko() {
  if (shown) { shown.shown = false; shown.wrap.style.visibility = "hidden"; shown.wrap.style.pointerEvents = "none"; shown.wrap.style.left = "-10000px"; shown = null; }
  anchor = null;
  ro?.disconnect(); ro = null;
  removeEventListener("scroll", onMove, { capture: true });
  removeEventListener("resize", onMove);
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}
