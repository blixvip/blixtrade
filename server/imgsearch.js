// Picture search for the Forge (forge/, the Create page's photo editor): its Find panel searches the web's images and
// Pinterest's pins from inside the editor and drops the picture picked straight onto the canvas. Google, Pinterest
// and ChatGPT all refuse to be shown inside another site (their pages forbid framing), so the editor asks here:
//   GET /api/img/search?q=&src=web|pinterest&page=N&bm=<pinterest bookmark>
//       → { src, q, items: [{ id, thumb, full, w, h, title, link }], next: { page, bm } | null }
//       web: Bing's image results (35 a page); pinterest: Pinterest's own pin search (25 a page, paged by bookmark).
//   GET /api/img/fetch?u=<picture address>  → the picture itself (png/jpg/gif/webp/avif, up to 8 MB), so the canvas can
//       use a picture from any site (a browser will not let a canvas read another site's picture directly).
//       Fetched through netguard (public addresses only, every redirect hop checked again).
// Answers are kept for 10 minutes per query and page, so paging back and forth costs nothing.
import { fetchPublic, safeToFetch } from "./netguard.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const KEEP_MS = 10 * 60_000, MAX_KEEP = 300, PIC_MAX = 8_000_000;
const TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const kept = new Map();   // key -> { t, v }
const fail = (status, message) => Object.assign(new Error(message), { status });
export const imgStats = { searches: 0, fetched: 0, failed: 0 };

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");

async function getText(url, headers = {}) {
  const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", ...headers }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw fail(502, `The picture search answered ${r.status}. Try again in a moment.`);
  return r.text();
}

async function web(q, page) {
  const html = await getText(`https://www.bing.com/images/async?q=${encodeURIComponent(q)}&first=${page * 35}&count=35&mmasync=1&adlt=moderate`);
  const items = [];
  for (const m of html.matchAll(/ m="([^"]+)"/g)) {
    let j; try { j = JSON.parse(unescape(m[1])); } catch { continue; }
    if (!j?.murl || !/^https?:/.test(j.murl)) continue;
    items.push({ id: j.md5 || j.murl, thumb: j.turl || j.murl, full: j.murl, w: null, h: null, title: j.t ? unescape(j.t).replace(/<[^>]+>/g, "") : null, link: j.purl || null });
  }
  return { items, next: items.length >= 20 ? { page: page + 1, bm: null } : null };
}

async function pinterest(q, bm) {
  const data = { options: { query: q, scope: "pins", page_size: 25, ...(bm ? { bookmarks: [bm] } : {}) }, context: {} };
  const url = `https://www.pinterest.com/resource/BaseSearchResource/get/?source_url=${encodeURIComponent(`/search/pins/?q=${encodeURIComponent(q)}`)}&data=${encodeURIComponent(JSON.stringify(data))}`;
  const text = await getText(url, { accept: "application/json", "x-requested-with": "XMLHttpRequest", "x-pinterest-pws-handler": "www/search/[scope].js" });
  let j; try { j = JSON.parse(text); } catch { throw fail(502, "Pinterest answered with something unreadable. Try again."); }
  const r = j?.resource_response, list = r?.data?.results || [];
  const items = [];
  for (const p of list) {
    const im = p?.images; if (!im) continue;
    const full = im.orig || im["736x"] || im["474x"], thumb = im["236x"] || im["474x"] || full;
    if (!full?.url) continue;
    items.push({ id: String(p.id || full.url), thumb: thumb.url, full: full.url, w: full.width || null, h: full.height || null, title: (p.grid_title || p.title || p.description || "").trim().slice(0, 120) || null, link: p.id ? `https://www.pinterest.com/pin/${p.id}/` : null });
  }
  const next = r?.bookmark || r?.data?.bookmark;
  return { items, next: next && next !== "-end-" && items.length ? { page: 0, bm: next } : null };
}

export async function imgSearch({ q, src, page, bm } = {}) {
  q = String(q || "").trim().slice(0, 120);
  if (!q) throw fail(400, "Type what to look for.");
  src = src === "pinterest" ? "pinterest" : "web";
  page = Math.max(0, Math.min(20, Number(page) || 0));
  bm = bm ? String(bm).slice(0, 4000) : null;
  const key = `${src}|${q.toLowerCase()}|${page}|${bm || ""}`;
  const hit = kept.get(key);
  if (hit && Date.now() - hit.t < KEEP_MS) return hit.v;
  imgStats.searches++;
  const got = src === "pinterest" ? await pinterest(q, bm) : await web(q, page);
  const v = { src, q, ...got };
  kept.set(key, { t: Date.now(), v });
  if (kept.size > MAX_KEEP) kept.delete(kept.keys().next().value);
  return v;
}

// The picture at `u`, following up to 4 redirects (each hop checked to be public).
export async function imgFetch(u) {
  let url = String(u || "");
  for (let hop = 0; hop < 5; hop++) {
    const safe = await safeToFetch(url);
    if (!safe) throw fail(400, "That picture's address is not one that can be fetched.");
    let r;
    try { r = await fetchPublic(safe, { maxBytes: PIC_MAX, timeout: 12_000, headers: { "user-agent": UA, accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5", referer: new URL(safe).origin + "/" } }); }
    catch (e) { imgStats.failed++; throw fail(502, /large/i.test(e.message) ? "That picture is over 8 MB." : "That picture could not be fetched."); }
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.get("location")) { url = new URL(r.headers.get("location"), safe).href; continue; }
    if (!r.ok) { imgStats.failed++; throw fail(502, `That picture's site answered ${r.status}.`); }
    const type = String(r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!TYPES.has(type)) { imgStats.failed++; throw fail(415, "That address is not a picture."); }
    imgStats.fetched++;
    return { type, body: Buffer.from(await r.arrayBuffer()) };
  }
  throw fail(502, "That picture's address redirects too many times.");
}
