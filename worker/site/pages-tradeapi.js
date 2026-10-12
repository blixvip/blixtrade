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
  "<b>The fee rides inside the transaction.</b> Every build carries Blix's fee transfer and <code>send</code> only accepts transactions Blix built, so there is no path around it and nothing to settle later. Blix's fee: 1% of the SOL side of the trade, 0.8% when you joined through an invite; your inviter earns 40% of it.",
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
  ["Blix's fee", "You, inside the transaction, to Blix's fee wallet", "1% of the SOL side; 0.8% if you joined through an invite. Your inviter earns 40% of it"],
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
  path: "/trade-api", crumb: "Trade API", og: "og-api.png", eyebrow: `Trade API · pump.fun and PumpSwap · 1% a trade · updated ${CHECKED}`,
  title: "Solana Trade API for pump.fun Bots: Your Wallet, Your Key, 1% a Trade | BLIX",
  description: "Quote, build and send pump.fun and PumpSwap trades from your own wallet through the BLIX trade API. Local-sign only, 1% a trade inside the transaction, staked sends, live stream.",
  h1: "The BLIX trade API: trade pump.fun from your own wallet",
  lede: `Four calls turn a BLIX account into a trading rail for your bot: <b>quote</b> a buy or sell on pump.fun's curve or its PumpSwap pool, <b>build</b> the transaction (unsigned, every fee inside), sign it with your own key and <b>send</b> it through Helius Sender's staked connections, and follow every launch, trade and migration on a <b>stream</b> that speaks PumpPortal's language. Blix never holds a key. The fee is 1% a trade (0.8% with an invite), paid inside the transaction, with no subscription. The same key reads the <a href="/api">${N_ENDPOINTS}-endpoint data API</a>: holders with snipers and bundles, candles, the AI's reads, the smart-money wallets.`,
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
    ["What does the trade API cost?", `1% of the SOL side of each trade, 0.8% if you joined BLIX through an invite, paid inside the transaction to Blix's fee wallet. No subscription, no per-call price, no key fee. Priority fees and Sender tips are yours and shown in every quote.`],
    ["Can I just use send as a free relay?", `No. <code>send</code> only accepts transactions <code>build</code> made, which carry the fee. Build your own transaction and you send it yourself, as you can today.`],
    ["Which coins can it trade?", `Today: any coin on pump.fun's bonding curve or in its PumpSwap pool, which is nearly every memecoin in its first hours and days. Other launchpads and pools come through Jupiter routing next; until then they answer 409 with <code>route: "unsupported"</code>.`],
    ["How fast does a trade land?", `The build reads the coin's accounts once and needs no router round trip; the send goes to Helius Sender's staked connections and the RPCs at the same time and is re-sent every second until a block holds it. The answer carries <code>landedMs</code>, measured from the send, and the slot. Speed also depends on your priority fee and tip, both yours to set per trade.`],
    ["Is the stream compatible with PumpPortal's?", `The method names (<code>subscribeNewToken</code>, <code>subscribeTokenTrade</code>, <code>subscribeAccountTrade</code>, <code>subscribeMigration</code>) and the trade event's fields follow PumpPortal's, so an existing client changes one URL. The source is Blix's own decoding of pump.fun and PumpSwap, the same feed the terminal shows.`],
    ["How do I get a key?", `Create a BLIX account (sign in with Google) and open this page again: your keys are at the top. Make one, copy it once, keep it private. Revoke it there too.`],
  ],
});

