// GET /api/feed/stream?groups=trades,theses,...&sources=fomo,pump: the Feed page's live push (text/event-stream).
// Fomo's feed (fomofeed.js) and pump.fun's callouts (pumpfeed.js) tell this module the moment a read lands; open
// pages then get only what changed: `feed` events of { src, full, items, t, error, signedOut, rm: [ids gone],
// up: [a new post whole, or { id, ...only the fields that changed }] }. A page's first event per source is the
// whole list (full: true). The change list is worked out once per read and the same text goes to every page.
// A browser that takes gzip gets the stream gzipped (one deflate stream per page, flushed after every event):
// the first lists go from ~170 KB to ~30 KB, and a change list from ~8 KB to ~2 KB.
import zlib from "node:zlib";
import { fomoFeed, onFomoFeed } from "./fomofeed.js";
import { pumpFeed, onPumpFeed } from "./pumpfeed.js";
import { warmFeed } from "./feedwarm.js";

const clients = new Set(); // { write, key (Fomo filter key or null), pump, synced: { fomo, pump } (last `t` sent) }
const state = new Map();   // "fomo:<key>" | "pump" -> { t, byId: Map(id -> item), ids, delta (JSON text of up/rm) }

const same = (a, b) => a === b || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));

// A post's figures that move with every trade (a pump.fun position's value, profit and multiple, its market cap,
// a callout's view count): sent at most every FIGURES_MS (1.5 s) per post, since the page prices positions from its own
// trade stream between times and the rest of the list is what people watch for. Everything else (a new post, an
// update, likes, a reply, a post gone) goes at once. Three quarters of the stream's bytes were these figures.
const FIGURES = new Set(["mc", "price", "pnlUsd", "pnlPct", "sizeUsd", "multiple", "views"]);
const FIGURES_MS = 1_500;

// The newest answer for one source, and what changed since the read before it.
function read(src, key) {
  const r = src === "pump" ? pumpFeed() : fomoFeed(key);
  const name = src === "pump" ? "pump" : `fomo:${key}`;
  const s = state.get(name);
  if (s && s.t === r.t) return { r, s };
  // A new read: its pictures fetched now, before the pages ask (feedwarm.js).
  try { warmFeed(r.items); } catch {}
  const byId = new Map((r.items || []).map((it) => [it.id, it]));
  const up = [], rm = [], now = Date.now(), figAt = s?.figAt || new Map();
  if (s) {
    for (const [id, it] of byId) {
      const was = s.byId.get(id);
      if (!was) { figAt.set(id, now); up.push(it); continue; }
      let patch = null, onlyFigures = true;
      for (const k in it) if (!same(it[k], was[k])) { (patch ||= { id })[k] = it[k]; if (!FIGURES.has(k)) onlyFigures = false; }
      if (!patch) continue;
      // Figures alone, sent not long ago: the post stays as the pages have it, and the change waits for the next read.
      if (onlyFigures && now - (figAt.get(id) || 0) < FIGURES_MS) { byId.set(id, was); continue; }
      figAt.set(id, now);
      up.push(patch);
    }
    for (const id of s.byId.keys()) if (!byId.has(id)) { rm.push(id); figAt.delete(id); }
  }
  const next = { t: r.t, byId, figAt, have: Boolean(r.items), delta: `"rm":${JSON.stringify(rm)},"up":${JSON.stringify(up)}`, quiet: !up.length && !rm.length, prevT: s?.t ?? null };
  state.set(name, next);
  return { r, s: next };
}

function send(c, src, r, s, body, full) {
  c.write(`event: feed\ndata: {"src":"${src}","full":${full},"items":${s.have},"t":${r.t ?? null},"error":${JSON.stringify(r.error ?? null)},"signedOut":${Boolean(r.signedOut)},${body}}\n\n`);
}

