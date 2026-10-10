// Fomo's live prices for the coins people are looking at. fomo.family's own pages hold one socket to
// prod-api.fomo.family/ws, sign it with the visitor's Privy token (challenge / challengeResponse), and subscribe a
// `prices` topic per coin (`<mint>:1399811149`): a `{type:"data", payload:{priceUsd, timestamp}}` message per
// tick, about one a second per coin while it trades. Blix holds the same socket from the server with its own
// Fomo token (fomochart.js) for every coin on the Pulse board and every open chart, and hands each tick to
// server.js as a market cap (price × supply), which goes out on the stream as `px`: the figure next to every coin
// moves at Fomo's pace, not the chain reader's.
import { fomoToken, supplyFor, fomoChartStats } from "./fomochart.js";

const WS = "wss://prod-api.fomo.family/ws";
const NET = 1399811149;
const MAX = 400;                 // subscriptions at most (the board is ~100 coins; charts a handful)
const RECONNECT_MAX_MS = 60_000;
const now = () => Date.now();

export const fomoPricesStats = { state: "off", cap: MAX, subs: 0, ticks: 0, opens: 0, drops: 0, lastTick: 0, lastError: null, accepted: false };

const listeners = new Set();
export const onFomoPrice = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// Fomo refuses a socket with too many topics ("Too many active topics", seen at ~360); its limit is learned here:
// each refusal lowers the cap, and the coins asked for first (open charts, then the board's top) keep their prices.
// It starts just under that, not at MAX: starting at MAX, every restart (each deploy) opened with dozens of refusals.
let cap = Math.min(MAX, 340);
// Coins Fomo said it cannot serve on this socket: not asked for again until the server restarts.
const refusedMints = new Set();
let ws = null, wanted = new Set(), subscribed = new Set(), connecting = false, epoch = 0, reconnectTimer = null, dead = 0, pausedUntil = 0, tok = null;

// The coins whose prices are wanted now; the socket follows (opens, subscribes, unsubscribes, closes when none).
export function wantFomoPrices(mints) {
  wanted = new Set([...mints].filter((m) => !refusedMints.has(m)).slice(0, cap));
  fomoPricesStats.subs = subscribed.size;
  if (!wanted.size) { if (ws) teardown(); return; }
  if (!ws || ws.readyState !== 1) { connect(); return; }
  // Coins that left go first: subscribing the newcomers before letting the old ones go took the socket over Fomo's
  // limit for a moment every 5 s, and each refusal ("Too many active topics", hundreds an hour) lowered the cap.
  for (const m of [...subscribed]) if (!wanted.has(m)) unsub(m);
  for (const m of wanted) if (!subscribed.has(m)) sub(m);
}
const send = (o) => { try { ws.send(JSON.stringify(o)); } catch {} };
function sub(m) { send({ type: "subscribe", topicType: "prices", topicId: `${m}:${NET}` }); subscribed.add(m); fomoPricesStats.subs = subscribed.size; }
function unsub(m) { send({ type: "unsubscribe", topicType: "prices", topicId: `${m}:${NET}` }); subscribed.delete(m); fomoPricesStats.subs = subscribed.size; }

