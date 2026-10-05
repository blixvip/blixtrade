// The pieces of Axiom-style filter sheets (Discover, Pulse columns): a text box, tick boxes and min/max rows.
// Filters are strings as typed ("1" for a ticked box), so a sheet can be saved, exported and imported as is.
import { cn } from "@/lib/utils";

export type Filters = Record<string, string>;
// [label, min key, max key, unit]; a missing key means that end has no box.
export type Range = [string, string | null, string | null, string];
export const isSet = (v?: string) => v !== undefined && v !== "";

export function Text({ label, hint, value, onChange, placeholder }: { label: string; hint: string; value?: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1" title={hint}>
      <span className="label">{label}</span>
      <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="h-8 rounded-control border border-rule-2 bg-paper px-2 text-md text-ink outline-none placeholder:text-muted focus:border-accent-dim" />
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
            className={cn("flex h-8 items-center gap-2 rounded-control border px-3 text-md transition-colors", on ? "border-ink/50 bg-paper-4 text-ink" : "border-rule-2 text-ink-2 hover:text-ink")}>
            <span className={cn("grid size-4 place-items-center rounded-[4px] border", on ? "border-ink bg-ink text-paper" : "border-rule-2")}>
              {on && <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Ranges({ items, draft, put, note }: { items: Range[]; draft: Filters; put: (k: string, v: string) => void; note?: string }) {
  const box = (k: string | null, unit: string, ph: string) => k == null ? null : (
    <span className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-control border border-rule-2 bg-paper px-2 focus-within:border-accent-dim">
      {unit === "$" && <span className="text-muted">$</span>}
      <input inputMode="decimal" value={draft[k] ?? ""} placeholder={ph} aria-label={`${k}`} onChange={(e) => put(k, e.target.value.replace(/[^\d.]/g, ""))}
        className="num min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
      {unit && unit !== "$" && <span className="text-sm text-muted">{unit}</span>}
    </span>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-x-6 gap-y-2.5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {items.map(([label, a, b, unit]) => (
          <div key={label} className="flex flex-col gap-1">
            <span className="label">{label}</span>
            <span className="flex items-center gap-2">{a && b ? <>{box(a, unit, "Min")}<span className="text-muted">–</span>{box(b, unit, "Max")}</> : box(a ?? b, unit, a ? "Min" : "Max")}</span>
          </div>
        ))}
      </div>
      {note && <p className="text-sm text-muted">{note}</p>}
    </div>
  );
}
