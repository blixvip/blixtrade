// Live prices checked against an independent figure. Every coin the radar prices itself (curve and pool trades,
// livetrades.js) is compared every 30 s with DexScreener's market cap in the tokens table (engine.js enrich, the
// figure every other site shows). A coin whose live cap is 8x or more off DexScreener's fresh figure for four
// checks in a row (2 minutes: a real 8x move is on DexScreener within a minute) is a suspect. Only the inflated
// direction counts: a live cap far BELOW DexScreener is normally right (a pool drained seconds ago, a dust trade on
// a dead coin, a major on another supply basis), and showing DexScreener's stale figure would revive dead coins.
// A suspect: liveStats() shows
// DexScreener's cap for it until a fresh comparison agrees again, the health page says so, and the owner is
// emailed (bin/alertwatch.mjs). Added 2026-10-11 after PUMP-quoted curves showed $6M for $4k coins for a day.
export function createPriceSanity({ ratio = 8, holds = 4, maxAgeMs = 3 * 60_000, keepMs = 15 * 60_000, minUsd = 100 } = {}) {
  const streak = new Map();     // mint -> { n, since }
  const suspects = new Map();   // mint -> { live, dex, ratio, since, at }
  const stats = { compared: 0, suspects: 0, lastRun: 0, ever: 0, examples: [], lastError: null };
  // rows: [{ mint, liveUsd, dexUsd, dexT }] for every live coin with a tokens row.
  function check(rows, now = Date.now()) {
    let compared = 0;
    for (const r of rows) {
      if (!(r.liveUsd >= minUsd) || !(r.dexUsd > 0) || !(now - (r.dexT || 0) <= maxAgeMs)) continue;
      compared++;
      const q = r.liveUsd / r.dexUsd;
      if (q < ratio) { streak.delete(r.mint); suspects.delete(r.mint); continue; }
      const s = streak.get(r.mint) || { n: 0, since: now };
      s.n++; streak.set(r.mint, s);
      if (s.n >= holds) { if (!suspects.has(r.mint)) stats.ever++; suspects.set(r.mint, { live: r.liveUsd, dex: r.dexUsd, ratio: q, since: s.since, at: now }); }
    }
    // A verdict with no fresh comparison for a while lapses (DexScreener stopped pricing the coin).
    for (const [m, s] of suspects) if (now - s.at > keepMs) { suspects.delete(m); streak.delete(m); }
    stats.compared = compared; stats.suspects = suspects.size; stats.lastRun = now;
    stats.examples = [...suspects].slice(0, 5).map(([mint, s]) => ({ mint, live: Math.round(s.live), dex: Math.round(s.dex), ratio: +s.ratio.toFixed(1), since: s.since }));
    return stats;
  }
  return { check, suspect: (mint) => suspects.get(mint) || null, stats };
}
