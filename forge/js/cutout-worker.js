// Segmentation worker. Inference is a blocking call, so it lives off the main
// thread: the canvas stays interactive (you can keep dragging the subject)
// while a cutout is computing.
import * as ort from '../vendor/ort/ort.webgpu.bundle.min.mjs';

ort.env.wasm.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
// Threads need COOP/COEP (the server sends them). If the headers are missing,
// crossOriginIsolated is false and multi-threaded wasm would throw on spawn.
ort.env.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))
  : 1;
ort.env.wasm.simd = true;
ort.env.logLevel = 'error';

// Both candidates were measured against real photos before being picked:
// quantised RMBG-1.4 (1024px) was ~5x slower than u2netp *and* left far more
// half-transparent background behind, and full u2net matched silueta while
// weighing 176MB, so neither shipped.
export const MODELS = {
  // u2netp: 4.5MB. The everyday one - around 0.7s, clean on ordinary subjects.
  fast: { file: '../models/u2netp.onnx', size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], norm: 'max' },
  // silueta: 44MB, same architecture family and input size, better weights.
  // Roughly 2x the time for visibly tighter edges on hard shots.
  hq: { file: '../models/silueta.onnx', size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], norm: 'max' },
};

const sessions = new Map();
let activeEP = null;

// wasm is the default rather than webgpu. Measured on this class of machine
// (6-core CPU, Intel UHD 630) multi-threaded wasm matched or beat the GPU on
// both models and compiled ~7x faster, so preferring webgpu would have cost a
// second of startup to end up slower. A discrete GPU flips that, which is what
// the preferGPU switch is for.
async function getSession(key, preferGPU = false) {
  const ck = key + (preferGPU ? ':gpu' : '');
  if (sessions.has(ck)) return sessions.get(ck);
  const m = MODELS[key];
  const url = new URL(m.file, import.meta.url).href;
  const eps = preferGPU ? ['webgpu', 'wasm'] : ['wasm', 'webgpu'];
  let lastErr;
  for (const ep of eps) {
    try {
      const s = await ort.InferenceSession.create(url, {
        executionProviders: [ep],
        graphOptimizationLevel: 'all',
      });
      s._ep = ep;
      activeEP = ep;
      sessions.set(ck, s);
      return s;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** One throwaway inference so the first real click doesn't pay kernel setup. */
async function prime(s, size) {
  try {
    const z = new Float32Array(3 * size * size);
    await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', z, [1, 3, size, size]) });
  } catch { /* priming is best-effort */ }
}

// rembg divides by the image's own max before standardising; replicating it
// keeps masks identical to the reference implementation instead of "close".
function preprocess(rgba, size, m) {
  const n = size * size;
  const t = new Float32Array(3 * n);
  let max = 1;
  if (m.norm === 'max') {
    for (let i = 0; i < n; i++) {
      if (rgba[i * 4] > max) max = rgba[i * 4];
      if (rgba[i * 4 + 1] > max) max = rgba[i * 4 + 1];
      if (rgba[i * 4 + 2] > max) max = rgba[i * 4 + 2];
    }
  } else max = 255;
  for (let i = 0; i < n; i++) {
    t[i] = (rgba[i * 4] / max - m.mean[0]) / m.std[0];
    t[n + i] = (rgba[i * 4 + 1] / max - m.mean[1]) / m.std[1];
    t[2 * n + i] = (rgba[i * 4 + 2] / max - m.mean[2]) / m.std[2];
  }
  return t;
}

self.onmessage = async (ev) => {
  const { id, type, model, rgba, size, gpu } = ev.data;
  try {
    if (type === 'warm') {
      const key = model in MODELS ? model : 'fast';
      const s = await getSession(key, !!gpu);
      await prime(s, MODELS[key].size);
      self.postMessage({ id, ok: true, ep: s._ep });
      return;
    }
    const t0 = performance.now();
    const key = model in MODELS ? model : 'fast';
    const m = MODELS[key];
    const s = await getSession(key, !!gpu);
    activeEP = s._ep;
    const tReady = performance.now();

    const input = new ort.Tensor('float32', preprocess(rgba, size, m), [1, 3, size, size]);
    const out = await s.run({ [s.inputNames[0]]: input });
    const first = out[s.outputNames[0]];
    const d = first.data;

    // Both nets emit unbounded saliency logits; min-max is how rembg turns them
    // into an alpha ramp, and it also absorbs the normalisation differences.
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < d.length; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
    const span = hi - lo || 1;
    const mask = new Uint8ClampedArray(size * size);
    for (let i = 0; i < mask.length; i++) mask[i] = ((d[i] - lo) / span) * 255;

    self.postMessage(
      { id, ok: true, mask, size, ep: activeEP, ms: Math.round(performance.now() - t0), loadMs: Math.round(tReady - t0) },
      [mask.buffer]);
  } catch (e) {
    self.postMessage({ id, ok: false, error: String((e && e.message) || e) });
  }
};