// ---------- /pump-fun-trading-api ----------
const pump = page({
  path: "/pump-fun-trading-api", crumb: "pump.fun trading API", og: "og-api.png", eyebrow: `pump.fun trading APIs · checked ${CHECKED}`,
  title: "pump.fun Trading API: PumpPortal, pumpdev.io and BLIX Compared (2026) | BLIX",
  description: "The pump.fun trading APIs a bot can use in 2026: PumpPortal (0.5% local, 1% Lightning), pumpdev.io, Jupiter, and the BLIX trade API with your own wallet, data and AI under one key.",
  h1: "pump.fun trading API: what a bot can use today",
  lede: `pump.fun publishes its programs and IDLs, not a hosted trading API, so bots trade through a third party that builds the transaction. For two years that has meant <a href="https://pumpportal.fun" rel="noopener">PumpPortal</a>; since then clones such as pumpdev.io and Jupiter's router have appeared, and now <a href="/trade-api">the BLIX trade API</a>. This page lays them side by side: what each builds, what it charges, whether it holds your key, and what else comes with the key.`,
  body: `${TRADE_CTA()}
${facts([["pump.fun itself", "Programs and IDLs published; no hosted trade API"], ["PumpPortal", "Local 0.5% a trade; Lightning (custodial) 1%; trade stream needs a funded key"], ["pumpdev.io", "A PumpPortal clone: 0.25% client-side, 0.5% custodial; small, unlicensed"], ["Jupiter", "Free routing across launchpads; integrators add their own fee"], ["BLIX", "1% (0.8% invited), local-sign only, staked sends, data + AI + stream on the same key"], FACT.community])}
<h2 id="compare">Side by side</h2>
${table(["", "PumpPortal", "pumpdev.io", "Jupiter Swap API", "BLIX trade API"], [
    ["Builds", "pump.fun curve, PumpSwap, Bonk", "pump.fun curve, PumpSwap (not delivered in our test)", "Every Solana DEX and launchpad it indexes", "pump.fun curve and PumpSwap by hand; the rest through Jupiter next"],
    ["Fee", "0.5% local, 1% Lightning", "0.25% client-side, 0.5% custodial", "None to callers; integrators add theirs", "1% a trade, 0.8% with an invite, inside the transaction"],
    ["Your key", "Local API: yours. Lightning: PumpPortal holds a wallet for you", "Client-side: yours. Custodial wallets offered", "Yours", "Yours, always. No custodial option"],
    ["Sends", "Jito bundles optional", "Jito bundles", "You send", "Helius Sender staked path + RPCs, re-sent until it lands, landing reported"],
    ["Stream", "Launches and trades; token trade stream metered", "Free websocket", "None", "WebSocket, PumpPortal's method names, with the account"],
    ["Data beyond trades", "No", "No", "Price API", `${N_ENDPOINTS} endpoints: holders with snipers and bundles, candles, AI reads, wallets`],
    ["Launch bundles", "Yes", "Yes", "No", "No, by design"],
  ], "cmp")}
<p>Sources: ${ext("https://pumpportal.fun", "PumpPortal")}, pumpdev.io's published code and pricing, ${ext("https://dev.jup.ag/docs/", "Jupiter developer docs")} and pump.fun's published program interfaces, checked ${CHECKED}.</p>
<h2 id="blix">Trading pump.fun through BLIX</h2>
${KEYS_NOTE}
${CALLS}
${CURL}
<h2 id="pumpportal">Moving a PumpPortal bot over</h2>
${steps([
    `<b>Trades.</b> Where you posted to PumpPortal's <code>trade-local</code>, post to <code>${BASE}/api/v1/trade/build</code> with <code>wallet</code>, <code>mint</code>, <code>side</code> and <code>sol</code> or <code>pct</code>; sign the returned <code>transaction</code> exactly as before and post the signed bytes to <code>/api/v1/trade/send</code> instead of your own RPC. The answer carries the signature, status, slot and landing time.`,
    `<b>Stream.</b> Point the WebSocket at <code>wss://blixvip.com/api/v1/stream</code> with your key; <code>subscribeNewToken</code>, <code>subscribeTokenTrade</code>, <code>subscribeAccountTrade</code> and <code>subscribeMigration</code> work as they did, and the trade event's fields keep their names.`,
    `<b>Filters.</b> Before a buy, read <code>GET /api/holders/&lt;mint&gt;</code> (dev share and whether the dev sold, snipers, bundles, top-10 share) and the row's AI call from <code>GET /api/pulse</code>; both are on the same key.`,
  ])}
${RULES}
${PHASES}
${COMMUNITY}
${TRADE_MORE}
${NOT_AFFILIATED("pump.fun, PumpPortal, pumpdev.io or Jupiter")}${RISK}`,
  faq: [
    ["Does pump.fun have an official trading API?", `No hosted one. pump.fun publishes its on-chain programs and IDLs; bots trade through a service that builds the transaction (PumpPortal, pumpdev.io, BLIX) or through Jupiter's router.`],
    ["What is the cheapest pump.fun trading API?", `pumpdev.io advertises 0.25% client-side and PumpPortal 0.5% local; Jupiter is free to callers. BLIX charges 1% (0.8% with an invite) and bundles the data, the AI reads, the staked send path and the stream under the same key; whether that is worth half a percent is your call, and the quote shows the fee before every build.`],
    ["Is the BLIX trade API custodial?", `No. There is no Lightning-style wallet: you sign every transaction with your own key.`],
    ["Can I trade coins that already left pump.fun?", `PumpSwap pools, yes. Raydium, Meteora and other pools come with Jupiter routing in the next phase.`],
  ],
});

