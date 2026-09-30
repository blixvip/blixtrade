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
};
const kindOf = (k) => KIND[k.startsWith("mcap-") ? "milestone" : k] || [k, "var(--muted)"];
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
  const up = Math.round((Date.now() - s.startedAt) / 60000);
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
    <div class="meta"><b>${ago(s.t)} ago</b>${now != null ? `<span class="${cls(now - 1)}">${mult(now)} since</span>` : ""}</div>
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

const NOTIFY = [["launch", "New launches"], ["graduated", "Graduations"], ["momentum", "Momentum"], ["volume", "Volume spikes"], ["mcap-1000000", "$1M milestones"], ["mcap-5000000", "$5M milestones"], ["dump", "Dump warnings"], ["brief", "AI briefs"]];
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
    for (const el of f.querySelectorAll("input[name]")) {
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
      <a class="btn primary" href="${dex}" target="_blank" rel="noreferrer">DexScreener</a>
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
const VIEWS = { "": viewRadar, coins: viewCoins, narratives: viewNarratives, briefs: viewBriefs, record: viewRecord, settings: viewSettings };
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
  es.addEventListener("brief", (ev) => { const b = JSON.parse(ev.data); const c = $("#briefCard"); if (c) c.innerHTML = briefCard(b); toast("New AI brief"); });
  es.onerror = () => { live.classList.remove("on"); live.querySelector("span").textContent = "reconnecting"; };
}

if ("Notification" in window && Notification.permission === "default") setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
api("overview").then(renderStrip).catch(() => {});
render();
connect();
setInterval(() => { if (route() === "" && !document.hidden) viewRadar($("#main")).catch(() => {}); }, 60_000);
