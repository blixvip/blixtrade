import assert from 'node:assert/strict';
import {createRequire} from 'node:module';import {mkdirSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{chromium}=require('../../note-overlay/node_modules/playwright');
const base=process.env.BLIX_URL||'http://127.0.0.1:45427',out='data/coin-live-check';mkdirSync(out,{recursive:true});
const M='BW4oQngRVLWSwfA76Xhm28boPE3rbqomTGMV34Bnpump',N='A'.repeat(32);
const holder={wallet:N,tokens:1e7,pct:1,maxPct:1,boughtSol:.5,soldSol:.2,boughtUsd:50,soldUsd:20,valueUsd:1000,valueSol:10,pnlUsd:70,pnlSol:.7,pnlTokens:1e6,pnlBasis:'usd',realizedSol:null,avgBuyMc:50000,avgSellMc:null,trades:3,first:Date.now()-10000,status:'holding',tag:null,top10:true,label:null,followed:false,fomo:false};
const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
try{for(const width of [1920,390]){
 const page=await browser.newPage({viewport:{width,height:1100}});page.setDefaultTimeout(12000);
 let version=0,txVersion=0,jupFail=false,coinFail=false,knownReady=false;const errors=[],calls={jup:0,coin:0,quote:0,monitor:0};page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('blix:wtrack:float','true');localStorage.setItem('blix:wtrack:tab','"monitor"');localStorage.setItem('blix:wtrack:docked','false')});
 await page.addInitScript(()=>{window.EventSource=class extends EventTarget{static CLOSED=2;readyState=1;constructor(){super();(window.__coinStreams||=[]).push(this);queueMicrotask(()=>this.onopen?.())}close(){this.readyState=2}}});
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==new URL(base).origin)return route.abort();if(process.env.BLIX_ORIGIN_HOST){const response=await route.fetch({headers:{...route.request().headers(),host:process.env.BLIX_ORIGIN_HOST}});return route.fulfill({response})}return route.continue()});
 await page.route('**/api/**',async route=>{
  if(route.request().method()!=='GET'){errors.push(route.request().postData()||route.request().url());return route.fulfill({status:403,json:{error:'Writes disabled in test'}});}const u=new URL(route.request().url()),p=u.pathname.slice(5),mint=p.includes(N)?N:M,now=Date.now();let json={};
  if(p==='me')json={member:true,email:'numbers@fixture.invalid',liveWallets:true};
  else if(p==='account/me')json={signedIn:true,email:'numbers@fixture.invalid',wallet:{sol:5,solUsd:500,tokens:[]}};
  else if(p==='account/txs')json=[{kind:'buy',mint:N,sol:txVersion?.75:.5,tokens:'1000000',status:'confirmed',t:now-1000}];
  else if(p===`wallet-page/${N}`)json={wallet:N,name:'Sync wallet',solUsd:100,sol:5,value:1500,tokensUsd:1000,positions:[{mint:M,symbol:'CNLeaks',amount:1e7,price:.0001,value:1000,mcap:100000,cost:500}],best:[],recent:[],ranks:{},volume:0,tradesRead:2,read:now,updating:false};
  else if(p==='pulse')json={newPairs:[],running:[],stretch:[],migrated:[],live:{solUsd:100,tradesPerSec:1}};
  else if(p==='paper/wallet')json={start:100,cash:99.5,equity:100,pnl:0,realized:0,open:1,trades:1,unpriced:0,solUsd:100};
  else if(p==='paper')json={sizes:[.1,.25,.5,1]};
  else if(p.startsWith('token/'))json={token:{mint,name:mint===M?'The Cartoon Network Leaks':'Second coin',symbol:'CNLeaks',mcap:100000,price:.0001,graduated:true,first_seen:now-3600000},paper:[{id:1,mint,sol:.5,tokens:1000000,mcap0:50000,status:'open',valueSol:1}],verdict:{ok:true},research:{status:'idle'}};
  else if(p===`coin/${mint}`){calls.coin++;if(coinFail)return route.fulfill({status:503,json:{error:'Delayed fixture'}});json={mint,name:'The Cartoon Network Leaks',symbol:'CNLeaks',supply:1e9,solUsd:100,mcUsd:100000,priceUsd:.0001,priceAgeMs:2000,live:true,onCurve:false,traders:[],early:[],holders:null,dev:null,m5:{source:'live',buys:0,sells:0,buyUsd:0,sellUsd:0,volUsd:0,netUsd:0,traders:0},info:{holders:version?600:500,top10:version?12:25,devPct:0,source:'fixture',checked:now,lpLocked:100,safety:99}};}
  else if(p===`jup/${mint}`){calls.jup++;if(jupFail)return route.fulfill({status:503,json:{error:'Delayed fixture'}});const w={chg:version?9:1,buys:version?300:203,sells:198,buyVol:version?10500:9500,sellVol:7200,traders:200,netBuyers:5};json={t:now,mcap:100000,holders:version?600:500,windows:mint===N?null:{'5m':w,'1h':{...w,buys:version?4000:3067},'6h':w,'24h':w}};}
  else if(p===`coin/${mint}/trades`)json={mint,source:'pool',trades:Array.from({length:150},(_,i)=>({t:now-i*1000,side:i%2?'sell':'buy',usd:10,sol:.1,mcUsd:100000,tokens:100000,wallet:N,tx:`tx${i}`,tag:null}))};
  else if(p.endsWith('/fomo'))json={read:now,loading:false,refreshing:false,error:null,signedOut:false,totalHolders:knownReady?1:0,theses:[],holders:knownReady?[{handle:'fixture',name:'Known fixture',wallet:N,amount:1e6,value:100,pnl:50,cost:50,entry:.00005,followers:0}]:[]};
  else if(p.endsWith('/big'))json={mint,trades:[],source:'none'};
  else if(p==='quote'){calls.quote++;json={outTokens:version?2000000:1000000,usdIn:25,spotMcapUsd:100000,avgMcapUsd:100000,route:['fixture']};}
  else if(p.startsWith('candles/') || p.startsWith('tv/bars/')){const tf=Number(u.searchParams.get('tf'))||1;json={mint,rows:Array.from({length:30},(_,i)=>({time:Math.floor(now/1000/tf)*tf-(29-i)*tf,open:100000,high:100000,low:100000,close:100000,value:10})),tf,source:'fixture'};}
  else if(p==='wtrack/monitor'){calls.monitor++;const bag={mint:M,symbol:'CNLeaks',held:1e7,value:1000,unrealized:500,mcap:100000,supply:1e9,priceAt:now-10000,exitable:true,last:now};json={solUsd:100,wallets:[{address:N,name:'Sync wallet',balance:5,pnl:{realized:75,unrealized:500,openValue:1000,closed:1,open:1,trades:2,winRate:1,positions:[bag],valuationPositions:[bag]}}]};}
  else if(p==='metrics')json={coins:[]};else if(p==='wtrack')json={wallets:[{address:N,name:'Sync wallet',grp:1,alerts:1,n24:2}],feed:[],transfers:[],status:{},max:200};
  else if(p==='x')json={posts:[]};else if(p==='pics')json={rows:{}};
  if(p===`coin/${mint}`){json.traders=[holder];json.early=[holder];json.holders={count:500,wallets:500,trades:3,since:now-10000,last:now,genesis:true,partial:false,frozen:false,top10:25,list:[holder],source:'ledger'};}
  return route.fulfill({json});
 });
 const about=page.getByRole('heading',{name:'About The Cartoon Network Leaks'}).locator('../../..');
 const position=page.getByRole('heading',{name:/Your position/}).locator('..');
 const info=page.getByRole('heading',{name:'Token info',exact:true}).locator('../..');
 await page.goto(base+'/#/coin/'+M,{waitUntil:'domcontentloaded'});await page.locator('#boot').waitFor({state:'hidden'});await about.getByText('3,067',{exact:true}).waitFor();
 const flow=page.getByText('5m volume',{exact:true}).locator('../..').locator('..');
 await flow.getByText('203',{exact:true}).waitFor();await flow.getByText('$16.7K',{exact:true}).waitFor();
 if(width>1000){await page.getByText('203 buys',{exact:true}).waitFor();await page.getByText('198 sells',{exact:true}).first().waitFor();assert.equal(await page.getByText('75 buys',{exact:true}).count(),0,'summary never presents truncated rows as full 5m');}
 const emit=(kind,payload)=>page.evaluate(({kind,payload})=>window.__coinStreams.forEach(s=>s.dispatchEvent(new MessageEvent(kind,{data:JSON.stringify(payload)}))),{kind,payload});
 const field=(value,observedAt)=>({value,observedAt,receivedAt:Date.now(),calculatedAt:Date.now(),maxAgeMs:5000,source:'fixture',estimated:false,partial:false,provisional:false});
 const monitor=page.locator('#wallet-tracker-window');await monitor.getByRole('cell',{name:/^\+\$500/}).waitFor();
 const monitorReads=calls.monitor;
 await page.locator('[data-close="100000"]').first().waitFor();
 const synchronized=await page.evaluate(async mint=>{
  const payload={u:[[mint,Date.now(),110000,10,1,12345]]};
  window.__coinStreams.forEach(s=>s.dispatchEvent(new MessageEvent('trade',{data:JSON.stringify(payload)})));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return {header:document.querySelector('b.font-display')?.textContent,monitor:document.querySelector('#wallet-tracker-window')?.textContent};
 },M);
 assert.match(synchronized.header,/110K/,'market cap reads the accepted trade');
 assert.match(synchronized.monitor,/\+\$600/,'wallet PnL agrees in the same observed paint');
 assert.equal(calls.monitor,monitorReads,'no monitor poll needed for price-derived PnL');
 await position.getByText('1.10',{exact:true}).waitFor({timeout:1500}).catch(async e=>{console.log(await page.locator('[data-close]').evaluateAll(xs=>xs.map(x=>({...x.dataset}))));console.log(await position.innerText());throw e});
 await page.locator('[data-spot-estimate]').filter({hasText:'227.3K'}).waitFor({timeout:1500});
 const holderRow=page.locator('tr').filter({has:page.locator(`a[title^="${N}"]`)});
 await holderRow.getByText('$1.1K',{exact:true}).waitFor({timeout:1500});
 await holderRow.getByText('+$80',{exact:true}).waitFor({timeout:1500});
 const calculated={source:'live',buys:250,sells:198,buyUsd:10000,sellUsd:7200,volUsd:17200,netUsd:2800,traders:220};
 const flowTime=Date.now();
 await emit('cflow',{mint:M,t:flowTime,complete:true,flow:calculated});
 await flow.getByText('250',{exact:true}).waitFor({timeout:1500});
 if(width>1000)await page.getByText('250 buys',{exact:true}).waitFor({timeout:1500});
 await emit('cflow',{mint:M,t:flowTime-100,complete:true,flow:{...calculated,buys:999}});
 assert.equal(await flow.getByText('999',{exact:true}).count(),0,'out-of-order totals ignored');
 await emit('cflow',{mint:M,t:Date.now(),complete:false,flow:calculated});
 await flow.getByText('203',{exact:true}).waitFor({timeout:1500});
 await emit('metrics',{boot:100,coins:[{mint:M,revision:1,fields:{mc:field(200000,Date.now()),holders:field(999,Date.now()-60000)}}]});
 await position.getByText('2.00',{exact:true}).waitFor();assert.equal(await info.getByText('999',{exact:true}).count(),0,'stale metric ignored');
 await monitor.getByRole('cell',{name:/^\+\$1.5K/}).waitFor({timeout:1500});
  await page.locator('header.surface').getByText('$0.000200',{exact:true}).waitFor({timeout:1500});
  await page.screenshot({path:`${out}/synced-wallet-${width}.png`});
 await monitor.getByRole('button',{name:'Close wallet tracker'}).click();
 await holderRow.getByText('+$170',{exact:true}).waitFor({timeout:1500});
 knownReady=true;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.getByRole('tab',{name:/Known holders/}).click();
 await page.getByText('@fixture',{exact:true}).waitFor();
 await emit('metrics',{boot:100,coins:[{mint:M,revision:2,fields:{mc:field(200000,Date.now())}}]});
 const knownRow=page.locator('tr').filter({has:page.getByText('@fixture',{exact:true})});
 await knownRow.getByText('+$150',{exact:true}).waitFor({timeout:1500});
 await knownRow.getByText('$50.0K',{exact:true}).waitFor({timeout:1500});
 knownReady=false;
 await page.locator('[data-spot-estimate]').filter({hasText:'125.0K'}).waitFor({timeout:1500});
 await page.getByRole('tab',{name:'Top traders',exact:true}).click();
 await holderRow.getByText('+$170',{exact:true}).waitFor({timeout:1500});
 await emit('cholders',{mint:M,holders:800,top10:18,devPct:0,source:'chain',t:Date.now()});await info.getByText('800',{exact:true}).waitFor();
 version=1;await info.getByText('600',{exact:true}).waitFor();await about.getByText('4,000',{exact:true}).waitFor();await flow.getByText('300',{exact:true}).waitFor();
 await about.getByRole('radio',{name:/5M/}).click();await about.getByText('300',{exact:true}).waitFor();
 assert.ok(calls.jup>=2&&calls.coin>=2,'independent numeric sources refresh');
 await page.screenshot({path:`${out}/numbers-${width}.png`,fullPage:true});
 jupFail=true;await about.getByText('Reconnecting',{exact:true}).waitFor();await about.getByText('300',{exact:true}).waitFor();
 jupFail=false;await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await about.getByText('Reconnecting',{exact:true}).waitFor({state:'hidden'});
 await page.evaluate(m=>location.hash='#/coin/'+m,N);await page.getByRole('heading',{name:'About Second coin'}).waitFor();
 const second=page.getByRole('heading',{name:'About Second coin'}).locator('../../..');assert.equal(await second.getByText('4,000',{exact:true}).count(),0,'coin switch cannot retain previous window stats');
 if(width>1000){await page.evaluate(()=>localStorage.setItem('blix:trade:paper','false'));await page.reload();await page.locator('#boot').waitFor({state:'hidden'});await position.getByText('0.500',{exact:true}).waitFor();txVersion=1;await position.getByText('0.750',{exact:true}).waitFor();}
 await page.evaluate(w=>location.hash='#/trader/'+w,N);
 await page.getByText('Portfolio value',{exact:true}).waitFor();
 await emit('metrics',{boot:100,coins:[{mint:M,revision:3,fields:{mc:field(300000,Date.now())}}]});
 await page.getByText('$3,500.00',{exact:true}).waitFor({timeout:1500});
 await page.getByText('+$2,500.00',{exact:true}).first().waitFor({timeout:1500});
 assert.deepEqual(errors,[]);results.push({width,calls,passed:true});console.log('PASS',width,'synchronized market cap/tracked-wallet PnL, profile totals, shared totals, holders, errors/recovery, coin switch');
 await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
}}finally{await browser.close();writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2))}

