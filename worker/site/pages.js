// The public pages on trade.blixvip.com. The endpoint list and the MCP tool list are the same modules
// the app's own API and MCP pages read (public/api-docs.js, public/mcp-tools.js), so these cannot drift.
// Third-party facts carry the date they were checked (UPDATED in html.js) and link to their source.
import { API_DOCS, API_EVENTS } from "../../public/api-docs.js";
import { MCP_TOOLS } from "../../public/mcp-tools.js";
import { REPO, UPDATED_TEXT, esc, code, table, facts, ext, layout } from "./html.js";

const N_ENDPOINTS = API_DOCS.reduce((a, [, rows]) => a + rows.length, 0);
const N_TOOLS = MCP_TOOLS.length;
const BASE = "http://localhost:4420";
const MCP_SCRIPT = "/path/to/blixtrade/mcp/blix-mcp.mjs";
const NOT_AFFILIATED = (who) => `<p class="note">Blix is independent and not affiliated with ${who}. Facts about ${who} were checked against public sources on ${UPDATED_TEXT}.</p>`;

const INSTALL = code(`git clone ${REPO}.git
cd blixtrade
npm start
# dashboard and API on ${BASE}`, "bash");

const cta = (secondary) => `<div class="cta"><a class="btn primary" href="${REPO}" rel="noopener">Get Blix on GitHub</a>${secondary}</div>
<p class="meta">Free and open source (MIT) · Node 24.16+ · Windows, macOS, Linux · Updated ${UPDATED_TEXT}</p>`;

const refTables = () => API_DOCS.map(([group, rows]) => `<h3>${esc(group)}</h3>${table(["Method", "Path", "Returns"], rows.map(([m, p, d]) => [esc(m), `<code>${esc(p)}</code>`, esc(d)]), "ref")}`).join("");
const eventsTable = () => table(["Event", "Payload", "When"], API_EVENTS.map(([e, p, w]) => [`<code>${esc(e)}</code>`, esc(p), esc(w)]));
const toolArgs = (t) => Object.keys(t.props || {}).map((k) => `<code>${esc(k)}${(t.required || []).includes(k) ? "" : "?"}</code>`).join(" ") || `<span class="note">none</span>`;

