// Logging failures must not take down the work being logged. Keep a small retry
// queue through transient SQLite locks; prolonged failures cannot grow memory.
export function createEventLogger(write, { limit = 256, everyMs = 500, batch = 20 } = {}) {
  const queue = [];
  let timer;
  const stats = { queued: 0, dropped: 0, failures: 0 };
  const schedule = () => {
    if (!timer && queue.length) { timer = setTimeout(flush, everyMs); timer.unref?.(); }
  };
  function flush() {
    timer = null;
    for (let n = 0; n < batch && queue.length; n++) {
      try { write(...queue[0]); queue.shift(); }
      catch { stats.failures++; break; }
    }
    stats.queued = queue.length; schedule();
  }
  const log = (kind, text) => {
    const entry = [Date.now(), String(kind).slice(0, 64), String(text).slice(0, 8000)];
    if (!queue.length) {
      try { write(...entry); return; } catch { stats.failures++; }
    }
    if (queue.length >= limit) { queue.shift(); stats.dropped++; }
    queue.push(entry); stats.queued = queue.length; schedule();
  };
  return { log, stats, stop: () => { clearTimeout(timer); timer = null; } };
}
