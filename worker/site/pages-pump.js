// pump.fun pages: the hub, the scanner, bot, terminal, analytics, signals, MCP, SDK/CLI, websocket, Python and
// JavaScript recipes, wallet tracker, rug checker and the launchpad comparisons. One page per search intent.
import { F, FACT, START, DEV_CTA, SIGNIN_DEV, DISCORD, COMMUNITY, NOT_AFFILIATED, RISK, CHECKED, BASE, N_ENDPOINTS, N_TOOLS, MCP_SETUP, code, table, facts, steps, bullets, callout, links, page, compare, ext } from "./pagekit.js";

const PUMP_FEES = table(["What", "pump.fun fee", "Checked"], [
  ["Creating a coin", "Free; the network fee for the create (and the first buy) is about 0.025 SOL", CHECKED],
  ["Trading on the bonding curve", "1.25% of each trade: 0.95% protocol, 0.30% to the creator", CHECKED],
  ["Graduation", "0.015 SOL when the curve completes", CHECKED],
  ["Trading on PumpSwap after graduation", "Tiered by market cap, from 0.95% just after graduation down to 0.05% for large coins", CHECKED],
]);
const CURVE = `<p>Every pump.fun coin has 1,000,000,000 tokens. 793,100,000 of them sell along a bonding curve that starts at 30 virtual SOL against 1.073 billion virtual tokens; the market cap in SOL is <code>virtualSolReserves ÷ virtualTokenReserves × 1,000,000,000</code>, and progress is <code>1 − realTokenReserves ÷ 793,100,000</code>. When the 793.1 million are gone (about 411 SOL of market cap) the coin graduates to a PumpSwap pool and trades there.</p>`;
const MORE = links("More pump.fun pages", [
  ["/pump-fun-scanner", "pump.fun scanner", "Every launch, bonding progress, holders and AI ratings, live."],
  ["/pump-fun-trading-bot", "pump.fun trading bot", "What a bot can and cannot do, and how BLIX trades pump.fun in one click."],
  ["/pump-fun-signals", "pump.fun signals and alerts", "Launch alerts, dump warnings, dev sells, smart-wallet buys."],
  ["/pump-fun-wallet-tracker", "pump.fun wallet tracker", "Any wallet from the chain; whale and dev wallets; profit per wallet."],
  ["/pump-fun-rug-checker", "pump.fun rug checker", "Bundles, snipers, dev history, authority and liquidity checks."],
  ["/pump-fun-api", "pump.fun API", "Launches, trades, holders and candles as JSON, free."],
  ["/pump-fun-mcp", "pump.fun MCP server", "Give Claude, Cursor or Codex live pump.fun data."],
  ["/create-pump-fun-coin", "Create a pump.fun coin", "Launch from one screen with your Blix wallet."],
]);

// ---------- /pump-fun ----------
const hub = page({
  path: "/pump-fun", crumb: "pump.fun", eyebrow: `pump.fun guide · checked ${CHECKED}`,
  title: "pump.fun: How It Works, Fees, and How to Trade It | BLIX",
  description: "pump.fun explained: the bonding curve, fees in 2026, graduation to PumpSwap, creator rewards, and how to find, check and trade pump.fun coins with BLIX.",
  h1: "pump.fun, explained for traders",
  lede: `pump.fun is the Solana launchpad where anyone can create a memecoin for free and trade it on a bonding curve until it graduates to a pool. Thousands of coins launch there every day; a handful run, most go to zero within the hour. This page explains how the curve, the fees and graduation work as of ${CHECKED}, and how <a href="/">BLIX</a>, an AI memecoin terminal, shows every pump.fun coin live so you can find the runners and skip the rugs.`,
  body: `${START("Trade pump.fun on BLIX")}
${facts([FACT.price, FACT.fee, FACT.speed, FACT.ai, FACT.safety, FACT.launch])}
<h2 id="how">How a pump.fun coin works</h2>
${CURVE}
<p>Buyers on the curve pay 1.25% a trade, part of which goes to the coin's creator. Since January 2026 a creator can split that fee with up to ten wallets, or launch a "cashback coin" that pays all of it back to traders; the choice is locked at launch.</p>
<h2 id="fees">pump.fun fees in 2026</h2>
${PUMP_FEES}
<p>These are pump.fun's own fees. A terminal adds its own on top: BLIX takes 2% a trade (1.6% with an invite); the network's priority fee is set per trade so your swap lands fast.</p>
${F.pulse("Every pump.fun coin, live, in three columns")}
${F.holders("Who holds it: dev, snipers, bundles")}
${F.rating("The AI reads every coin")}
${F.trade("Buy and sell pump.fun coins in one click")}
${F.launch()}
${MORE}
${NOT_AFFILIATED("pump.fun")}${RISK}`,
  faq: [
    ["Is pump.fun free?", `Creating a coin is free apart from Solana's network fee (about 0.025 SOL when you include a first buy). Trading on the bonding curve costs 1.25% a trade, and graduation costs 0.015 SOL. After graduation PumpSwap's fee is tiered by market cap.`],
    ["What does it mean when a pump.fun coin graduates?", `The bonding curve sold all 793.1 million tokens it had (about 411 SOL of market cap). The coin moves to a PumpSwap pool and trades like any Solana token. BLIX lists coins approaching that point in the Final stretch column and keeps following them after the move.`],
    ["How do I find good pump.fun coins?", `Start with the Final stretch and Migrated columns rather than brand-new launches: coins there have buyers. Then look at the holder panel (dev share, snipers, bundles, top 10) and the AI rating before you buy. The <a href="/pump-fun-scanner">pump.fun scanner page</a> walks through it.`],
    ["Can I trade pump.fun coins on BLIX?", `Yes, with real SOL from your Blix wallet, or in paper mode first. Buys and sells are routed through Jupiter in one click from any list or chart.`],
    ["Does BLIX show pump.fun creator rewards?", `Yes. If you launched a coin from BLIX, the Create page shows what you have earned from its trades and lets you claim it.`],
  ],
});

// ---------- /pump-fun-scanner ----------
const scanner = page({
  path: "/pump-fun-scanner", crumb: "pump.fun scanner",
  title: "pump.fun Scanner: New Coins, Bonding, Holders & AI (Free) | BLIX",
  description: "Free pump.fun scanner: every new coin live, bonding curve progress, holders with snipers and bundles, dev history and an AI rating per coin.",
  h1: "pump.fun scanner with AI ratings",
  lede: `A pump.fun scanner has one job: show you every coin the moment it exists and tell you fast which ones deserve a second look. BLIX lists every pump.fun launch about a second after the chain, follows its bonding curve, volume, holders and traders live, and puts an AI rating and a rug check on each row. It is free, runs in the browser, and the same screen lets you buy in one click with real SOL or in paper mode.`,
  body: `${START("Open the scanner")}
${facts([FACT.speed, ["Columns", "New pairs, Final stretch, Migrated"], ["Per coin", "Market cap, volume, buys and sells, holders, age, dev, snipers, bundles"], FACT.ai, FACT.safety, FACT.price])}
${F.pulse("What the scanner shows")}
<h2 id="read">How to scan pump.fun coins in 30 seconds</h2>
${steps([
    "Watch <b>Final stretch</b> first: a coin close to graduating already has buyers, which is more than most launches ever get.",
    "Open the coin. The holder panel shows the dev's share and whether the dev sold, the sniper and bundle share, and the top-10 share. A dev holding a big share, or bundles above 20%, is a reason to pass.",
    "Check the AI rating and the one-line reason. A low rating with \"11 same-ticker launches this hour\" tells you it is a copy.",
    "Look at who is in it: known traders' faces on the chart and the Fomo and pump.fun leaderboard wallets in the holder list.",
    "Set your size once, and buy in one click if it holds up, or paper-buy it to see what you would have done.",
  ])}
${F.holders()}
${F.rating()}
${F.discover("Beyond pump.fun: trending and surging coins")}
<h2 id="vs">A scanner versus a terminal</h2>
<p>Most pump.fun scanners are a list with filters. BLIX is a terminal: the list, the chart with the traders on it, the holder ledger, the rug check, the AI read and the buy button are one screen, so finding a coin and acting on it is one motion. If you only want the data, the same scanner is available as a <a href="/pump-fun-api">free API</a> and an <a href="/pump-fun-mcp">MCP server</a> for AI agents.</p>
${MORE}
${NOT_AFFILIATED("pump.fun")}${RISK}`,
  faq: [
    ["What is the best free pump.fun scanner?", `BLIX is free and shows every pump.fun coin live with bonding progress, holders, snipers, bundles, dev history and an AI rating, and lets you trade from the same screen. Sign in with Google and it is on screen.`],
    ["How fast does the scanner see new coins?", `About a second after the coin is created on chain, often less. Prices and bonding progress update several times a second while the coin trades.`],
    ["Can the scanner tell a rug from a runner?", `It shows the signs: the dev's share and history, bundles and snipers, top-holder concentration, locked or pulled liquidity, and a rating that updates as the coin trades. No scanner can promise a coin will run; BLIX makes the setup obvious before you buy.`],
    ["Does it scan coins that are not on pump.fun?", `Yes. Discover covers trending, surging, new and bonded coins across Solana, including Raydium LaunchLab (the program behind letsbonk.fun) launches and pools on PumpSwap, Raydium and Meteora.`],
    ["Is there a pump.fun scanner API?", `Yes, with your account: the same scanner as JSON (<code>GET /api/pulse</code>) and a live stream. See <a href="/pump-fun-api">pump.fun API</a>.`],
  ],
});

