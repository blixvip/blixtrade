// Shared pieces for the keyword pages in pages-*.js: the sign-up call to action, the feature blocks (one source of
// truth for what the terminal does, so no page can claim a feature Blix lacks), the terminal comparison data,
// and small builders. Every page assembles its own lede, sections and FAQ around these.
// Everything on these pages leads to one place: an account at blixvip.com. There is no other way in.
import { API_DOCS } from "../../public/api-docs.js";
import { MCP_TOOLS } from "../../public/mcp-tools.js";
import { esc, code, table, facts, ext } from "./html.js";

export const CHECKED = "October 10, 2026";          // when the third-party facts on these pages were checked
export const UPDATED_DAY = "2026-10-10";
export const N_ENDPOINTS = API_DOCS.reduce((a, [, rows]) => a + rows.length, 0);
export const N_TOOLS = MCP_TOOLS.length;
export const BASE = "https://blixvip.com";
export const DISCORD = "https://discord.gg/3VWHBP6paA";
export const CONNECTOR = "/_pub/blix-mcp.mjs";       // the MCP connector an account downloads (worker/public/_pub)
export const MCP_SCRIPT = "/path/to/blix-mcp.mjs";
export { esc, code, table, facts, ext };

// The call to action on every page: an account, and the Discord.
export const DISCORD_LINK = (text = "Join the Discord") => `<a class="btn" href="${DISCORD}" rel="noopener">${text}</a>`;
export const START = (label = "Create your free account", second = DISCORD_LINK()) =>
  `<div class="cta"><a class="btn primary" href="/start">${label}</a>${second}</div>`;
export const DEV_CTA = (second = `<a class="btn" href="/developers">Developer access</a>`) =>
  `<div class="cta"><a class="btn primary" href="/start">Create your account</a>${second}${DISCORD_LINK()}</div>
<p class="meta">API and MCP access come with every BLIX account · sign in with Google · checked ${CHECKED}</p>`;
export const SIGNIN_DEV = `<div class="callout"><p><b>Access comes with your account.</b> Sign in to BLIX with Google, open <a href="/developers">Developers</a>, and your API session and the MCP connector command are shown there, ready to copy. Everything below assumes you are signed in. Questions: the <a href="${DISCORD}" rel="noopener">Discord</a>.</p></div>`;
export const NOT_AFFILIATED = (who) => `<p class="note">BLIX is independent and not affiliated with ${who}. Facts about ${who} were checked against public sources on ${CHECKED} and can change.</p>`;
export const RISK = `<p class="note">Memecoins are extremely risky and most go to zero. Nothing on this page is financial advice.</p>`;
export const COMMUNITY = `<h2 id="community">The BLIX community</h2><p>Every account comes with the BLIX Discord: the people trading on the terminal, the narratives as they form, feature drops before they are announced, and the team answering questions. <a href="${DISCORD}" rel="noopener">Join the Discord</a> once you have signed up.</p>`;

