// Fomo's Feed (fomo.family's Feed tab): big buys and sells, closed positions, theses, profit milestones, new
// listings, price spikes, traders with a smart following and Fomo's own pinned posts, exactly as Fomo serves them
// (GET prod-api.fomo.family/feed?limit=50&feedTypes=...). Fomo only answers signed-in browsers, so it is read in
// a fomo.family tab in the user's Aside browser with Fomo's own fetch (same recipe as fomolists.js, with its own
// Aside calls so it never waits behind the leaderboard's long reads in fomoboard.js). Each filter set is
// its own feed (Fomo asks with just the chosen types); reads only run while someone has the page open (asked in
// the last WANTED_MS), at least REFRESH_MS apart. Items are kept and merged by id, newest first, so the page
// keeps what it has already shown when a later read is shorter.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasAside, runRepl, signedOutText } from "./browser.js";
import { fomoFetch } from "./fomochart.js";
import { ETH_TOO, offChain } from "./chains.js";
import { withPic } from "./people.js";

// Fomo's filter menu, in its order, and the feed types each entry asks for.
export const FEED_GROUPS = {
  trades: ["large_buy", "large_sell", "large_transfer_in", "large_transfer_out"],
  closed: ["single_user_transfer_out", "single_user_sell"],
  theses: ["thesis_created"],
  multi: ["multi_user_buy", "multi_user_sell"],
  listings: ["new_token_listing"],
  spikes: ["price_since_listing"],
  milestones: ["user_trade_profit_milestone"],
  traders: ["user_with_smart_following"],
};
const ALL = Object.keys(FEED_GROUPS);
// Read about once a second, in Aside or in the server's own browser (the user wants the Feed live to the second,
// 2026-10-10; it was every 2 s here, which with the read itself made 2.3-5.5 s between updates).
const REFRESH_MS = hasAside() ? 900 : 950, WANTED_MS = 45_000, KEEP = 200;
const now = () => Date.now();
const feeds = new Map(); // key -> { groups, items: Map(id -> item), t, error, running, wanted, fresh }
let signedOut = false;

// ---------- the feed survives a restart ----------
// Every filter set's list is written to data/fomofeed.json as it is read, and read back when the radar starts, so the
// Feed page opens onto the last posts at once after a restart instead of a blank list (or Fomo's first refusal in a
// red box). A list from disk is shown with its own time until the first good read of this run replaces it.
const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "fomofeed.json");
export const feedStore = { loaded: 0, saved: 0, lastSave: 0, error: null };
function loadStore() {
  let j;
  try { j = JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return; }
  for (const [key, r] of Object.entries(j?.feeds || {})) {
    const groups = key.split(",").filter((g) => FEED_GROUPS[g]);
    if (!groups.length || !Array.isArray(r?.items) || !(r.t > 0)) continue;
    const f = feedOf(groups.join(","));
    if (f.items.size) continue;
    for (const it of r.items.slice(0, KEEP)) if (it && typeof it.id === "string") f.items.set(it.id, it);
    // Counted as last wanted a while ago: no reads for it until a page asks, but kept (the sweep below drops only
    // lists read this run), so a page opened half an hour after a restart still opens onto posts.
    f.t = r.t; f.fresh = false; f.wanted = now() - WANTED_MS;
    feedStore.loaded++;
  }
}
let saveTimer = null;
function saveStore() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const out = {};
    for (const [key, f] of feeds) {
      const rl = f.relay && f.relay.items && f.relay.t ? f.relay : null;   // the PC's list is the better one when it is the one shown
      const items = rl ? rl.items : f.t ? [...f.items.values()] : null;
      if (items && items.length) out[key] = { t: rl ? rl.t : f.t, items: items.slice(0, KEEP) };
    }
    try { fs.writeFileSync(STORE + ".tmp", JSON.stringify({ feeds: out })); fs.renameSync(STORE + ".tmp", STORE); feedStore.saved++; feedStore.lastSave = now(); feedStore.error = null; }
    catch (e) { feedStore.error = e.message; }
  }, 10_000);
  saveTimer.unref?.();
}
// Told after every read (good or not) with the filter set's key: server/feedstream.js pushes what changed.
const listeners = new Set();
export const onFomoFeed = (fn) => (listeners.add(fn), () => listeners.delete(fn));

const num = (v) => (v == null || v === "" || !isFinite(+v) ? null : +v);
// (A person's picture, when the post comes without one, is the one Blix has on record for them: people.js.)
const user = (b, it) => b?.userHandle ? withPic({ handle: b.userHandle, name: b.displayName || b.userHandle, pic: b.userImageUrl || null,
  clan: it.clanBadge ? { name: it.clanBadge.title, pic: it.clanBadge.image } : null }) : null;