// ---------- /pump-fun-trading-bot ----------
const bot = page({
  path: "/pump-fun-trading-bot", crumb: "pump.fun trading bot",
  title: "pump.fun Trading Bot: Sniper Bots vs an AI Terminal (2026) | BLIX",
  description: "pump.fun trading bots and snipers explained, why most lose, and how BLIX trades pump.fun in one click with an AI read, a rug check and automatic exits.",
  h1: "pump.fun trading bot: what works in 2026",
  lede: `Search "pump.fun bot" and you get sniper bots that buy every launch in the first block, Telegram bots that trade from chat, and copy-trade bots that mirror a wallet. Most of them lose money, because buying a coin in its first second is buying it before anyone knows what it is. BLIX takes the other route: an AI terminal that shows every pump.fun coin live with a rug check and a rating, lets you buy in one click with real SOL, and runs your take profit, stop loss and trailing stop for you. Read about the bots below, then try the terminal.`,
  body: `${START()}
${facts([FACT.fee, ["Execution", "One click from any list or chart, Jupiter routes, priority fee per trade"], ["Exits", "Take profit, stop loss, trailing stop, partial sells"], FACT.ai, FACT.safety, FACT.paper])}
<h2 id="kinds">The kinds of pump.fun bot</h2>
${table(["Bot", "What it does", "Where it goes wrong"], [
    ["Sniper bot", "Buys a coin in the same or the next block as its first trade", "Buys every rug too. On the holder panel these wallets are the \"snipers\"; serious buyers avoid coins full of them."],
    ["Bundler", "Launches a coin and buys it from many wallets in the same block", "It is the pattern BLIX flags as a bundle. Terminals and traders screen it out."],
    ["Telegram trading bot", "Buys and sells from a chat command with a wallet the bot holds", "A chat window shows nothing about the coin; fees are usually 1% plus the bot's own."],
    ["Copy-trade bot", "Mirrors a wallet's buys and sells", "Late by design, and the wallet you copy can be bundling against you."],
    ["AI terminal (BLIX)", "Shows every coin live with a rating and a rug check; you buy in one click; it runs your exits", "You still decide what to buy. That is the point."],
  ])}
${F.trade()}
<h2 id="exits">Let the terminal run the exit</h2>
<p>Every position on BLIX can carry a take profit multiple, a stop loss, a trailing stop (sell once the coin falls a set share below its high) and partial sells. The rules run on the server, so they fire while you are away, in paper mode and in live mode alike.</p>
${F.rating("The AI read before the buy")}
${F.safety("The rug check the bots skip")}
${F.signals("Signals instead of blind snipes")}
<h2 id="build">Want to build your own pump.fun bot?</h2>
<p>Your account includes the <a href="/pump-fun-api">pump.fun API</a>: launches, trades, holders, candles and quotes as JSON and a live stream. The guide <a href="/how-to-build-a-solana-trading-bot">how to build a Solana trading bot</a> starts from it. The API's desk is paper only; real execution is in the terminal, by you.</p>
${MORE}
${NOT_AFFILIATED("pump.fun")}${RISK}`,
  faq: [
    ["Is there a free pump.fun trading bot?", `BLIX is free to use and trades pump.fun coins in one click with a 2% fee a trade (1.6% with an invite). It is a terminal with AI reads and automatic exits rather than a blind bot, and you can practise in paper mode first.`],
    ["Do pump.fun sniper bots work?", `Rarely for long. A sniper buys every launch before anything is known about it, including the rugs, and other traders avoid coins whose first holders are snipers. BLIX shows the sniper and bundle share of every coin so you can avoid them.`],
    ["Can BLIX auto-buy coins for me?", `No. The AI rates coins and makes picks, and BLIX runs your exits automatically, but every buy is yours. That keeps the decision where the information is.`],
    ["What does a pump.fun trading bot cost?", `Most hosted bots take about 1% a trade plus Solana priority fees. BLIX takes 2%, 1.6% through an invite, and sets the priority fee per trade.`],
    ["Can I build a pump.fun bot on the Blix API?", `Yes. The API that comes with your account serves launches, trades, holders, candles and Jupiter quotes as JSON and a live stream. It does not sign transactions; real trades are made in the terminal.`],
  ],
});

// ---------- /pump-fun-terminal ----------
const terminal = page({
  path: "/pump-fun-terminal", crumb: "pump.fun terminal",
  title: "pump.fun Trading Terminal with AI: Scanner, Chart, Trade | BLIX",
  description: "An all-in-one pump.fun trading terminal: every launch live, chart with the traders on it, holders, rug check, AI ratings and one-click trading. Free account.",
  h1: "The pump.fun trading terminal with AI",
  lede: `A pump.fun terminal puts the whole lifecycle of a coin on one screen: the launch, the bonding curve, the holders, the chart, the trade. BLIX adds what the other terminals leave out: an AI rating on every coin, daily picks with reasons, narratives written up each day, the faces of known traders on the chart, and a rug check in one number. Free, in the browser, with one-click trading from your own Blix wallet or paper mode to practise.`,
  body: `${START()}
${facts([FACT.price, FACT.fee, FACT.speed, FACT.ai, FACT.wallets, FACT.where])}
${F.pulse()}
${F.chart()}
${F.holders()}
${F.trade()}
${F.rating()}
${F.narratives()}
${F.wallets()}
${F.launch()}
<h2 id="compare">pump.fun terminals compared</h2>
<p>Checked on ${CHECKED}. Every terminal here shows pump.fun launches; the differences are the AI, the fee, the keys and what you can build on it.</p>
${compare(["blix", "axiom", "photon", "gmgn", "bullx"])}
${MORE}
${NOT_AFFILIATED("pump.fun, Axiom Trade, Photon, GMGN or BullX")}${RISK}`,
  faq: [
    ["What is a pump.fun terminal?", `A trading app that shows pump.fun coins live from launch to graduation with charts, holders and a buy button, instead of the pump.fun site itself. BLIX is one, with AI reads and a rug check on every coin.`],
    ["Is BLIX free?", `Yes. Sign in with Google and the terminal is on screen. Real trades pay 2% (1.6% with an invite); paper mode is free with no limit.`],
    ["Do I need to install anything?", `No. BLIX runs in the browser on desktop and phone, and the API and MCP connector come with your account.`],
    ["Which is the best pump.fun trading terminal?", `It depends on what you want. Axiom and Photon are fast and well known; GMGN covers many chains; BullX suspended trading in June 2026. BLIX is the one with AI reads on every coin, an API and MCP connector with the account, and a coin launcher, at the same 1% fee.`],
  ],
});

// ---------- /pump-fun-analytics ----------
const analytics = page({
  path: "/pump-fun-analytics", crumb: "pump.fun analytics",
  title: "pump.fun Analytics Dashboard: Volume, Holders, Trending | BLIX",
  description: "pump.fun analytics live: volume, buys and sells, holders, bonding progress, trending and new coins, top traders and the fees each coin paid. Free dashboard.",
  h1: "pump.fun analytics, live",
  lede: `pump.fun analytics on BLIX are live numbers, not a daily report: volume, buys and sells, traders and holders per coin, bonding progress, the coins trending and surging right now, the day's runners, the top traders by profit, and the fees each coin has paid. Every number comes from trades Blix decodes from the chain itself, so it moves as the market does.`,
  body: `${START("See the dashboard")}
${facts([["Per coin", "Market cap, volume, buys, sells, traders, holders, bonding progress, fees paid"], ["Lists", "Trending, Surge, New pairs, Bonded, Final stretch, Migrated"], ["Traders", "Top traders by profit for the day, week and month"], ["Narratives", "Which stories are gaining, and their coins"], FACT.ai, FACT.price])}
<h2 id="coin">Per-coin analytics</h2>
${bullets([
    "<b>Market cap and progress:</b> the live market cap in USD and SOL and the share of the bonding curve sold.",
    "<b>Flow:</b> buys, sells, traders and volume for the last minutes and the coin's life.",
    "<b>Holders:</b> the number of holders, the top-10 share, the dev's share, snipers and bundles.",
    "<b>Fees paid:</b> what the coin's trades have paid in pump.fun and PumpSwap fees, which is a clean measure of how much it really traded.",
    "<b>Chart:</b> market-cap candles from 1 second to a day, built from real trades, with known traders on them.",
    "<b>Known traders:</b> the Fomo and pump.fun leaderboard traders in the coin, by name.",
  ])}
${F.discover("Market analytics: trending, surging, new, bonded")}
${F.narratives("Narratives and the day's runners")}
${F.wallets("Trader analytics")}
${F.rating()}
<h2 id="api">The same analytics as data</h2>
<p>With your account every number above is JSON: <code>GET /api/pulse</code>, <code>GET /api/token/&lt;mint&gt;</code>, <code>GET /api/holders/&lt;mint&gt;</code>, <code>GET /api/candles/&lt;mint&gt;</code>, <code>GET /api/narratives</code>, plus a live event stream. See the <a href="/pump-fun-api">pump.fun API</a>.</p>
${MORE}
${NOT_AFFILIATED("pump.fun")}${RISK}`,
  faq: [
    ["Where does the pump.fun analytics data come from?", `From the chain. Blix subscribes to the pump.fun and PumpSwap programs' logs and decodes every trade itself, so volume, holders and bonding progress are computed from real trades rather than read from a third party.`],
    ["Can I see trending pump.fun coins?", `Yes. Discover's Trending and Surge lists rank coins by live traction; Pulse's Final stretch column shows coins closest to graduating, which is where most of the volume is.`],
    ["Is there a pump.fun volume tracker?", `Every coin shows its volume for the last minutes and its whole life, and the fees paid, which track volume exactly. Lists can be sorted by volume.`],
    ["Does BLIX have a pump.fun dashboard API?", `Yes, with your account: the same analytics as JSON and a live stream.`],
  ],
});

