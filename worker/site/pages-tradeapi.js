// The trade API pages: the hub (/trade-api: what it is, the four calls, pricing, the rules, code in curl, Node and
// Python) and one page per terminal people search a "trading API" for (pump.fun / PumpPortal, GMGN, Axiom, Fomo),
// each saying what that terminal really offers a bot today and how the same trade goes through BLIX with the bot's
// own wallet. Facts about other products carry the date they were checked and link to their source.
// Everything here is Phase 1 of the trade API: pump.fun's bonding curve and PumpSwap pools, built by hand; other
// launchpads are routed through Jupiter in the next phase and are said to be coming, never claimed as live.
import { FACT, START, DEV_CTA, DISCORD, DISCORD_LINK, COMMUNITY, NOT_AFFILIATED, RISK, CHECKED, BASE, N_ENDPOINTS, code, table, facts, steps, bullets, callout, links, page, ext } from "./pagekit.js";

const KEY_H = 'authorization: Bearer $BLIX_KEY';
const KEYS_NOTE = `<div class="callout"><p><b>Your key comes with your account.</b> Sign in to BLIX with Google and open <a href="/trade-api">this page</a> again: your API keys are at the top, made and revoked in one click (a key is shown once). Every call below sends it as <code>${KEY_H}</code>; the examples read it from <code>BLIX_KEY</code>. Already registered? <a href="/login">Log in</a>. Questions: the <a href="${DISCORD}" rel="noopener">BLIX Discord</a>.</p></div>`;
const TRADE_CTA = () => DEV_CTA(`<a class="btn" href="/trade-api#calls">The four calls</a>`);
const RULES = `<h2 id="rules">The rules, written into the product</h2>
${bullets([
  "<b>Your key never leaves your machine.</b> Blix builds the transaction; you sign it. There is no custodial \"lightning\" wallet and no endpoint that takes a private key.",
  "<b>The fee rides inside the transaction.</b> Every build carries Blix's fee transfer and <code>send</code> only accepts transactions Blix built, so there is no path around it and nothing to settle later. Blix's fee: 2% of the SOL side of the trade, 1.6% when you joined through an invite; your inviter earns 40% of it.",
  "<b>Sane defaults.</b> Slippage defaults to 3% (<code>slippageBps: 300</code>), capped at 50%. The priority fee follows what the coin's busiest recent trades paid, between 0.0001 and 0.001 SOL. One buy spends at most 2 SOL.",
  "<b>Honest landing reports.</b> <code>send</code> answers with the signature, the slot and whether the transaction landed, failed (with pump.fun's reason in words) or expired, never a bare \"success\".",
  "<b>No launch bundles.</b> There is no multi-wallet create and no bundle endpoint. Buy, sell and (later) create, one wallet at a time.",
])}`;
const CALLS = `<h2 id="calls">The four calls</h2>
${table(["Call", "What it does", "Reads"], [
  ["<code>POST /api/v1/quote</code>", "What a buy or sell fills at right now on pump.fun's curve or in its PumpSwap pool: tokens out or SOL out, the minimum at your slippage, Blix's fee, the priority fee and tip, the market cap", "The coin's accounts, once"],
  ["<code>POST /api/v1/trade/build</code>", "The same, plus the unsigned transaction (base64): compute budget, priority fee, the swap, Blix's fee transfer, the Sender tip. Valid for about 90 seconds", "The coin's accounts and a fresh blockhash"],
  ["<code>POST /api/v1/trade/send</code>", "Your signed transaction goes out over Helius Sender's staked connections and the RPCs at once, is re-sent every second until a block holds it, and the answer says where it landed", "Signature status until it lands or expires"],
  ["<code>GET /api/v1/stream</code>", "A WebSocket with PumpPortal's message names: new coins, a coin's trades, a wallet's trades, migrations. A bot written against PumpPortal's stream points here and keeps working", "The same trade feed the terminal shows"],
], "ref")}
<p>Two more: <code>GET /api/v1/trade/&lt;signature&gt;</code> says where a sent trade stands, and <code>GET /api/v1/me</code> returns the key's account, fee rate and limits. Keys are made on this page when you are signed in (<code>/api/v1/keys</code>); <code>GET /api/v1/usage</code> is your ledger. Every endpoint is also listed on the <a href="/api#endpoints">API page</a>.</p>`;
const BODY_TABLE = table(["Field", "Meaning"], [
  ["<code>wallet</code>", "Your wallet's address: the signer and fee payer. Blix reads its SOL and token balances to size and check the trade"],
  ["<code>mint</code>", "The coin. pump.fun curve coins and PumpSwap pools today; other pools answer 409 until Jupiter routing ships"],
  ["<code>side</code>", "<code>buy</code> or <code>sell</code>"],
  ["<code>sol</code>", "Buy: SOL to spend, fees included (Blix's fee comes out of it). At most 2"],
  ["<code>pct</code> · <code>tokens</code>", "Sell: percent of what the wallet holds (default 100), or a raw token amount as an integer string"],
  ["<code>slippageBps</code>", "Default 300 (3%). The build carries the minimum you accept; the chain refuses a worse fill and nothing is spent"],
  ["<code>priorityFeeSol</code> · <code>tipSol</code>", "Optional. Per-trade priority fee (default: what the coin's busiest recent trades paid, 0.0001 to 0.001 SOL) and Helius Sender tip (default 0.00001 SOL; 0.001 or more opens every path Helius has, Jito's included)"],
]);
const CURL = code(`export BLIX_KEY="blx_live_…"          # from ${BASE}/trade-api, signed in
export WALLET="<your wallet address>"
MINT="<the coin's mint>"

# 1. a quote: what 0.1 SOL buys right now, every fee shown
curl -s ${BASE}/api/v1/quote -H "${KEY_H}" -H "content-type: application/json" \\
  -d "{\\"wallet\\":\\"$WALLET\\",\\"mint\\":\\"$MINT\\",\\"side\\":\\"buy\\",\\"sol\\":0.1,\\"slippageBps\\":300}"

# 2. the unsigned transaction (base64 in .transaction), valid ~90 s
curl -s ${BASE}/api/v1/trade/build -H "${KEY_H}" -H "content-type: application/json" \\
  -d "{\\"wallet\\":\\"$WALLET\\",\\"mint\\":\\"$MINT\\",\\"side\\":\\"buy\\",\\"sol\\":0.1}" > build.json

# 3. sign it with your own key (any Solana library), then send the signed bytes back
curl -s ${BASE}/api/v1/trade/send -H "${KEY_H}" -H "content-type: application/json" \\
  -d "{\\"transaction\\":\\"<signed, base64>\\"}"
# → { "signature": "…", "status": "confirmed", "slot": 3…, "landedMs": 1180, "feeSol": 0.001, "explorer": "https://solscan.io/tx/…" }`, "bash");
const NODE = code(`// Node 20+.  npm i @solana/web3.js bs58
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
const H = { authorization: \`Bearer \${process.env.BLIX_KEY}\`, "content-type": "application/json" };
const kp = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_SECRET));   // your key stays in this process
const api = (p, body) => fetch(\`${BASE}/api/v1/\${p}\`, { method: "POST", headers: H, body: JSON.stringify(body) }).then((r) => r.json());

const built = await api("trade/build", { wallet: kp.publicKey.toBase58(), mint: MINT, side: "buy", sol: 0.1, slippageBps: 300 });
if (!built.transaction) throw new Error(built.error);
console.log("buys", built.quote.tokensOutUi, "tokens, fee", built.quote.feeSol, "SOL");
const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
tx.sign(kp);
const sent = await api("trade/send", { transaction: tx.serialize().toString("base64") });
console.log(sent.status, sent.signature, sent.landedMs, "ms", sent.explorer);

// later: sell everything
const sell = await api("trade/build", { wallet: kp.publicKey.toBase58(), mint: MINT, side: "sell", pct: 100 });`, "javascript");
const PY = code(`# pip install solders requests
import base64, os, requests
from solders.keypair import Keypair
from solders.transaction import Transaction

H = {"authorization": f"Bearer {os.environ['BLIX_KEY']}"}
kp = Keypair.from_base58_string(os.environ["WALLET_SECRET"])      # your key stays in this process
api = lambda p, body: requests.post(f"${BASE}/api/v1/{p}", json=body, headers=H, timeout=120).json()

built = api("trade/build", {"wallet": str(kp.pubkey()), "mint": MINT, "side": "buy", "sol": 0.1, "slippageBps": 300})
tx = Transaction.from_bytes(base64.b64decode(built["transaction"]))
tx.sign([kp], tx.message.recent_blockhash)
sent = api("trade/send", {"transaction": base64.b64encode(bytes(tx)).decode()})
print(sent["status"], sent["signature"], sent.get("landedMs"), "ms")`, "python");
const WS = code(`// Node 22+ (global WebSocket) or any browser. PumpPortal's method names, so an existing bot just changes the URL.
const ws = new WebSocket("wss://blixvip.com/api/v1/stream?key=" + process.env.BLIX_KEY);
ws.onopen = () => {
  ws.send(JSON.stringify({ method: "subscribeNewToken" }));                      // every pump.fun launch
  ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [MINT] }));      // every trade of these coins
  ws.send(JSON.stringify({ method: "subscribeAccountTrade", keys: [WALLET] }));  // every trade by these wallets
  ws.send(JSON.stringify({ method: "subscribeMigration" }));                     // curve → PumpSwap pool
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.txType === "buy" || m.txType === "sell") console.log(m.mint, m.txType, m.solAmount, "SOL", m.marketCapSol, "mcap SOL", m.pool);
};`, "javascript");
const WS_TABLE = table(["Method", "Event fields"], [
  ["<code>subscribeNewToken</code>", "<code>txType: \"create\"</code>, <code>mint</code>, <code>name</code>, <code>symbol</code>, <code>traderPublicKey</code> (the dev), <code>marketCapSol</code>, <code>solAmount</code> (the dev's first buy), <code>pool: \"pump\"</code>"],
  ["<code>subscribeTokenTrade</code> { keys }", "<code>signature</code>, <code>mint</code>, <code>traderPublicKey</code>, <code>txType: \"buy\"|\"sell\"</code>, <code>tokenAmount</code>, <code>solAmount</code>, <code>vTokensInBondingCurve</code>, <code>vSolInBondingCurve</code>, <code>marketCapSol</code>, <code>bondingCurveProgress</code>, <code>pool: \"pump\"|\"pump-amm\"</code>, <code>slot</code>"],
  ["<code>subscribeAccountTrade</code> { keys }", "The same trade event, for every trade signed by those wallets"],
  ["<code>subscribeMigration</code>", "<code>txType: \"migrate\"</code>, <code>mint</code>, <code>poolAddress</code>, <code>pool: \"pump-amm\"</code>"],
]);
const LIMITS = table(["Limit", "Per key"], [
  ["Quotes and builds", "120 a minute"],
  ["Sends", "60 a minute"],
  ["Live connections", "3; up to 200 coins and 200 wallets per connection"],
  ["Keys", "5 per account"],
  ["Buy size", "2 SOL per transaction"],
]);
const FEES = table(["", "Who pays", "How much"], [
  ["Blix's fee", "You, inside the transaction, to Blix's fee wallet", "2% of the SOL side; 1.6% if you joined through an invite. Your inviter earns 40% of it"],
  ["pump.fun's fee", "You, to pump.fun, inside the swap", "About 1% on the curve (protocol + creator share), the pool's own tier after bonding; shown in every quote as what the swap fills at"],
  ["Priority fee", "You, to the block's validator", "Default: what the coin's busiest recent trades paid, 0.0001 to 0.001 SOL; set <code>priorityFeeSol</code> to choose"],
  ["Sender tip", "You, to Helius Sender's tip account", "Default 0.00001 SOL for the staked path; 0.001 or more opens every path (Jito's too)"],
  ["Network fee", "You", "0.000005 SOL"],
  ["Subscription", "Nobody", "None. There is no plan to pick and no monthly bill"],
]);
const TRADE_MORE = links("More on the trade API", [
  ["/trade-api", "BLIX trade API", "Quote, build, send, stream, with your own wallet."],
  ["/pump-fun-trading-api", "pump.fun trading API", "PumpPortal, pumpdev and BLIX compared."],
  ["/gmgn-trading-api", "GMGN trading API", "GMGN's OpenAPI swaps beside BLIX's local-sign flow."],
  ["/axiom-trading-api", "Axiom trading API", "Is there one? What to use instead."],
  ["/fomo-trading-api", "Fomo trading API", "None official. The BLIX route."],
  ["/api", "BLIX data API", `${N_ENDPOINTS} endpoints and a live stream, with your account.`],
]);
const PHASES = `<h2 id="roadmap">What is live, and what is next</h2>
${table(["", "State"], [
  ["pump.fun bonding curve and PumpSwap pools, built by hand", "Live: quote, build, send, stream"],
  ["Raydium LaunchLab (Bonk, letsbonk) built by hand", "Next: the feed decoder exists, the buy and sell instructions follow"],
  ["Every other launchpad and pool (Meteora DBC and DAMM v2, Moonshot, Boop, Bags, Raydium, Orca) through Jupiter's router with Blix's fee", "Next: one integration covers the long tail"],
  ["MCP tools for build and send, so an agent reads Blix's Pulse and holders and acts with one key", "After that"],
  ["Token creation (pump.fun create, LaunchLab create), one wallet at a time", "Only if customers ask. No launch bundles, ever"],
], "cmp")}
<p>A coin the hand-built path does not recognise answers <code>409</code> with <code>"route": "unsupported"</code> rather than a wrong transaction.</p>`;