// One Fomo item, slimmed to what the page draws.
function slim(it) {
  const b = it.body || {}, tc = it.tradeComment;
  const o = {
    id: it.id, type: it.type, t: Date.parse(it.createdAt) || null, pinned: Boolean(it.pinned), likes: it.likes || tc?.numLikes || 0,
    replies: it.numReplies || 0, user: user(b, it), chain: it.networkId ?? b.networkId ?? null, mint: it.tokenAddress || b.tokenAddress || null,
    ticker: b.ticker || null, img: b.tokenImageUrl || null, mc: num(b.marketCap) ?? num(b.fdv), price: num(b.price ?? b.currentPrice),
    comment: tc?.comment || b.comment || null,
  };
  switch (it.type) {
    case "large_buy": case "large_sell": case "large_transfer_in": case "large_transfer_out": {
      const buy = it.type === "large_buy" || it.type === "large_transfer_in";
      // What changed hands, in dollars: the coin side of the swap at the swap's price.
      const tokens = num(buy ? b.outHumanAmount : b.inHumanAmount) ?? num(b.humanTokenAmount);
      return { ...o, side: buy ? "buy" : "sell", transfer: /transfer/.test(it.type), usd: tokens != null && o.price ? tokens * o.price : null,
        firstBuy: Boolean(b.isFirstBuy), pnlUsd: num(b.realizedPnlUsd), pnlPct: num(b.percentPnl), sizeUsd: num(b.currentSizeUsd) };
    }
    case "single_user_sell": case "single_user_transfer_out":
      return { ...o, pnlUsd: num(b.realizedPnlUsd), pnlPct: num(b.percentageRealizedPnl), usd: num(b.closingEventUsdAmount) };
    case "thesis_created":
      return { ...o, pnlUsd: (num(b.unrealizedPnlUsd) || 0) + (num(b.realizedPnlUsd) || 0), pnlPct: num(b.percentageUnrealizedPnl),
        entryMc: num(b.marketCapAtCreation), sizeUsd: num(b.positionNotionalUsd), dev: Boolean(b.isDev) };
    case "user_trade_profit_milestone":
      return { ...o, pnlUsd: num(b.totalPnlUsd), pnlPct: num(b.totalPercentagePnl) != null ? num(b.totalPercentagePnl) * 100 : null, sizeUsd: num(b.totalCostBasis) };
    case "multi_user_buy": case "multi_user_sell":
      return { ...o, side: it.type === "multi_user_buy" ? "buy" : "sell", users: (b.users || b.traders || []).slice(0, 6).map((u) => ({ handle: u.userHandle, name: u.displayName, pic: u.userImageUrl || u.profilePictureLink || null })),
        count: num(b.userCount ?? b.numUsers ?? b.count), usd: num(b.totalUsdAmount ?? b.usdAmount) };
    case "new_token_listing":
      return { ...o, notes: b.notes || null };
    case "price_since_listing":
      return { ...o, chg: num(b.changePercentage), listPrice: num(b.listingPrice) };
    case "user_with_smart_following":
      return { ...o, smart: num(b.smartFollowerCount), followers: it.followersData?.followerCount ?? null,
        followedBy: (it.followersData?.followers || []).slice(0, 5).map((u) => withPic({ handle: u.userHandle, name: u.displayName, pic: u.profilePictureLink || null })) };
    case "manual":
      return { ...o, user: { handle: null, name: b.displayName || "fomo", pic: null, clan: null, fomo: true }, title: b.title || null, text: b.description || null, link: b.link || null };
    default:
      return { ...o, raw: b };
  }
}

