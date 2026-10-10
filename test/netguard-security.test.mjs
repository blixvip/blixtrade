import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fetchPublic } from '../server/netguard.js';

test('public fetch pins its connection to the vetted DNS answer', async t => {
  let lookups = 0;
  t.mock.method(dns.promises, 'lookup', async () => { lookups++; return [{ address: '8.8.8.8', family: 4 }]; });
  t.mock.method(https, 'request', (url, options, onResponse) => {
    options.lookup('image.example', {}, (err, address) => { assert.equal(err, null); assert.equal(address, '8.8.8.8'); });
    const req = new EventEmitter(); req.destroy = () => {}; req.end = () => {
      const res = new PassThrough(); res.statusCode = 200; res.headers = { 'content-type': 'image/png' };
      onResponse(res); res.end(Buffer.from('test'));
    }; return req;
  });
  const response = await fetchPublic('https://image.example/test', { maxBytes: 100 });
  assert.equal(await response.text(), 'test');
  assert.equal(lookups, 1);
});
test('mixed private/public DNS answers are rejected before connecting', async t => {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
  t.mock.method(https, 'request', () => { throw Error('must not connect'); });
  await assert.rejects(fetchPublic('https://image.example/test'), /destination/i);
});
test('chunked upstream images stop at the byte limit', async t => {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '8.8.8.8', family: 4 }]);
  t.mock.method(https, 'request', (url, options, onResponse) => {
    const req = new EventEmitter(); req.destroy = () => {}; req.end = () => {
      const res = new PassThrough(); res.statusCode = 200; res.headers = {};
      onResponse(res); res.end(Buffer.alloc(101));
    }; return req;
  });
  await assert.rejects(fetchPublic('https://image.example/test', { maxBytes: 100 }), /large/i);
});
