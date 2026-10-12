// Developer pages: developer access with a BLIX account (/developers), MCP for crypto and memecoins, how to use MCP
// for crypto, the Solana and memecoin APIs, wallet data, the "SDK" and "CLI" that are really plain HTTP, and the
// trading-bot guide. Every page says the same thing: the API and the MCP connector come with an account.
import { F, FACT, START, DEV_CTA, SIGNIN_DEV, DISCORD, DISCORD_LINK, COMMUNITY, CONNECTOR, NOT_AFFILIATED, RISK, CHECKED, BASE, N_ENDPOINTS, N_TOOLS, MCP_SETUP, code, table, facts, steps, bullets, callout, links, page, ext } from "./pagekit.js";

const DEV_MORE = links("More for developers", [
  ["/developers", "Developer access", "Your session and connector command, with your account."],
  ["/api", "BLIX API", `${N_ENDPOINTS} endpoints and a live stream.`],
  ["/trade-api", "BLIX trade API", "Quote, build, sign with your own wallet, send. 2% a trade."],
  ["/mcp", "BLIX MCP connector", `${N_TOOLS} tools for Claude, Cursor, Codex and more.`],
  ["/pump-fun-api", "pump.fun API", "Launches, trades, holders, candles."],
  ["/pump-fun-websocket", "pump.fun live stream", "Launches and trades as events, in any language."],
  ["/how-to-build-a-solana-trading-bot", "Build a Solana trading bot", "Data, signals, paper testing, execution."],
]);
const TOOL_TABLE = table(["Tool", "What it returns"], [
  ["<code>blix_overview</code>", "Launches per hour, coins tracked, signals in 24h, graduations, top movers, health"],
  ["<code>blix_pulse</code>", "New launches, final stretch, migrated and running coins with stats and the AI verdict"],
  ["<code>blix_signals</code> · <code>blix_coins</code> · <code>blix_coin</code>", "Latest signals; search or rank coins; everything on one coin"],
  ["<code>blix_holders</code> · <code>blix_candles</code> · <code>blix_quote</code>", "Holder ledger with dev, sniper and bundle tags; candles from real trades; a real Jupiter quote"],
  ["<code>blix_narratives</code> · <code>blix_briefs</code> · <code>blix_research</code> · <code>blix_picks</code>", "Themes and bursts; market briefs; the AI reads on a coin; the picks scorecard"],
  ["<code>blix_wallets</code> · <code>blix_wallet</code> · <code>blix_fomo</code>", "The smart-money ranking; any wallet from the chain; what Fomo traders are buying"],
  ["<code>blix_track_record</code> · <code>blix_health</code>", "How past signals did, per type; every dependency's state"],
  ["<code>blix_paper_desk</code> · <code>blix_paper_buy</code> · <code>blix_paper_sell</code>", "Your paper desk, filled at real quotes. Paper money only"],
]);
const AUTH_CURL = code(`# your session is on ${BASE}/developers once you are signed in
export BLIX_SESSION="<from your Developers page>"
curl -s ${BASE}/api/pulse -H "cookie: blix_wait=$BLIX_SESSION" | head -c 600`, "bash");
const SETUP_ALL = `<h3>Download the connector</h3>${MCP_SETUP.download}
<h3>Claude Code</h3>${MCP_SETUP.claudeCode}
<h3>Claude Desktop, Cursor, Windsurf, Cline (JSON)</h3>${MCP_SETUP.json}
<h3>Codex</h3>${MCP_SETUP.codex}
<h3>Gemini CLI (~/.gemini/settings.json)</h3>${MCP_SETUP.gemini}
<h3>VS Code (.vscode/mcp.json)</h3>${MCP_SETUP.vscode}`;

// ---------- /developers ----------
// The static page (search engines and signed-out visitors). index.js serves a signed-in member the same page with
// their session and the ready-made commands at the top (developerAccess in index.js).
const developers = page({
  path: "/developers", crumb: "Developers", og: "og-api.png", eyebrow: `Developer access · with your account`,
  title: "Developer Access: BLIX API & MCP Connector With Your Account | BLIX",
  description: "Every BLIX account includes developer access: the terminal's data as JSON over the API and a live stream, and the MCP connector for Claude, Cursor.",
  h1: "Developer access comes with your account",
  lede: `Sign in to BLIX and this page shows your API session and the exact commands to connect: <code>curl</code> for the <a href="/api">${N_ENDPOINTS}-endpoint API</a> and the live stream, and the one-file <a href="/mcp">MCP connector</a> that gives Claude, Cursor, Codex, Gemini CLI or any MCP client ${N_TOOLS} tools on the same data. No separate key, no plan to pick: it is part of a BLIX account.`,
  body: `${START("Create your account", DISCORD_LINK())}
${facts([["Included", "API, live stream, MCP connector, trade API"], ["Authorization", "Your signed-in session for data; an API key for trades"], ["Limits", "Fair use per account; quotes and paper writes are paced"], ["Writes", `Your own paper desk with the session; real trades with your own wallet through the <a href="/trade-api">trade API</a>`], ["Clients", "curl, Python, JavaScript, Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, VS Code"], FACT.community])}
<h2 id="get">How to get in</h2>
${steps([
    "Create a BLIX account (sign in with Google) and come back to this page: your session appears at the top with the commands filled in.",
    "For the API, send the session as the <code>blix_wait</code> cookie on every request. From the browser on blixvip.com it is already there.",
    `For AI clients, download the connector (<code>${CONNECTOR}</code>), set <code>BLIX_SESSION</code> and add it to your client; the commands are on this page once you are signed in.`,
    `Ask in the <a href="${DISCORD}" rel="noopener">Discord</a> if anything does not answer.`,
  ])}
<h2 id="api">The API, in one call</h2>
${AUTH_CURL}
<p>Every endpoint is listed on the <a href="/api">API page</a>; the live stream is <code>GET /api/stream</code> (Server-Sent Events: launches, live prices, migrations, signals).</p>
<h2 id="mcp">The MCP connector</h2>
${SETUP_ALL}
<h2 id="limits">What developer access is, and is not</h2>
${bullets([
    "<b>Is:</b> every market, coin, holder, candle, quote, signal, narrative, research and picks endpoint; your own paper desk; the live stream.",
    "<b>Real money:</b> through the <a href=\"/trade-api\">trade API</a> only, with an API key and your own wallet: Blix builds the transaction, you sign it, Blix sends it. The session itself never moves funds; its only write is the paper desk.",
    "<b>Limits:</b> fair use per account. Quotes and paper writes are paced; a session expires and this page issues a fresh one.",
  ])}
${COMMUNITY}
${DEV_MORE}`,
  faq: [
    ["Do I need an API key?", `No. Your BLIX session is the authorization. Sign in and this page shows it.`],
    ["Is developer access free?", `Yes, with every account.`],
    ["Can I trade with real money through the API?", `Yes, through the <a href="/trade-api">trade API</a> with an API key: quote and build pump.fun or PumpSwap trades for your own wallet, sign them with your own key, send them through Blix. 2% a trade, 1.6% with an invite. The session-authorized API and the paper desk never move funds.`],
    ["Which AI clients work with the connector?", `Any client that can start a local stdio MCP server: Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, VS Code, Windsurf, Zed, Cline, Roo Code and others.`],
  ],
});

