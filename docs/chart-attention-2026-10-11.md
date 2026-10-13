# Chart attention and data integrity — 2026-10-11

Deployed to `/opt/blix` at 19:25 UTC; final health-label correction at 19:28 UTC. Production source and web index hashes verified. Concurrent Pulse, fee-ledger, launch-order and status-bar changes preserved.

- Visible main charts receive price service regardless of discovery eligibility. Filtering a coin is not evidence it rugged. Shared feeds/subscriptions remain deduplicated per mint.
- Hidden tabs and offscreen main charts release their dedicated browser streams and stop chart price polling. Listener state and candles remain cached; returning reconnects one stream. Server focus expires after 15 seconds, absorbing brief switches.
- Qualified visible coins can receive enrichment; unseen coins defer it. Visible collection leases expire after 20 seconds. Existing selection rotates equal-priority work and serves active charts first. Verified held positions retain price eligibility, without an unrestricted analytics exemption.
- Paid analytics requests and analytics sockets yield at 80% of the paced daily allowance, preserving the final fifth for prices/execution. Existing hard limits, 25% analytics and 5% history ceilings remain.
- Missing/invalid liquidity is not treated as zero. Price anomalies say verification is needed. Retired tracking status says activity needs rechecking. Discovery counts say risk-filtered, not rugs; explicit searches bypass inactivity hiding.
- Gecko updates require a recent source timestamp and use it as candle time. Old cached quotes cannot manufacture current candles. Older available candles show their age.
- Hover charts discard malformed candle rows, retain valid history through empty responses, and show data unavailability explicitly. Their LIVE label requires a recent update.
- Hover prefetch uses the existing provider-free candle cache endpoint.

Validation: 320 local tests, 20 security tests, TypeScript/Vite build, and 149 tests on the staged Linux release. Actual chart components tested at 1440 and 390 px in main, TradingView and hover modes, with malformed and empty responses. Browser assertions verify hidden/offscreen request suspension, stream cleanup, single-stream resume, cached-candle preservation and valid live updates. Screenshots inspected.

Live checks: public site HTTP 200 and sign-in screen rendered at both widths; live backend returned ordered, finite OHLC candles and healthy shared trade feeds. A sampled new coin returned no candles with `Jupiter 429`, correctly retained as unavailable. The public browser had no signed-in session; the origin correctly refused an untrusted host. No authenticated production chart interaction is claimed.

Both Helius daily allowances were already exhausted before this change. Fast RPC remains unavailable until midnight UTC (6 PM Edmonton); shared market feeds continue. Admission counts are scheduling decisions, not measured credits saved. No end-to-end speedup percentage is claimed.

Evidence: `data/attention-priority/` (test/build logs, browser reports, screenshots, manifest and production verification). Initial rollback backup: `/opt/blix/data/deploy-backups/chart-attention-2026-10-11T19-25-15.663Z`; health-text backup: `/opt/blix/data/deploy-backups/chart-attention-2026-10-11T19-27-52.531Z`. Release: `/opt/blix/data/chart-attention-release-20261011`.
