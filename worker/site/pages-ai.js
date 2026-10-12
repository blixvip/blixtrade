// AI pages: AI memecoin trading, bots, agents, picks, one page per model people search for (Grok, Claude, ChatGPT,
// Gemini, DeepSeek and the open models), and the "best AI for crypto trading" comparison. What Blix's AI does is
// stated the same way on every page: it rates, researches and picks; a person buys.
import { F, FACT, START, DEV_CTA, SIGNIN_DEV, DISCORD, COMMUNITY, NOT_AFFILIATED, RISK, CHECKED, N_TOOLS, BASE, MCP_SETUP, code, table, facts, steps, bullets, callout, links, page } from "./pagekit.js";

const HOW_AI = `<h2 id="how-ai">How Blix AI works</h2>
<p>Every launch gets an instant rules score (liquidity, holders, bundles, the dev's history, how many same-name launches this hour) which a fast model relabels within seconds. The strongest coins get a deep read: the model searches X and the web for the coin's story, reads Blix's own holder ledger, chart and safety report, and writes a grade from A to F, a thesis, the ceiling, catalysts, risks, a buy / watch / avoid call with conviction, and an entry and exit plan. Every call is scored afterwards at 15 minutes, 1 hour, 6 hours and 24 hours, and the AI rewrites its own playbook from that scorecard. The deep reads are written by Grok 4.7 with live X search.</p>`;
const AI_FACTS = [["Rating", "Every coin, live, from liquidity, holders, volume and risk"], ["Deep reads", "Grade A–F, thesis, catalysts, risks, buy / watch / avoid, exit plan"], ["Picks", "Daily, with reasons, scored after the fact"], ["Narratives", "Written up each day from X and the web"], ["Model", "Grok 4.7 with live X search"], FACT.price];
const AI_MORE = links("More AI pages", [
  ["/ai-memecoin-picks", "AI meme coin picks", "Today's picks, the reasons, and the record."],
  ["/ai-trading-bot", "AI trading bot", "What an AI bot can do, and what BLIX does instead."],
  ["/ai-trading-agent", "AI trading agent", "An agent that reads the market through MCP."],
  ["/grok-meme-coin-picks", "Grok meme coin picks", "The model behind Blix AI."],
  ["/best-ai-for-crypto-trading", "Best AI for crypto trading", "Grok, Claude, ChatGPT, Gemini and DeepSeek compared."],
  ["/memecoin-narratives", "Memecoin sentiment and narratives", "What X is saying, written up daily."],
]);

// ---------- /ai-memecoin-trading ----------
const trading = page({
  path: "/ai-memecoin-trading", crumb: "AI memecoin trading",
  title: "AI Memecoin Trading on Solana: How It Works in 2026 | BLIX",
  description: "AI memecoin trading explained: what an AI can and cannot do with pump.fun coins, how Blix AI rates, reads and picks, and how you trade on it in one click.",
  h1: "AI memecoin trading on Solana",
  lede: `AI memecoin trading is not a robot that prints money; it is a model doing the reading you do not have time for across two thousand launches an hour. BLIX puts that model on every coin: a live rating, a deep read with a grade and a plan, daily picks with reasons, narratives written up from X, and a record of how all of it did. You stay the trader. Buy in one click with real SOL from your Blix wallet, or practise in paper mode first.`,
  body: `${START()}
${facts(AI_FACTS)}
${HOW_AI}
<h2 id="can">What AI can do for a memecoin trader</h2>
${bullets([
    "<b>Read everything.</b> Two thousand launches an hour cannot be read by a person; a model reads each one in seconds and tells you which handful deserve a look.",
    "<b>Explain the coin.</b> What the name refers to, which X post started it, who is behind it, whether it is a copy of a coin that already ran.",
    "<b>Grade the setup.</b> Holders, bundles, dev history, liquidity and the chart, folded into one call with the reasons.",
    "<b>Keep score honestly.</b> Every call is re-priced later; losses are shown next to wins so you know what the AI is worth.",
    "<b>Run the exit.</b> Not AI, but the part most people fail at: take profit, stop loss and trailing stop run for you on every position.",
  ])}
<h2 id="cannot">What it cannot do</h2>
<p>It cannot predict which coin will run. A memecoin runs because people decide to buy it, and the AI's read is an informed opinion about the setup and the story, not a forecast. That is why BLIX shows the record of every signal type and every pick: so the opinion is weighed by its results, not by its confidence.</p>
${F.picks()}
${F.narratives("The AI reads X so you do not have to")}
${F.trade()}
${F.paper()}
<h2 id="steps">How to use AI for memecoin trading, in practice</h2>
${steps([
    "Open AI early picks in the morning and read today's buy and watch calls with their reasons.",
    "Open each coin: check the rug check, the holders and who is on the chart, then the narrative it rides.",
    "Decide. If you agree, set a size and buy in one click; if not, paper-buy it and see what you would have learned.",
    "Set take profit and a trailing stop on every position, and let BLIX run them.",
    "Check the track record weekly: which signal types and which reasons are working, and lean on those.",
  ])}
${AI_MORE}
${RISK}`,
  faq: [
    ["Can AI trade memecoins for me?", `BLIX's AI rates, researches and picks; it does not place trades. You buy in one click when you agree, and BLIX runs your exits. We keep the decision with the person who has the information on screen.`],
    ["Which AI does BLIX use?", `Grok 4.7 writes the deep reads and narratives, with live X search, and a faster Grok model handles quick reads. Through the MCP connector that comes with your account, any model (Claude, GPT, Gemini, DeepSeek) can read the same data.`],
    ["How accurate are the AI calls?", `BLIX publishes the record instead of a claim: every pick and signal is re-priced at 15 minutes, 1 hour, 6 hours and 24 hours, and the track record shows the share up 20%+, down 50%+ and the median, per type. Read it before you trust any call, including ours.`],
    ["Is AI memecoin trading free on BLIX?", `Yes. The AI reads are part of the terminal; real trades pay 2% (1.6% with an invite), paper trades nothing.`],
    ["Does the AI work on pump.fun coins?", `Yes, from the first trade: the rules score is instant, the deep read follows for the strongest coins, and both are on the coin's row and page.`],
  ],
});

