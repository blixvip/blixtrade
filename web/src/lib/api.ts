// The radar's HTTP API (docs/API.md). Same contract as the classic page: errors are { error: "sentence" }.
//
// Reads go through the page server, which keeps the last answer to each (server/apicache.js). When the radar takes
// more than a moment, or is restarting, that kept answer comes back at once, marked with its age. `apiAged` hands
// it over as it is, for readers that ask again anyway (usePoll, the chart's first frame). `api` asks again until
// the radar's own answer is there, and settles for the kept one only if the radar stays silent.
import { store } from "./utils";

export interface Aged<T> { data: T; age: number }   // age: ms the answer waited in the page server; 0 = the radar's own, just now

// ---------- answers asked for before this code had loaded ----------
// index.html starts the page's usual reads the moment it is parsed (the list below, remembered per page), so they
// are under way while the scripts load. Each is used once, by the first reader of that path, while it is new.
type Early = Aged<unknown> & { t: number };
const early: Record<string, Promise<Early | null> | Early> = (typeof window !== "undefined" && (window as unknown as { __blixWarm?: Record<string, Promise<Early | null> | Early> }).__blixWarm) || {};
const NEW_MS = 3000;
async function takeEarly<T>(path: string): Promise<Aged<T> | null> {
  const w = early[path];
  if (!w) return null;
  delete early[path];
  const got = await w;
  return got && performance.now() - got.t < NEW_MS ? { data: got.data as T, age: got.age } : null;
}
// main.tsx draws the first frame with these answers rather than a moment before them (a page drawn first as a
// skeleton and again with its data). They have usually arrived while the scripts were running and are only
// handed over once the main thread is free, so: a few turns of the event loop for those, then whatever is left
// of `ms` since index.html asked for any still on their way.
// Only the ones the page itself is drawn from are waited for: on a coin's or trader's page the reads about that
// coin or trader, elsewhere all but the ones behind the bars around the page (prices, the paper wallet, the X
// ticker). Candles never: the chart draws them itself the moment they are there.
const AROUND = /^(market|paper|x$|x\?|journal|health)/;
export async function earlyReady(ms: number): Promise<void> {
  let logos = (window as unknown as { __blixPics?: Promise<unknown> }).__blixPics || null;
  logos?.then(() => { logos = null; }, () => { logos = null; });
  const [word, arg] = here();
  const drawnFrom = (path: string) => !path.startsWith("candles/") && (arg ? path.includes(arg) : !AROUND.test(path) && (path !== "pulse" || !word));
  const waiting = () => { const w: Promise<unknown>[] = Object.entries(early).filter(([path, x]) => x instanceof Promise && drawnFrom(path)).map(([, x]) => x as Promise<unknown>); if (logos) w.push(logos); return w; };
  const turn = () => new Promise<void>((ok) => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); ok(); }; c.port2.postMessage(0); });
  for (let i = 0; i < 12 && waiting().length; i++) await turn();
  const left = ms - (performance.now() - (performance.getEntriesByName("blix:html")[0]?.startTime ?? -Infinity));
  if (waiting().length && left > 0) await Promise.race([Promise.all(waiting()), new Promise((ok) => setTimeout(ok, left))]);
}
// One that has already arrived, without taking it: a view can draw with it on its first frame.
export function earlyData<T>(path: string): T | undefined {
  const w = early[path];
  return w && !(w instanceof Promise) && performance.now() - w.t < NEW_MS ? (w.data as T) : undefined;
}

