// Inside the Pulse settings window (PulseSettings.tsx), in a file of its own: it loads when the window first opens.
// Three tabs instead of one long scroll: Rug guard, Display, Filters. Every change applies at once.
import { useState, type ReactNode } from "react";
import { FILTER_KEYS, PREFS0, RUG_CHECKS, setPrefs, usePrefs, type PulseCol, type PulsePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

const SIZES: [number | "auto", string][] = [["auto", "Auto"], [0.9, "Small"], [1, "Normal"], [1.15, "Large"], [1.3, "Larger"]];
const COLS: [PulseCol, string, string][] = [["new", "New Pairs", "Just launched"], ["stretch", "Final Stretch", "Close to bonding"], ["migrated", "Migrated", "Trading in the pool"]];
type FilterKey = (typeof FILTER_KEYS)[number];
const FILTERS: [FilterKey, string, string][] = [
  ["minMcap", "Market cap min", "$"], ["maxMcap", "Market cap max", "$"], ["minVol", "Volume min", "$"], ["minHolders", "Holders min", ""],
  ["maxTop10", "Top 10 max", "%"], ["maxDev", "Dev holds max", "%"], ["maxAgeMin", "Age max", "min"],
];
type Tab = "rug" | "display" | "filters";

function Switch({ on }: { on: boolean }) {
  return (
    <i aria-hidden className={cn("relative block h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200",
      on ? "bg-up shadow-[0_0_12px_-2px_var(--color-up)]" : "bg-paper-5 shadow-[inset_0_0_0_1px_oklch(100%_0_0/0.06)]")}>
      <i className={cn("absolute top-[3px] block size-4 rounded-full bg-white shadow-[0_1px_3px_oklch(0%_0_0/0.4)] transition-[left] duration-200 ease-out", on ? "left-[19px]" : "left-[3px]")} />
    </i>
  );
}

// One switch row inside a grouped card.
function Row({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={cn("flex w-full items-center justify-between gap-4 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.025]", disabled && "opacity-45")}>
      <span className="min-w-0">
        <span className="block text-md font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-sm leading-snug text-muted">{hint}</span>}
      </span>
      <Switch on={on} />
    </button>
  );
}

function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title && <h3 className="flex items-center justify-between px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">{title}{aside}</h3>}
      <div className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06] bg-paper-3/60">{children}</div>
    </section>
  );
}

function Tabs({ tab, setTab, p }: { tab: Tab; setTab: (t: Tab) => void; p: PulsePrefs }) {
  const filters = FILTER_KEYS.filter((k) => p[k] != null).length + (p.socials ? 1 : 0);
  const checks = RUG_CHECKS.filter(([k]) => p.rugChecks[k]).length;
  const tabs: [Tab, string, string, ReactNode, ReactNode][] = [
    ["rug", "Rug guard", "Hide likely rugs", <Icon.shield className="size-4" />,
      <span className={cn("num rounded-full px-1.5 py-px text-[10px] font-bold", p.rug ? "bg-up/15 text-up" : "bg-white/[0.06] text-muted")}>{p.rug ? `${checks}/${RUG_CHECKS.length}` : "Off"}</span>],
    ["display", "Display", "Size, rows and columns", <Icon.sliders className="size-4" />, null],
    ["filters", "Filters", "Market cap, holders, age", <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>,
      filters ? <span className="num rounded-full bg-ink px-1.5 py-px text-[10px] font-bold text-on-fill">{filters}</span> : null],
  ];
  return (
    <div role="tablist" aria-orientation="vertical"
      className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.06] bg-paper p-1 md:flex md:flex-col md:gap-1.5 md:border-0 md:bg-transparent md:p-0">
      {tabs.map(([k, label, desc, icon, status]) => {
        const on = tab === k;
        return (
          <button key={k} role="tab" aria-selected={on} onClick={() => setTab(k)}
            className={cn("flex items-center gap-3 rounded-xl text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20",
              "max-md:h-9 max-md:justify-center max-md:gap-1.5 max-md:rounded-lg md:px-3 md:py-2.5",
              on ? "bg-paper-4 text-ink shadow-[0_1px_2px_oklch(0%_0_0/0.4),inset_0_1px_0_oklch(100%_0_0/0.06)]" : "text-muted hover:bg-white/[0.03] hover:text-ink-2")}>
            <span className={cn("grid shrink-0 place-items-center rounded-lg transition-colors md:size-9", on ? "md:bg-white/[0.08] md:text-ink" : "md:bg-white/[0.04]")}>{icon}</span>
            <span className="min-w-0 md:flex-1">
              <span className="block text-sm font-semibold md:text-md">{label}</span>
              <span className="block truncate text-xs text-muted max-md:hidden">{desc}</span>
            </span>
            {status && <span className="max-md:hidden">{status}</span>}
          </button>
        );
      })}
    </div>
  );
}

