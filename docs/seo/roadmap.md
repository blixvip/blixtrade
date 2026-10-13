# Keyword coverage and remaining work

This inventory accounts for the complete supplied list. A page assignment means an intended destination, not proof of indexing, complete search-intent coverage, traffic, or rank. Rows with a roadmap ID remain incomplete even when a related page exists.

## Reproduce and review

```sh
node scripts/seo-ledger.mjs
node scripts/seo-ledger.mjs --check
```

The source preserves 1,275 original bullet occurrences, including the duplicated opening block and pasted instructions. There are **1,274 valid keyword occurrences, 850 unique normalized keywords, 424 repeated keyword occurrences, and one paste artifact**. Normalization lowercases and collapses whitespace; it deliberately retains `pumpfun`, `pump fun`, `pump.fun`, `memecoin`, and `meme coin` as distinct phrases. The terminal pasted instruction is preserved in `original_keyword` and removed only from `normalized_keyword`.

The generator assigns the same phrase consistently regardless of its source section. It records the source line, duplicate linkage, search intent, public page, roadmap, product evidence, and priority. Its check verifies the source fingerprint, every occurrence, duplicate consistency, representative capability boundaries, registry routes, and roadmap coverage. Changing the source fingerprint requires reviewing the original user list; never silently remove inconvenient terms.

All ranking and volume fields remain explicitly unknown. Sampled search-intent and competitor research is recorded in `search-research-2026-10-10.md`; it is not a localized Google ranking baseline. Product evidence points to inspected local implementation. Existing/new page status describes source code; deployment is verified separately in release records. P1 means a verified product or developer capability, P2 means a supporting explanation/comparison, and P3 means missing functionality, unresolved intent, or a broad/competitor query. Priority is editorial judgment, not measured keyword difficulty.

October 10 expansion: all 850 unique keywords now have rows in the generated performance report, including explicit next actions. Six additional comparison pages and six research tutorials extend the topical coverage, and `/about` records authorship and review boundaries. The ledger still preserves 517 roadmap keyword occurrences: publishing related guidance does not manufacture missing tools, benchmarks or ranking evidence. Read `measurement.md` for the read-only Search Console importer and unknown-data handling.

## Public destinations

| Cluster | Destination | Coverage boundary |
| --- | --- | --- |
| Terminal and execution | `/solana-trading-terminal` | Explain account execution, fees, and deployment differences. |
| AI analysis and trading | `/ai-memecoin-trading` | Distinguish analysis, practice, and funded execution. |
| Discovery and analysis | `/solana-memecoin-screener`, `/pump-fun-tracker` | Explain actual market data, freshness, and absent data. |
| Discovery instructions | `/how-to-find-meme-coins-early` | Practical workflow; no return or early-access guarantee. |
| AI picks and models | `/ai-memecoin-picks` | Methodology and app context; per-model and daily evidence remain below. |
| Wallets and PnL | `/solana-wallet-tracker`, `/solana-pnl-tracker` | Keep tracked observations, wallet accounting, and paper results distinct. |
| Risk | `/memecoin-risk-scanner` | Observed indicators; no definitive safety certification. |
| Signals and social analysis | `/memecoin-alerts`, `/memecoin-social-sentiment` | Document inputs and limits; no promised delivery channel or profitability. |
| Coin creation | `/create-memecoin` | Existing no-code form uses supplied metadata; AI branding is absent. |
| Developer tools | `/api`, `/mcp`, `/pump-fun-api`, `/pumpfun-realtime-api` | Existing HTTP/SSE interfaces and MCP; no invented SDK, CLI, or WebSocket service. |
| Integrations | `/fomo-api`, `/axiom-api` | BLIX context, clearly independent of third-party official docs. |
| Comparisons | `/compare`, `/compare/axiom-alternative`, `/compare/fomo-alternative`, `/compare/nio-trade-alternative` | Dated sourced comparison; additional competitors/pairs require research. |
| Navigation and broad queries | `/guides`, `/` | Hubs support discovery; they do not automatically fulfill every head-term intent. |

## Product and evidence backlog

These are explicit follow-up deliverables, not features implemented by this SEO release. Filter `roadmap_id` in the CSV for every affected original occurrence.