// The reads each page makes in its first moments, remembered per page (the first word of its address). A coin's
// or trader's own address in a path is kept as {m}: the list is the same whichever one is open.
const NOT_AHEAD = /^(quote|me$|settings|alerts|export|backup|import|remote-link|account|pics|test-|paper\/\d|brief$)|[?&](since|fresh)=/;
const here = () => location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
let navAt = typeof performance !== "undefined" ? performance.now() : 0, seen: string[] = [], saver = 0;
if (typeof window !== "undefined") addEventListener("hashchange", () => { navAt = performance.now(); seen = []; });
// The page on screen (the first word of its address, "home" for Pulse) and how long ago it was opened.
export const pageWord = () => here()[0] || "home";
export const sinceOpened = () => performance.now() - navAt;
function noteRead(path: string) {
  if (performance.now() - navAt > 2500 || path.length > 300 || seen.length >= 16 || NOT_AHEAD.test(path)) return;
  const [route, arg] = here();
  const p = arg && arg.length >= 3 && path.includes(arg) ? path.split(arg).join("{m}") : path;
  if (seen.includes(p)) return;
  seen.push(p);
  clearTimeout(saver);
  const key = `warm:${route || "home"}`, list = seen;
  saver = window.setTimeout(() => store.set(key, list), 3000);
}

// `since`: how long ago (ms) this reader was handed a kept answer for the same path. Whatever the radar has
// answered since then is new to it, so the page server sends that without asking the radar again.
// `kept`: the oldest kept answer (ms) this reader will take at once (a page about to open; it asks again anyway).
// Both hints go as query parameters (_k, _f), not headers: a header of our own on the direct line costs an OPTIONS
// trip before each new address (server/webapp.js liftHints takes them off again).
// A replay (lib/replay.ts) answers the replayed coin's reads itself, or reshapes the server's answer to the
// replay clock's moment. Set once by that file; null otherwise.
// `wait`: not answerable yet (a replay still loading): the read waits for it, then asks the hook again.
export type ReadHook = (path: string, init?: RequestInit) => { data: unknown } | { transform: (d: unknown) => unknown } | { wait: Promise<unknown> } | undefined;
let readHook: ReadHook | null = null;
export const setReadHook = (fn: ReadHook) => { readHook = fn; };

async function read<T>(path: string, init: RequestInit | undefined, since: number, note = true, kept = 0): Promise<Aged<T>> {
  let hooked = readHook?.(path, init);
  if (hooked && "wait" in hooked) { await hooked.wait.catch(() => {}); hooked = readHook?.(path, init); if (hooked && "wait" in hooked) hooked = undefined; }
  if (hooked && "data" in hooked) return { data: hooked.data as T, age: 0 };
  if (hooked) { const r = await plainRead<T>(path, init, since, note, kept); return { data: hooked.transform(r.data) as T, age: r.age }; }
  return plainRead<T>(path, init, since, note, kept);
}
async function plainRead<T>(path: string, init: RequestInit | undefined, since: number, note = true, kept = 0): Promise<Aged<T>> {
  let hint = "";
  if (!init?.method) {
    if (note) noteRead(path);
    const first = since > 0 ? null : await takeEarly<T>(path);
    if (first && !init?.signal?.aborted) return first;
    if (since > 0) hint = `_f=${Math.ceil(since)}`;
    else if (kept > 0) hint = `_k=${Math.round(kept)}`;
  }
  const r = await fetchApi(`api/${path}${hint ? (path.includes("?") ? "&" : "?") + hint : ""}`, { signal: AbortSignal.timeout(init?.method ? 120_000 : 20_000), ...init });
  const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(body.error || String(r.status));
  const age = Number(r.headers.get("x-blix-age")) || 0;
  if (!age) radarAt = performance.now();
  return { data: body as T, age };
}
let radarAt = -Infinity;   // when the radar itself last answered a read

// `note` false: a read made ahead of time for another page, which is not one of this page's own.
export const apiAged = <T = unknown>(path: string, init?: RequestInit, since = 0, note = true, kept = 0) => read<T>(path, init, since, note, kept);

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let r = await read<T>(path, init, 0);
  // A kept answer: the radar's own is on its way, and the page server sends it the moment it has it. Asked for
  // again every 150 ms for up to 8 s; after that the kept one has to do.
  for (let t0 = performance.now(), got = t0; r.age > 0 && performance.now() - t0 < 8000 && !init?.signal?.aborted;) {
    await new Promise((ok) => setTimeout(ok, 150));
    try { r = await read<T>(path, init, performance.now() - got); } catch { break; }
    got = performance.now();
  }
  return r.data;
}

