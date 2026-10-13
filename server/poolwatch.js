// The open chart's price straight from its pool, for coins that trade outside PumpSwap (Raydium, Orca,
// Meteora). Jupiter's trade index, which their candles otherwise come from, runs 6-10 s behind the chain
// (measured 2026-10-06); the pool's own account changes within the slot of every swap. While a coin's chart
// is open its pool is subscribed at "processed" and every change is decoded into a price. These are prices,
// not trades (no size): they draw the newest seconds, and Jupiter's candles (with volume) replace them as its
// index catches up.
//
// Concentrated pools carry the price in their state (Orca Whirlpool, Raydium / PancakeSwap CLMM: sqrt price;
// Meteora DLMM: the active bin; Meteora DAMM v2: sqrt price). Constant-product pools (Raydium CPMM, AMM v4) are
// priced from their two vaults, less the fees parked in them that are not liquidity.
import { startRpcStream } from "./rpc-stream.js";
import { priceStreamAllowed, notePriceBytes } from "./heliuskeys.js";
import { rpcWsUrl, b58 } from "./livetrades.js";
import { rpc } from "./solana.js";
import { streamSub } from "./chartstream.js";
import { canStream } from './coin-screen.js';

const WSOL = "So11111111111111111111111111111111111111112";
const USD = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);   // USDC, USDT
const now = () => Date.now();
const u64 = (b, o) => Number(b.readBigUInt64LE(o));
const u128 = (b, o) => b.readBigUInt64LE(o) + (b.readBigUInt64LE(o + 8) << 64n);
const key = (b, o) => b58(b.subarray(o, o + 32));
// (sqrt price as Q64.64)^2: token 1 per token 0 in raw units.
const sq = (x) => { const f = Number(x) / 2 ** 64; return f * f; };

// Per program: where the two mints are, and the raw price of mint 1 in mint 0's units (or the vaults to read).
export const PROGRAMS = {
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: { name: "Orca Whirlpool", m0: 101, m1: 181, price: (b) => sq(u128(b, 65)) },
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: { name: "Raydium CLMM", m0: 73, m1: 105, price: (b) => sq(u128(b, 253)) },
  HpNfyc2Saw7RKkQd8nEL4khUcuPhQ7WwY1B2qjx8jxFq: { name: "PancakeSwap CLMM", m0: 73, m1: 105, price: (b) => sq(u128(b, 253)) },
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: { name: "Meteora DLMM", m0: 88, m1: 120, price: (b) => (1 + b.readUInt16LE(80) / 10_000) ** b.readInt32LE(76) },
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: { name: "Meteora DAMM v2", m0: 168, m1: 200, price: (b) => sq(u128(b, 456)) },
  // Constant product: vaults, and the fees inside them that are not liquidity.
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: { name: "Raydium CPMM", m0: 168, m1: 200, v0: 72, v1: 104, fees: (b) => [u64(b, 341) + u64(b, 357), u64(b, 349) + u64(b, 365)] },
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": { name: "Raydium AMM v4", m0: 400, m1: 432, v0: 336, v1: 368, fees: (b) => [u64(b, 192), u64(b, 200)] },
};

// What a pool is: its program, which side is the coin, the quote, both decimals and (constant product) vaults.
const decimals = new Map();
async function decimalsOf(mints) {
  const want = mints.filter((m) => !decimals.has(m));
  if (want.length) {
    const r = await rpc("getMultipleAccounts", [want, { encoding: "base64", dataSlice: { offset: 44, length: 1 } }]);
    (r?.value || []).forEach((a, i) => { if (a) decimals.set(want[i], Buffer.from(a.data[0], "base64")[0]); });
  }
  return mints.map((m) => decimals.get(m));
}
export async function describe(pool, mint) {
  const r = await rpc("getAccountInfo", [pool, { encoding: "base64" }]);
  const a = r?.value, p = a && PROGRAMS[a.owner];
  if (!p) return null;
  const b = Buffer.from(a.data[0], "base64");
  const m0 = key(b, p.m0), m1 = key(b, p.m1);
  if (m0 !== mint && m1 !== mint) return null;
  const quote = m0 === mint ? m1 : m0;
  if (quote !== WSOL && !USD.has(quote)) return null;      // priced in SOL or dollars only
  const [d0, d1] = await decimalsOf([m0, m1]);
  if (d0 == null || d1 == null) return null;
  return { pool, mint, program: a.owner, name: p.name, coinIs0: m0 === mint, quote, d0, d1, v0: p.v0 ? key(b, p.v0) : null, v1: p.v1 ? key(b, p.v1) : null, state: b };
}

// The coin's price in its quote (SOL or USD) from the pool state and, for constant product, the vault balances.
export function priceOf(d, state, bal0, bal1) {
  const p = PROGRAMS[d.program];
  let raw;   // token 1 per token 0, raw units
  if (p.price) raw = p.price(state);
  else {
    const [f0, f1] = p.fees(state);
    if (!(bal0 > f0) || !(bal1 > f1)) return null;
    raw = (bal1 - f1) / (bal0 - f0);
  }
  if (!(raw > 0) || !isFinite(raw)) return null;
  const ui = raw * 10 ** (d.d0 - d.d1);                  // token 1 per token 0, whole tokens
  return d.coinIs0 ? ui : 1 / ui;
}

