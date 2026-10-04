// Live trades and launches from Raydium LaunchLab, the program behind Bonk (letsbonk.fun) and the other
// launchpads built on it. Free, the same way as pump.fun: the program prints every TradeEvent and
// PoolCreateEvent in its logs, so one websocket subscription shows the whole market.
//
// Two things the events leave out, and what is done about each:
//  - They name the pool, not the coin. Each pool's account is read once (which coin, priced in what, how
//    many decimals) and remembered on disk. Many pools are priced in something other than SOL (a dollar
//    coin, a tokenized stock, another memecoin): those are turned into SOL at Jupiter's price for it.
//  - They do not say who traded, so these coins have no trader count or holder ledger.
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./db.js";
import { rpc, WSOL, USDC, USDT } from "./solana.js";
import { startRpcStream } from "./rpc-stream.js";
import { recordTrade, announceCreate, feed, b58, rpcWsUrl } from "./livetrades.js";
import { jupiterGet } from "./jupiter.js";

const LAUNCHLAB = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
const TRADE = "bddb7fd34ee661ee";            // anchor discriminator of TradeEvent
const CREATE = "97d7e20976a173ae";           // ... and of PoolCreateEvent
const USD1 = "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB";
const DOLLARS = new Set([USD1, USDC, USDT]);
const now = () => Date.now();

export const labStats = { connected: false, error: null, lastMsg: 0, trades: 0, creates: 0, waiting: 0, unpriced: 0, lookups: 0, lookupErrors: 0 };
// pool address -> { mint, quote, q, b, supply } (quote: what it is priced in; q, b: one whole unit of the
// quote and of the coin).
const pools = new Map();
const quoteUsd = new Map();                  // quote token -> its dollar price, from Jupiter
const wanted = new Map();                    // pool -> { tries, meta } waiting for its account to be read
let changed = false;

// The pool account, by position (checked against live pools 2026-10-04): status 17, coin decimals 18,
// quote decimals 19, supply 21, coin mint 205, quote mint 237.
export function readPool(d) {
  if (d.length < 269) return null;
  const mint = b58(d.subarray(205, 237)), quote = b58(d.subarray(237, 269));
  return { mint, quote, q: 10 ** d[19], b: 10 ** d[18], supply: Number(d.readBigUInt64LE(21)) };
}

// How many SOL one unit of a pool's quote token is worth right now; null until its price is known.
export function quoteInSol(quote, solUsd = feed.solUsd, known = feed.solKnown) {
  if (quote === WSOL) return 1;
  const usd = DOLLARS.has(quote) ? 1 : quoteUsd.get(quote);
  return usd > 0 && known && solUsd > 0 ? usd / solUsd : null;
}

// What one TradeEvent says, in SOL, given its pool and what its quote token is worth in SOL.
export function readTrade(buf, p, toSol) {
  if (buf.length < 147) return null;
  const u = (i) => Number(buf.readBigUInt64LE(40 + i * 8));
  const totalSell = u(0), vBase = u(1), vQuote = u(2), rBase = u(5), rQuote = u(6), amountIn = u(7), amountOut = u(8);
  const buy = buf[144] === 0;
  const vSol = ((vQuote + rQuote) / p.q) * toSol, vTok = (vBase - rBase) / p.b;
  if (!(vTok > 0) || !(vSol > 0)) return null;
  const fees = u(9) + u(10) + u(11) + u(12), bps = buy && amountIn > 0 ? Math.round((fees / amountIn) * 1e4) : 0;
  return {
    mint: p.mint, buy, user: null, vSol, vTok,
    sol: ((buy ? amountIn : amountOut) / p.q) * toSol, tokens: (buy ? amountOut : amountIn) / p.b,
    mcSol: (vSol / vTok) * (p.supply / p.b),
    progress: buf[145] !== 0 ? 1 : totalSell > 0 ? rBase / totalSell : 0,   // status past "funding" = it has bonded
    feeBps: bps > 0 && bps < 1000 ? bps : null,
    pad: p.mint.endsWith("bonk") ? "bonk" : "launchlab",
  };
}

export function readCreate(buf) {
  let o = 105;                                 // 8 + pool, creator, config (32 each) + decimals
  const str = () => { const n = buf.readUInt32LE(o); if (n > 400) throw new Error("bad string"); const v = buf.toString("utf8", o + 4, o + 4 + n); o += 4 + n; return v; };
  return { pool: b58(buf.subarray(8, 40)), creator: b58(buf.subarray(40, 72)), name: str().slice(0, 64), symbol: str().slice(0, 32), uri: str().slice(0, 300) };
}

function want(pool, meta = null) {
  const w = wanted.get(pool);
  if (w) { if (meta) w.meta = meta; return; }
  if (wanted.size >= 800) return;
  wanted.set(pool, { tries: 0, meta });
}

