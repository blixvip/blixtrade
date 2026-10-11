// The card behind a coin's X link (Axiom's hover card): who or what the link points at. Free, no key, no login:
// profiles and posts come from FxTwitter's public API (api.fxtwitter.com, the same source xtrack.js uses when an
// account is added), posts also from X's own syndication API (cdn.syndication.twimg.com, what embedded posts
// read) when FxTwitter has nothing, which also says why a post is gone (deleted by its author, suspended
// account). Communities come from X's web API as a logged-out guest (the public web bearer and a guest token,
// the same calls x.com makes for a visitor): name, members, banner, creator, rules. The creator's picture and
// followers come from FxTwitter.
//
// Every card is kept in SQLite (xcards) as well as memory, so a card read once is answered in a millisecond for
// everybody from then on and survives restarts; a card older than its keep is answered at once as it is and
// refreshed behind the answer. A link that can no longer be read (post deleted, account suspended, community
// deleted) still answers with the last card Blix saw, marked `gone` with X's reason and when it was last seen.
// Coins' X links are read the moment the coin's metadata arrives (warmX, from pulse.js / linkfill.js / engine.js),
// so by the time anyone hovers, the card is there, and a post deleted later is still on file.
//
// GET /api/xcard?u=<x.com link>: { kind: "profile" | "post" | "community" | "search" | "other", url, ...fields,
//   seen?: when read, gone?: reason (the card is the last one seen), missing?: true (never read), reason? }.
import { db } from "./db.js";
import { safeUrl } from "./quality.js";

const now = () => Date.now();
// How long a card is fresh (served as is); after that it is still served, and refreshed behind the answer.
const KEEP = { profile: 6 * 3600_000, post: 3600_000, community: 3600_000 };
const RETRY_GONE = 30 * 60_000;    // a gone or missing link is asked about again after this long
const cache = new Map();           // key -> { t, v }   (memory copy of xcards rows, bounded)
const reading = new Map();         // key -> promise
export const xcardStats = { reads: 0, failed: 0, kept: 0, warmed: 0, stale: 0, synd: 0 };

db.exec(`CREATE TABLE IF NOT EXISTS xcards (key TEXT PRIMARY KEY, kind TEXT, t INTEGER NOT NULL, ok INTEGER NOT NULL, v TEXT NOT NULL)`);
const qGet = db.prepare("SELECT t, ok, v FROM xcards WHERE key = ?");
const qPut = db.prepare("INSERT OR REPLACE INTO xcards (key, kind, t, ok, v) VALUES (?, ?, ?, ?, ?)");
const qCount = db.prepare("SELECT COUNT(*) AS n FROM xcards");
const qTrim = db.prepare("DELETE FROM xcards WHERE key IN (SELECT key FROM xcards ORDER BY t LIMIT ?)");

// What an X link points at, from its address alone.
export function parseX(u) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(u) ? u : `https://x.com/${String(u).replace(/^@/, "")}`); } catch { return null; }
  if (!/(^|\.)(x|twitter)\.com$/i.test(url.hostname)) return null;
  const p = url.pathname.split("/").filter(Boolean);
  const clean = `https://x.com${url.pathname}`.replace(/\/+$/, "");
  if (p[0] === "i" && p[1] === "communities" && /^\d{5,25}$/.test(p[2] || "")) return { kind: "community", id: p[2], url: `https://x.com/i/communities/${p[2]}` };
  if (p[0] === "search") return { kind: "search", q: url.searchParams.get("q") || "", url: url.href };
  if (/^\w{1,15}$/.test(p[0] || "") && (p[1] === "status" || p[1] === "statuses") && /^\d{5,25}$/.test(p[2] || "")) return { kind: "post", id: p[2], handle: p[0], url: `https://x.com/${p[0]}/status/${p[2]}` };
  if (/^\w{1,15}$/.test(p[0] || "") && !["home", "explore", "i", "intent", "hashtag", "share", "search", "settings", "messages", "notifications", "compose"].includes(p[0].toLowerCase()) && p.length === 1) return { kind: "profile", handle: p[0], url: `https://x.com/${p[0]}` };
  return { kind: "other", url: clean };
}
export const keyOf = (x) => (x.kind === "profile" ? `p:${x.handle.toLowerCase()}` : x.kind === "community" ? `c:${x.id}` : x.kind === "post" ? `s:${x.id}` : null);

