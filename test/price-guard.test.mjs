import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriceGuard } from '../server/price-guard.js';
test('guard rejects nonfinite, stale slots and unconfirmed extreme jumps', () => {
  const guard = createPriceGuard({ now: () => 100 });
  assert.equal(guard.accept('m', 100, 10), true);
  assert.equal(guard.accept('m', 110, 9), false);
  assert.equal(guard.accept('m', Infinity, 11), false);
  assert.equal(guard.accept('m', 10000, 11), false);
  assert.equal(guard.accept('m', 10100, 11), false, 'same-slot repeat is not independent confirmation');
  assert.equal(guard.accept('m', 10100, 12), true);
});
