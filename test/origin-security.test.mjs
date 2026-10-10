import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOriginGuard, isRelay } from '../server/request-guard.js';

const response = () => Object.assign(new EventEmitter(), { writeHead(status, headers) { this.status = status; this.headers = headers; }, end() {} });
const req = (method = 'GET') => ({ method, headers: {} });
test('machine relay exception requires its signed owner identity and an exact relay route', () => {
  assert.equal(isRelay('pc-relay@blix', true, '/api/fomo/feed/relay'), true);
  assert.equal(isRelay('pc-relay@blix', false, '/api/fomo/feed/relay'), false);
  assert.equal(isRelay('owner@example.test', true, '/api/fomo/feed/relay'), false);
  assert.equal(isRelay('pc-relay@blix', true, '/api/account/withdraw'), false);
});
test('Worker and direct requests share the account write allowance', () => {
  const guard = createOriginGuard();
  for (let i = 0; i < 30; i++) assert.equal(guard(req('POST'), response(), { path: '/api/account/buy', account: 'alice', ip: `ip-${i}` }), false);
  const res = response();
  assert.equal(guard(req('POST'), res, { path: '/api/account/buy', account: 'alice', ip: 'direct-ip' }), true);
  assert.equal(res.status, 429);
  assert.equal(res.headers['retry-after'], '60');
  assert.equal(guard(req('POST'), response(), { path: '/api/account/buy', account: 'bob', ip: 'other' }), false);
});
test('streams stop at six per account and release slots on disconnect', () => {
  const guard = createOriginGuard(), responses = [];
  for (let i = 0; i < 6; i++) { const res = response(); responses.push(res); assert.equal(guard(req(), res, { path: '/api/feed/stream', account: 'alice', ip: 'one' }), false); }
  assert.equal(guard(req(), response(), { path: '/api/feed/stream', account: 'alice', ip: 'two' }), true);
  responses[0].emit('close');
  assert.equal(guard(req(), response(), { path: '/api/feed/stream', account: 'alice', ip: 'two' }), false);
});
test('sensitive writes have a separate stricter limit and expire', () => {
  let now = 1000;
  const guard = createOriginGuard({ now: () => now });
  for (let i = 0; i < 5; i++) assert.equal(guard(req('POST'), response(), { path: '/api/account/export', account: 'a', ip: 'one' }), false);
  assert.equal(guard(req('POST'), response(), { path: '/api/account/withdraw', account: 'a', ip: 'one' }), true);
  now += 60_000;
  assert.equal(guard(req('POST'), response(), { path: '/api/account/export', account: 'a', ip: 'one' }), false);
});

test('global in-flight API cap prevents many identities exhausting the origin', () => {
  const guard = createOriginGuard(), responses = [];
  for (let i = 0; i < 256; i++) {
    const res = response(); responses.push(res);
    assert.equal(guard(req(), res, { path: '/api/pulse', account: `member-${i}`, ip: `ip-${i}` }), false);
  }
  const busy = response();
  assert.equal(guard(req(), busy, { path: '/api/pulse', account: 'extra', ip: 'extra' }), true);
  assert.equal(busy.status, 503);
  responses[0].emit('finish'); responses[0].emit('close');
  assert.equal(guard(req(), response(), { path: '/api/pulse', account: 'extra', ip: 'extra' }), false);
});
