// The public pages on trade.blixvip.com. The endpoint list and the MCP tool list are the same modules
// the app's own API and MCP pages read (public/api-docs.js, public/mcp-tools.js), so these cannot drift.
// Third-party facts carry the date they were checked (UPDATED in html.js) and link to their source.
import { API_DOCS, API_EVENTS } from "../../public/api-docs.js";
import { MCP_TOOLS } from "../../public/mcp-tools.js";
import { UPDATED_TEXT, esc, code, table, facts, ext, layout, PAGE_CARDS } from "./html.js";
import { FEATURE_PAGES } from "./features.js";
import { COMPARISON_PAGES } from "./comparisons.js";
import { EDITORIAL_PAGES } from "./editorial.js";
import { COMPETITOR_GUIDES } from "./competitor-guides.js";
import { LEARNING_PAGES } from "./learning.js";
import { TOPIC_CLUSTERS, PAGE_ALIASES } from "./clusters.js";
// The keyword pages (pump.fun, AI, trading, developers, competitors, creating coins, guides, /tools): pages-*.js,
// built on pagekit.js. Listed last so a page there replaces an earlier one at the same path.
import { PUMP_PAGES } from "./pages-pump.js";
import { AI_PAGES } from "./pages-ai.js";
import { TRADE_PAGES } from "./pages-trade.js";
import { DEV_PAGES } from "./pages-dev.js";
import { COMPETE_PAGES } from "./pages-compete.js";
import { CREATE_PAGES } from "./pages-create.js";
import { GUIDE_PAGES } from "./pages-guides.js";
import { TRADEAPI_PAGES } from "./pages-tradeapi.js";
const KEYWORD_PAGES = [...PUMP_PAGES, ...AI_PAGES, ...TRADE_PAGES, ...DEV_PAGES, ...COMPETE_PAGES, ...CREATE_PAGES, ...GUIDE_PAGES, ...TRADEAPI_PAGES];

const N_ENDPOINTS = API_DOCS.reduce((a, [, rows]) => a + rows.length, 0);
const N_TOOLS = MCP_TOOLS.length;
const BASE = "https://blixvip.com";
const MCP_SCRIPT = "/path/to/blix-mcp.mjs";
const DISCORD = "https://discord.gg/3VWHBP6paA";
// Every request carries the account's session, shown on /developers once signed in.
const SESSION_H = 'cookie: blix_wait=$BLIX_SESSION';
const NOT_AFFILIATED = (who) => `<p class="note">Blix is independent and not affiliated with ${who}. Facts about ${who} were checked against public sources on ${UPDATED_TEXT}.</p>`;

const INSTALL = `<div class="callout"><p><b>Access comes with your account.</b> Create your <a href="/start">BLIX account</a> (sign in with Google), open <a href="/developers">Developers</a> and copy your session. It is the key for every request on this page, sent as the <code>blix_wait</code> cookie; the examples read it from <code>BLIX_SESSION</code>. Already registered? <a href="/login">Log in</a>. Questions: the <a href="${DISCORD}" rel="noopener">BLIX Discord</a>.</p></div>`;
const cta = (secondary) => `<div class="cta"><a class="btn primary" href="/start">Create your account</a>${secondary}<a class="btn" href="${DISCORD}" rel="noopener">Join the Discord</a></div>`;

const refTables = () => API_DOCS.map(([group, rows]) => `<h3>${esc(group)}</h3>${table(["Method", "Path", "Returns"], rows.map(([m, p, d]) => [esc(m), `<code>${esc(p)}</code>`, esc(d)]), "ref")}`).join("");
const eventsTable = () => table(["Event", "Payload", "When"], API_EVENTS.map(([e, p, w]) => [`<code>${esc(e)}</code>`, esc(p), esc(w)]));
const toolArgs = (t) => Object.keys(t.props || {}).map((k) => `<code>${esc(k)}${(t.required || []).includes(k) ? "" : "?"}</code>`).join(" ") || `<span class="note">none</span>`;

const STREAM_JS = code(`// Node 20+. BLIX_SESSION is the session from your Developers page.
const res = await fetch("${BASE}/api/stream", { headers: { cookie: \`blix_wait=\${process.env.BLIX_SESSION}\` } });
let buf = "", event = "";
for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
  buf += chunk;
  for (const line of buf.split("\\n").slice(0, -1)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:") && event === "launch") { const coin = JSON.parse(line.slice(5)); console.log("new pump.fun coin", coin.symbol, coin.mint); }
    else if (line.startsWith("data:") && event === "signal") console.log(JSON.parse(line.slice(5)));
  }
  buf = buf.slice(buf.lastIndexOf("\\n") + 1);
}`, "javascript");
const STREAM_PY = code(`import json, os, requests  # pip install requests

with requests.get("${BASE}/api/stream", stream=True, cookies={"blix_wait": os.environ["BLIX_SESSION"]}) as r:
    event = None
    for line in r.iter_lines(decode_unicode=True):
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:") and event == "launch":
            coin = json.loads(line[5:])
            print(coin["symbol"], coin["mint"])`, "python");

const PULSE_SAMPLE = code(`{
  "newPairs": [{
    "mint": "9VinAschN7A1yZvk432ovidJvTRtwYP1spDhzJA4pump",
    "symbol": "J", "name": "Joule", "pool": "pump",
    "mcap": 4592, "progress": 0.188,
    "buys": 57, "sells": 26, "traders": 51, "liveVol": 8641,
    "hl": { "h": 29, "t10": 18.67, "dev": 0, "ds": "all", "sn": 0, "bd": 0.09, "bdN": 3 },
    "tri": { "score": 32, "label": "meh", "why": "11 same-ticker launches this hour, built on a tweet" },
    "ai": { "status": "running", "grade": null, "action": null },
    "tr": 16
  }],
  "stretch": [ ... ], "migrated": [ ... ], "running": [ ... ]
}`, "json");
const HOLDERS_SAMPLE = code(`{
  "holders": 12, "top10": 12.49, "trades": 109, "genesis": true,
  "dev":     { "wallet": "G2Dx...sobK", "pct": 0, "maxPct": 29.42, "sol": -5.29, "sold": "all" },
  "snipers": { "n": 0, "pct": 0, "maxPct": 0, "sold": 0 },
  "bundle":  { "n": 3, "pct": 0.09, "maxPct": 2.08, "sold": 2 },
  "top": [
    { "wallet": "5j2V...ufWZ", "pct": 6.46, "sol": 4.2, "trades": 3, "tag": null }
  ]
}`, "json");