<a id="ai-creator"></a>
### AI-assisted creation and unattended launch

Current source accepts a user-supplied name, ticker, image, description and links, uploads metadata, and submits an authenticated launch. A browser form supports the no-code claim. AI identity generation, automatic/unattended launch, instant execution and one-click completion require separate product work.

Acceptance: a working, tested AI draft flow with editable output; clear cost and transaction preview; explicit user approval before any funded transaction; observable completion/failure; examples from the shipped feature. Update existing creation content only after acceptance. Avoid claiming free launch merely because software is open source.

<a id="branding-generators"></a>
### Branding generators

Logo, image, mascot, name, ticker, slogan, website and landing-page generators remain unverified. Existing upload fields and a ticker abbreviation helper are not those products.

Acceptance: ship and verify each generator before giving it a dedicated page; include usable output, editing/export behavior, example inputs/results, and clear usage limits. Consolidate synonyms onto one useful page per actual tool.

<a id="marketing-generators"></a>
### Creator marketing tools

Tweet, social post, bio, description, meme, advertising and copywriting generators need actual workflows. A manually entered coin description does not establish a description generator.

Acceptance: verify the input/output flow and export behavior for each offered tool. Publish examples that reflect the shipped functionality; do not imply automatic social posting or account integration unless supported and independently authorized.

<a id="cli-package"></a>
### CLI distribution

The repository's Node server/MCP entrypoints and its use of third-party CLIs do not constitute a published BLIX trading CLI.

Acceptance: versioned executable, documented installation, commands and help, read-only examples, authentication, useful exit codes and structured output, and explicit funded-action confirmation. Test installation on a clean environment before a `/cli` page. Third-party-brand CLI queries require independent documentation, not relabeling the BLIX executable.

<a id="sdk-package"></a>
### SDK distribution

HTTP examples do not constitute a published SDK.

Acceptance: choose and ship an actual supported package with typed public interfaces, versioning, authentication, error handling, a tested installation and read-only example. Publish language-specific content only for verified examples/packages. Do not advertise a Python/JavaScript SDK that does not exist.

<a id="public-websocket"></a>
### Public WebSocket interface

BLIX currently documents HTTP plus `/api/stream` SSE. The realtime guide can explain upstream WebSockets and consuming SSE; it cannot claim to expose a BLIX WebSocket URL.

Acceptance for a new interface: documented endpoint, auth, event contracts, reconnect/backfill behavior, subscriptions, rate limits and failure tests. Until then, retain the honest SSE explanation and roadmap status for WebSocket-specific phrases.

<a id="automation-evidence"></a>
### Autonomous execution claims

AI reads, paper automation and manual real trading are different capabilities.

Acceptance: verify the exact live automation path, budget controls, stop behavior, transaction authorization, failure handling and traceable results before describing autonomous funded trading. Validate transaction behavior with mocks or a dedicated non-production environment; never use SEO verification to place real trades.

<a id="model-evidence"></a>
### Model-specific pages and comparison

Code contains Claude, Grok, Gemini and Groq-backed model paths, including Kimi, Llama and GPT-OSS models. Available configuration and upstream access vary; these names do not establish equivalent capabilities or outcomes. ChatGPT is a product name and must not be used as a synonym for every OpenAI-compatible model. Dedicated DeepSeek and Qwen integrations were not verified.

The user's instruction to repeat model patterns is retained as a future expansion rule: for each **actually supported and verified** model, research `meme coin picks`, `memecoin picks`, `crypto picks`, `solana picks`, `pumpfun picks`, `trading`, `trading bot`, `crypto analysis`, `meme coin analysis`, `token analysis`, `coin picker`, and `token picker`. These derived phrases are additional to the 850 supplied unique terms; do not inflate the source count with them.

Acceptance: verify each provider path and availability; collect dated, comparable input/output examples with the same inputs and evaluation period; include costs, errors, losses and missing data. Publish a distinct model page only when it offers useful unique evidence. No fabricated leaderboards or predicted returns.

<a id="dated-picks-evidence"></a>
### Public daily picks and market lists

The public picks explanation is not a current dated feed. App-only data does not automatically satisfy `picks today` or a public best-coins list.

