# Hosted site independence — 2026-10-11

Customer requests now always use `https://origin.blixvip.com`, the remote VM's named Cloudflare tunnel. The Worker no longer reads `origin:pc` or the mutable main-origin registry to choose a backend. Authenticated legacy PC registrations receive `ignored: server-only`; a quick tunnel cannot register as the main production origin.

The production Worker was downloaded and only its routing/error handling patched. This preserved the already published SEO modules, assets, bindings and secrets, including concurrent work absent from the local checkout. Deployment checks refuse a changed live bundle. The original modules are retained in `data/server-only/live-worker.multipart`.

Latest deployed Worker SHA-256: `c598a4657f005b45e3e998ecb8d49ebe00493bab9b8620c7aac06dfc01c9c767`.

## Verification

- The new routing tests fail against the previous production bundle and pass against the patched production bundle and local source. They cover former PC routes, POSTs, SSE, stale registrations, KV outages, and retryable JSON errors on upstream disconnects.
- Full existing suite plus initial routing regressions: 289 passed. After adding the outage-response case: 20 focused Worker/security/SEO tests passed, and all four routing cases passed against the production bundle.
- Authenticated public-site account, Fomo feed, Pump feed and X endpoints returned 200 in Aside. Account remained signed in. No real trade, withdrawal or token launch was submitted.
- VM-only SSE probe passed before and after a service restart. After restart, Fomo and Pump updates advanced, the market stream delivered 155 price events and 120 live updates, and the final Fomo response was 830 ms old with no error and `via: here`.
- The server's Fomo token renewed during inspection, from expired to 57 minutes remaining. Its independent login setting was already enabled. Direct probes confirmed all three PC token/feed/coin relay endpoints ignore relay writes under that setting.
- `blix`, `cloudflared`, and `blix-vault` are enabled and active. Watchdog, storage guard, nightly cloud backup and wallet backup timers are enabled. The cloud backup sink is configured; latest backup service result was successful. Disk had approximately 17 GB free.
- Checkpoint startup grace now measures time since that worker starts, retaining the existing two-minute production grace and allowing tests to exercise truncation without sleeping two minutes. The focused regression passed. VM deployment backup: `/opt/blix/data/deploy-backups/2026-10-11T05-33-12-265Z`.

Evidence: `data/server-only/deployment.json`, `tests-final.log`, `live-check.json`, and `live-check-after-restart.json`. Reusable read-only VM probe: `scripts/server-only-live-check.mjs`.

## Remaining limits

PC independence is not a guarantee of uninterrupted service or provider performance. X tracking currently uses FxTwitter on the VM; fast signed-in X tracking requires a server-side X login and reader support. Grok is installed but disabled by saved settings, Claude has no server login, and Gemini/fast RPC allowances have been rate limited or exhausted. These settings and budgets were not increased. The work verifies live feeds and account reads, not execution of a real-money transaction or prolonged load capacity.

The PC and Warp were never shut down or restarted. Failure of PC routing was tested with an unreachable PC origin in the actual Worker router, then removed from production entirely. Independent server collection was verified directly on the VM.
