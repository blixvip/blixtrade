import http from 'node:http';

// Shared GETs only. Bound the whole read, including waiting for a socket and a
// backend that keeps sending a few bytes without ever finishing its response.
export function createRadarReader({ timeoutMs = 30_000, maxPending = 96, maxBytes = 16e6, agent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 }) } = {}) {
  let pending = 0;
  return (port, url) => {
    if (pending >= maxPending) return Promise.reject(Object.assign(new Error('radar read queue is full'), { overloaded: true }));
    pending++;
    return new Promise((resolve, reject) => {
      let done = false, out;
      const finish = (error, value) => {
        if (done) return;
        done = true; pending--; clearTimeout(deadline);
        if (error) reject(error); else resolve(value);
      };
      const deadline = setTimeout(() => {
        const error = Object.assign(new Error('the radar took too long'), { code: 'ETIMEDOUT' });
        finish(error); out?.destroy(error);
      }, timeoutMs);
      const go = again => {
        try {
          out = http.request({ host: '127.0.0.1', port, path: url, method: 'GET', agent,
            headers: { host: `localhost:${port}`, accept: 'application/json', 'accept-encoding': 'identity' } }, r => {
            if (done) { r.destroy(); return; }
            const parts = []; let size = 0;
            r.on('data', chunk => {
              size += chunk.length;
              if (size > maxBytes) { const error = new Error('answer too large'); finish(error); r.destroy(); out.destroy(); return; }
              parts.push(chunk);
            });
            r.on('end', () => finish(null, { status: r.statusCode || 502, type: String(r.headers['content-type'] || 'application/json'), body: Buffer.concat(parts) }));
            r.on('error', error => finish(error));
            r.on('aborted', () => finish(Object.assign(new Error('radar response interrupted'), { code: 'ECONNRESET' })));
          });
          const request = out;
          request.on('error', error => {
            if (done) return;
            if (!again && request.reusedSocket && error.code === 'ECONNRESET') go(true);
            else finish(error);
          });
          request.end();
        } catch (error) { finish(error); }
      };
      go(false);
    });
  };
}