// ---------- /gmgn-trading-api ----------
const gmgn = page({
  path: "/gmgn-trading-api", crumb: "GMGN trading API", og: "og-gmgn.png", eyebrow: `GMGN trading API · checked ${CHECKED}`,
  title: "GMGN Trading API: Swaps Through the OpenAPI vs the BLIX Trade API | BLIX",
  description: "How trading through GMGN's OpenAPI works (Ed25519 key, private key on their side of the request, IP whitelist, no published prices) and how the BLIX trade API does the same trade with your key never leaving your machine.",
  h1: "GMGN trading API, and the BLIX trade API beside it",
  lede: `GMGN has an official API: the GMGN OpenAPI, with agent "skills" wrapped around it. Data calls need a key you create at gmgn.ai/ai by uploading an Ed25519 public key; <b>swaps</b> also need the matching private key configured for the request and a whitelisted IP address, and GMGN publishes no prices or rate limits. The <a href="/trade-api">BLIX trade API</a> takes a different shape: Blix builds the transaction for your wallet, you sign it where your key already lives, Blix sends it over staked connections and reports where it landed. This page compares the two for a bot on Solana.`,
  body: `${TRADE_CTA()}
${facts([["GMGN OpenAPI", "Key by application (Ed25519 public key); swaps need the private key and an IP whitelist"], ["GMGN price", "Not published in its docs"], ["GMGN chains", "Solana, BSC, Base, more announced"], ["BLIX", "pump.fun curve and PumpSwap by hand; 1% (0.8% invited); local-sign; Solana"], ["Same key", `${N_ENDPOINTS} data endpoints, AI reads, MCP connector`], FACT.community])}
<h2 id="compare">Trading through each</h2>
${table(["", "GMGN OpenAPI", "BLIX trade API"], [
    ["Getting access", "Create a key at gmgn.ai/ai with an Ed25519 public key", "Sign in with Google, open /trade-api, make a key"],
    ["Who signs", "Your private key is configured for GMGN's swap requests; requests must come from a whitelisted IP", "You, on your machine, with any Solana library. Blix never sees the key"],
    ["Fee", "Not published; the terminal charges about 1%", "1% a trade, 0.8% with an invite, inside the transaction"],
    ["Venues", "Solana, BSC, Base", "pump.fun curve and PumpSwap today; other pools through Jupiter next"],
    ["Sends", "GMGN's", "Helius Sender staked path + RPCs, re-sent until it lands, landing reported"],
    ["Stream", "Not part of the OpenAPI", "WebSocket, PumpPortal-compatible"],
    ["Data on the same key", "Tokens, market, wallets, K-lines", `Pulse, holders with snipers and bundles, candles from real trades, AI grades, smart-money wallets (${N_ENDPOINTS} endpoints)`],
    ["Agent tools", "GMGN skills", `MCP connector with every account`],
  ], "cmp")}
<p>Sources: ${ext("https://docs.gmgn.ai/index/gmgn-agent-api", "GMGN Agent API docs")}, checked ${CHECKED}. GMGN's terms and access rules govern its API; BLIX's API is BLIX's own and not a way around them.</p>
<h2 id="blix">The same buy through BLIX</h2>
${KEYS_NOTE}
${CALLS}
${NODE}
${RULES}
${PHASES}
${COMMUNITY}
${TRADE_MORE}
${links("More on GMGN", [["/gmgn-api", "GMGN API", "The data side: access, limits, what it covers."], ["/compare/gmgn-alternative", "GMGN alternative", "BLIX beside GMGN."], ["/axiom-vs-gmgn", "Axiom vs GMGN", "Speed versus multi-chain."]])}
${NOT_AFFILIATED("GMGN")}${RISK}`,
  faq: [
    ["Can I trade through the GMGN API?", `Yes. GMGN's OpenAPI supports swaps on Solana, BSC and Base; trading requests need the private key matching your uploaded public key and must come from a whitelisted IP. Prices and rate limits are not in its public docs as of ${CHECKED}.`],
    ["How is the BLIX trade API different?", `Blix builds the transaction and sends it; you sign it. No private key is configured anywhere but your own machine, there is no IP whitelist, and the fee is published: 1% a trade, 0.8% with an invite, inside the transaction.`],
    ["Does BLIX trade on BSC or Base?", `No. Solana only: pump.fun's curve and PumpSwap pools today, the other Solana launchpads and pools through Jupiter next.`],
  ],
});

