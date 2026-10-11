import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBars, continuousBars, fomoMarketBars, validTrade } from '../server/chart-data.js';
const t = Math.floor(Date.now() / 1000) - 60;
const bar = (time = t) => ({ time, open: 100, high: 120, low: 90, close: 110, value: 5 });

test('bad provider rows cannot poison time, price, or volume; duplicates are snapshots', () => {
  const rows = [bar(t + 1), null, {...bar(), high: NaN}, {...bar(), time: Date.now()},
    {...bar(), low: 105}, {...bar(), close: Infinity}, {...bar(), time: null},
    bar(), {...bar(t + 1), close: 115, value: Infinity}];
  assert.deepEqual(normalizeBars(rows), [bar(), {...bar(t + 1), close: 115, value: 0}]);
  assert.deepEqual(normalizeBars({ rows: [] }), []);
});
test('All history across a year takes space proportional to real bars, preserving real crashes', () => {
  const rows = [bar(t - 365 * 86400), {...bar(), open: 2, high: 3, low: 1, close: 1}];
  const result = continuousBars(rows, 1, Infinity);
  assert.equal(result.length, 2);
  assert.equal(result[1].open, 110);
  assert.equal(result[1].close, 1);
  assert.equal(continuousBars(rows, 1, 200).length, 1);
});
test('Fomo needs a real supply before converting token prices to market caps', () => {
  const rows = [[t, .001, .002, .0005, .0015, 20]];
  for (const supply of [null, 0, -1, Infinity, NaN]) assert.deepEqual(fomoMarketBars(rows, supply), []);
  assert.equal(fomoMarketBars(rows, 1e9)[0].close, 1_500_000);
});
test('live input rejects nonfinite prices, invalid volumes and far future or missing timestamps', () => {
  assert.equal(validTrade(100, 0, Date.now()), true);
  for (const args of [[Infinity,1,Date.now()], [100,NaN,Date.now()], [100,-1,Date.now()], [100,1,NaN], [100,1,Date.now()+120000]])
    assert.equal(validTrade(...args), false);
});