function RugTab({ p }: { p: PulsePrefs }) {
  const on = RUG_CHECKS.filter(([k]) => p.rugChecks[k]).length;
  return (
    <>
      <button role="switch" aria-checked={p.rug} onClick={() => setPrefs({ rug: !p.rug })}
        className={cn("relative flex items-center gap-3.5 overflow-hidden rounded-xl border p-3.5 text-left transition-colors duration-200",
          p.rug ? "border-up/30 bg-up/[0.07]" : "border-white/[0.06] bg-paper-3/60")}>
        {p.rug && <i aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_0%_0%,color-mix(in_oklch,var(--color-up)_16%,transparent),transparent_60%)]" />}
        <span className={cn("relative grid size-11 shrink-0 place-items-center rounded-xl transition-colors", p.rug ? "bg-up/15 text-up" : "bg-paper-5 text-muted")}>
          <Icon.shield className="size-5.5" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block text-md font-semibold text-ink">Hide likely rugs</span>
          <span className="mt-0.5 block text-sm leading-snug text-muted">{p.rug ? `${on} of ${RUG_CHECKS.length} checks on, in every column` : "Off: every coin shows"}</span>
        </span>
        <span className="relative"><Switch on={p.rug} /></span>
      </button>
      <section className="flex flex-col gap-2">
        <h3 className="flex items-center justify-between px-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Hide a coin when<span className="num normal-case tracking-normal">{on}/{RUG_CHECKS.length}</span></h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {RUG_CHECKS.map(([k, label, hint]) => {
            const lit = p.rugChecks[k];
            return (
              <button key={k} role="switch" aria-checked={lit} onClick={() => setPrefs({ rug: true, rugChecks: { ...p.rugChecks, [k]: !lit } })}
                className={cn("flex items-start justify-between gap-3 rounded-xl border p-3.5 text-left transition-colors duration-150",
                  lit && p.rug ? "border-up/25 bg-up/[0.05] hover:border-up/40" : "border-white/[0.06] bg-paper-3/50 hover:border-white/15",
                  !p.rug && "opacity-50 hover:opacity-80")}>
                <span className="min-w-0">
                  <span className="block text-md font-medium text-ink">{label}</span>
                  <span className="mt-1 block text-sm leading-snug text-muted">{hint}</span>
                </span>
                <span className="mt-0.5"><Switch on={lit} /></span>
              </button>
            );
          })}
        </div>
      </section>
      <p className="px-1 text-sm text-muted">Searching a ticker or contract still finds a hidden coin.</p>
    </>
  );
}

