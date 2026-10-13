// Coin page: what a full token page needs beyond /api/token/<mint>, as plain JSON for any front end
// (the classic app's #/coin/<mint> and the React one read the same thing).
//
// Recent trades come from the live curve feed: every pump.fun and LaunchLab trade passes through
// livetrades.js, so a ring of the last minutes is kept here for every coin that trades. Bonded coins trade
// in AMM pools the feed does not decode; their trades come from GeckoTerminal's public list instead.
// Holders, top traders and early buyers come from the holder ledger (holders.js), the dev's other coins
// from the launch log and the tokens table. Nothing here is estimated: a field Blix cannot know is null.
import { db } from "./db.js";
import * as coinIndex from "./coinindex.js";
import { onLiveTrade, feed, liveStats, migrationOf } from "./livetrades.js";
import { books } from "./holders.js";
import { launchIndex, enrichNow } from "./engine.js";
import { getJson, rugcheck } from "./sources.js";
import { gtGet } from "./gtgate.js";
import { jupAsset, jupBigTrades, jupFirstTrades, jupHolders, jupRecentTrades, jupTrades, supplyOf, knownSupply } from "./jup.js";
import { fastMcap, focusPrice, rugFigures } from "./pulse.js";
import { onPoolTrade, swapFeed } from "./pumpswap.js";
import { createCoinFlow } from "./coin-flow.js";
import { levelNow, chartClose } from "./candles.js";
// An open chart's price from its accounts (fastpx.js, set by server.js): the freshest reading there is, ahead of
// the logs' (which trail by seconds on a busy link). USD, already on the chart's level; null when not fresh.
let fastMcUsd = () => null;
export const setFastMc = (fn) => { fastMcUsd = fn; };
import { holdersLive, onCurve, soldOut } from "./holderslive.js";
import { tradesWithWallets } from "./journal.js";

const now = () => Date.now();
const WINDOW = 30 * 60_000;         // coins are kept while they traded within this long (holders.js keeps its books as long)
const FOCUS_KEEP = 30 * 60_000;     // ... and for this long after its page was last open
const PER_COIN = 400;               // most recent trades kept per coin
const PER_FOCUS = 2000;             // ... while its page is open
const MAX_COINS = 4000;
const SUPPLY = 1e9;                 // every pump.fun and LaunchLab coin
// Tokens in circulation for turning a price into a market cap: Jupiter's on-chain figure (the scale the chart
// is drawn in; burns make it less than 1B), else the radar's own price-to-cap ratio, else pump.fun's 1B.
const supplyFor = (mint, t) => supplyOf(mint) ?? (t?.price > 0 && t?.mcap > 0 ? t.mcap / t.price : SUPPLY);
const BUCKET = 15_000, FLOW_BUCKETS = 20; // 5 minutes of flow
const GT = "https://api.geckoterminal.com/api/v2/networks/solana";

// mint -> { trades: [[t, buy 1|0, sol, tokens, mcSol, wallet, slot, sig]], last, focus, wallets, since, sigs }
// wallets: wallet -> [tokens bought, tokens sold, SOL in, SOL out, first trade time], for average buy and
// sell prices. It starts when this module does, so a wallet whose first trade came earlier gets no average.
// Every trade Blix reads from the chain lands here the moment it is read: curve trades (livetrades.js),
// PumpSwap pool trades (pumpswap.js) and, for an open coin in a Raydium / Orca / Meteora pool, the trades
// read from its transactions (cointape.js). `since`: from when the ring has every trade of the coin.
const tapes = new Map();
export const coinStats = { coins: 0, trades: 0, poolFetches: 0, poolErrors: 0 };
// fn(mint, row) for every trade added (server.js pushes an open coin's to its page).
const tapeFns = [];
export const onTape = (fn) => tapeFns.push(fn);
const flowFns = new Set();
export const onFlow = fn => { flowFns.add(fn); return () => flowFns.delete(fn); };
const flow = createCoinFlow({ connected: kind => kind === 'curve' ? feed.connected : kind === 'pumpswap' ? swapFeed.connected : false,
  onUpdate: value => { for (const fn of flowFns) try { fn(value); } catch {} } });
export const liveFlow = mint => flow.snapshot(mint);
setInterval(() => flow.tick(), 1000).unref?.();

function tapeOf(mint, since = now()) {
  let r = tapes.get(mint);
  if (!r) { r = { trades: [], last: 0, focus: 0, wallets: new Map(), flow: [], since, sigs: new Set(), who: new Map() }; tapes.set(mint, r); }
  return r;
}
// A gap in what the ring heard (a pool coin's page closed for a while): the flow restarts from `t`.
export function tapeGap(mint, t = now()) { flow.gap(mint); const r = tapes.get(mint); if (r) r.since = Math.max(r.since, t); else tapeOf(mint, t); }

