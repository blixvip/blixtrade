// Coin page (#/coin/<mint>): the full token page, laid out like Axiom's. A header with the live figures
// and quick paper buys; the candle chart with the dev's, snipers', bundles' and followed wallets' trades
// marked on it; tabs for trades, holders, top traders, early buyers, the dev's coins, paper positions,
// the AI read, signals and safety; and a right column with 5-minute flow, the paper trade panel, your
// position, token info, addresses and links.
// Data: /api/token/<mint> (stored detail), /api/coin/<mint> (live ledger) and /api/coin/<mint>/trades.
// Shared helpers (avatars, formatting, the paper desk) come from app.js as `ctx`. Styles: coin.css.
import { mountChart, mountPanel, refreshMarks } from "./trade.js";

const q = (s, el) => el.querySelector(s);
const PATHS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  star: '<path d="M12 4l2.3 4.9 5.3.6-3.9 3.7 1 5.3L12 15.9l-4.7 2.6 1-5.3-3.9-3.7 5.3-.6z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.4c1.8.9 3 2.9 3 5.6"/>',
  crown: '<path d="M4 18h16M4 18l-1-10 5 4 4-7 4 7 5-4-1 10"/>',
  chef: '<path d="M7 14a4 4 0 0 1-1-7.9A5 5 0 0 1 16 5a4 4 0 0 1 1 9M7 14v6h10v-6M7 17h10"/>',
  crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1"/>',
  ghost: '<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.5-2-2.2 2-2.3-2-2.3 2-2.2-2z"/><path d="M9.5 10.5h.01M14.5 10.5h.01"/>',
  boxes: '<rect x="8.5" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="13" width="7" height="7" rx="1.5"/><rect x="14" y="13" width="7" height="7" rx="1.5"/>',
  curve: '<circle cx="12" cy="12" r="9"/><path d="M12 12V3M12 12l6.4 6.4"/>',
  userStar: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6 1 0 2 .3 2.8.7M17.5 13l1.2 2.5 2.8.4-2 1.9.5 2.7-2.5-1.3-2.5 1.3.5-2.7-2-1.9 2.8-.4z"/>',
  bolt: '<path d="M13 2L5 13.5h6L10 22l9-12h-6.5z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  ai: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  x: '<path d="M5 4l14 16M19 4L5 20"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
  tg: '<path d="M21 4L3 11l6 2.5M21 4l-3 16-9-6.5M21 4L9 13.5V19l3-3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14.5h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  candles: '<path d="M8 3v3M8 16v5M16 3v5M16 18v3"/><rect x="5.5" y="6" width="5" height="10" rx="1"/><rect x="13.5" y="8" width="5" height="10" rx="1"/>',
};
const ic = (name, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;

// ---------- formatting ----------
const usdK = (n) => n == null || !isFinite(n) ? "—" : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(Math.abs(n) >= 1e5 ? 0 : 1)}K` : `$${Math.abs(n) >= 10 ? Math.round(n) : (+n).toFixed(2)}`;
const usdS = (n) => n == null ? "—" : `${n >= 0 ? "+" : "−"}${usdK(Math.abs(n))}`;
const solN = (n, signed = false) => n == null || !isFinite(n) ? "—" : `${signed ? (n >= 0 ? "+" : "−") : ""}◎${(a => a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a >= 1 ? a.toFixed(2) : a >= 0.001 || a === 0 ? a.toFixed(3) : a.toPrecision(2))(Math.abs(n))}`;
const pctN = (n, d = 1) => n == null || !isFinite(n) ? "—" : `${(+n).toFixed(n < 10 && d ? d : 0)}%`;
const tokN = (n) => n == null ? "—" : n >= 9.995e8 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));
const short = (a) => a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "";
const sinceMs = (ms) => ms == null ? "—" : ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s` : ms < 3600_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3600_000)}h`;
const TAG = { dev: ["DEV", "dev"], sniper: ["SNIPER", "sn"], bundle: ["BUNDLE", "bd"] };
const MARK = { dev: "D", sniper: "S", bundle: "B" };

// ---------- state ----------
const S = { mint: null, r: null, c: null, trades: null, tab: "trades", filter: "all", sig: {}, timers: [], marks: new Map(), ctx: null, root: null };
const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
S.tab = store.get("coin:tab", "trades");
S.filter = store.get("coin:filter", "all");

const TABS = [["trades", "Trades"], ["holders", "Holders"], ["traders", "Top traders"], ["early", "Early buyers"], ["dev", "Dev tokens"], ["positions", "Positions"], ["ai", "AI read"], ["signals", "Signals"], ["safety", "Safety"]];
const FILTERS = [["all", "All"], ["dev", "Dev"], ["sniper", "Snipers"], ["bundle", "Bundles"], ["top10", "Top 10"], ["followed", "Followed"], ["big", "≥ 1 SOL"]];

export const mintFromHash = () => (location.hash.match(/^#\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/) || [])[1] || null;

function stop() { S.timers.forEach(clearInterval); S.timers = []; }
const alive = (mint) => S.mint === mint && S.root?.isConnected && mintFromHash() === mint;

export async function viewCoin(main, ctx) {
  stop();
  const mint = mintFromHash();
  S.ctx = ctx;
  if (!mint) { main.innerHTML = `<div class="card">${ctx.empty("No coin in the address", "Open a coin from the Pulse, Coins or Signals page.")}</div>`; return; }
  const first = S.mint !== mint;
  Object.assign(S, { mint, sig: {}, ...(first ? { r: null, c: null, trades: null, marks: new Map() } : {}) });
  const [r, c] = await Promise.all([ctx.api(`token/${mint}`), ctx.api(`coin/${mint}`).catch(() => null)]);
  if (S.mint !== mint) return;
  S.r = r; S.c = c;
  const root = document.createElement("div");
  root.className = "cp";
  root.innerHTML = shell(r, c);
  S.root = root;
  main.replaceChildren(root);
  root.addEventListener("click", onClick);
  // The chart and the panel measure their box, so they are mounted once the page is on screen.
  setTimeout(() => { if (!alive(mint)) return; mountChart(q("#cpChart", root), S.r); mountPanel(q("#cpPanel", root), S.r, { onTrade: onPaperTrade }); paintAll(); }, 0);
  S.timers.push(setInterval(() => { if (!alive(mint)) return stop(); if (!document.hidden) liveTick(); }, 2000));
  S.timers.push(setInterval(() => { if (!alive(mint)) return stop(); if (!document.hidden) tradesTick(); }, 1500));
  S.timers.push(setInterval(() => { if (!alive(mint)) return stop(); if (!document.hidden) tokenTick(); }, 15000));
  tradesTick();
}

async function liveTick() {
  const mint = S.mint;
  const c = await S.ctx.api(`coin/${mint}`).catch(() => null);
  if (!c || !alive(mint)) return;
  S.c = c;
  paintHead(); paintSide(); paintTabs();
  if (["holders", "traders", "early", "dev"].includes(S.tab)) paintTab();
}
async function tradesTick() {
  const mint = S.mint;
  const d = await S.ctx.api(`coin/${mint}/trades?limit=150`).catch(() => null);
  if (!d || !alive(mint)) return;
  S.trades = d;
  // Every tagged trade becomes a chart marker: D / S / B for dev, snipers and bundles, F for wallets you follow.
  let added = false;
  for (const x of d.trades) {
    const k = x.tag ? MARK[x.tag] : x.followed ? "F" : null;
    if (!k) continue;
    const id = `${x.t}:${x.wallet}:${x.side}`;
    if (S.marks.has(id)) continue;
    S.marks.set(id, { t: x.t, buy: x.side === "buy", text: `${k}${x.side === "buy" ? "B" : "S"}` });
    added = true;
  }
  if (added && S.r) {
    const list = [...S.marks.values()].sort((a, b) => a.t - b.t).slice(-150);
    S.r.marks = list;
    refreshMarks(S.r);
  }
  if (S.tab === "trades") paintTab();
}
async function tokenTick() {
  const mint = S.mint;
  const r = await S.ctx.api(`token/${mint}`).catch(() => null);
  if (!r || !alive(mint)) return;
  r.marks = S.r?.marks || [];
  S.r = r;
  paintSide();
  if (["positions", "ai", "signals", "safety"].includes(S.tab)) paintTab();
}
function onPaperTrade(side, pos, desk) {
  S.ctx.setDesk(desk); S.ctx.beep(side);
  S.ctx.toast(side === "buy" ? `Paper buy $${pos.symbol || ""}: ${pos.sol} SOL` : `Paper sell $${pos.symbol || ""}`);
  tokenTick();
}

// ---------- layout ----------
function shell(r, c) {
  const { esc } = S.ctx, t = r.token;
  return `
  <header class="cp-head">
    <button class="cp-back" data-cback title="Back" aria-label="Back">${ic("back")}</button>
    <div class="cp-id">
      <div class="cp-av">${S.ctx.av(t, "xl")}<span class="cp-ring" id="cpRing"></span></div>
      <div class="cp-names">
        <div class="cp-l1"><h1>${esc(t.symbol || "?")}</h1><span class="cp-name" title="${esc(t.name || "")}">${esc(t.name || "")}</span>
          <button class="cp-ibtn" data-copy="${esc(t.mint)}" title="Copy contract address">${ic("copy")}</button>
          <button class="cp-ibtn ${S.ctx.isWatched(t.mint) ? "on" : ""}" data-cwatch title="Watchlist">${ic("star")}</button></div>
        <div class="cp-l2"><span class="cp-age" id="cpAge"></span>${S.ctx.protoChips(t)}${socials(t)}
          <a class="cp-ibtn" href="https://x.com/search?q=${esc(t.mint)}&f=live" target="_blank" rel="noreferrer" title="Search X for this contract">${ic("search")}</a></div>
        <button class="cp-ca" data-copy="${esc(t.mint)}" title="Copy contract address"><span class="mono">${esc(t.mint)}</span>${ic("copy")}</button>
      </div>
    </div>
    <div class="cp-stats" id="cpStats"></div>
    <div class="cp-quick" id="cpQuick"></div>
  </header>
  <div class="cp-warn" id="cpWarn"></div>
  <div class="cp-body">
    <section class="cp-main">
      <div class="cp-chart" id="cpChart"></div>
      <div class="cp-tabs" id="cpTabs" role="tablist"></div>
      <div class="cp-tab" id="cpTab"></div>
    </section>
    <aside class="cp-side">
      <div class="cp-card cp-m5" id="cpM5"></div>
      <div class="cp-card"><div id="cpPanel"></div></div>
      <div class="cp-card cp-pos" id="cpPos"></div>
      <div class="cp-card"><div class="cp-h">Token info</div><div class="cp-info" id="cpInfo"></div></div>
      <div class="cp-card cp-addr" id="cpAddr"></div>
      <div class="cp-card cp-links" id="cpLinks"></div>
    </aside>
  </div>`;
}

function socials(t) {
  const { esc } = S.ctx;
  const icon = { twitter: "x", telegram: "tg", website: "web" };
  return (t.links || []).filter((l) => /^https?:\/\//.test(l.url || "")).slice(0, 4).map((l) => {
    const site = !icon[l.type] || l.type === "website";
    return `<a class="cp-ibtn ${site ? "untrusted" : ""}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer nofollow" title="${esc(site ? `Set by the coin's creator, unverified: ${l.url}` : l.url)}">${ic(icon[l.type] || "link")}</a>`;
  }).join("");
}

function paintAll() { paintHead(); paintSide(); paintTabs(); paintTab(); }

// A cell is only rewritten when its HTML changed, so selections and hovers survive the polls.
function put(id, html) {
  if (S.sig[id] === html) return;
  const el = q(`#${id}`, S.root);
  if (!el) return;
  el.innerHTML = html; S.sig[id] = html;
}

