# Competitor comparison evidence

Reviewed: 2026-10-10. Editor: BLIX. Method: primary-source documentation review, plus local API and page-source inspection. No trade, signup, custody audit, fee test or performance benchmark was performed.

## Verified sources and limits

| Product | Primary sources | Supported observations | Limits |
| --- | --- | --- | --- |
| Axiom Trade | [Official docs](https://docs.axiom.trade/), [Pulse](https://docs.axiom.trade/axiom/finding-tokens/pulse), [wallet monitoring](https://docs.axiom.trade/wallet-tracking/monitor-wallets), [limit orders](https://docs.axiom.trade/axiom/swap/limit-orders), [index](https://docs.axiom.trade/llms.txt) | Docs cover discovery, holder filters, wallet monitoring and limit orders. | Index reviewed did not establish supported public API/MCP/CLI/SDK access. Do not translate that into “none exists.” |
| Fomo | [Official homepage](https://fomo.family/), [linked help index](https://fomo.family/answers) | Homepage positions Fomo around social discovery and phone/web trading. | Reviewed sources did not establish public developer access; no price, custody, performance or complete chain-coverage claim made. |
| Nio.trade | [Official homepage](https://nio.trade/), [linked documentation](https://docs.nio.trade/) | Homepage describes multiple chains and configurable execution/research workflows. | Docs link returned a retrieval failure. Developer access and precise account requirements remain unknown. |
| BLIX | `public/api-docs.js`, `public/mcp-tools.js`, `worker/site/pages.js`, [repository](https://github.com/blixvip/blixtrade) | Local research interfaces and existing product page workflows. | Local interfaces are not guarantees of hosted access. Existing no-signing claims must be reconciled separately with execution code. |

Only the actual brand domains and their subdomains were used for product claims. Search results contained Axiom-branded lookalikes; those were excluded. The Nio documentation domain is linked directly from its homepage. No referral links were added. Vendor marketing superlatives were not repeated as findings.

## Published comparison pages

`worker/site/comparisons.js` exports `COMPARISON_PAGES`, using the existing page/layout object shape:

- `/compare`: methodology and routing hub; no unsupported overall winner.
- `/compare/axiom-alternative`: discovery, holder definitions, research and developer access.
- `/compare/fomo-alternative`: evaluating a socially discovered trade, public-wallet interpretation and independent research.
- `/compare/nio-trade-alternative`: required chains, product controls and research integration.

Every page displays review date, editorial ownership, direct source links, affiliation disclosure and research limits. Existing `/axiom-api` and `/fomo-api` own developer-intent details; new alternatives pages link to them instead of competing with them.

## Keyword routing rules

Use these rules in the full keyword ledger; they are assignments, not claims of rankings or feature availability.

| Family | Destination or disposition |
| --- | --- |
| Axiom alternatives, terminal, platform, scanner, signals, analytics and trading-tool searches | `/compare/axiom-alternative`; broad brand navigation is context-only, not a promise to replace Axiom's official result. |
| Axiom API/developer API/MCP/server/bot/CLI/SDK/GitHub/docs/integration/automation/open-source searches | Existing `/axiom-api` for evidence and independent alternatives; actual Axiom integration stays roadmap/unverified unless vendor support is demonstrated. |
| Fomo alternatives, app, terminal, trading, discovery and analytics searches | `/compare/fomo-alternative`; identify fomo.family explicitly. |
| Fomo API/developer API/MCP/server/bot/CLI/SDK/GitHub/docs/integration/automation/open-source searches | Existing `/fomo-api` for evidence and independent BLIX interfaces. No official Fomo interface implied. |
| Nio.trade / nio trade alternatives and product families | `/compare/nio-trade-alternative`, including a clear developer-availability unknown. A dedicated API page is deferred until substantive verified material exists. |
| Competitor download, setup and tutorial navigation | Relevant comparison explains product identity and links to official site. Standalone tutorial requires a verified reproducible workflow; no mirrored download page. |
| Axiom vs Fomo and Fomo vs Axiom | `/compare` methodology and links to both independently researched pages; full pairwise benchmark is roadmap. |
| Axiom/BullX/Photon/GMGN pairwise searches, other terminal alternatives and “best” comparisons | `/compare` assessment framework; product-specific comparisons remain research roadmap. Existing `/gmgn-api` is the developer comparison already present. |
| Pump.fun vs launchpads or exchanges | Research roadmap: distinguish launch platform, terminal and exchange roles before publishing; no fabricated head-to-head winner. |
| Fomo SEO / Axiom SEO | Low product relevance; preserve in ledger as research/low-fit. Do not manufacture an SEO service page. |

Spelling variants and reversed pair order should share a substantive page. Keep every raw keyword in the ledger, but do not publish a separate URL per permutation. Unsupported API or integration terms stay explicit roadmap items even if a comparison explains the current research limit.

## Refresh criteria

- Recheck source links and vendor facts before each comparison release and monthly thereafter.
- A changed official docs index, newly published developer interface, broken source or substantive correction triggers review.
- Do not claim a tested advantage until the workload, dated results and failures are available.
- Future fees comparison must include chain costs, priority tips, slippage assumptions and any referral dependence; current pages intentionally make no numerical fee claims.
- Future execution comparison requires a separate authorized test. SEO validation must never place trades.