function push(c, src) {
  const { r, s } = read(src, c.key);
  const status = `${r.error}|${r.signedOut}|${s.have}`;
  // Caught up with the read before this one: the shared change list. Otherwise (just opened, or missed a read):
  // the whole list.
  if (s.have && c.synced[src] !== undefined && c.synced[src] === s.prevT) {
    if (!s.quiet || c.status[src] !== status) send(c, src, r, s, s.delta, false);
  } else if (c.synced[src] === undefined || c.synced[src] !== s.t || c.status[src] !== status) {
    send(c, src, r, s, `"rm":[],"up":${s.have ? JSON.stringify([...s.byId.values()]) : "[]"}`, s.have);
  }
  if (s.have) c.synced[src] = s.t;
  c.status[src] = status;
}

onFomoFeed((key) => { for (const c of clients) if (c.key === key) push(c, "fomo"); });
onPumpFeed(() => { for (const c of clients) if (c.pump) push(c, "pump"); });

// Keep the sources reading while a page is open (they stop 45 s after nobody asks), and keep proxies from closing
// a quiet stream.
setInterval(() => {
  for (const c of clients) {
    if (c.key) fomoFeed(c.key);
    if (c.pump) pumpFeed();
    c.write(`event: heartbeat\ndata: {"t":${Date.now()}}\n\n`);
  }
}, 5_000).unref();

export function feedStream(req, res, params) {
  const sources = String(params.sources || "fomo,pump").split(",");
  const groups = String(params.groups || "").split(",").filter(Boolean);
  // fomoFeed() answers with the filter set's canonical key (Fomo's menu order).
  const key = sources.includes("fomo") && groups.length ? fomoFeed(groups.join(",")).groups.join(",") : null;
  const gzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", ...(gzip ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}) });
  let write = (text) => res.write(text);
  if (gzip) {
    const gz = zlib.createGzip({ level: 6 });
    gz.pipe(res);
    // Every event leaves at once: a deflate stream otherwise holds output back until it has a block's worth.
    write = (text) => { if (!gz.destroyed) { gz.write(text); gz.flush(zlib.constants.Z_SYNC_FLUSH); } };
    req.on("close", () => gz.destroy());
  }
  write(`:${" ".repeat(2048)}\n\n`);
  const c = { write, key, pump: sources.includes("pump"), synced: {}, status: {} };
  clients.add(c);
  if (c.key) push(c, "fomo");
  if (c.pump) push(c, "pump");
  req.on("close", () => clients.delete(c));
}

// GET /api/feed/pics: every picture the Feed page is showing or about to show, as [address, px drawn at, fit]
// (web/src/pages/Feed.tsx sizes: avatars 36 and 16 in "Hot right now", faces 18, clan badges 16, a post's photo
// 680 wide and an update's 560), and the Solana coins whose logos it draws. The page server (webapp.js) fetches
// them before anyone asks. Empty when nobody has had the Feed open in the last 10 minutes.
let lastLooked = 0;
export function feedPics() {
  if (clients.size) lastLooked = Date.now();
  if (Date.now() - lastLooked > 10 * 60_000) return { pics: [], mints: [] };
  const pics = new Map(), mints = new Set();
  const add = (u, px, fit = "cover") => { if (typeof u === "string" && /^https:\/\//.test(u)) pics.set(`${px}|${fit}|${u}`, [u, px, fit]); };
  for (const s of state.values()) {
    for (const it of s.byId.values()) {
      if (it.user?.pic) { add(it.user.pic, 36); add(it.user.pic, 16); }
      add(it.user?.clan?.pic, 16);
      for (const p of it.users || []) add(p.pic, 18);
      for (const p of it.followedBy || []) add(p.pic, 18);
      add(it.media, 680, "inside");
      for (const x of it.updates || []) add(x.media, 560, "inside");
      if (it.mint && it.chain === 1399811149) mints.add(it.mint); else add(it.img, 24);
    }
  }
  return { pics: [...pics.values()].slice(0, 3000), mints: [...mints].slice(0, 600) };
}