function paintHead() {
  const { esc, price } = S.ctx, r = S.r, c = S.c, t = r.token, L = r.live;
  const mc = c?.mcUsd ?? (t.graduated ? t.mcap : L?.mcap ?? t.mcap), prog = c?.progress ?? r.progress;
  const ath = Math.max(c?.athUsd || 0, t.peak_mcap || 0, L?.ath || 0, mc || 0) || null;   // never below the price on screen
  const chg = L?.chg1m != null ? [L.chg1m, "1m"] : t.chg_h1 != null ? [t.chg_h1, "1h"] : null;
  const fromAth = mc && ath ? (mc / ath - 1) * 100 : null;
  const curve = prog != null && !t.graduated;
  const stat = (label, value, extra = "") => `<div class="cp-stat"><small>${label}</small><b ${extra}>${value}</b></div>`;
  put("cpStats", `
    <div class="cp-stat cp-mc"><small>Market cap</small><b>${usdK(mc)}</b>${chg ? `<span class="${chg[0] >= 0 ? "up" : "down"}">${chg[0] >= 0 ? "+" : ""}${chg[0].toFixed(1)}% <i>${chg[1]}</i></span>` : ""}${c?.priceAgeMs > 120_000 ? `<span class="cp-old">price ${Math.round(c.priceAgeMs / 60_000)} min old</span>` : ""}</div>
    ${stat("Price", price(c?.priceUsd ?? t.price))}
    ${stat("Liquidity", curve ? "Curve" : t.liquidity > 0 ? usdK(t.liquidity) : "—", curve ? 'title="Still on the bonding curve: the curve is the market, there is no pool"' : "")}
    ${stat("Supply", tokN(c?.supply ?? (t.price > 0 && t.mcap ? t.mcap / t.price : null)))}
    ${curve ? `<div class="cp-stat"><small>B.Curve</small><b>${(prog * 100).toFixed(prog >= 0.995 ? 1 : 2)}%</b><span class="cp-bar"><i style="width:${Math.min(100, prog * 100).toFixed(1)}%"></i></span></div>` : stat("Status", t.graduated ? "Bonded" : esc(t.status || "—"))}
    ${stat("ATH", `${usdK(ath)}${fromAth != null && fromAth < -1 ? ` <span class="down">${fromAth.toFixed(0)}%</span>` : ""}`)}
    ${stat("Holders", c?.info?.holders != null ? c.info.holders.toLocaleString() : "—")}`);
  const sizes = S.ctx.sizes();
  put("cpQuick", `<span class="cp-qlabel" title="Paper buys at the real quote: nothing is really bought">${ic("bolt")}Paper</span>${sizes.map((s) => `<button class="cp-qbuy" data-cbuy="${s}">◎${s}</button>`).join("")}<a class="cp-fomo" href="${esc(S.ctx.fomoUrl(t.mint))}" target="_blank" rel="noreferrer">Buy on Fomo</a>`);
  const age = q("#cpAge", S.root);
  if (age) age.textContent = S.ctx.ago(t.pair_created || t.first_seen || c?.tradesSince || Date.now());
  const ring = q("#cpRing", S.root);
  if (ring) ring.style.setProperty("--p", curve ? Math.min(1, prog).toFixed(3) : 1), ring.classList.toggle("done", !curve);
  const f = t.fresh || {}, warn = [];
  if (r.untracked) warn.push(["info", "Not tracked yet: live trade feed only. Safety, holders history and price history appear once Blix tracks it."]);
  // "dead" is the radar's tracking status; a coin it stopped watching can still trade, so only without a live price.
  if (f.dead && !(c?.priceAgeMs != null && c.priceAgeMs < 5 * 60_000)) warn.push(["bad", "This coin is dead. The price shown is the last one read, not a live quote."]);
  if (f.quarantine || f.illiquid) warn.push(["bad", `The price shown cannot be traded at: ${f.exitWhy || f.quarantine}.`]);
  put("cpWarn", warn.map(([k, text]) => `<div class="cp-wbox w-${k}">${esc(text)}</div>`).join(""));
}

