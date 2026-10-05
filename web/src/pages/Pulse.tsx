import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { Segmented } from "@/components/ui/segmented";
import { COLS, usePulse, type Coin, type ColKey } from "@/lib/pulse";
import { useUi } from "@/lib/ui";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Sol } from "@/shell/Rail";
import { rowHeight, usePrefs, type PulseCol, type PulsePrefs } from "@/lib/prefs";
import { PulseRow } from "./PulseRow";
import { PulseSettings } from "./PulseSettings";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { hideCoins, showHidden, unhideAll, useHidden } from "@/lib/hidden";
import { FilterButton, fitsColumn, PulseFilters, useColFilters } from "./pulse/ColumnFilters";

type Show = "all" | "noslop" | "rated" | "buy";
// The columns on this page. "Running now" is left out: New Pairs, Final Stretch and Migrated are the page.
const TITLES: Record<string, string> = { new: "New Pairs", stretch: "Final Stretch", migrated: "Migrated" };
const SHOWN = COLS.filter(([col]) => col !== "running");
const SHOW: [Show, string][] = [["all", "All"], ["noslop", "Hide slop"], ["rated", "AI rated"], ["buy", "Buy calls"]];

// A coin that is already a rug, or cannot end any other way: its pool was emptied, the dev sold everything before it went anywhere,
// a handful of wallets hold nearly all of it, or the AI failed it outright. These never show on the Pulse,
// in any display mode. Searching a ticker or contract still finds one.
export const isRug = (t: Coin) => {
  const H = t.hl || {}, top10 = H.t10 ?? t.top10 ?? 0, dev = H.dev ?? t.dev ?? 0, holders = H.h ?? t.holders ?? 0, old = Date.now() - t.born > 90_000;
  // A dev selling out kills a coin that has not gone anywhere; one that kept running after it is a community coin, not a rug.
  const devDumped = (H.ds === "all" || H.ds === 2) && !t.graduated && (t.mcap ?? 0) < 10_000;
  return t.warn?.kind === "emptied" || devDumped || (holders >= 15 && top10 >= 80) || (old && dev >= 50) || (H.bd ?? 0) >= 50 || (H.sn ?? 0) >= 50 || t.ai?.grade === "F";
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
  if (isRug(t) || !fits(t, f)) return false;
  if (show === "noslop") return !(t.tri?.label === "slop" && !t.ai);
  if (show === "rated") return Boolean(t.ai?.rated);
  if (show === "buy") return t.ai?.action === "buy";
  return true;
};

const NONE: string[] = [];

// Each column keeps three quick-buy sizes (P1, P2, P3) and which one is in use.
interface Preset { p: number; sizes: number[] }
const PRESET0: Preset = { p: 0, sizes: [0.25, 0.5, 1] };

