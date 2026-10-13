// Real components, isolated API fixtures. Never submits trades or changes real lists.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('../../note-overlay/node_modules/playwright');
const base = process.env.BLIX_URL || 'http://localhost:4421';
const out = new URL('../data/tracker-browser/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
const A = '4p7SeR6361WJ4T4icgsYTnzAUzfA5NwM4CwYD9kMBjuK';
const B = 'BTmCme13XXrD3VLxXFChL9VnmicJ5PjkVUpAsjrooEYh';
const C = '9VQ3dtwAxUAxNPdD86ExhC1XsL1hiUcqEvzS4sAhUU1A';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } });
    const wallets = new Map(), writes = [], errors = [];
    let rejectNext = false, visitor = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.EventSource = class extends EventTarget { close() {} }; });
    if (process.env.BLIX_ORIGIN_HOST) await page.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== new URL(base).origin) return route.continue();
      const response = await route.fetch({ headers: { ...route.request().headers(), host: process.env.BLIX_ORIGIN_HOST } });
      return route.fulfill({ response });
    });
    await page.route('**/api/**', async route => {
      const req = route.request(), u = new URL(req.url()), p = u.pathname;
      const json = (data, status = 200) => route.fulfill({ status, json: data });
      if (p === '/api/me') return json({ member: !visitor, readonly: visitor, email: visitor ? null : 'fixture@example.invalid', liveWallets: !visitor });
      if (p === '/api/account/me') return json({ signedIn: !visitor, email: visitor ? null : 'fixture@example.invalid', hosted: true, address: C, wallet: { sol: 1 } });
      if (p === '/api/wtrack') return json({ wallets: [...wallets.values()], feed: [], transfers: [], status: { live: true, stream: true, fast: true, fastWallets: wallets.size }, groups: [1, 2, 3], max: 200, solUsd: 100 });
      if (p === '/api/wtrack/wallets' && req.method() === 'POST') {
        const body = req.postDataJSON(); writes.push(body);
        if (rejectNext) { rejectNext = false; return json({ error: 'Could not save wallet. Try again.' }, 503); }
        const row = { ...body, emoji: null, color: null, alerts: 1, added: Date.now(), n24: 0, last_trade: null, grp: body.grp || 1 };
        wallets.set(body.address, row); return json(row);
      }
      if (p.startsWith('/api/wtrack/wallets/') && req.method() === 'DELETE') { wallets.delete(p.split('/').pop()); return json({ ok: true }); }
      if (req.method() !== 'GET') return json({ error: 'Unexpected mutation ' + p }, 405);
      if (p === '/api/fomo/board') return json({ rows: [{ rank: 1, handle: 'alice', name: 'Alice', wallet: A, walletVerified: true, pnl: 5000, top: [], pic: null }], status: {} });
      if (p === '/api/pump/board') return json({ rows: [{ rank: 1, name: 'Alice duplicate', wallet: A, pnl: 4500, top: [] }, { rank: 2, name: 'Bob', wallet: B, pnl: 3000, top: [] }], error: null });
      if (p === '/api/fomo/trader/carol') return json({ wallet: C });
      if (p === '/api/fomo/trader/alice') return json({ handle: 'alice', name: 'Alice', wallet: A, address: C, best: [], positions: [], recent: [], ranks: {}, history: [], chart: {}, read: Date.now() });
      if (p === '/api/wallet-page/' + B) return json({ name: 'Bob', wallet: B, solUsd: 100, sol: 1, value: 100, positions: [], best: [], recent: [], ranks: {}, read: Date.now() });
      if (p === '/api/account/profile') return json({ username: 'fixture' });
      if (p === '/api/account/u/fixture/follows') return json({ list: [{ kind: 'wallet', target: C, following: true }, { kind: 'trader', target: 'carol', following: true }] });
      if (p === '/api/wtrack/monitor') return json({ wallets: [], solUsd: 100 });
      if (p === '/api/account/follow') return json({ following: false, signedIn: true });
      if (p === '/api/market') return json({});
      if (p === '/api/build') return json({});
      return json({});
    });
    await page.goto(base + '/#/traders', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Leaderboard' }).waitFor();
    await page.getByRole('button', { name: 'Track Alice', exact: true }).click();
    await page.getByRole('button', { name: 'Stop tracking Alice', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Stop tracking Alice', exact: true }).click();
    await page.getByRole('button', { name: 'Track Alice', exact: true }).waitFor();
    writes.length = 0;
    await page.screenshot({ path: new URL(`before-${width}.png`, out).pathname.replace(/^\/(?:([A-Z]:))/, '$1') });
    const walletButton = width > 700 ? page.locator('footer').getByRole('button', { name: 'Wallets', exact: true }) : page.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Wallets', exact: true });
    await walletButton.click({ timeout: 4000 });
    const popup = page.getByRole('dialog', { name: 'Wallet tracker', exact: true });
    await popup.waitFor();
    await popup.getByRole('tab', { name: 'Find traders', exact: true }).click();
    await popup.getByPlaceholder('Search name, handle or wallet').fill('Alice');
    await popup.getByRole('button', { name: 'Track Alice', exact: true }).click();
    await popup.getByRole('button', { name: 'Stop tracking Alice', exact: true }).waitFor();
    assert.equal(wallets.size, 1, 'same wallet on both leaderboards is tracked once');
    assert.equal(writes.length, 1);
    await popup.getByPlaceholder('Search name, handle or wallet').fill('Bob');
    rejectNext = true;
    await popup.getByRole('button', { name: 'Track Bob', exact: true }).click();
    await page.getByText('Could not save wallet. Try again.', { exact: true }).waitFor();
    assert.equal(wallets.size, 1, 'failed save cannot mark a trader tracked');
    await popup.getByRole('button', { name: 'Track Bob', exact: true }).click();
    await popup.getByRole('button', { name: 'Stop tracking Bob', exact: true }).waitFor();
    await popup.getByPlaceholder('Search name, handle or wallet').fill('');
    await popup.getByRole('button', { name: 'Following', exact: true }).click();
    await popup.getByRole('button', { name: /^Track 9VQ3/ }).click();
    await popup.getByRole('button', { name: /^Stop tracking 9VQ3/ }).waitFor();
    assert.equal(wallets.size, 3);
    await popup.getByRole('button', { name: 'Track', exact: true }).click();
    await popup.getByRole('button', { name: 'Track', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(wallets.size, 3, 'followed handle resolves to its actual wallet without duplication');
    await popup.getByRole('tab', { name: /^Manager/ }).click();
    await popup.getByRole('button', { name: 'Stop tracking Bob', exact: true }).waitFor();
    await popup.getByRole('button', { name: 'Stop tracking Bob', exact: true }).click();
    await popup.getByRole('button', { name: 'Stop tracking Bob', exact: true }).waitFor({ state: 'hidden' });
    await popup.getByRole('tab', { name: 'Find traders', exact: true }).click();
    await popup.getByRole('button', { name: 'pump.fun', exact: true }).click();
    await popup.getByRole('button', { name: 'Track Bob', exact: true }).waitFor();
    await popup.getByRole('button', { name: 'Stop tracking Alice duplicate', exact: true }).waitFor();
    await popup.getByLabel('Add to group').selectOption('2');
    await popup.getByRole('button', { name: 'Track Bob', exact: true }).click();
    await popup.getByRole('button', { name: 'Stop tracking Bob', exact: true }).waitFor();
    assert.equal(wallets.get(B).grp, 2);
    await popup.getByRole('button', { name: 'All traders', exact: true }).click();
    const handle = popup.getByRole('button', { name: 'Move wallet tracker' });
    if (width > 700) {
      const before = await popup.boundingBox(), grip = await handle.boundingBox();
      await page.mouse.move(grip.x + 45, grip.y + 15); await page.mouse.down();
      await page.mouse.move(grip.x - 150, grip.y + 95, { steps: 8 }); await page.mouse.up();
      const after = await popup.boundingBox();
      assert.ok(after.x < before.x - 100 && after.y > before.y + 50, 'popup moves with its title bar');
    }
    if (width > 700) {
      const size = popup.getByRole('button', { name: 'Resize wallet tracker' });
      const beforeSize = await popup.boundingBox();
      await size.focus(); await page.keyboard.press('Shift+ArrowRight');
      assert.equal((await popup.boundingBox()).width, beforeSize.width + 40);
    }
    const bounds = await popup.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, 'popup fits viewport');
    await popup.screenshot({ path: new URL(`popup-${width}.png`, out).pathname.replace(/^\/(?:([A-Z]:))/, '$1') });
    await popup.getByRole('button', { name: 'Close wallet tracker', exact: true }).click();
    await walletButton.click();
    assert.deepEqual(await popup.boundingBox(), bounds, 'dropped position survives reopening');
    await page.evaluate(() => { location.hash = '/trader/alice'; });
    await page.locator('main').getByRole('button', { name: 'Stop tracking Alice', exact: true }).waitFor();
    assert.deepEqual(await popup.boundingBox(), bounds, 'window survives page navigation');
    await popup.getByRole('button', { name: 'Move wallet tracker' }).focus();
    await page.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
    await page.locator('main').getByRole('button', { name: 'Stop tracking Alice', exact: true }).click();
    await page.locator('main').getByRole('button', { name: 'Track Alice', exact: true }).waitFor();
    assert.ok(!wallets.has(A), 'profile removes from the same tracker');
    await page.evaluate(wallet => { location.hash = '/trader/' + wallet; }, B);
    await page.locator('main').getByRole('button', { name: 'Stop tracking Bob', exact: true }).waitFor();
    visitor = true;
    await page.reload();
    await walletButton.click();
    await popup.getByRole('tab', { name: 'Find traders', exact: true }).click();
    await popup.getByRole('button', { name: 'Track Alice', exact: true }).click();
    await page.waitForURL('**/#/account');
    assert.ok(!wallets.has(A), 'visitor must sign in before tracking');
    assert.deepEqual(errors, []);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.close();
    console.log(`PASS tracker integration ${width}px`);
  }
} finally { await browser.close(); }
