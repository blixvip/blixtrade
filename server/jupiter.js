// One paced transport for quotes, SOL prices and the migrated column.
import { settings } from "./settings.js";
import * as health from "./health.js";

const error = (status, message) => Object.assign(new Error(message), { status });
export function createJupiterClient({ clock = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), request = (...args) => fetch(...args), key = () => settings.jupiterKey || "", requestsPerMinute = () => settings.jupiterRequestsPerMinute || 24 } = {}) {
  // One allowance for every Tokens/Price/Swap read. Instances sharing an organisation must split the budget.
  let next = 0, cooling = 0;
  let draining = false, providerRemaining = Infinity, providerReset = 0, headerAt = 0;
  let adaptiveLimit = Infinity, lastLimitedAt = 0, lastRecoveryAt = 0;
  const pending = new Map(), cache = new Map(), queue = [], sent = [];
  const deferred = () => Object.assign(error(429, "Jupiter request deferred to preserve trading capacity."), { cooling: true, deferred: true });
  const limit = () => {
    const configured = Math.max(1, Math.min(key() ? 54 : 27, Math.floor(Number(requestsPerMinute()) || 24)));
    // Provider firewall limits and other clients can be tighter than the published plan.
    // Recover slowly after ten quiet minutes; never exceed this instance's allocation.
    if (Number.isFinite(adaptiveLimit) && clock() - lastLimitedAt >= 600_000 && clock() - lastRecoveryAt >= 60_000) {
      adaptiveLimit = Math.min(configured, adaptiveLimit + 1); lastRecoveryAt = clock();
    }
    return Math.min(configured, adaptiveLimit);
  };
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length) {
        const index = Math.max(0, queue.findIndex(j => j.priority)), job = queue[index], now = clock(), rpm = limit();
        while (sent.length && sent[0].t <= now - 60_000) sent.shift();
        const backgroundFull = sent.filter(x => !x.priority).length >= Math.max(1, Math.floor(rpm * 0.4));
        if (now < cooling || now - job.queuedAt > 12_000 || (!job.priority && (backgroundFull || (now < providerReset && providerRemaining <= 1)))) {
          queue.splice(index, 1); job.reject(deferred()); continue;
        }
        const at = Math.max(next, sent.length >= rpm ? sent[0].t + 60_050 : 0);
        if (at - job.queuedAt > 12_000) { queue.splice(index, 1); job.reject(deferred()); continue; }
        // Reconsider priority while waiting: discovery never reserves future quote slots.
        if (at > now) { await sleep(Math.min(250, at - now)); continue; }
        queue.splice(index, 1);
        next = now + Math.ceil(60_000 / rpm) + 50;
        sent.push({ t: now, priority: job.priority });
        if (now < providerReset && Number.isFinite(providerRemaining) && --providerRemaining <= 0) cooling = Math.max(cooling, providerReset);
        job.run(now).then(job.resolve, job.reject);
      }
    } finally { draining = false; }
  }
  return function get(path, { timeout = 8000, cacheMs = 0, priority = false } = {}) {
    const saved = cache.get(path);
    if (saved && clock() - saved.t < cacheMs) return Promise.resolve(saved.value);
    if (pending.has(path)) {
      const job = pending.get(path); job.priority ||= priority;
      return job.promise;
    }
    if (queue.length >= 32 || clock() < cooling) return Promise.reject(deferred());
    const run = async startedAt => {
      const headers = { accept: "application/json" };
      if (key()) headers["x-api-key"] = key();
      let r;
      // Preserve existing endpoint compatibility without assuming separate quotas for the two hosts.
      try { r = await request(`https://${key() || !priority ? "api" : "lite-api"}.jup.ag${path}`, { headers, signal: AbortSignal.timeout(timeout) }); }
      catch { throw error(503, "Jupiter did not respond. Please retry in a few seconds."); }
      const resetHeader = r.headers.get('x-ratelimit-reset'), reset = resetHeader == null ? NaN : Number(resetHeader) * 1000;
      const remainingHeader = r.headers.get('x-ratelimit-remaining'), remaining = remainingHeader == null ? NaN : Number(remainingHeader);
      if (startedAt >= headerAt && Number.isFinite(remaining)) {
        headerAt = startedAt; providerRemaining = remaining;
        providerReset = Number.isFinite(reset) && reset > clock() ? reset : clock() + 60_000;
        if (remaining <= 0) cooling = Math.max(cooling, providerReset);
      }
      if (r.status === 429) {
        adaptiveLimit = Math.max(1, Math.floor(limit() / 2));
        lastLimitedAt = lastRecoveryAt = clock();
        const header = r.headers.get('retry-after'), seconds = header == null ? NaN : Number(header);
        const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header || '') - clock();
        const resetWait = Number.isFinite(reset) ? Math.max(0, reset - clock()) : NaN;
        cooling = Math.max(cooling, clock() + Math.max(1000, Number.isFinite(wait) || Number.isFinite(resetWait) ? Math.max(wait || 0, resetWait || 0) : 60_000));
        throw error(429, "Jupiter rate limit reached. Please retry in a few seconds.");
      }
      if (r.status === 401 || r.status === 403) throw error(503, "Jupiter access denied. Check the Jupiter API key in Settings.");
      const value = await r.json().catch(() => null);
      if (!r.ok) throw error(r.status >= 500 ? 503 : 409, `Jupiter: ${String(value?.error || value?.message || `HTTP ${r.status}`).slice(0, 180)}`);
      if (!value || typeof value !== "object") throw error(503, "Jupiter returned an invalid response. Please retry.");
      if (cacheMs) {
        cache.set(path, { t: clock(), value });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
      }
      health.ok("jupiter");
      return value;
    };
    const job = { priority, queuedAt: clock(), run };
    const promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; }).catch((e) => {
      // An answered quote with no route is a coin's liquidity problem, not an outage.
      // A call refused locally while the lane cools down is not a new failure: only Jupiter's own answers count.
      if (e.status === 409) health.ok("jupiter"); else if (!e.cooling) health.fail("jupiter", e);
      throw e;
    }).finally(() => pending.delete(path));
    job.promise = promise;
    pending.set(path, job);
    queue.push(job);
    void drain();
    return promise;
  };
}

export const jupiterGet = createJupiterClient();
