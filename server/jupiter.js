// One paced transport for quotes, SOL prices and the migrated column.
import { settings } from "./settings.js";
import * as health from "./health.js";

const error = (status, message) => Object.assign(new Error(message), { status });
export function createJupiterClient({ clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), request = (...args) => fetch(...args), key = () => settings.jupiterKey || "" } = {}) {
  // Two lanes: background reads (prices, the migrated column) keep the slow pace; a person waiting on a
  // trade panel (priority) gets its own quick lane, so a quote never queues behind a scan.
  let next = 0, nextPri = 0, cooling = 0, coolingPri = 0;
  const pending = new Map(), cache = new Map();
  return function get(path, { timeout = 8000, cacheMs = 0, priority = false } = {}) {
    const saved = cache.get(path);
    if (saved && clock() - saved.t < cacheMs) return Promise.resolve(saved.value);
    if (pending.has(path)) return pending.get(path);
    const run = async () => {
      const cool = () => (priority ? coolingPri : cooling);
      if (clock() < cool()) throw Object.assign(error(429, "Jupiter rate limit reached. Please retry in a few seconds."), { cooling: true });
      const slot = Math.max(clock(), priority ? nextPri : next);
      if (slot - clock() > 12_000) throw error(429, "Jupiter is busy. Please retry in a few seconds.");
      if (priority) nextPri = slot + (key() ? 200 : 350); else next = slot + (key() ? 1100 : 2100);
      if (slot > clock()) await sleep(slot - clock());
      if (clock() < cool()) throw Object.assign(error(429, "Jupiter rate limit reached. Please retry in a few seconds."), { cooling: true });
      const headers = { accept: "application/json" };
      if (key()) headers["x-api-key"] = key();
      let r;
      // Keyless, the priority lane uses lite-api and the background stays on api.jup.ag, so each has its own
      // allowance: putting the background scans on lite-api too got this PC 429'd there within a minute
      // (2026-10-04), and lite-api also carries Discover's figures and Blix Vault's real swaps.
      try { r = await request(`https://${key() || !priority ? "api" : "lite-api"}.jup.ag${path}`, { headers, signal: AbortSignal.timeout(timeout) }); }
      catch { throw error(503, "Jupiter did not respond. Please retry in a few seconds."); }
      if (r.status === 429) {
        const until = clock() + Math.min(60, Math.max(3, Number(r.headers.get("retry-after")) || 3)) * 1000;
        if (priority) coolingPri = until; else cooling = until;
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
    const promise = run().catch((e) => {
      // An answered quote with no route is a coin's liquidity problem, not an outage.
      // A call refused locally while the lane cools down is not a new failure: only Jupiter's own answers count.
      if (e.status === 409) health.ok("jupiter"); else if (!e.cooling) health.fail("jupiter", e);
      throw e;
    }).finally(() => pending.delete(path));
    pending.set(path, promise);
    return promise;
  };
}

export const jupiterGet = createJupiterClient();
