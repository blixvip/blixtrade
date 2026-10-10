import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWalletIdentity } from '../server/wallet-identity.js';

// Synthetic credentials only: no filesystem, browser, network, or real wallet access.
const secret = 'fixture-only-wallet-identity-secret-0123456789';
const now = 1_800_000_000_000;
const day = 86_400_000;
const member = 'alice@example.test';
const payload = { sub: 'google-user-123', email: member, iat: now - 1000, exp: now + day };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const signEncoded = (encoded, key = secret, domain = 'wallet-auth.') => `${encoded}.${createHmac('sha256', key).update(domain + encoded).digest('hex')}`;
const sign = (overrides = {}, key = secret) => signEncoded(encode({ ...payload, ...overrides }), key);
const verify = (raw, email = member, key = secret, time = now) => verifyWalletIdentity(raw, email, key, time);

test('accepts a signed identity bound to the verified member email', () => {
  assert.deepEqual(verify(sign()), { sub: payload.sub, email: member, authed: payload.iat });
});

test('normalizes email case without changing the stable wallet subject', () => {
  assert.deepEqual(verify(sign({ email: 'Alice@Example.Test' }), 'ALICE@EXAMPLE.TEST'), {
    sub: payload.sub, email: member, authed: payload.iat,
  });
});

test('requires the same verified member email, including for a valid signed token', () => {
  for (const email of ['bob@example.test', '', null, undefined, 123, {}]) {
    assert.equal(verifyWalletIdentity(sign(), email, secret, now), null);
  }
});

test('rejects replacing the wallet subject while retaining the original signature', () => {
  const signature = sign().split('.')[1];
  assert.equal(verify(`${encode({ ...payload, sub: 'victim-user' })}.${signature}`), null);
});

test('rejects replacing the email while retaining the original signature', () => {
  const signature = sign().split('.')[1];
  assert.equal(verify(`${encode({ ...payload, email: 'bob@example.test' })}.${signature}`, 'bob@example.test'), null);
});

test('rejects signatures from a different secret or signing purpose', () => {
  assert.equal(verify(sign({}, 'different-fixture-secret-01234567890123456789')), null);
  assert.equal(verify(signEncoded(encode(payload), secret, 'member-auth.')), null);
  assert.equal(verify(signEncoded(encode(payload), secret, '')), null);
});

test('requires a configured secret of at least 32 characters', () => {
  for (const key of ['', 'x'.repeat(31), null, undefined, 123, {}]) {
    assert.equal(verifyWalletIdentity(sign(), member, key, now), null);
  }
  const minimum = 'x'.repeat(32);
  assert.equal(verify(sign({}, minimum), member, minimum)?.authed, payload.iat);
});

test('rejects an expired token, including its exact expiration instant', () => {
  assert.equal(verify(sign({ exp: now - 1 })), null);
  assert.equal(verify(sign({ exp: now })), null);
  assert.equal(verify(sign({ exp: now + 1 }))?.authed, payload.iat);
});

test('allows at most 30 seconds of issuance clock skew', () => {
  assert.equal(verify(sign({ iat: now + 30_000 }))?.authed, now + 30_000);
  assert.equal(verify(sign({ iat: now + 30_001 })), null);
});

test('rejects reversed or zero-length validity periods', () => {
  assert.equal(verify(sign({ iat: now + 1, exp: now + 1 })), null);
  assert.equal(verify(sign({ iat: now + 2, exp: now + 1 })), null);
});

test('limits token validity to 30 days, measured from issuance', () => {
  assert.equal(verify(sign({ iat: now, exp: now + 30 * day }))?.authed, now);
  assert.equal(verify(sign({ iat: now, exp: now + 30 * day + 1 })), null);
  assert.equal(verify(sign({ iat: now - 31 * day, exp: now + 1 })), null);
});

test('requires finite integer numeric timestamps and nonnegative issuance', () => {
  for (const field of ['iat', 'exp']) {
    for (const invalid of [String(now), null, undefined, true, [], {}, NaN, Infinity, now + 0.5]) {
      assert.equal(verify(sign({ [field]: invalid })), null, `${field}: ${String(invalid)}`);
    }
  }
  assert.equal(verify(sign({ iat: -1, exp: 1000 }), member, secret, 1), null);
});

test('requires a bounded printable ASCII subject', () => {
  for (const sub of ['', 'x'.repeat(201), ' ', ' user', 'user name', 'alice\nadmin', 'user\u0000id', 'user\u007fid', '用户', null, 123, {}, []]) {
    assert.equal(verify(sign({ sub })), null, `subject: ${JSON.stringify(sub)}`);
  }
  for (const sub of ['a', 'x'.repeat(200), 'provider:user-123_abc']) {
    assert.equal(verify(sign({ sub }))?.sub, sub);
  }
});

test('rejects missing or non-string identity email', () => {
  for (const email of ['', null, undefined, 123, {}, []]) {
    assert.equal(verify(sign({ email })), null);
  }
});

test('rejects non-object JSON payloads and malformed JSON despite valid signatures', () => {
  for (const value of [null, [], 'alice', 123, true]) {
    assert.equal(verify(signEncoded(encode(value))), null);
  }
  assert.equal(verify(signEncoded(Buffer.from('{broken').toString('base64url'))), null);
});

test('rejects absent, wrong-type, oversized, and malformed raw tokens without throwing', () => {
  const valid = sign();
  for (const raw of [undefined, null, '', 123, {}, [], 'x'.repeat(20_000), '.', valid + '.extra', valid.split('.')[0], `${valid.split('.')[0]}.`, `.${valid.split('.')[1]}`]) {
    assert.equal(verify(raw), null);
  }
  assert.equal(verify(sign({ padding: 'x'.repeat(20_000) })), null);
});

test('rejects malformed signature encodings, lengths, and altered bytes', () => {
  const [encoded, signature] = sign().split('.');
  for (const invalid of ['g'.repeat(64), '0'.repeat(63), '0'.repeat(65), signature + '00', signature.slice(2), `${signature[0] === '0' ? '1' : '0'}${signature.slice(1)}`]) {
    assert.equal(verify(`${encoded}.${invalid}`), null);
  }
});

test('rejects invalid base64url instead of silently accepting decoder garbage', () => {
  const encoded = encode(payload);
  for (const invalid of [`!${encoded}`, `${encoded}\n`, `${encoded}#`]) {
    assert.equal(verify(signEncoded(invalid)), null);
  }
});
