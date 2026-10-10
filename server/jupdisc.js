// Discover's market figures from Jupiter's free Tokens API (lite-api.jup.ag/tokens/v2), the same kind of
// figures Axiom's Discover shows: measured 2026-10-04 on XFUN, Jupiter top-10 15.34% = Axiom 15.34%,
// holders 2,081 vs 2,074, dev 1.02% = 1.02%, market cap within 3%. Two uses:
//   - figures(mint, win): market cap, change, volume, buys/sells, traders, holders, top 10 %, dev % for a
//     coin on screen, asked in batches of up to 100 (search endpoint) at most every 4 s;
//   - topTraded(win): the coins traded most across Solana in the window (Axiom's Trending), so Discover
//     lists coins the radar never adopted or had retired.
// Its own paced transport, separate from jupiter.js. lite-api's keyless allowance is shared with trade quotes
// and Blix Vault's real swaps, and this file once helped push it into 429s (2026-10-04: 108 of 202 quote calls
// failed), so it stays light: one search per 12 s at most (coins not on the live feed only, each re-read when
// over 25 s old), the most-traded list every 90 s for the window on screen, and a 60 s silence after any 429.
const BASE = "https://lite-api.jup.ag/tokens/v2";
const WIN = { "5m": "stats5m", "1h": "stats1h", "24h": "stats24h" };
const now = () => Date.now();
export const jupStats = { calls: 0, errors: 0, limited: 0, last: 0, mints: 0 };

let next = 0, cooling = 0;
async function get(path) {
  if (now() < cooling) return null;
  const slot = Math.max(now(), next);
  if (slot - now() > 10_000) return null;
  next = slot + 2500;
  if (slot > now()) await new Promise((r) => setTimeout(r, slot - now()));
  try {
    const r = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    jupStats.calls++; jupStats.last = now();
    if (r.status === 429) { jupStats.limited++; cooling = now() + 60_000; return null; }
    if (!r.ok) { jupStats.errors++; return null; }
    return await r.json();
  } catch { jupStats.errors++; return null; }
}

// ---------- per-coin figures ----------
const cache = new Map();     // mint -> { t, v }
// Kept on disk (every 30 s, read back at start when under 10 minutes old), so a restart does not leave Discover's
// holders, top 10 and dev pills empty for the minute it takes to read every listed coin again.
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./db.js";
const CACHE_FILE = path.join(DATA, "jupdisc-cache.json");
try { const j = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); for (const [m, c] of j) if (now() - c.t < 10 * 60_000) cache.set(m, c); } catch {}
let savedAt = 0;
function saveCache() {
  if (now() - savedAt < 30_000 || !cache.size) return;
  savedAt = now();
  fs.promises.writeFile(CACHE_FILE + ".tmp", JSON.stringify([...cache])).then(() => fs.promises.rename(CACHE_FILE + ".tmp", CACHE_FILE)).catch(() => {});
}
const wanted = new Map();    // mint -> last asked
function keep(list) {
  for (const v of Array.isArray(list) ? list : []) if (v?.id) cache.set(v.id, { t: now(), v });
  if (cache.size > 3000) for (const [m, c] of cache) if (now() - c.t > 10 * 60_000) cache.delete(m);
  jupStats.mints = cache.size;
  saveCache();
}
// Coins never read yet are asked for at once (one search, paced like every other call), so a fresh list
// shows its figures in a second or two instead of waiting for the 12 s cycle.
let kick = null;
export function want(mints) {
  let fresh = false;
  for (const m of mints) { wanted.set(m, now()); if (!cache.has(m)) fresh = true; }
  if (fresh && !kick) kick = setTimeout(() => { kick = null; refresh().catch(() => {}); }, 300);
}

// The figures for one window, or null when Jupiter has not answered for this coin in the last 30 s.
export function figures(mint, win = "1h") {
  const c = cache.get(mint);
  // Up to 10 minutes old (a restart's saved copy, or a coin Jupiter is slow to answer for) rather than nothing;
  // every coin on screen is read again every 25 s, and the live feeds move the market cap meanwhile.
  if (!c || now() - c.t > 10 * 60_000) return null;
  const v = c.v, s = v[WIN[win] || "stats1h"] || {};
  const vol = (s.buyVolume || 0) + (s.sellVolume || 0);
  return { mc: v.mcap || v.fdv || null, chg: s.priceChange ?? null, vol: s.buyVolume != null ? vol : null, buys: s.numBuys ?? null, sells: s.numSells ?? null,
    traders: s.numTraders ?? null, holders: v.holderCount ?? null, top10: v.audit?.topHoldersPercentage ?? null, dev: v.audit?.devBalancePercentage ?? null,
    // The dev wallet and supply, so the dev's share can be read from the chain when the audit leaves it out (devbal.js).
    devWallet: v.dev || null, supply: v.circSupply || v.totalSupply || null, liq: v.liquidity ?? null,
    mintOff: v.audit?.mintAuthorityDisabled ?? null, freezeOff: v.audit?.freezeAuthorityDisabled ?? null,
    graduated: Boolean(v.graduatedPool), launchpad: v.launchpad || null, t: c.t };
}

let busy = false;
async function refresh() {
  if (busy) return;
  for (const [m, t] of wanted) if (now() - t > 15_000) wanted.delete(m);
  const due = [...wanted.keys()].filter((m) => now() - (cache.get(m)?.t || 0) > 25_000).slice(0, 100);
  if (!due.length) return;
  busy = true;
  try { keep(await get(`/search?query=${due.join(",")}`)); } finally { busy = false; }
}

// ---------- most traded ----------
const top = new Map();       // win -> { t, list, asked }
export function topTraded(win = "5m") {
  const w = WIN[win] ? win : "5m";
  let e = top.get(w);
  if (!e) { e = { t: 0, list: [], asked: 0 }; top.set(w, e); }
  e.asked = now();
  return e.list;
}
let onFound = null;
export const onTopTraded = (fn) => { onFound = fn; };
async function refreshTop() {
  for (const [w, e] of top) {
    if (now() - e.asked > 60_000 || now() - e.t < 90_000) continue;
    e.t = now();
    const list = await get(`/toptraded/${w}?limit=100`);
    if (!Array.isArray(list)) continue;
    keep(list);
    e.list = list.map((v) => ({ mint: v.id, symbol: v.symbol, name: v.name, image: v.icon }));
    onFound?.(e.list);
  }
}

export function startJupDisc() {
  setInterval(() => { refresh().catch(() => {}); }, 12_000).unref?.();
  setInterval(() => { refreshTop().catch(() => {}); }, 10_000).unref?.();
}
