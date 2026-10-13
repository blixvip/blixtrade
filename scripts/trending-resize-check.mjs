import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {createServer} from '../web/node_modules/vite/dist/node/index.js';
const {chromium}=createRequire('C:/code/meme-maker/package.json')('playwright');
const live=process.env.TRENDING_CHECK_URL;
const server=live ? null : await createServer({root:new URL('../web/',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'),server:{host:'127.0.0.1',port:4466,strictPort:true}});
let browser;
try {
  await server?.listen();
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>r.request().method()==='GET'?r.continue():r.abort());
  await page.goto(`${live || 'http://127.0.0.1:4466'}/#/devs`,{waitUntil:'domcontentloaded'});
  const open=()=>page.getByRole('button',{name:'Trending',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Trending',exact:true});
  await open();
  await page.waitForTimeout(250);
  const grip=page.getByRole('button',{name:'Resize Trending panel'});
  const before=await panel.boundingBox(), g=await grip.boundingBox();
  await page.mouse.move(g.x+g.width/2,g.y+g.height/2);
  await page.mouse.down();await page.mouse.move(g.x+g.width/2+170,g.y+g.height/2-150,{steps:10});await page.mouse.up();
  const resized=await panel.boundingBox();
  assert.ok(Math.abs(resized.width-before.width-170)<2,'pointer changes width');
  assert.ok(Math.abs(resized.height-before.height+150)<2,'pointer changes height');
  await grip.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
  const keyed=await panel.boundingBox();
  assert.equal(keyed.width,resized.width+10);assert.equal(keyed.height,resized.height+10);
  await panel.getByRole('button',{name:'Close',exact:true}).click();await panel.waitFor({state:'hidden'});
  await open();await page.waitForTimeout(250);
  assert.equal((await panel.boundingBox()).width,keyed.width);
  assert.equal((await panel.boundingBox()).height,keyed.height);
  await page.reload({waitUntil:'domcontentloaded'});await open();await page.waitForTimeout(250);
  assert.equal((await panel.boundingBox()).width,keyed.width);
  assert.equal((await panel.boundingBox()).height,keyed.height);
  await mkdir('data/ui-review',{recursive:true});
  await panel.screenshot({path:'data/ui-review/trending-resized.png'});
  // Dragging the header still works after resizing.
  const b=await panel.boundingBox();
  await page.mouse.move(b.x+90,b.y+12);await page.mouse.down();await page.mouse.move(b.x+10,b.y+42,{steps:5});await page.mouse.up();
  assert.ok((await panel.boundingBox()).x<b.x,'header still moves');
  for(const width of [1024,768]) {
    await page.setViewportSize({width,height:700});await page.waitForTimeout(200);
    const rect=await panel.boundingBox();
    assert.ok(rect && rect.x>=7 && rect.y>=7 && rect.x+rect.width<=width-7 && rect.y+rect.height<=693,`fits ${width}`);
  }
  await panel.screenshot({path:'data/ui-review/trending-narrow.png'});
  await grip.dblclick();assert.equal((await panel.boundingBox()).width,384);
  await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
  assert.deepEqual(errors,[]);
  console.log('PASS: drag resize, keyboard resize, close/reopen + reload persistence, header drag, viewport bounds, reset, Escape; no runtime errors.');
} finally { await browser?.close();await server?.close(); }
