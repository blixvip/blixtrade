// Watches only the child object created by this supervisor. Never discovers or kills other processes.
export function watchChild(child, { probe, onExit, onHang = () => {}, now = Date.now,
  everyMs = 15000, warmupMs = 120000, missesBeforeKill = 4, killAfterMs = 5000 } = {}) {
  const started = now();
  let done = false, stopped = false, terminating = false, checking = false, answered = false, misses = 0, force;
  const terminate = () => {
    if (done || terminating) return;
    terminating = true; clearInterval(timer);
    try { child.kill('SIGTERM'); } catch {}
    force = setTimeout(() => { if (!done) try { child.kill('SIGKILL'); } catch {} }, killAfterMs);
  };
  const finish = (code, signal, error) => {
    if (done) return;
    done = true; clearInterval(timer); clearTimeout(force);
    if (!stopped) onExit(code, signal, error);
  };
  const timer = setInterval(async () => {
    if (done || stopped || terminating || checking) return;
    checking = true;
    let healthy = false;
    try { healthy = await probe(); } catch {} finally { checking = false; }
    if (done || stopped || terminating) return;
    if (healthy) { answered = true; misses = 0; return; }
    if (!answered && now() - started < warmupMs) return;
    if (++misses >= missesBeforeKill) { onHang(); terminate(); }
  }, everyMs);
  child.once('exit', (code, signal) => finish(code, signal));
  child.on('error', error => finish(child.exitCode, child.signalCode, error));
  return { stop() { if (stopped || done) return; stopped = true; clearInterval(timer); terminate(); } };
}
