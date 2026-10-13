// Replay: the real coin page played back from the coin's last day, as if it were happening now.
//
// The server hands over every trade the radar read for the coin in the last 24 h (GET /api/replay/<mint>,
// server/replay.js). A replay clock moves through them. While a replay runs, the coin page's own reads are
// answered here as they would have been at the clock's moment (candles, the trade list, big trades, the market
// cap, the last 5 minutes' flow), and each trade the clock passes is handed to the same listeners the live stream
// feeds (the chart, the header, the trade list). The page's components are the live ones, unchanged, so a replay
// looks and moves exactly like a live coin.
//
// Trading in a replay is paper trading against the replayed price: buys and sells go to a replay wallet (10 SOL,
// in memory, fresh each replay) and fill on the same curve/pool maths a real quote uses (pump.fun curve
// K = 30 * 1.073e9 virtual SOL·tokens and 1.25% fee, matched to /api/quote within 0.02%; a pool from its liquidity
// carried back by sqrt(price / price now)). Nothing is sent to the server's paper desk.
import { create } from "zustand";
import { api, setReadHook, type ReadHook } from "./api";
import { store } from "./utils";
import { setReplayHooks, emitCoinRows, emitCoinTrade } from "./pulse";
import { lockPaper, useTrade, type PaperWallet } from "./mode";
import type { CoinData, Holder, Paper, Quote, TokenDetail, Trade } from "./coin";
import { nudgeClock, setClock } from "./route";
import { setReplayPx as setPx, clearReplayPx } from "./livepx";
import type { CoinFomo, FomoHolder, FomoPost } from "@/pages/coin/FomoTabs";
import type { ChartPeople } from "@/pages/coin/Chart";

// A trade: [ms, market cap USD, size USD, buy, index into `wallets` (-1: journaled before wallets were kept)].
type Tr = [ms: number, mc: number, usd: number, buy: 0 | 1, w?: number];
// walletsDone: false while the server is still finding who made the trades journaled before wallets were kept.
// curve: the day has pump.fun curve trades; bondedAt: its first pool trade (null: on the curve all day).
interface Data { mint: string; t0: number | null; t1: number | null; trades: Tr[]; wallets?: string[]; sol: [number, number][]; walletsDone?: boolean; bondedAt?: number | null; curve?: boolean }

export interface ReplayState {
  mint: string | null;     // the coin being replayed (null: none)
  loading: boolean; error: string | null;
  t0: number; t1: number;  // the stretch that can be played
  at: number;              // the replay clock (ms)
  playing: boolean; speed: number;
  epoch: number;           // bumped on every jump: the chart reads its history again
  picking: boolean;        // choosing where to start: the whole day is on the chart and a click on a candle starts there
  rev: number;             // bumped when more of the day arrives (Fomo's history, trades' wallets): the panels read again
  skipQuiet: boolean;      // a stretch with no trade is shortened to QUIET_MS of wall time (the chart draws no candles for it anyway)
}
export const useReplay = create<ReplayState>(() => ({ mint: null, loading: false, error: null, t0: 0, t1: 0, at: 0, playing: false, speed: 1, epoch: 0, picking: false, rev: 0, skipQuiet: store.get<boolean>("replay:skipQuiet", true) }));
export const SPEEDS = [1, 2, 5, 10, 30, 60];
export const setSkipQuiet = (v: boolean) => { store.set("replay:skipQuiet", v); useReplay.setState({ skipQuiet: v }); };
const QUIET_MS = 1500;

let data: Data | null = null;
let idx = 0;                       // trades[0..idx) are at or before the clock
// The page's own reads that the replay only reshapes (the token, the coin, Fomo's holders, the chart's people):
// their server answers are kept for a while and reshaped again at each tick, instead of fetched again every
// few seconds while the replay plays (the fetches were most of a playing page's work and its network).
const bases = new Map<string, { t: number; d: unknown }>();
const BASE_TTL = 45_000;
const viaBase = (key: string, fn: (d: unknown) => unknown) => {
  const b = bases.get(key);
  if (b && performance.now() - b.t < BASE_TTL) return { data: fn(b.d) };
  return { transform: (d: unknown) => { bases.set(key, { t: performance.now(), d }); return fn(d); } };
};
const START_SOL = 10;
const SUPPLY = 1e9;

// ---------- the clock ----------
// The time the coin page lives in: the replay clock while this coin is replayed, else the real one.
export const replayNow = (mint?: string) => { const s = useReplay.getState(); return s.mint && (!mint || s.mint === mint) ? s.at : Date.now(); };
export const replaying = (mint: string) => useReplay.getState().mint === mint;

