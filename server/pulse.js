// Pulse: the live three-column view (new pairs → about to bond → migrated), Axiom style, with the
// AI's rating state for every coin (queued, Grok reading it right now, graded, deep read, buy call).
import { db, q, json } from "./db.js";
import { recentLaunches, devLaunches, launchIndex } from "./engine.js";
import { candidates, ipfs, bondingProgress, providers, queueStatus, liveTraction } from "./research.js";
import { safeUrl, publicUrl, cleanLinks } from "./quality.js";
import { liveStats, feed, live, closeToBonding } from "./livetrades.js";
import { dexTokens } from "./sources.js";
import { triageFor, triageStats } from "./triage.js";
import { earlyFor } from "./early.js";
import { grokStatus } from "./grok.js";
import { rowHolders, holderStats } from "./holders.js";
import { runners, windowStats } from "./coverage.js";
import { traction } from "./quality.js";
import { adoptLaunch, adoptMint, vet } from "./engine.js";
import { enqueue } from "./research.js";
import { jupiterGet } from "./jupiter.js";

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
export const getMeta = (mint) => meta.get(mint);
// A picture address found for a coin the radar does not track (see lookupPictures).
export const knownImage = (mint) => names.get(mint)?.image || null;
// Ticker and name for any coin the page has seen: the launch feed first, then the DexScreener lookup.
export const nameOf = (mint) => { const l = launchIndex.get(mint), n = names.get(mint); return l || n?.symbol ? { symbol: l?.symbol || n?.symbol || null, name: l?.name || n?.name || null } : null; };
// The Jupiter price of a migrated coin on the page (refreshed every 2s), for anything that needs it now.
export const fastMcap = (mint) => { const x = migPx.get(mint); return x && now() - x.t < 30_000 ? x.mcap : null; };

// Mints currently on the Pulse page; the live trade feed only pushes updates for these.
export const watched = new Set();

// Overlay the live trade feed on a row (fresher than DexScreener for coins still on the curve), and the
// holder ledger built from the same feed (holders, top 10, dev, snipers, bundle).
function withLive(r) {
  const hl = rowHolders(r.mint);
  const x = liveStats(r.mint);
  if (!x || now() - x.last > 15 * MIN) return hl ? { ...r, hl } : r;
  return { ...r, mcap: x.mc, buys: r.graduated ? r.buys : x.buys, sells: r.graduated ? r.sells : x.sells, liveVol: x.vol, traders: x.traders,
    progress: r.graduated ? r.progress : x.progress, chg1m: x.chg1m, side: x.side, lastTrade: x.last, live: true, hl };
}

const now = () => Date.now();
const MIN = 60_000;
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
const justBonded = () => db.prepare("SELECT mint FROM tokens WHERE graduated = 1 AND symbol IS NULL AND first_seen > ?").all(now() - 20 * MIN).map((r) => r.mint);
async function lookupNames() {
  if (now() - cache.t > 15_000) return;
  const ask = [];
  for (const m of [...stretchMints, ...runningMints, ...justBonded()]) {
    if (ask.length >= 30) break;
    const n = names.get(m);
    if (launchIndex.has(m) || n?.symbol || (n && now() - n.t < 60_000) || q.getToken.get(m)?.symbol) continue;
    ask.push(m);
  }
  if (!ask.length) return;
  for (const m of ask) names.set(m, { t: now() });
  const got = await dexTokens(ask);
  for (const [m, p] of got) names.set(m, { symbol: p.baseToken?.symbol, name: p.baseToken?.name, image: safeUrl(p.info?.imageUrl), created: p.pairCreatedAt || null, t: now() });
  if (names.size > 4000) for (const k of [...names.keys()].slice(0, 1500)) names.delete(k);
}

