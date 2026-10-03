// Replay: runs entry and exit rules over the recorded second-by-second tapes, so a rule is changed
// because it worked on coins it never saw, not because it sounded right.
//   node --no-warnings bin/replay.mjs            a report
//   node --no-warnings bin/replay.mjs --json     the same, as JSON
// For each group of entries (the radar's real picks, every launch-model checkpoint, every first read)
// the best exit rule is chosen on the oldest 70% and reported on the newest 30%, next to today's rule.
// Reads the live database without writing to it.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { simExit, entryBar, walkForward, tally, BASE_RULE } from "../server/rules.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.RADAR_DATA ? path.resolve(process.env.RADAR_DATA) : path.join(ROOT, "data");
const db = new DatabaseSync(path.join(DATA, "radar.db"), { readOnly: true });
const asJson = process.argv.includes("--json");
const DELAY = 1;   // seconds between deciding and being filled

const tapes = new Map();
function tape(mint) {
  if (tapes.has(mint)) return tapes.get(mint);
  const rows = db.prepare("SELECT t0, bars FROM tape WHERE mint = ? ORDER BY t").all(mint);
  let v = null;
  if (rows.length) {
    const t0 = Math.min(...rows.map((r) => r.t0)), bars = [];
    for (const r of rows) for (const b of JSON.parse(r.bars)) bars.push(r.t0 === t0 ? b : [b[0] + Math.round((r.t0 - t0) / 1000), ...b.slice(1)]);
    v = { t0, bars: bars.sort((a, b) => a[0] - b[0]) };
  }
  tapes.set(mint, v);
  return v;
}
// An entry the tape can answer: where it would have been filled, with enough tape after it to judge.
function place(mint, t, extra = {}) {
  const tp = tape(mint);
  if (!tp) return null;
  const i0 = entryBar(tp.bars, (t - tp.t0) / 1000, DELAY);
  if (i0 < 0 || tp.bars.length - i0 < 6) return null;
  const b = tp.bars[i0];
  return { mint, t, bars: tp.bars, i0, mcap: b[1], traders: b[4], age: b[0], ...extra };
}
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };

if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'tape'").get()) { console.log("No tapes yet: the radar starts recording them the next time it starts."); process.exit(0); }
const have = db.prepare("SELECT COUNT(DISTINCT mint) coins, COUNT(*) chunks, MIN(t0) first, MAX(t) last FROM tape").get();
const groups = [];
const group = (name, list) => groups.push({ name, list: list.filter(Boolean).sort((a, b) => a.t - b.t) });

// 1. The radar's own picks, at the moment it entered them.
const picks = db.prepare("SELECT mint, t0, exit_mult, tier, stage, action FROM outcomes WHERE kind = 'pick' ORDER BY t0").all().map((o) => place(o.mint, o.t0, { actual: o.exit_mult, tier: o.tier, stage: o.stage, action: o.action }));
group("Picks the radar made", picks);
// 2. Every launch-model checkpoint: what buying each kind of launch at 30s / 60s / 2m / 5m would have done.
const cps = db.prepare("SELECT mint, cp, t, p, feat FROM early ORDER BY t").all().map((e) => place(e.mint, e.t, { cp: e.cp, p: e.p, feat: J(e.feat) }));
for (const cp of [...new Set(cps.filter(Boolean).map((e) => e.cp))].sort((a, b) => a - b)) {
  const l = cps.filter((e) => e && e.cp === cp);
  group(`All launches at ${cp}s`, l);
  const scored = l.filter((e) => e.p != null).sort((a, b) => b.p - a.p);
  if (scored.length >= 40) group(`Launch model top 10% at ${cp}s`, scored.slice(0, Math.round(scored.length / 10)));
  group(`Launches at ${cp}s with 25+ traders, buys ahead`, l.filter((e) => e.traders >= 25 && e.bars[e.i0][2] > e.bars[e.i0][3]));
  group(`Launches at ${cp}s entered at $10-20k`, l.filter((e) => e.mcap >= 10_000 && e.mcap < 20_000));
}
// 3. Every coin's first AI read, at the moment it was rated.
const seen = new Set();
const reads = db.prepare("SELECT mint, t0, traction, action, pwin, stage FROM outcomes WHERE kind = 'grade' ORDER BY t0").all().filter((o) => !seen.has(o.mint) && seen.add(o.mint)).map((o) => place(o.mint, o.t0, o));
group("Every first read", reads);
group("Reads with traction 65+", reads.filter((e) => e && e.traction >= 65));
for (const a of ["buy", "watch", "avoid"]) group(`Reads the AI called ${a}`, reads.filter((e) => e && e.action === a));

const out = { tapes: have, delaySecs: DELAY, baseRule: BASE_RULE, groups: [] };
for (const g of groups) {
  if (g.list.length < 20) { out.groups.push({ name: g.name, n: g.list.length, note: "under 20 entries on tape: not judged yet" }); continue; }
  const wf = walkForward(g.list), now = tally(g.list.map((e) => simExit(e.bars, e.i0, BASE_RULE).x));
  out.groups.push({ name: g.name, n: g.list.length, todaysRule: now, unseen: { todaysRule: wf.base.test, bestRule: wf.best.test, bestRuleName: wf.best.name, bestOnFit: wf.best.fit }, rule: wf.best.rule });
}
// How close the replay comes to what the live watcher recorded, on the picks both saw.
const both = picks.filter((e) => e && e.actual != null);
out.check = both.length ? { n: both.length, live: tally(both.map((e) => e.actual)), replayed: tally(both.map((e) => simExit(e.bars, e.i0, BASE_RULE).x)) } : null;

if (asJson) console.log(JSON.stringify(out, null, 1));
else {
  const f = (t) => t.n ? `${String(t.n).padStart(5)} entries  ${String(t.winPct).padStart(3)}% won  avg ${t.avg.toFixed(2)}x  median ${t.median.toFixed(2)}x  $${t.per100 >= 0 ? "+" : ""}${t.per100} per $100` : "none";
  console.log(`Tapes: ${have.coins} coins, ${have.first ? `${((have.last - have.first) / 3600e3).toFixed(1)}h recorded` : "nothing recorded yet"}. Fill delay ${DELAY}s. Costs ${BASE_RULE.costPct}% each way.\n`);
  for (const g of out.groups) {
    console.log(g.name);
    if (g.note) { console.log(`  ${g.n} entries: ${g.note}\n`); continue; }
    console.log(`  today's rule, all        ${f(g.todaysRule)}`);
    console.log(`  today's rule, unseen 30% ${f(g.unseen.todaysRule)}`);
    console.log(`  best rule,    unseen 30% ${f(g.unseen.bestRule)}`);
    console.log(`  best rule: ${g.unseen.bestRuleName}\n`);
  }
  if (out.check) console.log(`Check against the live watcher on ${out.check.n} picks: live avg ${out.check.live.avg}x, replayed avg ${out.check.replayed.avg}x`);
}