let timer = 0, lastTick = 0;
function tick() {
  const s = useReplay.getState();
  if (!s.mint || !data) return;
  const now = performance.now(), dt = Math.min(1000, now - lastTick);
  lastTick = now;
  if (s.playing) {
    let at = Math.min(s.t1, s.at + dt * s.speed);
    // A quiet stretch (no trade for a while) is not worth watching: the clock jumps to QUIET_MS (of wall time)
    // before the next trade, so every silence lasts at most that long at any speed.
    if (s.skipQuiet && idx < data.trades.length) { const next = data.trades[idx][0]; if (next - at > QUIET_MS * s.speed) at = next - QUIET_MS * s.speed; }
    advance(at);
    useReplay.setState({ at, playing: at < s.t1 });
  }
  timer = window.setTimeout(tick, 50);
}
// Hands every trade between the clock's last place and `at` to the live listeners, as the stream would.
// The chart only needs each second's high, low, close and volume (its candles are whole seconds), so a second
// with many trades is handed over as at most three: the highest (carrying the second's whole volume), the lowest
// and the last. At high speed that is a few chart updates per second instead of hundreds.
function advance(at: number) {
  if (!data) return;
  const m = data.mint, rows: (Trade & { mint: string })[] = [];
  let sec = -1, hi: Tr | null = null, lo: Tr | null = null, last: Tr | null = null, vol = 0;
  const flush = () => {
    if (!last) return;
    if (hi !== last) emitCoinTrade([m, hi![0], hi![1], vol, hi![3]]);
    if (lo !== last && lo !== hi) emitCoinTrade([m, lo![0], lo![1], 0, lo![3]]);
    emitCoinTrade([m, last[0], last[1], hi === last ? vol : 0, last[3]]);
    hi = lo = last = null; vol = 0;
  };
  while (idx < data.trades.length && data.trades[idx][0] <= at) {
    const x = data.trades[idx++], s = Math.floor(x[0] / 1000);
    if (s !== sec) { flush(); sec = s; }
    if (!hi || x[1] > hi[1]) hi = x;
    if (!lo || x[1] < lo[1]) lo = x;
    last = x; vol += x[2];
    rows.push({ ...tradeRow(x), mint: m });
  }
  flush();
  // The app-wide price (every figure on the page that scales with the market cap, the holders' values among
  // them) follows a few times a second, not on every tick: each change re-renders all of them.
  if (rows.length) { emitCoinRows(m, rows.slice(-60)); const now = performance.now(); if (now - pxAt > 250) { pxAt = now; setPx([[m, data.trades[idx - 1][1]]], false, true); } }
}
let pxAt = 0;
// The figures that follow the coin's latest trade (the header's market cap, the live market cap other panels
// scale by) set to the clock's after a jump, backwards too: a size-less tick at the clock's price.
function announce() {
  if (!data) return;
  const mc = mcAt(), at = useReplay.getState().at;
  if (!(mc > 0)) return;
  setPx([[data.mint, mc]], false, true);
  emitCoinTrade([data.mint, at, mc, 0, 1]);
}
const seek = (at: number) => {
  if (!data) return;
  let lo = 0, hi = data.trades.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (data.trades[mid][0] <= at) lo = mid + 1; else hi = mid; }
  idx = lo;
};
// The highest market cap among the first n trades, as a loop: Math.max(...) over up to 80k trades (server/replay.js
// MAX_TRADES) passes Safari's ~65k argument limit and throws.
// Kept as a running figure: while the replay plays only the trades since the last call are looked at.
let peakMemo: { d: Data; n: number; v: number } | null = null;
const peakTo = (n: number) => {
  if (!data) return -Infinity;
  let i = 0, peak = -Infinity;
  if (peakMemo && peakMemo.d === data && peakMemo.n <= n) { i = peakMemo.n; peak = peakMemo.v; }
  for (; i < n && i < data.trades.length; i++) if (data.trades[i][1] > peak) peak = data.trades[i][1];
  peakMemo = { d: data, n: Math.min(n, data.trades.length), v: peak };
  return peak;
};
let bigIdx: number[] | null = null;   // the trades of $1,000+, by index, found once per day of trades

// ---------- start, jump, stop ----------
export async function startReplay(mint: string) {
  stopReplay(false);
  useReplay.setState({ mint, loading: true, error: null, playing: false, speed: 1, epoch: useReplay.getState().epoch + 1 });
  try {
    const d = await api<Data>(`replay/${mint}`);
    if (useReplay.getState().mint !== mint) return;
    if (!d.trades.length || d.t0 == null || d.t1 == null) throw new Error("Blix has no trades for this coin in the last 24 hours, so there is nothing to replay.");
    data = d; wallet = fresh(); bases.clear(); bigIdx = null;
    // Opens on the whole day with the chart waiting for a click on the candle to start from (pickStart); "From the
    // start" begins at the first trade instead.
    const at = d.t1;
    seek(at);
    prevPaper = { paper: useTrade.getState().paper, wallet: useTrade.getState().wallet };
    useTrade.setState({ paper: true, wallet: walletFigures() });
    lockPaper(true);
    useReplay.setState({ loading: false, t0: d.t0, t1: d.t1, at, picking: true, epoch: useReplay.getState().epoch + 1 });
    setClock(() => useReplay.getState().at);
    lastTick = performance.now();
    clearTimeout(timer); timer = window.setTimeout(tick, 50);
    announce();
    void loadFomo(mint);
    if (!d.walletsDone) walletTimer = window.setTimeout(() => void loadWallets(mint), 15_000);
  } catch (e) {
    data = null;
    useReplay.setState({ loading: false, error: (e as Error).message });
  } finally {
    if (loaded?.mint === mint) { loaded.resolve(); loaded = null; }
  }
}
let prevPaper: { paper: boolean; wallet: PaperWallet | null } | null = null;
export function stopReplay(redraw = true) {
  const mint = useReplay.getState().mint;
  if (mint) clearReplayPx(mint);
  clearTimeout(timer);
  data = null; idx = 0; liquidityNowUsd = 0; mcNowUsd = 0; positions = []; nextId = 0; ledgerMemo = null; ledgerAt = -1; fomo = null; fomoMemo = null; cutMemo = null; peopleMemo = null; devWallet = null; groups = null; bases.clear(); bigIdx = null; clearTimeout(fomoTimer); clearTimeout(walletTimer);
  lockPaper(false);
  if (prevPaper) { useTrade.setState(prevPaper); prevPaper = null; }
  setClock(null);
  useReplay.setState({ mint: null, loading: false, error: null, playing: false, picking: false, ...(redraw ? { epoch: useReplay.getState().epoch + 1 } : {}) });
}
// Moves the clock to `at`: everything after it is hidden again and the chart reads its history anew.
export function jumpTo(at: number) {
  const s = useReplay.getState();
  if (!s.mint || !data) return;
  at = Math.max(s.t0, Math.min(s.t1, at));
  seek(at);
  useReplay.setState({ at, epoch: s.epoch + 1 });
  announce();
  nudgeClock();
}
// Choosing where to start: the whole day on the chart (the clock at its end), paused, until a candle is clicked.
export function setPicking(on: boolean) {
  const s = useReplay.getState();
  if (!s.mint || !data) return;
  useReplay.setState({ playing: false, picking: on });
  jumpTo(on ? s.t1 : s.at);
}
// The candle clicked while picking (its start, seconds; tf its size): the replay waits at its close, everything after
// it hidden again, and Play brings the next candles in.
export function pickStart(timeSec: number, tf: number) {
  if (!useReplay.getState().picking) return;
  useReplay.setState({ picking: false, playing: false });
  jumpTo((timeSec + tf) * 1000 - 1);
}
export const fromBeginning = () => { useReplay.setState({ picking: false, playing: false }); jumpTo(useReplay.getState().t0); };
export const setPlaying = (playing: boolean) => { lastTick = performance.now(); const s = useReplay.getState(); useReplay.setState({ playing: playing && s.at < s.t1 }); if (!playing) { pxAt = 0; announce(); } };
export const setSpeed = (speed: number) => useReplay.setState({ speed });
// One trade further.
export function stepTrade() {
  if (!data || idx >= data.trades.length) return;
  const at = data.trades[idx][0];
  advance(at);
  useReplay.setState({ at, playing: false });
}

