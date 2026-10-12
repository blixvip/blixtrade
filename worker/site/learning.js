// Educational articles: distinct research questions, not spelling-variant landing pages.
// Technical sources and local feature evidence reviewed 2026-10-10.
import { table, ext, DISCORD } from "./html.js";

const UPDATED = "2026-10-10";
const links = {
  mint: ["https://solana.com/docs/tokens/basics/create-mint", "Solana: token mint accounts"],
  accounts: ["https://solana.com/docs/tokens/basics/create-token-account", "Solana: token accounts and owners"],
  history: ["https://solana.com/docs/rpc/http/getsignaturesforaddress", "Solana: transaction history requests"],
  quote: ["https://developers.jup.ag/docs/swap/v1/get-quote", "Jupiter: quote fields and slippage"],
  route: ["https://developers.jup.ag/docs/guides/how-to-build-a-custom-swap-with-metis", "Jupiter: liquidity and route troubleshooting"],
  curve: ["https://pump.fun/docs/bonding-curve", "Pump.fun: bonding curve and graduation"],
  search: ["https://docs.x.ai/developers/tools/x-search", "xAI: X Search capabilities"],
  market: ["https://docs.coingecko.com/reference/coins-markets", "CoinGecko: market data fields"],
};
const cite = (key) => ext(...links[key]);
const join = `<div class="cta"><a class="btn primary" href="/start">Create your BLIX account</a><a class="btn" href="${DISCORD}" target="_blank" rel="noopener noreferrer">Join Discord</a></div>`;
const review = `<p class="meta">Written and reviewed by BLIX · October 10, 2026. Examples are illustrative; no live performance claim or token recommendation is made.</p>`;
const make = (p) => ({ og: "home/og.jpg", updated: UPDATED, author: "BLIX", reviewedBy: "BLIX", topic: "Research guides", ...p, body: `${review}${p.body}${join}` });

