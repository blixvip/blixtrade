// Per-page dates for structured data and the sitemap (site/dates.json): `published` is set the first time a page
// is seen and never changes; `modified` moves only when the page's own content (body, title, lede, FAQ) changes.
// Run before a deploy:  node site/stamp.mjs        (node site/stamp.mjs --check only reports)
import fs from "node:fs";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
const { PAGES } = await import("./pages.js");
const FILE = new URL("./dates.json", import.meta.url);
const today = new Date().toISOString().slice(0, 10);
const dates = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { home: {}, pages: {} };
// Hash the words a reader sees, not the markup: a template or attribute change must not move dateModified.
const text = (v) => String(v == null ? "" : typeof v === "object" ? JSON.stringify(v) : v).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const hash = (p) => crypto.createHash("sha1").update(JSON.stringify([text(p.h1), text(p.lede), text(p.body), p.faq ? text(p.faq) : null])).digest("hex").slice(0, 16);
const check = process.argv.includes("--check");
let changed = 0, added = 0;
for (const [path, p] of Object.entries(PAGES)) {
  const h = hash(p), d = dates.pages[path];
  if (!d) { dates.pages[path] = { published: today, modified: today, hash: h }; added++; }
  else if (d.hash !== h) { d.modified = today; d.hash = h; changed++; }
}
for (const path of Object.keys(dates.pages)) if (!PAGES[path]) delete dates.pages[path];
// The homepage is a static file: its dates come from git.
const landing = new URL("./landing.html", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
try {
  const log = execSync(`git log --format=%as -- "${landing}"`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  dates.home = { published: dates.home.published || log[log.length - 1] || today, modified: log[0] || today };
} catch { dates.home = { published: dates.home.published || today, modified: dates.home.modified || today }; }
if (!check) fs.writeFileSync(FILE, JSON.stringify(dates, null, 1) + "\n");
console.log(`${Object.keys(dates.pages).length} pages: ${added} new, ${changed} changed${check ? " (not written)" : ""}; home modified ${dates.home.modified}`);
