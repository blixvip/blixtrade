// The radar loop: discover → enrich → safety check → score → signals → outcome tracking.
import { startFastCreate } from "./fastcreate.js";
import { EventEmitter } from "node:events";
import * as coinIndex from "./coinindex.js";
import { db, q, json, logEvent, prune } from "./db.js";
import * as src from "./sources.js";
import { themesFor } from "./narratives.js";
import { settings } from "./settings.js";
import { startWallets, walletSignals, revalidateWinners } from "./wallets.js";
import { CURVE_DEX, MAJOR_MINTS, readingProblem, exitState, classifyAsset, safetyVerdict, cleanLinks, safeUrl } from "./quality.js";
import * as health from "./health.js";
import { meta } from "./db.js";
import { onLiveCreate, live as liveCurves, feed as liveFeed } from "./livetrades.js";
import { windowStats } from "./candles.js";
import { startCoverage } from "./coverage.js";
import { warmX } from "./xcard.js";

export const bus = new EventEmitter();
export const stats = { launchesSeen: 0, nursery: 0, graduated: 0, tracked: 0, signals: 0, pump: "connecting", pumpLast: 0, lastCycle: 0, errors: 0, quarantined: 0, startedAt: Date.now() };

const now = () => Date.now();
const MIN = 60_000;

// ---------- discovery ----------
// Brand-new pump.fun launches wait here; most die within minutes, so we only look at them later.
const nursery = new Map(); // mint -> { seen, symbol, name, source }
// Every launch name in the last 6h, for narrative trends (~30k short strings at most).
export const launchLog = [];
// The newest launches with full detail, for the Pulse view's "New pairs" column.
export const recentLaunches = [];
// The last couple of hours of launches by mint (name, ticker, metadata link, dev), so a coin that turns up
// close to bonding on the live trade feed can be shown with its name before the radar tracks it.
export const launchIndex = new Map();
// How many coins each dev wallet launched in the last 6h (serial launchers are mostly rugs).
export const devLaunches = new Map();

