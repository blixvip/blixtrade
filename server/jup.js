// Jupiter's data API (datapi.jup.ag, free, no key): a coin's whole market-cap candle history at 1 s to 1 h and
// its latest trades, for any Solana coin. The coin page's chart and trade list use it first; GeckoTerminal,
// whose small allowance is shared with discovery (gtgate.js), is only the fallback. Answers are cached briefly
// per coin and size, and at most a few requests run at once.
const API = "https://datapi.jup.ag";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const now = () => Date.now();
// Chart size in seconds → Jupiter's interval and how many of its candles make one (5 s is built from 1 s).
const IV = { 1: ["1_SECOND", 1], 5: ["1_SECOND", 5], 15: ["15_SECOND", 1], 60: ["1_MINUTE", 1], 300: ["5_MINUTE", 1], 900: ["15_MINUTE", 1], 3600: ["1_HOUR", 1], 14400: ["4_HOUR", 1], 86400: ["1_DAY", 1] };
export const jupStats = { calls: 0, errors: 0, lastError: null };

// At most a few at once. `low` (the other sizes fetched behind an open chart) waits behind everything else: a
// chart's own size used to queue behind four warm-ups when Jupiter was slow (4-13 s each, 2026-10-06).
let running = 0;
const waiting = [], waitingLow = [];
const wake = () => (waiting.shift() || waitingLow.shift())?.();
async function get(path, low = false) {
  if (running >= 4) await new Promise((ok) => (low ? waitingLow : waiting).push(ok));
  running++;
  jupStats.calls++;
  try {
    const r = await fetch(API + path, { signal: AbortSignal.timeout(8000), headers: { "user-agent": UA, accept: "application/json" } });
    if (!r.ok) throw Object.assign(new Error(`Jupiter ${r.status}`), { status: r.status });
    return await r.json();
  } catch (e) { jupStats.errors++; jupStats.lastError = e.message; throw e; }
  finally { running--; wake(); }
}

// One answer per key at a time, reused for `ttl` ms; a failure is remembered for 10 s so a dead API is not hammered.
// `stale`: an answer older than `ttl` is still given at once while a fresh one is fetched behind it (the chart's
// candles: Jupiter takes 1-6 s for the coarse sizes, and the newest candle is drawn live from the chain anyway).
const cache = new Map();
// `stale`: false, or how old (ms) a kept answer may be to be handed out while a fresh one is fetched (true = 30 min).
function memo(key, ttl, fn, stale = false) {
  const c = cache.get(key);
  if (c && (c.p || now() - c.t < (c.err ? 10_000 : ttl))) return c.p || (c.err ? Promise.reject(c.err) : Promise.resolve(c.v));
  if (stale && c && !c.err && "v" in c && now() - c.t < (stale === true ? 30 * 60_000 : stale)) {
    if (c.bg) return Promise.resolve(c.v);   // already being refreshed
    const p = fn().then((v) => { cache.set(key, { t: now(), v }); return v; }, () => { cache.set(key, { t: now(), v: c.v }); });
    cache.set(key, { ...c, p: null, bg: p });
    return Promise.resolve(c.v);
  }
  const p = fn().then((v) => { cache.set(key, { t: now(), v }); return v; }, (err) => { cache.set(key, { t: now(), err }); throw err; });
  cache.set(key, { ...(c || {}), p });
  if (cache.size > 800) for (const [k, v] of cache) if (!v.p && now() - v.t > 10 * 60_000) cache.delete(k);
  return p;
}

// Jupiter's raw candles (oldest first) as chart candles of `tf` seconds, `k` of its own making one.
function shape(raw, tf, k) {
  if (k === 1) return raw.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, value: c.volume || 0 }));
  const out = [];
  for (const c of raw) {
    const t = c.time - (c.time % tf), last = out[out.length - 1];
    if (last && last.time === t) { last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low); last.close = c.close; last.value += c.volume || 0; }
    else out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close, value: c.volume || 0 });
  }
  return out;
}
// One page of Jupiter's candles (at most 1,000 of its own) ending at `toMs`, oldest first, zero closes dropped.
async function page(mint, iv, toMs, low) {
  const j = await get(`/v2/charts/${mint}?interval=${iv}&to=${toMs}&candles=1000&type=mcap&quote=usd`, low);
  return (j.candles || []).filter((c) => c.close > 0).sort((a, b) => a.time - b.time);
}

