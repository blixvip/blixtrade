import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Segmented } from "@/components/ui/segmented";
import { COLS, usePulse, type Coin, type ColKey } from "@/lib/pulse";
import { useUi } from "@/lib/ui";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Sol } from "@/shell/Rail";
import { PulseRow, ROW_H } from "./PulseRow";

type Show = "all" | "noslop" | "rated" | "buy";
// The columns on this page. "Running now" is left out: New Pairs, Final Stretch and Migrated are the page.
const TITLES: Record<string, string> = { new: "New Pairs", stretch: "Final Stretch", migrated: "Migrated" };
const SHOWN = COLS.filter(([col]) => col !== "running");
const SHOW: [Show, string][] = [["all", "All"], ["noslop", "Hide slop"], ["rated", "AI rated"], ["buy", "Buy calls"]];

const passes = (t: Coin, show: Show, q: string) => {
  if (q && !`${t.symbol} ${t.name} ${t.mint}`.toLowerCase().includes(q)) return false;
  if (show === "noslop") return !(t.tri?.label === "slop" && !t.ai);
  if (show === "rated") return Boolean(t.ai?.rated);
  if (show === "buy") return t.ai?.action === "buy";
  return true;
};

// Each column keeps three quick-buy sizes (P1, P2, P3) and which one is in use.
interface Preset { p: number; sizes: number[] }
const PRESET0: Preset = { p: 0, sizes: [0.25, 0.5, 1] };

function Column({ col, show, globalQ }: { col: ColKey; show: Show; globalQ: string }) {
  const title = TITLES[col];
  const [own, setOwn] = useState("");
  const [preset, setPresetState] = useState<Preset>(() => store.get<Preset>(`pulse:buy:${col}`, PRESET0));
  const setPreset = (p: Preset) => { store.set(`pulse:buy:${col}`, p); setPresetState(p); };
  const q = (own || globalQ).trim().toLowerCase(), sol = preset.sizes[preset.p] || 0.25;
  const mints = usePulse(useShallow((s) => (show === "all" && !q ? s.cols[col] : s.cols[col].filter((m) => s.coins[m] && passes(s.coins[m], show, q)))));
  const loaded = usePulse((s) => s.loaded);
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: mints.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 6, getItemKey: (i) => mints[i] });

  return (
    <section aria-label={title} className="flex min-h-0 min-w-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-rule px-3.5">
        <h2 className="text-xl font-semibold whitespace-nowrap text-ink">{title}</h2>
        <label className="ml-auto flex h-8 w-52 min-w-0 shrink items-center max-xl:hidden rounded-full border border-rule-2 bg-paper px-3 focus-within:border-accent-dim">
          <input value={own} onChange={(e) => setOwn(e.target.value)} placeholder="Search by ticker or name" aria-label={`Search ${title}`}
            className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
        </label>
        <div className="flex h-8 shrink-0 items-center gap-2 rounded-full border border-rule-2 bg-paper pr-1 pl-2.5 max-xl:ml-auto">
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
      </header>
      <div ref={scroller} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        {!loaded ? <p className="p-4 text-md text-muted">Loading…</p>
          : !mints.length ? <p className="p-4 text-md text-muted">{q || show !== "all" ? "Nothing matches the filter." : "Nothing here right now."}</p>
          : (
            <div className="relative" style={{ height: v.getTotalSize() }}>
              {v.getVirtualItems().map((it) => (
                <div key={it.key} className="absolute inset-x-0 top-0" style={{ height: ROW_H, transform: `translateY(${it.start}px)` }}>
                  <PulseRow mint={mints[it.index]} col={col} sol={+sol || 0.25} />
                </div>
              ))}
            </div>
          )}
      </div>
    </section>
  );
}

export function Pulse() {
  const globalQ = useUi((s) => s.q);
  const [show, setShowState] = useState<Show>(() => store.get<Show>("pulse:show", "noslop"));
  const setShow = (v: Show) => { store.set("pulse:show", v); setShowState(v); };
  return (
    <div className="flex h-full min-w-0 flex-col gap-3 px-3 pt-3 pb-2 max-md:h-auto">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl leading-none font-bold tracking-tight text-ink">Pulse</h1>
        <span className="flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper px-3 text-md font-medium text-ink" title="Blix is Solana only"><Sol className="size-3.5" />Solana</span>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-sm text-muted max-md:hidden">Display</span>
          <Segmented value={show} options={SHOW} onChange={setShow} label="Which coins to show" />
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[repeat(3,minmax(0,1fr))] divide-x divide-rule overflow-hidden rounded-card border border-rule bg-paper-2 max-md:grid-cols-[minmax(0,1fr)] max-md:divide-x-0 max-md:[&>section]:h-[75vh]">
        {SHOWN.map(([col]) => <Column key={col} col={col} show={show} globalQ={globalQ} />)}
      </div>
    </div>
  );
}
