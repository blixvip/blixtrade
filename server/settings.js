// User settings live in data/settings.json (gitignored: it may hold webhook URLs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA = process.env.RADAR_DATA ? path.resolve(process.env.RADAR_DATA) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = path.join(DATA, "settings.json");

export const DEFAULTS = {
  // discovery
  nurseryMinMcap: 12000,     // a pump.fun launch must reach this mcap within ~4 min to be tracked
  nurseryMinVol5m: 3000,
  maxTracked: 900,
  // signals
  minSafety: 60,             // RugCheck-based 0..100, and no "danger" risks
  launchScore: 62,
  momentumScore: 72,
  spikeMinVol: 8000,
  minExitLiq: 1000,          // a pool holding less than this ($) is unsellable: no signals, and its outcomes count as a total loss
  // updates
  discordWebhook: "",
  telegramToken: "",
  telegramChat: "",
  notifyKinds: ["launch", "graduated", "momentum", "volume", "mcap-1000000", "mcap-5000000", "dump", "brief", "wallet", "smart", "dev-sold", "rugged", "liq-pulled", "research", "fomo", "buy", "pick"],
  briefEveryMin: 60,
  aiBriefs: true,
  // alert rules
  quietStart: "",            // local time like "23:00"; blank = no quiet hours
  quietEnd: "",
  alertCooldownMin: 10,      // at most one push per coin in this many minutes; the rest are grouped into the next one
  pushUnscreened: false,     // also push wallet buys of coins that failed (or have not had) the safety check
  // wallets
  rpcUrl: "",               // blank = free public Solana RPC (slow). A free Helius URL is ~10x faster.
  rpcWsUrl: "",             // websocket for the live pump.fun trade feed; blank = derived from rpcUrl, else the public one
  jupiterKey: "",           // optional: increases the shared quote/price request allowance
  autoFollowSmart: true,     // automatically watch the best wallets the radar discovers
  maxSmartWallets: 20,
  walletMinSol: 0.5,         // smallest buy by an auto-followed wallet worth an alert
  // research
  researchAuto: true,        // research coins about to bond and just bonded automatically
  researchPerHour: 20,       // cap on Claude research runs per hour (each uses your Claude subscription)
  queueMax: 60,              // most coins allowed to wait for a read; the weakest and oldest are dropped past this
  fastProvider: "grok",      // "grok" = this PC's Grok CLI login (SuperGrok, searches X live); "groq" = free Groq key; "claude" = Claude Haiku on this PC's Claude login
  grokModel: "grok-4.7-build-fast",
  grokSearch: true,          // let Grok search X and the web for every coin it reads
  grokDailyBudget: 3,        // dollars of Grok subscription credit the radar may spend per day (0 = no limit). Narrative work may use all of it; per-coin reads stop earlier.
  triageOn: true,           // rank every new launch: instant rules + a fast LLM (Groq if keyed, else Grok fast)
  triageProvider: "auto",    // auto | groq | grok
  triageModel: "openai/gpt-oss-20b",
  triageGrokModel: "grok-4-fast-non-reasoning",   // Grok's fastest + cheapest (no reasoning step); ~2s per batch
  triageEscalate: 55,        // triage score that sends a coin to Grok for real research
  earlyAuto: true,           // the launch model may put its very strongest coins on the entry watch before the AI has answered
  claudeFast: true,          // when Grok and Groq are both unavailable, Claude Haiku does the fast first reads
  groqKey: "",               // free key from console.groq.com/keys: fast lane grades every candidate in ~1s
  fastModel: "openai/gpt-oss-120b",
  fastPerHour: 60,           // cap on fast first reads per hour (each Grok read with X search uses subscription credits)
  deepMinScore: 45,          // fast grades at or above this get a deep read (~top 10%; the self-review can tune this)
  deepProvider: "grok",      // "grok" (grok-4.7 with deep X/web search, makes buy calls) or "claude"
  deepModel: "grok-4.7",
  deepSearches: 6,           // max X/web searches per deep read
  deepPerHour: 12,
  pickMinScore: 40,          // fallback only, for a read that came back without a trade call
  // the pick rule: the AI must not say avoid, and the coin must show real demand
  pickMinTraction: 60,       // minimum live traction (0-100)
  pickMinPwin: 25,           // minimum chance the AI gives it of reaching 2x before falling 40% (a "buy" call passes regardless)
  pickMinMcap: 15000,        // coins smaller than this almost never went anywhere
  pickMaxMcap: 250000,       // above this the early move is over
  // the early rule: a coin still in its first minutes is judged on its first buyers, not on size or 5-minute volume
  earlyMinTraders: 25,       // different wallets that have traded it
  earlyMinPwin: 20,          // minimum AI chance (a "buy" call passes regardless)
  // paper exit rule applied to every pick, so the day's result is "followed the rule", not "held to zero"
  pickTakeProfit: 2,         // sell part of the position when the coin reaches this multiple
  pickSellPct: 50,           // how much of it to sell there
  pickTrailPct: 35,          // after taking profit, sell the rest once it falls this far below its high
  pickStopPct: 40,           // before any profit is taken, sell everything if it falls this far below the pick price
  pickMaxHours: 6,           // sell whatever is left after this long
  // entry rule: a well-rated coin is watched every second and only entered on a clean moment
  entryWaitMin: 10,          // give up on a coin that offers no clean entry within this long
  entryChasePct: 50,         // do not enter while it is more than this far above the price it was rated at
  entryCancelPct: 40,        // drop it if it falls this far below the rated price while waiting
  entryFallPct: 5,           // "falling" = down this much in the last 15 seconds: wait for it to stop
  entryOffHighPct: 60,       // do not enter a coin sitting this far below its all-time high
  // risk guard: stop taking new picks for a while when things are going badly
  guardLosses: 5,            // this many losing exits in a row pauses new picks (0 = off)
  guardPauseMin: 45,         // for this long
  guardDayLoss: 600,         // and for the rest of the day once $100-a-pick is down this many dollars (0 = off)
  quickReads: true,          // first reads are quick calls (a few seconds); the full report follows for coins worth it
  quickGrok: true,           // quick calls go to Grok's fastest model (about a second) while its daily share lasts, then Claude Haiku
  quickGrokModel: "grok-4-fast-non-reasoning",
  aiInGate: false,           // false = the AI's buy/avoid call does not decide picks (measured: its "buy" picks lost, its "avoid" picks won); it is still shown and scored
  buyConviction: 75,         // minimum conviction for a buy call (the self-review can tune this)
  scoutEveryMin: 120,        // Grok narrative scout: searches X/web for narratives starting to run
  scoutSearches: 12,
  scoutEffort: "low",        // "low" = about 3 searches and 8 cents a scout; "medium" = about 7 searches and 20 cents
  narrativeModel: "grok-4.7", // names a burst of same-named launches the moment it has buyers (about 7 seconds and 7 cents each)
  narrativeCardsPerHour: 6,
  reviewMinNew: 25,          // self-review once this many new graded coins have played out (6h+)
  buyMigrated: false,
  // fomo (free, on-chain)
  fomoAutoFollow: true,      // follow the best Fomo traders the radar sees on-chain
  fomoFollowTop: 15,
  // remote access: the public hostname a Cloudflare Tunnel points at this PC, and the key a browser must present once
  // (as ?key=… ; it is then kept in a cookie). Blank key = generated on first start. Local pages never need it.
  publicHost: "trade.blixvip.com",
  remoteKey: "",
  tunnelKey: "",             // shared with the Worker on the public hostname (its REG_KEY secret); blank = no tunnel
  // paper desk: the one-click buy buttons on every Pulse row (SOL sizes) and the exit rule each new paper position starts with (0 = none)
  quickSizes: ["0.1", "0.25", "0.5", "1"],
  paperTake: 0,              // sell everything at this multiple
  paperStop: 0,              // sell everything this % below the entry
  paperTrail: 0,             // sell everything this % below its high, once it has been above the entry
};

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch { return { ...DEFAULTS }; }
}

