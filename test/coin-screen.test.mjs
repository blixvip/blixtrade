import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoinScreen, screenCoin } from '../server/coin-screen.js';

const now = 1_800_000_000_000;
const coin = (patch = {}) => ({ born: now - 60_000, mcap: 15_000, fees: .002, ...patch });
test('new launches must earn the fee floor before paid enrichment, even during display grace', () => {
  assert.equal(screenCoin(coin({ born: now - 1000, fees: 0 }), now), 'fees');
  assert.equal(screenCoin(coin({ fees: null }), now), 'fees');
  assert.equal(screenCoin(coin(), now), null);
});
test('stretch and migrated candidates use their own fee floors', () => {
  assert.equal(screenCoin(coin({ progress: .7 }), now), 'fees');
  assert.equal(screenCoin(coin({ progress: .7, fees: .05 }), now), null);
  assert.equal(screenCoin(coin({ progress: .7, fees: 1, mcap: 3999 }), now), 'market-cap');
  assert.equal(screenCoin(coin({ progress: .7, fees: 1, born: now - 401 * 60_000 }), now), 'age');
  assert.equal(screenCoin(coin({ graduated: true, fees: .9 }), now), 'fees');
  assert.equal(screenCoin(coin({ graduated: true, fees: 1 }), now), null);
});
test('known severe rug flags block paid work even if volume is high', () => {
  for (const patch of [{ emptied: true }, { dead: true }, { devSold: 'all', mcap: 9000 },
    { holders: 20, top10: 80 }, { born: now - 120_000, dev: 50 }, { bundle: 50 }, { snipers: 50 }, { grade: 'F' }]) {
    assert.notEqual(screenCoin(coin(patch), now), null, JSON.stringify(patch));
  }
  assert.equal(screenCoin(coin({ graduated: true, fees: 1, devSold: 'all' }), now), null);
});
test('unknown audit metrics are not invented; established liquid coins can use indexed activity', () => {
  assert.equal(screenCoin(coin({ holders: null, top10: null }), now), null);
  assert.equal(screenCoin(coin({ born: now - 2 * 864e5, graduated: true, fees: null, liq: 20_000, buys: 20 }), now), null);
  assert.equal(screenCoin(coin({ born: now - 2 * 864e5, graduated: true, fees: null, liq: 0, buys: 20 }), now), 'fees');
});
test('visible rows do not start streams; open qualifying charts do, then expire', () => {
  let time = now;
  const s = createCoinScreen({ lookup: () => coin(), now: () => time });
  s.view('mint'); assert.equal(s.allow('mint'), true);
  assert.equal(s.allow('mint', 'stream'), false);
  s.focus('mint'); assert.equal(s.allow('mint', 'stream'), true);
  time += 20_000; assert.equal(s.allow('mint', 'stream'), false);
});
test('opening any coin prioritizes its price independently of discovery filters', () => {
  let row = coin({ fees: 0 });
  const s = createCoinScreen({ lookup: () => row, now: () => now });
  s.focus('mint'); assert.equal(s.allow('mint', 'stream'), true);
  row = coin({ emptied: true }); assert.equal(s.allow('mint', 'stream'), true);
  assert.equal(s.allow('mint'), false);
});
test('held positions retain monitoring when filters fail and stop exemption after confirmed sale', () => {
  let held = true;
  const s = createCoinScreen({ lookup: () => coin({ emptied: true }), held: () => held, now: () => now });
  assert.equal(s.allow('mint'), false); assert.equal(s.allow('mint', 'stream'), true);
  held = false; assert.equal(s.allow('mint', 'stream'), false);
});
test('unavailable evidence defers work without exceptions; rollback bypasses screening', () => {
  const s = createCoinScreen({ lookup: () => { throw Error('unavailable'); }, now: () => now });
  assert.equal(s.allow('mint'), false);
  assert.equal(createCoinScreen({ enabled: () => false }).allow('mint', 'stream'), true);
  assert.ok(s.status().deferred > 0);
});