// ---------- /api ----------
const api = {
  path: "/api", crumb: "API", og: "og-api.png",
  title: "Solana Memecoin Data & API Reference | BLIX",
  ogTitle: "BLIX Solana memecoin data and API reference",
  description: "Explore BLIX Solana memecoin data: launches, trades, holders, candles, quotes and live events. Sign in to use the terminal; review developer access boundaries.",
  eyebrow: `Blix API · ${N_ENDPOINTS} reference endpoints`,
  h1: "Solana memecoin data. All in BLIX.",
  lede: `Research Solana memecoins with live market data, holder activity, wallet tracking and AI analysis in one terminal. Create a BLIX account to use the site. This guide explains the data and interfaces behind the platform.`,
  related: ["/trade-api", "/mcp", "/pump-fun-api", "/gmgn-api", "/axiom-api", "/fomo-api"],
  body: `${cta(`<a class="btn" href="/trade-api">Trade API: your wallet, 2% a trade</a>`)}
${facts([
    ["Access", "Included with every BLIX account; your session is the key"],
    ["Permissions", "Your session reads everything the terminal shows and runs your paper desk; real trades go through the <a href=\"/trade-api\">trade API</a> with an API key and your own wallet"],
    ["Transport", "HTTP + JSON, and one Server-Sent Events stream"],
    ["Chain", "Solana: pump.fun launches, bonding curve, migrations, plus DexScreener and GeckoTerminal pairs"],
    ["Updates", "Live observations; freshness depends on connected feeds"],
    ["Trading", "Paper desk at real quotes with your session; real trades with an API key: quote, build, sign with your own wallet, send (2% a trade, 1.6% with an invite)"],
  ])}
<h2 id="quick-start">Quick start</h2>
${INSTALL}
<p>From a script, send the session as a cookie. The first call to make is the Pulse:</p>
${code(`export BLIX_SESSION="<from your Developers page>"
curl -s ${BASE}/api/pulse -H "${SESSION_H}" | jq '.newPairs[:5] | .[] | {symbol, mcap, progress}'`, "bash")}
<p>In the browser, on blixvip.com after signing in, the session goes along by itself:</p>
${code(`// On blixvip.com after signing in. Read-only; no trade is submitted.
const response = await fetch("/api/pulse", { credentials: "same-origin" });
if (!response.ok) throw new Error("BLIX request failed: " + response.status);
const pulse = await response.json();
console.table((pulse.newPairs || []).slice(0, 10).map(coin => ({
  mint: coin.mint, symbol: coin.symbol, marketCap: coin.mcap ?? null
})));`, "javascript")}
<p>Holder ledgers, candles and AI reads are built from the trades BLIX sees, so a coin first seen mid-life is marked partial rather than guessed. Nothing on this page needs installing: the API is the terminal's own data, served to your account.</p>

<h2 id="trade">Trade from your own wallet</h2>
<p>Real trading is its own door: the <a href="/trade-api">trade API</a>. <code>POST /api/v1/quote</code> prices a buy or sell on pump.fun's curve or PumpSwap pool with every fee shown, <code>POST /api/v1/trade/build</code> returns the unsigned transaction with Blix's fee inside, you sign it with your own key, and <code>POST /api/v1/trade/send</code> puts it through Helius Sender's staked path and reports where it landed. <code>GET /api/v1/stream</code> is a WebSocket with PumpPortal's method names. An API key (made on the trade API page when you are signed in) authorizes those calls; Blix never holds a private key. 2% a trade, 1.6% with an invite, no subscription.</p>
${code(`curl -s ${BASE}/api/v1/quote -H "authorization: Bearer $BLIX_KEY" -H "content-type: application/json" \\
  -d '{"wallet":"<your wallet>","mint":"<mint>","side":"buy","sol":0.1}'`, "bash")}

<h2 id="build">What you can build with it</h2>
<ul>
<li><b>A trading bot</b> that filters on the holder ledger and the AI's grade, then builds, signs and sends through the <a href="/trade-api">trade API</a>.</li>
<li><b>A new-pairs bot</b> for Telegram or Discord that skips coins with heavy bundles, early snipers or a dev who already sold.</li>
<li><b>Copy-trade alerts.</b> Smart-money and leaderboard wallets' buys arrive as <code>signal</code> events with each wallet's record, and any wallet's holdings, swaps and positions are one GET.</li>
<li><b>An AI agent</b> that reads the market, explains a coin and paper-trades its own calls, through the <a href="/mcp">Blix MCP server</a>.</li>
<li><b>Your own Axiom- or GMGN-style front end</b> on top of <code>/api/pulse</code> and the live stream.</li>
<li><b>Backtests</b> of entry and exit rules on recorded trade tapes.</li>
</ul>

<h2 id="stream">Live stream</h2>
<p><code>GET /api/stream</code> is a Server-Sent Events stream. One connection carries new launches, live prices, migrations, signals and paper fills, so a bot never has to poll.</p>
${eventsTable()}
${code(`curl -N ${BASE}/api/stream -H "${SESSION_H}"`, "bash")}
${STREAM_JS}
${STREAM_PY}

<h2 id="pulse">Pulse: new pairs, final stretch, migrated</h2>
<p><code>GET /api/pulse</code> returns the four columns you know from Axiom and GMGN: <b>newPairs</b> (fresh pump.fun launches), <b>stretch</b> (bonding curve past 50%), <b>migrated</b> (graduated to a pool in the last hours) and <b>running</b> (any coin moving in the last five minutes). Each row carries the live market cap in USD, bonding progress, buys, sells, traders and volume, the holder stats, the triage score, the AI's call and a 0–100 rank from live traction.</p>
${PULSE_SAMPLE}
${table(["Field", "Meaning"], [
    ["<code>progress</code>", "Share of the bonding curve sold, 0 to 1"],
    ["<code>hl.h</code> · <code>hl.t10</code>", "Holders · share held by the top 10 wallets (%)"],
    ["<code>hl.dev</code> · <code>hl.ds</code>", "Dev's share (%) · whether the dev sold part or all"],
    ["<code>hl.sn</code> · <code>hl.bd</code> · <code>hl.bdN</code>", "Snipers' share (%) · bundle share (%) · bundle wallets"],
    ["<code>tri</code>", "Triage: an instant rules score on every launch, relabelled by a fast model"],
    ["<code>ai</code>", "The AI read: status, grade A to F, buy / watch / avoid"],
    ["<code>tr</code>", "Rank 0–100 from live traction: traders, flow, 5-minute volume, change"],
  ])}

<h2 id="holders">Holders, snipers and bundles</h2>
<p><code>GET /api/holders/&lt;mint&gt;?top=25</code> is a holder ledger Blix builds itself from the trade feed, with no paid indexer. For a coin it watched from its first trade, it tags the <b>dev</b>, <b>snipers</b> (bought within 2 blocks of the first trade) and <b>bundles</b> (bought in the same block as the first trade), and tracks how much of each group has sold. A coin first seen mid-life is marked partial and its sniper and bundle figures are left empty rather than guessed.</p>
${HOLDERS_SAMPLE}

<h2 id="candles-quotes">Candles and quotes</h2>
<p><code>GET /api/candles/&lt;mint&gt;?tf=60</code> returns market-cap candles built from real trades (<code>tf</code> in seconds: 1, 5, 15, 60, 300, 900 or 3600) with buy and sell counts, and falls back to GeckoTerminal for older history. <code>GET /api/quote</code> returns a real Jupiter quote for a buy or a sell: amount out, price impact and route. Nothing is traded.</p>
${code(`curl -s "${BASE}/api/candles/<mint>?tf=60" -H "${SESSION_H}"
curl -s "${BASE}/api/quote?mint=<mint>&side=buy&amount=0.5&slip=300" -H "${SESSION_H}"`, "bash")}

<h2 id="endpoints">All ${N_ENDPOINTS} endpoints</h2>
<p>Paths are relative to <code>${BASE}</code> and every request carries your session cookie. Errors are JSON <code>{ "error": "…" }</code> with a 4xx or 5xx status. Responses are cached for 1 to 60 seconds, so polling faster returns the same body; use the stream for anything live. Everything under Market, Signals, Research, Paper desk, Wallets and Track record is yours with an account; the rows marked <i>operator only</i> run the terminal itself and are not part of account access.</p>
${refTables()}

<h2 id="compare">Blix API vs GMGN, Axiom, Fomo and PumpPortal</h2>
<p>What each option gives a developer today, checked on ${UPDATED_TEXT}. Each name links to the details and sources.</p>
${table(["", "Public API", "Key", "Cost", "Real trading"], [
    ["Blix", `Yes: ${N_ENDPOINTS} endpoints and a live stream`, "Your account session for data; an API key for trading", "Included with the free account; trades 2% (1.6% with an invite)", `Yes: <a href="/trade-api">the trade API</a> builds pump.fun and PumpSwap trades for your own wallet, you sign, Blix sends`],
    [`<a href="/gmgn-api">GMGN</a>`, "Yes, the GMGN OpenAPI", "Apply at gmgn.ai/ai with an Ed25519 public key", "Not published in its docs", "Yes. Swaps need your private key and an IP whitelist"],
    [`<a href="/axiom-api">Axiom Trade</a>`, "Not verified in reviewed sources", "Unofficial SDKs sign in as your account", "Not applicable", "Official access not verified"],
    [`<a href="/fomo-api">Fomo</a>`, "Not verified in reviewed sources", "Third-party APIs use their own key", "Check provider pricing and terms", "Official access not verified"],
    [`<a href="/pump-fun-api">PumpPortal</a>`, "Third-party pump.fun API", "Required for trade streams", "Launch and migration streams free; trades 0.01 SOL per 10,000", "Yes, 0.5% (local) or 1% (Lightning) a trade"],
  ], "cmp")}
<p>Use GMGN's API for execution through GMGN or chains beyond Solana, PumpPortal for a hosted pump.fun websocket, and BLIX when you want pump.fun from the first trade, holders with snipers and bundles, AI reads and an MCP connector, all with one free account.</p>`,
  faq: [
    ["Is the Blix API free?", `Yes. It comes with every BLIX account, and the account is free: sign in with Google, open Developers and copy your session. Only real trades placed in the terminal pay a fee (2%, 1.6% with an invite).`],
    ["Do I need an API key?", `For data, no: your account session authorizes every request, sent as the <code>blix_wait</code> cookie as the examples show; it reads data and runs your paper desk and cannot move funds. For real trades, yes: an API key from the <a href="/trade-api">trade API page</a> (signed in), sent as <code>Authorization: Bearer</code>.`],
    ["Is this the official GMGN or Axiom API?", `No. BLIX is independent. GMGN documents its own API; official Axiom and Fomo developer access was not verified in the sources reviewed. See the linked integration guides for sources and current limitations.`],
    ["Where does the data come from?", `New pump.fun coins come from PumpPortal's free launch stream with an on-chain backup for any it misses. Trades are decoded straight from Solana program logs over RPC. Prices for graduated coins come from Jupiter, pairs from DexScreener and GeckoTerminal, safety reports from RugCheck. Holders, snipers and bundles are computed by Blix from the trades it sees.`],
    ["How fast is it?", `New pump.fun coins reach the stream about a second after the chain and prices update per trade batch, several times a second on a busy coin. Use the stream rather than polling for anything live; polled endpoints are cached for 1 to 60 seconds.`],
    ["Can I trade through the Blix API?", `Yes, with your own wallet: the <a href="/trade-api">trade API</a> quotes and builds pump.fun and PumpSwap trades, you sign them with your own key, and Blix sends them over staked connections. 2% a trade, 1.6% with an invite, paid inside the transaction. The session-authorized endpoints and the MCP connector stay read-only plus the paper desk.`],
    ["Which chains does it cover?", `Solana. pump.fun launches, the bonding curve and migrations get the deepest coverage; other Solana pairs come in through DexScreener and GeckoTerminal.`],
    ["Can an AI agent use it?", `Yes. The <a href="/mcp">Blix MCP server</a> turns the API into ${N_TOOLS} tools for Claude, Cursor, Codex and any other MCP client.`],
  ],
};

