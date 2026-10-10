# Feed chat

Feed opens at the bottom and follows imported messages. Scrolling upward or Pause holds a snapshot of message contents and quotes; arrivals wait behind Jump to live. Edits retain identity, sequence and timestamp. Replies have their own namespaced event IDs and reference their parent. Late imports are labeled with their source posting time. Pins have a compact header rather than sorting ahead of the timeline.

Token details open alongside the conversation. Unindexed tokens have pump.fun and DexScreener links; full coin-page errors retain the Feed return route. This is a read-only imported stream, with no composer.

`GET /api/feed/history` is member-only. `before` pages by immutable sequence; `after` resumes by revision and includes edits without inventing a new event. `sources`, Fomo `groups`, `q`, `sender`, `token`, and `thread` narrow the results. Queries return at most 200 rows. The separate SQLite `data/feed-history.db` retains 50,000 events across restarts and 100,000 compact replay IDs. It starts with available source snapshots and accumulates observed history; it cannot retrieve posts the providers never supplied. Retention gaps are disclosed.

Browser state retains at most 3,000 live rows, with bounded history and reading snapshots. The measured virtual list renders the viewport plus overscan. Prepending history preserves the visible message and offset. Shared per-token quotes carry a timestamp; source position PnL is separate from call performance. Source filters persist; history search does not modify those preferences. Focus chat hides terminal chrome; rankings remain accessible on mobile.

The stream sends named heartbeats every five seconds. Heartbeats update the watchdog independently of message traffic; reconnects fetch from the saved revision. Raw and compact provider records normalize to the same display identity before comparison.

Validation: `npm test`, `npm run test:feed-chat`, and `node scripts/feed-chat-live-check.mjs`. Browser coverage includes frozen edits, prepend anchoring, reconnect replay, source-ID collisions, separate replies, 3,500-message retention, quiet heartbeats, token fallback, focus mode and desktop/mobile overflow. Live checks use a synthetic read-only member proof and perform no financial actions.

Initial backend rollback: `/opt/blix/data/deploy-backups/2026-10-09T02-44-03-730Z`. The release was staged against deployed backend sources to preserve concurrent work. Keep the history database when rolling code back.
