# Search and competitor research — 2026-10-10

Scope: remaining competitor alternatives and head-to-head queries from the full keyword list. Method: web search for intent discovery; factual publication grounded in vendor documentation. No search-volume dataset, localized Google rank export, authenticated competitor account or execution benchmark was available. Returned search results are a research sample, not a ranking baseline.

## What Google actually recommends

Google's guidance asks for useful original analysis and explains that exact keyword variants do not each need explicit repetition. First position is not an automatic technical outcome. These points support one substantive destination per intent rather than one page per phrase. [SEO Starter Guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)

Google's spam policy covers doorway pages, keyword stuffing, manipulative link activity and low-value content generated at scale. The practical gate here: each new page must answer a distinct product decision and stand alone without requiring signup. [Spam policies](https://developers.google.com/search/docs/essentials/spam-policies)

Comparison pages should explain meaningful differences and provide original supporting evidence for superlative recommendations. A documentation review is useful but must not pretend to be a first-hand execution test. [High-quality reviews guidance](https://developers.google.com/search/docs/specialty/ecommerce/write-high-quality-reviews)

Google asks creators to evaluate originality, sourcing and whether readers leave satisfied; changing dates without substantial updates is not a quality strategy. [People-first content guidance](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)

## Search sample and intent findings

Searches run: `Photon trading official documentation photon-sol tinyastro`, `BullX Neo official documentation`, `GMGN official docs trading wallet tracker`, `DexScreener official docs API Birdeye official docs Jupiter terminal`, `Photon docs tinyastro`, `BullX suspended trading official BullX 2026`, `photon alternative`, `dexscreener alternative`, `best solana trading terminal`.

The observations below describe the returned sample only. They do not establish positions, traffic or keyword difficulty.

- Bare Photon searches mixed unrelated scientific/software meanings with crypto posts. The intended entity needs the Solana/TinyAstro qualifier. Its requested product URL returned 403 in direct web retrieval, so feature claims remain unverified. [Requested product URL](https://photon-sol.tinyastro.io/)
- BullX queries surfaced both older feature documentation and an indexed first-party Neo notice about disabled trading. Current availability materially changes replacement intent. [Neo application](https://neo.bullx.io/), [Neo order docs](https://bullx.gitbook.io/bullx-neo-docs/trading-terminal/trading)
- DEX Screener alternative results split between developer API migration and trader research. Keep these needs distinct within a useful comparison; the official reference establishes separate pair and token-pool objects. [API reference](https://docs.dexscreener.com/api/reference)
- Jupiter Terminal queries have a naming transition: the old developer URL redirects to Plugin, an embedding integration rather than a complete research workflow. [Current Plugin guide](https://developers.jup.ag/docs/tool-kits/plugin)
- General terminal searches returned commercial rankings, publisher comparisons and community posts. Those are evidence of result formats, not evidence of product superiority. The new material therefore includes an explicit comparison method and no invented numerical scores.

Search-result titles using a brand plus words such as “official” were not accepted as proof of ownership. Factual claims use the brand's established domain or documentation linked to its product identity.

## Primary-source findings and publication limits

| Product | What was established | Publication limit | Primary source |
| --- | --- | --- | --- |
| BullX Neo | Indexed first-party notice says trading disabled on this version while wallet and withdrawal functions remain. Older docs describe order settings and automation. | Fresh HTML retrieval did not expose the notice text. Attribute to the indexed notice and tell readers to verify the running version; no global shutdown or reopening date claimed. | [Application](https://neo.bullx.io/), [trading docs](https://bullx.gitbook.io/bullx-neo-docs/trading-terminal/trading) |
| GMGN | Wallet Radar builds wallet views from selected tokens; separate docs cover wallet-list export/import. | This does not establish copy-trade performance, full PnL history or account migration into BLIX. | [Radar](https://docs.gmgn.ai/index/wallet-radar), [wallet lists](https://docs.gmgn.ai/index/wallets-import-export) |
| DEX Screener | API distinguishes pair/search/token-pool requests; Boosts documentation describes an effect on Trending Score. | Do not describe all visibility as paid, a boost as fraud, or an omitted field as proven unsupported product functionality. | [Reference](https://docs.dexscreener.com/api/reference), [Boosts](https://docs.dexscreener.com/boosting) |
| Birdeye Data | Docs describe market and wallet data; developer quickstart uses an account and API key. | No equal coverage across all chains, fixed pricing, historical-depth equivalence or SLA was established. | [Data overview](https://data.birdeye.so/docs/getting-started) |
| Jupiter Plugin | Former Terminal docs redirect to Plugin; current docs describe embedded swap modes and wallet integration. | BLIX is not presented as a drop-in embedding replacement or as the owner of Jupiter routing. | [Plugin](https://developers.jup.ag/docs/tool-kits/plugin) |
| Photon | Requested first-party pages could not be retrieved. | No dedicated alternative page with invented features; keep its comparison row explicitly unverified. | [Product URL attempted](https://photon-sol.tinyastro.io/) |
| Axiom / Fomo | Existing source checks refreshed: Axiom Pulse describes stage-based discovery; Fomo homepage describes its social product. | Pairwise discussion is about starting workflow, not a fees, custody or execution benchmark. | [Axiom Pulse](https://docs.axiom.trade/axiom/finding-tokens/pulse), [Fomo](https://fomo.family/) |

## Six new editorial destinations

Export: `COMPETITOR_GUIDES` in `worker/site/competitor-guides.js`. Root agent owns registry wiring, keyword ledger updates and visual/Worker testing.

| Route | Assigned keyword family | Distinct reader value |
| --- | --- | --- |
| `/compare/bullx-alternative` | bullx alternative, bullx neo alternative | Preserve records and evaluate replacement requirements in light of availability notices. |
| `/compare/gmgn-alternative` | gmgn alternative | Explain wallet-selection bias, observation coverage and research versus copying. |
| `/compare/dexscreener-alternative` | dex screener alternative, dexscreener alternative | Reconcile token/pool identity and separate visibility from evidence; address developer schema migration separately. |
| `/compare/birdeye-alternative` | birdeye alternative | Define a data-requirements sheet and reconcile history/PnL disagreements. |
| `/compare/jupiter-terminal-alternative` | jupiter terminal alternative | Resolve Plugin versus full-terminal intent before comparing substitutes. |
| `/compare/solana-terminal-comparison` | axiom vs fomo, fomo vs axiom, axiom vs gmgn, gmgn vs axiom, axiom vs bullx, bullx vs axiom, fomo vs bullx, axiom vs photon, photon vs axiom, terminal comparison queries | Common evidence matrix plus distinct pair sections; Photon explicitly unknown. |

`photon alternative` may be mapped to the Photon section in the shared comparison with a research-needed status. Do not claim a complete Photon product evaluation. Existing `/compare`, Axiom/Fomo/Nio alternatives and `/gmgn-api` keep their established jobs. New pages use `/start`, the main site and the requested Discord invite, with no public repository links or mentions.

The untracked `pages-*.js` and `pagekit.js` files from another session were inspected only. They were neither imported nor modified. Several proposed routes there overlap in intent with this work; do not register both sets without editorial consolidation.

## Next evidence that would improve rankings and usefulness

1. Record a controlled, read-only product walkthrough with the same mint and public wallet on each accessible platform, preserving screenshots and timestamps.
2. Add first-hand observations about empty, stale and failed states. Publish costs only after a separate dated check of current terms and account conditions.
3. Establish Search Console query/page/country/device baselines after release; compare equal periods and distinguish indexing from impressions and conversions.
4. Revisit Photon once primary content can be read, and BullX whenever the current app notice changes.
5. Add a distinct pair page only when original evidence resolves a decision the consolidated matrix cannot answer; reversed brand order alone is not a new intent.

No claim is made that these additions will achieve first place for every term. The deliverable improves truthful coverage and usefulness; ranking, backlinks and user demand require ongoing measurement.
