// Pictures for the Feed and Fomo's lists, fetched the moment a list lands instead of when a page first asks.
//
// Measured on blixvip.com (2026-10-08): 23 s after opening the Feed, 61 of 77 avatars and 27 of 71 coin logos were
// still missing. Each avatar was a cold fetch on the server (through wsrv.nl, 2-5 s) the first time anyone asked,
// and coins the radar had never met had no known picture source at all, though Fomo and pump.fun send one with
// every post. So, as each list lands:
//   - every Solana coin's own picture link is handed to images.js (hint) and the coin's logo fetched (warm), so
//     /img/<mint> answers from disk by the time the page asks;
//   - every avatar, clan icon and the first posts' photos are asked of the page server (/api/pic, pagepics.js) at
//     exactly the sizes the page draws them (lib/thumb.ts, Feed.tsx), so its answer is a disk read.
import http from "node:http";
import { hint, warm } from "./images.js";

const SOL = 1399811149;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// The hosts the page server fetches pictures from (pagepics.js HOSTS, lib/thumb.ts VIA_BLIX): the same list.
const VIA_BLIX = /(^|\.)(s3\.amazonaws\.com|twimg\.com|mobula\.io|pump\.fun|mypinata\.cloud|pinata\.cloud|ipfs\.io|dweb\.link|dexscreener\.com|axiom-cdn\.io|fomo\.family|arweave\.net|cloudfront\.net|googleusercontent\.com|imgur\.com|discordapp\.com|discord\.com)$/i;
const PAGE_PORT = Number(process.env.BLIX_WEB_PORT) || 4421;
const IN_FLIGHT = 6, MEDIA_POSTS = 15;

const done = new Set();   // "<url>|<w>|<fit>" asked for already (pagepics.js keeps it from then on)
const queue = [];
let flying = 0;
export const feedWarmStats = { asked: 0, ok: 0, failed: 0, hinted: 0 };

// The size the page asks for: lib/thumb.ts thumb(src, px) asks w = 2 × px.
function want(url, px, fit = "cover") {
  if (typeof url !== "string" || !url.startsWith("https://") || url.length > 1500) return;
  let host = "";
  try { host = new URL(url).hostname; } catch { return; }
  if (!VIA_BLIX.test(host)) return;
  const w = Math.min(2000, Math.round(px * 2)), key = `${url}|${w}|${fit}`;
  if (done.has(key)) return;
  if (done.size > 30_000) done.clear();
  done.add(key);
  queue.push({ url, w, fit });
  pump();
}
function pump() {
  while (flying < IN_FLIGHT && queue.length) {
    const { url, w, fit } = queue.shift();
    flying++; feedWarmStats.asked++;
    const req = http.get({ host: "127.0.0.1", port: PAGE_PORT, path: `/api/pic?u=${encodeURIComponent(url)}&w=${w}&fit=${fit}`, headers: { host: `localhost:${PAGE_PORT}` } }, (r) => {
      r.resume();
      r.on("end", () => { feedWarmStats[r.statusCode === 200 ? "ok" : "failed"]++; flying--; pump(); });
    });
    req.on("error", () => { feedWarmStats.failed++; flying--; pump(); });
    req.setTimeout(20_000, () => req.destroy());
  }
}

// A coin in a list: its logo fetched now, from the link the list gave if the radar knows no other.
function coin(mint, chain, img) {
  if (typeof mint !== "string" || !MINT.test(mint) || (chain != null && chain !== SOL)) return null;
  if (img && hint(mint, img)) feedWarmStats.hinted++;
  return mint;
}

// The Feed's posts (fomofeed.js / pumpfeed.js items), as Feed.tsx draws them: the poster at 36 px (16 px in the
// grouped view), the faces of a multi-user trade or "followed by" at 20 px, a clan icon at 16 px, a coin that is
// not on Solana at 48 px, photos at 680 px wide.
export function warmFeed(items) {
  if (!Array.isArray(items)) return;
  const mints = [];
  items.forEach((it, i) => {
    if (!it || typeof it !== "object") return;
    const m = coin(it.mint, it.chain, it.img);
    if (m) mints.push(m); else if (it.img) want(it.img, 48);
    if (it.user?.pic) { want(it.user.pic, 36); want(it.user.pic, 16); }
    if (it.user?.clan?.pic) want(it.user.clan.pic, 16);
    for (const u of [...(it.users || []), ...(it.followedBy || [])]) if (u?.pic) want(u.pic, 20);
    if (i < MEDIA_POSTS && it.media) want(it.media, 680, "inside");
  });
  if (mints.length) warm(mints);
}

// Fomo's lists (fomolists.js rows): every Solana coin's logo, from Fomo's own link when the radar has none.
export function warmList(rows) {
  if (!Array.isArray(rows)) return;
  const mints = [];
  for (const r of rows) { const m = coin(r?.mint, r?.chain, r?.img); if (m) mints.push(m); else if (r?.img) want(r.img, 48); }
  if (mints.length) warm(mints);
}

// The Top traders boards (fomoboard.js, pumpboard.js rows), as Traders.tsx and Trader.tsx draw them: a trader at
// 56 px on the podium, 40 px in the table, 96 px on their profile; a holding not on Solana at 48 px (TokenPic).
// Asked once each (done), so calling this on every answer of the board costs nothing after the first.
export function warmBoard(rows) {
  if (!Array.isArray(rows)) return;
  const mints = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    if (r.pic) { want(r.pic, 56); want(r.pic, 40); want(r.pic, 96); }
    const top = typeof r.top === "string" ? (() => { try { return JSON.parse(r.top); } catch { return []; } })() : r.top;
    for (const h of Array.isArray(top) ? top : []) { const m = coin(h?.mint, h?.chain, h?.img); if (m) mints.push(m); else if (h?.img) want(h.img, 48); }
  }
  if (mints.length) warm(mints);
}
