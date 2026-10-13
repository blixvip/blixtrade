// Document model + renderer. One rule keeps the editor fast: a layer's pixels
// are composited into a cached bitmap, and that cache is only rebuilt when the
// layer's *pixels* change. Moving, scaling and rotating never touch it, so a
// drag is just drawImage per layer regardless of photo size.

import { drawBG } from './bgs.js';
import { buildAura, auraPad, auraColors } from './aura.js';
import { familyOf } from './fonts.js';

let nextId = 1;

export const PRESETS = [
  { id: 'square', name: 'Square', sub: '1:1 · 1600', w: 1600, h: 1600 },
  { id: 'post', name: 'Post', sub: '4:5 · 1600', w: 1600, h: 2000 },
  { id: 'story', name: 'Story', sub: '9:16 · 1080', w: 1080, h: 1920 },
  { id: 'wide', name: 'Wide', sub: '16:9 · 1920', w: 1920, h: 1080 },
  { id: 'banner', name: 'DEX banner', sub: '3:1 · 1500', w: 1500, h: 500 },
  { id: 'pfp', name: 'PFP', sub: '1:1 · 1000', w: 1000, h: 1000 },
];

export function newDoc(preset = PRESETS[0]) {
  return {
    w: preset.w,
    h: preset.h,
    presetId: preset.id,
    // A new document starts plain and transparent, not on some coloured
    // backdrop the user has to notice and undo.
    bg: { kind: 'none' },
    layers: [],
    selected: null,
  };
}

export function addImageLayer(doc, bitmap, { mask = null, name = 'Photo' } = {}) {
  // Fit to ~82% of the frame: big enough to work with, never clipped on arrival.
  const fit = Math.min(doc.w / bitmap.width, doc.h / bitmap.height) * 0.82;
  const layer = {
    id: nextId++,
    kind: 'image',
    name,
    src: bitmap,
    mask,                 // grayscale canvas (white = keep), null = fully opaque
    rawMask: null,        // untouched AI output, so the refine sliders stay live
    strokes: null,        // brush/wand edits, kept apart so refine can re-run
    cut: false,           // has the background actually been removed yet
    pixRev: 0,            // bumped when mask pixels change, so history can dedupe
    x: doc.w / 2,
    y: doc.h / 2,
    scale: fit,
    rot: 0,
    flipX: false,
    opacity: 1,
    visible: true,
    blend: 'normal',
    locked: false,
    adj: { bri: 100, con: 100, sat: 100, hue: 0, blur: 0 },
    fx: {
      outline: 0, outlineColor: '#ffffff',
      shadow: 0, shadowColor: '#000000',
      aura: 0, auraSize: 50, auraWarp: 45, auraSeed: 7, auraPreset: 'gold',
      auraCore: '#fffce8', auraMid: '#ffd21a', auraOuter: '#ff7a00',
    },
    _cache: null,
    _key: '',
  };
  doc.layers.push(layer);
  doc.selected = layer.id;
  return layer;
}

export function addTextLayer(doc, text = 'TEXT') {
  const layer = {
    id: nextId++,
    kind: 'text',
    name: text.slice(0, 18) || 'Text',
    text,
    font: 'impact',
    weight: 400,
    lineH: 1.1,
    size: Math.round(Math.min(doc.w, doc.h) * 0.13),
    color: '#ffffff',
    stroke: '#000000',
    strokeW: 10,
    tracking: 0,
    caps: true,
    align: 'center',
    x: doc.w / 2,
    y: doc.h * 0.84,
    scale: 1,
    rot: 0,
    opacity: 1,
    visible: true,
    blend: 'normal',
    locked: false,
    fx: { shadow: 14, shadowColor: '#000000', glow: 0, glowColor: '#00f5d4' },
    _cache: null,
    _key: '',
  };
  doc.layers.push(layer);
  doc.selected = layer.id;
  return layer;
}

export const getSelected = (doc) => doc.layers.find(l => l.id === doc.selected) || null;

