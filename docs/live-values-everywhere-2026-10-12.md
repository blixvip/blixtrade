# Live values across Blix

Extended the shared live-price calculations to account holdings and PnL, the wallet menu, public profiles, tracked-wallet and trader profiles, paper-wallet equity/PnL, Pulse market caps, AI picks, Practice current caps, Discover unit prices, thesis positions, and the expanded coin details.

Account and public-profile totals use confirmed token quantities and the supply basis supplied by paired market-cap/unit-price observations. Coin pages also supply their known supply. Later price ticks retain that basis; no billion-token default is assumed. SOL exchange-rate changes also revalue account/profile totals and tracker balance equivalents.

Wallet views register all held mints with the existing batched metrics subscription, including positions below the fold. They share its existing interest limit and provider budget. Valuation does not make a separate provider request per cell or position. Updates remain limited by the arrival of source data.

Paper-wallet responses now include valuation inputs for all open positions. The frontend calculates estimated open equity and PnL while preserving cash and realized returns. Executable swap quotes remain separate. Realized trades, historical portfolio charts, external leaderboard rankings, balances and transaction facts are not invented from current prices. The Fomo portfolio chart is labeled Portfolio history; its open positions update separately.

Validation:

- TypeScript and isolated production builds passed.
- 29 focused calculation tests passed, covering supply propagation, account/SOL totals, paper equity, matching chains, open thesis PnL, immutable snapshots, stale marks and missing cost basis.
- Full suite: 403 passed, one failed because the database backup test requires at least 6 GiB of free disk and this workstation had about 4.2 GiB. No test was disabled.
- Browser fixtures passed at 1920 and 390 px: coin/monitor synchronization, portfolio and public-profile totals, paper equity, recovery, and navigation. Screenshots inspected in `data/coin-live-check`.
- A production browser tunnel was blocked by automatic approval review. Deployment verification instead checks actual production asset hashes and API responses.
- The subsequent live frontend (index SHA-256 `4b76ac31fbf85c7bc73b6136babedd9c4e92c1697a34ab7ee1b697545a106a48`) already included this task's changes through a concurrent deployment. Its complete JavaScript/CSS closure was downloaded and exercised directly in the browser fixture harness. Both desktop and mobile checks passed against those production assets; no additional frontend overwrite was needed. Results: `data/everywhere-prices-release/production-assets-browser.log`.
- Concurrent deployments required rebuilding against the current production frontend. The final baseline matched every live JavaScript chunk before applying this task's files. Other sessions' root sources were not reverted.
- Production paper-wallet API returned HTTP 200 with valuation data for 24 open positions after the server update.

Server backup: `/opt/blix/data/deploy-backups/everywhere-prices-20261013T022346Z`.
Release records: `data/everywhere-prices-release`.
