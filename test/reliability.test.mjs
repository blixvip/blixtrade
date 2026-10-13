import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createByteCache } from '../server/byte-cache.js';
import { proxyRequest, guardRequest } from '../server/http-proxy.js';

test('asset cache bounds both memory and entry count, retaining recently used files', () => {
  const c = createByteCache({ maxBytes: 10, maxEntries: 2, sizeOf: v => v.length });
  c.set('a', Buffer.alloc(4)); c.set('b', Buffer.alloc(4)); c.get('a');
  c.set('c', Buffer.alloc(4));
  assert.equal(c.has('b'), false); assert.equal(c.has('a'), true);
  c.set('huge', Buffer.alloc(11));
  assert.equal(c.has('huge'), false); assert.ok(c.bytes <= 10);
  c.set('a', Buffer.alloc(8)); assert.ok(c.bytes <= 10);
  c.delete('a'); assert.equal(c.bytes, 0);
});

test('sync and async route failures return safe errors and leave other pages serving', async t => {
  const server = http.createServer(guardRequest((req, res) => {
    if (req.url === '/sync') throw Error('provider-secret-token');
    if (req.url === '/async') return Promise.reject(Error('provider-secret-token'));
    res.end('healthy');
  }));
  const port = await listen(server);
  t.after(() => { server.closeAllConnections(); server.close(); });
  for (const route of ['/sync', '/async']) {
    const r = await fetch(`http://127.0.0.1:${port}${route}`);
    assert.equal(r.status, 500); assert.doesNotMatch(await r.text(), /provider-secret/);
  }
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'healthy');
});

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function setup(t, handler, options = {}) {
  const upstream = http.createServer(handler), port = await listen(upstream);
  const proxy = http.createServer((req, res) => proxyRequest(req, res, { port, headers: req.headers, firstByteMs: 100, timeoutMs: 300, ...options }));
  const proxyPort = await listen(proxy);
  t.after(async () => {
    upstream.closeAllConnections(); proxy.closeAllConnections();
    await Promise.all([upstream, proxy].map(s => new Promise(resolve => s.close(resolve))));
  });
  return `http://127.0.0.1:${proxyPort}`;
}

test('a backend that never sends headers returns a bounded, credential-free timeout', async t => {
  const base = await setup(t, () => {});
  const r = await fetch(base, { signal: AbortSignal.timeout(3000) });
  assert.equal(r.status, 504);
  assert.match(await r.text(), /timed out/i);
});

test('stream heartbeats survive ordinary request deadlines and close with their client', async t => {
  let closed = false;
  const base = await setup(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: hello\ndata: {}\n\n');
    const timer = setInterval(() => res.write('event: tick\ndata: {}\n\n'), 20);
    res.on('close', () => { closed = true; clearInterval(timer); });
  }, { stream: true });
  const abort = new AbortController();
  const r = await fetch(base, { signal: abort.signal });
  const reader = r.body.getReader();
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(closed, false);
  assert.ok((await reader.read()).value.length > 0);
  abort.abort();
  for (let i = 0; i < 50 && !closed; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(closed, true);
});

test('a truncated upstream response closes cleanly instead of appending an error to chart data', async t => {
  const base = await setup(t, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"rows":[');
    setTimeout(() => res.destroy(), 30);
  });
  const r = await fetch(base, { signal: AbortSignal.timeout(3000) });
  await assert.rejects(() => r.text());
});
