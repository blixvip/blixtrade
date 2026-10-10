import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// Execute the real Worker router; HTML imports are text and only Google/Cloudflare edges are mocked.
registerHooks({ load(url, context, next) {
  return url.endsWith('.html') ? { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}` } : next(url, context);
} });
const { default: worker } = await import('../worker/index.js');

test('the actual account route adds the current member profile and never shares it with another member', async t => {
  const people = {
    'profile-alice@example.test': { status: 'member', name: 'Alice', picture: 'https://lh3.googleusercontent.com/a/alice' },
    'profile-bob@example.test': { status: 'member', name: 'Bob', picture: null },
  };
  const env = {
    API_LIMIT: { limit: async () => ({ success: true }) },
    SESSION_KEY: 'fixture-session-secret', MEMBER_KEY: 'fixture-member-secret-at-least-32-characters',
    REG: { get: async key => key === 'origin' ? 'https://origin.blixvip.com' : null },
    DB: { prepare: () => ({ bind: email => ({ first: async () => people[email] || null }) }) },
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://origin.blixvip.com/api/account/me');
    const email = options.headers.get('x-blix-member');
    return Response.json(email ? { signedIn: true, hosted: true, email, needsWallet: true } : { signedIn: false });
  });
  for (const email of Object.keys(people)) {
    const encoded = Buffer.from(email).toString('base64url'), exp = Date.now() + 60_000;
    const signature = createHmac('sha256', `wait:${env.SESSION_KEY}`).update(`${encoded}.${exp}`).digest('base64url');
    const req = new Request('https://blixvip.com/api/account/me', { headers: { cookie: `blix_wait=${encoded}.${exp}.${signature}` } });
    const response = await worker.fetch(req, env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { signedIn: true, hosted: true, email, needsWallet: true, name: people[email].name, picture: people[email].picture });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
  const anonymous = await worker.fetch(new Request('https://blixvip.com/api/account/me'), env, { waitUntil() {} });
  assert.deepEqual(await anonymous.json(), { signedIn: false });
});
