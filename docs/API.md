# Blix API

Blix serves JSON over plain HTTP on `http://localhost:4420` and a live Server-Sent-Events stream. The dashboard in `public/` is just a client of this API, so anything the UI shows you can read from a script, a bot, or your own front end.

- Base URL: `http://localhost:4420` (override with `RADAR_PORT`).
- Auth: none on localhost. Through the remote tunnel every `/api/*` call needs the install's remote key as the `blix_key` cookie (set once by opening `/?key=…`).
- Origin policy: requests must come from `localhost` / `127.0.0.1` or the configured `publicHost`. Other `Host` or `Origin` headers are refused.
- Responses are cached server-side for 1–60 s where noted, so polling faster than that returns the same body.
- `<mint>` is a base58 Solana mint address. `<address>` is a wallet address.

## Live stream

`GET /api/stream` — `text/event-stream`. Reconnect with `Last-Event-ID` is not required; the stream is stateless.

| event | payload | when |
|---|---|---|
| `tick` | `{ tracking, launchesPerHour, tradesPerSecond, … }` | every few seconds |
| `launch` | a new pump.fun launch (mint, name, symbol, dev, uri) | sub-second after the chain |
| `live` | live price / mcap / flow updates for coins on the Pulse | per trade batch |
| `signal` | a new signal (type, mint, symbol, text, safety, score) | when raised |
| `mig` | a pump.fun graduation / migration | when detected |
| `pic` | coin image became available | when fetched |
| `paper` | paper desk changed (fill, sell, rule, stop) | on change |
| `brief` | a new market brief | hourly or on demand |

```bash
curl -N http://localhost:4420/api/stream
```

```js
const es = new EventSource("http://localhost:4420/api/stream");
es.addEventListener("signal", (e) => console.log(JSON.parse(e.data)));
```

## Market

| Method | Path | Returns | Cache |
|---|---|---|---|
| GET | `/api/overview` | KPIs: launches/hr, tracking, pass-safety, signals 24h, graduations, health issues | 3 s |
| GET | `/api/pulse` | The four Pulse columns (new, final stretch, migrated, running) with per-coin stats and AI verdicts | live |
| GET | `/api/bot` | `{ anti, day, live, scout, early }`: anti-slop filter state, today's desk, live counters, narrative scout, early-launch model | 1 s |
| GET | `/api/tokens?…` | Coins table. Query params mirror the Coins page filters (sort, safety, stage, search) | 5 s |
| GET | `/api/token/<mint>` | Full coin detail: price history, safety report, holders summary, socials, research, signals | – |
| GET | `/api/token/<mint>/explain` | Claude's explanation of the coin from the radar's data | – |
| POST | `/api/token/<mint>/classify` | `{ themes: [..] \| null, assetClass: "memecoin"\|"stable"\|… \| null }`. Your correction wins over the automatic classification; `null` puts it back on automatic | – |
| GET | `/api/holders/<mint>?top=25` | Live holder ledger: top holders tagged dev / sniper / bundle, each holder's position, top-10 share. 404 if the coin has not traded since start | – |
| GET | `/api/candles/<mint>?tf=5s\|15s\|1m\|5m\|15m\|1h` | Market-cap candles built from real trades, with volume | – |
| GET | `/api/quote?mint=<mint>&side=buy\|sell&amount=<sol or tokens>&slip=<bps>` | A real Jupiter quote: out amount, price impact, route | – |

## Signals, narratives, briefs

| Method | Path | Returns | Cache |
|---|---|---|---|
| GET | `/api/signals?…` | Signals feed. Params: `type`, `safety=passed\|unscreened\|all`, `group=coin`, `limit` | 3 s |
| GET | `/api/narratives` | Themes with heat, launch share, lift vs previous hours, emerging words, lead coins | 20 s |
| GET | `/api/clusters` | Narrative bursts (same word / same X post within minutes) and Grok's calls on them | 2 s |
| GET | `/api/briefs` | Last 20 market briefs | – |
| POST | `/api/brief` | Write a brief now | – |
| GET | `/api/events` | Last 80 system events | – |

## Research and picks

