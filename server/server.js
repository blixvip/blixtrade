// Blix (Blix Trade) — HTTP API + live event stream + dashboard.
import "./timing.js";
import { marketPrices } from "./market.js";
import http from "node:http";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, json, logEvent, meta, backupInBackground, backups, DB_FILE, DATA, dbStats, checkpointStats } from "./db.js";
import { start, bus, stats, launchLog, recentLaunches, raise, adoptMint, verdict, vet, rebuildFromSnapshots, refreshVisible, adoptFound, wantSafety, backfill } from "./engine.js";
import * as jupdisc from "./jupdisc.js";
import { jupCandles, knownSupply } from "./jup.js";
import { candlePts, downsample, holdFlat } from "./spark.js";
import { startJournal, repairCoin } from "./journalfeed.js";
import * as journal from "./journal.js";
import { replayData, replayPeaks } from "./replay.js";
import { replayFomo } from "./replayfomo.js";
import { startCandleStore, rebuild as rebuildCandles, storeStats as candleStoreStats, revisionOf } from "./candlestore.js";
import * as coinIndex from "./coinindex.js";
import * as xtrack from "./xtrack.js";
import { computeNarratives, THEMES, themesFor } from "./narratives.js";
import { narrativeFeed } from "./narfeed.js";
import { settings, saveSettings, publicSettings, withOverrides, SECRETS, PRIVATE } from "./settings.js";
import { writeBrief, explainCoin, briefProblem } from "./ai.js";
import { notifySignal, notifyBrief, testNotify, decide, rules, destinations, deliveries } from "./notify.js";
import * as wallets from "./wallets.js";
import * as fomo from "./fomo.js";
import * as fomoBoard from "./fomoboard.js";
import * as research from "./research.js";
import * as brain from "./brain.js";
import { pulseData, antiSlop, startPulse, watched, getMeta, metaNow, onMigratedPrices, pictureHooks, nameOf, focusPrice, rugFigures, onChainMc, setPulseFastCheck } from "./pulse.js";
import { dexPaid } from "./dexpaid.js";
import { startLiveTrades, drainUpdates, liveStats, onLiveTrade, onLiveCreate, recordPoolTrade, curveLiqUsd, feed as liveFeed, live as liveCurves } from "./livetrades.js";
import { startPumpSwap, onPoolTrade, swapFeed, poolOf } from "./pumpswap.js";
import { bondedOnChain } from "./engine.js";
import { startChartStream, focusChart, chartStream } from "./chartstream.js";
import { startHelius, heliusStatus } from "./helius.js";
import { startFeedLag, lagSummary } from "./feedlag.js";
import { watchFast, onFastPx, isFast, priceAt, setFastScale, laneStats, fastStats } from "./fastpx.js";
import { rpcStats } from "./solana.js";
import { startLaunchLab, labStats } from "./launchlab.js";
import { startHolders, holdersFor, liveHolders, holderStats, rowHolders, seedWanted } from "./holders.js";
import { devShare, quickHolders } from "./devbal.js";
import { snipeFor, snipeStats, snipeDebug } from "./snipe.js";
import * as paper from "./paper.js";
import { membersReport } from "./adminmembers.js";
import { quote } from "./quote.js";
import { candles, startCandles, series as liveSeries, windowStats, levelNow, setFastCheck, addTrade as addCandleTrade } from "./candles.js";
import { startTunnel, tunnelStats } from "./tunnel.js";
import { startTriage, triageRecord, triageFor } from "./triage.js";
import { testFast } from "./fast.js";
import { testGrok, detectVersion, grokTier, grokBilling } from "./grok.js";
import { startTape, tapeStats } from "./tape.js";
import { startClusters, clusterBoard } from "./clusters.js";
import { coverageStats } from "./coverage.js";
import { exitState, illiquid, onCurve, summarize, firstPerToken, cleanLinks, classifyAsset, ASSET_LABEL } from "./quality.js";
import * as health from "./health.js";
import { visitorMay, memberMay, visitorHealth } from "./access.js";
import { startWebApp, webStats } from "./webapp.js";
import { startEarly, earlyData } from "./early.js";
import * as images from "./images.js";
import * as coin from "./coin.js";
import { onTxTrade } from "./cointape.js";
import { onHolders, holdersLive, onCurve as isWallet, onBalance } from "./holderslive.js";
import { fomoList, fomoMints } from "./fomolists.js";
import { fomoFeed, relayIn, relayedStats } from "./fomofeed.js";
import { bubbleMap, makeBubbleMap } from "./bubblemap.js";
import { banner } from "./banner.js";
import { feedViews, feedLike, viewerOf } from "./feedviews.js";
import { fomoBars, onFomoBar, fomoChartStatus, setFomoToken } from "./fomochart.js";
import { relayStats } from "./fomorelay.js";
import { linksFor } from "./linkfill.js";
import { wantFomoPrices, onFomoPrice, fomoPricesStatus } from "./fomoprices.js";
import { geckoPrice, onGeckoPrice } from "./gecko.js";
import { coinCallouts, pumpFeed } from "./pumpfeed.js";
import { feedStream, feedPics } from "./feedstream.js";
import { feedHistory } from "./feed-history.js";
import { runningNarratives, runningAiIn, runningAiState } from "./running.js";
import { xcard } from "./xcard.js";
import { runningAiStats } from "./running-ai.js";
import { feedHot } from "./feedhot.js";
import { pumpBoard } from "./pumpboard.js";
import { warmBoard } from "./feedwarm.js";
import { coinPeople } from "./chartpeople.js";
import { extSparks } from "./extsparks.js";

const fomoOverview = () => ({ ...fomo.status(), hot: fomo.hotCoins(60, 15), traders: fomo.topTraders(25) });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const PORT = +(process.env.RADAR_PORT || 4420);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const WARNINGS = "'dump', 'dev-sold', 'rugged', 'liq-pulled'";
const MINT = "[1-9A-HJ-NP-Za-km-z]{32,44}";

// How trustworthy a coin's displayed price is: when it was read, from where, and whether it can be sold at it.
function freshness(t) {
  const priceT = t.price_t || (t.price ? t.updated : null);
  const exit = exitState(t, settings.minExitLiq);
  const ageMs = priceT ? Date.now() - priceT : null;
  return {
    priceT, ageMs, source: t.price_src || (t.price ? "dexscreener" : null), dead: t.status === "dead", quarantine: t.quarantine || null,
    illiquid: illiquid(t, settings.minExitLiq), onCurve: onCurve(t), exitable: exit.ok, exitWhy: exit.why,
    // Active coins are re-priced every 30s to 2 min; anything older than 6 minutes is behind.
    stale: t.status === "dead" || ageMs == null || ageMs > 6 * MIN,
  };
}
// Links: the row's, else the coin's own metadata or pump.fun's (linkfill.js: most pump.fun coins have no DexScreener profile).
const tokenOut = (t) => t && ({ ...t, links: linksFor(t.mint, cleanLinks(json(t.links, []))), safety: json(t.safety), themes: json(t.themes, []), fresh: freshness(t) });

// ---------- track record ----------
// Everything here is a price move after an alert, not a trade: no fills, slippage, fees or position size.
const kindKey = (k) => k.startsWith("mcap-") ? "milestone" : k.startsWith("wallet:") ? "wallet" : k;
function perf() {
  const rows = db.prepare(`SELECT s.id, s.mint, s.kind, s.t, s.price, s.mcap, s.p15, s.p1h, s.p6h, s.p24h, s.peak, s.safe, s.illiq, s.title,
      t.symbol, t.name, t.image, t.status tstatus, t.price price_now, t.liquidity liq_now, t.quarantine, t.pair, t.dex, t.price_t, t.updated
    FROM signals s LEFT JOIN tokens t ON t.mint = s.mint
    WHERE s.kind NOT IN (${WARNINGS}) AND s.hidden = 0 AND s.t > ? AND COALESCE(t.asset_class, 'meme') = 'meme'`).all(Date.now() - 14 * DAY);
  const approved = rows.filter((r) => r.safe !== 0), unscreened = rows.filter((r) => r.safe === 0);
  const both = (list) => ({ events: summarize(list), tokens: summarize(firstPerToken(list)) });
  const group = new Map();
  for (const r of approved) { const k = kindKey(r.kind); if (!group.has(k)) group.set(k, []); group.get(k).push(r); }
  const byKind = [...group].map(([kind, list]) => ({ kind, ...both(list) })).sort((a, b) => b.events.events - a.events.events);

  // One line per coin: its first alert, how many alerts piled onto it, its trusted peak, and what could be got out now.
  const perToken = new Map();
  for (const r of [...approved].sort((a, b) => a.t - b.t)) {
    const e = perToken.get(r.mint);
    if (e) { e.alerts++; e.kinds.add(kindKey(r.kind)); continue; }
    const tok = { pair: r.pair, price: r.price_now, quarantine: r.quarantine, liquidity: r.liq_now, dex: r.dex };
    const exit = exitState(tok, settings.minExitLiq);
    perToken.set(r.mint, {
      mint: r.mint, symbol: r.symbol, name: r.name, image: r.image, kind: r.kind, t: r.t, mcap: r.mcap, price: r.price, peak: r.peak, p1h: r.p1h, p24h: r.p24h, illiq: r.illiq,
      alerts: 1, kinds: new Set([kindKey(r.kind)]), dead: r.tstatus === "dead", liqNow: r.liq_now, exitable: exit.ok, exitWhy: exit.why,
      nowMult: r.price > 0 ? (exit.ok ? r.price_now / r.price : 0) : null, priceAge: Date.now() - (r.price_t || r.updated || 0),
    });
  }
  const tokens = [...perToken.values()].map((e) => ({ ...e, kinds: [...e.kinds] }));
  const best = tokens.filter((e) => e.peak != null).sort((a, b) => b.peak - a.peak).slice(0, 10);
  const worst = tokens.filter((e) => e.p1h != null).sort((a, b) => a.p1h - b.p1h).slice(0, 6);
  // Repeat alerts: how concentrated the record is in a few coins.
  const repeat = tokens.filter((e) => e.alerts > 1).reduce((s, e) => s + e.alerts - 1, 0);
  return {
    all: both(approved), byKind, best, worst, unscreened: both(unscreened),
    repeatAlerts: repeat, days: 14, minExitLiq: settings.minExitLiq,
    basis: "Price moves after each alert, measured from the radar's own price readings. They are not trading returns: nothing here accounts for fills, slippage, fees, position size, or whether the size could be sold. A checkpoint taken while the coin's pool was empty counts as 0x.",
  };
}

function signalsQuery({ kind, limit = 60, since = 0, screen = "approved" } = {}) {
  const where = ["s.hidden = 0", "s.t > ?"], args = [+since || 0];
  if (kind) { where.push("s.kind LIKE ?"); args.push(`${kind}%`); }
  if (screen === "approved") where.push("COALESCE(s.safe, 1) = 1");
  else if (screen === "unscreened") where.push("s.safe = 0");
  const rows = db.prepare(`SELECT s.*, t.symbol, t.name, t.image, t.mcap AS mcap_now, t.price AS price_now, t.safety_score, t.pair, t.status AS tstatus, t.liquidity AS liq_now,
      t.quarantine, t.dex, t.price_t, t.updated AS t_updated
    FROM signals s LEFT JOIN tokens t ON t.mint = s.mint WHERE ${where.join(" AND ")} ORDER BY s.t DESC LIMIT ?`).all(...args, Math.min(+limit || 60, 300));
  return rows.map(signalOut);
}
// What the alert's coin looks like right now: can it still be sold, and how old is its price.
function signalOut(r) {
  const exit = exitState({ pair: r.pair, price: r.price_now, quarantine: r.quarantine, liquidity: r.liq_now, dex: r.dex }, settings.minExitLiq);
  return { ...r, dead: r.tstatus === "dead", exitable: exit.ok, exit_why: exit.why, price_age: r.price_t || r.t_updated ? Date.now() - (r.price_t || r.t_updated) : null,
    since: r.price > 0 && r.price_now ? (exit.ok ? r.price_now / r.price : 0) : null };
}

// A coin's market cap over the list's window (5m / 1h / 24h), for the mini charts and their change figure.
// Trade-level where the radar has it (every trade second on the curve from the live feed, bonded pools' prices
// every 2 s; candles.js series), the radar's minute snapshots for anything older, the last snapshot before the
// window as the left edge. Points are [time 0..1 of the window, mc] so the chart is drawn to time: a coin
// younger than the window starts part-way across. 40 time buckets keep their first, low, high and last point,
// so a spike is never thinned away. `chg` is measured on the same line, so line, colour and % always agree.
const SPARK_WIN = { "5m": 5 * MIN, "1h": HOUR, "24h": 24 * HOUR };
const sparkQ = db.prepare("SELECT t, price FROM snapshots WHERE mint = ? AND t > ? AND t < ? AND price > 0 AND COALESCE(ok, 1) = 1 ORDER BY t");
const sparkBefore = db.prepare("SELECT price FROM snapshots WHERE mint = ? AND t <= ? AND price > 0 AND COALESCE(ok, 1) = 1 ORDER BY t DESC LIMIT 1");
// Jupiter's market-cap candles for the whole window (15 min candles for 24h, 1 min for 1h, 15 s for 5m), kept
// per coin and window and refreshed in the background, so a coin the radar only started watching recently
// still gets a full, real line instead of a part-width one with straight ramps across the gaps. The radar's
// own trades and the latest market cap are laid on after Jupiter's last candle, so the line moves live.
const JUP_TF = { "5m": [15, 10_000], "1h": [60, 20_000], "24h": [900, 45_000] };
const jupSpark = new Map();   // `${mint}:${win}` -> { t, pts: [[ms, mc]], pending }
let jupSparkKicks = 0, jupSparkSec = 0;
function jupSparkPts(mint, win, since, fine = false) {
  const [tf, ttl] = fine ? [60, 20_000] : JUP_TF[win] || JUP_TF["1h"], key = `${mint}:${win}${fine ? ":fine" : ""}`, e = jupSpark.get(key), nowMs = Date.now();
  // At most 25 new reads a second across every list, so a page of 200 coins fills in over a few seconds.
  if (Math.floor(nowMs / 1000) !== jupSparkSec) { jupSparkSec = Math.floor(nowMs / 1000); jupSparkKicks = 0; }
  if ((!e || (!e.pending && nowMs - e.t > ttl)) && jupSparkKicks < 25) {
    jupSparkKicks++;
    const next = { t: e?.t || 0, cs: e?.cs || null, pending: true };
    jupSpark.set(key, next);
    jupCandles(mint, tf).then((cs) => { jupSpark.set(key, { t: Date.now(), cs, pending: false }); },
      () => { jupSpark.set(key, { t: Date.now(), cs: next.cs, pending: false }); });
    if (jupSpark.size > 3000) for (const [k, v] of jupSpark) if (!v.pending && nowMs - v.t > 30 * MIN) jupSpark.delete(k);
  }
  const en = jupSpark.get(key), cs = en?.cs;
  if (!cs?.length) return null;
  // The window's candles only (Jupiter sends up to 1,000), found by halving, then drawn whole (open, low and
  // high, close at the candle's end) so the line holds flat across intervals with no trades. Kept a second:
  // a list of 200 coins asks for every line at once, again and again.
  const sinceS = since / 1000;
  if (en.memo && nowMs - en.memo.at < 1000) return en.memo.out;
  let lo = 0, hi = cs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cs[m].time < sinceS) lo = m + 1; else hi = m; }
  const i = lo;
  // A coin only a few hours old has a handful of 15 min candles in the 24h window: use 1 min ones instead.
  if (win === "24h" && !fine && i === 0 && cs.length < 24) { const f = jupSparkPts(mint, win, since, true); if (f) return f; }
  // The last price before the window is its left edge (when the coin is older than the window); a coin with
  // no trade in the whole window sat at that price throughout.
  const body = candlePts(cs.slice(i), tf, nowMs);
  const out = Object.assign(i > 0 ? [[since, cs[i - 1].close], ...body] : body.length ? body : [[since, cs[cs.length - 1].close]], { res: tf * 1000 });
  en.memo = { at: nowMs, out };
  return out;
}

function sparkFor(t, win) {
  const ms = SPARK_WIN[win] || HOUR, now = Date.now(), since = now - ms, B = 40;
  const sup = t.price > 0 && t.mcap > 0 ? t.mcap / t.price : 1e9;   // price -> market cap
  // Ten extra minutes of the feed so the left edge is the last trade before the window, when there was one.
  const all = liveSeries(t.mint, since / 1000 - 600).map(([sec, mc]) => [sec * 1000, mc]);
  const live = all.filter((q) => q[0] >= since), preLive = all.filter((q) => q[0] < since).pop();
  const fresh = live.length && now - live[live.length - 1][0] < 2 * MIN;
  const jup = t.quarantine ? null : jupSparkPts(t.mint, win, since);
  let pts;
  if (jup?.length) {
    // Jupiter's line (held flat through its quiet intervals), then the radar's own trades after its last candle.
    const jEnd = jup[jup.length - 1][0];
    pts = [...holdFlat(jup, jup.res), ...live.filter((q) => q[0] > jEnd)];
  } else {
    const liveFrom = live.length ? live[0][0] : now;
    pts = preLive ? [] : holdFlat(sparkQ.all(t.mint, since, liveFrom).map((r) => [r.t, r.price * sup]), 2 * MIN);
    const before = preLive ? preLive[1] : sparkBefore.get(t.mint, since)?.price * sup;
    // A coin born inside the window starts at its first trade (as Axiom measures it), not at the empty curve.
    if (before) pts.unshift([since, before]);
    pts.push(...live);
  }
  // The feed's own trade seconds: a second without a trade is a second the price did not move.
  pts = holdFlat(pts, 2000);
  // The newest market cap is always the right end, so the line ends where the figure beside it says. It holds
  // at the last known price up to now and only then moves to the newest figure: that move happened after the
  // last point the line knows of, so it is drawn there, not spread back across the silence as a ramp.
  if (pts.length) {
    const end = pts[pts.length - 1];
    if (end[0] < now) pts.push([now, end[1]]);
    if (!fresh && t.mcap > 0 && !t.quarantine && Math.abs(t.mcap / end[1] - 1) > 1e-6) pts.push([now, t.mcap]);
  }
  if (pts.length < 2) return { spark: pts.length ? [[Math.max(0, (pts[0][0] - since) / ms), pts[0][1]]] : [], mc: fresh ? live[live.length - 1][1] : null, chg: null };
  const out = downsample(pts, since, ms, B);
  const first = pts[0][1], last = pts[pts.length - 1][1];
  return { spark: out, mc: fresh ? last : null, chg: first > 0 ? (last / first - 1) * 100 : null };
}
// A row's figures from the radar's own trade feed while the coin is on a pump.fun curve, the way Axiom
// shows them: market cap, liquidity (2 x the curve's virtual SOL reserve, Axiom's convention: GITPAD $15.2K vs $15.1K), volume
// and buys/sells over the window (only when the feed covers the whole window), and the holder ledger
// (holders, top 10, dev, snipers, bundlers; only when the ledger saw the coin from its first trade).
// Null fields mean "no live figure": the page keeps the DexScreener / RugCheck reading for those.
// Discover, ready before anyone opens it: every 20 s the coins its tabs list first (and Fomo's last lists) get the
// same treatment as rows on screen: Jupiter's figures, the chain-seeded holder ledger, a RugCheck report, the dev's
// balance and the launch's snipers and bundlers, so a page opened cold shows every pill filled.
function warmDiscover() {
  const mints = new Set();
  const lists = [{ sort: "volume", minLiq: "5000" }, { sort: "change", minVol: "5000" }, { sort: "new" }, { sort: "new", graduated: "1" }];
  for (const p of lists) { try { for (const r of (tokensQuery({ ...p, dir: "desc", limit: "25" }).rows || []).slice(0, 25)) mints.add(r.mint); } catch {} }
  try { for (const m of fomoMints().slice(0, 60)) mints.add(m); } catch {}
  const all = [...mints];
  if (!all.length) return;
  jupdisc.want(all);
  try { seedWanted(all); wantSafety(all); } catch {}
  for (const m of all) { try { liveRow({ mint: m, dex: null, graduated: 1, liquidity: 1, mcap: null }, "1h"); } catch {} }
}
setInterval(warmDiscover, 20_000).unref?.();
setTimeout(warmDiscover, 15_000).unref?.();

