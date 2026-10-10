// GeckoTerminal's candles, read by the browser (its public API answers each visitor's own address; from the
// server it rate-limits Blix as one user). The same pool and the same market-cap candles the GeckoTerminal
// embed draws, as rows for Blix's own chart (TradingView's chart library), so the trader faces can sit on them.
// Free tier: minutes, hours and days (seconds are a paid plan), 1,000 candles a read, about 30 reads a minute.
const API = "https://api.geckoterminal.com/api/v2/networks/solana";

export interface GBar { time: number; open: number; high: number; low: number; close: number; value: number }
// Candle sizes the free API has: [seconds, label, timeframe, aggregate].
export const GT_TFS: [number, string, "minute" | "hour" | "day", number][] = [
  [60, "1m", "minute", 1], [300, "5m", "minute", 5], [900, "15m", "minute", 15],
  [3600, "1h", "hour", 1], [14400, "4h", "hour", 4], [86400, "1d", "day", 1],
];

interface Pool { address: string; supply: number }
const pools = new Map<string, Promise<Pool | null>>();

async function getJson(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 429) throw Object.assign(new Error("GeckoTerminal is busy"), { busy: true });
  if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
  return r.json();
}

// The coin's main pool (GeckoTerminal's own order: volume and liquidity, as its embed picks) and its supply
// (fully diluted value over price), to turn prices into market caps.
export function geckoPool(mint: string): Promise<Pool | null> {
  let p = pools.get(mint);
  if (!p) {
    p = (async () => {
      const [list, tok] = await Promise.all([getJson(`${API}/tokens/${mint}/pools?page=1`), getJson(`${API}/tokens/${mint}`)]);
      const pool = list?.data?.[0]?.attributes?.address as string | undefined;
      const a = tok?.data?.attributes || {};
      const supply = +a.normalized_total_supply || (+a.fdv_usd && +a.price_usd ? +a.fdv_usd / +a.price_usd : 0);
      return pool && supply > 0 ? { address: pool, supply } : null;
    })();
    p.catch(() => pools.delete(mint));
    pools.set(mint, p);
    if (pools.size > 50) pools.delete(pools.keys().next().value!);
  }
  return p;
}

// The newest 1,000 of a size, kept 30 s: a link's hover (lib/coin.ts prefetchCoin) reads them, the chart draws them.
const firstRead = new Map<string, { at: number; p: Promise<GBar[]> }>();
export function geckoBars(mint: string, tf: number, opts: { before?: number; limit?: number } = {}): Promise<GBar[]> {
  if (opts.before || (opts.limit ?? 1000) !== 1000) return read(mint, tf, opts);
  const k = `${mint}:${tf}`, c = firstRead.get(k);
  if (c && Date.now() - c.at < 30_000) return c.p;
  const p = read(mint, tf, opts);
  p.catch(() => firstRead.delete(k));
  firstRead.set(k, { at: Date.now(), p });
  if (firstRead.size > 40) firstRead.delete(firstRead.keys().next().value!);
  return p;
}
export const warmGeckoBars = (mint: string, tf: number) => { geckoBars(mint, tf).catch(() => {}); };

// One read of candles, oldest first, as market caps in USD. `before`: candles before this time (seconds).
async function read(mint: string, tf: number, { before, limit = 1000 }: { before?: number; limit?: number } = {}): Promise<GBar[]> {
  const size = GT_TFS.find(([s]) => s === tf);
  if (!size) return [];
  const pool = await geckoPool(mint);
  if (!pool) return [];
  const [, , frame, agg] = size;
  const j = await getJson(`${API}/pools/${pool.address}/ohlcv/${frame}?aggregate=${agg}&limit=${limit}&currency=usd&token=${mint}${before ? `&before_timestamp=${before}` : ""}`);
  const list: number[][] = j?.data?.attributes?.ohlcv_list || [];
  const k = pool.supply;
  return list.filter((x) => x[1] > 0 && x[4] > 0).map(([t, o, h, l, c, v]) => ({ time: t, open: o * k, high: h * k, low: l * k, close: c * k, value: v || 0 })).reverse();
}
