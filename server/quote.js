// Real quotes: what a buy or sell of a given size would actually get right now.
//
// Coins still on the pump.fun curve are quoted from the curve itself: the live trade feed carries the
// curve's virtual reserves after every trade and the fee it charged, so the constant-product formula gives
// exactly what the program would fill (checked against real trades 2026-10-02: predicted tokens out matched
// the chain to ~1e-7; fee 95 bps protocol + 30 bps creator). Bonded coins are quoted by Jupiter's swap
// router (the same route a real swap would take), free and keyless.
import { live, feed } from "./livetrades.js";
import { jupiterGet } from "./jupiter.js";
import { poolStateOf } from "./pumpswap.js";
import { db } from "./db.js";
import { supplyOf } from "./jup.js";

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
  // pump.fun coins always have 6 decimals and the radar already holds their price, so their quote is one
  // Jupiter call, not two; anything else asks Jupiter's price API for its decimals and spot price first.
  const known = /pump$/.test(mint) ? db.prepare("SELECT price, liquidity FROM tokens WHERE mint = ?").get(mint) : null;
  if (/pump$/.test(mint)) decimalsCache.set(mint, 6);
  let dec = decimalsCache.get(mint);
  const info = known ? { usdPrice: known.price || null, liquidity: known.liquidity ?? null }
    : (await jupiterGet(`/price/v3?ids=${mint}`, { timeout: 5000, cacheMs: 30_000, priority: true }))[mint];
  if (dec == null) {
    dec = info?.decimals;
    if (!Number.isInteger(dec) || dec < 0 || dec > 18) throw err(503, "Token decimals are unavailable, so its quote cannot be sized safely. Try again shortly.");
    decimalsCache.set(mint, dec);
    if (decimalsCache.size > 2000) decimalsCache.delete(decimalsCache.keys().next().value);
  }
  const [inMint, outMint, raw] = side === "buy" ? [WSOL, mint, Math.round(amount * 1e9)] : [mint, WSOL, Math.round(amount * 10 ** dec)];
  if (!(raw > 0) || !Number.isSafeInteger(raw)) throw err(400, "Amount is too small or too large to quote precisely.");
  // Trade panels re-quote every 3 s; two panels or a quick re-click within 2 s share one answer.
  const j = await jupiterGet(`/swap/v1/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${raw}&slippageBps=${slippageBps}`, { priority: true, cacheMs: 2000 });
  if (!(Number(j.outAmount) > 0) || !Number.isFinite(Number(j.outAmount)) || !Number.isFinite(Number(j.otherAmountThreshold))) throw err(409, "No valid route on Jupiter right now.");
  const out = side === "buy" ? Number(j.outAmount) / 10 ** dec : Number(j.outAmount) / 1e9;
  const route = (j.routePlan || []).map((x) => x.swapInfo?.label).filter(Boolean);
  const spotSol = info?.usdPrice && feed.solUsd ? info.usdPrice / feed.solUsd : null;
  const avg = side === "buy" ? amount / out : out / amount;
  return side === "buy"
    ? { side, inSol: amount, outTokens: out, avgSol: avg, spotSol, impactPct: Number(j.priceImpactPct || 0) * 100, minOut: Number(j.otherAmountThreshold) / 10 ** dec, route, liquidityUsd: info?.liquidity ?? null }
    : { side, inTokens: amount, outSol: out, avgSol: avg, spotSol, impactPct: -Number(j.priceImpactPct || 0) * 100, minOut: Number(j.otherAmountThreshold) / 1e9, route, liquidityUsd: info?.liquidity ?? null };
}

// A rough quote from the radar's own pool figures (price and liquidity, both sides counted), for when Jupiter
// is rate limited: a two-sided constant-product pool with a 1% fee. Trade panels and paper fills use it (both pass
// `estimate`, so a paper trade never waits seconds on Jupiter); real trades never do (the vault quotes for itself).
function poolEstimate(mint, side, amount, slippageBps) {
  const t = db.prepare("SELECT price, liquidity FROM tokens WHERE mint = ?").get(mint);
  if (!(t?.price > 0 && t?.liquidity > 0 && feed.solUsd > 0)) return null;
  const rSol = t.liquidity / 2 / feed.solUsd, rTok = t.liquidity / 2 / t.price, k = rSol * rTok, fee = 0.01;
  const spot = rSol / rTok;
  if (side === "buy") {
    const out = rTok - k / (rSol + amount * (1 - fee)), avg = amount / out;
    return { side, inSol: amount, outTokens: out, avgSol: avg, spotSol: spot, impactPct: (avg / spot - 1) * 100, minOut: out * (1 - slippageBps / 1e4), route: ["estimate"], liquidityUsd: t.liquidity };
  }
  const out = (rSol - k / (rTok + amount)) * (1 - fee), avg = out / amount;
  return { side, inTokens: amount, outSol: out, avgSol: avg, spotSol: spot, impactPct: (avg / spot - 1) * 100, minOut: out * (1 - slippageBps / 1e4), route: ["estimate"], liquidityUsd: t.liquidity };
}

