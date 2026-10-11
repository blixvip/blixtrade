import test from 'node:test';
import assert from 'node:assert/strict';
import { markValue } from '../web/src/lib/position-value.ts';

test('position value converts known token holdings through current token and SOL prices', () => {
  assert.equal(markValue(1_000, 0.3, 150, 0), 2);
  assert.equal(markValue(2.5, 0.12, 150, 29_999), 0.002);
});

test('zero token balance remains a genuine zero valuation', () => {
  assert.equal(markValue(0, 0.3, 150, 100), 0);
});

test('invalid or missing balances cannot become fabricated zero positions', () => {
  for (const tokens of [null, undefined, '', '10', false, NaN, Infinity, -Infinity, -1]) {
    assert.equal(markValue(tokens, 0.3, 150, 100), null, `tokens=${String(tokens)}`);
  }
});

test('token price must be a known positive finite number', () => {
  for (const price of [null, undefined, '', '0.3', false, NaN, Infinity, -Infinity, 0, -1]) {
    assert.equal(markValue(1_000, price, 150, 100), null, `price=${String(price)}`);
  }
});

test('SOL conversion must be a known positive finite number', () => {
  for (const solUsd of [null, undefined, '', '150', false, NaN, Infinity, -Infinity, 0, -1]) {
    assert.equal(markValue(1_000, 0.3, solUsd, 100), null, `solUsd=${String(solUsd)}`);
  }
});

test('unknown, negative and stale price ages make valuation unavailable', () => {
  for (const age of [null, undefined, '', '100', false, NaN, Infinity, -Infinity, -1, 30_000, 30_001, 1e9]) {
    assert.equal(markValue(1_000, 0.3, 150, age), null, `ageMs=${String(age)}`);
  }
  assert.equal(markValue(1_000, 0.3, 150, 29_999.9), 2);
});

test('finite inputs that overflow the calculated value return unavailable', () => {
  assert.equal(markValue(Number.MAX_VALUE, 2, 1, 0), null);
  assert.equal(markValue(1, 1, Number.MIN_VALUE, 0), null);
});

test('zero tokens do not bypass invalid price or freshness checks', () => {
  assert.equal(markValue(0, null, 150, 100), null);
  assert.equal(markValue(0, 0.3, 0, 100), null);
  assert.equal(markValue(0, 0.3, 150, 30_000), null);
});
