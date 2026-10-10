// Fomo's token lists (fomo.family's Tokens tabs: Crypto, Trending, Most held, Graduated), exactly as Fomo
// serves them, for Discover's Top and Most held tabs. Fomo only answers signed-in accounts and checks the
// browser's own cookies, so the lists are read inside a fomo.family tab in the user's Aside browser, through
// Fomo's own fetch (the same way fomoboard.js reads the leaderboard). One Aside call reads every list at once;
// calls only run while someone has one of these tabs open (asked for in the last WANTED_MS), at most one at a
// time and at least refreshMs() apart, so Aside is not opening tabs when nobody is looking.
import fs from "node:fs";
import path from "node:path";
import { DATA, db } from "./db.js";
import { hasAside, runRepl, signedOutText } from "./browser.js";
import { fomoFetch } from "./fomochart.js";
import { ETH_TOO, offChain } from "./chains.js";
import { warmList } from "./feedwarm.js";

const LISTS = { top: "/proxy/cryptoTokens", held: "/proxy/mostHeld", trending: "/proxy/trendingTokens", graduated: "/proxy/graduatedTokens" };
// Read every 3 s in Aside; every 8 s from the server's own browser (one core, shared with the radar).
// Straight from Fomo's API (direct below) a read is a few small calls, so 3 s there too.
const refreshMs = () => (hasAside() || state.direct ? 3_000 : 8_000);
const WANTED_MS = 45_000, VERIFIED_MS = 10 * 60_000;
const now = () => Date.now();
const state = { direct: false, lists: {}, t: 0, tried: 0, error: null, signedOut: false, running: false, wanted: 0, verified: new Set(), verifiedT: 0, calls: 0, listT: {}, answers: {} };
// After a failed read (Fomo down, the browser signed out) the next try waits: a server whose Fomo login has run
// out must not keep the browser busy trying every few seconds.
const AFTER_ERROR_MS = hasAside() ? 15_000 : 60_000;
const due = () => !state.running && now() - state.t > refreshMs() && now() - state.tried > (state.error ? AFTER_ERROR_MS : refreshMs());
export const fomoListStats = state;

// The last lists Fomo served, kept on disk so they show the moment the radar starts (marked with when they
// were read) instead of an empty tab for the 10-25 s an Aside read takes.
const SAVED = path.join(DATA, "fomolists.json");
try {
  const j = JSON.parse(fs.readFileSync(SAVED, "utf8"));
  if (j && j.lists) { state.lists = j.lists; state.t = +j.t || 0; state.verified = new Set(j.verified || []); state.verifiedT = +j.verifiedT || 0; }
} catch { /* first run, or no file yet */ }
const save = () => fs.promises.writeFile(SAVED + ".tmp", JSON.stringify({ lists: state.lists, t: state.t, verified: [...state.verified], verifiedT: state.verifiedT }))
  .then(() => fs.promises.rename(SAVED + ".tmp", SAVED)).catch(() => {});

