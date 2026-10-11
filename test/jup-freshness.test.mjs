import test from 'node:test';
import assert from 'node:assert/strict';
import { jupCandles } from '../server/jup.js';
test('failed background refresh cannot renew the age of retained candles', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1800000000000 });
  let failed = false;
  t.mock.method(globalThis, 'fetch', async () => failed ? new Response('', { status: 503 }) : Response.json({ candles: [{ time: 1800000000, open: 1, high: 1, low: 1, close: 1, volume: 1 }] }));
  assert.equal((await jupCandles('freshness-fixture', 1)).length, 1);
  failed = true; t.mock.timers.tick(7000);
  assert.equal((await jupCandles('freshness-fixture', 1)).length, 1);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(9000);
  await assert.rejects(jupCandles('freshness-fixture', 1), /Jupiter 503/);
});