// ---------- /mcp ----------
const ENV = { BLIX_SESSION: "<from your Developers page>" };
const SETUP = [
  ["Claude Code", "Run once in a terminal.", code(`claude mcp add blix -e BLIX_SESSION=<from your Developers page> -- node ${MCP_SCRIPT}`, "bash")],
  ["Claude Desktop and Cursor", "Add to claude_desktop_config.json or ~/.cursor/mcp.json.", code(JSON.stringify({ mcpServers: { blix: { command: "node", args: [MCP_SCRIPT], env: ENV } } }, null, 2), "json")],
  ["Codex", "Add to ~/.codex/config.toml.", code(`[mcp_servers.blix]\ncommand = "node"\nargs = ["${MCP_SCRIPT}"]\n\n[mcp_servers.blix.env]\nBLIX_SESSION = "<from your Developers page>"`, "toml")],
  ["VS Code", "Add to .vscode/mcp.json.", code(JSON.stringify({ servers: { blix: { type: "stdio", command: "node", args: [MCP_SCRIPT], env: ENV } } }, null, 2), "json")],
  ["Gemini CLI", "Add to ~/.gemini/settings.json.", code(JSON.stringify({ mcpServers: { blix: { command: "node", args: [MCP_SCRIPT], env: ENV, timeout: 15000 } } }, null, 2), "json")],
];
const mcp = {
  path: "/mcp", crumb: "MCP", og: "og-mcp.png",
  title: "Solana MCP Server for Claude, Cursor & Codex (Free) | Blix",
  ogTitle: "Blix: the free Solana MCP server for memecoin data",
  description: `Free Solana MCP server: give Claude, Cursor or Codex live memecoin data, pump.fun launches, holders, snipers, bundles, candles and Jupiter quotes. ${N_TOOLS} tools.`,
  eyebrow: `Blix MCP · ${N_TOOLS} tools · with your account`,
  h1: "Solana MCP server for memecoin data",
  lede: `Blix MCP turns the <a href="/api">Blix API</a> into ${N_TOOLS} tools an AI client can call. Ask Claude what is running on pump.fun right now, who holds a coin and whether the dev sold, or have it paper-trade a call. It comes with every BLIX account, is one file with no dependencies, and it <b>reads only, plus a paper-money desk</b>: nothing it does can spend real funds.`,
  related: ["/api", "/pump-fun-api", "/gmgn-api", "/axiom-api"],
  body: `${cta(`<a class="btn" href="/api">See the API</a>`)}
${facts([
    ["Tools", `${N_TOOLS}, from market snapshot to paper trades`],
    ["Transport", "stdio (JSON-RPC 2.0), one file, no dependencies"],
    ["Clients", "Claude Code, Claude Desktop, Cursor, Codex, VS Code, Gemini CLI, any stdio MCP client"],
    ["Key", "Your account session (BLIX_SESSION, from the Developers page)"],
    ["Writes", "Paper desk only. No wallet, no signing."],
    ["Needs", "Node 20+ and a BLIX account; nothing to host"],
  ])}
<h2 id="setup">Set it up in three steps</h2>
<h3>1. Create your account and copy your session</h3>
${INSTALL}
<h3>2. Download the connector</h3>
<p>One file, no dependencies, Node 20 or newer. Your <a href="/developers">Developers page</a> shows this command with your session already filled in.</p>
${code(`curl -O ${BASE}/_pub/blix-mcp.mjs`, "bash")}
<h3>3. Add it to your client</h3>
<p>Put your session in <code>BLIX_SESSION</code>; the connector sends it with every call. Sessions expire, so when a tool answers "session is missing or expired", copy a fresh one from Developers.</p>
${SETUP.map(([name, how, block]) => `<h3>${name}</h3><p>${how}</p>${block}`).join("")}

<h2 id="tools">The ${N_TOOLS} tools</h2>
<p>Every tool is one call of the API. Lists are trimmed for a model: each tool takes <code>limit</code> (rows per list, default 10, max 50), picture fields are dropped and long text is shortened.</p>
${table(["Tool", "Arguments", "What it does"], MCP_TOOLS.map((t) => [`<code>${esc(t.name)}</code>`, toolArgs(t), `${esc(t.description)}${t.write ? ` <b>Paper money.</b>` : ""}`]), "ref")}

<h2 id="prompts">Things to ask it</h2>
<ul>
<li>"What is running on pump.fun in the last five minutes? Skip anything where bundles hold more than 20%."</li>
<li>"Is the dev still holding <code>&lt;mint&gt;</code>? Show the top holders tagged sniper or bundle."</li>
<li>"Quote a 0.5 SOL buy of <code>&lt;mint&gt;</code> and tell me the price impact."</li>
<li>"Paper-buy 0.25 SOL of the strongest Final stretch coin with a 2x take-profit and a 40% stop."</li>
<li>"Summarise today's narratives and the coins leading each one."</li>
<li>"How have Blix's dump warnings done this week? Show the track record."</li>
</ul>

<h2 id="how">How it works</h2>
<p>The connector is one file, <code>blix-mcp.mjs</code>. Your client starts it over stdio; it answers <code>initialize</code>, <code>tools/list</code> and <code>tools/call</code>, and turns each call into an HTTPS request to <code>blixvip.com/api</code> with your session cookie. Tools that only read are marked read-only to the client; the two paper-desk tools are not. The tool list on this page is the list the connector carries, so the docs cannot drift from what it offers.</p>

<h2 id="compare">How it compares</h2>
${table(["", "Key", "Data", "Real trades"], [
    ["Blix MCP", "Your BLIX account", "pump.fun launches, live trades, holders with snipers and bundles, candles, quotes, AI reads, signals, narratives, wallets, track record", "No (paper desk)"],
    [`<a href="/gmgn-api">GMGN agent skills</a>`, "GMGN API key", "GMGN token, market, wallet and trending data", "Yes, with your private key and an IP whitelist"],
    ["Community pump.fun MCP servers", "Varies", "Usually token lookups and bonding-curve reads", "Some can buy and sell with a private key you supply"],
  ], "cmp")}`,
  faq: [
    ["Is there a GMGN MCP server?", `GMGN publishes "skills" for AI agents on top of its OpenAPI (see the official GMGN documentation); they need a GMGN API key, and trading needs your private key. The documented BLIX MCP tools expose research and paper trades; hosted access requires BLIX account authorization. See <a href="/gmgn-api">GMGN API</a>.`],
    ["Is there an Axiom Trade MCP server?", `We did not verify an official trading developer API or MCP server in the Axiom Trade documentation reviewed. Axiom (axiom.co) is a different company; verify which product an integration supports. Blix MCP gives an AI client the same kind of data Axiom's Pulse shows.`],
    ["Can the AI trade real money with it?", `No. The only write tools are blix_paper_buy and blix_paper_sell, and they use paper money filled at real Jupiter quotes. Real trades and launches are made by you in the terminal, with your Blix wallet; the connector never sees it.`],
    ["Which MCP clients does it work with?", `Any client that can start a local (stdio) server: Claude Code, Claude Desktop, Cursor, Codex, VS Code, Windsurf, Zed and others. Clients that only accept remote (HTTPS) servers cannot start it.`],
    ["Does anything have to be running?", `No. The connector talks to blixvip.com over HTTPS, so there is nothing to host or keep open. If your session has expired, every tool answers "Your BLIX session is missing or expired" instead of hanging; sign in and copy a fresh one from Developers.`],
    ["Is it free?", `Yes. The connector comes with every BLIX account, and the account is free. The AI reads it returns are Blix AI's own, produced on the site; the connector itself calls no paid service and needs no key of its own.`],
  ],
};

