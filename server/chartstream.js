// Open charts get their own trade stream: one websocket to a fast RPC (a free Helius key is enough) carrying
// one small logsSubscribe per coin whose chart is open, at "processed", so a trade moves the chart within a
// slot of landing. The whole-market feeds (livetrades.js, pumpswap.js) stay on their own RPC: a program's full
// log stream is ~25x what Helius's free plan meters in a day, one coin's trades are a sliver of it.
// `mentions: [mint]` catches both a coin's curve trades and its PumpSwap pool trades (the mint is an account
// of either). The same decoders as the market feeds handle every message, and a transaction both deliver
// counts once (whichever copy lands first), so nothing is double counted.
// Processed means a transaction may still be dropped by a fork: the chart's periodic full reload from
// candles.js re-reads the stored history, and failed transactions are never counted (see pumpLogs).
import fs from "node:fs";
import { canStream, focusCoin } from './coin-screen.js';
import path from "node:path";
import { DATA, db } from "./db.js";
import { settings } from "./settings.js";
import { pumpLogs } from "./livetrades.js";
import { swapLogs } from "./pumpswap.js";
import { noteSlot } from "./feedlag.js";
import { activeUrl, noteBytes, rpcStreamAllowed, loadUsage, saveUsage, allSpent, anyKey, bytesToday, keyIndex, keyUrls } from "./heliuskeys.js";

const MAX_COINS = 12;           // charts open at once that get their own subscription
const IDLE_MS = 15_000;         // a chart not asked for in this long is unsubscribed
const now = () => Date.now();
const day = () => new Date().toISOString().slice(0, 10);

export const chartStream = { on: false, connected: false, coins: 0, msgs: 0, bytesToday: 0, day: day(), overBudget: false, error: null, lastMsg: 0, key: 0, keys: 0 };

const focus = new Map();        // mint -> last time its chart asked
const subs = new Map();         // mint -> subscription id (null while the request is out)
const byId = new Map();         // subscription id -> mint
const asked = new Map();        // request id -> mint, or { key } for an extra subscription
// Other per-coin subscriptions on the same socket and byte budget (holderslive.js: the coin's token accounts).
const extra = new Map();        // key -> { method, params, unsub, fn, sid }
const extraById = new Map();    // subscription id -> key
// Every log of an open coin, after the pump decoders (cointape.js reads swaps in other pools from these).
const logFns = [];
export const onCoinLogs = (fn) => logFns.push(fn);
let ws = null, nextId = 1, retry = null, backoff = 1000, urlInUse = "";

// The key in use: the first of the configured Helius keys with room left today and this month (heliuskeys.js).
// When it changes, the 5-second tick below (and count) move every socket to the new one.
const url = () => activeUrl();
export const chartWsUrl = url;

// Bytes received for the open charts, counted against the key's daily budget (fastlane.js's socket reports
// here too). `on`: the URL the bytes arrived on; the key in use when not given.
export function count(bytes, on = urlInUse || url(), priority = 'price') {
  noteBytes(on, bytes, priority);
  chartStream.day = day(); chartStream.bytesToday = bytesToday();
  if (allSpent()) {
    if (!chartStream.overBudget) {
      chartStream.overBudget = true; chartStream.error = "Helius pacing paused; market feeds continue; paid streams resume as credits become available";
      close(); side.close(); fast.close(); analytics.close();
    }
    return;
  }
  chartStream.overBudget = false;
  // The key just ran out for the day and another has room: start over on it right away.
  if (ws && url() !== urlInUse) { chartStream.error = `key ${keyIndex(urlInUse)} resting; moving to key ${keyIndex(url())}`; close(); connect(); }
}

function send(o) { try { ws?.readyState === 1 && ws.send(JSON.stringify({ jsonrpc: "2.0", ...o })); } catch {} }

