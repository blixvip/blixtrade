import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startRpcStream } from '../server/rpc-stream.js';

const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), 'blix-helius-stream-pacing-'));
const originalData = process.env.RADAR_DATA, originalFastlane = process.env.BLIX_NO_FASTLANE;
const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
process.env.RADAR_DATA = temporaryData;
process.env.BLIX_NO_FASTLANE = '1';
globalThis.fetch = async () => { throw new Error('Network is forbidden in stream pacing tests'); };
const { settings } = await import('../server/settings.js');
const { db } = await import('../server/db.js');
const governor = await import('../server/heliuskeys.js');
const NOW = Date.parse('2026-10-11T12:00:00Z');
let serial = 0;

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalSocket;
  if (originalData === undefined) delete process.env.RADAR_DATA;
  else process.env.RADAR_DATA = originalData;
  if (originalFastlane === undefined) delete process.env.BLIX_NO_FASTLANE;
  else process.env.BLIX_NO_FASTLANE = originalFastlane;
  db.close();
  const target = path.resolve(temporaryData);
  assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
  assert.ok(path.basename(target).startsWith('blix-helius-stream-pacing-'));
  fs.rmSync(target, { recursive: true, force: true });
});

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: NOW });
  const sockets = [];
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(value) { this.sent.push(JSON.parse(value)); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(value) { this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) }); }
    close() { this.readyState = 3; }
  }
  globalThis.WebSocket = Socket;
  const id = ++serial, url = `wss://mainnet.helius-rpc.com/?api-key=stream-fixture-${id}`;
  Object.assign(settings, {
    chartWsUrl: url, chartWsUrl2: '', rpcWsUrl: '', rpcUrl: url.replace(/^wss:/, 'https:'),
    heliusProjectId: `stream-fixture-project-${id}`, heliusProjectId2: '',
    chartDailyMB: 1440, heliusMonthCredits: 1_000_000,
  });
  t.after(() => { for (const socket of sockets) socket.close(); });
  return { sockets, Socket, url, id };
}

test('a second message within one millisecond closes a stream immediately when its budget is consumed', t => {
  const { sockets, Socket, url } = fixture(t);
  let consumed = 0, events = 0;
  const stop = startRpcStream({
    url: () => url, request: { method: 'logsSubscribe', params: [] }, WebSocketImpl: Socket,
    admit: () => consumed < 2, meter: () => consumed++, onEvent: () => events++,
  });
  t.after(stop);
  sockets[0].open();
  sockets[0].message({ id: 1, result: 42 });
  sockets[0].message({ method: 'logsNotification', params: { result: { value: {} } } });
  assert.equal(sockets[0].readyState, 3, 'A cached admission result must not permit another second of billed traffic');
  assert.equal(events, 0);
});

test('RPC stream meters UTF-8 bytes rather than JavaScript character count', t => {
  const { sockets, Socket, url } = fixture(t);
  let bytes = 0;
  const stop = startRpcStream({
    url: () => url, request: { method: 'logsSubscribe', params: [] }, WebSocketImpl: Socket,
    meter: (_url, amount) => { bytes += amount; },
  });
  t.after(stop);
  const payload = JSON.stringify({ id: 1, result: 42, message: 'coin 🚀 東京' });
  sockets[0].message(payload);
  assert.equal(bytes, Buffer.byteLength(payload, 'utf8'));
});

test('a budget-paused RPC stream reconnects automatically after credits accrue', t => {
  const { sockets, Socket, url } = fixture(t);
  let allowed = false;
  const stop = startRpcStream({
    url: () => url, request: { method: 'logsSubscribe', params: [] }, WebSocketImpl: Socket,
    admit: () => allowed,
  });
  t.after(stop);
  assert.equal(sockets.length, 0);
  t.mock.timers.tick(15_000);
  assert.equal(sockets.length, 0);
  allowed = true;
  t.mock.timers.tick(15_000);
  assert.equal(sockets.length, 1);
  sockets[0].open();
  assert.equal(sockets[0].sent[0].method, 'logsSubscribe');
});

test('fast create never opens a configured Helius key whose allowance is exhausted', async t => {
  const { sockets, url } = fixture(t);
  governor.noteBytes(url, (governor.keyStatus(url).dayBudget + 1) * 50_000);
  const creates = await import('../server/fastcreate.js');
  t.after(creates.stopFastCreate);
  creates.startFastCreate();
  t.mock.timers.tick(30_000);
  assert.equal(sockets.length, 0, 'Launch discovery must not bypass admission by falling back to keyUrls()[0]');
});

test('holder analytics on the chart side socket are charged to metrics, preserving the price reserve', async t => {
  const { sockets, url, id } = fixture(t);
  const charts = await import(`../server/chartstream.js?stream-accounting=${id}`);
  const stop = charts.streamSub('holders-test', 'programSubscribe', ['token-program'], () => {});
  t.after(() => stop?.());
  assert.equal(sockets.length, 1);
  sockets[0].open();
  const payload = JSON.stringify({ id: sockets[0].sent[0].id, result: 42 });
  sockets[0].message(payload);
  const usage = governor.keyStatus(url).byPriority;
  assert.equal(usage.metrics, Buffer.byteLength(payload) / 50_000);
  assert.equal(usage.price, 0, 'Holder scans cannot disguise their cost as watched-chart prices');
});

test('an existing chart price subscription resumes after its paced budget replenishes', async t => {
  const { sockets, url, id } = fixture(t);
  const charts = await import(`../server/chartstream.js?stream-resume=${id}`);
  charts.startChartStream();
  const stop = charts.fastSub('viewed-price', 'accountSubscribe', ['pool'], () => {});
  t.after(() => stop?.());
  assert.equal(sockets.length, 1);
  sockets[0].open();
  governor.noteBytes(url, (governor.keyStatus(url).allowedNow + 1) * 50_000);
  sockets[0].message({ id: sockets[0].sent[0].id, result: 42 });
  assert.equal(sockets[0].readyState, 3);
  t.mock.timers.tick(60_000);
  assert.ok(governor.activeUrl(), 'Budget has replenished');
  assert.equal(sockets.length, 2, 'Existing subscriptions must resume without closing and reopening the chart');
  sockets[1].open();
  assert.equal(sockets[1].sent[0].method, 'accountSubscribe');
});

test('a price socket stops its spent key immediately when a second project is available', async t => {
  const { sockets, url, id } = fixture(t);
  settings.chartWsUrl2 = `wss://mainnet.helius-rpc.com/?api-key=spare-stream-${id}`;
  settings.heliusProjectId2 = `spare-stream-project-${id}`;
  const charts = await import(`../server/chartstream.js?stream-switch=${id}`);
  const stop = charts.fastSub('viewed-price', 'accountSubscribe', ['pool'], () => {});
  t.after(() => stop?.());
  sockets[0].open();
  governor.noteBytes(url, (governor.keyStatus(url).allowedNow + 1) * 50_000);
  sockets[0].message({ id: sockets[0].sent[0].id, result: 42 });
  assert.equal(sockets[0].readyState, 3, 'A spare key cannot excuse overspending the first key');
  assert.equal(sockets.length, 2);
  assert.equal(sockets[1].url, settings.chartWsUrl2);
});
