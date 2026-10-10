// The open chart's price from the smallest feed there is: the accounts a trade changes, not its logs. A busy
// coin's logs ran 150 KB/s and fell 12 slots behind on a crowded home connection, while its pool's two vault
// accounts carried the same trades in 28 KB/s and stayed within a slot (IA, 2026-10-06). Terminals stay fast
// on slow links the same way: they ship small, already-priced updates.
//   - pump.fun curve: the bonding curve account. Its virtual reserves are the curve's exact price after each
//     change, and the change in its virtual SOL is the size.
//   - PumpSwap: the pool's base and quote vaults. A slot's trades move both; the SOL that moved over the tokens
//     that moved is the price they traded at (the vaults' ratio is not: on some pools it sits 10-15% under every
//     trade). A slot with both buys and sells nets out and gives no price; the next one does.
// Prices go out through onFastPx at once; the trade list (who traded) still comes from the logs.
import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import { fastSub, chartWsUrl, chartStream, count } from "./chartstream.js";
import { noteSlot } from "./feedlag.js";
import { b58, onLiveTrade, liveStats } from "./livetrades.js";
import { onPoolTrade, poolOf } from "./pumpswap.js";
import { supplyOf } from "./jup.js";
import { onCurve } from "./holderslive.js";
import { rpc } from "./solana.js";
import { db } from "./db.js";

const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const now = () => Date.now();
export const fastStats = { coins: 0, updates: 0, skipped: 0, held: 0, checked: 0, disagreed: 0, turnedOff: 0 };
const fns = [];
// fn(mint, { mcSol, sol, buy, slot }): mcSol on 1B tokens (the caller puts it on the circulating scale).
export function onFastPx(fn) { fns.push(fn); }

function b58decode(s) {
  let n = 0n;
  for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0); }
  return Buffer.from(out);
}
// A program address: the first bump (from 255 down) whose hash is off the ed25519 curve.
export function pda(seeds, program) {
  const prog = b58decode(program);
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash("sha256");
    for (const sd of seeds) h.update(sd);
    h.update(Buffer.from([bump])); h.update(prog); h.update("ProgramDerivedAddress");
    const addr = b58(h.digest());
    if (!onCurve(addr)) return addr;
  }
  return null;
}
export const curveOf = (mint) => pda([Buffer.from("bonding-curve"), b58decode(mint)], PUMP);
// The pool pump.fun migrates a coin into: index 0, created by the pump program's pool authority for the coin,
// against wrapped SOL. Found this way when the radar has not yet seen a trade in it (CumRocket's chart had no feed).
const AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", WSOL = "So11111111111111111111111111111111111111112";
export function canonicalPool(mint) {
  const auth = pda([Buffer.from("pool-authority"), b58decode(mint)], PUMP);
  return auth && pda([Buffer.from("pool"), Buffer.from([0, 0]), b58decode(auth), b58decode(mint), b58decode(WSOL)], AMM);
}

// What the feed said per slot, to check it against the logs' trades of the same slot.
const seen = new Map();      // mint -> Map(slot -> mcSol)
const lastEmit = new Map();  // mint -> ms
// A price more than 20x from the last one within 10 s is held back until a second reading agrees with it
// (XPAD, 2026-10-07: one mispaired pair of vault deltas priced a $106K coin at $67 for a minute of chart):
// a real move that size shows in the next slot too; a wrong pairing does not.
const lastPx = new Map();    // mint -> { mcSol, t, held }
function emit(mint, mcSol, sol, buy, slot = null) {
  if (!(mcSol > 0) || mcSol > 1e8) return;
  const p = lastPx.get(mint);
  if (p && now() - p.t < 10_000 && (mcSol / p.mcSol > 20 || mcSol / p.mcSol < 0.05)) {
    if (!(p.held && (mcSol / p.held > 0.5 && mcSol / p.held < 2))) { p.held = mcSol; fastStats.held++; return; }
  }
  lastPx.set(mint, { mcSol, t: now() }); if (lastPx.size > 500) lastPx.delete(lastPx.keys().next().value);
  fastStats.updates++;
  lastEmit.set(mint, now());
  if (slot != null) {
    let h = seen.get(mint); if (!h) seen.set(mint, (h = new Map()));
    h.set(slot, mcSol); if (h.size > 600) h.delete(h.keys().next().value);
  }
  for (const fn of fns) try { fn(mint, { mcSol, sol, buy, slot }); } catch {}
}

