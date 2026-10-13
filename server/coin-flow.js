// Rolling totals from actual signed trades, independent of the displayed/capped trade table.
export function createCoinFlow({ now = () => Date.now(), connected = () => false, onUpdate = () => {}, maxEvents = 20_000 } = {}) {
  const books = new Map(), windowMs = 300_000, leaseMs = 15_000;
  function focus(mint) {
    const t = now();
    let b = books.get(mint);
    if (!b) {
      if (books.size >= 32) { const old = [...books].sort((a, b) => a[1].focus - b[1].focus)[0][0]; books.delete(old); }
      b = { start: t, focus: t, kind: null, rows: [], head: 0, ids: new Set(), users: new Map(), buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, unknownUsd: 0, unknownUser: 0 }; books.set(mint, b);
    }
    if (t - b.focus > leaseMs) b.start = t;
    b.focus = t;
  }
  function gap(mint) { const b = books.get(mint); if (b) b.start = now(); }
  function count(b, r, direction) {
    if (r.buy) { b.buys += direction; b.buyUsd += (r.usd ?? 0) * direction; }
    else { b.sells += direction; b.sellUsd += (r.usd ?? 0) * direction; }
    if (r.usd == null) b.unknownUsd += direction;
    if (!r.user) b.unknownUser += direction;
    else { const n = (b.users.get(r.user) || 0) + direction; if (n > 0) b.users.set(r.user, n); else b.users.delete(r.user); }
  }
  function removeFirst(b) { const row = b.rows[b.head++]; b.ids.delete(row.id); count(b, row, -1); }
  function snapshot(mint) {
    const b = books.get(mint), t = now();
    if (!b || t - b.focus > leaseMs) return null;
    while (b.head < b.rows.length && b.rows[b.head].t <= t - windowMs) removeFirst(b);
    if (b.head > 2048) { b.rows = b.rows.slice(b.head); b.head = 0; }
    const { buys, sells } = b, buyUsd = Math.max(0, b.buyUsd), sellUsd = Math.max(0, b.sellUsd), dollars = !b.unknownUsd;
    const complete = Boolean(b.kind && connected(b.kind) && t - b.start >= windowMs);
    return { mint, t, since: b.start, complete, flow: { source: 'live', buys, sells,
      buyUsd: dollars ? buyUsd : null, sellUsd: dollars ? sellUsd : null,
      volUsd: dollars ? buyUsd + sellUsd : null, netUsd: dollars ? buyUsd - sellUsd : null,
      traders: b.unknownUser ? null : b.users.size } };
  }
  const emit = mint => { const value = snapshot(mint); if (value) onUpdate(value); };
  function record(mint, { sig, buy, sol, tokens, user, at, fast, kind, solUsd }) {
    const b = books.get(mint), t = now();
    if (!b || t - b.focus > leaseMs || fast) return;
    if (!sig || !Number.isFinite(sol) || sol < 0) { gap(mint); return; }
    if (b.kind && b.kind !== kind) gap(mint);
    b.kind = kind || null;
    if (!connected(b.kind)) gap(mint);
    const eventAt = at == null ? t : Math.min(at, t);
    if (!Number.isFinite(eventAt) || eventAt <= t - windowMs) return;
    const id = `${sig}:${buy ? 1 : 0}:${user || ''}:${tokens ?? ''}:${sol}`;
    if (b.ids.has(id)) return;
    snapshot(mint); // expire old rows before enforcing the memory bound
    const row = { id, t: eventAt, buy, user, usd: Number.isFinite(solUsd) && solUsd > 0 ? sol * solUsd : null };
    let i = b.rows.length;
    while (i > b.head && b.rows[i - 1].t > eventAt) i--;
    b.rows.splice(i, 0, row); b.ids.add(id);
    count(b, row, 1);
    if (b.rows.length - b.head > maxEvents) { removeFirst(b); gap(mint); }
    emit(mint);
  }
  function tick() {
    const t = now();
    for (const [mint, b] of books) {
      if (t - b.focus > 60_000) { books.delete(mint); continue; }
      if (t - b.focus > leaseMs || !connected(b.kind)) b.start = t;
      emit(mint); // expire trades and update quiet coins without another provider request
    }
  }
  return { focus, gap, record, snapshot, tick };
}
