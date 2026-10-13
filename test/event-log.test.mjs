import test from 'node:test';
import assert from 'node:assert/strict';
import {createEventLogger} from '../server/event-log.js';

test('locked logging never throws and retries original events in order',t=>{
  t.mock.timers.enable({apis:['Date','setTimeout'],now:1000});
  let locked=true;const saved=[];
  const logger=createEventLogger((...row)=>{if(locked)throw Error('database is locked');saved.push(row);});
  t.after(logger.stop);
  assert.doesNotThrow(()=>logger.log('error','first'));
  t.mock.timers.tick(500);logger.log('system','second');
  assert.equal(logger.stats.queued,2);
  locked=false;t.mock.timers.tick(500);
  assert.deepEqual(saved,[[1000,'error','first'],[1500,'system','second']]);
  assert.equal(logger.stats.queued,0);
});
test('persistent logging failures have bounded memory and bounded work per retry',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let locked=true;const saved=[];
  const logger=createEventLogger((...row)=>{if(locked)throw Error('disk full');saved.push(row);},{limit:3,batch:2});
  t.after(logger.stop);
  for(let i=0;i<10;i++)logger.log('error',String(i));
  assert.equal(logger.stats.queued,3);assert.equal(logger.stats.dropped,7);
  locked=false;t.mock.timers.tick(500);
  assert.equal(saved.length,2);assert.equal(logger.stats.queued,1);
  t.mock.timers.tick(500);assert.deepEqual(saved.map(r=>r[2]),['7','8','9']);
});
