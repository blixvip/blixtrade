import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), 'blix-jupiter-budget-'));
const originalData = process.env.RADAR_DATA;
process.env.RADAR_DATA = temporaryData;
const { createJupiterClient } = await import('../server/jupiter.js');
after(() => {
  if (originalData === undefined) delete process.env.RADAR_DATA;
  else process.env.RADAR_DATA = originalData;
  const target = path.resolve(temporaryData);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith('blix-jupiter-budget-'));
  fs.rmSync(target, { recursive: true, force: true });
});

const START = Date.UTC(2026, 9, 10, 12);
function fixture({ key = '', respond = () => Response.json({ value: 1 }) } = {}) {
  let time = START;
  const calls = [];
  const get = createJupiterClient({
    clock: () => time,
    sleep: async ms => { time += ms; },
    key: () => key,
    request: async (url, init) => {
      calls.push({ url, init, time });
      return respond(url, init);
    },
  });
  return { get, calls, advance(ms) { time += ms; } };
}

for (const [label, key, interval] of [['keyless', '', 2100], ['keyed', 'fixture-jupiter-key', 1100]]) {
  test(`${label} priority quotes and background reads share one paced allowance`, async () => {
    const { get, calls } = fixture({ key });
    await get('/price/v3?ids=A');
    await get('/swap/v1/quote?amount=1', { priority: true });
    await get('/price/v3?ids=B');
    await get('/swap/v1/quote?amount=2', { priority: true });
    for (let i = 1; i < calls.length; i++) {
      assert.ok(calls[i].time - calls[i - 1].time >= interval,
        `Cross-lane calls ${i - 1}/${i} must be separated by at least ${interval}ms`);
    }
  });

  test(`${label} repeated priority requests cannot use a faster independent quota`, async () => {
    const { get, calls } = fixture({ key });
    await get('/swap/v1/quote?amount=1', { priority: true });
    await get('/swap/v1/quote?amount=2', { priority: true });
    assert.ok(calls[1].time - calls[0].time >= interval);
  });
}

test('identical pending paths coalesce across priority and background consumers', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { get, calls } = fixture({ respond: () => pending });
  const background = get('/price/v3?ids=A');
  const foreground = get('/price/v3?ids=A', { priority: true });
  assert.equal(calls.length, 1);
  release(Response.json({ value: 42 }));
  assert.deepEqual(await Promise.all([background, foreground]), [{ value: 42 }, { value: 42 }]);
  assert.equal(calls.length, 1);
});

for (const firstPriority of [false, true]) {
  test(`429 from ${firstPriority ? 'priority' : 'background'} blocks the other lane without upstream requests`, async () => {
    const { get, calls } = fixture({ respond: () => new Response('limited', { status: 429, headers: { 'Retry-After': '30' } }) });
    await assert.rejects(get('/price/v3?ids=A', { priority: firstPriority }), error => error.status === 429);
    await assert.rejects(get('/swap/v1/quote?amount=1', { priority: !firstPriority }), error => error.status === 429);
    assert.equal(calls.length, 1, 'A provider cooldown belongs to the key/IP, not the caller lane');
  });
}

test('HTTP-date Retry-After prevents requests until the specified time', async () => {
  let limited = true;
  const { get, calls, advance } = fixture({ respond: () => limited
    ? new Response('limited', { status: 429, headers: { 'Retry-After': new Date(START + 30_000).toUTCString() } })
    : Response.json({ recovered: true }) });
  await assert.rejects(get('/price/v3?ids=A'), error => error.status === 429);
  limited = false;
  advance(10_000);
  await assert.rejects(get('/price/v3?ids=B'), error => error.status === 429);
  assert.equal(calls.length, 1);
  advance(20_000);
  assert.deepEqual(await get('/price/v3?ids=B'), { recovered: true });
  assert.equal(calls.length, 2);
});

test('long provider cooldowns are honored rather than capped at sixty seconds', async () => {
  let limited = true;
  const { get, calls, advance } = fixture({ respond: () => limited
    ? new Response('limited', { status: 429, headers: { 'Retry-After': '120' } })
    : Response.json({ recovered: true }) });
  await assert.rejects(get('/price/v3?ids=A'), error => error.status === 429);
  limited = false;
  advance(61_000);
  await assert.rejects(get('/price/v3?ids=B'), error => error.status === 429);
  assert.equal(calls.length, 1);
  advance(59_000);
  assert.deepEqual(await get('/price/v3?ids=B'), { recovered: true });
});
