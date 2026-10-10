// Fomo, from the owner's PC to the server. fomo.family only answers a signed-in session, and Privy (Fomo's
// sign-in) lets one browser renew that session: a copy of the PC's login put on the server (bin/fomo-session.mjs)
// died within the hour every time, because Aside on the PC kept renewing the same session and the server's copy
// fell behind. So the PC, where Aside holds the login and renews it, hands the server two things, as the owner
// (the server's gate takes the owner's cookie signed with the memberKey both sides hold, webapp.js cookieMember):
//
// 1. The one-hour access token (fomochart.js setFomoToken over POST /api/fomo/token): the server reads Fomo's
//    lists, board and chart bars straight from Fomo's API with it, and never has to renew anything. Every
//    2 minutes: the token in hand (re-read, and renewed in Aside, when under 15 minutes are left) is sent when it
//    is new, or every 20 minutes anyway, so a server that restarted has it again within that.
// 2. The Feed page's lists themselves (fomofeed.js relayIn over POST /api/fomo/feed/relay): Fomo's /feed turns
//    the server's own fetch away (430) even with a good token, while Aside here reads it fine. The server says
//    which filter sets its viewers want (the answer to every post); each of those is read here as if someone on
//    this PC were looking, and sent the moment a read lands, or every 20 s anyway. A short post every 5 s keeps
//    the wanted list current while nothing is being looked at.
//
// Runs only where Aside is (the PC) and settings.fomoRelayTo names a server.
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { settings } from "./settings.js";
import { hasAside } from "./browser.js";
import { fomoToken, fomoTokenExp } from "./fomochart.js";
import { fomoFeed, onFomoFeed } from "./fomofeed.js";
import { coinFomo, coinRow } from "./fomoboard.js";
import { logEvent } from "./db.js";

const EVERY_MS = 2 * 60_000, RENEW_UNDER_MS = 15 * 60_000, RESEND_MS = 20 * 60_000;
const now = () => Date.now();
export const relayStats = { on: false, to: null, sent: 0, lastSent: 0, lastExp: 0, lastError: null, feeds: { wanted: [], sent: 0, lastSent: 0, lastError: null, bytes: 0 },
  coins: { wanted: [], sent: 0, lastSent: 0, lastError: null, bytes: 0 } };
const target = () => String(settings.fomoRelayTo || "").trim().replace(/\/+$/, "");
const enabled = () => hasAside() && /^https:\/\//.test(target()) && String(settings.memberKey || "").length >= 32;

