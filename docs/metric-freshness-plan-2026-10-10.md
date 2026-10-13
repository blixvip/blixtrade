# Blix Trade metric update plan

Market cap gets first access to update capacity. Within that priority, focus on coins being viewed and coins younger than 24 hours. Use the same incoming events to refresh every other metric that can be calculated accurately. Keep older coins covered, preserve the existing Helius credentials, and stay within the existing credit allowance.

This is an implementation plan, not a deployed change. Findings come from the current working tree, a read-only check of local Health on October 10, 2026, and [official provider research](metric-provider-research-2026-10-10.md). The working tree already contains unrelated edits; implementation must preserve them. The PC has `marketFeeds=false`; its measurements do not establish production VM latency or total project usage.

**1. What the current system already does**

| Component | Observed behavior | Planned action |
|---|---|---|
| [fastlane.js](../server/fastlane.js), [fastpx.js](../server/fastpx.js) | Dedicated worker streams curve/pool account prices directly to open coin pages. | Extend this foundation to selected visible coins; preserve worker isolation. |
| [chartstream.js](../server/chartstream.js) | Separate price, trade and holder traffic; chart log focus capped at 12 coins, with 15-second idle expiry. | Keep traffic separation. Replace independent admission decisions with a shared subscription registry and budget. |
| [server.js](../server/server.js), [livepx.ts](../web/src/lib/livepx.ts) | Market caps already broadcast roughly every 100 ms. Server gives stronger sources a 20-second preference; browser rejects weak updates for 30 seconds. | Use source event time, slot, validity and freshness to prevent both stale overwrites and stale-source lock-in. |
| [Coins.tsx](../web/src/pages/Coins.tsx) | Discover lists poll every 5 seconds; supplementary spark/metric reads every 3 seconds. MC also receives pushed updates. | Extend push updates to other fields. Keep polling as reconciliation, not the primary live path. |
| [jupdisc.js](../server/jupdisc.js) | Supplementary figures become due after 25 seconds, refreshed on a 12-second timer; retained values may be up to 10 minutes old. | Track freshness per field and prioritize visible young coins. Never make a retained answer appear newly measured. |
| [holderslive.js](../server/holderslive.js) | Open-coin holder changes publish at most every 250 ms; snapshots every 20 seconds for smaller account sets, 120 seconds for larger ones; skips known counts above 10,000. | Keep incremental updates. Make full repair conditional on coverage and budget instead of refreshing everything aggressively. |
| [helius.js](../server/helius.js), [heliuskeys.js](../server/heliuskeys.js) | Existing monthly usage reads, daily pacing, persisted usage and 97% monthly stop. | Preserve protections, correct cost estimates, and extend them to every consumer and instance. |
| [solana.js](../server/solana.js), [txtrade.js](../server/txtrade.js) | General RPC and transaction fetches have separate pacing; these paths do not call the chart credit meter. | When routed through Helius, admit and meter them through the shared governor. |
| [snipe.js](../server/snipe.js) | History work has its own budget; key selection checks monthly exhaustion separately from chart daily pacing. | History becomes subordinate to MC and the same total project budget. |

Local Health reported 41 pauses over one second in its reported monitoring window, with a 7.4-second worst pause. It listed Fomo processing and Discover requests among slow work. These are reasons to profile production, not proof of identical production performance.

**2. Protect the actual Helius allowance first**

The local Health snapshot reported:

| Existing slot | Provider monthly use | Remaining | Reset shown | Local estimated credits today |
|---|---:|---:|---|---:|
| 1 | 66.1% | 339,074 | November 6 | 8,867 |
| 2 | 13.3% | 867,096 | November 8 | 5,966 |

The local stream meter recorded 4.44 MB, approximately 89 credits under current billing, versus 14,833 total estimated daily credits. Thus over 99% of this local meter's recorded spend was attributed to HTTP. It does not establish where all project-wide credits were spent. Existing history estimates also overcount some requests.

