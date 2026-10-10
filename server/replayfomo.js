// Fomo in a replay (web/src/lib/replay.ts): every Fomo trader's buys and sells on the coin through the replay's
// day, and the theses posted in it, so the page can show the Known holders, their entries and PnL, the chart's
// faces and the theses as they stood at any moment of the replay. Fomo's coin read (fomoboard.js) keeps only the
// newest three feed pages; this pages /feed/token back to the start of the journal's window, a few pages per
// call through the same one-at-a-time Fomo queue (background priority), and keeps what it read in fomo_replay.
import { db } from "./db.js";
import { inFomo } from "./fomoboard.js";
import * as journal from "./journal.js";

const now = () => Date.now();
const SOL_NET = 1399811149, PAGES = 25, MAX_PAGES = 600, HEAD_MS = 60_000, KEEP_ROWS = 20_000;
db.exec("CREATE TABLE IF NOT EXISTS fomo_replay (mint TEXT PRIMARY KEY, data TEXT, t INTEGER)");
const getQ = db.prepare("SELECT data, t FROM fomo_replay WHERE mint = ?");
const putQ = db.prepare("INSERT INTO fomo_replay (mint, data, t) VALUES (?, ?, ?) ON CONFLICT(mint) DO UPDATE SET data = excluded.data, t = excluded.t");
db.prepare("DELETE FROM fomo_replay WHERE t < ?").run(now() - 2 * journal.KEEP_MS);

// Reads `pages` feed pages from `lastId` (null: the newest), stopping once a page reaches back past `stopT` (ms) or
// the feed ends. Swaps and theses come back trimmed to what the replay uses.
const body = (mint, lastId, stopT, pages) => `
  const out = { swaps: [], theses: [], lastId: ${JSON.stringify(lastId)}, more: true, pages: 0 };
  for (let i = 0; i < ${pages} && out.more; i++) {
    const f = await get("/feed/token?tokenAddress=${mint}&networkId=${SOL_NET}&threshold=0" + (out.lastId ? "&lastId=" + out.lastId : ""));
    const items = (f && f.items) || [];
    out.pages++;
    for (const x of items) {
      if ((x.type === "swap_buy" || x.type === "swap_sell") && x.userHandle) out.swaps.push({ id: x.id, t: x.createdAt, buy: x.type === "swap_buy", usd: x.usdAmount ?? null,
        price: x.price ?? null, mc: x.marketCap ?? x.fdv ?? null, handle: x.userHandle, name: x.displayName || null, pic: x.profilePictureLink || null, dev: !!x.isDev, verified: !!x.verified });
      else if (x.type === "thesis" && x.comment && x.userHandle) out.theses.push({ id: x.comment.id || x.id, text: x.comment.comment, likes: x.comment.numLikes ?? 0, mcap: x.comment.marketCapAtCreation ?? null,
        price: x.comment.priceUsdAtCreation ?? null, t: x.comment.createdAt || x.createdAt, handle: x.userHandle, name: x.displayName || null, pic: x.profilePictureLink || null, verified: !!x.verified, dev: !!x.isDev, replies: x.numReplies ?? 0, position: null });
    }
    if (!out.sample) { const s = items.find((x) => x.type === "swap_buy" || x.type === "swap_sell"); if (s) out.sample = Object.keys(s).join(","); }
    out.more = !!(f && f.hasNextPage && items.length);
    if (items.length) out.lastId = items[items.length - 1].id;
    if (${stopT} && items.length && Date.parse(items[items.length - 1].createdAt) < ${stopT}) break;
  }
  return out;`;

const state = new Map();   // mint -> { busy, error, at }
function merge(d, got) {
  const seen = new Set(d.swaps.map((x) => x.id)), seenT = new Set(d.theses.map((x) => x.id));
  for (const s of got.swaps) if (!seen.has(s.id)) { seen.add(s.id); d.swaps.push(s); }
  for (const s of got.theses) if (!seenT.has(s.id)) { seenT.add(s.id); d.theses.push(s); }
  d.swaps.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  if (d.swaps.length > KEEP_ROWS) d.swaps = d.swaps.slice(-KEEP_ROWS);
}
async function step(mint) {
  const st = state.get(mint) || {};
  st.busy = true; state.set(mint, st);
  try {
    const row = getQ.get(mint), since = now() - journal.KEEP_MS;
    const d = row ? JSON.parse(row.data) : { swaps: [], theses: [], oldestId: null, done: false, pages: 0, head: 0 };
    if (!d.done) {
      // Going back: from where the last call stopped, towards the start of the window.
      const got = await inFomo(body(mint, d.oldestId, since, PAGES), undefined, { pri: 1, timeoutMs: 90e3 });
      merge(d, got);
      d.oldestId = got.lastId; d.pages += got.pages; d.sample ||= got.sample;
      const oldest = d.swaps.length ? Date.parse(d.swaps[0].t) : now();
      d.done = !got.more || oldest < since || d.pages >= MAX_PAGES;
      if (!d.head) d.head = now();
    } else if (now() - d.head > HEAD_MS) {
      // Caught up: the newest trades since the last look (stops at the first page that reaches what is kept).
      const newest = d.swaps.length ? Date.parse(d.swaps[d.swaps.length - 1].t) : since;
      merge(d, await inFomo(body(mint, null, newest, 4), undefined, { pri: 1, timeoutMs: 30e3 }));
      d.head = now();
    }
    putQ.run(mint, JSON.stringify(d), now());
    st.error = null;
  } catch (e) { st.error = e.message; }
  finally { st.busy = false; st.at = now(); }
  // Until the window is read, the next batch follows by itself while the coin was asked about in the last 10 minutes.
  const d = getQ.get(mint);
  if (d && !JSON.parse(d.data).done && now() - (st.asked || 0) < 10 * 60_000) setTimeout(() => { if (!state.get(mint)?.busy) void step(mint); }, st.error ? 20_000 : 500);
}

// GET /api/replay/<mint>?part=fomo: { done, from, pages, swaps: [{ id, t, buy, usd, price, mc, handle, name, pic, dev }],
// theses, error }. Each ask moves the read along (the page asks every few seconds until `done`).
export function replayFomo(mint) {
  const st = state.get(mint) || {};
  st.asked = now(); state.set(mint, st);
  if (!st.busy && (!st.at || now() - st.at > (st.error ? 20_000 : 1000))) void step(mint);
  const row = getQ.get(mint), d = row ? JSON.parse(row.data) : null;
  return { mint, done: !!d?.done, pages: d?.pages || 0, from: d?.swaps?.length ? Date.parse(d.swaps[0].t) : null, error: st.error || null, sample: d?.sample || null,
    swaps: d?.swaps || [], theses: d?.theses || [] };
}
