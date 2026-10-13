// Production frontend regression/size check. No backend, credentials or API writes.
// Build web/ first. --baseline records measurements without enforcing the new budgets.
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
const baseline = process.argv.includes('--baseline');
// BLIX_PERF_RTT=<ms>: each file waits this long before it is sent, like a round trip through the tunnel.
const rtt = Number(process.env.BLIX_PERF_RTT || 0);
const out = process.env.BLIX_PERF_OUT || path.join(root, 'data', baseline ? 'performance-before' : 'performance-after');
await mkdir(out, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + path.sep)) throw Error('Invalid path');
    const body = await readFile(file);
    if (rtt) await new Promise(r => setTimeout(r, rtt));
    res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(new URL(r.url()).pathname));
    await page.addInitScript(() => {
      localStorage.setItem('blix:role', JSON.stringify('member'));
      localStorage.setItem('blix:pulse:show', JSON.stringify('all'));
      localStorage.setItem('blix:qt:open', JSON.stringify(true));
      // A returning mobile visitor may have remembered this desktop request on an earlier visit.
      localStorage.setItem('blix:warm:home', JSON.stringify(['market']));
      window.EventSource = class extends EventTarget {
        static CLOSED = 2;
        readyState = 1;
        constructor() { super(); window.__testStream = this; queueMicrotask(() => { this.onopen?.(); this.dispatchEvent(new MessageEvent('hello', { data: '{}' })); }); }
        close() { this.readyState = 2; }
      };
      window.__longTasks = [];
      new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: true });
    });
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin !== base) return route.abort();
      if (!u.pathname.startsWith('/api/')) return route.continue();
      assert.equal(route.request().method(), 'GET', 'Fixture never writes');
      const p = u.pathname.slice(5);
      const rows = Array.from({ length: 40 }, (_, i) => ({ mint: `PerformanceToken${String(i).padStart(28, '1')}`, name: `Performance coin ${i}`, symbol: `CHECK${i}`, age: 60_000, born: Date.now() - 60_000, live: true, mcap: 10000 + i, holders: 100, buys: 20, sells: 5, dex: 'pumpfun', ai: { rated: true, grade: 'B', score: 80 } }));
      const fixture = p === 'me' ? { member: true } : p === 'pulse' ? { newPairs: rows, running: [], stretch: [], migrated: [], live: { solUsd: 150, tradesPerSec: 20, ai: {} } }
        : p === 'market' ? { btc: { usd: 62000, chg24: 1 }, eth: { usd: 2400, chg24: -1 }, sol: { usd: 150, chg24: 2 } }
        : p === 'paper/wallet' ? { start: 100, cash: 100, equity: 100, pnl: 0, realized: 0, open: 0, trades: 0, unpriced: 0, solUsd: 150 }
        : p === 'x' ? { posts: [] } : p === 'pics' ? { rows: {} } : p === 'account/me' ? { signedIn: false }
        : p === 'discover' ? { trending: [], new: [], top: [], rows: [] } : null;
      return route.fulfill(fixture ? { json: fixture } : { status: 503, json: { error: 'Fixture unavailable' } });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Pulse', exact: true }).waitFor();
    assert.equal(await page.locator('a[href*="github.com"]').count(), 0, 'Terminal must not promote repositories');
    if (width >= 1024) assert.equal(await page.locator('a[href="https://discord.gg/3VWHBP6paA"]').count(), 1, 'Desktop terminal community link uses the live Discord invite');
    await page.waitForTimeout(6500); // Include both old automatic preload paths in the baseline.
    await page.screenshot({ path: path.join(out, `pulse-${width}.png`), fullPage: true });
    const metrics = await page.evaluate(() => ({
      js: performance.getEntriesByType('resource').filter(r => /\.js(?:\?|$)/.test(r.name)).map(r => ({ name: r.name.split('/').pop(), bytes: r.decodedBodySize })),
      mounted: performance.getEntriesByName('blix:mounted')[0]?.startTime,
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
      longTasks: window.__longTasks,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    const totalJs = metrics.js.reduce((s, r) => s + r.bytes, 0);
    report.push({ width, ...metrics, totalJs, requests, errors });
    console.log(JSON.stringify({ width, totalJs, chunks: metrics.js.length, fcp: metrics.fcp, mounted: metrics.mounted, longTasks: metrics.longTasks, errors }));
    assert.deepEqual(errors, []);
    assert.equal(metrics.overflow, false, 'No page overflow');
    if (!baseline) {
      assert.ok(totalJs < 600_000, `Opening Pulse fetched ${totalJs} bytes of JS`);
      assert.ok(!metrics.js.some(r => /^(Coin-|Chart-|Docs-|Account-|Settings-|lightweight-charts|Exchange-|Launcher-|QuickTrade-)/.test(r.name)), 'Unopened pages and tools stay unloaded');
      assert.ok(!requests.some(p => p.startsWith('/api/fomo/board')), 'Unopened trader pages do not warm faces');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('blix:qt:open'))), false, 'Leaving the chart closes saved quick trade without loading its code');
      // A pushed picture must recover immediately even during a failed URL's retry delay.
      await page.evaluate(() => {
        const data = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="green"/></svg>');
        for (let i = 0; i < 40; i += 2) window.__testStream.dispatchEvent(new MessageEvent('pic', { data: JSON.stringify({ mint: `PerformanceToken${String(i).padStart(28, '1')}`, data }) }));
      });
      await page.waitForFunction(() => [...document.querySelectorAll('main img')].some(i => i.src.startsWith('data:image/svg+xml,') && i.complete && i.naturalWidth > 0));
      if (width < 768) assert.ok(!requests.includes('/api/market'), 'Hidden desktop prices do not poll on mobile');
      else {
        await page.waitForFunction(() => ['$62,000', '$2,400', '$150.00'].every(p => document.querySelector('footer')?.textContent.includes(p)));
        const count = requests.filter(p => p === '/api/me').length;
        const imageCount = requests.filter(p => p.startsWith('/img/')).length;
        const xCount = requests.filter(p => p === '/api/x').length;
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.install();
        await page.clock.runFor(31_000);
        assert.equal(requests.filter(p => p === '/api/me').length, count, 'Hidden tab does not ping');
        assert.equal(requests.filter(p => p.startsWith('/img/')).length, imageCount, 'Hidden tab does not retry images');
        assert.equal(requests.filter(p => p === '/api/x').length, xCount, 'Hidden shared poller stops reading');
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.resume();
        await page.waitForResponse(r => new URL(r.url()).pathname === '/api/x');
        const docs = page.waitForResponse(r => /\/Docs-[^/]+\.js$/.test(r.url()));
        await page.getByRole('link', { name: 'API', exact: true }).first().focus();
        await docs;
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => location.hash === '#/api' && document.querySelector('main')?.textContent.includes('API'));
        assert.deepEqual(errors, [], 'Keyboard navigation remains usable');
        await page.getByRole('button', { name: 'Search coins', exact: true }).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('dialog').waitFor();
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, [], 'Search loads on intent and opens');
      }
    }
    await page.close();
  }
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
