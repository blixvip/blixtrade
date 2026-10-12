// Dated, documentation-based buying guides. No execution or profitability benchmark.
import { table, ext } from "./html.js";

const DATE = "2026-10-10";
const SOURCES = {
  bullx: ["https://neo.bullx.io/", "BullX Neo application notice"],
  bullxOrders: ["https://bullx.gitbook.io/bullx-neo-docs/trading-terminal/trading", "BullX Neo order documentation"],
  gmgn: ["https://docs.gmgn.ai/index/wallet-radar", "GMGN Wallet Radar"],
  gmgnExport: ["https://docs.gmgn.ai/index/wallets-import-export", "GMGN wallet-list import and export"],
  dex: ["https://docs.dexscreener.com/api/reference", "DEX Screener API reference"],
  boosts: ["https://docs.dexscreener.com/boosting", "DEX Screener Boosts explained"],
  birdeye: ["https://data.birdeye.so/docs/getting-started", "Birdeye Data overview"],
  jupiter: ["https://developers.jup.ag/docs/tool-kits/plugin", "Jupiter Plugin integration guide"],
  axiom: ["https://docs.axiom.trade/axiom/finding-tokens/pulse", "Axiom Pulse documentation"],
  fomo: ["https://fomo.family/", "Fomo official product site"],
};
const cite = (key) => ext(...SOURCES[key]);
const cta = `<div class="cta"><a class="btn primary" href="/start">Try BLIX</a><a class="btn" href="/">Explore the terminal</a></div>`;
const finish = (keys) => `<h2 id="sources">Sources and method</h2><p>Reviewed by BLIX on October 10, 2026. This guide uses primary documentation and explains how to evaluate a workflow. It does not claim a hands-on execution test, a fee comparison or a trading-return advantage.</p><ul>${keys.map((key) => `<li>${cite(key)}</li>`).join("")}</ul><p>BLIX publishes this guide about its own product and is independent of the vendors named. Links contain no referral codes. Discuss corrections in the <a href="https://discord.gg/3VWHBP6paA" target="_blank" rel="noopener noreferrer">BLIX Discord</a>.</p>${cta}`;
const page = (p) => ({ updated: DATE, verifiedAt: DATE, topic: "comparisons", og: "og-api.png", author: "BLIX", ...p });

const bullx = page({
  path: "/compare/bullx-alternative", crumb: "BullX alternative",
  title: "BullX & BullX Neo Alternative: Rebuild Your Trading Workflow | BLIX",
  description: "Evaluate a BullX Neo alternative by current availability, wallet records, order controls and Solana research. A practical transition checklist with primary sources.",
  h1: "A BullX alternative starts with the workflow you need to keep",
  eyebrow: "BullX Neo · availability and workflow",
  lede: "Before comparing feature lists, check whether your current BullX version accepts trades. Then separate the records and public addresses you can carry over from account permissions and order settings that need a fresh setup.",
  related: ["/compare/solana-terminal-comparison", "/solana-trading-terminal", "/solana-wallet-tracker", "/memecoin-paper-trading"],
  body: `<h2 id="status">Current availability comes before old feature lists</h2>
<p>The indexed ${cite("bullx")} notice reviewed on October 10, 2026 says trading is disabled on that version while wallet and withdrawal functions remain accessible. Check the application itself for the current notice. This does not establish the status of every BullX product or a future release date.</p>
<p>The ${cite("bullxOrders")} describes order presets, limit orders, DCA and multi-wallet controls. Treat that as a description of the documented workflow, not proof that those controls currently execute trades.</p>
<h2 id="carry-over">What to carry into an evaluation</h2>
${table(["Record", "Why it matters", "How to use it"], [
  ["Public wallet addresses", "Your positions and activity should be identified by address, not a display name.", "Use public addresses for research without transferring account credentials."],
  ["Token mints and notes", "A name or ticker can refer to several tokens.", "Rebuild a watchlist by exact mint and retain the original thesis."],
  ["Order intentions", "A former order preset is not automatically active elsewhere.", "Write down size, slippage and exit conditions; verify the new terminal's controls."],
  ["Transaction records", "A second tracker may observe a different history window.", "Retain your existing records and compare the covered period before interpreting PnL."],
])}
<h2 id="blix">Evaluate BLIX for Solana discovery and research</h2>
<p>BLIX brings token discovery, holder analysis, wallet research and AI explanations into a browser terminal. Start with a coin you already know: inspect the mint, available data, holder coverage and research timestamp. This reveals whether the new workflow answers your questions without relying on an attractive example picked after the result.</p>
<p>The <a href="/memecoin-paper-trading">paper desk</a> lets you rehearse an entry and exit process. It is a simulation; its outcomes do not establish the timing, fill or reliability of live execution. The <a href="/solana-trading-terminal">account trading flow</a> is separate and requires its own account, funds and service availability.</p>
<h2 id="acceptance">A transition checklist</h2>
<ol><li>List the required chain, order types and number of wallets. Mark a requirement unknown until demonstrated.</li><li>Rebuild a small public-address watchlist and compare token identification and data freshness.</li><li>Inspect research on both an active token and one with incomplete or stale data.</li><li>Practise the intended position size and exit rule in paper mode.</li><li>Review actual account controls before considering funded execution. Changing terminals does not transfer a standing order.</li></ol>
<p>BLIX does not claim an automatic BullX migration or parity with every BullX order type. If DCA, coordinated multi-wallet execution or another specific control is essential, verify that capability before choosing a replacement.</p>
${finish(["bullx", "bullxOrders"])}`,
  faq: [["Does this cover BullX Neo alternatives too?", "Yes. The guide consolidates BullX and BullX Neo replacement intent while distinguishing the indexed Neo availability notice from older documentation."], ["Will BLIX import my BullX account and orders?", "No automatic account or open-order import is established here. Public token and wallet addresses can be researched independently; account permissions and financial actions need a separate setup."]],
});