// Runs inside the Fomo tab: Fomo's own fetch, each list slimmed to what Discover shows, in Fomo's order.
const PAGE = (wantVerified) => `
const page = await openTab("https://fomo.family/");
let res = null;
for (let i = 0; i < 14 && !res; i++) {
  await new Promise((r) => setTimeout(r, 1200));
  // Fomo's sign-in layer still starting ("No global PrivyClient instance"): not yet, try again.
  res = await page.evaluate(async () => {
    const lists = ${JSON.stringify(LISTS)}, wantVerified = ${wantVerified ? "true" : "false"};
    const man = JSON.stringify(window.__reactRouterManifest || {});
    const urls = [...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.querySelectorAll("link[rel=modulepreload],script[src]")].map((l) => l.href || l.src), ...(man.match(/\\/assets\\/[^"]+\\.js/g) || [])];
    const ff = urls.find((n) => /\\/fomoFetch-[^/]*\\.js/.test(n));
    if (!ff) return null;
    const m = await import(ff);
    const fn = Object.values(m).find((v) => typeof v === "function" && /statusCode:401|Authorization|timing:\{|timeoutMs/.test(String(v)));
    if (!fn) return { error: "Fomo's web client changed: its fetch function was not found." };
    const slim = (r) => ({ mint: r.token?.address, chain: r.token?.networkId, symbol: r.token?.symbol, name: r.token?.name,
      img: r.token?.info?.imageThumbUrl || r.token?.info?.imageSmallUrl || null, price: +r.priceUSD || null, mcap: +r.marketCap || null,
      chg: r.change24 != null ? +r.change24 * 100 : null, liq: +r.liquidity || null, vol: +r.volume24 || null, holders: r.holders ?? null,
      created: r.createdAt ? r.createdAt * 1000 : null, pad: r.token?.launchpad?.launchpadName || null, padIcon: r.token?.launchpad?.launchpadIconUrl || null,
      x: r.token?.socialLinks?.twitter || null, web: r.token?.socialLinks?.website || null, tg: r.token?.socialLinks?.telegram || null });
    const out = {};
    for (const [k, p] of Object.entries(lists)) {
      const x = await fn(p, { method: "POST" });
      if (x.statusCode === 401) return { error: "signed-out" };
      out[k] = x.statusCode === 200 && Array.isArray(x.responseObject) ? x.responseObject.map(slim).filter((r) => r.mint) : null;
    }
    let verified = null;
    if (wantVerified) { const v = await fn("/proxy/verifiedTokens", { method: "GET" }); verified = v.statusCode === 200 ? (v.responseObject || []).map((r) => r.token?.address).filter(Boolean) : null; }
    return { lists: out, verified };
  }).catch((e) => (/Privy/i.test(String(e.message)) ? null : { error: String(e.message).slice(0, 200) }));
}
console.log(JSON.stringify({ fomolists: 1, ...(res || { error: "fomo.family did not load in Aside." }) }));
`;

// In Aside on the owner's PC, in the server's own headless browser elsewhere (browser.js).
const run = (script, timeoutMs = 60_000) => runRepl(script, { marker: "fomolists", timeoutMs, what: "Fomo" });

// Each list slimmed to what Discover shows, in Fomo's order (the same as the in-tab script does).
const slim = (r) => ({ mint: r.token?.address, chain: r.token?.networkId, symbol: r.token?.symbol, name: r.token?.name,
  img: r.token?.info?.imageThumbUrl || r.token?.info?.imageSmallUrl || null, price: +r.priceUSD || null, mcap: +r.marketCap || null,
  chg: r.change24 != null ? +r.change24 * 100 : null, liq: +r.liquidity || null, vol: +r.volume24 || null, holders: r.holders ?? null,
  created: r.createdAt ? r.createdAt * 1000 : null, pad: r.token?.launchpad?.launchpadName || null, padIcon: r.token?.launchpad?.launchpadIconUrl || null,
  x: r.token?.socialLinks?.twitter || null, web: r.token?.socialLinks?.website || null, tg: r.token?.socialLinks?.telegram || null });
// Straight from Fomo's API with the server's Fomo token (fomochart.js); null when there is no token, so the
// in-tab way is tried.
async function direct(wantVerified) {
  const out = {};
  for (const [k, p] of Object.entries(LISTS)) {
    const x = await fomoFetch(p, { method: "POST" });
    if (x.statusCode === 0) return null;
    if (x.statusCode === 401) return { error: "signed-out" };
    out[k] = x.statusCode === 200 && Array.isArray(x.responseObject) ? x.responseObject.map(slim).filter((r) => r.mint) : null;
    state.answers[k] = { status: x.statusCode, message: out[k] ? null : String(x.message || "").slice(0, 160) || null, t: now() };
  }
  // Fomo turned every list down from here: the in-tab way gets its chance instead.
  if (!Object.values(out).some(Boolean)) return null;
  let verified = null;
  if (wantVerified) { const v = await fomoFetch("/proxy/verifiedTokens", { method: "GET" }); verified = v.statusCode === 200 ? (v.responseObject || []).map((r) => r.token?.address).filter(Boolean) : null; }
  return { lists: out, verified };
}

