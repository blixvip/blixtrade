# Coin page live numbers

Fixed the trade sidebar presenting its capped 150-row sample as full five-minute totals. The sidebar, volume card and About 5M tab now share a complete aggregate. Bonded coins prefer fresh indexed pool totals: CNLeaks returned an idle local ring with zero volume while its pool trades were still arriving. Unknown pool totals wait for market data instead of implying no trades.

About now uses the shared five-second polling reader instead of an independent 25-second interval. The previous interval exceeded the backend's 15-second viewing lease. The shared reader resumes immediately on visibility changes, preserves last good data during failures, reports reconnecting/delayed data, and clears the prior coin's figures when navigating. Provider requests remain paced by the existing backend; indexed window statistics are not tick-by-tick chain readings.

Coin metric overlays reject expired or older values; late holder pushes cannot pin newer polling results. Price age advances between reads, and price derives from the displayed coin market cap and supply. Real position history polls every five seconds even when the wallet balance is unchanged; SOL valuation also subscribes to SOL price changes. Token information age labels tick continuously.

Validated TypeScript, production build, four numerical regression tests, and full browser checks at 1920px and 390px: aggregate counts beyond the row cap, live price/PnL, stale metric rejection, newer holder polling, changing window figures, error/recovery, switching coins, and position history updates without balance changes. No trades placed.

A concurrent release included this work. Verified the final deployed implementation and ran the browser regression against the live origin. Initial intermediate release lacked the pool-ring correction; a subsequent release included it before final verification. Final observed index: 7f36c7f03d66b4df5757af889b08df426926cc0d09fdd6f6151610293d8b6001. No older snapshot was published over another task.

Evidence: data/coin-live-check/results.json, numbers-1920.png, numbers-390.png, real-coin.json and real-coin.png. Read-only live check used CNLeaks BW4oQngRVLWSwfA76Xhm28boPE3rbqomTGMV34Bnpump.