// Snipers and bundlers held now: the live ledger's when it saw the coin's first trade, else from the chain (snipe.js).
function launchFigures(mint, h = rowHolders(mint)) {
  if (h?.sn != null || h?.bd != null) return { snipers: h.sn ?? 0, bundlers: h.bd ?? 0 };
  const x = snipeFor(mint);
  return { snipers: x?.sn ?? null, bundlers: x?.bd ?? null };
}
// Every figure a Discover row shows, never left empty while any source can say it. Jupiter's figures first (what
// Axiom shows for any coin), then the radar's own feed where it is sharper (liveBase), then:
//   liquidity: Jupiter's pool liquidity, else a pump.fun curve's from its market cap (every curve has one shape);
//   dev: the launch transaction's signer's balance (snipe.js) when Jupiter names no dev wallet;
//   safety and insiders, until RugCheck has indexed the coin (it answers "not found" for its first minute or so):
//   a provisional score on RugCheck's own formula (sources.js) from the figures in hand, and the launch-block
//   wallets' share standing in for insiders. Both say so in their tooltips (provisional flags).
const fillQ = db.prepare("SELECT dex, graduated, liquidity, mcap, safety_score, safety FROM tokens WHERE mint = ?");
const BLANK = { mc: null, liq: null, progress: null, vol: null, buys: null, sells: null, holders: null, top10: null, dev: null, devSold: null, snipers: null, bundlers: null };
function fillRow(t, j, r) {
  r = { ...BLANK, ...(r || {}) };
  const row = fillQ.get(t.mint) || {};
  if (r.liq == null && !(row.liquidity > 0)) {
    const curve = row.dex === "pumpfun" && !row.graduated;
    r.liq = curve ? curveLiqUsd(row.mcap ?? r.mc ?? j?.mc) : null;
  }
  if (r.snipers == null || r.bundlers == null) Object.assign(r, Object.fromEntries(Object.entries(launchFigures(t.mint)).filter(([k, v]) => r[k] == null && v != null)));
  // The trade ledger even when it joined late (its wallets are right; the chain seed, asked for every coin on
  // screen, makes its count exact within seconds), rather than an empty pill while Jupiter has not answered yet.
  if (r.holders == null || r.top10 == null || r.dev == null) {
    const hl = rowHolders(t.mint);
    if (hl) { r.holders ??= hl.h ?? null; r.top10 ??= hl.t10 ?? null; r.dev ??= hl.dev ?? null; }
  }
  // Nothing counts it yet (a coin minutes old, not pump.fun's, not yet on Jupiter or RugCheck): one read of its accounts.
  if (r.holders == null || r.top10 == null) {
    const rep0 = json(row.safety, {}) || {};
    if (rep0.totalHolders == null || rep0.top10 == null) { const qx = quickHolders(t.mint); if (qx) { r.holders ??= qx.h; r.top10 ??= qx.t10; } }
  }
  if (r.dev == null) r.dev = snipeFor(t.mint)?.dev ?? null;
  const rep = json(row.safety, {}) || {};
  if (rep.insiderPct == null) { r.insiders = r.bundlers ?? null; r.insidersProv = r.insiders != null; }
  if (row.safety_score == null) {
    const pump = /^pump/.test(row.dex || "") || j?.launchpad === "pump.fun";
    let clean = 100;
    if (!pump && j?.mintOff === false) clean -= 35;     // a mint authority still live: more coins can be printed
    if (!pump && j?.freezeOff === false) clean -= 35;   // a freeze authority still live: holders can be frozen
    const top10 = r.top10, dev = r.dev, ins = r.insiders;
    if (top10 > 35) clean -= Math.min(30, top10 - 35);
    if (ins > 15) clean -= Math.min(30, (ins - 15) * 1.5);
    if (dev > 5) clean -= Math.min(25, (dev - 5) * 2);
    if (top10 != null || dev != null) { r.safety = Math.max(0, Math.round(clean)); r.safetyProv = true; }
  }
  return r;
}
function liveRow(t, win) {
  const j = jupdisc.figures(t.mint, win);
  return fillRow(t, j, liveBase(t, win, j));
}
function liveBase(t, win, j) {
  const out = j ? { mc: j.mc, liq: j.liq ?? null, progress: null, vol: j.vol, buys: j.buys, sells: j.sells, holders: j.holders, top10: j.top10,
    // Jupiter leaves the dev figure out when the dev holds nothing on pump.fun coins; elsewhere the dev wallet's
    // balance is read from the chain (devbal.js), so the dev pill fills in rather than showing a dash.
    dev: j.dev ?? (j.launchpad === "pump.fun" && j.top10 != null ? 0 : devShare(t.mint, j.devWallet, j.supply)), devSold: null, ...launchFigures(t.mint), src: "jupiter" } : null;
  const c = liveCurves.get(t.mint), usd = liveFeed.solUsd, nowS = Date.now() / 1000;
  // A bonded coin counts too while the chain feed reads its PumpSwap pool (livetrades.js recordPoolTrade): its
  // pool trades are in the candle book (pulse.js addTrade), its depth is the pool's SOL side, its holders the ledger's.
  if (!c || c.pad || (c.progress >= 0.995 && !c.pool) || Date.now() - c.last > 30 * MIN) {
    // A pump.fun coin still on its curve that the feed has not seen trade (it last traded before the radar
    // started): its liquidity follows from its market cap, since every standard curve has the same shape.
    const est = t.dex === "pumpfun" && !t.graduated && !(t.liquidity > 0) ? curveLiqUsd(t.mcap ?? j?.mc) : null;
    return est ? { ...(out || { mc: null, liq: null, progress: null, vol: null, buys: null, sells: null, holders: null, top10: null, dev: null, devSold: null, snipers: null, bundlers: null }), liq: est } : out;
  }
  const ms = SPARK_WIN[win] || HOUR, fromS = nowS - ms / 1000;
  const w = windowStats(t.mint, fromS);
  // The feed covers the window when it holds trades from before it, or from the coin's very first trade.
  const covered = w && (w.from <= fromS + 2 || w.from * 1000 <= c.first + 5000);
  const h = rowHolders(t.mint), full = h && !h.p;
  const o = out || { mc: null, liq: null, progress: null, vol: null, buys: null, sells: null, holders: null, top10: null, dev: null, devSold: null, snipers: null, bundlers: null };
  const liq = c.pool ? (c.depth > 0 ? 2 * c.depth * usd : null) : c.vSol > 0 ? 2 * c.vSol * usd : null;
  return { ...o, src: "feed", mc: c.mc * usd, liq, progress: c.pool ? 1 : c.progress,
    vol: covered ? w.vol : o.vol, buys: covered ? w.buys : o.buys, sells: covered ? w.sells : o.sells,
    holders: full ? h.h : o.holders, top10: full ? h.t10 : o.top10, dev: full ? h.dev : o.dev, devSold: full ? h.ds : null,
    // Snipers and bundlers: the ledger's when it saw the launch, else read from the coin's first blocks (snipe.js).
    ...launchFigures(t.mint, h) };
}

function withSpark(list, win = "1h") {
  for (const t of list) { const s = sparkFor(t, win); t.spark = s.spark; t.spark_chg = s.chg; if (s.mc) t.mc_live = s.mc; }
  return list;
}

// Pages list coins by the dozen: start fetching their pictures as soon as a list goes out, so the
// browser's /img requests find them on disk. Each answer is walked once.
const warmedLists = new WeakSet();
function warmPics(v) {
  if (!v || typeof v !== "object" || warmedLists.has(v)) return v;
  warmedLists.add(v);
  const mints = new Set();
  const walk = (x, d) => {
    if (!x || typeof x !== "object" || d > 6 || mints.size > 300) return;
    if (Array.isArray(x)) { for (const y of x) walk(y, d + 1); return; }
    if (typeof x.mint === "string") mints.add(x.mint);
    for (const k in x) if (x[k] && typeof x[k] === "object") walk(x[k], d + 1);
  };
  walk(v, 0);
  images.warm([...mints].filter((m) => !images.hasPicture(m)));
  return v;
}

// ---------- coins ----------
const AGE = "COALESCE(pair_created, first_seen)", TX = "(COALESCE(buys_h1, 0) + COALESCE(sells_h1, 0))", TX5 = "(COALESCE(buys_m5, 0) + COALESCE(sells_m5, 0))";
// DexScreener reports no liquidity for a coin still on the pump.fun curve; Axiom shows 2 x the curve's virtual SOL.
// On the standard curve that is 2 * sqrt(market cap * 32.19 SOL * SOL price) (market cap = vSol^2 / 32.19 SOL).
// SOLUSD is filled in per query.
const LIQ = "(CASE WHEN dex = 'pumpfun' AND COALESCE(liquidity, 0) = 0 AND mcap > 0 THEN 2 * sqrt(mcap * 32.19 * SOLUSD) ELSE liquidity END)";
const solSql = () => String(Math.round((+liveFeed.solUsd || 150) * 100) / 100);
const SORTS = { score: "score", mcap: "mcap", liq: LIQ, volume: "vol_h1", new: AGE, change: "chg_h1", chg24: "chg_h24", safety: "safety_score",
  holders: "json_extract(safety, '$.totalHolders')", tx: TX,
  vol5: "vol_m5", vol24: "vol_h24", chg5: "chg_m5", tx5: TX5 };
