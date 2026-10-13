# Synchronized prices and wallet valuations

Market cap, token price, coin holding values, tracked-wallet open PnL and wallet-profile totals now consume the same timestamped live-price store. Price batches commit before notifying subscribers. Calculations run on receipt without another wallet-monitor request; external price delivery still determines when new information is available.

Wallet-monitor snapshots include all open positions for valuation, including positions beyond the six displayed bags. Supply and price timestamps let the client calculate value and open-PnL deltas against the original snapshot. Realized profit and cost basis remain unchanged by price movements. Unsellable positions and unknown PnL retain their existing treatment. Wallet balances, trades and cost-basis changes still require observed transaction/account data.

Older, invalid and future-dated prices are rejected. Weak sources cannot immediately overwrite authoritative marks. Wallet calculations require fresh prices. Historical replay uses a separate store so replay cannot reprice real wallets. The header's unit-price label derives from the same market cap and supply shown on screen.

Validation:

- 398 automated tests passed, including atomic notification, stale-price rejection, hidden-position totals, unknown PnL and portfolio revaluation.
- TypeScript and production builds passed.
- Desktop (1920 px) and mobile (390 px) browser fixtures verified synchronized market cap/open PnL, holding values, profile totals, failure/recovery and coin switching. Market cap and tracker PnL were observed together after the same dispatched price event without another monitor request.
- A screenshot exposed a remaining unit-price/header mismatch. A regression check failed before the fix and passed at both widths afterward.
- The concurrent live frontend already contained the shared-price changes. The final isolated build preserved that JavaScript baseline and production stylesheet, adding the unit-price correction. A later browser rerun hit the loader timeout while local free RAM was about 1 GB; additional browser work was deferred under the workstation resource budget.
- Guarded deployment succeeded with healthy backend. Production monitor returned HTTP 200 and valuationPositions for all seven tracked-wallet payloads.

Release backup: `/opt/blix/data/deploy-backups/synced-prices-20261013T014108Z`.
