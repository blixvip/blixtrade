// Meme Radar dashboard.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = (p, opt) => fetch(`/api/${p}`, opt).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error || r.status); return b; });
const post = (p, body) => api(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });

// ---------- formatting ----------
const money = (n) => n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n)}`;
const pct = (n) => n == null ? "—" : `${n > 0 ? "+" : ""}${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(Math.abs(n) < 10 ? 1 : 0)}%`;
const cls = (n) => n > 0 ? "up" : n < 0 ? "down" : "dim";
const mult = (x) => x == null ? "—" : `${x.toFixed(x < 10 ? 2 : 1)}x`;
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return `${Math.max(1, Math.floor(s))}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function price(p) {
  if (!p) return "—";
  if (p >= 1) return `$${p.toFixed(3)}`;
  const s = p.toFixed(12);
  const m = s.match(/^0\.(0+)(\d{3})/);
  return m && m[1].length >= 4 ? `$0.0<sub>${m[1].length}</sub>${m[2]}` : `$${p.toPrecision(3)}`;
}
const KIND = {
  launch: ["New launch", "var(--up)"], graduated: ["Graduated", "var(--violet)"], momentum: ["Momentum", "var(--warn)"],
  volume: ["Volume spike", "var(--info)"], dump: ["Dump warning", "var(--down)"], milestone: ["Milestone", "#7ee0c3"],
  wallet: ["Wallet buy", "#2dd4bf"], smart: ["Smart money", "#facc15"], fomo: ["Fomo crowd", "#ff5a5f"], "dev-sold": ["Dev sold", "var(--down)"], rugged: ["Rugged", "var(--down)"],
};
const kindOf = (k) => KIND[k.startsWith("mcap-") ? "milestone" : k.startsWith("wallet:") ? "wallet" : k] || [k, "var(--muted)"];
const shortAddr = (a) => a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "";
// Opens the coin in Fomo (the app on your phone, fomo.family on desktop).
const fomoUrl = (mint) => `https://fomo.family/tokens/solana/${mint}`;
const fomoBtn = (mint, big = false) => `<a class="btn ${big ? "fomo" : "fomo sm"}" href="${fomoUrl(mint)}" target="_blank" rel="noreferrer">${big ? "Buy on Fomo" : "Fomo"}</a>`;
const walletIcon = (source) => source === "fomo" ? "F" : source === "smart" ? "★" : "◆";
const usd = (n) => n == null ? "—" : `${n < 0 ? "−" : ""}${money(Math.abs(n))}`;
function av(t, size = "") {
  const sym = esc((t.symbol || "?").slice(0, 4));
  return t.image ? `<img class="av ${size}" src="${esc(t.image)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;av ${size}&quot;>${sym}</div>'">` : `<div class="av ${size}">${sym}</div>`;
}
function safety(n) {
  if (n == null) return `<span class="safe na">—</span>`;
  return `<span class="safe ${n >= 70 ? "ok" : n >= 45 ? "mid" : "bad"}">${n}</span>`;
}
const scoreBar = (s) => `<span class="score"><span class="bar"><i style="width:${s || 0}%"></i></span>${s ?? 0}</span>`;
const empty = (t, s) => `<div class="empty"><b>${esc(t)}</b>${esc(s)}</div>`;

let toastT;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2400); }

