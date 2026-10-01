// The radar's trading brain, run on Grok (this PC's SuperGrok login):
//  - buy calls: deep reads that say "buy" with high conviction become calls with an entry and exit plan
//  - tracker: every call and every graded coin is followed on DexScreener for 24h (peak, low, 1h/6h/24h),
//    and each call's exit plan is paper-traded so we know what following it would actually have made
//  - scorecard: how each grade, narrative theme, stage and playbook version actually performed
//  - self-review: Grok studies the scorecard and rewrites its own playbook (rules fed into every read)
//  - narrative scout: Grok searches X and the web for narratives that are starting to run
// Alert-only: it never trades. Calls are paper trades.
import { db, json, logEvent } from "./db.js";
import { settings } from "./settings.js";
import { askGrok, grokInstalled } from "./grok.js";
import { dexTokens } from "./sources.js";
import { computeNarratives } from "./narratives.js";

db.exec(`
CREATE TABLE IF NOT EXISTS outcomes (
  kind TEXT, ref TEXT, mint TEXT, t0 INTEGER, mcap0 REAL,
  peak_mcap REAL, peak_t INTEGER, low_mcap REAL, last_mcap REAL, last_t INTEGER,
  m1h REAL, m6h REAL, m24h REAL, missing INTEGER DEFAULT 0, done INTEGER DEFAULT 0,
  PRIMARY KEY (kind, ref)
);
CREATE INDEX IF NOT EXISTS outcomes_open ON outcomes(done, t0);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, symbol TEXT, name TEXT, image TEXT, t INTEGER, stage TEXT,
  grade TEXT, score INTEGER, conviction INTEGER, entry_mcap REAL, plan TEXT, thesis TEXT, theme TEXT, tag TEXT,
  playbook INTEGER, model TEXT, status TEXT DEFAULT 'open', peak_mult REAL, last_mult REAL, exit_mult REAL,
  exit_reason TEXT, closed_t INTEGER, sim TEXT
);
CREATE TABLE IF NOT EXISTS narrative_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, name TEXT, stage TEXT, thesis TEXT, catalysts TEXT, keywords TEXT,
  confidence INTEGER, playbook INTEGER, model TEXT, examples TEXT, matches TEXT, best_mult REAL, best_peak REAL,
  launches_after INTEGER, status TEXT DEFAULT 'open', checked_t INTEGER
);
CREATE TABLE IF NOT EXISTS playbook (
  version INTEGER PRIMARY KEY, t INTEGER, rules TEXT, changes TEXT, notes TEXT, scorecard TEXT, tuning TEXT, model TEXT
);
`);

const MIN = 60_000, H = 60 * MIN;
const now = () => Date.now();
let raiseFn = null, enqueueFn = null;

for (const c of ["grade TEXT", "score INTEGER", "tier TEXT", "stage TEXT", "theme TEXT", "tag TEXT", "verdict TEXT", "organic TEXT", "symbol TEXT", "action TEXT"])
  try { db.exec(`ALTER TABLE outcomes ADD COLUMN ${c}`); } catch {}

// ---------- playbook ----------
export function playbook() {
  const p = db.prepare("SELECT * FROM playbook ORDER BY version DESC LIMIT 1").get();
  return p ? { ...p, rules: json(p.rules, []), changes: json(p.changes, []), tuning: json(p.tuning, {}) } : { version: 0, rules: [], changes: [], tuning: {} };
}
// Appended to every Grok prompt so lessons from the track record shape the next reads.
export function playbookPrompt() {
  const p = playbook();
  if (!p.rules.length) return "";
  return `\n\nYOUR PLAYBOOK v${p.version} (lessons learned from your own track record of calls; follow them):\n${p.rules.map((r) => `- ${r}`).join("\n")}`;
}

