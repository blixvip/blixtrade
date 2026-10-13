import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { Segmented } from "@/components/ui/segmented";
import { COLS, usePulse, type Coin, type ColKey } from "@/lib/pulse";
import { useUi } from "@/lib/ui";
import { cn, store } from "@/lib/utils";
import { EmptyState } from "@/components/page";
import { Icon } from "@/shell/icons";
import { Sol } from "@/shell/Rail";
import { FILTER_KEYS, filterCount, rowHeight, setPrefs, usePrefs, type PulseCol, type PulsePrefs } from "@/lib/prefs";
import { PulseRow } from "./PulseRow";
import { CTL, PulseSettings } from "./PulseSettings";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { clearColumn, clearedOut, showHidden, unhideAll, useHidden, type HiddenCol } from "@/lib/hidden";
import { countFilters, FilterButton, fitsColumn, PulseFilters, resetColumn, useColFilters } from "./pulse/ColumnFilters";

type Show = "all" | "noslop" | "rated" | "buy";
// The columns on this page. Running Now is gone for good (the user's call, 2026-10-09: never add it back, not as a
// column and not as a tab): New Pairs, Final Stretch and Migrated remain.
const TITLES: Record<string, string> = { new: "New Pairs", stretch: "Final Stretch", migrated: "Migrated" };
const SHOWN = COLS.filter(([c]) => c !== "running");
const SHOW: [Show, string][] = [["all", "All"], ["noslop", "Hide slop"], ["rated", "AI rated"], ["buy", "Buy calls"]];

// Discovery risk heuristics, not evidence that a coin rugged. Search bypasses them.
export const isRug = (t: Coin) => {
  if (t.mv) return false;
  const H = t.hl || {}, top10 = H.t10 ?? t.top10 ?? 0, dev = H.dev ?? t.dev ?? 0, holders = H.h ?? t.holders ?? 0, old = Date.now() - t.born > 90_000;
  // A dev selling out kills a coin that has not gone anywhere; one that kept running after it is a community coin, not a rug.
  const devDumped = (H.ds === "all" || H.ds === 2) && !t.graduated && t.mcap != null && t.mcap > 0 && t.mcap < 10_000;
  return devDumped || (holders >= 15 && top10 >= 80) || (old && dev >= 50) || (H.bd ?? 0) >= 50 || (H.sn ?? 0) >= 50 || t.ai?.grade === "F";
};

// A coin whose chart is dead is never shown, in any list or search: a new pair nobody has traded for minutes
// (the server's "faded"), or one still under $6K of market cap 45 minutes after launch. It comes back by itself if
// it starts trading again (the server makes it "watching" once it trades).
export const isDeadCoin = (t: Coin) => t.state === "faded" || (Date.now() - t.born > 45 * 60_000 && t.mcap != null && t.mcap > 0 && t.mcap < 6000);

// Rug guard (Pulse settings): the visitor's simple anti-rug switches. A figure not known yet passes, so a coin a
// second old is not hidden for what nobody has measured.
export const rugGuard = (t: Coin, p: PulsePrefs) => {
  if (!p.rug) return false;
  const c = p.rugChecks, H = t.hl || {}, age = Date.now() - t.born, holders = H.h ?? t.holders;
  const top10 = H.t10 ?? t.top10, dev = H.dev ?? t.dev;
  // After bonding a dev selling is common for a community coin (isRug above): only coins still on the curve.
  if (c.devSold && H.ds && !t.graduated) return true;
  if (c.top10 && top10 != null && (holders ?? 0) >= 10 && top10 > 30) return true;
  if (c.dev && dev != null && age > 60_000 && dev > 10) return true;
  if (c.snipers && (H.sn ?? 0) > 25) return true;
  if (c.bundle && (H.bd ?? 0) > 25) return true;
  if (c.serial && (t.devCount ?? 0) >= 5) return true;
  if (c.dead && holders != null && age > 180_000 && holders < 15) return true;
  if (c.socials && !(t.x || t.web || t.tg)) return true;
  return false;
};

