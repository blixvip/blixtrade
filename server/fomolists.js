// Fomo's token lists (fomo.family's Tokens tabs: Crypto, Trending, Most held, Graduated), exactly as Fomo
// serves them, for Discover's Top and Most held tabs. Fomo only answers signed-in accounts and checks the
// browser's own cookies, so the lists are read inside a fomo.family tab in the user's Aside browser, through
// Fomo's own fetch (the same way fomoboard.js reads the leaderboard). One Aside call reads every list at once;
// calls only run while someone has one of these tabs open (asked for in the last WANTED_MS), at most one at a
// time and at least REFRESH_MS apart, so Aside is not opening tabs when nobody is looking.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./db.js";
import { ASIDE_EXE } from "./fomoboard.js";

const LISTS = { top: "/proxy/cryptoTokens", held: "/proxy/mostHeld", trending: "/proxy/trendingTokens", graduated: "/proxy/graduatedTokens" };
const REFRESH_MS = 3_000, WANTED_MS = 45_000, VERIFIED_MS = 10 * 60_000;
const now = () => Date.now();
const state = { lists: {}, t: 0, error: null, signedOut: false, running: false, wanted: 0, verified: new Set(), verifiedT: 0, calls: 0 };
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
  res = await page.evaluate(async () => {
    const lists = ${JSON.stringify(LISTS)}, wantVerified = ${wantVerified ? "true" : "false"};
    const man = JSON.stringify(window.__reactRouterManifest || {});
    const urls = [...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.querySelectorAll("link[rel=modulepreload],script[src]")].map((l) => l.href || l.src), ...(man.match(/\\/assets\\/[^"]+\\.js/g) || [])];
    const ff = urls.find((n) => /\\/fomoFetch-[^/]*\\.js/.test(n));
    if (!ff) return null;
    const m = await import(ff);
    const fn = Object.values(m).find((v) => typeof v === "function" && /statusCode:401|Authorization/.test(String(v)));
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
  });
}
console.log(JSON.stringify({ fomolists: 1, ...(res || { error: "fomo.family did not load in Aside." }) }));
`;

function run(script, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(ASIDE_EXE)) return reject(new Error("Aside isn't installed (its CLI was not found)."));
    const code = `await eval("(async () => {" + atob("${Buffer.from(script, "utf8").toString("base64")}") + "})()");`;
    const child = spawn(ASIDE_EXE, ["repl", code], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const timer = setTimeout(() => { child.kill(); reject(new Error("Aside took too long reading Fomo.")); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{"fomolists"'));
      if (!line) return reject(new Error("No answer from Aside."));
      try { resolve(JSON.parse(line)); } catch { reject(new Error("Aside's answer could not be read.")); }
    });
  });
}

async function refresh() {
  state.running = true; state.calls++;
  try {
    const wantVerified = now() - state.verifiedT > VERIFIED_MS;
    const r = await run(PAGE(wantVerified));
    if (r.error === "signed-out") { state.signedOut = true; throw new Error("Aside is signed out of Fomo. Sign in at fomo.family in Aside."); }
    if (r.error) throw new Error(r.error);
    state.signedOut = false;
    for (const [k, v] of Object.entries(r.lists || {})) if (v) state.lists[k] = v;
    if (r.verified) { state.verified = new Set(r.verified); state.verifiedT = now(); }
    state.t = now(); state.error = null;
    save();
  } catch (e) { state.error = e.message; }
  finally { state.running = false; }
}

// GET /api/fomo/list?kind=top|held|trending|graduated: the list as Fomo last served it (null until the first
// read finishes, a few seconds after the first ask), with when it was read.
export function fomoList(kind) {
  if (!LISTS[kind]) return { error: "unknown list" };
  state.wanted = now();
  if (!state.running && now() - state.t > REFRESH_MS) refresh();
  const rows = state.lists[kind]?.map((r) => ({ ...r, verified: state.verified.has(r.mint) })) || null;
  return { kind, rows, t: state.t || null, loading: state.running, error: state.error, signedOut: state.signedOut };
}

// One read soon after the radar starts, so the lists are fresh by the time anyone opens Discover.
// (Not for a copy on its own data folder, such as the tests: that must never drive the real Aside.)
if (!process.env.RADAR_DATA) setTimeout(() => { if (!state.running) refresh(); }, 5_000).unref();

// Keep reading while someone is looking; stop when they leave.
setInterval(() => { if (!state.running && now() - state.wanted < WANTED_MS && now() - state.t > REFRESH_MS) refresh(); }, 5_000).unref();