// ---------- tracking ----------
export function trackGrade(t, r, stage) {
  if (!t?.mcap) return;
  // One row per read (fast and deep separately), so each kind of read gets its own track record.
  db.prepare(`INSERT OR IGNORE INTO outcomes (kind, ref, mint, t0, mcap0, peak_mcap, peak_t, low_mcap, last_mcap, last_t, grade, score, tier, stage, theme, tag, verdict, organic, symbol, action)
    VALUES ('grade', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`${t.mint}:${stage}:${r.tier}`, t.mint, now(), t.mcap, t.mcap, now(), t.mcap, t.mcap, now(), r.grade, r.score, r.tier, stage,
      r.narrative?.theme || "Other", r.narrative?.tag || null, r.verdict || null, r.xBuzz?.organic || null, t.symbol, r.trade?.action || null);
}

// A deep read that says buy, with enough conviction, becomes a call (paper trade with the read's exit plan).
export function considerCall(t, r, stage) {
  const tr = r.trade;
  if (!tr || tr.action !== "buy" || !t?.mcap) return null;
  const minConv = playbook().tuning.buyConviction ?? settings.buyConviction;
  if ((tr.conviction || 0) < minConv) return null;
  if (tr.maxEntryMcap && t.mcap > tr.maxEntryMcap * 1.25) {
    logEvent("research", `$${t.symbol} buy call skipped: already ${Math.round(t.mcap / 1000)}k, plan said enter under ${Math.round(tr.maxEntryMcap / 1000)}k`);
    return null;
  }
  if (db.prepare("SELECT 1 FROM calls WHERE mint = ? AND t > ?").get(t.mint, now() - 24 * H)) return null;
  const plan = {
    entry: tr.entry || null, maxEntryMcap: tr.maxEntryMcap || null,
    takeProfits: (Array.isArray(tr.takeProfits) ? tr.takeProfits : []).filter((x) => x.atMultiple > 1 && x.sellPct > 0).sort((a, b) => a.atMultiple - b.atMultiple).slice(0, 5),
    stopLossPct: clamp(tr.stopLossPct ?? 40, 10, 90), trailingStopPct: tr.trailingStopPct ? clamp(tr.trailingStopPct, 10, 80) : null,
    timeStopHours: clamp(tr.timeStopHours ?? 24, 1, 48),
  };
  if (!plan.takeProfits.length) plan.takeProfits = [{ atMultiple: 2, sellPct: 50 }, { atMultiple: 4, sellPct: 50 }];
  db.prepare(`INSERT INTO calls (mint, symbol, name, image, t, stage, grade, score, conviction, entry_mcap, plan, thesis, theme, tag, playbook, model, peak_mult, last_mult, sim)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`)
    .run(t.mint, t.symbol, t.name, t.image, now(), stage, r.grade, r.score, tr.conviction, t.mcap, JSON.stringify(plan), tr.why || r.verdict, r.narrative?.theme || null, r.narrative?.tag || null,
      playbook().version, r.model, JSON.stringify({ left: 1, realized: 0, tp: 0 }));
  const id = db.prepare("SELECT last_insert_rowid() id").get().id;
  db.prepare(`INSERT OR IGNORE INTO outcomes (kind, ref, mint, t0, mcap0, peak_mcap, peak_t, low_mcap, last_mcap, last_t) VALUES ('call', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(String(id), t.mint, now(), t.mcap, t.mcap, now(), t.mcap, t.mcap, now());
  const ladder = plan.takeProfits.map((x) => `${x.sellPct}% at ${x.atMultiple}x`).join(", ");
  logEvent("research", `BUY CALL $${t.symbol} at ${fmt$(t.mcap)} (conviction ${tr.conviction})`);
  raiseFn?.(t, "buy", `Grok says buy $${t.symbol} at ${fmt$(t.mcap)} (conviction ${tr.conviction})`,
    `${tr.why || r.verdict} Plan: ${ladder}; stop -${plan.stopLossPct}%${plan.trailingStopPct ? `, trail ${plan.trailingStopPct}% after first take-profit` : ""}; out within ${plan.timeStopHours}h.`.slice(0, 500));
  return id;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || a));
const fmt$ = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n || 0)}`;

// Paper-trade one call's exit plan against the latest market cap.
function simulate(call, o, mcap) {
  const plan = json(call.plan, {}), sim = json(call.sim, { left: 1, realized: 0, tp: 0 });
  const m = mcap / call.entry_mcap, peak = o.peak_mcap / call.entry_mcap, age = (now() - call.t) / H;
  const sell = (frac, at, why) => { const f = Math.min(sim.left, frac); sim.left -= f; sim.realized += f * at; if (sim.left <= 1e-6) sim.reason = why; };
  // Take-profits fire at their level if the peak reached it (we poll once a minute, so peaks between polls count).
  while (sim.left > 1e-6 && sim.tp < plan.takeProfits.length && peak >= plan.takeProfits[sim.tp].atMultiple) {
    const tp = plan.takeProfits[sim.tp++];
    sell(tp.sellPct / 100, tp.atMultiple, `take-profit ${tp.atMultiple}x`);
  }
  // Ladder finished with some left: ride it on the trailing stop if the plan has one, else sell.
  if (sim.left > 1e-6 && sim.tp === plan.takeProfits.length && !plan.trailingStopPct) sell(1, m, "ladder done");
  if (sim.left > 1e-6 && m <= 1 - plan.stopLossPct / 100) sell(1, m, `stop -${plan.stopLossPct}%`);
  if (sim.left > 1e-6 && sim.tp > 0 && plan.trailingStopPct && m <= peak * (1 - plan.trailingStopPct / 100)) sell(1, m, `trailing stop`);
  if (sim.left > 1e-6 && age >= plan.timeStopHours) sell(1, m, `time stop ${plan.timeStopHours}h`);
  const closed = sim.left <= 1e-6;
  db.prepare(`UPDATE calls SET peak_mult = ?, last_mult = ?, sim = ?, status = ?, exit_mult = ?, exit_reason = ?, closed_t = ? WHERE id = ?`)
    .run(peak, m, JSON.stringify(sim), closed ? "closed" : "open", closed ? sim.realized : null, closed ? sim.reason : null, closed ? now() : null, call.id);
  if (closed) logEvent("research", `Call $${call.symbol} closed ${sim.realized.toFixed(2)}x (${sim.reason})`);
}

let tracking = false;
async function trackTick() {
  if (tracking) return;
  tracking = true;
  try {
    const open = db.prepare("SELECT * FROM outcomes WHERE done = 0").all();
    if (!open.length) return;
    const pairs = await dexTokens([...new Set(open.map((o) => o.mint))]);
    for (const o of open) {
      const p = pairs.get(o.mint);
      const mcap = p ? (p.marketCap || p.fdv || 0) : 0;
      const age = now() - o.t0;
      if (!mcap) {
        // Gone from DexScreener for 30+ min: treat it as dead at its last price.
        const missing = (o.missing || 0) + 1;
        db.prepare("UPDATE outcomes SET missing = ?, done = ? WHERE kind = ? AND ref = ?").run(missing, missing >= 30 || age > 26 * H ? 1 : 0, o.kind, o.ref);
        if (missing >= 30 && o.kind === "call") closeCall(o.ref, o.last_mcap, "delisted");
        continue;
      }
      const peak = Math.max(o.peak_mcap || 0, mcap), low = Math.min(o.low_mcap || mcap, mcap), mult = mcap / o.mcap0;
      const cp = (col, at) => (o[col] == null && age >= at ? mult : o[col]);
      const done = age >= 24 * H ? 1 : 0;
      db.prepare(`UPDATE outcomes SET peak_mcap = ?, peak_t = ?, low_mcap = ?, last_mcap = ?, last_t = ?, m1h = ?, m6h = ?, m24h = ?, missing = 0, done = ? WHERE kind = ? AND ref = ?`)
        .run(peak, peak > (o.peak_mcap || 0) ? now() : o.peak_t, low, mcap, now(), cp("m1h", H), cp("m6h", 6 * H), cp("m24h", 24 * H), done, o.kind, o.ref);
      if (o.kind === "call") {
        const call = db.prepare("SELECT * FROM calls WHERE id = ?").get(Number(o.ref));
        if (call?.status === "open") simulate(call, { peak_mcap: peak }, mcap);
      }
    }
    // Any call whose plan ran past 48h without closing gets closed at market.
    for (const c of db.prepare("SELECT * FROM calls WHERE status = 'open' AND t < ?").all(now() - 48 * H)) closeCall(String(c.id), null, "expired");
  } catch (e) {
    logEvent("error", `tracker: ${e.message}`);
  } finally { tracking = false; }
}

function closeCall(id, mcap, reason) {
  const c = db.prepare("SELECT * FROM calls WHERE id = ?").get(Number(id));
  if (!c || c.status !== "open") return;
  const sim = json(c.sim, { left: 1, realized: 0 });
  const m = mcap ? mcap / c.entry_mcap : (c.last_mult || 0);
  sim.realized += sim.left * (reason === "delisted" ? 0 : m); sim.left = 0;
  db.prepare("UPDATE calls SET status = 'closed', exit_mult = ?, exit_reason = ?, closed_t = ?, sim = ? WHERE id = ?").run(sim.realized, reason, now(), JSON.stringify(sim), c.id);
}

// ---------- scorecard ----------
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a, f) => a.length ? a.filter(f).length / a.length : null;

export function scorecard(days = 7) {
  const since = now() - days * 24 * H;
  // Graded coins: only once they've had at least 6 hours to play out.
  const graded = db.prepare(`SELECT * FROM outcomes WHERE kind = 'grade' AND grade IS NOT NULL AND t0 > ? AND (done = 1 OR t0 < ?)`).all(since, now() - 6 * H)
    .map((o) => ({ ...o, peak: o.peak_mcap / o.mcap0, low: o.low_mcap / o.mcap0, theme: o.theme || "Other" }));
  const bucket = (list) => ({
    n: list.length, medianPeak: median(list.map((x) => x.peak)), hit2x: pct(list, (x) => x.peak >= 2), hit5x: pct(list, (x) => x.peak >= 5),
    dumped: pct(list, (x) => x.low <= 0.5), median24h: median(list.filter((x) => x.m24h != null).map((x) => x.m24h)),
  });
  const group = (key) => {
    const m = new Map();
    for (const g of graded) { const k = key(g); if (!m.has(k)) m.set(k, []); m.get(k).push(g); }
    return [...m].map(([k, list]) => ({ key: k, ...bucket(list) })).sort((a, b) => b.n - a.n);
  };
  const letter = (g) => g.grade?.[0] === "D" || g.grade === "F" ? "D/F" : g.grade?.[0] || "?";
  const calls = db.prepare("SELECT * FROM calls WHERE t > ? ORDER BY t DESC").all(since).map((c) => ({ ...c, plan: json(c.plan), sim: json(c.sim) }));
  const closed = calls.filter((c) => c.status === "closed");
  const nar = db.prepare("SELECT * FROM narrative_calls WHERE t > ? AND status = 'scored'").all(since);
  return {
    days,
    calls: {
      n: calls.length, open: calls.length - closed.length, closed: closed.length,
      winRate: pct(closed, (c) => c.exit_mult > 1), avgExit: closed.length ? closed.reduce((s, c) => s + c.exit_mult, 0) / closed.length : null,
      medianPeak: median(calls.map((c) => c.peak_mult || 1)), hit2x: pct(calls, (c) => (c.peak_mult || 1) >= 2),
      // Total paper result if the same amount went into every closed call.
      bankroll: closed.length ? closed.reduce((s, c) => s + c.exit_mult, 0) / closed.length : null,
      byPlaybook: Object.entries(Object.groupBy(closed, (c) => `v${c.playbook}`)).map(([k, l]) => ({ key: k, n: l.length, avgExit: l.reduce((s, c) => s + c.exit_mult, 0) / l.length, winRate: pct(l, (c) => c.exit_mult > 1) })),
    },
    byGrade: group(letter).sort((a, b) => a.key.localeCompare(b.key)),
    byTheme: group((g) => g.theme).slice(0, 12),
    byStage: group((g) => g.stage),
    byTier: group((g) => g.tier || "?"),
    byAction: group((g) => g.action || "fast read"),
    byOrganic: group((g) => g.organic || "unknown"),
    graded: graded.length,
    narratives: { n: nar.length, ran: pct(nar, (x) => (x.best_mult || 0) >= 3 || (x.best_peak || 0) >= 1e6) },
  };
}

// ---------- self-review ----------
const REVIEW_SYSTEM = `You run a memecoin research desk and are reviewing your own track record to get better.
You get: your current playbook (rules you follow when grading coins and making buy calls), a scorecard of how
your grades and calls actually performed, and your best and worst reads with what happened after.
Find what actually predicts a coin running and what predicts a dump. Be specific and evidence-based: only make a rule
when the data supports it, and say how strong the evidence is. Keep rules that are working, fix or drop ones that aren't.
Also tune two thresholds within their ranges if the data says so: buyConviction (55-90, minimum conviction for a buy call)
and deepMinScore (35-80, fast-read score that earns a deep read; fast reads are harsh, most score under 40).
Reply with ONLY JSON:
{"rules":["up to 14 short, concrete rules"],"changes":["what you changed and why, citing the numbers"],
"tuning":{"buyConviction":number,"deepMinScore":number},"notes":"2-3 sentences: what's working, what isn't, what to test next"}`;

let reviewing = false;
export async function review(force = false) {
  if (reviewing || !grokInstalled()) return { error: reviewing ? "Already reviewing" : "Grok isn't logged in" };
  const last = playbook();
  const sc = scorecard(14);
  const fresh = db.prepare("SELECT COUNT(*) n FROM outcomes WHERE kind = 'grade' AND grade IS NOT NULL AND t0 > ? AND t0 < ?").get(last.t ? last.t - 6 * H : 0, now() - 6 * H).n;
  if (!force && fresh < settings.reviewMinNew) return { skipped: `only ${fresh} new results since the last review` };
  reviewing = true;
  try {
    const rows = db.prepare(`SELECT peak_mcap / mcap0 peak, low_mcap / mcap0 low, m24h, mcap0, grade, score, stage, tier, verdict, tag, theme, organic, action, symbol
      FROM outcomes WHERE kind = 'grade' AND grade IS NOT NULL AND t0 > ? AND t0 < ?`).all(now() - 14 * 24 * H, now() - 6 * H);
    const brief = (x) => ({ ticker: x.symbol, grade: x.grade, score: x.score, stage: x.stage, read: x.tier, action: x.action, mcapAtGrade: Math.round(x.mcap0), peakMult: +x.peak.toFixed(2), lowMult: +x.low.toFixed(2), mult24h: x.m24h && +x.m24h.toFixed(2), verdict: x.verdict, narrative: x.tag, theme: x.theme, xOrganic: x.organic });
    const byPeak = [...rows].sort((a, b) => b.peak - a.peak);
    const calls = db.prepare("SELECT symbol, grade, conviction, entry_mcap, peak_mult, exit_mult, exit_reason, thesis, plan, tag FROM calls WHERE t > ? ORDER BY t DESC LIMIT 40").all(now() - 14 * 24 * H)
      .map((c) => ({ ...c, plan: json(c.plan) }));
    const missedRunners = byPeak.filter((x) => x.peak >= 3 && x.score < 60).slice(0, 10).map(brief);
    const input = { currentPlaybook: { version: last.version, rules: last.rules, tuning: { buyConviction: last.tuning.buyConviction ?? settings.buyConviction, deepMinScore: last.tuning.deepMinScore ?? settings.deepMinScore } },
      scorecard: sc, bestRunners: byPeak.slice(0, 12).map(brief), worstDumps: [...rows].sort((a, b) => a.low - b.low).slice(0, 10).map(brief),
      highGradesThatFailed: rows.filter((x) => x.score >= 65 && x.peak < 1.3).slice(0, 10).map(brief), missedRunners, calls,
      narrativeScoutResults: db.prepare("SELECT name, stage, confidence, best_mult, best_peak, launches_after FROM narrative_calls WHERE status = 'scored' ORDER BY t DESC LIMIT 20").all() };
    const r = await askGrok(REVIEW_SYSTEM, `Track record (JSON):\n${JSON.stringify(input)}`, { model: settings.deepModel, search: false, maxTokens: 4000, effort: "high", timeout: 300_000 });
    const out = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0]);
    const tuning = {
      buyConviction: clamp(out.tuning?.buyConviction ?? settings.buyConviction, 55, 90),
      deepMinScore: clamp(out.tuning?.deepMinScore ?? settings.deepMinScore, 35, 80),
    };
    const version = last.version + 1;
    db.prepare("INSERT INTO playbook (version, t, rules, changes, notes, scorecard, tuning, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(version, now(), JSON.stringify((out.rules || []).slice(0, 14)), JSON.stringify(out.changes || []), out.notes || "", JSON.stringify(sc), JSON.stringify(tuning), r.model);
    logEvent("research", `Playbook v${version}: ${out.notes || ""}`.slice(0, 300));
    return { version };
  } catch (e) {
    logEvent("error", `self-review: ${e.message}`);
    return { error: e.message };
  } finally { reviewing = false; }
}

// ---------- narrative scout ----------
const SCOUT_SYSTEM = `You are a narrative scout for a Solana memecoin trader. Your job: find narratives that are about to run
or are running RIGHT NOW. A narrative can be anything: a news story, a viral video, a celebrity moment, an AI/tech release,
a political event, a meme format, a cultural trend, an animal going viral, a CT in-joke. What matters is whether it will
pull attention and money into memecoins named after it in the next hours.
Use x_search heavily: what is going viral on X right now, what memecoin traders and KOLs are rotating into, which tickers
are being shilled organically vs by bots. Use web search to confirm news is real and current.
You also get the radar's own data: which themes are hot in new launches, emerging words, the busiest new coins, and the
narratives its graders rated best.
For each narrative say its stage: "early" (catalyst live, few or no coins yet), "running" (coins pumping, attention growing),
"peaking" (late, crowded), or "dead". Prefer early and running. Never invent posts, coins or facts.
Reply with ONLY JSON:
{"narratives":[{"name":"short name","stage":"early|running|peaking|dead","confidence":0-100,
"thesis":"why it will run, 1-2 sentences","catalysts":["concrete current catalysts with dates"],
"keywords":["3-8 lowercase words or short phrases a coin's name/ticker would use"],
"examples":[{"ticker":"","mint":"optional, only if you saw it"}],"risk":"what kills it"}],
"market":"one sentence on the overall memecoin mood right now"}`;

let scouting = false;
export async function scout() {
  if (scouting || !grokInstalled()) return { error: scouting ? "Already scouting" : "Grok isn't logged in" };
  scouting = true;
  try {
    const nar = computeNarratives({});
    const hot = db.prepare(`SELECT symbol, name, mcap, vol_h1, chg_h1 FROM tokens WHERE status = 'active' AND first_seen > ? ORDER BY vol_h1 DESC LIMIT 40`).all(now() - 3 * H)
      .map((t) => `$${t.symbol} ${t.name} ${fmt$(t.mcap)} vol1h ${fmt$(t.vol_h1)}`);
    const rated = db.prepare(`SELECT t.symbol, r.grade, r.report FROM research r JOIN tokens t ON t.mint = r.mint WHERE r.t > ? AND r.score >= 55 ORDER BY r.score DESC LIMIT 15`).all(now() - 12 * H)
      .map((x) => `$${x.symbol} ${x.grade}: ${json(x.report)?.narrative?.tag || ""}`);
    const prior = db.prepare("SELECT name, stage, confidence, t FROM narrative_calls WHERE t > ? ORDER BY t DESC LIMIT 15").all(now() - 12 * H);
    const data = { themes: nar.themes.slice(0, 10).map((x) => ({ theme: x.name, heat: x.heat, launchSharePct: +(x.launchShare * 100).toFixed(1), lift: x.launchLift })),
      emergingWords: nar.emerging.slice(0, 15).map((e) => e.word), busiestNewCoins: hot, bestRatedCoins: rated, yourRecentNarrativeCalls: prior };
    const r = await askGrok(SCOUT_SYSTEM + playbookPrompt(), `Radar data (JSON):\n${JSON.stringify(data)}`,
      { model: settings.deepModel, search: true, maxSearches: settings.scoutSearches, maxTokens: 5000, effort: "medium", timeout: 300_000 });
    const out = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0]);
    const v = playbook().version;
    let n = 0;
    for (const x of (out.narratives || []).slice(0, 10)) {
      const kw = (x.keywords || []).map((k) => String(k).toLowerCase().trim()).filter((k) => k.length >= 3).slice(0, 8);
      if (!x.name || !kw.length) continue;
      const matches = matchCoins(kw, now() - 24 * H);
      db.prepare(`INSERT INTO narrative_calls (t, name, stage, thesis, catalysts, keywords, confidence, playbook, model, examples, matches) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(now(), x.name, x.stage, x.thesis, JSON.stringify({ catalysts: x.catalysts || [], risk: x.risk || null }), JSON.stringify(kw), clamp(x.confidence, 0, 100), v, r.model,
          JSON.stringify(x.examples || []), JSON.stringify(matches.map((m) => ({ mint: m.mint, symbol: m.symbol, mcap: m.mcap }))));
      // Research the radar's coins that fit a live narrative first.
      // Only the lead coin per ticker (copies of the same ticker are usually late clones).
      const lead = [...new Map(matches.map((m) => [m.symbol.toLowerCase(), m])).values()].sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
      if (["early", "running"].includes(x.stage)) for (const m of lead.slice(0, 4)) enqueueFn?.(m.mint, m.graduated ? "bonded" : "near", 5e11 + (x.confidence || 0) * 1e6);
      n++;
    }
    logEvent("research", `Narrative scout: ${n} narratives. ${out.market || ""}`.slice(0, 300));
    return { found: n, market: out.market };
  } catch (e) {
    logEvent("error", `narrative scout: ${e.message}`);
    return { error: e.message };
  } finally { scouting = false; }
}

