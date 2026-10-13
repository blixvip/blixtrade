import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
const {chromium}=createRequire(import.meta.url)('../../note-overlay/node_modules/playwright');
const base=process.env.BLIX_URL||'http://127.0.0.1:4421',out='data/tiktok-check';mkdirSync(out,{recursive:true});
const videos=['6718335390845095173','6718335390845095174'].map(id=>'https://www.tiktok.com/@scout2015/video/'+id);
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of (process.env.BLIX_WIDTHS?.split(',').map(Number)||[1440,390,320,768,1024])){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<500});const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.EventSource=class extends EventTarget{close(){}}});
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin==='https://www.tiktok.com')return route.fulfill({contentType:'text/html',body:`<html style="background:#191919;color:white;font-family:Arial"><body style="display:grid;place-content:center;height:90vh;text-align:center"><p>Official-player test fixture</p><p>Video ${u.pathname.split('/').pop()}</p><script>setTimeout(()=>parent.postMessage({'x-tiktok-player':true,type:'onPlayerReady'},'${base}'),200)</script></body></html>`});
  if(u.origin!==base)return route.abort();
  if(process.env.BLIX_ASSETS){const root=resolve(process.env.BLIX_ASSETS),file=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(file.startsWith(root)&&existsSync(file)&&['.html','.js','.css'].includes(extname(file)))return route.fulfill({body:readFileSync(file),contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[extname(file)]});}
  return route.continue();
 });
 await page.route('**/api/**',async route=>{
  assert.equal(route.request().method(),'GET','TikTok never submits trades or account mutations');
  const p=new URL(route.request().url()).pathname;
  return route.fulfill({json:p==='/api/me'?{member:true,email:'panel@example.invalid'}:p==='/api/account/me'?{signedIn:true,email:'panel@example.invalid'}:p.endsWith('/board')?{rows:[],status:{}}:{}});
 });
 await page.goto(base+'/#/traders',{waitUntil:'domcontentloaded'});await page.locator('#boot').waitFor({state:'hidden'});
 const launch=page.getByRole('button',{name:'TikTok',exact:true}),panel=page.getByRole('dialog',{name:'TikTok panel'});
 const settle=()=>panel.evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})))});
 await launch.click();await panel.waitFor();await settle();await page.screenshot({path:`${out}/empty-${width}.png`});
 await panel.getByLabel('Video links').fill('https://tiktok.com.evil.test/@a/video/6718335390845095173');await panel.getByRole('button',{name:'Add to queue',exact:true}).click();await panel.getByRole('alert').waitFor();
 assert.equal(await panel.locator('iframe').count(),0);
 await panel.getByLabel('Video links').fill(videos.join('\n'));await panel.getByRole('button',{name:'Add to queue',exact:true}).click();
 const frame=panel.locator('iframe');await frame.waitFor();await panel.getByText('Loading TikTok…').waitFor({state:'hidden'});
 assert.match(await frame.getAttribute('src'),/6718335390845095173/);
 await panel.getByRole('button',{name:'Next TikTok',exact:true}).click();assert.match(await frame.getAttribute('src'),/6718335390845095174/);
 await panel.getByRole('button',{name:'Previous TikTok',exact:true}).click();assert.match(await frame.getAttribute('src'),/6718335390845095173/);
 await panel.getByRole('checkbox',{name:'Auto-next'}).check();
 await page.evaluate(()=>window.postMessage({'x-tiktok-player':true,type:'onStateChange',value:0},location.origin));
 assert.match(await frame.getAttribute('src'),/6718335390845095173/,'spoofed parent messages ignored');
 let content=await frame.contentFrame();await content.locator('body').evaluate(()=>parent.postMessage({'x-tiktok-player':true,type:'onStateChange',value:0},'*'));
 await page.waitForFunction(()=>document.querySelector('.tt-player iframe')?.src.includes('6718335390845095174'));
 const rail=panel.getByRole('group',{name:'Scroll videos'});await rail.hover();await page.mouse.wheel(0,150);await page.waitForFunction(()=>document.querySelector('.tt-player iframe')?.src.includes('6718335390845095173'));
 await panel.getByText('Loading TikTok…').waitFor({state:'hidden'});
 content=await frame.contentFrame();await content.locator('body').evaluate(()=>parent.postMessage({'x-tiktok-player':true,type:'onPlayerError',value:{errorCode:1001}},'*'));await panel.getByText('This video couldn’t load').waitFor();
 await page.screenshot({path:`${out}/error-${width}.png`});await panel.getByRole('button',{name:'Retry',exact:true}).click();await panel.getByText('This video couldn’t load').waitFor({state:'hidden'});
 const grip=panel.getByRole('button',{name:'Move TikTok panel'}),before=await panel.boundingBox();
 if(width>500){const g=await grip.boundingBox();await page.mouse.move(g.x+60,g.y+20);await page.mouse.down();await page.mouse.move(g.x-180,g.y+80,{steps:8});await page.mouse.up();assert.ok((await panel.boundingBox()).x<before.x-100);}
 else {const cdp=await context.newCDPSession(page),g=await grip.boundingBox(),x=g.x+60,y=g.y+20;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+70,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.ok((await panel.boundingBox()).y>before.y+30);}
 await panel.getByRole('button',{name:'Resize TikTok panel'}).focus();await page.keyboard.press('ArrowUp');
 const saved=await panel.boundingBox();assert.ok(saved.x>=8&&saved.x+saved.width<=width-8);
 await panel.getByText('Loading TikTok…').waitFor({state:'hidden'});await page.screenshot({path:`${out}/playing-${width}.png`});
 if(width<500){const cdp=await context.newCDPSession(page),r=await rail.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-80,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForFunction(()=>document.querySelector('.tt-player iframe')?.src.includes('6718335390845095174'));await panel.getByRole('button',{name:'Previous TikTok',exact:true}).click();}
 await panel.getByRole('button',{name:'Minimize TikTok panel'}).click();assert.equal(await frame.count(),0);assert.equal((await panel.boundingBox()).height,48);
 await panel.getByRole('button',{name:'Expand TikTok panel'}).click();await frame.waitFor();
 await page.evaluate(()=>location.hash='#/coins');await frame.waitFor();
 await panel.getByRole('button',{name:'Close TikTok panel'}).click();await panel.waitFor({state:'hidden'});assert.equal(await page.locator('iframe[src*="tiktok"]').count(),0);
 await page.reload({waitUntil:'domcontentloaded'});await page.locator('#boot').waitFor({state:'hidden'});assert.equal(await panel.count(),0);
 await launch.click();await frame.waitFor();await settle();assert.deepEqual(await panel.boundingBox(),saved);await panel.getByText('1 / 2 videos').waitFor();
 await grip.focus();await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);console.log(`PASS ${width}: URL validation, queue, next/previous, auto-next, origin checks, wheel, errors/retry, drag, keyboard resize, minimize, navigation, persistence, Escape`);
 await context.close();
}}finally{await browser.close();}
