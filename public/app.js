// Meme Radar dashboard.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = (p, opt) => fetch(`/api/${p}`, opt).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error || r.status); return b; });
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
  volume: ["Volume spike", "var(--info)"], dump: ["Dump warning", "var(--down)"], milestone: ["Milestone", "#7ee0c3"],
  wallet: ["Wallet buy", "#2dd4bf"], smart: ["Smart money", "#facc15"], fomo: ["Fomo crowd", "#ff5a5f"], research: ["AI research", "#5cc8ff"], buy: ["Buy call", "#39ff88"], "dev-sold": ["Dev sold", "var(--down)"], rugged: ["Rugged", "var(--down)"],
};
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
window.avFail = (img) => { const fb = img.dataset.fb; if (fb && img.src !== fb) { img.dataset.fb = ""; img.src = fb; img.classList.add("gen"); } };

// Coin logo: its own image, else DexScreener's copy, else a generated one with the ticker.
function av(t, size = "") {
  const fb = genAvatar(t.mint || t.symbol || "?", initials(t.symbol));
  const src = t.image || (t.mint ? `https://dd.dexscreener.com/ds-data/tokens/solana/${t.mint}.png` : fb);
  return `<img class="av ${size}" src="${esc(src)}" data-fb="${fb}" alt="" loading="lazy" onerror="avFail(this)">`;
}

// Wallet avatar: the trader's Fomo profile picture when we know their handle, else a generated one.
const FOMO_CARD = (h) => `https://image-renderer.fomo.cloud/og/profile/${encodeURIComponent(h)}/card.png`;
function wav(address, w = {}, size = "") {
  const handle = w.handle || (w.label?.startsWith("@") ? w.label.slice(1) : null);
  const gen = genAvatar(address || "?");
  const badge = handle || w.source === "fomo" || w.fomo ? `<i class="badge fomo" title="Trades on Fomo">f</i>`
    : w.source === "smart" ? `<i class="badge smart" title="Smart money">★</i>` : "";
  const img = handle
    ? `<img class="crop" src="${FOMO_CARD(handle)}" data-fb="${gen}" alt="" loading="lazy" onerror="avFail(this)">`
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
  const [label, icon] = SOCIAL[l.type] || [l.type, SOCIAL.website[1]];
  return `<a class="btn icon-btn" href="${esc(l.url)}" target="_blank" rel="noreferrer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>${esc(label)}</a>`;
}
function safetyChip(n) {
  if (n == null) return '<span class="pill">Safety unchecked</span>';
  return `<span class="pill safe-pill ${n >= 70 ? "ok" : n >= 45 ? "mid" : "bad"}">🛡 Safety ${n}</span>`;
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
    ["Signals 24h", c.signals24h.toLocaleString(), `${s.signals} this session`],
    ["Graduations", c.graduated24h.toLocaleString(), "last 24h"],
    ["Last scan", s.lastCycle ? `${ago(s.lastCycle)} ago` : "…", s.errors ? `${s.errors} errors` : "healthy"],
  ];
  $("#strip").innerHTML = cells.map(([b, v, sm]) => `<div class="stat"><b>${b}</b><span>${v}</span><small>${esc(sm)}</small></div>`).join("");
}

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
const BAD = new Set(["dump", "dev-sold", "rugged"]);

function sigRow(s, isNew = false) {
  const [label, color] = kindOf(s.kind);
  const since = s.price_now && s.price ? s.price_now / s.price : null;
  return `<div class="sig ${isNew ? "new" : ""}" style="--k:${color}" data-mint="${esc(s.mint)}">
    <div class="av-wrap">${av({ mint: s.mint, symbol: s.symbol, image: s.image })}<i class="kind-badge">${kindGlyph(s.kind)}</i></div>
    <div style="min-width:0"><div class="sig-top"><span class="tag">${label}</span><span class="dim">${ago(s.t)} ago</span></div><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p></div>
    <div class="meta">${BAD.has(s.kind) ? "" : fomoBtn(s.mint)}${since != null ? `<span class="${cls(since - 1)}">${mult(since)} since</span>` : ""}</div>
  </div>`;
}

function coinTable(list, { sort, compact } = {}) {
  if (!list.length) return empty("No coins match yet", "The radar fills up over the first few minutes.");
  const th = (k, label, extra = "") => `<th class="${sort != null ? "sortable" : ""} ${sort === k ? "sorted" : ""} ${extra}" data-sort="${k}">${label}</th>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Coin</th><th class="hide-sm">6h</th>${th("score", "Score")}${th("safety", "Safety")}${th("mcap", "Mcap")}${compact ? "" : th("liq", "Liquidity", "hide-sm")}${th("volume", "Vol 1h", "hide-sm")}${th("change", "1h")}${compact ? "" : `<th class="hide-sm">24h</th>`}${th("new", "Age", "hide-sm")}</tr></thead>
    <tbody>${list.map((t) => `<tr class="row" data-mint="${esc(t.mint)}">
      <td><div class="coin">${av(t, "sm")}<div><b>${esc(t.symbol)}</b>${t.graduated ? ' <span class="pill">grad</span>' : ""}<small>${esc(t.name)}</small></div></div></td>
      <td class="hide-sm">${spark(t.spark)}</td>
      <td>${scoreBar(t.score)}</td><td>${safety(t.safety_score)}</td><td>${money(t.mcap)}</td>
      ${compact ? "" : `<td class="hide-sm">${money(t.liquidity)}</td>`}<td class="hide-sm">${money(t.vol_h1)}</td>
      <td class="${cls(t.chg_h1)}">${pct(t.chg_h1)}</td>${compact ? "" : `<td class="hide-sm ${cls(t.chg_h24)}">${pct(t.chg_h24)}</td>`}
      <td class="dim hide-sm">${ago(t.pair_created || t.first_seen)}</td></tr>`).join("")}</tbody></table></div>`;
}

const THEME_EMOJI = {
  "AI & Agents": "🤖", Dogs: "🐶", Cats: "🐱", "Frogs & Pepe": "🐸", Politics: "🏛️", "Elon & X": "🚀", "Degen culture": "🦍",
  Brainrot: "🧠", "Anime & Waifu": "🌸", "Celebrity & Streamers": "🎤", "Finance & Stocks": "📈", "Space & Aliens": "👽",
  "Religion & Myth": "🐉", Food: "🍕", Animals: "🦦", Gaming: "🎮", "Holidays & Events": "🎃", "Countries & Cities": "🌍",
};
const stack = (coins, n = 4) => `<span class="stack">${coins.slice(0, n).map((c) => av(c, "xs")).join("")}</span>`;

function narMini(n) {
  return `<div class="nar-mini" data-theme="${esc(n.name)}">
    <div class="nar-mini-top"><span class="emoji">${THEME_EMOJI[n.name] || "✨"}</span><b>${esc(n.name)}</b><span class="num heat-n">${n.heat}</span></div>
    <div class="heat"><i style="width:${n.heat}%"></i></div>
    <div class="nar-mini-foot">${n.top.length ? stack(n.top) : ""}<small>${(n.launchShare * 100).toFixed(1)}% of launches</small></div></div>`;
}

async function viewRadar(main) {
  const [o, nar] = await Promise.all([api("overview"), api("narratives")]);
  overviewData = o;
  renderStrip(o);
  main.innerHTML = `
  <div class="radar-grid">
    <div class="card"><div class="card-head"><h2>Live signals</h2><small>only coins that pass safety</small></div>
      <div class="feed" id="feed">${o.signals.length ? o.signals.map((s) => sigRow(s)).join("") : empty("Listening…", "Signals appear here as coins break out. The first ones usually land within 10–20 minutes.")}</div></div>
    <div class="stack">
      <div class="card"><div class="card-head"><h2>Top movers</h2><a class="note" href="#/coins">All coins →</a></div>${coinTable(o.top, { compact: true })}</div>
      <div class="card"><div class="card-head"><h2>Narratives right now</h2><a class="note" href="#/narratives">Details →</a></div>
        <div class="nar-strip">${nar.themes.slice(0, 8).map(narMini).join("") || empty("Warming up", "Needs a few minutes of launches.")}</div></div>
      <div class="card" id="briefCard">${briefCard(o.brief)}</div>
    </div>
  </div>`;
}

function briefCard(b) {
  return `<div class="card-head"><h2>Latest AI brief</h2><div style="display:flex;gap:8px;align-items:center">${b ? `<small>${ago(b.t)} ago</small>` : ""}<button class="btn" data-brief>Write one now</button></div></div>
    <div class="brief md">${b ? md(b.body) : `<p class="note">Claude writes a market brief every hour from what the radar sees. The first one arrives about 12 minutes after start, or press “Write one now”.</p>`}</div>`;
}

