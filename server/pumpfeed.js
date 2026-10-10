// pump.fun's callouts (the "Hot callouts" panel on pump.fun's home page): traders posting a thesis on a coin
// they hold, with their live position, profit and follow-up updates. pump.fun serves it to anyone
// (GET frontend-api-v3.pump.fun/home-feed), so it is read straight from the server, no browser needed. Reads only
// run while someone has the Feed page open (asked in the last WANTED_MS), at least REFRESH_MS apart. Items are
// kept and merged by callout id, so the page keeps what it already showed when pump.fun's ranked list moves on.
const URL = "https://frontend-api-v3.pump.fun/home-feed?pageSize=150&chain=all&platform=WEB";
const SOLANA = 1399811149; // Fomo's network id for Solana; the Feed page draws both sources with it
const REFRESH_MS = 1_200, WANTED_MS = 45_000, KEEP = 300, SHOW = 150;
const now = () => Date.now();
const items = new Map(); // calloutId -> item
let shown = new Set();   // the ids the last answer carried: a post stays until it leaves the kept set, never flickers out
let t = 0, wanted = 0, running = false, error = null;
// Told after every read: server/feedstream.js pushes what changed.
const listeners = new Set();
export const onPumpFeed = (fn) => (listeners.add(fn), () => listeners.delete(fn));

const num = (v) => (v == null || v === "" || !isFinite(+v) ? null : +v);
// Figures as the page shows them (4 significant digits, dollars to the cent): a position's value moves with
// every trade, and only a move the page would draw is worth sending down the stream (feedstream.js sends what
// changed, so the rest of the row is quiet).
const sig4 = (v) => (v == null ? null : v === 0 ? 0 : Number(v.toPrecision(4)));
const cents = (v) => (v == null ? null : Math.round(v * 100) / 100);
const time = (s) => Date.parse(s) || null;

// One callout, slimmed to the Feed page's item shape (same fields as server/fomofeed.js, source "pump").
function slim(c) {
  const p = c.position, co = p?.callout;
  if (!co?.calloutId) return null;
  const updates = (co.updates || []).map((u) => ({ id: u.id, text: u.content || "", t: time(u.createdAt), media: u.mediaUrl || null }))
    .filter((u) => u.text || u.media).sort((a, b) => (a.t || 0) - (b.t || 0));
  const posted = time(co.calloutTimestamp);
  return {
    id: `pump:${co.calloutId}`, source: "pump", type: p.contentKind === "quote" ? "pump_quote" : "pump_callout",
    // Newest activity first: a fresh update brings the callout back to the top, as on pump.fun.
    t: Math.max(posted || 0, ...updates.map((u) => u.t || 0)) || null, posted,
    pinned: false, likes: co.likes || 0, replies: co.replyCount || co.commentCount || 0, views: sig4(co.viewCount || 0),
    user: { handle: null, pump: p.userName || null, name: p.userName || "anon", pic: p.profileImage || p.xProfileImage || null, verified: Boolean(p.verifiedBadgeVisible || p.isVerified), x: p.xUsername || null },
    chain: SOLANA, mint: c.coinMint, ticker: c.symbol || null, name: c.coinName || null, img: c.coinImage || null, mc: sig4(num(c.marketCap)), price: sig4(num(p.tokenPriceUsd)),
    comment: co.thesis || null, media: co.mediaUrl || null, updates: updates.slice(-100),
    entryMc: sig4(num(co.calledOutAtMcap)), multiple: cents(num(co.multiple)), maxMultiple: cents(num(co.maxMultiplier)),
    sizeUsd: cents(num(p.valueUsd) ?? (num(p.costBasisUsd) != null && num(p.pnlUsd) != null ? num(p.costBasisUsd) + num(p.pnlUsd) - (num(p.realizedPnlUsd) || 0) : null)), costUsd: cents(num(p.costBasisUsd)), pnlUsd: cents(num(p.pnlUsd)), pnlPct: cents(num(p.pnlPercentage)),
    quoted: p.quote?.callout?.thesis || co.quotedCallout?.thesis || null,
  };
}

