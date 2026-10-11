import { rpcStreamAllowed, noteRpcBytes } from "./heliuskeys.js";
// Live PumpSwap trades (pump.fun's own pool program, where a coin goes when it bonds), straight from the
// chain: subscribe to the program's logs at "processed" and decode each BuyEvent / SellEvent. Every event
// carries the pool's reserves before the trade, so the price after it is exact and lands within a slot,
// where Jupiter's price API trails by seconds. The event names the pool, not the coin: the pool's base and
// quote mints are read once per pool (getMultipleAccounts, batched) and kept. Only SOL-quoted pools of
// pump.fun coins (1B supply, 6 decimals) are priced here; anything else stays on Jupiter (pulse.js).
// A pump.fun coin is one whose mint ends in "pump" (the usual vanity suffix) or that the radar saw on the
// curve or adopted from a pump.fun feed (since 2026-10 some pump.fun mints carry no suffix: OP_CAT, MIRIAM).
// A pool with SOL on its base side and the coin as quote (anyone can open one; GUILSAM, 2026-10-08) is read
// with the sides swapped, and priced only when Jupiter knows the coin's supply (it is not a 1B pump.fun coin).
import { startRpcStream } from "./rpc-stream.js";
import { noteSlot, behindOf } from "./feedlag.js";
import { b58, rpcWsUrl, sigGate, dupes, live, twin, twinOn, startTwin, feed as liveFeed, poolMigrated } from "./livetrades.js";
import { quoteUsd } from "./pumpquote.js";
import { rpc } from "./solana.js";
import { db } from "./db.js";
import { supplyOf } from "./jup.js";

const AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const BUY = "67f4521f2cf57777", SELL = "3e2f370aa503dc2a";   // sha256("event:BuyEvent" / "event:SellEvent")[0..8]
const CREATE_POOL = "b1310cd2a076a774";   // CreatePoolEvent: a migration's pool is live (base_mint at 50, pool at 173)
const WSOL = "So11111111111111111111111111111111111111112";
const POOL_AT = 8 + 14 * 8;                                    // 14 u64 fields, then the pool, then the user
const now = () => Date.now();

const poolMint = new Map();   // pool -> coin mint, or null for a pool not priced here
const pending = new Map();    // pool -> its latest event while the pool is being looked up
const firstSeen = new Map();  // pool -> when its first event was heard, until the pool is known
const readBackAt = new Map(); // mint -> when its fresh pool was last read back (side pools open within minutes: once per coin)
export const swapFeed = { connected: false, lastMsg: 0, trades: 0, priced: 0, lookups: 0, pools: 0, error: null, sidePool: 0, unpriced: 0 };
// Kept on a function (ready before any module code runs), so a module that registers while this one is
// still loading (an import cycle) cannot hit an uninitialized binding.
function listeners() { return (listeners.list ||= []); }
// fn(mint, { mcSol, sol, tokens, buy, user, slot, sig, depth }) on every priced trade (`depth`: the pool's SOL side).
export function onPoolTrade(fn) { listeners().push(fn); }

