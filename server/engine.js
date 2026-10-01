// The radar loop: discover → enrich → safety check → score → signals → outcome tracking.
import { EventEmitter } from "node:events";
import { db, q, json, logEvent, prune } from "./db.js";
import * as src from "./sources.js";
import { themesFor } from "./narratives.js";
import { settings } from "./settings.js";
import { startWallets, walletSignals } from "./wallets.js";

export const bus = new EventEmitter();
export const stats = { launchesSeen: 0, nursery: 0, graduated: 0, tracked: 0, signals: 0, pump: "connecting", lastCycle: 0, errors: 0, startedAt: Date.now() };

const now = () => Date.now();
const MIN = 60_000;

// ---------- discovery ----------
// Brand-new pump.fun launches wait here; most die within minutes, so we only look at them later.
const nursery = new Map(); // mint -> { seen, symbol, name, source }
// Every launch name in the last 6h, for narrative trends (~30k short strings at most).
export const launchLog = [];
// How many coins each dev wallet launched in the last 6h (serial launchers are mostly rugs).
export const devLaunches = new Map();

// The launch log is kept in SQLite too, so a restart doesn't wipe 6 hours of narrative history.
db.exec("CREATE TABLE IF NOT EXISTS launches (t INTEGER, name TEXT, symbol TEXT, creator TEXT)");
db.exec("CREATE INDEX IF NOT EXISTS launches_t ON launches(t)");
for (const l of db.prepare("SELECT t, name, symbol, creator FROM launches WHERE t > ? ORDER BY t").all(Date.now() - 6 * 3600e3)) {
  launchLog.push(l);
  if (l.creator) devLaunches.set(l.creator, (devLaunches.get(l.creator) || 0) + 1);
}
let unsaved = [];
function saveLaunches() {
  if (!unsaved.length) return;
  const ins = db.prepare("INSERT INTO launches (t, name, symbol, creator) VALUES (?, ?, ?, ?)");
  db.exec("BEGIN");
  for (const l of unsaved) ins.run(l.t, l.name, l.symbol, l.creator || null);
  db.exec("COMMIT");
  unsaved = [];
  db.prepare("DELETE FROM launches WHERE t < ?").run(Date.now() - 6 * 3600e3);
}

function adopt(t) {
  if (!t.mint || q.getToken.get(t.mint)) {
    if (t.mint && t.boosts) db.prepare("UPDATE tokens SET boosts = MAX(boosts, ?) WHERE mint = ?").run(t.boosts, t.mint);
    if (t.mint && t.description) db.prepare("UPDATE tokens SET description = COALESCE(NULLIF(description,''), ?) WHERE mint = ?").run(t.description, t.mint);
    return false;
  }
  q.insertToken.run(t.mint, t.symbol || null, t.name || null, t.description || "", t.image || null, t.source, now(), JSON.stringify(t.links || []), 0);
  if (t.boosts) db.prepare("UPDATE tokens SET boosts = ? WHERE mint = ?").run(t.boosts, t.mint);
  if (t.creator) db.prepare("UPDATE tokens SET creator = ?, dev_sol = ? WHERE mint = ?").run(t.creator, t.devSol ?? null, t.mint);
  if (t.uri) db.prepare("UPDATE tokens SET uri = ? WHERE mint = ?").run(t.uri, t.mint);
  safetyQueue.add(t.mint);
  return true;
}

