# Coin calculations from streamed observations

The coin page now uses accepted live chart prices to recalculate token price, position value and PnL. Price observations carry timestamps; old candle redraws do not refresh them. Updates batch into one browser animation frame and yield to newer metric/poll observations.

`server/coin-flow.js` maintains bounded rolling five-minute totals for focused coins from the existing curve and PumpSwap signed-trade callbacks. It tracks buy/sell counts, historical USD volume, net USD flow and distinct wallets. Synthetic balance-change rows and duplicate events do not count. Expiration runs once per second, including during quiet periods; trade-triggered SSE updates coalesce over 50 ms. No additional provider requests are introduced.

The calculated window replaces indexed totals only after five minutes of observed continuous coverage. Focus expiry, detected disconnection, migration between feed kinds, explicit tape gaps or memory overflow invalidate coverage. Unsupported pools and warming windows retain the indexed fallback. Missing USD conversion or wallet identity stays unknown rather than becoming an understated total. Stale or out-of-order frontend updates cannot replace current totals.

Coverage means continuous observation of the configured feeds, not proof that an upstream provider delivered every chain transaction. Undetected upstream omissions, delayed logs, processed transactions later rolled back, and identical multi-leg events remain limitations. A chart cannot independently establish exact holder counts, ownership distribution, liquidity or historical cost basis. Those figures continue using their own sources.

Validation: 388 backend tests passed before the final primary-feed-only guard; the nine focused calculation tests passed after it. TypeScript and production build passed. Desktop (1920px) and mobile (390px) browser checks passed against both the isolated build and deployed assets, with provider boundaries mocked. Checks cover immediate price/PnL and total updates, older/incomplete events, polling recovery and coin switching. Production SSE separately emitted three real `cflow` updates over 2.162 seconds; that newly focused window correctly remained incomplete.

Deployment preserved concurrent frontend tracker changes and server auto-adoption behavior. Backend backup: `/opt/blix/data/deploy-backups/coin-calculations-20261013T004103Z`. The production service recovered successfully. No keys or provider budgets changed.