// ---------- feature blocks ----------
// Each is an <h2> and a paragraph or list. The heading can be replaced so pages do not repeat each other word for
// word; the facts inside stay the same because they describe one product.
const block = (id, h, html) => `<h2 id="${id}">${h}</h2>${html}`;
export const F = {
  pulse: (h = "Pulse: every pump.fun coin from launch to migration") => block("pulse", h, `<p>Pulse splits pump.fun into the three stages that matter for a trade. <b>New pairs</b> lists coins about a second after they are created on chain. <b>Final stretch</b> holds the ones closest to completing the bonding curve, where most of the volume arrives. <b>Migrated</b> shows coins that graduated to a pool and keep trading. Every row updates live: market cap, buys and sells, volume, holders, age, the coin's picture and its X, Telegram and website links.</p>`),
  discover: (h = "Discover: trending, surging, new and bonded") => block("discover", h, `<p>Discover sorts Solana memecoins into <b>Trending</b>, <b>Surge</b> (coins accelerating in the last minutes), <b>New pairs</b> and <b>Bonded</b>, each with market cap, change, volume, holders and the live AI rating. Every list is refreshed every few seconds and opens straight into the coin's chart.</p>`),
  rating: (h = "A live AI rating on every coin") => block("rating", h, `<p>Every coin gets a rating built from its live liquidity, holders, volume and risk signals (dev history, snipers, bundles, supply concentration), updated as the coin trades. One click runs a full read: the dev's past launches, holder concentration, socials, red flags and how the coin compares with the rest of its narrative, with a grade from A to F, a thesis and a plan.</p>`),
  picks: (h = "Daily AI picks, with the reasons") => block("picks", h, `<p>The AI early picks page shows what the deep reads said today (buy, watch or avoid, with the reason), the buy calls of the week, and how past picks did. Picks are scored after the fact, so the record includes the ones that failed. Nothing is bought for you: you decide, and buy in one click if you agree.</p>`),
  narratives: (h = "Narratives: the stories coins ride") => block("narratives", h, `<p>Memecoins move in themes. BLIX groups coins by the story they ride and tracks which stories are gaining. The <b>Today</b> desk writes up the day's narratives and runners: Blix AI researches each one on X and the web and explains what the thing is, what happened, how it is trading, which coins play which role, the case for and against, and what to watch, with live numbers beside it.</p>`),
  signals: (h = "Signals") => block("signals", h, `<p>The signals feed raises dump warnings, dev sells, market-cap milestones, buys by the wallets BLIX follows (smart money and leaderboard traders), AI buy calls, picks and new narratives, each with the coin's live numbers and a record of how that type of signal has done. It is in the app the moment you sign in, and the Discord carries the day's big ones.</p>`),
  wallets: (h = "Any wallet, read from the chain") => block("wallets", h, `<p>Open any Solana wallet as a page built from the chain: its holdings, latest swaps on every Solana DEX, open positions, best closed trades and its pump.fun rank, with linked wallets grouped. The wallets BLIX follows (smart money found from the chain, Fomo and pump.fun leaderboard traders) carry realized, open and sellable profit kept apart, and their buys arrive as signals with the record beside them. The <b>Top traders</b> board merges the Fomo and pump.fun leaderboards by profit for the day, week or month.</p>`),
  smart: (h = "Smart money, found from the chain") => block("smart", h, `<p>Wallets that bought runners early are surfaced as smart money and followed by BLIX automatically, so their next buys show up as signals with the wallet's record beside them. The Fomo leaderboard's traders are matched to their wallets, which puts real names and faces on holder lists and charts.</p>`),
  x: (h = "X accounts that call coins") => block("x", h, `<p>BLIX watches the X accounts that call memecoins. Their posts show up within about a minute, and every coin they name (a contract address, a pump.fun or trading link, a $ticker) becomes a chip with its live market cap and a quick buy.</p>`),
  feed: (h = "One live feed") => block("feed", h, `<p>The feed brings pump.fun callouts and the big Fomo buys, sells and theses into one list, with each position's profit moving as the coin trades.</p>`),
  holders: (h = "Holders, snipers, bundles and the dev") => block("holders", h, `<p>The holder panel is a ledger Blix builds from the trades it sees: the dev's share and whether the dev sold, wallets that bought in the first blocks (snipers and bundles) and how much they still hold, the top-10 share, and who already sold. Known traders are shown with their name and face where they bought and sold, on the chart as well as in the table.</p>`),
  safety: (h = "The rug check") => block("safety", h, `<p>Every coin carries a safety read that answers "is this a rug?" in one number, with the reasons under it: mint and freeze authority, whether liquidity is locked or pulled, the dev's past launches (serial launchers are flagged), bundle and sniper share, top-holder concentration and whether the dev sold. A bubble map draws the wallets that are linked by funding so a coin held by one person through twenty wallets looks like it. A coin can pass the rug check and still go to zero: the check is about the setup, not the chart.</p>`),
  chart: (h = "The chart, with the traders on it") => block("chart", h, `<p>Candles are built from real trades, from 1-second to daily, with the trades list refreshed every two seconds. Known traders' faces sit on the exact candle where they bought and sold, with the dev and every callout, so you see who is in and who left. The header's market cap is always the chart's last close.</p>`),
  trade: (h = "Trade in one click, with real SOL") => block("trade", h, `<p>Sign in with Google and BLIX makes you a Solana wallet. Deposit SOL, set your size once, and buy from any list or chart in one click: the swap is routed through Jupiter with a priority fee set per trade so it lands fast. Sell all or part of a position just as fast. The fee is 2% a trade, 1.6% if you joined through an invite, and you can export your private key or withdraw at any time.</p>`),
  paper: (h = "Practise in paper mode") => block("paper", h, `<p>Paper mode fills every buy and sell at the price a real swap would get right now, takes trading costs off each side, and runs the same take profit, stop loss and trailing stop. Flip to live when you are ready; the screens are the same.</p>`),
  launch: (h = "Create a pump.fun coin in one screen") => block("launch", h, `<p>The Create page launches a pump.fun coin from one form: picture, name, ticker (a suggestion is offered from the name), a line about it, optional X, Telegram and website links, and an optional first buy with its slippage. The right side shows the coin as it will look, what it costs, what is still missing, where it starts on the bonding curve after your first buy, and what people are posting about right now. The vault signs the create from your Blix wallet, so it is real SOL every time. Every trade on a coin you launched pays you pump.fun's creator fee, and BLIX shows what you have earned and lets you claim it.</p>`),
  pnl: (h = "Profit, history and a card to share") => block("pnl", h, `<p>Your portfolio shows open positions with live profit, today's and lifetime results, and every closed trade with its entry and exit. Any position can be turned into a PnL card to post. The same view exists for any wallet on Solana, not only yours.</p>`),
  api: (h = "The API and the MCP connector") => block("api", h, `<p>Every BLIX account includes developer access: the same data the terminal shows, as JSON over <a href="/api">${N_ENDPOINTS} endpoints</a> and one live event stream, and an <a href="/mcp">MCP connector</a> that turns it into ${N_TOOLS} tools for Claude, Cursor, Codex, Gemini CLI and any other MCP client. Sign in, open <a href="/developers">Developers</a>, and your session and connector command are there to copy. Real trading from a bot is the <a href="/trade-api">trade API</a>: Blix builds the transaction for your own wallet, you sign, Blix sends, 2% a trade.</p>`),
  handles: (h = "Your page and your invite link") => block("handles", h, `<p>Every member gets a page at blixvip.com/@name. Friends who join through it pay 1.6% instead of 2%, and you earn 40% of the fee on every trade they make.</p>`),
};

