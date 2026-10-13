// Looks: complete results, one click each.
//
// Picking a backdrop, then an aura colour, then a size, then a strength is four
// decisions before you see anything good. A look is all of those decided at
// once, previewed on your own photo, so the first screen is "point at the one
// you want" instead of "learn the tool".

import * as D from './doc.js';
import { drawBG } from './bgs.js';

// bg: { self: true, blur, dim } reuses the photo the subject came from;
// otherwise it is a backdrop preset id, or null for transparent.
export const LOOKS = [
  {
    id: 'gold', name: 'Gold Glow', note: 'the classic',
    fx: { aura: 100, auraSize: 46, auraWarp: 55, auraPreset: 'gold' },
    bg: { self: true },
  },
  {
    id: 'solar', name: 'Solar', note: 'blurred behind',
    fx: { aura: 100, auraSize: 60, auraWarp: 70, auraPreset: 'solar' },
    bg: { self: true, blur: 26, dim: 18 },
  },
  {
    id: 'ember', name: 'Ember', note: 'dark + fire',
    fx: { aura: 100, auraSize: 52, auraWarp: 80, auraPreset: 'ember' },
    bg: { self: true, blur: 44, dim: 55 },
  },
  {
    id: 'mint', name: 'Neon Mint', fx: { aura: 100, auraSize: 48, auraWarp: 40, auraPreset: 'mint' }, bg: 'glow-solana',
  },
  {
    id: 'cyber', name: 'Cyber', fx: { aura: 100, auraSize: 44, auraWarp: 35, auraPreset: 'cyber' }, bg: 'grid-cyber',
  },
  {
    id: 'violet', name: 'Violet', fx: { aura: 100, auraSize: 52, auraWarp: 45, auraPreset: 'violet' }, bg: 'mesh-deep',
  },
  {
    id: 'toxic', name: 'Toxic', fx: { aura: 100, auraSize: 50, auraWarp: 75, auraPreset: 'toxic' }, bg: 'grid-matrix',
  },
  {
    id: 'hot', name: 'Hot', fx: { aura: 100, auraSize: 50, auraWarp: 50, auraPreset: 'hot' }, bg: 'rays-bubble',
  },
  {
    id: 'space', name: 'Space', fx: { aura: 95, auraSize: 58, auraWarp: 30, auraPreset: 'ice' }, bg: 'stars-deep',
  },
  {
    id: 'pump', name: 'Pump', note: 'green candles',
    fx: { aura: 100, auraSize: 42, auraWarp: 45, auraPreset: 'toxic' }, bg: 'candles-money',
  },
  {
    id: 'money', name: 'Money', fx: { aura: 100, auraSize: 44, auraWarp: 50, auraPreset: 'gold' }, bg: 'money-gold',
  },
  {
    id: 'sticker', name: 'Sticker', note: 'white outline',
    fx: { aura: 0, outline: 34, outlineColor: '#ffffff', shadow: 26 }, bg: 'dots-bubble',
  },
  {
    id: 'impact', name: 'Impact', fx: { aura: 0, outline: 28, outlineColor: '#111111', shadow: 20 }, bg: 'zoom-gold',
  },
  {
    id: 'ghost', name: 'Ghost', fx: { aura: 100, auraSize: 64, auraWarp: 25, auraPreset: 'ghost' }, bg: 'spotlight-mono',
  },
  {
    id: 'cutout', name: 'Just the cutout', note: 'transparent PNG',
    fx: { aura: 0, outline: 0, shadow: 0 }, bg: null,
  },
];

// Every field a look may own, so switching looks never leaves part of the last
// one behind.
const FX_KEYS = ['aura', 'auraSize', 'auraWarp', 'auraPreset', 'outline', 'outlineColor', 'shadow', 'shadowColor'];
const FX_ZERO = { aura: 0, auraSize: 50, auraWarp: 45, auraPreset: 'gold', outline: 0, outlineColor: '#ffffff', shadow: 0, shadowColor: '#000000' };

export function resolveBG(look, layer) {
  if (!look.bg) return { kind: 'none' };
  if (look.bg.self) {
    return {
      kind: 'image',
      img: (layer.untrimmed && layer.untrimmed.src) || layer.src,
      blur: look.bg.blur || 0,
      pixel: look.bg.pixel || 0,
      dim: look.bg.dim || 0,
    };
  }
  return { kind: 'preset', id: look.bg };
}