// ---------- /crypto-mcp-server ----------
const cryptoMcp = page({
  path: "/crypto-mcp-server", crumb: "Crypto MCP servers", og: "og-mcp.png", eyebrow: `Crypto MCP · checked ${CHECKED}`,
  title: "Crypto MCP Servers for Trading & Data Agents (2026) | BLIX",
  description: "The crypto MCP servers worth knowing in 2026: what the BLIX MCP connector gives an agent (live Solana memecoin data, quotes, AI reads, a paper desk.",
  h1: "Crypto MCP servers for trading and data",
  lede: `MCP (the Model Context Protocol) is how an AI client calls tools, and a crypto MCP server is the set of tools that gives the model live market data. The BLIX MCP connector is one for Solana memecoins: ${N_TOOLS} tools covering every pump.fun launch, holders with snipers and bundles, candles, real Jupiter quotes, the AI's reads and picks, narratives, wallets, the track record and a paper desk. It comes with a BLIX account. Here is what it does, how it compares with the other crypto MCP servers, and what to look for before you give any of them to an agent.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">BLIX MCP</a>`)}
${facts([["BLIX MCP", `${N_TOOLS} tools, one file, no dependencies`], ["Data", "Solana memecoins: pump.fun, PumpSwap, LaunchLab, every pool Jupiter routes"], ["Access", "Your BLIX account's session"], ["Writes", "Paper desk only; no wallet in the connector"], ["Clients", "Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI, VS Code, Windsurf, Zed"], FACT.community])}
<h2 id="servers">Crypto MCP servers compared</h2>
${table(["Server", "Covers", "Access", "Trading"], [
    ["BLIX MCP", "Solana memecoins live: launches, holders, candles, quotes, AI reads, picks, narratives, wallets, record", "A BLIX account", "Paper desk at real quotes; no signing"],
    ["CoinGecko MCP", "Prices, market caps and metadata for listed coins across chains", "Keyless public endpoint; a key for higher limits", "No"],
    ["GMGN agent skills", "GMGN token, market, wallet and trending data", "GMGN API key by application", "Yes, with your private key and an IP whitelist"],
    ["Community pump.fun MCP servers", "Usually token lookups and bonding-curve reads", "Varies", "Some take a private key you supply"],
    ["Exchange MCP servers (CEX)", "Spot and futures on one exchange", "Exchange API key", "Yes, with your exchange key"],
  ], "cmp")}
<h2 id="check">What to check before you trust a crypto MCP server</h2>
${bullets([
    "<b>Does it ask for a private key?</b> If yes, an agent can spend it. BLIX never takes one; its only writes are paper.",
    "<b>Where does the data come from?</b> BLIX decodes the chain itself and quotes Jupiter; a server that scrapes a website breaks when the website changes.",
    "<b>Is the tool list stable?</b> BLIX's tool list is the same one its MCP page shows, so the docs cannot drift from the connector.",
    "<b>What does it cost per call?</b> BLIX: nothing beyond your account. Hosted servers meter by call or by plan.",
  ])}
<h2 id="tools">The BLIX tools</h2>
${TOOL_TABLE}
<h2 id="setup">Add it to a client</h2>
${SIGNIN_DEV}
${SETUP_ALL}
${COMMUNITY}
${DEV_MORE}
${NOT_AFFILIATED("CoinGecko, GMGN or any exchange")}`,
  faq: [
    ["What is the best crypto MCP server?", `For live Solana memecoin data with no private key in the loop, BLIX's, with your account. For broad price coverage across chains, CoinGecko's. For GMGN's own data and execution, GMGN's skills with a GMGN key. Most agents want data more than execution; keep keys out of the model's reach.`],
    ["Is there a trading MCP server?", `Several, usually by holding your exchange or wallet key. BLIX's position is that an agent should paper-trade at real quotes and a person should execute; its connector has a paper desk and no key.`],
    ["Does it work with Cursor?", `Yes, with the JSON above in <code>~/.cursor/mcp.json</code>.`],
    ["How do I get access?", `Create a BLIX account, open <a href="/developers">Developers</a>, copy your session and the connector command.`],
  ],
});

// ---------- /memecoin-mcp-server ----------
const memeMcp = page({
  path: "/memecoin-mcp-server", crumb: "Memecoin MCP", og: "og-mcp.png", eyebrow: `Memecoin MCP · ${N_TOOLS} tools · with your account`,
  title: "Memecoin MCP Server: Live Solana Data for AI Agents | BLIX",
  description: "A memecoin MCP connector for AI agents: every Solana and pump.fun coin live, holders with snipers and bundles, candles, quotes, wallets, narratives and AI reads.",
  h1: "Memecoin MCP server",
  lede: `The BLIX MCP connector gives any MCP client (Claude, Cursor, Codex, Gemini CLI, VS Code, your own agent) the whole memecoin market on Solana as tools: what launched, what is in the final stretch, who holds a coin, the candles, a real quote, the AI's grade and plan, which narratives are running, what the smart-money wallets are doing, and a paper desk to act on it. One file, no dependencies, your account's session as the key, and it cannot touch real money.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">All ${N_TOOLS} tools</a>`)}
