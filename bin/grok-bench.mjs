// Times and prices the Grok models on the radar's real jobs, so each lane uses the right one:
//   node --no-warnings bin/grok-bench.mjs            (about 16 calls, well under a dollar)
// Every call is written to the ai_spend ledger under the "bench" lane.
import { askGrok, detectVersion, grokBilling } from "../server/grok.js";

const QUICK = `You make the first, fast call on a Solana memecoin. Reply with ONLY this JSON, every string short:
{"why":"max 30 words","trade":{"action":"buy|watch|avoid","pWin":0-100},"grade":"A|B|C|D|F","score":0-100,"verdict":"max 18 words"}`;
const COIN = { stage: "new", ticker: "BLOBBY", name: "Blobby the VS Code pet", description: "the official pet of vs code, now on solana",
  liveTrading: { mcapUsd: 18400, athUsd: 21900, buys: 96, sells: 41, uniqueTraders: 71, volumeUsd: 14200, change1mPct: 6.2 },
  market: { mcap: 18400, ageMinutes: 3, bondingProgressPct: 24 }, holders: { total: 64, top10Pct: 31, devPct: 2.1 },
  socials: { x: { user: "blobbypet", followers: 412 }, linkedTweet: { author: "code", authorFollowers: 890000, text: "meet Blobby", likes: 5200, views: 410000 } },
  copycats: { sameTicker: 4, rankByMcap: 1, isOldest: true }, traction: { score: 61 } };
const NARRATIVE = `You name a memecoin narrative that is forming right now. Use x_search to find the source post and who is spreading it.
Reply with ONLY JSON: {"name":"short name","what":"1 sentence","source":"url or none","stage":"early|running|peaking|dead","organic":"organic|mixed|botted","keywords":["3-6 lowercase words"]}`;
const CLUSTER = { tickers: ["BLOBBY", "BLOB", "VSPET"], launchesLast10Min: 7, combinedTraders: 240, sharedLink: "https://x.com/code", leadCoin: "BLOBBY at $18k" };

const cases = [];
for (const model of ["grok-4-fast-non-reasoning", "grok-4.7-build-fast", "grok-4.7"])
  for (let i = 0; i < 2; i++) cases.push({ job: "quick, no search", model, system: QUICK, prompt: `Research (JSON):\n${JSON.stringify(COIN)}`, opts: { search: false, maxTokens: 300, chatEffort: model.includes("non-reasoning") ? null : "low" } });
for (const model of ["grok-4.7-build-fast", "grok-4.7"])
  for (const n of [1, 3]) cases.push({ job: `quick + ${n} search`, model, system: QUICK, prompt: `Look the coin up on X first.\nResearch (JSON):\n${JSON.stringify(COIN)}`, opts: { search: true, maxSearches: n, effort: "low", maxTokens: 900 } });
for (const model of ["grok-4-fast-non-reasoning", "grok-4.7-build-fast", "grok-4.7"])
  for (const effort of model === "grok-4.7" ? ["low", "medium"] : ["low"]) cases.push({ job: `narrative card, 3 searches, ${effort}`, model, system: NARRATIVE, prompt: `Cluster (JSON):\n${JSON.stringify(CLUSTER)}`, opts: { search: true, maxSearches: 3, effort, maxTokens: 900 } });

await detectVersion();
const before = await grokBilling();
const rows = [];
for (const c of cases) {
  const t0 = Date.now();
  try {
    const r = await askGrok(c.system, c.prompt, { model: c.model, lane: "bench", fallback: false, timeout: 120_000, ...c.opts });
    let ok = true; try { JSON.parse(r.text.match(/\{[\s\S]*\}/)[0]); } catch { ok = false; }
    rows.push({ job: c.job, model: c.model, served: r.model, ms: r.ms, searches: r.searches, usd: +r.cost.toFixed(4), out: r.outTokens, json: ok });
  } catch (e) { rows.push({ job: c.job, model: c.model, ms: Date.now() - t0, error: e.message.slice(0, 90) }); }
  console.log(JSON.stringify(rows.at(-1)));
}
const after = await grokBilling();
console.log(JSON.stringify({ calls: rows.length, totalUsd: +rows.reduce((a, r) => a + (r.usd || 0), 0).toFixed(4), billingUsedBefore: before?.used, billingUsedAfter: after?.used }));