// The pool an event is about, without decoding the rest.
export const poolOfEvent = (buf) => buf.length >= POOL_AT + 64 ? b58(buf.subarray(POOL_AT, POOL_AT + 32)) : null;
// `rev`: SOL is the pool's base and the coin its quote, so the event's sides are read the other way round (a
// BuyEvent buys SOL with the coin: a sell of the coin). `dec`: the coin's decimals (6 on pump.fun).
export function decode(buf, buy, { rev = false, dec = 6, supply = false, qmint = null, qdec = 9 } = {}) {
  if (buf.length < POOL_AT + 64) return null;
  const u = (i) => buf.readBigUInt64LE(8 + i * 8);
  let lpFee = u(9);
  let amount = u(1), quote = u(7);
  // Reserves are the pool's before the trade (checked against the next event's: they match); move them on.
  let baseR = u(5), quoteR = u(6);
  // A pool quoted in another token (PUMP, a dollar coin, another coin: since 2026-10 a coin can bond into one):
  // its quote amounts become SOL-equivalents at the quote's dollar price, so the price, the depth and the cap
  // read as for a SOL pool. Unpriceable yet (no quote price, no SOL price): null, like a pool awaiting its
  // supply. Read as SOL, a PUMP-quoted pool's trades came out 13-20x too high (714We6BW, DZ6Q25aa, 2026-10-10).
  if (qmint && qmint !== WSOL) {
    const q = quoteUsd(qmint), s = liveFeed.solUsd;
    if (!q || !(s > 0)) return null;
    const f = (q.usd / 10 ** qdec) / s * 1e9, cv = (x) => BigInt(Math.round(Number(x) * f));
    quote = cv(quote); quoteR = cv(quoteR); lpFee = cv(lpFee);
  }
  if (buy) { baseR -= amount; quoteR += quote + lpFee; } else { baseR += amount; quoteR -= quote - lpFee; }
  if (baseR <= 0n || quoteR <= 0n) return null;
  if (rev) { [amount, quote] = [quote, amount]; [baseR, quoteR] = [quoteR, baseR]; buy = !buy; }
  const tok = 10 ** dec;
  return { pool: b58(buf.subarray(POOL_AT, POOL_AT + 32)), user: b58(buf.subarray(POOL_AT + 32, POOL_AT + 64)), buy, rev, needSupply: Boolean(supply),
    // The price it traded at (SOL paid or received per token), not the reserves' ratio: on some pools the two
    // are far apart (AM, 2026-10-06: reserves $115K, every trade at $130K, as Jupiter and DexScreener show it),
    // and a chart drawn from reserves saw-toothed against every other source. A trade too small to price
    // cleanly (under 0.0005 SOL: bots spam buys of a few lamports, whose rounding makes any price) has no `exec`;
    // emit() prices it at the pool's last real trade (`mcSol` keeps the reserves' figure for other readers).
    exec: amount > 1000n && quote >= 500_000n ? (Number(quote) / 1e9) / (Number(amount) / tok) * 1e9 : null,
    mcSol: amount > 1000n && quote >= 500_000n ? (Number(quote) / 1e9) / (Number(amount) / tok) * 1e9 : (Number(quoteR) / 1e9) / (Number(baseR) / tok) * 1e9,
    sol: Number(quote) / 1e9, tokens: Number(amount) / tok, depth: Number(quoteR) / 1e9 };
}

// Anyone can open another pool for a coin, and a thin side pool can sit at 10-20x the real price (seen:
// two coins read 10x and 17x Jupiter's). A coin follows its deepest pool, the one holding the most SOL; a
// side pool takes over only when it holds more (a real migration to a new pool).
const best = new Map();   // mint -> { pool, depth }
// The pool a coin trades in, as the chain showed it (fastpx.js: a coin that bonded before the tokens table knew).
export const poolOf = (mint) => best.get(mint)?.pool ?? null;
// The pool as last heard: its address, the SOL on its quote side (depth) and when (ms). For the radar's own pool quotes (quote.js).
export const poolStateOf = (mint) => best.get(mint) ?? null;
// The last real (non-dust) trade's price per pool: a dust trade is priced at it. The reserves' ratio was the
// fallback, but on some pools it sits 10-15% under every trade (AM, ChatGPT, PIG: chain rows at 0.85x
// Jupiter's level, 2026-10-06), and bot-spammed coins are mostly dust, so most of their rows read low.
const lastExec = new Map();   // pool -> mcSol
function emit(mint, e, slot, sig = null) {
  if (e.exec != null) { lastExec.set(e.pool, e.exec); if (lastExec.size > 20_000) lastExec.delete(lastExec.keys().next().value); }
  // Dust before any real trade on its pool (a dead coin's whole tape can be dust): the reserves' ratio, which
  // the chart puts on its own level anyway, rather than no row at all (CraftPad, 2026-10-07: never journaled).
  const px = e.exec ?? (e.exec === undefined ? e.mcSol : (lastExec.get(e.pool) ?? e.mcSol));
  if (!(px > 0) || px > 1e8) return;
  e = { ...e, mcSol: px };
  const b = best.get(mint);
  // A deeper pool's claim lapses when it has not traded for 30 s: a claim that never lapsed once silenced a coin's
  // real pool for good (IA, 2026-10-06: every trade decoded, none shown).
  if (b && b.pool !== e.pool && e.depth <= b.depth && Date.now() - b.t < 30_000) { swapFeed.sidePool++; return; }
  // A real pool starts with ~85 SOL and still holds tens at a few thousand dollars; under 3 SOL is a side pool.
  if (!b && e.depth < 3) return;
  if (!b && best.size > 60_000) best.clear();
  best.set(mint, { pool: e.pool, depth: e.depth, t: Date.now() });
  swapFeed.priced++;
  // The cap above is on 1B tokens; a coin with burned tokens has fewer (Jupiter's circulating supply, the
  // scale the chart is drawn in). Every listener (candles, Pulse, the chart's live push) gets it scaled.
  // A coin that is not a pump.fun coin (a swapped pool, or no pump.fun history): without its supply the cap would
  // be made up, so its trades wait until Jupiter has said it (supplyOf asks; a few seconds).
  const sup = supplyOf(mint);
  if (e.needSupply && !sup) { swapFeed.unpriced++; return; }
  const mcSol = e.mcSol * ((sup ?? 1e9) / 1e9);
  // `supply`: the tokens that cap is on, so a reader can get back to a price per token (pumpquote.js prices other
  // curves in this coin: PUMP's cap on 463B tokens read as a cap on 1B put every PUMP-quoted coin 460x too high).
  for (const fn of listeners()) fn(mint, { mcSol, sol: e.sol, tokens: e.tokens, buy: e.buy, user: e.user, slot, sig, depth: e.depth, rev: Boolean(e.rev), supply: sup ?? 1e9 });
}

