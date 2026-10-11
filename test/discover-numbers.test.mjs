import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverNumbers, metricPrefix } from '../web/src/pages/discover/numbers.ts';
const row = { mint: 'coin', mcap: 100, liquidity: 20, vol_h24: 300, vol_h1: 30, buys_h1: 4, sells_h1: 2, fees: .1, safety: { top10: 9, totalHolders: 20 } };
const field = (value, extra = {}) => ({ value, ...extra });
test('Discover rows and cards use the selected window and current shared fields', () => {
  const got = discoverNumbers(row, '24h', { fields: { mc: field(200), priceUsd: field(.003), liq: field(40), vol24h: field(900), buys24h: field(80), sells24h: field(10), holders: field(51), top10: field(8), fees: field(.2) } });
  assert.equal(got.mc, 200); assert.equal(got.price, .003); assert.equal(got.vol, 900); assert.equal(got.tx, 90);
  assert.equal(got.row.liquidity, 40); assert.equal(got.row.safety.totalHolders, 51); assert.equal(got.row.safety.top10, 8); assert.equal(got.row.fees, .2);
  assert.equal(row.mcap, 100); assert.equal(row.safety.totalHolders, 20);
});
test('Missing 24h counts never borrow hourly counts or manufacture zero', () => {
  const got = discoverNumbers(row, '24h');
  assert.equal(got.buys, null); assert.equal(got.sells, null); assert.equal(got.tx, null); assert.equal(got.buyShare, null);
});
test('One missing side cannot become an exact total or buy ratio', () => {
  const got = discoverNumbers(row, '24h', { fields: { buys24h: field(9) } });
  assert.equal(got.buys, 9); assert.equal(got.sells, null); assert.equal(got.tx, null); assert.equal(got.buyShare, null);
});
test('Zero observations remain zero while invalid values fall back', () => {
  const got = discoverNumbers(row, '1h', { fields: { holders: field(0), dev: field(0), buys1h: field(0), sells1h: field(0), liq: field(Infinity), vol1h: field(-10) } });
  assert.equal(got.tx, 0); assert.equal(got.row.safety.totalHolders, 0); assert.equal(got.row.safety.devPct, 0); assert.equal(got.row.liquidity, 20); assert.equal(got.vol, 30);
});
test('Never infer token price from an assumed billion-token supply', () => {
  assert.equal(discoverNumbers({ ...row, mint: 'coinpump' }, '1h').price, null);
});
test('Window change and shared live market cap have independent values', () => {
  const got = discoverNumbers({ ...row, chg_h1: 2 }, '1h', { fields: { mc: field(250), chg1h: field(-7), vol24h: field(900) } }, 260);
  assert.equal(got.mc, 260); assert.equal(got.chg, -7); assert.equal(got.vol, 30);
});
test('Persisted 24h snapshot counts are accepted independently from live deltas', () => {
  const got = discoverNumbers({ ...row, buys_h24: 12, sells_h24: 5 }, '24h');
  assert.equal(got.tx, 17);
});
test('Estimates have no approximation prefix; genuine lower bounds retain their marker', () => {
  assert.equal(metricPrefix(field(3, { estimated: true })), '');
  assert.equal(metricPrefix(field(3, { partial: true }), true), '≥');
  assert.equal(metricPrefix(field(3, { partial: true })), '');
  assert.equal(metricPrefix(field(0)), '');
});
