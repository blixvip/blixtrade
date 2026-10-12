// Trader pages: scanners, signals, smart money and whales, the rug-pull scanner, finding and analysing coins,
// narratives and X tracking, swaps, the memecoin hub and the terminal comparison.
import { F, FACT, START, DISCORD, COMMUNITY, NOT_AFFILIATED, RISK, CHECKED, N_ENDPOINTS, N_TOOLS, code, table, facts, steps, bullets, callout, links, page, compare } from "./pagekit.js";

const FIND_MORE = links("More ways to find coins", [
  ["/meme-coin-finder", "Meme coin finder", "Find coins early, with the AI and the holders on the same row."],
  ["/new-meme-coins", "New meme coins", "Every new Solana and pump.fun coin, live."],
  ["/trending-meme-coins", "Trending meme coins", "What is moving right now, ranked by live traction."],
  ["/memecoin-scanner", "Memecoin scanner", "Scan every coin for volume, holders, risk and the AI's read."],
  ["/solana-token-scanner", "Solana token scanner", "Beyond pump.fun: every pool Jupiter routes."],
  ["/ai-memecoin-picks", "AI picks", "The short list, with the reasons and the record."],
]);
const SAFE_MORE = links("More on safety and wallets", [
  ["/rug-pull-scanner", "Rug pull scanner", "Dev, bundles, snipers, authorities, liquidity, linked wallets."],
  ["/smart-money-tracker", "Smart money tracker", "The wallets that buy runners early."],
  ["/solana-whale-tracker", "Solana whale tracker", "Large wallets and their moves."],
  ["/solana-wallet-tracker", "Solana wallet tracker", "Any wallet, read from the chain."],
  ["/meme-coin-analyzer", "Meme coin analyzer", "Holders, chart, narrative and the AI read on one screen."],
]);

// ---------- /memecoin-scanner ----------
const memeScanner = page({
  path: "/memecoin-scanner", crumb: "Memecoin scanner",
  title: "Memecoin Scanner with AI: Volume, Holders, Risk, Live (Free) | BLIX",
  description: "A free memecoin scanner for Solana: every new coin live, trending and surging lists, volume, liquidity and momentum, holders with snipers and bundles.",
  h1: "Memecoin scanner with AI ratings",
  lede: `A memecoin scanner should answer three questions on one row: is anyone buying this, who holds it, and is the setup a rug. BLIX scans every Solana memecoin live (every pump.fun launch about a second after the chain, and every pool Jupiter routes) and puts the volume and momentum, the holder breakdown, the rug check and a live AI rating on each row. Click through to the chart with the traders on it, and buy in one click with real SOL or paper.`,
  body: `${START("Open the scanner")}
${facts([["Lists", "New pairs, Final stretch, Migrated, Trending, Surge, Bonded"], ["Per coin", "Market cap, volume, momentum, buys and sells, holders, liquidity, age"], FACT.safety, FACT.ai, FACT.speed, FACT.price])}
<h2 id="scan">What the scanner reads on every coin</h2>
${table(["Column", "What it tells you"], [
    ["Market cap and change", "Where it is and how fast it moved in the last minutes and hours"],
    ["Volume and momentum", "SOL traded in the last 5 minutes and 24 hours; Surge ranks by acceleration"],
    ["Buys, sells, traders", "Real flow, decoded from the chain, not an estimate"],
    ["Holders, top 10, dev, snipers, bundles", "Who owns the supply and whether the first buyers were bots"],
    ["Liquidity", "What you could sell into, with the sellable-liquidity check"],
    ["AI rating", "One number from all of the above, updated as the coin trades, with a one-line reason"],
    ["Rug check", "The safety read: authorities, liquidity, dev history, linked wallets"],
  ])}
${F.pulse("New coins: the pump.fun lifecycle")}
${F.discover("Trending, surging, bonded")}
${F.rating()}
${F.safety("Risk on every row")}
<h2 id="filters">Scanning without the noise</h2>
<p>Thousands of coins a day are copies of one name, launched by the same few wallets. BLIX's anti-slop filter and the same-ticker count on each row take them out of your way, dead coins never appear in lists, and every list can be narrowed by stage, safety and rating. The result is a scanner you can read, not a firehose.</p>
${F.trade("From the scanner to the trade")}
${FIND_MORE}
${RISK}`,
  faq: [
    ["What is the best free memecoin scanner?", `BLIX scans every Solana memecoin live with volume, holders, a rug check and an AI rating on each row, and lets you trade from the same screen. It is free in the browser.`],
    ["Does the scanner cover more than pump.fun?", `Yes. pump.fun gets the deepest coverage (launch to migration, holders from the first trade); Discover also lists Raydium LaunchLab launches and every pool Jupiter routes, on PumpSwap, Raydium and Meteora.`],
    ["Can I scan for whales and smart money?", `Yes. Followed and smart wallets' buys are signals, the holder list names known traders, and the Top traders board ranks the best wallets by profit.`],
    ["Is there a memecoin scanner API?", `Yes, with your account: the same scanner is JSON (<code>GET /api/pulse</code>, <code>GET /api/tokens</code>) and a live stream.`],
  ],
});

// ---------- /solana-token-scanner ----------
const solScanner = page({
  path: "/solana-token-scanner", crumb: "Solana token scanner",
  title: "Solana Token Scanner: New Coins, Holders, Rug Check, AI (Free) | BLIX",
  description: "Free Solana token scanner: new and trending coins across pump.fun, PumpSwap, Raydium and Meteora, holders with snipers and bundles, a rug check and an AI rating.",
  h1: "Solana token scanner",
  lede: `BLIX scans Solana coins where they are born and where they trade: every pump.fun launch and Raydium LaunchLab launch from the chain, every pool Jupiter routes on PumpSwap, Raydium and Meteora, and the new and trending pairs DexScreener and GeckoTerminal list. Each coin carries its live numbers, its holders, a rug check and an AI rating, and the same screen buys it in one click.`,
  body: `${START("Scan Solana coins")}
${facts([["Sources", "pump.fun, PumpSwap, Raydium LaunchLab and pools, Meteora, DexScreener and GeckoTerminal pairs"], ["Coin search", "Paste any mint or ticker; the launcher finds it"], FACT.safety, FACT.ai, FACT.speed, FACT.price])}
${F.discover("Trending, Surge, New pairs, Bonded")}
${F.pulse("Launches: pump.fun from the first trade")}
<h2 id="any">Any Solana coin, by address</h2>
<p>Paste a mint address or type a ticker and the coin opens with its chart, trades, holders, safety and AI read, whether or not it is in a list. Majors such as SOL, USDC and BTC have pages too, with the chain's own supply figures.</p>
${F.holders()}
${F.safety()}
${F.chart()}
<h2 id="api">The scanner as an API</h2>
<p>With your account the scanner is JSON: <code>GET /api/tokens</code> with the same sort and safety filters as the Coins page, <code>GET /api/token/&lt;mint&gt;</code> for one coin, <code>GET /api/pulse</code> for the launch columns, and a live stream. ${N_ENDPOINTS} endpoints, with your account. See the <a href="/solana-api">Solana memecoin API</a>.</p>
${FIND_MORE}
${RISK}`,
  faq: [
    ["Which Solana tokens does the scanner cover?", `Every pump.fun and Raydium LaunchLab launch from the chain, every pool Jupiter routes, and the pairs DexScreener and GeckoTerminal list. Any coin can be opened by its mint address.`],
    ["How is this different from DEX Screener?", `DEX Screener lists pairs across many chains with charts. BLIX is Solana only and goes deeper: holders from the first trade with snipers and bundles, a rug check, an AI rating, the traders' faces on the chart, and one-click trading. See <a href="/dexscreener-alternative">DEX Screener alternative</a>.`],
    ["Can I scan a coin by contract address?", `Yes. Paste it into the search (or press / or Ctrl+K) and the coin opens.`],
    ["Is the Solana token scanner free?", `Yes, with your account, and the same scanner is on the API.`],
  ],
});

