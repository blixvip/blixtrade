import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/code/note-overlay/node_modules/playwright');
const dir = path.resolve('data/attention-priority');
const base = process.env.BLIX_LIVE_BASE || 'https://blixvip.com';
const tag = process.env.BLIX_LIVE_BASE ? 'origin' : 'live';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const reports = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [], failures = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) failures.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    const response = await page.goto(`${base}/app#/coin/9stanqrVUsQ2j7KxdEUXCN1EWes2eXi7hSQYJHRBpump`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    let chart = null;
    try {
      await page.waitForFunction(() => Number(document.querySelector('[data-coin-chart]')?.dataset.n) > 0, undefined, { timeout: 25000 });
      chart = await page.locator('[data-coin-chart]').evaluate(el => ({ ...el.dataset }));
    } catch {}
    await page.screenshot({ path: path.join(dir, `${tag}-${width}.png`), fullPage: true });
    reports.push({ width, status: response.status(), title: await page.title(), chart, errors, failures: failures.slice(0, 20), text: chart ? undefined : (await page.locator('body').innerText()).slice(0, 700) });
    await page.close();
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(dir, `${tag}-browser.json`), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports));