const STREAM_JS = code(`const es = new EventSource("${BASE}/api/stream");
es.addEventListener("launch", (e) => {
  const coin = JSON.parse(e.data);            // { mint, name, symbol, dev, uri, ... }
  console.log("new pump.fun coin", coin.symbol, coin.mint);
});
es.addEventListener("signal", (e) => console.log(JSON.parse(e.data)));`, "javascript");
const STREAM_PY = code(`import json, requests  # pip install requests

with requests.get("${BASE}/api/stream", stream=True) as r:
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
  title: "Free Solana API for Memecoins & pump.fun (No Key) | Blix",
  ogTitle: "Blix: the free Solana API for memecoins and pump.fun",
  description: "Free Solana API for memecoins: every pump.fun launch, live trades, holders, snipers, bundles, candles and Jupiter quotes. Open source, no API key, no credits.",
  eyebrow: `Blix API · ${N_ENDPOINTS} endpoints · free`,
  h1: "Free Solana API for memecoins",
  lede: `Blix is an open-source memecoin terminal that runs on your own machine and serves everything it sees as JSON: every pump.fun launch within about a second, every trade decoded straight from Solana, holder ledgers with dev, sniper and bundle shares, 5-second candles, real Jupiter quotes, safety checks and AI reads. ${N_ENDPOINTS} endpoints and one live event stream, with <b>no API key, no credits and no rate card</b>.`,
  related: ["/mcp", "/pump-fun-api", "/gmgn-api", "/axiom-api", "/fomo-api"],
  body: `${cta(`<a class="btn" href="/mcp">Connect an AI client (MCP)</a>`)}
${facts([
    ["Price", "Free, open source (MIT)"],
    ["API key", "None on your machine"],
    ["Transport", "HTTP + JSON, and one Server-Sent Events stream"],
    ["Chain", "Solana: pump.fun launches, bonding curve, migrations, plus DexScreener and GeckoTerminal pairs"],
    ["Speed", "Launches about a second after the chain; live prices several times a second"],
    ["Trading", "Paper desk at real Jupiter quotes. Blix never signs a transaction."],
  ])}
<h2 id="quick-start">Quick start</h2>
<p>You need Node 24.16 or newer. There is nothing else to install: Blix has no dependencies.</p>
${INSTALL}
${code(`curl ${BASE}/api/pulse`, "bash")}
<p>Launches start arriving within seconds. Holder ledgers, candles and AI reads fill in as coins trade. Everything optional (a faster RPC, Discord or Telegram alerts, your Claude or Grok login for AI reads) is set on the dashboard's Settings page, never in code.</p>

<h2 id="build">What you can build with it</h2>
<ul>
<li><b>A new-pairs bot</b> for Telegram or Discord that skips coins with heavy bundles, early snipers or a dev who already sold.</li>
<li><b>Copy-trade alerts.</b> Follow any Solana wallet and get its buys and sells from the chain, with realized, open and sellable PnL kept apart.</li>
<li><b>An AI agent</b> that reads the market, explains a coin and paper-trades its own calls, through the <a href="/mcp">Blix MCP server</a>.</li>
<li><b>Your own Axiom- or GMGN-style front end</b> on top of <code>/api/pulse</code> and the live stream.</li>
<li><b>Backtests</b> of entry and exit rules on recorded trade tapes.</li>
</ul>

<h2 id="stream">Live stream</h2>
<p><code>GET /api/stream</code> is a Server-Sent Events stream. One connection carries new launches, live prices, migrations, signals and paper fills, so a bot never has to poll.</p>
${eventsTable()}
${code(`curl -N ${BASE}/api/stream`, "bash")}
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
<p><code>GET /api/candles/&lt;mint&gt;?tf=1m</code> returns market-cap candles built from real trades (5s, 15s, 1m, 5m, 15m, 1h) with buy and sell counts, and falls back to GeckoTerminal for older history. <code>GET /api/quote</code> returns a real Jupiter quote for a buy or a sell: amount out, price impact and route. Nothing is traded.</p>
${code(`curl "${BASE}/api/candles/<mint>?tf=1m"
curl "${BASE}/api/quote?mint=<mint>&side=buy&amount=0.5&slip=300"`, "bash")}

<h2 id="endpoints">All ${N_ENDPOINTS} endpoints</h2>
<p>Paths are relative to <code>${BASE}</code>. Errors are JSON <code>{ "error": "…" }</code> with a 4xx or 5xx status. Responses are cached for 1 to 60 seconds, so polling faster returns the same body; use the stream for anything live. The long-form reference is <a href="${REPO}/blob/main/docs/API.md" rel="noopener">docs/API.md</a>.</p>
${refTables()}

<h2 id="compare">Blix API vs GMGN, Axiom, Fomo and PumpPortal</h2>
<p>What each option gives a developer today, checked on ${UPDATED_TEXT}. Each name links to the details and sources.</p>
${table(["", "Public API", "Key", "Cost", "Real trading"], [
    ["Blix", "Open source, runs on your machine", "None", "Free (MIT)", "No. Paper desk at real quotes"],
    [`<a href="/gmgn-api">GMGN</a>`, "Yes, the GMGN OpenAPI", "Apply at gmgn.ai/ai with an Ed25519 public key", "Not published in its docs", "Yes. Swaps need your private key and an IP whitelist"],
    [`<a href="/axiom-api">Axiom Trade</a>`, "None published", "Unofficial SDKs sign in as your account", "Not applicable", "Only through unofficial SDKs"],
    [`<a href="/fomo-api">Fomo</a>`, "None published", "Third-party APIs use their own key", "fomoapi.io: 250,000 free credits a month, paid from $49.99", "No"],
    [`<a href="/pump-fun-api">PumpPortal</a>`, "Third-party pump.fun API", "Required for trade streams", "Launch and migration streams free; trades 0.01 SOL per 10,000", "Yes, 0.5% (local) or 1% (Lightning) a trade"],
  ], "cmp")}
<p>Pick GMGN's API if you need execution or chains beyond Solana. Pick Blix if you want Solana memecoin data with nothing to sign up for, code you can read and change, and AI reads on top.</p>`,
  faq: [
    ["Is the Blix API free?", `Yes. Blix is open source under the MIT licence and runs on your own machine, so there is no key, no credit system and no rate card. Your only costs are optional: a free-tier Helius RPC makes wallet tracking about ten times faster, and AI reads use your own Claude or Grok login.`],
    ["Do I need an API key?", `No. On your machine every endpoint is open to local scripts. If you turn on the optional remote link (a Cloudflare tunnel to your own install), a per-install key kept in a cookie protects it.`],
    ["Is this the official GMGN or Axiom API?", `No. Blix is independent and not affiliated with GMGN, Axiom Trade, Fomo or pump.fun. GMGN has its own official API (see <a href="/gmgn-api">GMGN API</a>); Axiom Trade and Fomo publish none (see <a href="/axiom-api">Axiom API</a> and <a href="/fomo-api">Fomo API</a>). Blix gives you the same kind of memecoin data without an account.`],
    ["Where does the data come from?", `New pump.fun coins come from PumpPortal's free launch stream with an on-chain backup for any it misses. Trades are decoded straight from Solana program logs over RPC. Prices for graduated coins come from Jupiter, pairs from DexScreener and GeckoTerminal, safety reports from RugCheck. Holders, snipers and bundles are computed by Blix from the trades it sees.`],
    ["How fast is it?", `New launches arrive about a second after they land on chain, often less. Live market caps, buys, sells and bonding progress are pushed over the stream several times a second. Roughly 2,000 pump.fun launches an hour and 50 to 80 trades a second flow through a normal day.`],
    ["Can I trade through the Blix API?", `Not with real money. Blix never signs a transaction and never touches your keys. It has a paper desk that fills at real Jupiter quotes with slippage, take-profit, stop and trailing rules, and every coin carries a Buy on Fomo link.`],
    ["Which chains does it cover?", `Solana. pump.fun launches, the bonding curve and migrations get the deepest coverage; other Solana pairs come in through DexScreener and GeckoTerminal.`],
    ["Can an AI agent use it?", `Yes. The <a href="/mcp">Blix MCP server</a> turns the API into ${N_TOOLS} tools for Claude, Cursor, Codex and any other MCP client.`],
  ],
};