// Market-cap candles in USD, oldest first: { time, open, high, low, close, value } with time in unix seconds.
export function jupCandles(mint, tf, low = false) {
  const [iv, k] = IV[tf] || IV[60];
  return memo(`c:${mint}:${tf}`, tf < 60 ? 6_000 : tf < 300 ? 15_000 : 60_000, async () => {
    const raw = await page(mint, iv, now(), low);
    // A coin's very first candle can carry a stray quote from its launch block (Fartcoin's first day "opens" at
    // $1.19B): its open and high are pulled to its close when they are 10x over anything in the next candles.
    if (raw.length > 3) {
      const c0 = raw[0], next = Math.max(...raw.slice(1, 11).map((c) => c.high));
      if (c0.open > next * 10) c0.open = c0.close;
      if (c0.high > next * 10) c0.high = Math.max(c0.open, c0.close);
    }
    return shape(raw, tf, k);
  // A small size's old answer is a different chart (a 1 s series from 20 minutes ago is not this coin now):
  // shown while the fresh one loads, it drew the chart at an old price and then jumped. Seconds-sized candles
  // may be handed out at most 15 s old, minute-sized 2 min, the large ones as before.
  }, tf < 60 ? 15_000 : tf < 900 ? 120_000 : true);
}
// The candles before `beforeSec` back to `fromSec` (a coin's launch), page by page: one page is 1,000 of Jupiter's
// own candles, which at 1 s is under 17 minutes, so a coin Blix heard late had its first minutes cut off its
// 1 s and 5 s charts (1DOG, 2026-10-10: launched 18:42, its second charts began at 19:45). At most `pages` pages
// (about 2 hours at 1 s); kept 5 minutes per coin and size.
export function jupCandlesBack(mint, tf, beforeSec, fromSec, pages = 8) {
  const [iv, k] = IV[tf] || IV[60];
  return memo(`cb:${mint}:${tf}:${beforeSec}`, 5 * 60_000, async () => {
    let raw = [], to = beforeSec * 1000;
    for (let i = 0; i < pages; i++) {
      const got = (await page(mint, iv, to, true)).filter((c) => c.time < to / 1000 && (!raw.length || c.time < raw[0].time));
      if (!got.length) break;
      raw = [...got, ...raw];
      if (got[0].time <= fromSec || got.length < 900) break;
      to = got[0].time * 1000;
    }
    if (raw.length > 3) {
      const c0 = raw[0], next = Math.max(...raw.slice(1, 11).map((c) => c.high));
      if (c0.open > next * 10) c0.open = c0.close;
      if (c0.high > next * 10) c0.high = Math.max(c0.open, c0.close);
    }
    return shape(raw, tf, k).filter((r) => r.time < beforeSec);
  });
}

// A chart just opened: its other sizes are fetched behind it, so switching size (or "All") draws at once.
const warmed = new Map();
export function warmCandles(mint) {
  if (now() - (warmed.get(mint) || 0) < 5 * 60_000) return;
  warmed.set(mint, now()); if (warmed.size > 300) warmed.delete(warmed.keys().next().value);
  setTimeout(() => { for (const tf of [60, 300, 900, 3600]) jupCandles(mint, tf, true).catch(() => {}); }, 1500);
}

// The latest trades, newest first: { t (ms), side, usd, sol, tokens, priceUsd, wallet, tx, mev }.
export function jupTrades(mint, n = 100) {
  return memo(`t:${mint}`, 3_000, async () => {
    const j = await get(`/v1/txs/${mint}?dir=desc&limit=100`);
    return (j.txs || []).map((x) => ({
      t: Date.parse(x.timestamp), side: x.type === "sell" ? "sell" : "buy", usd: +(+x.usdVolume || 0).toFixed(2), sol: x.nativeVolume != null ? +(+x.nativeVolume).toFixed(4) : null,
      tokens: x.amount != null ? Math.round(+x.amount) : null, priceUsd: +x.usdPrice || null, wallet: x.traderAddress || null, tx: x.txHash || null, mev: Boolean(x.isMev),
    })).filter((x) => x.t > 0);
  }).then((rows) => rows.slice(0, n));
}

// Every trade of at least `minUsd` over the coin's history, newest first, up to `pages` × 30 of them: the
// chart's big-trade bubbles (Fomo's overlay). Kept a minute per coin.
export function jupBigTrades(mint, minUsd = 1000, pages = 10) {
  return memo(`b:${mint}:${minUsd}`, 60_000, async () => {
    const out = [];
    let next = null;
    for (let i = 0; i < pages; i++) {
      // Low: up to ten pages for an overlay, which must not hold up the chart's own candles.
      const j = await get(`/v1/txs/${mint}?dir=desc&limit=100&minUsdVolume=${minUsd}${next ? `&offset=${next}` : ""}`, true);
      for (const x of j.txs || []) out.push({ t: Date.parse(x.timestamp), side: x.type === "sell" ? "sell" : "buy", usd: +(+x.usdVolume || 0).toFixed(2),
        sol: x.nativeVolume != null ? +(+x.nativeVolume).toFixed(4) : null, priceUsd: +x.usdPrice || null, wallet: x.traderAddress || null, tx: x.txHash || null });
      if (!j.next || !(j.txs || []).length) break;
      next = j.next;
    }
    return out.filter((x) => x.t > 0);
  });
}