// ---------- /trade-api ----------
const hub = page({
  path: "/trade-api", crumb: "Trade API", og: "og-api.png", eyebrow: `Trade API · pump.fun and PumpSwap · 2% a trade · updated ${CHECKED}`,
  title: "Solana Trade API for pump.fun Bots: Your Wallet, Your Key, 2% a Trade | BLIX",
  description: "Quote, build and send pump.fun and PumpSwap trades from your own wallet through the BLIX trade API. Local-sign only, 2% a trade inside the transaction, staked sends, live stream.",
  h1: "The BLIX trade API: trade pump.fun from your own wallet",
  lede: `Four calls turn a BLIX account into a trading rail for your bot: <b>quote</b> a buy or sell on pump.fun's curve or its PumpSwap pool, <b>build</b> the transaction (unsigned, every fee inside), sign it with your own key and <b>send</b> it through Helius Sender's staked connections, and follow every launch, trade and migration on a <b>stream</b> that speaks PumpPortal's language. Blix never holds a key. The fee is 2% a trade (1.6% with an invite), paid inside the transaction, with no subscription. The same key reads the <a href="/api">${N_ENDPOINTS}-endpoint data API</a>: holders with snipers and bundles, candles, the AI's reads, the smart-money wallets.`,
  body: `${TRADE_CTA()}
${facts([["Venues live", "pump.fun bonding curve, PumpSwap pools"], FACT.fee, ["Keys", "Yours. Blix builds, you sign, Blix sends"], ["Sends", "Helius Sender staked path + RPCs, re-sent every second until it lands"], ["Stream", "WebSocket, PumpPortal-compatible methods"], ["Data", `The ${N_ENDPOINTS}-endpoint API and MCP connector, same key`], ["Price", "No plan, no monthly bill: the 1% is the price"], FACT.community])}
${KEYS_NOTE}
${CALLS}
<h2 id="flow">The flow, in curl</h2>
${CURL}
<h3>The request body</h3>
${BODY_TABLE}
<h2 id="node">Node</h2>
${NODE}
<h2 id="python">Python</h2>
${PY}
<h2 id="stream">The live stream</h2>
<p><code>wss://blixvip.com/api/v1/stream</code>, with your key as <code>Authorization: Bearer</code> or <code>?key=</code> from a browser. Messages in and out are JSON. The method names and event fields are PumpPortal's, so a bot already written against its data stream points at Blix by changing one URL.</p>
${WS}
${WS_TABLE}
<h2 id="fees">What a trade costs, exactly</h2>
${FEES}
<p>A quote shows every one of these before you build. The fee wallet, the referral share and the per-trade ledger are the same ones the terminal's one-click trades use; the API is another door to the same rail.</p>
${RULES}
<h2 id="limits">Limits</h2>
${LIMITS}
<p>Errors are JSON <code>{ "error": "a sentence" }</code> with a 4xx status; a <code>409</code> explains why the trade cannot happen (not enough SOL, nothing to sell, the coin just bonded and trades in its pool now, the price moved past your slippage). Nothing is spent on a refused or failed transaction.</p>
${PHASES}
<h2 id="data">Data, AI and trading under one key</h2>
<p>This is the part nobody else bundles. The key that signs for your bot also reads <code>/api/pulse</code> (every new pair, final stretch and migrated coin with holder stats and the AI's call), <code>/api/holders/&lt;mint&gt;</code> (dev, snipers, bundles, top-10 share), <code>/api/candles/&lt;mint&gt;</code> (candles from real trades) and <code>/api/research/&lt;mint&gt;</code> (the deep read with a grade and a plan). A bot that filters on the holder ledger and the AI's grade before it builds a buy is a few lines, and the <a href="/mcp">MCP connector</a> gives an agent the same data as tools. See the <a href="/how-to-build-a-solana-trading-bot">trading-bot guide</a>.</p>
${COMMUNITY}
${TRADE_MORE}
${RISK}`,
  faq: [
    ["Does Blix hold my private key?", `No. <code>build</code> returns an unsigned transaction; you sign it with your own key and post the signed bytes to <code>send</code>. There is no custodial wallet in the API.`],
    ["What does the trade API cost?", `2% of the SOL side of each trade, 1.6% if you joined BLIX through an invite, paid inside the transaction to Blix's fee wallet. No subscription, no per-call price, no key fee. Priority fees and Sender tips are yours and shown in every quote.`],
    ["Can I just use send as a free relay?", `No. <code>send</code> only accepts transactions <code>build</code> made, which carry the fee. Build your own transaction and you send it yourself, as you can today.`],
    ["Which coins can it trade?", `Today: any coin on pump.fun's bonding curve or in its PumpSwap pool, which is nearly every memecoin in its first hours and days. Other launchpads and pools come through Jupiter routing next; until then they answer 409 with <code>route: "unsupported"</code>.`],
    ["How fast does a trade land?", `The build reads the coin's accounts once and needs no router round trip; the send goes to Helius Sender's staked connections and the RPCs at the same time and is re-sent every second until a block holds it. The answer carries <code>landedMs</code>, measured from the send, and the slot. Speed also depends on your priority fee and tip, both yours to set per trade.`],
    ["Is the stream compatible with PumpPortal's?", `The method names (<code>subscribeNewToken</code>, <code>subscribeTokenTrade</code>, <code>subscribeAccountTrade</code>, <code>subscribeMigration</code>) and the trade event's fields follow PumpPortal's, so an existing client changes one URL. The source is Blix's own decoding of pump.fun and PumpSwap, the same feed the terminal shows.`],
    ["How do I get a key?", `Create a BLIX account (sign in with Google) and open this page again: your keys are at the top. Make one, copy it once, keep it private. Revoke it there too.`],
  ],
});

