// Competitor pages: what each terminal is (for people searching the brand), the features people search for with a
// brand name in front (bot, scanner, MCP, API), the "alternative" pages for terminals the compare hub does not cover,
// and the head-to-head pages. Facts checked on CHECKED; where a product publishes nothing, the page says so.
import { F, FACT, START, DEV_CTA, SIGNIN_DEV, DISCORD, COMMUNITY, NOT_AFFILIATED, RISK, CHECKED, BASE, N_ENDPOINTS, N_TOOLS, MCP_SETUP, code, table, facts, steps, bullets, callout, links, page, compare, TERMINALS, ext } from "./pagekit.js";

const COMPARE_MORE = links("More comparisons", [
  ["/best-solana-trading-terminal", "Best Solana trading terminal", "All of them on one table."],
  ["/compare", "BLIX compared", "Side by side with Axiom, Fomo and nio.trade."],
  ["/axiom-vs-fomo", "Axiom vs Fomo", "Speed versus social."],
  ["/axiom-vs-photon", "Axiom vs Photon", "The two fast ones."],
  ["/axiom-vs-gmgn", "Axiom vs GMGN", "Solana speed versus multi-chain."],
  ["/bullx-alternative", "BullX alternative", "After BullX suspended trading."],
]);
const BLIX_ADDS = `<h2 id="blix">What BLIX adds to any of them</h2>
<p>An AI rating on every coin, deep reads with a grade and a plan, daily picks with a public record, narratives written up each day, known traders' faces on the chart and in holder lists, a rug check in one number, a coin launcher, an API and MCP connector with the account, and the Discord. At 2% a trade (1.6% with an invite), with your own wallet you can export.</p>`;

// ---------- Fomo ----------
const fomoApp = page({
  path: "/fomo-app", crumb: "Fomo app", eyebrow: `Fomo · checked ${CHECKED}`,
  title: "Fomo App: Fees, Chains, Download, and BLIX Compared | BLIX",
  description: "5% spot fee with gas covered, iOS, Android and web. How BLIX reads Fomo's traders and what it adds.",
  h1: "The Fomo app, explained, and BLIX beside it",
  lede: `Fomo (fomo.family, by Fomo Labs) is a social trading app: a feed of other traders' buys, sells and theses, trending coins, one-tap trades on Solana, Base and BNB with network fees covered, and perps. Its spot fee is about 0.5% and is quoted before each trade. BLIX is a different kind of terminal that reads Fomo's traders from the chain: their wallets, their trades and their faces show up in BLIX's holder lists, leaderboard and feed, next to the AI reads and the rug check Fomo does not have.`,
  body: `${START("Try BLIX")}
${table(["", "Fomo", "BLIX"], [
    ["What it is", "Social trading app (iOS, Android, web)", "AI memecoin terminal in the browser"],
    ["Chains", "Solana, Base, BNB, plus perps", "Solana"],
    ["Fee", "About 0.5% spot, quoted per trade; network fees covered on most chains", "2% (1.6% with an invite) plus network fee"],
    ["Keys", "Non-custodial app", "Blix wallet made at sign-up; export the key or withdraw any time"],
    ["Social", "Feed of traders' buys, sells and theses; leaderboards", "Fomo and pump.fun leaderboards merged; traders' faces on charts and holder lists; live feed of big Fomo trades"],
    ["AI", "None", "Rating on every coin, deep reads, daily picks, narratives"],
    ["Rug check", "Basic token info", "Dev history, bundles, snipers, authorities, liquidity, bubble map"],
    ["API / MCP", "None published", "API and MCP connector with every account"],
    ["Coin launcher", "No", "pump.fun launch in one screen"],
  ], "cmp")}
<h2 id="setup">Fomo setup, tutorial and download, in short</h2>
<p>Fomo is installed from the iOS App Store or Google Play (publisher Fomo Labs Inc.) or used on the web; you create a wallet in the app, fund it, and trade from the feed or the search. Beware of Telegram bots calling themselves an "official Fomo bot": Fomo publishes none, and several have been reported as phishing. If you want a Fomo tutorial, the app's own help centre is the source; this page is about what BLIX does with Fomo's public data.</p>
<h2 id="blix-fomo">How BLIX uses Fomo's traders</h2>
${F.wallets("Fomo's leaderboard, as wallets")}
${F.feed("Big Fomo trades in the feed")}
${F.holders("Fomo traders' faces in holder lists")}
${BLIX_ADDS}
${links("More Fomo pages", [
    ["/compare/fomo-alternative", "Fomo alternative", "BLIX as an alternative, with the unknowns stated."],
    ["/fomo-api", "Fomo API", "Is there one? What the unofficial ones sell."],
    ["/fomo-mcp", "Fomo MCP, SDK and CLI", "None official; what BLIX gives you instead."],
    ["/fomo-trading-bot", "Fomo trading bot", "Why there is no official bot, and what to do instead."],
    ["/fomo-scanner", "Fomo scanner", "Fomo's discovery versus a scanner with AI."],
    ["/axiom-vs-fomo", "Axiom vs Fomo", "Speed versus social."],
  ])}
${NOT_AFFILIATED("Fomo (Fomo Labs)")}${RISK}`,
  faq: [
    ["What is the Fomo app?", `A social memecoin trading app by Fomo Labs with a feed of traders' buys, sells and theses, one-tap trading on Solana, Base and BNB with network fees covered, and perps. Spot fees are about 0.5%, quoted before each trade.`],
    ["Is Fomo free?", `Free to install; it charges a fee per trade (about 0.5% on spot, 0.05% on perps per reviews we checked). Sources disagree on the exact schedule, so read the quote in the app.`],
    ["Is there a Fomo trading terminal for desktop?", `Fomo has a web app. BLIX is a browser terminal that includes Fomo's traders' activity from the chain, plus AI reads and a rug check.`],
    ["Does BLIX connect to my Fomo account?", `No. BLIX reads public on-chain activity of Fomo's leaderboard traders; nothing about your Fomo account is involved.`],
  ],
});

const fomoBot = page({
  path: "/fomo-trading-bot", crumb: "Fomo trading bot", eyebrow: `Fomo bots · checked ${CHECKED}`,
  title: "Fomo Trading Bot: There Is No Official One. What to Use Instead | BLIX",
  description: "Searching for a Fomo bot, Fomo memecoin bot or Fomo automation? Fomo publishes none, and 'official Fomo bot' Telegram bots are phishing.",
  h1: "Fomo trading bot: what exists, and what to use instead",
  lede: `There is no official Fomo bot. Fomo (fomo.family) is an app you trade in by hand, it publishes no API, and the Telegram bots that call themselves the "official Fomo bot" have been reported as phishing for wallet logins. What people want from a "Fomo bot" is usually one of two things: to copy Fomo's best traders, or to automate their own trading. BLIX does the first from the chain and the second with exit rules, without touching your Fomo account.`,
  body: `${START()}
${callout(`<b>Never give a bot your Fomo login or seed phrase.</b> Fomo's wallet is non-custodial; anyone with your credentials controls it. Reading a trader's public activity never needs a login.`)}
<h2 id="copy">Fomo's best traders, from the chain</h2>
${F.wallets("Fomo's leaderboard as wallets")}
${F.smart("Their buys as signals")}
<h2 id="automate">Automate the part that matters: exits</h2>
<p>Every position on BLIX runs a take profit, a stop loss and a trailing stop on the server, in paper and live mode. That is the automation most "bots" sell, without a bot holding your keys. Buys stay yours, one click, with the holders and the rug check on screen.</p>
${F.rating("The read a bot cannot give you")}
<h2 id="build">Build your own on the open API</h2>
<p>The BLIX API, included with your account, has <code>GET /api/fomo</code> (what Fomo traders are buying, top Fomo traders) and any wallet's holdings, trades and positions from the chain. It never signs; real trades are made in the terminal. See the <a href="/fomo-api">Fomo API page</a>.</p>
${links("More Fomo pages", [
    ["/fomo-app", "The Fomo app", "What it is, fees, chains."],
    ["/fomo-api", "Fomo API", "Is there one?"],
    ["/fomo-mcp", "Fomo MCP, SDK and CLI", "What BLIX gives you instead."],
    ["/compare/fomo-alternative", "Fomo alternative", "BLIX beside Fomo."],
    ["/ai-trading-bot", "AI trading bot", "Bots versus a terminal with AI."],
  ])}
${NOT_AFFILIATED("Fomo (Fomo Labs)")}${RISK}`,
  faq: [
    ["Is there an official Fomo bot?", `No. Fomo publishes no bot, API or automation. Telegram bots using the name have been reported as phishing.`],
    ["Can I copy-trade Fomo traders?", `BLIX follows Fomo's leaderboard wallets and shows their buys as signals with each wallet's record. BLIX does not mirror trades automatically; by the time a mirror fills, the edge is usually gone.`],
    ["Is there a Fomo Solana bot or memecoin bot?", `Not from Fomo. BLIX is a terminal that includes Fomo's traders' public activity and automates your exits.`],
  ],
});