// ---------- /gmgn-api ----------
const gmgn = {
  path: "/gmgn-api", crumb: "GMGN API", og: "og-gmgn.png",
  title: "GMGN API: Access, Limits and a Free Alternative (2026)",
  ogTitle: "GMGN API access and BLIX research compared",
  description: "Review GMGN OpenAPI access, authentication and documented capabilities. Compare them with BLIX Solana research and account-based terminal access.",
  eyebrow: "GMGN API · checked " + UPDATED_TEXT,
  h1: "GMGN API access and BLIX research compared",
  lede: `GMGN has an official API, the GMGN OpenAPI. You get a key at gmgn.ai/ai by uploading an Ed25519 public key; every request carries that key, and swaps also need the matching private key and an IP whitelist. GMGN's docs do not publish prices or rate limits. If what you need is Solana memecoin data (new pump.fun pairs, holders, snipers, bundles, candles, quotes), <a href="/api">BLIX</a> combines those research workflows in an account-based browser terminal.`,
  related: ["/gmgn-trading-api", "/trade-api", "/api", "/mcp", "/axiom-api", "/pump-fun-api"],
  body: `${cta(`<a class="btn" href="/api#endpoints">See the Blix endpoints</a>`)}
<h2 id="what">What the GMGN API covers</h2>
<p>According to GMGN's own docs and its agent-skills repository, the OpenAPI covers:</p>
<ul>
<li><b>Tokens:</b> basic info, real-time price, contract security, liquidity, top holders and top traders.</li>
<li><b>Market:</b> K-line candles from 1 minute to 1 day, and trending tokens.</li>
<li><b>Wallets:</b> holdings, balances, transaction history and PnL.</li>
<li><b>Trading:</b> swaps with custom slippage, on Solana (SOL, USDC), BSC (BNB, USDC) and Base (ETH, USDC), with more chains in progress.</li>
<li><b>AI agents:</b> "skills" such as <code>/gmgn-token</code>, <code>/gmgn-market</code> and <code>/gmgn-swap</code> that wrap the API for agent frameworks.</li>
</ul>
<p>Sources: ${ext("https://docs.gmgn.ai/index/gmgn-agent-api", "GMGN Agent API docs")}, ${ext("https://docs.gmgn.ai/index/gmgn-agent-api", "GMGN integration documentation")}.</p>

<h2 id="key">How to get a GMGN API key</h2>
<ol>
<li>Generate an Ed25519 key pair on your machine (GMGN's docs suggest OpenSSL).</li>
<li>Go to ${ext("https://gmgn.ai/ai", "gmgn.ai/ai")}, upload the <b>public</b> key and create your API key.</li>
<li>Send the key with every request. For data, that is all.</li>
<li>For swaps, also configure the matching <b>private</b> key and whitelist the IP address your requests come from; GMGN rejects trading requests from other addresses.</li>
</ol>
<div class="callout"><p><b>Before you build on it:</b> as of ${UPDATED_TEXT}, GMGN's public docs list no prices, quotas or rate limits for the OpenAPI. They also list a separate data-crawling IP whitelist under GMGN's cooperation APIs. Scraping gmgn.ai's website instead of using the API is fragile.</p></div>

<h2 id="alternative">Solana memecoin research in BLIX</h2>
<p>What GMGN's API sells, a BLIX account includes: the same Solana memecoin data the terminal shows, as JSON and one live event stream, authorized by your session. The table maps GMGN's categories to BLIX endpoints.</p>
${INSTALL}
${table(["You want (GMGN)", "Blix endpoint", "Notes"], [
    ["New pairs, trending", "<code>GET /api/pulse</code>", "New pairs, Final stretch, Migrated and Running now, ranked by live traction"],
    ["Token info and security", "<code>GET /api/token/&lt;mint&gt;</code>", "Price history, RugCheck safety report, socials, signals, AI research"],
    ["Top holders", "<code>GET /api/holders/&lt;mint&gt;</code>", "Dev, sniper and bundle tags, top-10 share, who sold"],
    ["K-lines", "<code>GET /api/candles/&lt;mint&gt;?tf=1m</code>", "5s to 1h, built from real trades"],
    ["Wallet PnL", "<code>GET /api/wallet-page/&lt;address&gt;</code>", "Any wallet from the chain: holdings, latest swaps, positions, best closed trades, pump.fun rank"],
    ["Swap", "<code>POST /api/v1/trade/build</code> + <code>send</code>", `<a href="/trade-api">The trade API</a>: pump.fun curve and PumpSwap, your own wallet signs, 2% a trade; <code>GET /api/quote</code> for Jupiter quotes without trading`],
    ["Agent skills", `<a href="/mcp">Blix MCP</a>`, `${N_TOOLS} tools for Claude, Cursor, Codex`],
  ])}
${code(`# the Pulse, with the session from your Developers page
curl -s ${BASE}/api/pulse -H "${SESSION_H}"

# a coin's holder ledger with dev / sniper / bundle tags
curl -s "${BASE}/api/holders/<mint>?top=25" -H "${SESSION_H}"`, "bash")}

<h2 id="which">GMGN API or Blix?</h2>
${table(["", "GMGN OpenAPI", "Blix"], [
    ["Access", "API key from gmgn.ai/ai", "Your BLIX account session"],
    ["Price and limits", "Not published", "Included with the free account; fair-use limits per account"],
    ["Chains", "Solana, BSC, Base", "Solana"],
    ["Real trading", "Yes, through the API", `Yes: <a href="/gmgn-trading-api">the trade API</a>, your own wallet, 2% a trade (1.6% with an invite)`],
    ["AI", "No", "A rating, deep reads and picks on every coin"],
    ["Where it runs", "GMGN's servers", "blixvip.com; nothing to host"],
  ], "cmp")}
<p>Use GMGN's API when you need execution through GMGN or chains beyond Solana. Use BLIX when you want pump.fun from the first trade, holders with snipers and bundles, AI reads, an MCP connector and nothing to host: sign in and it is on.</p>
${NOT_AFFILIATED("GMGN")}`,
  faq: [
    ["Does GMGN have an API?", `Yes. GMGN offers an official OpenAPI and agent skills. You need an API key from gmgn.ai/ai, created by uploading an Ed25519 public key.`],
    ["Is the GMGN API free?", `GMGN's public docs do not list prices or quotas as of ${UPDATED_TEXT}; check gmgn.ai/ai when you apply. BLIX's API is included with the free account; only real trades in the terminal pay a fee.`],
    ["What are the GMGN API rate limits?", `GMGN does not publish them in its docs. BLIX applies fair-use limits per account (quotes, paper trades and chart reads are paced per minute); use the live stream rather than polling for anything live.`],
    ["Why are my GMGN swap requests rejected?", `Trading through the GMGN API needs the private key that matches the public key you uploaded, and the request must come from a whitelisted IP address.`],
    ["Can I get GMGN data without a key?", `Not from GMGN; its website is not a public API. BLIX gives you its own data for the same questions, with your account; it is not a way around GMGN's access rules.`],
    ["Is Blix affiliated with GMGN?", `No. BLIX is independent and not affiliated with GMGN.`],
  ],
};