// ---------- /memecoin-signals ----------
const memeSignals = page({
  path: "/memecoin-signals", crumb: "Memecoin signals",
  title: "Memecoin Signals for Solana: AI Buy Calls, Dumps, Smart Wallets | BLIX",
  description: "Memecoin trading signals with a public record: AI buy calls, dump warnings, dev sells, smart-wallet buys and narrative bursts on Solana, each re-priced after the fact.",
  h1: "Memecoin signals with a record",
  lede: `Most memecoin signal groups sell confidence. BLIX raises signals from the chain and its own AI (buy calls, dump warnings, dev sells, smart-wallet buys, milestones, narrative bursts), shows each with the coin's live numbers, and then re-prices every one at 15 minutes, 1 hour, 6 hours and 24 hours so you can see which types are worth acting on. In the app with your account, and the day's big ones in the BLIX Discord.`,
  body: `${START("See the signals")}
${facts([["Types", "AI buy calls, picks, dumps, dev sells, milestones, followed and smart wallet buys, narratives"], ["Record", "Per type: checked, up 20%+, down 50%+, unsellable, median, reached 2x"], ["Delivery", "In the app; the day's big ones in the BLIX Discord"], ["Gate", "A coin that fails the safety check never gets a positive signal"], FACT.ai, FACT.price])}
<h2 id="types">The signal types</h2>
${table(["Signal", "Raised when", "Use it for"], [
    ["AI buy call", "A deep read graded the coin a buy, with thesis and plan", "Candidates worth your own look"],
    ["Pick", "Rating, AI call and a clean entry lined up", "The daily short list"],
    ["Dump warning", "Sells outrun buys and the market cap falls fast", "Exiting, or not entering"],
    ["Dev sold", "The creator's wallet sold part or all", "Exiting"],
    ["Milestone", "The coin crossed a market-cap level", "Momentum"],
    ["Followed wallet buy", "A wallet BLIX follows bought", "A trader with a record, with the record beside it"],
    ["Smart wallet buy", "A wallet found among early buyers of runners bought", "Early discovery"],
    ["Narrative burst", "Several launches on one word or one X post within minutes", "Catching a story early"],
  ])}
<h2 id="record">Every signal is re-priced</h2>
<p>The track record shows, per signal type, how many were checked, how many were up 20% or more, how many were down 50% or more, how many could not be sold, the median and the share that reached 2x. Emptied pools count as 0x. A positive signal is never raised on a coin that failed the safety check. This is the page to read before you act on any signal, including ours.</p>
${F.picks()}
${F.smart()}
${F.narratives("Narrative signals")}
<h2 id="deliver">Where signals go</h2>
<p>The signals feed is live in the app the moment you sign in, the BLIX Discord carries the day's big ones, and with your account every signal is on the API and the live stream for your own code.</p>
${links("More signal pages", [
    ["/pump-fun-signals", "pump.fun signals", "Launch, final stretch and migration alerts."],
    ["/memecoin-alerts", "Memecoin alerts", "Setting up destinations, cooldowns and delivery checks."],
    ["/ai-memecoin-picks", "AI picks", "The daily short list and its record."],
    ["/smart-money-tracker", "Smart money tracker", "Where the smart-wallet signals come from."],
    ["/memecoin-api", "Memecoin API", "Signals as JSON and a stream."],
  ])}
${RISK}`,
  faq: [
    ["Are BLIX's memecoin signals free?", `Yes. The feed is in the terminal with your account, and the Discord is open to every member.`],
    ["How accurate are the signals?", `The track record page answers that per type, with the losses counted. Use the types with a good record and ignore the rest.`],
    ["Do you sell signals?", `No. There is no paid group. The signals are part of the terminal, and the record is public inside it.`],
    ["Can I get the signals in my own bot?", `Yes, with your account: <code>GET /api/signals</code> and <code>signal</code> events on the live stream.`],
  ],
});

// ---------- /smart-money-tracker ----------
const smart = page({
  path: "/smart-money-tracker", crumb: "Smart money tracker",
  title: "Smart Money Tracker for Solana: Find the Wallets That Buy Early | BLIX",
  description: "Track smart money on Solana: BLIX finds the wallets that bought past runners early, ranks them by profit.",
  h1: "Smart money tracker for Solana memecoins",
  lede: `Smart money on Solana is not a label somebody sells; it is a wallet with a record. BLIX finds those wallets itself, from the chain: the early buyers of coins that went on to 3x or more, ranked by how often they were right and how much they made, with linked wallets grouped. It follows the best of them automatically, raises their buys as signals, and shows their names and faces in holder lists when they are known traders from the Fomo or pump.fun leaderboards.`,
  body: `${START("Track smart money")}
${facts([["Discovery", "Early buyers of runners, found from the chain"], ["Ranking", "By profit and hit rate, with linked wallets grouped"], ["Followed", "The best of the ranking, automatically"], ["Signals", "Their buys, as they land, with the record beside them"], ["Faces", "Leaderboard traders matched to their wallets"], FACT.price])}
<h2 id="how">How BLIX finds smart money</h2>
${steps([
    "Every coin that ran (3x or more from a clean entry) has its early buyers pulled from the trade ledger.",
    "Wallets that keep showing up early on runners, and that sell for a profit rather than holding to zero, rise in the ranking; linked wallets (funded from one source) are grouped as one trader.",
    "The top of the ranking is followed automatically; the Fomo and pump.fun leaderboards' traders are scored the same way.",
    "A followed wallet's buy becomes a signal with the wallet's record next to it, so you know what its last ten buys did.",
  ])}
${F.wallets()}
<h2 id="board">The Top traders board</h2>
<p>The board merges the Fomo and pump.fun leaderboards by profit for the day, week and month and shows every trader as a wallet. The top three stand on the podium; everyone opens to a page built from the chain with trades, positions and profit. Known traders carry their name and face into holder lists and onto charts, so "smart money is in this coin" is something you can see.</p>
${F.signals("Smart-wallet signals")}
${F.safety("Smart money versus insiders")}
<h2 id="how-to">How to find smart money wallets yourself</h2>
<p>Open a coin that ran and sort its holders by entry time: the first clean buyers who are not the dev, a sniper or a bundle are the candidates. Open each wallet's page and look at its last twenty trades. A wallet that is early on several runners and takes profit is smart money; a wallet that is early on everything is a sniper bot. <a href="/how-to-track-solana-wallets">How to track Solana wallets</a> goes step by step.</p>
${SAFE_MORE}
${RISK}`,
  faq: [
    ["What is a smart money wallet?", `A wallet with a record of buying coins early that went on to run, and selling for a profit. BLIX finds them from the chain and ranks them by that record.`],
    ["Is the smart money tracker free?", `Yes. It is part of the terminal, and the same data is on the API with your account (<code>GET /api/wallets</code>).`],
    ["Can I copy smart money trades?", `You can see their buys as signals and buy in one click yourself. BLIX does not copy-trade for you; by the time a mirror fills, the edge is usually gone.`],
    ["How do I know a wallet is not an insider?", `The holder panel tags snipers and bundles and the bubble map shows wallets funded from one source. A smart wallet buys clean entries across many coins; an insider is early on its own coins.`],
  ],
});