export function removeLayer(doc, id) {
  doc.layers = doc.layers.filter(l => l.id !== id);
  if (doc.selected === id) doc.selected = doc.layers.length ? doc.layers[doc.layers.length - 1].id : null;
}

export const BLEND_MODES = [
  ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Dodge'], ['color-burn', 'Burn'],
  ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'],
  ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'],
  ['luminosity', 'Luminosity'], ['lighter', 'Add'],
];

/** Move a layer in the stack. to is clamped; returns true if anything moved. */
export function reorder(doc, id, to) {
  const from = doc.layers.findIndex(l => l.id === id);
  if (from < 0) return false;
  const t = Math.max(0, Math.min(doc.layers.length - 1, to));
  if (t === from) return false;
  const [l] = doc.layers.splice(from, 1);
  doc.layers.splice(t, 0, l);
  return true;
}

/** step: +1 forward (up the stack), -1 back, Infinity/-Infinity for front/back. */
export function arrange(doc, id, step) {
  const from = doc.layers.findIndex(l => l.id === id);
  if (from < 0) return false;
  const to = step === Infinity ? doc.layers.length - 1 : step === -Infinity ? 0 : from + step;
  return reorder(doc, id, to);
}

/** Invalidate a layer's pixel cache. Call after mask/adjustment/fx/text edits. */
export const touch = (l) => { if (l) { l._cache = null; l._key = ''; } };

const cv = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

// ---- layer bitmaps ----------------------------------------------------------

function buildImageBitmap(l) {
  const w = l.src.width, h = l.src.height;
  const a = l.adj;
  const base = cv(w, h);
  const bc = base.getContext('2d');
  bc.filter = `brightness(${a.bri}%) contrast(${a.con}%) saturate(${a.sat}%) hue-rotate(${a.hue}deg)`
    + (a.blur > 0 ? ` blur(${(a.blur / 100) * Math.min(w, h) * 0.04}px)` : '');
  bc.drawImage(l.src, 0, 0);
  bc.filter = 'none';
  if (l.mask) {
    // The mask is grayscale-opaque, so its luminance has to become alpha before
    // destination-in can use it. The conversion runs at *mask* resolution and
    // the result is upscaled by the GPU - doing it at photo resolution would
    // cost a 20M-iteration loop on every slider frame.
    const mw = l.mask.width, mh = l.mask.height;
    const am = cv(mw, mh);
    const ac = am.getContext('2d', { willReadFrequently: true });
    ac.drawImage(l.mask, 0, 0);
    const d = ac.getImageData(0, 0, mw, mh);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i + 3] = px[i];
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
    ac.putImageData(d, 0, 0);
    bc.globalCompositeOperation = 'destination-in';
    bc.imageSmoothingQuality = 'high';
    bc.drawImage(am, 0, 0, w, h);
    bc.globalCompositeOperation = 'source-over';
  }

  const o = l.fx;
  const pad = Math.max(
    Math.ceil((o.outline / 100) * Math.min(w, h) * 0.08),
    o.aura > 0 ? auraPad(base, o.auraSize) : 0,
  ) + 4;
  const out = cv(w + pad * 2, h + pad * 2);
  const oc = out.getContext('2d');

  // Aura goes down first: it is light coming from behind the subject, so every
  // other effect and the subject itself sit on top of it.
  if (o.aura > 0) {
    const a = buildAura(base, pad, {
      size: o.auraSize, warp: o.auraWarp, seed: o.auraSeed, colors: auraColors(o),
    });
    if (a) {
      oc.save();
      oc.globalAlpha = Math.min(1, o.aura / 100);
      // 'lighter' so the rim adds to whatever backdrop is behind it rather than
      // pasting an opaque halo over it.
      oc.globalCompositeOperation = 'lighter';
      oc.drawImage(a, 0, 0);
      oc.restore();
    }
  }

  if (o.outline > 0) {
    // Sticker outline = the alpha shape smeared in a ring and flattened. Cheaper
    // and smoother than tracing a contour, and it matches how stickers read.
    const r = (o.outline / 100) * Math.min(w, h) * 0.055;
    const sil = cv(out.width, out.height);
    const sc = sil.getContext('2d');
    const steps = 20;
    for (let i = 0; i < steps; i++) {
      const a2 = (i / steps) * Math.PI * 2;
      sc.drawImage(base, pad + Math.cos(a2) * r, pad + Math.sin(a2) * r);
    }
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = o.outlineColor;
    sc.fillRect(0, 0, out.width, out.height);
    oc.drawImage(sil, 0, 0);
  }
  if (o.shadow > 0) {
    oc.save();
    oc.shadowColor = o.shadowColor;
    oc.shadowBlur = (o.shadow / 100) * Math.min(w, h) * 0.12;
    oc.shadowOffsetY = (o.shadow / 100) * Math.min(w, h) * 0.05;
    oc.drawImage(base, pad, pad);
    oc.restore();
  }
  oc.drawImage(base, pad, pad);
  out._pad = pad;
  return out;
}

