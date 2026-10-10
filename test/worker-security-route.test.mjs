import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
registerHooks({ load(url, context, next) {
  return url.endsWith('.html') ? { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}` } : next(url, context);
} });
const { default: worker } = await import('../worker/index.js');
const limits = { API_LIMIT: { limit: async () => ({ success: true }) }, LIMITER: { idFromName: k => k, get: () => ({ fetch: async () => new Response('ok') }) } };
const ctx = { waitUntil(p) { p.catch(() => {}); } };
test('real router rejects origin registration with missing secret', async () => {
  const r = await worker.fetch(new Request('https://blixvip.com/__register', { method: 'POST', body: '{"origin":"https://origin.blixvip.com"}' }), limits, ctx);
  assert.equal(r.status, 403);
});
test('real router never exposes a thrown upstream secret in body or headers', async () => {
  const r = await worker.fetch(new Request('https://blixvip.com/api/pulse'), { ...limits, REG: { get() { throw Error('secret-api-token'); } } }, ctx);
  assert.equal(r.status, 500);
  assert.doesNotMatch(await r.text(), /secret-api-token/);
  assert.equal(r.headers.get('x-blix-edge-error'), null);
});
test('unknown HTML paths and disabled analytics never write a page-view row', async () => {
  let writes = 0;
  const r = await worker.fetch(new Request('https://blixvip.com/random-bot-path', { headers: { accept: 'text/html' } }), { ...limits, DB: { prepare() { writes++; throw Error('unexpected'); } } }, ctx);
  assert.equal(r.status, 404);
  assert.equal(writes, 0);
});