Current Helius billing lists WSS at 20 credits per uncompressed MB, standard RPC generally at one credit, and `getProgramAccounts` at ten. `getTransactionsForAddress` with full details costs ten per 100 transactions returned, rounded up with a ten-credit minimum. Blix currently records a flat 100, while its launch-history request uses `limit: 100`. Verify the actual response and billing before reducing reservations; settle estimates after responses. [Helius credits](https://www.helius.dev/docs/billing/credits)

Implement a project-level governor:

- Preserve both saved credentials and current failover policy. Never replace keys, add keys, raise spending limits, purchase credits or silently activate paid feeds.
- Identify the actual quota boundary. Multiple keys on the same project are one allowance, not independent budgets. Coordinate the VM, PC and any other consumers; reuse the production collector rather than opening duplicate feeds from development.
- Meter HTTP, sockets, connection openings, retries and all background jobs. Attribute worker usage to the endpoint/project that received it, not whichever key is active when its delayed meter message arrives.
- Reserve estimated cost before dispatch, reconcile after the response, and persist conservative in-flight accounting. Restarts cannot reset spending. Count bytes correctly, and reconcile local estimates against provider usage rather than assuming perfect agreement.
- Use actual remaining credits and reset time instead of a hard-coded one-million-credit assumption. A starting daily ceiling is the smaller of the configured ceiling and `(remaining - protected reserve - expected external usage) / remaining days`. If this is near zero, stop optional work; a minimum daily floor must not defeat the monthly reserve.
- Apply a global requests-per-second limiter plus method limits, subscription/connection limits, concurrency limits and bounded queues. Per-method pacing alone does not protect a shared project rate limit.
- Honor `Retry-After`, use jittered bounded backoff and coalesce identical queued work. When overloaded, drop obsolete quote jobs and lower-priority background work before delaying current MC.
- Keep provider usage timestamps. If usage reporting is stale or unavailable, retain a conservative local cap and headroom; do not claim guaranteed project-wide protection from a local-only meter.

For the market-data budget left after existing transaction/service reserves, begin with 75% protected for MC/price and their required discovery/repair, 20% for other live metrics, 5% for history enrichment. These are proposed allocation weights, not higher quotas. MC can borrow unused capacity; background work cannot consume its protected reserve. Recalculation from events already received costs no extra provider requests and should proceed immediately.

**3. Rank work by metric, then coin relevance**

Market cap remains first even if a holder scan or historical analysis concerns a younger coin. Within MC, use this order:

1. The coin currently open, and active positions being displayed, regardless of age.
2. Visible coins under 24 hours; boost newly launched, newly migrated and rapidly trading coins.
3. Other visible coins and pinned/watchlist coins; a busy older coin can enter the fastest group.
4. Other tracked coins under 24 hours, weighted by activity and time since last valid observation.
5. Older background coins, with rotating coverage and a bounded refresh deadline when providers are healthy.

Track age from the verified launch/mint creation event. Keep token birth, first pool creation and first observation separate. A new pool for an old token must not make it a newborn. Unknown age gets provisional discovery attention, then resolution; crossing 24 hours should gradually reduce priority rather than abruptly stop updates.

The universe must be explicit: every discovered young coin enters the registry, including coins that current scoring/nursery filters never adopt. Cheap shared discovery covers that registry; premium subscriptions cover only the admitted hot set. Publish how many young coins exist, how many have fresh MC, and which venues remain unsupported. A fast result for five coins is not broad coverage.

**4. Build one authoritative metric state**

Introduce a small shared state module, for example `server/metricstate.js`, alongside the existing collector. Each field carries value, unit, source, pool, slot where available, source event time, receive time, sequence, commitment, supply basis and coverage status. Start with MC/price, then migrate other fields incrementally.

Rules:

- Accept an update only if it advances the relevant observation and meets validation. A newer HTTP response is not necessarily newer source data. Separate wall-clock receipt time from source age.
- Preserve multiple source observations; select using freshness, validity, coverage and confidence. Reject a late snapshot that would overwrite a newer streamed value. Do not blanket-ignore every lower-ranked source for 20–30 seconds.
- Slot numbers alone cannot order all same-slot updates. Use provider write versions or transaction/instruction identities when available; otherwise retain per-stream ordering and reconcile ambiguity. Do not compare unrelated source counters as if they shared a clock.
- Keep processed observations provisional. Reconcile against confirmed state, replace orphaned values, and repair history after gaps. Confirmation must not require an HTTP request for every tick.
- Distinguish `observedAt`, `changedAt` and stream health. A quiet pool can have an old last trade and a healthy current subscription. A heartbeat is not a fresh price observation.
- Preserve null/unknown, observed zero and invalid distinctly. Do not reject every zero through truthiness checks, and do not convert missing provider results to zero.
- Use full precision internally and round only for display. Every page, header, sparkline endpoint, watchlist and position reads the same normalized value and provenance.

**5. Make market cap fast and consistent**

Use `USD price × explicitly defined supply`. Store FDV separately. A mint supply is not automatically circulating supply; a one-billion-token fallback is acceptable only for a verified protocol/supply basis and must remain identified as such. Refresh supply on burns/mints and reconcile cached metadata. Avoid treating chart alignment multipliers as unquestioned financial truth.

Reuse the existing curve and pool decoders, validating each against current protocol layouts and fixtures. Bonding curves, PumpSwap, Raydium CPMM/CLMM, Orca and Meteora need their own math, decimals, fees and reserve treatment. Do not generalize one pool's reserve ratio to every venue. Pick a canonical liquid pool with hysteresis; switch on migration or genuine liquidity changes without oscillating between incompatible prices.

Keep price/account traffic in the dedicated worker. Share a ref-counted subscription per account across views and clients, while retaining separate sockets for price and heavy trade/holder traffic. The existing multiplexers need listener ownership and reference counts before more consumers reuse them.

Bootstrap immediately from a consistent account snapshot instead of waiting for a second trade: the current curve path emits only after a SOL reserve delta. On opening a coin, display the last known value with its age, then replace it with the fresh snapshot/stream result. Subscribe, buffer, snapshot and reconcile ordering to avoid a gap between snapshot and stream.

Do not pair arbitrary old/new vault balances. Preserve slot/context through pool callbacks, validate both sides, and reconcile mismatches. Treat reserve-derived prices as state quotes; reserve deltas alone cannot prove exact trade size or buy/sell counts, especially with multiple swaps, transfers or liquidity changes in one slot.

The direct worker currently publishes before the main-thread extreme-price guard executes. Move shared price validation into the worker path too, so direct chart delivery and the main stream accept the same values. A quarantined observation should not already be on screen.

Migration events must trigger immediate venue rediscovery, invalidate curve authority and subscribe to the new pool. Stop presenting the final curve price as current; retain it as historical until a pool price is available. Add supported non-Pump venues to the worker incrementally after decoder verification.

Use one healthy SOL/USD source for all SOL-denominated prices, with an independent fallback. Revalue interested coins when SOL changes even if their token pool is quiet. Preserve the age of both inputs. Do not produce fake trades or volume from USD conversion updates.

**6. Refresh every other number from the cheapest accurate dependency**

These are initial healthy-feed targets to benchmark, not guaranteed upstream freshness. Event targets refer to receiving a valid relevant observation; provider-indexed data may arrive later.

| Metric | Preferred update method | Initial target for open or visible young coins | Limits and correctness |
|---|---|---|---|
| Market cap, price | Pool/curve state stream plus supply and quote conversion | Open coin: ingest-to-paint p95 ≤250 ms; visible young rows ≤500 ms. Aim for event-to-screen p95 under 1 second where provider lag permits. | Measure upstream delay separately; provisional until confirmed. |
| Price change, distance from ATH, multiples | Recompute from shared price and historical anchors | Same UI update as MC | Distinguish observed peak from verified lifetime ATH; missing history stays explicit. |
| Unrealized PnL and position value | Shared price plus actual position ledger | Same UI update as MC | Realized PnL requires fills; executable exit value requires depth/quotes. MC ratios alone are not reliable if supply changes. |
| Bonding progress | Protocol curve state | Same event; publish within 250–500 ms | Use actual completion/reserves and protocol rules, not one permanent MC threshold. |
| Liquidity and depth | Valid pool state; provider snapshot where unavailable | State-derived 250–500 ms; indexed fallback typically 5–15 s request cadence | Virtual curve reserves, total pool value and executable liquidity are different quantities. |
| Volume, buys, sells, net flow, trade count | Decode and deduplicate actual swap events once | Publish accumulated changes every 250–500 ms | Account updates are not trades. Separate transactions from swap legs. |
| Unique traders and makers | Rolling event-time wallet sets/counts | 0.5–1 s publication | Maintain expiration counts; bounded rings must not silently undercount a full window. |
| Holders, top 10, dev holdings | Existing snapshot plus account deltas for small selected coins | 0.5–1 s after a valid balance change | Wallet count differs from token-account count; exclude known pools according to documented semantics. |
| Holder metrics outside live coverage | Batched provider snapshots | 10–30 s hot; 30–120 s colder, quota permitting | Large holder scans stay out of the price worker; cached values retain age. |
| Sniper/bundle/insider counts and share | Persist launch classification once; update classified wallets' balances | 1–5 s for known tracked groups | Labels are heuristics, transfers matter, missing launch history stays incomplete. |
| Dev sold, notable wallet moves | Existing confirmed trade/balance evidence | Push on evidence, generally 1–2 s after ingestion | A token transfer alone does not establish a sale. |
| Fees paid | Actual decoded transaction fee data | 1–5 s incremental publication | Count a transaction once under a documented attribution rule; label observation coverage. |
| Mint/freeze authority and supply metadata | Mint/account events; infrequent repair | Event-driven; 5–30 min fallback | Do not repeatedly request immutable metadata. Token-2022 extensions need compatible decoding. |
| LP lock, risk score, paid DEX status, boosts | Relevant event or external provider | Usually 30–120 s; push immediately when a changed result arrives | No assumption of a faster source than the provider supplies. Recompute local scores when dependencies change. |
| Age and elapsed time | Local clock using verified origin | Every second | No network request. |
| Ranking and AI scores | Local ranking from updated inputs; AI only on material new evidence | Local rank roughly every second; AI source-dependent | Neither may block or consume the MC reserve. |

Keep rolling 5m/1h/24h metrics with event-time buckets, late-event repair and expiration even when no new trade arrives. Reuse the journal and candle workers. Identify swaps by signature plus instruction/inner-instruction or other verified event identity; `(slot, wallet)` can collapse legitimate multiple trades.

Track covered intervals and gaps. For a coin younger than 24h, its 24h volume can mean its complete lifetime within that window; do not invent a price from before launch to report a 24h percentage. On incomplete histories, use a clearly scoped provider aggregate or mark partial coverage; do not double-count a snapshot plus overlapping events. Extend the actual 24h buys/sells data model rather than continuing the existing UI's 1h-count substitution.

**7. Expand coverage without multiplying requests**

Start with approximately 5–10 premium state streams, then expand by measured cost per coin and fresh coverage per credit. This is an experiment size, not a permanent limit. Busy coins can consume far more bytes than quiet ones, so a fixed coin count cannot enforce a credit budget.

Visible demand comes from a shared interest registry with short renewable leases, viewport visibility and page visibility. Background tabs release optional subscriptions. Multiple tabs/users looking at one coin share the same upstream work; one user closing a view cannot cancel another's subscription. Fairness limits prevent a large client from exhausting the global hot set.

For batch-only coverage, initial reconciliation cadences are 5–15 seconds for visible young coins, 15–30 seconds for other active young coins, and 30–120 seconds for older background coins. Already-running shared event feeds continue to update all ages immediately. These cadences lengthen explicitly under quota pressure or large population; report actual freshness rather than hiding the tradeoff.

Use `getMultipleAccounts` for up to 100 accounts per request, with only the needed fields, for bootstrap and repair. Group compatible account layouts/commitments when slicing. This is one multi-account RPC call, not a JSON batch of 100 billable individual calls. [Solana reference](https://solana.com/docs/rpc/http/getmultipleaccounts)

Test `accountSubscribe` slicing on the deployed provider before depending on savings; official references differ on support. If unavailable, retain complete base64 state and tune the watched set. Gzip/Brotli to the browser reduces client traffic, not Helius's uncompressed billing basis.

DexScreener supports 30 token addresses per batch and documents 300 requests/minute for that endpoint. Keep conservative headroom and endpoint-family limits, including lower-limit metadata endpoints. Example: 120 coins require four calls; a five-second sweep is 48 calls/minute before other work. This is request capacity arithmetic, not proof of five-second source freshness. [DEX Screener reference](https://docs.dexscreener.com/api/reference)

Jupiter Price V3 accepts 50 mints and omits unsupported prices. Current documented Price/Tokens/Swap quotas are shared; reserve capacity for existing swap/quote consumers. Blix also uses `datapi.jup.ag` and legacy `lite-api` paths: verify their support, scope and freshness separately rather than assigning the documented public API contract to undocumented endpoints. [Jupiter Price](https://developers.jup.ag/docs/price), [rate limits](https://developers.jup.ag/docs/portal/rate-limits)

Prefer the current chain feeds, snapshots and free discovery first. PumpPortal creation/migration are free, but its token/account trade streams are paid. Enhanced Helius streams, Parsed Streams or mainnet LaserStream are optional alternatives only after eligibility and a concrete cost comparison; none is a prerequisite for this plan. [PumpPortal](https://pumpportal.fun/data-api/real-time/), [Helius plans](https://www.helius.dev/docs/billing/plans)

**8. Remove delivery and rendering delay**

Extend existing SSE with a compact metric-delta event, keyed by mint, field version and source observation. Reuse the per-mint external-store pattern in `livepx.ts`. Send only changes to interested clients; transmit MC promptly and coalesce lower-priority field updates over 100–250 ms. Render changed cells on the next animation frame instead of rebuilding entire tables.

Keep heavy holder sorting, database aggregation, history and AI outside the price worker. Profile Discover and the reported synchronous jobs before choosing what to move or incrementally cache. Backpressure must be bounded: a slow browser receives the latest state and resynchronizes, rather than accumulating an unlimited queue of obsolete prices. Trade journals retain required events separately from coalesced display state.

On stream reconnect, send an authoritative snapshot plus subsequent versioned deltas. Preserve observation timestamps through `apicache.js`, server caches and browser polling. A stale-cache return or failed refresh must never advance source freshness. Test proxy flush behavior and actual production transport; a local fast worker does not prove a remote phone sees it quickly.

**9. Implementation order and gates**

| Phase | Concrete work | Exit condition |
|---|---|---|
| 1 — Baseline and inventory | Map every displayed metric/source and Helius caller; inspect production instance/config without revealing keys. Extend `bench-live.mjs` to measure source observation → ingest → state → SSE → browser paint. | Per-venue and per-age baseline; current quota, external consumers and coverage gaps known. No paid benchmark streams. |
| 2 — Budget correctness | Update `heliuskeys.js`, `helius.js`, `solana.js`, `txtrade.js`, `snipe.js` and worker metering; share project limits and reservations. | Budget exhaustion, restart, concurrent consumers and key-switch accounting pass. Credentials unchanged. |
| 3 — Market cap correctness and speed | Introduce canonical state, age/interest scheduler and reference-counted registry; unify fast worker/main validation and freshness ordering; bootstrap, migration, SOL and supply updates. | Selected coin/visible-young MC meets measured latency targets without higher permitted spend or price regressions. |
| 4 — Other metrics | Reuse decoded swaps and holder deltas; implement coverage-aware rolling windows and incremental derived metrics. | Accurate counts and field freshness in replay fixtures and selected live samples; no MC latency regression. |
| 5 — All relevant screens | Adopt compact deltas in Pulse, Discover, coin pages, feed cards, watchlists and positions; retain snapshot repair. | Same coin shows consistent MC across screens; real browser paint measurements pass at desktop/mobile widths. |
| 6 — Controlled expansion | Shadow the new state using existing input events, then enable 5–10 coins, a full visible list, and broader young-coin coverage. | A 24-hour soak includes peak activity, midnight, reconnects and quota pressure; usage/latency within gates. |

Feature flags independently control the canonical MC path, additional subscriptions and metric deltas. Roll back by stopping new registrations and restoring the prior display path while retaining recorded data and usage accounting. No reset of budget files, credential changes or restart of the user's terminal is part of rollback.

**10. Verification that matters**

- Compare the same event/pool/slot, supply basis and commitment. Do not label differences between latest execution price and pool spot price as decoder errors without checking semantics.
- Exercise duplicate/out-of-order messages, same-slot multiple swaps, failed transactions, processed forks, missing/zero values, burns, decimal differences and Token-2022 cases.
- Exercise migration while visible, pool replacement, reserve pairing, quiet-but-connected coins, source disagreement and stale snapshots arriving after fresh ticks.
- Verify holder bootstrap ordering, account closure/transfer handling, multiple token accounts per wallet and large-holder fallback. Audit off-curve owner classification; an off-curve address alone is not proof that holdings should be discarded.
- Verify every rolling window against deterministic event fixtures, including reconnect gaps, late trades, multiple swap legs and expiration during silence. Label approximations explicitly.
- Simulate 429, unavailable usage reporting, network disconnection, worker failure, provider stalls, depleted credits, restarts and multiple instances. MC retains priority and no request bypasses admission.
- Measure p50/p95/p99 ingestion-to-paint and observable source lag, per-field age, fresh under-24h coverage, older-coin coverage, event-loop delay, bytes, estimated/actual credits and retry/drop rates.
- Start with existing relevant tests and `bench-live.mjs`; add focused tests for new scheduling, ordering, accounting and aggregation behavior. Do not start extra full-market collectors to test display speed.

Release criteria: no attributable budget breaches; no known stale overwrite or duplicate counting in fixtures; MC freshness targets met for the admitted hot set under the benchmark load; secondary-metric work does not degrade MC p95 by more than 10%; all stale/partial coverage remains visible; production user interface verified. Baseline determines the feasible maximum hot-set size and broader coverage cadence.

The intended result is more fresh numbers per credit: market cap reacts first, one event updates many dependent metrics, young coins receive the broadest attention, older coins retain service, and the app remains accurate when a provider or quota limits what can be known.


**Implementation record — 2026-10-10**

Implemented locally; frontend built. No deployment or production restart performed. Helius credentials and configured spending limits were not changed.

| Area | Implemented behavior |
|---|---|
| Shared accounting | Helius HTTP callers use one project governor; RPC method costs, in-flight reservations, actual history-row settlements, shared HTTP/WS aliases, priority reserves, monthly pacing, retry cooldowns and persisted usage. Identical/unknown-project keys cannot manufacture extra capacity. Project identity changes retain prior usage across restart. WebSocket payloads use UTF-8 byte counts. |
| Market cap | Shared per-field source timestamps, monotonic revisions, slot/sequence checks, stale-source fallback and common jump validation. Initial account observations publish without requiring a trade delta. Pool decoding checks owner and supported pair layout. SOL/supply changes revalue recent observations without inventing trades. |
| Scheduling | Ref-counted viewport interests with expiring session leases. Open coin first, young coins next, older coins retain reserved selection. Hidden tabs release interest. Default selected cohort is eight; rotation and 15-second existing watch leases can temporarily keep more than eight streams alive, bounded by the existing 64-coin fast-watch cap and shared spending governor. |
| Delivery | Existing SSE carries per-field deltas every 100 ms to interested sessions. Five-second snapshots repair reconnect/missed state. Partial deltas merge into existing fields; boot/revision ordering rejects older snapshots. Slow clients disconnect at bounded queued bytes. |
| Other numbers | Pulse/Discover/coin pages share current values for supported market cap, price, reserve estimates, 5m/1h/24h flow and holder fields. Indexed aggregates remain provider-paced; observed trade totals disclose partial coverage. Missing 24h counts no longer reuse 1h counts. Account-price updates no longer create candle trades or volume. |
| Estimates | Fee ledger preserves actual observed fees separately from interval coverage estimates, deduplicates signatures and expires legacy estimates correctly. Estimated fees update via SSE. Paper/real positions revalue known tokens with fresh price inputs; estimated holding/PnL is labeled. Missing balances remain unknown. Replay can override live prices while live metric updates are excluded for the replayed coin. |
| Provider pressure | Jupiter foreground/background consumers share pacing and 429 cooldowns. Failed refreshes retain the original observation age. Existing feeds and cached indexed fields serve the hot set without per-cell RPC requests. |

Controls read at server startup:

- `BLIX_METRIC_CANONICAL=0`: use prior price arbitration while continuing to record shared state; omit canonical MC/price fields from client metric payloads.
- `BLIX_METRIC_SUBSCRIPTIONS=0`: stop registrations introduced by the visibility scheduler; existing chart/feed collection remains under its own lifecycle and the shared budget.
- `BLIX_METRIC_DELTAS=0`: disable metric delta/snapshot delivery, retaining existing display feeds.
- `BLIX_METRIC_HOT_COINS`: selected cohort size, default 8, bounded 1–64. This is not a spending allowance.

Keep the usage ledger during rollback. Browser reload clears previously received metric state when switching display flags. No credential rotation or usage reset is required.

Verification:

- 102 targeted metric, priority, accounting, restart, fee, ordering, interest and position-valuation tests passed.
- 20 security tests passed.
- Real built frontend passed 1440px/390px browser checks: immediate MC/estimated fee deltas, partial-field merge, older revision rejection, stale source timestamps, hidden-tab release and active-coin interest.
- Isolated full-server smoke passed: startup, scoped SSE, snapshot epoch and invalid-mint filtering. It supplies the pre-existing legacy `fomo_traders` table expected by startup; it does not establish empty-database compatibility.
- TypeScript/production build passed. Browser performance checks passed the existing bundle/layout/error gates. Local screenshots and reports: `data/metric-check`, `data/performance-before`, `data/performance-after`.
- Original suite: 156/157 passed. `test/wallet-oauth.test.mjs:90` fails because Google member profile is null; reproduced separately in untouched auth/test code. New metric tests are included in `npm test` and also available through `npm run test:metrics`.

Remaining release work and scope limits:

- Production source-to-paint percentiles, cross-venue comparisons, actual credit reports and the 24-hour peak/reconnect/midnight soak are not measured by mocked local tests. No claim that the latency targets or maximum safe hot-set size have been achieved.
- The governor coordinates consumers in this server process and its worker, with restart persistence. It does not provide atomic accounting across independent server instances or other applications using the key. Those require a shared external governor or explicit external-use allowance.
- Existing provider cadences still govern slow risk/authority/LP/DEX/AI data. No paid provider integration or unsupported protocol decoder was added. Broader subscriptions must expand only after observing cost and freshness.
- Arbitrary token decimals/Token-2022 decoding, complete confirmed account rollback, complete rolling-window gap reconstruction and a full replacement of legacy snapshot producers remain broader protocol work. New observed-window fields stay partial; account prices stay provisional; existing journal confirmation/repair continues.
- Fee coverage is a sampling estimate, not a verified census. Open-position marks are estimates, not executable exit quotes, and a new price does not refresh the age of an old balance.


**Discover follow-up — 2026-10-10**

Top, Trending, New pairs and Bonded now share one number resolver between table rows and open hover cards. Market cap, verified token price, liquidity, windowed volume/change/counts, holders and fees update without waiting for list refresh. Partial/estimated figures carry markers and source-age descriptions; missing counts/insiders remain unknown. The 24h table uses 24h counts and headings; count filters explicitly retain their supported 1h window. Other-chain rows cannot receive same-address Solana prices or fees. Existing hover positioning, pointer aiming, scrolling and animation are preserved.

Verified: 66/66 browser fixture checks at 1440px/390px, eight number-resolution tests, production build and existing performance gates. Full suite 266/267: same unrelated Google-profile failure. Screenshots/report: `data/discover-metrics/after`. No extra provider polling or Helius configuration changes. Production provider latency remains unmeasured.
