import test from 'node:test';
import assert from 'node:assert/strict';
import { Limiter, overLimitExact } from '../worker/limiter.js';
import { boundedRequest, guardRequest, secureResponse } from '../worker/security.js';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
registerHooks({ load(url, context, next) {
  return url.endsWith('.html') ? { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}` } : next(url, context);
} });
const { session, memberOf } = await import('../worker/site/waitlist.js');
import { createHmac } from 'node:crypto';

function storage() {
  const data = new Map();
  const store = { get: async k => structuredClone(data.get(k)), put: async (k, v) => data.set(k, structuredClone(v)) };
  store.transaction = async fn => fn(store);
  return store;
}

test('authentication limiter survives object eviction', async () => {
  const state = { storage: storage() };
  const request = () => new Request('https://limiter/?max=2&ms=60000');
  assert.equal((await new Limiter(state).fetch(request())).status, 200);
  assert.equal((await new Limiter(state).fetch(request())).status, 200);
  assert.equal((await new Limiter(state).fetch(request())).status, 429);
});

test('authentication limiter fails closed without its binding or on outages', async () => {
  assert.equal(await overLimitExact({}, 'test'), true);
  assert.equal(await overLimitExact({ LIMITER: { idFromName() { throw Error('offline'); } } }, 'test'), true);
  assert.equal(await overLimitExact({ LIMITER: { idFromName: k => k, get: () => ({ fetch: async () => new Response('', { status: 503 }) }) } }, 'test'), true);
});

test('oversized chunked bodies are rejected without trusting content-length', async () => {
  const req = new Request('https://blixvip.com/demo', { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(9000)); c.close(); } }), duplex: 'half' });
  await assert.rejects(boundedRequest(req, 8192), e => e.status === 413);
  const valid = await boundedRequest(new Request('https://blixvip.com/demo', { method: 'POST', body: 'password=test' }), 8192);
  assert.equal(await valid.text(), 'password=test');
});

test('cross-site writes fail before any limiter or storage operation', async () => {
  const { response } = await guardRequest(new Request('https://blixvip.com/__admin/status', { method: 'POST', headers: { origin: 'https://evil.example' }, body: 'status=member' }), {});
  assert.equal(response.status, 403);
});

test('admin throttle executes before reading the password body', async () => {
  let key;
  const env = { LIMITER: { idFromName(k) { key = k; return k; }, get: () => ({ fetch: async () => new Response('', { status: 429 }) }) } };
  const req = new Request('https://blixvip.com/__admin/login', { method: 'POST', body: 'password=secret', headers: { 'cf-connecting-ip': '192.0.2.1' } });
  assert.equal((await guardRequest(req, env)).response.status, 429);
  assert.equal(req.bodyUsed, false);
  assert.match(key, /192\.0\.2\.1$/);
});

test('API burst shield rejects excess traffic; reads retain the origin limiter during binding outages', async () => {
  assert.equal((await guardRequest(new Request('https://blixvip.com/api/pulse'), { API_LIMIT: { limit: async () => ({ success: false }) } })).response.status, 429);
  assert.ok((await guardRequest(new Request('https://blixvip.com/api/pulse'), {})).request);
  assert.ok((await guardRequest(new Request('https://blixvip.com/'), {})).request);
});

test('security headers cover errors without exposing origin diagnostics', () => {
  const response = secureResponse(new Response('error', { status: 500, headers: { 'x-blix-edge-error': 'secret', 'content-security-policy': "default-src 'none'" } }));
  assert.equal(response.headers.get('x-blix-edge-error'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'");
});

function signedRequest(exp, key, method = 'GET', email = 'security-fixture@example.test') {
  const encoded = Buffer.from(email).toString('base64url');
  const sig = createHmac('sha256', `wait:${key}`).update(`${encoded}.${exp}`).digest('base64url');
  return new Request('https://blixvip.com/api/account/withdraw', { method, headers: { cookie: `blix_wait=${encoded}.${exp}.${sig}` } });
}
test('sessions reject missing signing secrets, malformed expiry and expired cookies', async () => {
  const key = 'fixture-session-key';
  for (const expiry of ['NaN', 'Infinity', Date.now() - 1, Date.now() + 40 * 86400_000]) assert.equal(await session(signedRequest(expiry, key), { SESSION_KEY: key }), null);
  assert.equal(await session(signedRequest(Date.now() + 10000, ''), {}), null);
  assert.equal(await session(signedRequest(Date.now() + 10000, key), { REG_KEY: key }), null);
});
test('writes cannot use cached membership when the account database is unavailable', async () => {
  const key = 'fixture-session-key';
  const env = { SESSION_KEY: key, DB: { prepare() { return { bind() { return { first: async () => ({ status: 'member' }) }; } }; } } };
  assert.ok(await memberOf(signedRequest(Date.now() + 10000, key), env));
  env.DB.prepare = () => { throw Error('offline'); };
  assert.equal(await memberOf(signedRequest(Date.now() + 10000, key, 'POST'), env), null);
});
