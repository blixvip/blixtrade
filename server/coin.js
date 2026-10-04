// Coin page: what a full token page needs beyond /api/token/<mint>, as plain JSON for any front end
// (the classic app's #/coin/<mint> and the React one read the same thing).
//
// Recent trades come from the live curve feed: every pump.fun and LaunchLab trade passes through
// livetrades.js, so a ring of the last minutes is kept here for every coin that trades. Bonded coins trade
// in AMM pools the feed does not decode; their trades come from GeckoTerminal's public list instead.
// Holders, top traders and early buyers come from the holder ledger (holders.js), the dev's other coins
// from the launch log and the tokens table. Nothing here is estimated: a field Blix cannot know is null.
import { db } from "./db.js";
import { onLiveTrade, feed, liveStats } from "./livetrades.js";
import { books } from "./holders.js";
import { launchIndex } from "./engine.js";
import { rugcheck } from "./sources.js";
import { gtGet } from "./gtgate.js";
import { fastMcap, focusPrice, rugFigures } from "./pulse.js";

const now = () => Date.now();
const WINDOW = 30 * 60_000;         // coins are kept while they traded within this long (holders.js keeps its books as long)
const FOCUS_KEEP = 30 * 60_000;     // ... and for this long after its page was last open
const PER_COIN = 400;               // most recent trades kept per coin
const PER_FOCUS = 2000;             // ... while its page is open
const MAX_COINS = 4000;
const SUPPLY = 1e9;                 // every pump.fun and LaunchLab coin
const BUCKET = 15_000, FLOW_BUCKETS = 20; // 5 minutes of flow
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";

// mint -> { trades: [[t, buy 1|0, sol, tokens, mcSol, wallet, slot]], last, focus, wallets }
// wallets: wallet -> [tokens bought, tokens sold, SOL in, SOL out, first trade time], for average buy and
// sell prices. It starts when this module does, so a wallet whose first trade came earlier gets no average.
const tapes = new Map();
export const coinStats = { coins: 0, trades: 0, poolFetches: 0, poolErrors: 0 };

onLiveTrade((mint, s, sol, buy, x) => {
  let r = tapes.get(mint);
  if (!r) { r = { trades: [], last: 0, focus: 0, wallets: new Map(), flow: [] }; tapes.set(mint, r); }
  const t = now(), user = x?.user ?? null;   // null on feeds that do not name the trader (LaunchLab)
  r.trades.push([t, buy ? 1 : 0, sol, x?.tokens ?? null, s.mc, user, x?.slot ?? null]);
  // 5-minute flow in 15-second buckets, so a busy coin's figures do not depend on how many trades are kept.
  const k = Math.floor(t / BUCKET);
  let f = r.flow[r.flow.length - 1];
  if (!f || f.k !== k) { f = { k, b: 0, s: 0, bs: 0, ss: 0, w: new Set() }; r.flow.push(f); if (r.flow.length > FLOW_BUCKETS) r.flow.shift(); }
  if (buy) { f.b++; f.bs += sol; } else { f.s++; f.ss += sol; }
  if (user && f.w.size < 500) f.w.add(user);
  if (user && x.tokens > 0) {
    let w = r.wallets.get(user);
    if (!w) { w = [0, 0, 0, 0, t]; r.wallets.set(user, w); }
    if (buy) { w[0] += x.tokens; w[2] += sol; } else { w[1] += x.tokens; w[3] += sol; }
  }
  const cap = now() - r.focus < FOCUS_KEEP ? PER_FOCUS : PER_COIN;
  if (r.trades.length > cap + 100) r.trades.splice(0, r.trades.length - cap);
  r.last = now();
  coinStats.trades++;
});

function prune() {
  const t = now();
  for (const [m, r] of tapes) if (t - r.last > WINDOW && t - r.focus > FOCUS_KEEP) tapes.delete(m);
  if (tapes.size > MAX_COINS) [...tapes].sort((a, b) => a[1].last - b[1].last).slice(0, tapes.size - MAX_COINS).forEach(([m]) => tapes.delete(m));
  coinStats.coins = tapes.size;
}
setInterval(prune, 60_000).unref?.();

