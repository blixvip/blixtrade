// How far behind the chain each live feed's messages arrive, in slots (~0.2 s each since 2026, ~0.4 s before): the chain tip comes from a
// slotSubscribe on the public RPC (a few tiny messages a second) and from the newest slot any feed has named.
// Every feed notes the slot of each message it gets; the health page shows the median and 90th percentile of
// the last few hundred, so "the chart is slow" can be pinned to a feed, the radar or this PC's connection
// (on 2026-10-06 a saturated home connection put every feed, Helius and public alike, 20-50 slots behind).
import { startRpcStream } from "./rpc-stream.js";

let tip = 0, tipAt = 0;   // the newest slot seen and when it was seen
// How long a slot lasts, measured over the last couple of minutes of tips: the 400 ms this used to assume was
// twice the real ~215 ms by 2026-10-09, which placed a trade read 100 slots late 19 s too early on its chart.
const marks = [];          // [slot, ms], one every ~5 s
let msPerSlot = 400;
export const slotMs = () => msPerSlot;
function setTip(s) {
  tip = s; tipAt = Date.now();
  if (!marks.length || tipAt - marks[marks.length - 1][1] >= 5000) {
    marks.push([s, tipAt]);
    if (marks.length > 30) marks.shift();
    const [s0, t0] = marks[0];
    if (s - s0 >= 100) msPerSlot = Math.max(100, Math.min(600, (tipAt - t0) / (s - s0)));
  }
}
// When a slot happened, from the tip and the measured slot time: a trade from a feed running 10 s behind is
// placed in its own second, not the second it arrived (public nodes trail the chain by 20-40 slots at busy hours).
export const slotTime = (slot) => (slot > 0 && tip > 0 && tipAt ? Math.min(Date.now(), Math.round(tipAt - (tip - slot) * msPerSlot)) : null);
const rings = new Map();   // feed -> recent lags in slots
const latest = new Map();  // feed -> its newest message's slot
// How far this feed's newest message is behind the tip right now (null before it has any).
export const behindOf = (feed) => { const s = latest.get(feed); return s && tip ? tip - s : null; };
export function noteSlot(feed, slot) {
  if (!(slot > 0)) return;
  if (slot > tip) setTip(slot);
  if (slot > (latest.get(feed) || 0)) latest.set(feed, slot);
  let r = rings.get(feed);
  if (!r) rings.set(feed, (r = []));
  r.push(tip - slot);
  if (r.length > 400) r.splice(0, r.length - 300);
}
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
// "chart 1/3 · pump 2/5 · pumpswap 2/6 slots behind (p50/p90)", or "" before any message.
export function lagSummary() {
  const parts = [...rings].filter(([, r]) => r.length >= 10).map(([f, r]) => `${f} ${q(r, 0.5)}/${q(r, 0.9)}`);
  return parts.length ? `${parts.join(" · ")} slots behind the chain (p50/p90)` : "";
}

export function startFeedLag(url = () => "wss://api.mainnet-beta.solana.com") {
  return startRpcStream({ url, request: { method: "slotSubscribe" }, silentMs: 20_000, onEvent: (m) => { const s = m.params?.result?.slot; if (s > tip) setTip(s); } });
}