function connect() {
  if (connecting || reconnectTimer || now() < pausedUntil || !wanted.size || (ws && ws.readyState !== 3)) return;
  connecting = true;
  open(++epoch);
}
async function open(myEpoch) {
  try { tok = await fomoToken(); } catch { tok = null; }
  if (myEpoch !== epoch) return;
  if (!tok) { connecting = false; fomoPricesStats.state = "no token"; later(15_000); return; }
  let s;
  try { s = new WebSocket(WS); } catch (e) { connecting = false; fomoPricesStats.lastError = e.message; gone(); return; }
  ws = s; fomoPricesStats.state = "connecting"; fomoPricesStats.accepted = false;
  s.addEventListener("open", () => { if (s !== ws) return; connecting = false; fomoPricesStats.opens++; fomoPricesStats.state = "open"; });
  s.addEventListener("message", (e) => message(s, e.data));
  s.addEventListener("close", (e) => closed(s, e));
  s.addEventListener("error", () => { if (s === ws) connecting = false; });
}
function message(s, data) {
  if (s !== ws) return;
  let m;
  try { m = JSON.parse(String(data)); } catch { return; }
  if (!m || typeof m !== "object") return;
  if (m.type === "challenge") { send({ type: "challengeResponse", jwt: tok }); return; }
  if (m.type === "challengeAccepted") {
    fomoPricesStats.accepted = true; fomoPricesStats.state = "live"; dead = 0;
    subscribed.clear();
    for (const mint of wanted) sub(mint);
    return;
  }
  if (m.type === "error") {
    // One coin Fomo will not serve ("Unable to subscribe") or too many coins at once ("Too many active topics"):
    // that coin is left out (or the cap lowered) and the socket stays up for the rest.
    fomoPricesStats.lastError = `Fomo's socket: error${m.message ? ` (${String(m.message).slice(0, 120)})` : ""}`;
    fomoPricesStats.lastRaw = String(data).slice(0, 300);
    if ((fomoPricesStats.errors = (fomoPricesStats.errors || 0) + 1) <= 5) console.log("fomoprices: " + fomoPricesStats.lastRaw);
    const mint = String(m.topicId || m.payload?.topicId || "").split(":")[0];
    if (/too many/i.test(String(m.message || ""))) {
      // Each subscription over the limit is refused on its own (code SUBSCRIBE_REJECTED, with its topicId): once
      // they are all back, what is left subscribed is exactly Fomo's limit.
      lastTooMany = now();
      if (mint) subscribed.delete(mint);
      cap = Math.max(20, Math.min(cap, subscribed.size));
      fomoPricesStats.cap = cap; fomoPricesStats.subs = subscribed.size;
      fomoPricesStats.lastError = `Fomo serves at most ${cap} coins per socket; the rest move with Blix's own prices`;
      wanted = new Set([...wanted].slice(0, cap));
    } else if (mint) { refusedMints.add(mint); subscribed.delete(mint); wanted.delete(mint); fomoPricesStats.refused = refusedMints.size; }
    return;
  }
  if (m.type === "challengeRejected" || m.type === "unauthorized") {
    fomoPricesStats.lastError = `Fomo's socket: ${m.type}${m.message ? ` (${String(m.message).slice(0, 120)})` : ""}`;
    fomoPricesStats.lastRaw = String(data).slice(0, 300);
    pausedUntil = now() + 10 * 60_000;
    try { s.close(); } catch {}
    return;
  }
  if (m.type === "data" && m.topicType === "prices" && m.payload) {
    const mint = String(m.topicId || "").split(":")[0], price = Number(m.payload.priceUsd);
    if (!mint || !(price > 0)) return;
    fomoPricesStats.ticks++; fomoPricesStats.lastTick = now();
    const supply = supplyFor(mint);
    if (!(supply > 0)) return;
    for (const fn of listeners) try { fn(mint, price * supply, price, Number(m.payload.timestamp) || null); } catch {}
  }
}
function closed(s) {
  if (s !== ws) return;
  connecting = false; ws = null; subscribed.clear(); fomoPricesStats.subs = 0; fomoPricesStats.state = "closed";
  if (!wanted.size) return;
  fomoPricesStats.drops++;
  if (fomoPricesStats.accepted) later(1000); else gone();
}
function gone() { dead++; later(Math.min(1000 * 2 ** dead, RECONNECT_MAX_MS)); }
function later(ms) { if (!reconnectTimer) reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, ms); }
function teardown() { epoch++; connecting = false; const s = ws; ws = null; subscribed.clear(); fomoPricesStats.subs = 0; fomoPricesStats.state = "off"; if (s) try { s.close(); } catch {} }

// The learned cap creeps back up (+10 every 10 minutes without a refusal), so a limit Fomo raises, or a cap lowered
// by a burst of refusals, is found again.
let lastTooMany = 0;
setInterval(() => { if (cap < MAX && now() - lastTooMany > 10 * 60_000) { cap = Math.min(MAX, cap + 10); fomoPricesStats.cap = cap; } }, 10 * 60_000).unref();

// A socket that has gone quiet for a minute while coins are wanted is opened again.
setInterval(() => { if (ws && ws.readyState === 1 && fomoPricesStats.accepted && wanted.size && now() - fomoPricesStats.lastTick > 60_000) { fomoPricesStats.lastError = "Fomo's socket went quiet; opened again."; try { ws.close(); } catch {} } }, 15_000).unref();

export const fomoPricesStatus = () => ({ ...fomoPricesStats, wanted: wanted.size, signedOut: fomoChartStats.signedOut, lastTickAgoS: fomoPricesStats.lastTick ? Math.round((now() - fomoPricesStats.lastTick) / 1000) : null });