// [param, sql expression, comparison]: every numeric filter the Coins page offers.
const RANGES = [
  ["minMcap", "mcap", ">="], ["maxMcap", "mcap", "<="], ["minLiq", LIQ, ">="], ["maxLiq", LIQ, "<="],
  ["minVol", "vol_h1", ">="], ["maxVol", "vol_h1", "<="], ["minVol5", "vol_m5", ">="], ["minVol24", "vol_h24", ">="], ["minTx", TX, ">="], ["minSafety", "safety_score", ">="], ["minScore", "score", ">="],
  ["minHolders", "json_extract(safety, '$.totalHolders')", ">="], ["maxTop10", "json_extract(safety, '$.top10')", "<="],
  ["maxDev", "json_extract(safety, '$.devPct')", "<="], ["maxInsider", "json_extract(safety, '$.insiderPct')", "<="],
  // Discover's full filter set (Axiom's): both ends of every figure, per window where the data has one.
  ["maxVol5", "vol_m5", "<="], ["maxVol24", "vol_h24", "<="], ["maxTx", TX, "<="], ["minTx5", TX5, ">="], ["maxTx5", TX5, "<="],
  ["minBuys", "buys_h1", ">="], ["minSells", "sells_h1", ">="], ["minBuys5", "buys_m5", ">="], ["minSells5", "sells_m5", ">="],
  ["minTop10", "json_extract(safety, '$.top10')", ">="], ["minDev", "json_extract(safety, '$.devPct')", ">="], ["minInsider", "json_extract(safety, '$.insiderPct')", ">="],
  ["maxHolders", "json_extract(safety, '$.totalHolders')", "<="], ["minLp", "json_extract(safety, '$.lpLockedPct')", ">="],
  ["maxDevLaunches", "json_extract(safety, '$.devLaunches')", "<="], ["maxSafety", "safety_score", "<="],
];
// Discover's protocol chips → the dex column ("other" = no known dex).
const DEXES = new Set(["pumpfun", "pumpswap", "meteoradbc", "meteora", "raydium", "orca", "bags", "fluxbeam", "other"]);
const SOCIAL = { twitter: ["twitter", "x"], website: ["website"], telegram: ["telegram"] };
const hasLink = (types) => `EXISTS (SELECT 1 FROM json_each(COALESCE(links, '[]')) j WHERE j.value->>'type' IN (${types.map((t) => `'${t}'`).join(", ")}))`;
const list = (v, max) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, max);
// A typed search, with LIKE's wildcards taken literally ("a_b" is not "a?b", "%" is not everything).
const likeArg = (s) => `%${String(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
function tokensQuery(p = {}) {
  const q = String(p.q || "").trim().slice(0, 64);
  // A search looks everywhere (dead and flagged coins, and coins still waiting for their first pool too);
  // browsing shows live, believable, real memecoins.
  // `mints`: exactly these coins, whatever their state (Discover's Fomo tabs look up the coins Fomo lists).
  const only = list(p.mints, 200);
  const where = q || only.length ? [] : ["pair IS NOT NULL"], args = [];
  if (only.length) { where.push(`mint IN (${only.map(() => "?").join(", ")})`); args.push(...only); }
  if (!q && !only.length) {
    where.push("status = 'active'");
    if (p.unreliable !== "1") where.push("quarantine IS NULL");
    // A pool holding more value than the whole coin is worth means most of the supply sits in the pool and the
    // "volume" is the pool trading with itself (a wash-traded copy: 14Deg…Kaiq "Human", $7.4M an hour, $0
    // organic volume on Jupiter, not listed by Axiom). Curves are exempt: their liquidity is virtual.
    if (p.unreliable !== "1") where.push("NOT (COALESCE(dex, '') NOT IN ('pumpfun', 'meteoradbc', 'bags', 'launchlab', 'moonshot', 'boop', 'heaven') AND liquidity > mcap AND mcap > 0)");
    if (p.cls === "other") where.push("COALESCE(asset_class, 'meme') != 'meme'");
    else if (p.cls !== "all") where.push("COALESCE(asset_class, 'meme') = 'meme'");
  }
  if (p.theme) { where.push("themes LIKE ?"); args.push(`%"${p.theme}"%`); }
  for (const [key, expr, op] of RANGES) if (p[key] !== undefined && p[key] !== "" && Number.isFinite(+p[key])) { where.push(`${expr.replaceAll("SOLUSD", solSql())} ${op} ?`); args.push(+p[key]); }
  if (p.minAge) { where.push(`${AGE} <= ?`); args.push(Date.now() - +p.minAge * MIN); }
  if (p.maxAge) { where.push(`${AGE} >= ?`); args.push(Date.now() - +p.maxAge * MIN); }
  // A contract matches whole or by its first characters (a CA typed or pasted part way).
  if (q) { where.push("(symbol LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR mint = ? OR (length(?) >= 6 AND mint LIKE ? ESCAPE '\\'))"); args.push(likeArg(q), likeArg(q), q, q, `${likeArg(q).slice(1)}`); }
  if (p.graduated === "1") where.push("graduated = 1"); else if (p.graduated === "0") where.push("graduated = 0");
  const dex = list(p.dex, 12).filter((d) => DEXES.has(d));
  if (dex.length) where.push(`(${[dex.some((d) => d !== "other") && `dex IN (${dex.filter((d) => d !== "other").map((d) => `'${d}'`).join(", ")})`, dex.includes("other") && "dex IS NULL OR dex NOT IN ('pumpfun', 'pumpswap', 'meteoradbc', 'meteora', 'raydium', 'orca', 'bags', 'fluxbeam')"].filter(Boolean).join(" OR ")})`);
  const kw = list(p.kw, 10), xkw = list(p.xkw, 10);
  if (kw.length) { where.push(`(${kw.map(() => "symbol LIKE ? OR name LIKE ?").join(" OR ")})`); for (const k of kw) args.push(`%${k}%`, `%${k}%`); }
  for (const k of xkw) { where.push("COALESCE(symbol, '') NOT LIKE ? AND COALESCE(name, '') NOT LIKE ?"); args.push(`%${k}%`, `%${k}%`); }
  if (p.paid === "1") where.push("(COALESCE(boosts, 0) > 0 OR header IS NOT NULL)");
  if (p.pumpCa === "1") where.push("mint LIKE '%pump'");
  if (p.noDanger === "1") where.push("COALESCE(json_extract(safety, '$.danger'), 0) = 0");
  for (const k of Object.keys(SOCIAL)) if (p[k] === "1") where.push(hasLink(SOCIAL[k]));
  if (p.social === "1") where.push(hasLink(["twitter", "x", "website", "telegram", "discord", "instagram", "tiktok", "youtube", "reddit", "truth"]));
  const hide = list(p.hide, 500);
  if (hide.length) { where.push(`mint NOT IN (${hide.map(() => "?").join(", ")})`); args.push(...hide); }
  const expr = (SORTS[p.sort] || SORTS.score).replaceAll("SOLUSD", solSql()), dir = p.dir === "asc" ? "ASC" : "DESC";
  const limit = Math.max(1, Math.min(+p.limit || 100, 400)), offset = Math.max(0, +p.offset || 0);
  // A search with no sort asked for puts the best match first (the CA, then the exact ticker, then tickers and
  // names that start with it), so "BONK" finds Bonk before the hundred coins with "bonk" somewhere in the name.
  const rank = q && !(p.sort in SORTS) ? "CASE WHEN mint = ? THEN 0 WHEN lower(symbol) = lower(?) THEN 1 WHEN symbol LIKE ? ESCAPE '\\' THEN 2 WHEN name LIKE ? ESCAPE '\\' THEN 3 ELSE 4 END, " : "";
  const rankArgs = rank ? [q, q, likeArg(q).slice(1), likeArg(q).slice(1)] : [];
  const total = db.prepare(`SELECT COUNT(*) n FROM tokens WHERE ${where.join(" AND ")}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM tokens WHERE ${where.join(" AND ")} ORDER BY ${rank}(${expr}) IS NULL, ${expr} ${dir}, mint LIMIT ? OFFSET ?`).all(...args, ...rankArgs, limit, offset);
  // Lists don't need each coin's full holder list and risk text; the coin page loads those.
  const dup = dupes();
  // Token-info pills: only figures that can still be true. Jupiter's (what Axiom shows, re-read every ~25 s
  // while on screen) first; else a RugCheck reading under 10 minutes old that rugFigures() accepts (a bonded
  // coin's first minutes in its pool read wrong); else nothing (the pill shows "—", never an old number).
  // Paid = DexScreener's own orders API (a paid profile), not a boost or a header picture.
  const win = p.spark === "5m" || p.spark === "24h" ? p.spark : "1h";
  jupdisc.want(rows.map((t) => t.mint));
  // The top coins' Fomo holders and theses, read ahead: the first 20 on screen, then the running day-old coins
  // holding $50k+ (the ones whose Gecko chart the page preloads too).
  if (!q) fomoBoard.prefetchCoins([...new Set([...rows.slice(0, 20).map((t) => t.mint),
    ...rows.filter((t) => { const b = t.pair_created || t.first_seen; return b > 0 && Date.now() - b >= 24 * 3600e3 && (t.mcap || 0) >= 50_000 && (t.vol_h1 || 0) > 0; }).slice(0, 8).map((t) => t.mint)])]);
  const pct = (v) => (v == null || !(v >= 0 && v <= 100) ? null : v);   // RugCheck sometimes reports 127% insiders
  const slim = (t) => {
    const fig = jupdisc.figures(t.mint, win);
    const rf = t.safety_checked && Date.now() - t.safety_checked < 10 * MIN ? rugFigures(t, t.safety || {}) : { holders: null, top10: null, dev: null, insiders: null };
    const dev = fig ? fig.dev ?? (fig.launchpad === "pump.fun" && fig.top10 != null ? 0 : null) : rf.dev;
    return { ...t, description: undefined, paid: dexPaid(t.mint), figSrc: fig ? "jupiter" : rf.holders != null || rf.top10 != null ? "rugcheck" : null,
      safety: { danger: t.safety?.danger, warn: t.safety?.warn, top10: pct(fig?.top10 ?? rf.top10), devPct: pct(dev), insiderPct: pct(rf.insiders), totalHolders: fig?.holders ?? rf.holders, lpLockedPct: t.safety?.lpLockedPct },
      dupes: dup.get(String(t.symbol || "").toLowerCase())?.n || 1, dupTop: dup.get(String(t.symbol || "").toLowerCase())?.top === t.mint };
  };
  return { rows: withSpark(rows.map(tokenOut).map(slim), p.spark), total, limit, offset, sort: p.sort in SORTS ? p.sort : "score", dir: dir.toLowerCase() };
}
// Tickers shared by several tracked coins: how many, and which one is the biggest.
let dupCache = { t: 0, v: new Map() };
function dupes() {
  if (Date.now() - dupCache.t < 30_000) return dupCache.v;
  const v = new Map();
  for (const r of db.prepare("SELECT mint, lower(symbol) s, mcap FROM tokens WHERE status = 'active' AND pair IS NOT NULL AND symbol IS NOT NULL ORDER BY mcap DESC").all()) {
    const e = v.get(r.s);
    if (e) e.n++; else v.set(r.s, { n: 1, top: r.mint });
  }
  dupCache = { t: Date.now(), v };
  return v;
}

function overview() {
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;
  const hour = Date.now() - HOUR, day = Date.now() - DAY;
  const h = cached("health", 10_000, healthReport);
  return {
    stats: { ...stats, launchesLastHour: launchLog.filter((l) => l.t > hour).length, launchDataMin: launchLog.length ? Math.round((Date.now() - launchLog[0].t) / MIN) : 0 },
    // Five table counts, ~0.25 s together: the page shows them as totals, so they are re-counted every 30 s,
    // not on every 3 s refresh.
    counts: cached("overview-counts", 30_000, () => ({
      tracked: count("SELECT COUNT(*) n FROM tokens WHERE status = 'active' AND pair IS NOT NULL"),
      safe: count("SELECT COUNT(*) n FROM tokens WHERE status = 'active' AND pair IS NOT NULL AND quarantine IS NULL AND COALESCE(asset_class, 'meme') = 'meme' AND safety_score >= ?", settings.minSafety),
      signals24h: count("SELECT COUNT(*) n FROM signals WHERE hidden = 0 AND COALESCE(safe, 1) = 1 AND t > ?", day),
      unscreened24h: count("SELECT COUNT(*) n FROM signals WHERE hidden = 0 AND safe = 0 AND t > ?", day),
      graduated24h: count("SELECT COUNT(*) n FROM tokens WHERE graduated = 1 AND first_seen > ?", day),
    })),
    health: { issues: h.issues, worst: h.worst, summary: h.parts.filter((p) => p.state === "down" || p.state === "degraded").map((p) => p.name.split(" (")[0]) },
    top: tokensQuery({ sort: "score", limit: 12, minSafety: settings.minSafety }).rows,
    signals: signalsQuery({ limit: 40 }),
    brief: db.prepare("SELECT * FROM briefs ORDER BY t DESC LIMIT 1").get() || null,
  };
}

// ---------- AI ----------
let briefBusy = null;
async function makeBrief(reason = "scheduled") {
  if (briefBusy) return briefBusy;
  briefBusy = (async () => {
    const nar = cached("narratives", 60_000, () => computeNarratives({ launches: launchLog }));   // the page's reading: a fresh build blocked ~2 s
    const top = tokensQuery({ sort: "score", limit: 15, minSafety: settings.minSafety }).rows.map((t) => ({
      ticker: t.symbol, name: t.name, mcap: Math.round(t.mcap), liq: t.fresh.onCurve ? "still on its bonding curve (no pool yet, tradable)" : Math.round(t.liquidity), vol1h: Math.round(t.vol_h1),
      chg1h: t.chg_h1, chg24h: t.chg_h24, score: t.score, safety: t.safety_score, themes: t.themes, graduated: !!t.graduated,
      buys1h: t.buys_h1, sells1h: t.sells_h1, ageMin: Math.round((Date.now() - (t.pair_created || t.first_seen)) / MIN),
    }));
    const uptime = launchLog.length ? Math.round((Date.now() - launchLog[0].t) / MIN) : 0;
    const rec = perf().all.tokens, recent = Date.now() - 3 * HOUR;
    const warned = (kind) => db.prepare("SELECT title FROM signals WHERE kind = ? AND hidden = 0 AND t > ? ORDER BY t DESC LIMIT 6").all(kind, recent).map((s) => s.title);
    const data = {
      radarUptimeMinutes: uptime,
      note: uptime < 60 ? `The radar started ${uptime} minutes ago, so launch counts cover only that window. Do not call the launch pace slow or fast.` : undefined,
      launchesSeen: launchLog.filter((l) => l.t > Date.now() - HOUR).length,
      graduatedCoinsTracked: overview().counts.graduated24h,
      narratives: nar.themes.slice(0, 8).map((t) => ({ theme: t.name, heat: t.heat, launchShare: +(t.launchShare * 100).toFixed(1), launchLift: t.launchLift == null ? null : +t.launchLift.toFixed(2), trackedVolume1h: Math.round(t.volume), leaders: t.top.slice(0, 3).map((x) => x.symbol) })),
      emergingWords: nar.emerging.slice(0, 10).map((e) => `${e.word} (${e.count})`),
      topCoins: top,
      recentSignals: signalsQuery({ limit: 15, since: recent }).map((s) => ({ kind: kindKey(s.kind), title: s.title })),
      // Price moves after alerts, one per coin; not trading results.
      alertTrackRecord: { coinsAlerted: rec.tokens, checkedAfter1h: rec.eligible1h, up20pctAfter1h: rec.up20, down50pctAfter1h: rec.down50, unsellableAfter1h: rec.unsellable1h, medianMultipleAfter1h: rec.median1h && +rec.median1h.toFixed(2) },
      confirmedRugs: warned("rugged"), liquidityPulled: warned("liq-pulled"), devSold: warned("dev-sold"), dumps: warned("dump"),
      unscreenedWalletBuys: signalsQuery({ limit: 8, since: recent, screen: "unscreened" }).map((s) => ({ title: s.title, why: s.why_unsafe })),
      researchGrades: research.desk().top.slice(0, 8).map((r) => ({ ticker: r.symbol, grade: r.grade, ceiling: r.ceiling, verdict: r.verdict })),
      fomoBuying: fomo.hotCoins(60, 8).map((c) => ({ ticker: c.symbol, fomoBuyers: c.buyers, fomoSellers: c.sellers, netUsd: Math.round((c.bought || 0) - (c.sold || 0)) })),
      followedWalletBuys: wallets.activity(40).filter((a) => a.side === "buy" && a.t > Date.now() - 2 * HOUR).map((a) => ({ wallet: a.label || a.wallet.slice(0, 6), ticker: a.symbol, usd: Math.round(a.usd || 0) })).slice(0, 15),
    };
    const { text, model, status, problem } = await writeBrief(data);
    db.prepare("INSERT INTO briefs (t, body, model, status, stop) VALUES (?, ?, ?, ?, ?)").run(Date.now(), text, model, status, problem);
    const b = db.prepare("SELECT * FROM briefs ORDER BY id DESC LIMIT 1").get();
    logEvent("brief", status === "complete" ? `Brief written (${reason})` : `Brief came back incomplete twice (${problem}); saved and marked partial`);
    bus.emit("brief", b);
    // An unfinished brief is kept for the record but never pushed out as if it were whole.
    if (status === "complete") notifyBrief(text).catch(() => {});
    return b;
  })().finally(() => { briefBusy = null; });
  return briefBusy;
}

const explained = new Map(); // mint -> { t, text }
async function explain(mint) {
  const c = explained.get(mint);
  if (c && Date.now() - c.t < 15 * MIN) return c;
  const t = tokenOut(db.prepare("SELECT * FROM tokens WHERE mint = ?").get(mint));
  if (!t) throw Object.assign(new Error("Unknown coin"), { status: 404 });
  const sigs = db.prepare("SELECT kind, title, t FROM signals WHERE mint = ? AND hidden = 0 ORDER BY t DESC LIMIT 8").all(mint);
  const { text } = await explainCoin({
    ticker: t.symbol, name: t.name, description: t.description, themes: t.themes, links: t.links.map((l) => l.type),
    mcap: t.mcap, peakMcap: t.peak_mcap, liquidity: t.liquidity, vol5m: t.vol_m5, vol1h: t.vol_h1, vol24h: t.vol_h24,
    chg5m: t.chg_m5, chg1h: t.chg_h1, chg24h: t.chg_h24, buys1h: t.buys_h1, sells1h: t.sells_h1, graduated: !!t.graduated, dex: t.dex,
    ageMinutes: Math.round((Date.now() - (t.pair_created || t.first_seen)) / MIN), safetyScore: t.safety_score,
    safetyRisks: t.safety?.risks?.map((r) => `${r.level}: ${r.name}`), lpLockedPct: t.safety?.lpLockedPct, signals: sigs,
    priceIsReliable: t.fresh.exitable, priceProblem: t.fresh.exitWhy, coinIsDead: t.fresh.dead,
  });
  const out = { t: Date.now(), text };
  explained.set(mint, out);
  return out;
}

// ---------- one coin ----------
// One consistent record per coin: the tracked row, with the live pump.fun trade feed laid over it when
// that is fresher, and a stand-in built from the launch feed for coins the radar has not adopted yet.
function tokenDetail(mint) {
  const row = db.prepare("SELECT * FROM tokens WHERE mint = ?").get(mint);
  const live = liveStats(mint);
  const launch = recentLaunches.findLast((l) => l.mint === mint);
  if (!row && !launch && !live) return null;
  const m = getMeta(mint) || {};
  let t = row ? tokenOut(row) : tokenOut({
    mint, symbol: launch?.symbol || null, name: launch?.name || null, description: m.description || "", image: m.image || null, source: "pump-live", first_seen: launch?.seen || live?.last || Date.now(),
    links: JSON.stringify([m.twitter && { type: "twitter", url: m.twitter }, m.website && { type: "website", url: m.website }, m.telegram && { type: "telegram", url: m.telegram }].filter(Boolean)),
    dex: "pumpfun", status: "untracked", score: 0, creator: launch?.creator || null, dev_sol: launch?.devSol ?? null, graduated: 0,
  });
  const liveFresh = live && Date.now() - live.last < 15 * MIN;
  if (liveFresh && !t.graduated && (!t.price || !t.fresh.priceT || live.last > t.fresh.priceT)) {
    // pump.fun coins have a fixed 1B supply, so the curve's market cap gives the price directly.
    t = { ...t, price: live.mc / 1e9, mcap: live.mc, peak_mcap: Math.max(t.peak_mcap || 0, live.ath) };
    t.fresh = { ...t.fresh, priceT: live.last, ageMs: Date.now() - live.last, source: "pump.fun live trades", stale: Date.now() - live.last > 6 * MIN, exitable: true, exitWhy: null, onCurve: true };
  }
  const v = verdict(row || t);
  const sameTicker = t.symbol ? db.prepare(`SELECT mint, symbol, name, image, mcap, dex, status, ${AGE} born FROM tokens WHERE lower(symbol) = lower(?) AND mint != ? AND pair IS NOT NULL ORDER BY mcap DESC LIMIT 8`).all(t.symbol, mint) : [];
  const rule = db.prepare("SELECT effect FROM alert_rules WHERE scope = 'coin' AND target = ?").get(mint)?.effect || null;
  return {
    token: t, untracked: !row, verdict: v, sameTicker, rule,
    live: liveFresh ? { mcap: live.mc, ath: live.ath, buys: live.buys, sells: live.sells, traders: live.traders, vol: live.vol, progress: live.progress, last: live.last, chg1m: live.chg1m } : null,
    triage: triageFor(mint) ? { label: triageFor(mint).label, score: triageFor(mint).score, why: triageFor(mint).why, src: triageFor(mint).src } : null,
    snapshots: db.prepare("SELECT t, price, mcap, liquidity, vol_m5, ok FROM snapshots WHERE mint = ? AND t > ? ORDER BY t").all(mint, Date.now() - 3 * DAY),
    signals: db.prepare("SELECT * FROM signals WHERE mint = ? AND hidden = 0 ORDER BY t DESC").all(mint),
    walletTrades: db.prepare(`SELECT wt.wallet, wt.side, wt.usd, wt.t, w.label FROM wallet_trades wt JOIN wallets w ON w.address = wt.wallet WHERE wt.mint = ? AND wt.t > ? ORDER BY wt.t`).all(mint, Date.now() - 3 * DAY),
    wallets: wallets.coinWallets(mint), fomo: fomo.coinFlow(mint), research: research.researchFor(mint),
    // The live ledger from the trade feed (who holds what, dev, snipers, bundle) and any paper positions in it.
    holders: holdersFor(mint, { top: 20 }), paper: paper.positionsFor(mint),
    progress: liveFresh && !t.graduated ? live.progress : row ? research.bondingProgress(row) : null,
    themeOptions: THEMES.map(([n]) => n), classOptions: ASSET_LABEL,
  };
}

// The newest PROBE line of data/probe.log (the chart probe's one-line verdict), read at most once a minute.
let probeCache = { t: 0, v: null };
function lastProbe() {
  if (Date.now() - probeCache.t < 60_000) return probeCache.v;
  probeCache.t = Date.now();
  try {
    const p = path.join(DATA, "probe.log");
    const st = fs.statSync(p), fd = fs.openSync(p, "r"), len = Math.min(st.size, 8192), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
    const line = buf.toString("utf8").split("\n").filter((l) => l.startsWith("PROBE ")).pop();
    const m = line && /^PROBE (OK|BAD) (\S+) (.*)$/.exec(line);
    probeCache.v = m ? { bad: m[1] === "BAD", t: Date.parse(m[2]) || 0, line: `${m[1]} ${m[3]} · ${new Date(m[2]).toLocaleTimeString()}` } : null;
  } catch { probeCache.v = null; }
  return probeCache.v;
}
// ---------- health ----------
// One list of everything the radar depends on: is it working, when did it last work, what went wrong.
// Crashes, read from the supervisor's log: an exit code the radar did not choose itself (a native fault
// or abort), as opposed to being stopped on purpose.
function crashes(now) {
  const out = { h6: 0, h24: 0, last: null, hangs24: 0 };
  try {
    const file = path.join(DATA, "server.log"), size = fs.statSync(file).size, len = Math.min(size, 200_000);
    const buf = Buffer.alloc(len), fd = fs.openSync(file, "r");
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    const text = buf.toString("utf8");
    // A radar the supervisor had to stop because it no longer answered counts as much as a crash.
    for (const m of text.matchAll(/radar exited with \S+ at (\S+) after \S+ \(hang/g)) {
      const t = Date.parse(m[1]);
      if (!(now - t < DAY)) continue;
      out.hangs24++; out.h24++; if (now - t < 6 * HOUR) out.h6++;
      out.last = Math.max(out.last || 0, t);
    }
    for (const m of text.matchAll(/radar exited with (\d+) at (\S+)(?! after \S+ \(hang)/g)) {
      const code = +m[1], t = Date.parse(m[2]);
      if (!(code === 134 || (code >= 0xC0000000 && code < 0xFFFFFFFF)) || !(now - t < DAY)) continue;
      out.h24++; if (now - t < 6 * HOUR) out.h6++;
      out.last = Math.max(out.last || 0, t);
    }
  } catch {}
  return out;
}

function healthReport() {
  const now = Date.now(), parts = [];
  const add = (key, name, state, summary, extra = {}) => parts.push({ key, name, state, summary, ...extra });
  const hp = (key) => { const p = health.part(key); return { lastOk: p.lastOk, lastFail: p.lastFail, lastError: p.lastError, ok: p.ok, fail: p.fail }; };
  const ago = (t) => !t ? "never" : now - t < MIN ? `${Math.round((now - t) / 1000)}s ago` : now - t < HOUR ? `${Math.round((now - t) / MIN)}m ago` : `${Math.round((now - t) / HOUR)}h ago`;

  const cr = crashes(now), upMs = now - stats.startedAt;
  const upFor = upMs < HOUR ? `${Math.max(1, Math.round(upMs / MIN))}m` : `${(upMs / HOUR).toFixed(1)}h`;
  add("stability", "Radar process", cr.h6 >= 2 ? "degraded" : "ok",
    `Running for ${upFor} · crashed ${cr.h24 - cr.hangs24}× and stopped answering ${cr.hangs24}× in the last 24h${cr.last ? ` (last ${ago(cr.last)})` : ""}${cr.h24 ? " · it restarts itself in about 2 seconds and picks up its recordings" : ""}`,
    { lastFail: cr.last, crashes24h: cr.h24, sql: dbStats, checkpoint: checkpointStats, runtime: process.version });
  const rs = health.responsiveness(), secs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
  add("responsiveness", "Responsiveness", rs.worst10m >= 2000 ? "degraded" : "ok",
    `Longest pause: ${rs.worst10m ? secs(rs.worst10m) : "none over 0.2 s"} in the last 10 minutes, ${rs.worst24h ? secs(rs.worst24h) : "none"} since start or 24h · ${rs.over1s} pauses over 1 s${rs.slow.length ? ` · slowest work: ${rs.slow.slice(0, 3).map((s) => `${s.name} ${secs(s.worstMs)} (${s.n}×)`).join("; ")}` : ""}`,
    { stats: rs });
  add("webapp", "New page (127.0.0.1:4421)", process.env.BLIX_WEB_EXTERNAL ? "ok" : webStats.on && webStats.built ? "ok" : webStats.on ? "degraded" : "down",
    process.env.BLIX_WEB_EXTERNAL ? "Served by the supervisor from web/dist, so it stays up while the radar restarts" : webStats.on ? (webStats.built ? `Served by Blix itself from web/dist · built ${ago(webStats.built)}` : "Running, but web/dist has not been built (npm run build in the web folder)") : `Not running${webStats.error ? `: ${webStats.error}` : ""}`,
    { lastError: webStats.error });
  const fileMb = (f) => { try { return fs.statSync(f).size / 1048576; } catch { return 0; } };
  const dbMb = fileMb(DB_FILE), walMb = fileMb(`${DB_FILE}-wal`);
  // Degraded when the disk holding it is getting full (under 3x its size, or 2 GB, left), not at a fixed size: the
  // server has tens of GB free and a 1.5 GB limit set for the PC flagged it all day.
  let diskFreeMb = Infinity; try { const st = fs.statfsSync(DATA); diskFreeMb = (st.bavail * st.bsize) / 1e6; } catch {}
  add("database", "Database", diskFreeMb < Math.max(2000, dbMb * 3) ? "degraded" : "ok",
    `${dbMb.toFixed(0)} MB on disk${walMb > 1 ? ` (+${walMb.toFixed(0)} MB not yet folded in)` : ""} · price history older than a day is thinned to 5-minute highs and lows, gone after 3 days`, { mb: Math.round(dbMb) });

  const pumpAge = stats.pumpLast ? now - stats.pumpLast : null;
  add("launches", "Launch feed (PumpPortal)", stats.pump !== "connected" ? "down" : pumpAge != null && pumpAge > 90_000 ? "degraded" : "ok",
    stats.pump !== "connected" ? `Socket is ${stats.pump}` : `${stats.launchesSeen.toLocaleString()} launches this session, last one ${ago(stats.pumpLast)}`, { ...hp("pumpportal"), lastOk: stats.pumpLast || null });
  add("trades", "Live pump.fun trades (RPC websocket)", !liveFeed.connected ? "down" : now - liveFeed.lastMsg > 30_000 ? "degraded" : "ok",
    liveFeed.connected ? `${liveFeed.perSec} trades/s, last message ${ago(liveFeed.lastMsg)}` : `${liveFeed.lastError || "Connecting to RPC"}; retry every 3s`, { lastOk: liveFeed.lastMsg || null });
  add("pumpswap", "Live PumpSwap pool trades (bonded coins' prices)", !swapFeed.connected ? "down" : now - swapFeed.lastMsg > 30_000 ? "degraded" : "ok",
    swapFeed.connected ? `${swapFeed.trades} pool trades, ${swapFeed.priced} priced, ${swapFeed.pools} pools known, last message ${ago(swapFeed.lastMsg)}` : `${swapFeed.error || "Connecting to RPC"}; retry every 3s`, { lastOk: swapFeed.lastMsg || null });
  if (chartStream.on) add("chartstream", "Open charts' own trade stream (fast RPC, one subscription per coin)", chartStream.overBudget ? "degraded" : !chartStream.connected ? (chartStream.coins || chartStream.error ? "down" : "ok") : "ok",
    `${chartStream.connected ? `${chartStream.coins} charts streaming, ${chartStream.msgs} messages` : "idle until a chart opens"}; ${(chartStream.bytesToday / 1e6).toFixed(0)} MB today of the ${settings.chartDailyMB} MB budget${chartStream.keys > 1 ? ` · on key ${chartStream.key || "?"} of ${chartStream.keys}` : ""}${chartStream.side ? ` · side socket ${chartStream.side.on ? "on" : "off"} (${chartStream.side.n} subs) · fast socket ${chartStream.fast.on ? "on" : "off"} (${chartStream.fast.n} subs) · ${chartStream.extra.n} extra` : ""}${chartStream.error ? `; ${chartStream.error}` : ""}${lagSummary() ? `; ${lagSummary()}` : ""}${laneStats.on ? "; fast lane on" : `; fast lane off${laneStats.error ? ` (${laneStats.error})` : ""}`}`, { lastOk: chartStream.lastMsg || null, sockets: { side: chartStream.side, fast: chartStream.fast, extra: chartStream.extra } });
  // Helius credits (helius.js): each key's month at Helius (Admin API; needs the project ID in Settings next to
  // the key) and what the stream counted on it today (heliuskeys.js). One row per key.
  for (const hs of heliusStatus()) {
    const u = hs.usage, k = hs.key, two = chartStream.keys > 1;
    const days = u?.resetAt ? Math.max(0, Math.ceil((u.resetAt - now) / DAY)) : null;
    const resetText = u?.resetAt ? `resets in ${days === 0 ? "under a day" : `${days} day${days === 1 ? "" : "s"}`} (${new Date(u.resetAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })})` : "reset date unknown";
    const top = Object.entries(k.byMethod || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${m} ${n.toLocaleString()}`).join(", ");
    const today = `today ${(k.creditsToday || 0).toLocaleString()} credits (${(k.bytesToday / 1e6).toFixed(0)} MB${top ? `; calls: ${top}` : ""}) of the ${k.dayBudget.toLocaleString()} daily budget (paced: ${(k.allowedNow || 0).toLocaleString()} allowed by now)${k.dayUsed ? ", paced out for now" : ""}`;
    const role = two ? (k.active ? " · in use" : k.monthUsed ? " · resting until the month resets" : k.dayUsed ? " · resting until midnight UTC" : " · spare") : "";
    const state = !hs.projectId ? (k.dayUsed ? "degraded" : "idle") : u ? (u.pctUsed >= 100 ? "down" : u.pctUsed >= 80 ? "degraded" : "ok") : hs.error ? "down" : "idle";
    add(`helius${hs.index > 1 ? hs.index : ""}`, `Helius credits${two ? ` · key ${hs.index}` : ""} (this month)`, state,
      (!hs.projectId ? `Project ID not set, so the month's usage cannot be read · ${today}`
        : u ? `${u.pctUsed}% used · ${u.used.toLocaleString()} of ${u.limit.toLocaleString()} credits, ${u.remaining.toLocaleString()} left${u.prepaidRemaining ? ` (+${u.prepaidRemaining.toLocaleString()} prepaid)` : ""} · ${resetText} · ${today}${hs.error ? ` · last read failed: ${hs.error}` : ""}`
        : hs.error ? `Could not read usage: ${hs.error} · ${today}` : `Reading usage… · ${today}`) + role,
      { lastOk: hs.fetchedAt || null, pct: u?.pctUsed ?? null, usage: u, resetAt: u?.resetAt || null, keyUse: k,
        fix: !hs.projectId ? `Open dashboard.helius.dev, copy the project's ID (it is in the address bar: dashboard.helius.dev/<project id>/dashboard) into Settings → Keys → ${hs.index > 1 ? "Second Helius project ID" : "Helius project ID"}.` : hs.error && /project id/i.test(hs.error) ? "The project ID in Settings does not belong to this key. Copy it again from dashboard.helius.dev." : u && u.pctUsed >= 80 ? (two ? "This key is nearly out for the month; the stream moves to the other key at 97%." : "Charts are using most of the free month. Add a second Helius key in Settings, lower the chart stream's daily MB budget, or open fewer charts until the reset.") : null });
  }
  // The chart probe's last verdict (scripts/probe-busiest.sh, a real browser on the busiest coin's 1 s chart,
  // every 30 min on the VM): stalls, reverting jumps or a slow trade-to-chart lag show here, not only in its log.
  const probe = lastProbe();
  if (probe) add("chartprobe", "Chart probe (busiest coin, 1 s chart, real browser)", probe.bad ? "degraded" : now - probe.t > 2 * 3600e3 ? "idle" : "ok", probe.line, { lastOk: probe.bad ? null : probe.t });
  // Fomo's charts (fomochart.js): the sign-in token's life, the live socket, what is open, and the last problem.
  {
    const fc = fomoChartStatus(), fp = fomoPricesStatus();
    const tokenText = fc.token.expiresInMin != null ? `token ${fc.token.expiresInMin} min left${fc.token.pushedAgoMin != null ? ` (from the PC ${fc.token.pushedAgoMin} min ago)` : ""}` : `no token (${fc.token.error})`;
    // No Fomo session on the server: Fomo mode is simply off (the charts run on GeckoTerminal and Blix's own
    // candles), not a fault.
    const state = fc.signedOut || fc.token.expiresInMin == null ? "off" : fc.open && fc.lastError && now - fc.lastRead > 60e3 ? "degraded" : fc.token.expiresInMin < 10 ? "degraded" : "ok";
    add("fomochart", "Fomo charts (fomo.family's bars, live)", state,
      `${fc.open} open · ${fc.liveBars} live bars, ${fc.bars} in all · socket ${fc.socket.state}${fc.socket.alive ? " alive" : ""} (${fc.socket.subscriptions} subs${fc.socket.lastMessageAgoS != null ? `, last message ${fc.socket.lastMessageAgoS}s ago` : ""}) · prices ${fp.state} (${fp.subs} of ${fp.wanted} coins, ${fp.ticks} ticks${fp.lastTickAgoS != null ? `, last ${fp.lastTickAgoS}s ago` : ""}${fp.lastError ? `, ${fp.lastError}` : ""}) · ${tokenText} · proxy ${fc.proxy}${fc.lastError ? ` · last problem: ${String(fc.lastError).slice(0, 160)}` : ""}`,
      { lastOk: fc.lastRead || null });
  }
  // This PC hands its Fomo sign-in token to the server (fomorelay.js): only shown where that is set up.
  if (relayStats.on) {
    const r = relayStats, age = r.lastSent ? now - r.lastSent : null;
    const f = r.feeds, fAge = f.lastSent ? now - f.lastSent : null;
    add("fomorelay", "Fomo relay (this PC to the server)", (r.lastError && (!age || age > 30 * MIN)) || (f.lastError && (!fAge || fAge > 2 * MIN)) ? "degraded" : age == null ? "idle" : "ok",
      `${r.to} · token: ${r.sent} sent${age != null ? `, last ${ago(r.lastSent)}` : ""}${r.lastExp ? `, good until ${new Date(r.lastExp).toISOString().slice(11, 16)} UTC` : ""}`
      + ` · feed: ${f.wanted.length ? `${f.wanted.length} filter set${f.wanted.length === 1 ? "" : "s"} wanted there, ` : "nobody looking there, "}${f.sent} sent${fAge != null ? `, last ${ago(f.lastSent)}` : ""}${f.bytes ? ` (${(f.bytes / 1e6).toFixed(1)} MB in all)` : ""}`
      + `${r.lastError ? ` · token problem: ${String(r.lastError).slice(0, 160)}` : ""}${f.lastError ? ` · feed problem: ${String(f.lastError).slice(0, 160)}` : ""}`,
      { lastOk: r.lastSent || null });
  }
  // Running narratives: the AI read made on this PC (running-ai.js), or the one the PC relayed to the server.
  { const st = runningAiStats, rel = runningAiState();
    if (st.on || st.runs) add("runningai", "Running narratives (AI read on this PC)", st.lastError && (!st.lastOk || now - st.lastOk > 10 * MIN) ? "degraded" : st.lastOk ? "ok" : "idle",
      `${st.runs} reads${st.lastOk ? `, last ${ago(st.lastOk)} (${st.stories} stories)` : ""}${st.sent ? ` · sent to the server ${st.sent}×, last ${ago(st.lastSent)}` : ""}${st.lastError ? ` · problem: ${String(st.lastError).slice(0, 140)}` : ""}${st.sendError ? ` · send problem: ${String(st.sendError).slice(0, 140)}` : ""}`, { lastOk: st.lastOk || null });
    else if (rel) add("runningai", "Running narratives (AI read from the owner's PC)", now - rel.at > 10 * MIN ? "degraded" : "ok", `${rel.stories.length} stories, last ${ago(rel.at)}${now - rel.at > 8 * MIN ? " · too old: Blix's own themes are used" : ""}`, { lastOk: rel.at }); }
  // The server's side of it: Fomo's feed as the owner's PC relays it (fomofeed.js relayIn); only shown once a post came.
  if (relayedStats.posts) {
    const age = now - relayedStats.lastAt;
    add("fomofeed", "Fomo's feed (relayed from the owner's PC)", age > 2 * MIN ? "degraded" : "ok",
      `${relayedStats.posts.toLocaleString()} posts from the PC, last ${ago(relayedStats.lastAt)} · ${relayedStats.keys} filter set${relayedStats.keys === 1 ? "" : "s"} fresh${age > 2 * MIN ? " · the PC has gone quiet: reading Fomo here instead" : ""}`,
      { lastOk: relayedStats.lastAt });
  }
  const scanAge = stats.lastCycle ? now - stats.lastCycle : null;
  add("scan", "Scan loop", scanAge == null ? "idle" : scanAge > 3 * MIN ? "down" : scanAge > 90_000 ? "degraded" : "ok",
    `Last full scan ${ago(stats.lastCycle)} · ${stats.errors} error${stats.errors === 1 ? "" : "s"} this session${health.gaps.length ? ` · paused ${health.gaps.length}× (PC asleep or stopped), last for ${Math.round((health.gaps.at(-1).to - health.gaps.at(-1).from) / MIN)}m` : ""}`,
    { ...hp("scan"), gaps: health.gaps.slice(-5) });
  const svc = (key, name, staleMs) => { const p = hp(key); add(key, name, health.stateOf(key, staleMs), p.lastOk ? `Last answer ${ago(p.lastOk)} · ${p.ok.toLocaleString()} ok, ${p.fail} failed${p.lastFail && p.lastFail > p.lastOk ? ` · failing: ${p.lastError}` : ""}` : p.lastError ? `Never answered: ${p.lastError}` : "Not used yet", p); };
  svc("dexscreener", "Prices (DexScreener)", 3 * MIN);
  svc("jupiter", "Quotes and prices (Jupiter)", 3 * MIN);
  // Keyless, quotes, Discover and Blix Vault's real swaps share one Jupiter allowance on this PC.
  { const j = parts[parts.length - 1]; if (j.state !== "ok" && !settings.jupiterKey) j.fix = "Jupiter is rate-limiting this PC's free allowance. A free API key from portal.jup.ag (Settings → Jupiter key) gives quotes, prices and swaps their own allowance."; }
  svc("geckoterminal", "Discovery (GeckoTerminal)", 10 * MIN);
  svc("rugcheck", "Safety checks (RugCheck)", 30 * MIN);

  // Is every tracked coin's price actually current?
  const active = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN COALESCE(price_t, updated, 0) < ? THEN 1 ELSE 0 END) stale FROM tokens WHERE status = 'active' AND pair IS NOT NULL").get(now - 6 * MIN);
  const flagged = db.prepare("SELECT COUNT(*) n FROM tokens WHERE status = 'active' AND quarantine IS NOT NULL").get().n;
  add("freshness", "Price freshness", !active.n ? "idle" : active.stale / active.n > 0.5 ? "down" : active.stale / active.n > 0.1 ? "degraded" : "ok",
    `${(active.n - (active.stale || 0)).toLocaleString()} of ${active.n.toLocaleString()} tracked coins priced in the last 6 minutes · ${flagged} flagged as unreliable (emptied pools) and kept out of signals`, { stale: active.stale || 0, flagged });

  const tr = wallets.tracking();
  const rpc = tr.rpc, cooling = rpc.coolingUntil > now;
  add("rpc", `Solana RPC (${rpc.public ? "free public" : "your own"})`, cooling ? "degraded" : health.stateOf("rpc", 5 * MIN),
    `${rpc.calls.toLocaleString()} calls · ${rpc.errors} errors · rate limited ${rpc.limited}×${cooling ? ` · resting ${Math.ceil((rpc.coolingUntil - now) / 1000)}s` : ""}${rpc.lastError ? ` · last problem ${ago(rpc.lastErrorAt)}: ${rpc.lastError}` : ""}`,
    { lastOk: rpc.lastOk || null, lastFail: rpc.lastErrorAt || null, lastError: rpc.lastError, fix: rpc.public && rpc.limited > 5 ? "The free public RPC is throttling. A free Helius RPC URL in Settings reads wallets about 10x faster and rarely limits." : null });
  const lagged = tr.wallets.filter((w) => now - w.checked > 5 * MIN).length, missed = tr.wallets.reduce((s, w) => s + (w.missed || 0), 0);
  add("wallets", "Wallet tracking", !tr.wallets.length ? "off" : !tr.stream.connected ? "degraded" : lagged > tr.wallets.length / 3 ? "degraded" : "ok",
    !tr.wallets.length ? "No wallets followed" : `${tr.stream.connected ? `Live stream on ${tr.stream.wallets} of ${tr.wallets.length} wallets, ${tr.stream.events.toLocaleString()} events` : "Live stream down (polling only, minutes behind)"} · ${tr.backlog} transactions waiting to be read · ${lagged} wallet${lagged === 1 ? "" : "s"} not checked in 5+ min · ${missed} transactions known missed`,
    { lastOk: tr.stream.lastEvent || tr.stream.since || null, lastError: tr.stream.error, stream: tr.stream, backlog: tr.backlog, missed });

  const pv = research.providers(), qs = research.queueStatus();
  add("grok", "Grok (fast reads, deep reads, narrative scout)", !pv.grok.installed ? "off" : pv.grok.blocked ? "down" : pv.grok.ok ? (pv.grok.calls ? "ok" : "idle") : "degraded",
    !pv.grok.installed ? "Not logged in on this PC" : pv.grok.blocked ? `${pv.grok.blocked}${pv.grok.blockedSince ? ` since ${ago(pv.grok.blockedSince)}` : ""}; next re-check ${pv.grok.blockedUntil ? `in ${Math.max(1, Math.round((pv.grok.blockedUntil - now) / MIN))}m` : "soon"} · ${pv.grok.errors} errors` : `${pv.grok.calls} calls, ${pv.grok.errors} errors this session`,
    { lastOk: pv.grok.lastOk, lastFail: pv.grok.lastErrorAt, lastError: pv.grok.lastError, fix: pv.recovery });
  // What Grok has cost today, by job, against the daily budget; and what the subscription itself reports.
  const sp = pv.grok.spend, bill = pv.grok.billing;
  if (pv.grok.installed && sp) {
    const lanes = Object.entries(sp.lanes).sort((a, b) => b[1].usd - a[1].usd).map(([k, v]) => `${k} $${v.usd.toFixed(2)} (${v.calls})`).join(", ");
    add("grok-spend", "Grok spend today", sp.budget && sp.today >= sp.budget ? "degraded" : "ok",
      `$${sp.today.toFixed(2)}${sp.budget ? ` of the $${sp.budget.toFixed(2)} daily budget` : " (no daily limit set)"}${lanes ? ` · ${lanes}` : ""}${bill?.used != null ? ` · the subscription reports ${bill.used} used this billing period` : ""}`,
      { spend: sp, billing: bill || null, fix: sp.budget && sp.today >= sp.budget ? "Grok is paused until midnight; Claude is covering. Raise the daily Grok budget in Settings to give it more." : null });
  }
  add("tape", "Price tapes (for replay)", tapeStats.lastFlush && now - tapeStats.lastFlush > 5 * MIN ? "degraded" : "ok",
    `${tapeStats.recording} coins being recorded second by second · ${tapeStats.flushed.toLocaleString()} bars saved this session`, { lastOk: tapeStats.lastFlush });
  try {
    const cv = coverageStats(), L = cv.launches || {};
    add("coverage", "Coverage (every coin that trades)", !liveFeed.connected ? "degraded" : "ok",
      `${((L.pumpportal || 0) + (L.chainOnly || 0)).toLocaleString()} launches (${(L.chainOnly || 0).toLocaleString()} only seen on chain; PumpPortal missed them) · ${(backfill.added + backfill.indexed).toLocaleString()} filled in from pump.fun's newest list (${backfill.added} as launches)${backfill.error ? ` · backfill: ${backfill.error}` : ""} · ${(cv.moving5m || 0).toLocaleString()} coins moving now of ${(cv.trading5m || 0).toLocaleString()} trading`, { stats: cv, backfill });
  } catch {}
  const labAge = labStats.lastMsg ? now - labStats.lastMsg : null;
  add("launchlab", "Bonk / LaunchLab trade feed", !labStats.connected ? "down" : labAge > 60_000 ? "degraded" : "ok",
    !labStats.connected ? `Not connected${labStats.error ? `: ${labStats.error}` : ""}` : `${labStats.trades.toLocaleString()} trades and ${labStats.creates.toLocaleString()} launches read this session, last message ${ago(labStats.lastMsg)} · ${labStats.waiting} pools waiting to be identified · ${labStats.unpriced} quote tokens with no price yet (their pools wait) · no trader or holder counts (the feed does not say who traded)`,
    { lastOk: labStats.lastMsg || null, lastError: labStats.error, stats: labStats });
  add("holders", "Holder ledger (from the trade feed)", !liveFeed.connected ? "degraded" : "ok",
    `${holderStats.books.toLocaleString()} coins with a live ledger (${holderStats.wallets.toLocaleString()} wallets) · ${holderStats.genesis.toLocaleString()} seen from their first trade, ${holderStats.partial.toLocaleString()} joined late (no sniper/bundle figures for those) · ${holderStats.unknownSells.toLocaleString()} sells of tokens the radar never saw bought`, { stats: holderStats });
  const tn = tunnelStats;
  add("tunnel", "Remote access (blixvip.com/trade)", !settings.publicHost || !settings.tunnelKey ? "off" : !tn.exe ? "down" : tn.url && tn.registered && !tn.registerError ? "ok" : "degraded",
    !settings.publicHost || !settings.tunnelKey ? "Switched off (no public hostname or tunnel key)" : !tn.exe ? "cloudflared is not installed on this PC" : tn.url ? `https://${settings.publicHost} → ${tn.url}${tn.registered ? ` · registered ${ago(tn.registered)}` : ""}${tn.registerError ? ` · register failing: ${tn.registerError}` : ""} · ${tn.restarts} tunnel restarts` : `Tunnel starting${tn.lastExit ? ` (cloudflared exited with ${tn.lastExit.code} ${ago(tn.lastExit.t)})` : ""}`,
    { lastOk: tn.registered, lastError: tn.registerError || tn.lastError, url: tn.url });
  const pd = paper.desk();
  add("paper", "Paper desk", pd.open.some((p) => p.stale) ? "degraded" : pd.open.length ? "ok" : "idle",
    `${pd.open.length} open paper position${pd.open.length === 1 ? "" : "s"}${pd.open.some((p) => p.stale) ? ` (${pd.open.filter((p) => p.stale).length} without a live price right now)` : ""} · today ${pd.summary.todayN} closed, ${pd.summary.todayPnl >= 0 ? "+" : "−"}$${Math.abs(pd.summary.todayPnl).toFixed(0)} · all time ${pd.summary.allN} closed, ${pd.summary.allPnl >= 0 ? "+" : "−"}$${Math.abs(pd.summary.allPnl).toFixed(0)} (after ${pd.cost}% costs each way; nothing is really traded)`);
  add("groq", "Groq (optional fast fallback)", !pv.groq.configured ? "off" : pv.groq.cooling.length ? "degraded" : health.stateOf("groq", HOUR),
    pv.groq.configured ? `${pv.groq.calls} calls, ${pv.groq.errors} errors` : "No key saved. Free at console.groq.com/keys; keeps fast reads running when Grok is out.", { ...hp("groq"), lastError: pv.groq.lastError });
  add("claude", "Claude (briefs, fallback reads)", !pv.claude.ok ? (/No Claude login/.test(pv.claude.loginError || "") ? "off" : "down") : health.stateOf("claude", 3 * HOUR) === "down" ? "degraded" : pv.claude.calls ? health.stateOf("claude", 3 * HOUR) : "idle",
    pv.claude.ok ? `${pv.claude.calls} calls, ${pv.claude.errors} errors, ${pv.claude.truncated} cut off · ${pv.claude.usedThisHour}/${pv.claude.perHour} research reads this hour` : pv.claude.loginError,
    { lastOk: pv.claude.lastOk, lastFail: pv.claude.lastErrorAt, lastError: pv.claude.lastError, fix: pv.claude.ok ? null : "Open Claude Code once on this PC to refresh the login." });
  add("ai-lanes", "Who is reading coins right now", pv.fast.fallback || pv.deep.fallback ? "degraded" : "ok",
    `First reads: ${pv.fast.actualName || "none available"}${pv.fast.fallback ? ` (set to ${pv.fast.configuredName}; ${pv.fast.reason})` : ""} · Deep reads: ${pv.deep.actualName || "none available"}${pv.deep.fallback ? ` (set to ${pv.deep.configuredName}; ${pv.deep.reason})` : ""}`, { fix: pv.recovery });
  add("queue", "Research queue", !qs.perHour && qs.size ? "down" : "ok",
    `${qs.size} waiting (limit ${qs.cap}), oldest ${qs.oldestMin}m · about ${qs.perHour} reads/hour, so ~${qs.etaMin ?? "?"}m to clear · ${qs.expiredHour} dropped as stale or outranked this hour · ${qs.errors} failed in 24h`, qs);
  const sc = brain.scoutStatus();
  add("scout", "Narrative scout", settings.scoutEveryMin <= 0 ? "off" : !sc.available ? "down" : sc.overdue ? "degraded" : "ok",
    sc.why || `Last scouted ${ago(sc.lastOk)}, every ${sc.every}m`, { lastOk: sc.lastOk, lastError: sc.last?.outcome !== "ok" ? sc.last?.detail : null });
  const cb = clusterBoard();
  add("clusters", "Live narrative detection", cb.stats.lastError && !cb.stats.cards ? "degraded" : "ok",
    `${cb.stats.launches.toLocaleString()} launches compared this session · ${cb.stats.forming} burst${cb.stats.forming === 1 ? "" : "s"} forming now · ${cb.stats.cards} named · ${cb.armed.length} narrative${cb.armed.length === 1 ? "" : "s"} armed, ${cb.stats.armedHits} matching launches caught${cb.grok ? "" : " · Grok is unavailable, so bursts are recorded but not looked up on X"}`,
    { lastError: cb.stats.lastError });
  const lb = db.prepare("SELECT t, status, stop FROM briefs ORDER BY t DESC LIMIT 1").get();
  add("briefs", "AI briefs", !settings.aiBriefs ? "off" : !lb ? "idle" : lb.status !== "complete" ? "degraded" : now - lb.t > settings.briefEveryMin * MIN * 2.5 ? "degraded" : "ok",
    !settings.aiBriefs ? "Switched off" : !lb ? "None written yet" : `Last brief ${ago(lb.t)}${lb.status !== "complete" ? ` was incomplete (${lb.stop})` : ""}`, { lastOk: lb?.t || null });

  const dest = destinations();
  for (const ch of ["discord", "telegram"]) {
    const d = dest[ch], failing = d.lastFail && (!d.lastOk || d.lastFail.t > d.lastOk.t);
    add(ch, ch === "discord" ? "Discord alerts" : "Telegram alerts", !d.configured ? "off" : failing ? "down" : d.lastOk ? "ok" : "idle",
      !d.configured ? "Not set up" : failing ? `Last send failed ${ago(d.lastFail.t)}: ${d.lastFail.error}` : d.lastOk ? `Last delivered ${ago(d.lastOk.t)} · ${d.sent24h} sent, ${d.failed24h} failed in 24h` : "Set up, nothing sent yet. Use Send test message.",
      { lastOk: d.lastOk?.t || null, lastFail: d.lastFail?.t || null, lastError: d.lastFail?.error || null });
  }
  if (!dest.any) add("delivery", "Alert delivery", "degraded", "No Discord or Telegram destination is set up, so alerts only reach this browser while the page is open.", { fix: "Add a Discord webhook or Telegram bot in Settings to get alerts on your phone and when the page is closed." });
  const fs_ = fomo.status();
  add("fomo", "Fomo trade tracking", fs_.connected ? "ok" : "off", fs_.connected ? `${fs_.tradesLastHour} Fomo trades seen this hour${fs_.sampled ? " (sampled)" : ""}` : `Not connected: ${fs_.fomoWallets ? `${fs_.fomoWallets} Fomo wallet added, still learning Fomo's fee payer` : "add one Fomo wallet on the Wallets page"}. Buy on Fomo links work either way.`);
  const bt = +meta.get("backup_t", 0);
  add("backup", "Backups", !bt ? "idle" : now - bt > 2.5 * DAY ? "degraded" : "ok", bt ? `Last backup ${ago(bt)} · ${backups().length} kept in data/backups` : "No backup yet (one is made automatically each day)", { lastOk: bt || null });

  const rankOf = { down: 3, degraded: 2, idle: 0, off: 0, ok: 0 };
  const worst = parts.reduce((w, p) => (rankOf[p.state] > rankOf[w] ? p.state : w), "ok");
  return { t: now, startedAt: stats.startedAt, issues: parts.filter((p) => p.state === "down" || p.state === "degraded").length, worst, parts, events: db.prepare("SELECT * FROM events WHERE kind IN ('error', 'system') ORDER BY id DESC LIMIT 25").all() };
}

