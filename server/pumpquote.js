// pump.fun curves quoted in a token other than SOL (2026-10: USDC, tokenized stocks like GOOGLx/USO, other
// coins). Their TradeEvent has SOL amount and virtual SOL reserves 0; the quote side sits at the event's end:
//   quote mint (32 bytes) at length-80, quote amount at length-48, virtual quote reserves at length-40,
//   real quote reserves at length-32 (u64, in the quote token's own decimals).
// The event carries the instruction's name as a string in the middle ("buy", "sell", "buy_exact_sol_in"), so the
// end is the only fixed anchor (lengths 382 / 383 / 395+ seen). The radar skipped all of these (about 7% of curve
// trades, 2026-10-09): their market cap read as 0. They are priced here in dollars from the quote token's Jupiter
// price, then handed on as SOL-equivalents, so every reader downstream (live stats, chart, journal, holders) works
// as for a SOL curve.
import { jupiterGet } from "./jupiter.js";

const WSOL = "So11111111111111111111111111111111111111112";
// Dollar coins are a dollar (Jupiter's own figure wobbles a few hundredths of a cent).
const DOLLARS = new Map([
  ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6],   // USDC
  ["Es9vMFrajDsTVEb4f3xFeKbSkqvn9rk8Y3Y7xMhRzTsH", 6],   // USDT
  ["USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB", 6],    // USD1
]);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf) {
  let zeros = 0;
  while (zeros < buf.length && buf[zeros] === 0) zeros++;
  const d = new Uint8Array(((buf.length * 138) / 100 + 1) | 0);
  let len = 0;
  for (let i = zeros; i < buf.length; i++) {
    let c = buf[i];
    for (let j = 0; j < len; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; }
    while (c > 0) { d[len++] = c % 58; c = (c / 58) | 0; }
  }
  let s = "1".repeat(zeros);
  for (let j = len - 1; j >= 0; j--) s += B58[d[j]];
  return s;
}

export const quoteStats = { trades: 0, unpriced: 0, mints: 0, lookups: 0, errors: 0, local: 0 };
// A quote token Jupiter does not price (a young coin quoted against another young coin): the radar's own live
// price when it trades it on a curve (livetrades.js sets this; pump.fun coins have 6 decimals).
let localUsd = () => null;
export const setLocalPrice = (fn) => { localUsd = fn; };
const prices = new Map();   // quote mint -> { usd, dec, t }
const wanted = new Set();
let timer = null;
function want(mint) {
  if (prices.has(mint) || wanted.size > 500) return;
  wanted.add(mint);
  if (!timer) timer = setTimeout(lookup, 1500);
}
// Every quote token in use: its dollar price and decimals from Jupiter's price API, 50 at a time; known ones again
// every 30 s (a stock or a coin moves).
async function lookup() {
  timer = null;
  const due = [...prices].filter(([m, p]) => !DOLLARS.has(m) && Date.now() - p.t > 30_000).map(([m]) => m);
  const ids = [...new Set([...wanted, ...due])];
  wanted.clear();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    quoteStats.lookups++;
    try {
      const j = await jupiterGet(`/price/v3?ids=${part.join(",")}`, { timeout: 6000, cacheMs: 20_000 });
      for (const m of part) {
        const usd = +j?.[m]?.usdPrice, dec = Number(j?.[m]?.decimals);
        if (usd > 0 && Number.isInteger(dec) && dec >= 0 && dec <= 12) prices.set(m, { usd, dec, t: Date.now() });
      }
    } catch { quoteStats.errors++; }
  }
  quoteStats.mints = prices.size;
}
setInterval(() => { if (!timer && prices.size > DOLLARS.size) timer = setTimeout(lookup, 0); }, 30_000).unref?.();
for (const [m, dec] of DOLLARS) prices.set(m, { usd: 1, dec, t: Infinity });

// A quote token's dollar price and decimals, for a pool quoted in it (pumpswap.js decode): Jupiter's figure, a
// dollar coin's, or the radar's own live price of a young coin; null (and asked for) until one is known.
export function quoteUsd(mint) {
  const p = prices.get(mint);
  if (p) return p;
  // The radar's own figure serves until Jupiter's arrives (asked for either way: Jupiter's is the one to keep).
  want(mint);
  const l = localUsd(mint);
  if (l > 0) return { usd: l, dec: 6, t: Date.now() };
  return null;
}

// A TradeEvent (pump.fun's, discriminator checked by the caller) of a curve quoted in another token, as a trade in
// SOL-equivalents at `solUsd`: { mint, tokens, buy, user, sol, mcSol, vSol, vTok, rTok, quote, usd, mcUsd }.
// null when it is a SOL curve or unreadable; { pending: true } when its quote token has no price yet (asked for:
// the caller leaves the transaction to be read again a few seconds later, journalfeed.js sweep / blocks).
export function quotedTrade(buf, solUsd) {
  if (!(solUsd > 0) || buf.length < 8 + 32 + 8 + 8 + 1 + 32 + 8 + 8 * 4 + 80) return null;
  const vSolRaw = buf.readBigUInt64LE(97);
  if (vSolRaw !== 0n) return null;                       // a SOL curve: livetrades.js reads it as before
  const L = buf.length, quote = b58(buf.subarray(L - 80, L - 48));
  if (quote === WSOL) return null;
  let p = prices.get(quote);
  if (!p) { want(quote); const usd = localUsd(quote); if (usd > 0) { p = { usd, dec: 6 }; quoteStats.local++; } }
  if (!p) { quoteStats.unpriced++; return { pending: true }; }
  const scale = 10 ** p.dec;
  const amount = Number(buf.readBigUInt64LE(L - 48)) / scale, vQuote = Number(buf.readBigUInt64LE(L - 40)) / scale;
  const tokens = Number(buf.readBigUInt64LE(48)) / 1e6, vTok = Number(buf.readBigUInt64LE(105)) / 1e6, rTok = Number(buf.readBigUInt64LE(121)) / 1e6;
  if (!(vTok > 0) || !(vQuote > 0)) return null;
  const mcUsd = (vQuote * p.usd / vTok) * 1e9, usd = amount * p.usd;
  if (!(mcUsd > 0) || mcUsd > 5e10 || usd > 5e7) return null;
  quoteStats.trades++;
  return { mint: b58(buf.subarray(8, 40)), tokens, buy: buf[56] === 1, user: b58(buf.subarray(57, 89)), sol: usd / solUsd, mcSol: mcUsd / solUsd,
    vSol: (vQuote * p.usd) / solUsd, vTok, rTok, quote, usd, mcUsd };
}
