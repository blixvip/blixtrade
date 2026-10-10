import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'file:///C:/code/note-overlay/node_modules/playwright/index.mjs';
const dist = path.resolve('web/dist'), out = path.resolve('data/feed-chat-check');
await mkdir(out, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://local').pathname;
    const file = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(dist + path.sep)) throw Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ channel: 'chrome', headless: true });
const mint = '11111111111111111111111111111111', now = Date.now();
const row = n => ({ id: `pump:${n}`, seq: n, source: 'pump', type: n % 5 ? 'pump_callout' : 'large_buy', t: now - (160 - n) * 15000, timelineAt: now - (160 - n) * 15000, receivedAt: now, user: { name: n % 3 ? 'Dior' : 'Mira', pump: n % 3 ? 'dior' : 'mira', pic: null, verified: true }, ticker: 'GameTape', mint, chain: 1399811149, comment: `Message ${n}: Watching the next move. https://example.com/chart`, mc: 42000, entryMc: 38000, pnlUsd: -20, pnlPct: -4, usd: 1000, side: 'buy', likes: 3, replies: 1, pinned: false });
try {
  for (const width of process.argv.includes('--mobile') ? [390] : [1440, 2560, 390]) {
    let revision = 160, changed = [], olderRequests = 0;
    const rows = Array.from({ length: 160 }, (_, i) => row(i + 1));
    const page = await browser.newPage({ viewport: { width, height: 980 }, reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
    page.setDefaultTimeout(12000); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('blix:role', JSON.stringify('member'));
      window.streams = [];
      window.EventSource = class extends EventTarget {
        static CLOSED = 2; readyState = 1;
        constructor(url) { super(); this.url = url; window.streams.push(this); queueMicrotask(() => { this.onopen?.(); this.dispatchEvent(new Event('open')); }); this.heartbeat = setInterval(() => this.dispatchEvent(new MessageEvent('heartbeat', { data: '{}' })), 5000); }
        close() { this.readyState = 2; clearInterval(this.heartbeat); }
      };
    });
    const notify = () => page.evaluate(() => window.streams.filter(s => s.url.includes('feed/stream')).forEach(s => s.dispatchEvent(new MessageEvent('feed', { data: '{}' }))));
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin !== base) return route.abort();
      if (!u.pathname.startsWith('/api/')) return route.continue();
      if (u.pathname === '/api/feed/history') {
        const before = Number(u.searchParams.get('before')), after = Number(u.searchParams.get('after'));
        if (before) olderRequests++;
        const selected = before ? rows.filter(x => x.seq < before).slice(-80) : after ? (after < revision ? changed : []) : rows.slice(-80);
        return route.fulfill({ json: { items: selected, cursor: revision, before: selected[0]?.seq || before, hasMore: before ? before > 81 : !after, retained: 50000, status: { fomo: { t: now, ready: true }, pump: { t: now, ready: true } } } });
      }
      if (/^\/api\/(token|coin)\//.test(u.pathname)) return route.fulfill({ status: 404, json: { error: 'The radar has never seen this coin.' } });
      const fixtures = {
        '/api/me': { member: true, liveWallets: true }, '/api/account/me': { signedIn: true, hosted: true, name: 'Alex', email: 'alex@example.test', address: mint, wallet: { sol: 0, tokens: [] } },
        '/api/pulse': { newPairs: [], stretch: [], migrated: [], running: [], live: { solUsd: 150 } },
        '/api/paper/wallet': { cash: 10, equity: 10, pnl: 0, open: 0, trades: 0, solUsd: 150 },
        '/api/fomo/feed': { items: [], t: now }, '/api/pump/feed': { items: rows, t: now },
        '/api/feed/hot': { w: 30, since: null, top: [{ mint, ticker: 'GameTape', chain: 1399811149, img: null, mc: 42000, n: 12, people: [], last: now, buy: 0, sell: 0 }] },
      };
      return route.fulfill({ json: fixtures[u.pathname] || {} });
    });
    try {
      await page.goto(base + '/#/feed', { waitUntil: 'domcontentloaded' });
      if (process.argv.includes('--before')) { await page.waitForTimeout(1500); await page.screenshot({ path: path.join(out, `before-${width}.png`) }); continue; }
      const log = page.getByRole('log', { name: 'Imported messages' }); await log.waitFor();
      await page.getByText('Following live', { exact: true }).first().waitFor();
      await log.locator('[data-message-id="pump:160"]').waitFor();
      await page.waitForFunction(() => { const el = document.querySelector('[role="log"]'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 20; });
      assert.ok(await log.locator('[data-message-id]').count() < 60, 'measured virtualization bounds rendered rows');
      await page.screenshot({ path: path.join(out, `live-${width}.png`) });
      await page.getByRole('button', { name: 'Pause feed', exact: true }).click();
      const old = await log.locator('[data-message-id="pump:159"]').innerText();
      changed = [{ ...rows[158], comment: 'Edited while paused' }, row(161), { ...rows[9], comment: 'An old unloaded message was edited' }]; rows[158] = changed[0]; rows.push(changed[1]); rows[9] = changed[2]; revision++;
      await notify();
      await page.getByRole('button', { name: /1 new message.*Jump to live/ }).waitFor();
      assert.equal(await log.locator('[data-message-id="pump:159"]').innerText(), old, 'paused contents are immutable');
      assert.equal(await log.locator('[data-message-id="pump:161"]').count(), 0);
      await page.getByRole('button', { name: /1 new message.*Jump to live/ }).click();
      await log.getByText('Edited while paused', { exact: true }).waitFor();
      await log.locator('[data-message-id="pump:161"]').waitFor();
      await page.getByText('81 loaded', { exact: true }).waitFor();
      assert.equal(await log.locator('[data-message-id="pump:159"]').count(), 1);
      await log.dispatchEvent('wheel', { deltaY: -400 });
      await log.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
      await page.getByText('Reading history', { exact: true }).first().waitFor();
      const anchor = await log.evaluate(el => { const y = el.getBoundingClientRect().top; const row = [...el.querySelectorAll('[data-message-id]')].find(x => x.getBoundingClientRect().bottom > y + 50); return { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - y }; });
      await page.getByRole('button', { name: 'Load older messages', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[data-loading-history="true"]'));
      assert.ok(olderRequests > 0, 'history is fetched using a server cursor');
      await page.waitForFunction(a => { const el = document.querySelector('[role="log"]'), row = document.querySelector(`[data-message-id="${a.id}"]`); return row && Math.abs(row.getBoundingClientRect().top - el.getBoundingClientRect().top - a.offset) < 3; }, anchor);
      await page.getByRole('button', { name: /Jump to live/ }).click();
      await log.getByRole('button', { name: 'Open GameTape details' }).last().click();
      await page.getByRole('heading', { name: 'GameTape', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Open on pump.fun', exact: true }).waitFor();
      assert.equal(new URL(page.url()).hash, '#/feed', 'token details preserve the conversation');
      assert.ok(await log.isVisible());
      await page.screenshot({ path: path.join(out, `token-${width}.png`) });
      await page.getByRole('button', { name: 'Close token details' }).click();
      await page.getByRole('button', { name: 'Fomo filters', exact: true }).click();
      assert.ok(await page.getByRole('checkbox', { name: 'Trades', exact: true }).count() === 1);
      await page.keyboard.press('Escape');
      if (width === 1440) {
        // Reconnecting may replay and edit a known message, but its identity and timeline remain stable.
        changed = [row(161), { ...row(159), t: now + 999999, comment: 'Edited after reconnect' }]; revision++;
        await page.evaluate(() => window.streams.filter(s => s.url.includes('feed/stream')).forEach(s => { s.onerror?.(); s.onopen?.(); }));
        await log.getByText('Edited after reconnect', { exact: true }).waitFor();
        assert.equal(await log.locator('[data-message-id="pump:161"]').count(), 1);
        const ids = await log.locator('[data-message-id]').evaluateAll(nodes => nodes.map(n => n.dataset.messageId));
        assert.ok(ids.indexOf('pump:159') < ids.indexOf('pump:161'), 'edited timestamp cannot move a row');
        changed = [{ ...row(162), id: 'fomo:161', source: 'fomo', type: 'thesis_created' }, { ...row(163), id: 'pump:161:reply:r1', type: 'reply', comment: 'Independent reply', replyTo: { id: 'pump:161', name: 'Dior', text: 'Earlier callout' } }]; revision++;
        await notify(); await log.getByText('Independent reply', { exact: true }).waitFor();
        assert.equal(await log.locator('[data-message-id="pump:161"]').count(), 1);
        assert.equal(await log.locator('[data-message-id="fomo:161"]').count(), 1);
        changed = Array.from({ length: 3500 }, (_, i) => row(i + 200)); revision++;
        await notify(); await page.getByText('3,000 loaded', { exact: true }).waitFor();
        assert.ok(await log.locator('[data-message-id]').count() < 60, '3500 received messages still render a bounded window');
        await page.getByRole('button', { name: 'Focus chat' }).click();
        assert.equal(await page.getByRole('navigation', { name: 'Pages' }).count(), 0);
        await page.screenshot({ path: path.join(out, 'focus-1440.png') });
        await page.getByRole('button', { name: 'Exit focus' }).click();
        const connections = await page.evaluate(() => window.streams.filter(s => s.url.includes('feed/stream')).length);
        await page.evaluate(() => { const now = Date.now; window.restoreClock = () => { Date.now = now; }; Date.now = () => now() + 60000; window.streams.filter(s => s.url.includes('feed/stream')).forEach(s => s.dispatchEvent(new MessageEvent('heartbeat', { data: '{}' }))); });
        await page.waitForTimeout(5200);
        assert.equal(await page.evaluate(() => window.streams.filter(s => s.url.includes('feed/stream')).length), connections, 'a recognized heartbeat keeps a quiet stream connected');
        await page.evaluate(() => window.restoreClock());
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      console.log(`PASS chat identity, pause, follow, history cursor, token fallback, accessibility and layout ${width}px`);
    } catch (e) { console.log(await page.evaluate(() => { const el = document.querySelector('[role="log"]'); return { scroll: el && { top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight, rect: el.getBoundingClientRect().toJSON() }, main: document.querySelector('main')?.scrollTop, rows: [...document.querySelectorAll('[data-message-id]')].slice(-8).map(x => ({ id: x.dataset.messageId, rect: x.getBoundingClientRect().toJSON() })) }; })); await page.screenshot({ path: path.join(out, `failure-${width}.png`) }); throw e; }
    finally { await page.close(); }
  }
} finally { await browser.close(); await new Promise(r => server.close(r)); }