const fomoMcp = page({
  path: "/fomo-mcp", crumb: "Fomo MCP, SDK, CLI", og: "og-mcp.png", eyebrow: `Fomo developers · checked ${CHECKED}`,
  title: "Fomo MCP Server, SDK & CLI: None Official. Use BLIX | BLIX",
  description: "Fomo (fomo.family) publishes no MCP server, SDK, CLI or developer API. With a BLIX account, the MCP connector gives an AI agent what Fomo's traders are buying.",
  h1: "Fomo MCP server, SDK and CLI: none official",
  lede: `As of ${CHECKED} Fomo publishes no developer API, MCP server, SDK, CLI or docs; third-party "Fomo APIs" resell data on credits. BLIX takes a different route: it follows Fomo's leaderboard traders as ordinary Solana wallets from the chain, serves what they are buying as JSON, and exposes it to AI agents through the <a href="/mcp">BLIX MCP connector</a> (<code>blix_fomo</code>, <code>blix_wallets</code>, <code>blix_wallet</code>). It comes with a BLIX account; no Fomo login is involved.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">BLIX MCP</a>`)}
${table(["You searched for", "Fomo", "BLIX"], [
    ["Fomo MCP server", "None", `MCP connector: ${N_TOOLS} tools incl. blix_fomo, with your account`],
    ["Fomo developer API", "None published", `${N_ENDPOINTS} endpoints incl. /api/fomo and any wallet's trades, with your account`],
    ["Fomo SDK", "None", "HTTPS + JSON; a 20-line client in any language"],
    ["Fomo CLI", "None", "curl and jq; AI CLIs through the connector"],
    ["Fomo integration / automation", "None", "Signals, paper desk, live stream"],
  ], "cmp")}
${SIGNIN_DEV}
<h2 id="mcp">What an agent gets</h2>
<p><code>blix_fomo</code> returns what Fomo traders are buying (flow per coin, sampled from the swaps Fomo sponsors) and the top Fomo traders; <code>blix_wallet</code> returns any wallet's holdings, swaps and positions from the chain. Setup:</p>
${MCP_SETUP.download}
${MCP_SETUP.claudeCode}
${MCP_SETUP.json}
<h2 id="api">The API side</h2>
${code(`curl -s ${BASE}/api/fomo -H "cookie: blix_wait=$BLIX_SESSION"
curl -s ${BASE}/api/wallet-page/<wallet> -H "cookie: blix_wait=$BLIX_SESSION"`, "bash")}
${COMMUNITY}
${links("More Fomo pages", [
    ["/fomo-api", "Fomo API", "The unofficial APIs and what they cost."],
    ["/fomo-app", "The Fomo app", "What it is."],
    ["/crypto-mcp-server", "Crypto MCP servers", "What is out there."],
    ["/memecoin-mcp-server", "Memecoin MCP connector", "All the tools."],
  ])}
${NOT_AFFILIATED("Fomo (Fomo Labs)")}`,
  faq: [
    ["Does Fomo have an MCP server?", `No. The BLIX MCP connector is independent and reads Fomo's traders from the chain, with your BLIX account.`],
    ["Does Fomo have an SDK or CLI?", `No. BLIX's API is plain HTTPS, so any language is a client and curl is the CLI.`],
    ["Do I need a Fomo account?", `No. Nothing here touches a Fomo account; it reads public on-chain activity.`],
  ],
});

const fomoScanner = page({
  path: "/fomo-scanner", crumb: "Fomo scanner", eyebrow: `Fomo scanner · checked ${CHECKED}`,
  title: "Fomo Scanner & Signals vs a Scanner with AI | BLIX",
  description: "Fomo token scanner, signals or analytics? What Fomo's app shows, and how BLIX scans every Solana coin with Fomo's traders in view, an AI rating and a rug check.",
  h1: "Fomo scanner, signals and analytics",
  lede: `Fomo's discovery is social: trending coins and a feed of what traders are buying. A scanner needs more: every launch, the holders, the risk and a read. BLIX scans every Solana coin live and folds Fomo's traders in (their buys in the feed, their faces in holder lists, their leaderboard ranked by profit), with an AI rating and a rug check on every row. If you came for "Fomo signals" or "Fomo analytics", this is where they live outside the app.`,
  body: `${START("Open the scanner")}
${table(["", "Fomo app", "BLIX"], [
    ["Discovery", "Trending coins; the social feed", "Every pump.fun launch live; Trending, Surge, New, Bonded; Final stretch and Migrated"],
    ["Fomo traders", "The feed, inside the app", "Big Fomo trades in the feed; traders' faces on charts and holder lists; merged leaderboard"],
    ["Signals", "Trader activity", "Dumps, dev sells, smart-wallet buys, AI calls, narratives, each with a record"],
    ["Analytics", "Portfolio", "Volume, holders, momentum, liquidity, fees paid, narrative heat, track record"],
    ["AI", "None", "Rating on every coin; deep reads; daily picks"],
    ["Rug check", "Basic", "Dev history, bundles, snipers, authorities, liquidity, bubble map"],
  ], "cmp")}
${F.pulse()}
${F.feed()}
<h2 id="read">How to scan with Fomo's traders in view</h2>
${steps([
    "Open the feed: big Fomo buys, sells and theses arrive live beside pump.fun callouts, with each position's profit moving. A coin several Fomo leaderboard traders bought in the last minutes is the social signal Fomo's app shows, with the chain as the source.",
    "Open the coin. The holder list names the Fomo traders in it with their faces and the Top traders board's profit for each, so \"traders are buying\" becomes \"these three traders with these records bought at these prices\".",
    "Check the rest of the row: the dev, bundles and snipers, the top-10 share, the rating and its reason. A coin Fomo traders are piling into can still be a bundle; the panel says so.",
    "Watch the traders whose records hold up: BLIX follows them, and their next buys become signals with the record beside them.",
  ])}
<h2 id="faces">Why faces beat a feed</h2>
<p>A social feed shows activity; a scanner with faces shows who. On BLIX the known traders' faces sit on the exact candle where they bought and sold, so you see whether the Fomo crowd bought the dip or sold the top, and whether they are still in. That is the difference between a social signal and a social record.</p>
${F.rating()}
${F.safety()}
${links("More Fomo pages", [
    ["/fomo-app", "The Fomo app", "What it is, fees, chains."],
    ["/compare/fomo-alternative", "Fomo alternative", "BLIX beside Fomo."],
    ["/memecoin-scanner", "Memecoin scanner", "The scanner in full."],
    ["/memecoin-signals", "Memecoin signals", "Every signal type and its record."],
  ])}
${NOT_AFFILIATED("Fomo (Fomo Labs)")}${RISK}`,
  faq: [
    ["Does Fomo have a token scanner?", `Fomo shows trending coins and a social feed inside its app. BLIX is a full scanner (every launch, holders, risk, AI) that includes Fomo traders' public activity.`],
    ["Where can I see Fomo signals?", `In BLIX's feed and signals: big Fomo buys, sells and theses from the chain, plus smart-wallet buys from the Fomo leaderboard's traders.`],
    ["Is there a Fomo analytics dashboard?", `BLIX's analytics include Fomo flow per coin and the top Fomo traders by profit, beside every other number.`],
  ],
});

