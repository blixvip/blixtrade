// Solana RPC access and swap parsing. Works on the free public RPC (slow, ~1 tx lookup/s);
// a custom RPC URL in Settings (e.g. a free Helius key) makes wallet tracking much faster.
import { settings } from "./settings.js";

export const WSOL = "So11111111111111111111111111111111111111112";
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT = "Es9vMFrajDsTVEb4f3xFeKbSkqvn9rk8Y3Y7xMhRzTsH";
const QUOTES = new Set([WSOL, USDC, USDT]);

const PUBLIC = "https://api.mainnet-beta.solana.com";
const url = () => settings.rpcUrl?.trim() || PUBLIC;
const isPublic = () => url() === PUBLIC;

// Per-method pacing. The public endpoint limits each method separately and punishes bursts.
const pace = new Map();
const gap = (method) => {
  if (!isPublic()) return 110;                         // ~9 req/s: fine for Helius free tier
  return method === "getTransaction" ? 1100 : 450;
};
let cooldownUntil = 0;
export const rpcStats = { calls: 0, errors: 0, limited: 0, last: 0 };

export async function rpc(method, params, tries = 3) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const wait = Math.max(cooldownUntil, (pace.get(method) || 0)) - Date.now();
    pace.set(method, Math.max(Date.now(), pace.get(method) || 0) + gap(method));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    rpcStats.calls++;
    rpcStats.last = Date.now();
    let body;
    try {
      const r = await fetch(url(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.status === 429) { rpcStats.limited++; cooldownUntil = Date.now() + 4000 * (attempt + 1); continue; }
      body = await r.json();
    } catch (e) {
      rpcStats.errors++;
      if (attempt === tries - 1) throw e;
      continue;
    }
    if (body.error) {
      if (/too many requests/i.test(body.error.message)) { rpcStats.limited++; cooldownUntil = Date.now() + 4000 * (attempt + 1); continue; }
      rpcStats.errors++;
      throw new Error(body.error.message);
    }
    return body.result;
  }
  throw new Error(`${method}: rate limited`);
}

export const signatures = (address, opts = {}) => rpc("getSignaturesForAddress", [address, { limit: 20, ...opts }]);
export const transaction = (sig) => rpc("getTransaction", [sig, { maxSupportedTransactionVersion: 1, encoding: "jsonParsed", commitment: "confirmed" }]);

const amount = (b) => Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals;

// What `wallet` bought or sold in this transaction. Returns [{ mint, side, tokens, sol, usd }].
// SOL spent includes wrapped SOL; USDC/USDT legs are counted in USD.
export function parseSwaps(tx, wallet) {
  if (!tx || tx.meta?.err) return [];
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const i = keys.indexOf(wallet);
  const payer = keys[0] === wallet;
  let sol = i >= 0 ? (tx.meta.postBalances[i] - tx.meta.preBalances[i] + (payer ? tx.meta.fee : 0)) / 1e9 : 0;
  let stable = 0;
  const tokens = new Map();
  const add = (b, sign) => {
    if (b.owner !== wallet) return;
    const v = amount(b) * sign;
    if (b.mint === WSOL) sol += v;
    else if (b.mint === USDC || b.mint === USDT) stable += v;
    else tokens.set(b.mint, (tokens.get(b.mint) || 0) + v);
  };
  for (const b of tx.meta.preTokenBalances || []) add(b, -1);
  for (const b of tx.meta.postTokenBalances || []) add(b, +1);
  const moved = [...tokens].filter(([, d]) => Math.abs(d) > 0);
  if (!moved.length) return [];
  // A swap moves one token against SOL or a stablecoin in the opposite direction.
  // Token-only moves (airdrops, transfers) have no quote leg and are skipped.
  if (moved.length > 1) return [];
  const [mint, d] = moved[0];
  const side = d > 0 ? "buy" : "sell";
  const quoteSol = Math.abs(sol) > 0.0005 ? Math.abs(sol) : 0;
  const quoteUsd = Math.abs(stable) > 0.01 ? Math.abs(stable) : 0;
  if (!quoteSol && !quoteUsd) return [];
  if (side === "buy" && sol > 0.0005 && !quoteUsd) return [];   // received both token and SOL: not a buy
  if (side === "sell" && sol < -0.0005 && !quoteUsd) return []; // gave both away: not a sell
  return [{ mint, side, tokens: Math.abs(d), sol: quoteSol, usd: quoteUsd || null, t: (tx.blockTime || 0) * 1000 }];
}

export const isQuote = (mint) => QUOTES.has(mint);
export const validAddress = (a) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a || "");