// ---------- /ai-trading-bot ----------
const bot = page({
  path: "/ai-trading-bot", crumb: "AI trading bot",
  title: "AI Trading Bot for Solana Memecoins: What Works (2026) | BLIX",
  description: "AI trading bots for Solana and pump.fun: what they do, why most lose, and BLIX's approach: an AI that reads every coin and runs your exits while you make the buy.",
  h1: "AI trading bot for Solana memecoins",
  lede: `An "AI trading bot" for memecoins usually means one of two things: a sniper or copy bot with the word AI on the box, or a model that decides trades on its own. The first loses because it buys before anything is known; the second loses because a model cannot know which coin the crowd will pick next. BLIX is built on what a model is actually good at: reading every coin, grading the setup, finding the story, keeping score. You make the buy in one click; BLIX runs the take profit, stop loss and trailing stop. If you want to build your own bot, the API and MCP connector come with your account.`,
  body: `${START()}
${facts([FACT.ai, ["Exits", "Take profit, stop loss, trailing stop, partial sells, run for you"], FACT.fee, ["Build your own", `API and ${N_TOOLS}-tool MCP connector with your account`], FACT.safety, FACT.paper])}
<h2 id="kinds">Kinds of AI trading bot</h2>
${table(["Bot", "What it does", "Why it loses"], [
    ["Sniper with an AI filter", "Buys launches in the first blocks that pass a model's filter", "The model has nothing to read in block one; it filters names"],
    ["Autonomous trader", "A model decides buys and sells from data", "Memecoins are driven by attention, which no model forecasts; the costs compound"],
    ["Copy bot", "Mirrors wallets it rates as smart", "Late by design; the wallet's edge is in its timing, not its list"],
    ["Signal bot", "Posts a model's calls to Telegram", "No record, no exits, no holders; the call arrives without the context"],
    ["Terminal with AI (BLIX)", "Reads every coin, grades it, picks daily, runs your exits", "You make the buy, so the judgment and the information sit in the same place"],
  ])}
${HOW_AI}
<h2 id="exits">The bot part BLIX does run: your exits</h2>
<p>Every position carries a take profit multiple, a stop loss, a trailing stop and partial sells, run on the server while you are away, in paper and live mode alike. The AI's exit plan in the deep read is a suggestion you can apply in one click.</p>
${F.picks()}
${F.signals("Signals with a record")}
<h2 id="build">Build your own AI trading bot</h2>
<p>Your BLIX account includes the API and the MCP connector: every launch, trade, holder ledger, candle, quote and AI read as JSON and a live stream, and ${N_TOOLS} tools so a model can read the market directly. The API does not sign transactions; real trades are made in the terminal. <a href="/how-to-build-a-solana-trading-bot">How to build a Solana trading bot</a> walks through it, and the <a href="/ai-trading-agent">AI trading agent page</a> covers the agent route.</p>
${AI_MORE}
${RISK}`,
  faq: [
    ["Is there an AI trading bot that works for memecoins?", `Not one that trades on its own and wins over time, in our experience. What works is a model that reads every coin and a person who decides, with automatic exits. That is what BLIX is.`],
    ["Does BLIX trade automatically?", `It runs your exits automatically (take profit, stop loss, trailing stop). It does not buy for you.`],
    ["Can I run the AI picks as a bot?", `With your account the picks and every signal are on the API and the live stream, so your own code can read them and paper-trade them. Check the track record first; the picks page shows exactly how they have done.`],
    ["What does it cost?", `The account is free; real trades pay 2% (1.6% with an invite). The AI reads, the API and the MCP connector are included.`],
  ],
});

// ---------- /ai-trading-agent ----------
const agent = page({
  path: "/ai-trading-agent", crumb: "AI trading agent", og: "og-mcp.png",
  title: "AI Trading Agent for Solana: Give Your Agent Live Memecoin Data | BLIX",
  description: "Build an autonomous crypto trading agent on Solana: the BLIX MCP connector gives Claude, Codex or Gemini live pump.fun data, quotes, AI reads and a paper desk.",
  h1: "AI trading agent for Solana memecoins",
  lede: `An AI trading agent needs two things: live market data it can call as tools, and a safe place to act. Your BLIX account gives it both. The <a href="/mcp">MCP connector</a> exposes ${N_TOOLS} tools (the Pulse, every coin, holders, candles, real Jupiter quotes, the AI reads, picks, narratives, wallets, the track record) and your paper desk filled at real quotes, so an agent in Claude Code, Codex, Gemini CLI, Cursor or your own loop can research, decide and paper-trade on its own. It cannot touch real money: there is no wallet in the connector. Real trading stays in the terminal, by you.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">The ${N_TOOLS} tools</a>`)}