// ---------- /mcp ----------
const SETUP = [
  ["Claude Code", "Run once in a terminal.", code(`claude mcp add blix -- node ${MCP_SCRIPT}`, "bash")],
  ["Claude Desktop and Cursor", "Add to claude_desktop_config.json or ~/.cursor/mcp.json.", code(JSON.stringify({ mcpServers: { blix: { command: "node", args: [MCP_SCRIPT] } } }, null, 2), "json")],
  ["Codex", "Add to ~/.codex/config.toml.", code(`[mcp_servers.blix]\ncommand = "node"\nargs = ["${MCP_SCRIPT}"]`, "toml")],
  ["VS Code", "Add to .vscode/mcp.json.", code(JSON.stringify({ servers: { blix: { type: "stdio", command: "node", args: [MCP_SCRIPT] } } }, null, 2), "json")],
];
const mcp = {
  path: "/mcp", crumb: "MCP", og: "og-mcp.png",
  title: "Solana MCP Server for Claude, Cursor & Codex (Free) | Blix",
  ogTitle: "Blix: the free Solana MCP server for memecoin data",
  description: `Free Solana MCP server: give Claude, Cursor or Codex live memecoin data, pump.fun launches, holders, snipers, bundles, candles and Jupiter quotes. ${N_TOOLS} tools.`,
  eyebrow: `Blix MCP · ${N_TOOLS} tools · free`,
  h1: "Solana MCP server for memecoin data",
  lede: `Blix MCP turns the <a href="/api">Blix API</a> into ${N_TOOLS} tools an AI client can call. Ask Claude what is running on pump.fun right now, who holds a coin and whether the dev sold, or have it paper-trade a call. It is free, open source and has no dependencies, and it <b>reads only, plus a paper-money desk</b>: nothing it does can spend real funds.`,
  related: ["/api", "/pump-fun-api", "/gmgn-api", "/axiom-api"],
  body: `${cta(`<a class="btn" href="/api">See the API</a>`)}
${facts([
    ["Tools", `${N_TOOLS}, from market snapshot to paper trades`],
    ["Transport", "stdio (JSON-RPC 2.0), no dependencies"],
    ["Clients", "Claude Code, Claude Desktop, Cursor, Codex, VS Code, any stdio MCP client"],
    ["Key", "None"],
    ["Writes", "Paper desk only. No wallet, no signing."],
    ["Needs", "Blix running on the same machine (or BLIX_URL)"],
  ])}
<h2 id="setup">Set it up in two steps</h2>
<h3>1. Run Blix</h3>
${INSTALL}
<h3>2. Add the server to your client</h3>
<p>Use the folder you cloned in place of <code>/path/to/blixtrade</code>. On Windows that looks like <code>C:\\\\Users\\\\you\\\\blixtrade\\\\mcp\\\\blix-mcp.mjs</code> inside JSON.</p>
${SETUP.map(([name, how, block]) => `<h3>${name}</h3><p>${how}</p>${block}`).join("")}
<p>Running Blix on another port or machine? Set <code>BLIX_URL</code> (for example <code>http://localhost:4421</code>) in the client's environment for this server.</p>

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
<p>The server is one file, <code>mcp/blix-mcp.mjs</code>. Your client starts it over stdio; it answers <code>initialize</code>, <code>tools/list</code> and <code>tools/call</code>, and turns each call into an HTTP request to Blix on <code>localhost:4420</code>. Tools that only read are marked read-only to the client; the two paper-desk tools are not. The tool list is one module shared with Blix's own MCP page, so the docs cannot drift from what the server offers.</p>

<h2 id="compare">How it compares</h2>
${table(["", "Key", "Data", "Real trades"], [
    ["Blix MCP", "None", "pump.fun launches, live trades, holders with snipers and bundles, candles, quotes, AI reads, signals, narratives, wallets, track record", "No (paper desk)"],
    [`<a href="/gmgn-api">GMGN agent skills</a>`, "GMGN API key", "GMGN token, market, wallet and trending data", "Yes, with your private key and an IP whitelist"],
    ["Community pump.fun MCP servers", "Varies", "Usually token lookups and bonding-curve reads", "Some can buy and sell with a private key you supply"],
  ], "cmp")}`,
  faq: [
    ["Is there a GMGN MCP server?", `GMGN publishes "skills" for AI agents on top of its OpenAPI (github.com/GMGNAI/gmgn-skills); they need a GMGN API key, and trading needs your private key. Blix MCP needs no key and cannot trade with real money. See <a href="/gmgn-api">GMGN API</a>.`],
    ["Is there an Axiom Trade MCP server?", `Axiom Trade does not publish an API or an MCP server. Most "Axiom MCP" results are about Axiom (axiom.co), an unrelated logging company. Blix MCP gives an AI client the same kind of data Axiom's Pulse shows.`],
    ["Can the AI trade real money with it?", `No. The only write tools are blix_paper_buy and blix_paper_sell, and they use paper money filled at real Jupiter quotes. There is no wallet, no key and no signing anywhere in Blix.`],
    ["Which MCP clients does it work with?", `Any client that can start a local (stdio) server: Claude Code, Claude Desktop, Cursor, Codex, VS Code, Windsurf, Zed and others. Clients that only accept remote (HTTPS) servers cannot start it.`],
    ["Does Blix have to be running?", `Yes. The MCP server is a thin bridge to Blix's API on your machine. If Blix is not running, every tool answers "Blix is not answering" instead of hanging.`],
    ["Is it free?", `Yes. Blix and its MCP server are open source under the MIT licence. AI reads inside Blix use your own Claude or Grok login; the MCP server itself calls no paid service.`],
  ],
};

