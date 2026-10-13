// Real Discover frontend, deterministic HTTP/SSE edges; no provider calls or credentials.
// Build web first. Optional --baseline records the current failures and before screenshots.
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
const phase = process.argv.includes('--baseline') ? 'before' : 'after';
const out = path.join(root, 'data/discover-metrics', phase);
await mkdir(out, { recursive: true });
const MINT = `${'A'.repeat(31)}B`, UNKNOWN = `${'A'.repeat(31)}C`, SOLANA = 1399811149;
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
    page.setDefaultTimeout(2_000);
    const result = { width, checks: [], failures: [], errors: [], metricsRequests: [] };
    report.push(result);
    page.on('pageerror', error => result.errors.push(error.message));
    const now = Date.now(), observedAt = now - 1_000;
    const rows = [MINT, UNKNOWN].map((mint, i) => ({ mint, name: i ? 'Unknown counts' : 'Discover metrics', symbol: i ? 'UNKNOWN' : 'DISCOVER', image: null, dex: 'pumpfun', pair_created: now - 60_000, first_seen: now - 60_000, mcap: 10000, liquidity: 4000, vol_m5: 1100, vol_h1: 2200, vol_h24: 3300, buys_m5: i ? null : 3, sells_m5: i ? null : 2, buys_h1: i ? null : 8, sells_h1: i ? null : 4, buys_h24: null, sells_h24: null, chg_m5: 1, chg_h1: 2, chg_h24: 3, links: null, boosts: null, header: null, graduated: 0, safety_score: null, score: null, safety: { totalHolders: 100, top10: 10, devPct: 1 }, fees: 0.1, feesSince: now - 60_000 }));
    const fomo = rows.map(row => ({ mint: row.mint, chain: SOLANA, symbol: row.symbol, name: row.name, img: null, price: null, mcap: row.mcap, chg: 3, liq: row.liquidity, vol: row.vol_h24, holders: 100, created: row.pair_created, pad: 'pumpfun', x: null, web: null, tg: null, verified: false }));
    fomo.push({ ...fomo[0], chain: 8453, symbol: 'EXTERNAL', name: 'Base collision', mcap: 88000, vol: 7700, liq: 9900 });
    const hot = rows.map(row => ({ mint: row.mint, ticker: row.symbol, img: null, mc: row.mcap, chain: SOLANA, n: 5, buy: 1500, sell: 300, people: [['Trader', null]], last: now }));
    await page.addInitScript(() => {
      localStorage.setItem('blix:role', JSON.stringify('member'));
      localStorage.setItem('blix:discover:tab', JSON.stringify('new'));
      localStorage.setItem('blix:discover:tf', JSON.stringify('24h'));
      window.EventSource = class extends EventTarget {
        static CLOSED = 2;
        readyState = 1;
        constructor() { super(); window.__discoverStream = this; queueMicrotask(() => { this.onopen?.(); this.dispatchEvent(new MessageEvent('hello', { data: '{}' })); }); }
        close() { this.readyState = 2; }
      };
    });
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin !== base) return route.abort();
      if (!u.pathname.startsWith('/api/')) return route.continue();
      assert.equal(route.request().method(), 'GET', 'Browser check must never write');
      const p = u.pathname.slice(5);
      let fixture;
      if (p === 'metrics') { result.metricsRequests.push(Object.fromEntries(u.searchParams)); fixture = { boot: 100, coins: [] }; }
      else if (p === 'me') fixture = { member: true };
      else if (p === 'pulse') fixture = { newPairs: [], running: [], stretch: [], migrated: [], live: { solUsd: 150, tradesPerSec: 20, ai: {} } };
      else if (p === 'discover') fixture = { tf: u.searchParams.get('tf'), t: now, tabs: Object.fromEntries(['trending', 'surge', 'new', 'bonded'].map(tab => [tab, { rows, total: rows.length }])) };
      else if (p === 'tokens') fixture = { rows, total: rows.length, t: now };
      else if (p === 'fomo/list') fixture = { rows: fomo, t: now, loading: false, signedOut: false, error: null };
      else if (p === 'feed/hot') fixture = { w: Number(u.searchParams.get('w')), since: now - 60_000, top: hot };
      else if (p === 'sparks') fixture = { w: u.searchParams.get('w'), rows: {} };
      else if (p === 'ext-sparks') fixture = { rows: {} };
      else if (p === 'banner') fixture = { header: null };
      else if (p === 'market') fixture = { btc: { usd: 62000, chg24: 1 }, eth: { usd: 2400, chg24: -1 }, sol: { usd: 150, chg24: 2 } };
      else if (p === 'paper/wallet') fixture = { start: 100, cash: 100, equity: 100, pnl: 0, realized: 0, open: 0, trades: 0, unpriced: 0, solUsd: 150 };
      else if (p === 'pics') fixture = { rows: {} };
      else if (p === 'x') fixture = { posts: [] };
      else if (p === 'account/me') fixture = { signedIn: false };
      return route.fulfill(fixture ? { json: fixture } : { status: 503, json: { error: 'Fixture unavailable' } });
    });
    const field = (value, extra = {}) => ({ value, source: 'discover-fixture', observedAt, receivedAt: now, calculatedAt: now, maxAgeMs: 60_000, estimated: false, partial: false, provisional: false, ...extra });
    let revision = 0;
    const emit = async (fields, mint = MINT) => page.evaluate(data => window.__discoverStream.dispatchEvent(new MessageEvent('metrics', { data: JSON.stringify(data) })), { boot: 100, coins: [{ mint, revision: ++revision, fields }] });
    const check = async (name, run) => {
      try { await run(); result.checks.push(name); }
      catch (error) { result.failures.push({ name, error: error.message }); console.error(`${width}: ${name}: ${error.message.split('\n')[0]}`); }
    };
    const rowFor = symbol => page.locator('div.group.cursor-pointer').filter({ has: page.getByText(symbol, { exact: true }) }).first();
    const textIn = async (locator, text) => locator.getByText(text, { exact: true }).first().waitFor({ state: 'visible' });
    try {
      await page.goto(`${base}/#/coins`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Discover', exact: true }).waitFor({ timeout: 8_000 });
      for (const [tab, tf] of [['New pairs', '1h'], ['Bonded', '1h'], ['Trending', '1h'], ['Top', '24h']]) {
        await page.mouse.move(0, 0);
        await page.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: tab, exact: true }).click();
        const row = rowFor('DISCOVER');
        await row.waitFor({ state: 'visible', timeout: 8_000 });
        await page.screenshot({ path: path.join(out, `${tab.replaceAll(' ', '-').toLowerCase()}-${width}-initial.png`), fullPage: true });
        await check(`${tab}: header matches ${tf} transaction window`, () => textIn(page, `Txns ${tf}`));
        await check(`${tab}: missing counts remain unknown`, async () => {
          const unknown = rowFor('UNKNOWN');
          // Unknown buy/sell values must not be rendered as measured zeros.
          const text = await unknown.innerText();
          assert.doesNotMatch(text, /\n0\s*\n\/\s*\n0(?:\n|$)/, text);
        });
        await emit({ mc: field(42000, { estimated: true }), priceUsd: field(0.00084), liq: field(16000, { estimated: true }), vol5m: field(5100), vol1h: field(12000), vol24h: field(27000), buys5m: field(31), sells5m: field(11), buys1h: field(61), sells1h: field(21), buys24h: field(121), sells24h: field(41), holders: field(321), top10: field(12.3), dev: field(0.4), fees: field(0.375, { estimated: true, partial: true }), feesObserved: field(0.125) });
        await check(`${tab}: market cap changes through SSE`, () => textIn(row, '$42.0K'));
        await check(`${tab}: liquidity, volume, holders and fees change through SSE`, async () => {
          await textIn(row, '$16.0K');
          assert.doesNotMatch(await row.innerText(), /≈/, 'No approximation symbols in row numbers');
          await textIn(row, tf === '24h' ? '$27.0K' : '$12.0K');
          await textIn(row, '321'); await textIn(row, '0.375');
        });
        await check(`${tab}: exact counts use the selected window`, async () => {
          await textIn(row, tf === '24h' ? '162' : '82');
          await textIn(row, tf === '24h' ? '121' : '61');
          await textIn(row, tf === '24h' ? '41' : '21');
        });
        await check(`${tab}: open hover card updates every metric and verified price`, async () => {
          // Reset the real hovercard's 300 ms pointer-aim grace before approaching a new cell.
          // Tab changes and horizontal auto-scroll otherwise leave synthetic pointer travel ambiguous.
          await page.getByRole('heading', { name: 'Discover', exact: true }).hover();
          await page.getByRole('dialog', { name: 'DISCOVER details' }).waitFor({ state: 'hidden' });
          await page.waitForTimeout(350);
          await row.getByText('DISCOVER', { exact: true }).hover();
          const card = page.getByRole('dialog', { name: 'DISCOVER details' });
          await card.waitFor({ state: 'visible' });
          await emit({ mc: field(43000), priceUsd: field(0.00086), liq: field(17000, { estimated: true }), [`vol${tf}`]: field(28000), holders: field(432), top10: field(13.2), dev: field(0.7), fees: field(0.625, { estimated: true, partial: true }) });
          await textIn(card, '$28.0K');
          await textIn(card, '$17.0K');
          assert.doesNotMatch(await card.innerText(), /≈/, 'No approximation symbols in card numbers');
          await textIn(card, '432'); await textIn(card, '13.20%'); await textIn(card, '0.70%');
          assert.match(await card.innerText(), /0\.625/);
          assert.match(await card.innerText(), /\$0\.00086(?:0*)?(?:\s|$)/);
          await page.screenshot({ path: path.join(out, `${tab.replaceAll(' ', '-').toLowerCase()}-${width}-hover.png`), fullPage: true });
        });
        await page.mouse.move(0, 0);
        await page.getByRole('dialog', { name: 'DISCOVER details' }).waitFor({ state: 'hidden' });
        if (tab === 'Top') await check('Top: other-chain values isolated from same-address Solana metrics', async () => {
          const external = rowFor('EXTERNAL');
          await textIn(external, '$88.0K');
          assert.doesNotMatch(await external.innerText(), /0\.625|\$43\.0K|432/);
        });
        await page.screenshot({ path: path.join(out, `${tab.replaceAll(' ', '-').toLowerCase()}-${width}-live.png`), fullPage: true });
      }
      await check('Visible Discover coins register batched interest', async () => {
        assert.ok(result.metricsRequests.some(q => q.m?.split(',').includes(MINT) && q.m.split(',').includes(UNKNOWN)));
      });
      await check('Partial buy/sell knowledge is not reported as an exact total', async () => {
        await emit({ buys24h: field(7) }, UNKNOWN);
        const unknown = rowFor('UNKNOWN'), text = await unknown.innerText();
        assert.doesNotMatch(text, /\n7\s*\n7\s*\n\/\s*\n0(?:\n|$)/, text);
        assert.match(text, /7/);
      });
      await page.getByRole('navigation', { name: 'Lists' }).getByRole('button', { name: 'New pairs', exact: true }).click();
      await check('Fixed 1h window keeps metrics and labels consistent', async () => {
        await emit({ vol5m: field(5100), vol1h: field(12000), vol24h: field(27000) });
        await textIn(page, 'Txns 1h');
        const row = rowFor('DISCOVER');
        await textIn(row, '$12.0K'); await textIn(row, '82');
      });
      await check('Count filters match the fixed 1h table', async () => {
        await page.getByRole('button', { name: 'Filters', exact: true }).click();
        const panel = page.getByRole('region', { name: 'Filters' });
        await panel.getByRole('tab', { name: 'Metrics', exact: true }).click();
        await textIn(panel, 'Txns 1h'); await textIn(panel, 'Buys 1h'); await textIn(panel, 'Sells 1h');
        await page.getByRole('button', { name: 'Close filters', exact: true }).click();
      });
      await check('No document-level horizontal overflow', async () => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      });
      await check('No frontend exceptions', async () => assert.deepEqual(result.errors, []));
    } catch (error) { result.failures.push({ name: 'Discover setup/runtime', error: error.stack || String(error) }); }
    finally { await page.close(); }
    console.log(JSON.stringify({ width, passed: result.checks.length, failed: result.failures.length }));
  }
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
assert.equal(report.reduce((sum, result) => sum + result.failures.length, 0), 0, `Discover regression failed; see ${path.join(out, 'report.json')}`);