// ---------- Axiom ----------
const axiomTrade = page({
  path: "/axiom-trade", crumb: "Axiom Trade", eyebrow: `Axiom · checked ${CHECKED}`,
  title: "Axiom Trade: Fees, Pulse, Setup and What BLIX Adds (2026) | BLIX",
  description: "Axiom Trade in 2026: the Pulse, 1% fee with cashback tiers, Turnkey keys, Hyperliquid perps, wallet and X tracking, and the February 2026 incident.",
  h1: "Axiom Trade, explained, and BLIX beside it",
  lede: `Axiom Trade (axiom.trade) is the Solana memecoin terminal that set the pattern: the Pulse with three columns of coins by lifecycle, filters for holders, bundles and dev behaviour, wallet and X tracking, fast execution with keys you can export, and Hyperliquid perps up to 50x. It charges 1% a trade less cashback by volume. BLIX follows the same Pulse layout and adds what Axiom does not have: an AI reading every coin, daily picks with a record, narratives, an API and MCP connector with every account, and a coin launcher. Not affiliated; facts checked ${CHECKED}.`,
  body: `${START("Try BLIX")}
${compare(["axiom", "blix"])}
<h2 id="pulse">Axiom's Pulse, and BLIX's</h2>
<p>Both show New pairs, Final stretch and Migrated as live columns with market cap, volume, holders, age and the coin's links, and both filter by liquidity, holders, bundle and sniper share and dev behaviour. BLIX adds an AI rating with a one-line reason on each row, a same-ticker count so copies stand out, known traders' faces, and a rug check in one number.</p>
<h2 id="setup">Axiom setup and tutorial, in short</h2>
<p>Sign up at axiom.trade (invite codes circulate; a referral takes a share off the base fee), create or import a wallet (keys are held non-custodially via Turnkey and can be exported), deposit SOL, and trade from the Pulse with preset sizes. Priority fee and bribe default to 0.001 SOL each. Axiom publishes no API, SDK or desktop download; "Axiom download" results are often clones, which Axiom itself warns about.</p>
<h2 id="incident">The February 2026 incident</h2>
<p>In February 2026 a staff member misused internal tools to look up users' wallets; Axiom disclosed it and reviewers still flag it. It is a reminder that a hosted terminal's internal access matters as much as its custody model. BLIX's wallets are held in a separate vault service and keys are exportable at any time.</p>
${BLIX_ADDS}
${F.rating()}
${F.api()}
${links("More Axiom pages", [
    ["/compare/axiom-alternative", "Axiom alternative", "BLIX as an alternative, with sources."],
    ["/axiom-api", "Axiom API", "Is there one?"],
    ["/axiom-mcp", "Axiom MCP, SDK and CLI", "None official; what BLIX gives you instead."],
    ["/axiom-trading-bot", "Axiom trading bot", "Bots, automations, and what BLIX runs for you."],
    ["/axiom-scanner", "Axiom scanner", "Pulse versus a scanner with AI."],
    ["/axiom-vs-fomo", "Axiom vs Fomo", "Speed versus social."],
  ])}
${NOT_AFFILIATED("Axiom Trade")}${RISK}`,
  faq: [
    ["What are Axiom Trade's fees?", `1% per spot swap, reduced by 0.05–0.25% SOL cashback depending on your volume (about 0.75–0.95% net), plus priority fees and bribes charged separately. A referral takes a further share off the base. Checked ${CHECKED}; sources disagree on the exact referral terms.`],
    ["Is Axiom Trade safe?", `It is non-custodial through Turnkey with exportable keys, and widely used. In February 2026 a staff member misused internal tools to look up users' wallets; clone sites and fake apps are a known risk. Verify the domain.`],
    ["Does Axiom have an app or download?", `Axiom is a web app; it publishes no desktop installer. Treat "Axiom download" links with suspicion.`],
    ["Is BLIX better than Axiom?", `Different. Axiom is faster to execute and has perps; BLIX has AI reads, an open API, a launcher and a trade API, at 2% a trade. Many traders use both.`],
  ],
});

const axiomBot = page({
  path: "/axiom-trading-bot", crumb: "Axiom trading bot", eyebrow: `Axiom bots · checked ${CHECKED}`,
  title: "Axiom Trading Bot & Automation: What Exists (2026) | BLIX",
  description: "Axiom Trade has no bot or public API; its automation is limit orders and migration sniping in the app.",
  h1: "Axiom trading bot and automation",
  lede: `Axiom publishes no bot and no API, so an "Axiom bot" is either Axiom's own in-app automation (limit orders, migration sniping) or a third-party script that logs in as your account. BLIX's answer is different: a terminal that automates the part worth automating (your exits), puts an AI read and a rug check on every coin before you buy, and gives anyone building a real bot an API with their own account, with no Axiom login to risk.`,
  body: `${START()}
${table(["", "Axiom", "BLIX"], [
    ["In-app automation", "Limit orders, migration sniping, presets", "Take profit, stop loss, trailing stop, partial sells, run on the server"],
    ["Bot / API", "None published; unofficial SDKs sign in as your account", `API (${N_ENDPOINTS} endpoints) and MCP connector with every BLIX account`],
    ["AI", "None", "Rating on every coin, deep reads, picks, narratives"],
    ["Copy trading", "Wallet tracking", "Wallet tracking with PnL; smart money found from the chain; buys as signals"],
    ["Execution", "Fast, in the app", "One click, Jupiter routes, priority fee per trade"],
  ], "cmp")}
${callout(`<b>Unofficial Axiom bots and SDKs use your Axiom session.</b> If one breaks or turns malicious it can act as you. Read the code or do not run it.`)}
<h2 id="exits">What BLIX automates</h2>
<p>Every position carries take profit, stop loss and trailing stop rules that run while you are away, in paper and live mode. The AI's exit plan from a deep read can be applied in one click. Buys are yours, from a screen that already shows the holders, the rug check and the rating.</p>
${F.rating()}
${F.smart()}
<h2 id="build">Building a bot without Axiom</h2>
<p>The BLIX API gives the same Pulse data Axiom shows (new pairs, final stretch, migrated, holders, bundles, snipers) as JSON and a live stream, with your account. See <a href="/how-to-build-a-solana-trading-bot">how to build a Solana trading bot</a> and the <a href="/axiom-api">Axiom API page</a>.</p>
${links("More Axiom pages", [
    ["/axiom-trade", "Axiom Trade explained", "Fees, Pulse, setup."],
    ["/axiom-api", "Axiom API", "Is there one?"],
    ["/axiom-mcp", "Axiom MCP, SDK and CLI", "What BLIX gives you instead."],
    ["/compare/axiom-alternative", "Axiom alternative", "BLIX beside Axiom."],
    ["/pump-fun-trading-bot", "pump.fun trading bot", "Snipers, bundlers and what works."],
  ])}
${NOT_AFFILIATED("Axiom Trade")}${RISK}`,
  faq: [
    ["Does Axiom have a trading bot?", `No. Axiom's automation is in-app (limit orders, migration sniping). Third-party "Axiom bots" are unofficial and use your session.`],
    ["Can I automate Axiom trades through an API?", `Axiom publishes no API. BLIX's API, included with your account, gives you the same kind of data; real trades are made in the terminal.`],
    ["Does BLIX have a bot?", `It automates exits on every position and runs an AI on every coin; buys are yours, in one click.`],
  ],
});

const axiomMcp = page({
  path: "/axiom-mcp", crumb: "Axiom MCP, SDK, CLI", og: "og-mcp.png", eyebrow: `Axiom developers · checked ${CHECKED}`,
  title: "Axiom MCP Server, SDK & CLI: Axiom Trade Has None | BLIX",
  description: "Axiom Trade publishes no MCP server, SDK, CLI or developer API (most 'Axiom MCP' results are axiom.co). The BLIX MCP connector gives an agent Axiom-style Pulse data.",
  h1: "Axiom MCP server, SDK and CLI: none from Axiom Trade",
  lede: `Searching "Axiom MCP" mostly finds Axiom (axiom.co), a logging and observability company with an MCP server for its own logs; it has nothing to do with Axiom Trade, the Solana terminal. Axiom Trade itself publishes no MCP server, SDK, CLI or API. If you want Axiom-style Pulse data (new pairs, final stretch, migrated, holders, bundles, snipers) as tools for an AI agent, the <a href="/mcp">BLIX MCP connector</a> serves exactly that, and it comes with a BLIX account.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">BLIX MCP</a>`)}
