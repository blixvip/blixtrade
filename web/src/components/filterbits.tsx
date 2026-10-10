// The pieces of Axiom-style filter sheets (Discover, Pulse columns): a text box, tick boxes and min/max rows.
// Filters are strings as typed ("1" for a ticked box), so a sheet can be saved, exported and imported as is.
import { cn } from "@/lib/utils";

export type Filters = Record<string, string>;
// [label, min key, max key, unit]; a missing key means that end has no box.
export type Range = [string, string | null, string | null, string];
export const isSet = (v?: string) => v !== undefined && v !== "";

// Field look shared by the sheets: a quiet filled box that lights its ring on focus.
const FIELD = "rounded-lg bg-paper-3/50 ring-1 ring-rule ring-inset transition-[box-shadow,background-color] duration-150 hover:bg-paper-3/80 focus-within:bg-paper-3/80 focus-within:ring-ink/35";
export const fieldLabel = "text-xs font-medium text-ink-2";

export function Text({ label, hint, value, onChange, placeholder }: { label: string; hint: string; value?: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1.5" title={hint}>
      <span className={fieldLabel}>{label}</span>
      <span className={cn("flex h-9 items-center px-3", FIELD)}>
        <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted/70" />
      </span>
    </label>
  );
}

export function Checks({ items, draft, put }: { items: [string, string][]; draft: Filters; put: (k: string, v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([k, label]) => {
        const on = draft[k] === "1";
        return (
          <button key={k} role="checkbox" aria-checked={on} onClick={() => put(k, on ? "" : "1")}
            className={cn("flex h-8 items-center gap-2 rounded-lg pr-3 pl-2.5 text-sm font-medium ring-1 ring-inset transition-colors duration-150",
              on ? "bg-ink/[0.07] text-ink ring-ink/30" : "bg-paper-3/40 text-ink-2 ring-rule hover:bg-paper-3/80 hover:text-ink")}>
            <span className={cn("grid size-4 place-items-center rounded-[5px] transition-colors duration-150", on ? "bg-ink text-paper" : "ring-1 ring-rule-2 ring-inset")}>
              {on && <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

// One field per range: "Min | Max" in a single box, split by a hairline, the unit after each number.
export function Ranges({ items, draft, put, note }: { items: Range[]; draft: Filters; put: (k: string, v: string) => void; note?: string }) {
  const box = (k: string | null, unit: string, ph: string, label: string) => k == null ? null : (
    <span className="flex h-full min-w-0 flex-1 items-center gap-1 px-3">
      {unit === "$" && <span className="text-sm text-muted">$</span>}
      <input inputMode="decimal" value={draft[k] ?? ""} placeholder={ph} aria-label={`${label} ${ph.toLowerCase()}`} onChange={(e) => put(k, e.target.value.replace(/[^\d.]/g, ""))}
        className="num min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted/70" />
      {unit && unit !== "$" && <span className="text-xs text-muted">{unit}</span>}
    </span>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-x-4 gap-y-3.5 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
        {items.map(([label, a, b, unit]) => (
          <div key={label} className="flex min-w-0 flex-col gap-1.5">
            <span className={fieldLabel}>{label}</span>
            <span className={cn("flex h-9 items-center", FIELD)}>
              {a && b ? <>{box(a, unit, "Min", label)}<span aria-hidden className="h-4 w-px shrink-0 bg-rule-2" />{box(b, unit, "Max", label)}</> : box(a ?? b, unit, a ? "Min" : "Max", label)}
            </span>
          </div>
        ))}
      </div>
      {note && <p className="text-sm text-muted">{note}</p>}
    </div>
  );
}
