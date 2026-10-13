# Wallet tracker integration — 2026-10-12

Published a shared member wallet list across Top traders, Fomo profiles, wallet profiles, Blix profiles, the tracker manager, and the activity tape. Track actions use `/api/wtrack/wallets`; social Follow remains independent.

The bottom Wallets control opens a nonmodal window. Drag its title bar, resize its bottom corner, or use arrow keys on either handle (Shift for larger steps). Position and size persist; viewport changes clamp the window on screen. Escape closes it; the header provides reset and full-page controls.

Find traders combines Fomo and pump.fun, supports period/source/search/group selection, paginates 40 rows, and includes followed Blix people, wallets, and Fomo handles. Handles without a known wallet resolve only when selected. Wallet duplicates share one tracked state. Provider failures retain available rows with a retry message.

Validation: TypeScript and production build passed; 15 tracker/window tests passed. Browser checks at 1440 and 390 pixels covered leaderboard add/remove, duplicate wallets, failed saves and retry, following/handle resolution, groups, manager/profile synchronization, drag, keyboard resize, persisted position, navigation, Escape, and visitor sign-in. The live member API loaded 150 Fomo and 100 pump.fun entries (116 known unique wallets); a diagnostic member successfully tracked a real leaderboard wallet and saw it in Manager. Diagnostic entries were removed.

Release: `data/tracker-feature-release/`. The frozen build preserved the already-live responsive balance header, SOL/USDC controls, and thesis editor, while excluding unrelated unpublished launch tools, auto-claim UI, and Feed loading edits. Source workspace edits were preserved. Assets were checked by SHA-256, published before an atomic index swap under the deployment lock, and checked over HTTP. No backend restart.

Live index SHA-256: `bd35422fceb11bf9bb09857265672c32206b27d6e62293ef224bd54df4f3d558`.
Rollback index: `/opt/blix/data/deploy-backups/tracker-feature-web-2026-10-12T21-42-34Z/index.html`.

Re-run browser fixtures with `data/runtime/node.exe scripts/tracker-browser-check.mjs`; set `BLIX_URL` for the target. `BLIX_ORIGIN_HOST=localhost:4421` supports the protected origin through an owned SSH tunnel. Fixtures intercept mutations and never place trades.

Drag verification follow-up: `scripts/tracker-drag-check.mjs` passed against the deployed build with desktop mouse input (1440×950) and browser-emulated touch input (390×844). Verified drag/drop, release without sticking, corner shrink/grow, touch cancellation and subsequent drag, screen-edge clamping, viewport narrowing, keyboard resize, reset, Escape, reopening, and persistence after reload. Screenshots/results: `data/tracker-drag-check/`. The first resize assertion fired beneath the loading overlay; waiting for that overlay to disappear resolved the test timing issue. No product-code change was needed.

Visual refresh (2026-10-12): researched the official Axiom wallet-monitor and wallet-add documentation and inspected its monitor screenshot. Added a scoped graphite/sapphire tracker palette; mint/pink buy/sell labels; consistent wallet color/icon marks; labeled priority chips; readable type independent of page density; a structured feed; compact Manager actions; color/icon preview and checked swatches; and larger drag/resize targets. Mobile tabs now fit the window. Saved metadata invalidates old list reads, preventing stale polls from restoring a previous color.

References: https://docs.axiom.trade/wallet-tracking/monitor-wallets and https://docs.axiom.trade/wallet-tracking/adding-wallets .

Validation: production build and TypeScript passed; 15 tracker/window tests passed. Browser integration passed at 1440 and 390 px. `scripts/tracker-style-check.mjs` verified color/icon/group edits, feed synchronization, and persistence after reload; `scripts/tracker-drag-check.mjs` verified mouse and emulated touch drag, resize, boundaries, cancellation, reopening, and reload on the live origin. Screenshots: `data/tracker-style-check/live-*.png`.

The concurrent frontend release included this implementation plus its Coin/Side work. The stale isolated index was NOT published over that release. Live tracker JS matched the tested snapshot after normalizing hashed dependency names, and the tracker CSS matched byte-for-byte (`WalletTracker-D8JC4vUT.css`, SHA-256 `046c1e0ee4b8ae6f7ba53e8159eefdd4a10882a9e6e92f67d7a5bf3f55510155`). Live index at verification: `51ac59eef534617e90a78136538974e181b0eb9b01d4c3036c7d90be037f90c4`. Details: `data/tracker-color-release/live-verification.json`.


## Right-side docking follow-up

Dragging the title into the rightmost 72px on desktop previews a sidebar; releasing docks the tracker beside the current page. The page shrinks through a shared flex workspace, with header/footer still reachable. A left divider resizes 360–640px while retaining at least 440px for page content. Dragging away undocks; the header also has an accessible dock/undock button. Mode and width persist across close/reopen, navigation, and reload. Below 960px the same tracker floats, restoring the dock when widened. Cancelled gestures never dock.

Validation: TypeScript and production build; 16 tracker/backend unit tests; desktop/mobile browser integration; dedicated docking tests covering real pointer edge drop, preview, page geometry, resize and keyboard resize, drag-to-undock, close/reopen, reload, navigation, mobile fallback, and pointer cancellation. Saved colors/icon/group and trader selection regression checks pass. Screenshots in data/tracker-dock-check and data/tracker-style-check/live-docked-*.png.

A concurrent release published the docking implementation before this task's guarded publish. The publisher refused the stale index as intended. Verified the actual deployed tracker JavaScript matches the tested implementation after hashed import normalization, then ran docking tests on live origin assets through the authenticated loopback test path. No older build overwritten.


## Left/right docking and motion

Both workspace edges now offer a drop preview. Left placement accounts for the navigation rail; the bar stays beside page content. The title has direct left/right controls, and the divider moves to the inside edge. Side and width survive navigation, reopen and refresh; existing saved right docks migrate without changes. Mobile still floats.

Snapping interpolates the panel and page geometry over 300ms with a fast ease-out; drop targets expand over 180ms. Pointer dragging/resizing stays immediate. Starting another gesture cancels pending snap motion, and reduced-motion preferences disable movement animations.

Validation: TypeScript, production build, 17 unit tests; mouse/touch dragging; left and right drop gestures, both dividers, keyboard resizing, persistence, navigation, cancelled gestures, animation interruption and reduced motion. Desktop/mobile screenshots and color/group/icon save checks pass. Deployed with index guard and backup to /opt/blix/data/deploy-backups/tracker-sides-web-2026-10-12T22-59-55Z. Release manifest: data/tracker-sides-release/release.json.
