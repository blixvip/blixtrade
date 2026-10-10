// Coin logos: one loader for every picture of a coin on the page (Pulse rows, tables, the coin page).
//
// Logos the radar already has come in bulk: every picture that appears in the same moment is asked for in
// one /api/pics request (a browser sends only six requests at a time to this PC, so one by one they would
// trickle in over a couple of seconds). A coin the radar has no picture for yet is fetched there in the
// background; when it lands the radar says so on the live stream ("pic") and every picture of that coin
// loads it at once. Until then a miss is asked again one by one, quickly at first (new launches publish
// their picture within seconds), then rarely. What is known is shared by all the pictures of one coin and
// kept across scrolling.
import { useCallback, useSyncExternalStore } from "react";
import { apiUrl, fetchApi, onDirectLine, pageWord, sinceOpened } from "./api";
import { store } from "./utils";

interface Pic { ok: boolean; dead: boolean; tries: number; v: number; timer: number; data: string | null; batched: boolean }
const pics = new Map<string, Pic>();
const subs = new Map<string, Set<() => void>>();
const RETRY_MS = [700, 1500, 3000, 6000, 12_000, 30_000, 60_000];

const get = (mint: string) => {
  wanted(mint);
  let p = pics.get(mint);
  if (!p) {
    if (pics.size > 3000) for (const [k, x] of pics) if (!subs.get(k)?.size) { clearTimeout(x.timer); pics.delete(k); if (pics.size < 2000) break; }
    pics.set(mint, (p = { ok: false, dead: false, tries: 0, v: 0, timer: 0, data: null, batched: false }));
    ask(mint, p);
  }
  return p;
};
const emit = (mint: string) => subs.get(mint)?.forEach((f) => f());

