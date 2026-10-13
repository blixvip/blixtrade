// The Find panel and the Forge's picture drops. Find searches the web's images and Pinterest's pins from inside the
// editor (server/imgsearch.js: GET /api/img/search) and opens ChatGPT in a window beside it for making a picture;
// a result is dragged onto the canvas (lands where it is dropped), clicked to add as a layer, or set as the backdrop.
// Google, Pinterest and ChatGPT will not be shown inside another site (their pages forbid framing), so this is the
// in-editor way to them; their own sites still work in another window and anything dragged or pasted from them lands.
//
// pictureFromDrop(dataTransfer) and pictureFromText(text) turn whatever was dropped or pasted into a picture Blob:
// files, a picture dragged from another tab or window (Google Images, Pinterest, ChatGPT: they carry its address or
// an <img> in HTML), a data: address, or a pasted picture address. Pictures on other sites come through
// GET /api/img/fetch (a canvas may not read another site's picture directly).

const API = '/api/img';
export const FORGE_DRAG = 'application/x-forge-pic';

const st = { src: 'web', q: '', items: [], next: null, loading: false, error: null, asked: '' };
const RECENT_KEY = 'forge:find:recent';
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const remember = (q) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recent().filter(x => x !== q)].slice(0, 8))); } catch { /* storage off */ } };