function startPump() {
  return src.pumpStream({
    onStatus: (s) => { stats.pump = s; },
    onToken: (t) => {
      stats.launchesSeen++;
      const entry = { t: now(), name: t.name || "", symbol: t.symbol || "", creator: t.creator };
      launchLog.push(entry);
      unsaved.push(entry);
      if (t.creator) devLaunches.set(t.creator, (devLaunches.get(t.creator) || 0) + 1);
      if (nursery.size < 20000) nursery.set(t.mint, { ...t, seen: now() });
    },
    onMigration: ({ mint }) => {
      stats.graduated++;
      nursery.delete(mint);
      adopt({ mint, source: "pump-graduated" });
      db.prepare("UPDATE tokens SET graduated = 1 WHERE mint = ?").run(mint);
      pendingGraduations.add(mint);
    },
  });
}
const pendingGraduations = new Set();

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
  const pairs = await src.dexTokens(ripe.map((t) => t.mint));
  let kept = 0;
  for (const t of ripe) {
    const p = pairs.get(t.mint);
    if (!p) continue;
    const mcap = p.marketCap || p.fdv || 0, vol = p.volume?.m5 || 0;
    if (mcap >= settings.nurseryMinMcap || vol >= settings.nurseryMinVol5m) {
      if (adopt({ ...t, source: "pump-live" })) { applyPair(t.mint, p); kept++; }
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
function applyPair(mint, p) {
  const links = [
    ...(p.info?.websites || []).map((w) => ({ type: "website", url: w.url })),
    ...(p.info?.socials || []).map((s) => ({ type: s.type, url: s.url })),
  ];
  const t = q.getToken.get(mint);
  const mcap = p.marketCap || p.fdv || 0;
  db.prepare(`UPDATE tokens SET
    symbol = COALESCE(?, symbol), name = COALESCE(?, name), image = COALESCE(image, ?), header = COALESCE(?, header),
    pair = ?, dex = ?, pair_created = ?, price = ?, mcap = ?, liquidity = ?,
    vol_m5 = ?, vol_h1 = ?, vol_h24 = ?, buys_m5 = ?, sells_m5 = ?, buys_h1 = ?, sells_h1 = ?,
    chg_m5 = ?, chg_h1 = ?, chg_h24 = ?, links = ?, updated = ?, peak_mcap = MAX(COALESCE(peak_mcap, 0), ?),
    graduated = CASE WHEN ? THEN 1 ELSE graduated END
    WHERE mint = ?`).run(
    p.baseToken?.symbol || null, p.baseToken?.name || null, p.info?.imageUrl || null, p.info?.header || null,
    p.pairAddress, p.dexId, p.pairCreatedAt || null, +p.priceUsd || 0, mcap, p.liquidity?.usd || 0,
    p.volume?.m5 || 0, p.volume?.h1 || 0, p.volume?.h24 || 0,
    p.txns?.m5?.buys || 0, p.txns?.m5?.sells || 0, p.txns?.h1?.buys || 0, p.txns?.h1?.sells || 0,
    p.priceChange?.m5 ?? 0, p.priceChange?.h1 ?? 0, p.priceChange?.h24 ?? 0,
    JSON.stringify(links.length ? links : json(t?.links, [])), now(), mcap,
    p.dexId === "pumpswap" ? 1 : 0, mint);
  q.snapshot.run(mint, now(), +p.priceUsd || 0, mcap, p.liquidity?.usd || 0, p.volume?.m5 || 0);
}

async function refreshActive() {
  const rows = q.activeMints.all();
  stats.tracked = rows.length;
  if (!rows.length) return;
  // Hot tokens every cycle, the rest every few cycles.
  const cyc = Math.floor(now() / (30 * 1000));
  const due = rows.filter((r) => r.score >= 50 || r.updated === 0 || cyc % 4 === 0 || now() - r.updated > 3 * MIN).map((r) => r.mint);
  const pairs = await src.dexTokens(due);
  for (const m of due) {
    const p = pairs.get(m);
    if (p) applyPair(m, p);
    else {
      const t = q.getToken.get(m);
      if (t && now() - t.first_seen > 20 * MIN && !t.pair) db.prepare("UPDATE tokens SET status = 'dead', updated = ? WHERE mint = ?").run(now(), m);
    }
  }
  for (const m of due) { const t = q.getToken.get(m); if (t?.pair) rescore(t); }
  cull();
}

// Retire tokens that are clearly finished, and cap the watch list.
function cull() {
  const age = (t) => now() - t.first_seen;
  const rows = db.prepare("SELECT mint, first_seen, mcap, liquidity, vol_h1, score FROM tokens WHERE status = 'active'").all();
  const dead = rows.filter((t) =>
    (age(t) > 45 * MIN && (t.mcap || 0) < 6000) ||
    (age(t) > 3 * 60 * MIN && (t.vol_h1 || 0) < 500) ||
    (age(t) > 36 * 60 * MIN && (t.score || 0) < 40));
  const kill = db.prepare("UPDATE tokens SET status = 'dead', updated = ? WHERE mint = ?");
  for (const t of dead) kill.run(now(), t.mint);
  const alive = rows.length - dead.length;
  if (alive > settings.maxTracked) {
    const extra = db.prepare("SELECT mint FROM tokens WHERE status = 'active' ORDER BY score ASC, first_seen ASC LIMIT ?").all(alive - settings.maxTracked);
    for (const t of extra) kill.run(now(), t.mint);
  }
}

// ---------- safety ----------
const safetyQueue = new Set();
async function runSafety() {
  const stale = db.prepare(`SELECT mint FROM tokens WHERE status = 'active' AND score >= 50 AND (safety_checked IS NULL OR safety_checked < ?) ORDER BY score DESC LIMIT 10`).all(now() - 12 * MIN);
  for (const r of stale) safetyQueue.add(r.mint);
  const batch = [...safetyQueue].slice(0, 12);
  for (const mint of batch) {
    safetyQueue.delete(mint);
    try {
      const before = q.getToken.get(mint);
      const prev = json(before?.safety);
      const s = await src.rugcheck(mint);
      db.prepare("UPDATE tokens SET safety = ?, safety_score = ?, safety_checked = ?, creator = COALESCE(creator, ?) WHERE mint = ?").run(JSON.stringify(s), s.clean, now(), s.creator, mint);
      const t = q.getToken.get(mint);
      const watched = (t.score || 0) >= 45 || q.lastSignal.get(mint, "launch") || q.lastSignal.get(mint, "momentum") || q.lastSignal.get(mint, "smart");
      if (watched && prev && prev.devPct >= 1 && s.devPct < 0.2 && cooldownOk(mint, "dev-sold", 1e12))
        raise(t, "dev-sold", `Dev sold $${t.symbol}`, `The creator held ${prev.devPct.toFixed(1)}% and now holds ${s.devPct.toFixed(2)}%. Mcap ${fmt$(t.mcap)}.`);
      if (watched && s.rugged && !prev?.rugged && cooldownOk(mint, "rugged", 1e12))
        raise(t, "rugged", `$${t.symbol} flagged as rugged`, `RugCheck marks this coin as rugged. Mcap ${fmt$(t.mcap)}, liquidity ${fmt$(t.liquidity)}.`);
    } catch (e) {
      if (e.status === 429) { safetyQueue.add(mint); break; }
      db.prepare("UPDATE tokens SET safety_checked = ? WHERE mint = ?").run(now(), mint);
    }
  }
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

function isSafe(t) {
  const s = json(t.safety);
  if (t.creator && (devLaunches.get(t.creator) || 0) >= 4) return false; // serial launcher
  return s && s.danger === 0 && !s.rugged && (t.safety_score ?? 0) >= settings.minSafety;
}

function cooldownOk(mint, kind, ms) {
  const last = q.lastSignal.get(mint, kind);
  return !last || now() - last.t > ms;
}

export function raise(t, kind, title, detail, hidden = 0) {
  q.addSignal.run(t.mint, kind, now(), title, detail, t.score, t.price, t.mcap);
  const sig = db.prepare("SELECT * FROM signals WHERE id = last_insert_rowid()").get();
  if (hidden) { db.prepare("UPDATE signals SET hidden = 1 WHERE id = ?").run(sig.id); return; }
  stats.signals++;
  bus.emit("signal", { ...sig, token: q.getToken.get(t.mint) });
}

const fmt$ = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n || 0)}`;
const MILESTONES = [10e6, 5e6, 1e6, 500e3, 100e3];

function rescore(t) {
  const score = scoreToken(t);
  const themes = themesFor(t);
  db.prepare("UPDATE tokens SET score = ?, themes = ? WHERE mint = ?").run(score, JSON.stringify(themes), t.mint);
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
    AND kind NOT IN ('dump', 'dev-sold', 'rugged', 'smart') AND kind NOT LIKE 'wallet:%'`).get(t.mint, now() - 20 * MIN);
  if (recent && found[0][0] !== "graduated") {
    for (const r of found) raise(t, r[0], r[1], r[2], 1); // remember them so they don't fire right after
    return;
  }
  const [lead, ...rest] = found;
  raise(t, lead[0], lead[1], [lead[2], ...rest.map((r) => r[1] + ".")].join(" "));
  for (const r of rest) raise(t, r[0], r[1], r[2], 1);
}

