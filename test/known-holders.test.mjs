import test from 'node:test';
import assert from 'node:assert/strict';
import { holderSummary, parseKnownTokens, knownKey, SOL_NETWORK } from '../server/known-holders.js';

test('known holders show the three largest current positions, not followers or sold positions', () => {
  const s = holderSummary({ totalHolders: 12, holders: [
    { handle: 'small', value: 10, amount: 1 }, { handle: 'sold', value: 900, amount: 0 },
    { handle: 'large', value: 400, amount: 5 }, { handle: 'medium', value: 80 },
    { handle: 'fourth', value: 20 }, { handle: 'LARGE', value: 400, amount: 5 },
  ] });
  assert.equal(s[0], 12);
  assert.deepEqual(s[1].map(x => x[0]), ['large', 'medium', 'fourth']);
});
test('empty, missing pictures and unknown amounts do not fabricate holders', () => {
  assert.deepEqual(holderSummary({ holders: [], totalHolders: 0 }), [0, []]);
  assert.deepEqual(holderSummary({ holders: [{ handle: 'alice' }] }), [1, [['alice', '', null]]]);
  assert.deepEqual(holderSummary({ holders: [{ handle: 'sold', amount: 0 }], totalHolders: null }), [0, []]);
});
test('batch targets are bounded, validated, deduplicated and chain-specific', () => {
  const mint = 'So11111111111111111111111111111111111111112', evm = '0x' + 'a'.repeat(40);
  const targets = parseKnownTokens(`${SOL_NETWORK}:${mint},${SOL_NETWORK}:${mint},8453:${evm},143:${evm},1:bad,0:bad,__proto__:bad`);
  assert.equal(targets.length, 3);
  assert.equal(knownKey(targets[0]), mint);
  assert.notEqual(knownKey(targets[1]), knownKey(targets[2]));
  assert.equal(parseKnownTokens(Array.from({length:200}, (_,i) => `8453:0x${i.toString(16).padStart(40,'0')}`).join(',')).length, 100);
});
