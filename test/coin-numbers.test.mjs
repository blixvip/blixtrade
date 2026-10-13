import assert from 'node:assert/strict';
import {test} from 'node:test';
import {coinFlow,currentMetric, markHolder, spotTokens, markKnownHolder} from '../web/src/lib/coin-numbers.ts';
const now=100000;
test('holder mark uses only the position covered by its cost basis, not an older whale bag',()=>{
 const h={tokens:1000,pct:1,valueUsd:100,valueSol:1,pnlUsd:5,pnlSol:.05,boughtUsd:50,soldUsd:40,pnlTokens:100,pnlBasis:'usd',realizedSol:.1};
 const x=markHolder(h,.2,200,10000,0);
 assert.equal(x.valueUsd,200);assert.equal(x.valueSol,1);assert.equal(x.pct,10);
 assert.equal(x.pnlUsd,10);assert.equal(x.pnlSol,.05);assert.equal(x.realizedSol,.1);
 assert.equal(h.valueUsd,100,'original snapshot never mutated');
});
test('SOL ledger preserves historical SOL cost and marks USD at the current exchange rate',()=>{
 const h={tokens:100,pnlTokens:100,pnlBasis:'sol',boughtSol:1,soldSol:.25,pnlSol:.25,pnlUsd:25};
 const x=markHolder(h,2,200,1000,0);assert.equal(x.pnlSol,.25);assert.equal(x.pnlUsd,50);
});
test('missing basis never invents profit; stale prices and invalid inputs retain the snapshot',()=>{
 const h={tokens:100,pnlSol:null,pnlUsd:null,valueUsd:10};
 assert.equal(markHolder(h,2,100,1000,0).pnlUsd,null);
 assert.equal(markHolder(h,2,100,1000,31000),h);
 assert.equal(markHolder(h,NaN,100,1000,0),h);
 assert.equal(markHolder({...h,tokens:null},2,100,1000,0).valueUsd,10);
});
test('known holders use token balance and supply instead of an unrelated snapshot market cap',()=>{
 const x=markKnownHolder({amount:100,value:10,pnl:4,cost:6},2000,10000);
 assert.equal(x.value,20);assert.equal(x.pnl,14);assert.equal(x.ret,14/6*100);
 assert.equal(markKnownHolder({amount:null,value:10,pnl:null,cost:null},2000,10000).pnl,null);
});
test('spot estimates calculate immediately, preserve zeros and reject missing or expired prices',()=>{
 assert.equal(spotTokens(25,.01,0),2500);assert.equal(spotTokens(0,.01,0),0);
 for(const p of [0,null,NaN,Infinity])assert.equal(spotTokens(25,p,0),null);
 assert.equal(spotTokens(25,.01,30001),null);
});
const market={t:now,windows:{'5m':{buys:203,sells:198,buyVol:9500,sellVol:7200,traders:200}}};
test('5m cards share complete indexed totals beyond the 150-row display cap',()=>{
 const f=coinFlow(null,market,now);assert.equal(f.buys+f.sells,401);assert.equal(f.volUsd,16700);assert.equal(f.netUsd,2300);
});
test('complete live flow takes priority and stale/incomplete index answers do not replace it',()=>{
 const live={source:'live',buys:0,sells:0,buyUsd:0,sellUsd:0,volUsd:0,netUsd:0,traders:0};
 assert.equal(coinFlow(live,market,now),live);assert.equal(coinFlow(null,{...market,t:1},now),null);
 assert.equal(coinFlow(null,{...market,windows:{'5m':{...market.windows['5m'],sellVol:null}}},now),null);
 assert.equal(coinFlow(null,{...market,windows:{'5m':{...market.windows['5m'],buys:0,sells:0,buyVol:0,sellVol:0}}},now).volUsd,0);
});
test('older and expired metric pushes cannot overwrite a newer poll, including valid zeros',()=>{
 const field={value:0,observedAt:now-1000,maxAgeMs:5000};const c={fields:{holders:field}};
 assert.equal(currentMetric(c,'holders',now,now-2000),field);
 assert.equal(currentMetric(c,'holders',now,now-500),null);
 assert.equal(currentMetric(c,'holders',now+10000),null);
 assert.equal(currentMetric({fields:{mc:{...field,value:NaN}}},'mc',now),null);
});

test('pool index supersedes an idle local ring that reports zero despite active pool trades',()=>{
 assert.equal(coinFlow({source:'live',buys:0,sells:0,volUsd:0},market,now,true).buys,203);
});

test('fresh complete streamed totals update every card before the next index poll',()=>{
 const stream={mint:'M',t:now,complete:true,flow:{source:'live',buys:204,sells:198,buyUsd:9600,sellUsd:7200,volUsd:16800,netUsd:2400,traders:201}};
 assert.equal(coinFlow(null,market,now,true,stream).buys,204);
 assert.equal(coinFlow(null,market,now+10000,true,stream).buys,203);
 assert.equal(coinFlow(null,market,now,true,{...stream,complete:false}).buys,203);
 assert.equal(coinFlow(null,market,now,true,{...stream,t:now+60000}).buys,203);
});
