import { useEffect, useState } from "react";
import { create } from "zustand";
import { api, apiAged, streamFailed, streamInit, streamUrl } from "./api";
import { picReady } from "./pics";
import { setPx } from "./livepx";
import { store } from "./utils";
import { receiveMetrics, metricSession, metricReplayGuard } from './metrics';
import type { Trade } from "./coin";

export type ColKey = "new" | "running" | "stretch" | "migrated";
export const COLS: [ColKey, string][] = [["new", "New pairs"], ["running", "Running now"], ["stretch", "Final stretch"], ["migrated", "Migrated"]];

export interface Coin {
  mint: string; symbol?: string; name?: string; age?: number; born: number;
  mcap?: number | null; startMcapSol?: number | null; vol?: number | null; liveVol?: number | null; liq?: number | null;
  chg1m?: number | null; chg5?: number | null; buys?: number; sells?: number; traders?: number | null;
  holders?: number | null; top10?: number | null; dev?: number | null; devSol?: number | null; devCount?: number;
  migrating?: number | null;   // curve full, pool not trading yet: when the curve filled (server livetrades.js migrationOf)
  fees?: number | null; feesSince?: number | null;   // fees paid to trade it, SOL (server/coinfees.js)
  progress?: number | null; graduated?: boolean; dex?: string | null; pool?: string | null; mayhem?: boolean;
  x?: string | null; web?: string | null; tg?: string | null; tiktok?: string | null; desc?: string | null; paid?: boolean | null; peak?: number | null; chg1h?: number | null;
  state?: string; live?: boolean; lt?: number; side?: "b" | "s" | null; tr?: number | null;
  hl?: { h?: number | null; t10?: number | null; dev?: number | null; ds?: string | number | null; sn?: number; snN?: number; bd?: number; bdN?: number } | null;
  ai?: { status?: string; grade?: string | null; score?: number | null; tier?: string | null; verdict?: string | null; model?: string | null; rated?: boolean; action?: string | null; pwin?: number | null; tag?: string | null; t?: number | null } | null;
  tri?: { label: string; score: number; why?: string; src?: string } | null;
  warn?: { kind: "stale" | "emptied" | "odd-curve"; text: string } | null;
  win?: { trades: number; traders: number; netSol: number; chg?: number | null } | null;
  mv?: boolean;   // real trading in the last 5 minutes (server/coverage.js): never hidden as a rug
}

interface Live { launchesPerMin?: number; tradesPerSec?: number; solUsd?: number; queued?: number; running?: number; ratedHour?: number; feed?: string; ai?: { fast?: string; deep?: string } }
interface PulseResponse { newPairs: Coin[]; stretch: Coin[]; migrated: Coin[]; running: Coin[]; live: Live; ts?: number }

interface PulseState {
  coins: Record<string, Coin>;
  cols: Record<ColKey, string[]>;
  live: Live;
  pressure: number;        // -1 all selling … +1 all buying, smoothed over recent trade batches
  connected: boolean;
  // The stream is not getting through but the 2 s poll is answering (Cloudflare quick tunnels do not carry the
  // live stream): the figures are still current, just refreshed by polling.
  polling: boolean;
  loaded: boolean;
  // The board this browser last had on screen, back before the radar has answered (a refresh paints the columns
  // as they were, ages still right, instead of a skeleton; the first real board then replaces them).
  restored: boolean;
}