// ---------- /pump-fun-signals ----------
const signals = page({
  path: "/pump-fun-signals", crumb: "pump.fun signals",
  title: "pump.fun Signals & Alerts: Launches, Dumps, Smart Wallets | BLIX",
  description: "pump.fun signals and alerts: launch, final-stretch and migration alerts, dump warnings, dev sells, smart-wallet buys and AI buy calls, each scored after the fact.",
  h1: "pump.fun signals and alerts",
  lede: `A pump.fun signal is only useful if it comes with the reason and a record. BLIX raises signals from the chain as they happen (a dev selling, a dump starting, a followed or smart wallet buying, a coin crossing a market-cap milestone, an AI buy call, a new narrative) and shows how each type of signal has done afterwards, so you know which ones to act on. In the app with your account, and the day's big ones in the BLIX Discord.`,
  body: `${START("Get the signals")}
${facts([["Signal types", "Dumps, dev sells, milestones, smart-wallet buys, leaderboard-wallet buys, AI buy calls, picks, narratives"], ["Record", "Every signal re-priced at 15 minutes, 1 hour, 6 hours and 24 hours"], ["Launch alerts", "Every pump.fun launch, final stretch and migration, live on Pulse"], ["Delivery", "In the app; the day's big ones in the BLIX Discord"], FACT.ai, FACT.price])}
<h2 id="types">The signals</h2>
${table(["Signal", "What raised it"], [
    ["Dump warning", "Sells outrunning buys and the market cap falling fast"],
    ["Dev sold", "The creator's wallet sold part or all of its share"],
    ["Milestone", "The coin crossed a market-cap level (for example $5M)"],
    ["Followed wallet buy", "A wallet BLIX follows (smart money, leaderboard traders) bought; shown with its PnL record"],
    ["Smart wallet buy", "A wallet that bought runners early bought again"],
    ["AI buy call", "A deep read graded the coin a buy, with its thesis and plan"],
    ["Pick", "The coin met the picks rule (rating, AI call and a clean entry)"],
    ["Narrative", "Several launches on the same word or the same X post within minutes"],
  ])}
<h2 id="record">The record, not just the alert</h2>
<p>Every signal is re-priced at 15 minutes, 1 hour, 6 hours and 24 hours, and the track record shows, per type, how many were checked, how many were up 20% or more, how many were down 50% or more, how many could not be sold, and the median. Losses are shown as loudly as wins. That is how you decide which signals deserve your attention.</p>
${F.pulse("Launch alerts: Pulse")}
${F.picks()}
${F.narratives("Narrative signals")}
${F.smart()}
<h2 id="where">Where the alerts go</h2>
<p>Signals are a live feed in the app the moment you sign in, and the day's big ones are shared in the BLIX Discord, which comes with your account. With your account they are also on the API and the live stream for your own code.</p>
${MORE}
${NOT_AFFILIATED("pump.fun")}${RISK}`,
  faq: [
    ["How do I get pump.fun launch alerts?", `Open Pulse on BLIX: every launch appears about a second after the chain, and the Final stretch and Migrated columns are the graduation alerts. With your account, launches are <code>launch</code> events on a live stream you can pipe anywhere.`],
    ["Are the signals reliable?", `BLIX scores every signal after the fact and shows the record per type. Use the ones with a good record and ignore the rest; the numbers are there to be checked.`],
    ["Can I get pump.fun alerts on Telegram or Discord?", `The signals feed is in the app, and the BLIX Discord carries the day's big ones. With your account every signal is also on the live stream, so your own code can forward them anywhere.`],
    ["What is a smart-wallet buy?", `A buy by a wallet BLIX found among the early buyers of past runners. These wallets are followed automatically and their buys are raised as signals.`],
  ],
});

// ---------- /pump-fun-mcp ----------
const mcp = page({
  path: "/pump-fun-mcp", crumb: "pump.fun MCP", og: "og-mcp.png", eyebrow: `pump.fun MCP · ${N_TOOLS} tools · with your account`,
  title: "pump.fun MCP Server: Live Launch Data for AI Agents | BLIX",
  description: "A pump.fun MCP connector for AI agents: give Claude, Cursor, Codex or Gemini every launch, bonding progress, holders, candles and quotes. With a BLIX account.",
  h1: "pump.fun MCP server for AI agents",
  lede: `The BLIX MCP connector gives an AI agent live pump.fun data: what launched in the last minutes, which coins are in the final stretch, who holds a coin and whether the dev sold, the candles, a real Jupiter quote, the AI's read and the narratives running. ${N_TOOLS} tools over stdio, one file, no dependencies. It comes with a BLIX account: sign in, open Developers, and connect it to Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI or VS Code and ask questions in plain words.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">All ${N_TOOLS} tools</a>`)}
${facts([["Tools", `${N_TOOLS}: pulse, coins, holders, candles, quote, research, picks, narratives, wallets, paper desk`], ["Transport", "stdio (JSON-RPC 2.0), zero dependencies"], ["Clients", "Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, VS Code, Windsurf, Zed"], ["Access", "Your BLIX account's session"], ["Writes", "Your paper desk only; no wallet, no signing"], FACT.community])}
${SIGNIN_DEV}
<h2 id="setup">Set it up</h2>
${MCP_SETUP.download}
<h3>Claude Code</h3>${MCP_SETUP.claudeCode}
<h3>Claude Desktop, Cursor, Windsurf</h3>${MCP_SETUP.json}
<h3>Codex</h3>${MCP_SETUP.codex}
<h3>Gemini CLI (~/.gemini/settings.json)</h3>${MCP_SETUP.gemini}
<h3>VS Code (.vscode/mcp.json)</h3>${MCP_SETUP.vscode}
<h2 id="ask">Things to ask about pump.fun</h2>
${bullets([
    `"What launched on pump.fun in the last five minutes with more than 30 traders and no bundles?"`,
    `"Which coins are in the final stretch right now? Rank them by holders and show the dev's share."`,
    `"Is the dev of &lt;mint&gt; still holding? List the top ten holders and tag snipers and bundles."`,
    `"Quote a 0.5 SOL buy of &lt;mint&gt; and tell me the price impact."`,
    `"Paper-buy 0.25 SOL of the strongest final-stretch coin with a 2x take profit and a 40% stop."`,
    `"What narratives are running on pump.fun today, and which coin leads each?"`,
  ])}
<h2 id="tools">The pump.fun tools</h2>
${table(["Tool", "What it returns"], [
    ["<code>blix_pulse</code>", "New launches, final stretch, migrated and running coins with stats and the AI verdict"],
    ["<code>blix_coin</code>", "Everything on one coin: price history, safety report, holders summary, socials, research, signals"],
    ["<code>blix_holders</code>", "The live holder ledger with dev, sniper and bundle tags and the top-10 share"],
    ["<code>blix_candles</code>", "Market-cap candles built from real trades"],
    ["<code>blix_quote</code>", "A real Jupiter quote: amount out, price impact, route. Nothing is traded"],
    ["<code>blix_research</code>", "The AI reads on a coin: grade, thesis, plan, sources"],
    ["<code>blix_narratives</code>", "Themes with heat, launch share, lift, emerging words and lead coins"],
    ["<code>blix_paper_buy</code> · <code>blix_paper_sell</code>", "Your paper desk, filled at real quotes. Paper money only"],
  ])}
<h2 id="chatgpt">ChatGPT and remote clients</h2>
<p>ChatGPT's web app only connects to remote (HTTPS) MCP servers, so it cannot start a local stdio connector. Use OpenAI's Codex CLI, which can, or put the connector behind a stdio-to-HTTP bridge on a machine you control. <a href="/how-to-use-mcp-for-crypto">How to use MCP for crypto</a> covers the options.</p>
${COMMUNITY}
${links("More for developers", [
    ["/mcp", "BLIX MCP connector", `All ${N_TOOLS} tools, every client, how it works.`],
    ["/developers", "Developer access", "Your session and commands, with your account."],
    ["/pump-fun-api", "pump.fun API", "The endpoints behind the tools."],
    ["/pump-fun-websocket", "pump.fun live stream", "Launches and trades as events."],
    ["/crypto-mcp-server", "Crypto MCP servers compared", "What is out there and what each needs."],
    ["/pump-fun-sdk", "pump.fun SDK and CLI", "Clients in 20 lines, no package to install."],
  ])}