// A coin in a Raydium / Orca / Meteora pool gets no subscription by mint: arbitrage bots name a big coin's
// mint dozens of times a second (STONK: ~33 transactions/s), none of it decodable here, and that flood slowed
// every other open chart from 0.3 s to 2.6 s behind the chain. Its trades come from its pool's own logs
// (cointape.js watchPoolLogs) and its price from the pool account (poolwatch.js).
const poolOnly = new Map();     // mint -> { v, t }
function inPool(mint) {
  const c = poolOnly.get(mint);
  if (c && now() - c.t < 60_000) return c.v;
  let v = false;
  try { const t = db.prepare("SELECT graduated, dex FROM tokens WHERE mint = ?").get(mint); v = Boolean(t?.graduated) && Boolean(t.dex) && t.dex !== "pumpswap" && t.dex !== "pumpfun"; } catch {}
  poolOnly.set(mint, { v, t: now() }); if (poolOnly.size > 500) poolOnly.delete(poolOnly.keys().next().value);
  return v;
}
function subscribe(mint) {
  if (subs.has(mint) || ws?.readyState !== 1 || inPool(mint)) return;
  const id = nextId++;
  subs.set(mint, null); asked.set(id, mint);
  send({ id, method: "logsSubscribe", params: [{ mentions: [mint] }, { commitment: "processed" }] });
}
function unsubscribe(mint) {
  const sid = subs.get(mint);
  subs.delete(mint);
  if (sid != null) { byId.delete(sid); send({ id: nextId++, method: "logsUnsubscribe", params: [sid] }); }
  chartStream.coins = subs.size;
}

function subscribeExtra(key) {
  const x = extra.get(key);
  if (!x || ws?.readyState !== 1) return;
  const id = nextId++;
  x.sid = null; asked.set(id, { key, unsub: x.unsub });
  send({ id, method: x.method, params: x.params });
}
// Keep another subscription while `key` lives: fn(result) on each notification. Returns stop.
// Logs (trades) ride this socket; anything else (a coin's token accounts, a pool's account) goes to the side
// socket below: a busy coin's account changes on the same socket held its trades back (p90 +1.3 s against a
// logs-only socket, measured on IA 2026-10-06; +0.17 s logs-only).
// `own`: keep it on the trade socket anyway (only the pump coins' own trades belong there). A busy pool's logs
// (cointape.js) are an arbitrage flood like the mint's and go to the side socket too: on one socket Helius
// delivers in order, and that flood put every open chart 5-15 s behind (2026-10-06).
export function streamSub(key, method, params, fn, own = false) {
  if (!url() || chartStream.overBudget) return null;
  if (method === "programSubscribe") return analytics.sub(key, method, params, fn);
  if (method !== "logsSubscribe" || !own) return sideSub(key, method, params, fn);
  if (extra.has(key)) return () => stopSub(key);
  extra.set(key, { method, params, unsub: method.replace("Subscribe", "Unsubscribe"), fn, sid: null });
  if (!ws) connect(); else subscribeExtra(key);
  return () => stopSub(key);
}
function stopSub(key) {
  const x = extra.get(key);
  if (!x) return;
  extra.delete(key);
  if (x.sid != null) { extraById.delete(x.sid); send({ id: nextId++, method: x.unsub, params: [x.sid] }); }
}

function close() {
  const old = ws; ws = null;
  subs.clear(); byId.clear(); asked.clear(); extraById.clear();
  for (const x of extra.values()) x.sid = null;
  chartStream.connected = false; chartStream.coins = 0;
  if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; try { old.close(); } catch {} }
}