// Unknown pools are read in batches of up to 100, a few times a second at most.
let lookTimer = null;
function lookSoon() { if (!lookTimer) lookTimer = setTimeout(lookup, 250); }
async function lookup() {
  const pools = [...pending.keys()].slice(0, 100);
  if (!pools.length) { lookTimer = null; return; }
  try {
    // "confirmed": a pool made by a migration seconds ago is not finalized yet; read at the default
    // (finalized) it came back missing and was remembered as not ours for 10 minutes, and every trade of a
    // freshly bonded coin's first 10 minutes was skipped (Ajf5gdXT, 2026-10-07: 0 of 28 pool trades journaled).
    const r = await rpc("getMultipleAccounts", [pools, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 43, length: 64 } }]);
    swapFeed.lookups++;
    for (const [i, a] of (r?.value || []).entries()) {
      const pool = pools[i], ev = pending.get(pool);
      pending.delete(pool);
      let mint = null, info = null;
      if (a && a.owner === AMM) {
        const d = Buffer.from(a.data[0], "base64");
        const base = b58(d.subarray(0, 32)), quote = b58(d.subarray(32, 64));
        if (quote === WSOL && base !== WSOL) {
          if (isPump(base)) mint = base;   // a pump.fun coin: 1B supply, 6 decimals, nothing to look up
          // Another coin the radar lists, in a normal pool: priced once Jupiter says its supply (emit()).
          else if (tracked(base)) { mint = base; info = { rev: false, dec: await decimalsOf(base), supply: true }; }
        } else if (base === WSOL && quote !== WSOL && (quote.endsWith("pump") || tracked(quote))) { mint = quote; info = { rev: true, dec: await decimalsOf(quote), supply: true }; }
        // The coin against another token (PUMP, a dollar coin, another coin): priced at the quote's dollar price (decode).
        else if (quote !== WSOL && base !== WSOL && (isPump(base) || tracked(base))) {
          const qdec = await decimalsOf(quote);
          if (qdec != null) { mint = base; info = { rev: false, dec: isPump(base) ? 6 : await decimalsOf(base), supply: !isPump(base), qmint: quote, qdec }; quoteUsd(quote); }
        }
      } else if (!a) {
        // Not on the node yet (just created), or the radar already knows the pair from the tokens table.
        const known = knownPair(pool);
        // Only a pump.fun coin can be priced without its pool account (1B supply, 6 decimals); any other coin's
        // decimals, supply and side are unknown here, and pricing it as pump.fun put its cap off by 1000x
        // (Tategold, 9 decimals and 3.7M supply, 2026-10-08): it waits for the account like an unknown pool.
        if (known && isPump(known)) mint = known;
        else { const n = (tries.get(pool) || 0) + 1; if (n <= 5) { tries.set(pool, n); if (ev) pending.set(pool, ev); swapFeed.retried = (swapFeed.retried || 0) + 1; continue; } }
      }
      tries.delete(pool);
      remember(pool, mint, info);
      if (mint && ev) { const e = decode(ev.buf, ev.buy, info || undefined); if (e) emit(mint, e, ev.slot, ev.sig); }
    }
  } catch { for (const p of pools) pending.delete(p); }   // tried again on the pool's next trade
  lookTimer = null;
  if (pending.size) lookTimer = setTimeout(lookup, [...pending.keys()].every((p) => tries.has(p)) ? 2000 : 250);
}
const tries = new Map();        // pool -> lookups that found no account yet (a pool made moments ago)
const pairQ = db.prepare("SELECT mint FROM tokens WHERE pair = ?");
const knownPair = (pool) => { try { return pairQ.get(pool)?.mint || null; } catch { return null; } };
// A pump.fun coin: the vanity suffix, or one the radar saw trade on the curve, or adopted from a pump.fun feed.
const pumpQ = db.prepare("SELECT 1 FROM tokens WHERE mint = ? AND (source LIKE 'pump%' OR dex = 'pumpfun')");
function isPump(mint) {
  if (mint.endsWith("pump") || live.has(mint)) return true;
  try { return Boolean(pumpQ.get(mint)); } catch { return false; }
}
// A coin the radar lists at all (any source): worth pricing from its pool once its supply is known.
const anyQ = db.prepare("SELECT 1 FROM tokens WHERE mint = ?");
function tracked(mint) { try { return Boolean(anyQ.get(mint)); } catch { return false; } }
// A coin's decimals (its mint account, byte 44), for a swapped pool; 6 when unreadable.
async function decimalsOf(mint) {
  try { const r = await rpc("getAccountInfo", [mint, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 44, length: 1 } }], 2); const d = r?.value ? Buffer.from(r.value.data[0], "base64")[0] : null; return d >= 0 && d <= 18 ? d : 6; } catch { return 6; }
}
const poolInfo = new Map();     // pool -> { rev, dec } for pools read the other way round (normal pools have no entry)
const unpricedAt = new Map();   // pool -> when it was found not to be priced here
// fn(mint, sinceMs): a pool that read as "not ours" turned out to be this coin's (its trades since then were
// skipped; journalfeed.js reads them back from the chain).
const learned = [];
export const onPoolLearned = (fn) => learned.push(fn);
// What this feed knows of a pool, for trades read back from the chain (journalfeed.js): the coin (undefined:
// never heard, null: not priced here) and its sides.
export const knownMint = (pool) => poolMint.get(pool);
export const poolInfoOf = (pool) => poolInfo.get(pool) ?? null;
function remember(pool, mint, info = null) {
  if (poolMint.size > 60_000) { poolMint.clear(); unpricedAt.clear(); poolInfo.clear(); firstSeen.clear(); }
  if (info) poolInfo.set(pool, info); else poolInfo.delete(pool);
  const missedSince = mint && poolMint.get(pool) === null ? unpricedAt.get(pool) : null;
  // A fresh migration's pool, heard for the first time: between its first event and this answer only its latest
  // event was kept, and those first seconds (snipers moving the price most, a 3x in a minute on 3DqVEvHW,
  // 2026-10-10) drew as one tall candle. Read back from the chain, as a pool mistaken for "not ours" is.
  // Only for a coin whose curve filled minutes ago (livetrades.js completeAt): after a restart every live pool is
  // heard anew, and a guard on "traded lately" read back 1,300 pools in six minutes (2026-10-11 03:49 UTC).
  const s = mint && !poolMint.has(pool) ? live.get(mint) : null;
  let fresh = s?.completeAt && now() - s.completeAt < 10 * 60_000 ? firstSeen.get(pool) ?? null : null;
  if (fresh && now() - (readBackAt.get(mint) || 0) < 10 * 60_000) fresh = null;
  if (fresh) { readBackAt.set(mint, now()); if (readBackAt.size > 5000) readBackAt.delete(readBackAt.keys().next().value); }
  firstSeen.delete(pool);
  poolMint.set(pool, mint);
  const since = missedSince ?? fresh;
  if (since) for (const fn of learned) { try { fn(mint, since - 5000); } catch {} }
  if (mint === null) unpricedAt.set(pool, Date.now()); else unpricedAt.delete(pool);
  swapFeed.pools = poolMint.size;
}