${NOT_AFFILIATED("pump.fun")}`,
  faq: [
    ["Is there an official pump.fun MCP server?", `pump.fun does not publish one as of ${CHECKED}. BLIX's MCP connector is independent; it reads pump.fun from the chain through BLIX's own engine, with your account.`],
    ["Can the agent buy pump.fun coins through MCP?", `No. The only write tools are the paper desk's buy and sell, filled at real Jupiter quotes with paper money. There is no wallet or key in the connector. Real trading is in the terminal, by you.`],
    ["Does it work with ChatGPT?", `Not directly: ChatGPT's connectors must be remote HTTPS servers. Codex CLI works with the local connector as is.`],
    ["What do I need?", `A BLIX account (free), Node 20 or newer, and the one-file connector from your Developers page.`],
    ["Is it free?", `Yes, with your BLIX account. The connector calls no paid service.`],
  ],
});

// ---------- /pump-fun-sdk ----------
const sdk = page({
  path: "/pump-fun-sdk", crumb: "pump.fun SDK", og: "og-pump.png", eyebrow: `pump.fun developers · with your account`,
  title: "pump.fun SDK & CLI: Launches, Trades, Holders Without a Package | BLIX",
  description: "pump.fun SDK and CLI: every launch, trade, holder ledger and candle as JSON and a live stream with your BLIX account. A client in 20 lines, curl from the terminal.",
  h1: "pump.fun SDK and CLI",
  lede: `pump.fun publishes no SDK or data API, so "pump.fun SDK" results are third-party trading APIs with a fee per trade. BLIX is a different route: every pump.fun launch, trade, holder ledger, candle and Jupiter quote is JSON and a live stream at <code>blixvip.com/api</code>, authorized by your account's session. There is no package to install because the API is plain HTTPS; a client is twenty lines in any language, from the command line it is <code>curl</code> and <code>jq</code>, and for AI agents it is the MCP connector.`,
  body: `${DEV_CTA()}
${facts([["Install", "Nothing: HTTPS + JSON, your session as the key"], ["Endpoints", `${N_ENDPOINTS}, plus one Server-Sent Events stream`], ["Languages", "Any: recipes in Python and JavaScript below"], ["MCP", `${N_TOOLS} tools for AI clients`], ["Trading", "Quotes and your paper desk; real trades in the terminal"], FACT.community])}
${SIGNIN_DEV}
<h2 id="cli">pump.fun from the command line</h2>
${code(`export BLIX_SESSION="<from your Developers page>"
B=${BASE}; C="cookie: blix_wait=$BLIX_SESSION"

# every pump.fun launch, as it happens
curl -sN $B/api/stream -H "$C" | grep --line-buffered -A1 "event: launch"

# the final stretch, as a table
curl -s $B/api/pulse -H "$C" | jq -r '.stretch[] | [.symbol, .mcap, (.progress*100|round), .hl.h] | @tsv'

# who holds a coin, and did the dev sell
curl -s "$B/api/holders/<mint>?top=10" -H "$C" | jq '{dev, snipers, bundle, top10}'

# a real quote for a 0.5 SOL buy
curl -s "$B/api/quote?mint=<mint>&side=buy&amount=0.5&slip=300" -H "$C"`, "bash")}
<h2 id="sdk">A pump.fun "SDK" in twenty lines</h2>
<p>Because the API is HTTPS and JSON, a client is a thin wrapper. JavaScript (Node 20+):</p>
${code(`const BLIX = "${BASE}";
const H = { cookie: \`blix_wait=\${process.env.BLIX_SESSION}\` };   // from ${BASE}/developers
const get = (p) => fetch(BLIX + p, { headers: H }).then((r) => r.json());

export const pulse   = () => get("/api/pulse");
export const coin    = (mint) => get("/api/token/" + mint);
export const holders = (mint, top = 25) => get("/api/holders/" + mint + "?top=" + top);
export const candles = (mint, tf = 60) => get("/api/candles/" + mint + "?tf=" + tf);
export const quote   = (mint, side, amount, slip = 300) =>
  get("/api/quote?mint=" + mint + "&side=" + side + "&amount=" + amount + "&slip=" + slip);

// live launches: the stream is Server-Sent Events over plain HTTPS
export async function onLaunch(fn) {
  const res = await fetch(BLIX + "/api/stream", { headers: H });
  let buf = "", event = "";
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    for (const line of buf.split("\\n").slice(0, -1)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:") && event === "launch") fn(JSON.parse(line.slice(5)));
    }
    buf = buf.slice(buf.lastIndexOf("\\n") + 1);
  }
}`, "javascript")}
<p>The same in Python is on the <a href="/pump-fun-api-python">pump.fun API in Python</a> page, and TypeScript details on <a href="/pump-fun-api-javascript">pump.fun API in JavaScript</a>.</p>
<h2 id="options">What else is out there</h2>
${table(["Option", "What it is", "Trading"], [
    ["BLIX API and MCP connector", "pump.fun and PumpSwap decoded from the chain, holders, candles, quotes, AI reads, with your account", "Your paper desk; real trades in the terminal"],
    ["PumpPortal", "Third-party pump.fun data and trading API; launch stream free, trade streams and trading metered", "Yes, 0.5–1% a trade"],
    ["Program IDLs and community decoders", "Scripts that read pump.fun's TradeEvent and CreateEvent yourself", "Varies; many ask for your private key"],
  ])}
${callout(`<b>Never paste a private key into a "pump.fun SDK" you have not read.</b> BLIX never asks for one: the API reads the chain and quotes Jupiter, and the only desk it has is paper.`)}
<h2 id="how">How BLIX decodes pump.fun</h2>
<p>BLIX subscribes to the pump.fun program's logs over a Solana websocket and decodes the Anchor events itself: <b>TradeEvent</b> (mint, SOL and token amounts, buy or sell, trader, the virtual and real reserves after the trade) and <b>CreateEvent</b> (name, symbol, metadata URI, mint, bonding curve, creator). PumpSwap pools and Raydium LaunchLab are read the same way. That is why the API has holders from a coin's first trade and bonding progress to the block.</p>
${COMMUNITY}
${links("More for developers", [
    ["/pump-fun-api", "pump.fun API", "Every endpoint and the live stream."],
    ["/pump-fun-websocket", "pump.fun live stream", "Launches and trades as events, in any language."],
    ["/pump-fun-api-python", "pump.fun API in Python", "Stream launches, read holders, quote a buy."],
    ["/pump-fun-api-javascript", "pump.fun API in JavaScript", "Node, TypeScript and the browser."],
    ["/pump-fun-mcp", "pump.fun MCP connector", "The same data as tools for AI agents."],
    ["/crypto-trading-cli", "Crypto trading CLI", "BLIX from the terminal, and the AI CLIs."],
  ])}
${NOT_AFFILIATED("pump.fun or PumpPortal")}`,
  faq: [
    ["Is there an official pump.fun SDK?", `No. pump.fun publishes no SDK, API keys or developer docs as of ${CHECKED}. Everything called a pump.fun SDK is third-party. BLIX reads the chain directly and serves it with your account.`],
    ["Is there a pump.fun CLI?", `BLIX has no separate binary: the API is HTTPS, so <code>curl</code> and <code>jq</code> are the CLI, and AI command-line tools (Claude Code, Codex, Gemini CLI) can drive it through the MCP connector.`],
    ["Which languages can use it?", `Any language with an HTTP client. Python and JavaScript recipes are on their own pages; Go, Rust and shell work the same way.`],
    ["Can I trade with it?", `The API quotes trades through Jupiter and runs your paper desk; it never signs a transaction. Real trading is in the terminal, by you.`],
    ["How do I get access?", `Create a BLIX account and open <a href="/developers">Developers</a> for your session.`],
  ],
});

// ---------- /pump-fun-websocket ----------
const ws = page({
  path: "/pump-fun-websocket", crumb: "pump.fun websocket", og: "og-pump.png", eyebrow: `pump.fun realtime · with your account`,
  title: "pump.fun WebSocket & Real-Time API: Launches and Trades Live | BLIX",
  description: "Real-time pump.fun data with a BLIX account: every launch and trade as a live event stream, how the pump.fun websocket works on chain, and how PumpPortal compares.",
  h1: "pump.fun websocket and real-time API",
  lede: `There are three ways to get pump.fun data in real time: subscribe to the pump.fun program's logs on a Solana RPC websocket and decode them yourself, pay a hosted provider such as PumpPortal for a decoded websocket, or use BLIX, which does the decoding and serves one live event stream to your account. This page shows all three and the code for the last one.`,
  body: `${DEV_CTA()}
${facts([["Stream", "Server-Sent Events: launches, live prices, migrations, signals"], ["Latency", "Launches about a second after the chain; trades per batch"], ["Access", "Your account's session"], ["Reconnect", "Stateless: reconnect and carry on"], ["Also", "Trades per coin on request, candles, holders"], FACT.community])}
${SIGNIN_DEV}
<h2 id="events">The live stream</h2>
<p><code>GET /api/stream</code> is a Server-Sent Events stream (plain HTTPS, so it works through every proxy and in every language). One connection carries:</p>
${table(["Event", "Payload", "When"], [
    ["<code>launch</code>", "A new pump.fun coin: mint, name, symbol, dev, metadata URI", "About a second after the chain"],
    ["<code>live</code>", "Live market cap, buys, sells, bonding progress for coins on the Pulse", "Per trade batch"],
    ["<code>mig</code>", "A graduation to PumpSwap", "When detected"],
    ["<code>signal</code>", "A new signal: type, mint, symbol, text, safety, score", "When raised"],
    ["<code>pic</code>", "A coin's picture became available", "When fetched"],
    ["<code>tick</code>", "Launches per hour, trades per second, coins tracked", "Every few seconds"],
  ])}
${code(`curl -N ${BASE}/api/stream -H "cookie: blix_wait=$BLIX_SESSION"`, "bash")}
${code(`// Node 20+
const res = await fetch("${BASE}/api/stream", { headers: { cookie: \`blix_wait=\${process.env.BLIX_SESSION}\` } });
let buf = "", event = "";
for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
  buf += chunk;
  for (const line of buf.split("\\n").slice(0, -1)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:") && (event === "launch" || event === "mig")) console.log(event, JSON.parse(line.slice(5)));
  }
  buf = buf.slice(buf.lastIndexOf("\\n") + 1);
}`, "javascript")}
${code(`import json, os, requests

with requests.get("${BASE}/api/stream", stream=True, cookies={"blix_wait": os.environ["BLIX_SESSION"]}) as r:
    event = None
    for line in r.iter_lines(decode_unicode=True):
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:") and event in ("launch", "mig"):
            print(event, json.loads(line[5:]))`, "python")}
<h2 id="trades">Trades per coin</h2>
<p>Every trade of a coin, newest first, is <code>GET /api/coin/&lt;mint&gt;/trades?limit=100</code>; the terminal reads it every two seconds for the open chart. Candles built from the same trades are <code>GET /api/candles/&lt;mint&gt;?tf=1</code> for 1-second bars up to <code>tf=86400</code> for daily.</p>
<h2 id="chain">How the pump.fun websocket works on chain</h2>
<p>pump.fun itself has no public websocket. Its program prints an Anchor event into the transaction logs on every trade and every create, so a <code>logsSubscribe</code> on a Solana RPC websocket for the pump.fun program ID shows the whole market. BLIX does exactly this: it decodes <b>TradeEvent</b> (discriminator <code>bddb7fd34ee661ee</code>) and <b>CreateEvent</b> (<code>1b72a94ddeeb6376</code>) from the logs, keeps a holder ledger per coin, and builds candles.</p>
<h2 id="compare">Real-time pump.fun options</h2>
${table(["", "What you get", "Access", "Cost"], [
    ["BLIX", "Decoded launches, trades, migrations, holders, candles, quotes as SSE + JSON", "A BLIX account", "Included"],
    [ext("https://pumpportal.fun/", "PumpPortal"), "Hosted websocket with decoded launches, migrations and trades", "Key for trade streams", "Launches and migrations free; trades 0.01 SOL per 10,000 (since May 2026)"],
    ["Raw RPC websocket", "Program logs you decode yourself", "RPC provider's key (public RPC works, rate-limited)", "Free to paid, by provider"],
  ], "cmp")}
${COMMUNITY}
${links("More for developers", [
    ["/pump-fun-api", "pump.fun API", "All endpoints."],
    ["/pump-fun-api-python", "pump.fun API in Python", "Full recipes."],
    ["/pump-fun-api-javascript", "pump.fun API in JavaScript", "Node and TypeScript."],
    ["/pump-fun-sdk", "pump.fun SDK and CLI", "Clients in 20 lines."],
    ["/solana-api", "Solana memecoin API", "Beyond pump.fun: every Solana pool Jupiter routes."],
  ])}
${NOT_AFFILIATED("pump.fun or PumpPortal")}`,
  faq: [
    ["Does pump.fun have a websocket API?", `Not a public one. The real-time source is the pump.fun program's logs on a Solana RPC websocket; BLIX and hosted providers decode those for you.`],
    ["Why Server-Sent Events instead of a websocket?", `SSE is one-way, which is all a market feed needs, and it is plain HTTPS: it passes every proxy, needs no library, and a dropped connection is one line to reconnect.`],
    ["How far behind the chain is the stream?", `Launches arrive about a second after they land on chain. Trades are pushed per batch, several times a second during busy periods.`],
    ["How do I get access?", `Create a BLIX account and open <a href="/developers">Developers</a> for your session.`],
  ],
});