// Labels for wallets the user follows, refreshed at most every 30 s.
let labels = { t: 0, map: new Map() };
function labelOf(wallet) {
  if (now() - labels.t > 30_000) {
    const map = new Map();
    try { for (const w of db.prepare("SELECT address, label, source, fomo FROM wallets").all()) map.set(w.address, { label: w.label || null, source: w.source, fomo: !!w.fomo }); } catch {}
    labels = { t: now(), map };
  }
  return labels.map.get(wallet) || null;
}

const tokenRow = (mint) => db.prepare("SELECT mint, symbol, name, creator, pair, dex, price, mcap, graduated, vol_m5, buys_m5, sells_m5, safety, safety_score, safety_checked, pair_created, peak_mcap, price_t FROM tokens WHERE mint = ?").get(mint);
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

// The curve's last trade is the price while the coin is on it; once bonded, the curve goes quiet and the
// tracked pool price takes over.
const curveLive = (L, t) => Boolean(L) && !t?.graduated && now() - L.last < 30 * 60_000;
// SOL per token now, for valuing balances: the curve while on it, then the Pulse's pool price (Jupiter or
// DexScreener, seconds old) and last the radar's tracked price.
function priceSol(mint, t) {
  const L = liveStats(mint);
  if (curveLive(L, t) && feed.solUsd) return { sol: L.mc / feed.solUsd / SUPPLY, live: true };
  const fast = fastMcap(mint);
  if (fast > 0 && feed.solUsd) return { sol: fast / feed.solUsd / SUPPLY, live: true };
  if (t?.price > 0 && feed.solUsd) return { sol: t.price / feed.solUsd, live: false };
  return { sol: null, live: false };
}

// Who a wallet is on this coin: dev, sniper, bundle, a top-10 holder, a wallet you follow.
function tagger(mint, b, creator) {
  const top = new Set();
  if (b) [...b.bal].filter(([, w]) => w.b > 0.5).sort((x, y) => y[1].b - x[1].b).slice(0, 10).forEach(([w]) => top.add(w));
  return (wallet) => {
    if (!wallet) return { tag: null, top10: false, label: null };
    const tag = wallet === creator ? "dev" : b?.bundle.has(wallet) ? "bundle" : b?.snipers.has(wallet) ? "sniper" : null;
    const l = labelOf(wallet);
    return { tag, top10: top.has(wallet), label: l?.label || null, followed: Boolean(l), fomo: l?.fomo || false };
  };
}

// One wallet's line in the ledger, in SOL and USD at the current price.
function walletLine(wallet, w, p, tagOf, mine) {
  // Averages only when this module saw the wallet's first trade on the coin (else its totals are partial).
  const m = mine && mine[4] <= w.first + 2000 ? mine : null;
  const value = p.sol != null ? w.b * p.sol : null;
  const usd = (x) => x == null || !feed.solUsd ? null : +(x * feed.solUsd).toFixed(2);
  return {
    wallet, ...tagOf(wallet),
    tokens: Math.round(w.b), pct: +((w.b / SUPPLY) * 100).toFixed(3), maxPct: +((w.max / SUPPLY) * 100).toFixed(3),
    boughtSol: +w.in.toFixed(4), soldSol: +w.out.toFixed(4), valueSol: value == null ? null : +value.toFixed(4),
    pnlSol: value == null ? null : +(w.out + value - w.in).toFixed(4), realizedSol: m && m[0] > 0 ? +(m[3] - m[2] * (Math.min(m[1], m[0]) / m[0])).toFixed(4) : null,
    boughtUsd: usd(w.in), soldUsd: usd(w.out), valueUsd: usd(value), pnlUsd: usd(value == null ? null : w.out + value - w.in),
    avgBuyMc: m && m[0] > 0 && feed.solUsd ? Math.round((m[2] / m[0]) * SUPPLY * feed.solUsd) : null,
    avgSellMc: m && m[1] > 0 && feed.solUsd ? Math.round((m[3] / m[1]) * SUPPLY * feed.solUsd) : null,
    trades: w.n, first: w.first,
    status: w.b <= 0.5 ? "sold all" : w.b < w.max * 0.98 ? "sold some" : "holding",
  };
}

