// Pure accounting primitives. Provider I/O and persistence live in heliuskeys.js.
export function rpcCredits(method, params = [], result, { failed = false } = {}) {
  if (method === 'getTransactionsForAddress') {
    if (failed) return 0;
    const options = params?.[1] || {};
    if (options.transactionDetails === 'signatures') return 10;
    const rows = Array.isArray(result) ? result : result?.data ?? result?.transactions;
    const n = result === undefined ? Math.min(1000, Math.max(1, Number(options.limit) || 1000)) : Array.isArray(rows) ? rows.length : 1000;
    return Math.max(10, Math.ceil(n / 100) * 10);
  }
  return ({ getProgramAccounts: 10, getAsset: 10, getAssetBatch: 10, getAssetsByOwner: 10, getTokenAccounts: 10 })[method] || 1;
}

export function dailyAllowance({ configured, remaining, limit, resetAt, now = Date.now(), spent = 0, externalDaily = 0 }) {
  const cap = Math.max(0, Number(configured) || 0);
  if (!Number.isFinite(remaining) || !Number.isFinite(limit) || !Number.isFinite(resetAt)) return cap;
  const usable = Math.max(0, remaining - limit * 0.03);
  return Math.max(0, Math.min(cap, Math.floor(spent + usable / Math.max(1, (resetAt - now) / 864e5) - externalDaily)));
}

// Release a day's credits evenly until midnight UTC, with only five minutes of
// startup headroom. Keep 10% outside admission for in-flight traffic and metering lag.
export function pacedAllowance({ daily, now = Date.now() }) {
  const elapsed = ((now % 864e5) + 864e5) % 864e5;
  return Math.max(0, Number(daily) || 0) * .9 * (elapsed + 300_000) / (864e5 + 300_000);
}

export function createBudget({ now = Date.now, allowance, rate = 8, spent: initial = 0, byPriority = {} } = {}) {
  let spent = initial, reserved = 0, tokens = rate, filled = now();
  const used = { price: 0, metrics: 0, history: 0, ...byPriority }, pending = { price: 0, metrics: 0, history: 0 };
  return {
    reserve({ cost, priority = 'metrics' }) {
      if (!(Number.isFinite(cost) && cost >= 0) || !(priority in used)) return null;
      const t = now(), cap = Math.max(0, allowance());
      tokens = Math.min(rate, tokens + Math.max(0, t - filled) / 1000 * rate); filled = t;
      if (tokens < 1 || spent + reserved + cost > cap) return null;
      // Leave the last fifth of the daily allowance for prices and execution.
      if (priority !== 'price' && spent + reserved + cost > cap * .8) return null;
      if (priority !== 'price' && used.metrics + used.history + pending.metrics + pending.history + cost > cap * 0.25) return null;
      if (priority === 'history' && used.history + pending.history + cost > cap * 0.05) return null;
      tokens--; reserved += cost; pending[priority] += cost;
      let done = false;
      const finish = actual => {
        if (done) return; done = true;
        reserved -= cost; pending[priority] -= cost;
        const value = Number.isFinite(actual) && actual >= 0 ? actual : cost;
        spent += value; used[priority] += value;
      };
      return { settle: finish, cancel: () => finish(0) };
    },
    note(cost, priority = 'price') { if (Number.isFinite(cost) && cost > 0) { spent += cost; used[priority in used ? priority : 'metrics'] += cost; } },
    status: () => ({ spent, reserved, byPriority: { ...used }, pending: { ...pending } }),
  };
}
