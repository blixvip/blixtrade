// Guides and the /tools hub. The hub's body is a function of the whole page registry (pages.js calls it once PAGES
// is built), so every page on the site is listed and no link can point at a page that is not there.
import { F, FACT, START, DISCORD, COMMUNITY, RISK, CHECKED, N_ENDPOINTS, N_TOOLS, esc, table, facts, steps, bullets, links, page } from "./pagekit.js";

const GUIDE_MORE = links("More guides", [
  ["/how-to-find-meme-coins-early", "How to find meme coins early", "A research workflow for new coins."],
  ["/how-to-track-solana-wallets", "How to track Solana wallets", "From one address to the whole picture."],
  ["/how-to-analyze-meme-coins", "How to analyze meme coins", "Five minutes, five questions."],
  ["/how-to-use-ai-for-crypto-trading", "How to use AI for crypto trading", "What to ask it, and what not to."],
  ["/how-to-create-a-meme-coin", "How to create a meme coin", "The whole process, step by step."],
  ["/how-to-build-a-solana-trading-bot", "How to build a Solana trading bot", "Data, rules, paper tests, execution."],
]);

// ---------- /how-to-track-solana-wallets ----------
const wallets = page({
  path: "/how-to-track-solana-wallets", crumb: "How to track Solana wallets", eyebrow: `Guide · checked ${CHECKED}`,
  title: "How to Track Solana Wallets (and Find Smart Money) in 2026 | BLIX",
  description: "How to track any Solana wallet: holdings, swaps and profit from the chain, the smart money behind past runners, and how to tell a smart wallet from an insider.",
  h1: "How to track Solana wallets",
  lede: `Every Solana wallet is public, which means every trader's record is public too. This guide shows how to read one wallet properly (swaps, realized and open profit, linked wallets), how smart wallets' next buys reach you as signals, how to find the smart money behind past runners instead of taking someone's word for it, and how to tell a smart wallet from an insider. All of it is in BLIX with an account.`,
  body: `${START()}
${facts([["Read", "Any wallet: swaps on every DEX, realized / open / sellable profit, linked wallets"], ["Signals", "Smart and leaderboard wallets' buys and sells, with each record beside them"], ["Find", "Early buyers of past runners, ranked by profit"], ["Faces", "Fomo and pump.fun leaderboard traders matched to their wallets"], ["Insiders", "Dev, snipers, bundles and funding links on every coin"], FACT.community])}
<h2 id="steps">Step by step</h2>
${steps([
    "<b>Open the wallet.</b> Paste the address into BLIX's search, or click any wallet in a holder list, the trades list or the Top traders board. Its page is built from the chain: every swap, open positions, realized and open profit, and the wallets funded from the same source.",
    "<b>Read the last twenty trades.</b> Did it buy early and sell for a profit, or buy everything and hold to zero? A wallet that is early on several runners and takes profit is smart money; a wallet that is early on everything is a sniper bot.",
    "<b>Watch its next move.</b> Buys and sells by the wallets BLIX follows (smart money and leaderboard traders) arrive as signals with the wallet's record beside each one, so a buy from a wallet that is right 60% of the time reads differently from one that is right 10%.",
    "<b>Let BLIX find the rest.</b> Smart money is discovered from the chain: the early buyers of coins that ran, ranked by profit and hit rate. The best are followed automatically.",
    "<b>Check the coin, not just the wallet.</b> On any coin, the holder panel shows the dev, snipers, bundles and top 10, and the bubble map links wallets funded from one source. A 'smart wallet' that is early on its own coins is an insider.",
  ])}
${F.wallets()}
${F.smart()}
${F.holders("Wallets inside a coin")}
<h2 id="pnl">Reading profit correctly</h2>
<p><b>Realized</b> is SOL out minus SOL in on closed size. <b>Open</b> marks what is still held at the live price. <b>Sellable</b> asks what the open size would really fetch right now, which on a thin pool is much less than open. A wallet showing a big open profit on a coin nobody can sell has not made anything yet.</p>
<h2 id="api">The same tracking as data</h2>
<p>With your account, any wallet is <code>GET /api/wallet-page/&lt;address&gt;</code>, the smart-money ranking is <code>GET /api/wallets</code>, and smart wallets' buys are <code>signal</code> events on the live stream. The <a href="/wallet-tracking-api">wallet tracking API</a> page has the details.</p>
${COMMUNITY}
${GUIDE_MORE}
${RISK}`,
  faq: [
    ["How do I track a Solana wallet for free?", `Create a BLIX account, paste the address, and the wallet's page is built from the chain: holdings, swaps, positions and profit. Smart wallets' trades become signals.`],
    ["How do I find smart money wallets?", `Let BLIX find them: it pulls the early buyers of every coin that ran and ranks them by profit. Or open a runner's holder list, sort by entry time, and check each early wallet's record.`],
    ["Can I copy a wallet's trades?", `You see its buys as signals and buy in one click yourself. BLIX does not auto-mirror; by the time a mirror fills the edge is usually gone.`],
    ["What is a linked wallet?", `A wallet funded from the same source as another. BLIX groups them so one trader's many wallets read as one, in wallet pages and on the bubble map.`],
  ],
});