const watches = new Map();   // mint -> { t, stops, kind }

// The accounts are watched on a thread of its own (fastlane.js), which also streams the prices to the open pages;
// if it cannot start, here as before.
let lane = null;
export const laneStats = { on: false, error: null, port: Number(process.env.BLIX_FAST_PORT) || 4423 };
let scale = () => null;   // mint -> { k: USD per mcSol on the chart's scale, solUsd } (server.js)
export function setFastScale(fn) { scale = fn; }
function startLane() {
  try {
    lane = new Worker(new URL("./fastlane.js", import.meta.url), { workerData: { port: laneStats.port } });
    laneStats.on = true;
    lane.on("message", (m) => {
      if (m.op === "px") emit(m.mint, m.mcSol, m.sol, m.buy, m.slot);
      else if (m.op === "meter") { if (m.bytes) count(m.bytes); noteSlot("fast", m.slot); }
      else if (m.op === "want") watchFast(m.mint);
      else if (m.op === "done") { const w = watches.get(m.mint); if (w) { for (const s of w.stops) try { s?.(); } catch {} watches.delete(m.mint); } }
      else if (m.op === "error") laneStats.error = m.message;
    });
    lane.on("error", (e) => { laneStats.error = e.message; });
    lane.on("exit", () => { lane = null; laneStats.on = false; setTimeout(startLane, 5000).unref?.(); });
    lane.unref?.();
  } catch (e) { lane = null; laneStats.error = e.message; }
}
const laneWatch = (mint, kind, accts, w, virt = 0) => {
  lane.postMessage({ op: "watch", mint, kind, accts, virt });
  w.stops.push(() => lane?.postMessage({ op: "unwatch", mint }));
  sendScale(mint);
};
function sendScale(mint) { const s = scale(mint); if (lane && s?.k > 0) lane.postMessage({ op: "mult", mint, k: s.k, solUsd: s.solUsd }); }
setInterval(() => {
  if (!lane) return;
  lane.postMessage({ op: "cfg", url: chartWsUrl(), overBudget: chartStream.overBudget });
  for (const [m, w] of watches) if (w.kind) sendScale(m);
}, 500).unref?.();
if (!process.env.BLIX_NO_FASTLANE) startLane();

function watchCurve(mint, w) {
  const curve = curveOf(mint);
  if (!curve) return;
  if (lane) return laneWatch(mint, "curve", [curve], w);
  let lastSol = null;
  w.stops.push(fastSub(`curve:${mint}`, "accountSubscribe", [curve, { encoding: "base64", commitment: "processed" }], (res) => {
    const b = Buffer.from(res?.value?.data?.[0] || "", "base64");
    if (b.length < 49) return;
    // The curve completed (the coin moved to its pool): this feed has nothing more to say. Dropping the watch lets
    // the chart's next request pick the pool up.
    if (b[48] === 1) { for (const s of w.stops) try { s?.(); } catch {} watches.delete(mint); return; }
    const vTok = Number(b.readBigUInt64LE(8)) / 1e6, vSol = Number(b.readBigUInt64LE(16)) / 1e9;
    if (!(vTok > 0)) return;
    const d = lastSol == null ? 0 : vSol - lastSol;
    lastSol = vSol;
    if (d === 0) return;
    emit(mint, (vSol / vTok) * 1e9, Math.abs(d), d > 0, res?.context?.slot ?? null);
  }));
}

