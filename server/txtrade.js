import { heliusFetch as fetch } from "./heliuskeys.js";
// One swap of a coin, read from its transaction, for pools whose logs say nothing decodable (Raydium, Orca,
// Meteora). chartstream.js hears the signature within the slot; the transaction is fetched at "confirmed"
// (about a second later) from the per-coin RPC, and the trade is read from the token balances before and
// after it, which every pool program leaves the same way:
//   - the trader is the signer;
//   - each pool is an owner whose coin and quote token (SOL or a dollar coin) moved opposite ways: its change in
//     the coin is the size and side, in the quote what was paid or received, fees included, as the pool booked it.
// Native SOL is never a pool balance (pools hold wrapped SOL), so the quote side is always a token balance.
import { settings } from "./settings.js";
import { activeUrl } from "./heliuskeys.js";

export const WSOL = "So11111111111111111111111111111111111111112";
export const USD_QUOTES = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
export const txStats = { fetched: 0, parsed: 0, misses: 0, errors: 0, skipped: 0, lastError: null };
// One a second: the public RPC paces this IP, which also carries the Pulse feeds (solana.js keeps ~1/1.1 s).
const RATE = 1;
let bucket = RATE, filled = Date.now();
function take() {
  const t = Date.now();
  bucket = Math.min(RATE, bucket + ((t - filled) / 1000) * RATE); filled = t;
  if (bucket < 1) return false;
  bucket--; return true;
}

// Transactions are read from the public RPC (free; a second slower than Helius but none of its credits: at a
// few reads a second one busy pool would spend Helius free's month in days). holderslive.js still reads the
// coin's accounts from Helius (coinRpcUrl).
const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
const txRpcUrl = () => String(settings.rpcUrl || "").trim() || PUBLIC_RPC;
// The per-coin RPC over HTTP: the same Helius key as the chart websocket (settings.chartWsUrl), else the main one.
export function coinRpcUrl() {
  const ws = activeUrl();
  if (ws) return ws.replace(/^ws/i, "http");
  return String(settings.rpcUrl || "").trim() || "https://api.mainnet-beta.solana.com";
}

// Owner -> { mint -> change in whole tokens } from a transaction's pre/post token balances.
function deltas(meta) {
  const by = new Map();
  const add = (b, sign) => {
    if (!b?.owner || !b.mint) return;
    const v = +(b.uiTokenAmount?.uiAmountString ?? b.uiTokenAmount?.uiAmount ?? 0) * sign;
    let o = by.get(b.owner); if (!o) by.set(b.owner, (o = new Map()));
    o.set(b.mint, (o.get(b.mint) || 0) + v);
  };
  for (const b of meta.preTokenBalances || []) add(b, -1);
  for (const b of meta.postTokenBalances || []) add(b, +1);
  return by;
}

// The trades of `mint` in a transaction, one per pool it went through ([] when it is not a swap of it against
// SOL or dollars). An arbitrage buys and sells the coin in one transaction: each leg is a trade, as Jupiter and
// every terminal list them. A leg is an owner other than the signer whose coin and quote moved opposite ways
// (a pool); the signer is the trader. `tx`: getTransaction's answer (encoding "json" or "jsonParsed").
export function parseSwaps(tx, mint, solUsd = 150) {
  const meta = tx?.meta;
  if (!meta || meta.err) return [];
  const keys = tx.transaction?.message?.accountKeys || [];
  const signer = typeof keys[0] === "string" ? keys[0] : keys[0]?.pubkey;
  if (!signer) return [];
  const out = [];
  for (const [owner, m] of deltas(meta)) {
    if (owner === signer) continue;
    const d = m.get(mint) || 0;
    if (!(Math.abs(d) > 0)) continue;
    // The quote it traded against: the one that moved most in dollars (a pool authority shared by many pools,
    // like Raydium's, can show crumbs of another quote from a second pool in the same transaction).
    let quote = null, amount = 0, worth = 0;
    for (const q of [WSOL, ...USD_QUOTES]) { const x = m.get(q) || 0, v = Math.abs(x) * (q === WSOL ? solUsd : 1); if (v > worth) { worth = v; amount = x; quote = q; } }
    // A pool that lost coins took quote in (someone bought), and the other way round.
    if (!quote || Math.sign(amount) !== -Math.sign(d)) continue;
    out.push({ wallet: signer, buy: d < 0, tokens: Math.abs(d), quote: quote === WSOL ? "sol" : "usd", amount: Math.abs(amount), pool: owner, slot: tx.slot ?? null, blockTime: tx.blockTime ?? null });
  }
  return out;
}

async function rpcCall(method, params) {
  const r = await fetch(txRpcUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`RPC HTTP ${r.status}${r.status === 429 ? " rate limit" : ""}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

// The trades in the transaction behind `sig`, as soon as it is confirmed: tried a few times, a slot or two apart.
export async function fetchSwap(sig, mint, solUsd = 150) {
  for (let i = 0; i < 6; i++) {
    // At most RATE reads a second for the whole radar (Helius free allows 10, and the radar's other calls share
    // them); a read over the limit is skipped, not queued: Jupiter's list has the trade a few seconds later.
    if (!take()) { txStats.skipped++; return []; }
    try {
      const tx = await rpcCall("getTransaction", [sig, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]);
      txStats.fetched++;
      if (tx) { const s = parseSwaps(tx, mint, solUsd); if (s.length) txStats.parsed++; else txStats.misses++; return s; }
    } catch (e) { txStats.errors++; txStats.lastError = e.message; if (/429|rate|limit/i.test(e.message)) return []; }
    await new Promise((ok) => setTimeout(ok, 350 + i * 250));
  }
  return [];
}
