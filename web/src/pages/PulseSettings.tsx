import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { filterCount, FILTER_KEYS, PREFS0, setPrefs, usePrefs, type PulseCol, type PulsePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

// The Pulse settings window: size, what a row shows, which columns are open, and filters. Every change
// applies at once and is remembered in this browser.
const SIZES: [string, string][] = [["0.9", "Small"], ["1", "Normal"], ["1.15", "Large"], ["1.3", "Larger"]];
const COLS: [PulseCol, string][] = [["new", "New Pairs"], ["stretch", "Final Stretch"], ["migrated", "Migrated"]];
type FilterKey = (typeof FILTER_KEYS)[number];
const FILTERS: [FilterKey, string, string][] = [
  ["minMcap", "Market cap at least", "$"], ["maxMcap", "Market cap at most", "$"], ["minVol", "Volume at least", "$"], ["minHolders", "Holders at least", ""],
  ["maxTop10", "Top 10 hold at most", "%"], ["maxDev", "Dev holds at most", "%"], ["maxAgeMin", "Age at most", "min"],
];

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full items-center justify-between gap-3 py-1.5 text-left">
      <span className="min-w-0"><span className="block text-md font-medium text-ink">{label}</span>{hint && <span className="block text-sm text-muted">{hint}</span>}</span>
      <i className={cn("relative block h-5 w-9 shrink-0 rounded-full transition-colors duration-100", on ? "bg-ink" : "bg-paper-5")}>
        <i className={cn("absolute top-0.5 block size-4 rounded-full bg-paper transition-[left] duration-100", on ? "left-4.5" : "left-0.5")} />
      </i>
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-1 border-t border-rule pt-3"><h3 className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase">{title}</h3>{children}</section>;
}

function Limit({ k, label, unit, p }: { k: FilterKey; label: string; unit: string; p: PulsePrefs }) {
  const [text, setText] = useState(p[k] == null ? "" : String(p[k]));
  const change = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setText(clean);
    setPrefs({ [k]: clean && Number.isFinite(+clean) ? +clean : null });
  };
  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="text-md text-ink">{label}</span>
      <span className="flex h-8 w-32 items-center gap-1 rounded-control border border-rule-2 bg-paper px-2.5 focus-within:border-accent-dim">
        {unit === "$" && <span className="text-sm text-muted">$</span>}
        <input value={p[k] == null ? "" : text} onChange={(e) => change(e.target.value)} inputMode="decimal" placeholder="any" className="num min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
        {unit && unit !== "$" && <span className="text-sm text-muted">{unit}</span>}
      </span>
    </label>
  );
}

export function PulseSettings() {
  const [open, setOpen] = useState(false);
  const p = usePrefs(), n = filterCount(p);
  const openCols = COLS.filter(([c]) => p.cols[c]).length;
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Pulse settings" className="flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper px-3 text-md font-medium text-ink transition-colors duration-100 hover:border-muted">
        <Icon.settings className="size-4 text-muted" />Settings
        {n > 0 && <em className="num rounded-full bg-ink px-1.5 text-xs font-semibold text-on-fill not-italic">{n}</em>}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Pulse settings">
        <div className="-mr-2 flex max-h-[70dvh] flex-col gap-3 overflow-y-auto pr-2">
          <Group title="Size">
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-md font-medium text-ink">Text and rows</span>
              <Segmented value={String(p.scale)} options={SIZES} onChange={(v) => setPrefs({ scale: +v })} label="Size of the whole page" />
            </div>
            <Toggle on={p.compact} onChange={(v) => setPrefs({ compact: v })} label="Compact rows" hint="More coins on screen: no note line, no contract under the picture" />
          </Group>
          <Group title="On each row">
            <Toggle on={p.pills} onChange={(v) => setPrefs({ pills: v })} label="Audit pills" hint="Top 10, dev, snipers, bundle" />
            <Toggle on={p.buy} onChange={(v) => setPrefs({ buy: v })} label="Quick-buy button" />
          </Group>
          <Group title="Columns">
            {COLS.map(([c, label]) => (
              <Toggle key={c} on={p.cols[c]} label={label} onChange={(v) => { if (v || openCols > 1) setPrefs({ cols: { ...p.cols, [c]: v } }); }} />
            ))}
          </Group>
          <Group title="Filters">
            {FILTERS.map(([k, label, unit]) => <Limit key={k} k={k} label={label} unit={unit} p={p} />)}
            <Toggle on={p.socials} onChange={(v) => setPrefs({ socials: v })} label="Only coins with socials" hint="An X post, a website or a Telegram" />
            <p className="text-sm text-muted">Searching a ticker or contract ignores the filters.</p>
          </Group>
          <div className="flex justify-end border-t border-rule pt-3">
            <button onClick={() => setPrefs(PREFS0)} className="h-8 rounded-full border border-rule-2 px-3 text-md font-medium text-ink-2 hover:border-muted hover:text-ink">Reset to defaults</button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
