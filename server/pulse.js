// Pulse: the live three-column view (new pairs → about to bond → migrated), Axiom style, with the
// AI's rating state for every coin (queued, Grok reading it right now, graded, deep read, buy call).
import { slotTime } from "./feedlag.js";
import { db, q, json } from "./db.js";
import { recentLaunches, devLaunches, launchIndex } from "./engine.js";
import { candidates, ipfs, bondingProgress, providers, queueStatus, liveTraction } from "./research.js";
import { safeUrl, publicUrl, cleanLinks, readingProblem } from "./quality.js";
import { liveStats, feed, live, closeToBonding, curveLiqUsd, migrationOf, sanity } from "./livetrades.js";
import { dexTokens } from "./sources.js";
import { triageFor, triageStats } from "./triage.js";
import { earlyFor } from "./early.js";
import { grokStatus } from "./grok.js";
import { rowHolders, holderStats, seedWanted } from "./holders.js";
import { snipeFor } from "./snipe.js";
import { runners, windowStats, oddCurve, isMoving } from "./coverage.js";
import { traction } from "./quality.js";
import { adoptLaunch, adoptMint, vet } from "./engine.js";
import { enqueue } from "./research.js";
import { jupiterGet } from "./jupiter.js";
import { supplyOf } from "./jup.js";
import { priceTick, addTrade } from "./candles.js";
import { onPoolTrade } from "./pumpswap.js";
import { warmX } from "./xcard.js";
import { onPoolPrice, watchSol } from "./poolwatch.js";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
import { gtGet, gtReady } from "./gtgate.js";
import * as coinIndex from "./coinindex.js";
import { feesOf } from "./coinfees.js";

// Every row carries a live rank: the traction score (0-100) measured on this radar's own past reads as the
// one ranking that predicted winners, computed this second from the trade feed (5-minute volume, traders,
// 1m/5m change, size, distance from its high). The AI read is the second opinion, not the rank.
const winCache = new Map();   // mint -> { t, w }: the 5-minute window is summed from every trade, so once per 2s per coin
function window5m(mint) {
  const c = winCache.get(mint);
  if (c && now() - c.t < 2000) return c.w;
  const w = windowStats(mint);
  winCache.set(mint, { t: now(), w });
  if (winCache.size > 3000) for (const [k, v] of winCache) if (now() - v.t > 60_000) winCache.delete(k);
  return w;
}
function rankRow(r) {
  const w = window5m(r.mint), x = liveStats(r.mint);
  // Nothing known yet (a launch seconds old, no trade seen): no rank, rather than a made-up middling one.
  if (!x && !w && !r.vol5m && !r.holders && (r.startMcapSol != null || !(r.mcap > 0))) return { ...r, tr: null };
  const live = x && now() - x.last < 15 * MIN;
  const stage = r.graduated ? "bonded" : (r.progress ?? 0) >= 0.6 ? "near" : "new";
  const vol5m = w ? (w.buySol + w.sellSol) * feed.solUsd : r.vol5m ?? undefined;
  const mcap = r.mcap > 0 ? r.mcap : undefined;
  const ath = Math.max(live ? x.ath : 0, r.peak || 0) || undefined;
  const s = traction({ stage, mcap, vol5m, traders: live ? x.traders : r.holders ?? undefined, chg1m: live ? x.chg1m ?? undefined : undefined,
    chg5m: w?.chg ?? r.chg5 ?? undefined, chg1h: r.chg1h ?? undefined, holders: r.hl?.h ?? r.holders ?? undefined, offAth: ath && mcap ? Math.min(1, mcap / ath) : undefined });
  return { ...r, tr: s.score };
}

// A coin that is moving but was never read: track it and put it in the AI's queue, a few per sweep.
const autoRead = new Map();   // mint -> when it was last sent
function readHot(rows) {
  const hot = rows.filter((r) => !r.ai && ((r.win?.heat || 0) >= 60 || r.tr >= 55) && now() - (autoRead.get(r.mint) || 0) > 10 * MIN).slice(0, 4);
  for (const r of hot) {
    autoRead.set(r.mint, now());
    if (autoRead.size > 2000) for (const [k, t] of autoRead) if (now() - t > 30 * MIN) autoRead.delete(k);
    const stage = r.graduated ? "bonded" : (r.progress ?? 0) >= 0.6 ? "near" : "new";
    const l = launchIndex.get(r.mint);
    Promise.resolve(q.getToken.get(r.mint) ? null : l ? adoptLaunch(l) : adoptMint(r.mint)).then(() => vet(r.mint)).catch(() => {}).then(() => { try { enqueue(r.mint, stage, 0); } catch {} });
  }
}
export const getMeta = (mint) => meta.get(mint) ?? coinIndex.metaOf(mint);
// A picture address found for a coin the radar does not track (see lookupPictures).
export const knownImage = (mint) => names.get(mint)?.image || coinIndex.imageOf(mint);
// Ticker and name for any coin the page has seen: the launch feed first, then the DexScreener lookup.
export const nameOf = (mint) => { const l = launchIndex.get(mint), n = names.get(mint); return l || n?.symbol ? { symbol: l?.symbol || n?.symbol || null, name: l?.name || n?.name || null } : coinIndex.nameOf(mint); };
// The Jupiter price of a migrated coin on the page (refreshed every 2s), for anything that needs it now.
export const fastMcap = (mint) => { const x = migPx.get(mint); return x && now() - x.t < 30_000 ? x.mcap : null; };

// Mints currently on the Pulse page; the live trade feed only pushes updates for these.
export const watched = new Set();