function buildTextBitmap(l) {
  const probe = cv(8, 8).getContext('2d');
  const txt = l.caps ? l.text.toUpperCase() : l.text;
  const lines = txt.split('\n');
  const font = `${l.weight || 400} ${l.size}px ${familyOf(l.font)}`;
  probe.font = font;
  const lineH = l.size * (l.lineH || 1.1);
  const widths = lines.map(s => probe.measureText(s).width + l.tracking * Math.max(0, s.length - 1));
  const strokeW = (l.strokeW / 100) * l.size * 0.5;
  const glowR = (l.fx.glow / 100) * l.size * 0.9;
  const shadowR = (l.fx.shadow / 100) * l.size * 0.6;
  const pad = Math.ceil(strokeW + Math.max(glowR, shadowR) + l.size * 0.3) + 6;
  const w = Math.max(...widths, 1) + pad * 2;
  const h = lineH * lines.length + pad * 2;

  const out = cv(w, h);
  const c = out.getContext('2d');
  c.font = font;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.miterLimit = 2;

  // Where each line starts, honouring alignment against the widest line.
  const lineLeft = (i) => {
    const slack = (w - pad * 2) - widths[i];
    if (l.align === 'left') return pad;
    if (l.align === 'right') return pad + slack;
    return pad + slack / 2;
  };
  const drawLines = (fn) => lines.forEach((s, i) => {
    const y = pad + lineH * (i + 0.5);
    if (!l.tracking) { fn(s, lineLeft(i) + widths[i] / 2, y); return; }
    // Manual tracking: canvas letter-spacing is not dependable across engines,
    // and the sticker look leans on wide tracking.
    let x = lineLeft(i);
    for (const ch of s) {
      const cw = c.measureText(ch).width;
      fn(ch, x + cw / 2, y);
      x += cw + l.tracking;
    }
  });

  if (l.fx.glow > 0) {
    c.save();
    c.shadowColor = l.fx.glowColor;
    c.shadowBlur = glowR;
    c.fillStyle = l.color;
    for (let i = 0; i < 3; i++) drawLines((s, x, y) => c.fillText(s, x, y));
    c.restore();
  }
  if (l.fx.shadow > 0) {
    c.save();
    c.shadowColor = l.fx.shadowColor;
    c.shadowBlur = shadowR;
    c.shadowOffsetY = shadowR * 0.5;
    c.fillStyle = l.color;
    drawLines((s, x, y) => c.fillText(s, x, y));
    c.restore();
  }
  if (strokeW > 0) {
    c.strokeStyle = l.stroke;
    c.lineWidth = strokeW * 2;
    drawLines((s, x, y) => c.strokeText(s, x, y));
  }
  if (l.color !== 'transparent') {
    c.fillStyle = l.color;
    drawLines((s, x, y) => c.fillText(s, x, y));
  }
  out._pad = pad;
  return out;
}

