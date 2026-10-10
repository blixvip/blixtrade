// Real built coin rows with read-only API fixtures; wide/narrow screenshots and holder-state checks.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'file:///C:/code/note-overlay/node_modules/playwright/index.mjs';
const root = path.resolve(import.meta.dirname, '..'), dist = path.join(root, 'web/dist'), out = path.join(root, 'data/known-holders-check');
await mkdir(out, { recursive: true });
const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://local').pathname, file = path.resolve(dist, '.' + (p === '/' ? '/index.html' : p));
    if (!file.startsWith(dist + path.sep)) throw Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': ({ '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp' })[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({channel:'chrome',headless:true});
const mints = ['A','B','C','D','E'].map(s => s.repeat(32));
const names = ['HEEHAW','CLAUDIA','CYBERLEEK','AnyPS5','LONGCOINNAME'];
const rows = mints.map((mint,i) => ({ mint, symbol:names[i], name:['Justice for HeeHaw','Claudia','CyberLeek','AnyPS5','A very long coin name for overflow testing'][i], image:null, dex:'pumpfun', pair_created:Date.now()-3600000, first_seen:Date.now()-3600000, mcap:400000, liquidity:60000, vol_h1:28000, buys_h1:120, sells_h1:80, chg_h1:12, spark:[1,2,1,3,2,4,5], safety:{totalHolders:2000,top10:12,devPct:0}, graduated:1, safety_score:90 }));
const pic = color => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="${color}"/><circle cx="24" cy="19" r="9" fill="#efd7b5"/><ellipse cx="24" cy="46" rx="18" ry="17" fill="#23232b"/></svg>`);
const faces = [['alice',pic('#718da7'),500],['bob',pic('#9c7b66'),300],['charlie','https://invalid.example/avatar.png',200]];
let state = 'ready', knownRequests = [];
try {
 for (const width of [1440,2560,390]) {
  const page = await browser.newPage({viewport:{width,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('blix:role', JSON.stringify('member'));
    localStorage.setItem('blix:pulse:show', JSON.stringify('all'));
    window.EventSource = class extends EventTarget { static CLOSED=2; readyState=1; constructor(){super();queueMicrotask(()=>this.onopen?.());} close(){this.readyState=2;} };
  });
  await page.route('**/*',async route => {
    const u=new URL(route.request().url());
    if(u.origin!==base)return route.abort();
    if(!u.pathname.startsWith('/api/'))return route.continue();
    if(route.request().method()!=='GET')return route.abort();
    if(u.pathname==='/api/fomo/known') {
      knownRequests.push(u.searchParams.get('tokens'));
      if(state==='error')return route.fulfill({status:503,json:{error:'Temporary outage'}});
      const all = state==='waiting' ? {} : {[mints[0]]:[12,faces], [mints[1]]:[1,faces.slice(0,1)], [mints[2]]:[0,[]], [mints[4]]:[3,faces]};
      return route.fulfill({json:all});
    }
    if(u.pathname==='/api/discover')return route.fulfill({json:{tf:'1h',t:Date.now(),tabs:Object.fromEntries(['trending','surge','new','bonded'].map(k=>[k,{rows,total:rows.length}]))}});
    if(u.pathname==='/api/tokens')return route.fulfill({json:{rows,total:rows.length}});
    if(u.pathname==='/api/fomo/list')return route.fulfill({json:{rows:rows.map(r=>({...r,chain:1399811149,img:null,created:r.pair_created,holders:2000})),t:Date.now(),loading:false}});
    if(u.pathname==='/api/pulse')return route.fulfill({json:{newPairs:rows.map(r=>({...r,age:60000,holders:2000,top10:12,dev:0,vol:28000,liq:60000,progress:0.5})),stretch:rows.map(r=>({...r,age:60000,progress:0.9})),migrated:rows.map(r=>({...r,age:60000,graduated:true})),running:[],live:{solUsd:150}}});
    if(u.pathname==='/api/me')return route.fulfill({json:{member:true}});
    if(u.pathname==='/api/x')return route.fulfill({json:{posts:[]}});
    if(u.pathname==='/api/market')return route.fulfill({json:{btc:{usd:60000},eth:{usd:3000},sol:{usd:150}}});
    if(u.pathname==='/api/paper/wallet')return route.fulfill({json:{cash:10,equity:10,pnl:0}});
    return route.fulfill({status:503,json:{error:'Not used'}});
  });
  for(const route of ['coins','']) {
    state='ready';knownRequests=[];
    await page.goto(base+'/#/'+route,{waitUntil:'domcontentloaded'});
    const stack=page.locator(`[data-known-holders="${mints[0]}"]`).first();
    await page.waitForFunction(m=>document.querySelector(`[data-known-holders="${m}"]`)?.textContent.includes('+9'),mints[0]);
    assert.equal(await stack.locator('img').count(),3);
    assert.match(await stack.getAttribute('aria-label'),/12 known holders/);
    assert.equal(await page.locator(`[data-known-holders="${mints[1]}"]`).first().locator('img').count(),1);
    assert.equal((await page.locator(`[data-known-holders="${mints[2]}"]`).first().innerText()).trim(),'0');
    assert.equal((await page.locator(`[data-known-holders="${mints[3]}"]`).first().innerText()).trim(),'—');
    for(let i=0;i<30&&!knownRequests.length;i++)await page.waitForTimeout(100);
    assert.ok(knownRequests.some(x=>x?.includes(mints[0])&&x.includes(mints[4])), 'All visible rows batched, including migrated');
    await page.keyboard.press('Tab');await stack.focus();await page.getByRole('tooltip').filter({hasText:'Largest positions'}).waitFor();
    await page.mouse.move(width-5,950);await page.locator('h1').click();
    await page.screenshot({path:path.join(out,`${route||'pulse'}-${width}.png`)});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No page overflow');
    const boxes=await stack.evaluate(el=>{const row=el.closest('[role="link"]'),a=el.getBoundingClientRect(),b=row.getBoundingClientRect();return {left:a.left,right:a.right,rowLeft:b.left,rowRight:b.right};});
    assert.ok(boxes.left>=boxes.rowLeft && boxes.right<=boxes.rowRight,'Avatars fit coin row');
    if(route==='coins') {
      for(const tab of ['Top','Most held','Trending','Surge','New pairs','Bonded']) {
        const button=page.getByRole('button',{name:tab,exact:true});
        if(!await button.count())continue;
        await button.click();await stack.waitFor({state:'attached'});
      }
    }
    if(width===1440 && route==='coins') {
      await page.clock.install();
      state='waiting'; await page.clock.runFor(5500);
      await page.waitForFunction(m=>document.querySelector(`[data-known-holders="${m}"]`)?.getAttribute('aria-label')==='Known holders unavailable',mints[0]);
      state='ready'; await page.clock.runFor(5500);
      await page.waitForFunction(m=>document.querySelector(`[data-known-holders="${m}"]`)?.textContent.includes('+9'),mints[0]);
      state='error'; await page.clock.runFor(5500);
      assert.match(await stack.innerText(), /\+9/, 'Temporary errors keep the last reading');
      state='ready'; await page.clock.resume();
    }
    console.log(`PASS ${route||'pulse'} ${width}px: three faces, +remainder, zero/unknown, batch requests, keyboard tooltip, no overflow`);
  }
  assert.deepEqual(errors,[]);await page.close();
 }
} finally {await browser.close();await new Promise(r=>server.close(r));}
