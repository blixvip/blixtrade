// Opens every page of the terminal in a real browser and reports what is broken or slow:
//   node scripts/sitesweep.mjs [base=http://127.0.0.1:4421] [--mobile]
// Per page: script errors, console errors, failed requests (>= 400; coin logos that 404 are counted apart, they
// are normal for brand-new coins), ms until the page mounted, how much the page drew (elements in <main>), and
// any error text on screen ("went wrong", "failed", "error"). One line a log can grep at the end: SWEEP OK|BAD.
// Run it on the VM (/opt/blix): local page server, owner view.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let pw; try { pw = require("playwright"); } catch { pw = require("C:/code/note-overlay/node_modules/playwright"); }

const args = process.argv.slice(2);
const mobile = args.includes("--mobile");
const base = args.find((a) => !a.startsWith("--")) || "http://127.0.0.1:4421";
let mint = null, handle = null;
try { const d = await (await fetch(`${base}/api/pulse`)).json(); mint = (d.running?.[0] || d.migrated?.[0] || d.newPairs?.[0])?.mint; } catch {}
try { const t = await (await fetch(`${base}/api/fomo/board`)).json(); handle = (t.traders || t.list || t.board || [])[0]?.handle || null; } catch {}

const routes = ["", "coins", "feed", "narratives", "traders", "x", "launch", "account", "settings", "health", "api", "mcp",
  ...(mint ? [`coin/${mint}`] : []), ...(handle ? [`trader/${encodeURIComponent(handle)}`] : [])];
const browser = await pw.chromium.launch({ channel: "chrome", headless: true }).catch(() => pw.chromium.launch({ headless: true }));
const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } });
// Warm the browser cache once, as a returning visitor would have it.
{ const p = await ctx.newPage(); await p.goto(`${base}/app#/`, { waitUntil: "load" }).catch(() => {}); await p.close(); }
let bad = 0;
for (const r of routes) {
  const page = await ctx.newPage();
  const errs = [], fails = [], logos = { n: 0 };
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    const u = res.url().replace(base, "");
    if (/^\/img\//.test(u) && res.status() === 404) { logos.n++; return; }
    fails.push(`${res.status()} ${u.slice(0, 90)}`);
  });
  const t0 = Date.now();
  await page.goto(`${base}/app#/${r}`, { waitUntil: "load", timeout: 30000 }).catch((e) => errs.push("goto: " + e.message.slice(0, 100)));
  await page.waitForFunction(() => performance.getEntriesByName("blix:mounted").length > 0, null, { timeout: 15000 }).catch(() => errs.push("never mounted"));
  const mounted = await page.evaluate(() => Math.round(performance.getEntriesByName("blix:mounted")[0]?.startTime || -1));
  await page.evaluate(() => new Promise((ok) => setTimeout(ok, 3500)));
  const seen = await page.evaluate(() => {
    const main = document.querySelector("main");
    const text = (main?.innerText || "").replace(/\s+/g, " ");
    const errText = (text.match(/[^.]{0,60}(went wrong|failed to|error|couldn.t load|is offline|not available)[^.]{0,40}/i) || [])[0] || null;
    return { els: main ? main.querySelectorAll("*").length : 0, chars: text.length, errText, url: location.hash };
  });
  // Pages whose text is other people's words or reports by design (tweets, the API docs' "Errors" chapter, the
  // Health page naming what is down): on-screen error words there are content, not a broken page. The account page
  // of a browser that never signed in is the short sign-in card.
  const textOk = /^(x|api|mcp|health)$/.test(r), signIn = r === "account" && !seen.errText && seen.chars < 200;
  const wrong = errs.length || fails.length || (seen.els < 30 && !signIn) || (seen.errText && !textOk);
  if (wrong) bad++;
  console.log(`${wrong ? "BAD" : "ok "} #/${r.slice(0, 40).padEnd(40)} mounted ${String(mounted).padStart(5)}ms  wall ${String(Date.now() - t0).padStart(5)}ms  els ${String(seen.els).padStart(5)}  chars ${String(seen.chars).padStart(6)}  logos404 ${logos.n}${seen.url !== `#/${r}` ? `  -> ${seen.url}` : ""}`);
  for (const e of errs) console.log(`      err  ${e}`);
  for (const f of fails) console.log(`      http ${f}`);
  if (seen.errText) console.log(`      text "${seen.errText.trim()}"`);
  await page.close();
}
await browser.close();
console.log(`SWEEP ${bad ? "BAD" : "OK"} ${new Date().toISOString()} ${mobile ? "mobile" : "desktop"} pages=${routes.length} bad=${bad}`);
