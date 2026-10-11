import test from 'node:test';
import assert from 'node:assert/strict';
import { rpcCredits, dailyAllowance, createBudget } from '../server/metric-budget.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 10, 12);
const params = (options = {}) => ['mint', { transactionDetails: 'full', ...options }];
const rows = n => ({ data: Array.from({ length: n }, () => ({})) });
function fixture(options = {}) {
  let time = NOW;
  let cap = 100;
  const budget = createBudget({ now: () => time, allowance: () => cap, rate: 100, ...options });
  return { budget, advance(ms) { time += ms; }, cap(value) { cap = value; } };
}

test('RPC credit reservations distinguish standard reads, program scans and history request limits', () => {
  assert.equal(rpcCredits('getBalance'), 1);
  assert.equal(rpcCredits('getMultipleAccounts'), 1);
  assert.equal(rpcCredits('getProgramAccounts'), 10);
  assert.equal(rpcCredits('getTransactionsForAddress', params()), 100);
  assert.equal(rpcCredits('getTransactionsForAddress', params({ limit: 100 })), 10);
  assert.equal(rpcCredits('getTransactionsForAddress', params({ limit: 101 })), 20);
  assert.equal(rpcCredits('getTransactionsForAddress', params({ limit: 9999 })), 100);
  assert.equal(rpcCredits('getTransactionsForAddress', params({ transactionDetails: 'signatures', limit: 1000 })), 10);
});

test('history settlements bill returned rows in hundreds with a ten-credit minimum', () => {
  for (const [count, expected] of [[0, 10], [1, 10], [100, 10], [101, 20], [1000, 100]]) {
    assert.equal(rpcCredits('getTransactionsForAddress', params(), rows(count)), expected);
  }
  assert.equal(rpcCredits('getTransactionsForAddress', params(), undefined, { failed: true }), 0);
  assert.equal(rpcCredits('getTransactionsForAddress', params(), rows(100), { failed: true }), 0);
  assert.equal(rpcCredits('getTransactionsForAddress', params({ transactionDetails: 'signatures' }), rows(1000)), 10);
});

test('monthly pacing reserves three percent and includes spend already accrued today', () => {
  const options = { configured: 1000, remaining: 2300, limit: 10000, resetAt: NOW + 10 * DAY, now: NOW };
  assert.equal(dailyAllowance(options), 200);
  assert.equal(dailyAllowance({ ...options, spent: 80, externalDaily: 30 }), 250);
  assert.equal(dailyAllowance({ ...options, configured: 100 }), 100);
});

test('depleted monthly allowance has no artificial daily spending floor', () => {
  const options = { configured: 5000, remaining: 300, limit: 10000, resetAt: NOW + DAY, now: NOW };
  assert.equal(dailyAllowance(options), 0);
  assert.equal(dailyAllowance({ ...options, remaining: 1 }), 0);
  assert.equal(dailyAllowance({ ...options, remaining: 305 }), 5);
  assert.equal(dailyAllowance({ ...options, remaining: 400, externalDaily: 101 }), 0);
  assert.equal(dailyAllowance({ ...options, configured: 0, remaining: 10000 }), 0);
});

test('monthly pacing uses at least one remaining day', () => {
  const options = { configured: 1000, remaining: 400, limit: 10000, now: NOW };
  assert.equal(dailyAllowance({ ...options, resetAt: NOW + DAY / 2 }), 100);
  assert.equal(dailyAllowance({ ...options, resetAt: NOW - DAY }), 100);
});

test('concurrent reservations cannot exceed the exact daily credit allowance', () => {
  const { budget } = fixture();
  const first = budget.reserve({ cost: 60, priority: 'price' });
  assert.ok(first);
  assert.equal(budget.reserve({ cost: 41, priority: 'price' }), null);
  const second = budget.reserve({ cost: 40, priority: 'price' });
  assert.ok(second);
  assert.equal(budget.status().reserved, 100);
  assert.equal(budget.reserve({ cost: 1, priority: 'price' }), null);
  first.settle(60);
  second.settle(40);
  assert.equal(budget.status().spent, 100);
  assert.equal(budget.status().reserved, 0);
  assert.equal(budget.reserve({ cost: 1, priority: 'price' }), null);
});

