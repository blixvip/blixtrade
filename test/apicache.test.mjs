import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('cached reads during a backend restart cannot crash the page server', async () => {
  const source = `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import {answer} from ${JSON.stringify(new URL('../server/apicache.js', import.meta.url).href)};
    let clock = Date.now(); Date.now = () => clock;
    const backend = http.createServer((req,res) => {res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');});
    await new Promise(r=>backend.listen(0,'127.0.0.1',r));
    const port=backend.address().port;
    const request=async (url, headers={}) => {
      const response={destroyed:false,writableEnded:false,writeHead(status,h){this.status=status;this.headers=h;},end(body){this.body=String(body);this.writableEnded=true;}};
      await answer({url,headers},response,port,'market',true);
      return response;
    };
    assert.equal((await request('/api/market')).status,200);
    backend.closeAllConnections();await new Promise(r=>backend.close(r));clock+=1000;
    assert.equal((await request('/api/overview')).status,503);
    const stale=await request('/api/market',{'x-blix-kept':'120000'});
    assert.equal(stale.status,200);assert.equal(stale.headers['x-blix-age'],'1000');
    await new Promise(r=>setTimeout(r,30));
    assert.equal((await request('/api/unknown')).status,503);
    console.log('restart cache survived');
  `;
  const result = await promisify(execFile)(process.execPath, ['--unhandled-rejections=strict','--input-type=module','-e',source], {timeout:10000,windowsHide:true});
  assert.match(result.stdout,/restart cache survived/);
});