// ---------- /solana-whale-tracker ----------
const whale = page({
  path: "/solana-whale-tracker", crumb: "Solana whale tracker",
  title: "Solana Whale Tracker: Big Wallets, Buys and Sells Live (Free) | BLIX",
  description: "Track Solana whales live: the largest holders of any memecoin, their buys and sells from the chain, whale alerts, and the Top traders board ranked by profit.",
  h1: "Solana whale tracker",
  lede: `A whale on a memecoin is any wallet big enough to move it. BLIX shows them where it matters: the largest holders of every coin with their share, their SOL in and out and whether they are selling, the big buys and sells arriving live on the chart and in the feed, and the traders with the biggest profits on the Top traders board. The smart ones among them are followed for you, and their next move is a signal.`,
  body: `${START("Track whales")}
${facts([["Per coin", "Top holders by share, SOL in and out, sold or holding"], ["Live", "Big buys and sells on the chart and in the feed as they land"], ["Board", "Top traders by profit: day, week, month"], ["Signals", "Smart and leaderboard wallets' buys and sells"], ["Linked wallets", "One whale through many wallets, drawn as one cluster"], FACT.price])}
${F.holders("The whales in a coin")}
<h2 id="live">Whale moves, live</h2>
<p>Every trade of a coin is decoded from the chain and listed within two seconds, with the trader's wallet; known traders carry their name and face. The feed also lists the big Fomo buys and sells across the market, with each position's profit moving as the coin trades, so you see which whales are in and which are leaving.</p>
${F.wallets("Any whale, from the chain")}
<h2 id="alerts">Whale alerts</h2>
<p>Buys and sells by the wallets BLIX follows are signals with the wallet's record beside them; smart wallets found from the chain are followed automatically. The day's big ones are shared in the BLIX Discord.</p>
<h2 id="map">Whales in disguise</h2>
<p>The bubble map links wallets funded from the same source, so a whale split across twenty wallets to look like a healthy holder list shows up as one cluster. Snipers and bundles are tagged from the first trade.</p>
${SAFE_MORE}
${RISK}`,
  faq: [
    ["How do I track whale wallets on Solana?", `Open a coin's holder panel to see its largest wallets and whether they are selling, open any of them as a page built from the chain, and watch the Top traders board for the biggest profits. Smart and leaderboard wallets' trades become signals.`],
    ["Does BLIX have whale alerts?", `Yes: buys and sells by followed and smart wallets are signals in the feed, and the day's big ones are shared in the Discord.`],
    ["Can I see a whale's profit?", `Yes. Every wallet has a page built from the chain with realized and open profit, positions and trade history.`],
  ],
});

// ---------- /rug-pull-scanner ----------
const rugScanner = page({
  path: "/rug-pull-scanner", crumb: "Rug pull scanner",
  title: "Rug Pull Scanner for Solana: Detect Rugs, Honeypots & Insiders | BLIX",
  description: "Free rug pull scanner for Solana memecoins: one score per coin from dev history, bundles, snipers, top-holder concentration, mint and freeze authority.",
  h1: "Rug pull scanner for Solana memecoins",
  lede: `A rug pull scanner has to look at the people, not only the contract. BLIX checks both on every Solana coin: the contract side (mint and freeze authority, liquidity locked or pulled, the sellable-liquidity and believable-price checks) and the people side (the dev's share and past launches, bundles and snipers from the first block, top-holder concentration, wallets linked by funding). The answer is one number, "how likely is this not a rug", with the reasons under it and the AI's read on top.`,
  body: `${START("Scan a coin")}
${facts([["Contract", "Mint and freeze authority, LP lock, sellable liquidity, believable price"], ["People", "Dev share and history, bundles, snipers, top 10, linked wallets"], ["Score", "One number with the reasons, live"], ["Bubble map", "Funding links drawn as clusters"], ["Gate", "No positive signal on a coin that fails"], FACT.price])}
${F.safety("What the scanner checks")}
<h2 id="honeypot">Honeypots and unsellable coins</h2>
<p>A honeypot lets you buy and not sell. BLIX's sellable-liquidity check asks Jupiter for a real sell quote at your size and compares it to the price; a coin you cannot sell, or can only sell at a fraction, fails. The believable-price check catches pools priced far from any real trade. Emptied pools count as zero in every record, so a coin that rugged never looks like a winner in the stats.</p>
<h2 id="insiders">Insiders, bundles and snipers</h2>
<p>Wallets that bought in the same block as the coin's first trade are bundles; within two blocks, snipers. Their share and how much they have sold are on every coin from its first trade. The bubble map links wallets funded from one source, so an "organic" holder list made of one person's twenty wallets is one blob on screen. A dev who launched four coins in six hours is flagged as a serial launcher.</p>
<h2 id="signs">A short list of rug signs</h2>
${bullets([
    "Bundles or snipers above 20% of supply, still holding",
    "The dev holding a large share, or the dev already sold everything",
    "Top 10 wallets above 40%, especially when the bubble map links them",
    "Mint or freeze authority not revoked after graduation",
    "Liquidity unlocked, thin, or already pulled",
    "The same name launched many times this hour, or a dev with a string of dead coins",
  ])}
${F.rating("The AI's read")}
<h2 id="limits">What a scanner cannot promise</h2>
<p>A coin can pass every check and still fall 90% because nobody wants it, and a determined team can rug a clean-looking coin later. The scanner removes the obvious ones and shows you the setup; it is not a guarantee. Size every memecoin trade for the chance it goes to zero.</p>
${SAFE_MORE}
${RISK}`,
  faq: [
    ["How do I check if a Solana coin is a rug pull?", `Open it in BLIX: the safety read scores the contract (authorities, liquidity, sellability) and the people (dev, bundles, snipers, concentration, linked wallets) in one number with reasons. Bundles or snipers above 20%, a dev holding big or a serial launcher are reasons to pass.`],
    ["Is this a honeypot checker too?", `Yes. The sellable-liquidity check asks for a real sell quote and fails coins you could not sell at a sensible price.`],
    ["Does it detect bundled wallets?", `Yes. Bundles (same block as the first trade) and snipers (within two blocks) are tagged from the first trade onward, and the bubble map shows wallets linked by funding.`],
    ["Is the rug pull scanner free?", `Yes. It runs on every coin in the terminal, and the same checks are on the API with your account (<code>GET /api/token/&lt;mint&gt;</code> and <code>GET /api/holders/&lt;mint&gt;</code>).`],
    ["Does it use RugCheck?", `RugCheck's report (authorities, LP, concentration) is one input. Blix adds its own holder ledger, dev history, sellability and funding-link analysis on top.`],
  ],
});

