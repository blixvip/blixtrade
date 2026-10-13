// Real built frontend; isolated HTTP/SSE fixtures, no credentials or provider traffic.
// Run npm --prefix web run build first, then node scripts/metric-browser-check.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
catch { ({ chromium } = require('../../note-overlay/node_modules/playwright')); }
const root = path.resolve(import.meta.dirname, '..');
const dist = path.resolve(process.env.BLIX_DIST || path.join(root, 'web/dist'));
const out = path.join(root, 'data/metric-check');
const MINT = `${'A'.repeat(31)}B`, SECOND = `${'A'.repeat(31)}C`;
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
const report = [];
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    page.setDefaultTimeout(8_000);
    const result = { width, checks: [], errors: [], metricsRequests: [], blockedExternal: [] };
    report.push(result);
    page.on('pageerror', error => result.errors.push(error.message));
    let pulseCount = 0, metricsResponse = { boot: 100, coins: [] };
    const observedAt = Date.now() - 120_000;
    const rows = [MINT, SECOND].map((mint, i) => ({ mint, name: `Metric coin ${i}`, symbol: `METRIC${i}`, age: 60_000, born: Date.now() - 60_000, live: true, mcap: 10000 + i, holders: 100, buys: 20, sells: 5, fees: 0.1, dex: 'pumpfun', ai: { rated: true, grade: 'B', score: 80 } }));
    await page.addInitScript(() => {
      localStorage.setItem('blix:role', JSON.stringify('member'));
      localStorage.setItem('blix:pulse:show', JSON.stringify('all'));
      window.EventSource = class extends EventTarget {
        static CLOSED = 2;
        readyState = 1;
        constructor() { super(); window.__metricStream = this; queueMicrotask(() => { this.onopen?.(); this.dispatchEvent(new MessageEvent('hello', { data: '{}' })); }); }
        close() { this.readyState = 2; }
      };
    });
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin !== base) { result.blockedExternal.push(u.origin); return route.abort(); }
      if (!u.pathname.startsWith('/api/')) return route.continue();
      assert.equal(route.request().method(), 'GET', 'Fixture must never write');
      const p = u.pathname.slice(5);
      if (p === 'metrics') {
        result.metricsRequests.push(Object.fromEntries(u.searchParams));
        return route.fulfill({ json: metricsResponse });
      }
      if (p === 'pulse' && ++pulseCount > 1) return route.fulfill({ status: 503, json: { error: 'Board refresh intentionally disabled' } });
      const fixture = p === 'me' ? { member: true }
        : p === 'pulse' ? { newPairs: rows, running: [], stretch: [], migrated: [], live: { solUsd: 150, tradesPerSec: 20, ai: {} } }
        : p === 'market' ? { btc: { usd: 62000, chg24: 1 }, eth: { usd: 2400, chg24: -1 }, sol: { usd: 150, chg24: 2 } }
        : p === 'paper/wallet' ? { start: 100, cash: 100, equity: 100, pnl: 0, realized: 0, open: 0, trades: 0, unpriced: 0, solUsd: 150 }
        : p === 'x' ? { posts: [] } : p === 'pics' ? { rows: {} } : p === 'account/me' ? { signedIn: false }
        : p === 'discover' ? { trending: [], new: [], top: [], rows: [] }
        : p === `token/${MINT}` ? { token: { ...rows[0], first_seen: rows[0].born, price: 0.00001 }, live: { mcap: 10000, buys: 20, sells: 5 }, paper: [] }
        : p === `coin/${MINT}` ? { mint: MINT, name: rows[0].name, symbol: rows[0].symbol, solUsd: 150, live: true, onCurve: true, mcUsd: 10000, priceUsd: 0.00001, supply: 1e9, m5: null, holders: null, traders: [], early: [], dev: null, info: {}, tradesSince: null }
        : p === `coin/${MINT}/trades` || p === `coin/${MINT}/big` ? { mint: MINT, source: 'none', trades: [] }
        : null;
      return route.fulfill(fixture ? { json: fixture } : { status: 503, json: { error: 'Fixture unavailable' } });
    });
    const field = (value, estimated = false) => ({ value, source: 'browser-fixture', observedAt, receivedAt: Date.now(), calculatedAt: Date.now(), maxAgeMs: 5_000, estimated, partial: estimated, provisional: false });
    const payload = (revision, mc, fees) => ({ boot: 100, coins: [{ mint: MINT, revision, fields: { mc: field(mc), fees: field(fees, true), feesObserved: field(0.125) } }] });
    const emit = data => page.evaluate(data => window.__metricStream.dispatchEvent(new MessageEvent('metrics', { data: JSON.stringify(data) })), data);
    const waitText = text => page.getByText(text, { exact: true }).first().waitFor({ state: 'visible' });
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Pulse', exact: true }).waitFor();
      await waitText('METRIC0');
      await waitText('$10.0K');
      await page.waitForResponse(response => new URL(response.url()).pathname === '/api/metrics');
      assert.ok(result.metricsRequests.some(query => query.m?.split(',').includes(MINT) && query.m.split(',').includes(SECOND)), 'Visible rows share a batched metrics request');
      result.checks.push('visible rows batched');

      await emit(payload(2, 42000, 0.375));
      await waitText('$42.0K');
      await waitText('0.375');
      assert.doesNotMatch(await page.locator('body').innerText(), /≈/);
      result.checks.push('SSE market cap and estimated fee update without approximation symbols');
      await emit({ boot: 100, coins: [{ mint: MINT, revision: 3, fields: { mc: field(43000) } }] });
      await waitText('$43.0K');
      await waitText('0.375');
      result.checks.push('partial higher revision preserves prior fee fields');
      await emit(payload(1, 7000, 0.01));
      await page.waitForTimeout(100);
      await waitText('$43.0K');
      await waitText('0.375');
      assert.equal(await page.getByText('$7.0K', { exact: true }).count(), 0);
      result.checks.push('lower revision rejected');

      metricsResponse = payload(4, 43000, 0.375);
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/metrics');
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await refreshed;
      await page.getByText('0.375', { exact: true }).hover();
      const tooltip = page.getByRole('tooltip');
      await tooltip.waitFor({ state: 'visible' });
      const tip = await tooltip.innerText();
      assert.match(tip, /0\.125 SOL observed/);
      assert.match(tip, /Estimated/);
      assert.match(tip, /Stale/);
      const age = Number(tip.match(/(\d+)s since source update/)?.[1]);
      assert.ok(age >= 120, `Unchanged snapshot retains source age: ${tip}`);
      result.checks.push('unchanged snapshot preserves stale observation and observed fee evidence');
      await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(out, `pulse-${width}.png`), fullPage: true });

      const cleared = page.waitForRequest(request => { const u = new URL(request.url()); return u.pathname === '/api/metrics' && u.searchParams.get('m') === '' && u.searchParams.get('active') === ''; });
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await cleared;
      result.checks.push('hidden tab releases interest');
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      const active = page.waitForRequest(request => { const u = new URL(request.url()); return u.pathname === '/api/metrics' && u.searchParams.get('active') === MINT; });
      await page.evaluate(mint => { location.hash = `#/coin/${mint}`; }, MINT);
      await active;
      result.checks.push('coin page publishes active interest');
      await page.screenshot({ path: path.join(out, `coin-${width}.png`), fullPage: true });
      assert.deepEqual(result.errors, [], 'No frontend exceptions');
      console.log(JSON.stringify({ width, checks: result.checks }));
    } catch (error) {
      result.failure = error.stack || String(error);
      console.error(`Metric browser ${width}: ${error.message}`);
      await page.screenshot({ path: path.join(out, `failure-${width}.png`), fullPage: true });
    } finally { await page.close(); }
  }
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
assert.equal(report.filter(row => row.failure).length, 0, `Browser regression failed; see ${path.join(out, 'report.json')}`);