// ---------- /how-to-analyze-meme-coins ----------
const analyze = page({
  path: "/how-to-analyze-meme-coins", crumb: "How to analyze meme coins", eyebrow: `Guide · checked ${CHECKED}`,
  title: "How to Analyze Meme Coins in 5 Minutes (Solana & pump.fun) | BLIX",
  description: "A five-minute method to analyze any meme coin before you buy: the rug check, the holders, the chart with the traders on it, the narrative, and the AI's read.",
  h1: "How to analyze a meme coin in five minutes",
  lede: `A memecoin analysis has five questions, and they go in order: is the setup a rug, who holds it, what does the chart say about who is buying, why does the coin exist, and what does a model that read all of that think. BLIX puts the five answers on one screen; this guide tells you what to look for in each, in the order that saves the most time.`,
  body: `${START()}
${facts([["1. Safety", "One number, with reasons: authorities, liquidity, dev, bundles, snipers, concentration"], ["2. Holders", "Dev share and sales, first-block wallets, top 10, known traders"], ["3. Chart", "Candles from real trades; traders' faces where they bought and sold"], ["4. Story", "The narrative, the X post, how many copies"], ["5. AI", "Grade, thesis, risks, plan, and the record of similar calls"], FACT.community])}
<h2 id="method">The method</h2>
${steps([
    "<b>Safety first, and stop if it fails.</b> The rug check scores the setup: mint and freeze authority, liquidity locked or pulled, the dev's past launches, bundle and sniper share, top-holder concentration, whether the dev sold. Bundles or snipers above 20%, a dev holding a big share or a serial launcher: pass, and nothing else matters.",
    "<b>Who holds it.</b> The dev's share now and at peak, and whether it sold. How much the first-block wallets still hold. Whether the top ten are one cluster on the bubble map. Which known traders are in, by name.",
    "<b>What the chart says.</b> Candles from 1 second to daily, built from real trades. Where the faces are: did known traders buy the dip or sell the top? Are the buys from many traders or a few? Fees paid tells you the volume is real.",
    "<b>Why it exists.</b> The narrative it rides and whether the story is live; the X post behind it; how many copies launched this hour. The Today desk has the write-up for the day's stories.",
    "<b>The AI's read.</b> The grade, thesis, ceiling, catalysts, risks and plan, and the track record of similar calls. It is an opinion with a public score, not a forecast.",
  ])}
${F.safety()}
${F.holders()}
${F.chart()}
${F.narratives()}
${F.rating("The deep read")}
<h2 id="then">Then decide, and let the exits run</h2>
<p>If it passes, set a size you can lose, buy in one click, and put a take profit and a trailing stop on it. If you are not sure, paper-buy it and see what the next hour would have taught you. Either way, write down the reason; the picks scorecard shows that reasons are what separate a method from a guess.</p>
${COMMUNITY}
${GUIDE_MORE}
${RISK}`,
  faq: [
    ["What is the most important thing to check on a meme coin?", `The holders. A coin whose supply sits with the dev, a bundle or one cluster of linked wallets will be sold into you no matter how good the chart looks.`],
    ["How do I analyze a pump.fun coin before it graduates?", `The same five questions work from the first trade: holders, the dev, bundles and snipers are tracked on the curve, and the Final stretch column shows how close it is to graduating.`],
    ["Can AI analyze the coin for me?", `BLIX's AI reads every coin and grades the strongest with a thesis and plan; its calls are scored publicly. Use it as the fifth question, not the first.`],
    ["Is this free?", `Yes, with a BLIX account. Paper mode lets you test your analysis at real quotes without SOL.`],
  ],
});

