// Data for the coin page (#/coin/<mint>): the radar's stored detail (/api/token), the live ledger
// (/api/coin), recent trades (/api/coin/<mint>/trades), candles and quotes. Plain polling hooks: each
// endpoint is re-read on its own clock, paused while the tab is hidden, and keeps the last good answer
// through a failed read.
import { useEffect, useState } from "react";
import { apiAged, earlyData } from "./api";
import { pageCode } from "./pages";
import { preloadFaces } from "./thumb";
import { store } from "./utils";

export type Tag = "dev" | "sniper" | "bundle" | null;
export interface WalletTags { tag: Tag; top10: boolean; label: string | null; followed: boolean; fomo: boolean }
export interface Holder extends WalletTags {
  wallet: string; tokens: number | null; pct: number | null; maxPct: number;
  boughtSol: number | null; soldSol: number | null; valueSol: number | null; pnlSol: number | null; realizedSol: number | null;
  boughtUsd: number | null; soldUsd: number | null; valueUsd: number | null; pnlUsd: number | null;
  pnlTokens?: number | null; pnlBasis?: "usd" | "sol";
  avgBuyMc: number | null; avgSellMc: number | null; trades: number; first: number;
  status: "holding" | "sold some" | "sold all" | "outside top 100"; slot?: number | null; afterFirstMs?: number;
}
export interface Group { n: number; pct: number; maxPct: number; sold: number }
export interface DevCoin { mint: string; name?: string | null; symbol?: string | null; t?: number | null; mcap?: number | null; peak?: number | null; status?: string | null; graduated?: boolean; progress?: number }
export type HolderFace = { src: "fomo" | "pump"; name: string; pic: string | null; followers: number; how?: "wallet" | "amount"; x?: string | null };