// The visitor's own filters (Pulse settings). A figure that is not known yet passes a "most" limit and fails a "least" one.
const fits = (t: Coin, f: PulsePrefs) => {
  const H = t.hl || {}, mcap = t.mcap ?? 0, vol = t.vol ?? t.liveVol ?? 0, holders = H.h ?? t.holders ?? 0, top10 = H.t10 ?? t.top10, dev = H.dev ?? t.dev;
  if (f.minMcap != null && mcap < f.minMcap) return false;
  if (f.maxMcap != null && mcap > f.maxMcap) return false;
  if (f.minVol != null && vol < f.minVol) return false;
  if (f.minHolders != null && holders < f.minHolders) return false;
  if (f.maxTop10 != null && top10 != null && top10 > f.maxTop10) return false;
  if (f.maxDev != null && dev != null && dev > f.maxDev) return false;
  if (f.maxAgeMin != null && Date.now() - t.born > f.maxAgeMin * 60_000) return false;
  if (f.socials && !(t.x || t.web || t.tg)) return false;
  return true;
};

const passes = (t: Coin, show: Show, q: string, f: PulsePrefs): boolean => {
  if (q) return `${t.symbol} ${t.name} ${t.mint}`.toLowerCase().includes(q) && (show === "all" || show === "noslop" || passes(t, show, "", f));
  if (isDeadCoin(t) || isRug(t) || rugGuard(t, f) || !fits(t, f)) return false;
  if (show === "noslop") return !(t.tri?.label === "slop" && !t.ai);
  if (show === "rated") return Boolean(t.ai?.rated);
  if (show === "buy") return t.ai?.action === "buy";
  return true;
};

const NONE: string[] = [];

// Each column keeps three quick-buy sizes (P1, P2, P3) and which one is in use.
interface Preset { p: number; sizes: number[] }
const PRESET0: Preset = { p: 0, sizes: [0.25, 0.5, 1] };

