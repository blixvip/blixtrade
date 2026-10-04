// Early radar: find the coins that are going to run in their first seconds and minutes, and prove it.
//
// Every launch is recorded from its first trade. At fixed moments in its life (30s, 60s, 2m, 5m) the
// radar notes what the coin looks like (traders, buy pressure, volume, whales, the dev, socials) and
// then follows it trade by trade: did the price double before it fell 40%? Those answered questions
// are the training set. A small statistical model (logistic regression) is refitted on them every
// 10 minutes and tested on launches it has never seen (the newest 30%). Only a model that beats the
// base rate on that unseen set is used: to send a coin for an AI read immediately, and to put the very
// strongest on the entry watch at once, before the AI has answered.
//
// Nothing here is assumed. Until enough launches have been recorded the model is "learning" and does
// nothing; if it stops beating the base rate it switches itself off. The dashboard shows the numbers.
import fs from "node:fs";
import path from "node:path";
import { db, json, meta, logEvent, DATA } from "./db.js";
import { settings } from "./settings.js";
import { live, feed, onLiveTrade, RESUME_MS, restored as liveRestored } from "./livetrades.js";
import { recentLaunches, devLaunches, adoptLaunch } from "./engine.js";
import { getMeta } from "./pulse.js";
import { triageFor } from "./triage.js";
import { PAPER } from "./brain.js";

db.exec(`CREATE TABLE IF NOT EXISTS early (
  mint TEXT, cp INTEGER, t INTEGER, symbol TEXT, entry REAL, feat TEXT, p REAL,
  res TEXT, fill REAL, maxm REAL, endm REAL, done_t INTEGER, PRIMARY KEY (mint, cp)
)`);
db.exec("CREATE INDEX IF NOT EXISTS early_t ON early(t)");
db.exec(`CREATE TABLE IF NOT EXISTS launch_winners (mint TEXT PRIMARY KEY, symbol TEXT, t0 INTEGER, start REAL, ath REAL, ath_t INTEGER)`);

const now = () => Date.now();
const MIN = 60_000;
const cost = () => (1 - PAPER.costPctPerSide / 100) / (1 + PAPER.costPctPerSide / 100);
export const CPS = [30, 60, 120, 300];          // seconds after the first trade
const HORIZON = 30 * MIN;                        // how long each question stays open
const WIN = 2, STOP = 0.6;                       // the question: 2x before -40%?
const MIN_SAMPLES = 300, MIN_WINS = 15;
export const WINNER_USD = 30000;                 // a "real winner": a launch that reached this market cap

const launches = new Map();   // mint -> launch, kept for 3 hours
const sent = new Set();       // launches already handed to the AI
let tickN = 0;
const recs = new Map();       // mint -> { t0, l, mc0, big, maxBuy, cps: [], next, prev }
const scores = new Map();     // mint -> latest { p, cp, strong, top, t }
const models = new Map();     // cp -> fitted model
export const earlyStats = { recording: 0, checkpoints: 0, resolved: 0, flagged: 0, entered: 0, lastTrain: null };
let enqueueFn = null, earlyPickFn = null;

// ---------- recording ----------
function onTrade(mint, s, sol, buy) {
  if (s.pad) return;                                     // the launch model is fitted on pump.fun launches only
  let r = recs.get(mint);
  if (!r) {
    const l = launches.get(mint);
    if (!l || now() - s.first > 20_000) return;          // only coins followed from their first seconds
    r = { t0: s.first, l, mc0: s.mc0, big: 0, maxBuy: 0, cps: [], next: 0, prev: null };
    recs.set(mint, r);
  }
  r.lastMc = s.mc;
  if (buy) { if (sol >= 1) r.big++; if (sol > r.maxBuy) r.maxBuy = sol; }
  for (const c of r.cps) {
    if (s.mc > c.hi) c.hi = s.mc;
    if (c.res) continue;
    // A take-profit order fills at its level. A stop fills at whatever the dumping trade left behind.
    if (s.mc >= WIN * c.entry) { c.res = "win"; c.fill = WIN; c.dirty = true; }
    else if (s.mc <= STOP * c.entry) { c.res = "loss"; c.fill = s.mc / c.entry; c.dirty = true; }
  }
}