// ---------- /meme-coin-finder ----------
const finder = page({
  path: "/meme-coin-finder", crumb: "Meme coin finder",
  title: "Meme Coin Finder: Find Solana Gems Early with AI (Free) | BLIX",
  description: "Find meme coins early on Solana: every launch live, surging coins, narrative bursts, smart-wallet buys and AI picks.",
  h1: "Meme coin finder with AI",
  lede: `Finding a meme coin early is easy; finding one that is not a rug and has a reason to run is the work. BLIX is built for that part: every launch live, the coins accelerating right now, the narratives forming on X, the wallets with a record buying, and the AI's daily picks, with the holders, the rug check and the chart beside each so the first look is also the check.`,
  body: `${START("Find coins")}
${facts([["Sources", "Every pump.fun and LaunchLab launch, every pool Jupiter routes"], ["Early signals", "Surge, narrative bursts, smart-wallet buys, AI buy calls"], FACT.safety, FACT.ai, ["Dead coins", "Never listed"], FACT.price])}
<h2 id="ways">Five ways BLIX finds coins early</h2>
${table(["Way", "What it catches", "Where"], [
    ["Launch feed", "Every new coin about a second after the chain", "Pulse: New pairs"],
    ["Final stretch", "Coins about to graduate, where volume arrives", "Pulse: Final stretch"],
    ["Surge", "Coins accelerating in the last minutes", "Discover: Surge"],
    ["Narrative bursts", "Several launches on one word or X post within minutes, named by the AI", "Narratives"],
    ["Smart wallets and AI", "Early buyers of past runners buying now; deep reads graded a buy", "Signals, AI early picks"],
  ])}
${F.narratives("Catch the story, not the copy")}
${F.smart()}
${F.picks()}
${F.safety("The check that goes with the find")}
<h2 id="gems">About "gem finders"</h2>
<p>Every tool that promises to find gems is really a filter. BLIX's filters are visible (holders, bundles, dev history, liquidity, rating, record) and the AI's picks are scored publicly, so you can judge the finder by its results rather than its name. Most coins it surfaces still go to zero; the job is a better list, not a sure thing.</p>
${FIND_MORE}
${RISK}`,
  faq: [
    ["How do I find meme coins early?", `Watch the Final stretch and Surge lists, the narrative bursts and the smart-wallet signals in BLIX, and check holders and the rug check before you buy. The <a href="/how-to-find-meme-coins-early">step-by-step guide</a> covers the workflow.`],
    ["Is there an AI that finds meme coins?", `BLIX's AI rates every coin and makes daily picks with reasons, scored after the fact. It finds candidates; it does not predict runners.`],
    ["Is the meme coin finder free?", `Yes, in the browser, with one-click trading on the same screen.`],
    ["Does it find coins on pump.fun only?", `No. pump.fun and Raydium LaunchLab launches come from the chain; pools on PumpSwap, Raydium and Meteora come through Jupiter, DexScreener and GeckoTerminal.`],
  ],
});

// ---------- /new-meme-coins ----------
const newCoins = page({
  path: "/new-meme-coins", crumb: "New meme coins",
  title: "New Meme Coins on Solana Today: Live Launches with Holders & AI | BLIX",
  description: "See new meme coins on Solana and pump.fun the second they launch: live market cap, buyers, holders with snipers and bundles, dev history and an AI rating per coin.",
  h1: "New meme coins on Solana, live",
  lede: `Around two thousand new coins launch on pump.fun every hour, and more on Raydium LaunchLab and straight into pools. BLIX lists every one about a second after the chain and keeps following it: market cap, buyers, bonding progress, holders, the dev's history and a live AI rating. This page explains what to look at in a coin that is minutes old, and where the new coins are in the app.`,
  body: `${START("See new coins")}
${facts([FACT.speed, ["Where", "Pulse: New pairs and Final stretch; Discover: New pairs and Bonded"], ["Per coin", "Market cap, buys, sells, traders, holders, dev, snipers, bundles, rating"], ["Noise", "Copies counted per ticker; dead coins never listed"], FACT.safety, FACT.price])}
${F.pulse("New pairs, Final stretch, Migrated")}
<h2 id="first-minutes">What to read in a coin's first minutes</h2>
${bullets([
    "<b>Traders, not buys.</b> Fifty buys from five wallets is one person. BLIX counts traders.",
    "<b>The first block.</b> Bundles (same block as the first trade) and snipers (within two blocks) are tagged at once. A coin whose first holders are bots rarely survives their exit.",
    "<b>The dev.</b> Share now, largest share, whether it sold, and its past launches. Serial launchers are flagged.",
    "<b>Copies.</b> The row says how many coins with the same ticker launched this hour. The first one is sometimes the story; the eleventh is not.",
    "<b>The rating.</b> The instant rules score, relabelled by a fast model within seconds; the deep read follows if the coin keeps trading.",
  ])}
${F.rating()}
${F.narratives("New narratives, not only new coins")}
${F.trade("Buy a new coin in one click")}
${F.paper("Or paper-trade the launch")}
${FIND_MORE}
${RISK}`,
  faq: [
    ["Where can I see new meme coins as they launch?", `On BLIX's Pulse board: the New pairs column lists every pump.fun launch about a second after the chain, and Discover's New pairs covers new pools across Solana.`],
    ["How many new meme coins launch a day?", `On a normal day roughly 2,000 an hour on pump.fun alone, around 40,000 to 50,000 a day. Nearly all are dead within the hour, which is why BLIX counts copies and never lists dead coins.`],
    ["Should I buy a coin in its first minute?", `Rarely. The first minute belongs to bots; the Final stretch and the first minutes after graduation are where real buyers show. Paper-trade launches first and read the record.`],
    ["Can I get new coin alerts?", `Every launch is on the live stream with your account, and in the app the signals feed raises picks, smart-wallet buys and narrative bursts, which are the launches worth a look.`],
  ],
});