// A bonded coin's page reads RugCheck itself when the stored report cannot still be true (rugFigures in
// pulse.js): once a minute while the page is open, in the background, for this page only (the tokens
// table is the engine's). Until the first answer the figures stay unknown, not the stale ones.
const rugLive = new Map();   // mint -> { t: last attempt, at: last answer, s, busy }
function rugNow(mint) {
  let c = rugLive.get(mint);
  if (!c) { c = { t: 0, at: 0, s: null, busy: false }; rugLive.set(mint, c); }
  if (!c.busy && now() - c.t > 60_000) {
    c.busy = true; c.t = now();
    rugcheck(mint).then((s) => { c.s = s; c.at = now(); }, () => {}).finally(() => { c.busy = false; });
  }
  if (rugLive.size > 300) for (const [k, v] of rugLive) if (!v.busy && now() - v.t > 10 * 60_000) rugLive.delete(k);
  return c.s ? c : null;
}

const memo = new Map();
function cached(key, ms, fn) {
  const c = memo.get(key);
  if (c && now() - c.t < ms) return c.v;
  const v = fn();
  memo.set(key, { t: now(), v });
  if (memo.size > 500) for (const [k, x] of memo) if (now() - x.t > 180_000) memo.delete(k);
  return v;
}

// GET /api/coin/<mint>
export function coinPage(mint, { top = 100 } = {}) {
  const r = tapes.get(mint);
  if (r) r.focus = now();
  return cached(`page:${mint}:${top}`, 1000, () => build(mint, Math.min(Math.max(+top || 100, 10), 300)));
}

