// The card behind a coin's X link (Axiom's hover card): who or what the link points at. Free, no key, no login:
// profiles and posts come from FxTwitter's public API (api.fxtwitter.com, the same source xtrack.js uses when an
// account is added). X shows communities only to signed-in browsers and FxTwitter does not read them, so a
// community link gets a card with its address alone (nothing paid is used).
//
// GET /api/xcard?u=<x.com link>: { kind: "profile" | "post" | "community" | "search" | "other", url, ...fields }.
// Each link is read once and kept for everybody: profiles 6 h, posts 1 h, a failed read 10 min.
import { safeUrl } from "./quality.js";

const now = () => Date.now();
const KEEP = { profile: 6 * 3600_000, post: 3600_000, miss: 10 * 60_000 };
const cache = new Map();      // key -> { t, ttl, v }
const reading = new Map();    // key -> promise
export const xcardStats = { reads: 0, failed: 0, kept: 0 };

// What an X link points at, from its address alone.
export function parseX(u) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(u) ? u : `https://x.com/${String(u).replace(/^@/, "")}`); } catch { return null; }
  if (!/(^|\.)(x|twitter)\.com$/i.test(url.hostname)) return null;
  const p = url.pathname.split("/").filter(Boolean);
  const clean = `https://x.com${url.pathname}`.replace(/\/+$/, "");
  if (p[0] === "i" && p[1] === "communities" && /^\d{5,25}$/.test(p[2] || "")) return { kind: "community", id: p[2], url: `https://x.com/i/communities/${p[2]}` };
  if (p[0] === "search") return { kind: "search", q: url.searchParams.get("q") || "", url: url.href };
  if (/^\w{1,15}$/.test(p[0] || "") && p[1] === "status" && /^\d{5,25}$/.test(p[2] || "")) return { kind: "post", id: p[2], handle: p[0], url: `https://x.com/${p[0]}/status/${p[2]}` };
  if (/^\w{1,15}$/.test(p[0] || "") && !["home", "explore", "i", "intent", "hashtag", "share"].includes(p[0].toLowerCase()) && p.length === 1) return { kind: "profile", handle: p[0], url: `https://x.com/${p[0]}` };
  return { kind: "other", url: clean };
}

async function fx(path) {
  const r = await fetch(`https://api.fxtwitter.com/${path}`, { headers: { accept: "application/json", "user-agent": "blix/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}
const user = (u) => u && {
  handle: u.screen_name, name: u.name || u.screen_name, avatar: safeUrl(u.avatar_url)?.replace("_normal.", "_200x200.") || null, banner: safeUrl(u.banner_url) || null,
  bio: String(u.description || "").slice(0, 400), followers: u.followers ?? null, following: u.following ?? null, posts: u.tweets ?? null,
  joined: u.joined ? Date.parse(u.joined) || null : null, verified: Boolean(u.verification?.verified), verifiedType: u.verification?.type || null,
  website: safeUrl(u.website?.url) || null, location: u.location || null,
};

async function read(x) {
  if (x.kind === "profile") {
    const j = await fx(encodeURIComponent(x.handle));
    return j?.user ? { ...x, ...user(j.user), handle: j.user.screen_name } : null;
  }
  if (x.kind === "post") {
    const j = await fx(`${encodeURIComponent(x.handle)}/status/${x.id}`);
    const tw = j?.tweet;
    if (!tw) return null;
    const m = tw.media || {};
    return { ...x, author: user(tw.author), text: String(tw.text || "").slice(0, 600), t: tw.created_timestamp ? tw.created_timestamp * 1000 : null,
      likes: tw.likes ?? null, reposts: tw.retweets ?? null, replies: tw.replies ?? null, views: tw.views ?? null,
      photo: safeUrl(m.photos?.[0]?.url || m.videos?.[0]?.thumbnail_url) || null, video: Boolean(m.videos?.length) };
  }
  return x;   // community, search, other: what the address says
}

export async function xcard(u) {
  const x = parseX(String(u || "").slice(0, 400));
  if (!x) return { kind: "invalid" };
  if (x.kind !== "profile" && x.kind !== "post") return x;
  const key = x.kind === "profile" ? `p:${x.handle.toLowerCase()}` : `s:${x.id}`;
  const hit = cache.get(key);
  if (hit && now() - hit.t < hit.ttl) return hit.v;
  let p = reading.get(key);
  if (!p) {
    xcardStats.reads++;
    p = read(x).catch(() => null).then((v) => {
      if (!v) xcardStats.failed++;
      cache.set(key, { t: now(), ttl: v ? KEEP[x.kind] : KEEP.miss, v: v || { ...x, missing: true } });
      if (cache.size > 5000) for (const k of [...cache.keys()].slice(0, 1000)) cache.delete(k);
      xcardStats.kept = cache.size;
      return cache.get(key).v;
    }).finally(() => reading.delete(key));
    reading.set(key, p);
  }
  return p;
}
