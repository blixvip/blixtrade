// The list mini charts' shape rules (server.js sparkFor), kept apart so the tests can check them without
// starting the radar. Points are [ms, market cap].

// A candle as the line passes through it: its open at the start, its low and high in the order they most
// likely came (a green candle dips first, a red one peaks first), its close at the end (or now, for the
// candle still filling).
export function candlePts(cs, tf, nowMs = Date.now()) {
  const out = [];
  for (const c of cs) {
    const t = c.time * 1000, end = Math.max(t + 1, Math.min(t + tf * 1000, nowMs));
    const [a, b] = c.close >= c.open ? [c.low, c.high] : [c.high, c.low];
    out.push([t, c.open]);
    if (a !== c.open && a !== c.close) out.push([t + (end - t) / 3, a]);
    if (b !== c.open && b !== c.close) out.push([t + (2 * (end - t)) / 3, b]);
    out.push([end, c.close]);
  }
  return out;
}

// Prices only change when someone trades. Between two points further apart than the source's resolution
// (`res` ms: a candle's size, the feed's second, the snapshots' minute) nothing traded, so the price sat at
// the earlier value until the later point: the line holds flat and then steps, never ramps across the
// silence (a ramp drew moves that never happened: a coin flat for hours sloping up to its latest price).
export function holdFlat(pts, res) {
  const out = [];
  for (const q of pts) {
    const a = out[out.length - 1];
    if (a && q[0] - a[0] > res && q[1] !== a[1]) out.push([q[0], a[1]]);
    out.push(q);
  }
  return out;
}

// At most `B` time buckets across the window, each keeping its first, lowest, highest and last point in the
// order they happened (by position, not time: a flat hold and the step after it share a time and must stay
// in that order), so no spike is thinned away. Returns [[x 0..1 of the window, mc], ...].
export function downsample(pts, since, ms, B = 40) {
  const out = [];
  let b = 0, bucket = [];
  const flush = () => {
    if (!bucket.length) return;
    let lo = 0, hi = 0;
    bucket.forEach((q, i) => { if (q[1] < bucket[lo][1]) lo = i; if (q[1] > bucket[hi][1]) hi = i; });
    out.push(...[...new Set([0, lo, hi, bucket.length - 1])].sort((x, y) => x - y).map((i) => bucket[i]));
    bucket = [];
  };
  for (const q of pts) {
    const k = Math.min(B - 1, Math.max(0, Math.floor(((q[0] - since) / ms) * B)));
    if (k !== b) { flush(); b = k; }
    bucket.push(q);
  }
  flush();
  return out.map(([x, mc]) => [Math.round(Math.max(0, (x - since) / ms) * 1000) / 1000, Math.round(mc)]);
}
