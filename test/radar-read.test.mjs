import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRadarReader} from '../server/radar-read.js';

async function setup(t, handler, options={}) {
  const server=http.createServer(handler);
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const agent=new http.Agent({keepAlive:true,maxSockets:1});
  t.after(()=>{agent.destroy();server.closeAllConnections();server.close();});
  const read=createRadarReader({agent,timeoutMs:150,...options});
  return {read:url=>read(server.address().port,url)};
}
test('a trickling backend is stopped by a total deadline',async t=>{
  const h=await setup(t,(_req,res)=>{
    res.writeHead(200,{'content-type':'application/json'});
    const timer=setInterval(()=>res.write(' '),15);res.on('close',()=>clearInterval(timer));
  });
  await assert.rejects(h.read('/trickle'),{code:'ETIMEDOUT'});
});
test('waiting for a pooled socket counts toward the deadline',async t=>{
  const h=await setup(t,()=>{});
  const first=h.read('/blocked').catch(e=>e);
  const second=h.read('/queued').catch(e=>e);
  assert.equal((await second).code,'ETIMEDOUT');
  assert.equal((await first).code,'ETIMEDOUT');
});
test('saturation is rejected immediately and slots recover after failures',async t=>{
  let healthy=false;
  const h=await setup(t,(_req,res)=>{if(healthy)res.end('recovered');},{maxPending:2});
  const pending=[h.read('/1').catch(e=>e),h.read('/2').catch(e=>e)];
  await assert.rejects(h.read('/3'),{overloaded:true});
  await Promise.all(pending);healthy=true;
  assert.equal((await h.read('/healthy')).body.toString(),'recovered');
});
test('truncation and oversized responses reject without poisoning the next read',async t=>{
  const h=await setup(t,(req,res)=>{
    if(req.url==='/large')return res.end('x'.repeat(1024));
    if(req.url==='/truncated'){res.write('part');setTimeout(()=>res.destroy(),10);return;}
    res.end('ok');
  },{maxBytes:128});
  await assert.rejects(h.read('/large'),/too large/);
  await assert.rejects(h.read('/truncated'));
  assert.equal((await h.read('/ok')).body.toString(),'ok');
});