// A short list of the terminal's facts for the facts grid, picked per page.
export const FACT = {
  price: ["Price", "Free account. Sign in with Google"],
  fee: ["Trading fee", "2% a trade, 1.6% with an invite"],
  chain: ["Chain", "Solana: pump.fun, PumpSwap, Raydium, Meteora and every pool Jupiter routes"],
  speed: ["Speed", "New pump.fun coins about a second after the chain; prices several times a second"],
  ai: ["AI", "A live rating on every coin, daily picks, narratives written up each day"],
  wallets: ["Wallets", "Any wallet from the chain; smart money followed for you; Fomo and pump.fun top traders"],
  safety: ["Safety", "Rug check, dev history, snipers, bundles, bubble map"],
  paper: ["Practice", "Paper mode at real quotes"],
  where: ["Where", "In the browser, phone or desktop. Nothing to install"],
  dev: ["Developers", "API and MCP connector included with your account"],
  launch: ["Create", "Launch a pump.fun coin in one screen; creator fees shown and claimable"],
  x: ["X", "The accounts that call coins, watched for you; posts within about a minute"],
  community: ["Community", "The BLIX Discord, with your account"],
};

// ---------- terminals compared ----------
// What each terminal is today, checked on CHECKED. Numbers are the published ones; where a product does not publish
// one, the cell says so instead of guessing.
export const TERMINALS = {
  blix: { name: "BLIX", fee: "2% (1.6% with an invite)", chains: "Solana", custody: "Blix wallet made at sign-up; export the key or withdraw any time", ai: "Live rating on every coin, daily picks, narratives, deep reads", api: `API (${N_ENDPOINTS} endpoints) and MCP connector (${N_TOOLS} tools) with every account`, paper: "Yes", launch: "Yes, pump.fun in one screen", social: "Fomo and pump.fun leaderboards, X tracking, live feed, Discord", status: "Live" },
  axiom: { name: "Axiom Trade", fee: "1%, less 0.05–0.25% cashback by volume (about 0.75–0.95% net)", chains: "Solana, plus Hyperliquid perps", custody: "Non-custodial (Turnkey), keys exportable", ai: "No AI reads", api: "No public API or SDK", paper: "No", launch: "No", social: "Wallet and X tracking", status: "Live" },
  photon: { name: "Photon", fee: "About 1% (0.75% quoted by some reviews, 1% with the sniper)", chains: "Solana (sister apps for other chains)", custody: "Photon wallet generated in the app", ai: "No AI reads", api: "No public API", paper: "No", launch: "No", social: "Basic", status: "Live" },
  gmgn: { name: "GMGN", fee: "About 1%", chains: "Solana, Ethereum, Base, BNB, Tron and others", custody: "In-app wallet, exportable", ai: "Smart-money tags, no written reads", api: "OpenAPI with a key by application", paper: "No", launch: "No", social: "Copy trading, KOL wallets", status: "Live" },
  bullx: { name: "BullX (Neo)", fee: "Was about 0.9–1%", chains: "Solana, Ethereum, Base, BNB, Tron, Blast", custody: "In-app wallets", ai: "No AI reads", api: "No public API", paper: "No", launch: "No", social: "Basic", status: "Trading suspended since June 1, 2026 (withdrawals open); no relaunch date published" },
  fomo: { name: "Fomo", fee: "About 0.5% spot, quoted before each trade; network fees covered on most chains", chains: "Solana, Base, BNB, plus perps", custody: "Non-custodial app (iOS, Android, web)", ai: "No AI reads", api: "No public API", paper: "No", launch: "No", social: "Social feed of traders' buys, sells and theses", status: "Live" },
  nio: { name: "nio.trade", fee: "Not stated on its site; advertises cashback", chains: "Solana, Ethereum, Base, BNB, Hyperliquid", custody: "Non-custodial (Turnkey)", ai: "No AI reads", api: "No public API", paper: "No", launch: "No", social: "Referral points", status: "Live" },
  dexscreener: { name: "DEX Screener", fee: "No trading of its own (partner swaps); paid profile boosts", chains: "Most chains", custody: "None", ai: "No", api: "Public, rate-limited", paper: "No", launch: "No", social: "None", status: "Live" },
  birdeye: { name: "Birdeye", fee: "Data product; swaps through partners", chains: "Solana and other chains", custody: "None", ai: "No", api: "Paid tiers", paper: "No", launch: "No", social: "None", status: "Live" },
};
const ROWS = { fee: "Fee per trade", chains: "Chains", custody: "Your keys", ai: "AI on every coin", api: "API / MCP", paper: "Paper mode", launch: "Coin launcher", social: "Social and wallets", status: "Status" };
export const compare = (keys, rows = ["fee", "chains", "custody", "ai", "api", "paper", "launch", "status"]) =>
  table(["", ...keys.map((k) => TERMINALS[k].name)], rows.map((r) => [ROWS[r], ...keys.map((k) => TERMINALS[k][r])]), "cmp");