// The board as it was when the page was last left or 30 s before: ~200 KB, this browser's localStorage, taken
// back for 15 minutes. `lt` (the browser's own trade clock) is dropped so a stale figure never outranks the board's.
const SNAP = "pulse:board", SNAP_TTL = 15 * 60_000;
function readSnapshot(): Pick<PulseState, "coins" | "cols" | "live" | "restored"> {
  const empty = { coins: {}, cols: { new: [], running: [], stretch: [], migrated: [] }, live: {}, restored: false };
  const v = store.get<{ t: number; coins: Record<string, Coin>; cols: Record<ColKey, string[]>; live: Live } | null>(SNAP, null);
  if (!v || !v.coins || !v.cols || Date.now() - v.t > SNAP_TTL) return empty;
  const coins: Record<string, Coin> = {};
  for (const m in v.coins) { const { lt: _lt, live: _live, ...c } = v.coins[m] as Coin & { lt?: number }; coins[m] = c as Coin; }
  const cols = { new: v.cols.new || [], running: v.cols.running || [], stretch: v.cols.stretch || [], migrated: v.cols.migrated || [] };
  return { coins, cols, live: v.live || {}, restored: Object.values(cols).some((l) => l.length > 0) };
}
export function saveSnapshot() {
  const s = usePulse.getState();
  if (!s.loaded) return;
  const coins: Record<string, Coin> = {};
  for (const list of Object.values(s.cols)) for (const m of list) if (s.coins[m]) coins[m] = s.coins[m];
  store.set(SNAP, { t: Date.now(), coins, cols: s.cols, live: s.live });
}

export const usePulse = create<PulseState>(() => ({
  ...readSnapshot(), pressure: 0, connected: false, polling: false, loaded: false,
}));

// A coin keeps the `born` it was given (so its age never jitters between polls), except when the board's own
// clock moved it: a coin that migrates is born again at its pool's creation (server/pulse.js row age), so in
// Migrated it reads "1s" and sits on top, not its launch age halfway down.
const withBorn = (c: Coin, prev?: Coin): Coin => {
  const fromAge = Date.now() - (c.age || 0);
  return { ...c, born: prev && (prev.graduated === c.graduated || Math.abs(prev.born - fromAge) < 30_000) ? prev.born : fromAge };
};

// The figures the trade stream keeps current. A poll is older than the stream, so for a coin the stream
// touched in the last few seconds these stay as they are instead of jumping back and flashing.
const STREAMED = ["mcap", "buys", "sells", "liveVol", "vol", "liq", "traders", "progress", "side", "chg1m", "hl", "live", "state"] as const;
const FRESH_MS = 10_000;

// Keep briefly missing coins to prevent flicker, then order every column by the age shown on its rows.
// First discovery is not creation: an hours-old coin arriving in a poll belongs below newer coins.
const newestFirst = (mints: string[], coins: Record<string, Coin>) => [...new Set(mints)]
  .sort((a, b) => (coins[b]?.born || 0) - (coins[a]?.born || 0) || a.localeCompare(b)).slice(0, 160);
// Final Stretch is ranked by volume (the owner, 2026-10-10): the busiest coin on top, and a coin whose volume
// picks up climbs past the ones going quiet. Ties fall back to the newest.
const vol = (c?: Coin) => c?.vol ?? c?.liveVol ?? 0;
const byVolume = (mints: string[], coins: Record<string, Coin>) => [...new Set(mints)]
  .sort((a, b) => vol(coins[b]) - vol(coins[a]) || (coins[b]?.born || 0) - (coins[a]?.born || 0) || a.localeCompare(b)).slice(0, 160);
// Live trades change volumes between board reads: the column is re-ranked at most every 2 s, so rows move as
// volume shifts without jittering on every trade.
let rankTimer: number | undefined;
function rerankSoon() {
  if (rankTimer) return;
  rankTimer = window.setTimeout(() => {
    rankTimer = undefined;
    usePulse.setState((s) => {
      const next = byVolume(s.cols.stretch, s.coins);
      return next.every((m, i) => m === s.cols.stretch[i]) ? s : { cols: { ...s.cols, stretch: next } };
    });
  }, 2000);
}
const GRACE_MS = 30_000;
const missingSince = new Map<string, number>();
function settle(col: ColKey, prev: string[], next: string[], now: number, moved: Set<string>) {
  const had = new Set(prev), inNext = new Set(next);
  const stays = (m: string) => {
    const k = `${col}:${m}`;
    if (col === "new" || inNext.has(m)) { missingSince.delete(k); return true; }
    if (moved.has(m)) { missingSince.delete(k); return false; }   // it went to another column: no grace
    const t = missingSince.get(k) ?? missingSince.set(k, now).get(k)!;
    return now - t < GRACE_MS;
  };
  return [...next.filter((m) => !had.has(m)), ...prev.filter(stays)];
}