// One trade. `sig` (+ size, for a transaction with several legs) keeps a trade read twice from counting twice.
// `at`: when it happened, for a trade found seconds late in a block (journalfeed.js) that the live feed skipped:
// it goes in its place in the list and its own 15-second bucket, and is not pushed to an open page as new.
// `fast`: read from the wallet's balance change (server.js), seconds before the logs on a busy link. The logs'
// row for the same slot and wallet is then not added again (its transaction shows once Jupiter lists it).
export function addTape(mint, { buy, sol, tokens = null, mcSol, user = null, slot = null, sig = null, fast = false, at = null, flowKind = null }) {
  if (!(sol >= 0) || !(mcSol > 0)) return;
  // Signed trades correct the totals even when the displayed tape already has a synthetic balance row.
  if (flowKind) flow.record(mint, { sig, buy, sol, tokens, user, at, fast, kind: flowKind, solUsd: feed.solKnown ? feed.solUsd : null });
  const r = tapeOf(mint);
  if (slot != null && user) {
    const k = `${slot}|${user}`, had = r.who.get(k);
    if (fast ? had : had === "fast") return;
    if (!had) { r.who.set(k, fast ? "fast" : "log"); if (r.who.size > 4000) r.who.delete(r.who.keys().next().value); }
  }
  if (sig) {
    const k = `${sig}:${tokens == null ? "" : Math.round(tokens)}`;
    if (r.sigs.has(k)) return;
    r.sigs.add(k); if (r.sigs.size > 5000) r.sigs = new Set([...r.sigs].slice(-2500));
  }
  const t = at != null ? Math.min(at, now()) : now();
  const late = at != null && r.trades.length > 0 && t < r.trades[r.trades.length - 1][0];
  const row = [t, buy ? 1 : 0, sol, tokens, mcSol, user, slot, sig];
  if (!buy && user && tokens > 0 && !fast) soldOut(mint, user, tokens);   // a fast row's balance is already the new one
  if (late) {
    let i = r.trades.length;
    while (i > 0 && r.trades[i - 1][0] > t) i--;
    r.trades.splice(i, 0, row);
  } else r.trades.push(row);
  // 5-minute flow in 15-second buckets, so a busy coin's figures do not depend on how many trades are kept.
  const k = Math.floor(t / BUCKET);
  let f = r.flow[r.flow.length - 1];
  if (late && f && k < f.k) {
    // A late trade's own bucket: found among those kept, made in its place if missing, or left out if older than all.
    f = null;
    for (let i = r.flow.length - 1; i >= 0; i--) {
      if (r.flow[i].k === k) { f = r.flow[i]; break; }
      if (r.flow[i].k < k) { f = { k, b: 0, s: 0, bs: 0, ss: 0, w: new Set() }; r.flow.splice(i + 1, 0, f); break; }
    }
  } else if (!f || f.k !== k) { f = { k, b: 0, s: 0, bs: 0, ss: 0, w: new Set() }; r.flow.push(f); if (r.flow.length > FLOW_BUCKETS) r.flow.shift(); }
  if (f) {
    if (buy) { f.b++; f.bs += sol; } else { f.s++; f.ss += sol; }
    if (user && f.w.size < 500) f.w.add(user);
  }
  if (user && tokens > 0) {
    let w = r.wallets.get(user);
    if (!w) { w = [0, 0, 0, 0, t]; r.wallets.set(user, w); }
    if (buy) { w[0] += tokens; w[2] += sol; } else { w[1] += tokens; w[3] += sol; }
  }
  const cap = now() - r.focus < FOCUS_KEEP ? PER_FOCUS : PER_COIN;
  if (r.trades.length > cap + 100) r.trades.splice(0, r.trades.length - cap);
  r.last = now();
  coinStats.trades++;
  if (!late && tapeFns.length && now() - r.focus < 15_000) for (const fn of tapeFns) try { fn(mint, rowOut(mint, row)); } catch {}
}
// null `user` on feeds that do not name the trader (LaunchLab).
// The curve reads its cap on 1B tokens; on the circulating-supply scale (knownSupply, cache only) like every
// other figure, so the trade list, the chart and Jupiter's rows agree on a coin with burned tokens.
const onCirc = (mint, mc) => mc * ((knownSupply(mint) ?? 1e9) / 1e9);
onLiveTrade((mint, s, sol, buy, x) => addTape(mint, { buy, sol, tokens: x?.tokens ?? null, mcSol: onCirc(mint, s.mc), user: x?.user ?? null, slot: x?.slot ?? null, sig: x?.sig ?? null, flowKind: 'curve' }));
onPoolTrade((mint, e) => addTape(mint, { buy: e.buy, sol: e.sol, tokens: e.tokens ?? null, mcSol: e.mcSol, user: e.user ?? null, slot: e.slot ?? null, sig: e.sig ?? null, flowKind: 'pumpswap' }));