function connect() {
  clearTimeout(retry); retry = null;
  if (ws || !url() || chartStream.overBudget) return;
  urlInUse = url(); chartStream.key = keyIndex(urlInUse);
  let sock;
  try { ws = sock = new WebSocket(urlInUse); } catch (e) { chartStream.error = e.message; return later(); }
  sock.onopen = () => {
    if (ws !== sock) return;
    chartStream.connected = true; chartStream.error = null; backoff = 1000;
    for (const m of focus.keys()) subscribe(m);
    for (const k of extra.keys()) subscribeExtra(k);
  };
  sock.onmessage = (msg) => {
    if (ws !== sock) return;
    const text = typeof msg.data === "string" ? msg.data : Buffer.from(msg.data).toString();
    count(Buffer.byteLength(text), sock.url);
    let d; try { d = JSON.parse(text); } catch { return; }
    if (d.method === "logsNotification" && !extraById.has(d.params?.subscription)) {
      chartStream.msgs++; chartStream.lastMsg = now();
      if (!byId.has(d.params?.subscription)) return;
      const v = d.params.result?.value, slot = d.params.result?.context?.slot ?? null;
      noteSlot("chart", slot);
      pumpLogs(v, slot); swapLogs(v, slot);
      const mint = byId.get(d.params.subscription);
      for (const fn of logFns) try { fn(mint, v, slot); } catch {}
    } else if (d.method && d.params && extraById.has(d.params.subscription)) {
      chartStream.msgs++; chartStream.lastMsg = now();
      try { extra.get(extraById.get(d.params.subscription))?.fn(d.params.result); } catch {}
    } else if (d.id != null && asked.has(d.id) && typeof asked.get(d.id) === "object") {
      const { key, unsub } = asked.get(d.id); asked.delete(d.id);
      const x = extra.get(key);
      if (d.error || d.result == null) { chartStream.error = d.error?.message || "subscription refused"; return; }
      if (!x) { send({ id: nextId++, method: unsub, params: [d.result] }); return; }   // stopped meanwhile
      x.sid = d.result; extraById.set(d.result, key);
    } else if (d.id != null && asked.has(d.id)) {
      const mint = asked.get(d.id); asked.delete(d.id);
      if (d.error || d.result == null) { subs.delete(mint); chartStream.error = d.error?.message || "subscription refused"; return; }
      if (!subs.has(mint)) { send({ id: nextId++, method: "logsUnsubscribe", params: [d.result] }); return; }   // closed meanwhile
      subs.set(mint, d.result); byId.set(d.result, mint); chartStream.coins = subs.size;
    }
  };
  sock.onclose = () => { if (ws === sock) { close(); later(); } };
  sock.onerror = () => { if (ws === sock) { chartStream.error = "connection failed"; close(); later(); } };
}
function later() {
  if (retry || !url() || chartStream.overBudget) return;
  retry = setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 30_000);
}

// ---------- extra sockets: per-coin subscriptions kept off the trade socket ----------
// One multiplexed websocket per role, all on the per-coin RPC and its daily byte budget. `side`: a coin's token
// accounts (holders) and its pool's logs and account (Raydium / Orca / Meteora), heavy on busy coins. `fast`:
// only the few small accounts that price an open chart (fastpx.js), so nothing heavy ever queues in front of
// them: on one socket Helius delivers in order, and a busy connection's backlog delays everything on it.
function mux(tag) {
  const m = { ws: null, nextId: 1, asked: new Map(), byId: new Map(), subs: new Map(), retry: null, backoff: 1000, url: "" };
  const endpoint = () => tag === 'analytics' ? keyUrls().find(rpcStreamAllowed) || '' : url();
  const send = (o) => { try { m.ws?.readyState === 1 && m.ws.send(JSON.stringify({ jsonrpc: "2.0", ...o })); } catch {} };
  const ask = (key) => {
    const x = m.subs.get(key);
    if (!x || m.ws?.readyState !== 1) return;
    const id = m.nextId++;
    x.sid = null; m.asked.set(id, { key, unsub: x.unsub });
    send({ id, method: x.method, params: x.params });
  };
  m.sub = (key, method, params, fn) => {
    if (!m.subs.has(key)) {
      m.subs.set(key, { method, params, unsub: method.replace("Subscribe", "Unsubscribe"), fn, sid: null });
      if (!m.ws) m.connect(); else ask(key);
    }
    return () => {
      const x = m.subs.get(key);
      if (!x) return;
      m.subs.delete(key);
      if (x.sid != null) { m.byId.delete(x.sid); send({ id: m.nextId++, method: x.unsub, params: [x.sid] }); }
    };
  };
  m.close = () => {
    const old = m.ws; m.ws = null;
    m.asked.clear(); m.byId.clear();
    for (const x of m.subs.values()) x.sid = null;
    if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; try { old.close(); } catch {} }
  };
  const later = () => {
    if (m.retry || !endpoint() || chartStream.overBudget || !m.subs.size) return;
    m.retry = setTimeout(m.connect, m.backoff);
    m.backoff = Math.min(m.backoff * 2, 30_000);
  };
  m.connect = () => {
    clearTimeout(m.retry); m.retry = null;
    if (m.ws || !endpoint() || chartStream.overBudget || !m.subs.size) return;
    m.url = endpoint();
    let sock;
    try { m.ws = sock = new WebSocket(m.url); } catch { return later(); }
    sock.onopen = () => { if (m.ws !== sock) return; m.backoff = 1000; for (const k of m.subs.keys()) ask(k); };
    sock.onmessage = (msg) => {
      if (m.ws !== sock) return;
      const text = typeof msg.data === "string" ? msg.data : Buffer.from(msg.data).toString();
      count(Buffer.byteLength(text), m.url, tag === 'analytics' ? 'metrics' : 'price');
      if (m.ws !== sock) return;
      if (endpoint() !== m.url) { m.close(); m.connect(); return; }
      let d; try { d = JSON.parse(text); } catch { return; }
      if (d.method && d.params && m.byId.has(d.params.subscription)) {
        chartStream.msgs++;
        noteSlot(tag, d.params.result?.context?.slot);
        try { m.subs.get(m.byId.get(d.params.subscription))?.fn(d.params.result); } catch {}
      } else if (d.id != null && m.asked.has(d.id)) {
        const { key, unsub } = m.asked.get(d.id); m.asked.delete(d.id);
        const x = m.subs.get(key);
        if (d.error || d.result == null) { chartStream.error = d.error?.message || "subscription refused"; return; }
        if (!x) { send({ id: m.nextId++, method: unsub, params: [d.result] }); return; }   // stopped meanwhile
        x.sid = d.result; m.byId.set(d.result, key);
      }
    };
    sock.onclose = () => { if (m.ws === sock) { m.close(); later(); } };
    sock.onerror = () => { if (m.ws === sock) { m.close(); later(); } };
  };
  // Settings changed (or were cleared), or nothing is subscribed: let the socket go.
  m.tidy = () => {
    const next = endpoint();
    if (m.ws && (next !== m.url || !m.subs.size || chartStream.overBudget)) m.close();
    if (!m.ws && next && m.subs.size && !chartStream.overBudget && !m.retry) m.connect();
  };
  return m;
}
const side = mux("side"), fast = mux("fast"), analytics = mux("analytics");
const sideSub = side.sub;
// The open charts' price accounts (fastpx.js): their own socket.
export const fastSub = (key, method, params, fn) => (!url() || chartStream.overBudget ? null : fast.sub(key, method, params, fn));