// ---------- /trending-meme-coins ----------
const trending = page({
  path: "/trending-meme-coins", crumb: "Trending meme coins",
  title: "Trending Meme Coins on Solana Right Now: Live Ranking with AI | BLIX",
  description: "Trending meme coins on Solana and pump.fun right now, ranked by live traction, with holders, a rug check and an AI rating on each. Updates every few seconds.",
  h1: "Trending meme coins on Solana, right now",
  lede: `"Trending" on BLIX is measured, not voted: a rank from live traction (traders in the last minutes, net flow, 5-minute volume, change) over every Solana coin Blix follows, refreshed every few seconds. Beside it, Surge ranks the coins accelerating fastest, and the day's runners are written up on the narratives desk. Every row carries the holders, the rug check and the AI rating, and buys in one click.`,
  body: `${START("See what is trending")}
${facts([["Rank", "Live traction: traders, flow, 5-minute volume, change"], ["Lists", "Trending, Surge, Bonded, plus the Final stretch and Migrated columns"], ["Runners", "The day's biggest moves with real money behind them, written up daily"], FACT.safety, FACT.ai, FACT.price])}
${F.discover()}
<h2 id="rank">How the trending rank works</h2>
<p>Each coin gets a 0–100 rank from its live traction: the number of distinct traders in the last minutes, the net flow of SOL in or out, the volume of the last five minutes and the price change, weighed against the coin's size so a tiny coin's $2,000 counts as much as a big coin's $200,000. Bot volume (a coin trading eighty times its market cap with itself) is discounted. The rank is recomputed as trades arrive.</p>
${F.narratives("The day's runners, explained")}
<h2 id="best">"Best meme coins" is a question about time</h2>
<p>The best coin an hour ago is often the worst one now. Rather than a static list, BLIX shows what is moving at this moment with the data that tells you whether it can keep moving (holders, liquidity, who is in it, the story), and the AI's picks with their record. Make your own list from that, and size it for coins that can go to zero.</p>
${F.rating()}
${F.trade("Trade a trending coin in one click")}
${FIND_MORE}
${RISK}`,
  faq: [
    ["What meme coins are trending right now?", `Open Discover on BLIX: Trending and Surge rank every Solana coin by live traction, refreshed every few seconds, with holders and an AI rating on each row.`],
    ["How is trending calculated?", `From live traders, net flow, 5-minute volume and change, weighed against the coin's size, with bot volume discounted. It is recomputed as trades arrive.`],
    ["Does it show trending pump.fun coins?", `Yes. pump.fun coins dominate the lists; the Final stretch column is the pump.fun-specific view of where volume is going.`],
    ["Is there a trending API?", `Yes, with your account: <code>GET /api/tokens?sort=trending</code> and <code>GET /api/pulse</code>.`],
  ],
});

// ---------- /meme-coin-analyzer ----------
const analyzer = page({
  path: "/meme-coin-analyzer", crumb: "Meme coin analyzer",
  title: "Meme Coin Analyzer: Holders, Chart, Safety, AI Read | BLIX",
  description: "Analyze any Solana meme coin in one screen: holders with dev, snipers and bundles, the chart with traders on it, trades, safety score, bubble map, fees paid.",
  h1: "Meme coin analyzer",
  lede: `Paste a contract address and BLIX analyzes the coin on one screen: the chart with known traders' faces on the candles where they bought and sold, every trade, the holder ledger with the dev, snipers and bundles tagged, the safety score and bubble map, the fees the coin has paid, the narrative it rides, and an AI deep read that grades it from A to F with a thesis, risks and a plan. Then buy or paper-buy from the same screen.`,
  body: `${START("Analyze a coin")}
${facts([["Input", "A mint address or ticker"], ["Chart", "1-second to daily candles from real trades, traders' faces on them"], ["Holders", "Dev, snipers, bundles, top 10, known traders"], FACT.safety, ["AI", "Deep read: grade, thesis, catalysts, risks, call, plan"], FACT.price])}
<h2 id="steps">How to analyze a meme coin in five minutes</h2>
${steps([
    "<b>Safety first.</b> The score and its reasons: authorities, liquidity, dev history, bundles, snipers, concentration. Pass if the setup is wrong; nothing else matters then.",
    "<b>Who holds it.</b> The dev's share and whether it sold; how much the first-block wallets still hold; whether the top ten are one cluster on the bubble map; which known traders are in.",
    "<b>What the chart says.</b> Where the faces are: did the known traders buy the dip or sell the top? Are buys and sells from many traders or a few?",
    "<b>Why it exists.</b> The narrative: the X post or event behind it, how many copies launched, whether the story is still live. The Today desk has the write-up for the day's stories.",
    "<b>The AI's read.</b> The grade, thesis, ceiling, catalysts, risks and plan, and how the AI's calls on similar coins have done.",
  ])}
${F.chart()}
${F.holders()}
${F.safety()}
${F.rating("The deep read")}
<h2 id="fees">Fees paid: the honest volume</h2>
<p>Every coin shows what its trades have paid in pump.fun and PumpSwap fees. Volume can be faked by a bot trading with itself; fees cannot, so fees paid is the cleanest measure of how much a coin has really traded.</p>
${F.trade("From analysis to trade")}
${links("More analysis pages", [
    ["/memecoin-analytics", "Memecoin analytics", "Volume, holders, momentum and liquidity tracked live."],
    ["/rug-pull-scanner", "Rug pull scanner", "The safety side in depth."],
    ["/pump-fun-wallet-tracker", "Wallet tracker", "The holders, one by one."],
    ["/how-to-analyze-meme-coins", "How to analyze meme coins", "The method, step by step."],
    ["/claude-crypto-analysis", "Analyze with your own AI", "Claude, ChatGPT or Gemini on the same data through MCP."],
  ])}
${RISK}`,
  faq: [
    ["How do I analyze a meme coin before buying?", `Check the safety score, then the holders (dev, bundles, snipers, concentration), then the chart with the known traders on it, then the narrative and the AI's read. BLIX puts all five on one screen.`],
    ["Is the meme coin analyzer free?", `Yes. Paste any Solana mint address into BLIX.`],
    ["Can I use my own AI to analyze a coin?", `Yes. The Blix MCP server gives Claude, Codex, Gemini or any MCP client the same holder, chart and safety data as tools.`],
    ["Does it analyze pump.fun coins before they graduate?", `Yes, from the first trade: holders, bonding progress, the rating and the safety read are live on the curve.`],
  ],
});

