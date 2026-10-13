import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('../../note-overlay/node_modules/playwright');
const base = process.env.BLIX_URL || 'http://127.0.0.1:45425';
const host = process.env.BLIX_ORIGIN_HOST || 'localhost:4421';
const out = new URL('../data/tracker-drag-check/', import.meta.url);
mkdirSync(out, { recursive: true });
const results = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const touch of [false, true]) {
    const viewport = touch ? { width: 390, height: 844 } : { width: 1440, height: 950 };
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
    const page = await context.newPage(), errors = [];
    const cdp = touch ? await context.newCDPSession(page) : null;
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.EventSource = class extends EventTarget { close() {} }; });
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).origin !== new URL(base).origin) return route.abort();
      const response = await route.fetch({ headers: { ...route.request().headers(), host } });
      return route.fulfill({ response });
    });
    await page.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname;
      assert.equal(route.request().method(), 'GET', 'dragging must not mutate accounts or place trades');
      const json = p === '/api/me' ? { member: true, email: 'drag-fixture@example.invalid' }
        : p === '/api/account/me' ? { signedIn: true, email: 'drag-fixture@example.invalid' }
        : p === '/api/wtrack' ? { wallets: [], feed: [], transfers: [], status: { live: true }, max: 200 }
        : p.endsWith('/board') ? { rows: [], status: {} } : {};
      return route.fulfill({ json });
    });
    const popup = page.getByRole('dialog', { name: 'Wallet tracker', exact: true });
    const handle = popup.getByRole('button', { name: 'Move wallet tracker', exact: true });
    const resize = popup.getByRole('button', { name: 'Resize wallet tracker', exact: true });
    const reset = popup.getByRole('button', { name: 'Reset tracker position', exact: true });
    const open = () => (touch ? page.getByRole('navigation', { name: 'Pages' }) : page.locator('footer')).getByRole('button', { name: 'Wallets', exact: true }).click();
    const settle = () => page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
    const bounds = async () => { await settle(); return popup.boundingBox(); };
    const gesture = async (target, dx, dy, cancel = false) => {
      const grip = await target.boundingBox(), x = grip.x + Math.min(40, grip.width / 2), y = grip.y + grip.height / 2;
      if (process.env.DRAG_DEBUG) console.log('grip', await target.getAttribute('aria-label'), {x,y}, await page.evaluate(({x,y}) => { const e=document.elementFromPoint(x,y);return { hit:e?.outerHTML.slice(0,450), font:getComputedStyle(document.documentElement).fontSize }; },{x,y}));
      if (touch) {
        const point = (px, py) => [{ x: px, y: py, id: 1, radiusX: 3, radiusY: 3, force: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x + dx * i / 8, y + dy * i / 8) });
        await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
      }
      await settle();
    };
    const fits = async () => {
      const b = await bounds(), v = page.viewportSize();
      assert.ok(b.x >= 7 && b.y >= 7, 'top-left controls stay on screen');
      assert.ok(b.x + b.width <= v.width - 7 && b.y + b.height <= v.height - 48, 'window avoids screen edges and footer');
      return b;
    };
    await page.goto(base + '/#/traders', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Leaderboard' }).waitFor();
    await open(); await popup.waitFor();
    const initial = await bounds();
    await popup.screenshot({ path: fileURLToPath(new URL(touch ? 'touch-before.png' : 'mouse-before.png', out)) });
    await gesture(handle, touch ? 0 : -220, 90);
    const moved = await bounds();
    assert.equal(moved.y, initial.y + 90, 'title drag follows pointer vertically');
    if (!touch) assert.equal(moved.x, initial.x - 220, 'title drag follows pointer horizontally');
    await page.mouse.move(25, 25); await settle();
    assert.deepEqual(await bounds(), moved, 'released popup does not stick to pointer');
    await popup.getByRole('button', { name: 'Close wallet tracker' }).click(); await open();
    assert.deepEqual(await bounds(), moved, 'drop persists after close and reopen');
    await page.reload(); await popup.waitFor(); await page.locator("#boot").waitFor({ state: "hidden" });
    assert.deepEqual(await bounds(), moved, 'drop persists after reload');
    await gesture(resize, touch ? 0 : -90, -80);
    const shrunk = await bounds();
    if (process.env.DRAG_DEBUG) console.log('resize', {moved,shrunk}, await page.evaluate(()=>localStorage.getItem('blix:wtrack:box')));
    assert.equal(shrunk.height, moved.height - 80, 'corner drag resizes height');
    if (!touch) assert.equal(shrunk.width, moved.width - 90, 'corner drag resizes width');
    await gesture(resize, touch ? 0 : 45, 40);
    assert.equal((await bounds()).height, shrunk.height + 40, 'resize grows again');
    if (touch) {
      await gesture(handle, 0, 25, true);
      const cancelled = await bounds();
      await gesture(handle, 0, -20);
      assert.equal((await bounds()).y, cancelled.y - 20, 'a cancelled touch does not trap later drags');
    } else {
      await gesture(handle, -2000, -2000); assert.equal(await popup.getAttribute('data-side'), 'left'); assert.equal(await popup.getAttribute('data-docked'), 'true');
      await reset.click(); await settle();
      await gesture(handle, 2500, 2000); assert.equal(await popup.getAttribute('data-docked'), 'true', 'dropping at the right edge docks');
      await reset.click(); await settle();
      await resize.focus(); await page.keyboard.press('Shift+ArrowLeft');
      assert.equal((await bounds()).width, initial.width - 40, 'keyboard resize works');
      await page.setViewportSize({ width: 390, height: 650 }); await fits();
      await page.setViewportSize(viewport); await fits();
    }
    await reset.click();
    assert.deepEqual(await bounds(), initial, 'reset restores a usable size and position');
    await fits();
    await popup.screenshot({ path: fileURLToPath(new URL(touch ? 'touch-after.png' : 'mouse-after.png', out)) });
    await handle.focus(); await page.keyboard.press('Escape'); await popup.waitFor({ state: 'hidden' });
    await open(); await popup.waitFor();
    assert.deepEqual(errors, []);
    results.push({ input: touch ? 'touch' : 'mouse', viewport, passed: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close();
    console.log('PASS ' + (touch ? 'touch drag/cancel/resize' : 'mouse drag/drop/resize/edges') + ', reopen, reload, reset, Escape');
  }
  writeFileSync(new URL('result.json', out), JSON.stringify({ checked: new Date().toISOString(), results }, null, 2));
} finally { await browser.close(); }