// Words too generic to tie a coin to one narrative on their own.
const GENERIC = new Set("ai cat cats dog dogs coin token sol solana meme memes pump fun the moon pepe frog inu baby king man the official new bot agent agents chinese china usa trump elon x".split(" "));
function matchCoins(keywords, since) {
  const kws = keywords.filter((k) => k.length >= 3 && !GENERIC.has(k));
  if (!kws.length) return [];
  const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_-]*");
  const res = kws.map((k) => new RegExp(`(^|[^a-z0-9])${esc(k)}($|[^a-z0-9])`, "i"));
  return db.prepare(`SELECT mint, symbol, name, description, mcap, peak_mcap, first_seen, graduated, image FROM tokens WHERE first_seen > ? AND mcap > 0`).all(since)
    .map((t) => {
      const name = `${t.symbol} ${t.name}`, desc = t.description || "";
      // A hit in the ticker/name counts double; description-only hits need two keywords.
      const hits = res.reduce((n, re) => n + (re.test(name) ? 2 : re.test(desc) ? 1 : 0), 0);
      return { ...t, hits };
    })
    .filter((t) => t.hits >= 2).sort((a, b) => b.hits - a.hits || (b.mcap || 0) - (a.mcap || 0)).slice(0, 12);
}

// 24h after a narrative call: did it run? Best multiple among coins that fit it, and how many launched after the call.
function scoreNarratives() {
  for (const c of db.prepare("SELECT * FROM narrative_calls WHERE status = 'open' AND t < ?").all(now() - 6 * H)) {
    const kw = json(c.keywords, []);
    const coins = matchCoins(kw, c.t - 24 * H);
    const before = new Map(json(c.matches, []).map((m) => [m.mint, m.mcap]));
    let bestMult = 0, bestPeak = 0, after = 0;
    for (const t of coins) {
      if (t.first_seen > c.t) after++;
      const base = before.get(t.mint) || (t.first_seen > c.t ? 0 : null);
      if (base) bestMult = Math.max(bestMult, (t.peak_mcap || 0) / base);
      bestPeak = Math.max(bestPeak, t.peak_mcap || 0);
    }
    const final = now() - c.t > 24 * H;
    db.prepare("UPDATE narrative_calls SET best_mult = ?, best_peak = ?, launches_after = ?, checked_t = ?, status = ?, matches = ? WHERE id = ?")
      .run(bestMult || null, bestPeak || null, after, now(), final ? "scored" : "open",
        JSON.stringify(coins.slice(0, 12).map((t) => ({ mint: t.mint, symbol: t.symbol, image: t.image, mcap: t.mcap, peak: t.peak_mcap, base: before.get(t.mint) || null }))), c.id);
  }
}

