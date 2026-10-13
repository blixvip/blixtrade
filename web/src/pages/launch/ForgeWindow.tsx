// The Forge (forge/, the photo editor) as a window over the Create coin page, made to feel like a desktop window:
//  - it opens out of the button that opened it and closes or tucks away back into it (or into its pill);
//  - drag it by its title bar; drag it to the top of the screen to fill it, to the left or right edge for half the
//    screen (a soft preview shows where it will land); drag a filled window down and it comes back as a window;
//  - resize it from any edge or corner; double-click the title bar to fill the screen or come back;
//  - the coloured dots work like a desktop's: close, tuck away to a pill at the bottom, fill the screen;
//  - a loading screen until the editor inside says it is up (forge-ready, `ready`).
// Size, place and whether it fills the screen are kept in this browser. The page behind stays usable. The frame is
// never unmounted once opened, so the work in it survives closing and reopening. While moving or resizing, a clear
// layer covers the frame so the pointer is not lost into it, and the size changes without animation (it follows the
// hand); changes that are not the hand's (fill, restore, snap) glide.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as PE, type ReactNode, type RefObject } from "react";
import { Icon } from "@/shell/icons";
import { cn, store } from "@/lib/utils";

type Rect = { x: number; y: number; w: number; h: number };
type Mode = "open" | "min" | "max";
type Snap = "max" | "left" | "right" | null;
const KEY = "forge:win";
const MIN_W = 640, MIN_H = 440, SNAP_PX = 14, GLIDE_MS = 260;
const EASE = "cubic-bezier(.22,.9,.24,1)";
// Someone who has turned animations off gets every change at once.
const calm = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const fits = (r: Rect): Rect => {
  const W = innerWidth, H = innerHeight;
  const w = Math.min(Math.max(MIN_W, r.w), W - 16), h = Math.min(Math.max(MIN_H, r.h), H - 16);
  return { w, h, x: Math.min(Math.max(8, r.x), W - w - 8), y: Math.min(Math.max(8, r.y), H - h - 8) };
};
const first = (): Rect => {
  const w = Math.min(1180, Math.round(innerWidth * 0.82)), h = Math.min(800, Math.round(innerHeight * 0.84));
  return fits({ w, h, x: Math.round((innerWidth - w) / 2), y: Math.round((innerHeight - h) / 2) });
};
const snapRect = (s: Exclude<Snap, null>): Rect => {
  const W = innerWidth, H = innerHeight, g = 8;
  if (s === "left") return { x: g, y: g, w: Math.round(W / 2) - g * 1.5, h: H - g * 2 };
  if (s === "right") return { x: Math.round(W / 2) + g / 2, y: g, w: Math.round(W / 2) - g * 1.5, h: H - g * 2 };
  return { x: 0, y: 0, w: W, h: H };
};

type Drag = { kind: string; sx: number; sy: number; r: Rect };