// ---------- small builders ----------
export const steps = (items) => `<ol>${items.map((s) => `<li>${s}</li>`).join("")}</ol>`;
export const bullets = (items) => `<ul>${items.map((s) => `<li>${s}</li>`).join("")}</ul>`;
export const callout = (html) => `<div class="callout"><p>${html}</p></div>`;

// Links to other pages, rendered inside the body so no page depends on html.js's card map.
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const links = (title, items) => `<h2 id="more-${slug(title)}">${title}</h2><div class="related">${items.map(([href, t, blurb]) => `<a href="${href}"><b>${esc(t)}</b><span>${esc(blurb)}</span></a>`).join("")}</div>`;

// A page object with the defaults filled in. o: { path, title, description, h1, lede, body, faq, ... }
export const page = (o) => ({
  crumb: o.crumb || o.h1, og: o.og || "home/og.jpg", eyebrow: o.eyebrow || `BLIX · updated ${CHECKED}`, updated: UPDATED_DAY,
  ogTitle: o.ogTitle || o.title.replace(/ \| BLIX$/, ""),
  ...o,
});

// The MCP connector setup, shared by every MCP page. The connector is one file an account downloads from
// blixvip.com; it talks to the account's API session (BLIX_SESSION, shown on /developers).
const ENV = { BLIX_SESSION: "<from your Developers page>" };
export const MCP_SETUP = {
  download: code(`# 1. download the connector (one file, no dependencies; needs Node 20+)
curl -O ${BASE}${CONNECTOR}
# 2. sign in to BLIX, open ${BASE}/developers and copy your session`, "bash"),
  claudeCode: code(`claude mcp add blix -e BLIX_SESSION=<from your Developers page> -- node ${MCP_SCRIPT}`, "bash"),
  json: code(JSON.stringify({ mcpServers: { blix: { command: "node", args: [MCP_SCRIPT], env: ENV } } }, null, 2), "json"),
  codex: code(`[mcp_servers.blix]\ncommand = "node"\nargs = ["${MCP_SCRIPT}"]\n\n[mcp_servers.blix.env]\nBLIX_SESSION = "<from your Developers page>"`, "toml"),
  vscode: code(JSON.stringify({ servers: { blix: { type: "stdio", command: "node", args: [MCP_SCRIPT], env: ENV } } }, null, 2), "json"),
  gemini: code(JSON.stringify({ mcpServers: { blix: { command: "node", args: [MCP_SCRIPT], env: ENV, timeout: 15000 } } }, null, 2), "json"),
};
