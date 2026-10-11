import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetricInterests } from '../server/metric-interests.js';

const HOUR = 3_600_000;
const START = 1_800_000_000_000;
const mint = suffix => `${'A'.repeat(31)}${suffix}`;
const A = mint('B'), B = mint('C'), C = mint('D'), D = mint('E');
function fixture(options = {}) {
  let clock = START;
  return { interests: createMetricInterests({ now: () => clock, ...options }), at: value => { clock = value; } };
}
const young = address => ({ mint: address, born: START - HOUR, active: false });
const old = address => ({ mint: address, born: START - 48 * HOUR, active: false });

test('renew replaces one session interests without overwriting another tab', () => {
  const { interests } = fixture();
  assert.equal(interests.renew('tab:a', [young(A), young(B)]), true);
  assert.equal(interests.renew('tab:b', [young(B), young(C)]), true);
  assert.equal(interests.renew('tab:a', [young(D)]), true);
  assert.deepEqual([...interests.get('tab:a')], [D]);
  assert.deepEqual([...interests.get('tab:b')], [B, C]);
  assert.deepEqual(new Set(interests.select(20)), new Set([B, C, D]));
});

test('session identifiers reject unsafe, missing and excessively long values', () => {
  const { interests } = fixture();
  for (const session of ['', '../tab', 'a b', '<script>', 'a'.repeat(161), null, undefined, 42]) {
    assert.equal(interests.renew(session, [young(A)]), false);
  }
  assert.deepEqual(interests.select(), []);
  assert.equal(interests.renew('tab:one_two-3', [young(A)]), true);
});

test('invalid mint addresses are ignored while valid interests remain', () => {
  const { interests } = fixture();
  interests.renew('tab', [young(A), ...['', '0'.repeat(32), 'O'.repeat(32), '<script>', 'A'.repeat(31), 'A'.repeat(45)].map(young)]);
  assert.deepEqual([...interests.get('tab')], [A]);
  assert.deepEqual(interests.select(), [A]);
});

test('selection deduplicates shared coins across browser sessions', () => {
  const { interests } = fixture();
  interests.renew('one', [young(A), young(A), young(B)]);
  interests.renew('two', [young(A), young(C)]);
  const selected = interests.select(10);
  assert.equal(selected.length, 3);
  assert.deepEqual(new Set(selected), new Set([A, B, C]));
});

test('empty renewal releases that session while other tabs remain subscribed', () => {
  const { interests } = fixture();
  interests.renew('one', [young(A)]);
  interests.renew('two', [young(A), young(B)]);
  assert.equal(interests.renew('one', []), true);
  assert.deepEqual([...interests.get('one')], []);
  assert.deepEqual(new Set(interests.select()), new Set([A, B]));
});

test('expired visibility leases stop consuming collection capacity', () => {
  const { interests, at } = fixture({ ttlMs: 20_000 });
  interests.renew('tab', [young(A)]);
  at(START + 20_001);
  assert.deepEqual(interests.select(), []);
  assert.deepEqual([...interests.get('tab')], []);
  assert.equal(interests.snapshot().sessions, 0);
});

test('renewal extends only the renewed session lease', () => {
  const { interests, at } = fixture({ ttlMs: 20_000 });
  interests.renew('one', [young(A)]);
  interests.renew('two', [young(B)]);
  at(START + 15_000);
  interests.renew('one', [young(C)]);
  at(START + 25_000);
  assert.deepEqual(interests.select(), [C]);
});

test('active coin outranks age and active status is shared across sessions', () => {
  const { interests } = fixture();
  interests.renew('list', [young(A), old(B)]);
  interests.renew('detail', [{ ...old(B), active: true }]);
  assert.deepEqual(interests.select(1), [B]);
  interests.renew('detail', []);
  assert.deepEqual(interests.select(1), [A]);
});

test('young coins lead remaining slots while older coins retain reserved service', () => {
  const { interests } = fixture();
  const youngMints = ['F', 'G', 'H', 'J', 'K', 'L'].map(mint);
  interests.renew('tab', [...youngMints.map(young), old(A), old(B)]);
  const selected = interests.select(4);
  assert.equal(selected.length, 4);
  assert.ok(youngMints.includes(selected[0]));
  assert.ok(selected.some(value => value === A || value === B), 'older visible coins receive service despite young backlog');
});

test('equal-priority selection rotates rather than permanently starving later coins', () => {
  const { interests } = fixture();
  interests.renew('tab', [A, B, C, D].map(young));
  const observed = new Set();
  for (let i = 0; i < 8; i++) {
    const selected = interests.select(1);
    assert.equal(selected.length, 1);
    observed.add(selected[0]);
  }
  assert.deepEqual(observed, new Set([A, B, C, D]));
});

test('reserved older service rotates across all older interested coins', () => {
  const { interests } = fixture();
  const youngMints = ['F', 'G', 'H', 'J', 'K', 'L'].map(mint);
  interests.renew('tab', [...youngMints.map(young), ...[A, B, C, D].map(old)]);
  const observed = new Set();
  for (let i = 0; i < 12; i++) {
    const selected = interests.select(4);
    for (const address of selected) if ([A, B, C, D].includes(address)) observed.add(address);
  }
  assert.deepEqual(observed, new Set([A, B, C, D]));
});

test('active coins keep priority when they fill the selected capacity', () => {
  const { interests } = fixture();
  interests.renew('tab', [{ ...young(A), active: true }, { ...old(B), active: true }, old(C), young(D)]);
  assert.deepEqual(new Set(interests.select(2)), new Set([A, B]));
});

test('unknown and future launch times do not gain newborn priority', () => {
  const { interests } = fixture();
  interests.renew('tab', [{ mint: A, born: 0 }, { mint: B, born: START + HOUR }, young(C)]);
  assert.deepEqual(interests.select(1), [C]);
});

test('session and per-session mint bounds limit untrusted subscriptions', () => {
  const { interests } = fixture({ maxSessions: 2, maxMints: 2 });
  interests.renew('one', [A, B, C, D].map(young));
  assert.equal(interests.get('one').size, 2);
  interests.renew('two', [young(C)]);
  interests.renew('three', [young(D)]);
  assert.ok(interests.snapshot().sessions <= 2);
});

test('renew copies entries and get does not expose mutable internal sets', () => {
  const { interests } = fixture();
  const entry = young(A);
  const entries = [entry];
  interests.renew('tab', entries);
  entry.mint = B;
  entry.active = true;
  entries.push(young(C));
  const exposed = interests.get('tab');
  exposed.add(D);
  assert.deepEqual([...interests.get('tab')], [A]);
  assert.deepEqual(interests.select(), [A]);
});

test('snapshot counts sessions and unique interested mints', () => {
  const { interests } = fixture();
  interests.renew('one', [young(A), young(B)]);
  interests.renew('two', [young(B), young(C)]);
  const snapshot = interests.snapshot();
  assert.equal(snapshot.sessions, 2);
  assert.equal(snapshot.mints, 3);
});
