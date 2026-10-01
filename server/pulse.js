// Pulse: the live three-column view (new pairs → about to bond → migrated), Axiom style, with the
// AI's rating state for every coin (queued, Grok reading it right now, graded, deep read, buy call).
import { db, json } from "./db.js";
import { recentLaunches, devLaunches } from "./engine.js";
import { candidates, ipfs, bondingProgress } from "./research.js";
import { liveStats, feed } from "./livetrades.js";

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
    const r = await fetch(ipfs(l.uri), { signal: AbortSignal.timeout(6000) });
    const m = await r.json();
    meta.set(l.mint, { image: m.image ? ipfs(m.image) : null, twitter: m.twitter || null, website: m.website || null, telegram: m.telegram || null, description: String(m.description || "").slice(0, 200) });
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
  const rows = db.prepare(`SELECT mint, status, grade, score, tier, verdict, stage, report, t FROM research WHERE mint IN (${mints.map(() => "?").join(",")})`).all(...mints);
  return new Map(rows.map((r) => {
    const rep = json(r.report, {});
    return [r.mint, { status: r.status, grade: r.grade, score: r.score, tier: r.tier, verdict: r.verdict, stage: r.stage, t: r.t,
      action: rep.trade?.action || null, conviction: rep.trade?.conviction ?? null, tag: rep.narrative?.tag || null, organic: rep.xBuzz?.organic || null }];
  }));
}

function row(t, ai) {
  const s = json(t.safety) || {};
  const links = json(t.links, []);
  const link = (re) => links.find((l) => re.test(`${l.type} ${l.url}`))?.url || null;
  return {
    mint: t.mint, symbol: t.symbol, name: t.name, image: t.image, age: now() - (t.pair_created || t.first_seen),
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
      desc: m.description || null, devSol: l.devSol, startMcapSol: l.mcapSol, devCount: devLaunches.get(l.creator) || 1,
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
  cache = { t: now(), v: { newPairs, stretch, migrated, live: { running, queued, ratedHour, launchesPerMin: perMin, tradesPerSec: feed.perSec, feed: feed.connected, solUsd: feed.solUsd }, ts: now() } };
  return cache.v;
}

export function startPulse() {
  const timer = setInterval(enrich, 1500);
  return () => clearInterval(timer);
}
