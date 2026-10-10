// A browser for the readers that need one: Fomo (fomolists.js, fomofeed.js, fomoboard.js) and X (xtrack.js) only
// answer a signed-in browser, so Blix reads them from inside a tab. Each reader writes a small script in the
// Aside REPL's terms (listBrowserTabs, attachBrowserTab, openTab, page.evaluate, console.log of one JSON line)
// and hands it here. On the owner's PC the script runs in Aside, the browser they are signed in with, exactly as
// before. Anywhere without Aside (the server, Linux) it runs in a headless Chromium kept here (Playwright, a
// profile under data/browser), with the same four functions, so the readers do not know the difference.
//
// The headless browser keeps one fomo.family tab open from its first use; a script's openTab() of any fomo.family
// address gets that tab (its Fomo fetch works from any page there), so a read is one evaluate() rather than a
// page load, and the tab stays signed in as long as its Fomo login does. The login is put there once with
// bin/fomo-session.mjs (copied from the owner's Aside). X is not kept: its login cannot be copied, so the X
// tracker falls back to FxTwitter where there is no Aside (xtrack.js already does).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./db.js";

export const ASIDE_EXE = path.join(process.env.LOCALAPPDATA || "", "Aside", "CLI", "current", "aside.exe");
export const hasAside = () => process.platform === "win32" && fs.existsSync(ASIDE_EXE);
// Is there a browser to read with at all: Aside here, else our own (needs the playwright package: installed on the server).
let playwrightHere = null;
export const canBrowse = () => hasAside() || (playwrightHere ??= (() => { try { import.meta.resolve("playwright"); return true; } catch { return false; } })());
const now = () => Date.now();
// What to tell the owner when Fomo answers 401: where the login lives depends on which browser is reading.
export const signedOutText = () => hasAside() ? "Aside is signed out of Fomo. Sign in at fomo.family in Aside, then refresh."
  : "The server's Fomo login has run out. On the PC: node bin/fomo-session.mjs export, copy data/fomo-session.json to the server, there: node bin/fomo-session.mjs import data/fomo-session.json, then restart blix.";
export const browserStats = { mode: hasAside() ? "aside" : "headless", runs: 0, failed: 0, lastError: null, up: false, tabs: 0, since: null };

// Runs one reader script and returns the JSON object it printed (the last line starting with `{"<marker>"`).
export function runRepl(script, { marker, timeoutMs = 115_000, what = "Fomo" }) {
  browserStats.runs++;
  const p = hasAside() ? inAside(script, marker, timeoutMs, what) : inHeadless(script, marker, timeoutMs, what);
  return p.catch((e) => { browserStats.failed++; browserStats.lastError = e.message; throw e; });
}

// ---------- the owner's PC: Aside ----------
function inAside(script, marker, timeoutMs, what) {
  return new Promise((resolve, reject) => {
    const code = `await eval("(async () => {" + atob("${Buffer.from(script, "utf8").toString("base64")}") + "})()");`;
    const child = spawn(ASIDE_EXE, ["repl", code], { windowsHide: true });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error(`Aside took too long reading ${what}.`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith(`{"${marker}"`));
      if (!line) return reject(new Error((out + err).replace(/\x1b\[[0-9;]*m/g, "").trim().slice(0, 300) || "No answer from Aside."));
      try { resolve(JSON.parse(line)); } catch { reject(new Error("Aside's answer could not be read.")); }
    });
  });
}

// ---------- anywhere else: a headless Chromium of our own ----------
export const PROFILE = path.join(DATA, "browser");
// The kept Fomo tab sits on an app page (/token), not the landing page: only there does Fomo mount its Privy
// sign-in layer, which is what renews the session token every hour (fomochart.js reads it). On the landing page
// the token ran out after an hour (2026-10-07).
const KEEP = { "fomo.family": "https://fomo.family/token?blix=fomo" };   // one tab per site, kept open
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
let ctx = null, starting = null;
const kept = new Map();   // hostname -> page

// Chromium, started on first use and shared by every reader. Small: one renderer per site, no GPU, no extensions.
export async function browser() {
  if (ctx) return ctx;
  if (starting) return starting;
  starting = (async () => {
    const { chromium } = await import("playwright");
    fs.mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
    const c = await chromium.launchPersistentContext(PROFILE, {
      headless: true, userAgent: UA, viewport: { width: 1280, height: 900 }, locale: "en-US",
      args: ["--disable-gpu", "--disable-dev-shm-usage", "--disable-extensions", "--mute-audio", "--no-first-run", "--renderer-process-limit=1", "--disable-background-networking", "--no-sandbox"],
    });
    c.setDefaultTimeout(30_000);
    // The reads want the sites' data, never their pictures, fonts or video: those are not fetched at all. (The
    // server has one core and shares it with the radar.)
    await c.route("**/*", (route) => { const t = route.request().resourceType(); return t === "image" || t === "media" || t === "font" ? route.abort() : route.continue(); });
    c.on("close", () => { ctx = null; kept.clear(); light.clear(); browserStats.up = false; });
    ctx = c; browserStats.up = true; browserStats.since = now();
    return c;
  })().finally(() => { starting = null; });
  return starting;
}

