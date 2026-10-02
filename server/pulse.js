// Pulse: the live three-column view (new pairs → about to bond → migrated), Axiom style, with the
// AI's rating state for every coin (queued, Grok reading it right now, graded, deep read, buy call).
import { db, q, json } from "./db.js";
import { recentLaunches, devLaunches } from "./engine.js";
import { candidates, ipfs, bondingProgress, providers, queueStatus, liveTraction } from "./research.js";
import { safeUrl, publicUrl, cleanLinks } from "./quality.js";
import { liveStats, feed } from "./livetrades.js";
import { triageFor, triageStats } from "./triage.js";
import { earlyFor } from "./early.js";
import { grokStatus } from "./grok.js";
export const getMeta = (mint) => meta.get(mint);

// Mints currently on the Pulse page; the live trade feed only pushes updates for these.
export const watched = new Set();

// Overlay the live trade feed on a row (fresher than DexScreener for coins still on the curve).
function withLive(r) {
  const x = liveStats(r.mint);
  if (!x || now() - x.last > 15 * MIN) return r;
  return { ...r, mcap: x.mc, buys: r.graduated ? r.buys : x.buys, sells: r.graduated ? r.sells : x.sells, liveVol: x.vol, traders: x.traders,
    progress: r.graduated ? r.progress : x.progress, chg1m: x.chg1m, side: x.side, lastTrade: x.last, live: true };
}

const now = () => Date.now();
const MIN = 60_000;

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
  } catch { meta.set(l.mint, { failed: true }); }
  finally { fetching--; }
}
function enrich() {
  // Newest first, a few at a time: the gateway is free, so stay polite.
  for (let i = recentLaunches.length - 1; i >= Math.max(0, recentLaunches.length - 60) && fetching < 5; i--) {
    const l = recentLaunches[i];
    if (l.uri && !meta.has(l.mint)) fetchMeta(l);
  }
  if (meta.size > 3000) for (const k of [...meta.keys()].slice(0, 1000)) meta.delete(k);
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
    mcap: t.mcap, vol: t.vol_h1, liq: t.liquidity, chg5: t.chg_m5, chg1h: t.chg_h1, buys: t.buys_h1, sells: t.sells_h1,
    holders: s.totalHolders ?? null, top10: s.top10 ?? null, dev: s.devPct ?? null, insiders: s.insiderPct ?? null,
    safety: t.safety_score, danger: (s.danger || 0) > 0, progress: t.progress ?? bondingProgress(t), graduated: !!t.graduated,
    x: link(/twitter|x\.com/i), web: links.find((l) => l.type === "website")?.url || null, tg: link(/telegram|t\.me/i),
    ai: ai || null,
  };
}

let cache = { t: 0, v: null };
export function pulseData() {
  if (now() - cache.t < 1500 && cache.v) return cache.v;
  const { near, bonded } = candidates();
  // New pairs: the newest launches, joined with the radar's data once it starts tracking them.
  const fresh = recentLaunches.slice(-60).reverse();
  const tracked = fresh.length ? new Map(db.prepare(`SELECT * FROM tokens WHERE mint IN (${fresh.map(() => "?").join(",")})`).all(...fresh.map((l) => l.mint)).map((t) => [t.mint, t])) : new Map();
  const all = [...fresh.map((l) => l.mint), ...near.slice(0, 50).map((t) => t.mint), ...bonded.slice(0, 50).map((t) => t.mint)];
  const ai = researchMap([...new Set(all)]);
  const newPairs = fresh.filter((l) => { const t = tracked.get(l.mint); return !t || now() - (t.pair_created || t.first_seen) < 24 * 60 * MIN; }).map((l) => {
    const t = tracked.get(l.mint);
    const m = meta.get(l.mint) || {};
    const base = t ? row(t, ai.get(l.mint)) : {
      mint: l.mint, symbol: l.symbol, name: l.name, image: null, age: now() - l.seen, mcap: null, ai: ai.get(l.mint) || null,
    };
    const age = now() - l.seen;
    return { ...base, image: base.image || m.image || null, x: base.x || m.twitter, web: base.web || m.website, tg: base.tg || m.telegram,
      desc: m.description || null, devSol: l.devSol, early: earlyFor(l.mint), tri: triageFor(l.mint), startMcapSol: l.mcapSol, devCount: devLaunches.get(l.creator) || 1,
      state: t ? "tracked" : age < 4.5 * MIN ? "watching" : "faded" };
  }).map(withLive);
  // A coin that's still trading isn't faded, whatever the 4-minute check said.
  for (const r of newPairs) if (r.state === "faded" && r.lastTrade && now() - r.lastTrade < 2 * MIN) r.state = "watching";
  const stretch = near.slice(0, 50).map((t) => withLive(row(t, ai.get(t.mint))));
  const migrated = bonded.filter((t) => (t.mcap || 0) >= 5000).slice(0, 50).map((t) => row(t, ai.get(t.mint)));
  const running = db.prepare("SELECT COUNT(*) n FROM research WHERE status = 'running'").get().n;
  const queued = db.prepare("SELECT COUNT(*) n FROM research WHERE status IN ('queued', 'deep')").get().n;
  const ratedHour = db.prepare("SELECT COUNT(*) n FROM research WHERE t > ? AND status IN ('done', 'deep')").get(now() - 60 * MIN).n;
  const perMin = recentLaunches.filter((l) => l.seen > now() - MIN).length;
  watched.clear();
  for (const r of [...newPairs, ...stretch, ...migrated]) watched.add(r.mint);
  const pv = providers(), qs = queueStatus();
  // Who is actually doing the reading right now, and why it may differ from what was configured.
  const lanes = { fast: pv.fast.actualName, deep: pv.deep.actualName, fastFallback: pv.fast.fallback ? pv.fast.reason : null, deepFallback: pv.deep.fallback ? pv.deep.reason : null, note: pv.fast.note || pv.deep.note, recovery: pv.recovery };
  cache = { t: now(), v: { newPairs, stretch, migrated, live: { running, queued, ratedHour, launchesPerMin: perMin, tradesPerSec: feed.perSec, feed: feed.connected, solUsd: feed.solUsd, triage: triageStats, grokBlocked: grokStatus().blocked, ai: lanes, queue: qs }, ts: now() } };
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
  const timer = setInterval(enrich, 1500);
  const pics = setInterval(() => fillImages().catch(() => {}), 20_000);
  setTimeout(() => fillImages().catch(() => {}), 8000);
  return () => { clearInterval(timer); clearInterval(pics); };
}