// ---------- /how-to-use-ai-for-crypto-trading ----------
const useAi = page({
  path: "/how-to-use-ai-for-crypto-trading", crumb: "How to use AI for crypto trading", eyebrow: `Guide · checked ${CHECKED}`,
  title: "How to Use AI for Crypto & Meme Coin Trading (2026) | BLIX",
  description: "A practical guide to using AI for crypto and meme coin trading: what a model is good at (reading, grading, explaining, keeping score).",
  h1: "How to use AI for crypto and meme coin trading",
  lede: `Used well, AI makes a memecoin trader faster and more honest: it reads two thousand launches an hour, explains what a coin is, grades the setup, and keeps a score you can check. Used badly, it is a chatbot guessing at prices. This guide is the practical version: what to ask an AI, what never to ask it, how BLIX's AI is built, and how to put your own AI (Claude, ChatGPT, Gemini, DeepSeek) on live data with the MCP connector that comes with your account.`,
  body: `${START()}
${facts([FACT.ai, ["Scored", "Every call re-priced at 15m, 1h, 6h, 24h"], ["Your AI", `MCP connector with ${N_TOOLS} tools, with your account`], ["Models", "Grok with live X search writes BLIX's reads; any model through MCP"], ["Exits", "Take profit, stop loss, trailing stop run for you"], FACT.community])}
<h2 id="good">What AI is good at</h2>
${table(["Ask it to", "Why it works"], [
    ["Read every coin and shortlist", "Volume is the problem; a model reads each launch in seconds"],
    ["Explain a coin", "What the name refers to, the X post behind it, whether it is a copy, who is behind it"],
    ["Grade the setup", "Holders, bundles, dev history, liquidity and chart folded into one call with reasons"],
    ["Find the story", "Which narratives are forming and which coins lead them"],
    ["Keep score", "Every call re-priced later; the record per reason tells you what to trust"],
  ])}
<h2 id="bad">What never to ask it</h2>
${bullets([
    "<b>Which coin will 10x.</b> Memecoins run on attention; no model forecasts a crowd. A confident answer is a confident guess.",
    "<b>To trade for you.</b> A model with a wallet and no edge loses faster. BLIX's AI picks; you buy; BLIX runs the exits.",
    "<b>About a coin it cannot see.</b> A chatbot without live holders, chart and liquidity will call a bundled rug \"a strong community\". Give it data (BLIX's MCP connector) or do not ask.",
  ])}
<h2 id="how">How BLIX's AI works</h2>
<p>Every launch gets an instant rules score (liquidity, holders, bundles, the dev's history, same-name launches this hour) which a fast model relabels within seconds. The strongest coins get a deep read: the model searches X and the web for the story, reads the holder ledger, chart and safety report, and writes a grade from A to F, a thesis, the ceiling, catalysts, risks, a buy / watch / avoid call and an exit plan. Every call is scored afterwards and the AI rewrites its own playbook from the scorecard. The reads are written by Grok, which searches X live while it reads.</p>
<h2 id="routine">A daily routine</h2>
${steps([
    "Read today's picks and the Today desk: the AI's short list and the stories behind it.",
    "For each coin you like, run the five-minute analysis (the <a href=\"/how-to-analyze-meme-coins\">guide</a>) with the AI's read as the last step.",
    "Buy in one click or paper-buy, with a take profit and a trailing stop.",
    "Once a week, read the track record: which signal types and which reasons worked, and lean on those.",
  ])}
<h2 id="own">Your own AI on live data</h2>
<p>Your account includes the MCP connector: ${N_TOOLS} tools that give Claude, Codex, Gemini CLI, Cursor or any MCP client the Pulse, every coin's holders and chart, real quotes, the AI's reads and a paper desk. <a href="/how-to-use-mcp-for-crypto">How to use MCP for crypto</a> sets it up per client; <a href="/best-ai-for-crypto-trading">best AI for crypto trading</a> compares the models.</p>
${F.picks()}
${COMMUNITY}
${GUIDE_MORE}
${RISK}`,
  faq: [
    ["Can AI predict meme coins?", `No. It can read, grade, explain and keep score; it cannot forecast a crowd. Use its record, not its confidence.`],
    ["Which AI should I use for crypto trading?", `For coins born on X, Grok (it searches X live); for an agent working through tools, Claude. BLIX's reads use Grok; any model works through the MCP connector.`],
    ["Does BLIX's AI trade for me?", `No. It rates, researches and picks; you buy in one click; BLIX runs your exits automatically.`],
    ["How do I give ChatGPT live crypto data?", `Through OpenAI's Codex CLI with the BLIX MCP connector, or a remote bridge for the ChatGPT web app. See the <a href="/chatgpt-meme-coin-analysis">ChatGPT page</a>.`],
  ],
});