${facts([["Tools", `${N_TOOLS}`], ["Data", "pump.fun from the first trade; every pool Jupiter routes"], ["Wallets", "Smart-money ranking, any wallet from the chain, Fomo traders"], ["AI", "Research reads, picks scorecard, narratives, briefs, track record"], ["Writes", "Your paper desk only"], ["Access", "Your BLIX account"]])}
<h2 id="tools">The tools</h2>
${TOOL_TABLE}
<h2 id="agent">What an agent can do with it</h2>
${bullets([
    "<b>Token analytics:</b> rank coins by live traction, read one coin's holders, candles and safety, compare it with its narrative.",
    "<b>Wallet analytics:</b> read the smart-money ranking, open any wallet's holdings, swaps and positions, see what Fomo traders are buying.",
    "<b>Research:</b> read the AI's deep read on a coin, the picks scorecard, the narratives and the latest market brief.",
    "<b>Act, safely:</b> paper-buy with a take profit and a stop at the real quote, sell, review the desk; nothing it does can spend real funds.",
    "<b>Learn:</b> read the track record per signal type and adjust its own rules.",
  ])}
<h2 id="setup">Setup</h2>
${SIGNIN_DEV}
${SETUP_ALL}
<h2 id="prompts">Prompts that use it well</h2>
${bullets([
    `"Rank the final-stretch coins by holders, drop any with bundles over 20% or a dev that sold, and read the top three."`,
    `"Which smart-money wallets bought in the last hour, and what is their record?"`,
    `"Summarise today's narratives and the lead coin of each, with its safety."`,
    `"Paper-buy 0.2 SOL of &lt;mint&gt; with a 2x take profit and a 35% stop, then show the desk."`,
  ])}
${COMMUNITY}
${DEV_MORE}`,
  faq: [
    ["Is there a memecoin MCP server for Solana?", `Yes: the BLIX MCP connector, ${N_TOOLS} tools over stdio, covering pump.fun from the first trade and every pool Jupiter routes, plus wallets and the AI's reads. It comes with a BLIX account.`],
    ["Is there a wallet analytics MCP?", `BLIX MCP includes <code>blix_wallets</code>, <code>blix_wallet</code> and <code>blix_fomo</code>: the smart-money ranking, any wallet's holdings, swaps and positions from the chain, and what Fomo traders are buying.`],
    ["Can the agent trade?", `Paper only, at real quotes. There is no wallet or key in the connector.`],
    ["How do I install it?", `Sign in, open <a href="/developers">Developers</a>, download the one-file connector and paste the command for your client.`],
  ],
});

// ---------- /how-to-use-mcp-for-crypto ----------
const howMcp = page({
  path: "/how-to-use-mcp-for-crypto", crumb: "How to use MCP for crypto", og: "og-mcp.png", eyebrow: `Guide · checked ${CHECKED}`,
  title: "How to Use MCP for Crypto: Solana Data in Your AI | BLIX",
  description: "Step-by-step: give Claude, Codex, Gemini or Cursor live Solana and pump.fun data with the BLIX MCP connector that comes with your account. Setup per client.",
  h1: "How to use MCP for crypto, Solana and pump.fun",
  lede: `MCP lets an AI client call tools. For crypto that means the model can read live data instead of guessing: what launched on pump.fun a minute ago, who holds a coin, what a 0.5 SOL buy would get, what the narratives are. This guide sets up the <a href="/mcp">BLIX MCP connector</a> (it comes with a BLIX account) in each client, shows what to ask, and explains how to keep the model away from your keys.`,
  body: `${DEV_CTA(`<a class="btn" href="/mcp">BLIX MCP</a>`)}
<h2 id="steps">Setup in four steps</h2>
${steps([
    `<b>Create your BLIX account</b> (sign in with Google) and open <a href="/developers">Developers</a>: your session is shown there.`,
    `<b>Download the connector and add it to your client</b>, with your session in <code>BLIX_SESSION</code>: ${SETUP_ALL}`,
    `<b>Check the tools are listed.</b> Claude Code: <code>/mcp</code>. Gemini CLI: <code>/mcp</code>. Cursor: Settings → MCP shows <code>blix</code> with ${N_TOOLS} tools.`,
    `<b>Ask.</b> "What is in the final stretch on pump.fun right now? For the top three, show holders and whether the dev sold, and quote a 0.3 SOL buy."`,
  ])}
<h2 id="chatgpt">ChatGPT: the remote-only case</h2>
<p>ChatGPT's web app connects to remote (HTTPS) MCP servers through Developer Mode, not to local stdio servers, and plan eligibility has changed through 2026. OpenAI's Codex CLI does start local servers, so the quickest route to GPT is Codex with the config above. To reach the ChatGPT web app, put the connector behind a stdio-to-HTTP bridge on a machine you control, with HTTPS and authentication, and add the URL as a custom connector. <a href="/chatgpt-meme-coin-analysis">The ChatGPT page</a> has the details.</p>
<h2 id="keys">Keep keys away from the model</h2>
<p>The connector has no wallet and no key; the only writes are the paper desk. That is deliberate: an agent that can read everything and spend nothing is the right shape for memecoins. Real trades are made by you, in the terminal, in one click.</p>
<h2 id="ask">What to ask, by job</h2>
${table(["Job", "Prompt"], [
    ["Find coins", `"List final-stretch coins with over 50 holders and no bundles, newest first."`],
    ["Check a coin", `"Read &lt;mint&gt;: safety, holders with tags, the AI's grade and plan."`],
    ["Price a trade", `"Quote a 0.5 SOL buy of &lt;mint&gt; and the price impact; then a full sell."`],
    ["Follow money", `"Which smart-money wallets bought in the last hour? Show each wallet's record."`],
    ["Read the market", `"Summarise the narratives running and the latest brief."`],
    ["Practise", `"Paper-buy 0.25 SOL of the best of them with a 2x take profit and a 40% stop."`],
    ["Learn", `"Which signal types have the best 1-hour record this week?"`],
  ])}
<h2 id="trouble">Troubleshooting</h2>
${bullets([
    "<b>\"Your BLIX session is missing or expired\":</b> sign in again, open Developers and copy the fresh session into <code>BLIX_SESSION</code>.",
    "<b>The client does not list the server:</b> check the path to <code>blix-mcp.mjs</code> (on Windows, escape backslashes in JSON) and that <code>node</code> (20+) is on the PATH the client uses.",
    "<b>Tool results look truncated:</b> by design: lists are capped (<code>limit</code>, default 10, max 50) and picture fields dropped so a model is not flooded.",
    `<b>Anything else:</b> the <a href="${DISCORD}" rel="noopener">Discord</a>.`,
  ])}
${COMMUNITY}
${DEV_MORE}
${NOT_AFFILIATED("Anthropic, OpenAI, Google or Cursor")}`,
  faq: [
    ["How do I connect pump.fun to an AI?", `Create a BLIX account, download the connector from Developers and add it to your client with your session. The AI then has every launch, holder ledger, candle and quote as tools.`],
    ["How do I connect Solana to ChatGPT?", `Through Codex CLI (local MCP works) or a remote bridge for the ChatGPT web app. See the steps above.`],
    ["Do I need an API key?", `No. Your BLIX session is the key, shown on the Developers page. Your AI client uses its own login as usual.`],
    ["Can MCP trade for me?", `The connector can paper-trade at real quotes. It has no wallet, so it cannot spend real funds.`],
  ],
});

