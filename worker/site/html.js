// The public docs pages on trade.blixvip.com (/api, /mcp and the comparison pages): the HTML shell,
// the stylesheet and small builders. Pages are plain server-rendered HTML so search engines and AI
// crawlers read all of it without running a script. The look is the app's (public/tokens.css, design.md):
// the colour tokens are copied into CSS below, so change them there when the app's identity changes.
// The docs live at the root of blixvip.com (index.js routes these exact paths here); trade.blixvip.com and
// blixvip.com/trade/<page> send them on with a 301 so all the ranking goes to one address.
import { PAGE_TOPIC, PAGE_ALIASES, canonicalLinks } from './clusters.js';
export const ORIGIN = "https://blixvip.com";
export const UPDATED = "2026-10-08"; // when the facts on these pages were last checked
export const UPDATED_TEXT = "October 8, 2026";

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
  ["/guides", "Guides"],
  ["/compare", "Compare"],
  ["/api", "API"],
  ["/mcp", "MCP"],
  ["/pump-fun-api", "pump.fun API"],
  ["/gmgn-api", "GMGN API"],
  ["/axiom-api", "Axiom API"],
  ["/fomo-api", "Fomo API"],
];

const ICON = `<img class="mark" src="/_pub/home/eye-logo.webp" width="44" height="44" alt=""><img class="word" src="/_pub/home/blix-logo.webp" width="86" height="58" alt="BLIX">`;
export const DISCORD = "https://discord.gg/3VWHBP6paA";
const JOIN = `<div class="join-actions"><a class="btn primary" href="/start">Create account <span aria-hidden="true">↗</span></a><a class="btn" href="${DISCORD}" target="_blank" rel="noopener noreferrer">Join Discord <span aria-hidden="true">↗</span></a></div>`;