// ---------- the provider pages ----------
// Each page answers one question for one product and carries only what is its own: the comparison for that product,
// the one worked request that makes sense for someone arriving from it, and that product's own facts. The four
// calls, the rules, the limits and the roadmap live once, on /trade-api, and are linked, not repeated (the seven
// pages shared up to 53% of their text and risked being filtered as copies of each other; site audit 2026-10-12).
const HUB_LINKS = `<p class="note">The trade API itself is documented once: <a href="/trade-api#calls">the four calls</a>, <a href="/trade-api#flow">the flow in curl</a>, <a href="/trade-api#fees">what a trade costs</a>, <a href="/trade-api#rules">the rules</a>, <a href="/trade-api#limits">limits</a> and <a href="/trade-api#roadmap">what is live and what is next</a>.</p>`;

// ---------- /pump-fun-trading-api ----------
const PUMPPORTAL_SIDE_BY_SIDE = code(`# The same buy, 0.1 SOL of one coin, asked of each service.

# PumpPortal trade-local (no key; its 0.5% fee is inside the transaction it returns, as raw bytes to sign)
curl -s https://pumpportal.fun/api/trade-local -H "content-type: application/json" \\
  -d '{"publicKey":"'$WALLET'","action":"buy","mint":"'$MINT'","amount":0.1,"denominatedInSol":"true","slippage":3,"priorityFee":0.0001,"pool":"pump"}' \\
  --output tx.bin

# BLIX build (your key; Blix's fee inside; JSON with the quote beside the base64 transaction)
curl -s ${BASE}/api/v1/trade/build -H "${KEY_H}" -H "content-type: application/json" \\
  -d '{"wallet":"'$WALLET'","mint":"'$MINT'","side":"buy","sol":0.1,"slippageBps":300}'
# → { "transaction": "<base64>", "quote": { "tokensOutUi": …, "feeSol": 0.002, "priorityFeeSol": 0.0001, "marketCapSol": … }, "validForMs": 90000 }`, "bash");
const pump = page({
  path: "/pump-fun-trading-api", crumb: "pump.fun trading API", og: "og-api.png", eyebrow: `pump.fun trading APIs · checked ${CHECKED}`,
  title: "pump.fun Trading API: PumpPortal, pumpdev.io and BLIX Compared (2026) | BLIX",
  description: "The pump.fun trading APIs a bot can use in 2026: PumpPortal (0.5% local, 1% Lightning), pumpdev.io, Jupiter, and the BLIX trade API with your own wallet, data and AI under one key.",
  h1: "pump.fun trading API: what a bot can use today",
  lede: `pump.fun publishes its programs and IDLs, not a hosted trading API, so bots trade through a third party that builds the transaction. For two years that has meant <a href="https://pumpportal.fun" rel="noopener">PumpPortal</a>; since then clones such as pumpdev.io and Jupiter's router have appeared, and now <a href="/trade-api">the BLIX trade API</a>. This page lays them side by side: what each builds, what it charges, whether it holds your key, how a request to each looks, and what else comes with the key.`,
  body: `${TRADE_CTA()}
${facts([["pump.fun itself", "Programs and IDLs published; no hosted trade API"], ["PumpPortal", "Local 0.5% a trade; Lightning (custodial) 1%; trade stream needs a funded key"], ["pumpdev.io", "A PumpPortal clone: 0.25% client-side, 0.5% custodial; small, unlicensed"], ["Jupiter", "Free routing across launchpads; integrators add their own fee"], ["BLIX", "2% (1.6% invited), local-sign only, staked sends, data + AI + stream on the same key"], FACT.community])}
<h2 id="compare">Side by side</h2>
${table(["", "PumpPortal", "pumpdev.io", "Jupiter Swap API", "BLIX trade API"], [
    ["Builds", "pump.fun curve, PumpSwap, Bonk", "pump.fun curve, PumpSwap (not delivered in our test)", "Every Solana DEX and launchpad it indexes", "pump.fun curve and PumpSwap by hand; the rest through Jupiter next"],
    ["Fee", "0.5% local, 1% Lightning", "0.25% client-side, 0.5% custodial", "None to callers; integrators add theirs", "2% a trade, 1.6% with an invite, inside the transaction"],
    ["Your key", "Local API: yours. Lightning: PumpPortal holds a wallet for you", "Client-side: yours. Custodial wallets offered", "Yours", "Yours, always. No custodial option"],
    ["Auth", "None for trade-local; an API key (funded) for Lightning and the trade stream", "API key", "Free tier keyless; a key from Jupiter's portal for higher limits", "Bearer key made on /trade-api, 5 per account"],
    ["Sends", "Jito bundles optional", "Jito bundles", "You send", "Helius Sender staked path + RPCs, re-sent until it lands, landing reported"],
    ["Stream", "Launches and trades; token trade stream metered", "Free websocket", "None", "WebSocket, PumpPortal's method names, with the account"],
    ["Data beyond trades", "No", "No", "Price API", `${N_ENDPOINTS} endpoints: holders with snipers and bundles, candles, AI reads, wallets`],
    ["Launch bundles", "Yes", "Yes", "No", "No, by design"],
  ], "cmp")}
<p>Sources: ${ext("https://pumpportal.fun", "PumpPortal")}, pumpdev.io's published code and pricing, ${ext("https://dev.jup.ag/docs/", "Jupiter developer docs")} and pump.fun's published program interfaces, checked ${CHECKED}. Request shapes are the ones each service documents on that date; check its docs for the current field list before you ship.</p>
<h2 id="request">The same request to PumpPortal and to BLIX</h2>
<p>PumpPortal's <code>trade-local</code> answers with the raw transaction bytes and nothing else; BLIX's <code>build</code> answers with the transaction and the quote it was built from, so a bot can refuse a fill it does not like before it signs. Both are signed by you.</p>
${PUMPPORTAL_SIDE_BY_SIDE}
<h2 id="pumpportal">Moving a PumpPortal bot over</h2>
${steps([
    `<b>Trades.</b> Where you posted to <code>trade-local</code>, post to <code>${BASE}/api/v1/trade/build</code> with <code>wallet</code>, <code>mint</code>, <code>side</code> and <code>sol</code> or <code>pct</code>; sign the returned <code>transaction</code> exactly as before and post the signed bytes to <code>/api/v1/trade/send</code> instead of your own RPC. The answer carries the signature, status, slot and landing time.`,
    `<b>Slippage and fees.</b> PumpPortal's <code>slippage</code> is a percentage; BLIX's <code>slippageBps</code> is basis points (3% = 300). PumpPortal's <code>priorityFee</code> and BLIX's <code>priorityFeeSol</code> are both SOL per transaction.`,
    `<b>Stream.</b> Point the WebSocket at <code>wss://blixvip.com/api/v1/stream</code> with your key; <code>subscribeNewToken</code>, <code>subscribeTokenTrade</code>, <code>subscribeAccountTrade</code> and <code>subscribeMigration</code> work as they did, and the trade event's fields keep their names.`,
    `<b>Filters.</b> Before a buy, read <code>GET /api/holders/&lt;mint&gt;</code> (dev share and whether the dev sold, snipers, bundles, top-10 share) and the row's AI call from <code>GET /api/pulse</code>; both are on the same key.`,
  ])}
