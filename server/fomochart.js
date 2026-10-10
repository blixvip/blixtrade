// Fomo's chart, bar for bar and live. fomo.family draws its token chart (TradingView) from Mobula's candles behind
// Fomo's own proxy (mobula-api.fomo.family): history over `GET /api/2/token/ohlcv-history` and every trade's
// update to the open bar over a WebSocket (`{type:"ohlcv"}` messages), both signed with the visitor's Privy
// session token (localStorage `privy:token` on fomo.family). Blix does exactly the same from here: the token is
// read from the kept fomo.family tab (browser.js) and refreshed there when it nears its hour, history and tails
// come from the proxy over plain fetch, and one socket carries the live bars of every open chart; each bar goes
// out on the stream (`fbar`) the moment it arrives, so the page draws it as Fomo does. When the proxy will not
// answer, bars come the way Fomo's own fallback gets them: `/proxy/getBarsNew` through Fomo's fetch inside the
// tab, re-read every 2-10 s by size. Market cap = price × total supply, as Fomo shows it.
//
//   GET /api/fomo/bars/<mint>?res=1[&since=<sec>]   { mint, res, secs, bars: [[t, o, h, l, c, v], ...], supply, t, live, error? }
//   stream event `fbar`                               { mint, res, bar: [t, o, h, l, c, v], supply }
import fs from "node:fs";
import path from "node:path";
import { runRepl, hasAside, canBrowse, signedOutText, browserStats } from "./browser.js";
import { knownSupply, supplyOf } from "./jup.js";
import { DATA } from "./db.js";