// One board read at a time (main.tsx reads it before the first frame and startPulse's loop straight after), and
// when the last one came: a board under 5 s old is not read again.
let boardAsk: Promise<void> | null = null, boardAt = 0;
export function loadPulse(): Promise<void> {
  return (boardAsk ||= readBoard().then(() => { boardAt = Date.now(); }).finally(() => { boardAsk = null; }));
}
async function readBoard() {
  // The first board may be the page server's kept copy (lib/api.ts): it is on screen at once, and the radar's own
  // is read straight after. Every later read is the radar's own, so the board never steps back to an older one.
  const first = !usePulse.getState().loaded;
  const got = first ? await apiAged<PulseResponse>("pulse") : null;
  const d = got ? got.data : await api<PulseResponse>("pulse");
  if (got && got.age > 0) setTimeout(() => { loadPulse().catch(() => {}); }, 0);
  usePulse.setState((s) => {
    const coins: Record<string, Coin> = { ...s.coins }, now = Date.now();
    // priceT is on the server's clock, lt on this browser's: the board's own time (ts) says how far apart they are.
    // A kept (older) answer makes the server look behind, which only ever keeps the streamed figure: the safe side.
    const skew = d.ts && d.ts > 0 ? d.ts - now : 0;
    const take = (list: Coin[]) => list.map((c) => {
      const prev = s.coins[c.mint], next = withBorn({ ...prev, ...c }, prev);
      if (prev?.lt && now - prev.lt < FRESH_MS) for (const k of STREAMED) (next as any)[k] = prev[k];
      // A price never goes back in time: the market cap a trade set on screen stays unless the board's reading
      // is newer than that trade (the board's figure can be minutes old; swapping it in and then flipping back
      // on the next trade read as the price jumping around).
      else if (prev?.lt && prev.mcap && !((c as any).priceT - skew > prev.lt)) { next.mcap = prev.mcap; next.side = prev.side; }
      coins[c.mint] = next;
      return c.mint;
    });
    const fresh = { new: take(d.newPairs), running: take(d.running), stretch: take(d.stretch), migrated: take(d.migrated) };
    const all = new Set([...fresh.running, ...fresh.stretch, ...fresh.migrated]);
    const cols = !s.loaded ? fresh : {
      new: settle("new", s.cols.new, fresh.new, now, all), running: settle("running", s.cols.running, fresh.running, now, all),
      stretch: settle("stretch", s.cols.stretch, fresh.stretch, now, all), migrated: settle("migrated", s.cols.migrated, fresh.migrated, now, all),
    };
    // Running keeps the server's hottest-first order: the ticker tape (shell/Rail.tsx) shows its head as "moving now".
    for (const [col] of COLS) if (col !== "running") cols[col] = col === "stretch" ? byVolume(cols[col], coins) : newestFirst(cols[col], coins);
    if (missingSince.size > 2000) missingSince.clear();
    // Forget coins no column shows any more, so the map does not grow all day.
    const shown = new Set([...cols.new, ...cols.running, ...cols.stretch, ...cols.migrated]);
    for (const m in coins) if (!shown.has(m)) delete coins[m];
    return { coins, cols, live: d.live, loaded: true };
  });
}

// One trade batch from the stream: [mint, mcap, buys, sells, vol, traders, progress, side, chg, liq, holders, top10, dev, devSold, snipers, bundle]
type LiveRow = [string, number, number, number, number, number, number, "b" | "s" | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];

// A coin the stream just showed bonding belongs in another column: the board is read again within a second or
// two (at most every 4 s), instead of waiting out the 12 s poll with the coin sitting in Final stretch.
let refreshAt = 0, refreshTimer: number | undefined;
function refreshSoon() {
  if (refreshTimer) return;
  const wait = Math.max(1200, 4000 - (Date.now() - refreshAt));
  refreshTimer = window.setTimeout(() => { refreshTimer = undefined; refreshAt = Date.now(); loadPulse().catch(() => {}); }, wait);
}