// Warn about coins we signalled that then dumped hard.
function dumpWatch() {
  const rows = db.prepare(`SELECT DISTINCT t.* FROM tokens t JOIN signals s ON s.mint = t.mint
    WHERE s.t > ? AND s.hidden = 0 AND s.kind NOT IN ('dump', 'dev-sold', 'rugged') AND t.peak_mcap >= 40000 AND t.mcap < t.peak_mcap * 0.4`).all(now() - 24 * 60 * MIN);
  for (const t of rows) if (cooldownOk(t.mint, "dump", 12 * 60 * MIN))
    raise(t, "dump", `Warning: $${t.symbol} is down ${Math.round(100 - 100 * t.mcap / t.peak_mcap)}% from its peak`, `Peak ${fmt$(t.peak_mcap)}, now ${fmt$(t.mcap)}. Liquidity ${fmt$(t.liquidity)}.`);
}

// ---------- outcomes ----------
function trackOutcomes() {
  const open = q.openSignals.all(now() - 25 * 60 * MIN);
  const upd = db.prepare("UPDATE signals SET p15 = COALESCE(p15, ?), p1h = COALESCE(p1h, ?), p6h = COALESCE(p6h, ?), p24h = COALESCE(p24h, ?), peak = MAX(COALESCE(peak, 0), ?) WHERE id = ?");
  for (const s of open) {
    if (!s.price || s.kind === "dump") continue;
    const t = q.getToken.get(s.mint);
    if (!t) continue;
    const x = t.status === "dead" && !t.price ? 0 : (t.price || 0) / s.price;
    const age = now() - s.t;
    upd.run(age >= 15 * MIN ? x : null, age >= 60 * MIN ? x : null, age >= 6 * 60 * MIN ? x : null, age >= 24 * 60 * MIN ? x : null, x, s.id);
  }
}

