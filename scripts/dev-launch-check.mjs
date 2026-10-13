import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFile,rm,mkdir} from 'node:fs/promises';
import {createServer} from '../web/node_modules/vite/dist/node/index.js';
const {chromium}=createRequire('C:/code/meme-maker/package.json')('playwright');
const root=new URL('../web/',import.meta.url).pathname.replace(/^\/(?:([A-Z]:))/i,'$1');
const entry=new URL('../web/src/dev-launch-review.tsx',import.meta.url), html=new URL('../web/dev-launch-review.html',import.meta.url);
await writeFile(html,'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/dev-launch-review.tsx"></script></body></html>');
await writeFile(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{Launch}from'./pages/Launch';import{Devs}from'./pages/Devs';import{useMe}from'./lib/ui';import{usePulse}from'./lib/pulse';import'./styles/app.css';useMe.setState({me:{signedIn:false}});usePulse.setState(s=>({live:{...s.live,solUsd:108}}));createRoot(document.getElementById('root')!).render(location.hash.includes('devs')?<Devs/>:<Launch/>);`);
const server=await createServer({root,configFile:root+'/vite.config.ts',server:{host:'127.0.0.1',port:4465,strictPort:true}});
let browser;
try{
  await server.listen();
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1060}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const top=Array.from({length:18},(_,i)=>({rank:i+1,wallet:`CreatorWallet${String(i).padStart(3,'0')}Fixture`,name:i===0?'Known creator':null,pic:i===0?'/brand/logos/fomo.png':null,bio:null,x:null,followers:0,launches:3,bonded:2,bondRate:2/3,rugs:0,dead:0,tracked:3,feesSol:300-i*10,feesUsd:32000-i*1000,best:null,coins:[],latest:Date.now(),serial:false}));
  await page.route('**/api/**',route=>{
    const p=new URL(route.request().url()).pathname;
    if(route.request().method()!=='GET')return route.fulfill({status:405,json:{error:'No writes during review'}});
    if(p==='/api/devs')return route.fulfill({json:{range:'24h',since:0,t:Date.now(),solUsd:108,devs:18,launches:54,top}});
    if(p==='/api/launch/status')return route.fulfill({json:{ai:false,vanity:null}});
    if(p==='/api/account/me')return route.fulfill({json:{signedIn:false}});
    return route.fulfill({json:{wallets:[],posts:[],items:[],top:[],running:[],newPairs:[],live:{solUsd:108}}});
  });
  await mkdir('data/ui-review',{recursive:true});
  await page.goto('http://127.0.0.1:4465/dev-launch-review.html',{waitUntil:'networkidle'});
  const plans=page.getByRole('radiogroup',{name:'Launch plan'});
  await plans.waitFor();
  assert.equal(await plans.getByRole('radio').count(),3);
  assert.equal(await plans.getByRole('radio').nth(0).getAttribute('aria-checked'),'true');
  await page.locator('.launch-plans').screenshot({path:'data/ui-review/launch-plans-wide.png'});
  await plans.getByRole('radio').nth(1).click();
  assert.equal(await plans.getByRole('radio').nth(1).getAttribute('aria-checked'),'true');
  assert.ok((await plans.getByRole('radio').nth(1).textContent()).includes('0.2627'));
  await plans.getByRole('radio').nth(2).click();
  assert.equal(await plans.getByRole('radio').nth(2).getAttribute('aria-checked'),'true');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await plans.getByRole('radio').nth(1).getAttribute('aria-checked'),'true');
  for(const width of [1024,768,390,320]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.locator('.launch-plans').evaluate(el=>el.scrollWidth>el.clientWidth),false,`plans overflow ${width}`);
    if(width===390)await page.locator('.launch-plans').screenshot({path:'data/ui-review/launch-plans-mobile.png'});
  }
  await page.setViewportSize({width:1500,height:1060});
  await page.goto('http://127.0.0.1:4465/dev-launch-review.html?view=devs#devs',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Top devs'}).waitFor();
  await page.getByText('Known creator',{exact:true}).waitFor();
  const colours=await page.locator('img[src="brand/fomo-eyes.png"]').evaluateAll(imgs=>imgs.map(img=>getComputedStyle(img.parentElement).backgroundColor));
  assert.ok(new Set(colours).size>=8,`only ${new Set(colours).size} avatar colours`);
  assert.ok(await page.locator('a[aria-label="View Known creator"] img:not([src="brand/fomo-eyes.png"])').count());
  await page.screenshot({path:'data/ui-review/devs-colours.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: launch pricing, presets, Custom, arrow keys, 320–1500px, known profile retained, varied stable avatars; no runtime errors.');
}finally{await browser?.close();await server.close();await rm(entry,{force:true});await rm(html,{force:true});}