function applyLive(u: LiveRow[]) {
  let bonded = false;
  usePulse.setState((s) => {
    // Copied only when a coin on the board actually changes: a batch of coins nobody is showing leaves the
    // store as it was, so no column re-filters.
    let coins: typeof s.coins | null = null;
    let b = 0, n = 0;
    for (const [mint, mcap, buys, sells, vol, traders, prog, side, chg, liq, h, t10, dev, ds, sn, bd, fees] of u) {
      const c = (coins || s.coins)[mint];
      if (side) { n++; if (side === "b") b++; }
      if (!c) continue;
      if (prog >= 0.995 && !c.graduated && (c.progress ?? 0) < 0.995) bonded = true;
      coins ??= { ...s.coins };
      const hl = { ...c.hl };
      if (h != null) hl.h = h; if (t10 != null) hl.t10 = t10; if (dev != null) hl.dev = dev;
      if (ds != null) hl.ds = ds; if (sn != null) hl.sn = sn; if (bd != null) hl.bd = bd;
      // A bonded coin's row arrives only while the chain feed reads its pool, so its figures replace DexScreener's too.
      // Fees paid ride along (server.js live rows): a column filtering on them re-decides with this trade.
      coins[mint] = { ...c, mcap, buys, sells, liveVol: vol, vol: c.graduated && !(vol > 0) ? c.vol : vol, liq: liq ?? c.liq, traders, progress: prog, side, chg1m: chg ?? c.chg1m, hl, live: true, lt: Date.now(), state: c.state === "faded" ? "tracked" : c.state, ...(fees != null ? { fees } : {}) };
    }
    const pressure = n ? s.pressure * 0.8 + ((2 * b) / n - 1) * 0.2 : s.pressure;
    return coins ? { coins, pressure } : pressure === s.pressure ? s : { pressure };
  });
  if (bonded) refreshSoon();
  const st = usePulse.getState().cols.stretch;
  if (st.length && u.some(([m]) => st.includes(m))) rerankSoon();
}

function applyMig(u: [string, number][]) {
  usePulse.setState((s) => {
    // `px` carries every coin traded across the market; most are not on the board. Only those that are and
    // whose market cap moved make a new store.
    let coins: typeof s.coins | null = null;
    for (const [mint, mcap] of u) {
      const c = (coins || s.coins)[mint];
      if (!c || c.mcap === mcap) continue;
      coins ??= { ...s.coins };
      coins[mint] = { ...c, mcap, side: c.mcap ? (mcap > c.mcap ? "b" : mcap < c.mcap ? "s" : c.side) : c.side, live: true, lt: Date.now() };
    }
    return coins ? { coins } : s;
  });
}

function applyLaunch(l: Coin & { mcapSol?: number; solUsd?: number }) {
  usePulse.setState((s) => {
    if (s.coins[l.mint]) return s;
    const coin: Coin = { ...l, age: 0, born: Date.now(), state: "watching", startMcapSol: l.mcapSol };
    const coins = { ...s.coins, [l.mint]: coin };
    return { coins, cols: { ...s.cols, new: newestFirst([l.mint, ...s.cols.new], coins) }, live: l.solUsd ? { ...s.live, solUsd: l.solUsd } : s.live };
  });
}

// The stream sends several trade batches a second. Each one used to be its own store update (and its own render
// of every column); now they are queued and applied together once per animation frame.
let queue: { live: LiveRow[]; mig: [string, number][]; fees: [string, number][] } = { live: [], mig: [], fees: [] }, flushing = 0;
function flush() {
  flushing = 0;
  const q = queue;
  queue = { live: [], mig: [], fees: [] };
  // A replayed coin's live market cap (lib/livepx.ts) is the replay's (lib/replay.ts), not the stream's.
  if (q.live.length) { applyLive(q.live); setPx(q.live.filter((r) => !replayed(r[0])).map((r) => [r[0], r[1]]), true); }
  if (q.mig.length) { applyMig(q.mig); setPx(q.mig.filter((r) => !replayed(r[0]))); }
  if (q.fees.length) applyFees(q.fees);
}

