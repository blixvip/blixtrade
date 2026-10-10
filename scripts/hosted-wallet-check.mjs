// Automatic hosted-wallet creation and member isolation. Synthetic account, localhost APIs only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
catch { ({ chromium } = require('../../note-overlay/node_modules/playwright')); }
const root = path.resolve(import.meta.dirname, '..');
const dist = path.resolve(process.env.BLIX_DIST || path.join(root, 'web/dist'));
const out = path.join(root, 'data', 'hosted-wallet-check');
await mkdir(out, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + path.sep)) throw Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
// A public base58 fixture address; no key exists in this harness and no funds are sent.
const address = '11111111111111111111111111111111';
const email = 'member@example.invalid';
const account = ready => ({
  signedIn: true, hosted: true, needsWallet: !ready, email,
  name: 'Alex Morgan', picture: 'https://lh3.googleusercontent.com/a/avatar-fixture',
  address: ready ? address : null,
  wallet: ready ? { address, sol: 0, solUsd: 0, tokensUsd: 0, tokens: [] } : null,
});
try {
  for (const width of [1440, 1024, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: width === 320 ? 'reduce' : 'no-preference' });
    page.setDefaultTimeout(8000);
    const errors = [], setups = [], blockedMutations = [];
    let ready = false, finishSetup;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('blix:role', JSON.stringify('member'));
      localStorage.setItem('blix:trade:paper', JSON.stringify(true));
      window.EventSource = class extends EventTarget {
        static CLOSED = 2; readyState = 1;
        constructor() { super(); queueMicrotask(() => { this.onopen?.(); this.dispatchEvent(new MessageEvent('hello', { data: '{}' })); }); }
        close() { this.readyState = 2; }
      };
    });
    await page.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      if (u.href === 'https://lh3.googleusercontent.com/a/avatar-fixture') return width === 320
        ? route.abort()
        : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="#677aa1"/><circle cx="48" cy="36" r="19" fill="#e7bda2"/><ellipse cx="48" cy="96" rx="34" ry="36" fill="#26364c"/><path d="M29 34q-3-26 22-21 19 2 16 24-15-3-21-13-6 9-17 10" fill="#302c34"/></svg>' });
      if (u.origin !== base) return route.abort();
      if (u.pathname === '/api/account/setup' && req.method() === 'POST') {
        setups.push(req.postDataJSON());
        await new Promise(resolve => { finishSetup = resolve; });
        if (setups.length === 1) return route.fulfill({ status: 503, json: { error: 'Fixture wallet service unavailable' } });
        ready = true;
        return route.fulfill({ json: { ok: true, address, ...account(true) } });
      }
      if (!['GET', 'HEAD'].includes(req.method())) {
        if (!u.pathname.includes('telemetry')) blockedMutations.push(u.pathname);
        return route.abort();
      }
      if (!u.pathname.startsWith('/api/')) return route.continue();
      const fixtures = {
        '/api/me': { member: true, liveWallets: true },
        '/api/account/me': account(ready),
        '/api/account/txs': [],
        '/api/account/profile': { id: 123, username: 'fixturemember', display: 'Fixture member', bio: '', avatar: null, banner: null, address: ready ? address : null, joined: 1_700_000_000_000, followers: 0, follows: 0, isMe: true, following: false, showHoldings: false },
        '/api/pulse': { newPairs: [], stretch: [], migrated: [], running: [], live: { solUsd: 150 } },
        '/api/paper/wallet': { start: 10, cash: 10, equity: 10, pnl: 0, realized: 0, open: 0, trades: 0, unpriced: 0, solUsd: 150 },
        '/api/paper': { sizes: [0.1, 0.25, 0.5, 1] },
        '/api/x': { posts: [] },
        '/api/market': { btc: { usd: 60000 }, eth: { usd: 3000 }, sol: { usd: 150 } },
      };
      return Object.hasOwn(fixtures, u.pathname)
        ? route.fulfill({ json: fixtures[u.pathname] })
        : route.fulfill({ status: 503, json: { error: 'Not used in this fixture' } });
    });
    try {
      await page.goto(`${base}/${width === 390 ? '#/' : '#/account'}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Creating your wallet', exact: true }).waitFor();
      const avatar = page.locator('a[aria-label="Account"]');
      assert.equal(await avatar.getAttribute('title'), 'Alex Morgan');
      if (width === 320) {
        await avatar.getByLabel("Alex Morgan's initials").waitFor();
        assert.equal(await avatar.innerText(), 'AM', 'failed photo falls back to initials');
      } else {
        await avatar.getByRole('img', { name: "Alex Morgan's profile picture" }).waitFor();
        await page.waitForFunction(() => document.querySelector('a[aria-label="Account"] img')?.naturalWidth > 0);
      }
      await page.waitForFunction(() => document.querySelector('[aria-busy="true"]'));
      assert.equal(await page.getByRole('checkbox').count(), 0, 'no acceptance step');
      await page.waitForTimeout(100);
      assert.equal(setups.length, 1, 'wallet creation starts automatically exactly once');
      const animations = await page.locator('section[aria-busy="true"]').evaluate(el => el.getAnimations({ subtree: true }).length);
      assert.equal(animations > 0, width !== 320, 'creation animation respects reduced motion');
      assert.equal(await page.locator('a[href="#/settings"]:visible').count(), 0, 'member must not see owner settings');
      await page.screenshot({ path: path.join(out, `creating-${width}.png`) });
      finishSetup();
      await page.getByText('Fixture wallet service unavailable', { exact: true }).first().waitFor();
      assert.equal(ready, false);
      assert.equal(await page.getByRole('button', { name: 'Fund wallet', exact: true }).count(), 0, 'never prompt for funding after failed creation');
      await page.screenshot({ path: path.join(out, `setup-error-${width}.png`), animations: 'disabled' });
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.getByRole('heading', { name: 'Creating your wallet', exact: true }).waitFor();
      await page.waitForTimeout(100);
      assert.equal(setups.length, 2);
      finishSetup();
      await page.getByRole('heading', { name: 'Fund your wallet', exact: true }).waitFor();
      await page.getByText(address, { exact: true }).first().waitFor();
      await page.getByRole('heading', { name: 'Alex Morgan', exact: true }).waitFor();
      assert.deepEqual(setups, [{}, {}]);
      assert.equal(await page.getByRole('heading', { name: 'Creating your wallet', exact: true }).count(), 0);
      await page.screenshot({ path: path.join(out, `wallet-${width}.png`), animations: 'disabled' });

      await page.getByRole('button', { name: 'Fund wallet', exact: true }).click();
      const exchange = page.getByRole('dialog', { name: 'Exchange', exact: true });
      await exchange.waitFor();
      await exchange.getByText(address, { exact: true }).waitFor();
      await exchange.getByRole('img', { name: 'QR code of your deposit address' }).waitFor();
      assert.match(await exchange.innerText(), /Your deposit address/);
      await page.screenshot({ path: path.join(out, `deposit-${width}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      const paper = page.getByRole('switch', { name: /^Paper/ });
      assert.equal(await paper.getAttribute('aria-checked'), 'true');
      await paper.click();
      assert.equal(await paper.getAttribute('aria-checked'), 'false', 'enabled members can select real trading');
      await paper.click();
      assert.equal(await paper.getAttribute('aria-checked'), 'true', 'member can return to Paper mode');
      assert.equal(await page.locator('a[href="#/settings"]:visible').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no viewport horizontal overflow');
      assert.deepEqual(blockedMutations, []);
      assert.deepEqual(errors, []);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Fund your wallet', exact: true }).waitFor();
      assert.equal(setups.length, 2, 'existing wallet is reused on reload');
      console.log(`PASS automatic wallet creation, animation, retry, funding, reload, member isolation: ${width}px`);
    } catch (error) {
      await page.screenshot({ path: path.join(out, `failure-${width}.png`), animations: 'disabled' });
      throw error;
    } finally { await page.close(); }
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
