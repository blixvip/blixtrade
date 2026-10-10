// Views and likes on the Feed page's posts, counted by Blix itself: Fomo's own `views` is always 0 and its likes
// can't be given from here. A view is a post that sat on someone's screen (the page reports it, FeedClassic.tsx),
// counted once per viewer per post every VIEW_GAP_MS. A like is one per viewer per post and can be taken back;
// the page shows Fomo's likes plus these. Viewer = the member's account, else the visitor's IP, else the owner.
// Kept in data/feedviews.json (newest KEEP posts), written at most every SAVE_MS.
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./db.js";

const FILE = path.join(DATA, "feedviews.json"), KEEP = 5000, VIEW_GAP_MS = 30 * 60_000, SAVE_MS = 30_000;
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
const posts = new Map();   // id -> { v: views, l: Set(viewers who liked), t: last touched }
const seen = new Map();    // `${viewer}|${id}` -> last counted
let dirty = false, timer = null;

try {
  const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
  for (const [id, x] of Object.entries(j.posts || {})) posts.set(id, { v: +x.v || 0, l: new Set(x.l || []), t: +x.t || 0 });
} catch {}

function save() {
  timer = null;
  if (!dirty) return;
  dirty = false;
  if (posts.size > KEEP) [...posts].sort((a, b) => a[1].t - b[1].t).slice(0, posts.size - KEEP).forEach(([id]) => posts.delete(id));
  const out = {};
  for (const [id, x] of posts) out[id] = { v: x.v, l: [...x.l], t: x.t };
  fs.promises.writeFile(FILE + ".tmp", JSON.stringify({ posts: out })).then(() => fs.promises.rename(FILE + ".tmp", FILE)).catch(() => {});
}
const touch = () => { dirty = true; if (!timer) timer = setTimeout(save, SAVE_MS); };
const post = (id) => { let x = posts.get(id); if (!x) posts.set(id, (x = { v: 0, l: new Set(), t: 0 })); x.t = Date.now(); return x; };
const ids = (a, n) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && ID.test(x)).slice(0, n) : []);

export const viewerOf = (req, res) => res.blixAs ? `m:${res.blixAs}` : `ip:${req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "?"}`;

// POST /api/feed/views { seen: [ids now on screen], ids: [ids on the page] } -> each post's views and likes, and
// which of them this viewer liked.
export function feedViews(viewer, body) {
  const t = Date.now();
  for (const id of ids(body?.seen, 60)) {
    const k = `${viewer}|${id}`;
    if (t - (seen.get(k) || 0) < VIEW_GAP_MS) continue;
    seen.set(k, t); post(id).v++; touch();
  }
  if (seen.size > 50_000) for (const [k, at] of seen) if (t - at > VIEW_GAP_MS) seen.delete(k);
  const views = {}, likes = {}, liked = [];
  for (const id of ids(body?.ids, 300)) {
    const x = posts.get(id);
    if (!x) continue;
    if (x.v) views[id] = x.v;
    if (x.l.size) likes[id] = x.l.size;
    if (x.l.has(viewer)) liked.push(id);
  }
  return { views, likes, liked };
}

// POST /api/feed/like { id, on }
export function feedLike(viewer, body) {
  const id = String(body?.id || "");
  if (!ID.test(id)) return { error: "Bad post id." };
  const x = post(id);
  if (body?.on === false) x.l.delete(viewer); else x.l.add(viewer);
  touch();
  return { id, likes: x.l.size, liked: x.l.has(viewer) };
}