${callout(`<b>Two Axioms.</b> axiom.co = logs and observability (has an API and an MCP server for logs). axiom.trade = the Solana memecoin terminal (publishes no developer tools). This page is about the second.`)}
${table(["You searched for", "Axiom Trade", "BLIX"], [
    ["Axiom MCP server", "None", `MCP connector: ${N_TOOLS} tools, incl. blix_pulse and blix_holders`],
    ["Axiom developer API", "None; unofficial SDKs use your session", `${N_ENDPOINTS} endpoints, with your account`],
    ["Axiom SDK", "Unofficial packages only", "HTTPS + JSON; a 20-line client in any language"],
    ["Axiom CLI", "None", "curl and jq; AI CLIs through the connector"],
    ["Axiom integration / automation", "In-app only", "Live stream, signals, paper desk"],
  ], "cmp")}
${SIGNIN_DEV}
<h2 id="setup">Pulse data for an agent in two steps</h2>
${MCP_SETUP.download}
${MCP_SETUP.claudeCode}
<p>Then: "Show the final stretch like Axiom's Pulse, drop anything with bundles over 20%, and read the top three."</p>
<h2 id="map">Axiom's Pulse, as BLIX endpoints</h2>
${table(["Axiom shows", "BLIX endpoint / tool"], [
    ["New pairs, Final stretch, Migrated", "<code>GET /api/pulse</code> · <code>blix_pulse</code>"],
    ["Holders, top 10, bundles, snipers, dev", "<code>GET /api/holders/&lt;mint&gt;</code> · <code>blix_holders</code>"],
    ["Token info and safety", "<code>GET /api/token/&lt;mint&gt;</code> · <code>blix_coin</code>"],
    ["Chart", "<code>GET /api/candles/&lt;mint&gt;</code> · <code>blix_candles</code>"],
    ["Wallet tracking", "<code>GET /api/wallet-page/&lt;address&gt;</code> · <code>blix_wallet</code>"],
    ["Quote", "<code>GET /api/quote</code> · <code>blix_quote</code>"],
  ])}
${COMMUNITY}
${links("More Axiom pages", [
    ["/axiom-api", "Axiom API", "Is there one? The unofficial SDKs."],
    ["/axiom-trade", "Axiom Trade explained", "Fees, Pulse, setup."],
    ["/crypto-mcp-server", "Crypto MCP servers", "What is out there."],
    ["/memecoin-mcp-server", "Memecoin MCP connector", "All the tools."],
  ])}
${NOT_AFFILIATED("Axiom Trade or Axiom (axiom.co)")}`,
  faq: [
    ["Is there an Axiom Trade MCP server?", `No. The "Axiom MCP" you find is axiom.co's, for logs. The BLIX connector gives an agent Axiom-style Pulse data from the chain, with your account.`],
    ["Does Axiom Trade have an SDK or CLI?", `No official ones. Unofficial packages sign in as your account; Axiom does not support them.`],
    ["How do I get the BLIX connector?", `Create a BLIX account and open <a href="/developers">Developers</a>.`],
  ],
});

const axiomScanner = page({
  path: "/axiom-scanner", crumb: "Axiom scanner", eyebrow: `Axiom scanner · checked ${CHECKED}`,
  title: "Axiom Scanner vs BLIX Pulse with AI Ratings | BLIX",
  description: "Axiom's token scanner is the Pulse: three live columns with holder, bundle and dev filters. BLIX's Pulse adds an AI rating and a rug check on every row.",
  h1: "Axiom scanner versus a Pulse with AI",
  lede: `Axiom's scanner is its Pulse: new pairs, final stretch and migrated coins live, with filters for liquidity, age, holders, top-wallet concentration, dev behaviour and bundles. BLIX's Pulse has the same three columns and the same filters, and on every row an AI rating with its one-line reason, a same-ticker count, the rug check in one number, and the faces of known traders who are in the coin. If you want "Axiom signals", "Axiom analytics" or an "Axiom pump.fun scanner" with a read on each coin, this is it.`,
  body: `${START("Open the scanner")}
${table(["", "Axiom Pulse", "BLIX Pulse"], [
    ["Columns", "New pairs, Final stretch, Migrated", "New pairs, Final stretch, Migrated"],
    ["Filters", "Liquidity, age, holders, top wallets, dev, snipers, bundles", "Same, plus rating, stage and safety"],
    ["Per row", "Market cap, volume, holders, age, links", "Same, plus AI rating and reason, same-ticker count, rug check, known traders"],
    ["Signals", "Wallet and X tracking", "Dumps, dev sells, smart-wallet buys, AI calls, narratives, with a record"],
    ["Analytics", "Charts and token info", "Fees paid, momentum, narrative heat, track record"],
    ["Speed", "About a second from the chain", "About a second from the chain"],
  ], "cmp")}
${F.pulse()}
${F.rating()}
${F.safety()}
${F.narratives("Analytics Axiom does not have: narratives")}
<h2 id="filters">The same filters, where they live on BLIX</h2>
${table(["Axiom filter", "On BLIX", "What to set"], [
    ["Liquidity", "Column filter on Pulse; safety read per coin", "Minimum pool liquidity; the sellable-liquidity check at your size"],
    ["Age", "Column filter", "Minutes since launch; the Final stretch column is the age filter most people want"],
    ["Holders", "Column filter; holder panel", "Minimum holders; the panel adds traders versus holders"],
    ["Top 10 holders", "Column filter; holder panel", "Maximum top-10 share; the bubble map shows whether they are one cluster"],
    ["Dev holding / sold", "Holder panel; dev history", "Pass on a dev above about 5%, or a serial launcher"],
    ["Bundles / snipers", "Column filter; holder panel", "Maximum first-block share; 20% is where most traders pass"],
    ["Not on Axiom: rating, same-ticker count, known traders", "Every row", "Minimum rating; skip copies; see who is in"],
  ])}
<h2 id="signals-vs">Axiom signals versus BLIX signals</h2>
<p>Axiom's alerts come from the wallets and X accounts you track. BLIX has those too, and adds signals that come from the market itself: dump warnings, dev sells, milestones, smart-wallet buys found from the chain, AI buy calls, picks and narrative bursts, each re-priced at 15 minutes, 1 hour, 6 hours and 24 hours so the record per type is public. A scanner tells you what is moving; the record tells you which of its signals have been worth acting on.</p>
${links("More Axiom pages", [
    ["/axiom-trade", "Axiom Trade explained", "Fees, Pulse, setup."],
    ["/compare/axiom-alternative", "Axiom alternative", "BLIX beside Axiom."],
    ["/pump-fun-scanner", "pump.fun scanner", "The scanner in full."],
    ["/axiom-vs-photon", "Axiom vs Photon", "The two fast ones."],
  ])}
${NOT_AFFILIATED("Axiom Trade")}${RISK}`,
  faq: [
    ["Does Axiom have a token scanner?", `Its Pulse is the scanner: three live columns with holder, dev and bundle filters. BLIX's Pulse adds an AI rating and a rug check on every row.`],
    ["Is Axiom's Pulse free?", `Browsing the Pulse and tracking wallets on Axiom is free; trading pays 1% less cashback. BLIX is free with 2% a trade (1.6% with an invite).`],
    ["Which scanner is faster?", `Both list a pump.fun coin about a second after the chain. The difference is what is on the row.`],
  ],
});