// ---------- /axiom-api ----------
const axiom = {
  path: "/axiom-api", crumb: "Axiom API", og: "og-axiom.png",
  title: "Axiom Trade API: Is There One? The BLIX Alternative (2026)",
  ogTitle: "Axiom Trade API: is there one?",
  description: "Review Axiom Trade developer-access boundaries, unofficial clients and BLIX Solana discovery. BLIX is independent and requires its own site account.",
  eyebrow: "Axiom Trade API · checked " + UPDATED_TEXT,
  h1: "Axiom Trade API: is there one?",
  lede: `We did not verify a public developer API in the Axiom Trade documentation reviewed. Check Axiom directly for current access. The "Axiom API" packages you will find are unofficial clients that sign in as your own Axiom account. If what you want is Axiom's Pulse (new pairs, final stretch, migrated) as data, <a href="/api">Blix</a> provides its own Solana discovery observations and research. Create a BLIX account to use its terminal.`,
  related: ["/axiom-trading-api", "/trade-api", "/api", "/mcp", "/gmgn-api", "/pump-fun-api"],
  body: `${cta(`<a class="btn" href="/api#pulse">See the Pulse endpoint</a>`)}
<div class="callout"><p>Searching "Axiom API" also finds <b>Axiom (axiom.co)</b>, a logging and observability company with its own API. It is unrelated to Axiom Trade, the crypto trading terminal this page is about.</p></div>

<h2 id="unofficial">The unofficial Axiom SDKs</h2>
<p>Community packages such as <code>axiomtradeapi</code> (Python) and <code>axiomtrade-rs</code> (Rust) talk to the same private endpoints the axiom.trade website uses. To do that they sign in as you: with session tokens copied from your browser, or with your login and one-time codes. Know what that means before you use one:</p>
<ul>
<li><b>Your account is in someone else's code.</b> Whatever can read your session can see your balances and may be able to trade.</li>
<li><b>They break without warning.</b> Private endpoints change whenever Axiom ships, and nothing is promised to third parties.</li>
<li><b>Terms of service.</b> Automating a consumer account may break the platform's rules.</li>
</ul>

<h2 id="pulse">Axiom's Pulse as an API</h2>
<p>Blix rebuilds the Pulse from public sources and the chain itself, then hands it to you as JSON. <code>GET /api/pulse</code> returns four columns: <b>newPairs</b>, <b>stretch</b> (past 50% of the bonding curve), <b>migrated</b> and <b>running</b> (anything moving in the last five minutes). Each row has market cap, bonding progress, buys, sells, traders, volume, holders, top-10 share, dev share and whether the dev sold, sniper and bundle shares, the AI's call and a live-traction rank.</p>
${INSTALL}
${code(`// poll the Pulse every 2 seconds and print the hottest final-stretch coins
setInterval(async () => {
  const p = await (await fetch("${BASE}/api/pulse", { headers: { cookie: \`blix_wait=\${process.env.BLIX_SESSION}\` } })).json();
  const hot = p.stretch.filter((c) => (c.hl?.bd ?? 0) < 20).sort((a, b) => b.tr - a.tr).slice(0, 5);
  console.table(hot.map((c) => ({ symbol: c.symbol, mcap: Math.round(c.mcap), progress: c.progress, rank: c.tr })));
}, 2000);`, "javascript")}
${table(["You want (Axiom)", "Blix endpoint"], [
    ["Pulse columns", "<code>GET /api/pulse</code>, live updates on <code>GET /api/stream</code>"],
    ["Token page: chart, holders, dev", "<code>/api/candles/&lt;mint&gt;</code>, <code>/api/holders/&lt;mint&gt;</code>, <code>/api/token/&lt;mint&gt;</code>"],
    ["Wallet tracker", "<code>GET /api/wallet-page/&lt;address&gt;</code> for any wallet's holdings, swaps and positions; smart-wallet buys as <code>signal</code> events"],
    ["Quotes before a trade", "<code>GET /api/quote</code> (real Jupiter quote)"],
    ["Filters and presets", "Run the same filters on the JSON yourself; the dashboard has P1 / P2 / P3 presets"],
  ])}

<h2 id="which">Unofficial SDK or Blix?</h2>
${table(["", "Unofficial Axiom SDKs", "Blix"], [
    ["Needs your Axiom login", "Yes", "No. Your own BLIX account"],
    ["Stability", "Breaks when Axiom changes", "Documented endpoints BLIX keeps stable"],
    ["Real trading", "Yes, through your account", `Yes: <a href="/axiom-trading-api">the trade API</a> builds pump.fun and PumpSwap trades for your own wallet; 2% a trade`],
    ["Data", "Whatever Axiom's private endpoints return", "Pulse, holders, candles, quotes, safety, AI reads, wallets"],
    ["Cost", "Free packages; Axiom's trading fees apply", "Free with the account; 1% only on real trades"],
  ], "cmp")}
${NOT_AFFILIATED("Axiom Trade")}`,
  faq: [
    ["Does Axiom Trade have an API?", `We did not verify an official developer API or SDK in the reviewed documentation. Confirm access with Axiom. Third-party packages exist but are unofficial and sign in as your account.`],
    ["Is axiomtradeapi official?", `No. It is a community project that uses Axiom's private web endpoints with your session. Axiom does not support it.`],
    ["How do I get Axiom Pulse data programmatically?", `Create a BLIX account and call <code>GET /api/pulse</code> with your session: new pairs, final stretch, migrated and running coins with holders, snipers, bundles and the AI's call, plus a live event stream.`],
    ["Can I copy-trade Axiom wallets through an API?", `Any wallet on Axiom is an ordinary Solana wallet. Read it with <code>GET /api/wallet-page/&lt;address&gt;</code> (holdings, latest swaps, positions, from the chain), and the wallets BLIX follows as smart money raise their buys as <code>signal</code> events on the stream. BLIX alerts you; it does not place the trade.`],
    ["Is Blix affiliated with Axiom?", `No. BLIX is independent and not affiliated with Axiom Trade.`],
  ],
};

// ---------- /fomo-api ----------
const fomo = {
  path: "/fomo-api", crumb: "Fomo API", og: "og-fomo.png",
  title: "Fomo API (fomo.family): Is There One? Free Alternative 2026",
  ogTitle: "Fomo API: is there an official one?",
  description: "Fomo has no developer API. Unofficial Fomo APIs (credits, pricing) compared with BLIX: what Fomo's traders are buying, read from the chain, with a free account.",
  eyebrow: "Fomo API · checked " + UPDATED_TEXT,
  h1: "Fomo API: is there an official one?",
  lede: `We did not verify an official developer API or SDK on the Fomo homepage reviewed. Ask Fomo about current integration access. Independent services sell unofficial access to Fomo traders' wallets, PnL and activity on credits. <a href="/api">BLIX</a> takes a different route: Fomo traders' wallets are ordinary Solana wallets, so BLIX reads them from the chain and serves what Fomo's traders are buying, who is doing best and any wallet's trades to your account as JSON.`,
  related: ["/fomo-trading-api", "/trade-api", "/api", "/mcp", "/gmgn-api", "/axiom-api"],
  body: `${cta(`<a class="btn" href="/api#endpoints">See the Blix endpoints</a>`)}
<h2 id="unofficial">Unofficial Fomo APIs</h2>
<p>Several independent services resolve Fomo handles to wallets and resell the data. They describe themselves as unofficial and not affiliated with fomo.family.</p>
${table(["Service", "What it offers", "Cost"], [
    [ext("https://fomoapi.io", "fomoapi.io"), "REST and WebSocket: Fomo handles to Solana and EVM wallets, Fomo-reported PnL, holdings, leaderboards, theses, live activity", "Current plans not verified; confirm with the provider"],
    ["Other resellers", "Similar handle-to-wallet and activity feeds", "Usually credits or subscriptions"],
  ])}
<div class="callout"><p><b>Never give a "Fomo bot" your Fomo login.</b> Fomo wallets are non-custodial; a service holding your credentials can control your wallet. Reading public wallet activity never needs your login.</p></div>

<h2 id="blix">Fomo's traders as data, with your BLIX account</h2>
<ol>
<li><b>What Fomo is buying.</b> Fomo pays its users' network fees, so BLIX learns the account that sponsors those fees and samples the swaps it pays for. <code>GET /api/fomo</code> returns what Fomo traders are buying, flow per coin and the traders doing best.</li>
<li><b>Who is doing best.</b> <code>GET /api/fomo/board</code> is Fomo's leaderboard with every trader matched to a wallet, and <code>GET /api/fomo/trader/&lt;handle&gt;</code> is one trader's profile on record.</li>
<li><b>Any wallet, from the chain.</b> <code>GET /api/wallet-page/&lt;address&gt;</code> builds a wallet's page from the chain: holdings, latest swaps, positions, best closed trades and its pump.fun rank. The wallets BLIX follows as smart money raise their buys as <code>signal</code> events on the stream.</li>
<li><b>Trade in BLIX.</b> Every coin has a one-click buy with a real Jupiter route, take profit and stops, so a Fomo trader's buy becomes your trade without leaving the page.</li>
</ol>
${INSTALL}
${code(`# what Fomo traders are buying, and the top Fomo traders
curl -s ${BASE}/api/fomo -H "${SESSION_H}"
curl -s ${BASE}/api/fomo/board -H "${SESSION_H}"

# any wallet, built from the chain
curl -s ${BASE}/api/wallet-page/<wallet> -H "${SESSION_H}"`, "bash")}

<h2 id="which">Unofficial Fomo API or Blix?</h2>
${table(["", "Unofficial Fomo APIs", "Blix"], [
    ["Handle to wallet lookup", "Yes", "Leaderboard traders matched to wallets; any wallet readable by address"],
    ["Fomo-reported PnL", "Yes", "No: PnL computed from the chain, realized and open kept apart"],
    ["Live activity", "WebSocket, metered", "Server-Sent Events, included"],
    ["Key and credits", "Yes", "A free BLIX account, no credits"],
    ["Beyond Fomo", "No", "pump.fun Pulse, holders, candles, quotes, AI reads, any wallet"],
  ], "cmp")}
${NOT_AFFILIATED("Fomo (Fomo Labs)")}`,
  faq: [
    ["Does Fomo have an API?", `Official API access was not verified on the Fomo homepage reviewed; check directly with Fomo for current developer options.`],
    ["Is fomoapi.io official?", `No. It describes itself as an independent, unofficial tool not affiliated with fomo.family. Check its current plans directly.`],
    ["How can I see what Fomo traders are buying for free?", `Create a BLIX account: the Fomo tab in the terminal and <code>GET /api/fomo</code> show what Fomo's traders are buying, sampled from the swaps Fomo sponsors, and the Top traders board ranks them by profit.`],
    ["Can I trade on Fomo through an API?", `Fomo publishes no trading API. BLIX trades every coin in one click from the chart with a real Jupiter route, take profit and stops, so a Fomo trader's buy can become your trade without leaving BLIX.`],
    ["Is Blix affiliated with Fomo?", `No. BLIX is independent and not affiliated with Fomo.`],
  ],
};

// ---------- /pump-fun-api ----------
const pump = {
  path: "/pump-fun-api", crumb: "pump.fun API", og: "og-pump.png",
  title: "Free pump.fun API: Launches, Trades, Holders, No Key (2026)",
  ogTitle: "Free pump.fun API: launches, trades, holders",
  description: "A pump.fun data API with a free BLIX account: every launch, trade, bonding progress, migrations, holders with snipers and bundles, candles and a live stream.",
  eyebrow: "pump.fun API · checked " + UPDATED_TEXT,
  h1: "Free pump.fun API",
  lede: `This page describes BLIX and PumpPortal integrations, not an official pump.fun API. PumpPortal's launch and migration streams are free, but its trade streams need an API key, a funded wallet and 0.01 SOL per 10,000 trades. <a href="/api">BLIX</a> is the alternative that comes with a free account: new coins from PumpPortal's free stream with an on-chain backup, every trade decoded straight from Solana, plus bonding progress, migrations, holders, snipers, bundles and candles as JSON and a live stream, authorized by your session.`,
  related: ["/pump-fun-trading-api", "/trade-api", "/api", "/mcp", "/gmgn-api", "/axiom-api"],
  body: `${cta(`<a class="btn" href="/api#stream">See the live stream</a>`)}
${facts([
    ["Launches", "Every pump.fun launch, coverage and delay depend on upstream feeds and connectivity"],
    ["Trades", "Decoded from pump.fun program logs; throughput depends on market activity and upstream coverage"],
    ["Bonding curve", "Progress, market cap and final stretch, live"],
    ["Migrations", "Graduations, then Jupiter prices every 2 seconds"],
    ["Holders", "Dev, snipers, bundles, top 10, who sold"],
    ["Access", "Included with a free BLIX account; your session is the key"],
  ])}
<h2 id="quick-start">Quick start</h2>
${INSTALL}
${code(`# every new pump.fun coin as it launches
curl -sN ${BASE}/api/stream -H "${SESSION_H}" | grep --line-buffered -A1 "event: launch"

# coins closest to bonding, with live progress
curl -s ${BASE}/api/pulse -H "${SESSION_H}" | jq '.stretch[] | {symbol, progress, mcap}'`, "bash")}

<h2 id="data">pump.fun data you get</h2>
${table(["Data", "Endpoint"], [
    ["New launches (name, symbol, mint, dev, metadata URI)", "<code>launch</code> events on <code>GET /api/stream</code>"],
    ["Live market cap, buys, sells, traders, bonding progress", "<code>live</code> events, and <code>GET /api/pulse</code>"],
    ["New pairs, final stretch, migrated, running", "<code>GET /api/pulse</code>"],
    ["Graduations", "<code>mig</code> events on the stream"],
    ["Holders, dev, snipers, bundles", "<code>GET /api/holders/&lt;mint&gt;</code>"],
    ["Candles from real trades (5s to 1h)", "<code>GET /api/candles/&lt;mint&gt;</code>"],
    ["Buy and sell quotes", "<code>GET /api/quote</code>"],
    ["Safety: mint and freeze authority, LP, dev's other launches", "<code>GET /api/token/&lt;mint&gt;</code>"],
  ])}

<h2 id="how">How Blix reads pump.fun</h2>
<p>BLIX subscribes to the pump.fun program's logs over a Solana RPC websocket and decodes the program's Anchor events itself:</p>
<ul>
<li><b>TradeEvent</b> (discriminator <code>bddb7fd34ee661ee</code>): mint, SOL amount, token amount, buy or sell, trader, timestamp, then the virtual and real reserves after the trade.</li>
<li><b>CreateEvent</b> (discriminator <code>1b72a94ddeeb6376</code>): name, symbol, metadata URI, mint, bonding curve and creator. This is the backup for launches PumpPortal's stream misses.</li>
</ul>
<p>From each trade: market cap in SOL is <code>virtualSolReserves / virtualTokenReserves × 1,000,000,000</code> (one billion supply), and bonding progress is <code>1 − realTokenReserves / 793,100,000</code>, the tokens sold along the curve before it completes. Holders are a running ledger of every wallet's balance; a wallet that first bought in the same block as the first trade is a bundle, and one that bought within 2 blocks of it is a sniper.</p>

<h2 id="compare">pump.fun API options compared</h2>
${table(["", "Key", "Cost", "Notes"], [
    ["Blix", "Your account session", "Free with a BLIX account", "Launches, trades, holders, candles, quotes, AI reads and an MCP connector; nothing to host"],
    [ext("https://pumpportal.fun/fees/", "PumpPortal"), "Required for trade streams", "Launch and migration streams free; trades 0.01 SOL per 10,000; trading API 0.5% (local) or 1% (Lightning) a trade", "Hosted websocket; the trading API builds and sends transactions"],
    ["Indexers (Bitquery, Moralis, Codex, others)", "Required", "Usually a free tier with limits, then paid plans", "Hosted, multi-chain, historical queries"],
  ], "cmp")}
<p>Indexers win on deep history and other chains. BLIX wins on pump.fun from the first trade, holders with snipers and bundles, AI reads and an MCP connector, with one free account and nothing to host.</p>
${NOT_AFFILIATED("pump.fun or PumpPortal")}`,
  faq: [
    ["Does pump.fun have an official API?", `This guide does not verify an official public pump.fun data API. Website endpoints should not be treated as a stable developer contract. Third parties such as PumpPortal and the indexers fill the gap; Blix reads the chain directly.`],
    ["Is PumpPortal free?", `Its documentation lists free new-token and migration streams and metered trade streams. Token/account trade streams require a funded linked wallet and API key. Transaction and network fees are separate; check the linked PumpPortal fee schedule for current amounts.`],
    ["How do I find new pump.fun tokens in BLIX?", `Create a BLIX account and open the Pulse: New pairs lists every launch about a second after the chain. The same rows are <code>GET /api/pulse</code> and <code>launch</code> events on the stream.`],
    ["How is pump.fun bonding curve progress calculated?", `1 − realTokenReserves / 793,100,000. The curve completes when the 793.1 million tokens sold along it are gone; Blix reads the real reserves from every trade.`],
    ["How do you detect snipers and bundles on pump.fun?", `From the first trade onward: a wallet whose first buy is in the same block as the coin's first trade is a bundle, one within 2 blocks is a sniper. Coins first seen mid-life are marked partial instead of guessed.`],
    ["Is Blix affiliated with pump.fun?", `No. BLIX is independent and not affiliated with pump.fun or PumpPortal.`],
  ],
};


// ---------- pages for traders (the terminal itself, not the API) ----------
// Each says only what the terminal at /app does today (the landing's features); the button goes to sign-up.
const START = () => `<div class="cta"><a class="btn primary" href="/start">Start trading free</a><a class="btn" href="/">See BLIX</a></div>`;

const tracker = {
  path: "/pump-fun-tracker", crumb: "pump.fun tracker", og: "home/og.jpg",
  title: "pump.fun Tracker: Live New Pairs, Bonding & Migrations (Free) | BLIX",
  ogTitle: "BLIX: a free live pump.fun tracker",
  description: "Free live pump.fun tracker: new launches, bonding curve progress, final stretch and migrations, holders, snipers and bundles, with AI ratings. Sign in with Google.",
  eyebrow: "pump.fun tracker · updated " + UPDATED_TEXT,
  h1: "Live pump.fun tracker",
  lede: `BLIX follows observed pump.fun launches through the connected feeds: market cap, buys and sells, bonding curve progress, the final stretch before migration, and the move to PumpSwap. Where data is available, inspect a rating, research and holder breakdown. These are risk indicators, not proof that a coin is safe or profitable. It is free and runs in your browser: sign in with Google and it is on screen.`,
  related: ["/solana-memecoin-screener", "/memecoin-paper-trading", "/pump-fun-api"],
  body: `${START()}
${facts([
    ["New pairs", "Observed pump.fun launches; latency and completeness depend on connected feeds"],
    ["Final stretch", "Coins closest to completing the bonding curve, with live progress"],
    ["Migrated", "Coins that graduated, priced live after the move"],
    ["Holders", "Dev, snipers, bundles, top 10 and who already sold"],
    ["AI", "A live rating per coin and one-click research"],
    ["Cost", "Free; paper trading to practise"],
  ])}
<h2 id="pulse">Pulse: the whole pump.fun lifecycle on one screen</h2>
<p>The Pulse board splits pump.fun into the stages that matter for a trade. <b>New pairs</b> lists coins seconds after launch. <b>Final stretch</b> holds the ones close to finishing the bonding curve, where most of the volume arrives. <b>Migrated</b> shows coins that graduated and keep trading. Every row updates live from the chain: market cap, volume, buys and sells, holders and age, with the coin's picture and links to its X, Telegram and website.</p>
<h2 id="safety">Inspect risk before you buy</h2>
<ul>
<li><b>Dev history:</b> how many coins the creator launched before and how they ended.</li>
<li><b>Snipers and bundles:</b> wallets that bought in the first blocks, and how much they still hold.</li>
<li><b>Top 10 share:</b> how concentrated the supply is.</li>
<li><b>Live rating:</b> built from liquidity, holders, volume and risk signals, updated as the coin trades.</li>
</ul>
<h2 id="follow">The wallets and accounts that move coins</h2>
<p>BLIX follows the top traders and the smart wallets it finds from the chain, so their buys and sells land as signals with each wallet's record, and it watches the X accounts that call memecoins: when they post a ticker or contract address it appears next to the chart. The live feed brings pump.fun callouts and big Fomo trades into one list.</p>
<h2 id="practise">Practise first with paper trading</h2>
<p>Simulate supported coins with paper SOL using available quotes and estimates, with take profit, stop loss and trailing stop, and see your profit move with the coin. Nothing is sent to the chain. <a href="/memecoin-paper-trading">How paper trading works</a>.</p>
${START()}
${NOT_AFFILIATED("pump.fun")}`,
  faq: [
    ["Is there a free pump.fun tracker?", `Yes. BLIX is free: sign in with Google and the live board of new pairs, final stretch and migrated coins is on screen, with holders, snipers and AI research where available.`],
    ["How do I see new pump.fun coins as they launch?", `Open BLIX and inspect New pairs. Arrival and completeness depend on the feed and connection; refresh and check data freshness before relying on a row.`],
    ["What is the pump.fun final stretch?", `The coins closest to completing their bonding curve. When the curve completes the coin migrates and trades on a regular pool; BLIX shows the progress live for each coin.`],
    ["How do I check a pump.fun coin for snipers and bundles?", `Open the coin in BLIX: the holder panel shows the dev, wallets that bought in the first blocks (snipers and bundles), the top 10 share, and who has already sold.`],
    ["Can I practise without risking SOL?", `Paper trading simulates fills and costs without sending transactions. It does not establish what a funded trade would return.`],
  ],
};

const screener = {
  path: "/solana-memecoin-screener", crumb: "Memecoin screener", og: "home/og.jpg",
  title: "Solana Memecoin Screener with AI Ratings & Narratives (Free) | BLIX",
  ogTitle: "BLIX: a free Solana memecoin screener with AI ratings",
  description: "Solana memecoin screener: trending, surging and new coins with live AI ratings, narratives, holder and rug checks, wallet and X tracking. Free, sign in with Google.",
  eyebrow: "Memecoin screener · updated " + UPDATED_TEXT,
  h1: "Solana memecoin screener with AI",
  lede: `Thousands of memecoins launch on Solana every day. BLIX narrows them down: trending and surging coins, new pairs, AI ratings that update as each coin trades, daily AI picks with the reasons behind them, and narrative tracking that shows which stories (AI agents, cats, political coins and the rest) are heating up and which coins ride them. Free, in the browser, sign in with Google.`,
  related: ["/pump-fun-tracker", "/memecoin-paper-trading", "/api"],
  body: `${START()}
${facts([
    ["Lists", "Trending, Surge, New pairs and Bonded"],
    ["AI ratings", "Available ratings based on observed liquidity, holders, volume and risk"],
    ["Daily picks", "A short list each day, with why"],
    ["Narratives", "Which stories are heating up, and their coins"],
    ["Research", "One click: dev history, holders, socials, red flags"],
    ["Cost", "Free"],
  ])}
<h2 id="discover">Discover: what is moving right now</h2>
<p>Discover sorts Solana memecoins into <b>Trending</b>, <b>Surge</b> (coins accelerating in the last minutes), <b>New pairs</b> and <b>Bonded</b>. Each row shows market cap, change, volume and holders, with the coin's live rating, and opens straight into its chart.</p>
<h2 id="ai">AI ratings, picks and research</h2>
<p>Available AI ratings interpret observed market activity and risk signals. Research can cover creator history, holder concentration, social context and the token's narrative. Coverage and freshness vary; a token may have no completed read. Check the timestamp and evidence before treating a model conclusion as relevant to the current market.</p>
<h2 id="narratives">Narrative tracking</h2>
<p>Memecoins move in themes. BLIX groups coins by the story they ride and tracks which stories are gaining, so you can see a narrative heat up and find its leading coins early.</p>
<h2 id="tracking">Wallets, X accounts and live feed</h2>
<p>Top traders' and smart wallets' buys arrive as signals, the X accounts that call coins are watched for you, and one live feed carries pump.fun callouts and big Fomo trades with each position's profit moving as the coin trades.</p>
${START()}`,
  faq: [
    ["How should I compare Solana memecoin screeners?", `Test the same token addresses and observation windows. Compare data freshness, missing values, filtering, holder definitions and quote availability. BLIX combines discovery with available AI research and wallet context; no measured best-in-category claim is made here.`],
    ["How are BLIX's AI ratings made?", `From each coin's live liquidity, holders, volume and risk signals (dev history, snipers, bundles, supply concentration). The rating changes as the coin trades.`],
    ["What are memecoin narratives?", `The themes coins trade on, such as AI agents, animals or politics. BLIX groups coins by narrative and shows which narratives are gaining attention.`],
    ["Do I need a wallet to use it?", `No. Sign in with Google to browse, rate and paper trade. Nothing touches your funds.`],
  ],
};

const paperPage = {
  path: "/memecoin-paper-trading", crumb: "Paper trading", og: "home/og.jpg",
  title: "Memecoin Paper Trading on Solana: Simulated Fills | BLIX",
  ogTitle: "BLIX: free memecoin paper trading on Solana",
  description: "Paper trade Solana and pump.fun memecoins free: quote-based fills, take profit, stop loss and trailing stop, live profit. Nothing is sent to the chain.",
  eyebrow: "Paper trading · updated " + UPDATED_TEXT,
  h1: "Memecoin paper trading on Solana",
  lede: `Practise trading memecoins without risking SOL. BLIX's paper desk uses quotes, curve calculations or pool estimates to simulate fills and costs, and tracks the position as observed prices change. Paper results can differ from live execution. Set take profit, stop loss or a trailing stop and BLIX closes the position for you. No wallet, no transaction, nothing on chain: sign in with Google and start with paper SOL.`,
  related: ["/pump-fun-tracker", "/solana-memecoin-screener"],
  body: `${START()}
${facts([
    ["Prices", "Quotes, curve calculations or pool estimates"],
    ["Costs", "Simulated costs; actual execution can differ"],
    ["Exits", "Take profit, stop loss, trailing stop, partial sells"],
    ["Coins", "Supported Solana coins with usable data"],
    ["Risk", "None: nothing is ever sent to the chain"],
    ["Cost", "Free"],
  ])}
<h2 id="how">How it works</h2>
<ol>
<li>Sign in with Google: your paper desk opens with paper SOL.</li>
<li>Find a coin on Pulse or Discover and buy with a size you set once.</li>
<li>Add a take profit, stop loss or trailing stop, or sell part or all by hand.</li>
<li>Watch the position's profit move live, and review closed trades and your record.</li>
</ol>
<h2 id="why">Why paper trade memecoins first</h2>
<p>Memecoins can change price rapidly or lose liquidity. Paper trading lets you test an entry rule, a take profit or a stop on live coins and see what it would have done, under explicit simulated price and cost assumptions, before any SOL is at stake.</p>
${START()}`,
  faq: [
    ["Is memecoin paper trading free?", `Yes. Sign in with Google and the paper desk is ready; there is nothing to pay and no wallet to connect.`],
    ["Are paper trade prices realistic?", `The paper desk uses quotes, curve calculations or pool estimates depending on the route and available data. Simulated costs and fills cannot reproduce every live execution condition, including slippage, latency and failed transactions. Paper results are not a forecast of live returns.`],
    ["Can I set a stop loss on a paper trade?", `Yes: take profit, stop loss and trailing stop on every position, and partial sells.`],
    ["Is anything sent to the blockchain?", `No. Paper trades exist only in BLIX; no transaction is ever signed or sent.`],
  ],
};

const entries = [api, mcp, pump, gmgn, axiom, fomo, tracker, screener, paperPage, ...FEATURE_PAGES, ...COMPARISON_PAGES, ...COMPETITOR_GUIDES, ...Object.values(LEARNING_PAGES), ...EDITORIAL_PAGES];
for (const p of entries) p.updated ||= "2026-10-10";
const topicPages = new Map([...entries, ...KEYWORD_PAGES].map(p => [p.path, p]));
const topicNavigation = TOPIC_CLUSTERS.map(topic => `<h2 id="${topic.id}">${esc(topic.title)}</h2><p>${esc(topic.description)}</p><div class="related">${topic.pages.map(path => {
  const p = topicPages.get(path);
  if (!p) throw new Error(`Topic navigation points to missing page: ${path}`);
  return `<a href="${p.path}"><b>${esc(p.h1)}</b><span>${esc(p.description)}</span></a>`;
}).join("")}</div>`).join("");
const guides = {
  path: "/guides", crumb: "Guides", og: "og-api.png", updated: "2026-10-10", topic: "guides",
  title: "BLIX Guides: Solana Trading, Wallet Research, APIs & MCP",
  description: "Learn BLIX workflows for Solana discovery, wallet research, risk checks, paper trading, token launches and developer integrations. Read sourced platform comparisons.",
  h1: "A guide for each part of your research",
  eyebrow: "BLIX field guide",
  lede: "Start with the question you need to answer. Each guide explains the workflow, the data it uses and the limits to check before you act.",
  body: `${topicNavigation}
<h2>How these guides are maintained</h2><p>BLIX publishes its own product documentation. Read <a href="/about">about BLIX and its editorial standards</a>. Sources and limitations accompany the guides; dates describe content updates, not guaranteed real-time verification. Join the <a href="https://discord.gg/3VWHBP6paA" target="_blank" rel="noopener noreferrer">BLIX Discord</a> to discuss the guides.</p>`,
};
export const PAGES = Object.fromEntries([...entries, guides, ...KEYWORD_PAGES].filter(p => !PAGE_ALIASES[p.path]).map((p) => [p.path, p]));
// A page whose body is a function of the registry (the /tools hub lists every page) is rendered once it exists.
for (const p of Object.values(PAGES)) if (typeof p.body === "function") p.body = p.body(PAGES);
// Registry owns both routing and related cards: adding a page cannot orphan it
// from the sitemap or make its related link silently disappear.
for (const p of Object.values(PAGES)) PAGE_CARDS[p.path] = [p.h1, p.description, p.path];
export const render = (path) => layout(PAGES[path]);
