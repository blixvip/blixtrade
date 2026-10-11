import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetricState } from '../server/metricstate.js';

function fixture(options = {}) {
  let clock = 10_000;
  const state = createMetricState({ now: () => clock, ...options });
  return { state, at: value => { clock = value; } };
}

test('older source snapshots cannot overwrite current market cap', () => {
  const { state, at } = fixture();
  state.put('coin', { mc: 200 }, { source: 'pool', observedAt: 9_900, slot: 100 });
  at(11_000);
  assert.deepEqual(state.put('coin', { mc: 150 }, { source: 'snapshot', observedAt: 9_000, slot: 99 }), {});
  assert.equal(state.get('coin').fields.mc.value, 200);
  assert.equal(state.get('coin').fields.mc.observedAt, 9_900);
});

test('fresher fallback replaces preferred source once its freshness deadline expires', () => {
  const { state, at } = fixture();
  state.put('coin', { mc: 200 }, { source: 'pool', observedAt: 10_000, rank: 10, maxAgeMs: 5_000 });
  at(11_000);
  state.put('coin', { mc: 210 }, { source: 'fallback', observedAt: 11_000, rank: 1 });
  assert.equal(state.get('coin').fields.mc.value, 200, 'healthy preferred source remains authoritative');
  at(16_000);
  assert.equal(state.put('coin', { mc: 220 }, { source: 'fallback', observedAt: 16_000, rank: 1 }).mc.value, 220);
  assert.equal(state.get('coin').fields.mc.source, 'fallback');
});

test('a delayed preferred snapshot does not gain freshness from its receipt time', () => {
  const { state } = fixture();
  state.put('coin', { mc: 100 }, { source: 'pool', observedAt: 1_000, rank: 10, maxAgeMs: 5_000 });
  state.put('coin', { mc: 120 }, { source: 'fallback', observedAt: 9_900, rank: 1 });
  assert.equal(state.get('coin').fields.mc.value, 120);
});

test('same-source slot and sequence prevent reordered updates', () => {
  const { state, at } = fixture();
  state.put('coin', { mc: 100 }, { source: 'pool', observedAt: 10_000, slot: 20, seq: 3 });
  at(10_100);
  state.put('coin', { mc: 80 }, { source: 'pool', observedAt: 10_100, slot: 19, seq: 4 });
  state.put('coin', { mc: 90 }, { source: 'pool', observedAt: 10_100, slot: 20, seq: 2 });
  assert.equal(state.get('coin').fields.mc.value, 100);
  state.put('coin', { mc: 110 }, { source: 'pool', observedAt: 10_100, slot: 20, seq: 4 });
  assert.equal(state.get('coin').fields.mc.value, 110);
});

test('zero is a real measurement while missing and nonfinite inputs are never converted to zero', () => {
  const { state } = fixture();
  const accepted = state.put('coin', { sells: 0, missing: null, absent: undefined, bad: NaN, infinite: Infinity, negativeInfinite: -Infinity }, { source: 'trades', observedAt: 10_000 });
  assert.deepEqual(Object.keys(accepted), ['sells']);
  assert.equal(accepted.sells.value, 0);
  assert.equal(state.get('coin').fields.sells.value, 0);
  for (const key of ['missing', 'absent', 'bad', 'infinite', 'negativeInfinite']) {
    assert.equal(state.get('coin').fields[key], undefined);
  }
});

test('newer unchanged measurements refresh observation age and are published', () => {
  const { state, at } = fixture();
  state.put('coin', { mc: 200 }, { source: 'pool', observedAt: 9_000 });
  const before = state.get('coin').revision;
  state.drain();
  at(12_000);
  state.put('coin', { mc: 200 }, { source: 'pool', observedAt: 11_900 });
  const current = state.get('coin');
  assert.equal(current.fields.mc.observedAt, 11_900);
  assert.equal(current.fields.mc.receivedAt, 12_000);
  assert.ok(current.revision > before);
  assert.equal(state.drain().length, 1);
});