const analyze = make({
  path: "/guides/how-to-analyze-meme-coins", crumb: "Analyze memecoins",
  title: "How to Analyze Meme Coins and Pump.fun Tokens | BLIX Guide",
  description: "Analyze a Solana memecoin with a repeatable worksheet: mint identity, market activity, holders, liquidity, source evidence and a dated research decision.",
  eyebrow: "Research guide · coin analysis", h1: "How to analyze a memecoin without skipping the evidence",
  lede: "Start with the token's identity, then ask whether its activity, ownership and available liquidity support the story. This workflow produces a research record you can revisit after the chart changes.",
  related: ["/solana-memecoin-screener", "/memecoin-risk-scanner", "/guides/token-holder-distribution", "/guides/solana-memecoin-market-cap-liquidity"],
  body: `<h2 id="identity">1. Fix the identity and observation time</h2>
<p>Copy the full mint address into your notes before comparing websites or reading social posts. On Solana, a mint account identifies the token and records properties including supply, decimals and authorities. A name or ticker is not that identifier. ${cite("mint")}.</p>
<p>Record when you opened the coin and when its displayed metrics were updated. If the chart, holder table and research were captured at different times, write that down. A conclusion based on a ten-minute-old ownership snapshot should not quietly become a claim about the token's current distribution.</p>
<h2 id="activity">2. Describe activity before judging it</h2>
<p>Use the coin's recent buys, sells, volume and participants to describe what happened. Compare equivalent time windows: a five-minute volume figure and a one-hour figure do not answer the same question. Look beyond the largest candle and ask whether activity continued after the initial move.</p>
<p>For a hypothetical candidate, “volume increased while the number of observed traders stayed flat” is a useful observation. “Everyone is buying” goes beyond that evidence. Record both the observation and a question to investigate, such as whether a small set of addresses produced most of the turnover.</p>
<h2 id="ownership">3. Read the holder table with its coverage</h2>
<p>Inspect the largest positions, the creator's allocation and any linked-wallet information. BLIX can display data from a current snapshot or from observed trades; the source and completeness determine what the numbers support. A partial ledger can still be useful, but an unavailable early-buyer percentage is not zero.</p>
<p>Open the <a href="/guides/token-holder-distribution">holder-distribution guide</a> when several large addresses look connected. Keep a timing pattern, a transfer relationship and verified common ownership as separate claims. The first two can prompt investigation without proving the third.</p>
<h2 id="liquidity">4. Inspect an exit at the relevant size</h2>
<p>A chart shows a price observation. A quote describes a proposed exchange for a particular amount. Jupiter's quote response distinguishes expected output, the minimum output after the chosen slippage tolerance, price impact and route. ${cite("quote")}.</p>
<p>For analysis, record the input amount, quote time and whether an exit route was available. Do not present a small quote as proof that a much larger position could exit at the same effective price. If no usable route exists, keep that uncertainty visible beside the nominal position value.</p>
<h2 id="story">5. Trace the story back to a source</h2>
<p>Open the post, website or announcement behind the research summary. Check whether it names this mint and whether it predates the observed move. Distinguish the source's statement from the AI's interpretation. A project mentioning a public figure does not establish an affiliation with that person.</p>
<p>BLIX research may use different providers and evidence sets. Read the actual provider and source list when available. An eloquent explanation is easier to assess when it includes a falsifiable claim, such as a specific event date, rather than an untestable promise of momentum.</p>
<h2 id="worksheet">6. Leave a record someone else can check</h2>
${table(["Record", "Example entry"], [
  ["Identity and time", "Full mint; observation timestamp; metric freshness."],
  ["Observed activity", "Volume and participants over the same interval."],
  ["Ownership questions", "Large positions, source coverage and unresolved wallet links."],
  ["Exit evidence", "Quote amount and time, route availability and price impact."],
  ["Decision to revisit", "The specific evidence that would change the assessment."],
])}
<p>When revisiting the record, preserve the original wording and add an update. That makes it possible to distinguish a useful early observation from an explanation written after the outcome. Keep unsuccessful and inconclusive candidates in the review rather than retaining only attractive charts.</p>`,
  faq: [["Can one safety score replace this process?", "No. A score compresses assumptions and inputs. Inspect the underlying ownership, liquidity, freshness and source evidence."], ["Is this workflow different for pump.fun coins?", "The same research questions apply, but note the trading stage: a bonding-curve token and a migrated pool have different execution contexts. See the bonding-curve guide."]],
});