export function ForgeWindow({ shown, onClose, frameRef, ready, origin, title = "The Forge", hint }: {
  shown: boolean; onClose: () => void; frameRef: RefObject<HTMLIFrameElement | null>; ready: boolean;
  origin?: { x: number; y: number } | null; title?: string; hint?: ReactNode;
}) {
  const [rect, setRect] = useState<Rect>(() => { const k = store.get<Rect | null>(KEY, null); return k ? fits(k) : first(); });
  const [mode, setModeState] = useState<Mode>(() => (store.get<Mode>(`${KEY}:mode`, "open") === "max" ? "max" : "open"));
  const [glide, setGlide] = useState(false);   // geometry changes animate (not while the hand moves it)
  const glideT = useRef(0);
  const glideOnce = () => { setGlide(true); clearTimeout(glideT.current); glideT.current = window.setTimeout(() => setGlide(false), GLIDE_MS + 40); };
  const setMode = (m: Mode) => { if (m !== "min") { glideOnce(); store.set(`${KEY}:mode`, m); } setModeState(m); };
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState<"move" | "size" | null>(null);
  const [snap, setSnap] = useState<Snap>(null);

  // In and out: `on` is what is wanted; `live` keeps the window drawn while it animates out.
  const on = shown && mode !== "min";
  const [live, setLive] = useState(on);
  const [entered, setEntered] = useState(false);
  useLayoutEffect(() => {
    if (on) { setLive(true); const f = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true))); return () => cancelAnimationFrame(f); }
    setEntered(false);
    const t = setTimeout(() => setLive(false), 240);
    return () => clearTimeout(t);
  }, [on]);
  // Opening again brings a tucked-away window back.
  useEffect(() => { if (shown && mode === "min") setModeState("open"); }, [shown]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const f = () => setRect((r) => fits(r)); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMode("min"); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [on]);   // eslint-disable-line react-hooks/exhaustive-deps

  const max = mode === "max";
  const geo: Rect = max ? { x: 0, y: 0, w: innerWidth, h: innerHeight } : rect;

  const start = (kind: string) => (e: PE<HTMLElement>) => {
    if (e.button !== 0) return;
    if (kind === "move" && (e.target as HTMLElement).closest("button,a")) return;
    if (max && kind !== "move") return;
    e.preventDefault();
    let r = rect;
    if (max && kind === "move") {
      // A filled window dragged down comes back as a window under the pointer, at the same spot along its width.
      const k = store.get<Rect | null>(KEY, null) || first(), along = e.clientX / innerWidth;
      r = fits({ ...k, x: e.clientX - k.w * along, y: Math.max(8, e.clientY - 18) });
      setRect(r); setModeState("open"); store.set(`${KEY}:mode`, "open");
    }
    drag.current = { kind, sx: e.clientX, sy: e.clientY, r };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(kind === "move" ? "move" : "size");
  };
  const move = (e: PE<HTMLElement>) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.kind === "move") {
      setRect(fits({ ...d.r, x: d.r.x + dx, y: d.r.y + dy }));
      setSnap(e.clientY <= SNAP_PX ? "max" : e.clientX <= SNAP_PX ? "left" : e.clientX >= innerWidth - SNAP_PX ? "right" : null);
      return;
    }
    let { x, y, w, h } = d.r;
    if (d.kind.includes("e")) w = d.r.w + dx;
    if (d.kind.includes("s")) h = d.r.h + dy;
    if (d.kind.includes("w")) { w = d.r.w - dx; x = d.r.x + dx; if (w < MIN_W) { x -= MIN_W - w; w = MIN_W; } }
    if (d.kind.includes("n")) { h = d.r.h - dy; y = d.r.y + dy; if (h < MIN_H) { y -= MIN_H - h; h = MIN_H; } }
    setRect(fits({ x, y, w, h }));
  };
  const end = () => {
    const d = drag.current; if (!d) return;
    drag.current = null; setDragging(null);
    if (d.kind === "move" && snap) {
      // Kept as the window to come back to: where it was picked up from.
      store.set(KEY, d.r);
      if (snap === "max") setMode("max");
      else { glideOnce(); setRect(snapRect(snap)); store.set(KEY, snapRect(snap)); }
      setSnap(null);
      return;
    }
    setSnap(null);
    setRect((r) => { store.set(KEY, r); return r; });
  };

  // Where it opens from and goes back to: the button that opened it (or the pill, when tucked away).
  const tuckTo = mode === "min" ? { x: innerWidth / 2, y: innerHeight - 24 } : origin || { x: geo.x + geo.w / 2, y: geo.y + geo.h + 40 };
  const ox = Math.round(tuckTo.x - geo.x), oy = Math.round(tuckTo.y - geo.y);
  const edges: [string, string][] = [
    ["n", "top-0 inset-x-3 h-1.5 cursor-ns-resize"], ["s", "bottom-0 inset-x-3 h-1.5 cursor-ns-resize"],
    ["w", "left-0 inset-y-3 w-1.5 cursor-ew-resize"], ["e", "right-0 inset-y-3 w-1.5 cursor-ew-resize"],
    ["nw", "top-0 left-0 size-3.5 cursor-nwse-resize"], ["ne", "top-0 right-0 size-3.5 cursor-nesw-resize"],
    ["sw", "bottom-0 left-0 size-3.5 cursor-nesw-resize"], ["se", "bottom-0 right-0 size-4 cursor-nwse-resize"],
  ];
  const iconBtn = "grid size-7 place-items-center rounded-md text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-white/[0.08] hover:text-ink active:scale-90";
  const dot = "group/dot grid size-3 place-items-center rounded-full transition-[transform,filter] duration-150 hover:brightness-110 active:scale-90";
  const preview = snap ? snapRect(snap) : null;

  return (
    <>
      {/* Where a drag to the edge will land it. */}
      <div aria-hidden className="pointer-events-none fixed z-[49] rounded-xl border border-white/25 bg-white/[0.06] backdrop-blur-[2px]"
        style={{ left: (preview ?? geo).x + 4, top: (preview ?? geo).y + 4, width: (preview ?? geo).w - 8, height: (preview ?? geo).h - 8,
          opacity: preview ? 1 : 0, transform: preview ? "scale(1)" : "scale(.97)", transition: `opacity 160ms ease, transform 200ms ${EASE}, left 200ms ${EASE}, top 200ms ${EASE}, width 200ms ${EASE}, height 200ms ${EASE}` }} />

      {(
        <div role="dialog" aria-labelledby="forge-title" aria-hidden={!on}
          style={{
            left: geo.x, top: geo.y, width: geo.w, height: geo.h,
            transformOrigin: `${ox}px ${oy}px`,
            transform: entered ? "none" : mode === "min" ? "scale(.18)" : "scale(.9)",
            opacity: entered ? 1 : 0,
            filter: entered ? "none" : "blur(2px)",
            transition: calm() ? "none" : [
              `transform ${entered ? 300 : 220}ms ${EASE}`, `opacity ${entered ? 220 : 180}ms ease`, `filter 220ms ease`,
              ...(glide ? [`left ${GLIDE_MS}ms ${EASE}`, `top ${GLIDE_MS}ms ${EASE}`, `width ${GLIDE_MS}ms ${EASE}`, `height ${GLIDE_MS}ms ${EASE}`, `border-radius ${GLIDE_MS}ms ${EASE}`] : []),
            ].join(", "),
            borderRadius: max ? 0 : 14,
          }}
          className={cn("fixed z-50 flex flex-col overflow-hidden border border-rule-2 bg-paper will-change-transform",
            "shadow-[0_30px_80px_-16px_rgba(0,0,0,0.92),0_0_0_1px_rgba(255,255,255,0.04),inset_0_1px_0_rgba(255,255,255,0.05)]",
            !on && "pointer-events-none", !live && "invisible", dragging === "move" && "shadow-[0_40px_100px_-12px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.08)]")}>
          <div onPointerDown={start("move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest("button,a")) setMode(max ? "open" : "max"); }}
            className={cn("relative flex h-10 shrink-0 touch-none select-none items-center gap-2.5 border-b border-rule-2 bg-gradient-to-b from-paper-3 to-paper-2 pr-1.5 pl-3.5",
              !max && (dragging === "move" ? "cursor-grabbing" : "cursor-grab"))}>
            {/* The desktop's three dots: close, tuck away, fill the screen. Their marks show on hover. */}
            <span className="group flex items-center gap-2">
              <button type="button" onClick={onClose} aria-label="Close the editor" title="Close (your work is kept until you leave the page)" className={cn(dot, "bg-[#ff5f57]")}>
                <svg viewBox="0 0 12 12" className="size-2 opacity-0 transition-opacity group-hover:opacity-100" stroke="#4d0000" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /></svg>
              </button>
              <button type="button" onClick={() => setMode("min")} aria-label="Minimise the editor" title="Tuck it away (Esc)" className={cn(dot, "bg-[#febc2e]")}>
                <svg viewBox="0 0 12 12" className="size-2 opacity-0 transition-opacity group-hover:opacity-100" stroke="#5c3d00" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M3 6h6" /></svg>
              </button>
              <button type="button" onClick={() => setMode(max ? "open" : "max")} aria-label={max ? "Restore the editor" : "Maximise the editor"} title={max ? "Back to a window" : "Fill the screen"} className={cn(dot, "bg-[#28c840]")}>
                <svg viewBox="0 0 12 12" className="size-2 opacity-0 transition-opacity group-hover:opacity-100" fill="#0a4a12" aria-hidden>{max ? <path d="M6.6 5.4V2.6l2.8 2.8zM5.4 6.6v2.8L2.6 6.6z" /> : <path d="M3 9V5.4L6.6 9zM9 3v3.6L5.4 3z" />}</svg>
              </button>
            </span>
            <span className="ml-1 flex min-w-0 items-center gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/10" aria-hidden>
                <svg viewBox="0 0 24 24" className="size-3 text-ink" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20l6-14 4 9 3-5 3 10z" /></svg>
              </span>
              <span id="forge-title" className="text-sm font-semibold tracking-[-0.01em] text-ink">{title}</span>
              {hint && <span className="truncate text-xs text-muted max-lg:hidden">{hint}</span>}
            </span>
            <span className="grow" />
            <a href="/forge/" target="_blank" rel="noopener" title="Open the editor in its own tab" className={iconBtn}>
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></svg>
            </a>
            <button type="button" onClick={onClose} aria-label="Close" title="Close" className={cn(iconBtn, "hover:bg-down/80 hover:text-white")}><Icon.close className="size-4" /></button>
          </div>
          <div className="relative min-h-0 flex-1 bg-paper">
            <iframe ref={frameRef} src="/forge/?embed=1" aria-label="The Forge editor" allow="clipboard-write; clipboard-read"
              className={cn("absolute inset-0 size-full border-0 bg-paper transition-opacity duration-300", ready ? "opacity-100" : "opacity-0")} />
            {/* Until the editor says it is up: its outline and a quiet spinner, fading out once it is. */}
            <div aria-hidden={ready} className={cn("absolute inset-0 grid grid-cols-[58px_minmax(0,260px)_1fr] transition-opacity duration-300", ready ? "pointer-events-none opacity-0" : "opacity-100")}>
              <div className="flex flex-col gap-2 border-r border-rule p-2">{[0, 1, 2, 3, 4, 5].map((i) => <i key={i} className="h-10 animate-pulse rounded-lg bg-paper-3" style={{ animationDelay: `${i * 80}ms` }} />)}</div>
              <div className="flex flex-col gap-2 border-r border-rule p-3 max-sm:hidden"><i className="h-3 w-20 animate-pulse rounded bg-paper-3" />{[0, 1, 2, 3].map((i) => <i key={i} className="h-24 animate-pulse rounded-lg bg-paper-3" style={{ animationDelay: `${i * 90}ms` }} />)}</div>
              <div className="grid place-items-center">
                <span className="flex flex-col items-center gap-3 text-sm text-muted">
                  <span className="size-7 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
                  Opening the editor…
                </span>
              </div>
            </div>
            {dragging && <div className="absolute inset-0 z-10" />}
          </div>
          {!max && edges.map(([k, cls]) => <span key={k} onPointerDown={start(k)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className={cn("absolute z-20 touch-none", cls)} />)}
        </div>
      )}

      {/* Tucked away: a pill at the bottom of the screen that brings it back. */}
      <button type="button" onClick={() => setModeState("open")} title="Back to the editor" tabIndex={shown && mode === "min" ? 0 : -1} aria-hidden={!(shown && mode === "min")}
        style={{ transition: `transform 320ms ${EASE}, opacity 200ms ease` }}
        className={cn("fixed bottom-4 left-1/2 z-50 flex items-center gap-2.5 rounded-full border border-rule-2 bg-paper-2/95 py-2 pr-4 pl-2.5 text-sm font-semibold text-ink shadow-[0_14px_36px_-8px_rgba(0,0,0,0.9)] backdrop-blur hover:bg-paper-3",
          shown && mode === "min" ? "-translate-x-1/2 translate-y-0 opacity-100" : "pointer-events-none -translate-x-1/2 translate-y-6 opacity-0")}>
        <span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-white/20 to-white/5 ring-1 ring-white/10">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 20l6-14 4 9 3-5 3 10z" /></svg>
        </span>
        {title}<span className="font-normal text-muted">· tap to open</span>
        <i className="size-1.5 rounded-full bg-up motion-safe:animate-pulse" />
      </button>
    </>
  );
}
