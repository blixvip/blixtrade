// Real-trade UI regression checks. Every API response is mocked; no financial request leaves localhost.
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
const out = path.join(root, 'data', 'trade-status-check');
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
const mint = 'TestFixture111111111111111111111111111111pump';
const signature = 'B'.repeat(88); // Valid signature shape, fixture only; never sent to a chain.
const cases = ['unknown', 'confirmed', 'failed', 'duplicate', 'http503', 'network', 'rejected'];
try {
 for (const width of [1440, 390]) {
  for (const side of ['buy', 'sell']) {
   for (const scenario of cases) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [], requests = [];
    page.on('pageerror', e => { errors.push(e.message); if (process.env.STACKS) console.log('STACK', e.stack); });
    page.on('console', m => { if (m.type() === 'error' && /TypeError/.test(m.text())) errors.push(m.text().split(String.fromCharCode(10)).slice(0, 3).join(' / ')); });
    page.on('dialog', d => d.accept());
    await page.addInitScript(({ mint }) => {
      if (window.top !== window) return;   // the coin page's chart frame: no storage there, and nothing to set up
      localStorage.setItem('blix:role', JSON.stringify('owner'));
      localStorage.setItem('blix:pulse:show', JSON.stringify('all'));
      localStorage.setItem('blix:trade:paper', JSON.stringify(false));
      localStorage.setItem('blix:qt:open', JSON.stringify(true));
      localStorage.setItem('blix:qt:coin', JSON.stringify({ mint, symbol: 'FIXTURE' }));
      window.EventSource = class extends EventTarget {
        static CLOSED = 2; readyState = 1;
        constructor() { super(); queueMicrotask(() => { this.onopen?.(); this.dispatchEvent(new MessageEvent('hello', { data: '{}' })); }); }
        close() { this.readyState = 2; }
      };
    }, { mint });
    await page.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      if (u.origin !== base) return route.abort();
      if (!u.pathname.startsWith('/api/')) return route.continue();
      if (u.pathname === `/api/account/${side}` && req.method() === 'POST') {
        requests.push(req.postDataJSON());
        await new Promise(resolve => setTimeout(resolve, 150));
        if (scenario === 'network') return route.abort('connectionreset');
        if (scenario === 'http503') return route.fulfill({ status: 503, json: { error: 'Fixture gateway unavailable' } });
        if (scenario === 'rejected') return route.fulfill({ status: 400, json: { error: 'Fixture invalid amount' } });
        await route.fulfill({ json: { status: scenario === 'duplicate' ? 'confirmed' : scenario, signature, note: scenario === 'failed' ? 'Fixture transaction rejected' : undefined, landedMs: scenario === 'confirmed' ? 500 : null } });
        return;
      }
      if (req.method() !== 'GET') return route.abort();
      if (u.pathname === '/api/account/me') return route.fulfill({ json: { signedIn: true, address: 'FixtureWallet', wallet: { sol: 10, solUsd: 1500, tokens: [{ mint, ui: 100, usd: 20 }] } } });
      if (u.pathname === '/api/account/txs') return route.fulfill({ json: [] });
      if (u.pathname === '/api/pulse') return route.fulfill({ json: { newPairs: [{ mint, symbol: 'FIXTURE', name: 'Trading regression fixture', age: 60000, mcap: 20000, holders: 100, top10: 10, dev: 0 }], stretch: [], migrated: [], running: [], live: { solUsd: 150 } } });
      if (u.pathname === '/api/me') return route.fulfill({ json: { member: false, readonly: false } });
      if (u.pathname === '/api/x') return route.fulfill({ json: { posts: [] } });
      if (u.pathname === '/api/market') return route.fulfill({ json: { btc: { usd: 60000 }, eth: { usd: 3000 }, sol: { usd: 150 } } });
      if (u.pathname === '/api/paper') return route.fulfill({ json: { sizes: [0.1, 0.25, 0.5, 1] } });
      if (u.pathname === `/api/token/${mint}`) return route.fulfill({ json: { token: { mint, symbol: 'FIXTURE', mcap: 20000 }, paper: [], live: { mcap: 20000 } } });
      if (u.pathname === `/api/coin/${mint}`) return route.fulfill({ json: { mcUsd: 20000 } });
      return route.fulfill({ status: 503, json: { error: 'Not used in this fixture' } });
    });
    const meLoaded = page.waitForResponse(r => r.url().endsWith('/api/account/me'));
    await page.goto(`${base}/#/coin/${mint}`, { waitUntil: 'domcontentloaded' });   // the panel lives on the coin page (docked); off it, it closes
    await meLoaded;
    const panel = page.locator('[aria-label="Instant trade"]').first();
    await panel.waitFor({ timeout: 15000 }).catch(async (e) => { await page.screenshot({ path: path.join(out, 'no-panel.png') }); console.log('page errors:', errors.join(' | ')); throw e; });
    const button = panel.locator('button').filter({ hasText: side === 'buy' ? /^0\.1\s*(SOL)?$/ : /^25%$/ });
    await button.waitFor();
    const submitted = scenario === 'network'
      ? page.waitForEvent('requestfailed', { predicate: r => new URL(r.url()).pathname === `/api/account/${side}` })
      : page.waitForResponse(r => new URL(r.url()).pathname === `/api/account/${side}`);
    if (scenario === 'duplicate') await button.evaluate(b => { b.click(); b.click(); });
    else await button.click();
    await submitted;
    const toast = page.locator('[aria-live="polite"] [role="status"]').first();
    await toast.waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-live="polite"] [role="status"]')?.textContent.match(/Buying|Selling/));
    const text = await toast.innerText();
    await page.screenshot({ path: path.join(out, `${scenario}-${side}-${width}.png`) });
    if (['unknown', 'http503', 'network'].includes(scenario)) {
      assert.doesNotMatch(text, /\bBought\b|\bSold\b/, 'unknown transaction must never report success');
      assert.match(text, /unconfirmed|not confirmed|unknown|confirmation pending|check.*transaction/i, 'ambiguous status must be explicit');
      assert.doesNotMatch(text, /\bfailed\b/i, 'unknown is not a confirmed failure');
      assert.equal(await toast.locator('a').getAttribute('href'), scenario === 'unknown' ? `https://solscan.io/tx/${signature}` : '#/account');
    } else if (scenario === 'failed' || scenario === 'rejected') {
      assert.match(text, /failed|rejected/i, 'chain failure must report failure');
      assert.doesNotMatch(text, /\bBought\b|\bSold\b/);
    } else {
      assert.match(text, side === 'buy' ? /Bought \$FIXTURE/ : /Sold \$FIXTURE/);
      assert.equal(await toast.locator('a').getAttribute('href'), `https://solscan.io/tx/${signature}`);
    }
    assert.equal(requests.length, 1, `${scenario}: only one ${side} submission`);
    assert.equal(requests[0].mint, mint);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px ${side}: ${scenario}`);
    await page.close();
   }
  }
 }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
