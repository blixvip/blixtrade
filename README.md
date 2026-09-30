# Meme Radar

A local system that scans Solana memecoins around the clock, filters out likely scams, spots breakouts and rising narratives, writes AI market briefs, pushes alerts, and keeps score of how its calls actually did. Dashboard at http://localhost:4420.

It only watches and alerts. It never trades.

## Open it

Double-click **Meme Radar** on the Desktop. The radar also starts hidden at login so it keeps collecting data and scoring its signals.

From a terminal: `npm start` (radar + dashboard, foreground).

## How it works

1. **Discover.** Every pump.fun launch arrives live from PumpPortal (~1 per second). Launches wait 4 minutes, and only the ones that trade for real (mcap or 5-minute volume above your thresholds) are tracked. DexScreener profiles and boosts plus GeckoTerminal new and trending pools add coins every 90 seconds.
2. **Enrich.** Price, mcap, liquidity, volume, and buys vs sells from DexScreener every 30 seconds (hot coins) or 2 minutes (the rest).
3. **Safety.** RugCheck report per coin: mint/freeze authority, LP lock, holder concentration and more. Any "danger" risk blocks all positive signals.
4. **Score.** 0–100 from volume, buy pressure, acceleration, trend, liquidity, socials and boosts, multiplied by safety.
5. **Signals.** New launch taking off, pump.fun graduation, volume spike, momentum, market-cap milestones, and dump warnings on coins it already called. One alert per coin per scan.
6. **Narratives.** Theme detection (AI, dogs, cats, politics, brainrot…) on every launch and tracked coin. Heat, launch share, lift vs the previous hours, and emerging words.
7. **Briefs.** Every hour Claude writes a market brief from the radar's data (uses this PC's Claude Code login). "Ask Claude about this coin" on any coin.
8. **Wallets.** Follow any wallet: its swaps on every Solana DEX are read from the chain (public RPC, or your own RPC URL in Settings), with PnL, win rate and open positions. A buy by a wallet you follow is an alert; two followed wallets buying the same coin is a Smart money alert. Coins that run 3x+ are studied for their early buyers and top holders; wallets that keep showing up are ranked under Smart money and auto-followed (up to a limit). Every coin shows holders, top-10 share, insider networks, how much the dev still holds, and the dev's other launches. Dev sells and rugs raise warnings, and serial launchers (4+ coins in 6h) never get positive alerts. "Scan recent trades" looks at any wallet without following it.
9. **Updates.** Live dashboard, desktop notifications, Discord webhook and Telegram bot (Settings).
10. **Track record.** Every signal is re-priced at 15 minutes, 1 hour, 6 hours and 24 hours, plus its 24h peak, so you can see hit rates per signal type before trusting it.

## Files

- `server/engine.js` — discovery, enrichment, safety, scoring, signals, outcomes
- `server/narratives.js` — themes, heat, emerging words
- `server/ai.js` — Claude briefs and coin explanations
- `server/wallets.js` — watchlist, wallet PnL, smart-money discovery
- `server/solana.js` — RPC pacing and swap parsing
- `server/notify.js` — Discord and Telegram
- `bin/supervise.mjs` — restarts the radar if it ever exits
- `server/server.js` — API, live event stream, brief schedule
- `public/` — dashboard
- `data/` — SQLite database, settings (webhooks), logs. Not committed.

Node 24, no dependencies.
