// A coin's logo, enlarged while the pointer rests on it (as Axiom does): beside the small picture, the same logo at
// 240 px. The small copy already in the browser shows at once, scaled up; a sharp one (pump.fun's 600 px original,
// or the picture link the list carried, both through Blix's own picture cache, lib/thumb.ts) is laid over it the
// moment it lands. Mouse only: a tap on a phone opens the coin as before.
import { useEffect, useState, type PointerEvent } from "react";
import { create } from "zustand";
import { usePic } from "@/lib/pics";
import { thumb } from "@/lib/thumb";
import { cn } from "@/lib/utils";

interface Shown { mint: string; rect: DOMRect; el: HTMLElement; caption?: string; fallback?: string | null }
const usePreview = create<{ on: Shown | null }>(() => ({ on: null }));
let timer = 0;
const SHOW_AFTER_MS = 140, SIZE = 240, GAP = 10, EDGE = 8;

// Spread on the element that holds a coin's picture.
export function previewHandlers(mint: string, opts: { caption?: string; fallback?: string | null } = {}) {
  return {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse") return;
      const el = e.currentTarget;
      clearTimeout(timer);
      timer = window.setTimeout(() => { if (el.isConnected) usePreview.setState({ on: { mint, rect: el.getBoundingClientRect(), el, ...opts } }); }, SHOW_AFTER_MS);
    },
    onPointerLeave: () => { clearTimeout(timer); usePreview.setState({ on: null }); },
  };
}
const hide = () => { clearTimeout(timer); if (usePreview.getState().on) usePreview.setState({ on: null }); };
// A scroll somewhere: put the preview away only if its picture moved or went (a live list nudges itself as rows
// update; the picture still under the pointer keeps its preview).
const moved = () => {
  const on = usePreview.getState().on;
  if (!on) return;
  const r = on.el.isConnected ? on.el.getBoundingClientRect() : null;
  if (!r || Math.abs(r.top - on.rect.top) > 4 || Math.abs(r.left - on.rect.left) > 4) hide();
};

// The sharp copies to try, best first: pump.fun keeps a 600 px picture of every coin launched there.
const sharp = (mint: string, fallback?: string | null) =>
  [thumb(`https://images.pump.fun/coin-image/${mint}?variant=600x600`, SIZE), fallback ? thumb(fallback, SIZE) : undefined].filter(Boolean) as string[];

// Rendered once, by the app shell.
export function PicPreview() {
  const on = usePreview((s) => s.on);
  useEffect(() => {
    // Anything that moves the page under the pointer puts the preview away.
    addEventListener("scroll", moved, true); addEventListener("hashchange", hide); addEventListener("blur", hide);
    return () => { removeEventListener("scroll", moved, true); removeEventListener("hashchange", hide); removeEventListener("blur", hide); };
  }, []);
  return on ? <Card key={on.mint} {...on} /> : null;
}

function Card({ mint, rect, caption, fallback }: Omit<Shown, "el">) {
  const pic = usePic(mint);
  const tries = sharp(mint, fallback);
  const [i, setI] = useState(0), [ok, setOk] = useState(false);
  const w = Math.min(SIZE, innerWidth - EDGE * 2), h = w + (caption ? 34 : 0);
  // Beside the picture, on whichever side has room; level with it, kept on screen.
  let x = rect.right + GAP;
  if (x + w > innerWidth - EDGE) x = rect.left - GAP - w;
  x = Math.max(EDGE, Math.min(x, innerWidth - EDGE - w));
  const y = Math.max(EDGE, Math.min(rect.top + rect.height / 2 - h / 2, innerHeight - EDGE - h));
  const small = pic.src;
  return (
    <div role="presentation" style={{ left: x, top: y, width: w }}
      className="pointer-events-none fixed z-[70] overflow-hidden rounded-card border border-rule-2 bg-paper-2 shadow-2xl shadow-black/60 motion-safe:animate-[pic-pop_120ms_ease-out]">
      <div className="relative bg-paper-4" style={{ width: w, height: w }}>
        {small && <img src={small} alt="" className="absolute inset-0 size-full object-cover" />}
        {i < tries.length && (
          <img key={tries[i]} src={tries[i]} alt="" decoding="async" onLoad={() => setOk(true)} onError={() => { setOk(false); setI((n) => n + 1); }}
            className={cn("absolute inset-0 size-full object-cover transition-opacity duration-150", ok ? "opacity-100" : "opacity-0")} />
        )}
      </div>
      {caption && <p className="line-clamp-2 border-t border-rule px-3 py-2 text-sm text-ink-2">{caption}</p>}
    </div>
  );
}
