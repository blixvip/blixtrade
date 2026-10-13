# Incorrect quote currency in chart history

The 67cat chart (`9stanqrVUsQ2j7KxdEUXCN1EWes2eXi7hSQYJHRBpump`) displayed approximately $4.1M historical market-cap candles while independent trade rows and price times supply were around $100K.

The historical repair path trusted `tokens.pair` to identify a PumpSwap coin without checking the pool's quote mint. Its decoder assumes SOL with nine decimals. The pool account independently read from Solana showed base 67cat and quote `9AvytnUKsLxPxFHFqS6VLxaxt5p6BhYNr53SD2Chpump`, not wrapped SOL. The live decoder already rejected that currency combination, but the repair path incorrectly journaled it as SOL. Rebuilding from that journal contaminated candle history and the header's chart-derived value.

## Correction

- `server/pool-identity.js` checks program owner, exact account slice length, base mint and wrapped-SOL quote before returning a mint to the SOL-only repair decoder. Missing accounts are retried; unsupported quotes fail closed.
- Read-only audit: 63 recently active PumpSwap tokens with backfilled pool records; 14 used non-SOL quotes. All 14 pool accounts were present and base mints matched the tokens.
- Archived 9,401 unverified backfilled pool records, affected derived candles, and image-independent candle-cache entries to `/opt/blix/data/reports/quote-history-1791690372.json.gz`. These records were removed from the active journal; other trade sources were preserved. Derived candles were rebuilt from remaining records. This conservatively quarantines unverified backfills for affected coins, rather than claiming every archived row was independently decoded again.
- `meta` keys `quote_history_v1:<mint>` select independent USD provider history for affected coins. This avoids bridging from surviving old curve candles directly into present-day quotes across the missing interval.
- No chart values were clamped or rescaled to hide genuine market moves.

## Deployment and concurrent work

Another session edited the same files during the initial deploy, introducing imports unavailable in that release. The deployment health check detected failure and rolled back. A frozen compatible release restored service. Backup: `/opt/blix/data/deploy-backups/2026-10-11T03-46-11-quote`.

The other session subsequently deployed additional candle-order and cache improvements. The final provider-history fallback was applied to that newer server file after checking its hash, preserving those changes. Workspace files from the other session were not reset. `data/chart-incident` contains captured APIs, pool audit, release snapshots, and screenshots.

## Verification

- 14 focused tests passed: journal integrity and the real 67cat pool fixture, including a valid SOL-quoted control and retry behavior.
- Live 67cat 15-second response: 317 Jupiter candles; maximum high $136,938 versus the earlier erroneous $4,147,092. Latest chart close $75,506.58 and header $75,507 at capture time; recent independent trades were $70,894–$78,461.
- Actual built coin UI rendered against captured live responses at 1440px and 390px; screenshots inspected and no frontend exceptions. These are read-only fixture renders, not an authenticated trading session.
- Zero suspect backfilled pool rows remained at the post-repair check. Public homepage returned 200 and signed-out `/app` redirected to signup. No financial transactions were performed.

Pool account reference: [official PumpSwap IDL](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump_amm.json). The fix addresses this verified currency bug; it does not establish that every chart from every provider is error-free.
