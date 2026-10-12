// Editorial comparisons: primary-source observations, not benchmark results.
import { table, ext } from "./html.js";
import { COMPETITOR_GUIDES } from "./competitor-guides.js";

const CHECKED = "2026-10-10";
const DATE = "October 10, 2026";
const sources = (items) => `<h2 id="sources">Sources and review</h2><p class="meta">Reviewed by BLIX · ${DATE}. Product documentation can change. This is a documentation comparison, not an independent execution benchmark.</p><ul>${items.map(([url, label]) => `<li>${ext(url, label)}</li>`).join("")}</ul><p>Discuss these guides in the <a href="https://discord.gg/3VWHBP6paA" target="_blank" rel="noopener noreferrer">BLIX Discord</a>. Links on this page contain no referral codes.</p>`;
const independent = (name) => `<p class="note">BLIX publishes this comparison of its own product. It is independent of ${name}; no affiliation or endorsement is implied.</p>`;
const cta = `<div class="cta"><a class="btn primary" href="/app">Open BLIX</a><a class="btn" href="/memecoin-paper-trading">Explore paper trading</a></div>`;
const common = { og: "og-api.png", topic: "comparisons", verifiedAt: CHECKED, updated: CHECKED, author: "BLIX" };

const hub = {
  ...common,
  path: "/compare", crumb: "Compare terminals",
  title: "Compare Solana Memecoin Terminals: BLIX, Axiom, Fomo & Nio",
  description: "Compare Solana terminals by discovery workflow, AI research, developer access and paper trading. Sourced Axiom, Fomo and Nio comparisons with clear unknowns.",
  eyebrow: "Terminal comparisons · evidence before rankings",
  h1: "Choose a memecoin terminal for your workflow",
  lede: "The best Solana trading terminal depends on what you need to do: discover tokens, follow traders, investigate holders, build an agent or place an order. These comparisons separate documented features from questions that still need a hands-on answer.",
  related: ["/compare/axiom-alternative", "/compare/fomo-alternative", "/compare/nio-trade-alternative", "/api", "/mcp"],
  body: `${independent("the platforms discussed here")}
<h2 id="comparisons">Start with your current platform</h2>
${table(["Comparison", "Main decision", "What to evaluate"], [
  ['<a href="/compare/axiom-alternative">Axiom alternative</a>', "Execution workflow and research access", "Compare Pulse discovery, holder definitions, wallet tracking and developer access."],
  ['<a href="/compare/fomo-alternative">Fomo alternative</a>', "Social discovery and independent investigation", "Compare a trader's alert with the underlying token, liquidity and wallet history."],
  ['<a href="/compare/nio-trade-alternative">Nio.trade alternative</a>', "Chain coverage and a customizable research workflow", "Compare the chains you need, available data and the work required to connect an agent."],
  ...COMPETITOR_GUIDES.map(p => [`<a href="${p.path}">${p.crumb}</a>`, p.h1, p.description]),
])}
<h2 id="method">A useful comparison uses the same inputs</h2>
<ol><li><b>Pick a task.</b> Finding a launch, monitoring a wallet and submitting a swap are different tests. Choose the one you actually repeat.</li>
<li><b>Match token addresses and time.</b> Names and tickers are not identifiers. Record the mint, chain, observation time and data freshness before comparing screens.</li>
<li><b>Match trade assumptions.</b> For a quote comparison, use the same side, size and slippage. Record platform fees, network charges and any priority tip separately. A quote is not a confirmed fill.</li>
<li><b>Define the result.</b> For discovery, measure useful candidates found. For research, measure how often a conclusion has supporting evidence. For execution, distinguish submission, confirmation and failure.</li>
<li><b>Record misses.</b> Stale prices, unavailable routes, incomplete holder history and missing chain coverage belong in the result, alongside successful examples.</li></ol>
<h2 id="shortlist">What these products document</h2>
<p>${ext("https://docs.axiom.trade/", "Axiom's documentation")} describes a web trading interface with discovery and execution features. ${ext("https://fomo.family/", "Fomo's homepage")} emphasizes its social trading experience across phone and web. ${ext("https://nio.trade/", "Nio's homepage")} emphasizes multiple chains and configurable trading workflows. These descriptions establish product positioning; they do not establish which product is faster or more profitable.</p>
<p>BLIX combines Solana token discovery, holder and wallet analysis, AI research and a paper desk. Its <a href="/api">local API</a> and <a href="/mcp">MCP server</a> offer a path for your own tools to read that research. Hosted access and a local installation have different account and configuration requirements.</p>
<h2 id="developer-checklist">For API, MCP, CLI and SDK users</h2>
<p>Start from the vendor's own domain. A repository with a platform's name may be an independent client, and a browser's internal endpoint may not be a supported API. Before building on an interface, establish who maintains it, how authentication works, what data it returns and whether the intended use is supported.</p>
<p>Check whether an AI integration is read-only or can execute transactions. Keep a research proof of concept read-only, test missing data and rate-limit handling, and inspect tool permissions before enabling any action that changes an account.</p>
<h2 id="best">What would justify calling a terminal the best?</h2>
<p>A dated test with a defined workload and published failures can support a narrow conclusion. A feature list alone cannot establish the best execution, lowest total cost or highest trading returns. This comparison does not assign those awards.</p>
<p>For BullX, Photon, GMGN, DexScreener, Birdeye and Jupiter comparisons, apply the same method and consult each vendor's current documentation. This hub does not rank platforms that have not been evaluated. For a currently documented developer comparison, read the <a href="/gmgn-api">GMGN API guide</a>.</p>
${cta}
${sources([["https://docs.axiom.trade/", "Axiom product documentation"], ["https://fomo.family/", "Fomo official homepage"], ["https://nio.trade/", "Nio official homepage"], ["https://blixvip.com/", "BLIX trading terminal"]])}`,
  faq: [
    ["Is BLIX the best alternative for every trader?", "No. Evaluate the chains, execution controls, account setup and research tools needed for your workflow. These pages identify reasons to evaluate BLIX and questions still requiring a direct product test."],
    ["Are the comparisons based on live trading benchmarks?", "No. They combine current primary-source documentation with BLIX's available interfaces. No trades were placed and no execution-speed or profitability benchmark is claimed."],
  ],
};