async function refresh() {
  state.running = true; state.calls++; state.tried = now();
  try {
    const wantVerified = now() - state.verifiedT > VERIFIED_MS;
    const dr = await direct(wantVerified).catch(() => null);
    state.direct = Boolean(dr && !dr.error);
    const r = dr || await run(PAGE(wantVerified));
    if (r.error === "signed-out") { state.signedOut = true; throw new Error(signedOutText()); }
    if (r.error) throw new Error(r.error);
    state.signedOut = false;
    // Only lists that came back count as read: one Fomo turned down keeps its last copy AND its last time.
    for (const [k, v] of Object.entries(r.lists || {})) if (v) { state.lists[k] = v; state.listT[k] = now(); }
    // Every coin's logo fetched now, from Fomo's own link when the radar has no other (feedwarm.js).
    try { for (const k of ["trending", "held"]) warmList(state.lists[k]); } catch {}
    if (r.verified) { state.verified = new Set(r.verified); state.verifiedT = now(); }
    state.t = now(); state.error = null;
    save();
  } catch (e) { state.error = e.message; }
  finally { state.running = false; }
}

// GET /api/fomo/list?kind=top|held|trending|graduated: the list as Fomo last served it (null until the first
// read finishes, a few seconds after the first ask), with when it was read.
// The Solana coins in the lists Fomo last answered, without asking Fomo again (server.js warms their figures).
export function fomoMints() {
  const out = new Set();
  for (const k of ["trending", "held", "top"]) for (const r of state.lists[k] || []) if (r?.mint && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(r.mint)) out.add(r.mint);
  return [...out];
}
// Most held runs only ~12 deep at Fomo, so Blix's own coins follow it: the most-held Solana coins the radar
// tracks (holder counts as RugCheck last read them, which include emptied accounts, so rough), still trading
// (priced in the last hour) and not already in Fomo's list. Read at most every 30 s.
const HELD_MORE = 50, HELD_MORE_MS = 30_000, WSOL = "So11111111111111111111111111111111111111112";
let heldMore = { t: 0, rows: [] };
function blixHeld() {
  if (now() - heldMore.t < HELD_MORE_MS) return heldMore.rows;
  try {
    const q = db.prepare(`SELECT mint, symbol, name, image, mcap, liquidity, vol_h24, chg_h24, dex, pair_created, first_seen,
        CAST(json_extract(safety, '$.totalHolders') AS INTEGER) AS h FROM tokens
      WHERE status = 'active' AND json_extract(safety, '$.totalHolders') > 2000 AND mcap >= 100000 AND price_t > ?
      ORDER BY h DESC LIMIT ?`);
    heldMore = { t: now(), rows: q.all(now() - 3_600_000, HELD_MORE + 20).map((r) => ({ mint: r.mint, chain: 1399811149, symbol: r.symbol, name: r.name,
      img: r.image || null, price: null, mcap: r.mcap || null, chg: r.chg_h24 ?? null, liq: r.liquidity || null, vol: r.vol_h24 || null, holders: r.h,
      created: r.pair_created || r.first_seen || null, pad: r.mint.endsWith("pump") ? "Pump.fun" : null, padIcon: null, x: null, web: null, tg: null, src: "blix" })) };
  } catch (e) { heldMore.t = now(); }
  return heldMore.rows;
}

export function fomoList(kind) {
  if (!LISTS[kind]) return { error: "unknown list" };
  state.wanted = now();
  if (due()) refresh();
  // Ethereum, BNB Chain and Robinhood Chain coins stay off Blix (chains.js).
  const rows = state.lists[kind]?.filter((r) => !offChain(r.chain, ETH_TOO)).map((r) => ({ ...r, verified: state.verified.has(r.mint) })) || null;
  if (kind === "held" && rows) {
    const seen = new Set(rows.map((r) => r.mint)); seen.add(WSOL);
    for (const r of blixHeld()) if (!seen.has(r.mint) && rows.length < 12 + HELD_MORE) { seen.add(r.mint); rows.push({ ...r, verified: state.verified.has(r.mint) }); }
  }
  return { kind, rows, t: state.listT[kind] || state.t || null, answer: state.answers[kind] || null, loading: state.running, error: state.error, signedOut: state.signedOut };
}

// One read soon after the radar starts, so the lists are fresh by the time anyone opens Discover.
// (Not for a copy on its own data folder, such as the tests: that must never drive the real Aside.)
if (!process.env.RADAR_DATA) setTimeout(() => { if (!state.running) refresh(); }, 5_000).unref();

// Keep reading while someone is looking; stop when they leave.
setInterval(() => { if (now() - state.wanted < WANTED_MS && due()) refresh(); }, 1_000).unref();
