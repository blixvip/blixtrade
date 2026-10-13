// Colour markers.
//
// Typing hex into a native colour dialog is the slowest part of styling
// anything, so every colour control here is backed by three rows of one-click
// markers: colours pulled out of your own photo, colours you used recently, and
// a fixed set that reads well on memecoin art. Plus an eyedropper.

const STORE = 'mf.swatches.v1';

export const CURATED = [
  '#ffffff', '#000000', '#9b9b9b', '#ffd21a', '#ff9d00', '#ff4e00',
  '#ff2e63', '#ff71ce', '#b06bff', '#7c5cff', '#00f0ff', '#14f195',
  '#00ff41', '#b6ff00', '#ffe84a', '#8a0030', '#0a0a14', '#f6f1e7',
];

let recent = [];
try {
  const raw = localStorage.getItem(STORE);
  if (raw) recent = JSON.parse(raw).filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 12);
} catch { recent = []; }

export const recentColors = () => recent.slice();

export function remember(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
  const h = hex.toLowerCase();
  recent = [h, ...recent.filter(c => c !== h)].slice(0, 12);
  try { localStorage.setItem(STORE, JSON.stringify(recent)); } catch { /* private mode */ }
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export const rgbHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);

/**
 * The colours actually in an image, most-used first.
 *
 * Counting raw pixels returns twelve shades of the same beige, so colours are
 * bucketed coarsely, scored by saturation as well as frequency (a flat grey
 * background would otherwise win every time), and then filtered so the returned
 * set is visibly distinct rather than a gradient.
 */
export function imageColors(src, n = 8) {
  const S = 110;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;

  const bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = bins.get(key);
    if (e) { e.n++; e.r += r; e.g += g; e.b += b; }
    else bins.set(key, { n: 1, r, g, b });
  }

  const list = [...bins.values()].map(e => {
    const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const lum = (r * 0.3 + g * 0.6 + b * 0.1) / 255;
    // Favour colours that are actually colourful and not nearly black/white.
    const punch = 1 + sat * 2.2 - Math.abs(lum - 0.5) * 0.6;
    return { r, g, b, score: e.n * punch };
  }).sort((a, b) => b.score - a.score);

  const out = [];
  for (const e of list) {
    if (out.every(o => Math.abs(o.r - e.r) + Math.abs(o.g - e.g) + Math.abs(o.b - e.b) > 70)) {
      out.push(e);
      if (out.length >= n) break;
    }
  }
  return out.map(e => rgbHex(e.r, e.g, e.b));
}

/**
 * Pick a colour from anywhere on screen. Chrome's EyeDropper can sample outside
 * the page; the fallback samples the editor's own canvas.
 * @param sample (x, y) -> hex, used when the native picker is unavailable
 */
export async function eyedrop(sample) {
  if (window.EyeDropper) {
    try {
      const r = await new window.EyeDropper().open();
      return r.sRGBHex;
    } catch {
      return null; // user pressed Escape
    }
  }
  return sample ? sample() : null;
}

export const hasNativeEyedropper = () => !!window.EyeDropper;
