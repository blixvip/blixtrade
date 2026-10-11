import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeeLedger } from '../server/fee-ledger.js';

function fixture(options = {}) {
  let clock = 1_800_000;
  return { ledger: createFeeLedger({ now: () => clock, ...options }), at: value => { clock = value; } };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `Expected ${actual} to equal ${expected}`);
}

test('fee ledger preserves observed fees separately from coverage uplift', () => {
  const { ledger } = fixture();
  ledger.add('coin', { sol: 0.01, signature: 'tx1', at: 1_800_000, coverage: 0.5 });
  const result = ledger.get('coin');
  close(result.observedSol, 0.01);
  close(result.sol, 0.02);
  close(result.estimatedSol, 0.01);
  assert.equal(result.coverage, 0.5);
  assert.equal(result.estimated, true);
  assert.equal(result.partial, true);
  assert.equal(result.since, 1_800_000);
});

test('each minute uses its own coverage instead of rescaling the whole history', () => {
  const { ledger, at } = fixture();
  ledger.add('coin', { sol: 0.01, signature: 'tx1', at: 1_800_000, coverage: 0.5 });
  at(1_860_000);
  ledger.add('coin', { sol: 0.01, signature: 'tx2', at: 1_860_000, coverage: 0.25 });
  const result = ledger.get('coin');
  close(result.observedSol, 0.02);
  close(result.sol, 0.06);
  close(result.estimatedSol, 0.04);
  close(result.coverage, 1 / 3);
});

test('late coverage correction changes the estimate without changing observed fees', () => {
  const { ledger, at } = fixture();
  ledger.add('coin', { sol: 0.01, signature: 'tx1', at: 1_800_000, coverage: 0.5 });
  at(1_920_000);
  ledger.setCoverage(1_800_000, 1);
  const corrected = ledger.get('coin');
  close(corrected.observedSol, 0.01);
  close(corrected.sol, 0.01);
  close(corrected.estimatedSol, 0);
});

test('coverage correction applies to the minute containing its timestamp only', () => {
  const { ledger, at } = fixture();
  ledger.add('coin', { sol: 0.01, signature: 'tx1', at: 1_800_010, coverage: 0.5 });
  at(1_860_000);
  ledger.add('coin', { sol: 0.01, signature: 'tx2', at: 1_860_000, coverage: 0.25 });
  ledger.setCoverage(1_800_059, 1);
  close(ledger.get('coin').sol, 0.05);
  close(ledger.get('coin').observedSol, 0.02);
});

test('coverage correction updates every coin observed in the affected minute', () => {
  const { ledger } = fixture();
  ledger.add('a', { sol: 0.01, signature: 'tx1', at: 1_800_000, coverage: 0.5 });
  ledger.add('b', { sol: 0.02, signature: 'tx2', at: 1_800_010, coverage: 0.5 });
  ledger.setCoverage(1_800_000, 1);
  close(ledger.get('a').sol, 0.01);
  close(ledger.get('b').sol, 0.02);
});

test('a repeated transaction cannot add its fee twice for the same coin', () => {
  const { ledger, at } = fixture();
  ledger.add('coin', { sol: 0.01, signature: 'tx1', at: 1_800_000, coverage: 0.5 });
  at(1_920_000);
  ledger.add('coin', { sol: 0.01, signature: 'tx1', at: 1_800_000, coverage: 0.5 });
  close(ledger.get('coin').observedSol, 0.01);
  close(ledger.get('coin').sol, 0.02);
});

test('a shared transaction can allocate fees to separate coins without cross-coin deduplication', () => {
  const { ledger } = fixture();
  ledger.add('a', { sol: 0.005, signature: 'shared', at: 1_800_000, coverage: 1 });
  ledger.add('b', { sol: 0.005, signature: 'shared', at: 1_800_000, coverage: 1 });
  close(ledger.get('a').observedSol, 0.005);
  close(ledger.get('b').observedSol, 0.005);
  close(ledger.get('a').observedSol + ledger.get('b').observedSol, 0.01);
});