${HUB_LINKS}
${TRADE_MORE}
${NOT_AFFILIATED("pump.fun, PumpPortal, pumpdev.io or Jupiter")}${RISK}`,
  faq: [
    ["Does pump.fun have an official trading API?", `No hosted one. pump.fun publishes its on-chain programs and IDLs; bots trade through a service that builds the transaction (PumpPortal, pumpdev.io, BLIX) or through Jupiter's router.`],
    ["What is the cheapest pump.fun trading API?", `pumpdev.io advertises 0.25% client-side and PumpPortal 0.5% local; Jupiter is free to callers. BLIX charges 2% (1.6% with an invite) and bundles the data, the AI reads, the staked send path and the stream under the same key; whether that is worth the difference is your call, and the quote shows the fee before every build.`],
    ["Is the BLIX trade API custodial?", `No. There is no Lightning-style wallet: you sign every transaction with your own key.`],
    ["Can I trade coins that already left pump.fun?", `PumpSwap pools, yes. Raydium, Meteora and other pools come with Jupiter routing in the next phase.`],
  ],
});

// ---------- /gmgn-trading-api ----------
const GMGN_SIDE_BY_SIDE = code(`// Node 20+. The GMGN shape is the one its docs describe (a route, then a proxy send); check them for the current parameters.
const sol = "So11111111111111111111111111111111111111112";

// GMGN: ask for a swap route (the transaction comes back built), then send the signed bytes through GMGN's proxy
const route = await fetch(\`https://gmgn.ai/defi/router/v1/sol/tx/get_swap_route?token_in_address=\${sol}&token_out_address=\${MINT}&in_amount=100000000&from_address=\${WALLET}&slippage=3\`).then((r) => r.json());
// … sign route.data.raw_tx.swapTransaction with your key, then POST it to https://gmgn.ai/txproxy/v1/send_transaction

// BLIX: the build carries the quote; sign it and hand it back to send (staked path, re-sent until it lands)
const H = { authorization: \`Bearer \${process.env.BLIX_KEY}\`, "content-type": "application/json" };
const built = await fetch("${BASE}/api/v1/trade/build", { method: "POST", headers: H, body: JSON.stringify({ wallet: WALLET, mint: MINT, side: "buy", sol: 0.1, slippageBps: 300 }) }).then((r) => r.json());
if (built.quote.feeSol > 0.003) throw new Error("fee higher than expected");   // the quote is there to be checked
// … sign built.transaction, then POST { transaction } to ${BASE}/api/v1/trade/send`, "javascript");
const gmgn = page({
  path: "/gmgn-trading-api", crumb: "GMGN trading API", og: "og-gmgn.png", eyebrow: `GMGN trading API · checked ${CHECKED}`,
  title: "GMGN Trading API: Swaps Through the OpenAPI vs the BLIX Trade API | BLIX",
  description: "How trading through GMGN's OpenAPI works (Ed25519 key, private key on their side of the request, IP whitelist, no published prices) and how the BLIX trade API does the same trade with your key never leaving your machine.",
  h1: "GMGN trading API, and the BLIX trade API beside it",
  lede: `GMGN has an official API: the GMGN OpenAPI, with agent "skills" wrapped around it. Data calls need a key you create at gmgn.ai/ai by uploading an Ed25519 public key; <b>swaps</b> also need the matching private key configured for the request and a whitelisted IP address, and GMGN publishes no prices or rate limits. The <a href="/trade-api">BLIX trade API</a> takes a different shape: Blix builds the transaction for your wallet, you sign it where your key already lives, Blix sends it over staked connections and reports where it landed. This page compares the two for a bot on Solana, request by request.`,
  body: `${TRADE_CTA()}
${facts([["GMGN OpenAPI", "Key by application (Ed25519 public key); swaps need the private key and an IP whitelist"], ["GMGN price", "Not published in its docs"], ["GMGN chains", "Solana, BSC, Base, more announced"], ["BLIX", "pump.fun curve and PumpSwap by hand; 2% (1.6% invited); local-sign; Solana"], ["Same key", `${N_ENDPOINTS} data endpoints, AI reads, MCP connector`], FACT.community])}
<h2 id="compare">Trading through each</h2>
${table(["", "GMGN OpenAPI", "BLIX trade API"], [
    ["Getting access", "Create a key at gmgn.ai/ai with an Ed25519 public key", "Sign in with Google, open /trade-api, make a key"],
    ["Who signs", "Your private key is configured for GMGN's swap requests; requests must come from a whitelisted IP", "You, on your machine, with any Solana library. Blix never sees the key"],
    ["Fee", "Not published; the terminal charges about 1%", "2% a trade, 1.6% with an invite, inside the transaction"],
    ["Rate limits", "Not published", "120 quotes and builds, 60 sends a minute per key"],
    ["Venues", "Solana, BSC, Base", "pump.fun curve and PumpSwap today; other pools through Jupiter next"],
    ["Sends", "GMGN's", "Helius Sender staked path + RPCs, re-sent until it lands, landing reported"],
    ["Stream", "Not part of the OpenAPI", "WebSocket, PumpPortal-compatible"],
    ["Data on the same key", "Tokens, market, wallets, K-lines", `Pulse, holders with snipers and bundles, candles from real trades, AI grades, smart-money wallets (${N_ENDPOINTS} endpoints)`],
    ["Agent tools", "GMGN skills", `MCP connector with every account`],
  ], "cmp")}
<p>Sources: ${ext("https://docs.gmgn.ai/index/gmgn-agent-api", "GMGN Agent API docs")}, checked ${CHECKED}. GMGN's terms and access rules govern its API; BLIX's API is BLIX's own and not a way around them.</p>
<h2 id="request">The same buy, request by request</h2>
<p>The shapes differ in one way that matters to a bot: GMGN returns a route to sign, BLIX returns a quote with the transaction, so the fee, the fill and the priority fee can be checked in code before anything is signed.</p>
${GMGN_SIDE_BY_SIDE}
<h2 id="moving">What changes when a GMGN bot moves</h2>
${bullets([
    "<b>No key upload, no whitelist.</b> There is nothing to register but an account; the key is made on the page and sent as a bearer header from anywhere.",
    "<b>Solana only.</b> A BSC or Base leg stays on GMGN (or Jupiter has nothing for it either); BLIX trades pump.fun's curve and PumpSwap today.",
    "<b>The data side maps cleanly.</b> GMGN's token, wallet and K-line calls have counterparts in <code>/api/token</code>, <code>/api/wallet-page</code> and <code>/api/candles</code> on the same key, and <a href=\"/gmgn-api\">the GMGN API page</a> walks through them.",
  ])}
${HUB_LINKS}
${TRADE_MORE}
${links("More on GMGN", [["/gmgn-api", "GMGN API", "The data side: access, limits, what it covers."], ["/compare/gmgn-alternative", "GMGN alternative", "BLIX beside GMGN."], ["/axiom-vs-gmgn", "Axiom vs GMGN", "Speed versus multi-chain."]])}
${NOT_AFFILIATED("GMGN")}${RISK}`,
  faq: [
    ["Can I trade through the GMGN API?", `Yes. GMGN's OpenAPI supports swaps on Solana, BSC and Base; trading requests need the private key matching your uploaded public key and must come from a whitelisted IP. Prices and rate limits are not in its public docs as of ${CHECKED}.`],
    ["How is the BLIX trade API different?", `Blix builds the transaction and sends it; you sign it. No private key is configured anywhere but your own machine, there is no IP whitelist, and the fee is published: 2% a trade, 1.6% with an invite, inside the transaction.`],
    ["Does BLIX trade on BSC or Base?", `No. Solana only: pump.fun's curve and PumpSwap pools today, the other Solana launchpads and pools through Jupiter next.`],
  ],
});