const SOLANA = 1399811149;   // Fomo's network id for Solana (its symbols are `<mint>:<network>`)
export const RES = { "1S": 1, "15S": 15, "30S": 30, "1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600, "240": 14400, "720": 43200, "1D": 86400, "7D": 604800 };
// Mobula's names for the same sizes (Fomo's own table).
const PERIOD = { "1S": "1s", "15S": "15s", "30S": "30s", "1": "1m", "5": "5m", "15": "15m", "30": "30m", "60": "1h", "240": "4h", "720": "12h", "1D": "1d", "7D": "1w" };
const MOBULA = "https://mobula-api.fomo.family";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const COUNT = 1500;              // bars on a full read (Fomo asks 300 a screen; one read here covers the chart's scrollback)
const KEEP = 5000;               // bars kept per coin and size
const WANTED_MS = 45_000;        // a chart nobody has asked about for this long is let go
const FULL_MS = 5 * 60_000;      // a full re-read at most this often; between them only the tail
const LIVE_TAIL_MS = 30_000;     // while the socket brings a chart's bars, its tail is re-read only this often (a check)
const EMIT_GAP_MS = 150;         // a hot coin's bar changes many times a second; the stream carries it at most this often
const PAGE_EVERY_MS = hasAside() ? 4_000 : 1_000;   // the in-tab fallback: Aside is a process start per read
const AFTER_ERROR_MS = 10_000;
const now = () => Date.now();
// Fomo's own fallback pace for a chart's last bars while no socket brings them: 2-10 s by candle size.
const tailEvery = (secs) => Math.min(Math.max(secs, 2), 10) * 1000;

export const fomoChartStats = { reads: 0, failed: 0, lastError: null, lastRead: 0, bars: 0, signedOut: false, rest: 0, restFailed: 0, pageReads: 0, liveBars: 0, liveOpens: 0, liveDrops: 0 };

// ---------- the sign-in token, from the kept Fomo tab ----------
// Privy keeps the session token in localStorage (JSON-quoted) and renews it for an hour at a time; a call through
// Fomo's own fetch makes it renew one that is about to run out.
const TOKEN_PAGE = `
const page = await openTab("https://fomo.family/");
let res = null;
for (let i = 0; i < 14 && !res; i++) {
  if (i) await new Promise((r) => setTimeout(r, 1200));
  res = await page.evaluate(async (i) => {
    const found = () => ({ href: location.href.slice(0, 80), title: document.title.slice(0, 60), body: (document.body?.innerText || "").slice(0, 120), ls: Object.keys(localStorage).filter((k) => /^privy/.test(k)).length, ck: (document.cookie.match(/privy[^=]*/g) || []).join(",") });
    try {
      // Privy keeps the token in localStorage ("privy:token", JSON-quoted) or, for a session put here as cookies, in
      // the privy-token cookie.
      const read = () => { let t = localStorage.getItem("privy:token"); if (t && t[0] === '"') { try { t = JSON.parse(t); } catch {} } if (!t) { const m = document.cookie.match(/(?:^|; )privy-token=([^;]+)/); t = m ? decodeURIComponent(m[1]) : null; } return t && /^eyJ/.test(t) ? t : null; };
      const expOf = (t) => { try { return JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp * 1000; } catch { return 0; } };
      let t = read();
      if (!t || expOf(t) - Date.now() < 10 * 60000) {
        const man = JSON.stringify(window.__reactRouterManifest || {});
        const urls = [...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.querySelectorAll("link[rel=modulepreload],script[src]")].map((l) => l.href || l.src), ...(man.match(new RegExp('/assets/[^"]+[.]js', "g")) || [])];
        const ff = urls.find((n) => new RegExp("/fomoFetch-[^/]*[.]js").test(n));
        if (ff) {
          const m = await import(ff);
          const fn = Object.values(m).find((v) => typeof v === "function" && /statusCode:401|Authorization|timing:[{]|timeoutMs/.test(String(v)));
          if (fn) { const x = await fn("/proxy/verifiedTokens", { method: "GET" }).catch(() => null); if (x && x.statusCode === 401) return { error: "signed-out" }; }
        }
        t = read();
      }
      const f = found();
      if (!t) return i >= 6 || (i >= 2 && !f.ls && !f.ck) ? { error: "No Fomo sign-in token in the browser " + JSON.stringify(f) } : null;
      return { token: t, exp: expOf(t) };
    } catch (e) {
      // Fomo's sign-in layer still starting ("No global PrivyClient instance"): not yet, try again.
      return i >= 6 || !/Privy/i.test(String(e.message)) ? { error: String(e.message).slice(0, 160) + " " + JSON.stringify(found()) } : null;
    }
  }, i).catch((e) => ({ error: String(e.message).slice(0, 200) }));
}
console.log(JSON.stringify({ fomotoken: 1, ...(res || { error: "fomo.family did not load in the browser." }) }));
`;
const token = { value: null, exp: 0, error: null, at: 0, refused: null, pushed: 0 };
let tokenRun = null;
// The token, read from the browser here unless the one in hand is good for another minLeftMs (5 min: enough for
// the call at hand; the relay to the server asks for more, fomorelay.js).
async function ensureToken(minLeftMs = 5 * 60_000) {
  const fresh = token.value && token.value !== token.refused && token.exp - now() > minLeftMs;
  if (fresh) return token.value;
  if (!tokenRun) {
    // A failed read is not tried again for 15 s (the browser is shared with Fomo's lists and feed).
    const loggedOut = /No Fomo sign-in token|signed out/i.test(token.error || "");
    if (now() - token.at < (loggedOut ? 60_000 : 15_000) && (token.error || token.refused === token.value)) return null;
    tokenRun = (async () => {
      token.at = now();
      try {
        if (!canBrowse()) throw new Error("No browser to read Fomo with on this machine.");
        const r = await runRepl(TOKEN_PAGE, { marker: "fomotoken", timeoutMs: hasAside() ? 60_000 : 30_000, what: "Fomo" });
        if (r.error === "signed-out") { fomoChartStats.signedOut = true; throw new Error(signedOutText()); }
        if (r.error) throw new Error(r.error);
        if (r.token !== token.value) token.refused = null;
        token.value = r.token; token.exp = r.exp || now() + 30 * 60_000; token.error = null;
        fomoChartStats.signedOut = false;
      } catch (e) { token.error = e.message; if (/No Fomo sign-in token/.test(e.message)) fomoChartStats.signedOut = true; }
      finally { tokenRun = null; }
    })();
  }
  await tokenRun;
  return token.value && token.value !== token.refused ? token.value : null;
}
// The proxy said the token is no good (401 or an "Invalid API key" on the socket): the next ask reads it again.
function refused() { token.refused = token.value; token.exp = 0; }
// A token handed to this server by the owner's PC (fomorelay.js: Aside there holds the Fomo login and renews it;
// a copy of that login here dies within the hour, since Privy lets only one browser renew it). Takes the place of
// the browser read above while it is good; POST /api/fomo/token, owner only.
export function setFomoToken(tok, exp, { keep = true } = {}) {
  tok = String(tok || ""); exp = Number(exp) || 0;
  if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(tok) || tok.length > 4000) return { error: "That is not a Fomo sign-in token." };
  if (exp - now() < 60_000) return { error: "That token has run out already." };
  if (tok !== token.value) token.refused = null;
  token.value = tok; token.exp = exp; token.error = null; token.at = now(); token.pushed = now();
  fomoChartStats.signedOut = false;
  // Kept on disk (owner-only file) so a restart does not lose it before the PC sends it again.
  if (keep) fs.promises.writeFile(PUSHED, JSON.stringify({ token: tok, exp, pushed: token.pushed }), { mode: 0o600 }).catch(() => {});
  return { ok: true, expiresInMin: Math.round((exp - now()) / 60_000) };
}
const PUSHED = path.join(DATA, "fomo-token.json");
try {
  const j = JSON.parse(fs.readFileSync(PUSHED, "utf8"));
  if (!setFomoToken(j.token, j.exp, { keep: false }).error) token.pushed = +j.pushed || now();
} catch { /* none kept, or run out */ }

