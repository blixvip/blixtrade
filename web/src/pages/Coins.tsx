// Discover (#/coins), laid out like Axiom's: Trending / Surge / New pairs / Bonded lists over a 5m, 1h or
// 24h window, Axiom's filters (protocols, keywords, audits, metrics, socials), hidden coins, and one row per
// coin with its links, figures, audit pills and a quick buy.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePulse, type Coin } from "@/lib/pulse";
import { isDeadCoin, isRug as pulseRug } from "./Pulse";
import { SolanaLogo } from "@/components/brand";
import { eagerAgain, Empty, Loading, Page, Panel, Problem } from "@/components/page";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { Checks, fieldLabel, isSet, Ranges, Text, type Filters, type Range } from "@/components/filterbits";
import { prefetch, usePoll } from "@/lib/coin";
import { useTrade } from "@/lib/mode";
import { warmPics } from "@/lib/pics";
import { useKnown, type Face } from "@/lib/known";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { FomoTab, type FomoKind } from "./discover/fomo";
import { HOT_WINS, HotTab, hotPath, type HotAnswer, type HotWin } from "./discover/hot";
import { noteLive, sparkOrKeep } from "@/components/Spark";
import { DiscoverRow, GRID, withLive, type LiveFigures, type Row, type Tf } from "./discover/parts";
import { freshest, takeSnapshot, takeSparks } from "./discover/fresh";

type Tab = "top" | "held" | "trending" | "hot" | "surge" | "new" | "bonded";
type Section = "audits" | "metrics" | "socials";
const TABS: [Tab, string, string][] = [
  ["top", "Top", "Fomo's trending coins, exactly as fomo.family shows them"], ["trending", "Trending", "Most traded in the window"],
  ["hot", "Hot", "The coins Fomo and pump.fun traders are posting about most, from the Feed"], ["surge", "Surge", "Biggest movers in the window, with real volume"],
  ["new", "New pairs", "Newest pools first"], ["bonded", "Bonded", "Coins that finished their curve, newest first"],
];
const SORT: Record<Tab, Record<Tf, string>> = {
  top: { "5m": "vol5", "1h": "volume", "24h": "vol24" }, held: { "5m": "vol5", "1h": "volume", "24h": "vol24" },
  trending: { "5m": "vol5", "1h": "volume", "24h": "vol24" }, hot: { "5m": "vol5", "1h": "volume", "24h": "vol24" }, surge: { "5m": "chg5", "1h": "change", "24h": "chg24" },
  new: { "5m": "new", "1h": "new", "24h": "new" }, bonded: { "5m": "new", "1h": "new", "24h": "new" },
};
// Filters that follow the window: the key typed in the panel → the key the server knows for each window.
const WINDOWED: Record<string, Record<Tf, string>> = {
  minVol: { "5m": "minVol5", "1h": "minVol", "24h": "minVol24" }, maxVol: { "5m": "maxVol5", "1h": "maxVol", "24h": "maxVol24" },
  minTx: { "5m": "minTx5", "1h": "minTx", "24h": "minTx" }, maxTx: { "5m": "maxTx5", "1h": "maxTx", "24h": "maxTx" },
  minBuys: { "5m": "minBuys5", "1h": "minBuys", "24h": "minBuys" }, minSells: { "5m": "minSells5", "1h": "minSells", "24h": "minSells" },
};
const PROTOCOLS: [string, string][] = [
  ["pumpfun", "Pump"], ["pumpswap", "Pump AMM"], ["meteoradbc", "Meteora DBC"], ["meteora", "Meteora"], ["raydium", "Raydium"],
  ["orca", "Orca"], ["bags", "Bags"], ["fluxbeam", "FluxBeam"], ["other", "Other"],
];
const AUDITS: Range[] = [
  ["Age", "minAge", "maxAge", "min"], ["Top 10 holders", "minTop10", "maxTop10", "%"], ["Dev holding", "minDev", "maxDev", "%"],
  ["Insiders", "minInsider", "maxInsider", "%"], ["Holders", "minHolders", "maxHolders", ""], ["Dev coins launched", null, "maxDevLaunches", ""],
  ["LP locked", "minLp", null, "%"], ["Safety score", "minSafety", "maxSafety", "/100"],
];
const metrics = (tf: Tf): Range[] => [
  ["Market cap", "minMcap", "maxMcap", "$"], ["Liquidity", "minLiq", "maxLiq", "$"], [`Volume ${tf}`, "minVol", "maxVol", "$"],
  [`Txns ${tf === "5m" ? "5m" : "1h"}`, "minTx", "maxTx", ""], [`Buys ${tf === "5m" ? "5m" : "1h"}`, "minBuys", null, ""], [`Sells ${tf === "5m" ? "5m" : "1h"}`, "minSells", null, ""],
];
const AUDIT_CHECKS: [string, string][] = [["paid", "Dex paid"], ["pumpCa", "CA ends in \"pump\""], ["noDanger", "No danger flags"]];
const SOCIALS: [string, string][] = [["twitter", "X / Twitter"], ["website", "Website"], ["telegram", "Telegram"], ["social", "At least one social"]];
const STEP = 50, MAX_HIDDEN = 500;

