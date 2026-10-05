// Jupiter's data API (datapi.jup.ag, free, no key): a coin's whole market-cap candle history at 1 s to 1 h and
// its latest trades, for any Solana coin. The coin page's chart and trade list use it first; GeckoTerminal,
// whose small allowance is shared with discovery (gtgate.js), is only the fallback. Answers are cached briefly
// per coin and size, and at most a few requests run at once.
const API = "https://datapi.jup.ag";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const now = () => Date.now();
// Chart size in seconds → Jupiter's interval and how many of its candles make one (5 s is built from 1 s).
const IV = { 1: ["1_SECOND", 1], 5: ["1_SECOND", 5], 15: ["15_SECOND", 1], 60: ["1_MINUTE", 1], 300: ["5_MINUTE", 1], 900: ["15_MINUTE", 1], 3600: ["1_HOUR", 1] };
export const jupStats = { calls: 0, errors: 0, lastError: null };

let running = 0;
const waiting = [];
async function get(path) {
  if (running >= 4) await new Promise((ok) => waiting.push(ok));
  running++;
  jupStats.calls++;
  try {
    const r = await fetch(API + path, { signal: AbortSignal.timeout(8000), headers: { "user-agent": UA, accept: "application/json" } });
    if (!r.ok) throw Object.assign(new Error(`Jupiter ${r.status}`), { status: r.status });
    return await r.json();
  } catch (e) { jupStats.errors++; jupStats.lastError = e.message; throw e; }
  finally { running--; waiting.shift()?.(); }
}

// One answer per key at a time, reused for `ttl` ms; a failure is remembered for 10 s so a dead API is not hammered.
const cache = new Map();
function memo(key, ttl, fn) {
  const c = cache.get(key);
  if (c && (c.p || now() - c.t < (c.err ? 10_000 : ttl))) return c.p || (c.err ? Promise.reject(c.err) : Promise.resolve(c.v));
  const p = fn().then((v) => { cache.set(key, { t: now(), v }); return v; }, (err) => { cache.set(key, { t: now(), err }); throw err; });
  cache.set(key, { ...(c || {}), p });
  if (cache.size > 800) for (const [k, v] of cache) if (!v.p && now() - v.t > 10 * 60_000) cache.delete(k);
  return p;
}

// Market-cap candles in USD, oldest first: { time, open, high, low, close, value } with time in unix seconds.
export function jupCandles(mint, tf) {
  const [iv, k] = IV[tf] || IV[60];
  return memo(`c:${mint}:${tf}`, tf < 60 ? 4_000 : 15_000, async () => {
    const j = await get(`/v2/charts/${mint}?interval=${iv}&to=${now()}&candles=1000&type=mcap&quote=usd`);
    const raw = (j.candles || []).filter((c) => c.close > 0).sort((a, b) => a.time - b.time);
    if (k === 1) return raw.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, value: c.volume || 0 }));
    const out = [];
    for (const c of raw) {
      const t = c.time - (c.time % tf), last = out[out.length - 1];
      if (last && last.time === t) { last.high = Math.max(last.high, c.high); last.low = Math.min(last.low, c.low); last.close = c.close; last.value += c.volume || 0; }
      else out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close, value: c.volume || 0 });
    }
    return out;
  });
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
      const j = await get(`/v1/txs/${mint}?dir=desc&limit=100&minUsdVolume=${minUsd}${next ? `&offset=${next}` : ""}`);
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
  return memo(`h:${mint}`, 30_000, async () => {
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

// Jupiter's token record: holder count, supply, dev, and its audit (authorities, top holders, bots, bundles, the dev's history).
export function jupAsset(mint) {
  return memo(`a:${mint}`, 60_000, async () => {
    const j = await get(`/v1/assets/search?query=${mint}`);
    const a = (Array.isArray(j) ? j : []).find((x) => x.id === mint);
    if (!a) return null;
    return { holders: a.holderCount ?? null, supply: +a.circSupply || +a.totalSupply || null, dev: a.dev || null, created: Date.parse(a.createdAt) || null,
      launchpad: a.launchpad || null, organic: a.organicScoreLabel || null, audit: a.audit || null };
  });
}