// ---------- /pump-fun-api-python ----------
const py = page({
  path: "/pump-fun-api-python", crumb: "pump.fun API in Python", og: "og-pump.png", eyebrow: `pump.fun API · Python · with your account`,
  title: "pump.fun API in Python: Launches, Holders, Quotes | BLIX",
  description: "Use the BLIX pump.fun API from Python: stream every launch, read the final stretch, check holders for snipers and bundles, get a real Jupiter quote. No SDK needed.",
  h1: "pump.fun API in Python",
  lede: `You do not need a pump.fun Python SDK: BLIX serves pump.fun as plain HTTPS and JSON to your account, so <code>requests</code> is the whole client. Below: stream launches as they happen, list the final stretch, check a coin's holders for snipers and bundles, pull candles, and get a real Jupiter quote.`,
  body: `${DEV_CTA()}
${SIGNIN_DEV}
<h2 id="setup">Setup</h2>
${code(`pip install requests
export BLIX_SESSION="<from your Developers page>"`, "bash")}
<h2 id="launches">Every launch, as it happens</h2>
${code(`import json, os, requests

BLIX = "${BASE}"
CK = {"blix_wait": os.environ["BLIX_SESSION"]}

def launches():
    with requests.get(f"{BLIX}/api/stream", stream=True, cookies=CK) as r:
        event = None
        for line in r.iter_lines(decode_unicode=True):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:") and event == "launch":
                yield json.loads(line[5:])

for coin in launches():
    print(coin["symbol"], coin["name"], coin["mint"], "dev", coin["dev"])`, "python")}
<h2 id="pulse">The final stretch, ranked</h2>
${code(`pulse = requests.get(f"{BLIX}/api/pulse", cookies=CK).json()
for c in sorted(pulse["stretch"], key=lambda c: -c["hl"]["h"]):
    print(f'{c["symbol"]:8} mcap \${c["mcap"]:>9,.0f}  progress {c["progress"]*100:5.1f}%  holders {c["hl"]["h"]:4}  bundles {c["hl"]["bd"]:4.1f}%  ai {c["ai"]["grade"]}')`, "python")}
<h2 id="holders">Snipers, bundles and the dev</h2>
${code(`def screen(mint):
    h = requests.get(f"{BLIX}/api/holders/{mint}", params={"top": 10}, cookies=CK).json()
    if h.get("partial"):
        return "seen mid-life: sniper and bundle figures unknown"
    flags = []
    if h["dev"]["pct"] > 5:        flags.append(f'dev holds {h["dev"]["pct"]:.1f}%')
    if h["dev"]["sold"] == "all":  flags.append("dev sold everything")
    if h["bundle"]["pct"] > 20:    flags.append(f'bundles hold {h["bundle"]["pct"]:.1f}%')
    if h["snipers"]["pct"] > 20:   flags.append(f'snipers hold {h["snipers"]["pct"]:.1f}%')
    if h["top10"] > 40:            flags.append(f'top 10 hold {h["top10"]:.1f}%')
    return ", ".join(flags) or "clean"

print(screen("<mint>"))`, "python")}
<h2 id="candles">Candles and a real quote</h2>
${code(`candles = requests.get(f"{BLIX}/api/candles/<mint>", params={"tf": 60}, cookies=CK).json()
print("last 1m candle", candles[-1])

q = requests.get(f"{BLIX}/api/quote", params={"mint": "<mint>", "side": "buy", "amount": 0.5, "slip": 300}, cookies=CK).json()
print("0.5 SOL buys", q["outAmount"], "price impact", q["priceImpactPct"])`, "python")}
<h2 id="bot">A first bot: alert on clean final-stretch coins</h2>
${code(`import time
seen = set()
while True:
    for c in requests.get(f"{BLIX}/api/pulse", cookies=CK).json()["stretch"]:
        if c["mint"] in seen or c["hl"]["h"] < 50:
            continue
        if screen(c["mint"]) == "clean":
            print("clean final-stretch coin:", c["symbol"], c["mint"], "progress", round(c["progress"] * 100))
        seen.add(c["mint"])
    time.sleep(5)`, "python")}
<p>The API does not sign transactions: this bot alerts, and can paper-trade through <code>POST /api/paper/quoted</code>. To trade for real, open the coin in the terminal.</p>
${COMMUNITY}
${links("More for developers", [
    ["/pump-fun-api", "pump.fun API reference", "Every endpoint and field."],
    ["/pump-fun-api-javascript", "pump.fun API in JavaScript", "The same recipes in Node and TypeScript."],
    ["/pump-fun-websocket", "pump.fun live stream", "The stream in detail."],
    ["/how-to-build-a-solana-trading-bot", "How to build a Solana trading bot", "From data to signals to execution."],
    ["/pump-fun-mcp", "pump.fun MCP connector", "Let an AI agent call the same API."],
  ])}
${NOT_AFFILIATED("pump.fun")}`,
  faq: [
    ["Is there an official pump.fun Python API?", `No. pump.fun publishes no API. BLIX serves pump.fun as HTTPS and JSON to your account, which Python reads with <code>requests</code>.`],
    ["Do I need an API key?", `No. Your account's session, shown on the Developers page, is sent as a cookie on each request.`],
    ["Can I buy and sell from Python?", `Not for real money: the API quotes through Jupiter and runs your paper desk, and never signs. Real trades are made in the terminal.`],
    ["What are the limits?", `Fair use per account; quotes and paper writes are paced. Poll the Pulse every few seconds rather than every few milliseconds, and use the stream for anything live.`],
  ],
});