// A coin that is already a rug, the same idea as the Pulse's isRug: its pool was emptied or it can't be sold,
// it fell 90%+ from a real peak, the dev holds half of it (the fake "$40M, 30 holders" launches), or a
// handful of wallets hold nearly all of it. These never show on Discover; searching a ticker or contract
// (or the hidden view) still finds one.
type ListTab = "trending" | "surge" | "new" | "bonded";
const TFS: Tf[] = ["5m", "1h", "24h"];
type Snapshot = { tf: Tf; t: number; tabs: Record<ListTab, { rows: Row[]; total: number }> };
// The last shared snapshot per window, kept in this browser (fine to lose: a private window, cleared data). Only
// one under ten minutes old is drawn; the coins in it are still the list's, and their figures go live at once.
const SNAP_KEY = (tf: Tf) => `discover:snap:${tf}`;
function keptSnapshot(tf: Tf): Snapshot | null {
  const s = store.get<Snapshot | null>(SNAP_KEY(tf), null);
  return s?.tabs && Date.now() - s.t < 15_000 ? s : null;   // older drew stale figures that then jumped
}
let keptAt = 0;
// The newest shared list per window this page has had (from the page's own reads and the background warming): a
// window opened while its answer is slow, or after a stalled read, draws this one (its figures still go live through
// discover/fresh.ts) instead of a loading box.
const lastSnap: Partial<Record<Tf, Snapshot>> = {};
const noteSnap = (s: Snapshot | null | undefined) => { if (s?.tabs && (!lastSnap[s.tf] || lastSnap[s.tf]!.t <= s.t)) { lastSnap[s.tf] = s; takeSnapshot(s); } };
// The shared lists carry each coin's Fomo known holders (server.js discoverLists): they go into the store the
// rows' faces read from, so a row is drawn with its faces instead of waiting for lib/known.ts's first poll.
function seedKnown(s: Snapshot | null | undefined) {
  if (!s?.tabs) return;
  const add: Record<string, [number, Face[]]> = {};
  for (const t of Object.values(s.tabs)) for (const r of t.rows) { const k = (r as Row & { known?: [number, Face[]] | null }).known; if (Array.isArray(k)) add[r.mint] = k; }
  if (Object.keys(add).length) useKnown.setState((st) => ({ by: { ...st.by, ...add } }));
}
function keepSnapshot(s: Snapshot) {
  if (Date.now() - keptAt < 20_000) return;   // a write of ~150 KB, not every 4 s
  keptAt = Date.now();
  store.set(SNAP_KEY(s.tf), s);
}

// A Pulse coin (a launch or a bonding the live stream just brought) as a Discover row: its live figures, the
// holder ledger's audit figures and the links its creator set.
const NO_COINS: Coin[] = [];
const xUrl = (x?: string | null) => (!x ? null : /^https?:/i.test(x) ? x : `https://x.com/${x.replace(/^@/, "")}`);
function fromPulse(c: Coin): Row {
  const H = c.hl || {}, vol = c.vol ?? c.liveVol ?? null;
  const links = [xUrl(c.x) && { type: "twitter", url: xUrl(c.x)! }, c.web && { type: "website", url: c.web }, c.tg && { type: "telegram", url: c.tg }].filter(Boolean) as { type: string; url: string }[];
  return {
    mint: c.mint, symbol: c.symbol ?? null, name: c.name ?? null, image: null, dex: c.graduated ? c.dex || "pumpswap" : "pumpfun", pair_created: c.born, first_seen: c.born,
    mcap: c.mcap ?? null, mc_live: c.mcap ?? null, liquidity: c.liq ?? null, vol_m5: vol, vol_h1: vol, vol_h24: vol,
    buys_m5: c.buys ?? null, sells_m5: c.sells ?? null, buys_h1: c.buys ?? null, sells_h1: c.sells ?? null, chg_m5: c.chg5 ?? null, chg_h1: null, chg_h24: null,
    links, boosts: null, header: null, graduated: c.graduated ? 1 : 0, safety_score: null, score: null,
    safety: { top10: H.t10 ?? c.top10 ?? undefined, devPct: H.dev ?? c.dev ?? undefined, totalHolders: H.h ?? c.holders ?? undefined },
    snipers: H.sn ?? null, bundlers: H.bd ?? null, liveSrc: true,
  };
}

