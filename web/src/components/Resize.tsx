// Drag to resize: a thin handle on the edge of a box. Pull it and the box follows the pointer; let go and the size is
// kept in this browser; double-click puts it back to the page's own size. Used on the coin page's columns and chart.
import { useRef, useState, type PointerEvent as PE } from "react";
import { cn, store } from "@/lib/utils";

// A kept size in px (null = the page's own default), clamped to [min, max].
export function useSize(key: string, min: number, max: number) {
  const [size, setSize] = useState<number | null>(() => { const v = store.get<number | null>(`size:${key}`, null); return v == null ? null : Math.min(max, Math.max(min, v)); });
  const set = (v: number | null, keep = true) => {
    const n = v == null ? null : Math.round(Math.min(max, Math.max(min, v)));
    setSize(n);
    if (keep) store.set(`size:${key}`, n);
  };
  return [size, set] as const;
}

// `axis`: "x" resizes a width (a vertical bar), "y" a height (a horizontal bar). `dir`: 1 when pulling right or
// down makes the box bigger, -1 when pulling left or up does. `start()` reads the box's size when the drag begins.
export function ResizeHandle({ axis, dir = 1, start, onSize, onDone, onReset, className, label }: {
  axis: "x" | "y"; dir?: 1 | -1; start: () => number; onSize: (v: number) => void; onDone: () => void; onReset: () => void; className?: string; label: string;
}) {
  const drag = useRef<{ at: number; from: number } | null>(null);
  const [on, setOn] = useState(false);
  const down = (e: PE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { at: axis === "x" ? e.clientX : e.clientY, from: start() };
    e.currentTarget.setPointerCapture(e.pointerId);
    setOn(true);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  const move = (e: PE<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    onSize(d.from + ((axis === "x" ? e.clientX : e.clientY) - d.at) * dir);
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    setOn(false);
    document.body.style.cursor = ""; document.body.style.userSelect = "";
    onDone();
  };
  return (
    <div role="separator" aria-orientation={axis === "x" ? "vertical" : "horizontal"} aria-label={label} title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={onReset}
      className={cn("group absolute z-20 flex touch-none items-center justify-center max-lg:hidden",
        axis === "x" ? "top-0 bottom-0 w-2.5 cursor-col-resize" : "right-0 left-0 h-2.5 cursor-row-resize", className)}>
      <i className={cn("block rounded-full transition-[background-color,opacity,width,height] duration-150",
        axis === "x" ? "h-10 w-[3px]" : "h-[3px] w-10",
        on ? "bg-ink opacity-100" : "bg-ink-2 opacity-0 group-hover:opacity-70",
        on && (axis === "x" ? "h-16" : "w-16"))} />
    </div>
  );
}
