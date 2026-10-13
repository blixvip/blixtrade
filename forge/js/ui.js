// MemeForge editor: wiring, stage interaction, panels.
import { BGS, PALETTES, PAL_NAMES, drawBG, withBgFx } from './bgs.js';
import * as D from './doc.js';
import * as C from './cutout.js';
import { AURA_PRESETS } from './aura.js';
import { LOOKS, applyLook, seatInPlace, drawLookThumb } from './looks.js';
import { TARGETS, renderTarget, renderAll, renderMaster, drawTargetThumb, contentBounds, targetSize } from './pack.js';
import { FONTS, FONT_CATS, familyOf, loadFonts, TEXT_PRESETS, applyTextPreset } from './fonts.js';
import { CURATED, recentColors, remember, imageColors, eyedrop, rgbHex } from './swatches.js';
import { REMILIO } from './remilio.js';
import { findPanel, picturesFromDrop, pictureFromText, dragHasPicture } from './find.js';

// Inside Blix's Create coin page (an iframe with ?embed=1): the page sends its picture in, and "Use as coin
// picture" sends the finished art back (see the end of this file). On its own at /forge/ it is the plain editor.
const EMBED = new URLSearchParams(location.search).has('embed');

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}

// ---- state ------------------------------------------------------------------
const doc = D.newDoc();
const hist = new D.History(doc);
const view = { zoom: 1, ox: 0, oy: 0, auto: true };
const S = {
  tool: 'bg',   // opens on the backgrounds (the user, 2026-10-13: "it should start on the backgrounds page")
  look: null,
  paint: null,              // 'erase' | 'restore' | null
  brush: { radius: 60, hardness: 0.65 },
  // edge starts slightly negative: salient-object masks reliably keep a thin
  // rim of the old background, and that rim is what makes a paste look fake.
  cut: { model: 'fast', feather: 1.4, edge: -8, contrast: 1.6 },
  gpu: false,
  wandTol: 30,
  exportScale: 1,
  exportFmt: 'png',
  exportQ: 0.92,
  bgPal: null,
  textPreset: 'meme',
  pack: {},            // target id -> false when unticked
};

/** The photo these panels act on: the selection when it is one, else the first
 * image in the document. Selecting a text layer must not blank the photo tools. */
const imageLayer = () => {
  const sel = D.getSelected(doc);
  if (sel && sel.kind === 'image') return sel;
  return doc.layers.find(x => x.kind === 'image') || null;
};

/** Swap the backdrop while keeping its blur / pixelate / darken settings. */
function setBackdrop(next, label = 'bg') {
  doc.bg = withBgFx(next, doc.bg);
  hist.push(label);
  paint();
}

// ---- Remilio backdrops ------------------------------------------------------
// The 104 template backgrounds (forge/bg at 1200 px, forge/thumb at 224 px) as image backdrops. A picked one is
// kept once loaded, so going back to it is instant; blur, pixelate and darken apply to it like any backdrop.
const remilioImgs = new Map();
function remilioImage(id) {
  if (remilioImgs.has(id)) return remilioImgs.get(id);
  const p = new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('no picture')); i.src = `/forge/bg/${id}.webp`; });
  remilioImgs.set(id, p);
  return p;
}
async function pickRemilio(b) {
  try {
    const img = await remilioImage(b.id);
    setBackdrop({ kind: 'image', img, remilio: b.id }, 'remilio');
    syncPanel();
  } catch { toast('That background could not be loaded', true); }
}
const shuffleRemilio = () => pickRemilio(REMILIO[Math.floor(Math.random() * REMILIO.length)]);
const remilioList = (q) => { q = (q || '').trim().toLowerCase(); return q ? REMILIO.filter(b => b.name.toLowerCase().includes(q)) : REMILIO; };
function remilioGrid(list, id = 'remGrid') {
  return el('div', { id, class: 'remGrid' }, ...list.map(b => el('button', {
    class: 'bgc rem', title: b.name, 'aria-pressed': doc.bg.kind === 'image' && doc.bg.remilio === b.id,
    onclick: () => pickRemilio(b),
  }, el('img', { src: `/forge/thumb/${b.id}.webp`, alt: '', loading: 'lazy', draggable: 'false' }), el('span', { class: 'remName' }, b.name))),
  list.length ? null : el('div', { class: 'hint', style: 'grid-column:1/-1' }, 'No background by that name.'));
}
// A dozen of them for the Looks tab, drawn once a session.
const remilioSample = () => S.remSample || (S.remSample = [...REMILIO].sort(() => Math.random() - 0.5).slice(0, 12));
function remilioSec() {
  const search = el('input', {
    class: 'remSearch', type: 'search', placeholder: "Search backgrounds", value: S.remQ || '', spellcheck: 'false',
    oninput: (e) => { S.remQ = e.target.value; const g = $('#remGrid'); if (g) g.replaceWith(remilioGrid(remilioList(S.remQ))); },
  });
  return sec('Remilio backgrounds',
    el('div', { class: 'row gap', style: 'margin-bottom:8px' }, search, el('button', { class: 'chip', onclick: shuffleRemilio, title: 'A random one' }, 'Shuffle')),
    remilioGrid(remilioList(S.remQ)));
}

// One button for taking the photo's background off, used by the Looks and Backgrounds tabs.
function removeBgButton(l) {
  return el('button', {
    class: 'btn pri wide',
    onclick: async () => { doc.selected = l.id; await cutout(S.cut.model); syncPanel(); },
  }, 'Remove background');
}

const stage = $('#stage'), viewCv = $('#view'), vctx = viewCv.getContext('2d');
let dirty = true;
let rafId = 0;
let docRev = 0;
// Schedule a frame instead of polling for one: an idle editor now costs no CPU
// at all, rather than waking 60 times a second to find nothing to do.
const invalidate = () => {
  dirty = true;
  docRev++;
  if (!rafId) rafId = requestAnimationFrame(frame);
};

// ---- toast / busy -----------------------------------------------------------
let toastT;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('on'), err ? 4200 : 2100);
}
const busy = (msg) => { $('#busyMsg').textContent = msg || 'working…'; $('#busy').classList.toggle('on', !!msg); };

// ---- view -------------------------------------------------------------------
function resizeView() {
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  viewCv.width = Math.round(r.width * dpr);
  viewCv.height = Math.round(r.height * dpr);
  viewCv.style.width = r.width + 'px';
  viewCv.style.height = r.height + 'px';
  viewCv._dpr = dpr;
  viewCv._w = r.width;
  viewCv._h = r.height;
  if (view.auto) fitView();
  invalidate();
  const zl = document.getElementById('zoomLabel'); if (zl) zl.textContent = Math.round(view.zoom * 100) + '%';
}

function fitView() {
  const pad = 48;
  const z = Math.min((viewCv._w - pad) / doc.w, (viewCv._h - pad) / doc.h);
  view.zoom = z;
  view.ox = (viewCv._w - doc.w * z) / 2;
  view.oy = (viewCv._h - doc.h * z) / 2;
  view.auto = true;
  invalidate();
}

function zoomAt(factor, cx, cy) {
  const z0 = view.zoom;
  const z = clamp(z0 * factor, 0.04, 16);
  view.ox = cx - ((cx - view.ox) * z) / z0;
  view.oy = cy - ((cy - view.oy) * z) / z0;
  view.zoom = z;
  view.auto = false;
  invalidate();
}

const toDoc = (sx, sy) => ({ x: (sx - view.ox) / view.zoom, y: (sy - view.oy) / view.zoom });
const toScreen = (dx, dy) => ({ x: dx * view.zoom + view.ox, y: dy * view.zoom + view.oy });

function pt(e) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// ---- draw loop --------------------------------------------------------------
function frame() {
  rafId = 0;
  if (dirty) {
    dirty = false;
    const dpr = viewCv._dpr || 1;
    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.clearRect(0, 0, viewCv.width, viewCv.height);
    vctx.scale(dpr, dpr);

    // Canvas plate: checkerboard where the doc is transparent, plus a shadow so
    // the artboard reads as an object rather than a hole in the stage.
    vctx.fillStyle = '#121212';
    vctx.fillRect(view.ox, view.oy, doc.w * view.zoom, doc.h * view.zoom);

    vctx.save();
    vctx.translate(view.ox, view.oy);
    vctx.scale(view.zoom, view.zoom);
    vctx.beginPath();
    vctx.rect(0, 0, doc.w, doc.h);
    vctx.clip();
    D.render(vctx, doc, { showChecker: true });
    vctx.restore();

    drawChrome();
  }
}

