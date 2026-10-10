// Moves the owner's fomo.family login into the server's own browser (server/browser.js), so the server reads
// Fomo without the owner's PC. Fomo signs in through Privy, which keeps the login in the page's localStorage
// (privy:token, privy:refresh_token...) and two cookies; the browser keeps refreshing it from there.
//
//   node bin/fomo-session.mjs export            on the PC: reads the login out of Aside -> data/fomo-session.json
//   node bin/fomo-session.mjs import <file>     on the server: puts it into the headless browser's profile, checks
//                                               Fomo answers, then deletes the file
//
// The file is the login: copy it only to the server, and only with scp. It is written with mode 600.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, arg] = process.argv.slice(2);
const DEFAULT = path.join(ROOT, "data", "fomo-session.json");

// What runs inside the Fomo tab, either way: the login is the privy:* keys and the two privy cookies.
const DUMP = `
  const ls = {};
  for (const k of Object.keys(localStorage)) if (/^privy[:-]/.test(k)) ls[k] = localStorage.getItem(k);
  const cookies = Object.fromEntries(document.cookie.split(";").map((c) => c.trim()).filter(Boolean).map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)]).filter(([k]) => /^privy/.test(k)));
  return { ls, cookies, href: location.href };`;

if (cmd === "export") {
  const { runRepl, hasAside } = await import("../server/browser.js");
  if (!hasAside()) { console.error("Aside is not on this PC; run this where the owner is signed in to Fomo."); process.exit(1); }
  const script = `
const tabs = (await listBrowserTabs()).filter((t) => String(t.url).startsWith("https://fomo.family/"));
let pg = null;
for (const t of tabs.slice(0, 3)) { try { pg = await attachBrowserTab(t.targetId); break; } catch (e) {} }
if (!pg) pg = await openTab("https://fomo.family/?blix=fomo");
await new Promise((r) => setTimeout(r, 2500));
const got = await pg.evaluate(() => { ${DUMP} });
console.log(JSON.stringify({ session: 1, ...got }));`;
  const got = await runRepl(script, { marker: "session", timeoutMs: 60_000, what: "Fomo" });
  if (!got.ls?.["privy:token"] || !got.ls?.["privy:refresh_token"]) { console.error("Fomo is not signed in in Aside (no Privy login found). Sign in at fomo.family there first."); process.exit(1); }
  fs.mkdirSync(path.dirname(DEFAULT), { recursive: true });
  fs.writeFileSync(DEFAULT, JSON.stringify({ t: Date.now(), ls: got.ls, cookies: got.cookies }), { mode: 0o600 });
  console.log(`Fomo login written to ${DEFAULT} (${Object.keys(got.ls).length} keys, ${Object.keys(got.cookies).length} cookies). Copy it to the server with scp and run: node bin/fomo-session.mjs import data/fomo-session.json`);
} else if (cmd === "import") {
  const file = path.resolve(arg || DEFAULT);
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!j.ls?.["privy:token"]) { console.error("That file has no Fomo login in it."); process.exit(1); }
  // The login goes into the server's own browser profile (data/browser). While blix runs, that profile is open in
  // its Chromium and a second one would write somewhere the server never looks: stop blix first.
  try {
    const { execSync } = await import("node:child_process");
    if (execSync("systemctl is-active blix 2>/dev/null || true").toString().trim() === "active") { console.error("Stop blix first, then import, then start it: sudo systemctl stop blix && node bin/fomo-session.mjs import " + (arg || DEFAULT) + "; sudo systemctl start blix"); process.exit(1); }
  } catch {}
  const { browser, PROFILE } = await import("../server/browser.js");
  const c = await browser();
  await c.addCookies(Object.entries(j.cookies || {}).map(([name, value]) => ({ name, value, url: "https://fomo.family/", secure: true, sameSite: "Lax" })));
  const page = await c.newPage();
  await page.goto("https://fomo.family/?blix=fomo", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.evaluate((ls) => { for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v); }, j.ls);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  // Does Fomo answer as a signed-in account? Its own fetch, the way the readers use it (fomolists.js).
  let ok = null;
  for (let i = 0; i < 20 && ok == null; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    ok = await page.evaluate(async () => {
      const man = JSON.stringify(window.__reactRouterManifest || {});
      const urls = [...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.querySelectorAll("link[rel=modulepreload],script[src]")].map((l) => l.href || l.src), ...(man.match(/\/assets\/[^"]+\.js/g) || [])];
      const ff = urls.find((n) => /\/fomoFetch-[^/]*\.js/.test(n));
      if (!ff) return null;
      const m = await import(ff);
      const fn = Object.values(m).find((v) => typeof v === "function" && /statusCode:401|Authorization|timing:[{]|timeoutMs/.test(String(v)));
      if (!fn) return { error: "Fomo's fetch function was not found." };
      try { const x = await fn("/proxy/trendingTokens", { method: "POST" }); return { status: x.statusCode, n: Array.isArray(x.responseObject) ? x.responseObject.length : null }; }
      catch (e) { return /Privy/i.test(String(e.message)) ? null : { error: e.message }; }
    });
  }
  // No answer either way (Fomo's app never came up in the browser): say what the page showed and keep the file.
  const seen = ok == null ? await page.evaluate(() => ({ title: document.title.slice(0, 60), body: (document.body?.innerText || "").slice(0, 100), scripts: document.querySelectorAll("script[src]").length, privyKeys: Object.keys(localStorage).filter((k) => /^privy/.test(k)).length })).catch(() => null) : null;
  await page.close();
  await c.close();
  if (ok?.status === 200) { fs.rmSync(file, { force: true }); console.log(`Signed in: Fomo answered with ${ok.n} trending coins. Login kept in ${PROFILE}; the file was deleted. Start blix to begin reading.`); }
  else if (ok == null) { console.error(`Could not tell: Fomo's app did not answer in the browser within 30 s ${JSON.stringify(seen)}. The login was written to ${PROFILE} anyway and the file was kept; start blix and check /api/fomo/list, or run the import again.`); process.exit(2); }
  else { fs.rmSync(file, { force: true }); console.error(`Fomo did not accept the login: ${JSON.stringify(ok)}. The file was deleted; export it again from a signed-in Aside.`); process.exit(1); }
} else {
  console.log("usage: node bin/fomo-session.mjs export | import <file>");
  process.exit(1);
}