// A pool event found later in a confirmed block (journalfeed.js, for the trades the log stream skipped): the
// coin and the trade priced as emit() would price it, from what this feed knows of the pool. Null for a pool
// it has not priced (not ours, or never heard), a side pool, or a coin whose supply is not known yet.
export function decodeKnown(buf, buy) {
  const pool = poolOfEvent(buf), mint = pool ? poolMint.get(pool) : null;
  if (!mint) return null;
  const e = decode(buf, buy, poolInfo.get(pool));
  if (!e) return null;
  const b = best.get(mint);
  if (b ? b.pool !== pool && e.depth <= b.depth : e.depth < 3) return null;
  const px = e.exec ?? lastExec.get(pool) ?? e.mcSol;
  const sup = supplyOf(mint);
  if (!(px > 0) || px > 1e8 || (e.needSupply && !sup)) return null;
  return { mint, buy: e.buy, sol: e.sol, tokens: e.tokens, user: e.user, mcSol: px * ((sup ?? 1e9) / 1e9), supply: sup ?? 1e9 };
}

// One logs notification's value; shared by the program-wide stream below and chartstream.js.
const firstSwap = sigGate();
export function swapLogs(v, slot = null, src = null) {
  if (!v || v.err) return;
  if (!firstSwap(v.signature)) { dupes.swap = (dupes.swap || 0) + 1; return; }
  if (src === "twin") twin.swap.first++;
  for (const l of v.logs || []) {
    if (!l.startsWith("Program data: ")) continue;
    const buf = Buffer.from(l.slice(14), "base64");
    if (buf.length < 8) continue;
    const disc = buf.toString("hex", 0, 8);
    // A pool just created for a coin whose curve this radar watched: its migration is over this instant.
    if (disc === CREATE_POOL) { if (buf.length >= 205) { const mint = b58(buf.subarray(50, 82)); if (live.has(mint)) poolMigrated(mint, b58(buf.subarray(173, 205)), now(), "pool-feed"); } continue; }
    if (disc !== BUY && disc !== SELL) continue;
    const pool = poolOfEvent(buf);
    if (!pool) continue;
    swapFeed.trades++;
    const mint = poolMint.get(pool), buy = disc === BUY;
    if (mint) { const e = decode(buf, buy, poolInfo.get(pool)); if (e) emit(mint, e, slot, v.signature || null); }
    // A pool not priced here is looked at again after 10 minutes (an answer read mid-migration is not final).
    else if (mint === undefined || (mint === null && Date.now() - (unpricedAt.get(pool) || 0) > 10 * 60_000)) { if (!firstSeen.has(pool)) firstSeen.set(pool, now()); pending.set(pool, { buf, buy, slot, sig: v.signature || null }); lookSoon(); }
    else swapFeed.unpriced++;
  }
}