export interface CoinData {
  mint: string; symbol: string | null; name: string | null; solUsd: number | null; live: boolean; onCurve: boolean;
  mcUsd: number | null; priceUsd: number | null; athUsd: number | null; progress: number | null; supply: number;
  // Curve full, pool not trading yet: pump.fun is migrating it and every trade fails meanwhile (server livetrades.js).
  migrating?: { since: number } | null;
  priceAgeMs?: number | null;   // how old mcUsd is (0 = priced this second by the Pulse)
  m5: { source: "live" | "tracked"; buys: number; sells: number; buyUsd: number | null; sellUsd: number | null; volUsd: number | null; netUsd: number | null; traders: number | null; calculatedAt?: number; complete?: boolean } | null;
  holders: { count: number; wallets: number; trades: number; since: number | null; last: number; genesis: boolean; partial: boolean; frozen: boolean; top10: number; list: Holder[]; source?: "jupiter" | "ledger" | "chain" | "rugcheck" } | null;
  // Tabs filled from the Jupiter data API when the ledger cannot cover the coin (bonded, or met after launch).
  jupiter?: { tabs: ("holders" | "traders" | "early")[]; tradersWindow: { trades: number; since: number | null } | null } | null;
  // The Jupiter audit: authorities, top holders, bots, bundles, the dev's launches.
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number; botHoldersPercentage?: number; botHoldersCount?: number; devMints?: number; devMigrations?: number;
    bundlerStats?: { totalBundles?: number; holdingPct?: number; holdingPctATH?: number }; holders?: number | null; launchpad?: string | null; organic?: string | null } | null;
  traders: Holder[]; early: Holder[];
  // Who holders are, by wallet: a Fomo trader placed on it, else its pump.fun profile (server bubblemap.js holderFaces).
  faces?: Record<string, HolderFace>;
  dev: { wallet: string; pct: number | null; maxPct?: number; boughtSol?: number; soldSol?: number; sold?: "all" | "part" | null; coins: { count: number; others: number; list: DevCoin[]; window: string } } | null;
  // Current figures only: the live ledger on the curve, RugCheck after bonding (checked = when it read it); null = unknown now.
  info: { holders: number | null; top10: number | null; devPct: number | null; snipers: Group | null; bundle: Group | null; insiders: number | null; lpLocked: number | null; safety: number | null; traders: number | null; source: string | null; checked: number | null };
  tradesSince: number | null;
  created?: number | null;   // the coin's real creation time (Jupiter), when known
  // Tagged trades in the server's ring (dev, snipers, bundles, followed wallets), for the chart's icons.
  marks?: { t: number; side: "buy" | "sell"; sol: number; mcUsd: number | null; wallet: string; tag: Tag; followed: boolean; label: string | null }[];
  // DexScreener orders: paid profile ("DEX paid"), ads, takeovers, boosts. null until DexScreener answers.
  paid?: { orders: { type: string; status: string; t: number }[]; boosts: { amount: number | null; t: number }[] } | null;
}
export interface Trade extends WalletTags { t: number; side: "buy" | "sell"; sol: number | null; usd: number | null; tokens: number | null; mcUsd: number | null; wallet: string | null; tx?: string | null }
export interface Trades { mint: string; source: "live" | "pool" | "none"; trades: Trade[]; note?: string; since?: number | null }
export interface Risk { name: string; value?: string; description?: string; level?: string }
export interface Paper {
  id: number; mint: string; symbol?: string; t: number; sol: number; mcap0?: number | null; status: "open" | "closed";
  exit_sol?: number | null; exit_mcap?: number | null; exit_t?: number | null; exit_why?: string | null; valueSol?: number | null; mcapNow?: number | null; mult?: number | null;
  tokens?: number | null;   // quoted rows: tokens bought (an open row) or sold (a closed one)
}
export interface TokenDetail {
  token: {
    mint: string; symbol?: string | null; name?: string | null; description?: string | null; image?: string | null; first_seen?: number | null; pair?: string | null; dex?: string | null;
    pair_created?: number | null; price?: number | null; mcap?: number | null; liquidity?: number | null; vol_m5?: number | null; chg_h1?: number | null; chg_h24?: number | null; asset_class?: string | null;
    links?: { type?: string; url?: string }[]; boosts?: number | null; header?: string | null; safety?: { risks?: Risk[]; lpLockedPct?: number | null; totalHolders?: number | null; top10?: number | null; insiderPct?: number | null; devPct?: number | null } | null;
    safety_score?: number | null; safety_checked?: number | null; status?: string | null; graduated?: boolean | number | null; peak_mcap?: number | null; creator?: string | null; themes?: string[] | null;
    fresh?: { dead?: boolean; quarantine?: string | null; illiquid?: boolean; exitWhy?: string | null; stale?: boolean; ageMs?: number | null; source?: string | null } | null;
  };
  untracked?: boolean;
  verdict?: { ok: boolean; unknown?: boolean; reasons?: string[] } | null;
  live?: { mcap?: number; ath?: number; buys?: number; sells?: number; traders?: number; progress?: number; chg1m?: number | null } | null;
  triage?: { label: string; score: number; why?: string } | null;
  signals?: { kind: string; title: string; detail?: string; t: number; safe?: number }[];
  research?: { status?: string; paused?: boolean; grade?: string | null; verdict?: string | null; model?: string | null; t?: number | null; report?: { grade?: string; verdict?: string; why?: string; thesis?: string; risks?: string[]; trade?: { action?: string; pWin?: number | null; why?: string } | null } | null } | null;
  paper?: Paper[];
  progress?: number | null;
}
export interface Quote { outTokens?: number; outSol?: number; usdcIn?: number | null; usdcOut?: number | null; impactPct?: number | null; minOut?: number; route?: string[]; avgMcapUsd?: number | null; spotMcapUsd?: number | null; usdIn?: number | null; usdOut?: number | null; feeSol?: number | null; src?: string }

