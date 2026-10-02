// The radar loop: discover → enrich → safety check → score → signals → outcome tracking.
import { EventEmitter } from "node:events";
import { db, q, json, logEvent, prune } from "./db.js";
import * as src from "./sources.js";
import { themesFor } from "./narratives.js";
import { settings } from "./settings.js";
import { startWallets, walletSignals, revalidateWinners } from "./wallets.js";
import { CURVE_DEX, readingProblem, exitState, classifyAsset, safetyVerdict, cleanLinks, safeUrl } from "./quality.js";
import * as health from "./health.js";
import { meta } from "./db.js";

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
      stats.launchesSeen++;
      stats.pumpLast = now();
      const entry = { t: now(), name: t.name || "", symbol: t.symbol || "", creator: t.creator };
      launchLog.push(entry);
      unsaved.push(entry);
      if (t.creator) devLaunches.set(t.creator, (devLaunches.get(t.creator) || 0) + 1);
      if (nursery.size < 20000) nursery.set(t.mint, { ...t, seen: now() });
      recentLaunches.push({ ...t, seen: now(), devCount: t.creator ? devLaunches.get(t.creator) : 1 });
      bus.emit("launch", { mint: t.mint, symbol: t.symbol, name: t.name, mcapSol: t.mcapSol, devSol: t.devSol, devCount: t.creator ? devLaunches.get(t.creator) : 1 });
      if (recentLaunches.length > 200) recentLaunches.splice(0, recentLaunches.length - 200);
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
const pulled = new Set();   // coins whose pool was just emptied; dumpWatch turns these into warnings
function applyPair(mint, p) {
  const links = cleanLinks([
    ...(p.info?.websites || []).map((w) => ({ type: "website", url: w.url })),
    ...(p.info?.socials || []).map((s) => ({ type: s.type, url: s.url })),
  ]);
  const t = q.getToken.get(mint);
  const mcap = p.marketCap || p.fdv || 0, liq = p.liquidity?.usd || 0;
  // A reading from an emptied pool is kept for display (flagged) but never becomes a peak or a return.
  const problem = readingProblem({ dex: p.dexId, liquidity: liq, mcap }, settings.minExitLiq);
  if (problem && !t?.quarantine) {
    stats.quarantined++;
    if (t && !CURVE_DEX.has(t.dex) && (t.liquidity || 0) >= 5 * settings.minExitLiq && liq < settings.minExitLiq) pulled.add(mint);
  }
  const cls = classifyAsset({ ...t, mint, symbol: p.baseToken?.symbol || t?.symbol, name: p.baseToken?.name || t?.name, mcap, liquidity: liq });
  db.prepare(`UPDATE tokens SET
    symbol = COALESCE(?, symbol), name = COALESCE(?, name), image = COALESCE(image, ?), header = COALESCE(?, header),
    pair = ?, dex = ?, pair_created = ?, price = ?, mcap = ?, liquidity = ?,
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
  const pairs = await src.dexTokens([...due, ...scoring]);
  for (const m of [...due, ...scoring]) {
    const p = pairs.get(m);
    if (p) applyPair(m, p);
    else if (!pairs.failed?.has(m)) {
      const t = q.getToken.get(m);
      if (t && now() - t.first_seen > 20 * MIN && !t.pair) db.prepare("UPDATE tokens SET status = 'dead', updated = ? WHERE mint = ?").run(now(), m);
      // It had a market and DexScreener no longer lists one: nothing left to sell into.
      else if (t?.pair && !t.quarantine && now() - (t.price_t || t.updated || 0) > 30 * MIN) db.prepare("UPDATE tokens SET quarantine = 'no longer listed on any DEX' WHERE mint = ?").run(m);
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
  db.prepare("UPDATE tokens SET safety = ?, safety_score = ?, safety_checked = ?, creator = COALESCE(creator, ?) WHERE mint = ?").run(JSON.stringify(s), s.clean, now(), s.creator, mint);
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
  db.prepare("UPDATE tokens SET score = ?, themes = ? WHERE mint = ?").run(score, JSON.stringify(themes), t.mint);
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
    const problem = t.pair ? readingProblem(t, floor) : null;
    fix.run(classifyAsset(t), problem || (t.quarantine?.startsWith("no longer") ? t.quarantine : null), JSON.stringify(cleanLinks(json(t.links, []))), safeUrl(t.image),
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
export function adoptMint(mint) {
  if (q.getToken.get(mint)) return;
  adopt({ mint, source: "wallet" });
}

export function start() {
  stats.lastGap = 0;
  if (meta.get("repair") !== "2") {
    try { rebuildFromSnapshots(); meta.set("repair", "2"); } catch (e) { try { db.exec("ROLLBACK"); } catch {} logEvent("error", `data repair: ${e.message}`); }
  }
  const pump = startPump();
  const stopWallets = startWallets((ev) => {
    bus.emit("walletTrade", ev);
    walletSignals(ev, raise, adoptMint, vet).catch((e) => logEvent("error", `wallet signal: ${e.message}`));
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