export const post = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

// ---------- the direct line (blixvip.com) ----------
// On blixvip.com the page's own address is a Cloudflare Worker that forwards each request to the server: one more
// hop every time, and one Worker request per read (the free plan stops at 100 k a day, which a single open coin
// page uses up by itself at two reads a second). So on the public site reads and streams go straight to the
// server's own address (origin.blixvip.com, the named tunnel). The Worker sets a signed member cookie for the
// whole domain when it serves the page (blix_m, worker/index.js), and the server lets the page in on it
// (server/webapp.js). Sign-in, the page and its files still come through the Worker. If the direct line cannot be
// reached or does not know this browser (401 with x-blix-direct: no), everything goes back through the Worker
// for the rest of this visit, so nothing is worse than before.
const PUBLIC = typeof location !== "undefined" && /^(www\.|trade\.)?blixvip\.com$/.test(location.hostname);
let direct: string | null = PUBLIC ? "https://origin.blixvip.com/" : null;
let directStreams = Boolean(direct);
export const onDirectLine = () => Boolean(direct);
// A path like "api/pulse" as the address to ask, and the options a fetch of it needs (the cookie goes along only
// when asked for across origins).
export const apiUrl = (path: string) => (direct ? direct + path.replace(/^\//, "") : path);
export const apiInit = (init?: RequestInit): RequestInit => (direct ? { credentials: "include", ...(init || {}) } : init || {});
const refused = (r: Response) => r.status === 401 && r.headers.get("x-blix-direct") === "no";
// The direct line is no good for this visit: back through the Worker. True the first time, so the caller asks again.
export function directFailed() { if (!direct) return false; direct = null; directStreams = false; return true; }
// fetch for anything under api/: on the direct line when there is one, and once more through the page's own
// address if that line fails to connect (a network or CORS error) or turns this browser away.
export async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  // Writes require the edge's fresh membership check and must never retry on an ambiguous network failure.
  if (PUBLIC && !['GET', 'HEAD', 'OPTIONS'].includes((init?.method || 'GET').toUpperCase())) return fetch(path, init);
  const used = direct;
  try {
    const r = await fetch(apiUrl(path), apiInit(init));
    if (used && refused(r) && directFailed()) return fetch(apiUrl(path), apiInit(init));
    return r;
  } catch (e) {
    if (used && e instanceof TypeError && directFailed()) return fetch(apiUrl(path), apiInit(init));
    throw e;
  }
}

// ---------- live streams ----------
// A stream (EventSource) is opened on this PC's other name: localhost <-> 127.0.0.1. A browser sends only six
// requests at a time to one name and a stream holds one of them for as long as its tab is open, so with a few
// tabs open nothing else got through (reads sat 5-12 s in the browser's queue, 2026-10-06). The page server lets
// our own page on the other name read them (server/webapp.js otherName). On blixvip.com a stream goes down the
// direct line (above, with the cookie); anywhere else it uses the page's own address.
let otherName = typeof location !== "undefined" && location.protocol === "http:" && Boolean(location.port) && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
export const streamUrl = (path: string) => (otherName ? `http://${location.hostname === "localhost" ? "127.0.0.1" : "localhost"}:${location.port}/${path.replace(/^\//, "")}` : directStreams && direct ? direct + path.replace(/^\//, "") : path);
export const streamInit = (): EventSourceInit | undefined => (directStreams && direct && !otherName ? { withCredentials: true } : undefined);
// A stream failed before it ever opened. If the radar is answering reads (so it is not simply restarting), the
// address is the problem: on this PC the other name, on blixvip.com the direct line (streams only; reads that are
// being answered stay on it). Streams use the page's own address from here on, and this returns true so the
// caller opens its stream again at once. Otherwise false: keep trying as usual.
export function streamFailed() {
  if (performance.now() - radarAt > 3000) return false;
  if (otherName) { otherName = false; return true; }
  if (directStreams) { directStreams = false; return true; }
  return false;
}