const axiom = {
  ...common,
  path: "/compare/axiom-alternative", crumb: "Axiom alternative",
  title: "Axiom Alternative for AI Research, API & Paper Trading | BLIX",
  description: "Evaluate BLIX alongside Axiom: Pulse discovery, holder analysis, wallet tracking, AI research, local API and MCP access. Includes official sources and test criteria.",
  eyebrow: "BLIX and Axiom · workflow comparison",
  h1: "An Axiom alternative for research and developer workflows",
  lede: "If you use Axiom to discover Solana tokens, evaluate BLIX when you also want inspectable research, a local data API or an MCP connection. Compare those requirements separately from the execution controls you already rely on.",
  related: ["/compare", "/axiom-api", "/pump-fun-tracker", "/mcp", "/memecoin-paper-trading"],
  body: `${independent("Axiom Trade")}
<h2 id="workflow">Compare the workflow, step by step</h2>
${table(["Task", "Axiom's documentation", "BLIX evaluation"], [
  ["Find a launch", 'The <a href="https://docs.axiom.trade/axiom/finding-tokens/pulse" rel="noopener">Pulse guide</a> groups new pairs, tokens near bonding-curve completion and migrated tokens.', 'Open the <a href="/pump-fun-tracker">pump.fun tracker</a>; match mint addresses and observation times.'],
  ["Filter holder activity", "Pulse lists top-holder, developer, sniper and bundle filters.", "Read holder coverage before interpreting percentages; a partial trade history cannot reconstruct every early buyer."],
  ["Follow wallets", 'The <a href="https://docs.axiom.trade/wallet-tracking/monitor-wallets" rel="noopener">wallet monitor</a> documents tracking watched wallets while viewing Pulse.', "Compare the same public wallet's activity and the distinction between realized, open and sellable PnL."],
  ["Manage an order", 'The <a href="https://docs.axiom.trade/axiom/swap/limit-orders" rel="noopener">limit-order guide</a> describes price-triggered buys and sells.', 'Evaluate BLIX research with the <a href="/memecoin-paper-trading">paper desk</a> first. Simulated positions do not prove live execution quality.'],
  ["Build an agent", "The reviewed documentation index did not establish a supported public MCP, CLI, SDK or developer API.", 'Inspect the <a href="/api">BLIX local API</a> and <a href="/mcp">MCP tools</a>; verify the permissions of the tools you enable.'],
])}
<h2 id="why-blix">When BLIX belongs on your shortlist</h2>
<p>Consider BLIX when your question extends beyond a chart: why a token surfaced, which early wallets still hold supply, whether an AI explanation has evidence, or how a proposed rule behaves on a paper desk. A local installation also lets a script consume data without rebuilding a terminal interface.</p>
<p>Keep your existing execution workflow if a required control, chain or order type has not been verified in the BLIX deployment you plan to use. These pages do not assert equivalent execution, fills or custody arrangements.</p>
<h2 id="trial">A repeatable evaluation</h2>
<ol><li>Choose a small set of token mints spanning a new launch, a token approaching migration and an established pool.</li><li>At a recorded time, compare price freshness, holder-history coverage and the definitions behind each filter. Different definitions can explain different numbers.</li><li>Ask the same research question for each token. Save the answer with the data timestamp, missing inputs and stated uncertainty.</li><li>Paper-test a fixed entry and exit rule, recording losing and unfilled cases. Compare those results only with another simulation using the same assumptions.</li><li>Evaluate actual execution separately using current vendor documentation and your account's controls.</li></ol>
<h2 id="developers">Axiom API, bots and MCP searches</h2>
<p>The ${ext("https://docs.axiom.trade/llms.txt", "Axiom documentation index")} reviewed on ${DATE} did not document those public developer interfaces. That is a research limit, not proof that access cannot exist. Contact Axiom through its official site for current developer availability.</p>
<p>BLIX's API supplies BLIX data; it does not turn an Axiom account into an API account. Its MCP server does not imply an Axiom integration. For implementation details and distinctions between supported and unofficial clients, see the <a href="/axiom-api">Axiom API guide</a>.</p>
${cta}
${sources([["https://docs.axiom.trade/axiom/finding-tokens/pulse", "Axiom Pulse and filters"], ["https://docs.axiom.trade/wallet-tracking/monitor-wallets", "Axiom wallet monitoring"], ["https://docs.axiom.trade/axiom/swap/limit-orders", "Axiom limit orders"], ["https://docs.axiom.trade/llms.txt", "Axiom documentation index"], ["https://blixvip.com/", "BLIX trading terminal"]])}`,
  faq: [
    ["Does BLIX replace my Axiom account?", "No. They are separate products. This guide evaluates research and developer workflows; it does not promise account migration, shared balances or equivalent order execution."],
    ["Is BLIX an official Axiom bot or MCP server?", "No. BLIX's API and MCP interfaces expose BLIX capabilities. An official Axiom integration must be verified with Axiom itself."],
    ["Is this an Axiom vs BullX or Photon benchmark?", 'No. Those comparisons require separate evidence and testing. The <a href="/compare">comparison checklist</a> explains how to evaluate the same workflow across terminals.'],
  ],
};