test('repair replaces coverage uplift with observed transactions without double counting', () => {
  const { ledger } = fixture();
  ledger.add('coin', { sol: 0.01, signature: 'tx1', at: 1_800_000, coverage: 0.5 });
  close(ledger.get('coin').sol, 0.02);
  ledger.add('coin', { sol: 0.01, signature: 'tx2', at: 1_800_005, coverage: 1 });
  ledger.setCoverage(1_800_000, 1);
  close(ledger.get('coin').observedSol, 0.02);
  close(ledger.get('coin').sol, 0.02);
  close(ledger.get('coin').estimatedSol, 0);
});

test('snapshot restore retains observations, interval coverage and deduplication', () => {
  const { ledger } = fixture();
  ledger.add('coin', { sol: 0.01, signature: 'tx1', at: 1_800_000, coverage: 0.5 });
  const restored = createFeeLedger({ now: () => 1_900_000 });
  restored.restore(ledger.snapshot());
  close(restored.get('coin').observedSol, 0.01);
  close(restored.get('coin').sol, 0.02);
  restored.add('coin', { sol: 0.01, signature: 'tx1', at: 1_800_000, coverage: 0.5 });
  close(restored.get('coin').observedSol, 0.01);
  restored.setCoverage(1_800_000, 1);
  close(restored.get('coin').sol, 0.01);
});

test('invalid coverage corrections cannot poison a valid estimate', () => {
  const { ledger } = fixture();
  ledger.add('coin', { sol: 0.01, signature: 'tx1', at: 1_800_000, coverage: 0.5 });
  for (const coverage of [NaN, Infinity, -Infinity, -0.5, 0, 1.5, null, undefined]) {
    ledger.setCoverage(1_800_000, coverage);
    close(ledger.get('coin').sol, 0.02);
    assert.equal(ledger.get('coin').coverage, 0.5);
  }
});

test('invalid observed fees never change valid observed totals', () => {
  const { ledger } = fixture();
  ledger.add('coin', { sol: 0.01, signature: 'valid', at: 1_800_000, coverage: 1 });
  for (const [i, sol] of [NaN, Infinity, -Infinity, -1, null, undefined].entries()) {
    ledger.add('coin', { sol, signature: `invalid${i}`, at: 1_800_000, coverage: 1 });
  }
  close(ledger.get('coin').observedSol, 0.01);
  close(ledger.get('coin').sol, 0.01);
});

test('prune removes expired buckets while preserving recent observations', () => {
  const { ledger, at } = fixture({ keepMs: 120_000 });
  ledger.add('coin', { sol: 0.01, signature: 'old', at: 1_800_000, coverage: 0.5 });
  at(1_980_000);
  ledger.add('coin', { sol: 0.02, signature: 'new', at: 1_980_000, coverage: 1 });
  ledger.prune();
  close(ledger.get('coin').observedSol, 0.02);
  close(ledger.get('coin').sol, 0.02);
});

test('unknown coin has no invented fee total', () => {
  const { ledger } = fixture();
  assert.equal(ledger.get('missing'), null);
});

test('legacy estimates remain separate and are never relabeled as observed fees', () => {
  const { ledger } = fixture();
  ledger.restore([{ mint: 'coin', legacyEstimatedSol: 0.1, since: 1_000_000, at: 1_700_000, buckets: [] }]);
  const legacy = ledger.get('coin');
  close(legacy.sol, 0.1);
  close(legacy.observedSol, 0);
  close(legacy.legacyEstimatedSol, 0.1);
  assert.equal(legacy.coverage, null);
  assert.equal(legacy.estimated, true);
  ledger.add('coin', { sol: 0.01, signature: 'new', at: 1_800_000, coverage: 0.5 });
  const combined = ledger.get('coin');
  close(combined.sol, 0.12);
  close(combined.observedSol, 0.01);
  close(combined.legacyEstimatedSol, 0.1);
  assert.equal(combined.coverage, null, 'legacy estimated history has no provable coverage');
  ledger.setCoverage(1_800_000, 1);
  close(ledger.get('coin').sol, 0.11);
  close(ledger.get('coin').observedSol, 0.01);
});

