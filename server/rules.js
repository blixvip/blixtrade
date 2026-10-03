// Exit rules as plain arithmetic over a price tape, with no database and no clock, so the same code can
// be run over thousands of recorded coins (bin/replay.mjs) and checked by tests.
//
// A rule: { tp, sellPct, trailPct, stopPct, flatMin, flatX, maxMin, costPct }
//   tp / sellPct   sell this share of the position when the coin reaches this multiple (fills at the level)
//   trailPct       after that, sell the rest once it falls this far below its high
//   stopPct        before any profit is taken, sell everything on this fall from entry (0 = no stop)
//   flatMin/flatX  sell everything if, this many minutes in, it is still under flatX (0 = off)
//   maxMin         sell whatever is left after this long
// Stops fill at the price of the bar that crossed them, which is how they really fill: usually worse
// than the level. Every sale pays costPct on the way in and again on the way out.
export const BASE_RULE = { tp: 2, sellPct: 50, trailPct: 35, stopPct: 40, flatMin: 0, flatX: 1, maxMin: 360, costPct: 3 };

export const costOf = (pct) => (1 - pct / 100) / (1 + pct / 100);

// bars: [[sec, mcap, ...]], i0: the bar the position is opened on.
export function simExit(bars, i0, rule = BASE_RULE) {
  const R = { ...BASE_RULE, ...rule }, cost = costOf(R.costPct);
  const entry = bars[i0][1], t0 = bars[i0][0];
  let left = 1, realized = 0, tp = false, peak = 1, why = [], end = i0;
  const sell = (frac, at, reason) => { const f = Math.min(left, frac); left -= f; realized += f * at * cost; why.push(reason); };
  for (let i = i0 + 1; i < bars.length && left > 1e-6; i++) {
    const m = bars[i][1] / entry, mins = (bars[i][0] - t0) / 60;
    end = i;
    if (m > peak) peak = m;
    if (!(m > 0)) { sell(1, 0, "emptied"); break; }
    if (!tp && peak >= R.tp) { tp = true; sell(R.sellPct / 100, R.tp, "take-profit"); }
    if (left > 1e-6 && tp && m <= peak * (1 - R.trailPct / 100)) sell(1, m, "trail");
    if (left > 1e-6 && !tp && R.stopPct > 0 && m <= 1 - R.stopPct / 100) sell(1, m, "stop");
    if (left > 1e-6 && !tp && R.flatMin > 0 && mins >= R.flatMin && m < R.flatX) sell(1, m, "flat");
    if (left > 1e-6 && mins >= R.maxMin) sell(1, m, "time");
  }
  // The tape ran out with some still held: it is sold at the last price seen.
  if (left > 1e-6) sell(1, bars[end][1] / entry, "end of tape");
  return { x: realized, peak, why: why.join(", then "), secs: bars[end][0] - t0 };
}

// The bar a decision made at `sec` could really have been filled on: the first one at least `delay` seconds later.
export function entryBar(bars, sec, delay = 0) {
  for (let i = 0; i < bars.length; i++) if (bars[i][0] >= sec + delay) return i;
  return -1;
}

// Every rule worth trying. Rules that sell everything at the target have no trailing stop to vary.
export function ruleGrid() {
  const out = [];
  for (const tp of [1.3, 1.5, 2, 3]) for (const sellPct of [50, 100]) for (const trailPct of sellPct === 100 ? [35] : [20, 35])
    for (const stopPct of [0, 25, 40]) for (const [flatMin, flatX] of [[0, 1], [3, 1], [5, 1.1]]) for (const maxMin of [10, 30])
      out.push({ tp, sellPct, trailPct, stopPct, flatMin, flatX, maxMin, costPct: BASE_RULE.costPct });
  return out;
}
export const ruleName = (r) => `${r.sellPct}% at ${r.tp}x${r.sellPct < 100 ? `, trail ${r.trailPct}%` : ""}, ${r.stopPct ? `stop -${r.stopPct}%` : "no stop"}${r.flatMin ? `, out if under ${r.flatX}x after ${r.flatMin}m` : ""}, max ${r.maxMin}m`;

// Summary of a list of results (multiples after costs).
export function tally(xs) {
  if (!xs.length) return { n: 0, winPct: null, avg: null, median: null, per100: null };
  const s = [...xs].sort((a, b) => a - b), avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { n: xs.length, winPct: Math.round((100 * xs.filter((x) => x > 1).length) / xs.length), avg: +avg.toFixed(3), median: +s[s.length >> 1].toFixed(3), per100: +((avg - 1) * 100).toFixed(1) };
}

// Walk-forward: choose the rule on the oldest `split` of the entries, report it on the newest part it never saw.
// entries: [{ bars, i0 }] in time order.
export function walkForward(entries, rules = ruleGrid(), split = 0.7) {
  const cut = Math.floor(entries.length * split), fit = entries.slice(0, cut), test = entries.slice(cut);
  const run = (list, rule) => list.map((e) => simExit(e.bars, e.i0, rule).x);
  let best = null;
  for (const rule of rules) {
    const t = tally(run(fit, rule));
    if (!best || t.avg > best.fit.avg) best = { rule, fit: t };
  }
  return { n: entries.length, base: { fit: tally(run(fit, BASE_RULE)), test: tally(run(test, BASE_RULE)) },
    best: best && { rule: best.rule, name: ruleName(best.rule), fit: best.fit, test: tally(run(test, best.rule)) } };
}