const LOG = (v) => Math.log1p(Math.max(0, v || 0));
export const FEATURES = ["traders", "buys", "sells", "buyShare", "vol", "volPerTrader", "mult", "offHigh", "big", "maxBuy", "devSol", "devCount", "rules", "triScore", "hasX", "hasTweet", "hasWeb", "hasTg", "newTraders", "tradesPerSec", "recentBuyShare"];
function features(r, s, cp) {
  const m = getMeta(r.l.mint) || {}, tri = triageFor(r.l.mint) || {}, p = r.prev;
  const tx = s.buys + s.sells, dt = p ? cp - p.cp : cp;
  const dBuys = s.buys - (p?.buys || 0), dSells = s.sells - (p?.sells || 0);
  return {
    traders: LOG(s.traders.size), buys: LOG(s.buys), sells: LOG(s.sells), buyShare: tx ? s.buys / tx : 0.5,
    vol: LOG(s.vol), volPerTrader: LOG(s.vol / Math.max(1, s.traders.size)), mult: Math.min(8, s.mc / r.mc0), offHigh: s.ath ? s.mc / s.ath : 1,
    big: LOG(r.big), maxBuy: LOG(r.maxBuy), devSol: LOG(+r.l.devSol || 0), devCount: LOG(devLaunches.get(r.l.creator) || 1),
    rules: (tri.rules ?? 40) / 100, triScore: (tri.score ?? tri.rules ?? 40) / 100,
    hasX: m.twitter ? 1 : 0, hasTweet: /\/status\//.test(m.twitter || "") ? 1 : 0, hasWeb: m.website ? 1 : 0, hasTg: m.telegram ? 1 : 0,
    newTraders: LOG(s.traders.size - (p?.traders || 0)), tradesPerSec: (dBuys + dSells) / Math.max(1, dt), recentBuyShare: dBuys + dSells ? dBuys / (dBuys + dSells) : 0.5,
  };
}

