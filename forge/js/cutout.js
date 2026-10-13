// Main-thread side of background removal: feeds the worker, then owns the mask
// and every refinement you can scrub in real time (feather, edge shift, brush,
// wand). Only the AI pass is expensive; everything else is a canvas filter.

const WORKER_URL = new URL('./cutout-worker.js', import.meta.url);
let worker = null;
let seq = 0;
const pending = new Map();
export let lastEP = null;

// Masks are soft by nature and the nets only emit 320px or 1024px of real
// detail, so there is nothing to gain from carrying one at 20MP - and plenty to
// lose: every refine pass would stop being interactive.
export const MASK_MAX = 1400;

function hub() {
  if (worker) return worker;
  worker = new Worker(WORKER_URL, { type: 'module' });
  worker.onmessage = (ev) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.ep) lastEP = ev.data.ep;
    ev.data.ok ? p.resolve(ev.data) : p.reject(new Error(ev.data.error));
  };
  worker.onerror = (e) => {
    const err = new Error('cutout worker failed to load' + (e.message ? ': ' + e.message : ''));
    pending.forEach(p => p.reject(err));
    pending.clear();
    worker = null;
  };
  return worker;
}

function ask(msg, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    hub().postMessage({ ...msg, id }, transfer);
  });
}

/** Compile and prime the model ahead of the first click, so the click is just the run. */
export const warm = (model = 'fast', gpu = false) => ask({ type: 'warm', model, gpu }).catch(() => null);

export function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Mask dimensions for a source of this size. */
export function maskDims(w, h) {
  const s = Math.min(1, MASK_MAX / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s };
}

/**
 * Run segmentation on a source canvas.
 * Resolves to a grayscale (white = keep) canvas at mask resolution.
 */
export const MODEL_SIZE = { fast: 320, hq: 320 };

export async function segment(src, model = 'fast', gpu = false) {
  const size = MODEL_SIZE[model] || 320;
  // Direct square resize, matching how these nets were trained and served -
  // letterboxing instead changes the subject's scale and softens the mask.
  const small = cv(size, size);
  const sc = small.getContext('2d', { willReadFrequently: true });
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(src, 0, 0, size, size);
  const rgba = sc.getImageData(0, 0, size, size).data;

  const res = await ask({ type: 'segment', model, size, rgba, gpu }, [rgba.buffer]);

  const mg = cv(size, size);
  const mc = mg.getContext('2d');
  const img = mc.createImageData(size, size);
  for (let i = 0; i < res.mask.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = res.mask[i];
    img.data[i * 4 + 3] = 255;
  }
  mc.putImageData(img, 0, 0);

  const d = maskDims(src.width, src.height);
  const full = cv(d.w, d.h);
  const fc = full.getContext('2d');
  fc.imageSmoothingEnabled = true;
  fc.imageSmoothingQuality = 'high';
  fc.drawImage(mg, 0, 0, d.w, d.h);
  full.meta = { ms: res.ms, ep: res.ep, model };
  return full;
}

// The alpha remap is a straight line: v' = v*slope + intercept. Expressing that
// as CSS brightness()+contrast() does not work - each function clamps to 0..1
// before the next one runs, so any line whose midpoint overshoots comes back
// wrong (pushing the edge in and out gave the *same* mask). feComponentTransfer
// applies slope and intercept in one pass with no intermediate clamp, so it is
// both exact and a single GPU hop. A pixel LUT stands in if it isn't honoured.
const SVG_NS = 'http://www.w3.org/2000/svg';
let remapFilter = null;
let remapOK = null;

function remapNode() {
  if (remapFilter) return remapFilter;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  const f = document.createElementNS(SVG_NS, 'filter');
  f.setAttribute('id', 'mf-remap');
  // Without sRGB the browser converts to linear light first and the numbers
  // stop meaning what the slider says.
  f.setAttribute('color-interpolation-filters', 'sRGB');
  const t = document.createElementNS(SVG_NS, 'feComponentTransfer');
  remapFilter = { svg, funcs: [] };
  for (const ch of ['R', 'G', 'B']) {
    const fn = document.createElementNS(SVG_NS, 'feFunc' + ch);
    fn.setAttribute('type', 'linear');
    t.append(fn);
    remapFilter.funcs.push(fn);
  }
  f.append(t);
  svg.append(f);
  document.body.append(svg);
  return remapFilter;
}

function setRemap(slope, intercept) {
  const n = remapNode();
  for (const fn of n.funcs) {
    fn.setAttribute('slope', slope.toFixed(5));
    fn.setAttribute('intercept', intercept.toFixed(5));
  }
}

function svgRemapWorks() {
  if (remapOK !== null) return remapOK;
  const a = cv(1, 1);
  const ac = a.getContext('2d');
  ac.fillStyle = '#fff';
  ac.fillRect(0, 0, 1, 1);
  const b = cv(1, 1);
  const bc = b.getContext('2d', { willReadFrequently: true });
  setRemap(0, 0.5);            // everything should collapse to mid grey
  bc.filter = 'url(#mf-remap)';
  bc.drawImage(a, 0, 0);
  bc.filter = 'none';
  const v = bc.getImageData(0, 0, 1, 1).data[0];
  remapOK = Math.abs(v - 128) <= 6;
  return remapOK;
}