async function fx(path) {
  const r = await fetch(`https://api.fxtwitter.com/${path}`, { headers: { accept: "application/json", "user-agent": "blix/1.0" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return r.status === 404 ? { notFound: true } : null;   // null: a transient failure (5xx, 429), worth another source or another try
  return r.json().catch(() => null);
}
const user = (u) => u && {
  handle: u.screen_name, name: u.name || u.screen_name, avatar: safeUrl(u.avatar_url)?.replace("_normal.", "_200x200.") || null, banner: safeUrl(u.banner_url) || null,
  bio: String(u.description || "").slice(0, 400), followers: u.followers ?? null, following: u.following ?? null, posts: u.tweets ?? null,
  joined: u.joined ? Date.parse(u.joined) || null : null, verified: Boolean(u.verification?.verified), verifiedType: u.verification?.type || null,
  website: safeUrl(u.website?.url) || null, location: u.location || null,
};

// X's syndication API (what an embedded post reads): the post itself, or a tombstone saying why it is gone. The
// token is the one embed.js computes from the id.
const syndToken = (id) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
async function syndication(id) {
  const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndToken(id)}`, { headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return r.status === 404 ? { notFound: true } : null;
  const j = await r.json().catch(() => null);
  if (!j) return null;
  if (j.__typename === "TweetTombstone") return { gone: String(j.tombstone?.text?.text || "This post is unavailable.").replace(/\s*Learn more\.?$/i, "").trim() };
  if (j.__typename !== "Tweet" && !j.text) return { notFound: true };
  const u = j.user || {};
  xcardStats.synd++;
  return {
    tweet: {
      author: { handle: u.screen_name, name: u.name || u.screen_name, avatar: safeUrl(u.profile_image_url_https)?.replace("_normal.", "_200x200.") || null, banner: null, bio: "", followers: null, following: null, posts: null, joined: null,
        verified: Boolean(u.is_blue_verified || u.verified), verifiedType: u.verified_type || (u.is_blue_verified ? "Blue" : null), website: null, location: null },
      text: String(j.text || ""), t: j.created_at ? Date.parse(j.created_at) || null : null,
      likes: j.favorite_count ?? null, reposts: null, replies: j.conversation_count ?? null, views: null,
      photo: safeUrl(j.photos?.[0]?.url || j.video?.poster || j.mediaDetails?.[0]?.media_url_https) || null, video: Boolean(j.video || j.mediaDetails?.some((m) => m.type === "video")),
    },
  };
}

// X's web API as a logged-out visitor. The guest token is shared and replaced when X refuses it.
const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";   // X answers 404 without one
let guest = null;   // { token, t }
async function guestToken(fresh) {
  if (!fresh && guest && now() - guest.t < 3 * 3600_000) return guest.token;
  const r = await fetch("https://api.x.com/1.1/guest/activate.json", { method: "POST", body: "", headers: { authorization: `Bearer ${BEARER}`, "user-agent": UA }, signal: AbortSignal.timeout(8000) });
  const j = r.ok ? await r.json().catch(() => null) : null;
  guest = j?.guest_token ? { token: j.guest_token, t: now() } : null;
  return guest?.token || null;
}
async function xgql(path, variables, features) {
  for (const fresh of [false, true]) {
    const token = await guestToken(fresh);
    if (!token) return null;
    const q = `variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;
    const r = await fetch(`https://x.com/i/api/graphql/${path}?${q}`, { headers: { authorization: `Bearer ${BEARER}`, "x-guest-token": token, "user-agent": UA }, signal: AbortSignal.timeout(8000) });
    if (r.ok) return r.json().catch(() => null);
    if (![401, 403, 429].includes(r.status)) return null;   // a spent or refused token: one more try with a new one
  }
  return null;
}
const REASON = { Deleted: "This community was deleted.", Suspended: "This community was suspended.", NotFound: "This community doesn't exist." };
async function community(x) {
  const j = await xgql("-ElI1vg3dYbttVMhBhGdLw/CommunityQuery", { communityId: x.id, withDmMuting: false, withSafetyModeUserFields: false },
    { c9s_list_members_action_api_enabled: false, c9s_superc9s_indication_enabled: false });
  const c = j?.data?.communityResults?.result;
  if (!c) return null;
  if (c.__typename !== "Community") return { gone: REASON[c.reason] || (c.reason ? `This community is unavailable (${c.reason}).` : "This community is unavailable.") };
  const creatorHandle = c.creator_results?.result?.core?.screen_name || null;
  const creator = creatorHandle ? await fx(encodeURIComponent(creatorHandle)).then((u) => (u?.user ? user(u.user) : null)).catch(() => null) : null;
  return { card: {
    ...x, name: String(c.name || "").slice(0, 120), description: String(c.description || "").slice(0, 600), members: c.member_count ?? null,
    created: c.created_at || null, open: c.join_policy === "Open", nsfw: Boolean(c.is_nsfw),
    banner: safeUrl(c.custom_banner_media?.media_info?.original_img_url || c.default_banner_media?.media_info?.original_img_url)?.replace(/name=orig$/, "name=small") || null,
    faces: (c.members_facepile_results || []).map((m) => safeUrl(m?.result?.avatar?.image_url)).filter(Boolean).slice(0, 6),
    rules: (c.rules || []).map((r) => String(r?.name || "").slice(0, 120)).filter(Boolean).slice(0, 6),
    creator: creator || (creatorHandle ? { handle: creatorHandle, name: creatorHandle, avatar: null, followers: null, verified: Boolean(c.creator_results?.result?.is_blue_verified) } : null),
  } };
}

// One read of a link: { card } when read, { gone: reason } when X says it is gone, null when no source answered
// (a transient failure: the last card, if any, stands and the read is tried again later).
async function read(x) {
  if (x.kind === "community") return community(x);
  if (x.kind === "profile") {
    let j = await fx(encodeURIComponent(x.handle));
    if (j === null) { await new Promise((ok) => setTimeout(ok, 400)); j = await fx(encodeURIComponent(x.handle)); }
    if (j?.user) return { card: { ...x, ...user(j.user), handle: j.user.screen_name } };
    return j?.notFound || j?.code === 404 ? { gone: "This account doesn't exist any more (suspended, renamed or deleted)." } : null;
  }
  if (x.kind === "post") {
    const j = await fx(`${encodeURIComponent(x.handle)}/status/${x.id}`);
    const tw = j?.tweet;
    if (tw) {
      const m = tw.media || {};
      return { card: { ...x, handle: tw.author?.screen_name || x.handle, url: `https://x.com/${tw.author?.screen_name || x.handle}/status/${x.id}`, author: user(tw.author), text: String(tw.text || "").slice(0, 600), t: tw.created_timestamp ? tw.created_timestamp * 1000 : null,
        likes: tw.likes ?? null, reposts: tw.retweets ?? null, replies: tw.replies ?? null, views: tw.views ?? null,
        photo: safeUrl(m.photos?.[0]?.url || m.videos?.[0]?.thumbnail_url) || null, video: Boolean(m.videos?.length) } };
    }
    // FxTwitter had nothing: the syndication API has the post, or says why it is gone.
    const s = await syndication(x.id).catch(() => null);
    if (s?.tweet) return { card: { ...x, handle: s.tweet.author.handle || x.handle, url: `https://x.com/${s.tweet.author.handle || x.handle}/status/${x.id}`, ...s.tweet, text: s.tweet.text.slice(0, 600) } };
    if (s?.gone) return { gone: s.gone };
    return s?.notFound || j?.notFound ? { gone: "This post doesn't exist any more (deleted, or the account is gone)." } : null;
  }
  return { card: x };   // search, other: what the address says
}

const remember = (key, kind, row) => {
  cache.set(key, { t: now(), v: row });
  if (cache.size > 5000) for (const k of [...cache.keys()].slice(0, 1000)) cache.delete(k);
  try { qPut.run(key, kind, row.seen || now(), row.missing ? 0 : 1, JSON.stringify(row)); } catch {}
  xcardStats.kept = cache.size;
};
const fromDb = (key) => {
  try { const r = qGet.get(key); if (r) { const v = JSON.parse(r.v); cache.set(key, { t: r.t, v }); return v; } } catch {}
  return null;
};
const fresh = (v, kind) => v && !v.missing && !v.gone && now() - (v.seen || 0) < KEEP[kind];
// A gone link is asked about again every RETRY_GONE; one X just failed to answer about, after a minute.
const retryDue = (v) => !v || now() - (v.checked || v.seen || 0) > (v.missing && !v.seen ? 60_000 : RETRY_GONE);

// A few reads at a time (a Pulse page brings 40-60 icons on screen at once): a hover's read goes to the front of
// the line, a warm read to the back.
const SLOTS = 6;
const line = [];
let busy = 0;
const slot = (first) => new Promise((ok) => { if (busy < SLOTS) { busy++; ok(); } else line[first ? "unshift" : "push"](ok); });
const free = () => { const next = line.shift(); if (next) next(); else busy--; };

// Reads the link now (one read per link at a time) and keeps the result. `last` is the card on file, if any.
function refresh(x, key, last, warm = false) {
  let p = reading.get(key);
  if (p) return p;
  xcardStats.reads++;
  p = slot(!warm).then(() => read(x).catch(() => null)).finally(free).then((r) => {
    const t = now();
    if (r?.card) { const v = { ...r.card, seen: t }; remember(key, x.kind, v); return v; }
    if (r?.gone) {
      // Gone: the last card seen, if there is one, stays as the card; else the link is reported gone outright.
      const v = last && !last.missing ? { ...last, gone: r.gone, checked: t } : { ...x, missing: true, reason: r.gone, seen: t, checked: t };
      remember(key, x.kind, v);
      return v;
    }
    xcardStats.failed++;
    if (last) { const v = { ...last, checked: t }; cache.set(key, { t: last.seen || t, v }); return v; }   // nothing answered: the old card stands
    const v = { ...x, missing: true, retry: true, reason: "X didn't answer just now.", seen: 0, checked: t };
    cache.set(key, { t, v });   // kept in memory only: asked again on the next hover after RETRY_GONE, never written as the truth
    return v;
  }).finally(() => reading.delete(key));
  reading.set(key, p);
  return p;
}

export async function xcard(u) {
  const x = parseX(String(u || "").slice(0, 400));
  if (!x) return { kind: "invalid" };
  const key = keyOf(x);
  if (!key) return x;
  const last = cache.get(key)?.v ?? fromDb(key);
  if (fresh(last, x.kind)) return last;
  if (last && !last.missing) {
    // A card on file: answered at once; refreshed behind the answer when due (a gone one every RETRY_GONE).
    if (!last.gone || retryDue(last)) { xcardStats.stale++; refresh(x, key, last); }
    return last;
  }
  if (last?.missing && !retryDue(last)) return last;
  return refresh(x, key, last);
}

// Reads a coin's X link ahead of anyone hovering (a few at a time, newest first), so the card is on file at once
// and a post deleted later still shows. Links already on file are left alone.
const warmQueue = [];
let warming = 0;
export function warmX(u) {
  const x = u && parseX(String(u).slice(0, 400));
  const key = x && keyOf(x);
  if (!key || cache.has(key) || reading.has(key) || warmQueue.includes(key)) return;
  if (fromDb(key)) return;
  if (warmQueue.length >= 300) warmQueue.shift();
  warmQueue.push(key);
  cache.set(key, { t: 0, v: null });   // claimed: not queued twice
  pumpWarm();
}
function pumpWarm() {
  while (warming < 3 && warmQueue.length) {
    const key = warmQueue.pop();
    const x = parseX(key.startsWith("p:") ? `https://x.com/${key.slice(2)}` : key.startsWith("c:") ? `https://x.com/i/communities/${key.slice(2)}` : `https://x.com/i/status/${key.slice(2)}`);
    warming++;
    xcardStats.warmed++;
    if (cache.get(key)?.v === null) cache.delete(key);
    refresh(x, key, null, true).finally(() => { warming--; pumpWarm(); });
  }
}
// The store never grows past this (oldest cards dropped), checked now and then.
setInterval(() => { try { const n = qCount.get()?.n || 0; if (n > 50_000) qTrim.run(n - 45_000); } catch {} }, 3600_000).unref?.();
