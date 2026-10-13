import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), 'blix-helius-day-pacing-'));
const originalData = process.env.RADAR_DATA;
const originalFetch = globalThis.fetch;
process.env.RADAR_DATA = temporaryData;
globalThis.fetch = async () => { throw new Error('Network is forbidden in daily pacing tests'); };
const { settings } = await import('../server/settings.js');
const { db } = await import('../server/db.js');
const primitives = await import('../server/metric-budget.js');
const DAY = 86_400_000, MINUTE = 60_000;
const MIDNIGHT = Date.parse('2026-10-11T00:00:00Z');
let serial = 0;

after(() => {
  globalThis.fetch = originalFetch;
  if (originalData === undefined) delete process.env.RADAR_DATA;
  else process.env.RADAR_DATA = originalData;
  db.close();
  const target = path.resolve(temporaryData);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith('blix-helius-day-pacing-'));
  fs.rmSync(target, { recursive: true, force: true });
});

async function fixture(t, at = MIDNIGHT) {
  t.mock.timers.enable({ apis: ['Date'], now: at });
  const id = ++serial;
  const url = `wss://mainnet.helius-rpc.com/?api-key=pacing-fixture-${id}`;
  Object.assign(settings, {
    chartWsUrl: url, chartWsUrl2: '', rpcWsUrl: '', rpcUrl: url.replace(/^wss:/, 'https:'),
    heliusProjectId: `pacing-fixture-project-${id}`, heliusProjectId2: '',
    chartDailyMB: 1440, heliusMonthCredits: 1_000_000,
  });
  const governor = await import(`../server/heliuskeys.js?day-pacing=${id}`);
  return { governor, url, id };
}

test('daily pacing grants at most five minutes upfront and keeps ten percent in reserve', () => {
  assert.equal(typeof primitives.pacedAllowance, 'function');
  const daily = 28_800;
  let previous = 0;
  for (let minute = 0; minute < 1440; minute++) {
    const allowed = primitives.pacedAllowance({ daily, now: MIDNIGHT + minute * MINUTE });
    assert.ok(Number.isFinite(allowed) && allowed >= previous, 'Allowance grows through the day');
    assert.ok(allowed <= daily * .9 * Math.min(1, (minute + 5) / 1440) + 1e-8,
      `Minute ${minute} must not borrow more than five minutes from later charts`);
    previous = allowed;
  }
  assert.ok(previous > daily * .85, 'The available daily budget remains useful');
  assert.ok(previous <= daily * .9, 'The final ten percent protects against delayed metering');
  assert.ok(primitives.pacedAllowance({ daily, now: MIDNIGHT + 1439 * MINUTE }) >
    primitives.pacedAllowance({ daily, now: MIDNIGHT + 1438 * MINUTE }),
    'Startup headroom must not stop fresh grants during the final five minutes');
});

test('noon cannot unlock the full daily budget or select a project ahead of schedule', async t => {
  const { governor, url } = await fixture(t, MIDNIGHT + DAY / 2);
  const status = governor.keyStatus(url);
  assert.ok(status.allowedNow <= status.dayBudget * .9 * (12 * 60 + 5) / 1440,
    'The old twelve-hour advance exhausted an entire day by noon');
  governor.noteBytes(url, (status.dayBudget * .6) * 50_000);
  assert.equal(governor.activeUrl(), '', 'Ahead-of-schedule projects must yield even below their daily cap');
  assert.equal(governor.keyFree(url), false);
});

