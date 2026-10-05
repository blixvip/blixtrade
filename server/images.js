// Coin pictures, served by the radar itself.
//
// The page used to load every picture straight from wherever it lived (pump.fun's CDN, IPFS gateways,
// DexScreener, GeckoTerminal, a launcher's own site). Half of those refuse a browser: gateways answer 403
// to pages that hot-link, rate limit, or get blocked by an ad blocker, and a coin a few seconds old has no
// picture anywhere yet. The radar can fetch all of them, so it does: /img/<mint> tries each known source
// in turn, keeps the picture on disk, and the page only ever talks to this PC.
import fs from "node:fs";
import path from "node:path";
import { db, DATA } from "./db.js";
import { publicUrl } from "./quality.js";
import { getMeta, knownImage } from "./pulse.js";

const DIR = path.join(DATA, "img");
fs.mkdirSync(DIR, { recursive: true });
const MAX_BYTES = 3_000_000, DAY = 864e5;
const now = () => Date.now();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" };
const BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([t, e]) => [e, t]));
export const imgStats = { served: 0, fetched: 0, missing: 0, cached: 0 };
// Told the moment a coin's picture lands on disk, so the page can swap it in without asking again.
let onPicture = null;
export const onPictureReady = (fn) => { onPicture = fn; };
export const hasPicture = (mint) => known.has(mint);

const known = new Map();      // mint -> file name on disk
for (const f of fs.readdirSync(DIR)) { const m = f.match(/^(.+)\.(\w+)$/); if (m && BY_EXT[m[2]]) known.set(m[1], f); }
imgStats.cached = known.size;
const missing = new Map();    // mint -> { t, n }: when it was last looked for and how often
const flying = new Map();     // mint -> promise, so one coin is only fetched once at a time
let active = 0;
const waiting = [];
const slot = () => active < 10 ? (active++, Promise.resolve()) : new Promise((ok) => waiting.push(ok));
const release = () => { const next = waiting.shift(); next ? next() : active--; };

// What the bytes really are, whatever the server called them (a launcher's file is not to be trusted).
function sniff(b) {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.toString("latin1", 0, 3) === "GIF") return "image/gif";
  if (b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("latin1", 4, 12) === "ftypavif") return "image/avif";
  return null;
}