// The launch log is kept in SQLite too, so a restart doesn't wipe 6 hours of narrative history.
db.exec("CREATE TABLE IF NOT EXISTS launches (t INTEGER, name TEXT, symbol TEXT, creator TEXT)");
db.exec("CREATE INDEX IF NOT EXISTS launches_t ON launches(t)");
// The mint and metadata link are kept too, so a restart does not forget the name of every coin launched in
// the last 6 hours (a coin that wakes up later would otherwise show up nameless, or not at all).
for (const col of ["mint TEXT", "uri TEXT"]) { try { db.exec(`ALTER TABLE launches ADD COLUMN ${col}`); } catch {} }
// "Every coin this dev made" (the coin page) is asked by creator.
try { db.exec("CREATE INDEX IF NOT EXISTS tokens_creator ON tokens(creator); CREATE INDEX IF NOT EXISTS launches_creator ON launches(creator);"); } catch {}
for (const l of db.prepare("SELECT t, name, symbol, creator, mint, uri FROM launches WHERE t > ? ORDER BY t").all(Date.now() - 6 * 3600e3)) {
  launchLog.push({ t: l.t, name: l.name, symbol: l.symbol, creator: l.creator });
  if (l.creator) devLaunches.set(l.creator, (devLaunches.get(l.creator) || 0) + 1);
  if (l.mint) launchIndex.set(l.mint, { mint: l.mint, name: l.name, symbol: l.symbol, creator: l.creator, uri: l.uri, pool: "pump", seen: l.t, restored: true });
}
let unsaved = [];
function saveLaunches() {
  if (!unsaved.length) return;
  const ins = db.prepare("INSERT INTO launches (t, name, symbol, creator, mint, uri) VALUES (?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  for (const l of unsaved) ins.run(l.t, l.name, l.symbol, l.creator || null, l.mint || null, l.uri || null);
  db.exec("COMMIT");
  unsaved = [];
  db.prepare("DELETE FROM launches WHERE t < ?").run(Date.now() - 6 * 3600e3);
}

function adopt(t) {
  const had = t.mint && q.getToken.get(t.mint);
  if (!t.mint || had) {
    // A retired coin that a live source finds again (it graduated, took off on the feed, trends on
    // GeckoTerminal, got boosted) is live again: it was retired on old figures. Re-read on the next cycle.
    if (had?.status === "dead" && t.source !== "wallet") { db.prepare("UPDATE tokens SET status = 'active', updated = 0 WHERE mint = ?").run(t.mint); stats.revived = (stats.revived || 0) + 1; }
    if (t.mint && t.boosts) db.prepare("UPDATE tokens SET boosts = MAX(boosts, ?) WHERE mint = ?").run(t.boosts, t.mint);
    if (t.mint && t.description) db.prepare("UPDATE tokens SET description = COALESCE(NULLIF(description,''), ?) WHERE mint = ?").run(t.description, t.mint);
    return false;
  }
  q.insertToken.run(t.mint, t.symbol || null, t.name || null, t.description || "", safeUrl(t.image), t.source, now(), JSON.stringify(cleanLinks(t.links)), 0);
  if (t.boosts) db.prepare("UPDATE tokens SET boosts = ? WHERE mint = ?").run(t.boosts, t.mint);
  if (t.creator) db.prepare("UPDATE tokens SET creator = ?, dev_sol = ? WHERE mint = ?").run(t.creator, t.devSol ?? null, t.mint);
  if (t.uri) db.prepare("UPDATE tokens SET uri = ? WHERE mint = ?").run(t.uri, t.mint);
  safetyQueue.add(t.mint);
  return true;
}

function startPump() {
  return src.pumpStream({
    onStatus: (s) => { stats.pump = s; s === "connected" ? health.ok("pumpportal") : health.fail("pumpportal", s); },
    onToken: (t) => {
      stats.pumpLast = now();
      addLaunch(t);
    },
    onMigration: ({ mint }) => {
      stats.graduated++;
      nursery.delete(mint);
      adopt({ mint, source: "pump-graduated" });
      db.prepare("UPDATE tokens SET graduated = 1 WHERE mint = ?").run(mint);
      pendingGraduations.add(mint);
      bus.emit("migration", mint);
    },
  });
}

// A pump.fun coin's first trade in its PumpSwap pool, from the chain (pumpswap.js): it has bonded, whether or not
// PumpPortal's migration event came (it drops some) and before the next DexScreener read names the pair. The pool
// is the pair (DexScreener's pair id for PumpSwap is the pool), so the Migrated column can show it at once.
const bondedOnChainSeen = new Set();
// Coins that just migrated are never retired by the cap cull below (they have no hour of volume yet, so the cap
// took them first: 47 of 69 coins bonded in 15 minutes sat 'dead', 9 s after adoption, 2026-10-11) nor left dead
// from before this rule: revived once at start.
try { db.prepare("UPDATE tokens SET status = 'active', updated = 0 WHERE status = 'dead' AND graduated = 1 AND COALESCE(migrated_at, pair_created, first_seen) > ?").run(now() - 30 * MIN); } catch {}
// exact = pump.fun's own migration event (livetrades.js poolMigrated), at = when: the coin's Migrated clock starts
// there, whatever DexScreener later says the pool's creation was (it said 47-108 s earlier for two coins, so a
// coin arrived in Migrated a minute old). A pool trade (exact = false) only marks a coin the event was missed for.
export function bondedOnChain(mint, pool, at = now(), exact = false) {
  if (bondedOnChainSeen.has(mint) && !exact) return;
  const had = q.getToken.get(mint);
  // A coin the radar never tracked (most fresh launches) is adopted this instant with what the launch feed knows
  // of it, then marked like any other: it is in Migrated at a second old, not after its next pool trade and scan.
  if (!had) {
    const l = launchIndex.get(mint), s0 = liveCurves.get(mint);
    adopt({ mint, symbol: l?.symbol, name: l?.name, uri: l?.uri, creator: l?.creator, devSol: l?.devSol, source: "pump-graduated" });
    // Never tracked, and neither heard launching nor seen filling its curve: an old coin whose pool just traded
    // (after a restart, or one the radar never followed), not a migration. Listed as bonded, dated by DexScreener's
    // pool age on the next scan; never "bonded seconds ago" at a cap taken from a pool trade (2026-10-11: 70-day-old
    // coins sat at the top of Migrated at $100K-800K while the market said $2K).
    const recent = Boolean(l) || (s0?.completeAt && now() - s0.completeAt < 60 * MIN);
    if (!exact && !recent) {
      db.prepare("UPDATE tokens SET graduated = 1, status = 'active', pair = COALESCE(pair, ?), dex = COALESCE(dex, 'pumpswap'), pair_created = 0 WHERE mint = ?").run(pool || null, mint);
      bondedOnChainSeen.add(mint);
      return;
    }
  }
  bondedOnChainSeen.add(mint); if (bondedOnChainSeen.size > 5000) bondedOnChainSeen.clear();
  // Known exactly already, or bonded long ago (a pool trade of an old coin after a restart): nothing to move.
  if (had?.migrated_at) return;
  if (had?.graduated && had?.pair && (!exact || (had.pair_created && at - had.pair_created > 10 * MIN))) return;
  // Its market cap from the live curve (SOL, at the live SOL price) until the scan reads the pool: the Migrated
  // column's query wants one. Active, and no quarantine: whatever was read of it on the curve is the past.
  const s = liveCurves.get(mint), mc = s?.mc > 0 && liveFeed.solUsd > 0 ? Math.round(s.mc * liveFeed.solUsd) : null;
  const r = exact
    ? db.prepare("UPDATE tokens SET graduated = 1, status = 'active', quarantine = NULL, pair = COALESCE(?, pair), dex = 'pumpswap', pair_created = ?, migrated_at = ?, mcap = COALESCE(?, NULLIF(mcap, 0)) WHERE mint = ?").run(pool || null, at, at, mc, mint)
    : db.prepare("UPDATE tokens SET graduated = 1, status = 'active', pair = COALESCE(pair, ?), dex = COALESCE(dex, 'pumpswap'), pair_created = COALESCE(pair_created, ?), mcap = COALESCE(NULLIF(mcap, 0), ?) WHERE mint = ?").run(pool || null, at, mc, mint);
  if (!r.changes || had?.graduated) return;
  stats.graduated++;
  nursery.delete(mint);
  pendingGraduations.add(mint);
  bus.emit("migration", mint);
}

// One way in for a launch, whichever feed saw it first (PumpPortal, or the chain itself via the live feed).
export const launchFeeds = { pumpportal: 0, chainOnly: 0 };
function addLaunch(t) {
  if (!t.mint) return false;
  // Heard already (from the chain, a moment before PumpPortal): PumpPortal's extras (the dev's buy, the curve's
  // start) fill in on the same row; the next board read shows them.
  const had = launchIndex.get(t.mint);
  if (had) {
    if (t.mcapSol != null && had.mcapSol == null) had.mcapSol = t.mcapSol;
    if (t.devSol != null && had.devSol == null) had.devSol = t.devSol;
    if (t.pool && !had.pool) had.pool = t.pool;
    if (!had.name && t.name) had.name = t.name;
    if (!had.symbol && t.symbol) had.symbol = t.symbol;
    if (!had.uri && t.uri) had.uri = t.uri;
    return false;
  }
  /-chain$/.test(t.source || "") ? launchFeeds.chainOnly++ : launchFeeds.pumpportal++;
  stats.launchesSeen++;
  const entry = { t: now(), name: t.name || "", symbol: t.symbol || "", creator: t.creator };
  launchLog.push(entry);
  unsaved.push({ ...entry, mint: t.mint, uri: t.uri });
  if (t.creator) devLaunches.set(t.creator, (devLaunches.get(t.creator) || 0) + 1);
  if (nursery.size < 20000) nursery.set(t.mint, { ...t, seen: now() });
  const launch = { ...t, seen: now(), devCount: t.creator ? devLaunches.get(t.creator) : 1 };
  recentLaunches.push(launch);
  launchIndex.set(t.mint, launch);
  coinIndex.note({ mint: t.mint, name: t.name, symbol: t.symbol, uri: t.uri, creator: t.creator });   // kept for good (coinindex.js)
  if (launchIndex.size > 24000) for (const k of [...launchIndex.keys()].slice(0, 3000)) launchIndex.delete(k);
  bus.emit("launch", { mint: t.mint, symbol: t.symbol, name: t.name, mcapSol: t.mcapSol, devSol: t.devSol, devCount: launch.devCount });
  if (recentLaunches.length > 400) recentLaunches.splice(0, recentLaunches.length - 400);
  return true;
}
// A coin created on chain goes on the board the moment the chain shows it (PumpPortal misses ~40% of creates,
// and waiting 2 s for it put every such coin on the board 2-4 s after Axiom's; 2026-10-11). When PumpPortal does
// announce it, its extras merge into the row (addLaunch).
function fillLaunchGaps() {
  onLiveCreate((c) => { addLaunch({ mint: c.mint, symbol: c.symbol, name: c.name, uri: c.uri, creator: c.creator, pool: c.pool || "pump", mcapSol: null, devSol: null, source: c.source || "pump-chain" }); });
}
const pendingGraduations = new Set();

// pump.fun's own list of its newest coins, read back so no launch stays unseen. A restart loses the launches made
// while the radar was down and connecting (measured 2026-10-09: 18 of 1,024 coins in 33 minutes, every one within
// ~2 minutes of one of 8 restarts, never indexed). At start the list is read back page by page to the last coin
// the index knew before the restart; after that its first page every 45 s catches anything both live feeds
// dropped. A coin found this way under BACKFILL_FRESH_MS old goes in as a launch (New pairs, the nursery); an
// older one is kept in the coin index with its real creation time, so its page, search and later trading know it.
// pump.fun limits this list hard (429 on the second quick read from the VM), so pages are spaced and a 429 stops.
const PUMP_NEW = "https://frontend-api-v3.pump.fun/coins?limit=50&sort=created_timestamp&order=DESC&includeNsfw=true";
const BACKFILL_FRESH_MS = 5 * MIN, BACKFILL_PAGES = 8, BACKFILL_GAP_MS = 4000;
export const backfill = { reads: 0, added: 0, indexed: 0, last: 0, error: null, limited: 0 };
export async function backfillLaunches(pages = 1, until = 0) {
  for (let page = 0; page < pages; page++) {
    let list;
    try {
      const r = await fetch(`${PUMP_NEW}&offset=${page * 50}`, { headers: { origin: "https://pump.fun", referer: "https://pump.fun/", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) });
      if (r.status === 429) { backfill.limited++; backfill.error = "pump.fun rate limited"; return; }
      if (!r.ok) throw new Error(`pump.fun answered ${r.status}`);
      const j = await r.json();
      list = Array.isArray(j) ? j : j?.coins || [];
      backfill.reads++; backfill.last = now(); backfill.error = null;
    } catch (e) { backfill.error = e.message; return; }
    let unknown = 0;
    for (const c of list) {
      if (!c?.mint || launchIndex.has(c.mint) || coinIndex.get(c.mint)) continue;
      unknown++;
      const created = Number(c.created_timestamp) || now();
      if (now() - created < BACKFILL_FRESH_MS) {
        if (addLaunch({ mint: c.mint, symbol: c.symbol, name: c.name, uri: c.metadata_uri, creator: c.creator, pool: "pump", mcapSol: Number(c.market_cap) || null, devSol: null, source: "pump-backfill" })) backfill.added++;
      } else { coinIndex.note({ mint: c.mint, name: c.name, symbol: c.symbol, uri: c.metadata_uri, creator: c.creator, created }); backfill.indexed++; }
    }
    const oldest = Math.min(...list.map((c) => Number(c.created_timestamp) || Infinity));
    // Back far enough: past the last coin known before the restart, or a page with nothing new on it.
    if (!list.length || oldest <= until || (!until && !unknown)) return;
    await new Promise((go) => setTimeout(go, BACKFILL_GAP_MS));
  }
}

// Coins launched anywhere but pump.fun (Meteora DBC and DAMM, Bags, LaunchLab, memefun, a plain pool), from
// Jupiter's newest-tokens list: GeckoTerminal's first page every 90 s (discoverFeeds) caught about half of them
// (measured 2026-10-09: 5 of 10 Meteora DAMM v2 coins, one with 1,222 trades in its first hour, never seen).
// They wait in the nursery with the pump.fun launches and are kept only if they show real trading. pump.fun's own
// launches come from PumpPortal and the chain already.
export const recentFeed = { calls: 0, found: 0, nursed: 0, last: 0, error: null };
export async function scanRecent() {
  try {
    const list = await src.jupRecent();
    recentFeed.calls++; recentFeed.last = now(); recentFeed.error = null;
    for (const t of list) {
      if (t.launchpad === "pump.fun" || /pump$/.test(t.mint) && !t.launchpad) continue;
      recentFeed.found++;
      coinIndex.note({ mint: t.mint, name: t.name, symbol: t.symbol, creator: t.creator, created: t.poolAt || undefined });
      if (nursery.has(t.mint) || launchIndex.has(t.mint) || q.getToken.get(t.mint)) continue;
      if (nursery.size < 20000) { nursery.set(t.mint, { ...t, seen: now() }); recentFeed.nursed++; }
    }
  } catch (e) { recentFeed.error = e.message; }
}

// Every minute: check launches that are 4+ minutes old and keep only the ones with real trading.
async function graduateNursery() {
  const cutoff = now() - 4 * MIN;
  const ripe = [...nursery.values()].filter((t) => t.seen < cutoff);
  for (const t of ripe) nursery.delete(t.mint);
  // Drop anything that has waited too long without being checked.
  for (const [m, t] of nursery) if (t.seen < now() - 30 * MIN) nursery.delete(m);
  saveLaunches();
  const keepFrom = now() - 6 * 60 * MIN;
  while (launchLog.length && launchLog[0].t < keepFrom) {
    const l = launchLog.shift();
    if (l.creator) { const n = (devLaunches.get(l.creator) || 1) - 1; n > 0 ? devLaunches.set(l.creator, n) : devLaunches.delete(l.creator); }
  }
  stats.nursery = nursery.size;
  if (!ripe.length) return;
  const pairs = await src.dexTokens(ripe.map((t) => t.mint), { lane: "scan" });
  let kept = 0;
  for (const t of ripe) {
    const p = pairs.get(t.mint);
    if (!p) continue;
    const mcap = p.marketCap || p.fdv || 0, vol = p.volume?.m5 || 0;
    if (mcap >= settings.nurseryMinMcap || vol >= settings.nurseryMinVol5m) {
      if (adopt({ ...t, source: t.source === "jup-recent" ? "jup-recent" : "pump-live" })) { applyPair(t.mint, p); kept++; }
    }
  }
  if (kept) logEvent("discover", `${kept} of ${ripe.length} new launches showed real trading`);
}

async function discoverFeeds() {
  const jobs = [
    ["profiles", src.dexLatestProfiles],
    ["boosts", () => src.dexBoosts("latest")],
    ["top-boosts", () => src.dexBoosts("top")],
    ["gecko-trending", src.geckoTrending],
    ["gecko-new", src.geckoNew],
  ];
  for (const [name, fn] of jobs) {
    try {
      const list = await fn();
      for (const t of list) adopt(t);
    } catch (e) { stats.errors++; logEvent("error", `${name}: ${e.message}`); }
  }
}

// ---------- enrichment ----------
const pulled = new Set();   // coins whose pool was just emptied; dumpWatch turns these into warnings
// DexScreener can keep quoting a drained pool at its old price: XFUN's pool held 13.46 SOL against 644.8M
// tokens (about $2.5K market cap, $3.3K liquidity) while DexScreener said $823K and $540K. When the pool is
// quoted in SOL, its own reserves set the price, and liquidity is twice the SOL side.
function fromReserves(p) {
  const base = +p.liquidity?.base, quote = +p.liquidity?.quote, usd = +liveFeed.solUsd, px = +p.priceUsd;
  if (p.quoteToken?.symbol !== "SOL" || !(base > 0 && quote > 0 && usd > 0 && px > 0)) return p;
  const spot = (quote / base) * usd, liq = 2 * quote * usd;
  if (px / spot < 5 && spot / px < 5) return p;
  const k = spot / px;
  return { ...p, priceUsd: String(spot), marketCap: (p.marketCap || 0) * k, fdv: (p.fdv || 0) * k, liquidity: { ...p.liquidity, usd: Math.min(p.liquidity.usd || liq, liq) } };
}
// DexScreener gives SOL itself no market cap: its price times the circulating supply (RPC getSupply, hourly).
const WSOL = "So11111111111111111111111111111111111111112";
const solCirc = { n: 0, t: 0 };
function solSupply() {
  if (now() - solCirc.t > 60 * MIN) {
    solCirc.t = now();
    import("./solana.js").then((s) => s.rpc("getSupply", [{ excludeNonCirculatingAccountsList: true }])).then((r) => { if (r?.value?.circulating > 0) solCirc.n = r.value.circulating / 1e9; }).catch(() => {});
  }
  return solCirc.n;
}
export function applyPair(mint, p) {   // exported for test/migrated-column.test.mjs
  p = fromReserves(p);
  if (mint === WSOL && !(p.marketCap || p.fdv) && solSupply()) p = { ...p, marketCap: (+p.priceUsd || 0) * solSupply() };
  const links = cleanLinks([
    ...(p.info?.websites || []).map((w) => ({ type: "website", url: w.url })),
    ...(p.info?.socials || []).map((s) => ({ type: s.type, url: s.url })),
  ]);
  for (const l of links) if (/twitter|x\.com/i.test(`${l.type} ${l.url}`)) warmX(l.url);   // the X card, ahead of any hover (once per link)
  const t = q.getToken.get(mint);
  const mcap = p.marketCap || p.fdv || 0, liq = p.liquidity?.usd || 0;
  // DexScreener lists some curve coins with no price at all (FaukaqW…pump 2026-10-12: price 0, cap 0, while Jupiter
  // had it at $3K): a reading like that says nothing, and writing it set the coin's cap to $0 on every scan.
  if (!(mcap > 0) && !(+p.priceUsd > 0)) return;
  // A pump.fun graduate's pool (migrated_at: the migration itself was seen) holds locked liquidity from the curve,
  // tens of SOL that nobody can pull: a reading with under $2K of liquidity or no market cap is DexScreener not
  // having indexed the pool yet (it said $1 / $0.97 liquidity for 10-16 minutes on 2026-10-11, then $1,962, then
  // the market), not a crash. Dropped: the last real figure stands (the chain's own trades move it meanwhile), and
  // the coin is not quarantined out of Migrated over it. Read again on the next scan.
  // Only while the pool is new: past half an hour a reading like that is the market (the coin died), and keeping
  // the old figure left 83 of 152 Migrated rows at caps 10-400x the market for 5+ hours (2026-10-11).
  if (t?.migrated_at && now() - t.migrated_at < 30 * MIN && (liq < 2000 || mcap < 500)) {
    if (t.quarantine === "implausible market cap") db.prepare("UPDATE tokens SET quarantine = NULL WHERE mint = ?").run(mint);
    return;
  }
  // A reading from an emptied pool is kept for display (flagged) but never becomes a peak or a return.
  const cls = classifyAsset({ ...t, mint, symbol: p.baseToken?.symbol || t?.symbol, name: p.baseToken?.name || t?.name, mcap, liquidity: liq });
  const problem = readingProblem({ dex: p.dexId, liquidity: liq, mcap, asset: cls }, settings.minExitLiq);
  if (problem && !t?.quarantine) {
    stats.quarantined++;
    if (t && !CURVE_DEX.has(t.dex) && (t.liquidity || 0) >= 5 * settings.minExitLiq && liq < settings.minExitLiq) pulled.add(mint);
  }
  db.prepare(`UPDATE tokens SET
    symbol = COALESCE(?, symbol), name = COALESCE(?, name), image = COALESCE(image, ?), header = COALESCE(?, header),
    pair = ?, dex = ?, pair_created = CASE WHEN migrated_at IS NOT NULL THEN pair_created ELSE ? END, price = ?, mcap = ?, liquidity = ?,
    vol_m5 = ?, vol_h1 = ?, vol_h24 = ?, buys_m5 = ?, sells_m5 = ?, buys_h1 = ?, sells_h1 = ?,
    chg_m5 = ?, chg_h1 = ?, chg_h24 = ?, links = ?, updated = ?, peak_mcap = MAX(COALESCE(peak_mcap, 0), ?),
    graduated = CASE WHEN ? THEN 1 ELSE graduated END,
    quarantine = ?, asset_class = ?, price_t = ?, price_src = 'dexscreener'
    WHERE mint = ?`).run(
    p.baseToken?.symbol || null, p.baseToken?.name || null, safeUrl(p.info?.imageUrl), safeUrl(p.info?.header),
    p.pairAddress, p.dexId, p.pairCreatedAt || null, +p.priceUsd || 0, mcap, liq,
    p.volume?.m5 || 0, p.volume?.h1 || 0, p.volume?.h24 || 0,
    p.txns?.m5?.buys || 0, p.txns?.m5?.sells || 0, p.txns?.h1?.buys || 0, p.txns?.h1?.sells || 0,
    p.priceChange?.m5 ?? 0, p.priceChange?.h1 ?? 0, p.priceChange?.h24 ?? 0,
    JSON.stringify(links.length ? links : cleanLinks(json(t?.links, []))), now(), problem ? 0 : mcap,
    p.dexId === "pumpswap" ? 1 : 0, problem, cls, now(), mint);
  q.snapshot.run(mint, now(), +p.priceUsd || 0, mcap, liq, p.volume?.m5 || 0, problem ? 0 : 1);
}

// Coins someone has on screen (Discover) are re-read from DexScreener when their reading is over 15 s old:
// at most 30 a call and one call every 10 s, so a bonded coin's row is never minutes behind the market.
let visibleT = 0;
export async function refreshVisible(mints) {
  if (now() - visibleT < 10_000) return;
  const due = mints.filter((m) => { const t = q.getToken.get(m); return t && now() - (t.updated || 0) > 15_000; }).slice(0, 30);
  if (!due.length) return;
  visibleT = now();
  const pairs = await src.dexTokens(due);
  for (const m of due) {
    const p = pairs.get(m);
    if (!p) continue;
    applyPair(m, p);
    if ((p.volume?.h1 || 0) >= 1000) db.prepare("UPDATE tokens SET status = 'active' WHERE mint = ? AND status = 'dead'").run(m);
  }
}

// Many single-row writes, 50 to a transaction (one WAL commit instead of 50), yielding between batches so
// a 900-coin cycle never holds the feeds up. Inside someone else's transaction it just runs.
async function batched(items, fn) {
  for (let i = 0; i < items.length; i += 50) {
    const own = !db.isTransaction;
    if (own) db.exec("BEGIN");
    try { for (const x of items.slice(i, i + 50)) fn(x); if (own) db.exec("COMMIT"); }
    catch (e) { if (own && db.isTransaction) db.exec("ROLLBACK"); throw e; }
    await new Promise((go) => setImmediate(go));
  }
}

async function refreshActive() {
  const rows = q.activeMints.all();
  stats.tracked = rows.length;
  if (!rows.length) return;
  // Hot tokens every cycle, the rest every few cycles.
  const cyc = Math.floor(now() / (30 * 1000));
  const due = rows.filter((r) => r.score >= 50 || r.updated === 0 || cyc % 4 === 0 || now() - r.updated > 3 * MIN).map((r) => r.mint);
  // Coins that died while one of our alerts is still being scored keep getting priced, so the track
  // record reflects what really happened to them instead of freezing at their last good price.
  const scoring = cyc % 4 !== 0 ? [] : db.prepare(`SELECT DISTINCT t.mint FROM tokens t JOIN signals s ON s.mint = t.mint
    WHERE t.status = 'dead' AND s.hidden = 0 AND s.p24h IS NULL AND s.t > ? LIMIT 300`).all(now() - 25 * 60 * MIN).map((r) => r.mint);
  const pairs = await src.dexTokens([...due, ...scoring], { lane: "scan" });
  await batched([...due, ...scoring], (m) => {
    const p = pairs.get(m);
    if (p) applyPair(m, p);
    else if (!pairs.failed?.has(m)) {
      const t = q.getToken.get(m);
      if (t && now() - t.first_seen > 20 * MIN && !t.pair) db.prepare("UPDATE tokens SET status = 'dead', updated = ? WHERE mint = ?").run(now(), m);
      // It had a market and DexScreener no longer lists one: nothing left to sell into.
      else if (t?.pair && !t.quarantine && now() - (t.price_t || t.updated || 0) > 30 * MIN) db.prepare("UPDATE tokens SET quarantine = 'no longer listed on any DEX' WHERE mint = ?").run(m);
    }
  });
  await batched(due, (m) => { const t = q.getToken.get(m); if (t?.pair) rescore(t); });
  cull();
}

// Retire tokens that are clearly finished, and cap the watch list.
// Still trading on the curve right now (20+ trades in the last 10 minutes on the live feed): a coin like that
// is never retired on old DexScreener figures, and a retired one comes back (Narratives showed $Trojan, 852
// buyers and $122K of volume in the hour, as dead).
const busyNow = (mint) => { const w = windowStats(mint, now() / 1000 - 600); return Boolean(w && w.buys + w.sells >= 20); };
const isDead = db.prepare("SELECT 1 FROM tokens WHERE mint = ? AND status = 'dead'");
const revive = db.prepare("UPDATE tokens SET status = 'active', updated = 0 WHERE mint = ?");
function reviveBusy() {
  for (const [mint, c] of liveCurves) {
    if (now() - (c.last || 0) > 10 * MIN || c.buys + c.sells < 20 || !isDead.get(mint) || !busyNow(mint)) continue;
    revive.run(mint); stats.revived = (stats.revived || 0) + 1;
  }
}
export function cull() {   // exported for test/migrated-column.test.mjs
  reviveBusy();
  const age = (t) => now() - t.first_seen;
  // SOL, stablecoins, wrapped BTC and other big non-memes score 0 (only memes are scored) but are never retired.
  // A coin bonded in the last 30 minutes is kept whatever its figures say: its pool's volume is not read yet, and
  // it is the youngest row of Migrated (an hours-old curve coin that just bonded read as "3 h old, no volume").
  const justBonded = (t) => t.graduated && now() - (t.migrated_at || t.pair_created || t.first_seen) < 30 * MIN;
  const keep = (t) => MAJOR_MINTS.has(t.mint) || justBonded(t) || (t.asset_class && t.asset_class !== "meme" && (t.mcap || 0) >= 5e7);
  const rows = db.prepare("SELECT mint, first_seen, mcap, liquidity, vol_h1, score, asset_class, graduated, migrated_at, pair_created FROM tokens WHERE status = 'active'").all();
  const dead = rows.filter((t) => !busyNow(t.mint) && !keep(t) && (
    (age(t) > 45 * MIN && (t.mcap || 0) < 6000) ||
    (age(t) > 3 * 60 * MIN && (t.vol_h1 || 0) < 500) ||
    (age(t) > 36 * 60 * MIN && (t.score || 0) < 40)));
  const kill = db.prepare("UPDATE tokens SET status = 'dead', updated = ? WHERE mint = ?");
  for (const t of dead) kill.run(now(), t.mint);
  const alive = rows.length - dead.length;
  if (alive > settings.maxTracked) {
    // Over the cap, the least traded go first (a hot coin with a low score must not drop off Discover).
    // Never a coin that just bonded (its hour of volume is not read yet: it is the least traded on paper) nor one
    // minutes old: those are the board's youngest rows, and the cull emptied Migrated of them (2026-10-11).
    const extra = db.prepare(`SELECT mint FROM tokens WHERE status = 'active' AND NOT (mint IN (${[...MAJOR_MINTS].map((m) => `'${m}'`).join(",")}) OR (COALESCE(asset_class, 'meme') != 'meme' AND mcap >= 5e7))
      AND first_seen < ? AND NOT (graduated = 1 AND COALESCE(migrated_at, pair_created, first_seen) > ?)
      ORDER BY COALESCE(vol_h1, 0) + 12 * COALESCE(vol_m5, 0) ASC, score ASC, first_seen ASC LIMIT ?`).all(now() - 10 * MIN, now() - 30 * MIN, alive - settings.maxTracked);
    for (const t of extra) kill.run(now(), t.mint);
  }
}

// ---------- safety ----------
const safetyQueue = new Set();
// Coins on someone's screen right now (Discover, Pulse): a never-checked one is read next, however small it is,
// so its audit pills do not sit on dashes until it happens to grow. Asked by server.js with the mints shown.
const visibleSafety = new Map();   // mint -> last shown
// A coin still owed a report: never checked, or checked while RugCheck did not know it yet (it answers "not found"
// for a coin's first minute or so, and that answer used to stand for good): asked again 40 s later.
const owesSafety = (row) => !row.safety_checked || (row.safety_score == null && now() - row.safety_checked > 40_000);
export function wantSafety(mints) {
  const t = now();
  for (const m of mints) visibleSafety.set(m, t);
  if (visibleSafety.size > 400) for (const [m, at] of visibleSafety) if (t - at > 60_000) visibleSafety.delete(m);
}
// Between scan cycles (30 s apart), one on-screen never-checked coin every 3 s: RugCheck allows 40 a minute
// (sources.js) and the cycle uses about half, so a coin shown on Discover gets its report in seconds.
let visibleBusy = false;
setInterval(async () => {
  if (visibleBusy || !visibleSafety.size) return;
  const t = now();
  let pick = null;
  for (const [m, at] of visibleSafety) {
    if (t - at > 60_000) { visibleSafety.delete(m); continue; }
    const row = q.getToken.get(m);
    if (!row) { visibleSafety.delete(m); continue; }
    if (!owesSafety(row)) continue;
    pick = m; break;
  }
  if (!pick) return;
  visibleBusy = true;
  try { await safetyCheck(pick); }
  catch (e) { if (e.status !== 429) db.prepare("UPDATE tokens SET safety_checked = ? WHERE mint = ?").run(now(), pick); }
  finally { visibleBusy = false; }
}, 2000).unref?.();
async function runSafety() {
  {
    const t = now();
    let n = 0;
    for (const [m, at] of visibleSafety) {
      if (t - at > 60_000) { visibleSafety.delete(m); continue; }
      const row = q.getToken.get(m);
      if (!row) { visibleSafety.delete(m); continue; }
      if (!owesSafety(row)) continue;
      if (n++ < 6) safetyQueue.add(m);
    }
  }
  // Never-checked coins first: a busy coin with no report at all shows blank audit figures everywhere, while
  // re-reading the top scorers every 12 minutes could otherwise take every slot. Busy means real trading,
  // whatever its score (a coin trending on Discover can score under 50).
  const unseen = db.prepare(`SELECT mint FROM tokens WHERE status = 'active' AND safety_checked IS NULL AND pair IS NOT NULL AND (score >= 50 OR COALESCE(vol_h1, 0) >= 10000 OR COALESCE(liquidity, 0) >= 5000) ORDER BY COALESCE(vol_h1, 0) DESC LIMIT 8`).all();
  for (const r of unseen) safetyQueue.add(r.mint);
  const stale = db.prepare(`SELECT mint FROM tokens WHERE status = 'active' AND score >= 50 AND (safety_checked IS NULL OR safety_checked < ?) ORDER BY safety_checked IS NOT NULL, score DESC LIMIT 10`).all(now() - 12 * MIN);
  for (const r of stale) safetyQueue.add(r.mint);
  // A report taken in a coin's first minutes in its pool goes out of date fast (the dev of an airdrop launch
  // holds most of the supply, then hands it out): every bonded coin is read again about 3 and about 15
  // minutes after its pool appeared, whatever its score.
  const t0 = "COALESCE(pair_created, first_seen)", at = now();
  const bonded = db.prepare(`SELECT mint FROM tokens WHERE status = 'active' AND graduated = 1 AND ${t0} > ? AND (safety_checked IS NULL
      OR (? >= ${t0} + ${3 * MIN} AND safety_checked < ${t0} + ${3 * MIN}) OR (? >= ${t0} + ${15 * MIN} AND safety_checked < ${t0} + ${15 * MIN}))
    ORDER BY ${t0} DESC LIMIT 6`).all(at - 45 * MIN, at, at);
  for (const r of bonded) safetyQueue.add(r.mint);
  const batch = [...safetyQueue].slice(0, 12);
  for (const mint of batch) {
    safetyQueue.delete(mint);
    try { await safetyCheck(mint); }
    catch (e) {
      if (e.status === 429) { safetyQueue.add(mint); break; }
      db.prepare("UPDATE tokens SET safety_checked = ? WHERE mint = ?").run(now(), mint);
    }
  }
}

async function safetyCheck(mint) {
  const before = q.getToken.get(mint);
  if (!before) return;
  const prev = json(before.safety);
  const s = await src.rugcheck(mint);
  // A bonded coin RugCheck has not indexed yet has no score: an empty report used to read as nearly clean
  // and pass the safety line. (Coins still on the curve keep theirs: the curve itself is the market.)
  const score = s.unindexed && before.graduated ? null : s.clean;
  db.prepare("UPDATE tokens SET safety = ?, safety_score = ?, safety_checked = ?, creator = COALESCE(creator, ?) WHERE mint = ?").run(JSON.stringify(s), score, now(), s.creator, mint);
  const t = q.getToken.get(mint);
  const watched = (t.score || 0) >= 45 || q.lastSignal.get(mint, "launch") || q.lastSignal.get(mint, "momentum") || q.lastSignal.get(mint, "smart");
  if (watched && prev && prev.devPct >= 1 && s.devPct < 0.2 && cooldownOk(mint, "dev-sold", 1e12))
    raise(t, "dev-sold", `Dev sold $${t.symbol}`, `The creator held ${prev.devPct.toFixed(1)}% and now holds ${s.devPct.toFixed(2)}%. Mcap ${fmt$(t.mcap)}.`);
  if (watched && s.rugged && !prev?.rugged && cooldownOk(mint, "rugged", 1e12))
    raise(t, "rugged", `RugCheck flags $${t.symbol} as rugged`, `RugCheck marks this coin as rugged. Mcap ${fmt$(t.mcap)}, liquidity ${fmt$(t.liquidity)}.`);
}

// ---------- scoring ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

export function scoreToken(t) {
  const liq = clamp(Math.log10(Math.max(t.liquidity || 0, 1)) / 5.5);           // ~$300k = 1
  const mcap = clamp(Math.log10(Math.max(t.mcap || 0, 1)) / 6.5);               // ~$3M = 1
  const buys = (t.buys_m5 || 0) + (t.sells_m5 || 0);
  const pressure = buys ? (t.buys_m5 || 0) / buys : 0.5;                         // share of buys
  const accel = clamp(((t.vol_m5 || 0) * 12) / Math.max(t.vol_h1 || 0, 1) / 3); // 5m pace vs hour
  const activity = clamp(Math.log10(Math.max(t.vol_h1 || 0, 1)) / 5.5);          // ~$300k/h = 1
  const trend = clamp(((t.chg_h1 || 0) + 20) / 120);                              // -20%..+100%
  const links = json(t.links, []);
  const social = clamp((links.some((l) => /twitter|x\.com/.test(l.type + l.url)) ? .5 : 0) + (links.some((l) => l.type === "website") ? .3 : 0) + (links.some((l) => l.type === "telegram") ? .2 : 0));
  const boost = clamp((t.boosts || 0) / 100);
  let s = 100 * (0.22 * activity + 0.16 * pressure + 0.14 * accel + 0.12 * trend + 0.12 * liq + 0.08 * mcap + 0.1 * social + 0.06 * boost);
  const safe = t.safety_score == null ? 0.8 : 0.35 + 0.65 * (t.safety_score / 100);
  s *= safe;
  if ((t.liquidity || 0) < 3000 && t.graduated) s *= 0.5;
  return Math.round(clamp(s, 0, 100));
}

// The one safety policy every actionable signal goes through (RugCheck, liquidity, data quality, dev history).
export const verdict = (t) => safetyVerdict(t, { minSafety: settings.minSafety, minExitLiq: settings.minExitLiq, devCount: t?.creator ? devLaunches.get(t.creator) || 0 : 0 });
const isSafe = (t) => verdict(t).ok;

// Price and safety-check a coin right now, then judge it. Used before alerting on a coin we just heard about.
export async function vet(mint) {
  let t = q.getToken.get(mint);
  if (!t?.pair || now() - (t.price_t || 0) > 2 * MIN) await enrichNow(mint).catch(() => {});
  t = q.getToken.get(mint);
  if (t && (!t.safety_checked || now() - t.safety_checked > 12 * MIN)) {
    await safetyCheck(mint).catch(() => {});
    safetyQueue.delete(mint);
  }
  t = q.getToken.get(mint);
  return { token: t, ...verdict(t) };
}

function cooldownOk(mint, kind, ms) {
  const last = q.lastSignal.get(mint, kind);
  return !last || now() - last.t > ms;
}

// safe: false marks an alert the coin did not earn through the safety policy (raw wallet activity).
// It is stored and shown as unscreened, never as an approved opportunity, and is not pushed by default.
export function raise(t, kind, title, detail, hidden = 0, { safe = true, why = null } = {}) {
  const tok = q.getToken.get(t.mint);
  q.addSignal.run(t.mint, kind, now(), title, detail, t.score, t.price, t.mcap, safe ? 1 : 0, safe ? null : why, tok?.liquidity ?? null);
  const sig = db.prepare("SELECT * FROM signals WHERE id = last_insert_rowid()").get();
  if (hidden) { db.prepare("UPDATE signals SET hidden = 1 WHERE id = ?").run(sig.id); return; }
  stats.signals++;
  bus.emit("signal", { ...sig, token: tok });
}

const fmt$ = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n || 0)}`;
const MILESTONES = [10e6, 5e6, 1e6, 500e3, 100e3];

function rescore(t) {
  // Stablecoins, wrapped assets and tokenized stocks are not memecoins: no score, no themes, no signals.
  const meme = (t.asset_class || "meme") === "meme";
  const score = meme && !t.quarantine ? scoreToken(t) : 0;
  const themes = json(t.themes_user, null) || (meme ? themesFor(t) : []);
  const themesJson = JSON.stringify(themes);
  if (score !== t.score || themesJson !== t.themes) db.prepare("UPDATE tokens SET score = ?, themes = ? WHERE mint = ?").run(score, themesJson, t.mint);   // unchanged: no write
  if (!meme) return;
  t = { ...t, score };
  const safe = isSafe(t);
  const H = 60 * MIN;
  const age = now() - (t.pair_created || t.first_seen);
  const buyShare = (t.buys_h1 || 0) / Math.max((t.buys_h1 || 0) + (t.sells_h1 || 0), 1);
  const found = []; // [kind, title, detail] in priority order

  if (pendingGraduations.has(t.mint) && t.safety_checked) {
    pendingGraduations.delete(t.mint);
    // Dozens of coins graduate every hour; only the ones with real demand behind them are worth an alert.
    if (safe && score >= 50 && (t.vol_h1 || 0) >= 30000 && buyShare > 0.5) found.push(["graduated", `$${t.symbol} graduated from pump.fun`, `Bonding curve completed at ${fmt$(t.mcap)} mcap. Liquidity ${fmt$(t.liquidity)}.`]);
  }
  if (!safe && !found.length) return;

  if (age < 2 * H && score >= settings.launchScore && (t.mcap || 0) >= 35000 && (t.vol_h1 || 0) >= 40000 && buyShare > 0.52 && cooldownOk(t.mint, "launch", 24 * H))
    found.push(["launch", `New launch: $${t.symbol} is taking off`, `${fmt$(t.mcap)} mcap, ${fmt$(t.vol_h1)} volume in the last hour, ${t.buys_h1} buys vs ${t.sells_h1} sells.`]);

  // A coin under ~15 minutes old has no hourly baseline (its 5m volume IS its hourly volume), so skip it.
  if (age >= 15 * MIN && (t.mcap || 0) >= 30000 && (t.vol_m5 || 0) >= settings.spikeMinVol && (t.vol_m5 * 12) > 3 * Math.max(t.vol_h1 || 0, 1) && (t.chg_m5 || 0) > 0 && cooldownOk(t.mint, "volume", H))
    found.push(["volume", `Volume spike on $${t.symbol}`, `${fmt$(t.vol_m5)} traded in 5 minutes, about ${((t.vol_m5 * 12) / Math.max(t.vol_h1, 1)).toFixed(1)}x its hourly pace, price ${t.chg_m5 >= 0 ? "+" : ""}${Math.round(t.chg_m5)}%.`]);

  if (score >= settings.momentumScore && (t.chg_h1 || 0) >= 10 && cooldownOk(t.mint, "momentum", 3 * H))
    found.push(["momentum", `$${t.symbol} scores ${score}/100`, `+${Math.round(t.chg_h1)}% in 1h at ${fmt$(t.mcap)}. ${Math.round(100 * t.buys_m5 / Math.max(t.buys_m5 + t.sells_m5, 1))}% of recent trades are buys.`]);

  // Milestones only when we actually watched the coin cross: it was below the line within the last 6h.
  const top = MILESTONES.find((m) => (t.mcap || 0) >= m);
  if (top && cooldownOk(t.mint, `mcap-${top}`, 1e12)) {
    const low = db.prepare("SELECT MIN(mcap) m FROM snapshots WHERE mint = ? AND t > ?").get(t.mint, now() - 6 * H).m;
    if (low != null && low < top * 0.97) found.push([`mcap-${top}`, `$${t.symbol} crossed ${fmt$(top)} market cap`, `Now ${fmt$(t.mcap)}, up from ${fmt$(low)}. Liquidity ${fmt$(t.liquidity)}.`]);
    else raise(t, `mcap-${top}`, "", "", 1); // already above when found: remember it silently
  }

  if (!found.length) return;
  // One alert per coin per scan, and at most one every 20 minutes per coin (graduations excepted).
  const recent = db.prepare(`SELECT 1 FROM signals WHERE mint = ? AND hidden = 0 AND t > ?
    AND kind NOT IN ('dump', 'dev-sold', 'rugged', 'liq-pulled', 'smart') AND kind NOT LIKE 'wallet:%'`).get(t.mint, now() - 20 * MIN);
  if (recent && found[0][0] !== "graduated") {
    for (const r of found) raise(t, r[0], r[1], r[2], 1); // remember them so they don't fire right after
    return;
  }
  const [lead, ...rest] = found;
  raise(t, lead[0], lead[1], [lead[2], ...rest.map((r) => r[1] + ".")].join(" "));
  for (const r of rest) raise(t, r[0], r[1], r[2], 1);
}

const WARNINGS = "'dump', 'dev-sold', 'rugged', 'liq-pulled'";
// Warn about coins we signalled that then dumped hard. A price drop and a pulled pool are different
// things: the first is a dump, the second means holders cannot sell at all.
function dumpWatch() {
  const rows = db.prepare(`SELECT DISTINCT t.* FROM tokens t JOIN signals s ON s.mint = t.mint
    WHERE s.t > ? AND s.hidden = 0 AND s.kind NOT IN (${WARNINGS}) AND t.quarantine IS NULL AND t.peak_mcap >= 40000 AND t.mcap < t.peak_mcap * 0.4`).all(now() - 24 * 60 * MIN);
  for (const t of rows) if (cooldownOk(t.mint, "dump", 12 * 60 * MIN))
    raise(t, "dump", `Warning: $${t.symbol} is down ${Math.round(100 - 100 * t.mcap / t.peak_mcap)}% from its peak`, `Peak ${fmt$(t.peak_mcap)}, now ${fmt$(t.mcap)}. Liquidity ${fmt$(t.liquidity)}.`);
  for (const mint of pulled) {
    pulled.delete(mint);
    const t = q.getToken.get(mint);
    const called = t && db.prepare(`SELECT 1 FROM signals WHERE mint = ? AND hidden = 0 AND t > ? AND kind NOT IN (${WARNINGS})`).get(mint, now() - 24 * 60 * MIN);
    if (called && cooldownOk(mint, "liq-pulled", 1e12))
      raise(t, "liq-pulled", `Liquidity pulled from $${t.symbol}`, `The pool now holds ${fmt$(t.liquidity)}. Holders cannot sell at the quoted price; treat any price shown as meaningless.`);
  }
}

// ---------- outcomes ----------
// Price multiples at 15m / 1h / 6h / 24h after each alert. A checkpoint taken while the coin cannot be
// sold (emptied pool, delisted) is recorded as 0 and flagged, and never counts toward the peak.
function trackOutcomes() {
  const open = q.openSignals.all(now() - 25 * 60 * MIN);
  const upd = db.prepare(`UPDATE signals SET p15 = COALESCE(p15, ?), p1h = COALESCE(p1h, ?), p6h = COALESCE(p6h, ?), p24h = COALESCE(p24h, ?),
    peak = CASE WHEN ? IS NULL THEN peak ELSE MAX(COALESCE(peak, 0), ?) END, illiq = MAX(COALESCE(illiq, 0), ?) WHERE id = ?`);
  for (const s of open) {
    if (!s.price || /^(dump|dev-sold|rugged|liq-pulled)$/.test(s.kind)) continue;
    const t = q.getToken.get(s.mint);
    if (!t) continue;
    const exit = exitState(t, settings.minExitLiq);
    // No fresh reading (DexScreener outage, or a coin we stopped pricing): leave the checkpoint empty rather than guess.
    if (exit.ok && now() - (t.price_t || t.updated || 0) > 20 * MIN) continue;
    const x = exit.ok ? t.price / s.price : 0;
    const age = now() - s.t;
    const at = (ms, cur) => (cur == null && age >= ms ? x : null);
    const wrote = [at(15 * MIN, s.p15), at(60 * MIN, s.p1h), at(6 * 60 * MIN, s.p6h), at(24 * 60 * MIN, s.p24h)];
    // Nothing new (no checkpoint due, no new peak, already flagged or not): no write. Rewriting every open signal
    // each cycle was one of the radar's busiest writers.
    if (wrote.every((v) => v == null) && !(exit.ok && x > (s.peak || 0))) continue;
    upd.run(...wrote, exit.ok ? x : null, x, !exit.ok && wrote.some((v) => v != null) ? 1 : 0, s.id);
  }
}

// ---------- repair ----------
// Rebuild recent outcomes, each coin's peak and the "winner" list from stored snapshots, ignoring every
// reading taken from an emptied pool. Runs once after an upgrade; safe to run again.
export function rebuildFromSnapshots() {
  const floor = settings.minExitLiq, DAY = 24 * 60 * MIN;
  const toks = new Map(db.prepare("SELECT * FROM tokens").all().map((t) => [t.mint, t]));
  const by = new Map();
  for (const s of db.prepare("SELECT rowid, mint, t, price, mcap, liquidity, ok FROM snapshots ORDER BY mint, t").iterate()) {
    let list = by.get(s.mint);
    if (!list) by.set(s.mint, (list = []));
    list.push(s);
  }
  const trusted = new Map();   // mint -> { first, peak } from believable readings only
  const setPeak = db.prepare("UPDATE tokens SET peak_mcap = ? WHERE mint = ?");
  const flag = db.prepare("UPDATE snapshots SET ok = 0 WHERE rowid = ?");
  db.exec("BEGIN");
  for (const [mint, list] of by) {
    const tok = toks.get(mint);
    const curveBorn = /(pump|bonk|bags)$/i.test(mint) || CURVE_DEX.has(tok?.dex) || /^pump/.test(tok?.source || "");
    let pooled = false, first = null, peak = 0;
    for (const s of list) {
      if ((s.liquidity || 0) >= floor) pooled = true;
      // Older rows have no flag: before a pool existed a curve coin is tradable; after it, zero liquidity is not.
      if (s.ok == null) {
        s.ok = (s.liquidity || 0) >= floor ? (readingProblem({ dex: "amm", liquidity: s.liquidity, mcap: s.mcap }, floor) ? 0 : 1) : curveBorn && !pooled && s.mcap < 2e11 ? 1 : 0;
        if (!s.ok) flag.run(s.rowid);   // remembered, so charts and later checks skip it too
      }
      if (s.ok && s.mcap > 0) { first ??= s.mcap; peak = Math.max(peak, s.mcap); }
    }
    trusted.set(mint, { first, peak });
    if (tok && (tok.peak_mcap || 0) > peak * 1.02) setPeak.run(peak || null, mint);
  }
  // Current state: classify every coin, flag unreliable prices, and drop peaks that no snapshot backs up.
  const fix = db.prepare("UPDATE tokens SET asset_class = ?, quarantine = ?, links = ?, image = ?, peak_mcap = CASE WHEN ? THEN NULL ELSE peak_mcap END WHERE mint = ?");
  for (const t of toks.values()) {
    const cls = classifyAsset(t), problem = t.pair ? readingProblem({ ...t, asset: cls }, floor) : null;
    fix.run(cls, problem || (t.quarantine?.startsWith("no longer") ? t.quarantine : null), JSON.stringify(cleanLinks(json(t.links, []))), safeUrl(t.image),
      problem && !trusted.get(t.mint)?.peak ? 1 : 0, t.mint);
  }
  // Signal outcomes.
  const upd = db.prepare("UPDATE signals SET p15 = ?, p1h = ?, p6h = ?, p24h = ?, peak = ?, illiq = ? WHERE id = ?");
  let fixed = 0;
  for (const s of db.prepare("SELECT * FROM signals WHERE price > 0 AND t > ?").all(now() - 3 * DAY + 60 * MIN)) {
    const list = (by.get(s.mint) || []).filter((x) => x.t >= s.t - MIN);
    if (!list.length) continue;
    let peak = null, illiq = 0;
    for (const x of list) if (x.ok && x.t <= s.t + DAY && x.price > 0) peak = Math.max(peak ?? 0, x.price / s.price);
    const at = (ms) => {
      if (now() < s.t + ms) return null;
      let last = null;
      for (const x of list) { if (x.t > s.t + ms + 15 * MIN) break; last = x; }
      if (!last) return null;
      if (!last.ok) { illiq = 1; return 0; }
      return last.price / s.price;
    };
    const v = [at(15 * MIN), at(60 * MIN), at(6 * 60 * MIN), at(DAY)];
    if (v.some((x, i) => x !== [s.p15, s.p1h, s.p6h, s.p24h][i]) || peak !== s.peak) fixed++;
    upd.run(...v, peak, illiq, s.id);
  }
  // Alerts that never went through the safety policy (wallet buys, crowd buys, research grades): the ones
  // whose coin fails the RugCheck part of it today are re-filed as unscreened activity, with the reason.
  const refile = db.prepare("UPDATE signals SET safe = 0, why_unsafe = ? WHERE id = ?");
  for (const s of db.prepare("SELECT id, mint FROM signals WHERE hidden = 0 AND COALESCE(safe, 1) = 1 AND (kind LIKE 'wallet:%' OR kind IN ('smart', 'fomo', 'research'))").all()) {
    const t = toks.get(s.mint), sf = json(t?.safety);
    const why = !t ? "unknown coin" : !sf ? "safety was never checked" : sf.rugged ? "RugCheck marks it as rugged" : sf.danger > 0 ? `${sf.danger} danger risk${sf.danger > 1 ? "s" : ""}`
      : (t.safety_score ?? 0) < settings.minSafety ? `safety ${t.safety_score ?? 0}/100, below your minimum of ${settings.minSafety}` : null;
    if (why) refile.run(`${why} (found when the record was re-checked)`, s.id);
  }
  db.exec("COMMIT");
  const dropped = revalidateWinners(trusted);
  logEvent("system", `Data repair: re-scored ${fixed} alerts from trusted prices only; removed ${dropped.winners} false winners and paused ${dropped.paused} wallets that were followed because of them`);
  return { fixed, ...dropped };
}

// ---------- loop ----------
let running = false;
// Which stage the running cycle is in and since when (the health page shows it); a cycle stuck in one stage for
// 10 minutes is abandoned so the next one can run (stats.stuck counts them), rather than prices going stale for good.
const STAGE_MAX = 10 * MIN;
async function cycle() {
  if (running) {
    if (now() - (stats.stageAt || now()) < STAGE_MAX) return;
    stats.stuck = (stats.stuck || 0) + 1;
    logEvent("error", `scan cycle stuck in ${stats.stage} for ${Math.round((now() - stats.stageAt) / MIN)} min; abandoned, a new one starts`);
  }
  running = true;
  const stage = (name) => { stats.stage = name; stats.stageAt = now(); };
  try {
    stage("nursery"); await graduateNursery();
    stage("refresh"); await refreshActive();
    stage("safety"); await runSafety();
    stage("scoring");
    for (const mint of pendingGraduations) { const t = q.getToken.get(mint); if (t?.pair) rescore(t); }
    dumpWatch();
    trackOutcomes();
    stats.lastCycle = now();
    health.ok("scan");
    const gap = health.heartbeat();
    if (gap && gap.to > stats.lastGap) { stats.lastGap = gap.to; logEvent("system", `Radar was paused for ${Math.round((gap.to - gap.from) / MIN)} minutes (PC asleep or radar stopped). Alerts and checkpoints in that window were missed.`); }
    bus.emit("tick", stats);
  } catch (e) {
    stats.errors++;
    health.fail("scan", e);
    logEvent("error", e.message);
  } finally {
    running = false;
    stats.stage = null;
  }
}

// Fetch a coin's market data right away (used before alerting on a coin we just heard about).
export async function enrichNow(mint) {
  const p = (await src.dexTokens([mint])).get(mint);
  if (p) { applyPair(mint, p); safetyQueue.add(mint); }
}

// A brand-new launch the triage escalated: track it now instead of waiting for the 4-minute check.
export function adoptLaunch(l) {
  adopt({ mint: l.mint, symbol: l.symbol, name: l.name, uri: l.uri, creator: l.creator, devSol: l.devSol, source: "pump-triage" });
  return enrichNow(l.mint).catch(() => {});
}
// Coins Jupiter lists as the most traded right now (jupdisc.js): added if new, brought back if retired.
export function adoptFound(list, source = "jupiter") {
  for (const t of list) if (t?.mint) adopt({ mint: t.mint, symbol: t.symbol, name: t.name, image: t.image, source });
}
// Any coin someone opens by address (SOL, cbBTC, a stablecoin, a coin the feeds never heard of): tracked from
// then on when DexScreener lists a market for it. A miss is remembered for 5 minutes so a bad link costs one call.
const lookedUp = new Map();   // mint -> time of a miss
export async function lookupMint(mint) {
  const had = q.getToken.get(mint);
  // A major retired before it was exempt (USDC was), or priced before its supply was known (SOL): live again, re-read.
  if (had && MAJOR_MINTS.has(mint) && (had.status !== "active" || had.quarantine || !(had.mcap > 0))) {
    db.prepare("UPDATE tokens SET status = 'active' WHERE mint = ?").run(mint);
    await enrichNow(mint).catch(() => {});
  }
  if (had) return true;
  if (now() - (lookedUp.get(mint) || 0) < 5 * MIN) return false;
  const p = (await src.dexTokens([mint]).catch(() => new Map())).get(mint);
  if (!p) { lookedUp.set(mint, now()); if (lookedUp.size > 2000) lookedUp.clear(); return false; }
  adopt({ mint, symbol: p.baseToken?.symbol, name: p.baseToken?.name, image: p.info?.imageUrl, source: "lookup" });
  applyPair(mint, p);
  safetyQueue.add(mint);
  return true;
}
export function adoptMint(mint) {
  if (q.getToken.get(mint)) return;
  adopt({ mint, source: "wallet" });
}

export function start() {
  stats.lastGap = 0;
  if (meta.get("repair") !== "2") {
    try { rebuildFromSnapshots(); meta.set("repair", "2"); } catch (e) { try { db.exec("ROLLBACK"); } catch {} logEvent("error", `data repair: ${e.message}`); }
  }
  // The nursery lives in memory: a restart (every deploy) used to forget the launches of the last few minutes before
  // they were checked, so a coin that took off right then was never tracked. The coin index kept them: they wait again.
  for (const c of db.prepare("SELECT mint, name, symbol, creator, created FROM coins WHERE created > ?").all(now() - 25 * MIN))
    if (!nursery.has(c.mint) && !q.getToken.get(c.mint)) nursery.set(c.mint, { mint: c.mint, name: c.name, symbol: c.symbol, creator: c.creator, source: "restart", seen: c.created });
  const pump = startPump();
  fillLaunchGaps();
  if (settings.marketFeeds !== false) { try { startFastCreate(); } catch {} }
  startCoverage();
  const stopWallets = startWallets((ev) => {
    bus.emit("walletTrade", ev);
    walletSignals(ev, raise, adoptMint, vet).catch((e) => logEvent("error", `wallet signal: ${e.message}`));
  });
  discoverFeeds().then(cycle);
  // The launches made while the radar was down: back to the newest coin the index already had (backfill above).
  const knownUntil = db.prepare("SELECT MAX(created) t FROM coins").get()?.t || now() - 30 * MIN;
  setTimeout(() => backfillLaunches(BACKFILL_PAGES, knownUntil).catch(() => {}), 20_000);
  // SOL, the stablecoins, wrapped BTC and the other majors: searchable and charted from the first minute.
  solSupply();
  setTimeout(() => { for (const m of MAJOR_MINTS) lookupMint(m).catch(() => {}); }, 30_000);
  setInterval(() => { for (const m of MAJOR_MINTS) lookupMint(m).catch(() => {}); }, 10 * MIN);
  const timers = [
    setInterval(() => backfillLaunches(4).catch(() => {}), 45_000),
    setInterval(cycle, 30_000),
    setInterval(discoverFeeds, 90_000),
    setInterval(scanRecent, 25_000),
    setInterval(prune, 60 * MIN),
  ];
  logEvent("system", "Radar started");
  return () => { pump.stop(); stopWallets(); timers.forEach(clearInterval); };
}
