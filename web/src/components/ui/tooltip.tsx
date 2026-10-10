// Hints on hover or focus, without a tooltip library: one hint card for the whole app (TooltipProvider renders it),
// and Tip only adds pointer and focus handlers to its child. The Radix tooltip it replaces brought ~100 KB of
// source (floating-ui, popper, portal) into every page's first download; this is a few hundred bytes, and a
// board with ~1,000 hints mounts nothing extra per hint.
// Every plain `title` attribute in the app shows in the same card too (the browser's own grey box looked out of
// place): on first hover the title moves to data-tip, so the browser has nothing to draw, and the card shows it.
// A hint reading "Label: details" gets the label as a heading. 350 ms to show, 120 ms when moving from one hint to
// the next, placed on the asked side and flipped or nudged to stay on screen, with a small arrow at its anchor.
import { cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { create } from "zustand";

type Side = "top" | "right" | "bottom" | "left";
interface On { tip: ReactNode; rect: DOMRect; side: Side; id: number }
const useHint = create<{ on: On | null }>(() => ({ on: null }));
const DELAY = 350, SKIP = 120, GAP = 8, EDGE = 8;
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
    onPointerEnter: (e) => { p.onPointerEnter?.(e); if (e.pointerType === "mouse") { e.currentTarget.setAttribute("data-tipped", ""); show(e.currentTarget, tip, side); } },
    onPointerLeave: (e) => { p.onPointerLeave?.(e); hide(); },
    onPointerDown: (e) => { p.onPointerDown?.(e); hide(); },
    onFocus: (e) => { p.onFocus?.(e); if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, tip, side); },
    onBlur: (e) => { p.onBlur?.(e); hide(); },
  });
}

// "Last 5 minutes: 21 trades by 19 wallets" → a heading and its details. Only for a short label before the first
// colon (so times, links and sentences with a colon later on stay as they are).
function Body({ tip }: { tip: ReactNode }) {
  if (typeof tip === "string") {
    const m = tip.match(/^([^:\n]{2,30}):\s+([\s\S]+)$/);
    if (m && !/https?$|\d$/.test(m[1])) return (
      <span className="flex flex-col gap-0.5">
        <b className="text-[11px] font-semibold tracking-[0.02em] text-muted uppercase">{m[1]}</b>
        <span className="text-ink">{m[2]}</span>
      </span>
    );
    return <span className="text-ink">{tip}</span>;
  }
  return <>{tip}</>;
}

function Hint({ on }: { on: On }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; side: Side; arrow: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current!.getBoundingClientRect(), r = on.rect, W = innerWidth, H = innerHeight;
    const at = (s: Side) => s === "top" ? { x: r.left + r.width / 2 - box.width / 2, y: r.top - GAP - box.height }
      : s === "bottom" ? { x: r.left + r.width / 2 - box.width / 2, y: r.bottom + GAP }
      : s === "left" ? { x: r.left - GAP - box.width, y: r.top + r.height / 2 - box.height / 2 }
      : { x: r.right + GAP, y: r.top + r.height / 2 - box.height / 2 };
    const fits = (q: { x: number; y: number }) => q.x >= EDGE && q.y >= EDGE && q.x + box.width <= W - EDGE && q.y + box.height <= H - EDGE;
    const flip: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
    let side = on.side, q = at(side);
    if (!fits(q) && fits(at(flip[side]))) { side = flip[side]; q = at(side); }
    const x = Math.max(EDGE, Math.min(q.x, W - EDGE - box.width)), y = Math.max(EDGE, Math.min(q.y, H - EDGE - box.height));
    // The arrow points at the middle of what was hovered, kept inside the card's rounded corners.
    const arrow = side === "top" || side === "bottom" ? Math.max(12, Math.min(r.left + r.width / 2 - x, box.width - 12)) : Math.max(10, Math.min(r.top + r.height / 2 - y, box.height - 10));
    setPos({ x, y, side, arrow });
  }, [on]);
  const s = pos?.side ?? on.side;
  const arrowAt = s === "top" ? { left: pos?.arrow, bottom: -4.5 } : s === "bottom" ? { left: pos?.arrow, top: -4.5 } : s === "left" ? { top: pos?.arrow, right: -4.5 } : { top: pos?.arrow, left: -4.5 };
  const edge = s === "top" ? "border-r border-b" : s === "bottom" ? "border-l border-t" : s === "left" ? "border-t border-r" : "border-b border-l";
  return (
    <div ref={ref} role="tooltip" data-side={s} style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
      className={`pointer-events-none fixed z-[80] max-w-[17rem] rounded-[10px] border border-white/[0.09] bg-paper-3/95 px-3 py-2 text-[12.5px] leading-[1.45] font-medium shadow-[0_12px_32px_-8px_oklch(0%_0_0/0.7),0_2px_6px_oklch(0%_0_0/0.35),inset_0_1px_0_oklch(100%_0_0/0.05)] backdrop-blur-md [overflow-wrap:anywhere] ${pos ? "motion-safe:animate-[tip-in_140ms_ease-out]" : ""}`}>
      <Body tip={on.tip} />
      <i aria-hidden style={{ ...arrowAt, marginLeft: s === "top" || s === "bottom" ? -4.5 : undefined, marginTop: s === "left" || s === "right" ? -4.5 : undefined }}
        className={`absolute size-[9px] rotate-45 border-white/[0.09] bg-paper-3 ${edge}`} />
    </div>
  );
}

function Layer() {
  const on = useHint((s) => s.on);
  useEffect(() => {
    // Anything that moves the page or leaves it puts the hint away.
    addEventListener("scroll", hide, true); addEventListener("blur", hide); addEventListener("hashchange", hide);
    // Plain title attributes: shown in the hint card instead of the browser's box.
    let cur: Element | null = null;
    const over = (e: globalThis.PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element | null)?.closest?.("[title],[data-tip]");
      if (!el || el === cur || el.hasAttribute("data-tipped")) return;
      const t = el.getAttribute("title");
      if (t != null) {
        el.removeAttribute("title");
        if (t) {
          el.setAttribute("data-tip", t);
          if (!el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", t);
        }
      }
      const tip = el.getAttribute("data-tip");
      if (!tip) return;
      cur = el;
      show(el, tip, "top");
    };
    const out = (e: globalThis.PointerEvent) => {
      if (!cur || (e.relatedTarget instanceof Node && cur.contains(e.relatedTarget))) return;
      cur = null; hide();
    };
    const down = () => { if (cur) { cur = null; hide(); } };
    document.addEventListener("pointerover", over); document.addEventListener("pointerout", out); document.addEventListener("pointerdown", down, true);
    return () => {
      removeEventListener("scroll", hide, true); removeEventListener("blur", hide); removeEventListener("hashchange", hide);
      document.removeEventListener("pointerover", over); document.removeEventListener("pointerout", out); document.removeEventListener("pointerdown", down, true);
    };
  }, []);
  return on ? <Hint key={on.id} on={on} /> : null;
}

export const TooltipProvider = ({ children }: { children: ReactNode }) => <>{children}<Layer /></>;