function build(mint, top) {
  const t = tokenRow(mint);
  const b = books.get(mint);
  const creator = launchIndex.get(mint)?.creator || t?.creator || null;
  const p = priceSol(mint, t);
  const tagOf = tagger(mint, b, creator);
  const L = liveStats(mint);
  const solUsd = feed.solUsd || null;

  // Last five minutes of flow: from the trade ring for curve coins, from the tracked 5m stats otherwise.
  let m5 = null;
  const ring = tapes.get(mint);
  const bonded = Boolean(t?.graduated) || (L?.progress ?? 0) >= 0.995;
  if (bonded) focusPrice(mint);   // its pool price every few seconds while this page is open (pulse.js)
  if (bonded && t?.vol_m5 != null) {
    m5 = { source: "tracked", buys: t.buys_m5, sells: t.sells_m5, buyUsd: null, sellUsd: null, volUsd: t.vol_m5, netUsd: null, traders: null };
  } else if (ring?.trades.length) {
    const from = Math.floor(now() / BUCKET) - FLOW_BUCKETS + 1, wallets = new Set();
    let buys = 0, sells = 0, buySol = 0, sellSol = 0;
    for (const f of ring.flow) {
      if (f.k < from) continue;
      buys += f.b; sells += f.s; buySol += f.bs; sellSol += f.ss;
      for (const w of f.w) wallets.add(w);
    }
    const u = (s) => solUsd ? Math.round(s * solUsd) : null;
    m5 = { source: "live", buys, sells, buyUsd: u(buySol), sellUsd: u(sellSol), volUsd: u(buySol + sellSol), netUsd: u(buySol - sellSol), traders: wallets.size };
  } else if (t?.vol_m5 != null) {
    m5 = { source: "tracked", buys: t.buys_m5, sells: t.sells_m5, buyUsd: null, sellUsd: null, volUsd: t.vol_m5, netUsd: null, traders: null };
  }

  let holders = null, traders = [], early = [];
  if (b) {
    const all = [...b.bal];
    const held = all.filter(([, w]) => w.b > 0.5).sort((x, y) => y[1].b - x[1].b);
    holders = {
      count: held.length, wallets: all.length, trades: b.trades, since: b.t0, last: b.last, genesis: b.genesis,
      // Trades in the AMM pool after bonding are not decoded, so a bonded coin's ledger is a picture of bonding time.
      frozen: Boolean(t?.graduated) || (L?.progress ?? 0) >= 0.995,
      partial: !b.genesis || b.unknownSells > 0 || b.over > 0,
      top10: +((held.slice(0, 10).reduce((s, [, w]) => s + w.b, 0) / SUPPLY) * 100).toFixed(2),
      list: held.slice(0, top).map(([wallet, w]) => walletLine(wallet, w, p, tagOf, ring?.wallets.get(wallet))),
    };
    if (p.sol != null) {
      traders = all.map(([wallet, w]) => [wallet, w, w.out + w.b * p.sol - w.in]).sort((x, y) => y[2] - x[2]).slice(0, 50).map(([wallet, w]) => walletLine(wallet, w, p, tagOf, ring?.wallets.get(wallet)));
    }
    early = all.filter(([, w]) => w.in > 0).sort((x, y) => x[1].first - y[1].first || (x[1].slot ?? 0) - (y[1].slot ?? 0)).slice(0, 50)
      .map(([wallet, w]) => ({ ...walletLine(wallet, w, p, tagOf, ring?.wallets.get(wallet)), slot: w.slot ?? null, afterFirstMs: w.first - b.t0 }));
  }

  // The dev: what they hold of this coin, and the other coins they launched.
  let dev = null;
  if (creator) {
    const w = b?.bal.get(creator);
    dev = { wallet: creator, ...(w ? { pct: +((w.b / SUPPLY) * 100).toFixed(3), maxPct: +((w.max / SUPPLY) * 100).toFixed(3), boughtSol: +w.in.toFixed(4), soldSol: +w.out.toFixed(4), sold: w.max > 0 ? (w.b < w.max * 0.02 ? "all" : w.b < w.max * 0.5 ? "part" : null) : null } : { pct: null }),
      coins: cached(`dev:${creator}`, 30_000, () => devCoins(creator, mint)) };
  }

  // Holder figures: the ledger while the coin is on the curve (it is the live picture), RugCheck's after
  // bonding, and only a reading that can still be true; for a bonded coin with none, a fresh one.
  const safety = parse(t?.safety);
  const onLedger = Boolean(holders) && !holders.frozen;
  let rf = t ? rugFigures({ ...t, graduated: bonded ? 1 : t.graduated }, safety || {}) : null, lpLocked = safety?.lpLockedPct ?? null;
  if (bonded && t && rf.holders == null && rf.top10 == null) {
    const fresh = rugNow(mint);
    if (fresh) { rf = rugFigures({ graduated: 1, safety_checked: fresh.at, safety_score: fresh.s.clean }, fresh.s); lpLocked = fresh.s.lpLockedPct ?? lpLocked; }
  }
  if (dev && bonded) dev.pct = rf?.dev ?? null;   // the ledger's figure is the dev's at bonding
  return {
    mint, symbol: t?.symbol || launchIndex.get(mint)?.symbol || null, name: t?.name || launchIndex.get(mint)?.name || null,
    solUsd, live: curveLive(L, t), onCurve: Boolean(L) && !t?.graduated,
    mcUsd: curveLive(L, t) ? Math.round(L.mc) : fastMcap(mint) ?? t?.mcap ?? (L ? Math.round(L.mc) : null),
    // How old the market cap above is: under a few seconds while it trades on the curve or the Pulse prices it.
    priceAgeMs: curveLive(L, t) ? now() - L.last : fastMcap(mint) != null ? 0 : t?.price_t ? now() - t.price_t : null,
    priceUsd: p.sol != null && solUsd ? p.sol * solUsd : t?.price ?? null,
    athUsd: Math.max(L?.ath || 0, t?.peak_mcap || 0) || null,
    progress: L?.progress ?? null, supply: SUPPLY,
    m5, holders, traders, early, dev,
    info: {
      holders: onLedger ? holders.count : rf?.holders ?? null,
      top10: onLedger ? holders.top10 : rf?.top10 ?? null,
      devPct: onLedger ? dev?.pct ?? rf?.dev ?? null : rf?.dev ?? null,
      // Snipers' and bundlers' share still held: the ledger knows it only while the coin is on the curve.
      snipers: b?.genesis && !bonded ? groupPct(b, b.snipers) : null,
      bundle: b?.genesis && !bonded ? groupPct(b, b.bundle) : null,
      insiders: rf?.insiders ?? null,
      lpLocked,
      safety: rf?.safety ?? null,
      traders: bonded ? null : L?.traders ?? null,   // the feed counts curve traders only
      source: onLedger ? (holders.partial ? "live ledger (partial: Blix missed this coin's first trades)" : "live ledger") : rf?.holders != null || rf?.top10 != null ? "RugCheck" : null,
      checked: !onLedger && rf?.checked ? rf.checked : null,   // when that RugCheck reading was taken
    },
    tradesSince: ring?.trades[0]?.[0] ?? null,
  };
}