function paintSide() {
  const { esc } = S.ctx, r = S.r, c = S.c, t = r.token;
  // 5-minute flow.
  const m = c?.m5;
  const share = m && m.buys + m.sells ? (m.buyUsd != null && m.sellUsd != null && m.buyUsd + m.sellUsd > 0 ? m.buyUsd / (m.buyUsd + m.sellUsd) : m.buys / (m.buys + m.sells)) : null;
  put("cpM5", m ? `<div class="cp-m5g">
      <div><small>5m Vol</small><b>${usdK(m.volUsd)}</b></div>
      <div><small>Buys</small><b class="up">${m.buys}${m.buyUsd != null ? ` / ${usdK(m.buyUsd)}` : ""}</b></div>
      <div><small>Sells</small><b class="down">${m.sells}${m.sellUsd != null ? ` / ${usdK(m.sellUsd)}` : ""}</b></div>
      <div><small>Net Vol</small><b class="${(m.netUsd ?? 0) >= 0 ? "up" : "down"}">${m.netUsd == null ? "—" : usdS(m.netUsd)}</b></div></div>
      ${share != null ? `<div class="cp-split"><i style="width:${(share * 100).toFixed(1)}%"></i></div>` : ""}` : `<p class="cp-none">No trades in the last 5 minutes.</p>`);

  // Your paper position in this coin.
  const ps = r.paper || [];
  const bought = ps.reduce((a, p) => a + (p.sol || 0), 0), sold = ps.reduce((a, p) => a + (p.exit_sol || 0), 0);
  const open = ps.filter((p) => p.status === "open"), holding = open.reduce((a, p) => a + (p.valueSol || 0), 0);
  const priced = open.every((p) => p.valueSol != null);
  const pnl = ps.length && priced ? sold + holding - bought : null;
  put("cpPos", `<div class="cp-h">Your position <span class="cp-paper">paper</span></div><div class="cp-posg">
    <div><small>Bought</small><b>${solN(bought)}</b></div><div><small>Sold</small><b>${solN(sold)}</b></div>
    <div><small>Holding</small><b>${open.length ? (priced ? solN(holding) : "—") : solN(0)}</b></div>
    <div><small>PnL</small><b class="${pnl == null ? "" : pnl >= 0 ? "up" : "down"}">${pnl == null ? "—" : `${solN(pnl, true)}${bought ? ` <i>${((pnl / bought) * 100).toFixed(0)}%</i>` : ""}`}</b></div></div>`);

  // Token info: one icon, one figure, green when it looks clean and red when it does not.
  // Every figure comes from /api/coin, which only passes on a reading that can still be true (unknown is "—").
  const i = c?.info || {};
  const tile = (icon, value, label, bad, title = "") => `<div class="cp-tile ${bad == null ? "" : bad ? "bad" : "ok"}" title="${esc(title)}">${ic(icon)}<b>${value}</b><small>${label}</small></div>`;
  const pv = (x) => x == null ? null : typeof x === "object" ? x.pct : x;
  const top10 = pv(i.top10), dev = pv(i.devPct), sn = pv(i.snipers), bd = pv(i.bundle), ins = pv(i.insiders), safety = i.safety ?? null;
  const curve = c?.onCurve ?? (r.progress != null && !t.graduated);
  const lp = curve ? null : (i.lpLocked ?? null);
  const from = i.source ? `From ${i.source}${i.checked ? `, read ${S.ctx.ago(i.checked)} ago` : ""}` : c && !curve ? "RugCheck has no current reading yet (a bonded coin's first reports go stale within minutes); asking it again" : "";
  const ledgerOnly = curve ? "Only known for coins Blix saw from the first trade" : "Unknown after bonding: Blix reads the curve, not the pool";
  const paid = t.header || (t.boosts || 0) > 0;
  const grade = r.research?.report?.grade || null;
  put("cpInfo", [
    tile("crown", pctN(top10), "Top 10 H.", top10 == null ? null : top10 > 30, `Share held by the 10 largest wallets. ${from}`),
    tile("chef", dev == null ? "—" : `${pctN(dev)}${c?.dev?.sold ? ` ${c.dev.sold === "all" ? "sold" : "selling"}` : ""}`, "Dev H.", dev == null ? null : dev > 10, `Share the dev still holds. ${from}`),
    tile("crosshair", pctN(sn), "Snipers H.", sn == null ? null : sn > 10, i.snipers ? `${i.snipers.n} wallets bought within 2 blocks of the first trade; ${i.snipers.sold} sold out` : ledgerOnly),
    tile("ghost", pctN(ins), "Insiders", ins == null ? null : ins > 20, `RugCheck insider networks. ${from}`),
    tile("boxes", pctN(bd), "Bundlers", bd == null ? null : bd > 20, i.bundle ? `${i.bundle.n} wallets bought in the launch block` : ledgerOnly),
    tile("curve", curve ? "Curve" : lp == null ? "—" : pctN(lp, 0), curve ? "No LP yet" : "LP locked", curve || lp == null ? null : lp < 90),
    tile("users", i.holders != null ? i.holders.toLocaleString() : "—", "Holders", null, from),
    tile("userStar", i.traders != null ? i.traders.toLocaleString() : "—", "Traders", null, curve ? "Wallets that traded it on the live feed" : "Unknown after bonding: Blix reads the curve, not the pool"),
    tile("bolt", paid ? "Paid" : "Unpaid", "Dex paid", !paid, "A DexScreener profile or boost was bought for this coin"),
    tile("shield", safety != null ? `${safety}` : "—", "Safety", safety == null ? null : safety < 50, `RugCheck score out of 100. ${from}`),
    tile("ai", grade || (r.research?.status === "running" ? "…" : "—"), "AI grade", grade ? /^[DF]/.test(grade) : null, r.research?.report?.verdict || ""),
    tile("candles", r.triage ? `${r.triage.score}` : "—", "Triage", r.triage ? r.triage.label === "slop" : null, r.triage?.why || ""),
  ].join(""));

  // Addresses: the contract and the dev, each with copy, explorer and (for the dev) follow.
  const dev_ = c?.dev?.wallet || t.creator || null;
  const row = (label, a, extra = "") => `<div class="cp-arow"><span class="cp-al">${label}</span><button class="cp-av2" data-copy="${esc(a)}" title="Copy ${label === "CA" ? "contract" : "dev"} address"><span class="mono">${short(a)}</span>${ic("copy")}</button>
    <a class="cp-ibtn" href="https://solscan.io/${label === "CA" ? "token" : "account"}/${esc(a)}" target="_blank" rel="noreferrer" title="Open on Solscan">${ic("link")}</a>${extra}</div>`;
  put("cpAddr", row("CA", t.mint) + (dev_ ? row("DA", dev_, `<button class="cp-ibtn" data-wallet="${esc(dev_)}" title="Open the dev's wallet in Blix">${ic("wallet")}</button>`) : ""));
  const dex = `https://dexscreener.com/solana/${t.pair || t.mint}`;
  put("cpLinks", `<a href="${esc(dex)}" target="_blank" rel="noreferrer">DexScreener</a><a href="https://pump.fun/coin/${esc(t.mint)}" target="_blank" rel="noreferrer">pump.fun</a><a href="https://rugcheck.xyz/tokens/${esc(t.mint)}" target="_blank" rel="noreferrer">RugCheck</a><a href="https://gmgn.ai/sol/token/${esc(t.mint)}" target="_blank" rel="noreferrer">GMGN</a><a href="https://axiom.trade/meme/${esc(t.pair || t.mint)}" target="_blank" rel="noreferrer">Axiom</a>`);
}