// ---------- /pump-fun-api-javascript ----------
const js = page({
  path: "/pump-fun-api-javascript", crumb: "pump.fun API in JavaScript", og: "og-pump.png", eyebrow: `pump.fun API · JavaScript, TypeScript, Node · with your account`,
  title: "pump.fun API in JavaScript & Node.js: Live Launches | BLIX",
  description: "Use the BLIX pump.fun API from Node.js, TypeScript or the browser: stream launches, read the Pulse, screen holders, get candles and Jupiter quotes. fetch only.",
  h1: "pump.fun API in JavaScript, TypeScript and Node.js",
  lede: `BLIX serves pump.fun as HTTPS and JSON to your account, so a JavaScript client is <code>fetch</code>, built into Node 20+ and every browser. Below: live launches, the Pulse, holder screening, candles and quotes, with types for TypeScript. No package to install.`,
  body: `${DEV_CTA()}
${SIGNIN_DEV}
<h2 id="client">A typed client</h2>
${code(`// blix.ts (Node 20+): BLIX_SESSION from ${BASE}/developers
const BLIX = "${BASE}";
const H = { cookie: \`blix_wait=\${process.env.BLIX_SESSION}\` };

export interface Launch { mint: string; name: string; symbol: string; dev: string; uri: string }
export interface Holders {
  holders: number; top10: number; trades: number; partial?: boolean;
  dev: { wallet: string; pct: number; maxPct: number; sol: number; sold: "none" | "part" | "all" };
  snipers: { n: number; pct: number; maxPct: number; sold: number };
  bundle: { n: number; pct: number; maxPct: number; sold: number };
  top: { wallet: string; pct: number; sol: number; trades: number; tag: string | null }[];
}

const get = <T>(p: string) => fetch(BLIX + p, { headers: H }).then((r) => r.json() as Promise<T>);
export const pulse = () => get<{ newPairs: any[]; stretch: any[]; migrated: any[] }>("/api/pulse");
export const holders = (mint: string, top = 25) => get<Holders>(\`/api/holders/\${mint}?top=\${top}\`);
export const candles = (mint: string, tf = 60) => get<any[]>(\`/api/candles/\${mint}?tf=\${tf}\`);
export const quote = (mint: string, side: "buy" | "sell", amount: number, slip = 300) =>
  get<any>(\`/api/quote?mint=\${mint}&side=\${side}&amount=\${amount}&slip=\${slip}\`);

export async function onLaunch(fn: (c: Launch) => void) {
  const res = await fetch(BLIX + "/api/stream", { headers: H });
  let buf = "", event = "";
  for await (const chunk of res.body!.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    for (const line of buf.split("\\n").slice(0, -1)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:") && event === "launch") fn(JSON.parse(line.slice(5)));
    }
    buf = buf.slice(buf.lastIndexOf("\\n") + 1);
  }
}`, "typescript")}
<h2 id="screen">Screen a coin's holders</h2>
${code(`import { holders, onLaunch, pulse } from "./blix.js";

export async function screen(mint: string) {
  const h = await holders(mint, 10);
  if (h.partial) return ["seen mid-life"];
  const flags: string[] = [];
  if (h.dev.pct > 5) flags.push(\`dev holds \${h.dev.pct.toFixed(1)}%\`);
  if (h.dev.sold === "all") flags.push("dev sold everything");
  if (h.bundle.pct > 20) flags.push(\`bundles hold \${h.bundle.pct.toFixed(1)}%\`);
  if (h.snipers.pct > 20) flags.push(\`snipers hold \${h.snipers.pct.toFixed(1)}%\`);
  if (h.top10 > 40) flags.push(\`top 10 hold \${h.top10.toFixed(1)}%\`);
  return flags;
}

// log every launch, and screen the final stretch every 5 seconds
onLaunch((c) => console.log("launch", c.symbol, c.mint));
setInterval(async () => {
  for (const c of (await pulse()).stretch) {
    const flags = await screen(c.mint);
    if (!flags.length && c.hl.h >= 50) console.log("clean:", c.symbol, Math.round(c.progress * 100) + "%");
  }
}, 5000);`, "typescript")}
<h2 id="browser">In the browser</h2>
<p>Signed in on blixvip.com, the browser already has your session: <code>fetch("/api/pulse").then(r =&gt; r.json())</code> in the console works as is, and <code>new EventSource("/api/stream")</code> gives you the live stream with <code>addEventListener("launch", …)</code>. A page on another site cannot use your session; run the code from Node instead.</p>
<h2 id="run">Run it</h2>
${code(`export BLIX_SESSION="<from your Developers page>"
node --experimental-strip-types bot.ts   # Node 22.6+; or compile with tsc
# or
npx tsx bot.ts`, "bash")}
${COMMUNITY}
${links("More for developers", [
    ["/pump-fun-api", "pump.fun API reference", "Every endpoint and field."],
    ["/pump-fun-api-python", "pump.fun API in Python", "The same recipes with requests."],
    ["/pump-fun-websocket", "pump.fun live stream", "The stream in detail."],
    ["/pump-fun-sdk", "pump.fun SDK and CLI", "The curl recipes."],
    ["/memecoin-mcp-server", "Memecoin MCP connector", "Tools for an agent instead of code."],
  ])}
${NOT_AFFILIATED("pump.fun")}`,
  faq: [
    ["Is there a pump.fun npm package?", `Not an official one. BLIX needs no package: the API is HTTPS and JSON, so <code>fetch</code> is the client.`],
    ["Does it work with TypeScript?", `Yes. The interfaces above cover the common shapes; everything else is plain JSON you can type as you go.`],
    ["Can I use it from a React or Next.js app?", `From the server side with your session, yes. In the browser only a page on blixvip.com carries the session.`],
    ["Can I trade from JavaScript?", `The API quotes trades through Jupiter and runs your paper desk; it never signs. Real trades are made in the terminal.`],
  ],
});

// ---------- /pump-fun-wallet-tracker ----------
const walletTracker = page({
  path: "/pump-fun-wallet-tracker", crumb: "pump.fun wallet tracker",
  title: "pump.fun Wallet Tracker: Whales, Devs, Top Traders, PnL | BLIX",
  description: "Track pump.fun wallets live: any wallet's buys, sells and profit from the chain, the whale and dev wallets in a coin, and the top pump.fun traders ranked by profit.",
  h1: "pump.fun wallet tracker",
  lede: `On pump.fun the wallets tell the story before the chart does: who created the coin, who bought in the first block, which known traders are in, and who already left. BLIX tracks all of it from the chain. Open any wallet and its trades are there with profit; open any coin and see the dev, snipers, bundles and the named traders among the holders; open the Top traders board for the pump.fun leaderboard ranked by profit, with every trader's own page.`,
  body: `${START("Track wallets on BLIX")}
${facts([["Any wallet", "Swaps on every DEX from the chain, holdings, positions, profit"], ["In a coin", "Dev, snipers, bundles, top 10, known traders with faces"], ["Leaderboard", "pump.fun and Fomo boards merged by profit: day, week, month"], ["Wallet pages", "Any wallet: trades, positions, profit, coins held now"], ["Alerts", "Buys by smart and leaderboard wallets as signals"], FACT.price])}
${F.wallets()}
${F.holders("Dev, sniper, bundle and whale wallets in a coin")}
<h2 id="dev">Dev wallet tracking</h2>
<p>The creator's wallet is tagged in every coin's holder panel with its share now, its largest share, how much SOL it took out and whether it sold part or all. The dev's other launches and how they ended are one click away, which is how serial launchers show up before you buy.</p>
<h2 id="whales">Whales and insiders</h2>
<p>Large holders are listed with their share, their SOL in and out and their trade count; wallets that bought in the same block as the first trade are bundles, within two blocks snipers. The bubble map draws wallets funded by the same source together, so an "insider" holding through many wallets is one cluster on screen.</p>
${F.smart()}
${F.pnl("Profit per wallet")}
${F.signals("Wallet alerts")}
${links("More wallet pages", [
    ["/smart-money-tracker", "Smart money tracker", "Find the wallets that buy runners early."],
    ["/solana-whale-tracker", "Solana whale tracker", "Large wallets and their moves."],
    ["/solana-pnl-tracker", "Solana PnL tracker", "Profit, history and a card to share, for any wallet."],
    ["/how-to-track-solana-wallets", "How to track Solana wallets", "Step by step."],
    ["/wallet-tracking-api", "Wallet tracking API", "The same tracking as JSON."],
  ])}
${NOT_AFFILIATED("pump.fun")}${RISK}`,
  faq: [
    ["How do I track a pump.fun wallet?", `Paste its address into BLIX, or open any wallet from a holder list or the leaderboard. Its page is built from the chain: holdings, swaps on every Solana DEX, positions and profit. Smart and leaderboard wallets' buys are raised as signals.`],
    ["Can I see the dev's wallet for a pump.fun coin?", `Yes. The holder panel tags the creator with its share, its largest share, SOL taken out and whether it sold, plus the dev's other launches.`],
    ["Who are the top pump.fun traders?", `The Top traders board merges pump.fun's PnL leaderboard with Fomo's, ranked by profit for the day, week or month, and every trader opens to a page built from the chain.`],
    ["Is wallet tracking free?", `Yes, with your account, and the same tracking is on the API.`],
  ],
});

