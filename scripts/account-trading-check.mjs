// Real account controls with local synthetic responses only. No live requests or spending.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../../note-overlay/node_modules/playwright/index.mjs';
const root = path.resolve(import.meta.dirname, '..'), dist = path.join(root, 'web/dist'), out = path.join(root, 'data/account-trading-check');
await mkdir(out, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://local').pathname, file = path.resolve(dist, '.' + (p === '/' ? '/index.html' : p));
    if (!file.startsWith(dist + path.sep)) throw Error();
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`, signature = 'B'.repeat(88), mint = 'So11111111111111111111111111111111111111112';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
 for (const scenario of process.argv.includes('--deposit-only') ? ['deposit'] : ['unknown', 'confirmed', 'network', 'rejected', 'reauth', 'deposit']) {
  const page = await browser.newPage({ viewport: { width: scenario === 'deposit' ? 390 : 1440, height: 1000 } });
  page.setDefaultTimeout(15000);
  let balance = scenario === 'deposit' ? 0 : 1, writes = 0;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => {
    localStorage.setItem('blix:role', JSON.stringify('member'));
    localStorage.setItem('blix:trade:paper', JSON.stringify(true));
    window.EventSource = class extends EventTarget { close() {} };
  });
  await page.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== base) return route.abort();
    if (!u.pathname.startsWith('/api/')) return route.continue();
    if (req.method() === 'POST' && /\/api\/account\/(buy|withdraw)$/.test(u.pathname)) {
      writes++;
      await new Promise(r => setTimeout(r, 150));
      if (scenario === 'network') return route.abort();
      if (scenario === 'rejected') return route.fulfill({ status: 400, json: { error: 'Insufficient SOL for this trade' } });
      if (scenario === 'reauth') return route.fulfill({ status: 401, json: { error: 'Sign in again', confirm: true } });
      return route.fulfill({ json: { status: scenario, signature } });
    }
    if (req.method() !== 'GET') return route.abort();
    const fixtures = {
      '/api/me': { member: true, liveWallets: true },
      '/api/account/me': { signedIn: true, hosted: true, email: 'trader@example.invalid', address: mint, wallet: { sol: balance, solUsd: balance * 150, tokensUsd: 0, tokens: [] } },
      '/api/account/txs': [],
      '/api/pulse': { newPairs: [], stretch: [], migrated: [], running: [], live: { solUsd: 150 } },
      '/api/paper/wallet': { start: 10, cash: 10, equity: 10, pnl: 0, open: 0, trades: 0, solUsd: 150 },
      '/api/paper': { sizes: [0.1, 0.25] },
      '/api/x': { posts: [] }, '/api/market': { sol: { usd: 150 } },
    };
    return route.fulfill({ status: Object.hasOwn(fixtures, u.pathname) ? 200 : 503, json: fixtures[u.pathname] || { error: 'Unused fixture' } });
  });
  await page.goto(base + '/#/account', { waitUntil: 'domcontentloaded' });
  if (scenario === 'deposit') {
    await page.getByRole('heading', { name: 'Fund your wallet', exact: true }).waitFor();
    balance = 0.5;
    await page.getByRole('heading', { name: 'Ready to trade', exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, 'funded-390.png') });
    assert.equal(await page.getByRole('heading', { name: 'Fund your wallet', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Trade with real SOL', exact: true }).click();
    assert.equal(await page.getByRole('switch', { name: /^Paper/ }).getAttribute('aria-checked'), 'false');
    assert.equal(writes, 0, 'choosing real mode never sends a trade');
  } else {
    const withdrawal = scenario === 'reauth';
    await page.getByRole('button', { name: withdrawal ? 'Withdraw' : 'Buy', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: withdrawal ? 'Withdraw SOL' : 'Buy a coin' });
    await dialog.getByLabel(withdrawal ? 'To address' : 'Contract address', { exact: true }).fill(mint);
    if (withdrawal) await dialog.getByLabel(/Amount in SOL/).fill('0.01');
    await dialog.getByRole('button', { name: withdrawal ? 'Withdraw' : 'Buy with real SOL', exact: true }).evaluate(b => { b.click(); b.click(); });
    if (withdrawal) await page.getByText('Confirm it is you.', { exact: true }).waitFor();
    else {
      const expected = scenario === 'confirmed' ? 'Buy confirmed' : scenario === 'rejected' ? 'Buy failed' : 'Confirmation pending';
      await page.getByText(expected, { exact: true }).waitFor();
      if (scenario === 'unknown') assert.equal(await page.locator('[role="status"] a').getAttribute('href'), `https://solscan.io/tx/${signature}`);
    }
    assert.equal(writes, 1, 'double click never submits twice');
  }
  await page.screenshot({ path: path.join(out, `${scenario}.png`) });
  assert.deepEqual(errors, []);
  console.log(`PASS account ${scenario}`);
  await page.close();
 }
} finally { await browser.close(); await new Promise(r => server.close(r)); }
