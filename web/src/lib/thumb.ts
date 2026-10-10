// Pictures from elsewhere (X and Fomo avatars, clan icons, pump.fun profile pictures, a post's photo) come at
// their original size, often 200-500 KB for a 16-40 px circle. The ones on the hosts Blix knows are asked for
// from Blix itself (/api/pic, server/pagepics.js), which gets each once at twice the size it is drawn, as WebP,
// keeps it, and answers in milliseconds from then on; the browser keeps it a day. Anything else goes through
// wsrv.nl, the open image resizer, the same way. If a picture cannot be read either way, main.tsx puts the
// original back (data-orig).
import { apiUrl, onDirectLine, pageWord, sinceOpened } from "./api";
import { store } from "./utils";

const RESIZER = "https://wsrv.nl/";
// Blix's own picture address, relative or on the direct line: /api/pic?… or …/api/pic.webp?…
const PIC = /\/api\/pic(\.webp)?\?/;
// The hosts the server fetches from (server/pagepics.js HOSTS): the same list.
const VIA_BLIX = /(^|\.)(s3\.amazonaws\.com|twimg\.com|mobula\.io|pump\.fun|mypinata\.cloud|pinata\.cloud|ipfs\.io|dweb\.link|dexscreener\.com|axiom-cdn\.io|fomo\.family|arweave\.net|cloudfront\.net|googleusercontent\.com|imgur\.com|discordapp\.com|discord\.com)$/i;
// Hosts the resizer refuses ("Domain or TLD blocked by policy", checked 2026-10-06): asking would cost a failed
// request of up to 7 s before the fallback, so these go straight to the original.
const REFUSED = /(^|\.)pump\.fun$|\.xyz$/i;

export function thumb(src: string | null | undefined, px: number, opts: { fit?: "cover" | "inside" } = {}): string | undefined {
  if (!src) return undefined;
  if (!/^https?:\/\//i.test(src) || src.startsWith(RESIZER) || PIC.test(src) || /\.svg(\?|$)/i.test(src)) return src;
  const w = Math.min(2000, Math.round(px * 2));
  const fit = opts.fit || "cover";
  let host = "";
  try { host = new URL(src).hostname; } catch { return src; }
  // On blixvip.com straight to the server (apiUrl, the direct line) under an address with an image extension, so
  // Cloudflare keeps each picture at the edge for everyone; through the Worker it was neither fast nor kept.
  if (VIA_BLIX.test(host) && src.startsWith("https://")) return `${onDirectLine() ? apiUrl("api/pic.webp") : "/api/pic"}?u=${encodeURIComponent(src)}&w=${w}&fit=${fit}`;
  if (REFUSED.test(host)) return src;
  return `${RESIZER}?url=${encodeURIComponent(src)}&w=${w}${fit === "cover" ? `&h=${w}` : ""}&fit=${fit}&output=webp&q=80&n=-1`;
}

// The original behind a resized address, for the error fallback.
export function original(src: string): string | null {
  const q = src.startsWith(RESIZER) ? "url" : PIC.test(src) ? "u" : null;
  if (!q) return null;
  try { return new URL(src, location.origin).searchParams.get(q); } catch { return null; }
}

// ---------- people's pictures, ready before they are drawn ----------
// Every picture address that has loaded in this tab: a picture drawn again (a row re-drawn, the page opened again)
// shows at once instead of fading in (pages/traders/parts.tsx Avatar).
export const loadedPics = new Set<string>();
// Load pictures ahead of being drawn ([original, px drawn at]): into the browser's cache (the server keeps them a
// week, immutable) and decoded, so the row that draws one has it on its first frame. Six at a time on this PC
// (the browser's limit to one name here; the page's data must not wait behind them), more on the direct line.
let preQueue: string[] = [], preFlying = 0;
const queued = new Set<string>();
export function preloadPics(list: [string | null | undefined, number][]) {
  for (const [src, px] of list) {
    const url = thumb(src, px);
    if (!url || loadedPics.has(url) || queued.has(url)) continue;
    queued.add(url); preQueue.push(url);
  }
  if (preQueue.length > 400) preQueue = preQueue.slice(0, 400);
  const most = onDirectLine() ? 16 : 6;
  while (preFlying < most && preQueue.length) {
    const url = preQueue.shift()!;
    preFlying++;
    const img = new Image();
    img.decoding = "async";
    const done = () => { queued.delete(url); preFlying--; preloadPics([]); };
    img.onload = () => { img.decode().catch(() => {}).finally(() => { loadedPics.add(url); done(); }); };
    img.onerror = done;
    img.src = url;
  }
}

// The faces a page draws in its first moments, kept per page ("warm:faces:<page>"), to be loaded ahead the next
// time: by index.html as the page opens, on idle (main.tsx) and when the pointer rests on a link to it (lib/coin.ts).
let faces: [string, number][] = [], facesFor = "", facesTimer = 0;
export function noteFace(src: string, px: number) {
  if (sinceOpened() > 3000) return;
  const word = pageWord();
  if (facesFor !== word) { facesFor = word; faces = []; }
  if (faces.length >= 60 || faces.some(([s, p]) => s === src && p === px)) return;
  faces.push([src, px]);
  clearTimeout(facesTimer);
  const list = faces, url = (x: [string, number]) => thumb(x[0], x[1]);
  facesTimer = window.setTimeout(() => { if (list.length >= 4) store.set(`warm:faces:${word}`, list.map(url).filter(Boolean)); }, 1500);
}
// The kept addresses (already resized) for a page, loaded ahead.
export function preloadFaces(word: string) {
  const urls = store.get<string[]>(`warm:faces:${word || "home"}`, []);
  if (Array.isArray(urls)) preloadPics(urls.filter((u) => typeof u === "string").map((u) => [u, 0] as [string, number]));
}
