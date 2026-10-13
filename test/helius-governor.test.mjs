import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), 'blix-helius-governor-'));
const originalData = process.env.RADAR_DATA;
const originalFetch = globalThis.fetch;
process.env.RADAR_DATA = temporaryData;
globalThis.fetch = async () => { throw new Error('Unstubbed network request in governor test'); };
const { settings } = await import('../server/settings.js');
const { db } = await import('../server/db.js');
let serial = 0;
// Admission tests run late in a fixed day; midnight pacing has dedicated coverage.
beforeEach(t => t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-11T23:00:00Z') }));

after(() => {
  globalThis.fetch = originalFetch;
  if (originalData === undefined) delete process.env.RADAR_DATA;
  else process.env.RADAR_DATA = originalData;
  db.close();
  const target = path.resolve(temporaryData);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith('blix-helius-governor-'));
  fs.rmSync(target, { recursive: true, force: true });
});

async function fixture({ duplicate = false, sameProject = false } = {}) {
  const id = ++serial;
  const first = `wss://mainnet.helius-rpc.com/?api-key=fixture-secret-${id}-primary`;
  const second = duplicate ? first : `wss://mainnet.helius-rpc.com/?api-key=fixture-secret-${id}-secondary`;
  Object.assign(settings, {
    chartWsUrl: first, chartWsUrl2: second, rpcUrl: first.replace(/^wss:/, 'https:'),
    heliusProjectId: `fixture-project-${id}-a`,
    heliusProjectId2: `fixture-project-${id}-${sameProject ? 'a' : 'b'}`,
    chartDailyMB: 1400, heliusMonthCredits: 1_000_000,
  });
  const governor = await import(`../server/heliuskeys.js?governor-test=${id}`);
  return { governor, first, second, http: first.replace(/^wss:/, 'https:') };
}

const request = (method = 'getBalance', params = ['mint']) => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
});
const response = result => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
  headers: { 'Content-Type': 'application/json' },
});
const historyRequest = () => request('getTransactionsForAddress', ['mint', { transactionDetails: 'full', limit: 1000 }]);

test('non-Helius requests pass through unchanged without charging configured keys', async () => {
  const { governor, first } = await fixture();
  const expected = response({ value: 1 });
  const init = request();
  let received;
  globalThis.fetch = async (...args) => { received = args; return expected; };
  const actual = await governor.heliusFetch('https://api.mainnet-beta.solana.com', init);
  assert.equal(actual, expected);
  assert.deepEqual(received, ['https://api.mainnet-beta.solana.com', init]);
  assert.equal(governor.keyStatus(first).creditsToday, 0);
});

test('duplicate configured keys cannot double the available allowance', async () => {
  const { governor, first } = await fixture({ duplicate: true });
  assert.equal(new Set(governor.keyUrls()).size, 1);
  governor.noteBytes(first, governor.budgetCredits() * 50_000);
  assert.equal(governor.activeUrl(), '');
  assert.equal(governor.keyStatus(first).creditsToday, governor.budgetCredits());
  assert.equal(governor.bytesToday(), governor.budgetCredits() * 50_000);
});

test('different keys from one project share usage and cannot fail over past project exhaustion', async () => {
  const { governor, first, second } = await fixture({ sameProject: true });
  governor.noteBytes(first, governor.budgetCredits() * 50_000);
  assert.equal(governor.keyStatus(second).creditsToday, governor.keyStatus(first).creditsToday);
  assert.equal(governor.activeUrl(), '');
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ value: 1 }); };
  await assert.rejects(() => governor.heliusFetch(second.replace(/^wss:/, 'https:'), request()));
  assert.equal(calls, 0);
});

test('exhausted Helius requests are rejected before network access without leaking credentials', async () => {
  const { governor, first, http } = await fixture();
  governor.noteBytes(first, governor.budgetCredits() * 50_000);
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ value: 1 }); };
  await assert.rejects(() => governor.heliusFetch(http, request()), error => {
    assert.doesNotMatch(String(error), /fixture-secret|api-key=/);
    return true;
  });
  assert.equal(calls, 0);
});

test('history requests settle to returned-row credits and retain a readable response body', async () => {
  const { governor, first, http } = await fixture();
  const payload = { data: [{ signature: 'transaction-one' }] };
  globalThis.fetch = async () => response(payload);
  const result = await governor.heliusFetch(http, historyRequest());
  assert.deepEqual((await result.json()).result, payload);
  assert.equal(governor.keyStatus(first).creditsToday, 10);
  assert.equal(governor.keyStatus(first).callsToday, 1);
});

test('HTTP and websocket aliases debit the same project account', async () => {
  const { governor, first, second, http } = await fixture({ sameProject: true });
  governor.noteBytes(first, 50_000);
  globalThis.fetch = async () => response({ value: 42 });
  await governor.heliusFetch(http, request());
  assert.equal(governor.keyStatus(first).creditsToday, 2);
  assert.equal(governor.keyStatus(second).creditsToday, 2);
});