// The day's trades again, with the wallets the server has found since (replaywallets.js), until it has them all.
let walletTimer = 0;
async function loadWallets(mint: string) {
  try {
    const d = await api<Data>(`replay/${mint}`);
    if (useReplay.getState().mint !== mint || !data) return;
    data = { ...data, trades: d.trades, wallets: d.wallets, walletsDone: d.walletsDone, bondedAt: d.bondedAt, curve: d.curve };
    bigIdx = null;
    seek(useReplay.getState().at);
    ledgerMemo = null; ledgerAt = -1;
    useReplay.setState({ rev: useReplay.getState().rev + 1 });
    if (!d.walletsDone) walletTimer = window.setTimeout(() => void loadWallets(mint), 20_000);
  } catch { walletTimer = window.setTimeout(() => void loadWallets(mint), 30_000); }
}

// ---------- the coin as of the clock ----------
const solAt = (t: number) => {
  const s = data?.sol || [];
  if (!s.length) return 0;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid][0] <= t) lo = mid; else hi = mid - 1; }
  return s[lo][1];
};
const mcAt = () => (data && idx > 0 ? data.trades[idx - 1][1] : data?.trades[0]?.[1] ?? 0);
// Who a wallet is on the coin, as the live trade list tags it (server/holders.js): the dev; a bundle wallet (first
// bought in the launch's own moment) or a sniper (within 1.5 s of it), when the replay starts at the launch; a
// top-10 holder at the clock (from the replay's ledger, when it has one).
let devWallet: string | null = null, groups: { mint: string; n: number; bundle: Set<string>; snipers: Set<string> } | null = null;
const LAUNCH_MC = 8000, SNIPE_MS = 1500, BUNDLE_MS = 400;
function launchGroups() {
  if (!data) return null;
  if (groups?.mint === data.mint && groups.n === data.wallets?.length) return groups;
  const g = { mint: data.mint, n: data.wallets?.length || 0, bundle: new Set<string>(), snipers: new Set<string>() }, tr = data.trades;
  if (tr.length && tr[0][1] < LAUNCH_MC) {
    const t0 = tr[0][0], seen = new Set<string>();
    for (const x of tr) {
      if (x[0] - t0 > SNIPE_MS) break;
      const w = x[4] != null && x[4] >= 0 ? data.wallets![x[4]] : null;
      if (!w || seen.has(w)) continue;
      seen.add(w);
      if (!x[3] || w === devWallet) continue;
      if (x[0] - t0 < BUNDLE_MS && seen.size > 1) g.bundle.add(w); else g.snipers.add(w);
    }
  }
  return (groups = g);
}
function tradeRow(x: Tr): Trade {
  const sol = solAt(x[0]), wallet = x[4] != null && x[4] >= 0 ? data?.wallets?.[x[4]] ?? null : null, g = wallet ? launchGroups() : null;
  const tag = !wallet ? null : wallet === devWallet ? "dev" : g?.bundle.has(wallet) ? "bundle" : g?.snipers.has(wallet) ? "sniper" : null;
  return { t: x[0], side: x[3] ? "buy" : "sell", sol: sol ? x[2] / sol : null, usd: x[2], tokens: x[1] > 0 ? x[2] / (x[1] / SUPPLY) : null, mcUsd: x[1], wallet, tx: null,
    tag, top10: !!wallet && !!ledgerMemo?.top10Set.has(wallet), label: null, followed: false, fomo: false };
}
// Candles of `tf` seconds from the trades up to the clock, the way the server's book builds them: a new candle
// opens at the last close; `since`: only those from that second on (the chart's quick refresh).
function candles(tf: number, since: number | null) {
  if (!data) return [];
  const rows: { time: number; open: number; high: number; low: number; close: number; value: number }[] = [];
  const tr = data.trades;
  let start = 0;
  if (since != null) { let lo = 0, hi = idx; while (lo < hi) { const mid = (lo + hi) >> 1; if (tr[mid][0] / 1000 < since) lo = mid + 1; else hi = mid; } start = lo; }
  let prevClose = start > 0 ? tr[start - 1][1] : null;
  for (let i = start; i < idx; i++) {
    const [ms, mc, usd] = tr[i], time = Math.floor(ms / 1000 / tf) * tf, last = rows[rows.length - 1];
    if (last && last.time === time) { last.high = Math.max(last.high, mc); last.low = Math.min(last.low, mc); last.close = mc; last.value += usd; }
    else { const o = prevClose ?? mc; rows.push({ time, open: o, high: Math.max(o, mc), low: Math.min(o, mc), close: mc, value: usd }); }
    prevClose = mc;
  }
  return rows;
}
function flow(ms: number) {
  if (!data) return null;
  const from = replayNow() - ms;
  let buys = 0, sells = 0, buyUsd = 0, sellUsd = 0;
  for (let i = idx - 1; i >= 0 && data.trades[i][0] >= from; i--) { const x = data.trades[i]; if (x[3]) { buys++; buyUsd += x[2]; } else { sells++; sellUsd += x[2]; } }
  return { buys, sells, buyUsd, sellUsd, volUsd: buyUsd + sellUsd, netUsd: buyUsd - sellUsd };
}
const mcAgo = (ms: number) => {
  if (!data || !idx) return null;
  const t = replayNow() - ms;
  let lo = 0, hi = idx - 1;
  if (data.trades[0][0] > t) return null;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (data.trades[mid][0] <= t) lo = mid; else hi = mid - 1; }
  return data.trades[lo][1];
};