// ---------- Fomo's own API, from here ----------
// prod-api.fomo.family answers the same Privy token Fomo's web client sends (verified 2026-10-07: 200 with it,
// 431 "unauthorized" without), so the lists, feed and board readers can ask from here instead of inside the tab,
// which only works while Fomo's app in that tab recognises the session. Same shape as Fomo's fetch:
// { statusCode, responseObject, message }.
const PROD = "https://prod-api.fomo.family";
export async function fomoFetch(path, { method = "GET", body } = {}) {
  const tok = await ensureToken();
  if (!tok) return { statusCode: 0, message: token.error || "Fomo's sign-in token is not available yet.", responseObject: null };
  fomoChartStats.rest++;
  // Headers as the browser sends them (Fomo's /feed answered 430 to a GET carrying a content-type).
  const headers = { Authorization: `Bearer ${tok}`, Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", Origin: "https://fomo.family", Referer: "https://fomo.family/", "User-Agent": UA };
  if (body != null) headers["content-type"] = "application/json";
  const r = await fetch(`${PROD}${path}`, { method, body, headers, signal: AbortSignal.timeout(30_000) });
  if (r.status === 401 || r.status === 431) refused();
  const text = await r.text().catch(() => "");
  let j = null; try { j = JSON.parse(text); } catch {}
  return { statusCode: r.status === 431 ? 401 : r.status, responseObject: j?.responseObject ?? (j && !("success" in j) ? j : null), message: j?.message || j?.error || (!j && text ? text.slice(0, 160).replace(/\s+/g, " ") : null) };
}
export const fomoTokenKnown = () => Boolean(token.value && token.value !== token.refused && token.exp - now() > 60_000);
// The token itself (read or renewed first), for the other Fomo readers and the prices socket (fomoprices.js).
export const fomoToken = (minLeftMs) => ensureToken(minLeftMs);
export const fomoTokenExp = () => token.exp;

// ---------- bars ----------
const good = (b) => b.length >= 5 && b.slice(0, 5).every((n) => Number.isFinite(n) && n > 0);
// A Mobula bar (an object or an array, time in ms or s) as Blix keeps it: [t seconds, o, h, l, c, v].
function norm(b) {
  let t, o, h, l, c, v;
  if (Array.isArray(b)) [t, o, h, l, c, v] = b;
  else if (b && typeof b === "object") { t = b.t ?? b.time; o = b.o ?? b.open; h = b.h ?? b.high; l = b.l ?? b.low; c = b.c ?? b.close; v = b.v ?? b.volume; }
  else return null;
  t = Number(t);
  if (!(t > 0)) return null;
  if (t >= 1e12) t /= 1000;
  const bar = [Math.floor(t), +o, +h, +l, +c, +(v ?? 0) || 0];
  return good(bar) ? bar : null;
}

// What is kept per coin and size.
const charts = new Map();   // `${mint}:${res}` -> { key, mint, res, secs, bars: Map<t, bar>, fullAt, tailAt, liveAt, wanted, error, waiters, emitAt, emitTimer }
function chartOf(mint, res) {
  const key = `${mint}:${res}`;
  let c = charts.get(key);
  if (!c) { c = { key, mint, res, secs: RES[res], bars: new Map(), fullAt: 0, tailAt: 0, liveAt: 0, wanted: 0, error: null, waiters: [], emitAt: 0, emitTimer: null }; charts.set(key, c); }
  return c;
}
// A bar into the chart's set; true when it is new or changed (then it goes out on the stream).
function put(c, b) {
  const old = c.bars.get(b[0]);
  if (old && old.every((n, i) => n === b[i])) return false;
  c.bars.set(b[0], b);
  if (c.bars.size > KEEP) { const drop = [...c.bars.keys()].sort((x, y) => x - y).slice(0, c.bars.size - KEEP); for (const k of drop) c.bars.delete(k); }
  return true;
}
const sorted = (c, since = null) => [...c.bars.values()].sort((a, b) => a[0] - b[0]).filter((b) => since == null || b[0] >= since);
export const supplyFor = (mint) => knownSupply(mint) ?? supplyOf(mint) ?? (/pump$/.test(mint) ? 1e9 : null);
const wanted = (c) => now() - c.wanted < WANTED_MS;

const listeners = new Set();
export const onFomoBar = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function emit(c, b) { c.emitAt = now(); for (const fn of listeners) try { fn({ mint: c.mint, res: c.res, bar: b, supply: supplyFor(c.mint) }); } catch {} }
// A changed bar goes out at once, then at most every EMIT_GAP_MS with its latest state.
function emitSoon(c, b) {
  if (c.emitTimer) { c.emitNext = b; return; }
  const wait = EMIT_GAP_MS - (now() - c.emitAt);
  if (wait <= 0) { emit(c, b); return; }
  c.emitNext = b;
  c.emitTimer = setTimeout(() => { c.emitTimer = null; const nb = c.emitNext; c.emitNext = null; if (nb) emit(c, nb); }, wait);
}

// ---------- history and tails over Fomo's Mobula proxy ----------
async function mobula(mint, res, { from, to, amount }) {
  const tok = await ensureToken();
  if (!tok) throw new Error(token.error || "Fomo's sign-in token is not available yet.");
  const q = new URLSearchParams({ address: mint, chainId: "solana", period: PERIOD[res], usd: "true" });
  if (from) q.set("from", String(from));
  if (to) q.set("to", String(to));
  if (amount) q.set("amount", String(amount));
  fomoChartStats.rest++;
  const r = await fetch(`${MOBULA}/api/2/token/ohlcv-history?${q}`, { headers: { Authorization: `Bearer ${tok}`, Origin: "https://fomo.family", "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 401) { refused(); throw new Error("Fomo's chart proxy refused the sign-in token."); }
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`Fomo's chart proxy answered ${r.status}.`);
  const j = await r.json().catch(() => null);
  return (Array.isArray(j?.data) ? j.data : []).map(norm).filter(Boolean);
}

// ---------- the live socket (Fomo's own: one per visitor, a subscription per open chart) ----------
const PING_MS = 30_000, ACK_MS = 20_000, DEAD_MAX = 3, RECONNECT_MAX_MS = 30_000, IDLE_MS = 5_000;
class Live {
  ws = null; subs = new Map(); byChart = new Map(); nextId = 1; connecting = false; epoch = 0;
  alive = false; dead = 0; reconnectTimer = null; ackTimer = null; pingTimer = null; idleTimer = null; brokenUntil = 0; lastMessage = 0;
  // Bars for this chart are wanted: a subscription on the open socket, or a socket.
  want(c) {
    if (this.byChart.has(c.key)) return;
    const id = `fomo-${this.nextId++}`;
    this.subs.set(id, c); this.byChart.set(c.key, id);
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.ws?.readyState === 1 && this.tok) this.send({ type: "ohlcv", authorization: this.tok, payload: { asset: c.mint, chainId: "solana", period: PERIOD[c.res], subscriptionId: id } });
    else this.connect();
  }
  unwant(c) {
    const id = this.byChart.get(c.key);
    if (!id) return;
    this.subs.delete(id); this.byChart.delete(c.key);
    if (this.ws?.readyState === 1 && this.tok) this.send({ type: "unsubscribe", authorization: this.tok, payload: { subscriptionId: id } });
    if (!this.subs.size && !this.idleTimer) this.idleTimer = setTimeout(() => { this.idleTimer = null; if (!this.subs.size) this.teardown(); }, IDLE_MS);
  }
  on(c) { return this.alive && this.ws?.readyState === 1 && this.byChart.has(c.key); }
  send(o) { try { this.ws.send(JSON.stringify(o)); } catch {} }
  connect() {
    if (this.connecting || this.reconnectTimer || !this.subs.size || now() < this.brokenUntil || (this.ws && this.ws.readyState !== 3)) return;
    this.connecting = true;
    this.open(++this.epoch);
  }
  async open(epoch) {
    let tok = null;
    try { tok = await ensureToken(); } catch {}
    if (epoch !== this.epoch) return;
    if (!this.subs.size) { this.connecting = false; return; }
    if (!tok) { this.connecting = false; this.gone(); return; }
    this.tok = tok; this.alive = false;
    let ws;
    try { ws = new WebSocket(`${MOBULA.replace(/^https/, "wss")}/?__wss_share=0`); } catch (e) { this.connecting = false; fomoChartStats.lastError = e.message; this.gone(); return; }
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (ws !== this.ws) return;
      this.connecting = false; fomoChartStats.liveOpens++;
      for (const [id, c] of this.subs) this.send({ type: "ohlcv", authorization: tok, payload: { asset: c.mint, chainId: "solana", period: PERIOD[c.res], subscriptionId: id } });
      this.ackTimer = setTimeout(() => { if (!this.alive) ws.close(); }, ACK_MS);
      this.pingTimer = setInterval(() => { if (ws.readyState === 1) ws.send('{"event":"ping"}'); }, PING_MS);
    });
    ws.addEventListener("message", (e) => this.message(ws, e.data));
    ws.addEventListener("close", () => this.closed(ws));
    ws.addEventListener("error", () => { if (ws === this.ws && this.connecting) { this.connecting = false; } });
  }
  message(ws, data) {
    if (ws !== this.ws) return;
    let m;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (!m || typeof m !== "object") return;
    this.lastMessage = now();
    if (m.event === "error") {
      fomoChartStats.lastError = `Fomo's live feed: ${m.message || "error"}`;
      if (/api key|unauthori|token|forbidden/i.test(String(m.message))) { refused(); ws.close(); }
      return;
    }
    // Anything the server says means the connection is good; a bar is the point of it.
    this.alive = true; this.dead = 0;
    if (m.type !== "ohlcv" || typeof m.time !== "number") return;
    const bar = norm(m);
    if (!bar) return;
    let c = this.subs.get(String(m.subscriptionId || ""));
    if (!c && typeof m.asset === "string") c = [...this.subs.values()].find((x) => x.mint.toLowerCase() === m.asset.toLowerCase() && PERIOD[x.res] === m.period);
    if (!c || (typeof m.period === "string" && PERIOD[c.res] !== m.period)) return;
    c.liveAt = now();
    if (put(c, bar)) { fomoChartStats.liveBars++; fomoChartStats.bars++; emitSoon(c, bar); }
  }
  closed(ws) {
    if (ws !== this.ws) return;
    this.connecting = false; this.clearTimers(); this.ws = null;
    if (!this.subs.size) return;
    fomoChartStats.liveDrops++;
    if (this.alive) this.later(1000); else this.gone();
  }
  // No answer from a fresh socket: back off, and after a few of those leave the socket alone for a while (the
  // charts keep coming on Fomo's polling pace meanwhile), as Fomo's client does.
  gone() {
    if (++this.dead < DEAD_MAX) { this.later(Math.min(1000 * 2 ** this.dead, RECONNECT_MAX_MS)); return; }
    this.dead = 0; this.brokenUntil = now() + 60_000; this.teardown(false);
    this.later(60_000);
  }
  later(ms) { if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, ms); }
  clearTimers() { clearTimeout(this.ackTimer); clearInterval(this.pingTimer); this.ackTimer = this.pingTimer = null; }
  teardown(forget = true) {
    this.connecting = false; this.epoch++; this.clearTimers();
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const ws = this.ws; this.ws = null; this.alive = false;
    if (ws) try { ws.close(); } catch {}
    if (forget) { this.subs.clear(); this.byChart.clear(); }
  }
  // Subscriptions follow the charts people are looking at.
  sync() {
    for (const c of charts.values()) {
      if (wanted(c) && c.fullAt) this.want(c);
      else if (!wanted(c)) this.unwant(c);
    }
  }
}
const live = new Live();

