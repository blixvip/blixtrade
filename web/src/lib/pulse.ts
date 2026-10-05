import { create } from "zustand";
import { api } from "./api";
import { picReady } from "./pics";

export type ColKey = "new" | "running" | "stretch" | "migrated";
export const COLS: [ColKey, string][] = [["new", "New pairs"], ["running", "Running now"], ["stretch", "Final stretch"], ["migrated", "Migrated"]];

export interface Coin {
  mint: string; symbol?: string; name?: string; age?: number; born: number;
  mcap?: number | null; startMcapSol?: number | null; vol?: number | null; liveVol?: number | null;
  chg1m?: number | null; chg5?: number | null; buys?: number; sells?: number; traders?: number | null;
  holders?: number | null; top10?: number | null; dev?: number | null; devSol?: number | null; devCount?: number;
  progress?: number | null; graduated?: boolean; dex?: string | null; pool?: string | null; mayhem?: boolean;
  x?: string | null; web?: string | null; tg?: string | null; desc?: string | null;
  state?: string; live?: boolean; lt?: number; side?: "b" | "s" | null; tr?: number | null;
  hl?: { h?: number | null; t10?: number | null; dev?: number | null; ds?: string | number | null; sn?: number; snN?: number; bd?: number; bdN?: number } | null;
  ai?: { status?: string; grade?: string | null; score?: number | null; tier?: string | null; verdict?: string | null; model?: string | null; rated?: boolean; action?: string | null; pwin?: number | null; tag?: string | null; t?: number | null } | null;
  tri?: { label: string; score: number; why?: string; src?: string } | null;
  warn?: { kind: "stale" | "emptied" | "odd-curve"; text: string } | null;
  win?: { trades: number; traders: number; netSol: number; chg?: number | null } | null;
}

interface Live { launchesPerMin?: number; tradesPerSec?: number; solUsd?: number; queued?: number; running?: number; ratedHour?: number; feed?: string; ai?: { fast?: string; deep?: string } }
interface PulseResponse { newPairs: Coin[]; stretch: Coin[]; migrated: Coin[]; running: Coin[]; live: Live }

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
}

export const usePulse = create<PulseState>(() => ({
  coins: {}, cols: { new: [], running: [], stretch: [], migrated: [] }, live: {}, pressure: 0, connected: false, polling: false, loaded: false,
}));

const withBorn = (c: Coin, prev?: Coin): Coin => ({ ...c, born: prev?.born ?? Date.now() - (c.age || 0) });

// The figures the trade stream keeps current. A poll is older than the stream, so for a coin the stream
// touched in the last few seconds these stay as they are instead of jumping back and flashing.
const STREAMED = ["mcap", "buys", "sells", "liveVol", "vol", "traders", "progress", "side", "chg1m", "hl", "live", "state"] as const;
const FRESH_MS = 10_000;

// A poll never reshuffles a column: rows already showing keep their place, new ones come in at the top,
// and only coins the radar has dropped for a while leave (one sitting on a column's edge flickers in and
// out between polls; without the grace it would jump to the top each time). New pairs also keeps launches
// the poll has not listed yet.
const GRACE_MS = 30_000;
const missingSince = new Map<string, number>();
function settle(col: ColKey, prev: string[], next: string[], now: number, moved: Set<string>, cap = 160) {
  const had = new Set(prev), inNext = new Set(next);
  const stays = (m: string) => {
    const k = `${col}:${m}`;
    if (col === "new" || inNext.has(m)) { missingSince.delete(k); return true; }
    if (moved.has(m)) { missingSince.delete(k); return false; }   // it went to another column: no grace
    const t = missingSince.get(k) ?? missingSince.set(k, now).get(k)!;
    return now - t < GRACE_MS;
  };
  return [...next.filter((m) => !had.has(m)), ...prev.filter(stays)].slice(0, cap);
}

export async function loadPulse() {
  const d = await api<PulseResponse>("pulse");
  usePulse.setState((s) => {
    const coins: Record<string, Coin> = { ...s.coins }, now = Date.now();
    const take = (list: Coin[]) => list.map((c) => {
      const prev = s.coins[c.mint], next = withBorn({ ...prev, ...c }, prev);
      if (prev?.lt && now - prev.lt < FRESH_MS) for (const k of STREAMED) (next as any)[k] = prev[k];
      coins[c.mint] = next;
      return c.mint;
    });
    const fresh = { new: take(d.newPairs), running: take(d.running), stretch: take(d.stretch), migrated: take(d.migrated) };
    const all = new Set([...fresh.running, ...fresh.stretch, ...fresh.migrated]);
    const cols = !s.loaded ? fresh : {
      new: settle("new", s.cols.new, fresh.new, now, all), running: settle("running", s.cols.running, fresh.running, now, all),
      stretch: settle("stretch", s.cols.stretch, fresh.stretch, now, all), migrated: settle("migrated", s.cols.migrated, fresh.migrated, now, all),
    };
    if (missingSince.size > 2000) missingSince.clear();
    // Forget coins no column shows any more, so the map does not grow all day.
    const shown = new Set([...cols.new, ...cols.running, ...cols.stretch, ...cols.migrated]);
    for (const m in coins) if (!shown.has(m)) delete coins[m];
    return { coins, cols, live: d.live, loaded: true };
  });
}