// ---------- Fomo as of the clock ----------
// Every Fomo trader's buys and sells on the coin through the replayed day (GET /api/replay/<mint>?part=fomo, read
// page by page from Fomo's feed by server/replayfomo.js). With them the Known holders tab, each holder's entry and
// PnL, the chart's Fomo faces and the theses are rebuilt as they were at the clock. Holders Fomo lists now are
// walked back from their position now over their trades after the clock (anchored to Fomo's own figures); anyone
// else from their trades in the feed. Until the feed reaches back to the clock, the tab says it is loading.
interface FSwap { id: string; t: string; ms: number; buy: boolean; usd: number | null; price: number | null; mc: number | null; tok: number; handle: string; name: string | null; pic: string | null; dev: boolean; verified: boolean }
interface FFeed { done: boolean; from: number | null; swaps: FSwap[]; theses: (FomoPost & { ms: number })[] }
let fomo: FFeed | null = null, fomoTimer = 0;
async function loadFomo(mint: string) {
  clearTimeout(fomoTimer);
  if (useReplay.getState().mint !== mint) return;
  try {
    const d = await api<{ done: boolean; from: number | null; swaps: Omit<FSwap, "ms" | "tok">[]; theses: FomoPost[] }>(`replay/${mint}?part=fomo`);
    if (useReplay.getState().mint !== mint) return;
    const swaps = d.swaps.map((x) => {
      const ms = Date.parse(x.t), usd = x.usd ?? 0;
      return { ...x, ms, tok: x.price && x.price > 0 ? usd / x.price : x.mc && x.mc > 0 ? usd / (x.mc / SUPPLY) : 0 };
    }).filter((x) => x.ms > 0).sort((a, b) => a.ms - b.ms);
    fomo = { done: d.done, from: d.from, swaps, theses: d.theses.map((x) => ({ ...x, ms: Date.parse(x.t) || 0 })) };
    fomoMemo = null; cutMemo = null;
    useReplay.setState({ rev: useReplay.getState().rev + 1 });
    if (!d.done) fomoTimer = window.setTimeout(() => void loadFomo(mint), 2500);
  } catch { fomoTimer = window.setTimeout(() => void loadFomo(mint), 8000); }
}
// Fomo has the clock's moment covered: its feed reaches back past it (or all the way to its start).
const fomoCovers = (at: number) => !!fomo && (fomo.done || (fomo.from != null && fomo.from <= at));
interface FPos { handle: string; name: string | null; pic: string | null; dev: boolean; verified: boolean; tokens: number; cost: number; realized: number; traded: boolean }
let fomoMemo: { key: string; v: Map<string, FPos> } | null = null, cutMemo: { key: string; v: number } | null = null;
// Every Fomo trader's position at `T`, by lower-case handle.
// How many of Fomo's swaps are at or before `t`: the same count means the same positions, whatever the clock.
const swapsUpTo = (t: number) => {
  const sw = fomo?.swaps || [];
  let lo = 0, hi = sw.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sw[mid].ms <= t) lo = mid + 1; else hi = mid; }
  return lo;
};
function fomoPositions(snap: CoinFomo | null, T: number, memo = true): Map<string, FPos> {
  const key = `${swapsUpTo(T)}|${fomo?.swaps.length}|${snap?.read}`;
  if (memo && fomoMemo?.key === key) return fomoMemo.v;
  const pos = new Map<string, FPos>(), sw = fomo?.swaps || [];
  const at = (s: FSwap) => { const k = s.handle.toLowerCase(); let p = pos.get(k); if (!p) pos.set(k, (p = { handle: s.handle, name: s.name, pic: s.pic, dev: s.dev, verified: s.verified, tokens: 0, cost: 0, realized: 0, traded: false })); return p; };
  // Forward over the feed up to the clock.
  for (const s of sw) {
    if (s.ms > T) break;
    const p = at(s), usd = s.usd ?? 0;
    p.traded = true;
    if (s.buy) { p.tokens += s.tok; p.cost += usd; }
    else { const q = Math.min(s.tok, p.tokens), part = p.tokens > 0 ? q / p.tokens : 0, basis = p.cost * part; p.realized += usd - basis; p.cost -= basis; p.tokens -= q; }
  }
  // Fomo's holders now, walked back over their trades between the clock and Fomo's read.
  const read = snap?.read ?? Date.now(), later = new Map<string, FSwap[]>();
  for (let i = sw.length - 1; i >= 0 && sw[i].ms > T; i--) if (sw[i].ms <= read) { const k = sw[i].handle.toLowerCase(); (later.get(k) || later.set(k, []).get(k)!).push(sw[i]); }
  for (const h of snap?.holders || []) {
    if (!h.handle || h.amount == null) continue;
    const k = h.handle.toLowerCase();
    let tokens = h.amount, cost = h.cost ?? (h.entry != null ? h.entry * h.amount : 0), realized = h.realized ?? 0;
    for (const s of later.get(k) || []) {   // newest first
      const usd = s.usd ?? 0;
      if (s.buy) { tokens -= s.tok; cost -= usd; }
      else { const avg = tokens > 0 && cost > 0 ? cost / tokens : h.entry ?? (s.price || 0); tokens += s.tok; cost += s.tok * avg; realized -= usd - s.tok * avg; }
    }
    pos.set(k, { handle: h.handle, name: h.name, pic: h.pic, dev: h.dev, verified: h.verified, tokens: Math.max(0, tokens), cost: Math.max(0, cost), realized, traded: true });
  }
  if (memo) fomoMemo = { key, v: pos };
  return pos;
}
// Rebuilt from trade sizes, sold-out positions keep a little dust, so "holds it" is a token amount: the one at which
// the count at Fomo's own read equals the count Fomo gives. The same cut then counts holders at any moment.
function holdCut(snap: CoinFomo): number {
  const key = `${fomo?.swaps.length}|${snap.read}|${snap.totalHolders}`;
  if (cutMemo?.key === key) return cutMemo.v;
  const toks = [...fomoPositions(snap, snap.read ?? Date.now(), false).values()].map((p) => p.tokens).filter((t) => t > 0).sort((a, b) => b - a);
  const n = snap.totalHolders ?? 0, v = n > 0 && n <= toks.length ? toks[n - 1] : 1;
  cutMemo = { key, v };
  return v;
}
function fomoAtClock(c: CoinFomo): CoinFomo {
  const T = replayNow();
  if (!fomoCovers(T)) return { ...c, read: null, loading: true, holders: [], theses: [], totalHolders: null };
  const px = mcAt() / SUPPLY, snap = new Map(c.holders.map((h) => [String(h.handle).toLowerCase(), h]));
  const pos = fomoPositions(c, T), cut = holdCut(c);
  // Theses: Fomo's and the feed's, posted by the clock; each author's position as it was then.
  const seen = new Set<string>(), theses: FomoPost[] = [];
  const thesisOf = new Map<string, FomoPost>();
  for (const x of [...(fomo?.theses || []), ...c.theses.map((y) => ({ ...y, ms: Date.parse(y.t) || 0 }))].sort((a, b) => a.ms - b.ms)) {
    if (x.ms > T || seen.has(x.id)) continue;
    seen.add(x.id);
    const p = x.handle ? pos.get(x.handle.toLowerCase()) : null, value = p ? p.tokens * px : null;
    const post: FomoPost = { ...x, position: p ? { amount: p.tokens, value, unrealized: value != null ? value - p.cost : null, realized: p.realized, pct: p.cost > 0 && value != null ? ((value - p.cost) / p.cost) * 100 : null, closed: p.tokens <= 0 && p.traded ? "closed" : null } : null };
    theses.push(post);
    if (x.handle) thesisOf.set(x.handle.toLowerCase(), post);
  }
  const holders: FomoHolder[] = [];
  for (const [k, p] of pos) {
    const value = p.tokens * px;
    if (!(p.tokens >= cut) || !(value > 0)) continue;
    const now = snap.get(k), th = thesisOf.get(k);
    holders.push({ handle: p.handle, name: p.name, pic: p.pic, followers: now?.followers ?? null, verified: p.verified, wallet: now?.wallet ?? null,
      amount: p.tokens, value, pnl: value - p.cost + p.realized, unrealized: value - p.cost, realized: p.realized, cost: p.cost, entry: p.tokens > 0 ? p.cost / p.tokens : null,
      external: now?.external ?? false, dev: p.dev, avgHold: now?.avgHold ?? null, thesis: th ? { id: th.id, text: th.text, likes: th.likes, mcap: th.mcap, price: th.price, t: th.t } : null });
  }
  holders.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  // The page's "updated … ago" and its between-reads rescaling follow each replayed trade.
  const last = data && idx > 0 ? data.trades[idx - 1][0] : T;
  return { ...c, read: last, loading: false, refreshing: false, error: null, holders: holders.slice(0, 100), totalHolders: holders.length, theses: theses.reverse() };
}
// The chart's Fomo faces: the biggest Fomo traders (by size traded up to the clock) and their trades by then.
const FACES = 6;
let peopleMemo: { x: ChartPeople; n: number; v: ChartPeople } | null = null;
function peopleAtClock(x: ChartPeople): ChartPeople {
  const T = replayNow(), n = swapsUpTo(T) + (fomoCovers(T) ? 0 : -1);
  if (peopleMemo && peopleMemo.x === x && peopleMemo.n === n) return peopleMemo.v;
  const v = peopleAtClockNow(x, T);
  peopleMemo = { x, n, v };
  return v;
}
function peopleAtClockNow(x: ChartPeople, T: number): ChartPeople {
  const keep = { ...x, trades: (x.trades || []).filter((t) => t.t <= T), calls: (x.calls || []).filter((t) => t.t <= T) };
  if (!fomoCovers(T)) return keep;
  const size = new Map<string, number>();
  for (const s of fomo!.swaps) { if (s.ms > T) break; if (s.pic) size.set(s.handle, (size.get(s.handle) || 0) + (s.usd || 0)); }
  const top = new Set([...size.entries()].sort((a, b) => b[1] - a[1]).slice(0, FACES).map(([h]) => h));
  const people = new Map(keep.people.map((p) => [p.id, p]));
  const trades = keep.trades.filter((t) => !t.who.startsWith("fomo:"));
  for (const s of fomo!.swaps) {
    if (s.ms > T) break;
    if (!top.has(s.handle)) continue;
    const id = `fomo:${s.handle}`;
    if (!people.has(id)) people.set(id, { id, src: "fomo", name: s.name || s.handle, pic: s.pic, followers: 1e9, dev: s.dev });
    trades.push({ t: s.ms, buy: s.buy, usd: s.usd, mc: s.mc, who: id });
  }
  trades.sort((a, b) => a.t - b.t);
  return { ...keep, people: [...people.values()], trades };
}

