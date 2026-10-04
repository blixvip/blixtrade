// Renders the social preview images (1200x630) and the favicons for the public docs pages into
// worker/public/_pub. Run after changing a page title: `node worker/og/render.mjs`.
// Needs Playwright with Chromium: set PLAYWRIGHT_PATH, or have `playwright` resolvable.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "public", "_pub");
const ICON_SVG = readFileSync(join(here, "..", "..", "public", "icon.svg"), "utf8");
const require = createRequire(import.meta.url);
const tryReq = (...ids) => { for (const id of ids) { try { return require(id); } catch {} } return null; };
const pw = tryReq(process.env.PLAYWRIGHT_PATH || "playwright", "playwright-core",
  join(here, "../../../meme-maker/node_modules/playwright-core"), join(here, "../../../note-overlay/node_modules/playwright"));
if (!pw) throw new Error("Set PLAYWRIGHT_PATH to an existing Playwright installation.");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// [file, eyebrow, title, subtitle, terminal lines]; a line starting with "$" is a command, "#" a comment.
const CARDS = [
  ["og-api.png", "Blix API", "The free Solana memecoin API", "pump.fun launches, live trades, holders, snipers, bundles, candles and quotes. No API key.",
    ["$ curl localhost:4420/api/pulse", '{ "newPairs": [{', '    "symbol": "J", "mcap": 4592,', '    "progress": 0.188,', '    "hl": { "sn": 0, "bd": 0.09 }', "  }], ... }"]],
  ["og-mcp.png", "Blix MCP", "Solana memecoin MCP server", "20 tools for Claude, Cursor and Codex: live pump.fun data, holders, quotes, AI reads.",
    ["$ claude mcp add blix -- \\", "    node blix-mcp.mjs", "", "blix_pulse      blix_holders", "blix_candles    blix_quote", "blix_research   blix_paper_buy"]],
  ["og-gmgn.png", "GMGN API", "GMGN API, and a free alternative", "What GMGN's key covers, and the same memecoin data from Blix with no key at all.",
    ["# GMGN-style data, no key", "$ curl localhost:4420/api/holders/\\", "    <mint>", '{ "dev":     { "sold": "all" },', '  "snipers": { "pct": 0 },', '  "bundle":  { "n": 3, "pct": 0.09 },', '  "top10": 12.49 }']],
  ["og-axiom.png", "Axiom Trade API", "Axiom Trade API: is there one?", "No public API. Axiom-style Pulse data as free, open-source JSON instead.",
    ["# Axiom-style Pulse as JSON", "$ curl localhost:4420/api/pulse", "", "newPairs   stretch", "migrated   running", "+ live stream: /api/stream"]],
  ["og-fomo.png", "Fomo API", "Fomo API: is there an official one?", "No public API. Follow Fomo traders' wallets from the chain for free with Blix.",
    ["# Fomo traders, from chain", "$ curl localhost:4420/api/fomo", "", "# a trader's swaps and PnL", "$ curl localhost:4420/api/wallet/\\", "    <wallet>"]],
  ["og-pump.png", "pump.fun API", "Free pump.fun API", "Every launch in about a second, trades from chain, bonding progress, holders. No key.",
    ["# every pump.fun launch, live", "$ curl -N localhost:4420/api/stream", "", "event: launch", 'data: { "symbol": "J",', '        "mint": "9Vin...pump" }']],
];

const page = ([, eyebrow, title, sub, lines]) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600&family=JetBrains+Mono:wght@400;500&display=block" rel="stylesheet">
<style>
:root{--paper:oklch(15.5% .008 258);--paper-3:oklch(19.5% .010 258);--rule:oklch(25% .012 258);--rule-2:oklch(33% .014 258);--ink:oklch(93% .006 258);--ink-2:oklch(76% .012 258);--muted:oklch(67% .014 258);--accent:oklch(70% .15 255);--up:oklch(74% .15 160)}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:var(--paper);color:var(--ink);font-family:system-ui,"Segoe UI",sans-serif;padding:64px 72px;display:grid;grid-template-rows:auto 1fr auto;overflow:hidden}
.top{display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:14px;font:600 34px/1 "Space Grotesk";letter-spacing:-.02em}
.brand svg{width:48px;height:48px}
.host{font:500 22px/1 "JetBrains Mono";color:var(--muted)}
.mid{display:grid;grid-template-columns:1fr 470px;gap:40px;align-items:center}
.eyebrow{font-size:20px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:18px}
h1{font:600 62px/1.06 "Space Grotesk";letter-spacing:-.025em;margin-bottom:22px}
p{font-size:25px;line-height:1.4;color:var(--ink-2)}
.term{background:var(--paper-3);border:1.5px solid var(--rule-2);border-radius:14px;padding:24px 26px;font:400 18px/1.7 "JetBrains Mono";color:var(--ink-2);white-space:pre;overflow:hidden}
.term .c{color:var(--ink)}.term .c b{color:var(--up);font-weight:500}.term .m{color:var(--muted)}
.foot{display:flex;gap:12px}
.chip{font-size:20px;font-weight:600;color:var(--ink);border:1.5px solid var(--rule-2);border-radius:8px;padding:9px 16px}
</style></head><body>
<div class="top"><div class="brand">${ICON_SVG.replace(/<\?xml[^>]*>/, "")}<span>Blix</span></div><div class="host">trade.blixvip.com</div></div>
<div class="mid"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
<div class="term">${lines.map((l) => l.startsWith("$") ? `<div class="c"><b>$</b>${esc(l.slice(1))}</div>` : l.startsWith("#") ? `<div class="m">${esc(l)}</div>` : `<div>${esc(l) || "&nbsp;"}</div>`).join("")}</div></div>
<div class="foot"><span class="chip">Free</span><span class="chip">Open source (MIT)</span><span class="chip">No API key</span></div>
</body></html>`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon.svg"), ICON_SVG);
const browser = await pw.chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const tab = await ctx.newPage();
  for (const card of CARDS) {
    await tab.setContent(page(card), { waitUntil: "networkidle" });
    await tab.evaluate(() => document.fonts.ready);
    writeFileSync(join(OUT, card[0]), await tab.screenshot({ type: "png" }));
    console.log("wrote", card[0]);
  }
  for (const size of [96, 180, 512]) {
    await tab.setViewportSize({ width: size, height: size });
    await tab.setContent(`<!doctype html><style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${ICON_SVG}`);
    writeFileSync(join(OUT, `icon-${size}.png`), await tab.screenshot({ type: "png", omitBackground: true }));
    console.log("wrote", `icon-${size}.png`);
  }
} finally { await browser.close(); }
