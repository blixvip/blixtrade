import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
registerHooks({ load(url, context, next) {
  return url.endsWith('.html') ? { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}` } : next(url, context);
} });
const { default: worker } = await import('../worker/index.js');
const { PAGES } = await import('../worker/site/pages.js');
const { PUBLIC_PATHS, SITEMAP } = await import('../worker/site/seo.js');
const { TOPIC_CLUSTERS, PAGE_TOPIC, PAGE_ALIASES } = await import('../worker/site/clusters.js');
const env = { REG: { get: async () => null }, API_LIMIT: { limit: async () => ({ success: true }) }, LIMITER: { idFromName: k => k, get: () => ({ fetch: async () => new Response('ok') }) } };
const ctx = { waitUntil(p) { p.catch(() => {}); } };
const get = (path, init = {}) => worker.fetch(new Request(`https://blixvip.com${path}`, { ...init, headers: { accept: 'text/html', ...init.headers } }), env, ctx);

test('all public pages are discoverable, canonical, indexable HTML with valid structured data', async () => {
  assert.ok(PAGES['/guides'], 'browseable guides hub');
  assert.deepEqual(new Set(PUBLIC_PATHS), new Set(Object.keys(PAGES)));
  const titles = new Set();
  for (const [path, p] of Object.entries(PAGES)) {
    const r = await get(path); assert.equal(r.status, 200, path);
    const html = await r.text();
    assert.doesNotMatch(html, /github|git clone|raw\.githubusercontent/i, `${path}: public pages must not promote repositories`);
    assert.match(html, /class="site-open[^\"]*" href="\/"/, `${path}: main BLIX action`);
    assert.match(html, /eye-logo\.webp/, `${path}: main site brand`);
    assert.match(html, /href="\/start">Create account/, `${path}: account signup action`);
    assert.match(html, /href="https:\/\/discord\.gg\/3VWHBP6paA"/, `${path}: community invite`);
    assert.ok(html.includes(`<link rel="canonical" href="https://blixvip.com${path}">`), path);
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, path);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
    assert.equal(new Set(ids).size, ids.length, `${path}: duplicate heading or element IDs`);
    for (const [, fragment] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(fragment), `${path}: broken table-of-contents anchor ${fragment}`);
    assert.ok(!titles.has(p.title), `duplicate title: ${path}`); titles.add(p.title);
    assert.ok(!/noindex/.test(html), path);
    assert.ok(SITEMAP.includes(`<loc>https://blixvip.com${path}</loc>`), path);
    for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const structured = JSON.parse(json);
      assert.ok(!structured['@graph'].some(item => item['@type'] === 'SoftwareApplication' && item.offers), `${path}: do not imply all hosted services and trading are free`);
    }
    for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) {
      const target = href.split(/[?#]/)[0];
      if (target.startsWith('/_pub/')) continue;
      assert.ok(PAGES[target] || ['/', '/app', '/start', '/login', '/llms.txt'].includes(target), `${path}: unknown link ${href}`);
    }
    const head = await get(path, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    const cached = await get(path, { headers: { 'if-none-match': r.headers.get('etag') } }); assert.equal(cached.status, 304);
  }
});

test('homepage and machine-readable site summary contain no repository promotion', async () => {
  for (const path of ['/', '/llms.txt']) {
    const html = await (await get(path)).text();
    assert.doesNotMatch(html, /github|git clone|raw\.githubusercontent/i, path);
    assert.match(html, /https:\/\/discord\.gg\/3VWHBP6paA/, path);
  }
});

test('topic hub and articles form a complete browsable cluster hierarchy', async () => {
  const hub = await (await get('/guides')).text();
  for (const topic of TOPIC_CLUSTERS) {
    assert.ok(hub.includes(`id="${topic.id}"`), topic.id);
    for (const path of topic.pages) {
      assert.ok(PAGES[path], `cluster has missing canonical page: ${path}`);
      assert.ok(hub.includes(`href="${path}"`), `orphan page: ${path}`);
      const html = await (await get(path)).text();
      assert.ok(html.includes(`href="/guides#${topic.id}"`), `missing cluster backlink: ${path}`);
    }
  }
  for (const path of Object.keys(PAGES)) if (!['/guides', '/about', '/tools'].includes(path)) assert.ok(PAGE_TOPIC.has(path), `page needs a primary topic: ${path}`);
});

test('overlapping pages and spelling aliases redirect directly to their canonical cluster resource', async () => {
  for (const [alias, target] of Object.entries(PAGE_ALIASES)) {
    assert.ok(PAGES[target], target);
    assert.ok(!PAGES[alias], alias);
    assert.ok(!SITEMAP.includes(`<loc>https://blixvip.com${alias}</loc>`), alias);
    for (const prefix of ['', '/trade']) {
      const r = await get(`${prefix}${alias.toUpperCase()}/?ref=docs`);
      assert.equal(r.status, 301, alias);
      assert.equal(r.headers.get('location'), `https://blixvip.com${target}?ref=docs`);
    }
  }
});

test('new docs normalize aliases; unknown and private routes remain protected', async () => {
  for (const path of ['/GUIDES/', '/trade/guides']) {
    const r = await get(path); assert.equal(r.status, 301); assert.equal(r.headers.get('location'), 'https://blixvip.com/guides');
  }
  assert.equal((await get('/guides/does-not-exist')).status, 404);
  const privateResponse = await get('/api/account/withdraw', { method: 'POST', headers: { origin: 'https://blixvip.com' } });
  assert.equal(privateResponse.status, 403);
});

test('shared content distinguishes hosted execution from MCP paper tools', async () => {
  const html = await (await get('/api')).text();
  assert.doesNotMatch(html, /Blix never signs a transaction|Not with real money/);
  assert.match(html, /hosted/i);
  const paper = await (await get('/memecoin-paper-trading')).text();
  assert.match(paper, /pool estimates/);
  assert.doesNotMatch(paper, /results track what a real trade would have done|fills every buy and sell at the price a real swap/);
});
