// The coin page's trading terminal: a candlestick chart (TradingView Lightweight Charts, vendored) and an
// Axiom-style buy/sell panel. Every number comes from Blix: candles from real trades (live feed for
// coins on the curve, GeckoTerminal for history and bonded coins), quotes from the exact pump.fun curve or
// Jupiter's route. Fills are paper: nothing is sent to the chain.
const $q = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function api(path, opts = {}) {
  const r = await fetch(`/api/${path}`, { signal: AbortSignal.timeout(opts.method ? 60_000 : 30_000), ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
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
const TFS = [[1, "1s"], [5, "5s"], [15, "15s"], [60, "1m"], [300, "5m"], [900, "15m"], [3600, "1h"]];
const chart = { el: null, api: null, candles: null, vol: null, markers: null, mint: null, tf: null, timer: null, last: null, r: null, ro: null, byTime: null, firstTime: null, src: null, raw: null, rawFirst: null, loading: false, polls: 0 };
let tfPref = (() => { try { return +localStorage.getItem("trade:tf") || 0; } catch { return 0; } })();

export function unmountTrade() {
  clearInterval(chart.timer); chart.timer = null;
  clearInterval(panel.timer); panel.timer = null;
  clearTimeout(onInput.t);
  panel.seq++; panel.epoch++; panel.el = null; panel.quote = null; panel.busy = false;
  try { chart.ro?.disconnect(); } catch {}
  try { chart.api?.remove(); } catch {}
  Object.assign(chart, { el: null, api: null, candles: null, vol: null, markers: null, mint: null, last: null, r: null, ro: null, byTime: null, firstTime: null, src: null, raw: null, rawFirst: null, loading: false, polls: 0 });
}

// Prices on the chart need more digits than anywhere else: on a quiet coin every label on the axis would
// otherwise read the same ("$3.5K" six times). Three significant decimals at every size.
const usdP = (n) => n == null || !isFinite(n) ? "—" : n < 0 ? "" /* axis room below zero is not a price */ : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(3)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(3)}M`
  : Math.abs(n) >= 1e5 ? `$${(n / 1e3).toFixed(1)}K` : Math.abs(n) >= 1e4 ? `$${(n / 1e3).toFixed(2)}K` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(3)}K`
  : Math.abs(n) >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(3)}`;

// The candles as a trader expects to read them: one for every interval up to now (an interval nobody
// traded in is a flat candle at the last price, so the chart keeps moving and time reads evenly), and each
// candle opening where the one before it closed. Long silences (over 300 intervals) are left as a break.
const FILL_MAX = 300;
export function continuous(rows, tf, nowSec = Date.now() / 1000) {
  const out = [];
  const flat = (time, px) => ({ time, open: px, high: px, low: px, close: px, value: 0, flat: true });
  for (const x of rows) {
    const prev = out[out.length - 1];
    if (prev) {
      const gap = Math.round((x.time - prev.time) / tf) - 1;
      if (gap > 0 && gap <= FILL_MAX) for (let i = 1; i <= gap; i++) out.push(flat(prev.time + i * tf, prev.close));
      const open = out[out.length - 1].close;
      out.push({ ...x, open, high: Math.max(x.high, open), low: Math.min(x.low, open) });
    } else out.push({ ...x });
  }
  const last = out[out.length - 1];
  if (last) {
    const until = Math.floor(nowSec / tf) * tf, gap = Math.round((until - last.time) / tf);
    if (gap > 0 && gap <= FILL_MAX) for (let i = 1; i <= gap; i++) out.push(flat(last.time + i * tf, last.close));
  }
  return out;
}

const BAR = 9;            // candle width in pixels at rest: two candles look like two candles, not two walls
export function mountChart(el, r) {
  unmountTrade();
  if (!el) return;
  const LW = window.LightweightCharts;
  const t = r.token;
  // A coin in its first half hour opens on 1s candles, one still on the curve on 15s, everything else on 1m.
  const age = Date.now() - (t.first_seen || Date.now()), young = !t.graduated && age < 3 * 3600e3;
  chart.tf = tfPref || (!t.graduated && age < 30 * 60_000 ? 1 : young ? 15 : 60);
  chart.mint = t.mint; chart.el = el; chart.r = r;
  el.innerHTML = `<div class="tc-head"><div class="tc-tfs">${TFS.map(([s, l]) => `<button class="tc-tf ${s === chart.tf ? "on" : ""}" data-tctf="${s}">${l}</button>`).join("")}</div>
    <span class="tc-ohlc num" id="tcOhlc"></span><span class="tc-src" id="tcSrc"></span></div>
    <div class="tc-canvas" id="tcCanvas"></div><p class="tc-note" id="tcNote"></p>`;
  if (!LW) { $q("#tcNote", el).textContent = "Chart library did not load."; return; }
  const ink = cssColor("--color-ink", "#f2f4f7"), muted = cssColor("--color-muted", "#8b93a1"), rule = cssColor("--color-rule", "#232733"), paper = cssColor("--color-paper-4", "#1c1f26");
  const up = cssColor("--color-up", "#2ebd85"), down = cssColor("--color-down", "#f6465d");
  const box = $q("#tcCanvas", el);
  chart.api = LW.createChart(box, {
    autoSize: true, height: 320,
    layout: { background: { type: "solid", color: "transparent" }, textColor: muted, fontFamily: "system-ui, 'Segoe UI Variable Text', 'Segoe UI', sans-serif", fontSize: 11, attributionLogo: false },
    // Quiet grid: faint level lines to read prices off, no vertical lines.
    grid: { vertLines: { visible: false }, horzLines: { color: alpha(rule, 0.55) } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.22 }, entireTextOnly: true },
    // The axis reads in this PC's time (the library's default is UTC, hours off from the trade list beside it).
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: chart.tf < 60, rightOffset: 6, barSpacing: BAR, minBarSpacing: 1.5, shiftVisibleRangeOnNewBar: true,
      tickMarkFormatter: (sec) => new Date(sec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: chart.tf < 60 ? "2-digit" : undefined, hour12: false }) },
    crosshair: { mode: 0, vertLine: { color: alpha(ink, 0.25), width: 1, style: 3, labelBackgroundColor: paper }, horzLine: { color: alpha(ink, 0.25), width: 1, style: 3, labelBackgroundColor: paper } },
    localization: { priceFormatter: usdP, timeFormatter: (sec) => new Date(sec * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: chart.tf < 60 ? "2-digit" : undefined }) },
  });
  chart.candles = chart.api.addSeries(LW.CandlestickSeries, {
    upColor: up, downColor: down, borderVisible: false, wickUpColor: up, wickDownColor: down,
    priceFormat: { type: "custom", formatter: usdP, minMove: 1e-9 },
    priceLineColor: alpha(ink, 0.5), priceLineStyle: 2, priceLineWidth: 1,
    // A coin that moved 1% should look like it moved 1%: the pane always spans at least 12% of the price,
    // so a small candle is not stretched to the full height.
    autoscaleInfoProvider: (original) => {
      const o = original();
      if (!o?.priceRange) return o;
      const { minValue: lo, maxValue: hi } = o.priceRange, mid = (lo + hi) / 2, need = mid * 0.12;
      return hi - lo >= need ? o : { ...o, priceRange: { minValue: mid - need / 2, maxValue: mid + need / 2 } };
    },
  });
  // Volume: faint bars along the bottom fifth, on their own hidden scale (it never touches the price axis).
  chart.vol = chart.api.addSeries(LW.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
  chart.api.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
  chart.markers = LW.createSeriesMarkers(chart.candles, []);
  chart.api.subscribeCrosshairMove((p) => readout(p?.seriesData?.get(chart.candles) ? p.time : null));
  el.onclick = (e) => {
    const b = e.target.closest("[data-tctf]");
    if (!b) return;
    tfPref = +b.dataset.tctf; try { localStorage.setItem("trade:tf", tfPref); } catch {}
    mountChart(el, chart.r); mountPanelAgain();
  };
  loadCandles(true);
  // Fast refresh: only the newest candles are asked for (a few rows), several times a second on the short
  // intervals, so the last candle moves as trades land. Every 20th pass re-reads the whole chart.
  chart.polls = 0;
  chart.timer = setInterval(() => {
    if (!chart.el?.isConnected) return unmountTrade();
    if (document.hidden || chart.loading) return;
    loadCandles(false, ++chart.polls % 20 === 0);
  }, chart.tf <= 5 ? 400 : chart.tf <= 15 ? 800 : 2000);
}

// The line above the chart: the candle under the pointer, or the newest one. Market cap, its move, its volume.
function readout(time) {
  const o = chart.el && $q("#tcOhlc", chart.el);
  if (!o) return;
  const c = (time != null && chart.byTime?.get(time)) || chart.last;
  if (!c) { o.innerHTML = ""; return; }
  const chg = c.open > 0 ? (c.close / c.open - 1) * 100 : 0, cls = c.close >= c.open ? "up" : "down";
  o.innerHTML = `<span class="dim">MC</span> <b>${usdP(c.close)}</b> <b class="${cls}">${pctF(chg)}</b> <span class="dim">O</span> ${usdP(c.open)} <span class="dim">H</span> ${usdP(c.high)} <span class="dim">L</span> ${usdP(c.low)} <span class="dim">Vol</span> ${usdC(c.value || 0)}`;
}

async function loadCandles(first, whole = false) {
  const mint = chart.mint, tf = chart.tf;
  // What the server last sent that was a real candle: the refresh asks from there on.
  const since = !first && !whole && chart.raw?.length ? chart.raw[chart.raw.length - 1].time : null;
  let d;
  chart.loading = true;
  try { d = await api(`candles/${mint}?tf=${tf}${since ? `&since=${since}` : ""}`); } catch (e) { chart.loading = false; const note = chart.mint === mint && chart.tf === tf && chart.el && $q("#tcNote", chart.el); if (first && note) note.textContent = `No candles: ${e.message}`; return; }
  chart.loading = false;
  if (!chart.candles || chart.mint !== mint || chart.tf !== tf) return;
  const up = cssColor("--color-up", "#2ebd85"), down = cssColor("--color-down", "#f6465d");
  const got = d.rows.filter((x) => x.open > 0 && x.close > 0);
  // A partial answer replaces the tail of what is already held; a different source or start means re-read it all.
  if (d.partial && chart.raw && d.source === chart.src && d.first === chart.rawFirst) chart.raw = [...chart.raw.filter((x) => x.time < since), ...got];
  else if (d.partial) return loadCandles(false, true);
  else { chart.raw = got; chart.rawFirst = d.first ?? got[0]?.time ?? null; }
  const rows = continuous(chart.raw, tf);
  const candle = ({ time, open, high, low, close }) => ({ time, open, high, low, close });
  const volume = (x) => ({ time: x.time, value: x.value || 0, color: alpha(x.close >= x.open ? up : down, 0.32) });
  // A new source (GeckoTerminal charting a just-bonded pool over the price-only candles) redraws it all.
  // A trade that landed in an interval already drawn as flat (it arrived a moment late) cannot be patched
  // in place by the chart library: the candles are set again, which keeps the view where it is.
  const late = Boolean(d.partial && chart.last && got.some((x) => x.time > since && x.time < chart.last.time));
  if (first || !chart.last || rows.length < 2 || d.source !== chart.src || rows[0].time !== chart.firstTime || late) {
    chart.candles.setData(rows.map(candle));
    chart.vol.setData(rows.map(volume));
    // Newest candle at the right at a fixed width; a long history starts on its latest 160 candles.
    if (first) {
      const n = rows.length;
      if (n > 160) chart.api.timeScale().setVisibleLogicalRange({ from: n - 160, to: n + 6 });
      else { chart.api.timeScale().applyOptions({ barSpacing: BAR }); chart.api.timeScale().scrollToRealTime(); }
    }
  } else {
    // Only the newest candles change between polls.
    for (const x of rows) if (x.time >= chart.last.time) { chart.candles.update(candle(x)); chart.vol.update(volume(x)); }
  }
  chart.byTime = new Map(rows.map((x) => [x.time, x]));
  chart.firstTime = rows[0]?.time ?? null;
  chart.last = rows[rows.length - 1] || null;
  chart.src = d.source;
  readout(null);
  const src = $q("#tcSrc", chart.el); if (src) src.textContent = d.source ? `${d.live ? "● " : ""}${d.source}` : "";
  const note = $q("#tcNote", chart.el);
  if (note) note.textContent = rows.length ? "" : d.note ? `No candles yet (${d.note}).` : "No trades in this window yet. Candles appear with the first trade Blix sees.";
  if (first) setMarkers();
}

// Who traded where, as small dots on the candles: your paper fills (B / S), trades by the dev, snipers,
// bundles and followed wallets (DB / DS, SB / SS… from the coin page), and alerts (a plain square).
// One dot per candle and side: several trades in the same candle are counted, not stacked.
function setMarkers() {
  const r = chart.r; if (!r || !chart.markers) return;
  const up = cssColor("--color-up", "#2ebd85"), down = cssColor("--color-down", "#f6465d"), ink = cssColor("--color-ink", "#f2f4f7"), muted = cssColor("--color-muted", "#8b93a1");
  const snap = (ms) => Math.floor(ms / 1000 / chart.tf) * chart.tf;
  const groups = new Map();
  const add = (ms, buy, text, color) => {
    const time = snap(ms), k = `${time}|${buy ? 1 : 0}|${color}`;
    const g = groups.get(k) || { time, buy, color, texts: [], n: 0 };
    g.n++; if (text && !g.texts.includes(text)) g.texts.push(text);
    groups.set(k, g);
  };
  for (const p of r.paper || []) { add(p.t, true, "B", ink); if (p.exit_t) add(p.exit_t, false, "S", ink); }
  // Followed wallets: a named one shows its first letters; the rest are bare dots (a busy coin has dozens).
  for (const w of r.walletTrades || []) add(w.t, w.side === "buy", w.label ? String(w.label).slice(0, 3) : "", w.side === "buy" ? up : down);
  for (const x of r.marks || []) add(x.t, x.buy, x.text, x.buy ? up : down);
  const m = [...groups.values()].map((g) => ({ time: g.time, position: g.buy ? "belowBar" : "aboveBar", color: g.color, shape: "circle", size: 0.6,
    text: g.texts.length ? `${g.texts.slice(0, 2).join(" ")}${g.n > g.texts.length ? ` ×${g.n}` : ""}` : "" }));
  for (const sg of (r.signals || []).slice(0, 40)) m.push({ time: snap(sg.t), position: "aboveBar", color: muted, shape: "square", size: 0.5, text: "" });
  const first = chart.candles.data()[0]?.time ?? Infinity;
  chart.markers.setMarkers(m.filter((x) => x.time >= first).sort((a, b) => a.time - b.time));
}
// Redraw the markers after the open coin's data changed (the coin page adds trade marks as they happen).
export function refreshMarks(r) { if (chart.r && r && chart.r.token?.mint === r.token?.mint) { chart.r = r; setMarkers(); } }

// ---------- buy / sell panel ----------
const panel = { el: null, r: null, side: "buy", sol: null, pct: 100, slip: 300, timer: null, quote: null, seq: 0, epoch: 0, submitting: false, sizes: [0.1, 0.25, 0.5, 1, 2], positions: [] };
try { panel.slip = +localStorage.getItem("trade:slip") || 300; panel.sol = +localStorage.getItem("trade:sol") || null; } catch {}
let remount = null;
function mountPanelAgain() { remount?.(); }

export function mountPanel(el, r, { onTrade } = {}) {
  if (!el) return;
  panel.el = el; panel.r = r; panel.onTrade = onTrade;
  const epoch = ++panel.epoch;
  panel.seq++; panel.quote = null; panel.busy = false;
  clearTimeout(onInput.t);
  remount = () => mountPanel(el, panel.r, { onTrade });
  panel.positions = (r.paper || []).filter((p) => p.status === "open");
  if (panel.side === "sell" && !panel.positions.length) panel.side = "buy";
  api("paper").then((d) => { if (panel.epoch !== epoch || !el.isConnected || panel.submitting) return; if (d.sizes?.length) panel.sizes = d.sizes; if (!panel.sol) panel.sol = d.sizes?.[1] ?? d.sizes?.[0] ?? 0.25; draw(); }).catch(() => {});
  if (!panel.sol) panel.sol = 0.25;
  draw();
  clearInterval(panel.timer);
  // A Jupiter quote can take a couple of seconds: the timed refresh waits for the one in flight instead of
  // cancelling it (a quote box stuck on "Quoting…" otherwise).
  panel.timer = setInterval(() => { if (!panel.el?.isConnected) { clearInterval(panel.timer); return; } if (!document.hidden && !panel.busy && !panel.submitting) requote(); }, 2000);
  el.onclick = onClick; el.oninput = onInput;
}

function draw() {
  if (!panel.el?.isConnected) return;
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
  if (panel.submitting) {
    el.querySelectorAll("button, input").forEach((x) => { x.disabled = true; });
    $q("#tpQuote", el).textContent = "Submitting paper trade…";
  } else requote();
}

async function requote() {
  if (!panel.el?.isConnected || panel.submitting) return;
  const box = $q("#tpQuote", panel.el), go = $q("#tpGo", panel.el);
  if (!box) return;
  const seq = ++panel.seq, t = panel.r.token;
  panel.quote = null; go.disabled = true;
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
    panel.quote = q; go.disabled = panel.submitting;
  } catch (e) {
    if (seq !== panel.seq) return;
    box.innerHTML = `<span class="down">${esc(e.message)}</span>`; go.disabled = true;
  } finally { if (seq === panel.seq) panel.busy = false; }
}

async function onClick(e) {
  const b = e.target.closest("button"); if (!b) return;
  if (b.disabled || panel.submitting) return;
  if (b.dataset.tpside) { panel.side = b.dataset.tpside; return draw(); }
  if (b.dataset.tpsol) { panel.sol = +b.dataset.tpsol; try { localStorage.setItem("trade:sol", panel.sol); } catch {} return draw(); }
  if (b.dataset.tppct) { panel.pct = +b.dataset.tppct; return draw(); }
  if (b.dataset.tpslip) { panel.slip = +b.dataset.tpslip; try { localStorage.setItem("trade:slip", panel.slip); } catch {} return draw(); }
  if (b.id === "tpGo") {
    if (!panel.quote) return;
    panel.submitting = true; panel.seq++; panel.busy = false;
    clearTimeout(onInput.t);
    panel.el.querySelectorAll("button, input").forEach((x) => { x.disabled = true; });
    const t = panel.r.token, epoch = panel.epoch, side = panel.side, onTrade = panel.onTrade;
    try {
      const res = side === "buy"
        ? await post("paper/quoted", { mint: t.mint, sol: panel.sol, slippageBps: panel.slip })
        : await post(`paper/${panel.positions[0].id}/sellq`, { pct: panel.pct });
      const p = res.position;
      onTrade?.(side, p, res.desk);
      const fresh = await api(`token/${t.mint}`).catch(() => null);
      if (epoch !== panel.epoch || !panel.el?.isConnected) return;
      if (fresh) { panel.r = fresh; chart.r = fresh; panel.positions = (fresh.paper || []).filter((x) => x.status === "open"); setMarkers(); }
      if (panel.side === "sell" && !panel.positions.length) panel.side = "buy";
    } catch (err) {
      if (epoch === panel.epoch && panel.el?.isConnected) panel.tradeError = err.message;
    } finally {
      panel.submitting = false;
      if (panel.el?.isConnected) {
        draw();
        if (panel.tradeError) { $q("#tpQuote", panel.el).innerHTML = `<span class="down">${esc(panel.tradeError)}</span>`; panel.tradeError = null; }
      }
    }
  }
}
function onInput(e) {
  if (e.target.matches("[data-tpsolin]")) {
    if (panel.submitting) return;
    panel.seq++; panel.quote = null; panel.busy = false;
    panel.sol = +e.target.value || null;
    panel.el.querySelectorAll("[data-tpsol]").forEach((x) => x.classList.toggle("on", +x.dataset.tpsol === panel.sol));
    const go = $q("#tpGo", panel.el); if (go) { go.disabled = true; go.textContent = `Paper buy ${panel.sol ?? "?"} SOL of $${panel.r.token.symbol || "?"}`; }
    $q("#tpQuote", panel.el).innerHTML = `<span class="dim">${panel.sol > 0 ? "Quoting…" : "Enter an amount."}</span>`;
    clearTimeout(onInput.t); onInput.t = setTimeout(requote, 250);
  }
}