function Column({ col, show, setShow, globalQ, phoneHidden }: { col: ColKey; show: Show; setShow: (v: Show) => void; globalQ: string; phoneHidden?: boolean }) {
  const title = TITLES[col], prefs = usePrefs(), rowH = rowHeight(prefs);
  const [own, setOwn] = useState("");
  const [preset, setPresetState] = useState<Preset>(() => store.get<Preset>(`pulse:buy:${col}`, PRESET0));
  const setPreset = (p: Preset) => { store.set(`pulse:buy:${col}`, p); setPresetState(p); };
  const q = (own || globalQ).trim().toLowerCase(), sol = preset.sizes[preset.p] || 0.25;
  const cf = useColFilters((s) => s.f[col as "new"] || {});
  const { mints: hiddenList, cleared, showing } = useHidden();
  const hidden = new Set(hiddenList);
  // A coin that was already around when this column was last cleared stays out of it (lib/hidden.ts clearedOut):
  // its creation for New Pairs and Final Stretch, its bonding for Migrated.
  const out = (c: Coin) => clearedOut(cleared, col as HiddenCol, col === "migrated" && c.age != null ? Date.now() - c.age : c.born);
  // Normal view: hidden coins drop out. Hidden view: only the hidden ones, filters off, so each can be brought back.
  const mints = usePulse(useShallow((s) => s.cols[col].filter((m) => s.coins[m] && (showing ? hidden.has(m) : !hidden.has(m) && !out(s.coins[m]) && passes(s.coins[m], show, q, prefs) && (Boolean(q) || fitsColumn(s.coins[m], cf, col as "new"))))));
  const hideAll = () => { if (!mints.length) return; clearColumn(col as HiddenCol, mints); toast(`${title} cleared: ${mints.length} coin${mints.length === 1 ? "" : "s"} hidden, and nothing older than now will show here again. The eye button up top brings them back.`); };
  // Rows show from the radar's board, or from the one this browser kept (lib/pulse.ts readSnapshot) until it answers.
  const loaded = usePulse((s) => s.loaded || s.restored);
  const scroller = useRef<HTMLDivElement>(null);

  // Like Padre's and Axiom's trenches: while the pointer is over a column, or it is scrolled down, its order
  // holds still (figures keep updating) and new coins wait behind an "N new" pill. Moving away, scrolling back
  // to the top or pressing the pill lets them in, sliding the rows down rather than snapping.
  const [hover, setHover] = useState(false), [scrolled, setScrolled] = useState(false);
  const paused = (hover || scrolled) && !q;
  const frozen = useRef<string[] | null>(null);
  if (paused && !frozen.current) frozen.current = mints;
  if (!paused) frozen.current = null;
  // The frozen rows still drop a coin the radar forgot or one hidden meanwhile (selector, so price ticks do not re-render the column).
  const held = usePulse(useShallow((s) => (frozen.current ? frozen.current.filter((m) => s.coins[m] && (showing ? hidden.has(m) : !hidden.has(m) && !out(s.coins[m]))) : NONE)));
  const list = paused ? held : mints;
  const waiting = paused ? mints.filter((m) => !frozen.current!.includes(m)).length : 0;
  // Rows that just arrived fade and slide in; ones already seen (or mounted by scrolling) do not.
  const seen = useRef<Set<string> | null>(null), fresh = useRef<Map<string, number>>(new Map());
  if (loaded && list.length) {
    if (!seen.current) seen.current = new Set(list);
    else for (const m of list) if (!seen.current.has(m)) { seen.current.add(m); fresh.current.set(m, Date.now()); }
    if (seen.current.size > 3000) seen.current = new Set(list);
  }
  useEffect(() => { const t = setInterval(() => { for (const [m, at] of fresh.current) if (Date.now() - at > 1000) fresh.current.delete(m); }, 2000); return () => clearInterval(t); }, []);
  const resume = () => { setHover(false); setScrolled(false); scroller.current?.scrollTo({ top: 0, behavior: "smooth" }); };

  const v = useVirtualizer({ count: list.length, getScrollElement: () => scroller.current, estimateSize: () => rowH, overscan: 6, getItemKey: (i) => list[i] });

  return (
    <section aria-label={title} className={cn("@container flex min-h-0 min-w-0 snap-start flex-col", phoneHidden && "max-md:hidden")}>
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-rule px-3.5 @max-md:h-auto @max-md:min-h-12 @max-md:flex-wrap @max-md:gap-2 @max-md:py-2">
        <h2 className="text-xl font-semibold whitespace-nowrap text-ink">{title}</h2>
        <label className="ml-auto flex h-8 w-52 min-w-0 shrink items-center max-[1800px]:hidden rounded-full border border-rule-2 bg-paper px-3 focus-within:border-accent-dim">
          <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Search by ticker or name" aria-label={`Search ${title}`}
            className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
        </label>
        <div className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-rule-2 bg-paper pr-1 pl-2.5 max-[1800px]:ml-auto @max-md:order-last @max-md:ml-0! @max-md:gap-1.5">
          <label className="flex items-center gap-1 text-ink-2" title="Quick-buy size in SOL for this column">
            <Icon.bolt className="size-3.5 fill-current" />
            <input value={String(preset.sizes[preset.p] ?? "")} inputMode="decimal" aria-label={`Quick-buy size for ${title}, in SOL`}
              onChange={(e) => { const n = e.target.value.replace(/[^0-9.]/g, ""); setPreset({ ...preset, sizes: preset.sizes.map((s, i) => (i === preset.p ? (n as unknown as number) : s)) }); }}
              onBlur={() => setPreset({ ...preset, sizes: preset.sizes.map((s) => Math.min(10, Math.max(0.001, +s || 0.25))) })}
              className="num w-9 bg-transparent text-md font-semibold text-ink outline-none" />
            <Sol className="size-3.5" />
          </label>
          <span className="flex" role="radiogroup" aria-label="Quick-buy preset">
            {[0, 1, 2].map((i) => (
              <button key={i} role="radio" aria-checked={preset.p === i} onClick={() => setPreset({ ...preset, p: i })}
                className={cn("h-6 rounded-full px-2 text-sm font-semibold transition-colors duration-100 @max-md:px-1.5", preset.p === i ? "bg-paper-5 text-ink" : "text-muted hover:text-ink-2")}>P{i + 1}</button>
            ))}
          </span>
        </div>
        {!showing && (
          <Tip tip={`Hide every coin in ${title} now; new ones keep coming in`}>
            <button onClick={hideAll} aria-label={`Hide all coins in ${title}`}
              className="@max-md:ml-auto grid size-8 shrink-0 place-items-center rounded-control border border-rule-2 text-ink-2 transition-colors duration-100 hover:border-muted hover:text-ink">
              <Icon.eyeOff className="size-4.5" />
            </button>
          </Tip>
        )}
        <FilterButton col={col} title={title} />
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
      {paused && (
        <button onClick={resume} aria-label={`Show ${waiting} new coin${waiting === 1 ? "" : "s"}`}
          className={cn("absolute top-2.5 left-1/2 z-10 flex h-6.5 -translate-x-1/2 items-center gap-1 rounded-full bg-accent pr-2.5 pl-2 text-sm font-semibold text-accent-ink tabular-nums shadow-raised transition-[opacity,translate,scale] duration-200 ease-out hover:scale-[1.04] active:scale-[0.97]",
            waiting ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1.5 opacity-0")}>
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" /></svg>
          {waiting} new
        </button>
      )}
      <div ref={scroller} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:none]">
        {!loaded ? <PulseSkeleton rowH={rowH} />
          : !list.length ? <ColumnEmpty title={title} showing={showing} q={q} own={own} clearOwn={() => setOwn("")} colFilters={countFilters(cf)}
              resetCol={() => resetColumn(col as "new")} show={show} setShow={setShow} prefs={prefs} />
          : (
            <div className="relative" style={{ height: v.getTotalSize() }}>
              {v.getVirtualItems().map((it) => {
                const m = list[it.index];
                return (
                  <div key={it.key} className={cn("absolute inset-x-0 top-0 transition-transform duration-300 ease-out", fresh.current.has(m) && "animate-row-in")}
                    style={{ height: rowH, transform: `translateY(${it.start}px)` }}>
                    <PulseRow mint={m} col={col} sol={+sol || 0.25} />
                  </div>
                );
              })}
            </div>
          )}
      </div>
      </div>
    </section>
  );
}

// An empty column: one plain line, nothing else (owner, 2026-10-11: "super simple").
function ColumnEmpty(_: {
  title: string; showing: boolean; q: string; own: string; clearOwn: () => void; colFilters: number; resetCol: () => void;
  show: Show; setShow: (v: Show) => void; prefs: PulsePrefs;
}) {
  return <div role="status" className="grid h-full min-h-64 w-full place-items-center px-6 text-center text-xs text-muted">No tokens match the current filters</div>;
}

// Axiom's eye button: how many coins are hidden; pressing it shows just those (and Unhide all).
function HiddenButton() {
  const { mints, showing } = useHidden();
  return (
    <span className="flex items-center gap-2">
      {showing && mints.length > 0 && <button onClick={() => { if (confirm(`Unhide all ${mints.length} hidden coins?`)) { unhideAll(); showHidden(false); toast("All coins unhidden"); } }} className={cn(CTL, "px-3 text-ink-2")}>Unhide all</button>}
      <Tip tip={showing ? "Back to the live columns" : mints.length ? `Show the ${mints.length} hidden coin${mints.length === 1 ? "" : "s"}` : "No hidden coins yet: hover a coin and press its eye"}>
        <button onClick={() => showHidden(!showing)} aria-pressed={showing} aria-label="Hidden coins"
          className={cn(CTL, "gap-1.5 px-2.5", showing ? "bg-paper-5 text-ink ring-rule-2" : "text-ink-2")}>
          <Icon.eyeOff className="size-4" />
          {mints.length > 0 && <span className={cn("num text-xs font-semibold tabular-nums", showing ? "text-ink" : "text-muted")}>{mints.length > 99 ? "99+" : mints.length}</span>}
        </button>
      </Tip>
    </span>
  );
}

// Rug guard on or off in one click (its checks are in Pulse settings).
function RugButton() {
  const on = usePrefs((p) => p.rug);
  return (
    <Tip tip={on ? "Rug guard is on: coins matching risk filters are hidden. Its checks are in Settings." : "Filter risk signals: dev sold, a few wallets or snipers holding most of it, serial launchers, dead coins"}>
      <button role="switch" aria-checked={on} onClick={() => { setPrefs({ rug: !on }); toast(on ? "Rug guard off" : "Rug guard on: risk filters applied"); }}
        className={cn(CTL, "gap-1.5 px-3", on ? "bg-up/10 text-up ring-up/35 hover:bg-up/15 hover:text-up" : "text-ink-2")}>
        <Icon.shield className="size-4" /><span className="max-md:sr-only">Rug guard</span>
        <i aria-hidden className={cn("size-1.5 rounded-full transition-colors", on ? "bg-up shadow-[0_0_6px_var(--color-up)]" : "bg-rule-2")} />
      </button>
    </Tip>
  );
}

let prefs0: PulsePrefs;   // the filters as of the last render, for the view's hidden count above (read inside a store selector)
export function Pulse() {
  const globalQ = useUi((s) => s.q);
  const [show, setShowState] = useState<Show>(() => store.get<Show>("pulse:show", "all"));
  const setShow = (v: Show) => { store.set("pulse:show", v); setShowState(v); };
  const prefs = usePrefs(), rowH = rowHeight(prefs), open = SHOWN.filter(([col]) => prefs.cols[col as PulseCol]);
  prefs0 = prefs;
  // How many coins on the board the chosen view is hiding, so a missing coin is never a mystery.
  const hiddenByView = usePulse(useShallow((s) => { if (show === "all") return 0; let n = 0; for (const [col] of SHOWN) for (const m of s.cols[col]) { const t = s.coins[m]; if (t && !isDeadCoin(t) && !isRug(t) && !passes(t, show, "", prefs0)) n++; } return n; }));
  // A phone shows one column at a time, picked here: stacked, each column's own scroll caught every swipe and the
  // columns under New Pairs could not be reached.
  const [phoneCol, setPhoneColState] = useState<ColKey>(() => store.get<ColKey>("pulse:phone", "new"));
  const setPhoneCol = (c: ColKey) => { store.set("pulse:phone", c); setPhoneColState(c); };
  const pick = open.some(([c]) => c === phoneCol) ? phoneCol : open[0]?.[0];
  return (
    <div className="flex h-full min-w-0 flex-col gap-3 p-3 max-md:h-auto">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl leading-none font-bold tracking-tight text-ink">Pulse</h1>
        <span className="flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper px-3 text-md font-medium text-ink" title="Blix is Solana only"><Sol className="size-3.5" />Solana</span>
        {/* One row: on a narrow phone (320 px) the Display choices scroll sideways rather than push the row off screen. */}
        <div className="ml-auto flex max-w-full min-w-0 items-center gap-2">
          <HiddenButton />
          <RugButton />
          <i aria-hidden className="mx-1 h-5 w-px shrink-0 bg-rule-2 max-md:hidden" />
          <div className="min-w-0 overflow-x-auto [scrollbar-width:none] max-[419px]:[&_button]:px-2 max-md:[mask-image:linear-gradient(to_right,black_82%,transparent)] max-md:pr-4">{show !== "all" && hiddenByView > 0 && <Tip tip={`This view hides ${hiddenByView} coin${hiddenByView === 1 ? "" : "s"} that the filters let through. "All" shows every coin`}><button onClick={() => setShow("all")} className="num shrink-0 rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-xs font-semibold text-warn hover:bg-warn/20">−{hiddenByView} hidden</button></Tip>}<Segmented value={show} options={SHOW} onChange={setShow} label="Which coins to show" /></div>
          <PulseSettings />
        </div>
      </header>
      {open.length > 1 && <div className="overflow-x-auto [scrollbar-width:none] md:hidden"><Segmented value={pick} options={open.map(([c]) => [c, TITLES[c]] as [ColKey, string])} onChange={setPhoneCol} label="Which column" /></div>}
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(var(--cols),minmax(22.5rem,1fr))] snap-x snap-mandatory divide-x divide-rule overflow-x-auto overflow-y-hidden rounded-card border border-rule bg-paper-2 max-md:grid-cols-[minmax(0,1fr)] max-md:divide-x-0 max-md:[&>section]:h-[75vh]" style={{ "--cols": open.length } as CSSProperties}>
        {open.map(([col]) => <Column key={`${col}:${rowH}`} col={col} show={show} setShow={setShow} globalQ={globalQ} phoneHidden={col !== pick} />)}
      </div>
      <PulseFilters />
    </div>
  );
}

