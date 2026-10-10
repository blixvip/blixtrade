import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createFeedHistory } from '../server/feed-history-store.js';
import { memberMay, visitorMay } from '../server/access.js';
const post = (id, t, extra = {}) => ({ id, t, posted: t, type: 'pump_callout', mint: '11111111111111111111111111111111', chain: 1399811149, comment: `Message ${id}`, user: { name: 'Alice', pump: 'alice' }, ...extra });
function fixture(t, options) { const db = new DatabaseSync(':memory:'); t.after(() => db.close()); return createFeedHistory(db, options); }
test('namespaces sources, fixes event order and updates a message without inserting it again', t => {
  const h = fixture(t); h.ingest('pump', [post('same', 200), post('older', 100)], 300);
  h.ingest('fomo', [post('same', 210, { type: 'thesis_created' })], 300);
  const first = h.page({}); assert.equal(first.items.length, 3);
  const original = first.items.find(x => x.id === 'pump:same');
  h.ingest('pump', [post('same', 900, { comment: 'Edited', posted: 200 })], 1000);
  const next = h.page({ after: first.cursor });
  assert.equal(next.items.length, 1); assert.equal(next.items[0].seq, original.seq);
  assert.equal(next.items[0].t, original.t); assert.equal(next.items[0].comment, 'Edited');
  assert.equal(h.page({}).items.length, 3);
});
test('replies become independent rows and reconnect replay never duplicates them', t => {
  const h = fixture(t), parent = post('a', 100);
  h.ingest('pump', [parent], 200);
  const first = h.page({});
  const updated = { ...parent, t: 300, updates: [{ id: 'r1', t: 250, text: 'Reply' }] };
  h.ingest('pump', [updated], 350); h.ingest('pump', [updated], 400);
  const next = h.page({ after: first.cursor });
  assert.equal(next.items.length, 1); assert.equal(next.items[0].type, 'reply');
  assert.equal(next.items[0].replyTo.id, 'pump:a');
  assert.equal(h.page({}).items.length, 2);
});
test('real cursor history pages remain stable across arrivals and enforce source/kind/search filters', t => {
  const h = fixture(t);
  h.ingest('pump', Array.from({ length: 125 }, (_, i) => post(String(i), i + 1)), 1000);
  const recent = h.page({ limit: 40 }); assert.equal(recent.items.length, 40); assert.equal(recent.hasMore, true);
  h.ingest('pump', [post('new', 1001)], 1002);
  const older = h.page({ before: recent.before, limit: 40 });
  assert.equal(older.items.length, 40); assert.ok(older.items.at(-1).seq < recent.items[0].seq);
  assert.equal(new Set([...recent.items, ...older.items].map(x => x.id)).size, 80);
  assert.equal(h.page({ sources: 'fomo' }).items.length, 0);
  assert.equal(h.page({ q: 'Message 124' }).items.length, 1);
  assert.equal(h.page({ sender: 'nobody' }).items.length, 0);
});
test('late imports append with explicit source time; pruning and resume gaps are reported', t => {
  const h = fixture(t, { maxRows: 3 });
  h.ingest('pump', [post('a', 100), post('b', 200)], 300);
  h.ingest('pump', [post('late', 50)], 400);
  const late = h.page({}).items.at(-1); assert.equal(late.late, true); assert.equal(late.t, 50); assert.ok(late.timelineAt >= 200);
  h.ingest('pump', [post('c', 500), post('d', 600)], 700);
  assert.equal(h.page({}).items.length, 3);
  assert.equal(h.page({ after: 1 }).gap, true);
});
test('quote updates and shorter source snapshots cannot replay or remove conversation rows', t => {
  const h = fixture(t); h.ingest('pump', [post('a', 100, { mc: 50 }), post('b', 200)], 300);
  const first = h.page({}); h.ingest('pump', [post('a', 999, { mc: 90, posted: 100, views: 800 })], 1000);
  assert.deepEqual(h.page({ after: first.cursor }).items, []);
  assert.equal(h.page({}).items.length, 2);
});
test('thread lookup includes the parent and its replies, not unrelated posts', t => {
  const h = fixture(t); h.ingest('pump', [post('a', 100, { updates: [{ id: 'r', t: 200, text: 'Reply' }] }), post('b', 300)], 400);
  assert.deepEqual(h.page({ thread: 'pump:a' }).items.map(x => x.id), ['pump:a', 'pump:a:reply:r']);
});
test('malformed cursor inputs are bounded and filters cannot become SQL', t => {
  const h = fixture(t); h.ingest('pump', [post('a', 100)], 300);
  assert.equal(h.page({ limit: '1.5', after: 'Infinity', before: 'NaN' }).items.length, 1);
  assert.equal(h.page({ sender: "' OR 1=1 --" }).items.length, 0);
});
test('feed history is a member read, never a public endpoint or a write', () => {
  assert.equal(memberMay('GET', '/api/feed/history'), true);
  assert.equal(memberMay('POST', '/api/feed/history'), false);
  assert.equal(visitorMay('GET', '/api/feed/history'), false);
});
test('raw versus compact user metadata cannot manufacture message edits', t => {
  const h = fixture(t), raw = post('a', 100, { user: { name: 'Alice', pump: 'alice', x: 'extra-provider-field' } });
  h.ingest('pump', [raw], 200); const first = h.page({});
  h.ingest('pump', [{ ...raw, user: { pump: 'alice', name: 'Alice' } }], 300);
  assert.equal(h.page({}).cursor, first.cursor);
  assert.deepEqual(h.page({ after: first.cursor }).items, []);
});