// On pump.fun's curve at the clock: a coin with curve trades in the day, before its first pool trade.
const onCurveAt = (t = replayNow()) => !!data?.curve && (data.bondedAt == null || t < data.bondedAt);
const pumpCoin = () => !!data && (!!data.curve || data.bondedAt != null || data.mint.endsWith("pump"));

// ---------- paper trading in the replay ----------
// pump.fun's curve until the coin bonds (≈410.9 SOL of market cap), then a pool sized from today's liquidity.
const CURVE_K = 30 * 1.073e9, FEE = 0.0125, MIGRATE_SOL = 410.9;
let liquidityNowUsd = 0, mcNowUsd = 0;
function reserves(mcUsd: number, sol: number): [number, number] {
  const mcSol = sol ? mcUsd / sol : 0, price = mcSol / SUPPLY;   // SOL per token
  if (onCurveAt()) { const vSol = Math.sqrt(CURVE_K * price); return [vSol, CURVE_K / vSol]; }
  const nowSol = liquidityNowUsd > 0 && sol ? liquidityNowUsd / 2 / sol : 80;
  const rSol = Math.max(5, nowSol * (mcNowUsd > 0 ? Math.sqrt(mcUsd / mcNowUsd) : 1));
  return [rSol, rSol / price];
}
function quoteBuy(solIn: number): Quote {
  const sol = solAt(replayNow()), mc = mcAt(), [rs, rt] = reserves(mc, sol);
  const net = solIn * (1 - FEE), out = rt - (rs * rt) / (rs + net);
  const spot = rs / rt, exec = solIn / out;
  return { outTokens: out, impactPct: (exec / spot - 1) * 100, avgMcapUsd: exec * SUPPLY * sol, spotMcapUsd: mc, usdIn: solIn * sol, feeSol: solIn * FEE, src: "pump.fun" };
}
function sellSol(tokens: number) {
  const sol = solAt(replayNow()), [rs, rt] = reserves(mcAt(), sol);
  const gross = rs - (rs * rt) / (rt + tokens);
  return gross * (1 - FEE);
}
// ---------- holders and traders as of the clock ----------
// Every wallet's position from the replayed trades up to the clock, the way the live ledger keeps it: only when
// the trades carry wallets for (nearly) all of the coin's replayed day, else the coin page keeps today's tabs.
interface Book { w: string; tokens: number; maxTokens: number; boughtTok: number; soldTok: number; boughtSol: number; soldSol: number; boughtUsd: number; soldUsd: number; buyMcW: number; sellMcW: number; trades: number; first: number }
let ledgerAt = -1, ledgerMemo: ReturnType<typeof ledgerAtClock> | null = null;
let wkMemo: { d: Data; v: boolean } | null = null;
const walletsKnown = () => {
  if (!data?.wallets?.length || !data.trades.length) return false;
  if (wkMemo?.d === data) return wkMemo.v;
  let n = 0; for (const x of data.trades) if ((x[4] ?? -1) >= 0) n++;
  wkMemo = { d: data, v: n / data.trades.length >= 0.9 };
  return wkMemo.v;
};
// The books carry on from where they were: while the replay plays only the trades since the last look are
// added; a jump back (or the day's trades arriving anew) starts them over.
let books = new Map<string, Book>(), booksTo = 0, booksOf: Data | null = null;
function ledgerAtClock() {
  if (booksOf !== data || idx < booksTo) { books = new Map(); booksTo = 0; booksOf = data; }
  for (let i = booksTo; i < idx; i++) {
    const [ms, mc, usd, buy, wi] = data!.trades[i];
    if (wi == null || wi < 0 || !(mc > 0)) continue;
    const w = data!.wallets![wi], sol = solAt(ms) || 1, tokens = usd / (mc / SUPPLY), s = usd / sol;
    let b = books.get(w);
    if (!b) books.set(w, (b = { w, tokens: 0, maxTokens: 0, boughtTok: 0, soldTok: 0, boughtSol: 0, soldSol: 0, boughtUsd: 0, soldUsd: 0, buyMcW: 0, sellMcW: 0, trades: 0, first: ms }));
    b.trades++;
    if (buy) { b.tokens += tokens; b.boughtTok += tokens; b.boughtSol += s; b.boughtUsd += usd; b.buyMcW += mc * tokens; }
    else { const t = Math.min(tokens, b.tokens); b.tokens -= t; b.soldTok += tokens; b.soldSol += s; b.soldUsd += usd; b.sellMcW += mc * tokens; }
    b.maxTokens = Math.max(b.maxTokens, b.tokens);
  }
  booksTo = idx;
  const mc = mcAt(), sol = solAt(replayNow()) || 1, pxSol = mc / SUPPLY / sol;
  const rows = [...books.values()].map((b): Holder => {
    const valueSol = b.tokens * pxSol, costSold = b.boughtTok ? b.boughtSol * Math.min(1, b.soldTok / b.boughtTok) : 0;
    return { wallet: b.w, tokens: b.tokens, pct: (b.tokens / SUPPLY) * 100, maxPct: (b.maxTokens / SUPPLY) * 100,
      boughtSol: b.boughtSol, soldSol: b.soldSol, valueSol, pnlSol: b.soldSol + valueSol - b.boughtSol, realizedSol: b.soldSol - costSold,
      boughtUsd: b.boughtUsd, soldUsd: b.soldUsd, valueUsd: valueSol * sol, pnlUsd: (b.soldSol + valueSol - b.boughtSol) * sol,
      avgBuyMc: b.boughtTok ? b.buyMcW / b.boughtTok : null, avgSellMc: b.soldTok ? b.sellMcW / b.soldTok : null, trades: b.trades, first: b.first,
      status: b.tokens <= 1 ? "sold all" : b.soldTok > 0 ? "sold some" : "holding", tag: null, top10: false, label: null, followed: false, fomo: false };
  });
  const held = rows.filter((r) => (r.tokens ?? 0) > 1).sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
  held.slice(0, 10).forEach((r) => { r.top10 = true; });
  const top10 = held.slice(0, 10).reduce((a, r) => a + (r.pct ?? 0), 0);
  return {
    count: held.length, wallets: rows.length, top10, list: held.slice(0, 100), top10Set: new Set(held.slice(0, 10).map((r) => r.wallet)),
    traders: [...rows].sort((a, b) => (b.pnlSol ?? 0) - (a.pnlSol ?? 0)).slice(0, 100),
    early: [...rows].sort((a, b) => a.first - b.first).slice(0, 50),
  };
}
const ledger = () => {
  if (!walletsKnown()) return null;
  if (ledgerAt !== idx || !ledgerMemo) { ledgerMemo = ledgerAtClock(); ledgerAt = idx; }
  return ledgerMemo;
};

