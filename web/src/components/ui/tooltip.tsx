// Hints on hover or focus, without a tooltip library: one hint box for the whole app (TooltipProvider renders it),
// and Tip only adds pointer and focus handlers to its child. The Radix tooltip it replaces brought ~100 KB of
// source (floating-ui, popper, portal) into every page's first download; this is a few hundred bytes, and a
// board with ~1,000 hints mounts nothing extra per hint.
// Same behaviour as before: 600 ms to show, 200 ms when moving from one hint to the next, placed on the asked
// side and flipped or nudged to stay on screen.
import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { create } from "zustand";

type Side = "top" | "right" | "bottom" | "left";
interface On { tip: ReactNode; rect: DOMRect; side: Side; id: number }
const useHint = create<{ on: On | null }>(() => ({ on: null }));
const DELAY = 600, SKIP = 200, GAP = 6, EDGE = 8;
let timer = 0, lastHidden = 0, seq = 0;

function show(el: Element, tip: ReactNode, side: Side) {
  clearTimeout(timer);
  const wait = useHint.getState().on || performance.now() - lastHidden < 300 ? SKIP : DELAY;
  timer = window.setTimeout(() => { if (el.isConnected) useHint.setState({ on: { tip, rect: el.getBoundingClientRect(), side, id: ++seq } }); }, wait);
}
function hide() { clearTimeout(timer); if (useHint.getState().on) { lastHidden = performance.now(); useHint.setState({ on: null }); } }

// A hint on hover or focus. `tip` empty = no tooltip, the child renders as is. The child must take pointer and
// focus handlers (a DOM element, or a component that passes them on), as with the Radix version.
export function Tip({ tip, children, side = "top" }: { tip?: ReactNode; children: ReactNode; side?: Side }) {
  if (!tip || !isValidElement(children)) return <>{children}</>;
  type H = { onPointerEnter?: (e: PointerEvent<Element>) => void; onPointerLeave?: (e: PointerEvent<Element>) => void; onFocus?: (e: FocusEvent<Element>) => void; onBlur?: (e: FocusEvent<Element>) => void; onPointerDown?: (e: PointerEvent<Element>) => void };
  const el = children as ReactElement<H>, p = el.props;
  return cloneElement(el, {
    onPointerEnter: (e) => { p.onPointerEnter?.(e); if (e.pointerType === "mouse") show(e.currentTarget, tip, side); },
    onPointerLeave: (e) => { p.onPointerLeave?.(e); hide(); },
    onPointerDown: (e) => { p.onPointerDown?.(e); hide(); },
    onFocus: (e) => { p.onFocus?.(e); if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, tip, side); },
    onBlur: (e) => { p.onBlur?.(e); hide(); },
  });
}

function Hint({ on }: { on: On }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current!.getBoundingClientRect(), r = on.rect, W = innerWidth, H = innerHeight;
    const at = (s: Side) => s === "top" ? { x: r.left + r.width / 2 - box.width / 2, y: r.top - GAP - box.height }
      : s === "bottom" ? { x: r.left + r.width / 2 - box.width / 2, y: r.bottom + GAP }
      : s === "left" ? { x: r.left - GAP - box.width, y: r.top + r.height / 2 - box.height / 2 }
      : { x: r.right + GAP, y: r.top + r.height / 2 - box.height / 2 };
    const fits = (q: { x: number; y: number }) => q.x >= EDGE && q.y >= EDGE && q.x + box.width <= W - EDGE && q.y + box.height <= H - EDGE;
    const flip: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
    let q = at(on.side);
    if (!fits(q) && fits(at(flip[on.side]))) q = at(flip[on.side]);
    setPos({ x: Math.max(EDGE, Math.min(q.x, W - EDGE - box.width)), y: Math.max(EDGE, Math.min(q.y, H - EDGE - box.height)) });
  }, [on]);
  return (
    <div ref={ref} role="tooltip" style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
      className="pointer-events-none fixed z-[80] max-w-72 rounded-control border border-rule-2 bg-paper-4 px-2 py-1.5 text-xs leading-snug text-ink-2 shadow-sheet">
      {on.tip}
    </div>
  );
}

function Layer() {
  const on = useHint((s) => s.on);
  useEffect(() => {
    // Anything that moves the page or leaves it puts the hint away.
    addEventListener("scroll", hide, true); addEventListener("blur", hide); addEventListener("hashchange", hide);
    return () => { removeEventListener("scroll", hide, true); removeEventListener("blur", hide); removeEventListener("hashchange", hide); };
  }, []);
  return on ? <Hint key={on.id} on={on} /> : null;
}

export const TooltipProvider = ({ children }: { children: ReactNode }) => <>{children}<Layer /></>;
