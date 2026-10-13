// Export pack: one artwork, every file a launch actually needs.
//
// The model matters here. A target is a *crop of the finished artwork*, not a
// fresh layout — because the moment a backdrop is a photo, re-laying the subject
// out independently desynchronises the two and you get a small subject floating
// over a giant blurry copy of itself. Cropping the master keeps the subject, its
// rim light and its background locked together at every size, and it only costs
// one full render for the whole pack.
//
// The exception is a transparent document: there is nothing to crop against, so
// the subject is scaled to fit the frame instead of being beheaded by it.

import * as D from './doc.js';

/**
 * zoom  — how far past "just covering" to push the crop. Needed before a bias
 *         can move anywhere: a 1:1 master covering a 3:1 strip has no
 *         horizontal slack at all.
 * biasX — shift the crop window, as a fraction of frame width.
 */
export const TARGETS = [
  { id: 'master', name: 'Master', file: 'master.png', doc: true, note: 'the canvas as-is' },
  { id: 'cutout', name: 'Cutout', file: 'cutout.png', doc: true, bg: 'none', note: 'transparent PNG' },
  { id: 'x-avatar', name: 'X / PFP', file: 'x-avatar-400.png', w: 400, h: 400, note: 'circle-cropped in use' },
  { id: 'x-header', name: 'X header', file: 'x-header-1500x500.png', w: 1500, h: 500, zoom: 1.1 },
  {
    id: 'dex-banner', name: 'DEX banner', file: 'dex-banner-1500x500.png', w: 1500, h: 500,
    // DexScreener lays the token icon, name and ticker over the left of its
    // header, so the crop is pushed right to keep the subject out from under
    // them. The zoom is what creates the horizontal slack to shift into. How
    // much left margin this actually wins depends on the art: a subject that
    // already spans the frame cannot be cropped out of its own way, so this is
    // a good default rather than a guarantee — drag the layer to fine-tune.
    zoom: 1.4, biasX: 0.16,
    note: 'crop pushed right, clear of the token overlay',
  },
  { id: 'dex-icon', name: 'DEX icon', file: 'dex-icon-512.png', w: 512, h: 512 },
  { id: 'telegram', name: 'Telegram / Discord', file: 'telegram-512.png', w: 512, h: 512 },
  { id: 'og', name: 'OG card', file: 'og-1200x630.png', w: 1200, h: 630, zoom: 1.05 },
  { id: 'post', name: 'Post', file: 'post-1080.png', w: 1080, h: 1080 },
  { id: 'story', name: 'Story', file: 'story-1080x1920.png', w: 1080, h: 1920 },
];

/** Axis-aligned box around everything visible, in document pixels. */
export function contentBounds(doc) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of doc.layers) {
    if (!l.visible) continue;
    const box = D.layerBox(l);
    // A rotated rectangle's bounding box is wider than the rectangle.
    const a = (l.rot * Math.PI) / 180;
    const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const hw = (box.w * c + box.h * s) / 2;
    const hh = (box.w * s + box.h * c) / 2;
    x0 = Math.min(x0, l.x - hw); x1 = Math.max(x1, l.x + hw);
    y0 = Math.min(y0, l.y - hh); y1 = Math.max(y1, l.y + hh);
  }
  if (x1 === -Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const cv = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

export const targetSize = (doc, t) => (t.doc ? { w: doc.w, h: doc.h } : { w: t.w, h: t.h });

/** Render the document once, at its own size. Reused by every cropped target. */
export function renderMaster(doc, { transparent = false, scale = 1 } = {}) {
  const c = cv(doc.w * scale, doc.h * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  D.render(ctx, transparent ? { ...doc, bg: { kind: 'none' } } : doc);
  return c;
}

/** Where the master lands inside the frame: cover, zoomed, then shifted. */
export function cropRect(mw, mh, t) {
  const W = t.w, H = t.h;
  const s = Math.max(W / mw, H / mh) * (t.zoom || 1);
  const dw = mw * s, dh = mh * s;
  // Clamp, so a bias can never drag an edge into frame and expose a gap.
  const x = Math.min(0, Math.max(W - dw, (W - dw) / 2 + (t.biasX || 0) * W));
  const y = Math.min(0, Math.max(H - dh, (H - dh) / 2 + (t.biasY || 0) * H));
  return { x, y, w: dw, h: dh };
}

/**
 * Transparent documents have no backdrop to crop against, so the subject is
 * fitted inside the frame instead. Returns a doc-shaped object to render.
 */
function fitted(doc, t) {
  const b = contentBounds(doc) || { x: 0, y: 0, w: doc.w, h: doc.h };
  const pad = t.pad ?? 0.9;
  const s = Math.min((t.w * pad) / b.w, (t.h * pad) / b.h);
  const cx = t.w / 2 + (t.biasX || 0) * t.w;
  const cy = t.h / 2 + (t.biasY || 0) * t.h;
  const ox = b.x + b.w / 2, oy = b.y + b.h / 2;
  return {
    w: t.w, h: t.h, bg: { kind: 'none' }, selected: null,
    // Layers share their cached bitmaps; only placement changes.
    layers: doc.layers.map(l => ({
      ...l, x: (l.x - ox) * s + cx, y: (l.y - oy) * s + cy, scale: l.scale * s,
    })),
  };
}

/**
 * @param master optional pre-rendered master, to avoid re-rendering per target
 */
export function renderTarget(doc, t, master = null) {
  if (t.doc) return renderMaster(doc, { transparent: t.bg === 'none' });
  if (doc.bg.kind === 'none') {
    const f = fitted(doc, t);
    const c = cv(t.w, t.h);
    D.render(c.getContext('2d'), f);
    return c;
  }
  const m = master || renderMaster(doc);
  const c = cv(t.w, t.h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const r = cropRect(m.width, m.height, t);
  ctx.drawImage(m, r.x, r.y, r.w, r.h);
  return c;
}

/** Render every selected target, sharing one master render. */
export function renderAll(doc, targets, onStep) {
  const needsMaster = targets.some(t => !t.doc && doc.bg.kind !== 'none');
  const master = needsMaster ? renderMaster(doc) : null;
  return targets.map((t, i) => {
    onStep && onStep(t, i);
    return { target: t, canvas: renderTarget(doc, t, master) };
  });
}

/** Draw a target into a preview canvas of a given width. */
export function drawTargetThumb(canvas, doc, t, master = null) {
  const size = targetSize(doc, t);
  const s = canvas.width / size.w;
  canvas.height = Math.max(1, Math.round(size.h * s));
  const ctx = canvas.getContext('2d');
  // Checkerboard first, so a transparent target reads as transparent.
  const q = Math.max(4, Math.round(canvas.width / 14));
  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#363636';
  for (let y = 0, r = 0; y < canvas.height; y += q, r++) {
    for (let x = (r % 2 ? q : 0); x < canvas.width; x += q * 2) ctx.fillRect(x, y, q, q);
  }
  const full = renderTarget(doc, t, master);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, canvas.width, canvas.height);
}