const fomo = {
  ...common,
  path: "/compare/fomo-alternative", crumb: "Fomo alternative",
  title: "Fomo Alternative for Memecoin Research & Wallet Analysis | BLIX",
  description: "Compare Fomo social discovery with BLIX token research, wallet analysis, paper trading and developer tools. See what is verified and how to evaluate the workflow.",
  eyebrow: "BLIX and Fomo · social discovery and research",
  h1: "A Fomo alternative for investigating a trade idea",
  lede: "A trader alert can tell you what someone bought. Evaluating that trade also needs token identity, liquidity, holder context and an exit assumption. BLIX is worth evaluating when that second step is central to your workflow.",
  related: ["/compare", "/fomo-api", "/solana-memecoin-screener", "/api", "/memecoin-paper-trading"],
  body: `${independent("Fomo Labs and fomo.family")}
<h2 id="scope">Which Fomo is this?</h2>
<p>This page refers to the crypto product at ${ext("https://fomo.family/", "fomo.family")}. It does not review unrelated products using the word Fomo or the general fear-of-missing-out concept. Fomo's homepage presents mobile and web trading, a social feed, trader discovery and activity notifications.</p>
<h2 id="comparison">From social discovery to a researched decision</h2>
${table(["Question", "What to inspect", "How to evaluate BLIX"], [
  ["Which token did the trader buy?", "Use the chain and contract or mint address, not a ticker or screenshot.", "Find that mint and inspect the available token data."],
  ["Is the move still tradable?", "Distinguish the original trade time from the notification and your current quote.", "Review the current market, liquidity context and quote rather than assuming the earlier entry is available."],
  ["What does the wallet's record mean?", "Separate deposits, swaps, remaining positions and realized results.", "Read the wallet's available history and PnL categories; incomplete history can change the interpretation."],
  ["What supports the idea?", "Record the thesis, evidence and conditions that would invalidate it.", "Use AI research as an explanation to inspect, then compare it with holder and market data."],
  ["Can the idea be tested?", "Choose an entry size, exit rule and observation window before seeing the result.", 'Use the <a href="/memecoin-paper-trading">paper desk</a> and retain losing examples as well as winners.'],
])}
<h2 id="fit">When to consider each workflow</h2>
<p>If your priority is following people and acting from a mobile social feed, start by evaluating Fomo's documented product experience. If your priority is researching Solana token activity, inspecting a data pipeline or adding analysis to an AI client, evaluate BLIX's screener, local API and MCP server.</p>
<p>These workflows can coexist. A public wallet address can be investigated independently of the app that first surfaced it. That does not give BLIX access to a Fomo account, private messages, private profile information or every transaction's origin.</p>
<h2 id="developer">Fomo API, MCP, bot, SDK and CLI questions</h2>
<p>The reviewed Fomo homepage and linked help index did not establish supported public interfaces for these uses. Availability remains unverified. A search result named “Fomo API” or an unofficial package using the brand is not sufficient evidence of an official integration.</p>
<p>For an independent research workflow, use documented BLIX endpoints for the data BLIX actually has. Read the <a href="/fomo-api">Fomo API guide</a> before treating wallet attribution as an account integration. Do not infer an identity or a complete performance record from a fee payer or a small sample of trades alone.</p>
<h2 id="trial">Try one complete research loop</h2>
<ol><li>Save a token mint and public wallet address from an idea you want to investigate.</li><li>Record when the original action occurred and when you observed it.</li><li>Inspect the token's holder distribution, current market and available wallet history.</li><li>Write a short thesis and a condition that would disprove it.</li><li>Observe or paper-test the idea, keeping the original timestamp and every outcome.</li></ol>
<p>This establishes whether the workflow helps you investigate ideas. It does not establish that following a profitable-looking wallet will produce the same result.</p>
${cta}
${sources([["https://fomo.family/", "Fomo official product homepage"], ["https://fomo.family/answers", "Fomo linked help index"], ["https://blixvip.com/", "BLIX trading terminal"]])}`,
  faq: [
    ["Is BLIX the Fomo app or an official Fomo integration?", "No. BLIX is a separate Solana research and trading terminal. This comparison does not imply access to a Fomo account or support from Fomo."],
    ["Can a public wallet tracker reproduce a trader's results?", "Not reliably from an incomplete history. Timing, fills, transfers and unobserved positions can change the result; an alert does not guarantee access to the trader's entry price."],
    ["Where should I find a Fomo download or setup guide?", 'Use <a href="https://fomo.family/" rel="noopener">Fomo’s official website</a> and its linked resources. BLIX does not distribute Fomo software.'],
  ],
};

