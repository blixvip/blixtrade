// Public guides grounded in the shipped implementation, reviewed 2026-10-10.
// Keep marketing claims narrower than the source: model availability and hosted access vary.
import { code, table, ext } from "./html.js";

const UPDATED = "2026-10-10";
const cta = (route, label) => `<div class="cta"><a class="btn primary" href="/start?next=${encodeURIComponent(route ? `/app#/${route}` : "/app")}">${label}</a><a class="btn" href="/api">Developer documentation</a></div>`;
const evidence = (...files) => `<h2 id="sources">About this guide</h2><p>Reviewed by BLIX on October 10, 2026 against the product implementation. Availability depends on your account and connected providers. Explore the <a href="/guides">BLIX guides</a> for related workflows.</p>`;
const local = `<p class="note">Developer examples below run against your BLIX account: sign in, open <a href="/developers">Developers</a> and copy your session into <code>BLIX_SESSION</code>; every request sends it as the <code>blix_wait</code> cookie.</p>`;
const page = (p) => ({ og: "home/og.jpg", updated: UPDATED, author: "Blix", reviewedBy: "Blix", ...p });

export const FEATURE_PAGES = [
  page({
    path: "/solana-trading-terminal", crumb: "Solana terminal", topic: "Trading",
    title: "Solana Trading Terminal: Research, Wallets & Execution | Blix",
    description: "Use Blix to inspect Solana memecoins, follow wallets, read AI research, practice trades and access account-backed execution in one terminal.",
    eyebrow: "Solana · trading terminal", h1: "A Solana trading terminal built around the coin",
    lede: "Start with a live launch, inspect its holders and trading activity, read the research, and decide what to do in the same workspace. Blix combines memecoin discovery, analysis, practice and account-backed trading.",
    related: ["/solana-memecoin-screener", "/ai-memecoin-trading", "/solana-wallet-tracker", "/memecoin-paper-trading"],
    body: `${cta("", "Open the terminal")}
<h2 id="workflow">From new pair to trade decision</h2>
<p>The Pulse board separates new pairs, coins nearing the end of their bonding curve and migrated tokens. Open a coin by its contract address to inspect the chart, recent activity, holder concentration and available research. Names and tickers can be copied; the mint address identifies the asset you are actually viewing.</p>
${table(["Question", "Where to look"], [
  ["Is demand growing?", "Recent volume, buys, sells and the number of traders; compare several time windows."],
  ["Who owns the supply?", "Holder distribution, creator activity and available early-buyer information."],
  ["Can this position be exited?", "Current sell quote, available liquidity and price impact at the proposed size."],
  ["What supports the story?", "Linked sources, narrative activity and the timestamp of the AI read."],
])}
<h2 id="execution">Practice and real execution are separate</h2>
<p>Use <a href="/memecoin-paper-trading">paper trading</a> to record a simulated position and inspect its exit rules. The account trade flow can instead submit real buys and sells through the configured wallet service. Live execution requires an authenticated account, a funded wallet and an available service; opening the terminal does not place a trade.</p>
<p>A chart price is not a guaranteed execution price. Check the quote, slippage allowance and transaction status. A submitted transaction is not yet a confirmed fill, and an earlier quote can become stale before submission.</p>
<h2 id="deployment">What comes with your account</h2>
<p>The terminal in the browser, a Blix wallet for real trades, the paper desk, and the API and MCP connector for developers. Read the <a href="/api">API reference</a> for what each endpoint returns and which rows are the operator's rather than the account's.</p>
${evidence(["web/src/main.tsx", "Terminal routes"], ["server/accounts.js", "Account execution"], ["server/paper.js", "Paper desk"])}`,
    faq: [["Is Blix a Solana trading bot?", "Blix includes research and paper-trading automation as well as account-backed execution. Those are separate capabilities; an AI read does not itself authorize a real trade."], ["Is BLIX free?", "Yes. Create an account with Google and the terminal, the API and the MCP connector are included. Only real trades pay a fee: 1%, or 0.8% with an invite."]],
  }),
  page({
    path: "/ai-memecoin-trading", crumb: "AI trading", topic: "AI research",
    title: "AI Memecoin Trading: Research, Paper Tests & Execution | Blix",
    description: "See how Blix uses AI research alongside Solana market data, paper trading and separate real execution. Inspect model availability and trading evidence.",
    eyebrow: "AI research · Solana", h1: "AI memecoin trading with an inspectable process",
    lede: "Blix uses AI to explain coin data and investigate narratives. Its market rules, research calls, simulated positions and real account trades have different jobs. Keeping those jobs visible makes a trading idea easier to evaluate.",
    related: ["/ai-memecoin-picks", "/memecoin-paper-trading", "/mcp", "/memecoin-risk-scanner"],
    body: `${cta("ai-picks", "Inspect AI picks")}
<h2 id="process">What the AI receives and returns</h2>
<p>The research service collects coin metadata, available social and website sources, holder information and trading activity. A fast read can be followed by a deeper read, with a grade, thesis and proposed plan. Provider status matters: a queued or failed read has not produced a fresh opinion.</p>
<p>Grok, Claude and configured fallback providers do not always see the same evidence. A Grok search-enabled read can investigate X; a Claude read in this implementation works from the material gathered by the service. Check the actual provider and source list before comparing two answers.</p>
<h2 id="gates">An AI buy label is one input</h2>
<p>The current default settings keep the model's buy/avoid opinion separate from the pick gate. Live demand and the launch model drive selection unless the operator explicitly enables AI gating. This matters when a well-written explanation disagrees with observed demand or when a provider is unavailable.</p>
<h2 id="evaluate">Evaluate an idea before connecting execution</h2>
<ol><li>Open the coin and confirm its mint, current data and source timestamps.</li><li>Read the thesis together with holder concentration, liquidity and a sell quote.</li><li>Record the idea on the paper desk, including a repeatable entry and exit rule.</li><li>Review closed losses and failed exits alongside wins in the scorecard.</li><li>Use the account trade flow only when you intend to submit a real transaction.</li></ol>
<p>Paper results cannot establish what a live strategy would have earned: queueing, quote age, market impact and transaction failures can change an outcome. No model grade establishes that a coin will appreciate.</p>
<h2 id="agents">Use an AI client with the MCP server</h2>
<p>The <a href="/mcp">Blix MCP server</a> exposes market research and paper-desk tools to compatible clients. Its tool list should determine what an agent can do. It does not turn the separate account execution service into an unrestricted autonomous trading bot.</p>
${evidence(["server/research.js", "Research providers"], ["server/settings.js", "Pick configuration"], ["public/mcp-tools.js", "MCP tool capabilities"])}`,
    faq: [["Does every AI opinion trigger a trade?", "No. Research, pick selection, paper positions and signed account transactions are separate flows."], ["Does Blix support every AI model?", "No. Available providers depend on the implementation and configured credentials. The research status reports the actual provider; model-specific support should not be inferred from a keyword or a client name."]],
  }),
  page({
    path: "/ai-memecoin-picks", crumb: "AI coin picks", topic: "AI research",
    title: "AI Memecoin Picks & Solana Research Scorecards | Blix",
    description: "Inspect Blix memecoin picks, research sources and scorecards. Compare AI calls with recorded entry, exit and rule outcomes instead of selected winners.",
    eyebrow: "Research · picks · results", h1: "AI memecoin picks you can examine",
    lede: "A useful coin pick needs a timestamp, a reason and a result you can check. Blix keeps research opinions beside market-based picks and a scorecard so you can see what happened after a call.",
    related: ["/ai-memecoin-trading", "/memecoin-risk-scanner", "/memecoin-paper-trading"],
    body: `${cta("ai-picks", "Open the picks desk")}
<h2 id="record">Read the whole record</h2>
<p>The picks API includes summaries by stage, AI call, reason and day, while the detailed record includes entries, exits, peaks and rule results. A peak shows the highest observed value after a call; it does not mean a trader sold there. Compare the recorded exit rule with the peak before calling a pick a winner.</p>
${table(["Evidence", "What to check"], [
  ["Entry", "When the pick was recorded, the price reference and whether the signal was already stale."],
  ["Research", "The actual model, available sources and whether the opinion preceded the move."],
  ["Result", "Closed outcome under the stated rule, not just the highest price reached."],
  ["Coverage", "All recorded picks in the period, including losing, open and unsellable positions."],
])}
<h2 id="models">Grok and Claude reads need context</h2>
<p>The provider handling a read can change when credentials, quotas or availability change. Blix reports configured and actual providers. Compare reads made with similar evidence and at similar stages of a coin's life; a quick classification and a later deep report are different tasks.</p>
<p>The page does not publish invented “best coins today” rankings. Open the live desk for the current record. Historical screenshots or examples are demonstrations, and an earlier successful call does not establish future performance.</p>
<h2 id="api">Inspect the record from your local service</h2>
${local}${code("curl -s https://blixvip.com/api/picks -H 'cookie: blix_wait='$BLIX_SESSION\ncurl -s https://blixvip.com/api/picks/all -H 'cookie: blix_wait='$BLIX_SESSION\ncurl -s https://blixvip.com/api/research -H 'cookie: blix_wait='$BLIX_SESSION", "bash")}
<p>Preserve the time window and selection rules when exporting results. Changing the exit rule after seeing a coin's peak creates a different experiment and should not overwrite the original outcome.</p>
${evidence(["public/api-docs.js", "Picks endpoints"], ["server/research.js", "Provider reporting"], ["web/src/pages/AiPicks.tsx", "Picks interface"])}`,
    faq: [["Are AI picks guaranteed profitable?", "No. Picks and model opinions can lose money. Inspect full-period outcomes, failed exits and data gaps."], ["Can I compare Grok and Claude coin picks?", "Inspect each read's actual provider and recorded evidence. Blix does not establish a controlled model comparison merely by showing opinions from different providers."]],
  }),
  page({
    path: "/solana-wallet-tracker", crumb: "Wallet tracker", topic: "Wallets",
    title: "Solana Wallet Tracker & Smart Money Analytics | Blix",
    description: "Follow Solana wallet activity, inspect observed buys and sells, and compare holder positions and PnL with data coverage visible in Blix.",
    eyebrow: "Solana · wallet analytics", h1: "Track Solana wallets with the trade history in view",
    lede: "Follow a public wallet to see its observed token trades, positions and activity. Blix connects wallet tracking with coin research so a large buy can be investigated in the context of the token it bought.",
    related: ["/solana-pnl-tracker", "/memecoin-alerts", "/memecoin-risk-scanner"],
    body: `${cta("traders", "Explore traders")}
<h2 id="workflow">Follow the address, then inspect the activity</h2>
<ol><li>Obtain the wallet's public Solana address and verify it independently of a display name.</li><li>Open its trader detail or follow it in your wallet-tracking installation.</li><li>Inspect recent buys, sells, position sizes and closed results across several coins.</li><li>Open the token behind an interesting transaction and check its holders and available exit liquidity.</li></ol>
<p>A public address is enough to observe a wallet. Tracking does not require its private key and does not grant permission to trade from it. A label such as “whale” describes observed size; it does not prove identity or informed trading.</p>
<h2 id="coverage">Coverage changes what a ranking means</h2>
<p>The tracking service records whether its stream is connected, how recently a wallet was polled and whether requests were skipped. Public RPC limits and outages can leave incomplete histories. A wallet first observed after it bought a token may have an unknown entry cost; do not interpret that as a zero-cost purchase.</p>
<p>Smart-money discovery uses observed activity, including wallets appearing early or among holders of coins that later moved. That creates a candidate list to inspect. It is not proof that every associated address belongs to the same person or that copying its next trade will produce the same price.</p>
<h2 id="api">Read a tracked wallet</h2>
${local}${code("curl -s https://blixvip.com/api/wallets -H 'cookie: blix_wait='$BLIX_SESSION\ncurl -s https://blixvip.com/api/wallet/REPLACE_WITH_PUBLIC_SOLANA_ADDRESS -H 'cookie: blix_wait='$BLIX_SESSION", "bash")}
<p>The wallet response separates realized, open and sellable PnL. Read the <a href="/solana-pnl-tracker">PnL guide</a> before comparing wallets with different amounts of history.</p>
${evidence(["server/wallets.js", "Wallet ledger and tracking"], ["public/api-docs.js", "Wallet API"], ["web/src/main.tsx", "Trader routes"])}`,
    faq: [["Does tracking a wallet copy its trades?", "No. Observing a public wallet and submitting a trade are separate actions."], ["Are all wallet trades visible immediately?", "No. Stream health, RPC capacity and when tracking began affect timeliness and completeness."]],
  }),
  page({
    path: "/memecoin-risk-scanner", crumb: "Token risk", topic: "Risk analysis",
    title: "Memecoin Risk Scanner: Holders, Bundles & Exit Liquidity | Blix",
    description: "Inspect Solana memecoin risk using holder concentration, creator sales, early-wallet activity, available safety reports and exit liquidity in Blix.",
    eyebrow: "Token analysis · risk", h1: "Inspect memecoin risk before interpreting the chart",
    lede: "Blix brings holder distribution, creator activity, available safety reports and exit information into the coin workflow. These checks identify evidence to investigate; a passed check cannot certify that a token is safe.",
    related: ["/solana-memecoin-screener", "/solana-wallet-tracker", "/ai-memecoin-picks"],
    body: `${cta("coins", "Inspect a token")}
<h2 id="checks">Four checks that answer different questions</h2>
${table(["Check", "Interpretation", "Limit"], [
  ["Holder concentration", "How much supply a small group of wallets controls.", "Addresses can be related; a wallet count is not a person count."],
  ["Creator and early buyers", "Whether the creator sold and how early participants changed positions.", "Timing-based bundle and sniper labels are heuristics, not proof of coordination."],
  ["Safety report", "Available authority, distribution and provider risk findings.", "A missing or stale report is not a pass."],
  ["Exit quote", "Whether an executable route exists for the intended size now.", "Liquidity and routes can disappear before submission."],
])}
<h2 id="partial">Distinguish complete and partial holder histories</h2>
<p>Blix can build a holder ledger from the trades it observes. A coin watched from its first trades has more context for early-buyer analysis than one discovered mid-life. Read source and completeness indicators; an unavailable bundle percentage must not be treated as zero.</p>
<p>Other feeds may provide a current holder snapshot or risk report rather than the same transaction history. When figures differ, compare their timestamp, source and coverage before deciding that one is wrong.</p>
<h2 id="exit">A rising price can coexist with a poor exit</h2>
<p>A last-traded price does not show how much a position could sell for. Check a current sell quote and its size, price impact and route. Blix tracks stale, illiquid and unsellable states because a nominal market cap can persist after practical liquidity has disappeared.</p>
<h2 id="routine">A repeatable review</h2>
<ol><li>Confirm the mint and data freshness.</li><li>Read concentration and creator activity alongside their source.</li><li>Check whether early-buyer figures are complete, partial or unavailable.</li><li>Inspect the available safety report and sell quote.</li><li>Record unresolved questions with the research thesis.</li></ol>
${evidence(["server/quality.js", "Exit and freshness checks"], ["web/src/lib/coin.ts", "Holder source and completeness"], ["public/api-docs.js", "Holder and token endpoints"])}`,
    faq: [["Is this a guaranteed rug-pull detector?", "No. Holder patterns, authority checks and liquidity evidence can reveal concerns, but they cannot prove a token will remain tradable or prevent fraud."], ["Does a bundle label prove insider ownership?", "No. Shared timing or funding relationships are evidence for investigation, not verified identities."]],
  }),
  page({
    path: "/memecoin-alerts", crumb: "Memecoin alerts", topic: "Discovery",
    title: "Memecoin Alerts: Launches, Wallet Activity & Signals | Blix",
    description: "Use Blix signals for Solana launches, wallet activity, momentum and risk events. Configure local notification destinations, cooldowns and delivery checks.",
    eyebrow: "Signals · delivery · review", h1: "Memecoin alerts with enough context to act on",
    lede: "A notification should tell you what changed and which coin or wallet caused it. Blix records launch, market, wallet and research signals, with local notification rules that help you control what reaches you.",
    related: ["/pump-fun-tracker", "/solana-wallet-tracker", "/pumpfun-realtime-api"],
    body: `${cta("", "Open the live terminal")}
<h2 id="signals">Choose events that match the task</h2>
<p>Launch and graduation signals help with discovery. Momentum and volume events describe observed trading changes. Wallet signals connect activity to followed addresses. Risk events can highlight a creator sale or liquidity problem. AI-pick and research events carry an opinion that should be checked against its sources.</p>
<p>A “buy call” is a recorded model or rule output, not a fill confirmation. Open the coin, verify the mint and inspect the event timestamp before using a notification to make a decision.</p>
<h2 id="setup">Configure local notification delivery</h2>
<ol><li>Open Settings in your local installation and configure a supported Discord or Telegram destination.</li><li>Choose the event types you want delivered.</li><li>Use coin, wallet or type rules to mute noise, and set quiet periods or cooldowns where appropriate.</li><li>Send the destination's test notification, then inspect delivery history.</li><li>Check Health if alerts stop; the local service must remain running to observe events.</li></ol>
<p>An event visible in the dashboard does not mean a message reached an external destination. Browser notifications also depend on browser permissions and whether the browser is running. Hosted notification access can differ from the local settings interface.</p>
<h2 id="developer">Build a read-only alert consumer</h2>
${local}${code("curl -s 'https://blixvip.com/api/signals?safety=passed&limit=20' -H 'cookie: blix_wait='$BLIX_SESSION\ncurl -N https://blixvip.com/api/stream -H 'cookie: blix_wait='$BLIX_SESSION", "bash")}
<p>Use <a href="/pumpfun-realtime-api">the event stream</a> for incoming signals and the query endpoint for a recent snapshot. A safety filter narrows the available record; it does not eliminate token risk. Treat source outages and reconnects as possible gaps rather than silently claiming uninterrupted coverage.</p>
${evidence(["server/notify.js", "Notification delivery"], ["public/api-docs.js", "Signals and alert rules"], ["public/app.js", "Local settings workflow"])}`,
    faq: [["Will I receive alerts while my local PC is off?", "No. A local service cannot observe or deliver events while its host is stopped. An always-running deployment needs its own configured destinations."], ["Does receiving a signal place an order?", "No. Delivery and execution are separate flows."]],
  }),
  page({
    path: "/create-memecoin", crumb: "Create a memecoin", topic: "Token creation",
    title: "Create a Solana Memecoin on Pump.fun | Blix Coin Launcher",
    description: "Create a pump.fun memecoin in Blix using your image, name, ticker and description. Preview launch details, wallet funding and an optional first buy.",
    eyebrow: "Creator workflow · pump.fun", h1: "Create a Solana memecoin from one launch screen",
    lede: "Bring a coin name, ticker, picture and description to the Blix launcher. Preview the identity and launch details, choose whether to make a first buy, and submit a real pump.fun creation transaction from your configured account wallet.",
    related: ["/pump-fun-tracker", "/solana-trading-terminal", "/memecoin-social-sentiment"],
    body: `${cta("launch", "Open the coin launcher")}
<h2 id="prepare">Prepare the coin identity</h2>
<p>The launcher accepts a name of up to 32 characters and an alphanumeric ticker of up to 10 characters. Add a PNG, JPG, GIF or WebP picture and a concise description. Optional X, Telegram and website links belong to the project you are creating; check each destination before publishing.</p>
<p>The interface can suggest a ticker from the name and preview the coin. It accepts assets you supply. Built-in AI logo generation, automatic website creation and a full AI branding generator are not verified capabilities of this launch flow. You can prepare assets elsewhere, then review and upload them here.</p>
<h2 id="steps">How to launch a pump.fun coin</h2>
<ol><li>Sign in and confirm that your account wallet is available.</li><li>Open Create coin, add the identity fields and upload the picture.</li><li>Review the preview and optional social links.</li><li>Choose whether to make an initial buy and review its slippage setting.</li><li>Check the live wallet balance, estimated launch cost and reserve shown by the interface.</li><li>Submit only when ready to create the token. Keep the returned mint and transaction signature, then check confirmation.</li></ol>
<p>Token creation uses real SOL. There is no paper launch in this flow. Network and service conditions can change the required funding; use the current interface instead of a fixed cost copied from a tutorial.</p>
<h2 id="after">What happens after submission</h2>
<p>The service uploads the picture and metadata, then asks the wallet service to build, sign and submit the creation transaction and any selected first buy. The result provides a contract address and transaction reference. A submitted transaction can still be waiting on the network; the success view distinguishes that state from confirmation.</p>
<p>Share the exact contract address when introducing the coin. Open its coin page to monitor trading, holder concentration and creator allocation. A successful launch does not establish demand, trading liquidity or future value.</p>
${evidence(["web/src/pages/Launch.tsx", "Launch form and confirmation"], ["server/accounts.js", "Metadata and wallet launch flow"])}`,
    faq: [["Is Blix an AI meme coin maker?", "Blix is an AI-powered terminal with a coin creation workflow. The verified launcher takes your supplied identity and image; it does not currently establish a built-in AI logo, website or branding generator."], ["Can I launch without writing code?", "Yes. The browser form submits the creation workflow, provided sign-in, wallet funding and the configured launch service are available."], ["Is a first buy required?", "The interface offers an optional first buy. Review the current form and wallet requirements before submitting."]],
  }),
  page({
    path: "/memecoin-social-sentiment", crumb: "Social research", topic: "Narratives",
    title: "Memecoin Social Sentiment & Narrative Research | Blix",
    description: "Investigate Solana memecoin narratives using launch bursts, trading activity and available social sources. Understand what Blix sentiment research measures.",
    eyebrow: "Narratives · social evidence", h1: "Connect a memecoin story with observable activity",
    lede: "Blix groups related launches and examines the stories behind them. Use narrative activity, available social sources and actual trading to investigate attention around a token without assuming that online excitement becomes lasting demand.",
    related: ["/how-to-find-meme-coins-early", "/ai-memecoin-picks", "/create-memecoin"],
    body: `${cta("narratives", "Explore narratives")}
<h2 id="bursts">What a launch burst reveals</h2>
<p>A cluster can form when several creators launch coins around the same word or linked post within a short period. Blix compares that activity with a recent baseline and looks for real buyers in the associated coins. A set of repeated launches with no trading is different evidence from several independently traded coins.</p>
<p>Standing themes also summarize launch share, heat and changes in activity. Those metrics describe what the service observed. They are not a survey of every social-media user and should not be described as market-wide positive or negative sentiment.</p>
<h2 id="social-sources">Read the source before the interpretation</h2>
<p>Search-enabled Grok research can investigate X when that provider and capability are available. Other reads may use only the profile, linked post, website and news gathered by the service. Inspect the actual provider, citations and timestamps so a cached opinion is not mistaken for a fresh social scan.</p>
<ol><li>Open an active theme and identify the source event or repeated phrase.</li><li>Visit the linked source and check its author and time.</li><li>Compare the number of launches with buyer activity in individual coins.</li><li>Check whether the leading token is the same mint named by the source.</li><li>Inspect holders and liquidity before treating attention as a trading thesis.</li></ol>
<h2 id="limits">Where social analysis can mislead</h2>
<p>Copied tickers, repeated posts and coordinated promotion can inflate apparent attention. A token may attach itself to an unrelated event or public figure. A model summary can repeat a false claim from its sources. Preserve those uncertainties in the research record rather than converting them into a confident buy signal.</p>
${evidence(["server/narratives.js", "Narrative metrics"], ["server/research.js", "Research sources and provider status"], ["public/app.js", "Burst and theme explanations"])}`,
    faq: [["Is this a universal X sentiment score?", "No. Blix combines observed launch patterns, trading and available research sources. Its coverage depends on the feeds and providers that are running."], ["Can a trending narrative identify a winning coin?", "It can identify a story to investigate. Attention alone does not establish which token, if any, will retain demand."]],
  }),
  page({
    path: "/solana-pnl-tracker", crumb: "PnL tracker", topic: "Wallets",
    title: "Solana PnL Tracker: Realized, Open & Sellable Positions | Blix",
    description: "Understand Solana wallet PnL in Blix: separate realized results, open mark-to-market value, sellable estimates and paper-trading outcomes.",
    eyebrow: "Wallet analytics · PnL", h1: "Read Solana PnL without mixing cash and chart value",
    lede: "A wallet can show a large open gain while holding a token that cannot be sold at its displayed price. Blix separates realized, open and sellable results so those numbers can be assessed on their own terms.",
    related: ["/solana-wallet-tracker", "/memecoin-paper-trading", "/memecoin-risk-scanner"],
    body: `${cta("traders", "Inspect wallet results")}
<h2 id="definitions">Three numbers, three questions</h2>
${table(["Metric", "Question it answers", "What to inspect"], [
  ["Realized PnL", "What result was recorded on the observed closed trades?", "Entry coverage, partial sells and the accounting assumptions."],
  ["Open PnL", "How does the remaining position compare with its recorded cost?", "Price source, freshness and remaining token quantity."],
  ["Sellable value", "What portion of the position is considered exitable by the current checks?", "Liquidity, route availability and any unavailable or unsellable flags."],
])}
<p>A sellable estimate is still an estimate. Validate the current quote for the position size before expecting that value in a wallet. A quote and an eventual confirmed transaction can differ.</p>
<h2 id="example">Why a profitable-looking portfolio can disappoint</h2>
<p>Consider a hypothetical wallet that spends 1 SOL on a token, sells half its tokens and retains the rest. The sale belongs in realized accounting; the remaining quantity belongs in open accounting. If liquidity later disappears, the last chart price may still imply a gain on the remainder even though there is no usable exit.</p>
<p>This example illustrates the categories rather than Blix performance. Examine the recorded purchases and sales before reconstructing cost basis, especially when transfers or transactions before the observation window are involved.</p>
<h2 id="coverage">Compare histories with similar coverage</h2>
<p>A monitored public wallet's observed history is different from the authenticated account portfolio and from the simulated paper desk. Keep those datasets separate when reviewing performance. Tracking gaps, partial histories and missing entry costs can make two wallets' headline returns incomparable.</p>
<p>Use the <a href="/solana-wallet-tracker">wallet endpoint</a> for the observed ledger and the account interface for your configured account. Do not treat the tracker as a complete tax statement or an audit of every transfer on a wallet.</p>
${evidence(["server/wallets.js", "Observed wallet PnL"], ["server/paper.js", "Simulated position accounting"], ["public/api-docs.js", "Wallet and paper response descriptions"])}`,
    faq: [["Is open PnL money already received?", "No. Open PnL values the remaining position; realized results concern observed sales."], ["Why can a chart value differ from sellable value?", "The chart can reflect an earlier or smaller trade. Available liquidity, position size and route conditions determine what a current exit could return."]],
  }),
  page({
    path: "/how-to-find-meme-coins-early", crumb: "Early discovery guide", topic: "Guides",
    title: "How to Find Meme Coins Early: A Solana Research Workflow | Blix",
    description: "A practical workflow for finding new Solana and pump.fun coins: verify the mint, inspect demand, check holders and record a repeatable research decision.",
    eyebrow: "Guide · discovery", h1: "How to find meme coins early and keep the evidence",
    lede: "An early launch feed gives you a starting point. The harder task is distinguishing an active market from a copied name, a brief burst of promotion or a coin with no practical exit. Use this workflow to investigate new Solana tokens consistently.",
    related: ["/pump-fun-tracker", "/solana-memecoin-screener", "/memecoin-risk-scanner", "/memecoin-social-sentiment"],
    body: `${cta("", "Start with new pairs")}
<h2 id="step-one">1. Find the launch and verify its identity</h2>
<p>Open the new-pairs feed and record the mint address, launch time and source. Search by contract address when checking another site. Different coins can reuse an identical name, ticker and picture, so a matching label is not enough to connect a token to a story.</p>
<h2 id="step-two">2. Check whether activity extends beyond the launch</h2>
<p>Inspect buys, sells, volume and participating wallets across more than one time window. A single initial buy can move a thin market. Look for evidence that activity persists and note whether the feed has been running long enough to make the comparison meaningful.</p>
<h2 id="step-three">3. Review holders and the available exit</h2>
<p>Read creator allocation and sales, top-holder concentration and any early-buyer information. Check whether the ledger is partial. Then inspect liquidity and a sell quote; early visibility does not make a token liquid.</p>
<h2 id="step-four">4. Investigate the claimed catalyst</h2>
<p>Open linked posts, websites and narrative research. Compare timestamps: a post explaining a move after it happened is different evidence from a known catalyst before the move. Treat an AI summary as a guide to sources that still need checking.</p>
<h2 id="step-five">5. Record the decision and revisit it</h2>
<p>Save the time, mint, reason for interest and unanswered questions. Use the paper desk to test a repeatable rule, then inspect the eventual exit result as well as the peak. Keep rejected and losing candidates in the review so the process does not become a collection of surviving winners.</p>
<h2 id="next">What to do when evidence is missing</h2>
<p>Leave an unknown as unknown. Wait for holder data, a fresh source or a usable quote when those are necessary to the decision. The Health view can distinguish a quiet market from a broken feed. The aim of an early-discovery workflow is a better documented investigation; it cannot guarantee access to a profitable trade.</p>
${evidence(["public/api-docs.js", "Discovery data available"], ["server/quality.js", "Freshness and exit checks"], ["server/research.js", "Research workflow"])}`,
    faq: [["Can Blix find every new pump.fun coin before anyone else?", "No. Arrival times depend on source and network availability. The feed is a discovery tool, not a guaranteed first-access service."], ["Should I buy as soon as a coin appears?", "A launch notification alone does not establish demand, identity, liquidity or an acceptable risk profile. Inspect the evidence before making a decision."]],
  }),
  page({
    path: "/pumpfun-realtime-api", crumb: "Real-time API", topic: "Developers",
    title: "Pump.fun Real-Time Data API: SSE, JavaScript & Python | Blix",
    description: "Read pump.fun launch and signal events from the local Blix SSE API. Includes JavaScript and Python examples, reconnect behavior and snapshot recovery.",
    eyebrow: "Developer guide · streaming data", h1: "Read pump.fun events from the Blix real-time API",
    lede: "Blix exposes its observed launch, market and signal events through a Server-Sent Events endpoint. Connect once to read updates, and use snapshot endpoints to establish or refresh your application's current state.",
    related: ["/api", "/pump-fun-api", "/mcp", "/memecoin-alerts"],
    body: `${local}
<h2 id="transport">SSE transport and snapshot endpoints</h2>
<p><code>GET /api/stream</code> sends named events including <code>launch</code>, <code>signal</code> and <code>mig</code>. This is the Blix data service, not an official pump.fun API. Its HTTP event stream is distinct from the upstream WebSocket feeds the service may consume.</p>
<p>Start with <code>GET /api/pulse</code> to read the current board. Subscribe for new events, then refresh snapshots after reconnects. The stream does not advertise a durable event cursor or replay contract, so it should not be treated as a complete accounting ledger.</p>
<h2 id="javascript">JavaScript: consume launch and signal events</h2>
${code(`// Run in the console of your local Blix page (same origin).
const events = new EventSource("/api/stream");
for (const type of ["launch", "signal"]) {
  events.addEventListener(type, (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log(type, data);
    } catch (error) {
      console.error("Could not parse stream event", error);
    }
  });
}
events.onopen = async () => {
  const response = await fetch("/api/pulse");
  if (response.ok) console.log("current snapshot", await response.json());
};
events.onerror = () => console.warn("Stream interrupted; browser will reconnect.");
// When your consumer is no longer needed: events.close();`, "javascript")}
<h2 id="python">Python: inspect the wire format</h2>
${code(`import os, requests  # pip install requests

with requests.get("https://blixvip.com/api/stream", cookies={"blix_wait": os.environ["BLIX_SESSION"]},
                  stream=True, timeout=(5, 90)) as response:
    response.raise_for_status()
    response.encoding = "utf-8"
    for line in response.iter_lines(decode_unicode=True):
        if line:
            print(line, flush=True)`, "python")}
<p>This Python example prints SSE frames so you can inspect the actual events. A production consumer needs frame parsing, reconnect backoff, cancellation and a snapshot refresh after gaps. Do not assume that one line equals a complete event in every SSE implementation.</p>
<h2 id="operations">Handle interruptions explicitly</h2>
<p>Check response status before parsing. A proxy, authentication page or unavailable upstream can return something other than event data. Bound in-memory queues, record reconnects, and check <code>/api/health</code> when a quiet stream conflicts with expected activity.</p>
<p>For hosted use, consult the deployment's authentication and access rules. Do not copy account cookies or credentials into published examples. Read the <a href="/api">endpoint reference</a> for request semantics and the <a href="/mcp">MCP guide</a> if your consumer is an AI client.</p>
${evidence(["server/server.js", "SSE server and event broadcasting"], ["public/api-docs.js", "Published event names"])}
${cta("api", "Open API reference in the terminal")}`,
    faq: [["Is this a pump.fun WebSocket API?", "Blix exposes SSE over HTTP at /api/stream. Upstream transport and the interface your client consumes are different."], ["Will reconnecting replay every missed trade?", "No durable replay guarantee is documented for this stream. Refresh snapshots and record coverage gaps."], ["Are these Python and JavaScript SDKs?", "No. These are examples using HTTP and standard clients. They do not establish a separately published Blix SDK package."]],
  }),
];