// ---------- the coin page's wallet tabs, for coins the radar's own ledger cannot cover ----------
// (bonded coins: their pool trades are not decoded; coins it met after launch: their first trades are missing)

// The 100 largest holders now and the total count: { count, list: [{ wallet, tokens, pool, lastActive }] }.
export function jupHolders(mint) {
  return memo(`h:${mint}`, 10_000, async () => {
    const j = await get(`/v1/holders/${mint}`);
    return { count: Number.isFinite(+j.count) ? +j.count : null, list: (j.holders || []).map((x) => ({
      wallet: x.address, tokens: +x.amount || 0, lastActive: Date.parse(x.lastActiveTime) || null,
      pool: (x.tags || []).some((g) => /pool/i.test(g.id || g.name || "")),
    })) };
  });
}

function txRow(x) {
  return { t: Date.parse(x.timestamp), side: x.type === "sell" ? "sell" : "buy", usd: +x.usdVolume || 0, sol: x.nativeVolume != null ? +x.nativeVolume : null,
    tokens: x.amount != null ? +x.amount : null, priceUsd: +x.usdPrice || null, wallet: x.traderAddress || null, tx: x.txHash || null };
}
async function txPages(mint, dir, pages, minUsd = 0) {
  const out = [];
  let next = null;
  for (let i = 0; i < pages; i++) {
    const j = await get(`/v1/txs/${mint}?dir=${dir}&limit=100${minUsd ? `&minUsdVolume=${minUsd}` : ""}${next ? `&offset=${next}` : ""}`);
    for (const x of j.txs || []) out.push(txRow(x));
    if (!j.next || !(j.txs || []).length) break;
    next = j.next;
  }
  return out.filter((x) => x.t > 0 && x.wallet);
}
// The coin's first trades, oldest first (they never change, so kept ten minutes): early buyers.
export const jupFirstTrades = (mint, pages = 4) => memo(`f:${mint}`, 10 * 60_000, () => txPages(mint, "asc", pages));
// Its most recent trades of $25 or more, newest first, kept 90 s: who is trading it now (top traders). Bot dust
// left out, 450 such trades reach back minutes on the busiest coins and hours on quieter ones.
export const jupRecentTrades = (mint, pages = 15) => memo(`r:${mint}`, 90_000, () => txPages(mint, "desc", pages, 25));

// Tokens in circulation (Jupiter's circSupply: the mint's on-chain supply, burns taken out), the one scale
// every market cap in Blix is read in: Jupiter's chart candles are drawn in it, so the header, the trade list
// and the chart's trade marks must be too. A coin with burned tokens is not 1B (STONK: 799.4M), and
// DexScreener's price-to-cap ratio is a third figure again (877M), which put the header 10% over the chart.
// Answers at once from what is known (null for a coin not read yet) and refreshes in the background.
const supplies = new Map();   // mint -> { v, t }
let looking = 0;              // background reads at a time: two, so the chart's own requests never queue behind them
export function supplyOf(mint) {
  const s = supplies.get(mint);
  if ((!s || now() - s.t > 10 * 60_000) && looking < 2) { looking++; jupAsset(mint).catch(() => {}).finally(() => looking--); }
  return s?.v ?? null;
}

// The supply when already known, without asking Jupiter: for paths that run on every trade in the market
// (asking for every coin traded would spend Jupiter's rate limit on coins nobody is looking at).
export const knownSupply = (mint) => supplies.get(mint)?.v ?? null;

// Jupiter's token record: holder count, supply, dev, and its audit (authorities, top holders, bots, bundles, the dev's history).
export function jupAsset(mint) {
  return memo(`a:${mint}`, 60_000, async () => {
    const j = await get(`/v1/assets/search?query=${mint}`);
    const a = (Array.isArray(j) ? j : []).find((x) => x.id === mint);
    if (!a) return null;
    const supply = +a.circSupply || +a.totalSupply || null;
    if (supply > 0) { supplies.set(mint, { v: supply, t: now() }); if (supplies.size > 5000) supplies.delete(supplies.keys().next().value); }
    return { holders: a.holderCount ?? null, supply, dev: a.dev || null, created: Date.parse(a.createdAt) || null,
      launchpad: a.launchpad || null, organic: a.organicScoreLabel || null, audit: a.audit || null };
  });
}
