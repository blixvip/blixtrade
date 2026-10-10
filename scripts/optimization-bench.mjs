// Paired production-build measurements. No live API access or trading writes.
// BLIX_BENCH_ROOT contains web-before/, web-after/, source-before/worker/site/landing.html.
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
catch { ({ chromium } = require('../../note-overlay/node_modules/playwright')); }
const root = path.resolve(import.meta.dirname, '..');
const out = path.resolve(process.env.BLIX_BENCH_ROOT || path.join(root, 'data/optimization-20261009'));
const repeats = Number(process.env.BLIX_BENCH_RUNS || 5);
const mint = 'So11111111111111111111111111111111111111112';
const rows = Array.from({ length: 40 }, (_, i) => ({ mint: mint.slice(0, -3) + String(i + 111), name: `Performance coin ${i}`, symbol: `CHECK${i}`, age: 60_000, born: Date.now() - 60_000, live: true, mcap: 10000 + i, holders: 100, buys: 20, sells: 5, dex: 'pumpfun', ai: { rated: true, grade: 'B', score: 80 } }));
const fixtures = {
  me: { member: true }, pulse: { newPairs: rows, running: [], stretch: [], migrated: [], live: { solUsd: 150, tradesPerSec: 20, ai: {} } },
  market: { btc: { usd: 62000, chg24: 1 }, eth: { usd: 2400, chg24: -1 }, sol: { usd: 150, chg24: 2 } },
  'paper/wallet': { start: 100, cash: 100, equity: 100, pnl: 0, realized: 0, open: 0, trades: 0, unpriced: 0, solUsd: 150 },
  x: { posts: [] }, pics: {}, 'fomo/known': { rows: [] }, 'account/me': { signedIn: false },
  discover: { trending: [], new: [], top: [], rows: [] }, overview: {},
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
async function serve(variant) {
  const files = new Map();
  const server = http.createServer(async (req, res) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const url = new URL(req.url, 'http://test');
      let body, type, cache = 'no-store';
      if (url.pathname.startsWith('/api/')) {
        const data = fixtures[url.pathname.slice(5)];
        body = Buffer.from(JSON.stringify(data ?? { error: 'Fixture unavailable' })); type = 'application/json';
        if (!data) res.statusCode = 503;
      } else if (url.pathname.startsWith('/img/')) {
        body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="24" fill="#888"/></svg>'); type = 'image/svg+xml'; cache = 'public, max-age=3600';
      } else {
        const folder = url.pathname.startsWith('/_pub/') ? path.join(root, 'worker/public') : path.join(out, `web-${variant}`);
        const file = url.pathname === '/' ? (variant === 'before' ? path.join(out, 'source-before/worker/site/landing.html') : path.join(root, 'worker/site/landing.html')) : path.resolve(folder, '.' + (url.pathname === '/app' ? '/index.html' : url.pathname));
        if (url.pathname !== '/' && !file.startsWith(folder + path.sep)) throw Error('Invalid path');
        if (!files.has(file)) files.set(file, await readFile(file));
        body = files.get(file); type = types[path.extname(file)] || 'application/octet-stream';
        if (!type.startsWith('text/html')) cache = 'public, max-age=3600';
      }
      const compress = /text|json/.test(type);
      res.setHeader('content-type', type); res.setHeader('cache-control', cache);
      if (compress) { body = gzipSync(body); res.setHeader('content-encoding', 'gzip'); }
      res.setHeader('content-length', body.length); res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
await mkdir(out, { recursive: true });
const servers = { before: await serve('before'), after: await serve('after') };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (let run = 0; run < repeats; run++) for (const device of ['desktop', 'mobile']) for (const surface of ['landing', 'terminal']) {
    // Alternate order so warm-up/drift doesn't consistently favor the optimized build.
    for (const variant of run % 2 ? ['after', 'before'] : ['before', 'after']) {
      const ctx = await browser.newContext({ viewport: { width: device === 'mobile' ? 390 : 1440, height: 1000 } });
      await ctx.addInitScript(() => {
        localStorage.setItem('blix:role', JSON.stringify('member'));
        localStorage.setItem('blix:pulse:show', JSON.stringify('all'));
        window.EventSource = class extends EventTarget {
          static CLOSED = 2; readyState = 1;
          constructor() { super(); queueMicrotask(() => { this.onopen?.(); this.dispatchEvent(new MessageEvent('hello', { data: '{}' })); }); }
          close() { this.readyState = 2; }
        };
        window.__audit = { lcp: 0, cls: 0, blockingMs: 0 };
        for (const type of ['largest-contentful-paint', 'layout-shift', 'longtask']) new PerformanceObserver(list => {
          for (const e of list.getEntries()) {
            if (type === 'largest-contentful-paint') __audit.lcp = e.startTime;
            if (type === 'layout-shift' && !e.hadRecentInput) __audit.cls += e.value;
            if (type === 'longtask') __audit.blockingMs += Math.max(0, e.duration - 50);
          }
        }).observe({ type, buffered: true });
      });
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable');
      // Block external analytics/fonts/data equally for both variants without disabling HTTP cache.
      await cdp.send('Network.setBlockedURLs', { urls: ['https://*', 'http://localhost:*'] });
      await cdp.send('Performance.enable');
      if (device === 'mobile') {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
      }
      for (const cache of ['cold', 'warm']) {
        await page.goto(servers[variant].base + (surface === 'landing' ? '/' : '/app'), { waitUntil: 'load', timeout: 60000 });
        if (surface === 'terminal') await page.waitForFunction(() => /CHECK\d/.test(document.querySelector('main')?.textContent || ''));
        await page.waitForTimeout(surface === 'terminal' ? 2000 : 1000);
        const metrics = await page.evaluate(() => {
          const resources = performance.getEntriesByType('resource'), nav = performance.getEntriesByType('navigation')[0];
          return { ...__audit, ttfb: nav.responseStart, mounted: performance.getEntriesByName('blix:mounted')[0]?.startTime ?? null,
            fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
            wireBytes: nav.transferSize + resources.reduce((n, r) => n + r.transferSize, 0),
            jsBytes: resources.filter(r => /\.js(?:\?|$)/.test(r.name)).reduce((n, r) => n + r.decodedBodySize, 0),
            requests: resources.length + 1, dom: document.querySelectorAll('*').length,
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        if (surface === 'landing') {
          const first = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
          for (let i = 0; i < 12; i++) await page.mouse.move(60 + i * 20, 200 + (i % 3) * 15);
          await page.waitForTimeout(400);
          const last = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
          metrics.pointerTaskMs = (last.TaskDuration - first.TaskDuration) * 1000;
        }
        if (run === 0 && cache === 'cold') await page.screenshot({ path: path.join(out, `${surface}-${variant}-${device}.png`), fullPage: surface === 'landing' });
        if (surface === 'terminal') {
          const t = performance.now();
          await page.evaluate(() => { location.hash = '#/api'; });
          await page.waitForFunction(() => location.hash === '#/api' && document.querySelector('main')?.textContent.includes('API'));
          metrics.docsNavigationMs = performance.now() - t;
        }
        assert.deepEqual(errors, [], `${variant} ${surface} browser errors`);
        assert.equal(metrics.overflow, false, `${variant} ${surface} overflow`);
        results.push({ run, device, surface, variant, cache, ...metrics });
      }
      await ctx.close();
    }
    console.log(`Measured ${run + 1}/${repeats} ${device} ${surface}`);
  }
} finally {
  await writeFile(path.join(out, 'measurements.json'), JSON.stringify(results, null, 2));
  await browser.close();
  await Promise.all(Object.values(servers).map(({ server }) => new Promise(resolve => server.close(resolve))));
}
const median = xs => { const sorted = xs.filter(x => typeof x === 'number').sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const summary = [];
for (const device of ['desktop', 'mobile']) for (const surface of ['landing', 'terminal']) for (const cache of ['cold', 'warm']) {
  const match = v => results.filter(r => r.device === device && r.surface === surface && r.cache === cache && r.variant === v);
  const metrics = {};
  for (const key of ['lcp', 'fcp', 'mounted', 'blockingMs', 'wireBytes', 'jsBytes', 'requests', 'dom', 'pointerTaskMs', 'docsNavigationMs']) {
    const before = median(match('before').map(r => r[key])), after = median(match('after').map(r => r[key]));
    if (before != null && after != null) metrics[key] = { before, after, reductionPct: before ? (before - after) / before * 100 : null };
  }
  summary.push({ device, surface, cache, metrics });
}
await writeFile(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