// ---------- /memecoin-analytics ----------
const memeAnalytics = page({
  path: "/memecoin-analytics", crumb: "Memecoin analytics",
  title: "Memecoin Analytics Dashboard: Volume, Holders, Momentum, Live | BLIX",
  description: "Live memecoin analytics for Solana: per-coin volume, market cap, liquidity, holders and momentum, trending and surge rankings, narrative heat.",
  h1: "Memecoin analytics, live",
  lede: `BLIX's analytics are computed from trades it decodes from the chain itself, so every number is live and nothing is an estimate: volume and momentum per coin, market cap and liquidity, holders and their concentration, the trending and surge rankings across the market, which narratives are gaining, who the best traders are, and how the AI's own calls have done. In the app with your account, and the same numbers on the API.`,
  body: `${START("Open the dashboard")}
${facts([["Per coin", "Market cap, volume, momentum, liquidity, holders, fees paid, trades"], ["Market", "Trending, Surge, narrative heat, launches per hour, trades per second"], ["Traders", "Top traders by profit; any wallet's PnL"], ["AI", "Track record per signal type; picks scorecard"], ["API", `${N_ENDPOINTS} endpoints, with your account`], FACT.price])}
<h2 id="trackers">The trackers, by question</h2>
${table(["You want to track", "Where", "Detail"], [
    ["Volume", "Coin page, Discover sorts", "Last 5 minutes, 1 hour, 24 hours; fees paid as the honest check"],
    ["Market cap", "Every row and chart", "Live in USD and SOL; the chart's last close is the header figure"],
    ["Liquidity", "Coin page, safety", "Pool liquidity and the sellable-liquidity check at your size"],
    ["Momentum", "Surge, trending rank", "Acceleration over the last minutes; a 0–100 traction rank"],
    ["Holders", "Holder panel", "Count, top 10, dev, snipers, bundles, who sold, known traders"],
    ["Performance", "Chart, wallet pages", "A coin's whole life; a wallet's realized and open profit"],
    ["Narratives", "Narratives", "Heat, launch share, lift versus previous hours, lead coins"],
    ["The AI", "Track record, picks", "Every call re-priced at 15m, 1h, 6h, 24h"],
  ])}
${F.discover()}
${F.narratives("Narrative analytics")}
${F.wallets("Trader analytics")}
<h2 id="record">The track record</h2>
<p>Every signal type is scored: how many checked, up 20%+, down 50%+, unsellable, median, reached 2x, with emptied pools counted as zero. The picks scorecard breaks results down by stage, by the AI's call and by the reason it gave. It is the most important analytics page in the app, because it tells you what the rest is worth.</p>
<h2 id="api">Analytics as an API</h2>
<p>With your account the dashboard is JSON: <code>/api/overview</code>, <code>/api/pulse</code>, <code>/api/tokens</code>, <code>/api/token/&lt;mint&gt;</code>, <code>/api/holders</code>, <code>/api/candles</code>, <code>/api/narratives</code>, <code>/api/wallets</code>, <code>/api/perf</code>, plus the live stream. See the <a href="/memecoin-api">memecoin API</a>.</p>
${links("More analytics pages", [
    ["/pump-fun-analytics", "pump.fun analytics", "The launchpad's numbers, live."],
    ["/meme-coin-analyzer", "Meme coin analyzer", "One coin, every angle."],
    ["/solana-pnl-tracker", "Solana PnL tracker", "Profit for any wallet."],
    ["/memecoin-narratives", "Narrative tracker", "Which stories are gaining."],
    ["/memecoin-api", "Memecoin API", "The numbers as JSON."],
  ])}
${RISK}`,
  faq: [
    ["Is the memecoin analytics dashboard free?", `Yes, with your account, and the same analytics are on the API.`],
    ["Where do the numbers come from?", `From trades Blix decodes from the pump.fun, PumpSwap and LaunchLab programs over a Solana RPC, plus Jupiter prices, DexScreener and GeckoTerminal pairs and RugCheck reports. Holders, volume and momentum are computed by Blix.`],
    ["Can I track a coin's market cap over time?", `Yes: the chart shows market-cap candles from 1 second to daily for the coin's whole life, and the candles are on the API.`],
    ["Does it track liquidity?", `Pool liquidity is on every coin, and the safety read checks what you could actually sell into at your size.`],
  ],
});

// ---------- /twitter-meme-coin-tracker ----------
const xTracker = page({
  path: "/twitter-meme-coin-tracker", crumb: "X meme coin tracker",
  title: "X (Twitter) Meme Coin Tracker: Posts to Coins in a Minute | BLIX",
  description: "Track meme coins on X: BLIX watches the accounts that call coins and turns every contract address, pump.fun link and $ticker into a live chip with a quick buy.",
  h1: "X (Twitter) meme coin tracker",
  lede: `Memecoins start as posts. BLIX's X tracker watches the accounts that call coins and turns each post into something tradable: every contract address, pump.fun or trading link and $ticker in a post becomes a chip with the coin's live market cap and a quick buy, within about a minute of the post. The narratives desk reads the wider conversation on X for you, and the feed carries callouts beside the big Fomo trades.`,
  body: `${START("Track X accounts")}
${facts([["Accounts", "The callers, launch and narrative accounts, watched for you"], ["Speed", "Posts within about a minute"], ["Coins", "Contract addresses, pump.fun and trading links, $tickers, as live chips"], ["Buy", "A quick buy on every chip"], ["Narratives", "What X is saying, researched and written up daily"], FACT.price])}
${F.x("How the X tracker works")}
<h2 id="use">How to use it</h2>
${steps([
    "Open the X tracker: the callers, the launch accounts and the narrative accounts BLIX watches are listed with their latest posts.",
    "Their posts appear in the tracker within about a minute. Every coin named is a chip with its live market cap.",
    "Open the chip: the coin's chart, holders and safety read are one click away, so a call is checked before it is bought.",
    "Buy from the chip, or paper-buy it and see what the call was worth.",
  ])}
${F.narratives("X, read for you")}
${F.feed()}
<h2 id="social-signals">Social signals with a record</h2>
<p>A call is a claim. BLIX puts the holder ledger, the rug check and the AI rating next to it, and every signal is re-priced afterwards. Over time you learn which accounts' calls hold up, by their results rather than their follower counts.</p>
${links("More social pages", [
    ["/memecoin-narratives", "Narrative tracker", "The stories gaining on X, with their coins."],
    ["/memecoin-social-sentiment", "Social sentiment research", "What BLIX measures and what it does not."],
    ["/memecoin-signals", "Memecoin signals", "Every signal type and its record."],
    ["/fomo-app", "Fomo app", "The social trading app, and how BLIX reads its traders."],
  ])}
${NOT_AFFILIATED("X Corp")}${RISK}`,
  faq: [
    ["How do I track meme coins on Twitter?", `Open BLIX's X tracker: the accounts that call coins are watched for you, and their posts arrive within about a minute, with every coin they name as a live chip you can check and buy.`],
    ["Does it track every X post about memecoins?", `No. It watches a curated set of accounts that call coins; the narratives desk covers the wider conversation by researching the day's stories on X.`],
    ["Can it buy a coin from a tweet?", `You can, in one click from the chip, with real SOL or paper. BLIX does not auto-buy calls.`],
  ],
});