let positions: Paper[] = [], nextId = 0;
let wallet = fresh();
function fresh() { return { start: START_SOL, cash: START_SOL, realized: 0, trades: 0 }; }
function walletFigures(): PaperWallet {
  const open = positions.filter((p) => p.status === "open"), held = open.reduce((a, p) => a + sellSol(p.tokens || 0), 0);
  const equity = wallet.cash + held, sol = solAt(replayNow());
  return { start: wallet.start, cash: wallet.cash, equity, pnl: equity - wallet.start, realized: wallet.realized, open: open.length, trades: wallet.trades, unpriced: 0, solUsd: sol };
}
const ID0 = 900_000_000;   // replay rows' ids: never the paper desk's
function rows(): Paper[] {
  const mc = mcAt();
  return positions.map((p) => {
    if (p.status !== "open") return p;
    const v = sellSol(p.tokens || 0);
    return { ...p, valueSol: v, mcapNow: mc, mult: p.sol ? v / p.sol : null };
  });
}
function buy(solIn: number) {
  if (!(solIn > 0)) throw new Error("Enter an amount of SOL.");
  if (solIn > wallet.cash + 1e-9) throw new Error(`Not enough SOL in the replay wallet (${wallet.cash.toFixed(3)} left).`);
  const q = quoteBuy(solIn);
  wallet.cash -= solIn; wallet.trades++;
  positions.push({ id: ID0 + ++nextId, mint: data!.mint, t: replayNow(), sol: solIn, mcap0: q.avgMcapUsd ?? mcAt(), status: "open", tokens: q.outTokens });
  return { position: positions[positions.length - 1] };
}
function sell(id: number, pct: number) {
  const p = positions.find((x) => x.id === id && x.status === "open");
  if (!p) throw new Error("That position is already closed.");
  const share = Math.max(0, Math.min(100, pct)) / 100, tokens = (p.tokens || 0) * share, out = sellSol(tokens), part = p.sol * share;
  wallet.cash += out; wallet.realized += out - part; wallet.trades++;
  const closed: Paper = { ...p, id: share < 1 ? ID0 + ++nextId : p.id, sol: part, tokens, status: "closed", exit_sol: out, exit_mcap: mcAt(), exit_t: replayNow(), exit_why: "replay" };
  if (share < 1) { p.sol -= part; p.tokens = (p.tokens || 0) - tokens; positions.push(closed); } else Object.assign(p, closed);
  return { position: closed };
}