// The kept tab for a site, opened the first time it is asked for. Between reads it is frozen (Chrome's page
// lifecycle: no timers, no animation, no re-rendering of a live page), which is most of what a tab left open
// costs; it is woken for a read and frozen again half a minute after the last one.
const FREEZE_AFTER = 30_000;
const life = new Map();   // page -> { cdp, timer, frozen }
async function awake(page) {
  let l = life.get(page);
  if (!l) { l = { cdp: null, timer: null, frozen: false }; life.set(page, l); try { l.cdp = await page.context().newCDPSession(page); } catch { l.cdp = null; } }
  clearTimeout(l.timer);
  if (l.frozen && l.cdp) { try { await l.cdp.send("Page.setWebLifecycleState", { state: "active" }); } catch {} l.frozen = false; }
  l.timer = setTimeout(() => freeze(page), FREEZE_AFTER);
  l.timer.unref?.();
}
async function freeze(page) {
  const l = life.get(page);
  if (!l || page.isClosed() || !l.cdp || l.frozen) return;
  clearTimeout(l.timer);
  try { await l.cdp.send("Page.setWebLifecycleState", { state: "frozen" }); l.frozen = true; } catch {}
}
// Every kept tab frozen right away (after a script has run), not half a minute later.
export const freezeAll = () => Promise.all([...kept.values()].map((p) => freeze(p)));
async function keptTab(host) {
  const c = await browser();
  let page = kept.get(host);
  if (page && !page.isClosed()) { await awake(page); return page; }
  page = await c.newPage();
  // A crashed renderer (out of memory) leaves a page that is not "closed" but answers every call with "Target
  // page ... has been closed": it is dropped so the next read opens a fresh tab (2026-10-10: the Feed sat on a
  // dead tab for minutes).
  const p = page;
  p.on("crash", () => { if (kept.get(host) === p) kept.delete(host); life.delete(p); p.close().catch(() => {}); });
  await page.emulateMedia({ reducedMotion: "reduce" }).catch(() => {});
  await page.goto(KEEP[host], { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  kept.set(host, page);
  await awake(page);
  return page;
}
// A second kept tab on the same site, on a page with no app in it (robots.txt): same origin, so the same sign-in
// (localStorage, cookies) the kept tab renews, but none of the site's code running. Reads made every second from
// the full app tab kept its renderer at ~80% of a core and made each read take 1-9 s (Feed, 2026-10-10).
const light = new Map();   // hostname -> page
async function lightTab(host, url) {
  const c = await browser();
  let page = light.get(host);
  if (page && !page.isClosed()) return page;
  page = await c.newPage();
  const p = page;
  p.on("crash", () => { if (light.get(host) === p) light.delete(host); p.close().catch(() => {}); });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  light.set(host, page);
  return page;
}
// The page's own address, for listBrowserTabs: pages come with an id, which the readers pass back to attach.
const ids = new WeakMap();
let nextId = 1;
const idOf = (page) => { let id = ids.get(page); if (!id) { id = String(nextId++); ids.set(page, id); } return id; };
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };

async function inHeadless(script, marker, timeoutMs, what) {
  const c = await browser();
  const opened = [], lines = [];
  const api = {
    sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)),
    listBrowserTabs: async () => c.pages().filter((p) => !p.isClosed()).map((p, i) => ({ targetId: idOf(p), id: `tab:${idOf(p)}`, url: p.url(), active: i === 0 })),
    attachBrowserTab: async (id) => {
      const want = String(id).replace(/^tab:/, "");
      const p = c.pages().find((x) => idOf(x) === want);
      if (!p || p.isClosed()) throw new Error("No such tab.");
      if ([...kept.values()].includes(p)) await awake(p);
      return p;
    },
    // A site this browser keeps a tab for is read from that tab (already loaded, already signed in).
    openTab: async (url) => {
      const host = hostOf(url);
      if (KEEP[host] && /\/robots\.txt$/.test(url)) return lightTab(host, url);
      if (KEEP[host]) return keptTab(host);
      const p = await c.newPage();
      opened.push(p);
      await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      return p;
    },
    closeTab: async (p) => { try { await p.close(); } catch {} },
    console: { log: (...a) => lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")), error: () => {}, warn: () => {} },
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction(...Object.keys(api), script);
  let timer;
  try {
    await Promise.race([
      fn(...Object.values(api)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`The browser took too long reading ${what}.`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
    for (const p of opened) { try { await p.close(); } catch {} }
    browserStats.tabs = c.pages().length;
    await freezeAll();   // a tab left running between reads is most of what the browser costs
  }
  const line = lines.reverse().find((l) => l.trim().startsWith(`{"${marker}"`));
  if (!line) throw new Error("No answer from the browser.");
  return JSON.parse(line);
}

// What the health page shows for this part.
export const browserState = () => ({ ...browserStats, keptTabs: [...kept.keys()] });