const gmgn = page({
  path: "/compare/gmgn-alternative", crumb: "GMGN alternative",
  title: "GMGN Alternative: Wallet Research, AI Context & Paper Tests | BLIX",
  description: "Compare GMGN wallet discovery with BLIX Solana research. Understand selected-wallet bias, PnL coverage, watchlists and the difference between observing and copying.",
  h1: "A GMGN alternative for investigating wallet-led ideas",
  eyebrow: "Wallet discovery · research quality",
  lede: "Finding a wallet that traded a winning token is a starting point. A useful research workflow also explains its entry time, remaining exposure, losses and the portion of its history that was actually observed.",
  related: ["/compare/solana-terminal-comparison", "/gmgn-api", "/solana-wallet-tracker", "/solana-pnl-tracker"],
  body: `<h2 id="documented">What GMGN documents</h2>
<p>${cite("gmgn")} describes finding wallets across selected tokens, including shared holdings, early buyers and realized-profit views, with paths to tracking and copy trading. Its ${cite("gmgnExport")} explains moving a followed-wallet list. Those are concrete workflows to consider alongside BLIX's Solana wallet research.</p>
<h2 id="wallet-selection">A wallet shortlist is only as good as its selection rule</h2>
<p>Suppose you choose three tokens after they have risen and then look for wallets that bought all three. The resulting list answers who appeared in those selected winners. It does not measure how the same rule would have performed before the winners were known.</p>
<p>For a useful comparison, write down the selection date and rule first. Save the shortlist, then observe every selected wallet over the same subsequent period. Include inactive addresses, losing trades and positions that cannot be priced. Otherwise a clean-looking leaderboard can hide an uneven sample.</p>
${table(["Question", "Evidence to retain"], [
  ["How was this wallet found?", "The token set, selection rule and date before further results occurred."],
  ["Does the PnL mean realized profit?", "The reporting period, remaining positions, transfers and missing-history treatment."],
  ["Could you have matched the trade?", "Time of original action, time observed, available quote and size."],
  ["Is this still the same strategy?", "Changes in traded tokens, position sizes and holding periods."],
])}
<h2 id="blix">Where BLIX fits</h2>
<p>Use BLIX to connect a wallet observation with the token's market, holder distribution and available AI research. Inspect the <a href="/solana-wallet-tracker">wallet tracker</a> and <a href="/solana-pnl-tracker">PnL definitions</a> before comparing totals. A source with more or different history can produce a different answer without either display being a direct measure of your own achievable return.</p>
<p>BLIX's paper workflow can record a separate idea based on that research. Following an address is not an instruction to copy it, and a paper position is not a live copied order. This guide does not claim equivalence with GMGN's documented copy-trading controls.</p>
<h2 id="developers">Choose the product and the interface separately</h2>
<p>An API evaluation needs endpoint coverage, permissions, quotas and failure handling. A terminal evaluation needs usable research and account controls. See the existing <a href="/gmgn-api">GMGN API comparison</a> for that developer question; this page focuses on evaluating a wallet-led workflow.</p>
<h2 id="trial">A practical trial</h2>
<ol><li>Choose a fixed set of public wallets and a common observation window.</li><li>Separate research notes from trade intentions.</li><li>Check an open position, a closed loss and an address with incomplete data.</li><li>Save any AI opinion with the evidence available at the time.</li><li>Compare the usefulness of the resulting record before changing your financial workflow.</li></ol>
${finish(["gmgn", "gmgnExport"])}`,
  faq: [["Does a profitable wallet guarantee profitable copy trading?", "No. Observation timing, price, size, exits and missing history can change results. This comparison evaluates research rather than promising copied returns."], ["Can I reuse public wallet addresses from a watchlist?", "Public addresses can be inspected independently. An export does not transfer account permissions, private keys or existing orders to BLIX."]],
});