// ---------- loop ----------
let running = false;
async function cycle() {
  if (running) return;
  running = true;
  try {
    await graduateNursery();
    await refreshActive();
    await runSafety();
    for (const mint of pendingGraduations) { const t = q.getToken.get(mint); if (t?.pair) rescore(t); }
    dumpWatch();
    trackOutcomes();
    stats.lastCycle = now();
    bus.emit("tick", stats);
  } catch (e) {
    stats.errors++;
    logEvent("error", e.message);
  } finally {
    running = false;
  }
}

// Fetch a coin's market data right away (used before alerting on a coin we just heard about).
export async function enrichNow(mint) {
  const p = (await src.dexTokens([mint])).get(mint);
  if (p) { applyPair(mint, p); safetyQueue.add(mint); }
}

export function adoptMint(mint) {
  if (q.getToken.get(mint)) return;
  adopt({ mint, source: "wallet" });
}

export function start() {
  const pump = startPump();
  const stopWallets = startWallets((ev) => {
    bus.emit("walletTrade", ev);
    walletSignals(ev, raise, adoptMint, enrichNow).catch((e) => logEvent("error", `wallet signal: ${e.message}`));
  });
  discoverFeeds().then(cycle);
  const timers = [
    setInterval(cycle, 30_000),
    setInterval(discoverFeeds, 90_000),
    setInterval(prune, 60 * MIN),
  ];
  logEvent("system", "Radar started");
  return () => { pump.stop(); stopWallets(); timers.forEach(clearInterval); };
}