// ---------- markdown (briefs) ----------
function md(src) {
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\$([A-Za-z0-9]{2,12})\b/g, '$1<span class="tk">$$$2</span>');
  let out = "", list = false;
  for (const raw of src.split(/\r?\n/)) {
    const l = raw.trim();
    const li = l.match(/^[-*•]\s+(.*)/);
    if (li) { if (!list) { out += "<ul>"; list = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { out += "</ul>"; list = false; }
    const h = l.match(/^#{1,3}\s+(.*)/);
    if (h) out += `<h2>${inline(h[1])}</h2>`;
    else if (l) out += `<p>${inline(l)}</p>`;
  }
  return out + (list ? "</ul>" : "");
}

// ---------- stat strip ----------
let overviewData = null;
function renderStrip(o) {
  const s = o.stats, c = o.counts;
  const up = s.launchDataMin ?? 0;
  const cells = [
    ["Launches / hr", s.launchesLastHour.toLocaleString(), up < 60 ? `${up}m of data` : "pump.fun live"],
    ["Tracking", c.tracked.toLocaleString(), `${s.nursery} waiting`],
    ["Pass safety", c.safe.toLocaleString(), `of ${c.tracked}`],
    ["Signals 24h", c.signals24h.toLocaleString(), `${s.signals} this session`],
    ["Graduations", c.graduated24h.toLocaleString(), "last 24h"],
    ["Last scan", s.lastCycle ? `${ago(s.lastCycle)} ago` : "…", s.errors ? `${s.errors} errors` : "healthy"],
  ];
  $("#strip").innerHTML = cells.map(([b, v, sm]) => `<div class="stat"><b>${b}</b><span>${v}</span><small>${esc(sm)}</small></div>`).join("");
}

// ---------- views ----------
function sigRow(s, isNew = false) {
  const [label, color] = kindOf(s.kind);
  const t = { symbol: s.symbol, image: s.image };
  const now = s.price_now && s.price ? s.price_now / s.price : null;
  return `<div class="sig ${isNew ? "new" : ""}" style="--k:${color}" data-mint="${esc(s.mint)}">
    ${av(t)}
    <div style="min-width:0"><span class="tag">${label}</span><h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p></div>
    <div class="meta"><b>${ago(s.t)} ago</b>${s.kind === "dump" || s.kind === "dev-sold" || s.kind === "rugged" ? "" : fomoBtn(s.mint)}${now != null ? `<span class="${cls(now - 1)}">${mult(now)} since</span>` : ""}</div>
  </div>`;
}

function coinTable(list, { sort, compact } = {}) {
  if (!list.length) return empty("No coins match yet", "The radar fills up over the first few minutes.");
  const th = (k, label, extra = "") => `<th class="${sort != null ? "sortable" : ""} ${sort === k ? "sorted" : ""} ${extra}" data-sort="${k}">${label}</th>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Coin</th>${th("score", "Score")}${th("safety", "Safety")}${th("mcap", "Mcap")}${compact ? "" : th("liq", "Liquidity", "hide-sm")}${th("volume", "Vol 1h")}${th("change", "1h")}${compact ? "" : `<th class="hide-sm">24h</th>`}${th("new", "Age")}</tr></thead>
    <tbody>${list.map((t) => `<tr class="row" data-mint="${esc(t.mint)}">
      <td><div class="coin">${av(t, "sm")}<div><b>${esc(t.symbol)}</b>${t.graduated ? ' <span class="pill">grad</span>' : ""}<small>${esc(t.name)}</small></div></div></td>
      <td>${scoreBar(t.score)}</td><td>${safety(t.safety_score)}</td><td>${money(t.mcap)}</td>
      ${compact ? "" : `<td class="hide-sm">${money(t.liquidity)}</td>`}<td>${money(t.vol_h1)}</td>
      <td class="${cls(t.chg_h1)}">${pct(t.chg_h1)}</td>${compact ? "" : `<td class="hide-sm ${cls(t.chg_h24)}">${pct(t.chg_h24)}</td>`}
      <td class="dim">${ago(t.pair_created || t.first_seen)}</td></tr>`).join("")}</tbody></table></div>`;
}

function narMini(n) {
  return `<div class="nar-mini" data-theme="${esc(n.name)}"><h4><span>${esc(n.name)}</span><span class="num dim">${n.heat}</span></h4>
    <div class="heat"><i style="width:${n.heat}%"></i></div>
    <small>${(n.launchShare * 100).toFixed(1)}% of launches${n.top.length ? ` · ${n.top.slice(0, 3).map((x) => "$" + esc(x.symbol)).join(" ")}` : ""}</small></div>`;
}

async function viewRadar(main) {
  const [o, nar] = await Promise.all([api("overview"), api("narratives")]);
  overviewData = o;
  renderStrip(o);
  main.innerHTML = `
  <div class="radar-grid">
    <div class="card"><div class="card-head"><h2>Live signals</h2><small>only coins that pass safety</small></div>
      <div class="feed" id="feed">${o.signals.length ? o.signals.map((s) => sigRow(s)).join("") : empty("Listening…", "Signals appear here as coins break out. The first ones usually land within 10–20 minutes.")}</div></div>
    <div class="stack">
      <div class="card"><div class="card-head"><h2>Top movers</h2><a class="note" href="#/coins">All coins →</a></div>${coinTable(o.top, { compact: true })}</div>
      <div class="card"><div class="card-head"><h2>Narratives right now</h2><a class="note" href="#/narratives">Details →</a></div>
        <div class="nar-strip">${nar.themes.slice(0, 8).map(narMini).join("") || empty("Warming up", "Needs a few minutes of launches.")}</div></div>
      <div class="card" id="briefCard">${briefCard(o.brief)}</div>
    </div>
  </div>`;
}

function briefCard(b) {
  return `<div class="card-head"><h2>Latest AI brief</h2><div style="display:flex;gap:8px;align-items:center">${b ? `<small>${ago(b.t)} ago</small>` : ""}<button class="btn" data-brief>Write one now</button></div></div>
    <div class="brief md">${b ? md(b.body) : `<p class="note">Claude writes a market brief every hour from what the radar sees. The first one arrives about 12 minutes after start, or press “Write one now”.</p>`}</div>`;
}

const coinState = { sort: "score", theme: "", q: "", minSafety: "", grad: false };
async function viewCoins(main) {
  const nar = await api("narratives");
  main.innerHTML = `<div class="page-head"><div><h1>Coins</h1><p>Every coin the radar is tracking right now. Brand-new pump.fun launches show up here once they trade for real.</p></div></div>
    <div class="filters">
      <input class="input" id="cq" placeholder="Search ticker, name or mint" value="${esc(coinState.q)}" style="flex:1;min-width:200px">
      <select class="input" id="csafe"><option value="">Any safety</option><option value="45">Safety 45+</option><option value="70">Safety 70+</option></select>
      <label class="check"><input type="checkbox" id="cgrad" ${coinState.grad ? "checked" : ""}> Graduated only</label>
    </div>
    <div class="chips" style="margin-bottom:12px"><button class="chip ${coinState.theme ? "" : "on"}" data-ctheme="">All themes</button>${nar.themes.map((t) => `<button class="chip ${coinState.theme === t.name ? "on" : ""}" data-ctheme="${esc(t.name)}">${esc(t.name)}</button>`).join("")}</div>
    <div class="card" id="coinTable"><div class="skel"></div><div class="skel"></div></div>`;
  $("#csafe").value = coinState.minSafety;
  await loadCoins();
}
async function loadCoins() {
  const qs = new URLSearchParams({ sort: coinState.sort, limit: 300, ...(coinState.theme && { theme: coinState.theme }), ...(coinState.q && { q: coinState.q }), ...(coinState.minSafety && { minSafety: coinState.minSafety }), ...(coinState.grad && { graduated: "1" }) });
  const list = await api(`tokens?${qs}`);
  const box = $("#coinTable");
  if (box) box.innerHTML = coinTable(list, { sort: coinState.sort });
}

function tradeRow(a, { showWallet = true } = {}) {
  const buy = a.side === "buy";
  const who = showWallet ? `<b>${esc(a.label || shortAddr(a.wallet))}</b>${a.source === "smart" ? ' <span class="pill">smart</span>' : ""} ` : "";
  return `<div class="sig" style="--k:${buy ? "var(--up)" : "var(--down)"}" data-mint="${esc(a.mint)}">
    ${av({ symbol: a.symbol || "?", image: a.image })}
    <div style="min-width:0"><span class="tag">${buy ? "Buy" : "Sell"}</span>
      <h3>${who}${buy ? "bought" : "sold"} ${a.symbol ? "$" + esc(a.symbol) : shortAddr(a.mint)}</h3>
      <p>${usd(a.usd)} · ${a.sol ? a.sol.toFixed(2) + " SOL" : ""}${a.mcap ? ` · coin now ${money(a.mcap)}` : ""}</p></div>
    <div class="meta"><b>${ago(a.t)} ago</b>${showWallet ? `<span class="linkish" data-wallet="${esc(a.wallet)}">wallet →</span>` : ""}</div></div>`;
}

function fomoCard(f) {
  const head = `<div class="card-head"><h2><span class="fomo-mark">fomo</span> On-chain</h2><small>${f.connected ? `${f.tradesLastHour} Fomo trades seen in the last hour${f.sampled ? " (sampled)" : ""}` : "free, no API key"}</small></div>`;
  const addForm = `<form class="filters" style="padding:0 16px" id="fomoAdd" onsubmit="return false">
      <input class="input num" id="fwallet" placeholder="Fomo trader's Solana wallet" style="flex:2;min-width:200px" autocomplete="off" spellcheck="false">
      <input class="input" id="fhandle" placeholder="@handle (optional)" style="flex:1;min-width:120px" autocomplete="off">
      <button class="btn fomo" type="submit">Add Fomo trader</button></form>`;
  if (!f.connected) return `<div class="card">${head}
    <div class="empty" style="text-align:left;padding:0 16px 12px"><b>Connect Fomo for free</b>
      Fomo pays its users' Solana fees, so every Fomo trade carries Fomo's fee-payer signature. Add one Fomo wallet and the radar learns that signature from its trades, then watches Fomo trades as they happen. No API key, nothing to pay.
      <ol style="margin:10px 0 0;padding-left:18px;color:var(--ink-2)">
        <li>Your own: Fomo app → Profile → Deposit → Solana → copy the address.</li>
        <li>Or any trader: look up their handle on <a class="linkish" href="https://fomowalletfinder.com/" target="_blank" rel="noreferrer">fomowalletfinder.com</a> (free) and paste the Solana wallet.</li>
      </ol>
      <p class="note" style="margin:10px 0 0">${f.fomoWallets ? `${f.fomoWallets} Fomo wallet${f.fomoWallets > 1 ? "s" : ""} added. Learning starts once the radar has seen 2 of their trades.` : "Buy on Fomo buttons already work."}</p></div>
    ${addForm}</div>`;
  const hot = f.hot || [], traders = f.traders || [];
  return `<div class="card">${head}${addForm}
    <div class="card-head" style="padding-top:4px"><h2>What Fomo is buying</h2><small>last hour</small></div>
    ${hot.length ? hot.map((c) => `<div class="leader" style="margin:0 10px" data-mint="${esc(c.mint)}">${av(c, "sm")}<span class="grow"><b>$${esc(c.symbol || shortAddr(c.mint))}</b> <span class="dim">${c.buyers} buyers · ${c.sellers} sellers</span></span><span class="num ${cls((c.bought || 0) - (c.sold || 0))}">${usd((c.bought || 0) - (c.sold || 0))}</span>${fomoBtn(c.mint)}</div>`).join("")
      : `<p class="note" style="padding:0 16px">No Fomo trades seen yet this hour.</p>`}
    <div class="card-head"><h2>Best Fomo traders seen</h2><small>by profit on trades the radar watched</small></div>
    ${traders.length ? `<div class="table-wrap"><table><thead><tr><th>Trader</th><th>Profit</th><th class="hide-sm">Win rate</th><th class="hide-sm">Coins</th><th></th></tr></thead><tbody>
      ${traders.slice(0, 15).map((t) => `<tr class="row" data-wallet="${esc(t.wallet)}"><td><div class="coin"><div class="av sm">F</div><div><b>${t.handle ? "@" + esc(t.handle) : esc(t.label || shortAddr(t.wallet))}</b><small>${t.trades} trades</small></div></div></td>
      <td class="${cls(t.realized)}">${usd(t.realized)}</td><td class="hide-sm">${t.winRate == null ? "—" : Math.round(t.winRate * 100) + "%"}</td><td class="hide-sm">${t.coins}</td>
      <td>${t.watching ? '<span class="up">following</span>' : `<button class="btn" data-follow="${esc(t.wallet)}">Follow</button>`}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="note" style="padding:0 16px 16px">Rankings appear once traders close a few positions.</p>`}</div>`;
}

async function viewWallets(main) {
  const d = await api("wallets");
  const pct = (x) => x == null ? "—" : `${Math.round(x * 100)}%`;
  const rpcNote = d.rpc.custom ? "Using your RPC." : "Using the free public Solana RPC, which is slow. Add a free Helius RPC URL in Settings for ~10x faster wallet tracking.";
  main.innerHTML = `<div class="page-head"><div><h1>Wallets</h1><p>Follow wallets across every Solana DEX. Their buys raise alerts, and when two wallets you follow buy the same coin you get a Smart money alert. The radar also studies coins that ran 3x or more and finds the wallets that keep getting in early.</p></div></div>
  <form class="filters" id="addWallet" onsubmit="return false">
    <input class="input num" id="waddr" placeholder="Wallet address" style="flex:2;min-width:240px" autocomplete="off" spellcheck="false">
    <input class="input" id="wlabel" placeholder="Name (optional)" style="flex:1;min-width:140px">
    <button class="btn primary" id="wadd" type="submit">Follow wallet</button>
  </form>
  <p class="note" style="margin:-4px 0 14px">${esc(rpcNote)}</p>
  <div class="radar-grid">
    <div class="stack">
      <div class="card"><div class="card-head"><h2>Following</h2><small>${d.wallets.filter((w) => w.watching).length} wallets</small></div>
      ${d.wallets.length ? `<div class="table-wrap"><table><thead><tr><th>Wallet</th><th>Trades</th><th>Win rate</th><th>Realized</th><th class="hide-sm">Open PnL</th><th class="hide-sm">Last trade</th></tr></thead><tbody>
        ${d.wallets.map((w) => `<tr class="row" data-wallet="${esc(w.address)}"><td><div class="coin"><div class="av sm">${walletIcon(w.source)}</div><div><b>${esc(w.label || shortAddr(w.address))}</b>${w.watching ? "" : ' <span class="pill">paused</span>'}<small>${w.source === "fomo" ? "Fomo top trader" : w.source === "smart" ? `smart · ${w.winners} winners` : "added by you"}</small></div></div></td>
        <td>${w.trades}</td><td>${pct(w.winRate)}</td><td class="${cls(w.realized)}">${usd(w.realized)}</td><td class="hide-sm ${cls(w.unrealized)}">${usd(w.unrealized)}</td><td class="hide-sm dim">${w.last_trade ? ago(w.last_trade) : "—"}</td></tr>`).join("")}
      </tbody></table></div>` : empty("No wallets yet", "Paste a wallet above, or follow one from Smart money. Auto-follow adds the best discovered wallets for you.")}</div>
      ${fomoCard(d.fomo)}
      <div class="card"><div class="card-head"><h2>Smart money</h2><small>${d.smart.winners} winning coins studied</small></div>
      ${d.smart.wallets.length ? d.smart.wallets.map((w) => `<div class="sig" style="--k:#facc15" data-wallet="${esc(w.address)}">
        <div class="av">★</div>
        <div style="min-width:0"><span class="tag">${w.coins} winners</span><h3>${esc(w.label || shortAddr(w.address))}</h3>
        <p>${w.early ? `${w.early} early buys` : ""}${w.early && w.holder ? " · " : ""}${w.holder ? `${w.holder} as top holder` : ""} · ${w.tokens.slice(0, 5).map((t) => "$" + esc(t.symbol)).join(" ")}</p></div>
        <div class="meta">${w.watching ? '<b class="up">following</b>' : `<button class="btn" data-follow="${esc(w.address)}">Follow</button>`}</div></div>`).join("")
        : empty("Still learning", "Smart money shows up once coins the radar watched have run 3x or more. Give it a few hours.")}</div>
    </div>
    <div class="card"><div class="card-head"><h2>Live wallet activity</h2><small>buys and sells by wallets you follow</small></div>
      <div class="feed" id="wfeed">${d.activity.length ? d.activity.map((a) => tradeRow(a)).join("") : empty("Nothing yet", "Trades show up here within a minute of happening.")}</div></div>
  </div>`;
  const fa = $("#fomoAdd");
  if (fa) fa.onsubmit = async () => {
    const wallet = $("#fwallet").value.trim(), handle = $("#fhandle").value.trim();
    if (!wallet) return toast("Paste the trader's Solana wallet");
    try { await post("fomo/trader", { wallet, handle }); toast(`Added ${handle || "Fomo trader"}; reading their trades`); viewWallets(main); }
    catch (e) { toast(e.message); }
  };
  $("#addWallet").onsubmit = async () => {
    const address = $("#waddr").value.trim(), label = $("#wlabel").value.trim();
    if (!address) return;
    try { await post("wallets", { address, label }); toast(`Following ${label || shortAddr(address)}`); viewWallets(main); }
    catch (e) { toast(e.message); }
  };
}

async function openWallet(address) {
  const d = $("#drawer"), p = $("#panel");
  d.hidden = false;
  p.innerHTML = `<div class="skel" style="margin-top:22px"></div><div class="skel"></div>`;
  const r = await api(`wallet/${address}`);
  const w = r.wallet, pnl = r.pnl;
  const open = pnl.positions.filter((x) => x.held > 0 && x.value != null && x.value > 1);
  p.innerHTML = `
    <div class="p-head"><div class="av lg">${walletIcon(w.source)}</div><div style="min-width:0"><h2>${esc(w.label || shortAddr(address))}</h2>
      <div class="sub">${w.source === "smart" ? "Discovered smart wallet" : w.source === "you" ? "Added by you" : "Not followed"}${w.watching === 0 && w.source ? " · paused" : ""}</div></div>
      <button class="close" data-close aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="p-acts">
      ${w.source ? `<button class="btn" data-wtoggle="${esc(address)}" data-on="${w.watching ? 0 : 1}">${w.watching ? "Pause" : "Resume"}</button><button class="btn" data-wrename="${esc(address)}">Rename</button><button class="btn" data-wremove="${esc(address)}">Unfollow</button>` : `<button class="btn primary" data-follow="${esc(address)}">Follow</button>`}
      ${w.label?.startsWith("@") ? `<a class="btn fomo" href="https://fomo.family/profile/${esc(w.label.slice(1))}" target="_blank" rel="noreferrer">Fomo profile</a>` : ""}
      <a class="btn" href="https://gmgn.ai/sol/address/${esc(address)}" target="_blank" rel="noreferrer">GMGN</a>
      <a class="btn" href="https://solscan.io/account/${esc(address)}" target="_blank" rel="noreferrer">Solscan</a>
      <button class="btn" data-copy="${esc(address)}">Copy address</button>
    </div>
    <div class="p-sec"><div class="facts">
      <div class="fact"><b>Trades seen</b><span>${pnl.trades}</span></div>
      <div class="fact"><b>Win rate</b><span>${pnl.winRate == null ? "—" : Math.round(pnl.winRate * 100) + "%"}</span></div>
      <div class="fact"><b>Realized</b><span class="${cls(pnl.realized)}">${pnl.closed ? usd(pnl.realized) : "—"}</span></div>
      <div class="fact"><b>Open PnL</b><span class="${cls(pnl.unrealized)}">${pnl.trades ? usd(pnl.unrealized) : "—"}</span></div>
    </div><p class="note" style="margin:10px 0 0">PnL covers trades since the radar started watching this wallet, priced in USD at the time.</p></div>
    ${open.length ? `<div class="p-sec"><h3>Holding now</h3>${open.map((x) => `<div class="leader" data-mint="${esc(x.mint)}">${av(x, "sm")}<span class="grow"><b>$${esc(x.symbol || shortAddr(x.mint))}</b> <span class="dim">${esc(x.name || "")}</span></span><span class="num">${money(x.value)}</span><span class="num ${cls(x.unrealized)}" style="width:80px;text-align:right">${usd(x.unrealized)}</span></div>`).join("")}</div>` : ""}
    ${r.hits.length ? `<div class="p-sec"><h3>Why it's smart</h3>${r.hits.map((h) => `<div class="leader" data-mint="${esc(h.mint)}">${av(h, "sm")}<span class="grow"><b>$${esc(h.symbol || shortAddr(h.mint))}</b> <span class="dim">${h.kind === "early" ? "early buyer" : "top holder"}</span></span><span class="num up">${h.multiple ? h.multiple.toFixed(1) + "x run" : ""}</span></div>`).join("")}</div>` : ""}
    <div class="p-sec" style="padding:0"><h3 style="padding:16px 22px 0">Trades</h3>${r.trades.length ? r.trades.map((a) => tradeRow(a, { showWallet: false })).join("") : w.source
      ? `<p class="note" style="padding:0 22px 16px">No trades seen yet. New wallets get their last ~25 transactions checked within a minute or two.</p>`
      : `<div style="padding:0 22px 16px"><p class="note">The radar hasn't looked at this wallet yet.</p><button class="btn" data-wscan="${esc(address)}">Scan recent trades</button></div>`}</div>
    <div class="p-sec"><div class="mint">${esc(address)}</div></div>`;
  p.scrollTop = 0;
}

async function viewNarratives(main) {
  const nar = await api("narratives");
  main.innerHTML = `<div class="page-head"><div><h1>Narratives</h1><p>What coins are being launched around, and where the money is going. Heat mixes trading volume, coins that survive, and share of all new launches. Lift compares the last hour with the hours before.</p></div></div>
    ${nar.emerging.length ? `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>Emerging words</h2><small>showing up far more in the last hour</small></div>
      <div class="words">${nar.emerging.map((e) => `<span class="word">${esc(e.word)}<em>${e.count}× · ${e.lift.toFixed(1)}x</em></span>`).join("")}</div></div>` : ""}
    <div class="nar-grid">${nar.themes.map((n) => `<div class="card nar">
      <div class="nar-top"><h3>${esc(n.name)}</h3><span class="num" style="font-size:20px">${n.heat}<span class="dim" style="font-size:12px">/100</span></span></div>
      <div class="heat" style="margin:0"><i style="width:${n.heat}%"></i></div>
      <div class="nar-nums">
        <div><b>Launch share</b><span>${(n.launchShare * 100).toFixed(1)}%</span></div>
        <div><b>Lift</b><span class="${n.launchLift >= 1.15 ? "up" : n.launchLift <= 0.85 && n.launchLift ? "down" : ""}">${n.launchLift ? n.launchLift.toFixed(2) + "x" : "—"}</span></div>
        <div><b>Vol 1h</b><span>${money(n.volume)}</span></div>
      </div>
      <div class="leaders">${n.top.length ? n.top.map((t) => `<div class="leader" data-mint="${esc(t.mint)}">${av(t, "sm")}<span class="grow"><b>$${esc(t.symbol)}</b> <span class="dim">${esc(t.name)}</span></span><span class="num">${money(t.mcap)}</span><span class="num ${cls(t.chg_h1)}" style="width:62px;text-align:right">${pct(t.chg_h1)}</span></div>`).join("") : `<span class="note">No tracked coins yet, only launches.</span>`}</div>
    </div>`).join("") || empty("Warming up", "Narratives need a few minutes of launches to show up.")}</div>`;
}

async function viewBriefs(main) {
  const list = await api("briefs");
  main.innerHTML = `<div class="page-head"><div><h1>Briefs</h1><p>Claude reads the radar every hour and writes what's happening: the tape, hot narratives, coins to watch, and red flags. Uses this PC's Claude login.</p></div><button class="btn primary" data-brief>Write one now</button></div>
    <div class="stack">${list.length ? list.map((b) => `<div class="card"><div class="card-head"><h2>${new Date(b.t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}</h2><small>${ago(b.t)} ago</small></div><div class="brief md">${md(b.body)}</div></div>`).join("") : `<div class="card">${empty("No briefs yet", "The first one is written about 12 minutes after the radar starts.")}</div>`}</div>`;
}

async function viewRecord(main) {
  const p = await api("perf");
  const a = p.all;
  const r = (x) => x == null ? "—" : `${Math.round(x * 100)}%`;
  main.innerHTML = `<div class="page-head"><div><h1>Track record</h1><p>Every signal is checked 15 minutes, 1 hour, 6 hours and 24 hours later. This is how you find out whether the radar has an edge before you trust it with money.</p></div></div>
    <div class="kpis">
      <div class="card kpi"><b>Signals scored</b><span>${a.scored}</span><small>of ${a.count} in 14 days</small></div>
      <div class="card kpi"><b>Up 20%+ after 1h</b><span class="up">${r(a.win1h)}</span><small>share of signals</small></div>
      <div class="card kpi"><b>Down 50%+ after 1h</b><span class="down">${r(a.rug1h)}</span><small>share of signals</small></div>
      <div class="card kpi"><b>Hit 2x at peak</b><span>${r(a.twoX)}</span><small>median peak ${mult(a.medianPeak)}</small></div>
    </div>
    <div class="radar-grid">
      <div class="card"><div class="card-head"><h2>By signal type</h2></div>${p.byKind.length ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Count</th><th>Up 20% 1h</th><th>Down 50% 1h</th><th>Avg 1h</th><th>2x peak</th></tr></thead>
        <tbody>${p.byKind.map((k) => `<tr><td><span class="tag" style="--k:${kindOf(k.kind)[1]}">${kindOf(k.kind)[0]}</span></td><td>${k.count}</td><td class="up">${r(k.win1h)}</td><td class="down">${r(k.rug1h)}</td><td>${mult(k.avg1h)}</td><td>${r(k.twoX)}</td></tr>`).join("")}</tbody></table></div>` : empty("No results yet", "Signals need at least an hour before they can be scored.")}</div>
      <div class="card"><div class="card-head"><h2>Best calls this week</h2></div>${p.best.length ? p.best.map((s) => `<div class="sig" style="--k:${kindOf(s.kind)[1]}" data-mint="${esc(s.mint)}">${av(s)}<div style="min-width:0"><span class="tag">${kindOf(s.kind)[0]}</span><h3>$${esc(s.symbol)} · ${esc(s.name)}</h3><p>Called at ${money(s.mcap)} · ${ago(s.t)} ago</p></div><div class="meta"><b class="up">${mult(s.peak)}</b>peak</div></div>`).join("") : empty("Nothing yet", "Check back after a few hours of running.")}</div>
    </div>`;
}

const NOTIFY = [["launch", "New launches"], ["graduated", "Graduations"], ["momentum", "Momentum"], ["volume", "Volume spikes"], ["mcap-1000000", "$1M milestones"], ["mcap-5000000", "$5M milestones"], ["dump", "Dump warnings"], ["wallet", "Wallet buys"], ["smart", "Smart money"], ["dev-sold", "Dev sold"], ["rugged", "Rugged"], ["fomo", "Fomo crowd buys"], ["brief", "AI briefs"]];
async function viewSettings(main) {
  const { settings: s } = await api("settings");
  const num = (k, label, help) => `<div class="field"><label for="s-${k}">${label}</label><input class="input num" id="s-${k}" name="${k}" type="number" value="${s[k]}"><small>${help}</small></div>`;
  main.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>Where updates go and how picky the radar is. Saved on this PC only.</p></div><button class="btn primary" id="save">Save</button></div>
  <form id="sform" class="stack" onsubmit="return false">
    <div class="card"><div class="card-head"><h2>Updates</h2><button class="btn" type="button" id="testN">Send test message</button></div>
      <div class="form">
        <div class="field"><label for="s-discordWebhook">Discord webhook URL</label><input class="input" id="s-discordWebhook" name="discordWebhook" value="${esc(s.discordWebhook)}" placeholder="https://discord.com/api/webhooks/…"><small>Channel settings → Integrations → Webhooks → New webhook → Copy URL.</small></div>
        <div class="field"><label for="s-telegramToken">Telegram bot token</label><input class="input" id="s-telegramToken" name="telegramToken" value="${esc(s.telegramToken)}" placeholder="123456:ABC…"><small>From @BotFather.</small></div>
        <div class="field"><label for="s-telegramChat">Telegram chat ID</label><input class="input" id="s-telegramChat" name="telegramChat" value="${esc(s.telegramChat)}" placeholder="e.g. 123456789"><small>Message your bot, then get it from @userinfobot.</small></div>
        <div class="field" style="grid-column:1/-1"><label>Send me</label><div class="checks">${NOTIFY.map(([k, l]) => `<label class="check"><input type="checkbox" name="notifyKinds" value="${k}" ${s.notifyKinds.includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="aiBriefs" ${s.aiBriefs ? "checked" : ""}> Write AI briefs automatically</label></div>
        ${num("briefEveryMin", "Brief every (minutes)", "How often Claude writes a market brief.")}
      </div></div>
    <div class="card"><div class="card-head"><h2><span class="fomo-mark">fomo</span> Connection</h2><small>free, on-chain, no API key</small></div>
      <div class="form">
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="fomoAutoFollow" ${s.fomoAutoFollow ? "checked" : ""}> Auto-follow the best Fomo traders</label><small>Traders the radar watched make money on Fomo (3+ closed coins, $300+ profit, 50%+ win rate).</small></div>
        ${num("fomoFollowTop", "Max Fomo traders to follow", "Each followed wallet costs RPC calls.")}
      </div></div>
    <div class="card"><div class="card-head"><h2>Wallets</h2></div>
      <div class="form">
        <div class="field" style="grid-column:1/-1"><label for="s-rpcUrl">Solana RPC URL</label><input class="input num" id="s-rpcUrl" name="rpcUrl" value="${esc(s.rpcUrl)}" placeholder="Blank = free public RPC (slow)"><small>For fast wallet tracking, make a free account at helius.dev and paste its mainnet RPC URL here. Blank uses the public RPC, which only allows about one transaction lookup a second.</small></div>
        <div class="field"><label class="check" style="width:max-content"><input type="checkbox" name="autoFollowSmart" ${s.autoFollowSmart ? "checked" : ""}> Auto-follow discovered smart wallets</label><small>Adds the best wallets the radar finds, up to the limit below.</small></div>
        ${num("maxSmartWallets", "Max auto-followed wallets", "More wallets means more RPC calls.")}
        ${num("walletMinSol", "Smart wallet alert minimum (SOL)", "Buys by auto-followed wallets below this are logged but not alerted. Wallets you add always alert.")}
      </div></div>
    <div class="card"><div class="card-head"><h2>Filters</h2><small>higher = fewer, stronger signals</small></div>
      <div class="form">
        ${num("minSafety", "Minimum safety", "0–100 from RugCheck. Coins with any “danger” risk never signal.")}
        ${num("launchScore", "New-launch score", "Score a coin under 2h old needs to raise a launch signal.")}
        ${num("momentumScore", "Momentum score", "Score any coin needs to raise a momentum signal.")}
        ${num("spikeMinVol", "Volume spike minimum ($ in 5m)", "Smallest 5-minute volume that counts as a spike.")}
        ${num("nurseryMinMcap", "Launch survival mcap ($)", "A pump.fun launch must reach this within ~4 minutes to be tracked.")}
        ${num("nurseryMinVol5m", "Launch survival volume ($ in 5m)", "…or trade this much in 5 minutes.")}
        ${num("maxTracked", "Max coins tracked", "Weakest coins are dropped past this.")}
      </div></div>
  </form>`;
  const collect = () => {
    const f = $("#sform");
    const out = {};
    for (const el of f.querySelectorAll("input[name], select[name]")) {
      if (el.name === "notifyKinds") continue;
      out[el.name] = el.type === "checkbox" ? el.checked : el.value;
    }
    out.notifyKinds = [...f.querySelectorAll('input[name="notifyKinds"]:checked')].map((e) => e.value);
    return out;
  };
  $("#save").onclick = async () => { await post("settings", collect()); toast("Saved"); };
  $("#testN").onclick = async () => {
    await post("settings", collect());
    const r = await post("test-notify");
    toast(r.errors.length ? r.errors[0] : "Test message sent");
  };
}

// ---------- coin drawer ----------
function sparkline(snaps) {
  const pts = snaps.filter((s) => s.price > 0);
  if (pts.length < 2) return `<p class="note">Price history builds up while the radar watches this coin.</p>`;
  const W = 760, H = 150, xs = pts.map((p) => p.t), ys = pts.map((p) => p.price);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (t) => ((t - x0) / Math.max(x1 - x0, 1)) * W, Y = (v) => H - 8 - ((v - y0) / Math.max(y1 - y0, 1e-18)) * (H - 16);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.price).toFixed(1)}`).join("");
  const up = ys[ys.length - 1] >= ys[0];
  const c = up ? "var(--up)" : "var(--down)";
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price since tracking started">
    <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? "#39ff88" : "#ff4d6d"}" stop-opacity=".25"/><stop offset="1" stop-color="${up ? "#39ff88" : "#ff4d6d"}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${W},${H}L0,${H}Z" fill="url(#fill)"/><path d="${d}" fill="none" stroke="${c}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <p class="note">${pts.length} readings over ${ago(x0)} · ${up ? "up" : "down"} ${mult(ys[ys.length - 1] / ys[0])} since first seen</p>`;
}

function fomoFlowSection(f) {
  if (!f || (!f.buyers && !f.sellers && !f.recent?.length)) return "";
  return `<div class="p-sec"><h3><span class="fomo-mark">fomo</span> Fomo traders on this coin</h3>
    <div class="facts">
      <div class="fact"><b>Buyers 1h</b><span class="up">${f.buyers || 0}</span></div>
      <div class="fact"><b>Sellers 1h</b><span class="down">${f.sellers || 0}</span></div>
      <div class="fact"><b>Bought 1h</b><span>${money(f.bought || 0)}</span></div>
      <div class="fact"><b>Sold 1h</b><span>${money(f.sold || 0)}</span></div>
    </div>
    ${f.recent.length ? `<div class="leaders" style="margin-top:10px">${f.recent.map((x) => `<div class="leader" data-wallet="${esc(x.wallet)}"><div class="av sm">F</div><span class="grow"><b>${x.handle ? "@" + esc(x.handle) : shortAddr(x.wallet)}</b> <span class="dim">${x.side === "buy" ? "bought" : "sold"} ${ago(x.t)} ago</span></span><span class="num ${x.side === "buy" ? "up" : "down"}">${money(x.usd)}</span></div>`).join("")}</div>` : ""}
  </div>`;
}

function holdersSection(t, s) {
  if (!s || s.totalHolders == null) return "";
  const flag = (bad, text) => `<span class="${bad ? "down" : "up"}">${text}</span>`;
  return `<div class="p-sec"><h3>Holders & dev</h3>
    <div class="facts">
      <div class="fact"><b>Holders</b><span>${s.totalHolders.toLocaleString()}</span></div>
      <div class="fact"><b>Top 10 hold</b><span>${flag(s.top10 > 35, s.top10.toFixed(1) + "%")}</span></div>
      <div class="fact"><b>Insiders hold</b><span>${flag(s.insiderPct > 15, s.insiderPct.toFixed(1) + "%")}</span></div>
      <div class="fact"><b>Dev holds</b><span>${flag(s.devPct > 5, s.devPct.toFixed(2) + "%")}</span></div>
    </div>
    <p class="note" style="margin:10px 0">${s.insiderNetworks ? `${s.insiderNetworks} insider networks (wallets funded from each other). ` : ""}${s.devLaunches ? `The dev has launched ${s.devLaunches} other coins. ` : ""}${s.creator ? `Dev wallet: <span class="linkish" data-wallet="${esc(s.creator)}">${shortAddr(s.creator)}</span>` : ""}</p>
    ${s.holders?.length ? `<div class="leaders">${s.holders.slice(0, 10).map((h, i) => `<div class="leader" data-wallet="${esc(h.owner)}"><span class="num dim" style="width:22px">${i + 1}</span><span class="grow num">${shortAddr(h.owner)}${h.insider ? ' <span class="pill" style="color:var(--down)">insider</span>' : ""}</span><span class="num">${h.pct.toFixed(2)}%</span></div>`).join("")}</div>` : ""}
  </div>`;
}

async function openCoin(mint) {
  const d = $("#drawer"), p = $("#panel");
  d.hidden = false;
  p.innerHTML = `<div class="skel" style="margin-top:22px"></div><div class="skel"></div><div class="skel"></div>`;
  let r;
  try { r = await api(`token/${mint}`); } catch (e) { p.innerHTML = empty("Couldn't load this coin", e.message); return; }
  const t = r.token, s = t.safety;
  const links = t.links || [];
  const dex = `https://dexscreener.com/solana/${t.pair || t.mint}`;
  const age = Date.now() - (t.pair_created || t.first_seen);
  p.innerHTML = `
    <div class="p-head">${av(t, "lg")}<div style="min-width:0"><h2>$${esc(t.symbol)}</h2><div class="sub">${esc(t.name)} · ${esc(t.dex || "")}${t.graduated ? " · graduated" : ""} · ${ago(t.pair_created || t.first_seen)} old</div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${(t.themes || []).map((x) => `<span class="pill">${esc(x)}</span>`).join("")}</div></div>
      <button class="close" data-close aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="p-acts">
      ${fomoBtn(t.mint, true)}
      <a class="btn" href="${dex}" target="_blank" rel="noreferrer">DexScreener</a>
      <a class="btn" href="https://pump.fun/coin/${esc(t.mint)}" target="_blank" rel="noreferrer">pump.fun</a>
      <a class="btn" href="https://rugcheck.xyz/tokens/${esc(t.mint)}" target="_blank" rel="noreferrer">RugCheck</a>
      ${links.map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank" rel="noreferrer">${esc(l.type === "twitter" ? "X" : l.type)}</a>`).join("")}
      <button class="btn" data-copy="${esc(t.mint)}">Copy mint</button>
    </div>
    <div class="p-sec"><div class="facts">
      <div class="fact"><b>Price</b><span>${price(t.price)}</span></div><div class="fact"><b>Mcap</b><span>${money(t.mcap)}</span></div>
      <div class="fact"><b>Liquidity</b><span>${money(t.liquidity)}</span></div><div class="fact"><b>Peak mcap</b><span>${money(t.peak_mcap)}</span></div>
      <div class="fact"><b>Vol 5m</b><span>${money(t.vol_m5)}</span></div><div class="fact"><b>Vol 1h</b><span>${money(t.vol_h1)}</span></div>
      <div class="fact"><b>5m / 1h</b><span><span class="${cls(t.chg_m5)}">${pct(t.chg_m5)}</span> <span class="${cls(t.chg_h1)}">${pct(t.chg_h1)}</span></span></div>
      <div class="fact"><b>Buys / sells 1h</b><span>${t.buys_h1 ?? "—"} / ${t.sells_h1 ?? "—"}</span></div>
      <div class="fact"><b>Score</b><span>${t.score}/100</span></div><div class="fact"><b>Safety</b><span>${t.safety_score ?? "—"}${t.safety_score != null ? "/100" : ""}</span></div>
      <div class="fact"><b>LP locked</b><span>${s?.lpLockedPct != null ? Math.round(s.lpLockedPct) + "%" : "—"}</span></div>
      <div class="fact"><b>Age</b><span>${ago(t.pair_created || t.first_seen)}</span></div>
    </div></div>
    <div class="p-sec"><h3>AI take</h3><div id="take"><button class="btn" data-explain="${esc(t.mint)}">Ask Claude about this coin</button></div></div>
    ${holdersSection(t, s)}
    ${r.wallets?.length ? `<div class="p-sec"><h3>Wallets you follow in this coin</h3>${r.wallets.map((w) => `<div class="leader" data-wallet="${esc(w.wallet)}"><div class="av sm">${walletIcon(w.source)}</div><span class="grow"><b>${esc(w.label || shortAddr(w.wallet))}</b> <span class="dim">first in ${ago(w.first)} ago</span></span><span class="num up">${w.bought ? "+" + money(w.bought) : ""}</span><span class="num down" style="width:70px;text-align:right">${w.sold ? "−" + money(w.sold) : ""}</span></div>`).join("")}</div>` : ""}
    ${fomoFlowSection(r.fomo)}
    <div class="p-sec"><h3>Safety check</h3>${s ? (s.risks.length ? `<div class="risks">${s.risks.map((x) => `<div class="risk"><i style="background:${x.level === "danger" ? "var(--down)" : x.level === "warn" ? "var(--warn)" : "var(--info)"}"></i><div><b>${esc(x.name)}</b>${x.value ? ` <span class="dim">${esc(x.value)}</span>` : ""}<small>${esc(x.description || "")}</small></div></div>`).join("")}</div>` : `<p class="up">RugCheck found no risks.</p>`) : `<p class="note">Not checked yet. Coins are checked when they first show real trading.</p>`}</div>
    <div class="p-sec"><h3>Price while tracked</h3>${sparkline(r.snapshots)}</div>
    ${r.signals.length ? `<div class="p-sec"><h3>Signals</h3>${r.signals.map((x) => `<div class="risk"><i style="background:${kindOf(x.kind)[1]}"></i><div><b>${esc(x.title)}</b> <span class="dim">${ago(x.t)} ago</span><small>${esc(x.detail)}${x.p1h != null ? ` · 1h later: ${mult(x.p1h)}` : ""}${x.peak != null ? ` · peak ${mult(x.peak)}` : ""}</small></div></div>`).join("")}</div>` : ""}
    ${t.description ? `<div class="p-sec"><h3>About</h3><p style="margin:0;color:var(--ink-2)">${esc(t.description)}</p></div>` : ""}
    <div class="p-sec"><h3>Chart</h3><iframe class="embed" src="https://dexscreener.com/solana/${esc(t.pair || t.mint)}?embed=1&theme=dark&trades=0&info=0" title="DexScreener chart" loading="lazy"></iframe></div>
    <div class="p-sec"><div class="mint">${esc(t.mint)}</div></div>`;
  p.scrollTop = 0;
}
function closeCoin() { $("#drawer").hidden = true; $("#panel").innerHTML = ""; }

// ---------- routing ----------
const VIEWS = { "": viewRadar, coins: viewCoins, wallets: viewWallets, narratives: viewNarratives, briefs: viewBriefs, record: viewRecord, settings: viewSettings };
const route = () => location.hash.replace(/^#\/?/, "").split("/")[0];
async function render() {
  const r = route();
  document.querySelectorAll("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.r === r));
  const main = $("#main");
  try { await (VIEWS[r] || viewRadar)(main); }
  catch (e) { main.innerHTML = `<div class="card">${empty("Radar isn't responding", e.message)}</div>`; }
}
window.addEventListener("hashchange", render);

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const el = e.target;
  if (el.closest("[data-close]")) return closeCoin();
  const copy = el.closest("[data-copy]");
  if (copy) { navigator.clipboard?.writeText(copy.dataset.copy); return toast("Mint copied"); }
  const ex = el.closest("[data-explain]");
  if (ex) {
    ex.disabled = true; ex.textContent = "Claude is reading the chart…";
    try { const r = await post(`token/${ex.dataset.explain}/explain`); $("#take").innerHTML = `<div class="md">${md(r.text)}</div>`; }
    catch (err) { $("#take").innerHTML = `<p class="down">${esc(err.message)}</p>`; }
    return;
  }
  const br = el.closest("[data-brief]");
  if (br) {
    br.disabled = true; br.textContent = "Writing…";
    try { await post("brief"); toast("Brief ready"); render(); }
    catch (err) { toast(err.message); br.disabled = false; br.textContent = "Write one now"; }
    return;
  }
  const follow = el.closest("[data-follow]");
  if (follow) {
    const label = prompt("Name this wallet (optional):", "") ?? "";
    await post(`wallet/${follow.dataset.follow}`, { follow: true, label });
    toast("Following wallet");
    if (!$("#drawer").hidden) openWallet(follow.dataset.follow);
    if (route() === "wallets") viewWallets($("#main"));
    return;
  }
  const ws = el.closest("[data-wscan]");
  if (ws) {
    ws.disabled = true; ws.textContent = "Scanning… (up to a minute on the free RPC)";
    try { await post(`wallet/${ws.dataset.wscan}`, { scan: true }); openWallet(ws.dataset.wscan); }
    catch (err) { toast(err.message); ws.disabled = false; ws.textContent = "Scan recent trades"; }
    return;
  }
  const wt = el.closest("[data-wtoggle]");
  if (wt) { await post(`wallet/${wt.dataset.wtoggle}`, { watching: wt.dataset.on === "1" }); openWallet(wt.dataset.wtoggle); if (route() === "wallets") viewWallets($("#main")); return; }
  const wr = el.closest("[data-wrename]");
  if (wr) { const label = prompt("New name:"); if (label != null) { await post(`wallet/${wr.dataset.wrename}`, { label }); openWallet(wr.dataset.wrename); if (route() === "wallets") viewWallets($("#main")); } return; }
  const wx = el.closest("[data-wremove]");
  if (wx) { if (confirm("Stop following this wallet and delete its trade history?")) { await api(`wallet/${wx.dataset.wremove}`, { method: "DELETE" }); closeCoin(); toast("Unfollowed"); if (route() === "wallets") viewWallets($("#main")); } return; }
  const wal = el.closest("[data-wallet]");
  if (wal && !el.closest("a")) return openWallet(wal.dataset.wallet);
  const theme = el.closest("[data-theme]");
  if (theme) { coinState.theme = theme.dataset.theme; location.hash = "#/coins"; return; }
  const ct = el.closest("[data-ctheme]");
  if (ct) { coinState.theme = ct.dataset.ctheme; document.querySelectorAll("[data-ctheme]").forEach((b) => b.classList.toggle("on", b === ct)); return loadCoins(); }
  const th = el.closest("th[data-sort]");
  if (th && route() === "coins") { coinState.sort = th.dataset.sort === "liq" ? "mcap" : th.dataset.sort; return loadCoins(); }
  const m = el.closest("[data-mint]");
  if (m && !el.closest("a")) openCoin(m.dataset.mint);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "cq") { coinState.q = e.target.value.trim(); clearTimeout(window._cq); window._cq = setTimeout(loadCoins, 250); }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "csafe") { coinState.minSafety = e.target.value; loadCoins(); }
  if (e.target.id === "cgrad") { coinState.grad = e.target.checked; loadCoins(); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#drawer").hidden) closeCoin(); });

// ---------- live stream ----------
function connect() {
  const es = new EventSource("/api/stream");
  const live = $("#live");
  es.addEventListener("hello", () => { live.classList.add("on"); live.querySelector("span").textContent = "live"; });
  es.addEventListener("tick", async () => {
    if (route() === "") {
      const o = await api("overview").catch(() => null);
      if (o) renderStrip(o);
    } else {
      const o = await api("overview").catch(() => null);
      if (o) renderStrip(o);
    }
  });
  es.addEventListener("signal", (ev) => {
    const s = JSON.parse(ev.data);
    const feed = $("#feed");
    if (feed) {
      if (feed.querySelector(".empty")) feed.innerHTML = "";
      feed.insertAdjacentHTML("afterbegin", sigRow({ ...s, symbol: s.token?.symbol, image: s.token?.image }, true));
    }
    if (document.hidden && Notification?.permission === "granted") new Notification(s.title, { body: s.detail, icon: s.token?.image || "/icon.svg" });
  });
  es.addEventListener("walletTrade", (ev) => {
    const { wallet: w, trade } = JSON.parse(ev.data);
    const feed = $("#wfeed");
    if (!feed) return;
    if (feed.querySelector(".empty")) feed.innerHTML = "";
    feed.insertAdjacentHTML("afterbegin", tradeRow({ ...trade, wallet: w.address, label: w.label, source: w.source }).replace('class="sig"', 'class="sig new"'));
  });
  es.addEventListener("brief", (ev) => { const b = JSON.parse(ev.data); const c = $("#briefCard"); if (c) c.innerHTML = briefCard(b); toast("New AI brief"); });
  es.onerror = () => { live.classList.remove("on"); live.querySelector("span").textContent = "reconnecting"; };
}

if ("Notification" in window && Notification.permission === "default") setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
api("overview").then(renderStrip).catch(() => {});
render();
connect();
setInterval(() => { if (route() === "" && !document.hidden) viewRadar($("#main")).catch(() => {}); }, 60_000);
