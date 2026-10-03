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

// Every place a coin's picture might be, smallest and most reliable first.
export function sources(mint) {
  const out = [];
  // Everything launched on pump.fun is on its picture CDN, including the coins whose address does not end in "pump".
  out.push(`https://images.pump.fun/coin-image/${mint}?variant=200x200`);
  const t = db.prepare("SELECT image FROM tokens WHERE mint = ?").get(mint);
  for (const raw of [t?.image, getMeta(mint)?.image, knownImage(mint)]) {
    if (!raw) continue;
    // DexScreener's CDN resizes on request: ask for a thumbnail rather than the 800px original.
    const u = /cdn\.dexscreener\.com\/cms\/images\//.test(raw) ? raw.replace(/\?.*$/, "") + "?width=128&height=128&fit=crop&quality=90&format=auto" : raw;
    out.push(u);
    const cid = u.match(/\/ipfs\/([A-Za-z0-9]+[^?#]*)/)?.[1];
    if (cid) for (const g of ["https://pump.mypinata.cloud/ipfs/", "https://gateway.pinata.cloud/ipfs/", "https://ipfs.io/ipfs/", "https://dweb.link/ipfs/"]) out.push(g + cid);
  }
  out.push(`https://dd.dexscreener.com/ds-data/tokens/solana/${mint}.png?size=lg`);
  return [...new Set(out.map((u) => publicUrl(u)).filter(Boolean))];
}

// Follows redirects by hand so a launcher's link cannot bounce the radar onto this PC or the home network.
async function grab(url) {
  for (let hop = 0; hop < 4; hop++) {
    const safe = publicUrl(url);
    if (!safe) return null;
    const r = await fetch(safe, { redirect: "manual", signal: AbortSignal.timeout(7000), headers: { "user-agent": "Mozilla/5.0", accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5" } });
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

async function find(mint) {
  await slot();
  try {
    for (const u of sources(mint)) {
      try {
        const got = await grab(u);
        if (!got) continue;
        const file = `${mint}.${TYPES[got.type]}`;
        await fs.promises.writeFile(path.join(DIR, file + ".tmp"), got.buf);
        await fs.promises.rename(path.join(DIR, file + ".tmp"), path.join(DIR, file));
        known.set(mint, file); missing.delete(mint);
        imgStats.fetched++; imgStats.cached = known.size;
        try { onPicture?.(mint); } catch {}
        return file;
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
      res.writeHead(200, { "content-type": pic.type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" });
      return res.end(body);
    } catch { known.delete(mint); }
  }
  res.writeHead(404, { "cache-control": "no-store" });
  res.end();
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