// ---------- nio.trade ----------
const nio = page({
  path: "/nio-trade", crumb: "nio.trade", eyebrow: `nio.trade · checked ${CHECKED}`,
  title: "nio.trade: Chains, Cashback, and BLIX Compared (2026) | BLIX",
  description: "nio.trade in 2026: a multi-chain terminal (Solana, Ethereum, Base, BNB, Hyperliquid), non-custodial via Turnkey, cashback; fees unpublished. How BLIX compares.",
  h1: "nio.trade, explained, and BLIX beside it",
  lede: `nio.trade is a trading terminal that lists Solana, Ethereum, Base, BNB and Hyperliquid, keeps keys non-custodially through Turnkey, and advertises the "highest cashback across any terminal", referral points and no-KYC withdrawals. That is what its site says as of ${CHECKED}; we found no independent reviews, no published fee schedule, and no API, docs or source code. BLIX is Solana-only, includes an API and MCP connector with every account, and adds an AI read and a rug check on every coin.`,
  body: `${START("Try BLIX")}
${compare(["nio", "blix"])}
<h2 id="known">What is known about nio.trade</h2>
${bullets([
    "<b>Chains:</b> Solana, Ethereum, Base, BNB and Hyperliquid, per its homepage.",
    "<b>Custody:</b> non-custodial, with key management on Turnkey's infrastructure (the same provider Axiom uses).",
    "<b>Rewards:</b> cashback on trades, and points plus SOL from referred friends. \"Highest cashback\" is the site's own claim.",
    "<b>Withdrawals:</b> no KYC, per the site.",
    "<b>Not found:</b> a fee schedule, an API, an MCP server, an SDK, a CLI, docs or independent reviews. Check the app before funding it.",
  ])}
<h2 id="setup">nio.trade setup and tutorial</h2>
<p>We did not find an official tutorial. The flow its site describes is the usual one: sign in, a wallet is created for you under Turnkey, deposit, trade. Read the fee shown at the moment of the trade, since no schedule is published.</p>
${BLIX_ADDS}
${F.rating()}
${links("More nio.trade pages", [
    ["/compare/nio-trade-alternative", "nio.trade alternative", "BLIX beside nio.trade, with the unknowns stated."],
    ["/nio-trade-api", "nio.trade API, MCP, SDK", "None found; what BLIX gives you instead."],
    ["/best-solana-trading-terminal", "Best Solana trading terminal", "All of them on one table."],
  ])}
${NOT_AFFILIATED("nio.trade")}${RISK}`,
  faq: [
    ["What is nio.trade?", `A multi-chain trading terminal (Solana, Ethereum, Base, BNB, Hyperliquid) with non-custodial keys on Turnkey, cashback and referral rewards, and no-KYC withdrawals, per its own site. We found no independent coverage as of ${CHECKED}.`],
    ["What are nio.trade's fees?", `Not published on its homepage as far as we found. The site advertises cashback instead. Read the fee quoted in the app.`],
    ["Does nio.trade have a bot, scanner or signals?", `Its site does not describe them. BLIX has a scanner with AI ratings, signals with a record, and exit automation.`],
  ],
});

const nioApi = page({
  path: "/nio-trade-api", crumb: "nio.trade API", og: "og-api.png", eyebrow: `nio.trade developers · checked ${CHECKED}`,
  title: "nio.trade API, MCP, SDK & CLI: None Found. Use BLIX | BLIX",
  description: "nio.trade publishes no API, MCP server, SDK, CLI or docs as of October 2026. A BLIX account includes the API and MCP connector for Solana memecoin data.",
  h1: "nio.trade API, MCP, SDK and CLI: none found",
  lede: `As of ${CHECKED} we found no developer API, MCP server, SDK, CLI or documentation for nio.trade; its site describes a trading app with cashback and referrals. If what you need is Solana memecoin data for a bot or an AI agent, a BLIX account includes the <a href="/api">API</a> and the <a href="/mcp">MCP connector</a>: every launch, holder ledger, candle, quote and AI read.`,
  body: `${DEV_CTA()}
${table(["You searched for", "nio.trade", "BLIX"], [
    ["nio.trade API", "None found", `${N_ENDPOINTS} endpoints, with your account`],
    ["nio.trade MCP", "None found", `${N_TOOLS} tools for Claude, Cursor, Codex, Gemini`],
    ["nio.trade SDK / CLI", "None found", "HTTPS + JSON; curl and jq"],
    ["nio.trade docs", "None found", "Developer docs on this site; access with the account"],
    ["nio.trade integration / automation", "None found", "Live stream, signals, paper desk"],
  ], "cmp")}
${SIGNIN_DEV}
<h2 id="what">What you would build on nio.trade's data, built on BLIX instead</h2>
${table(["You want", "BLIX endpoint or tool", "Notes"], [
    ["New launches as they happen", "<code>launch</code> events on <code>GET /api/stream</code>", "pump.fun and LaunchLab from the chain, about a second after the block"],
    ["A coin's holders with the dev, snipers and bundles", "<code>GET /api/holders/&lt;mint&gt;</code> · <code>blix_holders</code>", "From the first trade; a coin seen mid-life is marked partial"],
    ["Candles and trades", "<code>GET /api/candles/&lt;mint&gt;</code>, <code>/api/coin/&lt;mint&gt;/trades</code>", "1-second to daily, from real trades"],
    ["A price to trade at", "<code>GET /api/quote</code> · <code>blix_quote</code>", "A real Jupiter quote with price impact"],
    ["A wallet's swaps and holdings", "<code>GET /api/wallet-page/&lt;address&gt;</code> · <code>blix_wallet</code>", "Built from the chain: holdings, swaps, positions, best trades"],
    ["The AI's read", "<code>GET /api/research/&lt;mint&gt;</code> · <code>blix_research</code>", "Grade, thesis, risks, plan, sources"],
    ["A place to test", "<code>POST /api/paper/quoted</code> · <code>blix_paper_buy</code>", "Your paper desk at real quotes"],
  ])}
<h2 id="checklist">Before you build on any terminal's data</h2>
${bullets([
    "<b>Is there a contract?</b> A documented API with a stable shape. nio.trade publishes none; BLIX's endpoints are listed on the <a href=\"/api\">API page</a>.",
    "<b>Does it need your login or key?</b> Unofficial terminal SDKs sign in as you. BLIX's API uses your own account's session and never a private key.",
    "<b>Where does the data come from?</b> Scraped pages break; chain-decoded data does not. BLIX decodes the pump.fun, PumpSwap and LaunchLab programs itself.",
    "<b>Can an agent use it?</b> BLIX's MCP connector exposes the same data as tools; nio.trade has no equivalent.",
  ])}
<h2 id="start">Start in a minute</h2>
${code(`export BLIX_SESSION="<from your Developers page>"
curl -s ${BASE}/api/pulse -H "cookie: blix_wait=$BLIX_SESSION"`, "bash")}
${MCP_SETUP.download}
${MCP_SETUP.claudeCode}
${COMMUNITY}
${links("More", [
    ["/nio-trade", "nio.trade explained", "What its site says, and what is not published."],
    ["/compare/nio-trade-alternative", "nio.trade alternative", "BLIX beside nio.trade."],
    ["/solana-api", "Solana memecoin API", "The endpoints."],
    ["/crypto-mcp-server", "Crypto MCP servers", "What is out there."],
  ])}
${NOT_AFFILIATED("nio.trade")}`,
  faq: [
    ["Does nio.trade have an API?", `We found none as of ${CHECKED}. If it publishes one later, this page will say so.`],
    ["Does nio.trade have an MCP server or SDK?", `None found. BLIX's API and MCP connector come with a BLIX account.`],
  ],
});

