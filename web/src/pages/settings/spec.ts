// What every radar setting is called on the Settings page, what it does, its unit and its control. The
// meanings come from server/settings.js. A setting missing here still shows, under "Other", with a label
// made from its key.
export type Unit = "$" | "%" | "SOL" | "min" | "h" | "x" | "/h" | "$/day" | "MB" | "" ;
export interface Spec {
  label: string; hint?: string; unit?: Unit;
  kind?: "select" | "time" | "chips" | "sizes" | "model";
  options?: [value: string, label: string][];
}
export interface Group { id: string; title: string; blurb?: string; icon?: string; parts: { title?: string; keys: string[] }[] }

const GROK_MODELS = ["grok-4.7", "grok-4.7-build-fast", "grok-4-fast-non-reasoning", "grok-4-fast-reasoning"];
export const MODEL_SUGGEST: Record<string, string[]> = {
  grokModel: GROK_MODELS, deepModel: [...GROK_MODELS, "claude-sonnet-5-5", "claude-opus-5-5"], narrativeModel: GROK_MODELS, quickGrokModel: GROK_MODELS, triageGrokModel: GROK_MODELS,
  triageModel: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "llama-3.3-70b-versatile"], fastModel: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"],
};

export const NOTIFY: [string, string][] = [
  ["launch", "New launches"], ["graduated", "Bonded"], ["momentum", "Momentum"], ["volume", "Volume spikes"], ["mcap-1000000", "$1M market cap"],
  ["mcap-5000000", "$5M market cap"], ["dump", "Dumps"], ["brief", "AI briefs"], ["wallet", "Followed wallet buys"], ["smart", "Smart wallet buys"],
  ["dev-sold", "Dev sold"], ["rugged", "Rugged"], ["liq-pulled", "Liquidity pulled"], ["research", "Research finished"], ["fomo", "Fomo traders"],
  ["buy", "AI buy calls"], ["pick", "Picks"], ["narrative", "Narratives"],
];