// A trade row as the page reads it, tagged (dev, sniper, bundle, followed). The tagger is kept a few seconds per coin.
const taggers = new Map();
function tagsFor(mint) {
  const c = taggers.get(mint);
  if (c && now() - c.t < 5000) return c.f;
  const f = tagger(mint, books.get(mint), launchIndex.get(mint)?.creator || tokenRow(mint)?.creator || null);
  taggers.set(mint, { t: now(), f }); if (taggers.size > 200) taggers.delete(taggers.keys().next().value);
  return f;
}
function rowOut(mint, [t, buy, sol, tokens, mcSol, wallet, slot, sig], tagOf = tagsFor(mint)) {
  const usd = feed.solUsd || null;
  return { t, side: buy ? "buy" : "sell", sol: +sol.toFixed(4), usd: usd ? +(sol * usd).toFixed(2) : null, tokens: tokens == null ? null : Math.round(tokens),
    mcUsd: usd ? Math.round(mcSol * usd) : null, wallet, slot, tx: sig || null, ...tagOf(wallet) };
}

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
// A curve at 99.5% has bonded even before the tokens table says so: its last curve trade is history, not a price
// (CumRocket's header held its $48.9K bonding price while it traded at $2.4K in the pool, 2026-10-06).
const curveLive = (L, t) => Boolean(L) && !t?.graduated && (L.progress ?? 0) < 0.995 && now() - L.last < 30 * 60_000;
// SOL per token now, for valuing balances: the curve while on it, then the Pulse's pool price (Jupiter or
// DexScreener, seconds old) and last the radar's tracked price.
function priceSol(mint, t) {
  const L = liveStats(mint);
  if (curveLive(L, t) && feed.solUsd) return { sol: L.mc / feed.solUsd / SUPPLY, live: true };
  const fast = fastMcap(mint);
  if (fast > 0 && feed.solUsd) return { sol: fast / feed.solUsd / supplyFor(mint, t), live: true };
  if (t?.price > 0 && feed.solUsd) return { sol: t.price / feed.solUsd, live: false };
  return { sol: null, live: false };
}

