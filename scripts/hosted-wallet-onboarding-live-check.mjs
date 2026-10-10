// Actual deployed UI + vault, isolated synthetic identity. Creates one unfunded wallet; never signs or sends funds.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { chromium } from 'file:///C:/code/note-overlay/node_modules/playwright/index.mjs';

const stamp = Date.now();
const email = `blix-onboarding-${stamp}@example.invalid`, sub = `blix-internal-onboarding-${stamp}`;
const sshArgs = ['-i', 'C:/Users/kaigu/.ssh/model_radar_vm', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
const host = 'ubuntu@129.146.62.88';
const remote = `const fs=require('node:fs'),c=require('node:crypto'),s=JSON.parse(fs.readFileSync('/opt/blix/data/settings.json'));const email=${JSON.stringify(email)},t=String(Date.now()),payload=Buffer.from(JSON.stringify({sub:${JSON.stringify(sub)},email,iat:+t,exp:+t+600000})).toString('base64url');console.log(JSON.stringify({'x-blix-edge':s.edgeKey,'x-blix-member':email,'x-blix-member-t':t,'x-blix-member-sig':c.createHmac('sha256',s.memberKey).update(email+'.'+t).digest('hex'),'x-blix-wallet':payload+'.'+c.createHmac('sha256',s.memberKey).update('wallet-auth.'+payload).digest('hex')}));`;
const auth = JSON.parse(execFileSync('ssh', [...sshArgs, host, 'node'], { input: remote, encoding: 'utf8', windowsHide: true }));
const origin = 'https://origin.blixvip.com';
async function call(action, body) {
  const r = await fetch(`${origin}/api/account/${action}`, { method: body ? 'POST' : 'GET', headers: { ...auth, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  assert.equal(r.status, 200, `live account/${action} status`);
  return r.json();
}
assert.equal((await call('me')).needsWallet, true, 'fresh identity has no wallet');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const out = 'data/hosted-wallet-live';
await fs.mkdir(out, { recursive: true });
let createdAddress, setupPosts = 0;
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.route(origin + '/**', async route => {
      const req = route.request(), pathname = new URL(req.url()).pathname;
      if (req.method() === 'POST' && pathname === '/api/account/setup') {
        assert.deepEqual(req.postDataJSON(), {});
        setupPosts++;
        const response = await route.fetch({ headers: { ...req.headers(), ...auth, origin: 'https://blixvip.com', 'x-forwarded-host': 'blixvip.com' } });
        console.log(`Live setup response: ${response.status()}`);
        return route.fulfill({ response });
      } else if (!['GET', 'HEAD'].includes(req.method())) return route.abort();
      // Present the same trusted page origin/host as the public Worker's forwarding path.
      return route.continue({ headers: { ...req.headers(), ...auth, origin: 'https://blixvip.com', 'x-forwarded-host': 'blixvip.com' } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(60000);
    await page.goto(origin + '/app#/account', { waitUntil: 'domcontentloaded' });
    try { await page.getByRole('heading', { name: 'Fund your wallet', exact: true }).waitFor(); }
    catch (error) { await page.screenshot({ path: `${out}/onboarding-failure-${width}.png` }); console.error((await page.locator('main').innerText()).slice(0, 900)); throw error; }
    const me = await call('me');
    assert.equal(me.needsWallet, false);
    assert.match(me.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    assert.equal(me.wallet.address, me.address);
    assert.equal(me.wallet.sol, 0);
    if (createdAddress) assert.equal(me.address, createdAddress);
    createdAddress = me.address;
    assert.equal(setupPosts, 1, 'one automatic setup, existing wallet reused');
    assert.doesNotMatch(await page.locator('main').innerText(), /Blix holds|administrators can|owned by|controls this wallet|profile could not be loaded|Members can't use/i);
    assert.equal(await page.getByRole('checkbox', { name: /understand.*wallet/i }).count(), 0);
    await page.screenshot({ path: `${out}/funding-live-${width}.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'Fund wallet', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Exchange', exact: true });
    await dialog.getByText(createdAddress, { exact: true }).waitFor();
    await dialog.getByRole('img', { name: 'QR code of your deposit address' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${out}/deposit-live-${width}.png`, animations: 'disabled' });
    console.log(`PASS deployed automatic wallet + own funding address + no ownership notices: ${width}px`);
    await context.close();
  }
  assert.equal((await call('setup', {})).address, createdAddress, 'repeat setup returns the same real wallet');
  assert.deepEqual(await call('txs'), []);
} finally {
  await browser.close();
  // Only the SSH child created here is terminated. No user application or terminal is touched.
  const tunnel = spawn('ssh', [...sshArgs, '-o', 'ExitOnForwardFailure=yes', '-N', '-L', '127.0.0.1:14470:127.0.0.1:4470', host], { windowsHide: true, stdio: 'ignore' });
  const adminBase = 'http://127.0.0.1:14470';
  let cookie;
  try {
    for (let i = 0; i < 20; i++) {
      try { await fetch(adminBase, { signal: AbortSignal.timeout(1000) }); break; } catch { await new Promise(r => setTimeout(r, 500)); }
    }
    const password = (await fs.readFile('C:/Users/kaigu/.blix-wallet-admin/Admin credentials.txt', 'utf8')).match(/^Password: (.+)$/m)[1].trim();
    const login = await fetch(adminBase + '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(10000) });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];
    const overview = await (await fetch(adminBase + '/admin/api/overview', { headers: { cookie } })).json();
    const user = overview.users.find(u => u.email === email);
    if (user) {
      const frozen = await fetch(`${adminBase}/admin/api/users/${user.id}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'frozen', note: 'Internal automatic onboarding verification. Unfunded; no transactions. Do not use.' }) });
      assert.equal(frozen.status, 200);
      console.log('PASS actual new wallet created, repeat setup idempotent, empty history; internal test wallet frozen.');
    }
  } finally {
    if (cookie) await fetch(adminBase + '/admin/api/logout', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
    tunnel.kill();
  }
}
