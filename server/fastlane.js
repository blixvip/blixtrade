// The open charts' price, on a thread of its own. The radar's main thread does everything else too (snapshots of
// holder lists, coin pages, the market feeds), and a busy moment there held every chart update back: a trade the
// chain had settled in 0.3 s reached the chart in 0.9 s at the median and up to 9 s (IA, 2026-10-06). This worker
// owns the price accounts' websocket (fastpx.js says which accounts), prices each change itself, and streams it
// straight to the open coin pages over its own small HTTP server (127.0.0.1:4423, reached as /api/fast/* through
// the web app), so the chart moves even while the main thread is busy. Every price also goes back to the main
// thread, which builds the candles, the header and the checks from it as before.
// Node built-ins only: this thread must start fast and never wait on the radar's modules.
import http from "node:http";
import { parentPort, workerData } from "node:worker_threads";
import { createPriceGuard } from "./price-guard.js";

const PORT = workerData?.port || 4423;
const now = () => Date.now();
const post = (m) => { try { parentPort.postMessage(m); } catch {} };

let url = "", overBudget = false;
const mult = new Map();      // mint -> USD per mcSol on the chart's scale (SOL price x supply / 1B x chart level)
const watches = new Map();   // mint -> { kind, stops }

// ---------- one websocket, many subscriptions (as chartstream.js's mux) ----------
const m = { ws: null, nextId: 1, asked: new Map(), byId: new Map(), subs: new Map(), retry: null, backoff: 1000, url: "" };
const send = (o) => { try { m.ws?.readyState === 1 && m.ws.send(JSON.stringify({ jsonrpc: "2.0", ...o })); } catch {} };
function ask(key) {
  const x = m.subs.get(key);
  if (!x || m.ws?.readyState !== 1) return;
  const id = m.nextId++;
  x.sid = null; m.asked.set(id, key);
  send({ id, method: "accountSubscribe", params: [x.acct, { encoding: "base64", commitment: "processed" }] });
}
function sub(key, acct, fn) {
  if (!m.subs.has(key)) { m.subs.set(key, { acct, fn, sid: null }); if (!m.ws) connect(); else ask(key); }
  return () => {
    const x = m.subs.get(key);
    if (!x) return;
    m.subs.delete(key);
    if (x.sid != null) { m.byId.delete(x.sid); send({ id: m.nextId++, method: "accountUnsubscribe", params: [x.sid] }); }
  };
}
function close() {
  flushMeter();
  const old = m.ws; m.ws = null;
  m.asked.clear(); m.byId.clear();
  for (const x of m.subs.values()) x.sid = null;
  if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; try { old.close(); } catch {} }
}
function later() {
  if (m.retry || !url || overBudget || !m.subs.size) return;
  m.retry = setTimeout(connect, m.backoff);
  m.backoff = Math.min(m.backoff * 2, 30_000);
}
function connect() {
  clearTimeout(m.retry); m.retry = null;
  if (m.ws || !url || overBudget) return;
  m.url = url;
  let sock;
  try { m.ws = sock = new WebSocket(url); } catch { return later(); }
  sock.onopen = () => { if (m.ws !== sock) return; m.backoff = 1000; for (const k of m.subs.keys()) ask(k); };
  sock.onmessage = (msg) => {
    if (m.ws !== sock) return;
    const text = typeof msg.data === "string" ? msg.data : Buffer.from(msg.data).toString();
    bytes += Buffer.byteLength(text);
    let d; try { d = JSON.parse(text); } catch { return; }
    if (d.method && d.params && m.byId.has(d.params.subscription)) {
      const slot = d.params.result?.context?.slot;
      if (slot > lastSlot) lastSlot = slot;
      try { m.subs.get(m.byId.get(d.params.subscription))?.fn(d.params.result); } catch {}
    } else if (d.id != null && m.asked.has(d.id)) {
      const key = m.asked.get(d.id); m.asked.delete(d.id);
      const x = m.subs.get(key);
      if (d.error || d.result == null) return;
      if (!x) { send({ id: m.nextId++, method: "accountUnsubscribe", params: [d.result] }); return; }
      x.sid = d.result; m.byId.set(d.result, key);
    }
  };
  sock.onclose = () => { if (m.ws === sock) { close(); later(); } };
  sock.onerror = () => { if (m.ws === sock) { close(); later(); } };
}
function tidy() {
  if (m.ws && url !== m.url) { close(); connect(); }
  if ((!url || overBudget || !m.subs.size) && m.ws) close();
  if (url && !overBudget && m.subs.size && !m.ws) connect();
}
// Bytes and the newest slot go to the main thread in one message a second (its daily budget and lag figures).
let bytes = 0, lastSlot = 0;
function flushMeter() { if (bytes || lastSlot) post({ op: "meter", bytes, slot: lastSlot, url: m.url }); bytes = 0; lastSlot = 0; }
setInterval(flushMeter, 250).unref?.();

