// The card that opens when the pointer rests on a Discover coin's pair cell, like Axiom's: the coin's
// DexScreener banner (its own picture, blurred, when it has none), picture, ticker, market cap and change, then
// volume, liquidity, holders, top 10, dev, age and the contract with a copy button, and a watchlist star.
// One card for the whole page (its own layer, like lib/update.tsx): it opens 120 ms after the pointer rests on a
// pair cell (not on the cell's picture, which shows itself big, nor its links, buttons or faces), with its top-left
// corner at the pointer, and follows the pointer frame by frame (moved directly, not through React). Moving to
// another row swaps what it shows in place; it fades and slides in, fades out 150 ms after the pointer has left
// both the cell and the card. Scrolling keeps it, showing the coin now under the pointer; the wheel over the card scrolls the list.
import { cloneElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import { PumpLogo, SolanaLogo } from "@/components/brand";
import { CoinImg } from "@/components/page";
import { toast } from "@/components/ui/toast";
import { ageStr, compact, pct, shortAddr, tone } from "@/lib/format";
import { useLiveMc } from "@/lib/livepx";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { api } from "@/lib/api";
import { pick, type Row, type Tf } from "./parts";

// Banners for coins whose row came without one (Fomo's lists, the stream's new pairs): asked of the server once
// per coin (server/banner.js), kept for the visit. undefined = not asked yet, null = it has none.
const banners = new Map<string, string | null | Promise<string | null>>();
function useBanner(r: Row) {
  const have = r.header || null;
  const [got, setGot] = useState<string | null | undefined>(() => { const b = banners.get(r.mint); return have ?? (typeof b === "string" || b === null ? b : undefined); });
  useEffect(() => {
    if (have) return;
    let alive = true;
    let b = banners.get(r.mint);
    if (b === undefined) { b = api<{ header: string | null }>(`banner?m=${r.mint}`).then((x) => x?.header ?? null, () => null); banners.set(r.mint, b); b.then((h) => banners.set(r.mint, h)); }
    Promise.resolve(b).then((h) => { if (alive) setGot(h); });
    return () => { alive = false; };
  }, [r.mint, have]);
  return have ?? got ?? null;
}

const W = 300, GAP = 14;   // the card's width; how far its corner sits from the pointer
// Inside a cell, these keep their own hover (links, the X card, buttons, the known-holder faces, and the coin's
// picture, which shows itself big: PicPreview): no coin card there.
const OWN = "a, button, [data-known-holders], [data-coin-pic]";

const useCard = create<{ r: Row | null; tf: Tf; open: boolean }>(() => ({ r: null, tf: "1h", open: false }));
let box: HTMLDivElement | null = null;            // the card's outer layer, moved directly
let at = { x: 0, y: 0 }, frame = 0, openTimer = 0, closeTimer = 0;

// The card's top-left corner just below-right of the pointer; flipped to the other side near the window's edges.
function place() {
  frame = 0;
  if (!box) return;
  const w = box.offsetWidth || W, h = box.offsetHeight || 380;
  let x = at.x + GAP, y = at.y + GAP;
  if (x + w > innerWidth - 8) x = Math.max(8, at.x - GAP - w);
  if (y + h > innerHeight - 8) y = Math.max(8, Math.min(at.y - GAP - h, innerHeight - 8 - h));
  box.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}
const follow = (x: number, y: number) => { at = { x, y }; if (!frame) frame = requestAnimationFrame(place); };
const cancelClose = () => clearTimeout(closeTimer);
const closeSoon = () => { clearTimeout(openTimer); openTimer = 0; clearTimeout(closeTimer); closeTimer = window.setTimeout(() => useCard.setState({ open: false }), 150); };
// The cells on the page, by coin, so after a scroll the card can show whichever cell is now under the pointer.
const cells = new Map<string, { r: Row; tf: Tf }>();
let scrollFrame = 0;
function underPointer() {
  scrollFrame = 0;
  if (!useCard.getState().open) return;
  const el = document.elementFromPoint(at.x, at.y);
  if (!el || box?.contains(el)) return;
  if (el.closest(OWN)) return closeNow();
  const mint = el.closest<HTMLElement>("[data-coin-cell]")?.dataset.coinCell;
  const c = mint ? cells.get(mint) : undefined;
  if (!c) return closeSoon();
  cancelClose();
  if (useCard.getState().r?.mint !== mint) useCard.setState({ r: c.r, tf: c.tf });
}
const onScroll = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(underPointer); };
// The wheel over the card scrolls what is under it (the card is outside the list's scroll box, so it would not).
function forwardWheel(e: WheelEvent) {
  const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !box?.contains(el));
  for (let el: Element | null = under ?? null; el; el = el.parentElement) {
    const st = getComputedStyle(el);
    if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) { el.scrollBy({ top: e.deltaY, left: e.deltaX }); return; }
  }
  scrollBy({ top: e.deltaY, left: e.deltaX });
}
const closeNow = () => { clearTimeout(openTimer); openTimer = 0; clearTimeout(closeTimer); if (useCard.getState().open) useCard.setState({ open: false }); };