function drawChrome() {
  const l = D.getSelected(doc);
  vctx.save();
  vctx.strokeStyle = '#ffffff1a';
  vctx.lineWidth = 1;
  vctx.strokeRect(view.ox + .5, view.oy + .5, doc.w * view.zoom, doc.h * view.zoom);

  // Snap guides, drawn only while a drag is actually snapped to something.
  if (guides.length) {
    vctx.save();
    vctx.strokeStyle = '#8f8f8f';
    vctx.lineWidth = 1;
    vctx.setLineDash([4, 4]);
    for (const [axis, at] of guides) {
      vctx.beginPath();
      if (axis === 'v') {
        const x = Math.round(view.ox + at * view.zoom) + .5;
        vctx.moveTo(x, view.oy);
        vctx.lineTo(x, view.oy + doc.h * view.zoom);
      } else {
        const y = Math.round(view.oy + at * view.zoom) + .5;
        vctx.moveTo(view.ox, y);
        vctx.lineTo(view.ox + doc.w * view.zoom, y);
      }
      vctx.stroke();
    }
    vctx.restore();
  }

  if (l && !S.paint) {
    const box = D.layerBox(l);
    vctx.translate(view.ox + l.x * view.zoom, view.oy + l.y * view.zoom);
    vctx.rotate((l.rot * Math.PI) / 180);
    const w = box.w * view.zoom, h = box.h * view.zoom;
    vctx.strokeStyle = '#b4b4b4';
    vctx.lineWidth = 1;
    vctx.setLineDash([4, 4]);
    vctx.strokeRect(-w / 2, -h / 2, w, h);
    vctx.setLineDash([]);
    vctx.fillStyle = '#e8e8e8';
    vctx.strokeStyle = '#555';
    for (const [hx, hy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      vctx.beginPath();
      vctx.arc((hx * w) / 2, (hy * h) / 2, 4.5, 0, 7);
      vctx.fill();
      vctx.stroke();
    }
    // rotate grip above the top edge
    vctx.beginPath();
    vctx.moveTo(0, -h / 2);
    vctx.lineTo(0, -h / 2 - 20);
    vctx.stroke();
    vctx.beginPath();
    vctx.arc(0, -h / 2 - 24, 4.5, 0, 7);
    vctx.fill();
    vctx.stroke();
  }
  vctx.restore();
}

// ---- image loading ----------------------------------------------------------
// A 20MP phone photo held at full size is ~70MB of canvas for no visible gain:
// 3200px still leaves 2x headroom over the largest pack target.
const MAXPX = 3200;

async function toCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, MAXPX / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

// `at`: where on the picture it lands (document coordinates: a drop point), else the middle. A picture added on top
// of others comes in at half the frame, so it does not cover the work under it.
// The photo goes in as it is: the background stays until Remove background is pressed (the user, 2026-10-13: "it
// shouldn't automatically remove the background"). `autoCut` is kept in the signature for old callers and ignored.
async function addPhoto(blob, { name = 'Photo', autoCut = false, at = null } = {}) {
  try {
    const c = await toCanvas(blob);
    const first = doc.layers.filter(x => x.kind === 'image').length === 0;
    const l = D.addImageLayer(doc, c, { name });
    if (!first) l.scale = Math.min(doc.w / c.width, doc.h / c.height) * 0.5;
    if (at) { l.x = clamp(at.x, 0, doc.w); l.y = clamp(at.y, 0, doc.h); }
    resetMask(l);
    $('#drop').classList.add('hide');
    hist.push('add photo');
    paint();
    syncPanel();
  } catch (e) {
    toast('Could not read that image', true);
  }
}

/** Blank stroke layer, always at the mask's own resolution. */
function blankStrokes(l) {
  const d = C.maskDims(l.src.width, l.src.height);
  return C.cv(d.w, d.h);
}

function resetMask(l) {
  if (l.untrimmed) {
    // A cutout cropped this layer; "full photo" has to give the frame back too.
    l.x = l.untrimmed.x;
    l.y = l.untrimmed.y;
    l.src = l.untrimmed.src;
    l.untrimmed = null;
    l.pixRev = (l.pixRev || 0) + 1;
  }
  l.cut = false;
  l.rawMask = C.solidMask(l.src.width, l.src.height);
  l.strokes = blankStrokes(l);
  recompose(l);
}

/** Rebuild layer.mask from rawMask + refine settings + brush strokes. */
function recompose(l) {
  if (!l || l.kind !== 'image' || !l.rawMask) return;
  const m = C.refine(l.rawMask, S.cut);
  if (l.strokes) m.getContext('2d').drawImage(l.strokes, 0, 0);
  l.mask = m;
  l.pixRev = (l.pixRev || 0) + 1;
  l._maskRev = l.pixRev;
  D.touch(l);
  invalidate();
}

/** Document point -> that layer's mask/stroke pixel coordinates. */
function toMaskPx(l, p) {
  const a = (-l.rot * Math.PI) / 180;
  const dx = p.x - l.x, dy = p.y - l.y;
  let lx = (dx * Math.cos(a) - dy * Math.sin(a)) / l.scale;
  const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / l.scale;
  if (l.flipX) lx = -lx;
  // The rendered bitmap is padded by outline/glow, so the photo's centre is the
  // bitmap centre; convert to source pixels, then to mask pixels.
  const k = (l.strokes ? l.strokes.width : l.src.width) / l.src.width;
  return {
    x: (lx + l.src.width / 2) * k,
    y: (ly + l.src.height / 2) * k,
    k,
  };
}

// ---- cutout -----------------------------------------------------------------
let cutting = false;
async function cutout(model = S.cut.model) {
  const l = D.getSelected(doc);
  if (!l || l.kind !== 'image') return toast('Select a photo first');
  if (cutting) return;
  cutting = true;
  busy(model === 'hq' ? 'High-quality cutout…' : 'Removing background…');
  try {
    const mask = await C.segment(l.src, model, S.gpu);
    l.rawMask = mask;
    l.strokes = blankStrokes(l);
    l.cut = true;
    recompose(l);
    // Shrink the layer onto the subject so the handles and hit box mean
    // something; without it the frame stays the size of the original photo.
    if (D.trimToMask(l)) recompose(l);
    hist.push('cutout');
    paint();
    const ep = mask.meta.ep === 'webgpu' ? 'GPU' : 'CPU';
    toast(`Background removed · ${mask.meta.ms}ms · ${ep}`);
    showEP(mask.meta.ep);
  } catch (e) {
    toast('Cutout failed: ' + e.message, true);
  } finally {
    cutting = false;
    busy(null);
  }
}

function showEP(ep) {
  const b = $('#epBadge');
  if (!ep) return;
  b.hidden = false;
  b.textContent = ep === 'webgpu' ? 'gpu' : 'cpu';
  b.classList.toggle('cpu', ep !== 'webgpu');
  b.title = ep === 'webgpu' ? 'Cutout running on the GPU' : 'Cutout running on CPU (multi-threaded wasm)';
}

// ---- stage interaction ------------------------------------------------------
let drag = null;

function hitLayer(p) {
  let boxed = null;
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (!l.visible || l.locked) continue;
    const box = D.layerBox(l);
    // un-rotate the point into the layer's own frame
    const a = (-l.rot * Math.PI) / 180;
    const dx = p.x - l.x, dy = p.y - l.y;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) > box.w / 2 || Math.abs(ly) > box.h / 2) continue;
    // Prefer the topmost layer with real pixels under the cursor; fall back to
    // the topmost box so a click in a subject's gap still grabs something.
    if (D.hitPixel(l, lx, ly)) return l;
    if (!boxed) boxed = l;
  }
  return boxed;
}

function handleAt(p) {
  const l = D.getSelected(doc);
  if (!l || l.locked || S.paint) return null;
  const box = D.layerBox(l);
  const a = (-l.rot * Math.PI) / 180;
  const dx = p.x - l.x, dy = p.y - l.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const tol = 11 / view.zoom;
  if (Math.abs(lx) < tol && Math.abs(ly + box.h / 2 + 24 / view.zoom) < tol) return { kind: 'rot', l };
  for (const [hx, hy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    if (Math.abs(lx - (hx * box.w) / 2) < tol && Math.abs(ly - (hy * box.h) / 2) < tol) {
      return { kind: 'scale', l, d0: Math.hypot(box.w / 2, box.h / 2) };
    }
  }
  return null;
}

stage.addEventListener('pointerdown', (e) => {
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
    stage.classList.add('panning');
    stage.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;
  const sp = pt(e);
  const p = toDoc(sp.x, sp.y);
  stage.setPointerCapture(e.pointerId);

  if (S.paint) {
    const l = D.getSelected(doc);
    if (!l || l.kind !== 'image') return toast('Select a photo to paint on');
    drag = { kind: 'paint', l, last: null };
    paintStroke(l, p);
    return;
  }
  const h = handleAt(p);
  if (h) {
    const box = D.layerBox(h.l);
    drag = {
      ...h, cx: h.l.x, cy: h.l.y, scale0: h.l.scale, rot0: h.l.rot,
      a0: Math.atan2(p.y - h.l.y, p.x - h.l.x),
      d0: Math.hypot(p.x - h.l.x, p.y - h.l.y) || 1,
      diag: Math.hypot(box.w, box.h),
    };
    return;
  }
  const l = hitLayer(p);
  if (l) {
    doc.selected = l.id;
    drag = { kind: 'move', l, gx: p.x - l.x, gy: p.y - l.y };
    paint();
  } else {
    doc.selected = null;
    drag = null;
    paint();
  }
  invalidate();
});

stage.addEventListener('pointermove', (e) => {
  const sp = pt(e);
  if (S.paint) {
    const c = $('#cursor');
    const r = S.brush.radius * view.zoom * (D.getSelected(doc)?.scale || 1);
    c.style.width = c.style.height = r * 2 + 'px';
    c.style.left = sp.x - r + 'px';
    c.style.top = sp.y - r + 'px';
  }
  if (!drag) return;
  if (drag.kind === 'pan') {
    view.ox = drag.ox + (e.clientX - drag.sx);
    view.oy = drag.oy + (e.clientY - drag.sy);
    view.auto = false;
    return invalidate();
  }
  const p = toDoc(sp.x, sp.y);
  if (drag.kind === 'move') {
    drag.l.x = p.x - drag.gx;
    drag.l.y = p.y - drag.gy;
    if (!e.altKey) snapLayer(drag.l);
  } else if (drag.kind === 'scale') {
    const d = Math.hypot(p.x - drag.cx, p.y - drag.cy) || 1;
    drag.l.scale = clamp(drag.scale0 * (d / drag.d0), 0.01, 40);
  } else if (drag.kind === 'rot') {
    const a = Math.atan2(p.y - drag.cy, p.x - drag.cx);
    let deg = drag.rot0 + ((a - drag.a0) * 180) / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    drag.l.rot = deg;
  } else if (drag.kind === 'paint') {
    paintStroke(drag.l, p);
  }
  invalidate();
});

// Snap a dragged layer to the canvas centre lines and edges. Threshold is in
// screen pixels so it feels the same at every zoom; hold Alt to bypass.
let guides = [];
function snapLayer(l) {
  const tol = 7 / view.zoom;
  const box = D.layerBox(l);
  guides = [];
  if (Math.abs(l.x - doc.w / 2) < tol) { l.x = doc.w / 2; guides.push(['v', doc.w / 2]); }
  else if (Math.abs(l.x - box.w / 2) < tol) { l.x = box.w / 2; guides.push(['v', 0]); }
  else if (Math.abs(l.x + box.w / 2 - doc.w) < tol) { l.x = doc.w - box.w / 2; guides.push(['v', doc.w]); }

  if (Math.abs(l.y - doc.h / 2) < tol) { l.y = doc.h / 2; guides.push(['h', doc.h / 2]); }
  else if (Math.abs(l.y - box.h / 2) < tol) { l.y = box.h / 2; guides.push(['h', 0]); }
  else if (Math.abs(l.y + box.h / 2 - doc.h) < tol) { l.y = doc.h - box.h / 2; guides.push(['h', doc.h]); }
}

function endDrag() {
  guides = [];
  if (!drag) return;
  const k = drag.kind;
  stage.classList.remove('panning');
  drag = null;
  if (k !== 'pan') hist.push(k);
  syncSliders();
  renderLayerBar();
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

// Strokes live in mask pixels, so they survive moving, scaling and rotating the
// layer, and they stay valid if the photo is re-cut.
function paintStroke(l, p) {
  const { x: ix, y: iy, k } = toMaskPx(l, p);
  const r = S.brush.radius * k;
  const pts = [[ix, iy]];
  if (drag && drag.last) {
    // Interpolate, or a fast flick paints a dotted line instead of a stroke.
    const [px, py] = drag.last;
    const steps = Math.min(64, Math.ceil(Math.hypot(ix - px, iy - py) / Math.max(1, r * 0.3)));
    for (let i = 1; i < steps; i++) {
      pts.unshift([px + ((ix - px) * i) / steps, py + ((iy - py) * i) / steps]);
    }
  }
  if (drag) drag.last = [ix, iy];
  C.brush(l.strokes, pts, { radius: r, hardness: S.brush.hardness, mode: S.paint });
  recompose(l);
}

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = pt(e);
  if (e.ctrlKey || !D.getSelected(doc) || S.paint) {
    return zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
  }
  const l = D.getSelected(doc);
  if (e.shiftKey) l.rot += e.deltaY > 0 ? 3 : -3;
  else l.scale = clamp(l.scale * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 0.01, 40);
  invalidate();
  syncSliders();
}, { passive: false });

