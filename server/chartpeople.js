// People on a coin's chart: every buy and sell on the coin by someone with a face, as on Axiom's chart. Two
// sources. pump.fun: the coin's trades (swap-api.pump.fun, public; the curve and PumpSwap alike), and each trading
// wallet looked up once in pump.fun's profiles (frontend-api-v3 users/batch, public, 100 a call); wallets with a
// pump.fun account become the person's name and picture. Fomo: the coin's Fomo trades (handle, picture, $ and
// market cap, from the Fomo coin read in fomoboard.js). Plus calls: pump.fun callouts and Fomo theses, at the
// market cap they were made. Read only while someone has the coin open; the newest trades every READ_MS, the
// older ones once (BACKFILL pages back), so a coin's whole recent history shows when its page opens.
import { db } from "./db.js";
import { supplyOf } from "./jup.js";
import { calloutsFor } from "./pumpfeed.js";
import { trades as chainTrades } from "./journal.js";
import { wantFomoFresh } from "./fomoboard.js";

const now = () => Date.now();
const H = { origin: "https://pump.fun", referer: "https://pump.fun/", "user-agent": "Mozilla/5.0" };
const READ_MS = 2_500, WANTED_MS = 30_000, BACKFILL = 20, KEEP_TRADES = 4000, PROFILE_TTL = 3 * 86400_000;
const PEOPLE = 8, FOMO = 60; // most-followed pump.fun people and biggest Fomo traders per coin (callers on top); only ones with a picture
const MIN_FOLLOWERS = 100; // a pump.fun account with fewer is nobody the reader would recognise

db.exec("CREATE TABLE IF NOT EXISTS pump_people (wallet TEXT PRIMARY KEY, name TEXT, pic TEXT, followers INTEGER, x TEXT, t INTEGER)");
const getP = db.prepare("SELECT name, pic, followers, x, t FROM pump_people WHERE wallet = ?");
const putP = db.prepare("INSERT INTO pump_people (wallet, name, pic, followers, x, t) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(wallet) DO UPDATE SET name = excluded.name, pic = excluded.pic, followers = excluded.followers, x = excluded.x, t = excluded.t");
const fomoCoin = db.prepare("SELECT data, t FROM fomo_coin WHERE mint = ?");
const profiles = new Map(); // wallet -> { name, pic, followers, x, t } (name null: no pump.fun account)
const notStored = new Set();  // wallets the database has no row for: asked once, not on every request

function profile(wallet) {
  let p = profiles.get(wallet);
  if (!p && !notStored.has(wallet)) {
    const r = getP.get(wallet);
    if (r) { p = r; profiles.set(wallet, p); } else { notStored.add(wallet); if (notStored.size > 100_000) notStored.clear(); }
  }
  return p && now() - p.t < PROFILE_TTL ? p : null;
}

