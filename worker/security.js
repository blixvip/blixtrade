import { overLimitExact } from './limiter.js';

const ORIGINS = new Set(['https://blixvip.com', 'https://www.blixvip.com', 'https://trade.blixvip.com']);
export const securityError = (status, error) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store', ...(status === 429 ? { 'retry-after': '60' } : {}) } });

// Read no more than the allowed bytes, even when Content-Length is absent or forged.
export async function boundedRequest(req, max) {
  if (Number(req.headers.get('content-length')) > max) throw Object.assign(Error('Request too large.'), { status: 413 });
  if (!req.body) return req;
  const reader = req.body.getReader(), chunks = [];
  let size = 0, timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('Request timed out.'), { status: 408 })), 15_000); });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > max) throw Object.assign(Error('Request too large.'), { status: 413 });
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new Request(req, { body });
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { clearTimeout(timer); reader.releaseLock(); }
}

// Runs before analytics, credentials, D1, KV, or any origin request.
export async function guardRequest(req, env) {
  const url = new URL(req.url);
  let path;
  try { path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/'; }
  catch { return { response: securityError(400, 'Bad path.') }; }
  if (url.href.length > 8192) return { response: securityError(414, 'Address too long.') };
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(req.method)) return { response: securityError(405, 'Method not allowed.') };
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  if (write) {
    const origin = req.headers.get('origin'), site = req.headers.get('sec-fetch-site');
    if ((origin && !ORIGINS.has(origin)) || (!origin && (site === 'cross-site' || site === 'same-site'))) return { response: securityError(403, 'Untrusted request origin.') };
  }
  const authLimit = path === '/auth/google' ? 20 : write && path === '/__admin/login' ? 5 : write && path === '/demo' ? 10 : path === '/__register' ? 10 : 0;
  if (authLimit && await overLimitExact(env, `auth:${path}:${ip}`, authLimit, path !== '/auth/google')) return { response: securityError(429, 'Too many attempts. Try again in a minute.') };
  // Native limits are a cheap burst shield; sensitive actions also use exact counters.
  if (/^\/(api|img|demo\/)/.test(path)) {
    // A burst shield only: a missing binding or a failed check lets the read through (the per-address count behind
    // it still applies). Answering 503 there would take every page's data down with the limiter.
    try {
      if (env.API_LIMIT && !(await env.API_LIMIT.limit({ key: ip })).success) return { response: securityError(429, 'Too many requests. Try again in a minute.') };
    } catch { /* let it through */ }
  }
  if (write) {
    try {
      req = await boundedRequest(req, path === '/api/account/launch' ? 6_000_000 : 8192);
    } catch (e) { return { response: securityError(e.status || 400, e.status === 413 ? 'Request too large.' : 'Unable to read request.') }; }
  }
  return { request: req };
}

export function secureResponse(response) {
  const out = new Response(response.body, response);
  const headers = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'permissions-policy': 'camera=(), microphone=(), geolocation=()' };
  for (const [key, value] of Object.entries(headers)) if (!out.headers.has(key)) out.headers.set(key, value);
  out.headers.delete('x-blix-edge-error');
  return out;
}
