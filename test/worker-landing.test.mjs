import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
registerHooks({ load(url, context, next) {
  return url.endsWith('.html') ? { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}` } : next(url, context);
} });
const { default: worker } = await import('../worker/index.js');

test('landing serves through the real Worker, with validators and CSP that allows its own inline scripts by hash only', async () => {
  const pending = [], ctx = { waitUntil(p) { pending.push(p.catch(() => {})); } };
  const env = { REG: { get: async () => null } };
  const response = await worker.fetch(new Request('https://blixvip.com/'), env, ctx);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Trade/);
  assert.match(html, /application\/ld\+json/);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  // Every inline script the page carries (the hover tiles, the structured data) is allowed by its exact hash, as a
  // browser computes it: over the text with line endings normalised to \n. Hashing the raw text passed here while
  // real browsers blocked the tile script when landing.html had CRLF endings (2026-10-09).
  for (const [, raw] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const body = raw.replace(/\r\n?/g, '\n');
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))).toString('base64');
    assert.ok(csp.includes(`'sha256-${hash}'`), `inline script not allowed by CSP: ${body.slice(0, 60)}`);
  }
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  const etag = response.headers.get('etag');
  assert.ok(etag);
  const cached = await worker.fetch(new Request('https://blixvip.com/', { headers: { 'if-none-match': etag } }), env, ctx);
  assert.equal(cached.status, 304);
  const head = await worker.fetch(new Request('https://blixvip.com/', { method: 'HEAD' }), env, ctx);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  await Promise.all(pending);
});
