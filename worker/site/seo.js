// robots.txt, sitemap.xml, llms.txt and the IndexNow key for the public pages.
import { ORIGIN, UPDATED } from "./html.js";
import { PAGES } from "./pages.js";

// IndexNow (Bing, Yandex, Seznam, Naver): the key is public by design; whoever can serve it at the
// site root may submit the site's URLs. Submit with worker/indexnow.mjs after a deploy.
export const INDEXNOW_KEY = "abd478b11910a71b7800f8f8ebf4c1c5";

// One canonical destination for each public page. Order is not a ranking signal.
export const PUBLIC_PATHS = Object.keys(PAGES);

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
  ...PUBLIC_PATHS.map((p) => `  <url><loc>${ORIGIN}${p}</loc><lastmod>${PAGES[p].updated || UPDATED}</lastmod></url>`),
  `  <url><loc>${ORIGIN}/</loc><lastmod>2026-10-10</lastmod></url>`,
].join("\n");
export const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_URLS}
</urlset>
`;

// https://llmstxt.org: a plain summary for AI assistants and answer engines.
export const LLMS = `# Blix

> BLIX is an AI-powered Solana memecoin terminal accessed through a site account. Features include discovery, token analysis, wallet tracking, available AI research, live trading and pump.fun token launches. Hosted trading and launches spend real SOL; paper trading is simulated. Developer documentation covers HTTP, Server-Sent Events and stdio MCP interfaces. Reference examples do not bypass sign-in or account permissions. Network fees and service costs may apply. BLIX is independent of GMGN, Axiom, Fomo and pump.fun. Public research guides are readable without signing in; terminal access requires an account.

Access: create an account at https://blixvip.com/start or log in at https://blixvip.com/login. Main site: https://blixvip.com/. Community: https://discord.gg/3VWHBP6paA.

## Docs

${PUBLIC_PATHS.map((p) => `- [${PAGES[p].h1}](${ORIGIN}${p}): ${PAGES[p].description}`).join("\n")}

## Access

- [Open BLIX](https://blixvip.com/): the main trading site
- [Create account](https://blixvip.com/start): account required to access the terminal
- [Join Discord](https://discord.gg/3VWHBP6paA): BLIX community
`;