// Overlay the live trade feed on a row (fresher than DexScreener for coins still on the curve), and the
// holder ledger built from the same feed (holders, top 10, dev, snipers, bundle).
// Once the curve completes, the coin trades in a pool the feed does not read: the curve's last reading is
// history, not a price. The pool price (Jupiter, every 2 s) or the radar's tracked price stands instead, and
// a row with neither says its number is the bonding-time one. The ledger stops at bonding too, so a bonded
// coin carries it only for LEDGER_AFTER_BOND (while it still describes the coin); then RugCheck's or nothing.
const LEDGER_AFTER_BOND = 3 * 60_000;
// The ledger's figures for a row. A book that missed the coin's first trades (partial, not yet seeded from the
// chain) knows only the wallets it saw trade: its count can only be low and its top 10 and dev share are of
// those wallets alone, so RugCheck's figures stand in wherever it has them. Seeded or complete, the ledger's win.
function ledgerFor(r) {
  let hl = rowHolders(r.mint);
  // A book that joined after the launch has no sniper or bundle figures: those come from the coin's first blocks.
  if (hl && hl.snN == null && hl.bdN == null) { const x = snipeFor(r.mint); if (x) hl = { ...hl, sn: x.sn, snN: x.snN, snOut: x.snOut, bd: x.bd, bdN: x.bdN }; }
  if (!hl?.p) return hl;
  return { ...hl, h: r.holders > (hl.h ?? 0) ? r.holders : hl.h, t10: r.top10 ?? hl.t10, dev: r.dev ?? hl.dev };
}
// What traders paid to trade a coin (network, priority, tips), the row's "F" (coinfees.js): on every column's rows,
// so each column's fee floor (New Pairs 0.001 SOL, Final Stretch 0.05, Migrated 1; pulse/ColumnFilters.tsx DEFAULTS) can hide rugs.
function withFees(r) {
  const fees = feesOf(r.mint);
  return fees ? { ...r, fees: fees.sol, feesSince: fees.since } : r;
}
function withLive(r) {
  // pump.fun Mayhem Mode (its AI agent trades the coin for the first 24 h), from the launch feed.
  if (launchIndex.get(r.mint)?.mayhem) r = { ...r, mayhem: true };
  // What traders paid to trade it (network, priority, tips), the row's "F" (coinfees.js).
  // Curve full, pool not trading yet: the row says "Migrating" and its buy button waits (livetrades.js migrationOf).
  // Always on the row (null when not): a page merging rows keeps a key it is not given, and kept "Migrating" after it ended.
  const mig = r.graduated && r.pair_created ? null : migrationOf(r.mint);
  r = { ...r, migrating: mig ? mig.since : null };
  r = withFees(r);
  const x = liveStats(r.mint);
  const bonded = r.graduated || Boolean(x?.pool) || (x?.progress ?? 0) >= 0.995;
  // The ledger follows a coin into its PumpSwap pool (x.pool); one that bonded elsewhere keeps it LEDGER_AFTER_BOND.
  const hl = bonded && !x?.pool && (!x || now() - x.last > LEDGER_AFTER_BOND) ? null : ledgerFor(r);
  if (!x || now() - x.last > 15 * MIN) return hl ? { ...r, hl } : r;
  if (bonded) {
    bondedSeen.add(r.mint);
    // Trading in its pool: every count comes from the chain, trade by trade, like a coin on the curve.
    if (x.pool) return { ...r, ...(hl ? { hl } : {}), progress: 1, graduated: true, mcap: x.mc, buys: x.buys, sells: x.sells, liveVol: x.vol, vol: x.vol, traders: x.traders,
      liq: x.liq ?? r.liq, chg1m: x.chg1m, side: x.side, lastTrade: x.last, priceT: x.last, live: true, warn: null };
    const fast = fastMcap(r.mint), tracked = r.mcap > 0 && r.priceT && now() - r.priceT < 2 * MIN ? r.mcap : null;
    const mcap = fast ?? tracked;
    return { ...r, ...(hl ? { hl } : {}), progress: 1, graduated: true, traders: x.traders, live: false, mcap: mcap ?? x.mc,
      ...(mcap == null ? { warn: { kind: "stale", text: "Just bonded: this is the last price on the curve until the pool is priced" } } : {}) };
  }
  return { ...r, mcap: x.mc, buys: r.graduated ? r.buys : x.buys, sells: r.graduated ? r.sells : x.sells, liveVol: x.vol, traders: x.traders, liq: x.liq ?? r.liq,
    progress: r.graduated ? r.progress : x.progress, chg1m: x.chg1m, side: x.side, lastTrade: x.last, live: true, hl };
}
// A migrated row whose pool the chain feed is reading: its counts, volume, traders, depth and holders from the
// feed (this second) rather than DexScreener's half-minute-old reading and RugCheck's.
function withPool(r) {
  const x = liveStats(r.mint);
  if (!x?.pool || now() - x.last > 15 * MIN) return r;
  const hl = ledgerFor(r);
  return { ...r, ...(hl ? { hl } : {}), buys: x.buys, sells: x.sells, liveVol: x.vol, vol: x.vol, traders: x.traders, liq: x.liq ?? r.liq, chg1m: x.chg1m, side: x.side, lastTrade: x.last, live: true };
}

const now = () => Date.now();
const MIN = 60_000;
const bondedSeen = new Set();   // coins shown bonded outside the Migrated column this sweep: priced from Jupiter too

// A red flag a page can show next to the number it is about (shape: { kind, text }). Every row gets one
// check, all from data already in hand (no extra requests).
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function flag(r) {
  if (r.warn) return r;
  const s = live.get(r.mint);
  if (!r.graduated && oddCurve(s)) return { ...r, warn: { kind: "odd-curve", text: "Non-standard bonding curve: priced far below where every pump.fun curve starts, so its figures do not compare" } };
  if (r.graduated && r.mcap > 0) {
    const why = readingProblem({ dex: r.dex, liquidity: r.liq, mcap: r.mcap });
    if (why) return { ...r, warn: { kind: "price-quality", text: `${cap1(why)}. Price needs verification; this is not confirmation of a rug.` } };
  }
  return r;
}
const NEW_ROWS = 160;         // newest launches shown in New pairs