type Trigger = ReactElement<{ onPointerMove?: (e: unknown) => void; onPointerLeave?: (e: unknown) => void; "data-coin-cell"?: string }>;
export function CoinHover({ r, tf, children }: { r: Row; tf: Tf; children: Trigger }) {
  // The open card follows this row's live figures while it shows this coin.
  useEffect(() => { const s = useCard.getState(); if (s.open && s.r?.mint === r.mint && (s.r !== r || s.tf !== tf)) useCard.setState({ r, tf }); }, [r, tf]);
  useEffect(() => { cells.set(r.mint, { r, tf }); return () => { if (cells.get(r.mint)?.r === r) cells.delete(r.mint); }; }, [r, tf]);
  const move = (e: unknown) => {
    const ev = e as PointerEvent;
    if (ev?.pointerType && ev.pointerType !== "mouse") return;
    if ((ev?.target as Element | null)?.closest?.(OWN)) return closeNow();
    cancelClose();
    follow(ev.clientX, ev.clientY);
    const s = useCard.getState();
    if (s.open) { if (s.r?.mint !== r.mint) useCard.setState({ r, tf }); return; }
    clearTimeout(openTimer);
    openTimer = window.setTimeout(() => { openTimer = 0; useCard.setState({ r, tf, open: true }); }, 120);
  };
  const p = children.props;
  return cloneElement(children, {
    "data-coin-cell": r.mint,
    onPointerMove: (e: unknown) => { p.onPointerMove?.(e); move(e); },
    onPointerLeave: (e: unknown) => { p.onPointerLeave?.(e); closeSoon(); },
  });
}

// The one card on the page.
function Layer() {
  const { r, tf, open } = useCard();
  const [shown, setShown] = useState<Row | null>(null);   // kept while the card fades out
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null), last = useRef<string | null>(null);
  useLayoutEffect(() => { box = outer.current; });
  useLayoutEffect(() => {
    if (open && r) {
      const was = shown;
      setShown(r);
      place();
      // In: a short fade and slide down from the pointer. Another coin while open: a quick fade of the contents.
      if (!was) inner.current?.animate([{ opacity: 0, transform: "translateY(-6px) scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 170, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      else if (last.current !== r.mint) inner.current?.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
      last.current = r.mint;
    } else if (!open && shown) {
      const a = inner.current?.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-4px) scale(0.985)" }], { duration: 120, easing: "ease-in", fill: "forwards" });
      const done = () => { setShown(null); last.current = null; };
      if (a) a.onfinish = done; else done();
    }
  }, [open, r]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!shown) return;
    // Scrolling keeps the card: it shows whichever coin's cell is now under the pointer (or goes when none is).
    const away = () => closeNow();
    const wheel = (e: WheelEvent) => forwardWheel(e);
    const el = inner.current;
    addEventListener("scroll", onScroll, true); addEventListener("blur", away); addEventListener("hashchange", away);
    el?.addEventListener("wheel", wheel, { passive: true });
    return () => { removeEventListener("scroll", onScroll, true); removeEventListener("blur", away); removeEventListener("hashchange", away); el?.removeEventListener("wheel", wheel); };
  }, [shown]);
  const row = open && r ? r : shown;
  return (
    <div ref={outer} className="pointer-events-none fixed top-0 left-0 z-50 will-change-transform" style={{ width: W, visibility: row ? "visible" : "hidden" }}>
      {row && (
        // Clicks inside the card stay in it (the row under it would open the coin).
        <div ref={inner} role="dialog" aria-label={`${row.symbol || "Coin"} details`} onPointerEnter={cancelClose} onPointerLeave={closeSoon} onClick={(e) => e.stopPropagation()}
          className={cn("overflow-hidden rounded-card border border-rule-2 bg-paper-2 text-left shadow-sheet", open && "pointer-events-auto")}>
          <Card key={row.mint} r={row} tf={tf} />
        </div>
      )}
    </div>
  );
}

if (typeof window !== "undefined") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  createRoot(host).render(<Layer />);
}

// The watchlist the status bar shows (shell/StatusBar.tsx): [{ mint, symbol }] in this browser.
type Star = { mint: string; symbol: string };
function useStar(mint: string, symbol: string) {
  const [on, setOn] = useState(() => store.get<Star[]>("watchlist", []).some((s) => s.mint === mint));
  const toggle = () => {
    const list = store.get<Star[]>("watchlist", []);
    const next = list.some((s) => s.mint === mint) ? list.filter((s) => s.mint !== mint) : [{ mint, symbol }, ...list];
    store.set("watchlist", next);
    setOn(!on);
    dispatchEvent(new Event("blix:watchlist"));
    toast(on ? "Removed from your watchlist" : "Added to your watchlist");
  };
  return [on, toggle] as const;
}

