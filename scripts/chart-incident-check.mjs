// Render the actual built coin page against captured read-only API fixtures.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/code/note-overlay/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'data/chart-incident');
const stage = process.argv[2] || 'before';
const fixture = JSON.parse(fs.readFileSync(path.join(dir, stage === 'before' ? '67cat.json' : '67cat-after.json')));
const mint = '9stanqrVUsQ2j7KxdEUXCN1EWes2eXi7hSQYJHRBpump';
const coin = fixture[`coin/${mint}`];
const candles = fixture[`candles/${mint}?tf=15`];
const dist = path.join(root, 'web/dist');
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://local');
  const f = path.resolve(dist, '.' + (u.pathname === '/app' || u.pathname === '/' ? '/index.html' : u.pathname));
  if (!f.startsWith(dist + path.sep) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' })[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel:'chrome', headless:true });
  for (const width of [1440,390]) {
    const page = await browser.newPage({ viewport:{width,height:1000} });
    const errors=[]; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('blix:role',JSON.stringify('member'));
      localStorage.setItem('blix:coin:tf','15');
      window.EventSource = class extends EventTarget { readyState=1; close(){} };
    });
    await page.route('**/*', async route => {
      const u=new URL(route.request().url());
      if(u.origin!==base)return route.abort();
      if(!u.pathname.startsWith('/api/'))return route.continue();
      const key=u.pathname.slice(5)+u.search;
      const token={ mint, name:coin.name, symbol:coin.symbol, first_seen:coin.created, pair_created:coin.created, graduated:1, dex:'pumpswap', price:coin.priceUsd, mcap:coin.priceUsd*coin.supply, liquidity:42000 };
      let data=fixture[key] || fixture[u.pathname.slice(5)];
      if(u.pathname.startsWith('/api/candles/'))data={...candles,partial:false};
      if(u.pathname===`/api/token/${mint}`)data={token,live:{mcap:token.mcap},paper:[]};
      if(u.pathname==='/api/me')data={member:true};
      if(u.pathname==='/api/pulse')data={newPairs:[],running:[],stretch:[],migrated:[],live:{solUsd:coin.solUsd}};
      if(u.pathname==='/api/market')data={btc:{usd:62000},eth:{usd:2400},sol:{usd:coin.solUsd}};
      if(u.pathname==='/api/account/me')data={signedIn:false};
      return route.fulfill(data?{json:data}:{status:503,json:{error:'Unavailable fixture'}});
    });
    await page.goto(`${base}/app#/coin/${mint}`,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('[data-coin-chart][data-last]',{timeout:30000});
    await page.screenshot({path:path.join(dir,`${stage}-${width}.png`),fullPage:true});
    const actual=await page.locator('[data-coin-chart]').evaluate(el=>({...el.dataset}));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({stage,width,close:actual.close,source:actual.src,rows:actual.n,errors}));
    await page.close();
  }
} finally { await browser?.close(); await new Promise(r=>server.close(r)); }