// ---------- /pump-fun-rug-checker ----------
const rug = page({
  path: "/pump-fun-rug-checker", crumb: "pump.fun rug checker",
  title: "pump.fun Rug Checker: Bundles, Snipers, Dev History (Free) | BLIX",
  description: "Check any pump.fun coin for rug signs in seconds: bundles and snipers, dev share and history, top-holder concentration, authorities, liquidity and linked wallets.",
  h1: "pump.fun rug checker",
  lede: `Most pump.fun rugs look the same before they happen: the creator or a bundle holds a big share, the first blocks are full of snipers, the supply sits in a few linked wallets, or the dev has launched the same coin ten times. BLIX checks all of that on every coin, live, and answers "is this a rug?" in one number with the reasons under it, so you can pass in seconds and spend your time on the coins that are set up fairly.`,
  body: `${START("Check a coin")}
${facts([["Checks", "Dev share and history, snipers, bundles, top 10, authorities, liquidity, linked wallets"], ["Score", "One number, with the reasons under it, updated as the coin trades"], ["Bubble map", "Wallets funded by the same source, drawn as one cluster"], FACT.ai, ["Speed", "On every coin from its first trade"], FACT.price])}
${F.safety("What the rug check looks at")}
<h2 id="signs">The signs, and what they mean</h2>
${table(["Sign", "Why it matters", "Where BLIX shows it"], [
    ["Bundle share above 20%", "One party bought from many wallets in the launch block; it can dump at once", "Holder panel, rug check"],
    ["Snipers in the first two blocks", "Bots that buy every launch; they sell into the first pump", "Holder panel"],
    ["Dev holds a large share, or sold", "The creator can end the coin; a dev that sold already did", "Holder panel, dev history"],
    ["Top 10 above 40%", "A few wallets control the price", "Holder panel, bubble map"],
    ["Serial launcher", "The dev launched several coins in the last hours", "Dev history on the coin page"],
    ["Mint or freeze authority kept", "The team can print tokens or freeze wallets (after graduation)", "Safety tab"],
    ["Liquidity pulled or unlocked", "Nothing to sell into", "Safety tab, signals"],
  ])}
${F.holders()}
<h2 id="bubble">The bubble map</h2>
<p>The bubble map draws a coin's holders as bubbles sized by their share, and links the ones funded from the same wallet. A coin whose top holders all hang off one funder is one person; you see it at a glance rather than by reading addresses.</p>
${F.rating("The AI's read on top")}
<h2 id="limits">What a rug check cannot tell you</h2>
<p>A clean setup is not a good coin. A coin can pass every check and still fall 90% because nobody wanted it. The rug check tells you the setup is fair; the chart, the holders and the narrative tell you whether it has a reason to run. BLIX shows both on the same screen.</p>
${links("More safety pages", [
    ["/rug-pull-scanner", "Rug pull scanner for Solana", "The same checks on every Solana coin, not only pump.fun."],
    ["/pump-fun-wallet-tracker", "pump.fun wallet tracker", "Dev, whale and insider wallets."],
    ["/meme-coin-analyzer", "Meme coin analyzer", "Holders, chart, narrative and the AI read."],
    ["/pump-fun-scanner", "pump.fun scanner", "Every launch live, with the rug check on each."],
  ])}
${NOT_AFFILIATED("pump.fun")}${RISK}`,
  faq: [
    ["How do I check if a pump.fun coin is a rug?", `Open it in BLIX. The rug check gives one number with the reasons: dev share and history, bundles, snipers, top-10 share, authorities and liquidity. Bundles or snipers above 20%, a dev holding a big share or a serial launcher are reasons to pass.`],
    ["What is a bundle on pump.fun?", `Wallets that bought in the same block as the coin's first trade, which means they were in the launch transaction bundle. BLIX tags them from the first trade onward and shows how much they still hold.`],
    ["Is the rug check free?", `Yes. It runs on every coin in the terminal, and the same data is on the API that comes with your account (<code>GET /api/holders</code> and <code>GET /api/token</code>).`],
    ["Can a coin pass the rug check and still rug?", `Yes. The check reads the setup; it cannot read intent. Treat it as a filter that removes the obvious ones, and size every memecoin trade for the chance it goes to zero.`],
  ],
});

// ---------- launchpad comparisons ----------
const vsBonk = page({
  path: "/pump-fun-vs-letsbonk", crumb: "pump.fun vs LetsBonk", eyebrow: `Launchpads · checked ${CHECKED}`,
  title: "pump.fun vs LetsBonk: Which Solana Launchpad in 2026? | BLIX",
  description: "pump.fun vs letsbonk.fun (Raydium LaunchLab): how each bonding curve works, fees, graduation, the 2025 flip in launches, and how BLIX tracks and trades both.",
  h1: "pump.fun vs LetsBonk",
  lede: `pump.fun and letsbonk.fun are the two Solana launchpads that matter for memecoins. LetsBonk runs on Raydium's LaunchLab program and briefly overtook pump.fun in daily launches in July 2025; pump.fun took the lead back and is the larger of the two as of ${CHECKED}. BLIX reads both programs from the chain, so coins from either show up on the same screen with the same holder ledger, rug check, AI rating and one-click trade.`,
  body: `${START("Trade both on BLIX")}
${table(["", "pump.fun", "LetsBonk (Raydium LaunchLab)"], [
    ["Launch cost", "Free, plus about 0.025 SOL of network fees with a first buy", "Free, plus network fees"],
    ["Curve fee", "1.25% a trade (0.95% protocol, 0.30% creator)", "LaunchLab's curve fee; part of it funds BONK buybacks"],
    ["Graduates to", "PumpSwap (pump.fun's own DEX), 0.015 SOL graduation fee", "A Raydium pool"],
    ["Creator rewards", "Creator fee share, splittable with up to 10 wallets; cashback coins", "Creator share per the LaunchLab config"],
    ["Launches", "The larger launchpad in 2026", "Led daily launches briefly in July 2025"],
    ["In BLIX", "Pulse, Discover, holders, rug check, AI, trade", "Discover and coin pages; LaunchLab events carry no trader, so no holder ledger"],
  ], "cmp")}
<h2 id="how">How each curve works</h2>
<p>Both sell a fixed share of the supply along a bonding curve and move the coin to a pool when it is sold out. pump.fun's curve is one shape for every coin (793.1 million of the billion tokens, graduating at about 411 SOL of market cap). LaunchLab lets a launchpad choose the curve and the quote token, which is why some LetsBonk-style pools are priced in USD1 or another token rather than SOL; BLIX converts those to SOL at Jupiter's price.</p>
<h2 id="blix">Both on one screen</h2>
<p>BLIX subscribes to the pump.fun, PumpSwap and LaunchLab programs. pump.fun coins get the full treatment (launch to migration on Pulse, holder ledger with dev, snipers and bundles). LaunchLab's trade events do not name the trader, so LetsBonk coins show live price, volume and the chart, and their holders come from the chain on request. Either way the trade is one click from your Blix wallet.</p>
${F.rating()}
${links("More launchpad pages", [
    ["/pump-fun", "pump.fun explained", "The curve, the fees, graduation."],
    ["/pump-fun-vs-raydium", "pump.fun vs Raydium", "PumpSwap and Raydium after graduation."],
    ["/pump-fun-vs-moonshot", "pump.fun vs Moonshot", "Where Moonshot (now Moonit) stands."],
    ["/create-pump-fun-coin", "Create a pump.fun coin", "Launch from one screen."],
  ])}
${NOT_AFFILIATED("pump.fun, LetsBonk or Raydium")}${RISK}`,
  faq: [
    ["Which has more launches, pump.fun or LetsBonk?", `pump.fun, as of ${CHECKED}. LetsBonk led daily launches for a stretch in July 2025 (about half of launches by one aggregator's count) and pump.fun regained the lead afterwards.`],
    ["Which is cheaper to trade?", `Both charge a fee on the curve of about the same size; pump.fun's is 1.25%. After graduation the pool's fee applies (PumpSwap's is tiered by market cap; Raydium's by pool type). Your terminal adds its own fee on top: 1% on BLIX.`],
    ["Does BLIX show LetsBonk coins?", `Yes. Blix reads Raydium LaunchLab's events from the chain, so LetsBonk launches and trades are live. They lack a holder ledger because LaunchLab's events do not name the trader.`],
  ],
});