function paintTabs() {
  const c = S.c, r = S.r;
  const n = { holders: c?.info?.holders ?? c?.holders?.count, dev: c?.dev?.coins?.others || null, positions: (r.paper || []).length || null, signals: (r.signals || []).length || null };
  put("cpTabs", TABS.map(([k, l]) => `<button class="cp-tb ${S.tab === k ? "on" : ""}" data-ctab="${k}" role="tab" aria-selected="${S.tab === k}">${l}${n[k] != null ? ` <span>${Number(n[k]).toLocaleString()}</span>` : ""}</button>`).join(""));
}

// ---------- tabs ----------
function paintTab() {
  const html = ({ trades: tabTrades, holders: tabHolders, traders: tabTraders, early: tabEarly, dev: tabDev, positions: tabPositions, ai: tabAi, signals: tabSignals, safety: tabSafety })[S.tab]?.() ?? "";
  put("cpTab", html);
}

const tagHtml = (x) => {
  const { esc } = S.ctx;
  const out = [];
  if (x.tag) out.push(`<i class="cp-tag ${TAG[x.tag][1]}">${TAG[x.tag][0]}</i>`);
  if (x.top10) out.push(`<i class="cp-tag t10" title="A top-10 holder">TOP 10</i>`);
  if (x.followed) out.push(`<i class="cp-tag fw" title="A wallet you follow">${esc(x.label || "FOLLOWED")}</i>`);
  return out.join("");
};
const who = (x) => x.wallet ? `<button class="cp-who" data-wallet="${S.ctx.esc(x.wallet)}" title="${S.ctx.esc(x.wallet)}">${S.ctx.wav(x.wallet, x.fomo ? { source: "fomo" } : {}, "xs")}<span class="mono">${short(x.wallet)}</span></button>${tagHtml(x)}` : `<span class="dim">unknown</span>`;
const none = (title, text) => `<div class="cp-empty"><b>${title}</b><span>${text}</span></div>`;

