// Times page loads in a real browser and counts what they cost:
//   node scripts/loadprobe.mjs [base=http://127.0.0.1:4421] [--mint <mint>] [--save file.json] [--compare file.json] [--fast]
// For each page (Pulse, a coin, the landing, a docs page) it loads cold (empty cache) and warm (second visit),
// on a throttled line (40 ms RTT, 12 Mbit/s down, like a decent phone or the home line) unless --fast, and prints:
// the blix:* marks (index.html, main.tsx: html, main, code, answers, render, mounted), FCP, LCP, requests, bytes
// over the wire, CORS preflights (OPTIONS), and how many times the Pulse board (api/pulse) was read.
// Run it on the VM (real Chromium, no other tabs): the Aside browser fakes slow paints (memory blix-perf-measuring).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require("C:/code/note-overlay/node_modules/playwright"); }

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const fast = args.includes("--fast"); if (fast) args.splice(args.indexOf("--fast"), 1);
const showPaths = args.includes("--paths"); if (showPaths) args.splice(args.indexOf("--paths"), 1);
const save = flag("--save"), compare = flag("--compare");
let mint = flag("--mint");
const base = args[0] || "http://127.0.0.1:4421";
const site = "https://blixvip.com";

if (!mint) {
  // The busiest coin on the board right now.
  try {
    const d = await (await fetch(`${base}/api/pulse`)).json();
    mint = (d.running?.[0] || d.newPairs?.[0])?.mint;
  } catch {}
}

const pages = [
  { name: "pulse", url: `${base}/app#/`, ready: "[data-pulse-row], [data-coin-row], main" },
  ...(mint ? [{ name: "coin", url: `${base}/app#/coin/${mint}`, ready: "main" }] : []),
  { name: "landing", url: `${site}/`, ready: "body" },
  { name: "docs", url: `${site}/api`, ready: "body" },
];

const browser = await pw.chromium.launch({ channel: "chrome", headless: true }).catch(() => pw.chromium.launch({ headless: true }));

async function load(p, ctx) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  if (!fast) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 12e6 / 8, uploadThroughput: 4e6 / 8 });
  let bytes = 0, requests = 0, preflights = 0, pulse = 0;
  const paths = new Map();
  const sizes = new Map();
  cdp.on("Network.requestWillBeSent", (e) => {
    if (e.request.url.startsWith("data:")) return;
    requests++;
    if (e.request.method === "OPTIONS") preflights++;
    if (/\/api\/pulse(\?|$)/.test(e.request.url)) pulse++;
    const u = new URL(e.request.url), key = `${e.request.method === "GET" ? "" : e.request.method + " "}${u.pathname.replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, "{m}").replace(/-[\w-]{8}\.(js|css)$/, ".$1")}`;
    paths.set(key, (paths.get(key) || 0) + 1);
  });
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; sizes.set(e.requestId, e.encodedDataLength); });
  // Chrome counts CORS preflights apart from the request they precede.
  cdp.on("Network.requestWillBeSentExtraInfo", () => {});
  const t0 = Date.now();
  await page.goto(p.url, { waitUntil: "load", timeout: 60000 }).catch(() => {});
  await page.waitForSelector(p.ready, { timeout: 20000 }).catch(() => {});
  // Settle: the first reads and the page's code.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 4000)));
  const m = await page.evaluate(() => {
    const out = {};
    for (const e of performance.getEntriesByType("mark")) if (e.name.startsWith("blix:")) out[e.name.slice(5)] = Math.round(e.startTime);
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    if (fcp) out.fcp = Math.round(fcp.startTime);
    return out;
  });
  const lcp = await page.evaluate(() => new Promise((r) => {
    let v = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) v = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    setTimeout(() => r(Math.round(v)), 100);
  }));
  // The OPTIONS preflights Chrome sends for cross-origin reads show up in resource timing only indirectly; the
  // CDP count above sees them when they go out as their own requests.
  await page.close();
  if (showPaths) console.log(`-- ${p.name}: ` + [...paths].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}x ${k}`).join(", "));
  return { ...m, lcp, requests, kb: Math.round(bytes / 1024), preflights, pulse, wall: Date.now() - t0 };
}

const results = {};
for (const p of pages) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cold = await load(p, ctx);
  const warm = await load(p, ctx);
  await ctx.close();
  results[p.name] = { cold, warm };
}
await browser.close();

const old = compare && fs.existsSync(compare) ? JSON.parse(fs.readFileSync(compare, "utf8")).results : null;
const cols = ["html", "main", "code", "answers", "render", "mounted", "fcp", "lcp", "requests", "kb", "preflights", "pulse"];
console.log(`loadprobe ${new Date().toISOString()} base=${base} mint=${mint?.slice(0, 8) || "-"} ${fast ? "unthrottled" : "40ms/12Mbit"}`);
console.log(["page".padEnd(14), ...cols.map((c) => c.padStart(9))].join(""));
for (const [name, r] of Object.entries(results)) {
  for (const kind of ["cold", "warm"]) {
    const row = r[kind], was = old?.[name]?.[kind];
    console.log([`${name} ${kind}`.padEnd(14), ...cols.map((c) => {
      const v = row[c];
      if (v == null) return "-".padStart(9);
      const d = was?.[c] != null ? v - was[c] : null;
      return (String(v) + (d ? (d > 0 ? "+" : "") + d : "")).padStart(9);
    })].join(""));
  }
}
if (save) { fs.writeFileSync(save, JSON.stringify({ t: Date.now(), base, mint, fast, results }, null, 1)); console.log(`saved ${save}`); }
