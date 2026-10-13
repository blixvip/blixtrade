// blixvip.com/devs: the Top devs board in public, no account needed (the user, 2026-10-12: "open the dev wallets list
// to the public"). The wallets whose coins did best in the last day, week or month, ranked by the creator fees their
// coins earned, with their launches, bonds and best coin. Read from the server (server/devboard.js) through the edge
// key, kept at the edge for a minute per range, and rendered here as a plain page anyone (and any crawler) can read.
import { layout, esc } from "./html.js";

const RANGES = [["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"]];
const ROWS = 100;
const edgeKey = (env) => (env.EDGE_KEY ? { "x-blix-edge": env.EDGE_KEY } : {});
let originAt = { origin: null, t: 0 };
async function fromServer(env, path) {
  if (!originAt.origin || Date.now() - originAt.t > 60_000) originAt = { origin: await env.REG.get("origin", { cacheTtl: 60 }), t: Date.now() };
  if (!originAt.origin) throw new Error("no origin");
  const r = await fetch(new URL(path, originAt.origin), { headers: { ...edgeKey(env), accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
const cacheKey = (range) => new Request(`https://blix-devs/v1/${range}`);
async function board(env, range) {
  const hit = await caches.default.match(cacheKey(range)).catch(() => null);
  if (hit) return hit.json();
  const v = await fromServer(env, `/api/edge/devs?range=${range}`);
  await caches.default.put(cacheKey(range), new Response(JSON.stringify(v), { headers: { "cache-control": "public, max-age=60" } })).catch(() => {});
  return v;
}

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const pic = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : "");
const short = (w) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const usd = (n) => (!(n > 0) ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`);
const sol = (n) => (!(n > 0) ? "—" : n >= 100 ? `${Math.round(n)} SOL` : `${n.toFixed(n >= 10 ? 1 : 2)} SOL`);
const pct = (n) => (n == null || !isFinite(n) ? "—" : `${Math.round(n * 100)}%`);
const ago = (t) => {
  if (!t) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

function devCell(d) {
  if (!MINT.test(d.wallet || "")) return "—";
  const face = pic(d.pic);
  const name = d.name ? esc(String(d.name).slice(0, 32)) : `<code>${short(d.wallet)}</code>`;
  return `<span class="dev">${face ? `<img src="${esc(face)}" width="28" height="28" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : `<span class="dev-dot" aria-hidden="true"></span>`}`
    + `<span><a href="https://pump.fun/profile/${d.wallet}" rel="noopener nofollow" target="_blank">${name}</a>`
    + `<small><a href="https://solscan.io/account/${d.wallet}" rel="noopener nofollow" target="_blank" title="${d.wallet}">${d.name ? short(d.wallet) : "Solscan"}</a>`
    + `${d.serial ? " · serial" : ""}</small></span></span>`;
}
function coinCell(c) {
  if (!c || !MINT.test(c.mint || "")) return "—";
  const face = pic(c.image);
  const sym = esc(String(c.symbol || c.name || short(c.mint)).slice(0, 16));
  return `<span class="dev">${face ? `<img src="${esc(face)}" width="24" height="24" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}`
    + `<span><a href="https://pump.fun/coin/${c.mint}" rel="noopener nofollow" target="_blank">$${sym}</a>`
    + `<small>peak ${usd(c.peak)}${c.bonded ? " · bonded" : ""}${c.dead ? " · dead" : ""}</small></span></span>`;
}

function render(range, data, failed) {
  const label = RANGES.find(([k]) => k === range)?.[1] || "24 hours";
  const tabs = `<nav class="dev-tabs" aria-label="Time range">${RANGES.map(([k, l]) => `<a href="/devs${k === "24h" ? "" : `?range=${k}`}"${k === range ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>`;
  const rows = (data?.top || []).slice(0, ROWS);
  const table = rows.length ? `<div class="table-wrap"><table class="devs"><thead><tr>
<th scope="col">#</th><th scope="col">Dev wallet</th><th scope="col">Creator fees</th><th scope="col">Launches</th><th scope="col">Bonded</th><th scope="col">Bond rate</th><th scope="col">Best coin</th><th scope="col">Last launch</th></tr></thead><tbody>
${rows.map((d) => `<tr><td>${Number(d.rank) || ""}</td><td>${devCell(d)}</td><td><b>${sol(d.feesSol)}</b><small>${usd(d.feesUsd)}</small></td><td>${Number(d.launches) || 0}</td><td>${Number(d.bonded) || 0}</td><td>${pct(d.bondRate)}</td><td>${coinCell(d.best)}</td><td>${ago(d.latest)}</td></tr>`).join("\n")}
</tbody></table></div>`
    : `<p class="note">${failed ? "The live board is taking a moment to load. Refresh in a few seconds." : "No dev has a coin on the board in this window yet."}</p>`;
  const summary = data && !failed
    ? `<p class="meta-line">${(data.devs || 0).toLocaleString("en-US")} dev wallets launched ${(data.launches || 0).toLocaleString("en-US")} coins in the last ${label}. Showing the top ${rows.length}, updated ${ago(data.t)}.</p>` : "";
  const body = `<h2 id="board">Top pump.fun devs · last ${label}</h2>
${tabs}
${summary}
${table}
<h2 id="how">How the board is ranked</h2>
<p>Every pump.fun launch BLIX hears is tied to the wallet that created it. A dev's rank is the creator fees their coins earned in the window: pump.fun pays the creator a share of every trade, so the coins that actually traded made their dev the most. Ties go to the dev whose best coin reached the higher market cap. Wallets that launch dozens of coins and bond none are left out.</p>
<p>Bond rate is the share of a dev's launches in the window that filled their bonding curve and moved to a PumpSwap pool. A dev's name and picture come from their pump.fun profile when they have one.</p>
<style>.dev-tabs{display:flex;gap:6px;margin:6px 0 12px}.dev-tabs a{padding:6px 12px;border:1px solid #2a2d33;border-radius:999px;text-decoration:none}.dev-tabs a[aria-current]{background:#f2f3f5;color:#050608;border-color:#f2f3f5}
table.devs td{vertical-align:middle;white-space:nowrap}table.devs small{display:block;opacity:.65;font-size:12px}.dev{display:flex;align-items:center;gap:8px}.dev img{border-radius:50%;object-fit:cover;flex:none}.dev-dot{width:28px;height:28px;border-radius:50%;background:#1d2026;flex:none}.meta-line{opacity:.75}</style>`;
  return layout({
    path: "/devs", crumb: "Top devs", og: "home/og.jpg", title: `Top pump.fun devs (last ${label}) · dev wallet leaderboard | BLIX`,
    h1: "Top pump.fun dev wallets", lede: "The creators whose coins earned the most in the last day, week or month: every launch, bond and best coin, live from BLIX.",
    description: `The top pump.fun dev wallets of the last ${label}, ranked by the creator fees their coins earned, with launches, bond rate and each dev's best coin. Free, no account needed.`,
    body, related: ["/tools"],
  });
}

export async function devsPage(req, env, url) {
  if (url.pathname !== "/devs" || (req.method !== "GET" && req.method !== "HEAD")) return null;
  const asked = url.searchParams.get("range") || "24h";
  const range = RANGES.some(([k]) => k === asked) ? asked : "24h";
  let data = null, failed = false, why = "";
  try { data = await board(env, range); } catch (e) { failed = true; why = String(e?.message || e).slice(0, 80); }
  return new Response(render(range, data, failed), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": failed ? "no-store" : "public, max-age=60", "x-content-type-options": "nosniff", ...(failed ? { "x-blix-devs-error": why.replace(/[^ -~]/g, "") } : {}) },
  });
}
