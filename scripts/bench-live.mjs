// How far behind the chain an open coin page is. Each trade row the radar streams (`ctrade`, sent the same
// instant as the chart's `trade` push) carries the slot its transaction landed in; this script watches the
// chain's slots itself (slotSubscribe on the public RPC and, when set, the per-coin RPC: whichever reports a
// slot first) and measures, per row, the time from that slot's first sighting to the row reaching this client.
// A trade can be heard no earlier than its slot is processed, so a few hundred ms is where any feed starts.
// (A direct subscription to the coin is not a fair reference: on a busy coin it lagged the radar by seconds.)
// The page is simulated by asking for its candles and coin data, which keeps the coin "open" on the radar.
//   node scripts/bench-live.mjs <seconds> <mint> [mint...]
import { settings } from "../server/settings.js";

const R = process.env.RADAR || "http://localhost:4420";
const [secs = "60", ...mints] = process.argv.slice(2);
if (!mints.length) { console.log("usage: node scripts/bench-live.mjs <seconds> <mint> [mint...]"); process.exit(1); }
const clock = () => performance.now() + performance.timeOrigin;

// When each slot was first seen, from every source we have.
const slotAt = new Map(), socks = [];
for (const url of [String(settings.chartWsUrl || "").trim(), "wss://api.mainnet-beta.solana.com"].filter(Boolean)) {
  const ws = new WebSocket(url);
  socks.push(ws);
  ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "slotSubscribe" }));
  ws.onmessage = (m) => {
    const t = clock(), d = JSON.parse(m.data), s = d.params?.result?.slot;
    if (s != null && !slotAt.has(s)) slotAt.set(s, t);
  };
}

const lag = Object.fromEntries(mints.map((m) => [m, []])), srv = Object.fromEntries(mints.map((m) => [m, []])), chart = Object.fromEntries(mints.map((m) => [m, []]));
const counts = Object.fromEntries(mints.map((m) => [m, { rows: 0, noSlot: 0 }]));
const seen = new Set();
const ctl = new AbortController();
(async () => {
  const res = await fetch(R + "/api/stream", { signal: ctl.signal });
  const rd = res.body.getReader(), dec = new TextDecoder();
  let buf = "", ev = null;
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    const t = clock();
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith("event:")) { ev = line.slice(6).trim(); continue; }
      if (ev === "trade" && line.startsWith("data:")) {
        // The chart's own pushes: [mint, ms, mc, vol, buy, slot] (slot when the open chart's fast feed sent it).
        for (const u of JSON.parse(line.slice(5)).u) { const at = u[5] != null ? slotAt.get(u[5]) : null; if (chart[u[0]] && at != null) chart[u[0]].push(t - at); }
        continue;
      }
      if (ev !== "ctrade" || !line.startsWith("data:")) continue;
      for (const x of JSON.parse(line.slice(5)).u) {
        const c = counts[x.mint];
        if (!c) continue;
        const k = `${x.tx}|${x.side}|${x.tokens}`;
        if (x.tx && seen.has(k)) continue;
        if (x.tx) seen.add(k);
        c.rows++;
        const at = x.slot != null ? slotAt.get(x.slot) : null;
        if (at == null) { c.noSlot++; continue; }
        lag[x.mint].push(t - at);
        srv[x.mint].push(x.t - at);   // slot seen -> the radar read the trade (its own clock: same machine)
      }
    }
  }
})().catch(() => {});

// Keep the coins open on the radar, as a page does. Bodies are read in full: an unread body holds its
// connection, and the stream read above then stalls behind them.
const end = Date.now() + +secs * 1000;
while (Date.now() < end) {
  await Promise.all(mints.map((m) => Promise.all([`${R}/api/candles/${m}?tf=1`, `${R}/api/coin/${m}`].map((u) => fetch(u).then((r) => r.arrayBuffer()))).catch(() => {})));
  await new Promise((r) => setTimeout(r, 1000));
}
ctl.abort();
for (const s of socks) try { s.close(); } catch {}

const q = (a, p) => { if (!a.length) return "-"; const b = [...a].sort((x, y) => x - y); return Math.round(b[Math.min(b.length - 1, Math.floor(p * b.length))]); };
for (const m of mints) {
  const c = counts[m], l = lag[m], v = srv[m];
  console.log(`${m.slice(0, 8)}  rows ${c.rows} (${c.noSlot} without a slot) | slot seen -> on this client: p50 ${q(l, 0.5)} ms p90 ${q(l, 0.9)} ms p99 ${q(l, 0.99)} ms | of which slot -> radar read it: p50 ${q(v, 0.5)} p90 ${q(v, 0.9)}`);
  console.log(`          chart moves ${chart[m].length} | slot seen -> on this client: p50 ${q(chart[m], 0.5)} ms p90 ${q(chart[m], 0.9)} ms p99 ${q(chart[m], 0.99)} ms`);
}
process.exit(0);
