# Trading backend outage, October 10, 2026 (Edmonton)

All timestamps below are UTC, October 11.

## Evidence

- Around 03:08: public landing page and `/start` returned 200; `/app` returned 503; the backend origin returned Cloudflare 502. Local port 4420 refused connections.
- VM root disk: 45 GB, 100% used, approximately 6 MB available. `blix.service` repeatedly exited with status 1; 29 restarts were observed before recovery.
- `data/radar.db-wal`: 16,214,085,632 bytes; main database: 3,532,849,152 bytes. Backup directory used 9.7 GB. Application error files were empty during the full-disk condition.
- The existing checkpoint worker used PASSIVE checkpoints only. Following recovery, the WAL grew past 700 MB within roughly a minute despite checkpoint activity. An explicit SQLite TRUNCATE checkpoint reclaimed it successfully while the app was running.

## Recovery

- Cleared the package download cache.
- Stopped only the remote `blix` service.
- Removed 63,074 regenerable token-image cache files older than two days (760,867,535 bytes). No databases, WAL files, backups, or member uploads were deleted.
- Ran SQLite `PRAGMA wal_checkpoint(TRUNCATE)` with the service stopped: result `(0, 0, 0)`.
- Restarted `blix`; local health returned 200, live trades resumed, and approximately 17 GB became available.

## Recurrence mitigation

`server/dbcheckpoint.js` now tries TRUNCATE after a complete passive checkpoint when the physical WAL exceeds 256 MiB. The checkpoint connection uses a zero lock-wait timeout and retries on a subsequent pass if another connection holds a lock. It reports WAL bytes, successful truncations, and errors in existing health statistics.

This is a cleanup trigger, not a hard file-size cap: long-running readers or active locks can defer truncation. The exact transaction timing that prevented WAL reuse before the outage was not established. A persistent lock or unrelated storage growth still requires monitoring.

The regression test uses a real SQLite reader holding a snapshot, verifies that it remains intact during checkpointing, releases it, observes truncation, and verifies existing and new writes.

Only `server/dbcheckpoint.js` was deployed. Server backup: `/opt/blix/data/deploy-backups/2026-10-11T03-17-13-451Z`. Other sessions' application changes were left untouched.

Post-deploy verification: checkpoint telemetry reported one successful automatic truncation, zero WAL bytes at that sample, and no last error; local health reported live trades at 61.2/s. The service reported zero restarts and the disk had 17 GB available. Public HTML requests returned `/` 200, `/app` 302 to `/start`, and `/start` 200. No authenticated browser trading flow or transaction was exercised.

Reference: [SQLite WAL checkpoint behavior](https://www.sqlite.org/pragma.html#pragma_wal_checkpoint).

## Additional safeguards deployed at 03:32 UTC

- `blix-storage-guard.timer` starts at boot and runs a standalone check one minute after the previous check finishes. It remains available if the trading process or its checkpoint worker fails.
- Known radar, candle, and feed-history WAL files over 256 MiB receive a SQLite TRUNCATE attempt in an isolated child process with a 20-second timeout. Database files and WALs are never manually deleted. Lock contention defers cleanup.
- Generated token-image cache is checked hourly against a 2 GiB budget. Below 8 GiB free, cleanup runs each check until the reserve is restored or eligible files are exhausted. Images younger than one hour, symlinks, nested directories, uploads, profiles, and backups are excluded.
- The daily database backup now requires room for twice the source database size plus a 6 GiB reserve before copying. The existing offsite backup also has a free-space admission check.
- Results are written to `data/storage-guard.json` and systemd journal. A failed operation or less than 6 GiB free produces a failed check. The existing `blix-alertwatch.timer` continues its independent disk monitoring.
- Three focused tests passed, covering pinned database snapshots, post-checkpoint writes, backup reserves, cache pressure, fresh images, and protected member files.
- Installed without restarting the trading service. First production run succeeded; timer enabled; 17 GB free; zero trading-service restarts; public homepage and signup remained available.

These safeguards reduce recurrence risk; they cannot guarantee unlimited storage or prevent every outage. Persistent read locks, large new datasets, and disk failure still require operational attention.
