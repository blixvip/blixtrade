import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A small switch between a few values (5m / 1h / 24h). The lit thumb slides to the chosen one.
export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: [V, string][]; onChange: (v: V) => void; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const at = options.findIndex(([v]) => v === value);
  useLayoutEffect(() => {
    const b = box.current?.children[at + 1] as HTMLElement | undefined;
    setThumb(b ? { x: b.offsetLeft, w: b.offsetWidth } : null);
  }, [at, options.length, options.map(([, t]) => t).join()]);
  return (
    <div ref={box} role="radiogroup" aria-label={label} className="relative inline-flex h-8 items-center rounded-lg bg-paper-3/60 p-[3px] ring-1 ring-rule ring-inset">
      <span aria-hidden className={cn("absolute top-[3px] bottom-[3px] rounded-md bg-paper-5 shadow-[0_1px_2px_oklch(0%_0_0/0.35),inset_0_1px_0_oklch(100%_0_0/0.06)] transition-[left,width] duration-200 ease-out", !thumb && "opacity-0")}
        style={thumb ? { left: thumb.x, width: thumb.w } : undefined} />
      {options.map(([v, text]) => (
        <button key={v} role="radio" aria-checked={v === value} onClick={() => onChange(v)}
          className={cn("num relative h-full rounded-md px-3 text-sm whitespace-nowrap transition-colors duration-150",
            v === value ? "font-semibold text-ink" : "font-medium text-muted hover:text-ink-2")}>
          {text}
        </button>
      ))}
    </div>
  );
}