function cacheKey(l) {
  if (l.kind === 'text') {
    return [l.text, l.font, l.weight, l.size, l.color, l.stroke, l.strokeW, l.tracking,
      l.caps, l.align, l.lineH, l.fx.shadow, l.fx.shadowColor, l.fx.glow, l.fx.glowColor].join('|');
  }
  const a = l.adj, f = l.fx;
  return [l._maskRev || 0, a.bri, a.con, a.sat, a.hue, a.blur,
    f.outline, f.outlineColor, f.shadow, f.shadowColor,
    f.aura, f.auraSize, f.auraWarp, f.auraSeed, f.auraPreset,
    f.auraCore, f.auraMid, f.auraOuter].join('|');
}

export function layerBitmap(l) {
  const key = cacheKey(l);
  if (l._cache && l._key === key) return l._cache;
  l._cache = l.kind === 'text' ? buildTextBitmap(l) : buildImageBitmap(l);
  l._key = key;
  return l._cache;
}

/** Layer size in document pixels, used for hit-testing and handles. */
export function layerBox(l) {
  const bm = layerBitmap(l);
  return { w: bm.width * l.scale, h: bm.height * l.scale };
}

/**
 * Is this point on actual pixels of the layer, or just inside its box?
 * A cut-out subject is mostly transparent, so box-only hit testing would make
 * a click on the backdrop grab the photo. Sampled from a 1/8-scale alpha map
 * cached with the bitmap, which costs one small readback per pixel change.
 */
export function hitPixel(l, lx, ly) {
  const bm = layerBitmap(l);
  if (!bm._alpha) {
    const s = Math.max(1, Math.ceil(Math.max(bm.width, bm.height) / 160));
    const aw = Math.max(1, Math.round(bm.width / s)), ah = Math.max(1, Math.round(bm.height / s));
    const a = cv(aw, ah);
    const ac = a.getContext('2d', { willReadFrequently: true });
    ac.drawImage(bm, 0, 0, aw, ah);
    bm._alpha = { w: aw, h: ah, d: ac.getImageData(0, 0, aw, ah).data };
  }
  const { w: aw, h: ah, d } = bm._alpha;
  const px = Math.floor(((lx / l.scale) + bm.width / 2) * (aw / bm.width));
  const py = Math.floor(((ly / l.scale) + bm.height / 2) * (ah / bm.height));
  if (px < 0 || py < 0 || px >= aw || py >= ah) return false;
  return d[(py * aw + px) * 4 + 3] > 10;
}

/**
 * Crop a cut-out layer down to the pixels it actually keeps, moving it so the
 * subject does not visually shift. Without this a cut-out keeps its original
 * frame: the selection box and the scale handles sit far out in empty space.
 */
