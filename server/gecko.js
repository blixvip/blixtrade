// GeckoTerminal's price for the coins whose Gecko chart someone has open, so the figures around that chart (the
// header's market cap, the ticker, the Pulse row) say what the chart says. The page asks /api/gecko/price/<mint>
// every few seconds while the chart is open; every 5 s one call fetches the price of every such coin at once
// (GeckoTerminal's free simple price endpoint, up to 30 coins a call, 30 calls a minute), and each price goes
// out on the stream as a market cap (price × supply) through server.js (`px`), the same way Fomo's do.
import { supplyFor } from "./fomochart.js";
import { gtGet } from "./gtgate.js";

const API = "https://api.geckoterminal.com/api/v2/simple/networks/solana/token_price/";
const FOCUS_MS = 30_000;     // a chart nobody has asked about for this long is no longer polled
const EVERY_MS = 15_000;        // 4 calls a minute at most, inside the pages' GeckoTerminal lane (gtgate.js)
let pausedUntil = 0;
const now = () => Date.now();

const focus = new Map();     // mint -> last ask
const prices = new Map();    // mint -> { price, mc, t }
const listeners = new Set();
export const onGeckoPrice = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const geckoStats = { calls: 0, failed: 0, lastError: null, last: 0, coins: 0 };

let running = false;
async function poll() {
  if (running || now() < pausedUntil) return;
  const t = now(), mints = [...focus].filter(([, at]) => t - at < FOCUS_MS).map(([m]) => m).slice(0, 30);
  geckoStats.coins = mints.length;
  if (!mints.length) return;
  running = true;
  try {
    geckoStats.calls++;
    let j;
    try { j = await gtGet(API + mints.join(","), { timeout: 10_000, rank: "normal", keyed: false }); }   // keyless lane: 4 polls a minute would burn the keyed month in days
    catch (e) { if (e.status === 429) { pausedUntil = now() + (e.held ? 15_000 : 60_000); throw new Error(e.held ? "GeckoTerminal lane full; next try in 15 s." : "GeckoTerminal answered 429 (rate limit); paused a minute."); } throw e; }
    const tp = j?.data?.attributes?.token_prices || {};
    for (const [m, v] of Object.entries(tp)) {
      const price = Number(v);
      if (!(price > 0)) continue;
      const supply = supplyFor(m), mc = supply > 0 ? price * supply : null;
      prices.set(m, { price, mc, t: now() });
      if (mc) for (const fn of listeners) try { fn(m, mc, price); } catch {}
    }
    geckoStats.last = now(); geckoStats.lastError = null;
  } catch (e) { geckoStats.failed++; geckoStats.lastError = e.message; }
  finally { running = false; }
}
setInterval(poll, EVERY_MS).unref();

// GET /api/gecko/price/<mint>: marks the chart open and answers the last price known.
export function geckoPrice(mint) {
  focus.set(mint, now());
  if (focus.size > 500) for (const [m, at] of focus) if (now() - at > 60_000) focus.delete(m);
  const p = prices.get(mint);
  return { mint, price: p?.price ?? null, mc: p?.mc ?? null, t: p?.t ?? null, error: geckoStats.lastError };
}
export const geckoStatus = () => ({ ...geckoStats, lastAgoS: geckoStats.last ? Math.round((now() - geckoStats.last) / 1000) : null });
