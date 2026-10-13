// Actual fees are never scaled at ingestion. Coverage is an explicit estimate per minute.
// Signatures are kept only for the last `sigKeepMs` of buckets: they exist to refuse a transaction heard twice (the
// live feed and the block follower, minutes apart at most), and keeping a week of them held 7.9M strings (1.5 GB)
// in every process that loads the ledger (the page server too, via accounts.js), which hit Node's 2 GB heap
// limit and crash-looped the site on 2026-10-11. Older buckets keep their fees and coverage, not their signatures.
export function createFeeLedger({ now = Date.now, keepMs = 7 * 864e5, sigKeepMs = 2 * 3600e3 } = {}) {
  const coins = new Map(), changed = new Set();
  // Every change goes through touch(): it marks the coin for publishing and drops its cached totals.
  const touch = (c, mint) => { changed.add(mint); if (c) c.total = null; };
  // Which coins have a bucket in each minute: setCoverage used to walk every coin in the ledger (tens of thousands),
  // twice per block-follower stats message, to find the few with that minute (1 s of the radar's thread per 40 s).
  const byMinute = new Map();   // minute -> Set(mint)
  const indexed = (key, mint) => { let set = byMinute.get(key); if (!set) byMinute.set(key, (set = new Set())); set.add(mint); };
  const minute = at => Math.floor(at / 60_000) * 60_000;
  const validCoverage = x => Number.isFinite(x) && x > 0 && x <= 1;
  function get(mint) {
    const c = coins.get(mint); if (!c) return null;
    // Summed once per change (the live push asks for every updated coin's fees every 200 ms).
    if (c.total) return c.total;
    let observedSol = 0, sol = c.legacyEstimatedSol || 0;
    for (const b of c.buckets.values()) { observedSol += b.sol; sol += b.sol / b.coverage; }
    return (c.total = { sol, observedSol, estimatedSol: sol - observedSol, legacyEstimatedSol: c.legacyEstimatedSol || 0,
      coverage: c.legacyEstimatedSol ? null : sol > 0 ? observedSol / sol : null, since: c.since, at: c.at, estimated: true, partial: true });
  }
  return {
    get,
    add(mint, { sol, signature, at = now(), coverage = 1 }) {
      if (!mint || !Number.isFinite(sol) || sol <= 0 || !signature || !Number.isFinite(at) || at < now() - keepMs || at > now() + 5000 || !validCoverage(coverage)) return false;
      let c = coins.get(mint);
      if (!c) coins.set(mint, (c = { mint, since: at, at, legacyEstimatedSol: 0, buckets: new Map(), seen: new Set() }));
      if (c.seen.has(signature)) return false;
      const key = minute(at);
      let b = c.buckets.get(key);
      if (!b) { c.buckets.set(key, (b = { at: key, sol: 0, coverage, signatures: [] })); indexed(key, mint); }
      b.sol += sol; b.signatures.push(signature); c.seen.add(signature);
      c.since = Math.min(c.since, at); c.at = Math.max(c.at, at); touch(c, mint); return true;
    },
    setCoverage(at, coverage) {
      if (!Number.isFinite(at) || !validCoverage(coverage)) return;
      const key = minute(at);
      for (const mint of byMinute.get(key) || []) { const c = coins.get(mint), b = c?.buckets.get(key); if (b && b.coverage !== coverage) { b.coverage = coverage; touch(c, mint); } }
    },
    snapshotOne(mint) { const c = coins.get(mint); if (!c) return null; const { seen, buckets, ...rest } = c; return { ...rest, buckets: [...buckets.values()].map(b => ({ ...b, signatures: [...b.signatures] })) }; },
    snapshot(mints) { return [...coins.values()].filter(c => !mints || mints.has(c.mint)).map(({ seen, buckets, ...c }) => ({ ...c, buckets: [...buckets.values()].map(b => ({ ...b, signatures: [...b.signatures] })) })); },
    restore(rows) {
      for (const row of rows) {
        if (!row?.mint || !Number.isFinite(row.at) || row.at < now() - keepMs) continue;
        const buckets = new Map(), seen = new Set();
        for (const b of row.buckets || []) {
          if (!Number.isFinite(b.sol) || b.sol < 0 || !validCoverage(b.coverage) || !Number.isFinite(b.at) || b.at < now() - keepMs) continue;
          const signatures = b.at < now() - sigKeepMs ? [] : (b.signatures || []).filter(s => typeof s === 'string');
          buckets.set(minute(b.at), { ...b, signatures }); indexed(minute(b.at), row.mint); for (const s of signatures) seen.add(s);
        }
        const legacyAt = Number.isFinite(row.legacyAt) ? row.legacyAt : row.at;
        coins.set(row.mint, { mint: row.mint, since: row.since, at: row.at, legacyAt, legacyEstimatedSol: legacyAt < now() - keepMs ? 0 : Math.max(0, Number(row.legacyEstimatedSol) || 0), buckets, seen });
      }
    },
    drain() { const out = [...changed]; changed.clear(); return out; },
    prune() {
      const cut = now() - keepMs;
      for (const key of byMinute.keys()) if (key < cut) byMinute.delete(key);
      for (const [mint, c] of coins) {
        if (c.at < cut) { coins.delete(mint); touch(c, mint); continue; }
        if (c.legacyEstimatedSol && c.legacyAt < cut) { c.legacyEstimatedSol = 0; touch(c, mint); }
        for (const [at, b] of c.buckets) if (at < cut) { c.buckets.delete(at); for (const sig of b.signatures) c.seen.delete(sig); touch(c, mint); }
        const sigCut = now() - sigKeepMs;
        for (const [at, b] of c.buckets) if (at < sigCut && b.signatures.length) { for (const sig of b.signatures) c.seen.delete(sig); b.signatures = []; touch(c, mint); }
        if (c.since < cut) c.since = c.buckets.size ? Math.min(...c.buckets.keys()) : c.at;
      }
    },
  };
}
