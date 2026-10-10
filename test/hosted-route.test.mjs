import test from 'node:test';
import assert from 'node:assert/strict';
import { memberMay, visitorMay } from '../server/access.js';

const readRoutes = ['me', 'google', 'txs', 'rewards'].map(action => `/api/account/${action}`);
const writeRoutes = ['setup', 'logout', 'buy', 'sell', 'withdraw', 'export', 'launch', 'claim'].map(action => `/api/account/${action}`);

test('members receive only the explicit hosted-account method and route combinations', () => {
  for (const route of [...readRoutes, ...writeRoutes]) {
    const expected = readRoutes.includes(route) ? 'GET' : 'POST';
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.equal(memberMay(method, route), method === expected, `${method} ${route}`);
    }
  }
});

test('public visitors cannot access any hosted-wallet endpoint', () => {
  for (const route of [...readRoutes, ...writeRoutes]) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.equal(visitorMay(method, route), false, `${method} ${route}`);
    }
  }
});

test('hosted access allowlist rejects route suffixes, alternative spellings and admin paths', () => {
  const routes = [
    '/api/account', '/api/account/', '/api/account/users', '/api/account/admin',
    '/api/account/users/2/export', '/api/account/google/callback', '/api/account/BUY',
    '/api/account/buy/', '/api/account/export/all', '/api/account/%65xport',
    '/api/account/me/private', '/api/account/setup-admin',
  ];
  for (const route of routes) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(memberMay(method, route), false, `${method} ${route}`);
      assert.equal(visitorMay(method, route), false, `public ${method} ${route}`);
    }
  }
});