// ---------- metadata for brand-new launches (picture + socials) ----------
const meta = new Map(); // mint -> { image, twitter, website, telegram, description } | { failed }
let fetching = 0;
async function fetchMeta(l) {
  fetching++;
  meta.set(l.mint, { pending: true });
  try {
    // The metadata link and everything in it is written by the coin's creator: public web addresses only.
    const uri = publicUrl(ipfs(l.uri));
    if (!uri) throw new Error("link not allowed");
    const r = await fetch(uri, { signal: AbortSignal.timeout(6000) });
    const m = JSON.parse((await r.text()).slice(0, 200_000));
    meta.set(l.mint, { image: safeUrl(m.image ? ipfs(m.image) : null), twitter: safeUrl(m.twitter), website: safeUrl(m.website), telegram: safeUrl(m.telegram), description: String(m.description || "").slice(0, 200) });
    warmX(safeUrl(m.twitter));   // its X card, read now so the hover is instant and a post deleted later still shows
  } catch { meta.set(l.mint, { failed: true, t: now(), n: (tries.get(l.mint) || 0) + 1 }); tries.set(l.mint, (tries.get(l.mint) || 0) + 1); }
  finally { fetching--; }
}
const tries = new Map();
function enrich() {
  // Newest first, a few at a time: the gateway is free, so stay polite. A metadata file that did not
  // answer is asked for twice more (new files often take a few seconds to appear on the gateways).
  const want = (l) => { const m = meta.get(l.mint); return l.uri && (!m || (m.failed && m.n < 3 && now() - m.t > 8000 * m.n)); };
  for (let i = recentLaunches.length - 1; i >= Math.max(0, recentLaunches.length - 130) && fetching < 8; i--) if (want(recentLaunches[i])) fetchMeta(recentLaunches[i]);
  // Coins close to bonding that launched before the newest 130: their socials come from the same file.
  for (const mint of stretchMints) { const l = launchIndex.get(mint); if (l && fetching < 8 && want(l)) fetchMeta(l); }
  if (tries.size > 3000) tries.clear();
  if (meta.size > 3000) for (const k of [...meta.keys()].slice(0, 1000)) meta.delete(k);
}

// A brand-new coin's metadata is asked for the moment it launches rather than on the next sweep.
export function metaNow(mint) { const l = launchIndex.get(mint); if (l?.uri && !meta.has(mint) && fetching < 16) fetchMeta(l); }

// ---------- coins the radar is not tracking ----------
// The live trade feed sees every pump.fun coin, but only knows its address. Name and ticker come from the
// launch the radar watched; for a coin launched before that (or before a restart) DexScreener is asked once.
const names = new Map();      // mint -> { symbol, name, image, created, t } | { t } while unknown
let stretchMints = [], runningMints = [];
// Coins that bonded in the last 20 minutes with no name yet. Read at most every 15 s, through an index on
// first_seen (this was a full scan of the tokens table every 2.5 s).
try { db.exec("CREATE INDEX IF NOT EXISTS tokens_first_seen ON tokens(first_seen)"); } catch {}
let jb = { t: 0, v: [] };
const justBonded = () => {
  if (now() - jb.t > 15_000) jb = { t: now(), v: db.prepare("SELECT mint FROM tokens WHERE first_seen > ? AND graduated = 1 AND symbol IS NULL").all(now() - 20 * MIN).map((r) => r.mint) };
  return jb.v;
};
const symbolOf = (m) => db.prepare("SELECT symbol FROM tokens WHERE mint = ?").get(m)?.symbol || null;
// Every stored row for a list of mints in one query (the Pulse used to read them one by one).
const tokensByMint = (mints) => mints.length ? new Map(db.prepare(`SELECT * FROM tokens WHERE mint IN (${mints.map(() => "?").join(",")})`).all(...mints).map((t) => [t.mint, t])) : new Map();
// A coin that just migrated with no name on file (launched before the radar's launch window, or before a restart):
// looked up on the next pass, ahead of the rest, so it does not sit in Migrated nameless or hidden (server.js onMigrated).
const urgentNames = new Set();
export function nameNow(mint) { if (!launchIndex.has(mint) && !names.get(mint)?.symbol && !symbolOf(mint)) urgentNames.add(mint); }
const nameInto = db.prepare("UPDATE tokens SET symbol = COALESCE(symbol, ?), name = COALESCE(name, ?), image = COALESCE(image, ?) WHERE mint = ?");
async function lookupNames() {
  if (now() - cache.t > 15_000 && !urgentNames.size) return;
  const ask = [];
  for (const m of [...urgentNames, ...stretchMints, ...runningMints, ...justBonded()]) {
    if (ask.length >= 30) break;
    const n = names.get(m);
    if (launchIndex.has(m) || n?.symbol || (n && now() - n.t < 60_000) || symbolOf(m)) continue;
    ask.push(m);
  }
  if (!ask.length) return;
  for (const m of ask) names.set(m, { t: now() });
  const got = await dexTokens(ask);
  for (const m of ask) urgentNames.delete(m);
  for (const [m, p] of got) {
    names.set(m, { symbol: p.baseToken?.symbol, name: p.baseToken?.name, image: safeUrl(p.info?.imageUrl), created: p.pairCreatedAt || null, t: now() });
    if (p.baseToken?.symbol) try { nameInto.run(p.baseToken.symbol, p.baseToken.name || null, safeUrl(p.info?.imageUrl), m); } catch {}
  }
  if (names.size > 4000) for (const k of [...names.keys()].slice(0, 1500)) names.delete(k);
}