${facts([["Tools", `${N_TOOLS}, over stdio, with your account`], ["Reads", "Pulse, coins, holders, candles, quotes, research, picks, narratives, wallets, record"], ["Acts", "Your paper desk at real quotes: buy, sell, rules"], ["Clients", "Claude Code, Claude Desktop, Codex, Gemini CLI, Cursor, VS Code, your own loop"], ["Real money", "Never through the agent"], FACT.community])}
${SIGNIN_DEV}
<h2 id="loop">An agent loop that works</h2>
${steps([
    "<b>Observe:</b> <code>blix_pulse</code> for the final stretch and migrated coins, <code>blix_narratives</code> for what is running.",
    "<b>Screen:</b> <code>blix_holders</code> on each candidate: skip bundles over 20%, a dev holding big, snipers in the first blocks.",
    "<b>Read:</b> <code>blix_research</code> for the deep read's grade, thesis and plan; <code>blix_coin</code> for safety and socials.",
    "<b>Price:</b> <code>blix_quote</code> for the real amount out and price impact at your size.",
    "<b>Act (paper):</b> <code>blix_paper_buy</code> with a take profit and a stop; <code>blix_paper_sell</code> to exit; <code>blix_paper_desk</code> to review.",
    "<b>Learn:</b> <code>blix_track_record</code> and <code>blix_picks</code> to see what has worked, and change the rules.",
  ])}
<h2 id="setup">Connect an agent</h2>
${MCP_SETUP.download}
<h3>Claude Code</h3>${MCP_SETUP.claudeCode}
<h3>Claude Desktop, Cursor, Windsurf</h3>${MCP_SETUP.json}
<h3>Codex</h3>${MCP_SETUP.codex}
<h3>Gemini CLI</h3>${MCP_SETUP.gemini}
<p>Then: "Every five minutes, list the final-stretch coins with over 50 holders and no bundles, read the strongest, and paper-buy 0.25 SOL of any graded B or better with a 2x take profit and a 40% stop. Report what you did."</p>
<h2 id="own">Your own loop, without MCP</h2>
<p>The same data is plain HTTPS at <code>blixvip.com/api</code> with your session. A Python or JavaScript agent can poll <code>/api/pulse</code>, read <code>/api/research/&lt;mint&gt;</code> and post to <code>/api/paper/quoted</code>; the <a href="/pump-fun-api-python">Python</a> and <a href="/pump-fun-api-javascript">JavaScript</a> pages have the client code.</p>
<h2 id="safety">Why the agent cannot spend real money</h2>
<p>The connector and the API have no wallet, no private key and no signing. The only writes are your paper desk. Real trades are made by you, in the terminal, in one click. We think that is the right boundary for an autonomous agent on memecoins.</p>
${HOW_AI}
${COMMUNITY}
${AI_MORE}
${NOT_AFFILIATED("Anthropic, OpenAI, Google or any model vendor")}`,
  faq: [
    ["Can an AI agent trade crypto autonomously with BLIX?", `It can research and paper-trade autonomously through the MCP connector, with real quotes and the AI reads. Real money is not reachable from the agent by design.`],
    ["Which agents work with it?", `Any MCP client that can start a local stdio server: Claude Code, Claude Desktop, Codex, Gemini CLI, Cursor, VS Code, Windsurf, Zed, and agent frameworks that speak MCP. Or any code that can call HTTPS.`],
    ["Does the agent need an API key?", `No separate key. Your account's session, shown on the Developers page, authorizes the connector. The agent's own model has whatever key or login it uses.`],
    ["Is this a Solana AI agent for other tokens too?", `Yes. Discover, coins and quotes cover every Solana token Jupiter routes, not only pump.fun.`],
  ],
});

// ---------- /ai-memecoin-picks ----------
const picks = page({
  path: "/ai-memecoin-picks", crumb: "AI meme coin picks",
  title: "AI Meme Coin Picks Today: Solana & pump.fun, With Reasons | BLIX",
  description: "AI meme coin picks for Solana and pump.fun, updated through the day: buy, watch or avoid with the reason, this week's buy calls, and how every past pick did.",
  h1: "AI meme coin picks, with the reasons and the record",
  lede: `BLIX's AI picks page is a short list, not a firehose: the coins the deep reads graded a buy or a watch today, each with the one-line reason, the week's buy calls, and a scorecard of how past picks did by stage, by call and by reason. The reads are written by Grok 4.7 with live X search over Blix's own holder, chart and safety data. You decide; one click buys with real SOL or paper.`,
  body: `${START("See today's picks")}
${facts([["Today", "Buy, watch and avoid calls with the reason"], ["This week", "Every buy call, with its result so far"], ["Record", "By stage, by call, by reason, by day"], ["Model", "Grok 4.7 with live X search"], ["Coins", "Solana: pump.fun first, every pool Jupiter routes"], FACT.price])}
<h2 id="pick">What makes a pick</h2>
<p>A coin becomes a pick when its live rating, the AI's call and a clean entry line up: the deep read graded it a buy (or a strong watch) with enough conviction, the rug check passed, and the price offered an entry that was not already running away. Picks wait for that entry for a set time and are dropped if the coin falls too far first. Each pick then carries one exit rule (a take profit and a trailing stop) so it can be scored the same way every time.</p>
${HOW_AI}
<h2 id="record">The record is the product</h2>
<p>Every pick is paper-traded by its exit rule and scored: by stage (new pair, final stretch, migrated), by the AI's call, by the reason it gave, and by day, with the running result. The buys that lost are on the page next to the ones that won, and the AI reviews that scorecard to rewrite its own playbook. If a reason stops working, it shows.</p>
${F.rating("The rating on every other coin")}
${F.narratives("Picks come with the story")}
${F.trade("From pick to trade in one click")}
${links("More AI pick pages", [
    ["/grok-meme-coin-picks", "Grok meme coin picks", "The model behind the picks."],
    ["/claude-crypto-analysis", "Claude crypto analysis", "Claude on your own Blix, and through MCP."],
    ["/chatgpt-meme-coin-analysis", "ChatGPT meme coin analysis", "How to give ChatGPT live Solana data."],
    ["/trending-meme-coins", "Trending meme coins", "The lists the picks are drawn from."],
    ["/meme-coin-finder", "Meme coin finder", "Find coins early, before the pick."],
  ])}
${RISK}`,
  faq: [
    ["Are the AI picks free?", `Yes. Sign in with Google and the picks page is in the terminal with the rest.`],
    ["How good are the picks?", `The page shows it: every pick's result by stage, call and reason, including the losers. Read the record before acting on any pick, and size every trade for a coin that can go to zero.`],
    ["Which AI makes the picks?", `The deep reads are written by Grok 4.7 with live X search; a rules score and a fast model gate what gets a deep read; the picks rule combines the rating, the call and a clean entry.`],
    ["Does BLIX buy the picks for me?", `No. The picks are paper-traded for scoring. You buy in one click if you agree, and BLIX runs your exits.`],
    ["Are there pump.fun picks specifically?", `Yes: picks are grouped by stage, and new pairs and final stretch are pump.fun stages. Most picks are pump.fun or PumpSwap coins.`],
  ],
});