// ---------- /gmgn-api ----------
const gmgn = {
  path: "/gmgn-api", crumb: "GMGN API", og: "og-gmgn.png",
  title: "GMGN API: Access, Limits and a Free No-Key Alternative (2026)",
  ogTitle: "GMGN API: how to get access, and a free alternative",
  description: "How to get a GMGN API key in 2026 (Ed25519 key, IP whitelist for swaps), what it covers, and Blix: a free, open-source memecoin API with no key.",
  eyebrow: "GMGN API · checked " + UPDATED_TEXT,
  h1: "GMGN API: how to get access, and a free alternative",
  lede: `GMGN has an official API, the GMGN OpenAPI. You get a key at gmgn.ai/ai by uploading an Ed25519 public key; every request carries that key, and swaps also need the matching private key and an IP whitelist. GMGN's docs do not publish prices or rate limits. If what you need is Solana memecoin data (new pump.fun pairs, holders, snipers, bundles, candles, quotes), <a href="/api">Blix</a> gives you that free, with no key, from an open-source server on your own machine.`,
  related: ["/api", "/mcp", "/axiom-api", "/pump-fun-api"],
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
<p>Sources: ${ext("https://docs.gmgn.ai/index/gmgn-agent-api", "GMGN Agent API docs")}, ${ext("https://github.com/GMGNAI/gmgn-skills", "GMGNAI/gmgn-skills")}.</p>

<h2 id="key">How to get a GMGN API key</h2>
<ol>
<li>Generate an Ed25519 key pair on your machine (GMGN's docs suggest OpenSSL).</li>
<li>Go to ${ext("https://gmgn.ai/ai", "gmgn.ai/ai")}, upload the <b>public</b> key and create your API key.</li>
<li>Send the key with every request. For data, that is all.</li>
<li>For swaps, also configure the matching <b>private</b> key and whitelist the IP address your requests come from; GMGN rejects trading requests from other addresses.</li>
</ol>
<div class="callout"><p><b>Before you build on it:</b> as of ${UPDATED_TEXT}, GMGN's public docs list no prices, quotas or rate limits for the OpenAPI. They also list a separate data-crawling IP whitelist under GMGN's cooperation APIs. Scraping gmgn.ai's website instead of using the API is fragile.</p></div>

<h2 id="alternative">A free alternative for memecoin data: Blix</h2>
<p>Blix is an open-source Solana memecoin terminal with the same kind of data as JSON and a live stream. It runs on your machine, so there is no account, no key and no quota other than your own hardware.</p>
${INSTALL}
${table(["You want (GMGN)", "Blix endpoint", "Notes"], [
    ["New pairs, trending", "<code>GET /api/pulse</code>", "New pairs, Final stretch, Migrated and Running now, ranked by live traction"],
    ["Token info and security", "<code>GET /api/token/&lt;mint&gt;</code>", "Price history, RugCheck safety report, socials, signals, AI research"],
    ["Top holders", "<code>GET /api/holders/&lt;mint&gt;</code>", "Dev, sniper and bundle tags, top-10 share, who sold"],
    ["K-lines", "<code>GET /api/candles/&lt;mint&gt;?tf=1m</code>", "5s to 1h, built from real trades"],
    ["Wallet PnL", "<code>GET /api/wallet/&lt;address&gt;</code>", "Realized, open and sellable PnL, positions, linked wallets"],
    ["Swap", "<code>GET /api/quote</code>", "Real Jupiter quotes only. No execution; paper desk for testing"],
    ["Agent skills", `<a href="/mcp">Blix MCP</a>`, `${N_TOOLS} tools for Claude, Cursor, Codex`],
  ])}
${code(`# the newest pump.fun pairs, no key
curl ${BASE}/api/pulse

# a coin's holder ledger with dev / sniper / bundle tags
curl "${BASE}/api/holders/<mint>?top=25"`, "bash")}

<h2 id="which">GMGN API or Blix?</h2>
${table(["", "GMGN OpenAPI", "Blix"], [
    ["Access", "API key from gmgn.ai/ai", "None: clone and run"],
    ["Price and limits", "Not published", "Free, limited only by your machine and RPC"],
    ["Chains", "Solana, BSC, Base", "Solana"],
    ["Real trading", "Yes", "No (paper desk, Buy on Fomo links)"],
    ["Source code", "Closed", "Open (MIT)"],
    ["Where it runs", "GMGN's servers", "Your machine; data stays on your disk"],
  ], "cmp")}
<p>Use GMGN's API when you need execution through GMGN or chains beyond Solana. Use Blix when you want pump.fun depth, no sign-up, code you can change, and data that stays on your disk.</p>
${NOT_AFFILIATED("GMGN")}`,
  faq: [
    ["Does GMGN have an API?", `Yes. GMGN offers an official OpenAPI and agent skills. You need an API key from gmgn.ai/ai, created by uploading an Ed25519 public key.`],
    ["Is the GMGN API free?", `GMGN's public docs do not list prices or quotas as of ${UPDATED_TEXT}; check gmgn.ai/ai when you apply. Blix is free with no key.`],
    ["What are the GMGN API rate limits?", `GMGN does not publish them in its docs. Blix has no rate limit of its own; the only limits are your machine and the Solana RPC you use.`],
    ["Why are my GMGN swap requests rejected?", `Trading through the GMGN API needs the private key that matches the public key you uploaded, and the request must come from a whitelisted IP address.`],
    ["Can I get GMGN data without a key?", `Not from GMGN; its website is not a public API. Blix gives you the same kind of Solana memecoin data (new pairs, holders, snipers, bundles, candles) with no key.`],
    ["Is Blix affiliated with GMGN?", `No. Blix is independent open-source software.`],
  ],
};

