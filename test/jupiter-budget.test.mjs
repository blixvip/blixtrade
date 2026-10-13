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
function fixture({ key = '', limit = key ? 54 : 27, respond = () => Response.json({ value: 1 }) } = {}) {
  let time = START;
  const calls = [];
  const get = createJupiterClient({
    clock: () => time,
    sleep: async ms => { time += ms; },
    key: () => key,
    requestsPerMinute: () => limit,
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

test('background reads leave capacity for a priority quote', async () => {
  const { get, calls } = fixture({ key: 'fixture-key', limit: 10 });
  for (let i = 0; i < 4; i++) await get(`/tokens/v2/search?query=${i}`);
  await assert.rejects(get('/tokens/v2/recent'), e => e.deferred === true);
  await get('/swap/v1/quote?amount=1', { priority: true });
  assert.equal(calls.length, 5);
});

test('successful response with exhausted allowance stops subsequent upstream requests', async () => {
  const { get, calls } = fixture({ respond: () => Response.json({ value: 1 }, { headers: {
    'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((START + 45_000) / 1000),
  } }) });
  await get('/price/v3?ids=A');
  await assert.rejects(get('/price/v3?ids=B', { priority: true }), e => e.cooling === true);
  assert.equal(calls.length, 1);
});

test('429 respects Jupiter reset header without Retry-After', async () => {
  const { get, calls, advance } = fixture({ respond: () => new Response('', { status: 429, headers: {
    'x-ratelimit-reset': String((START + 45_000) / 1000),
  } }) });
  await assert.rejects(get('/price/v3?ids=A'));
  advance(10_000);
  await assert.rejects(get('/price/v3?ids=B'));
  assert.equal(calls.length, 1);
});

test('a waiting quote overtakes queued background requests', async () => {
  let time = START;
  const calls = [], sleepers = [];
  const get = createJupiterClient({ clock: () => time, key: () => 'fixture', requestsPerMinute: () => 40,
    sleep: ms => new Promise(resolve => { sleepers.push({ at: time + ms, resolve }); }),
    request: async url => { calls.push(url); return Response.json({ ok: true }); },
  });
  await get('/price/v3?ids=A');
  const background = get('/tokens/v2/recent');
  const quote = get('/swap/v1/quote?amount=1', { priority: true });
  for (let i = 0; i < 100 && calls.length < 3; i++) {
    sleepers.sort((a, b) => a.at - b.at);
    if (sleepers.length) { const next = sleepers.shift(); time = Math.max(time, next.at); next.resolve(); }
    await new Promise(resolve => setImmediate(resolve));
  }
  await Promise.all([background, quote]);
  assert.ok(calls[1].includes('/swap/v1/quote'), 'Quotes must not wait behind background discovery');
});

test('every Tokens v2 caller uses the shared authenticated client', () => {
  for (const name of ['jupdisc.js', 'sources.js']) {
    const source = fs.readFileSync(new URL(`../server/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\([\s\S]{0,80}(?:lite-api|api)\.jup\.ag/);
    assert.match(source, /jupiterGet\(/);
  }
});

test('a sustained quote load stays within the configured rolling minute budget', async () => {
  const { get, calls } = fixture({ key: 'fixture-key', limit: 10 });
  for (let i = 0; i < 30; i++) await get(`/swap/v1/quote?amount=${i}`, { priority: true });
  for (const call of calls) assert.ok(calls.filter(x => x.time > call.time - 60_000 && x.time <= call.time).length <= 10);
});

test('a headerless 429 stops all callers for a full window', async () => {
  const { get, calls, advance } = fixture({ respond: () => new Response('', { status: 429 }) });
  await assert.rejects(get('/price/v3?ids=A'));
  advance(59_000);
  await assert.rejects(get('/tokens/v2/recent'));
  assert.equal(calls.length, 1);
});

test('provider throttling reduces the request rate below the configured ceiling', async () => {
  let limited = true;
  const { get, calls, advance } = fixture({ key: 'fixture-key', limit: 40, respond: () => limited
    ? new Response('', { status: 429, headers: { 'Retry-After': '1' } }) : Response.json({ ok: true }) });
  await assert.rejects(get('/swap/v1/quote?amount=1', { priority: true }));
  limited = false; advance(5000);
  await get('/swap/v1/quote?amount=2', { priority: true });
  await get('/swap/v1/quote?amount=3', { priority: true });
  assert.ok(calls[2].time - calls[1].time >= 3000, 'A 429 halves throughput even when the configured budget has room');
});

test('remaining provider capacity is reserved for quotes, not background refreshes', async () => {
  const { get, calls } = fixture({ respond: () => Response.json({ value: 1 }, { headers: {
    'x-ratelimit-remaining': '1', 'x-ratelimit-reset': String((START + 45_000) / 1000),
  } }) });
  await get('/price/v3?ids=A');
  await assert.rejects(get('/tokens/v2/recent'), e => e.deferred === true);
  await get('/swap/v1/quote?amount=1', { priority: true });
  assert.equal(calls.length, 2);
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