// ---------- /solana-api ----------
const solApi = page({
  path: "/solana-api", crumb: "Solana memecoin API", og: "og-api.png", eyebrow: `Solana API · ${N_ENDPOINTS} endpoints · with your account`,
  title: "Solana Memecoin API: Tokens, Trades, Wallets & Quotes | BLIX",
  description: "A Solana API for memecoin trading data, included with a BLIX account: every pump.fun launch, trades from chain, holders, candles, Jupiter quotes, wallets, signals.",
  h1: "Solana memecoin API",
  lede: `Solana's own JSON-RPC gives you raw accounts and transactions; a memecoin API gives you what a trader needs from them. BLIX is the layer in between: it reads the pump.fun, PumpSwap and Raydium LaunchLab programs from the chain, prices every pool through Jupiter, and serves ${N_ENDPOINTS} endpoints and a live stream: launches, trades, holders with dev, sniper and bundle tags, candles, quotes, wallets with PnL, signals, narratives and the AI's reads. It comes with your BLIX account; your session is the key.`,
  body: `${DEV_CTA()}
${facts([["Coverage", "pump.fun and LaunchLab from the chain; every pool Jupiter routes; DexScreener and GeckoTerminal pairs"], ["Transport", "HTTPS + JSON, and one Server-Sent Events stream"], ["Access", "Your account's session"], ["Wallets", "Any wallet's swaps and realized, open and sellable PnL"], ["Trading", "Jupiter quotes; your paper desk; real trades in the terminal"], FACT.community])}
${SIGNIN_DEV}
<h2 id="vs-rpc">Solana RPC versus a memecoin API</h2>
${table(["You want", "Solana JSON-RPC", "BLIX API"], [
    ["New pump.fun coins", "logsSubscribe on the program and decode CreateEvent yourself", "<code>launch</code> events on <code>/api/stream</code>"],
    ["A coin's trades and market cap", "Parse every transaction's logs and reserves", "<code>/api/coin/&lt;mint&gt;/trades</code>, <code>/api/candles/&lt;mint&gt;</code>"],
    ["Who holds it, and who sniped it", "getTokenLargestAccounts, then reconstruct history", "<code>/api/holders/&lt;mint&gt;</code> with dev, sniper and bundle tags"],
    ["A wallet's swaps and profit", "getSignaturesForAddress and decode every DEX", "<code>/api/wallet-page/&lt;address&gt;</code>: holdings, swaps, positions and best trades, from the chain"],
    ["A price to trade at", "Call Jupiter yourself", "<code>/api/quote</code>"],
  ])}
<h2 id="endpoints">The endpoint groups</h2>
${table(["Group", "Endpoints"], [
    ["Market", "<code>/api/overview</code>, <code>/api/pulse</code>, <code>/api/tokens</code>, <code>/api/token/&lt;mint&gt;</code>, <code>/api/holders/&lt;mint&gt;</code>, <code>/api/candles/&lt;mint&gt;</code>, <code>/api/quote</code>"],
    ["Signals, narratives, briefs", "<code>/api/signals</code>, <code>/api/narratives</code>, <code>/api/clusters</code>, <code>/api/briefs</code>"],
    ["Research and picks", "<code>/api/research</code>, <code>/api/research/&lt;mint&gt;</code>, <code>/api/picks</code>, <code>/api/picks/all</code>"],
    ["Wallets", "<code>/api/wallet-page/&lt;address&gt;</code>, <code>/api/wallets</code>, <code>/api/fomo</code>"],
    ["Paper desk", "<code>/api/paper</code>, <code>/api/paper/quoted</code>, <code>/api/paper/&lt;id&gt;/sellq</code>, rules"],
    ["Record", "<code>/api/perf</code>, <code>/api/health</code>"],
  ])}
<p>The full reference with every field is on the <a href="/api">API page</a>.</p>
<h2 id="quick">Quick start</h2>
${AUTH_CURL}
${code(`curl -s "${BASE}/api/tokens?sort=trending&limit=20" -H "cookie: blix_wait=$BLIX_SESSION"
curl -s ${BASE}/api/wallet-page/<wallet> -H "cookie: blix_wait=$BLIX_SESSION"
curl -N ${BASE}/api/stream -H "cookie: blix_wait=$BLIX_SESSION"`, "bash")}
${COMMUNITY}
${DEV_MORE}
${NOT_AFFILIATED("Solana Foundation, Jupiter, pump.fun or Raydium")}`,
  faq: [
    ["Is there a Solana trading API?", `BLIX's API quotes through Jupiter and runs your paper desk; it does not execute real trades. Real trades are yours, in the terminal.`],
    ["Is this the official Solana API?", `No. Solana's official interface is its JSON-RPC. BLIX sits on top of it and serves memecoin-level data.`],
    ["Do I need an API key?", `No. Your BLIX session authorizes every call; it is shown on the Developers page once you sign in.`],
    ["Does it cover tokens that are not memecoins?", `Any Solana token Jupiter routes can be opened and quoted; the deep coverage (holders from the first trade, launch events) is for pump.fun and LaunchLab coins.`],
  ],
});