// Re-read `path` every `ms` while it is non-null. A new path starts empty; a refresh keeps what is shown.
// The last good answer for each path, so reopening a view or switching a tab shows it at once while the
// fresh request runs. Keyed by the exact path (one coin's answer never stands in for another's).
const lastAnswer = new Map<string, unknown>(), answeredAt = new Map<string, number>();
const remember = (path: string, data: unknown) => {
  lastAnswer.delete(path); lastAnswer.set(path, data); answeredAt.set(path, performance.now());
  if (lastAnswer.size > 200) { const old = lastAnswer.keys().next().value!; lastAnswer.delete(old); answeredAt.delete(old); }
};
// (Or, on the page's first frame, the answer index.html asked for before the scripts had loaded: lib/api.ts.)
// Only a recent one: an answer from minutes ago drew old figures that then jumped to the new ones on every page
// switch. Pages left recently are kept current in the background (linger below), so theirs is always recent.
const SHOW_MS = 15_000;
const known = <T,>(path: string | null) => {
  if (!path) return null;
  const t = answeredAt.get(path);
  return (t != null && performance.now() - t < SHOW_MS ? (lastAnswer.get(path) as T | undefined) : undefined) ?? earlyData<T>(path) ?? null;
};
// A view's reads keep going for a minute after it closes (every 10 s, inside SHOW_MS; only while the tab is in
// view), so going back to it draws today's figures straight away instead of old ones followed by a jump.
const LINGER_MS = 60_000;
const mounted = new Map<string, number>(), lingering = new Map<string, { until: number; ms: number }>();
const mount = (path: string) => { mounted.set(path, (mounted.get(path) || 0) + 1); lingering.delete(path); };
const unmount = (path: string, ms: number) => {
  const n = (mounted.get(path) || 1) - 1;
  if (n > 0) { mounted.set(path, n); return; }
  mounted.delete(path);
  lingering.set(path, { until: performance.now() + LINGER_MS, ms: Math.max(ms, 10_000) });
  if (lingering.size > 12) lingering.delete(lingering.keys().next().value!);
};
if (typeof window !== "undefined") window.setInterval(() => {
  if (document.hidden) return;
  const now = performance.now();
  for (const [path, l] of lingering) {
    if (now > l.until) { lingering.delete(path); continue; }
    if (!asking.has(path) && now - (answeredAt.get(path) ?? -Infinity) >= l.ms) {
      asking.add(path);
      apiAged(path, undefined, 0, false, 3000).then((r) => remember(path, r.data)).catch(() => {}).finally(() => asking.delete(path));
    }
  }
}, 1000);
// The last answer already in hand for `path`, without asking (the chart's first frame uses the trade list).
export const peek = <T,>(path: string) => known<T>(path);
// Ask for a path ahead of time (a tab the reader is likely to open next); usePoll then starts with it. A kept
// answer will do (the view asks again when it opens); one request per path at a time, and none for an answer
// that came within the last second.
const asking = new Set<string>();
// What the poll cache holds for a path right now (a prefetched or recently polled answer), else null.
export const peekAnswer = <T,>(path: string): T | null => known<T>(path);
export function prefetch<T = unknown>(path: string): Promise<T | null> | undefined {
  if (path === "market" && !matchMedia("(min-width: 768px)").matches) return;
  if (asking.has(path) || performance.now() - (answeredAt.get(path) ?? -Infinity) < 1000) return;
  asking.add(path);
  // kept (_k): the page server's kept answer, if only a few seconds old, at once (server/apicache.js). (It was
  // a minute: the page then opened on minute-old figures.)
  return apiAged<T>(path, undefined, 0, false, 5000).then((r) => { remember(path, r.data); return r.data; }).catch(() => null).finally(() => asking.delete(path));
}
// A page the pointer is resting on a link to is likely the next one opened: get its code, and ask for what it
// read in its first moments the last time it was open (lib/api.ts keeps that list per page, a coin's or trader's
// own address as {m}), so the click draws the page with its data. Once per page per 5 s.
const warmedPage = new Map<string, number>();
export function prefetchPage(route: string, arg = "") {
  const key = `${route}/${arg}`, t = Date.now();
  if (t - (warmedPage.get(key) || 0) < 5000) return;
  warmedPage.set(key, t);
  if (warmedPage.size > 100) warmedPage.delete(warmedPage.keys().next().value!);
  pageCode[route]?.();
  preloadFaces(route);
  for (const raw of store.get<string[]>(`warm:${route || "home"}`, []).slice(0, 16)) {
    if (typeof raw !== "string") continue;
    if (!raw.includes("{m}")) prefetch(raw);
    else if (arg) prefetch(raw.split("{m}").join(arg));
  }
}
// A coin: the same, and its first answers whether or not a coin page has been open before. Once per coin per 10 s.
const warmed = new Map<string, number>();
export function prefetchCoin(mint: string, bornKnown?: number | null) {
  const t = Date.now();
  if (t - (warmed.get(mint) || 0) < 10_000) return;
  warmed.set(mint, t);
  if (warmed.size > 100) warmed.delete(warmed.keys().next().value!);
  prefetchPage("coin", mint);
  // A coin a day old or more opens on the TradingView chart (pages/coin/Chart.tsx): its GeckoTerminal candles start
  // loading now, at the size it will open on, so the page opens with them drawn.
  import("./pulse").then((p) => {
    const born = bornKnown || p.usePulse.getState().coins[mint]?.born || null;
    if (born && Date.now() - born < 24 * 3600e3) return;
    return Promise.all([import("./tvBars"), import("./gecko")]).then(([b, g]) => {
      const v = store.get("coin:tvtf", 0);
      b.warmTvBars(mint, b.TV_TFS.some(([x]) => x === v) ? v : ({ "1m": 60, "5m": 300, "15m": 900 } as Record<string, number>)[g.geckoRes(born)] ?? 60);
    });
  }).catch(() => {});
  prefetch(`token/${mint}`); prefetch(`coin/${mint}`); prefetch(`coin/${mint}/trades?limit=150`); prefetch(`coin/${mint}/people`);
  // The chart's candles: the size last chosen, or 1s and 15s (they make up every coarser size until its own
  // answer comes), straight into the chart's own cache.
  const tf = store.get("coin:tf", 0);
  import("@/pages/coin/Chart").then((m) => m.warmCandles(mint, tf > 0 ? [tf] : [1, 15])).catch(() => {});
}