stage.addEventListener('dblclick', () => {
  const l = D.getSelected(doc);
  if (l && l.kind === 'text') { setTool('text'); $('#textInput')?.focus(); }
});

// drag & drop: anywhere in the editor. Files, or a picture dragged from another tab or window (Google Images,
// Pinterest, ChatGPT) or from the Find panel. On the canvas it lands where it is dropped; anywhere else, in the
// middle. Hold Shift (or have the Backdrop tab open) and it becomes the backdrop instead. Several files at once
// are spread out from the drop point.
let dragDepth = 0;
const dropHint = () => $('#drop .big');
document.addEventListener('dragenter', (e) => {
  if (!dragHasPicture(e.dataTransfer)) return;
  e.preventDefault();
  if (dragDepth++ === 0) { $('#drop').classList.remove('hide'); $('#drop').classList.add('hot'); }
});
document.addEventListener('dragover', (e) => {
  if (!dragHasPicture(e.dataTransfer)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const asBg = e.shiftKey || S.tool === 'bg';
  const b = dropHint(); if (b) b.textContent = asBg ? 'Drop to set the backdrop' : (stage.contains(e.target) ? 'Drop it right here' : 'Drop to add it');
});
const endFileDrag = () => {
  dragDepth = 0;
  $('#drop').classList.remove('hot');
  const b = dropHint(); if (b) b.textContent = 'Drop a photo here';
  if (doc.layers.length) $('#drop').classList.add('hide');
};
document.addEventListener('dragleave', (e) => { if (--dragDepth <= 0) endFileDrag(); });
document.addEventListener('drop', async (e) => {
  if (!dragHasPicture(e.dataTransfer)) return;
  e.preventDefault();
  const asBg = e.shiftKey || S.tool === 'bg', onStage = stage.contains(e.target);
  const p = onStage ? pt(e) : null, at = p ? toDoc(p.x, p.y) : null;
  endFileDrag();
  let pics;
  busy('Getting the picture…');
  try { pics = await picturesFromDrop(e.dataTransfer); }
  catch (err) { busy(null); toast(err.message || 'Could not get that picture', true); return; }
  busy(null);
  if (!pics.length) { toast('That was not a picture', true); return; }
  if (asBg) { setBackdrop({ kind: 'image', img: await toCanvas(pics[0].blob) }, 'bg image'); toast('Backdrop set'); return; }
  const step = doc.w * 0.12;
  pics.forEach((x, i) => addPhoto(x.blob, { name: x.name, autoCut: i === 0, at: at ? { x: at.x + (i % 3) * step - (pics.length > 1 ? step : 0), y: at.y + Math.floor(i / 3) * step } : null }));
});

document.addEventListener('paste', async (e) => {
  if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  for (const it of e.clipboardData?.items || []) {
    if (it.type.startsWith('image/')) {
      e.preventDefault();
      if (S.tool === 'bg') setBackdrop({ kind: 'image', img: await toCanvas(it.getAsFile()) }, 'bg image');
      else addPhoto(it.getAsFile(), { name: 'Pasted' });
      return;
    }
  }
  // A picture's address (copied from Google, Pinterest or anywhere): fetched and added.
  const text = e.clipboardData?.getData('text/plain');
  if (text && /^(https?:\/\/\S+|data:image\/\S+)$/i.test(text.trim())) {
    e.preventDefault();
    busy('Getting the picture…');
    try { const blob = await pictureFromText(text); busy(null); if (blob) addPhoto(blob, { name: 'Pasted' }); }
    catch (err) { busy(null); toast(err.message || 'Could not get that picture', true); }
  }
});

$('#file').addEventListener('change', (e) => {
  [...e.target.files].forEach((f, i) => addPhoto(f, { name: f.name.replace(/\.[^.]+$/, '').slice(0, 18), autoCut: i === 0 }));
  e.target.value = '';
});
$('#openBtn').addEventListener('click', () => $('#file').click());

// ---- keyboard ---------------------------------------------------------------
let spaceDown = false;
let nudgeT = null;
const TOOLKEYS = { 1: 'looks', 2: 'cut', 3: 'aura', 4: 'bg', 5: 'style', 6: 'text', 7: 'export', 8: 'find' };
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
  if (e.code === 'Space' && !typing) { spaceDown = true; stage.classList.add('pan'); e.preventDefault(); }
  if (typing) return;
  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    (e.shiftKey ? hist.redo() : hist.undo()) ? paint() : toast(e.shiftKey ? 'Nothing to redo' : 'Nothing to undo');
    return;
  }
  if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); hist.redo() && paint(); return; }
  if (meta && e.key.toLowerCase() === 'c') { e.preventDefault(); copyOut(); return; }
  if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); download(); return; }
  if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
  if (meta && (e.key === ']' || e.key === '[')) {
    e.preventDefault();
    const sel = D.getSelected(doc);
    if (sel && D.arrange(doc, sel.id, e.key === ']' ? 1 : -1)) { hist.push('arrange'); paint(); }
    return;
  }
  if (meta) return;

  // Nudge: 1px, or 10 with shift. The fastest way to place something exactly.
  if (e.key.startsWith('Arrow')) {
    const sel = D.getSelected(doc);
    if (sel && !sel.locked) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') sel.x -= d;
      if (e.key === 'ArrowRight') sel.x += d;
      if (e.key === 'ArrowUp') sel.y -= d;
      if (e.key === 'ArrowDown') sel.y += d;
      invalidate();
      clearTimeout(nudgeT);
      nudgeT = setTimeout(() => hist.push('nudge'), 400);
    }
    return;
  }

  if (TOOLKEYS[e.key]) return setTool(TOOLKEYS[e.key]);
  const k = e.key.toLowerCase();
  if (k === 'delete' || k === 'backspace') {
    const l = D.getSelected(doc);
    if (l) { D.removeLayer(doc, l.id); hist.push('delete'); paint(); }
  } else if (k === 'e') { setPaint(S.paint === 'erase' ? null : 'erase'); }
  else if (k === 'r') { setPaint(S.paint === 'restore' ? null : 'restore'); }
  else if (k === 'escape') { setPaint(null); }
  else if (k === 'b') { cutout(); }
  else if (k === '[') { S.brush.radius = clamp(S.brush.radius / 1.25, 4, 1200); syncSliders(); }
  else if (k === ']') { S.brush.radius = clamp(S.brush.radius * 1.25, 4, 1200); syncSliders(); }
  else if (k === '0') fitView();
  else if (k === '+' || k === '=') zoomAt(1.2, viewCv._w / 2, viewCv._h / 2);
  else if (k === '-') zoomAt(1 / 1.2, viewCv._w / 2, viewCv._h / 2);
  else if (k === 'f') { const l = D.getSelected(doc); if (l) { l.flipX = !l.flipX; hist.push('flip'); invalidate(); } }
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { spaceDown = false; stage.classList.remove('pan'); }
});

function setPaint(mode) {
  S.paint = mode;
  stage.classList.toggle('paint', !!mode);
  if (mode) setTool('cut', true);
  invalidate();
  syncPanel();
}

function duplicate() {
  const l = D.getSelected(doc);
  if (!l) return;
  D.cloneLayer(doc, l);
  hist.push('duplicate');
  paint();
}

