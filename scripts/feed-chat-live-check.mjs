import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'file:///C:/code/note-overlay/node_modules/playwright/index.mjs';
// Synthetic, short-lived member proof. Read-only; no Google session, wallet creation or financial actions.
const remote = `const fs=require('node:fs'),c=require('node:crypto'),s=JSON.parse(fs.readFileSync('/opt/blix/data/settings.json'));const email='feed-readonly-check@example.invalid',t=String(Date.now());console.log(JSON.stringify({'x-blix-edge':s.edgeKey,'x-blix-member':email,'x-blix-member-t':t,'x-blix-member-sig':c.createHmac('sha256',s.memberKey).update(email+'.'+t).digest('hex')}));`;
const auth = JSON.parse(execFileSync('ssh', ['-i', 'C:/Users/kaigu/.ssh/model_radar_vm', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'ubuntu@129.146.62.88', 'node'], { input: remote, encoding: 'utf8', windowsHide: true }));
const origin = 'https://origin.blixvip.com';
const get = async path => { try { const r = await fetch(origin + path, { headers: auth, signal: AbortSignal.timeout(20000) }); assert.equal(r.status, 200, path); return await r.json(); } catch (e) { throw Error(`${path}: ${e.message}`); } };
let first;
for (let i = 0; i < 8; i++) { first = await get('/api/feed/history?limit=20'); if (first.items.length) break; await new Promise(r => setTimeout(r, 1500)); }
assert.ok(first.items.length, 'Production sources provide imported messages');
assert.equal(new Set(first.items.map(x => x.id)).size, first.items.length);
assert.ok(first.items.every((x, i, arr) => !i || x.seq > arr[i - 1].seq));
if (first.hasMore) {
  const older = await get(`/api/feed/history?limit=20&before=${first.before}`);
  assert.ok(older.items.length);
  assert.ok(older.items.at(-1).seq < first.items[0].seq);
  console.log('PASS production cursor history and event ordering');
}
const replay = await get(`/api/feed/history?after=${first.cursor}`);
console.log('PASS production resume cursor');
for (const m of replay.items) { const old = first.items.find(x => x.id === m.id); if (old) assert.equal(m.seq, old.seq); }
const publicResponse = await fetch('https://blixvip.com/api/feed/history', { signal: AbortSignal.timeout(20000) });
assert.ok([401, 403].includes(publicResponse.status), 'Feed history requires membership');
const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
try {
  const response = await fetch(origin + '/api/feed/stream?groups=trades&sources=pump', { headers: auth, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), decoder = new TextDecoder(); let chunk = '';
  for (;;) { const r = await reader.read(); if (r.done) break; chunk = (chunk + decoder.decode(r.value, { stream: true })).slice(-1000000); if (chunk.includes('event: heartbeat')) { console.log('PASS production named SSE heartbeat'); break; } }
  assert.ok(chunk.includes('event: heartbeat')); await reader.cancel();
} finally { clearTimeout(timeout); controller.abort(); }
if (process.argv.includes('--api-only')) process.exit(0);
await mkdir('data/feed-chat-live', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 980 } });
    await context.route(origin + '/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue({ headers: { ...route.request().headers(), ...auth } }) : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/app#/feed', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const log = page.getByRole('log', { name: 'Imported messages' }); await log.waitFor({ timeout: 30000 });
    await page.waitForFunction(() => { const el = document.querySelector('[role="log"]'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 30; });
    await page.getByRole('button', { name: 'Pause feed', exact: true }).click();
    const content = () => log.locator('[data-message-content]').allInnerTexts();
    const held = await content(), scroll = await log.evaluate(el => el.scrollTop);
    await page.waitForTimeout(4000);
    assert.deepEqual(await content(), held, 'Actual source updates cannot mutate paused message contents');
    assert.ok(Math.abs(await log.evaluate(el => el.scrollTop) - scroll) < 2);
    await page.screenshot({ path: `data/feed-chat-live/paused-${width}.png` });
    await log.getByRole('button', { name: /^Open .* details$/ }).last().click();
    await page.getByRole('link', { name: 'Open on pump.fun', exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, '#/feed');
    await page.screenshot({ path: `data/feed-chat-live/token-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS deployed chat, frozen reading, token side panel and responsive layout ${width}px`);
    await context.close();
  }
} finally { await browser.close(); }