const CSS = `
:root{color-scheme:dark;
--paper:#050608;--paper-2:#0c0e12;--paper-3:#0c0e12;--paper-4:#171a20;
--rule:#202329;--rule-2:#363b44;--ink:#f4f6fa;--ink-2:#c5c9d1;--muted:#aeb4bf;
--accent:#d9dce2;--focus:#f4f6fa;--up:#22d38a;--down:#ff5a6a;
--display:"Inter Tight",system-ui,sans-serif;--body:"Inter Tight",system-ui,sans-serif;
--mono:"JetBrains Mono",ui-monospace,Consolas,monospace}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-padding-top:72px}
body{margin:0;background:var(--paper);color:var(--ink);font:400 1rem/1.65 var(--body);overflow-x:hidden}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:3px}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:4px}
.top{position:sticky;top:0;z-index:5;background:rgba(5,6,8,.95);border-bottom:1px solid var(--rule)}
.top-in{max-width:1320px;margin:0 auto;padding:0 28px;height:90px;display:flex;align-items:center;gap:20px}
.brand{display:flex;align-items:center;gap:9px;color:var(--ink);font:600 1.125rem/1 var(--display);letter-spacing:-.02em;flex:none}
.brand:hover{text-decoration:none}
.nav{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0}
.nav::-webkit-scrollbar{display:none}
.nav a{color:var(--ink-2);font-size:.875rem;padding:6px 10px;border-radius:6px;white-space:nowrap}
.nav a:hover{color:var(--ink);background:var(--paper-4);text-decoration:none}
.nav a[aria-current]{color:var(--ink);background:var(--paper-4)}
.gh{display:flex;align-items:center;gap:7px;color:var(--ink);font-size:.875rem;font-weight:600;padding:7px 12px;border:1px solid var(--rule-2);border-radius:6px;background:var(--paper-4);flex:none}
.gh:hover{text-decoration:none;border-color:var(--muted)}
main{max-width:1280px;margin:0 auto;padding:32px 28px 88px}
.crumbs{font-size:.8125rem;color:var(--muted);margin:0 0 18px}.crumbs a{color:var(--muted)}.crumbs span{margin:0 6px}
.eyebrow{font-size:.75rem;font-weight:600;letter-spacing:.045em;text-transform:uppercase;color:var(--accent);margin:0 0 10px}
h1{font:600 clamp(2.5rem,4.4vw,4.5rem)/1.03 var(--display);letter-spacing:-.02em;margin:0 0 16px;text-wrap:balance}
h2{font:600 1.5rem/1.25 var(--display);letter-spacing:-.02em;margin:52px 0 12px;padding-top:22px;border-top:1px solid var(--rule)}
h3{font:600 1.0625rem/1.35 var(--body);margin:26px 0 6px}
p{margin:0 0 14px;color:var(--ink-2)}p b,li b,td b{color:var(--ink);font-weight:600}
.lede{font-size:1.125rem;line-height:1.6;color:var(--ink-2);margin-bottom:22px;max-width:68ch}
ul,ol{color:var(--ink-2);padding-left:1.25rem;margin:0 0 14px}li{margin:4px 0}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}
.btn{display:inline-flex;align-items:center;gap:8px;font:600 .9375rem/1 var(--body);padding:15px 24px;border-radius:999px;border:1px solid var(--rule-2);background:transparent;color:var(--ink);white-space:nowrap}
.btn:hover{text-decoration:none;border-color:var(--muted)}
.btn.primary{background:var(--ink);border-color:var(--ink);color:var(--paper)}.btn.primary:hover{background:#fff}.btn.small{padding:8px 12px;font-size:.8rem}.btn:disabled{opacity:.5;cursor:default}input.field{padding:10px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--paper-3);color:var(--ink);min-width:260px;font:inherit}
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
.brand{gap:10px}.brand img{object-fit:contain;flex:none}.brand .mark{border-radius:11px}.brand .word{width:86px;height:58px}
.top-actions{display:flex;align-items:center;gap:22px;flex:none}.site-open{font-size:.9rem;color:var(--ink-2);font-weight:600;white-space:nowrap}.top-actions>.btn{font-size:.9rem}
.hero-grid{position:relative;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);align-items:center;gap:40px;isolation:isolate;padding:48px 0 62px}
.hero-grid::before{content:"";position:absolute;z-index:-1;inset:-24px 0;background:radial-gradient(ellipse at 82% 45%,rgba(174,180,191,.13),transparent 55%);pointer-events:none}
.hero-copy{min-width:0}.hero-copy h1{background:linear-gradient(155deg,#fff 20%,#aeb4bf 88%);color:transparent;background-clip:text;-webkit-background-clip:text;max-width:15ch}
.hero-copy .eyebrow{display:inline-flex;align-items:center;gap:9px;color:var(--ink-2);border:1px solid var(--rule-2);border-radius:999px;padding:7px 13px;letter-spacing:0;text-transform:none;margin-bottom:24px;font-size:.8rem}
.hero-copy .eyebrow::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--up);flex:none}
.hero-copy .lede{font-size:1.1rem;max-width:54ch;margin:20px 0 24px}.join-actions{display:flex;flex-wrap:wrap;gap:12px}.join-actions .btn{gap:18px;min-height:48px}.btn.primary{box-shadow:0 10px 30px rgba(220,226,240,.13)}
.account-note{font-size:.84rem;color:var(--muted);margin:16px 0 0}.hero-preview{display:block;color:var(--muted);text-align:center;border-radius:24px;background:repeating-linear-gradient(90deg,transparent 0 109px,#14171c 110px 111px),repeating-linear-gradient(0deg,#080a0d 0 109px,#14171c 110px 111px);padding:22px 0 20px;box-shadow:inset 0 0 65px 28px #050608}
.hero-preview img{display:block;width:100%;height:auto;filter:drop-shadow(0 16px 28px #000)}.hero-preview span{font-size:.8rem}.hero-preview:hover{text-decoration:none;color:var(--ink)}
.article-content{max-width:860px;margin:0 auto}.article-content>.meta{padding:22px 0 4px;border-top:1px solid var(--rule)}.article-content>h2:first-of-type{margin-top:28px}
.contents{margin:22px 0 32px;padding:20px 24px;border:1px solid var(--rule);border-radius:16px;background:var(--paper-2)}.contents summary{cursor:pointer;font-weight:600}.contents ol{margin:12px 0 0;padding-left:0;list-style:none;columns:2;column-gap:32px}.contents li{break-inside:avoid;font-size:.9rem}.contents a{display:inline-block;padding:3px 0}@media(max-width:640px){.contents ol{columns:1}}
.closing-cta{max-width:860px;margin:76px auto 0;padding:42px;border:1px solid var(--rule-2);border-radius:24px;background:radial-gradient(ellipse at top right,rgba(174,180,191,.12),transparent 65%),#0c0e12}.closing-cta h2{border:0;padding:0;margin:0 0 12px;font:600 clamp(2rem,4vw,3rem)/1.06 var(--display);letter-spacing:-.035em}.closing-cta p{margin-bottom:24px}
.foot{max-width:1280px;padding:34px 28px}.foot-brand{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:30px}.foot nav{gap:14px 22px}.foot p{max-width:860px}
@media(max-width:900px){.nav{display:none}.top-in{justify-content:space-between}.hero-grid{gap:20px;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}.hero-copy h1{font-size:48px}}
@media(max-width:640px){.top-in{padding:0 20px;height:78px;gap:12px}.brand{gap:6px}.brand .mark{width:34px;height:34px}.brand .word{width:64px;height:44px}.top-actions{gap:12px}.top-actions>.site-open{display:none}.top-actions>.btn{padding:12px 16px;font-size:.83rem}main{padding:22px 20px 60px}.hero-grid{grid-template-columns:minmax(0,1fr);gap:24px;padding:22px 0 36px}.hero-copy h1{font-size:44px;max-width:15ch}.hero-copy .lede{font-size:1.05rem}.hero-preview{max-width:480px;width:100%;margin:0 auto}.hero-preview img{max-height:270px;object-fit:contain}.join-actions{gap:10px}.join-actions .btn{padding:14px 18px;font-size:.9rem}.closing-cta{padding:28px 22px;margin-top:48px}.foot{padding:28px 20px}.foot-brand{align-items:flex-start;flex-direction:column}.facts{grid-template-columns:minmax(0,1fr)}.related{grid-template-columns:minmax(0,1fr)}}

`;

