# Shared Jupiter quota

Token discovery and market statistics previously called the keyless host directly, independently of the quotes/price limiter. All API Tokens v2, Price and quote reads now use `jupiterGet`, including its API key, in-flight deduplication, cache and provider cooldown.

The queue prioritizes quotes over waiting background jobs. Only 40% of each process's configured rolling-minute budget is available to background reads. Requests that cannot fit within a 12-second queue deadline are deferred locally. Deferrals do not mark Jupiter down or issue network requests. Request spacing and a rolling-minute cap both apply.

Jupiter's `x-ratelimit-remaining`, `x-ratelimit-reset` and `Retry-After` headers stop requests before or during exhaustion. A headerless 429 conservatively pauses requests for one minute. Cached responses remain usable during the pause without renewing their timestamp.

`jupiterRequestsPerMinute` is a per-process allocation, not a separate upstream quota. Final allocation: production 20/minute, local development 5/minute (25 combined, below the Free organisation allowance of 60). Default is 24; hard ceilings are 54 with a key and 27 keyless. A 429 halves that instance's effective ceiling. After ten minutes without a 429, the ceiling recovers by one request/minute per minute, never exceeding its allocation. Other applications sharing the organisation must be counted separately. No local limiter can guarantee against provider firewall limits or independent external usage.

DEX Screener's existing public integration remains available without a key. No new paid provider, trade, or subscription is introduced. `datapi.jup.ag` chart/history is a separate existing transport and is not reclassified as a Developer Platform API endpoint.

Validation covers priority ordering, shared cooldown, rate-limit response headers, sustained rolling-window load, reserved quote capacity, caching/deduplication, and both formerly independent token callers. The discovery regression advances beyond an earlier quote test's shared cooldown and expires the new response cache before checking a 429.

Reference: https://developers.jup.ag/docs/portal/rate-limits

## Release verification

Production deployment backed up and hash-checked only `jupiter.js`, `jupdisc.js`, `sources.js` and `settings.js`; existing unrelated work was preserved. Jupiter returned fresh CNLeaks window statistics after deployment. Initial allocation of production 40/local 10 still saw 429 responses below the documented allowance. A read-only diagnostic reported `x-ratelimit-current: 5`, remaining zero and a short reset interval; the cause of that stricter observed constraint is not established. Allocations were reduced to 20/5 and adaptive slowdown added. Successful responses and cooldown recovery verify functionality, not a guarantee that external usage or stricter provider limits can never cause another 429.

Final validation: all 379 tests passed. Production and local budgets read back as 20 and 5. During the final 30-second production observation, successful Jupiter responses increased from 7 to 16, failures stayed at zero, and health remained `ok`. Release backup: `/opt/blix/data/deploy-backups/jupiter-shared-20261013T000350Z`.