test('network failures retain reserved history cost and redact provider URLs from errors', async () => {
  const { governor, first, http } = await fixture();
  globalThis.fetch = async () => { throw new Error(`Request failed: ${http}`); };
  await assert.rejects(() => governor.heliusFetch(http, historyRequest()), error => {
    assert.doesNotMatch(String(error), /fixture-secret|api-key=/);
    return true;
  });
  assert.equal(governor.keyStatus(first).creditsToday, 100);
});

test('explicit failed history RPC results settle at zero and remain available to callers', async () => {
  const { governor, first, http } = await fixture();
  const failure = { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } };
  globalThis.fetch = async () => new Response(JSON.stringify(failure));
  const result = await governor.heliusFetch(http, historyRequest());
  assert.deepEqual(await result.json(), failure);
  assert.equal(governor.keyStatus(first).creditsToday, 0);
});

test('repeated unchanged monthly reports do not recreate daily allowance after spending', async () => {
  const { governor, first } = await fixture();
  const resetAt = Date.now() + 10 * 86_400_000;
  const report = { remaining: 2300, limit: 10000 };
  governor.markMonth(first, 77, resetAt, report);
  const allowance = governor.keyStatus(first).dayBudget;
  governor.noteBytes(first, 100 * 50_000);
  governor.markMonth(first, 77, resetAt, report);
  assert.ok(governor.keyStatus(first).dayBudget <= allowance,
    'A repeated dashboard report cannot refund locally observed spending');
});

test('restart restores history consumption so history cannot regain the protected price allowance', async () => {
  const { governor, first, http } = await fixture();
  settings.chartDailyMB = 2;
  globalThis.fetch = async () => response({ slot: 1 });
  const historyLimit = Math.floor(governor.keyStatus(first).allowedNow * 0.05);
  assert.ok(historyLimit >= 1 && historyLimit <= 2);
  for (let i = 0; i < historyLimit; i++) await governor.heliusFetch(http, request('getTransaction'));
  await assert.rejects(() => governor.heliusFetch(http, request('getTransaction')));
  governor.saveUsage();
  const restored = await import(`../server/heliuskeys.js?governor-restart=${serial}`);
  restored.loadUsage();
  assert.equal(restored.keyStatus(first).creditsToday, historyLimit);
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; return response({ slot: 1 }); };
  await assert.rejects(() => restored.heliusFetch(http, request('getTransaction')));
  assert.equal(networkCalls, 0);
});

test('adding a verified project identity cannot erase usage already charged to the same key', async () => {
  const { governor, first } = await fixture();
  settings.heliusProjectId = '';
  settings.heliusProjectId2 = '';
  governor.noteBytes(first, 100 * 50_000);
  assert.equal(governor.keyStatus(first).creditsToday, 100);
  settings.heliusProjectId = 'newly-verified-fixture-project';
  assert.equal(governor.keyStatus(first).creditsToday, 100);
});

test('429 HTTP-date Retry-After is respected by all keys of the shared project', async () => {
  const { governor, first, second, http } = await fixture({ sameProject: true });
  const retryAt = Date.now() + 60_000;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    return new Response('Too many requests', { status: 429, headers: { 'Retry-After': new Date(retryAt).toUTCString() } });
  };
  const result = await governor.heliusFetch(http, request());
  assert.equal(result.status, 429);
  assert.ok(governor.keyStatus(first).coolingUntil >= retryAt - 1000,
    'An HTTP-date cooldown must not be replaced with the five-second fallback');
  await assert.rejects(() => governor.heliusFetch(second.replace(/^wss:/, 'https:'), request()));
  assert.equal(networkCalls, 1);
});

test('restart preserves charged usage when previously unknown keys gain a verified shared project', async () => {
  const { governor, first, second } = await fixture();
  settings.heliusProjectId = '';
  settings.heliusProjectId2 = '';
  governor.noteBytes(first, 100 * 50_000);
  governor.noteBytes(second, 50 * 50_000);
  assert.equal(governor.keyStatus(first).creditsToday, 150);
  assert.equal(governor.keyStatus(second).creditsToday, 150);
  assert.equal(governor.saveUsage(), true);

  // Settings can be saved before a process restarts without another governor call.
  // The replacement module has no in-memory key-to-project identities to consult.
  settings.heliusProjectId = `verified-after-restart-${serial}`;
  settings.heliusProjectId2 = settings.heliusProjectId;
  const restored = await import(`../server/heliuskeys.js?governor-identity-restart=${serial}`);
  restored.loadUsage();
  assert.equal(restored.keyStatus(first).creditsToday, 150);
  assert.equal(restored.keyStatus(second).creditsToday, 150);
  assert.equal(restored.bytesToday(), 150 * 50_000);
});

test('analytics websocket yields at eighty percent while the price key stays available', async () => {
  const { governor, first } = await fixture();
  assert.equal(governor.rpcStreamAllowed(first), true);
  governor.noteBytes(first, governor.keyStatus(first).allowedNow * .8 * 50_000);
  assert.equal(governor.rpcStreamAllowed(first), false);
  assert.equal(governor.activeUrl(), first);
});
