# Blix trade API (v1)

Trading for bots with their own wallet: Blix builds the transaction, the bot signs it, Blix sends it. Blix never
holds a private key. Phase 1 of `Blix Trade API Plan.docx` (2026-10-11): pump.fun bonding curve and PumpSwap pools,
hand-built; other launchpads and pools follow through Jupiter routing (Phase 2).

Public docs: https://blixvip.com/trade-api (and `/pump-fun-trading-api`, `/gmgn-trading-api`, `/axiom-trading-api`,
`/fomo-trading-api`). Signed in, `/trade-api` shows the member's keys (create, copy once, revoke).

## Where it runs

| Piece | Where | File |
|---|---|---|
| Keys, pacing, usage ledger, the HTTP routes, the WebSocket | the page server (`:4421`, `bin/supervise.mjs`), never the radar's thread | `server/tradeapi.js`, `server/ws-lite.js` |
| Quote, build, send, status: the fee rail and pump.fun instructions | the wallet service (blix-vault, `127.0.0.1:4470`, service token) | `blix-vault/server/local.js` (+ routes in `server.js`) |
| Every trade / launch / migration as events for the stream | the radar (`:4420`), local-only `GET /api/v1/firehose`, costs nothing while no one listens | `server/firehose.js` |
| Edge: a bot's key passes straight to the server; WebSocket 101 passed through; signed-in `/trade-api` keys panel | Cloudflare Worker | `worker/index.js` (`apiKeyRequest`, `tradeApiAccess`) |
| Member rules: a member may manage `/api/v1/keys` and read `/api/v1/usage` | | `server/access.js` |

A key route (`Authorization: Bearer blx_live_…`) reaches the page server only with the Worker's edge key (or from the
machine itself); it is paced per key at the edge (600/min), per IP (`request-guard.js`) and per key here.

## Routes

Member (signed in on blixvip.com, Worker-vouched):

- `GET /api/v1/keys` · `POST /api/v1/keys {label?}` (the key is in the answer once) · `DELETE /api/v1/keys/<id>`
- `GET /api/v1/usage` — last 30 days per key, last 50 trades, totals

Key:

- `GET /api/v1/me` — key, masked account, fee rate (100 bps, 80 if invited), limits
- `POST /api/v1/quote` · `POST /api/v1/trade/build` — body `{ wallet, mint, side, sol | pct | tokens, slippageBps?, priorityFeeSol?, tipSol? }`
- `POST /api/v1/trade/send` — `{ transaction (signed, base64), waitMs? }`
- `GET /api/v1/trade/<signature>`
- `GET /api/v1/stream` — WebSocket (`?key=` for browsers). Methods: `subscribeNewToken`, `subscribeTokenTrade {keys}`,
  `subscribeAccountTrade {keys}`, `subscribeMigration`, their `unsubscribe*` forms, `ping`. Events use PumpPortal's field names.

## The fee rail (why there is no free path)

`build` compiles `[computeLimit, computePrice, swap…, transfer(wallet → fee wallet, fee), transfer(wallet → Sender tip)]`
and remembers `sha256(message)` for 3 minutes. `send` parses the signed bytes, looks the message hash up (403 if unknown
or expired), verifies the ed25519 signature against the wallet the build was for, then sends and confirms exactly like
the vault's own trades (`chain.send` + `chain.confirm`). The confirmed trade is a `txs` row with `user_id = 0`,
`actor = api:<member email>`, `fee` set, so `feesSol` in the owner dashboard and `ref_earn` (40% to the inviter)
count it with no query changes. Fee = `feeFor(treasury, { referrer }, lamports)`: 2% (1.6% invited), skipped only while
the fee wallet is below rent (0.00089 SOL), as for every trade.

Limits (`tradeapi.js LIMITS`): 5 keys/member, 120 quotes+builds/min, 60 sends/min, 3 streams/key, 200 mints and 200
wallets per stream, 2 SOL per buy (`vault config.maxSolPerTrade`).

## Deploying

1. Vault: copy `blix-vault/server/{local,vault,server}.js` to `/opt/blix-live-vault/server/` (sudo, back the old ones
   up to `deploy-backups/`), `sudo systemctl restart blix-vault`; check `journalctl -u blix-vault -n 3` and
   `curl -H "authorization: Bearer <serviceToken>" 127.0.0.1:4470/v1/local/stats`.
2. Blix: `node bin/deploy-vm.mjs --no-web --only server/tradeapi.js server/ws-lite.js server/firehose.js server/webapp.js server/access.js server/server.js`
   (restarts the radar once; tell the other session first).
3. Worker: `cd worker && npx wrangler deploy`.
4. Smoke: sign in → `/trade-api` → create a key → `GET /api/v1/me`, `POST /api/v1/quote` for a live pump.fun coin,
   `wss://blixvip.com/api/v1/stream?key=…` + `subscribeNewToken`.

## Tests

- `blix-vault`: `node --test test/local.test.mjs` (orders checked; unknown / mis-signed / two-signature sends refused).
- `meme-radar`: `node --test test/tradeapi.test.mjs test/ws-lite.test.mjs` (keys, forwarding with trader + referrer,
  pacing, access rules; WebSocket framing + handshake).
- Live proof without spending: build a real trade for a funded wallet on a scratch vault and `simulateTransaction` it
  (`sigVerify: false`): see the session notes of 2026-10-12.

## Not yet

Jupiter-routed builds with Blix's fee (Phase 2), LaunchLab hand-built path, MCP trade tools (Phase 3), token creation
(Phase 4). A coin outside pump.fun/PumpSwap answers `409 { route: "unsupported" }`.
