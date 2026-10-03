// The radar's trading brain, run on Grok (this PC's SuperGrok login):
//  - buy calls: deep reads that say "buy" with high conviction become calls with an entry and exit plan
//  - tracker: every call and every graded coin is followed on DexScreener for 24h (peak, low, 1h/6h/24h),
//    and each call's exit plan is paper-traded so we know what following it would actually have made
//  - scorecard: how each grade, narrative theme, stage and playbook version actually performed
//  - self-review: Grok studies the scorecard and rewrites its own playbook (rules fed into every read)
//  - narrative scout: Grok searches X and the web for narratives that are starting to run
// Alert-only: it never trades. Calls are paper trades.
import { db, json, logEvent, meta } from "./db.js";
import { settings } from "./settings.js";
import { askGrok, grokInstalled as grokPresent, grokBlocked, grokStatus, grokOver } from "./grok.js";
const grokInstalled = () => grokPresent() && !grokBlocked();
import { dexTokens } from "./sources.js";
import { liveStats, feed, onLiveTrade } from "./livetrades.js";
import { tapeNote } from "./tape.js";
import { upsertNarrative, clusterBoard } from "./clusters.js";
import { computeNarratives } from "./narratives.js";
import { ask, extractJson, claudeStatus } from "./ai.js";
import { verdict, vet } from "./engine.js";
import { readingProblem, safeUrl, tractionOfSources } from "./quality.js";

// What paper trading assumes, so its numbers are not mistaken for fills: each buy and each sell loses
// this much to fees and slippage, the whole position can be sold at the quoted market cap, and a pool
// that empties before the exit is a total loss on whatever was still held.
export const PAPER = { costPctPerSide: 3 };
const COST = (1 - PAPER.costPctPerSide / 100) / (1 + PAPER.costPctPerSide / 100);

// The best model for jobs that need thinking but no live search: Grok when it is available, else Claude.
async function askSmart(system, prompt, opts) {
  if (grokInstalled()) {
    try { return await askGrok(system, prompt, opts); } catch (e) { if (!e.blocked && !e.busy) throw e; }
  }
  const t0 = Date.now();
  const r = await ask(system, prompt, opts.maxTokens || 3000);
  if (r.truncated) throw new Error("Claude's answer was cut off");
  return { text: r.text, model: r.model, ms: Date.now() - t0, searches: 0 };
}

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