const nio = {
  ...common,
  path: "/compare/nio-trade-alternative", crumb: "Nio.trade alternative",
  title: "Nio.trade Alternative for Solana AI Research & MCP | BLIX",
  description: "Evaluate BLIX alongside Nio.trade by chain coverage, research workflow, wallet analysis and developer access. Official sources, honest unknowns and a trial checklist.",
  eyebrow: "BLIX and Nio.trade · coverage and control",
  h1: "A Nio.trade alternative for focused Solana research",
  lede: "Start with the chains and controls your workflow requires. BLIX focuses on Solana memecoin discovery and research, with a local API and MCP server for custom analysis. This comparison identifies what to verify before changing terminals.",
  related: ["/compare", "/solana-memecoin-screener", "/api", "/mcp"],
  body: `${independent("Nio.trade")}
<h2 id="documented">What Nio's public site documents</h2>
<p>${ext("https://nio.trade/", "Nio's homepage")} advertises multiple chains, wallet and social tracking, limit orders, sniping and interface customization. Those are vendor descriptions, not features independently exercised in this comparison. Its linked documentation could not be retrieved during this review; exact account requirements and developer-interface availability remain unverified.</p>
<h2 id="criteria">Choose the requirements that matter</h2>
${table(["Requirement", "Nio evaluation", "BLIX evaluation"], [
  ["Chain coverage", "Verify your required chain and protocol in the current application.", "Solana-focused research; do not assume equivalent coverage for other chains."],
  ["Screen layout", "Test the documented customization against your actual workstation.", "Try Pulse, discovery and token detail at the screen size you use."],
  ["Wallet research", "Check history coverage and how wallet activity is presented.", "Compare the same wallet, timestamps and PnL definitions."],
  ["Order controls", "Verify documented limit and sniping functions in the current product.", "Confirm the controls available in your deployment; a paper desk is a simulation, not evidence of live order parity."],
  ["AI and developer access", "Public API, MCP, SDK and CLI availability was not established in this review.", 'Read the <a href="/api">local API reference</a> and <a href="/mcp">MCP setup</a>; inspect the actual available tools.'],
])}
<h2 id="fit">Where BLIX may fit</h2>
<p>Evaluate BLIX if most of your research concerns Solana token launches, holder behavior and questions you want an AI client to investigate using structured data. Create an account to explore the terminal and its available research tools.</p>
<p>If your primary requirement is trading across several chains from one account experience, verify that requirement directly before switching. A focused Solana workflow does not replace coverage that has not been implemented.</p>
<h2 id="test">A practical side-by-side trial</h2>
<ol><li>List the chains, protocols and order controls you require; mark each as demonstrated, undocumented or unavailable.</li><li>Select identical Solana mint addresses and a public wallet for the research comparison.</li><li>Record whether the displayed data is current, how partial history is signaled and whether explanations can be traced to inputs.</li><li>Check the research interface at both mobile and desktop widths if you use both.</li><li>For an agent integration, test a read-only question first. Verify authentication, tool permissions, error responses and missing-data behavior.</li></ol>
<h2 id="unknown">What this page does not establish</h2>
<p>No current fee ranking, execution-speed ranking, profitability claim or account-security equivalence is established here. No Nio SDK, bot, MCP server or CLI is presented as official without a vendor source. For setup, downloads and support, follow links from ${ext("https://nio.trade/", "Nio's own site")}.</p>
<p>BLIX does not import a Nio account or inherit its permissions. Treat a move as a fresh setup: compare features first, preserve your existing records and verify the destination account before taking any financial action.</p>
${cta}
${sources([["https://nio.trade/", "Nio official homepage and documentation link"], ["https://docs.nio.trade/", "Nio documentation — linked by Nio; retrieval unavailable during review"], ["https://blixvip.com/", "BLIX trading terminal"]])}`,
  faq: [
    ["Does this comparison verify a Nio.trade API or MCP server?", "No. The public homepage was reviewed, but the linked documentation could not be retrieved. Developer-interface availability remains unverified."],
    ["Does BLIX offer the same chain coverage as Nio?", "This comparison makes no such claim. BLIX's documented research workflow focuses on Solana; verify every required chain and protocol before changing platforms."],
    ["Is this a Nio.trade tutorial or official support page?", 'No. For the current Nio product, begin at <a href="https://nio.trade/" rel="noopener">nio.trade</a>. This page helps evaluate BLIX as a separate product.'],
  ],
};

export const COMPARISON_PAGES = [hub, axiom, fomo, nio];
