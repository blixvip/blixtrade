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

// A CoinGecko Demo key (settings.coingeckoKey, free: 100 calls a minute, 10,000 credits a month) moves the pages'
// calls to CoinGecko's on-chain API, which serves the same GeckoTerminal paths from its own allowance, so the
// chart's history no longer waits behind discovery or GeckoTerminal's ~6-a-minute cap on this address. At most
// KEYED_DAY calls a day (about 300 keeps the month inside 10,000); past that, the keyless way for the rest of the day.
const KEYED_DAY = 300;
const keyed = { day: "", n: 0 };
export const keyedStats = () => ({ on: Boolean(String(settings.coingeckoKey || "").trim()), today: keyed.day === new Date().toISOString().slice(0, 10) ? keyed.n : 0, cap: KEYED_DAY });
function keyedUrl(url) {
  const key = String(settings.coingeckoKey || "").trim();
  if (!key || !url.startsWith("https://api.geckoterminal.com/api/v2/")) return null;
  const day = new Date().toISOString().slice(0, 10);
  if (keyed.day !== day) { keyed.day = day; keyed.n = 0; }
  if (keyed.n >= KEYED_DAY) return null;
  if (Date.now() - ((health.part("coingecko") || {}).lastFail || 0) < QUIET) return null;
  keyed.n++;
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
  const k = keyed ? keyedUrl(url) : null;
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
