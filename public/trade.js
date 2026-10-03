// The coin page's trading terminal: a candlestick chart (TradingView Lightweight Charts, vendored) and an
// Axiom-style buy/sell panel. Every number comes from the radar: candles from real trades (live feed for
// coins on the curve, GeckoTerminal for history and bonded coins), quotes from the exact pump.fun curve or
// Jupiter's route. Fills are paper: nothing is sent to the chain.
const $q = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function api(path, opts = {}) {
  const r = await fetch(`/api/${path}`, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });
const usdC = (n) => n == null || !isFinite(n) ? "—" : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(Math.abs(n) >= 1e5 ? 0 : 1)}K` : `$${n.toFixed(Math.abs(n) >= 10 ? 0 : 2)}`;
const tokC = (n) => n == null ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(2);
const solF = (n) => n == null ? "—" : `${n >= 10 ? n.toFixed(2) : n >= 1 ? n.toFixed(3) : n.toFixed(4)} SOL`;
const pctF = (n) => n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

// Lightweight Charts parses hex/rgb only; the theme is OKLCH, so resolve each token through a canvas.
function cssColor(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!v) return fallback;
    const c = document.createElement("canvas"); c.width = c.height = 1;
    const x = c.getContext("2d"); x.fillStyle = fallback; x.fillStyle = v; x.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = x.getImageData(0, 0, 1, 1).data;
    return a ? `rgb(${r},${g},${b})` : fallback;
  } catch { return fallback; }
}
const alpha = (rgb, a) => rgb.replace(/^rgb\((.+)\)$/, `rgba($1,${a})`);

// ---------- chart ----------
const TFS = [[5, "5s"], [15, "15s"], [60, "1m"], [300, "5m"], [900, "15m"], [3600, "1h"]];
const chart = { el: null, api: null, candles: null, vol: null, markers: null, mint: null, tf: null, timer: null, last: null, r: null, ro: null };
let tfPref = (() => { try { return +localStorage.getItem("trade:tf") || 0; } catch { return 0; } })();

export function unmountTrade() {
  clearInterval(chart.timer); chart.timer = null;
  clearInterval(panel.timer); panel.timer = null;
  try { chart.ro?.disconnect(); } catch {}
  try { chart.api?.remove(); } catch {}
  Object.assign(chart, { el: null, api: null, candles: null, vol: null, markers: null, mint: null, last: null, r: null, ro: null });
}

export function mountChart(el, r) {
  unmountTrade();
  if (!el) return;
  const LW = window.LightweightCharts;
  const t = r.token;
  // Young coins on the curve default to 15s candles, everything else to 1m.
  const young = !t.graduated && Date.now() - (t.first_seen || Date.now()) < 3 * 3600e3;
  chart.tf = tfPref || (young ? 15 : 60);
  chart.mint = t.mint; chart.el = el; chart.r = r;
  el.innerHTML = `<div class="tc-head"><div class="tc-tfs">${TFS.map(([s, l]) => `<button class="tc-tf ${s === chart.tf ? "on" : ""}" data-tctf="${s}">${l}</button>`).join("")}</div>
    <span class="tc-ohlc num" id="tcOhlc"></span><span class="tc-src" id="tcSrc"></span></div>
    <div class="tc-canvas" id="tcCanvas"></div><p class="tc-note" id="tcNote"></p>`;
  if (!LW) { $q("#tcNote", el).textContent = "Chart library did not load."; return; }
  const ink2 = cssColor("--color-ink-2", "#9aa3b2"), rule = cssColor("--color-rule", "#232733"), up = cssColor("--color-up", "#2ebd85"), down = cssColor("--color-down", "#f6465d");
  const box = $q("#tcCanvas", el);
  chart.api = LW.createChart(box, {
    autoSize: true, height: 320,
    layout: { background: { type: "solid", color: "transparent" }, textColor: ink2, fontFamily: "JetBrains Mono, ui-monospace, monospace", fontSize: 11, attributionLogo: false },
    grid: { vertLines: { color: alpha(rule, 0.5) }, horzLines: { color: alpha(rule, 0.5) } },
    rightPriceScale: { borderColor: rule, scaleMargins: { top: 0.08, bottom: 0.24 } },
    timeScale: { borderColor: rule, timeVisible: true, secondsVisible: chart.tf < 60, rightOffset: 4 },
    crosshair: { mode: 0 },
    localization: { priceFormatter: (v) => usdC(v), timeFormatter: (s) => new Date(s * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: chart.tf < 60 ? "2-digit" : undefined }) },
  });
  chart.candles = chart.api.addSeries(LW.CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceFormat: { type: "custom", formatter: (v) => usdC(v), minMove: 1e-6 } });
  chart.vol = chart.api.addSeries(LW.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "custom", formatter: (v) => usdC(v) }, lastValueVisible: false, priceLineVisible: false });
  chart.api.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  chart.markers = LW.createSeriesMarkers(chart.candles, []);
  chart.api.subscribeCrosshairMove((p) => {
    const d = p?.seriesData?.get(chart.candles);
    const o = $q("#tcOhlc", chart.el);
    if (!o) return;
    const c = d || chart.last;
    o.innerHTML = c ? `O <b>${usdC(c.open)}</b> H <b>${usdC(c.high)}</b> L <b>${usdC(c.low)}</b> C <b class="${c.close >= c.open ? "up" : "down"}">${usdC(c.close)}</b>` : "";
  });
  el.onclick = (e) => {
    const b = e.target.closest("[data-tctf]");
    if (!b) return;
    tfPref = +b.dataset.tctf; try { localStorage.setItem("trade:tf", tfPref); } catch {}
    mountChart(el, chart.r); mountPanelAgain();
  };
  loadCandles(true);
  chart.timer = setInterval(() => { if (!document.hidden && chart.el?.isConnected) loadCandles(false); else if (!chart.el?.isConnected) unmountTrade(); }, chart.tf <= 15 ? 1500 : 3000);
}

async function loadCandles(first) {
  const mint = chart.mint, tf = chart.tf;
  let d;
  try { d = await api(`candles/${mint}?tf=${tf}`); } catch (e) { if (first) $q("#tcNote", chart.el).textContent = `No candles: ${e.message}`; return; }
  if (!chart.candles || chart.mint !== mint || chart.tf !== tf) return;
  const up = cssColor("--color-up", "#2ebd85"), down = cssColor("--color-down", "#f6465d");
  const rows = d.rows.filter((x) => x.open > 0 && x.close > 0);
  const vols = rows.map((x) => ({ time: x.time, value: x.value || 0, color: alpha(x.close >= x.open ? up : down, 0.45) }));
  if (first || !chart.last || rows.length < 2) {
    chart.candles.setData(rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    chart.vol.setData(vols);
    if (first) chart.api.timeScale().fitContent();
  } else {
    // Only the newest candles change between polls.
    for (const x of rows.filter((x) => x.time >= chart.last.time)) chart.candles.update({ time: x.time, open: x.open, high: x.high, low: x.low, close: x.close });
    for (const v of vols.filter((v) => v.time >= chart.last.time)) chart.vol.update(v);
  }
  chart.last = rows[rows.length - 1] || null;
  const o = $q("#tcOhlc", chart.el);
  if (o && chart.last) o.innerHTML = `C <b class="${chart.last.close >= chart.last.open ? "up" : "down"}">${usdC(chart.last.close)}</b> <span class="dim">market cap</span>`;
  const src = $q("#tcSrc", chart.el); if (src) src.textContent = d.source ? `${d.live ? "● " : ""}${d.source}` : "";
  const note = $q("#tcNote", chart.el);
  if (note) note.textContent = rows.length ? "" : d.note ? `No candles yet (${d.note}).` : "No trades in this window yet. Candles appear with the first trade the radar sees.";
  if (first) setMarkers();
}

// Alerts, followed-wallet trades and your paper fills on the candles.
function setMarkers() {
  const r = chart.r; if (!r || !chart.markers) return;
  const up = cssColor("--color-up", "#2ebd85"), down = cssColor("--color-down", "#f6465d"), acc = cssColor("--color-accent", "#5b8cff");
  const snap = (ms) => Math.floor(ms / 1000 / chart.tf) * chart.tf;
  const m = [];
  for (const p of r.paper || []) {
    m.push({ time: snap(p.t), position: "belowBar", color: up, shape: "arrowUp", text: `B ${p.sol}` });
    if (p.exit_t) m.push({ time: snap(p.exit_t), position: "aboveBar", color: down, shape: "arrowDown", text: "S" });
  }
  for (const w of r.walletTrades || []) m.push({ time: snap(w.t), position: w.side === "buy" ? "belowBar" : "aboveBar", color: w.side === "buy" ? up : down, shape: "circle", text: (w.label || "").slice(0, 8) });
  for (const s of (r.signals || []).slice(0, 40)) m.push({ time: snap(s.t), position: "aboveBar", color: acc, shape: "square", text: s.kind });
  const first = chart.candles.data()[0]?.time ?? Infinity;
  chart.markers.setMarkers(m.filter((x) => x.time >= first).sort((a, b) => a.time - b.time));
}

// ---------- buy / sell panel ----------
const panel = { el: null, r: null, side: "buy", sol: null, pct: 100, slip: 300, timer: null, quote: null, seq: 0, sizes: [0.1, 0.25, 0.5, 1, 2], positions: [] };
try { panel.slip = +localStorage.getItem("trade:slip") || 300; panel.sol = +localStorage.getItem("trade:sol") || null; } catch {}
let remount = null;
function mountPanelAgain() { remount?.(); }

export function mountPanel(el, r, { onTrade } = {}) {
  if (!el) return;
  panel.el = el; panel.r = r; panel.onTrade = onTrade;
  remount = () => mountPanel(el, panel.r, { onTrade });
  panel.positions = (r.paper || []).filter((p) => p.status === "open");
  if (panel.side === "sell" && !panel.positions.length) panel.side = "buy";
  api("paper").then((d) => { if (d.sizes?.length) panel.sizes = d.sizes; if (!panel.sol) panel.sol = d.sizes?.[1] ?? d.sizes?.[0] ?? 0.25; draw(); }).catch(() => {});
  if (!panel.sol) panel.sol = 0.25;
  draw();
  clearInterval(panel.timer);
  // A Jupiter quote can take a couple of seconds: the timed refresh waits for the one in flight instead of
  // cancelling it (a quote box stuck on "Quoting…" otherwise).
  panel.timer = setInterval(() => { if (!panel.el?.isConnected) { clearInterval(panel.timer); return; } if (!document.hidden && !panel.busy) requote(); }, 2000);
  el.onclick = onClick; el.oninput = onInput;
}

function draw() {
  const el = panel.el, t = panel.r.token, sym = esc(t.symbol || "?");
  const pos = panel.positions;
  el.innerHTML = `<div class="tp">
    <div class="tp-tabs"><button class="tp-tab buy ${panel.side === "buy" ? "on" : ""}" data-tpside="buy">Buy</button><button class="tp-tab sell ${panel.side === "sell" ? "on" : ""}" data-tpside="sell" ${pos.length ? "" : "disabled title=\"No open paper position in this coin\""}>Sell</button><span class="tp-paper" title="Filled at a real quote, but nothing is sent to the chain">PAPER</span></div>
    ${panel.side === "buy" ? `
      <div class="tp-amts">${panel.sizes.map((s) => `<button class="tp-amt ${+s === +panel.sol ? "on" : ""}" data-tpsol="${s}">${s}</button>`).join("")}
        <label class="tp-custom"><input class="num" type="number" min="0" step="any" value="${panel.sol ?? ""}" data-tpsolin aria-label="Amount in SOL"><span>SOL</span></label></div>`
    : `<div class="tp-amts">${[25, 50, 75, 100].map((p) => `<button class="tp-amt ${p === panel.pct ? "on" : ""}" data-tppct="${p}">${p}%</button>`).join("")}</div>
       ${pos.length > 1 ? `<p class="tp-mini">${pos.length} open positions: sells apply to the newest. Older ones are on the desk.</p>` : ""}`}
    <div class="tp-slip"><span>Slippage</span>${[100, 300, 500, 1000].map((b) => `<button class="tp-sl ${b === panel.slip ? "on" : ""}" data-tpslip="${b}">${b / 100}%</button>`).join("")}</div>
    <div class="tp-quote" id="tpQuote"><span class="dim">Quoting…</span></div>
    <button class="tp-go ${panel.side}" id="tpGo" disabled>${panel.side === "buy" ? `Paper buy ${panel.sol ?? "?"} SOL of $${sym}` : `Paper sell ${panel.pct}% of $${sym}`}</button>
    ${pos.length ? `<div class="tp-pos">${pos.map((p) => `<div><span>${solF(p.sol)} in · ${p.tokens ? `${tokC(p.tokens)} ${sym}` : "flat-cost position"}</span><b class="num ${p.mult >= 1 ? "up" : "down"}">${p.mult != null ? `${p.mult.toFixed(2)}x` : "—"}</b><span class="num ${p.pnl >= 0 ? "up" : "down"}">${p.pnl == null ? "—" : `${p.pnl >= 0 ? "+" : "−"}$${Math.abs(p.pnl).toFixed(2)}`}</span></div>`).join("")}</div>` : ""}
  </div>`;
  requote();
}

async function requote() {
  const box = $q("#tpQuote", panel.el), go = $q("#tpGo", panel.el);
  if (!box) return;
  const seq = ++panel.seq, t = panel.r.token;
  panel.busy = true;
  try {
    let q;
    if (panel.side === "buy") {
      if (!(panel.sol > 0)) { box.innerHTML = `<span class="dim">Enter an amount.</span>`; go.disabled = true; return; }
      q = await api(`quote?mint=${t.mint}&side=buy&amount=${panel.sol}&slip=${panel.slip}`);
      if (seq !== panel.seq) return;
      const sym = esc(t.symbol || "");
      box.innerHTML = `<div class="tq-main"><span>You get</span><b class="num">${tokC(q.outTokens)} ${sym}</b><span class="dim">≈ ${usdC(q.usdIn)}</span></div>
        <div class="tq-grid"><span>Avg fill MC</span><b class="num">${usdC(q.avgMcapUsd)}</b><span>Now MC</span><b class="num">${usdC(q.spotMcapUsd)}</b>
          <span>Price impact</span><b class="num ${q.impactPct > 5 ? "down" : ""}">${pctF(q.impactPct)}</b><span>Fee</span><b class="num">${q.feeSol != null ? `${solF(q.feeSol)} · ${(q.feeBps / 100).toFixed(2)}%` : "in route"}</b>
          <span>Min received</span><b class="num">${tokC(q.minOut)}</b><span>Route</span><b>${esc((q.route || []).join(" → ") || q.src)}</b></div>`;
    } else {
      const p = panel.positions[0];
      q = await api(`paper/${p.id}/preview?pct=${panel.pct}`);
      if (seq !== panel.seq) return;
      const x = q.outSol != null && q.solIn ? q.outSol / q.solIn : null;
      box.innerHTML = `<div class="tq-main"><span>You get</span><b class="num">${solF(q.outSol)}</b><span class="dim">≈ ${usdC(q.outSol * (q.solUsd || 0))}</span></div>
        <div class="tq-grid"><span>For</span><b class="num">${q.tokens ? `${tokC(q.tokens)} ${esc(t.symbol || "")}` : solF(q.solIn) + " in"}</b><span>Result</span><b class="num ${x >= 1 ? "up" : "down"}">${x != null ? `${x.toFixed(3)}x` : "—"}</b>
          <span>Price impact</span><b class="num">${q.impactPct != null ? pctF(q.impactPct) : "—"}</b><span>Fee</span><b class="num">${q.feeSol != null ? solF(q.feeSol) : q.src === "flat" ? "3% (old position)" : "in route"}</b>
          <span>Route</span><b>${esc((q.route || []).join(" → ") || q.src)}</b><span></span><b></b></div>`;
    }
    panel.quote = q; go.disabled = false;
  } catch (e) {
    if (seq !== panel.seq) return;
    box.innerHTML = `<span class="down">${esc(e.message)}</span>`; go.disabled = true;
  } finally { if (seq === panel.seq) panel.busy = false; }
}

async function onClick(e) {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tpside) { panel.side = b.dataset.tpside; return draw(); }
  if (b.dataset.tpsol) { panel.sol = +b.dataset.tpsol; try { localStorage.setItem("trade:sol", panel.sol); } catch {} return draw(); }
  if (b.dataset.tppct) { panel.pct = +b.dataset.tppct; return draw(); }
  if (b.dataset.tpslip) { panel.slip = +b.dataset.tpslip; try { localStorage.setItem("trade:slip", panel.slip); } catch {} return draw(); }
  if (b.id === "tpGo") {
    b.disabled = true;
    const t = panel.r.token;
    try {
      const res = panel.side === "buy"
        ? await post("paper/quoted", { mint: t.mint, sol: panel.sol, slippageBps: panel.slip })
        : await post(`paper/${panel.positions[0].id}/sellq`, { pct: panel.pct });
      const p = res.position;
      panel.onTrade?.(panel.side, p, res.desk);
      const fresh = await api(`token/${t.mint}`).catch(() => null);
      if (fresh) { panel.r = fresh; chart.r = fresh; panel.positions = (fresh.paper || []).filter((x) => x.status === "open"); setMarkers(); }
      if (panel.side === "sell" && !panel.positions.length) panel.side = "buy";
      draw();
    } catch (err) { $q("#tpQuote", panel.el).innerHTML = `<span class="down">${esc(err.message)}</span>`; b.disabled = false; }
  }
}
function onInput(e) {
  if (e.target.matches("[data-tpsolin]")) {
    panel.sol = +e.target.value || null;
    panel.el.querySelectorAll("[data-tpsol]").forEach((x) => x.classList.toggle("on", +x.dataset.tpsol === panel.sol));
    const go = $q("#tpGo", panel.el); if (go) go.textContent = `Paper buy ${panel.sol ?? "?"} SOL of $${panel.r.token.symbol || "?"}`;
    clearTimeout(onInput.t); onInput.t = setTimeout(requote, 250);
  }
}
