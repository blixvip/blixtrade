import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoinFlow } from '../server/coin-flow.js';

function fixture(maxEvents) {
  let time = 1_000_000, online = true;
  const updates = [], flow = createCoinFlow({ now: () => time, connected: kind => online && kind === 'curve', onUpdate: x => updates.push(x), maxEvents });
  const record = (sig, extra = {}) => flow.record('M', { sig, buy: true, sol: 1, tokens: 10, user: 'A', kind: 'curve', solUsd: 100, ...extra });
  flow.focus('M');
  return { flow, updates, record, advance(ms) { for (let n = 0; n < ms; n += 1000) { time += Math.min(1000, ms - n); flow.focus('M'); flow.tick(); } }, disconnect() { online = false; flow.tick(); online = true; } };
}
test('real trades immediately update totals, deduplicate, and exclude synthetic balance rows', () => {
  const f = fixture();
  f.record('buy'); f.record('buy'); f.record('preview', { fast: true }); f.record('sell', { buy: false, sol: 0.4, user: 'B' });
  const x = f.updates.at(-1);
  assert.deepEqual([x.flow.buys,x.flow.sells,x.flow.volUsd,x.flow.netUsd,x.flow.traders], [1,1,140,60,2]);
  assert.equal(x.complete,false);
  assert.equal(f.updates.length,2);
});
test('five minutes of uninterrupted coverage enables totals; expiration requires no new trade', () => {
  const f=fixture(); f.record('old'); f.advance(299_000); f.record('new'); f.advance(1000);
  assert.equal(f.flow.snapshot('M').complete,true);
  assert.equal(f.flow.snapshot('M').flow.buys,1);
  f.advance(299_000);
  assert.equal(f.flow.snapshot('M').flow.buys,0);
});
test('disconnects and dropped events invalidate coverage, and missing traders stay unknown', () => {
  const f=fixture(); f.record('a'); f.advance(300_000); f.record('b',{user:null});
  assert.equal(f.flow.snapshot('M').flow.traders,null);
  f.disconnect(); assert.equal(f.flow.snapshot('M').complete,false);
  f.advance(300_000); assert.equal(f.flow.snapshot('M').complete,true);
  f.record(null); assert.equal(f.flow.snapshot('M').complete,false);
});
test('bounded memory cannot silently claim complete totals after dropping events', () => {
  const f=fixture(2); f.record('a');f.advance(300_000);f.record('b');f.record('c');f.record('d');
  assert.equal(f.flow.snapshot('M').complete,false);
  assert.equal(f.flow.snapshot('M').flow.buys,2);
});