function Column({ col, show, globalQ }: { col: ColKey; show: Show; globalQ: string }) {
  const title = TITLES[col], prefs = usePrefs(), rowH = rowHeight(prefs);
  const [own, setOwn] = useState("");
  const [preset, setPresetState] = useState<Preset>(() => store.get<Preset>(`pulse:buy:${col}`, PRESET0));
  const setPreset = (p: Preset) => { store.set(`pulse:buy:${col}`, p); setPresetState(p); };
  const q = (own || globalQ).trim().toLowerCase(), sol = preset.sizes[preset.p] || 0.25;
  const cf = useColFilters((s) => s.f[col as "new"] || {});
  const { mints: hiddenList, showing } = useHidden();
  const hidden = new Set(hiddenList);
  // Normal view: hidden coins drop out. Hidden view: only the hidden ones, filters off, so each can be brought back.
  const mints = usePulse(useShallow((s) => s.cols[col].filter((m) => s.coins[m] && (showing ? hidden.has(m) : !hidden.has(m) && passes(s.coins[m], show, q, prefs) && (Boolean(q) || fitsColumn(s.coins[m], cf))))));
  const hideAll = () => { if (!mints.length) return; hideCoins(mints); toast(`${mints.length} coin${mints.length === 1 ? "" : "s"} hidden from ${title}. The eye button up top brings them back.`); };
  const loaded = usePulse((s) => s.loaded);
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
  const held = usePulse(useShallow((s) => (frozen.current ? frozen.current.filter((m) => s.coins[m] && (showing ? hidden.has(m) : !hidden.has(m))) : NONE)));
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
    <section aria-label={title} className="flex min-h-0 min-w-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-rule px-3.5">
        <h2 className="text-xl font-semibold whitespace-nowrap text-ink">{title}</h2>
        <label className="ml-auto flex h-8 w-52 min-w-0 shrink items-center max-[1800px]:hidden rounded-full border border-rule-2 bg-paper px-3 focus-within:border-accent-dim">
          <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Search by ticker or name" aria-label={`Search ${title}`}
            className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
        </label>
        <div className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-rule-2 bg-paper pr-1 pl-2.5 max-[1800px]:ml-auto">
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
                className={cn("h-6 rounded-full px-2 text-sm font-semibold transition-colors duration-100", preset.p === i ? "bg-paper-5 text-ink" : "text-muted hover:text-ink-2")}>P{i + 1}</button>
            ))}
          </span>
        </div>
        {!showing && (
          <Tip tip={`Hide every coin in ${title} now; new ones keep coming in`}>
            <button onClick={hideAll} aria-label={`Hide all coins in ${title}`}
              className="grid size-8 shrink-0 place-items-center rounded-control border border-rule-2 text-ink-2 transition-colors duration-100 hover:border-muted hover:text-ink">
              <Icon.eyeOff className="size-4.5" />
            </button>
          </Tip>
        )}
        <FilterButton col={col} title={title} />
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
      {paused && (
        <button onClick={resume} className={cn("absolute top-2 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border border-rule-2 bg-paper-4/95 px-3 text-sm font-medium text-ink-2 shadow-raised backdrop-blur transition-opacity duration-150 hover:text-ink",
          waiting ? "opacity-100" : "pointer-events-none opacity-0")}>
          <i className="size-1.5 rounded-full bg-warn" />Paused{waiting ? ` · ${waiting} new` : ""}
        </button>
      )}
      <div ref={scroller} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:none]">
        {!loaded ? <p className="p-4 text-md text-muted">Loading…</p>
          : !list.length ? <p className="p-4 text-md text-muted">{showing ? "No hidden coins in this column." : q || show !== "all" || Object.keys(cf).length ? "Nothing matches the filter." : "Nothing here right now."}</p>
          : (
            <div className="relative" style={{ height: v.getTotalSize() }}>
              {v.getVirtualItems().map((it) => {
                const m = list[it.index];
                return (
                  <div key={it.key} className={cn("absolute inset-x-0 top-0 transition-transform duration-300 ease-out will-change-transform", fresh.current.has(m) && "animate-row-in")}
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

// Axiom's eye button: how many coins are hidden; pressing it shows just those (and Unhide all).
function HiddenButton() {
  const { mints, showing } = useHidden();
  return (
    <span className="flex items-center gap-2">
      {showing && mints.length > 0 && <button onClick={() => { if (confirm(`Unhide all ${mints.length} hidden coins?`)) { unhideAll(); showHidden(false); toast("All coins unhidden"); } }} className="h-8 rounded-full border border-rule-2 px-3 text-md text-ink-2 hover:border-muted hover:text-ink">Unhide all</button>}
      <Tip tip={showing ? "Back to the live columns" : mints.length ? `Show the ${mints.length} hidden coin${mints.length === 1 ? "" : "s"}` : "No hidden coins yet: hover a coin and press its eye"}>
        <button onClick={() => showHidden(!showing)} aria-pressed={showing} aria-label="Hidden coins"
          className={cn("relative grid size-8 place-items-center rounded-control border transition-colors duration-100", showing ? "border-ink/50 bg-paper-4 text-ink" : "border-rule-2 text-ink-2 hover:border-muted hover:text-ink")}>
          <Icon.eyeOff className="size-4.5" />
          {mints.length > 0 && <span className="num absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-paper-5 px-1 text-2xs font-bold text-ink">{mints.length > 99 ? "99+" : mints.length}</span>}
        </button>
      </Tip>
    </span>
  );
}

export function Pulse() {
  const globalQ = useUi((s) => s.q);
  const [show, setShowState] = useState<Show>(() => store.get<Show>("pulse:show", "noslop"));
  const setShow = (v: Show) => { store.set("pulse:show", v); setShowState(v); };
  const prefs = usePrefs(), rowH = rowHeight(prefs), open = SHOWN.filter(([col]) => prefs.cols[col as PulseCol]);
  return (
    <div className="flex h-full min-w-0 flex-col gap-3 p-3 max-md:h-auto">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl leading-none font-bold tracking-tight text-ink">Pulse</h1>
        <span className="flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper px-3 text-md font-medium text-ink" title="Blix is Solana only"><Sol className="size-3.5" />Solana</span>
        <div className="ml-auto flex items-center gap-2.5">
          <HiddenButton />
          <span className="text-sm text-muted max-md:hidden">Display</span>
          <Segmented value={show} options={SHOW} onChange={setShow} label="Which coins to show" />
          <PulseSettings />
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(var(--cols),minmax(0,1fr))] divide-x divide-rule overflow-hidden rounded-card border border-rule bg-paper-2 max-md:grid-cols-[minmax(0,1fr)] max-md:divide-x-0 max-md:[&>section]:h-[75vh]" style={{ "--cols": open.length } as CSSProperties}>
        {open.map(([col]) => <Column key={`${col}:${rowH}`} col={col} show={show} globalQ={globalQ} />)}
      </div>
      <PulseFilters />
    </div>
  );
}
