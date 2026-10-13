// Procedural backgrounds. Every one is drawn on canvas from a seed, so the whole
// library costs zero bytes of assets and re-renders at any export size without
// ever looking upscaled. Same seed -> same pixels, which is what lets a 72px
// thumbnail honestly preview a 4096px export.

export const PALETTES = {
  neon: ['#0b0618', '#9b5de5', '#f15bb5', '#00f5d4'],
  solana: ['#05060a', '#9945ff', '#14f195', '#03e1ff'],
  gold: ['#1c1200', '#8a5a00', '#ffb703', '#ffe066'],
  sunset: ['#2b1055', '#7597de', '#ff6b6b', '#feca57'],
  vapor: ['#1a0033', '#b967ff', '#ff71ce', '#01cdfe'],
  matrix: ['#000600', '#003b00', '#00ff41', '#9dffb0'],
  ice: ['#071726', '#2e6b8f', '#a8edea', '#fdfdff'],
  blood: ['#08090f', '#6a0f1e', '#ff2e63', '#ffb3c1'],
  cyber: ['#0d0221', '#ff003c', '#fcee09', '#00f0ff'],
  money: ['#07140f', '#0f3d2e', '#16c784', '#d4af37'],
  fire: ['#120300', '#8c1c00', '#ff4e00', '#ffc300'],
  deep: ['#0f0c29', '#302b63', '#5b5fc7', '#c3c7ff'],
  bubble: ['#2a0a1f', '#f9748f', '#fd868c', '#ffe3e0'],
  pastel: ['#fdf6f0', '#ffd1dc', '#c1f0f6', '#fff5ba'],
  mono: ['#0a0a0b', '#2a2a2e', '#777', '#f2f2f4'],
  paper: ['#f6f1e7', '#e3d9c6', '#c9b997', '#4a4132'],
};
export const PAL_NAMES = Object.keys(PALETTES);

// ---- helpers ----------------------------------------------------------------
// mulberry32: tiny, fast, and stable across runs so previews never lie.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;

function fill(ctx, w, h, c) { ctx.fillStyle = c; ctx.fillRect(0, 0, w, h); }

function linGrad(ctx, w, h, stops, angle = 45) {
  const r = (angle * Math.PI) / 180;
  const cx = w / 2, cy = h / 2;
  const len = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r));
  const g = ctx.createLinearGradient(
    cx - (Math.cos(r) * len) / 2, cy - (Math.sin(r) * len) / 2,
    cx + (Math.cos(r) * len) / 2, cy + (Math.sin(r) * len) / 2);
  stops.forEach((c, i) => g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c));
  return g;
}