function tabTrades() {
  const d = S.trades;
  if (!d) return none("Loading trades", "");
  const keep = { all: () => true, dev: (x) => x.tag === "dev", sniper: (x) => x.tag === "sniper", bundle: (x) => x.tag === "bundle", top10: (x) => x.top10, followed: (x) => x.followed, big: (x) => (x.sol ?? 0) >= 1 }[S.filter] || (() => true);
  const list = d.trades.filter(keep);
  const chips = `<div class="cp-filters">${FILTERS.map(([k, l]) => `<button class="cp-chip ${S.filter === k ? "on" : ""}" data-cfilter="${k}">${l}</button>`).join("")}<span class="cp-src">${d.source === "live" ? "live trade feed" : d.source === "pool" ? "pool trades · GeckoTerminal" : ""}</span></div>`;
  if (!d.trades.length) return chips + none("No trades yet", d.note || "");
  if (!list.length) return chips + none("No trades match this filter", "Try All.");
  return chips + `<div class="cp-tw"><table class="cp-t"><thead><tr><th>Age</th><th>Type</th><th class="r">MC</th><th class="r">Amount</th><th class="r">Total</th><th>Trader</th></tr></thead><tbody>
    ${list.slice(0, 120).map((x) => `<tr class="${x.side}"><td class="dim">${S.ctx.ago(x.t)}</td><td class="${x.side === "buy" ? "up" : "down"}">${x.side === "buy" ? "Buy" : "Sell"}</td>
      <td class="r">${usdK(x.mcUsd)}</td><td class="r">${tokN(x.tokens)}</td><td class="r ${x.side === "buy" ? "up" : "down"}">${usdK(x.usd)} <span class="dim">${solN(x.sol)}</span></td><td class="cp-wc">${who(x)}</td></tr>`).join("")}</tbody></table></div>`;
}