// Runs in Aside: Fomo's own fetch, in a fomo.family tab that is already open (attaching takes ~0.2 s, a read ~1 s
// end to end), so the feed refreshes every couple of seconds. An attach that hangs (a tab Aside has put to sleep)
// gives up after 5 s and the next tab is tried; with none, a new tab is opened for this call (it closes with the
// call, ~15 s). Attached tabs are left as they were.
const PAGE = (types) => `
const T0 = Date.now();
const read = async (page, tries) => {
  let res = null;
  // Give up before Aside's 120 s limit so the call ends on its own and its tab closes (a killed call leaves it open).
  for (let i = 0; i < tries && !res && Date.now() - T0 < 95_000; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1200));
    try {
      res = await Promise.race([new Promise((r) => setTimeout(() => r(null), 9000)), page.evaluate(async () => {
        const man = JSON.stringify(window.__reactRouterManifest || {});
        const urls = [...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.querySelectorAll("link[rel=modulepreload],script[src]")].map((l) => l.href || l.src), ...(man.match(/\\/assets\\/[^"]+\\.js/g) || [])];
        const ff = urls.find((n) => /\\/fomoFetch-[^/]*\\.js/.test(n));
        if (!ff) return null;
        const m = await import(ff);
        const fn = Object.values(m).find((v) => typeof v === "function" && /statusCode:401|Authorization|timing:\{|timeoutMs/.test(String(v)));
        if (!fn) return { error: "Fomo's web client changed: its fetch function was not found." };
        const types = ${JSON.stringify(types)};
        const x = await fn("/feed?limit=50&" + types.map((t) => "feedTypes=" + t).join("&"), { method: "GET" });
        if (x.statusCode === 401) return { error: "signed-out" };
        if (x.statusCode !== 200) return /Privy/i.test(String(x.message)) ? null : { error: "Fomo answered " + x.statusCode + "." };
        return { feed: x.responseObject?.feed || [] };
      })]);
    } catch (e) { res = null; }
  }
  return res;
};
const wait = (ms) => new Promise((r) => setTimeout(() => r(null), ms));
let res = null;
for (const t of (await listBrowserTabs()).filter((t) => String(t.url).startsWith("https://fomo.family/")).slice(0, 3)) {
  const pg = await Promise.race([attachBrowserTab(t.targetId).catch(() => null), wait(5000)]);
  if (pg && (res = await read(pg, 3))) break;
}
if (!res) res = await read(await openTab("https://fomo.family/"), 60);
console.log(JSON.stringify({ fomofeed: 1, ...(res || { error: "fomo.family did not load in Aside." }) }));
`;

// In Aside on the owner's PC, in the server's own headless browser elsewhere (browser.js).
const run = (script, timeoutMs = 115_000) => runRepl(script, { marker: "fomofeed", timeoutMs, what: "Fomo" });

// Fomo's /feed answers a server's own fetch with 430 "unauthorized" but a browser's plain fetch with the same
// token fine (2026-10-07), so the call is made from inside the kept fomo.family tab: the page's own fetch with
// the Privy token the tab holds, no Fomo app code needed.
// On the server it runs in the light tab (browser.js lightTab: robots.txt, same sign-in, no app code); in Aside on
// the PC in the open fomo.family tab, as before (a robots.txt there would open a new tab each read).
const TAB_URL = hasAside() ? "https://fomo.family/" : "https://fomo.family/robots.txt";
const TAB_FETCH = (types) => `
const page = await openTab("${TAB_URL}");
const res = await page.evaluate(async (types) => {
  let t = localStorage.getItem("privy:token"); if (t && t[0] === '"') { try { t = JSON.parse(t); } catch {} }
  if (!t) { const m = document.cookie.match(/(?:^|; )privy-token=([^;]+)/); t = m ? decodeURIComponent(m[1]) : null; }
  if (!t) return { error: "signed-out" };
  const r = await fetch("https://prod-api.fomo.family/feed?limit=50&" + types.map((x) => "feedTypes=" + x).join("&"), { headers: { Authorization: "Bearer " + t } });
  if (r.status === 401 || r.status === 431) return { error: "signed-out" };
  const j = await r.json().catch(() => null);
  if (r.status !== 200) return { error: "Fomo answered " + r.status + (j && j.message ? " (" + String(j.message).slice(0, 120) + ")" : "") + "." };
  return { feed: (j && j.responseObject && j.responseObject.feed) || [] };
}, ${JSON.stringify(types)}).catch((e) => ({ error: String(e.message).slice(0, 200) }));
console.log(JSON.stringify({ fomofeed: 1, ...res }));
`;