// ---------- /memecoin-api ----------
const memeApi = page({
  path: "/memecoin-api", crumb: "Memecoin API", og: "og-api.png", eyebrow: `Memecoin API · ${N_ENDPOINTS} endpoints · with your account`,
  title: "Memecoin API: Prices, Market Cap, Liquidity, Holders, Signals | BLIX",
  description: "A memecoin data API for Solana, included with a BLIX account: live price and market cap, liquidity, volume, holders with snipers and bundles, candles, trades.",
  h1: "Memecoin API for Solana",
  lede: `Every number the BLIX terminal shows, as JSON: price and market cap, liquidity and volume, holders and who they are, candles and trades, the signals and the narratives, the AI's grade on each coin. ${N_ENDPOINTS} endpoints and one live stream, authorized by your account's session, because BLIX reads the chain itself rather than reselling someone's feed.`,
  body: `${DEV_CTA()}
${facts([["Price and mcap", "Live, from trades on the curve and Jupiter prices after"], ["Liquidity and volume", "Per coin, with the sellable-liquidity check"], ["Holders", "Count, top 10, dev, snipers, bundles, who sold"], ["Signals", "Every type, with the track record"], ["AI", "Rating, deep reads, picks, narratives"], ["Access", "Your BLIX account"]])}
${SIGNIN_DEV}
<h2 id="data">The data, by endpoint</h2>
${table(["Data", "Endpoint"], [
    ["Token price, market cap, liquidity, volume, change", "<code>GET /api/token/&lt;mint&gt;</code>, <code>GET /api/tokens?sort=…</code>"],
    ["Market-cap candles with volume", "<code>GET /api/candles/&lt;mint&gt;?tf=&lt;seconds&gt;</code>"],
    ["Every trade of a coin", "<code>GET /api/coin/&lt;mint&gt;/trades?limit=100</code>"],
    ["Holders with tags", "<code>GET /api/holders/&lt;mint&gt;?top=25</code>"],
    ["A real buy or sell quote", "<code>GET /api/quote?mint=&amp;side=&amp;amount=&amp;slip=</code>"],
    ["Signals with safety and score", "<code>GET /api/signals?type=&amp;safety=passed</code>, <code>signal</code> events on the stream"],
    ["Narratives and bursts", "<code>GET /api/narratives</code>, <code>GET /api/clusters</code>"],
    ["AI reads and picks", "<code>GET /api/research/&lt;mint&gt;</code>, <code>GET /api/picks</code>"],
    ["Track record per signal type", "<code>GET /api/perf</code>"],
  ])}
<h2 id="example">Example: a token price and market cap tracker</h2>
${code(`// Node 20+: BLIX_SESSION from ${BASE}/developers
const BLIX = "${BASE}", H = { cookie: \`blix_wait=\${process.env.BLIX_SESSION}\` };
const get = (p) => fetch(BLIX + p, { headers: H }).then((r) => r.json());

// one coin's full detail every 5 s
setInterval(async () => {
  const t = await get("/api/token/<mint>");
  console.log(t.symbol, t.price, t.mcap, "liq", t.liquidity, "vol24h", t.vol_h24);
}, 5000);

// the live stream: launches, live market caps, migrations, signals
const res = await fetch(BLIX + "/api/stream", { headers: H });
for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) process.stdout.write(chunk);`, "javascript")}
<h2 id="signals-api">A memecoin signals API</h2>
<p><code>GET /api/signals</code> returns the feed with each signal's type, coin, text, safety and score; <code>GET /api/perf</code> returns how each type has done (checked, up 20%+, down 50%+, unsellable, median, reached 2x). A positive signal is never raised on a coin that failed the safety check. On the stream, <code>signal</code> events arrive as they are raised.</p>
<h2 id="compare">Memecoin API options</h2>
${table(["", "Data", "Access", "Cost"], [
    ["BLIX", "Solana memecoins live, from the chain: everything above", "A BLIX account", "Included"],
    ["DEX Screener API", "Pairs, prices and volume across chains", "None; rate-limited", "Free"],
    ["Birdeye API", "Solana token data, OHLCV, wallets", "Key", "Paid tiers"],
    ["Indexers (Bitquery, Moralis, Codex)", "Multi-chain, deep history, queries", "Key", "Free tier, then paid"],
    ["PumpPortal", "pump.fun launches, migrations, trades", "Key for trade streams", "Metered"],
  ], "cmp")}
${COMMUNITY}
${DEV_MORE}
${NOT_AFFILIATED("DEX Screener, Birdeye, Bitquery, Moralis, Codex or PumpPortal")}`,
  faq: [
    ["Is there a free memecoin API?", `BLIX's comes with a free account and serves live Solana memecoin data with no separate key. Hosted indexers have free tiers with limits.`],
    ["Does it have a token price API?", `Yes: live price and market cap per coin, candles from 1 second to daily, and live updates on the stream.`],
    ["Does it have a liquidity API?", `Pool liquidity is on every coin, and the quote endpoint tells you what you could actually sell into at your size.`],
    ["Is there a meme coin signals API?", `Yes, with the track record per type, so a bot can weigh each signal by its history.`],
  ],
});