export const SPEC: Record<string, Spec> = {
  // paper desk
  paperStartSol: { label: "Paper wallet starts with", hint: "Fake SOL the paper wallet gets at the start and after a reset", unit: "SOL" },
  quickSizes: { label: "Quick-buy sizes", hint: "The one-click buy amounts on every Pulse row", kind: "sizes", unit: "SOL" },
  paperTake: { label: "Take profit at", hint: "Sell everything at this multiple of the entry. 0 = off", unit: "x" },
  paperStop: { label: "Stop loss", hint: "Sell everything this far below the entry. 0 = off", unit: "%" },
  paperTrail: { label: "Trailing stop", hint: "Once above the entry, sell everything this far below its high. 0 = off", unit: "%" },
  // tracking
  nurseryMinMcap: { label: "Track launches that reach", hint: "A pump.fun launch must reach this market cap within about 4 minutes to be tracked", unit: "$" },
  nurseryMinVol5m: { label: "…or 5-minute volume of", hint: "Or trade this much in its first 5 minutes", unit: "$" },
  maxTracked: { label: "Most coins tracked at once", hint: "The weakest drop off past this" },
  minSafety: { label: "Minimum safety score", hint: "RugCheck-based, 0–100, and no danger flags. Coins below get no signals" },
  launchScore: { label: "Launch signal score", hint: "A new coin needs this score (0–100) for a launch alert" },
  momentumScore: { label: "Momentum signal score", hint: "Score (0–100) for a momentum alert" },
  spikeMinVol: { label: "Volume spike needs", hint: "Smallest 5-minute volume that counts as a spike", unit: "$" },
  minExitLiq: { label: "Sellable pool at least", hint: "A pool holding less is unsellable: no signals, and its outcomes count as a total loss", unit: "$" },
  // alerts
  notifyKinds: { label: "Send alerts for", hint: "Which signals go to Discord and Telegram", kind: "chips" },
  telegramChat: { label: "Telegram chat ID", hint: "Where Telegram alerts go. Needs the bot token under Keys" },
  alertCooldownMin: { label: "One alert per coin every", hint: "Extra alerts in that window are grouped into the next one", unit: "min" },
  quietStart: { label: "Quiet hours from", hint: "No pushes between these times. Leave both blank for none", kind: "time" },
  quietEnd: { label: "Quiet hours until", kind: "time" },
  pushUnscreened: { label: "Push unscreened wallet buys", hint: "Also alert wallet buys of coins that failed, or have not had, the safety check" },
  aiBriefs: { label: "AI market briefs", hint: "A written summary of what is moving" },
  briefEveryMin: { label: "Brief every", unit: "min" },
  // wallets
  autoFollowSmart: { label: "Auto-follow smart wallets", hint: "Watch the best wallets Blix discovers" },
  maxSmartWallets: { label: "Most smart wallets followed" },
  walletMinSol: { label: "Smallest wallet buy worth an alert", unit: "SOL" },
  fomoAutoFollow: { label: "Auto-follow Fomo traders", hint: "Follow the best Fomo traders seen on-chain (free)" },
  fomoFollowTop: { label: "Fomo traders followed" },
  // picks
  pickMinTraction: { label: "Minimum traction", hint: "Live demand score, 0–100" },
  pickMinPwin: { label: "Minimum win chance", hint: "AI's chance of 2x before a 40% fall. A buy call passes regardless", unit: "%" },
  pickMinMcap: { label: "Smallest market cap", hint: "Smaller coins almost never went anywhere", unit: "$" },
  pickMaxMcap: { label: "Largest market cap", hint: "Above this the early move is over", unit: "$" },
  pickMinScore: { label: "Fallback score", hint: "Used only when a read came back without a trade call" },
  aiInGate: { label: "AI call decides picks", hint: "Off: the AI's buy/avoid is shown and scored but doesn't pick (its buys lost, its avoids won)" },
  buyConviction: { label: "Buy call needs conviction", hint: "0–100. The self-review may tune this" },
  earlyMinTraders: { label: "Early coin needs traders", hint: "Different wallets that have traded a coin still in its first minutes" },
  earlyMinPwin: { label: "Early coin win chance", hint: "A buy call passes regardless", unit: "%" },
  pickTakeProfit: { label: "Take profit at", hint: "Sell part of a pick at this multiple", unit: "x" },
  pickSellPct: { label: "Sell this much there", unit: "%" },
  pickTrailPct: { label: "Then trail by", hint: "Sell the rest this far below its high", unit: "%" },
  pickStopPct: { label: "Stop loss", hint: "Before any profit, sell everything this far below the pick price", unit: "%" },
  pickMaxHours: { label: "Sell what's left after", unit: "h" },
  entryWaitMin: { label: "Wait for a clean entry up to", hint: "Give up on a coin that offers none", unit: "min" },
  entryChasePct: { label: "Don't chase above", hint: "Skip while it's this far above the rated price", unit: "%" },
  entryCancelPct: { label: "Drop it if it falls", hint: "This far below the rated price while waiting", unit: "%" },
  entryFallPct: { label: "\"Falling\" means down", hint: "In the last 15 seconds: wait for it to stop", unit: "%" },
  entryOffHighPct: { label: "Skip coins this far off their high", unit: "%" },
  guardLosses: { label: "Pause after losses in a row", hint: "0 = off" },
  guardPauseMin: { label: "Pause for", unit: "min" },
  guardDayLoss: { label: "Stop for the day after losing", hint: "At $100 a pick. 0 = off", unit: "$" },
  // AI
  researchAuto: { label: "Research automatically", hint: "Coins about to bond and just bonded" },
  researchPerHour: { label: "Research runs per hour", hint: "Each uses your Claude subscription", unit: "/h" },
  queueMax: { label: "Most coins waiting for a read", hint: "The weakest and oldest are dropped past this" },
  quickReads: { label: "Quick first reads", hint: "A call in a few seconds; the full report follows for coins worth it" },
  quickGrok: { label: "Quick reads on Grok", hint: "Grok's fastest model while its daily share lasts, then Claude Haiku" },
  quickGrokModel: { label: "Quick read model", kind: "model" },
  fastProvider: { label: "Fast reads by", kind: "select", options: [["grok", "Grok (this PC's login, searches X)"], ["groq", "Groq (free key)"], ["claude", "Claude Haiku"]] },
  fastModel: { label: "Groq model", hint: "Used when fast reads are on Groq", kind: "model" },
  fastPerHour: { label: "Fast reads per hour", unit: "/h" },
  claudeFast: { label: "Claude backs up fast reads", hint: "When Grok and Groq are both unavailable" },
  triageOn: { label: "Triage every launch", hint: "Instant rules plus a fast model rank each new coin" },
  triageProvider: { label: "Triage by", kind: "select", options: [["auto", "Auto (Groq if keyed, else Grok)"], ["groq", "Groq"], ["grok", "Grok"]] },
  triageModel: { label: "Triage Groq model", kind: "model" },
  triageGrokModel: { label: "Triage Grok model", kind: "model" },
  triageEscalate: { label: "Send to research at score", hint: "Triage score that gets a coin a real read" },
  earlyAuto: { label: "Early watch before the AI answers", hint: "The launch model may put its very strongest coins on the entry watch" },
  deepMinScore: { label: "Deep read at grade", hint: "Fast grades at or above this get a deep read (about the top 10%)" },
  deepProvider: { label: "Deep reads by", kind: "select", options: [["grok", "Grok (deep X/web search, buy calls)"], ["claude", "Claude"]] },
  deepModel: { label: "Deep read model", kind: "model" },
  deepSearches: { label: "Searches per deep read" },
  deepPerHour: { label: "Deep reads per hour", unit: "/h" },
  grokModel: { label: "Grok model", kind: "model" },
  grokSearch: { label: "Grok searches X and the web", hint: "For every coin it reads" },
  grokDailyBudget: { label: "Grok daily budget", hint: "Subscription credit per day. 0 = no limit", unit: "$/day" },
  scoutEveryMin: { label: "Narrative scout every", hint: "Grok searches X and the web for narratives starting to run", unit: "min" },
  scoutSearches: { label: "Searches per scout" },
  scoutEffort: { label: "Scout effort", kind: "select", options: [["low", "Low (~3 searches, 8¢)"], ["medium", "Medium (~7 searches, 20¢)"]] },
  narrativeModel: { label: "Narrative model", hint: "Names a burst of same-named launches (about 7 s and 7¢ each)", kind: "model" },
  narrativeCardsPerHour: { label: "Narrative cards per hour", unit: "/h" },
  reviewMinNew: { label: "Self-review after", hint: "This many newly graded coins have played out (6 h+)" },
  // keys
  discordWebhook: { label: "Discord webhook", hint: "Alerts go to this channel" },
  telegramToken: { label: "Telegram bot token" },
  groqKey: { label: "Groq key", hint: "Free at console.groq.com/keys; grades every candidate in about a second" },
  rpcUrl: { label: "Solana RPC URL", hint: "Blank = free public RPC (slow). A free Helius URL is about 10× faster" },
  rpcWsUrl: { label: "Solana websocket URL", hint: "Blank = made from the RPC URL" },
  jupiterKey: { label: "Jupiter key", hint: "Optional: raises the quote and price allowance" },
  chartWsUrl: { label: "Helius chart key (websocket URL)", hint: "wss://mainnet.helius-rpc.com/?api-key=… — open charts, holders and per-coin reads run on it" },
  chartWsUrl2: { label: "Second Helius key", hint: "Another project's wss URL. Charts move to it when the first key has used its day or its month" },
  heliusProjectId2: { label: "Second Helius project ID" },
  // data and servers
  marketFeeds: { label: "Stream market feeds", hint: "Off on a spare copy of Blix so it doesn't use the home connection while the real one runs on the server" },
  chartDailyMB: { label: "Chart stream budget", hint: "Live chart data per day. The free Helius plan allows about 1,650 MB", unit: "MB" },
  fomoRelayTo: { label: "Send Fomo sign-in to", hint: "The Blix server this copy hands its Fomo login to, e.g. https://origin.blixvip.com. Blank = none" },
  grokOff: { label: "Never use Grok", hint: "Keeps the Grok subscription untouched, even when signed in here" },
  geminiPerDay: { label: "Gemini calls per day", hint: "Free-tier cap; Gemini backs up fast reads when Groq is unavailable" },
  runningAi: { label: "Group narratives with Claude", hint: "Off: Blix groups them by its own themes" },
  heliusProjectId: { label: "Helius project ID", hint: "From dashboard.helius.dev (project settings, or the projectId in the address bar). Health then shows the month's credits used and when they reset" },
};