// The logos of the list this page showed last time, asked for by index.html before the scripts had loaded (the
// list is kept below, per page): in hand by the time the rows draw, so they draw with their pictures.
if (typeof window !== "undefined") {
  (window as unknown as { __blixPics?: Promise<Record<string, string | null> | null> }).__blixPics?.then((got) => {
    for (const [mint, data] of Object.entries(got || {})) {
      if (!data) continue;
      const p = pics.get(mint);
      if (!p) pics.set(mint, { ok: false, dead: false, tries: 0, v: 0, timer: 0, data, batched: false });
      else if (!p.ok && !p.data && !p.v) { p.data = data; p.batched = false; emit(mint); }
    }
  }).catch(() => {});
}
// The logos a list page draws in its first moments (its rows) are the ones to have ready next time: kept per page,
// whether they had to be asked for or were already here.
let listed = new Set<string>(), listedFor = "", listing = 0;
function wanted(mint: string) {
  if (sinceOpened() > 3000 || listed.has(mint)) return;
  const word = pageWord();
  if (listedFor !== word) { listedFor = word; listed = new Set(); }
  if (listed.size >= 80 || location.hash.replace(/^#\/?/, "").split("?")[0].split("/")[1]) return;
  listed.add(mint);
  clearTimeout(listing);
  const list = listed;
  listing = window.setTimeout(() => { if (list.size >= 8) store.set(`warm:pics:${word}`, [...list]); }, 1500);
}
const again = (mint: string) => { const p = get(mint); p.v++; p.dead = false; emit(mint); };

// The bulk request: everything asked for in the same moment (one drawing pass) goes together, up to 100 at a time.
let queue: string[] = [], flushing = 0;
// On this PC the browser sends only six requests at a time to one name (HTTP/1.1), so logos go in one bulk
// request. Over the public address (HTTP/2, no such limit, and often a slow line) each logo is its own <img>:
// the browser fetches those after the page's data instead of alongside it, and keeps each one for a day.
const BULK = typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
function ask(mint: string, p: Pic) {
  if (!BULK) return;
  p.batched = true;
  queue.push(mint);
  // A short timer, not the next frame: a window that is covered or in the background draws about once a second.
  if (!flushing) flushing = window.setTimeout(flush, 4);
}
async function flush() {
  flushing = 0;
  const all = queue; queue = [];
  for (let i = 0; i < all.length; i += 100) {
    const part = all.slice(i, i + 100);
    let got: Record<string, string | null> = {};
    try {
      const r = await fetchApi(`api/pics?m=${part.join(",")}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) got = await r.json();
    } catch {}
    for (const mint of part) {
      const p = pics.get(mint);
      if (!p) continue;
      p.batched = false;
      if (got[mint] && !p.ok) p.data = got[mint];
      emit(mint);   // no data: the picture falls back to /img/<mint> and its retries
    }
  }
}

// The radar has the picture now (its "pic" event): load it everywhere, whatever the misses said. The event
// usually carries the picture itself (a data URL): then it is drawn from that, no request at all. A coin not
// on screen is kept too, so it draws with its picture the moment it appears.
export function picReady(mint: string, data?: string | null) {
  const p = pics.get(mint);
  if (!p) { if (data && pics.size < 3000) pics.set(mint, { ok: false, dead: false, tries: 0, v: 0, timer: 0, data, batched: false }); return; }
  if (p.ok) return;
  clearTimeout(p.timer); p.timer = 0; p.tries = 0; p.dead = false;
  if (data) { p.data = data; p.v = 0; p.batched = false; emit(mint); return; }
  again(mint);
}

// Logos that gave up are tried again when the tab is looked at again or the connection is back.
function reviveDead() { for (const [mint, p] of pics) if (p.dead && subs.get(mint)?.size) { clearTimeout(p.timer); p.timer = 0; p.tries = 0; again(mint); } }
if (typeof window !== "undefined") {
  window.addEventListener("online", reviveDead);
  window.addEventListener("focus", reviveDead);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reviveDead(); });
}

// Logos of rows not on screen yet (Discover's other tabs and windows): fetched now, quietly, so a tab opens with its
// pictures. Here, through the bulk request; over the public address into the browser's cache as the very .webp
// a row's <img> asks for. Not counted as the page's first logos (wanted).
const warmed = new Set<string>();
export function warmPics(mints: Iterable<string>) {
  if (typeof window === "undefined") return;
  for (const mint of mints) {
    if (!mint || warmed.has(mint) || pics.has(mint)) continue;
    if (warmed.size > 4000) warmed.clear();
    warmed.add(mint);
    if (BULK) { const p: Pic = { ok: false, dead: false, tries: 0, v: 0, timer: 0, data: null, batched: false }; pics.set(mint, p); ask(mint, p); continue; }
    const img = new Image();
    img.decoding = "async";
    (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = "low";
    img.src = onDirectLine() ? apiUrl(`img/${mint}.webp`) : `img/${mint}`;
  }
}

export function usePic(mint: string) {
  const subscribe = useCallback((fn: () => void) => {
    let set = subs.get(mint);
    if (!set) subs.set(mint, (set = new Set()));
    set.add(fn);
    const p = pics.get(mint);
    if (p?.dead && !p.timer && !document.hidden) { p.dead = false; p.v++; emit(mint); }
    return () => { set!.delete(fn); if (!set!.size) subs.delete(mint); };
  }, [mint]);
  useSyncExternalStore(subscribe, () => { const p = pics.get(mint); return p ? `${+p.ok}:${+p.dead}:${p.v}:${+p.batched}:${+!!p.data}:${+!!p.timer}` : ""; });
  const p = get(mint), v = p.v;
  return {
    // Waiting on the bulk answer: no <img> yet, so nothing queues behind it.
    // On blixvip.com the picture comes down the direct line as .webp, which Cloudflare keeps at the edge (lib/api.ts).
    src: p.batched || p.dead || p.timer ? null : p.data && !v ? p.data : onDirectLine() ? apiUrl(`img/${mint}.webp${v ? `?v=${v}` : ""}`) : `img/${mint}${v ? `?v=${v}` : ""}`,
    ok: p.ok,
    // A first try missed (or every try did): the caller may show another picture of the coin meanwhile.
    missed: !p.ok && (p.dead || p.tries > 0),
    key: `${mint}:${v}:${+!!p.data}`,   // a new attempt is a new <img>; loading one never remounts it
    onLoad: () => { if (!p.ok) { clearTimeout(p.timer); p.timer = 0; p.dead = false; p.ok = true; emit(mint); } },
    // Several pictures of one coin may miss together: the first one for this attempt schedules the next.
    onError: () => {
      if (p.ok || p.timer || p.v !== v) return;
      if (p.data && !v) { p.data = null; emit(mint); return; }
      const wait = RETRY_MS[p.tries++];
      // Out of quick tries: given up for now, and tried again in 5 minutes (a server restart or a slow line is
      // over by then), or as soon as the tab comes back into focus or the connection returns (below).
      if (wait == null) {
        p.dead = true; emit(mint);
        p.timer = window.setTimeout(() => {
          p.timer = 0;
          if (document.hidden || !subs.get(mint)?.size) return;
          p.tries = 0; again(mint);
        }, 5 * 60_000);
        return;
      }
      p.timer = window.setTimeout(() => {
        p.timer = 0;
        if (document.hidden || !subs.get(mint)?.size) { p.dead = true; emit(mint); return; }
        again(mint);
      }, wait);
      // Hide the failed URL while waiting: row remounts must not retry it ahead of the timer.
      emit(mint);
    },
  };
}