// ---------- /wallet-tracking-api ----------
const walletApi = page({
  path: "/wallet-tracking-api", crumb: "Wallet tracking API", og: "og-api.png", eyebrow: `Wallet API · with your account`,
  title: "Solana Wallet Tracking API: Swaps, PnL, Smart Money, Whales | BLIX",
  description: "A wallet tracking API for Solana with a BLIX account: any wallet's holdings, swaps and positions from the chain, the smart-money ranking, whale moves as signals.",
  h1: "Solana wallet tracking API",
  lede: `Read any Solana wallet with one GET and BLIX builds its page from the chain: holdings, latest swaps on every Solana DEX, open positions, best closed trades and its pump.fun rank. The wallets BLIX follows as smart money come back ranked by their record with realized, open and sellable profit kept apart, their buys are <code>signal</code> events on the live stream, and <code>/api/fomo</code> shows what Fomo's traders are buying. Your account's session is the key.`,
  body: `${DEV_CTA()}
${facts([["Read", "<code>GET /api/wallet-page/&lt;address&gt;</code>: holdings, latest swaps, positions, best closed trades, pump.fun rank"], ["Smart money", "<code>GET /api/wallets</code>: the ranking BLIX builds from early buyers of runners"], ["Signals", "Smart and leaderboard wallets' buys on the stream"], ["Fomo", "What Fomo traders are buying, top Fomo traders"], ["Holders", "Any coin's largest wallets with tags and SOL flows"], ["Access", "Your BLIX account"]])}
${SIGNIN_DEV}
<h2 id="endpoints">Endpoints</h2>
${table(["Method", "Path", "Returns"], [
    ["GET", "<code>/api/wallet-page/&lt;address&gt;</code>", "Any wallet from the chain: profile, holdings, latest swaps, positions, best closed trades, pump.fun rank"],
    ["GET", "<code>/api/wallet/&lt;address&gt;</code>", "A wallet BLIX follows: swaps, realized / open / sellable PnL, linked wallets"],
    ["GET", "<code>/api/wallets</code>", "The smart-money ranking and the Fomo overview"],
    ["GET", "<code>/api/holders/&lt;mint&gt;?top=25</code>", "A coin's largest wallets with dev, sniper and bundle tags, SOL in and out"],
    ["GET", "<code>/api/fomo</code>", "What Fomo app traders are buying, flow per coin, top Fomo traders"],
    ["GET", "<code>/api/signals?kind=wallet</code>", "Buys by smart and followed wallets, with each wallet's record"],
    ["GET", "<code>/api/stream</code>", "<code>signal</code> events as they are raised"],
  ], "ref")}
${code(`export BLIX_SESSION="<from your Developers page>"
curl -s ${BASE}/api/wallet-page/<wallet> -H "cookie: blix_wait=$BLIX_SESSION" | jq .
curl -s ${BASE}/api/wallets -H "cookie: blix_wait=$BLIX_SESSION" | jq '.smart[:10]'
curl -s "${BASE}/api/signals?kind=wallet&limit=20" -H "cookie: blix_wait=$BLIX_SESSION"
curl -s "${BASE}/api/holders/<mint>?top=10" -H "cookie: blix_wait=$BLIX_SESSION" | jq '.top'`, "bash")}
<h2 id="pnl">How PnL is computed</h2>
<p>Every swap is decoded from the chain with its SOL and token amounts. <b>Realized</b> is SOL out minus SOL in on closed size; <b>open</b> marks what is still held at the live price; <b>sellable</b> asks Jupiter what the open size would really fetch now, which is what matters on a thin pool. Wallets funded from the same source are linked so one trader's many wallets read as one.</p>
<h2 id="smart">Smart money and whales</h2>
<p>BLIX pulls the early buyers of every coin that ran and ranks wallets by how often they were early and whether they sold for a profit; the best are followed automatically and come back in <code>/api/wallets</code> as the smart-money ranking, with their buys on the stream. Large holders of any coin are in the holders endpoint with their share, SOL in and out and tags.</p>
${links("More wallet pages", [
    ["/solana-wallet-tracker", "Solana wallet tracker", "The same tracking in the terminal."],
    ["/smart-money-tracker", "Smart money tracker", "How the ranking works."],
    ["/solana-whale-tracker", "Solana whale tracker", "Large wallets and their moves."],
    ["/solana-pnl-tracker", "Solana PnL tracker", "Realized, open and sellable explained."],
    ["/developers", "Developer access", "Your session and commands."],
  ])}
${COMMUNITY}
${NOT_AFFILIATED("Fomo")}`,
  faq: [
    ["Is there a Solana wallet tracking API?", `BLIX's, with your account: any wallet's holdings, swaps and positions from the chain, the smart-money ranking, and smart wallets' buys on a live stream.`],
    ["Is there a smart money API?", `<code>GET /api/wallets</code> carries the smart-money ranking BLIX builds from early buyers of runners; wallet signals carry each wallet's record.`],
    ["Can it track whales?", `Any wallet, and every coin's largest holders are in the holders endpoint with tags and SOL flows.`],
    ["How do I get access?", `Create a BLIX account and open <a href="/developers">Developers</a>.`],
  ],
});

// ---------- /memecoin-sdk ----------
const sdk = page({
  path: "/memecoin-sdk", crumb: "Memecoin SDK", og: "og-api.png", eyebrow: `SDK · with your account`,
  title: "Memecoin SDK for Solana: Trading Data in 20 Lines, Any Language | BLIX",
  description: "No package to install: the BLIX memecoin API is HTTPS and JSON, so a trading, token analytics or wallet analytics SDK is a 20-line client in any language.",
  h1: "Memecoin SDK: a client in twenty lines",
  lede: `People search for a memecoin SDK, a Solana trading SDK, a token analytics SDK or a wallet analytics SDK. BLIX is all of them without a package: its API is HTTPS and JSON authorized by your account's session, so the "SDK" is twenty lines in whatever language you use, and the MCP connector is the SDK for AI agents. Here are the clients, what they cover, and what the SDK does not do (sign transactions).`,
  body: `${DEV_CTA()}
${facts([["Install", "Nothing: HTTPS + JSON"], ["Covers", "Market, coins, holders, candles, quotes, signals, narratives, research, wallets, paper desk"], ["Languages", "Any. JavaScript and Python below; Go and Rust the same way"], ["Agents", `MCP connector, ${N_TOOLS} tools`], ["Trading", "Quotes and your paper desk; real trades in the terminal"], ["Access", "Your BLIX account"]])}
${SIGNIN_DEV}
<h2 id="js">JavaScript / TypeScript (Node 20+)</h2>
${code(`const BLIX = "${BASE}";
const H = { cookie: \`blix_wait=\${process.env.BLIX_SESSION}\` };      // from ${BASE}/developers
const get = (p) => fetch(BLIX + p, { headers: H }).then((r) => r.json());
const post = (p, body) => fetch(BLIX + p, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

export const blix = {
  overview: () => get("/api/overview"),
  pulse: () => get("/api/pulse"),
  tokens: (q = "sort=trending&limit=50") => get("/api/tokens?" + q),
  coin: (mint) => get("/api/token/" + mint),
  holders: (mint, top = 25) => get(\`/api/holders/\${mint}?top=\${top}\`),
  candles: (mint, tf = 60) => get(\`/api/candles/\${mint}?tf=\${tf}\`),
  quote: (mint, side, amount, slip = 300) => get(\`/api/quote?mint=\${mint}&side=\${side}&amount=\${amount}&slip=\${slip}\`),
  signals: (q = "safety=passed&limit=50") => get("/api/signals?" + q),
  narratives: () => get("/api/narratives"),
  research: (mint) => get("/api/research/" + mint),
  wallets: () => get("/api/wallets"),
  wallet: (address) => get("/api/wallet-page/" + address),
  paperBuy: (mint, sol, rules = {}) => post("/api/paper/quoted", { mint, sol, ...rules }),
  paperSell: (id, pct = 100) => post(\`/api/paper/\${id}/sellq\`, { pct }),
};`, "javascript")}
<h2 id="py">Python</h2>
${code(`import json, os, requests

class Blix:
    def __init__(self, base="${BASE}"):
        self.base = base
        self.cookies = {"blix_wait": os.environ["BLIX_SESSION"]}   # from ${BASE}/developers
    def get(self, path, **params):
        return requests.get(self.base + path, params=params, cookies=self.cookies).json()
    def post(self, path, body):
        return requests.post(self.base + path, json=body, cookies=self.cookies).json()

    def pulse(self):                 return self.get("/api/pulse")
    def tokens(self, **q):           return self.get("/api/tokens", **q)
    def coin(self, mint):            return self.get(f"/api/token/{mint}")
    def holders(self, mint, top=25): return self.get(f"/api/holders/{mint}", top=top)
    def candles(self, mint, tf=60):  return self.get(f"/api/candles/{mint}", tf=tf)
    def quote(self, mint, side, amount, slip=300):
        return self.get("/api/quote", mint=mint, side=side, amount=amount, slip=slip)
    def wallet(self, address):       return self.get(f"/api/wallet-page/{address}")
    def paper_buy(self, mint, sol, **rules): return self.post("/api/paper/quoted", {"mint": mint, "sol": sol, **rules})
    def stream(self):
        with requests.get(self.base + "/api/stream", stream=True, cookies=self.cookies) as r:
            event = None
            for line in r.iter_lines(decode_unicode=True):
                if line.startswith("event:"): event = line[6:].strip()
                elif line.startswith("data:"): yield event, json.loads(line[5:])`, "python")}
<h2 id="what">What the SDK covers, and what it does not</h2>
${table(["Need", "Covered"], [
    ["Token analytics SDK", "Yes: price, mcap, liquidity, volume, holders, candles, trades, safety"],
    ["Wallet analytics SDK", "Yes: any wallet's holdings, swaps and positions from the chain; the smart-money ranking"],
    ["Trading SDK", "Quotes and your paper desk at real quotes; no transaction signing"],
    ["Crypto AI SDK", `The AI reads, picks and narratives as JSON; the MCP connector for agents`],
    ["Token launcher SDK", "No. Launching a pump.fun coin is done in the terminal, from your Blix wallet"],
  ])}
${F.api("Where the SDK's data comes from")}
${COMMUNITY}
${DEV_MORE}`,
  faq: [
    ["Is there an npm or pip package?", `No, and none is needed: the API is HTTPS and JSON. Copy the client above into your project.`],
    ["Is there a Solana trading SDK here?", `For quotes and paper trading, yes. For signing and sending transactions, no: real trades are made by you in the terminal.`],
    ["Is there a meme coin creator SDK?", `No. The coin launcher is a feature of the terminal, not of the API.`],
    ["How do I authenticate?", `With your account's session, shown on the Developers page, sent as the <code>blix_wait</code> cookie.`],
  ],
});