// ---------- API ----------
export function picksData() {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const withLive = (c) => {
    const tok = db.prepare("SELECT mcap, image, chg_h1 FROM tokens WHERE mint = ?").get(c.mint);
    const o = db.prepare("SELECT last_mcap FROM outcomes WHERE kind = 'call' AND ref = ?").get(String(c.id));
    return { ...c, plan: json(c.plan), sim: json(c.sim), image: c.image || tok?.image, now_mult: (o?.last_mcap || tok?.mcap || 0) / c.entry_mcap };
  };
  const calls = db.prepare("SELECT * FROM calls WHERE t > ? ORDER BY t DESC").all(now() - 7 * 24 * H).map(withLive);
  const watch = db.prepare(`SELECT r.mint, r.grade, r.score, r.verdict, r.report, r.t, r.tier, t.symbol, t.name, t.image, t.mcap FROM research r JOIN tokens t ON t.mint = r.mint
    WHERE r.t > ? AND r.tier = 'deep' ORDER BY r.score DESC LIMIT 12`).all(dayStart.getTime())
    .map((x) => { const rep = json(x.report, {}); return { ...x, report: undefined, trade: rep.trade || null, tag: rep.narrative?.tag }; });
  const narratives = db.prepare("SELECT * FROM narrative_calls WHERE t > ? ORDER BY t DESC LIMIT 40").all(now() - 48 * H)
    .map((n) => ({ ...n, keywords: json(n.keywords, []), catalysts: json(n.catalysts, {}), matches: json(n.matches, []), examples: json(n.examples, []) }));
  const pb = playbook();
  const history = db.prepare("SELECT version, t, notes, changes, tuning FROM playbook ORDER BY version DESC LIMIT 10").all().map((p) => ({ ...p, changes: json(p.changes, []), tuning: json(p.tuning, {}) }));
  return { today: calls.filter((c) => c.t >= dayStart.getTime()), calls, watch, narratives, playbook: pb, history, scorecard: scorecard(7),
    busy: { reviewing, scouting }, settings: { buyConviction: pb.tuning.buyConviction ?? settings.buyConviction, deepMinScore: pb.tuning.deepMinScore ?? settings.deepMinScore } };
}