// A preview does not wait on a slow Jupiter (seen at 5 s): after 800 ms it is answered as "busy", so the pool
// estimate goes out instead. A coin with no estimate to give waits for Jupiter as before.
function fastQuote(mint, side, amount, slippageBps, estimate, waitMs = 800) {
  const real = jupiterQuote(mint, side, amount, slippageBps);
  if (!estimate) return real;
  return Promise.race([real, new Promise((ok) => setTimeout(ok, waitMs, null))]).then((x) => {
    if (x || !poolEstimate(mint, side, amount, slippageBps)) return real;
    real.catch(() => {});
    throw Object.assign(new Error("Jupiter is slow"), { status: 503 });
  });
}

// side "buy": amount in SOL. side "sell": amount in tokens. Returns sizes in SOL / tokens plus USD views.
// `estimate`: when Jupiter is rate limited or down, answer with poolEstimate() (src "estimate") instead of failing.
// `waitMs`: how long an estimate-allowed quote waits on Jupiter before taking the pool estimate (paper fills: 250).
// `usdc`: the trade is in USDC (Axiom-style, 2026-10-11): a buy's `amount` is USDC, a sell is paid in USDC. The
// quote itself is worked in SOL at the live SOL price (the curve's own maths for a curve coin, Jupiter's SOL route
// otherwise) and answered with the USDC figures beside it (`usdcIn` / `usdcOut`); the real trade quotes its own
// USDC route in the wallet service (blix-vault), the paper desk fills at this one.
export async function quote(mint, side, amount, { slippageBps = 300, estimate = false, waitMs = 800, usdc = false } = {}) {
  amount = Number(amount);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint || ""))) throw err(400, "That is not a Solana address.");
  if (!["buy", "sell"].includes(side)) throw err(400, "side must be buy or sell.");
  if (!(amount > 0) || !Number.isFinite(amount)) throw err(400, "Amount must be finite and above zero.");
  if (!feed.solKnown) throw err(503, "Waiting for the SOL price, so dollar figures would be wrong. Try again in a few seconds.");
  slippageBps = Math.max(1, Math.min(5000, Math.round(Number(slippageBps) || 300)));
  let usdcIn = null;
  if (usdc && side === "buy") { usdcIn = amount; amount = amount / feed.solUsd; }
  const s = live.get(mint);
  const onCurve = s && s.vSol > 0 && s.vTok > 0 && (s.progress ?? 0) < 0.995 && now() - (s.resT || 0) < CURVE_FRESH_MS;
  // A migrated pump coin whose PumpSwap pool the radar hears trade by trade (pumpswap.js): a preview is worked from
  // the pool's own price and depth (poolEstimate), like a curve quote, instead of asking Jupiter, a quarter of whose
  // answers were refusals on the free allowance (2026-10-11), each one pausing every Jupiter read for seconds. Real
  // trades never take this: the wallet service quotes itself.
  const pool = !onCurve && estimate ? poolStateOf(mint) : null;
  const local = pool && now() - (pool.t || 0) < 90_000 ? poolEstimate(mint, side, amount, slippageBps) : null;
  const q = onCurve ? { ...curveQuote(s, side, amount, slippageBps), src: "curve", route: ["pump.fun curve"], feeBps: s.feeBps ?? 125, reservesAgeMs: now() - s.resT }
    : local ? { ...local, src: "pool", route: ["PumpSwap pool"], note: null, reservesAgeMs: now() - pool.t }
    : await fastQuote(mint, side, amount, slippageBps, estimate, waitMs).then((x) => ({ ...x, src: "jupiter" }), (e) => {
      const est = estimate && (e.status === 429 || e.status === 503) ? poolEstimate(mint, side, amount, slippageBps) : null;
      if (!est) throw e;
      return { ...est, src: "estimate", note: "Jupiter is busy: estimated from the pool's price and liquidity. The trade itself fills at a real quote." };
    });
  const usd = feed.solUsd;
  if (!feed.solKnown) throw err(503, "Waiting for the SOL price, so dollar figures would be wrong. Try again in a few seconds.");
  // Market cap at the average fill price: every pump.fun coin has 1B tokens; any other coin its own supply when known
  // (cbBTC's 2.8K tokens on 1B read as an $83 trillion market cap).
  const sup = /pump$/.test(mint) || onCurve ? 1e9 : supplyOf(mint) ?? 1e9;
  return { ...q, mint, slippageBps, solUsd: usd, t: now(),
    avgMcapUsd: q.avgSol * sup * usd, spotMcapUsd: q.spotSol ? q.spotSol * sup * usd : null,
    usdIn: side === "buy" ? amount * usd : null, usdOut: side === "sell" ? q.outSol * usd : null,
    usdcIn, usdcOut: usdc && side === "sell" ? q.outSol * usd : null };
}