function Card({ r, tf }: { r: Row; tf: Tf }) {
  const { vol, chg } = pick(r, tf);
  const liveMc = useLiveMc(r.mint);
  const mc = liveMc ?? r.mc_live ?? r.mcap;
  const s = r.safety || {};
  const born = r.pair_created || r.first_seen;
  const pump = r.dex === "pumpfun" || r.dex === "pumpswap" || r.mint.endsWith("pump");
  // pump.fun coins all have a billion tokens, so their price is the market cap over a billion; others are not shown.
  const price = pump && mc ? mc / 1e9 : null;
  const [starred, toggleStar] = useStar(r.mint, r.symbol || "");
  const header = useBanner(r);
  const copy = () => navigator.clipboard?.writeText(r.mint).then(() => toast("Contract copied"), () => toast("Couldn't copy the contract"));
  return (
    <div className="flex flex-col">
      {/* banner: DexScreener's header when the coin paid for one, else its own picture blurred */}
      <div className="relative h-[88px] overflow-hidden bg-paper-4">
        {header
          ? <img key={header} src={header} alt="" className="absolute inset-0 size-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          : <span className="absolute inset-0 scale-125 opacity-60 blur-xl"><CoinImg mint={r.mint} fallback={r.image} preview={false} /></span>}
        <span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-paper-2" />
        <button onClick={toggleStar} aria-label={starred ? "Remove from watchlist" : "Add to watchlist"} aria-pressed={starred}
          className={cn("absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-paper/70 backdrop-blur transition-colors", starred ? "text-warn" : "text-ink-2 hover:text-ink")}>
          <Icon.star className={cn("size-4", starred && "fill-current")} />
        </button>
      </div>
      <div className="-mt-9 flex flex-col gap-3 px-4 pb-4">
        <span className="relative grid size-16 place-items-center overflow-hidden rounded-full border-[3px] border-paper-2 bg-paper-4 text-sm font-semibold text-muted uppercase shadow-sheet">
          {(r.symbol || "?").slice(0, 3)}<CoinImg mint={r.mint} fallback={r.image} preview={false} />
        </span>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <b className="min-w-0 truncate text-lg font-bold text-ink">{r.symbol || "?"}</b>
            <span className="grid size-5 shrink-0 place-items-center rounded-md bg-paper-4">{pump ? <PumpLogo className="size-3" /> : <SolanaLogo className="w-2.5" />}</span>
            <span className="num ml-auto shrink-0 text-lg font-bold text-ink">{compact(mc)} <span className="text-sm font-semibold text-muted">MC</span></span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="min-w-0 truncate text-muted">{price != null ? `$${fmtPrice(price)}` : r.name}</span>
            {chg != null && <span className={cn("num ml-auto shrink-0 font-semibold", tone(chg))}>{chg >= 0 ? "▲" : "▼"} {pct(Math.abs(chg)).replace(/^[+-]/, "")}</span>}
          </div>
        </div>
        <dl className="flex flex-col gap-2 text-sm">
          <Line k={`Volume ${tf}`} v={compact(vol)} />
          <Line k="Liquidity" v={compact(r.liquidity)} />
          <Line k="Holders" v={s.totalHolders != null ? compactCount(s.totalHolders) : "—"} />
          <Line k="Top 10 holding" v={s.top10 != null ? `${s.top10.toFixed(2)}%` : "—"} tone={s.top10 != null && s.top10 > 30 ? "text-down" : undefined} />
          <Line k="Dev holding" v={s.devPct != null ? `${s.devPct.toFixed(2)}%` : "—"} tone={s.devPct != null && s.devPct > 5 ? "text-down" : undefined} />
          <Line k="Age" v={born ? ageStr(Date.now() - born) : "—"} />
          <Line k="Contract" v={<button onClick={copy} className="flex items-center gap-1.5 hover:text-focus" aria-label="Copy contract"><span>{shortAddr(r.mint)}</span><Icon.copy className="size-3.5 text-muted" /></button>} />
        </dl>
      </div>
    </div>
  );
}

// A label, a dotted leader, and the figure, as on Axiom's card.
function Line({ k, v, tone: t }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-muted">{k}</dt>
      <span aria-hidden className="mb-1 min-w-4 flex-1 border-b border-dotted border-rule-2" />
      <dd className={cn("num shrink-0 font-semibold text-ink", t)}>{v}</dd>
    </div>
  );
}

const compactCount = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n));
// Small prices keep four significant digits ($0.00001234), bigger ones two decimals.
const fmtPrice = (p: number) => (p >= 1 ? p.toFixed(2) : p.toPrecision(4).replace(/(\.\d*?)0+$/, "$1"));