// Reads made before the tracker existed: rebuild their outcome from the radar's own price snapshots.
function backfill() {
  const rows = db.prepare(`SELECT r.*, t.symbol FROM research r JOIN tokens t ON t.mint = r.mint WHERE r.status IN ('done', 'deep') AND r.mcap_at > 0 AND r.t > ?
    AND NOT EXISTS (SELECT 1 FROM outcomes o WHERE o.kind = 'grade' AND o.mint = r.mint)`).all(now() - 3 * 24 * H);
  for (const r of rows) {
    const rep = json(r.report, {});
    const s = db.prepare("SELECT MAX(mcap) hi, MIN(mcap) lo, MAX(t) lt FROM snapshots WHERE mint = ? AND t >= ? AND mcap > 0").get(r.mint, r.t);
    const last = s.lt ? db.prepare("SELECT mcap FROM snapshots WHERE mint = ? AND t = ?").get(r.mint, s.lt).mcap : r.mcap_at;
    db.prepare(`INSERT OR IGNORE INTO outcomes (kind, ref, mint, t0, mcap0, peak_mcap, peak_t, low_mcap, last_mcap, last_t, grade, score, tier, stage, theme, tag, verdict, organic, symbol, action, done)
      VALUES ('grade', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`${r.mint}:${r.stage}:${r.tier || "deep"}`, r.mint, r.t, r.mcap_at, Math.max(s.hi || 0, r.mcap_at), r.t, Math.min(s.lo || r.mcap_at, r.mcap_at), last, s.lt || r.t,
        r.grade, r.score, r.tier || "deep", r.stage, rep.narrative?.theme || "Other", rep.narrative?.tag || null, r.verdict, rep.xBuzz?.organic || null, r.symbol, rep.trade?.action || null, now() - r.t > 24 * H ? 1 : 0);
  }
  if (rows.length) logEvent("research", `Tracker: backfilled ${rows.length} earlier reads from price history`);
}

export function startBrain(raise, enqueue) {
  raiseFn = raise; enqueueFn = enqueue;
  try { backfill(); } catch (e) { logEvent("error", `backfill: ${e.message}`); }
  const timers = [
    setInterval(() => trackTick(), 60_000),
    setInterval(() => scoreNarratives(), 10 * MIN),
    setInterval(() => { if (settings.scoutEveryMin > 0) scout(); }, Math.max(15, settings.scoutEveryMin || 45) * MIN),
    setInterval(() => review(), 60 * MIN),   // reviews itself when enough new results have played out (reviewMinNew)
  ];
  setTimeout(() => trackTick(), 20_000);
  // First scout a few minutes after start, unless one ran recently (restarts shouldn't re-scout).
  const lastScout = db.prepare("SELECT MAX(t) t FROM narrative_calls").get().t || 0;
  setTimeout(() => { if (settings.scoutEveryMin > 0 && now() - lastScout > settings.scoutEveryMin * MIN) scout(); }, 3 * MIN);
  return () => timers.forEach(clearInterval);
}