const coins = new Map(); // mint -> { trades: Map(id -> trade), cursor, back, busy, wanted, t, error }
const get = async (url, opt = {}) => {
  const r = await fetch(url, { ...opt, headers: { ...H, ...(opt.headers || {}) }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`pump.fun answered ${r.status}.`);
  return r.json();
};

async function readPage(c, mint, cursor) {
  const j = await get(`https://swap-api.pump.fun/v2/coins/${mint}/trades?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
  for (const x of j.trades || []) {
    if (!x.userAddress || c.trades.has(x.slotIndexId)) continue;
    c.trades.set(x.slotIndexId, { t: Date.parse(x.timestamp), buy: x.type === "buy", wallet: x.userAddress, usd: +x.amountUsd || 0, price: +x.priceUsd || 0 });
  }
  return j.pagination?.hasMore ? j.pagination.nextCursor : null;
}

async function lookup(wallets) {
  for (let i = 0; i < wallets.length; i += 100) {
    const batch = wallets.slice(i, i + 100);
    const list = await get("https://frontend-api-v3.pump.fun/users/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addresses: batch }) });
    const found = new Map((Array.isArray(list) ? list : []).map((u) => [u.address, u]));
    for (const w of batch) {
      const u = found.get(w), ok = u && u.is_pump_user && !u.is_banned && u.username;
      const p = { name: ok ? u.username : null, pic: ok ? u.profile_image || null : null, followers: ok ? u.followers || 0 : 0, x: ok ? u.x_username || null : null, t: now() };
      profiles.set(w, p); notStored.delete(w); putP.run(w, p.name, p.pic, p.followers, p.x, p.t);
    }
  }
}

// pump.fun profiles for a set of wallets (the bubble map's holders): the known ones at once; the never-asked
// ones looked up in the background (one batch at a time, 300 wallets at most), so a later read has them.
let peopleBusy = false;
export function pumpPeople(wallets) {
  const out = new Map(), ask = [];
  for (const w of wallets) { const p = profile(w); if (p) { if (p.name) out.set(w, p); } else ask.push(w); }
  if (ask.length && !peopleBusy) { peopleBusy = true; lookup(ask.slice(0, 300)).catch(() => {}).finally(() => { peopleBusy = false; }); }
  return out;
}

async function refresh(mint, c) {
  c.busy = true;
  try {
    const next = await readPage(c, mint, null);
    if (c.back === undefined) c.back = next;
    // The older trades, once: a few pages a pass so the first answer comes quickly.
    for (let i = 0; i < 6 && c.back && c.pages < BACKFILL; i++, c.pages++) c.back = await readPage(c, mint, c.back);
    if (c.trades.size > KEEP_TRADES) { const keep = [...c.trades.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, KEEP_TRADES); c.trades = new Map(keep); }
    const unknown = [...new Set([...c.trades.values()].map((x) => x.wallet))].filter((w) => !profile(w));
    await lookup(unknown.slice(0, 500));
    c.t = now(); c.error = null;
  } catch (e) { c.error = e.name === "TimeoutError" ? "pump.fun took too long to answer." : e.message; }
  finally { c.busy = false; }
}

// GET /api/coin/<mint>/people: { people: [{ id, src, name, pic, followers, link }], trades: [{ t, buy, who, usd, mc }],
// calls: [{ t, who, mc, text, likes (Fomo theses) }] }, oldest first. Trades and calls name a person by id.
// The answer for a coin is worked out at most every 1.5 s (the page and the chart ask often; the trades under it
// change at most every READ_MS), and a Fomo read is parsed once per read, not per request.
const answers = new Map(); // mint -> { t, key, v }
const fomoParsed = new Map(); // mint -> { t, d }
export function coinPeople(mint) {
  const memo = answers.get(mint), cNow = coins.get(mint);
  if (memo && now() - memo.t < 1500 && memo.key === `${cNow?.t || 0}`) { if (cNow) cNow.wanted = now(); return memo.v; }
  const v = build(mint);
  answers.set(mint, { t: now(), key: `${coins.get(mint)?.t || 0}`, v });
  if (answers.size > 300) answers.delete(answers.keys().next().value);
  return v;
}
// Fomo sends its trades' times rounded down to 5 s, which put a face on the wrong 1s candle. Each Fomo trade is
// matched to the coin's own trade on chain (journal.js): same side, the same dollars within 5% or 50 cents (Fomo's
// figure includes its ~3% fee), from 1.5 s before to 6 s after Fomo's time (measured 2026-10-10: the chain trade
// is 0-5 s after it); its exact time and market cap are used. Kept per coin; a trade not matched yet is tried again
// for a minute (the chain trade may land after Fomo's), then keeps Fomo's own time.
const fomoSeen = new Map(); // mint -> Map(swapKey -> Fomo trade)
const matched = new Map(); // mint -> { by: Map(swapKey -> { t, mc } | { miss: firstTry }), used: Set(chain trade) }
function exactFomo(mint, s, ft) {
  let m = matched.get(mint);
  if (!m) { m = { by: new Map(), used: new Set() }; matched.set(mint, m); if (matched.size > 300) matched.delete(matched.keys().next().value); }
  const key = `${s.handle}|${s.t}|${s.usd}|${s.buy ? 1 : 0}`, had = m.by.get(key);
  if (had?.t) return had;
  if (had?.miss && now() - had.miss > 60_000) return null;
  let rows = [];
  try { rows = chainTrades(mint, ft - 1500, ft + 6000); } catch { rows = []; }
  let best = null, score = Infinity;
  for (const x of rows) {
    const id = `${x.t}|${x.usd}|${x.buy}`;
    if (m.used.has(id) || Boolean(x.buy) !== Boolean(s.buy)) continue;
    const du = Math.abs(x.usd - (s.usd || 0));
    if (!(s.usd > 0) || (du > s.usd * 0.05 && du > 0.5)) continue;
    const sc = Math.abs(du / s.usd - 0.03) * 10 + Math.abs(x.t - (ft + 2500)) / 8000;
    if (sc < score) { score = sc; best = { x, id }; }
  }
  if (!best) { if (!had) m.by.set(key, { miss: now() }); return null; }
  m.used.add(best.id);
  const out = { t: best.x.t, mc: best.x.mc };
  m.by.set(key, out);
  if (m.by.size > 5000) { m.by.clear(); m.used.clear(); }
  return out;
}

function build(mint) {
  let c = coins.get(mint);
  if (!c) { c = { trades: new Map(), back: undefined, pages: 0, busy: false, wanted: 0, t: 0, error: null }; coins.set(mint, c); }
  c.wanted = now();
  if (!c.busy && now() - c.t > READ_MS) refresh(mint, c);
  const supply = supplyOf(mint) || 1e9;
  const people = new Map(), trades = [], calls = [];
  const person = (id, v) => { const p = people.get(id) || { id, ...v, n: 0 }; p.n++; people.set(id, p); return id; };

  // Fomo: its trades and theses on this coin, as Fomo sent them.
  const row = fomoCoin.get(mint), fp = fomoParsed.get(mint);
  let f = null;
  if (row && fp?.t === row.t) f = fp.d;
  else if (row) { try { f = JSON.parse(row.data); } catch { f = null; } fomoParsed.set(mint, { t: row.t, d: f }); if (fomoParsed.size > 300) fomoParsed.delete(fomoParsed.keys().next().value); }
  wantFomoFresh(mint);   // someone has the coin open: its Fomo trades read again every 20 s
  // Every Fomo trade seen on this coin (a day), not only the latest read's: a read holds Fomo's newest three feed
  // pages, so on a busy coin a read every 20 s would drop the older faces off the chart.
  let seen = fomoSeen.get(mint);
  if (!seen) { seen = new Map(); fomoSeen.set(mint, seen); if (fomoSeen.size > 300) fomoSeen.delete(fomoSeen.keys().next().value); }
  for (const s of f?.swaps || []) if (s.handle && s.t) seen.set(`${s.handle}|${s.t}|${s.usd}|${s.buy ? 1 : 0}`, s);
  if (seen.size > 3000) for (const [k, s] of seen) { if (now() - Date.parse(s.t) > 86400_000 || seen.size > 3000) seen.delete(k); else break; }
  const swaps = [...seen.values()].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const fomoUsd = new Map();
  for (const s of swaps) if (s.handle && s.pic) fomoUsd.set(s.handle, (fomoUsd.get(s.handle) || 0) + (s.usd || 0));
  const fomoTop = new Set([...fomoUsd.entries()].sort((a, b) => b[1] - a[1]).slice(0, FOMO).map(([h]) => h));
  for (const s of swaps) {
    if (!fomoTop.has(s.handle)) continue;
    const ft = Date.parse(s.t);
    if (!Number.isFinite(ft)) continue;
    const ex = exactFomo(mint, s, ft);
    trades.push({ t: ex ? ex.t : ft, exact: Boolean(ex), buy: s.buy, usd: s.usd, mc: ex?.mc ?? s.mc, who: person(`fomo:${s.handle}`, { src: "fomo", name: s.name || s.handle, pic: s.pic, followers: 1e9, link: `https://fomo.family/profile/${encodeURIComponent(s.handle)}`, dev: s.dev }) });
  }
  for (const x of f?.theses || []) {
    if (!x.handle || !x.t) continue;
    calls.push({ t: Date.parse(x.t), mc: x.mcap ?? null, text: x.text, likes: x.likes ?? null, who: person(`fomo:${x.handle}`, { src: "fomo", name: x.name || x.handle, pic: x.pic, followers: 1e9, link: `https://fomo.family/profile/${encodeURIComponent(x.handle)}` }) });
  }
  // pump.fun callouts on this coin.
  for (const x of calloutsFor(mint)) {
    calls.push({ t: x.posted, mc: x.entryMc, text: x.comment, who: person(`pump:${x.user.pump}`, { src: "pump", name: x.user.name, pic: x.user.pic, followers: 1e8, link: `https://pump.fun/profile/${encodeURIComponent(x.user.pump)}` }) });
  }
  // pump.fun accounts trading the coin: the most-followed PEOPLE of them (callers and Fomo people always).
  const byWallet = new Map();
  for (const x of c.trades.values()) { const p = profile(x.wallet); if (p?.name && p.pic && p.followers >= MIN_FOLLOWERS) { const l = byWallet.get(x.wallet) || []; l.push(x); byWallet.set(x.wallet, l); } }
  // A wallet trading the coin more than 12 times is a bot (pump.fun's own Mayhem_Mode trades new coins hundreds of times).
  for (const [w, l] of byWallet) if (l.length > 12) byWallet.delete(w);
  const ranked = [...byWallet.keys()].sort((a, b) => (profile(b).followers || 0) - (profile(a).followers || 0));
  let room = PEOPLE;
  for (const w of ranked) {
    const p = profile(w), id = `pump:${p.name}`;
    if (!people.has(id)) { if (room <= 0) continue; room--; }
    for (const x of byWallet.get(w)) trades.push({ t: x.t, buy: x.buy, usd: x.usd, mc: x.price * supply, who: person(id, { src: "pump", name: p.name, pic: p.pic, followers: p.followers, link: `https://pump.fun/profile/${encodeURIComponent(p.name)}`, wallet: w }) });
  }
  trades.sort((a, b) => a.t - b.t); calls.sort((a, b) => a.t - b.t);
  return { mint, t: c.t || null, loading: !c.t && c.busy, error: c.error, people: [...people.values()], trades: trades.slice(-600), calls: calls.slice(-60) };
}

// Forget coins nobody has looked at in a while; keep reading the ones open.
setInterval(() => {
  for (const [m, c] of coins) {
    if (now() - c.wanted > 10 * 60_000) { coins.delete(m); continue; }
    if (!c.busy && now() - c.wanted < WANTED_MS && now() - c.t > READ_MS) refresh(m, c);
  }
  if (profiles.size > 50_000) profiles.clear();
}, 1_000).unref();