// ---------- the in-tab fallback: Fomo's /proxy/getBarsNew through Fomo's own fetch ----------
const PAGE = (jobs) => `
const page = await openTab("https://fomo.family/");
let res = null;
for (let i = 0; i < 14 && !res; i++) {
  if (i) await new Promise((r) => setTimeout(r, 1200));
  res = await page.evaluate(async (jobs) => {
    const man = JSON.stringify(window.__reactRouterManifest || {});
    const urls = [...performance.getEntriesByType("resource").map((e) => e.name), ...[...document.querySelectorAll("link[rel=modulepreload],script[src]")].map((l) => l.href || l.src), ...(man.match(/\\/assets\\/[^"]+\\.js/g) || [])];
    const ff = urls.find((n) => /\\/fomoFetch-[^/]*\\.js/.test(n));
    if (!ff) return null;
    const m = await import(ff);
    const fn = Object.values(m).find((v) => typeof v === "function" && /statusCode:401|Authorization|timing:\\{/.test(String(v)));
    if (!fn) return { error: "Fomo's web client changed: its fetch function was not found." };
    const out = {};
    const one = async (j) => {
      const x = await fn("/proxy/getBarsNew", { method: "POST", body: JSON.stringify({ to: j.to, countBack: j.countBack, resolution: j.res, symbol: j.mint + ":" + ${SOLANA}, from: j.from }) });
      if (x.statusCode === 401) return "signed-out";
      if (x.statusCode !== 200) return { error: "Fomo answered " + x.statusCode + "." };
      const a = x.responseObject || {}, bars = [];
      for (let i = 0; i < (a.c || []).length; i++) bars.push([+a.t[i], +a.o[i], +a.h[i], +a.l[i], +a.c[i], +((a.volume || a.v || [])[i] ?? 0)]);
      return { bars };
    };
    // Fomo's sign-in layer still starting ("No global PrivyClient instance"): let it out, so the whole read is tried again.
    const got = await Promise.all(jobs.map((j) => one(j).catch((e) => { if (/Privy/i.test(String(e.message))) throw e; return { error: String(e.message).slice(0, 200) }; })));
    if (got.includes("signed-out")) return { error: "signed-out" };
    jobs.forEach((j, i) => { out[j.key] = got[i]; });
    return { charts: out };
  }, ${JSON.stringify(jobs)}).catch((e) => (/Privy/i.test(String(e.message)) ? null : { error: String(e.message).slice(0, 200) }));
}
console.log(JSON.stringify({ fomobars: 1, ...(res || { error: "fomo.family did not load in the browser." }) }));
`;