const smart = make({
  path: "/guides/how-to-find-smart-money-wallets", crumb: "Research smart money",
  title: "How to Find and Track Solana Smart Money Wallets | BLIX",
  description: "Research Solana wallets through repeated activity, closed outcomes, history coverage and linked addresses. Learn why a smart-money label is only a starting point.",
  eyebrow: "Research guide · wallet selection", h1: "How to research a Solana smart-money wallet",
  lede: "A wallet worth following needs more evidence than one large gain. Investigate how it entered, what it actually sold and how much of its history you can see before interpreting its next transaction.",
  related: ["/solana-wallet-tracker", "/solana-pnl-tracker", "/guides/token-holder-distribution", "/memecoin-alerts"],
  body: `<h2 id="candidate">Start with a specific candidate</h2>
<p>A candidate can come from a token's early buyers, its large holders or an observed trader ranking. Save the public address and the reason it attracted your attention. Avoid attaching a person's identity to the address unless you have evidence separate from a display name or a copied profile picture.</p>
<p>BLIX's wallet research uses observed appearances across multiple coins, including early buyers and holders of tokens that subsequently moved. That helps surface addresses to examine. It is not an independent certification of skill, and it does not establish the wallet's complete return across every asset it has touched.</p>
<h2 id="history">Establish the history you actually have</h2>
<p>Write down the earliest and latest transactions in the record and any tracking gaps. Solana's transaction-signature endpoint returns a newest-first list with pagination controls and fields such as transaction error and confirmation status. A first page is therefore not automatically a complete wallet history. ${cite("history")}.</p>
<p>In BLIX, new-wallet backfills and ongoing tracking depend on the running service and RPC access. A sale may be observed even when the earlier purchase was not. The wallet accounting can leave the realized result unknown when its entry cost is missing. Treat that as missing evidence rather than a free acquisition.</p>
<h2 id="outcomes">Separate closed results from open marks</h2>
<p>Review the trades behind a return figure. Did the wallet sell, partly sell or continue holding? Was the apparent gain mainly an open position whose quote later disappeared? Use the <a href="/solana-pnl-tracker">PnL definitions</a> to keep realized outcomes, open value and sellable estimates separate.</p>
<p>Consider an illustrative comparison: wallet A has one spectacular open position and little earlier history; wallet B has many observed closed trades with both gains and losses. These records support different questions. The headline number alone does not justify ranking A above B, because the outcome and coverage are different.</p>
<h2 id="independence">Check whether addresses represent separate evidence</h2>
<p>Repeated synchronized purchases, transfers or a shared fee payer can indicate a relationship worth examining. BLIX groups some correlated wallet activity so several related addresses are not automatically counted as separate opinions. Its grouping logic also accounts for a known shared Fomo fee payer rather than treating all users of that service as one trader.</p>
<p>A relationship heuristic does not prove common ownership. The useful research question is narrower: would counting these addresses independently exaggerate the evidence behind a token? Read the reason for a link and examine the underlying transactions before drawing a stronger conclusion.</p>
<h2 id="watchlist">Create a watchlist with a review rule</h2>
<ol><li>Save the candidate address and the observation that earned it a place.</li><li>Record history coverage and any unknown entry costs.</li><li>Review multiple closed positions, including the largest observed loss.</li><li>Inspect related-address evidence and recurring tokens.</li><li>Follow future activity as a research input, then reassess after a defined observation period.</li></ol>
<p>This is an observation procedure, not an automatic-copy instruction. A notification can arrive after the original trader's fill, and your available route or price may differ. The transaction that made the wallet interesting does not establish what its next transaction will do.</p>
<h2 id="notes">Keep reasons for removing a wallet</h2>
<p>When an address no longer fits the research criteria, preserve the reason: insufficient coverage, repeated unavailable exits, dependence on one unusual event or misleading attribution. Otherwise the remaining watchlist can look stronger simply because weak candidates disappeared from the record. Ask the same questions of new and established candidates.</p>`,
  faq: [["Does 'smart money' mean the wallet has insider information?", "No. Here it describes a research candidate identified from observed trading. It is not a claim about private knowledge or verified identity."], ["Should a large wallet always outrank a small one?", "Size and research quality answer different questions. Compare coverage, repeated behavior, closed outcomes and the liquidity context."]],
});