async function watchPool(mint, pool, w) {
  // PumpSwap pool: discriminator 8, bump 1, index 2, creator, base mint, quote mint, lp mint, then the two vaults
  // (139..203), lp supply, coin creator, two flags, then virtual_quote_reserves (i128 at 245): SOL the pool prices
  // with on top of (or, since 2026-09-30, possibly below) what its vault holds. Without it the vaults' ratio sat
  // 10-15% off every trade on some pools (the "k" below was the workaround); with it the ratio is the price.
  const r = await rpc("getAccountInfo", [pool, { encoding: "base64", dataSlice: { offset: 139, length: 122 } }]);
  const d = r?.value?.data?.[0];
  if (!d || watches.get(mint) !== w) return;
  const b = Buffer.from(d, "base64");
  const baseV = b58(b.subarray(0, 32)), quoteV = b58(b.subarray(32, 64));
  const virt = b.length >= 122 ? Number(BigInt.asIntN(128, b.readBigUInt64LE(106) | (b.readBigUInt64LE(114) << 64n))) / 1e9 : 0;
  if (lane) return laneWatch(mint, "pool", [baseV, quoteV], w, virt);
  const last = { base: null, quote: null }, slot = { base: null, quote: null }, delta = { base: 0, quote: 0 };
  // k: what a clean slot's trade price is to the vaults' ratio on this pool (1 on most, ~1.13 on some), so a slot
  // with no clean price (buys and sells netting out, or dust) is priced from the ratio times k.
  let timer = null, k = null;
  const first = [];
  const settle = () => {
    timer = null;
    const dB = delta.base, dQ = delta.quote;
    delta.base = 0; delta.quote = 0;
    if (!(last.base > 0) || !(last.quote + virt > 0)) return;
    const ratio = ((last.quote + virt) / last.base) * 1e9;
    // Tokens out and SOL in: buys; the other way: sells.
    const buy = dB < 0 && dQ > 0, sell = dB > 0 && dQ < 0;
    if ((buy || sell) && Math.abs(dQ) >= 0.0005) {
      const exec = (Math.abs(dQ) / Math.abs(dB)) * 1e9;
      // The two vaults' updates of a slot can arrive apart, and a delta can then pair with the wrong one
      // (cumrocketinu dipped to $1.4K against $21.6K): a price far from the vaults' own ratio is not trusted.
      if (k != null && (exec / (ratio * k) < 0.8 || exec / (ratio * k) > 1.25)) { fastStats.skipped++; return emit(mint, ratio * k, Math.abs(dQ), buy, slot.quote); }
      // Before k is known the ratio itself is the check (k sits within 0.6-1.6 on every pool seen): a price
      // outside that is a mispaired delta, drawn at the ratio and not taught to k.
      if (k == null && (exec / ratio < 0.6 || exec / ratio > 1.6)) { fastStats.skipped++; return emit(mint, ratio, Math.abs(dQ), buy, slot.quote); }
      // k starts from the median of the first three clean slots, so one mismatched slot cannot set it.
      if (k == null) { first.push(exec / ratio); if (first.length >= 3) k = first.sort((x, y) => x - y)[1]; }
      else k = k * 0.8 + (exec / ratio) * 0.2;
      return emit(mint, exec, Math.abs(dQ), buy, slot.quote);
    }
    if (k == null || (dB === 0 && dQ === 0)) { fastStats.skipped++; return; }
    emit(mint, ratio * k, Math.abs(dQ), dQ >= 0, slot.quote);
  };
  const on = (side, decimals) => (res) => {
    const v = Buffer.from(res?.value?.data?.[0] || "", "base64");
    if (v.length < 72) return;
    const amt = Number(v.readBigUInt64LE(64)) / 10 ** decimals, s = res?.context?.slot ?? null;
    if (last[side] != null) delta[side] += amt - last[side];
    last[side] = amt; slot[side] = s;
    // Both vaults of one slot arrive back to back; settle once both are in, or shortly after the first.
    if (slot.base === slot.quote && delta.base && delta.quote) { clearTimeout(timer); settle(); }
    else if (!timer) timer = setTimeout(settle, 120);
  };
  w.stops.push(fastSub(`vb:${mint}`, "accountSubscribe", [baseV, { encoding: "base64", commitment: "processed" }], on("base", 6)));
  w.stops.push(fastSub(`vq:${mint}`, "accountSubscribe", [quoteV, { encoding: "base64", commitment: "processed" }], on("quote", 9)));
}

