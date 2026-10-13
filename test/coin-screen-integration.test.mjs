import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blix-coin-screen-'));
process.env.RADAR_DATA = dir;
process.env.BLIX_NO_FASTLANE = '1';
const repeat = globalThis.setInterval, originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
const ticks = [], sockets = [], reads = [];
globalThis.setInterval = fn => { ticks.push(fn); return { unref() {} }; };
globalThis.WebSocket = class {
  readyState = 1;
  constructor(url) { this.url = url; this.sent = []; sockets.push(this); queueMicrotask(() => this.onopen?.()); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; }
};
globalThis.fetch = async (url, init) => {
  reads.push({ url, body: init?.body });
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: [] } }), { headers: { 'content-type': 'application/json' } });
};
const { settings } = await import('../server/settings.js');
Object.assign(settings, { chartWsUrl: 'wss://mainnet.helius-rpc.com/?api-key=screen-test', rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=screen-test', chartDailyMB: 1400 });
const { db } = await import('../server/db.js');
const gate = await import('../server/coin-screen.js');
const charts = await import('../server/chartstream.js');
const fast = await import('../server/fastpx.js');
const snipers = await import('../server/snipe.js');
const dev = await import('../server/devbal.js');
const holders = await import('../server/holderslive.js');
const pools = await import('../server/poolwatch.js');
const tape = await import('../server/cointape.js');
const mint = '5'.repeat(40) + 'pump';
const approved = { born: Date.now() - 60_000, mcap: 15_000, fees: .002 };

after(() => {
  globalThis.setInterval = repeat; globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket;
  db.close();
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(dir).startsWith('blix-coin-screen-'));
  fs.rmSync(dir, { recursive: true, force: true });
});
test('rejected coin reaches no RPC or websocket through chart, holder, sniper, dev or pool queues', async () => {
  gate.configureCoinScreen({ lookup: () => ({ ...approved, fees: 0 }) });
  const beforeReads = reads.length, beforeSockets = sockets.length;
  assert.equal(fast.watchFast(mint), false);
  snipers.snipeFor(mint); assert.equal(snipers.snipeDebug(mint).wanted, false);
  dev.devShare(mint, '7'.repeat(44), 1e9); dev.quickHolders(mint);
  assert.equal(holders.holdersLive(mint, { hint: 20 }), null);
  pools.watchPool(mint, '6'.repeat(44)); tape.watchPoolLogs(mint, '6'.repeat(44));
  for (const tick of ticks) await tick();
  await new Promise(setImmediate);
  assert.equal(reads.length, beforeReads);
  assert.equal(sockets.length, beforeSockets);
});
test('visible row stays on shared feed; opening starts a real subscription; expired demand unsubscribes', async () => {
  let clock = Date.now();
  gate.configureCoinScreen({ lookup: () => approved, now: () => clock });
  assert.equal(fast.watchFast(mint, false), false);
  const before = sockets.length;
  charts.startChartStream();
  charts.focusChart(mint);
  await new Promise(setImmediate);
  assert.ok(sockets.length > before);
  const socket = sockets.at(-1), sub = socket.sent.find(x => x.method === 'logsSubscribe');
  assert.deepEqual(sub.params[0].mentions, [mint]);
  socket.onmessage({ data: JSON.stringify({ id: sub.id, result: 123 }) });
  clock += 20_000;
  for (const tick of ticks) await tick();
  assert.ok(socket.sent.some(x => x.method === 'logsUnsubscribe' && x.params[0] === 123));
});
test('verified holdings survive screening failure and one wallet selling does not remove another holder', () => {
  let saved;
  gate.configureHeldWallets([], rows => { saved = rows; });
  gate.noteHeldWallet('one', [{ mint, amount: '100' }]);
  gate.noteHeldWallet('two', [{ mint, amount: '50' }]);
  gate.configureCoinScreen({ lookup: () => null, held: gate.isWalletHeld });
  assert.equal(gate.canStream(mint), true);
  gate.noteHeldWallet('one', []); assert.equal(gate.canStream(mint), true);
  gate.configureHeldWallets(saved); assert.equal(gate.canStream(mint), true);
  gate.noteHeldWallet('two', []); assert.equal(gate.canStream(mint), false);
});
test('production evidence resolver imports and admits existing paper positions without paid discovery', async () => {
  await import('../server/paper.js');
  const { startCoinScreen } = await import('../server/coin-screen-runtime.js');
  startCoinScreen();
  db.prepare("INSERT INTO paper(mint,status) VALUES(?, 'open')").run(mint);
  assert.equal(gate.canStream(mint), true);
  db.prepare("UPDATE paper SET status = 'closed' WHERE mint = ?").run(mint);
  assert.equal(gate.canEnrich(mint), false);
});