// Reads waiting pools one at a time (the free RPC allows only a few calls a second). New launches go first.
let busy = false;
async function lookups() {
  if (busy || !wanted.size) return;
  busy = true;
  try {
    for (let n = 0; n < 6 && wanted.size; n++) {
      const [pool, w] = [...wanted].find(([, x]) => x.meta) || wanted.entries().next().value;
      labStats.lookups++;
      let p = null;
      try {
        const r = await rpc("getAccountInfo", [pool, { encoding: "base64", commitment: "processed" }], 2);
        if (r?.value?.owner === LAUNCHLAB) p = readPool(Buffer.from(r.value.data[0], "base64"));
      } catch (e) { labStats.lookupErrors++; if (e.limited) break; }
      if (!p) { if (++w.tries >= 4) wanted.delete(pool); continue; }   // a pool seconds old may not be readable yet
      wanted.delete(pool);
      pools.set(pool, p); changed = true;
      if (w.meta) {
        labStats.creates++;
        const pad = p.mint.endsWith("bonk") ? "bonk" : "launchlab";
        announceCreate({ mint: p.mint, name: w.meta.name, symbol: w.meta.symbol, uri: w.meta.uri, creator: w.meta.creator, pool: pad, source: `${pad}-chain` });
      }
    }
  } finally { busy = false; labStats.waiting = wanted.size; }
}

function onLog(buf, slot) {
  const disc = buf.toString("hex", 0, 8);
  if (disc === CREATE) {
    try { const c = readCreate(buf); want(c.pool, c); } catch {}
    return;
  }
  if (disc !== TRADE || buf.length < 147) return;
  const pool = b58(buf.subarray(8, 40)), p = pools.get(pool);
  if (!p) return want(pool);
  const toSol = quoteInSol(p.quote);
  if (!toSol) return;
  const t = readTrade(buf, p, toSol);
  if (!t) return;
  labStats.trades++;
  recordTrade({ ...t, slot });
}

const FILE = path.join(DATA, "launchlab-pools.json");
function load() {
  try { for (const [k, v] of JSON.parse(fs.readFileSync(FILE, "utf8"))) if (v.quote) pools.set(k, v); } catch {}
}

// Dollar prices for every quote token in use that is not SOL or a dollar coin, refreshed every 30 seconds.
async function quotePrices() {
  const need = [...new Set([...pools.values()].map((p) => p.quote))].filter((m) => m !== WSOL && !DOLLARS.has(m));
  for (let i = 0; i < need.length; i += 50) {
    try {
      const j = await jupiterGet(`/price/v3?ids=${need.slice(i, i + 50).join(",")}`, { timeout: 6000, cacheMs: 20_000 });
      for (const m of need.slice(i, i + 50)) { const px = +j?.[m]?.usdPrice; if (px > 0) quoteUsd.set(m, px); }
    } catch {}
  }
  labStats.unpriced = need.filter((m) => !quoteUsd.has(m)).length;
}
async function save() {
  if (!changed) return;
  changed = false;
  try {
    // Newest 6,000 pools: an older one that trades again is simply read again.
    const rows = [...pools].slice(-6000);
    await fs.promises.writeFile(FILE + ".tmp", JSON.stringify(rows));
    await fs.promises.rename(FILE + ".tmp", FILE);
  } catch {}
}

export function startLaunchLab() {
  load();
  startRpcStream({
    url: rpcWsUrl,
    request: { method: "logsSubscribe", params: [{ mentions: [LAUNCHLAB] }, { commitment: "processed" }] },
    onStatus: ({ connected, error }) => { labStats.connected = connected; labStats.error = error; if (connected) labStats.lastMsg = now(); },
    onEvent: (d) => {
      labStats.lastMsg = now();
      const v = d.params?.result?.value;
      if (!v || v.err) return;
      const slot = d.params.result.context?.slot ?? null;
      // Only what LaunchLab itself printed counts: another program in the same transaction (pump.fun's
      // TradeEvent shares this event name, and so its discriminator) must not be read as a LaunchLab trade.
      const stack = [];
      for (const l of v.logs || []) {
        if (l.startsWith("Program data: ")) {
          if (stack[stack.length - 1] !== LAUNCHLAB) continue;
          const buf = Buffer.from(l.slice(14), "base64");
          if (buf.length > 8) onLog(buf, slot);
        } else if (l.endsWith("]") && l.includes(" invoke [")) stack.push(l.slice(8, l.indexOf(" invoke [")));
        else if (l.endsWith(" success") || l.includes(" failed")) { if (l.startsWith("Program ") && !l.startsWith("Program log")) stack.pop(); }
      }
    },
  });
  setInterval(lookups, 1500);
  setInterval(save, 60_000);
  quotePrices();
  setInterval(quotePrices, 30_000);
}
