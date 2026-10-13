# Metric provider research — 2026-10-10

Scope: Blix Trade market-cap-first updates, particularly coins younger than 24 hours. Public official documentation only; no credential inspection, live subscriptions, account changes, or application edits. Provider facts below were checked on 2026-10-10. Recommendations are engineering inferences, not measured guarantees.

## Findings that materially change the plan

- Helius standard WebSockets are **metered**, so replacing polling with unlimited subscriptions can increase consumption.
- PumpPortal token and account trade streams are **paid**; creation and migration events remain free.
- Jupiter Price, Tokens, and Swap requests now share the principal rate-limit bucket. Old advice about a separate Price bucket is obsolete.
- Direct state updates can accelerate price and market cap, but do not independently establish complete trade counts, volume, holder counts, or circulating supply.

## Helius: access and cost

Current standard tiers:

| Tier | Monthly USD | Monthly credits | RPC requests/s | DAS/enhanced requests/s |
|---|---:|---:|---:|---:|
| Free | 0 | 1M | 10 | 2 |
| Developer | 49 | 10M | 50 | 10 |
| Business | 499 | 100M | 200 | 50 |
| Professional | 999 | 200M | 500 | 100 |

Standard Solana WebSocket methods are included on every tier; Helius extensions require Developer or above. LaserStream gRPC mainnet requires Business or Professional. Legacy tiers differ. Business and Professional autoscaling is enabled by default: staying below requests-per-second alone does not prevent extra spend. These are published offerings, not evidence of the user's actual tier or remaining allowance. [Helius plans](https://www.helius.dev/docs/billing/plans)