test('snapshot round trip preserves the legacy estimate classification', () => {
  const { ledger } = fixture();
  ledger.restore([{ mint: 'coin', legacyEstimatedSol: 0.1, since: 1_000_000, at: 1_700_000, buckets: [] }]);
  const restored = createFeeLedger({ now: () => 1_900_000 });
  restored.restore(ledger.snapshot());
  close(restored.get('coin').sol, 0.1);
  close(restored.get('coin').observedSol, 0);
  close(restored.get('coin').legacyEstimatedSol, 0.1);
  assert.equal(restored.get('coin').coverage, null);
});

test('new observed fees do not extend the lifetime of a legacy estimated component', () => {
  const { ledger, at } = fixture({ keepMs: 120_000 });
  ledger.restore([{ mint: 'coin', legacyEstimatedSol: 0.1, since: 1_700_000, at: 1_800_000, buckets: [] }]);
  at(1_920_000);
  ledger.add('coin', { sol: 0.02, signature: 'recent', at: 1_920_000, coverage: 0.5 });
  at(1_980_000);
  ledger.prune();
  const result = ledger.get('coin');
  close(result.legacyEstimatedSol, 0);
  close(result.observedSol, 0.02);
  close(result.sol, 0.04);
  assert.equal(result.coverage, 0.5);
});

test('snapshot restore retains original legacy expiry despite a newer coin timestamp', () => {
  const { ledger, at } = fixture({ keepMs: 120_000 });
  // Migration rows predate legacyAt; their original row.at is the expiry origin.
  ledger.restore([{ mint: 'coin', legacyEstimatedSol: 0.1, since: 1_700_000, at: 1_800_000, buckets: [] }]);
  at(1_860_000);
  ledger.add('coin', { sol: 0.02, signature: 'recent', at: 1_860_000, coverage: 1 });
  const saved = ledger.snapshot();
  let restoredAt = 1_860_000;
  const restored = createFeeLedger({ now: () => restoredAt, keepMs: 120_000 });
  restored.restore(saved);
  close(restored.get('coin').legacyEstimatedSol, 0.1);
  restoredAt = 1_980_000;
  restored.prune();
  const result = restored.get('coin');
  close(result.legacyEstimatedSol, 0);
  close(result.observedSol, 0.02);
  close(result.sol, 0.02);
  assert.equal(result.coverage, 1);
});

test('signatures of old buckets are dropped on restore and prune; their fees and coverage stay', () => {
  const now = () => 20 * 3600e3;
  const ledger = createFeeLedger({ now });
  ledger.add('coin', { sol: 0.01, signature: 'old', at: now() - 3 * 3600e3, coverage: 0.5 });
  ledger.add('coin', { sol: 0.02, signature: 'new', at: now() - 60e3, coverage: 1 });
  const fresh = createFeeLedger({ now });
  fresh.restore(ledger.snapshot());
  assert.equal(fresh.get('coin').observedSol, 0.03, 'fees kept');
  assert.equal(fresh.get('coin').sol, 0.01 / 0.5 + 0.02, 'coverage kept');
  assert.equal(fresh.add('coin', { sol: 0.02, signature: 'new', at: now() - 60e3, coverage: 1 }), false, 'a recent repeat is still refused');
  assert.equal(fresh.snapshotOne('coin').buckets.find((b) => b.sol === 0.01).signatures.length, 0, 'old signatures gone');
  ledger.prune();
  assert.equal(ledger.snapshotOne('coin').buckets.find((b) => b.sol === 0.01).signatures.length, 0, 'prune drops them in a running ledger too');
  assert.equal(ledger.snapshotOne('coin').buckets.find((b) => b.sol === 0.02).signatures.length, 1);
});