export function startPumpSwap() {
  // Every pool is read once on its first trade (100 a call, batched): a pair from the tokens table says which coin,
  // not which way round the pool is, and one read the wrong way round prices a coin at nonsense.
  swapFeed.pools = poolMint.size;
  // The twin feed on the other public endpoint (livetrades.js twinUrl): the first copy of a swap counts.
  if (twinOn()) startTwin(twin.swap, () => swapFeed.url, { method: "logsSubscribe", params: [{ mentions: [AMM] }, { commitment: "processed" }] }, (d) => {
    noteSlot("pumpswap-twin", d.params?.result?.context?.slot);
    swapLogs(d.params?.result?.value, d.params?.result?.context?.slot ?? null, "twin");
  });
  return startRpcStream({ admit: rpcStreamAllowed, meter: noteRpcBytes,
    url: () => (swapFeed.url = rpcWsUrl()),
    request: { method: "logsSubscribe", params: [{ mentions: [AMM] }, { commitment: "processed" }] },
    behind: () => behindOf("pumpswap"),
    onStatus: ({ connected, error }) => { swapFeed.connected = connected; swapFeed.error = error; if (connected) swapFeed.lastMsg = now(); },
    onEvent: (d) => {
      swapFeed.lastMsg = now();
      noteSlot("pumpswap", d.params?.result?.context?.slot);
      swapLogs(d.params?.result?.value, d.params?.result?.context?.slot ?? null);
    },
  });
}