test('independent field updates retain the other field value and provenance', () => {
  const { state, at } = fixture();
  state.put('coin', { mc: 500 }, { source: 'pool', observedAt: 9_900, provisional: true });
  at(11_000);
  state.put('coin', { holders: 25 }, { source: 'ownership', observedAt: 10_500, partial: true });
  const { fields } = state.get('coin');
  assert.equal(fields.mc.value, 500);
  assert.equal(fields.mc.source, 'pool');
  assert.equal(fields.mc.observedAt, 9_900);
  assert.equal(fields.mc.provisional, true);
  assert.equal(fields.holders.value, 25);
  assert.equal(fields.holders.partial, true);
});

test('estimated holding value updates on both price and balance changes', () => {
  const { state, at } = fixture();
  state.derive('coin', 'holdingValue', ['price', 'balance'], ({ price, balance }) => price * balance, { source: 'valuation', estimated: true });
  state.put('coin', { price: 2, balance: 10 }, { source: 'initial', observedAt: 9_000 });
  assert.equal(state.get('coin').fields.holdingValue.value, 20);
  assert.equal(state.get('coin').fields.holdingValue.estimated, true);
  at(11_000);
  state.put('coin', { price: 3 }, { source: 'pool', observedAt: 11_000 });
  assert.equal(state.get('coin').fields.holdingValue.value, 30);
  at(12_000);
  state.put('coin', { balance: 8 }, { source: 'wallet', observedAt: 12_000 });
  assert.equal(state.get('coin').fields.holdingValue.value, 24);
});

test('recalculated estimates retain their oldest input time instead of making stale balances fresh', () => {
  const { state, at } = fixture();
  state.put('coin', { balance: 10 }, { source: 'wallet', observedAt: 1_000, partial: true });
  state.put('coin', { price: 2 }, { source: 'pool', observedAt: 9_900 });
  state.derive('coin', 'holdingValue', ['price', 'balance'], ({ price, balance }) => price * balance, { source: 'valuation', estimated: true });
  at(20_000);
  state.put('coin', { price: 3 }, { source: 'pool', observedAt: 20_000 });
  const estimate = state.get('coin').fields.holdingValue;
  assert.equal(estimate.value, 30);
  assert.equal(estimate.observedAt, 1_000);
  assert.equal(estimate.calculatedAt, 20_000);
  assert.equal(estimate.partial, true);
  assert.equal(estimate.estimated, true);
});

test('derived numbers inherit estimated and partial inputs', () => {
  const { state } = fixture();
  state.derive('coin', 'mc', ['price', 'supply'], ({ price, supply }) => price * supply, { source: 'derived' });
  state.put('coin', { price: 2 }, { source: 'pool', observedAt: 9_000 });
  state.put('coin', { supply: 100 }, { source: 'estimatedSupply', observedAt: 8_000, estimated: true, partial: true });
  const mc = state.get('coin').fields.mc;
  assert.equal(mc.value, 200);
  assert.equal(mc.estimated, true);
  assert.equal(mc.partial, true);
  assert.equal(mc.observedAt, 8_000);
});

test('derivations wait for missing inputs instead of displaying a fabricated zero', () => {
  const { state } = fixture();
  state.derive('coin', 'holdingValue', ['price', 'balance'], ({ price, balance }) => price * balance, { estimated: true });
  state.put('coin', { price: 3 }, { source: 'pool', observedAt: 10_000 });
  assert.equal(state.get('coin').fields.holdingValue, undefined);
});

test('rejected dependency snapshots cannot regress a derived estimate', () => {
  const { state, at } = fixture();
  state.derive('coin', 'holdingValue', ['price', 'balance'], ({ price, balance }) => price * balance, { estimated: true });
  state.put('coin', { price: 3, balance: 10 }, { source: 'snapshot', observedAt: 10_000 });
  at(11_000);
  state.put('coin', { price: 2 }, { source: 'snapshot', observedAt: 9_000 });
  assert.equal(state.get('coin').fields.holdingValue.value, 30);
  assert.equal(state.get('coin').fields.holdingValue.calculatedAt, 10_000);
});