// A dead chart, never listed (search and the hidden list included): marked dead by the server and not trading
// (under $500 in the last hour; the server also retires live coins when it tracks too many), or still under $6K of
// market cap 45 minutes after launch.
export const isDeadRow = (r: Row) => {
  const born = r.pair_created || r.first_seen, vol = r.vol_h1 ?? 0;
  return ((r.status === "dead" || Boolean(r.fresh?.dead)) && vol < 500) || (born > 0 && Date.now() - born > 45 * 60_000 && r.mcap != null && r.mcap > 0 && r.mcap < 6000);
};

export const isRug = (r: Row) => {
  const S = r.safety || {}, F = r.fresh || {};
  return Boolean(r.quarantine) || Boolean(F.dead) || Boolean(F.illiquid) || F.exitable === false
    || ((r.peak_mcap ?? 0) >= 20_000 && (r.mcap ?? 0) < (r.peak_mcap ?? 0) * 0.1)
    || (S.devPct ?? 0) >= 50
    || ((S.top10 ?? 0) >= 80 && (S.totalHolders ?? 0) >= 15);
};

export function Coins() {
  // (Most held is off the tab strip since 2026-10-10; a saved "held" opens Top.)
  const [tab, setTab] = useState<Tab>(() => { const t = store.get<Tab>("discover:tab", "trending"); return TABS.some(([k]) => k === t) ? t : "top"; });
  const [hotWin, setHotWin] = useState<HotWin>(() => { const w = store.get<HotWin>("discover:hotwin", "30"); return HOT_WINS.some(([k]) => k === w) ? w : "30"; });
  // Every tab and window ready before it is opened: Fomo's two lists and the shared lists for all three windows are
  // read every 12 s while Discover is open (inside lib/coin.ts SHOW_MS, so a switch draws them at once), and the
  // logos of their first rows go into the browser's cache, so a tab opens with its pictures too.
  useEffect(() => {
    // The first screenful or so of each list (the rest load as they scroll in): every list in full was ~500 logos at
    // once, past the server's pictures-per-minute allowance (server/request-guard.js), and logos then broke.
    const pics = (rows?: { mint: string }[] | null) => warmPics((rows || []).slice(0, 24).map((r) => r.mint));
    const warm = () => {
      if (document.hidden) return;
      for (const [w] of HOT_WINS) prefetch<HotAnswer>(hotPath(w))?.then((d) => pics(d?.top));
      for (const kind of ["trending", "held"]) prefetch<{ rows: { mint: string }[] | null }>(`fomo/list?kind=${kind}`)?.then((d) => pics(d?.rows));
      for (const w of TFS) prefetch<Snapshot>(`discover?tf=${w}`)?.then((s) => { noteSnap(s); if (s?.tabs) Object.values(s.tabs).forEach((t) => pics(t.rows)); });
    };
    warm();
    const id = setInterval(warm, 12_000);
    return () => clearInterval(id);
  }, []);
  const [tf, setTf] = useState<Tf>(() => store.get<Tf>("discover:tf", "1h"));
  const [f, setF] = useState<Filters>(() => store.get<Filters>("discover:filters", {}));
  const [hidden, setHidden] = useState<string[]>(() => store.get<string[]>("discover:hidden", []));
  const [showHidden, setShowHidden] = useState(false);
  const [sol, setSol] = useState<number>(() => store.get<number>("discover:sol", 0.1));
  const [open, setOpen] = useState(false), [q, setQ] = useState(""), [limit, setLimit] = useState(STEP);
  const paper = useTrade((s) => s.paper);

  const hot = tab === "hot";
  const fomo = tab === "top" || tab === "held" || hot;   // lists that bring their own rows (no shared list, filters or hiding)
  // What a tab's list is asked for (the same for the tab on screen and for one the pointer is on).
  const listPath = (tab: Tab, rows = limit) => {
    const params: Record<string, string> = { sort: SORT[tab][tf], dir: "desc", limit: String(rows) };
    for (const [k, v] of Object.entries(f)) if (isSet(v)) params[WINDOWED[k]?.[tf] ?? k] = v;
    if (tab === "bonded") params.graduated = "1";
    // Surge without a volume floor is a list of one-trade dust coins.
    if (tab === "surge" && !f.minVol) params[WINDOWED.minVol[tf]] = tf === "5m" ? "500" : tf === "1h" ? "5000" : "20000";
    if (tab === "trending" && !f.minLiq) params.minLiq = "5000";
    if (q.trim()) params.q = q.trim();
    if (hidden.length && !showHidden) params.hide = hidden.join(",");
    // The hidden view ignores tabs and filters: every hidden coin that is still live, biggest first.
    const query = showHidden ? { sort: "mcap", dir: "desc", limit: "400" } : params;
    return `tokens?${new URLSearchParams({ ...query, spark: tf })}`;
  };
  // With no filter, search, hidden view or "load more", every tab's list comes in one shared answer for the window
  // (server.js /api/discover, the same for everybody): switching tabs then asks nothing and draws at once. The last
  // one is kept in this browser, so opening the page draws its rows straight away while the fresh one is on its
  // way. Anything else asks for the one list on screen (Fomo's two tabs read their own: discover/fomo.tsx). A
  // change of tab, window or filter keeps the rows on screen until the new ones arrive.
  const shared = !fomo && !showHidden && !q.trim() && !Object.values(f).some(isSet) && limit === STEP;
  const { data: snap } = usePoll<Snapshot>(fomo || !shared ? null : `discover?tf=${tf}`, 5000, true);
  const kept = useMemo(() => keptSnapshot(tf), [tf]);
  useLayoutEffect(() => { seedKnown(kept); }, [kept]);
  useLayoutEffect(() => { if (snap?.tabs) { seedKnown(snap); keepSnapshot(snap); } }, [snap]);
  useEffect(() => { if (snap?.tabs) Object.values(snap.tabs).forEach((t) => warmPics(t.rows.slice(0, 24).map((r) => r.mint))); }, [snap]);
  noteSnap(snap); noteSnap(kept);
  // (lastSnap holds the newest of the poll's answer, the warmed ones and the kept one, for this window.)
  const fromSnap = shared ? (lastSnap[tf] ?? kept)?.tabs?.[tab as ListTab] : undefined;
  const { data: one, error } = usePoll<{ rows: Row[]; total: number }>(fomo || shared ? null : listPath(tab), 5000, true);
  // The snapshot leaves hidden coins in (it is everybody's); they come off here.
  const d0 = shared ? (fromSnap && (hidden.length ? { ...fromSnap, rows: fromSnap.rows.filter((r) => !hidden.includes(r.mint)) } : fromSnap)) : one;
  // New pairs and Bonded move like the Pulse's columns: every launch (or bonding) the live stream brings is in the
  // list the moment it happens, on top, one by one (lib/pulse.ts keeps them), with Discover's own rows for the
  // rest. A coin the Pulse calls a rug stays off, as it does there.
  const streamTab = shared && (tab === "new" || tab === "bonded");
  const liveCol = usePulse(useShallow((s) => (streamTab ? s.cols[tab === "new" ? "new" : "migrated"].slice(0, 60).map((m) => s.coins[m]).filter(Boolean) : NO_COINS)));
  const d = useMemo(() => {
    if (!streamTab || !d0) return d0;
    const own = new Map(d0.rows.map((r) => [r.mint, r]));
    const live = liveCol.filter((c) => !pulseRug(c) && !isDeadCoin(c) && !hidden.includes(c.mint)).map((c) => own.get(c.mint) ?? fromPulse(c));
    const seen = new Set(live.map((r) => r.mint));
    let rows = [...live, ...d0.rows.filter((r) => !seen.has(r.mint))];
    if (tab === "new") rows = rows.sort((a, b) => (b.pair_created || b.first_seen) - (a.pair_created || a.first_seen));
    rows = rows.slice(0, Math.max(STEP, d0.rows.length));
    return { ...d0, rows, total: Math.max(d0.total, rows.length) };
  }, [streamTab, d0, liveCol, tab, hidden]);
  // Rows that came in since the list was first drawn slide in (the first screenful does not).
  const seenRows = useRef<{ key: string; set: Set<string> | null; at: Map<string, number> }>({ key: "", set: null, at: new Map() });
  const freshKey = `${tab}:${tf}`;
  if (seenRows.current.key !== freshKey) seenRows.current = { key: freshKey, set: null, at: new Map() };
  // The rows on screen re-read their line, market cap and change every 1.5 s from the live trade feed. In a fixed
  // order, so the address only changes when the coins do (the page server and the radar both keep answers by it).
  const mints = (d?.rows || []).slice(0, 200).map((r) => r.mint).sort().join(",");
  const { data: live } = usePoll<{ w: Tf; rows: Record<string, { spark: [number, number][]; mc: number | null; chg: number | null; live: LiveFigures | null }> }>(mints ? `sparks?${new URLSearchParams({ w: tf, m: mints })}` : null, 3000);
  // A tab the pointer is on is likely the next one opened: its list is asked for now (the four shared lists are
  // already in hand).
  const warmTab = (t: Tab) => prefetch(t === "top" ? "fomo/list?kind=trending" : t === "hot" ? hotPath(hotWin) : t === "held" ? "fomo/list?kind=held" : shared ? `discover?tf=${tf}` : listPath(t, STEP));

  const nFilters = Object.values(f).filter(isSet).length;
  const save = <T,>(key: string, setter: (v: T) => void) => (v: T) => { setter(v); store.set(`discover:${key}`, v); setLimit(STEP); if (key === "tab" || key === "tf") eagerAgain(); };
  const saveHidden = save("hidden", setHidden);
  const hiddenSet = new Set(hidden);
  const toggleHide = (mint: string) => {
    if (hiddenSet.has(mint)) return saveHidden(hidden.filter((m) => m !== mint));
    saveHidden([mint, ...hidden].slice(0, MAX_HIDDEN));
    toast("Coin hidden. The eye button up top shows hidden coins.");
  };
  // Hide every coin on screen right now (Axiom's "hide all"), keeping the ones already hidden.
  const hideAll = () => {
    const shown = (d?.rows || []).map((r) => r.mint).filter((m) => !hiddenSet.has(m));
    if (!shown.length) return;
    saveHidden([...shown, ...hidden].slice(0, MAX_HIDDEN));
    toast(`${shown.length} coins hidden. The eye button up top brings them back.`);
  };
  // Each row's newest figures, from whichever answer (sparks, or the shared lists) the server worked out last
  // (discover/fresh.ts): an older answer landing late never moves a figure back.
  takeSnapshot(kept); takeSnapshot(snap); takeSparks(live);
  const merged = d?.rows.map((r) => {
    const l = freshest(r.mint, tf);
    if (l) { noteLive(`${r.mint}:${tf}`, l.chg); return withLive({ ...r, spark: l.spark ?? r.spark, spark_chg: l.chg, mc_live: l.mc ?? r.mc_live }, l.live, tf); }
    const own = (r as Row & { live?: LiveFigures | null }).live;
    return sparkOrKeep(own ? withLive(r, own, tf) : r, `${r.mint}:${tf}`);
  });
  const rugs = !showHidden && !q.trim() && merged ? merged.filter(isRug).length : 0;
  const rows = merged ? (showHidden ? merged.filter((r) => hiddenSet.has(r.mint)) : q.trim() ? merged : merged.filter((r) => !isRug(r))).filter((r) => !isDeadRow(r)) : null;
  // While the pointer is on a streaming list it holds still (as the Pulse's columns do): the rows keep their places
  // and their figures keep moving, and what came in meanwhile waits behind an "N new" pill until it leaves.
  const [paused, setPaused] = useState(false);
  const frozen = useRef<string[] | null>(null);
  const hold = streamTab && paused && frozen.current;
  const byMintNow = useMemo(() => new Map((rows || []).map((r) => [r.mint, r])), [rows]);
  const visible = hold ? frozen.current!.map((m) => byMintNow.get(m)).filter(Boolean) as Row[] : rows;
  if (!hold) frozen.current = rows ? rows.map((r) => r.mint) : null;
  const waitingNew = hold && rows ? rows.filter((r) => !frozen.current!.includes(r.mint)).length : 0;
  // Which rows just arrived (not in the list as first drawn for this tab and window): they slide in and glow, for
  // as long as that takes (the list redraws every second or so; a flag for one drawing would cut it short).
  const freshOnes = new Set<string>();
  if (visible?.length) {
    const sr = seenRows.current, t = Date.now();
    if (!sr.set) sr.set = new Set(visible.map((r) => r.mint));
    else for (const r of visible) if (!sr.set.has(r.mint)) { sr.set.add(r.mint); sr.at.set(r.mint, t); }
    for (const [m, at] of sr.at) { if (t - at < 1700) freshOnes.add(m); else sr.at.delete(m); }
    if (sr.set.size > 5000) sr.set = new Set(visible.map((r) => r.mint));
  }
  // (No chart preloading here: four TradingView frames per visit were ~1.4 MB and four live sockets for charts
  // that were mostly never opened. Hovering a row still warms that one coin's chart: lib/coin.ts prefetchCoin.)
  const sub = fomo ? TABS.find(([t]) => t === tab)![2] : showHidden ? `Hidden coins · ${hidden.length.toLocaleString()} hidden` : TABS.find(([t]) => t === tab)![2] + (d ? ` · ${d.total.toLocaleString()} coins match` : "") + (rugs ? ` · ${rugs} rugs hidden` : "");

  return (
    <Page title="Discover" sub={sub}>
      {/* tab strip and controls, as on Axiom */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <nav className="flex max-w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] max-md:-mx-1 max-md:px-1" aria-label="Lists">
          {TABS.map(([t, label]) => (
            <button key={t} onClick={() => save("tab", setTab)(t)} onPointerEnter={() => t !== tab && warmTab(t)}
              className={cn("h-8 shrink-0 rounded-control px-3 text-lg font-semibold whitespace-nowrap transition-colors", t === tab ? "bg-paper-4 text-ink shadow-[inset_0_1px_0_var(--color-edge)]" : "text-muted hover:text-ink-2")}>{label}</button>
          ))}
        </nav>
        {hot && <Segmented label="Window" value={hotWin} onChange={(v) => { setHotWin(v); store.set("discover:hotwin", v); eagerAgain(); }} options={HOT_WINS} />}
        {!fomo && <Segmented label="Window" value={tf} onChange={save("tf", setTf)} options={[["5m", "5m"], ["1h", "1h"], ["24h", "24h"]]} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex h-8 w-60 items-center gap-2 rounded-full border border-rule-2 bg-paper px-3 text-muted focus-within:border-accent-dim">
            <Icon.search className="size-3.5" /><input value={q} onChange={(e) => { setQ(e.target.value); setLimit(STEP); }} placeholder="Ticker, name or contract" aria-label="Search coins" className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
          </label>
          {!fomo && (<>
          <Tip tip={showHidden ? "Back to the list" : hidden.length ? `Show the ${hidden.length} hidden coin${hidden.length === 1 ? "" : "s"}` : "No hidden coins yet: hover a row and press its eye"}>
            <button onClick={() => setShowHidden(!showHidden)} aria-pressed={showHidden} aria-label="Hidden coins"
              className={cn("relative grid size-8 place-items-center rounded-control border transition-colors", showHidden ? "border-ink/50 bg-paper-4 text-ink" : "border-rule-2 text-ink-2 hover:text-ink")}>
              <Icon.eyeOff className="size-4.5" />
              {hidden.length > 0 && <span className="num absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-paper-5 px-1 text-2xs font-bold text-ink">{hidden.length > 99 ? "99+" : hidden.length}</span>}
            </button>
          </Tip>
          <Tip tip={nFilters ? `${nFilters} filter${nFilters === 1 ? "" : "s"} on` : "Filters"}>
            <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Filters"
              className={cn("relative grid size-8 place-items-center rounded-control border transition-colors", open ? "border-ink/50 bg-paper-4 text-ink" : "border-rule-2 text-ink-2 hover:text-ink")}>
              <Icon.sliders className="size-4.5" />
              {nFilters > 0 && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-paper bg-info" />}
            </button>
          </Tip>
          </>)}
          <label className="flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper pr-1 pl-3 text-muted" title={paper ? "Quick buy spends paper SOL" : "Quick buy spends REAL SOL"}>
            <Icon.bolt className="size-3.5" /><span className="text-sm">Quick buy</span>
            <input type="number" min={0.001} step={0.05} value={sol} onChange={(e) => { const v = Math.max(0.001, +e.target.value || 0.1); setSol(v); store.set("discover:sol", v); }}
              className="num w-14 bg-transparent text-right text-md font-semibold text-ink outline-none" aria-label="Quick buy amount in SOL" />
            <SolanaLogo className="w-3.5" />
            <span className={cn("rounded-full px-2 py-0.5 text-2xs font-bold uppercase", paper ? "bg-ink/10 text-ink-2" : "bg-down/15 text-down")}>{paper ? "Paper" : "Live"}</span>
          </label>
        </div>
      </div>

      {hot ? <HotTab win={hotWin} q={q} sol={sol} /> : fomo ? <FomoTab kind={tab as FomoKind} q={q} sol={sol} /> : <>
      {open && <FilterPanel tf={tf} value={f} onApply={(v) => { save("filters", setF)(v); setOpen(false); }} onClose={() => setOpen(false)} />}

      {showHidden && (
        <div className="flex flex-wrap items-center gap-3 rounded-control border border-rule-2 bg-paper-2 px-4 py-2.5 text-md text-ink-2">
          <Icon.eyeOff className="size-4 text-muted" />
          <span>Showing your hidden coins (tabs and filters are off here). Press a coin's eye to bring it back.</span>
          <span className="ml-auto flex gap-2">
            {hidden.length > 0 && <button onClick={() => { if (confirm(`Unhide all ${hidden.length} hidden coins?`)) { saveHidden([]); toast("All coins unhidden"); } }} className="h-7 rounded-control border border-rule-2 px-3 text-sm hover:text-ink">Unhide all</button>}
            <button onClick={() => setShowHidden(false)} className="chrome-fill h-7 rounded-control border px-3 text-sm font-semibold">Done</button>
          </span>
        </div>
      )}

      {error && !d && <Problem text={error} />}
      <Panel>
        <div className="overflow-x-auto">
          <div className="min-w-[1240px]">
            <div className={cn(GRID, "metal-bar sticky top-0 z-10 px-4 py-2 text-sm font-medium text-muted")}>
              <span>Pair info</span><span>Price {tf}</span><span className="text-right">Market cap</span><span className="text-right">Liquidity</span>
              <span className="text-right">Volume {tf}</span><span className="text-right">Txns {tf === "24h" ? "1h" : tf}</span><span>Token info</span>
              <span className="flex items-center justify-end gap-2">
                {!showHidden && rows && rows.length > 0 && <Tip tip="Hide every coin on screen"><button onClick={hideAll} className="flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-xs text-muted hover:bg-paper-4 hover:text-ink"><Icon.eyeOff className="size-3.5" />Hide all</button></Tip>}
                Action
              </span>
            </div>
            {waitingNew > 0 && (
              <div className="pointer-events-none sticky top-10 z-20 flex h-0 justify-center">
                <button onClick={() => setPaused(false)} className="pointer-events-auto mt-2 flex h-8 animate-row-in items-center gap-1.5 rounded-full bg-accent px-3.5 text-sm font-semibold text-accent-ink shadow-lg hover:bg-focus">
                  <Icon.launch className="size-3.5" />{waitingNew} new {tab === "bonded" ? "bonded" : "pair"}{waitingNew === 1 ? "" : "s"}
                </button>
              </div>
            )}
            {!visible ? <div className="p-3"><Loading /></div>
              : visible.length ? <div onPointerEnter={(e) => { if (streamTab && e.pointerType === "mouse") setPaused(true); }} onPointerLeave={() => setPaused(false)}>
                {visible.map((r) => <DiscoverRow key={r.mint} r={r} tf={tf} sol={sol} hidden={hiddenSet.has(r.mint)} onHide={toggleHide} fresh={streamTab && freshOnes.has(r.mint)} />)}</div>
              : <Empty>{showHidden ? (hidden.length ? "None of your hidden coins are in the live list right now." : "No hidden coins. Hover a row and press its eye to hide it.") : `No coins match${nFilters ? " these filters" : ""}.`}</Empty>}
          </div>
        </div>
        {d && !showHidden && d.total > d.rows.length && limit < 400 && (
          <button onClick={() => setLimit(Math.min(400, limit + STEP))} className="h-11 w-full border-t border-rule text-md text-ink-2 hover:bg-paper-3/60 hover:text-ink">Load {Math.min(STEP, d.total - d.rows.length)} more</button>
        )}
      </Panel>
      </>}
    </Page>
  );
}

// Axiom's filter sheet: protocols and keywords on top, then Audits / Metrics / Socials, then import, export,
// reset and apply. Nothing changes the list until Apply.
function FilterPanel({ tf, value, onApply, onClose }: { tf: Tf; value: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Filters>(value);
  const [section, setSection] = useState<Section>(() => store.get<Section>("discover:fsec", "audits"));
  const put = (k: string, v: string) => setDraft((d) => { const n = { ...d, [k]: v }; if (!isSet(v)) delete n[k]; return n; });
  const dex = (draft.dex || "").split(",").filter(Boolean);
  const count = (keys: string[]) => keys.filter((k) => isSet(draft[k])).length;
  const sections: [Section, string, number][] = [
    ["audits", "Audits", count([...AUDITS.flatMap(([, a, b]) => [a, b]).filter(Boolean) as string[], ...AUDIT_CHECKS.map(([k]) => k)])],
    ["metrics", "$ Metrics", count(metrics(tf).flatMap(([, a, b]) => [a, b]).filter(Boolean) as string[])],
    ["socials", "Socials", count(SOCIALS.map(([k]) => k))],
  ];
  const exportF = () => { navigator.clipboard?.writeText(JSON.stringify(draft)); toast("Filters copied"); };
  const importF = async () => {
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { /* no permission */ }
    if (!text.trim().startsWith("{")) text = window.prompt("Paste exported filters") || "";
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
      setDraft(Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string" && x !== "")) as Filters);
      toast("Filters imported, press Apply");
    } catch { if (text) toast("Those aren't exported filters"); }
  };

  const total = Object.keys(draft).length, quiet = "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-paper-3 hover:text-ink";
  return (
    <div className="surface flex flex-col overflow-hidden" role="region" aria-label="Filters">
      <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
        <h2 className="text-md font-semibold text-ink">Filters</h2>
        {total > 0 && <span className="num rounded-full bg-paper-4 px-1.5 text-2xs font-semibold text-ink-2">{total} on</span>}
        <button onClick={onClose} aria-label="Close filters" className="ml-auto grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-paper-3 hover:text-ink">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-col gap-2">
          <span className="flex items-center justify-between"><span className={fieldLabel}>Protocols</span>
            {dex.length > 0 && <button onClick={() => put("dex", "")} className="text-xs font-medium text-muted hover:text-ink">Any protocol</button>}</span>
          <div className="flex flex-wrap gap-1.5">
            {PROTOCOLS.map(([k, label]) => {
              const on = dex.includes(k);
              return <button key={k} aria-pressed={on} onClick={() => put("dex", (on ? dex.filter((x) => x !== k) : [...dex, k]).join(","))}
                className={cn("h-7 rounded-md px-2.5 text-sm font-medium ring-1 ring-inset transition-colors duration-150", on ? "bg-ink text-paper ring-ink" : "bg-paper-3/40 text-ink-2 ring-rule hover:bg-paper-3/80 hover:text-ink")}>{label}</button>;
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Text label="Include keywords" hint="Name or ticker has any of these, comma separated" value={draft.kw} onChange={(v) => put("kw", v)} placeholder="cat, dog, ai" />
          <Text label="Exclude keywords" hint="Hide coins whose name or ticker has any of these" value={draft.xkw} onChange={(v) => put("xkw", v)} placeholder="rug, scam" />
        </div>

        <div className="flex flex-col gap-4">
          <div role="tablist" aria-label="Filter groups" className="inline-flex w-fit items-center rounded-lg bg-paper-3/60 p-[3px] ring-1 ring-rule ring-inset">
            {sections.map(([s, label, n]) => (
              <button key={s} role="tab" aria-selected={s === section} onClick={() => { setSection(s); store.set("discover:fsec", s); }}
                className={cn("flex h-[26px] items-center gap-1.5 rounded-md px-3 text-sm transition-colors duration-150",
                  s === section ? "bg-paper-5 font-semibold text-ink shadow-[0_1px_2px_oklch(0%_0_0/0.35)]" : "font-medium text-muted hover:text-ink-2")}>
                {label.replace("$ ", "")}{n > 0 && <span className="num rounded-full bg-ink/15 px-1.5 text-2xs font-bold text-ink">{n}</span>}
              </button>
            ))}
          </div>
          {section === "audits" && (
            <div className="flex flex-col gap-4">
              <Checks items={AUDIT_CHECKS} draft={draft} put={put} />
              <Ranges items={AUDITS} draft={draft} put={put} />
            </div>
          )}
          {section === "metrics" && <Ranges items={metrics(tf)} draft={draft} put={put} note={tf === "24h" ? "Txns, buys and sells use the last hour; there is no 24h count." : undefined} />}
          {section === "socials" && <Checks items={SOCIALS} draft={draft} put={put} />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t border-rule bg-paper/40 px-4 py-3">
        <button onClick={importF} className={quiet}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>Import</button>
        <button onClick={exportF} className={quiet}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden><path d="M12 15V4M7 9l5-5 5 5M5 20h14" /></svg>Export</button>
        <span className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setDraft({})} disabled={!total} className={cn(quiet, "disabled:pointer-events-none disabled:opacity-40")}>Reset</button>
          <button onClick={onClose} className={quiet}>Cancel</button>
          <button onClick={() => onApply(draft)} className="h-8 rounded-lg bg-ink px-4 text-sm font-semibold text-paper transition-opacity duration-150 hover:opacity-90">Apply filters</button>
        </span>
      </div>
    </div>
  );
}
