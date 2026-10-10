import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const email = 'blix-hosted-smoke-20261008@example.invalid';
const sub = 'blix-internal-hosted-smoke-20261008';
const remote = `const fs=require('node:fs'),c=require('node:crypto'),s=JSON.parse(fs.readFileSync('/opt/blix/data/settings.json'));const email=${JSON.stringify(email)},t=String(Date.now()),payload=Buffer.from(JSON.stringify({sub:${JSON.stringify(sub)},email,iat:+t,exp:+t+600000})).toString('base64url');console.log(JSON.stringify({'x-blix-edge':s.edgeKey,'x-blix-member':email,'x-blix-member-t':t,'x-blix-member-sig':c.createHmac('sha256',s.memberKey).update(email+'.'+t).digest('hex'),'x-blix-wallet':payload+'.'+c.createHmac('sha256',s.memberKey).update('wallet-auth.'+payload).digest('hex')}));`;
const auth = JSON.parse(execFileSync('ssh', ['-i', 'C:/Users/kaigu/.ssh/model_radar_vm', '-o', 'BatchMode=yes', 'ubuntu@129.146.62.88', 'node'], { input: remote, encoding: 'utf8', windowsHide: true }));
const call = async (p, body) => {
  const r = await fetch('https://origin.blixvip.com/api/account/' + p, { headers: { ...auth, 'content-type': 'application/json' }, method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  return { status: r.status, body: await r.json() };
};
const created = await call('setup', {});
assert.equal(created.status, 200);
assert.match(created.body.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const again = await call('setup', {});
assert.equal(again.body.address, created.body.address);
const me = await call('me');
assert.equal(me.body.needsWallet, false); assert.equal(me.body.address, created.body.address);
assert.equal(me.body.wallet.address, created.body.address); assert.equal(me.body.wallet.sol, 0);
assert.deepEqual((await call('txs')).body, []);
// Mark this clearly as an internal test and freeze it using the owner's authenticated dashboard.
const password = (await fs.readFile('C:/Users/kaigu/.blix-wallet-admin/Admin credentials.txt', 'utf8')).match(/^Password: (.+)$/m)[1].trim();
const login = await fetch('http://127.0.0.1:14470/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
try {
  const overview = await (await fetch('http://127.0.0.1:14470/admin/api/overview', { headers: { cookie } })).json();
  const user = overview.users.find(u => u.email === email);
  assert.equal(user.address, created.body.address);
  const frozen = await fetch(`http://127.0.0.1:14470/admin/api/users/${user.id}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'frozen', note: 'Internal deployment test. Unfunded; no signing, deposits or transactions. Do not use.' }) });
  assert.equal(frozen.status, 200);
  console.log(JSON.stringify({ liveSetup: true, automaticSetup: true, idempotent: true, ownBalance: 0, historyEmpty: true, adminVisible: true, internalTestFrozen: true }));
} finally { await fetch('http://127.0.0.1:14470/admin/api/logout', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }); }