// Fees paid, the moment the radar's block follower counts them (server.js "fees"): only a coin on the board whose
// figure grew makes a new store, so the columns re-decide their fee floors at once and nothing else re-renders.
function applyFees(u: [string, number][]) {
  usePulse.setState((s) => {
    let coins: typeof s.coins | null = null;
    for (const [mint, fees] of u) {
      const c = (coins || s.coins)[mint];
      if (!c || !(fees > (c.fees ?? 0))) continue;
      coins ??= { ...s.coins };
      coins[mint] = { ...c, fees };
    }
    return coins ? { coins } : s;
  });
}
const later = () => { if (!flushing) flushing = document.hidden ? window.setTimeout(flush, 250) : requestAnimationFrame(flush); };

// Every trade on a coin whose chart is open (the server sends them for coins whose candles were just asked
// for): [mint, ms, mcUsd, volUsd, buy]. The chart and the coin header follow them trade by trade.
export type CoinTrade = [mint: string, t: number, mc: number, vol: number, buy: 0 | 1];
const tradeFns = new Map<string, Set<(x: CoinTrade) => void>>();
// A coin being replayed (lib/replay.ts): the live stream's trades, prices and holder figures for it are left out,
// and the replay hands its own trades to the same listeners instead.
let replayed: (mint: string) => boolean = () => false;
export const setReplayHooks = (fn: (mint: string) => boolean) => { replayed = fn; metricReplayGuard(fn); };
export const emitCoinTrade = (x: CoinTrade) => tradeFns.get(x[0])?.forEach((fn) => fn(x));
export const emitCoinRows = (mint: string, rows: CoinRow[]) => rowFns.get(mint)?.forEach((fn) => fn(rows));
// A market cap from another live source (a Gecko chart's price, a Fomo bar) handed to the same listeners, so the
// coin header follows whichever chart is open.
export function pushCoinMc(mint: string, mc: number) { if (mc > 0 && !replayed(mint)) tradeFns.get(mint)?.forEach((fn) => fn([mint, Date.now(), mc, 0, 1])); }
// `stream` false: only what is pushed here (a Gecko chart's price, pushCoinMc) is wanted, not the coin's own fast
// trade stream, which holds a per-coin chain subscription on the server (Helius credits) for as long as it is open.
// A coin a day old or more is read from its Gecko chart only (pages/coin/Chart.tsx, Header.tsx).
const streaming = new Map<string, number>();
export function onCoinTrade(mint: string, fn: (x: CoinTrade) => void, stream = true) {
  let set = tradeFns.get(mint);
  if (!set) tradeFns.set(mint, (set = new Set()));
  set.add(fn);
  if (stream) { const n = (streaming.get(mint) || 0) + 1; streaming.set(mint, n); if (n === 1) openFast(mint); }
  return () => {
    set!.delete(fn);
    if (stream) { const n = (streaming.get(mint) || 1) - 1; if (n <= 0) { streaming.delete(mint); closeFast(mint); } else streaming.set(mint, n); }
    if (!set!.size) tradeFns.delete(mint);
  };
}
// An open chart's price also comes on a stream of its own (/api/fast/stream, the radar's fast lane: a thread that
// does nothing else), so it moves even while the radar's main stream is held up. While that stream is delivering,
// the main stream's copies of the same prices (the ones that carry a slot) arrive later and are dropped, so the
// chart never steps back to an older price.
const fast = new Map<string, { es: EventSource; last: number }>();
function openFast(mint: string) {
  if (typeof EventSource === "undefined") return;
  const es = new EventSource(streamUrl(`api/fast/stream?mint=${mint}`), streamInit()), f = { es, last: 0 };
  let opened = false;
  es.onopen = () => { opened = true; };
  fast.set(mint, f);
  es.addEventListener("trade", (e) => {
    if (document.hidden) return;
    f.last = Date.now();
    for (const x of JSON.parse((e as MessageEvent).data).u) if (!replayed(x[0])) tradeFns.get(x[0])?.forEach((fn) => fn(x));
  });
  // Not there (an older radar, or the lane is down): the main stream carries everything, as before.
  es.onerror = () => { if (fast.get(mint) === f && !opened && streamFailed()) { es.close(); return openFast(mint); } if (es.readyState === EventSource.CLOSED) window.setTimeout(() => { if (fast.get(mint) === f && tradeFns.has(mint)) { es.close(); openFast(mint); } }, 5000); };
}
function closeFast(mint: string) { fast.get(mint)?.es.close(); fast.delete(mint); }
// A coin's market cap from its latest trade (null until one comes in while the page is open), once a frame.
export function useTradeMc(mint: string, stream = true) {
  const [mc, setMc] = useState<{ mint: string; mc: number } | null>(null);
  useEffect(() => {
    let raf = 0, v = 0;
    const un = onCoinTrade(mint, (x) => { v = x[2]; if (!raf) raf = requestAnimationFrame(() => { raf = 0; setMc({ mint, mc: v }); }); }, stream);
    return () => { un(); cancelAnimationFrame(raf); };
  }, [mint, stream]);
  return mc?.mint === mint ? mc.mc : null;
}
function applyTrades(u: (CoinTrade | [...CoinTrade, number | null])[]) {
  for (const x of u) {
    if (replayed(x[0]) || (x[5] != null && Date.now() - (fast.get(x[0])?.last || 0) < 5000)) continue;
    tradeFns.get(x[0])?.forEach((fn) => fn(x as CoinTrade));
  }
}