Standard RPC calls cost 1 credit except separately listed methods; `getProgramAccounts` costs 10, DAS costs 10, and legacy Enhanced Transactions costs 100. Both standard and enhanced WSS, and LaserStream gRPC, cost **2 credits per 0.1 MB uncompressed**. Parsed Streams cost 1 credit per event. Preprocessed transactions cost 0.1 credit per message. Preconfirmations have a 10-credit/message price, with a minimum 300 credits per covered slot scheduled for October 14, 2026. Therefore none should be assumed free. [Helius credits](https://www.helius.dev/docs/billing/credits)

`getTransaction` and `getSignaturesForAddress` each cost 1 credit. `getTransactionsForAddress` full results cost 10 credits per 100 returned, rounded up with a 10-credit minimum; signatures-only costs 10 flat, and failed responses are free. A fixed 100-credit estimate is accurate for 1,000 returned full transactions, but overestimates smaller responses. [Helius credits](https://www.helius.dev/docs/billing/credits)

WSS concurrent connections: 5/150/250/1,000 for Free/Developer/Business/Professional. The general table lists 1,000 subscriptions per connection. Mainnet gRPC connections: 10 Business, 100 Professional. `429`, temporary server failures, and network failures require bounded backoff; Helius recommends approximately 1-second initial delay, exponential growth to 30 seconds, jitter, and five attempts. Check method-specific limits as well as generic limits. [Helius rate limits](https://www.helius.dev/docs/billing/rate-limits)

The unified mainnet WSS endpoint is `wss://mainnet.helius-rpc.com/?api-key=<existing-key>`. Connections cost 1 credit to open. Its standard methods and Helius extensions share LaserStream infrastructure. Helius also offers the Gatekeeper beta endpoint; benchmark it separately before considering adoption. `processed` is earliest and can roll back; `confirmed` is slower. Exact latency depends on execution, network, region, and load, so documentation's performance claims are not app latency guarantees. [Helius WSS](https://www.helius.dev/docs/rpc/websocket)

**Planning inference:** retain the exact existing key. Put HTTP requests, subscriptions, connection openings, and estimated uncompressed byte use behind one server-side budget governor. Reserve allowance for existing trading and other clients. Track aggregate usage, not just this feature's rate. If total external use cannot be observed, retain conservative headroom and explicitly acknowledge that a local limiter cannot guarantee project-wide limits. Do not enable autoscaling, purchase credits, change plans, or assume spare credits.

## Account updates and efficient repair

Solana `getMultipleAccounts` accepts at most 100 addresses, returns them in request order with slot context, and supports `commitment`, `minContextSlot`, `dataSlice`, and encoding. Use it for batched initial snapshots, periodic reconciliation, and reconnect repair. The 100-address facility is one RPC method; it is distinct from sending 100 independent JSON-RPC calls in a batch. [Solana getMultipleAccounts](https://solana.com/docs/rpc/http/getmultipleaccounts)

Solana's current `accountSubscribe` reference lists account data/lamport notifications, commitment selection, encoding, and `dataSlice`; notifications include slot context. [Solana accountSubscribe](https://solana.com/docs/rpc/websocket/accountsubscribe)

Helius's method-specific reference does not currently document `dataSlice`. **Compatibility assumption:** verify the deployed endpoint/SDK accepts slicing and produces the expected bytes before budgeting savings. Never assume compressed wire size equals billed size. [Helius accountSubscribe](https://www.helius.dev/docs/api-reference/rpc/websocket/accountsubscribe)

**Planning inference:** stream only the curve/pool state needed to derive the active coin's price. Cache mint decimals and validated supply; refresh mint data when supply can change. Shared SOL/USD updates can revalue every SOL-quoted token without one new token request each. Use correct protocol decoders: reserve ratio math is not interchangeable across bonding curves, constant-product pools, concentrated-liquidity pools, and fee models. Multi-account updates must not combine arbitrary old/new reserves. Snapshot after reconnect, reject older slots, and deduplicate identical states; slot alone cannot distinguish all same-slot writes. A mint account subscription alone does not provide pool price.

## Optional Helius alternatives

LaserStream gRPC offers processed account/program state and up to 48 hours of replay. Standard WSS clients still need their own reconnect/recovery strategy; do not assume gRPC replay is automatically available over WSS. Account state exists after execution, so raw shreds/preprocessed transactions cannot directly supply final pool reserves. Mainnet gRPC is an option only when already eligible or separately approved; raw shreds require additional fees and operational work. **Recommendation:** optimize the existing state-to-screen path before pursuing pre-execution data for a metric display. [LaserStream](https://www.helius.dev/docs/laserstream)

Parsed Streams is generally available on all plans with the existing project key. It sends decoded transactions filtered by programs, accounts, instructions, and roles. Limits include 25 subscriptions/connection, 100 included accounts/filter, and 10 client messages/second with burst 20. Free has five connections; Developer ten. Each event costs one credit. **Inference:** benchmark narrow swap filters as an alternative for trade-derived metrics if raw decoding is expensive; never subscribe globally merely because access is included. Confirm desired protocol coverage and event shape before relying on it. [Parsed Streams reference](https://www.helius.dev/docs/api-reference/parsed-streams/overview)

## PumpPortal

`subscribeNewToken` and `subscribeMigration` are documented free. `subscribeTokenTrade` and `subscribeAccountTrade` cost **0.01 SOL per 10,000 events**, requiring a PumpPortal key and linked wallet funded with at least 0.02 SOL. Use one shared WebSocket, adding token/account subscriptions on it; repeatedly opening many concurrent sockets can cause temporary bans. It covers Pump.fun/PumpSwap creation, migration, and trading. Do not infer no-key trade access from older examples. Migration notification should trigger venue/pool rediscovery, not continued use of obsolete curve pricing. [PumpPortal real-time API](https://pumpportal.fun/data-api/real-time/)

PumpPortal describes its data as `processed` and claims typical delay below 100 ms behind gRPC when the consumer is in New York. That is a provider claim, not measured end-to-end latency for Blix Trade. Its FAQ advises no more than 5,000 addresses in one subscribe message. [PumpPortal FAQ](https://pumpportal.fun/FAQ/)

**Recommendation:** free discovery/migration may complement Helius, subject to current endpoint compatibility. Trade streams remain an explicit fee-bearing option. Never create/fund a wallet or enable paid streams as an incidental optimization. Since PumpPortal is a third-party service, it is primary documentation for its own API, not a Pump.fun protocol specification. [PumpPortal introduction](https://pumpportal.fun/)

## DEX Screener

The official reference documents `GET /tokens/v1/{chainId}/{tokenAddresses}` with up to 30 comma-separated addresses and 300 requests/minute. Pair lookups, search, and token-pair lookups also list 300/minute. The response can include price, transactions, volume, liquidity, market cap, FDV, and pair creation time; some fields are nullable. These are pair-level responses, so select/aggregate pools deliberately. The documentation does not establish a subsecond freshness SLA or guaranteed index delay. A successful HTTP response therefore does not prove fresh underlying data. [DEX Screener API](https://docs.dexscreener.com/api/reference)

**Inference:** batch reconciliation and broad secondary-metric coverage here; do not make it the sole fastest market-cap source. Share a conservative limiter across relevant endpoint families until their actual quota scope is verified. At 30 addresses/request, 120 coins need four calls per sweep. A two-second sweep means 120 requests/minute before discovery/retries; a one-second sweep means 240. That arithmetic is a capacity estimate, not permission to sustain the maximum or evidence that source data changes that often. Cache stable pool mappings and do not equate pair creation time with coin birth.

## Jupiter Price V3

Price V3 accepts up to 50 mint IDs and returns `usdPrice`, `decimals`, `blockId`, and `priceChange24h`. It derives prices from swaps plus reliability heuristics. Unreliable, illiquid, or untraded tokens may be omitted entirely; compare requested IDs with returned keys. Missing data is not zero and is not a reason to overwrite a newer valid state. These coverage limits make it unsuitable as the exclusive source for newly launched memecoins. [Jupiter Price](https://developers.jup.ag/docs/price)

Current limits are keyless 30 requests/minute; free keyed 60; Developer 600; Launch 3,000; Pro 9,000. A 60-second sliding window applies **per organisation**, not per key. Most requests, including Price, Tokens, and Swap, share one bucket; execution has a separate bucket. `x-ratelimit-remaining`, `x-ratelimit-current`, and `x-ratelimit-reset` can inform backoff. Reset time means one old request expires, not that the entire bucket empties. [Jupiter rate limits](https://developers.jup.ag/docs/portal/rate-limits)

**Inference:** poll a shared reliable quote-asset price plus batches of supported older tokens, respecting existing swap traffic. Do not assume an old separate Price bucket, create extra keys to evade limits, or treat 50 requested IDs as 50 covered coins. New paid plans are optional spending decisions; this research does not require them.

## Recommended decision order

1. Measure existing provider age, ingest lag, calculation delay, and browser paint lag separately. Re-rendering an old number faster does not improve data freshness.
2. Reserve first capacity for market cap. Within each metric class, prioritize selected/visible coins and age under 24 hours, then older coins with a guaranteed minimum service level.
3. Use one shared state/event ingestion layer, field-level provenance, timestamps, slot/sequence checks, and freshness deadlines. Derive price, market cap, change, and liquidity from the same valid update where possible.
4. Maintain age from a trustworthy creation timestamp; unknown birth time must be explicit. Use activity as a second priority signal so a hot older coin is not starved.
5. Stream narrow state changes for the hot set; batch snapshots and secondary data. Adapt the hot-set size and polling frequency to measured bytes/events and remaining credit budget.
6. Separate confirmed and provisional observations. Preserve last good values on failure; show stale/unknown honestly. Never relabel total-supply FDV as circulating market cap without a supply definition.
7. Only derive rolling volume/counts from complete, deduplicated swap history. Reconnect gaps and newly started observation windows need coverage flags or authoritative repair. Account changes alone do not identify all swaps.
8. Benchmark optional enhanced WSS, Parsed Streams, gRPC, or paid PumpPortal only when eligibility and budgets are established. No provider choice can guarantee every number subsecond under a fixed unknown quota.

## Unresolved facts before implementation

- Actual Helius tier, legacy terms, allowance remaining, other consumers, and spending settings; these were not inspected.
- Existing deployed pipeline's true provider latency, concurrency, per-field timestamps, token count, and hot-set event volume.
- Endpoint-specific account slicing and protocol decoder compatibility.
- Exact circulating-supply semantics for the displayed market cap.
- Provider coverage for new venues and newly migrated tokens.
- Real index freshness and replay/repair completeness under disconnects.

Public docs occasionally disagree: Helius Devnet eligibility and older WSS replay descriptions vary between pages. This plan relies on the consistent mainnet eligibility/billing references above and treats feature support as a capability check. No subscription or tier change was performed.
