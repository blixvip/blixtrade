// The chart stream's keys. One Helius key (settings.chartWsUrl) or two (chartWsUrl2 as the spare): each has its
// own daily byte budget (chartDailyMB) and its own month at Helius (helius.js reads the real figure). The first
// key with room is the one in use; chartstream.js, fastpx.js and txtrade.js ask activeUrl() for it and switch
// sockets when the answer changes. A key is out for the day once its bytes pass the budget, and out for the
// month once Helius reports the month nearly gone (helius.js markMonth); both clear on their own.
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./db.js";
import { settings } from "./settings.js";

const MONTH_STOP_PCT = 97;      // a key this far into its month rests until the cycle resets
const day = () => new Date().toISOString().slice(0, 10);
const USAGE_FILE = path.join(DATA, "chartstream-usage.json");

const clean = (v) => String(v || "").trim();
export const keyUrls = () => [clean(settings.chartWsUrl), clean(settings.chartWsUrl2)].filter(Boolean);
// The daily budget is in Helius credits: websocket data meters 2 credits per 0.1 MB, so chartDailyMB (1400)
// is 28,000 credits a day; HTTP calls on the same key (getTransaction read-backs, holder snapshots) count too.
export const budgetBytes = () => Math.max(50, +settings.chartDailyMB || 1400) * 1e6;
export const budgetCredits = () => Math.round(budgetBytes() / 1e5 * 2);
const CALL_CREDITS = { getProgramAccounts: 10, getTransaction: 1, getSignaturesForAddress: 1, getTransactionsForAddress: 100 };

// Per-key state, by URL (a key pasted into both slots is one key).
const state = new Map();        // url -> { day, bytes, monthPct, monthUntil }
function st(url) {
  let s = state.get(url);
  if (!s) { s = { day: day(), bytes: 0, calls: 0, callCredits: 0, monthPct: null, monthUntil: 0 }; state.set(url, s); }
  if (s.day !== day()) { s.day = day(); s.bytes = 0; s.calls = 0; s.callCredits = 0; s.byMethod = {}; }
  return s;
}
const creditsOf = (s) => Math.round(s.bytes / 1e5 * 2) + s.callCredits;
// A key's budget for today, in credits: what is left of its month spread evenly over the days until it resets
// (helius.js reports both), so a key that spent fast early in its cycle slows down instead of running dry two
// weeks before the reset. Without the month figures, chartDailyMB as before. Kept between 5k and 60k a day.
const MONTH_CREDITS = () => +settings.heliusMonthCredits || 1_000_000;
export function dayBudget(url) {
  const s = st(url);
  if (s.monthPct == null || !(s.monthUntil > Date.now())) return budgetCredits();
  const left = Math.max(0, MONTH_CREDITS() * (1 - s.monthPct / 100) + creditsOf(s));   // today's spend counts toward today
  const days = Math.max(1, (s.monthUntil - Date.now()) / 86400e3);
  return Math.round(Math.min(60_000, Math.max(5_000, left / days)));
}
// Paced through the day: by any hour a key may have spent its share up to that hour plus a 3-hour head start, so
// a busy morning cannot leave the evening with nothing (on 2026-10-08 both keys were spent by ~19:00 UTC).
// Head start 12 h since 2026-10-09: the launch reads that spent both keys by ~01:00 are capped now (snipe.js), so
// the open charts are the main spender, and a 3-hour start kept a key resting all morning with half its day unspent.
const paced = (url) => { const d = new Date(); const h = d.getUTCHours() + d.getUTCMinutes() / 60; return Math.round(dayBudget(url) * Math.min(1, (h + 12) / 24)); };
export const dayUsed = (url) => creditsOf(st(url)) >= paced(url);
export const monthUsed = (url) => { const s = st(url); return s.monthPct != null && s.monthPct >= MONTH_STOP_PCT && Date.now() < s.monthUntil; };
export const keyFree = (url) => Boolean(url) && !dayUsed(url) && !monthUsed(url);

// The key in use right now: the first with room. Blank when every key is spent (or none is set).
export function activeUrl() {
  const urls = keyUrls();
  return urls.find(keyFree) || "";
}
export const keyIndex = (url) => keyUrls().indexOf(url) + 1;     // 1-based, 0 = not a configured key
export const anyKey = () => keyUrls().length > 0;
export const allSpent = () => keyUrls().length > 0 && !activeUrl();

// Bytes received on a key's sockets today.
export function noteBytes(url, bytes) {
  if (!url) return;
  st(url).bytes += bytes;
}
// An HTTP call on a key's RPC URL (the ws URL with http in front): the same key, the same month.
const wsOf = (httpUrl) => keyUrls().find((u) => u.replace(/^ws/i, "http") === httpUrl || u === httpUrl) || "";
export function noteCall(httpUrl, method) {
  const url = wsOf(httpUrl);
  if (!url) return;
  const s = st(url); s.calls++; s.callCredits += CALL_CREDITS[method] || 1;
  s.byMethod ||= {}; s.byMethod[method || "?"] = (s.byMethod[method || "?"] || 0) + 1;   // who spends (Health)
}
// helius.js: what Helius says about the key's month (so the stream rests a key before Helius cuts it off).
export function markMonth(url, pct, resetAt) {
  const s = st(url);
  s.monthPct = pct; s.monthUntil = resetAt || Date.now() + 24 * 3600e3;
}
export function keyStatus(url) {
  const s = st(url);
  return { index: keyIndex(url), bytesToday: s.bytes, callsToday: s.calls, creditsToday: creditsOf(s), dayBudget: dayBudget(url), allowedNow: paced(url), dayUsed: dayUsed(url), monthPct: s.monthPct, monthUsed: monthUsed(url), active: activeUrl() === url, byMethod: s.byMethod || {} };
}
export const bytesToday = () => keyUrls().reduce((n, u) => n + st(u).bytes, 0);

// Today's usage is kept on disk: it is what the provider bills, and a restart (several an hour while Blix is
// being worked on) used to start the count from zero, so the daily budget never held. Keys are stored by the
// last 8 characters of their URL, so the file never holds a key.
const tag = (url) => url.slice(-8);
export function loadUsage() {
  try {
    const u = JSON.parse(fs.readFileSync(USAGE_FILE, "utf8"));
    if (u.day !== day()) return;
    const urls = keyUrls();
    if (u.keys) for (const [t, v] of Object.entries(u.keys)) { const url = urls.find((x) => tag(x) === t); if (!url) continue; const s = st(url); if (typeof v === "number") s.bytes = v; else { s.bytes = +v.bytes || 0; s.calls = +v.calls || 0; s.callCredits = +v.callCredits || 0; s.byMethod = v.byMethod || {}; } }
    else if (u.bytes && urls[0]) st(urls[0]).bytes = +u.bytes || 0;    // the old one-key file
  } catch {}
}
let saved = "";
export function saveUsage() {
  const keys = Object.fromEntries(keyUrls().map((u) => { const s = st(u); return [tag(u), { bytes: s.bytes, calls: s.calls, callCredits: s.callCredits, byMethod: s.byMethod || {} }]; }));
  const text = JSON.stringify({ day: day(), bytes: bytesToday(), keys });
  if (text === saved) return;
  saved = text;
  fs.promises.writeFile(USAGE_FILE, text).catch(() => {});
}