// One trade batch from the stream: [mint, mcap, buys, sells, vol, traders, progress, side, chg, holders, top10, dev, devSold, snipers, bundle]
type LiveRow = [string, number, number, number, number, number, number, "b" | "s" | null, number | null, number | null, number | null, number | null, number | null, number | null, number | null];

function applyLive(u: LiveRow[]) {
  usePulse.setState((s) => {
    const coins = { ...s.coins };
    let b = 0, n = 0;
    for (const [mint, mcap, buys, sells, vol, traders, prog, side, chg, h, t10, dev, ds, sn, bd] of u) {
      const c = coins[mint];
      if (side) { n++; if (side === "b") b++; }
      if (!c) continue;
      const hl = { ...c.hl };
      if (h != null) hl.h = h; if (t10 != null) hl.t10 = t10; if (dev != null) hl.dev = dev;
      if (ds != null) hl.ds = ds; if (sn != null) hl.sn = sn; if (bd != null) hl.bd = bd;
      coins[mint] = { ...c, mcap, buys, sells, liveVol: vol, vol: c.graduated ? c.vol : vol, traders, progress: prog, side, chg1m: chg ?? c.chg1m, hl, live: true, lt: Date.now(), state: c.state === "faded" ? "tracked" : c.state };
    }
    const pressure = n ? s.pressure * 0.8 + ((2 * b) / n - 1) * 0.2 : s.pressure;
    return { coins, pressure };
  });
}

function applyMig(u: [string, number][]) {
  usePulse.setState((s) => {
    const coins = { ...s.coins };
    for (const [mint, mcap] of u) { const c = coins[mint]; if (c) coins[mint] = { ...c, mcap, side: c.mcap ? (mcap > c.mcap ? "b" : mcap < c.mcap ? "s" : c.side) : c.side, live: true, lt: Date.now() }; }
    return { coins };
  });
}

function applyLaunch(l: Coin & { mcapSol?: number; solUsd?: number }) {
  usePulse.setState((s) => {
    if (s.coins[l.mint]) return s;
    const coin: Coin = { ...l, age: 0, born: Date.now(), state: "watching", startMcapSol: l.mcapSol };
    return { coins: { ...s.coins, [l.mint]: coin }, cols: { ...s.cols, new: [l.mint, ...s.cols.new].slice(0, 160) }, live: l.solUsd ? { ...s.live, solUsd: l.solUsd } : s.live };
  });
}

// The stream sends several trade batches a second. Each one used to be its own store update (and its own render
// of every column); now they are queued and applied together once per animation frame.
let queue: { live: LiveRow[]; mig: [string, number][] } = { live: [], mig: [] }, flushing = 0;
function flush() {
  flushing = 0;
  const q = queue;
  queue = { live: [], mig: [] };
  if (q.live.length) applyLive(q.live);
  if (q.mig.length) applyMig(q.mig);
}
const later = () => { if (!flushing) flushing = document.hidden ? window.setTimeout(flush, 250) : requestAnimationFrame(flush); };

// One stream for the whole app. Returns a stop function.
export function startPulse() {
  let stopped = false, es: EventSource | null = null, lastEvent = 0, retry = 0;
  // The radar restarts now and then. A stream that ended is opened again, and one that has gone quiet
  // (the radar sends trades several times a second) is treated as ended.
  const open = () => {
    if (stopped) return;
    es?.close();
    const s = (es = new EventSource("/api/stream"));
    const on = (ev: string, fn?: (d: any) => void) => s.addEventListener(ev, (e) => {
      lastEvent = Date.now();
      if (!usePulse.getState().connected) usePulse.setState({ connected: true });
      if (fn && !document.hidden) fn(JSON.parse((e as MessageEvent).data));
    });
    on("hello"); on("tick");
    on("live", (d) => { for (const r of d.u) queue.live.push(r); later(); });
    on("mig", (d) => { for (const r of d.u) queue.mig.push(r); later(); });
    on("launch", applyLaunch);
    on("pic", (d) => picReady(d.mint));   // the radar just got this coin's logo
    s.onerror = () => {
      usePulse.setState({ connected: false });
      if (s.readyState === EventSource.CLOSED && es === s) { clearTimeout(retry); retry = window.setTimeout(open, 2000); }
    };
  };
  open();
  const watchdog = setInterval(() => {
    if (document.hidden || !lastEvent || Date.now() - lastEvent < 10_000) return;
    lastEvent = Date.now();
    usePulse.setState({ connected: false });
    open();
  }, 3000);
  const poll = async () => {
    if (stopped) return;
    if (!document.hidden) {
      const ok = await loadPulse().then(() => true, () => false);
      const s = usePulse.getState(), polling = ok && !s.connected;
      if (s.polling !== polling) usePulse.setState({ polling });
    }
    setTimeout(poll, usePulse.getState().connected ? 4000 : 2000);
  };
  poll();
  return () => { stopped = true; clearInterval(watchdog); clearTimeout(retry); es?.close(); };
}
