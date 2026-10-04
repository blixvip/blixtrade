// Real quotes: what a buy or sell of a given size would actually get right now.
//
// Coins still on the pump.fun curve are quoted from the curve itself: the live trade feed carries the
// curve's virtual reserves after every trade and the fee it charged, so the constant-product formula gives
// exactly what the program would fill (checked against real trades 2026-10-02: predicted tokens out matched
// the chain to ~1e-7; fee 95 bps protocol + 30 bps creator). Bonded coins are quoted by Jupiter's swap
// router (the same route a real swap would take), free and keyless.
import { live, feed } from "./livetrades.js";
import { jupiterGet } from "./jupiter.js";

const WSOL = "So11111111111111111111111111111111111111112";
const now = () => Date.now();
const err = (status, message) => Object.assign(new Error(message), { status });

// Reserves older than this are not trusted for a quote (a quiet coin's last trade may be far behind).
const CURVE_FRESH_MS = 5 * 60_000;

function curveQuote(s, side, amount, slippageBps) {
  const fee = (s.feeBps ?? 125) / 1e4;
  const k = s.vSol * s.vTok;
  const spot = s.vSol / s.vTok;                                  // SOL per token
  if (side === "buy") {
    const net = amount / (1 + fee);                              // the fee is taken on top of what enters the curve
    const tokens = s.vTok - k / (s.vSol + net);
    const avg = amount / tokens;
    return { side, inSol: amount, outTokens: tokens, feeSol: amount - net, avgSol: avg, spotSol: spot, impactPct: (avg / spot - 1) * 100,
      minOut: tokens * (1 - slippageBps / 1e4), mcapAfterSol: ((s.vSol + net) / (k / (s.vSol + net))) * 1e9 };
  }
  const gross = s.vSol - k / (s.vTok + amount);
  const out = gross * (1 - fee);
  const avg = out / amount;
  return { side, inTokens: amount, outSol: out, feeSol: gross - out, avgSol: avg, spotSol: spot, impactPct: (avg / spot - 1) * 100,
    minOut: out * (1 - slippageBps / 1e4), mcapAfterSol: ((s.vSol - gross) / (s.vTok + amount)) * 1e9 };
}

// The same curve quote, synchronously, or null when the coin is not on a live curve right now (paper.js
// re-values open positions every second with it).
//
// `own` = a paper position's own buy ({ solNet, tokens }). A paper buy never reaches the chain, so the real
// reserves do not include it; selling it back into them would charge its price impact twice. The reserves
// are shifted as if that buy had happened, so a buy-then-sell costs the fees and nothing else, as it would.
export function curveQuoteNow(mint, side, amount, slippageBps = 300, own = null) {
  const s = live.get(mint);
  if (!(s && s.vSol > 0 && s.vTok > 0 && (s.progress ?? 0) < 0.995 && now() - (s.resT || 0) < CURVE_FRESH_MS && amount > 0)) return null;
  const r = own?.solNet > 0 && own?.tokens > 0 && own.tokens < s.vTok ? { ...s, vSol: s.vSol + own.solNet, vTok: s.vTok - own.tokens } : s;
  return { ...curveQuote(r, side, amount, slippageBps), src: "curve" };
}

const decimalsCache = new Map();
async function jupiterQuote(mint, side, amount, slippageBps) {
  let dec = decimalsCache.get(mint);
  const px = await jupiterGet(`/price/v3?ids=${mint}`, { timeout: 5000, cacheMs: 30_000 });
  const info = px[mint];
  if (dec == null) {
    dec = info?.decimals;
    if (!Number.isInteger(dec) || dec < 0 || dec > 18) throw err(503, "Token decimals are unavailable, so its quote cannot be sized safely. Try again shortly.");
    decimalsCache.set(mint, dec);
    if (decimalsCache.size > 2000) decimalsCache.delete(decimalsCache.keys().next().value);
  }
  const [inMint, outMint, raw] = side === "buy" ? [WSOL, mint, Math.round(amount * 1e9)] : [mint, WSOL, Math.round(amount * 10 ** dec)];
  if (!(raw > 0) || !Number.isSafeInteger(raw)) throw err(400, "Amount is too small or too large to quote precisely.");
  const j = await jupiterGet(`/swap/v1/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${raw}&slippageBps=${slippageBps}`);
  if (!(Number(j.outAmount) > 0) || !Number.isFinite(Number(j.outAmount)) || !Number.isFinite(Number(j.otherAmountThreshold))) throw err(409, "No valid route on Jupiter right now.");
  const out = side === "buy" ? Number(j.outAmount) / 10 ** dec : Number(j.outAmount) / 1e9;
  const route = (j.routePlan || []).map((x) => x.swapInfo?.label).filter(Boolean);
  const spotSol = info?.usdPrice && feed.solUsd ? info.usdPrice / feed.solUsd : null;
  const avg = side === "buy" ? amount / out : out / amount;
  return side === "buy"
    ? { side, inSol: amount, outTokens: out, avgSol: avg, spotSol, impactPct: Number(j.priceImpactPct || 0) * 100, minOut: Number(j.otherAmountThreshold) / 10 ** dec, route, liquidityUsd: info?.liquidity ?? null }
    : { side, inTokens: amount, outSol: out, avgSol: avg, spotSol, impactPct: -Number(j.priceImpactPct || 0) * 100, minOut: Number(j.otherAmountThreshold) / 1e9, route, liquidityUsd: info?.liquidity ?? null };
}

// side "buy": amount in SOL. side "sell": amount in tokens. Returns sizes in SOL / tokens plus USD views.
export async function quote(mint, side, amount, { slippageBps = 300 } = {}) {
  amount = Number(amount);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint || ""))) throw err(400, "That is not a Solana address.");
  if (!["buy", "sell"].includes(side)) throw err(400, "side must be buy or sell.");
  if (!(amount > 0) || !Number.isFinite(amount)) throw err(400, "Amount must be finite and above zero.");
  if (!feed.solKnown) throw err(503, "Waiting for the SOL price, so dollar figures would be wrong. Try again in a few seconds.");
  slippageBps = Math.max(1, Math.min(5000, Math.round(Number(slippageBps) || 300)));
  const s = live.get(mint);
  const onCurve = s && s.vSol > 0 && s.vTok > 0 && (s.progress ?? 0) < 0.995 && now() - (s.resT || 0) < CURVE_FRESH_MS;
  const q = onCurve ? { ...curveQuote(s, side, amount, slippageBps), src: "curve", route: ["pump.fun curve"], feeBps: s.feeBps ?? 125, reservesAgeMs: now() - s.resT }
    : { ...(await jupiterQuote(mint, side, amount, slippageBps)), src: "jupiter" };
  const usd = feed.solUsd;
  if (!feed.solKnown) throw err(503, "Waiting for the SOL price, so dollar figures would be wrong. Try again in a few seconds.");
  return { ...q, mint, slippageBps, solUsd: usd, t: now(),
    // Market cap at the average fill price (every pump.fun coin has 1B tokens; Jupiter coins use their own supply via spot).
    avgMcapUsd: q.avgSol * 1e9 * usd, spotMcapUsd: q.spotSol ? q.spotSol * 1e9 * usd : null,
    usdIn: side === "buy" ? amount * usd : null, usdOut: side === "sell" ? q.outSol * usd : null };
}