for (const c of ["grade TEXT", "score INTEGER", "tier TEXT", "stage TEXT", "theme TEXT", "tag TEXT", "verdict TEXT", "organic TEXT", "symbol TEXT", "action TEXT", "illiq INTEGER DEFAULT 0", "sim TEXT", "exit_mult REAL", "exit_reason TEXT", "exit_t INTEGER", "rated_mcap REAL", "entry_ms INTEGER", "entry_note TEXT", "pwin INTEGER", "traction INTEGER", "via TEXT"])
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
  db.prepare(`INSERT OR IGNORE INTO outcomes (kind, ref, mint, t0, mcap0, peak_mcap, peak_t, low_mcap, last_mcap, last_t, grade, score, tier, stage, theme, tag, verdict, organic, symbol, action, pwin, traction)
    VALUES ('grade', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`${t.mint}:${stage}:${r.tier}`, t.mint, now(), t.mcap, t.mcap, now(), t.mcap, t.mcap, now(), r.grade, r.score, r.tier, stage,
      r.narrative?.theme || "Other", r.narrative?.tag || null, r.verdict || null, r.xBuzz?.organic || null, t.symbol, r.trade?.action || null, r.trade?.pWin ?? null, r.traction ?? null);
}

// A deep read that says buy, with enough conviction, becomes a call (paper trade with the read's exit plan).
export function considerCall(t, r, stage) {
  const tr = r.trade;
  if (!tr || tr.action !== "buy" || !t?.mcap) return null;
  const minConv = playbook().tuning.buyConviction ?? settings.buyConviction;
  if ((tr.conviction || 0) < minConv) return null;
  // A buy call is the strongest thing the radar says, so it never goes out on a coin that fails safety.
  const v = verdict(t);
  if (!v.ok) {
    logEvent("research", `$${t.symbol} buy call blocked by safety: ${v.reasons.join("; ")}`);
    meta.set("call_blocked", JSON.stringify({ t: now(), symbol: t.symbol, mint: t.mint, conviction: tr.conviction, reasons: v.reasons }));
    return null;
  }
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

// ---------- the day's pick list ----------
// The bot's job in one line: every coin the AI rates well enough, and that passes safety, is watched
// every second for a clean entry, goes on today's list at the price of that entry, and is then sold by
// the exit rule. Nothing is bought: the list is what you check at the end of the day.
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayKey = (t = now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const PICK_COLS = "kind, ref, mint, t0, mcap0, peak_mcap, peak_t, low_mcap, last_mcap, last_t, grade, score, tier, stage, theme, tag, verdict, organic, symbol, action";
export function considerPick(t, r, stage) {
  if (!t?.mint) return null;
  const had = db.prepare("SELECT ref, tier FROM outcomes WHERE kind = 'pick' AND mint = ? AND t0 > ?").get(t.mint, now() - 24 * H);
  if (had) {
    // A later, deeper read updates the opinion on a coin already picked; the entry stays where it was.
    // An early-signal entry keeps its label; the AI's opinion is added to it.
    db.prepare("UPDATE outcomes SET grade = ?, score = ?, tier = CASE WHEN tier = 'early' THEN tier ELSE ? END, verdict = ?, action = COALESCE(?, action) WHERE kind = 'pick' AND ref = ?").run(r.grade, r.score, r.tier, r.verdict || null, r.trade?.action || null, had.ref);
    // The deeper read turning against a coin already entered is a sell. Not for an early-signal entry: the
    // launch model is tested on launches it never saw, and the AI's "avoid" on a seconds-old coin is not.
    if (settings.aiInGate && r.trade?.action === "avoid" && r.tier === "deep" && had.tier !== "early") closePick(had.ref, "the deeper read said avoid");
    return null;
  }
  const action = r.trade?.action || null;
  const waiting = db.prepare("SELECT * FROM entry_watch WHERE mint = ? AND status = 'waiting'").get(t.mint);
  const gate = pickGate(r, priceNow(t.mint)?.mcap || t.mcap || 0);
  if (gate) {
    // A deeper read that turns against a coin still waiting for its entry takes it off the watch.
    // A coin on the watch because of its early signal stays there whatever the AI says (see above).
    if (waiting && !json(waiting.r, {}).early) endWatch(waiting, "skipped", `a ${r.tier || "later"} read turned it down: ${gate}`);
    else if (waiting) return null;
    else if (action === "buy" || (r.traction ?? 0) >= settings.pickMinTraction) logEvent("research", `$${t.symbol} not picked: ${gate}`);
    return null;
  }
  const v = verdict(db.prepare("SELECT * FROM tokens WHERE mint = ?").get(t.mint) || t);
  // "Not checked yet" is not a failure: the coin goes on the watch and the safety check is run right now.
  const unchecked = !v.ok && v.unknown && v.reasons.length === 1;
  if (unchecked) checkSafety(t.mint);
  if (!v.ok && !unchecked) { logEvent("research", `$${t.symbol} rated ${r.grade} (${r.score}) but not picked: ${v.reasons.join("; ")}`); return null; }
  // via: what made it a pick (the launch model, live demand, or the AI's call), so each can be scored on its own.
  const slim = JSON.stringify({ pwin: r.trade?.pWin ?? null, traction: r.traction ?? null, grade: r.grade, score: r.score, tier: r.tier, verdict: r.verdict || null, action, theme: r.narrative?.theme || "Other", tag: r.narrative?.tag || null, organic: r.xBuzz?.organic || null, summary: (r.narrative?.summary || "").slice(0, 300),
    via: r.early?.strong ? "model" : settings.aiInGate ? "ai" : "demand" });
  if (waiting) { db.prepare("UPDATE entry_watch SET r = ? WHERE mint = ?").run(slim, t.mint); return null; }
  // Dropped moments ago for falling or running away: a second read of the same coin does not get to try again at once.
  const prev = db.prepare("SELECT done_t FROM entry_watch WHERE mint = ?").get(t.mint);
  if (prev && now() - (prev.done_t || 0) < 30 * 60_000) return null;
  // The price the AI rated it at: the live one where the trade feed has it, not the last stored refresh.
  // A coin seconds old may have no price at all yet: it is watched anyway and takes the first price seen.
  const ref = priceNow(t.mint)?.mcap || db.prepare("SELECT mcap FROM tokens WHERE mint = ?").get(t.mint)?.mcap || t.mcap || 0;
  db.prepare("INSERT OR REPLACE INTO entry_watch (mint, t, ref_mcap, hi, stage, symbol, r, status, why, done_t, mcap) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', 'watching the first seconds', NULL, ?)")
    .run(t.mint, now(), ref, ref, stage, t.symbol || "?", slim, ref);
  logEvent("research", `$${t.symbol} cleared the pick rule (traction ${r.traction ?? "?"}, AI ${action || "no call"}${r.trade?.pWin != null ? ` ${r.trade.pWin}%` : ""})${ref ? ` at ${fmt$(ref)}` : ""}: watching for an entry`);
  return t.mint;
}

// The pick rule. Returns why a rated coin is NOT a pick, or null when it is one.
//   - the AI must not say avoid
//   - live traction at or above pickMinTraction (the one measure that has separated winners here)
//   - market cap inside pickMinMcap..pickMaxMcap
//   - the AI calls it a buy, or gives it at least pickMinPwin chance of 2x before -40%
export function pickGate(r, mcap, P = settings) {
  const a = r.trade?.action || null, pw = r.trade?.pWin, tr = r.traction;
  // Measured on 126 picks: the AI's "buy" picks won 6% (0.55x) and the picks it called "avoid" won 44%
  // (1.45x). Its call is slow and, so far, wrong, so by default it no longer decides anything: a pick is a
  // launch the model ranks in its top tenth, or a coin with strong live demand at a sensible size.
  if (!P.aiInGate) {
    if (r.early?.strong) return null;
    if (tr == null) return "no live demand score for it yet";
    if (tr < P.pickMinTraction) return `traction ${tr}, below ${P.pickMinTraction}`;
    if (!(mcap > 0)) return "no price for it yet";
    if (mcap < P.pickMinMcap) return `market cap ${fmt$(mcap)}, below ${fmt$(P.pickMinMcap)}`;
    if (mcap > P.pickMaxMcap) return `market cap ${fmt$(mcap)}, above ${fmt$(P.pickMaxMcap)}`;
    return null;
  }
  if (a === "avoid") return "the AI said avoid";
  // A launch the early model puts in its top tenth is a pick at any size: that is the point of finding it early.
  if (r.early?.strong) return null;
  // The early rule. A coin in its first minutes has no 5-minute volume and a tiny market cap, so the traction
  // score cannot see it. It is judged on its first buyers: enough different wallets, more buying than selling,
  // and an AI that would trade it.
  const L = r.live;
  if ((r.stage === "new" || (mcap > 0 && mcap < P.pickMinMcap)) && L && L.traders >= P.earlyMinTraders && L.buys > L.sells && (a === "buy" || (a === "watch" && (pw ?? 0) >= P.earlyMinPwin))) return null;
  // A read that came back without a trade call or a traction score falls back to the narrative score.
  if (tr == null || (pw == null && a == null)) return r.score >= P.pickMinScore || a === "buy" ? null : `rated ${r.score}, below ${P.pickMinScore}`;
  if (tr < P.pickMinTraction) return `traction ${tr}, below ${P.pickMinTraction}`;
  if (mcap > 0 && mcap < P.pickMinMcap) return `market cap ${fmt$(mcap)}, below ${fmt$(P.pickMinMcap)}`;
  if (mcap > P.pickMaxMcap) return `market cap ${fmt$(mcap)}, above ${fmt$(P.pickMaxMcap)}`;
  if (a !== "buy" && (pw ?? 0) < P.pickMinPwin) return `the AI put its chance at ${pw ?? 0}%, below ${P.pickMinPwin}%`;
  return null;
}
// The launch model's strongest coins go on the entry watch at once, before any AI read. The watcher still
// waits for the safety check and a clean second; the AI read that follows can take it off or sell it.
export function earlyPick(l, e) {
  if (db.prepare("SELECT 1 FROM outcomes WHERE kind = 'pick' AND mint = ? AND t0 > ?").get(l.mint, now() - 24 * H)) return false;
  if (db.prepare("SELECT 1 FROM entry_watch WHERE mint = ?").get(l.mint)) return false;
  const pct = Math.round(e.p * 100), ref = priceNow(l.mint)?.mcap || 0;
  checkSafety(l.mint);
  const r = { early: true, via: "model", tier: "early", pwin: pct, traction: null, grade: null, score: null, action: "buy", theme: "Other", tag: "Early signal", organic: null,
    verdict: `Early signal ${e.cp}s after launch: the launch model gives it a ${pct}% chance of doubling before it falls 40%. No AI read yet.`, summary: "" };
  db.prepare("INSERT OR REPLACE INTO entry_watch (mint, t, ref_mcap, hi, stage, symbol, r, status, why, done_t, mcap) VALUES (?, ?, ?, ?, 'new', ?, ?, 'waiting', 'watching the first seconds', NULL, ?)")
    .run(l.mint, now(), ref, ref, l.symbol == null ? "?" : String(l.symbol), JSON.stringify(r), ref);
  logEvent("research", `$${l.symbol} early signal (${pct}% at ${e.cp}s)${ref ? ` at ${fmt$(ref)}` : ""}: watching for an entry`);
  return true;
}
function closePick(ref, why) {
  const o = db.prepare("SELECT * FROM outcomes WHERE kind = 'pick' AND ref = ?").get(ref);
  if (!o || o.exit_mult != null) return;
  const sim = json(o.sim, null) || newSim(), mcap = priceNow(o.mint)?.mcap || o.last_mcap, m = mcap / o.mcap0;
  sim.log.push({ t: now(), why, at: +m.toFixed(3), pct: Math.round(sim.left * 100) });
  sim.realized += sim.left * m * COST; sim.left = 0;
  db.prepare("UPDATE outcomes SET sim = ?, exit_mult = ?, exit_reason = ?, exit_t = ? WHERE kind = 'pick' AND ref = ?").run(JSON.stringify(sim), sim.realized, sim.log.map((x) => x.why).join(", then "), now(), ref);
  logEvent("research", `Pick $${o.symbol}: ${why}; closed at ${sim.realized.toFixed(2)}x`);
  raiseFn?.({ mint: o.mint, symbol: o.symbol, score: o.score, price: null, mcap }, "pick", `Sell $${o.symbol}: ${why} (paper result ${sim.realized.toFixed(2)}x)`, `Entered at ${fmt$(o.mcap0)}, now ${fmt$(mcap)}.`);
}

// ---------- entries and exits, checked every second ----------
// A good rating is not a good entry. Between the moment the AI finishes and the moment you could act, these
// coins move 20% either way, and the worst trades come from buying one that is already falling or has
// already run. So a rated coin is watched every second and entered on the first second that it is:
//   - not chasing: no more than entryChasePct above the price it was rated at
//   - not falling: not down entryFallPct in the last 15 seconds, and sellers not swamping buyers
//   - not already dumped: within entryOffHighPct of its all-time high
// It is dropped if it falls entryCancelPct below the rated price, or offers no clean second in entryWaitMin.
// Prices: coins still on the pump.fun curve come from the live trade feed (every trade, as it lands);
// bonded coins are asked from DexScreener once a second, which itself updates every few seconds.
db.exec("CREATE TABLE IF NOT EXISTS entry_watch (mint TEXT PRIMARY KEY, t INTEGER, ref_mcap REAL, hi REAL, stage TEXT, symbol TEXT, r TEXT, status TEXT, why TEXT, done_t INTEGER, mcap REAL)");
const dexPx = new Map();          // mint -> { mcap, t, chg }
const ticks = new Map();          // mint -> [[t, mcap, buys, sells]] for the last 90 seconds
export const watchStats = { ticks: 0, lastMs: 0, lastT: 0, dexCalls: 0, dexErrors: 0, live: 0, dex: 0, entered: 0, skipped: 0 };
let dexBusy = false, dexNext = 0, tickErrT = 0;
const vetting = new Map();        // mint -> when its safety check was last asked for
function checkSafety(mint) {
  if (now() - (vetting.get(mint) || 0) < 15_000) return;
  vetting.set(mint, now());
  if (vetting.size > 300) for (const [m, t] of vetting) if (now() - t > 10 * 60_000) vetting.delete(m);
  vet(mint).catch(() => {});
}
function priceNow(mint) {
  const ls = liveStats(mint);
  if (ls && ls.mc > 0 && feed.connected && now() - feed.lastMsg < 10_000 && now() - ls.last < 5 * 60_000 && (ls.progress ?? 0) < 0.995)
    return { mcap: ls.mc, src: "live", ath: ls.ath, buys: ls.buys, sells: ls.sells, chg: ls.chg1m };
  const d = dexPx.get(mint);
  return d && now() - d.t < 20_000 ? { mcap: d.mcap, src: "dex", ath: 0, chg: d.chg } : null;
}
async function pollDex(mints) {
  if (dexBusy || now() < dexNext || !mints.length) return;
  dexBusy = true;
  watchStats.dexCalls++;
  try {
    const pairs = await dexTokens(mints.slice(0, 60));
    for (const m of mints) {
      const p = pairs.get(m), raw = p ? p.marketCap || p.fdv || 0 : 0;
      if (!raw) continue;
      const bad = readingProblem({ dex: p.dexId, liquidity: p.liquidity?.usd, mcap: raw }, settings.minExitLiq);
      dexPx.set(m, { mcap: bad ? 0 : raw, t: now(), chg: p.priceChange?.m5 ?? null });
      if (!bad) tapeNote(m, raw);
    }
    if (dexPx.size > 500) for (const [m, d] of dexPx) if (now() - d.t > 5 * 60_000) dexPx.delete(m);
  } catch (e) { watchStats.dexErrors++; dexNext = now() + (e.status === 429 ? 15_000 : 3_000); } finally { dexBusy = false; }
}
function endWatch(w, status, why, mcap) {
  db.prepare("UPDATE entry_watch SET status = ?, why = ?, done_t = ?, mcap = COALESCE(?, mcap) WHERE mint = ?").run(status, why, now(), mcap ?? null, w.mint);
  ticks.delete(w.mint);
  if (status === "skipped") { watchStats.skipped++; logEvent("research", `$${w.symbol} not entered: ${why}`); }
}
// Why this second is not a clean entry, or null when it is.
export function entryBlock({ mcap, ref, ath, d15, chg, buys15, sells15, watchedMs }, P = settings) {
  const x = mcap / ref;
  if (x > 1 + P.entryChasePct / 100) return `already ${x.toFixed(2)}x the price it was rated at: waiting for a pullback`;
  if (ath > 0 && mcap < ath * (1 - P.entryOffHighPct / 100)) return `${Math.round((1 - mcap / ath) * 100)}% below its high: waiting for it to recover`;
  if (d15 != null && d15 <= -P.entryFallPct) return `falling, ${d15.toFixed(0)}% in the last 15 seconds`;
  if (chg != null && chg <= -P.entryFallPct * 3) return `falling, ${chg.toFixed(0)}% over the last minutes`;
  if (sells15 >= 6 && sells15 > 2 * buys15) return `sellers outnumber buyers (${sells15} sells, ${buys15} buys in 15 seconds)`;
  if (watchedMs < 3000) return "watching the first seconds";
  return null;
}
function stepEntry(w) {
  const P = settings, age = now() - w.t, px = priceNow(w.mint);
  if (!px) { if (age > P.entryWaitMin * 60_000) endWatch(w, "skipped", "no live price for it"); return; }
  const mcap = px.mcap;
  if (mcap <= 0) return endWatch(w, "skipped", "its pool was emptied before an entry", 0);
  let h = ticks.get(w.mint);
  if (!h) ticks.set(w.mint, h = []);
  h.push([now(), mcap, px.buys ?? null, px.sells ?? null]);
  while (h.length && h[0][0] < now() - 90_000) h.shift();
  if (!(w.ref_mcap > 0)) { w.ref_mcap = mcap; db.prepare("UPDATE entry_watch SET ref_mcap = ? WHERE mint = ?").run(mcap, w.mint); }
  const x = mcap / w.ref_mcap;
  if (x <= 1 - P.entryCancelPct / 100) return endWatch(w, "skipped", `fell ${Math.round((1 - x) * 100)}% in ${Math.round(age / 1000)}s after it was rated`, mcap);
  const back = h.find((s) => s[0] >= now() - 15_000), span = now() - back[0];
  const tok = db.prepare("SELECT * FROM tokens WHERE mint = ?").get(w.mint);
  const block = entryBlock({ mcap, ref: w.ref_mcap, ath: Math.max(tok?.peak_mcap || 0, px.ath || 0, w.hi || 0),
    d15: span >= 3000 ? (mcap / back[1] - 1) * 100 : null, chg: px.chg,
    buys15: px.buys != null && back[2] != null ? px.buys - back[2] : 0, sells15: px.sells != null && back[3] != null ? px.sells - back[3] : 0, watchedMs: now() - h[0][0] });
  let why = block;
  if (!why && tok) { const v = verdict(tok); if (!v.ok && v.unknown && v.reasons.length === 1) { checkSafety(w.mint); why = "waiting for the safety check to finish"; } }
  if (!why) return enterPick(w, tok, mcap, px.src);
  if (age > P.entryWaitMin * 60_000) return endWatch(w, "skipped", `no clean entry in ${P.entryWaitMin} minutes (${why})`, mcap);
  if (why !== w.why || mcap > (w.hi || 0)) db.prepare("UPDATE entry_watch SET why = ?, hi = MAX(COALESCE(hi, 0), ?), mcap = ? WHERE mint = ?").run(why, mcap, mcap, w.mint);
}
// Risk guard. A run of losing exits, or a bad day, usually means the market has turned (or the rule is
// wrong for it): the radar stops taking new picks instead of feeding the same losing trade again.
let guardCache = { t: 0, v: null };
export function riskGuard() {
  if (now() - guardCache.t < 5000) return guardCache.v;
  const P = settings;
  let v = null;
  if (P.guardLosses > 0) {
    const last = db.prepare("SELECT exit_mult, exit_t FROM outcomes WHERE kind = 'pick' AND exit_mult IS NOT NULL AND exit_t IS NOT NULL ORDER BY exit_t DESC LIMIT ?").all(P.guardLosses);
    const until = last.length ? last[0].exit_t + P.guardPauseMin * 60_000 : 0;
    if (last.length >= P.guardLosses && last.every((o) => o.exit_mult < 1) && now() < until)
      v = { why: `${P.guardLosses} losing exits in a row: no new picks for ${P.guardPauseMin} minutes`, until };
  }
  if (!v && P.guardDayLoss > 0) {
    const day = db.prepare("SELECT exit_mult, mcap0, last_mcap, illiq, sim FROM outcomes WHERE kind = 'pick' AND t0 > ?").all(dayStart());
    const pnl = day.reduce((a, o) => { const s = json(o.sim, null), x = o.illiq ? 0 : o.last_mcap / o.mcap0; return a + ((o.exit_mult ?? (s ? s.realized + s.left * x * COST : x * COST)) - 1) * 100; }, 0);
    if (pnl <= -P.guardDayLoss) { const end = new Date(); end.setHours(24, 0, 0, 0); v = { why: `today is down $${Math.round(-pnl)} at $100 a pick (limit $${P.guardDayLoss}): no new picks until tomorrow`, until: end.getTime() }; }
  }
  guardCache = { t: now(), v };
  return v;
}
function enterPick(w, tok, mcap, src) {
  const r = json(w.r, {}), waited = now() - w.t;
  const hold = riskGuard();
  if (hold) return endWatch(w, "skipped", `risk guard: ${hold.why}`, mcap);
  // Safety is checked again at the moment of entry: it can change while a coin is being watched.
  const v = tok ? verdict(tok) : { ok: false, reasons: ["the radar stopped tracking it"] };
  if (!v.ok) return endWatch(w, "skipped", `failed safety at entry: ${v.reasons.join("; ")}`, mcap);
  const vs = (mcap / w.ref_mcap - 1) * 100;
  const note = `entered ${Math.round(waited / 1000)}s after it was rated, ${Math.abs(vs) < 1 ? "at the rated price" : `${Math.abs(vs).toFixed(0)}% ${vs < 0 ? "below" : "above"} the rated price`}`;
  db.prepare(`INSERT OR IGNORE INTO outcomes (${PICK_COLS}, rated_mcap, entry_ms, entry_note, pwin, traction) VALUES ('pick', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`${w.mint}:${dayKey()}`, w.mint, now(), mcap, mcap, now(), mcap, mcap, now(), r.grade, r.score, r.tier, w.stage,
      r.theme || "Other", r.tag || null, r.verdict || null, r.organic || null, w.symbol, r.action || null, w.ref_mcap, waited, note, r.pwin ?? null, r.traction ?? null);
  db.prepare("UPDATE outcomes SET via = ? WHERE kind = 'pick' AND ref = ?").run(r.via || (r.early ? "model" : "ai"), `${w.mint}:${dayKey()}`);
  endWatch(w, "entered", note, mcap);
  watchStats.entered++;
  logEvent("research", `PICK $${w.symbol} ${r.grade} (${r.score}) at ${fmt$(mcap)}: ${note}`);
  raiseFn?.({ ...tok, mcap }, "pick", r.early ? `Buy now: $${w.symbol} early signal (${r.pwin}% chance of a 2x), entry ${fmt$(mcap)}` : `Buy now: $${w.symbol} rated ${r.grade} (${r.score}/100), entry ${fmt$(mcap)}`,
    `${r.verdict || ""} ${r.summary || ""}`.trim().slice(0, 400) + ` It ${note} (${src === "live" ? "live trade feed" : "DexScreener"} price). Passed safety (${tok.safety_score}/100). Paper only: nothing is bought.`);
}
// Move one open pick to a new price and run its exit rule.
const openPicks = new Map();      // mint -> the open pick's row, refreshed by fastTick every second
function stepOpen(o, mcap) {
  const peak = Math.max(o.peak_mcap || 0, mcap), low = Math.min(o.low_mcap ?? mcap, mcap);
  if (peak > (o.peak_mcap || 0)) o.peak_t = now();
  db.prepare("UPDATE outcomes SET peak_mcap = ?, peak_t = ?, low_mcap = ?, last_mcap = ?, last_t = ?, illiq = MAX(COALESCE(illiq, 0), ?) WHERE kind = 'pick' AND ref = ?")
    .run(peak, o.peak_t, low, mcap, now(), mcap ? 0 : 1, o.ref);
  o.peak_mcap = peak; o.low_mcap = low; o.last_mcap = mcap;
  advancePick(o, mcap);
}
// Coins on the bonding curve are also checked on every trade as it lands, not just once a second: these
// coins fall 50% inside a few seconds, and a stop that waits for the next tick fills that much lower.
function onPickTrade(mint, s) {
  const o = openPicks.get(mint);
  if (!o || (s.progress ?? 0) >= 0.995) return;
  const mcap = s.mc * feed.solUsd;
  if (!(mcap > 0) || !(o.last_mcap > 0) || Math.abs(mcap / o.last_mcap - 1) < 0.004) return;
  try { stepOpen(o, mcap); watchStats.onTrade = (watchStats.onTrade || 0) + 1; } catch {}
}
// One pass a second: every coin waiting for an entry, and every open pick against its exit rule.
function fastTick() {
  const t0 = now();
  try {
    const waiting = db.prepare("SELECT * FROM entry_watch WHERE status = 'waiting'").all();
    const open = db.prepare("SELECT * FROM outcomes WHERE kind = 'pick' AND exit_mult IS NULL AND t0 > ?").all(now() - 24 * H);
    watchStats.ticks++; watchStats.lastT = t0;
    if (!waiting.length && !open.length) { watchStats.live = watchStats.dex = 0; return; }
    const mints = [...new Set([...waiting, ...open].map((x) => x.mint))];
    const need = mints.filter((m) => priceNow(m)?.src !== "live");
    watchStats.live = mints.length - need.length; watchStats.dex = need.length;
    pollDex(need);
    for (const w of waiting) stepEntry(w);
    openPicks.clear();
    for (const o of open) {
      openPicks.set(o.mint, o);
      const px = priceNow(o.mint);
      if (!px) continue;
      const mcap = px.mcap;
      if (mcap === o.last_mcap && (now() - o.t0) / H < settings.pickMaxHours) continue;
      stepOpen(o, mcap);
    }
  } catch (e) {
    if (now() - tickErrT > 60_000) { tickErrT = now(); logEvent("error", `entry watcher: ${e.message}`); }
  } finally { watchStats.lastMs = now() - t0; }
}
// The exit rule, paper-traded on every pick. Memecoins that run usually give most of it back within the
// hour, so "held to now" says little; this says what following one fixed rule would have returned.
//   - take profit: sell part at the target multiple
//   - trailing stop: after that, sell the rest once it falls a set distance below its high
//   - stop loss: before any profit is taken, sell everything on a set fall from the pick price
//   - time limit: sell whatever is left after a set number of hours
// Prices are checked every second (see fastTick), and a stop fills at the price seen on the check after
// it was crossed, which can be worse than the stop level. Every sale pays the paper cost.
function stepPick(o, sim, m, peak, t) {
  const P = settings;
  const sell = (frac, at, why) => { const f = Math.min(sim.left, frac); sim.left -= f; sim.realized += f * at * COST; sim.log.push({ t, why, at: +at.toFixed(3), pct: Math.round(f * 100) }); };
  if (m <= 0) { if (sim.left > 1e-6) sell(1, 0, "pool emptied: could not be sold"); return true; }
  if (!sim.tp && peak >= P.pickTakeProfit) { sim.tp = 1; sell(P.pickSellPct / 100, P.pickTakeProfit, `took profit at ${P.pickTakeProfit}x`); }
  if (sim.left > 1e-6 && sim.tp && m <= peak * (1 - P.pickTrailPct / 100)) sell(1, m, `trailing stop, ${P.pickTrailPct}% off its high`);
  if (sim.left > 1e-6 && !sim.tp && m <= 1 - P.pickStopPct / 100) sell(1, m, `stop loss, down ${Math.round((1 - m) * 100)}%`);
  if (sim.left > 1e-6 && (t - o.t0) / H >= P.pickMaxHours) sell(1, m, `time limit, ${P.pickMaxHours}h`);
  return sim.left <= 1e-6;
}
const newSim = () => ({ left: 1, realized: 0, tp: 0, log: [] });
// Move one pick forward to the latest market cap; tells you when the rule sells.
function advancePick(o, mcap, { silent = false, t = now() } = {}) {
  // Two trackers follow a pick (every second, and the slower all-coins pass): always work from the stored
  // state, never from a copy read before a network call, or the same exit can be taken twice.
  const cur = db.prepare("SELECT sim, exit_mult FROM outcomes WHERE kind = ? AND ref = ?").get(o.kind || "pick", o.ref);
  if (!cur || cur.exit_mult != null) return;
  const sim = json(cur.sim, null) || newSim();
  const before = sim.log.length;
  const closed = stepPick(o, sim, mcap / o.mcap0, Math.max(o.peak_mcap || 0, mcap) / o.mcap0, t);
  db.prepare("UPDATE outcomes SET sim = ?, exit_mult = ?, exit_reason = ?, exit_t = ? WHERE kind = ? AND ref = ?")
    .run(JSON.stringify(sim), closed ? sim.realized : null, closed ? sim.log.map((x) => x.why).join(", then ") : null, closed ? t : null, o.kind || "pick", o.ref);
  // Rated coins that were not picked are followed by the same rule, silently: it is how each ranking gets scored.
  if (silent || o.kind === "grade" || sim.log.length === before) return;
  const last = sim.log[sim.log.length - 1];
  logEvent("research", `Pick $${o.symbol}: ${last.why}${closed ? `; closed at ${sim.realized.toFixed(2)}x` : ""}`);
  raiseFn?.({ mint: o.mint, symbol: o.symbol, score: o.score, price: null, mcap }, "pick", closed ? `Sell $${o.symbol}: ${last.why} (paper result ${sim.realized.toFixed(2)}x)` : `Take profit on $${o.symbol}: it hit ${settings.pickTakeProfit}x`,
    closed ? `The exit rule is now fully out of $${o.symbol}, picked at ${fmt$(o.mcap0)}: ${sim.log.map((x) => `${x.pct}% at ${x.at}x (${x.why})`).join("; ")}.` : `Picked at ${fmt$(o.mcap0)}, now ${fmt$(mcap)}. The rule sells ${settings.pickSellPct}% here and trails the rest ${settings.pickTrailPct}% below its high.`);
}
// Picks made before the rule existed (or while the radar was off): replay them through the stored prices.
// Also fills in the rule result and the traction score for coins rated before those were recorded.
function replayPicks() {
  const rows = db.prepare("SELECT * FROM outcomes WHERE kind IN ('pick', 'grade') AND sim IS NULL AND mcap0 > 0").all();
  const noTr = db.prepare("SELECT o.ref, r.sources FROM outcomes o JOIN research r ON r.mint = o.mint WHERE o.kind = 'grade' AND o.traction IS NULL AND r.sources IS NOT NULL").all();
  if (!rows.length && !noTr.length) return;
  db.exec("BEGIN");
  try {
    for (const o of rows) {
      const sim = newSim();
      let peak = o.mcap0, closed = false, tEnd = null;
      for (const s of db.prepare("SELECT t, mcap FROM snapshots WHERE mint = ? AND t >= ? AND t <= ? AND mcap > 0 AND COALESCE(ok, 1) = 1 ORDER BY t").all(o.mint, o.t0, o.t0 + 7 * H)) {
        peak = Math.max(peak, s.mcap);
        closed = stepPick(o, sim, s.mcap / o.mcap0, peak / o.mcap0, s.t);
        if (closed) { tEnd = s.t; break; }
      }
      db.prepare("UPDATE outcomes SET sim = ?, exit_mult = ?, exit_reason = ?, exit_t = ? WHERE kind = ? AND ref = ?")
        .run(JSON.stringify(sim), closed ? sim.realized : null, closed ? sim.log.map((x) => x.why).join(", then ") : null, tEnd, o.kind, o.ref);
    }
    for (const o of noTr) {
      const tr = tractionOfSources(json(o.sources, null));
      if (tr) db.prepare("UPDATE outcomes SET traction = ? WHERE kind = 'grade' AND ref = ?").run(tr.score, o.ref);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

// Does the ranking work? Every coin rated in the last 7 days, as if bought at its rating and sold by the
// exit rule, grouped by what the radar said about it at the time. Re-measured every 5 minutes; it goes
// into the AI's prompt and onto the Today tab.
let evCache = { t: 0, v: null };
export function evidence() {
  if (evCache.v && now() - evCache.t < 5 * 60_000) return evCache.v;
  const rows = db.prepare("SELECT mint, mcap0, last_mcap, illiq, sim, exit_mult, traction, pwin, action FROM outcomes WHERE kind = 'grade' AND mcap0 > 0 AND sim IS NOT NULL AND t0 > ? AND t0 < ? ORDER BY t0").all(now() - 7 * 24 * H, now() - 45 * 60_000);
  const res = (o) => { const sim = json(o.sim, null); return o.exit_mult ?? (sim ? sim.realized + sim.left * (o.illiq ? 0 : o.last_mcap / o.mcap0) * COST : null); };
  // The first read of each coin that carries the field in question.
  const firstWith = (key) => { const seen = new Set(), out = []; for (const o of rows) { if (o[key] == null || seen.has(o.mint)) continue; seen.add(o.mint); const x = res(o); if (x != null) out.push({ v: o[key], x }); } return out; };
  const band = (label, l) => ({ label, n: l.length, winPct: l.length ? Math.round(100 * l.filter((p) => p.x > 1.15).length / l.length) : null, avg: l.length ? +(l.reduce((a, p) => a + p.x, 0) / l.length).toFixed(2) : null });
  const cut = (l, edges, name) => edges.map(([lo, hi]) => band(name(lo, hi), l.filter((p) => p.v >= lo && p.v < hi)));
  const tr = firstWith("traction"), pw = firstWith("pwin"), ac = firstWith("action");
  const v = {
    n: tr.length, since: now() - 7 * 24 * H,
    traction: cut(tr, [[0, 40], [40, 55], [55, 65], [65, 101]], (lo, hi) => hi > 100 ? `${lo}+` : `${lo}-${hi - 1}`),
    pwin: cut(pw, [[0, 15], [15, 30], [30, 50], [50, 101]], (lo, hi) => hi > 100 ? `${lo}%+` : `${lo}-${hi - 1}%`),
    action: ["buy", "watch", "avoid"].map((a) => band(a, ac.filter((p) => p.v === a))),
  };
  evCache = { t: now(), v };
  return v;
}
// Reads made earlier today, before the list existed (or while the radar was restarting), join it at the
// price they were rated at.
function backfillPicks() {
  if (db.prepare("SELECT 1 FROM outcomes WHERE kind = 'pick' LIMIT 1").get()) return;   // the list exists: entries now come only from the watcher
  const rows = db.prepare(`SELECT * FROM outcomes o WHERE kind = 'grade' AND t0 > ? AND (score >= ? OR action = 'buy') AND COALESCE(action, '') != 'avoid'
    AND NOT EXISTS (SELECT 1 FROM outcomes p WHERE p.kind = 'pick' AND p.mint = o.mint AND p.t0 > ?) ORDER BY t0`).all(dayStart(), settings.pickMinScore, now() - 24 * H);
  const seen = new Set();
  for (const o of rows) {
    if (seen.has(o.mint)) continue;
    seen.add(o.mint);
    db.prepare(`INSERT OR IGNORE INTO outcomes (${PICK_COLS}, m1h, m6h, illiq) VALUES ('pick', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`${o.mint}:${dayKey(o.t0)}`, o.mint, o.t0, o.mcap0, o.peak_mcap, o.peak_t, o.low_mcap, o.last_mcap, o.last_t, o.grade, o.score, o.tier, o.stage, o.theme, o.tag, o.verdict, o.organic, o.symbol, o.action, o.m1h, o.m6h, o.illiq || 0);
  }
  if (seen.size) logEvent("research", `Pick list: added ${seen.size} coin${seen.size > 1 ? "s" : ""} rated earlier today`);
}

// Today's list and how it is doing, plus the rated coins that were NOT picked, so the two can be compared.
// One pick (or one rated coin) as the page shows it.
function shape(o) {
  const t = db.prepare("SELECT name, image, mcap, status, safety_score FROM tokens WHERE mint = ?").get(o.mint) || {};
  const peak = o.peak_mcap / o.mcap0, nowX = o.illiq ? 0 : o.last_mcap / o.mcap0, sim = json(o.sim, null);
  return { mint: o.mint, symbol: o.symbol, name: t.name || null, image: t.image || null, t: o.t0, grade: o.grade, score: o.score, tier: o.tier, action: o.action, verdict: o.verdict, tag: o.tag, stage: o.stage,
    via: o.via || (o.tier === "early" ? "model" : "ai"),
    // What the exit rule has made of it: banked sales plus whatever is still held, at the price now.
    ruleX: o.exit_mult ?? (sim ? sim.realized + sim.left * nowX * COST : nowX * COST), ruleClosed: o.exit_mult != null, ruleWhy: o.exit_reason || (sim?.log.length ? `${sim.log.map((x) => x.why).join(", then ")}; still holding ${Math.round(sim.left * 100)}%` : "still holding all of it"), sold: sim?.log || [],
    ratedAt: o.rated_mcap ?? null, entryMs: o.entry_ms ?? null, entryNote: o.entry_note || null, pwin: o.pwin ?? null, traction: o.traction ?? null,
    entry: o.mcap0, mcapNow: o.illiq ? 0 : o.last_mcap, peak, peakT: o.peak_t, now: nowX, m1h: o.m1h, low: o.low_mcap / o.mcap0, unsellable: Boolean(o.illiq), dead: t.status === "dead", checked: o.last_t, safety: t.safety_score ?? null };
}

// Every pick the radar has made, newest first, with the running result of following the exit rule.
export function allPicks(limit = 1500) {
  const rows = db.prepare("SELECT * FROM outcomes WHERE kind = 'pick' ORDER BY t0 DESC LIMIT ?").all(limit).map((o) => {
    const p = shape(o), sim = json(o.sim, null);
    // Picks made before the live watcher existed were replayed from stored prices: their take-profit filled at exactly its level.
    return { ...p, exitT: o.exit_t ?? null, held: (o.exit_t || o.last_t || now()) - o.t0, left: sim ? sim.left : 1, replayed: o.entry_ms == null, early: o.grade == null,
      state: p.ruleClosed ? (p.ruleX > 1 ? "won" : "lost") : "open" };
  });
  const closed = rows.filter((p) => p.ruleClosed), wins = closed.filter((p) => p.ruleX > 1);
  // $100 into every pick, sold by the rule: the running total, oldest first.
  let run = 0;
  const curve = [...closed].sort((a, b) => (a.exitT || a.t) - (b.exitT || b.t)).map((p) => { run += (p.ruleX - 1) * 100; return { t: p.exitT || p.t, v: +run.toFixed(1), symbol: p.symbol, x: +p.ruleX.toFixed(2) }; });
  const days = new Map();
  for (const p of rows) {
    const d = new Date(p.t); d.setHours(0, 0, 0, 0);
    const k = d.getTime(), g = days.get(k) || { day: k, n: 0, closed: 0, wins: 0, pnl: 0, best: null };
    g.n++;
    if (p.ruleClosed) { g.closed++; if (p.ruleX > 1) g.wins++; }
    g.pnl += (p.ruleX - 1) * 100;
    if (!g.best || p.ruleX > g.best.x) g.best = { symbol: p.symbol, x: +p.ruleX.toFixed(2), mint: p.mint };
    days.set(k, g);
  }
  const by = (key) => { const m = new Map(); for (const p of closed) { const k = p[key] || "none"; const g = m.get(k) || { key: k, n: 0, wins: 0, sum: 0 }; g.n++; if (p.ruleX > 1) g.wins++; g.sum += p.ruleX; m.set(k, g); } return [...m.values()].map((g) => ({ ...g, avg: +(g.sum / g.n).toFixed(2) })).sort((a, b) => b.n - a.n); };
  const xs = closed.map((p) => p.ruleX);
  const best = closed.reduce((a, p) => (!a || p.ruleX > a.ruleX ? p : a), null), worst = closed.reduce((a, p) => (!a || p.ruleX < a.ruleX ? p : a), null);
  return {
    picks: rows, curve, days: [...days.values()].sort((a, b) => b.day - a.day),
    totals: { n: rows.length, open: rows.length - closed.length, closed: closed.length, wins: wins.length, winPct: closed.length ? Math.round((100 * wins.length) / closed.length) : null,
      avg: xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null, median: median(xs), pnl: +rows.reduce((a, p) => a + (p.ruleX - 1) * 100, 0).toFixed(0),
      best: best && { symbol: best.symbol, mint: best.mint, x: +best.ruleX.toFixed(2) }, worst: worst && { symbol: worst.symbol, mint: worst.mint, x: +worst.ruleX.toFixed(2) },
      stops: closed.filter((p) => /stop loss/.test(p.ruleWhy || "")).length, unsellable: rows.filter((p) => p.unsellable).length, replayed: rows.filter((p) => p.replayed).length },
    byStage: by("stage"), byAction: by("action"), byVia: by("via"), aiInGate: Boolean(settings.aiInGate), guard: riskGuard(), guardRule: { losses: settings.guardLosses, pauseMin: settings.guardPauseMin, dayLoss: settings.guardDayLoss },
    rule: { takeProfit: settings.pickTakeProfit, sellPct: settings.pickSellPct, trailPct: settings.pickTrailPct, stopPct: settings.pickStopPct, maxHours: settings.pickMaxHours }, paper: PAPER,
  };
}

export function dayData() {
  const d0 = dayStart();
  const sum = (list) => {
    const xs = list.map((p) => p.now);
    return { n: list.length, medianNow: median(xs), medianPeak: median(list.map((p) => p.peak)), up: list.filter((p) => p.now > 1).length, hit2x: list.filter((p) => p.peak >= 2).length,
      down50: list.filter((p) => p.now <= 0.5).length, unsellable: list.filter((p) => p.unsellable).length,
      // $100 into each coin at its rated price, held until now, after paper costs on the way in and out.
      per100: xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) * COST * 100 : null,
      // The same $100 in each, but sold by the exit rule.
      // How the entries compared with the price each coin was rated at (below 1 = got in cheaper).
      entryVsRated: median(list.filter((p) => p.ratedAt > 0).map((p) => p.entry / p.ratedAt)), entrySecs: median(list.filter((p) => p.entryMs != null).map((p) => p.entryMs / 1000)), timed: list.filter((p) => p.ratedAt > 0).length,
      per100Rule: list.length ? (list.reduce((a, p) => a + p.ruleX, 0) / list.length) * 100 : null, ruleUp: list.filter((p) => p.ruleX > 1).length, ruleClosed: list.filter((p) => p.ruleClosed).length };
  };
  const picks = db.prepare("SELECT * FROM outcomes WHERE kind = 'pick' AND t0 > ? ORDER BY t0 DESC").all(d0).map(shape);
  const picked = new Set(picks.map((p) => p.mint)), first = new Map();
  for (const o of db.prepare("SELECT * FROM outcomes WHERE kind = 'grade' AND t0 > ? ORDER BY t0").all(d0)) if (!picked.has(o.mint) && !first.has(o.mint)) first.set(o.mint, o);
  const passed = [...first.values()].map(shape);
  const rule = { takeProfit: settings.pickTakeProfit, sellPct: settings.pickSellPct, trailPct: settings.pickTrailPct, stopPct: settings.pickStopPct, maxHours: settings.pickMaxHours };
  // Coins rated well and waiting for a clean second to enter, and the ones the watcher turned down today
  // (with what they did afterwards, so you can see whether turning them down was right).
  const watching = db.prepare("SELECT * FROM entry_watch WHERE status = 'waiting' ORDER BY t DESC").all().map((w) => {
    const r = json(w.r, {}), px = priceNow(w.mint);
    return { mint: w.mint, symbol: w.symbol, t: w.t, grade: r.grade, score: r.score, pwin: r.pwin ?? null, traction: r.traction ?? null, action: r.action || null, rated: w.ref_mcap, mcap: px?.mcap ?? w.mcap, src: px?.src || null, why: w.why };
  });
  const skipped = db.prepare("SELECT w.*, t.mcap tm, t.status ts FROM entry_watch w LEFT JOIN tokens t ON t.mint = w.mint WHERE w.status = 'skipped' AND w.done_t > ? ORDER BY w.done_t DESC LIMIT 40").all(d0).map((w) => {
    const r = json(w.r, {});
    return { mint: w.mint, symbol: w.symbol, t: w.done_t, grade: r.grade, score: r.score, rated: w.ref_mcap, why: w.why, since: w.mcap > 0 && w.tm > 0 ? w.tm / w.mcap : null, dead: w.ts === "dead" };
  });
  Object.assign(rule, { waitMin: settings.entryWaitMin, chasePct: settings.entryChasePct, cancelPct: settings.entryCancelPct, fallPct: settings.entryFallPct, offHighPct: settings.entryOffHighPct });
  const gate = { traction: settings.pickMinTraction, pwin: settings.pickMinPwin, minMcap: settings.pickMinMcap, maxMcap: settings.pickMaxMcap, earlyTraders: settings.earlyMinTraders };
  return { since: d0, minScore: settings.pickMinScore, gate, evidence: evidence(), rule, watching, skipped, watch: { ...watchStats, feed: feed.connected && now() - feed.lastMsg < 10_000, tradesPerSec: feed.perSec }, picks, summary: sum(picks), passed: { summary: sum(passed), list: passed.sort((a, b) => b.t - a.t).slice(0, 60) }, paper: PAPER,
    ratedToday: picks.length + passed.length };
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, Number(v) || a));
const fmt$ = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n || 0)}`;

// Paper-trade one call's exit plan against the latest market cap.
function simulate(call, o, mcap) {
  const plan = json(call.plan, {}), sim = json(call.sim, { left: 1, realized: 0, tp: 0 });
  const m = mcap / call.entry_mcap, peak = o.peak_mcap / call.entry_mcap, age = (now() - call.t) / H;
  const sell = (frac, at, why) => { const f = Math.min(sim.left, frac); sim.left -= f; sim.realized += f * at * COST; if (sim.left <= 1e-6) sim.reason = why; };
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
      if (!p && pairs.failed?.has(o.mint)) continue;   // DexScreener did not answer: not the same as the coin being gone
      let mcap = p ? (p.marketCap || p.fdv || 0) : 0;
      const age = now() - o.t0;
      // The pool was emptied: the quoted market cap is meaningless and nothing can be sold.
      if (mcap && readingProblem({ dex: p.dexId, liquidity: p.liquidity?.usd, mcap }, settings.minExitLiq)) {
        db.prepare("UPDATE outcomes SET low_mcap = 0, last_mcap = 0, last_t = ?, m1h = COALESCE(m1h, ?), m6h = COALESCE(m6h, ?), m24h = COALESCE(m24h, ?), illiq = 1, done = ? WHERE kind = ? AND ref = ?")
          .run(now(), age >= H ? 0 : null, age >= 6 * H ? 0 : null, age >= 24 * H ? 0 : null, age >= 24 * H ? 1 : 0, o.kind, o.ref);
        if (o.kind === "call") closeCall(o.ref, 0, "liquidity pulled");
        if (o.kind === "pick" || o.kind === "grade") advancePick(o, 0);
        continue;
      }
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
      if (o.kind === "pick" || o.kind === "grade") advancePick({ ...o, peak_mcap: peak }, mcap);
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
  const m = mcap != null ? mcap / c.entry_mcap : (c.last_mult || 0);
  sim.realized += sim.left * (reason === "delisted" ? 0 : m) * COST; sim.left = 0;
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
  const bucket = (list) => {
    const d24 = list.filter((x) => x.m24h != null);
    return {
      n: list.length, tokens: new Set(list.map((x) => x.mint)).size, medianPeak: median(list.map((x) => x.peak)),
      hit2x: pct(list, (x) => x.peak >= 2), hit2xN: list.filter((x) => x.peak >= 2).length, hit5x: pct(list, (x) => x.peak >= 5), hit5xN: list.filter((x) => x.peak >= 5).length,
      dumped: pct(list, (x) => x.low <= 0.5), dumpedN: list.filter((x) => x.low <= 0.5).length, unsellable: list.filter((x) => x.illiq).length,
      median24h: median(d24.map((x) => x.m24h)), n24h: d24.length,
    };
  };
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

// Results that have had 6h to play out since the last playbook: the review's fuel.
const freshResults = (last = playbook()) => db.prepare("SELECT COUNT(*) n FROM outcomes WHERE kind = 'grade' AND grade IS NOT NULL AND t0 > ? AND t0 < ?").get(last.t ? last.t - 6 * H : 0, now() - 6 * H).n;
const noteReview = (outcome, detail) => meta.set("review_last", JSON.stringify({ t: now(), outcome, detail }));

// Where the self-review stands, so "has not run" can be told apart from "broken".
export function reviewStatus() {
  const pb = playbook(), fresh = freshResults(pb);
  const pending = db.prepare("SELECT COUNT(*) n FROM outcomes WHERE kind = 'grade' AND grade IS NOT NULL AND t0 >= ?").get(now() - 6 * H).n;
  const last = json(meta.get("review_last"), null);
  const provider = grokInstalled() ? "Grok" : claudeStatus().ready ? "Claude" : null;
  return {
    version: pb.version, eligible: fresh, needed: settings.reviewMinNew, ready: fresh >= settings.reviewMinNew, maturing: pending, last, provider,
    state: reviewing ? "running" : !provider ? "blocked" : fresh >= settings.reviewMinNew ? "due" : "waiting",
    why: reviewing ? "A review is running now."
      : !provider ? "No AI is available to run the review (Grok is out of credits and Claude is not logged in)."
      : fresh >= settings.reviewMinNew ? `${fresh} results are ready (${settings.reviewMinNew} needed). The next hourly check runs it${last?.outcome === "error" ? `; the last attempt failed: ${last.detail}` : ""}.`
      : `Not enough evidence yet: ${fresh} of ${settings.reviewMinNew} graded coins have had 6 hours to play out since the last review${pending ? `, and ${pending} more are still maturing` : ""}.`,
  };
}

let reviewing = false;
export async function review(force = false) {
  if (reviewing) return { error: "Already reviewing" };
  if (!grokInstalled() && !claudeStatus().ready) { noteReview("blocked", "no AI available"); return { error: "No AI is available to run the review" }; }
  const last = playbook();
  const sc = scorecard(14);
  const fresh = freshResults(last);
  if (!force && fresh < settings.reviewMinNew) { noteReview("waiting", `${fresh} of ${settings.reviewMinNew} results ready`); return { skipped: `only ${fresh} new results since the last review` }; }
  if (!sc.graded) { noteReview("waiting", "no graded coin has had 6 hours to play out yet"); return { skipped: "nothing to review yet" }; }
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
    const r = await askSmart(REVIEW_SYSTEM, `Track record (JSON):\n${JSON.stringify(input)}`, { model: settings.deepModel, search: false, maxTokens: 4000, effort: "high", timeout: 300_000, lane: "review" });
    const out = extractJson(r.text);
    if (!Array.isArray(out.rules) || !out.rules.length) throw new Error("the review came back without any rules");
    const tuning = {
      buyConviction: clamp(out.tuning?.buyConviction ?? settings.buyConviction, 55, 90),
      deepMinScore: clamp(out.tuning?.deepMinScore ?? settings.deepMinScore, 35, 80),
    };
    const version = last.version + 1;
    db.prepare("INSERT INTO playbook (version, t, rules, changes, notes, scorecard, tuning, model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(version, now(), JSON.stringify((out.rules || []).slice(0, 14)), JSON.stringify(out.changes || []), out.notes || "", JSON.stringify(sc), JSON.stringify(tuning), r.model);
    logEvent("research", `Playbook v${version}: ${out.notes || ""}`.slice(0, 300));
    noteReview("ok", `wrote playbook v${version} from ${sc.graded} results (${r.model})`);
    return { version };
  } catch (e) {
    logEvent("error", `self-review: ${e.message}`);
    noteReview("error", e.message);
    return { error: e.message };
  } finally { reviewing = false; }
}

// ---------- narrative scout ----------
const SCOUT_SYSTEM = `You are a narrative scout for a Solana memecoin trader. Your job: find narratives that are about to run
or are running RIGHT NOW. The radar itself catches bursts of same-named launches within a minute (listed under
"burstsTheRadarAlreadyCaught"): do not repeat those. Look for what it cannot see: a catalyst that is live on X or in the news
and has few or no coins yet. A narrative can be anything: a news story, a viral video, a celebrity moment, an AI/tech release,
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
"sources":[{"url":"https://... a post or article you actually opened","what":"what it shows, in a few words","when":"when it was posted"}],
"keywords":["3-8 lowercase words or short phrases a coin's name/ticker would use"],
"examples":[{"ticker":"","mint":"the contract address, only if you saw it"}],"risk":"what kills it"}],
"market":"one sentence on the overall memecoin mood right now"}
Every catalyst must be backed by at least one entry in "sources" with a real URL you found in this search. If you cannot
link it, leave it out. Never invent URLs.`;

const noteScout = (outcome, detail) => meta.set("scout_last", JSON.stringify({ t: now(), outcome, detail }));
// How old a scouted thesis can get before it stops being presented as current.
export const NARRATIVE_FRESH = 3 * H, NARRATIVE_EXPIRES = 8 * H;
export function scoutStatus() {
  const lastOk = +meta.get("scout_t", 0) || db.prepare("SELECT MAX(t) t FROM narrative_calls WHERE COALESCE(source, 'scout') = 'scout'").get().t || null;
  const g = grokStatus(), over = grokOver("scout");
  const available = grokInstalled() && !over;
  return {
    every: settings.scoutEveryMin, lastOk, last: json(meta.get("scout_last"), null), available, scouting,
    overdue: Boolean(settings.scoutEveryMin > 0 && lastOk && now() - lastOk > settings.scoutEveryMin * MIN * 1.5),
    why: settings.scoutEveryMin <= 0 ? "Narrative scouting is switched off in Settings."
      : available ? null
      : over ? `${over}. Scouting starts again at midnight, or raise the daily Grok budget in Settings.`
      : `Scouting needs live X and web search, which only Grok has. ${g.installed ? `${g.blocked || "Grok is unavailable"}; the radar re-checks every 30 minutes.` : "Grok is not logged in on this PC."} No new narratives are being found until it is back.`,
  };
}

let scouting = false;
export async function scout() {
  if (scouting) return { error: "Already scouting" };
  if (!grokInstalled()) { noteScout("blocked", scoutStatus().why); return { error: scoutStatus().why }; }
  scouting = true;
  try {
    const nar = computeNarratives({});
    const hot = db.prepare(`SELECT symbol, name, mcap, vol_h1, chg_h1 FROM tokens WHERE status = 'active' AND first_seen > ? ORDER BY vol_h1 DESC LIMIT 40`).all(now() - 3 * H)
      .map((t) => `$${t.symbol} ${t.name} ${fmt$(t.mcap)} vol1h ${fmt$(t.vol_h1)}`);
    const rated = db.prepare(`SELECT t.symbol, r.grade, r.report FROM research r JOIN tokens t ON t.mint = r.mint WHERE r.t > ? AND r.score >= 55 ORDER BY r.score DESC LIMIT 15`).all(now() - 12 * H)
      .map((x) => `$${x.symbol} ${x.grade}: ${json(x.report)?.narrative?.tag || ""}`);
    const prior = db.prepare("SELECT name, stage, confidence, t FROM narrative_calls WHERE t > ? ORDER BY t DESC LIMIT 15").all(now() - 12 * H);
    // What the radar already sees forming on-chain. The scout's job is what it cannot see: catalysts with no coins yet.
    const bursts = clusterBoard().clusters.filter((c) => c.state === "forming").slice(0, 8).map((c) => ({ sharedBy: c.keys, name: c.name || undefined, launchesLast10Min: c.n10, buyers: c.traders, lead: c.lead?.symbol }));
    const data = { themes: nar.themes.slice(0, 10).map((x) => ({ theme: x.name, heat: x.heat, launchSharePct: +(x.launchShare * 100).toFixed(1), lift: x.launchLift })),
      emergingWords: nar.emerging.slice(0, 15).map((e) => e.word), busiestNewCoins: hot, bestRatedCoins: rated, yourRecentNarrativeCalls: prior,
      burstsTheRadarAlreadyCaught: bursts };
    const r = await askGrok(SCOUT_SYSTEM + playbookPrompt(), `Radar data (JSON):\n${JSON.stringify(data)}`,
      { model: settings.deepModel, search: true, maxSearches: settings.scoutSearches, maxTokens: 5000, effort: settings.scoutEffort === "medium" ? "medium" : "low", timeout: 300_000, lane: "scout" });
    const out = extractJson(r.text);
    meta.set("scout_t", now());
    let n = 0;
    for (const x of (out.narratives || []).slice(0, 10)) {
      const kw = (x.keywords || []).map((k) => String(k).toLowerCase().trim()).filter((k) => k.length >= 3).slice(0, 8);
      if (!x.name || !kw.length) continue;
      const matches = matchCoins(kw, now() - 24 * H);
      // Evidence the claims can be checked against: real web links only, with when they were seen.
      const sources = (Array.isArray(x.sources) ? x.sources : []).map((s) => ({ url: safeUrl(s?.url), what: String(s?.what || "").slice(0, 160), when: String(s?.when || "").slice(0, 40) })).filter((s) => s.url).slice(0, 6);
      const examples = (Array.isArray(x.examples) ? x.examples : []).map((e) => ({ ticker: String(e?.ticker || "").slice(0, 20), mint: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(e?.mint || "") ? e.mint : null })).filter((e) => e.ticker || e.mint).slice(0, 6);
      // A story the radar already has (from an earlier scout or a live burst) is updated, not listed twice.
      upsertNarrative({ name: x.name, stage: x.stage, thesis: x.thesis, catalysts: { catalysts: x.catalysts || [], risk: x.risk || null, sources, searches: r.searches || 0 }, keywords: kw, confidence: clamp(x.confidence, 0, 100),
        model: r.model, examples, matches: matches.map((m) => ({ mint: m.mint, symbol: m.symbol, mcap: m.mcap })), source: "scout", ms: r.ms });
      // Research the radar's coins that fit a live narrative first.
      // Only the lead coin per ticker (copies of the same ticker are usually late clones).
      const lead = [...new Map(matches.map((m) => [m.symbol.toLowerCase(), m])).values()].sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
      if (["early", "running"].includes(x.stage)) for (const m of lead.filter((c) => c.status === "active").slice(0, 4)) enqueueFn?.(m.mint, m.graduated ? "bonded" : "near", 5e11 + (x.confidence || 0) * 1e6);
      n++;
    }
    logEvent("research", `Narrative scout: ${n} narratives. ${out.market || ""}`.slice(0, 300));
    noteScout("ok", `${n} narratives from ${r.searches || 0} searches (${r.model})`);
    return { found: n, market: out.market };
  } catch (e) {
    logEvent("error", `narrative scout: ${e.message}`);
    noteScout(e.blocked ? "blocked" : "error", e.message);
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
  // Real memecoins with believable prices only: one emptied pool once made a narrative look like a $3 trillion run.
  return db.prepare(`SELECT mint, symbol, name, description, mcap, peak_mcap, first_seen, graduated, image, status, liquidity, dex FROM tokens
    WHERE first_seen > ? AND mcap > 0 AND quarantine IS NULL AND COALESCE(asset_class, 'meme') = 'meme'`).all(since)
    .map((t) => {
      const name = `${t.symbol} ${t.name}`, desc = t.description || "";
      // A hit in the ticker/name counts double; description-only hits need two keywords.
      const hits = res.reduce((n, re) => n + (re.test(name) ? 2 : re.test(desc) ? 1 : 0), 0);
      return { ...t, hits };
    })
    .filter((t) => t.hits >= 2).sort((a, b) => b.hits - a.hits || (b.mcap || 0) - (a.mcap || 0)).slice(0, 12);
}

// 24h after a narrative call: did it run? Best multiple among coins that fit it, and how many launched after the call.
// The coins and prices under a thesis refresh every 10 minutes; the thesis itself does not (see NARRATIVE_EXPIRES).
function scoreNarratives() {
  for (const c of db.prepare("SELECT * FROM narrative_calls WHERE status = 'open'").all()) {
    const kw = json(c.keywords, []);
    const coins = matchCoins(kw, c.t - 24 * H);
    // The market cap each coin had when the call was made; kept from the first match onward.
    const before = new Map(json(c.matches, []).map((m) => [m.mint, "base" in m ? m.base : m.mcap]));
    let bestMult = 0, bestPeak = 0, after = 0;
    const mults = [];
    for (const t of coins) {
      if (t.first_seen > c.t) after++;
      const base = before.get(t.mint);
      // Only what the coin did after the call counts, from readings a holder could have sold into.
      t.peak_mcap = db.prepare("SELECT MAX(mcap) m FROM snapshots WHERE mint = ? AND t >= ? AND COALESCE(ok, 1) = 1").get(t.mint, c.t).m || 0;
      // Multiples off a near-zero base are noise, not a run.
      if (base >= 5000) { bestMult = Math.max(bestMult, t.peak_mcap / base); mults.push(t.peak_mcap / base); }
      bestPeak = Math.max(bestPeak, t.peak_mcap);
    }
    // "The best coin ran" flatters a call: nobody knew which coin that would be. The typical coin on the
    // narrative, and the one named as its lead when the call was made, are the honest measures.
    let leadMult = null;
    if (c.lead_mint) {
      const s = db.prepare("SELECT (SELECT mcap FROM snapshots WHERE mint = ? AND t >= ? AND mcap > 0 AND COALESCE(ok, 1) = 1 ORDER BY t LIMIT 1) base, (SELECT MAX(mcap) FROM snapshots WHERE mint = ? AND t >= ? AND COALESCE(ok, 1) = 1) peak").get(c.lead_mint, c.t, c.lead_mint, c.t);
      if (s.base > 0 && s.peak > 0) leadMult = s.peak / s.base;
    }
    const final = now() - c.t > 24 * H;
    db.prepare("UPDATE narrative_calls SET med_mult = ?, lead_mult = ? WHERE id = ?").run(median(mults), leadMult, c.id);
    db.prepare("UPDATE narrative_calls SET best_mult = ?, best_peak = ?, launches_after = ?, checked_t = ?, status = ?, matches = ? WHERE id = ?")
      .run(bestMult || null, bestPeak || null, after, now(), final ? "scored" : "open",
        JSON.stringify(coins.slice(0, 12).map((t) => ({ mint: t.mint, symbol: t.symbol, image: t.image, mcap: t.mcap, peak: t.peak_mcap, base: before.get(t.mint) ?? (t.first_seen > c.t ? null : t.mcap), dead: t.status === "dead", late: t.first_seen > c.t }))), c.id);
  }
}

// The narratives page: every narrative called in the last 12 hours (by a live burst or by the scout),
// newest first, and how past calls turned out by each honest measure.
// One narrative as the pages show it. The research is as old as the last time it was looked up (by a
// burst or by the scout); only the coin prices underneath it are refreshed in between.
const narShape = (n) => { const seen = n.updated_t || n.t; return { ...n, source: n.source || "scout", keywords: json(n.keywords, []), catalysts: json(n.catalysts, {}), matches: json(n.matches, []), examples: json(n.examples, []),
  researchAge: now() - seen, pricesAge: n.checked_t ? now() - n.checked_t : null, review: now() - seen < NARRATIVE_FRESH ? "fresh" : now() - seen < NARRATIVE_EXPIRES ? "aging" : "expired" }; };
export function narrativeBoard() {
  const calls = db.prepare("SELECT * FROM narrative_calls WHERE COALESCE(updated_t, t) > ? ORDER BY COALESCE(updated_t, t) DESC LIMIT 60").all(now() - 12 * H).map(narShape);
  const scored = db.prepare("SELECT source, best_mult, med_mult, lead_mult, detect_ms FROM narrative_calls WHERE status = 'scored' AND t > ?").all(now() - 14 * 24 * H);
  const rec = (list) => ({ n: list.length, bestRan3x: list.filter((x) => (x.best_mult || 0) >= 3).length, typicalCoin: median(list.filter((x) => x.med_mult != null).map((x) => x.med_mult)),
    leadCoin: median(list.filter((x) => x.lead_mult != null).map((x) => x.lead_mult)), leadN: list.filter((x) => x.lead_mult != null).length,
    detectSecs: (() => { const d = median(list.filter((x) => x.detect_ms != null).map((x) => x.detect_ms)); return d == null ? null : Math.round(d / 1000); })() });
  return { calls, record: { all: rec(scored), burst: rec(scored.filter((x) => x.source === "cluster")), scout: rec(scored.filter((x) => (x.source || "scout") === "scout")) }, scout: scoutStatus() };
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
  const narratives = db.prepare("SELECT * FROM narrative_calls WHERE t > ? ORDER BY COALESCE(updated_t, t) DESC LIMIT 40").all(now() - 48 * H).map(narShape);
  const pb = playbook();
  const history = db.prepare("SELECT version, t, notes, changes, tuning FROM playbook ORDER BY version DESC LIMIT 10").all().map((p) => ({ ...p, changes: json(p.changes, []), tuning: json(p.tuning, {}) }));
  // Why there are (or are not) buy calls: what the deep reads actually said.
  const minConv = pb.tuning.buyConviction ?? settings.buyConviction;
  const deep = db.prepare("SELECT report FROM research WHERE tier = 'deep' AND t > ?").all(now() - 24 * H).map((r) => json(r.report, {}).trade).filter(Boolean);
  const buys = deep.filter((t) => t.action === "buy");
  const callStatus = {
    deepReads24h: deep.length, saidBuy: buys.length, saidWatch: deep.filter((t) => t.action === "watch").length, saidAvoid: deep.filter((t) => t.action === "avoid").length,
    topConviction: buys.length ? Math.max(...buys.map((t) => t.conviction || 0)) : null, threshold: minConv, blocked: json(meta.get("call_blocked"), null),
    why: !deep.length ? "No deep reads in the last 24 hours, so there was nothing to call. Deep reads need a coin to pass the first read."
      : !buys.length ? `${deep.length} deep reads in 24 hours and none said buy. That is the filter working, not a fault.`
      : `${buys.length} deep read${buys.length > 1 ? "s" : ""} said buy; the strongest conviction was ${Math.max(...buys.map((t) => t.conviction || 0))} against a threshold of ${minConv}.`,
  };
  return { today: calls.filter((c) => c.t >= dayStart.getTime()), calls, watch, narratives, playbook: pb, history, scorecard: scorecard(7),
    busy: { reviewing, scouting }, settings: { buyConviction: minConv, deepMinScore: pb.tuning.deepMinScore ?? settings.deepMinScore },
    status: { review: reviewStatus(), scout: scoutStatus(), calls: callStatus }, paper: PAPER };
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
  try { backfill(); backfillPicks(); replayPicks(); } catch (e) { logEvent("error", `backfill: ${e.message}`); }
  onLiveTrade(onPickTrade);
  const timers = [
    setInterval(() => trackTick(), 60_000),
    setInterval(() => fastTick(), 1000),
    setInterval(() => scoreNarratives(), 10 * MIN),
    setInterval(() => { if (settings.scoutEveryMin > 0) scout(); }, Math.max(15, settings.scoutEveryMin || 45) * MIN),
    setInterval(() => review(), 60 * MIN),   // reviews itself when enough new results have played out (reviewMinNew)
  ];
  setTimeout(() => trackTick(), 20_000);
  // First scout a few minutes after start, unless one ran recently (restarts shouldn't re-scout).
  const lastScout = scoutStatus().lastOk || 0;
  setTimeout(() => { if (settings.scoutEveryMin > 0 && now() - lastScout > settings.scoutEveryMin * MIN) scout(); }, 3 * MIN);
  return () => timers.forEach(clearInterval);
}