async function refresh() {
  running = true;
  try {
    const r = await fetch(URL, { headers: { origin: "https://pump.fun", referer: "https://pump.fun/", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`pump.fun answered ${r.status}.`);
    const j = await r.json();
    if (!Array.isArray(j?.coins)) throw new Error("pump.fun did not send its callouts.");
    // Solana only, like the rest of Blix (pump.fun also lists Ethereum, BNB and stock coins here).
    for (const c of j.coins) { if (c.chain !== "solana") continue; const s = slim(c); if (s) items.set(s.id, s); }
    if (items.size > KEEP) {
      const keep = [...items.values()].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, KEEP);
      items.clear(); for (const s of keep) items.set(s.id, s);
    }
    t = now(); error = null;
  } catch (e) { error = e.name === "TimeoutError" ? "pump.fun took too long to answer." : e.message; }
  finally { running = false; for (const fn of listeners) try { fn(); } catch {} }
}

// GET /api/pump/feed: pump.fun's callouts, newest activity first. null items until the first read finishes.
// Every kept callout, without asking for a read (feedhot.js).
export const peekPump = () => [...items.values()];

export function pumpFeed() {
  wanted = now();
  if (!running && now() - t > REFRESH_MS) refresh();
  if (!t) return { items: null, t: null, loading: running, error };
  // The newest SHOW, plus any the last answer carried that are still kept: a post that slips to 151st by a
  // newer one's update stays on the page instead of vanishing and coming back (the rest are kept only so a
  // quiet minute does not empty the list).
  const all = [...items.values()].sort((a, b) => (b.t || 0) - (a.t || 0));
  const out = all.filter((it, i) => i < SHOW || shown.has(it.id));
  shown = new Set(out.map((it) => it.id));
  return { items: out.map(lean), t, loading: running, error };
}
// A callout as the Feed page draws it: without what only the coin page and its chart use (calloutsFor below
// keeps the whole item). About a fifth off every list and change sent down the stream.
const leaned = new WeakMap();
function lean(it) {
  let l = leaned.get(it);
  if (!l) { const { name, posted, costUsd, maxMultiple, price, user, ...rest } = it; l = { ...rest, user: user && { handle: user.handle, pump: user.pump, name: user.name, pic: user.pic, verified: user.verified } }; leaned.set(it, l); }
  return l;
}

// Every callout on one coin (the coin page's Theses tab and its chart): pump.fun's positions with a thesis
// (GET frontend-api-v3 mint-positions/<mint>?withThesis=true, public), read while someone looks, at most every 8 s.
const byCoin = new Map(); // mint -> { t, items, busy, error, wanted }
async function readCoin(mint, c) {
  c.busy = true;
  try {
    const r = await fetch(`https://frontend-api-v3.pump.fun/mint-positions/${mint}?sortBy=TOP&withThesis=true&pageSize=50`, { headers: { origin: "https://pump.fun", referer: "https://pump.fun/", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(`pump.fun answered ${r.status}.`);
    const j = await r.json();
    c.items = (j.positions || []).filter((p) => p.callout?.thesis || p.callout?.mediaUrl).map((p) => slim({ coinMint: mint, chain: "solana", position: { ...p, contentKind: "callout" } })).filter(Boolean);
    c.total = c.items.length; c.t = now(); c.error = null;
  } catch (e) { c.error = e.name === "TimeoutError" ? "pump.fun took too long to answer." : e.message; }
  finally { c.busy = false; }
}
// GET /api/coin/<mint>/callouts: { items (newest activity first), total, t, error }. items null until the first read.
export function coinCallouts(mint) {
  let c = byCoin.get(mint);
  if (!c) { c = { t: 0, items: null, busy: false, error: null, total: null }; byCoin.set(mint, c); if (byCoin.size > 300) byCoin.delete(byCoin.keys().next().value); }
  if (!c.busy && now() - c.t > 8_000) readCoin(mint, c);
  return { items: c.items, total: c.total, t: c.t || null, error: c.error };
}
// The callouts seen on one coin (for its chart): the coin's own list when read, plus any from the home feed.
export function calloutsFor(mint) {
  const own = byCoin.get(mint)?.items || [], seen = new Set(own.map((x) => x.id));
  return [...own, ...[...items.values()].filter((x) => x.mint === mint && !seen.has(x.id))];
}

// While someone is looking, every REFRESH_MS; with nobody looking, every IDLE_MS, so the page's first
// screen is on hand the moment it opens instead of after a read of pump.fun (2-4 s).
const IDLE_MS = 30_000;
setInterval(() => { if (!running && now() - t > (now() - wanted < WANTED_MS ? REFRESH_MS : IDLE_MS)) refresh(); }, 250).unref();