// ---------- /axiom-trading-api ----------
const AXIOM_FILTER_SELL = code(`// Node 20+. An Axiom-style rule as code: watch the Final stretch, act on the holder ledger, sell half once it bonds.
const H = { authorization: \`Bearer \${process.env.BLIX_KEY}\`, "content-type": "application/json" };
const api = (p, body) => fetch(\`${BASE}/api/\${p}\`, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H }).then((r) => r.json());

const pulse = await api("pulse");                       // the three tables Axiom's Pulse shows, as rows
const pick = pulse.final.find((c) => c.hl.t10 < 25 && c.hl.bd < 10 && c.hl.sn < 15 && !c.hl.ds && c.ai?.call === "buy");
if (!pick) process.exit();                               // nothing passes the filter this minute
const built = await api("v1/trade/build", { wallet: WALLET, mint: pick.mint, side: "buy", sol: 0.2, slippageBps: 300 });
// … sign built.transaction with your key, POST { transaction } to v1/trade/send

// later, once the migration event arrives on the stream: take half off
const half = await api("v1/trade/build", { wallet: WALLET, mint: pick.mint, side: "sell", pct: 50 });`, "javascript");
const axiom = page({
  path: "/axiom-trading-api", crumb: "Axiom trading API", og: "og-axiom.png", eyebrow: `Axiom trading API · checked ${CHECKED}`,
  title: "Axiom Trading API: No Official One. Trade Programmatically With BLIX | BLIX",
  description: "Axiom Trade publishes no public trading API or SDK; unofficial SDKs sign in as your account. The BLIX trade API builds pump.fun and PumpSwap trades for your own wallet: you sign, Blix sends, 2% a trade.",
  h1: "Axiom trading API: what exists, and what to use instead",
  lede: `Axiom Trade is the fast terminal: Pulse, limit orders, MEV modes, a migration sniper, Hyperliquid perps. What it does not publish, as of ${CHECKED}, is a trading API, an SDK or developer docs. The "Axiom APIs" you find are unofficial libraries that drive your own Axiom account through its private endpoints, which can break with any release and put your account's session in a bot's hands. If what you want is to trade pump.fun programmatically with Axiom-grade speed, the <a href="/trade-api">BLIX trade API</a> is built for exactly that, with your own wallet, and Axiom's Pulse filters exist as fields you can code against.`,
  body: `${TRADE_CTA()}
${facts([["Axiom public API", "None published; unofficial SDKs use your account's session"], ["Axiom fee", "1%, less 0.05–0.25% cashback by volume"], ["BLIX trade API", "pump.fun curve and PumpSwap by hand; 2% (1.6% invited); local-sign"], ["Sends", "Helius Sender staked path, re-sent until it lands"], ["Same key", `${N_ENDPOINTS} data endpoints, AI reads, stream`], FACT.community])}
<h2 id="compare">A bot's options</h2>
${table(["", "Unofficial Axiom SDKs", "BLIX trade API"], [
    ["Status", "Reverse-engineered; break with Axiom's releases", "A documented, versioned API (v1)"],
    ["What a bot holds", "Your Axiom session (your account)", "An API key that can only build and send for wallets you sign with"],
    ["Who signs", "Axiom's wallet, through your session", "You, with your own key"],
    ["Fee", "Axiom's 1% less cashback", "2% a trade, 1.6% with an invite, inside the transaction"],
    ["Speed path", "Axiom's", "No router round trip: one account read, then staked sends with your priority fee and tip"],
    ["Stream", "Axiom's private websocket", "WebSocket, PumpPortal-compatible, with the account"],
    ["Data on the same key", "Axiom's private endpoints", `Pulse, holders with snipers and bundles, candles, AI grades, wallets (${N_ENDPOINTS} endpoints)`],
  ], "cmp")}
<p>Axiom's own documentation describes Pulse's three tables and filters (${ext("https://docs.axiom.trade/axiom/finding-tokens/pulse", "docs.axiom.trade")}); it lists no developer API. Facts checked ${CHECKED}.</p>
<h2 id="pulse">Axiom's Pulse filters, as API fields</h2>
<p>The filters Axiom's Pulse offers (age, top-10 %, dev %, snipers %, insiders %, bundle %, holders, liquidity, volume, market cap, transactions) are fields on every row of <code>GET /api/pulse</code> (<code>hl.t10</code>, <code>hl.dev</code>, <code>hl.ds</code>, <code>hl.sn</code>, <code>hl.bd</code>, <code>buys</code>, <code>sells</code>, <code>liveVol</code>, <code>mcap</code>), so the screen you filter by hand on Axiom is a filter in your bot here, with the build call one line later. See the <a href="/axiom-api">Axiom API page</a> for the data side.</p>
<h2 id="rule">A Pulse rule as code: buy on the ledger, sell half on migration</h2>
${AXIOM_FILTER_SELL}
<h2 id="wallet">Bringing an Axiom wallet with you</h2>
${steps([
    "Axiom's wallets are Turnkey wallets with exportable keys: export the private key from Axiom's wallet settings (its docs describe the steps) and keep it on the machine the bot runs on.",
    `Load it in your bot (<code>Keypair.fromSecretKey</code> in web3.js, <code>Keypair.from_base58_string</code> in solders); its public address is the <code>wallet</code> in every BLIX call. Blix reads its SOL and token balances to size and check each trade and never asks for the key.`,
    "Nothing moves: the wallet keeps its SOL and positions, and Axiom's app still opens it. The bot and the app now trade the same wallet, which is also the simplest way to compare fills.",
  ])}
${HUB_LINKS}
${TRADE_MORE}
${links("More on Axiom", [["/axiom-api", "Axiom API", "The data side and the unofficial SDKs."], ["/axiom-trading-bot", "Axiom trading bot", "Why there is no official one."], ["/axiom-trade", "Axiom Trade", "What it is, fees, features."]])}
${NOT_AFFILIATED("Axiom Trade")}${RISK}`,
  faq: [
    ["Does Axiom have a trading API?", `Not a public one, as of ${CHECKED}. Unofficial SDKs drive your own Axiom account through its private endpoints; they can break with any release and hold your session.`],
    ["Can a bot trade as fast as Axiom through BLIX?", `The build reads the coin's accounts once (no router round trip) and the send goes over Helius Sender's staked connections and the RPCs at the same time, re-sent every second until a block holds it, with your priority fee and tip per trade. The answer reports the landing time and slot, so you measure rather than take our word.`],
    ["Does the BLIX trade API do limit orders or MEV modes?", `Not yet. It builds and sends market buys and sells today; your bot holds the order logic. Exits with take profit, stop loss and trailing stop run in the terminal.`],
  ],
});