export const settings = load();

// Never sent to the browser: the page only learns whether each one is set, and its last 4 characters.
export const SECRETS = ["discordWebhook", "telegramToken", "groqKey", "rpcUrl", "rpcWsUrl", "jupiterKey", "remoteKey", "tunnelKey"];

function coerce(k, v) {
  const d = DEFAULTS[k];
  if (typeof d === "number") { const n = Number(v); return Number.isFinite(n) ? n : d; }
  return typeof d === "boolean" ? Boolean(v) : Array.isArray(d) ? [].concat(v).map(String) : String(v ?? "").trim();
}
const blankSecret = (k, v) => SECRETS.includes(k) && !String(v ?? "").trim();

// A blank secret means "leave it as it is"; removing one takes its name in `clear`.
export function saveSettings(patch, { clear = [] } = {}) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS) || blankSecret(k, v)) continue;
    settings[k] = coerce(k, v);
  }
  for (const k of clear) if (SECRETS.includes(k)) settings[k] = "";
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
  return settings;
}

// What the dashboard gets: every setting except the secrets themselves.
export function publicSettings() {
  const out = { ...settings }, secrets = {};
  for (const k of SECRETS) {
    const v = String(settings[k] || "");
    secrets[k] = { set: Boolean(v), hint: v ? `…${v.slice(-4)}` : "" };
    out[k] = "";
  }
  return { settings: out, secrets, defaults: Object.fromEntries(Object.entries(DEFAULTS).filter(([k]) => !SECRETS.includes(k))) };
}

// Settings for a one-off test: the saved values with typed-but-unsaved ones laid over them. Nothing is stored.
export function withOverrides(patch) {
  const out = { ...settings };
  for (const [k, v] of Object.entries(patch || {})) if (k in DEFAULTS && !blankSecret(k, v)) out[k] = coerce(k, v);
  return out;
}