// ---------- alternatives the compare hub does not cover ----------
const alt = (o) => page({ eyebrow: `Alternatives · checked ${CHECKED}`, ...o });
const photonAlt = alt({
  path: "/photon-alternative", crumb: "Photon alternative",
  title: "Photon Alternative: Solana Terminals with AI (2026) | BLIX",
  description: "Photon alternatives in 2026: BLIX (AI on every coin, open API, launcher, 2% a trade), Axiom (speed, cashback), GMGN (multi-chain), Fomo (social).",
  h1: "Photon alternative",
  lede: `Photon is one of the fastest Solana terminals, with a sniper, Memescope and wallets generated in the app, at about 1% a trade (0.75% quoted by some reviews, 1% when the sniper is used). It has no AI, no public API and no launcher. The alternatives below each add something Photon lacks; BLIX adds an AI read and a rug check on every coin, an API and MCP connector with the account, a coin launcher, and exportable keys, at the same fee.`,
  body: `${START("Try BLIX")}
${compare(["photon", "blix", "axiom", "gmgn", "fomo"])}
<h2 id="pick">Which alternative</h2>
${table(["If you left Photon for", "Pick", "Why"], [
    ["A read on every coin before you buy", "BLIX", "AI rating, deep reads, daily picks with a record"],
    ["The same speed with exportable keys and perps", "Axiom", "Turnkey custody, cashback, Hyperliquid"],
    ["Other chains and copy trading", "GMGN", "Solana, Ethereum, Base, BNB, Tron"],
    ["A social feed on your phone", "Fomo", "Traders' buys, sells and theses; fees covered"],
    ["An API or an agent", "BLIX", "Included with the account"],
  ])}
${BLIX_ADDS}
${F.pulse("The Memescope equivalent")}
${COMPARE_MORE}
${NOT_AFFILIATED("Photon, Axiom Trade, GMGN or Fomo")}${RISK}`,
  faq: [
    ["What is the best Photon alternative?", `For AI and open data, BLIX; for speed with exportable keys, Axiom; for chains, GMGN; for social, Fomo. All charge about 1%.`],
    ["Is BLIX as fast as Photon?", `Both list a pump.fun coin about a second after the chain and execute in one click with a priority fee. Photon is built for raw speed; BLIX for the read before the click.`],
    ["Can I export my keys from BLIX?", `Yes, any time, or withdraw to another wallet.`],
  ],
});

const bullxAlt = alt({
  path: "/bullx-alternative", crumb: "BullX alternative",
  title: "BullX Alternative After the 2026 Suspension | BLIX",
  description: "BullX (and BullX Neo) suspended trading on June 1, 2026 with withdrawals open and no relaunch date.",
  h1: "BullX alternative",
  lede: `BullX suspended trading on its app on June 1, 2026. Withdrawals and wallet access stayed open, and as of ${CHECKED} no relaunch date had been published. If you traded on BullX or BullX Neo, the table below is the list of where to go, with fees, chains and custody checked. BLIX is the one with an AI read on every coin, an API and MCP connector with the account, and a coin launcher, at 2% a trade (0.8% with an invite).`,
  body: `${START("Move to BLIX")}
${callout(`<b>Still holding funds on BullX?</b> Withdrawals were reported as open after the suspension. Move them to a wallet you control before anything else.`)}
${compare(["bullx", "blix", "axiom", "photon", "gmgn", "fomo"])}
<h2 id="what-bullx-had">What BullX had, and where to find it</h2>
${table(["BullX feature", "Where now"], [
    ["Multi-chain (Solana, Ethereum, Base, BNB, Tron, Blast)", "GMGN; nio.trade (Solana, Ethereum, Base, BNB, Hyperliquid)"],
    ["Pulse-style discovery on Solana", "BLIX, Axiom, Photon"],
    ["Wallet tracking and copy", "GMGN (copy), BLIX (smart money found and followed from the chain, any wallet readable)"],
    ["Telegram-linked trading", "Fomo (mobile app); GMGN"],
    ["A read on each coin", "BLIX only"],
  ])}
${BLIX_ADDS}
${F.trade()}
${COMPARE_MORE}
${NOT_AFFILIATED("BullX, Axiom Trade, Photon, GMGN or Fomo")}${RISK}`,
  faq: [
    ["Is BullX still working?", `Trading on the BullX app was suspended on June 1, 2026; withdrawals and wallet access remained available and no relaunch date was published as of ${CHECKED}.`],
    ["What is the best BullX Neo alternative?", `For Solana with AI and an open API, BLIX; for speed, Axiom or Photon; for many chains, GMGN. See the table.`],
    ["Can I move my BullX wallet to BLIX?", `BLIX makes you a new wallet at sign-up; send SOL to it from any wallet or exchange. BullX keys can be imported into a standard wallet to withdraw.`],
  ],
});

const gmgnAlt = alt({
  path: "/gmgn-alternative", crumb: "GMGN alternative",
  title: "GMGN Alternative for Solana: AI Reads, 2% Fee | BLIX",
  description: "GMGN alternatives in 2026: BLIX adds an AI rating, deep reads and picks on every Solana coin, an API and MCP connector with the account, and a launcher, at 2% a trade.",
  h1: "GMGN alternative",
  lede: `GMGN covers Solana, Ethereum, Base, BNB, Tron and more, has the strongest copy trading of the terminals, smart-money tags and an OpenAPI with a key by application, at about 1% a trade. If you trade Solana memecoins and want a read on every coin and data you can build on without applying for a key, BLIX is the alternative: an AI rating, deep reads and daily picks with a record, an API and MCP connector with every account, a coin launcher and a rug check in one number, at 1% (0.8% with an invite).`,
  body: `${START("Try BLIX")}
${compare(["gmgn", "blix", "axiom", "photon"])}
<h2 id="api">GMGN's API versus Blix's</h2>
<p>GMGN's OpenAPI needs an API key obtained by uploading an Ed25519 public key, publishes no prices or rate limits, and trades with your private key from a whitelisted IP. BLIX's API comes with your account, never takes a private key and never signs; it covers Solana only and goes deeper on pump.fun (holders from the first trade, bundles and snipers). The <a href="/gmgn-api">GMGN API page</a> maps GMGN's endpoints to Blix's.</p>
${BLIX_ADDS}
${F.smart("Smart money, found rather than tagged")}
${F.rating()}
${COMPARE_MORE}
${NOT_AFFILIATED("GMGN, Axiom Trade or Photon")}${RISK}`,
  faq: [
    ["What is the best GMGN alternative for Solana?", `BLIX, if you want AI reads and an open API at the same fee; Axiom or Photon for raw speed. For GMGN's other chains, GMGN itself or nio.trade.`],
    ["Does BLIX have copy trading like GMGN?", `BLIX follows wallets with PnL and raises their buys as signals; it does not mirror trades automatically.`],
    ["Is BLIX multi-chain?", `No, Solana only. GMGN is the choice for Ethereum, Base, BNB or Tron memecoins.`],
  ],
});

const dexAlt = alt({
  path: "/dexscreener-alternative", crumb: "DEX Screener alternative",
  title: "DEX Screener Alternative for Solana Memecoins | BLIX",
  description: "DEX Screener alternatives for Solana: BLIX adds holders with snipers and bundles from the first trade, an AI rating and deep reads, a rug check.",
  h1: "DEX Screener alternative",
  lede: `DEX Screener is the universal chart and pair screener: every chain, every pool, fast, free, with paid boosts and a public API. What it does not do is tell you who holds a Solana memecoin, whether the dev sold, whether the first block was bundled, or what a model makes of it, and it does not trade. BLIX is Solana-only and does all of that: holders from the first trade, a rug check and an AI rating on every coin, known traders' faces on the chart, and a buy in one click.`,
  body: `${START("Try BLIX")}
${compare(["dexscreener", "blix", "birdeye"], ["fee", "chains", "ai", "api", "paper", "launch", "status"])}
<h2 id="difference">What a screener leaves out</h2>
${table(["DEX Screener shows", "BLIX adds"], [
    ["Pairs, price, volume, liquidity, charts", "Holders with dev, sniper and bundle tags from the first trade"],
    ["Boosted and trending pairs", "Trending by live traction with bot volume discounted; AI rating on every row"],
    ["Token profile and links", "Rug check in one number; dev history; bubble map of linked wallets"],
    ["A chart", "The same chart with known traders' faces where they bought and sold"],
    ["A swap link", "One-click trading from your Blix wallet, exits run for you"],
  ])}
${BLIX_ADDS}
${F.holders()}
<h2 id="data">Data and API</h2>
<p>DEX Screener's API is public and rate-limited, across chains. BLIX's comes with your account, is Solana-only and deeper on memecoins; BLIX also reads DEX Screener's and GeckoTerminal's pair lists as one of its sources. See the <a href="/memecoin-api">memecoin API</a>.</p>
${COMPARE_MORE}
${NOT_AFFILIATED("DEX Screener, Birdeye or GeckoTerminal")}${RISK}`,
  faq: [
    ["What is the best DEX Screener alternative for Solana memecoins?", `BLIX, if you want holders, a rug check, an AI read and trading on the same screen. Birdeye and GeckoTerminal are the closest like-for-like chart and data alternatives.`],
    ["Does BLIX cover other chains?", `No, Solana only. DEX Screener remains the tool for everything else.`],
    ["Is BLIX free like DEX Screener?", `Yes. Trading pays 2% a trade; browsing, scanning and paper trading are free.`],
  ],
});