// ---------- model pages ----------
const grok = page({
  path: "/grok-meme-coin-picks", crumb: "Grok meme coin picks",
  title: "Grok Meme Coin Picks & Crypto Analysis: Live X Search on Solana | BLIX",
  description: "7 reads X live, grades every strong coin, writes the daily narratives and makes picks that are scored after the fact. Free.",
  h1: "Grok meme coin picks and crypto analysis",
  lede: `Grok is the model behind Blix AI, and for a reason: memecoins are born on X, and Grok searches X live while it reads a coin. On BLIX, Grok 4.7 writes the deep reads (grade, thesis, catalysts, risks, call, plan), the daily narratives desk, and the picks; a faster Grok model handles the first read of every launch. Everything it says is scored afterwards and shown with the losses.`,
  body: `${START("See Grok's picks")}
${facts([["Deep reads", "Grok 4.7 with up to ten live X and web searches per coin"], ["Quick reads", "grok-4-fast on every launch within seconds"], ["Narratives", "The day's stories researched on X and written up"], ["Picks", "Scored after the fact, by stage, call and reason"], ["Your own AI", "Any MCP client on the same data, with your account"], FACT.price])}
<h2 id="why">Why Grok for memecoins</h2>
<p>A memecoin's story lives on X: the post that started it, the account behind it, whether the same ticker launched ten times this hour, whether anyone outside the launch group is talking about it. Grok can search X as it reads, so its read on a coin includes what is being said right now, not what was indexed last month. Blix feeds it the on-chain side: the holder ledger with dev, snipers and bundles, the chart, the safety report, the narrative the coin belongs to.</p>
${HOW_AI}
<h2 id="narratives">Grok writes the narratives desk</h2>
<p>Each day Grok researches the narratives running and the day's runners on X and the web, and writes each up: what the thing is, what happened, how it is trading, the coins and their roles, the case for and against, what to watch. Blix's own live numbers sit beside the text and update as the coins trade.</p>
<h2 id="own">Your own AI on the same data</h2>
<p>Every BLIX account includes the <a href="/mcp">MCP connector</a>: Claude, Codex, Gemini CLI or any MCP client reads the same Pulse, holders, charts and quotes as tools, and can read Grok's own research on each coin through <code>blix_research</code> and the picks record through <code>blix_picks</code>. Your Developers page has the command.</p>
${F.picks()}
${F.trade("From Grok's call to your trade")}
${AI_MORE}
${NOT_AFFILIATED("xAI or Grok")}${RISK}`,
  faq: [
    ["Does Grok pick meme coins?", `On BLIX, yes: Grok 4.7 writes the deep reads whose buy calls become picks, with the reasons. Every pick is scored afterwards and the record is public in the app.`],
    ["Can Grok analyze a coin I choose?", `Yes. Open any coin in BLIX and ask for a research read; the result is the full write-up with grade, thesis, risks and plan.`],
    ["Is there a Grok trading bot?", `Not one that trades by itself. Grok reads and calls; you buy in one click; BLIX runs the exits.`],
    ["Which Grok models does BLIX use?", `grok-4.7 for deep reads and the narratives desk, grok-4-fast for quick reads and triage.`],
  ],
});

const claude = page({
  path: "/claude-crypto-analysis", crumb: "Claude crypto analysis", og: "og-mcp.png",
  title: "Claude Meme Coin Analysis & Picks: Live Solana Data via MCP | BLIX",
  description: "Use Claude for Solana meme coin analysis: give Claude Code and Claude Desktop live pump.fun data, holders, quotes and BLIX's AI reads through the MCP connector.",
  h1: "Claude meme coin analysis and picks",
  lede: `Claude is the best tool user of the big models, which makes it a natural fit for the <a href="/mcp">BLIX MCP connector</a>: connect Claude Code or Claude Desktop and ask it directly what is running on pump.fun, who holds a coin, what BLIX's AI thinks, quote a buy, paper-trade a call. It reads live data instead of guessing, and it cannot touch real money. The connector comes with your BLIX account.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">BLIX MCP for Claude</a>`)}