// ---------- /crypto-trading-cli ----------
const cli = page({
  path: "/crypto-trading-cli", crumb: "Crypto trading CLI", og: "og-api.png", eyebrow: `Command line · with your account`,
  title: "Crypto Trading CLI for Solana Memecoins: curl, jq and AI CLIs | BLIX",
  description: "A crypto trading CLI for Solana memecoins: the BLIX API with curl and jq (launches, holders, quotes, wallets), and Claude Code, Codex or Gemini CLI through MCP.",
  h1: "A crypto trading CLI for Solana memecoins",
  lede: `Two things get called a crypto CLI. Solana's own <code>solana</code> command manages keys and sends transactions; that is not this page. This page is the trading desk in a terminal: every pump.fun launch, holder ledger, chart and quote from the BLIX API with <code>curl</code> and <code>jq</code>, and the AI command-line tools (Claude Code, Codex, Gemini CLI) driving the same data through the MCP connector. Nothing to install beyond curl and Node; your BLIX account's session is the key.`,
  body: `${DEV_CTA()}
${facts([["Needs", "curl and jq; Node 20+ for the MCP connector"], ["Data", "Launches, pulse, coins, holders, candles, quotes, signals, wallets"], ["AI CLIs", "Claude Code, Codex, Gemini CLI via MCP"], ["Trading", "Your paper desk from the command line; real trades in the terminal"], ["Access", "Your BLIX account"], FACT.community])}
${SIGNIN_DEV}
<h2 id="recipes">Recipes</h2>
${code(`export BLIX_SESSION="<from your Developers page>"
B=${BASE}; C="cookie: blix_wait=$BLIX_SESSION"

# launches, as they happen
curl -sN $B/api/stream -H "$C" | grep --line-buffered -A1 "event: launch" | grep --line-buffered "^data:" | cut -c6- | jq -r '[.symbol, .name, .mint] | @tsv'

# the final stretch as a table: symbol, mcap, progress, holders, bundles %
curl -s $B/api/pulse -H "$C" | jq -r '.stretch[] | [.symbol, (.mcap|round), (.progress*100|round), .hl.h, .hl.bd] | @tsv' | column -t

# screen a coin
curl -s "$B/api/holders/<mint>?top=10" -H "$C" | jq '{holders, top10, dev, snipers, bundle}'

# a real quote
curl -s "$B/api/quote?mint=<mint>&side=buy&amount=0.5&slip=300" -H "$C" | jq '{outAmount, priceImpactPct}'

# any wallet's profit
curl -s $B/api/wallet-page/<wallet> -H "$C" | jq .

# paper-buy at the real quote with a 2x take profit and a 40% stop
curl -s -X POST $B/api/paper/quoted -H "$C" -H 'content-type: application/json' -d '{"mint":"<mint>","sol":0.25,"tp":2,"sl":40}'

# the desk, and the track record
curl -s $B/api/paper -H "$C" | jq '.positions[] | {symbol, sol, pnl}'
curl -s $B/api/perf -H "$C" | jq`, "bash")}
<h2 id="watch">A one-line watch</h2>
${code(`watch -n 5 'curl -s ${BASE}/api/pulse -H "cookie: blix_wait=$BLIX_SESSION" | jq -r ".stretch[:10][] | [.symbol, (.mcap|round), (.progress*100|round), .ai.grade] | @tsv" | column -t'`, "bash")}
<h2 id="ai">AI CLIs on the same data</h2>
<p>Claude Code, Codex and Gemini CLI all speak MCP, so one config line gives them the same desk as tools, and you type questions instead of jq filters: "list the final-stretch coins with no bundles and read the strongest." Setup is on <a href="/how-to-use-mcp-for-crypto">how to use MCP for crypto</a>.</p>
${MCP_SETUP.claudeCode}
<h2 id="solana-cli">About Solana's own CLI</h2>
<p>The <code>solana</code> CLI (and <code>spl-token</code>) create keys, transfer SOL and tokens and talk to an RPC. BLIX does not replace them and does not sign or send anything from the command line; real trades are made in the terminal, in one click.</p>
${COMMUNITY}
${DEV_MORE}
${NOT_AFFILIATED("Solana Foundation")}`,
  faq: [
    ["Is there a pump.fun CLI?", `BLIX from the command line is it: curl and jq against the API with your session, or an AI CLI through the MCP connector.`],
    ["Is there a wallet CLI?", `Read any wallet with curl as above. For keys and transfers use Solana's own CLI.`],
    ["Can I trade from the command line?", `Paper trades, yes, at real quotes. Real trades are made in the terminal.`],
    ["How do I get access?", `Create a BLIX account and open <a href="/developers">Developers</a> for your session.`],
  ],
});

