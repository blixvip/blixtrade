// Fomo's Feed (fomo.family's Feed tab): big buys and sells, closed positions, theses, profit milestones, new
// listings, price spikes, traders with a smart following and Fomo's own pinned posts, exactly as Fomo serves them
// (GET prod-api.fomo.family/feed?limit=50&feedTypes=...). Fomo only answers signed-in browsers, so it is read in
// a fomo.family tab in the user's Aside browser with Fomo's own fetch (same recipe as fomolists.js, with its own
// Aside calls so it never waits behind the leaderboard's long reads in fomoboard.js). Each filter set is
// its own feed (Fomo asks with just the chosen types); reads only run while someone has the page open (asked in
// the last WANTED_MS), at least REFRESH_MS apart. Items are kept and merged by id, newest first, so the page
// keeps what it has already shown when a later read is shorter.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { ASIDE_EXE } from "./fomoboard.js";

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
// Coins on Ethereum and BNB Chain stay off Blix for now (the owner's call; same as Discover's Fomo tabs).
const HIDE_CHAINS = new Set([1, 56]);
const REFRESH_MS = 4_000, WANTED_MS = 45_000, KEEP = 200;
const now = () => Date.now();
const feeds = new Map(); // key -> { groups, items: Map(id -> item), t, error, running, wanted }
let signedOut = false;

const num = (v) => (v == null || v === "" || !isFinite(+v) ? null : +v);
const user = (b, it) => b?.userHandle ? { handle: b.userHandle, name: b.displayName || b.userHandle, pic: b.userImageUrl || null,
  clan: it.clanBadge ? { name: it.clanBadge.title, pic: it.clanBadge.image } : null } : null;

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
        followedBy: (it.followersData?.followers || []).slice(0, 5).map((u) => ({ handle: u.userHandle, name: u.displayName, pic: u.profilePictureLink || null })) };
    case "manual":
      return { ...o, user: { handle: null, name: b.displayName || "fomo", pic: null, clan: null, fomo: true }, title: b.title || null, text: b.description || null, link: b.link || null };
    default:
      return { ...o, raw: b };
  }
}

// Runs in Aside: a new fomo.family tab for this call (it closes with the call; attaching to Fomo tabs already
// open can hang on ones Aside has put to sleep). Fomo's own fetch asks for the feed with these types.
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
        const fn = Object.values(m).find((v) => typeof v === "function" && /statusCode:401|Authorization/.test(String(v)));
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
const res = await read(await openTab("https://fomo.family/"), 60);
console.log(JSON.stringify({ fomofeed: 1, ...(res || { error: "fomo.family did not load in Aside." }) }));
`;

function run(script, timeoutMs = 115_000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ASIDE_EXE)) return reject(new Error("Aside isn't installed (its CLI was not found)."));
    const code = `await eval("(async () => {" + atob("${Buffer.from(script, "utf8").toString("base64")}") + "})()");`;
    const child = spawn(ASIDE_EXE, ["repl", code], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const timer = setTimeout(() => { child.kill(); reject(new Error("Aside took too long reading Fomo.")); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{"fomofeed"'));
      if (!line) return reject(new Error(out.replace(/\x1b\[[0-9;]*m/g, "").trim().slice(0, 200) || "No answer from Aside."));
      try { resolve(JSON.parse(line)); } catch { reject(new Error("Aside's answer could not be read.")); }
    });
  });
}

async function refresh(f) {
  f.running = true;
  try {
    const types = [...f.groups.flatMap((g) => FEED_GROUPS[g]), "manual"];
    const r = await run(PAGE(types));
    if (r.error === "signed-out") { signedOut = true; throw new Error("Aside is signed out of Fomo. Sign in at fomo.family in Aside."); }
    if (r.error) throw new Error(r.error);
    signedOut = false;
    if (!Array.isArray(r.feed)) throw new Error("Fomo did not send its feed.");
    for (const it of r.feed) {
      const s = slim(it);
      if (s.chain != null && HIDE_CHAINS.has(+s.chain)) continue;
      f.items.set(s.id, s);
    }
    if (f.items.size > KEEP) {
      const keep = [...f.items.values()].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, KEEP);
      f.items = new Map(keep.map((s) => [s.id, s]));
    }
    f.t = now(); f.error = null;
  } catch (e) { f.error = e.message; }
  finally { f.running = false; }
}

// GET /api/fomo/feed?groups=trades,theses,...: Fomo's feed for those filter entries (all of them when none are
// given), pinned posts first, then newest first. null items until the first read finishes.
export function fomoFeed(groupsParam) {
  const groups = String(groupsParam || "").split(",").filter((g) => FEED_GROUPS[g]);
  const key = (groups.length ? ALL.filter((g) => groups.includes(g)) : ALL).join(",");
  let f = feeds.get(key);
  if (!f) { f = { groups: key.split(","), items: new Map(), t: 0, error: null, running: false, wanted: 0 }; feeds.set(key, f); }
  f.wanted = now();
  if (!f.running && now() - f.t > REFRESH_MS) refresh(f);
  const items = f.t ? [...f.items.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.t || 0) - (a.t || 0)) : null;
  return { groups: f.groups, items, t: f.t || null, loading: f.running, error: f.error, signedOut };
}

// Keep reading the feeds someone is looking at; forget filter sets nobody has asked for in a while.
setInterval(() => {
  for (const [key, f] of feeds) {
    if (now() - f.wanted > 10 * 60_000) { feeds.delete(key); continue; }
    if (!f.running && now() - f.wanted < WANTED_MS && now() - f.t > REFRESH_MS) refresh(f);
  }
}, 2_000).unref();
