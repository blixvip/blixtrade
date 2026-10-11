// Field-level ordering and derived values, independent of transport, providers and the database.
export function createMetricState({ now = Date.now, maxCoins = 50_000 } = {}) {
  const coins = new Map(), dirty = new Set(), dirtyFields = new Map(), derivations = new Map();
  let revision = 0;
  function prune() {
    while (coins.size > maxCoins) { const mint = coins.keys().next().value; coins.delete(mint); dirty.delete(mint); dirtyFields.delete(mint); derivations.delete(mint); }
  }
  function put(mint, values, meta = {}, deriving = false) {
    if (typeof mint !== 'string' || !mint || !values || typeof values !== 'object') return {};
    const t = now(), observedAt = meta.observedAt ?? t;
    if (!Number.isFinite(observedAt) || observedAt < 0 || observedAt > t + 5000) return {};
    let coin = coins.get(mint);
    const accepted = {};
    for (const [name, value] of Object.entries(values)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name) || value == null || (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') || (typeof value === 'number' && !Number.isFinite(value))) continue;
      const prev = coin?.fields[name], source = meta.source || 'unknown', rank = meta.rank ?? 1;
      if (prev && !deriving) {
        if (observedAt < prev.observedAt) continue;
        if (meta.slot != null && prev.slot != null && meta.slot < prev.slot) continue;
        if (source === prev.source && meta.seq != null && prev.seq != null && meta.seq < prev.seq) continue;
        if (prev.rank > rank && t - prev.observedAt < prev.maxAgeMs) continue;
        if (observedAt === prev.observedAt && prev.rank > rank) continue;
      }
      const field = { value, ...meta, source, rank, observedAt, receivedAt: t, calculatedAt: t, maxAgeMs: meta.maxAgeMs ?? 5000,
        estimated: Boolean(meta.estimated), partial: Boolean(meta.partial), provisional: Boolean(meta.provisional) };
      if (prev && prev.value === value && prev.observedAt === field.observedAt && prev.source === source && prev.estimated === field.estimated && prev.partial === field.partial && prev.provisional === field.provisional && prev.coverage === field.coverage && prev.slot === field.slot && prev.seq === field.seq && prev.rank === field.rank && prev.maxAgeMs === field.maxAgeMs && JSON.stringify(prev.inputObservedAt) === JSON.stringify(field.inputObservedAt)) continue;
      if (!coin) { coin = { mint, revision: 0, fields: Object.create(null) }; coins.set(mint, coin); }
      coin.fields[name] = field; accepted[name] = field;
    }
    if (Object.keys(accepted).length) {
      let changedFields = dirtyFields.get(mint); if (!changedFields) dirtyFields.set(mint, (changedFields = new Set()));
      for (const name of Object.keys(accepted)) changedFields.add(name);
      coin.revision = ++revision; coins.delete(mint); coins.set(mint, coin); dirty.add(mint); prune();
      if (!deriving) recompute(mint, new Set(Object.keys(accepted)));
    }
    return accepted;
  }
  function recompute(mint, changed) {
    const defs = derivations.get(mint); if (!defs) return;
    // Definitions are a DAG: registration forbids cycles; repeated passes support downstream values.
    const done = new Set();
    for (let pass = 0; pass < defs.size; pass++) for (const [name, d] of defs) {
      if (done.has(name) || !d.dependencies.some(x => changed.has(x))) continue;
      const fields = coins.get(mint)?.fields || {}, inputs = d.dependencies.map(x => fields[x]);
      if (inputs.some(x => !x)) continue;
      if (d.dependencies.some(x => defs.has(x) && !done.has(x) && defs.get(x).dependencies.some(y => changed.has(y)))) continue;
      done.add(name);
      let value; try { value = d.calculate(Object.fromEntries(d.dependencies.map(x => [x, fields[x].value]))); } catch { continue; }
      put(mint, { [name]: value }, { ...d.meta, source: d.meta.source || 'derived', observedAt: Math.min(...inputs.map(x => x.observedAt)),
        inputObservedAt: Object.fromEntries(d.dependencies.map(x => [x, fields[x].observedAt])), estimated: Boolean(d.meta.estimated || inputs.some(x => x.estimated)),
        partial: Boolean(d.meta.partial || inputs.some(x => x.partial)), provisional: inputs.some(x => x.provisional), maxAgeMs: Math.min(...inputs.map(x => x.maxAgeMs)) }, true);
      changed.add(name);
    }
  }
  const copy = c => c ? { ...c, fields: Object.fromEntries(Object.entries(c.fields).map(([k, v]) => [k, { ...v }])) } : null;
  return {
    put, get: mint => copy(coins.get(mint)),
    snapshot: mints => [...mints].map(m => copy(coins.get(m))).filter(Boolean),
    drain(mints, delta = false) { const out = []; for (const m of dirty) { if (mints && !mints.has(m)) continue; const c = copy(coins.get(m)); if (c && delta) c.fields = Object.fromEntries(Object.entries(c.fields).filter(([name]) => dirtyFields.get(m)?.has(name))); out.push(c); dirty.delete(m); dirtyFields.delete(m); } return out.filter(Boolean); },
    derive(mint, name, dependencies, calculate, meta = {}) {
      let defs = derivations.get(mint); if (!defs) derivations.set(mint, (defs = new Map()));
      const visit = (key, seen = new Set()) => { if (key === name) return true; if (seen.has(key)) return false; seen.add(key); return (defs.get(key)?.dependencies || []).some(x => visit(x, seen)); };
      if (dependencies.some(x => visit(x))) throw Error('Metric dependency cycle');
      defs.set(name, { dependencies, calculate, meta }); recompute(mint, new Set(dependencies));
    },
    stats: () => ({ coins: coins.size, dirty: dirty.size, revision }),
  };
}

export const metricState = createMetricState();