const holders = make({
  path: "/guides/token-holder-distribution", crumb: "Holder distribution",
  title: "Token Holder Analysis: Distribution, Bundles & Wallet Links | BLIX",
  description: "Read Solana token holder concentration, creator allocation, bundle labels and wallet links. Understand account ownership, partial ledgers and percentage changes.",
  eyebrow: "Research guide · token distribution", h1: "How to read token distribution and linked wallets",
  lede: "A holder table measures balances under a particular definition. Before judging a token's distribution, identify what is counted, when it was measured and how related addresses are represented.",
  related: ["/memecoin-risk-scanner", "/solana-wallet-tracker", "/guides/how-to-analyze-meme-coins"],
  body: `<h2 id="unit">Know whether you are counting accounts or owners</h2>
<p>A Solana token account stores units of one mint for a token-account owner. The owner authority and the program that owns the account are different concepts. An associated token account is a standard address derived for a wallet, mint and token program. ${cite("accounts")}.</p>
<p>Consequently, a raw list of token accounts and an owner-aggregated holder list need not be the same table. Check the source's definition before comparing counts. Neither a token-account count nor an address count establishes the number of independent people holding the token.</p>
<h2 id="concentration">Read concentration as a measured share</h2>
<p>For a top-ten percentage, ask which supply denominator is used, whether related accounts are aggregated and whether identifiable pool or program accounts are treated separately. A change in the displayed percentage may reflect changing balances, a changed denominator or a different data source.</p>
<p>Here is an illustrative calculation: three addresses holding 4% each account for 12% together. If there is evidence that they move as a group, record both the individual shares and their combined share. Do not rewrite the evidence as one verified owner's position unless ownership has actually been established.</p>
<p>The same discipline applies to creator holdings. A current small balance does not by itself explain where earlier tokens went. Inspect available sale or transfer history and keep any unobserved period explicit. A transfer is an event to interpret; it is not automatically a sale.</p>
<h2 id="early">Understand what bundle and sniper labels mean</h2>
<p>In BLIX's observed-trade ledger, early-buyer tags use the timing of first purchases relative to the observed launch. The code distinguishes same-launch-block activity and purchases in its early-slot window. These are implementation-defined classifications; they are not proof that an address is malicious, privately coordinated or owned by the creator.</p>
<p>The ledger tracks whether it observed the coin from its early trading and whether the book is partial. If observation began late, the service cannot reconstruct every early relationship from later balances alone. A current chain snapshot can improve balance information without proving when each owner originally entered.</p>
<h2 id="links">Interpret the reason behind a map edge</h2>
<p>BLIX's holder map can distinguish transfers, common funding and early-block timing. Open the relationship details when available instead of judging by bubble color alone. A shared source of funds may be operational infrastructure; coincident timing may arise from separate bots reacting to the same event.</p>
${table(["Observation", "Supportable note", "Claim needing more evidence"], [
  ["Same launch block", "These observed purchases share a block.", "The wallets belong to one insider."],
  ["Tokens transferred", "A transfer links these addresses.", "Both addresses are controlled by the sender."],
  ["Common funder", "The observed funding source matches.", "Every funded wallet is the same person."],
  ["Large combined share", "This identified group holds this measured share.", "The group will sell together."],
])}
<h2 id="compare">Compare snapshots without losing the assumptions</h2>
<p>Save the time, source, supply basis, completeness and largest positions. On the next review, compare the same definitions before attributing a change to accumulation or distribution. If a provider changes, mark that boundary rather than drawing a continuous trend through incompatible measurements.</p>
<p>Finish by connecting distribution to the rest of the coin research. Concentration is one question; current liquidity, token authorities, activity and available exit routes are others. A dispersed holder table cannot establish a safe exit, and a concentrated table cannot predict the exact timing of a sale.</p>`,
  faq: [["Does a low top-ten percentage prove a token is safe?", "No. It is one distribution measure with source and ownership limitations. Related addresses and execution conditions still need investigation."], ["Why are bundle statistics sometimes unavailable?", "The required early-trading evidence may be missing. A later balance snapshot does not establish the timing of the first purchases."], ["Can a holder map identify anonymous people?", "The map displays observed address relationships. It does not by itself establish real-world identities."]],
});