function groupPct(b, set) {
  let tokens = 0, max = 0, sold = 0;
  for (const wallet of set) { const w = b.bal.get(wallet); if (!w) continue; tokens += w.b; max += w.max; if (w.b < w.max * 0.1) sold++; }
  return { n: set.size, pct: +((tokens / SUPPLY) * 100).toFixed(2), maxPct: +((max / SUPPLY) * 100).toFixed(2), sold };
}

// The dev's coins: the two reads by creator (indexed, engine.js) are kept two minutes, a dev's list barely
// changes; live market caps are laid over them on every call.
function devRows(creator) {
  const seen = new Map();
  try {
    for (const l of db.prepare("SELECT mint, name, symbol, t FROM launches WHERE creator = ? ORDER BY t DESC LIMIT 50").all(creator)) if (l.mint) seen.set(l.mint, { mint: l.mint, name: l.name, symbol: l.symbol, t: l.t });
    for (const x of db.prepare("SELECT mint, name, symbol, first_seen, mcap, peak_mcap, status, graduated FROM tokens WHERE creator = ? ORDER BY first_seen DESC LIMIT 50").all(creator)) {
      seen.set(x.mint, { ...seen.get(x.mint), mint: x.mint, name: x.name, symbol: x.symbol, t: seen.get(x.mint)?.t ?? x.first_seen, mcap: x.mcap, peak: x.peak_mcap, status: x.status, graduated: !!x.graduated });
    }
  } catch {}
  return [...seen.values()];
}
function devCoins(creator, self) {
  const seen = new Map(cached(`devrows:${creator}`, 120_000, () => devRows(creator)).map((x) => [x.mint, { ...x }]));
  for (const [m, x] of seen) { const L = liveStats(m); if (L) Object.assign(x, { mcap: Math.round(L.mc), progress: L.progress, peak: Math.max(x.peak || 0, L.ath) || null }); }
  const list = [...seen.values()].sort((a, b) => (b.t || 0) - (a.t || 0));
  return { count: list.length, others: list.filter((x) => x.mint !== self).length, list: list.slice(0, 40), window: "launches in the last 6 hours plus every coin Blix tracked" };
}

// GET /api/coin/<mint>/trades?limit=100
export async function coinTrades(mint, { limit = 100 } = {}) {
  const n = Math.min(Math.max(+limit || 100, 10), 500);
  const r = tapes.get(mint);
  if (r) r.focus = now();
  const t = tokenRow(mint);
  const L = liveStats(mint);
  const bonded = Boolean(t?.graduated) || (L?.progress ?? 0) >= 0.995;
  if (bonded && t?.pair) {
    const pool = await poolTrades(mint, t, n);
    if (!r?.trades.length) return pool;
    const curve = liveTrades(mint, r, n);
    const seen = new Set(pool.trades.map((x) => x.tx).filter(Boolean));
    const trades = [...pool.trades, ...curve.trades.filter((x) => !x.tx || !seen.has(x.tx))].sort((a, b) => b.t - a.t).slice(0, n);
    return { ...pool, source: pool.trades.length ? "pool" : "live", trades, note: pool.trades.length ? "Bonded: pool trades from GeckoTerminal, then the curve trades before bonding." : pool.note };
  }
  if (r?.trades.length) return cached(`trades:${mint}:${n}`, 500, () => liveTrades(mint, r, n));
  if (t?.pair) return poolTrades(mint, t, n);
  return { mint, source: "none", trades: [], note: "No trades seen yet. Trades appear here as soon as the coin trades on a bonding curve Blix reads." };
}

