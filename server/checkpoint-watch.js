// Keep WAL protection working after a checkpoint thread dies, not just during startup.
export function superviseCheckpoint({ spawn, onStats, fallback, retryMs = 30000, staleMs = 60000, checkMs = 15000 }) {
  let worker, retry, stopped = false, last = Date.now(), mode;
  const protect = value => {
    if (mode === value) return;
    try { fallback(value); mode = value; } catch { /* retry on the next health check */ }
  };
  const later = () => {
    if (stopped || retry) return;
    retry = setTimeout(() => { retry = null; start(); }, retryMs);
    retry.unref?.();
  };
  const lost = current => {
    if (stopped || worker !== current) return;
    worker = null; protect(true); later();
  };
  const retire = current => {
    try { Promise.resolve(current.terminate()).catch(() => {}); } catch {}
  };
  function start() {
    if (stopped || worker) return;
    try {
      const current = worker = spawn(); last = Date.now();
      current.on('message', stats => {
        if (stopped || worker !== current) return;
        last = Date.now(); onStats(stats); protect(Boolean(stats.lastError));
      });
      current.on('error', () => { lost(current); });
      current.on('exit', () => lost(current));
      current.unref?.();
    } catch { worker = null; protect(true); later(); }
  }
  const check = setInterval(() => {
    if (!worker) { protect(true); return; }
    if (Date.now() - last >= staleMs) { const old = worker; lost(old); retire(old); }
  }, checkMs);
  check.unref?.(); start();
  return () => {
    if (stopped) return; stopped = true;
    clearInterval(check); clearTimeout(retry);
    if (worker) { const old = worker; worker = null; retire(old); }
  };
}
