// Trades of an open coin that lives in a Raydium, Orca or Meteora pool, read from the chain: chartstream.js
// hears each transaction that touches the coin within the slot, and the swap is read from the transaction
// itself (txtrade.js) about a second later, when it is confirmed. Jupiter's trade list trails the chain by
// 6-10 s; these rows go into the coin's trade ring (coin.js) at once and Jupiter's later copy of the same
// transaction replaces them. pump.fun curve and PumpSwap trades are decoded from their logs instead (no
// transaction fetch), so their transactions are skipped here.
import { onCoinLogs, streamSub } from "./chartstream.js";
import { fetchSwap } from "./txtrade.js";
import { addTape, tapeGap } from "./coin.js";
import { feed, sigGate } from "./livetrades.js";
import { supplyOf } from "./jup.js";
import { db } from "./db.js";

const PUMP_PROGRAMS = ["6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"];
const RUNNING = 3;             // transactions read at once (Helius free: 10 requests a second)
const QUEUE = 60;              // a busier coin than this keeps its newest; Jupiter fills in the rest
export const tapeStats = { heard: 0, read: 0, trades: 0, dropped: 0 };
const fns = [];
// fn(mint, { mc, usd, buy }) for every trade read here (server.js moves the chart's volume with it).
export const onTxTrade = (fn) => fns.push(fn);

const kind = new Map();        // mint -> { pool: boolean, t }
function poolCoin(mint) {
  const k = kind.get(mint);
  if (k && Date.now() - k.t < 60_000) return k.pool;
  const t = db.prepare("SELECT graduated, dex FROM tokens WHERE mint = ?").get(mint);
  const pool = Boolean(t?.graduated) && t.dex !== "pumpswap" && t.dex !== "pumpfun";
  kind.set(mint, { pool, t: Date.now() }); if (kind.size > 500) kind.delete(kind.keys().next().value);
  return pool;
}

const once = sigGate(20_000), queue = [];
let running = 0;
function pump() {
  while (running < RUNNING && queue.length) {
    const [mint, sig] = queue.shift();
    // Its chart closed while this waited: Jupiter's list will have it, nobody is watching it live.
    if (!poolSubs.has(mint)) { tapeStats.dropped++; continue; }
    running++;
    fetchSwap(sig, mint, feed.solUsd).then((legs) => {
      tapeStats.read++;
      const supply = supplyOf(mint);
      if (!supply) return;
      for (const l of legs) {
        const sol = l.quote === "sol" ? l.amount : l.amount / feed.solUsd;
        if (!(sol > 0) || !(l.tokens > 0)) continue;
        const mcSol = (sol / l.tokens) * supply;
        addTape(mint, { buy: l.buy, sol, tokens: l.tokens, mcSol, user: l.wallet, slot: l.slot, sig });
        tapeStats.trades++;
        for (const fn of fns) try { fn(mint, { mc: mcSol * feed.solUsd, usd: sol * feed.solUsd, buy: l.buy }); } catch {}
      }
    }).catch(() => {}).finally(() => { running--; pump(); });
  }
}

// When the coin was last heard: after a minute of silence (its page closed, or a quiet pool) the ring may have
// missed trades, so its 5-minute figures start over from now rather than claim the whole window.
const heard = new Map();
function handle(mint, v) {
  if (!mint || !v?.signature || v.err || !poolCoin(mint)) return;
  if (Date.now() - (heard.get(mint) || 0) > 60_000) tapeGap(mint);
  heard.set(mint, Date.now()); if (heard.size > 500) heard.delete(heard.keys().next().value);
  if ((v.logs || []).some((l) => PUMP_PROGRAMS.some((p) => l.startsWith(`Program ${p}`)))) return;
  if (!once(v.signature)) return;
  tapeStats.heard++;
  queue.push([mint, v.signature]);
  if (queue.length > QUEUE) { queue.shift(); tapeStats.dropped++; }
  pump();
}
onCoinLogs(handle);

// Many swaps never name the coin's mint (Raydium AMM v4 and Orca's first swap list only the pool and its
// vaults), so a subscription by mint hears a fraction of them: BONK, 1 in 15 s. The coin's main pool is
// subscribed too while its chart is open (candles.js calls this), on the same per-coin socket and budget.
const poolSubs = new Map();   // mint -> { stop, t }
export function watchPoolLogs(mint, pool) {
  const w = poolSubs.get(mint);
  if (w) { w.t = Date.now(); return; }
  const stop = streamSub(`pool:${mint}`, "logsSubscribe", [{ mentions: [pool] }, { commitment: "processed" }], (res) => handle(mint, res?.value));
  if (stop) poolSubs.set(mint, { stop, t: Date.now() });
}
setInterval(() => {
  for (const [m, w] of poolSubs) if (Date.now() - w.t > 20_000) { try { w.stop(); } catch {} poolSubs.delete(m); }
}, 5_000).unref?.();
