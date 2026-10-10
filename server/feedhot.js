// "Hot right now" on the Feed page: the coins people posted about most in the last 1, 5, 15, 30 or 60 minutes.
// The feeds themselves hold only their newest few hundred posts (Fomo's ~200 reach back ~10 minutes on a busy
// day), so every read that lands (relayed from the PC or read here) is kept in an hour-long ledger, one entry per
// post id, and the ranking is counted from that. The ledger only listens: it never asks for a feed, so it never
// makes the PC read Fomo more than the people on the Feed page already do (fomofeed.js "wanted").
//
// `since` per source: from when the ledger has every post. A gap between two reads longer than GAP_MS (nobody on
// the Feed page, the PC away) may have lost posts, so coverage restarts at the oldest post of the next read.
import { onFomoFeed, peekFeed } from "./fomofeed.js";
import { onPumpFeed, peekPump } from "./pumpfeed.js";

const HOUR = 60 * 60_000, GAP_MS = 90_000, SOLANA = 1399811149, TOP = 30;
const now = () => Date.now();
const posts = new Map();   // id -> { src, t, mint, side, usd, name, pic, ticker, img, mc, chain }
const cover = { fomo: { since: null, last: 0 }, pump: { since: null, last: 0 } };

function ingest(list, src) {
  if (!Array.isArray(list) || !list.length) return;
  const t0 = now(), cut = t0 - HOUR, c = cover[src];
  let oldest = Infinity;
  for (const x of list) {
    if (!x?.id || !x.mint || x.chain !== SOLANA || !(x.t > cut)) continue;
    if (x.t < oldest) oldest = x.t;
    posts.set(x.id, { src, t: x.t, mint: x.mint, side: x.side || null, usd: Number(x.usd) || 0, name: x.user?.name || null, pic: x.user?.pic || null,
      ticker: x.ticker || null, img: x.img || null, mc: x.mc ?? null, chain: x.chain });
  }
  if (!c.since || t0 - c.last > GAP_MS) c.since = Number.isFinite(oldest) ? oldest : t0;
  c.last = t0;
}
onFomoFeed((key) => { try { ingest(peekFeed(key), "fomo"); } catch {} });
onPumpFeed(() => { try { ingest(peekPump(), "pump"); } catch {} });
setInterval(() => { const cut = now() - HOUR; for (const [id, p] of posts) if (p.t < cut) posts.delete(id); }, 60_000).unref();

// GET /api/feed/hot?w=15&src=fomo,pump → { w, since, top: [{ mint, ticker, img, mc, chain, n, buy, sell, people, traders, last }] }.
// since: null when the ledger covers the whole window for the chosen sources, else the time it counts from.
export function feedHot({ w, src } = {}) {
  const win = [1, 5, 15, 30, 60].includes(Number(w)) ? Number(w) : 30;
  const want = new Set(String(src || "fomo,pump").split(",").filter((s) => s === "fomo" || s === "pump"));
  if (!want.size) want.add("fomo").add("pump");
  const from = now() - win * 60_000;
  const by = new Map();
  for (const p of posts.values()) {
    if (p.t < from || !want.has(p.src)) continue;
    let g = by.get(p.mint);
    if (!g) { g = { mint: p.mint, ticker: p.ticker, img: p.img, mc: p.mc, mcT: p.t, chain: p.chain, n: 0, buy: 0, sell: 0, people: new Map(), names: new Set(), last: 0 }; by.set(p.mint, g); }
    g.n++;
    if (p.t > g.last) g.last = p.t;
    if (p.mc != null && p.t >= g.mcT) { g.mc = p.mc; g.mcT = p.t; }
    if (!g.img && p.img) g.img = p.img;
    if (!g.ticker && p.ticker) g.ticker = p.ticker;
    if (p.side === "buy") g.buy += p.usd; else if (p.side === "sell") g.sell += p.usd;
    if (p.name) g.names.add(p.name);
    if (p.name && g.people.size < 6 && !g.people.has(p.name)) g.people.set(p.name, p.pic);
  }
  const top = [...by.values()].sort((a, b) => b.n - a.n || b.names.size - a.names.size || b.last - a.last).slice(0, TOP)
    // traders: everyone who posted about it in the window (people: the first four, for their faces).
    .map(({ mcT, people, names, ...g }) => ({ ...g, buy: Math.round(g.buy), sell: Math.round(g.sell), people: [...people].slice(0, 4), traders: names.size }));
  let since = null;
  // A source that has sent nothing yet (down, or switched off at its end) is left out: it has no posts to miss.
  for (const s of want) { const c = cover[s]; if (c.since == null) continue; if (c.since > from && (since == null || c.since > since)) since = c.since; }
  return { w: win, since, top };
}
