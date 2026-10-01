// User settings live in data/settings.json (gitignored: it may hold webhook URLs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "settings.json");

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
  // updates
  discordWebhook: "",
  telegramToken: "",
  telegramChat: "",
  notifyKinds: ["launch", "graduated", "momentum", "volume", "mcap-1000000", "mcap-5000000", "dump", "brief", "wallet", "smart", "dev-sold", "rugged", "research", "fomo", "buy"],
  briefEveryMin: 60,
  aiBriefs: true,
  // wallets
  rpcUrl: "",               // blank = free public Solana RPC (slow). A free Helius URL is ~10x faster.
  rpcWsUrl: "",             // websocket for the live pump.fun trade feed; blank = derived from rpcUrl, else the public one
  autoFollowSmart: true,     // automatically watch the best wallets the radar discovers
  maxSmartWallets: 20,
  walletMinSol: 0.5,         // smallest buy by an auto-followed wallet worth an alert
  // research
  researchAuto: true,        // research coins about to bond and just bonded automatically
  researchPerHour: 20,       // cap on Claude research runs per hour (each uses your Claude subscription)
  fastProvider: "grok",      // "grok" = this PC's Grok CLI login (SuperGrok, searches X live); "groq" = free Groq key
  grokModel: "grok-4.7-build-fast",
  grokSearch: true,          // let Grok search X and the web for every coin it reads
  triageOn: true,           // rank every new launch: instant rules + a fast LLM (Groq if keyed, else Grok fast)
  triageProvider: "auto",    // auto | groq | grok
  triageModel: "openai/gpt-oss-20b",
  triageEscalate: 55,        // triage score that sends a coin to Grok for real research
  groqKey: "",               // free key from console.groq.com/keys: fast lane grades every candidate in ~1s
  fastModel: "openai/gpt-oss-120b",
  fastPerHour: 240,          // cap on fast (Groq) grades per hour
  deepMinScore: 45,          // fast grades at or above this get a deep read (~top 10%; the self-review can tune this)
  deepProvider: "grok",      // "grok" (grok-4.7 with deep X/web search, makes buy calls) or "claude"
  deepModel: "grok-4.7",
  deepSearches: 10,          // max X/web searches per deep read
  deepPerHour: 60,
  buyConviction: 75,         // minimum conviction for a buy call (the self-review can tune this)
  scoutEveryMin: 45,         // Grok narrative scout: searches X/web for narratives starting to run
  scoutSearches: 12,
  reviewMinNew: 25,          // self-review once this many new graded coins have played out (6h+)
  buyMigrated: false,
  // fomo (free, on-chain)
  fomoAutoFollow: true,      // follow the best Fomo traders the radar sees on-chain
  fomoFollowTop: 15,
};

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch { return { ...DEFAULTS }; }
}

export const settings = load();

export function saveSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue;
    const d = DEFAULTS[k];
    settings[k] = typeof d === "number" ? Number(v) : typeof d === "boolean" ? Boolean(v) : Array.isArray(d) ? [].concat(v) : String(v ?? "");
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(settings, null, 2));
  return settings;
}