// ---------- /axiom-api ----------
const axiom = {
  path: "/axiom-api", crumb: "Axiom API", og: "og-axiom.png",
  title: "Axiom Trade API: Is There One? Free Open-Source Alternative",
  ogTitle: "Axiom Trade API: is there one?",
  description: "Axiom Trade has no public developer API. What the unofficial SDKs do, their risks, and Blix: Axiom-style Pulse data as a free, open-source API with no key.",
  eyebrow: "Axiom Trade API · checked " + UPDATED_TEXT,
  h1: "Axiom Trade API: is there one?",
  lede: `No. Axiom Trade (axiom.trade) does not publish a public developer API, API keys or documentation. The "Axiom API" packages you will find are unofficial clients that sign in as your own Axiom account. If what you want is Axiom's Pulse (new pairs, final stretch, migrated) as data, <a href="/api">Blix</a> serves exactly that as JSON and a live stream, free and open source, with no account at all.`,
  related: ["/api", "/mcp", "/gmgn-api", "/pump-fun-api"],
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
  const p = await (await fetch("${BASE}/api/pulse")).json();
  const hot = p.stretch.filter((c) => (c.hl?.bd ?? 0) < 20).sort((a, b) => b.tr - a.tr).slice(0, 5);
  console.table(hot.map((c) => ({ symbol: c.symbol, mcap: Math.round(c.mcap), progress: c.progress, rank: c.tr })));
}, 2000);`, "javascript")}
${table(["You want (Axiom)", "Blix endpoint"], [
    ["Pulse columns", "<code>GET /api/pulse</code>, live updates on <code>GET /api/stream</code>"],
    ["Token page: chart, holders, dev", "<code>/api/candles/&lt;mint&gt;</code>, <code>/api/holders/&lt;mint&gt;</code>, <code>/api/token/&lt;mint&gt;</code>"],
    ["Wallet tracker", "<code>POST /api/wallets</code> to follow, <code>GET /api/wallet/&lt;address&gt;</code> for swaps and PnL"],
    ["Quotes before a trade", "<code>GET /api/quote</code> (real Jupiter quote)"],
    ["Filters and presets", "Run the same filters on the JSON yourself; the dashboard has P1 / P2 / P3 presets"],
  ])}

<h2 id="which">Unofficial SDK or Blix?</h2>
${table(["", "Unofficial Axiom SDKs", "Blix"], [
    ["Needs your Axiom login", "Yes", "No account at all"],
    ["Stability", "Breaks when Axiom changes", "Open source; you run the version you choose"],
    ["Real trading", "Yes, through your account", "No (paper desk at real quotes)"],
    ["Data", "Whatever Axiom's private endpoints return", "Pulse, holders, candles, quotes, safety, AI reads, wallets"],
    ["Cost", "Free packages; Axiom's trading fees apply", "Free"],
  ], "cmp")}
${NOT_AFFILIATED("Axiom Trade")}`,
  faq: [
    ["Does Axiom Trade have an API?", `No public one. Axiom Trade does not publish developer docs, API keys or an SDK. Third-party packages exist but are unofficial and sign in as your account.`],
    ["Is axiomtradeapi official?", `No. It is a community project that uses Axiom's private web endpoints with your session. Axiom does not support it.`],
    ["How do I get Axiom Pulse data programmatically?", `Run Blix and call <code>GET /api/pulse</code>: new pairs, final stretch, migrated and running coins with holders, snipers, bundles and the AI's call, plus a live event stream.`],
    ["Can I copy-trade Axiom wallets through an API?", `Any wallet on Axiom is an ordinary Solana wallet. Follow it in Blix with <code>POST /api/wallets</code> and its swaps arrive from the chain, with PnL. Blix alerts you; it does not place the trade.`],
    ["Is Blix affiliated with Axiom?", `No. Blix is independent open-source software.`],
  ],
};

// ---------- /fomo-api ----------
const fomo = {
  path: "/fomo-api", crumb: "Fomo API", og: "og-fomo.png",
  title: "Fomo API (fomo.family): Is There One? Free Alternative 2026",
  ogTitle: "Fomo API: is there an official one?",
  description: "fomo.family has no public developer API. Compare unofficial Fomo APIs (credits, pricing) with Blix: free, open-source tracking of Fomo traders from chain.",
  eyebrow: "Fomo API · checked " + UPDATED_TEXT,
  h1: "Fomo API: is there an official one?",
  lede: `No. Fomo (fomo.family, by Fomo Labs) does not publish a developer API, API keys or an SDK. Independent services sell unofficial access to Fomo traders' wallets, PnL and activity on credits. <a href="/api">Blix</a> takes a different route: Fomo traders' wallets are ordinary Solana wallets, so Blix follows them straight from the chain for free, and puts a Buy on Fomo link on every coin.`,
  related: ["/api", "/mcp", "/gmgn-api", "/axiom-api"],
  body: `${cta(`<a class="btn" href="/api#endpoints">See the Blix endpoints</a>`)}
<h2 id="unofficial">Unofficial Fomo APIs</h2>
<p>Several independent services resolve Fomo handles to wallets and resell the data. They describe themselves as unofficial and not affiliated with fomo.family.</p>
${table(["Service", "What it offers", "Cost"], [
    [ext("https://fomoapi.io", "fomoapi.io"), "REST and WebSocket: Fomo handles to Solana and EVM wallets, Fomo-reported PnL, holdings, leaderboards, theses, live activity", "Free plan 250,000 credits a month (about 1,000 calls); paid plans $49.99 to $599+ a month"],
    ["Other resellers", "Similar handle-to-wallet and activity feeds", "Usually credits or subscriptions"],
  ])}
<div class="callout"><p><b>Never give a "Fomo bot" your Fomo login.</b> Fomo wallets are non-custodial; a service holding your credentials can control your wallet. Reading public wallet activity never needs your login.</p></div>

<h2 id="blix">Track Fomo traders free with Blix</h2>
<ol>
<li><b>Follow their wallets.</b> Every Fomo trader has a Solana wallet address. Follow it with <code>POST /api/wallets</code> and Blix reads its swaps on every Solana DEX from the chain, with realized, open and sellable PnL kept apart.</li>
<li><b>Mark them as Fomo wallets.</b> <code>POST /api/fomo/trader</code> tags a wallet with its Fomo handle. Fomo pays its users' network fees, so Blix learns the account that sponsors those fees and samples the swaps it pays for: what Fomo traders are buying, flow per coin and the traders doing best. This part is experimental and needs at least one known Fomo wallet to start.</li>
<li><b>Buy on Fomo.</b> Every coin in Blix links to <code>fomo.family/tokens/solana/&lt;mint&gt;</code>, so a call becomes a trade in the Fomo app in one tap.</li>
</ol>
${INSTALL}
${code(`# follow a Fomo trader's Solana wallet and tag it with their handle
curl -X POST ${BASE}/api/wallets -H "content-type: application/json" -d '{"address":"<wallet>","label":"@handle"}'
curl -X POST ${BASE}/api/fomo/trader -H "content-type: application/json" -d '{"wallet":"<wallet>","handle":"handle"}'

# their swaps and PnL, and what Fomo traders are buying
curl ${BASE}/api/wallet/<wallet>
curl ${BASE}/api/fomo`, "bash")}

<h2 id="which">Unofficial Fomo API or Blix?</h2>
${table(["", "Unofficial Fomo APIs", "Blix"], [
    ["Handle to wallet lookup", "Yes", "You supply the wallet (shown on chain and in the Fomo app)"],
    ["Fomo-reported PnL", "Yes", "No: PnL computed from the chain, realized and open kept apart"],
    ["Live activity", "WebSocket, metered", "Server-Sent Events, free"],
    ["Key and credits", "Yes", "None"],
    ["Beyond Fomo", "No", "pump.fun Pulse, holders, candles, quotes, AI reads, any wallet"],
  ], "cmp")}
${NOT_AFFILIATED("Fomo (Fomo Labs)")}`,
  faq: [
    ["Does Fomo have an API?", `No public one. fomo.family does not publish developer docs, API keys or an SDK as of ${UPDATED_TEXT}.`],
    ["Is fomoapi.io official?", `No. It describes itself as an independent, unofficial tool not affiliated with fomo.family. Its free plan is 250,000 credits a month (about 1,000 calls).`],
    ["How can I see what Fomo traders are buying for free?", `Follow their Solana wallets in Blix and their swaps arrive from the chain. Tag them as Fomo wallets and Blix also samples the swaps Fomo sponsors to show what Fomo traders are buying.`],
    ["Can I trade on Fomo through an API?", `No. Fomo has no public trading API. Blix links every coin to the Fomo app (fomo.family/tokens/solana/&lt;mint&gt;) so you can buy there in one tap.`],
    ["Is Blix affiliated with Fomo?", `No. Blix is independent open-source software.`],
  ],
};