function ledgerNote(h) {
  if (!h) return "";
  if (h.frozen) return `<p class="cp-note">Holders as of bonding (${S.ctx.ago(h.last)} ago). Blix reads trades on the bonding curve; trades in the pool since then are not in this list. The Holders and Top 10 tiles use RugCheck's current figures.</p>`;
  return `<p class="cp-note">${h.genesis && !h.partial ? `Complete ledger: Blix saw this coin from its first trade (${h.trades.toLocaleString()} trades).` : h.genesis ? "Mostly complete: a few sells were of tokens Blix never saw bought." : `Partial: Blix started reading this coin after it launched, so early holders may be missing and snipers and bundles are not tagged.`}</p>`;
}
function walletTable(list, { rank = true, early = false } = {}) {
  return `<div class="cp-tw"><table class="cp-t"><thead><tr>${rank ? "<th>#</th>" : ""}<th>Wallet</th>${early ? "<th>Bought</th>" : ""}<th class="r">Holding</th><th class="r">Bought</th><th class="r">Sold</th><th class="r">PnL</th>${early ? "<th>Status</th>" : "<th>Held</th>"}</tr></thead><tbody>
    ${list.map((w, i) => `<tr>${rank ? `<td class="dim">${i + 1}</td>` : ""}<td class="cp-wc">${who(w)}</td>
      ${early ? `<td class="dim">${w.afterFirstMs != null ? `+${sinceMs(Math.max(0, w.afterFirstMs))}` : "—"}</td>` : ""}
      <td class="r"><span class="cp-hold"><b>${pctN(w.pct, 2)}</b><span class="cp-mini"><i style="width:${Math.min(100, (w.pct / Math.max(w.maxPct, 0.0001)) * 100).toFixed(0)}%"></i></span></span><span class="dim"> ${usdK(w.valueUsd)}</span></td>
      <td class="r">${solN(w.boughtSol)}${w.avgBuyMc ? `<span class="dim"> @${usdK(w.avgBuyMc)}</span>` : ""}</td>
      <td class="r">${w.soldSol ? solN(w.soldSol) : '<span class="dim">—</span>'}</td>
      <td class="r ${w.pnlSol == null ? "" : w.pnlSol >= 0 ? "up" : "down"}">${w.pnlSol == null ? "—" : `${solN(w.pnlSol, true)}<span class="dim"> ${usdS(w.pnlUsd)}</span>`}</td>
      <td class="dim">${early ? `<span class="cp-st ${w.status === "holding" ? "ok" : w.status === "sold all" ? "bad" : ""}">${w.status}</span>` : S.ctx.ago(w.first)}</td></tr>`).join("")}</tbody></table></div>`;
}
function tabHolders() {
  const h = S.c?.holders;
  if (!h) return none("No live ledger for this coin", "Holders are built from the trade feed while a coin trades on its bonding curve. For bonded coins see RugCheck's holder list under Safety.");
  return `${ledgerNote(h)}${walletTable(h.list)}`;
}
function tabTraders() {
  const l = S.c?.traders;
  if (!l?.length) return none("No traders yet", "Top traders appear once Blix has a live ledger and a price for this coin.");
  return `<p class="cp-note">Ranked by PnL so far: SOL received from sells plus what they hold at the current price, minus SOL spent.</p>${walletTable(l)}`;
}
function tabEarly() {
  const l = S.c?.early;
  if (!l?.length) return none("No early buyers known", "Early buyers are only known for coins Blix read from their first trade.");
  return `${ledgerNote(S.c.holders)}${walletTable(l, { early: true })}`;
}
function tabDev() {
  const { esc } = S.ctx, d = S.c?.dev;
  if (!d) return none("Dev unknown", "Blix did not see who created this coin.");
  const list = d.coins?.list || [];
  return `<div class="cp-devhead">${S.ctx.wav(d.wallet, {}, "sm")}<div><button class="cp-who" data-wallet="${esc(d.wallet)}"><span class="mono">${esc(d.wallet)}</span></button>
      <div class="dim small">${d.pct != null ? `holds ${pctN(d.pct, 2)} (peak ${pctN(d.maxPct, 2)})${d.sold ? ` · ${d.sold === "all" ? "sold everything" : "selling"}` : ""} · spent ${solN(d.boughtSol)} · got ${solN(d.soldSol)}` : "No trades by the dev seen on this coin"}</div></div></div>
    ${list.length ? `<div class="cp-tw"><table class="cp-t"><thead><tr><th>Coin</th><th>Launched</th><th class="r">MC</th><th class="r">Peak</th><th>Status</th></tr></thead><tbody>
      ${list.map((x) => `<tr class="${x.mint === S.mint ? "self" : ""}" data-mint="${esc(x.mint)}"><td><b>${esc(x.symbol || "?")}</b> <span class="dim">${esc(x.name || "")}</span>${x.mint === S.mint ? ' <i class="cp-tag t10">THIS COIN</i>' : ""}</td><td class="dim">${x.t ? S.ctx.ago(x.t) + " ago" : "—"}</td>
        <td class="r">${usdK(x.mcap)}</td><td class="r">${usdK(x.peak)}</td><td class="dim">${x.graduated ? "bonded" : x.progress != null ? `curve ${(x.progress * 100).toFixed(0)}%` : esc(x.status || "—")}</td></tr>`).join("")}</tbody></table></div>
      <p class="cp-note">${d.coins.count} coin${d.coins.count === 1 ? "" : "s"} from this wallet: ${esc(d.coins.window)}.</p>` : none("No other coins seen", "Blix keeps 6 hours of launches plus every coin it tracked.")}`;
}
function tabPositions() {
  const ps = S.r.paper || [];
  if (!ps.length) return none("No paper positions in this coin", "Use the panel on the right or the ⚡ buttons up top. Paper only: nothing is really bought.");
  return `<div class="cp-tw"><table class="cp-t"><thead><tr><th>Opened</th><th class="r">Spent</th><th class="r">Entry MC</th><th class="r">Now</th><th class="r">Result</th><th>Status</th></tr></thead><tbody>
    ${ps.map((p) => `<tr><td class="dim">${S.ctx.ago(p.t)} ago</td><td class="r">${solN(p.sol)}</td><td class="r">${usdK(p.mcap0)}</td><td class="r">${usdK(p.status === "open" ? p.mcapNow : p.exit_mcap)}</td>
      <td class="r ${(p.mult ?? 1) >= 1 ? "up" : "down"}">${p.mult != null ? `${p.mult.toFixed(2)}x` : "—"}</td><td class="dim">${p.status === "open" ? "open" : S.ctx.esc(p.exit_why || "closed")}</td></tr>`).join("")}</tbody></table></div>`;
}
function tabAi() { return `<div class="cp-sec">${S.ctx.researchSection(S.r.research, S.mint)}</div>`; }
function tabSignals() {
  const { esc } = S.ctx, l = S.r.signals || [];
  if (!l.length) return none("No signals on this coin", "Signals fire on launches, graduations, volume, momentum, dumps, dev sells and wallet buys.");
  return `<div class="cp-sigs">${l.map((x) => `<div class="cp-sig"><i style="background:${x.safe === 0 ? "var(--muted)" : (S.ctx.KIND[x.kind] || [, "var(--color-accent)"])[1]}"></i><div><b>${esc(x.title)}</b> <span class="dim">${S.ctx.ago(x.t)} ago</span><small>${esc(x.detail || "")}</small></div></div>`).join("")}</div>`;
}
function tabSafety() {
  const { esc } = S.ctx, t = S.r.token, s = t.safety, v = S.r.verdict;
  // A bonded coin's report from its first minutes in the pool dates within minutes (see rugFigures, server/pulse.js).
  const read = t.safety_checked ? Date.now() - t.safety_checked : null;
  const early = t.graduated && read != null && read > 3 * 60_000 && (!t.pair_created || t.safety_checked - t.pair_created < 15 * 60_000);
  const pc = (x, d = 1) => x == null ? "—" : `${(+x).toFixed(d)}%`;
  const summary = s ? `<p class="cp-note">RugCheck, read ${read != null ? `${S.ctx.ago(t.safety_checked)} ago` : "at an unknown time"}: ${s.totalHolders ? `${s.totalHolders.toLocaleString()} holders` : "holders not indexed yet"} · top 10 ${pc(s.top10 || null)} · insiders ${pc(s.insiderPct)} · dev ${pc(s.devPct)} · LP locked ${pc(s.lpLockedPct, 0)}${early ? `<span class="cp-old" style="display:block">Read in the coin's first minutes in its pool, so these holder figures are out of date (devs often airdrop or move tokens right after bonding). The tiles on the right use a current reading.</span>` : ""}</p>` : "";
  return `<div class="cp-sec">${v ? `<div class="cp-verdict ${v.ok ? "ok" : v.unknown ? "" : "bad"}"><b>${v.ok ? "Passes Blix's safety policy" : v.unknown ? "Not safety-checked yet" : "Fails Blix's safety policy"}</b>${v.reasons?.length ? `<ul>${v.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>` : ""}
    ${s?.risks?.length ? `<div class="cp-sigs">${s.risks.map((x) => `<div class="cp-sig"><i style="background:${x.level === "danger" ? "var(--down)" : x.level === "warn" ? "var(--warn)" : "var(--color-accent)"}"></i><div><b>${esc(x.name)}</b>${x.value ? ` <span class="dim">${esc(x.value)}</span>` : ""}<small>${esc(x.description || "")}</small></div></div>`).join("")}</div>` : s ? `<p class="up">RugCheck found no risks.</p>` : `<p class="cp-note">Not checked yet. Coins are checked when they first show real trading.</p>`}
    ${summary}
    ${t.description ? `<h4 class="cp-h">About, written by the creator</h4><p class="cp-note">${esc(t.description)}</p>` : ""}</div>`;
}

// ---------- events ----------
function onClick(e) {
  const el = e.target;
  // The coin's own picture carries data-mint: clicking it must not reload this page.
  if (el.closest(".cp-av")) { e.stopPropagation(); return; }
  if (el.closest("[data-cback]")) { e.stopPropagation(); if (history.length > 1) history.back(); else location.hash = "#/"; return; }
  const tb = el.closest("[data-ctab]");
  if (tb) { e.stopPropagation(); S.tab = tb.dataset.ctab; store.set("coin:tab", S.tab); paintTabs(); paintTab(); return; }
  const f = el.closest("[data-cfilter]");
  if (f) { e.stopPropagation(); S.filter = f.dataset.cfilter; store.set("coin:filter", S.filter); paintTab(); return; }
  const b = el.closest("[data-cbuy]");
  if (b) { e.stopPropagation(); S.ctx.paperBuy(S.mint, +b.dataset.cbuy).then(() => tokenTick()); return; }
  const w = el.closest("[data-cwatch]");
  if (w) { e.stopPropagation(); S.ctx.toggleWatch(S.mint); w.classList.toggle("on", S.ctx.isWatched(S.mint)); return; }
}