// ---------- /memecoin-narratives ----------
const narratives = page({
  path: "/memecoin-narratives", crumb: "Narrative tracker",
  title: "Memecoin Narrative Tracker: Solana Trends, Written Daily | BLIX",
  description: "Track memecoin narratives and trends on Solana: which themes are gaining, bursts of launches on one word or X post, the day's runners.",
  h1: "Memecoin narrative and trend tracker",
  lede: `Memecoins move in stories: a post, an event, a word that suddenly has forty coins. BLIX detects the story as it forms (several launches on one word or one X post within minutes), measures each theme's heat and lift against the previous hours, and has Grok research the day's narratives and runners on X and the web and write them up: what the thing is, what happened, how it is trading, the coins and their roles, the case for and against, what to watch. Blix's own live numbers sit beside the text.`,
  body: `${START("Read today's narratives")}
${facts([["Detection", "Theme classification on every launch; bursts on one word or X post"], ["Measure", "Heat, launch share, lift versus previous hours, emerging words, lead coins"], ["Today", "Daily articles on the stories and runners, researched on X and the web"], ["Model", "Grok 4.7 with live X search"], ["Live", "A story's coins, state and known traders update as they trade"], FACT.price])}
${F.narratives("The Today desk")}
<h2 id="burst">Burst detection</h2>
<p>When several launchers create coins on the same word or the same X post within minutes, that is a narrative burst, and it is caught in seconds. The AI looks the burst up on X and names the story, so the first coin of a real event is separated from the eleventh copy. A scout also looks every hour for catalysts that have no coin yet.</p>
<h2 id="trend">Trend analytics</h2>
<p>Each theme (AI agents, animals, politics, brainrot and the rest) carries its heat, its share of launches, its lift against the previous hours and the words emerging inside it, with the lead coins. It is the view that tells you a story is heating up before its best coin has run.</p>
${F.x("The accounts that start narratives")}
${F.picks("Narratives feed the picks")}
<h2 id="sentiment">Sentiment, honestly</h2>
<p>BLIX does not publish a sentiment score, because a number without the reasoning is noise. What it does is show the conversation itself (the posts and pages a narrative came from, written up with the case for and against) and measure what people are doing on chain. The <a href="/memecoin-social-sentiment">social sentiment page</a> explains what is measured and what is not.</p>
${FIND_MORE}
${RISK}`,
  faq: [
    ["What is a memecoin narrative?", `The story a group of coins trades on: an event, a post, an animal, a person. BLIX groups coins by narrative, measures which are gaining and writes the day's stories up.`],
    ["How does BLIX detect trends early?", `By classifying every launch into themes as it lands and by catching bursts of launches on one word or one X post within minutes, then having the AI research and name the story.`],
    ["Who writes the narrative articles?", `Grok 4.7, researching each subject on X and the web, with Blix's own live numbers beside the text. An article is rewritten when its subject moves a lot.`],
    ["Is this a crypto sentiment AI?", `It reads and explains the conversation rather than scoring it. The posts and sources are linked so you can judge them yourself.`],
  ],
});

// ---------- /solana-swap ----------
const swap = page({
  path: "/solana-swap", crumb: "Solana swap",
  title: "Solana Swap for Memecoins: One-Click Buy & Sell | BLIX",
  description: "Swap Solana memecoins in one click from any list or chart: Jupiter routing, a priority fee set per trade, take profit and stops on every position, 2% fee.",
  h1: "Solana swaps for memecoins, in one click",
  lede: `A memecoin swap has to be fast and has to be checked. On BLIX the check is already on screen (holders, rug check, AI rating), and the swap is one click from any list or chart: the route comes from Jupiter, the priority fee is set per trade so the transaction lands, and the position lands in your portfolio with take profit, stop loss and trailing stop ready to set. Buys are in SOL, sells by share of the position, from your own Blix wallet.`,
  body: `${START("Start swapping")}
${facts([FACT.fee, ["Routing", "Jupiter: PumpSwap, Raydium, Meteora and every pool it covers"], ["Speed", "Priority fee set per trade; status shown until it confirms"], ["Exits", "Take profit, stop loss, trailing stop, partial sells"], ["Wallet", "Made at sign-up; export the key or withdraw any time"], FACT.paper])}
${F.trade("How a trade works")}
<h2 id="costs">What a swap costs</h2>
${table(["Cost", "Amount"], [
    ["BLIX fee", "2% of the trade; 1.6% if you joined through an invite. 40% of it goes to whoever invited you"],
    ["Pool fee", "The DEX's own fee, inside Jupiter's quote (pump.fun curve 1.25%; PumpSwap tiered; Raydium by pool)"],
    ["Network", "Solana's base fee plus the priority fee set for the trade (capped, about a thousandth of a SOL)"],
    ["Slippage", "Your allowance; the quote shows the price impact at your size before you confirm"],
  ])}
<h2 id="exits">Exits run for you</h2>
<p>Set a take profit multiple, a stop loss, a trailing stop or all three on any position, or sell part of it by hand. The rules run on the server and fire while the app is closed. The AI's exit plan from a deep read can be applied in one click.</p>
<h2 id="quote">Quotes before you commit</h2>
<p>Every buy and sell shows the real Jupiter quote first: the amount out, the price impact and the route. The sellable-liquidity check on the safety tab asks for a real sell quote at your size, so a coin you could not get out of is flagged before you get in.</p>
${F.paper()}
<h2 id="api">Swaps and the API</h2>
<p>The API that comes with your account quotes swaps through Jupiter (<code>GET /api/quote</code>) and runs your paper desk; it never signs. Real swaps are made in the terminal, by you.</p>
${links("More trading pages", [
    ["/solana-trading-terminal", "Solana trading terminal", "The whole workflow."],
    ["/pump-fun-terminal", "pump.fun terminal", "The launchpad, start to finish."],
    ["/memecoin-paper-trading", "Paper trading", "Practise first."],
    ["/ai-trading-bot", "AI trading bot", "What runs for you, and what does not."],
  ])}
${RISK}`,
  faq: [
    ["How fast is a swap on BLIX?", `One click from the list or chart; the priority fee is set per trade so the transaction confirms quickly, and the status is shown until it does.`],
    ["What is the swap fee?", `2% a trade, 1.6% if you joined through an invite, plus the pool's own fee and Solana's network fee.`],
    ["Can I sell part of a position?", `Yes, by share, in one click, and take profit, stop loss and trailing stop can each close part or all of it automatically.`],
    ["Is there a buy or sell API?", `Not for real money. The API quotes and paper-trades; real execution is in the terminal.`],
    ["Do I control the wallet?", `Yes. It is made for you at sign-up and you can export its private key or withdraw at any time.`],
  ],
});