// ---------- /pump-fun-api ----------
const pump = {
  path: "/pump-fun-api", crumb: "pump.fun API", og: "og-pump.png",
  title: "Free pump.fun API: Launches, Trades, Holders, No Key (2026)",
  ogTitle: "Free pump.fun API: launches, trades, holders",
  description: "Free, open-source pump.fun API: every launch in about a second, trades decoded from chain, bonding progress, migrations, holders, snipers, bundles. No key.",
  eyebrow: "pump.fun API · checked " + UPDATED_TEXT,
  h1: "Free pump.fun API",
  lede: `pump.fun has no official public data API, so every "pump.fun API" is a third party. PumpPortal's launch and migration streams are free, but since May 1, 2026 its trade streams need an API key, a funded wallet and 0.01 SOL per 10,000 trades. <a href="/api">Blix</a> is a free, open-source alternative that runs on your machine: new coins from PumpPortal's free stream with an on-chain backup, every trade decoded straight from Solana, plus bonding progress, migrations, holders, snipers, bundles and candles as JSON and a live stream.`,
  related: ["/api", "/mcp", "/gmgn-api", "/axiom-api"],
  body: `${cta(`<a class="btn" href="/api#stream">See the live stream</a>`)}
${facts([
    ["Launches", "Every pump.fun launch, about 2,000 an hour, about a second after the chain"],
    ["Trades", "Decoded from pump.fun program logs; 50 to 80 a second"],
    ["Bonding curve", "Progress, market cap and final stretch, live"],
    ["Migrations", "Graduations, then Jupiter prices every 2 seconds"],
    ["Holders", "Dev, snipers, bundles, top 10, who sold"],
    ["Cost", "Free, no key; the public Solana RPC works"],
  ])}
<h2 id="quick-start">Quick start</h2>
${INSTALL}
${code(`# every new pump.fun coin as it launches
curl -N ${BASE}/api/stream | grep -A1 "event: launch"

# coins closest to bonding, with live progress
curl -s ${BASE}/api/pulse | jq '.stretch[] | {symbol, progress, mcap}'`, "bash")}

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
<p>Blix subscribes to the pump.fun program's logs over a Solana RPC websocket (the free public endpoint works; your own RPC is faster) and decodes the program's Anchor events itself:</p>
<ul>
<li><b>TradeEvent</b> (discriminator <code>bddb7fd34ee661ee</code>): mint, SOL amount, token amount, buy or sell, trader, timestamp, then the virtual and real reserves after the trade.</li>
<li><b>CreateEvent</b> (discriminator <code>1b72a94ddeeb6376</code>): name, symbol, metadata URI, mint, bonding curve and creator. This is the backup for launches PumpPortal's stream misses.</li>
</ul>
<p>From each trade: market cap in SOL is <code>virtualSolReserves / virtualTokenReserves × 1,000,000,000</code> (one billion supply), and bonding progress is <code>1 − realTokenReserves / 793,100,000</code>, the tokens sold along the curve before it completes. Holders are a running ledger of every wallet's balance; a wallet that first bought in the same block as the first trade is a bundle, and one that bought within 2 blocks of it is a sniper.</p>

<h2 id="compare">pump.fun API options compared</h2>
${table(["", "Key", "Cost", "Notes"], [
    ["Blix", "None", "Free (MIT)", "Runs on your machine; launches, trades, holders, candles, quotes, AI reads"],
    [ext("https://pumpportal.fun/fees/", "PumpPortal"), "Required for trade streams", "Launch and migration streams free; trades 0.01 SOL per 10,000 (since May 1, 2026); trading API 0.5% (local) or 1% (Lightning) a trade", "Hosted websocket; the trading API builds and sends transactions"],
    ["Indexers (Bitquery, Moralis, Codex, others)", "Required", "Usually a free tier with limits, then paid plans", "Hosted, multi-chain, historical queries"],
  ], "cmp")}
<p>Use a hosted indexer when you need deep history or many chains. Use Blix when you want live pump.fun data for free, with the decoding in code you can read.</p>
${NOT_AFFILIATED("pump.fun or PumpPortal")}`,
  faq: [
    ["Does pump.fun have an official API?", `No public, documented data API. The endpoints behind pump.fun's website are private and change without notice. Third parties such as PumpPortal and the indexers fill the gap; Blix reads the chain directly.`],
    ["Is PumpPortal free?", `Partly. Its new-token and migration streams are free. Since May 1, 2026, token and account trade streams need an API key and a linked wallet with at least 0.02 SOL, and cost 0.01 SOL per 10,000 trades streamed. Its trading API takes 0.5% (local) or 1% (Lightning) of each trade.`],
    ["How do I get new pump.fun tokens in real time for free?", `Run Blix and listen to <code>launch</code> events on <code>GET /api/stream</code>. Each event arrives about a second after the coin is created on chain.`],
    ["How is pump.fun bonding curve progress calculated?", `1 − realTokenReserves / 793,100,000. The curve completes when the 793.1 million tokens sold along it are gone; Blix reads the real reserves from every trade.`],
    ["How do you detect snipers and bundles on pump.fun?", `From the first trade onward: a wallet whose first buy is in the same block as the coin's first trade is a bundle, one within 2 blocks is a sniper. Coins first seen mid-life are marked partial instead of guessed.`],
    ["Is Blix affiliated with pump.fun?", `No. Blix is independent open-source software.`],
  ],
};


