// GeckoTerminal for the pages: the chart's candles, the coin page's pool trades and coin pictures. They share
// one allowance with the engine's discovery scans (sources.js spaces every GeckoTerminal call to 25 a minute;
// GeckoTerminal answers 429 well before that from this address), so page calls give way: none in the radar's
// first minute (discovery runs first, and a restart inherits the old process's spent minute), and none for a
// while after any GeckoTerminal rate limit or failure. They are also ranked: a chart's history ("high") may
// use most of a minute's page budget, pool trades ("normal") less, pictures ("low") only what is left, and
// pictures sit out three minutes after a failure.
import { getJson } from "./sources.js";
import * as health from "./health.js";
import { settings } from "./settings.js";
import { DATA } from "./db.js";
import fs from "node:fs";
import path from "node:path";

// A CoinGecko Demo key (settings.coingeckoKey, free: 100 calls a minute, 10,000 credits a month) moves the pages'
// calls to CoinGecko's on-chain API, which serves the same GeckoTerminal paths from its own allowance, so the
// chart's history no longer waits behind discovery or GeckoTerminal's ~6-a-minute cap on this address.
// Only charts ("high") and pool trades ("normal") use it: pictures ("low", tokens/multi every 30 s) never do;
// they were the bulk of the keyed calls. The count lives in data/coingecko-usage.json, so a restart does not
// start it over (it did: 49 restarts on 2026-10-11 spent most of October's credits by the 12th). A day gets
// at most KEYED_DAY calls and no more than the month's remaining credits spread over its remaining days, so
// the key stops short of CoinGecko's hard cap instead of hitting it; past the day's share, the keyless way.
const MONTH_CREDITS = 10_000, MONTH_KEEP = 9_500, KEYED_DAY = 300;
const LEDGER = path.join(DATA, "coingecko-usage.json");
const ledger = { month: "", used: 0, day: "", n: 0 };
try { Object.assign(ledger, JSON.parse(fs.readFileSync(LEDGER, "utf8"))); } catch {}
const utcDay = () => new Date().toISOString().slice(0, 10);
function roll() {
  const day = utcDay(), month = day.slice(0, 7);
  if (ledger.month !== month) { ledger.month = month; ledger.used = 0; }
  if (ledger.day !== day) { ledger.day = day; ledger.n = 0; }
}
// Today's share of the key: KEYED_DAY, or less when the month's remaining credits would not cover that every day.
function dayCap() {
  roll();
  const d = new Date();
  const daysLeft = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() - d.getUTCDate() + 1;
  return Math.max(0, Math.min(KEYED_DAY, Math.floor((MONTH_KEEP - ledger.used) / daysLeft)));
}
function save() { try { fs.writeFileSync(LEDGER, JSON.stringify(ledger)); } catch {} }
export const keyedStats = () => { roll(); return { on: Boolean(String(settings.coingeckoKey || "").trim()), today: ledger.n, cap: dayCap(), month: ledger.used, monthCredits: MONTH_CREDITS }; };
function keyedUrl(url, rank) {
  const key = String(settings.coingeckoKey || "").trim();
  if (!key || rank === "low" || !url.startsWith("https://api.geckoterminal.com/api/v2/")) return null;
  if (ledger.n >= dayCap()) return null;
  if (Date.now() - ((health.part("coingecko") || {}).lastFail || 0) < QUIET) return null;
  ledger.n++; ledger.used++; save();
  return { url: url.replace("https://api.geckoterminal.com/api/v2/", "https://api.coingecko.com/api/v3/onchain/"), key };
}

const START = Date.now();
const QUIET = 60_000;
const CAP = { high: 4, normal: 2, low: 1 };   // page calls in the last minute at which each rank stops (the lane is 4 a minute)
const recent = [];                             // when page calls were made, last minute
export const gtStats = { calls: 0, held: 0, limited: 0 };

export function gtReady(rank = "normal") {
  const t = Date.now();
  if (t - START < QUIET) return false;
  if (t - (health.part("geckoterminal").lastFail || 0) < (rank === "low" ? 3 * QUIET : QUIET)) return false;
  while (recent.length && t - recent[0] > 60_000) recent.shift();
  return recent.length < (CAP[rank] ?? CAP.normal);
}

export async function gtGet(url, { timeout = 10_000, rank = "normal", keyed = true } = {}) {
  const k = keyed ? keyedUrl(url, rank) : null;
  if (k) {
    gtStats.calls++; gtStats.keyed = (gtStats.keyed || 0) + 1;
    try { return await getJson(k.url, { timeout, lane: "keyed", headers: { "x-cg-demo-api-key": k.key } }); }
    catch (e) { if (e.status === 429) gtStats.limited++; throw e; }
  }
  if (!gtReady(rank)) {
    gtStats.held++;
    throw Object.assign(new Error("GeckoTerminal busy (page lookups wait while discovery has the allowance)"), { status: 429, held: true });
  }
  recent.push(Date.now());
  gtStats.calls++;
  try { return await getJson(url, { timeout, lane: "page" }); }
  catch (e) { if (e.status === 429) gtStats.limited++; throw e; }
}
