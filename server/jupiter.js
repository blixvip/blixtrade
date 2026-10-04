// One paced transport for quotes, SOL prices and the migrated column.
import { settings } from "./settings.js";
import * as health from "./health.js";

const error = (status, message) => Object.assign(new Error(message), { status });
export function createJupiterClient({ clock = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), request = (...args) => fetch(...args), key = () => settings.jupiterKey || "" } = {}) {
  let next = 0, cooling = 0;
  const pending = new Map(), cache = new Map();
  return function get(path, { timeout = 8000, cacheMs = 0 } = {}) {
    const saved = cache.get(path);
    if (saved && clock() - saved.t < cacheMs) return Promise.resolve(saved.value);
    if (pending.has(path)) return pending.get(path);
    const run = async () => {
      if (clock() < cooling) throw error(429, "Jupiter rate limit reached. Please retry in a few seconds.");
      const slot = Math.max(clock(), next);
      if (slot - clock() > 12_000) throw error(429, "Jupiter is busy. Please retry in a few seconds.");
      next = slot + (key() ? 1100 : 2100);
      if (slot > clock()) await sleep(slot - clock());
      if (clock() < cooling) throw error(429, "Jupiter rate limit reached. Please retry in a few seconds.");
      const headers = { accept: "application/json" };
      if (key()) headers["x-api-key"] = key();
      let r;
      try { r = await request(`https://api.jup.ag${path}`, { headers, signal: AbortSignal.timeout(timeout) }); }
      catch { throw error(503, "Jupiter did not respond. Please retry in a few seconds."); }
      if (r.status === 429) {
        cooling = clock() + Math.min(60, Math.max(3, Number(r.headers.get("retry-after")) || 3)) * 1000;
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
      if (e.status === 409) health.ok("jupiter"); else health.fail("jupiter", e);
      throw e;
    }).finally(() => pending.delete(path));
    pending.set(path, promise);
    return promise;
  };
}

export const jupiterGet = createJupiterClient();