function DisplayTab({ p }: { p: PulsePrefs }) {
  const openCols = COLS.filter(([c]) => p.cols[c]).length;
  return (
    <>
      <Card title="Size">
        <div className="grid grid-cols-5 gap-1.5 p-2">
          {SIZES.map(([v, label]) => { const on = v === "auto" ? p.autoScale : !p.autoScale && p.scale === v; return (
            <button key={String(v)} role="radio" aria-checked={on} onClick={() => (v === "auto" ? setPrefs({ autoScale: true }) : setPrefs({ autoScale: false, scale: v }))}
              className={cn("flex flex-col items-center gap-1 rounded-lg border py-2.5 transition-colors duration-150",
                on ? "border-white/20 bg-paper-5 text-ink shadow-[inset_0_1px_0_oklch(100%_0_0/0.08)]" : "border-transparent text-muted hover:bg-white/[0.03] hover:text-ink-2")}>
              <span className="leading-none font-semibold" style={{ fontSize: `${Math.round(13 * (v === "auto" ? p.fit : v))}px` }}>Aa</span>
              <span className="text-xs">{v === "auto" ? `Auto ${Math.round(p.fit * 100)}%` : label}</span>
            </button>
          ); })}
        </div>
        <Row on={p.compact} onChange={(v) => setPrefs({ compact: v })} label="Compact rows" hint="More coins on screen: no note line, no contract under the picture" />
      </Card>
      <Card title="On each row">
        <Row on={p.pills} onChange={(v) => setPrefs({ pills: v })} label="Audit pills" hint="Top 10, dev, snipers, bundle" />
        <Row on={p.buy} onChange={(v) => setPrefs({ buy: v })} label="Quick-buy button" hint="Buy straight from the list" />
      </Card>
      <Card title="Columns">
        <div className="grid grid-cols-3 gap-1.5 p-2">
          {COLS.map(([c, label, hint]) => {
            const on = p.cols[c], last = on && openCols <= 1;
            return (
              <button key={c} role="switch" aria-checked={on} disabled={last} title={last ? "At least one column stays open" : undefined}
                onClick={() => setPrefs({ cols: { ...p.cols, [c]: !on } })}
                className={cn("relative flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left transition-colors duration-150",
                  on ? "border-up/35 bg-up/[0.08]" : "border-white/[0.06] hover:border-white/15", last && "cursor-not-allowed")}>
                <span className={cn("absolute top-2 right-2 grid size-4 place-items-center rounded-full transition-colors", on ? "bg-up text-paper-2" : "shadow-[inset_0_0_0_1.5px_var(--color-paper-5)]")}>
                  {on && <svg viewBox="0 0 24 24" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                </span>
                <span className={cn("pr-5 text-sm font-semibold", on ? "text-ink" : "text-ink-2")}>{label}</span>
                <span className="text-xs leading-snug text-muted">{hint}</span>
              </button>
            );
          })}
        </div>
      </Card>
    </>
  );
}

function Limit({ k, label, unit, p }: { k: FilterKey; label: string; unit: string; p: PulsePrefs }) {
  const [text, setText] = useState(p[k] == null ? "" : String(p[k]));
  const change = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setText(clean);
    setPrefs({ [k]: clean && Number.isFinite(+clean) ? +clean : null });
  };
  const set = p[k] != null;
  return (
    <label className="flex flex-col gap-1.5">
      <span className={cn("px-0.5 text-xs font-medium", set ? "text-ink-2" : "text-muted")}>{label}</span>
      <span className={cn("flex h-9 items-center gap-1 rounded-lg border bg-paper px-2.5 transition-colors duration-150 focus-within:border-white/30 focus-within:bg-paper-2",
        set ? "border-up/35" : "border-white/[0.08] hover:border-white/15")}>
        {unit === "$" && <span className="text-sm text-muted">$</span>}
        <input value={set ? text : ""} onChange={(e) => change(e.target.value)} inputMode="decimal" placeholder="Any" className="num min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted/60" />
        {unit && unit !== "$" && <span className="text-sm text-muted">{unit}</span>}
        {set && <button type="button" aria-label={`Clear ${label}`} onClick={(e) => { e.preventDefault(); setText(""); setPrefs({ [k]: null }); }} className="-mr-1 grid size-5 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-ink">×</button>}
      </span>
    </label>
  );
}

function FiltersTab({ p }: { p: PulsePrefs }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
        {FILTERS.map(([k, label, unit]) => <Limit key={k} k={k} label={label} unit={unit} p={p} />)}
      </div>
      <Card>
        <Row on={p.socials} onChange={(v) => setPrefs({ socials: v })} label="Only coins with socials" hint="An X post, a website or a Telegram" />
      </Card>
      <p className="px-1 text-sm text-muted">Searching a ticker or contract ignores the filters.</p>
    </>
  );
}

export function SettingsPanel({ onDone }: { onDone?: () => void }) {
  const p = usePrefs();
  const [tab, setTab] = useState<Tab>("rug");
  return (
    <div className="flex min-h-0 flex-col gap-5">
      <div className="grid min-h-0 gap-4 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-6">
        <Tabs tab={tab} setTab={setTab} p={p} />
        <div key={tab} className="-mr-2 flex h-[min(62dvh,560px)] animate-row-in flex-col gap-4 overflow-y-auto pr-2 [scrollbar-gutter:stable] [scrollbar-width:thin] [&>*]:shrink-0">
          {tab === "rug" ? <RugTab p={p} /> : tab === "display" ? <DisplayTab p={p} /> : <FiltersTab p={p} />}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] pt-5">
        <button onClick={() => setPrefs(PREFS0)} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-white/[0.05] hover:text-ink">
          <Icon.refresh className="size-3.5" />Reset to defaults
        </button>
        {onDone && <button onClick={onDone} className="h-10 rounded-full bg-ink px-7 text-md font-semibold text-paper shadow-[0_4px_14px_-4px_oklch(100%_0_0/0.25)] transition-transform hover:bg-white active:scale-[0.97]">Done</button>}
      </div>
    </div>
  );
}