// Pictures for those coins: pump.fun's picture CDN only answers for coins a few hours old, so the rest are
// looked up on GeckoTerminal (30 coins a call), which carries the on-chain picture for nearly every token.
const picAsked = new Map();
let needsPicture = () => true, onImage = null;
export const pictureHooks = (has, found) => { needsPicture = (m) => !has(m); onImage = found; };
async function lookupPictures() {
  if (now() - cache.t > 15_000) return;
  const ask = [...new Set([...stretchMints, ...runningMints, ...migMints])].filter((m) => needsPicture(m) && !names.get(m)?.image && now() - (picAsked.get(m) || 0) > 5 * MIN && now() - (live.get(m)?.first || launchIndex.get(m)?.seen || 0) > 20_000).slice(0, 30);
  if (!ask.length) return;
  for (const m of ask) picAsked.set(m, now());
  if (picAsked.size > 3000) for (const [k, t] of picAsked) if (now() - t > 10 * MIN) picAsked.delete(k);
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/${ask.join(",")}`, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
  if (!r.ok) return;
  for (const t of (await r.json()).data || []) {
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
let migMints = [], migPause = 0, migBusy = false, onMig = null;
const migRatio = new Map();   // mint -> tokens in circulation (market cap / price), from the radar's own reading
export const onMigratedPrices = (fn) => { onMig = fn; };
export const migStats = { calls: 0, moved: 0, last: 0, paused: 0 };
async function priceMigrated() {
  if (migBusy || now() < migPause || now() - cache.t > 15_000 || !migMints.length) return;
  migBusy = true;
  try {
    const ids = migMints.slice(0, 50);
    const got = await jupiterGet(`/price/v3?ids=${ids.join(",")}`, { timeout: 5000 });
    migPause = now() + 6000; // Leave room in the shared allowance for interactive quotes.
    migStats.calls++; migStats.last = now();
    const out = [];
    for (const m of ids) {
      const usd = got[m]?.usdPrice;
      if (!(usd > 0)) continue;
      // Market cap from the coin's own price-to-cap ratio when the radar has one (every pump.fun coin has
      // a billion tokens, which is the fallback).
      const t = migRatio.get(m);
      const mc = usd * (t || 1e9);
      const prev = migPx.get(m);
      migPx.set(m, { mcap: mc, t: now() });
      if (!prev || Math.round(prev.mcap) !== Math.round(mc)) out.push([m, Math.round(mc)]);
    }
    migStats.moved += out.length;
    if (out.length) onMig?.(out);
    if (migPx.size > 600) for (const [k, v] of migPx) if (now() - v.t > 10 * MIN) migPx.delete(k);
  } catch (e) { if (e.status === 429) { migPause = now() + 30_000; migStats.paused++; } }
  finally { migBusy = false; }
}
function withFastPrice(r) {
  const x = migPx.get(r.mint);
  if (!x || now() - x.t > 30_000) return r;
  return { ...r, mcap: x.mcap, priceT: x.t };
}

// ---------- rows ----------
function researchMap(mints) {
  if (!mints.length) return new Map();
  const rows = db.prepare(`SELECT mint, status, grade, score, tier, verdict, stage, report, t, model FROM research WHERE status != 'expired' AND mint IN (${mints.map(() => "?").join(",")})`).all(...mints);
  return new Map(rows.map((r) => {
    const rep = json(r.report, {});
    return [r.mint, { status: r.status, grade: r.grade, score: r.score, tier: r.tier, verdict: r.verdict, stage: r.stage, t: r.t, model: r.model, rated: Boolean(r.grade) && ["done", "deep"].includes(r.status),
      action: rep.trade?.action || null, pwin: rep.trade?.pWin ?? null, conviction: rep.trade?.conviction ?? null, tag: rep.narrative?.tag || null, organic: rep.xBuzz?.organic || null }];
  }));
}

function row(t, ai) {
  const s = json(t.safety) || {};
  const links = cleanLinks(json(t.links, []));
  const link = (re) => links.find((l) => re.test(`${l.type} ${l.url}`))?.url || null;
  return {
    mint: t.mint, symbol: t.symbol, name: t.name, image: t.image, age: now() - (t.pair_created || t.first_seen), dex: t.dex, priceT: t.price_t || t.updated || null,
    mcap: t.mcap, vol: t.vol_h1, vol5m: t.vol_m5, peak: t.peak_mcap, liq: t.liquidity, chg5: t.chg_m5, chg1h: t.chg_h1, buys: t.buys_h1, sells: t.sells_h1,
    holders: s.totalHolders ?? null, top10: s.top10 ?? null, dev: s.devPct ?? null, insiders: s.insiderPct ?? null,
    safety: t.safety_score, danger: (s.danger || 0) > 0, progress: t.progress ?? bondingProgress(t), graduated: !!t.graduated,
    x: link(/twitter|x\.com/i), web: links.find((l) => l.type === "website")?.url || null, tg: link(/telegram|t\.me/i),
    tiktok: link(/tiktok/i), creator: t.creator || null, paid: (t.boosts || 0) > 0 || Boolean(t.header),
    ai: ai || null,
  };
}

let cache = { t: 0, v: null };
export function pulseData() {
  if (now() - cache.t < 1500 && cache.v) return cache.v;
  const { near, bonded } = candidates();
  // New pairs: the newest launches, joined with the radar's data once it starts tracking them.
  const fresh = recentLaunches.slice(-NEW_ROWS).reverse();
  const tracked = fresh.length ? new Map(db.prepare(`SELECT * FROM tokens WHERE mint IN (${fresh.map(() => "?").join(",")})`).all(...fresh.map((l) => l.mint)).map((t) => [t.mint, t])) : new Map();
  // Final stretch: every coin the live trade feed sees at 50%+ of the curve and still trading, then any
  // tracked coin near bonding the feed has not seen trade yet (only with volume: no dead ones).
  const nearBy = new Map(near.map((t) => [t.mint, t]));
  stretchMints = closeToBonding(0.5, 10 * MIN, 100);
  const inFeed = new Set(stretchMints);
  const quiet = near.filter((t) => !inFeed.has(t.mint) && (t.vol_h1 || 0) > 0 && now() - (t.price_t || 0) < 10 * MIN).slice(0, 20);
  // Migrated: everything that bonded in the last 6 hours and is still worth something, plus coins that
  // bonded seconds ago and have no pool listed yet.
  const since = now() - 6 * 60 * MIN;
  const older = db.prepare(`SELECT * FROM tokens WHERE status = 'active' AND graduated = 1 AND pair IS NOT NULL AND quarantine IS NULL AND COALESCE(asset_class, 'meme') = 'meme'
    AND COALESCE(pair_created, first_seen) > ? AND mcap >= 5000 ORDER BY COALESCE(pair_created, first_seen) DESC LIMIT 80`).all(since);
  const seconds = db.prepare("SELECT * FROM tokens WHERE graduated = 1 AND pair IS NULL AND status = 'active' AND quarantine IS NULL AND first_seen > ? ORDER BY first_seen DESC LIMIT 20").all(now() - 10 * MIN);
  const all = [...fresh.map((l) => l.mint), ...stretchMints, ...quiet.map((t) => t.mint), ...older.map((t) => t.mint), ...seconds.map((t) => t.mint)];
  const ai = researchMap([...new Set(all)]);
  const newPairs = fresh.filter((l) => { const t = tracked.get(l.mint); return !t || now() - (t.pair_created || t.first_seen) < 24 * 60 * MIN; }).map((l) => {
    const t = tracked.get(l.mint);
    const m = meta.get(l.mint) || {};
    const base = t ? row(t, ai.get(l.mint)) : {
      mint: l.mint, symbol: l.symbol, name: l.name, image: null, age: now() - l.seen, mcap: null, ai: ai.get(l.mint) || null,
    };
    const age = now() - l.seen;
    return { ...base, image: base.image || m.image || null, x: base.x || m.twitter, web: base.web || m.website, tg: base.tg || m.telegram,
      desc: m.description || null, creator: base.creator || l.creator || null, pool: live.get(l.mint)?.pad || l.pool || null, devSol: l.devSol, early: earlyFor(l.mint), tri: triageFor(l.mint), startMcapSol: l.mcapSol, devCount: devLaunches.get(l.creator) || 1,
      state: t ? "tracked" : age < 4.5 * MIN ? "watching" : "faded" };
  }).map(withLive).map(rankRow);
  // A coin that's still trading isn't faded, whatever the 4-minute check said.
  for (const r of newPairs) if (r.state === "faded" && r.lastTrade && now() - r.lastTrade < 2 * MIN) r.state = "watching";
  const stretch = [...stretchMints.map((m) => {
    const t = nearBy.get(m) || q.getToken.get(m);
    if (!t) return withLive(bare(m, ai.get(m)));
    if (t.graduated) return null;
    const b = bare(m), r = row(t, ai.get(m));
    return withLive({ ...r, symbol: r.symbol || b.symbol, name: r.name || b.name, image: r.image || b.image, x: r.x || b.x, web: r.web || b.web, tg: r.tg || b.tg, creator: r.creator || b.creator, devSol: b.devSol, devCount: b.devCount });
  }), ...quiet.map((t) => withLive(row(t, ai.get(t.mint))))].filter((r) => r && r.symbol).map(rankRow).sort((a, b) => (b.progress || 0) - (a.progress || 0));
  for (const t of older) if (t.price > 0 && t.mcap > 0) migRatio.set(t.mint, t.mcap / t.price);
  if (migRatio.size > 800) migRatio.clear();
  const migrated = [...seconds, ...older].map((t) => {
    const b = bare(t.mint), r = row({ ...t, graduated: 1 }, ai.get(t.mint)), x = liveStats(t.mint);
    // Bonded seconds ago: its last price on the curve stands in until the new pool is priced.
    return withFastPrice({ ...r, symbol: r.symbol || b.symbol, name: r.name || b.name, image: r.image || b.image, mcap: r.mcap ?? (x ? x.mc : null), progress: 1 });
  }).filter((r) => r.symbol && (r.mcap || 0) >= 5000).map(rankRow).sort((a, b) => a.age - b.age).slice(0, 80);
  migMints = migrated.map((r) => r.mint);
  // Running now: every coin moving in the last 5 minutes that no other column holds (older than the New
  // pairs window and under 50% of the curve, say), hottest first. From coverage.js, off the live trade feed.
  const shownSet = new Set([...newPairs, ...stretch, ...migrated].map((r) => r.mint));
  const runs = runners({ limit: 100, exclude: shownSet });
  for (const [k, v] of researchMap(runs.map((w) => w.mint))) ai.set(k, v);
  const running = runs.map((w) => {
    const t = q.getToken.get(w.mint);
    const base = t && !t.graduated ? row(t, ai.get(w.mint)) : bare(w.mint, ai.get(w.mint));
    const b = bare(w.mint);
    return withLive({ ...base, symbol: base.symbol || b.symbol, name: base.name || b.name, image: base.image || b.image, x: base.x || b.x, web: base.web || b.web, tg: base.tg || b.tg, creator: base.creator || b.creator, devSol: base.devSol ?? b.devSol, devCount: base.devCount ?? b.devCount,
      tri: triageFor(w.mint), win: { trades: w.trades, traders: w.traders, netSol: +w.netSol.toFixed(2), chg: w.chg == null ? null : Math.round(w.chg), heat: w.heat } });
  // A moving coin is shown even before its name is known (the lookup fills it in a few seconds later).
  }).map((r) => r.symbol ? r : { ...r, symbol: `${r.mint.slice(0, 4)}…`, name: "name loading" }).map(rankRow);
  runningMints = running.map((r) => r.mint);
  // Anything moving that no AI has read yet goes to the queue (the queue's own cap and ranking take it from there).
  try { readHot([...running, ...stretch, ...newPairs.filter((r) => r.state !== "faded")]); } catch {}
  const reading = db.prepare("SELECT COUNT(*) n FROM research WHERE status = 'running'").get().n;
  const queued = db.prepare("SELECT COUNT(*) n FROM research WHERE status IN ('queued', 'deep')").get().n;
  const ratedHour = db.prepare("SELECT COUNT(*) n FROM research WHERE t > ? AND status IN ('done', 'deep')").get(now() - 60 * MIN).n;
  const perMin = recentLaunches.filter((l) => l.seen > now() - MIN).length;
  watched.clear();
  for (const r of [...newPairs, ...stretch, ...migrated, ...running]) watched.add(r.mint);
  const pv = providers(), qs = queueStatus();
  // Who is actually doing the reading right now, and why it may differ from what was configured.
  const lanes = { fast: pv.fast.actualName, deep: pv.deep.actualName, fastFallback: pv.fast.fallback ? pv.fast.reason : null, deepFallback: pv.deep.fallback ? pv.deep.reason : null, note: pv.fast.note || pv.deep.note, recovery: pv.recovery };
  cache = { t: now(), v: { newPairs, stretch, migrated, running, live: { running: reading, queued, ratedHour, launchesPerMin: perMin, tradesPerSec: feed.perSec, feed: feed.connected, solUsd: feed.solUsd, triage: triageStats, grokBlocked: grokStatus().blocked, ai: lanes, queue: qs, holders: holderStats }, ts: now() } };
  return cache.v;
}

// The anti-slop list: today's launches that got past triage. `fresh` are decent-looking coins not yet
// sent for a read, `reading` are in the queue or being read right now, `rated` have their grade.
export function antiSlop() {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const jobs = db.prepare(`SELECT mint, status, enq_t, t FROM research WHERE COALESCE(enq_t, t) > ? AND status != 'expired' ORDER BY COALESCE(t, enq_t) DESC LIMIT 240`).all(d0.getTime());
  const ai = researchMap(jobs.map((j) => j.mint));
  const rows = jobs.map((j) => {
    const t = q.getToken.get(j.mint);
    return t && { ...withLive(row(t, ai.get(j.mint))), tri: triageFor(j.mint), waited: j.enq_t ? now() - j.enq_t : null, state: "tracked", tr: liveTraction(t).score, early: earlyFor(j.mint) };
  }).filter(Boolean);
  const fresh = pulseData().newPairs.filter((r) => r.tri && ["maybe", "promising"].includes(r.tri.label) && !r.ai && r.state !== "faded").slice(0, 60);
  const dropped = db.prepare("SELECT COUNT(*) n FROM research WHERE COALESCE(enq_t, t) > ? AND status = 'expired'").get(d0.getTime()).n;
  return { fresh, reading: rows.filter((r) => !r.ai?.rated), rated: rows.filter((r) => r.ai?.rated), dropped };
}

// Coin pictures. Most tracked coins arrive without one (only coins with a paid DexScreener profile carry
// an image), so every 20 seconds a batch of picture-less coins is looked up: first in the launch
// metadata the radar already fetched, then on GeckoTerminal, which serves the on-chain image for
// almost every token (30 coins per call).
const imgTried = new Map();   // mint -> when it was last looked up
async function fillImages() {
  // Picked coins first (they stay on the lists after they die), then everything still being tracked.
  const rows = [...db.prepare("SELECT mint FROM tokens WHERE image IS NULL AND mint IN (SELECT mint FROM outcomes WHERE kind = 'pick' AND t0 > ? UNION SELECT mint FROM entry_watch WHERE t > ?)").all(now() - 48 * 60 * MIN, now() - 48 * 60 * MIN),
    ...db.prepare("SELECT mint FROM tokens WHERE status = 'active' AND image IS NULL ORDER BY COALESCE(updated, first_seen) DESC LIMIT 400").all()]
    .filter((r) => now() - (imgTried.get(r.mint) || 0) > 45 * MIN);
  const set = db.prepare("UPDATE tokens SET image = ? WHERE mint = ? AND image IS NULL");
  const ask = [];
  for (const r of rows) {
    const m = meta.get(r.mint);
    if (m?.image) set.run(m.image, r.mint); else if (ask.length < 30) ask.push(r.mint);
  }
  if (!ask.length) return;
  for (const m of ask) imgTried.set(m, now());
  if (imgTried.size > 5000) for (const [m, t] of imgTried) if (now() - t > 60 * MIN) imgTried.delete(m);
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/${ask.join(",")}`, { signal: AbortSignal.timeout(12_000), headers: { accept: "application/json" } });
  if (!r.ok) return;
  for (const t of (await r.json()).data || []) {
    const img = safeUrl(t.attributes?.image_url);
    if (img && !/missing/.test(img) && t.attributes?.address) set.run(img, t.attributes.address);
  }
}

export function startPulse() {
  const timer = setInterval(enrich, 1000);
  const fast = setInterval(() => priceMigrated().catch(() => {}), 2000);
  const look = setInterval(() => lookupPictures().catch(() => {}), 6000);
  const who = setInterval(() => lookupNames().catch(() => {}), 2500);
  const pics = setInterval(() => fillImages().catch(() => {}), 20_000);
  setTimeout(() => fillImages().catch(() => {}), 8000);
  return () => { clearInterval(timer); clearInterval(pics); clearInterval(fast); clearInterval(who); clearInterval(look); };
}