// ---------- /fomo-trading-api ----------
const FOMO_FLOW_PY = code(`# pip install solders requests   (Python 3.10+)
import base64, os, requests
from solders.keypair import Keypair
from solders.transaction import Transaction

H = {"authorization": f"Bearer {os.environ['BLIX_KEY']}"}
kp = Keypair.from_base58_string(os.environ["WALLET_SECRET"])        # your key stays in this process
get = lambda p: requests.get(f"${BASE}/api/{p}", headers=H, timeout=30).json()
post = lambda p, body: requests.post(f"${BASE}/api/{p}", json=body, headers=H, timeout=120).json()

# 1. what Fomo's leaderboard traders are buying right now: flow per coin, from the chain
flow = get("fomo")["flow"]                                           # [{mint, symbol, buyers, netSol, ...}, ...]
coin = max(flow, key=lambda c: c["buyers"])                          # the coin the most of them bought

# 2. the ledger before the trade: a coin five Fomo traders bought can still be a bundle
h = get(f"holders/{coin['mint']}")
if h["bundles"]["pct"] > 15 or h["dev"]["sold"]:
    raise SystemExit("ledger says no")

# 3. the trade, from your own wallet
built = post("v1/trade/build", {"wallet": str(kp.pubkey()), "mint": coin["mint"], "side": "buy", "sol": 0.05, "slippageBps": 300})
tx = Transaction.from_bytes(base64.b64decode(built["transaction"]))
tx.sign([kp], tx.message.recent_blockhash)
sent = post("v1/trade/send", {"transaction": base64.b64encode(bytes(tx)).decode()})
print(sent["status"], sent["signature"], sent.get("landedMs"), "ms")`, "python");
const fomo = page({
  path: "/fomo-trading-api", crumb: "Fomo trading API", og: "og-fomo.png", eyebrow: `Fomo trading API · checked ${CHECKED}`,
  title: "Fomo Trading API: None Official. Trade pump.fun With the BLIX Trade API | BLIX",
  description: "Fomo (fomo.family) publishes no trading API; third-party Fomo APIs resell data. The BLIX trade API builds pump.fun and PumpSwap trades for your own wallet, 2% a trade, and reads Fomo's traders from the chain.",
  h1: "Fomo trading API: none official, and the BLIX route",
  lede: `Fomo (fomo.family) is a social trading app: a feed of other traders' buys, sells and theses, one-tap trades with network fees covered, perps, clans. It publishes no trading API, SDK or developer docs as of ${CHECKED}, and its backend needs the app's own login. The third-party "Fomo APIs" sell data on credits, not trades. What people searching for a Fomo trading API usually want is to act on what Fomo's traders are buying, programmatically. The <a href="/trade-api">BLIX trade API</a> does the trade with your own wallet, and the same key reads what Fomo's leaderboard traders are buying, from the chain. Below: the whole loop in one Python script.`,
  body: `${TRADE_CTA()}
${facts([["Fomo public API", "None; third-party Fomo APIs resell data on credits"], ["Fomo fee", "About 0.5% spot, quoted per trade; network fees covered"], ["BLIX trade API", "pump.fun curve and PumpSwap by hand; 2% (1.6% invited); local-sign"], ["Fomo's traders in BLIX", "<code>GET /api/fomo</code>: what they are buying, flow per coin, top traders"], ["Same key", `${N_ENDPOINTS} data endpoints, stream, MCP connector`], FACT.community])}
<h2 id="compare">What a bot gets</h2>
${table(["", "Fomo", "Third-party Fomo APIs", "BLIX"], [
    ["Trading API", "None", "None (data only)", "Quote, build, send with your own wallet"],
    ["What Fomo traders buy", "In the app's feed", "Leaderboards and holders, metered by credits", "<code>GET /api/fomo</code> and <code>/api/fomo/board</code>, from the chain, with the account"],
    ["Fee", "About 0.5% spot in the app", "Credits per call", "2% a trade, 1.6% with an invite, inside the transaction"],
    ["Who signs", "Fomo's non-custodial app", "Not applicable", "You, with your own key"],
    ["Reads", "The app", "Per-credit", "1,200 API reads a minute per address; 120 builds and 60 sends a minute per key"],
    ["Stream", "None public", "Websocket alerts, metered", "WebSocket, PumpPortal-compatible"],
  ], "cmp")}
<p>Sources: ${ext("https://fomo.family", "fomo.family")}, ${ext("https://newsletter.fomo.family/", "the Fomo newsletter")}, checked ${CHECKED}. Beware of Telegram bots calling themselves the "official Fomo bot": Fomo publishes none.</p>
<h2 id="loop">The loop: read the flow, check the ledger, trade</h2>
<p><code>GET /api/fomo</code> lists what Fomo's leaderboard traders are buying right now (flow per coin, sampled from the swaps Fomo sponsors) and the top traders by observed profit; <code>GET /api/wallet-page/&lt;wallet&gt;</code> opens any of them from the chain. The holder ledger is the check between seeing a buy and copying it, and the trade is three calls on the same key.</p>
${FOMO_FLOW_PY}
<p class="note">The script copies nothing automatically: it reads, checks and makes one trade when you run it. A loop around it, position sizing and the exits are your bot's.</p>
${HUB_LINKS}
${TRADE_MORE}
${links("More on Fomo", [["/fomo-api", "Fomo API", "Is there one? What the unofficial ones sell."], ["/fomo-trading-bot", "Fomo trading bot", "Why there is no official one."], ["/fomo-app", "The Fomo app", "What it is, fees, chains."]])}
${NOT_AFFILIATED("Fomo (Fomo Labs)")}${RISK}`,
  faq: [
    ["Does Fomo have a trading API?", `No. Fomo publishes no trading API, SDK or developer docs as of ${CHECKED}; its backend requires the app's login. Third-party "Fomo APIs" resell data on credits and do not trade.`],
    ["Can I copy Fomo traders automatically through BLIX?", `BLIX gives you what they are buying (<code>GET /api/fomo</code>) and the trade rail (<code>/api/v1/trade/build</code> and <code>send</code>) under one key; the copying logic and the decision are your bot's. BLIX does not mirror trades for you.`],
    ["Do I need a Fomo account?", `No. Nothing here touches a Fomo account: BLIX reads public on-chain activity, and you trade with your own wallet.`],
  ],
});