const vsMoon = page({
  path: "/pump-fun-vs-moonshot", crumb: "pump.fun vs Moonshot", eyebrow: `Launchpads · checked ${CHECKED}`,
  title: "pump.fun vs Moonshot (Moonit): Solana Launchpads Compared | BLIX",
  description: "pump.fun vs Moonshot, now Moonit: how the two launchpads differ, what happened to Moonshot in 2026, and how BLIX tracks launches across Solana.",
  h1: "pump.fun vs Moonshot",
  lede: `Moonshot was DEX Screener's answer to pump.fun: a launchpad with card payments and a mobile app, later rebranded Moonit. As of ${CHECKED} its site showed a maintenance notice and no live pools in the sources we checked, while pump.fun remained the dominant Solana launchpad. This page compares the two as they were designed, and shows where BLIX fits.`,
  body: `${START()}
${table(["", "pump.fun", "Moonshot / Moonit"], [
    ["Model", "Free creation, bonding curve, graduation to PumpSwap", "Bonding curve with fiat on-ramp (card and Apple Pay in its app)"],
    ["Fees", "1.25% on the curve; PumpSwap tiered after", "Its own curve fee; check moon.it for current terms"],
    ["Status", "Live, the larger launchpad", "Rebranded Moonit; showed a maintenance notice at the time of checking"],
    ["In BLIX", "Full: Pulse, holders, rug check, AI, trade", "Coins that reach a Solana pool appear through DexScreener and GeckoTerminal pairs"],
  ], "cmp")}
<h2 id="checklist">Choosing a launchpad in 2026</h2>
${bullets([
    "<b>Where the buyers are.</b> A curve with no traffic is a coin with no bids. pump.fun's launch volume is the reason most coins still launch there.",
    "<b>What graduation looks like.</b> pump.fun moves coins to its own PumpSwap pool automatically at about 411 SOL of market cap; other launchpads graduate to Raydium or to nothing.",
    "<b>Fees, and who gets them.</b> pump.fun's curve fee is 1.25% with 0.30% to the creator, splittable with up to ten wallets or redirected to traders as a cashback coin.",
    "<b>Fiat on-ramp.</b> Moonshot's card payments were its edge; with its site in maintenance, the on-ramp question moves to the terminal (BLIX takes SOL deposits from any wallet or exchange).",
    "<b>Tooling.</b> Terminals, scanners and APIs cover pump.fun first. BLIX reads pump.fun and Raydium LaunchLab from the chain; Moonshot-era coins show up only once they trade on a pool.",
  ])}
<h2 id="trader">What it means for a trader</h2>
<p>If you trade launches, you trade pump.fun: that is where the Final stretch and the migrations are. If you hold Moonshot-era coins, BLIX shows them like any other Solana token once they are on a pool Jupiter routes, with holders, the chart and the AI rating. Launchpads come and go; the holder ledger and the rug check are the same on every coin.</p>
<h2 id="difference">The real difference</h2>
<p>pump.fun is a crypto-native curve: SOL in, graduation to its own DEX. Moonshot's bet was onboarding with a card, which brought new buyers but put the launchpad in the position of a payments app. For a trader the question is simpler: where are the coins and the volume? In 2026 that is pump.fun, with LetsBonk second, and BLIX follows both from the chain.</p>
${F.pulse()}
${links("More launchpad pages", [
    ["/pump-fun", "pump.fun explained", "The curve, the fees, graduation."],
    ["/pump-fun-vs-letsbonk", "pump.fun vs LetsBonk", "The two launchpads that matter."],
    ["/pump-fun-vs-raydium", "pump.fun vs Raydium", "PumpSwap and Raydium after graduation."],
  ])}
${NOT_AFFILIATED("pump.fun, Moonshot, Moonit or DEX Screener")}${RISK}`,
  faq: [
    ["Is Moonshot still running?", `Moonshot rebranded to Moonit (moon.it). At the time of checking (${CHECKED}) the sources we found showed a maintenance notice; check its site for the current state.`],
    ["Does BLIX track Moonshot coins?", `Coins that reach a Solana pool show up through DexScreener and GeckoTerminal pairs. The deep coverage (launch to migration, holders from the first trade) is for pump.fun and Raydium LaunchLab, which Blix reads from the chain.`],
  ],
});

const vsRay = page({
  path: "/pump-fun-vs-raydium", crumb: "pump.fun vs Raydium", eyebrow: `Launchpads and DEXes · checked ${CHECKED}`,
  title: "pump.fun vs Raydium: PumpSwap, LaunchLab and Where Coins Trade | BLIX",
  description: "pump.fun vs Raydium: PumpSwap replaced Raydium migrations in 2025 and Raydium answered with LaunchLab. Fees, graduation, and how BLIX trades both in one click.",
  h1: "pump.fun vs Raydium",
  lede: `Until March 2025 every pump.fun coin that completed its curve migrated to a Raydium pool. Then pump.fun launched its own DEX, PumpSwap, and kept the migrations in house; Raydium answered with LaunchLab, the launchpad program behind letsbonk.fun. So "pump.fun vs Raydium" is now two full stacks: a launchpad and a DEX each. BLIX trades on both, routed through Jupiter, from the same screen.`,
  body: `${START()}
${table(["", "pump.fun stack", "Raydium stack"], [
    ["Launchpad", "pump.fun: free creation, 1.25% curve fee", "LaunchLab (letsbonk.fun and others built on it)"],
    ["DEX after graduation", "PumpSwap: fee tiered by market cap, 0.95% down to 0.05%", "Raydium pools (standard, CPMM, CLMM) with per-pool fees"],
    ["Graduation", "0.015 SOL, automatic", "Per the LaunchLab config"],
    ["Who trades it", "Any Solana DEX aggregator (Jupiter) routes both", "Same"],
    ["In BLIX", "Pulse, holders, rug check, AI, one-click trade", "Discover, chart, AI, one-click trade"],
  ], "cmp")}
<h2 id="fees">Fees along the way</h2>
${table(["Stage", "pump.fun stack", "Raydium stack"], [
    ["Launch", "Free; about 0.025 SOL of network fees with a first buy", "Free on LaunchLab-based launchpads; network fees"],
    ["On the curve", "1.25% (0.95% protocol, 0.30% creator)", "LaunchLab's configured curve fee; letsbonk.fun routes part of it to BONK buybacks"],
    ["Graduation", "0.015 SOL, automatic, to PumpSwap", "Automatic, to a Raydium pool"],
    ["In the pool", "PumpSwap: tiered by market cap, 0.95% down to 0.05%", "Raydium: 0.25% on standard pools; CLMM tiers from 0.01% to 1%"],
    ["Your terminal", "BLIX 2% (1.6% with an invite); Jupiter picks the pool", "Same"],
  ])}
<h2 id="launchlab">LaunchLab versus pump.fun for creators</h2>
<p>pump.fun gives a creator one curve, one fee split (0.30% of every curve trade, splittable with up to ten wallets or paid back to traders as a cashback coin) and the largest launch audience. LaunchLab lets a launchpad configure the curve and the quote token and build its own brand on top (letsbonk.fun is the best known), which is why some LaunchLab coins are priced in USD1 or another token. BLIX's launcher creates pump.fun coins; LaunchLab coins show on BLIX from the chain once they trade.</p>
<h2 id="trade">Where you actually trade</h2>
<p>A trader does not pick a DEX: Jupiter routes the swap through whichever pool gives the best price, PumpSwap or Raydium or both. BLIX quotes and executes through Jupiter, so a pump.fun coin that graduated to PumpSwap and a LetsBonk coin on Raydium are bought the same way, in one click, from your Blix wallet.</p>
${F.chart()}
${links("More launchpad pages", [
    ["/pump-fun", "pump.fun explained", "The curve, the fees, graduation."],
    ["/pump-fun-vs-letsbonk", "pump.fun vs LetsBonk", "The launchpad side of Raydium."],
    ["/solana-swap", "Solana swaps on BLIX", "How a trade is routed and what it costs."],
  ])}
${NOT_AFFILIATED("pump.fun or Raydium")}${RISK}`,
  faq: [
    ["Do pump.fun coins still migrate to Raydium?", `No. Since March 2025 graduated pump.fun coins move to PumpSwap, pump.fun's own DEX. Older coins that migrated before then still trade on Raydium.`],
    ["Which has lower fees, PumpSwap or Raydium?", `PumpSwap's fee is tiered by market cap (0.95% just after graduation, down to 0.05% for large coins); Raydium's depends on the pool type. Jupiter routes to the better price either way.`],
    ["Can I trade Raydium coins on BLIX?", `Yes. Any Solana coin Jupiter can route is tradable in one click, and Discover lists the trending and new pools across Solana.`],
  ],
});

export const PUMP_PAGES = [hub, scanner, bot, terminal, analytics, signals, mcp, sdk, ws, py, js, walletTracker, rug, vsBonk, vsMoon, vsRay];
