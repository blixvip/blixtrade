// Production UI smoke test using read-only local API access. Never forwards writes.
// The API service must already be running; this does not start/restart it.
import http from 'node:http';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
catch { ({ chromium } = require('../../note-overlay/node_modules/playwright')); }
const root = path.resolve(import.meta.dirname, '..');
const dist = path.resolve(process.env.BLIX_DIST || path.join(root, 'data/optimization-20261009/web-after'));
const out = path.resolve(process.env.BLIX_PERF_OUT || path.join(root, 'data/optimization-20261009/routes'));
const upstream = process.env.BLIX_READ_API || 'http://127.0.0.1:4421';
await mkdir(out, { recursive: true });
const durations = [], reports = [], refusedWrites = [];
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://test');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      refusedWrites.push(u.pathname); res.writeHead(405, { 'content-type': 'application/json' }); res.end('{"error":"Read-only verification"}'); return;
    }
    if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/img/')) {
      if (u.pathname.includes('stream')) { res.writeHead(503); res.end(); return; }
      const t = performance.now();
      const r = await fetch(upstream + u.pathname + u.search, { signal: AbortSignal.timeout(8000) });
      const body = await r.arrayBuffer();
      durations.push({ path: u.pathname.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, '{mint}'), status: r.status, ms: performance.now() - t, bytes: body.byteLength });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' }); res.end(Buffer.from(body)); return;
    }
    const file = path.resolve(dist, '.' + (u.pathname === '/' ? '/index.html' : u.pathname));
    if (!file.startsWith(dist + path.sep)) throw Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":"Unavailable during verification"}'); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const pulse = await (await fetch(upstream + '/api/pulse')).json();
const mint = (pulse.migrated?.[0] || pulse.newPairs?.[0])?.mint;
const board = await (await fetch(upstream + '/api/fomo/board', { signal: AbortSignal.timeout(8000) })).json().catch(() => ({}));
const handle = (board.rows || board.traders || [])[0]?.handle;
const routes = process.env.BLIX_ROUTES?.split(',') || ['', 'coins', 'feed', 'narratives', 'ai-picks', 'traders', 'x', 'launch', 'account', 'practice', 'settings', 'health', 'api', 'mcp', 'u/performance-test', ...(mint ? [`coin/${mint}`] : []), ...(handle ? [`trader/${encodeURIComponent(handle)}`] : [])];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    await page.addInitScript(() => {
      localStorage.setItem('blix:role', JSON.stringify('owner'));
      localStorage.setItem('blix:trade:paper', JSON.stringify(true));
      window.EventSource = class extends EventTarget { static CLOSED = 2; readyState = 1; close() { this.readyState = 2; } };
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['https://*', 'http://localhost:*'] });
    let errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /TypeError|ReferenceError|Minified React error/.test(m.text())) errors.push(m.text().slice(0, 180)); });
    for (const route of routes) {
      errors = [];
      await page.goto(`${base}/?audit=${encodeURIComponent(route)}#/${route}`, { waitUntil: 'load', timeout: 25000 });
      await page.waitForFunction(() => performance.getEntriesByName('blix:mounted').length > 0);
      await page.waitForTimeout(1800);
      const result = await page.evaluate(() => ({ mounted: performance.getEntriesByName('blix:mounted')[0]?.startTime, elements: document.querySelector('main')?.querySelectorAll('*').length,
        overflow: document.documentElement.scrollWidth > innerWidth, errorCard: document.body.textContent.includes('This page did not load'), visibleRoute: location.hash.split('/')[1] }));
      const name = route.split('/')[0] || 'pulse';
      reports.push({ width, route: name, ...result, errors: [...errors] });
      await page.screenshot({ path: path.join(out, `${name}-${width}.png`) });
      if (route === 'traders') {
        // Contained rows must reveal when scrolled/focused, not disappear below the fold.
        const last = page.locator('main a[href*="trader/"], main a[href*="pump.fun/profile/"]').last();
        if (await last.count()) {
          await last.focus();
          await last.scrollIntoViewIfNeeded();
          if (!await last.isVisible()) throw Error('Last trader cannot be reached');
          await page.screenshot({ path: path.join(out, `traders-bottom-${width}.png`) });
        }
      }
      console.log(`${errors.length || result.errorCard || result.overflow ? 'FAIL' : 'PASS'} ${width} ${name}: ${Math.round(result.mounted)}ms, ${result.elements} elements${errors.length ? ', ' + errors.join('; ') : ''}`);
    }
    await page.close();
  }
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify({ reports, durations, refusedWrites }, null, 2));
  await browser.close();
  await new Promise(ok => server.close(ok));
}
if (reports.some(r => r.errors.length || r.errorCard || r.overflow || !r.elements)) process.exitCode = 1;
