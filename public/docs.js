// The API and MCP pages (#/api, #/mcp): how to read Blix from a script, a bot or an AI client. The
// endpoint, event and tool lists are the shared modules the public docs pages (worker/) and the MCP server
// load, so these pages cannot drift from what the server offers. app.js passes its helpers in `ctx`.

// ---------- icons (24px grid, stroked with currentColor) ----------
const P = {
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  pulse: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/><path d="M3.2 12h6.3l.5-1 2 4.5 2-7 1.5 3.5h5.3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0"/><path d="M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  grad: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/><path d="M22 10v6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
  play: '<polygon points="7 4 20 12 7 20 7 4"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  bot: '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18"/><path d="M7 6h1v4"/><path d="m16.7 13.9.7.7-2.8 2.8"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9A2.5 2 0 0 0 12 8c-1.7 0-3 .9-3 2s1.3 2 3 2 3 .9 3 2-1.3 2-3 2a3 2.4 0 0 1-2.8-1"/><path d="M12 6v2"/><path d="M12 16v2"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  candles: '<path d="M9 5v4"/><rect x="7" y="9" width="4" height="6" rx="1"/><path d="M9 15v2"/><path d="M17 3v2"/><rect x="15" y="5" width="4" height="8" rx="1"/><path d="M17 13v3"/><path d="M3 21h18"/>',
  swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.7V17c0 .6-.5 1-1 1.2-1.2.5-2 2-2 3.8"/><path d="M14 14.7V17c0 .6.5 1 1 1.2 1.2.5 2 2 2 3.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  buy: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  sell: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
};
const ic = (name, cls = "") => `<svg class="di ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.code}</svg>`;
const tile = (name, cls = "") => `<span class="d-tile ${cls}">${ic(name)}</span>`;

const GROUP_ICON = { "Market": "chart", "Signals, narratives, briefs": "bell", "Research and picks": "sparkles", "Paper desk": "clipboard", "Wallets and Fomo": "wallet", "Track record, health, ops": "pulse" };
const EVENT_ICON = { tick: "clock", launch: "rocket", live: "activity", signal: "zap", mig: "grad", pic: "image", paper: "clipboard", brief: "news" };
const TOOL_ICON = { overview: "layers", pulse: "activity", signals: "bell", coins: "coins", coin: "coin", holders: "users", candles: "candles", quote: "swap", narratives: "trend",
  briefs: "news", research: "sparkles", picks: "target", wallets: "wallet", wallet: "wallet", fomo: "eye", track_record: "trophy", health: "pulse", paper_desk: "clipboard", paper_buy: "buy", paper_sell: "sell" };

let spy = null;   // the section highlighter of the page on screen