// ---------- answering the coin page's reads ----------
// The coin's reads while its replay is still loading wait for it (so the page never shows today's figures first).
let loaded: { mint: string; done: Promise<void>; resolve: () => void } | null = null;
const whenLoaded = (mint: string) => {
  if (loaded?.mint !== mint) {
    let resolve = () => {};
    const done = new Promise<void>((ok) => { resolve = ok; });
    loaded = { mint, done, resolve };
    // Never held longer than this, whatever happens to the replay's own read.
    window.setTimeout(resolve, 30_000);
  }
  return loaded.done;
};
const hook: ReadHook = (path, init) => {
  const s = useReplay.getState();
  // (A page opened on a coin's /replay link counts as loading from its first read, before the replay has started.)
  const pending = s.mint ? (!data && s.loading ? s.mint : null) : (/#\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})\/replay$/.exec(location.hash)?.[1] ?? null);
  if (pending && path.includes(pending) && !path.startsWith("replay/")) {
    // The Practice bar starts the replay once the page is up, and the page waits on these reads: start it here.
    if (!s.mint) queueMicrotask(() => { if (!useReplay.getState().mint) void startReplay(pending); });
    return { wait: whenLoaded(pending) };
  }
  if (!s.mint || !data) return undefined;
  const m = s.mint, q = new URLSearchParams(path.split("?")[1] || ""), p = path.split("?")[0];
  const body = (): Record<string, unknown> => { try { return JSON.parse(String(init?.body || "{}")); } catch { return {}; } };
  if (p === `candles/${m}`) {
    const tf = Number(q.get("tf")) || 60, since = q.get("since") != null ? Number(q.get("since")) : null;
    const r = candles(tf, since);
    return { data: { mint: m, tf, rows: r, source: "Blix", live: true, partial: since != null, first: data.trades[0] ? Math.floor(data.trades[0][0] / 1000 / tf) * tf : null, gaps: [] } };
  }
  if (p === `coin/${m}/trades`) {
    const n = Math.min(500, Number(q.get("limit")) || 100), out: Trade[] = [];
    for (let i = idx - 1; i >= 0 && out.length < n; i--) out.push(tradeRow(data.trades[i]));
    return { data: { mint: m, source: "live", trades: out } };
  }
  if (p === `coin/${m}/big`) {
    if (!bigIdx) { bigIdx = []; for (let i = 0; i < data.trades.length; i++) if (data.trades[i][2] >= 1000) bigIdx.push(i); }
    const out: Trade[] = [];
    for (let k = bigIdx.length - 1; k >= 0 && out.length < 400; k--) { const i = bigIdx[k]; if (i < idx) out.push(tradeRow(data.trades[i])); }
    return { data: { mint: m, source: "live", trades: out } };
  }
  if (p === `token/${m}`) return viaBase(p, (d: unknown) => {
    const r = d as TokenDetail, mc = mcAt(), h = mcAgo(3600e3);
    if (r?.token) { liquidityNowUsd = r.token.liquidity || liquidityNowUsd; mcNowUsd ||= r.token.mcap || 0; }
    const liq = liquidityNowUsd > 0 && mcNowUsd > 0 && mc > 0 ? liquidityNowUsd * Math.sqrt(mc / mcNowUsd) : r?.token?.liquidity;
    const curve = onCurveAt(), solNow = solAt(replayNow()), m1 = mcAgo(60e3);
    return r?.token ? { ...r, progress: curve && solNow ? Math.min(0.999, mc / solNow / MIGRATE_SOL) : r.progress, token: { ...r.token, graduated: pumpCoin() ? (curve ? 0 : 1) : r.token.graduated, liquidity: liq, mcap: mc, price: mc / SUPPLY, peak_mcap: peakTo(Math.max(1, idx)), chg_h1: h ? (mc / h - 1) * 100 : null, vol_m5: flow(5 * 60e3)?.volUsd ?? null },
      live: r.live ? { ...r.live, mcap: mc, ath: peakTo(Math.max(1, idx)), chg1m: m1 ? (mc / m1 - 1) * 100 : null, progress: curve && solNow ? Math.min(0.999, mc / solNow / MIGRATE_SOL) : r.live.progress, buys: undefined, sells: undefined, traders: undefined } : r.live, paper: rows(), signals: (r.signals || []).filter((x) => x.t <= replayNow()) } : r;
  });
  if (p === `coin/${m}`) return viaBase(p, (d: unknown) => {
    const c = d as CoinData, mc = mcAt(), f = flow(5 * 60e3), sol = solAt(replayNow());
    if (!c) return c;
    const ath = peakTo(Math.max(1, idx));
    // Holders, top traders and early buyers as they were at the clock, when the replayed trades carry wallets.
    devWallet = c.dev?.wallet ?? devWallet;
    const L = ledger();
    const people = L ? {
      holders: { count: L.count, wallets: L.wallets, trades: idx, since: data!.t0, last: replayNow(), genesis: true, partial: false, frozen: false, top10: L.top10, list: L.list, source: "ledger" as const },
      traders: L.traders, early: L.early, jupiter: null,
      info: { ...c.info, holders: L.count, top10: L.top10, traders: L.wallets, source: "ledger" },
    // Not yet known who made every trade (the server is still finding the older ones): today's holders would be the
    // future, so the tabs wait and the header shows no holder figures.
    } : { holders: null, traders: [], early: [], info: { ...c.info, holders: null, top10: null } };
    return { ...c, ...people, mcUsd: mc, priceUsd: mc / SUPPLY, athUsd: ath > 0 ? ath : mc, solUsd: sol || c.solUsd, live: true, priceAgeMs: 0,
      progress: pumpCoin() && sol ? (onCurveAt() ? Math.min(0.999, mc / sol / MIGRATE_SOL) : 1) : c.progress, onCurve: pumpCoin() ? onCurveAt() : c.onCurve,
      m5: f ? { source: "live", ...f, traders: null } : c.m5, marks: (c.marks || []).filter((x) => x.t <= replayNow()),
      paid: c.paid ? { orders: c.paid.orders.filter((o) => o.t <= replayNow()), boosts: c.paid.boosts.filter((o) => o.t <= replayNow()) } : c.paid };
  });
  if (p === `coin/${m}/people`) return viaBase(p, (d: unknown) => (d ? peopleAtClock(d as ChartPeople) : d));
  // Theses (pump.fun callouts and Fomo's): only those posted by the clock's moment.
  if (p === `coin/${m}/callouts`) return viaBase(p, (d: unknown) => {
    const x = d as { items?: { posted?: number; t?: number }[] | null } | null, now = replayNow();
    return x?.items ? { ...x, items: x.items.filter((i) => (i.posted || i.t || 0) <= now), total: null } : x;
  });
  // Known holders and theses as they were at the clock (Fomo's history above).
  if (p === `coin/${m}/fomo`) return viaBase(p, (d: unknown) => (d && (d as CoinFomo).holders ? fomoAtClock(d as CoinFomo) : d));
  if (p === "quote" && q.get("mint") === m && q.get("side") === "buy") return { data: quoteBuy(Number(q.get("amount")) || 0) };
  const pv = p.match(/^paper\/(\d+)\/preview$/);
  if (pv && Number(pv[1]) > ID0) {
    const row = positions.find((x) => x.id === Number(pv[1])), pct = Number(q.get("pct")) || 100;
    const tokens = (row?.tokens || 0) * pct / 100, out = sellSol(tokens);
    return { data: { outSol: out, impactPct: null, spotMcapUsd: mcAt(), feeSol: out * FEE / (1 - FEE), src: "pump.fun" } as Quote };
  }
  if (p === "paper/wallet") return { data: walletFigures() };
  if (init?.method === "POST" && p === "paper/quoted" && body().mint === m) return { data: buy(Number(body().sol)) };
  const sq = p.match(/^paper\/(\d+)\/sellq$/);
  if (init?.method === "POST" && sq && Number(sq[1]) > ID0) return { data: sell(Number(sq[1]), Number(body().pct) || 100) };
  return undefined;
};
setReadHook(hook);
// While a coin is replayed, the live stream's trades, prices and holder figures for it are left out.
setReplayHooks((mint) => useReplay.getState().mint === mint && data != null);
// The run so far, for the PnL cards (components/PnlCard.tsx): the replay wallet from its start to now, its trades,
// and how long it has been in the coin (its first buy to its last sell, or to the clock while it still holds).
export function practiceStats() {
  if (!data) return null;
  const w = walletFigures(), first = positions.length ? Math.min(...positions.map((p) => p.t)) : null;
  const open = positions.some((p) => p.status === "open"), exits = positions.filter((p) => p.status === "closed").map((p) => p.exit_t || 0);
  const last = open ? replayNow() : exits.length ? Math.max(...exits) : null;
  return { start: w.start, equity: w.equity, pnl: w.pnl, trades: w.trades, solUsd: w.solUsd, first, heldMs: first != null && last != null ? last - first : null, at: replayNow() };
}
// The rail's paper figure follows the replay wallet after each trade.
export const refreshReplayWallet = () => { if (useReplay.getState().mint) useTrade.setState({ wallet: walletFigures() }); };