// A picture's address as a Blob: data: addresses are read here, anything else through the server.
export async function blobFromUrl(url) {
  if (/^data:image\//i.test(url)) return (await fetch(url)).blob();
  if (/^blob:/i.test(url)) return (await fetch(url)).blob();
  const r = await fetch(`${API}/fetch?u=${encodeURIComponent(url)}`, { credentials: 'include' });
  if (!r.ok) { let m = `Could not get that picture (${r.status})`; try { m = (await r.json()).error || m; } catch { /* not json */ } throw new Error(m); }
  return r.blob();
}

const looksLikePic = (u) => /^(https?:|data:image\/|blob:)/i.test(u);
// The picture address a drag from another page carries: our own results first, then an <img> in the HTML (Google
// Images and Pinterest drags carry the page link in the uri-list but the picture in the HTML), then the uri-list.
function urlFromDrag(dt) {
  const own = dt.getData(FORGE_DRAG);
  if (own) { try { const j = JSON.parse(own); return { url: j.full, alt: j.thumb, name: j.title }; } catch { /* fall through */ } }
  const html = dt.getData('text/html');
  if (html) {
    const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
    if (m && looksLikePic(m[1])) return { url: m[1].replace(/&amp;/g, '&'), alt: null, name: null };
  }
  const list = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  // A Google Images result link wraps the picture address in imgurl=.
  for (const u of list) {
    try { const g = new URL(u).searchParams.get('imgurl'); if (g) return { url: g, alt: null, name: null }; } catch { /* not a url */ }
  }
  const u = list.find(looksLikePic);
  return u ? { url: u, alt: null, name: null } : null;
}

// Every picture in a drop, as [{ blob, name }] (files first; else the one picture a page drag carries).
export async function picturesFromDrop(dt) {
  const files = [...(dt?.files || [])].filter(f => f.type.startsWith('image/'));
  if (files.length) return files.map(f => ({ blob: f, name: f.name.replace(/\.[^.]+$/, '').slice(0, 18) || 'Photo' }));
  const hit = dt && urlFromDrag(dt);
  if (!hit) return [];
  try { return [{ blob: await blobFromUrl(hit.url), name: (hit.name || 'Dropped').slice(0, 18) }]; }
  catch (e) { if (hit.alt) return [{ blob: await blobFromUrl(hit.alt), name: (hit.name || 'Dropped').slice(0, 18) }]; throw e; }
}

// A pasted picture address (text) as a picture, else null.
export async function pictureFromText(text) {
  const t = String(text || '').trim();
  if (!/^(https?:\/\/\S+|data:image\/\S+)$/i.test(t)) return null;
  return blobFromUrl(t);
}

// The drag carries something that could be a picture (files, or a link/HTML from another page).
export const dragHasPicture = (dt) => !!dt && [...(dt.types || [])].some(t => t === 'Files' || t === FORGE_DRAG || t === 'text/uri-list' || t === 'text/html');

async function search(more = false, rerender) {
  const q = st.q.trim();
  if (!q) return;
  if (!more) { st.items = []; st.next = null; st.asked = `${st.src}|${q}`; remember(q); }
  st.loading = true; st.error = null; rerender();
  const asked = st.asked;
  try {
    const p = new URLSearchParams({ q, src: st.src });
    if (more && st.next) { if (st.next.bm) p.set('bm', st.next.bm); else p.set('page', String(st.next.page)); }
    const r = await fetch(`${API}/search?${p}`, { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (asked !== st.asked) return;   // a newer search took over
    if (!r.ok) throw new Error(j.error || `Search failed (${r.status})`);
    const seen = new Set(st.items.map(x => x.full));
    st.items.push(...(j.items || []).filter(x => !seen.has(x.full)));
    st.next = j.next || null;
  } catch (e) { if (asked === st.asked) st.error = e.message || 'Search failed'; }
  if (asked === st.asked) { st.loading = false; rerender(); }
}

// Opens ChatGPT in its own window beside this one (it will not open inside the editor), with the prompt typed in.
function openChatGPT(prompt) {
  const w = Math.min(760, Math.round(screen.availWidth * 0.42)), h = Math.round(screen.availHeight * 0.92);
  const left = Math.max(0, screen.availWidth - w), top = Math.round((screen.availHeight - h) / 2);
  const url = prompt ? `https://chatgpt.com/?q=${encodeURIComponent(prompt)}&hints=create` : 'https://chatgpt.com/';
  window.open(url, 'blix-chatgpt', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
}
function openSite(kind, q) {
  const w = Math.min(980, Math.round(screen.availWidth * 0.5)), h = Math.round(screen.availHeight * 0.92);
  const url = kind === 'pinterest' ? `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}` : `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
  window.open(url, `blix-${kind}`, `popup=yes,width=${w},height=${h},left=${Math.max(0, screen.availWidth - w)},top=20`);
}

// The panel. `h` = { el, sec, add(blob, name), backdrop(blob), toast, rerender }.
export function findPanel(h) {
  const { el, sec } = h;
  const rerender = () => h.rerender();
  const tabs = el('div', { class: 'findtabs', role: 'tablist' },
    ...[['web', 'Images'], ['pinterest', 'Pinterest'], ['chatgpt', 'ChatGPT']].map(([k, label]) =>
      el('button', { class: 'chip', role: 'tab', 'aria-pressed': st.src === k, onclick: () => { if (st.src === k) return; st.src = k; if (k !== 'chatgpt' && st.q) search(false, rerender); else rerender(); } }, label)));

  if (st.src === 'chatgpt') {
    const ta = el('textarea', { class: 'findprompt', rows: '4', placeholder: 'Describe the picture: "a smug frog in a gold chain, sticker style, plain background"' });
    ta.value = st.q;
    ta.addEventListener('input', () => { st.q = ta.value; });
    return [sec('Find', tabs),
      sec('Make it with ChatGPT', ta,
        el('button', { class: 'btn pri wide', style: 'margin-top:8px', onclick: () => openChatGPT(ta.value.trim()) }, 'Open ChatGPT beside the editor'),
        el('div', { class: 'hint', style: 'margin-top:9px' },
          'ChatGPT opens in its own window (it will not open inside another site). When the picture is made, drag it from that window onto the canvas, or right-click it, Copy image, and press Ctrl+V here. The background comes off by itself.'))];
  }

  const input = el('input', { class: 'findq', type: 'search', placeholder: st.src === 'pinterest' ? 'Search Pinterest' : 'Search images', value: st.q, autocomplete: 'off' });
  input.addEventListener('input', () => { st.q = input.value; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(false, rerender); } });
  const go = el('button', { class: 'btn pri', onclick: () => search(false, rerender) }, 'Search');
  const bar = el('div', { class: 'findbar' }, input, go);
  const rec = recent();
  const recentRow = !st.items.length && rec.length ? el('div', { class: 'findrecent' }, ...rec.map(r => el('button', { class: 'chip', onclick: () => { st.q = r; search(false, rerender); } }, r))) : null;

  const grid = el('div', { class: 'findgrid' }, ...st.items.map(it => {
    // Through the server: the editor runs cross-origin isolated (its cut-out model needs it), which stops pictures
    // from sites that do not opt in (Pinterest's, most of the web's) from showing.
    const via = (u) => `${API}/fetch?u=${encodeURIComponent(u)}`;
    const img = el('img', { src: via(it.thumb), alt: it.title || '', loading: 'lazy', decoding: 'async', draggable: 'true' });
    let tried = false;
    img.addEventListener('error', () => { if (!tried && it.full !== it.thumb) { tried = true; img.src = via(it.full); } else cell.remove(); });
    img.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(FORGE_DRAG, JSON.stringify({ full: it.full, thumb: it.thumb, title: it.title }));
      e.dataTransfer.setData('text/uri-list', it.full);
    });
    const use = async (as) => {
      h.toast(as === 'bg' ? 'Setting the backdrop…' : 'Adding the picture…');
      try { const blob = await blobFromUrl(it.full).catch(() => blobFromUrl(it.thumb)); as === 'bg' ? h.backdrop(blob) : h.add(blob, (it.title || 'Found').slice(0, 18)); }
      catch (e) { h.toast(e.message || 'Could not get that picture', true); }
    };
    const cell = el('div', { class: 'findcell', title: `${it.title || ''}\nClick to add · drag onto the canvas`.trim() }, img,
      el('div', { class: 'findacts' },
        el('button', { class: 'findact', title: 'Add as a layer', onclick: (e) => { e.stopPropagation(); use('layer'); } }, '+ Layer'),
        el('button', { class: 'findact', title: 'Use as the backdrop', onclick: (e) => { e.stopPropagation(); use('bg'); } }, 'Backdrop')));
    cell.addEventListener('click', () => use('layer'));
    return cell;
  }));

  const foot = st.loading ? el('div', { class: 'hint', style: 'margin-top:8px' }, 'Searching…')
    : st.error ? el('div', { class: 'hint err', style: 'margin-top:8px' }, st.error)
    : st.next ? el('button', { class: 'btn wide', style: 'margin-top:8px', onclick: () => search(true, rerender) }, 'More')
    : st.items.length ? el('div', { class: 'hint', style: 'margin-top:8px' }, 'That is all of them.') : null;

  const open = st.q ? el('button', { class: 'linkbtn', onclick: () => openSite(st.src === 'pinterest' ? 'pinterest' : 'google', st.q) }, st.src === 'pinterest' ? 'Open this search on Pinterest ↗' : 'Open this search on Google Images ↗') : null;

  setTimeout(() => { if (!st.items.length) input.focus(); }, 0);
  return [sec('Find', tabs, bar, recentRow),
    sec(null, st.items.length ? grid : (!st.loading && !st.error ? el('div', { class: 'hint' }, st.q ? 'Press Enter to search.' : 'Search for anything: a meme, a character, a background. Drag a picture onto the canvas, or click it to add it as a layer.') : null), foot,
      el('div', { class: 'hint', style: 'margin-top:10px' }, 'You can also drag pictures straight from Google, Pinterest or ChatGPT in another window onto the canvas.'), open)];
}