// Copy buttons for code blocks. Progressive: without the script the blocks are plain and selectable.
export const SCRIPT = `document.querySelectorAll(".code").forEach(function(b){var t=document.createElement("button");t.className="copy";t.type="button";t.textContent="Copy";t.onclick=function(){navigator.clipboard.writeText(b.querySelector("code").innerText).then(function(){t.textContent="Copied";setTimeout(function(){t.textContent="Copy"},1400)})};b.appendChild(t)})`;

// p: { path, title, description, h1, eyebrow, lede, body, faq?, related?, crumb, og, schema? }
export function layout(p) {
  const url = ORIGIN + p.path;
  const updated = p.updated || UPDATED;
  const topic = PAGE_TOPIC.get(p.path);
  const sections = [...p.body.matchAll(/<h2\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g)];
  const contents = sections.length >= 4 ? `<details class="contents" open><summary>On this page</summary><ol>${sections.map(([, id, heading]) => `<li><a href="#${esc(id)}">${esc(plain(heading))}</a></li>`).join("")}</ol></details>` : "";
  const graph = [
    { "@type": "Organization", "@id": `${ORIGIN}/#org`, name: "Blix", url: `${ORIGIN}/`, logo: `${ORIGIN}/_pub/icon-512.png`, sameAs: ["https://blixvip.com"] },
    { "@type": "WebSite", "@id": `${ORIGIN}/#site`, url: `${ORIGIN}/`, name: "BLIX", alternateName: ["Blix", "Blix VIP", "blixvip"], publisher: { "@id": `${ORIGIN}/#org` } },
    { "@type": "TechArticle", "@id": `${url}#article`, headline: p.h1, description: p.description, url, mainEntityOfPage: url, image: `${ORIGIN}/_pub/${p.og}`,
      dateModified: updated, inLanguage: "en", author: { "@id": `${ORIGIN}/#org` }, publisher: { "@id": `${ORIGIN}/#org` }, isPartOf: { "@id": `${ORIGIN}/#site` },
      about: { "@id": `${ORIGIN}/#software` } },
    { "@type": "SoftwareApplication", "@id": `${ORIGIN}/#software`, name: "Blix Trade", alternateName: ["Blix", "Blix API", "Blix MCP"],
      description: "BLIX is an AI-powered Solana memecoin terminal for discovery, research, wallet tracking and trading. Create an account to access the site.",
      applicationCategory: "FinanceApplication", applicationSubCategory: "Crypto trading terminal and API", operatingSystem: "Web",
      url: `${ORIGIN}/`,
      publisher: { "@id": `${ORIGIN}/#org` } },
    { "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "BLIX", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: p.crumb, item: url } ] },
  ];
  if (p.faq?.length) graph.push({ "@type": "FAQPage", "@id": `${url}#faq`, mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plain(a) } })) });
  const ld = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === p.path ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const related = [...new Set((p.related || []).map(href => PAGE_ALIASES[href] || href))].map((href) => PAGE_CARDS[href]).filter(Boolean)
    .map(([title, blurb, href]) => `<a href="${esc(href)}"><b>${esc(title)}</b><span>${esc(blurb)}</span></a>`).join("");
  return canonicalLinks(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1">
<meta name="theme-color" content="#050608">
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
<meta property="article:modified_time" content="${updated}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.ogTitle || p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${ORIGIN}/_pub/${p.og}">
<link rel="icon" href="/_pub/icon.svg?v=eye2" type="image/svg+xml">
<link rel="icon" href="/_pub/icon-96.png?v=eye2" sizes="96x96" type="image/png">
<link rel="apple-touch-icon" href="/_pub/icon-180.png?v=eye2">
<link rel="alternate" type="text/plain" title="LLM summary" href="/llms.txt">
<link rel="preload" href="/_pub/fonts/inter-tight.woff2" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'Inter Tight';font-style:normal;font-weight:400 700;font-display:swap;src:url(/_pub/fonts/inter-tight.woff2) format('woff2')}@font-face{font-family:'JetBrains Mono';font-style:normal;font-weight:400 500;font-display:swap;src:url(/_pub/fonts/jetbrains-mono.woff2) format('woff2')}</style>
<style>${CSS.replace(/\n/g, "")}</style>
<script type="application/ld+json">${ld}</script>
</head>
<body>
<header class="top"><div class="top-in">
<a class="brand" href="/" aria-label="BLIX home">${ICON}</a>
<nav class="nav" aria-label="Docs">${nav}</nav>
<div class="top-actions"><a class="site-open" href="/">Open BLIX ↗</a><a class="btn primary" href="/start">Create account ↗</a></div>
</div></header>
<main>
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">BLIX</a>${p.path === "/api" ? "<span>/</span>API" : `<span>/</span>${esc(p.crumb)}`}</nav>
<article>
<section class="hero-grid" aria-label="${esc(p.crumb)}">
<div class="hero-copy"><p class="eyebrow">AI-powered memecoin terminal</p>
<h1>${p.h1}</h1><p class="lede">${p.lede}</p>
${JOIN}<p class="account-note">Create a BLIX account to access the terminal, tools and research. Already a member? <a href="/login">Log in</a>.</p></div>
<a class="hero-preview" href="/" aria-label="Explore the main BLIX site"><img src="/_pub/home/laptop-800.webp" width="800" height="600" alt="The BLIX memecoin trading terminal" fetchpriority="high"><span>Explore the BLIX terminal ↗</span></a>
</section>
<div class="article-content"><p class="meta">By <a href="/about">BLIX</a> · Updated <time datetime="${updated}">${updated}</time>${topic ? ` · <a href="/guides#${topic.id}">${esc(topic.title)}</a>` : ''}</p>
${contents}
${p.body}
${p.faq?.length ? `<h2 id="faq">Frequently asked questions</h2>${faq(p.faq)}` : ""}
${related ? `<h2 id="related">Related</h2><div class="related">${related}</div>` : ""}
</div>
<section class="closing-cta"><h2>Your next move starts here.</h2><p>Create your BLIX account to access the trading terminal. Join the Discord community to stay connected.</p>${JOIN}</section>
</article>
</main>
<footer><div class="foot">
<div class="foot-brand"><a class="brand" href="/" aria-label="BLIX home">${ICON}</a><a class="site-open" href="/">Open the main BLIX site ↗</a></div>
<nav aria-label="Footer"><a href="/start">Create account</a><a href="/login">Log in</a><a href="/about">About BLIX</a><a href="${DISCORD}" target="_blank" rel="noopener noreferrer">Join Discord</a>${NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join("")}</nav>
<p>BLIX is independent of the third-party companies discussed in these guides. Network and service fees may apply when trading.</p>
<p>Not financial advice. Memecoins are extremely risky. Hosted trading and token launches spend real SOL. Paper trading is simulated; the published MCP tools expose data and paper trades, not live execution.</p>
</div></footer>
<script>${SCRIPT}</script>
</body>
</html>`);
}

// Filled from the page registry before any page is rendered.
export const PAGE_CARDS = Object.create(null);
