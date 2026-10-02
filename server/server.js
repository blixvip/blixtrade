// Meme Radar — HTTP API + live event stream + dashboard.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, json, logEvent, meta, backup, backups, DB_FILE, DATA, dbStats } from "./db.js";
import { start, bus, stats, launchLog, recentLaunches, raise, adoptMint, verdict, vet, rebuildFromSnapshots } from "./engine.js";
import { computeNarratives, THEMES, themesFor } from "./narratives.js";
import { settings, saveSettings, publicSettings, withOverrides, SECRETS } from "./settings.js";
import { writeBrief, explainCoin, briefProblem } from "./ai.js";
import { notifySignal, notifyBrief, testNotify, decide, rules, destinations, deliveries } from "./notify.js";
import * as wallets from "./wallets.js";
import * as fomo from "./fomo.js";
import * as research from "./research.js";
import * as brain from "./brain.js";
import { pulseData, antiSlop, startPulse, watched, getMeta } from "./pulse.js";
import { startLiveTrades, drainUpdates, liveStats, feed as liveFeed } from "./livetrades.js";
import { startTriage, triageRecord, triageFor } from "./triage.js";
import { testFast } from "./fast.js";
import { testGrok, detectVersion, grokTier } from "./grok.js";
import { exitState, illiquid, onCurve, summarize, firstPerToken, cleanLinks, classifyAsset, ASSET_LABEL } from "./quality.js";
import * as health from "./health.js";
import { startEarly, earlyData } from "./early.js";

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
const tokenOut = (t) => t && ({ ...t, links: cleanLinks(json(t.links, [])), safety: json(t.safety), themes: json(t.themes, []), fresh: freshness(t) });

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

// Last ~6 hours of trusted prices, thinned to 24 points, for the mini charts in tables.
const sparkQ = db.prepare("SELECT price FROM snapshots WHERE mint = ? AND t > ? AND price > 0 AND COALESCE(ok, 1) = 1 ORDER BY t");
function withSpark(list) {
  const since = Date.now() - 6 * HOUR;
  for (const t of list) {
    const ps = sparkQ.all(t.mint, since).map((r) => r.price);
    const step = Math.max(1, Math.ceil(ps.length / 24));
    t.spark = ps.filter((_, i) => i % step === 0 || i === ps.length - 1);
  }
  return list;
}

// ---------- coins ----------
const AGE = "COALESCE(pair_created, first_seen)", TX = "(COALESCE(buys_h1, 0) + COALESCE(sells_h1, 0))";
const SORTS = { score: "score", mcap: "mcap", liq: "liquidity", volume: "vol_h1", new: AGE, change: "chg_h1", chg24: "chg_h24", safety: "safety_score",
  holders: "json_extract(safety, '$.totalHolders')", tx: TX };