${facts([["Through MCP", `${N_TOOLS} tools in Claude Code and Claude Desktop`], ["Data", "Pulse, holders, candles, quotes, safety, BLIX's AI reads, picks, narratives, wallets"], ["Access", "Your BLIX account's session; your own Claude login"], ["Trading", "Your paper desk through MCP; real trading in the terminal"], ["BLIX's own reads", "Written by Grok with live X search"], FACT.community])}
${SIGNIN_DEV}
<h2 id="mcp">Claude through MCP</h2>
${MCP_SETUP.download}
${MCP_SETUP.claudeCode}
<p>or in <code>claude_desktop_config.json</code>:</p>
${MCP_SETUP.json}
<p>Then ask: "What launched on pump.fun in the last five minutes with more than 30 traders and no bundles? Read the strongest one and tell me if the dev is still holding." Claude calls <code>blix_pulse</code>, <code>blix_holders</code> and <code>blix_research</code> and answers from live data.</p>
<h2 id="what">What Claude does well with it</h2>
${bullets([
    "<b>Structured reads:</b> holders, bundles, dev history and liquidity folded into a clear verdict with the reasons.",
    "<b>Multi-step work:</b> screen the final stretch, read the top three, quote each, paper-buy the best, report. Claude follows the plan.",
    "<b>Comparisons:</b> two coins in the same narrative, side by side, from the same live data.",
    "<b>Agents:</b> a loop in Claude Code that observes, screens, reads and paper-trades every few minutes (see <a href=\"/ai-trading-agent\">AI trading agent</a>).",
  ])}
<h2 id="vs-grok">Claude or Grok for memecoins?</h2>
<p>Grok searches X live, which matters for coins born on X; Claude is a stronger reader of structured data and a better tool user, which matters for an agent working through MCP. BLIX's own reads, picks and narratives are written by Grok; Claude reads the same data, and Grok's reads, through the connector. The <a href="/best-ai-for-crypto-trading">comparison page</a> goes through it.</p>
${HOW_AI}
${COMMUNITY}
${AI_MORE}
${NOT_AFFILIATED("Anthropic or Claude")}${RISK}`,
  faq: [
    ["Can Claude pick meme coins?", `Through the connector Claude can read the market, BLIX's AI picks and their record, and give you its own calls over live data. BLIX's scored picks are written by Grok.`],
    ["Does Claude have live X search?", `No. Claude searches the web; Grok searches X. For coins born on X that difference shows, which is why BLIX's reads use Grok.`],
    ["Is there a Claude trading bot?", `Claude can paper-trade through the MCP tools with real quotes; it cannot reach real money. Real trading is in the terminal, by you.`],
    ["What does it cost?", `The connector comes with your free BLIX account and calls no paid service; Claude is your own plan.`],
  ],
});

const chatgpt = page({
  path: "/chatgpt-meme-coin-analysis", crumb: "ChatGPT meme coin analysis", og: "og-mcp.png",
  title: "ChatGPT Meme Coin Analysis: Connect Solana Data to GPT (2026) | BLIX",
  description: "Analyze Solana meme coins with ChatGPT: give Codex CLI live pump.fun data through the BLIX MCP connector, bridge it to ChatGPT's connectors, or paste BLIX's JSON.",
  h1: "ChatGPT meme coin analysis and picks",
  lede: `ChatGPT knows a lot about crypto and nothing about the coin that launched four minutes ago. To make it useful on Solana memecoins it needs live data: who holds the coin, whether the dev sold, what the chart did in the last hour. Your BLIX account provides that as an API and an MCP connector. OpenAI's Codex CLI can use the connector as is; ChatGPT's web app only takes remote (HTTPS) connectors, so it needs a bridge; and any ChatGPT can read BLIX's JSON if you paste it. This page covers all three, honestly.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">BLIX MCP connector</a>`)}
${facts([["Codex CLI", "Works with the local connector as is"], ["ChatGPT web", "Remote HTTPS connectors only (Developer Mode); a bridge is needed"], ["Any ChatGPT", "Paste the JSON from a BLIX endpoint"], ["Data", "Pulse, holders, candles, quotes, AI reads, narratives"], ["Access", "Your BLIX account; your own OpenAI plan"], ["Trading", "Your paper desk through MCP only"]])}
${SIGNIN_DEV}
<h2 id="codex">1. Codex CLI with the BLIX connector</h2>
${MCP_SETUP.download}
${MCP_SETUP.codex}
<p>Then in Codex: "List the final-stretch pump.fun coins with over 50 holders, check each for bundles and a dev that sold, and tell me which one you would watch and why." Codex calls <code>blix_pulse</code> and <code>blix_holders</code> and reasons over live data.</p>
<h2 id="connector">2. ChatGPT custom connectors</h2>
<p>ChatGPT's Developer Mode connects to remote MCP servers over HTTPS; plan eligibility has changed through 2026, so check OpenAI's help centre for yours. A local stdio connector is not reachable directly. To expose it, run a stdio-to-HTTP bridge (for example <code>supergateway</code>) in front of <code>node blix-mcp.mjs</code> on a machine you control, put it behind HTTPS with authentication, and add that URL as a connector. Treat it as read-only data: the only writes are your paper desk.</p>
<h2 id="paste">3. Paste the data</h2>
<p>No setup at all: fetch a coin's data with your session, paste it into ChatGPT with your question.</p>
${code(`curl -s "${BASE}/api/holders/<mint>?top=15" -H "cookie: blix_wait=$BLIX_SESSION"
curl -s ${BASE}/api/token/<mint> -H "cookie: blix_wait=$BLIX_SESSION"
# paste both into ChatGPT: "Is this coin's holder distribution healthy? What are the red flags?"`, "bash")}
<h2 id="limits">What ChatGPT cannot do here</h2>
<p>It cannot see X live (Grok can), it cannot know a coin's holders without data, and it cannot trade: the connector has no wallet, and the terminal is where you trade with real SOL. For a picks feed with a record, use <a href="/ai-memecoin-picks">BLIX AI's picks</a>, which are written by Grok with live X search and scored after the fact.</p>
${COMMUNITY}
${AI_MORE}
${NOT_AFFILIATED("OpenAI, ChatGPT or Codex")}${RISK}`,
  faq: [
    ["Can ChatGPT pick meme coins?", `It can reason about coins when it has live data; it does not have that data on its own. Your BLIX account supplies it through Codex's MCP support, a remote connector bridge, or pasted JSON. BLIX's own picks are written by Grok and scored publicly.`],
    ["How do I connect Solana to ChatGPT?", `The simplest working route is Codex CLI with the BLIX MCP connector. For the ChatGPT web app, expose the connector over HTTPS with a bridge and add it as a custom connector under Developer Mode, if your plan allows it.`],
    ["Is there a ChatGPT crypto trading bot?", `Not one we recommend. A model with a wallet and no edge loses faster. ChatGPT can paper-trade through the connector with real quotes; real money stays with you.`],
    ["Does ChatGPT work with the BLIX connector directly?", `Codex does. ChatGPT's web connectors require a remote HTTPS server, so a bridge is needed.`],
  ],
});