// ---------- pricing (as fastpx.js described) ----------
const guard = createPriceGuard();
const latest = new Map();
function emit(mint, mcSol, sol, buy, slot) {
  if (!guard.accept(mint, mcSol, slot)) return;
  latest.set(mint, { mcSol, at: now(), buy, slot });
  post({ op: "px", mint, mcSol, sol, buy, slot });
  const k = mult.get(mint), usd = solUsdOf.get(mint);
  if (k > 0 && usd > 0) push(mint, [mint, now(), +(mcSol * k).toPrecision(8), 0, buy ? 1 : 0, slot]);
}
const solUsdOf = new Map();   // mint -> SOL price in USD, posted with its multiplier

function watchCurve(mint, curve, w) {
  let lastSol = null;
  w.stops.push(sub(`curve:${mint}`, curve, (res) => {
    const b = Buffer.from(res?.value?.data?.[0] || "", "base64");
    if (b.length < 49) return;
    if (b[48] === 1) { unwatch(mint); post({ op: "done", mint }); return; }
    const vTok = Number(b.readBigUInt64LE(8)) / 1e6, vSol = Number(b.readBigUInt64LE(16)) / 1e9;
    if (!(vTok > 0)) return;
    const d = lastSol == null ? 0 : vSol - lastSol;
    lastSol = vSol;
    emit(mint, (vSol / vTok) * 1e9, Math.abs(d), d > 0, res?.context?.slot ?? null);
  }));
}

function watchPool(mint, baseV, quoteV, w, virt = 0) {
  const last = { base: null, quote: null }, slot = { base: null, quote: null }, delta = { base: 0, quote: 0 };
  let timer = null, k = null;
  const first = [];
  const settle = () => {
    timer = null;
    const dB = delta.base, dQ = delta.quote;
    delta.base = 0; delta.quote = 0;
    if (!(last.base > 0) || !(last.quote + virt > 0) || slot.base !== slot.quote) return;
    const ratio = ((last.quote + virt) / last.base) * 1e9;   // virt: the pool's virtual SOL (fastpx.js), part of its price
    const buy = dB < 0 && dQ > 0, sell = dB > 0 && dQ < 0;
    if ((buy || sell) && Math.abs(dQ) >= 0.0005) {
      const exec = (Math.abs(dQ) / Math.abs(dB)) * 1e9;
      if (k != null && (exec / (ratio * k) < 0.8 || exec / (ratio * k) > 1.25)) return emit(mint, ratio * k, Math.abs(dQ), buy, slot.quote);
      // Before k is known the ratio itself is the check (fastpx.js): a mispaired delta is drawn at the ratio.
      if (k == null && (exec / ratio < 0.6 || exec / ratio > 1.6)) return emit(mint, ratio, Math.abs(dQ), buy, slot.quote);
      if (k == null) { first.push(exec / ratio); if (first.length >= 3) k = first.sort((x, y) => x - y)[1]; }
      else k = k * 0.8 + (exec / ratio) * 0.2;
      return emit(mint, exec, Math.abs(dQ), buy, slot.quote);
    }
    if (k == null || (dB === 0 && dQ === 0)) return;
    emit(mint, ratio * k, Math.abs(dQ), dQ >= 0, slot.quote);
  };
  const on = (side, decimals) => (res) => {
    const v = Buffer.from(res?.value?.data?.[0] || "", "base64");
    if (v.length < 72) return;
    const amt = Number(v.readBigUInt64LE(64)) / 10 ** decimals, s = res?.context?.slot ?? null;
    if (last[side] != null) delta[side] += amt - last[side];
    last[side] = amt; slot[side] = s;
    if (slot.base === slot.quote && delta.base && delta.quote) { clearTimeout(timer); settle(); }
    else if (!timer) timer = setTimeout(settle, 120);
  };
  w.stops.push(sub(`vb:${mint}`, baseV, on("base", 6)));
  w.stops.push(sub(`vq:${mint}`, quoteV, on("quote", 9)));
}

