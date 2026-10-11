import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, next) {
  return url.endsWith('.html') ? { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}` } : next(url, context);
} });
const { waitlist, session, memberOf, memberProfile } = await import('../worker/site/waitlist.js');
import { verifyWalletIdentity } from '../server/wallet-identity.js';

// Real Worker handler and real SQLite schema; all identities, credentials and Google replies are synthetic.
const NOW = 1_900_000_000_000;
const email = 'alice@example.test';
const sub = 'google-stable-alice-123';
const memberKey = 'fixture-only-member-signing-key-0123456789';
const cookies = response => response.headers.getSetCookie();
const cookie = (response, name) => cookies(response).find(value => value.startsWith(`${name}=`));
const rawCookie = (response, name) => cookie(response, name)?.split(';')[0].slice(name.length + 1);
const baseClaims = () => ({ sub, email, email_verified: true, aud: 'fixture-google-client', iss: 'https://accounts.google.com', exp: NOW / 1000 + 3600, auth_time: NOW / 1000 });

function fixture(t, { existing, claims = {}, googleStatus = 200, googleError, dbDown = false } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_waitlist.sql', '0002_google.sql', '0003_live_admin.sql', '0004_handles.sql']) db.exec(readFileSync(new URL(`../worker/migrations/${file}`, import.meta.url), 'utf8'));
  t.after(() => db.close());
  if (existing) db.prepare('INSERT INTO accounts (email, google_sub, created, last_seen, status) VALUES (?,?,?,?,?)')
    .run(existing.email || email, existing.sub || sub, NOW - 1000, NOW - 1000, existing.status || 'member');
  const deferred = [], exchanges = [];
  const env = {
    SESSION_KEY: 'fixture-only-session-key-01234567890123456789', MEMBER_KEY: memberKey,
    GOOGLE_CLIENT_ID: 'fixture-google-client', GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
    REG: { get: async () => null },
    DB: { prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { if (dbDown) throw Error('fixture D1 unavailable'); return db.prepare(sql).get(...args) || null; },
        async run() { return db.prepare(sql).run(...args); },
      };
    } },
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token', 'No real network permitted');
    exchanges.push({ url, options });
    const payload = Buffer.from(JSON.stringify({ ...baseClaims(), ...claims })).toString('base64url');
    return Response.json(googleError ? { error: googleError } : { id_token: `test-header.${payload}.test-signature` }, { status: googleStatus });
  });
  const handle = async (path, suppliedCookies = '') => {
    const url = new URL(path, 'https://blix.example.test');
    const req = new Request(url, { headers: suppliedCookies ? { cookie: suppliedCookies } : {} });
    const response = await waitlist(req, env, url, { limited: false, defer: promise => deferred.push(promise) });
    await Promise.all(deferred.splice(0));
    return response;
  };
  const begin = async (wallet = true) => {
    const response = await handle(`/auth/google?from=login${wallet ? '&wallet=1' : ''}`);
    const target = new URL(response.headers.get('location'));
    return { response, target, state: target.searchParams.get('state'), stateCookie: cookie(response, 'blix_oauth').split(';')[0] };
  };
  const complete = async (flow, suffix = '') => handle(`/auth/google/callback?code=fixture-code&state=${encodeURIComponent(flow.state)}${suffix}`, flow.stateCookie);
  return { env, db, begin, complete, handle, exchanges };
}

test('Google wallet sign-in requests fresh authentication and returns to the account screen', async t => {
  const f = fixture(t);
  const flow = await f.begin();
  assert.equal(flow.target.origin, 'https://accounts.google.com');
  assert.equal(flow.target.searchParams.get('max_age'), '0');
  assert.equal(flow.target.searchParams.get('scope'), 'openid email profile');
  const response = await f.complete(flow);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/app#/account');
  assert.equal(f.exchanges.length, 1);
  assert.equal(f.exchanges[0].options.body.get('code'), 'fixture-code');
  const raw = rawCookie(response, 'blix_wallet');
  assert.deepEqual(verifyWalletIdentity(raw, email, memberKey, NOW), { sub, email, authed: NOW });
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(cookie(response, 'blix_wallet').includes(attribute));
  const sessionReq = new Request('https://blix.example.test', { headers: { cookie: cookie(response, 'blix_wait').split(';')[0] } });
  assert.equal(await session(sessionReq, f.env), email);
});

test('returning Google members keep their stable wallet subject and normalized email', async t => {
  const f = fixture(t, { existing: {}, claims: { email: 'Alice@Example.Test' } });
  const response = await f.complete(await f.begin());
  assert.deepEqual(verifyWalletIdentity(rawCookie(response, 'blix_wallet'), email, memberKey, NOW), { sub, email, authed: NOW });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 1);
});

test('Google signup makes the saved photo and name available to that member only', async t => {
  const profile = { name: 'Alice Trader', picture: 'https://lh3.googleusercontent.com/a/fixture' };
  const f = fixture(t, { claims: profile });
  const response = await f.complete(await f.begin(false));
  const req = new Request('https://blix.example.test', { headers: { cookie: cookie(response, 'blix_wait').split(';')[0] } });
  assert.equal(await memberOf(req, f.env), email);
  assert.deepEqual(memberProfile(email), profile);
  assert.equal(memberProfile('unknown@example.test'), null);
  assert.deepEqual(memberProfile(await memberOf(req, f.env)), profile, 'cached member keeps their profile');
});

test('ordinary Google sign-in mints a verifiable wallet identity and returns to the app', async t => {
  const f = fixture(t);
  const flow = await f.begin(false);
  assert.equal(flow.target.searchParams.has('max_age'), false);
  const response = await f.complete(flow);
  assert.equal(response.headers.get('location'), '/app');
  assert.equal(verifyWalletIdentity(rawCookie(response, 'blix_wallet'), email, memberKey, NOW)?.sub, sub);
});

test('cancelled OAuth cannot mint wallet or member cookies and never exchanges a code', async t => {
  const f = fixture(t);
  const response = await f.complete(await f.begin(), '&error=access_denied');
  assert.equal(rawCookie(response, 'blix_wallet'), undefined);
  assert.equal(rawCookie(response, 'blix_wait'), undefined);
  assert.equal(f.exchanges.length, 0);
});

test('a callback with a forged state cannot mint cookies or reach Google', async t => {
  const f = fixture(t);
  const flow = await f.begin();
  const response = await f.complete({ ...flow, state: flow.state + '-tampered' });
  assert.equal(rawCookie(response, 'blix_wallet'), undefined);
  assert.equal(rawCookie(response, 'blix_wait'), undefined);
  assert.equal(f.exchanges.length, 0);
});

for (const [name, options] of [
  ['unverified email', { claims: { email_verified: false } }],
  ['wrong audience', { claims: { aud: 'another-client' } }],
  ['wrong issuer', { claims: { iss: 'https://attacker.example.test' } }],
  ['expired token', { claims: { exp: NOW / 1000 - 1 } }],
  ['missing subject', { claims: { sub: '' } }],
  ['rejected code', { googleStatus: 400, googleError: 'invalid_grant' }],
]) {
  test(`Google ${name} does not mint a wallet or member identity`, async t => {
    const f = fixture(t, options);
    const response = await f.complete(await f.begin());
    assert.equal(rawCookie(response, 'blix_wallet'), undefined);
    assert.equal(rawCookie(response, 'blix_wait'), undefined);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n, 0);
  });
}

test('paused accounts receive no new wallet identity', async t => {
  const f = fixture(t, { existing: { status: 'blocked' } });
  const response = await f.complete(await f.begin());
  assert.equal(response.headers.get('location'), '/waiting');
  assert.equal(rawCookie(response, 'blix_wallet'), undefined);
  const req = new Request('https://blix.example.test', { headers: { cookie: cookie(response, 'blix_wait').split(';')[0] } });
  assert.equal(await memberOf(req, f.env), null, 'A signed website session alone must not make a paused user a member');
});

test('a Google email change never mints a wallet cookie for a different website identity', async t => {
  const f = fixture(t, { existing: { email: 'previous@example.test' } });
  const response = await f.complete(await f.begin());
  assert.equal(rawCookie(response, 'blix_wallet'), undefined);
});

test('logout clears both member and wallet cookies with their original scopes', async t => {
  const f = fixture(t);
  const login = await f.complete(await f.begin());
  const response = await f.handle('/logout', cookies(login).map(value => value.split(';')[0]).join('; '));
  assert.equal(response.headers.get('location'), '/');
  for (const name of ['blix_wait', 'blix_wallet', 'blix_m']) {
    assert.equal(rawCookie(response, name), '');
    assert.ok(cookie(response, name).includes('Max-Age=0'));
    assert.ok(cookie(response, name).includes('Path=/'));
  }
  assert.ok(cookie(response, 'blix_wallet').includes('SameSite=Strict'));
  assert.ok(cookie(response, 'blix_m').includes('Domain=.blixvip.com'));
});

test('switching Google accounts replaces wallet identity and rejects use with the previous member', async t => {
  const claims = {};
  const f = fixture(t, { claims });
  const first = await f.complete(await f.begin());
  claims.sub = 'google-stable-bob-456';
  claims.email = 'bob@example.test';
  const flow = await f.begin();
  flow.stateCookie += `; ${cookie(first, 'blix_wallet').split(';')[0]}; ${cookie(first, 'blix_wait').split(';')[0]}`;
  const second = await f.complete(flow, '&sub=google-stable-alice-123&email=alice%40example.test');
  const raw = rawCookie(second, 'blix_wallet');
  assert.deepEqual(verifyWalletIdentity(raw, claims.email, memberKey, NOW), { sub: claims.sub, email: claims.email, authed: NOW });
  assert.equal(verifyWalletIdentity(raw, email, memberKey, NOW), null);
  const req = new Request('https://blix.example.test', { headers: { cookie: cookie(second, 'blix_wait').split(';')[0] } });
  assert.equal(await memberOf(req, f.env), claims.email);
});

for (const exp of [undefined, 'invalid-expiry', NOW / 1000]) {
  test(`Google invalid expiry ${String(exp)} cannot mint fresh wallet access`, async t => {
    const f = fixture(t, { claims: { exp } });
    const response = await f.complete(await f.begin());
    assert.equal(rawCookie(response, 'blix_wallet'), undefined);
    assert.equal(rawCookie(response, 'blix_wait'), undefined);
  });
}