// ---------- shared pieces ----------
const slug = (s) => `doc-${String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

// JSON with its keys, strings, numbers and literals marked; everything else escaped as text.
function highlightJson(text, esc) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let out = "", i = 0;
  for (const m of text.matchAll(re)) {
    const [all, str, colon, lit] = m;
    out += esc(text.slice(i, m.index));
    out += str ? (colon ? `<span class="j-k">${esc(str)}</span>${esc(colon)}` : `<span class="j-s">${esc(str)}</span>`) : `<span class="${lit ? "j-l" : "j-n"}">${esc(all)}</span>`;
    i = m.index + all.length;
  }
  return out + esc(text.slice(i));
}
// Code samples: strings and comments picked out; a placeholder like <blix folder> is marked as one.
function highlightCode(text, esc) {
  return esc(text)
    .replace(/(&quot;.*?&quot;|&#39;.*?&#39;)/g, '<span class="j-s">$1</span>')
    .replace(/(^|\s)(#[^\n]*|\/\/[^\n]*)/g, '$1<span class="j-c">$2</span>')
    .replace(/&lt;blix folder&gt;/g, '<span class="d-ph">&lt;blix folder&gt;</span>');
}

// A code block: a bar with its language and a copy button, then the code. Several become tabs.
function codeBlock(samples, esc, { id = "", tall = false } = {}) {
  const tabs = samples.length > 1 ? `<div class="d-tabs" role="tablist">${samples.map((s, i) => `<button role="tab" class="${i ? "" : "on"}" aria-selected="${!i}" data-dtab="${i}">${ic(s.icon || "code")}${esc(s.label)}</button>`).join("")}</div>`
    : `<span class="d-lang">${ic(samples[0].icon || "code")}${esc(samples[0].label)}</span>`;
  return `<div class="d-code ${tall ? "tall" : ""}" ${id ? `id="${id}"` : ""}>
    <div class="d-code-bar">${tabs}<button class="d-copy" data-copy="${esc(samples[0].code)}" aria-label="Copy code">${ic("copy")}<span>Copy</span></button></div>
    ${samples.map((s, i) => `<pre class="d-pre" data-dpane="${i}" ${i ? "hidden" : ""} data-code="${esc(s.code)}">${highlightCode(s.code, esc)}</pre>`).join("")}</div>`;
}

// Shared behaviour: copy feedback, code tabs, the section nav (smooth scroll, current section lit).
function wire(wrap) {
  wrap.addEventListener("click", (e) => {
    const cp = e.target.closest(".d-copy, [data-copy].d-chip, .ep-path");
    if (cp) {
      cp.classList.add("done");
      const icon = cp.querySelector("svg.di");
      if (icon) icon.innerHTML = P.check;
      clearTimeout(cp._t);
      cp._t = setTimeout(() => { cp.classList.remove("done"); if (icon) icon.innerHTML = P.copy; }, 1400);
    }
    const tab = e.target.closest("[data-dtab]");
    if (tab) {
      const box = tab.closest(".d-code"), i = tab.dataset.dtab;
      box.querySelectorAll("[data-dtab]").forEach((b) => { b.classList.toggle("on", b === tab); b.setAttribute("aria-selected", String(b === tab)); });
      box.querySelectorAll("[data-dpane]").forEach((p) => { p.hidden = p.dataset.dpane !== i; });
      box.querySelector(".d-copy").dataset.copy = box.querySelector(`[data-dpane="${i}"]`).dataset.code;
    }
    const go = e.target.closest("[data-goto]");
    if (go) document.getElementById(go.dataset.goto)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  spy?.disconnect();
  const links = new Map([...wrap.querySelectorAll("[data-goto]")].map((a) => [a.dataset.goto, a]));
  spy = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { links.forEach((a) => a.classList.remove("on")); links.get(en.target.id)?.classList.add("on"); }
  }, { rootMargin: "-15% 0px -70% 0px" });
  // Once the page is on screen (the view renders into a hidden staging node first): open at the top, then
  // light the section being read.
  requestAnimationFrame(() => { window.scrollTo(0, 0); wrap.querySelectorAll(".d-sec[id]").forEach((s) => spy.observe(s)); });
}

const nav = (items, esc) => `<nav class="d-nav" aria-label="On this page"><small>On this page</small>${items.map(([id, label, icon, n]) => `<button data-goto="${id}">${ic(icon)}<span>${esc(label)}</span>${n != null ? `<em>${n}</em>` : ""}</button>`).join("")}</nav>`;
const secHead = (icon, title, aside, esc) => `<header class="d-sec-head">${tile(icon)}<h2>${esc(title)}</h2>${aside ? `<small>${aside}</small>` : ""}</header>`;

// ---------- API ----------
export async function viewApi(main, { esc }) {
  const { API_DOCS, API_EVENTS } = await import("/api-docs.js");
  const base = location.origin, n = API_DOCS.reduce((a, [, rows]) => a + rows.length, 0);
  const path = (p) => esc(p).replace(/&lt;([a-z]+)&gt;/gi, '<span class="ep-param">&lt;$1&gt;</span>').replace(/\?…$/, '<span class="ep-q">?…</span>');
  const row = ([m, p, d, run]) => `<div class="ep">
      <span class="ep-m m-${m.toLowerCase()}">${m}</span>
      <button class="ep-path" data-copy="${esc(base + p.replace(/\?…$/, ""))}" title="Copy the full URL"><code>${path(p)}</code>${ic("copy")}</button>
      <p class="ep-desc">${esc(d)}</p>
      ${run ? `<button class="ep-run" data-run="${esc(p.split("?")[0])}" aria-expanded="false">${ic("play")}<span>Run</span></button>` : `<span class="ep-run-none"></span>`}
    </div>`;
  const quick = codeBlock([
    { label: "curl", icon: "terminal", code: `# a snapshot of the market\ncurl -s ${base}/api/overview\n\n# every event as it happens\ncurl -N ${base}/api/stream` },
    { label: "JavaScript", icon: "code", code: `const overview = await (await fetch("${base}/api/overview")).json();\n\nconst es = new EventSource("${base}/api/stream");\nes.addEventListener("signal", (e) => console.log(JSON.parse(e.data)));` },
    { label: "Python", icon: "code", code: `import json, requests\n\noverview = requests.get("${base}/api/overview").json()\n\nwith requests.get("${base}/api/stream", stream=True) as r:\n    for line in r.iter_lines():\n        if line.startswith(b"data:"):\n            print(json.loads(line[5:]))` },
  ], esc);
  const wrap = document.createElement("div");
  wrap.className = "apidoc docs";
  wrap.innerHTML = `
    <div class="d-layout">
      ${nav([["doc-start", "Quick start", "zap"], ["doc-stream", "Live stream", "radio", API_EVENTS.length], ...API_DOCS.map(([t, rows]) => [slug(t), t, GROUP_ICON[t] || "code", rows.length]), ["doc-errors", "Errors and caching", "alert"]], esc)}
      <div class="d-main">
        <header class="d-hero">
          <span class="d-hero-ic">${ic("code")}</span>
          <div class="d-hero-text">
            <small class="d-eyebrow">Developers</small>
            <div class="page-head"><h1>API</h1></div>
            <p>Blix serves JSON over plain HTTP and one live event stream. This dashboard is just a client of it, so anything shown here can be read from a script, a bot or your own front end.</p>
            <div class="d-facts">
              <button class="d-chip mono" data-copy="${esc(base)}" title="Copy the base URL">${ic("link")}<span>${esc(base)}</span></button>
              <span class="d-chip">${ic("layers")}<span>${n} endpoints</span></span>
              <span class="d-chip">${ic("radio")}<span>1 event stream</span></span>
              <span class="d-chip">${ic("lock")}<span>No key on this PC · <code>blix_key</code> cookie remotely</span></span>
            </div>
          </div>
        </header>

        <section class="d-sec" id="doc-start">
          ${secHead("zap", "Quick start", "two calls cover most bots", esc)}
          ${quick}
        </section>

        <section class="d-sec" id="doc-stream">
          ${secHead("radio", "Live stream", `<button class="d-chip mono" data-copy="${esc(base)}/api/stream">${ic("copy")}<span>GET /api/stream</span></button><span class="d-dim">text/event-stream</span>`, esc)}
          <div class="ev-grid">${API_EVENTS.map(([e, p, w]) => `<div class="ev">${tile(EVENT_ICON[e] || "activity", "sm")}<div><div class="ev-top"><code>${esc(e)}</code><span class="ev-when">${ic("clock")}${esc(w)}</span></div><p>${esc(p)}</p></div></div>`).join("")}</div>
        </section>

        ${API_DOCS.map(([title, rows]) => `<section class="d-sec" id="${slug(title)}">
          ${secHead(GROUP_ICON[title] || "code", title, `${rows.length} endpoints`, esc)}
          <div class="ep-list">${rows.map(row).join("")}</div>
        </section>`).join("")}

        <section class="d-sec" id="doc-errors">
          ${secHead("alert", "Errors and caching", "", esc)}
          <div class="d-cards">
            <div class="d-card">${tile("alert", "sm")}<div><b>Errors are JSON</b><p><code>{ "error": "a human sentence" }</code> with a 4xx or 5xx status.</p></div></div>
            <div class="d-card">${tile("clock", "sm")}<div><b>Cached 1 to 60 seconds</b><p>Polling faster than an endpoint's cache returns the same body.</p></div></div>
            <div class="d-card">${tile("pulse", "sm")}<div><b>Upstream limits are on Health</b><p>Rate-limited sources (public RPC, DexScreener) show on <a class="linkish" href="#/health">Health</a>, not as request errors.</p></div></div>
          </div>
        </section>
      </div>
    </div>`;

  // Run: call the endpoint and show its answer under the row; a second press closes it.
  wrap.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-run]");
    if (!b) return;
    const ep = b.closest(".ep");
    if (ep.nextElementSibling?.classList.contains("ep-res")) { ep.nextElementSibling.remove(); b.querySelector("span").textContent = "Run"; b.querySelector("svg").innerHTML = P.play; b.setAttribute("aria-expanded", "false"); ep.classList.remove("open"); return; }
    b.disabled = true; b.classList.add("busy");
    let text, ok = false, t0 = performance.now(), status = "";
    try {
      const r = await fetch(b.dataset.run, { signal: AbortSignal.timeout(20_000) });
      const body = await r.text();
      ok = r.ok;
      status = `<b class="${r.ok ? "up" : "down"}">${r.status}</b><span>${Math.round(performance.now() - t0)} ms</span><span>${(body.length / 1024).toFixed(1)} KB</span>`;
      try { text = JSON.stringify(JSON.parse(body), null, 2); } catch { text = body; }
    } catch (err) { text = err.message; status = `<b class="down">failed</b>`; }
    b.disabled = false; b.classList.remove("busy");
    b.querySelector("span").textContent = "Hide"; b.querySelector("svg").innerHTML = P.x; b.setAttribute("aria-expanded", "true"); ep.classList.add("open");
    const MAX = 6000, shown = text.slice(0, MAX);
    ep.insertAdjacentHTML("afterend", `<div class="ep-res">
      <div class="ep-res-bar">${ic(ok ? "check" : "alert", ok ? "up" : "down")}${status}${text.length > MAX ? `<span>first ${MAX.toLocaleString()} characters</span>` : ""}<button class="d-copy" data-copy="${esc(text)}" aria-label="Copy response">${ic("copy")}<span>Copy</span></button></div>
      <pre class="d-pre json">${highlightJson(shown, esc)}</pre></div>`);
  });
  wire(wrap);
  main.replaceChildren(wrap);
}

