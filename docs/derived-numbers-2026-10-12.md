# Calculated coin figures

The coin page recalculates supported figures from incoming prices and existing balances, with no additional provider requests:

- Token price, market cap, position value, position PnL and return: existing shared live-price path.
- Holder, top-trader and early-buyer values and ownership shares: token balance × price, and balance ÷ supply.
- Holder/trader PnL: cash flow plus the value of the token portion covered by the original cost-basis window. `pnlTokens` and `pnlBasis` now accompany server rows. Older holdings outside that window do not become apparent profit. SOL-ledger costs retain their SOL basis; indexed USD-window PnL retains its USD basis. Realized PnL remains unchanged by a price move.
- Trader rankings, winners, best/worst PnL and displayed returns already derive from those rows, so they update with them.
- Known-holder value and return: actual token balance and current supply replace the old scale captured when the page opened. Average-entry market cap uses entry price × supply, and no longer drifts with the current market price.
- Buy panel: an immediate, labelled “At spot” token estimate. The executable quote remains separate and still accounts for the route, liquidity, fees and price impact.
- Five-minute volume, trade counts, distinct traders, buy share and net USD flow use the previously deployed rolling-trade calculator when coverage is available.

Calculations use the original polled snapshot each time, avoiding accumulated rounding/delta errors. Missing cost basis stays unknown. Expired prices do not recalculate holder PnL or the spot estimate. Replay keeps its own historical state. Balance, supply, holder-count, liquidity and historical-window inputs still require source observations. A rolling percentage change needs its corresponding historical price; a current candle cannot establish that reference by itself.

Validation: 393 tests passed; TypeScript and production build passed. Desktop and mobile browser checks passed against deployed assets with HTTP/SSE boundaries mocked. They verify a live price change immediately updates holder value, limited-window PnL, top-trader PnL, known-holder PnL, stable average entry and the spot estimate, alongside the existing totals/recovery/coin-switch checks. The real production coin response separately returned 119 rows with cost-basis metadata. Desktop/mobile screenshots were reviewed.

Deployment backup: `/opt/blix/data/deploy-backups/derived-numbers-20261013T005223Z`. Frontend baseline matched the live asset graph before publishing. One backend module changed; the service recovered successfully. No credentials, rate budgets or execution paths changed.
