# Educational content expansion — October 10, 2026

Six articles expand distinct research intents. They complement feature pages rather than creating separate pages for spelling variants. Source review describes implementation and documentation checks, not a live deployment test or measured ranking improvement.

| Route | Primary intent | Existing feature relationship |
| --- | --- | --- |
| `/guides/how-to-analyze-meme-coins` | How to analyze meme coins / pump.fun coins | Repeatable analysis worksheet; supports screener and risk pages |
| `/guides/how-to-find-smart-money-wallets` | How to find smart money wallets / profitable Solana wallet research | Candidate evaluation and history coverage; supports wallet tracker |
| `/guides/token-holder-distribution` | Token holder analysis / distribution / bundled and insider wallet research | Account ownership, completeness and relationship evidence; supports risk scanner |
| `/guides/compare-ai-crypto-research` | AI crypto model comparison / best AI for memecoin research | Evaluation methodology, not an unsupported model leaderboard |
| `/guides/solana-memecoin-market-cap-liquidity` | Token liquidity / market cap / volume / performance analysis | Worked definitions and comparison worksheet; supports screener and PnL |
| `/guides/pumpfun-bonding-curve` | Pump.fun tutorial / graduation / launch-stage analysis | Curve state and transition workflow; supports tracker and creator |

## Official sources checked

- [Solana mint accounts](https://solana.com/docs/tokens/basics/create-mint): identity, supply, decimals and authorities.
- [Solana token accounts](https://solana.com/docs/tokens/basics/create-token-account): mint/owner relationship and associated accounts.
- [Solana transaction history](https://solana.com/docs/rpc/http/getsignaturesforaddress): newest-first signatures, pagination and status fields.
- [Jupiter quotes](https://developers.jup.ag/docs/swap/v1/get-quote): expected output, minimum threshold, impact and route fields.
- [Jupiter swap troubleshooting](https://developers.jup.ag/docs/guides/how-to-build-a-custom-swap-with-metis): route failures and high impact context.
- [Pump.fun curve documentation](https://pump.fun/docs/bonding-curve): pricing mechanism and graduation destination; no fixed fee or threshold claims copied into articles.
- [xAI X Search](https://docs.x.ai/developers/tools/x-search): tool capability, clearly separated from whether a BLIX read used it.
- [CoinGecko market response](https://docs.coingecko.com/reference/coins-markets): distinct market-cap, diluted-valuation and supply fields.

Sources were read October 10, 2026. Citations sit beside the supported claims. Worked examples, research worksheets and evaluation rubrics are original editorial material; they are not platform performance results.

## Implementation evidence

- `server/wallets.js`: observed wallet history, unknown entry cost, realized/open/sellable results, correlated-wallet grouping and smart-money discovery. Notes preserve missing coverage and distinguish candidates from certified skill.
- `server/holders.js` and `web/src/pages/coin/BubbleMap.tsx`: partial/genesis flags, early-buy timing tags and distinct relationship types. Timing and transfer heuristics do not establish identity.
- `server/research.js`: configured/actual provider reporting, fast/deep lanes, Grok and Claude handling, Gemini fallback availability. No claims about unsupported models or a controlled performance leaderboard.
- `server/livetrades.js`: progress calculation, observed pool activity and migration guard. No universal time-to-graduation guarantee.
- Existing `features.js`: adjacent intents stay on existing feature pages; no edits made to that file.

## Integration and review

`worker/site/learning.js` exports `LEARNING_PAGES` as an object keyed by route. The root agent owns registry imports, guide navigation, related-card registration, sitemap coverage and browser verification. Do not import the unrelated external agent's `pages-*.js` files as part of this addition.

Each page uses the shared layout, unique title/description, October 10 update date, visible BLIX authorship, contextual internal links and FAQs. Acquisition calls to action go to `/start` and the established BLIX Discord. No repository promotion, local installation CTA, fabricated trading returns or claims that broad keywords already rank.

Validation: syntax and rendered-page checks cover every article, unique heading IDs, title/description presence, citation URLs and word count. Root review must check narrow/wide rendering and routed links after registry integration. Public ranking and conversion outcomes remain unmeasured until deployment and Search Console/analytics observation.