// [param, sql expression, comparison]: every numeric filter the Coins page offers.
const RANGES = [
  ["minMcap", "mcap", ">="], ["maxMcap", "mcap", "<="], ["minLiq", "liquidity", ">="], ["maxLiq", "liquidity", "<="],
  ["minVol", "vol_h1", ">="], ["maxVol", "vol_h1", "<="], ["minTx", TX, ">="], ["minSafety", "safety_score", ">="], ["minScore", "score", ">="],
  ["minHolders", "json_extract(safety, '$.totalHolders')", ">="], ["maxTop10", "json_extract(safety, '$.top10')", "<="],
  ["maxDev", "json_extract(safety, '$.devPct')", "<="], ["maxInsider", "json_extract(safety, '$.insiderPct')", "<="],
];
function tokensQuery(p = {}) {
  const where = ["pair IS NOT NULL"], args = [];
  // A search looks everywhere (dead and flagged coins too); browsing shows live, believable, real memecoins.
  if (!p.q) {
    where.push("status = 'active'");
    if (p.unreliable !== "1") where.push("quarantine IS NULL");
    if (p.cls === "other") where.push("COALESCE(asset_class, 'meme') != 'meme'");
    else if (p.cls !== "all") where.push("COALESCE(asset_class, 'meme') = 'meme'");
  }
  if (p.theme) { where.push("themes LIKE ?"); args.push(`%"${p.theme}"%`); }
  for (const [key, expr, op] of RANGES) if (p[key] !== undefined && p[key] !== "" && Number.isFinite(+p[key])) { where.push(`${expr} ${op} ?`); args.push(+p[key]); }
  if (p.minAge) { where.push(`${AGE} <= ?`); args.push(Date.now() - +p.minAge * MIN); }
  if (p.maxAge) { where.push(`${AGE} >= ?`); args.push(Date.now() - +p.maxAge * MIN); }
  if (p.q) { where.push("(symbol LIKE ? OR name LIKE ? OR mint = ?)"); args.push(`%${p.q}%`, `%${p.q}%`, p.q); }
  if (p.graduated === "1") where.push("graduated = 1"); else if (p.graduated === "0") where.push("graduated = 0");
  const expr = SORTS[p.sort] || SORTS.score, dir = p.dir === "asc" ? "ASC" : "DESC";
  const limit = Math.max(1, Math.min(+p.limit || 100, 400)), offset = Math.max(0, +p.offset || 0);
  const total = db.prepare(`SELECT COUNT(*) n FROM tokens WHERE ${where.join(" AND ")}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM tokens WHERE ${where.join(" AND ")} ORDER BY (${expr}) IS NULL, ${expr} ${dir}, mint LIMIT ? OFFSET ?`).all(...args, limit, offset);
  // Lists don't need each coin's full holder list and risk text; the coin page loads those.
  const dup = dupes();
  const slim = (t) => ({ ...t, description: undefined, safety: t.safety && { danger: t.safety.danger, warn: t.safety.warn, top10: t.safety.top10, devPct: t.safety.devPct, insiderPct: t.safety.insiderPct, totalHolders: t.safety.totalHolders, lpLockedPct: t.safety.lpLockedPct },
    dupes: dup.get(String(t.symbol || "").toLowerCase())?.n || 1, dupTop: dup.get(String(t.symbol || "").toLowerCase())?.top === t.mint });
  return { rows: withSpark(rows.map(tokenOut).map(slim)), total, limit, offset, sort: p.sort in SORTS ? p.sort : "score", dir: dir.toLowerCase() };
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
    counts: {
      tracked: count("SELECT COUNT(*) n FROM tokens WHERE status = 'active' AND pair IS NOT NULL"),
      safe: count("SELECT COUNT(*) n FROM tokens WHERE status = 'active' AND pair IS NOT NULL AND quarantine IS NULL AND COALESCE(asset_class, 'meme') = 'meme' AND safety_score >= ?", settings.minSafety),
      signals24h: count("SELECT COUNT(*) n FROM signals WHERE hidden = 0 AND COALESCE(safe, 1) = 1 AND t > ?", day),
      unscreened24h: count("SELECT COUNT(*) n FROM signals WHERE hidden = 0 AND safe = 0 AND t > ?", day),
      graduated24h: count("SELECT COUNT(*) n FROM tokens WHERE graduated = 1 AND first_seen > ?", day),
    },
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
    const nar = computeNarratives({ launches: launchLog });
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
    progress: liveFresh && !t.graduated ? live.progress : row ? research.bondingProgress(row) : null,
    themeOptions: THEMES.map(([n]) => n), classOptions: ASSET_LABEL,
  };
}

