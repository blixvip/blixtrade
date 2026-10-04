// GeckoTerminal for the pages: the chart's candles, the coin page's pool trades and coin pictures. They share
// one allowance with the engine's discovery scans (sources.js spaces every GeckoTerminal call to 25 a minute;
// GeckoTerminal answers 429 well before that from this address), so page calls give way: none in the radar's
// first minute (discovery runs first, and a restart inherits the old process's spent minute), and none for a
// while after any GeckoTerminal rate limit or failure. They are also ranked: a chart's history ("high") may
// use most of a minute's page budget, pool trades ("normal") less, pictures ("low") only what is left, and
// pictures sit out three minutes after a failure.
import { getJson } from "./sources.js";
import * as health from "./health.js";

const START = Date.now();
const QUIET = 60_000;
const CAP = { high: 9, normal: 6, low: 3 };   // page calls in the last minute at which each rank stops
const recent = [];                             // when page calls were made, last minute
export const gtStats = { calls: 0, held: 0, limited: 0 };

export function gtReady(rank = "normal") {
  const t = Date.now();
  if (t - START < QUIET) return false;
  if (t - (health.part("geckoterminal").lastFail || 0) < (rank === "low" ? 3 * QUIET : QUIET)) return false;
  while (recent.length && t - recent[0] > 60_000) recent.shift();
  return recent.length < (CAP[rank] ?? CAP.normal);
}

export async function gtGet(url, { timeout = 10_000, rank = "normal" } = {}) {
  if (!gtReady(rank)) {
    gtStats.held++;
    throw Object.assign(new Error("GeckoTerminal busy (page lookups wait while discovery has the allowance)"), { status: 429, held: true });
  }
  recent.push(Date.now());
  gtStats.calls++;
  try { return await getJson(url, { timeout }); }
  catch (e) { if (e.status === 429) gtStats.limited++; throw e; }
}