// ---------- pages for traders (the terminal itself, not the API) ----------
// Each says only what the terminal at /app does today (the landing's features); the button goes to sign-up.
const START = () => `<div class="cta"><a class="btn primary" href="/start">Start trading free</a><a class="btn" href="/">See BLIX</a></div>`;

const tracker = {
  path: "/pump-fun-tracker", crumb: "pump.fun tracker", og: "home/og.jpg",
  title: "pump.fun Tracker: Live New Pairs, Bonding & Migrations (Free) | BLIX",
  ogTitle: "BLIX: a free live pump.fun tracker",
  description: "Free live pump.fun tracker: every new coin as it launches, bonding curve progress, final stretch and migrations, holders, snipers and bundles, with AI ratings. Sign in with Google.",
  eyebrow: "pump.fun tracker · updated " + UPDATED_TEXT,
  h1: "Live pump.fun tracker",
  lede: `BLIX shows every pump.fun coin the moment it launches and follows it live: market cap, buys and sells, bonding curve progress, the final stretch before migration, and the move to PumpSwap. Each coin gets a live AI rating and a holder breakdown (dev, snipers, bundles, top 10), so you can tell a real runner from a rug before you buy. It is free and runs in your browser: sign in with Google and it is on screen.`,
  related: ["/solana-memecoin-screener", "/memecoin-paper-trading", "/pump-fun-api"],
  body: `${START()}
${facts([
    ["New pairs", "Every pump.fun launch, about a second after it hits the chain"],
    ["Final stretch", "Coins closest to completing the bonding curve, with live progress"],
    ["Migrated", "Coins that graduated, priced live after the move"],
    ["Holders", "Dev, snipers, bundles, top 10 and who already sold"],
    ["AI", "A live rating per coin and one-click research"],
    ["Cost", "Free; paper trading to practise"],
  ])}
<h2 id="pulse">Pulse: the whole pump.fun lifecycle on one screen</h2>
<p>The Pulse board splits pump.fun into the stages that matter for a trade. <b>New pairs</b> lists coins seconds after launch. <b>Final stretch</b> holds the ones close to finishing the bonding curve, where most of the volume arrives. <b>Migrated</b> shows coins that graduated and keep trading. Every row updates live from the chain: market cap, volume, buys and sells, holders and age, with the coin's picture and links to its X, Telegram and website.</p>
<h2 id="safety">Spot rugs before you buy</h2>
<ul>
<li><b>Dev history:</b> how many coins the creator launched before and how they ended.</li>
<li><b>Snipers and bundles:</b> wallets that bought in the first blocks, and how much they still hold.</li>
<li><b>Top 10 share:</b> how concentrated the supply is.</li>
<li><b>Live rating:</b> built from liquidity, holders, volume and risk signals, updated as the coin trades.</li>
</ul>
<h2 id="follow">Follow the wallets and accounts that move coins</h2>
<p>Follow top traders and smart wallets to see their buys and sells as they land, and watch the X accounts that call memecoins: when they post a ticker or contract address it appears next to the chart. The live feed brings pump.fun callouts and big Fomo trades into one list.</p>
<h2 id="practise">Practise first with paper trading</h2>
<p>Buy and sell any coin with paper SOL at real quoted prices, with take profit, stop loss and trailing stop, and see your profit move with the coin. Nothing is sent to the chain. <a href="/memecoin-paper-trading">How paper trading works</a>.</p>
${START()}
${NOT_AFFILIATED("pump.fun")}`,
  faq: [
    ["Is there a free pump.fun tracker?", `Yes. BLIX is free: sign in with Google and the live board of new pairs, final stretch and migrated coins is on screen, with holders, snipers and AI ratings for every coin.`],
    ["How do I see new pump.fun coins as they launch?", `Open BLIX and look at the New pairs column on Pulse. Coins appear about a second after they are created on chain and update live from then on.`],
    ["What is the pump.fun final stretch?", `The coins closest to completing their bonding curve. When the curve completes the coin migrates and trades on a regular pool; BLIX shows the progress live for each coin.`],
    ["How do I check a pump.fun coin for snipers and bundles?", `Open the coin in BLIX: the holder panel shows the dev, wallets that bought in the first blocks (snipers and bundles), the top 10 share, and who has already sold.`],
    ["Can I practise without risking SOL?", `Yes. Paper trading uses real quoted prices and costs but never sends a transaction.`],
  ],
};