function remapLUT(ctx, w, h, slope, intercept) {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = (i / 255 * slope + intercept) * 255;
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = lut[px[i]];
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
}

/**
 * Tune a raw mask: blur for soft edges, then remap so the alpha midpoint can be
 * pushed in (kills the halo of old background) or out (recovers hair).
 *   edge     -40..40  shifts which grey level becomes the 50% line
 *   contrast  1..6    how abruptly the edge crosses from keep to drop
 */
export function refine(mask, { feather = 1.4, edge = 0, contrast = 1 } = {}) {
  const w = mask.width, h = mask.height;
  const blur = (feather / 100) * Math.min(w, h) * 0.5;
  const soft = cv(w, h);
  const sc = soft.getContext('2d', { willReadFrequently: true });
  sc.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : 'none';
  sc.drawImage(mask, 0, 0);
  sc.filter = 'none';
  if (edge === 0 && contrast === 1) return soft;

  const mid = Math.min(0.9, Math.max(0.1, 0.5 - (edge / 100) * 0.5));
  const k = 1 / Math.max(0.2, contrast);
  const slope = 1 / k;
  const intercept = 0.5 - mid / k;

  if (svgRemapWorks()) {
    setRemap(slope, intercept);
    const out = cv(w, h);
    const oc = out.getContext('2d');
    oc.filter = 'url(#mf-remap)';
    oc.drawImage(soft, 0, 0);
    oc.filter = 'none';
    return out;
  }
  remapLUT(sc, w, h, slope, intercept);
  return soft;
}

/** Paint on a stroke layer. 'erase' stamps black, 'restore' stamps white. */
export function brush(strokes, pts, { radius, hardness = 0.6, mode = 'erase' }) {
  const ctx = strokes.getContext('2d');
  const c = mode === 'erase' ? '0,0,0' : '255,255,255';
  for (const [x, y] of pts) {
    const g = ctx.createRadialGradient(x, y, radius * hardness, x, y, radius);
    g.addColorStop(0, `rgba(${c},1)`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 7);
    ctx.fill();
  }
  return strokes;
}

/**
 * Flood-fill wand: instant, model-free removal for flat or near-flat
 * backgrounds (logos, screenshots, studio shots). Scanline fill, so a large
 * region finishes without recursion depth blowing the stack.
 * `sx,sy` are in stroke-layer pixels.
 */
export function wand(src, strokes, sx, sy, tolerance = 28, feather = 1) {
  const w = strokes.width, h = strokes.height;
  // Sample the photo at mask resolution so pixel indices line up 1:1.
  const samp = cv(w, h);
  const scx = samp.getContext('2d', { willReadFrequently: true });
  scx.imageSmoothingQuality = 'high';
  scx.drawImage(src, 0, 0, w, h);
  const d = scx.getImageData(0, 0, w, h).data;

  const x0 = Math.round(sx), y0 = Math.round(sy);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return strokes;
  const i0 = (y0 * w + x0) * 4;
  const r0 = d[i0], g0 = d[i0 + 1], b0 = d[i0 + 2];
  const tol = tolerance * tolerance * 3;
  const seen = new Uint8Array(w * h);
  const hit = new Uint8Array(w * h);
  const near = (p) => {
    const i = p * 4;
    const dr = d[i] - r0, dg = d[i + 1] - g0, db = d[i + 2] - b0;
    return dr * dr + dg * dg + db * db <= tol;
  };
  const stack = [y0 * w + x0];
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    const y = (p / w) | 0;
    let xl = p % w;
    while (xl > 0 && !seen[y * w + xl - 1] && near(y * w + xl - 1)) xl--;
    let xr = p % w;
    while (xr < w - 1 && !seen[y * w + xr + 1] && near(y * w + xr + 1)) xr++;
    for (let x = xl; x <= xr; x++) {
      const q = y * w + x;
      seen[q] = 1;
      hit[q] = 1;
      if (y > 0) { const u = q - w; if (!seen[u] && near(u)) stack.push(u); }
      if (y < h - 1) { const u = q + w; if (!seen[u] && near(u)) stack.push(u); }
    }
  }

  // Build the stamp as opaque black on its own canvas, then draw it in blurred.
  // Compositing it (rather than filtering the stroke layer) keeps earlier
  // strokes untouched and feathers only this new edge.
  const cut = cv(w, h);
  const cc = cut.getContext('2d');
  const ci = cc.createImageData(w, h);
  for (let p = 0; p < w * h; p++) if (hit[p]) ci.data[p * 4 + 3] = 255;
  cc.putImageData(ci, 0, 0);
  cc.globalCompositeOperation = 'source-in';
  cc.fillStyle = '#000';
  cc.fillRect(0, 0, w, h);

  const ctx = strokes.getContext('2d');
  ctx.save();
  if (feather > 0) ctx.filter = `blur(${feather}px)`;
  ctx.drawImage(cut, 0, 0);
  ctx.restore();
  return strokes;
}

/** A fully opaque mask - the "nothing removed yet" starting state. */
export function solidMask(w, h) {
  const d = maskDims(w, h);
  const m = cv(d.w, d.h);
  const c = m.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, d.w, d.h);
  return m;
}