// A market cap the radar stored (DexScreener's, in its own supply) moved onto the circulating-supply scale.
function onScale(mint, t, mc) {
  const s = supplyOf(mint);
  return mc > 0 && s && t?.price > 0 && t?.mcap > 0 ? Math.round(mc * s / (t.mcap / t.price)) : mc ?? null;
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
    pnlTokens: w.b, pnlBasis: 'sol',
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

// DexScreener orders: when the dev (or anyone) paid for the coin's DEX profile, an ad, a takeover or boosts,
// drawn on the chart like Axiom's "DEX paid" marker. Read in the background for open pages: every minute
// until something is paid, then every 10 minutes. Never awaited; null until the first answer.
const paidLive = new Map();  // mint -> { t, busy, v }
function paidNow(mint) {
  let c = paidLive.get(mint);
  if (!c) { c = { t: 0, busy: false, v: null }; paidLive.set(mint, c); }
  if (!c.busy && now() - c.t > (c.v?.orders.length ? 600_000 : 60_000)) {
    c.busy = true; c.t = now();
    getJson(`https://api.dexscreener.com/orders/v1/solana/${mint}`, { timeout: 8000 }).then((j) => {
      c.v = {
        orders: (j?.orders || []).filter((o) => o.paymentTimestamp && o.status !== "rejected" && o.status !== "cancelled").map((o) => ({ type: o.type, status: o.status, t: o.paymentTimestamp })),
        boosts: (j?.boosts || []).filter((x) => x.paymentTimestamp).map((x) => ({ amount: x.amount ?? null, t: x.paymentTimestamp })),
      };
    }, () => {}).finally(() => { c.busy = false; });
  }
  if (paidLive.size > 300) for (const [k, v] of paidLive) if (!v.busy && now() - v.t > 15 * 60_000) paidLive.delete(k);
  return c.v;
}

// Chart marks: every trade in the ring by the dev, a sniper, a bundle wallet or a wallet you follow, so the
// chart shows them from the start of the ring, not only from when the page opened.
function chartMarks(r, tagOf) {
  if (!r?.trades.length) return [];
  const usd = feed.solUsd || null, out = [];
  for (const [t, buy, sol, , mcSol, wallet] of r.trades) {
    if (!wallet) continue;
    const w = tagOf(wallet);
    if (!w.tag && !w.followed) continue;
    out.push({ t, side: buy ? "buy" : "sell", sol: +sol.toFixed(4), mcUsd: usd ? Math.round(mcSol * usd) : null, wallet, tag: w.tag, followed: w.followed, label: w.label });
  }
  return out.slice(-400);
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
// An open coin page re-reads its stored row (liquidity, market cap, pair) from DexScreener at most every 20 s:
// a coin the radar retired stops being refreshed, and its page showed a rugged $6K coin with $532K liquidity.
const pageRefresh = new Map();   // mint -> last refresh
export function coinPage(mint, { top = 100 } = {}) {
  flow.focus(mint);
  const r = tapes.get(mint);
  if (r) r.focus = now();
  if (now() - (pageRefresh.get(mint) || 0) > 20_000) {
    pageRefresh.set(mint, now());
    enrichNow(mint).catch(() => {});
    if (pageRefresh.size > 500) for (const [m, t] of pageRefresh) if (now() - t > 10 * 60_000) pageRefresh.delete(m);
  }
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
  // Its market price every few seconds while this page is open (pulse.js): a bonded coin, and a curve coin the live
  // feed is not hearing (a quiet one: FaukaqW…pump 2026-10-12 showed $0 and an empty header while Jupiter had $3K).
  if (bonded || !curveLive(L, t)) focusPrice(mint);
  // The ring has every trade of the last five minutes (it has been hearing the coin that long): exact and live,
  // curve or pool. Otherwise the tracked figures (DexScreener's) for a bonded coin.
  const covered = ring?.trades.length && ring.since <= now() - FLOW_BUCKETS * BUCKET;
  if (bonded && !covered && t?.vol_m5 != null) {
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
  const calculatedFlow = flow.snapshot(mint);
  if (calculatedFlow?.complete) m5 = { ...calculatedFlow.flow, calculatedAt: calculatedFlow.t, complete: true };

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
  const priceUsdNow = p.sol != null && solUsd ? p.sol * solUsd : t?.price ?? null;
  const J = fillFromJupiter(mint, { holders, traders, early, bonded, genesis: Boolean(b?.genesis), tagOf, priceUsd: priceUsdNow, solUsd, top });
  ({ holders, traders, early } = J);
  if (!dev && J.asset?.dev) dev = { wallet: J.asset.dev, pct: null, coins: cached(`dev:${J.asset.dev}`, 30_000, () => devCoins(J.asset.dev, mint)) };
  // No ledger for the dev: what Jupiter shows it bought and sold in the coin's first trades, and what it holds now.
  if (dev && dev.boughtSol == null) {
    const w = J.firstTally?.get(dev.wallet), h = J.heldOf(dev.wallet);
    if (w) Object.assign(dev, { boughtSol: +w.inSol.toFixed(4), soldSol: +w.outSol.toFixed(4) });
    if (h != null) dev.pct = +((h / J.supply) * 100).toFixed(3);
    if (w || h != null) dev.via = "jupiter";
  }
  // Holders from the chain itself (holderslive.js) once its first read lands: the exact count and every
  // balance, moving with each trade. The curve ledger stays first while it saw the coin's every trade.
  const exactLedger = onLedger && !holders.partial;
  const chainH = exactLedger ? null : holdersLive(mint, { hint: rf?.holders ?? J.asset?.holders ?? 0, n: top });
  if (chainH) {
    const supply = J.supply || supplyFor(mint, t), pools = new Set([...J.poolWallets, t?.pair].filter(Boolean));
    const list = chainH.top.map(([wallet, tokens]) => jupLine(wallet, { held: tokens, w: J.recentTally?.get(wallet), supply, priceUsd: priceUsdNow, solUsd, tagOf, pool: pools.has(wallet) || !onCurve(wallet) }));
    const real = list.filter((x) => x.label !== "Pool");
    const maxPct = Math.max(...real.map((x) => x.pct), 0);
    for (const x of list) x.maxPct = maxPct;
    holders = { count: chainH.count, wallets: list.length, trades: 0, since: null, last: now(), genesis: false, partial: false, frozen: false,
      top10: +real.slice(0, 10).reduce((sum, x) => sum + x.pct, 0).toFixed(2), list, source: "chain", stale: false };
    if (dev) { dev.pct = +((chainH.of(dev.wallet) / supply) * 100).toFixed(3); dev.via = "chain"; }
  }
  // Never an empty Holders tab while a figure is known: Jupiter's, else RugCheck's count (flagged stale).
  if (!holders && (rf?.holders ?? J.asset?.holders) != null) {
    holders = { count: rf?.holders ?? J.asset.holders, wallets: 0, trades: 0, since: null, last: rf?.checked ?? null, genesis: false, partial: true, frozen: false,
      top10: rf?.top10 ?? null, list: [], source: rf?.holders != null ? "rugcheck" : "jupiter", stale: true };
  }
  if (holders && !holders.source) holders.source = "ledger";
  if (holders && holders.stale == null) holders.stale = holders.frozen;
  const viaJup = holders?.source === "jupiter", viaChain = holders?.source === "chain";
  return {
    mint, symbol: t?.symbol || launchIndex.get(mint)?.symbol || coinIndex.nameOf(mint)?.symbol || null, name: t?.name || launchIndex.get(mint)?.name || coinIndex.nameOf(mint)?.name || null,
    solUsd, live: curveLive(L, t), onCurve: (Boolean(L) || t?.dex === "pumpfun") && !t?.graduated,
    // Curve full, pool not trading yet: pump.fun is migrating it and trades fail meanwhile ({ since } or null).
    migrating: t?.graduated && t?.pair_created ? null : migrationOf(mint),
    // Live readings on the chart's level (candles.js levelNow), so the header and the chart's last candle agree.
    // Off the curve with no live price, the chart's newest close (seconds old while it is open) before the stored
    // DexScreener reading (minutes old: it showed $21K for a coin that had dumped to $2.4K).
    // While its chart is open the header shows what the chart shows: the fast feed, else the newest candle.
    mcUsd: L?.suspect ? Math.round(L.mc) : fastMcUsd(mint) != null ? Math.round(fastMcUsd(mint)) : chartClose(mint) != null ? Math.round(chartClose(mint)) : curveLive(L, t) ? Math.round(onCirc(mint, L.mc) * levelNow(mint)) : (fastMcap(mint) != null ? Math.round(fastMcap(mint) * levelNow(mint)) : null) ?? (chartClose(mint) != null ? Math.round(chartClose(mint)) : null) ?? (t?.mcap > 0 ? onScale(mint, t, t.mcap) : null) ?? (L ? Math.round(onCirc(mint, L.mc) * levelNow(mint)) : null),
    // How old the market cap above is: under a few seconds while it trades on the curve or the Pulse prices it.
    priceAgeMs: curveLive(L, t) ? now() - L.last : fastMcap(mint) != null ? 0 : t?.price_t ? now() - t.price_t : null,
    priceUsd: p.sol != null && solUsd ? p.sol * solUsd : t?.price ?? null,
    athUsd: Math.max(onCirc(mint, L?.ath || 0), onScale(mint, t, t?.peak_mcap) || 0) || null,
    progress: L?.progress ?? null, supply: curveLive(L, t) ? SUPPLY : supplyFor(mint, t),
    m5, holders, traders, early, dev,
    // Where the wallet tabs came from when not the ledger ("holders", "traders", "early" from Jupiter), and
    // Jupiter's audit of the coin (authorities, top holders, bots, bundles, the dev's launches) for Safety and Dev.
    // When the coin was really created (Jupiter), for its age: first_seen is when Blix met it, which for a coin
    // adopted late (another launchpad, or found after launch) can be days after.
    created: J.asset?.created ?? coinIndex.get(mint)?.created ?? null,
    jupiter: J.source ? { tabs: J.source, tradersWindow: J.tradersWindow || null } : null,
    audit: J.asset ? { ...(J.asset.audit || {}), holders: J.asset.holders, launchpad: J.asset.launchpad, organic: J.asset.organic } : null,
    info: {
      holders: viaChain || onLedger || viaJup ? holders.count : rf?.holders ?? J.asset?.holders ?? null,
      top10: viaChain || onLedger || viaJup ? holders.top10 : rf?.top10 ?? null,
      devPct: viaChain || onLedger ? dev?.pct ?? rf?.dev ?? null : rf?.dev ?? null,
      // Snipers' and bundlers' share still held: the ledger knows it only while the coin is on the curve.
      snipers: b?.genesis && !bonded ? groupPct(b, b.snipers) : null,
      bundle: b?.genesis && !bonded ? groupPct(b, b.bundle) : null,
      insiders: rf?.insiders ?? null,
      lpLocked,
      safety: rf?.safety ?? null,
      traders: bonded ? null : L?.traders ?? null,   // the feed counts curve traders only
      source: viaChain ? "chain (live)" : onLedger ? (holders.partial ? "live ledger (partial: Blix missed this coin's first trades)" : "live ledger") : viaJup ? "Jupiter" : rf?.holders != null || rf?.top10 != null ? "RugCheck" : null,
      checked: !onLedger && !viaChain && rf?.checked ? rf.checked : null,   // when that RugCheck reading was taken
    },
    tradesSince: ring?.trades[0]?.[0] ?? null,
    marks: chartMarks(ring, tagOf),
    paid: paidNow(mint),
  };
}

// ---------- Jupiter fill-in for the wallet tabs ----------
// The ledger above only knows a coin's bonding-curve trades, and only from when Blix started reading it. For a
// bonded coin (pool trades), or one met after launch, the Holders, Top traders and Early buyers tabs come from
// Jupiter's data API instead: fetched in the background while the page is open (every 15 s at most), merged
// into the next poll, so the page never waits on it.
const extra = new Map();   // mint -> { t, busy, holders, recent, first, asset }
function enrich(mint, want) {
  let e = extra.get(mint);
  if (!e) { e = { t: 0 }; extra.set(mint, e); if (extra.size > 150) extra.delete(extra.keys().next().value); }
  if (e.busy || now() - e.t < 8_000) return e;
  e.busy = true;
  // Each answer is used the moment it lands (the holders took 5-7 s on a cold coin while they waited for the
  // slowest of the four), so the page fills in piece by piece instead of all at the end.
  const put = (k) => (v) => { if (v) e[k] = v; };
  Promise.allSettled([want.holders ? jupHolders(mint).then(put("holders")) : null, want.recent ? jupRecentTrades(mint).then(put("recent")) : null,
    want.first ? jupFirstTrades(mint).then(put("first")) : null, jupAsset(mint).then(put("asset"))])
    .finally(() => { e.t = now(); e.busy = false; });
  return e;
}

// Per wallet, from a run of Jupiter trades: SOL and USD in and out, tokens bought and sold, first and last trade.
function tally(rows) {
  const by = new Map();
  for (const x of rows) {
    let w = by.get(x.wallet);
    if (!w) by.set(x.wallet, (w = { inSol: 0, outSol: 0, inUsd: 0, outUsd: 0, tokIn: 0, tokOut: 0, n: 0, first: x.t, last: x.t, firstBuy: null }));
    if (x.side === "buy") { w.inSol += x.sol || 0; w.inUsd += x.usd || 0; w.tokIn += x.tokens || 0; if (w.firstBuy == null || x.t < w.firstBuy) w.firstBuy = x.t; }
    else { w.outSol += x.sol || 0; w.outUsd += x.usd || 0; w.tokOut += x.tokens || 0; }
    w.n++; w.first = Math.min(w.first, x.t); w.last = Math.max(w.last, x.t);
  }
  return by;
}

// One row of the wallet tables from Jupiter's figures, the same shape walletLine() gives the ledger's rows.
// `held`: tokens it holds now (from the top-100 holder list), or null when it is not in that list.
function jupLine(wallet, { held, w, supply, priceUsd, solUsd, tagOf, pool, lastActive }) {
  const r2 = (x) => (x == null ? null : +x.toFixed(4));
  const valueUsd = held != null && priceUsd ? held * priceUsd : null;
  const valueSol = valueUsd != null && solUsd ? valueUsd / solUsd : null;
  const inSol = w?.inSol ?? null, outSol = w?.outSol ?? null;
  // Result over the window only: sells, plus the part of what it holds that it bought inside the window, minus
  // buys. A whale that bought before the window is not credited its whole bag as profit.
  // Not in the top-100 list and still net long inside the window: what it holds now is unknown, so is its result.
  // No buy inside the window: its cost is outside it, so its result is unknown too (sells alone are not profit).
  const net = w ? Math.max(0, w.tokIn - w.tokOut) : 0, unknown = !w || w.tokIn <= 0 || (held == null && net > w.tokIn * 0.02);
  const keptUsd = w && priceUsd ? Math.min(held ?? net, net) * priceUsd : 0;
  const pnlUsd = w && !unknown ? (w.outUsd + keptUsd - w.inUsd) : null;
  const avgBuyMc = w && w.tokIn > 0 ? Math.round((w.inUsd / w.tokIn) * supply) : null;
  const avgSellMc = w && w.tokOut > 0 ? Math.round((w.outUsd / w.tokOut) * supply) : null;
  return {
    // A program's account (the bonding curve, an AMM pool, a vault) is never a person: RugCheck's and Jupiter's
    // lists include the curve, which read as a 30% "holder" on every coin still bonding.
    wallet, ...tagOf(wallet), ...(pool || !onCurve(wallet) ? { label: "Pool" } : {}),
    tokens: held == null ? null : Math.round(held), pct: held != null ? +((held / supply) * 100).toFixed(3) : null, maxPct: 0,
    pnlTokens: unknown ? null : Math.min(held ?? net, net), pnlBasis: 'usd',
    boughtSol: r2(inSol), soldSol: r2(outSol), valueSol: r2(valueSol), pnlSol: pnlUsd != null && solUsd ? r2(pnlUsd / solUsd) : null, realizedSol: null,
    boughtUsd: w ? +w.inUsd.toFixed(2) : null, soldUsd: w ? +w.outUsd.toFixed(2) : null, valueUsd: valueUsd == null ? null : +valueUsd.toFixed(2), pnlUsd: pnlUsd == null ? null : +pnlUsd.toFixed(2),
    avgBuyMc, avgSellMc, trades: w?.n ?? 0, first: w?.first ?? lastActive ?? null,
    status: held != null && held > 0.5 ? (w && w.tokOut > 0 ? "sold some" : "holding") : w && w.tokOut > 0 && w.tokOut >= w.tokIn * 0.98 ? "sold all" : "outside top 100",
  };
}

function fillFromJupiter(mint, { holders, traders, early, bonded, genesis, tagOf, priceUsd, solUsd, top }) {
  const needH = !holders || holders.frozen || (holders.partial && holders.list.length < 20);
  const needT = bonded || !traders.length;
  const needE = !genesis || !early.length;
  const e = enrich(mint, { holders: needH, recent: needT, first: needE });
  const supply = e.asset?.supply || SUPPLY;
  const held = new Map((e.holders?.list || []).map((h) => [h.wallet, h]));
  const out = { holders, traders, early, asset: e.asset || null, source: null };
  const used = [];
  if (needH && e.holders?.list.length) {
    const recent = e.recent ? tally(e.recent) : null;
    const list = e.holders.list.slice(0, top).map((h) => jupLine(h.wallet, { held: h.tokens, w: recent?.get(h.wallet), supply, priceUsd, solUsd, tagOf, pool: h.pool, lastActive: h.lastActive }));
    const maxPct = Math.max(...list.filter((x) => x.label !== "Pool").map((x) => x.pct), 0);
    for (const x of list) x.maxPct = maxPct;
    const real = list.filter((x) => x.label !== "Pool");
    out.holders = { count: e.holders.count ?? e.asset?.holders ?? list.length, wallets: list.length, trades: e.recent?.length || 0, since: null, last: now(), genesis: false, partial: false, frozen: false,
      top10: +real.slice(0, 10).reduce((s, x) => s + x.pct, 0).toFixed(2), list, source: "jupiter" };
    used.push("holders");
  }
  if (needT && e.recent?.length) {
    const by = tally(e.recent);
    out.traders = [...by.entries()].map(([wallet, w]) => jupLine(wallet, { held: held.get(wallet)?.tokens ?? null, w, supply, priceUsd, solUsd, tagOf, pool: held.get(wallet)?.pool }))
      .filter((x) => x.label !== "Pool").sort((a, b) => ((b.boughtUsd ?? 0) + (b.soldUsd ?? 0)) - ((a.boughtUsd ?? 0) + (a.soldUsd ?? 0))).slice(0, 50);
    out.tradersWindow = { trades: e.recent.length, since: e.recent.at(-1)?.t ?? null };
    used.push("traders");
  }
  if (needE && e.first?.length) {
    const by = tally(e.first), t0 = e.first[0].t;
    out.early = [...by.entries()].filter(([, w]) => w.firstBuy != null).sort((a, b) => a[1].firstBuy - b[1].firstBuy).slice(0, 50)
      .map(([wallet, w]) => {
        const h = held.get(wallet);
        return { ...jupLine(wallet, { held: h ? h.tokens : null, w, supply, priceUsd, solUsd, tagOf, pool: h?.pool }), afterFirstMs: w.firstBuy - t0, slot: null };
      }).filter((x) => x.label !== "Pool");
    used.push("early");
  }
  out.source = used.length ? used : null;
  out.recentTally = e.recent?.length ? tally(e.recent) : null;
  out.poolWallets = new Set((e.holders?.list || []).filter((h) => h.pool).map((h) => h.wallet));
  out.firstTally = e.first?.length ? tally(e.first) : null;
  out.heldOf = (wallet) => held.get(wallet)?.tokens ?? null;
  out.supply = supply;
  return out;
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
  for (const [m, x] of seen) { const L = liveStats(m); if (L) Object.assign(x, { mcap: Math.round(onCirc(m, L.mc)), progress: L.progress, peak: Math.max(x.peak || 0, onCirc(m, L.ath)) || null }); }
  const list = [...seen.values()].sort((a, b) => (b.t || 0) - (a.t || 0));
  return { count: list.length, others: list.filter((x) => x.mint !== self).length, list: list.slice(0, 40), window: "launches in the last 6 hours plus every coin Blix tracked" };
}

// A coin's ring starts empty after a restart (or once dropped), so an opened coin's list read "no trades" until its
// next trade: its last 15 minutes come back from the journal instead (every trade the radar stored, with wallets;
// no signature or token count there). Asked at most every 30 s per coin.
const seeded = new Map();
function seedTape(mint) {
  const r = tapes.get(mint);
  if (r?.trades.length) return r;
  const usd = feed.solUsd, was = seeded.get(mint);
  if (!usd || (was && now() - was < 30_000)) return r;
  seeded.set(mint, now()); if (seeded.size > 500) seeded.delete(seeded.keys().next().value);
  let rows = [];
  try { rows = tradesWithWallets(mint, now() - 15 * 60_000); } catch { return r; }
  if (!rows.length) return r;
  const t = r || tapeOf(mint, rows[0].t);
  for (const x of rows.slice(-PER_FOCUS)) t.trades.push([x.t, x.buy ? 1 : 0, x.usd / usd, null, x.mc / usd, x.w || null, null, null]);
  t.since = Math.min(t.since, rows[0].t);
  t.last = now();
  return t;
}
// A bonded coin's pool list from Jupiter (GeckoTerminal behind it): either can answer with nothing for a while
// (seen 2026-10-10: 61 of 81 reads empty on a busy coin), which emptied the page's list. The last list that had
// trades is kept and shown instead, for up to 10 minutes, with the chain's newer rows on top.
const goodPool = new Map();
async function poolTradesKept(mint, t, n) {
  const v = await poolTrades(mint, t, n);
  if (v.trades.length) { goodPool.set(mint, { t: now(), v }); if (goodPool.size > 300) goodPool.delete(goodPool.keys().next().value); return v; }
  const g = goodPool.get(mint);
  return g && now() - g.t < 10 * 60_000 ? { ...g.v, note: "The pool's last trades; Jupiter and GeckoTerminal are slow right now, retrying." } : v;
}

// GET /api/coin/<mint>/trades?limit=100
export async function coinTrades(mint, { limit = 100 } = {}) {
  const n = Math.min(Math.max(+limit || 100, 10), 500);
  const r = seedTape(mint);
  if (r) r.focus = now();
  const t = tokenRow(mint);
  const L = liveStats(mint);
  const bonded = Boolean(t?.graduated) || (L?.progress ?? 0) >= 0.995;
  if (bonded && t?.pair) {
    const asked = poolTradesKept(mint, t, n);
    asked.then((p) => feedPool(mint, p?.trades)).catch(() => {});
    if (!r?.trades.length) return asked;
    // The radar's own chain rows go out at once when Jupiter and GeckoTerminal are slow (8 s, then 12 s, seen
    // 2026-10-06): the pool's list is kept by both (jup.js, pools) and joins on the page's next ask.
    const pool = await Promise.race([asked, new Promise((ok) => setTimeout(ok, 600, null))]);
    if (!pool) { asked.catch(() => {}); return { ...liveTrades(mint, r, n), note: "Bonded: the pool's trades, live from the chain (Jupiter's list is still loading)." }; }
    // The chain's rows are seconds ahead of Jupiter's (its index trails by 6-10 s); a transaction Jupiter has
    // indexed is shown as Jupiter lists it (every leg of an arbitrage, exact), the newer ones as read from the chain.
    const chain = liveTrades(mint, r, n);
    const seen = new Set(pool.trades.map((x) => x.tx).filter(Boolean));
    const newest = pool.trades.reduce((m, x) => Math.max(m, x.t), 0);
    const trades = [...pool.trades, ...chain.trades.filter((x) => x.tx ? !seen.has(x.tx) : x.t > newest + 15_000)].sort((a, b) => b.t - a.t).slice(0, n);
    return { ...pool, source: pool.trades.length ? "pool" : "live", trades, note: pool.trades.length ? "Bonded: the pool's trades, live from the chain, checked against Jupiter's list." : pool.note };
  }
  if (r?.trades.length) return cached(`trades:${mint}:${n}`, 500, () => liveTrades(mint, r, n));
  if (t?.pair) return poolTradesKept(mint, t, n);
  return { mint, source: "none", trades: [], note: "No trades seen yet. Trades appear here as soon as the coin trades on a bonding curve Blix reads." };
}

function liveTrades(mint, r, n) {
  const b = books.get(mint);
  const creator = launchIndex.get(mint)?.creator || null;
  const tagOf = tagger(mint, b, creator);
  const trades = r.trades.slice(-n).reverse().map((x) => rowOut(mint, x, tagOf));
  return { mint, source: "live", since: r.trades[0]?.[0] ?? null, trades };
}

// Bonded coins: the pool's last trades from GeckoTerminal (free, rate limited; cached 10 s per pool).
const pools = new Map();
// Each new trade of a bonded coin's pool list (Jupiter's or GeckoTerminal's, read for the trade list) goes to these
// once (server.js: they fill the chart when the chain stream has nothing for the pool, as for 32AKdm and SAUL,
// 2026-10-10: their charts sat at the migration candle while the trade list moved).
const poolFns = [];
export const onPoolList = (fn) => poolFns.push(fn);
const poolFed = new Map();   // mint -> the newest trade time already passed on
function feedPool(mint, trades) {
  if (!poolFns.length || !trades?.length) return;
  const since = poolFed.get(mint) ?? now() - 120_000;
  const fresh = trades.filter((x) => x.t > since && x.mcUsd > 0).sort((a, b) => a.t - b.t);
  if (!fresh.length) return;
  poolFed.set(mint, fresh[fresh.length - 1].t);
  if (poolFed.size > 500) poolFed.delete(poolFed.keys().next().value);
  for (const fn of poolFns) for (const x of fresh) { try { fn(mint, x); } catch {} }
}
// GET /api/coin/<mint>/big: trades of $1,000 or more over the coin's history (Jupiter), for the chart's bubbles.
export async function coinBigTrades(mint) {
  const t = tokenRow(mint) || {};
  try {
    const rows = await jupBigTrades(mint);
    const supply = supplyFor(mint, t), tagOf = tagger(mint, books.get(mint), t.creator || null);
    return { mint, trades: rows.map((x) => ({ t: x.t, side: x.side, sol: x.sol, usd: x.usd, mcUsd: x.priceUsd ? Math.round(x.priceUsd * supply) : null, wallet: x.wallet, tx: x.tx, ...tagOf(x.wallet) })) };
  } catch (e) { return { mint, trades: [], note: e.message }; }
}

// Bots spam zero-size "buys" (0 tokens, $0): they are not trades, and their price field is junk (XFUN showed
// rows at $823K market cap on a $6K coin), so the list leaves them out.
const sized = (x) => !(x.tokens === 0 || (x.usd != null && x.usd <= 0 && !(x.sol > 0)));

// Jupiter first (every trade with its wallet, no allowance to share); GeckoTerminal when Jupiter has none.
async function poolTrades(mint, t, n) {
  try {
    const rows = await jupTrades(mint, n);
    if (rows.length) {
      const supply = supplyFor(mint, t), tagOf = tagger(mint, books.get(mint), t.creator || null);
      const trades = rows.filter(sized).map((x) => ({ t: x.t, side: x.side, sol: x.sol, usd: x.usd, tokens: x.tokens, mcUsd: x.priceUsd ? Math.round(x.priceUsd * supply) : null, wallet: x.wallet, tx: x.tx, ...tagOf(x.wallet) }));
      return { mint, source: "pool", pool: t.pair, dex: t.dex, trades, note: "The pool's latest trades from Jupiter, refreshed every few seconds." };
    }
  } catch { /* Jupiter down: GeckoTerminal below */ }
  return geckoTrades(mint, t, n);
}

async function geckoTrades(mint, t, n) {
  // Every 15 s while a bonded coin's page is open: GeckoTerminal's allowance is shared (gtgate.js).
  const c = pools.get(t.pair);
  if (c && now() - c.t < 15_000) return c.v;
  if (c?.pending) return c.pending;
  const pending = (async () => {
    try {
      coinStats.poolFetches++;
      const j = await gtGet(`${GT}/pools/${t.pair}/trades`, { timeout: 12_000 });
      const usd = feed.solUsd || null;
      const supply = supplyFor(mint, t);
      const creator = t.creator || null;
      const tagOf = tagger(mint, books.get(mint), creator);
      const trades = (j.data || []).map(({ attributes: a }) => {
        const buy = a.kind === "buy", px = +(buy ? a.price_to_in_usd : a.price_from_in_usd) || null, vol = +a.volume_in_usd || 0;
        return { t: Date.parse(a.block_timestamp), side: buy ? "buy" : "sell", sol: usd ? +(vol / usd).toFixed(4) : null, usd: +vol.toFixed(2),
          tokens: Math.round(+(buy ? a.to_token_amount : a.from_token_amount) || 0), mcUsd: px ? Math.round(px * supply) : null, wallet: a.tx_from_address || null, tx: a.tx_hash || null, ...tagOf(a.tx_from_address) };
      }).filter((x) => x.t > 0 && sized(x)).sort((a, b) => b.t - a.t).slice(0, n);
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