// ---------- /how-to-build-a-solana-trading-bot ----------
const buildBot = page({
  path: "/how-to-build-a-solana-trading-bot", crumb: "Build a Solana trading bot", og: "og-api.png", eyebrow: `Guide · checked ${CHECKED}`,
  title: "How to Build a Solana Trading Bot for Memecoins (2026 Guide) | BLIX",
  description: "How to build a Solana or pump.fun trading bot: live data from the BLIX API, screening by holders and safety, signals with a record, paper testing, then execution.",
  h1: "How to build a Solana trading bot",
  lede: `A memecoin bot is three parts: data (what is launching and who holds it), a rule (what to buy and when to leave), and execution (signing and sending). Most tutorials start with execution and never get the data right. This guide starts from live data (the <a href="/api">BLIX API</a>, included with your account), builds a rule you can test at real quotes without risking SOL, and only then talks about execution. Python and JavaScript.`,
  body: `${DEV_CTA()}
<h2 id="data">1. Data: your BLIX account</h2>
${SIGNIN_DEV}
${AUTH_CURL}
<p>You now have every pump.fun launch (<code>launch</code> events on the stream), the Pulse (<code>/api/pulse</code>), every coin's holders with dev, sniper and bundle tags (<code>/api/holders</code>), candles, real Jupiter quotes, signals and the AI's reads.</p>
<h2 id="rule">2. A rule worth testing</h2>
<p>Start with a rule that avoids the obvious losers rather than one that predicts winners:</p>
${code(`# python: clean final-stretch coins with real buyers
import os, requests, time
BLIX = "${BASE}"; CK = {"blix_wait": os.environ["BLIX_SESSION"]}
def clean(mint):
    h = requests.get(f"{BLIX}/api/holders/{mint}", params={"top": 10}, cookies=CK).json()
    return (not h.get("partial") and h["bundle"]["pct"] < 15 and h["snipers"]["pct"] < 15
            and h["dev"]["pct"] < 5 and h["dev"]["sold"] != "all" and h["top10"] < 35)
def candidates():
    for c in requests.get(f"{BLIX}/api/pulse", cookies=CK).json()["stretch"]:
        if c["hl"]["h"] >= 60 and c["traders"] >= 40 and c["ai"]["grade"] in ("A", "B") and clean(c["mint"]):
            yield c`, "python")}
<h2 id="paper">3. Test it at real quotes, with paper money</h2>
<p>Your paper desk fills at the real Jupiter quote with slippage and runs take profit, stop loss and trailing stop on the server. Your bot opens positions; BLIX closes them by the rule; <code>/api/paper</code> and <code>/api/picks</code> show the result.</p>
${code(`seen = set()
while True:
    for c in candidates():
        if c["mint"] in seen: continue
        seen.add(c["mint"])
        r = requests.post(f"{BLIX}/api/paper/quoted", json={"mint": c["mint"], "sol": 0.25, "tp": 2.0, "sl": 40, "trail": 25}, cookies=CK).json()
        print("paper buy", c["symbol"], r)
    time.sleep(5)`, "python")}
<p>Run it for a week. Compare with <code>GET /api/perf</code> (how each signal type does) and <code>GET /api/picks</code> (how BLIX's own picks rule does by stage and reason). Most first rules lose; the point is to find out at zero cost.</p>
<h2 id="signals">4. Use the signals with a record</h2>
<p>Instead of inventing rules, subscribe to <code>signal</code> events on the stream and act only on the types whose record is good: smart-wallet buys, AI buy calls, dev sells to exit. The record per type is on <code>/api/perf</code>, and a positive signal is never raised on a coin that failed safety.</p>
<h2 id="execution">5. Execution, when you are ready</h2>
<p>The BLIX API never signs: real trades are made in the terminal, in one click, with the same exits. If you build your own execution, it is your code with your own key: a Jupiter swap transaction signed with your wallet's keypair and sent through your RPC with a priority fee, in a wallet funded only with what the bot may lose, with per-trade and per-day limits in code, kept in a separate process from the data side.</p>
<h2 id="mistakes">Mistakes that cost money</h2>
${bullets([
    "Buying in the first block: you are the sniper everyone else screens out.",
    "Trusting volume: a bot trading with itself makes volume; fees paid and distinct traders do not lie.",
    "Skipping the sell quote: a coin you cannot sell is not a position. Quote the sell before the buy.",
    "No exit rule: the paper desk's take profit, stop and trailing stop exist because people do not sell.",
    "Keys in the data process: one bug and the bot spends everything. Separate them.",
  ])}
${links("More for bot builders", [
    ["/pump-fun-api-python", "pump.fun API in Python", "Client code."],
    ["/pump-fun-api-javascript", "pump.fun API in JavaScript", "Client code, typed."],
    ["/pump-fun-trading-bot", "pump.fun trading bot", "What the bots do and why most lose."],
    ["/ai-trading-agent", "AI trading agent", "Let a model run the loop through MCP."],
    ["/wallet-tracking-api", "Wallet tracking API", "Any wallet from the chain, smart money ranked."],
  ])}
${COMMUNITY}
${RISK}`,
  faq: [
    ["Is there an API to build a Solana trading bot on?", `BLIX's, with your account: every launch, trade, holder ledger, candle, quote and signal as JSON and a live stream.`],
    ["Can the bot trade with real money through BLIX?", `No. The API quotes and paper-trades; real trades are made in the terminal by you.`],
    ["How do I build a pump.fun bot specifically?", `The same way: pump.fun launches, bonding progress and holders are on the Pulse and holders endpoints from the first trade. The pump.fun API page has the details.`],
    ["Where do I ask questions?", `The <a href="${DISCORD}" rel="noopener">BLIX Discord</a>, which comes with your account.`],
  ],
});

export const DEV_PAGES = [developers, cryptoMcp, memeMcp, howMcp, solApi, memeApi, walletApi, sdk, cli, buildBot];
