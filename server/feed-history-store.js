// Durable imported events. Sequence and display time never change when a post is edited.
const kinds = { trades: ['large_buy', 'large_sell', 'large_transfer_in', 'large_transfer_out'], closed: ['single_user_sell', 'single_user_transfer_out'], theses: ['thesis_created'], multi: ['multi_user_buy', 'multi_user_sell'], listings: ['new_token_listing'], spikes: ['price_since_listing'], milestones: ['user_trade_profit_milestone'], traders: ['user_with_smart_following'] };
const groupOf = type => Object.keys(kinds).find(k => kinds[k].includes(type)) || 'other';
const timestamp = (n, fallback) => Number.isFinite(n) && n > 0 ? n : fallback;
export function createFeedHistory(db, { maxRows = 50_000 } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS feed_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, mint TEXT, sender TEXT, t INTEGER NOT NULL, timeline INTEGER NOT NULL, received INTEGER NOT NULL, rev INTEGER NOT NULL, body TEXT NOT NULL, fingerprint TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS feed_events_rev ON feed_events(rev);
    CREATE INDEX IF NOT EXISTS feed_events_source ON feed_events(source,seq);
    CREATE TABLE IF NOT EXISTS feed_seen (id TEXT PRIMARY KEY, received INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS feed_meta (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, pruned INTEGER NOT NULL);
    INSERT OR IGNORE INTO feed_meta VALUES(1,0,0);`);
  const find = db.prepare('SELECT * FROM feed_events WHERE id=?');
  const seen = db.prepare('SELECT 1 FROM feed_seen WHERE id=?');
  const remember = db.prepare('INSERT OR IGNORE INTO feed_seen VALUES(?,?)');
  const insert = db.prepare('INSERT INTO feed_events(id,source,kind,mint,sender,t,timeline,received,rev,body,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const update = db.prepare('UPDATE feed_events SET body=?,fingerprint=?,rev=? WHERE id=?');
  const meta = db.prepare('SELECT * FROM feed_meta WHERE id=1');
  const unpack = r => ({ ...JSON.parse(r.body), id: r.id, source: r.source, seq: r.seq, t: r.t, timelineAt: r.timeline, receivedAt: r.received });
  function ingest(source, items, received = Date.now()) {
    if (!['fomo', 'pump'].includes(source) || !Array.isArray(items)) return;
    const candidates = [];
    for (const it of items) {
      if (!it?.id) continue;
      const id = `${source}:${it.id}`, t = timestamp(it.posted, timestamp(it.t, received));
      // Raw and compact source snapshots may have different extra user fields or property order.
      const u = it.user, user = u ? { handle: u.handle || null, pump: u.pump || null, name: u.name || null, pic: u.pic || null, verified: Boolean(u.verified), fomo: Boolean(u.fomo) } : null;
      candidates.push({ ...it, user, id, source, t, posted: t, updates: undefined });
      for (const reply of (it.updates || []).slice(-100)) {
        if (!reply.id || (!reply.text && !reply.media)) continue;
        candidates.push({ ...it, user, id: `${id}:reply:${reply.id}`, source, type: 'reply', group: groupOf(it.type), t: timestamp(reply.t, received), posted: timestamp(reply.t, received), comment: reply.text || null, media: reply.media || null, quoted: null, updates: undefined, pinned: false, replyTo: { id, name: it.user?.name || it.user?.handle || it.user?.pump || 'Trader', text: String(it.comment || it.ticker || '').slice(0, 180) } });
      }
    }
    candidates.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
    let revision = meta.get().revision;
    let timeline = db.prepare('SELECT timeline FROM feed_events ORDER BY seq DESC LIMIT 1').get()?.timeline || 0;
    let added = false;
    db.exec('BEGIN');
    try {
      for (const item of candidates) {
        const old = find.get(item.id);
        if (!old && seen.get(item.id)) continue;
        // Quote/engagement refreshes belong to the shared quote view, not the conversation journal.
        const fingerprint = JSON.stringify([item.comment, item.media, item.quoted, item.user, item.pinned, item.text, item.notes]);
        if (old?.fingerprint === fingerprint) continue;
        const body = { ...item, late: old ? JSON.parse(old.body).late : item.t < timeline, updates: undefined };
        if (old) { update.run(JSON.stringify(body), fingerprint, ++revision, item.id); continue; }
        timeline = Math.max(timeline, item.t);
        insert.run(item.id, source, item.group || groupOf(item.type), item.mint || null, [item.user?.name, item.user?.handle, item.user?.pump].filter(Boolean).join(' ').toLowerCase(), item.t, timeline, received, ++revision, JSON.stringify(body), fingerprint);
        remember.run(item.id, received); added = true;
      }
      if (added) {
        const boundary = db.prepare('SELECT seq FROM feed_events ORDER BY seq DESC LIMIT 1 OFFSET ?').get(Math.max(1, maxRows) - 1)?.seq;
        if (boundary) {
          const pruned = db.prepare('SELECT MAX(rev) AS rev FROM feed_events WHERE seq < ?').get(boundary)?.rev || 0;
          db.prepare('UPDATE feed_meta SET pruned=MAX(pruned,?) WHERE id=1').run(pruned);
          db.prepare('DELETE FROM feed_events WHERE seq < ?').run(boundary);
        }
        // Keep compact replay tombstones beyond the retained conversation, bounded to 100k IDs.
        db.exec('DELETE FROM feed_seen WHERE id IN (SELECT id FROM feed_seen ORDER BY received DESC LIMIT -1 OFFSET 100000)');
      }
      db.prepare('UPDATE feed_meta SET revision=? WHERE id=1').run(revision);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function page(params = {}) {
    const sources = String(params.sources ?? 'fomo,pump').split(',').filter(x => ['fomo', 'pump'].includes(x));
    const groups = String(params.groups ?? Object.keys(kinds).join(',')).split(',').filter(x => x in kinds);
    const integer = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value)))) : fallback;
    const limit = Math.max(1, Math.min(200, integer(params.limit, 80) || 80));
    const after = integer(params.after), before = integer(params.before);
    const where = [], args = [];
    where.push(`source IN (${sources.map(() => '?').join(',') || 'NULL'})`); args.push(...sources);
    where.push(`(source != 'fomo' OR kind IN (${groups.map(() => '?').join(',') || 'NULL'}${groups.length ? ", 'other'" : ''}))`); args.push(...groups);
    if (before) { where.push('seq < ?'); args.push(before); }
    else if (after) { where.push('rev > ?'); args.push(after); }
    if (params.thread) { where.push("(id = ? OR json_extract(body, '$.replyTo.id') = ?)"); args.push(String(params.thread).slice(0, 300), String(params.thread).slice(0, 300)); }
    for (const [field, value] of [['body', params.q], ['sender', params.sender], ['mint', params.token]]) {
      if (value) { where.push(`${field} LIKE ? ESCAPE '\\'`); args.push('%' + String(value).slice(0, 120).replace(/[\\%_]/g, '\\$&') + '%'); }
    }
    const rows = db.prepare(`SELECT * FROM feed_events WHERE ${where.join(' AND ')} ORDER BY ${after && !before ? 'rev ASC' : 'seq DESC'} LIMIT ?`).all(...args, limit + 1);
    const hasMore = rows.length > limit; rows.length = Math.min(rows.length, limit);
    const info = meta.get();
    const cursor = after && hasMore ? Math.max(...rows.map(r => r.rev)) : info.revision;
    return { items: rows.map(unpack).sort((a, b) => a.seq - b.seq), cursor, before: rows.length ? Math.min(...rows.map(r => r.seq)) : before || null, hasMore, gap: Boolean(after && after < info.pruned), retained: maxRows };
  }
  return { ingest, page };
}
