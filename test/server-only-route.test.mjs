import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

registerHooks({ load(url, context, next) {
  return url.endsWith('.html') ? { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}` } : next(url, context);
} });
const { default: worker } = await import(process.env.BLIX_WORKER_TEST ? pathToFileURL(process.env.BLIX_WORKER_TEST).href : '../worker/index.js');
const ctx = { waitUntil(p) { p.catch(() => {}); } };
const env = {
  API_LIMIT: { limit: async () => ({ success: true }) },
  LIMITER: { idFromName: k => k, get: () => ({ fetch: async () => new Response('ok') }) },
  SESSION_KEY: 'fixture-session-secret', MEMBER_KEY: 'fixture-member-secret-at-least-32-characters',
  REG_KEY: 'fixture-registration-secret',
  REG: { get: async () => 'https://dead-pc.trycloudflare.com', put: async () => { throw Error('Routing must not mutate KV'); } },
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ status: 'member' }) }) }) },
};
const email = Buffer.from('server-only@example.test').toString('base64url');
function cookie() {
  const exp = Date.now() + 60_000;
  return `blix_wait=${email}.${exp}.${createHmac('sha256', `wait:${env.SESSION_KEY}`).update(`${email}.${exp}`).digest('base64url')}`;
}

test('all former PC routes use the server directly, including writes and SSE', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    return Response.json({ ok: true });
  });
  for (const route of ['/api/fomo/feed', '/api/fomo/list?kind=trending', '/api/feed/stream', '/api/pump/feed', '/api/x', '/api/coin/11111111111111111111111111111111/fomo', '/api/pulse']) {
    const r = await worker.fetch(new Request(`https://blixvip.com${route}`, { headers: { cookie: cookie() } }), env, ctx);
    assert.equal(r.status, 200, route);
    assert.equal(calls.at(-1).url, `https://origin.blixvip.com${route}`);
  }
  const r = await worker.fetch(new Request('https://blixvip.com/api/x/accounts', { method: 'POST', headers: { cookie: cookie(), origin: 'https://blixvip.com', 'content-type': 'application/json' }, body: '{}' }), env, ctx);
  assert.equal(r.status, 200);
  assert.deepEqual(calls.at(-1), { url: 'https://origin.blixvip.com/api/x/accounts', method: 'POST' });
  assert.equal(calls.length, 8, 'no attempt to contact the PC before falling back');
});

test('PC registration and an accidental main quick tunnel cannot replace the server', async () => {
  const register = body => worker.fetch(new Request('https://blixvip.com/__register', { method: 'POST', headers: { 'x-reg-key': env.REG_KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, ctx);
  const pc = await register({ role: 'pc', origin: 'https://dead-pc.trycloudflare.com' });
  assert.equal(pc.status, 200);
  assert.equal((await pc.json()).ignored, 'server-only');
  assert.equal((await register({ role: 'main', origin: 'https://dead-pc.trycloudflare.com' })).status, 400);
  assert.equal((await register({ role: 'main', origin: 'https://origin.blixvip.com' })).status, 200);
});

test('registration KV outage cannot take customer feeds offline', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(String(url), 'https://origin.blixvip.com/api/pump/feed');
    return Response.json({ ok: true });
  });
  const r = await worker.fetch(new Request('https://blixvip.com/api/pump/feed', { headers: { cookie: cookie() } }), { ...env, REG: { get: async () => { throw Error('KV offline'); } } }, ctx);
  assert.equal(r.status, 200);
});

test('server disconnects return retryable JSON to API clients, never an HTML page blaming the PC', async t => {
  for (const status of [0, 502, 503, 530]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => {
      if (!status) throw Error('network unavailable');
      return new Response('<html>upstream unavailable</html>', { status });
    });
    const r = await worker.fetch(new Request('https://blixvip.com/api/fomo/feed', { headers: { cookie: cookie() } }), env, ctx);
    assert.equal(r.status, 503);
    const j = await r.json();
    assert.match(j.error, /server.*unavailable/);
    assert.doesNotMatch(j.error, /PC|computer/);
    mock.mock.restore();
  }
});
