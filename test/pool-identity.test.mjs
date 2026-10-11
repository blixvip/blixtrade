import test from 'node:test';
import assert from 'node:assert/strict';
import { solPumpMint, createSolPoolResolver } from '../server/pool-identity.js';
const raw = 'g+bcSPTuzfSa9SSdcBEGyRZlvai4UowC0tKnmfxL2+95aMJUkgL/d/N3SA8UlC1SYr9Bof8MAmQoCAkJ7Re0bw==';
const account = data => ({ owner: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', data: [data, 'base64'] });
function decode(s) { let n=0n; for(const c of s)n=n*58n+BigInt('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.indexOf(c)); return Buffer.from(n.toString(16).padStart(64,'0'),'hex'); }
const valid = () => account(Buffer.concat([Buffer.from(raw,'base64').subarray(0,32),decode('So11111111111111111111111111111111111111112')]).toString('base64'));
test('67cat non-SOL pool cannot enter the SOL-priced history decoder', () => {
  assert.equal(solPumpMint(account(raw)), null);
  assert.equal(solPumpMint(valid()), '9stanqrVUsQ2j7KxdEUXCN1EWes2eXi7hSQYJHRBpump');
  assert.equal(solPumpMint({ ...valid(), owner: 'wrong' }), null);
  assert.equal(solPumpMint(account('AA==')), null);
});
test('pool identity is verified on chain; missing accounts are retried and supported pools cached', async () => {
  let calls=0;
  const resolve=createSolPoolResolver(async (method, args) => {
    calls++; assert.equal(method,'getMultipleAccounts'); assert.equal(args[1].commitment,'confirmed');
    return { value:[calls === 1 ? null : valid()] };
  });
  assert.equal(await resolve('pool'),null);
  assert.ok(await resolve('pool'));
  assert.ok(await resolve('pool'));
  assert.equal(calls,2);
});