test('snapshot selects requested coins and drain coalesces their latest changes', () => {
  const { state, at } = fixture();
  state.put('a', { mc: 1 }, { source: 'pool', observedAt: 10_000 });
  state.put('b', { mc: 2 }, { source: 'pool', observedAt: 10_000 });
  at(11_000);
  state.put('a', { mc: 3 }, { source: 'pool', observedAt: 11_000 });
  assert.equal(state.get('missing'), null);
  assert.deepEqual(state.snapshot(['a', 'missing']).map(row => row.mint), ['a']);
  const changed = state.drain();
  assert.equal(changed.length, 2);
  assert.equal(changed.find(row => row.mint === 'a').fields.mc.value, 3);
  assert.deepEqual(state.drain(), []);
});

test('filtered drain does not consume changes for other subscribers', () => {
  const { state } = fixture();
  state.put('a', { mc: 1 }, { source: 'pool', observedAt: 10_000 });
  state.put('b', { mc: 2 }, { source: 'pool', observedAt: 10_000 });
  assert.deepEqual(state.drain(new Set(['a'])).map(row => row.mint), ['a']);
  assert.deepEqual(state.drain(new Set(['b'])).map(row => row.mint), ['b']);
});

test('bounded state evicts old coins and their pending changes', () => {
  const { state, at } = fixture({ maxCoins: 2 });
  for (let i = 1; i <= 3; i++) {
    at(10_000 + i);
    state.put(`coin${i}`, { mc: i }, { source: 'pool', observedAt: 10_000 + i });
  }
  assert.equal(state.get('coin1'), null);
  assert.equal(state.get('coin3').fields.mc.value, 3);
  assert.equal(state.snapshot(['coin1', 'coin2', 'coin3']).length, 2);
  assert.equal(state.drain().length, 2);
});

test('dependency chains update downstream estimates and retain original input ages', () => {
  const { state, at } = fixture();
  state.derive('coin', 'holdingValue', ['price', 'balance'], ({ price, balance }) => price * balance, { estimated: true });
  state.derive('coin', 'holdingValueUsd', ['holdingValue', 'solUsd'], ({ holdingValue, solUsd }) => holdingValue * solUsd, { source: 'usd' });
  state.put('coin', { balance: 10 }, { source: 'wallet', observedAt: 1_000 });
  state.put('coin', { price: 2, solUsd: 100 }, { source: 'pool', observedAt: 9_000 });
  assert.equal(state.get('coin').fields.holdingValueUsd.value, 2_000);
  at(20_000);
  state.put('coin', { price: 3 }, { source: 'pool', observedAt: 20_000 });
  const value = state.get('coin').fields.holdingValueUsd;
  assert.equal(value.value, 3_000);
  assert.equal(value.observedAt, 1_000);
  assert.equal(value.calculatedAt, 20_000);
  assert.equal(value.estimated, true);
});

test('cyclic derivation definitions fail explicitly', () => {
  const { state } = fixture();
  assert.throws(() => state.derive('coin', 'self', ['self'], ({ self }) => self + 1, {}));
  state.derive('coin', 'a', ['b'], ({ b }) => b + 1, {});
  assert.throws(() => state.derive('coin', 'b', ['a'], ({ a }) => a + 1, {}));
});

test('confirmation publishes changed provenance even when numeric value and observation time stay unchanged', () => {
  const { state, at } = fixture();
  state.put('coin', { mc: 200 }, { source: 'pool', observedAt: 9_000, slot: 20, seq: 1, provisional: true });
  state.drain();
  at(11_000);
  state.put('coin', { mc: 200 }, { source: 'pool', observedAt: 9_000, slot: 20, seq: 2, provisional: false });
  assert.equal(state.get('coin').fields.mc.provisional, false);
  assert.equal(state.get('coin').fields.mc.observedAt, 9_000);
  const changes = state.drain();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].fields.mc.provisional, false);
});

