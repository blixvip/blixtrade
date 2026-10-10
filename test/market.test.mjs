import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketPrices } from '../server/market.js';

const binance = [{ symbol: 'BTCUSDT', lastPrice: '62000', openPrice: '60000' }, { symbol: 'ETHUSDT', lastPrice: '2400', openPrice: '2500' }, { symbol: 'SOLUSDT', lastPrice: '150', openPrice: '145' }];
const json = body => ({ ok: true, json: async () => body });
const never = () => new Promise(() => {});
const deadline = promise => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Healthy prices waited on a stalled provider')), 100); timer.unref(); })]);

test('healthy Binance prices do not wait on stalled Coinbase', { timeout: 1000 }, async () => {
  const prices = createMarketPrices({ fetch: async url => url.includes('binance') ? json(binance) : never() });
  const value = await deadline(prices());
  assert.equal(value.btc.usd, 62000);
  assert.ok(value.btc.chg24 > 0);
});

test('healthy Coinbase prices do not wait on stalled Binance', { timeout: 1000 }, async () => {
  const prices = createMarketPrices({ fetch: async url => url.includes('binance') ? never() : json({ data: { amount: '150' } }) });
  assert.equal((await deadline(prices())).source, 'coinbase');
});

test('a slower Binance answer enriches cached spot prices with 24h changes', async () => {
  let finish;
  const later = new Promise(resolve => { finish = resolve; });
  const prices = createMarketPrices({ fetch: async url => url.includes('binance') ? later : json({ data: { amount: '150' } }) });
  assert.equal((await prices()).source, 'coinbase');
  finish(json(binance));
  await new Promise(resolve => setImmediate(resolve));
  const value = await prices();
  assert.equal(value.source, 'binance');
  assert.ok(value.btc.chg24 > 0);
});

test('nonfinite/negative prices and HTTP errors cannot win', async () => {
  const prices = createMarketPrices({ fetch: async url => url.includes('binance') ? json(binance.map(x => ({ ...x, lastPrice: '-1' }))) : json({ data: { amount: '150' } }) });
  assert.equal((await prices()).source, 'coinbase');
  const failed = createMarketPrices({ fetch: async () => ({ ok: false, status: 429, json: async () => ({ data: { amount: '123' } }) }) });
  assert.equal((await failed()).btc, null);
});

test('simultaneous readers share the refresh and fresh prices need no more requests', async () => {
  let count = 0;
  const prices = createMarketPrices({ fetch: async url => { count++; return url.includes('binance') ? json(binance) : json({ data: { amount: '150' } }); } });
  const [a, b] = await Promise.all([prices(), prices()]);
  assert.deepEqual(a, b);
  const seen = count;
  assert.deepEqual(await prices(), a);
  assert.equal(count, seen);
});

test('a refresh failure keeps the last prices and backs off retries', async () => {
  let clock = 1000, fail = false, count = 0;
  const prices = createMarketPrices({ now: () => clock, fetch: async url => { count++; if (fail) throw Error('offline'); return url.includes('binance') ? json(binance) : json({ data: { amount: '150' } }); } });
  const first = await prices();
  clock += 16_000; fail = true;
  assert.deepEqual(await prices(), first);
  await new Promise(resolve => setImmediate(resolve));
  const seen = count;
  assert.deepEqual(await prices(), first);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, seen, 'An outage must not refetch on every request');
});
