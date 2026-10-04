// Blix (Blix Trade) dashboard.
import { mountChart, mountPanel } from "./trade.js";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let lastApiOk = 0;
const api = (p, opt) => fetch(`/api/${p}`, { signal: AbortSignal.timeout(opt?.method ? 120_000 : 20_000), ...opt }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error || r.status); lastApiOk = Date.now(); return b; });
const post = (p, body) => api(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });

// ---------- formatting ----------
const money = (n) => n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`;
const pct = (n) => n == null ? "—" : `${n > 0 ? "+" : ""}${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(Math.abs(n) < 10 ? 1 : 0)}%`;
const cls = (n) => n > 0 ? "up" : n < 0 ? "down" : "dim";
const mult = (x) => x == null ? "—" : `${x.toFixed(x < 10 ? 2 : 1)}x`;
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return `${Math.max(1, Math.floor(s))}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function price(p) {
  if (!p) return "—";
  if (p >= 1) return `$${p.toFixed(3)}`;
  const s = p.toFixed(12);
  const m = s.match(/^0\.(0+)(\d{3})/);
  return m && m[1].length >= 4 ? `$0.0<sub>${m[1].length}</sub>${m[2]}` : `$${p.toPrecision(3)}`;
}
const KIND = {
  launch: ["New launch", "var(--up)"], graduated: ["Graduated", "var(--violet)"], momentum: ["Momentum", "var(--warn)"],
  volume: ["Volume spike", "var(--info)"], dump: ["Dump warning", "var(--down)"], milestone: ["Milestone", "var(--color-up)"],
  wallet: ["Wallet buy", "var(--color-accent)"], smart: ["Followed wallets", "var(--color-warn)"], fomo: ["Fomo crowd", "var(--color-caution)"], research: ["AI research", "var(--color-accent)"], buy: ["Buy call", "var(--color-up)"], pick: ["AI pick", "var(--color-up)"], "dev-sold": ["Dev sold", "var(--down)"],
  rugged: ["RugCheck: rugged", "var(--down)"], "liq-pulled": ["Liquidity pulled", "var(--down)"],
};
// Links come from coin creators and AI answers: only plain web links are ever put in an href.
const safeHref = (u) => { try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : "#"; } catch { return "#"; } };
const extLink = (u, inner, cls = "linkish") => safeHref(u) === "#" ? "" : `<a class="${cls}" href="${esc(safeHref(u))}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`;
// Which AI wrote something, from the model name stored with it (never assumed).
const providerOf = (m) => /^grok/i.test(m || "") ? "Grok" : /haiku/i.test(m || "") ? "Claude Haiku" : /^claude/i.test(m || "") ? "Claude" : m ? "Groq" : "AI";
const mins = (ms) => ms == null ? "—" : ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < 5400_000 ? `${Math.round(ms / 60_000)}m` : ms < 172800_000 ? `${Math.round(ms / 3600_000)}h` : `${Math.round(ms / 86400_000)}d`;
const frac = (n, d) => d ? `${n}/${d}` : "—";
const share = (n, d) => d ? `${Math.round((n / d) * 100)}%` : "—";
// The honest state of a coin's price: dead, unsellable, or simply old.
function stateTags(f, { compact = false } = {}) {
  if (!f) return "";
  const out = [];
  if (f.dead) out.push(`<span class="st dead" title="No real trading left. Blix stopped following it; its price is the last one seen.">dead</span>`);
  if (f.quarantine || f.illiquid) out.push(`<span class="st bad" title="${esc(f.exitWhy || f.quarantine || "")}. The quoted price cannot actually be traded at.">${compact ? "unsellable" : "can't be sold"}</span>`);
  else if (f.stale && !f.dead && f.ageMs != null) out.push(`<span class="st old" title="Price last read ${mins(f.ageMs)} ago">price ${mins(f.ageMs)} old</span>`);
  return out.join("");
}
const kindOf = (k) => KIND[k.startsWith("mcap-") ? "milestone" : k.startsWith("wallet:") ? "wallet" : k] || [k, "var(--muted)"];
const shortAddr = (a) => a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "";
// Opens the coin in Fomo (the app on your phone, fomo.family on desktop).
const fomoUrl = (mint) => `https://fomo.family/tokens/solana/${mint}`;
const fomoBtn = (mint, big = false) => `<a class="btn ${big ? "fomo" : "fomo sm"}" href="${fomoUrl(mint)}" target="_blank" rel="noreferrer">${big ? "Buy on Fomo" : "Fomo"}</a>`;
const usd = (n) => n == null ? "—" : Math.abs(n) < 0.5 ? "$0" : `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;

// ---------- avatars ----------
function hash(str) { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
const PALETTES = [
  ["#0f2a1c", "#39ff88", "#0ea5e9"], ["#2a0f1a", "#ff3d6e", "#ffd166"], ["#101a2e", "#5cc8ff", "#b98cff"],
  ["#2a1a0a", "#ff8a3d", "#facc15"], ["#0a2426", "#2dd4bf", "#f472b6"], ["#15112e", "#818cf8", "#22d3ee"],
  ["#261010", "#ff4d6d", "#5cc8ff"], ["#122a12", "#a3e635", "#38bdf8"],
];
// A soft "marble" gradient from any seed (mint or wallet), with optional initials.
function genAvatar(seed, text = "") {
  const h = hash(seed), p = PALETTES[h % PALETTES.length];
  const x1 = 14 + (h >> 4) % 36, y1 = 14 + (h >> 9) % 36, x2 = 14 + (h >> 14) % 36, y2 = 14 + (h >> 19) % 36;
  const ang = (h >> 22) % 360;
  // Bright two-color base with blurred blobs on top, so every avatar reads clearly on the dark UI.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><filter id="b"><feGaussianBlur stdDeviation="8"/></filter>
<linearGradient id="g" gradientTransform="rotate(${ang} .5 .5)"><stop offset="0" stop-color="${p[1]}"/><stop offset="1" stop-color="${p[2]}"/></linearGradient></defs>
<rect width="64" height="64" fill="url(#g)"/><g filter="url(#b)"><circle cx="${x1}" cy="${y1}" r="18" fill="${p[2]}"/><circle cx="${x2}" cy="${y2}" r="14" fill="${p[0]}" fill-opacity=".55"/></g>
${text ? `<text x="32" y="38" text-anchor="middle" font-family="Space Grotesk,Segoe UI,sans-serif" font-weight="700" font-size="${text.length > 2 ? 16 : 20}" fill="#fff" fill-opacity=".95">${text.replace(/[<&>"]/g, "")}</text>` : ""}</svg>`;
  try { return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`; }
  catch { return genAvatar(seed); } // odd characters in a ticker: drop the text rather than break the page
}
// First few characters of a ticker, counted by whole characters so emoji tickers don't get split in half.
const initials = (s, n = 3) => Array.from(String(s || "?").replace(/^\$/, "")).slice(0, n).join("").toUpperCase();
// Try each source in turn (data-alt is a "|"-separated list), then the generated avatar.
// The lists re-draw every couple of seconds. Without a memory, a coin whose first picture source fails
// would start again from that source on every re-draw and never get to the one that works (an empty box).
// So: remember which address worked for each coin, and which addresses are dead.
const imgGood = new Map(), imgBad = new Set();
// Coin pictures come from Blix itself (/img/<mint>), which fetches them from wherever they live.
// A coin a few seconds old may not have one yet: the generated picture stands in and the real one is
// asked for again a few times.
const picTries = new Map();   // mint -> { n, t }
const picHave = new Set();    // mints whose picture has loaded once (so re-draws go straight to it)
document.addEventListener("load", (e) => {
  const i = e.target;
  if (i?.tagName !== "IMG" || i.src.startsWith("data:") || !(i.naturalWidth > 1)) return;
  if (i.dataset.pic) { picHave.add(i.dataset.pic); picTries.delete(i.dataset.pic); i.classList.remove("gen"); i.style.backgroundImage = "none"; }
  else if (i.dataset.mint) imgGood.set(i.dataset.mint, i.src);
}, true);
setInterval(() => {
  for (const img of document.querySelectorAll("img.av[data-pic].gen")) {
    const m = img.dataset.pic, tr = picTries.get(m);
    if (!tr || tr.n > 7 || Date.now() - tr.t < 2000 * 2 ** (tr.n - 1)) continue;
    const probe = new Image();
    probe.onload = () => { picHave.add(m); picTries.delete(m); for (const el of document.querySelectorAll(`img.av[data-pic="${m}"]`)) { el.src = probe.src; el.classList.remove("gen"); } };
    probe.onerror = () => picTries.set(m, { n: tr.n + 1, t: Date.now() });
    picTries.set(m, { n: tr.n, t: Date.now() + 60_000 });   // not again while this one is in flight
    probe.src = `/img/${m}?r=${tr.n}`;
  }
}, 2000);
// Blix says a coin's picture just arrived: swap it in everywhere that coin is on screen.
function applyPic(mint) {
  picHave.add(mint); picTries.delete(mint);
  for (const el of document.querySelectorAll(`img.av[data-pic="${CSS.escape(mint)}"]`)) if (el.classList.contains("gen") || !(el.naturalWidth > 1)) { el.classList.remove("gen"); el.src = `/img/${mint}?p=1`; }
}
window.avFail = (img) => {
  if (img.dataset.pic) {
    if (img.classList.contains("gen")) return;
    if (!picTries.has(img.dataset.pic)) picTries.set(img.dataset.pic, { n: 1, t: Date.now() });
    img.classList.add("gen"); img.src = img.dataset.fb;
    return;
  }
  if (img.src && !img.src.startsWith("data:")) { imgBad.add(img.src); if (imgBad.size > 4000) imgBad.clear(); }
  const alts = (img.dataset.alt || "").split("|").filter(Boolean);
  if (alts.length) { img.dataset.alt = alts.slice(1).join("|"); img.src = alts[0]; return; }
  const fb = img.dataset.fb; if (fb && img.src !== fb) { img.dataset.fb = ""; img.src = fb; img.classList.add("gen"); }
  else if (img.dataset.drop != null) img.remove();
};
// One listener for every broken picture (the page allows no inline script, so no onerror attributes).
document.addEventListener("error", (e) => { if (e.target?.tagName === "IMG") window.avFail(e.target); }, true);
document.addEventListener("submit", (e) => e.preventDefault());


// Coin logo: pump.fun's image CDN for pump coins (fast, small), then the coin's own image (Blix fills
// these in from launch metadata and GeckoTerminal), then a generated one with the ticker.
function av(t, size = "") {
  const fb = genAvatar(t.mint || t.symbol || "?", initials(t.symbol));
  if (t.mint && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t.mint)) {
    // Known to be missing for now: show the generated one straight away, the retry loop swaps it in.
    const wait = picTries.has(t.mint) && !picHave.has(t.mint);
    // The generated picture sits behind the real one, so a box is never empty while a picture loads.
    return `<img class="av ${size} ${wait ? "gen" : ""}" src="${wait ? fb : `/img/${t.mint}`}" data-pic="${t.mint}" data-mint="${t.mint}" data-fb="${fb}" style="background-image:url('${fb}')" alt="" loading="lazy" decoding="async">`;
  }
  const list = [];
  if (t.mint && /pump$/.test(t.mint)) list.push(`https://images.pump.fun/coin-image/${t.mint}?variant=${size === "xl" || size === "lg" ? "200x200" : "86x86"}`);
  if (t.image && !/mypinata\.cloud/.test(t.image)) list.push(t.image);
  else if (t.image) { list.push(t.image.replace("pump.mypinata.cloud", "gateway.pinata.cloud")); list.push(t.image.replace("pump.mypinata.cloud", "4everland.io")); }
  const known = t.mint && imgGood.get(t.mint);
  const order = [...new Set([...(known ? [known] : []), ...list])].filter((u) => !imgBad.has(u));
  const [src, ...alts] = order.length ? order : [fb];
  return `<img class="av ${size} ${order.length ? "" : "gen"}" src="${esc(src)}" data-mint="${esc(t.mint || "")}" data-alt="${esc(alts.join("|"))}" data-fb="${order.length ? fb : ""}" alt="" loading="lazy">`;
}

// Wallet avatar: the trader's Fomo profile picture when we know their handle, else a generated one.
const FOMO_CARD = (h) => `https://image-renderer.fomo.cloud/og/profile/${encodeURIComponent(h)}/card.png`;
function wav(address, w = {}, size = "") {
  const handle = w.handle || (w.label?.startsWith("@") ? w.label.slice(1) : null);
  const gen = genAvatar(address || "?");
  const badge = handle || w.source === "fomo" || w.fomo ? `<i class="badge fomo" title="Trades on Fomo">f</i>`
    : w.source === "smart" ? `<i class="badge smart" title="Smart money">★</i>` : "";
  const img = handle
    ? `<img class="crop" src="${FOMO_CARD(handle)}" data-fb="${gen}" alt="" loading="lazy">`
    : `<img class="gen" src="${gen}" alt="">`;
  return `<span class="wav ${size}"><span class="pfp">${img}</span>${badge}</span>`;
}
const walletName = (address, w = {}) => w.handle ? `@${w.handle}` : w.label || `${address.slice(0, 4)}…${address.slice(-4)}`;

// Tiny inline price chart.
function spark(points, w = 84, h = 26) {
  if (!points || points.length < 2) return `<span class="spark-empty"></span>`;
  const lo = Math.min(...points), hi = Math.max(...points);
  const d = points.map((v, i) => `${i ? "L" : "M"}${(i / (points.length - 1) * w).toFixed(1)},${(h - 3 - (v - lo) / Math.max(hi - lo, 1e-18) * (h - 6)).toFixed(1)}`).join("");
  const up = points[points.length - 1] >= points[0];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
const SOCIAL = {
  twitter: ['X', '<path d="M4 4l16 16M20 4L4 20"/>'],
  telegram: ["Telegram", '<path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/>'],
  website: ["Website", '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>'],
  discord: ["Discord", '<path d="M7 7c3-1 7-1 10 0l2 9c-2 2-4 2-5 1l-1-2h-2l-1 2c-1 1-3 1-5-1z"/>'],
};
function linkBtn(l) {
  const href = safeHref(l.url);
  if (href === "#") return "";
  const [label, icon] = SOCIAL[l.type] || [l.type, SOCIAL.website[1]];
  // Anything that is not a known social site was chosen by the coin's creator: open only after a warning.
  const site = !SOCIAL[l.type] || l.type === "website";
  return `<a class="btn icon-btn ${site ? "untrusted" : ""}" href="${esc(href)}" target="_blank" rel="noopener noreferrer nofollow" title="${site ? `Unverified site set by the coin's creator: ${esc(new URL(href).hostname)}` : esc(new URL(href).hostname)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${esc(label)}${site ? ' <em class="unv">unverified</em>' : ""}</a>`;
}
function safetyChip(n) {
  if (n == null) return '<span class="pill">Safety unchecked</span>';
  return `<span class="pill safe-pill ${n >= 70 ? "ok" : n >= 45 ? "mid" : "bad"}">Safety ${n}</span>`;
}
function safety(n) {
  if (n == null) return `<span class="safe na">—</span>`;
  return `<span class="safe ${n >= 70 ? "ok" : n >= 45 ? "mid" : "bad"}">${n}</span>`;
}
const scoreBar = (s) => `<span class="score"><span class="bar"><i style="width:${s || 0}%"></i></span>${s ?? 0}</span>`;
const empty = (t, s) => `<div class="empty"><b>${esc(t)}</b>${esc(s)}</div>`;

let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2400); }

// ---------- markdown (briefs) ----------
function md(src) {
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\$([A-Za-z0-9]{2,12})\b/g, '$1<span class="tk">$$$2</span>');
  let out = "", list = false;
  for (const raw of src.split(/\r?\n/)) {
    const l = raw.trim();
    const li = l.match(/^[-*•]\s+(.*)/);
    if (li) { if (!list) { out += "<ul>"; list = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { out += "</ul>"; list = false; }
    const h = l.match(/^#{1,3}\s+(.*)/);
    if (h) out += `<h2>${inline(h[1])}</h2>`;
    else if (l) out += `<p>${inline(l)}</p>`;
  }
  return out + (list ? "</ul>" : "");
}

// ---------- ticker tape ----------
let tapeKey = "";
function renderTape(list) {
  const items = (list || []).filter((t) => t.symbol);
  const key = items.map((t) => t.mint + Math.round(t.chg_h1 || 0)).join();
  if (!items.length || key === tapeKey) return;
  tapeKey = key;
  const one = items.map((t) => `<button class="tape-item" data-mint="${esc(t.mint)}">${av(t, "xs")}<b>$${esc(t.symbol)}</b><span class="num">${money(t.mcap)}</span><span class="num ${cls(t.chg_h1)}">${pct(t.chg_h1)}</span></button>`).join("");
  // Two copies side by side make the scroll loop seamless.
  $("#tape").innerHTML = `<div class="tape-track">${one}${one}</div>`;
}

// ---------- stat strip ----------
let overviewData = null;
function renderStrip(o) {
  renderTape(o.top);
  const s = o.stats, c = o.counts;
  const up = s.launchDataMin ?? 0;
  const cells = [
    ["Launches / hr", s.launchesLastHour.toLocaleString(), up < 60 ? `${up}m of data` : "pump.fun live"],
    ["Tracking", c.tracked.toLocaleString(), `${s.nursery} waiting`],
    ["Pass safety", c.safe.toLocaleString(), `of ${c.tracked}`],
    ["Signals 24h", c.signals24h.toLocaleString(), c.unscreened24h ? `+${c.unscreened24h} unscreened, kept apart` : `${s.signals} this session`],
    ["Graduations", c.graduated24h.toLocaleString(), "last 24h"],
    ["Health", o.health.issues ? `${o.health.issues} issue${o.health.issues > 1 ? "s" : ""}` : "All good", o.health.issues ? o.health.summary.slice(0, 2).join(", ") : s.lastCycle ? `scanned ${ago(s.lastCycle)} ago` : "starting", "#/health", o.health.worst],
  ];
  $("#strip").innerHTML = cells.map(([b, v, sm, href, state]) => `<${href ? `a href="${href}"` : "div"} class="stat ${state ? `hs-${state}` : ""}"><b>${b}</b><span>${v}</span><small>${esc(sm)}</small></${href ? "a" : "div"}>`).join("");
  healthState = o.health;
}
let healthState = null;

// ---------- views ----------
// Small glyphs for each alert type, shown as a badge on the coin's avatar.
const KIND_ICON = {
  launch: '<path d="M12 3c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10z"/><path d="M9 16l-2 4 3-1M15 16l2 4-3-1"/>',
  graduated: '<path d="M3 9l9-5 9 5-9 5z"/><path d="M7 11v5c3 2 7 2 10 0v-5"/>',
  momentum: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  volume: '<path d="M5 20V10M10 20V4M15 20v-7M20 20v-4"/>',
  milestone: '<path d="M5 21V4h12l-2 4 2 4H5"/>',
  dump: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M16 12h2"/>',
  smart: '<path d="M12 3l2.6 5.6 6 .7-4.5 4 1.2 6L12 16.4 6.7 19.3l1.2-6-4.5-4 6-.7z"/>',
  "dev-sold": '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  rugged: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2 18a2 2 0 001.7 3h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  fomo: '<path d="M8 20c-2-3-1-6 2-8-1 3 1 4 2 4 0-4 2-7 5-9-1 3 2 6 1 9-1 3-4 4-6 4"/>',
};
const kindKey = (k) => k.startsWith("mcap-") ? "milestone" : k.startsWith("wallet:") ? "wallet" : k;
const kindGlyph = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${KIND_ICON[kindKey(k)] || ""}</svg>`;
KIND_ICON["liq-pulled"] = KIND_ICON.rugged;
const BAD = new Set(["dump", "dev-sold", "rugged", "liq-pulled"]);

// `more`: earlier alerts on the same coin folded under this one (the feed groups by coin).
function sigRow(s, isNew = false, more = 0) {
  const [label, color] = kindOf(s.kind);
  const raw = s.safe === 0;
  // What the coin is worth now if you could still sell it; 0 when the pool is gone.
  const since = s.since ?? (s.price_now && s.price ? s.price_now / s.price : null);
  const state = stateTags({ dead: s.dead, quarantine: s.quarantine, illiquid: s.exitable === false && !s.dead, exitWhy: s.exit_why, stale: s.price_age > 6 * 60_000, ageMs: s.price_age }, { compact: true });
  return `<div class="sig ${isNew ? "new" : ""} ${raw ? "raw" : ""}" style="--k:${raw ? "var(--muted)" : color}" data-mint="${esc(s.mint)}">
    <div class="av-wrap">${av({ mint: s.mint, symbol: s.symbol, image: s.image })}<i class="kind-badge">${kindGlyph(s.kind)}</i></div>
    <div style="min-width:0"><div class="sig-top"><span class="tag">${label}</span>${raw ? `<span class="st bad" title="${esc(s.why_unsafe || "")}">not safety-screened</span>` : ""}${state}<span class="dim">${ago(s.t)} ago</span>${more ? `<button class="more-pill" data-more="${esc(s.mint)}">+${more} more on this coin</button>` : ""}</div>
      <h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p></div>
    <div class="meta">${BAD.has(s.kind) || raw || s.exitable === false ? "" : fomoBtn(s.mint)}${since != null ? `<span class="${cls(since - 1)}" title="Price now vs. price at the alert. A price move, not a trade result.">${s.exitable === false ? "0x · unsellable" : `${mult(since)} since`}</span>` : ""}</div>
  </div>`;
}
// Newest alert per coin, with the count of earlier ones folded under it. Ten alerts on one coin are one story.
function feedRows(list, grouped) {
  if (!grouped) return list.map((s) => sigRow(s)).join("");
  const seen = new Map();
  for (const s of list) { const e = seen.get(s.mint); if (e) e.rest.push(s); else seen.set(s.mint, { lead: s, rest: [] }); }
  return [...seen.values()].map(({ lead, rest }) => sigRow(lead, false, rest.length) + (rest.length ? `<div class="sig-more" data-more-for="${esc(lead.mint)}" hidden>${rest.map((s) => sigRow(s)).join("")}</div>` : "")).join("");
}

// Same-name coins are different coins. Each row carries what tells them apart: short contract, launchpad,
// age, and whether it is the biggest of its ticker or one of several copies.
const DEX_NAME = { pumpfun: "pump.fun curve", pumpswap: "PumpSwap", raydium: "Raydium", meteora: "Meteora", meteoradbc: "Meteora curve", orca: "Orca", bags: "Bags curve" };
const idLine = (t) => { const i = protoInfo(t); return `<small class="idline"><span class="mono" title="${esc(t.mint)}">${shortAddr(t.mint)}</span>${i.launch ? ` · ${esc(i.full)}` : ""}${t.dex ? ` · ${esc(DEX_NAME[t.dex] || t.dex)}` : ""} · Solana</small>`; };
const dupTag = (t) => t.dupes > 1 ? `<span class="st ${t.dupTop ? "top" : "dup"}" title="${t.dupes} tracked coins share this ticker. ${t.dupTop ? "This is the largest by market cap." : "This is not the largest; check the contract."}">${t.dupTop ? `largest of ${t.dupes}` : `1 of ${t.dupes} copies`}</span>` : "";

function coinTable(list, { sort, dir = "desc", compact } = {}) {
  if (!list.length) return empty("No coins match", sort != null ? "Loosen a filter, or clear them all." : "Blix fills up over the first few minutes.");
  const th = (k, label, extra = "") => `<th class="${sort != null ? "sortable" : ""} ${sort === k ? "sorted" : ""} ${extra}" data-sort="${k}" ${sort != null ? `title="Sort by ${label.toLowerCase()}; click again to reverse"` : ""}>${label}${sort === k ? `<i class="arrow">${dir === "asc" ? "▲" : "▼"}</i>` : ""}</th>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Coin</th><th class="hide-sm">6h</th>${th("score", "Score")}${th("safety", "Safety")}${th("mcap", "Mcap")}${compact ? "" : th("liq", "Liquidity", "hide-sm")}${th("volume", "Vol 1h", "hide-sm")}${compact ? "" : th("tx", "TX 1h", "hide-sm")}${compact ? "" : th("holders", "Holders", "hide-sm")}${th("change", "1h")}${compact ? "" : th("chg24", "24h", "hide-sm")}${th("new", "Age", "hide-sm")}</tr></thead>
    <tbody>${list.map((t) => `<tr class="row" data-mint="${esc(t.mint)}">
      <td><div class="coin">${av(t, "sm")}<div><b>${esc(t.symbol)}</b>${t.graduated ? ' <span class="pill">grad</span>' : ""}${compact ? "" : dupTag(t)}${stateTags(t.fresh, { compact: true })}${(t.asset_class || "meme") !== "meme" ? `<span class="st old">${esc(t.asset_class)}</span>` : ""}<small>${esc(t.name)}</small>${compact ? "" : idLine(t)}</div></div></td>
      <td class="hide-sm">${spark(t.spark)}</td>
      <td>${scoreBar(t.score)}</td><td>${safety(t.safety_score)}</td><td>${money(t.mcap)}</td>
      ${compact ? "" : `<td class="hide-sm">${t.fresh?.onCurve ? '<span class="dim" title="Still on a bonding curve: the curve itself is the market">curve</span>' : money(t.liquidity)}</td>`}<td class="hide-sm">${money(t.vol_h1)}</td>
      ${compact ? "" : `<td class="hide-sm">${(t.buys_h1 || 0) + (t.sells_h1 || 0)}</td><td class="hide-sm">${t.safety?.totalHolders != null ? t.safety.totalHolders.toLocaleString() : "—"}</td>`}
      <td class="${cls(t.chg_h1)}">${pct(t.chg_h1)}</td>${compact ? "" : `<td class="hide-sm ${cls(t.chg_h24)}">${pct(t.chg_h24)}</td>`}
      <td class="dim hide-sm">${ago(t.pair_created || t.first_seen)}</td></tr>`).join("")}</tbody></table></div>`;
}

const stack = (coins, n = 4) => `<span class="avs">${coins.slice(0, n).map((c) => av(c, "xs")).join("")}</span>`;

function narMini(n) {
  return `<div class="nar-mini" data-theme="${esc(n.name)}">
    <div class="nar-mini-top"><b>${esc(n.name)}</b><span class="num heat-n">${n.heat}</span></div>
    <div class="heat"><i style="width:${n.heat}%"></i></div>
    <div class="nar-mini-foot">${n.top.length ? stack(n.top) : ""}<small>${(n.launchShare * 100).toFixed(1)}% of launches</small></div></div>`;
}

const sigState = { screen: "approved", grouped: true };
async function viewRadar(main) {
  const [o, nar, list] = await Promise.all([api("overview"), api("narratives"), sigState.screen === "approved" ? null : api(`signals?limit=120&screen=${sigState.screen}`)]);
  overviewData = o;
  renderStrip(o);
  const sigs = list || o.signals;
  const tabs = [["approved", "Passed safety"], ["unscreened", `Unscreened wallet activity${o.counts.unscreened24h ? ` (${o.counts.unscreened24h})` : ""}`], ["all", "Everything"]];
  const note = sigState.screen === "approved" ? "Every coin here passed the safety check when the alert fired. Warnings (dumps, dev sells, pulled liquidity) show for coins already alerted."
    : sigState.screen === "unscreened" ? "Buys by wallets you follow in coins that FAILED the safety check, or could not be checked. This is raw activity, not a recommendation: many of these coins are dead, concentrated or unsellable."
    : "Approved signals and unscreened wallet activity together. Unscreened rows are greyed and labelled.";
  main.innerHTML = `
  ${setupBanner(o.health)}
  <div class="radar-grid">
    <div class="card"><div class="card-head"><h2>Live signals</h2><label class="check small"><input type="checkbox" id="sgroup" ${sigState.grouped ? "checked" : ""}> Group by coin</label></div>
      <div class="chips pad">${tabs.map(([k, l]) => `<button class="chip ${sigState.screen === k ? "on" : ""}" data-screen="${k}">${l}</button>`).join("")}</div>
      <p class="note pad ${sigState.screen === "unscreened" ? "warn-note" : ""}">${note}</p>
      <div class="feed" id="feed" data-screen="${sigState.screen}">${sigs.length ? feedRows(sigs, sigState.grouped) : empty(sigState.screen === "unscreened" ? "Nothing unscreened" : "Listening…", sigState.screen === "unscreened" ? "No followed wallet has bought a coin that failed safety recently." : "Signals appear here as coins break out. The first ones usually land within 10–20 minutes.")}</div></div>
    <div class="stack">
      <div class="card"><div class="card-head"><h2>Top movers</h2><a class="note" href="#/coins">All coins →</a></div>${coinTable(o.top, { compact: true })}</div>
      <div class="card"><div class="card-head"><h2>Narratives right now</h2><a class="note" href="#/narratives">Details →</a></div>
        <div class="nar-strip">${nar.themes.slice(0, 8).map(narMini).join("") || empty("Warming up", "Needs a few minutes of launches.")}</div></div>
      <div class="card" id="briefCard">${briefCard(o.brief)}</div>
    </div>
  </div>`;
}

// Shown until alerts can reach you somewhere other than this open page.
function setupBanner(h) {
  if (!h || !h.summary.includes("Alert delivery")) return "";
  return `<div class="card lane-note" style="margin-bottom:14px"><b>Alerts only reach this page.</b> No Discord or Telegram destination is set up, so nothing is delivered when the page is closed or you are away from this PC. <a class="linkish" href="#/settings">Set one up in Settings</a> (about a minute).</div>`;
}
const partialNote = (b) => b && b.status === "partial" ? `<div class="warn-box"><b>Incomplete brief.</b> The AI stopped before finishing (${esc(b.stop || "cut off")}), twice. What it wrote is below; treat it as partial.</div>` : "";
function briefCard(b) {
  return `<div class="card-head"><h2>Latest AI brief</h2><div style="display:flex;gap:8px;align-items:center">${b ? `<small>${ago(b.t)} ago · ${esc(providerOf(b.model))}</small>` : ""}<button class="btn" data-brief>Write one now</button></div></div>
    ${partialNote(b)}<div class="brief md">${b ? md(b.body) : `<p class="note">A market brief is written every hour from what Blix sees. The first one arrives about 12 minutes after start, or press “Write one now”.</p>`}</div>`;
}

// ---------- numeric filters + saved presets (Coins and Pulse) ----------
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
// [key, label, unit, help]. "min…" keeps coins at or above the number, "max…" at or below.
const COIN_FILTERS = [
  ["minMcap", "Mcap ≥", "$"], ["maxMcap", "Mcap ≤", "$"], ["minLiq", "Liquidity ≥", "$"], ["maxLiq", "Liquidity ≤", "$"], ["minVol", "Vol 1h ≥", "$"], ["minTx", "Trades 1h ≥", ""],
  ["minAge", "Age ≥", "min"], ["maxAge", "Age ≤", "min"], ["minHolders", "Holders ≥", ""], ["maxTop10", "Top 10 hold ≤", "%"], ["maxDev", "Dev holds ≤", "%"], ["maxInsider", "Insiders ≤", "%"],
  ["minSafety", "Safety ≥", ""], ["minScore", "Score ≥", ""],
];
const fmtFilter = (v, unit) => unit === "$" ? money(+v) : `${(+v).toLocaleString()}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
const activeFilters = (fields, values) => fields.filter(([k]) => values[k] !== undefined && values[k] !== "" && values[k] != null);
// The always-visible line: how many filters are on, and each one as a chip you can remove.
function filterSummary(fields, values) {
  const active = activeFilters(fields, values);
  return `<b>Filters</b>${active.length ? `<span class="pill on">${active.length} active</span>` : `<span class="dim">none</span>`}
    <span class="factive">${active.map(([k, label, unit]) => `<button class="fchip" data-fclear="${k}" title="Remove this filter">${label} ${fmtFilter(values[k], unit)} ✕</button>`).join("")}</span>`;
}
function filterPanel(id, fields, values, presets, builtin = {}) {
  return `<details class="fpanel" id="${id}" ${store.get(`${id}:open`, false) ? "open" : ""}>
    <summary>${filterSummary(fields, values)}</summary>
    <div class="fgrid">${fields.map(([k, label, unit]) => `<label class="ffield"><span>${label}${unit ? ` <em>${unit}</em>` : ""}</span><input class="input num" type="number" min="0" step="any" data-f="${k}" value="${esc(values[k] ?? "")}" placeholder="any"></label>`).join("")}</div>
    <div class="fpresets"><span class="dim">Presets</span>${Object.keys(presets).map((n) => `<span class="preset"><button class="chip" data-preset="${esc(n)}">${esc(n)}</button>${n in builtin ? "" : `<button class="x" data-preset-del="${esc(n)}" title="Delete this preset">✕</button>`}</span>`).join("")}
      <button class="btn sm-btn" data-preset-save>Save current filters as a preset</button><button class="btn sm-btn" data-fclear="*">Clear all</button></div>
  </details>`;
}
// Every page with a filter panel registers here; the shared handlers below drive them all.
const PANELS = {};
function renderPanel(id) { const P = PANELS[id], h = $(P.host); if (h) h.innerHTML = filterPanel(id, P.fields, P.get(), P.presets(), P.builtin); }
function panelSet(id, values, rerender = true) {
  const P = PANELS[id];
  P.set(Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v != null)));
  if (rerender) renderPanel(id); else { const s = $(`#${id} > summary`); if (s) s.innerHTML = filterSummary(P.fields, P.get()); }
  P.apply();
}
document.addEventListener("toggle", (e) => { if (e.target.classList?.contains("fpanel")) store.set(`${e.target.id}:open`, e.target.open); }, true);
// Starter presets; yours are saved in this browser alongside them.
const COIN_PRESETS = { "Safer graduates": { minLiq: 20000, maxTop10: 30, maxDev: 5, minHolders: 200, minSafety: 70 }, "Fresh and moving": { maxAge: 120, minVol: 20000, minTx: 100 }, "Deep liquidity": { minLiq: 100000, minMcap: 500000 } };

const coinState = { sort: "score", dir: "desc", theme: "", q: "", grad: "", cls: "meme", unreliable: false, f: store.get("coins:f", {}), page: 0, per: 100, total: 0 };
PANELS.cf = { host: "#cfilters", fields: COIN_FILTERS, builtin: COIN_PRESETS, key: "coins:presets", get: () => coinState.f, set: (f) => { coinState.f = f; store.set("coins:f", f); },
  presets: () => ({ ...COIN_PRESETS, ...store.get("coins:presets", {}) }), apply: () => loadCoins() };
async function viewCoins(main) {
  const nar = await api("narratives");
  main.innerHTML = `<div class="page-head"><div><h1>Coins</h1><p>Every coin Blix is tracking right now. Brand-new pump.fun launches show up here once they trade for real.</p></div></div>
    <div class="filters">
      <input class="input" id="cq" placeholder="Search ticker, name or contract (searches dead and flagged coins too)" value="${esc(coinState.q)}" style="flex:1;min-width:200px">
      <select class="input" id="cgrad"><option value="">Any stage</option><option value="1">Graduated</option><option value="0">Still on the curve</option></select>
      <select class="input" id="ccls" title="Stablecoins, wrapped assets and tokenized stocks are kept out of the memecoin list"><option value="meme">Memecoins only</option><option value="other">Not memecoins</option><option value="all">Everything</option></select>
      <label class="check" title="Coins whose pool was emptied quote prices nobody can trade at"><input type="checkbox" id="cunrel" ${coinState.unreliable ? "checked" : ""}> Include unsellable</label>
    </div>
    <div id="cfilters">${filterPanel("cf", COIN_FILTERS, coinState.f, PANELS.cf.presets(), COIN_PRESETS)}</div>
    <div class="chips" style="margin-bottom:12px"><button class="chip ${coinState.theme ? "" : "on"}" data-ctheme="">All themes</button>${nar.themes.map((t) => `<button class="chip ${coinState.theme === t.name ? "on" : ""}" data-ctheme="${esc(t.name)}">${esc(t.name)}</button>`).join("")}</div>
    <div class="card"><div class="card-head"><h2 id="ccount">…</h2><div class="pager" id="cpager"></div></div><div id="coinTable"><div class="skel"></div><div class="skel"></div></div></div>`;
  $("#cgrad").value = coinState.grad; $("#ccls").value = coinState.cls;
  await loadCoins();
}
async function loadCoins(keepPage = false) {
  if (!keepPage) coinState.page = 0;
  const f = Object.fromEntries(Object.entries(coinState.f).filter(([, v]) => v !== "" && v != null));
  const qs = new URLSearchParams({ sort: coinState.sort, dir: coinState.dir, limit: coinState.per, offset: coinState.page * coinState.per, cls: coinState.cls, ...f,
    ...(coinState.theme && { theme: coinState.theme }), ...(coinState.q && { q: coinState.q }), ...(coinState.grad && { graduated: coinState.grad }), ...(coinState.unreliable && { unreliable: "1" }) });
  const d = await api(`tokens?${qs}`);
  coinState.total = d.total;
  const box = $("#coinTable");
  if (!box) return;
  box.innerHTML = coinTable(d.rows, { sort: coinState.sort, dir: coinState.dir });
  const from = d.total ? d.offset + 1 : 0, to = d.offset + d.rows.length, pages = Math.ceil(d.total / coinState.per);
  $("#ccount").textContent = d.total ? `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${d.total.toLocaleString()} matching coins` : "No matching coins";
  $("#cpager").innerHTML = pages > 1 ? `<button class="btn sm-btn" data-cpage="${coinState.page - 1}" ${coinState.page ? "" : "disabled"}>← Prev</button><span class="dim small">Page ${coinState.page + 1} of ${pages}</span><button class="btn sm-btn" data-cpage="${coinState.page + 1}" ${coinState.page + 1 < pages ? "" : "disabled"}>Next →</button>` : "";
}

function tradeRow(a, { showWallet = true } = {}) {
  const buy = a.side === "buy";
  const who = showWallet ? `<b class="linkish" data-wallet="${esc(a.wallet)}">${esc(walletName(a.wallet, a))}</b> ` : "";
  // Wallet and coin avatars side by side: who traded what.
  const lead = showWallet
    ? `<div class="pair">${wav(a.wallet, a, "sm")}${av({ mint: a.mint, symbol: a.symbol, image: a.image }, "sm")}</div>`
    : `<div class="av-wrap">${av({ mint: a.mint, symbol: a.symbol, image: a.image })}</div>`;
  return `<div class="sig trade" style="--k:${buy ? "var(--up)" : "var(--down)"}" data-mint="${esc(a.mint)}">
    ${lead}
    <div style="min-width:0"><div class="sig-top"><span class="tag">${buy ? "Buy" : "Sell"}</span><span class="dim">${ago(a.t)} ago</span></div>
      <h3>${who}${buy ? "bought" : "sold"} ${a.symbol ? "$" + esc(a.symbol) : shortAddr(a.mint)}</h3>
      <p><span class="num ${buy ? "up" : "down"}">${usd(a.usd)}</span>${a.sol ? ` · ${a.sol.toFixed(2)} SOL` : ""}${a.mcap ? ` · coin now ${money(a.mcap)}` : ""}</p></div>
    <div class="meta">${buy ? fomoBtn(a.mint) : ""}</div></div>`;
}

function fomoCard(f) {
  const head = `<div class="card-head"><h2><span class="fomo-mark">fomo</span> On-chain</h2><small>${f.connected ? `${f.tradesLastHour} Fomo trades seen in the last hour${f.sampled ? " (sampled)" : ""}` : "free, no API key"}</small></div>`;
  const addForm = `<form class="filters" style="padding:0 16px" id="fomoAdd">
      <input class="input num" id="fwallet" placeholder="Fomo trader's Solana wallet" style="flex:2;min-width:200px" autocomplete="off" spellcheck="false">
      <input class="input" id="fhandle" placeholder="@handle (optional)" style="flex:1;min-width:120px" autocomplete="off">
      <button class="btn fomo" type="submit">Add Fomo trader</button></form>`;
  if (!f.connected) return `<div class="card">${head}
    <div class="empty" style="text-align:left;padding:0 16px 12px"><b>Connect Fomo for free</b>
      Fomo pays its users' Solana fees, so every Fomo trade carries Fomo's fee-payer signature. Add one Fomo wallet and Blix learns that signature from its trades, then watches Fomo trades as they happen. No API key, nothing to pay.
      <ol style="margin:10px 0 0;padding-left:18px;color:var(--ink-2)">
        <li>Your own: Fomo app → Profile → Deposit → Solana → copy the address.</li>
        <li>Or any trader: look up their handle on <a class="linkish" href="https://fomowalletfinder.com/" target="_blank" rel="noreferrer">fomowalletfinder.com</a> (free) and paste the Solana wallet.</li>
      </ol>
      <p class="note" style="margin:10px 0 0">${f.fomoWallets ? `${f.fomoWallets} Fomo wallet${f.fomoWallets > 1 ? "s" : ""} added. Learning starts once Blix has seen 2 of their trades.` : "Buy on Fomo buttons already work."}</p></div>
    ${addForm}</div>`;
  const hot = f.hot || [], traders = f.traders || [];
  return `<div class="card">${head}${addForm}
    <div class="card-head" style="padding-top:4px"><h2>What Fomo is buying</h2><small>last hour</small></div>
    ${hot.length ? hot.map((c) => `<div class="leader" style="margin:0 10px" data-mint="${esc(c.mint)}">${av(c, "sm")}<span class="grow"><b>$${esc(c.symbol || shortAddr(c.mint))}</b> <span class="dim">${c.buyers} buyers · ${c.sellers} sellers</span></span><span class="num ${cls((c.bought || 0) - (c.sold || 0))}">${usd((c.bought || 0) - (c.sold || 0))}</span>${fomoBtn(c.mint)}</div>`).join("")
      : `<p class="note" style="padding:0 16px">No Fomo trades seen yet this hour.</p>`}
    <div class="card-head"><h2>Best Fomo traders seen</h2><small>by profit on trades Blix watched</small></div>
    ${traders.length ? `<div class="table-wrap"><table><thead><tr><th>Trader</th><th>Profit</th><th class="hide-sm">Win rate</th><th class="hide-sm">Coins</th><th></th></tr></thead><tbody>
      ${traders.slice(0, 15).map((t) => `<tr class="row" data-wallet="${esc(t.wallet)}"><td><div class="coin">${wav(t.wallet, { handle: t.handle, source: "fomo" }, "sm")}<div><b>${t.handle ? "@" + esc(t.handle) : esc(t.label || shortAddr(t.wallet))}</b><small>${t.trades} trades</small></div></div></td>
      <td class="${cls(t.realized)}">${usd(t.realized)}</td><td class="hide-sm">${t.winRate == null ? "—" : Math.round(t.winRate * 100) + "%"}</td><td class="hide-sm">${t.coins}</td>
      <td>${t.watching ? '<span class="up">following</span>' : `<button class="btn" data-follow="${esc(t.wallet)}">Follow</button>`}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="note" style="padding:0 16px 16px">Rankings appear once traders close a few positions.</p>`}</div>`;
}

async function viewWallets(main) {
  const d = await api("wallets");
  const tk = d.tracking, st = tk.stream;
  const watching = d.wallets.filter((w) => w.watching);
  const behind = watching.filter((w) => Date.now() - (w.checked || 0) > 5 * 60_000).length;
  const missed = watching.reduce((s, w) => s + (w.missed || 0), 0);
  const cooling = tk.rpc.coolingUntil > Date.now();
  // How current the tracking really is, in plain numbers, instead of an implied "live".
  const rpcNote = `<div class="card track ${st.connected && !cooling ? "" : "warn"}"><div class="track-row">
      <div><b>${st.connected ? "Live stream on" : "Live stream down"}</b><span>${st.connected ? `${st.wallets} of ${watching.length} wallets streamed; trades arrive within seconds` : "falling back to polling, which runs minutes behind"}</span></div>
      <div><b>${tk.backlog}</b><span>transactions waiting to be read</span></div>
      <div><b class="${behind ? "down" : ""}">${behind}</b><span>wallets not checked in 5+ min</span></div>
      <div><b class="${missed ? "down" : ""}">${missed}</b><span>transactions known missed</span></div>
      <div><b>${tk.rpc.public ? "Free public RPC" : "Your RPC"}</b><span>${tk.rpc.limited} rate limits, ${tk.rpc.errors} errors${cooling ? ` · resting ${Math.ceil((tk.rpc.coolingUntil - Date.now()) / 1000)}s` : ""}</span></div>
    </div>${tk.rpc.public ? `<p class="note" style="margin:10px 0 0">The free public RPC reads about one transaction a second and cuts off heavy use, so busy wallets fall behind and some trades are skipped (counted above). A free Helius RPC URL in <a class="linkish" href="#/settings">Settings</a> is about 10x faster.</p>` : ""}</div>`;
  const pct = (x) => x == null ? "—" : `${Math.round(x * 100)}%`;
  main.innerHTML = `<div class="page-head"><div><h1>Wallets</h1><p>Follow wallets across every Solana DEX. A buy only becomes a signal if the coin passes safety; otherwise it is filed as unscreened activity. Wallets that keep getting into coins that ran 3x are ranked below. That ranking is a heuristic: it finds wallets that were early, not wallets that are right.</p></div></div>
  <form class="filters" id="addWallet">
    <input class="input num" id="waddr" placeholder="Wallet address" style="flex:2;min-width:240px" autocomplete="off" spellcheck="false">
    <input class="input" id="wlabel" placeholder="Name (optional)" style="flex:1;min-width:140px">
    <button class="btn primary" id="wadd" type="submit">Follow wallet</button>
  </form>
  ${rpcNote}
  <div class="card" style="margin-bottom:18px"><div class="card-head"><h2>Following</h2><small>${watching.length} wallet${watching.length === 1 ? "" : "s"} · realized and open PnL are kept apart</small></div>
      ${d.wallets.length ? `<div class="table-wrap"><table><thead><tr><th>Wallet</th><th title="Closed positions that made money / all closed positions Blix saw">Wins</th><th title="Profit actually taken on positions that were sold">Realized</th><th title="Open positions at quoted prices, sellable coins only">Open</th><th class="hide-sm" title="What the open positions could plausibly be sold for, after pool depth, minus what they cost">Sellable</th><th class="hide-sm">Checked</th></tr></thead><tbody>
        ${d.wallets.map((w) => `<tr class="row ${w.watching ? "" : "paused"}" data-wallet="${esc(w.address)}"><td><div class="coin">${wav(w.address, w, "sm")}<div><b>${esc((w.label || shortAddr(w.address)).replace(/ \((bot|unverified), paused\)$/, ""))}</b>${w.watching ? "" : ` <span class="pill">${/\(bot/.test(w.label || "") ? "bot · paused" : /\(unverified/.test(w.label || "") ? "unverified · paused" : "paused"}</span>`}${w.linked ? `<span class="st dup" title="${esc(`Moves with ${w.linked} other followed wallet${w.linked > 1 ? "s" : ""}: ${w.groupWhy}. Counted as one actor.`)}">linked ×${w.linked + 1}</span>` : ""}
          <small>${w.source === "fomo" ? "Fomo trader" : w.source === "smart" ? `early in ${w.winners} runner${w.winners === 1 ? "" : "s"}` : "added by you"}${w.last_trade ? ` · traded ${ago(w.last_trade)} ago` : ""}${w.missed ? ` · <span class="down">${w.missed} missed</span>` : ""}</small></div></div></td>
        <td>${w.closed ? `${frac(Math.round((w.winRate || 0) * w.closed), w.closed)}` : "—"}</td>
        <td class="${cls(w.realized)}">${w.closed ? usd(w.realized) : "—"}</td>
        <td class="${cls(w.unrealized)}">${w.open ? usd(w.unrealized) : "—"}${w.stuck ? `<small class="down" title="${esc(`${w.stuck} bag${w.stuck > 1 ? "s" : ""} in emptied pools, quoted at ${money(w.stuckQuoted)} but unsellable; counted as zero`)}">${w.stuck} stuck</small>` : ""}</td>
        <td class="hide-sm ${cls(w.sellablePnl)}">${w.open ? usd(w.sellablePnl) : "—"}</td>
        <td class="hide-sm dim">${w.watching ? (w.checked ? `${mins(Date.now() - w.checked)} ago` : "not yet") : "—"}${w.lagMs != null ? `<small title="Typical delay between a trade landing on-chain and Blix reading it">lag ${mins(w.lagMs)}</small>` : ""}</td></tr>`).join("")}
      </tbody></table></div><p class="note pad">Realized = profit on coins already sold, from trades Blix saw. Open = unsold bags at quoted prices. Sellable = the same bags capped by what their pools could actually pay out. Bags in emptied pools count as zero.</p>` : empty("No wallets yet", "Paste a wallet above, or follow one from the list below. Auto-follow adds the best discovered wallets for you.")}</div>
  <div class="radar-grid even">
    <div class="stack">
      ${fomoCard(d.fomo)}
      <div class="card"><div class="card-head"><h2>Early wallets</h2><small>${d.smart.winners} coins that really ran 3x+ studied</small></div>
      <p class="note pad">Wallets that were early buyers or top holders in several coins that ran. Being early in a pump can also mean the wallet belongs to whoever ran it, so this is a lead to check, not an endorsement. Runs that only existed in emptied pools are excluded.</p>
      ${d.smart.wallets.length ? d.smart.wallets.map((w) => `<div class="sig" style="--k:var(--color-warn)" data-wallet="${esc(w.address)}">
        ${wav(w.address, { ...w, source: "smart" })}
        <div style="min-width:0"><span class="tag">${w.coins} winners</span><h3>${esc(w.label || shortAddr(w.address))}</h3>
        <p>${w.early ? `${w.early} early buys` : ""}${w.early && w.holder ? " · " : ""}${w.holder ? `${w.holder} as top holder` : ""} · ${w.tokens.slice(0, 5).map((t) => "$" + esc(t.symbol)).join(" ")}</p></div>
        <div class="meta">${w.watching ? '<b class="up">following</b>' : `<button class="btn" data-follow="${esc(w.address)}">Follow</button>`}</div></div>`).join("")
        : empty("Still learning", "Smart money shows up once coins Blix watched have run 3x or more. Give it a few hours.")}</div>
    </div>
    <div class="card"><div class="card-head"><h2>Live wallet activity</h2><small>buys and sells by wallets you follow</small></div>
      <div class="feed" id="wfeed">${d.activity.length ? d.activity.map((a) => tradeRow(a)).join("") : empty("Nothing yet", "Trades show up here within a minute of happening.")}</div></div>
  </div>`;
  const fa = $("#fomoAdd");
  if (fa) fa.onsubmit = async () => {
    const wallet = $("#fwallet").value.trim(), handle = $("#fhandle").value.trim();
    if (!wallet) return toast("Paste the trader's Solana wallet");
    try { await post("fomo/trader", { wallet, handle }); toast(`Added ${handle || "Fomo trader"}; reading their trades`); render(); }
    catch (e) { toast(e.message); }
  };
  $("#addWallet").onsubmit = async () => {
    const address = $("#waddr").value.trim(), label = $("#wlabel").value.trim();
    if (!address) return;
    try { await post("wallets", { address, label }); toast(`Following ${label || shortAddr(address)}`); render(); }
    catch (e) { toast(e.message); }
  };
}

async function openWallet(address) {
  const p = $("#panel");
  sheetOpen();
  p.innerHTML = `<div class="skel" style="margin-top:22px"></div><div class="skel"></div>`;
  const r = await api(`wallet/${address}`);
  const w = r.wallet, pnl = r.pnl;
  const open = pnl.positions.filter((x) => x.held > 0 && x.value != null && x.value > 1);
  p.innerHTML = `
    <div class="hero">
      <div class="banner"><span class="banner-gen" style="background-image:url('${genAvatar(address + "banner")}')"></span></div>
      <button class="close" data-close aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="hero-body">
        <div class="hero-av">${wav(address, w, "xl")}</div>
        <div class="hero-id"><h2>${esc(walletName(address, w))}</h2>
          <div class="sub num">${shortAddr(address)}</div>
          <div class="chips">${w.source === "smart" ? '<span class="pill">★ Smart money</span>' : w.source === "fomo" || w.fomo ? '<span class="pill fomo-pill">Fomo trader</span>' : w.source === "you" ? '<span class="pill">Followed by you</span>' : '<span class="pill">Not followed</span>'}${w.watching === 0 && w.source ? '<span class="pill">paused</span>' : ""}</div></div>
        <div class="hero-price"><span class="big num ${cls(pnl.realized)}">${pnl.closed ? usd(pnl.realized) : "—"}</span><small class="dim">realized, ${pnl.closed} closed position${pnl.closed === 1 ? "" : "s"}</small></div>
      </div>
    </div>
    <div class="p-acts">
      ${w.source ? `<button class="btn" data-wtoggle="${esc(address)}" data-on="${w.watching ? 0 : 1}">${w.watching ? "Pause" : "Resume"}</button><button class="btn" data-wrename="${esc(address)}">Rename</button><button class="btn" data-wremove="${esc(address)}">Unfollow</button>` : `<button class="btn primary" data-follow="${esc(address)}">Follow</button>`}
      ${w.label?.startsWith("@") ? `<a class="btn fomo" href="https://fomo.family/profile/${esc(w.label.slice(1))}" target="_blank" rel="noreferrer">Fomo profile</a>` : ""}
      ${w.source ? `<button class="btn" data-rule="wallet" data-target="${esc(address)}" data-effect="${r.rule === "mute" ? "" : "mute"}">${r.rule === "mute" ? "Unmute alerts" : "Mute alerts"}</button>` : ""}
      <a class="btn" href="https://gmgn.ai/sol/address/${esc(address)}" target="_blank" rel="noreferrer">GMGN</a>
      <a class="btn" href="https://solscan.io/account/${esc(address)}" target="_blank" rel="noreferrer">Solscan</a>
      <button class="btn" data-copy="${esc(address)}">Copy address</button>
    </div>
    ${w.group ? `<div class="p-sec"><div class="warn-box"><b>Linked to ${w.group.size - 1} other wallet${w.group.size > 2 ? "s" : ""} you follow.</b> They ${esc(w.group.why)}, so Blix counts them as one actor: ${w.group.members.map((m) => `<span class="linkish" data-wallet="${esc(m.address)}">${esc(m.name)}</span>`).join(", ")}. Likely one operator, a bundle, or copy-bots.</div></div>` : ""}
    <div class="p-sec"><div class="facts">
      <div class="fact"><b>Trades seen</b><span>${pnl.trades}</span></div>
      <div class="fact"><b>Closed with a profit</b><span>${pnl.closed ? `${frac(Math.round(pnl.winRate * pnl.closed), pnl.closed)} (${Math.round(pnl.winRate * 100)}%)` : "—"}</span></div>
      <div class="fact"><b>Realized profit</b><span class="${cls(pnl.realized)}">${pnl.closed ? usd(pnl.realized) : "—"}</span></div>
      <div class="fact"><b>Open, at quoted prices</b><span class="${cls(pnl.unrealized)}">${pnl.open ? usd(pnl.unrealized) : "—"}</span></div>
      <div class="fact"><b>Open bags could sell for</b><span>${pnl.open ? money(pnl.sellableValue) : "—"}</span></div>
      <div class="fact"><b>Stuck in dead pools</b><span class="${pnl.stuck ? "down" : ""}">${pnl.stuck ? `${pnl.stuck} · cost ${money(pnl.stuckCost)}` : "none"}</span></div>
      <div class="fact"><b>Last checked</b><span>${w.checked ? `${mins(Date.now() - w.checked)} ago` : "—"}</span></div>
      <div class="fact"><b>Read delay / missed</b><span>${w.lagMs != null ? mins(w.lagMs) : "—"} / ${w.missed || 0}</span></div>
    </div><p class="note" style="margin:10px 0 0">Covers only trades Blix saw since it started watching, priced in USD at the time. Realized profit is the only number that was actually banked. Open value is a quote, and bags in emptied pools${pnl.stuck ? ` (quoted at ${money(pnl.stuckQuoted)} here)` : ""} are counted as zero because they cannot be sold.</p></div>
    ${open.length ? `<div class="p-sec"><h3>Holding now</h3>${open.map((x) => `<div class="leader" data-mint="${esc(x.mint)}">${av(x, "sm")}<span class="grow"><b>$${esc(x.symbol || shortAddr(x.mint))}</b> <span class="dim">${esc(x.name || "")}</span>${x.exitable ? "" : `<span class="st bad" title="${esc(x.exitWhy || "")}">can't be sold</span>`}</span><span class="num ${x.exitable ? "" : "strike"}">${money(x.value)}</span><span class="num ${cls(x.unrealized)}" style="width:80px;text-align:right">${x.exitable ? usd(x.unrealized) : "$0"}</span></div>`).join("")}</div>` : ""}
    ${r.hits.length ? `<div class="p-sec"><h3>Why it's smart</h3>${r.hits.map((h) => `<div class="leader" data-mint="${esc(h.mint)}">${av(h, "sm")}<span class="grow"><b>$${esc(h.symbol || shortAddr(h.mint))}</b> <span class="dim">${h.kind === "early" ? "early buyer" : "top holder"}</span></span><span class="num up">${h.multiple ? h.multiple.toFixed(1) + "x run" : ""}</span></div>`).join("")}</div>` : ""}
    <div class="p-sec" style="padding:0"><h3 style="padding:16px 22px 0">Trades</h3>${r.trades.length ? r.trades.map((a) => tradeRow(a, { showWallet: false })).join("") : w.source
      ? `<p class="note" style="padding:0 22px 16px">No trades seen yet. New wallets get their last ~25 transactions checked within a minute or two.</p>`
      : `<div style="padding:0 22px 16px"><p class="note">Blix hasn't looked at this wallet yet.</p><button class="btn" data-wscan="${esc(address)}">Scan recent trades</button></div>`}</div>
    <div class="p-sec"><div class="mint">${esc(address)}</div></div>`;
  p.scrollTop = 0;
}

// ---------- research desk ----------
const gradeClass = (g) => !g ? "" : g.startsWith("A") ? "ga" : g.startsWith("B") ? "gb" : g.startsWith("C") ? "gc" : g === "D" ? "gd" : "gf";
const tierMark = (r) => r?.tier === "fast" ? `<span class="tier fast" title="Fast read by ${providerOf(r.model)}${r.ms ? ` in ${(r.ms / 1000).toFixed(1)}s` : ""}">F</span>` : r?.tier === "deep" ? `<span class="tier deep" title="Deep read by ${providerOf(r.model)}">◆</span>` : "";
// The lane as it is right now: who is reading, and why that differs from what Settings asks for.
let lanes = null;
const deepName = () => lanes?.deep?.actualName || "the deep-read AI";
const fastName = () => lanes?.fast?.actualName || lanes?.deep?.actualName || "the AI";
function providerCard(pv) {
  if (!pv) return "";
  const row = (label, l) => `<div class="prov"><b>${label}</b><span class="${l.actual ? (l.fallback ? "warn" : "up") : "down"}">${l.actualName || "none available"}</span>${l.fallback ? `<small>set to ${esc(l.configuredName)}; ${esc(l.reason || "unavailable")}</small>` : `<small>as configured${l.search ? " · searches X live" : ""}</small>`}</div>`;
  const notes = [pv.fast.note, pv.deep.note, pv.recovery].filter(Boolean);
  return `<div class="card provs ${pv.fast.fallback || pv.deep.fallback ? "warn" : ""}"><div class="prov-row">${row("First reads", pv.fast)}${row("Deep reads", pv.deep)}
      <div class="prov"><b>Grok</b><span class="${pv.grok.ok ? "up" : "down"}">${!pv.grok.installed ? "not logged in" : pv.grok.blocked ? "out of credits" : pv.grok.ok ? "available" : "rate limited"}</span><small>${pv.grok.errors} errors${pv.grok.blockedUntil ? ` · re-check in ${mins(pv.grok.blockedUntil - Date.now())}` : ""}</small></div>
      <div class="prov"><b>Claude</b><span class="${pv.claude.ok ? "up" : "down"}">${pv.claude.ok ? "available" : "not logged in"}</span><small>${pv.claude.usedThisHour}/${pv.claude.perHour} reads this hour${pv.claude.truncated ? ` · ${pv.claude.truncated} cut off` : ""}</small></div>
      <div class="prov"><b>Groq</b><span class="${pv.groq.configured ? "up" : "dim"}">${pv.groq.configured ? "key saved" : "no key"}</span><small>optional free fallback</small></div></div>
    ${notes.length ? `<p class="note" style="margin:10px 0 0">${notes.map(esc).join(" ")}</p>` : ""}</div>`;
}
const modelName = (m) => String(m || "").split("/").pop();
const gradeBadge = (g, size = "") => `<span class="grade ${gradeClass(g)} ${size}">${esc(g || "?")}</span>`;

function researchChip(t) {
  const r = t.research;
  if (!r) return `<button class="btn sm-btn" data-research="${esc(t.mint)}">Research</button>`;
  if (r.status === "queued") return `<span class="pill">Queued</span>`;
  if (r.status === "running") return `<span class="pill running">Researching…</span>`;
  if (r.status === "error") return `<button class="btn sm-btn" data-research="${esc(t.mint)}" title="Last try failed">Retry</button>`;
  if (r.status === "expired" || !r.grade) return `<button class="btn sm-btn" data-research="${esc(t.mint)}" title="It waited too long in the queue and was dropped unread">Research</button>`;
  return `${r.status === "deep" ? `<span class="pill running" title="${deepName()} is double-checking this one">checking</span>` : ""}${tierMark(r)}${gradeBadge(r.grade)}`;
}

function deskRow(t, kind) {
  const r = ["done", "deep"].includes(t.research?.status) ? t.research : null;
  const pctDone = Math.round((t.progress ?? 1) * 100);
  return `<div class="desk-row" data-mint="${esc(t.mint)}">
    ${av(t)}
    <div class="desk-main">
      <div class="desk-title"><b>$${esc(t.symbol)}</b><span class="dim">${esc(t.name || "")}</span></div>
      ${kind === "near"
        ? `<div class="bond"><div class="bond-bar"><i style="width:${pctDone}%"></i></div><span class="num">${pctDone}%</span></div>`
        : `<div class="dim small">bonded ${ago(t.bonded_at)} ago</div>`}
      ${r ? `<p class="verdict">${esc(r.verdict || "")}</p>` : ""}
    </div>
    <div class="desk-side">
      ${researchChip(t)}
      <span class="num">${money(t.mcap)}</span>
      <span class="num ${cls(t.chg_h1)}">${pct(t.chg_h1)}</span>
    </div>
  </div>`;
}

async function viewResearch(main) {
  const d = await api("research");
  const count = (s) => d.stats.find((x) => x.status === s)?.n || 0;
  const pv = d.providers, qd = d.queue;
  lanes = pv;
  main.innerHTML = `<div class="page-head"><div><h1>Research desk</h1>
      <p>Coins near bonding or just bonded are researched: X account, linked tweet, website, news, copycats, holders and flow. ${pv.fast.actual ? `${pv.fast.actualName} gives each one a first read${pv.fast.search ? " and searches X live for who is posting it" : ""}; strong ones get a deep read from ${pv.deep.actualName || "the deep lane"}.` : `${pv.deep.actualName || "No AI"} reads them one at a time, ${d.perHour} an hour.`} Only as many coins are queued as can be read while they still matter; the rest are dropped, not left to go stale.</p></div>
      <div class="desk-stats"><span class="pill">${count("running") ? "Researching now" : "Idle"}</span><span class="pill">${count("done") + count("deep")} graded</span>
        ${pv.fast.actual ? `<span class="pill">First reads ${d.hour.fast}/${d.fastPerHour} this hour${d.fast.avgMs ? ` · ${(d.fast.avgMs / 1000).toFixed(1)}s avg` : ""}</span>` : ""}<span class="pill">Deep reads ${d.hour.deep}/${d.perHour} this hour · at score ${d.deepMin}+</span></div></div>
    ${providerCard(pv)}
    <div class="card track" style="margin:14px 0 16px"><div class="track-row">
      <div><b>${qd.size} <span class="dim">/ ${qd.cap}</span></b><span>coins waiting for a first read</span></div>
      <div><b>${qd.size ? `${qd.oldestMin}m` : "—"}</b><span>longest wait (typical ${qd.medianMin}m)</span></div>
      <div><b>${qd.perHour}/h</b><span>reads possible right now${qd.etaMin != null && qd.size ? ` · ~${qd.etaMin}m to clear` : ""}</span></div>
      <div><b>${qd.expiredHour}</b><span>dropped this hour as stale or outranked</span></div>
      <div><b class="${qd.errors ? "down" : ""}">${qd.errors}</b><span>reads failed in 24h</span></div>
    </div><p class="note" style="margin:10px 0 0">The next read always goes to the waiting coin with the most live traction, not the one that waited longest. A brand-new coin is dropped after 25 minutes unread, a coin near bonding after 45, a bonded coin after 3 hours.</p></div>
    ${d.fast.ready && d.fast.cooling.length ? `<div class="card lane-note" style="margin-bottom:16px"><b>${esc(pv.fast.actualName || "Fast AI")} limits:</b> ${d.fast.cooling.map((c) => `${esc(modelName(c.model))} back in ${c.secs < 120 ? c.secs + "s" : Math.round(c.secs / 60) + "m"}`).join(" · ")}. Other models keep going.</div>` : ""}
    ${d.narratives.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Narratives the AI rates</h2><small>average score of the coins carrying them, last 12h</small></div>
      <div class="nar-rank">${d.narratives.map((n, i) => `<div class="nar-row"><span class="num dim">${i + 1}</span><b class="grow">${esc(n.theme)}</b>
        <span class="dim small">${n.coins} coin${n.coins === 1 ? "" : "s"}${n.strong ? ` · ${n.strong} strong` : ""}</span>
        <div class="meter-bar" style="width:90px"><i style="width:${n.avg}%"></i></div><span class="num">${n.avg}</span>
        ${n.best ? `<span class="nar-best" data-mint="${esc(n.best.mint)}">${av(n.best, "sm")}<b>$${esc(n.best.symbol)}</b>${gradeBadge(n.best.grade)}</span>` : ""}</div>`).join("")}</div></div>` : ""}
    ${d.top.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Best narratives right now</h2><small>graded in the last 12 hours</small></div>
      <div class="best">${d.top.map((t) => `<div class="best-card ${gradeClass(t.grade)}" data-mint="${esc(t.mint)}">
        <div class="best-top">${av(t, "lg")}<span>${tierMark(t)}${gradeBadge(t.grade, "lg")}</span></div>
        <b>$${esc(t.symbol)}</b><small class="dim">${esc(t.tag || t.name || "")}</small>
        <p>${esc(t.verdict || "")}</p>
        <div class="best-foot"><span class="pill">Ceiling ${esc(t.ceiling || "?")}</span><span class="num ${cls((t.mcap || 0) - (t.mcap_at || 0))}">${t.mcap_at ? mult((t.mcap || 0) / t.mcap_at) + " since" : ""}</span></div>
      </div>`).join("")}</div></div>` : ""}
    <div class="radar-grid even">
      <div class="card"><div class="card-head"><h2>About to bond</h2><small>pump.fun bonding curve, 60%+</small></div>
        <div class="feed">${d.near.length ? d.near.map((t) => deskRow(t, "near")).join("") : empty("Nothing close to bonding", "Coins show up here once they're 60% of the way.")}</div></div>
      <div class="card"><div class="card-head"><h2>Just bonded</h2><small>last 3 hours</small></div>
        <div class="feed">${d.bonded.length ? d.bonded.map((t) => deskRow(t, "bonded")).join("") : empty("No fresh graduations", "Bonded coins appear here as they migrate.")}</div></div>
    </div>`;
}

const bar10 = (label, v) => `<div class="meter"><span>${label}</span><div class="meter-bar"><i style="width:${(v || 0) * 10}%"></i></div><b class="num">${v ?? "—"}</b></div>`;

function researchSection(r, mint) {
  if (!r || !r.status || r.status === "expired") return `<div class="p-sec"><h3>AI research</h3><div id="researchBox">${r?.status === "expired" ? `<p class="note" style="margin:0 0 10px">This coin was queued but dropped unread: ${esc(r.error || "it waited too long")}.</p>` : ""}<p class="note" style="margin:0 0 10px">${fastName()} reads this coin's metadata, X, linked tweet, website, news and copycats, then grades the narrative and its ceiling. A read you ask for jumps the queue.</p><button class="btn primary" data-research="${esc(mint)}">Research this coin</button></div></div>`;
  if (!["done", "deep"].includes(r.status) || !r.report) return `<div class="p-sec"><h3>AI research</h3><div id="researchBox">${r.status === "error" ? `<p class="down">Last attempt failed: ${esc(r.error || "")}</p><button class="btn" data-research="${esc(mint)}">Try again</button>` : `<p class="note"><span class="pill running">${r.status === "running" ? "Researching…" : "Queued"}</span> ${r.status === "queued" && r.enq_t ? `Waiting ${mins(Date.now() - r.enq_t)}. ` : ""}This updates by itself.</p>`}</div></div>`;
  const x = r.report, s = r.sources || {};
  const so = s.socials || {};
  const list = (title, items, klass = "") => items?.length ? `<div class="r-list ${klass}"><h4>${title}</h4><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : "";
  const who = providerOf(r.model || x.model);
  const old = Date.now() - r.t > 60 * 60_000;
  return `<div class="p-sec research">
    <div class="r-head">${gradeBadge(x.grade, "xl")}<div><h3 style="margin:0 0 4px">AI research <span class="dim">· ${x.quick ? "quick call" : `${esc(x.confidence || "")} confidence`} · ${ago(r.t)} ago</span></h3><p class="r-verdict">${esc(x.verdict)}</p>
      <p class="dim small" style="margin:6px 0 0">${tierMark(r)} ${r.tier === "fast" ? "Fast read" : "Deep read"} by ${esc(who)} (${esc(modelName(r.model || x.model))})${r.ms ? ` in ${(r.ms / 1000).toFixed(1)}s` : ""}${x.searches ? ` · ${x.searches} live searches` : x.searched === false ? " · no live search: judged only the sources below" : ""}${r.status === "deep" ? ` · waiting for a deep read from ${deepName()}` : ""}${x.fast ? ` · fast read said ${esc(x.fast.grade)} (${esc(providerOf(x.fast.model))})` : ""}</p></div></div>
    ${old ? `<div class="warn-box">This research is ${ago(r.t)} old${s.market?.mcap ? ` and was written at ${money(s.market.mcap)} mcap` : ""}. The coin has moved since; the grade has not been refreshed.</div>` : ""}
    ${x.trade ? `<div class="r-trade act-bg-${esc(x.trade.action)}"><div>${actionBadge(x.trade.action)} ${x.trade.conviction != null ? `<b>Conviction ${x.trade.conviction}</b>` : x.trade.pWin != null ? `<b>${x.trade.pWin}% chance of 2x before −40%</b>` : ""}${x.trade.entry ? ` · <span class="dim">Entry: ${esc(x.trade.entry)}</span>` : ""}</div>
      <p>${esc(x.trade.why || "")}</p>
      ${x.trade.action === "buy" ? `<div class="ladder">${(x.trade.takeProfits || []).map((tp) => `<span>${tp.sellPct}% @ ${tp.atMultiple}x</span>`).join("")}${x.trade.stopLossPct ? `<span class="stop">stop -${x.trade.stopLossPct}%</span>` : ""}${x.trade.trailingStopPct ? `<span>trail ${x.trade.trailingStopPct}%</span>` : ""}${x.trade.timeStopHours ? `<span>${x.trade.timeStopHours}h max</span>` : ""}</div>` : ""}</div>` : ""}
    ${x.quick ? `<div class="r-card" style="margin-bottom:12px"><h4>The narrative${x.narrative?.tag ? ` · ${esc(x.narrative.tag)}` : ""}</h4><p>${esc(x.narrative?.summary || "")}</p>
      <p class="note" style="margin:10px 0">This is the quick first call (a few seconds). ${r.status === "deep" ? `The full report from ${deepName()} is on its way.` : "The full report (reasoning, bull and bear case, ceiling, sources checked) is written for coins the quick call would trade, or when you ask."}</p>
      ${r.status === "deep" ? "" : `<button class="btn" data-research="${esc(mint)}">Write the full report</button>`}</div>` : `<div class="r-grid">
      <div class="r-card"><h4>The narrative</h4><p>${esc(x.narrative?.summary || "")}</p>
        ${bar10("Strength", x.narrative?.strength)}${bar10("Timeliness", x.narrative?.timeliness)}${bar10("Originality", x.narrative?.originality)}${bar10("Reach", x.narrative?.reach)}</div>
      <div class="r-card"><h4>How high</h4><div class="ceiling">${esc(x.ceiling?.tier || "?")}</div><p>${esc(x.ceiling?.why || "")}</p>
        <h4 style="margin-top:12px">Catalyst</h4><p>${esc(x.catalyst || "none found")}</p></div>
    </div>`}
    ${x.thinking ? `<div class="r-think"><h4>How it reasoned${x.trade?.pWin != null ? ` · ${esc(x.trade.action || "no call")}, ${x.trade.pWin}% chance of 2x before −40%` : ""}</h4>${[["what", "What it is"], ["demand", "Demand right now"], ["buyersLeft", "Who is left to buy"], ["edge", "Edge"], ["kill", "How it loses"]].filter(([k]) => x.thinking[k]).map(([k, l]) => `<p><b>${l}</b>${esc(String(x.thinking[k]))}</p>`).join("")}${x.trade?.why ? `<p><b>Decision</b>${esc(String(x.trade.why))}</p>` : ""}</div>` : ""}
    <div class="r-grid">${list("Bull case", x.bull, "bull")}${list("Bear case", x.bear, "bear")}</div>
    ${list("Red flags", x.redFlags, "flags")}
    ${x.xBuzz ? `<div class="r-sources xbuzz"><h4>On X right now <span class="dim">· ${esc(x.xBuzz.sentiment || "?")} · ${esc(x.xBuzz.organic || "?")}</span></h4>
      <p style="margin:4px 0 8px">${esc(x.xBuzz.summary || "")}</p>
      ${(x.xBuzz.posts || []).map((po) => `<div class="src"><span><b>@${esc(String(po.handle || "?").replace(/^@/, ""))}</b>${/^https:\/\/(x|twitter)\.com\//.test(po.url || "") ? ` · ${extLink(po.url, "open post")}` : ` · <span class="dim">no link given</span>`}<small>${esc(po.text || "")}</small></span></div>`).join("")}
      ${(x.xBuzz.notable || []).length ? `<div class="src"><span><b>Accounts</b>${x.xBuzz.notable.slice(0, 5).map((n) => `<small>· ${esc(n)}</small>`).join("")}</span></div>` : ""}
    </div>` : ""}
    ${(x.evidence || []).length ? `<div class="r-sources"><h4>What the grade rests on <span class="dim">· each claim with where it came from</span></h4>
      ${x.evidence.map((e) => `<div class="src"><span><b>${esc(e.claim)}</b><small>${e.url ? extLink(e.url, esc(e.url.replace(/^https?:\/\//, "").slice(0, 70))) : `source: ${esc(e.source || "not given")}`}</small></span></div>`).join("")}</div>` : ""}
    <div class="r-sources"><h4>Sources gathered <span class="dim">· ${s.gatheredAt ? `read ${ago(Date.parse(s.gatheredAt))} ago` : `read ${ago(r.t)} ago`} · contract <span class="mono">${shortAddr(mint)}</span></span></h4>
      ${so.x && !so.x.error ? `<div class="src"><img class="av sm" src="${esc(safeHref(so.x.avatar) === "#" ? "" : so.x.avatar)}" alt="" data-drop><span><b>${extLink(so.x.url || `https://x.com/${so.x.user}`, "@" + esc(so.x.user)) || "@" + esc(so.x.user)}</b> · ${(so.x.followers ?? 0).toLocaleString()} followers${so.x.joined ? ` · joined ${esc(String(so.x.joined).slice(0, 16))}` : ""}<small>${esc(so.x.description || "")}</small></span></div>` : `<div class="src dim">No X account linked${so.x?.error ? ` (${esc(so.x.error)})` : ""}</div>`}
      ${so.linkedTweet ? `<div class="src"><span><b>Linked tweet</b> by @${esc(so.linkedTweet.author || "?")} · ${(so.linkedTweet.likes ?? 0).toLocaleString()} likes${so.linkedTweet.url ? ` · ${extLink(so.linkedTweet.url, "open")}` : ""}<small>${esc(so.linkedTweet.text || "")}</small></span></div>` : ""}
      ${so.website && !so.website.error ? `<div class="src"><span><b>Website</b> · ${extLink(so.website.url, esc(so.website.title || so.website.url)) || esc(so.website.title || "")} <span class="st old" title="Set by the coin's creator. Never connect a wallet there.">unverified site</span><small>${esc(so.website.description || "")}</small></span></div>` : ""}
      ${s.copycats ? `<div class="src"><span><b>Same ticker</b> · ${s.copycats.sameTicker} coins on Solana, this one is #${s.copycats.rankByMcap ?? "?"} by mcap${s.copycats.isOldest ? " and the oldest" : ""}</span></div>` : ""}
      ${(s.news || []).length ? `<div class="src"><span><b>News this week</b>${s.news.slice(0, 4).map((n) => `<small>· ${n.url ? extLink(n.url, esc(n.title)) : esc(n.title)}${n.date ? ` <span class="dim">(${esc(String(n.date).slice(5, 16))})</span>` : ""}</small>`).join("")}</span></div>` : `<div class="src dim">No news this week</div>`}
    </div>
    <button class="btn" data-research="${esc(mint)}" style="margin-top:12px">Research again</button>
  </div>`;
}

// ---------- picks (Grok's buy calls, running narratives, track record, playbook) ----------
const rate = (x) => x == null ? "—" : `${Math.round(x * 100)}%`;
const actionBadge = (a) => a ? `<span class="act act-${esc(a)}">${esc(a)}</span>` : "";
const stageBadge = (s) => `<span class="stage st-${esc(s || "?")}">${esc(s || "?")}</span>`;

function callCard(c) {
  const p = c.plan || {}, s = c.sim || {};
  const live = c.status === "open";
  const result = live ? `<span class="num ${cls(c.now_mult - 1)}">${mult(c.now_mult)}</span><small>now</small>` : `<span class="num ${cls(c.exit_mult - 1)}">${mult(c.exit_mult)}</span><small>${esc(c.exit_reason || "closed")}</small>`;
  return `<div class="call ${live ? "live" : c.exit_mult > 1 ? "won" : "lost"}" data-mint="${esc(c.mint)}">
    <div class="call-top">${av(c, "lg")}<div class="grow"><b>$${esc(c.symbol)}</b> ${gradeBadge(c.grade)}<div class="dim small">${esc(c.tag || c.name || "")}</div></div>
      <div class="call-res">${result}</div></div>
    <p>${esc(c.thesis || "")}</p>
    <div class="call-nums"><span><b>Called</b>${money(c.entry_mcap)} · ${ago(c.t)} ago</span><span><b>Conviction</b>${c.conviction}</span><span><b>Peak</b>${mult(c.peak_mult)}</span></div>
    <div class="ladder">${(p.takeProfits || []).map((tp, i) => `<span class="${(s.tp || 0) > i ? "hit" : ""}">${tp.sellPct}% @ ${tp.atMultiple}x</span>`).join("")}<span class="stop">stop -${p.stopLossPct}%</span>${p.trailingStopPct ? `<span>trail ${p.trailingStopPct}%</span>` : ""}<span>${p.timeStopHours}h max</span></div>
  </div>`;
}

// Counts with their denominators, not bare percentages: "3/41" says how much evidence there is.
function calTable(rows, label) {
  if (!rows?.length) return "";
  return `<div class="table-wrap"><table><thead><tr><th>${label}</th><th title="Reads, and how many different coins they cover">Reads (coins)</th><th>Median peak</th><th>Hit 2x</th><th>Hit 5x</th><th title="Fell 50% or more below the price at the read">Fell 50%+</th><th title="Pool emptied: could not be sold">Unsellable</th><th>Median after 24h</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td><b>${esc(r.key)}</b></td><td>${r.n} <span class="dim">(${r.tokens ?? r.n})</span></td><td>${mult(r.medianPeak)}</td><td class="up">${frac(r.hit2xN ?? Math.round((r.hit2x || 0) * r.n), r.n)}</td><td class="up">${frac(r.hit5xN ?? Math.round((r.hit5x || 0) * r.n), r.n)}</td><td class="down">${frac(r.dumpedN ?? Math.round((r.dumped || 0) * r.n), r.n)}</td><td class="${r.unsellable ? "down" : "dim"}">${r.unsellable ?? 0}</td><td>${mult(r.median24h)}${r.n24h != null ? ` <span class="dim">(${r.n24h})</span>` : ""}</td></tr>`).join("")}</tbody></table></div>`;
}

// A thesis is as old as the scout that wrote it. The coins under it keep getting re-priced; the research does not.
const REVIEW = { fresh: ["Fresh research", "up"], aging: ["Research aging", "warn"], expired: ["Research expired", "down"] };
function narCard(n) {
  const cat = n.catalysts || {};
  const ran = n.best_mult || n.best_peak;
  const [rvLabel, rvCls] = REVIEW[n.review] || REVIEW.expired;
  const withMint = (n.examples || []).filter((e) => e.mint);
  return `<div class="card scout ${n.review === "expired" ? "expired" : ""}">
    <div class="scout-top"><h3>${esc(n.name)}</h3>${stageBadge(n.stage)}<span class="num conf" title="Confidence the AI gave this thesis when it wrote it">${n.confidence}</span></div>
    <div class="scout-age"><span class="st ${rvCls === "up" ? "top" : rvCls === "warn" ? "old" : "bad"}">${rvLabel}</span><span class="dim small">${n.source === "cluster" ? `caught as a burst of launches${n.detect_ms != null ? `, named ${mins(n.detect_ms)} after it began` : ""} · ` : ""}researched ${mins(n.researchAge)} ago by ${n.model === "radar" ? "Blix alone (not looked up on X)" : esc(providerOf(n.model))}${cat.searches ? ` (${cat.searches} live searches)` : ""}${n.seen > 1 ? ` · found ${n.seen} times` : ""} · coin prices refreshed ${n.pricesAge != null ? `${mins(n.pricesAge)} ago` : "at scouting"}</span></div>
    ${n.review === "expired" ? `<p class="note warn-note">This thesis has not been re-checked since it was written. The catalysts below may be over; only the coin prices are current.</p>` : ""}
    <p>${esc(n.thesis || "")}</p>
    ${(cat.catalysts || []).length ? `<ul class="cats">${cat.catalysts.slice(0, 3).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    ${(cat.sources || []).length ? `<div class="srcs"><b>Sources</b>${cat.sources.map((x) => `<span>${extLink(x.url, esc(x.what || x.url.replace(/^https?:\/\//, "").slice(0, 50)))}${x.when ? ` <em>${esc(x.when)}</em>` : ""}</span>`).join("")}</div>` : `<div class="dim small">No source links were recorded for these claims, so they cannot be checked from here.</div>`}
    <div class="kw">${(n.keywords || []).map((k) => `<span>${esc(k)}</span>`).join("")}</div>
    ${withMint.length ? `<div class="dim small">Contracts the AI named: ${withMint.map((e) => `<span class="linkish mono" data-mint="${esc(e.mint)}">${esc(e.ticker || "")} ${shortAddr(e.mint)}</span>`).join(" · ")}</div>` : ""}
    ${n.matches?.length ? `<div class="scout-coins">${n.matches.slice(0, 8).map((m) => `<span class="leader ${m.dead ? "paused" : ""}" data-mint="${esc(m.mint)}" title="${esc(m.mint)}">${av(m, "sm")}<b>$${esc(m.symbol)}</b><span class="dim">${money(m.mcap)}${m.dead ? " · dead" : m.late ? " · launched after" : ""}</span></span>`).join("")}</div>` : `<div class="dim small">No radar coins on it yet${n.stage === "early" ? " (early: watch for launches)" : ""}</div>`}
    <div class="scout-foot"><span class="dim small">${cat.risk ? `Risk: ${esc(cat.risk)}` : ""}</span>${ran ? `<span class="pill ${n.best_mult >= 3 || n.best_peak >= 1e6 ? "ran" : ""}" title="Best move among matched coins after the call, from sellable prices only">${n.status === "scored" ? "Result" : "So far"}: ${n.best_mult ? `best ${mult(n.best_mult)}` : "no coin tracked from before the call"}${n.best_peak ? ` · peak ${money(n.best_peak)}` : ""}${n.med_mult ? ` · typical coin ${mult(n.med_mult)}` : ""}${n.lead_mult ? ` · lead coin ${mult(n.lead_mult)}` : ""}${n.launches_after ? ` · ${n.launches_after} new coins` : ""}</span>` : ""}</div>
  </div>`;
}
// One line that says where a self-running process stands, so "has not run" is never mistaken for "broken".
const statusLine = (state, text) => `<div class="status-line s-${state}"><i></i><span>${esc(text)}</span></div>`;

// ---------- Picks: every pick Blix has made ----------
const picksState = { tab: store.get("picks:tab", "ledger"), state: "all", day: "all", sort: "t", dir: -1, q: "", timer: null };
const pnlPct = (x) => x == null ? "—" : `${x >= 1 ? "+" : ""}${((x - 1) * 100).toFixed(Math.abs(x - 1) >= 1 ? 0 : 1)}%`;
const dayName = (t) => { const d = new Date(t), n = new Date(); n.setHours(0, 0, 0, 0); return t >= n.getTime() ? "Today" : t >= n.getTime() - 864e5 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };
// The running paper result, drawn as one line with the zero level marked.
function equityChart(curve, w = 1100, h = 150) {
  if (curve.length < 2) return `<div class="empty"><b>Not enough closed picks yet</b>The curve starts with the second closed pick.</div>`;
  const vs = curve.map((p) => p.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), span = hi - lo || 1;
  const X = (i) => (i / (curve.length - 1)) * w, Y = (v) => h - 8 - ((v - lo) / span) * (h - 16);
  const line = curve.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const last = vs[vs.length - 1], col = last >= 0 ? "var(--up)" : "var(--down)";
  return `<svg class="eq" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Running paper result">
    <path d="${line} L${w},${Y(0)} L0,${Y(0)} Z" fill="${col}" fill-opacity=".08"/>
    <line x1="0" x2="${w}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line-2)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>
    <div class="eq-axis"><span>${dayName(curve[0].t)} ${clock(curve[0].t)}</span><span>high ${hi >= 0 ? "+" : ""}$${Math.round(hi).toLocaleString()} · low ${lo < 0 ? "−" : ""}$${Math.abs(Math.round(lo)).toLocaleString()}</span><span>${clock(curve[curve.length - 1].t)}</span></div>`;
}
const PICK_COLS_UI = [["t", "Picked"], ["symbol", "Coin"], ["state", "Status"], ["entry", "Entry mcap"], ["mcapNow", "Now / exit"], ["peak", "Peak"], ["ruleX", "Result (rule)"], ["now", "Just held"], ["held", "Held"], ["pwin", "AI call"], ["traction", "Traction"], ["safety", "Safety"]];
function pickLedgerRow(p) {
  const st = p.state === "open" ? `<span class="st2 open">open${p.left < 0.999 ? ` · ${Math.round(p.left * 100)}% left` : ""}</span>` : `<span class="st2 ${p.state}">${p.state}</span>`;
  const call = p.early ? `<span class="dim">launch model</span>` : `${p.action ? `<span class="act act-${esc(p.action)}">${esc(p.action)}</span>` : ""}${p.pwin != null ? ` <span class="num">${p.pwin}%</span>` : ""}`;
  return `<tr class="row" data-mint="${esc(p.mint)}" title="${esc(p.ruleWhy || "")}${p.entryNote ? ` · ${esc(p.entryNote)}` : ""}">
    <td><span class="num">${clock(p.t)}</span><small class="sub">${dayName(p.t)}</small></td>
    <td><div class="coin">${av(p, "sm")}<div><b>${esc(p.symbol || "?")}</b>${p.replayed ? ` <span class="tagx" title="Picked before the live watcher existed: result replayed from stored prices, take-profit filled at exactly its level.">replayed</span>` : ""}<small>${esc(p.tag || p.name || p.stage || "")}</small></div></div></td>
    <td>${st}${p.unsellable ? `<small class="sub down">pool emptied</small>` : ""}</td>
    <td class="num">${money(p.entry)}</td>
    <td class="num">${p.unsellable ? "—" : money(p.mcapNow)}</td>
    <td class="num ${p.peak >= 2 ? "up" : ""}">${mult(p.peak)}</td>
    <td class="num ${xCls(p.ruleX)}"><b>${pnlPct(p.ruleX)}</b><small class="sub">${esc((p.ruleWhy || "").split(";")[0].slice(0, 34))}</small></td>
    <td class="num ${xCls(p.now * 0.97)}">${pnlPct(p.now * 0.97)}</td>
    <td class="num">${mins(p.held)}</td>
    <td>${call}</td>
    <td class="num">${p.traction ?? "—"}</td>
    <td class="num ${p.safety == null ? "dim" : p.safety >= 70 ? "up" : p.safety >= 40 ? "" : "down"}">${p.safety ?? "—"}</td></tr>`;
}
function picksLedger(d) {
  const T = d.totals, S = picksState, q = S.q.toLowerCase();
  let rows = d.picks.filter((p) => (S.state === "all" || p.state === S.state) && (S.day === "all" || dayName(p.t) === S.day) && (!q || `${p.symbol} ${p.name} ${p.tag} ${p.mint}`.toLowerCase().includes(q)));
  const val = (p) => S.sort === "symbol" ? String(p.symbol || "").toLowerCase() : S.sort === "state" ? p.state : p[S.sort] ?? -Infinity;
  rows = rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * S.dir);
  const kpi = (label, value, sub, c = "") => `<div class="kp"><span>${label}</span><b class="num ${c}">${value}</b><small>${sub}</small></div>`;
  const dayList = [...new Set(d.picks.map((p) => dayName(p.t)))];
  const seg = (items, cur, attr) => `<div class="seg">${items.map(([k, l]) => `<button class="${cur === k ? "on" : ""}" data-${attr}="${esc(k)}">${l}</button>`).join("")}</div>`;
  const split = (title, list) => list.length ? `<div class="mini"><h4>${title}</h4>${list.map((g) => `<div><span>${esc(g.key)}</span><span class="num">${g.wins}/${g.n} won</span><b class="num ${xCls(g.avg)}">${pnlPct(g.avg)}</b></div>`).join("")}</div>` : "";
  const G = d.guard, GR = d.guardRule;
  return `<div class="guard ${G ? "held" : ""}"><b>${G ? "Risk guard: new picks paused" : "Risk guard: on"}</b><span>${G ? `${esc(G.why)}. Resumes ${dayName(G.until) === "Today" ? `at ${clock(G.until)}` : "tomorrow"}. Open picks are still managed.` : `New picks pause for ${GR.pauseMin} minutes after ${GR.losses} losing exits in a row, and for the rest of the day once $100-a-pick is down $${GR.dayLoss}. Every entry is re-checked for safety at the second it is taken.`}</span><a class="linkish" href="#/settings">Change limits</a></div>
    <div class="kps">
      ${kpi("Picks", T.n, `${T.open} open · ${T.closed} closed`)}
      ${kpi("Won", T.winPct == null ? "—" : `${T.winPct}%`, T.closed ? `${T.wins} of ${T.closed} closed above entry` : "nothing closed yet", T.winPct == null ? "" : T.winPct >= 50 ? "up" : "down")}
      ${kpi("Average result", T.avg == null ? "—" : pnlPct(T.avg), `typical pick ${T.median == null ? "—" : pnlPct(T.median)}`, xCls(T.avg))}
      ${kpi("$100 in every pick", `${T.pnl >= 0 ? "+" : "−"}$${Math.abs(T.pnl).toLocaleString()}`, `sold by the rule, after ${d.paper.costPctPerSide}% costs each way`, T.pnl >= 0 ? "up" : "down")}
      ${kpi("Best", T.best ? pnlPct(T.best.x) : "—", T.best ? `$${esc(T.best.symbol)}` : "", "up")}
      ${kpi("Stopped out", T.closed ? `${Math.round((100 * T.stops) / T.closed)}%` : "—", `${T.stops} stop losses · ${T.unsellable} pools emptied`)}
    </div>
    <div class="blk"><div class="blk-head"><h2>Running result</h2><small>$100 into every pick, sold by the exit rule: half at ${d.rule.takeProfit}x, ${d.rule.trailPct}% trailing stop, ${d.rule.stopPct}% stop, ${d.rule.maxHours}h limit. Paper only.</small></div>
      <div class="eq-wrap">${equityChart(d.curve)}</div>
      <div class="minis">${split("By stage when picked", d.byStage)}${split("By what the AI said", d.byAction)}${d.byVia ? split("By what made it a pick", d.byVia.map((g) => ({ ...g, key: { model: "launch model", demand: "live demand", ai: "the AI's call" }[g.key] || g.key }))) : ""}
        <div class="mini"><h4>By day</h4>${d.days.slice(0, 6).map((g) => `<div><span>${dayName(g.day)}</span><span class="num">${g.wins}/${g.closed} won · ${g.n} picks</span><b class="num ${g.pnl >= 0 ? "up" : "down"}">${g.pnl >= 0 ? "+" : "−"}$${Math.abs(Math.round(g.pnl)).toLocaleString()}</b></div>`).join("")}</div></div></div>
    <div class="blk"><div class="blk-head tools"><h2>All picks <span class="count num">${rows.length}${rows.length !== d.picks.length ? ` of ${d.picks.length}` : ""}</span></h2>
        ${seg([["all", "All"], ["open", "Open"], ["won", "Won"], ["lost", "Lost"]], S.state, "pkstate")}
        ${seg([["all", "Every day"], ...dayList.slice(0, 5).map((x) => [x, x])], S.day, "pkday")}
        <input class="input" id="pkq" placeholder="Search coin" value="${esc(S.q)}"></div>
      <div class="table-wrap"><table class="ledger"><thead><tr>${PICK_COLS_UI.map(([k, l]) => `<th class="sortable ${S.sort === k ? "sorted" : ""}" data-pksort="${k}">${l}${S.sort === k ? (S.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
        <tbody>${rows.length ? rows.map(pickLedgerRow).join("") : `<tr><td colspan="${PICK_COLS_UI.length}">${empty("No picks match", "Change the filters above.")}</td></tr>`}</tbody></table></div>
      ${T.replayed ? `<p class="note pad">${T.replayed} early picks are marked “replayed”: they were made before the one-second watcher existed and their result was rebuilt from stored prices, which flatters the take-profit. Hover a row for exactly how it was sold.</p>` : ""}</div>`;
}
async function picksTick(force) {
  if (route() !== "picks") { clearInterval(picksState.timer); picksState.timer = null; return; }
  const box = $("#pkBox");
  if (!box || picksState.tab !== "ledger" || (document.hidden && !force)) return;
  if (!force && document.activeElement?.id === "pkq") return;
  const d = await api("picks/all").catch(() => null);
  if (!d || !$("#pkBox")) return;
  picksState.data = d;
  const top = box.querySelector(".table-wrap")?.scrollTop || 0;
  box.innerHTML = picksLedger(d);
  const tw = box.querySelector(".table-wrap"); if (tw) tw.scrollTop = top;
}
async function viewPicks(main) {
  main.innerHTML = `<div class="page-head slim"><div><h1>Picks</h1><p>Every coin Blix has picked, and what following its one exit rule would have returned. Paper only: nothing is bought, and none of it is financial advice.</p></div>
      <div class="seg big">${[["ledger", "All picks"], ["desk", "AI desk"]].map(([k, l]) => `<button class="${picksState.tab === k ? "on" : ""}" data-pktab="${k}">${l}</button>`).join("")}</div></div>
    <div id="pkBox"><div class="skel"></div><div class="skel"></div></div>`;
  clearInterval(picksState.timer);
  if (picksState.tab === "desk") return picksDesk($("#pkBox"));
  picksState.timer = setInterval(picksTick, 5000);
  await picksTick(true);
}
document.addEventListener("click", (e) => {
  const el = e.target.closest?.("[data-pktab],[data-pkstate],[data-pkday],[data-pksort]");
  if (!el) return;
  const d = el.dataset, S = picksState;
  if (d.pktab) { S.tab = d.pktab; store.set("picks:tab", S.tab); return render(); }
  if (d.pkstate) S.state = d.pkstate;
  else if (d.pkday) S.day = d.pkday;
  else if (d.pksort) { if (S.sort === d.pksort) S.dir = -S.dir; else { S.sort = d.pksort; S.dir = d.pksort === "symbol" ? 1 : -1; } }
  if (S.data && $("#pkBox")) $("#pkBox").innerHTML = picksLedger(S.data);
});
document.addEventListener("input", (e) => {
  if (e.target.id !== "pkq") return;
  picksState.q = e.target.value.trim();
  const body = $("#pkBox .ledger tbody");
  if (!picksState.data || !body) return;
  // Redraw only the rows, so the box being typed in keeps its cursor.
  const tmp = document.createElement("div"); tmp.innerHTML = picksLedger(picksState.data);
  body.innerHTML = tmp.querySelector(".ledger tbody").innerHTML;
  const c = $("#pkBox .count"); if (c) c.textContent = tmp.querySelector(".count").textContent;
});

async function picksDesk(main) {
  const d = await api("picks");
  const sc = d.scorecard, c = sc.calls, pb = d.playbook;
  const st = d.status, rv = st.review, scout = st.scout, cs = st.calls;
  // Narratives now arrive from live bursts as well as the scout, so "the latest scout" is no longer one batch:
  // show every thesis that is still current, and fall back to the newest few when all of them have expired.
  const current = d.narratives.filter((n) => n.review !== "expired");
  const lastScout = d.narratives.length ? Date.now() - d.narratives[0].researchAge : null;
  const latest = current.length ? current.slice(0, 12) : d.narratives.slice(0, 6);
  const earlier = d.narratives.filter((n) => !latest.includes(n) && (n.best_mult || n.best_peak)).slice(0, 9);
  const stale = latest.length && latest.every((n) => n.review === "expired");
  const wins = c.closed ? Math.round(c.winRate * c.closed) : 0;
  main.innerHTML = `<div class="page-head"><div><h1>AI picks</h1>
      <p>The deep read on each strong coin ends in <b>buy</b>, <b>watch</b> or <b>avoid</b> with an exit plan. Buy calls are paper-traded, and the AI rewrites its own playbook from the results. Alerts only: nothing is ever traded.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="pkScout" ${d.busy.scouting || !scout.available ? "disabled" : ""} title="${esc(scout.why || "")}">${d.busy.scouting ? "Scouting…" : "Scout narratives now"}</button><button class="btn primary" id="pkReview" ${d.busy.reviewing || rv.state === "blocked" ? "disabled" : ""}>${d.busy.reviewing ? "Reviewing…" : "Self-review now"}</button></div></div>
    <div class="kpis">
      <div class="card kpi"><b>Buy calls (7d)</b><span>${c.n}</span><small>${c.open} open · ${c.closed} closed</small></div>
      <div class="card kpi"><b>Closed above entry</b><span class="${c.closed ? (c.winRate >= 0.5 ? "up" : "down") : ""}">${c.closed ? frac(wins, c.closed) : "—"}</span><small>${c.closed ? "paper trades, after costs" : "no closed calls yet"}</small></div>
      <div class="card kpi"><b>Avg paper exit</b><span class="${c.avgExit > 1 ? "up" : c.avgExit != null ? "down" : ""}">${mult(c.avgExit)}</span><small>${c.closed ? `over ${c.closed} closed call${c.closed === 1 ? "" : "s"}` : "nothing to average yet"}</small></div>
      <div class="card kpi"><b>Playbook</b><span>v${pb.version}</span><small>${pb.version ? `${ago(pb.t)} ago · ${pb.rules.length} rules` : `first review at ${rv.needed} results`}</small></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Is the self-learning loop working?</h2><small>what has run, what has not, and why</small></div>
      <div class="status-list">
        ${statusLine(cs.saidBuy ? "ok" : cs.deepReads24h ? "wait" : "idle", `Buy calls: ${cs.why}${cs.blocked ? ` Last call blocked by safety: $${cs.blocked.symbol} (${cs.blocked.reasons.join("; ")}).` : ""}`)}
        ${statusLine(rv.state === "due" || rv.state === "running" ? "ok" : rv.state === "blocked" ? "bad" : "wait", `Self-review: ${rv.why}${rv.last ? ` Last check ${ago(rv.last.t)} ago: ${rv.last.outcome}${rv.last.detail ? ` (${rv.last.detail})` : ""}.` : " It has never been attempted."} Runs on ${rv.provider || "nothing right now"}.`)}
        ${statusLine(scout.why ? "bad" : scout.overdue ? "wait" : "ok", `Narrative scout: ${scout.why || `last ran ${scout.lastOk ? ago(scout.lastOk) + " ago" : "never"}, set to every ${scout.every} minutes.`}${scout.last && scout.last.outcome !== "ok" && !scout.why ? ` Last attempt: ${scout.last.detail}.` : ""}`)}
        ${statusLine("wait", `Proof so far: ${c.closed} closed call${c.closed === 1 ? "" : "s"} and playbook v${pb.version}. ${c.closed || pb.version ? "" : "Until calls close and a review runs, this loop is unproven: treat it as an experiment, not a track record."}`)}
      </div>
      <p class="note pad">Paper trades assume ${d.paper.costPctPerSide}% lost to fees and slippage on each buy and each sell, that the whole position could be sold at the quoted market cap, and that a pool emptied before the exit is a total loss. Real fills on thin coins are usually worse.</p></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Today's buy calls</h2><small>${d.today.length} today</small></div>
      ${d.today.length ? `<div class="calls">${d.today.map(callCard).join("")}</div>` : empty("No buy calls yet today", `A coin is only called when its deep read says buy with conviction ${d.settings.buyConviction}+ and it passes the safety check. ${cs.why}`)}</div>
    <div class="radar-grid even">
      <div class="card"><div class="card-head"><h2>Deep reads today</h2><small>best first</small></div>
        <div class="feed">${d.watch.length ? d.watch.map((w) => `<div class="desk-row" data-mint="${esc(w.mint)}">${av(w)}<div class="desk-main"><div class="desk-title"><b>$${esc(w.symbol)}</b>${actionBadge(w.trade?.action)}${w.trade ? `<span class="dim small">conviction ${w.trade.conviction}</span>` : ""}</div>
          <p class="verdict">${esc(w.trade?.why || w.verdict || "")}</p>${w.trade?.entry ? `<div class="dim small">Entry: ${esc(w.trade.entry)}</div>` : ""}</div><div class="desk-side">${gradeBadge(w.grade)}<span class="num">${money(w.mcap)}</span></div></div>`).join("") : empty("No deep reads yet today", "Coins that score well on the fast read get a deep read here.")}</div></div>
      <div class="card"><div class="card-head"><h2>Playbook v${pb.version}</h2><small>${pb.version ? `written by ${esc(providerOf(pb.model))} from its own results` : "not written yet"}</small></div>
        ${pb.version ? `<p class="note" style="margin-top:0">${esc(pb.notes || "")}</p><ol class="rules">${pb.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>
          ${pb.changes.length ? `<h4 class="sub">Last changes</h4><ul class="rules dim">${pb.changes.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
          <div class="dim small">Tuned: buy calls at conviction ${pb.tuning.buyConviction ?? "—"}+, deep reads at score ${pb.tuning.deepMinScore ?? "—"}+</div>`
        : empty("No playbook yet", rv.why)}</div>
    </div>
    <div class="card" style="margin:16px 0"><div class="card-head"><h2>${stale ? "Last scouted narratives (out of date)" : "Running narratives"}</h2><small>${lastScout ? `newest ${ago(lastScout)} ago` : "first scout runs a few minutes after start"} · <a class="linkish" href="#/narratives">live bursts →</a></small></div>
      ${scout.why ? `<div class="warn-box" style="margin:0 16px 12px"><b>Not being refreshed.</b> ${esc(scout.why)}</div>` : stale ? `<div class="warn-box" style="margin:0 16px 12px"><b>These are ${ago(lastScout)} old.</b> Every thesis below has expired; a new scout is due.</div>` : ""}
      ${latest.length ? `<div class="scouts">${latest.map(narCard).join("")}</div>` : empty("No narratives scouted yet", scout.why || `The scout searches X and the web every ${scout.every} minutes.`)}
      ${earlier.length ? `<h4 class="sub">How earlier calls did</h4><div class="scouts">${earlier.map(narCard).join("")}</div>` : ""}</div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>How the grades did</h2><small>${sc.graded} reads that have had 6h+ to play out, last 7 days · market-cap moves, not trades</small></div>
      ${sc.graded ? `${calTable(sc.byGrade, "Grade")}${calTable(sc.byAction, "Deep read said")}${calTable(sc.byTier, "Read")}${calTable(sc.byOrganic, "X buzz")}${calTable(sc.byStage, "Stage")}${calTable(sc.byTheme, "Narrative")}`
        : empty("Results build up", "Each graded coin needs 6 hours before it counts. This fills in on its own.")}</div>
    ${d.calls.length > d.today.length ? `<div class="card"><div class="card-head"><h2>Earlier calls</h2><small>last 7 days</small></div><div class="calls">${d.calls.filter((x) => !d.today.includes(x)).map(callCard).join("")}</div></div>` : ""}`;
  $("#pkScout").onclick = async () => { const r = await post("picks/scout"); toast(r.started ? "Scouting X for narratives (about a minute)" : r.why || "The scout cannot run right now"); setTimeout(() => route() === "picks" && render(), 1500); };
  $("#pkReview").onclick = async () => { await post("picks/review"); toast(`${rv.provider || "The AI"} is reviewing the track record`); setTimeout(() => route() === "picks" && render(), 1500); };
}

// ---------- pulse (live three-column view, AI rating every coin as it streams) ----------
const pulseState = { tab: store.get("pulse:tab", "new"), botTimer: null, q: "", min: store.get("pulse:min", "noslop"), timer: null, rows: new Map(), first: true, f: store.get("pulse:f", {}), cq: {}, ai: null,
  // terminal state: per-column sort, the watchlist, the selected row (keyboard), density, sound, paper desk sizes
  sort: store.get("pulse:sort", {}), watch: new Set(store.get("pulse:watch", [])), sel: null, compact: store.get("pulse:compact", false), sound: store.get("pulse:sound", false), sizes: [0.1, 0.25, 0.5, 1], desk: null };
const GRADE_RANK = { "A+": 11, A: 10, "A-": 9, "B+": 8, B: 7, "B-": 6, "C+": 5, C: 4, "C-": 3, D: 2, F: 1 };
const ageStr = (ms) => { const s = ms / 1000; return s < 60 ? `${Math.max(0, Math.floor(s))}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };
const compact = (n) => n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : `$${Math.round(n)}`;
const ICON = {
  x: `<svg viewBox="0 0 24 24"><path d="M4 4l16 16M20 4L4 20"/></svg>`,
  web: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>`,
  tg: `<svg viewBox="0 0 24 24"><path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/></svg>`,
  users: `<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.6-1.6-4.8-4-5.6"/></svg>`,
  crown: `<svg viewBox="0 0 24 24"><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/></svg>`,
  chef: `<svg viewBox="0 0 24 24"><path d="M7 18h10v3H7zM6 14a4 4 0 1 1 2-7.5 4 4 0 0 1 8 0A4 4 0 1 1 18 14v4H6z"/></svg>`,
  star: `<svg viewBox="0 0 24 24"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>`,
};

// First-pass triage (instant rules, then the fast LLM): slop / meh / maybe / promising.
const TRI = { slop: "SLOP", meh: "MEH", maybe: "MAYBE", promising: "HOT" };
function triChip(t) {
  const x = t.tri;
  if (!x) return "";
  return `<span class="tri tri-${esc(x.label)} ${x.src === "rules" ? "is-rules" : ""}" title="${esc(`${x.src === "rules" ? "Instant rules" : `Fast AI (${String(x.model || "").split("/").pop()})`}: ${x.why || ""}`)}">${TRI[x.label] || x.label}<em>${x.score}</em></span>`;
}

function aiChip(t) {
  const a = t.ai;
  // Not read yet: one press sends it to the front of the AI's queue (a coin Blix is not tracking yet is adopted first).
  if (!a) return t.state === "faded" ? `<span class="ai none">faded</span>` : `<button class="ai none rd" data-research="${esc(t.mint)}" title="Send to the AI for a first read now (hotkey r)">read</button>`;
  if (a.status === "queued") return `<span class="ai queued" title="Waiting for a read. Not rated yet.">queued</span>`;
  // Name whoever is really reading: a deep read when a first grade already exists, else the first-read lane.
  if (a.status === "running") return `<span class="ai reading"><i></i>${a.grade ? `${pulseState.ai?.deep || "AI"} deep read` : `${pulseState.ai?.fast || pulseState.ai?.deep || "AI"} reading`}</span>`;
  if (a.status === "error" || !a.rated) return `<button class="ai none rd" data-research="${esc(t.mint)}" title="The last read failed. Press to try again.">retry read</button>`;
  const buy = a.action === "buy";
  return `<span class="ai done ${gradeClass(a.grade)} ${buy ? "buy" : ""}" title="${esc(`${a.tier === "deep" ? "Deep" : "Fast"} read by ${providerOf(a.model)}, ${ago(a.t)} ago${a.pwin != null ? `. Trade call: ${a.action || "none"}, ${a.pwin}% chance of 2x before -40%. The grade is for the narrative only` : ""}: ${a.verdict || ""}`)}">${buy ? `<b class="buy-tag">BUY</b>` : ""}${a.tier === "deep" ? "◆" : "⚡"}<b>${esc(a.grade)}</b><em>${a.score}</em>${a.pwin != null ? `<i class="pw ${a.action === "avoid" ? "no" : ""}">${a.action === "avoid" ? "avoid" : `${a.pwin}%`}</i>` : ""}${a.status === "deep" ? `<i class="spin"></i>` : ""}</span>`;
}

// One Pulse row: a fixed four-line terminal layout. Line 1 ticker · name · market cap. Line 2 age ·
// launchpad · links · contract · volume and 1-minute change. Line 3 the live stat strip (holders, top 10,
// dev, snipers, bundle, trades, the 5-minute window). Line 4 the rank, the AI call with its verdict, and
// the actions. Every live number keeps its lv-* hook so the 200ms push updates it in place.
function pulseRow(t, col) {
  const prog = t.progress != null ? Math.round(t.progress * 100) : null;
  const ring = col === "migrated" ? 100 : prog ?? 0;
  const tx = (t.buys || 0) + (t.sells || 0), buyShare = tx ? (t.buys || 0) / tx : null;
  const a = t.ai, rated = a && a.verdict && ["done", "deep"].includes(a.status);
  const vol = t.vol ?? t.liveVol;
  const H = t.hl || {}, curve = !t.graduated && col !== "migrated";
  const holders = curve ? (H.h ?? t.holders ?? null) : (t.holders ?? H.h ?? null);
  const top10 = curve ? (H.t10 ?? t.top10 ?? null) : (t.top10 ?? H.t10 ?? null);
  const dev = curve ? (H.dev ?? t.dev ?? null) : (t.dev ?? H.dev ?? null);
  const st = (k, icon, v, fmt, bad, title, unit = "%") => `<span class="sc lv-${k}w ${bad ? "bad" : ""}" title="${esc(title)}" ${v == null ? "hidden" : ""}>${icon}<b class="lv-${k}">${v == null ? "" : fmt(v)}</b>${unit}</span>`;
  const sizes = pulseState.sizes, main = sizes[1] ?? sizes[0];
  const note = rated ? `${a.tag ? `<b>${esc(a.tag)}</b> · ` : ""}${esc(a.verdict)}` : t.tri?.why && col === "new" ? `${esc(t.tri.why)}${t.desc ? ` · ${esc(t.desc)}` : ""}` : t.desc && col === "new" ? esc(t.desc) : "";
  const rank = t.tr != null ? `<span class="rk ${t.tr >= 60 ? "hi" : t.tr >= 40 ? "mid" : "lo"}" title="Live rank 0-100: real demand this second (5-minute volume, traders, 1m and 5m change, size, distance from its high). Measured on past reads as the one ranking that predicted winners. 60+ is the pick line.">${t.tr}</span>` : "";
  return `<div class="pr ${a?.status === "running" ? "rating" : ""} ${t.state === "faded" ? "faded" : ""} ${a?.action === "buy" ? "is-buy" : ""} ${t.live ? "is-live" : ""} ${t.tri?.label === "slop" && !a ? "slop" : ""} ${pulseState.sel === t.mint ? "sel" : ""} ${pulseState.watch.has(t.mint) ? "watched" : ""}" data-mint="${esc(t.mint)}" data-born="${Date.now() - (t.age || 0)}" style="--ring:${ring}">
    <div class="pr-av ${col === "migrated" ? "gold" : ""}">${av(t)}${prog != null && col !== "migrated" ? `<span class="pr-pct lv-pct">${prog}%</span>` : ""}</div>
    <div class="pr-b">
      <div class="r1"><button class="star ${pulseState.watch.has(t.mint) ? "on" : ""}" data-pwatch="${esc(t.mint)}" title="Watchlist (w)">${ICON.star}</button><b class="sym">${esc(t.symbol || "?")}</b><span class="nm">${esc(t.name || "")}</span>
        <span class="r-right mc"><small>MC</small><b class="num lv-mc">${t.mcap ? compact(t.mcap) : t.startMcapSol ? compact(t.startMcapSol * (pulseState.sol || 150)) : "—"}</b></span></div>
      <div class="r2"><span class="pr-age">${ageStr(t.age)}</span>${protoChips(t)}<span class="links">${extLink(t.x, ICON.x, "") && `<span title="X">${extLink(t.x, ICON.x, "")}</span>`}${extLink(t.web, ICON.web, "untrusted") && `<span title="Website set by the creator (unverified)">${extLink(t.web, ICON.web, "untrusted")}</span>`}${extLink(t.tg, ICON.tg, "") && `<span title="Telegram">${extLink(t.tg, ICON.tg, "")}</span>`}</span><span class="ca mono" title="Contract ${esc(t.mint)}">${esc(t.mint.slice(0, 4))}…${esc(t.mint.slice(-4))}</span>
        <span class="r-right vol"><small>V</small><b class="num lv-v">${compact(vol)}</b>${t.chg1m != null ? `<i class="num lv-chg ${cls(t.chg1m)}">${pct(t.chg1m)}</i>` : t.chg5 != null ? `<i class="num lv-c5 ${cls(t.chg5)}">${pct(t.chg5)}</i>` : `<i class="num lv-chg"></i>`}</span></div>
      <div class="r3">
        ${st("h", ICON.users, holders, String, false, curve ? "Holders now, from the live trade feed" : "Holders (RugCheck)", "")}
        ${holders == null && t.traders != null ? `<span class="sc lv-trw" title="Traders seen live">${ICON.users}<b class="lv-tr">${t.traders}</b></span>` : ""}
        ${st("t10", ICON.crown, top10, (v) => String(Math.round(v)), top10 > 45, "Top 10 holders share of the supply")}
        ${st("dev", ICON.chef, dev, (v) => (+v).toFixed(1), dev > 8, "Dev wallet share of the supply")}
        ${dev == null && t.devSol != null ? `<span class="sc lv-devsol" title="Dev bought at launch">${ICON.chef}<b>${(+t.devSol).toFixed(2)}</b> SOL</span>` : ""}
        <i class="flag bad lv-ds" ${H.ds ? "" : "hidden"} title="The dev wallet sold ${H.ds === "all" ? "everything" : "more than half of"} what it held">${H.ds === "all" ? "DEV SOLD" : "DEV SELLING"}</i>
        ${st("sn", "SN", H.snN ? H.sn : null, String, H.sn > 20, `Snipers: ${H.snN ?? "?"} wallets bought within 2 blocks of the first trade${H.snOut != null ? `, ${H.snOut} already out` : ""}; share of supply they still hold`)}
        ${st("bd", "BD", H.bdN ? H.bd : null, String, H.bd > 15, `Bundle: ${H.bdN ?? "?"} other wallets bought in the launch block; share of supply they still hold`)}
        ${t.devCount >= 4 ? `<span class="sc ${t.devCount >= 10 ? "bad" : ""}" title="Coins this dev wallet launched in the last 6h">dev<b>×${t.devCount}</b></span>` : ""}
        <span class="sc lv-txw" title="Buys / sells" ${tx ? "" : "hidden"}>TX<b class="lv-tx">${tx}</b><i class="bs"><i class="lv-bs" style="width:${Math.round((buyShare ?? 0.5) * 100)}%"></i></i></span>
        ${t.win ? `<span class="sc win ${t.win.netSol < 0 ? "bad" : ""}" title="Last 5 minutes: ${t.win.trades} trades by ${t.win.traders} wallets, ${t.win.netSol >= 0 ? "+" : ""}${t.win.netSol} SOL net buying${t.win.chg != null ? `, ${t.win.chg >= 0 ? "+" : ""}${t.win.chg}% price` : ""}">5m<b>${t.win.traders}w</b><b>${t.win.netSol >= 0 ? "+" : ""}${t.win.netSol}</b>SOL${t.win.chg != null ? `<b class="${cls(t.win.chg)}">${t.win.chg >= 0 ? "+" : ""}${t.win.chg}%</b>` : ""}</span>` : ""}
      </div>
      <div class="r4">${rank}${col === "new" ? triChip(t) : ""}${t.early ? `<span class="trc ${t.early.strong ? "hi early" : "mid"}" title="Launch model: chance this doubles before it falls 40%, judged ${t.early.cp}s after launch">${t.early.strong ? "★" : ""}E${Math.round(t.early.p * 100)}%</span>` : ""}${aiChip(t)}<span class="note">${note}</span>
        <span class="acts"><span class="pr-quick"><button class="qb main" data-pbuy="${esc(t.mint)}" data-sol="${main}" title="Paper buy ${main} SOL at the price this second (b). Nothing is really bought.">B ${main}</button><span class="qb-more">${sizes.filter((s) => s !== main).map((s) => `<button class="qb" data-pbuy="${esc(t.mint)}" data-sol="${s}" title="Paper buy ${s} SOL">${s}</button>`).join("")}</span></span><a class="fomo-q" href="${fomoUrl(t.mint)}" target="_blank" rel="noreferrer" title="Buy on Fomo (f)">Fomo</a></span></div>
    </div>
  </div>`;
}

// Numeric filters for the live columns. A coin with no reading for a field (holders are unknown until
// the safety check runs) is hidden by that field's filter rather than assumed to pass.
//
// Pulse Filters: the same layout Axiom and GMGN use. Each column (New Pairs, Final Stretch, Migrated) has
// its own set: keywords, launchpads, an Audit tab, a $ Metrics tab and a Socials tab, with three saved
// slots (1 / 2 / 3). Holders, top 10, dev holding, snipers and bundles come from Blix's own ledger of
// the live trade feed (t.hl). Fields with no free source left (X follower counts, fees, pro traders) are
// listed but switched off: Blix does not guess.
const PF_COLS = [["new", "New Pairs"], ["running", "Running Now"], ["stretch", "Final Stretch"], ["migrated", "Migrated"]];
const PF_PROTOCOLS = ["Pump", "Bonk", "Bags", "Moonshot", "Jupiter Studio", "Believe", "LaunchLab", "Dynamic BC", "PumpSwap", "Raydium", "Meteora AMM", "Orca", "Other"];
const PF_NO_SOURCE = ["Mayhem", "Bonkers", "Rise Rich", "Stonkfun", "Printr", "Liquid", "Surge", "Soar", "Heaven", "Daos.fun", "Candle", "Sugar", "Moonit", "Boop"];
// [key, label, unit, value(t)]; a null value function = no data source.
const PF_AUDIT = [
  ["age", "Age", "m", (t) => t.age / 60_000], ["top10", "Top 10 Holders %", "%", (t) => t.hl?.t10 ?? t.top10 ?? null], ["dev", "Dev Holding %", "%", (t) => t.hl?.dev ?? t.dev ?? null],
  ["snipers", "Snipers %", "%", (t) => t.hl?.sn ?? null], ["insiders", "Insiders %", "%", (t) => t.insiders], ["bundle", "Bundle %", "%", (t) => t.hl?.bd ?? null],
  ["holders", "Holders", "", (t) => t.hl?.h ?? t.holders ?? t.traders], ["pro", "Pro Traders", "", null], ["devMig", "Dev Migrations", "", null],
  ["devPairs", "Dev Pairs Created", "", (t) => t.devCount ?? null], ["safety", "Safety Score", "", (t) => t.safety], ["ai", "AI Score", "", (t) => t.ai?.rated ? t.ai.score : null],
];
const PF_METRICS = [
  ["liq", "Liquidity ($)", "$", (t) => t.liq], ["vol", "Volume ($)", "$", (t) => t.vol ?? t.liveVol], ["mcap", "Market Cap ($)", "$", (t) => t.mcap ?? (t.startMcapSol ? t.startMcapSol * (pulseState.sol || 150) : null)],
  ["curve", "B. curve %", "%", (t) => t.graduated ? 100 : t.progress != null ? t.progress * 100 : null], ["fees", "Global Fees Paid (SOL)", "SOL", null],
  ["txns", "Txns", "", (t) => (t.buys || 0) + (t.sells || 0)], ["buys", "Num Buys", "", (t) => t.buys ?? 0], ["sells", "Num Sells", "", (t) => t.sells ?? 0],
  ["traders", "Traders", "", (t) => t.traders ?? t.holders], ["devBuy", "Dev Buy (SOL)", "SOL", (t) => t.devSol ?? null],
];
const PF_SOCIAL_RANGES = [["xFollowers", "Twitter Followers", "", null], ["xFollowing", "Twitter Following", "", null], ["xReuse", "Twitter Reuses", "", null], ["xRenames", "X Renames", "", null], ["tweetAge", "Tweet Age", "h", null]];
const xInfo = (t) => {
  if (!t.x) return null;
  try { const u = new URL(t.x), seg = u.pathname.split("/").filter(Boolean); return { handle: seg[0] && seg[0] !== "i" ? seg[0].toLowerCase() : null, community: /\/i\/communities\//.test(u.pathname), profile: seg.length === 1 && seg[0] !== "i" }; } catch { return null; }
};
// [key, label, test(t)]; null test = no data source.
const PF_TOGGLES = [
  ["community", "Community", (t) => Boolean(xInfo(t)?.community)], ["paid", "Dex Paid", (t) => Boolean(t.paid)], ["twitter", "Twitter", (t) => Boolean(t.x)], ["website", "Website", (t) => Boolean(t.web)],
  ["telegram", "Telegram", (t) => Boolean(t.tg)], ["tiktok", "TikTok", (t) => Boolean(t.tiktok)], ["anySocial", "At Least One Social", (t) => Boolean(t.x || t.web || t.tg || t.tiktok)], ["pumpLive", "Only Pump Live", null],
  ["xProfile", "X profile only", (t) => Boolean(xInfo(t)?.profile)], ["noX", "No X link", (t) => !t.x], ["onlyX", "Only X, no other links", (t) => Boolean(t.x) && !t.web && !t.tg && !t.tiktok],
];
// GMGN's checkbox row, kept under Audit.
const PF_FLAGS = [
  ["devSold", "Dev Sell All", (t) => t.hl?.ds === "all" || (t.hl?.dev == null && t.dev != null && t.dev <= 0.01)], ["devHolds", "Dev Still Holding", (t) => t.hl?.dev != null ? t.hl.dev > 0.01 && t.hl.ds !== "all" : t.dev != null && t.dev > 0.01], ["noSlop", "Exclude Slop", (t) => t.tri?.label !== "slop" || Boolean(t.ai?.rated)],
  ["rated", "AI Rated Only", (t) => Boolean(t.ai?.rated)], ["safe", "Passed Safety Only", (t) => t.safety != null && !t.danger], ["origAvatar", "Original Avatar", null], ["origSocials", "Original Socials", null], ["noWash", "Exclude Wash Trading", null], ["devBurnt", "Dev Burnt", null],
];
const PF_RANGES = [...PF_AUDIT, ...PF_METRICS, ...PF_SOCIAL_RANGES];
const PF_BOOLS = [...PF_TOGGLES, ...PF_FLAGS];
// Where a coin was launched and where it trades now.
function protoOf(t) {
  const m = t.mint || "", d = String(t.dex || "").toLowerCase(), out = new Set();
  // The live trade feed decodes the pump.fun program only, so anything it has priced is a pump.fun coin.
  if (/pump$/.test(m) || t.pool === "pump" || d === "pumpfun" || d === "pumpswap" || t.live || t.lastTrade || (!t.pool && (t.startMcapSol != null || t.devSol != null))) out.add("Pump");
  if (/bonk$/.test(m) || t.pool === "bonk") out.add("Bonk");
  if (/BAGS$/.test(m) || d === "bags") out.add("Bags");
  if (/moon$/.test(m) || d === "moonshot") out.add("Moonshot");
  if (/jups$/.test(m)) out.add("Jupiter Studio");
  if (/BLV$/.test(m)) out.add("Believe");
  if (d === "launchlab" || t.pool === "launchlab") out.add("LaunchLab");
  if (d === "meteoradbc") out.add("Dynamic BC");
  if (d === "pumpswap") out.add("PumpSwap");
  if (d === "raydium") out.add("Raydium");
  if (d === "meteora") out.add("Meteora AMM");
  if (d === "orca") out.add("Orca");
  if (!out.size) out.add("Other");
  return out;
}
// Where a coin was launched, where it trades now, and the chain: the labels on every row and sheet.
const PROTO_META = { Pump: ["pump", "PUMP", "pump.fun"], Bonk: ["bonk", "BONK", "letsbonk.fun (Raydium LaunchLab)"], Bags: ["bags", "BAGS", "Bags"], Moonshot: ["moon", "MOON", "Moonshot"], "Jupiter Studio": ["jup", "JUP", "Jupiter Studio"], Believe: ["blv", "BLV", "Believe"], LaunchLab: ["llab", "LLAB", "Raydium LaunchLab"], "Dynamic BC": ["dbc", "DBC", "Meteora dynamic bonding curve"] };
const VENUE_META = { pumpswap: ["pumpswap", "PumpSwap", "PSWAP"], raydium: ["raydium", "Raydium", "RAY"], meteora: ["meteora", "Meteora", "MET"], orca: ["orca", "Orca", "ORCA"] };
function protoInfo(t) {
  const set = protoOf(t), launch = [...set].find((p) => PROTO_META[p]) || null;
  const [slug, tag, full] = PROTO_META[launch] || ["other", "?", "unknown launchpad"];
  const d = String(t.dex || "").toLowerCase();
  const venue = t.graduated || VENUE_META[d] ? (VENUE_META[d] || [d || "amm", DEX_NAME[d] || d || "an AMM", (DEX_NAME[d] || d || "AMM").slice(0, 6).toUpperCase()]) : null;
  return { launch, slug, tag, full, venue, where: venue ? venue[1] : launch ? `the ${full} bonding curve` : DEX_NAME[d] || "its bonding curve", chain: "Solana" };
}
function protoChips(t) {
  const i = protoInfo(t);
  return `<span class="proto p-${i.slug}" title="Launched on ${esc(i.full)} · trades on ${esc(i.where)} · ${i.chain}">${i.tag}</span>${i.venue ? `<span class="proto v-${i.venue[0]}" title="Bonded: now trades on ${esc(i.venue[1])}">${esc(i.venue[2] || i.venue[1])}</span>` : ""}<span class="proto chain" title="${i.chain}">SOL</span>`;
}
const pfBlank = () => ({ new: {}, running: {}, stretch: {}, migrated: {} });
// The three saved sets start from what pump.fun traders actually run on Axiom and GMGN (see the
// guides linked in design.md): P1 Clean = the common "skip the farmed coins" set (Pump/Bonk only, snipers
// under 10%, dev under 10%, bundle under 20%, a social, a $5k floor; 80+ holders and top-10 under 30% near
// bonding; top-10 under 20% after it). P2 Degen loosens every line; P3 Strict tightens them and wants
// an X link. Any slot can be rewritten; the Recommended button in the filter window puts these back.
const PF_RECOMMENDED = [
  { new: { protocols: ["Pump", "Bonk"], snipersMax: 10, devMax: 10, bundleMax: 20, mcapMin: 5000, volMin: 500, anySocial: true, devPairsMax: 3, noSlop: true },
    running: { snipersMax: 15, devMax: 10, bundleMax: 25, top10Max: 30, holdersMin: 20, noSlop: true },
    stretch: { holdersMin: 80, top10Max: 30, devMax: 5, snipersMax: 15, curveMin: 70, noSlop: true },
    migrated: { top10Max: 20, holdersMin: 100, devMax: 5, liqMin: 10000, ageMax: 60, noSlop: true } },
  { new: { protocols: ["Pump", "Bonk"], snipersMax: 20, devMax: 15, bundleMax: 35, mcapMin: 4000 },
    running: { top10Max: 40 },
    stretch: { holdersMin: 40, top10Max: 40, curveMin: 60 },
    migrated: { top10Max: 30, holdersMin: 50 } },
  { new: { protocols: ["Pump"], snipersMax: 5, devMax: 5, bundleMax: 10, mcapMin: 8000, volMin: 2000, anySocial: true, twitter: true, devPairsMax: 1, holdersMin: 15, noSlop: true },
    running: { snipersMax: 10, devMax: 5, bundleMax: 15, top10Max: 25, holdersMin: 40, noSlop: true },
    stretch: { holdersMin: 150, top10Max: 25, devMax: 3, snipersMax: 10, bundleMax: 15, curveMin: 80, volMin: 20000, noSlop: true },
    migrated: { top10Max: 18, holdersMin: 200, devMax: 2, liqMin: 20000, volMin: 50000, ageMax: 45, noSlop: true } },
];
const PF_SLOT_NAMES = ["Clean", "Degen", "Strict"];
const pfStored = store.get("pulse:pf:slots", null);
const pfAllBlank = !pfStored || pfStored.every((s) => Object.values(s || {}).every((c) => !Object.keys(c || {}).length));
const pf = { slot: store.get("pulse:pf:slot", 0), slots: (pfAllBlank ? structuredClone(PF_RECOMMENDED) : pfStored).map((s) => ({ ...pfBlank(), ...s })), col: "new", tab: "protocols", draft: null, more: false, io: false };
const pfSet = (col) => pf.slots[pf.slot][col] || {};
const pfSave = () => { store.set("pulse:pf:slots", pf.slots); store.set("pulse:pf:slot", pf.slot); };
const pfHas = (v) => v !== undefined && v !== "" && v != null;
const pfWords = (s) => String(s || "").toLowerCase().split(",").map((w) => w.trim().replace(/^@/, "")).filter(Boolean);
// How many filters are on, by section (the little numbers next to each tab).
function pfCount(f, part) {
  const ranges = (list) => list.filter(([k]) => pfHas(f[k + "Min"]) || pfHas(f[k + "Max"])).length;
  const bools = (list) => list.filter(([k]) => f[k]).length;
  const n = { protocols: f.protocols ? 1 : 0, audit: ranges(PF_AUDIT) + bools(PF_FLAGS) + (pfWords(f.devWallets).length ? 1 : 0), metrics: ranges(PF_METRICS), socials: ranges(PF_SOCIAL_RANGES) + bools(PF_TOGGLES) + (pfWords(f.handles).length ? 1 : 0) };
  if (part) return n[part];
  return n.protocols + n.audit + n.metrics + n.socials + (pfWords(f.kw).length ? 1 : 0) + (pfWords(f.xkw).length ? 1 : 0);
}
// Does a coin pass one column's filters? A coin with no reading for a filtered field is hidden, not assumed to pass.
function pfPass(t, f) {
  const text = `${t.symbol || ""} ${t.name || ""}`.toLowerCase();
  const kw = pfWords(f.kw), xkw = pfWords(f.xkw);
  if (kw.length && !kw.some((w) => text.includes(w))) return false;
  if (xkw.some((w) => text.includes(w))) return false;
  if (f.protocols) { const p = protoOf(t); if (!f.protocols.some((x) => p.has(x))) return false; }
  for (const [k, , , val] of PF_RANGES) {
    const lo = f[k + "Min"], hi = f[k + "Max"];
    if (!val || (!pfHas(lo) && !pfHas(hi))) continue;
    const v = val(t);
    // No reading yet (a coin seconds old, or a ledger that joined late) does not disqualify: Axiom and GMGN
    // filter on what is known, and hiding every unknown emptied the New pairs column for new visitors.
    if (v == null) continue;
    if ((pfHas(lo) && v < +lo) || (pfHas(hi) && v > +hi)) return false;
  }
  for (const [k, , test] of PF_BOOLS) if (f[k] && test && !test(t)) return false;
  const handles = pfWords(f.handles);
  if (handles.length && !handles.includes(xInfo(t)?.handle)) return false;
  const devs = pfWords(f.devWallets);
  if (devs.length && !devs.includes(String(t.creator || "").toLowerCase())) return false;
  return true;
}
function pulseFilter(list, col = "new") {
  const q = pulseState.q.toLowerCase(), f = pfSet(col), cq = (pulseState.cq[col] || "").toLowerCase();
  return list.filter((t) => {
    if (q && !`${t.symbol} ${t.name} ${t.mint}`.toLowerCase().includes(q)) return false;
    if (cq && !`${t.symbol} ${t.name}`.toLowerCase().includes(cq)) return false;
    if (!pfPass(t, f)) return false;
    // "Rated" means a finished grade. A coin that is only waiting in the queue has not been rated.
    const done = Boolean(t.ai?.rated), g = done ? GRADE_RANK[t.ai.grade] || 0 : 0;
    if (pulseState.min === "watch") return pulseState.watch.has(t.mint);
    if (pulseState.min === "noslop") return t.tri?.label !== "slop" || done;
    if (pulseState.min === "rated") return done;
    if (pulseState.min === "queue") return ["queued", "running"].includes(t.ai?.status) || (t.ai?.status === "deep");
    if (pulseState.min === "c") return done && g >= GRADE_RANK["C+"];
    if (pulseState.min === "b") return done && g >= GRADE_RANK.B;
    if (pulseState.min === "buy") return t.ai?.action === "buy";
    return true;
  });
}

// ----- the filter window -----
const PF_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>`;
function pfRange([k, label, unit, val], f) {
  const off = !val;
  return `<div class="pf-field ${off ? "off" : ""}" ${off ? 'title="No free data source for this one, so it is switched off rather than guessed."' : ""}><span>${label}</span>
    <div class="pf-mm"><label><input class="input num" type="number" step="any" placeholder="Min" data-pf="${k}Min" value="${esc(f[k + "Min"] ?? "")}" ${off ? "disabled" : ""}>${unit ? `<em>${unit}</em>` : ""}</label>
    <label><input class="input num" type="number" step="any" placeholder="Max" data-pf="${k}Max" value="${esc(f[k + "Max"] ?? "")}" ${off ? "disabled" : ""}>${unit ? `<em>${unit}</em>` : ""}</label></div></div>`;
}
const pfBool = ([k, label, test], f) => `<button class="pf-tog ${f[k] ? "on" : ""} ${test ? "" : "off"}" data-pfb="${k}" ${test ? "" : 'disabled title="No free data source for this one."'}>${label}</button>`;
function pfBody(f) {
  if (pf.tab === "protocols") {
    const on = (p) => !f.protocols || f.protocols.includes(p);
    return `<div class="pf-sec"><b>Protocols</b><button class="btn sm-btn" data-pfall>${f.protocols ? "Select All" : "Unselect All"}</button></div>
      <div class="pf-protos">${PF_PROTOCOLS.map((p) => `<button class="pf-proto ${on(p) ? "on" : ""}" data-pfp="${p}">${p}</button>`).join("")}
      ${pf.more ? PF_NO_SOURCE.map((p) => `<button class="pf-proto off" disabled title="Blix does not see this launchpad yet.">${p}</button>`).join("") : ""}</div>
      <button class="pf-more" data-pfmore>${pf.more ? "Show less" : `Show more <i>${PF_NO_SOURCE.length}</i>`}</button>
      <div class="pf-sec"><b>Quote Tokens</b></div>
      <div class="pf-protos">${["SOL", "USDC", "USD1", "STOCK", "OTHER"].map((q) => `<button class="pf-proto ${q === "SOL" ? "on" : "off"}" disabled title="Every coin Blix tracks is paired with SOL.">${q}</button>`).join("")}</div>`;
  }
  if (pf.tab === "audit") return `<div class="pf-flags">${PF_FLAGS.map((x) => pfBool(x, f)).join("")}</div><div class="pf-grid">${PF_AUDIT.map((x) => pfRange(x, f)).join("")}</div>
    <div class="pf-field wide"><span>Search Dev Wallet</span><input class="input" placeholder="wallet1, wallet2…" data-pf="devWallets" value="${esc(f.devWallets || "")}"></div>`;
  if (pf.tab === "metrics") return `<div class="pf-grid">${PF_METRICS.map((x) => pfRange(x, f)).join("")}</div>`;
  return `<div class="pf-flags">${PF_TOGGLES.map((x) => pfBool(x, f)).join("")}</div>
    <div class="pf-field wide"><span>Include Twitter Handles (up to 10, comma separated)</span><input class="input" placeholder="e.g. elonmusk, pumpdotfun…" data-pf="handles" value="${esc(f.handles || "")}"></div>
    <div class="pf-grid">${PF_SOCIAL_RANGES.map((x) => pfRange(x, f)).join("")}</div>`;
}
function pfRender() {
  let host = $("#pfm");
  // It leaves the way it arrived: shrinking back into the button that opened it.
  if (!pf.draft) { if (host) { host.classList.add("leave"); setTimeout(() => { if (!pf.draft) host.remove(); }, REDUCED.matches ? 0 : 170); } return; }
  if (!host) { host = document.createElement("div"); host.id = "pfm"; document.body.append(host); }
  host.classList.remove("leave");
  const f = pf.draft[pf.col];
  const badge = (n) => n ? `<i>${n}</i>` : "";
  const keep = host.querySelector(".pf-scroll")?.scrollTop || 0;
  host.innerHTML = `<div class="pf-back" data-pfclose></div><div class="pf-win" role="dialog" aria-label="Pulse Filters">
    <div class="pf-head"><h2>${PF_ICON} Pulse Filters</h2>
      <div class="pf-slots">${[0, 1, 2].map((i) => `<button class="${pf.slot === i ? "on" : ""}" data-pfslot="${i}" title="Saved filter set ${i + 1}">${i + 1}</button>`).join("")}</div>
      <button class="pf-ic" data-pfio title="Import / export these filters">⇅</button><button class="pf-ic" data-pfclose title="Close">✕</button></div>
    <div class="pf-cols">${PF_COLS.map(([k, l]) => `<button class="${pf.col === k ? "on" : ""}" data-pfcol="${k}">${l}${badge(pfCount(pf.draft[k]))}</button>`).join("")}
      <button class="pf-ic pf-reset" data-pfreset title="Clear this column's filters">↺</button></div>
    ${pf.io ? `<div class="pf-io"><textarea class="input" id="pfio" spellcheck="false">${esc(JSON.stringify(pf.draft))}</textarea><div><button class="btn sm-btn" data-pfcopy>Copy</button><button class="btn sm-btn" data-pfload>Load what is in the box</button></div></div>` : ""}
    <div class="pf-scroll">
      <div class="pf-kw"><label><span>Search Keywords</span><input class="input" placeholder="keyword1, keyword2…" data-pf="kw" value="${esc(f.kw || "")}"></label>
        <label><span>Exclude Keywords</span><input class="input" placeholder="keyword1, keyword2…" data-pf="xkw" value="${esc(f.xkw || "")}"></label></div>
      <div class="pf-tabs">${[["protocols", "Protocols"], ["audit", "Audit"], ["metrics", "$ Metrics"], ["socials", "Socials"]].map(([k, l]) => `<button class="${pf.tab === k ? "on" : ""}" data-pftab="${k}">${l}${badge(pfCount(f, k))}</button>`).join("")}</div>
      <div class="pf-body">${pfBody(f)}</div>
    </div>
    <div class="pf-foot"><span class="dim">Greyed-out fields have no free data source. A coin with no reading yet for a field passes it.</span><button class="btn sm-btn" data-pfrec title="Put back the researched ${PF_SLOT_NAMES[pf.slot]} set in this slot (Axiom and GMGN guide settings for pump.fun)">Recommended: ${PF_SLOT_NAMES[pf.slot]}</button><button class="btn primary" data-pfapply>Apply All</button></div></div>`;
  host.querySelector(".pf-scroll").scrollTop = keep;
  if (pf.origin) host.querySelector(".pf-win").style.transformOrigin = pf.origin;
}
function pfOpen(col) {
  pf.draft = structuredClone(pf.slots[pf.slot]); pf.col = col || pf.col; pf.io = false; pf.origin = null;
  pfRender();
  // Grow out of the button that was pressed, so it is obvious what this window belongs to.
  const b = $(`#pfbtn-${pf.col}`)?.getBoundingClientRect(), host = $("#pfm"), w = host.querySelector(".pf-win"), r = w.getBoundingClientRect();
  if (b) { pf.origin = `${(b.left + b.width / 2 - r.left).toFixed(0)}px ${(b.top + b.height / 2 - r.top).toFixed(0)}px`; w.style.transformOrigin = pf.origin; }
  host.classList.add("enter");
  setTimeout(() => host.classList.remove("enter"), 320);
}
function pfApply(close = true) {
  if (pf.draft) pf.slots[pf.slot] = structuredClone(pf.draft);
  pfSave();
  if (close) { pf.draft = null; pfRender(); }
  pfHeads(); pulseState.first = true; pulseTick();
}
// The column headers show the active slot and how many filters each column has on.
function pfHeads() {
  for (const [k] of PF_COLS) {
    const b = $(`#pfbtn-${k}`); if (!b) continue;
    const n = pfCount(pfSet(k));
    b.classList.toggle("on", n > 0); b.innerHTML = `${PF_ICON}${n ? `<i>${n}</i>` : ""}`;
  }
  document.querySelectorAll("[data-pslot]").forEach((b) => b.classList.toggle("on", +b.dataset.pslot === pf.slot));
}
document.addEventListener("click", (e) => {
  const el = e.target.closest?.("[data-pfopen],[data-pslot],#pfm button,#pfm .pf-back");
  if (!el) return;
  if (el.dataset.pfopen) return pfOpen(el.dataset.pfopen);
  if (el.dataset.pslot != null) { pf.slot = +el.dataset.pslot; pfSave(); pfHeads(); pulseState.first = true; return pulseTick(); }
  const d = el.dataset, f = pf.draft?.[pf.col];
  if (!f) return;
  if ("pfclose" in d) { pf.draft = null; return pfRender(); }
  if ("pfapply" in d) return pfApply();
  if (d.pfslot != null) { pf.slot = +d.pfslot; pf.draft = structuredClone(pf.slots[pf.slot]); pfApply(false); }
  else if (d.pfcol) pf.col = d.pfcol;
  else if (d.pftab) pf.tab = d.pftab;
  else if ("pfreset" in d) pf.draft[pf.col] = {};
  else if ("pfrec" in d) { pf.draft = structuredClone(PF_RECOMMENDED[pf.slot] || PF_RECOMMENDED[0]); toast(`${PF_SLOT_NAMES[pf.slot]} set loaded. Press Apply All to use it.`); }
  else if ("pfmore" in d) pf.more = !pf.more;
  else if ("pfio" in d) pf.io = !pf.io;
  else if ("pfcopy" in d) { navigator.clipboard?.writeText(JSON.stringify(pf.draft)); toast("Filters copied"); return; }
  else if ("pfload" in d) {
    try { const j = JSON.parse($("#pfio").value); pf.draft = { new: j.new || {}, running: j.running || {}, stretch: j.stretch || {}, migrated: j.migrated || {} }; toast("Filters loaded. Press Apply All to use them."); }
    catch { return toast("That is not a filter export"); }
  }
  else if ("pfall" in d) { if (f.protocols) delete f.protocols; else f.protocols = []; }
  else if (d.pfp) {
    const cur = new Set(f.protocols || PF_PROTOCOLS);
    cur.has(d.pfp) ? cur.delete(d.pfp) : cur.add(d.pfp);
    if (cur.size === PF_PROTOCOLS.length) delete f.protocols; else f.protocols = PF_PROTOCOLS.filter((p) => cur.has(p));
  }
  else if (d.pfb) { if (f[d.pfb]) delete f[d.pfb]; else f[d.pfb] = true; }
  else return;
  pfRender();
});
document.addEventListener("input", (e) => {
  const k = e.target.dataset?.pf;
  if (k && pf.draft && e.target.closest("#pfm")) {
    const f = pf.draft[pf.col], v = e.target.value.trim();
    if (v === "") delete f[k]; else f[k] = e.target.type === "number" ? +v : v;
    // Refresh the little counters without redrawing the field being typed in.
    document.querySelectorAll("#pfm [data-pfcol]").forEach((b) => { const n = pfCount(pf.draft[b.dataset.pfcol]); b.querySelector("i")?.remove(); if (n) b.insertAdjacentHTML("beforeend", `<i>${n}</i>`); });
    document.querySelectorAll("#pfm [data-pftab]").forEach((b) => { const n = pfCount(f, b.dataset.pftab); b.querySelector("i")?.remove(); if (n) b.insertAdjacentHTML("beforeend", `<i>${n}</i>`); });
  }
  const cq = e.target.dataset?.pcq;
  if (cq) { pulseState.cq[cq] = e.target.value.trim(); pulseState.first = true; pulseTick(); }
});
document.addEventListener("keydown", (e) => {
  if (!pf.draft) return;
  if (e.key === "Escape") { pf.draft = null; pfRender(); }
  if (e.key === "Enter" && e.target.closest?.("#pfm") && e.target.tagName === "INPUT") pfApply();
});

// Patch a column in place: new rows slide in, changed rows flash, order follows the data.
// Cheap by design: a row's template is only rebuilt when something other than its live numbers changed
// (those arrive every 200ms through the stream and are written straight into the row); rows are found
// through pulseState.rows, never by searching the DOM.
const VOLATILE = new Set(["mcap", "buys", "sells", "liveVol", "traders", "progress", "chg1m", "side", "lastTrade", "age", "hl", "live", "priceT", "chg5", "chg1h", "vol", "vol5m", "peak", "tr", "win"]);
function rowSig(t) {
  let s = "";
  for (const k in t) if (!VOLATILE.has(k)) { const v = t[k]; s += k + "=" + (v && typeof v === "object" ? JSON.stringify(v) : v) + ";"; }
  return s;
}
// The parts of a row that move with the data but are not in the live stream: rank, the 5-minute window,
// volume and the market cap of coins the stream does not price.
function softUpdate(el, t) {
  const rk = el.querySelector(".rk");
  if (rk && t.tr != null) { const txt = String(t.tr); if (rk.textContent !== txt) rk.textContent = txt; rk.className = `rk ${t.tr >= 60 ? "hi" : t.tr >= 40 ? "mid" : "lo"}`; }
  if (!t.live || pulseState.polling) {
    const mc = el.querySelector(".lv-mc"), mcTxt = t.mcap ? compact(t.mcap) : t.startMcapSol ? compact(t.startMcapSol * (pulseState.sol || 150)) : "—";
    if (mc && mc.textContent !== mcTxt && (pulseState.polling || !mc.dataset.v)) { const prev = Number(mc.dataset.v || 0); mc.textContent = mcTxt; if (pulseState.polling && t.mcap) { flash(mc, t.mcap >= prev); mc.dataset.v = t.mcap; } }
    if (pulseState.polling && t.hl) applyHolders(el, t.hl.h, t.hl.t10, t.hl.dev, t.hl.ds === "all" ? 2 : t.hl.ds === "part" ? 1 : 0, t.hl.sn, t.hl.bd);
    if (pulseState.polling && t.live) { const tr = el.querySelector(".lv-tr"); if (tr && t.traders != null) tr.textContent = t.traders; const tx = el.querySelector(".lv-tx"); if (tx) tx.textContent = (t.buys || 0) + (t.sells || 0); const c = el.querySelector(".lv-chg"); if (c && t.chg1m != null) { c.textContent = pct(t.chg1m); c.className = `num lv-chg ${cls(t.chg1m)}`; } const pp = el.querySelector(".lv-pct"); if (pp && t.progress != null) { pp.textContent = `${Math.round(t.progress * 100)}%`; el.style.setProperty("--ring", Math.round(t.progress * 100)); } }
    const v = el.querySelector(".lv-v"), vTxt = compact(t.vol ?? t.liveVol);
    if (v && v.textContent !== vTxt) v.textContent = vTxt;
    const c5 = el.querySelector(".lv-c5");
    if (c5 && t.chg5 != null) { const txt = pct(t.chg5); if (c5.textContent !== txt) { c5.textContent = txt; c5.className = `num lv-c5 ${cls(t.chg5)}`; } }
  }
  const w = el.querySelector(".sc.win");
  if (w && t.win) { const txt = `5m${t.win.traders}w${t.win.netSol >= 0 ? "+" : ""}${t.win.netSol}SOL${t.win.chg != null ? `${t.win.chg >= 0 ? "+" : ""}${t.win.chg}%` : ""}`; if (w.dataset.k !== txt) { w.dataset.k = txt; w.innerHTML = `5m<b>${t.win.traders}w</b><b>${t.win.netSol >= 0 ? "+" : ""}${t.win.netSol}</b>SOL${t.win.chg != null ? `<b class="${cls(t.win.chg)}">${t.win.chg >= 0 ? "+" : ""}${t.win.chg}%</b>` : ""}`; w.classList.toggle("bad", t.win.netSol < 0); } }
}
function patchColumn(el, list, col) {
  const seen = new Set();
  let prev = null;
  for (const t of list) {
    seen.add(t.mint);
    const key = `${col}:${t.mint}`;
    const old = pulseState.rows.get(key);
    let node = old?.el?.isConnected ? old.el : null;
    const sig = rowSig(t);
    if (!node) {
      const wrap = document.createElement("div");
      wrap.innerHTML = pulseRow(t, col);
      node = wrap.firstElementChild;
      if (!pulseState.first) { node.classList.add("enter"); const n = node; setTimeout(() => n.classList.remove("enter"), 700); }
    } else if (old.sig !== sig) {
      const graded = old.status !== t.ai?.status && ["done", "deep"].includes(t.ai?.status);
      const wrap = document.createElement("div");
      wrap.innerHTML = pulseRow(t, col);
      const fresh = wrap.firstElementChild;
      // Keep the already-loaded picture instead of reloading it on every update.
      const oldAv = node.querySelector(".pr-av img"), newAv = fresh.querySelector(".pr-av img");
      if (oldAv && newAv) newAv.replaceWith(oldAv);
      if (graded) { fresh.classList.add("graded"); if (t.ai?.action === "buy") beep("buy"); }
      node.replaceWith(fresh);
      node = fresh;
    } else softUpdate(node, t);
    pulseState.rows.set(key, { sig, el: node, status: t.ai?.status, born: Date.now() - (t.age || 0), ageTxt: null });
    if (prev ? prev.nextElementSibling !== node : el.firstElementChild !== node) {
      if (prev) prev.after(node); else el.prepend(node);
    }
    prev = node;
  }
  for (const n of [...el.children]) if (!seen.has(n.dataset.mint)) { n.remove(); pulseState.rows.delete(`${col}:${n.dataset.mint}`); }
  if (!list.length && !el.querySelector(".empty")) el.innerHTML = empty("Nothing here", col === "new" ? "Launches stream in every second." : "Updates live.");
}
// Every row element currently showing a coin, from the index (no DOM search).
function rowsFor(mint) {
  const out = [];
  for (const col of COLS) { const r = pulseState.rows.get(`${col}:${mint}`); if (r?.el?.isConnected) out.push(r.el); }
  return out;
}

async function pulseTick() {
  if (route() !== "" ) { clearInterval(pulseState.timer); pulseState.timer = null; return; }
  if (document.hidden || pulseState.tab !== "new") return;
  const d = await api("pulse").catch(() => null);
  if (!d || !$("#pcol-new")) return;
  pulseState.ai = d.live.ai;
  const cols = { new: d.newPairs, stretch: d.stretch, migrated: d.migrated, running: d.running || [] };
  for (const [k, list] of Object.entries(cols)) {
    const f = sortRows(pulseFilter(list, k), k);
    const colEl = $(`#pcol-${k}`);
    if (!colEl) continue;
    if (colEl.querySelector(".empty") && f.length) colEl.innerHTML = "";
    patchColumn(colEl, f, k === "running" ? "stretch" : k);
    $(`#pcount-${k}`).textContent = f.length === list.length ? f.length : `${f.length} of ${list.length}`;
    const reading = list.filter((t) => t.ai?.status === "running").length;
    $(`#prating-${k}`).innerHTML = reading ? `<i></i>${reading}` : "";
    $(`#prating-${k}`).title = reading ? `${reading} being rated by the AI right now` : "";
  }
  pulseState.first = false;
  paperButtons();
  const L = d.live;
  pulseState.sol = L.solUsd;
  deskTick();
  const T = L.triage || {};
  const warn = $("#pulseWarn");
  const A = L.ai || {}, Q = L.queue || {};
  const reader = A.fast || A.deep || "No AI";
  // One short line: what broke, who is reading instead, and what that costs. The detail lives on Health.
  const why = [...new Set([A.fastFallback, A.deepFallback].filter(Boolean))];
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  if (warn) warn.innerHTML = why.length ? `<div class="card lane-note" style="margin-bottom:12px;border-color:rgba(255,84,112,.4)"><b>AI is running on fallbacks.</b> ${why.map((x) => esc(cap(x))).join("; ")}. First reads: <b>${esc(A.fast || "none, coins wait for a deep read")}</b>. Deep reads: <b>${esc(A.deep || "none")}</b>${A.deep === "Claude" ? " (no live X search)" : ""}.${T.provider === "groq" || T.provider === "grok" ? "" : " New launches are ranked by the instant rules only."} <a class="linkish" href="#/health">What to do</a></div>` : "";
  // The triage ranker and the research reader are named from what actually ran, never assumed.
  const ranker = T.provider === "groq" ? "Groq" : T.provider === "grok" ? "Grok fast" : "instant rules";
  $("#pulseLive").innerHTML = `<span class="${L.feed ? "feed-on" : ""}"><i class="dot"></i><b class="num">${L.tradesPerSec}</b> trades/s</span><span><b class="num">${L.launchesPerMin}</b> launches/min</span><span title="${esc(T.lastError || "")}"><b class="num">${T.coins || 0}</b> ranked by ${ranker}${T.lastMs ? ` · ${(T.lastMs / 1000).toFixed(1)}s/batch` : ""} · <b class="num">${T.escalated || 0}</b> sent to research</span><span class="${L.running ? "hot" : ""}"><b class="num">${L.running}</b> ${esc(reader)} reading now</span><span title="Coins waiting for a first read. The queue is capped at ${Q.cap ?? "?"}; older and weaker ones are dropped."><b class="num">${Q.size ?? L.queued}</b> queued${Q.size ? ` · oldest ${Q.oldestMin}m` : ""}</span><span><b class="num">${L.ratedHour}</b> rated this hour</span>`;
}

// A price flash through the Web Animations API: no class juggling and no forced reflow per tick.
const FLASH = { up: null, down: null };
function flash(el, up) {
  if (!el || !el.animate) return;
  if (!FLASH.up) {
    const cs = getComputedStyle(document.documentElement);
    FLASH.up = [{ background: `color-mix(in oklch, ${cs.getPropertyValue("--color-up").trim()} 45%, transparent)`, color: cs.getPropertyValue("--color-ink").trim() }, { background: "transparent" }];
    FLASH.down = [{ background: `color-mix(in oklch, ${cs.getPropertyValue("--color-down").trim()} 45%, transparent)`, color: cs.getPropertyValue("--color-ink").trim() }, { background: "transparent" }];
  }
  for (const a of el.getAnimations()) a.cancel();
  el.animate(up ? FLASH.up : FLASH.down, { duration: 600, easing: "ease-out" });
}

// Live trade numbers pushed by the server every 200ms, with the holder ledger's figures after them.
function applyLive(u) {
  for (const [mint, mc, buys, sells, vol, traders, prog, side, chg, h, t10, dev, ds, sn, bd] of u) {
    for (const row of rowsFor(mint)) {
      if (!row.closest("#pcol-migrated")) applyHolders(row, h, t10, dev, ds, sn, bd);
      const mcEl = row.querySelector(".lv-mc");
      if (mcEl) {
        const txt = compact(mc);
        if (mcEl.textContent !== txt) { const prev = Number(mcEl.dataset.v || 0); mcEl.textContent = txt; flash(mcEl, mc >= prev); }
        mcEl.dataset.v = mc;
      }
      const tx = buys + sells;
      const txw = row.querySelector(".lv-txw");
      if (txw && !row.closest("#pcol-migrated")) {
        txw.hidden = false;
        const txEl = row.querySelector(".lv-tx");
        if (txEl.textContent !== String(tx)) { txEl.textContent = tx; flash(txEl, side === "b"); }
        row.querySelector(".lv-bs").style.width = `${Math.round((buys / Math.max(tx, 1)) * 100)}%`;
      }
      const v = row.querySelector(".lv-v");
      if (v && !row.closest("#pcol-migrated")) v.textContent = compact(vol);
      const tr = row.querySelector(".lv-tr");
      if (tr) tr.textContent = traders;
      const c = row.querySelector(".lv-chg");
      if (c && chg != null) { c.textContent = pct(chg); c.className = `num lv-chg ${cls(chg)}`; }
      if (!row.closest("#pcol-migrated")) {
        row.style.setProperty("--ring", Math.round(prog * 100));
        const p = row.querySelector(".lv-pct");
        if (p) p.textContent = `${Math.round(prog * 100)}%`;
      }
      row.classList.add("is-live");
      row.classList.remove("faded");
      row.classList.toggle("buying", side === "b");
      row.classList.toggle("selling", side === "s");
    }
  }
}

// Migrated coins: fresh prices every few seconds while the page is open.
function applyMig(u) {
  for (const [mint, mc] of u) {
    const row = pulseState.rows.get(`migrated:${mint}`)?.el;
    const mcEl = row?.isConnected ? row.querySelector(".lv-mc") : null;
    if (!mcEl) continue;
    const txt = compact(mc), prev = Number(mcEl.dataset.v || 0);
    if (mcEl.textContent !== txt) { mcEl.textContent = txt; if (prev) flash(mcEl, mc >= prev); }
    mcEl.dataset.v = mc;
    row.classList.toggle("buying", prev > 0 && mc > prev);
    row.classList.toggle("selling", prev > 0 && mc < prev);
    row.classList.add("is-live");
  }
}

// The holder chips on one row: shown the moment the ledger has a figure, flagged when it crosses a line.
function applyHolders(row, h, t10, dev, ds, sn, bd) {
  const set = (k, v, fmt, bad) => {
    if (v == null) return;
    const w = row.querySelector(`.lv-${k}w`); if (!w) return;
    w.hidden = false; w.classList.toggle("down", Boolean(bad));
    const b = w.querySelector(`.lv-${k}`), txt = fmt(v);
    if (b && b.textContent !== txt) b.textContent = txt;
  };
  set("h", h, String, false);
  if (h != null) { const tr = row.querySelector(".lv-trw"); if (tr) tr.hidden = true; }
  set("t10", t10, (v) => String(Math.round(v)), t10 > 45);
  set("dev", dev, (v) => (+v).toFixed(1), dev > 8);
  if (dev != null) { const d = row.querySelector(".lv-devsol"); if (d) d.hidden = true; }
  // No snipers or no bundle is the normal case: those chips only appear once there is something to show.
  set("sn", sn > 0 || !row.querySelector(".lv-snw")?.hidden ? sn : null, String, sn > 20);
  set("bd", bd > 0 || !row.querySelector(".lv-bdw")?.hidden ? bd : null, String, bd > 15);
  const dsEl = row.querySelector(".lv-ds");
  if (dsEl && ds != null) { dsEl.hidden = !ds; dsEl.textContent = ds === 2 ? "DEV SOLD" : "DEV SELLING"; }
}

// A brand-new coin: show it the instant it's created.
function applyLaunch(l) {
  const colEl = $("#pcol-new");
  if (!colEl || pulseState.tab !== "new" || pulseState.q || pulseState.cq.new || pulseState.min !== "all" || pfCount(pfSet("new")) || pulseState.sort.new) return;
  if (pulseState.rows.get(`new:${l.mint}`)?.el?.isConnected) return;
  colEl.querySelector(".empty")?.remove();
  pulseState.sol = l.solUsd || pulseState.sol;
  const t = { ...l, age: 0, state: "watching", startMcapSol: l.mcapSol };
  const wrap = document.createElement("div");
  wrap.innerHTML = pulseRow(t, "new");
  const node = wrap.firstElementChild;
  node.classList.add("enter");
  setTimeout(() => node.classList.remove("enter"), 700);
  colEl.prepend(node);
  pulseState.rows.set(`new:${l.mint}`, { sig: rowSig(t), el: node, status: null, born: Date.now(), ageTxt: "0s" });
  while (colEl.children.length > 160) { const last = colEl.lastElementChild; pulseState.rows.delete(`new:${last.dataset.mint}`); last.remove(); }
  const n = $("#pcount-new"); if (n) n.textContent = colEl.children.length;
}

// Ages tick every second, written only when the text actually changes (most rows change once a minute).
setInterval(() => {
  if (route() !== "" || document.hidden) return;
  const now = Date.now();
  for (const r of pulseState.rows.values()) {
    if (!r.el?.isConnected) continue;
    const txt = ageStr(now - r.born);
    if (txt === r.ageTxt) continue;
    const a = r.el.querySelector(".pr-age");
    if (a) { a.textContent = txt; r.ageTxt = txt; }
  }
}, 1000);

// ---------- terminal: sort, selection, watchlist, sound, the paper desk ----------
const SORTS = [["", "Sort: feed"], ["age", "Newest"], ["mcap", "Mcap"], ["vol", "Volume"], ["traders", "Traders"], ["holders", "Holders"], ["chg", "1m %"], ["prog", "Bond %"], ["ai", "AI %"]];
const sortVal = {
  age: (t) => -(t.age || 0), mcap: (t) => t.mcap ?? (t.startMcapSol ? t.startMcapSol * (pulseState.sol || 150) : -1), vol: (t) => t.vol ?? t.liveVol ?? -1, traders: (t) => t.traders ?? t.holders ?? -1,
  holders: (t) => t.hl?.h ?? t.holders ?? t.traders ?? -1, chg: (t) => t.chg1m ?? t.chg5 ?? -1e9, prog: (t) => t.graduated ? 1 : t.progress ?? -1, ai: (t) => t.ai?.rated ? (t.ai.pwin ?? t.ai.score ?? 0) : -1,
};
function sortRows(list, col) {
  const k = pulseState.sort[col], f = sortVal[k];
  return f ? [...list].sort((a, b) => f(b) - f(a)) : list;
}

// Keyboard selection: one row at a time, kept by mint so it survives the 2-second redraw.
const COLS = ["new", "running", "stretch", "migrated"];
const selRow = () => pulseState.sel ? document.querySelector(".pcol-body .pr.sel") : null;
function setSel(node) {
  document.querySelectorAll(".pcol-body .pr.sel").forEach((n) => n.classList.remove("sel"));
  pulseState.sel = node?.dataset.mint || null;
  if (node) { node.classList.add("sel"); node.scrollIntoView({ block: "nearest" }); }
}
function moveSel(n) {
  const cur = selRow();
  if (!cur) return setSel(document.querySelector("#pcol-new .pr") || document.querySelector(".pcol-body .pr"));
  const next = n > 0 ? cur.nextElementSibling : cur.previousElementSibling;
  if (next?.classList.contains("pr")) setSel(next);
}
function moveCol(n) {
  const cur = selRow(), colEl = cur?.closest(".pcol-body");
  const i = Math.max(0, COLS.indexOf(colEl?.id.replace("pcol-", "")));
  const target = COLS[Math.max(0, Math.min(COLS.length - 1, i + n))];
  const idx = cur ? [...colEl.children].indexOf(cur) : 0;
  const rows = $(`#pcol-${target}`)?.querySelectorAll(".pr");
  if (rows?.length) setSel(rows[Math.min(Math.max(0, idx), rows.length - 1)]);
}

function toggleWatch(mint) {
  if (pulseState.watch.has(mint)) pulseState.watch.delete(mint); else pulseState.watch.add(mint);
  store.set("pulse:watch", [...pulseState.watch]);
  const on = pulseState.watch.has(mint);
  document.querySelectorAll(`.star[data-pwatch="${CSS.escape(mint)}"]`).forEach((b) => b.classList.toggle("on", on));
  document.querySelectorAll(`.pr[data-mint="${CSS.escape(mint)}"]`).forEach((r) => r.classList.toggle("watched", on));
  if (pulseState.min === "watch") { pulseState.first = true; pulseTick(); }
}

// A short tone for a buy call, a pick, or a paper exit; off unless the Sound chip is on.
let audioCtx = null;
function beep(kind = "buy") {
  if (!pulseState.sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
    o.type = "sine"; o.frequency.value = kind === "buy" ? 880 : kind === "sell" ? 440 : 660;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.2);
  } catch {}
}

const usdSigned = (n) => n == null ? "—" : `${n >= 0 ? "+" : "−"}$${Math.abs(n) >= 1000 ? (Math.abs(n) / 1000).toFixed(1) + "k" : Math.abs(n).toFixed(0)}`;
const srcName = { live: "live feed", jupiter: "Jupiter", dex: "DexScreener", radar: "radar", rule: "rule" };
const pendingPaper = new Set(), ruleDrafts = new Map();
function paperButtons() {
  document.querySelectorAll("[data-pbuy], [data-psell]").forEach(button => {
    const key = button.dataset.pbuy ? `buy:${button.dataset.pbuy}` : `sell:${button.dataset.psell}`;
    button.disabled = pendingPaper.has(key);
    button.setAttribute("aria-busy", String(button.disabled));
  });
}
async function paperBuy(mint, sol) {
  const key = `buy:${mint}`;
  if (pendingPaper.has(key)) return;
  pendingPaper.add(key); paperButtons();
  try {
    const r = await post("paper/quoted", { mint, sol });
    const p = r.position;
    toast(`Paper buy $${p.symbol || shortAddr(mint)} · ${p.sol} SOL at ${compact(p.mcap0)} mcap (${srcName[p.src] || p.src})`);
    beep("buy");
    pulseState.desk = r.desk; renderDesk();
  } catch (e) { toast(e.message); }
  finally { pendingPaper.delete(key); paperButtons(); }
}
async function paperSell(id, pct, why = "sold") {
  const key = `sell:${id}`;
  if (pendingPaper.has(key)) return;
  pendingPaper.add(key); paperButtons();
  try {
    const r = await post(`paper/${id}/sellq`, { pct, why });
    const p = r.position;
    toast(`Paper sell $${p.symbol || ""} · ${pct}% sold`);
    beep("sell");
    pulseState.desk = r.desk; renderDesk();
  } catch (e) { toast(e.message); }
  finally { pendingPaper.delete(key); paperButtons(); }
}
async function deskTick(force) {
  // The desk strip only needs a fresh read every few seconds unless the desk is open or positions are live.
  const live = $("#deskBody") || pulseState.desk?.summary?.open;
  if (!force && !live && Date.now() - (deskTick.last || 0) < 8000) return;
  deskTick.last = Date.now();
  const d = await api("paper").catch(() => null);
  if (!d) return;
  pulseState.desk = d;
  if (d.sizes?.length) pulseState.sizes = d.sizes;
  renderDesk();
}
function renderDesk() {
  const d = pulseState.desk; if (!d) return;
  const s = d.summary, el = $("#deskStrip");
  if (el) el.innerHTML = `<button class="desk-strip" data-pdesk title="The paper desk: open positions, P&L, exits (hotkey d)"><b>Desk</b><span class="num">${s.open} open</span><span class="num ${s.open ? cls(s.openPnl) : "dim"}">${s.open ? usdSigned(s.openPnl) : "—"}</span><span class="dim">today</span><span class="num ${s.todayN ? cls(s.todayPnl) : "dim"}">${s.todayN ? usdSigned(s.todayPnl) : "—"}</span>${s.todayN ? `<span class="dim">${s.todayWins}/${s.todayN}</span>` : ""}</button>`;
  const body = $("#deskBody");
  if (body && !body.contains(document.activeElement?.closest("input"))) {
    const top = $("#panel").scrollTop; body.outerHTML = deskHtml(d); $("#panel").scrollTop = top;
  }
  for (const id of ruleDrafts.keys()) if (!d.open?.some(p => String(p.id) === id)) ruleDrafts.delete(id);
  paperButtons();
}
function posRow(p) {
  const open = p.status === "open";
  const x = p.mult;
  const draft = ruleDrafts.get(String(p.id)) || {};
  const ruleValue = key => esc(draft[key] ?? p[key] ?? "");
  return `<div class="pos ${open ? "" : "closed"} ${x != null ? xCls(x) : ""}">
    <div class="pos-top"><span class="pos-coin" data-mint="${esc(p.mint)}">${av(p, "sm")}<b>$${esc(p.symbol || shortAddr(p.mint))}</b><small class="dim">${esc(p.name || "")}</small></span>
      <span class="num">${p.sol} SOL <small class="dim">$${Math.round(p.usd)}</small></span>
      <span class="num"><small class="dim">in</small> ${compact(p.mcap0)} <small class="dim">→</small> ${compact(p.mcapNow)}${open ? `<small class="dim ${p.stale ? "down" : ""}">${p.stale ? " no live price" : ` ${srcName[p.src] || p.src}`}</small>` : ""}</span>
      <b class="num pos-x ${x != null ? xCls(x) : ""}">${x != null ? mult(x) : "—"}</b><span class="num ${p.pnl != null ? cls(p.pnl) : ""}">${usdSigned(p.pnl)}</span>
      <small class="dim">${open ? `${ago(p.t)} · peak ${mult(p.peakX)} · low ${mult(p.lowX)}` : `${esc(p.exit_why || "")} · ${ago(p.exit_t)} ago`}</small></div>
    ${open ? `<div class="pos-acts"><label>TP <input class="input num" type="number" step="any" placeholder="x" value="${ruleValue("tp")}" data-prule-tp="${p.id}"></label><label>SL <input class="input num" type="number" step="any" placeholder="%" value="${ruleValue("sl")}" data-prule-sl="${p.id}"></label><label>Trail <input class="input num" type="number" step="any" placeholder="%" value="${ruleValue("trail")}" data-prule-trail="${p.id}"></label><button class="btn sm-btn" data-prule="${p.id}">Set rule</button>
      <span class="grow"></span><button class="btn sm-btn" data-psell="${p.id}" data-pct="50">Sell 50%</button><button class="btn sm-btn primary" data-psell="${p.id}" data-pct="100">Sell all</button></div>`
      : `<div class="pos-acts"><span class="grow"></span><button class="btn sm-btn" data-pdrop="${p.id}" title="Forget this closed position">Remove</button></div>`}
  </div>`;
}
function deskHtml(d) {
  const s = d.summary;
  return `<div id="deskBody">
    <div class="p-sec"><div class="facts">
      <div class="fact"><b>Open</b><span>${s.open} <small class="dim">· $${Math.round(s.openUsd)}</small></span></div>
      <div class="fact"><b>Open P&amp;L</b><span class="${s.open ? cls(s.openPnl) : ""} ${s.openUnpriced ? "unpriced" : ""}">${s.openUnpriced ? `Unavailable <small class="dim">· ${s.openUnpriced} unpriced</small>` : s.open ? usdSigned(s.openPnl) : "—"}</span></div>
      <div class="fact"><b>Today</b><span class="${s.todayN ? cls(s.todayPnl) : ""}">${s.todayN ? usdSigned(s.todayPnl) : "—"} <small class="dim">· ${s.todayWins}/${s.todayN} won</small></span></div>
      <div class="fact"><b>All time</b><span class="${s.allN ? cls(s.allPnl) : ""}">${s.allN ? usdSigned(s.allPnl) : "—"} <small class="dim">· ${s.allN} closed</small></span></div>
    </div><p class="note" style="margin:10px 0 0">Paper only: nothing is sent to the chain. New buys and manual sells use curve or Jupiter quotes, including fees and price impact. Live valuations and automatic exits may use estimates; older positions use a ${d.cost}% cost model each way. Sizes come from Settings (${d.sizes.join(" / ")} SOL); a new position starts with the exit rule set there${d.rule.tp || d.rule.sl || d.rule.trail ? ` (${[d.rule.tp && `TP ${d.rule.tp}x`, d.rule.sl && `SL −${d.rule.sl}%`, d.rule.trail && `trail ${d.rule.trail}%`].filter(Boolean).join(", ")})` : " (none)"}. Rule exits are checked every second.</p></div>
    <div class="p-sec"><h3>Open positions <span class="dim">· ${d.open.length}</span></h3>${d.open.length ? d.open.map(posRow).join("") : `<p class="note">None. Press <b>B</b> on any Pulse row, or the size buttons that appear when you hover one.</p>`}</div>
    <div class="p-sec"><h3>Closed <span class="dim">· last ${d.closed.length}</span></h3>${d.closed.length ? d.closed.map(posRow).join("") : `<p class="note">Nothing closed yet.</p>`}</div>
  </div>`;
}
async function openDesk() {
  const p = $("#panel");
  sheetOpen();
  p.innerHTML = `<div class="p-head"><h2>Paper desk</h2><button class="close" data-close aria-label="Close">✕</button></div><div id="deskBody"><div class="skel" style="margin:16px 24px"></div></div>`;
  await deskTick(true);
  p.scrollTop = 0;
}

// The live holder ledger on the coin page: who holds what, tagged dev / sniper / bundle.
function ledgerSection(h) {
  if (!h) return "";
  const flag = (bad, text) => `<span class="${bad ? "down" : ""}">${text}</span>`;
  const tagPill = (t) => t ? `<span class="pill tag-${t}">${t}</span>` : "";
  return `<div class="p-sec"><h3>Holders, live <span class="dim">· from the trade feed since ${ago(h.since)} ago · ${h.trades.toLocaleString()} trades</span></h3>
    <div class="facts">
      <div class="fact"><b>Holders</b><span>${h.holders.toLocaleString()}</span></div>
      <div class="fact"><b>Top 10 hold</b><span>${flag(h.top10 > 45, h.top10.toFixed(1) + "%")}</span></div>
      <div class="fact"><b>Dev holds</b><span>${h.dev ? `${flag(h.dev.pct > 8, h.dev.pct.toFixed(2) + "%")}${h.dev.sold ? ` <i class="hl-tag ds">${h.dev.sold === "all" ? "SOLD" : "SELLING"}</i>` : ""}` : "—"}</span><small class="dim">${h.dev?.seen ? `net ${h.dev.sol >= 0 ? "" : "−"}${Math.abs(h.dev.sol).toFixed(2)} SOL in` : h.dev ? "no trade seen" : "dev unknown"}</small></div>
      <div class="fact"><b>Snipers</b><span>${h.snipers ? `${flag(h.snipers.pct > 20, h.snipers.pct.toFixed(1) + "%")} <small class="dim">· ${h.snipers.n} wallets, ${h.snipers.sold} out</small>` : "—"}</span></div>
      <div class="fact"><b>Bundle</b><span>${h.bundle ? `${flag(h.bundle.pct > 15, h.bundle.pct.toFixed(1) + "%")} <small class="dim">· ${h.bundle.n} wallets in the launch block</small>` : "—"}</span></div>
    </div>
    ${h.partial ? `<p class="note" style="margin:10px 0 0">${h.genesis ? "Some sells were of tokens Blix never saw bought, so the figures are approximate." : "Blix joined this coin after its first trade, so holders are partial and sniper/bundle figures are not shown."}</p>` : ""}
    ${h.top.length ? `<div class="leaders" style="margin-top:10px">${h.top.map((w, i) => `<div class="leader" data-wallet="${esc(w.wallet)}"><span class="num dim" style="width:22px">${i + 1}</span>${wav(w.wallet, {}, "xs")}<span class="grow num">${shortAddr(w.wallet)} ${tagPill(w.tag)}</span><span class="num dim">${w.sol >= 0 ? "" : "−"}${Math.abs(w.sol).toFixed(2)} SOL</span><span class="num" style="width:62px;text-align:right">${w.pct.toFixed(2)}%</span></div>`).join("")}</div>` : ""}
  </div>`;
}
// Paper buys from the coin page, and what is already open or closed in this coin.
function paperSection(t, list) {
  return `<div class="p-sec"><h3>Paper desk</h3>
    <div class="chips">${pulseState.sizes.map((s) => `<button class="btn sm-btn" data-pbuy="${esc(t.mint)}" data-sol="${s}">Buy ${s} SOL</button>`).join("")}<button class="btn sm-btn" data-pdesk>Open the desk</button></div>
    ${list?.length ? list.map(posRow).join("") : `<p class="note" style="margin:8px 0 0">No paper position in this coin. Paper only: nothing is really bought.</p>`}
  </div>`;
}

// ---------- the bot: four tabs ----------
// 1 New pairs (everything, live) → 2 Anti-slop (the decent ones, being read by the AI) → 3 AI picks
// (rated well enough and safe: the list it thinks is worth buying) → 4 Today (how that list is doing).
// Nothing is bought. The list is a paper record you check at the end of the day.
const BOT_TABS = [["new", "New pairs"], ["anti", "Anti-slop"], ["picks", "AI picks"], ["today", "Today"]];
let botData = null;
const xCls = (x) => x == null ? "" : x >= 1 ? "up" : "down";
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function botTabs() {
  const n = botData ? { anti: botData.anti.reading.length + botData.anti.rated.length + botData.anti.fresh.length, picks: botData.day.picks.length, today: botData.day.ratedToday } : {};
  return BOT_TABS.map(([k, l], i) => `<button class="btab ${pulseState.tab === k ? "on" : ""}" data-ptab="${k}"><em>${i + 1}</em>${l}${n[k] != null ? `<span class="num">${n[k]}</span>` : ""}</button>`).join("");
}

function pickCard(p) {
  const state = p.unsellable ? '<span class="st bad" title="Its pool was emptied: it cannot be sold">can\'t be sold</span>' : p.dead ? '<span class="st dead">dead</span>' : "";
  return `<div class="pick ${p.now >= 1 ? "won" : "lost"}" data-mint="${esc(p.mint)}">
    <div class="pick-top">${av(p, "lg")}<div class="grow"><b>$${esc(p.symbol || "?")}</b> ${gradeBadge(p.grade)}<span class="num dim">${p.score}/100</span>${p.action ? actionBadge(p.action) : ""}${state}
      <div class="dim small">${esc(p.tag || p.name || "")} · entered ${clock(p.t)} (${ago(p.t)} ago) at ${money(p.entry)}${p.entryNote ? ` · ${esc(p.entryNote.replace(/^entered /, ""))}` : ""}${p.traction != null ? ` · traction ${p.traction}` : ""}${p.pwin != null ? ` · AI chance ${p.pwin}%` : ""}</div></div>
      <div class="pick-res"><span class="num ${xCls(p.now)}">${mult(p.now)}</span><small>now · ${money(p.mcapNow)}</small></div></div>
    <p>${esc(p.verdict || "")}</p>
    <div class="rule-line ${xCls(p.ruleX)}"><b>With the exit rule: ${mult(p.ruleX)}</b><span>${esc(p.ruleWhy)}${p.ruleClosed ? " · fully sold" : ""}</span></div>
    <div class="call-nums"><span><b>Peak since</b>${mult(p.peak)}</span><span><b>After 1h</b>${p.m1h != null ? mult(p.m1h) : "pending"}</span><span><b>Lowest</b>${mult(p.low)}</span><span><b>Safety</b>${p.safety ?? "—"}</span>
      ${p.unsellable ? "" : `<a class="fomo-q" href="${fomoUrl(p.mint)}" target="_blank" rel="noreferrer" title="Buy on Fomo">Fomo</a>`}</div>
  </div>`;
}

// Order for the rated list: live traction first, then the AI's own chance; anything it said to avoid sinks.
const tradeRank = (t) => (t.tr ?? 0) + (t.ai?.pwin ?? 0) * 0.6 + (t.ai?.action === "buy" ? 25 : t.ai?.action === "avoid" ? -60 : 0);

function botAnti(d) {
  const a = d.anti, L = d.live, Q = L.queue || {};
  const col = (title, sub, list, emptyT, emptyS) => `<section class="pcol"><header><h2>${title}</h2><span class="pcount num">${list.length}</span><small>${sub}</small></header>
    <div class="pcol-body">${list.length ? list.map((t) => pulseRow(t, "new")).join("") : empty(emptyT, emptyS)}</div></section>`;
  const reader = L.ai?.fast || L.ai?.deep || "No AI";
  return `<p class="bot-note">Launches that got past the slop filter. Each one is queued for ${esc(reader)}, read, and given a grade. About <b>${Q.perHour ?? "?"} reads an hour</b> are possible right now${Q.size ? `, ${Q.size} waiting (oldest ${Q.oldestMin}m)` : ""}; ${a.dropped} dropped unread today because they went stale before their turn.</p>
    <div class="pulse">${col("Decent, not sent yet", "passed the slop filter", a.fresh, "Nothing waiting", "New decent launches appear here first.")}
      ${col("Being read", `${esc(reader)} · ${L.running} now`, a.reading, "Queue is empty", "Coins move here once they are sent for a read.")}
      ${col("Rated today", "best trade first, live", [...a.rated].sort((x, y) => tradeRank(y) - tradeRank(x)), "No ratings yet today", "Grades appear here as reads finish.")}</div>`;
}

function botPicks(d) {
  const day = d.day;
  const r = day.rule;
  const w = day.watch || {};
  const wrow = (c, done) => `<div class="wrow ${done ? "off" : ""}" data-mint="${esc(c.mint)}"><b>$${esc(c.symbol || "?")}</b>${gradeBadge(c.grade)}<span class="num dim">${c.score ?? ""}</span>
    ${c.traction != null ? `<span class="trc ${c.traction >= 60 ? "hi" : "mid"}">▲${c.traction}</span>` : ""}${c.pwin != null ? `<span class="dim">AI ${c.pwin}%</span>` : ""}<span class="dim">rated at ${money(c.rated)}${done ? "" : ` · now ${money(c.mcap)} (${mult(c.mcap / c.rated)})`}</span><span class="grow wwhy">${esc(c.why || "")}</span>
    ${done ? `<span class="dim small">${c.dead ? "dead since" : c.since != null ? `${mult(c.since)} since` : ""} · ${clock(c.t)}</span>` : `<span class="dim small">${ago(c.t)} waiting · ${c.src === "live" ? "live feed" : c.src === "dex" ? "DexScreener" : "no price"}</span>`}</div>`;
  const watch = `<div class="card watch"><div class="card-head"><h2>Waiting for an entry</h2><small><span class="dot ${w.feed ? "ok" : "bad"}"></span>checked every second${w.lastT ? ` · last check ${Math.max(0, Math.round((Date.now() - w.lastT) / 1000))}s ago` : ""} · ${w.feed ? `live trade feed on, ${w.tradesPerSec}/s` : "live trade feed down, using DexScreener"}</small></div>
    ${day.watching.length ? day.watching.map((c) => wrow(c, false)).join("") : `<div class="dim small" style="padding:4px 2px">Nothing waiting. A coin lands here the second it clears the pick rule.</div>`}
    ${day.skipped.length ? `<details class="wskip"><summary>${day.skipped.length} turned down today</summary>${day.skipped.map((c) => wrow(c, true)).join("")}</details>` : ""}</div>`;
  return `<p class="bot-note">The pick rule: <b>traction ${day.gate.traction}+</b> (real money arriving right now), market cap ${money(day.gate.minMcap)}–${money(day.gate.maxMcap)}, the AI does not say avoid and gives it a ${day.gate.pwin}%+ chance of 2x before −40% (or calls it a buy), and it passes the safety check. <b>Coins in their first minutes</b> are picked on their first buyers instead (${day.gate.earlyTraders}+ different wallets, more buying than selling, an AI that would trade it), or on the launch model's signal alone once it has proven itself. A pick is not yet an entry: each one is watched <b>every second</b> and entered on the first second it is not falling, not more than ${r.chasePct}% above its rated price and not ${r.offHighPct}%+ off its high. It is dropped if it falls ${r.cancelPct}% first or gives no clean entry in ${r.waitMin} minutes. Each entry is then paper-sold by one fixed rule: <b>sell ${r.sellPct}% at ${r.takeProfit}x</b>, trail the rest ${r.trailPct}% below its high, stop out at −${r.stopPct}% before that, and sell anything left after ${r.maxHours}h. You get an alert at each sell. Nothing is actually bought or sold.</p>
    ${watch}
    ${day.picks.length ? `<div class="picks">${day.picks.map(pickCard).join("")}</div>` : `<div class="card">${empty("No picks yet today", `${day.ratedToday} coins rated so far today, none cleared the pick rule. Picks appear here the moment a coin qualifies.`)}</div>`}`;
}

function botToday(d) {
  const day = d.day, s = day.summary, o = day.passed.summary;
  const kpi = (b, v, sm, c = "") => `<div class="card kpi"><b>${b}</b><span class="${c}">${v}</span><small>${sm}</small></div>`;
  const row = (p) => `<tr class="row" data-mint="${esc(p.mint)}"><td><div class="coin">${av(p, "sm")}<div><b>${esc(p.symbol || "?")}</b>${p.unsellable ? '<span class="st bad">can\'t be sold</span>' : p.dead ? '<span class="st dead">dead</span>' : ""}<small>${esc(p.tag || p.name || "")}</small></div></div></td>
    <td>${gradeBadge(p.grade)} <span class="dim">${p.score}</span></td><td class="dim">${clock(p.t)}</td><td>${money(p.entry)}</td><td>${money(p.mcapNow)}</td>
    <td class="${xCls(p.ruleX)}" title="${esc(p.ruleWhy)}"><b>${mult(p.ruleX)}</b><small>${p.ruleClosed ? "sold" : "open"}</small></td><td class="${xCls(p.now)}">${mult(p.now)}</td><td>${mult(p.peak)}</td><td>${p.m1h != null ? mult(p.m1h) : "—"}</td></tr>`;
  const table = (list) => `<div class="table-wrap"><table><thead><tr><th>Coin</th><th>Rating</th><th>Rated at</th><th>Mcap then</th><th>Mcap now</th><th title="What the exit rule made of it: sales already banked plus anything still held">With exit rule</th><th title="If simply held until now">If held</th><th>Peak since</th><th>After 1h</th></tr></thead><tbody>${list.map(row).join("")}</tbody></table></div>`;
  const cmp = s.n && o.n ? (s.medianNow > o.medianNow ? `The picks are doing better than the coins it passed on (${mult(s.medianNow)} vs ${mult(o.medianNow)} typical).` : `The picks are NOT beating the coins it passed on (${mult(s.medianNow)} vs ${mult(o.medianNow)} typical).`) : "";
  return `<p class="bot-note">Today since midnight. “Now” is each coin's market cap now against the moment it was rated; a coin whose pool was emptied counts as 0x. These are price moves on paper, not trades. ${cmp}</p>
    <div class="kpis">
      ${kpi("Picks today", s.n, `${day.ratedToday} coins rated`)}
      ${kpi("$100 in each, exit rule", s.per100Rule != null ? `$${Math.round(s.per100Rule)}` : "—", s.n ? `${s.ruleUp} of ${s.n} in profit · ${s.ruleClosed} fully sold · after ${day.paper.costPctPerSide}% costs each way` : "no picks yet", s.per100Rule >= 100 ? "up" : s.per100Rule != null ? "down" : "")}
      ${kpi("$100 in each, just held", s.per100 != null ? `$${Math.round(s.per100)}` : "—", s.n ? `typical pick now ${mult(s.medianNow)} · ${s.down50} down 50%+` : "", s.per100 >= 100 ? "up" : s.per100 != null ? "down" : "")}
      ${kpi("Picks that reached 2x", s.n ? `${s.hit2x} / ${s.n}` : "—", s.n ? `typical peak ${mult(s.medianPeak)} · ${s.unsellable} unsellable` : "")}
      ${kpi("Entry vs rated price", s.timed ? `${s.entryVsRated <= 1 ? "−" : "+"}${Math.abs((s.entryVsRated - 1) * 100).toFixed(0)}%` : "—", s.timed ? `typical, over ${s.timed} timed entries · ${Math.round(s.entrySecs)}s after rating · ${day.skipped.length} turned down` : `no timed entries yet · ${day.skipped.length} turned down`, s.timed ? (s.entryVsRated <= 1 ? "up" : "down") : "")}
    </div>
    ${(() => {
      const ev = day.evidence;
      if (!ev) return "";
      const tb = (title, sub, bands) => `<div><h3>${title}</h3><small class="dim">${sub}</small><table><thead><tr><th></th><th>Coins</th><th>Won</th><th>Avg result</th></tr></thead><tbody>${bands.map((b) => `<tr><td>${esc(b.label)}</td><td>${b.n}</td><td>${b.winPct != null ? `${b.winPct}%` : "—"}</td><td class="${b.avg != null ? xCls(b.avg) : ""}"><b>${b.avg != null ? mult(b.avg) : "—"}</b></td></tr>`).join("")}</tbody></table></div>`;
      return `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Does the ranking work?</h2><small>every coin rated in the last 7 days, as if bought when rated and sold by the exit rule · ${ev.n} coins · “won” = made 15%+</small></div>
        <div class="ev-grid">${tb("By traction", "live demand when rated", ev.traction)}${tb("By AI chance", "its own estimate of a 2x", ev.pwin)}${tb("By AI call", "buy, watch or avoid", ev.action)}</div>
        <p class="dim small" style="margin:10px 2px 0">A ranking is working when the lower rows beat the upper rows. Rows with few coins mean little. Older results were replayed from prices stored about every 2 minutes, which flatters them a little.</p></div>`;
    })()}
    ${(() => {
      const E = d.early;
      if (!E) return "";
      const S = E.summary, secs = (n) => n == null ? "—" : n < 90 ? `${n}s` : `${Math.round(n / 60)}m`;
      const wr = (w) => `<tr class="row" data-mint="${esc(w.mint)}"><td><b>$${esc(w.symbol || "?")}</b>${w.bundled ? `<small title="Bought straight to bonding in its first transaction: there was never an early price to get in at">bundled at launch</small>` : ""}</td><td>${money(w.ath)}${w.mult ? `<small>${mult(w.mult)} from launch</small>` : ""}</td><td class="dim">${clock(w.t0)}</td>
        <td>${w.noticedSecs != null ? `${secs(Math.max(0, w.noticedSecs))} in${w.noticedMcap ? `<small>at ${money(w.noticedMcap)}</small>` : ""}` : `<span class="down">never</span>`}</td>
        <td>${w.flaggedSecs != null ? `<span class="up">★ ${w.flaggedP}% at ${w.flaggedSecs}s</span>` : w.bestP != null ? `<span class="dim">${w.bestP}%</span>` : `<span class="dim">—</span>`}</td>
        <td>${w.grade ? `${gradeBadge(w.grade)} <span class="dim">${esc(w.action || "")}</span>` : `<span class="dim">${w.readStatus === "expired" ? "dropped unread" : w.readStatus || "not read"}</span>`}</td>
        <td>${w.picked ? `<b class="${xCls(w.pickX)}">${w.pickX != null ? mult(w.pickX) : "open"}</b><small>in at ${money(w.pickMcap)}, ${secs(w.pickSecs)}</small>` : w.turnedDown ? `<span class="dim" title="${esc(w.turnedDown)}">turned down</span>` : `<span class="down">missed</span>`}</td></tr>`;
      const mrow = (m) => `<tr><td>${m.cp < 60 ? `${m.cp}s` : `${m.cp / 60}m`} after launch</td><td>${m.n}${m.status === "learning" ? ` / ${m.need}` : ""}</td><td>${m.base?.winPct != null ? `${m.base.winPct}%` : "—"}</td>
        <td>${m.test ? `<b class="${m.test.top25.winPct > m.test.all.winPct ? "up" : "down"}">${m.test.top25.winPct}%</b> <span class="dim">vs ${m.test.all.winPct}%</span>` : "—"}</td><td>${m.test ? `<b class="${xCls(m.test.top25.avg)}">${mult(m.test.top25.avg)}</b> <span class="dim">vs ${mult(m.test.all.avg)}</span>` : "—"}</td>
        <td><span class="st ${m.status === "working" ? "ok" : m.status === "learning" ? "" : "bad"}">${esc(m.status)}</span>${m.autoOk ? ` <span class="dim">· entering its strongest</span>` : ""}</td></tr>`;
      return `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Today's real winners</h2><small>every launch today that reached ${money(E.winnerUsd)}+ · did Blix have it, and how early?</small></div>
        ${E.winners.length ? `<p class="bot-note" style="margin:0 2px 10px">${S.n} launches got there from a normal start${S.bundled ? ` (plus ${S.bundled} that were bundled straight to bonding, where no early entry existed)` : ""}. Blix noticed <b>${S.noticed}</b>${S.medianNoticedSecs != null ? ` (typically ${secs(Math.max(0, S.medianNoticedSecs))} after launch${S.medianNoticedMcap ? `, at ${money(S.medianNoticedMcap)}` : ""})` : ""}, the launch model flagged <b>${S.flagged}</b>, the AI read <b>${S.read}</b>, and <b>${S.picked}</b> were picked${S.medianPickMcap ? ` (typically at ${money(S.medianPickMcap)})` : ""}.</p>
        <div class="table-wrap"><table><thead><tr><th>Coin</th><th>Peak</th><th>Launched</th><th>First noticed</th><th title="The launch model's chance of a 2x; a star means it was in the top 10% of launches">Early signal</th><th>AI read</th><th>Pick</th></tr></thead><tbody>${E.winners.slice(0, 25).map(wr).join("")}</tbody></table></div>`
          : empty("No winners recorded yet", "A launch appears here once it reaches that market cap. Counting started when this version did.")}
        <div class="card-head" style="margin-top:14px"><h2>Launch model</h2><small>learns what winners look like in their first seconds · judged only on launches it never saw · recording ${E.stats.recording} launches now</small></div>
        <div class="table-wrap"><table><thead><tr><th>Judged at</th><th>Launches learned from</th><th>Doubled before −40%</th><th title="On the newest 30% of launches, which it was not trained on">Its top quarter won</th><th>Its top quarter returned</th><th>Status</th></tr></thead><tbody>${E.models.map(mrow).join("")}</tbody></table></div>
        ${E.models.find((m) => m.drivers?.length) ? `<p class="dim small" style="margin:8px 2px 0">What it leans on most (60s): ${(E.models.find((m) => m.cp === 60 && m.drivers.length) || E.models.find((m) => m.drivers.length)).drivers.map((x) => `${esc(x.k)} ${x.w > 0 ? "+" : "−"}`).join(", ")}</p>` : `<p class="dim small" style="margin:8px 2px 0">It needs about ${E.models[0].need} recorded launches with at least 15 winners before it is used, usually an hour or two of running. Until then early coins are found by the slop filter and live traders only.</p>`}</div>`;
    })()}
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Picks</h2><small>cleared the pick rule</small></div>${s.n ? table(day.picks) : empty("No picks yet today", "They are added as coins qualify.")}</div>
    <div class="card"><div class="card-head"><h2>Rated but passed on</h2><small>${o.n} coins · typical now ${mult(o.medianNow)} · typical peak ${mult(o.medianPeak)} · ${o.hit2x} reached 2x · $100 in each → ${o.per100 != null ? "$" + Math.round(o.per100) : "—"}</small></div>
      ${o.n ? table(day.passed.list) : empty("Nothing rated yet today", "")}</div>`;
}

async function botTick() {
  if (route() !== "") return;
  // On the live tab the bot data is only needed for the tab counts: ask every 20 seconds, not every 2.
  if (pulseState.tab === "new") { if (Date.now() - (botTick.last || 0) < 20_000) return; botTick.last = Date.now(); }
  const d = await api("bot").catch(() => null);
  if (!d) return;
  botData = d;
  pulseState.ai = d.live.ai; pulseState.sol = d.live.solUsd;
  const tabs = $("#botTabs");
  if (tabs) tabs.innerHTML = botTabs();
  const box = $("#botView");
  if (!box || pulseState.tab === "new" || document.hidden) return;
  // Keep the scroll position of each list across refreshes.
  const tops = [...box.querySelectorAll(".pcol-body")].map((el) => el.scrollTop);
  box.innerHTML = pulseState.tab === "anti" ? botAnti(d) : pulseState.tab === "picks" ? botPicks(d) : botToday(d);
  box.querySelectorAll(".pcol-body").forEach((el, i) => { el.scrollTop = tops[i] || 0; });
}

async function viewPulse(main) {
  pulseState.rows.clear(); pulseState.first = true;
  // Column header, as on Axiom and GMGN: its own search, the three saved filter sets, and its filter button.
  const col = (k, title, sub) => `<section class="pcol"><header><h2>${title}</h2><span class="pcount num" id="pcount-${k}">…</span><span class="prating" id="prating-${k}"></span>
    <span class="pcol-tools"><input class="input pcol-q" data-pcq="${k}" placeholder="Find" value="${esc(pulseState.cq[k] || "")}" title="${sub}">
    <select class="input psort ${pulseState.sort[k] ? "on" : ""}" data-psort="${k}" title="Sort this column">${SORTS.map(([v, l]) => `<option value="${v}" ${(pulseState.sort[k] || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select>
    <span class="pslots">${[0, 1, 2].map((i) => `<button class="${pf.slot === i ? "on" : ""}" data-pslot="${i}" title="Filter set ${i + 1}: ${PF_SLOT_NAMES[i]}">P${i + 1}</button>`).join("")}</span>
    <button class="pfbtn" id="pfbtn-${k}" data-pfopen="${k}" title="Filters for ${title}">${PF_ICON}</button></span></header><div class="pcol-body" id="pcol-${k}"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div></section>`;
  main.innerHTML = `<div class="pulse-head">
      <div class="pulse-title"><h1>Pulse</h1><svg class="beat" viewBox="0 0 120 24"><path d="M0 12h30l6-9 8 18 7-14 5 5h64"/></svg></div>
      <div class="btabs" id="botTabs">${botTabs()}</div>
      <div class="pulse-live" id="pulseLive"></div>
      <div class="desk-wrap" id="deskStrip"></div>
      <div class="pulse-tools"><input class="input" id="pq" placeholder="Search ticker, name or CA  ( / )" value="${esc(pulseState.q)}">
        <div class="chips">${[["all", "All"], ["watch", "★ Watchlist"], ["noslop", "Hide slop"], ["rated", "AI rated"], ["queue", "In queue"], ["c", "C+ and up"], ["b", "B and up"], ["buy", "Buy calls"]].map(([k, l]) => `<button class="chip ${pulseState.min === k ? "on" : ""}" data-pmin="${k}">${l}</button>`).join("")}</div>
        <div class="chips tog"><button class="chip ${pulseState.compact ? "on" : ""}" data-ptog="compact" title="Denser rows">Compact</button><button class="chip ${pulseState.sound ? "on" : ""}" data-ptog="sound" title="A tone on buy calls, picks and paper exits">Sound</button><button class="chip" data-pkeys title="Keyboard: j/k rows · h/l columns · Enter open · b paper buy · f Fomo · w watch · r read · d desk · / search · Esc">Keys ?</button></div></div>
    </div>
    <div id="pulseWarn"></div>
    <div id="tabNew" ${pulseState.tab === "new" ? "" : "hidden"}><div class="pulse four">${col("new", "New pairs", "pump.fun, live")}${col("running", "Running now", "moving in the last 5 min, any age, not in the other columns")}${col("stretch", "Final stretch", "50%+ bonded, trading now")}${col("migrated", "Migrated", "last 6h")}</div></div>
    <div id="botView" ${pulseState.tab === "new" ? "hidden" : ""}><div class="skel"></div><div class="skel"></div></div>`;
  main.querySelector(".pulse-tools").hidden = pulseState.tab !== "new";
  document.body.classList.toggle("pulse-compact", pulseState.compact);
  renderDesk();
  pfHeads();
  clearInterval(pulseState.timer); clearInterval(pulseState.botTimer);
  pulseState.timer = setInterval(pulseTick, 2000);
  pulseState.botTimer = setInterval(botTick, 2000);
  setTimeout(pulseTick, 0); setTimeout(botTick, 0);
}

// Bursts: several different people launching on the same word or the same post within minutes.
let narTimer = null;
function burstTable(d) {
  const rows = d.clusters;
  if (!rows.length) return empty("Nothing bursting right now", `Every launch is compared with the last three hours. A burst shows here within seconds of the third or fourth matching launch; ${d.stats.launches.toLocaleString()} launches compared since Blix started.`);
  return `<div class="table-wrap"><table><thead><tr><th>Shared by the launches</th><th title="Launches in the last 10 minutes / the last hour">Launches 10m / 1h</th><th title="How many times its normal rate over the last three hours">vs normal</th><th title="Different wallets that launched one in the last 10 minutes">Launchers</th><th title="Different wallets trading these coins">Buyers</th><th>Lead coin</th><th>Status</th></tr></thead><tbody>${rows.map((c) => `<tr>
    <td><div class="kw">${c.keys.slice(0, 4).map((k) => `<span>${esc(k)}</span>`).join("")}</div>${c.name ? `<div class="small"><b>${esc(c.name)}</b> ${stageBadge(c.stage)}</div>` : c.looking ? `<div class="dim small">Grok is looking it up on X…</div>` : ""}</td>
    <td class="num">${c.n10}<span class="dim"> / ${c.n60}</span></td><td class="num">${c.lift >= 20 ? "20x+" : `${c.lift}x`}</td><td class="num">${c.devs}</td><td class="num">${c.traders.toLocaleString()}</td>
    <td>${c.lead ? `<span class="linkish" data-mint="${esc(c.lead.mint)}"><b>$${esc(c.lead.symbol)}</b></span> <span class="dim small">${money(c.lead.mcap)} · ${c.lead.traders} traders · ${mins(c.lead.age)} old</span>${c.best && c.best.mint !== c.lead.mint ? `<div class="dim small">best so far <span class="linkish" data-mint="${esc(c.best.mint)}">$${esc(c.best.symbol)}</span> ${c.best.mult}x</div>` : ""}` : `<span class="dim">nobody buying yet</span>`}</td>
    <td>${c.state === "forming" ? `<span class="st top" title="Enough separate launchers, well above its normal rate, with real buyers in at least one coin">forming${c.since ? ` · ${mins(Date.now() - c.since)}` : ""}</span>` : `<span class="st old" title="Many launches but no real buying in any of them: launch spam until someone buys. Not looked up.">launches only</span>`}</td></tr>`).join("")}</tbody></table></div>`;
}
async function viewNarratives(main) {
  const [nar, live] = await Promise.all([api("narratives"), api("clusters")]);
  const calls = live.calls.calls, rec = live.calls.record, cur = calls.filter((n) => n.review !== "expired"), old = calls.filter((n) => n.review === "expired" && (n.best_mult || n.best_peak)).slice(0, 9);
  const recLine = (r, what) => r.n ? `${what}: ${r.n} scored, the best coin ran 3x+ in ${r.bestRan3x}${r.typicalCoin != null ? `, the typical coin peaked at ${mult(r.typicalCoin)}` : ""}${r.leadN ? `, the coin named as lead peaked at ${mult(r.leadCoin)} (${r.leadN})` : ""}${r.detectSecs != null ? `, named a median ${r.detectSecs}s after the burst began` : ""}.` : `${what}: none scored yet (each call is scored after 24 hours).`;
  main.innerHTML = `<div class="page-head"><div><h1>Narratives</h1><p>A narrative shows up on-chain as a burst: several different people launching on the same word or the same post within minutes, with real buyers arriving. Blix catches the burst in seconds and asks Grok, which can search X, what the story is. An hourly scout looks for catalysts that have no coins yet.</p></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Bursting right now</h2><small>refreshes every few seconds · ${live.armed.length} narrative${live.armed.length === 1 ? "" : "s"} armed, ${live.stats.armedHits} matching launches caught</small></div>
      ${live.grok ? "" : `<div class="warn-box" style="margin:0 16px 12px"><b>Grok is not available right now.</b> Bursts are still caught and recorded, but they are not being looked up on X, so they have no story or stage. See Health for why.</div>`}
      <div id="narLive">${burstTable(live)}</div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Narratives called</h2><small>${cur.length} current · last 12 hours</small></div>
      ${cur.length ? `<div class="scouts">${cur.map(narCard).join("")}</div>` : empty("No current narratives", live.calls.scout.why || "A narrative appears here when a burst gets real buyers, or when the hourly scout finds a live catalyst.")}
      ${old.length ? `<h4 class="sub">Earlier calls and how they did</h4><div class="scouts">${old.map(narCard).join("")}</div>` : ""}
      <div class="status-list" style="margin-top:12px">${statusLine(rec.burst.n ? "ok" : "wait", recLine(rec.burst, "Bursts"))}${statusLine(rec.scout.n ? "ok" : "wait", recLine(rec.scout, "Scout calls"))}</div>
      <p class="note pad">"Best coin" is the best move among coins matching a narrative after it was called: nobody knew in advance which coin that would be, so it flatters the call. The typical coin and the named lead coin are the honest measures. Market-cap moves from sellable prices, not trades.</p></div>
    <h2 class="sub" style="margin:8px 0 12px">Standing themes</h2><p class="note" style="margin:0 0 12px">What coins are being launched around in general. Heat mixes trading volume, coins that survive, and share of all new launches. Lift compares the last hour with the hours before.</p>
    ${nar.emerging.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Emerging words</h2><small>showing up far more in the last hour</small></div>
      <div class="words">${nar.emerging.map((e) => `<span class="word">${esc(e.word)}<em>${e.count}× · ${e.lift.toFixed(1)}x</em></span>`).join("")}</div></div>` : ""}
    <div class="nar-grid">${nar.themes.map((n) => `<div class="card nar">
      <div class="nar-top"><h3>${esc(n.name)}</h3><span class="num" style="font-size:20px">${n.heat}<span class="dim" style="font-size:12px">/100</span></span></div>
      <div class="heat" style="margin:0"><i style="width:${n.heat}%"></i></div>
      <div class="nar-nums">
        <div><b>Launch share</b><span>${(n.launchShare * 100).toFixed(1)}%</span></div>
        <div><b>Lift</b><span class="${n.launchLift >= 1.15 ? "up" : n.launchLift <= 0.85 && n.launchLift ? "down" : ""}">${n.launchLift ? n.launchLift.toFixed(2) + "x" : "—"}</span></div>
        <div><b>Vol 1h</b><span>${money(n.volume)}</span></div>
      </div>
      <div class="leaders">${n.top.length ? n.top.map((t) => `<div class="leader" data-mint="${esc(t.mint)}">${av(t, "sm")}<span class="grow"><b>$${esc(t.symbol)}</b> <span class="dim">${esc(t.name)}</span></span><span class="num">${money(t.mcap)}</span><span class="num ${cls(t.chg_h1)}" style="width:62px;text-align:right">${pct(t.chg_h1)}</span></div>`).join("") : `<span class="note">No tracked coins yet, only launches.</span>`}</div>
    </div>`).join("") || empty("Warming up", "Narratives need a few minutes of launches to show up.")}</div>`;
  // Only the burst table is redrawn, so the cards below keep their place while it updates.
  clearInterval(narTimer);
  narTimer = setInterval(async () => {
    if (route() !== "narratives") return clearInterval(narTimer);
    const box = $("#narLive");
    if (!box || document.hidden) return;
    try { box.innerHTML = burstTable(await api("clusters")); } catch {}
  }, 4000);
}

async function viewBriefs(main) {
  const list = await api("briefs");
  const partial = list.filter((b) => b.status === "partial").length;
  main.innerHTML = `<div class="page-head"><div><h1>Briefs</h1><p>Every hour Blix's data is written up: the tape, hot narratives, coins to watch, and red flags. A brief that comes back unfinished is retried once, then kept and marked incomplete rather than passed off as whole.${partial ? ` ${partial} of the ${list.length} below ${partial === 1 ? "is" : "are"} incomplete.` : ""}</p></div><button class="btn primary" data-brief>Write one now</button></div>
    <div class="stack">${list.length ? list.map((b) => `<div class="card ${b.status === "partial" ? "partial" : ""}"><div class="card-head"><h2>${new Date(b.t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}${b.status === "partial" ? ' <span class="st bad">incomplete</span>' : ""}</h2><small>${ago(b.t)} ago · ${esc(providerOf(b.model))}</small></div>${partialNote(b)}<div class="brief md">${md(b.body)}</div></div>`).join("") : `<div class="card">${empty("No briefs yet", "The first one is written about 12 minutes after Blix starts.")}</div>`}</div>`;
}

// ---------- track record ----------
// Shown per coin by default: ten alerts on one coin are one pick. Every rate is a count over the
// number of results that were actually available, and the typical result (median) leads, not the average.
const recState = { unit: "tokens" };
function recRow(name, color, g, unit) {
  const e = g[unit];
  const tip = `${e.eligible1h} checked after 1h · ${e.pending1h} still inside their first hour · ${e.unavailable1h} had no price to check`;
  return `<tr><td>${color ? `<span class="tag" style="--k:${color}">${name}</span>` : `<b>${name}</b>`}</td>
    <td>${g.events.events} <span class="dim">on ${g.events.tokens} coin${g.events.tokens === 1 ? "" : "s"}</span></td>
    <td title="${tip}">${e.eligible1h}<small>${e.pending1h ? `${e.pending1h} pending` : ""}${e.unavailable1h ? ` ${e.unavailable1h} n/a` : ""}</small></td>
    <td class="up">${frac(e.up20, e.eligible1h)}<small>${share(e.up20, e.eligible1h)}</small></td>
    <td class="down">${frac(e.down50, e.eligible1h)}<small>${share(e.down50, e.eligible1h)}</small></td>
    <td class="${e.unsellable1h ? "down" : "dim"}">${frac(e.unsellable1h, e.eligible1h)}</td>
    <td><b>${mult(e.median1h)}</b><small title="Middle half of results">${e.p25_1h != null ? `${mult(e.p25_1h)}–${mult(e.p75_1h)}` : ""}</small></td>
    <td class="dim" title="Plain average ${mult(e.mean1h)}; with every result capped at 5x ${mult(e.cappedMean1h)}. Averages are pulled up by a few big winners, so the median is the fair summary.">${mult(e.cappedMean1h)}<small>raw ${mult(e.mean1h)}</small></td>
    <td class="dim">${mult(e.worst1h)}</td>
    <td>${frac(e.twoX, e.peaks)}<small>median peak ${mult(e.medianPeak)}</small></td></tr>`;
}
async function viewRecord(main) {
  const p = await api("perf");
  const u = recState.unit, a = p.all[u], ev = p.all.events;
  const callRow = (s, lead) => `<div class="sig" style="--k:${kindOf(s.kind)[1]}" data-mint="${esc(s.mint)}">${av(s)}<div style="min-width:0"><div class="sig-top"><span class="tag">${kindOf(s.kind)[0]}</span>${s.alerts > 1 ? `<span class="st dup" title="Alerts that fired on this coin; it is counted once">${s.alerts} alerts, counted once</span>` : ""}${s.dead ? '<span class="st dead">dead now</span>' : ""}${s.exitable ? "" : `<span class="st bad" title="${esc(s.exitWhy || "")}">can't be sold now</span>`}</div>
      <h3>$${esc(s.symbol)} · ${esc(s.name)}</h3><p>First alerted at ${money(s.mcap)}, ${ago(s.t)} ago · pool now ${s.liqNow != null ? money(s.liqNow) : "—"} · price read ${mins(s.priceAge)} ago</p></div>
      <div class="meta">${lead}<span class="${cls((s.nowMult ?? 1) - 1)}" title="What the first alert's price is worth now if sold; 0 when the pool is empty">${s.nowMult == null ? "" : `now ${mult(s.nowMult)}`}</span></div></div>`;
  main.innerHTML = `<div class="page-head"><div><h1>Track record</h1><p>Each alert's price is checked again 15 minutes, 1 hour, 6 hours and 24 hours later. Use this to judge whether the alerts are worth anything before trusting them.</p></div>
      <div class="chips"><button class="chip ${u === "tokens" ? "on" : ""}" data-recunit="tokens" title="Each coin counted once, from its first alert">Per coin</button><button class="chip ${u === "events" ? "on" : ""}" data-recunit="events" title="Every alert counted, including repeats on the same coin">Per alert</button></div></div>
    <div class="card basis"><b>What these numbers are, and are not.</b> ${esc(p.basis)} Coins with a pool under ${money(p.minExitLiq)} count as unsellable.</div>
    <div class="kpis">
      <div class="card kpi"><b>${u === "tokens" ? "Coins alerted" : "Alerts"}</b><span>${u === "tokens" ? ev.tokens : ev.events}</span><small>${ev.events} alerts on ${ev.tokens} coins in ${p.days} days · ${p.repeatAlerts} were repeats</small></div>
      <div class="card kpi"><b>Typical result after 1h</b><span class="${a.median1h >= 1 ? "up" : a.median1h != null ? "down" : ""}">${mult(a.median1h)}</span><small>median of ${a.eligible1h} checked · ${a.pending1h} pending · ${a.unavailable1h} unavailable</small></div>
      <div class="card kpi"><b>Up 20%+ after 1h</b><span class="up">${frac(a.up20, a.eligible1h)}</span><small>${share(a.up20, a.eligible1h)} of those checked</small></div>
      <div class="card kpi"><b>Down 50%+ after 1h</b><span class="down">${frac(a.down50, a.eligible1h)}</span><small>${share(a.down50, a.eligible1h)} · ${a.unsellable1h} of them unsellable (pool emptied)</small></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>By signal type</h2><small>${u === "tokens" ? "each coin once, from its first alert of that type" : "every alert, repeats included"} · passed safety only</small></div>
      ${p.byKind.length ? `<div class="table-wrap"><table class="rec"><thead><tr><th>Type</th><th>Alerts</th><th title="Results available after 1 hour: the denominator for the next columns">Checked at 1h</th><th>Up 20%+</th><th>Down 50%+</th><th title="Pool was empty at the 1h check: counted as 0x">Unsellable</th><th title="The middle result, with the middle half's range">Median 1h</th><th title="Average with each result capped at 5x, so a few huge winners cannot carry it">Avg (capped)</th><th>Worst</th><th title="Peak within 24h reached 2x, from sellable prices">Reached 2x</th></tr></thead>
        <tbody>${recRow("All approved signals", "", p.all, u)}${p.byKind.map((k) => recRow(kindOf(k.kind)[0], kindOf(k.kind)[1], k, u)).join("")}
        ${p.unscreened.events.events ? recRow("Unscreened wallet activity", "var(--muted)", p.unscreened, u) : ""}</tbody></table></div>
        <p class="note pad">“Down 50%+” is a price fall, not proof of a rug: confirmed rugs (RugCheck) and pulled liquidity are separate warnings in the Signals feed. “Unscreened wallet activity” is followed-wallet buying in coins that failed safety; it is shown for comparison and never counted in the totals above.</p>` : empty("No results yet", "Signals need at least an hour before they can be scored.")}</div>
    <div class="radar-grid even">
      <div class="card"><div class="card-head"><h2>Biggest price peaks</h2><small>per coin · peak is a price high, not an exit</small></div>${p.best.length ? p.best.map((s) => callRow(s, `<b class="up">${mult(s.peak)}</b>peak`)).join("") : empty("Nothing yet", "Check back after a few hours of running.")}</div>
      <div class="card"><div class="card-head"><h2>Worst after 1 hour</h2><small>per coin</small></div>${p.worst.length ? p.worst.map((s) => callRow(s, `<b class="down">${s.illiq ? "0x" : mult(s.p1h)}</b>${s.illiq ? "unsellable" : "after 1h"}`)).join("") : empty("Nothing yet", "Needs alerts older than an hour.")}</div>
    </div>`;
}

const NOTIFY = [["launch", "New launches"], ["graduated", "Graduations"], ["momentum", "Momentum"], ["volume", "Volume spikes"], ["mcap-1000000", "$1M milestones"], ["mcap-5000000", "$5M milestones"], ["dump", "Dump warnings"], ["liq-pulled", "Liquidity pulled"], ["wallet", "Wallet buys (passed safety)"], ["smart", "Several followed wallets buying"], ["dev-sold", "Dev sold"], ["rugged", "RugCheck: rugged"], ["fomo", "Fomo crowd buys"], ["pick", "AI picks (rated well and safe)"], ["buy", "AI buy calls"], ["research", "A-grade research"], ["brief", "AI briefs"]];
const CHANNEL = { discord: "Discord", telegram: "Telegram", held: "Held back" };

// What still needs doing before alerts reach you reliably, each with its real current state.
function checklist(al, pv) {
  const d = al.destinations, item = (ok, title, text) => `<div class="chk ${ok === true ? "ok" : ok === null ? "opt" : "todo"}"><i>${ok === true ? "✓" : ok === null ? "–" : "!"}</i><div><b>${title}</b><span>${text}</span></div></div>`;
  const dest = (ch, name) => { const x = d[ch]; const failing = x.lastFail && (!x.lastOk || x.lastFail.t > x.lastOk.t);
    return item(x.configured && !failing && x.lastOk ? true : false, name, !x.configured ? "Not set up. Alerts cannot reach you here." : failing ? `Set up, but the last send failed ${ago(x.lastFail.t)} ago: ${esc(x.lastFail.error || "")}` : x.lastOk ? `Working. Last delivered ${ago(x.lastOk.t)} ago; ${x.sent24h} sent in 24h.` : "Saved but never tested. Press “Send test message”."); };
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  return `<div class="checklist">
    ${dest("discord", "Discord")}${dest("telegram", "Telegram")}
    ${item(perm === "granted" ? null : false, "Browser pop-ups", perm === "granted" ? "Allowed, but they only appear while this page is open on this PC. Not a substitute for Discord or Telegram." : perm === "denied" ? "Blocked in this browser. They would only work while the page is open anyway." : "Not allowed yet. They only work while this page is open.")}
    ${item(pv.fast.actual ? !pv.fast.fallback : false, "Fast AI reads", pv.fast.actual ? `${pv.fast.actualName}${pv.fast.fallback ? ` (fallback: ${esc(pv.fast.reason || "")})` : ""}` : `None available. ${esc(pv.recovery || "")}`)}
    ${item(pv.deep.actual ? !pv.deep.fallback : false, "Deep AI reads", pv.deep.actual ? `${pv.deep.actualName}${pv.deep.fallback ? ` (fallback: ${esc(pv.deep.reason || "")})` : ""}` : "None available.")}
    ${item(null, "Fomo trade tracking", "Optional. Buy on Fomo links always work; seeing what Fomo traders buy needs one Fomo wallet added on the Wallets page.")}
  </div>`;
}

async function viewSettings(main) {
  const [{ settings: s, secrets: S }, al, rs, bk] = await Promise.all([api("settings"), api("alerts"), api("research"), api("backup")]);
  const pv = rs.providers;
  const clear = new Set();
  const num = (k, label, help) => `<div class="field"><label for="s-${k}">${label}</label><input class="input num" id="s-${k}" name="${k}" type="number" value="${esc(s[k])}"><small>${help}</small></div>`;
  // Secrets are never sent back to this page: the field shows whether one is saved, and typing replaces it.
  const secret = (k, label, ph, help, extra = "", wide = false) => `<div class="field" ${wide ? 'style="grid-column:1/-1"' : ""}><label for="s-${k}">${label}${S[k]?.set ? ` <span class="st top">saved ${esc(S[k].hint)}</span>` : ""}</label>
    <div style="display:flex;gap:8px"><input class="input num" id="s-${k}" name="${k}" type="password" autocomplete="new-password" spellcheck="false" value="" placeholder="${S[k]?.set ? "Leave blank to keep the saved one, or type to replace it" : ph}" style="flex:1">${S[k]?.set ? `<button class="btn" type="button" data-secret-clear="${k}">Remove</button>` : ""}${extra}</div><small>${help}</small></div>`;
  const mb = (n) => `${(n / 1e6).toFixed(0)} MB`;
  main.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>Where updates go and how picky Blix is. Everything is saved on this PC only (data/settings.json). Saved keys and webhook URLs are never shown again or sent back to this page.</p></div><button class="btn primary" id="save">Save</button></div>
  <form id="sform" class="stack">
    <div class="card"><div class="card-head"><h2>Setup checklist</h2><small>what is working right now</small></div>${checklist(al, pv)}</div>
    <div class="card"><div class="card-head"><h2>Where alerts go</h2><button class="btn" type="button" id="testN" title="Sends a test using what is typed here. Nothing is saved.">Send test message</button></div>
      <div class="form">
        ${secret("discordWebhook", "Discord webhook URL", "https://discord.com/api/webhooks/…", "Channel settings → Integrations → Webhooks → New webhook → Copy URL.")}
        ${secret("telegramToken", "Telegram bot token", "123456:ABC…", "From @BotFather.")}
        <div class="field"><label for="s-telegramChat">Telegram chat ID</label><input class="input" id="s-telegramChat" name="telegramChat" value="${esc(s.telegramChat)}" placeholder="e.g. 123456789"><small>Message your bot, then get it from @userinfobot.</small></div>
        <div class="field" style="grid-column:1/-1"><label>Send me</label><div class="checks">${NOTIFY.map(([k, l]) => `<label class="check"><input type="checkbox" name="notifyKinds" value="${k}" ${s.notifyKinds.includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="aiBriefs" ${s.aiBriefs ? "checked" : ""}> Write AI briefs automatically</label></div>
        ${num("briefEveryMin", "Brief every (minutes)", "How often a market brief is written.")}
      </div></div>
    <div class="card"><div class="card-head"><h2>Alert rules</h2><small>when to hold an alert back</small></div>
      <div class="form">
        <div class="field"><label for="s-quietStart">Quiet hours start</label><input class="input num" id="s-quietStart" name="quietStart" type="time" value="${esc(s.quietStart)}"><small>Nothing is pushed between these times except warnings and buy calls. Blank = no quiet hours.${al.destinations.quiet.active ? " <b>Quiet hours are active now.</b>" : ""}</small></div>
        <div class="field"><label for="s-quietEnd">Quiet hours end</label><input class="input num" id="s-quietEnd" name="quietEnd" type="time" value="${esc(s.quietEnd)}"><small>Local time on this PC. The window may cross midnight.</small></div>
        ${num("alertCooldownMin", "One push per coin every (minutes)", "More alerts on the same coin inside this window are grouped into the next push instead of sent one by one. 0 = send everything.")}
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="pushUnscreened" ${s.pushUnscreened ? "checked" : ""}> Also push unscreened wallet buys</label><small>Off by default: a followed wallet buying a coin that failed safety is logged under Signals → Unscreened, not pushed.</small></div>
      </div>
      <div class="rule-list"><h4 class="sub">Rules for single coins, wallets and alert types</h4>
        ${al.rules.length ? al.rules.map((r) => `<div class="rule"><span class="st ${r.effect === "mute" ? "bad" : "top"}">${r.effect === "mute" ? "muted" : "always alert"}</span><b>${r.scope === "kind" ? esc(KIND[r.target]?.[0] || r.target) : esc(r.name || shortAddr(r.target))}</b><span class="dim small">${r.scope}${r.scope !== "kind" ? ` · <span class="mono">${shortAddr(r.target)}</span>` : ""} · added ${ago(r.created)} ago</span><button class="btn sm-btn" type="button" data-rule-del="${r.id}">Remove</button></div>`).join("")
          : `<p class="note pad">No rules yet. Mute a coin or a wallet from its page (“Mute alerts”), or star a coin to always be alerted about it, whatever the cooldown.</p>`}
        <div class="filters" style="padding:0 16px 14px"><select class="input" id="ruleKind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join("")}</select><button class="btn" type="button" id="ruleKindAdd">Mute this alert type</button></div>
      </div>
      <h4 class="sub">Delivery history <span class="dim">· last ${al.deliveries.length} · ${al.destinations.held24h} held back in 24h</span></h4>
      ${al.deliveries.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>To</th><th>Alert</th><th>Result</th></tr></thead><tbody>
        ${al.deliveries.slice(0, 40).map((x) => `<tr><td class="dim">${ago(x.t)} ago</td><td>${CHANNEL[x.channel] || esc(x.channel)}</td><td>${esc(x.title || x.kind)}</td><td class="${x.ok === 1 ? "up" : x.ok === 0 ? "down" : "dim"}">${x.ok === 1 ? "delivered" : x.ok === 0 ? `failed: ${esc(x.error || "")}` : `not sent: ${esc(x.error || "")}`}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="note pad">Nothing sent or held back yet. Every push, failure and held-back alert is listed here with the reason.</p>`}</div>
    <div class="card"><div class="card-head"><h2>AI research</h2><small>coins about to bond and just bonded</small></div>
      <div class="form">
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="researchAuto" ${s.researchAuto ? "checked" : ""}> Research automatically</label><small>With a fast AI available: every coin 60%+ to bonding and every bonded coin with volume. Without one: only the strongest.</small></div>
        <div class="field"><label for="s-fastProvider">Fast lane</label><div style="display:flex;gap:8px"><select class="input" id="s-fastProvider" name="fastProvider" style="flex:1"><option value="claude" ${s.fastProvider === "claude" ? "selected" : ""}>Claude Haiku (this PC's Claude login)</option><option value="grok" ${s.fastProvider === "grok" || !["claude", "groq"].includes(s.fastProvider) ? "selected" : ""}>Grok (SuperGrok login, searches X live)</option><option value="groq" ${s.fastProvider === "groq" ? "selected" : ""}>Groq (free key)</option></select><button class="btn" type="button" id="testK">Test Grok</button></div><small>Right now: <b>${esc(pv.fast.actualName || "none available")}</b>${pv.fast.fallback ? ` (${esc(pv.fast.reason || "")})` : ""}. Grok uses this PC's Grok CLI login, no key.</small></div>
        <div class="field"><label for="s-grokModel">Grok model</label><select class="input" id="s-grokModel" name="grokModel">${["grok-4.7-build-fast", "grok-4.7", "grok-4.6"].map((m) => `<option ${s.grokModel === m ? "selected" : ""}>${m}</option>`).join("")}</select><small>build-fast is the quick one. grok-4.7 thinks harder but takes much longer.</small></div>
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="grokSearch" ${s.grokSearch ? "checked" : ""}> Grok searches X live</label><small>Grok looks the coin up on X by contract and ticker: who's posting, real engagement, organic or botted. About 8s per coin, and each search uses subscription credits.</small></div>
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="triageOn" ${s.triageOn ? "checked" : ""}> A fast AI labels every new launch</label><small>Off by default. The instant rules already label every coin slop / meh / maybe / hot for free; the AI's labels cost about 120 calls an hour and barely separated winners (1.8% of its "slop" reached $30k, against 2.2% of its "maybe"). Coins are sent for a read when real buyers show up, not on their looks.</small></div>
        <div class="field"><label for="s-triageProvider">Triage AI</label><select class="input" id="s-triageProvider" name="triageProvider">${[["auto", "Auto (Groq if keyed, else Grok fast)"], ["groq", "Groq"], ["grok", "Grok fast"]].map(([v, l]) => `<option value="${v}" ${s.triageProvider === v ? "selected" : ""}>${l}</option>`).join("")}</select><small>Groq is the fastest and free; it needs the key below.</small></div>
        ${num("triageEscalate", "Send to research at triage score", "Coins the fast AI scores this high (maybe/hot) get researched. Live traction also escalates.")}
        ${secret("groqKey", "Groq API key (free, fastest triage)", "gsk_…", "Free at console.groq.com/keys (no card). Keeps fast reads and triage running when Grok is out of credits.", `<button class="btn" type="button" id="testG" title="Tests the key typed here, or the saved one if blank. Nothing is saved.">Test</button>`, true)}
        <div class="field"><label for="s-fastModel">Groq model</label><select class="input" id="s-fastModel" name="fastModel">${["openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"].map((m) => `<option ${s.fastModel === m ? "selected" : ""}>${m}</option>`).join("")}</select><small>Tried first. The rest are fallbacks.</small></div>
        ${num("fastPerHour", "Max fast reads per hour", "Each Grok read with X search spends subscription credits; this keeps a steady pace.")}
        ${num("queueMax", "Most coins allowed to wait", "The queue never holds more than this, or about 90 minutes of reads, whichever is smaller. The weakest and oldest are dropped.")}
        ${num("deepMinScore", "Deep read at fast score", "Fast reads scoring this or higher get a deeper second read.")}
        <div class="field"><label for="s-deepProvider">◆ Deep reads</label><select class="input" id="s-deepProvider" name="deepProvider"><option value="grok" ${s.deepProvider !== "claude" ? "selected" : ""}>Grok (grok-4.7, searches X, makes buy calls)</option><option value="claude" ${s.deepProvider === "claude" ? "selected" : ""}>Claude (no live search)</option></select><small>Right now: <b>${esc(pv.deep.actualName || "none available")}</b>${pv.deep.fallback ? ` (${esc(pv.deep.reason || "")})` : ""}. The deep read decides buy / watch / avoid with an exit plan.</small></div>
        <div class="field"><label for="s-deepModel">Deep Grok model</label><select class="input" id="s-deepModel" name="deepModel">${["grok-4.7", "grok-4.6", "grok-4.7-build-fast"].map((m) => `<option ${s.deepModel === m ? "selected" : ""}>${m}</option>`).join("")}</select><small>grok-4.7 is the smartest; about 30-60s a read.</small></div>
        ${num("deepPerHour", "Max Grok deep reads per hour", "Runs 2 at a time.")}
        ${num("deepSearches", "Searches per deep read", "How many X/web searches Grok may run on one coin.")}
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="aiInGate" ${s.aiInGate ? "checked" : ""}> Let the AI's buy / avoid call decide picks</label><small>Off by default. Over 126 picks its "buy" picks won 6% and the picks it called "avoid" won 44%, so picks are decided by live demand and the launch model instead. Its call is still shown on every coin and scored on the Picks page; switch this on if it starts to beat them.</small></div>
        ${num("pickMinTraction", "Pick rule: minimum traction", "Live demand, 0-100. On past reads, coins under 40 won 7-9% of the time and coins at 65+ won about half. This is the main gate.")}
        ${num("pickMinPwin", "Pick rule: minimum AI chance (%)", "Only used when the AI's call decides picks. The chance the AI gives a coin of reaching 2x before falling 40%. A coin it calls a buy passes regardless; one it calls avoid never does.")}
        ${num("pickMinMcap", "Pick rule: smallest market cap ($)", "Below this the early rule applies instead.")}
        ${num("earlyMinTraders", "Early rule: minimum traders", "A coin in its first minutes is picked on its first buyers: this many different wallets, more buying than selling, and an AI that would trade it.")}
        ${num("earlyMinPwin", "Early rule: minimum AI chance (%)", "For a coin the AI calls watch. A buy call passes regardless.")}
        ${num("pickMaxMcap", "Pick rule: largest market cap ($)", "Above this the early move is usually over.")}
        ${num("entryWaitMin", "Entry: give up after (minutes)", "A rated coin is watched every second. If it offers no clean entry in this long, it is dropped.")}
        ${num("entryChasePct", "Entry: never chase above (%)", "Do not enter while the coin is more than this far above the price it was rated at.")}
        ${num("entryCancelPct", "Entry: drop if it falls (%)", "Dropped if it falls this far below the rated price while waiting.")}
        ${num("entryFallPct", "Entry: falling means (% in 15s)", "Wait while it is down this much over the last 15 seconds.")}
        ${num("entryOffHighPct", "Entry: max below its high (%)", "Do not enter a coin sitting this far below its all-time high.")}
        ${num("pickTakeProfit", "Pick exit: take profit at (x)", "Paper rule applied to every pick. Sell part of it when the coin reaches this multiple of its pick price.")}
        ${num("pickSellPct", "Pick exit: sell this % there", "The rest rides on the trailing stop.")}
        ${num("pickTrailPct", "Pick exit: trailing stop (%)", "After taking profit, sell the rest once it falls this far below its high.")}
        ${num("pickStopPct", "Pick exit: stop loss (%)", "Before any profit is taken, sell everything on this fall from the pick price.")}
        ${num("pickMaxHours", "Pick exit: time limit (hours)", "Sell whatever is left after this long.")}
        ${num("guardLosses", "Risk guard: losing exits in a row", "This many losses in a row pauses new picks. 0 switches it off.")}
        ${num("guardPauseMin", "Risk guard: pause (minutes)", "How long new picks stay paused after that run of losses.")}
        ${num("guardDayLoss", "Risk guard: daily loss limit ($)", "With $100 in every pick: once the day is down this much, no new picks until tomorrow. 0 switches it off.")}
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="earlyAuto" ${s.earlyAuto ? "checked" : ""}> Enter the launch model's strongest coins before the AI has read them</label><small>Only while the model's top 10% made money on launches it had never seen.</small></div>
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="claudeFast" ${s.claudeFast ? "checked" : ""}> Claude Haiku does fast reads when Grok and Groq are out</label><small>Seconds per coin on your Claude login, capped by “Max fast reads per hour”. No live X search.</small></div>
        ${num("buyConviction", "Buy call at conviction", "Starting point; the self-review tunes it from results (55-90).")}
        ${num("scoutEveryMin", "Scout narratives every (minutes)", "Needs Grok: it searches X and the web for narratives starting to run. 0 = off.")}
        <div class="field"><label for="s-grokDailyBudget">Grok daily budget ($)</label><input class="input num" id="s-grokDailyBudget" name="grokDailyBudget" type="number" step="0.5" min="0" value="${esc(s.grokDailyBudget)}"><small>The most Grok subscription credit Blix may spend in a day; 0 means no limit. Naming a live burst costs about 7 cents and may use all of it, the hourly scout up to 60%, deep reads 50%, the one-second quick calls 25%. When a share is used up that job moves to Claude. Today's spend is on the Health page.</small></div>
        ${num("narrativeCardsPerHour", "Bursts looked up per hour", "How many live bursts Grok may look up on X in an hour, at about 7 cents each.")}
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="quickGrok" ${s.quickGrok ? "checked" : ""}> Grok's fastest model makes the first call on each coin</label><small>About one second a coin against three to four for Claude Haiku, with no X search. Uses its 25% share of the daily budget, spread through the day; Haiku takes the rest.</small></div>
        ${num("reviewMinNew", "Self-review after N new results", "The playbook is rewritten once this many graded coins have played out 6h+.")}
        ${num("researchPerHour", "Max Claude reads per hour", "Each uses your Claude subscription (about one normal Claude message). Lower this if you hit your Claude limits.")}
      </div></div>
    <div class="card"><div class="card-head"><h2>Remote access</h2><small>blixvip.com/trade → this PC through a Cloudflare Tunnel</small></div>
      <div class="form">
        <div class="field"><label for="s-publicHost">Public hostname</label><input class="input" id="s-publicHost" name="publicHost" value="${esc(s.publicHost || "")}"><small>The hostname the tunnel points at this PC. Blank switches remote access off.</small></div>
        <div class="field"><label>Your link</label><div id="remoteLink" class="dim small">loading…</div><small>Open it once on any device; the key is then kept in that browser. Anyone with the link can use the terminal, so treat it like a password.</small></div>
      </div></div>
    <div class="card"><div class="card-head"><h2>Paper desk</h2><small>the buy buttons on every Pulse row · nothing is really traded</small></div>
      <div class="form">
        <div class="field"><label for="s-quickSizes">Quick-buy sizes (SOL)</label><input class="input" id="s-quickSizes" name="quickSizes" value="${esc([].concat(s.quickSizes || []).join(", "))}"><small>Comma separated, up to 6. The second one is the default for the <b>B</b> button and the <b>b</b> key.</small></div>
        ${num("paperTake", "New position: take profit at (x)", "Sell everything at this multiple. 0 = no take profit.")}
        ${num("paperStop", "New position: stop loss (%)", "Sell everything this far below the entry. 0 = no stop.")}
        ${num("paperTrail", "New position: trailing stop (%)", "Once above the entry, sell everything this far below its high. 0 = none. Each open position's rule can be changed on the desk.")}
      </div></div>
    <div class="card"><div class="card-head"><h2><span class="fomo-mark">fomo</span> Connection</h2><small>free, on-chain, no API key</small></div>
      <div class="form">
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="fomoAutoFollow" ${s.fomoAutoFollow ? "checked" : ""}> Auto-follow the best Fomo traders</label><small>Traders Blix watched make money on Fomo (3+ closed coins, $300+ profit, 50%+ win rate).</small></div>
        ${num("fomoFollowTop", "Max Fomo traders to follow", "Each followed wallet costs RPC calls.")}
      </div></div>
    <div class="card"><div class="card-head"><h2>Market data &amp; wallets</h2></div>
      <div class="form">
        ${secret("rpcUrl", "Solana RPC URL", "Blank = free public RPC (slow, rate limited)", "For fast, complete wallet tracking, make a free account at helius.dev and paste its mainnet RPC URL here. The URL contains your key, so it is treated as a secret.", "", true)}
        ${secret("jupiterKey", "Jupiter API key (optional)", "Blank = keyless access", "Quotes and prices share a request allowance. Add a key from developers.jup.ag/portal for more capacity.", "", true)}
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="autoFollowSmart" ${s.autoFollowSmart ? "checked" : ""}> Auto-follow discovered early wallets</label><small>Adds the best wallets Blix finds, up to the limit below.</small></div>
        ${num("maxSmartWallets", "Max auto-followed wallets", "More wallets means more RPC calls.")}
        ${num("walletMinSol", "Wallet alert minimum (SOL)", "Buys by auto-followed wallets below this are logged but not alerted. Wallets you add always alert.")}
      </div></div>
    <div class="card"><div class="card-head"><h2>Filters</h2><small>higher = fewer, stronger signals</small></div>
      <div class="form">
        ${num("minSafety", "Minimum safety", "0–100 from RugCheck. Coins with any “danger” risk never signal. Applies to every alert type, wallet buys included.")}
        ${num("minExitLiq", "Smallest sellable pool ($)", "A pool holding less than this is treated as unsellable: no signals for the coin, its price is flagged, and its outcomes count as a total loss.")}
        ${num("launchScore", "New-launch score", "Score a coin under 2h old needs to raise a launch signal.")}
        ${num("momentumScore", "Momentum score", "Score any coin needs to raise a momentum signal.")}
        ${num("spikeMinVol", "Volume spike minimum ($ in 5m)", "Smallest 5-minute volume that counts as a spike.")}
        ${num("nurseryMinMcap", "Launch survival mcap ($)", "A pump.fun launch must reach this within ~4 minutes to be tracked.")}
        ${num("nurseryMinVol5m", "Launch survival volume ($ in 5m)", "…or trade this much in 5 minutes.")}
        ${num("maxTracked", "Max coins tracked", "Weakest coins are dropped past this.")}
      </div></div>
    <div class="card"><div class="card-head"><h2>This PC, backups and moving</h2><small>Blix runs here and nowhere else</small></div>
      <div class="plain">
        <p><b>It only works while this PC is on.</b> Blix runs hidden from login and restarts itself if it crashes. If the PC sleeps or shuts down, nothing is watched: launches, wallet buys and alert checkpoints in that window are simply missed, and the gap is logged on the <a class="linkish" href="#/health">Health</a> page. Closing this window changes nothing; Blix keeps running, but browser pop-ups stop, so set up Discord or Telegram above to keep getting alerts.</p>
        <p><b>It only answers this PC.</b> The dashboard is reachable at localhost only and refuses requests from other sites and devices. To check it from a phone, use the Discord or Telegram alerts. Do not expose port 4420 to the network or the internet: the dashboard has no login. If you want remote access later, put it behind a private VPN such as Tailscale, never a public port.</p>
        <p><b>Backups.</b> The database (${mb(bk.database.bytes)}) is copied to data/backups once a day and the two newest copies are kept${bk.last ? `; the last one was ${ago(bk.last)} ago` : "; none has been made yet"}. To restore, stop Blix and replace data/radar.db with a backup. The export below is a small file with your settings, followed wallets, alert rules and playbook, for moving to another PC.</p>
        <div class="filters"><button class="btn" type="button" id="bkNow">Back up now</button><a class="btn" href="/api/export" download>Export settings and wallets</a><a class="btn" href="/api/export?secrets=1" download title="Includes your webhook URL, bot token and keys in plain text. Keep the file private.">Export including secrets</a><label class="btn">Import…<input type="file" id="impFile" accept="application/json" hidden></label></div>
      </div></div>
  </form>`;
  const collect = () => {
    const f = $("#sform");
    const out = {};
    for (const el of f.querySelectorAll("input[name], select[name]")) {
      if (el.name === "notifyKinds") continue;
      out[el.name] = el.type === "checkbox" ? el.checked : el.value;
    }
    out.notifyKinds = [...f.querySelectorAll('input[name="notifyKinds"]:checked')].map((e) => e.value);
    return out;
  };
  $("#save").onclick = async () => { await post("settings", { settings: collect(), clear: [...clear] }); toast("Saved"); render(); };
  // Tests use what is typed in the form right now and save nothing.
  $("#testK").onclick = async () => {
    const r = await post("test-grok");
    toast(r.ok ? `Grok works${r.tier ? ` (${r.tier})` : ""}: ${r.model} answered in ${(r.ms / 1000).toFixed(1)}s` : r.error);
  };
  $("#testG").onclick = async () => {
    const r = await post("test-fast", { groqKey: $("#s-groqKey").value });
    toast(r.ok ? `Groq works: ${modelName(r.model)} answered in ${(r.ms / 1000).toFixed(2)}s. Press Save to keep the key.` : r.error);
  };
  $("#testN").onclick = async () => {
    const c = collect();
    const r = await post("test-notify", { discordWebhook: c.discordWebhook, telegramToken: c.telegramToken, telegramChat: c.telegramChat });
    toast(r.errors.length ? r.errors[0] : `Test delivered to ${r.sent.join(" and ")}. Press Save to keep these settings.`);
  };
  for (const b of main.querySelectorAll("[data-secret-clear]")) b.onclick = () => { clear.add(b.dataset.secretClear); b.disabled = true; b.textContent = "Removed on Save"; };
  for (const b of main.querySelectorAll("[data-rule-del]")) b.onclick = async () => { await api(`alerts/${b.dataset.ruleDel}`, { method: "DELETE" }); toast("Rule removed"); render(); };
  $("#ruleKindAdd").onclick = async () => { await post("alerts", { scope: "kind", target: $("#ruleKind").value, effect: "mute" }); toast("Alert type muted"); render(); };
  $("#bkNow").onclick = async (e) => { e.target.disabled = true; e.target.textContent = "Backing up…"; try { await post("backup"); toast("Backup written to data/backups"); } catch (err) { toast(err.message); } render(); };
  $("#impFile").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { const r = await post("import", JSON.parse(await file.text())); toast(`Imported ${r.wallets} wallets, ${r.rules} rules, ${r.settings} settings`); render(); }
    catch (err) { toast(`Import failed: ${err.message}`); }
  };
  // The remote link holds the access key, so the server only hands it to a local page.
  api("remote-link").then((r) => { const el = $("#remoteLink"); if (!el) return; el.innerHTML = r.link ? `<a class="linkish" href="${esc(r.link)}" target="_blank" rel="noreferrer">${esc(r.link)}</a> <button class="btn sm-btn" data-copy="${esc(r.link)}">Copy</button>` : "Remote access is off (no public hostname)."; })
    .catch(() => { const el = $("#remoteLink"); if (el) el.textContent = "Only shown on the local copy (localhost:4420)."; });
}

// ---------- health ----------
const HSTATE = { ok: "Working", degraded: "Degraded", down: "Down", off: "Not set up", idle: "Not used yet" };
async function viewHealth(main) {
  const h = await api("health");
  const when = (t) => t ? `${mins(Date.now() - t)} ago` : "never";
  const group = (title, keys) => { const rows = h.parts.filter((p) => keys.includes(p.key)); return rows.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>${title}</h2><small>${rows.filter((p) => p.state === "ok").length} of ${rows.filter((p) => !["off", "idle"].includes(p.state)).length} in use working</small></div>
    ${rows.map((p) => `<div class="hrow hs-${p.state}"><span class="hstate">${HSTATE[p.state] || p.state}</span><div class="hmain"><b>${esc(p.name)}</b><p>${esc(p.summary)}</p>
      ${p.fix ? `<p class="hfix"><b>What to do:</b> ${esc(p.fix)}</p>` : ""}</div>
      <div class="htimes">${p.lastOk || p.lastFail ? `<span>last success <b>${when(p.lastOk)}</b></span>` : ""}${p.lastFail ? `<span>last failure <b>${when(p.lastFail)}</b></span>` : ""}${p.lastError && p.state !== "ok" ? `<span class="down" title="${esc(p.lastError)}">${esc(String(p.lastError).slice(0, 70))}</span>` : ""}</div></div>`).join("")}</div>` : ""; };
  main.innerHTML = `<div class="page-head"><div><h1>Health</h1><p>Everything Blix depends on: whether it is working, when it last worked, and what went wrong. “Connected” in the corner only means this page can reach Blix; this page is what tells you whether the data behind it is current.</p></div>
      <div class="desk-stats"><span class="pill ${h.issues ? "warn-pill" : ""}">${h.issues ? `${h.issues} issue${h.issues > 1 ? "s" : ""}` : "No issues"}</span><span class="pill">running ${mins(Date.now() - h.startedAt)}</span></div></div>
    ${group("Market data", ["launches", "trades", "scan", "dexscreener", "geckoterminal", "rugcheck", "freshness"])}
    ${group("Wallet tracking", ["rpc", "wallets", "fomo"])}
    ${group("AI", ["ai-lanes", "grok", "groq", "claude", "queue", "scout", "briefs"])}
    ${group("Alerts and data", ["delivery", "discord", "telegram", "backup", "stability"])}
    <div class="card"><div class="card-head"><h2>Recent problems and system events</h2><small>newest first</small></div>
      ${h.events.length ? h.events.map((e) => `<div class="risk"><i style="background:${e.kind === "error" ? "var(--down)" : "var(--info)"}"></i><div><b>${esc(e.text)}</b><small>${ago(e.t)} ago</small></div></div>`).join("") : `<p class="note pad">Nothing logged.</p>`}</div>`;
}
setInterval(() => { if (route() === "health" && !document.hidden) viewHealth($("#main")).catch(() => {}); }, 10_000);

// ---------- API ----------
// The endpoint list lives in api-docs.js, shared with the public docs page (worker/).
async function viewApi(main) {
  const { API_DOCS, API_EVENTS } = await import("/api-docs.js");
  const base = location.origin, n = API_DOCS.reduce((a, [, rows]) => a + rows.length, 0);
  const row = ([m, p, d, run]) => `<tr><td class="mono">${m}</td><td><code data-copy="${esc(base + p)}" title="Copy URL">${esc(p)}</code></td><td>${esc(d)}</td><td>${run ? `<button class="btn sm-btn" data-run="${esc(p.split("?")[0])}">Run</button>` : ""}</td></tr>`;
  const wrap = document.createElement("div");
  wrap.className = "apidoc";
  wrap.innerHTML = `<div class="page-head"><div><h1>API</h1><p>Blix serves JSON over plain HTTP and one live event stream. This dashboard is just a client of it, so anything shown here can be read from a script, a bot or your own front end. <b>No key on this PC</b>; through the remote link every call needs the <code>blix_key</code> cookie.</p></div>
      <div class="desk-stats"><span class="pill mono" data-copy="${esc(base)}" title="Copy base URL">${esc(base)}</span><span class="pill">${n} endpoints</span></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Live stream</h2><small><code data-copy="${esc(base)}/api/stream" title="Copy URL">GET /api/stream</code> · text/event-stream</small></div>
      <div class="table-wrap"><table><thead><tr><th>Event</th><th>Payload</th><th>When</th></tr></thead><tbody>${API_EVENTS.map(([e, p, w]) => `<tr><td class="mono">${e}</td><td>${esc(p)}</td><td>${w}</td></tr>`).join("")}</tbody></table></div>
      <pre>curl -N ${esc(base)}/api/stream

const es = new EventSource("${esc(base)}/api/stream");
es.addEventListener("signal", (e) => console.log(JSON.parse(e.data)));</pre></div>
    ${API_DOCS.map(([title, rows]) => `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>${title}</h2><small>${rows.length} endpoints</small></div>
      <div class="table-wrap"><table><thead><tr><th>Method</th><th>Path</th><th>Returns</th><th></th></tr></thead><tbody>${rows.map(row).join("")}</tbody></table></div></div>`).join("")}
    <div class="card"><div class="card-head"><h2>Errors</h2></div><p class="note pad">Errors are JSON <code>{ error: "human sentence" }</code> with a 4xx or 5xx status. Rate-limited upstreams (public RPC, DexScreener) are reported on <a class="linkish" href="#/health">Health</a>, not as request errors. Responses are cached for 1 to 60 seconds, so polling faster returns the same body.</p></div>`;
  // Run: fetch the endpoint and show the response under its row; a second press closes it.
  wrap.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-run]");
    if (!b) return;
    const tr = b.closest("tr");
    if (tr.nextElementSibling?.classList.contains("api-res")) { tr.nextElementSibling.remove(); b.textContent = "Run"; return; }
    b.disabled = true;
    let text, t0 = performance.now(), status = "";
    try {
      const r = await fetch(b.dataset.run, { signal: AbortSignal.timeout(20_000) });
      const body = await r.text();
      status = `${r.status} · ${Math.round(performance.now() - t0)} ms · ${(body.length / 1024).toFixed(1)} KB`;
      try { text = JSON.stringify(JSON.parse(body), null, 2); } catch { text = body; }
    } catch (err) { text = err.message; status = "failed"; }
    b.disabled = false; b.textContent = "Hide";
    const MAX = 6000;
    tr.insertAdjacentHTML("afterend", `<tr class="api-res"><td colspan="4"><small>${status}${text.length > MAX ? ` · first ${MAX} characters` : ""}</small><pre>${esc(text.slice(0, MAX))}</pre></td></tr>`);
  });
  main.replaceChildren(wrap);
}

// ---------- MCP ----------
// How to plug an AI client into Blix, and the tools it gets. The tool list is the same module the
// MCP server (mcp/blix-mcp.mjs) loads, so this page cannot drift from what the server offers.
async function viewMcp(main) {
  const { MCP_TOOLS } = await import("/mcp-tools.js");
  const script = "<blix folder>/mcp/blix-mcp.mjs";
  const SETUP = [
    ["Claude Code", "run once in a terminal", `claude mcp add blix -- node "${script}"`],
    ["Claude Desktop, Cursor", "add to the client's MCP config file", JSON.stringify({ mcpServers: { blix: { command: "node", args: [script] } } }, null, 2)],
    ["Codex", "add to ~/.codex/config.toml", `[mcp_servers.blix]\ncommand = "node"\nargs = ["${script}"]`],
  ];
  const args = (t) => Object.entries(t.props || {}).map(([k, p]) => `<code title="${esc(p.description || (p.enum || []).join(" | "))}">${k}${(t.required || []).includes(k) ? "" : "?"}</code>`).join(" ") || `<span class="dim">none</span>`;
  const wrap = document.createElement("div");
  wrap.className = "apidoc";
  wrap.innerHTML = `<div class="page-head"><div><h1>MCP</h1><p>Plug Claude, Cursor or Codex into Blix. The MCP server is a small script with no dependencies that turns the <a class="linkish" href="#/api">API</a> into tools an AI can call: ask it what is running, why a coin was flagged, or to paper trade a call. <b>It reads only, plus the paper desk</b>; nothing here can spend real funds. Blix has to be running.</p></div>
      <div class="desk-stats"><span class="pill">${MCP_TOOLS.length} tools</span><span class="pill">stdio</span></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Connect a client</h2><small>replace <code>&lt;blix folder&gt;</code> with where Blix is installed · click a block to copy</small></div>
      ${SETUP.map(([name, how, code]) => `<div class="mcp-setup"><b>${name}</b><small>${how}</small><pre data-copy="${esc(code)}" title="Copy">${esc(code)}</pre></div>`).join("")}
      <p class="note pad">Another install or port: set <code>BLIX_URL</code> (for example <code>http://localhost:4420</code>) in the client's environment for this server.</p></div>
    <div class="card"><div class="card-head"><h2>Tools</h2><small>every tool also takes <code>limit</code> (rows per list, default 10, max 50)</small></div>
      <div class="table-wrap"><table><thead><tr><th>Tool</th><th>Arguments</th><th>What it does</th><th></th></tr></thead><tbody>
      ${MCP_TOOLS.map((t) => `<tr><td class="mono">${t.name}</td><td>${args(t)}</td><td>${esc(t.description)}</td><td>${t.write ? `<span class="pill">paper</span>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
  main.replaceChildren(wrap);
}

// ---------- coin drawer ----------
// Price while tracked, with 5-minute volume underneath and a marker for every alert and every trade by
// a wallet you follow. Only sellable readings are drawn; readings from an emptied pool are left out.
// Plain-text price for chart labels (no subscript markup): three significant figures, never exponent form.
const plainPrice = (p) => !p ? "$0" : p >= 1 ? `$${p.toFixed(2)}` : `$${p.toFixed(Math.min(14, 2 - Math.floor(Math.log10(p))))}`;
const chartState = { tf: "24h" };
const TF = { "1h": 3600e3, "6h": 6 * 3600e3, "24h": 864e5, "3d": 3 * 864e5 };
function coinChart(r) {
  const from = Date.now() - TF[chartState.tf];
  const inRange = r.snapshots.filter((s) => s.price > 0 && s.t >= from);
  const pts = inRange.filter((s) => s.ok !== 0);
  const dropped = inRange.length - pts.length;
  const tabs = `<div class="chips tf">${Object.keys(TF).map((k) => `<button class="chip ${chartState.tf === k ? "on" : ""}" data-tf="${k}">${k}</button>`).join("")}</div>`;
  if (pts.length < 2) return `${tabs}<p class="note">${r.snapshots.length ? "Not enough readings in this window. Try a longer one." : r.untracked ? "Blix is not tracking this coin yet, so it has no price history." : "Price history builds up while Blix watches this coin."}</p>`;
  const W = 760, H = 250, PH = 160, VY = 176, VH = 56;
  const x0 = pts[0].t, x1 = Math.max(pts[pts.length - 1].t, x0 + 1), ys = pts.map((p) => p.price);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (t) => ((t - x0) / (x1 - x0)) * W, Y = (v) => PH - 6 - ((v - y0) / Math.max(y1 - y0, 1e-18)) * (PH - 16);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.price).toFixed(1)}`).join("");
  const up = ys[ys.length - 1] >= ys[0];
  // Nearest drawn price to a moment, so a marker sits on the line.
  const priceAt = (t) => pts.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b), pts[0]).price;
  const vmax = Math.max(...pts.map((p) => p.vol_m5 || 0), 1), bw = Math.max(1.5, (W / pts.length) * 0.7);
  const bars = pts.map((p) => `<rect x="${(X(p.t) - bw / 2).toFixed(1)}" y="${(VY + VH - ((p.vol_m5 || 0) / vmax) * VH).toFixed(1)}" width="${bw.toFixed(1)}" height="${(((p.vol_m5 || 0) / vmax) * VH).toFixed(1)}"/>`).join("");
  const time = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sigs = r.signals.filter((s) => s.t >= x0 && s.t <= x1).map((s) => {
    const x = X(s.t), y = Y(s.price > 0 && s.price >= y0 && s.price <= y1 ? s.price : priceAt(s.t)), bad = BAD.has(s.kind);
    return `<path class="mk" d="M${x.toFixed(1)},${(y - (bad ? -9 : 9)).toFixed(1)}l-5,${bad ? 9 : -9}h10z" fill="${s.safe === 0 ? "var(--muted)" : kindOf(s.kind)[1]}"><title>${esc(`${kindOf(s.kind)[0]}${s.safe === 0 ? " (not safety-screened)" : ""} · ${time(s.t)}\n${s.title}`)}</title></path>`;
  }).join("");
  const trades = (r.walletTrades || []).filter((w) => w.t >= x0 && w.t <= x1).map((w) => `<circle class="mk" cx="${X(w.t).toFixed(1)}" cy="${Y(priceAt(w.t)).toFixed(1)}" r="4.5" fill="${w.side === "buy" ? "var(--up)" : "var(--down)"}" stroke="#07080c" stroke-width="1.5"><title>${esc(`${w.label || shortAddr(w.wallet)} ${w.side === "buy" ? "bought" : "sold"} ${usd(w.usd)} · ${time(w.t)}`)}</title></circle>`).join("");
  return `${tabs}<svg class="chart2" viewBox="0 0 ${W} ${H}" role="img" aria-label="Price, volume, alerts and followed-wallet trades">
    <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? "var(--color-up)" : "var(--color-down)"}" stop-opacity=".22"/><stop offset="1" stop-color="${up ? "var(--color-up)" : "var(--color-down)"}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${W},${PH}L0,${PH}Z" fill="url(#fill)"/><path d="${d}" fill="none" stroke="${up ? "var(--up)" : "var(--down)"}" stroke-width="2"/>
    <g class="vol">${bars}</g>${sigs}${trades}
    <text x="4" y="12">${plainPrice(y1)}</text><text x="4" y="${PH - 2}">${plainPrice(y0)}</text>
    <text x="4" y="${H - 2}">${time(x0)}</text><text x="${W - 4}" y="${H - 2}" text-anchor="end">${time(x1)}</text><text x="${W - 4}" y="${VY + 10}" text-anchor="end">5m volume, peak ${money(vmax)}</text></svg>
    <div class="legend"><span><i class="lg-tri"></i>alert (points down for a warning)</span><span><i class="lg-dot up-bg"></i>followed wallet bought</span><span><i class="lg-dot down-bg"></i>followed wallet sold</span><span><i class="lg-bar"></i>volume</span><span class="dim">hover a marker for details</span></div>
    <p class="note">${pts.length} readings · price is now ${mult(ys[ys.length - 1] / ys[0])} what it was at the start of this window${dropped ? ` · ${dropped} reading${dropped > 1 ? "s" : ""} from an emptied pool left out` : ""}</p>`;
}

function fomoFlowSection(f) {
  if (!f || (!f.buyers && !f.sellers && !f.recent?.length)) return "";
  return `<div class="p-sec"><h3><span class="fomo-mark">fomo</span> Fomo traders on this coin</h3>
    <div class="facts">
      <div class="fact"><b>Buyers 1h</b><span class="up">${f.buyers || 0}</span></div>
      <div class="fact"><b>Sellers 1h</b><span class="down">${f.sellers || 0}</span></div>
      <div class="fact"><b>Bought 1h</b><span>${money(f.bought || 0)}</span></div>
      <div class="fact"><b>Sold 1h</b><span>${money(f.sold || 0)}</span></div>
    </div>
    ${f.recent.length ? `<div class="leaders" style="margin-top:10px">${f.recent.map((x) => `<div class="leader" data-wallet="${esc(x.wallet)}">${wav(x.wallet, { handle: x.handle, source: "fomo" }, "sm")}<span class="grow"><b>${x.handle ? "@" + esc(x.handle) : shortAddr(x.wallet)}</b> <span class="dim">${x.side === "buy" ? "bought" : "sold"} ${ago(x.t)} ago</span></span><span class="num ${x.side === "buy" ? "up" : "down"}">${money(x.usd)}</span></div>`).join("")}</div>` : ""}
  </div>`;
}

function holdersSection(t, s) {
  if (!s || s.totalHolders == null) return "";
  const flag = (bad, text) => `<span class="${bad ? "down" : "up"}">${text}</span>`;
  return `<div class="p-sec"><h3>Holders & dev <span class="dim">· from RugCheck, ${t.safety_checked ? `${ago(t.safety_checked)} ago` : "time unknown"}</span></h3>
    <div class="facts">
      <div class="fact"><b>Holders</b><span>${s.totalHolders.toLocaleString()}</span></div>
      <div class="fact"><b>Top 10 hold</b><span>${flag(s.top10 > 35, s.top10.toFixed(1) + "%")}</span></div>
      <div class="fact"><b>Insiders hold</b><span>${flag(s.insiderPct > 15, s.insiderPct.toFixed(1) + "%")}</span></div>
      <div class="fact"><b>Dev holds</b><span>${flag(s.devPct > 5, s.devPct.toFixed(2) + "%")}</span></div>
    </div>
    <p class="note" style="margin:10px 0">${s.insiderNetworks ? `${s.insiderNetworks} insider networks (wallets funded from each other). ` : ""}${s.devLaunches ? `The dev has launched ${s.devLaunches} other coins. ` : ""}${s.creator ? `Dev wallet: <span class="linkish" data-wallet="${esc(s.creator)}">${shortAddr(s.creator)}</span>` : ""}</p>
    ${s.holders?.length ? `<div class="leaders">${s.holders.slice(0, 10).map((h, i) => `<div class="leader" data-wallet="${esc(h.owner)}"><span class="num dim" style="width:22px">${i + 1}</span>${wav(h.owner, {}, "xs")}<span class="grow num">${shortAddr(h.owner)}${h.insider ? ' <span class="pill" style="color:var(--down)">insider</span>' : ""}</span><span class="num">${h.pct.toFixed(2)}%</span></div>`).join("")}</div>` : ""}
  </div>`;
}

// ---------- the side sheet (coin and wallet detail) ----------
// It moves on a spring rather than a fixed animation, so it can be caught and turned around at any moment:
// every move starts from where the sheet is on screen right now, at the speed it is already going. Drag it
// by its header to throw it shut; it leaves the way it came in.
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)");
const sheet = { x: null, v: 0, target: 1, raf: 0, last: 0, drag: null, onRest: null };
const sheetW = () => $("#panel").offsetWidth || 840;
function sheetPaint() {
  const p = $("#panel"), w = sheetW();
  p.style.transform = `translate3d(${sheet.x.toFixed(1)}px,0,0)`;
  $("#drawer .scrim").style.opacity = Math.max(0, Math.min(1, 1 - sheet.x / w)).toFixed(3);
}
// damping 1 = settles without overshoot; below 1 it bounces (only used after a throw). response = seconds.
function sheetTo(open, { velocity = sheet.v, damping = 1, response = 0.36 } = {}) {
  const w = sheetW(), to = open ? 0 : w;
  sheet.target = open ? 0 : 1; sheet.v = velocity;
  if (sheet.x == null) sheet.x = w;
  if (REDUCED.matches) { sheet.x = to; sheet.v = 0; sheetPaint(); cancelAnimationFrame(sheet.raf); sheet.raf = 0; return sheetRest(); }
  const k = (2 * Math.PI / response) ** 2, c = 2 * damping * Math.sqrt(k);
  cancelAnimationFrame(sheet.raf);
  sheet.last = performance.now();
  const tick = (now) => {
    let dt = Math.min(0.064, (now - sheet.last) / 1000); sheet.last = now;
    while (dt > 0) { const h = Math.min(dt, 0.004); sheet.v += (-k * (sheet.x - to) - c * sheet.v) * h; sheet.x += sheet.v * h; dt -= h; }
    if (Math.abs(sheet.x - to) < 0.5 && Math.abs(sheet.v) < 8) { sheet.x = to; sheet.v = 0; sheetPaint(); sheet.raf = 0; return sheetRest(); }
    sheetPaint();
    sheet.raf = requestAnimationFrame(tick);
  };
  sheet.raf = requestAnimationFrame(tick);
}
function sheetRest() {
  if (sheet.target !== 1) return;
  $("#drawer").hidden = true; $("#panel").innerHTML = ""; sheet.x = null;
}
function sheetOpen() {
  const d = $("#drawer");
  if (d.hidden) { d.hidden = false; sheet.x = sheetW(); sheet.v = 0; sheetPaint(); }
  if (sheet.target !== 0 || sheet.x > 0.5) sheetTo(true);
}
const drawerOpen = () => !$("#drawer").hidden && sheet.target === 0;
// Where a flick would come to rest if nothing stopped it (the same decay scrolling uses).
const project = (v, rate = 0.998) => (v / 1000) * rate / (1 - rate);
const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
document.addEventListener("pointerdown", (e) => {
  const head = e.target.closest?.("#panel .hero, #panel .p-head");
  if (!head || e.button !== 0 || e.target.closest("a, button, input, select, textarea")) return;
  sheet.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: sheet.x ?? 0, live: false, hist: [[e.timeStamp, e.clientX]] };
});
document.addEventListener("pointermove", (e) => {
  const g = sheet.drag;
  if (!g || e.pointerId !== g.id) return;
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if (!g.live) {
    // Wait for a clear sideways move before taking over, so text selection and scrolling still work.
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) { if (Math.abs(dy) > 14) sheet.drag = null; return; }
    g.live = true; g.x0 = e.clientX; g.base = sheet.x ?? 0;
    cancelAnimationFrame(sheet.raf); sheet.raf = 0;
    try { $("#panel").setPointerCapture(g.id); } catch {}
    $("#panel").classList.add("dragging");
    return;
  }
  const raw = g.base + (e.clientX - g.x0);
  sheet.x = raw < 0 ? -rubber(-raw, sheetW()) : raw;       // past fully open it resists instead of stopping dead
  g.hist.push([e.timeStamp, e.clientX]); if (g.hist.length > 6) g.hist.shift();
  sheetPaint();
});
const sheetDrop = (e) => {
  const g = sheet.drag;
  if (!g || e.pointerId !== g.id) return;
  sheet.drag = null;
  if (!g.live) return;
  $("#panel").classList.remove("dragging");
  const a = g.hist[0], b = g.hist[g.hist.length - 1], v = b[0] > a[0] ? ((b[1] - a[1]) / (b[0] - a[0])) * 1000 : 0;
  // The decision comes from where the throw is heading, not from where the finger let go.
  const shut = sheet.x + project(v) > sheetW() * 0.5;
  if (shut) { coinData = null; sheetTo(false, { velocity: v, damping: 1, response: 0.3 }); }
  else sheetTo(true, { velocity: v, damping: 0.8, response: 0.3 });
};
document.addEventListener("pointerup", sheetDrop);
document.addEventListener("pointercancel", sheetDrop);

const SRC_NAME = { dexscreener: "DexScreener" };
let coinData = null;
async function openCoin(mint) {
  const p = $("#panel");
  sheetOpen();
  p.innerHTML = `<div class="skel" style="margin-top:22px"></div><div class="skel"></div><div class="skel"></div>`;
  let r;
  try { r = await api(`token/${mint}`); } catch (e) { p.innerHTML = `<button class="close" data-close aria-label="Close">✕</button>${empty("Couldn't load this coin", e.message)}`; return; }
  coinData = r;
  const t = r.token, s = t.safety, f = t.fresh, v = r.verdict, L = r.live;
  const links = t.links || [];
  const dex = `https://dexscreener.com/solana/${t.pair || t.mint}`;
  const cls_ = t.asset_class || "meme";
  // Everything that makes the headline price less than it looks, said once, at the top.
  const warn = [];
  if (r.untracked) warn.push(["info", "Not tracked yet", "Blix only adopts launches that show real trading. These numbers come from the live pump.fun trade feed; safety, holders and price history appear once it is tracked."]);
  if (f.dead) warn.push(["bad", "This coin is dead", `Trading dried up and Blix stopped following it. The price shown is the last one read${f.priceT ? `, ${mins(f.ageMs)} ago` : ""}, not a live quote.`]);
  if (f.quarantine || f.illiquid) warn.push(["bad", "The price shown cannot be traded at", `${f.exitWhy || f.quarantine}. With almost nothing in the pool, any “price” or market cap is a number on a screen: holders cannot sell for it. Past highs for this coin are price peaks, not exits.`]);
  else if (f.stale && !f.dead && f.priceT) warn.push(["old", "Price is behind", `Last read ${mins(f.ageMs)} ago from ${SRC_NAME[f.source] || f.source}. Active coins are normally re-priced every 30 seconds to 2 minutes.`]);
  if (cls_ !== "meme") warn.push(["info", `Not a memecoin: ${r.classOptions[cls_] || cls_}`, "It is kept out of signals, narratives, research and the track record."]);
  const fresh = f.priceT ? `price read ${mins(f.ageMs)} ago · ${esc(SRC_NAME[f.source] || f.source || "")}` : "no price yet";
  const fact = (b, val, extra = "") => `<div class="fact"><b>${b}</b><span ${extra}>${val}</span></div>`;
  const tx = L ? `${L.buys} / ${L.sells}` : t.buys_h1 != null ? `${t.buys_h1} / ${t.sells_h1}` : "—";
  p.innerHTML = `
    <div class="hero">
      <div class="banner">${t.header ? `<img src="${esc(safeHref(t.header))}" alt="" data-drop>` : ""}<span class="banner-gen" style="background-image:url('${genAvatar(t.mint + "banner")}')"></span></div>
      <button class="close" data-close aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="hero-body">
        <div class="hero-av">${av(t, "xl")}</div>
        <div class="hero-id"><h2>$${esc(t.symbol || "?")}</h2>
          <div class="sub">${esc(t.name || "")} · ${(() => { const i = protoInfo(t); return `launched on ${esc(i.full)}${i.venue ? ` · bonded, trades on ${esc(i.venue[1])}` : t.dex ? ` · ${esc(DEX_NAME[t.dex] || t.dex)}` : ""} · Solana`; })()} · ${ago(t.pair_created || t.first_seen)} old</div>
          <div class="chips">${r.untracked ? '<span class="pill">Safety unchecked</span>' : safetyChip(t.safety_score)}${stateTags(f)}${(t.themes || []).map((x) => `<span class="pill">${esc(x)}</span>`).join("")}${r.triage ? `<span class="pill" title="${esc(r.triage.why || "")}">triage: ${esc(r.triage.label)} ${r.triage.score}</span>` : ""}</div></div>
        <div class="hero-price ${f.exitable || r.untracked ? "" : "unreliable"}"><span class="big num">${price(t.price)}</span><span class="chg ${cls(t.chg_h1)}">${t.chg_h1 != null ? `${pct(t.chg_h1)} <small>1h</small>` : L?.chg1m != null ? `${pct(L.chg1m)} <small>1m</small>` : ""}</span><small class="dim">${money(t.mcap)} mcap</small><small class="fresh ${f.stale ? "old" : ""}">${fresh}</small>${r.progress != null && !t.graduated ? `<div class="bond hero-bond"><div class="bond-bar"><i style="width:${Math.round(r.progress * 100)}%"></i></div><span class="num">${Math.round(r.progress * 100)}% bonded</span></div>` : ""}</div>
      </div>
    </div>
    ${warn.map(([k, title, text]) => `<div class="p-sec tight"><div class="warn-box w-${k}"><b>${esc(title)}.</b> ${esc(text)}</div></div>`).join("")}
    <div class="p-acts">
      ${f.exitable || r.untracked ? fomoBtn(t.mint, true) : ""}
      <a class="btn" href="${esc(dex)}" target="_blank" rel="noreferrer">DexScreener</a>
      <a class="btn" href="https://pump.fun/coin/${esc(t.mint)}" target="_blank" rel="noreferrer">pump.fun</a>
      <a class="btn" href="https://rugcheck.xyz/tokens/${esc(t.mint)}" target="_blank" rel="noreferrer">RugCheck</a>
      ${links.map(linkBtn).join("")}
      <button class="btn" data-copy="${esc(t.mint)}">Copy contract</button>
      ${r.untracked ? "" : `<button class="btn ${r.rule === "always" ? "on" : ""}" data-rule="coin" data-target="${esc(t.mint)}" data-effect="${r.rule === "always" ? "" : "always"}" title="Always push this coin's alerts, whatever the cooldown or quiet hours">${r.rule === "always" ? "★ Watching" : "☆ Watch"}</button>
      <button class="btn ${r.rule === "mute" ? "on" : ""}" data-rule="coin" data-target="${esc(t.mint)}" data-effect="${r.rule === "mute" ? "" : "mute"}">${r.rule === "mute" ? "Muted · unmute" : "Mute alerts"}</button>`}
    </div>
    <div class="p-sec"><h3>Chart <span class="dim">· market cap, real trades</span></h3><div id="tradeChart"></div></div>
    <div class="p-sec"><h3>Trade <span class="dim">· paper, filled at real quotes</span></h3><div id="tradePanel"></div></div>
    <div class="p-sec"><div class="mint-row"><span class="mint">${esc(t.mint)}</span><span class="dim small">${t.dex ? esc(DEX_NAME[t.dex] || t.dex) : "no market yet"} · first seen ${ago(t.first_seen)} ago</span></div>
      ${r.sameTicker.length ? `<div class="warn-box w-old" style="margin-top:10px"><b>${r.sameTicker.length} other coin${r.sameTicker.length > 1 ? "s use" : " uses"} the ticker $${esc(t.symbol)}.</b> A shared name means nothing: check the contract above. ${r.sameTicker[0].mcap > (t.mcap || 0) ? "This one is not the largest." : "This one is the largest Blix tracks."}
        <div class="leaders" style="margin-top:8px">${r.sameTicker.slice(0, 5).map((x) => `<div class="leader" data-mint="${esc(x.mint)}">${av(x, "xs")}<span class="grow"><span class="mono">${shortAddr(x.mint)}</span> <span class="dim">${esc(DEX_NAME[x.dex] || x.dex || "")} · ${ago(x.born)} old${x.status === "dead" ? " · dead" : ""}</span></span><span class="num">${money(x.mcap)}</span></div>`).join("")}</div></div>` : ""}</div>
    ${r.untracked ? "" : `<div class="p-sec tight"><div class="verdict-box ${v.ok ? "pass" : v.unknown ? "unknown" : "fail"}"><b>${v.ok ? "Passes the safety policy" : v.unknown ? "Not safety-checked yet" : "Fails the safety policy"}</b>${v.ok ? `<span>RugCheck ${t.safety_score}/100, no danger risks, sellable pool. Coins that pass can raise signals; passing is not a guarantee.</span>` : `<ul>${v.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><span>No approved signal can fire for this coin while this holds. Wallet buys in it are filed as unscreened activity.</span>`}</div></div>`}
    <div class="p-sec"><div class="facts">
      ${fact("Price", price(t.price))}${fact("Mcap", money(t.mcap))}
      ${fact("Liquidity", f.onCurve ? "on curve" : money(t.liquidity), f.onCurve ? 'title="Still on a bonding curve: the curve is the market, there is no pool yet"' : "")}${fact("Peak mcap", money(t.peak_mcap), 'title="Highest market cap from sellable readings"')}
      ${fact("Vol 5m", t.vol_m5 != null ? money(t.vol_m5) : "—")}${fact(L && t.vol_h1 == null ? "Vol (live)" : "Vol 1h", t.vol_h1 != null ? money(t.vol_h1) : L ? money(L.vol) : "—")}
      ${fact("5m / 1h", t.chg_m5 != null ? `<span class="${cls(t.chg_m5)}">${pct(t.chg_m5)}</span> <span class="${cls(t.chg_h1)}">${pct(t.chg_h1)}</span>` : "—")}
      ${fact(L ? "Buys / sells (live)" : "Buys / sells 1h", tx)}
      ${fact("Score", r.untracked ? "—" : `${t.score}/100`)}${fact("Safety", t.safety_score != null ? `${t.safety_score}/100` : "—")}
      ${fact("LP locked", s?.lpLockedPct != null ? Math.round(s.lpLockedPct) + "%" : "—")}${fact(L ? "Traders (live)" : "Age", L ? L.traders : ago(t.pair_created || t.first_seen))}
    </div><p class="note" style="margin:8px 0 0">“—” means Blix has no reading for that field yet, not zero.</p></div>
    ${researchSection(r.research, t.mint)}
    ${paperSection(t, r.paper)}
    ${ledgerSection(r.holders)}
    ${holdersSection(t, s)}
    ${r.wallets?.length ? `<div class="p-sec"><h3>Wallets you follow in this coin</h3>${r.wallets.map((w) => `<div class="leader" data-wallet="${esc(w.wallet)}">${wav(w.wallet, w, "sm")}<span class="grow"><b>${esc(w.label || shortAddr(w.wallet))}</b> <span class="dim">first in ${ago(w.first)} ago</span></span><span class="num up">${w.bought ? "+" + money(w.bought) : ""}</span><span class="num down" style="width:70px;text-align:right">${w.sold ? "−" + money(w.sold) : ""}</span></div>`).join("")}</div>` : ""}
    ${fomoFlowSection(r.fomo)}
    <div class="p-sec"><h3>Safety check</h3>${s ? (s.risks.length ? `<div class="risks">${s.risks.map((x) => `<div class="risk"><i style="background:${x.level === "danger" ? "var(--down)" : x.level === "warn" ? "var(--warn)" : "var(--info)"}"></i><div><b>${esc(x.name)}</b>${x.value ? ` <span class="dim">${esc(x.value)}</span>` : ""}<small>${esc(x.description || "")}</small></div></div>`).join("")}</div>` : `<p class="up">RugCheck found no risks.</p>`) : `<p class="note">Not checked yet. Coins are checked when they first show real trading.</p>`}</div>
    ${r.signals.length ? `<div class="p-sec"><h3>Signals</h3>${r.signals.map((x) => `<div class="risk"><i style="background:${x.safe === 0 ? "var(--muted)" : kindOf(x.kind)[1]}"></i><div><b>${esc(x.title)}</b> <span class="dim">${ago(x.t)} ago</span>${x.safe === 0 ? ' <span class="st bad">not safety-screened</span>' : ""}<small>${esc(x.detail)}${x.p1h != null ? ` · 1h later: ${x.illiq && x.p1h === 0 ? "unsellable" : mult(x.p1h)}` : ""}${x.peak != null ? ` · price peak ${mult(x.peak)}` : ""}</small></div></div>`).join("")}</div>` : ""}
    ${t.description ? `<div class="p-sec"><h3>About <span class="dim">· written by the coin's creator</span></h3><p style="margin:0;color:var(--ink-2)">${esc(t.description)}</p></div>` : ""}
    ${r.untracked ? "" : `<div class="p-sec"><details class="fix"><summary>Wrong category? Fix it</summary>
      <p class="note" style="margin:8px 0">Your correction replaces the automatic one and stays put.</p>
      <div class="checks">${r.themeOptions.map((x) => `<label class="check"><input type="checkbox" name="fixTheme" value="${esc(x)}" ${(t.themes || []).includes(x) ? "checked" : ""}> ${esc(x)}</label>`).join("")}</div>
      <div class="filters" style="margin:10px 0 0"><select class="input" id="fixClass">${Object.entries(r.classOptions).map(([k, l]) => `<option value="${k}" ${cls_ === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <button class="btn primary" data-fix="${esc(t.mint)}">Save category</button>${t.themes_user || t.class_user ? `<button class="btn" data-fix-reset="${esc(t.mint)}">Back to automatic</button>` : ""}</div></details></div>`}
    ${t.pair ? `<div class="p-sec"><h3>Full chart <span class="dim">· DexScreener</span></h3><iframe class="embed" src="https://dexscreener.com/solana/${esc(t.pair)}?embed=1&theme=dark&trades=0&info=0" title="DexScreener chart" loading="lazy"></iframe></div>` : ""}`;
  p.scrollTop = 0;
  mountChart($("#tradeChart"), r);
  mountPanel($("#tradePanel"), r, { onTrade: (side, pos, desk) => { pulseState.desk = desk; renderDesk(); beep(side); toast(side === "buy" ? `Paper buy $${pos.symbol || ""}: ${pos.sol} SOL for ${Math.round(pos.tokens || 0).toLocaleString()} tokens (${pos.fill?.src || ""})` : `Paper sell $${pos.symbol || ""}`); } });
}
// Refresh the open coin page (or the desk) when its research finishes.
function pollResearch(mint, tries = 0) {
  setTimeout(async () => {
    const r = await api(`research/${mint}`).catch(() => null);
    if (r?.status === "deep" && !pollResearch.shown?.has(mint)) {
      (pollResearch.shown ||= new Set()).add(mint);
      if (drawerOpen() && $("#panel").innerHTML.includes(mint)) openCoin(mint);
      toast(`Fast read: ${r.grade}. Waiting for the deep read`);
    }
    if (r?.status === "done" || r?.status === "error" || r?.status === "expired" || tries > 60) {
      if (drawerOpen() && $("#panel").innerHTML.includes(mint)) openCoin(mint);
      if (route() === "research") viewResearch($("#main"));
      if (r?.status === "done") toast(`Graded ${r.grade} by ${providerOf(r.model)}`);
      return;
    }
    pollResearch(mint, tries + 1);
  }, 3000);
}
function closeCoin() { coinData = null; if (!$("#drawer").hidden) sheetTo(false); }

// ---------- routing ----------
const VIEWS = { "": viewPulse, signals: viewRadar, picks: viewPicks, research: viewResearch, coins: viewCoins, wallets: viewWallets, narratives: viewNarratives, briefs: viewBriefs, record: viewRecord, health: viewHealth, api: viewApi, mcp: viewMcp, settings: viewSettings };
const route = () => location.hash.replace(/^#\/?/, "").split("/")[0];
// Each view renders into an off-screen node; only the latest navigation is shown, and a skeleton
// appears right away if the data takes more than a moment.
let renderSeq = 0;
const SKELETON = `<div class="boot"><div class="skel big"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`;
async function render() {
  const r = route(), seq = ++renderSeq;
  document.body.classList.toggle("pulse-mode", r === "");
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.r === r));
  const main = $("#main");
  const slow = setTimeout(() => { if (seq === renderSeq) main.innerHTML = SKELETON; }, 120);
  const view = VIEWS[r] || viewRadar;
  // Hidden staging node placed before #main so id lookups inside the view find the new elements first.
  const tmp = document.createElement("div");
  tmp.hidden = true;
  main.before(tmp);
  try {
    await view(tmp);
    if (seq !== renderSeq) return;
    main.replaceChildren(...tmp.childNodes);
  } catch (e) {
    if (seq === renderSeq) main.innerHTML = `<div class="card">${empty("Radar isn't responding", `${e.message}. It may still be starting; this page retries in a few seconds.`)}</div>`;
    setTimeout(() => { if (seq === renderSeq) render(); }, 4000);
  } finally { clearTimeout(slow); tmp.remove(); }
}
window.addEventListener("hashchange", () => { if (drawerOpen()) closeCoin(); render(); });

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const el = e.target;
  if (el.closest("[data-close]")) return closeCoin();
  // A site named by a coin's creator: say so before leaving.
  const unt = el.closest("a.untrusted");
  if (unt && !confirm(`Open ${new URL(unt.href).hostname}?\n\nThis link was set by the coin's creator and has not been checked. Fake sites that drain wallets are common: never connect a wallet or sign anything there.`)) { e.preventDefault(); return; }
  const copy = el.closest("[data-copy]");
  if (copy) { navigator.clipboard?.writeText(copy.dataset.copy); return toast("Copied"); }
  // Filter panels (Coins and Pulse).
  const panel = el.closest(".fpanel")?.id;
  if (panel && PANELS[panel]) {
    const P = PANELS[panel];
    const fc = el.closest("[data-fclear]");
    if (fc) { e.preventDefault(); const f = { ...P.get() }; if (fc.dataset.fclear === "*") return panelSet(panel, {}); delete f[fc.dataset.fclear]; return panelSet(panel, f); }
    const ps = el.closest("[data-preset]");
    if (ps) return panelSet(panel, { ...P.presets()[ps.dataset.preset] });
    const pd = el.closest("[data-preset-del]");
    if (pd) { const all = store.get(P.key, {}); delete all[pd.dataset.presetDel]; store.set(P.key, all); return renderPanel(panel); }
    if (el.closest("[data-preset-save]")) {
      if (!Object.keys(P.get()).length) return toast("Set at least one filter first");
      const name = prompt("Name this preset:")?.trim();
      if (name) { store.set(P.key, { ...store.get(P.key, {}), [name.slice(0, 30)]: P.get() }); renderPanel(panel); toast(`Saved “${name}”`); }
      return;
    }
  }
  const scr = el.closest("[data-screen]");
  if (scr && scr.tagName === "BUTTON") { sigState.screen = scr.dataset.screen; return render(); }
  const more = el.closest("[data-more]");
  if (more) { const box = document.querySelector(`[data-more-for="${CSS.escape(more.dataset.more)}"]`); if (box) { box.hidden = !box.hidden; more.classList.toggle("open", !box.hidden); } return; }
  const ru = el.closest("[data-recunit]");
  if (ru) { recState.unit = ru.dataset.recunit; return render(); }
  const cp = el.closest("[data-cpage]");
  if (cp) { coinState.page = Math.max(0, +cp.dataset.cpage); await loadCoins(true); $("#coinTable")?.scrollIntoView({ block: "start" }); return; }
  const tf = el.closest("[data-tf]");
  if (tf && coinData) { chartState.tf = tf.dataset.tf; $("#coinChart").innerHTML = coinChart(coinData); return; }
  const rule = el.closest("[data-rule]");
  if (rule) {
    const { rule: scope, target, effect } = rule.dataset;
    await post("alerts", effect ? { scope, target, effect } : { scope, target, clear: true });
    toast(effect === "mute" ? "Muted: no pushes for this" : effect === "always" ? "Watching: its alerts always push" : "Rule removed");
    return scope === "coin" ? openCoin(target) : openWallet(target);
  }
  const fix = el.closest("[data-fix]");
  if (fix) {
    const themes = [...document.querySelectorAll('input[name="fixTheme"]:checked')].map((x) => x.value).slice(0, 3);
    await post(`token/${fix.dataset.fix}/classify`, { themes, assetClass: $("#fixClass").value });
    toast("Category saved"); return openCoin(fix.dataset.fix);
  }
  const fr = el.closest("[data-fix-reset]");
  if (fr) { await post(`token/${fr.dataset.fixReset}/classify`, { themes: null, assetClass: null }); toast("Back to automatic; it updates on the next scan"); return openCoin(fr.dataset.fixReset); }
  const ex = el.closest("[data-explain]");
  if (ex) {
    ex.disabled = true; ex.textContent = "Reading the chart…";
    try { const r = await post(`token/${ex.dataset.explain}/explain`); $("#take").innerHTML = `<div class="md">${md(r.text)}</div>`; }
    catch (err) { $("#take").innerHTML = `<p class="down">${esc(err.message)}</p>`; }
    return;
  }
  const br = el.closest("[data-brief]");
  if (br) {
    br.disabled = true; br.textContent = "Writing…";
    try { await post("brief"); toast("Brief ready"); render(); }
    catch (err) { toast(err.message); br.disabled = false; br.textContent = "Write one now"; }
    return;
  }
  const follow = el.closest("[data-follow]");
  if (follow) {
    const label = prompt("Name this wallet (optional):", "") ?? "";
    await post(`wallet/${follow.dataset.follow}`, { follow: true, label });
    toast("Following wallet");
    if (drawerOpen()) openWallet(follow.dataset.follow);
    if (route() === "wallets") viewWallets($("#main"));
    return;
  }
  const rb = el.closest("[data-research]");
  if (rb) {
    rb.disabled = true; rb.textContent = "Queued…";
    try {
      await post(`research/${rb.dataset.research}`);
      toast(`Queued first in line for ${fastName()}`);
      pollResearch(rb.dataset.research);
    } catch (err) { toast(err.message); rb.disabled = false; rb.textContent = "Research"; }
    return;
  }
  const ws = el.closest("[data-wscan]");
  if (ws) {
    ws.disabled = true; ws.textContent = "Scanning… (up to a minute on the free RPC)";
    try { await post(`wallet/${ws.dataset.wscan}`, { scan: true }); openWallet(ws.dataset.wscan); }
    catch (err) { toast(err.message); ws.disabled = false; ws.textContent = "Scan recent trades"; }
    return;
  }
  const wt = el.closest("[data-wtoggle]");
  if (wt) { await post(`wallet/${wt.dataset.wtoggle}`, { watching: wt.dataset.on === "1" }); openWallet(wt.dataset.wtoggle); if (route() === "wallets") viewWallets($("#main")); return; }
  const wr = el.closest("[data-wrename]");
  if (wr) { const label = prompt("New name:"); if (label != null) { await post(`wallet/${wr.dataset.wrename}`, { label }); openWallet(wr.dataset.wrename); if (route() === "wallets") viewWallets($("#main")); } return; }
  const wx = el.closest("[data-wremove]");
  if (wx) { if (confirm("Stop following this wallet and delete its trade history?")) { await api(`wallet/${wx.dataset.wremove}`, { method: "DELETE" }); closeCoin(); toast("Unfollowed"); if (route() === "wallets") viewWallets($("#main")); } return; }
  const wal = el.closest("[data-wallet]");
  if (wal && !el.closest("a")) return openWallet(wal.dataset.wallet);
  const theme = el.closest("[data-theme]");
  if (theme) { coinState.theme = theme.dataset.theme; location.hash = "#/coins"; return; }
  const ct = el.closest("[data-ctheme]");
  if (ct) { coinState.theme = ct.dataset.ctheme; document.querySelectorAll("[data-ctheme]").forEach((b) => b.classList.toggle("on", b === ct)); return loadCoins(); }
  const th = el.closest("th[data-sort]");
  // First click sorts high to low; clicking the same column again reverses it.
  if (th && route() === "coins") {
    if (coinState.sort === th.dataset.sort) coinState.dir = coinState.dir === "desc" ? "asc" : "desc";
    else { coinState.sort = th.dataset.sort; coinState.dir = "desc"; }
    return loadCoins();
  }
  // The terminal controls: paper buys and sells, the desk, the watchlist star, density and sound.
  const pb = el.closest("[data-pbuy]");
  if (pb) return paperBuy(pb.dataset.pbuy, +pb.dataset.sol);
  const ps = el.closest("[data-psell]");
  if (ps) return paperSell(+ps.dataset.psell, +ps.dataset.pct);
  const pr = el.closest("[data-prule]");
  if (pr) {
    const id = pr.dataset.prule, v = (k) => $(`[data-prule-${k}="${id}"]`)?.value;
    try { const r = await post(`paper/${id}/rule`, { tp: v("tp"), sl: v("sl"), trail: v("trail") }); ruleDrafts.delete(id); pulseState.desk = r.desk; renderDesk(); toast("Exit rule set"); } catch (e) { toast(e.message); }
    return;
  }
  const pd = el.closest("[data-pdrop]");
  if (pd) { try { pulseState.desk = await api(`paper/${pd.dataset.pdrop}`, { method: "DELETE" }); renderDesk(); } catch (e) { toast(e.message); } return; }
  if (el.closest("[data-pdesk]")) return openDesk();
  const pw = el.closest("[data-pwatch]");
  if (pw) return toggleWatch(pw.dataset.pwatch);
  const ptg = el.closest("[data-ptog]");
  if (ptg) {
    const k = ptg.dataset.ptog;
    pulseState[k] = !pulseState[k]; store.set(`pulse:${k}`, pulseState[k]); ptg.classList.toggle("on", pulseState[k]);
    if (k === "compact") document.body.classList.toggle("pulse-compact", pulseState.compact);
    if (k === "sound" && pulseState.sound) beep("buy");
    return;
  }
  if (el.closest("[data-pkeys]")) return toast("j/k rows · h/l columns · Enter open · b paper buy · f Fomo · w watch · r read · d desk · / search · Esc close");
  const pt = el.closest("[data-ptab]");
  if (pt) { pulseState.tab = pt.dataset.ptab; store.set("pulse:tab", pulseState.tab); return render(); }
  const pm = el.closest("[data-pmin]");
  if (pm) { pulseState.min = pm.dataset.pmin; store.set("pulse:min", pulseState.min); document.querySelectorAll("[data-pmin]").forEach((b) => b.classList.toggle("on", b === pm)); pulseState.first = true; return pulseTick(); }
  const m = el.closest("[data-mint]");
  if (m && !el.closest("a")) openCoin(m.dataset.mint);
});
document.addEventListener("input", (e) => {
  for (const key of ["tp", "sl", "trail"]) {
    const id = e.target.getAttribute(`data-prule-${key}`);
    if (id) ruleDrafts.set(id, { ...ruleDrafts.get(id), [key]: e.target.value });
  }
  if (e.target.id === "pq") { pulseState.q = e.target.value.trim(); pulseState.first = true; pulseTick(); }
  if (e.target.id === "cq") { coinState.q = e.target.value.trim(); clearTimeout(window._cq); window._cq = setTimeout(() => loadCoins(), 250); }
  // A number typed into a filter panel applies after a short pause; the field keeps focus.
  const panel = e.target.dataset?.f && e.target.closest(".fpanel")?.id;
  if (panel && PANELS[panel]) {
    clearTimeout(window._pf);
    window._pf = setTimeout(() => {
      const f = {};
      for (const i of document.querySelectorAll(`#${panel} [data-f]`)) if (i.value !== "" && Number.isFinite(+i.value)) f[i.dataset.f] = +i.value;
      panelSet(panel, f, false);
    }, 350);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.dataset?.psort != null) {
    pulseState.sort[e.target.dataset.psort] = e.target.value; store.set("pulse:sort", pulseState.sort);
    e.target.classList.toggle("on", Boolean(e.target.value)); pulseState.first = true; pulseTick();
  }
  if (e.target.id === "cgrad") { coinState.grad = e.target.value; loadCoins(); }
  if (e.target.id === "ccls") { coinState.cls = e.target.value; loadCoins(); }
  if (e.target.id === "cunrel") { coinState.unreliable = e.target.checked; loadCoins(); }
  if (e.target.id === "sgroup") { sigState.grouped = e.target.checked; render(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && drawerOpen()) closeCoin(); });
// Terminal keys on the Pulse page. Nothing fires while typing in a field, and the filter window has its own keys.
document.addEventListener("keydown", (e) => {
  if (route() !== "" || pulseState.tab !== "new" || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (e.key === "/" && !typing) { e.preventDefault(); $("#pq")?.focus(); return; }
  if (typing) { if (e.key === "Escape") e.target.blur(); return; }
  if (pf.draft) return;
  const k = e.key, s = selRow(), mint = s?.dataset.mint;
  if (k === "1" || k === "2" || k === "3" || k === "4") { const rows = $(`#pcol-${COLS[+k - 1]}`)?.querySelectorAll(".pr"); if (rows?.length) setSel(rows[0]); }
  else if (k === "j" || k === "ArrowDown") moveSel(1);
  else if (k === "k" || k === "ArrowUp") moveSel(-1);
  else if (k === "h" || k === "ArrowLeft") moveCol(-1);
  else if (k === "l" || k === "ArrowRight") moveCol(1);
  else if (k === "Enter") { if (mint) openCoin(mint); else moveSel(1); }
  else if (k === "b") { if (mint) paperBuy(mint, pulseState.sizes[1] ?? pulseState.sizes[0]); }
  else if (k === "f") { if (mint) window.open(fomoUrl(mint), "_blank", "noopener"); }
  else if (k === "w") { if (mint) toggleWatch(mint); }
  else if (k === "r") { const b = s?.querySelector("[data-research]"); if (b) b.click(); }
  else if (k === "d") openDesk();
  else if (k === "Escape") { if (drawerOpen()) closeCoin(); else setSel(null); }
  else if (k === "?") toast("j/k rows · h/l columns · Enter open · b paper buy · f Fomo · w watch · r read · d desk · / search · Esc close");
  else return;
  e.preventDefault();
});

// ---------- live stream ----------
function connect() {
  connect.source?.close();
  clearTimeout(connect.fallback); clearTimeout(connect.retry);
  connect.fallback = null;
  const es = new EventSource("/api/stream");
  connect.source = es;
  const live = $("#live");
  // "connected" is about this page's link to Blix, nothing more. Whether the data behind it is
  // current is what the Health page (and the Health cell above) reports.
  es.addEventListener("hello", () => { clearTimeout(connect.fallback); clearTimeout(connect.retry); connect.fallback = null; pulseState.polling = false; live.classList.add("on"); live.querySelector("span").textContent = "connected"; live.title = "This page is connected to Blix. See Health for whether prices, wallets and AI are current."; });
  // Through some proxies (the public tunnel) the event stream never opens. The page then works by polling:
  // rows refresh every 2 seconds without the per-trade flashes, and the stream is tried again every minute.
  const fallback = () => {
    if (connect.fallback) return;
    connect.fallback = setTimeout(() => {
      connect.fallback = null;
      pulseState.polling = true;
      pollingStatus();
      clearTimeout(connect.retry);
      connect.retry = setTimeout(() => { if (pulseState.polling) connect(); }, 60_000);
    }, 8000);
  };
  fallback();
  es.addEventListener("tick", async () => {
    if (route() === "") {
      const o = await api("overview").catch(() => null);
      if (o) renderStrip(o);
    } else {
      const o = await api("overview").catch(() => null);
      if (o) renderStrip(o);
    }
  });
  es.addEventListener("signal", (ev) => {
    const s = JSON.parse(ev.data);
    const feed = $("#feed");
    // A new alert only joins the list it belongs to: unscreened activity never drops into the approved feed.
    const screen = feed?.dataset.screen || "approved";
    if (feed && (screen === "all" || (screen === "approved") === (s.safe !== 0))) {
      if (feed.querySelector(".empty")) feed.innerHTML = "";
      feed.insertAdjacentHTML("afterbegin", sigRow(s, true));
    }
    // Pop-ups follow the same rules as Discord/Telegram (mutes, quiet hours, cooldown, unscreened coins).
    if (s.push && document.hidden && "Notification" in window && Notification.permission === "granted") new Notification(s.title, { body: s.detail, icon: s.token?.image || "/icon.svg" });
  });
  es.addEventListener("walletTrade", (ev) => {
    const { wallet: w, trade } = JSON.parse(ev.data);
    const feed = $("#wfeed");
    if (!feed) return;
    if (feed.querySelector(".empty")) feed.innerHTML = "";
    feed.insertAdjacentHTML("afterbegin", tradeRow({ ...trade, wallet: w.address, label: w.label, source: w.source }).replace('class="sig"', 'class="sig new"'));
  });
  es.addEventListener("live", (ev) => { if (route() === "" && !document.hidden) applyLive(JSON.parse(ev.data).u); });
  es.addEventListener("launch", (ev) => { if (route() === "" && !document.hidden) applyLaunch(JSON.parse(ev.data)); });
  es.addEventListener("pic", (ev) => applyPic(JSON.parse(ev.data).mint));
  es.addEventListener("mig", (ev) => { if (route() === "" && !document.hidden) applyMig(JSON.parse(ev.data).u); });
  // A paper position closed by its own rule.
  es.addEventListener("paper", (ev) => {
    const p = JSON.parse(ev.data).pos;
    if (p) { toast(`Paper desk: $${p.symbol || shortAddr(p.mint)} closed, ${p.exit_why} · ${usdSigned(p.pnl)}`); beep("sell"); }
    if (route() === "") deskTick();
  });
  es.addEventListener("brief", (ev) => { const b = JSON.parse(ev.data); const c = $("#briefCard"); if (c) c.innerHTML = briefCard(b); toast("New AI brief"); });
  es.onerror = () => {
    if (pulseState.polling) pollingStatus();
    else { live.classList.remove("on"); live.querySelector("span").textContent = "reconnecting"; }
    fallback();
  };
}

function pollingStatus() {
  const live = $("#live"), fresh = Date.now() - lastApiOk < 25_000;
  live.classList.toggle("on", fresh);
  live.querySelector("span").textContent = fresh ? "live · polling" : "reconnecting";
  live.title = fresh ? "The event stream is unavailable. Pulse refreshes every 2 seconds; other views refresh on their normal schedule." : "The server is not responding. Retrying automatically.";
}
setInterval(async () => {
  if (!pulseState.polling || document.hidden) return;
  const o = await api("overview").catch(() => null);
  if (o) renderStrip(o);
  if (pulseState.polling) pollingStatus();
}, 10_000);

if ("Notification" in window && Notification.permission === "default") setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
api("overview").then(renderStrip).catch(() => {});
render();
connect();
setInterval(() => { if (route() === "signals" && !document.hidden) viewRadar($("#main")).catch(() => {}); }, 60_000);