function unwatch(mint) {
  const w = watches.get(mint);
  if (!w) return;
  for (const s of w.stops) try { s(); } catch {}
  watches.delete(mint);
  latest.delete(mint); mult.delete(mint); solUsdOf.delete(mint);
  tidy();
}

parentPort.on("message", (msg) => {
  if (msg.op === "cfg") { url = msg.url || ""; overBudget = Boolean(msg.overBudget); tidy(); }
  else if (msg.op === "mult") {
    const changed = mult.get(msg.mint) !== msg.k;
    mult.set(msg.mint, msg.k); solUsdOf.set(msg.mint, msg.solUsd);
    const quote = latest.get(msg.mint);
    if (changed && msg.k > 0 && quote && now() - quote.at < 60_000) push(msg.mint, [msg.mint, quote.at, +(quote.mcSol * msg.k).toPrecision(8), 0, quote.buy ? 1 : 0, quote.slot]);
  }
  else if (msg.op === "unwatch") unwatch(msg.mint);
  else if (msg.op === "watch") {
    if (watches.has(msg.mint)) return;
    const w = { kind: msg.kind, stops: [] };
    watches.set(msg.mint, w);
    if (msg.kind === "curve") watchCurve(msg.mint, msg.accts[0], w);
    else if (msg.kind === "pool") watchPool(msg.mint, msg.accts[0], msg.accts[1], w, msg.virt || 0);
  }
});

// ---------- the pages' stream ----------
const clients = new Map();   // mint -> Set(res)
function push(mint, row) {
  const set = clients.get(mint);
  if (!set?.size) return;
  const line = `event: trade\ndata: ${JSON.stringify({ u: [row] })}\n\n`;
  for (const res of set) try { if (res.writableLength > 128 * 1024) { res.end(); continue; } res.write(line); } catch {}
}
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), mint = u.searchParams.get("mint") || "";
  if (u.pathname !== "/api/fast/stream" || !MINT.test(mint)) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"not found"}'); }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
  res.socket?.setNoDelay?.(true);
  res.write(`event: hello\ndata: {"mint":"${mint}"}\n\n`);
  let set = clients.get(mint);
  if (!set) clients.set(mint, (set = new Set()));
  set.add(res);
  // The page is open: the main thread keeps (or starts) this coin's feed, asked now and every 5 s.
  post({ op: "want", mint });
  res.on("close", () => { set.delete(res); if (!set.size) clients.delete(mint); });
});
setInterval(() => {
  for (const [mint, set] of clients) { post({ op: "want", mint }); for (const res of set) try { if (res.writableLength > 128 * 1024) { res.end(); continue; } res.write("event: tick\ndata: {}\n\n"); } catch {} }
}, 5000).unref?.();
// A radar that is restarting may still hold the port for a moment: try again until it lets go.
server.on("error", (e) => { post({ op: "error", message: e.message }); if (e.code === "EADDRINUSE") setTimeout(() => server.listen(PORT, "127.0.0.1"), 2000); });
server.on("listening", () => post({ op: "error", message: null }));
server.listen(PORT, "127.0.0.1");