test('same-source sequence protects updates when a stream has no slot', () => {
  const { state, at } = fixture();
  state.put('coin', { mc: 200 }, { source: 'stream', observedAt: 10_000, seq: 10 });
  at(11_000);
  state.put('coin', { mc: 100 }, { source: 'stream', observedAt: 11_000, seq: 9 });
  assert.equal(state.get('coin').fields.mc.value, 200);
});

test('delta drain publishes only changed fields while snapshot retains complete state', () => {
  const { state, at } = fixture();
  state.put('coin', { mc: 200, fees: 0.5 }, { source: 'initial', observedAt: 10_000 });
  const initial = state.drain(undefined, true);
  assert.deepEqual(Object.keys(initial[0].fields).sort(), ['fees', 'mc']);
  at(11_000);
  state.put('coin', { mc: 220 }, { source: 'pool', observedAt: 11_000 });
  const delta = state.drain(undefined, true);
  assert.equal(delta.length, 1);
  assert.deepEqual(Object.keys(delta[0].fields), ['mc']);
  assert.equal(delta[0].fields.mc.value, 220);
  assert.equal(state.snapshot(['coin'])[0].fields.fees.value, 0.5);
  assert.deepEqual(state.drain(undefined, true), []);
});

test('delta drain includes recalculated dependents without unchanged input fields', () => {
  const { state, at } = fixture();
  state.derive('coin', 'holdingValue', ['price', 'balance'], ({ price, balance }) => price * balance, { estimated: true });
  state.put('coin', { price: 2, balance: 10 }, { source: 'initial', observedAt: 10_000 });
  state.drain(undefined, true);
  at(11_000);
  state.put('coin', { price: 3 }, { source: 'pool', observedAt: 11_000 });
  const delta = state.drain(undefined, true);
  assert.deepEqual(Object.keys(delta[0].fields).sort(), ['holdingValue', 'price']);
  assert.equal(delta[0].fields.holdingValue.value, 30);
  assert.equal(state.get('coin').fields.balance.value, 10);
});

test('filtered delta drain preserves pending field deltas for other coins', () => {
  const { state, at } = fixture();
  state.put('a', { mc: 1, fees: 0.1 }, { source: 'initial', observedAt: 10_000 });
  state.put('b', { mc: 2, fees: 0.2 }, { source: 'initial', observedAt: 10_000 });
  state.drain(undefined, true);
  at(11_000);
  state.put('a', { mc: 3 }, { source: 'pool', observedAt: 11_000 });
  state.put('b', { fees: 0.4 }, { source: 'fees', observedAt: 11_000 });
  const first = state.drain(new Set(['a']), true);
  assert.deepEqual(first.map(row => row.mint), ['a']);
  assert.deepEqual(Object.keys(first[0].fields), ['mc']);
  const remaining = state.drain(new Set(['b']), true);
  assert.deepEqual(remaining.map(row => row.mint), ['b']);
  assert.deepEqual(Object.keys(remaining[0].fields), ['fees']);
  assert.equal(remaining[0].fields.fees.value, 0.4);
});

test('unchanged observations retain a newer source sequence watermark', () => {
  const { state, at } = fixture();
  state.put('coin', { mc: 200 }, { source: 'pool', observedAt: 10_000, slot: 20, seq: 10 });
  at(10_100);
  state.put('coin', { mc: 200 }, { source: 'pool', observedAt: 10_000, slot: 20, seq: 12 });
  assert.equal(state.get('coin').fields.mc.seq, 12);
  assert.equal(state.get('coin').fields.mc.observedAt, 10_000);
});

test('unchanged newer sequence prevents an intervening older sequence from regressing the value', () => {
  const { state, at } = fixture();
  state.put('coin', { mc: 200 }, { source: 'pool', observedAt: 10_000, slot: 20, seq: 10 });
  at(10_100);
  state.put('coin', { mc: 200 }, { source: 'pool', observedAt: 10_000, slot: 20, seq: 12 });
  at(11_000);
  const accepted = state.put('coin', { mc: 150 }, { source: 'pool', observedAt: 10_000, slot: 20, seq: 11 });
  assert.deepEqual(accepted, {});
  assert.equal(state.get('coin').fields.mc.value, 200);
});