// ---------- /photon-trading-api ----------
const PHOTON_SNIPER = code(`// Node 22+ (global WebSocket). A Photon-style sniper: every launch as an event, a filter, then the build.
const H = { authorization: \`Bearer \${process.env.BLIX_KEY}\`, "content-type": "application/json" };
const ws = new WebSocket("wss://blixvip.com/api/v1/stream?key=" + process.env.BLIX_KEY);
ws.onopen = () => ws.send(JSON.stringify({ method: "subscribeNewToken" }));
ws.onmessage = async (e) => {
  const m = JSON.parse(e.data);
  if (m.txType !== "create" || m.solAmount < 1) return;                         // the dev bought at least 1 SOL
  const h = await fetch(\`${BASE}/api/holders/\${m.mint}\`, { headers: H }).then((r) => r.json());
  if (h.bundles.pct > 10 || h.snipers.pct > 20) return;                          // first-block wallets hold too much
  const built = await fetch("${BASE}/api/v1/trade/build", { method: "POST", headers: H,
    body: JSON.stringify({ wallet: WALLET, mint: m.mint, side: "buy", sol: 0.1, slippageBps: 500, priorityFeeSol: 0.0005, tipSol: 0.001 }) }).then((r) => r.json());
  // … sign built.transaction, POST { transaction } to ${BASE}/api/v1/trade/send; the answer carries landedMs and the slot
};`, "javascript");
const photon = page({
  path: "/photon-trading-api", crumb: "Photon trading API", og: "og-api.png", eyebrow: `Photon trading API · checked ${CHECKED}`,
  title: "Photon Trading API: None Public. Trade pump.fun Programmatically With BLIX | BLIX",
  description: "Photon publishes no trading API or SDK. The BLIX trade API builds pump.fun and PumpSwap trades for your own wallet: you sign, Blix sends, 2% a trade, with holders and AI reads on the same key.",
  h1: "Photon trading API: what exists, and the BLIX route",
  lede: `Photon is one of the fast Solana terminals: a sniper, quick buys, about 1% a trade, with a wallet generated in the app. As of ${CHECKED} it publishes no trading API, SDK or developer documentation, so "Photon API" wrappers you find drive the website or your account, and break when Photon changes. If you want Photon-style speed from a bot, the <a href="/trade-api">BLIX trade API</a> builds the transaction for your own wallet in one account read and sends it over staked connections; the sniper people use Photon for is a short script against the stream, shown below.`,
  body: `${TRADE_CTA()}
${facts([["Photon public API", "None published"], ["Photon fee", "About 1% (0.75% quoted by some reviews; 1% with the sniper)"], ["BLIX trade API", "pump.fun curve and PumpSwap by hand; 2% (1.6% invited); local-sign"], ["Sends", "Helius Sender staked path + RPCs, re-sent until it lands"], ["Same key", `${N_ENDPOINTS} data endpoints, AI reads, stream`], FACT.community])}
<h2 id="compare">A bot's options</h2>
${table(["", "Photon", "BLIX trade API"], [
    ["Trading API", "None; the app only", "Quote, build, send with your own wallet"],
    ["Who signs", "Photon's in-app wallet", "You, with your own key. Blix never sees it"],
    ["Fee", "About 1%", "2% a trade, 1.6% with an invite, inside the transaction"],
    ["Speed path", "Photon's", "One account read, no router round trip, staked sends with your priority fee and tip; landing time reported"],
    ["Sniping", "In the app, by hand", "Your script on the launch stream (below); 3 live connections per key"],
    ["Stream", "None public", "WebSocket, PumpPortal-compatible"],
    ["Data on the same key", "None", `Pulse, holders with snipers and bundles, candles, AI grades, wallets (${N_ENDPOINTS} endpoints)`],
  ], "cmp")}
<p>Facts about Photon checked ${CHECKED} against its site and public reviews; Photon's terms govern its product.</p>
<h2 id="sniper">A Photon-style sniper, as a script</h2>
<p>Photon's sniper waits for a launch and buys on your settings. The same thing as code is the launch stream, a filter on the holder ledger, and a build with a higher priority fee and tip for the first seconds; what to filter on and how much to risk stay yours.</p>
${PHOTON_SNIPER}
<p class="note">Sniping new launches is the riskiest trade on pump.fun: most coins bought in their first seconds go to zero, and a bundle can be invisible until the ledger is read. The filter above is a starting point, not advice.</p>
<h2 id="wallet">Using your Photon wallet in the bot</h2>
<p>Photon generates a wallet in the app and lets you export its private key; a bot can trade that same wallet through BLIX by loading the key locally and passing its address as <code>wallet</code>. Alternatively make a fresh keypair for the bot and fund it: the API treats any Solana address the same, and Blix never holds the key either way.</p>
${HUB_LINKS}
${TRADE_MORE}
${links("More on Photon", [["/photon-alternative", "Photon alternative", "BLIX beside Photon."], ["/axiom-vs-photon", "Axiom vs Photon", "The two fast ones."], ["/best-solana-trading-terminal", "Best Solana trading terminal", "All of them on one table."]])}
${NOT_AFFILIATED("Photon")}${RISK}`,
  faq: [
    ["Does Photon have an API?", `No public one as of ${CHECKED}. Photon is used through its website; wrappers that claim to be a Photon API drive the site or your account and can break with any release.`],
    ["Can I build a Photon-style sniper on BLIX?", `The pieces are there: the live stream (every launch and trade as events), the holder ledger and AI grade to filter on, and <code>build</code> + <code>send</code> to act with your own wallet. The sniping logic and the risk are yours.`],
    ["Is the BLIX trade API custodial?", `No. You sign every transaction with your own key.`],
  ],
});

// ---------- /bullx-trading-api ----------
const BULLX_EXIT_PY = code(`# pip install solders requests   (Python 3.10+). Rebuild the exits a BullX position had: a sell, and following it until it lands.
import base64, os, time, requests
from solders.keypair import Keypair
from solders.transaction import Transaction

H = {"authorization": f"Bearer {os.environ['BLIX_KEY']}"}
kp = Keypair.from_base58_string(os.environ["WALLET_SECRET"])
api = lambda m, p, **kw: requests.request(m, f"${BASE}/api/{p}", headers=H, timeout=120, **kw).json()

# what the wallet holds now, from the chain (the positions BullX showed are just token accounts)
me = api("GET", f"wallet-page/{kp.pubkey()}")
for pos in me["positions"]:
    if pos["pnlPct"] < -40 or pos["pnlPct"] > 150:                               # your exit rule
        built = api("POST", "v1/trade/build", json={"wallet": str(kp.pubkey()), "mint": pos["mint"], "side": "sell", "pct": 100})
        if "transaction" not in built: print(pos["symbol"], built["error"]); continue   # e.g. 409 route unsupported
        tx = Transaction.from_bytes(base64.b64decode(built["transaction"]))
        tx.sign([kp], tx.message.recent_blockhash)
        sent = api("POST", "v1/trade/send", json={"transaction": base64.b64encode(bytes(tx)).decode()})
        while sent["status"] == "sent":                                            # follow it until it lands or expires
            time.sleep(1); sent = api("GET", f"v1/trade/{sent['signature']}")
        print(pos["symbol"], sent["status"], sent.get("slot"))`, "python");
const bullx = page({
  path: "/bullx-trading-api", crumb: "BullX trading API", og: "og-api.png", eyebrow: `BullX trading API · checked ${CHECKED}`,
  title: "BullX Trading API: Trading Suspended, No API. Use the BLIX Trade API | BLIX",
  description: "BullX suspended trading on June 1, 2026 and never published a trading API. The BLIX trade API builds pump.fun and PumpSwap trades for your own wallet, 2% a trade, with data, AI reads and a live stream on the same key.",
  h1: "BullX trading API: none, and trading is suspended",
  lede: `BullX (and BullX Neo) suspended trading on June 1, 2026; withdrawals stayed open and as of ${CHECKED} no relaunch date had been published. It never offered a public trading API or SDK, so a "BullX bot" always meant automating your own account through its web app. For programmatic pump.fun trading today, the <a href="/trade-api">BLIX trade API</a> is a documented rail with your own wallet: Blix builds, you sign, Blix sends. This page is about the move: getting funds out of BullX, and rebuilding the automatic exits BullX positions had.`,
  body: `${TRADE_CTA()}
${facts([["BullX status", "Trading suspended since June 1, 2026; withdrawals open; no relaunch date published"], ["BullX API", "None, before or since"], ["BLIX trade API", "pump.fun curve and PumpSwap by hand; 2% (1.6% invited); local-sign"], ["Sends", "Helius Sender staked path + RPCs, landing reported"], ["Same key", `${N_ENDPOINTS} data endpoints, AI reads, stream`], FACT.community])}
<h2 id="compare">Where to take a BullX bot</h2>
${table(["", "BullX", "BLIX trade API"], [
    ["Trading", "Suspended", "Live: quote, build, send"],
    ["API", "None", "Documented v1, your own key"],
    ["Who signs", "BullX's in-app wallets", "You, with your own key"],
    ["Fee", "Was about 0.9–1%", "2% a trade, 1.6% with an invite, inside the transaction"],
    ["Exits", "Take profit and stop loss in the app", "In the terminal for one-click trades; in your own code for the API (below)"],
    ["Stream", "None public", "WebSocket, PumpPortal-compatible"],
    ["Data on the same key", "None", `Pulse, holders with snipers and bundles, candles, AI grades, wallets (${N_ENDPOINTS} endpoints)`],
  ], "cmp")}
<p>If you hold funds on BullX, withdraw them first; nothing here touches a BullX account. Facts checked ${CHECKED}.</p>
<h2 id="out">Getting out of BullX</h2>
${steps([
    "Withdraw from BullX while withdrawals are open: SOL and any tokens you still hold go to an address you control. BullX's in-app wallets were never meant to be exported, so send the funds rather than the key.",
    "Make a keypair for the bot (or reuse a wallet you already hold the key for) and keep it on the bot's machine. Its public address is the <code>wallet</code> in every BLIX call.",
    `Open <code>GET /api/wallet-page/&lt;wallet&gt;</code>: the positions BullX showed are token accounts on the chain, and BLIX reads them from there, with the entry price it can see and the live profit.`,
  ])}
<h2 id="exits">Rebuilding the exits</h2>
<p>A BullX position carried a take profit and a stop loss. Through the API those are your rule, run against the wallet's live positions; the script sells everything that crosses it and follows each send until the chain confirms it.</p>
${BULLX_EXIT_PY}
<p class="note">A coin in a pool the hand-built path does not cover answers <code>409</code> with <code>"route": "unsupported"</code> rather than a wrong transaction; sell those through the terminal or Jupiter until the routed build ships.</p>
${HUB_LINKS}
${TRADE_MORE}
${links("More on BullX", [["/compare/bullx-alternative", "BullX alternative", "Where to go after the suspension."], ["/axiom-vs-bullx", "Axiom vs BullX", "Head to head."], ["/fomo-vs-bullx", "Fomo vs BullX", "Social versus the suspended terminal."]])}
${NOT_AFFILIATED("BullX")}${RISK}`,
  faq: [
    ["Does BullX have a trading API?", `No. It never published one, and trading on BullX has been suspended since June 1, 2026.`],
    ["Can I move a BullX bot to BLIX?", `A BullX "bot" automated the web app, so there is no API to port; what moves is the logic. BLIX gives it a documented rail: the stream for launches and trades, the holder ledger and AI grade for filters, <code>build</code> and <code>send</code> for the trade, with your own wallet.`],
  ],
});

