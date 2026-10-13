import http from 'node:http';

export function guardRequest(handle) {
  return (req, res) => {
    const fail = () => {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) return res.destroy();
      res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end('{"error":"This request could not be completed. Please try again."}');
    };
    try { Promise.resolve(handle(req, res)).catch(fail); } catch { fail(); }
  };
}

// No retries: a disconnected write may already have executed upstream.
export function proxyRequest(req, res, { port, headers, stream = false, firstByteMs = 15000, timeoutMs = 120000, onResponse } = {}) {
  let firstTimer, deadline, response, transform;
  const clear = () => { clearTimeout(firstTimer); clearTimeout(deadline); };
  const fail = (status = 503) => {
    clear();
    if (!res.destroyed && !res.writableEnded) {
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: status === 504 ? 'The request timed out. Check transaction history before retrying an action.' : 'Connection interrupted. Check transaction history before retrying an action.' }));
      }
    }
    response?.destroy(); transform?.destroy(); out.destroy();
  };
  const out = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, r => {
    response = r; clearTimeout(firstTimer);
    if (res.destroyed || res.writableEnded) { r.destroy(); out.destroy(); return; }
    if (stream) { clearTimeout(deadline); out.setTimeout(90000, () => fail(504)); }
    r.on('error', () => fail());
    r.on('aborted', () => fail());
    try {
      if (onResponse) transform = onResponse(r);
      else { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); }
    } catch { fail(); }
  });
  out.on('error', () => fail());
  firstTimer = setTimeout(() => fail(504), firstByteMs);
  deadline = setTimeout(() => fail(504), timeoutMs);
  const close = () => { clear(); response?.destroy(); transform?.destroy(); out.destroy(); };
  res.once('close', close);
  res.once('finish', clear);
  req.once('aborted', close);
  req.once('error', close);
  req.pipe(out);
  return out;
}