export const GROUPS: Group[] = [
  { id: "trading", icon: "bolt", title: "Quick buy and exits", blurb: "The buy buttons, and the exit rule each new paper position starts with", parts: [{ keys: ["quickSizes", "paperStartSol", "paperTake", "paperStop", "paperTrail"] }] },
  { id: "tracking", icon: "crosshair", title: "What gets tracked", blurb: "Which launches Blix follows, and when they count as a signal", parts: [{ keys: ["nurseryMinMcap", "nurseryMinVol5m", "maxTracked", "minSafety", "minExitLiq"] }, { title: "Signals", keys: ["launchScore", "momentumScore", "spikeMinVol"] }] },
  { id: "alerts", icon: "send", title: "Alerts", blurb: "What gets pushed to Discord and Telegram, and when", parts: [{ keys: ["notifyKinds", "telegramChat", "alertCooldownMin", "quietStart", "quietEnd", "pushUnscreened"] }, { title: "Briefs", keys: ["aiBriefs", "briefEveryMin"] }] },
  { id: "wallets", icon: "wallets", title: "Wallets", blurb: "Which wallets Blix follows for you", parts: [{ keys: ["autoFollowSmart", "maxSmartWallets", "walletMinSol", "fomoAutoFollow", "fomoFollowTop"] }] },
  { id: "picks", icon: "picks", title: "Picks", blurb: "When Blix calls a coin a pick, how it enters, and how it exits", parts: [
    { title: "Pick rule", keys: ["pickMinTraction", "pickMinPwin", "pickMinMcap", "pickMaxMcap", "pickMinScore", "aiInGate", "buyConviction"] },
    { title: "Early coins", keys: ["earlyMinTraders", "earlyMinPwin"] },
    { title: "Entry", keys: ["entryWaitMin", "entryChasePct", "entryCancelPct", "entryFallPct", "entryOffHighPct"] },
    { title: "Exit", keys: ["pickTakeProfit", "pickSellPct", "pickTrailPct", "pickStopPct", "pickMaxHours"] },
    { title: "Risk guard", keys: ["guardLosses", "guardPauseMin", "guardDayLoss"] },
  ] },
  { id: "ai", icon: "ai", title: "AI reads", blurb: "Which models read coins, how often, and how much they may spend", parts: [
    { title: "Research", keys: ["researchAuto", "researchPerHour", "queueMax"] },
    { title: "Quick reads", keys: ["quickReads", "quickGrok", "quickGrokModel"] },
    { title: "Fast reads", keys: ["fastProvider", "fastModel", "fastPerHour", "claudeFast"] },
    { title: "Triage", keys: ["triageOn", "triageProvider", "triageModel", "triageGrokModel", "triageEscalate", "earlyAuto"] },
    { title: "Deep reads", keys: ["deepMinScore", "deepProvider", "deepModel", "deepSearches", "deepPerHour"] },
    { title: "Grok", keys: ["grokModel", "grokSearch", "grokDailyBudget", "grokOff"] },
    { title: "Backups", keys: ["geminiPerDay"] },
    { title: "Narratives", keys: ["scoutEveryMin", "scoutSearches", "scoutEffort", "narrativeModel", "narrativeCardsPerHour", "runningAi"] },
    { title: "Self-review", keys: ["reviewMinNew"] },
  ] },
  { id: "data", icon: "health", title: "Data and servers", blurb: "Where Blix's live data comes from and what it may use", parts: [{ keys: ["marketFeeds", "chartDailyMB", "heliusProjectId", "heliusProjectId2", "fomoRelayTo"] }] },
];
export const KEYS = ["discordWebhook", "telegramToken", "groqKey", "rpcUrl", "rpcWsUrl", "chartWsUrl", "chartWsUrl2", "jupiterKey"];
// Not shown at all: one-time flags and the public-access switches.
export const HIDDEN = new Set(["buyMigrated", "publicHost", "publicMode", "remoteKey", "tunnelKey"]);