// ---------- /solana-memecoins ----------
const memeHub = page({
  path: "/solana-memecoins", crumb: "Solana memecoins", eyebrow: `Memecoins · checked ${CHECKED}`,
  title: "Solana Memecoins: How They Work and How to Trade Them in 2026 | BLIX",
  description: "Solana memecoins explained for traders: where they launch, how the bonding curve and graduation work, what rugs look like, how narratives drive them.",
  h1: "Solana memecoins: a trader's guide",
  lede: `Solana is where memecoins launch: thousands a day on pump.fun, more on Raydium LaunchLab and straight into pools, most dead within the hour, a few running to hundreds of millions. This guide covers how they work (the launchpads, the curve, graduation, fees), what separates a runner from a rug, how narratives drive the market, and how <a href="/">BLIX</a> puts every coin on one screen with the holders, a rug check and an AI read, and trades it in one click.`,
  body: `${START()}
${facts([["Where they launch", "pump.fun (most), Raydium LaunchLab, direct pools"], ["Where they trade", "PumpSwap, Raydium, Meteora, routed by Jupiter"], ["How many", "About 2,000 an hour on pump.fun"], ["What runs", "A story people want, a fair setup, real buyers"], FACT.ai, FACT.price])}
<h2 id="launch">Where memecoins come from</h2>
<p>Most Solana memecoins are created on pump.fun for free and trade on a bonding curve until it sells out, then graduate to a PumpSwap pool. Raydium's LaunchLab (behind letsbonk.fun) works the same way with its own curve and graduates to Raydium. Some coins launch straight into a pool. <a href="/pump-fun">The pump.fun page</a> has the mechanics and the fees.</p>
<h2 id="lifecycle">The life of a memecoin</h2>
${steps([
    "<b>Launch.</b> Bots buy the first blocks (snipers, bundles); most coins die here.",
    "<b>Curve.</b> If real buyers arrive the market cap climbs toward graduation (about 411 SOL on pump.fun). This is the Final stretch.",
    "<b>Graduation.</b> The coin moves to a pool; volume and attention peak; this is where most runners are made or broken.",
    "<b>Run or fade.</b> A story people keep sharing, holders who are not one cluster, and a dev who does not sell can carry a coin for days; otherwise it fades.",
  ])}
${F.pulse("Watching the lifecycle live")}
<h2 id="rugs">Rugs, and how they look before they happen</h2>
<p>The patterns repeat: a dev or a bundle holding a big share, snipers in the first blocks, the supply in a few wallets linked by funding, mint or freeze authority kept, thin or unlocked liquidity, a dev with a string of dead coins. BLIX checks all of it on every coin and gives one number with the reasons. <a href="/rug-pull-scanner">The rug pull scanner page</a> goes through each sign.</p>
${F.narratives("Narratives drive the market")}
${F.rating()}
${F.wallets("Who is trading them")}
${F.trade()}
<h2 id="terms">Terms you will see</h2>
${table(["Term", "Meaning"], [
    ["Bonding curve", "The formula that prices a coin before it has a pool; buys push the price up along it"],
    ["Graduation / migration / bonded", "The curve sold out and the coin moved to a pool"],
    ["Sniper", "A wallet that bought within two blocks of the first trade"],
    ["Bundle", "Wallets that bought in the same block as the first trade, usually the launcher's"],
    ["Dev", "The wallet that created the coin"],
    ["Top 10", "The share of supply held by the ten largest wallets"],
    ["Narrative", "The story a group of coins trades on"],
    ["Mcap", "Market cap: price times the billion-token supply"],
  ])}
${FIND_MORE}
${RISK}`,
  faq: [
    ["What is a Solana memecoin?", `A token on Solana created around a joke, a story or a moment rather than a product, usually launched on pump.fun with a billion-token supply and traded for its attention.`],
    ["How do I start trading Solana memecoins?", `Sign in to BLIX with Google, deposit SOL to the wallet it makes for you (or start in paper mode), and buy in one click from Pulse or Discover after checking the holders and the rug check.`],
    ["Why do most memecoins go to zero?", `Most are launched to be sold into by their own creators, and the rest compete for attention that moves on in hours. The holder panel and the narrative tell you which kind you are looking at.`],
    ["Which is the best Solana memecoin terminal?", `See the <a href="/best-solana-trading-terminal">comparison</a>. BLIX is the one with AI reads, an API and MCP connector with the account, and a coin launcher, at the same 1% fee as the others.`],
  ],
});

// ---------- /best-solana-trading-terminal ----------
const best = page({
  path: "/best-solana-trading-terminal", crumb: "Best Solana trading terminal", eyebrow: `Terminals compared · checked ${CHECKED}`,
  title: "Best Solana Trading Terminal for Memecoins (2026 Comparison) | BLIX",
  description: "The best Solana trading terminals compared on fees, speed, custody, AI and API: BLIX, Axiom, Photon, GMGN, BullX, Fomo and nio.trade, checked October 2026.",
  h1: "Best Solana trading terminal for memecoins",
  lede: `Every Solana memecoin terminal shows the same launches and charges about the same 1%. The differences are what each adds: speed and keys (Axiom, Photon), chains and copy trading (GMGN), a social feed (Fomo), cashback (nio.trade), and in BLIX's case an AI that reads every coin, an API and MCP connector with every account, and a coin launcher. BullX suspended trading in June 2026. Here is the comparison as of ${CHECKED}, with what each terminal is best for.`,
  body: `${START("Try BLIX")}
${compare(["blix", "axiom", "photon", "gmgn", "fomo", "nio", "bullx"])}
<h2 id="for">Which terminal for what</h2>
${table(["If you want", "Consider", "Why"], [
    ["AI reads, picks and narratives on every coin", "BLIX", "The only terminal here with a model reading each coin and a public record of its calls"],
    ["The fastest execution with exportable keys", "Axiom, Photon", "Built around speed; Axiom adds Hyperliquid perps"],
    ["Many chains and copy trading", "GMGN", "Solana, Ethereum, Base, BNB, Tron; strong wallet copy"],
    ["A social feed of traders on your phone", "Fomo", "Buys, sells and theses from traders; network fees covered"],
    ["Cashback on volume", "nio.trade, Axiom", "Both advertise cashback tiers"],
    ["An API and an MCP connector", "BLIX", "Included with every account"],
    ["To launch a coin from the same app", "BLIX", "pump.fun launch in one screen, creator fees shown and claimable"],
  ])}
<h2 id="blix">What BLIX adds</h2>
${F.rating()}
${F.narratives()}
${F.holders("Holders with faces")}
${F.api()}
<h2 id="status">A note on BullX</h2>
<p>BullX suspended trading on its app on June 1, 2026; withdrawals and wallet access stayed open and no relaunch date was published as of ${CHECKED}. If you are looking for a BullX alternative, the table above is the list. See <a href="/bullx-alternative">BullX alternative</a>.</p>
${links("Compare one by one", [
    ["/axiom-vs-fomo", "Axiom vs Fomo", "Speed versus social."],
    ["/axiom-vs-photon", "Axiom vs Photon", "The two fast ones."],
    ["/axiom-vs-gmgn", "Axiom vs GMGN", "Solana speed versus multi-chain."],
    ["/axiom-vs-bullx", "Axiom vs BullX", "And what happened to BullX."],
    ["/compare", "BLIX compared", "Side by side with Axiom, Fomo and nio.trade."],
    ["/photon-alternative", "Photon alternative", "What to use instead of Photon."],
  ])}
${NOT_AFFILIATED("Axiom Trade, Photon, GMGN, BullX, Fomo or nio.trade")}${RISK}`,
  faq: [
    ["What is the best Solana trading terminal?", `For AI reads and an open API, BLIX; for raw speed, Axiom or Photon; for many chains, GMGN; for a social feed, Fomo. All charge about 1% a trade. BullX is not trading as of ${CHECKED}.`],
    ["Which terminal has the lowest fees?", `Fomo quotes about 0.5% on spot; Axiom nets 0.75–0.95% after cashback; Photon and GMGN are about 1%; BLIX is 2%, 1.6% through an invite, with 40% of the fee going to the inviter. Network fees are extra everywhere.`],
    ["Is there a free Solana trading terminal?", `All of them are free to use and charge per trade. BLIX also has a free paper mode, and the API and MCP connector come with the account.`],
    ["Which terminals have an API?", `GMGN has an OpenAPI with a key by application. BLIX includes an API and an MCP connector with every account. The others publish none.`],
  ],
});

export const TRADE_PAGES = [memeScanner, solScanner, memeSignals, smart, whale, rugScanner, finder, newCoins, trending, analyzer, memeAnalytics, xTracker, narratives, swap, memeHub, best];
