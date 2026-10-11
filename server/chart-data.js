// Shared by candle ingestion and the browser. No network, storage, or Node dependencies.
export const positive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
export const validTime = (t, nowMs = Date.now()) => Number.isSafeInteger(t) && t > 0 && t <= nowMs / 1000 + 60;
export const validTrade = (mc, volume, ms, nowMs = Date.now()) => positive(mc) &&
  Number.isFinite(volume) && volume >= 0 && positive(ms) && ms <= nowMs + 60_000;

/** @param {any} x */
export function validBar(x, nowMs = Date.now()) {
  return x != null && validTime(x.time, nowMs) && [x.open, x.high, x.low, x.close].every(positive) &&
    x.high >= Math.max(x.open, x.close) && x.low <= Math.min(x.open, x.close);
}

// A duplicate is another snapshot of the same bar, not additional volume. Last valid snapshot wins.
/** @template T @param {T[]} rows @returns {T[]} */
export function normalizeBars(rows, nowMs = Date.now()) {
  const byTime = new Map();
  for (const x of Array.isArray(rows) ? rows : []) {
    if (!validBar(x, nowMs)) continue;
    const r = /** @type {any} */ (x);
    byTime.set(r.time, { ...r, value: Number.isFinite(r.value) && r.value >= 0 ? r.value : 0 });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

// Only traded bars are displayed. Never allocate one temporary bar for each second of a quiet year.
/** @template {{time:number,open:number,high:number,low:number,close:number}} T @param {T[]} rows @returns {T[]} */
export function continuousBars(rows, tf, fillMax) {
  let out = [];
  let prev;
  for (const x of normalizeBars(rows)) {
    if (prev) {
      if (Math.round((x.time - prev.time) / tf) - 1 > fillMax) out = [];
      const open = prev.close;
      out.push({ ...x, open, high: Math.max(x.high, open), low: Math.min(x.low, open) });
    } else out.push({ ...x });
    prev = x;
  }
  return out;
}

// Fomo reports USD per token. Unknown supply must never masquerade as USD market cap.
export function fomoMarketBars(bars, supply) {
  if (!positive(supply)) return [];
  return normalizeBars((Array.isArray(bars) ? bars : []).filter(Array.isArray).map(([time, o, h, l, c, value]) =>
    ({ time, open: o * supply, high: h * supply, low: l * supply, close: c * supply, value })));
}
