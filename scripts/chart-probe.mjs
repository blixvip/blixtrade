// Watches a coin's chart in a real browser and reports whether it keeps up with the chain:
//   node scripts/chart-probe.mjs <mint> [tf=1] [seconds=90] [base=http://127.0.0.1:4421]
// Every 250 ms it reads what the chart holds (the data-* the chart sets on its element), the header's market
// cap, and what the server says the newest trade is; at the end it prints stalls (the chart's newest candle
// falling more than 3 s behind now while the coin traded), poll errors, pushes, and how far the header and
// chart sat apart.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require("C:/code/note-overlay/node_modules/playwright"); }
const [mint, tfArg = "1", secArg = "90", base = "http://127.0.0.1:4421"] = process.argv.slice(2);
const tf = Number(tfArg), seconds = Number(secArg);
// The PC's Chrome when there is one; else Playwright's own Chromium (the VM).
const browser = await pw.chromium.launch({ channel: "chrome", headless: true }).catch(() => pw.chromium.launch({ headless: true }));
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().replace(base, "").slice(0, 120)}`); });
await page.goto(`${base}/app`, { waitUntil: "domcontentloaded" });
await page.evaluate((tf) => localStorage.setItem("blix:coin:tf", String(tf)), tf);
await page.goto(`${base}/app#/coin/${mint}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-coin-chart][data-last]", { timeout: 30000 });
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < seconds * 1000) {
  const s = await page.evaluate(() => {
    const el = document.querySelector("[data-coin-chart]");
    const header = document.querySelector("b.num.font-display")?.textContent || "";
    return { ...el.dataset, header, hidden: document.hidden };
  });
  samples.push({ t: Date.now(), ...s });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
}
await browser.close();
// The chain's trades in the window, from the radar's own list.
const trades = (await (await fetch(`${base}/api/coin/${mint}/trades?limit=300`)).json()).trades.filter((x) => x.t >= t0 && x.t <= Date.now()).sort((a, b) => a.t - b.t);
const num = (s) => { const m = /\$([\d.]+)([KMB]?)/.exec(s || ""); return m ? +m[1] * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]] || 1) : null; };
let stalls = [], cur = null, maxBehind = 0, errs = new Set(), pushes = new Set(), apart = [];
for (const s of samples) {
  if (!Number(s.last)) continue;   // the chart not drawn yet
  const behind = s.t / 1000 - Number(s.last || 0);
  maxBehind = Math.max(maxBehind, behind);
  const traded = trades.some((x) => x.t > s.t - 5000 && x.t <= s.t);
  if (behind > 3 * Math.max(tf, 1) + 2 && traded) { if (!cur) cur = { from: s.t, behind }; cur.to = s.t; cur.behind = Math.max(cur.behind, behind); }
  else if (cur) { stalls.push(cur); cur = null; }
  if (s.err) errs.add(s.err);
  if (s.pushed) pushes.add(s.pushed);
  const h = num(s.header), c = Number(s.close);
  if (h && c) apart.push(Math.abs(h / c - 1) * 100);
}
if (cur) stalls.push(cur);
// Jumps: the chart's close moving more than 4% from one sample to the next and coming back within 3 s (a price
// from a different source than the one before and after it), with which stream moved it.
const jumps = [];
for (let i = 1; i < samples.length; i++) {
  const a = Number(samples[i - 1].close), b = Number(samples[i].close);
  if (!(a > 0 && b > 0) || Math.abs(b / a - 1) < 0.04) continue;
  const back = samples.slice(i + 1, i + 13).find((x) => Math.abs(Number(x.close) / a - 1) < 0.01);
  if (back) jumps.push({ t: samples[i].t - t0, pct: ((b / a - 1) * 100).toFixed(1), src: samples[i].psrc, backMs: back.t - samples[i].t });
}
apart.sort((a, b) => a - b);
const last = samples[samples.length - 1];
console.log(`mint ${mint.slice(0, 8)} tf ${tf}s window ${seconds}s: ${samples.length} samples, ${trades.length} chain trades, ${pushes.size} pushed trades, ${last.polls} polls, rows ${last.n}, source "${last.src}"`);
console.log(`chart newest candle behind now: max ${maxBehind.toFixed(1)}s; stalls while trading: ${stalls.length}${stalls.length ? " -> " + stalls.map((x) => `${((x.to - x.from) / 1000).toFixed(1)}s (${x.behind.toFixed(0)}s behind)`).join(", ") : ""}`);
console.log(`jumps that reverted: ${jumps.length}${jumps.length ? " -> " + jumps.slice(0, 8).map((j) => `+${(j.t / 1000).toFixed(0)}s ${j.pct}% via ${j.src} back in ${j.backMs}ms`).join(", ") : ""}`);
console.log(`header vs chart close: median ${apart[Math.floor(apart.length / 2)]?.toFixed(2)}% p95 ${apart[Math.floor(apart.length * 0.95)]?.toFixed(2)}%`);
if (errs.size) console.log("poll errors:", [...errs].join(" | "));
if (errors.length) console.log("page errors:", [...new Set(errors)].slice(0, 5).join(" | "));
// How long after each chain trade the chart's close reached it (within 0.5%).
const lags = [];
for (const x of trades) { if (!(x.mcUsd > 0)) continue; const hit = samples.find((s) => s.t >= x.t && Math.abs(Number(s.close) / x.mcUsd - 1) < 0.005); if (hit) lags.push(hit.t - x.t); }
lags.sort((a, b) => a - b);
console.log(`trade -> chart lag: matched ${lags.length}/${trades.length}, p50 ${lags[Math.floor(lags.length / 2)] ?? "-"} ms, p90 ${lags[Math.floor(lags.length * 0.9)] ?? "-"} ms`);
// One line a log can grep: a bad run has stalls, reverting jumps, poll errors or a slow median.
const bad = stalls.length || jumps.length || errs.size || (lags.length >= 5 && lags[Math.floor(lags.length / 2)] > 2000);
console.log(`PROBE ${bad ? "BAD" : "OK"} ${new Date().toISOString()} mint=${mint.slice(0, 8)} tf=${tf} stalls=${stalls.length} jumps=${jumps.length} errs=${errs.size} lagp50=${lags[Math.floor(lags.length / 2)] ?? "-"} behindMax=${maxBehind.toFixed(1)} trades=${trades.length}`);