const models = make({
  path: "/guides/compare-ai-crypto-research", crumb: "Compare AI research",
  title: "Compare AI Crypto Research: Grok, Claude & Evidence Quality | BLIX",
  description: "Evaluate AI memecoin research with the same evidence, timestamps and scoring rubric. Understand BLIX provider fallbacks without invented model performance rankings.",
  eyebrow: "Research guide · AI evaluation", h1: "How to compare AI crypto research fairly",
  lede: "Compare a model's evidence handling before comparing its confidence. A useful evaluation holds the task and information constant, records which provider answered, and preserves unsuccessful or incomplete responses.",
  related: ["/ai-memecoin-picks", "/ai-memecoin-trading", "/memecoin-social-sentiment", "/memecoin-paper-trading"],
  body: `<h2 id="task">Choose one task before choosing a winner</h2>
<p>Explaining a holder table, checking a claimed catalyst and forecasting a price move are different tasks. Decide which one you want to assess. A clear explanation can be useful even when it does not predict returns; a lucky price call does not establish that the explanation was well grounded.</p>
<p>Use a small, repeatable prompt. For example: “Using only this dated evidence packet, identify the coin, summarize the observed activity, list unresolved questions and cite the source for each factual claim.” Decide the review criteria before reading the responses.</p>
<h2 id="provider">Record the provider that actually answered</h2>
<p>BLIX's research implementation reports configured and actual providers for its fast and deep lanes. Grok and Claude are present, and Gemini can be available as a fallback when configured and ready. Availability depends on the service's credentials, quotas and running configuration. A configured label is not proof that the named provider produced a particular read.</p>
<p>Search capability also matters. xAI documents an X Search tool that can retrieve posts, users and threads and return citations. ${cite("search")}. That general capability does not establish that every Grok response in BLIX searched X. In BLIX, some quick calls explicitly run without search, while Claude research uses material gathered by the service.</p>
<h2 id="packet">Use the same evidence packet</h2>
<p>Capture the mint, observation time, relevant metrics, holder source, source links and their timestamps. Keep unavailable fields marked unavailable. If one model searches for newer material while another receives only the saved packet, describe the exercise as a comparison of workflows, not a controlled comparison of reasoning on identical information.</p>
<p>Preserve the original responses, prompt, provider and time. If a provider fails or truncates an answer, record that outcome. Re-running only the weaker-looking answers until they improve changes the experiment and hides reliability information from the final comparison.</p>
<h2 id="rubric">Score claims against evidence</h2>
${table(["Criterion", "Question for the reviewer"], [
  ["Identity", "Does the answer stay on the supplied mint rather than a similarly named coin?"],
  ["Source accuracy", "Does each linked source support the specific claim beside it?"],
  ["Time awareness", "Does the answer distinguish earlier evidence from later developments?"],
  ["Uncertainty", "Does it preserve missing data and meaningful contradictions?"],
  ["Useful reasoning", "Does it explain how an observation affects the stated research question?"],
])}
<p>A simple review scale is supported, unsupported or unverifiable for each factual claim. Keep those categories separate from style preferences. An answer with more citations is not automatically better if the citations name the wrong token or merely repeat promotional language.</p>
<h2 id="outcomes">Keep research quality and trade outcomes separate</h2>
<p>If you also test a trading rule, specify the observation window, entry rule, exit rule and treatment of failed exits in advance. Record every candidate in that experiment. Compare closed outcomes under that rule instead of selecting each coin's best later price.</p>
<p>Paper trading is useful for recording an idea consistently, but it does not reproduce every live execution constraint. Report the experiment as paper results and preserve provider outages, stale quotes and missing observations. Those limits belong in the result rather than in a footnote removed from the headline.</p>
<h2 id="claim">What a completed comparison can claim</h2>
<p>A defensible conclusion describes the task, sample and evidence: for example, one provider produced fewer unsupported factual claims in your recorded packet review. It should not become “the best AI for all crypto trading.” This guide publishes an evaluation method, not a performance leaderboard or fabricated coin picks from unsupported models.</p>`,
  faq: [["Which AI model is best for memecoin trading?", "This guide does not establish a universal winner. Compare the task, actual provider, evidence access and recorded outcomes using a consistent method."], ["Does BLIX support every model named in SEO searches?", "No. Model names in search queries do not establish a product integration. Verify actual provider status and supported configuration."], ["Is a search-enabled answer automatically more accurate?", "No. Additional sources must still be checked for relevance, identity and support for the claimed facts."]],
});