// ---------- health ----------
// One list of everything the radar depends on: is it working, when did it last work, what went wrong.
// Crashes, read from the supervisor's log: an exit code the radar did not choose itself (a native fault
// or abort), as opposed to being stopped on purpose.
function crashes(now) {
  const out = { h6: 0, h24: 0, last: null };
  try {
    const file = path.join(DATA, "server.log"), size = fs.statSync(file).size, len = Math.min(size, 200_000);
    const buf = Buffer.alloc(len), fd = fs.openSync(file, "r");
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    for (const m of buf.toString("utf8").matchAll(/radar exited with (\d+) at (\S+)/g)) {
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
    `Running for ${upFor} · crashed ${cr.h24}× in the last 24h${cr.last ? ` (last ${ago(cr.last)})` : ""}${cr.h24 ? " · it restarts itself in about 2 seconds and picks up its recordings" : ""}`,
    { lastFail: cr.last, crashes24h: cr.h24, sql: dbStats });

  const pumpAge = stats.pumpLast ? now - stats.pumpLast : null;
  add("launches", "Launch feed (PumpPortal)", stats.pump !== "connected" ? "down" : pumpAge != null && pumpAge > 90_000 ? "degraded" : "ok",
    stats.pump !== "connected" ? `Socket is ${stats.pump}` : `${stats.launchesSeen.toLocaleString()} launches this session, last one ${ago(stats.pumpLast)}`, { ...hp("pumpportal"), lastOk: stats.pumpLast || null });
  add("trades", "Live pump.fun trades (RPC websocket)", !liveFeed.connected ? "down" : now - liveFeed.lastMsg > 30_000 ? "degraded" : "ok",
    liveFeed.connected ? `${liveFeed.perSec} trades/s, last message ${ago(liveFeed.lastMsg)}` : "Disconnected; reconnecting every 3s", { lastOk: liveFeed.lastMsg || null });
  const scanAge = stats.lastCycle ? now - stats.lastCycle : null;
  add("scan", "Scan loop", scanAge == null ? "idle" : scanAge > 3 * MIN ? "down" : scanAge > 90_000 ? "degraded" : "ok",
    `Last full scan ${ago(stats.lastCycle)} · ${stats.errors} error${stats.errors === 1 ? "" : "s"} this session${health.gaps.length ? ` · paused ${health.gaps.length}× (PC asleep or stopped), last for ${Math.round((health.gaps.at(-1).to - health.gaps.at(-1).from) / MIN)}m` : ""}`,
    { ...hp("scan"), gaps: health.gaps.slice(-5) });
  const svc = (key, name, staleMs) => { const p = hp(key); add(key, name, health.stateOf(key, staleMs), p.lastOk ? `Last answer ${ago(p.lastOk)} · ${p.ok.toLocaleString()} ok, ${p.fail} failed${p.lastFail && p.lastFail > p.lastOk ? ` · failing: ${p.lastError}` : ""}` : p.lastError ? `Never answered: ${p.lastError}` : "Not used yet", p); };
  svc("dexscreener", "Prices (DexScreener)", 3 * MIN);
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
  add("groq", "Groq (optional fast fallback)", !pv.groq.configured ? "off" : pv.groq.cooling.length ? "degraded" : health.stateOf("groq", HOUR),
    pv.groq.configured ? `${pv.groq.calls} calls, ${pv.groq.errors} errors` : "No key saved. Free at console.groq.com/keys; keeps fast reads running when Grok is out.", { ...hp("groq"), lastError: pv.groq.lastError });
  add("claude", "Claude (briefs, fallback reads)", !pv.claude.ok ? "down" : health.stateOf("claude", 3 * HOUR) === "down" ? "degraded" : pv.claude.calls ? health.stateOf("claude", 3 * HOUR) : "idle",
    pv.claude.ok ? `${pv.claude.calls} calls, ${pv.claude.errors} errors, ${pv.claude.truncated} cut off · ${pv.claude.usedThisHour}/${pv.claude.perHour} research reads this hour` : pv.claude.loginError,
    { lastOk: pv.claude.lastOk, lastFail: pv.claude.lastErrorAt, lastError: pv.claude.lastError, fix: pv.claude.ok ? null : "Open Claude Code once on this PC to refresh the login." });
  add("ai-lanes", "Who is reading coins right now", pv.fast.fallback || pv.deep.fallback ? "degraded" : "ok",
    `First reads: ${pv.fast.actualName || "none available"}${pv.fast.fallback ? ` (set to ${pv.fast.configuredName}; ${pv.fast.reason})` : ""} · Deep reads: ${pv.deep.actualName || "none available"}${pv.deep.fallback ? ` (set to ${pv.deep.configuredName}; ${pv.deep.reason})` : ""}`, { fix: pv.recovery });
  add("queue", "Research queue", !qs.perHour && qs.size ? "down" : "ok",
    `${qs.size} waiting (limit ${qs.cap}), oldest ${qs.oldestMin}m · about ${qs.perHour} reads/hour, so ~${qs.etaMin ?? "?"}m to clear · ${qs.expiredHour} dropped as stale or outranked this hour · ${qs.errors} failed in 24h`, qs);
  const sc = brain.scoutStatus();
  add("scout", "Narrative scout", settings.scoutEveryMin <= 0 ? "off" : !sc.available ? "down" : sc.overdue ? "degraded" : "ok",
    sc.why || `Last scouted ${ago(sc.lastOk)}, every ${sc.every}m`, { lastOk: sc.lastOk, lastError: sc.last?.outcome !== "ok" ? sc.last?.detail : null });
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
  if (!withSecrets) for (const k of SECRETS) delete s[k];
  return {
    app: "meme-radar", version: 2, exportedAt: new Date().toISOString(), secretsIncluded: Boolean(withSecrets), settings: s,
    wallets: all("SELECT address, label, source, watching, fomo FROM wallets"), fomoHandles: all("SELECT wallet, handle FROM fomo_handles"),
    alertRules: all("SELECT scope, target, effect, note FROM alert_rules"), playbooks: all("SELECT * FROM playbook"),
    tokenOverrides: all("SELECT mint, class_user, themes_user FROM tokens WHERE class_user IS NOT NULL OR themes_user IS NOT NULL"),
  };
}
function importData(d) {
  if (d?.app !== "meme-radar") throw Object.assign(new Error("That file is not a Meme Radar export."), { status: 400 });
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
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => { b += c; if (b.length > 2e6) req.destroy(); }); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });
// The page only ever loads its own script; coin names, descriptions and links are untrusted text.
const PAGE_HEADERS = {
  "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src * data:; frame-src https://dexscreener.com; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
};
// The radar answers this PC only. A page on another site (or a hostname pointed at 127.0.0.1) must not
// be able to read settings or change them through the browser.
const LOCAL = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
function allowed(req) {
  if (!LOCAL.has(String(req.headers.host || "").toLowerCase())) return false;
  const origin = req.headers.origin;
  if (origin && !LOCAL.has(origin.replace(/^https?:\/\//, "").toLowerCase())) return false;
  return req.method === "GET" || req.headers["sec-fetch-site"] === undefined || ["same-origin", "none"].includes(req.headers["sec-fetch-site"]);
}

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
function cached(key, ms, fn) {
  const c = memo.get(key);
  if (c && Date.now() - c.t < ms) return c.v;
  const v = fn();
  memo.set(key, { t: Date.now(), v });
  return v;
}
const forget = (prefix) => { for (const k of memo.keys()) if (k.startsWith(prefix)) memo.delete(k); };

const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const params = Object.fromEntries(url.searchParams);
  try {
    if (!allowed(req)) return send(res, 403, { error: "Meme Radar only answers this PC." });
    if (!p.startsWith("/api/")) {
      const file = path.join(PUBLIC, p === "/" ? "index.html" : p);
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(200, { "content-type": TYPES[".html"], ...PAGE_HEADERS }); return res.end(staticFile(path.join(PUBLIC, "index.html")));
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", ...PAGE_HEADERS });
      return res.end(staticFile(file));
    }
    if (p === "/api/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: hello\ndata: {}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    const POST = req.method === "POST";
    if (POST || req.method === "DELETE") forget("");
    if (p === "/api/overview") return send(res, 200, cached("overview", 3000, overview));
    if (p === "/api/tokens") return send(res, 200, cached(`tokens${url.search}`, 5000, () => tokensQuery(params)));
    if (p === "/api/signals") return send(res, 200, cached(`signals${url.search}`, 3000, () => signalsQuery(params)));
    if (p === "/api/narratives") return send(res, 200, cached("narratives", 20000, () => computeNarratives({ launches: launchLog })));
    if (p === "/api/perf") return send(res, 200, cached("perf", 60000, perf));
    if (p === "/api/health") return send(res, 200, cached("health", 4000, healthReport));
    if (p === "/api/briefs") return send(res, 200, db.prepare("SELECT * FROM briefs ORDER BY t DESC LIMIT 20").all());
    if (p === "/api/events") return send(res, 200, db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 80").all());
    if (p === "/api/brief" && POST) return send(res, 200, await makeBrief("on demand"));
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
      if (POST) { const b = backup(); logEvent("system", `Backup written (${(b.bytes / 1e6).toFixed(0)} MB)`); }
      return send(res, 200, { backups: backups(), last: +meta.get("backup_t", 0) || null, database: { file: DB_FILE, bytes: fs.statSync(DB_FILE).size } });
    }
    if (p === "/api/repair" && POST) return send(res, 200, rebuildFromSnapshots());
    if (p === "/api/wallets") {
      if (POST) { const b = await readBody(req); return send(res, 200, wallets.addWallet(String(b.address || "").trim(), String(b.label || "").trim())); }
      return send(res, 200, { wallets: wallets.listWallets(), smart: wallets.smartMoney(40), activity: wallets.activity(80), tracking: wallets.tracking(), rpc: { ...wallets.tracking().rpc, custom: !!settings.rpcUrl }, fomo: fomoOverview() });
    }
    if (p === "/api/fomo") return send(res, 200, fomoOverview());
    if (p === "/api/research") return send(res, 200, cached("research", 6000, research.desk));
    if (p === "/api/pulse") return send(res, 200, pulseData());
    if (p === "/api/bot") return send(res, 200, cached("bot", 1000, () => ({ anti: antiSlop(), day: brain.dayData(), live: pulseData().live, scout: research.scoutStats, early: earlyData() })));
    if (p === "/api/triage") return send(res, 200, cached("triage", 30000, triageRecord));
    if (p === "/api/picks") return send(res, 200, cached("picks", 8000, brain.picksData));
    if (p === "/api/picks/review" && POST) { brain.review(true); return send(res, 200, { started: true }); }
    if (p === "/api/picks/scout" && POST) { const s = brain.scoutStatus(); if (s.available) brain.scout(); return send(res, 200, { started: s.available, why: s.why }); }
    const rm = p.match(new RegExp(`^/api/research/(${MINT})$`));
    if (rm) {
      if (POST) {
        let t = db.prepare("SELECT graduated FROM tokens WHERE mint = ?").get(rm[1]);
        // A coin still in the launch feed: start tracking it so it can be researched.
        if (!t && recentLaunches.some((l) => l.mint === rm[1])) { adoptMint(rm[1]); await vet(rm[1]).catch(() => {}); t = db.prepare("SELECT graduated FROM tokens WHERE mint = ?").get(rm[1]); }
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
      const d = tokenDetail(m[1]);
      return d ? send(res, 200, d) : send(res, 404, { error: "The radar has never seen this coin." });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
});

// The same rules decide what is pushed to Discord/Telegram and what the browser pops up as a notification.
bus.on("signal", (s) => {
  const d = decide(s);
  broadcast("signal", { ...signalOut({ ...s, symbol: s.token?.symbol, image: s.token?.image, price_now: s.token?.price, liq_now: s.token?.liquidity, pair: s.token?.pair, dex: s.token?.dex, quarantine: s.token?.quarantine, tstatus: s.token?.status, price_t: s.token?.price_t }), push: d.push, pushWhy: d.why });
  notifySignal(s).catch((e) => logEvent("error", `notify: ${e.message}`));
});
bus.on("tick", (s) => broadcast("tick", s));
bus.on("brief", (b) => broadcast("brief", b));
bus.on("walletTrade", (ev) => broadcast("walletTrade", ev));
// New pump.fun coins go to the page the moment they're created; live trade numbers every 400ms.
bus.on("launch", (l) => { watched.add(l.mint); if (clients.size) broadcast("launch", { ...l, solUsd: liveFeed.solUsd }); });
setInterval(() => {
  if (!clients.size) return;
  const u = drainUpdates(watched);
  if (u.length) broadcast("live", { u, sol: liveFeed.solUsd });
}, 400);

// A bad API response should never take the radar down.
process.on("unhandledRejection", (e) => logEvent("error", `unhandled: ${e?.message || e}`));
process.on("uncaughtException", (e) => logEvent("error", `uncaught: ${e?.message || e}`));

// Also answer on IPv6 loopback: browsers try "localhost" as ::1 first and stall before falling back to IPv4.
const server6 = http.createServer((req, res) => server.emit("request", req, res));
server6.on("error", () => {});
server6.listen(PORT, "::1");
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Meme Radar on http://localhost:${PORT}`);
  start();
  research.startResearch(raise);
  brain.startBrain(raise, research.enqueue);
  startPulse();
  startLiveTrades();
  startTriage(research.enqueue);
  startEarly({ enqueue: research.enqueue, earlyPick: brain.earlyPick });
  // New alert types are switched on once for existing installs (they can be switched off again in Settings).
  const addKind = (flag, kind) => { if (meta.get(flag) !== "1") { saveSettings({ notifyKinds: [...new Set([...settings.notifyKinds, kind])] }); meta.set(flag, "1"); } };
  if (!settings.buyMigrated) saveSettings({ notifyKinds: [...new Set([...settings.notifyKinds, "buy"])], buyMigrated: true });
  addKind("kind_liq_pulled", "liq-pulled");
  addKind("kind_pick", "pick");
  // Grok is out of credits for the month: Claude is the chosen AI for every lane until it is switched back in Settings.
  if (meta.get("claude_lanes_v25") !== "1") { saveSettings({ fastProvider: "claude", deepProvider: "claude" }); meta.set("claude_lanes_v25", "1"); }
  // Deep second opinions now go to every coin the first read would trade: give that lane more room.
  if (meta.get("deep_cap_v21") !== "1") { if (settings.researchPerHour < 40) saveSettings({ researchPerHour: 40 }); meta.set("deep_cap_v21", "1"); }
  // Fast first reads moved to Claude Haiku while Grok is out: give that lane room to keep up with launches.
  if (meta.get("fast_cap_v17") !== "1") { if (settings.fastPerHour < 200) saveSettings({ fastPerHour: 200 }); meta.set("fast_cap_v17", "1"); }
  // Briefs written before completeness was checked: mark the ones that were cut off.
  if (meta.get("briefs_checked") !== "1") {
    for (const b of db.prepare("SELECT id, body FROM briefs").all()) { const why = briefProblem(b.body); if (why) db.prepare("UPDATE briefs SET status = 'partial', stop = ? WHERE id = ?").run(why, b.id); }
    meta.set("briefs_checked", "1");
  }
  detectVersion().then(grokTier).catch(() => {});
  const syncSol = () => wallets.solPrice().then(research.setSolPrice).catch(() => {});
  syncSol(); setInterval(syncSol, 5 * MIN);
  fomo.startFomo({
    addWallet: wallets.addWallet,
    raise, adoptMint, vet,
    onTrade: (tr) => broadcast("fomoTrade", { ...tr, handle: fomo.handleOf(tr.wallet) }),
  });
  // First brief once there's data to talk about, then on schedule.
  const tryBrief = () => settings.aiBriefs && makeBrief().catch((e) => logEvent("error", `brief: ${e.message}`));
  setTimeout(tryBrief, 12 * MIN);
  setInterval(() => {
    const last = db.prepare("SELECT t FROM briefs ORDER BY t DESC LIMIT 1").get();
    if (!last || Date.now() - last.t >= settings.briefEveryMin * MIN) tryBrief();
  }, 5 * MIN);
  // A daily copy of the database, so a corrupted or lost file costs at most a day.
  setInterval(() => {
    if (Date.now() - +meta.get("backup_t", 0) < DAY) return;
    try { const b = backup(); logEvent("system", `Daily backup written (${(b.bytes / 1e6).toFixed(0)} MB)`); } catch (e) { logEvent("error", `backup: ${e.message}`); }
  }, 30 * MIN);
});
