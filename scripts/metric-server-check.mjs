// Isolated full-server integration. Synthetic data, no provider connections, no existing processes touched.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '..');
const data = await mkdtemp(path.join(tmpdir(), 'blix-metric-server-'));
const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port; await new Promise(r => probe.close(r));
await writeFile(path.join(data, 'settings.json'), JSON.stringify({ marketFeeds: false, chartWsUrl: '', chartWsUrl2: '', rpcUrl: '', rpcWsUrl: '', tunnel: false, remoteKey: 'fixture-no-network', notifyKinds: [] }));
const preload = path.join(data, 'preload.mjs');
const metricModule = new URL('../server/metricstate.js', import.meta.url).href;
await writeFile(preload, `
globalThis.fetch = async () => new Response('{"error":"network disabled in fixture"}', { status: 503 });
globalThis.WebSocket = class { constructor() { throw new Error('network disabled in fixture'); } };
// Installed databases retain this legacy table; people.js still prepares a fallback query against it.
const { db } = await import(${JSON.stringify(new URL('../server/db.js', import.meta.url).href)});
db.exec('CREATE TABLE IF NOT EXISTS fomo_traders(handle TEXT, avatar TEXT)');
process.on('message', async message => {
 if (message.op === 'stop') process.exit(0);
 if (message.op === 'metric') { const {metricState} = await import(${JSON.stringify(metricModule)}); metricState.put(message.mint, message.fields, { source: 'fixture', rank: 3, observedAt: Date.now() }); process.send({op:'stored'}); }
});
`);
const child = fork(path.join(root, 'server/server.js'), [], { cwd: root, env: { ...process.env, RADAR_DATA: data, RADAR_PORT: String(port), BLIX_NO_FASTLANE: '1', BLIX_WEB_EXTERNAL: '1' }, execArgv: ['--no-warnings', '--import', pathToFileURL(preload).href], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let log = ''; child.stdout.on('data', x => { log += x; }); child.stderr.on('data', x => { log += x; });
const base = `http://127.0.0.1:${port}`, mint = 'A'.repeat(31) + 'B', other = 'A'.repeat(31) + 'C';
let stream;
try {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode != null) throw Error(`Isolated server exited: ${log.slice(-4000)}`);
    try { const r = await fetch(`${base}/api/metrics?m=${mint}&session=fixture`); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  stream = new AbortController();
  const response = await fetch(`${base}/api/stream?session=fixture`, { signal: stream.signal, headers: { 'accept-encoding': 'identity' } });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  await reader.read();
  const stored = once(child, 'message'); child.send({ op: 'metric', mint, fields: { mc: 12345, fees: 0.125 } }); await stored;
  child.send({ op: 'metric', mint: other, fields: { mc: 999 } });
  const packet = await Promise.race([reader.read(), new Promise((_, reject) => { const t = setTimeout(() => reject(Error('No metric stream event')), 5000); t.unref(); })]);
  const text = decoder.decode(packet.value);
  assert.match(text, /event: metrics/); assert.ok(text.includes(mint)); assert.ok(!text.includes(other));
  const snapshot = await (await fetch(`${base}/api/metrics?session=fixture&m=${mint}`)).json();
  assert.equal(snapshot.coins[0].fields.mc.value, 12345);
  assert.equal(snapshot.coins[0].fields.fees.value, .125);
  assert.ok(snapshot.boot > 0);
  assert.equal((await (await fetch(`${base}/api/metrics?m=invalid`)).json()).coins.length, 0);
  console.log('PASS isolated server: startup, scoped SSE, snapshots, invalid mint filtering');
} finally {
  stream?.abort();
  if (child.exitCode == null) { const ended = once(child, 'exit'); if (child.connected) child.send({ op: 'stop' }); await ended; }
  assert.equal(path.dirname(path.resolve(data)), path.resolve(tmpdir()));
  assert.ok(path.basename(data).startsWith('blix-metric-server-'));
  await rm(data, { recursive: true, force: true });
}
