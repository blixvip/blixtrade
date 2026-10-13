// Display faces, bundled locally.
//
// Canvas can only draw a webfont once it is actually loaded, and a text layer
// caches its bitmap — so a font arriving late would leave stale pixels on the
// canvas. Everything is therefore loaded up front (240KB for the set, off
// localhost) and the app repaints once when they are ready.

export const FONTS = [
  // Headline — the Impact family of jobs.
  { id: 'anton', name: 'Anton', file: 'anton.woff2', cat: 'Headline' },
  { id: 'archivo-black', name: 'Archivo Black', file: 'archivo-black.woff2', cat: 'Headline' },
  { id: 'bebas-neue', name: 'Bebas Neue', file: 'bebas-neue.woff2', cat: 'Headline' },
  { id: 'oswald', name: 'Oswald', file: 'oswald.woff2', cat: 'Headline' },
  { id: 'impact', name: 'Impact', system: 'Impact', cat: 'Headline' },

  // Fat and cartoon — the loud meme end.
  { id: 'titan-one', name: 'Titan One', file: 'titan-one.woff2', cat: 'Fat' },
  { id: 'lilita-one', name: 'Lilita One', file: 'lilita-one.woff2', cat: 'Fat' },
  { id: 'luckiest-guy', name: 'Luckiest Guy', file: 'luckiest-guy.woff2', cat: 'Fat' },
  { id: 'bangers', name: 'Bangers', file: 'bangers.woff2', cat: 'Fat' },
  { id: 'permanent-marker', name: 'Permanent Marker', file: 'permanent-marker.woff2', cat: 'Fat' },

  // Pixel and terminal.
  { id: 'press-start-2p', name: 'Press Start 2P', file: 'press-start-2p.woff2', cat: 'Pixel' },
  { id: 'vt323', name: 'VT323', file: 'vt323.woff2', cat: 'Pixel' },

  // Techno — the chart-and-ticker end.
  { id: 'orbitron', name: 'Orbitron', file: 'orbitron.woff2', cat: 'Techno' },
  { id: 'chakra-petch', name: 'Chakra Petch', file: 'chakra-petch.woff2', cat: 'Techno' },
  { id: 'rubik-mono-one', name: 'Rubik Mono One', file: 'rubik-mono-one.woff2', cat: 'Techno' },
  { id: 'space-mono', name: 'Space Mono', file: 'space-mono.woff2', cat: 'Techno' },
  { id: 'space-grotesk', name: 'Space Grotesk', file: 'space-grotesk.woff2', cat: 'Techno' },

  // Not offered in the picker: emoji stickers are text layers and need a family.
  { id: 'emoji', name: 'Emoji', system: 'Segoe UI Emoji', cat: null },
];

export const FONT_CATS = [...new Set(FONTS.map(f => f.cat))].filter(Boolean);
export const fontById = (id) => FONTS.find(f => f.id === id) || FONTS[0];

/** The CSS family string for a font id, with a sane fallback chain. */
export const familyOf = (id) => {
  const f = fontById(id);
  return `"${f.system || f.name}", Impact, "Arial Black", sans-serif`;
};

let ready = null;

/** Load every bundled face. Resolves to the number that loaded. */
export function loadFonts() {
  if (ready) return ready;
  const jobs = FONTS.filter(f => f.file).map(async (f) => {
    try {
      const face = new FontFace(f.name, `url(/forge/fonts/${f.file}) format("woff2")`);
      await face.load();
      document.fonts.add(face);
      f.loaded = true;
      return 1;
    } catch {
      f.loaded = false;
      return 0;
    }
  });
  ready = Promise.all(jobs).then(r => r.reduce((a, b) => a + b, 0));
  return ready;
}