const gemini = page({
  path: "/gemini-crypto-picks", crumb: "Gemini crypto picks", og: "og-mcp.png",
  title: "Gemini Meme Coin Picks & Crypto Analysis with Gemini CLI | BLIX",
  description: "Use Google Gemini on Solana meme coins: connect Gemini CLI to the BLIX MCP connector for live pump.fun data, holders, quotes and AI reads. One settings file.",
  h1: "Gemini meme coin picks and crypto analysis",
  lede: `Gemini CLI speaks MCP, so it can read Solana memecoins live through the <a href="/mcp">BLIX MCP connector</a>: what is launching, who holds a coin, the chart, a real quote, BLIX AI's read, the narratives. One entry in <code>~/.gemini/settings.json</code> and Gemini can research, compare and paper-trade coins in your terminal. The connector comes with your BLIX account; Gemini is whatever plan you use.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">BLIX MCP connector</a>`)}
${facts([["Client", "Gemini CLI (stdio MCP)"], ["Setup", "mcpServers in ~/.gemini/settings.json"], ["Tools", `${N_TOOLS}: pulse, coins, holders, candles, quote, research, picks, narratives, wallets, paper desk`], ["Access", "Your BLIX account's session"], ["Trading", "Your paper desk only through MCP"], FACT.community])}
${SIGNIN_DEV}
<h2 id="setup">Setup</h2>
${MCP_SETUP.download}
<p>Then add to <code>~/.gemini/settings.json</code>:</p>
${MCP_SETUP.gemini}
<p>Start <code>gemini</code> and run <code>/mcp</code> to confirm the <code>blix</code> server and its tools are listed.</p>
<h2 id="ask">Ask Gemini</h2>
${bullets([
    `"Which pump.fun coins are in the final stretch with the most holders? Check each for bundles."`,
    `"Compare the top three narratives running right now and the lead coin of each."`,
    `"Read &lt;mint&gt;: holders, safety, the AI's grade, and quote a 0.3 SOL buy."`,
    `"Paper-buy the best of them with a 2x take profit and a 35% stop, then show the desk."`,
  ])}
<h2 id="vs">Gemini, Grok or Claude for memecoins</h2>
<p>Gemini has a large context and Google search; Grok searches X live; Claude is the strongest tool user. For an agent reading BLIX through MCP any of them works, and the data matters more than the model: holders, bundles and the dev's history are facts, and the model's job is to weigh them. BLIX's own picks use Grok; see the <a href="/best-ai-for-crypto-trading">comparison</a>.</p>
${COMMUNITY}
${AI_MORE}
${NOT_AFFILIATED("Google or Gemini")}${RISK}`,
  faq: [
    ["Does Gemini work with the BLIX MCP connector?", `Yes, through Gemini CLI's stdio MCP support. Add the connector to settings.json with your session and its tools appear under /mcp.`],
    ["Can Gemini pick meme coins?", `It can read the market through the tools and give you its calls, and it can read BLIX AI's picks and record. It does not have a scored record of its own on BLIX.`],
    ["Can Gemini trade?", `Paper only, through your paper desk at real quotes. There is no wallet in the connector.`],
  ],
});

const deepseek = page({
  path: "/deepseek-meme-coin-picks", crumb: "DeepSeek meme coin picks", og: "og-mcp.png",
  title: "DeepSeek, Kimi & Qwen Meme Coin Picks on Live Solana Data | BLIX",
  description: "Use DeepSeek, Kimi, Qwen or a local model on Solana meme coins: any MCP client can give them live pump.fun data from the BLIX MCP connector. Ollama works too.",
  h1: "DeepSeek, Kimi and Qwen meme coin picks",
  lede: `DeepSeek, Kimi and Qwen have no apps that read Solana, but they run inside MCP clients that do. Pick a client that supports MCP and lets you choose the model (Cline, Roo Code, Continue, Cursor, Zed, or any OpenAI-compatible agent loop), point it at DeepSeek's API, Moonshot's Kimi, Qwen, or a local model on Ollama, and add the <a href="/mcp">BLIX MCP connector</a> from your account. The model then has every pump.fun launch, holder ledger, chart, quote and BLIX AI read as tools, for the price of the model's tokens, or free on your own GPU.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">BLIX MCP connector</a>`)}