// The server's gate (webapp.js cookieMember) takes the owner's cookie the Worker would set: signed with the
// memberKey both sides hold, good for two hours from its time.
function ownerCookie() {
  const t = String(now()), email = "pc-relay@blix";
  const sig = crypto.createHmac("sha256", settings.memberKey).update(`${email}.${t}.cookie.owner`).digest("hex");
  return `blix_m=${Buffer.from(email, "utf8").toString("base64url")}.${t}.1.${sig}`;
}
// POST JSON to the server as the owner; the answer parsed. Bodies over 2 KB go gzipped (a feed list is ~50 KB).
async function post(path, body, timeoutMs) {
  const text = JSON.stringify(body), zip = text.length > 2048;
  const r = await fetch(`${target()}${path}`, {
    method: "POST", body: zip ? gzipSync(text) : text, signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", ...(zip ? { "content-encoding": "gzip" } : {}), origin: "https://blixvip.com", cookie: ownerCookie() },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${r.status} ${j.error || ""}`.trim());
  return { j, bytes: zip ? gzipSync(text).length : text.length };
}

// ---------- the sign-in token ----------
let last = { value: null, at: 0 }, running = false;
async function tick() {
  relayStats.on = enabled();
  if (running || !relayStats.on) return;
  running = true; relayStats.to = target();
  try {
    const tok = await fomoToken(RENEW_UNDER_MS);
    if (!tok) throw new Error("No Fomo sign-in token on this PC (is Aside signed in at fomo.family?).");
    const exp = fomoTokenExp();
    if (tok === last.value && now() - last.at < RESEND_MS) return;
    const { j } = await post("/api/fomo/token", { token: tok, exp }, 20_000);
    const first = !relayStats.sent;
    last = { value: tok, at: now() }; relayStats.sent++; relayStats.lastSent = now(); relayStats.lastExp = exp; relayStats.lastError = null;
    if (first) logEvent("fomo", `Fomo sign-in token handed to ${relayStats.to} (good for ${j.expiresInMin} min; sent again as it renews)`);
  } catch (e) {
    if (relayStats.lastError !== e.message) logEvent("error", `Fomo sign-in relay: ${e.message}`);
    relayStats.lastError = e.message;
  } finally { running = false; }
}

// ---------- the feed ----------
const FEED_HEARTBEAT_MS = 5_000, FEED_RESEND_MS = 20_000;
let wanted = [];                 // filter-set keys the server's viewers want, as it last said
const sentFeeds = new Map();     // key -> { t, error, at } as last sent
let feedBusy = false, feedAgain = false;

async function sendFeeds() {
  relayStats.on = enabled();
  if (!relayStats.on) return;
  if (feedBusy) { feedAgain = true; return; }
  feedBusy = true;
  try {
    const feeds = [];
    for (const key of wanted) {
      const r = fomoFeed(key);   // also keeps this PC reading it in Aside (wanted here as well)
      const was = sentFeeds.get(key);
      if (was && was.t === r.t && was.error === r.error && now() - was.at < FEED_RESEND_MS) continue;
      if (!r.t && !r.error && !r.signedOut) continue;   // nothing read yet: nothing to say
      feeds.push({ key, t: r.t, items: r.items, error: r.error, signedOut: r.signedOut });
      sentFeeds.set(key, { t: r.t, error: r.error, at: now() });
    }
    const { j, bytes } = await post("/api/fomo/feed/relay", { feeds }, 15_000);
    const next = Array.isArray(j.wanted) ? j.wanted.filter((k) => typeof k === "string" && k.length < 200).slice(0, 12) : [];
    // A filter set the server's viewers just started looking at: read it here right away.
    for (const k of next) if (!wanted.includes(k)) fomoFeed(k);
    wanted = next;
    relayStats.feeds.wanted = next;
    if (feeds.length) { relayStats.feeds.sent++; relayStats.feeds.lastSent = now(); relayStats.feeds.bytes += bytes; }
    if (relayStats.feeds.lastError) logEvent("fomo", `Fomo feed relay to ${relayStats.to} is back`);
    relayStats.feeds.lastError = null;
  } catch (e) {
    if (relayStats.feeds.lastError !== e.message) logEvent("error", `Fomo feed relay: ${e.message}`);
    relayStats.feeds.lastError = e.message;
    for (const key of wanted) sentFeeds.delete(key);   // sent again on the next turn
  } finally {
    feedBusy = false;
    if (feedAgain) { feedAgain = false; sendFeeds(); }
  }
}

// ---------- one coin's Fomo page (known holders, theses) ----------
// Fomo answers these only to a signed-in browser, so the server's coin pages get them from here: every few
// seconds the server says which coins its pages have open (wanted), this PC reads each in Aside (fomoboard.js
// coinFomo, the same read its own coin pages use) and posts the result the moment it is in.
const COIN_EVERY_MS = 2_500;
let coinWanted = [], coinBusy = false;
const sentCoins = new Map();   // mint -> t of the read last sent
async function sendCoins() {
  if (!enabled() || coinBusy) return;
  coinBusy = true;
  try {
    const coins = {};
    for (const m of coinWanted) {
      coinFomo(m);   // keeps it read here (a read older than 3 minutes is read again)
      const row = coinRow(m);
      if (!row || sentCoins.get(m) === row.t) continue;
      try { coins[m] = { t: row.t, data: JSON.parse(row.data) }; } catch { continue; }
      sentCoins.set(m, row.t);
    }
    const { j, bytes } = await post("/api/fomo/coin/relay", { coins }, 15_000);
    const next = Array.isArray(j.wanted) ? j.wanted.filter((m) => typeof m === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)).slice(0, 8) : [];
    for (const m of next) if (!coinWanted.includes(m)) coinFomo(m);   // a coin page just opened there: read it now
    coinWanted = next;
    if (sentCoins.size > 500) sentCoins.clear();
    relayStats.coins.wanted = next;
    const n = Object.keys(coins).length;
    if (n) { relayStats.coins.sent += n; relayStats.coins.lastSent = now(); relayStats.coins.bytes += bytes; }
    relayStats.coins.lastError = null;
  } catch (e) {
    if (relayStats.coins.lastError !== e.message) logEvent("error", `Fomo coin relay: ${e.message}`);
    relayStats.coins.lastError = e.message;
    for (const m of coinWanted) sentCoins.delete(m);
  } finally { coinBusy = false; }
}

// Not for a copy on its own data folder (the tests): that must never drive the real Aside.
if (!process.env.RADAR_DATA) {
  setTimeout(tick, 15_000).unref();
  setInterval(tick, EVERY_MS).unref();
  setTimeout(sendFeeds, 5_000).unref();
  setInterval(sendFeeds, FEED_HEARTBEAT_MS).unref();
  setTimeout(sendCoins, 6_000).unref();
  setInterval(sendCoins, COIN_EVERY_MS).unref();
  // A read landed for a filter set the server wants: on its way at once.
  onFomoFeed((key) => { if (wanted.includes(key)) sendFeeds(); });
}
