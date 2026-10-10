import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
catch { ({ chromium } = require('../../note-overlay/node_modules/playwright')); }
const root = path.resolve(import.meta.dirname, '..');
const baseline = process.argv.includes('--baseline');
const output = process.env.BLIX_PERF_OUT || path.join(root, 'data', baseline ? 'landing-before' : 'landing-after');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'blix.test') return route.abort();
      const file = url.pathname === '/' ? process.env.BLIX_LANDING_SOURCE || path.join(root, 'worker/site/landing.html') : path.join(root, 'worker/public', url.pathname);
      try { await route.fulfill({ contentType: file.endsWith('.html') ? 'text/html' : file.endsWith('.woff2') ? 'font/woff2' : 'image/webp', body: await readFile(file) }); }
      catch { await route.fulfill({ status: 404, body: '' }); }
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await page.goto('http://blix.test/', { waitUntil: 'load' });
    // Isolate resize work from continuous decorative animations.
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
    await page.waitForTimeout(300);
    const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    const before = await metric();
    await page.setViewportSize({ width: width - 10, height: 1000 });
    await page.waitForTimeout(350);
    const after = await metric();
    const layouts = after.LayoutCount - before.LayoutCount;
    await page.mouse.move(width / 2, 400);
    await page.screenshot({ path: path.join(output, `landing-${width}.png`), animations: 'disabled' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    report.push({ width, resizeLayouts: layouts, resizeStyleRecalculations: after.RecalcStyleCount - before.RecalcStyleCount, resizeStyleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000, resizeLayoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000, errors, overflow });
    console.log(JSON.stringify(report.at(-1)));
    assert.deepEqual(errors, []);
    assert.equal(overflow, false);
    if (!baseline) {
      assert.ok(layouts < 20, `Resizing performed ${layouts} layouts`);
      assert.ok(after.RecalcStyleCount - before.RecalcStyleCount < 20, 'Resize must batch geometry reads before style writes');
      assert.equal(await page.locator('#grid > *').count(), 0, 'Decoration does not create hundreds of nodes');
      assert.equal(await page.locator('script:not([type="application/ld+json"])').count(), 0, 'Landing content needs no runtime JavaScript');
      for (const h of await page.locator('h2,h3,h4').all()) await h.isVisible().then(v => assert.ok(v, 'Content stays visible without reveal JS'));
    }
    await page.close();
  }
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
