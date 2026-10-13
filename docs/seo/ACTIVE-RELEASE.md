# Active cluster release — October 10, 2026

Worker: blix-trade. Version: **9b134d2b-1f25-42bf-9dc6-180652765c0e**.
Snapshot: data/seo-release-2026-10-11T03-03-21-947Z/ (release-manifest.json).

## Current architecture

The other session published a 119-URL expansion while this task was testing. This release preserves that expanded product/docs set and consolidates 13 overlapping pages, resulting in **106 canonical URLs including the homepage**. There are **18 direct 301 aliases**: the 13 former pages and five requested URL variants. These aliases are excluded from the sitemap; internal links are normalized to the destination. No duplicate pages were added for spelling variants.

The public guides now form eight topic clusters: discovery, AI research, wallets/PnL, token risk, trading/practice/alerts, creation, developers, and comparisons. Every resource has one primary topic and a backlink to that topic. The general tools index, guides index and about page are excluded from topic ownership checks.

All 850 unique keywords are mapped in keyword-clusters.csv. Current and planned destinations, dependencies and publication gates remain separate. The AI-maker guide now owns that keyword cluster, but a published guide does not prove a working AI generator. There remain 338 unique keyword dependencies (517 occurrences); detailed capability re-verification of the parallel expansion is still needed. No ranking improvement is asserted.

## Integration and verification

Unlike the preceding isolated release, this snapshot includes the now-live pages-*.js modules, pagekit, MCP download and existing developer-access route. The parallel release had already fixed its import error and published those features. This task changes clustering, canonical consolidation, contextual links and keyword architecture, and preserves that live functionality. The earlier release record is in release-2026-10-10-expansion.md.

- 16 targeted SEO, cluster, Worker and security tests passed.
- Source-ledger integrity passed: all 850 unique keywords preserved; 34 assigned destinations.
- 210 page/viewport combinations passed at 390px and 1440px; screenshots inspected.
- All 106 live pages passed canonical, heading, no-repository, signup/Discord and sitemap checks.
- All 18 live aliases returned direct 301s to expected canonicals. Existing host/prefix redirects, true 404 and signed-out app gate passed.
- Live desktop/mobile browser verification recorded separately in the snapshot's data/seo-review.

Publication is gated by distinct intent, usable content, truthful feature claims and technical verification, not by a fixed daily page limit. See cluster-architecture.md and Google's linked spam policies. Search Console property access remains unverified; per-keyword rankings remain unknown.

To make a future snapshot preserving the live expansion, use node scripts/seo-release-snapshot.mjs --include-live-expansion. The earlier exclusion mode is deliberately rejected when the cluster navigation depends on the expanded registry.

Final verification: all 10 live page/viewport combinations passed. IndexNow returned 200 OK for 124 URLs (106 canonical pages and 18 aliases). Submission acceptance is not proof of indexing.
