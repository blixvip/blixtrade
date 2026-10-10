// robots.txt, sitemap.xml, llms.txt and the IndexNow key for the public pages.
import { ORIGIN, REPO, UPDATED } from "./html.js";
import { PAGES } from "./pages.js";

// IndexNow (Bing, Yandex, Seznam, Naver): the key is public by design; whoever can serve it at the
// site root may submit the site's URLs. Submit with worker/indexnow.mjs after a deploy.
export const INDEXNOW_KEY = "abd478b11910a71b7800f8f8ebf4c1c5";

// Order = priority in the sitemap and llms.txt.
export const PUBLIC_PATHS = ["/api", "/mcp", "/pump-fun-api", "/gmgn-api", "/axiom-api", "/fomo-api", "/pump-fun-tracker", "/solana-memecoin-screener", "/memecoin-paper-trading"];

// The live terminal and its JSON API sit behind Blix's own key gate (401, noindex); only the docs are
// meant for search engines.
// For trade.blixvip.com, which now only sends everything public on to blixvip.com (301s, see index.js).
export const ROBOTS = `# BLIX: the landing at /, the terminal at /app (sign-in), public docs at /api, /mcp and the pages in the sitemap.
User-agent: *
Disallow: /api/
Disallow: /img/
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`;

// Blix's entries in blixvip.com's sitemap: index.js adds them to the main site's own sitemap.xml.
export const SITEMAP_URLS = [
  ...PUBLIC_PATHS.map((p, i) => `  <url><loc>${ORIGIN}${p}</loc><lastmod>${UPDATED}</lastmod><changefreq>weekly</changefreq><priority>${i < 2 ? "0.9" : "0.8"}</priority></url>`),
  `  <url><loc>${ORIGIN}/</loc><lastmod>${UPDATED}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`,
].join("\n");
export const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_URLS}
</urlset>
`;

// https://llmstxt.org: a plain summary for AI assistants and answer engines.
export const LLMS = `# Blix

> Blix (Blix Trade) is a free, open-source (MIT) Solana memecoin terminal that runs on your own machine. It serves a local HTTP + Server-Sent Events API (no API key, no credits) and an MCP server for AI clients: every pump.fun launch about a second after the chain, trades decoded from Solana program logs, bonding progress, migrations, holder ledgers with dev / sniper / bundle tags, candles from real trades, Jupiter quotes, RugCheck safety, AI reads, signals, narratives, wallet tracking and a paper-trading desk. It never signs transactions. Not affiliated with GMGN, Axiom Trade, Fomo or pump.fun.

Install: \`git clone ${REPO}.git && cd blixtrade && npm start\` (Node 24.16+, zero dependencies), then call http://localhost:4420/api/... MCP: \`claude mcp add blix -- node /path/to/blixtrade/mcp/blix-mcp.mjs\`.

## Docs

${PUBLIC_PATHS.map((p) => `- [${PAGES[p].h1}](${ORIGIN}${p}): ${PAGES[p].description}`).join("\n")}

## Source

- [GitHub repository](${REPO}): README, quick start, screenshots
- [API reference (Markdown)](${REPO}/blob/main/docs/API.md)
- [How it works](${REPO}/blob/main/docs/HOW-IT-WORKS.md)
`;
