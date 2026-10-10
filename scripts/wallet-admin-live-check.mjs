import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'file:///C:/code/note-overlay/node_modules/playwright/index.mjs';
const base = 'http://127.0.0.1:14470';
assert.equal((await fetch(base + '/admin/api/overview')).status, 401);
const password = (await fs.readFile('C:/Users/kaigu/.blix-wallet-admin/Admin credentials.txt', 'utf8')).match(/^Password: (.+)$/m)[1].trim();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Password', { exact: true }).fill(password);
    const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/admin/api/overview') && r.status() === 200), page.getByRole('button', { name: 'Sign in', exact: true }).click()]);
    await page.getByRole('heading', { name: 'Users and wallets' }).waitFor();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `data/hosted-wallet-live/admin-${width}.png` });
    assert.equal(response.status(), 200);
    const overview = await response.json();
    console.log(JSON.stringify({ width, adminLogin: true, wallets: overview.totals.users, transactions: overview.totals.txs }));
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await context.close();
  }
} catch { throw Error('Live admin UI verification failed; authentication details suppressed.'); }
finally { await browser.close(); }