| Method | Path | Returns | Cache |
|---|---|---|---|
| GET | `/api/research` | Research desk status: providers, queue, reads this hour, narratives the AI rates | 6 s |
| GET | `/api/research/<mint>` | The coin's reads: first read, deep read, grade, thesis, plan, sources | – |
| POST | `/api/research/<mint>` | Queue the coin for a fresh read at top priority. Adopts a coin from the launch feed if the radar is not tracking it yet | – |
| GET | `/api/triage` | The first-read gate's record | 30 s |
| GET | `/api/picks` | Picks scorecard: by stage, by AI call, by reason, by day, running result | 8 s |
| GET | `/api/picks/all` | Every pick with entry, exit, peak, rule result | 3 s |
| POST | `/api/picks/review` | Start a self-review (Grok studies the scorecard and rewrites the playbook) | – |
| POST | `/api/picks/scout` | Run the narrative scout now. `{ started, why }` | – |

## Paper desk

Nothing is ever bought. Positions are filled at the real Jupiter quote (`/quoted`, `/sellq`) or at the radar's last price (`/api/paper`, `/sell`).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/paper` | – | The desk: open and closed positions, today's PnL, risk guard |
| POST | `/api/paper/quoted` | `{ mint, sol, slip?, rule? }` | Open at the real quote |
| POST | `/api/paper` | `{ mint, sol, rule? }` | Open at the last price |
| GET | `/api/paper/<id>/preview?pct=100` | – | What selling would return at the real quote |
| POST | `/api/paper/<id>/sellq` | `{ pct?, why? }` | Sell all or part at the real quote |
| POST | `/api/paper/<id>/sell` | `{ pct?, why? }` | Sell at the last price |
| POST | `/api/paper/<id>/rule` | `{ tp?, trail?, stop?, timeStop? }` | Change the position's exit rule |
| DELETE | `/api/paper/<id>` | – | Forget a closed position |

## Wallets and Fomo

| Method | Path | Body / params | Returns |
|---|---|---|---|
| GET | `/api/wallets` | – | Followed wallets with PnL, smart-money ranking, recent activity, RPC tracking stats |
| POST | `/api/wallets` | `{ address, label? }` | Follow a wallet |
| GET | `/api/wallet/<address>` | – | Wallet detail: swaps, realized / open / sellable PnL, positions, linked wallets, alert rule |
| POST | `/api/wallet/<address>` | `{ scan: true }` · `{ follow: true, label? }` · `{ label?, muted? … }` | Scan without following · follow · update |
| DELETE | `/api/wallet/<address>` | – | Unfollow |
| GET | `/api/fomo` | – | Fomo overview: learned fee payer, what Fomo is buying, top Fomo traders |
| POST | `/api/fomo/trader` | `{ wallet, handle? }` | Mark a wallet as a Fomo wallet (teaches the fee payer) |

## Track record, health, ops

| Method | Path | Returns |
|---|---|---|
| GET | `/api/perf` | Track record per signal type: checked, up 20 %+, down 50 %+, unsellable, median, capped average, worst, reached 2x. 60 s cache |
| GET | `/api/health` | Every dependency with last success, last failure, what to do. 4 s cache |
| GET | `/api/settings` | Public settings (secrets never returned) |
| POST | `/api/settings` | `{ settings: {...}, clear: ["discordWebhook", …] }` |
| POST | `/api/test-notify` · `/api/test-grok` · `/api/test-fast` | Test a destination or provider with the body's values, without saving |
| GET | `/api/alerts` | Alert rules (mute / quiet / cooldown), destinations, last 80 deliveries |
| POST | `/api/alerts` | `{ scope: "coin"\|"wallet"\|"type", target, effect, note }` or `{ clear: true, scope, target }` |
| DELETE | `/api/alerts/<id>` | Remove a rule |
| GET | `/api/export?secrets=1` | One JSON file: settings, wallets, rules, playbook (secrets only with `secrets=1`) |
| POST | `/api/import` | The export file |
| GET · POST | `/api/backup` | List backups · write one now |
| POST | `/api/repair` | Rebuild derived tables from snapshots |
| GET | `/api/remote-link` | Local only: the tunnel URL with the remote key |

## Errors

Errors are JSON `{ error: "human sentence" }` with 4xx/5xx status. Rate-limited upstreams (public RPC, DexScreener) are reported on `/api/health`, not as request errors.

## Building on it

- A Discord bot that forwards `signal` events with your own filter: subscribe to `/api/stream`, drop anything with `safety < 70`, post the rest.
- Your own Pulse column: read `/api/pulse`, apply your filter, render. The columns are plain arrays of coin objects.
- A backtest: `/api/picks/all` + `/api/perf` give every call with entry, peak and exits.
- A different model: `server/fast.js` and `server/research.js` call a single `read(prompt, tools)`; swap the transport.
