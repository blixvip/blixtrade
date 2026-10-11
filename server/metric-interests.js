const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function createMetricInterests({ now = Date.now, maxSessions = 256, maxMints = 200, ttlMs = 20_000 } = {}) {
  const sessions = new Map(), cursors = [0, 0, 0];
  function prune() { for (const [key, v] of sessions) if (now() - v.at >= ttlMs) sessions.delete(key); }
  function entries() {
    prune(); const all = new Map();
    for (const session of sessions.values()) for (const x of session.rows) {
      const age = now() - x.born, tier = x.active ? 0 : x.born > 0 && age >= 0 && age < 864e5 ? 1 : 2;
      if (!all.has(x.mint) || all.get(x.mint) > tier) all.set(x.mint, tier);
    }
    return all;
  }
  return {
    renew(session, rows) {
      if (typeof session !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(session) || !Array.isArray(rows)) return false;
      prune();
      if (!rows.length) { sessions.delete(session); return true; }
      if (!sessions.has(session) && sessions.size >= maxSessions) return false;
      const selected = new Map();
      for (const x of rows.slice(0, maxMints)) if (x && typeof x.mint === 'string' && MINT.test(x.mint)) selected.set(x.mint, { mint: x.mint, active: x.active === true, born: Number.isFinite(x.born) ? x.born : 0 });
      sessions.set(session, { at: now(), rows: [...selected.values()] }); return true;
    },
    get(session) { prune(); return new Set((sessions.get(session)?.rows || []).map(x => x.mint)); },
    isActive(mint) { return entries().get(mint) === 0; },
    select(limit = 32) {
      limit = Math.max(0, Math.min(200, Math.floor(limit)));
      const tiers = [[], [], []]; for (const [mint, tier] of entries()) tiers[tier].push(mint);
      const take = (tier, n) => { const list = tiers[tier], count = Math.min(n, list.length), offset = cursors[tier] % (list.length || 1); cursors[tier] += count; return Array.from({ length: count }, (_, i) => list[(offset + i) % list.length]); };
      const active = take(0, limit), left = limit - active.length;
      const oldQuota = tiers[2].length && left >= 2 ? Math.max(1, Math.floor(left / 4)) : 0;
      const young = take(1, left - oldQuota), older = take(2, left - young.length);
      return [...active, ...young, ...older];
    },
    snapshot() { const all = entries(); return { sessions: sessions.size, mints: all.size }; },
  };
}
