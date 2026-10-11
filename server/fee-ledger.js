// Actual fees are never scaled at ingestion. Coverage is an explicit estimate per minute.
export function createFeeLedger({ now = Date.now, keepMs = 7 * 864e5 } = {}) {
  const coins = new Map(), changed = new Set();
  const minute = at => Math.floor(at / 60_000) * 60_000;
  const validCoverage = x => Number.isFinite(x) && x > 0 && x <= 1;
  function get(mint) {
    const c = coins.get(mint); if (!c) return null;
    let observedSol = 0, sol = c.legacyEstimatedSol || 0;
    for (const b of c.buckets.values()) { observedSol += b.sol; sol += b.sol / b.coverage; }
    return { sol, observedSol, estimatedSol: sol - observedSol, legacyEstimatedSol: c.legacyEstimatedSol || 0,
      coverage: c.legacyEstimatedSol ? null : sol > 0 ? observedSol / sol : null, since: c.since, at: c.at, estimated: true, partial: true };
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
      if (!b) c.buckets.set(key, (b = { at: key, sol: 0, coverage, signatures: [] }));
      b.sol += sol; b.signatures.push(signature); c.seen.add(signature);
      c.since = Math.min(c.since, at); c.at = Math.max(c.at, at); changed.add(mint); return true;
    },
    setCoverage(at, coverage) {
      if (!Number.isFinite(at) || !validCoverage(coverage)) return;
      const key = minute(at);
      for (const [mint, c] of coins) { const b = c.buckets.get(key); if (b && b.coverage !== coverage) { b.coverage = coverage; changed.add(mint); } }
    },
    snapshotOne(mint) { const c = coins.get(mint); if (!c) return null; const { seen, buckets, ...rest } = c; return { ...rest, buckets: [...buckets.values()].map(b => ({ ...b, signatures: [...b.signatures] })) }; },
    snapshot(mints) { return [...coins.values()].filter(c => !mints || mints.has(c.mint)).map(({ seen, buckets, ...c }) => ({ ...c, buckets: [...buckets.values()].map(b => ({ ...b, signatures: [...b.signatures] })) })); },
    restore(rows) {
      for (const row of rows) {
        if (!row?.mint || !Number.isFinite(row.at) || row.at < now() - keepMs) continue;
        const buckets = new Map(), seen = new Set();
        for (const b of row.buckets || []) {
          if (!Number.isFinite(b.sol) || b.sol < 0 || !validCoverage(b.coverage) || !Number.isFinite(b.at) || b.at < now() - keepMs) continue;
          const signatures = (b.signatures || []).filter(s => typeof s === 'string');
          buckets.set(minute(b.at), { ...b, signatures }); for (const s of signatures) seen.add(s);
        }
        const legacyAt = Number.isFinite(row.legacyAt) ? row.legacyAt : row.at;
        coins.set(row.mint, { mint: row.mint, since: row.since, at: row.at, legacyAt, legacyEstimatedSol: legacyAt < now() - keepMs ? 0 : Math.max(0, Number(row.legacyEstimatedSol) || 0), buckets, seen });
      }
    },
    drain() { const out = [...changed]; changed.clear(); return out; },
    prune() {
      const cut = now() - keepMs;
      for (const [mint, c] of coins) {
        if (c.at < cut) { coins.delete(mint); changed.add(mint); continue; }
        if (c.legacyEstimatedSol && c.legacyAt < cut) { c.legacyEstimatedSol = 0; changed.add(mint); }
        for (const [at, b] of c.buckets) if (at < cut) { c.buckets.delete(at); for (const sig of b.signatures) c.seen.delete(sig); changed.add(mint); }
        if (c.since < cut) c.since = c.buckets.size ? Math.min(...c.buckets.keys()) : c.at;
      }
    },
  };
}