const birdeyeAlt = alt({
  path: "/birdeye-alternative", crumb: "Birdeye alternative",
  title: "Birdeye Alternative for Solana Memecoin Data | BLIX",
  description: "Birdeye alternatives for Solana memecoins: BLIX gives holders from the first trade, a rug check, AI reads.",
  h1: "Birdeye alternative",
  lede: `Birdeye is a Solana data product: charts, token stats, wallet portfolios and an API with paid tiers. For memecoin trading it stops short of the decisions: who sniped the launch, whether the dev sold, whether the coin is a rug, and what to do about it. BLIX is a terminal built on its own chain reader: holders from the first trade, a rug check and an AI rating on every coin, wallet tracking with realized and open PnL, and one-click trading, with an API that has no tiers, included with the account.`,
  body: `${START("Try BLIX")}
${compare(["birdeye", "blix", "dexscreener"], ["fee", "chains", "ai", "api", "paper", "launch", "status"])}
<h2 id="api">Birdeye API versus Blix API</h2>
<p>Birdeye's API is keyed and tiered by calls, and covers Solana and other chains with deep history. BLIX's API comes with your account, Solana-only, no tiers: every launch, trade, holder ledger, candle, quote, signal and AI read as JSON and a live stream. Use Birdeye for history at scale; use BLIX for live memecoin data with the AI's read on it.</p>
${BLIX_ADDS}
${F.wallets("Wallet tracking with PnL")}
${COMPARE_MORE}
${NOT_AFFILIATED("Birdeye or DEX Screener")}${RISK}`,
  faq: [
    ["Is there a free Birdeye alternative?", `BLIX is free with an account, and its API has no tiers.`],
    ["Does BLIX have Birdeye's wallet portfolio view?", `Any wallet has a page built from the chain: trades, positions, realized and open profit, linked wallets.`],
    ["Does BLIX have historical data like Birdeye?", `Per coin, the chart covers the coin's life as seen by Blix with GeckoTerminal as a backup; for years of history across all tokens, Birdeye and the indexers are the tools.`],
  ],
});

const jupAlt = alt({
  path: "/jupiter-terminal-alternative", crumb: "Jupiter Terminal alternative",
  title: "Jupiter Terminal Alternative for Memecoin Trading | BLIX",
  description: "Jupiter Terminal is Jupiter's swap widget and jup.ag's trading UI. For memecoins BLIX routes through Jupiter and adds holders, a rug check, AI reads and exits.",
  h1: "Jupiter Terminal alternative",
  lede: `"Jupiter Terminal" means two things: the embeddable swap widget Jupiter offers to websites (renamed Jupiter Plugin), and jup.ag's own trading interface. Both are swap boxes on the best aggregator on Solana. For memecoins the swap is the easy part; the hard part is knowing what you are buying. BLIX routes every trade through Jupiter and wraps it in the terminal a memecoin needs: every launch live, holders with snipers and bundles, a rug check, an AI read, the chart with the traders on it, and exits that run for you.`,
  body: `${START("Trade on BLIX")}
${table(["", "Jupiter (jup.ag / Plugin)", "BLIX"], [
    ["What it is", "Swap aggregator and its UI / widget", "Memecoin terminal that routes through Jupiter"],
    ["Fee", "Jupiter's own fees per mode", "2% (1.6% with an invite) plus Jupiter's route"],
    ["Discovery", "Search and trending lists", "Every pump.fun launch live; Trending, Surge, New, Bonded"],
    ["Holders and safety", "Basic token info", "Holders from the first trade, rug check, bubble map"],
    ["AI", "None", "Rating, deep reads, picks, narratives"],
    ["Exits", "Limit orders, DCA", "Take profit, stop loss, trailing stop, partial sells"],
    ["Keys", "Your own wallet (Phantom etc.)", "Blix wallet made at sign-up; export or withdraw any time"],
  ], "cmp")}
${BLIX_ADDS}
${F.trade()}
${COMPARE_MORE}
${NOT_AFFILIATED("Jupiter")}${RISK}`,
  faq: [
    ["Is BLIX built on Jupiter?", `Quotes and swaps are routed through Jupiter, so you get the same routes; BLIX adds the data and the AI around them.`],
    ["Can I use my Phantom wallet on BLIX?", `BLIX makes you its own wallet at sign-up so trades are one click; you can fund it from Phantom and export its key or withdraw at any time.`],
    ["Is Jupiter Terminal still called that?", `The embeddable widget was renamed Jupiter Plugin; jup.ag's own UI continues. Both are swap interfaces rather than memecoin terminals.`],
  ],
});

// ---------- head to head ----------
const vs = (o) => page({ eyebrow: `Head to head · checked ${CHECKED}`, ...o });
const axiomFomo = vs({
  path: "/axiom-vs-fomo", crumb: "Axiom vs Fomo",
  title: "Axiom vs Fomo (2026): Fees, Speed, Social, Keys | BLIX",
  description: "Axiom Trade vs Fomo in 2026: Axiom is the fast Solana terminal with Pulse and exportable keys; Fomo the social app at about 0.5%. Which for what, and what BLIX adds.",
  h1: "Axiom vs Fomo",
  lede: `Axiom and Fomo are different answers to the same market. Axiom is a desktop-first terminal built for speed: the Pulse, filters, exportable keys, Hyperliquid perps, 1% a trade less cashback. Fomo is a phone-first social app: a feed of what traders are buying, one-tap trades on three chains with network fees covered, about 0.5% a trade. BLIX sits between them with what neither has: an AI read and a rug check on every coin, Fomo's traders' activity from the chain, and an open API.`,
  body: `${START("Try BLIX")}
${compare(["axiom", "fomo", "blix"])}
<h2 id="pick">Which for what</h2>
${table(["You want", "Axiom", "Fomo", "BLIX"], [
    ["Fastest execution with your keys", "Yes", "Fast, in the app", "One click, Jupiter routes"],
    ["To see what other traders are doing", "Wallet and X tracking", "The social feed", "Fomo and pump.fun leaderboards, faces on charts, live feed"],
    ["Lowest fee", "About 0.75–0.95% net", "About 0.5% spot, fees covered", "2%, 1.6% with an invite"],
    ["Other chains", "Hyperliquid perps", "Base, BNB, perps", "Solana only"],
    ["A read on every coin", "No", "No", "AI rating, deep reads, picks"],
    ["Data you can build on", "No", "No", "API and MCP connector with the account"],
  ])}
${BLIX_ADDS}
${COMPARE_MORE}
${NOT_AFFILIATED("Axiom Trade or Fomo")}${RISK}`,
  faq: [
    ["Is Axiom or Fomo cheaper?", `Fomo quotes about 0.5% on spot with network fees covered; Axiom charges 1% less 0.05–0.25% cashback, with priority fees and bribes extra. Read each quote before the trade.`],
    ["Which is faster?", `Axiom is built for speed on desktop; Fomo is fast enough on a phone. Both list pump.fun coins live.`],
    ["Can I use both with BLIX?", `Yes. BLIX reads Fomo's traders from the chain and shows the same Pulse layout as Axiom, with AI on top. Many traders keep more than one terminal open.`],
  ],
});

