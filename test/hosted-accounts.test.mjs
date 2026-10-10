import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { createHostedAccounts } from '../server/hosted-accounts.js';

const NOW = 1_900_000_000_000;
const alice = { sub: 'google-alice', email: 'alice@example.test', authed: NOW };
const bob = { sub: 'google-bob', email: 'bob@example.test', authed: NOW };
const ADDRESS = id => String(id).repeat(32);
const MINT = 'So11111111111111111111111111111111111111112';

function fixture(t, override) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const calls = [], users = new Map();
  const vault = async (path, body) => {
    calls.push({ path, body });
    if (override) return override(path, body);
    if (path === '/users') {
      const user = { id: users.size + 1, address: ADDRESS(users.size + 1), ref: body.ref };
      users.set(user.id, user);
      // Yield so simultaneous setup requests overlap in the account handler.
      await new Promise(resolve => setImmediate(resolve));
      return user;
    }
    const [, id, operation] = /^\/users\/(\d+)\/(.+)$/.exec(path) || [];
    assert.ok(users.has(Number(id)), 'Only a created wallet can be selected');
    if (operation === 'wallet') return { address: users.get(Number(id)).address, sol: 2 };
    if (operation === 'txs') return [{ id: `tx-for-${id}` }];
    if (operation === 'swap') return { status: 'confirmed', signature: `swap-for-${id}`, side: body.side };
    if (operation === 'withdraw') return { status: 'confirmed', signature: `withdraw-for-${id}` };
    if (operation === 'export') return { secret: `test-only-key-for-${id}` };
    if (operation === 'claim') return { status: 'confirmed', signature: `claim-for-${id}`, body };
    throw Error(`Unexpected fake vault path ${path}`);
  };
  const launch = async (vaultId, body) => { calls.push({ path: `launch:${vaultId}`, body }); return { status: 'confirmed', mint: `mint-for-${vaultId}` }; };
  const rewards = async vaultId => { calls.push({ path: `rewards:${vaultId}` }); return { unclaimed: { total: vaultId } }; };
  const handle = createHostedAccounts({ db, vault, launch, rewards, now: () => NOW });
  async function request(path, { method = 'GET', identity = alice, body, member = identity?.email } = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, headers: { 'content-type': 'application/json' }, walletIdentity: identity, walletMember: member });
    const output = { status: 200, headers: {}, raw: '' };
    const res = {
      writeHead(status, headers) { output.status = status; output.headers = headers || {}; return this; },
      end(text = '') { output.raw += String(text); },
      setHeader(name, value) { output.headers[name.toLowerCase()] = value; },
    };
    await handle(req, res, new URL(path, 'https://blix.example.test'));
    if (output.raw) output.body = JSON.parse(output.raw);
    return output;
  }
  const setup = identity => request('/api/account/setup', { method: 'POST', identity, body: {} });
  return { request, setup, calls, users, db };
}

test('anonymous account status advertises hosted Google sign-in without touching wallets', async t => {
  const { request, calls } = fixture(t);
  const out = await request('/api/account/me', { identity: null });
  assert.equal(out.status, 200);
  assert.equal(out.body.signedIn, false);
  assert.equal(out.body.google, true);
  assert.equal(out.body.hosted, true);
  assert.equal(calls.length, 0);
  const redirect = await request('/api/account/google', { identity: null });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.location, '/auth/google?wallet=1');
});

test('authenticated wallet setup creates a wallet without an acceptance step', async t => {
  const { request, setup, calls, db } = fixture(t);
  const initial = await request('/api/account/me');
  assert.equal(initial.body.signedIn, true);
  assert.equal(initial.body.needsWallet, true);
  assert.equal(calls.length, 0);
  const created = await setup(alice);
  assert.ok(created.status >= 200 && created.status < 300);
  assert.equal(db.prepare('SELECT consented FROM hosted_accounts WHERE sub = ?').get(alice.sub).consented, 0, 'automatic creation must not record user acceptance');
  assert.deepEqual(calls.find(c => c.path === '/users').body, { email: alice.email, ref: `blix:google:${alice.sub}` });
  const me = await request('/api/account/me');
  assert.equal(me.body.signedIn, true);
  assert.equal(me.body.address, ADDRESS(1));
  assert.equal(me.body.wallet.sol, 2);
});

test('concurrent and repeated setup creates exactly one wallet for a Google subject', async t => {
  const { setup, calls, request } = fixture(t);
  const results = await Promise.all([setup(alice), setup(alice), setup(alice)]);
  for (const out of results) assert.ok(out.status >= 200 && out.status < 300);
  assert.equal(calls.filter(c => c.path === '/users').length, 1);
  await setup(alice);
  assert.equal(calls.filter(c => c.path === '/users').length, 1);
  assert.equal((await request('/api/account/me')).body.address, ADDRESS(1));
});

test('trade and history requests cannot select another account wallet', async t => {
  const { setup, request, calls } = fixture(t);
  await setup(alice);
  await setup(bob);
  calls.length = 0;
  for (const side of ['buy', 'sell']) {
    const out = await request(`/api/account/${side}?id=2`, { method: 'POST', body: {
      mint: MINT, sol: 0.01, pct: 25, slippageBps: 100,
      id: 2, vault_id: 2, userId: 2, address: ADDRESS(2), sub: bob.sub, email: bob.email,
    } });
    assert.equal(out.status, 200);
    assert.equal(out.body.signature, 'swap-for-1');
    assert.equal(out.body.side, side);
  }
  const history = await request('/api/account/txs?id=2&vault_id=2');
  assert.equal(history.status, 200);
  assert.deepEqual(history.body, [{ id: 'tx-for-1' }]);
  assert.ok(calls.every(c => c.path.startsWith('/users/1/')));
  for (const call of calls.filter(c => c.path.endsWith('/swap'))) {
    for (const key of ['id', 'vault_id', 'userId', 'address', 'sub', 'email']) assert.equal(call.body[key], undefined);
  }
});