// A column still loading: rows shaped like the coins about to arrive (picture, name and links, market cap, buy
// button), a light passing over them, fading out down the column. Read as "coins are coming", not "something broke".
const shim = "animate-shimmer rounded bg-[linear-gradient(90deg,var(--color-paper-3)_0%,var(--color-paper-4)_45%,var(--color-paper-5)_50%,var(--color-paper-4)_55%,var(--color-paper-3)_100%)] bg-[length:250%_100%]";
function PulseSkeleton({ rowH }: { rowH: number }) {
  const pic = Math.max(36, Math.min(76, rowH - 40));
  return (
    <div role="status" aria-label="Loading coins" className="flex flex-col [mask-image:linear-gradient(to_bottom,black_55%,transparent)]">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-rule/60 px-3.5" style={{ height: rowH }}>
          <span className={cn(shim, "shrink-0 rounded-lg")} style={{ width: pic, height: pic, animationDelay: `${i * 90}ms` }} />
          <span className="flex min-w-0 flex-1 flex-col gap-2.5">
            <span className={cn(shim, "h-3.5")} style={{ width: `${38 + ((i * 23) % 30)}%`, animationDelay: `${i * 90 + 40}ms` }} />
            <span className="flex gap-1.5">
              <span className={cn(shim, "h-3 w-8")} style={{ animationDelay: `${i * 90 + 70}ms` }} />
              <span className={cn(shim, "size-3 rounded-full")} style={{ animationDelay: `${i * 90 + 90}ms` }} />
              <span className={cn(shim, "size-3 rounded-full")} style={{ animationDelay: `${i * 90 + 110}ms` }} />
              <span className={cn(shim, "size-3 rounded-full")} style={{ animationDelay: `${i * 90 + 130}ms` }} />
            </span>
            <span className={cn(shim, "h-2.5")} style={{ width: `${55 + ((i * 17) % 30)}%`, animationDelay: `${i * 90 + 150}ms` }} />
          </span>
          <span className="flex shrink-0 flex-col items-end gap-2.5">
            <span className={cn(shim, "h-4 w-16")} style={{ animationDelay: `${i * 90 + 60}ms` }} />
            <span className={cn(shim, "h-7 w-[86px] rounded-full")} style={{ animationDelay: `${i * 90 + 120}ms` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