// An open coin's trade-list rows, each the moment the radar reads it from the chain (`ctrade`): the same row
// /api/coin/<mint>/trades gives (wallet, size, market cap, tags, tx), plus the coin's mint.
export type CoinRow = Trade & { mint: string };
const rowFns = new Map<string, Set<(rows: CoinRow[]) => void>>();
export function onCoinRows(mint: string, fn: (rows: CoinRow[]) => void) {
  let set = rowFns.get(mint);
  if (!set) rowFns.set(mint, (set = new Set()));
  set.add(fn);
  return () => { set!.delete(fn); if (!set!.size) rowFns.delete(mint); };
}
function applyRows(u: CoinRow[]) {
  const by = new Map<string, CoinRow[]>();
  for (const x of u) if (rowFns.has(x.mint) && !replayed(x.mint)) (by.get(x.mint) || by.set(x.mint, []).get(x.mint)!).push(x);
  for (const [m, rows] of by) rowFns.get(m)?.forEach((fn) => fn(rows));
}

// A bar of an open Fomo-mode chart the moment Fomo's live feed brings it (`fbar`, server/fomochart.js): the
// chart draws it at once, as fomo.family does, and its polls become a slow check.
export interface FomoBar { mint: string; res: string; bar: [number, number, number, number, number, number]; supply: number | null }
const fbarFns = new Map<string, Set<(b: FomoBar) => void>>();
export function onFomoBar(mint: string, res: string, fn: (b: FomoBar) => void) {
  const k = `${mint}:${res}`;
  let set = fbarFns.get(k);
  if (!set) fbarFns.set(k, (set = new Set()));
  set.add(fn);
  return () => { set!.delete(fn); if (!set!.size) fbarFns.delete(k); };
}
// An open coin's holder figures each time the chain changes them (`cholders`), at most 4 times a second.
export interface LiveHolders { mint: string; holders: number | null; top10: number | null; devPct: number | null; source: string | null; t: number }
const holderFns = new Map<string, Set<(h: LiveHolders) => void>>();
export function useCoinHolders(mint: string) {
  const [h, setH] = useState<LiveHolders | null>(null);
  useEffect(() => {
    let set = holderFns.get(mint);
    if (!set) holderFns.set(mint, (set = new Set()));
    const fn = (x: LiveHolders) => setH(x);
    set.add(fn);
    return () => { set!.delete(fn); if (!set!.size) holderFns.delete(mint); };
  }, [mint]);
  return h?.mint === mint ? h : null;
}