// Keep `mint`'s price feed for another 15 s (the chart asks for candles every second or so while open).
// Returns true while a fast feed is (being) set up for it, so the caller can let it lead the chart.
export function watchFast(mint) {
  let w = watches.get(mint);
  if (w) { w.t = now(); return w.kind != null; }
  if (now() < (offUntil.get(mint) || 0)) return false;
  const t = db.prepare("SELECT graduated, dex, pair FROM tokens WHERE mint = ?").get(mint);
  // On the curve while the tokens table and the curve's own progress both say so; else its PumpSwap pool, from the
  // table or as the chain has shown it.
  const bonded = Boolean(t?.graduated) || (liveStats(mint)?.progress ?? 0) >= 0.995;
  const pool = (t?.dex === "pumpswap" && t.pair ? t.pair : poolOf(mint)) || (bonded && mint.endsWith("pump") ? canonicalPool(mint) : null);
  const kind = !mint.endsWith("pump") ? null : !bonded ? "curve" : pool ? "pool" : null;
  w = { t: now(), stops: [], kind };
  watches.set(mint, w);
  if (kind === "curve") watchCurve(mint, w);
  else if (kind === "pool") watchPool(mint, pool, w).catch(() => {});
  fastStats.coins = [...watches.values()].filter((x) => x.kind).length;
  return kind != null;
}
// The feed's price (on 1B tokens) at a slot or the one before, while it leads the chart; null otherwise.
export function priceAt(mint, slot) {
  if (!isFast(mint) || slot == null) return null;
  const h = seen.get(mint);
  return h?.get(slot) ?? h?.get(slot - 1) ?? null;
}

// Leading the chart only while it is actually delivering: a feed that went quiet (a dropped subscription, a
// curve that completed) must not hold the chart while the logs' trades are kept out (SI276 sat flat at $40K for
// 150 s while Jupiter traded $22-36K, 2026-10-06). On a quiet coin neither has anything to say.
export const isFast = (mint) => {
  const w = watches.get(mint);
  return Boolean(w?.kind) && now() - w.t < 15_000 && now() - (lastEmit.get(mint) || 0) < 5_000;
};

// Every trade decoded from the logs checks the feed's price for the same slot (or the one before): five
// misses in a row of more than 3% and the feed is turned off for this coin for 10 minutes, the logs lead.
const offUntil = new Map();  // mint -> ms
function check(mint, slot, mcSol) {
  const w = watches.get(mint);
  if (!w?.kind || slot == null || !(mcSol > 0)) return;
  const h = seen.get(mint), fast = h?.get(slot) ?? h?.get(slot - 1);
  if (!(fast > 0)) return;
  fastStats.checked++;
  if (Math.abs(fast / mcSol - 1) > 0.03) { fastStats.disagreed++; w.bad = (w.bad || 0) + 1; } else w.bad = 0;
  if (w.bad >= 5) {
    for (const s of w.stops) try { s?.(); } catch {}
    w.stops = []; w.kind = null; fastStats.turnedOff++;
    offUntil.set(mint, now() + 10 * 60_000); if (offUntil.size > 500) offUntil.delete(offUntil.keys().next().value);
  }
}
// Both on 1B tokens: the curve's cap is, and pumpswap.js puts its trades on the circulating scale.
onLiveTrade((mint, s, sol, buy, x) => check(mint, x?.slot, s.mc));
onPoolTrade((mint, e) => check(mint, e.slot, e.mcSol / ((supplyOf(mint) ?? 1e9) / 1e9)));

setInterval(() => {
  for (const [m, w] of watches) if (now() - w.t > 15_000) { for (const s of w.stops) try { s?.(); } catch {} watches.delete(m); }
  fastStats.coins = [...watches.values()].filter((x) => x.kind).length;
}, 5_000).unref?.();
