// The public docs pages on trade.blixvip.com (/api, /mcp and the comparison pages): the HTML shell,
// the stylesheet and small builders. Pages are plain server-rendered HTML so search engines and AI
// crawlers read all of it without running a script. The look is the app's (public/tokens.css, design.md):
// the colour tokens are copied into CSS below, so change them there when the app's identity changes.
export const ORIGIN = "https://trade.blixvip.com";
export const REPO = "https://github.com/blixvip/blixtrade";
export const UPDATED = "2026-10-04"; // when the facts on these pages were last checked
export const UPDATED_TEXT = "October 4, 2026";

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// A code block with a copy button (the button only appears once the script has run).
export const code = (text, lang = "") => `<div class="code"${lang ? ` data-lang="${lang}"` : ""}><pre><code>${esc(text.trim())}</code></pre></div>`;
export const table = (head, rows, cls = "") => `<div class="table-wrap"><table${cls ? ` class="${cls}"` : ""}><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
export const facts = (pairs) => `<dl class="facts">${pairs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
export const ext = (href, text) => `<a href="${href}" rel="noopener" target="_blank">${text}</a>`;

// FAQ items are [question, answer html]; the same list feeds the FAQPage structured data.
export const faq = (items) => `<div class="faq">${items.map(([q, a]) => `<section><h3>${esc(q)}</h3><p>${a}</p></section>`).join("")}</div>`;
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

export const NAV = [
  ["/api", "API"],
  ["/mcp", "MCP"],
  ["/pump-fun-api", "pump.fun API"],
  ["/gmgn-api", "GMGN API"],
  ["/axiom-api", "Axiom API"],
  ["/fomo-api", "Fomo API"],
];

const ICON = `<svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#06140d"/><g fill="none" stroke="#39ff88" stroke-opacity=".35" stroke-width="2"><circle cx="32" cy="32" r="21"/><circle cx="32" cy="32" r="13"/><circle cx="32" cy="32" r="5"/></g><path d="M32 32 52 21a21 21 0 0 1 1 11z" fill="#39ff88" fill-opacity=".55"/><circle cx="44" cy="24" r="3.5" fill="#39ff88"/><circle cx="22" cy="40" r="2.5" fill="#ffd166"/></svg>`;
const GH = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;

const CSS = `
:root{color-scheme:dark;
--paper:oklch(15.5% .008 258);--paper-2:oklch(17.5% .009 258);--paper-3:oklch(19.5% .010 258);--paper-4:oklch(22.5% .012 258);
--rule:oklch(25% .012 258);--rule-2:oklch(33% .014 258);--ink:oklch(93% .006 258);--ink-2:oklch(76% .012 258);--muted:oklch(67% .014 258);
--accent:oklch(70% .15 255);--focus:oklch(74% .15 255);--up:oklch(74% .15 160);--down:oklch(67% .20 18);
--display:"Space Grotesk",system-ui,"Segoe UI Variable Display","Segoe UI",sans-serif;
--body:system-ui,"Segoe UI Variable Text","Segoe UI",-apple-system,Roboto,sans-serif;
--mono:"JetBrains Mono",ui-monospace,Consolas,monospace}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:72px}
body{margin:0;background:var(--paper);color:var(--ink);font:400 1rem/1.65 var(--body);overflow-x:hidden}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:3px}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
.top{position:sticky;top:0;z-index:5;background:var(--paper-2);border-bottom:1px solid var(--rule)}
.top-in{max-width:1080px;margin:0 auto;padding:0 16px;height:56px;display:flex;align-items:center;gap:20px}
.brand{display:flex;align-items:center;gap:9px;color:var(--ink);font:600 1.125rem/1 var(--display);letter-spacing:-.02em;flex:none}
.brand:hover{text-decoration:none}
.nav{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0}
.nav::-webkit-scrollbar{display:none}
.nav a{color:var(--ink-2);font-size:.875rem;padding:6px 10px;border-radius:6px;white-space:nowrap}
.nav a:hover{color:var(--ink);background:var(--paper-4);text-decoration:none}
.nav a[aria-current]{color:var(--ink);background:var(--paper-4)}
.gh{display:flex;align-items:center;gap:7px;color:var(--ink);font-size:.875rem;font-weight:600;padding:7px 12px;border:1px solid var(--rule-2);border-radius:6px;background:var(--paper-4);flex:none}
.gh:hover{text-decoration:none;border-color:var(--muted)}
main{max-width:860px;margin:0 auto;padding:28px 16px 64px}
.crumbs{font-size:.8125rem;color:var(--muted);margin:0 0 18px}.crumbs a{color:var(--muted)}.crumbs span{margin:0 6px}
.eyebrow{font-size:.75rem;font-weight:600;letter-spacing:.045em;text-transform:uppercase;color:var(--accent);margin:0 0 10px}
h1{font:600 clamp(2rem,5.2vw,2.75rem)/1.1 var(--display);letter-spacing:-.02em;margin:0 0 16px;text-wrap:balance}
h2{font:600 1.5rem/1.25 var(--display);letter-spacing:-.02em;margin:52px 0 12px;padding-top:22px;border-top:1px solid var(--rule)}
h3{font:600 1.0625rem/1.35 var(--body);margin:26px 0 6px}
p{margin:0 0 14px;color:var(--ink-2)}p b,li b,td b{color:var(--ink);font-weight:600}
.lede{font-size:1.125rem;line-height:1.6;color:var(--ink-2);margin-bottom:22px;max-width:68ch}
ul,ol{color:var(--ink-2);padding-left:1.25rem;margin:0 0 14px}li{margin:4px 0}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}
.btn{display:inline-flex;align-items:center;gap:8px;font:600 .9375rem/1 var(--body);padding:12px 16px;border-radius:6px;border:1px solid var(--rule-2);background:var(--paper-4);color:var(--ink);white-space:nowrap}
.btn:hover{text-decoration:none;border-color:var(--muted)}
.btn.primary{background:var(--ink);border-color:var(--ink);color:var(--paper)}.btn.primary:hover{background:#fff}
.meta{font-size:.8125rem;color:var(--muted);margin:0 0 8px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);border-radius:8px;overflow:hidden;margin:26px 0 8px}
.facts div{background:var(--paper-3);padding:14px 16px}
.facts dt{font-size:.75rem;font-weight:600;letter-spacing:.045em;text-transform:uppercase;color:var(--muted);margin:0 0 4px}
.facts dd{margin:0;color:var(--ink);font-size:.9375rem;line-height:1.45}
code{font:500 .875em/1.5 var(--mono);color:var(--ink);background:var(--paper-4);border-radius:4px;padding:.1em .35em;overflow-wrap:anywhere}
.code{position:relative;margin:0 0 16px}
.code pre{margin:0;background:var(--paper-3);border:1px solid var(--rule);border-radius:8px;padding:14px 16px;overflow-x:auto;font:400 .8125rem/1.6 var(--mono);color:var(--ink)}
.code pre code{background:none;padding:0;font:inherit;overflow-wrap:normal}
.code[data-lang]::before{content:attr(data-lang);position:absolute;top:8px;right:62px;font:600 .6875rem/1 var(--body);letter-spacing:.045em;text-transform:uppercase;color:var(--muted)}
.copy{position:absolute;top:6px;right:6px;font:600 .75rem/1 var(--body);color:var(--ink-2);background:var(--paper-4);border:1px solid var(--rule-2);border-radius:6px;padding:6px 9px;cursor:pointer}
.copy:hover{color:var(--ink)}
.table-wrap{overflow-x:auto;border:1px solid var(--rule);border-radius:8px;margin:0 0 18px;background:var(--paper-3)}
table{width:100%;border-collapse:collapse;font-size:.875rem}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--rule)}
tbody tr:last-child td{border-bottom:0}
th{font-size:.75rem;font-weight:600;letter-spacing:.045em;text-transform:uppercase;color:var(--muted);background:var(--paper-2);white-space:nowrap}
td{color:var(--ink-2)}td:first-child{color:var(--ink)}
.ref td:first-child{font:600 .75rem/1.6 var(--mono);color:var(--muted);white-space:nowrap}
.ref td:nth-child(2){min-width:220px}.ref td:nth-child(2) code{background:none;padding:0;color:var(--ink)}
.cmp td:first-child{font-weight:600;white-space:nowrap}
.yes{color:var(--up)}.no{color:var(--down)}
.faq section{border-bottom:1px solid var(--rule);padding:4px 0 10px}.faq section:last-child{border-bottom:0}
.related{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:8px 0 0}
.related a{display:block;background:var(--paper-3);border:1px solid var(--rule);border-radius:8px;padding:14px 16px;color:var(--ink)}
.related a:hover{border-color:var(--rule-2);text-decoration:none}
.related b{display:block;font:600 1rem/1.3 var(--display);letter-spacing:-.01em;margin-bottom:4px}
.related span{font-size:.8125rem;color:var(--muted);line-height:1.45;display:block}
.note{font-size:.875rem;color:var(--muted)}
.callout{background:var(--paper-3);border:1px solid var(--rule-2);border-radius:8px;padding:14px 16px;margin:0 0 18px}
.callout p:last-child{margin:0}
footer{border-top:1px solid var(--rule);background:var(--paper-2)}
.foot{max-width:860px;margin:0 auto;padding:28px 16px 40px;font-size:.8125rem;color:var(--muted)}
.foot p{color:var(--muted);font-size:.8125rem}
.foot nav{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0 0 14px}.foot nav a{color:var(--ink-2)}
@media (max-width:720px){.gh span{display:none}.top-in{gap:12px}h2{margin-top:40px}.lede{font-size:1.0625rem}}
@media (prefers-reduced-motion:no-preference){.btn,.gh,.nav a,.related a{transition:border-color .16s,background .16s,color .16s}}
`;

// Copy buttons for code blocks. Progressive: without the script the blocks are plain and selectable.
export const SCRIPT = `document.querySelectorAll(".code").forEach(function(b){var t=document.createElement("button");t.className="copy";t.type="button";t.textContent="Copy";t.onclick=function(){navigator.clipboard.writeText(b.querySelector("code").innerText).then(function(){t.textContent="Copied";setTimeout(function(){t.textContent="Copy"},1400)})};b.appendChild(t)})`;

// p: { path, title, description, h1, eyebrow, lede, body, faq?, related?, crumb, og, schema? }
export function layout(p) {
  const url = ORIGIN + p.path;
  const graph = [
    { "@type": "Organization", "@id": `${ORIGIN}/#org`, name: "Blix", url: `${ORIGIN}/api`, logo: `${ORIGIN}/_pub/icon-512.png`, sameAs: [REPO, "https://github.com/blixvip", "https://blixvip.com"] },
    { "@type": "WebSite", "@id": `${ORIGIN}/#site`, url: `${ORIGIN}/api`, name: "Blix", publisher: { "@id": `${ORIGIN}/#org` } },
    { "@type": "TechArticle", "@id": `${url}#article`, headline: p.h1, description: p.description, url, mainEntityOfPage: url, image: `${ORIGIN}/_pub/${p.og}`,
      datePublished: UPDATED, dateModified: UPDATED, inLanguage: "en", author: { "@id": `${ORIGIN}/#org` }, publisher: { "@id": `${ORIGIN}/#org` }, isPartOf: { "@id": `${ORIGIN}/#site` },
      about: { "@id": `${ORIGIN}/#software` } },
    { "@type": "SoftwareApplication", "@id": `${ORIGIN}/#software`, name: "Blix Trade", alternateName: ["Blix", "Blix API", "Blix MCP"],
      description: "Free, open-source Solana memecoin terminal with a local HTTP + SSE API and an MCP server: pump.fun launches, live trades, holders, snipers, bundles, candles, Jupiter quotes and AI reads.",
      applicationCategory: "FinanceApplication", applicationSubCategory: "Crypto trading terminal and API", operatingSystem: "Windows, macOS, Linux (Node.js 24.16+)",
      url: `${ORIGIN}/api`, downloadUrl: REPO, codeRepository: REPO, license: "https://opensource.org/licenses/MIT", isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, publisher: { "@id": `${ORIGIN}/#org` } },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Blix", item: `${ORIGIN}/api` },
      ...(p.path === "/api" ? [] : [{ "@type": "ListItem", position: 2, name: p.crumb, item: url }]) ] },
  ];
  if (p.faq?.length) graph.push({ "@type": "FAQPage", "@id": `${url}#faq`, mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(a) } })) });
  const ld = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === p.path ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const related = (p.related || []).map((href) => PAGE_CARDS[href]).filter(Boolean)
    .map(([title, blurb, href]) => `<a href="${href}"><b>${title}</b><span>${blurb}</span></a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
<meta name="theme-color" content="#121419">
<meta name="author" content="Blix">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Blix">
<meta property="og:title" content="${esc(p.ogTitle || p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/_pub/${p.og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(p.h1)}">
<meta property="article:modified_time" content="${UPDATED}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.ogTitle || p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${ORIGIN}/_pub/${p.og}">
<link rel="icon" href="/_pub/icon.svg" type="image/svg+xml">
<link rel="icon" href="/_pub/icon-96.png" sizes="96x96" type="image/png">
<link rel="apple-touch-icon" href="/_pub/icon-180.png">
<link rel="alternate" type="text/plain" title="LLM summary" href="/llms.txt">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${CSS.replace(/\n/g, "")}</style>
<script type="application/ld+json">${ld}</script>
</head>
<body>
<header class="top"><div class="top-in">
<a class="brand" href="/api" aria-label="Blix home">${ICON}<span>Blix</span></a>
<nav class="nav" aria-label="Docs">${nav}</nav>
<a class="gh" href="${REPO}" rel="noopener">${GH}<span>GitHub</span></a>
</div></header>
<main>
<nav class="crumbs" aria-label="Breadcrumb"><a href="/api">Blix</a>${p.path === "/api" ? "<span>/</span>API" : `<span>/</span>${esc(p.crumb)}`}</nav>
<article>
<p class="eyebrow">${p.eyebrow}</p>
<h1>${p.h1}</h1>
<p class="lede">${p.lede}</p>
${p.body}
${p.faq?.length ? `<h2 id="faq">Frequently asked questions</h2>${faq(p.faq)}` : ""}
${related ? `<h2 id="related">Related</h2><div class="related">${related}</div>` : ""}
</article>
</main>
<footer><div class="foot">
<nav aria-label="Footer">${NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join("")}<a href="${REPO}" rel="noopener">GitHub</a><a href="https://blixvip.com" rel="noopener">blixvip.com</a></nav>
<p>Blix is free, open-source software (MIT) by blixvip. It is independent and is not affiliated with or endorsed by GMGN, Axiom Trade, Fomo (Fomo Labs), pump.fun, PumpPortal or any other company named here; their names are used only to describe what Blix replaces or works alongside. Facts about third-party APIs were checked against their public pages on ${UPDATED_TEXT} and can change: <a href="${REPO}/issues">open an issue</a> if something is out of date.</p>
<p>Not financial advice. Memecoins are extremely risky. Blix shows data and an AI's opinion of it; it never signs a transaction.</p>
</div></footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}

// Cards for the "Related" grid: [title, blurb, href].
export const PAGE_CARDS = {
  "/api": ["Blix API", "52 endpoints and a live stream: launches, trades, holders, candles, quotes, AI reads.", "/api"],
  "/mcp": ["Blix MCP server", "20 tools that give Claude, Cursor or Codex live Solana memecoin data.", "/mcp"],
  "/pump-fun-api": ["Free pump.fun API", "Launches, trades, bonding progress, migrations, snipers and bundles. No key.", "/pump-fun-api"],
  "/gmgn-api": ["GMGN API", "How GMGN's key works, what it covers, and a free alternative.", "/gmgn-api"],
  "/axiom-api": ["Axiom Trade API", "Axiom has no public API. Axiom-style Pulse data without one.", "/axiom-api"],
  "/fomo-api": ["Fomo API", "fomo.family has no public API. Track Fomo traders from the chain instead.", "/fomo-api"],
};