// ---------- the read loop ----------
let running = false, tried = 0, lastError = null, restDownUntil = 0, pageTried = 0;
const due = () => !running && now() - tried > (lastError ? AFTER_ERROR_MS : 0);
// The charts that need a read now: a full history for one without (or with a stale one), the last two bars for
// one whose tail is older than its pace (slow while the socket brings its bars, Fomo's pace otherwise).
function jobsNow() {
  const to = Math.floor(now() / 1000), jobs = [];
  for (const c of charts.values()) {
    if (!wanted(c)) continue;
    if (!c.fullAt || now() - c.fullAt > FULL_MS) jobs.push({ key: c.key, mint: c.mint, res: c.res, to: to + c.secs, from: 1, countBack: COUNT, full: true });
    else if (now() - c.tailAt > (live.on(c) ? LIVE_TAIL_MS : tailEvery(c.secs))) jobs.push({ key: c.key, mint: c.mint, res: c.res, to: to + c.secs, from: to - 3 * c.secs, countBack: 2, full: false });
  }
  // A chart just opened goes first; at most 12 charts per read, so a read stays quick.
  return jobs.sort((a, b) => Number(b.full) - Number(a.full)).slice(0, 12);
}
function take(c, j, bars) {
  c.error = null;
  let changed = 0;
  for (const b of bars) if (good(b) && put(c, b)) { changed++; if (!j.full) emitSoon(c, b); }
  fomoChartStats.bars += changed;
  if (j.full) c.fullAt = now();
  c.tailAt = now();
}
async function read() {
  const jobs = jobsNow();
  if (!jobs.length) return;
  running = true; tried = now(); fomoChartStats.reads++;
  try {
    const viaProxy = now() >= restDownUntil && !!(await ensureToken());
    if (viaProxy) {
      const results = await Promise.all(jobs.map((j) => mobula(j.mint, j.res, j.full ? { to: now(), amount: COUNT } : { to: now(), amount: 2 }).then((bars) => ({ bars }), (e) => ({ error: e.message }))));
      let failed = 0;
      jobs.forEach((j, i) => {
        const c = charts.get(j.key), r = results[i];
        if (!c) return;
        if (r.error) { failed++; c.error = r.error; return; }
        take(c, j, r.bars);
      });
      fomoChartStats.restFailed += failed;
      if (failed === jobs.length) { restDownUntil = now() + 60_000; throw new Error(results[0].error); }
      lastError = null; fomoChartStats.lastRead = now();
    } else {
      if (/No Fomo sign-in token|signed out/i.test(token.error || "")) throw new Error(signedOutText());
      // Fomo's own fallback, inside the tab. Paced: a read is a browser evaluate (or an Aside process on the PC).
      if (now() - pageTried < PAGE_EVERY_MS) return;
      pageTried = now(); fomoChartStats.pageReads++;
      if (!canBrowse()) throw new Error("No browser to read Fomo with on this machine.");
      const r = await runRepl(PAGE(jobs.map(({ key, mint, res, to, from, countBack }) => ({ key, mint, res, to, from, countBack }))), { marker: "fomobars", timeoutMs: hasAside() ? 60_000 : 30_000, what: "Fomo" });
      if (r.error === "signed-out") { fomoChartStats.signedOut = true; throw new Error(signedOutText()); }
      if (r.error) throw new Error(r.error);
      fomoChartStats.signedOut = false;
      for (const j of jobs) {
        const c = charts.get(j.key), got = r.charts?.[j.key];
        if (!c) continue;
        if (!got || got.error) { c.error = got?.error || "Fomo sent no bars."; continue; }
        take(c, j, got.bars || []);
      }
      lastError = null; fomoChartStats.lastRead = now();
    }
  } catch (e) {
    const why = token.value ? e.message : `${e.message} Sign-in token: ${token.error || "not read"}`;
    lastError = why; fomoChartStats.failed++; fomoChartStats.lastError = why;
    for (const j of jobs) { const c = charts.get(j.key); if (c && !c.error) c.error = why; }
  } finally {
    running = false;
    live.sync();
    for (const c of charts.values()) { const w = c.waiters; c.waiters = []; for (const fn of w) fn(); }
  }
}
// Keep reading while someone is looking; nothing runs when no chart is open.
setInterval(() => { if (due()) read(); live.sync(); }, 250).unref();