// Pictures for those coins: pump.fun's picture CDN only answers for coins a few hours old, so the rest are
// looked up on GeckoTerminal (30 coins a call), which carries the on-chain picture for nearly every token.
const picAsked = new Map();
let needsPicture = () => true, onImage = null;
export const pictureHooks = (has, found) => { needsPicture = (m) => !has(m); onImage = found; };
// One GeckoTerminal picture call per PIC_GAP between this and fillImages (Pulse coins first), at the page
// gate's lowest rank (gtgate.js): charts, pool trades and discovery come first.
const PIC_GAP = 30_000;
let picT = 0;
async function lookupPictures() {
  if (now() - cache.t > 15_000 || now() - picT < PIC_GAP || !gtReady("low")) return;
  const ask = [...new Set([...stretchMints, ...runningMints, ...migMints])].filter((m) => needsPicture(m) && !names.get(m)?.image && now() - (picAsked.get(m) || 0) > 5 * MIN && now() - (live.get(m)?.first || launchIndex.get(m)?.seen || 0) > 20_000).slice(0, 30);
  if (!ask.length) return;
  picT = now();
  for (const m of ask) picAsked.set(m, now());
  if (picAsked.size > 3000) for (const [k, t] of picAsked) if (now() - t > 10 * MIN) picAsked.delete(k);
  let j;
  try { j = await gtGet(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/${ask.join(",")}`, { timeout: 10_000, rank: "low" }); } catch { return; }
  for (const t of j?.data || []) {
    const a = t.attributes || {}, img = safeUrl(a.image_url);
    if (!a.address) continue;
    const had = names.get(a.address) || {};
    names.set(a.address, { symbol: had.symbol || a.symbol, name: had.name || a.name, created: had.created || null, image: img && !/missing/.test(img) ? img : had.image || null, t: now() });
    if (img && !/missing/.test(img)) onImage?.(a.address);
  }
}

// A row for a coin known only from the launch feed and the live trade feed.
function bare(mint, ai) {
  const l = launchIndex.get(mint), n = names.get(mint) || {}, m = meta.get(mint) || {}, pad = live.get(mint)?.pad;
  return { mint, symbol: l?.symbol || n.symbol || null, name: l?.name || n.name || null, image: m.image || n.image || null,
    age: now() - (l?.seen || n.created || live.get(mint)?.first || now()), mcap: null, graduated: false, dex: pad ? "launchlab" : "pumpfun",
    x: m.twitter || null, web: m.website || null, tg: m.telegram || null, desc: m.description || null, creator: l?.creator || null, pool: pad || l?.pool || null,
    devSol: l?.devSol, devCount: l?.creator ? devLaunches.get(l.creator) || 1 : null, state: "watching", ai: ai || null };
}

// ---------- fast prices for migrated coins ----------
// A bonded coin trades on an exchange the live feed does not read, and the radar's own scan prices it about
// every half minute (DexScreener's answer for a coin barely changes inside a minute: measured 0 moves in
// 30s across 12 fresh coins, against 54 from Jupiter's price API). So while the Pulse page is open the
// migrated column is priced from Jupiter every 2 seconds: free, no key, 50 coins a call.
const migPx = new Map();      // mint -> { mcap, vol, liq, chg5, buys, sells, t }
let migMints = [], migPause = 0, migBusy = false, onMig = null, migDexT = 0;
const migRatio = new Map();   // mint -> tokens in circulation (market cap / price), from the radar's own reading
export const onMigratedPrices = (fn) => { onMig = fn; };
export const migStats = { calls: 0, moved: 0, last: 0, paused: 0 };
// A bonded coin whose page is open is priced with them, Pulse open or not (coin.js calls this while it builds).
const focusMints = new Map();   // mint -> last asked
export const focusPrice = (mint) => { focusMints.set(mint, now()); };
async function priceMigrated() {
  for (const [m, t] of focusMints) if (now() - t > 15_000) focusMints.delete(m);
  const pulseOpen = now() - cache.t <= 15_000;
  // Coins the chain priced in the last 20 s need no Jupiter call (a quiet pool falls back to it).
  const ids = [...new Set([...focusMints.keys(), ...(pulseOpen ? migMints : [])])].filter((m) => !chainFresh(m)).slice(0, 50);
  if (migBusy || now() < migPause || !ids.length) return;
  migBusy = true;
  try {
    const got = await jupiterGet(`/price/v3?ids=${ids.join(",")}`, { timeout: 5000 });
    migPause = now() + 6000; // Leave room in the shared allowance for interactive quotes (one call, 50 coins, every ~6 s; 2.5 s hit 429s, 4 s a few an hour).
    migStats.calls++; migStats.last = now();
    const out = [];
    for (const m of ids) {
      const usd = got[m]?.usdPrice;
      if (!(usd > 0)) continue;
      // Market cap from the coin's own price-to-cap ratio when the radar has one (every pump.fun coin has
      // a billion tokens, which is the fallback).
      // Without the radar's own ratio, only a pump.fun coin's supply is known (1B); any other coin is read from
      // its stored row, or skipped (stORE: 43K tokens priced at $131.50 became a $131.5B market cap).
      // Jupiter's circulating supply first: the chart is drawn in it (a burn makes it less than 1B).
      const circ = supplyOf(m);
      let t = circ ?? migRatio.get(m);
      if (!t && !/pump$/.test(m)) {
        const row = db.prepare("SELECT price, mcap FROM tokens WHERE mint = ?").get(m);
        if (row?.price > 0 && row?.mcap > 0) migRatio.set(m, (t = row.mcap / row.price)); else continue;
      }
      const mc = usd * (t || 1e9);
      const prev = migPx.get(m);
      migPx.set(m, { mcap: mc, t: now() });
      // Into the chart on the chart's own scale: Jupiter's circulating supply, else the radar's own price-to-cap ratio
      // for the coin (the same figure its header and lists use). Only with Jupiter's supply, a coin Jupiter has no
      // supply for (an unflagged LaunchLab→Raydium coin, 8kjE…SrYU 2026-10-11) got no price into its chart at all and
      // the chart sat 4x above the market for 5 minutes.
      if (circ || t) priceTick(m, mc);
      if (!prev || Math.round(prev.mcap) !== Math.round(mc)) out.push([m, Math.round(mc)]);
    }
    // A pool Jupiter cannot price yet (it indexes new pools within minutes): DexScreener's reading, at most
    // every 8 s for up to 30 coins, so a just-bonded coin does not sit on a minutes-old price.
    const missing = ids.filter((m) => !(got[m]?.usdPrice > 0) && now() - (migPx.get(m)?.t || 0) > 8000);
    if (missing.length && now() - migDexT > 8000) {
      migDexT = now();
      const pairs = await dexTokens(missing.slice(0, 30)).catch(() => new Map());
      for (const [m, pr] of pairs) {
        const mc = pr.marketCap || pr.fdv;
        if (!(mc > 0)) continue;
        const prev = migPx.get(m);
        migPx.set(m, { mcap: mc, liq: pr.liquidity?.usd ?? null, t: now(), src: "dex" });
        priceTick(m, mc);
        if (!prev || Math.round(prev.mcap) !== Math.round(mc)) out.push([m, Math.round(mc)]);
      }
    }
    migStats.moved += out.length;
    if (out.length) onMig?.(out);
    if (migPx.size > 600) for (const [k, v] of migPx) if (now() - v.t > 10 * MIN) migPx.delete(k);
  } catch (e) { if (e.status === 429) { migPause = now() + 30_000; migStats.paused++; } }
  finally { migBusy = false; }
}
// Bonded pump.fun coins are priced trade by trade from the chain (pumpswap.js): within a slot, where the
// Jupiter poll above trails by seconds. Every trade also goes into the chart's candle book. Moves of coins
// on the page (or a coin page that is open) go out together every 100 ms.
const chainOut = new Map();
let chainTimer = null;
// An open chart's fast feed (fastpx.js, set by server.js) leads its candles; the late log copy would drag them back.
let fastCheck = () => false;
export const setPulseFastCheck = (fn) => { fastCheck = fn; };
onPoolTrade((mint, e) => {
  const mc = e.mcSol * feed.solUsd;
  if (!fastCheck(mint)) addTrade(mint, mc, e.sol * feed.solUsd, e.buy, slotTime(e.slot) ?? Date.now());
  const prev = migPx.get(mint);
  migPx.set(mint, { mcap: mc, t: now(), src: "chain" });
  if (prev && Math.round(prev.mcap) === Math.round(mc)) return;
  if (!watched.has(mint) && !focusMints.has(mint)) return;
  chainOut.set(mint, Math.round(mc));
  if (!chainTimer) chainTimer = setTimeout(() => { chainTimer = null; const out = [...chainOut]; chainOut.clear(); if (out.length) onMig?.(out); }, 100);
});
const chainFresh = (m) => migPx.get(m)?.src === "chain" && now() - migPx.get(m).t < 20_000;
// Coins outside PumpSwap with an open chart: their pool's price on every change (poolwatch.js), on the chart's
// scale (no supply known yet: not drawn). No trade size, so the chart candles get prices, not volume.
const chainMc = [];
export const onChainMc = (fn) => chainMc.push(fn);
onPoolPrice((mint, { px, quote }) => {
  // The SOL price itself (poolwatch.js watchSol): kept live for every SOL-to-dollar figure.
  if (mint === WSOL_MINT) { if (quote === "usd" && px > 10 && px < 10_000) { feed.solUsd = px; feed.solKnown = true; feed.solT = now(); } return; }
  const sup = supplyOf(mint);
  if (!sup) return;
  const mc = px * (quote === "sol" ? feed.solUsd : 1) * sup;
  if (!(mc > 0)) return;
  priceTick(mint, mc);
  const prev = migPx.get(mint);
  migPx.set(mint, { mcap: mc, t: now(), src: "chain" });
  for (const fn of chainMc) fn(mint, mc);
  if (prev && Math.round(prev.mcap) === Math.round(mc)) return;
  chainOut.set(mint, Math.round(mc));
  if (!chainTimer) chainTimer = setTimeout(() => { chainTimer = null; const out = [...chainOut]; chainOut.clear(); if (out.length) onMig?.(out); }, 100);
});

function withFastPrice(r) {
  const x = migPx.get(r.mint);
  // A coin whose live cap disagrees with DexScreener (price-sanity.js) keeps DexScreener's figure (liveStats gave it).
  if (!x || now() - x.t > 30_000 || sanity.suspect(r.mint)) return r;
  return { ...r, mcap: x.mcap, priceT: x.t, ...(x.liq != null ? { liq: x.liq } : {}) };
}
// A bonded coin's price that is minutes old says so (a fresh pool can fall 90% in that time).
function staleness(r) {
  const age = r.priceT ? now() - r.priceT : null;
  return r.warn || age == null || age < 2 * MIN ? r : { ...r, warn: { kind: "stale", text: `Price is ${Math.round(age / MIN)} min old: the pool has not been priced since` } };
}

// ---------- rows ----------
// The five fields Pulse wants from a full research report, parsed once per version of the report instead of
// on every Pulse build (parsing ~500 report blobs each time was the heaviest part of pulseData).
const reportBits = new Map();   // mint -> { key, bits }
const bitsKey = (r) => `${r.t}|${r.status}|${r.stage}|${r.model}`;
function researchMap(mints) {
  if (!mints.length) return new Map();
  const marks = mints.map(() => "?").join(",");
  const rows = db.prepare(`SELECT mint, status, grade, score, tier, verdict, stage, t, model FROM research WHERE status != 'expired' AND mint IN (${marks})`).all(...mints);
  const stale = rows.filter((r) => reportBits.get(r.mint)?.key !== bitsKey(r)).map((r) => r.mint);
  if (stale.length) {
    for (const r of db.prepare(`SELECT mint, status, stage, t, model, report FROM research WHERE status != 'expired' AND mint IN (${stale.map(() => "?").join(",")})`).all(...stale)) {
      const rep = json(r.report, {});
      reportBits.set(r.mint, { key: bitsKey(r), bits: { action: rep.trade?.action || null, pwin: rep.trade?.pWin ?? null, conviction: rep.trade?.conviction ?? null, tag: rep.narrative?.tag || null, organic: rep.xBuzz?.organic || null } });
    }
    if (reportBits.size > 5000) for (const k of [...reportBits.keys()].slice(0, reportBits.size - 4000)) reportBits.delete(k);
  }
  const none = { action: null, pwin: null, conviction: null, tag: null, organic: null };
  return new Map(rows.map((r) => [r.mint, { status: r.status, grade: r.grade, score: r.score, tier: r.tier, verdict: r.verdict, stage: r.stage, t: r.t, model: r.model, rated: Boolean(r.grade) && ["done", "deep"].includes(r.status),
    ...(reportBits.get(r.mint)?.bits || none) }]));
}

// RugCheck's holder figures for a tokens row, or nulls where the reading cannot still be true. An empty
// report (0 holders, nothing in the top 10) is a coin RugCheck has not indexed yet, and its safety score
// says nothing about concentration. A bonded coin's report from its first minutes in the pool dates fast:
// a dev who bought out the curve reads as holding 79% with a few dozen holders, then airdrops and reads 0%
// and 2,000 holders minutes later. Such a reading stands for EARLY_TTL, then is hidden until a re-check.
const SETTLED = 15 * 60_000, EARLY_TTL = 3 * 60_000;
export function rugFigures(t, s = json(t?.safety) || {}) {
  const none = { holders: null, top10: null, dev: null, insiders: null, safety: null, checked: t?.safety_checked || null };
  const at = t?.safety_checked;
  if (!s || !Object.keys(s).length) return none;
  if (t.graduated && !((at && t.pair_created && at - t.pair_created >= SETTLED) || (at && now() - at < EARLY_TTL))) return none;
  const indexed = s.totalHolders > 0 || s.top10 > 0;
  return { holders: s.totalHolders > 0 ? s.totalHolders : null, top10: s.top10 > 0 ? s.top10 : null, dev: indexed ? s.devPct ?? null : null,
    insiders: indexed ? s.insiderPct ?? null : null, safety: indexed ? t.safety_score ?? null : null, checked: at || null };
}

function row(t, ai) {
  const s = json(t.safety) || {};
  const rf = rugFigures(t, s);
  const links = cleanLinks(json(t.links, []));
  const link = (re) => links.find((l) => re.test(`${l.type} ${l.url}`))?.url || null;
  return {
    mint: t.mint, symbol: t.symbol, name: t.name, image: t.image, age: now() - (t.migrated_at || t.pair_created || t.first_seen), dex: t.dex, priceT: t.price_t || t.updated || null,
    mcap: t.mcap, vol: t.vol_h1, vol5m: t.vol_m5, peak: t.peak_mcap, liq: t.liquidity > 0 || t.graduated || t.dex !== "pumpfun" ? t.liquidity : curveLiqUsd(t.mcap), chg5: t.chg_m5, chg1h: t.chg_h1, buys: t.buys_h1, sells: t.sells_h1,
    holders: rf.holders, top10: rf.top10, dev: rf.dev, insiders: rf.insiders,
    safety: rf.safety, danger: (s.danger || 0) > 0, progress: t.progress ?? bondingProgress(t), graduated: !!t.graduated,
    x: link(/twitter|x\.com/i), web: links.find((l) => l.type === "website")?.url || null, tg: link(/telegram|t\.me/i),
    tiktok: link(/tiktok/i), creator: t.creator || null, paid: (t.boosts || 0) > 0 || Boolean(t.header),
    ai: ai || null,
  };
}

// The header's research counters: cheap to keep 10 s old (the reads-per-hour count alone took ~80 ms).
let counts = { t: 0, v: null };
function researchCounts() {
  if (counts.v && now() - counts.t < 10_000) return counts.v;
  counts = { t: now(), v: {
    reading: db.prepare("SELECT COUNT(*) n FROM research WHERE status = 'running'").get().n,
    queued: db.prepare("SELECT COUNT(*) n FROM research WHERE status IN ('queued', 'deep')").get().n,
    ratedHour: db.prepare("SELECT COUNT(*) n FROM research WHERE t > ? AND status IN ('done', 'deep')").get(now() - 60 * MIN).n,
  } };
  return counts.v;
}

let cache = { t: 0, v: null };
export function pulseData() {
  if (now() - cache.t < 1500 && cache.v) return cache.v;
  const { near, bonded } = candidates();
  // New pairs: the newest launches, joined with the radar's data once it starts tracking them.
  // Newest first by when each launch was heard, not by its place in the list: the backfill after a restart appends
  // older launches at the end, and taking the end of the list put day-old coins at the top of New Pairs (130 of 148
  // rows over 6 hours old, 2026-10-11). Nothing older than a day belongs in New Pairs at all.
  const dayAgo = now() - 24 * 60 * MIN;
  const fresh = recentLaunches.filter((l) => l.seen > dayAgo).sort((a, b) => b.seen - a.seen).slice(0, NEW_ROWS);
  const tracked = fresh.length ? new Map(db.prepare(`SELECT * FROM tokens WHERE mint IN (${fresh.map(() => "?").join(",")})`).all(...fresh.map((l) => l.mint)).map((t) => [t.mint, t])) : new Map();
  // Final stretch: every coin the live trade feed sees at 50%+ of the curve and still trading, then any
  // tracked coin near bonding the feed has not seen trade yet (only with volume: no dead ones).
  const nearBy = new Map(near.map((t) => [t.mint, t]));
  stretchMints = closeToBonding(0.5, 10 * MIN, 100);
  const stretchRows = tokensByMint(stretchMints.filter((m) => !nearBy.has(m)));
  const inFeed = new Set(stretchMints);
  const quiet = near.filter((t) => !inFeed.has(t.mint) && (t.vol_h1 || 0) > 0 && now() - (t.price_t || 0) < 10 * MIN).slice(0, 20);
  // Migrated: everything that bonded in the last 6 hours and is still worth something, plus coins that
  // bonded seconds ago and have no pool listed yet.
  const since = now() - 6 * 60 * MIN;
  const older = db.prepare(`SELECT * FROM tokens INDEXED BY tokens_bonded_t WHERE status = 'active' AND graduated = 1 AND pair IS NOT NULL AND quarantine IS NULL AND COALESCE(asset_class, 'meme') = 'meme'
    AND COALESCE(pair_created, first_seen) > ? AND mcap >= 5000 ORDER BY COALESCE(pair_created, first_seen) DESC LIMIT 80`).all(since);
  const seconds = db.prepare("SELECT * FROM tokens WHERE graduated = 1 AND (pair IS NULL OR COALESCE(mcap, 0) < 5000) AND status = 'active' AND quarantine IS NULL AND COALESCE(migrated_at, pair_created, first_seen) > ? ORDER BY COALESCE(migrated_at, pair_created, first_seen) DESC LIMIT 20").all(now() - 10 * MIN);
  const all = [...fresh.map((l) => l.mint), ...stretchMints, ...quiet.map((t) => t.mint), ...older.map((t) => t.mint), ...seconds.map((t) => t.mint)];
  const ai = researchMap([...new Set(all)]);
  const newPairs = fresh.filter((l) => { const t = tracked.get(l.mint); return !t || now() - (t.pair_created || t.first_seen) < 24 * 60 * MIN; }).map((l) => {
    const t = tracked.get(l.mint);
    const m = meta.get(l.mint) || {};
    // Before its first trade a launch's market cap is the curve's starting one, from the launch event itself.
    const base = t ? row(t, ai.get(l.mint)) : {
      mint: l.mint, symbol: l.symbol, name: l.name, image: null, age: now() - l.seen, mcap: l.mcapSol > 0 ? l.mcapSol * feed.solUsd : null, ai: ai.get(l.mint) || null,
    };
    const age = now() - l.seen;
    return { ...base, image: base.image || m.image || null, x: base.x || m.twitter, web: base.web || m.website, tg: base.tg || m.telegram,
      desc: m.description || null, creator: base.creator || l.creator || null, pool: live.get(l.mint)?.pad || l.pool || null, devSol: l.devSol, early: earlyFor(l.mint), tri: triageFor(l.mint), startMcapSol: l.mcapSol, devCount: devLaunches.get(l.creator) || 1,
      state: t ? "tracked" : age < 4.5 * MIN ? "watching" : "faded" };
  }).map(withLive).map(rankRow)
    // A coin created on chain hours ago that a feed only just heard of (Jupiter's recent-pools list names old coins
    // whose pool is new) is not a new pair: 76 of 98 rows were over 6 hours old on 2026-10-11. `age` is ms here.
    .filter((r) => !(r.age > 6 * 60 * MIN));
  // A coin that's still trading isn't faded, whatever the 4-minute check said.
  for (const r of newPairs) if (r.state === "faded" && r.lastTrade && now() - r.lastTrade < 2 * MIN) r.state = "watching";
  const stretch = [...stretchMints.map((m) => {
    const t = nearBy.get(m) || stretchRows.get(m);
    if (!t) return withLive(bare(m, ai.get(m)));
    if (t.graduated) return null;
    const b = bare(m), r = row(t, ai.get(m));
    return withLive({ ...r, symbol: r.symbol || b.symbol, name: r.name || b.name, image: r.image || b.image, x: r.x || b.x, web: r.web || b.web, tg: r.tg || b.tg, creator: r.creator || b.creator, devSol: b.devSol, devCount: b.devCount });
  }), ...quiet.map((t) => withLive(row(t, ai.get(t.mint))))].filter((r) => r && r.symbol && !r.graduated).map(rankRow).sort((a, b) => (b.progress || 0) - (a.progress || 0));
  for (const t of older) if (t.price > 0 && t.mcap > 0) migRatio.set(t.mint, t.mcap / t.price);
  if (migRatio.size > 800) migRatio.clear();
  const migrated = [...seconds, ...older].map((t) => {
    const b = bare(t.mint), r = row({ ...t, graduated: 1 }, ai.get(t.mint)), x = liveStats(t.mint);
    // Bonded seconds ago: its last price on the curve stands in until the new pool is priced, and says so.
    const nm = r.symbol || b.symbol ? null : coinIndex.nameOf(t.mint);
    const out = withFees(withPool(withFastPrice({ ...r, symbol: r.symbol || b.symbol || nm?.symbol || null, name: r.name || b.name || nm?.name || null, image: r.image || b.image, mcap: r.mcap ?? (x ? x.mc : null), progress: 1, migrating: null })));
    return r.mcap == null && x && out.priceT == null ? { ...out, warn: { kind: "stale", text: "Just bonded: this is the last price on the curve until the pool is priced" } } : staleness(out);
  }).filter((r) => r.symbol && (r.mcap || 0) >= 5000).map(rankRow).sort((a, b) => a.age - b.age).slice(0, 80);
  bondedSeen.clear();
  // Running now: every coin moving in the last 5 minutes that no other column holds (older than the New
  // pairs window and under 50% of the curve, say), hottest first. From coverage.js, off the live trade feed.
  const shownSet = new Set([...newPairs, ...stretch, ...migrated].map((r) => r.mint));
  const runs = runners({ limit: 100, exclude: shownSet });
  for (const [k, v] of researchMap(runs.map((w) => w.mint))) ai.set(k, v);
  const runRows = tokensByMint(runs.map((w) => w.mint));
  const running = runs.map((w) => {
    const t = runRows.get(w.mint);
    const base = t && !t.graduated ? row(t, ai.get(w.mint)) : bare(w.mint, ai.get(w.mint));
    const b = bare(w.mint);
    return withLive({ ...base, symbol: base.symbol || b.symbol, name: base.name || b.name, image: base.image || b.image, x: base.x || b.x, web: base.web || b.web, tg: base.tg || b.tg, creator: base.creator || b.creator, devSol: base.devSol ?? b.devSol, devCount: base.devCount ?? b.devCount,
      tri: triageFor(w.mint), win: { trades: w.trades, traders: w.traders, netSol: +w.netSol.toFixed(2), chg: w.chg == null ? null : Math.round(w.chg), heat: w.heat } });
  // A moving coin is shown even before its name is known (the lookup fills it in a few seconds later).
  }).map((r) => r.symbol ? r : { ...r, symbol: `${r.mint.slice(0, 4)}…`, name: "name loading" }).map(rankRow);
  runningMints = running.map((r) => r.mint);
  // Jupiter prices every migrated row, and any coin another column shows as just bonded (first, they are few).
  migMints = [...new Set([...bondedSeen, ...migrated.map((r) => r.mint)])];
  // mv: real trading in the last 5 minutes (coverage.js): the page shows it even if its holders look like a rug.
  for (const list of [newPairs, stretch, migrated, running]) for (let i = 0; i < list.length; i++) { const r = flag(list[i]); list[i] = r.win || isMoving(r.mint) ? { ...r, mv: true } : r; }
  // Anything moving that no AI has read yet goes to the queue (the queue's own cap and ranking take it from there).
  try { readHot([...running, ...stretch, ...newPairs.filter((r) => r.state !== "faded")]); } catch {}
  const { reading, queued, ratedHour } = researchCounts();
  const perMin = recentLaunches.filter((l) => l.seen > now() - MIN).length;
  watched.clear();
  for (const r of [...newPairs, ...stretch, ...migrated, ...running]) watched.add(r.mint);
  // Partial holder books among them are read from the chain once (holders.js), busiest first.
  try { seedWanted([...stretch, ...migrated, ...running, ...newPairs].map((r) => r.mint)); } catch {}
  const pv = providers(), qs = queueStatus();
  // Who is actually doing the reading right now, and why it may differ from what was configured.
  const lanes = { fast: pv.fast.actualName, deep: pv.deep.actualName, fastFallback: pv.fast.fallback ? pv.fast.reason : null, deepFallback: pv.deep.fallback ? pv.deep.reason : null, note: pv.fast.note || pv.deep.note, recovery: pv.recovery };
  cache = { t: now(), v: { newPairs, stretch, migrated, running, live: { running: reading, queued, ratedHour, launchesPerMin: perMin, tradesPerSec: feed.perSec, feed: feed.connected, solUsd: feed.solUsd, triage: triageStats, grokBlocked: grokStatus().blocked, ai: lanes, queue: qs, holders: holderStats }, ts: now() } };
  return cache.v;
}

// The anti-slop list: today's launches that got past triage. `fresh` are decent-looking coins not yet
// sent for a read, `reading` are in the queue or being read right now, `rated` have their grade.
// Built at most every 5 s (two scans of the research table and up to 240 coins), with one batched read of
// the coins instead of one per job.
let slop = { t: 0, v: null };
export function antiSlop() {
  if (slop.v && now() - slop.t < 5000) return slop.v;
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const jobs = db.prepare(`SELECT mint, status, enq_t, t FROM research WHERE COALESCE(enq_t, t) > ? AND status != 'expired' ORDER BY COALESCE(t, enq_t) DESC LIMIT 240`).all(d0.getTime());
  const ai = researchMap(jobs.map((j) => j.mint));
  const coins = tokensByMint(jobs.map((j) => j.mint));
  const rows = jobs.map((j) => {
    const t = coins.get(j.mint);
    return t && { ...withLive(row(t, ai.get(j.mint))), tri: triageFor(j.mint), waited: j.enq_t ? now() - j.enq_t : null, state: "tracked", tr: liveTraction(t).score, early: earlyFor(j.mint) };
  }).filter(Boolean);
  const fresh = pulseData().newPairs.filter((r) => r.tri && ["maybe", "promising"].includes(r.tri.label) && !r.ai && r.state !== "faded").slice(0, 60);
  const dropped = db.prepare("SELECT COUNT(*) n FROM research WHERE COALESCE(enq_t, t) > ? AND status = 'expired'").get(d0.getTime()).n;
  slop = { t: now(), v: { fresh, reading: rows.filter((r) => !r.ai?.rated), rated: rows.filter((r) => r.ai?.rated), dropped } };
  return slop.v;
}

// Coin pictures. Most tracked coins arrive without one (only coins with a paid DexScreener profile carry
// an image), so every 20 seconds a batch of picture-less coins is looked up: first in the launch
// metadata the radar already fetched, then on GeckoTerminal, which serves the on-chain image for
// almost every token (30 coins per call).
const imgTried = new Map();   // mint -> when it was last looked up
let picked = { t: 0, v: [] }; // coins picked or entry-watched in the last 48 h: two table scans, so re-read every 5 min
async function fillImages() {
  // Picked coins first (they stay on the lists after they die), then everything still being tracked.
  if (now() - picked.t > 5 * MIN) picked = { t: now(), v: db.prepare("SELECT mint FROM outcomes WHERE kind = 'pick' AND t0 > ? UNION SELECT mint FROM entry_watch WHERE t > ?").all(now() - 48 * 60 * MIN, now() - 48 * 60 * MIN).map((r) => r.mint) };
  const due = (m) => now() - (imgTried.get(m) || 0) > 45 * MIN;
  const picks = picked.v.filter(due).slice(0, 500);
  const rows = [...(picks.length ? db.prepare(`SELECT mint FROM tokens WHERE image IS NULL AND mint IN (${picks.map(() => "?").join(",")})`).all(...picks) : []),
    ...db.prepare("SELECT mint FROM tokens WHERE status = 'active' AND image IS NULL ORDER BY COALESCE(updated, first_seen) DESC LIMIT 400").all()]
    .filter((r) => due(r.mint));
  const set = db.prepare("UPDATE tokens SET image = ? WHERE mint = ? AND image IS NULL");
  const ask = [];
  for (const r of rows) {
    const m = meta.get(r.mint);
    if (m?.image) set.run(m.image, r.mint); else if (ask.length < 30) ask.push(r.mint);
  }
  if (!ask.length || now() - picT < PIC_GAP || !gtReady("low")) return;
  picT = now();
  for (const m of ask) imgTried.set(m, now());
  if (imgTried.size > 5000) for (const [m, t] of imgTried) if (now() - t > 60 * MIN) imgTried.delete(m);
  let j;
  try { j = await gtGet(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/${ask.join(",")}`, { timeout: 12_000, rank: "low" }); } catch { return; }
  for (const t of j?.data || []) {
    const img = safeUrl(t.attributes?.image_url);
    if (img && !/missing/.test(img) && t.attributes?.address) set.run(img, t.attributes.address);
  }
}

export function startPulse() {
  watchSol();
  const timer = setInterval(enrich, 1000);
  const fast = setInterval(() => priceMigrated().catch(() => {}), 1000);
  const look = setInterval(() => lookupPictures().catch(() => {}), 6000);
  const who = setInterval(() => lookupNames().catch(() => {}), 2500);
  const pics = setInterval(() => fillImages().catch(() => {}), 20_000);
  setTimeout(() => fillImages().catch(() => {}), 60_000);   // not in the first minute, when everything else starts cold
  return () => { clearInterval(timer); clearInterval(pics); clearInterval(fast); clearInterval(who); clearInterval(look); };
}
