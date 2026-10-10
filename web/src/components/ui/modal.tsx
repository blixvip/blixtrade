// The few parts of a modal window Blix uses (Root, Portal, Overlay, Content, Title, Close), without a dialog
// library: the Radix dialog it replaces brought ~45 KB of source (focus scope, scroll lock, aria-hidden, tslib)
// into every page's first download. Same behaviour where it matters: opens over the page, Escape or a click on
// the dim layer closes it, the first text box (else the first button) gets focus, Tab stays inside, the page
// under it does not scroll, and focus goes back where it was when it closes.
import { createContext, useContext, useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";

const Ctx = createContext<{ open: boolean; close: () => void; titleId: string }>({ open: false, close: () => {}, titleId: "" });

export function Root({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const titleId = useId();
  return <Ctx.Provider value={{ open, close: () => onOpenChange(false), titleId }}>{children}</Ctx.Provider>;
}

export function Portal({ children }: { children: ReactNode }) {
  const { open } = useContext(Ctx);
  return open ? createPortal(children, document.body) : null;
}

export function Overlay({ className }: { className?: string }) {
  const { close } = useContext(Ctx);
  return <div aria-hidden className={className} onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }} />;
}

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex='-1'])";
let locks = 0;

export function Content({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const { close, titleId } = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = ref.current!, before = document.activeElement as HTMLElement | null;
    // A text box gets focus at once; otherwise the window itself does (Tab then reaches its first control), so no
    // button opens wearing a keyboard focus ring the person never asked for.
    (box.querySelector<HTMLElement>("input:not([disabled]),textarea") || box).focus({ preventScroll: true });
    if (!locks++) document.documentElement.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); return; }
      if (e.key !== "Tab") return;
      const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!all.length) { e.preventDefault(); return; }
      const first = all[0], last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      if (!--locks) document.documentElement.style.overflow = "";
      before?.focus?.({ preventScroll: true });
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} {...rest} className={className} style={{ outline: "none", ...rest.style }}>{children}</div>;
}

export function Title({ className, children }: { className?: string; children: ReactNode }) {
  const { titleId } = useContext(Ctx);
  return <h2 id={titleId} className={className}>{children}</h2>;
}

export function Close({ onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { close } = useContext(Ctx);
  return <button type="button" {...rest} onClick={(e) => { onClick?.(e); if (!e.defaultPrevented) close(); }} />;
}