test('relentless viewing leaves spendable credits for the final minutes of the day', async t => {
  const { governor, url } = await fixture(t);
  for (let minute = 0; minute <= 1433; minute++) {
    t.mock.timers.setTime(MIDNIGHT + minute * MINUTE);
    const status = governor.keyStatus(url);
    const available = Math.max(0, status.allowedNow - status.creditsToday);
    if (available) governor.noteBytes(url, available * 50_000);
  }
  const before = governor.keyStatus(url);
  assert.ok(before.creditsToday < before.dayBudget * .9,
    'Sustained demand must leave new grants available after 23:53 UTC');
  t.mock.timers.setTime(MIDNIGHT + 1438 * MINUTE);
  const later = governor.keyStatus(url);
  assert.ok(later.allowedNow > later.creditsToday, 'A viewer near reset still receives a fresh allowance');
  assert.equal(governor.activeUrl(), url);
  assert.ok(later.allowedNow <= later.dayBudget * .9);
});

test('temporary pacing pauses advertise a resume time and automatically release the key', async t => {
  const { governor, url } = await fixture(t, MIDNIGHT + 8 * 60 * MINUTE);
  const initial = governor.keyStatus(url);
  governor.noteBytes(url, (initial.allowedNow + 1) * 50_000);
  const paused = governor.keyStatus(url);
  assert.equal(governor.activeUrl(), '');
  assert.ok(paused.nextResumeAt > Date.now() && paused.nextResumeAt < Date.now() + 5 * MINUTE,
    'A temporary pace limit must resume at the next earned grant, not midnight');
  assert.equal(paused.resetAt, MIDNIGHT + DAY);
  assert.ok(paused.sustainablePerHour > 0 && paused.sustainablePerHour <= paused.dayBudget * .9 / 24);
  t.mock.timers.setTime(paused.nextResumeAt + 1000);
  assert.equal(governor.activeUrl(), url);
});

test('midnight grants a fresh paced day while retaining exhausted monthly protection', async t => {
  const { governor, url } = await fixture(t, MIDNIGHT + DAY - MINUTE);
  governor.noteBytes(url, 20_000 * 50_000);
  t.mock.timers.setTime(MIDNIGHT + DAY);
  const fresh = governor.keyStatus(url);
  assert.equal(fresh.creditsToday, 0);
  assert.ok(fresh.allowedNow > 0 && fresh.allowedNow <= fresh.dayBudget * .9 * 5 / 1440);
  assert.equal(governor.activeUrl(), url);
  governor.markMonth(url, 98, MIDNIGHT + 10 * DAY, { remaining: 20_000, limit: 1_000_000 });
  t.mock.timers.setTime(MIDNIGHT + 2 * DAY);
  assert.equal(governor.keyStatus(url).monthUsed, true);
  assert.equal(governor.activeUrl(), '', 'A new UTC day cannot reset provider monthly exhaustion');
});

test('restart preserves an ahead-of-schedule pause and its earned resume time', async t => {
  const { governor, url, id } = await fixture(t, MIDNIGHT + 3 * 60 * MINUTE);
  governor.noteBytes(url, 6000 * 50_000);
  assert.equal(governor.saveUsage(), true);
  const before = governor.keyStatus(url);
  const restored = await import(`../server/heliuskeys.js?day-pacing-restart=${id}`);
  restored.loadUsage();
  const after = restored.keyStatus(url);
  assert.equal(after.creditsToday, 6000);
  assert.equal(restored.activeUrl(), '', 'Restart must not recreate an upfront daily allowance');
  assert.equal(after.nextResumeAt, before.nextResumeAt);
  assert.ok(after.nextResumeAt > Date.now());
});

test('monthly remaining credits shrink the paced allowance without a fresh startup windfall', async t => {
  const { governor, url } = await fixture(t, MIDNIGHT + DAY / 2);
  governor.markMonth(url, 90, MIDNIGHT + 10 * DAY, { remaining: 100_000, limit: 1_000_000 });
  const status = governor.keyStatus(url);
  assert.ok(status.dayBudget < 28_800, 'Daily spending must preserve the remaining billing period');
  assert.ok(status.allowedNow <= status.dayBudget * .9 * (12 * 60 + 5) / 1440,
    'Monthly correction must retain pacing instead of releasing the whole revised daily cap');
});