// Some coins list a link that wraps their picture instead of the picture itself (a Google Lens "search by
// image" link): the picture is the address in its url= / imgurl= parameter.
function unwrap(u) {
  if (!u) return u;
  try {
    const x = new URL(u), inner = x.searchParams.get("url") || x.searchParams.get("imgurl") || x.searchParams.get("image_url");
    if (inner && /^https?:\/\//.test(inner) && /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|yandex\.[a-z]+)$/.test(x.hostname)) return inner;
  } catch {}
  return u;
}

// Every place a coin's picture might be, smallest and most reliable first.
export function sources(mint) {
  const out = [];
  // The two fast ones first (asked at the same time, see find()). Axiom mirrors every Solana coin's picture by
  // contract address as a small WebP, within a second of launch and in about 0.1s; pump.fun's CDN has everything
  // launched there (including coins whose address does not end in "pump") but often answers 403 and is slower.
  out.push(`https://axiomtrading-v2.axiom-cdn.io/${mint}.webp`);
  out.push(`https://images.pump.fun/coin-image/${mint}?variant=200x200`);
  const t = db.prepare("SELECT image FROM tokens WHERE mint = ?").get(mint);
  for (const given of [t?.image, getMeta(mint)?.image, knownImage(mint)]) {
    const raw = unwrap(given);
    if (!raw) continue;
    // DexScreener's CDN resizes on request: ask for a thumbnail rather than the 800px original.
    const u = /cdn\.dexscreener\.com\/cms\/images\//.test(raw) ? raw.replace(/\?.*$/, "") + "?width=128&height=128&fit=crop&quality=90&format=auto" : raw;
    out.push(u);
    const cid = u.match(/\/ipfs\/([A-Za-z0-9]+[^?#]*)/)?.[1];
    if (cid) for (const g of IPFS) out.push(g + cid);
  }
  out.push(`https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png?size=lg`);
  return [...new Set(out.map((u) => publicUrl(u)).filter(Boolean))];
}

// When none of the known places has it (an older coin the radar first met as a graduation, with no picture
// or metadata on record), ask pump.fun where its picture lives.
const IPFS = ["https://pump.mypinata.cloud/ipfs/", "https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"];
async function lookup(mint) {
  const json = (u) => fetch(u, { signal: AbortSignal.timeout(5000), headers: { "user-agent": UA, accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // pump.fun's API only: Jupiter's lite-api is shared with trade quotes, Discover and Blix Vault's swaps.
  const pump = await json(`https://frontend-api-v3.pump.fun/coins-v2/${mint}`);
  const found = [pump?.image_uri].filter(Boolean);
  const out = [];
  for (const u of found) {
    out.push(u);
    const cid = u.match(/\/ipfs\/([A-Za-z0-9]+[^?#]*)/)?.[1];
    if (cid) for (const g of IPFS) out.push(g + cid);
  }
  if (found[0]) try { db.prepare("UPDATE tokens SET image = ? WHERE mint = ? AND image IS NULL").run(found[0], mint); } catch {}
  return [...new Set(out.map((u) => publicUrl(u)).filter(Boolean))];
}

// Follows redirects by hand so a launcher's link cannot bounce the radar onto this PC or the home network.
async function grab(url, ms = 7000) {
  for (let hop = 0; hop < 4; hop++) {
    const safe = publicUrl(url);
    if (!safe) return null;
    // A real browser's headers, sent as if from the picture's own site: gmgn.ai and others answer 403 without a referer.
    const r = await fetch(safe, { redirect: "manual", signal: AbortSignal.timeout(ms), headers: { "user-agent": UA, referer: new URL(safe).origin + "/", accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5" } });
    if (r.status >= 300 && r.status < 400) { const to = r.headers.get("location"); if (!to) return null; url = new URL(to, safe).href; continue; }
    if (!r.ok) return null;
    if (+r.headers.get("content-length") > MAX_BYTES) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return null;
    const type = sniff(buf);
    return type ? { buf, type } : null;
  }
  return null;
}

// A logo is drawn at 64px at most, but some sources hand over the 1-3 MB original. A big one is fetched
// again through wsrv.nl (an open image resizer) as a 128px WebP; an animated GIF stays animated.
const SMALL = 96_000;
const resized = (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=128&h=128&fit=cover&output=webp&q=82&n=-1`;
async function shrink(got, url) {
  if (got.buf.length <= SMALL) return got;
  try { const small = await grab(resized(url), 5000); if (small && small.buf.length < got.buf.length) return small; } catch {}
  return got;
}

async function save(mint, got) {
  const file = `${mint}.${TYPES[got.type]}`, old = known.get(mint);
  await fs.promises.writeFile(path.join(DIR, file + ".tmp"), got.buf);
  await fs.promises.rename(path.join(DIR, file + ".tmp"), path.join(DIR, file));
  if (old && old !== file) fs.rm(path.join(DIR, old), () => {});
  known.set(mint, file); missing.delete(mint);
  if (mem.has(mint)) { memBytes -= mem.get(mint).length; mem.delete(mint); }
  imgStats.fetched++; imgStats.cached = known.size;
  try { onPicture?.(mint); } catch {}
  return file;
}

async function find(mint) {
  await slot();
  try {
    const list = sources(mint), known0 = list.length;
    // The two fast sources at once, on a short leash: most coins are done here in about a tenth of a second.
    try {
      const [u, got] = await Promise.any(list.slice(0, 2).map((u) => grab(u, 3000).then((g) => g ? [u, g] : Promise.reject())));
      return await save(mint, await shrink(got, u));
    } catch {}
    for (let i = 2; ; i++) {
      // Every known place came up empty: look the coin up once, and try what that turns up.
      if (i === known0) for (const x of await lookup(mint)) if (!list.includes(x)) list.push(x);
      if (i >= list.length) break;
      const u = list[i];
      try {
        const got = await grab(u, 5000);
        if (!got) continue;
        return await save(mint, await shrink(got, u));
      } catch {}
    }
    const m = missing.get(mint);
    missing.set(mint, { t: now(), n: (m?.n || 0) + 1 });
    imgStats.missing++;
    if (missing.size > 5000) for (const [k, v] of missing) if (now() - v.t > 30 * 60_000) missing.delete(k);
    return null;
  } finally { release(); }
}

// A coin with no picture yet is looked for again soon (new launches publish theirs within seconds),
// then less and less often.
const retryAfter = (n) => Math.min(10 * 60_000, 1000 * 2 ** Math.min(n - 1, 10));

// { file, type } for a coin's picture, or null when no source has one right now.
export async function picture(mint) {
  let file = known.get(mint);
  if (!file) {
    const m = missing.get(mint);
    if (m && now() - m.t < retryAfter(m.n)) return null;
    let p = flying.get(mint);
    if (!p) { p = find(mint).finally(() => flying.delete(mint)); flying.set(mint, p); }
    file = await p;
  }
  return file ? { file: path.join(DIR, file), type: BY_EXT[file.split(".").pop()] } : null;
}

// The page asks for dozens of pictures at once and a browser only opens six connections to this PC, so a
// request never waits long on a slow source: after half a second it answers "not yet" and the fetch
// carries on in the background (the page asks again a few seconds later and gets it from disk).
export async function serve(mint, res) {
  const pic = known.has(mint) ? await picture(mint) : await Promise.race([picture(mint).catch(() => null), new Promise((ok) => setTimeout(ok, 500, null))]);
  if (pic) {
    try {
      const body = await fs.promises.readFile(pic.file);
      imgStats.served++;
      if (body.length > SMALL * 1.5) upgrade(mint);
      res.writeHead(200, { "content-type": pic.type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" });
      return res.end(body);
    } catch { known.delete(mint); }
  }
  res.writeHead(404, { "cache-control": "no-store" });
  res.end();
}

// Many logos in one answer: the page shows dozens of coins at once, and a browser sends only six requests
// at a time to this PC, so one by one they trickle in over a couple of seconds. The ones on disk come back
// here as data URLs (small: logos are kept under ~100 KB); the rest are fetched in the background and
// announced on the live stream when they land. Hot ones stay in memory.
const mem = new Map();   // mint -> data URL, most recent last
let memBytes = 0;
const remember = (mint, url) => {
  memBytes += url.length - (mem.get(mint)?.length || 0); mem.delete(mint); mem.set(mint, url);
  for (const [k, v] of mem) { if (memBytes < 48e6) break; memBytes -= v.length; mem.delete(k); }
};
export async function batch(mints) {
  const out = {};
  await Promise.all([...new Set(mints)].slice(0, 120).map(async (mint) => {
    const file = known.get(mint);
    if (!file) { out[mint] = null; picture(mint).catch(() => {}); return; }
    let url = mem.get(mint);
    if (!url) {
      try {
        const body = await fs.promises.readFile(path.join(DIR, file));
        if (body.length > SMALL * 1.5) { upgrade(mint); out[mint] = null; return; }   // too big to inline: served one by one until shrunk
        url = `data:${BY_EXT[file.split(".").pop()]};base64,${body.toString("base64")}`;
      } catch { known.delete(mint); out[mint] = null; return; }
    }
    remember(mint, url); out[mint] = url;
  }));
  imgStats.served += Object.values(out).filter(Boolean).length;
  return out;
}

// A picture saved before logos were kept small: fetch it again from the small sources in the background
// (the old one is served until then). Two at a time, each coin once per run.
const upgraded = new Set(), upgrades = [];
let upgrading = 0;
function upgrade(mint) {
  if (upgraded.has(mint) || flying.has(mint)) return;
  upgraded.add(mint); upgrades.push(mint);
  if (upgraded.size > 20_000) upgraded.clear();
  pump();
}
function pump() {
  while (upgrading < 2 && upgrades.length) {
    const mint = upgrades.shift();
    upgrading++;
    (async () => {
      const list = sources(mint);
      for (const u of list.slice(0, 2)) {
        const got = await grab(u, 4000).catch(() => null);
        if (got) { const small = await shrink(got, u); if (small.buf.length <= SMALL) return save(mint, small); }
      }
      const cur = known.get(mint);
      if (cur) for (const u of [...list.slice(2)].filter((x) => !/axiom-cdn|images\.pump\.fun/.test(x)).slice(0, 3)) {
        const small = await grab(resized(u), 5000).catch(() => null);
        if (small && small.buf.length <= SMALL) return save(mint, small);
      }
    })().catch(() => {}).finally(() => { upgrading--; pump(); });
  }
}

// Fetch ahead of the page: the coins on the live lists get their pictures before anyone asks.
export function warm(mints) {
  for (const m of mints) if (!known.has(m) && !flying.has(m) && waiting.length < 40) picture(m).catch(() => {});
}

// A coin that was created this second: pump.fun's picture CDN has it about half a second later and the
// metadata file a moment after that, so ask a few times in quick succession instead of waiting for the page.
const EAGER = [350, 900, 1800, 3500, 7000, 14_000];
export function eager(mint) {
  let i = 0;
  const go = () => {
    if (known.has(mint)) return;
    missing.delete(mint);
    picture(mint).catch(() => null).then((p) => { if (!p && ++i < EAGER.length) setTimeout(go, EAGER[i] - EAGER[i - 1]); });
  };
  setTimeout(go, EAGER[0]);
}

// A new source for a coin's picture just turned up: look again now, whatever the earlier misses said.
export function retry(mint) { if (known.has(mint)) return; missing.delete(mint); picture(mint).catch(() => {}); }

// Pictures fetched more than three days ago go (a coin still on screen simply gets its picture again).
export function prunePictures() {
  for (const [mint, file] of known) {
    try { if (now() - fs.statSync(path.join(DIR, file)).mtimeMs > 3 * DAY) { fs.rmSync(path.join(DIR, file)); known.delete(mint); } } catch { known.delete(mint); }
  }
  imgStats.cached = known.size;
}
