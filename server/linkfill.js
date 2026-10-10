// A coin's X, website and Telegram links when its tracked row has none. DexScreener is where most rows get their
// links, and a coin without a paid DexScreener profile (most pump.fun coins, some worth hundreds of millions)
// comes out with none, so Discover drew no X or website for it. The creator put them in the coin's metadata
// when they launched it: Blix has that for every launch it watched (pulse.js getMeta), and pump.fun answers it
// for any coin launched there. Found links are stored on the row, so each coin is looked up once.
import { db } from "./db.js";
import { getMeta } from "./pulse.js";
import { cleanLinks } from "./quality.js";

const now = () => Date.now();
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const RETRY_MS = 6 * 3600_000, IN_FLIGHT = 3, QUEUE_MAX = 200;
const tried = new Map();   // mint -> when pump.fun was last asked (found nothing, or failed)
const queue = [];
let active = 0;
export const linkFillStats = { fromMeta: 0, fromPump: 0, none: 0, failed: 0 };

const fromMeta = (m) => cleanLinks([m?.twitter && { type: "twitter", url: m.twitter }, m?.website && { type: "website", url: m.website }, m?.telegram && { type: "telegram", url: m.telegram }].filter(Boolean));
const save = (mint, links) => { try { db.prepare("UPDATE tokens SET links = ? WHERE mint = ? AND (links IS NULL OR links = '[]' OR links = '')").run(JSON.stringify(links), mint); } catch {} };

// `links`: the row's own (cleaned). Answers them, else the metadata's; with neither, pump.fun is asked in the
// background and the next answer has them.
export function linksFor(mint, links) {
  if (links?.length || !mint) return links || [];
  const m = fromMeta(getMeta(mint));
  if (m.length) { linkFillStats.fromMeta++; save(mint, m); return m; }
  if (now() - (tried.get(mint) || 0) > RETRY_MS && !queue.includes(mint) && queue.length < QUEUE_MAX) { tried.set(mint, now()); queue.push(mint); pump(); }
  return [];
}

function pump() {
  while (active < IN_FLIGHT && queue.length) {
    const mint = queue.shift();
    active++;
    fetch(`https://frontend-api-v3.pump.fun/coins-v2/${mint}`, { signal: AbortSignal.timeout(6000), headers: { "user-agent": UA, accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        const l = fromMeta(c ? { twitter: c.twitter, website: c.website, telegram: c.telegram } : null);
        if (l.length) { linkFillStats.fromPump++; save(mint, l); } else linkFillStats.none++;
      })
      .catch(() => { linkFillStats.failed++; })
      .finally(() => { active--; if (tried.size > 50_000) tried.clear(); pump(); });
  }
}