// Film grain. Drawn as one tiled tile instead of per-pixel over the full canvas:
// a 4096px export would otherwise push ~17M random calls and stall the UI.
function grain(ctx, w, h, amount = 0.06, seed = 7) {
  const S = 128;
  const t = document.createElement('canvas');
  t.width = t.height = S;
  const tc = t.getContext('2d');
  const d = tc.createImageData(S, S);
  const rnd = rng(seed);
  for (let i = 0; i < S * S; i++) {
    const v = rnd() * 255;
    d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v;
    d.data[i * 4 + 3] = 255;
  }
  tc.putImageData(d, 0, 0);
  ctx.save();
  ctx.globalAlpha = amount;
  ctx.globalCompositeOperation = 'overlay';
  const p = ctx.createPattern(t, 'repeat');
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function blob(ctx, x, y, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'transparent');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function vignette(ctx, w, h, strength = 0.5) {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ---- generators -------------------------------------------------------------
// Each takes (ctx, w, h, p /* palette */, seed). Unit-less: everything scales
// off min(w,h) so a 9:16 story and a 1:1 post read as the same design.
const GEN = {
  linear(ctx, w, h, p) { ctx.fillStyle = linGrad(ctx, w, h, [p[1], p[2], p[3]], 135); ctx.fillRect(0, 0, w, h); },

  duo(ctx, w, h, p) { ctx.fillStyle = linGrad(ctx, w, h, [p[2], p[1]], 90); ctx.fillRect(0, 0, w, h); },

  glow(ctx, w, h, p) {
    fill(ctx, w, h, p[0]);
    blob(ctx, w / 2, h * 0.52, Math.max(w, h) * 0.62, p[2], 0.95);
    blob(ctx, w / 2, h * 0.5, Math.max(w, h) * 0.3, p[3], 0.5);
  },

  mesh(ctx, w, h, p, seed) {
    const rnd = rng(seed);
    fill(ctx, w, h, p[0]);
    const cols = [p[1], p[2], p[3], p[2], p[1]];
    for (let i = 0; i < 5; i++) {
      blob(ctx, w * (0.15 + rnd() * 0.7), h * (0.15 + rnd() * 0.7),
        Math.max(w, h) * (0.35 + rnd() * 0.35), cols[i], 0.8);
    }
    grain(ctx, w, h, 0.04, seed);
  },

  aurora(ctx, w, h, p, seed) {
    const rnd = rng(seed);
    ctx.fillStyle = linGrad(ctx, w, h, [p[0], p[1]], 90);
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    for (let band = 0; band < 5; band++) {
      const col = [p[2], p[3], p[1]][band % 3];
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.42;
      ctx.filter = `blur(${s * 0.035}px)`;
      ctx.beginPath();
      const yb = h * (0.2 + rnd() * 0.6);
      const amp = h * (0.06 + rnd() * 0.12);
      const thick = s * (0.05 + rnd() * 0.09);
      const ph = rnd() * 6.28;
      ctx.moveTo(-w * 0.1, yb);
      for (let x = -w * 0.1; x <= w * 1.1; x += w / 48) {
        ctx.lineTo(x, yb + Math.sin((x / w) * 5 + ph) * amp + Math.sin((x / w) * 11 + ph) * amp * 0.3);
      }
      for (let x = w * 1.1; x >= -w * 0.1; x -= w / 48) {
        ctx.lineTo(x, yb + thick + Math.sin((x / w) * 5 + ph) * amp + Math.sin((x / w) * 11 + ph) * amp * 0.3);
      }
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.restore();
    }
    grain(ctx, w, h, 0.05, seed);
  },

  rays(ctx, w, h, p, seed) {
    fill(ctx, w, h, p[0]);
    const cx = w / 2, cy = h * 0.42, R = Math.hypot(w, h);
    const n = 24;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rng(seed)() * Math.PI) / n);
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const a0 = (i / n) * Math.PI * 2, a1 = a0 + Math.PI / n;
      ctx.arc(0, 0, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? p[1] : p[2];
      ctx.fill();
    }
    ctx.restore();
    blob(ctx, cx, cy, Math.min(w, h) * 0.5, p[3], 0.65);
    vignette(ctx, w, h, 0.45);
  },

  sun(ctx, w, h, p) { // vaporwave sun + scanlines + horizon grid
    const hz = h * 0.58;
    ctx.fillStyle = linGrad(ctx, w, hz, [p[1], p[2]], 90);
    ctx.fillRect(0, 0, w, hz);
    const R = Math.min(w, h) * 0.3;
    const g = ctx.createLinearGradient(0, hz - R * 2, 0, hz);
    g.addColorStop(0, p[3]);
    g.addColorStop(1, p[2]);
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, hz - R * 0.15, R, 0, 7);
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hz);
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9; i++) {
      const y = hz - R * 0.15 + (i * R) / 6 - R * 0.1;
      ctx.fillRect(0, y, w, (R / 22) * (1 + i * 0.35));
    }
    ctx.restore();
    ctx.fillStyle = p[0];
    ctx.fillRect(0, hz, w, h - hz);
    ctx.strokeStyle = p[2];
    ctx.lineWidth = Math.max(1, w / 900);
    ctx.globalAlpha = 0.8;
    for (let i = 0; i <= 14; i++) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + (i - 7) * (w / 14), hz);
      ctx.lineTo(w / 2 + (i - 7) * w * 0.6, h);
      ctx.stroke();
    }
    for (let i = 1, y = hz; y < h; i++) {
      y = hz + (h - hz) * (i / 9) ** 2.1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  grid(ctx, w, h, p) {
    ctx.fillStyle = linGrad(ctx, w, h, [p[0], p[1]], 120);
    ctx.fillRect(0, 0, w, h);
    const step = Math.min(w, h) / 16;
    ctx.strokeStyle = p[2];
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = Math.max(1, Math.min(w, h) / 900);
    ctx.beginPath();
    for (let x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    blob(ctx, w / 2, h / 2, Math.max(w, h) * 0.5, p[3], 0.22);
  },

  dots(ctx, w, h, p) {
    ctx.fillStyle = linGrad(ctx, w, h, [p[1], p[0]], 90);
    ctx.fillRect(0, 0, w, h);
    const step = Math.min(w, h) / 14, r = step * 0.13;
    ctx.fillStyle = p[2];
    ctx.globalAlpha = 0.55;
    for (let y = step / 2, row = 0; y < h + step; y += step, row++) {
      for (let x = step / 2 + (row % 2 ? step / 2 : 0); x < w + step; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  },

  stripes(ctx, w, h, p) {
    fill(ctx, w, h, p[1]);
    const s = Math.min(w, h) / 9;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = p[2];
    for (let x = -Math.hypot(w, h); x < Math.hypot(w, h); x += s * 2) {
      ctx.fillRect(x, -Math.hypot(w, h), s, Math.hypot(w, h) * 2);
    }
    ctx.restore();
    vignette(ctx, w, h, 0.35);
  },

  halftone(ctx, w, h, p) {
    ctx.fillStyle = linGrad(ctx, w, h, [p[2], p[1]], 100);
    ctx.fillRect(0, 0, w, h);
    const step = Math.min(w, h) / 26;
    ctx.fillStyle = p[0];
    for (let y = 0; y < h + step; y += step) {
      for (let x = 0; x < w + step; x += step) {
        const t = Math.min(1, Math.hypot(x - w * 0.5, y - h * 0.35) / (Math.max(w, h) * 0.62));
        const r = step * 0.52 * t;
        if (r < 0.2) continue;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
      }
    }
  },

  zoom(ctx, w, h, p, seed) { // comic speed lines punching out from the subject
    const rnd = rng(seed);
    fill(ctx, w, h, p[3]);
    const cx = w / 2, cy = h * 0.48, R = Math.hypot(w, h);
    ctx.fillStyle = p[0];
    for (let i = 0; i < 90; i++) {
      const a = rnd() * Math.PI * 2;
      const wd = 0.004 + rnd() * 0.022;
      const r0 = Math.min(w, h) * (0.2 + rnd() * 0.12);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a - wd) * R, cy + Math.sin(a - wd) * R);
      ctx.lineTo(cx + Math.cos(a + wd) * R, cy + Math.sin(a + wd) * R);
      ctx.closePath();
      ctx.fill();
    }
    blob(ctx, cx, cy, Math.min(w, h) * 0.42, p[3], 1);
  },

  stars(ctx, w, h, p, seed) {
    const rnd = rng(seed);
    ctx.fillStyle = linGrad(ctx, w, h, [p[0], p[1]], 110);
    ctx.fillRect(0, 0, w, h);
    blob(ctx, w * 0.3, h * 0.3, Math.max(w, h) * 0.45, p[2], 0.3);
    blob(ctx, w * 0.75, h * 0.7, Math.max(w, h) * 0.4, p[3], 0.22);
    const n = Math.round((w * h) / 5200);
    for (let i = 0; i < n; i++) {
      const r = (0.4 + rnd() * 1.8) * (Math.min(w, h) / 900);
      ctx.globalAlpha = 0.25 + rnd() * 0.75;
      ctx.fillStyle = rnd() > 0.85 ? p[3] : '#fff';
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, Math.max(0.5, r), 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  bokeh(ctx, w, h, p, seed) {
    const rnd = rng(seed);
    ctx.fillStyle = linGrad(ctx, w, h, [p[1], p[0]], 120);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 36; i++) {
      const r = Math.min(w, h) * (0.03 + rnd() * 0.14);
      ctx.globalAlpha = 0.08 + rnd() * 0.3;
      ctx.fillStyle = [p[2], p[3], p[1]][i % 3];
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, r, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    grain(ctx, w, h, 0.05, seed);
  },

  confetti(ctx, w, h, p, seed) {
    const rnd = rng(seed);
    ctx.fillStyle = linGrad(ctx, w, h, [p[1], p[0]], 90);
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    for (let i = 0; i < 120; i++) {
      ctx.save();
      ctx.translate(rnd() * w, rnd() * h);
      ctx.rotate(rnd() * 6.3);
      ctx.globalAlpha = 0.55 + rnd() * 0.45;
      ctx.fillStyle = [p[2], p[3], '#fff', p[1]][i % 4];
      ctx.fillRect(0, 0, s * 0.012, s * (0.02 + rnd() * 0.02));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  money(ctx, w, h, p, seed) {
    const rnd = rng(seed);
    ctx.fillStyle = linGrad(ctx, w, h, [p[1], p[0]], 90);
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    for (let i = 0; i < 46; i++) {
      ctx.save();
      ctx.translate(rnd() * w, rnd() * h);
      ctx.rotate((rnd() - 0.5) * 1.4);
      ctx.globalAlpha = 0.25 + rnd() * 0.6;
      ctx.font = `700 ${s * (0.04 + rnd() * 0.06)}px system-ui, sans-serif`;
      ctx.fillStyle = i % 3 ? p[2] : p[3];
      ctx.fillText('$', 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    vignette(ctx, w, h, 0.4);
  },

  candles(ctx, w, h, p, seed) { // green-candle chart ripping up behind the subject
    const rnd = rng(seed);
    ctx.fillStyle = linGrad(ctx, w, h, [p[0], p[1]], 100);
    ctx.fillRect(0, 0, w, h);
    const n = 26, cw = w / n;
    let price = h * 0.86;
    const pts = [];
    ctx.lineWidth = Math.max(1, w / 1400);
    for (let i = 0; i < n; i++) {
      const drift = -h * 0.021 * (0.4 + rnd() * 1.6);
      const open = price;
      const close = Math.max(h * 0.12, price + drift + (rnd() - 0.5) * h * 0.05);
      const hi = Math.min(open, close) - rnd() * h * 0.03;
      const lo = Math.max(open, close) + rnd() * h * 0.03;
      const x = i * cw + cw / 2;
      const up = close < open;
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = ctx.fillStyle = up ? p[2] : p[3];
      ctx.beginPath();
      ctx.moveTo(x, hi);
      ctx.lineTo(x, lo);
      ctx.stroke();
      ctx.fillRect(x - cw * 0.3, Math.min(open, close), cw * 0.6, Math.max(2, Math.abs(close - open)));
      pts.push([x, close]);
      price = close;
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.strokeStyle = p[2];
    ctx.lineWidth = Math.max(1.5, w / 450);
    ctx.shadowColor = p[2];
    ctx.shadowBlur = w / 60;
    ctx.stroke();
    ctx.shadowBlur = 0;
    vignette(ctx, w, h, 0.42);
  },

  blobs(ctx, w, h, p, seed) {
    const rnd = rng(seed);
    fill(ctx, w, h, p[0]);
    const s = Math.min(w, h);
    for (let i = 0; i < 7; i++) {
      const cx = rnd() * w, cy = rnd() * h, R = s * (0.14 + rnd() * 0.26);
      ctx.save();
      ctx.filter = `blur(${s * 0.012}px)`;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = [p[1], p[2], p[3]][i % 3];
      ctx.beginPath();
      for (let a = 0; a <= 6.2832; a += 0.18) {
        const rr = R * (1 + Math.sin(a * 3 + i) * 0.16 + Math.sin(a * 5 + i * 2) * 0.1);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        a ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  },

  topo(ctx, w, h, p, seed) {
    const rnd = rng(seed);
    ctx.fillStyle = linGrad(ctx, w, h, [p[0], p[1]], 135);
    ctx.fillRect(0, 0, w, h);
    const s = Math.min(w, h);
    ctx.lineWidth = Math.max(1, s / 700);
    const ph = rnd() * 6.28;
    for (let i = 0; i < 26; i++) {
      ctx.globalAlpha = 0.14 + (i % 4 === 0 ? 0.3 : 0);
      ctx.strokeStyle = i % 4 === 0 ? p[3] : p[2];
      ctx.beginPath();
      for (let x = 0; x <= w; x += w / 60) {
        const t = x / w;
        const y = h * (i / 25) + Math.sin(t * 6 + i * 0.5 + ph) * h * 0.05
          + Math.sin(t * 13 + i * 0.2) * h * 0.022;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  waves(ctx, w, h, p) {
    ctx.fillStyle = linGrad(ctx, w, h, [p[1], p[0]], 90);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      ctx.globalAlpha = 0.85 - i * 0.1;
      ctx.fillStyle = [p[2], p[3], p[1]][i % 3];
      ctx.beginPath();
      const base = h * (0.42 + i * 0.1);
      ctx.moveTo(0, h);
      ctx.lineTo(0, base);
      for (let x = 0; x <= w; x += w / 40) {
        ctx.lineTo(x, base + Math.sin((x / w) * 4 + i) * h * 0.05);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  hex(ctx, w, h, p) {
    ctx.fillStyle = linGrad(ctx, w, h, [p[0], p[1]], 150);
    ctx.fillRect(0, 0, w, h);
    const R = Math.min(w, h) / 18, dx = R * 1.732, dy = R * 1.5;
    ctx.strokeStyle = p[2];
    ctx.lineWidth = Math.max(1, Math.min(w, h) / 800);
    ctx.globalAlpha = 0.4;
    for (let row = 0, y = 0; y < h + dy; row++, y += dy) {
      for (let x = (row % 2 ? dx / 2 : 0); x < w + dx; x += dx) {
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 180) * (60 * k - 30);
          const px = x + Math.cos(a) * R, py = y + Math.sin(a) * R;
          k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    blob(ctx, w * 0.5, h * 0.5, Math.max(w, h) * 0.45, p[3], 0.2);
  },

  spotlight(ctx, w, h, p) {
    fill(ctx, w, h, p[0]);
    const cx = w / 2, cy = h * 0.52;
    blob(ctx, cx, cy, Math.min(w, h) * 0.62, p[2], 0.5);
    blob(ctx, cx, cy, Math.min(w, h) * 0.32, p[3], 0.5);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = p[3];
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(cx + s * w * 0.06, 0);
      ctx.lineTo(cx + s * w * 0.4, h);
      ctx.lineTo(cx + s * w * 0.02, h);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
    vignette(ctx, w, h, 0.7);
  },

  flare(ctx, w, h, p, seed) {
    const rnd = rng(seed);
    ctx.fillStyle = linGrad(ctx, w, h, [p[0], p[1]], 160);
    ctx.fillRect(0, 0, w, h);
    const x0 = w * 0.22, y0 = h * 0.2;
    blob(ctx, x0, y0, Math.min(w, h) * 0.5, p[3], 0.85);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      blob(ctx, lerp(x0, w * 0.85, t), lerp(y0, h * 0.85, t),
        Math.min(w, h) * (0.03 + rnd() * 0.07), p[2], 0.35);
    }
    ctx.restore();
    grain(ctx, w, h, 0.05, seed);
  },

  checker(ctx, w, h, p) {
    const s = Math.min(w, h) / 10;
    fill(ctx, w, h, p[3]);
    ctx.fillStyle = p[2];
    for (let y = 0, r = 0; y < h; y += s, r++) {
      for (let x = (r % 2 ? s : 0); x < w; x += s * 2) ctx.fillRect(x, y, s, s);
    }
    vignette(ctx, w, h, 0.3);
  },
};

// ---- the library ------------------------------------------------------------
// Presets are (generator x palette) pairs. Cheap to list, and every entry is a
// visually distinct design rather than a hue rotation of its neighbour.
const RECIPES = [
  ['glow', ['solana', 'neon', 'gold', 'blood', 'cyber', 'ice', 'money', 'fire']],
  ['mesh', ['neon', 'vapor', 'deep', 'sunset', 'bubble', 'ice', 'pastel', 'solana']],
  ['linear', ['sunset', 'vapor', 'gold', 'deep', 'bubble', 'mint', 'pastel', 'mono']],
  ['aurora', ['deep', 'solana', 'ice', 'neon', 'matrix']],
  ['sun', ['vapor', 'sunset', 'cyber', 'fire']],
  ['grid', ['matrix', 'cyber', 'solana', 'deep', 'mono']],
  ['rays', ['gold', 'fire', 'cyber', 'bubble', 'money']],
  ['stars', ['deep', 'solana', 'neon', 'mono', 'ice']],
  ['candles', ['money', 'matrix', 'solana', 'gold']],
  ['money', ['money', 'gold', 'matrix']],
  ['zoom', ['cyber', 'bubble', 'gold', 'mono', 'blood']],
  ['bokeh', ['neon', 'bubble', 'deep', 'gold', 'ice']],
  ['confetti', ['bubble', 'cyber', 'pastel', 'gold']],
  ['blobs', ['vapor', 'pastel', 'bubble', 'ice', 'neon']],
  ['topo', ['paper', 'deep', 'matrix', 'mono', 'ice']],
  ['waves', ['sunset', 'vapor', 'ice', 'money']],
  ['hex', ['cyber', 'solana', 'mono', 'matrix']],
  ['spotlight', ['mono', 'gold', 'blood', 'neon', 'ice']],
  ['flare', ['gold', 'fire', 'solana', 'deep']],
  ['dots', ['bubble', 'pastel', 'cyber', 'paper', 'mono']],
  ['stripes', ['bubble', 'gold', 'cyber', 'mono', 'paper']],
  ['halftone', ['bubble', 'cyber', 'gold', 'mono']],
  ['checker', ['mono', 'cyber', 'bubble', 'paper']],
  ['duo', ['mint', 'neon', 'solana', 'fire', 'ice', 'mono']],
];

const TITLE = {
  glow: 'Glow', mesh: 'Mesh', linear: 'Fade', aurora: 'Aurora', sun: 'Retro Sun',
  grid: 'Grid', rays: 'Sunburst', stars: 'Space', candles: 'Pump Chart', money: 'Money Rain',
  zoom: 'Impact', bokeh: 'Bokeh', confetti: 'Confetti', blobs: 'Liquid', topo: 'Topo',
  waves: 'Waves', hex: 'Hex', spotlight: 'Spotlight', flare: 'Flare', dots: 'Dots',
  stripes: 'Stripes', halftone: 'Halftone', checker: 'Checker', duo: 'Duotone',
};

export const BGS = [];
let _seed = 1000;
for (const [gen, pals] of RECIPES) {
  for (const pal of pals) {
    BGS.push({
      id: `${gen}-${pal}`,
      name: `${TITLE[gen]} · ${pal}`,
      gen, pal, seed: ++_seed,
      sort: BGS.length,
    });
  }
}

function drawRaw(ctx, w, h, bg) {
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  if (!bg || bg.kind === 'none') { ctx.restore(); return; }
  if (bg.kind === 'solid') { fill(ctx, w, h, bg.color); ctx.restore(); return; }
  if (bg.kind === 'image' && bg.img) {
    // cover-fit so an uploaded background never letterboxes
    const s = Math.max(w / bg.img.width, h / bg.img.height);
    const dw = bg.img.width * s, dh = bg.img.height * s;
    ctx.drawImage(bg.img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
    return;
  }
  const preset = BGS.find(b => b.id === bg.id) || BGS[0];
  const pal = PALETTES[bg.pal || preset.pal] || PALETTES.neon;
  GEN[preset.gen](ctx, w, h, pal, bg.seed ?? preset.seed);
  ctx.restore();
}

export const GEN_NAMES = Object.keys(GEN);

// ---- backdrop effects + cache ----------------------------------------------
// Blur, pixelate and darken apply to every backdrop kind, not just photos, so
// they live here rather than inside one branch. The result is cached: the
// generators are not cheap (a starfield draws hundreds of arcs) and the backdrop
// does not change while you drag a layer around.

const bgCache = new Map();
const BG_CACHE_MAX = 6;
let imgSeq = 0;

function bgKey(w, h, bg) {
  if (!bg || bg.kind === 'none') return `none:${w}x${h}`;
  if (bg.kind === 'image' && bg.img) {
    if (!bg.img._mfId) bg.img._mfId = ++imgSeq;
  }
  return [bg.kind, w, h, bg.id, bg.pal, bg.seed, bg.color,
    bg.img ? bg.img._mfId : 0, bg.blur || 0, bg.pixel || 0, bg.dim || 0].join('|');
}

export const hasBgFx = (bg) => !!bg && ((bg.blur || 0) > 0 || (bg.pixel || 0) > 0 || (bg.dim || 0) > 0);

function buildBackdrop(w, h, bg) {
  const blur = ((bg.blur || 0) / 100) * Math.min(w, h) * 0.06;
  // Blur feathers whatever it is given, so the backdrop is generated oversized
  // and the soft border is cropped off rather than left framing the canvas.
  const pad = Math.ceil(blur * 3);
  const pw = w + pad * 2, ph = h + pad * 2;

  let src = document.createElement('canvas');
  src.width = pw; src.height = ph;
  drawRaw(src.getContext('2d'), pw, ph, bg);

  if ((bg.pixel || 0) > 0) {
    // Mosaic: average down, then blow back up with smoothing off so the blocks
    // stay hard-edged. Done before the blur, which then softens the blocks.
    const block = Math.max(2, ((bg.pixel / 100) ** 1.5) * Math.min(w, h) * 0.10);
    const bw = Math.max(1, Math.round(pw / block)), bh = Math.max(1, Math.round(ph / block));
    const small = document.createElement('canvas');
    small.width = bw; small.height = bh;
    const sc = small.getContext('2d');
    sc.imageSmoothingEnabled = true;
    sc.imageSmoothingQuality = 'high';
    sc.drawImage(src, 0, 0, bw, bh);
    const up = document.createElement('canvas');
    up.width = pw; up.height = ph;
    const uc = up.getContext('2d');
    uc.imageSmoothingEnabled = false;
    uc.drawImage(small, 0, 0, pw, ph);
    src = up;
  }

  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  const ctx = out.getContext('2d');
  if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(2)}px)`;
  ctx.drawImage(src, -pad, -pad);
  ctx.filter = 'none';
  if ((bg.dim || 0) > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, bg.dim / 100)})`;
    ctx.fillRect(0, 0, w, h);
  }
  return out;
}

/** The finished backdrop at this size, effects applied, cached. */
export function backdropCanvas(w, h, bg) {
  const key = bgKey(w, h, bg);
  const hit = bgCache.get(key);
  if (hit) {
    // Refresh LRU position.
    bgCache.delete(key);
    bgCache.set(key, hit);
    return hit;
  }
  const c = buildBackdrop(w, h, bg);
  bgCache.set(key, c);
  if (bgCache.size > BG_CACHE_MAX) bgCache.delete(bgCache.keys().next().value);
  return c;
}

export function drawBG(ctx, w, h, bg) {
  if (!bg || bg.kind === 'none') return;
  // Nothing to post-process and nothing to reuse: draw straight through.
  if (!hasBgFx(bg)) { drawRaw(ctx, w, h, bg); return; }
  ctx.drawImage(backdropCanvas(w, h, bg), 0, 0, w, h);
}

/** Carry the blur/pixelate/darken settings onto a newly picked backdrop. */
export const withBgFx = (next, prev) => ({
  ...next,
  blur: prev.blur || 0,
  pixel: prev.pixel || 0,
  dim: prev.dim || 0,
});
