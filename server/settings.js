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
  launchScore: 58,
  momentumScore: 72,
  spikeMinVol: 8000,
  // updates
  discordWebhook: "",
  telegramToken: "",
  telegramChat: "",
  notifyKinds: ["launch", "graduated", "momentum", "volume", "mcap-1000000", "mcap-5000000", "dump", "brief"],
  briefEveryMin: 60,
  aiBriefs: true,
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