// Any link to one of our pages (the rail, a tab, a coin in Pulse, Discover, Feed, search, the ticker...): resting
// on it a moment, or pressing it, warms that page, so the click opens it already drawn.
if (typeof document !== "undefined") {
  let timer = 0;
  const target = (e: Event) => (e.target as Element | null)?.closest?.("a[href^='#/']")?.getAttribute("href")?.slice(2).split("?")[0].split("/") || null;
  const warm = (to: string[]) => (to[0] === "coin" && to[1] ? prefetchCoin(to[1]) : prefetchPage(to[0], to[1]));
  document.addEventListener("pointerover", (e) => {
    clearTimeout(timer);
    const to = target(e);
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (document.hidden || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "")) return;
    if (to) timer = window.setTimeout(() => warm(to), to[0] === "coin" ? 120 : 60);
  }, { passive: true });
  document.addEventListener("pointerout", () => clearTimeout(timer), { passive: true });
  document.addEventListener("focusin", (e) => { const to = target(e); if (to) warm(to); });
  document.addEventListener("pointerdown", (e) => { const to = target(e); if (to) warm(to); }, { passive: true, capture: true });
}

// One reader per path, however many views show it (the coin page's tabs and its theses both read the callouts;
// the status bar and the X page both read the X list): one timer and one request, every view handed the answer.
// It reads at the quickest pace any of its views asked for.
type Sub = { ms: number; got: (data: unknown, error: string | null) => void };
interface Reader { subs: Set<Sub>; timer: number; busy: boolean; again: boolean; ctl: AbortController | null; keptAt: number; kept: number; shownOf: number; fails: number; run: () => void }
const readers = new Map<string, Reader>();
const paceOf = (r: Reader) => Math.min(...[...r.subs].map((s) => s.ms));
function reader(path: string): Reader {
  const r: Reader = { subs: new Set(), timer: 0, busy: false, again: false, ctl: null, keptAt: 0, kept: 0, shownOf: -Infinity, fails: 0, run: async () => {
    clearTimeout(r.timer);
    if (r.busy) { r.again = true; return; }
    let wait = paceOf(r);
    if (!document.hidden) {
      r.busy = true;
      const ctl = (r.ctl = new AbortController());
      const t = setTimeout(() => ctl.abort(), 20_000);
      try {
        // keptAt: when a kept answer was last handed over (0 = the last one was the radar's own). shownOf: the
        // moment the answer on screen was the radar's latest.
        const { data, age } = await apiAged(path, { signal: ctl.signal }, r.keptAt ? performance.now() - r.keptAt : 0);
        const now = performance.now();
        // A kept answer (the radar is slow or restarting): its own is a moment away, so ask again shortly, a
        // little later each time it is still not there. One no newer than what is on screen changes nothing
        // and is not drawn again.
        r.keptAt = age > 0 ? now : 0;
        r.kept = age > 0 ? r.kept + 1 : 0;
        r.fails = 0;
        if (age > 0) wait = Math.min(wait, 150 * 2 ** Math.min(r.kept, 6));
        if (now - age > r.shownOf) {
          r.shownOf = now - age;
          remember(path, data);
          for (const s of r.subs) s.got(data, null);
        }
      } catch (e) {
        r.keptAt = 0; r.kept = 0;
        // A read that keeps failing (the page server away): asked again less often, up to every 15 s, until
        // one answers.
        if (!ctl.signal.aborted) { r.fails++; wait = Math.max(wait, Math.min(15_000, wait * 2 ** Math.min(r.fails, 4))); for (const s of r.subs) s.got(undefined, (e as Error).message); }
      } finally { clearTimeout(t); r.busy = false; }
    }
    if (readers.get(path) !== r) return;
    if (r.again) { r.again = false; wait = 0; }
    if (!document.hidden) r.timer = window.setTimeout(r.run, wait);
  } };
  return r;
}
// Back on screen: every reader reads now, not when its timer next comes round.
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => {
  for (const r of readers.values()) {
    clearTimeout(r.timer);
    if (!document.hidden && !r.busy) r.run();
  }
});

