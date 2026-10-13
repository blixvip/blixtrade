# Keyword cluster architecture

All **850 unique supplied keywords** have one row in `keyword-clusters.csv`. Synonyms share a canonical resource. A topic can contain several distinct research, product or developer intents; it is not one enormous keyword page. Existing canonical URLs are retained so published links and indexing signals are not split across spelling variants.

## Current topic structure

| Topic | Supplied keywords | Published resources |
|---|---:|---|
| Find and analyze memecoins | 119 | `/solana-memecoin-screener`, `/pump-fun-tracker`, `/how-to-find-meme-coins-early`, `/guides/how-to-analyze-meme-coins`, `/guides/solana-memecoin-market-cap-liquidity`, `/guides/pumpfun-bonding-curve`, `/pump-fun`, `/pump-fun-analytics`, `/meme-coin-finder`, `/new-meme-coins`, `/trending-meme-coins`, `/meme-coin-analyzer`, `/memecoin-analytics`, `/solana-memecoins` |
| AI research and coin picks | 133 | `/ai-memecoin-picks`, `/ai-memecoin-trading`, `/memecoin-social-sentiment`, `/guides/compare-ai-crypto-research`, `/grok-meme-coin-picks`, `/claude-crypto-analysis`, `/chatgpt-meme-coin-analysis`, `/gemini-crypto-picks`, `/deepseek-meme-coin-picks`, `/best-ai-for-crypto-trading`, `/best-crypto-ai-tools`, `/twitter-meme-coin-tracker`, `/memecoin-narratives`, `/how-to-use-ai-for-crypto-trading` |
| Wallet tracking and PnL | 41 | `/solana-wallet-tracker`, `/solana-pnl-tracker`, `/guides/how-to-find-smart-money-wallets`, `/pump-fun-wallet-tracker`, `/smart-money-tracker`, `/solana-whale-tracker`, `/how-to-track-solana-wallets` |
| Holders and token risk | 30 | `/memecoin-risk-scanner`, `/guides/token-holder-distribution`, `/pump-fun-rug-checker`, `/rug-pull-scanner` |
| Trading, practice and alerts | 75 | `/solana-trading-terminal`, `/memecoin-paper-trading`, `/memecoin-alerts`, `/pump-fun-trading-bot`, `/pump-fun-terminal`, `/pump-fun-signals`, `/ai-trading-bot`, `/ai-trading-agent`, `/solana-swap` |
| Create a memecoin | 168 | `/create-memecoin`, `/create-pump-fun-coin`, `/ai-meme-coin-maker`, `/meme-coin-name-generator`, `/how-to-create-a-meme-coin` |
| APIs, live data and MCP | 158 | `/api`, `/pump-fun-api`, `/pumpfun-realtime-api`, `/mcp`, `/axiom-api`, `/fomo-api`, `/gmgn-api`, `/pump-fun-mcp`, `/pump-fun-sdk`, `/pump-fun-api-python`, `/pump-fun-api-javascript`, `/developers`, `/crypto-mcp-server`, `/how-to-use-mcp-for-crypto`, `/solana-api`, `/wallet-tracking-api`, `/memecoin-sdk`, `/crypto-trading-cli`, `/how-to-build-a-solana-trading-bot`, `/fomo-mcp`, `/axiom-mcp`, `/nio-trade-api` |
| Compare platforms and alternatives | 126 | `/compare`, `/compare/axiom-alternative`, `/compare/fomo-alternative`, `/compare/nio-trade-alternative`, `/compare/bullx-alternative`, `/compare/gmgn-alternative`, `/compare/dexscreener-alternative`, `/compare/birdeye-alternative`, `/compare/jupiter-terminal-alternative`, `/compare/solana-terminal-comparison`, `/pump-fun-vs-letsbonk`, `/pump-fun-vs-moonshot`, `/pump-fun-vs-raydium`, `/best-solana-trading-terminal`, `/fomo-app`, `/fomo-trading-bot`, `/fomo-scanner`, `/axiom-trade`, `/axiom-trading-bot`, `/axiom-scanner`, `/nio-trade`, `/photon-alternative`, `/axiom-vs-fomo`, `/axiom-vs-bullx`, `/axiom-vs-photon`, `/axiom-vs-gmgn`, `/fomo-vs-bullx` |

Counts are inventory counts, not search volume, completed coverage or rankings. Missing functionality and unresolved intent remain explicit in the CSV.

## Requested examples

| Keyword cluster | Canonical destination | Decision |
|---|---|---|
| AI meme coin maker, AI memecoin creator, AI Pump.fun creator | /ai-meme-coin-maker (supporting guide) | A published guide explains the AI boundary; a working AI-assisted creation feature remains unverified. /create-memecoin covers the existing launcher. |
| Pumpfun API, pump.fun API, pump fun API | /pump-fun-api | Keep the published canonical; do not create a competing /pumpfun-api article. |
| Solana MCP, crypto MCP, memecoin MCP | /mcp | Keep the published MCP guide. A separate client tutorial needs a materially different setup task. |
| Axiom alternative, Axiom alternatives | /compare/axiom-alternative | One independent comparison. Reversed versus queries share the relevant comparison matrix. |
| AI meme coin picks, AI memecoin picks | /ai-memecoin-picks | One methodology/product page. Daily pick pages require dated data and outcome evidence. |
| Meme coin scanner, memecoin scanner, Solana token scanner | /solana-memecoin-screener | One discovery product page; analysis and early-discovery tutorials answer different tasks. |

## When another page earns its own URL

Publish when the page answers a distinct question or offers a distinct working tool, supplies original steps/data/examples, and remains useful before a visitor signs up. Give it one canonical, contextual sibling links and a place in its topic hub. Merge pages whose only difference is spelling, word order, competitor-name swapping or repeated sales copy. Public CTAs remain the BLIX site and Discord.

Publication speed is not the release gate. Each page must meet the same evidence, usefulness and technical checks, whether the batch ships today or over several weeks. See [Google's scaled-content, doorway and keyword-stuffing policies](https://developers.google.com/search/docs/essentials/spam-policies).

Generator, CLI and SDK destinations are feature or content briefs, not proof that those products exist. Some now have supporting guides from the parallel release; a guide explaining a missing feature does not satisfy the feature dependency. Promote a working-tool claim only after the corresponding roadmap gate is met. The 850 queries can be served by fewer substantial pages; no arbitrary target number of URLs is imposed.

Regenerate: `node scripts/seo-clusters.mjs`.
