# How Blix works, in depth

The long-form walk-through of every stage, file and operational detail. The [README](../README.md) is the short version.

## What you can and cannot trust

- **Signals are safety-screened.** Every alert type goes through one policy: RugCheck score at or above your minimum, no danger risks, not rugged, a pool someone could actually sell into, a believable price, and a dev who is not mass-launching. A followed wallet buying a coin that fails is stored as *unscreened wallet activity* with the reasons, shown on its own tab, and not pushed.
- **Prices from emptied pools are quarantined.** A pool with almost nothing in it keeps quoting a price nobody can trade at (one coin showed a $3 trillion market cap on $13 of liquidity). Those readings never feed peaks, multiples, charts, "winners" or narratives, and the coin is labelled *can't be sold*.
- **The track record is price moves, not profit.** It measures the price 15m / 1h / 6h / 24h after each alert from the radar's own readings: no fills, slippage, fees or position size. It leads with the median, counts each coin once by default, shows every rate as a count over the number actually checked, and counts a checkpoint taken on an emptied pool as 0x.
- **"Down 50%" is not "rugged".** A price fall is a dump. *RugCheck: rugged* and *Liquidity pulled* are separate, specific warnings.
- **Wallet PnL is split.** Realized profit, open positions at quoted prices, and what those positions could plausibly be sold for are three different numbers. Bags in emptied pools count as zero.
- **"Early wallets" is a heuristic.** Being early in coins that ran can also mean the wallet belongs to whoever ran them. Wallets that keep buying the same coins within two minutes of each other are treated as one actor.
- **AI output is labelled with what actually wrote it**, when, and from which sources. A read by Claude has no live X search and says so. Scouted narratives expire after 8 hours; only their coin prices keep refreshing.
- **Stablecoins, wrapped assets and tokenized stocks are not memecoins** and are kept out of signals, narratives, research and the track record.

The **Health** page lists every dependency (launch feed, prices, RPC, wallet stream, each AI, the research queue, alert delivery, backups) with its last success, last failure and what to do about it.

## Open it

Double-click **Blix** on the Desktop. The radar also starts hidden at login so it keeps collecting data and scoring its signals.

From a terminal: `npm start` (radar + dashboard, foreground).

## How it works

1. **Discover.** Every pump.fun launch arrives live from PumpPortal (~1 per second). Launches wait 4 minutes, and only the ones that trade for real (mcap or 5-minute volume above your thresholds) are tracked. DexScreener profiles and boosts plus GeckoTerminal new and trending pools add coins every 90 seconds.
2. **Enrich.** Price, mcap, liquidity, volume, and buys vs sells from DexScreener every 30 seconds (hot coins) or 2 minutes (the rest).
3. **Safety.** RugCheck report per coin: mint/freeze authority, LP lock, holder concentration and more. Any "danger" risk blocks all positive signals, as does a pool too small to sell into.
4. **Score.** 0–100 from volume, buy pressure, acceleration, trend, liquidity, socials and boosts, multiplied by safety.
5. **Signals.** New launch taking off, pump.fun graduation, volume spike, momentum, market-cap milestones, and dump warnings on coins it already called. One alert per coin per scan.
6. **Narratives.** Theme detection (AI, dogs, cats, politics, brainrot…) on every launch and tracked coin. Heat, launch share, lift vs the previous hours, and emerging words.
7. **Briefs.** Every hour Claude writes a market brief from the radar's data (uses this PC's Claude Code login). "Ask Claude about this coin" on any coin.
8. **Wallets.** Follow any wallet: its swaps on every Solana DEX are read from the chain (public RPC, or your own RPC URL in Settings), with PnL, win rate and open positions. A buy by a wallet you follow is an alert when the coin passes safety (otherwise it is filed as unscreened activity); two independent followed wallets buying the same coin raises a Followed wallets alert. Coins that run 3x+ are studied for their early buyers and top holders; wallets that keep showing up are ranked under Smart money and auto-followed (up to a limit). Every coin shows holders, top-10 share, insider networks, how much the dev still holds, and the dev's other launches. Dev sells, RugCheck rug flags and pulled liquidity raise warnings, and serial launchers (4+ coins in 6h) never get positive alerts. "Scan recent trades" looks at any wallet without following it.
9. **Fomo (free, on-chain).** Every coin and alert has a Buy on Fomo button (fomo.family/tokens/solana/<mint>; opens the Fomo app on your phone). Fomo pays its users' Solana fees, so its trades carry a Fomo fee-payer signature. Add one Fomo wallet (yours, or any trader's from fomowalletfinder.com) and the radar learns that fee payer from the wallet's trades, then reads the fee payer's transactions to see Fomo trades as they happen: what Fomo is buying, Fomo buyers/sellers per coin, the most profitable Fomo traders it has watched (auto-followed), and "Fomo crowd buying" alerts when 3+ Fomo traders buy a coin within 30 minutes. No API keys. On the free public RPC it samples Fomo trades; a custom RPC URL reads more of them.
10. **Research desk.** Coins close to bonding (60%+ of the ~440 SOL graduation mcap) and coins that bonded in the last 3 hours are researched automatically. The radar gathers the coin's metadata, website, X profile, linked tweet, Google News, copycat launches, holders and buy/sell flow, and Claude grades the narrative A–F with a written thesis, a ceiling estimate, catalysts and risks. A-grade calls become alerts. **Fast lane:** Grok, through this PC's Grok CLI login (`~/.grok/auth.json`, SuperGrok subscription, no API key), reads every candidate in about 8-12 seconds and searches X live for the coin's contract and ticker (who is posting, organic or botted). Strong reads (score 70+) get a second, deeper read from Claude. A free Groq key is an optional fallback. The queue only holds as many coins as can be read while they still matter (about 90 minutes of reads); the rest are dropped rather than left to go stale, and the next read always goes to the waiting coin with the most live traction. When Grok is out of credits the radar says so, falls back to Groq (if a key is saved) or Claude, and switches back by itself. See the Research tab.
11. **Grok's picks (Picks tab).** Coins that score well on the fast read get a deep read from grok-4.7 (up to 10 X/web searches): buy, watch or avoid, with conviction, an entry and an exit plan (take-profit ladder, stop, trailing stop, time stop). Buy calls (conviction above the threshold, default 75) alert you and are paper-traded against DexScreener every minute. Every graded coin is tracked for 24h (peak, low, 1h/6h/24h), building a scorecard by grade, action, read type, X buzz, stage and narrative. A **self-review** has Grok study that scorecard and rewrite its playbook (rules injected into every later read) and tune its own thresholds within bounds. A **narrative scout** runs every 45 minutes: Grok searches X and the web for narratives starting to run, matches them to the radar's coins, researches the lead coins, and scores 24h later whether the narrative ran. Alert-only: nothing is ever traded.
12. **Updates.** Live dashboard, desktop notifications, Discord webhook and Telegram bot (Settings).
13. **Track record.** Every signal is re-priced at 15 minutes, 1 hour, 6 hours and 24 hours, plus its 24h peak from sellable prices, so you can see per signal type how the alerts did before trusting them. See "What you can and cannot trust" above for what these numbers mean.