const TAB_ONLY_MS = 10 * 60_000;
let tabOnlyUntil = 0;
async function refresh(f) {
  f.running++; f.tried = now();
  try {
    const types = [...f.groups.flatMap((g) => FEED_GROUPS[g]), "manual"];
    // Straight from Fomo's API with the server's Fomo token (fomochart.js); the in-tab way when there is none.
    // Fomo turns the plain fetch away (430) for long stretches: after a refusal the tab is asked straight away for
    // TAB_ONLY_MS instead of paying for the refused call on every read.
    const x = now() < tabOnlyUntil ? { statusCode: 430 } : await fomoFetch("/feed?limit=50&" + types.map((t) => "feedTypes=" + t).join("&")).catch(() => ({ statusCode: 0 }));
    if (x.statusCode === 430 || x.statusCode === 403) { if (now() >= tabOnlyUntil) tabOnlyUntil = now() + TAB_ONLY_MS; }
    const r = x.statusCode === 200 ? { feed: x.responseObject?.feed || [] } : x.statusCode === 401 ? { error: "signed-out" }
      : x.statusCode === 430 || x.statusCode === 403 ? await run(TAB_FETCH(types), 60_000)
      : x.statusCode ? { error: `Fomo answered ${x.statusCode}${x.message ? ` (${String(x.message).slice(0, 160)})` : ""}.` } : await run(PAGE(types));
    if (r.error === "signed-out") { signedOut = true; throw new Error(signedOutText()); }
    if (r.error) throw new Error(r.error);
    signedOut = false;
    if (!Array.isArray(r.feed)) throw new Error("Fomo did not send its feed.");
    for (const it of r.feed) {
      const s = slim(it);
      if (offChain(s.chain, ETH_TOO)) continue;   // Ethereum, BNB Chain and Robinhood Chain coins stay off Blix (chains.js)
      f.items.set(s.id, s);
    }
    if (f.items.size > KEEP) {
      const keep = [...f.items.values()].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, KEEP);
      f.items = new Map(keep.map((s) => [s.id, s]));
    }
    f.t = now(); f.error = null; f.fresh = true;
    saveStore();
  } catch (e) { f.error = e.message; }
  finally { f.running--; for (const fn of listeners) try { fn(f.groups.join(",")); } catch {} }
}

// A read is due REFRESH_MS after the last good one; after a failed one, 15 s later (a stuck Aside is not hammered).
const AFTER_ERROR_MS = hasAside() ? 15_000 : 60_000;
const COLD_RETRY_MS = 5_000;   // nothing shown yet (first reads after a start): a refusal is tried again sooner
// A read takes 1-2 s from the server (the round trip to Fomo), so reads overlap: a new one starts REFRESH_MS after
// the last one started, up to OVERLAP at once (items merge by id, so the order they land in does not matter).
const OVERLAP = hasAside() ? 1 : 2;
const due = (f) => f.running < OVERLAP && now() - (f.tried || 0) > (f.error ? (f.fresh ? AFTER_ERROR_MS : COLD_RETRY_MS) : REFRESH_MS) && (!f.error || !f.running);

// The filter set's canonical key (Fomo's menu order; every entry when none are given) and its record.
const keyOf = (groupsParam) => { const groups = String(groupsParam || "").split(",").filter((g) => FEED_GROUPS[g]); return (groups.length ? ALL.filter((g) => groups.includes(g)) : ALL).join(","); };
function feedOf(key) {
  let f = feeds.get(key);
  if (!f) { f = { groups: key.split(","), items: new Map(), t: 0, error: null, running: 0, wanted: 0, relay: null, fresh: false }; feeds.set(key, f); }
  return f;
}
try { loadStore(); } catch (e) { feedStore.error = e.message; }
console.log(`[fomofeed] ${feedStore.loaded} list${feedStore.loaded === 1 ? "" : "s"} back from ${STORE}${feedStore.error ? ` (${feedStore.error})` : ""}`);
const byTime = (a, b) => Number(b.pinned) - Number(a.pinned) || (b.t || 0) - (a.t || 0);
// Only the newest pinned post stays pinned: the kept list still holds posts Fomo pinned before (yesterday's
// recap under today's), and those drop back to their place by time.
function ranked(list) {
  const top = list.reduce((m, it) => (it.pinned && (!m || (it.t || 0) > (m.t || 0)) ? it : m), null);
  return list.map((it) => (it.pinned && it !== top ? { ...it, pinned: false } : it)).sort(byTime);
}

