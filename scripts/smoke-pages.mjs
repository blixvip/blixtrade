// The deploy's last check (bin/deploy-vm.mjs): runs ON THE SERVER, before a new index.html goes live. Opens the
// main pages in headless Chrome with /app answered by the NEW page (the staged index.html.new) and everything else
// (its scripts, the API) by the live server, and fails if any page throws, shows "This page did not load", or
// stays blank. A failure leaves the old page in place, so live users never get a build that crashes
// (Pulse threw "cn is not defined" for 6 users on 2026-10-10 16:38 UTC before this existed).
//
//   node smoke-pages.mjs /opt/blix/web/dist/index.html.new      exit 0 = every page fine, 1 = something broke
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire("/opt/blix/scripts/x.js");
const pw = require("playwright");
const staged = process.argv[2];
const BASE = "http://127.0.0.1:4421";
const html = fs.readFileSync(staged);

// A live coin for the coin page: the busiest migrated one Pulse shows now.
let mint = null;
try { const j = await (await fetch(`${BASE}/api/pulse`)).json(); mint = j.migrated?.[0]?.mint || j.newPairs?.[0]?.mint || null; } catch {}
// [route, least text the page shows once it has drawn]. Slow data is not a failure (a page still loading shows
// its own words); only a crash or a blank page is.
const PAGES = [["", 300], ["coins", 200], ["feed", 100], ["narratives", 60], ["ai-picks", 60], ["traders", 60], ["account", 40], ["settings", 8], ["practice", 40],
  ...(mint ? [[`coin/${mint}`, 300]] : [])];

const b = await pw.chromium.launch({ headless: true });
const bad = [];
async function check([route, least]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
  p.on("console", (m) => { if (m.type() === "error" && /^Blix .*error/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await ctx.route(/\/app(\?[^#]*)?$/, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }));
  try {
    await p.goto(`${BASE}/app#/${route}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    let text = "";
    for (let t = 0; t < 15 && !errs.length; t++) {
      await p.waitForTimeout(1000);
      text = (await p.evaluate(() => (document.querySelector("main") || document.body).innerText)).replace(/\s+/g, " ").trim();
      if (t >= 5 && text.length >= least) break;
    }
    if (/This page did not load/.test(text)) errs.push("shows 'This page did not load'");
    if (text.length < least) errs.push(`blank (${text.length} characters)`);
  } catch (e) { errs.push(`did not open: ${e.message.slice(0, 120)}`); }
  if (errs.length) bad.push(`#/${route.slice(0, 20)}: ${[...new Set(errs)].slice(0, 3).join(" | ")}`);
  await ctx.close();
}
// Two pages at a time (~40 s): headless Chrome shares the server's 4 cores with the live site.
for (let i = 0; i < PAGES.length; i += 2) await Promise.all(PAGES.slice(i, i + 2).map(check));
await b.close();
if (bad.length) { console.log(`SMOKE FAILED\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log(`SMOKE OK (${PAGES.length} pages)`);