// GET /api/fomo/bars/<mint>?res=1&since=<sec>: Fomo's bars for the coin at that size. The first ask for a coin
// waits for its history (one read, a second or so); later asks answer from what is kept at once.
export async function fomoBars(mint, res = "1", since = null) {
  res = RES[res] ? String(res) : "1";
  since = Number(since) > 0 ? Number(since) : null;
  const c = chartOf(mint, res);
  c.wanted = now();
  // The browser is known to be signed out of Fomo: say so at once instead of waiting on a read that cannot work.
  if (!c.bars.size && /No Fomo sign-in token|signed out/i.test(token.error || "") && now() - token.at < 60_000) c.error = signedOutText();
  if (!c.fullAt && !c.bars.size) {
    // Nothing yet: the next read is now, and this answer waits for it (bounded, so a stuck browser is not a stuck
    // page). A read already under way for other charts ends first; the one after it carries this chart.
    for (let i = 0; i < 2 && !c.fullAt && !c.error; i++) await new Promise((ok) => { c.waiters.push(ok); setTimeout(ok, hasAside() ? 25_000 : 12_000); if (due()) read(); });
  }
  const bars = sorted(c, since);
  const detail = c.error && !c.bars.size ? c.error : c.error && now() - Math.max(c.tailAt, c.liveAt) > 60_000 ? c.error : null;
  // What the page shows is one plain line; what went wrong in full travels beside it (`detail`) for the health page
  // and the owner.
  const error = !detail ? null : fomoChartStats.signedOut || /sign-in token|signed out|Login/.test(detail) ? "Fomo's chart is signed out on the server." : "Fomo's chart isn't available right now.";
  const isLive = live.on(c) || now() - c.tailAt < 3 * tailEvery(c.secs);
  return { mint, res, secs: c.secs, bars, supply: supplyFor(mint), t: Math.max(c.tailAt, c.liveAt) || null, partial: since != null, first: c.bars.size ? sorted(c)[0][0] : null,
    live: isLive, error, detail, signedOut: error ? fomoChartStats.signedOut || /sign-in token|Login/.test(detail || "") : false };
}

// Charts nobody has looked at in half an hour are forgotten.
setInterval(() => { for (const c of charts.values()) if (now() - c.wanted > 30 * 60_000) { live.unwant(c); charts.delete(c.key); } }, 60_000).unref();

// What the health page shows.
export const fomoChartStatus = () => ({ ...fomoChartStats, open: [...charts.values()].filter(wanted).length, kept: charts.size, browser: browserStats.mode, reading: running,
  token: token.value ? { expiresInMin: Math.round((token.exp - now()) / 60_000), error: token.error, pushedAgoMin: token.pushed ? Math.round((now() - token.pushed) / 60_000) : null } : { error: token.error || "not read yet" },
  socket: { state: live.ws ? ["connecting", "open", "closing", "closed"][live.ws.readyState] : "none", alive: live.alive, subscriptions: live.subs.size, lastMessageAgoS: live.lastMessage ? Math.round((now() - live.lastMessage) / 1000) : null },
  proxy: now() < restDownUntil ? "down, using Fomo's in-tab bars" : "ok" });
