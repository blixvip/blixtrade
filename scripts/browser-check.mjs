// Run against an existing server: node scripts/browser-check.mjs
// Uses isolated browser storage; API writes and external requests never reach the server.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_PATH || 'playwright'); }
catch {
  try { playwright = require('../../note-overlay/node_modules/playwright'); }
  catch { throw new Error('Set PLAYWRIGHT_PATH to an existing Playwright installation.'); }
}
const { chromium } = playwright;
const base = process.env.BLIX_URL || 'http://localhost:4420';
const shots = process.env.BLIX_SCREENSHOTS || await mkdtemp(join(tmpdir(), 'blix-browser-'));
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failures = 0;

async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}

async function fixturePage(width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let mcap = 10000;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405, json: { error: 'Browser checks never write' } });
    if (url.pathname === '/api/pulse') return route.fulfill({ json: {
      newPairs: [{ mint: 'RegressionToken111111111111111111111111111', symbol: 'CHECK', name: 'Regression token', live: true, mcap, age: 60000 }],
      running: [], stretch: [], migrated: [],
      live: { ai: {}, solUsd: 150, feed: true, tradesPerSec: 0, launchesPerMin: 0, running: 0, queued: 0, ratedHour: 0 },
    } });
    if (url.pathname === '/api/paper') return route.fulfill({ json: { summary: { open: 0, todayN: 0 } } });
    return route.fulfill({ status: 503, json: { error: 'Not needed by this fixture' } });
  });
  await page.addInitScript(() => {
    // This page owns fresh temporary storage, never the user's browser profile.
    localStorage.setItem('pulse:pf:slots', JSON.stringify([{ new: { noSlop: false } }, {}, {}]));
    window.EventSource = class extends EventTarget {
      constructor() { super(); window.__testStream = this; }
      close() {}
      emit(type) { const event = new Event(type); this.dispatchEvent(event); if (type === 'error') this.onerror?.(event); }
    };
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#pcol-new .pr').waitFor();
  return { page, errors, setMcap: value => { mcap = value; } };
}

async function tradeFixture() {
  const page = await browser.newPage();
  const errors = [], held = [];
  let posts = 0, holdQuotes = false;
  page.on('pageerror', error => errors.push(error.message));
  const quote = { outTokens: 1000, usdIn: 40, avgMcapUsd: 10000, spotMcapUsd: 9900, impactPct: 1, minOut: 970, src: 'test curve' };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<div id="trade"></div>' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/paper' && route.request().method() === 'GET') return route.fulfill({ json: {} });
    if (url.pathname === '/api/quote') {
      if (holdQuotes) return new Promise(resolve => held.push(async () => { await route.fulfill({ json: quote }).catch(() => {}); resolve(); }));
      return route.fulfill({ json: quote });
    }
    if (url.pathname === '/api/paper/quoted') {
      posts++;
      return new Promise(resolve => held.push(async () => { await route.fulfill({ status: 409, json: { error: 'Test submission finished' } }).catch(() => {}); resolve(); }));
    }
    return route.fulfill({ status: 503, json: { error: 'Not needed by this fixture' } });
  });
  await page.goto(base);
  await page.evaluate(async () => {
    const { mountPanel } = await import('/trade.js');
    mountPanel(document.querySelector('#trade'), { token: { mint: 'RegressionToken111111111111111111111111111', symbol: 'CHECK' }, paper: [] });
  });
  await page.waitForFunction(() => document.querySelector('#tpGo')?.disabled === false);
  await page.waitForTimeout(100);
  return { page, errors, posts: () => posts, holdQuotes: () => { holdQuotes = true; }, release: async () => { holdQuotes = false; for (const complete of held.splice(0)) await complete(); } };
}