// ---- text style presets -----------------------------------------------------
// A preset is a whole look for a text layer, so the common jobs are one click
// rather than eight controls.
export const TEXT_PRESETS = [
  {
    id: 'meme', name: 'Meme', sample: 'TOP TEXT',
    style: { font: 'impact', caps: true, color: '#ffffff', stroke: '#000000', strokeW: 14, tracking: 0, lineH: 1.05 },
    fx: { shadow: 0, glow: 0 },
  },
  {
    id: 'impact', name: 'Impact', sample: 'SEND IT',
    style: { font: 'anton', caps: true, color: '#ffffff', stroke: '#000000', strokeW: 10, tracking: 2, lineH: 1.0 },
    fx: { shadow: 20, shadowColor: '#000000', glow: 0 },
  },
  {
    id: 'ticker', name: 'Ticker', sample: '$MEME',
    style: { font: 'chakra-petch', caps: true, color: '#ffffff', stroke: '#000000', strokeW: 0, tracking: 14, lineH: 1.1 },
    fx: { shadow: 14, shadowColor: '#000000', glow: 0 },
  },
  {
    id: 'neon', name: 'Neon', sample: 'PUMP',
    style: { font: 'orbitron', caps: true, color: '#ffffff', stroke: '#0a0a14', strokeW: 5, tracking: 6, lineH: 1.1 },
    fx: { shadow: 0, glow: 70, glowColor: '#14f195' },
  },
  {
    id: 'gold', name: 'Gold', sample: 'MOON',
    style: { font: 'archivo-black', caps: true, color: '#ffd21a', stroke: '#3a2400', strokeW: 12, tracking: 1, lineH: 1.05 },
    fx: { shadow: 26, shadowColor: '#2a1a00', glow: 26, glowColor: '#ff9d00' },
  },
  {
    id: 'cartoon', name: 'Cartoon', sample: 'WOW!',
    style: { font: 'luckiest-guy', caps: true, color: '#ffffff', stroke: '#1a1a1a', strokeW: 16, tracking: 1, lineH: 1.05 },
    fx: { shadow: 18, shadowColor: '#000000', glow: 0 },
  },
  {
    id: 'comic', name: 'Comic', sample: 'BOOM',
    style: { font: 'bangers', caps: true, color: '#ffe84a', stroke: '#1a1a1a', strokeW: 13, tracking: 2, lineH: 1.0 },
    fx: { shadow: 16, shadowColor: '#000000', glow: 0 },
  },
  {
    id: 'marker', name: 'Marker', sample: 'gm',
    style: { font: 'permanent-marker', caps: false, color: '#ffffff', stroke: '#000000', strokeW: 6, tracking: 0, lineH: 1.15 },
    fx: { shadow: 12, shadowColor: '#000000', glow: 0 },
  },
  {
    id: 'pixel', name: 'Pixel', sample: 'WAGMI',
    style: { font: 'press-start-2p', caps: true, color: '#9dffb0', stroke: '#001a05', strokeW: 7, tracking: 2, lineH: 1.4 },
    fx: { shadow: 0, glow: 30, glowColor: '#00ff41' },
  },
  {
    id: 'terminal', name: 'Terminal', sample: '> buy',
    style: { font: 'vt323', caps: false, color: '#00ff41', stroke: '#000000', strokeW: 0, tracking: 0, lineH: 1.1 },
    fx: { shadow: 0, glow: 40, glowColor: '#00ff41' },
  },
  {
    id: 'clean', name: 'Clean', sample: 'Launch',
    style: { font: 'space-grotesk', caps: false, color: '#ffffff', stroke: '#000000', strokeW: 0, tracking: 0, lineH: 1.2 },
    fx: { shadow: 16, shadowColor: '#000000', glow: 0 },
  },
  {
    id: 'outline', name: 'Outline', sample: 'EMPTY',
    style: { font: 'anton', caps: true, color: 'transparent', stroke: '#ffffff', strokeW: 7, tracking: 4, lineH: 1.05 },
    fx: { shadow: 20, shadowColor: '#000000', glow: 0 },
  },
];

export function applyTextPreset(layer, preset) {
  Object.assign(layer, preset.style);
  Object.assign(layer.fx, { shadow: 0, glow: 0, shadowColor: '#000000', glowColor: '#14f195' }, preset.fx);
  return layer;
}