// ---------- /axiom-trading-api ----------
const axiom = page({
  path: "/axiom-trading-api", crumb: "Axiom trading API", og: "og-axiom.png", eyebrow: `Axiom trading API · checked ${CHECKED}`,
  title: "Axiom Trading API: No Official One. Trade Programmatically With BLIX | BLIX",
  description: "Axiom Trade publishes no public trading API or SDK; unofficial SDKs sign in as your account. The BLIX trade API builds pump.fun and PumpSwap trades for your own wallet: you sign, Blix sends, 1% a trade.",
  h1: "Axiom trading API: what exists, and what to use instead",
  lede: `Axiom Trade is the fast terminal: Pulse, limit orders, MEV modes, a migration sniper, Hyperliquid perps. What it does not publish, as of ${CHECKED}, is a trading API, an SDK or developer docs. The "Axiom APIs" you find are unofficial libraries that drive your own Axiom account through its private endpoints, which can break with any release and put your account's session in a bot's hands. If what you want is to trade pump.fun programmatically with Axiom-grade speed, the <a href="/trade-api">BLIX trade API</a> is built for exactly that, with your own wallet.`,
  body: `${TRADE_CTA()}
${facts([["Axiom public API", "None published; unofficial SDKs use your account's session"], ["Axiom fee", "1%, less 0.05–0.25% cashback by volume"], ["BLIX trade API", "pump.fun curve and PumpSwap by hand; 1% (0.8% invited); local-sign"], ["Sends", "Helius Sender staked path, re-sent until it lands"], ["Same key", `${N_ENDPOINTS} data endpoints, AI reads, stream`], FACT.community])}
<h2 id="compare">A bot's options</h2>
${table(["", "Unofficial Axiom SDKs", "BLIX trade API"], [
    ["Status", "Reverse-engineered; break with Axiom's releases", "A documented, versioned API (v1)"],
    ["What a bot holds", "Your Axiom session (your account)", "An API key that can only build and send for wallets you sign with"],
    ["Who signs", "Axiom's wallet, through your session", "You, with your own key"],
    ["Fee", "Axiom's 1% less cashback", "1% a trade, 0.8% with an invite, inside the transaction"],
    ["Speed path", "Axiom's", "No router round trip: one account read, then staked sends with your priority fee and tip"],
    ["Stream", "Axiom's private websocket", "WebSocket, PumpPortal-compatible, with the account"],
    ["Data on the same key", "Axiom's private endpoints", `Pulse, holders with snipers and bundles, candles, AI grades, wallets (${N_ENDPOINTS} endpoints)`],
  ], "cmp")}
<p>Axiom's own documentation describes Pulse's three tables and filters (${ext("https://docs.axiom.trade/axiom/finding-tokens/pulse", "docs.axiom.trade")}); it lists no developer API. Facts checked ${CHECKED}.</p>
<h2 id="blix">Programmatic trading through BLIX</h2>
${KEYS_NOTE}
${CALLS}
${CURL}
<h2 id="pulse">Axiom's Pulse filters, as API fields</h2>
<p>The filters Axiom's Pulse offers (age, top-10 %, dev %, snipers %, insiders %, bundle %, holders, liquidity, volume, market cap, transactions) are fields on every row of <code>GET /api/pulse</code> (<code>hl.t10</code>, <code>hl.dev</code>, <code>hl.ds</code>, <code>hl.sn</code>, <code>hl.bd</code>, <code>buys</code>, <code>sells</code>, <code>liveVol</code>, <code>mcap</code>), so the screen you filter by hand on Axiom is a filter in your bot here, with the build call one line later. See the <a href="/axiom-api">Axiom API page</a> for the data side.</p>
${RULES}
${PHASES}
${COMMUNITY}
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
const fomo = page({
  path: "/fomo-trading-api", crumb: "Fomo trading API", og: "og-fomo.png", eyebrow: `Fomo trading API · checked ${CHECKED}`,
  title: "Fomo Trading API: None Official. Trade pump.fun With the BLIX Trade API | BLIX",
  description: "Fomo (fomo.family) publishes no trading API; third-party Fomo APIs resell data. The BLIX trade API builds pump.fun and PumpSwap trades for your own wallet, 1% a trade, and reads Fomo's traders from the chain.",
  h1: "Fomo trading API: none official, and the BLIX route",
  lede: `Fomo (fomo.family) is a social trading app: a feed of other traders' buys, sells and theses, one-tap trades with network fees covered, perps, clans. It publishes no trading API, SDK or developer docs as of ${CHECKED}, and its backend needs the app's own login. The third-party "Fomo APIs" sell data on credits, not trades. What people searching for a Fomo trading API usually want is to act on what Fomo's traders are buying, programmatically. The <a href="/trade-api">BLIX trade API</a> does the trade with your own wallet, and the same key reads what Fomo's leaderboard traders are buying, from the chain.`,
  body: `${TRADE_CTA()}
${facts([["Fomo public API", "None; third-party Fomo APIs resell data on credits"], ["Fomo fee", "About 0.5% spot, quoted per trade; network fees covered"], ["BLIX trade API", "pump.fun curve and PumpSwap by hand; 1% (0.8% invited); local-sign"], ["Fomo's traders in BLIX", "<code>GET /api/fomo</code>: what they are buying, flow per coin, top traders"], ["Same key", `${N_ENDPOINTS} data endpoints, stream, MCP connector`], FACT.community])}
<h2 id="compare">What a bot gets</h2>
${table(["", "Fomo", "Third-party Fomo APIs", "BLIX"], [
    ["Trading API", "None", "None (data only)", "Quote, build, send with your own wallet"],
    ["What Fomo traders buy", "In the app's feed", "Leaderboards and holders, metered by credits", "<code>GET /api/fomo</code> and <code>/api/fomo/board</code>, from the chain, with the account"],
    ["Fee", "About 0.5% spot in the app", "Credits per call", "1% a trade, 0.8% with an invite, inside the transaction"],
    ["Who signs", "Fomo's non-custodial app", "Not applicable", "You, with your own key"],
    ["Stream", "None public", "Websocket alerts, metered", "WebSocket, PumpPortal-compatible"],
  ], "cmp")}
<p>Sources: ${ext("https://fomo.family", "fomo.family")}, ${ext("https://newsletter.fomo.family/", "the Fomo newsletter")}, checked ${CHECKED}. Beware of Telegram bots calling themselves the "official Fomo bot": Fomo publishes none.</p>
<h2 id="blix">Acting on Fomo's traders, through BLIX</h2>
${KEYS_NOTE}
${steps([
    `<b>Read the flow.</b> <code>GET ${BASE}/api/fomo</code> lists what Fomo's leaderboard traders are buying right now (flow per coin, sampled from the swaps Fomo sponsors) and the top traders by observed profit; <code>GET /api/wallet-page/&lt;wallet&gt;</code> opens any of them from the chain.`,
    `<b>Check the coin.</b> <code>GET /api/holders/&lt;mint&gt;</code> for the dev, snipers and bundles; the row's AI call from <code>GET /api/pulse</code>. A coin several Fomo traders bought can still be a bundle; the ledger says so.`,
    `<b>Trade it.</b> <code>POST /api/v1/trade/build</code> for your wallet, sign, <code>POST /api/v1/trade/send</code>. The quote shows every fee first.`,
  ])}
${CALLS}
${PY}
${RULES}
${PHASES}
${COMMUNITY}
${TRADE_MORE}
${links("More on Fomo", [["/fomo-api", "Fomo API", "Is there one? What the unofficial ones sell."], ["/fomo-trading-bot", "Fomo trading bot", "Why there is no official one."], ["/fomo-app", "The Fomo app", "What it is, fees, chains."]])}
${NOT_AFFILIATED("Fomo (Fomo Labs)")}${RISK}`,
  faq: [
    ["Does Fomo have a trading API?", `No. Fomo publishes no trading API, SDK or developer docs as of ${CHECKED}; its backend requires the app's login. Third-party "Fomo APIs" resell data on credits and do not trade.`],
    ["Can I copy Fomo traders automatically through BLIX?", `BLIX gives you what they are buying (<code>GET /api/fomo</code>) and the trade rail (<code>/api/v1/trade/build</code> and <code>send</code>) under one key; the copying logic and the decision are your bot's. BLIX does not mirror trades for you.`],
    ["Do I need a Fomo account?", `No. Nothing here touches a Fomo account: BLIX reads public on-chain activity, and you trade with your own wallet.`],
  ],
});

export const TRADEAPI_PAGES = [hub, pump, gmgn, axiom, fomo];