const metrics = make({
  path: "/guides/solana-memecoin-market-cap-liquidity", crumb: "Market cap and liquidity",
  title: "Memecoin Market Cap vs Liquidity, Volume & Exit Value | BLIX",
  description: "Understand Solana memecoin market cap, diluted valuation, volume, liquidity, price impact and slippage with worked examples and a practical comparison worksheet.",
  eyebrow: "Research guide · market metrics", h1: "Market cap, volume and liquidity answer different questions",
  lede: "A token can display a large valuation while offering a poor exit for a modest position. Read the definition, supply basis, time window and quote size before comparing the numbers on two memecoin pages.",
  related: ["/solana-memecoin-screener", "/solana-pnl-tracker", "/guides/how-to-analyze-meme-coins", "/guides/pumpfun-bonding-curve"],
  body: `<h2 id="valuation">Market cap is a valuation calculation</h2>
<p>Price multiplied by the supply used in the calculation produces an implied valuation. The supply basis matters: circulating-supply market cap and a total-supply or fully diluted figure can differ. Data providers expose these as distinct fields; CoinGecko's market response, for example, separates market cap, fully diluted valuation and supply fields. ${cite("market")}.</p>
<p>Suppose a hypothetical token has one billion units in the chosen supply basis and an observed price of $0.001. Multiplying them gives a $1 million implied valuation. That arithmetic does not say that $1 million entered the market or that holders could collectively withdraw $1 million. It extends a price observation across the selected supply.</p>
<p>When two sites disagree, compare their supply assumptions, price source and update time. Do not assume the higher number is more current or the lower number more conservative. First identify which quantity each site is reporting.</p>
<h2 id="volume">Volume measures turnover within a window</h2>
<p>Volume records trading activity under a source's chosen definition and interval. Repeated exchanges can generate turnover without increasing the amount of capital available to support an exit. For research, compare like intervals and note which venues the source covers.</p>
<p>An illustrative token with $100,000 of daily volume and another with $20,000 in five minutes cannot be ranked sensibly from those figures alone. Ask for matching intervals, then inspect the distribution of activity across time and participants. A brief burst and sustained activity are different observations even when their total turnover matches.</p>
<h2 id="liquidity">Liquidity concerns the available trading route</h2>
<p>A displayed pool-liquidity figure is useful context, but a route and an amount are needed to investigate an actual exchange. Jupiter documents high price impact as a possible result of low liquidity or a trade large relative to a pool, and no-route errors when no liquidity path is found. ${cite("route")}.</p>
<p>That is why a small successful quote should not be extrapolated linearly to a large position. Record the proposed input, quoted output, time and route. If you compare sizes, treat each quote as its own observation rather than presenting the smallest quote's effective price as universal.</p>
<h2 id="slippage">Price impact and slippage are separate</h2>
<p>Price impact describes the trade's effect on the quoted exchange. Slippage tolerance sets how much deterioration the transaction will accept under its execution rules. Jupiter exposes the quoted output separately from the minimum output threshold after slippage. ${cite("quote")}.</p>
<p>For a purely illustrative exact-input quote returning 1,000 units, a 1% minimum-output allowance corresponds to 990 units before any relevant rounding rules. This is arithmetic, not a recommended tolerance. Increasing an allowance does not create liquidity, repair a missing route or guarantee confirmation.</p>
<h2 id="worksheet">Use a consistent comparison worksheet</h2>
${table(["Metric", "Record beside the number"], [
  ["Valuation", "Price source, supply basis and timestamp."],
  ["Volume", "Time interval, included venues and data coverage."],
  ["Liquidity", "Pool or route context and measurement time."],
  ["Quote", "Input size, output, impact, threshold and route status."],
  ["Position value", "Whether it is a chart mark, sellable estimate or confirmed sale."],
])}
<p>BLIX separates several of these views across the coin page, quotes and wallet accounting. Check the figure's source and freshness instead of assuming every field refreshed together. When a dependency is stale or unavailable, an unknown value is more informative than a precise-looking number carried forward without explanation.</p>
<p>Use this worksheet again when revisiting the token. A change in the valuation alone does not establish an improved exit; compare the rest of the evidence under the same definitions.</p>`,
  faq: [["Is market cap the amount invested in a coin?", "No. It is an implied valuation calculated from a price and supply basis, not a ledger of deposits."], ["Does high volume mean high liquidity?", "No. Turnover and the depth available for a particular exchange are different measurements."], ["Does a larger slippage allowance fix an unavailable exit?", "No. An allowance is an execution constraint; it does not supply liquidity or establish a route."]],
});