Acceptance: a dated public snapshot with provenance, timestamp, ranking methodology, invalidation conditions, original observations and subsequent outcomes; mark stale data clearly. Preserve losses and delisted tokens in results. Do not index empty or repetitive daily pages.

<a id="risk-validation"></a>
### Risk-specific verification

Holder observations, wallet tags and third-party risk data do not establish a universal honeypot or contract checker, nor a downloadable sniper bot.

Acceptance: independently verify the actual Solana-specific detection method and false-positive/unknown cases; document limits and provide accurate examples. A risk indicator must never become a safety guarantee. Sniper GitHub queries need a real relevant repository or an honest limitation.

<a id="bot-tutorial"></a>
### Runnable developer tutorials

Reference documentation is a starting point, not an end-to-end trading bot tutorial.

Acceptance: a complete, repeatable walkthrough using documented endpoints, authentication, pinned runtime prerequisites, sample outputs, error handling and paper/read-only defaults. Exercise fixtures or mocked transactions in CI. Explicitly separate simulation from live execution.

## Search and editorial backlog

<a id="comparison-research"></a>
### Competitor and “best” comparisons

The comparison hub now includes dedicated BullX/Neo, GMGN, DEX Screener, Birdeye and Jupiter alternatives. `/compare/solana-terminal-comparison` consolidates Axiom/Fomo/BullX/Photon/GMGN pairwise questions with a task-based matrix. Photon details remain unverified. Pump.fun/Moonshot/Raydium/LetsBonk comparisons and quantitative best-in-category claims still need research or original testing. Reversed phrasing belongs to one canonical comparison, not two duplicate pages.

Acceptance: current primary-source feature/pricing evidence, a dated evaluation, consistent criteria, material tradeoffs and explicit BLIX affiliation. Publish only comparisons with useful original analysis. Do not claim universal superiority or rank every product first. Update the ledger when a dedicated useful page replaces the supporting hub.

<a id="competitor-intent"></a>
### Other brands' navigational queries

Bare `fomo`, `axiom`, and `nio.trade` searches may seek another company, a general concept, or its official downloads/docs. BLIX comparisons cannot become official third-party apps or documentation. `fomo seo` and `axiom seo` require intent research before deciding whether BLIX can meaningfully answer them.

Acceptance: inspect localized search results; publish a useful independent explanation or integration only where BLIX genuinely answers the need. Keep incompatible navigational queries tracked, with no fabricated affiliation, download, source repository or ownership claim.

<a id="broad-intent"></a>
### Broad head terms

`solana`, `memecoin`, `meme coin`, and `pumpfun` cover much more than this product. Their presence in the topical map is an ambition, not a first-place forecast.

Acceptance: establish country/device-specific result intent and existing authority; build relevant original resources and citations over time. Reassess opportunity from measured impressions and qualified conversions rather than exact-match keyword repetition.

<a id="intent-research"></a>
### Unresolved future phrases

The generator conservatively assigns unknown future phrases to research, rather than inventing functionality. Review the original phrase, leading localized results and product capabilities; then give it a documented page or specific roadmap ID. This fallback must never count as full content coverage.

<a id="paste-artifact"></a>
### Preserved paste error

`ai tradCore brand / tool keywords` is the incomplete first AI-trading block joined to the repeated section header. It remains a ledger row but is excluded from valid-keyword totals and publication. The complete `ai trading` and related phrases are preserved elsewhere. The final `trading mcpSiDO ...` line retains the original text while targeting `trading mcp`.

## Measurement and release gates

1. Verify the source registry and deployed pages separately; a generated CSV is not proof of deployment.
2. Establish Search Console property access, sitemap coverage, and country/device query baselines. Global English is the default until a target market is chosen. Record unknown volume as unknown; never infer it from this list.
3. Add real observed competitors and evidence dates per intent cluster. Use individual-query research where intent differs, especially third-party brands, “free,” APIs and execution.
4. Review index coverage, impressions, clicks, landing-page signups and qualified product use weekly; revisit priorities monthly. Preserve measurement date, country and device. Average position is not a universal rank.
5. Only remove a roadmap status when its acceptance evidence is present and the public page is accurate. A related explainer alone is insufficient.

No paid keyword tools, outreach messages, paid links, indexation outcomes, backlinks or Google rankings are represented as completed by this inventory.
