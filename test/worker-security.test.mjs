// The Worker's access rules that must never regress: /__admin opens only for an OWNER_EMAILS Google session, and
// the rate limiter failing (missing, throwing, hanging) never locks anyone out of sign-in or the API, while the
// brute-force targets stay strict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
registerHooks({ load(url, context, next) {
  return url.endsWith('.html') ? { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))}` } : next(url, context);
} });
const { waitlist } = await import('../worker/site/waitlist.js');
const { guardRequest } = await import('../worker/security.js');

const enc = new TextEncoder();
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sign = async (t, s) => b64u(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(t)));
const KEY = 'test-session-key-0123456789abcdef0123456789';
const cookie = async (email, key = KEY, exp = Date.now() + 86400e3) => { const e = b64u(enc.encode(email)); return `blix_wait=${e}.${exp}.${await sign(`${e}.${exp}`, `wait:${key}`)}`; };
const stmt = { bind() { return this; }, first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) };
const env = { SESSION_KEY: KEY, OWNER_EMAILS: 'owner@example.com, second@example.com', DB: { prepare: () => stmt, batch: async () => [] }, REG: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } };
const adminStatus = async (c) => {
  const url = new URL('https://blixvip.com/__admin');
  return (await waitlist(new Request(url, { headers: c ? { cookie: c } : {} }), env, url, { limited: false, defer: () => {} })).status;
};

test('/__admin opens for an owner Google session only', async () => {
  assert.equal(await adminStatus(await cookie('owner@example.com')), 200);
  assert.equal(await adminStatus(await cookie('SECOND@example.com')), 200);
  assert.equal(await adminStatus(await cookie('member@example.com')), 404);
  assert.equal(await adminStatus(await cookie('owner@example.com', 'wrong-key-wrong-key-wrong-key-wrong-key')), 404);
  assert.equal(await adminStatus(await cookie('owner@example.com', KEY, Date.now() - 1000)), 404);
  assert.equal(await adminStatus((await cookie('owner@example.com')).slice(0, -2) + 'AA'), 404);
  assert.equal(await adminStatus(null), 404);
});

const req = (path, method = 'GET', headers = {}) => new Request('https://blixvip.com' + path, { method, headers });
const throwing = { LIMITER: { idFromName: () => 1, get: () => ({ fetch: async () => { throw new Error('object down'); } }) } };
const hanging = { LIMITER: { idFromName: () => 1, get: () => ({ fetch: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('timeout')))) }) } };

test('a broken limiter never locks people out of sign-in or the API', async () => {
  const keep = setInterval(() => {}, 1000);   // AbortSignal.timeout does not hold the process open
  try {
    for (const env of [{}, throwing, hanging]) assert.equal((await guardRequest(req('/auth/google'), env)).response, undefined);
    assert.equal((await guardRequest(req('/api/pulse'), {})).response, undefined);
    assert.equal((await guardRequest(req('/api/pulse'), { API_LIMIT: { limit: async () => { throw new Error('x'); } } })).response, undefined);
  } finally { clearInterval(keep); }
});

test('brute-force targets stay strict when the limiter is broken', async () => {
  const out = await guardRequest(req('/__register', 'POST', { 'content-type': 'application/json' }), throwing);
  assert.equal(out.response?.status, 429);
});

test('a real limit hit is refused even on sign-in', async () => {
  const full = { LIMITER: { idFromName: () => 1, get: () => ({ fetch: async () => new Response('limited', { status: 429 }) }) } };
  assert.equal((await guardRequest(req('/auth/google'), full)).response?.status, 429);
});

test('cross-site writes are refused', async () => {
  assert.equal((await guardRequest(req('/api/paper', 'POST', { origin: 'https://evil.example' }), {})).response?.status, 403);
});