// One stream for the whole app. Returns a stop function.
export function startPulse() {
  let stopped = false, es: EventSource | null = null, lastEvent = 0, retry = 0;
  // The radar restarts now and then. A stream that ended is opened again, and one that has gone quiet
  // (the radar sends trades several times a second) is treated as ended.
  const open = () => {
    if (stopped) return;
    es?.close();
    const s = (es = new EventSource(streamUrl(`api/stream?session=${metricSession}`), streamInit()));
    let opened = false;
    s.onopen = () => { opened = true; };
    const on = (ev: string, fn?: (d: any) => void) => s.addEventListener(ev, (e) => {
      lastEvent = Date.now();
      if (!usePulse.getState().connected) usePulse.setState({ connected: true });
      if (fn && !document.hidden) fn(JSON.parse((e as MessageEvent).data));
    });
    on("hello"); on("tick");
    on("live", (d) => { for (const r of d.u) queue.live.push(r); later(); });
    on("mig", (d) => { for (const r of d.u) queue.mig.push(r); later(); });
    on("fees", (d) => { for (const r of d.u) queue.fees.push(r); later(); });
    // Every coin that traded in the last 100 ms, curve or pool: the live figure everywhere a market cap shows.
    on("px", (d) => { for (const r of d.u) queue.mig.push(r); later(); });
    on('metrics', (d) => receiveMetrics(d, replayed));
    on("trade", (d) => applyTrades(d.u));
    on("ctrade", (d) => applyRows(d.u));
    on("cholders", (d) => { if (!replayed(d.mint)) holderFns.get(d.mint)?.forEach((fn) => fn(d)); });
    on("fbar", (d) => fbarFns.get(`${d.mint}:${d.res}`)?.forEach((fn) => fn(d)));
    on("launch", applyLaunch);
    on("pic", (d) => picReady(d.mint, d.data));   // the radar just got this coin's logo (usually with the picture itself)
    s.onerror = () => {
      if (es === s && !opened && streamFailed()) return open();
      usePulse.setState({ connected: false });
      if (s.readyState === EventSource.CLOSED && es === s) { clearTimeout(retry); retry = window.setTimeout(open, 2000); }
    };
  };
  open();
  // A tab left in the background stops taking the stream after a minute (everything on it was being dropped
  // anyway, see `on` above); on coming back the stream opens again and the board is read once, at once.
  let parked = false, parkTimer = 0;
  const onShow = () => {
    clearTimeout(parkTimer);
    if (document.hidden) {
      parkTimer = window.setTimeout(() => { if (!document.hidden || stopped) return; parked = true; clearTimeout(retry); const s = es; es = null; s?.close(); usePulse.setState({ connected: false }); }, 60_000);
    } else if (parked && !stopped) {
      parked = false; lastEvent = 0;
      open();
      loadPulse().catch(() => {});
    }
  };
  document.addEventListener("visibilitychange", onShow);
  const watchdog = setInterval(() => {
    if (parked || document.hidden || !lastEvent || Date.now() - lastEvent < 10_000) return;
    lastEvent = Date.now();
    usePulse.setState({ connected: false });
    open();
  }, 3000);
  // The whole board again (lib/api.ts "pulse": ~80 KB compressed, 340 KB of rows) is what moves coins between the
  // columns and drops the ones that faded. With the stream delivering, every price, trade count and new launch is
  // already arriving on it, so the board is read every 15 s (every minute off the Pulse page); without the stream it is the only source, every 2 s.
  // (Measured 2026-10-06 on a slow home line: at every 4 s the board took 3-8 s to download and every coin logo
  // queued behind it for 10-17 s.)
  const poll = async () => {
    if (stopped) return;
    if (!document.hidden && Date.now() - boardAt >= 5000) {
      const ok = await loadPulse().then(() => true, () => false);
      const s = usePulse.getState(), polling = ok && !s.connected;
      if (s.polling !== polling) usePulse.setState({ polling });
    }
    // Off the Pulse page the board only feeds the ticker and the status bar: once a minute is plenty.
    const onPulse = /^#\/?(pulse)?$/.test(location.hash || "#/");
    setTimeout(poll, usePulse.getState().connected ? (onPulse ? 15_000 : 60_000) : 2000);
  };
  poll();
  // The board is kept for the next visit: when the page is left (a refresh included) and every 30 s meanwhile.
  const onHide = () => { if (document.visibilityState === "hidden") saveSnapshot(); };
  window.addEventListener("pagehide", saveSnapshot);
  document.addEventListener("visibilitychange", onHide);
  const keep = setInterval(saveSnapshot, 30_000);
  return () => { stopped = true; clearInterval(watchdog); clearInterval(keep); clearTimeout(retry); clearTimeout(parkTimer); document.removeEventListener("visibilitychange", onShow); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", saveSnapshot); es?.close(); };
}