try {
  for (const width of [390, 1440]) await check(`Pulse controls fit at ${width}px`, async () => {
    const { page, errors } = await fixturePage(width);
    try {
      await page.screenshot({ path: join(shots, `pulse-${width}.png`), fullPage: true });
      const layout = await page.evaluate(() => {
        const grid = document.querySelector('.pulse.four');
        const clipped = [...grid.querySelectorAll('header input, header select, header button')].filter(el => {
          const r = el.getBoundingClientRect(), p = el.closest('.pcol').getBoundingClientRect();
          return r.width < 1 || r.left < p.left - 1 || r.right > p.right + 1 || r.left < -1 || r.right > innerWidth + 1;
        }).map(el => el.id || el.title || el.placeholder);
        return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, clipped, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(layout.columns, width === 390 ? 1 : 2, JSON.stringify(layout));
      assert.deepEqual(layout.clipped, [], 'Column controls must remain inside their column and viewport');
      assert.equal(layout.overflow, false, 'Page must not overflow horizontally');
      assert.deepEqual(errors, [], 'No uncaught browser errors');
    } finally { await page.close(); }
  });

  await check('Stream loss after connection recovers through polling and reconnects', async () => {
    const { page, errors, setMcap } = await fixturePage(1440);
    try {
      await page.evaluate(() => window.__testStream.emit('hello'));
      assert.equal(await page.locator('#live span').textContent(), 'connected');
      await page.evaluate(() => window.__testStream.emit('error'));
      setMcap(25000);
      await page.waitForFunction(() => document.querySelector('#live span')?.textContent.includes('polling'), undefined, { timeout: 12000 });
      await page.waitForFunction(() => document.querySelector('#pcol-new .lv-mc')?.textContent.includes('25'), undefined, { timeout: 5000 });
      await page.evaluate(() => window.__testStream.emit('hello'));
      assert.equal(await page.locator('#live span').textContent(), 'connected');
      assert.deepEqual(errors, [], 'No uncaught browser errors');
    } finally { await page.close(); }
  });

  await check('Changing the trade amount disables submission until its quote arrives', async () => {
    const fixture = await tradeFixture(), { page } = fixture;
    try {
      fixture.holdQuotes();
      await page.locator('[data-tpsolin]').fill('0.5');
      assert.equal(await page.locator('#tpGo').isDisabled(), true, 'Old quote must not authorize a new amount during debounce');
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#tpGo').isDisabled(), true, 'Submission stays disabled while the replacement quote is pending');
      await fixture.release();
      await page.waitForFunction(() => document.querySelector('#tpGo')?.disabled === false);
      assert.deepEqual(fixture.errors, []);
    } finally { await fixture.release(); await page.close(); }
  });

  await check('Quote refresh cannot enable another submission while a paper trade is pending', async () => {
    const fixture = await tradeFixture(), { page } = fixture;
    try {
      await page.locator('#tpGo').click();
      await page.waitForTimeout(2300); // Cross the real quote-refresh interval while the API write is held.
      const disabled = await page.locator('#tpGo').isDisabled();
      await page.locator('#tpGo').evaluate(button => button.click());
      await page.waitForTimeout(100);
      assert.deepEqual({ disabled, submissions: fixture.posts() }, { disabled: true, submissions: 1 });
      assert.deepEqual(fixture.errors, []);
    } finally { await fixture.release(); await page.close(); }
  });

  await check('Settings still renders against an API without the newly added Jupiter secret', async () => {
    const page = await browser.newPage();
    try {
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin || route.request().method() !== 'GET') return route.abort();
        if (url.pathname === '/api/settings') {
          const response = await route.fetch(), data = await response.json();
          if (data.secrets) delete data.secrets.jupiterKey;
          return route.fulfill({ response, json: data });
        }
        return route.continue();
      });
      await page.goto(`${base}/#/settings`, { waitUntil: 'domcontentloaded' });
      await page.locator('#main #sform').waitFor({ timeout: 15000 });
      assert.equal(await page.locator('#s-jupiterKey').count(), 1);
      assert.equal(await page.locator('#s-jupiterKey').inputValue(), '');
    } finally { await page.close(); }
  });

  await check('Quick buys use quotes and block duplicates until the request finishes', async () => {
    const { page, errors } = await fixturePage(1440);
    const requests = [], held = [];
    await page.route('**/api/paper{,/**}', route => {
      if (route.request().method() !== 'POST') return route.fallback();
      requests.push(new URL(route.request().url()).pathname);
      return new Promise(resolve => held.push(async () => { await route.fulfill({ status: 409, json: { error: 'No route available' } }); resolve(); }));
    });
    try {
      const buy = page.locator('#pcol-new [data-pbuy]').first();
      await buy.evaluate(button => button.click());
      await page.waitForTimeout(1100);
      await buy.evaluate(button => button.click());
      await page.waitForTimeout(100);
      assert.deepEqual(requests, ['/api/paper/quoted']);
      assert.equal(await buy.isDisabled(), true);
      await held.shift()();
      await page.waitForFunction(() => !document.querySelector('#pcol-new [data-pbuy]').disabled);
      assert.deepEqual(errors, []);
    } finally { for (const release of held) await release(); await page.close(); }
  });

  await check('Desk keeps edits through refreshes and labels missing valuations', async () => {
    const { page, errors } = await fixturePage(390);
    let reads = 0;
    const position = { id: 99, mint: 'RegressionToken111111111111111111111111111', symbol: 'CHECK', status: 'open', sol: 1, usd: 100, mcap0: 10000, mcapNow: 10000, t: Date.now(), stale: true, pnl: null, mult: null };
    await page.route('**/api/paper', route => {
      reads++;
      return route.fulfill({ json: { open: [position], closed: [], cost: 3, sizes: [0.25], rule: {}, summary: { open: 1, openUsd: 100, openPnl: null, openUnpriced: 1, todayN: 0, todayWins: 0, allN: 0 } } });
    });
    try {
      await page.locator('[data-pdesk]').first().click();
      await page.locator('[data-prule-tp="99"]').waitFor();
      assert.match(await page.locator('#deskBody').innerText(), /Unavailable/);
      assert.equal(await page.locator('#deskBody .unpriced').evaluate(el => el.scrollWidth <= el.clientWidth), true, 'Valuation status must fit on mobile');
      await page.locator('[data-prule-tp="99"]').fill('2.5');
      const initialReads = reads;
      await page.waitForTimeout(2500);
      assert.ok(reads > initialReads, 'The desk must have refreshed during editing');
      assert.equal(await page.locator('[data-prule-tp="99"]').inputValue(), '2.5');
      assert.equal(await page.locator('[data-prule-tp="99"]').evaluate(el => el === document.activeElement), true);
      await page.locator('[data-prule-tp="99"]').blur();
      await page.waitForTimeout(2500);
      assert.equal(await page.locator('[data-prule-tp="99"]').inputValue(), '2.5', 'Unsaved edits survive after focus leaves');
      const requests = [], held = [];
      await page.route('**/api/paper/99/**', route => {
        requests.push(new URL(route.request().url()).pathname);
        return new Promise(resolve => held.push(async () => { await route.fulfill({ status: 409, json: { error: 'No live price available' } }); resolve(); }));
      });
      await page.locator('[data-psell="99"]').first().click();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('[data-psell="99"]').last().isDisabled(), true);
      await page.locator('[data-psell="99"]').last().evaluate(button => button.click());
      assert.deepEqual(requests, ['/api/paper/99/sellq']);
      await held.shift()();
      await page.waitForFunction(() => !document.querySelector('[data-psell="99"]').disabled);
      await page.screenshot({ path: join(shots, 'desk-390.png'), fullPage: true });
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
} finally {
  await browser.close();
  if (process.env.BLIX_SCREENSHOTS) console.log(`Screenshots: ${shots}`);
  else await rm(shots, { recursive: true, force: true });
}
process.exitCode = failures ? 1 : 0;