const dex = page({
  path: "/compare/dexscreener-alternative", crumb: "DEX Screener alternative",
  title: "DEX Screener Alternative for Solana Token Research | BLIX",
  description: "Evaluate a DexScreener alternative by pair identity, holder context, research and data freshness. Learn how to separate promoted visibility from a trading thesis.",
  h1: "A DEX Screener alternative for the questions after a chart",
  eyebrow: "Token discovery · pair data · research",
  lede: "A token page helps locate activity. The next questions concern which pool you are viewing, who holds the supply, whether the data is current and what would invalidate the idea. Compare tools against those questions.",
  related: ["/solana-memecoin-screener", "/memecoin-risk-scanner", "/compare/birdeye-alternative", "/api"],
  body: `<h2 id="data-model">A token and a trading pair are different objects</h2>
<p>The ${cite("dex")} documents pair, search and token-pool lookups. This distinction matters: one token may trade in more than one pool, with different quote assets and liquidity. Compare the exact chain, token mint and pair before deciding that two screens disagree.</p>
<p>For example, a thin pool can display a sharp last-trade move while a larger pool provides a very different quote for your intended size. The useful result is a clear explanation of the discrepancy, not a claim that whichever number looks better is the correct trade price.</p>
${table(["Observation", "Next question", "BLIX research step"], [
  ["Volume rose", "Which window and pool does the figure describe?", "Match the mint and time window before comparing activity."],
  ["A token is prominent", "Is visibility promoted, organic or a mixture?", "Investigate actual trades, holder behavior and the underlying narrative."],
  ["Liquidity looks sufficient", "What would a quote return at your size?", "Review available quote and price-impact information, not just a headline amount."],
  ["A risk indicator is absent", "Is it a clean result or missing coverage?", "Read source freshness and holder-history limits before drawing a conclusion."],
])}
<h2 id="visibility">Separate visibility from evidence</h2>
<p>${cite("boosts")} explains that purchased Boosts can affect Trending Score. A prominent listing should therefore begin an investigation, not finish it. This is not a claim that all rankings are paid or that a boosted token is fraudulent.</p>
<p>Record why a token first caught your attention. Then test the thesis against information independent of that attention: concentration, the activity of early holders, current quote conditions and sources behind the story.</p>
<h2 id="blix">When to evaluate BLIX</h2>
<p>BLIX is useful to evaluate when your Solana workflow needs token discovery beside holder research, wallet context, AI explanations and a paper desk. Open the <a href="/solana-memecoin-screener">screener</a> with a known mint and compare how much evidence you can inspect before acting.</p>
<p>Do not assume BLIX replaces every chain, historical dataset or pair view you use elsewhere. If a broad cross-chain watchlist is essential, verify each requirement separately. Different services can complement one another.</p>
<h2 id="developers">For developers comparing data sources</h2>
<p>Start from the documented response fields. Keep missing values distinct from zero; preserve source and observation timestamps; record whether an answer refers to a token or a pool. Check usage terms and present-day limits directly before building around an endpoint.</p>
<p>The <a href="/api">BLIX API reference</a> describes its own research data. It is not a drop-in guarantee for DEX Screener's response schema. A migration needs a field-by-field comparison and a test of missing or stale data.</p>
${finish(["dex", "boosts"])}`,
  faq: [["Is BLIX a replacement for every DEX Screener use?", "No. Evaluate the chains, pool views, history and interfaces you actually require. BLIX's documented focus is Solana memecoin research and trading workflows."], ["Does a trending or boosted token make a good trade?", "Visibility alone does not establish liquidity, ownership distribution or future demand. Use it as a discovery input and investigate the token separately."]],
});