// ---------- /jupiter-trading-api ----------
const JUPITER_SIDE_BY_SIDE = code(`# The same buy, 0.1 SOL of one coin, asked of each. Both return something you sign yourself.
SOL=So11111111111111111111111111111111111111112

# Jupiter: a quote, then the swap transaction for that quote (two round trips; keyless on the free endpoint)
curl -s "https://lite-api.jup.ag/swap/v1/quote?inputMint=$SOL&outputMint=$MINT&amount=100000000&slippageBps=300" > quote.json
curl -s https://lite-api.jup.ag/swap/v1/swap -H "content-type: application/json" \\
  -d "{\\"quoteResponse\\":$(cat quote.json),\\"userPublicKey\\":\\"$WALLET\\"}"
# → { "swapTransaction": "<base64>", ... }   sign it, send it to your own RPC, poll the signature yourself

# BLIX: the build is the quote and the transaction in one answer (one account read, no router)
curl -s ${BASE}/api/v1/trade/build -H "${KEY_H}" -H "content-type: application/json" \\
  -d '{"wallet":"'$WALLET'","mint":"'$MINT'","side":"buy","sol":0.1,"slippageBps":300}'
# → { "transaction": "<base64>", "quote": {...}, "validForMs": 90000 }   sign it, POST { transaction } to /api/v1/trade/send
# → { "signature": "…", "status": "confirmed", "slot": …, "landedMs": 1180 }`, "bash");
const jupiter = page({
  path: "/jupiter-trading-api", crumb: "Jupiter trading API", og: "og-api.png", eyebrow: `Jupiter Swap API vs BLIX · checked ${CHECKED}`,
  title: "Jupiter Trading API vs the BLIX Trade API for pump.fun Bots | BLIX",
  description: "Jupiter's Swap and Ultra APIs route every Solana DEX for free. When a pump.fun bot should use them, when BLIX's hand-built pump.fun and PumpSwap transactions with staked sends fit better, and how BLIX will use Jupiter for the rest.",
  h1: "Jupiter's trading API and the BLIX trade API, honestly compared",
  lede: `Jupiter publishes the best general-purpose trading API on Solana: the Swap API and Ultra API quote and build a route across every DEX and launchpad Jupiter indexes, free to callers, with integrators adding their own fee. The <a href="/trade-api">BLIX trade API</a> is narrower on purpose: pump.fun's bonding curve and PumpSwap pools, built by hand from one account read with no router round trip, sent over staked connections, with Blix's fee inside and the terminal's data, holder ledgers and AI reads on the same key. Here is when each fits, the same request to both, and how they meet.`,
  body: `${TRADE_CTA()}
${facts([["Jupiter Swap / Ultra API", "Free routing across every Solana DEX and launchpad; integrator fees optional"], ["Jupiter key", "Free tier keyless; higher limits with a key from Jupiter"], ["BLIX trade API", "pump.fun curve and PumpSwap by hand; 2% (1.6% invited); local-sign; staked sends"], ["Where they meet", "Blix routes the launchpads it does not hand-build through Jupiter in the next phase"], ["Same key", `${N_ENDPOINTS} data endpoints, AI reads, stream`], FACT.community])}
<h2 id="compare">Side by side</h2>
${table(["", "Jupiter Swap API", "BLIX trade API"], [
    ["Covers", "Every DEX and launchpad Jupiter indexes, any token pair", "pump.fun bonding curve and PumpSwap pools (SOL pairs) today"],
    ["Round trips before signing", "Two (quote, then swap transaction)", "One account read; the build is local"],
    ["Fee", "None from Jupiter; integrators may add a platform fee", "2% a trade, 1.6% with an invite, inside the transaction"],
    ["Auth and limits", "Keyless on the free endpoint, metered; a portal key raises the limits (per Jupiter's plans)", "Bearer key; 120 quotes and builds, 60 sends a minute"],
    ["Who signs", "You", "You"],
    ["Sends", "You, to your own RPC", "Blix: Helius Sender staked path + RPCs, re-sent every second, landing reported; or send it yourself"],
    ["Stream", "None (price API)", "WebSocket, PumpPortal-compatible: launches, trades, migrations"],
    ["Data on the same key", "Prices, token lists", `Pulse, holders with snipers and bundles, candles from real trades, AI grades, smart-money wallets (${N_ENDPOINTS} endpoints)`],
  ], "cmp")}
<p>Source: ${ext("https://dev.jup.ag/docs/", "Jupiter developer docs")}, checked ${CHECKED}. Jupiter's terms govern its API; the request shape above is the one its docs describe on that date.</p>
<h2 id="request">The same buy, request by request</h2>
${JUPITER_SIDE_BY_SIDE}
<h2 id="when">Which one, when</h2>
${bullets([
    "<b>A coin in its first minutes on pump.fun, where every hundred milliseconds matters:</b> BLIX. The transaction is built from one read of the curve and sent over staked connections with your priority fee and tip; the quote shows the exact fill.",
    "<b>A coin on Raydium, Meteora, Orca, or a pair that is not against SOL:</b> Jupiter today; BLIX answers <code>409 route: \"unsupported\"</code> for those until its Jupiter-routed build with Blix's fee ships.",
    "<b>A bot that needs the filter as much as the fill:</b> BLIX, because the holder ledger, the AI grade and the live stream are on the same key as the build; with Jupiter you assemble those from other services.",
    "<b>Zero fee above the pool's own:</b> Jupiter, and you run your own RPC and sends.",
  ])}
${HUB_LINKS}
${TRADE_MORE}
${links("More on Jupiter", [["/compare/jupiter-terminal-alternative", "Jupiter Terminal alternative", "The terminal beside BLIX."], ["/solana-swap", "Solana swap", "One-click swaps in the terminal."]])}
${NOT_AFFILIATED("Jupiter")}${RISK}`,
  faq: [
    ["Is Jupiter's trading API free?", `Yes to callers; Jupiter earns from its own products and lets integrators attach a fee. BLIX's API charges 2% a trade (1.6% with an invite) and bundles the staked send path, the stream and the data.`],
    ["Why would I pay BLIX when Jupiter is free?", `For pump.fun's first minutes: one account read and a local build instead of two router round trips, staked sends with the landing time reported, and the holder ledger and AI grade on the same key to decide with. For anything else, use Jupiter; BLIX will route those through Jupiter itself next.`],
    ["Will BLIX use Jupiter?", `Yes, for every launchpad and pool it does not hand-build, with Blix's fee attached, in the next phase. Hand-built paths stay where milliseconds are worth money.`],
  ],
});

export const TRADEAPI_PAGES = [hub, pump, gmgn, axiom, fomo, photon, bullx, jupiter];