/** Apply a look to a live layer + document. The caller handles history/redraw. */
export function applyLook(doc, layer, look) {
  Object.assign(layer.fx, FX_ZERO);
  for (const k of FX_KEYS) if (look.fx[k] !== undefined) layer.fx[k] = look.fx[k];
  doc.bg = resolveBG(look, layer);
  D.touch(layer);
  // "Self" backdrops only line up if the subject sits exactly where it was cut
  // from, so the look owns the placement too.
  if (look.bg && look.bg.self) seatInPlace(doc, layer);
  return layer;
}

/** Put a cut-out subject back over its own photo, at the photo's own framing. */
export function seatInPlace(doc, layer) {
  const img = (layer.untrimmed && layer.untrimmed.src) || layer.src;
  const s = Math.max(doc.w / img.width, doc.h / img.height);
  const dx = (layer.untrimmed && layer.untrimmed.dx) || 0;
  const dy = (layer.untrimmed && layer.untrimmed.dy) || 0;
  layer.scale = s;
  layer.rot = 0;
  layer.flipX = false;
  layer.x = doc.w / 2 + dx * s;
  layer.y = doc.h / 2 + dy * s;
}

// ---- previews ---------------------------------------------------------------

const cv = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

function shrink(src, max) {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  const o = cv(src.width * s, src.height * s);
  const c = o.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(src, 0, 0, o.width, o.height);
  return o;
}

/**
 * A small stand-in for the real layer, so fifteen previews cost about as much
 * as one full-resolution rebuild. Cached until the layer's pixels change.
 */
function mini(layer) {
  if (layer._mini && layer._mini.rev === (layer.pixRev || 0)) return layer._mini;
  const src = shrink(layer.src, 300);
  const full = (layer.untrimmed && layer.untrimmed.src) || layer.src;
  const photo = shrink(full, 420);
  const m = {
    rev: layer.pixRev || 0,
    src,
    mask: layer.mask ? shrink(layer.mask, 300) : null,
    photo,
    dx: (layer.untrimmed && layer.untrimmed.dx) || 0,
    dy: (layer.untrimmed && layer.untrimmed.dy) || 0,
    // Two shrink ratios, so preview placement can be expressed in the same
    // full-photo pixels the real canvas uses.
    q: src.width / layer.src.width,
    p: photo.width / full.width,
  };
  layer._mini = m;
  return m;
}

/** Render one look onto a thumbnail canvas, using the user's own photo. */
export function drawLookThumb(ctx, size, layer, look, docAspect = 1) {
  const m = mini(layer);
  const w = size, h = Math.round(size / docAspect);
  ctx.clearRect(0, 0, w, h);

  const bg = look.bg && look.bg.self
    ? { kind: 'image', img: m.photo, blur: look.bg.blur || 0, pixel: look.bg.pixel || 0, dim: look.bg.dim || 0 }
    : (look.bg ? { kind: 'preset', id: look.bg } : { kind: 'none' });

  if (bg.kind === 'none') {
    const s = Math.max(5, Math.round(size / 9));
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#363636';
    for (let y = 0, r = 0; y < h; y += s, r++) {
      for (let x = (r % 2 ? s : 0); x < w; x += s * 2) ctx.fillRect(x, y, s, s);
    }
  }
  drawBG(ctx, w, h, bg);

  const fx = { ...FX_ZERO };
  for (const k of FX_KEYS) if (look.fx[k] !== undefined) fx[k] = look.fx[k];

  // A throwaway layer: no shared cache, so previews never disturb the canvas.
  const probe = {
    kind: 'image', src: m.src, mask: m.mask, rot: 0, flipX: false, opacity: 1, visible: true,
    adj: { bri: 100, con: 100, sat: 100, hue: 0, blur: 0 }, fx,
    x: 0, y: 0, scale: 1, _cache: null, _key: '',
  };
  const bm = D.layerBitmap(probe);

  if (look.bg && look.bg.self) {
    // Same seating as the real canvas: cover-fit the photo, then offset by the
    // crop. sFull is thumbnail pixels per full-photo pixel; the bitmap is in
    // mini-source pixels, hence the extra /q.
    const sFull = Math.max(w / m.photo.width, h / m.photo.height) * m.p;
    const k = sFull / m.q;
    ctx.drawImage(bm,
      w / 2 + m.dx * sFull - (bm.width * k) / 2,
      h / 2 + m.dy * sFull - (bm.height * k) / 2,
      bm.width * k, bm.height * k);
  } else {
    const s = Math.min((w * 0.84) / bm.width, (h * 0.84) / bm.height);
    ctx.drawImage(bm, (w - bm.width * s) / 2, (h - bm.height * s) / 2, bm.width * s, bm.height * s);
  }
}