${facts([["Models", "DeepSeek V3 / R1, Kimi K2, Qwen3, Llama, or any local model with tool calling"], ["Clients", "Cline, Roo Code, Continue, Cursor, Zed, OpenAI-compatible agent loops"], ["Local", "Ollama + an MCP-capable client = no model cost at all"], ["Data", `${N_TOOLS} BLIX tools, with your account`], ["Trading", "Your paper desk only through MCP"], FACT.community])}
${SIGNIN_DEV}
<h2 id="setup">Setup</h2>
${steps([
    "Create your BLIX account and download the connector from Developers.",
    "In your client, set the model: DeepSeek (api.deepseek.com), Kimi (Moonshot's API), Qwen (DashScope or local), or Ollama for a local model that supports tool calls.",
    "Add the connector with the JSON most clients share, your session in <code>BLIX_SESSION</code>:",
  ])}
${MCP_SETUP.json}
<p>Cline, Roo Code and Cursor read this shape (<code>cline_mcp_settings.json</code>, <code>~/.cursor/mcp.json</code>); Continue and Zed have equivalent fields for command, args and env. Then ask the model what is running on pump.fun and let it call the tools.</p>
<h2 id="which">Which open model for memecoins</h2>
${table(["Model", "Good at", "Watch for"], [
    ["DeepSeek V3 / R1", "Cheap, strong reasoning over the holder and chart data", "Needs a client with reliable tool calling; R1 is slow for a 5-minute loop"],
    ["Kimi K2", "Long context, agentic tool use", "API access through Moonshot; check regional availability"],
    ["Qwen3", "Runs well locally, decent tool use at 14B+", "Smaller sizes miss tool arguments"],
    ["Local via Ollama", "No per-token cost, fully private", "Quality depends on the model size; use one with tool support"],
  ])}
<h2 id="honest">What these models cannot see</h2>
<p>None of them search X live, and none know a coin that launched a minute ago. The tools fix the second; the first is why BLIX's own picks are written by Grok. Use the open models for cheap, private analysis of the data BLIX gives them, and read <a href="/ai-memecoin-picks">the scored picks</a> for the X side.</p>
${COMMUNITY}
${AI_MORE}
${NOT_AFFILIATED("DeepSeek, Moonshot AI, Alibaba Cloud or Ollama")}${RISK}`,
  faq: [
    ["Can DeepSeek analyze meme coins?", `Yes, inside an MCP client with the BLIX connector: it gets live holders, charts, quotes and AI reads as tools and reasons over them. On its own it has no live crypto data.`],
    ["Can I run the model locally?", `Yes: Ollama with a tool-capable model and a local MCP client such as Cline or Continue, with the BLIX connector for the data.`],
    ["Which client is easiest?", `Cline or Roo Code in VS Code: pick a model provider, paste the MCP JSON, done. Cursor is similar if you already use it.`],
    ["Can the model trade?", `Paper only, through your paper desk at real quotes. No wallet is reachable from the model.`],
  ],
});

// ---------- /best-ai-for-crypto-trading ----------
const bestAi = page({
  path: "/best-ai-for-crypto-trading", crumb: "Best AI for crypto trading", eyebrow: `AI models compared · checked ${CHECKED}`,
  title: "Best AI for Crypto Trading: Grok vs Claude vs ChatGPT | BLIX",
  description: "Which AI is best for meme coin trading in 2026? Grok, Claude, ChatGPT, Gemini and DeepSeek compared on live X search, tool use, cost and reasoning.",
  h1: "Best AI for crypto and meme coin trading",
  lede: `Asked which AI is best for crypto trading, most answers compare chat quality. For memecoins the questions are different: can it see X live, can it call tools for on-chain data, how fast is it, what does a read cost, and does anyone keep its score? Here is how the models compare on those as of ${CHECKED}, what BLIX uses and why, and how to run any of them on live Solana data.`,
  body: `${START("Use Blix AI")}
${facts([["BLIX's reads", "Grok 4.7 deep reads with live X search; grok-4-fast quick reads"], ["Through MCP", "Claude, Codex (GPT), Gemini, DeepSeek, Kimi, Qwen, local models"], ["Scored", "Every call re-priced at 15m, 1h, 6h, 24h"], ["Access", "The MCP connector comes with your account"], FACT.price, FACT.community])}
<h2 id="table">The models, on what matters for memecoins</h2>
${table(["Model", "Live X search", "Tool use (MCP)", "Speed", "Cost per read", "Best for"], [
    ["Grok 4.7", "Yes, native", "Through xAI's API and the Grok CLI", "Fast; grok-4-fast is about 2 s", "Low to medium", "Coins born on X: the story, the account, the copies"],
    ["Claude Sonnet 5.5 / Opus 5.5", "No (web search yes)", "Best in class", "Medium", "Medium to high", "Agents through MCP; reading structured holder and chart data"],
    ["Claude Haiku", "No", "Good", "Seconds", "Very low", "Triage of every launch"],
    ["GPT (ChatGPT, Codex)", "No (web search yes)", "Codex: yes; ChatGPT web: remote connectors only", "Medium", "Medium", "Codex agents; general analysis"],
    ["Gemini", "No (Google search)", "Gemini CLI: yes", "Fast", "Low to medium", "Long context over many coins"],
    ["DeepSeek / Kimi / Qwen", "No", "Through an MCP client", "Varies", "Very low, or free locally", "Cheap private analysis at volume"],
  ])}