// ---- export -----------------------------------------------------------------
function exportCanvas() {
  const flat = S.exportFmt === 'jpeg' ? (doc.bg.kind === 'none' ? '#ffffff' : null) : null;
  return D.renderTo(doc, S.exportScale, flat);
}
const mime = () => ({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' })[S.exportFmt];
const blobOf = (c) => new Promise(r => c.toBlob(r, mime(), S.exportQ));

async function copyOut() {
  try {
    const c = D.renderTo(doc, 1);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
    toast('Copied to clipboard');
  } catch (e) { toast('Clipboard blocked by the browser', true); }
}

async function download() {
  const c = exportCanvas();
  const b = await blobOf(c);
  const a = el('a', {
    href: URL.createObjectURL(b),
    download: `memeforge-${Date.now().toString(36)}.${S.exportFmt === 'jpeg' ? 'jpg' : S.exportFmt}`,
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Saved ${c.width}×${c.height} ${S.exportFmt.toUpperCase()}`);
}

/** Preset tiles, each rendered in its own font so the list shows what you get. */
function presetGrid(t) {
  return el('div', { class: 'tpGrid' }, ...TEXT_PRESETS.map(p => el('button', {
    class: 'tpc', 'aria-pressed': t ? sameStyle(t, p) : S.textPreset === p.id,
    title: p.name,
    onclick: () => {
      S.textPreset = p.id;
      const live = D.getSelected(doc);
      if (live && live.kind === 'text') {
        applyTextPreset(live, p);
        D.touch(live);
        hist.push('text style');
        paint();
      } else {
        addStyledText(p.id);
      }
    },
  },
  el('span', {
    class: 'tps',
    style: `font-family:${familyOf(p.style.font)}; color:${p.style.color === 'transparent' ? '#ffffff' : p.style.color};`
      + (p.style.color === 'transparent' ? ' -webkit-text-stroke:1px #fff; color:transparent;' : ''),
  }, p.sample),
  el('b', {}, p.name))));
}

const sameStyle = (t, p) => t.font === p.style.font && t.color === p.style.color && t.strokeW === p.style.strokeW;

/** Add a text layer already wearing a style. */
function addStyledText(presetId) {
  const p = TEXT_PRESETS.find(x => x.id === presetId) || TEXT_PRESETS[0];
  const t = D.addTextLayer(doc, 'YOUR TEXT');
  applyTextPreset(t, p);
  S.textPreset = p.id;
  D.touch(t);
  hist.push('add text');
  paint();
  setTool('text');
  setTimeout(() => { const i = $('#textInput'); if (i) { i.focus(); i.select(); } }, 30);
  return t;
}

const packTargets = () => TARGETS.filter(t => S.pack[t.id] !== false);

const toDataURL = (c) => new Promise((res) => {
  c.toBlob((b) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(b);
  }, 'image/png');
});

/** Render every selected target and write them into one out/ folder. */
async function savePack() {
  const list = packTargets();
  if (!list.length || !doc.layers.length) return;
  const files = [];
  const master = doc.bg.kind !== 'none' ? renderMaster(doc) : null;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    busy(`Rendering ${t.name}… (${i + 1}/${list.length})`);
    // Yield between targets so the progress text actually paints.
    await new Promise(r => requestAnimationFrame(r));
    files.push({ name: t.file, data: await toDataURL(renderTarget(doc, t, master)) });
  }
  busy('Writing files…');
  const res = await fetch('/api/save', {
    method: 'POST',
    body: JSON.stringify({
      slug: 'pack',
      files,
      meta: {
        at: new Date().toISOString(),
        canvas: { w: doc.w, h: doc.h },
        backdrop: doc.bg.kind === 'preset' ? doc.bg.id : doc.bg.kind,
        files: list.map(t => ({ file: t.file, ...targetSize(doc, t), note: t.note || '' })),
      },
    }),
  }).then(r => r.json());
  busy(null);
  if (res.error) throw new Error(res.error);
  toast(`${files.length} files → out/${res.dir.split(/[\\/]/).pop()}`);
  fetch('/api/reveal?dir=' + encodeURIComponent(res.dir)).catch(() => {});
}

/** Same files, straight to the browser's download folder. */
async function downloadPack() {
  const list = packTargets();
  const master = doc.bg.kind !== 'none' ? renderMaster(doc) : null;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    busy(`Rendering ${t.name}… (${i + 1}/${list.length})`);
    await new Promise(r => requestAnimationFrame(r));
    const b = await new Promise(r => renderTarget(doc, t, master).toBlob(r, 'image/png'));
    const a = el('a', { href: URL.createObjectURL(b), download: t.file });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 6000);
    // Chrome drops rapid-fire downloads; a beat between them keeps all of them.
    await new Promise(r => setTimeout(r, 180));
  }
  busy(null);
  toast(`${list.length} files downloaded`);
}

async function saveToDisk() {
  const c = exportCanvas();
  const b = await blobOf(c);
  const data = await new Promise(r => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(b);
  });
  const ext = S.exportFmt === 'jpeg' ? 'jpg' : S.exportFmt;
  const res = await fetch('/api/save', {
    method: 'POST',
    body: JSON.stringify({ slug: 'edit', files: [{ name: `image.${ext}`, data }], meta: { w: c.width, h: c.height, bg: doc.bg.id } }),
  }).then(r => r.json());
  toast('Saved to out/' + res.dir.split(/[\\/]/).pop());
  fetch('/api/reveal?dir=' + encodeURIComponent(res.dir)).catch(() => {});
}

$('#copyBtn').onclick = copyOut;
// In a small window (the Create page's editor window) the layers dock folds away behind this button.
$('#layersToggle').addEventListener('click', () => {
  const on = !document.body.classList.contains('showLayers');
  document.body.classList.toggle('showLayers', on);
  $('#layersToggle').setAttribute('aria-pressed', String(on));
});
// Drag out: the finished picture dragged onto the desktop (Chrome saves it as a file), into a chat or any page
// that takes pictures. Rendered the moment the drag starts.
$('#dragOut').addEventListener('dragstart', (e) => {
  try {
    const url = D.renderTo(doc, 1).toDataURL('image/png');
    const name = `blix-${Date.now().toString(36)}.png`;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('DownloadURL', `image/png:${name}:${url}`);
    e.dataTransfer.setData('text/uri-list', url);
    e.dataTransfer.setData('text/html', `<img src="${url}" alt="">`);
    const ghost = new Image(); ghost.src = url; ghost.width = 96;
    e.dataTransfer.setDragImage(ghost, 48, 48);
  } catch { toast('Could not render the picture', true); }
});
$('#dlBtn').onclick = download;
$('#undo').onclick = () => hist.undo() && paint();
$('#redo').onclick = () => hist.redo() && paint();
$('#zoomIn').onclick = () => zoomAt(1.2, viewCv._w / 2, viewCv._h / 2);
$('#zoomOut').onclick = () => zoomAt(1 / 1.2, viewCv._w / 2, viewCv._h / 2);
$('#fitBtn').onclick = fitView;

// ---- panels -----------------------------------------------------------------
function slider(label, min, max, step, get, set, fmt = (v) => v) {
  const out = el('b', {}, String(fmt(get())));
  const inp = el('input', {
    type: 'range', min, max, step, value: get(),
    oninput: (e) => { set(parseFloat(e.target.value)); out.textContent = String(fmt(get())); },
  });
  inp._sync = () => { inp.value = get(); out.textContent = String(fmt(get())); };
  return el('div', { class: 'sl' }, el('div', { class: 'lab' }, el('span', {}, label), out), inp);
}

/** Sample the rendered canvas under a screen point, for the eyedropper fallback. */
function samplePoint(sx, sy) {
  const dpr = viewCv._dpr || 1;
  const d = vctx.getImageData(Math.round(sx * dpr), Math.round(sy * dpr), 1, 1).data;
  return rgbHex(d[0], d[1], d[2]);
}

// Colours lifted from the loaded photo, cached until the photo changes.
let photoSwatches = { key: null, list: [] };
function photoColors() {
  const l = imageLayer();
  if (!l) return [];
  const src = (l.untrimmed && l.untrimmed.src) || l.src;
  if (photoSwatches.key !== src) {
    try { photoSwatches = { key: src, list: imageColors(src, 8) }; }
    catch { photoSwatches = { key: src, list: [] }; }
  }
  return photoSwatches.list;
}

/**
 * A colour control: current value, eyedropper, and three rows of markers —
 * from your photo, recently used, and a fixed set. Clicking a marker is one
 * action instead of opening a dialog and typing hex.
 */
function colorField(label, get, set, { allowNone = false } = {}) {
  const apply = (v) => { set(v); remember(v); syncPanel(); };
  const marker = (hex, title) => el('button', {
    class: 'sw', title: title || hex, 'aria-pressed': (get() || '').toLowerCase() === hex.toLowerCase(),
    style: `background:${hex}`,
    onclick: () => apply(hex),
  });
  const mine = photoColors();
  const recents = recentColors();
  return el('div', { class: 'cfield' },
    el('div', { class: 'crow' },
      el('input', {
        type: 'color', value: /^#[0-9a-f]{6}$/i.test(get() || '') ? get() : '#ffffff',
        oninput: (e) => { set(e.target.value); invalidate(); },
        onchange: (e) => apply(e.target.value),
      }),
      el('span', { class: 'clab' }, label),
      el('div', { class: 'grow' }),
      allowNone ? el('button', {
        class: 'chip', title: 'No fill — outline only',
        'aria-pressed': get() === 'transparent',
        onclick: () => { set('transparent'); syncPanel(); },
      }, 'none') : null,
      el('button', { class: 'chip', title: 'Pick a colour from anywhere on screen', onclick: () => pickColor(apply) }, '⟟')),
    mine.length ? el('div', { class: 'swrow', title: 'From your photo' },
      el('span', { class: 'swtag' }, 'photo'), ...mine.map(c => marker(c, 'From your photo · ' + c))) : null,
    recents.length ? el('div', { class: 'swrow', title: 'Recently used' },
      el('span', { class: 'swtag' }, 'recent'), ...recents.slice(0, 9).map(c => marker(c))) : null,
    el('div', { class: 'swrow' }, el('span', { class: 'swtag' }, 'all'), ...CURATED.map(c => marker(c))));
}

let eyedropping = null;
async function pickColor(apply) {
  const hex = await eyedrop(() => {
    // No native picker: arm a one-shot click on the canvas instead.
    toast('Click the canvas to sample a colour');
    return new Promise(res => { eyedropping = res; });
  });
  if (hex) apply(hex);
}

function colorRow(label, get, set) {
  return el('div', { class: 'row gap' },
    el('input', { type: 'color', value: get(), oninput: (e) => set(e.target.value) }),
    el('span', { class: 'hint' }, label));
}

function sec(title, ...kids) {
  return el('div', { class: 'sec' }, title ? el('div', { class: 'shead' }, title) : null, ...kids);
}

const PANELS = {
  // Find: web and Pinterest pictures, and ChatGPT in a window beside (find.js).
  find() {
    return findPanel({ el, sec, toast, rerender: () => { if (S.tool === 'find') syncPanel(); },
      add: (blob, name) => addPhoto(blob, { name, autoCut: !doc.layers.some(x => x.kind === 'image') }),
      backdrop: async (blob) => { setBackdrop({ kind: 'image', img: await toCanvas(blob) }, 'bg image'); toast('Backdrop set'); } });
  },
  looks() {
    const l = imageLayer();
    if (!l || l.kind !== 'image') {
      return [sec('Start here',
        el('button', { class: 'btn pri wide', onclick: () => $('#file').click() }, 'Open a photo'),
        el('div', { class: 'hint', style: 'margin-top:9px' },
          'Or drop one on the canvas, or paste it with Ctrl+V. Then remove its background here to try the looks on it.'))];
    }
    // A look is a glow around a cut-out subject: until the background is off there is nothing to preview it on.
    if (!l.cut) {
      return [sec('Looks',
        el('div', { class: 'hint', style: 'margin-bottom:10px' }, 'Looks put a glow around the subject, so the background has to come off first. Your photo stays as it is until you press this.'),
        removeBgButton(l))];
    }
    const aspect = doc.w / doc.h;
    const grid = el('div', { id: 'lookGrid' }, ...LOOKS.map(k => {
      const tw = 168, th = Math.round(168 / aspect);   // drawn at about the size shown, so they are sharp
      // A look tile only depends on the subject's pixels and the frame shape —
      // not on where the layer currently sits, which is what used to make every
      // drag redraw all fifteen.
      const c = tile(`look|${k.id}|${l.id}|${l.pixRev || 0}|${l.cut ? 1 : 0}|${aspect.toFixed(3)}`, tw, th,
        (cv) => drawLookThumb(cv.getContext('2d'), tw, l, k, aspect));
      return el('button', {
        class: 'lookc', title: k.name, 'aria-pressed': S.look === k.id,
        onclick: () => pickLook(k),
      }, c, el('b', {}, k.name), k.note ? el('i', {}, k.note) : null);
    }));
    runThumbs();

    return [
      sec('Pick a look',
        el('div', { class: 'hint', style: 'margin-bottom:9px' },
          'Each one is previewed on your photo. Click to apply — then fine-tune in Aura, Backgrounds or Style.'),
        grid),
      sec('Remilio backgrounds',
        el('div', { class: 'hint', style: 'margin-bottom:8px' }, `The subject on one of the ${REMILIO.length} template backgrounds; the aura and placement stay.`),
        remilioGrid(remilioSample(), 'remStrip'),
        el('div', { class: 'row gap', style: 'margin-top:8px' },
          el('button', { class: 'chip', onclick: shuffleRemilio }, 'Shuffle'),
          el('button', { class: 'chip', onclick: () => setTool('bg') }, `All ${REMILIO.length}…`))),
      sec('Photo',
        el('div', { class: 'g2' },
          el('button', { class: 'chip', onclick: () => $('#file').click() }, 'Replace…'),
          el('button', { class: 'chip', onclick: () => { seatInPlace(doc, l); hist.push('reseat'); paint(); } }, 'Re-centre')),
        el('div', { class: 'g3', style: 'margin-top:6px' },
          el('button', { class: 'chip', onclick: () => { l.flipX = !l.flipX; hist.push('flip'); invalidate(); } }, 'Flip'),
          el('button', { class: 'chip', onclick: duplicate }, 'Duplicate'),
          el('button', { class: 'chip', onclick: () => { D.removeLayer(doc, l.id); hist.push('delete'); paint(); } }, 'Delete'))),
      sec('Canvas size',
        el('div', { class: 'g2' }, ...D.PRESETS.map(p =>
          el('button', {
            class: 'chip', 'aria-pressed': doc.presetId === p.id,
            onclick: () => applyPreset(p),
          }, p.name + ' · ' + p.sub.split(' · ')[0])))),
    ];
  },

  cut() {
    const l = D.getSelected(doc);
    const has = l && l.kind === 'image';
    return [
      sec('Remove background',
        el('div', { class: 'g2' },
          el('button', { class: 'btn go', onclick: () => cutout('fast'), disabled: !has }, 'Fast cut'),
          el('button', { class: 'btn', onclick: () => cutout('hq'), disabled: !has }, 'HQ cut')),
        el('div', { class: 'hint', style: 'margin-top:7px' },
          'Fast is right for most shots (~0.7s). HQ uses heavier weights for tighter edges on hair, flowers and blown-out light — about twice the wait.'),
        el('label', { class: 'ck', style: 'margin-top:8px' },
          el('input', {
            type: 'checkbox', checked: S.gpu,
            onchange: (e) => {
              S.gpu = e.target.checked;
              C.warm(S.cut.model, S.gpu).then(r => r && showEP(r.ep));
              toast(S.gpu ? 'Trying the GPU — watch the timing' : 'Back to multi-threaded CPU');
            },
          }), 'Run on GPU (faster only with a discrete card)')),
      has ? sec('Edge',
        slider('Feather', 0, 6, 0.1, () => S.cut.feather, (v) => { S.cut.feather = v; recompose(l); }, v => v.toFixed(1)),
        slider('Edge shift', -40, 40, 1, () => S.cut.edge, (v) => { S.cut.edge = v; recompose(l); }),
        slider('Hardness', 1, 6, 0.1, () => S.cut.contrast, (v) => { S.cut.contrast = v; recompose(l); }, v => v.toFixed(1)),
        el('div', { class: 'hint' }, 'Push edge shift negative to eat a halo of old background; positive to win back hair.')) : null,
      has ? sec('Brush',
        el('div', { class: 'g2' },
          el('button', {
            class: 'chip', 'aria-pressed': S.paint === 'erase',
            onclick: () => setPaint(S.paint === 'erase' ? null : 'erase'),
          }, 'Erase (E)'),
          el('button', {
            class: 'chip', 'aria-pressed': S.paint === 'restore',
            onclick: () => setPaint(S.paint === 'restore' ? null : 'restore'),
          }, 'Restore (R)')),
        slider('Size', 4, 600, 1, () => S.brush.radius, (v) => { S.brush.radius = v; invalidate(); }, Math.round),
        slider('Softness', 0, 0.95, 0.05, () => 1 - S.brush.hardness, (v) => { S.brush.hardness = 1 - v; }, v => Math.round(v * 100) + '%')) : null,
      has ? sec('Magic wand',
        slider('Tolerance', 4, 90, 1, () => S.wandTol, (v) => { S.wandTol = v; }),
        el('button', {
          class: 'btn wide', onclick: () => {
            toast('Click the colour to remove');
            wandArmed = true;
          },
        }, 'Click a colour to drop it'),
        el('div', { class: 'hint', style: 'margin-top:6px' }, 'Instant, no model — best on flat or near-flat backgrounds.')) : null,
      has ? sec('Reset',
        el('div', { class: 'g2' },
          el('button', {
            class: 'chip', onclick: () => {
              l.strokes = blankStrokes(l);
              recompose(l);
              hist.push('clear brush');
            },
          }, 'Clear brush'),
          el('button', {
            class: 'chip', onclick: () => {
              resetMask(l);
              hist.push('reset mask');
            },
          }, 'Full photo'))) : null,
      !has ? sec(null, el('div', { class: 'hint' }, 'Add a photo first, then cut it out.')) : null,
    ];
  },

  bg() {
    const ph = imageLayer();
    const photoSec = ph && ph.kind === 'image'
      ? sec('Your photo', ph.cut
        ? el('div', { class: 'row gap' },
          el('span', { class: 'hint', style: 'flex:1' }, 'Background removed.'),
          el('button', { class: 'chip', onclick: () => { resetMask(ph); hist.push('reset mask'); paint(); } }, 'Put it back'))
        : el('div', {},
          el('div', { class: 'hint', style: 'margin-bottom:8px' }, 'Pick a background below. To put your subject on it, remove the photo\'s own background.'),
          removeBgButton(ph)))
      : sec('Your photo',
        el('button', { class: 'btn pri wide', onclick: () => $('#file').click() }, 'Open a photo'),
        el('div', { class: 'hint', style: 'margin-top:8px' }, 'Or drop or paste one on the canvas. Pick a background any time.'));
    const pals = el('div', { class: 'palrow' },
      el('button', {
        class: 'chip', 'aria-pressed': !S.bgPal,
        onclick: () => { S.bgPal = null; syncPanel(); },
      }, 'All'),
      ...PAL_NAMES.map(p => el('button', {
        class: 'palc', 'aria-pressed': S.bgPal === p, title: p,
        style: `background:linear-gradient(135deg,${PALETTES[p][1]},${PALETTES[p][2]},${PALETTES[p][3]})`,
        onclick: () => { S.bgPal = S.bgPal === p ? null : p; syncPanel(); },
      })));

    const list = S.bgPal ? BGS.filter(b => b.pal === S.bgPal) : BGS;
    const grid = el('div', { id: 'bgGrid' }, ...list.map(b => {
      // A backdrop swatch never changes — cache it for the life of the session.
      const c = tile(`bg|${b.id}`, 72, 72, (cv) => drawBG(cv.getContext('2d'), 72, 72, { kind: 'preset', id: b.id }));
      return el('button', {
        class: 'bgc', title: b.name, 'aria-pressed': doc.bg.kind === 'preset' && doc.bg.id === b.id,
        onclick: () => setBackdrop({ kind: 'preset', id: b.id }),
      }, c);
    }));
    runThumbs();

    return [
      photoSec,
      remilioSec(),
      sec('Backdrop',
        el('div', { class: 'g3' },
          el('button', {
            class: 'chip', 'aria-pressed': doc.bg.kind === 'none',
            onclick: () => setBackdrop({ kind: 'none' }),
          }, 'Transparent'),
          el('button', {
            class: 'chip', 'aria-pressed': doc.bg.kind === 'solid',
            onclick: () => setBackdrop({ kind: 'solid', color: doc.bg.color || '#2a2a2a' }),
          }, 'Solid'),
          el('button', { class: 'chip', onclick: () => $('#bgFile').click() }, 'Image…')),
        doc.bg.kind === 'solid'
          ? el('div', { style: 'margin-top:8px' }, colorRow('Background colour', () => doc.bg.color, (v) => { doc.bg.color = v; invalidate(); }))
          : null),
      sec('Adjust',
        doc.bg.kind === 'none'
          ? el('div', { class: 'hint' }, 'Pick a backdrop above — blur, pixelate and darken apply to any of them.')
          : el('div', {},
            slider('Blur', 0, 100, 1, () => doc.bg.blur || 0, (v) => { doc.bg.blur = v; invalidate(); }, Math.round),
            slider('Pixelate', 0, 100, 1, () => doc.bg.pixel || 0, (v) => { doc.bg.pixel = v; invalidate(); }, Math.round),
            slider('Darken', 0, 95, 1, () => doc.bg.dim || 0, (v) => { doc.bg.dim = v; invalidate(); }, Math.round),
            el('div', { class: 'row gap', style: 'margin-top:5px' },
              el('button', {
                class: 'chip',
                onclick: () => { doc.bg.blur = 0; doc.bg.pixel = 0; doc.bg.dim = 0; hist.push('bg reset'); paint(); },
              }, 'Reset'),
              el('span', { class: 'hint' }, 'Pixelate runs first, so blur softens the blocks.')))),
      sec('Presets', pals, el('div', { style: 'height:8px' }), grid,
        el('div', { class: 'hint', style: 'margin-top:8px' }, `${list.length} procedural backdrops — drawn at full export resolution, never upscaled.`)),
    ];
  },

  aura() {
    const l = imageLayer();
    if (!l || l.kind !== 'image') {
      return [sec('Aura', el('div', { class: 'hint' }, 'Add a photo, then this lights it from behind.'),
        el('button', { class: 'btn pri wide', style: 'margin-top:10px', onclick: () => $('#file').click() }, 'Open image…'))];
    }
    const f = l.fx;
    const bump = () => { D.touch(l); invalidate(); };
    const on = f.aura > 0;

    const swatches = el('div', { id: 'auraGrid' }, ...AURA_PRESETS.map(p => el('button', {
      class: 'aurac', title: p.name,
      'aria-pressed': on && f.auraPreset === p.id,
      style: `--c0:${p.colors[0]};--c1:${p.colors[1]};--c2:${p.colors[2]}`,
      onclick: () => {
        f.auraPreset = p.id;
        if (!f.aura) f.aura = 100;
        bump();
        hist.push('aura preset');
        syncPanel();
      },
    }, el('span', { class: 'ring' }), el('b', {}, p.name))));

    return [
      sec('Aura',
        el('button', { class: 'btn go wide', onclick: auraOneClick },
          l.cut ? 'Apply the glow look' : 'Cut out + glow in one click'),
        el('div', { class: 'hint', style: 'margin-top:7px' },
          'Cuts the subject out, rims it with light, and drops it back onto its own photo.')),
      sec('Colour', swatches,
        el('div', { class: 'row gap', style: 'margin-top:9px' },
          el('button', {
            class: 'chip', 'aria-pressed': f.auraPreset === 'custom',
            onclick: () => { f.auraPreset = 'custom'; if (!f.aura) f.aura = 100; bump(); syncPanel(); },
          }, 'Custom'),
          el('input', { type: 'color', value: f.auraCore, title: 'Core', oninput: (e) => { f.auraCore = e.target.value; f.auraPreset = 'custom'; bump(); } }),
          el('input', { type: 'color', value: f.auraMid, title: 'Middle', oninput: (e) => { f.auraMid = e.target.value; f.auraPreset = 'custom'; bump(); } }),
          el('input', { type: 'color', value: f.auraOuter, title: 'Outer', oninput: (e) => { f.auraOuter = e.target.value; f.auraPreset = 'custom'; bump(); } }))),
      sec('Shape',
        slider('Strength', 0, 100, 1, () => f.aura, (v) => { f.aura = v; bump(); }),
        slider('Size', 5, 100, 1, () => f.auraSize, (v) => { f.auraSize = v; bump(); }),
        slider('Flicker', 0, 100, 1, () => f.auraWarp, (v) => { f.auraWarp = v; bump(); }),
        el('div', { class: 'row gap', style: 'margin-top:4px' },
          el('button', {
            class: 'chip', onclick: () => { f.auraSeed = (f.auraSeed % 97) + 7; bump(); },
          }, 'Reroll flicker'),
          el('button', {
            class: 'chip', onclick: () => { f.aura = 0; bump(); hist.push('aura off'); syncPanel(); },
          }, 'Remove aura')),
        el('div', { class: 'hint', style: 'margin-top:7px' },
          'Flicker warps the rim so it licks like flame instead of tracing a perfect outline.')),
      sec('Backdrop',
        el('button', {
          class: 'btn wide', onclick: () => {
            glowInPlace(l, { blur: doc.bg.blur || 0, dim: doc.bg.dim || 0 });
            hist.push('in place');
            paint();
          },
        }, 'Use the original photo'),
        doc.bg.kind !== 'none'
          ? el('div', { style: 'margin-top:9px' },
            slider('Blur it', 0, 100, 1, () => doc.bg.blur || 0, (v) => { doc.bg.blur = v; invalidate(); }, Math.round),
            slider('Pixelate it', 0, 100, 1, () => doc.bg.pixel || 0, (v) => { doc.bg.pixel = v; invalidate(); }, Math.round),
            slider('Darken it', 0, 95, 1, () => doc.bg.dim || 0, (v) => { doc.bg.dim = v; invalidate(); }, Math.round))
          : el('div', { class: 'hint', style: 'margin-top:7px' }, 'Or pick any backdrop from the Backdrop tab — the rim lights it up either way.')),
    ];
  },

  style() {
    const l = D.getSelected(doc);
    if (!l) return [sec(null, el('div', { class: 'hint' }, 'Select a layer on the canvas to style it.'))];
    const img = l.kind === 'image';
    const bump = () => { D.touch(l); invalidate(); };
    return [
      sec('Transform',
        slider('Scale', 1, 400, 1, () => l.scale * 100, (v) => { l.scale = v / 100; invalidate(); }, Math.round),
        slider('Rotate', -180, 180, 1, () => l.rot, (v) => { l.rot = v; invalidate(); }, Math.round),
        slider('Opacity', 0, 100, 1, () => l.opacity * 100, (v) => { l.opacity = v / 100; invalidate(); }, Math.round)),
      img ? sec('Adjust',
        slider('Brightness', 20, 200, 1, () => l.adj.bri, (v) => { l.adj.bri = v; bump(); }),
        slider('Contrast', 20, 220, 1, () => l.adj.con, (v) => { l.adj.con = v; bump(); }),
        slider('Saturation', 0, 300, 1, () => l.adj.sat, (v) => { l.adj.sat = v; bump(); }),
        slider('Hue', -180, 180, 1, () => l.adj.hue, (v) => { l.adj.hue = v; bump(); }),
        slider('Blur', 0, 100, 1, () => l.adj.blur, (v) => { l.adj.blur = v; bump(); }),
        el('button', {
          class: 'chip', onclick: () => { l.adj = { bri: 100, con: 100, sat: 100, hue: 0, blur: 0 }; bump(); syncPanel(); },
        }, 'Reset adjustments')) : null,
      sec('Effects',
        img ? slider('Outline', 0, 100, 1, () => l.fx.outline, (v) => { l.fx.outline = v; bump(); }) : null,
        img ? colorRow('Outline colour', () => l.fx.outlineColor, (v) => { l.fx.outlineColor = v; bump(); }) : null,
        slider('Shadow', 0, 100, 1, () => l.fx.shadow, (v) => { l.fx.shadow = v; bump(); }),
        colorRow('Shadow colour', () => l.fx.shadowColor, (v) => { l.fx.shadowColor = v; bump(); }),
        img ? el('button', { class: 'chip', style: 'margin-top:4px', onclick: () => setTool('aura') }, 'Aura is its own tab →') : null,
        !img ? slider('Glow', 0, 100, 1, () => l.fx.glow, (v) => { l.fx.glow = v; bump(); }) : null,
        !img ? colorRow('Glow colour', () => l.fx.glowColor, (v) => { l.fx.glowColor = v; bump(); }) : null),
    ];
  },

  text() {
    const l = D.getSelected(doc);
    const t = l && l.kind === 'text' ? l : null;
    const bump = () => { D.touch(t); invalidate(); };

    if (!t) {
      return [sec('Text',
        el('div', { class: 'g2' },
          el('button', { class: 'btn pri', onclick: () => addStyledText('meme') }, 'Add text'),
          el('button', { class: 'btn', onclick: () => $('#addEmoji').click() }, 'Sticker…')),
        el('div', { class: 'hint', style: 'margin-top:9px' },
          doc.layers.some(x => x.kind === 'text')
            ? 'Select a text layer on the canvas or in the Layers list to edit it.'
            : 'Add a text layer, then pick a style below — each one sets the font, colours and outline in a single click.'),
        el('div', { style: 'height:11px' }),
        presetGrid(null))];
    }

    const fontTiles = FONT_CATS.map(cat => el('div', {},
      el('div', { class: 'swtag', style: 'margin:7px 0 4px' }, cat),
      el('div', { class: 'fontGrid' }, ...FONTS.filter(f => f.cat === cat).map(f =>
        el('button', {
          class: 'fontc', 'aria-pressed': t.font === f.id, title: f.name,
          style: `font-family:${familyOf(f.id)}`,
          onclick: () => { t.font = f.id; bump(); syncPanel(); },
        }, f.name)))));

    return [
      sec('Text',
        el('textarea', {
          id: 'textInput', rows: 2,
          oninput: (e) => { t.text = e.target.value; t.name = e.target.value.slice(0, 18) || 'Text'; bump(); renderLayerBar(); },
        }, t.text),
        el('div', { class: 'g2', style: 'margin-top:7px' },
          el('button', { class: 'chip', onclick: () => addStyledText(S.textPreset || 'meme') }, 'Add another'),
          el('button', { class: 'chip', onclick: () => { D.removeLayer(doc, t.id); hist.push('delete'); paint(); } }, 'Delete'))),
      sec('Style', presetGrid(t)),
      sec('Font', ...fontTiles),
      sec('Shape',
        slider('Size', 10, 420, 1, () => t.size, (v) => { t.size = v; bump(); }, Math.round),
        slider('Letter spacing', -20, 80, 1, () => t.tracking, (v) => { t.tracking = v; bump(); }, Math.round),
        slider('Line height', 0.7, 2.2, 0.05, () => t.lineH || 1.1, (v) => { t.lineH = v; bump(); }, v => v.toFixed(2)),
        el('div', { class: 'g3', style: 'margin-top:6px' }, ...[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([k, n]) =>
          el('button', {
            class: 'chip', 'aria-pressed': (t.align || 'center') === k,
            onclick: () => { t.align = k; bump(); syncPanel(); },
          }, n))),
        el('label', { class: 'ck', style: 'margin-top:7px' },
          el('input', { type: 'checkbox', checked: t.caps, onchange: (e) => { t.caps = e.target.checked; bump(); } }), 'All caps')),
      sec('Fill', colorField('Text colour', () => t.color, (v) => { t.color = v; bump(); }, { allowNone: true })),
      sec('Outline',
        slider('Width', 0, 40, 1, () => t.strokeW, (v) => { t.strokeW = v; bump(); }, Math.round),
        t.strokeW > 0 ? colorField('Outline colour', () => t.stroke, (v) => { t.stroke = v; bump(); }) : null),
      sec('Shadow & glow',
        slider('Shadow', 0, 60, 1, () => t.fx.shadow, (v) => { t.fx.shadow = v; bump(); }, Math.round),
        t.fx.shadow > 0 ? colorField('Shadow colour', () => t.fx.shadowColor, (v) => { t.fx.shadowColor = v; bump(); }) : null,
        slider('Glow', 0, 100, 1, () => t.fx.glow, (v) => { t.fx.glow = v; bump(); }, Math.round),
        t.fx.glow > 0 ? colorField('Glow colour', () => t.fx.glowColor, (v) => { t.fx.glowColor = v; bump(); }) : null),
    ];
  },

  export() {
    const c = { w: Math.round(doc.w * S.exportScale), h: Math.round(doc.h * S.exportScale) };
    const has = doc.layers.length > 0;
    const on = TARGETS.filter(t => S.pack[t.id] !== false);

    // One master render feeds every tile, instead of ten full re-renders.
    const sig = has ? artSig() : '';
    let master = null;
    const getMaster = () => (master || (master = doc.bg.kind !== 'none' ? renderMaster(doc) : null));
    const grid = el('div', { id: 'packGrid' }, ...TARGETS.map(t => {
      const dims = t.doc ? `${doc.w} × ${doc.h}` : `${t.w} × ${t.h}`;
      const cv = has
        ? tile(`pack|${t.id}|${sig}`, 268, 268, (c) => drawTargetThumb(c, doc, t, getMaster()))
        : el('canvas', { width: 268, height: 268 });
      const btn = el('button', {
        class: 'packc', 'aria-pressed': S.pack[t.id] !== false,
        title: (t.note ? t.name + ' — ' + t.note : t.name) + ' · ' + dims,
        onclick: () => { S.pack[t.id] = S.pack[t.id] === false; syncPanel(); },
      }, cv, el('b', {}, t.name), el('i', {}, dims));
      return btn;
    }));
    runThumbs();

    return [
      sec('Launch pack',
        el('div', { class: 'hint', style: 'margin-bottom:8px' },
          has ? `${on.length} files, each re-framed for its own shape — not one image stretched. Click a tile to skip it.`
            : 'Add a photo and every size a launch needs lands in one folder.'),
        grid,
        el('div', { class: 'row gap', style: 'margin-top:9px' },
          el('button', {
            class: 'btn pri', style: 'flex:1; justify-content:center; display:flex',
            disabled: !has || !on.length,
            title: 'Download every file',
            onclick: () => downloadPack().catch(e => toast('Download failed: ' + e.message, true)),
          }, 'Download the pack'))),
      sec('This canvas only',
        el('div', { class: 'g3' }, ...[['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP']].map(([k, n]) =>
          el('button', { class: 'chip', 'aria-pressed': S.exportFmt === k, onclick: () => { S.exportFmt = k; syncPanel(); } }, n))),
        el('div', { class: 'g3', style: 'margin-top:8px' }, ...[0.5, 1, 2].map(s =>
          el('button', { class: 'chip', 'aria-pressed': S.exportScale === s, onclick: () => { S.exportScale = s; syncPanel(); } }, s + '×'))),
        S.exportFmt !== 'png'
          ? el('div', { style: 'margin-top:8px' }, slider('Quality', 0.4, 1, 0.01, () => S.exportQ, (v) => { S.exportQ = v; }, v => Math.round(v * 100) + '%'))
          : null,
        el('div', { class: 'hint', style: 'margin-top:8px' }, `${c.w} × ${c.h} px` + (S.exportFmt === 'png' && doc.bg.kind === 'none' ? ' · transparent' : '')),
        el('div', { class: 'g3', style: 'margin-top:9px' },
          el('button', { class: 'chip', onclick: download }, 'Download'),
          el('button', { class: 'chip', onclick: copyOut }, 'Copy'),
          EMBED ? el('button', { class: 'chip', onclick: useAsCoinPicture }, 'Use as coin picture') : null)),
    ];
  },
};

/**
 * Preview tiles are expensive (a look tile is a full composite) and almost
 * always unchanged between panel rebuilds, so they are cached by exactly what
 * they depend on and the same canvas element is re-appended.
 */
const tileCache = new Map();
function tile(key, w, h, draw) {
  let c = tileCache.get(key);
  if (c) return c;
  c = el('canvas', { width: w, height: h });
  tileCache.set(key, c);
  if (tileCache.size > 90) tileCache.delete(tileCache.keys().next().value);
  // A preview that fails is dropped from the cache, so the next time the panel is drawn it is tried again.
  thumbQueue.push(() => { try { draw(c); } catch { tileCache.delete(key); } });
  return c;
}

/** What a full-composition preview depends on. Cheap to build, exact enough. */
function artSig() {
  const b = doc.bg;
  return doc.layers.map(l => [l.id, Math.round(l.x), Math.round(l.y), l.scale.toFixed(3),
    Math.round(l.rot), l.visible ? 1 : 0, l.blend, l.opacity.toFixed(2), l._key].join(',')).join(';')
    + '|' + [b.kind, b.id, b.color, b.blur || 0, b.pixel || 0, b.dim || 0,
      b.img ? (b.img._mfId || 'img') : 0].join(',')
    + '|' + doc.w + 'x' + doc.h;
}

// Thumbnails are drawn a few per frame: 100+ procedural backdrops at once would
// block the panel from appearing.
const thumbQueue = [];
let thumbRunning = false;
function runThumbs() {
  if (thumbRunning) return;
  thumbRunning = true;
  const step = () => {
    const t0 = performance.now();
    while (thumbQueue.length && performance.now() - t0 < 7) thumbQueue.shift()();
    if (thumbQueue.length) requestAnimationFrame(step);
    else thumbRunning = false;
  };
  requestAnimationFrame(step);
}

let wandArmed = false;
stage.addEventListener('click', (e) => {
  if (eyedropping) {
    const sp = pt(e);
    const hex = samplePoint(sp.x, sp.y);
    const done = eyedropping;
    eyedropping = null;
    done(hex);
    return;
  }
  if (!wandArmed) return;
  wandArmed = false;
  const l = D.getSelected(doc);
  if (!l || l.kind !== 'image') return;
  const sp = pt(e);
  const m = toMaskPx(l, toDoc(sp.x, sp.y));
  const ix = Math.round(m.x), iy = Math.round(m.y);
  if (ix < 0 || iy < 0 || ix >= l.strokes.width || iy >= l.strokes.height) return toast('Click inside the photo');
  busy('Flood filling…');
  requestAnimationFrame(() => {
    try {
      C.wand(l.src, l.strokes, ix, iy, S.wandTol, Math.max(0.5, S.cut.feather));
      recompose(l);
      hist.push('wand');
      toast('Colour removed');
    } catch (err) { toast('Wand failed: ' + err.message, true); }
    busy(null);
  });
});

$('#bgFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  setBackdrop({ kind: 'image', img: await toCanvas(f) }, 'bg image');
});

function setTool(name, quiet = false) {
  S.tool = name;
  document.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === name));
  if (!quiet && name !== 'cut') setPaintQuiet(null);
  syncPanel();
}
function setPaintQuiet(m) {
  S.paint = m;
  stage.classList.toggle('paint', !!m);
  invalidate();
}
document.querySelectorAll('.tool').forEach(b => (b.onclick = () => setTool(b.dataset.tool)));

/**
 * Push current values into the sliders already on screen.
 *
 * Dragging or wheel-scaling a layer used to call syncPanel(), which rebuilds the
 * panel — and with the Looks tab open that meant re-rendering fifteen previews
 * per wheel tick. Nothing about those tiles changes when a layer moves, so only
 * the numbers need touching.
 */
function syncSliders() {
  for (const inp of $('#panel').querySelectorAll('input[type=range]')) {
    if (inp._sync) inp._sync();
  }
  $('#undo').disabled = !hist.canUndo;
  $('#redo').disabled = !hist.canRedo;
  $('#zoomLabel').textContent = Math.round(view.zoom * 100) + '%';
}

function syncPanel() {
  thumbQueue.length = 0;
  const p = $('#panel');
  p.replaceChildren(...PANELS[S.tool]().filter(Boolean));
  $('#undo').disabled = !hist.canUndo;
  $('#redo').disabled = !hist.canRedo;
  $('#dims').textContent = `${doc.w} × ${doc.h}`;
  $('#zoomLabel').textContent = Math.round(view.zoom * 100) + '%';
}

// ---- layers dock ------------------------------------------------------------
const THUMB = 38;

function layerThumb(l) {
  // _key is the layer's bitmap cache key, so this is exactly "the pixels changed".
  const key = `lyr|${l.id}|${l._key}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const c = el('canvas', { width: THUMB * 2, height: THUMB * 2 });
  const ctx = c.getContext('2d');
  try {
    const bm = D.layerBitmap(l);
    const s = Math.min((THUMB * 2) / bm.width, (THUMB * 2) / bm.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bm, (THUMB * 2 - bm.width * s) / 2, (THUMB * 2 - bm.height * s) / 2, bm.width * s, bm.height * s);
  } catch { /* a thumbnail is never worth breaking the dock over */ }
  tileCache.set(key, c);
  if (tileCache.size > 90) tileCache.delete(tileCache.keys().next().value);
  return c;
}

let rowDrag = null;

function renderLayerBar() {
  const list = $('#layerList');
  // Top of the list is top of the stack, which is the end of the array.
  const rows = [...doc.layers].reverse();
  list.replaceChildren(...rows.map((l) => {
    const eye = el('span', {
      class: 'eye', title: 'Show / hide',
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => {
        e.stopPropagation();
        l.visible = !l.visible;
        hist.push('visibility');
        invalidate();
        renderLayerBar();
      },
    }, l.visible ? '●' : '○');

    const label = el('div', {},
      el('div', { class: 'lname' }, (l.locked ? '🔒 ' : '') + (l.name || (l.kind === 'text' ? 'Text' : 'Photo'))),
      el('div', { class: 'lmeta' },
        `${l.kind === 'text' ? 'text' : 'photo'}${l.blend !== 'normal' ? ' · ' + l.blend : ''}${l.opacity < 1 ? ' · ' + Math.round(l.opacity * 100) + '%' : ''}`));

    return el('button', {
      class: 'lrow' + (l.visible ? '' : ' hidden-layer'),
      'aria-pressed': doc.selected === l.id,
      'data-id': l.id,
      title: 'Drag to restack · double-click to rename',
      onclick: () => { doc.selected = l.id; paint(); },
      ondblclick: () => renameLayer(l),
      onpointerdown: (e) => startRowDrag(e, l),
    }, eye, layerThumb(l), label);
  }));
  renderLayerProps();
}

function renameLayer(l) {
  const name = prompt('Layer name', l.name || '');
  if (name == null) return;
  l.name = name.slice(0, 40);
  hist.push('rename');
  renderLayerBar();
}

// Drag a row to restack. Pointer events rather than HTML5 drag-and-drop, so it
// behaves the same on a trackpad and can't start a ghost-image drag.
function startRowDrag(e, l) {
  if (e.button !== 0) return;
  const list = $('#layerList');
  const row = e.currentTarget;
  rowDrag = { id: l.id, y0: e.clientY, row, moved: false };
  const line = el('div', { id: 'dropLine' });

  const onMove = (ev) => {
    if (!rowDrag) return;
    if (!rowDrag.moved && Math.abs(ev.clientY - rowDrag.y0) < 5) return;
    if (!rowDrag.moved) { rowDrag.moved = true; row.classList.add('dragging'); }
    const rows = [...list.querySelectorAll('.lrow')];
    let before = null;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (ev.clientY < b.top + b.height / 2) { before = r; break; }
    }
    before ? list.insertBefore(line, before) : list.append(line);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    row.classList.remove('dragging');
    if (rowDrag && rowDrag.moved && line.parentNode) {
      const order = [...list.children].filter(n => n.classList.contains('lrow') || n === line);
      const visualIndex = order.indexOf(line);
      const dropped = order.filter(n => n !== line).indexOf(row);
      // The list is top-of-stack first, so a visual index maps to an array
      // index from the other end.
      let target = doc.layers.length - 1 - visualIndex;
      if (visualIndex > dropped) target += 1;
      if (D.reorder(doc, rowDrag.id, target)) hist.push('restack');
    }
    line.remove();
    rowDrag = null;
    paint();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function renderLayerProps() {
  const box = $('#layerProps');
  const l = D.getSelected(doc);
  if (!l) {
    box.replaceChildren(el('div', { class: 'hint' }, 'No layer selected.'));
    return;
  }
  box.replaceChildren(
    el('select', {
      title: 'Blend mode',
      onchange: (e) => { l.blend = e.target.value; hist.push('blend'); invalidate(); renderLayerBar(); },
    }, ...D.BLEND_MODES.map(([v, n]) => el('option', { value: v, selected: l.blend === v }, n))),
    slider('Opacity', 0, 100, 1, () => l.opacity * 100, (v) => { l.opacity = v / 100; invalidate(); }, Math.round),
    el('div', { class: 'g4' },
      el('button', { class: 'chip', title: 'Bring to front', onclick: () => { D.arrange(doc, l.id, Infinity) && hist.push('arrange'); paint(); } }, 'Front'),
      el('button', { class: 'chip', title: 'Bring forward (Ctrl+])', onclick: () => { D.arrange(doc, l.id, 1) && hist.push('arrange'); paint(); } }, 'Up'),
      el('button', { class: 'chip', title: 'Send backward (Ctrl+[)', onclick: () => { D.arrange(doc, l.id, -1) && hist.push('arrange'); paint(); } }, 'Down'),
      el('button', { class: 'chip', title: 'Send to back', onclick: () => { D.arrange(doc, l.id, -Infinity) && hist.push('arrange'); paint(); } }, 'Back')),
    el('div', { class: 'g4' },
      el('button', { class: 'chip', 'aria-pressed': l.locked, title: 'Lock position', onclick: () => { l.locked = !l.locked; hist.push('lock'); renderLayerBar(); } }, l.locked ? 'Locked' : 'Lock'),
      el('button', { class: 'chip', title: 'Centre on canvas', onclick: () => { centerLayer(l); renderLayerBar(); } }, 'Centre'),
      el('button', { class: 'chip', title: 'Duplicate (Ctrl+D)', onclick: duplicate }, 'Copy'),
      el('button', { class: 'chip', title: 'Delete (Del)', onclick: () => { D.removeLayer(doc, l.id); hist.push('delete'); paint(); } }, 'Delete')),
  );
}

const STICKERS = ['🔥', '💰', '🚀', '💎', '🤑', '😂', '💀', '👀', '✨', '⚡', '🐸', '🐶', '🌙', '📈', '🧠', '👑'];

function addSticker(ch) {
  const t = D.addTextLayer(doc, ch);
  Object.assign(t, {
    name: ch, font: 'emoji', caps: false, strokeW: 0,
    size: Math.round(Math.min(doc.w, doc.h) * 0.22),
    x: doc.w / 2, y: doc.h / 2,
  });
  t.fx.shadow = 18;
  D.touch(t);
  hist.push('sticker');
  paint();
}

/** Full UI refresh after anything structural. */
function paint() {
  invalidate();
  syncPanel();
  renderLayerBar();
  $('#drop').classList.toggle('hide', doc.layers.length > 0);
}

// ---- doc ops ----------------------------------------------------------------
function applyPreset(p) {
  resizeDoc(p.w, p.h, p.id);
}
function resizeDoc(w, h, presetId) {
  // Keep layers where they *look* like they are: scale positions with the frame
  // so switching 1:1 -> 9:16 doesn't fling the subject off-canvas.
  const fx = w / doc.w, fy = h / doc.h;
  const f = Math.min(fx, fy);
  doc.layers.forEach(l => { l.x *= fx; l.y *= fy; l.scale *= f; });
  doc.w = w; doc.h = h;
  doc.presetId = presetId || (D.PRESETS.find(p => p.w === w && p.h === h) || {}).id || null;
  fitView();
  hist.push('resize');
  paint();
  renderPresetChips();
}
function centerLayer(l) { l.x = doc.w / 2; l.y = doc.h / 2; hist.push('center'); invalidate(); }

/**
 * Put the cut-out subject back exactly where it sat in its own photo, with that
 * photo as the backdrop — the subject glows in place instead of being pasted
 * onto something else.
 */
function glowInPlace(l, { blur = 0, dim = 0 } = {}) {
  const img = (l.untrimmed && l.untrimmed.src) || l.src;
  doc.bg = { kind: 'image', img, blur, dim, pixel: doc.bg.pixel || 0, _key: undefined };
  // Match the cover-fit the backdrop uses, then offset by however far the trim
  // moved the subject's centre away from the photo's centre.
  const s = Math.max(doc.w / img.width, doc.h / img.height);
  const dx = (l.untrimmed && l.untrimmed.dx) || 0;
  const dy = (l.untrimmed && l.untrimmed.dy) || 0;
  l.scale = s;
  l.rot = 0;
  l.flipX = false;
  l.x = doc.w / 2 + dx * s;
  l.y = doc.h / 2 + dy * s;
  invalidate();
}

/** Apply a one-click look, cutting the subject out first if that hasn't happened. */
async function pickLook(look) {
  const l = imageLayer();
  if (!l || l.kind !== 'image') return toast('Add a photo first');
  doc.selected = l.id;
  if (!l.cut) await cutout(S.cut.model);
  const live = D.getSelected(doc);
  if (!live || live.kind !== 'image') return;
  applyLook(doc, live, look);
  S.look = look.id;
  hist.push('look');
  paint();
  toast(look.name);
}

/** The whole reference look in one go: cut out, gold rim, subject back in place. */
async function auraOneClick() {
  const l = imageLayer();
  if (!l || l.kind !== 'image') return toast('Add a photo first');
  doc.selected = l.id;
  if (!l.cut) await cutout(S.cut.model);
  const f = D.getSelected(doc);
  if (!f || f.kind !== 'image') return;
  Object.assign(f.fx, { aura: 100, auraSize: 46, auraWarp: 55, auraPreset: 'gold' });
  D.touch(f);
  glowInPlace(f);
  hist.push('aura');
  paint();
  setTool('aura');
}
function fillFrame(l) {
  const bm = D.layerBitmap(l);
  l.scale = Math.max(doc.w / bm.width, doc.h / bm.height);
  l.x = doc.w / 2; l.y = doc.h / 2; l.rot = 0;
  hist.push('fill');
  invalidate();
  syncPanel();
}

function renderPresetChips() {
  $('#presetChips').replaceChildren(...D.PRESETS.map(p =>
    el('button', {
      class: 'chip', title: p.sub, 'aria-pressed': doc.presetId === p.id,
      onclick: () => applyPreset(p),
    }, p.name)));
}

$('#addText').onclick = () => addStyledText(S.textPreset || 'meme');
$('#addImg').onclick = () => $('#file').click();
$('#addEmoji').onclick = () => {
  const bar = $('#emojiBar');
  if (!bar.children.length) {
    bar.replaceChildren(...STICKERS.map(ch =>
      el('button', { title: 'Add ' + ch, onclick: () => addSticker(ch) }, ch)));
  }
  bar.hidden = !bar.hidden;
};

// ---- boot -------------------------------------------------------------------
new ResizeObserver(resizeView).observe(stage);
renderPresetChips();
resizeView();
paint();
renderLayerBar();
invalidate();
// Webfonts must be in before any text layer caches its bitmap, or the canvas
// keeps stale pixels drawn in the fallback face.
loadFonts().then((n) => {
  doc.layers.forEach(l => { if (l.kind === 'text') D.touch(l); });
  invalidate();
  if (S.tool === 'text') syncPanel();
  if (!n) toast('Bundled fonts failed to load; using system faces', true);
});

// Compile and prime the fast model while the user is still picking a photo, so
// the first cutout costs one inference instead of inference plus startup.
const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
idle(() => C.warm('fast', S.gpu).then(r => r && showEP(r.ep)));
window.addEventListener('beforeunload', (e) => {
  if (doc.layers.length) { e.preventDefault(); e.returnValue = ''; }
});

// ---- Blix: the Create coin page ---------------------------------------------
// The art at 1x as a PNG, handed to the page as a data URL (web/src/pages/Launch.tsx shrinks it to the 4 MB
// pump.fun takes). The page sends its own picture in with forge-load, and hears forge-ready once this is up.
async function useAsCoinPicture() {
  if (!doc.layers.length) return toast('Add a photo first');
  busy('Rendering…');
  try {
    const c = D.renderTo(doc, 1);
    const b = await new Promise(r => c.toBlob(r, 'image/png'));
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
    window.parent.postMessage({ type: 'forge-picture', dataUrl, w: c.width, h: c.height }, location.origin);
    toast('Set as the coin\'s picture');
  } finally { busy(null); }
}
if (EMBED && window.parent !== window) {
  const b = $('#useBtn');
  b.hidden = false;
  b.onclick = () => useAsCoinPicture().catch(e => toast('Could not render: ' + e.message, true));
  window.addEventListener('message', async (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'forge-load' || typeof e.data.dataUrl !== 'string') return;
    try { await addPhoto(await (await fetch(e.data.dataUrl)).blob(), { name: String(e.data.name || 'Coin').slice(0, 18) }); }
    catch { toast('Could not read that picture', true); }
  });
  window.parent.postMessage({ type: 'forge-ready' }, location.origin);
}

// Handle for the CDP tests (and for poking at a document from the console).
window.MF = {
  doc, hist, S, view, D, C,
  addPhoto, cutout, recompose, resetMask, setTool, setPaint, paint, invalidate,
  auraOneClick, glowInPlace, pickLook, LOOKS, addSticker, renderLayerBar,
  TARGETS, renderTarget, renderAll, renderMaster, contentBounds, savePack, packTargets,
  setBackdrop, addStyledText, TEXT_PRESETS, FONTS, loadFonts, imageColors,
  syncSliders, tileCache: () => tileCache,
  snapLayer, guides: () => guides,
  hitLayerAt: (x, y) => hitLayer({ x, y }),
  exportCanvas, duplicate, fitView, toast,
  paintAt: (dx, dy) => {
    const l = D.getSelected(doc);
    if (!l) return false;
    C.brush(l.strokes, [[...Object.values(toMaskPx(l, { x: dx, y: dy }))].slice(0, 2)],
      { radius: S.brush.radius * (l.strokes.width / l.src.width), hardness: S.brush.hardness, mode: S.paint || 'erase' });
    recompose(l);
    return true;
  },
  wandAt: (dx, dy) => {
    const l = D.getSelected(doc);
    if (!l) return false;
    const m = toMaskPx(l, { x: dx, y: dy });
    C.wand(l.src, l.strokes, Math.round(m.x), Math.round(m.y), S.wandTol, 1);
    recompose(l);
    return true;
  },
};
