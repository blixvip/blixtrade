import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'file:///C:/code/note-overlay/node_modules/playwright/index.mjs';
// Short-lived synthetic identity; only GET/HEAD requests are permitted. No account or wallet is created.
const remote = `const fs=require('node:fs'),c=require('node:crypto'),s=JSON.parse(fs.readFileSync('/opt/blix/data/settings.json'));const email='deployment-check@example.invalid',t=String(Date.now()),payload=Buffer.from(JSON.stringify({sub:'blix-readonly-deployment-check',email,iat:+t,exp:+t+600000})).toString('base64url');console.log(JSON.stringify({'x-blix-edge':s.edgeKey,'x-blix-member':email,'x-blix-member-t':t,'x-blix-member-sig':c.createHmac('sha256',s.memberKey).update(email+'.'+t).digest('hex'),'x-blix-wallet':payload+'.'+c.createHmac('sha256',s.memberKey).update('wallet-auth.'+payload).digest('hex')}));`;
const auth = JSON.parse(execFileSync('ssh', ['-i', 'C:/Users/kaigu/.ssh/model_radar_vm', '-o', 'BatchMode=yes', 'ubuntu@129.146.62.88', 'node'], { input: remote, encoding: 'utf8', windowsHide: true }));
const origin = 'https://origin.blixvip.com';
const get = async (p, headers = auth) => { const r = await fetch(origin + p, { headers, redirect: 'manual', signal: AbortSignal.timeout(25000) }); return { status: r.status, body: await r.json() }; };
const role = await get('/api/me');
assert.equal(role.status, 200); assert.equal(role.body.liveWallets, true); assert.equal(role.body.member, true);
const me = await get('/api/account/me');
assert.equal(me.status, 200); assert.equal(me.body.signedIn, true); assert.equal(me.body.needsWallet, true);
const noProof = { ...auth }; delete noProof['x-blix-wallet'];
assert.equal((await get('/api/account/me', noProof)).body.signedIn, false);
const forged = { ...auth, 'x-blix-wallet': auth['x-blix-wallet'] + 'x' };
assert.equal((await get('/api/account/me', forged)).body.signedIn, false);
const publicWallet = await fetch('https://blixvip.com/api/account/me', { signal: AbortSignal.timeout(25000) });
assert.ok([401, 403].includes(publicWallet.status));
const admin = await fetch('https://blixvip.com/admin/api/overview', { signal: AbortSignal.timeout(25000) });
assert.ok(admin.status !== 200 || !(await admin.text()).includes('"users":'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await fs.mkdir('data/hosted-wallet-live', { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await context.route(origin + '/**', route => {
      if (new URL(route.request().url()).pathname === '/api/account/setup') return route.fulfill({ status: 503, json: { error: 'Read-only check: wallet creation intercepted' } });
      return ['GET', 'HEAD'].includes(route.request().method()) ? route.continue({ headers: { ...route.request().headers(), ...auth } }) : route.abort();
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/app#/account', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByText('Read-only check: wallet creation intercepted', { exact: true }).waitFor({ timeout: 30000 });
    const avatar = page.locator('a[aria-label="Account"]');
    assert.equal(await avatar.getAttribute('title'), 'deployment-check@example.invalid');
    assert.equal(await avatar.innerText(), 'D', 'deployed avatar uses member initials when no photo is available');
    assert.equal(await page.getByRole('checkbox', { name: 'I understand Blix controls this wallet' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Try again', exact: true }).isEnabled(), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `data/hosted-wallet-live/automatic-setup-${width}.png` });
    console.log(`PASS live automatic setup attempt and account isolation ${width}px`);
    await context.close();
  }
} finally { await browser.close(); }
console.log('PASS deployed member capability, valid/absent/forged wallet identity, public account isolation. No writes or funds.');
