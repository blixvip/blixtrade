import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLivePrices} from '../web/src/lib/live-prices.ts';
import {markMonitor, markPortfolio, markHoldings, markPaperWallet, markTraderPositions, markOpenHolding} from '../web/src/lib/wallet-values.ts';
test('thesis positions calculate open profit and return while closed positions remain historical',()=>{
 const bag={amount:10,value:100,unrealized:40,pct:40/60*100,closed:null};
 const p={mc:2000,supply:100,t:100000};
 const out=markOpenHolding(bag,p,100000);
 assert.equal(out.value,200);assert.equal(out.unrealized,140);assert.equal(out.pct,140/60*100);
 const closed={...bag,closed:'yesterday'};assert.equal(markOpenHolding(closed,p,100000),closed);
 assert.equal(markOpenHolding({...bag,unrealized:null},p,100000).unrealized,null);
});
test('unit price and market cap share a supply basis across later ticks',()=>{
 const s=createLivePrices(()=>100000);s.set([['A',1000,100]],false,true);
 s.set([['A',2000]],false,true);
 assert.equal(s.get('A').supply,100);
 assert.equal(s.get('A').mc/s.get('A').supply,20);
});
test('account and public holdings recalculate token totals and SOL value without changing balances',()=>{
 const w={sol:2,solUsd:200,tokensUsd:100,tokens:[{mint:'A',ui:10,usd:100},{mint:'B',ui:2,usd:null}]};
 const prices={A:{mc:2000,supply:100,t:100000}};
 const out=markHoldings(w,prices,120,100000);
 assert.equal(out.tokens[0].usd,200);assert.equal(out.tokensUsd,200);assert.equal(out.solUsd,240);
 assert.equal(out.tokens[1].usd,null);assert.equal(out.sol,2);assert.equal(w.tokensUsd,100);
 assert.equal(markHoldings(w,{A:{...prices.A,t:60000}},120,100000).tokensUsd,100);
});
test('paper equity revalues every open position but keeps cash and realized profit',()=>{
 const w={cash:9,equity:10,pnl:0,realized:2,solUsd:100,valuationPositions:[{mint:'A',valueSol:1,mcap:1000,priceAt:90000}]};
 const out=markPaperWallet(w,{A:{mc:2000,t:100000}},100,100000);
 assert.equal(out.equity,11);assert.equal(out.pnl,1);assert.equal(out.cash,9);assert.equal(out.realized,2);
 assert.equal(markPaperWallet(w,{A:{mc:2000,t:100000}},200,100000).equity,10);
});
test('trader position marks only revalue the matching chain and preserve entry and realized PnL',()=>{
 const positions=[{mint:'A',chain:1399811149,amount:10,price:10,mcap:1000,entry:6,realized:5},{mint:'A',chain:1,amount:10,price:10,mcap:1000}];
 const out=markTraderPositions(positions,{A:{mc:2000,t:100000}},100000);
 assert.equal(out[0].price,20);assert.equal(out[0].entry,6);assert.equal(out[0].realized,5);
 assert.equal(out[1],positions[1]);
});
test('all consumers see the complete price batch during the same notification',()=>{
 let t=100000;const s=createLivePrices(()=>t),seen=[];
 const read=()=>seen.push([s.get('A')?.mc,s.get('B')?.mc]);
 s.subscribe('A',read);s.subscribe('B',read);s.set([['A',100],['B',200]],false,true,t);
 assert.deepEqual(seen,[[100,200]]);
 s.set([['A',90]],false,true,t-1);assert.equal(s.get('A').mc,100);
 s.set([['A',Infinity]],false,true,t);assert.equal(s.get('A').mc,100);
 s.set([['A',300]],false,true,t+2000);assert.equal(s.get('A').mc,100);
});
test('weak snapshots cannot undo canonical live prices, and equal prices refresh observation time',()=>{
 let t=100000;const s=createLivePrices(()=>t);s.set([['A',100]],false,true,t);
 t+=10;s.set([['A',90]],true);assert.equal(s.get('A').mc,100);
 s.set([['A',100]],false,true,t);assert.equal(s.get('A').t,t);
});
test('wallet totals include a seventh hidden position and preserve realized profit and unknown basis',()=>{
 const positions=Array.from({length:7},(_,i)=>({mint:String(i),held:10,value:100,unrealized:40,mcap:1000,supply:100,exitable:true}));
 const w={pnl:{positions:positions.slice(0,6),valuationPositions:positions,openValue:700,unrealized:280,realized:55}};
 const out=markMonitor(w,{'6':{mc:2000,t:100000}},100000);
 assert.equal(out.pnl.openValue,800);assert.equal(out.pnl.unrealized,380);assert.equal(out.pnl.realized,55);
 assert.equal(w.pnl.openValue,700);
 const unknown={pnl:{positions:[{...positions[0],unrealized:null,exitable:false}],openValue:0,unrealized:0,realized:0}};
 const marked=markMonitor(unknown,{'0':{mc:2000,t:100000}},100000);
 assert.equal(marked.pnl.openValue,0);assert.equal(marked.pnl.unrealized,0);assert.equal(marked.pnl.positions[0].unrealized,null);
});
test('wallets reject stale prices and timestamps older than the underlying valuation',()=>{
 const p={mint:'A',held:10,value:100,unrealized:40,mcap:1000,priceAt:100000};
 const w={pnl:{positions:[p],openValue:100,unrealized:40,realized:0}};
 assert.equal(markMonitor(w,{A:{mc:2000,t:99999}},100000).pnl.openValue,100);
 assert.equal(markMonitor(w,{A:{mc:2000,t:100000}},140000).pnl.openValue,100);
});
test('wallet profile value and each position use the same live price',()=>{
 const p={positions:[{mint:'A',amount:10,price:10,mcap:1000,value:100,cost:60}],tokensUsd:100,value:150};
 const out=markPortfolio(p,{A:{mc:2000,t:100000}},100000);
 assert.equal(out.positions[0].value,200);assert.equal(out.positions[0].price,20);
 assert.equal(out.tokensUsd,200);assert.equal(out.value,250);assert.equal(out.positions[0].cost,60);
 const solMove=markPortfolio({...p,sol:1,solUsd:50},{A:{mc:2000,t:100000}},100000,75);
 assert.equal(solMove.value,275);assert.equal(solMove.solUsd,75);assert.equal(solMove.sol,1);
});
