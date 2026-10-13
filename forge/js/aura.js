// Aura: the glowing rim that makes a cut-out subject look lit from behind.
//
// A single blurred drop-shadow reads as grey mush. Real aura light has three
// things going on at once, and this builds all three:
//   1. a hot near-white band hugging the silhouette,
//   2. a saturated mid falloff, and a wide dim wash beyond it,
//   3. small-scale wobble, so the rim licks like flame instead of tracing a
//      perfect offset curve.
// Each band is blurred separately and composited with 'lighter', so where they
// overlap the light adds up and blows out to white exactly like real light.

const SVG_NS = 'http://www.w3.org/2000/svg';
let warpNode = null;
let warpOK = null;

const cv = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

// Turbulence + displacement. Cheap in the compositor and the only way to get
// the licking edge without hand-drawing tendrils.
function warp() {
  if (warpNode) return warpNode;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  const f = document.createElementNS(SVG_NS, 'filter');
  f.setAttribute('id', 'mf-aura-warp');
  f.setAttribute('color-interpolation-filters', 'sRGB');
  // The default -10%/120% filter region would clip the displaced edge.
  f.setAttribute('x', '-35%'); f.setAttribute('y', '-35%');
  f.setAttribute('width', '170%'); f.setAttribute('height', '170%');
  const turb = document.createElementNS(SVG_NS, 'feTurbulence');
  turb.setAttribute('type', 'fractalNoise');
  turb.setAttribute('numOctaves', '3');
  turb.setAttribute('baseFrequency', '0.014');
  turb.setAttribute('seed', '7');
  turb.setAttribute('result', 'noise');
  const disp = document.createElementNS(SVG_NS, 'feDisplacementMap');
  disp.setAttribute('in', 'SourceGraphic');
  disp.setAttribute('in2', 'noise');
  disp.setAttribute('scale', '0');
  disp.setAttribute('xChannelSelector', 'R');
  disp.setAttribute('yChannelSelector', 'G');
  f.append(turb, disp);
  svg.append(f);
  document.body.append(svg);
  warpNode = { svg, turb, disp };
  return warpNode;
}

function setWarp(scale, freq, seed) {
  const n = warp();
  n.disp.setAttribute('scale', scale.toFixed(2));
  n.turb.setAttribute('baseFrequency', freq.toFixed(5));
  n.turb.setAttribute('seed', String(seed));
}

function warpWorks() {
  if (warpOK !== null) return warpOK;
  try {
    const a = cv(16, 16);
    const ac = a.getContext('2d');
    ac.fillStyle = '#fff';
    ac.fillRect(6, 6, 4, 4);
    const b = cv(16, 16);
    const bc = b.getContext('2d', { willReadFrequently: true });
    setWarp(9, 0.05, 1);
    bc.filter = 'url(#mf-aura-warp)';
    bc.drawImage(a, 0, 0);
    bc.filter = 'none';
    // A displaced 4px square cannot stay perfectly inside its original bounds.
    const d = bc.getImageData(0, 0, 16, 16).data;
    let outside = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (d[(y * 16 + x) * 4 + 3] > 20 && (x < 6 || x > 9 || y < 6 || y > 9)) outside++;
      }
    }
    warpOK = outside > 0;
  } catch { warpOK = false; }
  return warpOK;
}

// core -> mid -> outer. Named for what they look like, not for their hex.
export const AURA_PRESETS = [
  { id: 'gold', name: 'Gold', colors: ['#fffce8', '#ffd21a', '#ff7a00'] },
  { id: 'solar', name: 'Solar', colors: ['#ffffff', '#ffea00', '#ff3d00'] },
  { id: 'ember', name: 'Ember', colors: ['#fff3d0', '#ff8a00', '#a81400'] },
  { id: 'toxic', name: 'Toxic', colors: ['#f6ffe0', '#b6ff00', '#1aff6b'] },
  { id: 'mint', name: 'Mint', colors: ['#eafff8', '#14f195', '#00b3ff'] },
  { id: 'cyber', name: 'Cyber', colors: ['#ffffff', '#00f0ff', '#7c5cff'] },
  { id: 'violet', name: 'Violet', colors: ['#f8eaff', '#b06bff', '#4b00c7'] },
  { id: 'hot', name: 'Hot', colors: ['#fff0f5', '#ff2e63', '#8a0030'] },
  { id: 'ghost', name: 'Ghost', colors: ['#ffffff', '#dceeff', '#5f8dff'] },
  { id: 'ice', name: 'Ice', colors: ['#ffffff', '#a8edea', '#1f7fd0'] },
  { id: 'blood', name: 'Blood', colors: ['#ffe3e3', '#ff1a1a', '#5c0000'] },
  { id: 'pure', name: 'Pure', colors: ['#ffffff', '#ffffff', '#cfd6ff'] },
];

