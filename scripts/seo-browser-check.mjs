import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
registerHooks({ load(url, context, next) { return url.endsWith('.html') ? { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}` } : next(url, context); } });
const { default: worker } = await import('../worker/index.js');
const { PAGES } = await import('../worker/site/pages.js');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
catch { ({ chromium } = require('../../note-overlay/node_modules/playwright')); }
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'data/seo-review'); await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = [];
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    if (!process.argv.includes('--live')) await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.hostname !== 'blixvip.com') return route.abort();
      const r = await worker.fetch(new Request(u, { headers: { accept: 'text/html' } }), {
        REG: { get: async () => null },
        ASSETS: { fetch: async req => { try { const pathname = new URL(req.url).pathname; const body = await readFile(path.join(root, 'worker/public', pathname)); return new Response(body, { headers: { 'content-type': pathname.endsWith('.woff2') ? 'font/woff2' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/png' } }); } catch { return new Response('', { status: 404 }); } } }
      }, { waitUntil(p) { p.catch(() => {}); } });
      await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) });
    });
    for (const target of process.argv.includes('--live') ? ['/api', '/guides', '/compare/solana-terminal-comparison', '/guides/how-to-analyze-meme-coins', '/about'] : process.argv.includes('--baseline') ? ['/api'] : Object.keys(PAGES)) {
      await page.goto(`https://blixvip.com${target}`, { waitUntil: 'load' });
      assert.equal(await page.locator('h1').count(), 1, target);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) {
        console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(e => ({tag:e.tagName, cls:e.className, right:e.getBoundingClientRect().right}))));
        await page.screenshot({ path: path.join(out, 'overflow.png'), fullPage: true });
      }
      assert.equal(overflow, false, `${target} ${width}`);
      const broken = await page.locator('img').evaluateAll(imgs => imgs.filter(i => !i.complete || !i.naturalWidth).map(i => i.src));
      assert.deepEqual(broken, [], target);
      assert.deepEqual(errors, [], target);
      if (['/api', '/guides', '/solana-wallet-tracker', '/compare/axiom-alternative', '/create-memecoin', '/compare/solana-terminal-comparison', '/guides/how-to-analyze-meme-coins', '/about'].includes(target)) {
        const name = `${target.slice(1).replaceAll('/', '-')}-${width}${process.argv.includes('--baseline') ? '-before' : ''}${process.argv.includes('--live') ? '-live' : ''}`;
        await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
        await page.screenshot({ path: path.join(out, `${name}-viewport.png`) });
      }
      report.push({ path: target, width, overflow, errors: [...errors] });
    }
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2));
console.log(`Checked ${report.length} page/viewport combinations. Screenshots: ${out}`);
