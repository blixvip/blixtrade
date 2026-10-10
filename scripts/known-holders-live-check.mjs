import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'file:///C:/code/note-overlay/node_modules/playwright/index.mjs';
// Synthetic, short-lived member proof. Read-only; no Google session, wallet creation or financial actions.
const remote = `const fs=require('node:fs'),c=require('node:crypto'),s=JSON.parse(fs.readFileSync('/opt/blix/data/settings.json'));const email='feed-readonly-check@example.invalid',t=String(Date.now());console.log(JSON.stringify({'x-blix-edge':s.edgeKey,'x-blix-member':email,'x-blix-member-t':t,'x-blix-member-sig':c.createHmac('sha256',s.memberKey).update(email+'.'+t).digest('hex')}));`;
const auth = JSON.parse(execFileSync('ssh', ['-i', 'C:/Users/kaigu/.ssh/model_radar_vm', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'ubuntu@129.146.62.88', 'node'], { input: remote, encoding: 'utf8', windowsHide: true }));
const origin = 'https://origin.blixvip.com';
const get = async path => { try { const r = await fetch(origin + path, { headers: auth, signal: AbortSignal.timeout(20000) }); assert.equal(r.status, 200, path); return await r.json(); } catch (e) { throw Error(`${path}: ${e.message}`); } };

await mkdir('data/known-holders-live', { recursive: true });
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [1440,390]) {
  const context=await browser.newContext({viewport:{width,height:1000}}), page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route(origin+'/**',route=>['GET','HEAD'].includes(route.request().method())?route.continue({headers:{...route.request().headers(),...auth}}):route.abort());
  for(const route of ['coins','']) {
   await page.goto(origin+'/app#/'+route,{waitUntil:'domcontentloaded'});
   if(route==='coins')await page.getByRole('button',{name:'Top',exact:true}).click();
   const stacks=page.locator('[data-known-holders]');
   await stacks.first().waitFor({timeout:30000});
   // Every requested token is read through the real batch endpoint; no fixture faces.
   await page.waitForResponse(r=>r.url().includes('/api/fomo/known?')&&r.status()===200,{timeout:30000});
   if(route==='coins') await page.waitForFunction(()=>[...document.querySelectorAll('[data-known-holders]')].some(el=>el.querySelector('img')),{timeout:45000});
   else await page.waitForTimeout(6000);
   const count=await stacks.count(), pictured=await stacks.locator('img').count();
   const values=await stacks.evaluateAll(els=>els.slice(0,5).map(el=>({mint:el.dataset.knownHolders,label:el.getAttribute('aria-label')})));
   console.log(JSON.stringify({route:route||'pulse',width,rows:count,pictured,sample:values}));
   assert.ok(count>0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:`data/known-holders-live/${route||'pulse'}-${width}.png`});
  }
  assert.deepEqual(errors,[]);await context.close();
 }
}finally{await browser.close();}
