import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoinScreen } from '../server/coin-screen.js';
import { readingProblem, illiquid, safetyVerdict } from '../server/quality.js';
import { createBudget } from '../server/metric-budget.js';

test('a viewed chart gets price service regardless of discovery eligibility, but no blanket analytics exception', () => {
  let now = 100_000;
  const screen = createCoinScreen({ now: () => now, lookup: () => null });
  screen.focus('coin');
  assert.equal(screen.allow('coin', 'stream'), true);
  assert.equal(screen.allow('coin'), false);
  now += 15_000;
  assert.equal(screen.allow('coin', 'stream'), false);
});
test('background work yields before the daily cap while prices keep their reserve', () => {
  const budget = createBudget({ allowance: () => 100, spent: 80 });
  assert.equal(budget.reserve({ cost: 1, priority: 'history' }), null);
  assert.equal(budget.reserve({ cost: 1, priority: 'metrics' }), null);
  assert.ok(budget.reserve({ cost: 1, priority: 'price' }));
});
test('qualified unseen coins defer analytics; visible leases expire; held exceptions cover prices only', () => {
  let now = 100_000;
  const screen = createCoinScreen({ now: () => now, lookup: () => ({ born: 90_000, fees: .01 }), held: mint => mint === 'held' });
  assert.equal(screen.allow('coin'), false);
  screen.view('coin');
  assert.equal(screen.allow('coin'), true);
  assert.equal(screen.allow('coin', 'stream'), false);
  now += 20_000;
  assert.equal(screen.allow('coin'), false);
  assert.equal(screen.allow('held', 'stream'), true);
  assert.equal(screen.allow('held'), false);
});
test('unknown liquidity is neither zero liquidity nor evidence of a rug', () => {
  for (const liquidity of [undefined, null, NaN, -1]) {
    const row = { pair: 'pool', dex: 'pumpswap', liquidity, mcap: 80_000 };
    assert.equal(illiquid(row), false);
    assert.equal(readingProblem(row), null);
  }
  assert.match(readingProblem({ dex: 'pumpswap', liquidity: 0, mcap: 80_000 }), /liquidity/);
  assert.match(readingProblem({ dex: 'pumpswap', liquidity: null, mcap: Infinity }), /implausible/);
  const result = safetyVerdict({ status: 'dead', safety: null });
  assert.equal(result.reasons.some(x => /coin is dead|no real trading left/.test(x)), false);
  assert.equal(result.unknown, true);
});