const coinState = { sort: "score", theme: "", q: "", minSafety: "", grad: false };
async function viewCoins(main) {
  const nar = await api("narratives");
  main.innerHTML = `<div class="page-head"><div><h1>Coins</h1><p>Every coin the radar is tracking right now. Brand-new pump.fun launches show up here once they trade for real.</p></div></div>
    <div class="filters">
      <input class="input" id="cq" placeholder="Search ticker, name or mint" value="${esc(coinState.q)}" style="flex:1;min-width:200px">
      <select class="input" id="csafe"><option value="">Any safety</option><option value="45">Safety 45+</option><option value="70">Safety 70+</option></select>
      <label class="check"><input type="checkbox" id="cgrad" ${coinState.grad ? "checked" : ""}> Graduated only</label>
    </div>
    <div class="chips" style="margin-bottom:12px"><button class="chip ${coinState.theme ? "" : "on"}" data-ctheme="">All themes</button>${nar.themes.map((t) => `<button class="chip ${coinState.theme === t.name ? "on" : ""}" data-ctheme="${esc(t.name)}">${esc(t.name)}</button>`).join("")}</div>
    <div class="card" id="coinTable"><div class="skel"></div><div class="skel"></div></div>`;
  $("#csafe").value = coinState.minSafety;
  await loadCoins();
}
async function loadCoins() {
  const qs = new URLSearchParams({ sort: coinState.sort, limit: 300, ...(coinState.theme && { theme: coinState.theme }), ...(coinState.q && { q: coinState.q }), ...(coinState.minSafety && { minSafety: coinState.minSafety }), ...(coinState.grad && { graduated: "1" }) });
  const list = await api(`tokens?${qs}`);
  const box = $("#coinTable");
  if (box) box.innerHTML = coinTable(list, { sort: coinState.sort });
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
  const addForm = `<form class="filters" style="padding:0 16px" id="fomoAdd" onsubmit="return false">
      <input class="input num" id="fwallet" placeholder="Fomo trader's Solana wallet" style="flex:2;min-width:200px" autocomplete="off" spellcheck="false">
      <input class="input" id="fhandle" placeholder="@handle (optional)" style="flex:1;min-width:120px" autocomplete="off">
      <button class="btn fomo" type="submit">Add Fomo trader</button></form>`;
  if (!f.connected) return `<div class="card">${head}
    <div class="empty" style="text-align:left;padding:0 16px 12px"><b>Connect Fomo for free</b>
      Fomo pays its users' Solana fees, so every Fomo trade carries Fomo's fee-payer signature. Add one Fomo wallet and the radar learns that signature from its trades, then watches Fomo trades as they happen. No API key, nothing to pay.
      <ol style="margin:10px 0 0;padding-left:18px;color:var(--ink-2)">
        <li>Your own: Fomo app → Profile → Deposit → Solana → copy the address.</li>
        <li>Or any trader: look up their handle on <a class="linkish" href="https://fomowalletfinder.com/" target="_blank" rel="noreferrer">fomowalletfinder.com</a> (free) and paste the Solana wallet.</li>
      </ol>
      <p class="note" style="margin:10px 0 0">${f.fomoWallets ? `${f.fomoWallets} Fomo wallet${f.fomoWallets > 1 ? "s" : ""} added. Learning starts once the radar has seen 2 of their trades.` : "Buy on Fomo buttons already work."}</p></div>
    ${addForm}</div>`;
  const hot = f.hot || [], traders = f.traders || [];
  return `<div class="card">${head}${addForm}
    <div class="card-head" style="padding-top:4px"><h2>What Fomo is buying</h2><small>last hour</small></div>
    ${hot.length ? hot.map((c) => `<div class="leader" style="margin:0 10px" data-mint="${esc(c.mint)}">${av(c, "sm")}<span class="grow"><b>$${esc(c.symbol || shortAddr(c.mint))}</b> <span class="dim">${c.buyers} buyers · ${c.sellers} sellers</span></span><span class="num ${cls((c.bought || 0) - (c.sold || 0))}">${usd((c.bought || 0) - (c.sold || 0))}</span>${fomoBtn(c.mint)}</div>`).join("")
      : `<p class="note" style="padding:0 16px">No Fomo trades seen yet this hour.</p>`}
    <div class="card-head"><h2>Best Fomo traders seen</h2><small>by profit on trades the radar watched</small></div>
    ${traders.length ? `<div class="table-wrap"><table><thead><tr><th>Trader</th><th>Profit</th><th class="hide-sm">Win rate</th><th class="hide-sm">Coins</th><th></th></tr></thead><tbody>
      ${traders.slice(0, 15).map((t) => `<tr class="row" data-wallet="${esc(t.wallet)}"><td><div class="coin">${wav(t.wallet, { handle: t.handle, source: "fomo" }, "sm")}<div><b>${t.handle ? "@" + esc(t.handle) : esc(t.label || shortAddr(t.wallet))}</b><small>${t.trades} trades</small></div></div></td>
      <td class="${cls(t.realized)}">${usd(t.realized)}</td><td class="hide-sm">${t.winRate == null ? "—" : Math.round(t.winRate * 100) + "%"}</td><td class="hide-sm">${t.coins}</td>
      <td>${t.watching ? '<span class="up">following</span>' : `<button class="btn" data-follow="${esc(t.wallet)}">Follow</button>`}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="note" style="padding:0 16px 16px">Rankings appear once traders close a few positions.</p>`}</div>`;
}

async function viewWallets(main) {
  const d = await api("wallets");
  const pct = (x) => x == null ? "—" : `${Math.round(x * 100)}%`;
  const rpcNote = d.rpc.custom ? "Using your RPC." : "Using the free public Solana RPC, which is slow. Add a free Helius RPC URL in Settings for ~10x faster wallet tracking.";
  main.innerHTML = `<div class="page-head"><div><h1>Wallets</h1><p>Follow wallets across every Solana DEX. Their buys raise alerts, and when two wallets you follow buy the same coin you get a Smart money alert. The radar also studies coins that ran 3x or more and finds the wallets that keep getting in early.</p></div></div>
  <form class="filters" id="addWallet" onsubmit="return false">
    <input class="input num" id="waddr" placeholder="Wallet address" style="flex:2;min-width:240px" autocomplete="off" spellcheck="false">
    <input class="input" id="wlabel" placeholder="Name (optional)" style="flex:1;min-width:140px">
    <button class="btn primary" id="wadd" type="submit">Follow wallet</button>
  </form>
  <p class="note" style="margin:-4px 0 14px">${esc(rpcNote)}</p>
  <div class="radar-grid">
    <div class="stack">
      <div class="card"><div class="card-head"><h2>Following</h2><small>${d.wallets.filter((w) => w.watching).length} wallets</small></div>
      ${d.wallets.length ? `<div class="table-wrap"><table><thead><tr><th>Wallet</th><th>Trades</th><th>Win rate</th><th>PnL</th></tr></thead><tbody>
        ${d.wallets.map((w) => `<tr class="row ${w.watching ? "" : "paused"}" data-wallet="${esc(w.address)}"><td><div class="coin">${wav(w.address, w, "sm")}<div><b>${esc((w.label || shortAddr(w.address)).replace(/ \(bot, paused\)$/, ""))}</b>${w.watching ? "" : ` <span class="pill">${/\(bot/.test(w.label || "") ? "bot · paused" : "paused"}</span>`}<small>${w.source === "fomo" ? "Fomo trader" : w.source === "smart" ? `smart · ${w.winners} winners` : "added by you"}${w.last_trade ? ` · ${ago(w.last_trade)} ago` : ""}</small></div></div></td>
        <td>${w.trades}</td><td>${pct(w.winRate)}</td><td class="${cls(w.realized + w.unrealized)}">${w.trades ? usd(w.realized + w.unrealized) : "—"}</td></tr>`).join("")}
      </tbody></table></div>` : empty("No wallets yet", "Paste a wallet above, or follow one from Smart money. Auto-follow adds the best discovered wallets for you.")}</div>
      ${fomoCard(d.fomo)}
      <div class="card"><div class="card-head"><h2>Smart money</h2><small>${d.smart.winners} winning coins studied</small></div>
      ${d.smart.wallets.length ? d.smart.wallets.map((w) => `<div class="sig" style="--k:#facc15" data-wallet="${esc(w.address)}">
        ${wav(w.address, { ...w, source: "smart" })}
        <div style="min-width:0"><span class="tag">${w.coins} winners</span><h3>${esc(w.label || shortAddr(w.address))}</h3>
        <p>${w.early ? `${w.early} early buys` : ""}${w.early && w.holder ? " · " : ""}${w.holder ? `${w.holder} as top holder` : ""} · ${w.tokens.slice(0, 5).map((t) => "$" + esc(t.symbol)).join(" ")}</p></div>
        <div class="meta">${w.watching ? '<b class="up">following</b>' : `<button class="btn" data-follow="${esc(w.address)}">Follow</button>`}</div></div>`).join("")
        : empty("Still learning", "Smart money shows up once coins the radar watched have run 3x or more. Give it a few hours.")}</div>
    </div>
    <div class="card"><div class="card-head"><h2>Live wallet activity</h2><small>buys and sells by wallets you follow</small></div>
      <div class="feed" id="wfeed">${d.activity.length ? d.activity.map((a) => tradeRow(a)).join("") : empty("Nothing yet", "Trades show up here within a minute of happening.")}</div></div>
  </div>`;
  const fa = $("#fomoAdd");
  if (fa) fa.onsubmit = async () => {
    const wallet = $("#fwallet").value.trim(), handle = $("#fhandle").value.trim();
    if (!wallet) return toast("Paste the trader's Solana wallet");
    try { await post("fomo/trader", { wallet, handle }); toast(`Added ${handle || "Fomo trader"}; reading their trades`); viewWallets(main); }
    catch (e) { toast(e.message); }
  };
  $("#addWallet").onsubmit = async () => {
    const address = $("#waddr").value.trim(), label = $("#wlabel").value.trim();
    if (!address) return;
    try { await post("wallets", { address, label }); toast(`Following ${label || shortAddr(address)}`); viewWallets(main); }
    catch (e) { toast(e.message); }
  };
}

async function openWallet(address) {
  const d = $("#drawer"), p = $("#panel");
  d.hidden = false;
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
        <div class="hero-price"><span class="big num ${cls(pnl.realized + pnl.unrealized)}">${pnl.trades ? usd(pnl.realized + pnl.unrealized) : "—"}</span><small class="dim">total PnL seen</small></div>
      </div>
    </div>
    <div class="p-acts">
      ${w.source ? `<button class="btn" data-wtoggle="${esc(address)}" data-on="${w.watching ? 0 : 1}">${w.watching ? "Pause" : "Resume"}</button><button class="btn" data-wrename="${esc(address)}">Rename</button><button class="btn" data-wremove="${esc(address)}">Unfollow</button>` : `<button class="btn primary" data-follow="${esc(address)}">Follow</button>`}
      ${w.label?.startsWith("@") ? `<a class="btn fomo" href="https://fomo.family/profile/${esc(w.label.slice(1))}" target="_blank" rel="noreferrer">Fomo profile</a>` : ""}
      <a class="btn" href="https://gmgn.ai/sol/address/${esc(address)}" target="_blank" rel="noreferrer">GMGN</a>
      <a class="btn" href="https://solscan.io/account/${esc(address)}" target="_blank" rel="noreferrer">Solscan</a>
      <button class="btn" data-copy="${esc(address)}">Copy address</button>
    </div>
    <div class="p-sec"><div class="facts">
      <div class="fact"><b>Trades seen</b><span>${pnl.trades}</span></div>
      <div class="fact"><b>Win rate</b><span>${pnl.winRate == null ? "—" : Math.round(pnl.winRate * 100) + "%"}</span></div>
      <div class="fact"><b>Realized</b><span class="${cls(pnl.realized)}">${pnl.closed ? usd(pnl.realized) : "—"}</span></div>
      <div class="fact"><b>Open PnL</b><span class="${cls(pnl.unrealized)}">${pnl.trades ? usd(pnl.unrealized) : "—"}</span></div>
    </div><p class="note" style="margin:10px 0 0">PnL covers trades since the radar started watching this wallet, priced in USD at the time.</p></div>
    ${open.length ? `<div class="p-sec"><h3>Holding now</h3>${open.map((x) => `<div class="leader" data-mint="${esc(x.mint)}">${av(x, "sm")}<span class="grow"><b>$${esc(x.symbol || shortAddr(x.mint))}</b> <span class="dim">${esc(x.name || "")}</span></span><span class="num">${money(x.value)}</span><span class="num ${cls(x.unrealized)}" style="width:80px;text-align:right">${usd(x.unrealized)}</span></div>`).join("")}</div>` : ""}
    ${r.hits.length ? `<div class="p-sec"><h3>Why it's smart</h3>${r.hits.map((h) => `<div class="leader" data-mint="${esc(h.mint)}">${av(h, "sm")}<span class="grow"><b>$${esc(h.symbol || shortAddr(h.mint))}</b> <span class="dim">${h.kind === "early" ? "early buyer" : "top holder"}</span></span><span class="num up">${h.multiple ? h.multiple.toFixed(1) + "x run" : ""}</span></div>`).join("")}</div>` : ""}
    <div class="p-sec" style="padding:0"><h3 style="padding:16px 22px 0">Trades</h3>${r.trades.length ? r.trades.map((a) => tradeRow(a, { showWallet: false })).join("") : w.source
      ? `<p class="note" style="padding:0 22px 16px">No trades seen yet. New wallets get their last ~25 transactions checked within a minute or two.</p>`
      : `<div style="padding:0 22px 16px"><p class="note">The radar hasn't looked at this wallet yet.</p><button class="btn" data-wscan="${esc(address)}">Scan recent trades</button></div>`}</div>
    <div class="p-sec"><div class="mint">${esc(address)}</div></div>`;
  p.scrollTop = 0;
}

// ---------- research desk ----------
const gradeClass = (g) => !g ? "" : g.startsWith("A") ? "ga" : g.startsWith("B") ? "gb" : g.startsWith("C") ? "gc" : g === "D" ? "gd" : "gf";
const tierMark = (r) => r?.tier === "fast" ? `<span class="tier fast" title="Fast read${r.ms ? ` in ${(r.ms / 1000).toFixed(1)}s` : ""}">⚡</span>` : r?.tier === "deep" ? `<span class="tier deep" title="Deep read by Claude">◆</span>` : "";
const modelName = (m) => String(m || "").split("/").pop();
const gradeBadge = (g, size = "") => `<span class="grade ${gradeClass(g)} ${size}">${esc(g || "?")}</span>`;

function researchChip(t) {
  const r = t.research;
  if (!r) return `<button class="btn sm-btn" data-research="${esc(t.mint)}">Research</button>`;
  if (r.status === "queued") return `<span class="pill">Queued</span>`;
  if (r.status === "running") return `<span class="pill running">Researching…</span>`;
  if (r.status === "error") return `<button class="btn sm-btn" data-research="${esc(t.mint)}" title="Last try failed">Retry</button>`;
  return `${r.status === "deep" ? `<span class="pill running" title="Claude is double-checking this one">checking</span>` : ""}${tierMark(r)}${gradeBadge(r.grade)}`;
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
  main.innerHTML = `<div class="page-head"><div><h1>Research desk</h1>
      <p>Every coin about to bond on pump.fun and every coin that just bonded gets researched: its description, X account, the tweet it's built on, website, live news, copycats with the same ticker, holders, dev, and who's buying. ${d.fast.provider === "grok" ? `Grok (your SuperGrok login) reads every coin${d.fast.search ? " and searches X live for who is posting it" : ""} (⚡ about ${d.fast.avgMs ? Math.round(d.fast.avgMs / 1000) : 8}s); the strong ones get a deep read from ${d.deepProvider === "grok" ? "grok-4.7 with buy/exit calls (see Picks)" : "Claude"} (◆).` : d.fast.ready ? "Groq gives every coin a fast read (⚡ about a second); the strong ones get a deeper second read from Claude (◆)." : "Claude grades the narrative and how high it could realistically go."}</p></div>
      <div class="desk-stats"><span class="pill">${count("running") ? "Researching now" : "Idle"}</span><span class="pill">${count("queued")} queued</span><span class="pill">${count("done") + count("deep")} graded</span>
        ${d.fast.ready ? `<span class="pill">⚡ ${d.hour.fast}/${d.fastPerHour} this hour${d.fast.avgMs ? ` · ${(d.fast.avgMs / 1000).toFixed(1)}s avg` : ""}</span>` : ""}<span class="pill">◆ ${d.hour.deep}/${d.perHour} this hour · at score ${d.deepMin}+</span></div></div>
    ${d.fast.ready ? (d.fast.cooling.length ? `<div class="card lane-note" style="margin-bottom:16px"><b>${d.fast.provider === "grok" ? "Grok" : "Groq"} limits:</b> ${d.fast.cooling.map((c) => `${esc(modelName(c.model))} back in ${c.secs < 120 ? c.secs + "s" : Math.round(c.secs / 60) + "m"}`).join(" · ")}. Other models keep going.</div>` : "")
      : `<div class="card lane-note" style="margin-bottom:16px"><b>⚡ Turn on the fast lane.</b> Run <code>grok login</code> once (uses your SuperGrok subscription), or paste a free Groq key in <a class="linkish" href="#/settings">Settings</a>, and every candidate gets graded instead of ${d.perHour} an hour.</div>`}
    ${d.narratives.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Narratives the AI rates</h2><small>average score of the coins carrying them, last 12h</small></div>
      <div class="nar-rank">${d.narratives.map((n, i) => `<div class="nar-row"><span class="num dim">${i + 1}</span><span class="emoji">${THEME_EMOJI[n.theme] || "✨"}</span><b class="grow">${esc(n.theme)}</b>
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
  if (!r || !r.status) return `<div class="p-sec"><h3>AI research</h3><div id="researchBox"><p class="note" style="margin:0 0 10px">Claude reads this coin's metadata, X, linked tweet, website, news and copycats, then grades the narrative and its ceiling. About 30 seconds.</p><button class="btn primary" data-research="${esc(mint)}">Research this coin</button></div></div>`;
  if (!["done", "deep"].includes(r.status)) return `<div class="p-sec"><h3>AI research</h3><div id="researchBox">${r.status === "error" ? `<p class="down">Last attempt failed: ${esc(r.error || "")}</p><button class="btn" data-research="${esc(mint)}">Try again</button>` : `<p class="note"><span class="pill running">${r.status === "running" ? "Researching…" : "Queued"}</span> This updates by itself in a moment.</p>`}</div></div>`;
  const x = r.report, s = r.sources || {};
  const so = s.socials || {};
  const list = (title, items, klass = "") => items?.length ? `<div class="r-list ${klass}"><h4>${title}</h4><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : "";
  return `<div class="p-sec research">
    <div class="r-head">${gradeBadge(x.grade, "xl")}<div><h3 style="margin:0 0 4px">AI research <span class="dim">· ${esc(x.confidence || "")} confidence · ${ago(r.t)} ago</span></h3><p class="r-verdict">${esc(x.verdict)}</p>
      <p class="dim small" style="margin:6px 0 0">${tierMark(r)} ${r.tier === "fast" ? "Fast read" : "Deep read"} by ${esc(modelName(r.model || x.model))}${r.ms ? ` in ${(r.ms / 1000).toFixed(1)}s` : ""}${r.status === "deep" ? " · Claude is double-checking it now" : ""}${x.fast ? ` · fast read said ${esc(x.fast.grade)} (${esc(modelName(x.fast.model))})` : ""}</p></div></div>
    ${x.trade ? `<div class="r-trade act-bg-${esc(x.trade.action)}"><div>${actionBadge(x.trade.action)} <b>Conviction ${x.trade.conviction}</b>${x.trade.entry ? ` · <span class="dim">Entry: ${esc(x.trade.entry)}</span>` : ""}</div>
      <p>${esc(x.trade.why || "")}</p>
      ${x.trade.action === "buy" ? `<div class="ladder">${(x.trade.takeProfits || []).map((tp) => `<span>${tp.sellPct}% @ ${tp.atMultiple}x</span>`).join("")}${x.trade.stopLossPct ? `<span class="stop">stop -${x.trade.stopLossPct}%</span>` : ""}${x.trade.trailingStopPct ? `<span>trail ${x.trade.trailingStopPct}%</span>` : ""}${x.trade.timeStopHours ? `<span>${x.trade.timeStopHours}h max</span>` : ""}</div>` : ""}</div>` : ""}
    <div class="r-grid">
      <div class="r-card"><h4>The narrative</h4><p>${esc(x.narrative?.summary || "")}</p>
        ${bar10("Strength", x.narrative?.strength)}${bar10("Timeliness", x.narrative?.timeliness)}${bar10("Originality", x.narrative?.originality)}${bar10("Reach", x.narrative?.reach)}</div>
      <div class="r-card"><h4>How high</h4><div class="ceiling">${esc(x.ceiling?.tier || "?")}</div><p>${esc(x.ceiling?.why || "")}</p>
        <h4 style="margin-top:12px">Catalyst</h4><p>${esc(x.catalyst || "none found")}</p></div>
    </div>
    <div class="r-grid">${list("Bull case", x.bull, "bull")}${list("Bear case", x.bear, "bear")}</div>
    ${list("Red flags", x.redFlags, "flags")}
    ${x.xBuzz ? `<div class="r-sources xbuzz"><h4>On X right now <span class="dim">· ${esc(x.xBuzz.sentiment || "?")} · ${esc(x.xBuzz.organic || "?")}</span></h4>
      <p style="margin:4px 0 8px">${esc(x.xBuzz.summary || "")}</p>
      ${(x.xBuzz.posts || []).map((po) => `<div class="src"><span><b>@${esc(String(po.handle || "?").replace(/^@/, ""))}</b>${/^https:\/\/(x|twitter)\.com\//.test(po.url || "") ? ` · <a class="linkish" href="${esc(po.url)}" target="_blank" rel="noreferrer">open</a>` : ""}<small>${esc(po.text || "")}</small></span></div>`).join("")}
      ${(x.xBuzz.notable || []).length ? `<div class="src"><span><b>Accounts</b>${x.xBuzz.notable.slice(0, 5).map((n) => `<small>· ${esc(n)}</small>`).join("")}</span></div>` : ""}
    </div>` : ""}
    <div class="r-sources"><h4>What it found</h4>
      ${so.x && !so.x.error ? `<div class="src"><img class="av sm" src="${esc(so.x.avatar || "")}" alt="" onerror="this.remove()"><span><b>@${esc(so.x.user)}</b> · ${(so.x.followers ?? 0).toLocaleString()} followers${so.x.joined ? ` · joined ${esc(String(so.x.joined).slice(0, 16))}` : ""}<small>${esc(so.x.description || "")}</small></span></div>` : `<div class="src dim">No X account linked${so.x?.error ? ` (${esc(so.x.error)})` : ""}</div>`}
      ${so.linkedTweet ? `<div class="src"><span><b>Linked tweet</b> by @${esc(so.linkedTweet.author || "?")} · ${(so.linkedTweet.likes ?? 0).toLocaleString()} likes<small>${esc(so.linkedTweet.text || "")}</small></span></div>` : ""}
      ${so.website && !so.website.error ? `<div class="src"><span><b>Website</b> · <a class="linkish" href="${esc(so.website.url)}" target="_blank" rel="noreferrer">${esc(so.website.title || so.website.url)}</a><small>${esc(so.website.description || "")}</small></span></div>` : ""}
      ${s.copycats ? `<div class="src"><span><b>Same ticker</b> · ${s.copycats.sameTicker} coins on Solana, this one is #${s.copycats.rankByMcap ?? "?"} by mcap${s.copycats.isOldest ? " and the oldest" : ""}</span></div>` : ""}
      ${(s.news || []).length ? `<div class="src"><span><b>News this week</b>${s.news.slice(0, 4).map((n) => `<small>· ${esc(n.title)}</small>`).join("")}</span></div>` : `<div class="src dim">No news this week</div>`}
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

function calTable(rows, label) {
  if (!rows?.length) return "";
  return `<div class="table-wrap"><table><thead><tr><th>${label}</th><th>Coins</th><th>Median peak</th><th>Hit 2x</th><th>Hit 5x</th><th>Dumped 50%</th><th>Median 24h</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td><b>${esc(r.key)}</b></td><td>${r.n}</td><td>${mult(r.medianPeak)}</td><td class="up">${rate(r.hit2x)}</td><td class="up">${rate(r.hit5x)}</td><td class="down">${rate(r.dumped)}</td><td>${mult(r.median24h)}</td></tr>`).join("")}</tbody></table></div>`;
}

function narCard(n) {
  const cat = n.catalysts || {};
  const ran = n.best_mult || n.best_peak;
  return `<div class="card scout">
    <div class="scout-top"><h3>${esc(n.name)}</h3>${stageBadge(n.stage)}<span class="num conf" title="confidence">${n.confidence}</span></div>
    <p>${esc(n.thesis || "")}</p>
    ${(cat.catalysts || []).length ? `<ul class="cats">${cat.catalysts.slice(0, 3).map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    <div class="kw">${(n.keywords || []).map((k) => `<span>${esc(k)}</span>`).join("")}</div>
    ${n.matches?.length ? `<div class="scout-coins">${n.matches.slice(0, 8).map((m) => `<span class="leader" data-mint="${esc(m.mint)}">${av(m, "sm")}<b>$${esc(m.symbol)}</b><span class="dim">${money(m.mcap)}</span></span>`).join("")}</div>` : `<div class="dim small">No radar coins on it yet${n.stage === "early" ? " (early: watch for launches)" : ""}</div>`}
    <div class="scout-foot"><span class="dim small">${ago(n.t)} ago${cat.risk ? ` · risk: ${esc(cat.risk)}` : ""}</span>${ran ? `<span class="pill ${n.best_mult >= 3 || n.best_peak >= 1e6 ? "ran" : ""}">${n.status === "scored" ? "Result" : "So far"}: ${n.best_mult ? `best ${mult(n.best_mult)}` : ""}${n.best_peak ? ` · peak ${money(n.best_peak)}` : ""}${n.launches_after ? ` · ${n.launches_after} new coins` : ""}</span>` : ""}</div>
  </div>`;
}

async function viewPicks(main) {
  const d = await api("picks");
  const sc = d.scorecard, c = sc.calls, pb = d.playbook;
  const lastScout = d.narratives[0]?.t;
  const latest = d.narratives.filter((n) => lastScout - n.t < 3 * 60_000);
  const earlier = d.narratives.filter((n) => lastScout - n.t >= 3 * 60_000 && (n.best_mult || n.best_peak)).slice(0, 9);
  main.innerHTML = `<div class="page-head"><div><h1>Grok's picks</h1>
      <p>Grok (your SuperGrok login, grok-4.7) does a deep read on every coin that passes the first screen: it searches X and the web, checks who's really posting, and decides <b>buy</b>, <b>watch</b> or <b>avoid</b> with an entry and an exit plan. Buy calls need conviction ${d.settings.buyConviction}+. Every call and every graded coin is tracked for 24 hours and each exit plan is paper-traded, so you can see what following Grok would have made. Grok reviews its own results and rewrites its playbook as they come in. Alerts only: it never trades.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="pkScout" ${d.busy.scouting ? "disabled" : ""}>${d.busy.scouting ? "Scouting…" : "Scout narratives now"}</button><button class="btn primary" id="pkReview" ${d.busy.reviewing ? "disabled" : ""}>${d.busy.reviewing ? "Reviewing…" : "Self-review now"}</button></div></div>
    <div class="kpis">
      <div class="card kpi"><b>Buy calls (7d)</b><span>${c.n}</span><small>${c.open} open · ${c.closed} closed</small></div>
      <div class="card kpi"><b>Win rate</b><span class="${c.winRate >= 0.5 ? "up" : c.winRate != null ? "down" : ""}">${rate(c.winRate)}</span><small>closed calls above entry</small></div>
      <div class="card kpi"><b>Avg paper exit</b><span class="${c.avgExit > 1 ? "up" : c.avgExit != null ? "down" : ""}">${mult(c.avgExit)}</span><small>following each exit plan</small></div>
      <div class="card kpi"><b>Playbook</b><span>v${pb.version}</span><small>${pb.version ? `${ago(pb.t)} ago · ${pb.rules.length} rules` : "first review after ~25 results"}</small></div>
    </div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Today's buy calls</h2><small>${d.today.length} today</small></div>
      ${d.today.length ? `<div class="calls">${d.today.map(callCard).join("")}</div>` : empty("No buy calls yet today", `Grok only calls a coin when its deep read says buy with conviction ${d.settings.buyConviction}+. Most coins don't make it, which is the point.`)}</div>
    <div class="radar-grid even">
      <div class="card"><div class="card-head"><h2>Deep reads today</h2><small>best first</small></div>
        <div class="feed">${d.watch.length ? d.watch.map((w) => `<div class="desk-row" data-mint="${esc(w.mint)}">${av(w)}<div class="desk-main"><div class="desk-title"><b>$${esc(w.symbol)}</b>${actionBadge(w.trade?.action)}${w.trade ? `<span class="dim small">conviction ${w.trade.conviction}</span>` : ""}</div>
          <p class="verdict">${esc(w.trade?.why || w.verdict || "")}</p>${w.trade?.entry ? `<div class="dim small">Entry: ${esc(w.trade.entry)}</div>` : ""}</div><div class="desk-side">${gradeBadge(w.grade)}<span class="num">${money(w.mcap)}</span></div></div>`).join("") : empty("No deep reads yet today", "Coins that score well on the fast read get a deep read here.")}</div></div>
      <div class="card"><div class="card-head"><h2>Playbook v${pb.version}</h2><small>Grok's own rules, from its results</small></div>
        ${pb.version ? `<p class="note" style="margin-top:0">${esc(pb.notes || "")}</p><ol class="rules">${pb.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>
          ${pb.changes.length ? `<h4 class="sub">Last changes</h4><ul class="rules dim">${pb.changes.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
          <div class="dim small">Tuned: buy calls at conviction ${pb.tuning.buyConviction ?? "—"}+, deep reads at score ${pb.tuning.deepMinScore ?? "—"}+</div>`
        : empty("No playbook yet", "Once about 25 graded coins have had 6+ hours to play out, Grok reviews what predicted runners and dumps and writes its first rules. Press Self-review to run it now.")}</div>
    </div>
    <div class="card" style="margin:16px 0"><div class="card-head"><h2>Running narratives</h2><small>${lastScout ? `Grok scouted X and the web ${ago(lastScout)} ago` : "first scout runs a few minutes after start"}</small></div>
      ${latest.length ? `<div class="scouts">${latest.map(narCard).join("")}</div>` : empty("No narratives scouted yet", "Grok searches X for narratives starting to run every 45 minutes.")}
      ${earlier.length ? `<h4 class="sub">How earlier calls did</h4><div class="scouts">${earlier.map(narCard).join("")}</div>` : ""}</div>
    <div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Track record</h2><small>${sc.graded} graded coins that have had 6h+ to play out, last 7 days</small></div>
      ${sc.graded ? `${calTable(sc.byGrade, "Grade")}${calTable(sc.byAction, "Deep read said")}${calTable(sc.byTier, "Read")}${calTable(sc.byOrganic, "X buzz")}${calTable(sc.byStage, "Stage")}${calTable(sc.byTheme, "Narrative")}`
        : empty("Results build up", "Each graded coin needs 6 hours before it counts. This fills in on its own.")}</div>
    ${d.calls.length > d.today.length ? `<div class="card"><div class="card-head"><h2>Earlier calls</h2><small>last 7 days</small></div><div class="calls">${d.calls.filter((x) => !d.today.includes(x)).map(callCard).join("")}</div></div>` : ""}`;
  $("#pkScout").onclick = async () => { await post("picks/scout"); toast("Grok is scouting X for narratives (about a minute)"); setTimeout(() => route() === "picks" && viewPicks(main), 1500); };
  $("#pkReview").onclick = async () => { await post("picks/review"); toast("Grok is reviewing its track record"); setTimeout(() => route() === "picks" && viewPicks(main), 1500); };
}

async function viewNarratives(main) {
  const nar = await api("narratives");
  main.innerHTML = `<div class="page-head"><div><h1>Narratives</h1><p>What coins are being launched around, and where the money is going. Heat mixes trading volume, coins that survive, and share of all new launches. Lift compares the last hour with the hours before.</p></div></div>
    ${nar.emerging.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Emerging words</h2><small>showing up far more in the last hour</small></div>
      <div class="words">${nar.emerging.map((e) => `<span class="word">${esc(e.word)}<em>${e.count}× · ${e.lift.toFixed(1)}x</em></span>`).join("")}</div></div>` : ""}
    <div class="nar-grid">${nar.themes.map((n) => `<div class="card nar">
      <div class="nar-top"><h3><span class="emoji">${THEME_EMOJI[n.name] || "✨"}</span> ${esc(n.name)}</h3><span class="num" style="font-size:20px">${n.heat}<span class="dim" style="font-size:12px">/100</span></span></div>
      <div class="heat" style="margin:0"><i style="width:${n.heat}%"></i></div>
      <div class="nar-nums">
        <div><b>Launch share</b><span>${(n.launchShare * 100).toFixed(1)}%</span></div>
        <div><b>Lift</b><span class="${n.launchLift >= 1.15 ? "up" : n.launchLift <= 0.85 && n.launchLift ? "down" : ""}">${n.launchLift ? n.launchLift.toFixed(2) + "x" : "—"}</span></div>
        <div><b>Vol 1h</b><span>${money(n.volume)}</span></div>
      </div>
      <div class="leaders">${n.top.length ? n.top.map((t) => `<div class="leader" data-mint="${esc(t.mint)}">${av(t, "sm")}<span class="grow"><b>$${esc(t.symbol)}</b> <span class="dim">${esc(t.name)}</span></span><span class="num">${money(t.mcap)}</span><span class="num ${cls(t.chg_h1)}" style="width:62px;text-align:right">${pct(t.chg_h1)}</span></div>`).join("") : `<span class="note">No tracked coins yet, only launches.</span>`}</div>
    </div>`).join("") || empty("Warming up", "Narratives need a few minutes of launches to show up.")}</div>`;
}

async function viewBriefs(main) {
  const list = await api("briefs");
  main.innerHTML = `<div class="page-head"><div><h1>Briefs</h1><p>Claude reads the radar every hour and writes what's happening: the tape, hot narratives, coins to watch, and red flags. Uses this PC's Claude login.</p></div><button class="btn primary" data-brief>Write one now</button></div>
    <div class="stack">${list.length ? list.map((b) => `<div class="card"><div class="card-head"><h2>${new Date(b.t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</h2><small>${ago(b.t)} ago</small></div><div class="brief md">${md(b.body)}</div></div>`).join("") : `<div class="card">${empty("No briefs yet", "The first one is written about 12 minutes after the radar starts.")}</div>`}</div>`;
}

async function viewRecord(main) {
  const p = await api("perf");
  const a = p.all;
  const r = (x) => x == null ? "—" : `${Math.round(x * 100)}%`;
  main.innerHTML = `<div class="page-head"><div><h1>Track record</h1><p>Every signal is checked 15 minutes, 1 hour, 6 hours and 24 hours later. This is how you find out whether the radar has an edge before you trust it with money.</p></div></div>
    <div class="kpis">
      <div class="card kpi"><b>Signals scored</b><span>${a.scored}</span><small>of ${a.count} in 14 days</small></div>
      <div class="card kpi"><b>Up 20%+ after 1h</b><span class="up">${r(a.win1h)}</span><small>share of signals</small></div>
      <div class="card kpi"><b>Down 50%+ after 1h</b><span class="down">${r(a.rug1h)}</span><small>share of signals</small></div>
      <div class="card kpi"><b>Hit 2x at peak</b><span>${r(a.twoX)}</span><small>median peak ${mult(a.medianPeak)}</small></div>
    </div>
    <div class="radar-grid">
      <div class="card"><div class="card-head"><h2>By signal type</h2></div>${p.byKind.length ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Count</th><th>Up 20% 1h</th><th>Down 50% 1h</th><th>Avg 1h</th><th>2x peak</th></tr></thead>
        <tbody>${p.byKind.map((k) => `<tr><td><span class="tag" style="--k:${kindOf(k.kind)[1]}">${kindOf(k.kind)[0]}</span></td><td>${k.count}</td><td class="up">${r(k.win1h)}</td><td class="down">${r(k.rug1h)}</td><td>${mult(k.avg1h)}</td><td>${r(k.twoX)}</td></tr>`).join("")}</tbody></table></div>` : empty("No results yet", "Signals need at least an hour before they can be scored.")}</div>
      <div class="card"><div class="card-head"><h2>Best calls this week</h2></div>${p.best.length ? p.best.map((s) => `<div class="sig" style="--k:${kindOf(s.kind)[1]}" data-mint="${esc(s.mint)}">${av(s)}<div style="min-width:0"><span class="tag">${kindOf(s.kind)[0]}</span><h3>$${esc(s.symbol)} · ${esc(s.name)}</h3><p>Called at ${money(s.mcap)} · ${ago(s.t)} ago</p></div><div class="meta"><b class="up">${mult(s.peak)}</b>peak</div></div>`).join("") : empty("Nothing yet", "Check back after a few hours of running.")}</div>
    </div>`;
}

const NOTIFY = [["launch", "New launches"], ["graduated", "Graduations"], ["momentum", "Momentum"], ["volume", "Volume spikes"], ["mcap-1000000", "$1M milestones"], ["mcap-5000000", "$5M milestones"], ["dump", "Dump warnings"], ["wallet", "Wallet buys"], ["smart", "Smart money"], ["dev-sold", "Dev sold"], ["rugged", "Rugged"], ["fomo", "Fomo crowd buys"], ["buy", "Grok buy calls"], ["research", "A-grade research"], ["brief", "AI briefs"]];
async function viewSettings(main) {
  const { settings: s } = await api("settings");
  const num = (k, label, help) => `<div class="field"><label for="s-${k}">${label}</label><input class="input num" id="s-${k}" name="${k}" type="number" value="${s[k]}"><small>${help}</small></div>`;
  main.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>Where updates go and how picky the radar is. Saved on this PC only.</p></div><button class="btn primary" id="save">Save</button></div>
  <form id="sform" class="stack" onsubmit="return false">
    <div class="card"><div class="card-head"><h2>Updates</h2><button class="btn" type="button" id="testN">Send test message</button></div>
      <div class="form">
        <div class="field"><label for="s-discordWebhook">Discord webhook URL</label><input class="input" id="s-discordWebhook" name="discordWebhook" value="${esc(s.discordWebhook)}" placeholder="https://discord.com/api/webhooks/…"><small>Channel settings → Integrations → Webhooks → New webhook → Copy URL.</small></div>
        <div class="field"><label for="s-telegramToken">Telegram bot token</label><input class="input" id="s-telegramToken" name="telegramToken" value="${esc(s.telegramToken)}" placeholder="123456:ABC…"><small>From @BotFather.</small></div>
        <div class="field"><label for="s-telegramChat">Telegram chat ID</label><input class="input" id="s-telegramChat" name="telegramChat" value="${esc(s.telegramChat)}" placeholder="e.g. 123456789"><small>Message your bot, then get it from @userinfobot.</small></div>
        <div class="field" style="grid-column:1/-1"><label>Send me</label><div class="checks">${NOTIFY.map(([k, l]) => `<label class="check"><input type="checkbox" name="notifyKinds" value="${k}" ${s.notifyKinds.includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="aiBriefs" ${s.aiBriefs ? "checked" : ""}> Write AI briefs automatically</label></div>
        ${num("briefEveryMin", "Brief every (minutes)", "How often Claude writes a market brief.")}
      </div></div>
    <div class="card"><div class="card-head"><h2>AI research</h2><small>coins about to bond and just bonded</small></div>
      <div class="form">
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="researchAuto" ${s.researchAuto ? "checked" : ""}> Research automatically</label><small>With a Groq key: every coin 60%+ to bonding and every bonded coin with volume. Without: only the strongest.</small></div>
        <div class="field"><label for="s-fastProvider">⚡ Fast lane</label><div style="display:flex;gap:8px"><select class="input" id="s-fastProvider" name="fastProvider" style="flex:1"><option value="grok" ${s.fastProvider !== "groq" ? "selected" : ""}>Grok (my SuperGrok login)</option><option value="groq" ${s.fastProvider === "groq" ? "selected" : ""}>Groq (free key)</option></select><button class="btn" type="button" id="testK">Test Grok</button></div><small>Grok uses this PC's Grok CLI login, no key. If Grok fails and a Groq key is set, Groq takes over.</small></div>
        <div class="field"><label for="s-grokModel">Grok model</label><select class="input" id="s-grokModel" name="grokModel">${["grok-4.7-build-fast", "grok-4.7", "grok-4.6"].map((m) => `<option ${s.grokModel === m ? "selected" : ""}>${m}</option>`).join("")}</select><small>build-fast is the quick one. grok-4.7 thinks harder but takes much longer.</small></div>
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="grokSearch" ${s.grokSearch ? "checked" : ""}> Grok searches X live</label><small>Grok looks the coin up on X by contract and ticker: who's posting, real engagement, organic or botted. About 8s per coin.</small></div>
        <div class="field" style="grid-column:1/-1"><label for="s-groqKey">Groq API key (optional fallback, free)</label><div style="display:flex;gap:8px"><input class="input num" id="s-groqKey" name="groqKey" type="password" value="${esc(s.groqKey)}" placeholder="gsk_…" style="flex:1"><button class="btn" type="button" id="testG">Test</button></div><small>Free at console.groq.com/keys (no card). Grades a coin in about a second. When one model hits its free limit the radar switches to the next one.</small></div>
        <div class="field"><label for="s-fastModel">Fast model</label><select class="input" id="s-fastModel" name="fastModel">${["openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"].map((m) => `<option ${s.fastModel === m ? "selected" : ""}>${m}</option>`).join("")}</select><small>Tried first. The rest are fallbacks.</small></div>
        ${num("fastPerHour", "Max fast reads per hour", "Groq's free tier has daily limits per model; this keeps a steady pace.")}
        ${num("deepMinScore", "Claude double-checks at score", "Fast reads scoring this or higher get a deeper read from Claude.")}
        <div class="field"><label for="s-deepProvider">◆ Deep reads</label><select class="input" id="s-deepProvider" name="deepProvider"><option value="grok" ${s.deepProvider !== "claude" ? "selected" : ""}>Grok (grok-4.7, searches X, makes buy calls)</option><option value="claude" ${s.deepProvider === "claude" ? "selected" : ""}>Claude</option></select><small>The deep read decides buy / watch / avoid with an exit plan.</small></div>
        <div class="field"><label for="s-deepModel">Deep Grok model</label><select class="input" id="s-deepModel" name="deepModel">${["grok-4.7", "grok-4.6", "grok-4.7-build-fast"].map((m) => `<option ${s.deepModel === m ? "selected" : ""}>${m}</option>`).join("")}</select><small>grok-4.7 is the smartest; about 30-60s a read.</small></div>
        ${num("deepPerHour", "Max Grok deep reads per hour", "Runs 2 at a time.")}
        ${num("deepSearches", "Searches per deep read", "How many X/web searches Grok may run on one coin.")}
        ${num("buyConviction", "Buy call at conviction", "Starting point; Grok's self-review tunes it from results (55-90).")}
        ${num("scoutEveryMin", "Scout narratives every (minutes)", "Grok searches X and the web for narratives starting to run. 0 = off.")}
        ${num("reviewMinNew", "Self-review after N new results", "Grok re-writes its playbook once this many graded coins have played out 6h+.")}
        ${num("researchPerHour", "Max Claude reads per hour", "Each uses your Claude subscription (about one normal Claude message). Lower this if you hit your Claude limits.")}
      </div></div>
    <div class="card"><div class="card-head"><h2><span class="fomo-mark">fomo</span> Connection</h2><small>free, on-chain, no API key</small></div>
      <div class="form">
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="fomoAutoFollow" ${s.fomoAutoFollow ? "checked" : ""}> Auto-follow the best Fomo traders</label><small>Traders the radar watched make money on Fomo (3+ closed coins, $300+ profit, 50%+ win rate).</small></div>
        ${num("fomoFollowTop", "Max Fomo traders to follow", "Each followed wallet costs RPC calls.")}
      </div></div>
    <div class="card"><div class="card-head"><h2>Wallets</h2></div>
      <div class="form">
        <div class="field" style="grid-column:1/-1"><label for="s-rpcUrl">Solana RPC URL</label><input class="input num" id="s-rpcUrl" name="rpcUrl" value="${esc(s.rpcUrl)}" placeholder="Blank = free public RPC (slow)"><small>For fast wallet tracking, make a free account at helius.dev and paste its mainnet RPC URL here. Blank uses the public RPC, which only allows about one transaction lookup a second.</small></div>
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="autoFollowSmart" ${s.autoFollowSmart ? "checked" : ""}> Auto-follow discovered smart wallets</label><small>Adds the best wallets the radar finds, up to the limit below.</small></div>
        ${num("maxSmartWallets", "Max auto-followed wallets", "More wallets means more RPC calls.")}
        ${num("walletMinSol", "Smart wallet alert minimum (SOL)", "Buys by auto-followed wallets below this are logged but not alerted. Wallets you add always alert.")}
      </div></div>
    <div class="card"><div class="card-head"><h2>Filters</h2><small>higher = fewer, stronger signals</small></div>
      <div class="form">
        ${num("minSafety", "Minimum safety", "0–100 from RugCheck. Coins with any “danger” risk never signal.")}
        ${num("launchScore", "New-launch score", "Score a coin under 2h old needs to raise a launch signal.")}
        ${num("momentumScore", "Momentum score", "Score any coin needs to raise a momentum signal.")}
        ${num("spikeMinVol", "Volume spike minimum ($ in 5m)", "Smallest 5-minute volume that counts as a spike.")}
        ${num("nurseryMinMcap", "Launch survival mcap ($)", "A pump.fun launch must reach this within ~4 minutes to be tracked.")}
        ${num("nurseryMinVol5m", "Launch survival volume ($ in 5m)", "…or trade this much in 5 minutes.")}
        ${num("maxTracked", "Max coins tracked", "Weakest coins are dropped past this.")}
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
  $("#save").onclick = async () => { await post("settings", collect()); toast("Saved"); };
  $("#testK").onclick = async () => {
    await post("settings", collect());
    const r = await post("test-grok");
    toast(r.ok ? `Grok works${r.tier ? ` (${r.tier})` : ""}: ${r.model} answered in ${(r.ms / 1000).toFixed(1)}s` : r.error);
  };
  $("#testG").onclick = async () => {
    await post("settings", collect());
    const r = await post("test-fast");
    toast(r.ok ? `Groq works: ${modelName(r.model)} answered in ${(r.ms / 1000).toFixed(2)}s` : r.error);
  };
  $("#testN").onclick = async () => {
    await post("settings", collect());
    const r = await post("test-notify");
    toast(r.errors.length ? r.errors[0] : "Test message sent");
  };
}

// ---------- coin drawer ----------
function sparkline(snaps) {
  const pts = snaps.filter((s) => s.price > 0);
  if (pts.length < 2) return `<p class="note">Price history builds up while the radar watches this coin.</p>`;
  const W = 760, H = 150, xs = pts.map((p) => p.t), ys = pts.map((p) => p.price);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (t) => ((t - x0) / Math.max(x1 - x0, 1)) * W, Y = (v) => H - 8 - ((v - y0) / Math.max(y1 - y0, 1e-18)) * (H - 16);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.price).toFixed(1)}`).join("");
  const up = ys[ys.length - 1] >= ys[0];
  const c = up ? "var(--up)" : "var(--down)";
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price since tracking started">
    <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? "#39ff88" : "#ff4d6d"}" stop-opacity=".25"/><stop offset="1" stop-color="${up ? "#39ff88" : "#ff4d6d"}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${W},${H}L0,${H}Z" fill="url(#fill)"/><path d="${d}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <p class="note">${pts.length} readings over ${ago(x0)} · ${up ? "up" : "down"} ${mult(ys[ys.length - 1] / ys[0])} since first seen</p>`;
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
  return `<div class="p-sec"><h3>Holders & dev</h3>
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

async function openCoin(mint) {
  const d = $("#drawer"), p = $("#panel");
  d.hidden = false;
  p.innerHTML = `<div class="skel" style="margin-top:22px"></div><div class="skel"></div><div class="skel"></div>`;
  let r;
  try { r = await api(`token/${mint}`); } catch (e) { p.innerHTML = empty("Couldn't load this coin", e.message); return; }
  const t = r.token, s = t.safety;
  const links = t.links || [];
  const dex = `https://dexscreener.com/solana/${t.pair || t.mint}`;
  const age = Date.now() - (t.pair_created || t.first_seen);
  p.innerHTML = `
    <div class="hero">
      <div class="banner">${t.header ? `<img src="${esc(t.header)}" alt="" onerror="this.remove()">` : ""}<span class="banner-gen" style="background-image:url('${genAvatar(t.mint + "banner")}')"></span></div>
      <button class="close" data-close aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      <div class="hero-body">
        <div class="hero-av">${av(t, "xl")}</div>
        <div class="hero-id"><h2>$${esc(t.symbol)}</h2>
          <div class="sub">${esc(t.name)}${t.dex ? " · " + esc(t.dex) : ""}${t.graduated ? " · graduated" : ""} · ${ago(t.pair_created || t.first_seen)} old</div>
          <div class="chips">${safetyChip(t.safety_score)}${(t.themes || []).map((x) => `<span class="pill">${THEME_EMOJI[x] || ""} ${esc(x)}</span>`).join("")}</div></div>
        <div class="hero-price"><span class="big num">${price(t.price)}</span><span class="chg ${cls(t.chg_h1)}">${pct(t.chg_h1)} <small>1h</small></span><small class="dim">${money(t.mcap)} mcap</small>${r.progress != null && !t.graduated ? `<div class="bond hero-bond"><div class="bond-bar"><i style="width:${Math.round(r.progress * 100)}%"></i></div><span class="num">${Math.round(r.progress * 100)}% bonded</span></div>` : ""}</div>
      </div>
    </div>
    <div class="p-acts">
      ${fomoBtn(t.mint, true)}
      <a class="btn" href="${dex}" target="_blank" rel="noreferrer">DexScreener</a>
      <a class="btn" href="https://pump.fun/coin/${esc(t.mint)}" target="_blank" rel="noreferrer">pump.fun</a>
      <a class="btn" href="https://rugcheck.xyz/tokens/${esc(t.mint)}" target="_blank" rel="noreferrer">RugCheck</a>
      ${links.map(linkBtn).join("")}
      <button class="btn" data-copy="${esc(t.mint)}">Copy mint</button>
    </div>
    <div class="p-sec"><div class="facts">
      <div class="fact"><b>Price</b><span>${price(t.price)}</span></div><div class="fact"><b>Mcap</b><span>${money(t.mcap)}</span></div>
      <div class="fact"><b>Liquidity</b><span>${money(t.liquidity)}</span></div><div class="fact"><b>Peak mcap</b><span>${money(t.peak_mcap)}</span></div>
      <div class="fact"><b>Vol 5m</b><span>${money(t.vol_m5)}</span></div><div class="fact"><b>Vol 1h</b><span>${money(t.vol_h1)}</span></div>
      <div class="fact"><b>5m / 1h</b><span><span class="${cls(t.chg_m5)}">${pct(t.chg_m5)}</span> <span class="${cls(t.chg_h1)}">${pct(t.chg_h1)}</span></span></div>
      <div class="fact"><b>Buys / sells 1h</b><span>${t.buys_h1 ?? "—"} / ${t.sells_h1 ?? "—"}</span></div>
      <div class="fact"><b>Score</b><span>${t.score}/100</span></div><div class="fact"><b>Safety</b><span>${t.safety_score ?? "—"}${t.safety_score != null ? "/100" : ""}</span></div>
      <div class="fact"><b>LP locked</b><span>${s?.lpLockedPct != null ? Math.round(s.lpLockedPct) + "%" : "—"}</span></div>
      <div class="fact"><b>Age</b><span>${ago(t.pair_created || t.first_seen)}</span></div>
    </div></div>
    ${researchSection(r.research, t.mint)}
    ${holdersSection(t, s)}
    ${r.wallets?.length ? `<div class="p-sec"><h3>Wallets you follow in this coin</h3>${r.wallets.map((w) => `<div class="leader" data-wallet="${esc(w.wallet)}">${wav(w.wallet, w, "sm")}<span class="grow"><b>${esc(w.label || shortAddr(w.wallet))}</b> <span class="dim">first in ${ago(w.first)} ago</span></span><span class="num up">${w.bought ? "+" + money(w.bought) : ""}</span><span class="num down" style="width:70px;text-align:right">${w.sold ? "−" + money(w.sold) : ""}</span></div>`).join("")}</div>` : ""}
    ${fomoFlowSection(r.fomo)}
    <div class="p-sec"><h3>Safety check</h3>${s ? (s.risks.length ? `<div class="risks">${s.risks.map((x) => `<div class="risk"><i style="background:${x.level === "danger" ? "var(--down)" : x.level === "warn" ? "var(--warn)" : "var(--info)"}"></i><div><b>${esc(x.name)}</b>${x.value ? ` <span class="dim">${esc(x.value)}</span>` : ""}<small>${esc(x.description || "")}</small></div></div>`).join("")}</div>` : `<p class="up">RugCheck found no risks.</p>`) : `<p class="note">Not checked yet. Coins are checked when they first show real trading.</p>`}</div>
    <div class="p-sec"><h3>Price while tracked</h3>${sparkline(r.snapshots)}</div>
    ${r.signals.length ? `<div class="p-sec"><h3>Signals</h3>${r.signals.map((x) => `<div class="risk"><i style="background:${kindOf(x.kind)[1]}"></i><div><b>${esc(x.title)}</b> <span class="dim">${ago(x.t)} ago</span><small>${esc(x.detail)}${x.p1h != null ? ` · 1h later: ${mult(x.p1h)}` : ""}${x.peak != null ? ` · peak ${mult(x.peak)}` : ""}</small></div></div>`).join("")}</div>` : ""}
    ${t.description ? `<div class="p-sec"><h3>About</h3><p style="margin:0;color:var(--ink-2)">${esc(t.description)}</p></div>` : ""}
    <div class="p-sec"><h3>Chart</h3><iframe class="embed" src="https://dexscreener.com/solana/${esc(t.pair || t.mint)}?embed=1&theme=dark&trades=0&info=0" title="DexScreener chart" loading="lazy"></iframe></div>
    <div class="p-sec"><div class="mint">${esc(t.mint)}</div></div>`;
  p.scrollTop = 0;
}
// Refresh the open coin page (or the desk) when its research finishes.
function pollResearch(mint, tries = 0) {
  setTimeout(async () => {
    const r = await api(`research/${mint}`).catch(() => null);
    if (r?.status === "deep" && !pollResearch.shown?.has(mint)) {
      (pollResearch.shown ||= new Set()).add(mint);
      if (!$("#drawer").hidden && $("#panel").innerHTML.includes(mint)) openCoin(mint);
      toast(`Fast read: ${r.grade}. Claude is double-checking`);
    }
    if (r?.status === "done" || r?.status === "error" || tries > 40) {
      if (!$("#drawer").hidden && $("#panel").innerHTML.includes(mint)) openCoin(mint);
      if (route() === "research") viewResearch($("#main"));
      if (r?.status === "done") toast(`Graded ${r.grade}`);
      return;
    }
    pollResearch(mint, tries + 1);
  }, 3000);
}
function closeCoin() { $("#drawer").hidden = true; $("#panel").innerHTML = ""; }

// ---------- routing ----------
const VIEWS = { "": viewRadar, picks: viewPicks, research: viewResearch, coins: viewCoins, wallets: viewWallets, narratives: viewNarratives, briefs: viewBriefs, record: viewRecord, settings: viewSettings };
const route = () => location.hash.replace(/^#\/?/, "").split("/")[0];
async function render() {
  const r = route();
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.r === r));
  const main = $("#main");
  try { await (VIEWS[r] || viewRadar)(main); }
  catch (e) { main.innerHTML = `<div class="card">${empty("Radar isn't responding", e.message)}</div>`; }
}
window.addEventListener("hashchange", () => { if (!$("#drawer").hidden) closeCoin(); render(); });

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const el = e.target;
  if (el.closest("[data-close]")) return closeCoin();
  const copy = el.closest("[data-copy]");
  if (copy) { navigator.clipboard?.writeText(copy.dataset.copy); return toast("Mint copied"); }
  const ex = el.closest("[data-explain]");
  if (ex) {
    ex.disabled = true; ex.textContent = "Claude is reading the chart…";
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
    if (!$("#drawer").hidden) openWallet(follow.dataset.follow);
    if (route() === "wallets") viewWallets($("#main"));
    return;
  }
  const rb = el.closest("[data-research]");
  if (rb) {
    rb.disabled = true; rb.textContent = "Queued…";
    try {
      await post(`research/${rb.dataset.research}`);
      toast("Researching — about 30 seconds");
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
  if (th && route() === "coins") { coinState.sort = th.dataset.sort === "liq" ? "mcap" : th.dataset.sort; return loadCoins(); }
  const m = el.closest("[data-mint]");
  if (m && !el.closest("a")) openCoin(m.dataset.mint);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "cq") { coinState.q = e.target.value.trim(); clearTimeout(window._cq); window._cq = setTimeout(loadCoins, 250); }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "csafe") { coinState.minSafety = e.target.value; loadCoins(); }
  if (e.target.id === "cgrad") { coinState.grad = e.target.checked; loadCoins(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#drawer").hidden) closeCoin(); });

// ---------- live stream ----------
function connect() {
  const es = new EventSource("/api/stream");
  const live = $("#live");
  es.addEventListener("hello", () => { live.classList.add("on"); live.querySelector("span").textContent = "live"; });
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
    if (feed) {
      if (feed.querySelector(".empty")) feed.innerHTML = "";
      feed.insertAdjacentHTML("afterbegin", sigRow({ ...s, symbol: s.token?.symbol, image: s.token?.image }, true));
    }
    if (document.hidden && Notification?.permission === "granted") new Notification(s.title, { body: s.detail, icon: s.token?.image || "/icon.svg" });
  });
  es.addEventListener("walletTrade", (ev) => {
    const { wallet: w, trade } = JSON.parse(ev.data);
    const feed = $("#wfeed");
    if (!feed) return;
    if (feed.querySelector(".empty")) feed.innerHTML = "";
    feed.insertAdjacentHTML("afterbegin", tradeRow({ ...trade, wallet: w.address, label: w.label, source: w.source }).replace('class="sig"', 'class="sig new"'));
  });
  es.addEventListener("brief", (ev) => { const b = JSON.parse(ev.data); const c = $("#briefCard"); if (c) c.innerHTML = briefCard(b); toast("New AI brief"); });
  es.onerror = () => { live.classList.remove("on"); live.querySelector("span").textContent = "reconnecting"; };
}

if ("Notification" in window && Notification.permission === "default") setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
api("overview").then(renderStrip).catch(() => {});
render();
connect();
setInterval(() => { if (route() === "" && !document.hidden) viewRadar($("#main")).catch(() => {}); }, 60_000);