const birdeye = page({
  path: "/compare/birdeye-alternative", crumb: "Birdeye alternative",
  title: "Birdeye Alternative: Compare Research Workflows & Data Needs | BLIX",
  description: "Compare Birdeye Data and BLIX by the question you need answered: token research, liquidity, wallet PnL, historical coverage or a ready-to-use Solana terminal.",
  h1: "Choose a Birdeye alternative by the data you need",
  eyebrow: "Birdeye · data service or terminal",
  lede: "A developer replacing a data service and a trader replacing a research screen face different decisions. Define the required dataset and workflow before treating two products as substitutes.",
  related: ["/compare/dexscreener-alternative", "/solana-wallet-tracker", "/solana-pnl-tracker", "/api"],
  body: `<h2 id="which-product">Which Birdeye use are you replacing?</h2>
<p>The ${cite("birdeye")} describes token, pair, wallet and market data, including prices, candles, liquidity, holders and PnL. Its developer quickstart calls for an account and API key. This establishes a data-service use case; it does not mean every dataset has identical chain coverage or access conditions.</p>
<h2 id="requirements">Build a small requirements sheet first</h2>
${table(["Requirement", "A useful specification", "What would fail the test"], [
  ["Price", "Exact mint or pair, quote currency, freshness threshold and missing-value behavior.", "An old value presented as current, or a different pool silently substituted."],
  ["History", "Time range, candle interval, timezone and treatment of empty periods.", "A chart that starts later than required without indicating the gap."],
  ["Wallet PnL", "Observed history, transfer treatment and realized/open separation.", "A total that cannot be reconciled with its underlying positions."],
  ["Holder analysis", "Snapshot time, supply basis and coverage for early buyers.", "Missing coverage displayed as zero concentration."],
  ["Operations", "Expected requests, error handling and recovery after interruption.", "A proof of concept that only works during one successful response."],
])}
<h2 id="blix">Evaluate BLIX as a research workspace</h2>
<p>For someone investigating Solana tokens directly, BLIX combines discovery, wallet context, holder analysis and AI research in a ready-to-use terminal. That can reduce the amount of interface building required to inspect a trade idea. Start with the <a href="/solana-trading-terminal">terminal guide</a> and a known token rather than a synthetic feature checklist.</p>
<p>For a team serving a broad external application, the requirements can be different. A terminal's available observations do not establish a historical archive, contractual uptime, identical chain coverage or a supported replacement for another provider's schema. Confirm those needs before adopting any data source.</p>
<h2 id="reconcile">How to investigate a disagreement</h2>
<p>Suppose two wallet views show different profit. First align the currency and observation period. Then separate current holdings from completed sales and check for transfers or missing entry prices. Finally inspect the price source used for still-open positions. A different total may be an accounting difference rather than a broken feed.</p>
<p>Write down that explanation. A successful evaluation should leave you able to explain the numbers, not merely select the larger one.</p>
<h2 id="trial">A bounded evaluation</h2>
<ol><li>Choose several tokens with different histories, including one with a sparse market.</li><li>Compare the same fields and time windows.</li><li>Test a wallet with transfers as well as swaps.</li><li>Observe how stale or unavailable data is presented.</li><li>Compare the work needed to answer your actual research question.</li></ol>
<p>Current plan limits and pricing belong in a separate dated provider check. This guide does not publish an untested cheapest-provider ranking.</p>
${finish(["birdeye"])}`,
  faq: [["Does BLIX replace Birdeye's historical datasets?", "No equivalent archive or historical coverage is established here. Specify the dates and fields you need, then verify each source against that requirement."], ["Should I choose a data API or a terminal?", "Choose an API when you need to build a product around defined data responses. Evaluate a terminal when your primary task is investigating tokens and managing your own workflow."]],
});