function tick() {
  // Launches the radar has heard about, by mint.
  for (const l of recentLaunches.slice(-80)) if (!launches.has(l.mint)) launches.set(l.mint, l);
  if (launches.size > 2000 && tickN % 60 === 0) for (const [m, l] of launches) if (now() - l.seen > 180 * MIN) { launches.delete(m); sent.delete(m); }
  // Take-off watch. The launch feed only shows the newest few minutes, so a coin that started moving later
  // than that used to be invisible until it was already big. Every launch from the last 3 hours is checked
  // against the live trade feed every 2 seconds: real, different buyers arriving means it is read now.
  if (tickN++ % 2 === 0) {
    for (const [mint, l] of launches) {
      if (sent.has(mint)) continue;
      const s = live.get(mint);
      if (!s || now() - s.last > 60_000) continue;
      const tr = s.traders.size;
      if (!((tr >= 20 && s.buys > s.sells) || (tr >= 10 && s.mc >= 2.5 * s.mc0))) continue;
      sent.add(mint);
      earlyStats.noticed = (earlyStats.noticed || 0) + 1;
      adoptLaunch(l).then(() => enqueueFn?.(mint, (s.progress ?? 0) >= 0.6 ? "near" : "new", 4e11 + Math.min(999, tr) * 1e6)).catch(() => {});
    }
  }
  const ins = db.prepare("INSERT OR IGNORE INTO early (mint, cp, t, symbol, entry, feat, p) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const upd = db.prepare("UPDATE early SET res = ?, fill = ?, maxm = ?, endm = ?, done_t = ? WHERE mint = ? AND cp = ?");
  let wrote = false;
  const begin = () => { if (!wrote) { db.exec("BEGIN"); wrote = true; } };
  try {
    for (const [mint, r] of recs) {
      const s = live.get(mint), age = now() - r.t0, mc = s ? s.mc : r.lastMc || r.mc0;
      while (s && r.next < CPS.length && age >= CPS[r.next] * 1000) {
        const cp = CPS[r.next++];
        // A coin nobody is trading is not a candidate and would only teach the model that dead coins are dead.
        if (s.traders.size >= 5 && s.mc > 0 && now() - s.last < 60_000 && age < (cp + 20) * 1000) {
          const feat = features(r, s, cp), sc = score(cp, feat);
          const c = { cp, entry: s.mc, hi: s.mc, res: null, fill: null, feat, p: sc?.p ?? null };
          r.cps.push(c);
          begin(); ins.run(mint, cp, now(), r.l.symbol == null ? null : String(r.l.symbol), s.mc, JSON.stringify(feat), c.p);
          earlyStats.checkpoints++;
          if (sc) { scores.set(mint, { ...sc, cp, t: now() }); act(r, c, sc); }
        }
        r.prev = { cp, traders: s.traders.size, buys: s.buys, sells: s.sells };
      }
      const over = !s || age > HORIZON + CPS[CPS.length - 1] * 1000;
      for (const c of r.cps) {
        if (over && !c.res) { c.res = "flat"; c.fill = mc / c.entry; c.dirty = true; }
        if (c.dirty || (over && c.res)) {
          begin(); upd.run(c.res, c.fill, c.hi / c.entry, mc / c.entry, now(), mint, c.cp);
          if (c.dirty) earlyStats.resolved++;
          c.dirty = false;
        }
      }
      if (over || (r.next >= CPS.length && !r.cps.length)) recs.delete(mint);
    }
    if (wrote) db.exec("COMMIT");
  } catch (e) { if (wrote) try { db.exec("ROLLBACK"); } catch {} throw e; }
  earlyStats.recording = recs.size;
  if (scores.size > 3000) for (const [m, v] of scores) if (now() - v.t > 40 * MIN) scores.delete(m);
}

// ---------- the model ----------
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
// What one paper trade returned: the take-profit level, the actual stop fill, or the price when time ran out.
const result = (row) => (row.res === "win" ? WIN : row.fill ?? row.endm ?? 1) * cost();
const vec = (f) => FEATURES.map((k) => Number(f[k]) || 0);

export function fit(X, y, { iters = 500, lr = 0.2, l2 = 0.01 } = {}) {
  const n = X.length, d = X[0].length;
  const mu = Array(d).fill(0), sd = Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mu[j] += x[j] / n;
  for (const x of X) for (let j = 0; j < d; j++) sd[j] += (x[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((x) => x.map((v, j) => (v - mu[j]) / sd[j]));
  const w = Array(d).fill(0);
  const base = y.reduce((a, b) => a + b, 0) / n;
  let b = Math.log(Math.max(1e-4, base) / Math.max(1e-4, 1 - base));
  for (let it = 0; it < iters; it++) {
    const g = Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const e = sigmoid(z) - y[i];
      gb += e / n;
      for (let j = 0; j < d; j++) g[j] += (e * Z[i][j]) / n;
    }
    b -= lr * gb;
    for (let j = 0; j < d; j++) w[j] -= lr * (g[j] + l2 * w[j]);
  }
  return { w, b, mu, sd };
}
export function predict(m, x) {
  let z = m.b;
  for (let j = 0; j < x.length; j++) z += m.w[j] * ((x[j] - m.mu[j]) / m.sd[j]);
  return sigmoid(z);
}
const group = (rows) => ({ n: rows.length, winPct: rows.length ? Math.round((100 * rows.filter((r) => r.res === "win").length) / rows.length) : null,
  avg: rows.length ? +(rows.reduce((a, r) => a + result(r), 0) / rows.length).toFixed(2) : null });

function train(cp) {
  // Only launches whose 30 minutes are fully over: counting the ones that already resolved among the
  // recent launches would over-count quick winners and quick losers.
  const rows = db.prepare("SELECT feat, res, fill, endm FROM early WHERE cp = ? AND res IS NOT NULL AND t > ? AND t < ? ORDER BY t").all(cp, now() - 3 * 24 * 60 * MIN, now() - HORIZON - 6 * MIN)
    .map((r) => ({ ...r, x: vec(json(r.feat, {})), y: r.res === "win" ? 1 : 0 }));
  const wins = rows.filter((r) => r.y).length;
  const info = { cp, n: rows.length, wins, need: MIN_SAMPLES, t: now(), base: group(rows) };
  if (rows.length < MIN_SAMPLES || wins < MIN_WINS) return { ...info, status: "learning" };
  // Judge it on launches it never saw: fit on the oldest 70%, score the newest 30%.
  const cut = Math.floor(rows.length * 0.7), tr = rows.slice(0, cut), te = rows.slice(cut);
  if (tr.filter((r) => r.y).length < 8) return { ...info, status: "learning" };
  const m0 = fit(tr.map((r) => r.x), tr.map((r) => r.y));
  const scored = te.map((r) => ({ ...r, p: predict(m0, r.x) })).sort((a, b) => b.p - a.p);
  const top = (frac) => scored.slice(0, Math.max(1, Math.round(scored.length * frac)));
  const test = { all: group(te), top25: group(top(0.25)), top10: group(top(0.1)), top5: group(top(0.05)) };
  // Good enough to use: the top quarter of unseen launches won at 1.5x the base rate or better, and returned more.
  // (The top quarter, not the top tenth: a handful of coins is too few to judge a model by.)
  const valid = test.top25.n >= 20 && test.top25.winPct >= Math.max(1, test.all.winPct) * 1.5 && test.top25.avg > test.all.avg;
  // The final model uses everything; the thresholds are where its own top 10% and top 5% of scores begin.
  const m = fit(rows.map((r) => r.x), rows.map((r) => r.y));
  const ps = rows.map((r) => predict(m, r.x)).sort((a, b) => b - a);
  const drivers = FEATURES.map((k, j) => ({ k, w: +m.w[j].toFixed(2) })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 6);
  return { ...info, status: valid ? "working" : "not beating chance", valid, test, model: m, thr10: ps[Math.floor(ps.length * 0.1)], thr5: ps[Math.floor(ps.length * 0.05)],
    // Entering before the AI has answered is only allowed while the very top of the unseen set made money after costs.
    autoOk: valid && test.top10.n >= 10 && test.top10.avg > 1, drivers };
}
function trainAll() {
  for (const cp of CPS) {
    try {
      const m = train(cp), was = models.get(cp);
      models.set(cp, m);
      if (m.status !== was?.status) logEvent("system", `Early model (${cp}s): ${m.status}${m.test ? `. Unseen launches: top quarter won ${m.test.top25.winPct}% (avg ${m.test.top25.avg}x) against ${m.test.all.winPct}% (avg ${m.test.all.avg}x) overall` : `, ${m.n} of ${m.need} launches recorded, ${m.wins} winners`}`);
    } catch (e) { logEvent("error", `early model ${cp}s: ${e.message}`); }
  }
  earlyStats.lastTrain = now();
  db.prepare("DELETE FROM early WHERE t < ?").run(now() - 4 * 24 * 60 * MIN);
}
function score(cp, feat) {
  const m = models.get(cp);
  if (!m?.valid) return null;
  const p = predict(m.model, vec(feat));
  return { p, strong: p >= m.thr10, top: p >= m.thr5, auto: m.autoOk && p >= m.thr5 };
}
export const earlyFor = (mint) => scores.get(mint) || null;
export const trainNow = () => { trainAll(); return models; };

// ---------- acting on it ----------
function act(r, c, sc) {
  if (!sc.strong) return;
  earlyStats.flagged++;
  const l = r.l, pct = Math.round(sc.p * 100);
  logEvent("research", `Early signal: $${l.symbol} at ${c.cp}s, ${pct}% chance of a 2x (${sc.top ? "top 5%" : "top 10%"} of launches)`);
  // Straight to the front of the AI's queue, and for the very strongest, onto the entry watch at once.
  adoptLaunch(l).then(() => {
    enqueueFn?.(l.mint, "new", 5e11 + pct * 1e6);
    if (sc.auto && settings.earlyAuto && earlyPickFn?.(l, { p: sc.p, cp: c.cp })) earlyStats.entered++;
  }).catch(() => {});
}

// ---------- the day's real winners, and whether the radar had them ----------
function scanWinners() {
  const up = db.prepare("INSERT INTO launch_winners (mint, symbol, t0, start, ath, ath_t) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(mint) DO UPDATE SET ath = MAX(ath, excluded.ath), ath_t = CASE WHEN excluded.ath > ath THEN excluded.ath_t ELSE ath_t END");
  for (const [mint, s] of live) {
    const usd = s.ath * feed.solUsd;
    if (usd < WINNER_USD) continue;
    const l = launches.get(mint);
    if (!l) continue;                                   // launched before the radar was watching
    up.run(mint, l.symbol == null ? null : String(l.symbol), s.first, s.mc0 * feed.solUsd, usd, s.last);
  }
  // Coins that bonded keep climbing off the curve: take the tracked peak for those.
  db.prepare("UPDATE launch_winners SET ath = MAX(ath, COALESCE((SELECT peak_mcap FROM tokens t WHERE t.mint = launch_winners.mint), 0)) WHERE t0 > ?").run(now() - 24 * 60 * MIN);
  db.prepare("DELETE FROM launch_winners WHERE t0 < ?").run(now() - 7 * 24 * 60 * MIN);
}

export function earlyData() {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  // A real winner: reached the bar AND at least 4x from where it started (coins bundled straight to bonding start near the bar).
  const list = db.prepare("SELECT * FROM launch_winners WHERE t0 > ? AND ath >= 4 * start ORDER BY ath DESC LIMIT 60").all(d0.getTime()).map((w) => {
    const r = db.prepare("SELECT enq_t, enq_mcap, t, grade, score, report, status FROM research WHERE mint = ?").get(w.mint);
    const e = db.prepare("SELECT cp, p, entry, t FROM early WHERE mint = ? ORDER BY cp").all(w.mint);
    const flag = e.find((x) => x.p != null && models.get(x.cp)?.valid && x.p >= models.get(x.cp).thr10);
    const pick = db.prepare("SELECT t0, mcap0, exit_mult, sim, last_mcap, illiq FROM outcomes WHERE kind = 'pick' AND mint = ? ORDER BY t0 LIMIT 1").get(w.mint);
    const watch = db.prepare("SELECT status, why FROM entry_watch WHERE mint = ?").get(w.mint);
    const sim = pick ? json(pick.sim, null) : null;
    // Bought straight to bonding in its first transaction: there was never an early price to get in at.
    return { mint: w.mint, symbol: w.symbol, t0: w.t0, start: w.start, ath: w.ath, mult: w.start > 0 ? w.ath / w.start : null, bundled: w.start >= WINNER_USD,
      noticedSecs: r?.enq_t ? Math.round((r.enq_t - w.t0) / 1000) : null, noticedMcap: r?.enq_mcap || null,
      flaggedSecs: flag ? flag.cp : null, flaggedP: flag ? Math.round(flag.p * 100) : null, bestP: e.length && e.some((x) => x.p != null) ? Math.round(Math.max(...e.map((x) => x.p || 0)) * 100) : null,
      grade: r?.grade || null, action: json(r?.report, {}).trade?.action || null, readStatus: r?.status || null,
      picked: Boolean(pick), pickMcap: pick?.mcap0 || null, pickSecs: pick ? Math.round((pick.t0 - w.t0) / 1000) : null,
      pickX: pick ? pick.exit_mult ?? (sim ? sim.realized + sim.left * (pick.illiq ? 0 : pick.last_mcap / pick.mcap0) * cost() : null) : null,
      turnedDown: watch?.status === "skipped" ? watch.why : null };
  });
  const med = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
  const real = list.filter((w) => !w.bundled);
  return {
    winnerUsd: WINNER_USD, winners: list,
    summary: { n: real.length, bundled: list.length - real.length, noticed: real.filter((w) => w.noticedSecs != null).length, read: real.filter((w) => w.grade).length, picked: real.filter((w) => w.picked).length,
      flagged: real.filter((w) => w.flaggedSecs != null).length, medianNoticedSecs: med(real.map((w) => w.noticedSecs)), medianNoticedMcap: med(real.map((w) => w.noticedMcap)), medianPickMcap: med(real.map((w) => w.pickMcap)) },
    models: CPS.map((cp) => { const m = models.get(cp) || { cp, status: "learning", n: 0, wins: 0, need: MIN_SAMPLES }; return { cp, status: m.status, n: m.n, wins: m.wins, need: m.need, base: m.base || null, test: m.test || null, autoOk: Boolean(m.autoOk), drivers: m.drivers || [] }; }),
    stats: earlyStats, auto: settings.earlyAuto,
  };
}

// ---------- surviving a restart ----------
// The recordings in flight (35 minutes of launches) used to be thrown away on every restart. They are
// written to disk every 10 seconds along with the live trade numbers they depend on; a radar that comes
// back within two minutes carries on with them. The trades missed in between are a few seconds of a
// 30-minute question.
const STATE_FILE = path.join(DATA, "early-state.json");
let saving = false;
async function saveState() {
  if (saving) return;
  saving = true;
  try {
    const known = [];
    for (const [mint, l] of launches) if (live.has(mint)) known.push(l);
    const body = JSON.stringify({ t: now(), recs: [...recs], launches: known, sent: [...sent].filter((m) => live.has(m)) });
    await fs.promises.writeFile(STATE_FILE + ".tmp", body);
    await fs.promises.rename(STATE_FILE + ".tmp", STATE_FILE);
  } catch {} finally { saving = false; }
}
// Returns how many recordings were picked up again (0 = start fresh).
export function resume() {
  let j;
  try { j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return 0; }
  if (!(now() - j.t < RESUME_MS) || !liveRestored.coins) return 0;
  for (const l of j.launches || []) launches.set(l.mint, l);
  for (const m of j.sent || []) sent.add(m);
  for (const [mint, r] of j.recs || []) if (live.has(mint)) recs.set(mint, r);
  // Checkpoints written after the last save are not in the restored recordings: without their running
  // high and entry in memory they cannot be finished honestly, so the unanswered ones go.
  const kept = new Set();
  for (const [mint, r] of recs) for (const c of r.cps) kept.add(`${mint}:${c.cp}`);
  const del = db.prepare("DELETE FROM early WHERE mint = ? AND cp = ?");
  for (const row of db.prepare("SELECT mint, cp FROM early WHERE res IS NULL").all()) if (!kept.has(`${row.mint}:${row.cp}`)) del.run(row.mint, row.cp);
  return recs.size;
}

export function startEarly({ enqueue, earlyPick }) {
  enqueueFn = enqueue; earlyPickFn = earlyPick;
  const resumed = resume();
  if (resumed) logEvent("system", `Picked up where it left off after ${Math.round(liveRestored.gapMs / 1000)}s: ${resumed.toLocaleString()} launch recordings and ${liveRestored.coins.toLocaleString()} coins' live numbers kept`);
  // Launches that were mid-flight when the radar stopped for longer never got their answer: drop that
  // whole window rather than keep only the ones that happened to resolve quickly.
  else db.prepare("DELETE FROM early WHERE t > ?").run(now() - HORIZON - 6 * MIN);
  setInterval(saveState, 10_000);
  onLiveTrade(onTrade);
  let errT = 0;
  const safe = (fn, name) => () => { try { fn(); } catch (e) { if (now() - errT > 60_000) { errT = now(); logEvent("error", `${name}: ${e.message}`); } } };
  setInterval(safe(tick, "early radar"), 1000);
  setInterval(safe(scanWinners, "winners"), 15_000);
  setInterval(safe(trainAll, "early model"), 10 * MIN);
  setTimeout(safe(trainAll, "early model"), 5000);
}
