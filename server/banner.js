// A coin's DexScreener banner (the wide header picture of a paid DexScreener profile), for Discover's coin card
// (web/src/pages/discover/hovercard.tsx) when the row it was drawn from has none: Fomo's lists and the live
// stream's new pairs carry no banner. GET /api/banner?m=<mint> → { header: url | null }.
// The tokens table keeps the header of every coin DexScreener has scanned (engine.js applyPair); a coin not
// in it, or kept without one, is asked of DexScreener once (sources.js dexTokens, 30 coins per call, its own
// allowance), and the answer is kept for 30 minutes, a found banner also in the tokens row.
import { db } from "./db.js";
import { dexTokens } from "./sources.js";
import { validAddress } from "./solana.js";

const TTL = 30 * 60_000;
const known = new Map();      // mint -> { t, header }
const asked = new Map();      // mint -> Promise (one DexScreener read per coin at a time)
const getQ = db.prepare("SELECT header FROM tokens WHERE mint = ?");
const putQ = db.prepare("UPDATE tokens SET header = ? WHERE mint = ? AND header IS NULL");
const safe = (u) => (typeof u === "string" && /^https:\/\/[\w.-]+\.(dexscreener\.com|dexscreener\.io)\//i.test(u) ? u : null);

export async function banner(mint) {
  if (!validAddress(mint)) return { error: "Not a coin address." };
  const row = getQ.get(mint);
  if (row?.header) return { header: row.header };
  const k = known.get(mint);
  if (k && Date.now() - k.t < TTL) return { header: k.header };
  if (!asked.has(mint)) {
    asked.set(mint, dexTokens([mint]).then((pairs) => {
      const header = safe(pairs.get(mint)?.info?.header);
      known.set(mint, { t: Date.now(), header });
      if (known.size > 5000) known.delete(known.keys().next().value);
      if (header) putQ.run(header, mint);
      return header;
    }).catch(() => k?.header ?? null).finally(() => asked.delete(mint)));
  }
  return { header: await asked.get(mint) };
}