const jupiter = page({
  path: "/compare/jupiter-terminal-alternative", crumb: "Jupiter Terminal alternative",
  title: "Jupiter Terminal Alternative: Swap Plugin or Research Terminal? | BLIX",
  description: "Jupiter's former Terminal documentation now points to Plugin. Distinguish an embedded swap interface from a full Solana research terminal before comparing alternatives.",
  h1: "Jupiter Terminal alternative: which terminal do you mean?",
  eyebrow: "Jupiter Plugin · Solana research",
  lede: "The name can refer to an embedded swap interface rather than a complete research workspace. If you are adding swaps to a website, your requirements differ from someone looking for discovery, wallet analysis and AI research.",
  related: ["/solana-trading-terminal", "/api", "/compare/dexscreener-alternative", "/compare"],
  body: `<h2 id="naming">The documentation now calls it Jupiter Plugin</h2>
<p>The former Jupiter Terminal documentation URL redirected to the ${cite("jupiter")} during this review. The guide describes an embeddable swap interface with integrated, widget and modal display options and wallet-integration settings. Follow the current documentation when maintaining an older integration.</p>
<h2 id="decision">Two different jobs</h2>
${table(["Your goal", "What to evaluate", "Where BLIX fits"], [
  ["Add swaps to an existing website", "Embedding, wallet handoff, form customization and transaction status.", "BLIX's hosted terminal is a separate product; this guide does not claim it supplies a drop-in swap widget."],
  ["Research a token before a decision", "Discovery, holder data, wallet context and evidence behind an explanation.", "Evaluate the BLIX screener, token view and AI research."],
  ["Build an agent", "Documented inputs, permissions and separation of reads from financial actions.", "Inspect the BLIX API and MCP capability list; do not assume a client can execute arbitrary swaps."],
  ["Compare an executable quote", "Exact mint pair, amount, fees, slippage and observation time.", "A chart and a paper fill are not proof of an executable quote or confirmed transaction."],
])}
<h2 id="integrators">If you maintain an embedded swap interface</h2>
<p>Inventory the inputs your surrounding app owns: selected wallet, token addresses, amount, display mode and the action after a transaction finishes. A replacement must preserve those interactions deliberately. Do not choose a research terminal merely because its name includes “terminal.”</p>
<p>Test cancellation, disconnected wallets, an unavailable route and a transaction that is submitted but not confirmed. These states determine whether your users understand what happened. Consult the current provider's documentation for implementation details and charges.</p>
<h2 id="traders">If you want a Solana research terminal</h2>
<p>BLIX combines token discovery with holder and wallet investigation, available AI research, paper practice and a separate account execution flow. Start with a question such as why a token's volume changed or whether early holders still retain supply. Inspect the supporting data rather than treating an AI opinion as an order.</p>
<p>A research product can use external market or quote services without being a replacement for those services. This guide does not imply BLIX owns Jupiter's routing or that switching interfaces removes network and liquidity constraints.</p>
<h2 id="compare-quotes">Compare like with like</h2>
<ol><li>Match input and output mint addresses and trade side.</li><li>Match amount, slippage allowance and timestamp.</li><li>Separate estimated price impact from platform and network charges.</li><li>Distinguish the displayed quote, submission response and confirmed outcome.</li></ol>
<p>No best-price or fastest-execution conclusion is established by this documentation review.</p>
${finish(["jupiter"])}`,
  faq: [["Is BLIX a drop-in replacement for Jupiter Plugin?", "No drop-in compatibility is claimed. Jupiter Plugin is an embedded swap interface; BLIX provides a research and trading workspace with its own interfaces."], ["Why does a Jupiter Terminal search lead to Plugin documentation?", "The former Terminal documentation address redirected to the current Plugin guide during this review. Use that guide to verify current integration behavior."]],
});