// A chart asked for this coin's candles: keep (or start) its stream.
export function focusChart(mint) {
  focusCoin(mint);
  if (!canStream(mint)) { focus.delete(mint); unsubscribe(mint); return; }
  if (!url()) return;
  if (!focus.has(mint) && focus.size >= MAX_COINS) {
    const oldest = [...focus].sort((a, b) => a[1] - b[1])[0][0];
    focus.delete(oldest); unsubscribe(oldest);
  }
  focus.set(mint, now());
  if (!ws) connect(); else subscribe(mint);
}

export function startChartStream() {
  loadUsage();
  chartStream.bytesToday = bytesToday(); chartStream.overBudget = allSpent(); chartStream.keys = keyUrls().length;
  if (chartStream.overBudget) chartStream.error = "Helius pacing paused; market feeds continue; paid streams resume as credits become available";
  setInterval(saveUsage, 1000).unref?.();
  chartStream.on = anyKey();
  setInterval(() => {
    chartStream.on = anyKey(); chartStream.keys = keyUrls().length;
    // Earned allowance, cooldown expiry or a confirmed monthly reset can release a key.
    if (chartStream.overBudget && !allSpent()) { chartStream.overBudget = false; chartStream.error = null; }
    chartStream.bytesToday = bytesToday();
    if (!ws) chartStream.key = keyIndex(url());
    // What the side and fast sockets hold (the Health page: bytes with no chart open come from these).
    chartStream.side = { n: side.subs.size, on: Boolean(side.ws), keys: [...side.subs.keys()].slice(0, 12) };
    chartStream.fast = { n: fast.subs.size, on: Boolean(fast.ws), keys: [...fast.subs.keys()].slice(0, 12) };
    chartStream.analytics = { n: analytics.subs.size, on: Boolean(analytics.ws), keys: [...analytics.subs.keys()].slice(0, 12) };
    chartStream.extra = { n: extra.size, keys: [...extra.keys()].slice(0, 12) };
    // The key in use changed (Settings, a key's day used up, a key back after midnight): start over on the new one.
    if (ws && url() !== urlInUse) { close(); connect(); }
    if (!url() && ws) close();
    side.tidy(); fast.tidy(); analytics.tidy();
    for (const [m, t] of focus) if (now() - t > IDLE_MS || !canStream(m)) { focus.delete(m); unsubscribe(m); }
    if (!ws && (focus.size || extra.size) && url() && !chartStream.overBudget && !retry) connect();
    // Nothing open: let the socket go, so an idle radar streams nothing.
    if (!focus.size && !extra.size && ws) close();
  }, 5000).unref?.();
}
