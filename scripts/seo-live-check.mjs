import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PAGES } from '../worker/site/pages.js';
import { PAGE_ALIASES } from '../worker/site/clusters.js';
const origin = 'https://blixvip.com';
const results = [];
for (const path of ['/', ...Object.keys(PAGES)]) {
  const r = await fetch(origin + path, { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
  assert.equal(r.status, 200, path);
  const html = await r.text();
  assert.doesNotMatch(html, /github|git clone|raw\.githubusercontent/i, `${path}: repository promotion`);
  assert.ok(html.includes('https://discord.gg/3VWHBP6paA'), `${path}: Discord invite missing`);
  if (PAGES[path]) assert.ok(html.includes('href="/start">Create account'), `${path}: signup missing`);
  assert.ok(html.includes(`href="${origin}${path}"`), `${path}: canonical missing`);
  if (PAGES[path]) assert.ok(html.includes(`<h1>${PAGES[path].h1}</h1>`), `${path}: wrong deployment`);
  assert.doesNotMatch(html, /name="robots" content="noindex/);
  results.push({ path, status: r.status });
}
const xml = await (await fetch(origin + '/sitemap.xml')).text();
assert.equal((xml.match(/<loc>/g) || []).length, Object.keys(PAGES).length + 1);
for (const path of Object.keys(PAGES)) assert.ok(xml.includes(`<loc>${origin}${path}</loc>`), path);
const robots = await (await fetch(origin + '/robots.txt')).text();
for (const [alias, target] of Object.entries(PAGE_ALIASES)) {
  const response = await fetch(origin + alias, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 301, alias);
  assert.equal(response.headers.get('location'), origin + target, alias);
  assert.ok(!xml.includes(`<loc>${origin}${alias}</loc>`), `alias must not appear in sitemap: ${alias}`);
  results.push({ path: alias, status: response.status, location: response.headers.get('location') });
}
assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
assert.ok(robots.includes('Disallow: /api/'));
for (const [url, status, location] of [
  [origin + '/GUIDES/', 301, origin + '/guides'],
  [origin + '/trade/guides', 301, origin + '/guides'],
  ['https://trade.blixvip.com/guides', 301, origin + '/guides'],
  [origin + '/guides/does-not-exist', 404, null],
  [origin + '/app', 302, origin + '/start'],
]) {
  const r = await fetch(url, { redirect: 'manual', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
  assert.equal(r.status, status, url);
  if (location) assert.equal(r.headers.get('location'), location, url);
  results.push({ path: url, status: r.status, location: r.headers.get('location') });
}
await mkdir(new URL('../data/seo-review/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/seo-review/live-report.json', import.meta.url), JSON.stringify({ checked: new Date().toISOString(), results }, null, 2));
console.log(`Live verified: ${Object.keys(PAGES).length + 1} pages; sitemap, robots, redirects, 404 and signed-out app gate.`);
