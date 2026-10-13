// Render the actual built coin page against captured read-only API fixtures.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/code/note-overlay/node_modules/playwright');
const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'data/chart-audit');
const stage = process.argv[2] || 'blix';
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'data/chart-incident/67cat-after.json')));
const mint = '9stanqrVUsQ2j7KxdEUXCN1EWes2eXi7hSQYJHRBpump';
const coin = fixture[`coin/${mint}`];
const candles = fixture[`candles/${mint}?tf=15`];
const now = Math.floor(Date.now()/15000)*15;
const shift = now - candles.rows.at(-1).time;
candles.rows = candles.rows.map(x => ({...x,time:x.time+shift}));
coin.created = stage === 'tv' ? Date.now()-3*86400000 : Date.now()-2*3600000;
coin.priceUsd = candles.rows.at(-1).close / coin.supply;
const clean = candles.rows;
const corrupt = [...clean].reverse().concat([clean.at(-1),null,{...clean[0],time:null},{...clean[0],time:Date.now()},{...clean[0],high:null},{...clean[0],low:-1}]);
const dist = process.env.BLIX_CHART_DIST || path.join(dir, 'release/web/dist');
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://local');
  const f = path.resolve(dist, '.' + (u.pathname === '/app' || u.pathname === '/' ? '/index.html' : u.pathname));
  if (!f.startsWith(dist + path.sep) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' })[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel:'chrome', headless:true });
  for (const width of [1440,390]) {
    const page = await browser.newPage({ viewport:{width,height:1000} });
    const errors=[]; page.on('pageerror', e => errors.push(e.message));
    let responseMode = "corrupt", candleReads = 0;
    const faults = process.env.BLIX_CHART_FAULTS === "1";
    if (faults) await page.clock.install();
    await page.addInitScript(() => {
      localStorage.setItem('blix:role',JSON.stringify('member'));
      localStorage.setItem('blix:coin:tf','15');
      localStorage.setItem('blix:coin:tvtf','15');
      window.__chartStreams=[];
      window.EventSource = class extends EventTarget { readyState=1; constructor(url){super();this.url=url;window.__chartStreams.push(this);} close(){this.readyState=2;} };
    });
    await page.route('**/*', async route => {
      const u=new URL(route.request().url());
      if(u.hostname==='datapi.jup.ag' && u.pathname.includes('/charts/')) return route.fulfill({json:{candles: responseMode==='empty' ? [] : (responseMode==='corrupt' ? corrupt : clean).map(x=>x && ({...x,volume:x.value}))}});
      if(u.origin!==base && !(['localhost','127.0.0.1'].includes(u.hostname) && u.port===new URL(base).port))return route.abort();
      if(!u.pathname.startsWith('/api/'))return route.continue();
      const key=u.pathname.slice(5)+u.search;
      const token={ mint, name:coin.name, symbol:coin.symbol, first_seen:coin.created, pair_created:coin.created, graduated:1, dex:'pumpswap', price:coin.priceUsd, mcap:coin.priceUsd*coin.supply, liquidity:42000 };
      let data=fixture[key] || fixture[u.pathname.slice(5)];
      if(u.pathname.startsWith('/api/candles/')) { candleReads++; data={...candles,tf:Number(u.searchParams.get('tf'))||15,rows:responseMode==='empty'?[]:responseMode==='corrupt'?corrupt:clean,partial:responseMode==='partial'}; }
      if(u.pathname===`/api/token/${mint}`)data={token,live:{mcap:token.mcap},paper:[]};
      if(u.pathname==='/api/me')data={member:true};
      if(u.pathname==='/api/pulse')data={newPairs:stage==='mini'?[{mint,symbol:coin.symbol,name:coin.name,born:coin.created,mcap:75506,fees:1,vol:5000,liq:42000,holders:644,buys:20,sells:10,progress:.5}]:[],running:[],stretch:[],migrated:[],live:{solUsd:coin.solUsd}};
      if(u.pathname==='/api/market')data={btc:{usd:62000},eth:{usd:2400},sol:{usd:coin.solUsd}};
      if(u.pathname==='/api/account/me')data={signedIn:false};
      return route.fulfill({...data?{json:data}:{status:503,json:{error:'Unavailable fixture'}},headers:{'access-control-allow-origin':base,'access-control-allow-credentials':'true'}});
    });
    if(stage==='mini') {
      await page.goto(`${base}/app#/pulse`,{waitUntil:'domcontentloaded'});
      await page.getByText('67cat',{exact:true}).first().hover();
      const card=page.getByRole('dialog',{name:'Live chart'});
      await card.waitFor({state:'visible'});
      await card.locator('[data-last]').waitFor({timeout:12000}).catch(async e => { await page.screenshot({path:path.join(dir,`mini-failure-${width}.png`),fullPage:true}); console.log(JSON.stringify({errors,candleReads,card:await card.innerText()})); throw e; });
      const mini=card.locator('[data-last]');
      const good=Number(await mini.getAttribute('data-close'));
      assert.ok(good>0); responseMode='empty';
      await page.waitForTimeout(1800);
      assert.equal(Number(await mini.getAttribute('data-close')),good);
      responseMode='clean';
      await page.screenshot({path:path.join(dir,`mini-${width}.png`),fullPage:true});
      await page.mouse.move(0,0); await page.waitForTimeout(350);
      assert.equal(await page.evaluate(()=>window.__chartStreams.filter(s=>s.readyState===1 && s.url.includes('/fast/stream')).length),0,'closing hover releases fast stream');
      assert.deepEqual(errors,[]);
      console.log(JSON.stringify({stage,width,close:good,errors}));
      await page.close(); continue;
    }
    await page.goto(`${base}/app#/coin/${mint}`,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('[data-coin-chart][data-last]',{timeout:30000});
    const chart=page.locator('[data-coin-chart]');
    await page.waitForFunction(() => Number(document.querySelector('[data-coin-chart]')?.dataset.n)>0);
    await page.waitForTimeout(1800);
    if(stage==='blix') assert.equal(await page.getByRole('radio',{name:'5s',exact:true}).count(),1,'first-day coin stays on Blix');
    if (faults) {
      const before = await page.evaluate(() => window.__chartStreams.length);
      await page.clock.fastForward(22_000);
      assert.ok(await page.evaluate(() => window.__chartStreams.length) > before,'silent initial stream must reconnect');
      const value = Number(await chart.getAttribute('data-close'));
      await page.evaluate(({mint}) => {
        const main = window.__chartStreams.findLast(s=>s.readyState===1 && s.url.includes('/api/stream?'));
        for (const data of ['broken json','null','{"u":null}','{}']) main.dispatchEvent(new MessageEvent('trade',{data}));
        for (const old of window.__chartStreams.filter(s=>s.readyState===2)) old.dispatchEvent(new MessageEvent('trade',{data:JSON.stringify({u:[[mint,Date.now(),1e9,1,1,777]]})}));
      },{mint});
      assert.equal(Number(await chart.getAttribute('data-close')),value,'closed streams must be ignored');
      if(stage==='blix') {
        responseMode='partial'; const reads=candleReads;
        await page.waitForTimeout(2200);
        assert.ok(candleReads-reads<15,'partial response loop must be bounded');
        assert.ok(Number(await chart.getAttribute('data-close'))>0);
        responseMode='clean';
      }
    }
    const baseline=Number(await chart.getAttribute('data-close'));
    assert.ok(baseline>0);
    if (process.env.BLIX_CHART_ATTENTION === '1' && stage === 'blix') {
      const fastCount = () => page.evaluate(() => window.__chartStreams.filter(s => s.readyState === 1 && s.url.includes('/fast/stream')).length);
      assert.equal(await fastCount(), 1, 'one shared fast stream for the visible chart');
      let priceRequests = 0;
      const count = request => { if (/\/api\/(candles\/[^w]|chartfocus\/|gecko\/price\/)/.test(request.url())) priceRequests++; };
      page.on('request', count);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(500);
      assert.equal(await fastCount(), 0, 'hidden tab releases its paid stream');
      const hiddenReads = priceRequests;
      await page.waitForTimeout(1600);
      assert.equal(priceRequests, hiddenReads, 'hidden chart makes no price requests');
      assert.equal(Number(await chart.getAttribute('data-close')), baseline, 'hiding preserves the chart');
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(400);
      assert.equal(await fastCount(), 1, 'returning restores exactly one stream');
      await chart.evaluate(el => { el.parentElement.parentElement.style.transform = 'translateY(5000px)'; });
      await page.waitForTimeout(500);
      assert.equal(await fastCount(), 0, 'offscreen chart releases its stream');
      const offscreenReads = priceRequests;
      await page.waitForTimeout(1600);
      assert.equal(priceRequests, offscreenReads, 'offscreen chart makes no price requests');
      await chart.evaluate(el => { el.parentElement.parentElement.style.transform = ''; });
      await page.waitForTimeout(400);
      assert.equal(await fastCount(), 1, 'scrolling back restores stream without remounting chart');
      page.off('request', count);
    }
    await page.evaluate(({mint,now}) => {
      const es=window.__chartStreams.find(s=>s.readyState===1 && s.url.includes('/fast/stream'));
      es?.dispatchEvent(new MessageEvent('trade',{data:JSON.stringify({u:[[mint,now,null,2,1,null],[mint,null,100,1,1,null],[mint,now+120000,999999,1,1,null]]})}));
    },{mint,now:Date.now()});
    assert.equal(Number(await chart.getAttribute('data-close')),baseline);
    if(stage==='blix') {
      responseMode='empty';
      await page.waitForTimeout(2100);
      assert.equal(Number(await chart.getAttribute('data-close')),baseline,'empty read must keep known good chart');
      responseMode='clean';
    }
    // A newer valid trade must render, then a stale poll must leave it alone in TV mode.
    const live=baseline*1.05;
    await page.evaluate(({mint,live})=>{
      const es=window.__chartStreams.find(s=>s.readyState===1 && s.url.includes('/fast/stream')) || window.__chartStreams.find(s=>s.readyState===1 && s.url.includes('/api/stream?'));
      es?.dispatchEvent(new MessageEvent('trade',{data:JSON.stringify({u:[[mint,Date.now(),live,1,1,444444]]})}));
    },{mint,live});
    await page.waitForFunction(n=>Math.abs(Number(document.querySelector('[data-coin-chart]')?.dataset.close)-n)<.01,live,{timeout:8000});
    if(stage==='tv') { await page.waitForTimeout(3500);assert.ok(Math.abs(Number(await chart.getAttribute('data-close'))-live)<.01,'stale poll overwrote live trade'); }
    await page.getByRole('radio',{name:'1m',exact:true}).click();
    await page.waitForTimeout(700);
    await page.getByRole('radio',{name:'15s',exact:true}).click();
    await page.waitForTimeout(700);
    await page.screenshot({path:path.join(dir,`${stage}-${width}.png`),fullPage:true});
    const actual=await page.locator('[data-coin-chart]').evaluate(el=>({...el.dataset}));
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({stage,width,close:actual.close,source:actual.src,rows:actual.n,errors}));
    await page.close();
  }
} finally { await browser?.close(); await new Promise(r=>server.close(r)); }