export const auraColors = (fx) =>
  (fx.auraPreset === 'custom'
    ? [fx.auraCore, fx.auraMid, fx.auraOuter]
    : (AURA_PRESETS.find(p => p.id === fx.auraPreset) || AURA_PRESETS[0]).colors);

// Per band: blur radius and opacity (both relative to the aura radius), which
// colour it takes, how hard it is warped, and how coarse that warp is.
//
// The hot inner band is deliberately warp-free. Displacing it too pulls the
// bright rim off the subject and the light stops looking like it belongs to it;
// keeping it locked and letting only the outer bands wander is what reads as
// flame licking off a lit edge. Coarser noise further out, so the tongues grow
// rather than turning into fizz.
const BANDS = [
  { r: 0.07, a: 1.00, c: 0, times: 2, warp: 0.00, freq: 0.0200 },
  { r: 0.18, a: 0.95, c: 1, times: 1, warp: 0.65, freq: 0.0150 },
  { r: 0.42, a: 0.85, c: 1, times: 1, warp: 1.15, freq: 0.0100 },
  { r: 0.90, a: 0.60, c: 2, times: 1, warp: 1.60, freq: 0.0065 },
  { r: 1.70, a: 0.35, c: 2, times: 1, warp: 2.40, freq: 0.0042 },
];

/**
 * Build the aura for a subject.
 * @param base  the composited subject (alpha is the silhouette)
 * @param pad   transparent margin already reserved around the subject
 * @returns canvas of base size + 2*pad, to draw *under* the subject
 */
export function buildAura(base, pad, { size = 50, warp: warpAmt = 45, colors, seed = 7 } = {}) {
  const W = base.width + pad * 2, H = base.height + pad * 2;
  // The aura is nothing but soft light, so it is built small and scaled up.
  // At full photo resolution five large blurs would stall every slider drag.
  const k = Math.min(1, 700 / Math.max(W, H));
  const aw = Math.max(1, Math.round(W * k)), ah = Math.max(1, Math.round(H * k));

  const sil = cv(aw, ah);
  const sc = sil.getContext('2d');
  sc.imageSmoothingQuality = 'high';
  sc.drawImage(base, pad * k, pad * k, base.width * k, base.height * k);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = '#fff';
  sc.fillRect(0, 0, aw, ah);

  const R = (size / 100) * Math.min(base.width, base.height) * 0.22 * k;
  if (R < 0.5) return null;
  const canWarp = warpAmt > 0 && warpWorks();

  const out = cv(aw, ah);
  const oc = out.getContext('2d');
  oc.globalCompositeOperation = 'lighter';

  const band = cv(aw, ah);
  const bc = band.getContext('2d');
  for (let i = 0; i < BANDS.length; i++) {
    const b = BANDS[i];
    const blur = R * b.r;
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.globalCompositeOperation = 'source-over';
    bc.clearRect(0, 0, aw, ah);
    // Warp first, blur second: displacing a sharp edge and then softening it
    // gives flame tongues; blurring first just jiggles a soft blob.
    const amp = canWarp ? (warpAmt / 100) * R * b.warp : 0;
    if (amp > 0.5) {
      // Noise frequency is in canvas pixels, so it has to track the working
      // scale or the tongues change size with the photo's resolution.
      setWarp(amp, b.freq / Math.max(0.2, k), seed + i * 13);
      bc.filter = `url(#mf-aura-warp) blur(${blur.toFixed(2)}px)`;
    } else {
      bc.filter = `blur(${blur.toFixed(2)}px)`;
    }
    for (let i = 0; i < b.times; i++) bc.drawImage(sil, 0, 0);
    bc.filter = 'none';
    bc.globalCompositeOperation = 'source-in';
    bc.fillStyle = colors[b.c] || colors[colors.length - 1];
    bc.fillRect(0, 0, aw, ah);

    oc.globalAlpha = b.a;
    oc.drawImage(band, 0, 0);
  }
  oc.globalAlpha = 1;

  lastBuild = {
    W, H, k, R, canWarp,
    amps: BANDS.map(b => +(canWarp ? (warpAmt / 100) * R * b.warp : 0).toFixed(1)),
  };

  const full = cv(W, H);
  const fc = full.getContext('2d');
  fc.imageSmoothingQuality = 'high';
  fc.drawImage(out, 0, 0, W, H);
  return full;
}

/** What the last build actually did — for the tests, and for the console. */
export let lastBuild = null;
export const warpAvailable = () => warpWorks();

/** How much margin the aura needs around the subject, in source pixels. */
export const auraPad = (base, size) =>
  Math.ceil((size / 100) * Math.min(base.width, base.height) * 0.22 * 2.1);