export function trimToMask(l, threshold = 10, margin = 2) {
  if (l.kind !== 'image' || !l.mask) return false;
  const mw = l.mask.width, mh = l.mask.height;
  const d = l.mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, mw, mh).data;
  let x0 = mw, y0 = mh, x1 = -1, y1 = -1;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      if (d[(y * mw + x) * 4] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return false;
  x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin);
  x1 = Math.min(mw - 1, x1 + margin); y1 = Math.min(mh - 1, y1 + margin);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  // Not worth the resample (and the history copy) if barely anything is cropped.
  if (bw > mw * 0.93 && bh > mh * 0.93) return false;

  const k = l.src.width / mw;                     // mask px -> source px
  const sx = Math.round(x0 * k), sy = Math.round(y0 * k);
  const sw = Math.max(1, Math.round(bw * k)), sh = Math.max(1, Math.round(bh * k));

  const crop = (c, cw, ch, ox, oy, ow, oh) => {
    const o = cv(ow, oh);
    o.getContext('2d').drawImage(c, ox, oy, ow, oh, 0, 0, ow, oh);
    return o;
  };
  const newSrc = crop(l.src, l.src.width, l.src.height, sx, sy, sw, sh);
  const newRaw = l.rawMask ? crop(l.rawMask, mw, mh, x0, y0, bw, bh) : null;
  const newStrokes = l.strokes ? crop(l.strokes, mw, mh, x0, y0, bw, bh) : null;
  const newMask = crop(l.mask, mw, mh, x0, y0, bw, bh);
  if (l.rawMask && l.rawMask.meta) newRaw.meta = l.rawMask.meta;

  // The layer draws centred on (x,y). Shift it by however far the crop moved
  // the centre, in document space, through the layer's own rotation and flip.
  const dxs = (sx + sw / 2) - l.src.width / 2;
  const dys = (sy + sh / 2) - l.src.height / 2;
  const a = (l.rot * Math.PI) / 180;
  const fx = (l.flipX ? -1 : 1) * dxs * l.scale;
  const fy = dys * l.scale;
  l.x += fx * Math.cos(a) - fy * Math.sin(a);
  l.y += fx * Math.sin(a) + fy * Math.cos(a);

  // Remember the uncropped photo so "Full photo" can really undo the cut,
  // rather than handing back whatever the last trim happened to leave.
  // dx/dy is where the crop's centre sits relative to the original's centre, in
  // source pixels. That is what lets the subject be re-seated exactly over its
  // own photo later ("glow in place").
  if (!l.untrimmed) {
    l.untrimmed = {
      src: l.src, dx: dxs, dy: dys,
      x: l.x - fx * Math.cos(a) + fy * Math.sin(a),
      y: l.y - fx * Math.sin(a) - fy * Math.cos(a),
    };
  } else {
    l.untrimmed = { ...l.untrimmed, dx: l.untrimmed.dx + dxs, dy: l.untrimmed.dy + dys };
  }
  l.src = newSrc;
  l.rawMask = newRaw;
  l.strokes = newStrokes;
  l.mask = newMask;
  l.pixRev = (l.pixRev || 0) + 1;
  touch(l);
  return true;
}

// ---- render -----------------------------------------------------------------

export function render(ctx, doc, { showChecker = false } = {}) {
  const { w, h } = doc;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (showChecker && doc.bg.kind === 'none') {
    const s = Math.max(8, Math.round(Math.min(w, h) / 40));
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#363636';
    for (let y = 0, r = 0; y < h; y += s, r++) {
      for (let x = (r % 2 ? s : 0); x < w; x += s * 2) ctx.fillRect(x, y, s, s);
    }
  }
  drawBG(ctx, w, h, doc.bg);
  ctx.restore();

  for (const l of doc.layers) {
    if (!l.visible) continue;
    const bm = layerBitmap(l);
    ctx.save();
    ctx.globalAlpha = l.opacity;
    if (l.blend && l.blend !== 'normal') ctx.globalCompositeOperation = l.blend;
    ctx.translate(l.x, l.y);
    ctx.rotate((l.rot * Math.PI) / 180);
    ctx.scale(l.flipX ? -l.scale : l.scale, l.scale);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bm, -bm.width / 2, -bm.height / 2);
    ctx.restore();
  }
}

/** Render at the document's native size into a fresh canvas, for export. */
export function renderTo(doc, scale = 1, flatten = null) {
  const out = cv(doc.w * scale, doc.h * scale);
  const ctx = out.getContext('2d');
  ctx.scale(scale, scale);
  if (flatten) { ctx.fillStyle = flatten; ctx.fillRect(0, 0, doc.w, doc.h); }
  render(ctx, doc);
  return out;
}

// ---- history ----------------------------------------------------------------
// A snapshot is layer *state* as JSON plus a per-layer pointer to the pixel
// buffers of that moment. Source photos are immutable, so they're shared by
// reference and never copied. Mask and stroke layers are mutable, so a copy is
// taken - but only when the layer's pixRev says they actually changed, and the
// copy is then shared by every later snapshot that didn't touch them. Editing
// for an hour therefore costs a handful of mask copies, not sixty.

const PIXKEYS = ['src', 'mask', 'rawMask', 'strokes', 'untrimmed'];

export function snapshot(doc) {
  return JSON.stringify({
    w: doc.w, h: doc.h, presetId: doc.presetId, selected: doc.selected,
    bg: { ...doc.bg, img: undefined, _hasImg: !!doc.bg.img },
    layers: doc.layers.map(l => {
      const c = { ...l };
      delete c._cache;
      // Canvases must not reach JSON.stringify - they serialise to {} and the
      // layer comes back with a plain object where its bitmap should be.
      for (const k of PIXKEYS) delete c[k];
      return c;
    }),
  });
}

