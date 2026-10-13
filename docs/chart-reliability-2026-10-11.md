# Chart reliability audit — 2026-10-11

Fixed and tested:
- Reject nonfinite/nonpositive prices, invalid OHLC ranges, bad/future timestamps, malformed volume before candle ingestion/rendering.
- Sort and deduplicate provider/browser-cache/restored candle snapshots. Duplicate bars replace snapshots; never double volume.
- Preserve the last valid Blix chart while an empty or malformed response retries.
- Validate trade batches before they reach the chart/header; malformed fast-stream JSON cannot interrupt updates or suppress the main feed.
- Stale TV polls no longer overwrite the live candle they already skipped during merging.
- Fomo per-token prices require valid supply before being shown as market cap.
- All-history no longer allocates discarded flat bars across long gaps; work scales with real candles.
- A rejected older prefetch no longer deletes a newer cached request.

Verification: 20 Node tests; TypeScript and Vite build; real chart renderer at 1440 and 390 px, first-day Blix and older-token TV modes, malformed/reversed/duplicate rows, empty-response recovery, invalid/valid stream trades, stale polls and timeframe switches. Screenshots: data/chart-audit/{blix,tv}-{1440,390}.png.

Reproduce: node --no-warnings --test test/chart-data.test.mjs test/journal.test.mjs test/pool-identity.test.mjs. Browser fixtures: node scripts/chart-audit-check.mjs blix (then tv); BLIX_CHART_DIST can override the frozen build path.

The ingestion regression failed before the fix with Infinity and NaN timestamps in the live book. Genuine large price moves remain valid. Finite but incorrect upstream prices still require source/quote validation; no guarantee against every future provider bug.

Concurrent work: preserved the other session's chart-level fixes. Release snapshot under data/chart-audit/release; compared backend and live index hashes under deploy.lock before shipping. Another session's new Pulse hover-card work remains in the main workspace; it is not part of this incident release. Backend rollback handled by bin/deploy-vm.mjs.

Deployment verified: backend active; public site HTTP 200; 67cat API returned 442 ordered Jupiter candles. Deployed index SHA matches frozen build. Backup: /opt/blix/data/deploy-backups/2026-10-11T04-38-10-518Z. Detailed evidence: data/chart-audit/production-check.json.

## Follow-up hardening

Deployed 2026-10-11 04:57 UTC. Backup: /opt/blix/data/deploy-backups/2026-10-11T04-57-42-710Z.

- Failed journal transactions retain their entire batch and discard rolled-back identity caches. Counters advance only after commit. Reproduced lost trades with a real SQLite abort trigger before fixing it.
- Journal lock waits are capped at 25 ms, restoring the original timeout afterward. A competing-writer regression previously blocked 5,466 ms; the complete fixed test took 73 ms and retained the trade for retry. This is a local fault-injection measurement, not a claim about all live trade latency.
- Journal ingress rejects invalid time/volume. Late trades within one second cannot rewind the close. Restart snapshots validate, sort, deduplicate, and bound restored data.
- Fast-stream heartbeats and watchdogs recover silent connections, including connections that never delivered their first message. Closed streams and old callbacks cannot update a newly opened chart. Retry/poll timers are cancelled on cleanup.
- Main-stream malformed JSON and malformed batch containers are ignored. Background return immediately reconnects a stale main stream.
- Mini charts validate raw candles, retain good history through empty responses, and release streams on hover close. Main/mini loaders bound malformed partial-response retries. Hover-prefetch failures cannot evict newer requests.
- Added chart, stream, checkpoint, storage, and pool-identity regressions to the default test command.

Validation: npm test — 286/286; TypeScript and Vite build; real charts at 1440/390 px in Blix, TV, and mini-chart modes; fake-clock silent-stream recovery, malformed JSON, closed-stream events, bounded partial retries, empty responses, live updates, and timeframe switches. BLIX_CHART_DIST=data/chart-followup/release/web/dist BLIX_CHART_FAULTS=1 node scripts/chart-audit-check.mjs blix (then tv; mini without faults).

Production: deployed build hash matches; public site HTTP 200; database and both trade feeds report OK. Remaining observed limits: provider allowance exhausted for dedicated fast RPC, triggering the existing market-feed fallback; responsiveness still reports a 3-second background early-model job. No paid quota increases or trading actions taken. A browser probe through an SSH-forwarded port could not establish its verification tunnel; no live end-to-end latency claim is made. Read-only production health verified directly over SSH. Evidence: data/chart-followup/{full-test-final.log,production-check.json}.