// ---------- the watcher: one open chart's pool at a time per coin, dropped when the chart closes ----------
// Kept on a function (ready before any module code runs), so a module that registers while this one is
// still loading (an import cycle) cannot hit an uninitialized binding.
function listeners() { return (listeners.list ||= []); }
// fn(mint, { px, quote }): the coin's price in SOL (quote WSOL) or USD, every time its pool changes.
export function onPoolPrice(fn) { listeners().push(fn); }
export const poolStats = { watching: 0, updates: 0, errors: 0, lastError: null };
const watches = new Map();   // mint -> { d, stops, state, b0, b1, t, last }

function emit(w) {
  const px = priceOf(w.d, w.state, w.b0, w.b1);
  if (!(px > 0) || px === w.last) return;
  w.last = px;
  poolStats.updates++;
  for (const fn of listeners()) fn(w.d.mint, { px, quote: w.d.quote === WSOL ? "sol" : "usd" });
}
// An open chart's pool rides the per-coin socket (Helius: the public RPC trails it by up to ~4 s at p90);
// `shared` false (the SOL price, watched all day) stays on the public one, outside the per-coin daily budget.
function sub(account, onData, shared = true) {
  const fast = shared && streamSub(`acct:${account}`, "accountSubscribe", [account, { encoding: "base64", commitment: "processed" }],
    (res) => { const v = res?.value; if (v?.data?.[0]) onData(Buffer.from(v.data[0], "base64")); });
  if (fast) return fast;
  return startRpcStream({
    admit: priceStreamAllowed, meter: notePriceBytes,
    url: rpcWsUrl,
    request: { method: "accountSubscribe", params: [account, { encoding: "base64", commitment: "processed" }] },
    silentMs: 120_000,
    onStatus: ({ error }) => { if (error) { poolStats.errors++; poolStats.lastError = String(error).slice(0, 160); } },
    onEvent: (m) => { const v = m.params?.result?.value; if (v?.data?.[0]) onData(Buffer.from(v.data[0], "base64")); },
  });
}
const tokenAmount = (b) => (b.length >= 72 ? u64(b, 64) : null);

// Keep `mint`'s pool watched for another 15 s (the chart asks for candles every second or so while open).
// `forever`: never dropped (the SOL price below).
export function watchPool(mint, pool, forever = false) {
  if (!forever && !canStream(mint)) return;
  const w = watches.get(mint);
  if (w) { w.t = now(); return; }
  const entry = { forever, t: now(), stops: [], state: null, b0: null, b1: null, last: null, d: null };
  watches.set(mint, entry);
  describe(pool, mint).then(async (d) => {
    if (!d || watches.get(mint) !== entry || (!forever && !canStream(mint))) { if (!d) entry.dead = true; return; }
    entry.d = d; entry.state = d.state;
    if (d.v0) {
      const r = await rpc("getMultipleAccounts", [[d.v0, d.v1], { encoding: "base64", dataSlice: { offset: 64, length: 8 } }]);
      const [a0, a1] = r?.value || [];
      if (watches.get(mint) !== entry || (!forever && !canStream(mint))) return;
      if (a0) entry.b0 = u64(Buffer.from(a0.data[0], "base64"), 0);
      if (a1) entry.b1 = u64(Buffer.from(a1.data[0], "base64"), 0);
      entry.stops.push(sub(d.v0, (b) => { entry.b0 = tokenAmount(b) ?? entry.b0; emit(entry); }, !forever), sub(d.v1, (b) => { entry.b1 = tokenAmount(b) ?? entry.b1; emit(entry); }, !forever));
    }
    entry.stops.push(sub(pool, (b) => { entry.state = b; emit(entry); }, !forever));
    poolStats.watching = [...watches.values()].filter((x) => x.d).length;
    emit(entry);
  }).catch((e) => { entry.dead = true; poolStats.errors++; poolStats.lastError = e.message; });
}
// A coin whose chart has been closed for 15 s: its subscriptions go.
setInterval(() => {
  for (const [m, w] of watches) if (w.forever && !w.dead) continue; else if (!canStream(m) || now() - w.t > 15_000 || (w.dead && now() - w.t > 60_000)) { for (const s of w.stops) try { s(); } catch {} watches.delete(m); }
  poolStats.watching = [...watches.values()].filter((x) => x.d).length;
}, 5_000).unref?.();

// SOL in dollars from the deepest SOL/USDC pool (Orca, 0.01% from Jupiter's price when checked), every slot it
// moves: every SOL-quoted market cap is multiplied by it, and Jupiter's own is refreshed only once a minute.
export const SOL_POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
export const watchSol = () => watchPool(WSOL, SOL_POOL, true);