const axiomBullx = vs({
  path: "/axiom-vs-bullx", crumb: "Axiom vs BullX",
  title: "Axiom vs BullX (2026): One Is Live, One Is Not | BLIX",
  description: "Axiom vs BullX and BullX Neo in 2026: BullX suspended trading on June 1, 2026 (withdrawals open, no relaunch date).",
  h1: "Axiom vs BullX",
  lede: `This comparison has a short answer as of ${CHECKED}: Axiom is trading and BullX is not. BullX suspended trading on its app on June 1, 2026, keeping withdrawals open and publishing no relaunch date. Before that, BullX's edge was chains (Solana, Ethereum, Base, BNB, Tron, Blast) and Telegram-linked wallets; Axiom's was speed, the Pulse, exportable keys and Hyperliquid perps at 1% less cashback. BLIX adds an AI read on every coin and an open API to the Solana side.`,
  body: `${START("Try BLIX")}
${compare(["axiom", "bullx", "blix"])}
<h2 id="then">What each was known for</h2>
${table(["", "Axiom", "BullX / BullX Neo"], [
    ["Chains", "Solana, Hyperliquid perps", "Solana, Ethereum, Base, BNB, Tron, Blast"],
    ["Fee", "1% less 0.05–0.25% cashback", "About 0.9–1% (0.81% with a referral per some reviews)"],
    ["Keys", "Non-custodial, Turnkey, exportable", "In-app wallets"],
    ["Discovery", "Pulse with holder, dev and bundle filters", "Pump Vision and multi-chain lists"],
    ["Status", "Live", "Trading suspended since June 1, 2026"],
  ], "cmp")}
${BLIX_ADDS}
${COMPARE_MORE}
${NOT_AFFILIATED("Axiom Trade or BullX")}${RISK}`,
  faq: [
    ["Is BullX better than Axiom?", `BullX is not trading as of ${CHECKED}. For Solana, Axiom is the live choice among the two; BLIX adds AI reads and an open API.`],
    ["Did BullX shut down?", `It suspended trading on June 1, 2026 and kept withdrawals and wallet access open. No relaunch date had been published when we checked.`],
    ["Where did BullX's multi-chain traders go?", `GMGN covers most of BullX's chains; nio.trade lists Solana, Ethereum, Base, BNB and Hyperliquid.`],
  ],
});

const axiomPhoton = vs({
  path: "/axiom-vs-photon", crumb: "Axiom vs Photon",
  title: "Axiom vs Photon (2026): Speed, Fees, Keys, Pulse | BLIX",
  description: "Axiom Trade vs Photon in 2026: both fast Solana terminals at about 1%. Keys, cashback, perps, Pulse vs Memescope, and what BLIX adds: AI on every coin, an API.",
  h1: "Axiom vs Photon",
  lede: `Axiom and Photon are the two terminals people pick for speed on Solana. Photon came first, with Memescope, a sniper and wallets generated in the app, at about 1% (0.75% by some reviews, 1% with the sniper). Axiom answered with the Pulse, cashback that nets the fee down to 0.75–0.95%, non-custodial keys through Turnkey and Hyperliquid perps. Neither has an AI, an API or a launcher; BLIX has all three at the same fee, on the same kind of Pulse.`,
  body: `${START("Try BLIX")}
${compare(["axiom", "photon", "blix"])}
<h2 id="pick">Which for what</h2>
${table(["You want", "Axiom", "Photon", "BLIX"], [
    ["Keys you can export", "Yes (Turnkey)", "App-generated wallet", "Yes, or withdraw"],
    ["Cashback", "0.05–0.25% by volume", "No", "1.6% fee through an invite; 40% of fees to inviters"],
    ["Perps", "Hyperliquid, up to 50x", "No", "No"],
    ["Sniper", "Migration sniping", "Yes", "No; bundles and snipers are what the rug check flags"],
    ["AI", "No", "No", "Rating, deep reads, picks, narratives"],
    ["API / MCP", "No", "No", "With every account"],
    ["Launcher", "No", "No", "pump.fun in one screen"],
  ])}
${BLIX_ADDS}
${COMPARE_MORE}
${NOT_AFFILIATED("Axiom Trade or Photon")}${RISK}`,
  faq: [
    ["Is Axiom or Photon faster?", `Reviews usually call Photon the fastest on Solana and Axiom close behind; in practice both land a pump.fun trade in about a second with a priority fee. Setup and RPC matter as much as the app.`],
    ["Which has lower fees?", `Axiom nets about 0.75–0.95% after cashback; Photon is about 1% (some reviews quote 0.75% without the sniper). Network fees are extra on both.`],
    ["Which is safer?", `Axiom's keys are non-custodial through Turnkey and exportable; Photon's wallet is generated in the app. Axiom disclosed an internal-access incident in February 2026.`],
  ],
});

const axiomGmgn = vs({
  path: "/axiom-vs-gmgn", crumb: "Axiom vs GMGN",
  title: "Axiom vs GMGN (2026): Solana Speed vs Multi-Chain | BLIX",
  description: "Axiom Trade vs GMGN in 2026: Axiom is Solana-first with the Pulse, cashback and perps; GMGN covers Solana, Ethereum, Base, BNB and Tron with copy trading.",
  h1: "Axiom vs GMGN",
  lede: `Axiom is Solana-first and built for speed: the Pulse, cashback tiers, Turnkey keys, Hyperliquid perps. GMGN is multi-chain (Solana, Ethereum, Base, BNB, Tron and more) and built around wallets: copy trading, smart-money tags, KOL wallets, and an OpenAPI with a key by application. Both charge about 1%. BLIX is Solana-only like Axiom, finds smart money from the chain like GMGN tries to, and adds what neither has: an AI read on every coin and an API and MCP connector with every account.`,
  body: `${START("Try BLIX")}
${compare(["axiom", "gmgn", "blix"])}
<h2 id="pick">Which for what</h2>
${table(["You want", "Axiom", "GMGN", "BLIX"], [
    ["Other chains", "No (perps on Hyperliquid)", "Yes", "No"],
    ["Copy trading", "Wallet tracking", "Yes, built in", "Smart money followed for you; buys as signals; no auto-mirror"],
    ["Smart money", "No", "Tags", "Found from early buyers of runners, followed automatically"],
    ["API", "No", "OpenAPI, key by application", "API and MCP connector with the account"],
    ["Fee", "About 0.75–0.95% net", "About 1%", "2%, 1.6% with an invite"],
    ["AI", "No", "No written reads", "Rating, deep reads, picks, narratives"],
  ])}
${BLIX_ADDS}
${COMPARE_MORE}
${NOT_AFFILIATED("Axiom Trade or GMGN")}${RISK}`,
  faq: [
    ["Is GMGN or Axiom better for Solana memecoins?", `Axiom for speed and keys; GMGN for copy trading and other chains; BLIX for AI reads and open data. Fees are about the same.`],
    ["Does GMGN have an API and Axiom not?", `Yes. GMGN's OpenAPI needs a key by application and trades with your private key from a whitelisted IP; Axiom publishes none. BLIX's comes with the account and never takes a private key.`],
  ],
});

const fomoBullx = vs({
  path: "/fomo-vs-bullx", crumb: "Fomo vs BullX",
  title: "Fomo vs BullX (2026): Social App vs Suspended Terminal | BLIX",
  description: "5% with fees covered. What each offered, and what BLIX adds: AI reads, open API, Fomo's traders from the chain.",
  h1: "Fomo vs BullX",
  lede: `As of ${CHECKED} only one of these is trading. BullX suspended trading on June 1, 2026 (withdrawals open, no relaunch date). Fomo is live: a social trading app with a feed of traders' buys, sells and theses, one-tap trades on Solana, Base and BNB with network fees covered, about 0.5% on spot. BLIX adds the read neither has (an AI rating and a rug check on every coin) and shows Fomo's traders' activity from the chain.`,
  body: `${START("Try BLIX")}
${compare(["fomo", "bullx", "blix"])}
${BLIX_ADDS}
${F.feed("Fomo's traders, in BLIX's feed")}
${COMPARE_MORE}
${NOT_AFFILIATED("Fomo or BullX")}${RISK}`,
  faq: [
    ["Is BullX or Fomo better?", `BullX is not trading as of ${CHECKED}. Fomo is live and cheap on spot; BLIX adds AI reads and open data on Solana.`],
    ["Does Fomo have BullX's chains?", `Fomo covers Solana, Base and BNB plus perps; BullX had Ethereum, Tron and Blast too. GMGN covers most of those.`],
  ],
});

export const COMPETE_PAGES = [fomoApp, fomoBot, fomoMcp, fomoScanner, axiomTrade, axiomBot, axiomMcp, axiomScanner, nio, nioApi, photonAlt, bullxAlt, gmgnAlt, dexAlt, birdeyeAlt, jupAlt, axiomFomo, axiomBullx, axiomPhoton, axiomGmgn, fomoBullx];