const screener = {
  path: "/solana-memecoin-screener", crumb: "Memecoin screener", og: "home/og.jpg",
  title: "Solana Memecoin Screener with AI Ratings & Narratives (Free) | BLIX",
  ogTitle: "BLIX: a free Solana memecoin screener with AI ratings",
  description: "Free Solana memecoin screener: trending, surging and new coins with live AI ratings, narrative tracking, holder and rug checks, wallet and X tracking. Sign in with Google.",
  eyebrow: "Memecoin screener · updated " + UPDATED_TEXT,
  h1: "Solana memecoin screener with AI",
  lede: `Thousands of memecoins launch on Solana every day. BLIX narrows them down: trending and surging coins, new pairs, AI ratings that update as each coin trades, daily AI picks with the reasons behind them, and narrative tracking that shows which stories (AI agents, cats, political coins and the rest) are heating up and which coins ride them. Free, in the browser, sign in with Google.`,
  related: ["/pump-fun-tracker", "/memecoin-paper-trading", "/api"],
  body: `${START()}
${facts([
    ["Lists", "Trending, Surge, New pairs and Bonded"],
    ["AI ratings", "Every coin, updated live from liquidity, holders, volume and risk"],
    ["Daily picks", "A short list each day, with why"],
    ["Narratives", "Which stories are heating up, and their coins"],
    ["Research", "One click: dev history, holders, socials, red flags"],
    ["Cost", "Free"],
  ])}
<h2 id="discover">Discover: what is moving right now</h2>
<p>Discover sorts Solana memecoins into <b>Trending</b>, <b>Surge</b> (coins accelerating in the last minutes), <b>New pairs</b> and <b>Bonded</b>. Each row shows market cap, change, volume and holders, with the coin's live rating, and opens straight into its chart.</p>
<h2 id="ai">AI ratings, picks and research</h2>
<p>Every coin gets a rating that updates as it trades. Each day BLIX picks the coins worth watching and says why, so you start with a short list instead of the whole firehose. One click on any coin runs a full read: the dev's history, holder concentration, socials, red flags and how it compares with the rest of its narrative.</p>
<h2 id="narratives">Narrative tracking</h2>
<p>Memecoins move in themes. BLIX groups coins by the story they ride and tracks which stories are gaining, so you can see a narrative heat up and find its leading coins early.</p>
<h2 id="tracking">Wallets, X accounts and live feed</h2>
<p>Follow top traders and smart wallets, watch the X accounts that call coins, and keep one live feed of pump.fun callouts and big Fomo trades with each position's profit moving as the coin trades.</p>
${START()}`,
  faq: [
    ["What is the best free Solana memecoin screener?", `BLIX is free and adds what most screeners leave out: live AI ratings, daily AI picks, narrative tracking and one-click research on any coin, alongside trending, surge and new pair lists.`],
    ["How are BLIX's AI ratings made?", `From each coin's live liquidity, holders, volume and risk signals (dev history, snipers, bundles, supply concentration). The rating changes as the coin trades.`],
    ["What are memecoin narratives?", `The themes coins trade on, such as AI agents, animals or politics. BLIX groups coins by narrative and shows which narratives are gaining attention.`],
    ["Do I need a wallet to use it?", `No. Sign in with Google to browse, rate and paper trade. Nothing touches your funds.`],
  ],
};

const paperPage = {
  path: "/memecoin-paper-trading", crumb: "Paper trading", og: "home/og.jpg",
  title: "Memecoin Paper Trading on Solana: Real Prices, No Risk (Free) | BLIX",
  ogTitle: "BLIX: free memecoin paper trading on Solana",
  description: "Paper trade Solana and pump.fun memecoins for free: real quoted prices and trading costs, take profit, stop loss and trailing stop, live profit. Nothing is sent to the chain.",
  eyebrow: "Paper trading · updated " + UPDATED_TEXT,
  h1: "Memecoin paper trading on Solana",
  lede: `Practise trading memecoins without risking SOL. BLIX's paper desk fills every buy and sell at the price a real swap would get right now, takes trading costs off each side, and tracks your profit live as the coin trades. Set take profit, stop loss or a trailing stop and BLIX closes the position for you. No wallet, no transaction, nothing on chain: sign in with Google and start with paper SOL.`,
  related: ["/pump-fun-tracker", "/solana-memecoin-screener"],
  body: `${START()}
${facts([
    ["Prices", "Real swap quotes at the moment you trade"],
    ["Costs", "Trading costs taken off each side, like a real trade"],
    ["Exits", "Take profit, stop loss, trailing stop, partial sells"],
    ["Coins", "Any Solana memecoin, pump.fun included"],
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
<p>Memecoins move fast and most new coins go to zero. Paper trading lets you test an entry rule, a take profit or a stop on live coins and see what it would have done, with the same prices and costs as real trades, before any SOL is at stake.</p>
${START()}`,
  faq: [
    ["Is memecoin paper trading free?", `Yes. Sign in with Google and the paper desk is ready; there is nothing to pay and no wallet to connect.`],
    ["Are paper trade prices realistic?", `Each buy and sell fills at a real swap quote for that coin at that moment, and trading costs are taken off each side, so results track what a real trade would have done.`],
    ["Can I set a stop loss on a paper trade?", `Yes: take profit, stop loss and trailing stop on every position, and partial sells.`],
    ["Is anything sent to the blockchain?", `No. Paper trades exist only in BLIX; no transaction is ever signed or sent.`],
  ],
};

export const PAGES = Object.fromEntries([api, mcp, pump, gmgn, axiom, fomo, tracker, screener, paperPage].map((p) => [p.path, p]));
export const render = (path) => layout(PAGES[path]);
