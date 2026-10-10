// One guard in the public web process covers both the Worker and direct tunnel path.
// Counters are bounded; saturation refuses new keys rather than resetting existing limits.
export const isRelay = (account, owner, path) => owner === true && account === 'pc-relay@blix' && /^\/api\/(fomo\/(token|feed\/relay|coin\/relay)|running\/ai)$/.test(path);
export function createOriginGuard({ now = Date.now } = {}) {
  const rates = new Map(), streams = new Map();
  let lastSweep = 0, active = 0, requests = 0;
  function exceeded(key, limit) {
    const t = now();
    if (t - lastSweep >= 60_000) {
      for (const [k, v] of rates) if (t - v.t >= 60_000) rates.delete(k);
      lastSweep = t;
    }
    const entry = rates.get(key);
    if (!entry || t - entry.t >= 60_000) {
      if (!entry && rates.size >= 20_000) return true;
      rates.set(key, { t, n: 1 }); return false;
    }
    if (entry.n >= limit) return true;
    entry.n++; return false;
  }
  return (req, res, { path, account, ip, owner }) => {
    const deny = (status, message) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '60' });
      res.end(JSON.stringify({ error: message })); return true;
    };
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const relay = isRelay(account, owner, path);
    const max = path === '/api/account/launch' ? 6_000_000 : relay ? 2_000_000 : 8192;
    if (write && Number(req.headers['content-length']) > max) return deny(413, 'Request too large.');
    if (!path.startsWith('/api/') && !path.startsWith('/img/')) return false;
    if (exceeded(`ip:${ip}`, 1200)) return deny(429, 'Too many requests.');
    const who = account || `ip:${ip}`;
    const picture = path.startsWith('/img/') || /^\/api\/pic(?:\.webp)?$/.test(path);
    const sensitive = /^\/api\/account\/(withdraw|export)$/.test(path);
    const category = picture ? 'pictures' : write ? sensitive ? 'sensitive' : 'write' : 'read';
    // Pictures: 1000 a minute. Discover warms the logos of every tab and window it can switch to (~300-500 coins on
    // opening) and Cloudflare only keeps a logo once someone has fetched it, so 240 ran a visitor out within seconds:
    // logos broke and came back a minute later. A logo is a disk read here.
    const limit = picture ? 1000 : write ? relay ? 120 : sensitive ? 5 : 30 : account ? 600 : 240;
    if (exceeded(`${category}:${who}`, limit)) return deny(429, 'Too many requests.');
    const stream = req.method === 'GET' && (/\/stream$/.test(path) || String(req.headers.accept || '').includes('text/event-stream'));
    if (stream) {
      const count = streams.get(who) || 0;
      if (count >= 6 || active >= 500) return deny(429, 'Too many live connections.');
      streams.set(who, count + 1); active++;
      let released = false;
      const release = () => {
        if (released) return; released = true; active--;
        const remaining = (streams.get(who) || 1) - 1;
        if (remaining) streams.set(who, remaining); else streams.delete(who);
      };
      res.once('close', release); res.once('finish', release);
    } else {
      if (requests >= 256) return deny(503, 'Server is busy. Try again shortly.');
      requests++;
      let released = false;
      const release = () => { if (!released) { released = true; requests--; } };
      res.once('close', release); res.once('finish', release);
    }
    return false;
  };
}