<h2 id="data">The data matters more than the model</h2>
<p>A model with no holder ledger will tell you a bundled rug "has a strong community." Every model in the table does well once it can see who holds the coin, whether the dev sold, what the chart did and what is being said. That is why Blix is built as a data engine first (every launch, every trade, holders from the first block, candles, quotes, safety) with the model on top, and why the same data is open to every model through the <a href="/mcp">MCP server</a>.</p>
<h2 id="blix">What BLIX uses, and why</h2>
<p>BLIX reads with Grok because memecoins start on X and Grok searches it live while it reads. A fast Grok model relabels every launch within seconds; Grok 4.7 writes the deep reads, the picks and the daily narratives. Every call is scored afterwards and the record is on the page. Your own model (Claude, GPT, Gemini, DeepSeek) reads the same data through the MCP connector that comes with your account.</p>
${HOW_AI}
<h2 id="honest">No model predicts memecoins</h2>
<p>The best AI for crypto trading is the one whose record you can read. A model's confidence is not a forecast; a memecoin runs because people buy it. Use the AI to read faster and skip the obvious rugs, keep score, and size every trade for zero.</p>
${AI_MORE}
${NOT_AFFILIATED("xAI, Anthropic, OpenAI, Google, DeepSeek, Moonshot AI or Alibaba Cloud")}${RISK}`,
  faq: [
    ["Which AI is best for meme coin trading?", `For coins born on X, Grok, because it searches X live; for agents working through tools, Claude. BLIX's reads use Grok. Any of them needs live on-chain data to be useful, which the MCP connector that comes with your account provides.`],
    ["Is ChatGPT good for crypto trading?", `It reasons well but has no live data and cannot see X. Through Codex and the Blix MCP server it gets live Solana data; see the <a href="/chatgpt-meme-coin-analysis">ChatGPT page</a>.`],
    ["Can I compare the models on the same coins?", `Yes: connect two MCP clients to your account and ask each the same question over the same live data; BLIX's own reads and their record are on the picks page beside them.`],
    ["Which AI does BLIX recommend?", `For the terminal's reads we chose Grok. For your own agent, use the model you already pay for; the data is the same.`],
  ],
});

// ---------- /best-crypto-ai-tools ----------
const tools = page({
  path: "/best-crypto-ai-tools", crumb: "Best crypto AI tools", eyebrow: `Crypto AI tools · checked ${CHECKED}`,
  title: "Best Crypto AI Tools for Solana Memecoins in 2026 | BLIX",
  description: "The crypto AI tools that help on Solana memecoins: AI coin ratings and picks, AI-written narratives, MCP servers for agents.",
  h1: "Best crypto AI tools for memecoin traders",
  lede: `"Crypto AI tools" covers everything from chatbots to sniper bots. For a memecoin trader the useful ones do four things: read coins faster than you can, explain what a coin is and why it is moving, flag the setups that rug, and let your own AI agent see the market. This page lists the kinds of tool worth having, with the tools every BLIX account includes.`,
  body: `${START("Try the AI tools")}
${facts([FACT.ai, ["Narratives", "AI-written daily desk from X and the web"], ["Agents", `MCP server with ${N_TOOLS} tools`], FACT.safety, ["Smart money", "Found from early buyers of runners"], FACT.price])}
<h2 id="list">The tools, by job</h2>
${table(["Job", "The tool", "In BLIX"], [
    ["Rate every coin", "A live rating from holders, liquidity, volume and risk", "On every row and page, free"],
    ["Explain a coin", "A deep read with a grade, thesis, catalysts, risks and a plan", "One click on any coin; Grok 4.7 with live X search"],
    ["Pick coins", "A daily short list with reasons and a public record", "AI early picks page"],
    ["Read the narratives", "What is running on X, written up with the coins", "Narratives Today desk"],
    ["Rug check", "Dev history, bundles, snipers, authorities, liquidity, linked wallets", "Safety tab and bubble map on every coin"],
    ["Find smart money", "Wallets that bought runners early, followed automatically", "Wallet tracker and signals"],
    ["Give your agent the market", "An MCP connector with live tools", `BLIX MCP, ${N_TOOLS} tools, with your account`],
    ["Build your own", "An API with every launch, trade, holder and quote", "BLIX API, with your account"],
  ])}
${HOW_AI}
<h2 id="other">Other AI crypto tools people use</h2>
<p>General chatbots (ChatGPT, Claude, Gemini) are good at explaining and bad at knowing the coin in front of you unless they have live data, which the <a href="/mcp">Blix MCP server</a> provides. Paid "AI signal" groups rarely publish a scored record; ask for one. Sniper bots with AI filters buy before there is anything to read. Token Metrics and similar research platforms cover large caps well and memecoins thinly.</p>
${F.rating()}
${F.narratives()}
${AI_MORE}
${RISK}`,
  faq: [
    ["What is the best AI tool for memecoins?", `One that reads every coin with live on-chain data and keeps a public score. BLIX does that free: a rating on every coin, deep reads, picks with a record, narratives and a rug check.`],
    ["Are crypto AI tools free?", `BLIX's are, with a free account: the AI reads, the API and the MCP connector are all included.`],
    ["Can I use my own AI with BLIX's data?", `Yes. The MCP server gives any MCP client the same data as tools, and the API serves it as JSON.`],
  ],
});

export const AI_PAGES = [trading, bot, agent, picks, grok, claude, chatgpt, gemini, deepseek, bestAi, tools];
