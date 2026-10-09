// An exact count of sign-ins and admin key tries per address (index.js `limited`). One Durable Object per address
// (idFromName), so every request from it is counted in one place: the in-memory count (edge.js overLimit) and the
// rate limiting binding both let a 60-request burst of wrong admin keys through on 2026-10-09, since Cloudflare
// spreads one address's requests over many isolates. A window is a minute; eviction must not reset it.
// Accepted timestamps live in transactional storage.
export class Limiter {
  constructor(state) { this.state = state; }
  // GET /?max=20&ms=60000 -> 200 "ok" while under the limit, 429 once over it (each call counts).
  async fetch(req) {
    const u = new URL(req.url), max = Math.min(1200, Math.max(1, Math.floor(Number(u.searchParams.get("max")) || 20))), ms = 60_000;
    const now = Date.now();
    const allowed = await this.state.storage.transaction(async tx => {
      const hits = ((await tx.get('hits')) || []).filter(t => now - t < ms);
      if (hits.length >= max) return false;
      hits.push(now);
      await tx.put('hits', hits);
      return true;
    });
    return new Response(allowed ? 'ok' : 'limited', { status: allowed ? 200 : 429, headers: { 'cache-control': 'no-store', ...(allowed ? {} : { 'retry-after': '60' }) } });
  }
}

// Authentication must not bypass throttling during a missing binding or an outage, when `failClosed`: the admin key
// and other brute-force targets. Google sign-in passes false: with the object slow or down it must still let people
// in (Google does the real check), not answer "Too many attempts" to everyone.
export async function overLimitExact(env, key, max = 20, failClosed = true) {
  if (!env.LIMITER) return failClosed;
  try {
    const stub = env.LIMITER.get(env.LIMITER.idFromName(key));
    const r = await stub.fetch(`https://limiter/?max=${max}&ms=60000`, { signal: AbortSignal.timeout(2000) });
    return r.status === 429 || (failClosed && r.status !== 200);
  } catch { return failClosed; }
}
