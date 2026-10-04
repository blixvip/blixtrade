import { cn } from "@/lib/utils";

// One choice out of a few, shown side by side. The selected one is raised; the rest sit flat.
export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: [V, string][]; onChange: (v: V) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-control border border-rule bg-paper p-0.5">
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={v === value} onClick={() => onChange(v)}
          className={cn("h-6 rounded-chip px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-100",
            v === value ? "chrome-fill font-semibold" : "text-muted hover:text-ink-2")}>
          {text}
        </button>
      ))}
    </div>
  );
}
