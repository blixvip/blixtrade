// Verify chronological Pulse ordering on initial load and refresh, using read-only fixtures.
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
const out = path.join(root, 'data', 'pulse-order-check');
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

const mint = (col, name) => `${col}${name}111111111111111111111111111111`;
let snapshot = 0;
const age = { OLDEST: 5 * 3600_000, MIDDLE: 3600_000, NEWEST: 3 * 60_000, LATEOLD: 6 * 3600_000, FRESH: 30_000 };
const errors = [];
try {
 for (const width of [1440, 390]) {
  snapshot = 0;
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
   localStorage.setItem('blix:role', JSON.stringify('member'));
   localStorage.setItem('blix:pulse:show', JSON.stringify('all'));
   window.EventSource = class extends EventTarget {
    static CLOSED = 2; readyState = 1;
    constructor() { super(); queueMicrotask(() => { this.onopen?.(); this.dispatchEvent(new MessageEvent('hello', {data:'{}'})); }); }
    close() { this.readyState = 2; }
   };
  });
  await page.route('**/*', async route => {
   const u = new URL(route.request().url());
   if (u.origin !== base) return route.abort();
   if (!u.pathname.startsWith('/api/')) return route.continue();
   if (route.request().method() !== 'GET') return route.abort();
   if (u.pathname === '/api/pulse') {
    const rows = col => (snapshot ? ['LATEOLD', 'MIDDLE', 'OLDEST', 'FRESH', 'NEWEST'] : ['OLDEST', 'MIDDLE', 'NEWEST']).map(name => ({mint:mint(col,name), symbol:name, name, age:age[name], mcap:20000, holders:100, top10:10, dev:0, progress:col==='stretch'?0.9:0, graduated:col==='migrated', dex:'pumpfun'}));
    return route.fulfill({json:{newPairs:rows('new'),stretch:rows('stretch'),migrated:rows('migrated'),running:rows('running'),live:{solUsd:150}}});
   }
   if(u.pathname==='/api/me')return route.fulfill({json:{member:true}});
   if(u.pathname==='/api/x')return route.fulfill({json:{posts:[]}});
   if(u.pathname==='/api/market')return route.fulfill({json:{btc:{usd:60000},eth:{usd:3000},sol:{usd:150}}});
   if(u.pathname==='/api/paper/wallet')return route.fulfill({json:{cash:10,equity:10,pnl:0}});
   return route.fulfill({status:503,json:{error:'Not used in this fixture'}});
  });
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Pulse',exact:true}).waitFor();
  await page.locator('button[aria-label="Hide coin"]').first().waitFor({state:'attached'});
  await page.screenshot({path:path.join(out,`before-${width}.png`)});
  const order = async title => page.locator('section').filter({has:page.getByRole('heading',{name:title,exact:true})}).locator('button[aria-label="Hide coin"]').evaluateAll(buttons=>buttons.map(b=>b.parentElement.textContent.match(/LATEOLD|OLDEST|MIDDLE|NEWEST|FRESH/)?.[0]));
  for(const title of ['New Pairs','Final Stretch','Migrated']) assert.deepEqual(await order(title),['NEWEST','MIDDLE','OLDEST'],`${title}: initial order at ${width}px`);
  snapshot = 1;
  await page.clock.install();
  const refreshed = page.waitForResponse(r=>r.url().includes('/api/pulse'));
  await page.clock.runFor(13000);
  await refreshed;
  await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('LATEOLD'));
  await page.clock.resume();
  await page.waitForTimeout(600);
  for(const title of ['New Pairs','Final Stretch','Migrated']) assert.deepEqual(await order(title),['FRESH','NEWEST','MIDDLE','OLDEST','LATEOLD'],`${title}: refreshed order at ${width}px`);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,`sorted-${width}.png`)});
  console.log(`PASS ${width}px: all Pulse columns sorted on load and refresh; old arrivals stay at bottom`);
  await page.close();
 }
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
