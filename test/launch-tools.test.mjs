import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { createAutoClaim, AUTO_CLAIM_MIN } from '../server/autoclaim.js';
import { createHostedAccounts } from '../server/hosted-accounts.js';

const NOW = 1_900_000_000_000;

function fakeVault(rewards) {
  const calls = [];
  const vault = async (path, body) => {
    calls.push({ path, body });
    const [, id, op] = /^\/users\/(\d+)\/(.+)$/.exec(path) || [];
    if (op === 'rewards') { const r = rewards[id]; if (r instanceof Error) throw r; return { total: r ?? 0 }; }
    if (op === 'claim') return { status: 'confirmed', signature: `claim-${id}` };
    throw Error(`unexpected ${path}`);
  };
  return { vault, calls };
}

test('auto-claim: set, get and switch off, with the floor checked', () => {
  const db = new DatabaseSync(':memory:');
  const { vault } = fakeVault({});
  const ac = createAutoClaim({ db, vault, now: () => NOW });
  assert.deepEqual(ac.get('acc:1'), { on: false, minSol: null, claims: 0, checked: null, last: null, error: null });
  const r = ac.set('acc:1', 7, 0.05);
  assert.equal(r.on, true); assert.equal(r.minSol, 0.05);
  assert.throws(() => ac.set('acc:1', 7, AUTO_CLAIM_MIN / 10), /floor/);
  assert.throws(() => ac.set('acc:1', 7, 'lots'), /floor/);
  assert.throws(() => ac.set('acc:1', 0, 0.05), /wallet/);
  assert.equal(ac.set('acc:1', 7, null).on, false);
  assert.equal(ac.set('acc:1', 7, 0.1).minSol, 0.1);
  assert.equal(ac.set('acc:1', 7, 0).on, false);
});

test('auto-claim: a pass claims only the accounts at or above their floor, and remembers failures', async () => {
  const db = new DatabaseSync(':memory:');
  const rewards = { 1: 0.2, 2: 0.01, 3: Error('vault down') };
  const { vault, calls } = fakeVault(rewards);
  const ac = createAutoClaim({ db, vault, now: () => NOW, log: () => {} });
  ac.set('acc:1', 1, 0.05); ac.set('sub:x', 2, 0.05); ac.set('acc:3', 3, 0.05);
  const did = await ac.tick();
  assert.deepEqual(did, { checked: 3, claimed: 1, failed: 1 });
  assert.deepEqual(calls.filter((c) => c.path.endsWith('/claim')).map((c) => c.path), ['/users/1/claim']);
  const one = ac.get('acc:1');
  assert.equal(one.claims, 1); assert.equal(one.last.sol, 0.2); assert.equal(one.last.sig, 'claim-1'); assert.equal(one.error, null);
  const two = ac.get('sub:x');
  assert.equal(two.claims, 0); assert.equal(two.checked, NOW); assert.equal(two.last, null);
  const three = ac.get('acc:3');
  assert.equal(three.claims, 0); assert.match(three.error.text, /vault down/);
  // The next pass clears a failure once it works.
  rewards[3] = 1;
  await ac.tick();
  assert.equal(ac.get('acc:3').error, null); assert.equal(ac.get('acc:3').claims, 1);
});

test('hosted accounts: the auto-claim route reads and writes the signed-in member\'s own setting', async () => {
  const db = new DatabaseSync(':memory:');
  const { vault } = fakeVault({});
  const ac = createAutoClaim({ db, vault, now: () => NOW });
  const v = async (path, body) => {
    if (path === '/users') return { id: 5, address: '5'.repeat(32), ref: body.ref };
    return vault(path, body);
  };
  const handle = createHostedAccounts({ db, vault: v, autoclaim: ac, now: () => NOW });
  const alice = { sub: 'google-alice', email: 'alice@example.test', authed: NOW };
  async function request(path, { method = 'GET', body } = {}) {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, { method, url: path, headers: {}, walletIdentity: alice, walletMember: alice.email });
    let status = 0, out = '';
    const res = { writeHead: (s) => { status = s; }, end: (b) => { out += b || ''; } };
    await handle(req, res, new URL(path, 'http://x'));
    return { status, body: JSON.parse(out || 'null') };
  }
  assert.equal((await request('/api/account/setup', { method: 'POST', body: {} })).status, 200);
  assert.deepEqual((await request('/api/account/autoclaim')).body.on, false);
  const set = await request('/api/account/autoclaim', { method: 'POST', body: { minSol: 0.05 } });
  assert.equal(set.status, 200); assert.equal(set.body.minSol, 0.05);
  assert.equal(ac.get('sub:google-alice').minSol, 0.05);
  const bad = await request('/api/account/autoclaim', { method: 'POST', body: { minSol: 'x' } });
  assert.equal(bad.status, 400);
  const off = await request('/api/account/autoclaim', { method: 'POST', body: { minSol: null } });
  assert.equal(off.body.on, false);
});