// `keep`: while a new path's first answer is on its way, go on returning the last path's (a list whose filter or
// tab changed keeps its rows on screen until the new ones are here, instead of blanking to a loading box).
export function usePoll<T>(path: string | null, ms: number, keep = false) {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null }>(() => ({ path, data: known<T>(path), error: null }));
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const sub: Sub = { ms, got: (data, error) => { if (!alive) return; setState((s) => error == null ? { path, data: data as T, error: null } : { ...s, path, error, data: s.path === path ? s.data : null }); } };
    let r = readers.get(path);
    if (!r) { r = reader(path); readers.set(path, r); mount(path); r.subs.add(sub); r.run(); }
    else {
      const was = paceOf(r);
      r.subs.add(sub);
      // Joining a reader that already has an answer: that answer now, and sooner reads if this view wants them.
      const had = known<T>(path);
      if (had != null) setState({ path, data: had, error: null });
      if (ms < was && !r.busy) { clearTimeout(r.timer); r.timer = window.setTimeout(r.run, ms); }
    }
    return () => {
      alive = false;
      const cur = readers.get(path);
      if (!cur) return;
      cur.subs.delete(sub);
      if (cur.subs.size) return;
      readers.delete(path); cur.ctl?.abort(); clearTimeout(cur.timer); unmount(path, ms);
    };
  }, [path, ms]);
  return { data: state.path === path ? state.data : known<T>(path) ?? (keep && path ? state.data : null), error: state.path === path ? state.error : null, refresh: () => { if (path) readers.get(path)?.run(); } };
}

// ---------- formats (in the classic coin page's style) ----------
// Prices on the chart need more digits than anywhere else, or every label on a quiet coin's axis reads the
// same ("$3.5K" six times). Same steps as trade.js usdP; the coin's header uses it too, so header and chart print the same figure; never negative (the room left for the volume band).
export const usdP = (n: number) => {
  if (n == null || !isFinite(n)) return "—";
  if (n < 0) return "";
  // Trailing zeros go ("$7.100K" reads "$7.1K", "$9.000K" "$9K"): two different labels never become the same.
  const t = (s: string) => s.replace(/(\.\d*?)0+(?=[KMB]?$)/, "$1").replace(/\.(?=[KMB]?$)/, "");
  return n >= 1e9 ? `$${t((n / 1e9).toFixed(3) + "B")}` : n >= 1e6 ? `$${t((n / 1e6).toFixed(3) + "M")}` : n >= 1e5 ? `$${t((n / 1e3).toFixed(1) + "K")}` : n >= 1e4 ? `$${t((n / 1e3).toFixed(2) + "K")}`
    : n >= 1e3 ? `$${t((n / 1e3).toFixed(3) + "K")}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(3)}`;
};
export const usdK = (n: number | null | undefined) => {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n);
  return a >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : `$${a >= 10 ? Math.round(n) : n.toFixed(2)}`;
};
export const usdSigned = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${usdK(Math.abs(n))}`);
// A SOL amount's number; on screen it follows the Solana logomark (SolAmt in pages/coin/parts.tsx).
export const solNum = (n: number, signed = false) => {
  const a = Math.abs(n);
  return `${signed ? (n >= 0 ? "+" : "−") : ""}${a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a >= 1 ? a.toFixed(2) : a >= 0.001 || a === 0 ? a.toFixed(3) : a.toPrecision(2)}`;
};
// The same as plain text, where a logo cannot go (tooltips, toasts).
export const solN = (n: number | null | undefined, signed = false) => (n == null || !isFinite(n) ? "—" : `${solNum(n, signed)} SOL`);
export const tokN = (n: number | null | undefined) =>
  n == null ? "—" : n >= 9.995e8 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));
export const pctN = (n: number | null | undefined, d = 1) => (n == null || !isFinite(n) ? "—" : `${n.toFixed(n < 10 && d ? d : 0)}%`);
export const sinceMs = (ms: number | null | undefined) =>
  ms == null ? "—" : ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s` : ms < 3600_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3600_000)}h`;
// $0.0₄398: zeros after the point shown as a count, like Axiom and GMGN.
export function priceParts(p: number | null | undefined): [string, number | null, string] | null {
  if (!p || !isFinite(p)) return null;
  if (p >= 1) return [`$${p.toFixed(3)}`, null, ""];
  const m = p.toFixed(12).match(/^0\.(0+)(\d{3})/);
  return m && m[1].length >= 4 ? ["$0.0", m[1].length, m[2]] : [`$${p.toPrecision(3)}`, null, ""];
}