export class History {
  constructor(doc) {
    this.doc = doc;
    this.stack = [];
    this.i = -1;
    // Grows only: an undo past a delete has to be able to hand the layer its
    // source photo back, long after the live doc stopped referencing it.
    this.srcs = new Map();
    this.bgImgs = new Map();
    this.push('open');
  }

  push(label) {
    const prev = this.stack[this.i];
    const pix = new Map();
    for (const l of this.doc.layers) {
      this.srcs.set(l.id, l.src);
      const rev = l.pixRev || 0;
      const old = prev && prev.pix.get(l.id);
      if (old && old.rev === rev) { pix.set(l.id, old); continue; }
      pix.set(l.id, {
        rev,
        // Shared by reference: a source canvas is never mutated in place, it is
        // replaced (and pixRev bumped) when a trim crops it.
        src: l.src,
        untrimmed: l.untrimmed || null,
        mask: l.mask ? copy(l.mask) : null,
        rawMask: l.rawMask ? copy(l.rawMask) : null,
        strokes: l.strokes ? copy(l.strokes) : null,
      });
    }
    let bgKey = null;
    if (this.doc.bg.img) {
      bgKey = this.doc.bg._key || (this.doc.bg._key = 'bg' + (this.bgImgs.size + 1));
      this.bgImgs.set(bgKey, this.doc.bg.img);
    }
    this.stack.length = this.i + 1;
    this.stack.push({ label, snap: snapshot(this.doc), pix, bgKey });
    if (this.stack.length > 60) this.stack.shift();
    this.i = this.stack.length - 1;
  }

  _apply(e) {
    const s = JSON.parse(e.snap);
    const doc = this.doc;
    doc.w = s.w; doc.h = s.h; doc.presetId = s.presetId; doc.selected = s.selected;
    doc.bg = { ...s.bg };
    delete doc.bg._hasImg;
    if (s.bg._hasImg) doc.bg.img = this.bgImgs.get(e.bgKey);
    doc.layers = s.layers.map(ls => {
      const p = e.pix.get(ls.id) || {};
      return {
        ...ls,
        src: p.src || this.srcs.get(ls.id),
        untrimmed: p.untrimmed || null,
        // Copy out of history so the next edit mutates the live doc, not the
        // snapshot we'd need again on the following undo.
        mask: p.mask ? copy(p.mask) : null,
        rawMask: p.rawMask ? copy(p.rawMask) : null,
        strokes: p.strokes ? copy(p.strokes) : null,
        _cache: null, _key: '',
        _maskRev: p.rev || 0,
      };
    }).filter(l => l.kind !== 'image' || l.src);
  }

  undo() { if (this.i <= 0) return false; this.i--; this._apply(this.stack[this.i]); return true; }
  redo() { if (this.i >= this.stack.length - 1) return false; this.i++; this._apply(this.stack[this.i]); return true; }
  get canUndo() { return this.i > 0; }
  get canRedo() { return this.i < this.stack.length - 1; }
}

/** Deep-ish copy of a layer, with its own pixel buffers. */
export function cloneLayer(doc, l) {
  const c = {
    ...l, id: nextId++, _cache: null, _key: '',
    adj: l.adj ? { ...l.adj } : undefined,
    fx: { ...l.fx },
    mask: l.mask ? copy(l.mask) : null,
    rawMask: l.rawMask ? copy(l.rawMask) : null,
    strokes: l.strokes ? copy(l.strokes) : null,
    pixRev: (l.pixRev || 0) + 1,
  };
  c.x += doc.w * 0.04;
  c.y += doc.h * 0.04;
  doc.layers.push(c);
  doc.selected = c.id;
  return c;
}

export function copy(c) {
  const o = cv(c.width, c.height);
  o.getContext('2d').drawImage(c, 0, 0);
  return o;
}