test('withdrawal and key export require authentication within ten minutes', async t => {
  const { setup, request, calls } = fixture(t);
  await setup(alice);
  calls.length = 0;
  for (const action of ['withdraw', 'export']) {
    const out = await request(`/api/account/${action}`, { method: 'POST', identity: { ...alice, authed: NOW - 600_001 }, body: { to: MINT, sol: 0.01 } });
    assert.equal(out.status, 401);
    assert.equal(out.body.confirm, true);
  }
  assert.equal(calls.length, 0);
  for (const action of ['withdraw', 'export']) {
    const out = await request(`/api/account/${action}`, { method: 'POST', body: { to: MINT, sol: 0.01, vault_id: 999 } });
    assert.equal(out.status, 200);
  }
  assert.ok(calls.every(c => c.path.startsWith('/users/1/')));
});

test('unauthenticated writes never reach the vault, even with forged wallet selection', async t => {
  const { request, calls } = fixture(t);
  for (const action of ['setup', 'buy', 'sell', 'withdraw', 'export']) {
    const out = await request(`/api/account/${action}`, { method: 'POST', identity: null, body: { acceptCustody: true, vault_id: 1 } });
    assert.equal(out.status, 401);
  }
  assert.equal(calls.length, 0);
});

test('missing or invalid authentication times cannot authorize withdrawal or key export', async t => {
  const { setup, request, calls } = fixture(t);
  await setup(alice);
  calls.length = 0;
  for (const authed of [undefined, NaN, Infinity, NOW + 60_000]) {
    for (const action of ['withdraw', 'export']) {
      const out = await request(`/api/account/${action}`, { method: 'POST', identity: { ...alice, authed }, body: { to: MINT, sol: 0.01 } });
      assert.equal(out.status, 401);
      assert.equal(out.body.confirm, true);
    }
  }
  assert.equal(calls.length, 0);
});

test('a website member cannot use a wallet identity belonging to a different member', async t => {
  const { request, calls } = fixture(t);
  const out = await request('/api/account/setup', { method: 'POST', identity: alice, member: bob.email, body: { acceptCustody: true } });
  assert.ok(out.status === 401 || out.status === 403);
  assert.equal(calls.length, 0);
});

test('unknown and administrator account paths never expose vault access', async t => {
  const { request, calls } = fixture(t);
  for (const path of ['/api/account/users', '/api/account/admin', '/api/account/users/2/export', '/api/account/unknown']) {
    const out = await request(path);
    assert.equal(out.status, 404);
  }
  assert.equal(calls.length, 0);
});

test('vault failures return 503 without leaking service credentials or internal metadata', async t => {
  const sensitive = 'service-token-test-secret /opt/blix/private/vault.db';
  const { setup } = fixture(t, async () => { throw Error(sensitive); });
  const out = await setup(alice);
  assert.equal(out.status, 503);
  assert.ok(out.body.error);
  assert.ok(!out.raw.includes('service-token-test-secret'));
  assert.ok(!out.raw.includes('/opt/blix/private'));
});

test('a different Google subject cannot claim an already linked email wallet', async t => {
  const { setup, calls } = fixture(t);
  await setup(alice);
  calls.length = 0;
  const out = await setup({ ...bob, email: alice.email });
  assert.equal(out.status, 409);
  assert.equal(calls.length, 0);
});

test('a mismatched vault account response cannot bind another user wallet', async t => {
  const { setup, request } = fixture(t, async () => ({ id: 2, address: ADDRESS(2), ref: `blix:google:${bob.sub}` }));
  assert.equal((await setup(alice)).status, 503);
  const me = await request('/api/account/me');
  assert.equal(me.body.needsWallet, true);
  assert.equal(me.body.address, null);
});


test('launch, rewards and claim act only on the signed-in wallet', async t => {
  const { setup, request, calls } = fixture(t);
  await setup(alice);
  await setup(bob);
  calls.length = 0;
  const forged = { id: 2, vault_id: 2, userId: 2, address: ADDRESS(2) };
  const launched = await request('/api/account/launch?vault_id=2', { method: 'POST', body: { name: 'Coin', symbol: 'C', image: 'data:image/png;base64,' + 'A'.repeat(20_000), ...forged } });
  assert.equal(launched.status, 200);
  assert.equal(launched.body.mint, 'mint-for-1');
  assert.equal((await request('/api/account/rewards?vault_id=2')).body.unclaimed.total, 1);
  const claimed = await request('/api/account/claim', { method: 'POST', body: forged });
  assert.equal(claimed.body.signature, 'claim-for-1');
  assert.deepEqual(claimed.body.body, {});
  assert.deepEqual(calls.map(c => c.path), ['launch:1', 'rewards:1', '/users/1/claim']);
  assert.equal((await request('/api/account/claim', { method: 'POST', identity: null, body: {} })).status, 401);
});