const curve = make({
  path: "/guides/pumpfun-bonding-curve", crumb: "Pump.fun bonding curve",
  title: "Pump.fun Bonding Curve, Graduation & Migration Explained | BLIX",
  description: "Understand pump.fun token stages: bonding-curve activity, progress, graduation and PumpSwap trading. Learn which observations to check during migration.",
  eyebrow: "Research guide · pump.fun stages", h1: "Read a pump.fun coin's trading stage before its chart",
  lede: "A new token's curve progress, a graduation event and a working post-migration market are related observations. Keep them separate when researching a coin near the transition.",
  related: ["/pump-fun-tracker", "/create-memecoin", "/guides/solana-memecoin-market-cap-liquidity", "/memecoin-risk-scanner"],
  body: `<h2 id="curve">What the bonding curve does</h2>
<p>Pump.fun describes its initial market as a constant-product pricing curve using virtual reserves. Trades change the reserves and therefore the price; larger trades can produce a different effective fill from smaller trades. On graduation, the market moves to PumpSwap. ${cite("curve")}.</p>
<p>For research, the relevant distinction is the venue and state of the coin at the time of observation. A chart captured while the curve is active and a quote requested after migration may refer to different trading contexts. Record the stage alongside the timestamp rather than assuming the chart alone explains an execution result.</p>
<h2 id="progress">What curve progress can tell you</h2>
<p>In BLIX's pump.fun feed, progress is derived from the observed reserve state relative to the curve's initial token allocation. It is a stage indicator used in the Pulse workflow. It is not an estimated probability that the token will graduate, an expected return or an estimate of how many minutes remain.</p>
<p>Consider a hypothetical token showing 90% progress. That observation describes the current measured state under the feed's calculation. It does not establish that another 10% of elapsed time will finish the process, that a particular future trade will arrive, or that the token is more attractive than a less advanced one.</p>
<h2 id="transition">Separate completion, migration and observed pool activity</h2>
<p>BLIX's market service distinguishes a nearly completed curve from subsequent pool activity and can temporarily block an account trade when it detects migration. This is a product behavior based on the observed feed. It should not be used to infer a universal migration duration or a guaranteed time when your next transaction will succeed.</p>
<p>When investigating a transition, check the most recent stage update, the transaction or market reference and whether the quote belongs to the active venue. If one source still shows the curve while another shows a pool, retain both timestamps. A delayed feed update is a different problem from a transaction that was submitted and failed.</p>
<h2 id="workflow">A practical review around graduation</h2>
<ol><li>Confirm the mint and record the latest stage and observation time.</li><li>Check the coin's recent trading activity rather than only its progress percentage.</li><li>Review holder concentration and creator activity using their source and completeness indicators.</li><li>If the service reports migration, wait for refreshed state before interpreting an old quote as current.</li><li>Inspect the available route and price impact after the pool is active.</li><li>Keep submission status and confirmed outcome separate in the record.</li></ol>
<p>This sequence is for verifying state. It does not prescribe buying before graduation, selling afterward or repeatedly submitting transactions during a transition. The appropriate next action depends on fresh execution information and the decision you intended to make.</p>
<h2 id="after">Graduation does not settle the research questions</h2>
<p>A different venue does not answer who controls the supply, whether the story is credible or how much an intended exit would return. Revisit the same holder, liquidity and source questions after migration. An older research report can remain useful background while no longer describing the current market.</p>
<p>Keep track of which claims concern the protocol and which concern the token. A documented graduation mechanism is a statement about the platform. A claim that a particular coin will maintain demand requires evidence about that coin. One does not follow automatically from the other.</p>
<h2 id="fees">Check current terms rather than fixed tutorial numbers</h2>
<p>Launch costs, fees and platform behavior can change. Use the current creation or execution interface and the platform's documentation for the operation you intend to perform. This guide intentionally does not turn a historical dollar threshold, fee or reserve constant into a promise about every future launch.</p>`,
  faq: [["Does 90% curve progress mean a 90% chance of graduation?", "No. Progress is a measurement of the curve state under the feed's calculation, not a forecast probability."], ["Does graduation guarantee a successful trade?", "No. Check the active venue, fresh quote, route and transaction result."], ["Why can BLIX temporarily block a trade during migration?", "The service can detect a transition between the completed curve and observed pool trading. Its guard avoids treating that transient state as an ordinary available route."]],
});

export const LEARNING_PAGES = Object.fromEntries([analyze, smart, holders, models, metrics, curve].map((p) => [p.path, p]));