test('secondary metrics and history cannot consume the protected market-cap reserve', () => {
  const { budget } = fixture();
  const history = budget.reserve({ cost: 5, priority: 'history' });
  assert.ok(history);
  assert.equal(budget.reserve({ cost: 1, priority: 'history' }), null);
  const metrics = budget.reserve({ cost: 20 });
  assert.ok(metrics);
  history.settle(5);
  metrics.settle(20);
  assert.equal(budget.reserve({ cost: 1 }), null);
  assert.ok(budget.reserve({ cost: 75, priority: 'price' }));
});

test('settling a smaller response releases only the excess reservation and is idempotent', () => {
  const { budget } = fixture();
  const ticket = budget.reserve({ cost: 100, priority: 'price' });
  assert.ok(ticket);
  ticket.settle(10);
  ticket.settle(90);
  ticket.cancel();
  assert.equal(budget.status().spent, 10);
  assert.equal(budget.status().reserved, 0);
  assert.ok(budget.reserve({ cost: 90, priority: 'price' }));
});

test('unexpected actual usage above reservation is counted and prevents further spending', () => {
  const { budget } = fixture();
  const ticket = budget.reserve({ cost: 10, priority: 'price' });
  ticket.settle(110);
  assert.equal(budget.status().spent, 110);
  assert.equal(budget.status().reserved, 0);
  assert.equal(budget.reserve({ cost: 1, priority: 'price' }), null);
});

test('cancel releases credit reservation exactly once without recording usage', () => {
  const { budget } = fixture();
  const ticket = budget.reserve({ cost: 100, priority: 'price' });
  ticket.cancel();
  ticket.cancel();
  ticket.settle(100);
  assert.equal(budget.status().spent, 0);
  assert.equal(budget.status().reserved, 0);
  assert.ok(budget.reserve({ cost: 100, priority: 'price' }));
});

test('known and restored usage consumes the same cumulative allowance as reservations', () => {
  const { budget } = fixture({ spent: 70 });
  budget.note(10);
  assert.equal(budget.status().spent, 80);
  assert.equal(budget.reserve({ cost: 21, priority: 'price' }), null);
  assert.ok(budget.reserve({ cost: 20, priority: 'price' }));
});

test('global token bucket limits all priorities and replenishes continuously', () => {
  const { budget, advance } = fixture({ rate: 2 });
  assert.ok(budget.reserve({ cost: 1, priority: 'price' }));
  assert.ok(budget.reserve({ cost: 1, priority: 'metrics' }));
  assert.equal(budget.reserve({ cost: 1, priority: 'history' }), null);
  advance(499);
  assert.equal(budget.reserve({ cost: 1, priority: 'price' }), null);
  advance(1);
  assert.ok(budget.reserve({ cost: 1, priority: 'price' }));
  assert.equal(budget.reserve({ cost: 1, priority: 'metrics' }), null);
  advance(10_000);
  assert.ok(budget.reserve({ cost: 1, priority: 'metrics' }));
  assert.ok(budget.reserve({ cost: 1, priority: 'metrics' }));
  assert.equal(budget.reserve({ cost: 1, priority: 'price' }), null);
});

test('a lowered allowance immediately blocks new work without dropping in-flight accounting', () => {
  const { budget, cap } = fixture();
  const ticket = budget.reserve({ cost: 70, priority: 'price' });
  cap(50);
  assert.equal(budget.reserve({ cost: 1, priority: 'price' }), null);
  ticket.settle(70);
  assert.equal(budget.status().spent, 70);
  assert.equal(budget.status().reserved, 0);
});
