import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('../../note-overlay/node_modules/playwright');
const base = process.env.BLIX_URL || 'http://127.0.0.1:45425';
const host = process.env.BLIX_ORIGIN_HOST || 'localhost:4421';
const out = new URL('../data/tracker-dock-check/', import.meta.url);
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
    await page.locator('#boot').waitFor({state:'hidden'});
    const main = page.locator('main');
    const full = await main.boundingBox();
    if (!touch) {
      const grip = await handle.boundingBox();
      await page.mouse.move(grip.x+40,grip.y+24); await page.mouse.down();
      await page.mouse.move(1420,200,{steps:12});
      await page.getByText('Release to dock',{exact:true}).waitFor();
      await page.screenshot({path: fileURLToPath(new URL('dock-preview.png',out))});
      await page.mouse.up(); await settle();
      assert.equal(await popup.getAttribute('data-docked'),'true');
      let dock = await bounds(), content = await main.boundingBox();
      assert.equal(Math.round(content.x+content.width),Math.round(dock.x),'docked tracker must not cover page');
      assert.equal(Math.round(full.width-content.width),Math.round(dock.width));
      assert.equal(dock.y,content.y); assert.equal(dock.height,content.height);
      assert.equal(await popup.getAttribute('data-side'),'right');
      await page.screenshot({path: fileURLToPath(new URL('docked-desktop.png',out))});
      await gesture(resize,-80,0); assert.equal((await bounds()).width,dock.width+80);
      await resize.focus(); await page.keyboard.press('Shift+ArrowRight');
      assert.equal((await bounds()).width,dock.width+40);
      await popup.getByRole('button',{name:'Close wallet tracker'}).click(); await settle();
      assert.equal((await main.boundingBox()).width,(await page.locator('#tracker-workspace').boundingBox()).width,'closing restores page width');
      await open(); assert.equal(await popup.getAttribute('data-docked'),'true');
      await page.reload(); await popup.waitFor(); await page.locator('#boot').waitFor({state:'hidden'});
      assert.equal(await popup.getAttribute('data-docked'),'true','dock persists after reload');
      assert.equal((await bounds()).width,dock.width+40,'dock width persists');
      // A real drag from the right bar to the left workspace edge must keep capture.
      const gleft=await handle.boundingBox(), workspace=await page.locator('#tracker-workspace').boundingBox();
      await page.mouse.move(gleft.x+40,gleft.y+24); await page.mouse.down();
      await page.mouse.move(workspace.x+20,180,{steps:15});
      await page.locator('.wt-dock-target[data-side="left"].is-active').waitFor();
      await page.screenshot({path:fileURLToPath(new URL('left-preview.png',out))});
      await page.mouse.up();
      await page.waitForFunction(()=>document.getElementById('wallet-tracker-window').dataset.side==='left');
      assert.ok(await popup.evaluate(e=>e.getAnimations().some(a=>a.playState==='running')),'snap animates');
      await settle();
      let left=await bounds(), mainLeft=await main.boundingBox();
      assert.equal(Math.round(left.x+left.width),Math.round(mainLeft.x),'left bar reserves space beside page');
      assert.equal(Math.round(left.x),Math.round((await page.locator('#tracker-workspace').boundingBox()).x));
      await gesture(resize,40,0);assert.equal((await bounds()).width,left.width+40,'left divider grows to right');
      await resize.focus();await page.keyboard.press('Shift+ArrowLeft');await settle();
      assert.equal((await bounds()).width,left.width,'left keyboard divider shrinks to left');
      await page.screenshot({path:fileURLToPath(new URL('docked-left.png',out))});
      await popup.getByRole('button',{name:'Close wallet tracker'}).click();await open();await settle();
      assert.equal(await popup.getAttribute('data-side'),'left','left choice survives reopen');
      await page.reload();await popup.waitFor();await page.locator('#boot').waitFor({state:'hidden'});await settle();
      assert.equal(await popup.getAttribute('data-side'),'left','left choice survives refresh');
      assert.equal(await popup.getAttribute('data-docked'),'true');
      // Reduced motion keeps the exact behavior with no snap animation.
      await page.emulateMedia({reducedMotion:'reduce'});
      await popup.getByRole('button',{name:'Dock wallet tracker on right'}).click();
      await settle();assert.equal(await popup.evaluate(e=>e.getAnimations().length),0);
      await page.emulateMedia({reducedMotion:'no-preference'});
      // A new interaction interrupts an unfinished snap without trapping the pointer.
      await popup.getByRole('button',{name:'Dock wallet tracker on left'}).click();
      await page.waitForTimeout(40);await gesture(handle,280,80);await settle();
      assert.equal(await popup.getAttribute('data-docked'),'false','interrupted snap can detach');
      await popup.getByRole('button',{name:'Dock wallet tracker on right'}).click();await settle();
      await page.evaluate(()=>location.hash='#/coins');await settle();
      assert.equal(await popup.getAttribute('data-docked'),'true','dock survives navigation');
      await gesture(handle,-260,90);assert.equal(await popup.getAttribute('data-docked'),'false','drag away undocks');
      assert.equal((await main.boundingBox()).width,(await page.locator('#tracker-workspace').boundingBox()).width);
      await popup.getByRole('button',{name:'Dock wallet tracker on right'}).click();
      await page.setViewportSize({width:390,height:844}); await settle(); await fits();
      assert.equal(await popup.getAttribute('data-docked'),'false','narrow screens fall back to floating');
      await page.screenshot({path: fileURLToPath(new URL('dock-mobile-fallback.png',out))});
      await page.setViewportSize(viewport); await settle();assert.equal(await popup.getAttribute('data-docked'),'true','desktop dock restores');
      await popup.getByRole('button',{name:'Undock wallet tracker'}).click();
      const g=await handle.boundingBox();await page.mouse.move(g.x+40,g.y+24);await page.mouse.down();await page.mouse.move(1420,200,{steps:12});
      await handle.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();await settle();
      assert.equal(await popup.getAttribute('data-docked'),'false','cancelled drop does not dock');
    } else {
      assert.equal(await popup.getByRole('button',{name:'Dock wallet tracker on right'}).count(),0);
      await gesture(handle,0,90);await fits();assert.equal(await popup.getAttribute('data-docked'),'false');
    }
    await reset.click(); await fits();
    await handle.focus(); await page.keyboard.press('Escape'); await popup.waitFor({ state: 'hidden' });
    await open(); await popup.waitFor();
    assert.deepEqual(errors, []);
    results.push({ input: touch ? 'touch' : 'mouse', viewport, passed: true });
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await context.close();
    console.log('PASS ' + (touch ? 'mobile floating fallback and touch drag' : 'left/right dock, animations, interruption, reduced motion, dividers, saved side, reload, navigation, cancel') + ', reset, Escape');
  }
  writeFileSync(new URL('result.json', out), JSON.stringify({ checked: new Date().toISOString(), results }, null, 2));
} finally { await browser.close(); }
