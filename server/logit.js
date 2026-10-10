// The early radar's model: logistic regression fit by gradient descent, as pure functions with no dependencies, so
// the same code runs on the radar's thread (early.js: tests, a manual retrain) and on a worker thread
// (fitworker.js: the every-10-minutes training, which on a one-core host took a fifth of the main thread).
export const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// The fit is written as steps so a caller can give the radar a turn between them (`fit` runs them straight
// through). A step gives way after ~SLICE_MS of work, not after a count of passes.
export const SLICE_MS = 12;
export function* fitSteps(X, y, { iters = 500, lr = 0.2, l2 = 0.01 } = {}) {
  const n = X.length, d = X[0].length;
  let since = performance.now();
  const late = () => performance.now() - since > SLICE_MS;
  const mu = Array(d).fill(0), sd = Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mu[j] += x[j] / n;
  for (const x of X) for (let j = 0; j < d; j++) sd[j] += (x[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = [];
  for (let i = 0; i < n; i++) {
    Z.push(X[i].map((v, j) => (v - mu[j]) / sd[j]));
    if ((i & 1023) === 1023 && late()) { yield; since = performance.now(); }
  }
  const w = Array(d).fill(0);
  const base = y.reduce((a, b) => a + b, 0) / n;
  let b = Math.log(Math.max(1e-4, base) / Math.max(1e-4, 1 - base));
  for (let it = 0; it < iters; it++) {
    const g = Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      if ((i & 1023) === 1023 && late()) { yield; since = performance.now(); }
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const e = sigmoid(z) - y[i];
      gb += e / n;
      for (let j = 0; j < d; j++) g[j] += (e * Z[i][j]) / n;
    }
    b -= lr * gb;
    for (let j = 0; j < d; j++) w[j] -= lr * (g[j] + l2 * w[j]);
    if (late()) { yield; since = performance.now(); }
  }
  return { w, b, mu, sd };
}
export const drain = (g) => { let r; while (!(r = g.next()).done); return r.value; };
export const fit = (X, y, opts) => drain(fitSteps(X, y, opts));
export function predict(m, x) {
  let z = m.b;
  for (let j = 0; j < x.length; j++) z += m.w[j] * ((x[j] - m.mu[j]) / m.sd[j]);
  return sigmoid(z);
}