const pairs = page({
  path: "/compare/solana-terminal-comparison", crumb: "Solana terminal comparison",
  title: "Axiom vs Fomo, BullX, Photon & GMGN: Workflow Comparison | BLIX",
  description: "Compare Axiom, Fomo, BullX, Photon and GMGN by discovery, wallet research and current availability. A sourced decision matrix with explicit unknowns and no invented winner.",
  h1: "Axiom, Fomo, BullX, Photon and GMGN: compare the job first",
  eyebrow: "Solana terminal comparison · October 2026",
  lede: "A useful head-to-head starts with a repeated task. Discovering a launch, investigating a wallet, using a social feed and embedding a swap are different needs. This matrix focuses on those distinctions and separates documentation from performance evidence.",
  related: ["/compare", "/compare/axiom-alternative", "/compare/fomo-alternative", "/compare/bullx-alternative", "/compare/gmgn-alternative"],
  body: `<h2 id="matrix">What the reviewed sources establish</h2>
${table(["Product", "Documented focus", "Open question before choosing"], [
  ["Axiom", `${cite("axiom")} describes stage-based discovery and holder filters.`, "Do its current account and execution controls match your workflow?"],
  ["Fomo", `${cite("fomo")} emphasizes social discovery across phone and web.`, "Can you move from a social idea to the evidence you need?"],
  ["BullX Neo", "Older order docs and an indexed application notice need to be read together.", "Does the current version permit the operation you need?"],
  ["GMGN", `${cite("gmgn")} describes wallet discovery using a selected token set.`, "Does the sample and available history support the conclusion you want to draw?"],
  ["Photon", "Primary product content could not be retrieved during this review.", "Verify current controls, costs and availability directly; no unsupported feature or speed ranking is assigned."],
  ["BLIX", 'See the <a href="/solana-trading-terminal">documented Solana research workflow</a>.', "Do token context, AI research and paper practice help answer your actual question?"],
])}
<h2 id="axiom-vs-fomo">Axiom vs Fomo: discovery stage or social starting point?</h2>
<p>The practical distinction in the reviewed sources is how you begin. A stage-based board starts from token state; a social feed starts from a person's activity or idea. Try both routes on the same mint: can you identify the original event, inspect what changed since then and reach the supporting evidence without losing context?</p>
<p>The same question covers Fomo vs Axiom. Reversing the product names does not require a different test or imply a different winner.</p>
<h2 id="axiom-vs-gmgn">Axiom vs GMGN: token shortlist or wallet shortlist?</h2>
<p>Compare the sequence you repeat most. If you select a token first, evaluate the path from discovery to holders and tracked activity. If you select wallets first, evaluate how the list was generated and how it connects to the tokens under review. Neither route proves that following the resulting signal will be profitable.</p>
<h2 id="bullx-pairs">Axiom vs BullX and Fomo vs BullX: check availability first</h2>
<p>Do not compare an old BullX screenshot with a current competitor screen and call it an execution test. The indexed Neo notice says trading is disabled on that version while wallet functions remain. Confirm present availability, then compare the required discovery, order and account workflow. The <a href="/compare/bullx-alternative">BullX alternative guide</a> explains how to preserve research records during an evaluation.</p>
<h2 id="photon-pairs">Axiom vs Photon: what remains unverified</h2>
<p>Photon's product site returned a retrieval restriction in this research pass. That does not mean the product is unavailable to users or missing features. It means this page cannot substantiate a fee, custody, order-type or speed comparison. A direct authenticated product evaluation is the next step for those questions.</p>
<h2 id="scorecard">Use a decision record instead of a universal score</h2>
${table(["Test", "Record"], [
  ["Find the same mint", "Time observed, current market state and whether the displayed source is clear."],
  ["Explain one holder metric", "Definition, coverage and how missing data is presented."],
  ["Investigate one wallet", "Observation period, open positions and transfer treatment."],
  ["Review a trade intention", "Available control, stated costs and separation of quote from confirmation."],
  ["Check a failed or empty case", "Whether the interface identifies the limitation and a usable next step."],
])}
<p>Choose the tool that meets your requirements with evidence you can inspect. BLIX is one candidate for the research portion; it is not declared the winner of tests that have not been run.</p>
${finish(["axiom", "fomo", "bullx", "bullxOrders", "gmgn"])}`,
  faq: [["Which is the fastest Solana terminal?", "This review did not run an execution benchmark. A credible answer needs identical trade conditions, defined timing boundaries and failed transactions included in the results."], ["Why are several versus searches on one page?", "The shared matrix lets you compare the same requirements across products, with pair-specific sections where the decision differs. Reversing names does not create a new research question."], ["Where is Photon in the rankings?", "It is not ranked. Its primary product content could not be retrieved, so factual gaps are identified rather than filled with third-party claims."]],
});

export const COMPETITOR_GUIDES = [bullx, gmgn, dex, birdeye, jupiter, pairs];
