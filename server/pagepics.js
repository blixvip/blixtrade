// Coin pictures the radar already has on disk (data/img, images.js), answered by the page server.
//
// A picture request used to cross to the radar and wait its turn on the radar's one thread: 0.4-2.4 s each when
// measured (2026-10-06), and a browser sends only six requests at a time to this PC, so a screen of logos held
// every chart and list answer behind it for seconds. The files are plain files, so the page server reads them
// itself and keeps the recent ones in memory. The radar is still the only one that fetches a picture: one that is
// not on disk yet is answered "not yet" at once (the page asks again, and is told on the live stream when it
// lands: lib/pics.ts), and the radar is asked in the background to go and get it.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPublic } from "./netguard.js";

// The same folder as db.js's DATA (not imported: that would open the radar's database in this process).
const DIR = path.join(process.env.RADAR_DATA ? path.resolve(process.env.RADAR_DATA) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data"), "img");
const TYPE = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", gif: "image/gif", avif: "image/avif" };
const EXTS = Object.keys(TYPE);   // images.js saves <mint>.<one of these>, through a .tmp name that never matches
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const INLINE_MAX = 36_000;        // as images.js: a larger file is not sent inside the bulk answer
const BIG_KEEP_MS = 60_000;       // a large one is being shrunk by the radar: look at the disk again after this
const MEM_MAX = 96e6;
const now = () => Date.now();
export const picStats = { served: 0, bulk: 0, inMemory: 0, missing: 0, asked: 0, waited: 0 };

const mem = new Map();    // mint -> { type, size, body | url, t }, the least recently used first
let memBytes = 0;
const lastExt = new Map();   // mint -> the extension it was last found under, tried first
function keep(mint, pic) {
  const old = mem.get(mint);
  if (old) { memBytes -= old.size; mem.delete(mint); }
  mem.set(mint, pic); memBytes += pic.size;
  for (const [k, v] of mem) { if (memBytes <= MEM_MAX) break; memBytes -= v.size; mem.delete(k); }
  picStats.inMemory = mem.size;
}

// { type, size, body (large) | url (small, a data URL) } for a coin's picture, or null when it is not on disk.
async function load(mint) {
  const hit = mem.get(mint);
  if (hit && (hit.url || now() - hit.t < BIG_KEEP_MS)) { mem.delete(mint); mem.set(mint, hit); return hit; }
  const first = lastExt.get(mint);
  for (const ext of first ? [first, ...EXTS.filter((e) => e !== first)] : EXTS) {
    let body;
    try { body = await fs.promises.readFile(path.join(DIR, `${mint}.${ext}`)); } catch { continue; }
    if (!body.length) continue;
    const type = TYPE[ext], small = body.length <= INLINE_MAX;
    const pic = small ? { type, size: body.length, url: `data:${type};base64,${body.toString("base64")}`, t: now() } : { type, size: body.length, body, t: now() };
    if (lastExt.size > 200_000) lastExt.clear();
    lastExt.set(mint, ext);
    keep(mint, pic);
    return pic;
  }
  if (hit) { memBytes -= hit.size; mem.delete(mint); }
  lastExt.delete(mint);
  return null;
}

// Tell the radar which pictures the page wants and does not have (it fetches them and says so on the live
// stream), or has but too large (it fetches a small one). Together, a moment later; each coin at most every
// `everyMs`, and the radar spaces its own attempts beyond that (images.js retryAfter).
const askedAt = new Map();
let wanted = new Set(), timer = null;
function askRadar(mint, port, everyMs) {
  const t = now();
  if (t - (askedAt.get(mint) || 0) < everyMs) return;
  if (askedAt.size > 50_000) askedAt.clear();
  askedAt.set(mint, t);
  wanted.add(mint);
  timer ||= setTimeout(() => {
    const all = [...wanted]; wanted = new Set(); timer = null;
    for (let i = 0; i < all.length; i += 100) {
      picStats.asked++;
      http.get({ host: "127.0.0.1", port, path: `/api/pics?m=${all.slice(i, i + 100).join(",")}`, headers: { host: `localhost:${port}`, "accept-encoding": "identity" } }, (r) => r.resume())
        .on("error", () => {}).setTimeout(20_000, function () { this.destroy(); });
    }
  }, 25);
}

// A picture that is not on disk yet, asked for on the direct line (/img/<mint>.webp, over HTTP/2, where a held
// request costs the browser nothing): the request waits up to WAIT_MS for the radar to land it and answers the
// picture in one go, instead of 404 and the page's retries, each a round trip through Cloudflare (~0.3 s) and
// a wait of 0.7 s, 1.5 s, 3 s... between them. The folder is watched (one fs.watch): the radar writes <mint>.tmp
// and renames it, so the rename for the final name is the moment it is there. On localhost (HTTP/1.1, six
// connections to one host) a miss is still a 404 at once: a held request there holds a list's data behind it.
const WAIT_MS = 2500, WAITERS_MAX = 300;
const landed = new Map();   // mint -> Set of the waiting requests' resolvers
let waiters = 0, watcher = null;
function watchDir() {
  if (watcher) return true;
  try {
    watcher = fs.watch(DIR, (_ev, name) => {
      const file = String(name || "");
      if (!file || file.endsWith(".tmp")) return;
      const set = landed.get(file.split(".")[0]);
      if (set) for (const ok of [...set]) ok(true);
    });
    watcher.on("error", () => { try { watcher?.close(); } catch {} watcher = null; });
    return true;
  } catch { watcher = null; return false; }
}
function untilLanded(mint, ms) {
  if (waiters >= WAITERS_MAX || !watchDir()) return Promise.resolve(false);
  waiters++;
  picStats.waited++;
  return new Promise((ok) => {
    let set = landed.get(mint);
    if (!set) landed.set(mint, (set = new Set()));
    const done = (found) => {
      clearTimeout(t); set.delete(done);
      if (!set.size && landed.get(mint) === set) landed.delete(mint);
      waiters--; ok(found);
    };
    set.add(done);
    const t = setTimeout(done, ms, false);
  });
}

// GET /img/<mint>: the file, or 404 at once (nothing waits behind a picture that is still being fetched);
// /img/<mint>.webp (the direct line): the file, waiting a moment for one the radar is fetching (above).
export async function servePicture(mint, req, res, port, wait = false) {
  let pic = MINT.test(mint) ? await load(mint) : null;
  if (!pic && MINT.test(mint)) {
    askRadar(mint, port, 1500);
    if (wait && await untilLanded(mint, WAIT_MS) && !res.destroyed) pic = await load(mint);
  }
  if (res.destroyed) return;
  if (!pic) {
    picStats.missing++;
    res.writeHead(404, { "cache-control": "no-store" });
    return res.end();
  }
  if (pic.body) askRadar(mint, port, 10 * 60_000);
  const body = pic.body || Buffer.from(pic.url.slice(pic.url.indexOf(",") + 1), "base64");
  picStats.served++;
  // A month in the browser and at Cloudflare's edge, and a week more served while it is checked again: a logo
  // hardly ever changes, and a miss the page retries carries ?v=, a different address.
  res.writeHead(200, { "content-type": pic.type, "content-length": body.length, "cache-control": "public, max-age=2592000, stale-while-revalidate=604800", "x-content-type-options": "nosniff" });
  res.end(req.method === "HEAD" ? undefined : body);
}

// GET /api/pics?m=<mint>,<mint>,...  ->  { mint: data URL | null }, as images.js batch(). `complete`: every one
// asked for was there, so the browser may keep the answer for a while.
export async function pictureBatch(list, port) {
  const out = {};
  let complete = true;
  await Promise.all([...new Set(list)].filter((m) => MINT.test(m)).slice(0, 120).map(async (mint) => {
    const pic = await load(mint);
    out[mint] = pic?.url || null;
    if (pic?.url) return;
    complete = false;
    askRadar(mint, port, pic ? 10 * 60_000 : 1500);
  }));
  picStats.bulk++;
  return { out, complete };
}

// ---------- pictures from elsewhere ----------
// People's avatars (Fomo's S3 bucket, pump.fun, X), clan icons, coin logos Fomo lists carry and posts' photos
// used to be loaded by the browser from wherever they live, resized on the way by wsrv.nl (lib/thumb.ts): a
// second or so each, every visit, and some hosts refuse. GET /api/pic?u=<address>&w=<px>&fit=cover|inside gets
// each once, at that size, keeps it under data/people (hot ones in memory), and answers in a few milliseconds
// from then on, for everyone. Only the hosts those pictures live on are fetched from; what comes back must be an
// image.
const PEOPLE = path.join(path.dirname(DIR), "people");
fs.mkdirSync(PEOPLE, { recursive: true });
const HOSTS = /(^|\.)(s3\.amazonaws\.com|twimg\.com|mobula\.io|pump\.fun|mypinata\.cloud|pinata\.cloud|ipfs\.io|dweb\.link|dexscreener\.com|axiom-cdn\.io|fomo\.family|arweave\.net|cloudfront\.net|googleusercontent\.com|imgur\.com|discordapp\.com|discord\.com)$/i;
// wsrv.nl refuses some hosts outright ("Domain or TLD blocked by policy"), after up to 7 s: those are fetched as they are.
const NO_RESIZE = /(^|\.)(pump\.fun|[^.]+\.xyz)$/i;
const SIZES = [32, 48, 64, 96, 128, 192, 256, 384, 640, 1280];
const PIC_MAX = 3_000_000, FETCH_MS = 12_000, MISS_MS = 10 * 60_000, RETRY_MS = 20_000;
const TYPE_OF = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const missed = new Map();     // key -> when the last try failed
const fetching = new Map();   // key -> promise
export const farStats = { served: 0, fetched: 0, missing: 0, inMemory: 0 };

function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.toString("latin1", 0, 3) === "GIF") return "image/gif";
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("latin1", 4, 12) === "ftypavif") return "image/avif";
  return null;
}
// Redirects are followed by hand, and every hop must be a public https address (netguard.js): a picture
// host anyone can upload to (S3, imgur, Discord) must not be able to bounce this server onto itself or the
// network it is on.
async function grab(url, ms) {
  for (let hop = 0; hop < 4; hop++) {
    const r = await fetchPublic(url, { httpsOnly: true, timeout: ms, maxBytes: PIC_MAX, headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5" } });
    if (r.status >= 300 && r.status < 400) { const to = r.headers.get("location"); if (!to) return null; url = new URL(to, url).href; continue; }
    if (r.status === 429 || r.status >= 500) throw new Error(`busy ${r.status}`);   // a passing failure: thrown, so it is tried again soon
    if (!r.ok || +r.headers.get("content-length") > PIC_MAX) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > PIC_MAX) return null;
    const type = sniff(buf);
    return type ? { buf, type } : null;
  }
  return null;
}

// data/people grows with every new picture asked for (up to 3 MB each): past PEOPLE_MAX bytes the oldest go,
// in the background, checked once a minute at most.
const PEOPLE_MAX = 2e9;
let peopleBytes = -1, pruning = false, prunedAt = 0;
async function prunePeople(added) {
  if (peopleBytes >= 0) peopleBytes += added;
  if (pruning || now() - prunedAt < 60_000) return;
  pruning = true; prunedAt = now();
  try {
    const names = await fs.promises.readdir(PEOPLE);
    const files = [];
    for (const n of names) { try { const st = await fs.promises.stat(path.join(PEOPLE, n)); if (st.isFile()) files.push({ n, size: st.size, t: st.mtimeMs }); } catch {} }
    peopleBytes = files.reduce((s, f) => s + f.size, 0);
    if (peopleBytes <= PEOPLE_MAX) return;
    files.sort((a, b) => a.t - b.t);
    for (const f of files) {
      if (peopleBytes <= PEOPLE_MAX * 0.9) break;
      try { await fs.promises.unlink(path.join(PEOPLE, f.n)); peopleBytes -= f.size; } catch {}
    }
  } catch {} finally { pruning = false; }
}
// The picture at the asked size, a few KB of WebP: pump.fun's own pictures through pump.fun's image resizer (its
// Next.js /_next/image, which only takes its own sizes; wsrv.nl refuses pump.fun outright, and pump.fun profile
// pictures are 300 KB+ originals), the rest through wsrv.nl; else the original as it is.
const NEXT_SIZES = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920];
const PUMP = /(^|.)pump.fun$/i;
// An IPFS picture through Pinata's gateways first: ipfs.io and dweb.link answer this server 429 (rate limited,
// 2026-10-08), so Feed pictures on them were 404s. The original address is the last try.
const IPFS_GATEWAYS = ["https://pump.mypinata.cloud/ipfs/", "https://gateway.pinata.cloud/ipfs/"];
async function fetchFar(url, w, fit) {
  const cid = /^https:\/\/[^/]+\/ipfs\/([A-Za-z0-9]{40,}[^?#]*)/.exec(url)?.[1];
  if (cid) {
    for (const g of IPFS_GATEWAYS) if (!url.startsWith(g)) { const got = await fetchOne(g + cid, w, fit); if (got && got !== TRANSIENT) return got; }
  }
  return fetchOne(url, w, fit);
}
// TRANSIENT: every try failed for a passing reason (a timeout, a 429, a 5xx): asked again after RETRY_MS, not MISS_MS.
const TRANSIENT = Symbol("transient");
async function fetchOne(url, w, fit) {
  const host = new URL(url).hostname;
  let passing = false;
  if (PUMP.test(host)) {
    const nw = NEXT_SIZES.find((s) => s >= w) || 1920;
    try { const got = await grab(`https://pump.fun/_next/image?url=${encodeURIComponent(url)}&w=${nw}&q=75`, FETCH_MS); if (got) return got; } catch { passing = true; }
  } else if (!NO_RESIZE.test(host)) {
    const sized = `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}${fit === "cover" ? `&h=${w}` : ""}&fit=${fit}&output=webp&q=82&n=-1`;
    try { const got = await grab(sized, FETCH_MS); if (got) return got; } catch { passing = true; }
  }
  try { return (await grab(url, FETCH_MS)) || (passing ? TRANSIENT : null); } catch { return TRANSIENT; }
}

// One outside picture at one size: from memory, from data/people, or fetched once (everyone asking for it at the
// same moment waits on the same fetch). { type, size, body } or null when it could not be got (tried again after
// MISS_MS). "v3": pump.fun's pictures were kept at their full size before pump.fun's resizer was used; those
// copies are left to be pruned and every picture is fetched afresh once.
const farKey = (url, w, fit) => `far:${crypto.createHash("sha1").update(`v3
${url}
${w}
${fit}`).digest("hex")}`;
const sizeOf = (want) => SIZES.find((s) => s >= Math.max(16, Math.min(2000, Number(want) || 64))) || 1280;
const okHost = (url) => { try { const u = new URL(url); return u.protocol === "https:" && HOSTS.test(u.hostname) && url.length <= 1500; } catch { return false; } };
async function getFar(url, w, fit) {
  const key = farKey(url, w, fit);
  let pic = mem.get(key);
  if (pic) { mem.delete(key); mem.set(key, pic); return pic; }
  const base = path.join(PEOPLE, key.slice(4));
  for (const ext of EXTS) {
    try { const body = await fs.promises.readFile(`${base}.${ext}`); if (body.length) { pic = { type: TYPE[ext], size: body.length, body, t: now() }; break; } } catch {}
  }
  if (!pic) {
    if (now() - (missed.get(key) || 0) < MISS_MS) return null;
    let p = fetching.get(key);
    if (!p) {
      p = (async () => {
        const got = await fetchFar(url, w, fit);
        // A picture that is not there is not asked for again for MISS_MS; one that failed for a passing reason, after RETRY_MS.
        if (!got || got === TRANSIENT) { missed.set(key, got === TRANSIENT ? now() - MISS_MS + RETRY_MS : now()); if (missed.size > 20_000) missed.clear(); return null; }
        const file = `${base}.${TYPE_OF[got.type]}`;
        await fs.promises.writeFile(file + ".tmp", got.buf); await fs.promises.rename(file + ".tmp", file);
        farStats.fetched++;
        prunePeople(got.buf.length).catch(() => {});
        return { type: got.type, size: got.buf.length, body: got.buf, t: now() };
      })().finally(() => fetching.delete(key));
      fetching.set(key, p);
    }
    pic = await p;
  }
  if (pic) keep(key, pic);
  return pic;
}

// Pictures a page is about to show (the Feed's avatars, coin pictures and photos, as the radar lists them:
// GET /api/feed/pics), fetched before anyone asks: [url, px drawn at, fit]. Four at a time, each once.
const warmed = new Set();
let warmQueue = [], warming = 0;
export function warmFar(list) {
  for (const [url, px, fit] of list) {
    const w = sizeOf(Math.round(px * 2)), f = fit === "inside" ? "inside" : "cover", k = `${w}|${f}|${url}`;
    if (warmed.has(k) || !okHost(url)) continue;
    warmed.add(k); if (warmed.size > 50_000) warmed.clear();
    warmQueue.push([url, w, f]);
  }
  if (warmQueue.length > 2000) warmQueue = warmQueue.slice(-2000);
  while (warming < 4 && warmQueue.length) {
    const [url, w, f] = warmQueue.shift();
    warming++; farStats.warmed = (farStats.warmed || 0) + 1;
    getFar(url, w, f).catch(() => null).finally(() => { warming--; warmFar([]); });
  }
}

// GET /api/pic?u=&w=&fit= (also /api/pic.webp, the address the page uses on blixvip.com: Cloudflare keeps it at the
// edge by its extension): 200 with the picture (a day in the browser's cache: a changed picture has a new address),
// 404 for one that could not be got (tried again after MISS_MS), 400 for an address not served.
export async function serveFar(req, res) {
  const q = new URL(req.url, "http://x").searchParams;
  const url = String(q.get("u") || ""), fit = q.get("fit") === "inside" ? "inside" : "cover";
  if (!okHost(url)) { res.writeHead(400, { "content-type": "application/json", "cache-control": "no-store" }); return res.end('{"error":"That picture is not served from here."}'); }
  const pic = await getFar(url, sizeOf(q.get("w")), fit);
  if (res.destroyed) return;
  if (!pic) { farStats.missing++; res.writeHead(404, { "cache-control": "no-store" }); return res.end(); }
  farStats.served++;
  res.writeHead(200, { "content-type": pic.type, "content-length": pic.body.length, "cache-control": "public, max-age=604800, immutable", "x-content-type-options": "nosniff" });
  res.end(req.method === "HEAD" ? undefined : pic.body);
}
