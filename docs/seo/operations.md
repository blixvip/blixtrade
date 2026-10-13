# SEO operations

Target: global English organic discovery. Rankings are outcomes, not deployment acceptance criteria.

## Run locally

1. `node scripts/seo-ledger.mjs` regenerates keyword assignments and asserts source coverage.
2. `node --test test/seo.test.mjs test/worker-landing.test.mjs test/worker-security.test.mjs test/worker-security-route.test.mjs` checks actual Worker responses and protections.
3. `node scripts/seo-browser-check.mjs` renders every page at 390 and 1440 pixels through the actual Worker with local assets and no production writes. Inspect screenshots in ignored `data/seo-review/`.
4. `node scripts/seo-report.mjs` creates a per-keyword unknown-data baseline for all 850 terms. Supply a Search Console Search Analytics JSON export with dimensions `[query,page,country,device]` as the argument when available. `node scripts/seo-search-console.mjs` can retrieve a finalized-data export with explicitly supplied read-only OAuth access; see `measurement.md`. Never commit visitor data or credentials.
5. After release, `node scripts/seo-live-check.mjs` verifies deployed content, sitemap, robots, redirects, 404 behavior and the signed-out app gate with read-only requests.

## Measurement access

Use an authorized Search Console account for the blixvip.com domain property. Submit `https://blixvip.com/sitemap.xml`, inspect representative URLs, and review page indexing and Core Web Vitals. No Search Console connector or verified access was available during implementation; a successful HTTP response is not proof of Google indexing.

The existing Worker records public page views and signup events. `conversions.sql` joins them read-only and returns aggregates, using the last observed search landing in seven days. Run against the existing D1 binding DB; no migration or new tracking cookie. IP/browser-derived visitor IDs, rate limiting, stripped referrers and cross-device journeys make attribution approximate.

## Release and monitor

The public site is the `blix-trade` Worker in `worker/wrangler.jsonc`, not the older blixvip-home project. Preserve terminal/server changes owned by other sessions. Dry-run the Worker bundle, then deploy this Worker only; do not run the VM/server deployment script for SEO changes. Record Cloudflare's version ID and verify all public URLs, aliases, sitemap, robots, unknown URLs and private routes after deployment. If regressions occur, use the recorded prior Worker version for rollback; do not restart applications or Warp.

`node worker/indexnow.mjs` submits the public URL set to IndexNow after release. It does not submit URLs to Google and does not guarantee indexing.

Weekly: inspect query/page/country/device performance, failed indexing and attributed signups. Monthly: update claims and examples, merge overlapping pages, improve weak answers. Reassess priorities at 30/60/90 days; compare equal-length periods, record actual results and keep unsupported features on the roadmap.

## Credibility work prepared for outreach

- Publish reproducible developer examples on the BLIX website with clear account and interface boundaries. Public acquisition links must point to the site and the requested Discord invite; no repository promotion.
- Prepare a measured AI-pick outcome study, including losses, missing observations, fees and liquidity assumptions, before claiming performance.
- Submit verified MCP/package listings only when the package and installation instructions pass a clean-install check.
- Propose demonstrations to relevant developer communities and product reviewers; send no outreach messages without explicit authorization. No paid ranking links, invented reviews or undisclosed endorsements.