## Files

- `server/engine.js` — discovery, enrichment, safety, scoring, signals, outcomes
- `server/narratives.js` — themes, heat, emerging words
- `server/ai.js` — Claude briefs and coin explanations
- `server/wallets.js` — watchlist, wallet PnL, smart-money discovery
- `server/solana.js` — RPC pacing and swap parsing
- `server/fomo.js` — Fomo links, fee-payer learning, on-chain Fomo trade flow, Fomo trader ranking
- `server/notify.js` — Discord and Telegram
- `bin/supervise.mjs` — restarts the radar if it ever exits
- `server/server.js` — API, live event stream, brief schedule
- `public/` — dashboard
- `server/quality.js` — the trust rules: sellable prices, asset classes, the safety policy, link checks, honest statistics
- `server/health.js` — last success / last failure for everything the radar depends on
- `test/radar.test.mjs` — `npm test`
- `data/` — SQLite database, settings (webhooks), logs, `backups/`. Not committed.

## Running, sleeping, backups, moving

- **It runs on this PC and nowhere else.** The radar starts hidden at login and restarts itself if it crashes. While the PC sleeps or is off, nothing is watched: launches, wallet buys and alert checkpoints in that window are missed, and the gap is logged on the Health page. Closing the dashboard window does not stop the radar, but browser pop-ups stop, so set up Discord or Telegram to keep receiving alerts.
- **It only answers this PC.** The server listens on localhost, refuses requests that come from another site or hostname, and the page runs under a strict content policy. Saved webhook URLs, bot tokens and keys are never sent back to the page. There is no login, so do not expose port 4420 to your network or the internet; for remote access use the Discord/Telegram alerts, or put the dashboard behind a private VPN such as Tailscale.
- **Backups.** The database is copied to `data/backups/` once a day (the two newest copies are kept), or on demand from Settings. To restore, stop the radar and replace `data/radar.db` with a backup.
- **Moving to another PC.** Settings → Export gives one JSON file with your settings, followed wallets, alert rules and playbook (secrets only if you ask for them); Import loads it on the new machine. The Grok and Claude logins are per-PC and need doing again there.
- **Wallet tracking speed.** With no RPC URL the free public Solana RPC is used: followed wallets are streamed over its websocket (trades arrive within seconds) but each transaction then has to be read at about one a second, and heavy use gets cut off. Busy wallets fall behind and the skipped transactions are counted on the Wallets and Health pages. A free Helius RPC URL in Settings removes most of that.

`RADAR_DATA=<folder>` and `RADAR_PORT=<port>` run a second copy against its own data without touching the real one.

Node 24, no dependencies.