// ---------- MCP ----------
export async function viewMcp(main, { esc }) {
  const { MCP_TOOLS } = await import("/mcp-tools.js");
  const script = "<blix folder>/mcp/blix-mcp.mjs";
  const clients = codeBlock([
    { label: "Claude Code", icon: "terminal", code: `# run once in a terminal\nclaude mcp add blix -- node "${script}"` },
    { label: "Claude Desktop · Cursor", icon: "monitor", code: JSON.stringify({ mcpServers: { blix: { command: "node", args: [script] } } }, null, 2) },
    { label: "Codex", icon: "code", code: `# ~/.codex/config.toml\n[mcp_servers.blix]\ncommand = "node"\nargs = ["${script}"]` },
  ], esc, { tall: true });
  const toolName = (t) => t.name.replace(/^blix_/, "");
  const args = (t) => {
    const a = Object.entries(t.props || {});
    if (!a.length) return `<span class="arg none">no arguments</span>`;
    return a.map(([k, p]) => { const req = (t.required || []).includes(k); return `<span class="arg ${req ? "req" : ""}" title="${esc(p.description || (p.enum || []).join(" | ") || p.type || "")}">${esc(k)}${req ? "" : "?"}</span>`; }).join("");
  };
  const ASK = [
    ["What's moving on the Pulse right now, and which coins has the AI rated well?", ["blix_pulse"]],
    ["Why was this coin flagged? Show its holders and the dev's other launches.", ["blix_coin", "blix_holders"]],
    ["Paper buy 0.25 SOL of the best-rated coin, then show my desk.", ["blix_paper_buy", "blix_paper_desk"]],
    ["How has Blix's track record been this week?", ["blix_track_record"]],
  ];
  const wrap = document.createElement("div");
  wrap.className = "apidoc docs";
  wrap.innerHTML = `
    <div class="d-layout">
      ${nav([["doc-how", "How it works", "layers"], ["doc-connect", "Connect a client", "plug"], ["doc-ask", "Things to ask", "message"], ["doc-tools", "Tools", "wrench", MCP_TOOLS.length]], esc)}
      <div class="d-main">
        <header class="d-hero">
          <span class="d-hero-ic">${ic("plug")}</span>
          <div class="d-hero-text">
            <small class="d-eyebrow">Developers</small>
            <div class="page-head"><h1>MCP</h1></div>
            <p>Plug Claude, Cursor or Codex into Blix. The MCP server is one small script with no dependencies that turns the <a class="linkish" href="#/api">API</a> into tools an AI can call: ask what is running, why a coin was flagged, or paper trade a call.</p>
            <div class="d-facts">
              <span class="d-chip">${ic("wrench")}<span>${MCP_TOOLS.length} tools</span></span>
              <span class="d-chip">${ic("terminal")}<span>stdio</span></span>
              <span class="d-chip">${ic("shield")}<span>Reads only, plus the paper desk</span></span>
              <span class="d-chip">${ic("box")}<span>No dependencies</span></span>
            </div>
          </div>
        </header>

        <section class="d-sec" id="doc-how">
          ${secHead("layers", "How it works", "", esc)}
          <ol class="d-steps">
            <li>${tile("activity")}<div><b>Blix runs on this PC</b><p>The server on <code>${esc(location.origin)}</code>; the MCP script only talks to it.</p></div></li>
            <li>${tile("plug")}<div><b>Your AI client starts the script</b><p>Add it once (below). It speaks MCP over stdio, nothing to host.</p></div></li>
            <li>${tile("message")}<div><b>Ask in plain words</b><p>The client picks the tools. Nothing it can call spends real funds.</p></div></li>
          </ol>
        </section>

        <section class="d-sec" id="doc-connect">
          ${secHead("plug", "Connect a client", `replace <span class="d-ph">&lt;blix folder&gt;</span> with where Blix is installed`, esc)}
          ${clients}
          <p class="d-note">${ic("link")}<span>Another install or port: set <code>BLIX_URL</code> (for example <code>http://localhost:4420</code>) in the client's environment for this server.</span></p>
        </section>

        <section class="d-sec" id="doc-ask">
          ${secHead("message", "Things to ask", "the client chooses the tools; these are the ones it will reach for", esc)}
          <div class="ask-grid">${ASK.map(([q, tools]) => `<div class="ask">${ic("message")}<div><p>“${esc(q)}”</p><div class="ask-tools">${tools.map((x) => `<code>${esc(x)}</code>`).join("")}</div></div></div>`).join("")}</div>
        </section>

        <section class="d-sec" id="doc-tools">
          ${secHead("wrench", "Tools", `every tool also takes <code>limit</code> (rows per list, default 10, max 50)`, esc)}
          <div class="tool-grid">${MCP_TOOLS.map((t) => `<article class="tool ${t.write ? "write" : ""}">
              <div class="tool-top">${tile(TOOL_ICON[toolName(t)] || "wrench", "sm")}<code class="tool-name" data-copy="${esc(t.name)}" title="Copy the tool name">${esc(t.name)}</code>${t.write ? `<span class="tool-badge" title="Changes the paper desk (never real funds)">${ic("clipboard")}paper</span>` : ""}</div>
              <p>${esc(t.description)}</p>
              <div class="tool-args">${args(t)}</div>
            </article>`).join("")}</div>
        </section>
      </div>
    </div>`;
  wire(wrap);
  main.replaceChildren(wrap);
}