// ---------- the feed as the owner's PC read it ----------
// On the server, Fomo's /feed turns a plain fetch away (430, even with a good token) and the headless browser's
// copy of the login dies within the hour (fomorelay.js), while Aside on the owner's PC reads it fine. So the PC
// hands this server what it read: POST /api/fomo/feed/relay (fomorelay.js there, as the owner), each filter set's
// whole list the moment a read lands there. A relayed list that is fresh (RELAY_FRESH_MS) is what fomoFeed()
// answers with, and no read of our own runs meanwhile; when the PC goes quiet, our own reading takes over again.
const RELAY_FRESH_MS = 30_000;
export const relayedStats = { posts: 0, lastAt: 0, keys: 0 };
const fresh = (f) => (f.relay && now() - f.relay.at < RELAY_FRESH_MS ? f.relay : null);
// { feeds: [{ key, t, items, error, signedOut }] } from the PC. Answers which filter sets are wanted here now.
export function relayIn(body) {
  let n = 0;
  for (const r of Array.isArray(body?.feeds) ? body.feeds : []) {
    const groups = String(r?.key || "").split(",").filter((g) => FEED_GROUPS[g]);
    if (!groups.length) continue;
    const key = keyOf(groups.join(",")), f = feedOf(key);
    const items = Array.isArray(r.items) ? r.items.filter((it) => it && typeof it.id === "string" && !offChain(it.chain, ETH_TOO)).slice(0, KEEP) : null;
    f.relay = { at: now(), t: Number(r.t) || null, items, error: r.error ? String(r.error).slice(0, 300) : null, signedOut: Boolean(r.signedOut) };
    n++;
    for (const fn of listeners) try { fn(key); } catch {}
  }
  relayedStats.posts++; relayedStats.lastAt = now(); relayedStats.keys = [...feeds.values()].filter(fresh).length;
  if (n) saveStore();
  return { ok: true, relayed: n, wanted: relayWanted() };
}
// The filter sets someone here looked at in the last RELAY_WANT_MS: what the PC should read and send. Longer
// than WANTED_MS on purpose: the next page to open (or the same one, back from another tab) finds the list
// already here instead of waiting ~10 s for the PC to read it.
const RELAY_WANT_MS = 10 * 60_000;
export const relayWanted = () => [...feeds.entries()].filter(([, f]) => now() - f.wanted < RELAY_WANT_MS).map(([k]) => k);

// GET /api/fomo/feed?groups=trades,theses,...: Fomo's feed for those filter entries (all of them when none are
// given), pinned posts first, then newest first. null items until the first read finishes. `via` says where the
// list came from: "pc" (relayed, above) or "here".
export function fomoFeed(groupsParam) {
  const f = feedOf(keyOf(groupsParam));
  f.wanted = now();
  const rl = fresh(f);
  if (rl) {
    // The PC's own list is already merged and kept; a read there that failed keeps what was read before it.
    if (rl.items) return { groups: f.groups, items: ranked([...rl.items]), t: rl.t, loading: false, error: null, signedOut: false, via: "pc" };
    if (!f.t) return { groups: f.groups, items: null, t: null, loading: false, error: rl.signedOut ? "Fomo is signed out on the owner's PC." : rl.error, signedOut: rl.signedOut, via: "pc" };
  }
  // A filter set nobody here has asked for before, while the PC is posting: its list is on the way from there
  // (the PC learns what is wanted on its next post, within 5 s, and reads it in Aside), so no read of our own,
  // which would only show its own trouble for those seconds.
  const pcAlive = now() - relayedStats.lastAt < RELAY_FRESH_MS;
  // A list the PC sent a while ago, with the PC still posting: shown now, and the fresh one is seconds away
  // (a page opens onto posts instead of an outline).
  if (!rl && pcAlive && f.relay?.items) return { groups: f.groups, items: ranked([...f.relay.items]), t: f.relay.t, loading: true, error: null, signedOut: false, via: "pc" };
  if (!rl && pcAlive && !f.t) return { groups: f.groups, items: null, t: null, loading: true, error: null, signedOut: false, via: "pc" };
  if (!rl && !pcAlive && due(f)) refresh(f);
  const items = f.t ? ranked([...f.items.values()].filter((s) => !offChain(s.chain, ETH_TOO))) : null;
  return { groups: f.groups, items, t: f.t || null, loading: f.running > 0, error: f.error, signedOut, via: "here" };
}

// A filter set's posts as held now, without asking for it (feedhot.js listens; it must never keep a feed wanted).
export function peekFeed(key) {
  const f = feeds.get(key);
  if (!f) return null;
  const rl = fresh(f);
  if (rl?.items) return rl.items;
  return f.t ? [...f.items.values()] : f.relay?.items || null;
}

// Keep reading the feeds someone is looking at; forget filter sets nobody has asked for in a while.
setInterval(() => {
  for (const [key, f] of feeds) {
    if (now() - f.wanted > 10 * 60_000 && f.fresh) { feeds.delete(key); continue; }
    if (now() - f.wanted < WANTED_MS && !fresh(f) && !(now() - relayedStats.lastAt < RELAY_FRESH_MS && !f.t) && due(f)) refresh(f);
  }
}, 250).unref();
