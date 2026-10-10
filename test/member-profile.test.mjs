import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemberProfile } from '../worker/site/member-profile.js';

const email = 'alice@example.test';
const profile = { name: 'Alice Trader', picture: 'https://lh3.googleusercontent.com/a/fixture' };
test('adds Google profile to the matching signed-in account without changing wallet data', async () => {
  const account = { signedIn: true, email, address: 'fixture-address', wallet: { sol: 2 } };
  const result = await withMemberProfile(Response.json(account), email, profile);
  assert.deepEqual(await result.json(), { ...account, ...profile });
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
});
test('never attaches profile to another account, signed-out response, or an error', async () => {
  for (const body of [{ signedIn: false }, { signedIn: true, email: 'bob@example.test' }]) {
    const response = Response.json(body);
    assert.equal(await withMemberProfile(response, email, profile), response);
  }
  const error = Response.json({ error: 'Unavailable' }, { status: 503 });
  assert.equal(await withMemberProfile(error, email, profile), error);
});
test('rejects untrusted photo URLs and bounds the display name', async () => {
  for (const picture of ['http://lh3.googleusercontent.com/a', 'https://lh3.googleusercontent.com.evil.test/a', 'javascript:alert(1)', null, {}]) {
    const result = await withMemberProfile(Response.json({ signedIn: true, email }), email, { name: 'a'.repeat(200), picture });
    const body = await result.json();
    assert.equal(body.picture, null);
    assert.equal(body.name.length, 120);
  }
});
test('missing profile leaves the existing response intact', async () => {
  const response = Response.json({ signedIn: true, email });
  assert.equal(await withMemberProfile(response, email, null), response);
});