// ---------- backup / export ----------
function exportData(withSecrets) {
  const all = (sql) => db.prepare(sql).all();
  const s = { ...settings };
  // The keys the Worker and the page server prove each other with never leave, secrets asked for or not: a
  // backup file travels (shared, pasted, synced) and with memberKey anyone can act as the owner.
  for (const k of PRIVATE) delete s[k];
  if (!withSecrets) for (const k of SECRETS) delete s[k];
  return {
    app: "meme-radar", version: 2, exportedAt: new Date().toISOString(), secretsIncluded: Boolean(withSecrets), settings: s,
    wallets: all("SELECT address, label, source, watching, fomo FROM wallets"), fomoHandles: all("SELECT wallet, handle FROM fomo_handles"),
    alertRules: all("SELECT scope, target, effect, note FROM alert_rules"), playbooks: all("SELECT * FROM playbook"),
    tokenOverrides: all("SELECT mint, class_user, themes_user FROM tokens WHERE class_user IS NOT NULL OR themes_user IS NOT NULL"),
  };
}
function importData(d) {
  if (d?.app !== "meme-radar") throw Object.assign(new Error("That file is not a Blix export."), { status: 400 });
  const done = { wallets: 0, rules: 0, settings: 0 };
  if (d.settings) { saveSettings(d.settings); done.settings = Object.keys(d.settings).length; }
  for (const w of d.wallets || []) {
    try { wallets.addWallet(w.address, w.label || "", w.source === "you" ? "you" : w.source || "you"); if (w.fomo) db.prepare("UPDATE wallets SET fomo = 1 WHERE address = ?").run(w.address); if (!w.watching) wallets.updateWallet(w.address, { watching: false }); done.wallets++; } catch {}
  }
  for (const h of d.fomoHandles || []) db.prepare("INSERT INTO fomo_handles (wallet, handle) VALUES (?, ?) ON CONFLICT(wallet) DO UPDATE SET handle = excluded.handle").run(String(h.wallet), String(h.handle));
  for (const r of d.alertRules || []) { try { rules.set(r.scope, r.target, r.effect, r.note); done.rules++; } catch {} }
  for (const p of d.playbooks || []) db.prepare("INSERT OR IGNORE INTO playbook (version, t, rules, changes, notes, scorecard, tuning, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(p.version, p.t, p.rules, p.changes, p.notes, p.scorecard, p.tuning, p.model);
  for (const o of d.tokenOverrides || []) db.prepare("UPDATE tokens SET class_user = ?, themes_user = ? WHERE mint = ?").run(o.class_user || null, o.themes_user || null, o.mint);
  return done;
}

// ---------- http ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
// JSON answers go out compressed when the browser takes it (every current one does): /api/pulse alone is ~180 KB
// raw, read every few seconds, which matters through the tunnel. Brotli at a fast level, else gzip; small
// answers as they are.
const send = (res, code, body) => {
  const json = JSON.stringify(body), headers = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  const accepts = String(res.req?.headers["accept-encoding"] || "");
  if (json.length < 1024 || !accepts) { res.writeHead(code, headers); return res.end(json); }
  const enc = /\bbr\b/.test(accepts) ? "br" : /\bgzip\b/.test(accepts) ? "gzip" : null;
  if (!enc) { res.writeHead(code, headers); return res.end(json); }
  const zip = enc === "br" ? zlib.brotliCompressSync(json, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: json.length > 500_000 ? 2 : 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: json.length } })
    : zlib.gzipSync(json, { level: json.length > 500_000 ? 1 : 4 });
  res.writeHead(code, { ...headers, "content-encoding": enc, vary: "accept-encoding" });
  res.end(zip);
};
// A JSON body, at most 2 MB; gzipped when the sender says so (the owner's PC relaying Fomo's feed, fomorelay.js).
// Too big: both streams stop and it answers {} (it used to never answer, and the gunzip kept inflating).
const readBody = (req) => new Promise((ok) => {
  let b = "", done = false;
  const end = (v) => { if (!done) { done = true; ok(v); } };
  const from = /gzip/i.test(String(req.headers["content-encoding"] || "")) ? req.pipe(zlib.createGunzip()).on("error", () => end({})) : req;
  from.on("data", (c) => { if (done) return; b += c; if (b.length > 2e6) { b = ""; end({}); if (from !== req) from.destroy(); req.destroy(); } });
  from.on("end", () => { try { end(JSON.parse(b || "{}")); } catch { end({}); } });
});
// The page only ever loads its own script; coin names, descriptions and links are untrusted text.
const PAGE_HEADERS = {
  "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src * data:; frame-src https://dexscreener.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
};
// The radar answers this PC, plus one public hostname reached through a Cloudflare Tunnel (settings.publicHost).
// A page on another site (or a hostname pointed at 127.0.0.1) must not be able to read settings or change
// them through the browser: the Host and Origin must be one of ours.
const LOCAL = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const hostOf = (req) => String(req.headers.host || "").toLowerCase();
// Public = the configured hostname, or the quick tunnel's own trycloudflare.com address (the Worker on the
// public hostname forwards through it and says so in x-forwarded-host).
const isPublicHost = (req) => { const h = hostOf(req); return Boolean(settings.publicHost) && (h === settings.publicHost.toLowerCase() || /\.trycloudflare\.com$/.test(h)); };
function allowed(req) {
  const host = hostOf(req);
  if (!LOCAL.has(host) && !isPublicHost(req)) return false;
  const origin = req.headers.origin;
  if (origin) { const oh = origin.replace(/^https?:\/\//, "").toLowerCase(); if (!LOCAL.has(oh) && oh !== host && oh !== String(settings.publicHost || "").toLowerCase()) return false; }
  return req.method === "GET" || req.headers["sec-fetch-site"] === undefined || ["same-origin", "none"].includes(req.headers["sec-fetch-site"]);
}
// Through the tunnel the page is on the open internet, so a browser has to present the remote key once
// (?key=…), which is then kept in a cookie for a year. The key is generated on first start and shown on the
// Settings page of the local copy. Local pages never need it.
import crypto from "node:crypto";
if (!settings.remoteKey) saveSettings({ remoteKey: crypto.randomBytes(24).toString("base64url") });
const cookieOf = (req, name) => (String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1] || null;
const safeEq = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function remoteGate(req, res, url) {
  if (!isPublicHost(req)) return false;
  const key = url.searchParams.get("key");
  if (key && safeEq(key, settings.remoteKey)) {
    // Key accepted: keep it in a cookie and reload the page without it in the address bar.
    url.searchParams.delete("key");
    res.writeHead(302, { location: url.pathname + (url.search || ""), "set-cookie": `blix_key=${settings.remoteKey}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`, "cache-control": "no-store" });
    res.end();
    return true;
  }
  if (safeEq(cookieOf(req, "blix_key"), settings.remoteKey)) return false;
  // Open to everyone: no key needed, but this request is a visitor's and may only read (access.js).
  if (settings.publicMode) { req.visitor = true; return false; }
  if (url.pathname.startsWith("/api/")) { send(res, 401, { error: "Blix remote: key required." }); return true; }
  res.writeHead(401, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blix</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1117;color:#e6e8ef;font:15px system-ui,sans-serif}form{display:grid;gap:10px;width:min(320px,90vw)}h1{font-size:18px;margin:0 0 4px}input,button{font:inherit;padding:10px 12px;border-radius:6px;border:1px solid #3a3f4d;background:#171a22;color:inherit}button{background:#e6e8ef;color:#0f1117;font-weight:600;cursor:pointer}small{color:#8b90a0}</style>
<form method="get" action="/"><h1>Blix</h1><small>This is the live terminal on Kai's PC. Enter the access key.</small><input name="key" type="password" placeholder="Access key" autofocus autocomplete="current-password"><button>Open</button></form>`);
  return true;
}
// Only a local page may read the remote link (it contains the key).
const remoteLink = () => settings.publicHost ? `https://${settings.publicHost}/?key=${settings.remoteKey}` : null;

// Static files from memory (re-checked at most every 2s), and short-lived caches for the heavy API views,
// so pages answer instantly even when the PC is busy or paging.
const statics = new Map();
function staticFile(file) {
  const c = statics.get(file);
  if (c && Date.now() - c.checked < 2000) return c.body;
  const mtime = fs.statSync(file).mtimeMs;
  if (c && c.mtime === mtime) { c.checked = Date.now(); return c.body; }
  const body = fs.readFileSync(file);
  statics.set(file, { body, mtime, checked: Date.now() });
  return body;
}
const memo = new Map();
// Discover's unfiltered lists, as web/src/pages/Coins.tsx listPath() asks for each tab (same parameters, same
// order, so the same `tokens?...` cache entries). { tf, t, tabs: { trending|surge|new|bonded: { rows, total } } }.
const DISCOVER_SORT = { trending: { "5m": "vol5", "1h": "volume", "24h": "vol24" }, surge: { "5m": "chg5", "1h": "change", "24h": "chg24" }, new: { "5m": "new", "1h": "new", "24h": "new" }, bonded: { "5m": "new", "1h": "new", "24h": "new" } };
const SURGE_FLOOR = { "5m": ["minVol5", "500"], "1h": ["minVol", "5000"], "24h": ["minVol24", "20000"] };
// A row as Discover draws it (web/src/pages/discover/parts.tsx Row): about half the bytes of the full row.
const DISCOVER_KEYS = ["mint", "symbol", "name", "image", "dex", "pair_created", "first_seen", "mcap", "liquidity", "vol_m5", "vol_h1", "vol_h24",
  "buys_m5", "sells_m5", "buys_h1", "sells_h1", "chg_m5", "chg_h1", "chg_h24", "links", "boosts", "header", "graduated", "safety_score", "score", "paid",
  "figSrc", "dupes", "dupTop", "peak_mcap", "quarantine", "status", "spark", "spark_chg", "mc_live", "snipers", "bundlers"];
const discoverRows = new WeakMap();
function discoverRow(r) {
  let o = discoverRows.get(r);
  if (o) return o;
  o = {};
  for (const k of DISCOVER_KEYS) if (r[k] !== undefined) o[k] = r[k];
  const s = r.safety, f = r.fresh;
  o.safety = s ? { danger: s.danger, warn: s.warn, top10: s.top10, devPct: s.devPct, insiderPct: s.insiderPct, totalHolders: s.totalHolders } : null;
  if (f) o.fresh = { stale: f.stale, dead: f.dead, illiquid: f.illiquid, exitable: f.exitable };
  discoverRows.set(r, o);
  return o;
}
// Discover's lists rank by the live trade feed, like Axiom's: the database's volume and change columns come from
// DexScreener scans about once a minute, so lists sorted by them sat still for 15-60 s and then jumped. Each
// list takes its usual candidates plus every coin traded in the last two minutes, and orders them by what the
// feed says now (volume in the window; change from the live line), falling back to the scanned figure.
const DB_VOL = { "5m": "vol_m5", "1h": "vol_h1", "24h": "vol_h24" }, DB_CHG = { "5m": "chg_m5", "1h": "chg_h1", "24h": "chg_h24" };
function hotMints(tf, n = 150) {
  const fromS = Date.now() / 1000 - (SPARK_WIN[tf] || HOUR) / 1000, out = [];
  for (const [m, c] of liveCurves) {
    if (!c || Date.now() - c.last > 2 * MIN) continue;
    const w = windowStats(m, fromS);
    if (w && w.vol > 0) out.push([m, w.vol]);
  }
  return out.sort((a, b) => b[1] - a[1]).slice(0, n).map((x) => x[0]);
}
// The 50 a ranked list shows, with give at the cut: a coin already shown stays while it ranks in the top 65, a new
// one comes in once it ranks in the top 45 (or to fill the list), and the best 50 of those show, in rank order.
// Ranked by live volume or change every 1.5 s, the coins around 50th swapped in and out every few seconds (a row
// vanishing and coming back on the page).
const stuck = new Map();   // list -> mints shown last time
function sticky(key, ranked, mintOf, n = 50, enter = 45, give = 65) {
  const was = stuck.get(key) || new Set(), near = ranked.slice(0, give);
  const pick = new Set(near.filter((x, i) => i < (was.has(mintOf(x)) ? give : enter)).slice(0, n));
  for (const x of near) { if (pick.size >= n) break; pick.add(x); }
  const out = near.filter((x) => pick.has(x));
  stuck.set(key, new Set(out.map(mintOf)));
  return out;
}
function discoverLists(tfParam) {
  const tf = tfParam === "5m" || tfParam === "24h" ? tfParam : "1h", tabs = {};
  const hot = hotMints(tf);
  const hotRows = hot.length ? cached(`discover:hot:${tf}:${hot.length}:${hot.slice(0, 5).join(",")}`, 1500, () => tokensQuery({ mints: hot.join(","), limit: "200", spark: tf }).rows) : [];
  for (const tab of Object.keys(DISCOVER_SORT)) {
    const q = { sort: DISCOVER_SORT[tab][tf], dir: "desc", limit: tab === "trending" || tab === "surge" ? "150" : "50" };
    if (tab === "bonded") q.graduated = "1";
    if (tab === "surge") q[SURGE_FLOOR[tf][0]] = SURGE_FLOOR[tf][1];
    if (tab === "trending") q.minLiq = "5000";
    q.spark = tf;
    const search = `?${new URLSearchParams(q)}`;
    const r = cached(`tokens${search}`, 5000, () => tokensQuery(q));
    let rows = r.rows;
    if (tab === "trending" || tab === "surge") {
      // Hot coins join only if they are what the list would show anyway: live, believable, with a pool.
      const seen = new Set(rows.map((t) => t.mint));
      const extra = hotRows.filter((t) => !seen.has(t.mint) && t.status === "active" && !t.quarantine && t.pair && (tab !== "trending" || (t.liquidity || 0) >= 5000));
      const all = [...rows, ...extra].map((t) => { let live = null; try { live = liveRow(t, tf); } catch {} return { t, live, vol: live?.vol ?? t[DB_VOL[tf]] ?? 0, chg: t.spark_chg ?? t[DB_CHG[tf]] ?? null }; });
      const floor = tab === "surge" ? +SURGE_FLOOR[tf][1] : 0;
      // A coin already on Surge stays down to half the volume floor (its 5 min window slides, and one quiet minute
      // took it off and the next trade put it back).
      const shown = stuck.get(`${tab}:${tf}`);
      const ranked = all.filter((x) => tab !== "surge" || ((x.vol || 0) >= (shown?.has(x.t.mint) ? floor / 2 : floor) && x.chg != null))
        .sort((a, b) => (tab === "trending" ? b.vol - a.vol : b.chg - a.chg));
      rows = sticky(`${tab}:${tf}`, ranked, (x) => x.t.mint).map((x) => { const row = discoverRow(x.t); row.live = x.live; return row; });
      tabs[tab] = { rows, total: Math.max(r.total, rows.length) };
      continue;
    }
    // New and Bonded also take the launches and migrations the live feed saw this minute (Pulse's columns): a
    // coin enters the token table only once DexScreener lists its pool, a minute or more after launch.
    let list = rows.map((t) => { const row = discoverRow(t); try { row.live = liveRow(t, tf); } catch {} return row; });
    try {
      const pd = pulseData(), have = new Set(list.map((x) => x.mint)), now = Date.now();
      const fromPulse = (tab === "new" ? [...pd.newPairs, ...pd.stretch] : pd.migrated).filter((c) => c?.mint && !have.has(c.mint) && c.state !== "faded").map((c) => {
        const born = now - (c.age || 0), dex = c.dex || (c.pool === "pump" ? (c.graduated ? "pumpswap" : "pumpfun") : c.pool || null);
        const t = { mint: c.mint, symbol: c.symbol, name: c.name, image: c.image, dex, pair_created: born, first_seen: born, mcap: c.mcap, liquidity: c.liq,
          graduated: tab === "bonded" || Boolean(c.graduated), status: "active",
          links: [c.x && { type: "twitter", url: /^https?:/.test(c.x) ? c.x : `https://x.com/${c.x}` }, c.web && { type: "website", url: c.web }, c.tg && { type: "telegram", url: c.tg }].filter(Boolean) };
        const row = discoverRow(t); try { row.live = liveRow(t, tf); } catch {} return row;
      });
      list = [...list, ...fromPulse].sort((a, b) => (b.pair_created || b.first_seen || 0) - (a.pair_created || a.first_seen || 0)).slice(0, 50);
    } catch {}
    // Each row carries its live figures (the same as /api/sparks gives), so a page opening on this list draws
    // current numbers at once instead of the list's and then a jump when the live overlay lands.
    tabs[tab] = { rows: list, total: Math.max(r.total, list.length) };
  }
  // Every row carries its Fomo known holders ([count, faces]; fomoboard.js keeps these coins read in the
  // background), so the page draws the faces with the row instead of asking for them after.
  for (const t of Object.values(tabs)) for (const row of t.rows) { try { row.known = fomoBoard.knownOf(row.mint); } catch { row.known = null; } }
  return { tf, t: Date.now(), tabs };
}
function cached(key, ms, fn) {
  const c = memo.get(key);
  if (c && Date.now() - c.t < ms) return c.v;
  const v = fn();
  // Keys carry request parameters (and Discover's hot list changes every few seconds), and only a POST used to
  // empty the map: on a copy nobody POSTs to it grew by hundreds of MB an hour. Old answers go once it gets big.
  if (memo.size > 400) { const old = Date.now() - 2 * MIN; for (const [k, x] of memo) if (x.t < old) memo.delete(k); }
  memo.set(key, { t: Date.now(), v });
  return v;
}
const forget = (prefix) => { for (const k of memo.keys()) if (k.startsWith(prefix)) memo.delete(k); };

const clients = new Set();
// `who`: only that person's streams ('' the owner's, a member's email), for what is theirs alone.
function broadcast(event, data, who) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  // A visitor (public view) reaches here as the owner ('' too), so is left out of everything addressed to someone.
  for (const res of clients) if (who === undefined || (!res.blixVisitor && (res.blixAs || "") === who)) (res.blixOut || res.write).call(res, msg);
}

const paceBook = new Map();   // key -> { t: window start, n }
function overPace(key, perMin) {
  const t = Date.now(), e = paceBook.get(key);
  if (!e || t - e.t > 60_000) { paceBook.set(key, { t, n: 1 }); if (paceBook.size > 5000) paceBook.clear(); return false; }
  return ++e.n > perMin;
}
// A member's request comes from the page server (webapp.js) with x-blix-as: their email. It runs as them (their own
// paper desk) and may only do what a member may. Only a request from this PC can carry it.
const server = http.createServer((req, res) => {
  const as = LOCAL.has(hostOf(req)) ? String(req.headers["x-blix-as"] || "").toLowerCase() : "";
  delete req.headers["x-blix-as"];
  if (!as && LOCAL.has(hostOf(req)) && req.headers["x-blix-visitor"] === "1") res.blixVisitor = true;
  delete req.headers["x-blix-visitor"];
  if (as) {
    const p0 = new URL(req.url, "http://x").pathname;
    if (!memberMay(req.method, p0)) return send(res, 403, { error: "Members can't use this part of Blix." });
    // What costs the server real work or an outside call per request (quotes and sell previews ask Jupiter;
    // trades re-price every second; a chart focuses live prices on a coin) is paced per member: 40 quotes,
    // 20 paper trades and 30 chart focuses a minute.
    const kind = p0 === "/api/quote" || /^\/api\/paper\/\d+\/preview$/.test(p0) ? "q" : req.method !== "GET" && p0.startsWith("/api/paper") ? "t" : p0.startsWith("/api/candles/") ? "c" : null;
    if (kind && overPace(`${kind}:${as}`, kind === "q" ? 40 : kind === "c" ? 30 : 20)) return send(res, 429, { error: "Slow down a little: too many requests in the last minute." });
    // A fresh read of a Fomo profile goes out with the owner's own Fomo login: members get what is on record.
    if (p0.startsWith("/api/fomo/trader/") && /[?&]fresh=/.test(req.url)) { const u = new URL(req.url, "http://x"); u.searchParams.delete("fresh"); req.url = u.pathname + u.search; }
    res.blixAs = as;
  }
  return paper.asUser(as, () => handleRequest(req, res));
});
async function handleRequest(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const params = Object.fromEntries(url.searchParams);
  try {
    if (!allowed(req)) return send(res, 403, { error: "Blix only answers this PC and its own public hostname." });
    if (remoteGate(req, res, url)) return;
    if (req.visitor) res.blixVisitor = true;
    if (req.visitor && !visitorMay(req.method, p)) return send(res, 403, { error: "This is the public view of Blix: it is read-only." });
    // mcpScript: where the MCP server lives on this PC, so the MCP page can show ready-to-paste setup (never to visitors).
    if (p === "/api/me") return send(res, 200, { readonly: Boolean(req.visitor), ...(req.visitor ? {} : { mcpScript: path.join(ROOT, "mcp", "blix-mcp.mjs") }) });
    if (req.visitor && p === "/api/health") return send(res, 200, visitorHealth(cached("health", 4000, healthReport)));
    if (p === "/api/remote-link") return LOCAL.has(hostOf(req)) ? send(res, 200, { host: settings.publicHost || null, link: remoteLink() }) : send(res, 403, { error: "local only" });
    const pic = p.match(/^\/img\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (pic) return await images.serve(pic[1], res);
    // Logos in bulk for the page (lib/pics.ts): ?m=<mint>,<mint>,…  →  { mint: data URL | null }
    if (p === "/api/pics") return send(res, 200, await images.batch(String(params.m || "").split(",").filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m))));
    if (!p.startsWith("/api/")) {
      const file = path.join(PUBLIC, p === "/" ? "index.html" : p);
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(200, { "content-type": TYPES[".html"], ...PAGE_HEADERS }); return res.end(staticFile(path.join(PUBLIC, "index.html")));
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", ...PAGE_HEADERS });
      return res.end(staticFile(file));
    }
    if (p === "/api/stream") {
      // no-transform keeps proxies from compressing the stream; the 2 KB comment pushes it through any proxy
      // that waits for a first block. (The public quick tunnel still holds streamed bodies back ~20 s whatever
      // is sent, so the page falls back to polling there; see connect() in app.js.)
      // A member keeps three live streams at most (a few tabs); each costs a write per trade tick for as long as
      // it is open. The owner's own are not counted.
      if (res.blixAs && [...clients].filter((c) => c.blixAs === res.blixAs).length >= 3) return send(res, 429, { error: "Too many open Blix tabs: close one." });
      // Gzipped for a browser that takes it (one deflate stream per page, flushed after every event, as
      // feedstream.js): measured on blixvip.com, the raw stream was ~26 KB/s (trades, prices and logos as data URLs)
      // and held every list and picture on a slow line behind it. The page server asks for it uncompressed for
      // this PC's own pages (webapp.js toRadar).
      const gzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", ...(gzip ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}) });
      if (gzip) {
        const gz = zlib.createGzip({ level: 5 });
        gz.pipe(res);
        res.blixOut = (text) => { if (!gz.destroyed) { gz.write(text); gz.flush(zlib.constants.Z_SYNC_FLUSH); } };
        req.on("close", () => gz.destroy());
      }
      (res.blixOut || res.write).call(res, `:${" ".repeat(2048)}\n\nevent: hello\ndata: {}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    const POST = req.method === "POST";
    // A write empties the kept answers, except the PC's relays and page error reports: those change nothing the
    // answers hold, and arriving every few seconds they emptied every cache as fast as it filled.
    if ((POST || req.method === "DELETE") && !/^\/api\/(fomo\/(coin|feed)\/relay|running\/ai|client-error)$/.test(p)) forget("");
    if (p === "/api/overview") return send(res, 200, warmPics(cached("overview", 3000, overview)));
    // BTC/ETH/SOL: shared 15-second cache, first healthy provider answers; richer 24h figures fill in later.
    if (p === "/api/market") return send(res, 200, await marketPrices());
    // X tracker (xtrack.js): accounts, their posts with the coins they mention, profile changes, reader status.
    if (p === "/api/x") {
      const posts = xtrack.feed({ handle: params.handle || null, limit: params.limit, coins: params.coins === "1", since: +params.since || 0 });
      const mints = [...new Set(posts.flatMap((x) => x.mints))].slice(0, 300);
      const coins = mints.length ? Object.fromEntries(db.prepare(`SELECT mint, symbol, name, mcap, dex FROM tokens WHERE mint IN (${mints.map(() => "?").join(",")})`).all(...mints).map((t) => [t.mint, t])) : {};
      return send(res, 200, { status: xtrack.status(), accounts: xtrack.accounts(), changes: xtrack.changes(30), posts, coins });
    }
    if (p === "/api/x/accounts" && POST) { const b = await readBody(req); return send(res, 200, await xtrack.addAccount(b.handle)); }
    const xm = p.match(/^\/api\/x\/accounts\/([A-Za-z0-9_]{1,15})$/);
    if (xm && req.method === "DELETE") { xtrack.removeAccount(xm[1]); return send(res, 200, { ok: true }); }
    if (xm && POST) { const b = await readBody(req); xtrack.setAlerts(xm[1], b.alerts !== false); return send(res, 200, { ok: true }); }
    if (p === "/api/x/refresh" && POST) return send(res, 200, xtrack.status(await xtrack.runOnce()));
    // The mini charts and live market caps for the rows a list is showing, asked every second or two.
    if (p === "/api/sparks") {
      const mints = String(params.m || "").split(",").filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)).slice(0, 200);
      return send(res, 200, cached(`sparks:${params.w}:${mints.join(",")}`, 1000, () => {
        const rows = mints.length ? db.prepare(`SELECT mint, price, mcap, quarantine, pair_created, first_seen, graduated, dex, liquidity FROM tokens WHERE mint IN (${mints.map(() => "?").join(",")})`).all(...mints) : [];
        // Jupiter only for coins the live feed is not already pricing (keeps its shared allowance free).
        jupdisc.want(mints.filter((m) => { const c = liveCurves.get(m); return !c || c.pad || c.progress >= 0.995 || Date.now() - c.last > 10 * MIN; })); jupdisc.topTraded(params.w);
        // dex and liquidity too: liveRow reads them (the curve liquidity estimate), and the figures must match the ones
        // /api/discover works out for the same coin, or the page flips between the two answers.
        const out = Object.fromEntries(rows.map((t) => [t.mint, { ...sparkFor(t, params.w), live: liveRow(t, params.w) }]));
        // Coins the radar does not track (Fomo's lists show big, older coins): Jupiter's line alone.
        for (const m of mints) if (!out[m]) { const s = sparkFor({ mint: m, price: 0, mcap: null, quarantine: null }, params.w); if (s.spark.length > 1) out[m] = { ...s, mc: s.mc ?? s.spark[s.spark.length - 1][1], live: null }; }
        // Rows with no live curve figures are re-read from DexScreener while on screen (engine.js).
        refreshVisible(rows.filter((t) => out[t.mint].live?.src !== "feed").map((t) => t.mint)).catch(() => {});
        // Their holder ledgers are seeded from the chain while on screen too (holders.js), so holders and top 10 are exact,
        // and never-checked ones go to RugCheck next (engine.js), so the safety pill fills in.
        try { seedWanted(mints); wantSafety(mints); } catch {}
        // Coins on screen with no live price (bonded, or off the feed) get their pool price every few seconds (pulse.js),
        // the first 20 of them, so their lines and caps move too.
        // Every coin on screen the live feed is not pricing gets its price every few seconds (pulse.js: Jupiter's
        // price API, 50 a call), tracked by the radar or not, so every line and cap on the page moves as fast.
        mints.filter((m) => out[m]?.live?.src !== "feed").slice(0, 50).forEach((m) => focusPrice(m));
        return { w: SPARK_WIN[params.w] ? params.w : "1h", t: Date.now(), rows: out };
      }));
    }
    // Lines and market caps for coins on other chains in Fomo's lists (extsparks.js, DexScreener).
    if (p === "/api/ext-sparks") return send(res, 200, extSparks(params.m));
    if (p === "/api/tokens") return send(res, 200, warmPics(cached(`tokens${url.search}`, 5000, () => tokensQuery(params))));
    // Discover's four lists (Trending, Surge, New pairs, Bonded) for one window, unfiltered, in one answer: the
    // same for everybody, so it is worked out once every few seconds and every visitor's page opens with every tab
    // in hand (switching tabs asks nothing). Each list is the very answer /api/tokens gives the page for that tab
    // (the same cache key), so a page that falls back to asking one tab gets the same rows.
    if (p === "/api/discover") return send(res, 200, warmPics(cached(`discover:${params.tf === "5m" || params.tf === "24h" ? params.tf : "1h"}`, 1500, () => discoverLists(params.tf))));
    if (p === "/api/signals") return send(res, 200, warmPics(cached(`signals${url.search}`, 3000, () => signalsQuery(params))));
    if (p === "/api/narratives") return send(res, 200, warmPics(cached("narratives", 60_000, () => computeNarratives({ launches: launchLog }))));
    if (p === "/api/narrative-feed") return send(res, 200, cached("narfeed", 4000, narrativeFeed));
    if (p === "/api/clusters") return send(res, 200, cached("clusters", 2000, () => ({ ...clusterBoard(), calls: brain.narrativeBoard() })));
    if (p === "/api/perf") return send(res, 200, cached("perf", 60000, perf));
    if (p === "/api/health") return send(res, 200, cached("health", 4000, healthReport));
    if (p === "/api/briefs") return send(res, 200, db.prepare("SELECT * FROM briefs ORDER BY t DESC LIMIT 20").all());
    if (p === "/api/events") return send(res, 200, db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 80").all());
    if (p === "/api/brief" && POST) return send(res, 200, await makeBrief("on demand"));
    // A page's caught error (main.tsx guards: the page, the rail and bars): into the log as an "error" event, at most
    // 30 a minute from everyone together, so a crash someone saw can be found and fixed.
    if (p === "/api/client-error" && POST) {
      const b = await readBody(req).catch(() => ({}));
      if (!overPace("client-error", 30)) logEvent("error", `page ${String(b.where || "page").slice(0, 20)} #/${String(b.route || "").slice(0, 80)}: ${String(b.message || "").slice(0, 200)} @ ${String(b.at || "").slice(0, 160)}${res.blixAs ? " (member)" : ""}`);
      return send(res, 200, { ok: true });
    }
    // The owner's dashboard (blixvip.com/__admin): every member's paper desk and hosted wallet balance. Owner only.
    if (p === "/api/admin/members") {
      if (res.blixAs || res.blixVisitor) return send(res, 404, { error: "Not found" });
      return send(res, 200, await membersReport());
    }
    if (p === "/api/settings") {
      if (POST) { const b = await readBody(req); saveSettings(b.settings || b, { clear: b.clear || [] }); }
      return send(res, 200, publicSettings());
    }
    // Tests use what is typed in the form without saving it.
    if (p === "/api/test-grok" && POST) return send(res, 200, await testGrok());
    if (p === "/api/test-fast" && POST) return send(res, 200, await testFast(withOverrides(await readBody(req)).groqKey));
    if (p === "/api/test-notify" && POST) return send(res, 200, await testNotify(withOverrides(await readBody(req))));
    if (p === "/api/alerts") {
      if (POST) { const b = await readBody(req); b.clear ? rules.clear(b.scope, b.target) : rules.set(b.scope, b.target, b.effect, b.note); }
      const names = (r) => r.scope === "coin" ? db.prepare("SELECT symbol FROM tokens WHERE mint = ?").get(r.target)?.symbol : r.scope === "wallet" ? db.prepare("SELECT label FROM wallets WHERE address = ?").get(r.target)?.label : null;
      return send(res, 200, { rules: rules.list().map((r) => ({ ...r, name: names(r) || null })), destinations: destinations(), deliveries: deliveries(80) });
    }
    const am = p.match(/^\/api\/alerts\/(\d+)$/);
    if (am && req.method === "DELETE") { rules.remove(am[1]); return send(res, 200, { ok: true }); }
    if (p === "/api/export") {
      res.writeHead(200, { "content-type": "application/json", "content-disposition": `attachment; filename="meme-radar-export-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" });
      return res.end(JSON.stringify(exportData(params.secrets === "1"), null, 2));
    }
    if (p === "/api/import" && POST) return send(res, 200, importData(await readBody(req)));
    if (p === "/api/backup") {
      if (POST) { const b = await backupInBackground(); logEvent("system", `Backup written (${(b.bytes / 1e6).toFixed(0)} MB)`); }
      return send(res, 200, { backups: backups(), last: +meta.get("backup_t", 0) || null, database: { file: DB_FILE, bytes: fs.statSync(DB_FILE).size } });
    }
    if (p === "/api/repair" && POST) return send(res, 200, rebuildFromSnapshots());
    if (p === "/api/wallets") {
      if (POST) { const b = await readBody(req); return send(res, 200, wallets.addWallet(String(b.address || "").trim(), String(b.label || "").trim())); }
      return send(res, 200, warmPics({ wallets: wallets.listWallets(), smart: wallets.smartMoney(40), activity: wallets.activity(80), tracking: wallets.tracking(), rpc: { ...wallets.tracking().rpc, custom: !!settings.rpcUrl }, fomo: fomoOverview() }));
    }
    if (p === "/api/fomo") return send(res, 200, fomoOverview());
    if (p === "/api/snipe-stats") return send(res, 200, params.m ? snipeDebug(String(params.m)) : snipeStats);
    // Fomo's own token lists (Discover's Top and Most held tabs), read through Aside while someone is looking (fomolists.js).
    if (p === "/api/fomo/list") return send(res, 200, fomoList(String(params.kind || "")));
    // The owner's PC hands this server its Fomo sign-in token (fomorelay.js there, fomochart.js here).
    // settings.fomoOwnLogin: this server has its own Fomo login (bin/fomo-session.mjs import of a session made only
    // for it), so whatever the owner's PC relays is ignored: an Aside there with no window open would otherwise
    // hand over its errors in place of the server's own reads. `wanted: []` also tells the PC to stop reading.
    if (settings.fomoOwnLogin && POST && (p === "/api/fomo/token" || p === "/api/fomo/feed/relay" || p === "/api/fomo/coin/relay")) return send(res, 200, { ok: true, ignored: "fomoOwnLogin", wanted: [] });
    if (p === "/api/fomo/token" && POST) { const b = await readBody(req); const r = setFomoToken(b.token, b.exp); return send(res, r.error ? 400 : 200, r); }
    // Fomo's Feed tab (the Feed page), read through Aside while someone is looking (fomofeed.js).
    if (p === "/api/fomo/feed") return send(res, 200, fomoFeed(params.groups));
    // A coin's bubble map: made once by whoever asks first, then the same map for everyone (bubblemap.js).
    // A coin's DexScreener banner, for Discover's coin card when its row has none (banner.js).
    if (p === "/api/banner") { const r = await banner(String(params.m || "")); return send(res, r.error ? 400 : 200, r); }
    if (p === "/api/bubblemap") { const m = String(params.mint || ""); const r = POST ? makeBubbleMap(m) : bubbleMap(m); return send(res, r.error && !r.map && !r.building ? 400 : 200, r); }
    // Views and likes on the Feed page's posts, counted by Blix (feedviews.js).
    if (p === "/api/feed/views" && POST) return send(res, 200, feedViews(viewerOf(req, res), await readBody(req)));
    if (p === "/api/feed/like" && POST) { const r = feedLike(viewerOf(req, res), await readBody(req)); return send(res, r.error ? 400 : 200, r); }
    // The owner's PC hands this server Fomo's feed as Aside there read it (fomorelay.js there, fomofeed.js relayIn here).
    if (p === "/api/fomo/coin/relay" && POST) { if (res.blixAs) return send(res, 403, { error: "Only the owner's PC relays Fomo." }); return send(res, 200, fomoBoard.coinRelayIn(await readBody(req))); }
    if (p === "/api/fomo/feed/relay" && POST) { if (res.blixAs) return send(res, 403, { error: "Only the owner's PC relays Fomo's feed." }); return send(res, 200, relayIn(await readBody(req))); }
    // Fomo's own chart bars for a coin (fomochart.js), read through the kept Fomo tab while the chart is open.
    const gpm = p.match(new RegExp(`^/api/gecko/price/(${MINT})$`));
    if (gpm) return send(res, 200, geckoPrice(gpm[1]));
    const fbm = p.match(new RegExp(`^/api/fomo/bars/(${MINT})$`));
    if (fbm) return send(res, 200, await fomoBars(fbm[1], params.res, params.since));
    // The Feed page's live push: only what changed, the moment a read lands (feedstream.js).
    if (p === "/api/feed/stream") return feedStream(req, res, params);
    if (p === "/api/feed/history") return send(res, 200, feedHistory(params));
    // Narratives running right now: where the money is going this hour, grouped into stories (running.js).
    if (p === "/api/running") return send(res, 200, warmPics(runningNarratives()));
    // What a coin's X link points at, for the hover card on X icons (xcard.js, FxTwitter: free).
    if (p === "/api/xcard") return send(res, 200, await xcard(params.u));
    // The owner's PC hands this server its AI read of those stories (running-ai.js there).
    if (p === "/api/running/ai" && POST) { if (res.blixAs) return send(res, 403, { error: "Only the owner's PC sends this." }); return send(res, 200, runningAiIn(await readBody(req))); }
    // keep=1: "Hot right now" shown away from the Feed (the Create coin page): the ledger only listens, so the feeds
    // are kept reading while it is asked for, as one Feed page with every kind of post would (the same Fomo read).
    // pump.fun's callouts are read only while someone wants them: a Hot list counting them keeps them coming.
    if (p === "/api/feed/hot") { if (params.keep) { try { pumpFeed(); fomoFeed(); } catch {} } else if (/pump/.test(String(params.src || ""))) { try { pumpFeed(); } catch {} } return send(res, 200, feedHot(params)); }
    // The Feed's pictures for the page server to fetch ahead (feedstream.js feedPics); the coins' logos are fetched here.
    if (p === "/api/feed/pics") { const f = feedPics(); try { images.warm(f.mints.filter((m) => !images.hasPicture(m))); } catch {} return send(res, 200, { pics: f.pics }); }
    // pump.fun's callouts (theses with live positions), merged into the same Feed page (pumpfeed.js).
    if (p === "/api/pump/feed") return send(res, 200, pumpFeed());
    // Fomo's leaderboard, read daily through Aside (fomoboard.js); its top traders are followed for wallet tracking.
    if (p === "/api/fomo/board") { if (!params.day) fomoBoard.boardLive(); const b = fomoBoard.board({ range: params.range, day: params.day }); try { warmBoard(b.rows); } catch {} return send(res, 200, b); }
    // pump.fun's PnL leaderboard (daily, weekly, monthly), read live while someone is looking (pumpboard.js).
    if (p === "/api/pump/board") { const b = await pumpBoard({ range: params.range }); try { warmBoard(b?.rows); } catch {} return send(res, 200, warmPics(b)); }
    if (p === "/api/fomo/board/refresh" && POST) { await fomoBoard.refreshBoard(wallets.addWallet, wallets.removeWallet); return send(res, 200, fomoBoard.board({ range: params.range })); }
    const ftm = p.match(/^\/api\/fomo\/trader\/([A-Za-z0-9_.-]{1,64})$/);
    if (ftm) return send(res, 200, warmPics(await fomoBoard.trader(ftm[1], { fresh: params.fresh === "1" })));
    if (p === "/api/research") return send(res, 200, cached("research", 6000, research.desk));
    if (p === "/api/pulse") return send(res, 200, pulseData());
    if (p === "/api/bot") return send(res, 200, cached("bot", 3000, () => ({ anti: antiSlop(), day: cached("bot-day", 10_000, brain.dayData), live: pulseData().live, scout: research.scoutStats, early: cached("bot-early", 10_000, earlyData) })));
    if (p === "/api/triage") return send(res, 200, cached("triage", 30000, triageRecord));
    if (p === "/api/picks") return send(res, 200, warmPics(cached("picks", 8000, brain.picksData)));
    if (p === "/api/picks/all") return send(res, 200, cached("picks-all", 3000, brain.allPicks));
    if (p === "/api/picks/review" && POST) { brain.review(true); return send(res, 200, { started: true }); }
    if (p === "/api/picks/scout" && POST) { const s = brain.scoutStatus(); if (s.available) brain.scout(); return send(res, 200, { started: s.available, why: s.why }); }
    // The live holder ledger for one coin: top holders tagged dev / sniper / bundle, with what each has in.
    const hm = p.match(new RegExp(`^/api/holders/(${MINT})$`));
    if (hm) { const h = holdersFor(hm[1], { top: +params.top || 25 }); return h ? send(res, 200, h) : send(res, 404, { error: "The radar has not seen this coin trade since it started." }); }
    // The paper desk: open at a preset size, sell all or part, change a position's exit rule, forget a closed one.
    // Real quotes and candles for the coin page's trade panel and chart (quote.js, candles.js).
    if (p === "/api/quote") return send(res, 200, await quote(String(params.mint || ""), params.side, params.amount, { slippageBps: params.slip, estimate: true }));
    // The trade journal's health (journal.js): rows kept, confirmations, drops, outages and their repair.
    if (p === "/api/journal") return send(res, 200, { ...journal.summary(), candles: candleStoreStats, coins: coinIndex.indexStats, pictures: images.imgStats, fast: fastStats, rpc: rpcStats });
    const cm = p.match(new RegExp(`^/api/candles/(${MINT})$`));
    if (cm) {
      chartFocus.set(cm[1], Date.now()); focusChart(cm[1]); watchFast(cm[1]);
      // Outages of the radar's own feeds not yet read back for this coin (journal.js), in seconds: the chart
      // leaves them empty instead of drawing a flat price through them.
      const c = await candles(cm[1], params.tf, params.since);
      const from = Math.max(c.rows?.[0]?.time ?? Infinity, c.chainTo ?? 0) * 1000;
      const gaps = isFinite(from) ? journal.gapsFor(cm[1], from) : [];
      if (gaps.length) repairCoin(cm[1], from);   // read this coin back first; the chart's next poll has the trades
      return send(res, 200, { ...c, rev: revisionOf(cm[1]), gaps: gaps.map(([a, b]) => [Math.max(Math.floor(a / 1000), c.chainTo ?? 0), Math.ceil(b / 1000)]) });
    }
    // The full coin page (coin.js): live ledger, top traders, early buyers, the dev's coins, recent trades.
    // Fomo's known holders and theses for one coin (fomoboard.js, read through Aside, cached 3 minutes).
    const cfm = p.match(new RegExp(`^/api/coin/(${MINT})/fomo$`));
    if (cfm) return send(res, 200, fomoBoard.coinFomo(cfm[1]));
    if (p === "/api/fomo/known") return send(res, 200, fomoBoard.pulseKnown(url.searchParams.get("tokens") || ""));
    // Faces on the chart: pump.fun accounts and Fomo traders who traded or called this coin (chartpeople.js).
    // Every pump.fun callout (a thesis with its live position) on this coin, for the Theses tab (pumpfeed.js).
    const ccl = p.match(new RegExp(`^/api/coin/(${MINT})/callouts$`));
    if (ccl) return send(res, 200, coinCallouts(ccl[1]));
    // A coin's last day of trades for the coin page's replay mode (replay.js, web/src/lib/replay.ts).
    if (p === "/api/replay/peaks") return send(res, 200, replayPeaks(String(params.m || "").split(",").filter((m) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m))));   // Practice list: each coin's high of the day
    const crp = p.match(new RegExp(`^/api/replay/(${MINT})$`));
    if (crp) return send(res, 200, params.part === "fomo" ? replayFomo(crp[1]) : replayData(crp[1]));   // ?part=fomo: replayfomo.js
    const cpp = p.match(new RegExp(`^/api/coin/(${MINT})/people$`));
    if (cpp) return send(res, 200, coinPeople(cpp[1]));
    const cpm = p.match(new RegExp(`^/api/coin/(${MINT})(/trades|/big)?$`));
    if (cpm) return send(res, 200, cpm[2] === "/big" ? await coin.coinBigTrades(cpm[1]) : cpm[2] ? await coin.coinTrades(cpm[1], params) : coin.coinPage(cpm[1], params));
    // The paper wallet: how much fake SOL is left, and starting over.
    if (p === "/api/paper/wallet") return send(res, 200, cached(`paper-wallet:${res.blixAs || ""}`, 1000, paper.wallet));
    if (p === "/api/paper/reset" && POST) { const b = await readBody(req); forget("paper-wallet"); return send(res, 200, { wallet: paper.resetWallet(b.sol), desk: paper.desk() }); }
    if (p === "/api/paper/balance" && POST) { const b = await readBody(req); const wallet = paper.setPaperBalance(b.sol); forget("paper-wallet"); return send(res, 200, { wallet }); }
    if (p === "/api/paper/deposit" && POST) { const b = await readBody(req); const wallet = paper.depositPaper(b.sol); forget("paper-wallet"); return send(res, 200, { wallet }); }
    if (p === "/api/paper/quoted" && POST) { const b = await readBody(req); return send(res, 200, { position: await paper.openQuoted(String(b.mint || ""), b.sol, b), desk: paper.desk() }); }
    if (p === "/api/paper") {
      if (POST) { const b = await readBody(req); return send(res, 200, { position: paper.open(String(b.mint || ""), b.sol, b), desk: paper.desk() }); }
      return send(res, 200, paper.desk());
    }
    const pm = p.match(/^\/api\/paper\/(\d+)(\/sell|\/rule|\/sellq|\/preview)?$/);
    if (pm) {
      if (pm[2] === "/sellq" && POST) { const b = await readBody(req); return send(res, 200, { position: await paper.sellQuoted(+pm[1], b.pct ?? 100, { why: b.why || "sold" }), desk: paper.desk() }); }
      if (pm[2] === "/preview") return send(res, 200, await paper.previewSell(+pm[1], params.pct));
      if (pm[2] === "/sell" && POST) { const b = await readBody(req); return send(res, 200, { position: paper.sell(+pm[1], b.pct ?? 100, { why: b.why || "sold" }), desk: paper.desk() }); }
      if (pm[2] === "/rule" && POST) return send(res, 200, { position: paper.setRule(+pm[1], await readBody(req)), desk: paper.desk() });
      if (!pm[2] && req.method === "DELETE") { paper.remove(+pm[1]); return send(res, 200, paper.desk()); }
    }
    const rm = p.match(new RegExp(`^/api/research/(${MINT})$`));
    if (rm) {
      if (POST) {
        let t = db.prepare("SELECT graduated FROM tokens WHERE mint = ?").get(rm[1]);
        // A coin still in the launch feed, or one the live trade feed is pricing: start tracking it so it can be read.
        if (!t && (recentLaunches.some((l) => l.mint === rm[1]) || liveStats(rm[1]))) { adoptMint(rm[1]); await vet(rm[1]).catch(() => {}); t = db.prepare("SELECT graduated FROM tokens WHERE mint = ?").get(rm[1]); }
        if (!t) return send(res, 404, { error: "The radar isn't tracking this coin." });
        db.prepare("DELETE FROM research WHERE mint = ? AND status != 'running'").run(rm[1]);
        research.enqueue(rm[1], t.graduated ? "bonded" : "near", 1e12);
      }
      return send(res, 200, research.researchFor(rm[1]) || {});
    }
    if (p === "/api/fomo/trader" && POST) {
      const b = await readBody(req);
      const w = fomo.markFomo(String(b.wallet || "").trim(), b.handle, wallets.addWallet);
      return send(res, 200, { wallet: w, fomo: fomoOverview() });
    }
    const wm = p.match(new RegExp(`^/api/wallet/(${MINT})$`));
    if (wm) {
      if (req.method === "DELETE") { wallets.removeWallet(wm[1]); return send(res, 200, { ok: true }); }
      if (POST) {
        const b = await readBody(req);
        if (b.scan) await wallets.scanWallet(wm[1]);
        else if (b.follow) wallets.addWallet(wm[1], b.label || "", "you");
        else wallets.updateWallet(wm[1], b);
      }
      const d = await wallets.walletDetail(wm[1]);
      d.rule = db.prepare("SELECT effect FROM alert_rules WHERE scope = 'wallet' AND target = ?").get(wm[1])?.effect || null;
      return send(res, 200, d);
    }
    const m = p.match(new RegExp(`^/api/token/(${MINT})(/explain|/classify)?$`));
    if (m) {
      if (m[2] === "/explain") return send(res, 200, await explain(m[1]));
      if (m[2] === "/classify" && POST) {
        // Your correction wins over the automatic classification and survives every later scan.
        const b = await readBody(req);
        const row = db.prepare("SELECT * FROM tokens WHERE mint = ?").get(m[1]);
        if (!row) return send(res, 404, { error: "The radar isn't tracking this coin." });
        const valid = new Set(THEMES.map(([n]) => n));
        // null puts a field back on automatic, recomputed right away (a dead coin is never re-scanned).
        if ("assetClass" in b) {
          const user = b.assetClass in ASSET_LABEL ? b.assetClass : null;
          db.prepare("UPDATE tokens SET class_user = ?, asset_class = ? WHERE mint = ?").run(user, user || classifyAsset({ ...row, class_user: null }), m[1]);
        }
        if ("themes" in b) {
          const user = b.themes === null ? null : [].concat(b.themes).filter((x) => valid.has(x)).slice(0, 3);
          const meme = (db.prepare("SELECT asset_class FROM tokens WHERE mint = ?").get(m[1]).asset_class || "meme") === "meme";
          db.prepare("UPDATE tokens SET themes_user = ?, themes = ? WHERE mint = ?").run(user && JSON.stringify(user), JSON.stringify(user || (meme ? themesFor(row) : [])), m[1]);
        }
      }
      // A member or visitor asking the radar itself (the page server inside this process): the owner's followed
      // wallets, their trades and the alert rule are the owner's alone (webapp.js memberToken does the same).
      let d = tokenDetail(m[1]);
      if (d && (res.blixAs || res.blixVisitor)) d = { ...d, walletTrades: [], wallets: [], rule: null };
      return d ? send(res, 200, d) : send(res, 404, { error: "The radar has never seen this coin." });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

// The same rules decide what is pushed to Discord/Telegram and what the browser pops up as a notification.
bus.on("signal", (s) => {
  const d = decide(s);
  broadcast("signal", { ...signalOut({ ...s, symbol: s.token?.symbol, image: s.token?.image, price_now: s.token?.price, liq_now: s.token?.liquidity, pair: s.token?.pair, dex: s.token?.dex, quarantine: s.token?.quarantine, tstatus: s.token?.status, price_t: s.token?.price_t }), push: d.push, pushWhy: d.why });
  notifySignal(s).catch((e) => logEvent("error", `notify: ${e.message}`));
});
bus.on("tick", (s) => broadcast("tick", s));
bus.on("brief", (b) => broadcast("brief", b));
// The owner's followed wallets are the owner's business: their trades go to the owner's own clients only.
bus.on("walletTrade", (ev) => broadcast("walletTrade", ev, ""));
// New pump.fun coins go to the page the moment they're created; live trade numbers every 100ms.
bus.on("launch", (l) => {
  watched.add(l.mint);
  // Its picture now, watched or not: it is on disk before the coin shows anywhere (and the index keeps it).
  images.eager(l.mint);
  if (!clients.size) return;
  broadcast("launch", { ...l, solUsd: liveFeed.solUsd });
  // Someone is watching: get its socials now, not on the next sweep.
  metaNow(l.mint);
});
// The page swaps a coin's real picture in the moment the radar has it, and gets migrated prices as they move.
// The picture rides along (a few KB of data URL) for any coin a page watches or has asked for and missed
// (images.wasAsked), so the page draws it at once instead of asking for it again through Cloudflare.
images.onPictureReady((mint) => {
  if (!clients.size || !(watched.has(mint) || images.wasAsked(mint))) return;
  // The picture itself rides along only for coins on the Pulse board (a launch's logo the board draws at once);
  // for the rest the event carries the address alone, and only a page showing that coin fetches the logo
  // (from Cloudflare's cache). Logos as data URLs to every page were 44% of the stream's bytes.
  if (!watched.has(mint)) { broadcast("pic", { mint }); return; }
  images.inline(mint).then((data) => { if (clients.size) broadcast("pic", data ? { mint, data } : { mint }); }).catch(() => { if (clients.size) broadcast("pic", { mint }); });
});
onMigratedPrices((u) => { if (clients.size) broadcast("mig", { u }); });
pictureHooks(images.hasPicture, images.retry);
setInterval(() => {
  if (!clients.size) return;
  // Each row: the live numbers from the trade feed, then the holder ledger's figures for that coin.
  // The market cap on the same scale as the px event (circulating supply, chart level): on the curve's 1B alone
  // the two feeds disagreed for such a coin and its figures flickered between them every 100 ms.
  const u = drainUpdates(watched).map((row) => {
    const k = ((knownSupply(row[0]) ?? 1e9) / 1e9) * levelNow(row[0]);
    if (row[1] && k > 0 && k !== 1) row[1] = Math.round(row[1] * k);
    return [...row, ...liveHolders(row[0])];
  });
  if (u.length) broadcast("live", { u, sol: liveFeed.solUsd });
}, 100);
// An open chart moves trade by trade: every trade on a coin whose candles were asked for in the last 10 s
// (curve trades and bonded coins' pool trades) goes out as [mint, ms, mcUsd, volUsd, buy] at once: trades that
// land in the same message burst share one event, nothing waits on a timer.
const chartFocus = new Map();   // mint -> last candles request
let tradeOut = [], tradeTimer = null;
function chartTrade(mint, mc, vol, buy, slot = null) {
  const t = chartFocus.get(mint);
  if (!t || !clients.size || !(mc > 0)) return;
  mc *= levelNow(mint);   // on the chart's level (candles.js), so a pushed trade never steps off the candles
  if (Date.now() - t > 10_000) { chartFocus.delete(mint); return; }
  tradeOut.push([mint, Date.now(), +mc.toPrecision(8), +vol.toFixed(2), buy ? 1 : 0, slot]);   // slot: for measuring (bench-live.mjs)
  if (!tradeTimer) tradeTimer = setImmediate(() => { tradeTimer = null; const u = tradeOut; tradeOut = []; broadcast("trade", { u }); });
}
// Every coin's market cap moves everywhere it shows (Discover, the launcher, watchlists, narratives...), not only
// on Pulse: each coin that traded in the last 100 ms, curve or pool, goes out as [mint, mcUsd].
const pxOut = new Map();
let pxTimer = null;
// Several feeds price the same coin (its trades, its pool's on-chain price, Fomo's and GeckoTerminal's quotes), each a
// little off the others: sent as they came, a cap on the page flipped $1.93M, $1.95M, $1.93M... every few hundred ms.
// The best feed heard for a coin in the last 20 s is the only one sent: 3 its trades, 2 its pool's price, 1 a quote.
const pxBest = new Map();   // mint -> [rank, t]
function pxFrom(mint, rank) {
  const b = pxBest.get(mint), now = Date.now();
  if (b && b[0] > rank && now - b[1] < 20_000) return false;
  pxBest.set(mint, [rank, now]);
  if (pxBest.size > 50_000) pxBest.clear();
  return true;
}
function pxMove(mint, mc, rank = 3) {
  if (!clients.size || !(mc > 0) || !pxFrom(mint, rank)) return;
  mc *= levelNow(mint);
  pxOut.set(mint, Math.round(mc));
  if (!pxTimer) pxTimer = setTimeout(() => { pxTimer = null; const u = [...pxOut]; pxOut.clear(); broadcast("px", { u }); }, 100);
}
// A market cap that is already on the chart's scale (Fomo's bars: USD price × supply, fomochart.js): out as is.
function pxRaw(mint, mc, rank = 1) {
  if (!clients.size || !(mc > 0) || !pxFrom(mint, rank)) return;
  pxOut.set(mint, Math.round(mc));
  if (!pxTimer) pxTimer = setTimeout(() => { pxTimer = null; const u = [...pxOut]; pxOut.clear(); broadcast("px", { u }); }, 100);
}
// On the circulating supply, the scale of the chart's history (jup.js supplyOf); the curve's own figure is on 1B.
// An open chart whose price comes from its accounts (fastpx.js) is moved by that feed alone: the logs' copy of
// the same trade arrives later on a busy connection and would step the candle back.
onLiveTrade((mint, s, sol) => { if (isFast(mint)) return; const mc = s.mc * liveFeed.solUsd * ((knownSupply(mint) ?? 1e9) / 1e9); pxMove(mint, mc); chartTrade(mint, mc, sol * liveFeed.solUsd, s.side === "b"); });
onPoolTrade((mint, e) => { if (isFast(mint)) return; const mc = e.mcSol * liveFeed.solUsd; pxMove(mint, mc); chartTrade(mint, mc, e.sol * liveFeed.solUsd, e.buy); });
// The same pool trades keep a bonded coin's counts, volume, traders, depth and holder ledger moving (livetrades.js, holders.js),
// and the first of them marks a pump.fun coin bonded in the tokens table (engine.js), so it moves to Migrated at once.
onPoolTrade((mint, e) => { try { recordPoolTrade(mint, e); if (!e.rev) bondedOnChain(mint, poolOf(mint)); } catch {} });
const fastLast = new Map();   // mint -> { mc, t }: the header's live figure while the fast feed leads (coin.js)
onFastPx((mint, x) => {
  const mc = x.mcSol * liveFeed.solUsd * ((knownSupply(mint) ?? 1e9) / 1e9);
  fastLast.set(mint, { mc, t: Date.now() }); if (fastLast.size > 100) fastLast.delete(fastLast.keys().next().value);
  addCandleTrade(mint, mc, x.sol * liveFeed.solUsd, x.buy); pxMove(mint, mc); chartTrade(mint, mc, x.sol * liveFeed.solUsd, x.buy, x.slot);
});
coin.setFastMc((mint) => { const f = fastLast.get(mint); return f && isFast(mint) && Date.now() - f.t < 10_000 ? f.mc * levelNow(mint) : null; });
setFastCheck(isFast); setPulseFastCheck(isFast);
// The fast lane (fastlane.js) streams the open charts' prices from its own thread: it is told how to put a curve's
// or pool's cap on the chart's scale (SOL price, circulating supply, the chart's level), twice a second.
setFastScale((mint) => liveFeed.solUsd > 0 ? { k: liveFeed.solUsd * ((knownSupply(mint) ?? 1e9) / 1e9) * levelNow(mint), solUsd: liveFeed.solUsd } : null);
// Raydium / Orca / Meteora pools of open charts, read on-chain (poolwatch.js): a price move, no trade size.
onChainMc((mint, mc) => { pxMove(mint, mc, 2); chartTrade(mint, mc, 0, true); });
// ...and their trades, read from each transaction a second later (cointape.js): the volume.
onTxTrade((mint, x) => chartTrade(mint, x.mc, x.usd, x.buy));
// An open coin page gets every trade the moment Blix reads it, as the trade list's row (wallet, size, tags),
// and its holder figures each time the chain changes them (holderslive.js), at most 4 times a second.
let rowsOut = [], rowsTimer = null;
coin.onTape((mint, row) => {
  if (!clients.size) return;
  rowsOut.push({ mint, ...row });
  if (!rowsTimer) rowsTimer = setImmediate(() => { rowsTimer = null; const u = rowsOut; rowsOut = []; broadcast("ctrade", { u }); });
});
// A person's balance of an open coin moved in a slot the fast feed priced: a trade, shown in the list and as a
// chart mark the moment the small account feeds say so; the logs' copy (who, tx) follows. A change with no
// price yet is tried once more shortly after (the two feeds are separate sockets).
function balanceRow(mint, owner, delta, slot, retry = true) {
  const p = priceAt(mint, slot);
  if (!p) { if (retry && isFast(mint)) setTimeout(() => balanceRow(mint, owner, delta, slot, false), 300); return; }
  const tokens = Math.abs(delta);
  coin.addTape(mint, { buy: delta > 0, sol: tokens * (p / 1e9), tokens, mcSol: p * ((knownSupply(mint) ?? 1e9) / 1e9), user: owner, slot, fast: true });
}
onBalance(balanceRow);
// Straight from the live holder map (count, and the top 10 people's share: pools and curves are program
// addresses and left out). It used to build the whole coin page for each push, up to 4 times a second, which
// held the event loop for over a second on a busy coin (2026-10-06). The dev's share stays with the 2 s poll.
onHolders((mint) => {
  if (!clients.size) return;
  const h = holdersLive(mint, { n: 40 });
  if (!h) return;
  const supply = knownSupply(mint) ?? 1e9;
  const top10 = h.top.filter(([w]) => isWallet(w)).slice(0, 10).reduce((s, [, n]) => s + n, 0) / supply * 100;
  broadcast("cholders", { mint, holders: h.count, top10: +top10.toFixed(2), devPct: null, source: "chain (live)", t: Date.now() });
});
// A paper position closed by its own exit rule: tell the page (and the event log keeps it).
paper.exitHook((pos) => broadcast("paper", { pos }, pos?.who || ""));
paper.nameHook(nameOf);

// A bad API response should never take the radar down.
process.on("unhandledRejection", (e) => logEvent("error", `unhandled: ${e?.message || e}`));
process.on("uncaughtException", (e) => logEvent("error", `uncaught: ${e?.message || e}`));

// Also answer on IPv6 loopback: browsers try "localhost" as ::1 first and stall before falling back to IPv4.
// Requests are timed the same way as the repeating jobs: one that holds the radar up is recorded by its path.
{
  const [handle] = server.listeners("request");
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    const t = performance.now();
    try { return handle(req, res); }
    finally { const ms = performance.now() - t; if (ms > 250) health.noteSlow(`${req.method} ${String(req.url).split("?")[0].replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, ":mint")}`, ms); }
  });
}
const server6 = http.createServer((req, res) => server.emit("request", req, res));
server6.on("error", () => {});
server6.listen(PORT, "::1");
// The new front end (web/dist) on 127.0.0.1:4421, served by this process. Not for a trial copy on another port.
// The supervisor serves the page itself (so it stays up through radar restarts) and says so with BLIX_WEB_EXTERNAL.
if (!process.env.RADAR_PORT && !process.env.BLIX_WEB_EXTERNAL) startWebApp(server, PORT);
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Blix on http://localhost:${PORT}`);
  // v30: the launch-labelling model is off (its labels barely separated winners), picks are decided by live
  // demand and the launch model rather than the AI's call, and Grok scouts narratives hourly inside a daily budget.
  if (meta.get("next_level_v30") !== "1") {
    saveSettings({ triageOn: false, pickMinTraction: Math.max(65, settings.pickMinTraction), scoutEveryMin: Math.min(60, settings.scoutEveryMin || 60) });
    meta.set("next_level_v30", "1");
  }
  start();
  research.startResearch(raise);
  brain.startBrain(raise, research.enqueue);
  startPulse();
  if (settings.marketFeeds !== false) startLiveTrades();
  if (settings.marketFeeds !== false) startPumpSwap();
  startChartStream();
  startHelius();
  startFeedLag();
  if (settings.marketFeeds !== false) startLaunchLab();
  if (settings.marketFeeds !== false) startHolders();
  paper.startPaper();
  startCandles();
  // Every pump.fun and PumpSwap trade kept a day, confirmed, with outages recorded and repaired (journal.js);
  // charts open in the last five minutes are repaired first.
  startJournal({ watched: () => [...chartFocus].filter(([, t]) => Date.now() - t < 5 * MIN).map(([m]) => m) });
  // ...and rolled into candles kept for good (candlestore.js), remade for a coin whose journal rows change later.
  startCandleStore();
  journal.onRevised(rebuildCandles);
  // Every coin's name, ticker, socials and picture, kept for good (coinindex.js): fed by the launch feeds and the
  // chain's CreateEvents; its picture is fetched to disk as soon as the metadata names it.
  onLiveCreate((c) => coinIndex.note(c));
  coinIndex.onNeedPicture((m) => images.retry(m));
  coinIndex.startCoinIndex();
  jupdisc.startJupDisc();
  // Coins named in tracked X posts are tracked by the radar too; new posts go to open pages.
  xtrack.onXMints((mints) => adoptFound(mints.map((mint) => ({ mint })), "x"));
  xtrack.onXPosts((posts) => broadcast("xpost", { posts: posts.map((p) => ({ id: p.id, handle: p.handle, name: p.name, avatar: p.avatar, t: p.t, text: p.text.slice(0, 280), mints: p.mints, tickers: p.tickers })) }));
  xtrack.startXTrack();
  jupdisc.onTopTraded(adoptFound);
  // trade.blixvip.com opens the new front end: the supervisor's page server (webapp.js, :4421), which checks the
  // access key itself and forwards /api here.
  startTunnel(Number(process.env.BLIX_WEB_PORT) || 4421);
  startTriage(research.enqueue);
  startEarly({ enqueue: research.enqueue, earlyPick: brain.earlyPick });
  // New alert types are switched on once for existing installs (they can be switched off again in Settings).
  const addKind = (flag, kind) => { if (meta.get(flag) !== "1") { saveSettings({ notifyKinds: [...new Set([...settings.notifyKinds, kind])] }); meta.set(flag, "1"); } };
  if (!settings.buyMigrated) saveSettings({ notifyKinds: [...new Set([...settings.notifyKinds, "buy"])], buyMigrated: true });
  addKind("kind_liq_pulled", "liq-pulled");
  addKind("kind_pick", "pick");
  addKind("kind_narrative", "narrative");
  startClusters({ enqueue: research.enqueue, raise });
  // Grok is out of credits for the month: Claude is the chosen AI for every lane until it is switched back in Settings.
  if (meta.get("claude_lanes_v25") !== "1") { saveSettings({ fastProvider: "claude", deepProvider: "claude" }); meta.set("claude_lanes_v25", "1"); }
  // Deep second opinions now go to every coin the first read would trade: give that lane more room.
  if (meta.get("deep_cap_v21") !== "1") { if (settings.researchPerHour < 40) saveSettings({ researchPerHour: 40 }); meta.set("deep_cap_v21", "1"); }
  // Fast first reads moved to Claude Haiku while Grok is out: give that lane room to keep up with launches.
  if (meta.get("fast_cap_v17") !== "1") { if (settings.fastPerHour < 200) saveSettings({ fastPerHour: 200 }); meta.set("fast_cap_v17", "1"); }
  // First reads became quick calls (a few seconds each, a fraction of the words): room for twice as many.
  if (meta.get("quick_reads_v28") !== "1") { if (settings.fastPerHour < 600) saveSettings({ fastPerHour: 600 }); meta.set("quick_reads_v28", "1"); }
  // Briefs written before completeness was checked: mark the ones that were cut off.
  if (meta.get("briefs_checked") !== "1") {
    for (const b of db.prepare("SELECT id, body FROM briefs").all()) { const why = briefProblem(b.body); if (why) db.prepare("UPDATE briefs SET status = 'partial', stop = ? WHERE id = ?").run(why, b.id); }
    meta.set("briefs_checked", "1");
  }
  if (settings.marketFeeds !== false) startTape();
  detectVersion().then(grokTier).then(grokBilling).catch(() => {});
  setInterval(() => grokBilling().catch(() => {}), 10 * MIN);
  const syncSol = () => wallets.solPrice().then(research.setSolPrice).catch(() => {});
  syncSol(); setInterval(syncSol, 5 * MIN);
  fomo.startFomo({
    addWallet: wallets.addWallet,
    raise, adoptMint, vet,
    onTrade: (tr) => broadcast("fomoTrade", { ...tr, handle: fomo.handleOf(tr.wallet) }),
  });
  fomoBoard.startBoard(wallets.addWallet, wallets.removeWallet);
  // New pairs (newest 40) and the Final stretch (top 20): their Fomo holders are kept current (fomoboard.js liveTick).
  fomoBoard.setLiveMints(() => { const d = pulseData(); return [...(d.newPairs || []).slice(0, 40), ...(d.stretch || []).slice(0, 20)].map((r) => r.mint); });
  // Discover's shared lists: the 1h window always (the page's default), 5m and 24h while someone asked for them in
  // the last five minutes. Their coins' faces are kept read so /api/discover answers with them.
  fomoBoard.setDiscoverMints(() => {
    const out = [];
    for (const tf of ["1h", "5m", "24h"]) {
      const c = memo.get(`discover:${tf}`);
      if (tf !== "1h" && !(c && Date.now() - c.t < 5 * MIN)) continue;
      const d = tf === "1h" ? cached("discover:1h", 1500, () => discoverLists("1h")) : c.v;
      for (const t of Object.values(d?.tabs || {})) for (const r of t.rows) out.push(r.mint);
    }
    return out;
  });
  // Each bar of an open Fomo-mode chart as it is read (fomochart.js), for the page to draw at once.
  // ...and the coin's market cap everywhere it shows (header, ticker, Pulse rows) moves with the same bar.
  onFomoBar((d) => { broadcast("fbar", d); if (d.supply > 0 && d.bar[4] > 0) pxRaw(d.mint, d.bar[4] * d.supply); });
  // Fomo's live prices (fomoprices.js) for every coin on the Pulse board and every open chart: each tick moves the
  // coin's market cap everywhere it shows, at Fomo's pace.
  onFomoPrice((mint, mc) => pxRaw(mint, mc));
  // GeckoTerminal's price for a coin whose Gecko chart is open (gecko.js): the figures around that chart agree with it.
  onGeckoPrice((mint, mc) => pxRaw(mint, mc));
  const mintsOf = (v, out, depth = 0) => { if (!v || depth > 6) return; if (Array.isArray(v)) { for (const x of v) mintsOf(x, out, depth + 1); return; } if (typeof v === "object") { if (typeof v.mint === "string" && v.mint.length >= 32) out.add(v.mint); for (const k in v) if (k !== "mint" && typeof v[k] === "object") mintsOf(v[k], out, depth + 1); } };
  setInterval(() => {
    if (!clients.size) return wantFomoPrices([]);
    // Only charts open now (asked for in the last 10 s), and old entries go: a coin whose chart was opened once and
    // never traded again stayed forever and, first in the set, crowded Pulse's coins out of wantFomoPrices' cap.
    const want = new Set();
    for (const [m, t] of chartFocus) { if (Date.now() - t > 5 * MIN) chartFocus.delete(m); else if (Date.now() - t < 10_000) want.add(m); }
    try { mintsOf(pulseData(), want); } catch {}
    wantFomoPrices(want);
  }, 5000).unref();
  // First brief once there's data to talk about, then on schedule.
  // An AI that is busy or rate limited (Gemini's free quota, no Groq key) is not a failure: the next try waits half
  // an hour and it is noted once, instead of an error every five minutes that also spent the quota again.
  let briefWait = 0, briefNoted = false;
  const tryBrief = () => {
    if (!settings.aiBriefs || Date.now() < briefWait) return;
    return makeBrief().then(() => { briefNoted = false; }, (e) => {
      if (!e.busy) return logEvent("error", `brief: ${e.message}`);
      briefWait = Date.now() + 30 * MIN;
      if (!briefNoted) { briefNoted = true; logEvent("system", `AI brief waiting: ${e.message}. Trying again every 30 min.`); }
    });
  };
  setTimeout(tryBrief, 12 * MIN);
  setInterval(() => {
    const last = db.prepare("SELECT t FROM briefs ORDER BY t DESC LIMIT 1").get();
    if (!last || Date.now() - last.t >= settings.briefEveryMin * MIN) tryBrief();
  }, 5 * MIN);
  // Also soon after each start: the radar restarts more often than every 6 hours, so it never ran.
  setTimeout(() => images.prunePictures().catch(() => {}), 10 * MIN);
  setInterval(() => images.prunePictures().catch(() => {}), 6 * HOUR);
  setInterval(() => images.warm(watched), 3000);
  // A daily copy of the database, so a corrupted or lost file costs at most a day.
  setInterval(() => {
    if (Date.now() - +meta.get("backup_t", 0) < DAY) return;
    backupInBackground().then((b) => logEvent("system", `Daily backup written (${(b.bytes / 1e6).toFixed(0)} MB)`), (e) => logEvent("error", `backup: ${e.message}`));
  }, 30 * MIN);
});