function liveTrades(mint, r, n) {
  const b = books.get(mint);
  const creator = launchIndex.get(mint)?.creator || null;
  const tagOf = tagger(mint, b, creator);
  const usd = feed.solUsd || null;
  const trades = r.trades.slice(-n).reverse().map(([t, buy, sol, tokens, mcSol, wallet, slot]) => ({
    t, side: buy ? "buy" : "sell", sol: +sol.toFixed(4), usd: usd ? +(sol * usd).toFixed(2) : null, tokens: tokens == null ? null : Math.round(tokens),
    mcUsd: usd ? Math.round(mcSol * usd) : null, wallet, slot, ...tagOf(wallet),
  }));
  return { mint, source: "live", since: r.trades[0]?.[0] ?? null, trades };
}

// Bonded coins: the pool's last trades from GeckoTerminal (free, rate limited; cached 10 s per pool).
const pools = new Map();
async function poolTrades(mint, t, n) {
  // Every 15 s while a bonded coin's page is open: GeckoTerminal's allowance is shared (gtgate.js).
  const c = pools.get(t.pair);
  if (c && now() - c.t < 15_000) return c.v;
  if (c?.pending) return c.pending;
  const pending = (async () => {
    try {
      coinStats.poolFetches++;
      const j = await gtGet(`${GT}/pools/${t.pair}/trades`, { timeout: 12_000 });
      const usd = feed.solUsd || null;
      const supply = t.price > 0 && t.mcap > 0 ? t.mcap / t.price : SUPPLY;
      const creator = t.creator || null;
      const tagOf = tagger(mint, books.get(mint), creator);
      const trades = (j.data || []).map(({ attributes: a }) => {
        const buy = a.kind === "buy", px = +(buy ? a.price_to_in_usd : a.price_from_in_usd) || null, vol = +a.volume_in_usd || 0;
        return { t: Date.parse(a.block_timestamp), side: buy ? "buy" : "sell", sol: usd ? +(vol / usd).toFixed(4) : null, usd: +vol.toFixed(2),
          tokens: Math.round(+(buy ? a.to_token_amount : a.from_token_amount) || 0), mcUsd: px ? Math.round(px * supply) : null, wallet: a.tx_from_address || null, tx: a.tx_hash || null, ...tagOf(a.tx_from_address) };
      }).filter((x) => x.t > 0).sort((a, b) => b.t - a.t).slice(0, n);
      const v = { mint, source: "pool", pool: t.pair, dex: t.dex, trades, note: "Bonded coin: the pool's latest trades from GeckoTerminal, refreshed every few seconds." };
      pools.set(t.pair, { t: now(), v });
      return v;
    } catch (e) {
      coinStats.poolErrors++;
      const v = c?.v?.trades?.length ? { ...c.v, note: "Showing the last pool trades fetched; GeckoTerminal is busy, retrying." }
        : { mint, source: "pool", pool: t.pair, trades: [], note: `Pool trades are loading (${e.status === 429 ? "GeckoTerminal rate limit, retrying" : e.message}).` };
      pools.set(t.pair, { t: now() - (c?.v?.trades?.length ? 5_000 : 10_000), v });   // retry in 10 s, or 5 s with nothing shown
      return v;
    }
  })();
  pools.set(t.pair, { ...(c || {}), t: c?.t || 0, pending });
  return pending.finally(() => { const x = pools.get(t.pair); if (x?.pending) delete x.pending; });
}