// ---------- /tools ----------
// Everything on the site, grouped. Built from PAGES once it exists (pages.js), so every page is listed and every link
// resolves; a group lists whichever of its paths exist.
const GROUPS = [
  ["Trade", ["/solana-trading-terminal", "/pump-fun-terminal", "/solana-swap", "/memecoin-paper-trading", "/best-solana-trading-terminal", "/solana-memecoins", "/pump-fun"]],
  ["Find coins", ["/pump-fun-tracker", "/solana-memecoin-screener", "/pump-fun-scanner", "/memecoin-scanner", "/solana-token-scanner", "/meme-coin-finder", "/new-meme-coins", "/trending-meme-coins", "/how-to-find-meme-coins-early"]],
  ["Check coins", ["/meme-coin-analyzer", "/memecoin-analytics", "/pump-fun-analytics", "/rug-pull-scanner", "/pump-fun-rug-checker", "/memecoin-risk-scanner", "/how-to-analyze-meme-coins"]],
  ["Signals and narratives", ["/memecoin-signals", "/pump-fun-signals", "/memecoin-alerts", "/memecoin-narratives", "/memecoin-social-sentiment", "/twitter-meme-coin-tracker"]],
  ["Wallets", ["/solana-wallet-tracker", "/pump-fun-wallet-tracker", "/smart-money-tracker", "/solana-whale-tracker", "/solana-pnl-tracker", "/how-to-track-solana-wallets"]],
  ["AI", ["/ai-memecoin-trading", "/ai-memecoin-picks", "/ai-trading-bot", "/ai-trading-agent", "/grok-meme-coin-picks", "/claude-crypto-analysis", "/chatgpt-meme-coin-analysis", "/gemini-crypto-picks", "/deepseek-meme-coin-picks", "/best-ai-for-crypto-trading", "/best-crypto-ai-tools", "/how-to-use-ai-for-crypto-trading"]],
  ["Create a coin", ["/create-pump-fun-coin", "/create-memecoin", "/ai-meme-coin-maker", "/meme-coin-name-generator", "/how-to-create-a-meme-coin"]],
  ["Developers", ["/developers", "/api", "/mcp", "/pump-fun-api", "/solana-api", "/memecoin-api", "/wallet-tracking-api", "/pump-fun-mcp", "/crypto-mcp-server", "/memecoin-mcp-server", "/how-to-use-mcp-for-crypto", "/pump-fun-websocket", "/pumpfun-realtime-api", "/pump-fun-api-python", "/pump-fun-api-javascript", "/pump-fun-sdk", "/memecoin-sdk", "/crypto-trading-cli", "/how-to-build-a-solana-trading-bot", "/pump-fun-trading-bot"]],
  ["Compared", ["/compare", "/compare/axiom-alternative", "/compare/fomo-alternative", "/compare/nio-trade-alternative", "/photon-alternative", "/bullx-alternative", "/gmgn-alternative", "/dexscreener-alternative", "/birdeye-alternative", "/jupiter-terminal-alternative", "/axiom-vs-fomo", "/axiom-vs-photon", "/axiom-vs-gmgn", "/axiom-vs-bullx", "/fomo-vs-bullx", "/pump-fun-vs-letsbonk", "/pump-fun-vs-moonshot", "/pump-fun-vs-raydium"]],
  ["About the others", ["/axiom-trade", "/axiom-api", "/axiom-mcp", "/axiom-trading-bot", "/axiom-scanner", "/fomo-app", "/fomo-api", "/fomo-mcp", "/fomo-trading-bot", "/fomo-scanner", "/gmgn-api", "/nio-trade", "/nio-trade-api"]],
  ["Guides", ["/guides"]],
];
const tools = page({
  path: "/tools", crumb: "Everything BLIX does", eyebrow: "BLIX · every page",
  title: "Everything BLIX Does: Tools, Guides and Comparisons | BLIX",
  description: "Every BLIX page in one place: trading, scanners, signals, wallets, AI, coin creation, developer access, comparisons with Axiom, Fomo, Photon, GMGN and BullX.",
  h1: "Everything BLIX does",
  lede: `BLIX is one terminal, and one free account unlocks all of it: live pump.fun and Solana scanning, one-click trading with your own wallet, an AI that reads every coin, wallet and X tracking, a coin launcher, developer access with the API and MCP connector, and the Discord. This page lists every part of the site, grouped by what you are trying to do.`,
  body: (PAGES) => `${START()}
${GROUPS.map(([name, paths]) => {
    const rows = paths.filter((p) => PAGES[p]).map((p) => `<a href="${p}"><b>${esc(PAGES[p].h1)}</b><span>${esc(PAGES[p].description)}</span></a>`);
    return rows.length ? `<h2 id="${name.toLowerCase().replace(/[^a-z]+/g, "-")}">${esc(name)}</h2><div class="related">${rows.join("")}</div>` : "";
  }).join("")}
${COMMUNITY}`,
  faq: [
    ["Is all of this included with one account?", `Yes. Sign in with Google and the terminal, the AI, wallet tracking, the launcher, developer access and the Discord are all yours. Real trades pay 2% (1.6% with an invite); everything else is free.`],
    ["Do I need to install anything?", `No. BLIX runs in the browser on desktop and phone. The MCP connector for AI clients is one small file you download from your account.`],
  ],
});

export const GUIDE_PAGES = [wallets, analyze, useAi, tools];
