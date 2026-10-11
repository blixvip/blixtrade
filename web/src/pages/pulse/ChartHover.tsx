// The card that opens when the pointer rests anywhere on a Pulse row (its free space: not on its links, buttons,
// picture or known-holder faces, which have their own hover): the coin's live chart in miniature (MiniChart.tsx,
// the real chart's candles, size, polls and trade stream), with its picture, ticker, launchpad, the market cap the
// chart is drawing this instant and the move across the candles on screen, its bonding progress while on the curve,
// and under the chart the row's own figures. One card for the whole page, in its own layer (as the Discover card,
// pages/discover/hovercard.tsx): it opens 140 ms after the pointer rests on a row, its top-left corner just
// below-right of the pointer (flipped at the window's edges), and stays put there, so a live chart never slides
// about under the eye. The card itself can be reached: the pointer on it keeps it (and the wheel over it scrolls the
// list beneath), a click on it opens the coin. Another row swaps what it shows once the pointer has rested there a
// moment, placed again at the pointer; it fades in, and out 150 ms after the pointer has left both. It goes on a
// scroll, a click on the list, Escape or leaving the page. Mouse only.
import { cloneElement, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import { SolMark } from "@/components/FeesPaid";
import { padOf, PadLogo, PADS } from "@/components/logos";
import { CoinImg } from "@/components/page";
import { ageStr, compact, pct, tone } from "@/lib/format";
import { usdP } from "@/lib/coin";
import { CHART_BG } from "@/lib/gecko";
import { usePulse, type Coin } from "@/lib/pulse";
import { useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { primeCandles, tfFor, tfLabel } from "./hoverChart";
import type { MiniState } from "./MiniChart";

const loadChart = () => import("./MiniChart");
const MiniChart = lazy(() => loadChart().then((m) => ({ default: m.MiniChart })));

const W = 352, CHART_H = 176, GAP = 14, OPEN_MS = 140, SWAP_MS = 110, CLOSE_MS = 150;
// Inside a row, these keep their own hover (links, buttons, the picture's big preview, the known-holder faces): no
// chart card from them.
const OWN = "a, button, [data-coin-pic], [data-known-holders]";

const useCard = create<{ mint: string | null; tf: number; open: boolean }>(() => ({ mint: null, tf: 1, open: false }));
let box: HTMLDivElement | null = null;   // the card's outer layer, moved directly
let at = { x: 0, y: 0 }, openTimer = 0, closeTimer = 0, swapTimer = 0, mounted = false;

// The card's top-left corner just below-right of where the pointer was when it opened; flipped near the window's edges.
function place() {
  if (!box) return;
  const w = box.offsetWidth || W, h = box.offsetHeight || CHART_H + 190;
  let x = at.x + GAP, y = at.y + GAP;
  if (x + w > innerWidth - 8) x = Math.max(8, at.x - GAP - w);
  if (y + h > innerHeight - 8) y = Math.max(8, Math.min(at.y - GAP - h, innerHeight - 8 - h));
  box.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}
const cancelClose = () => { clearTimeout(closeTimer); closeTimer = 0; };
const cancelSwap = () => { clearTimeout(swapTimer); swapTimer = 0; };
const closeNow = () => { clearTimeout(openTimer); openTimer = 0; cancelClose(); cancelSwap(); if (useCard.getState().open) useCard.setState({ open: false }); };
const closeSoon = () => { clearTimeout(openTimer); openTimer = 0; cancelClose(); cancelSwap(); closeTimer = window.setTimeout(closeNow, CLOSE_MS); };
// The wheel over the card scrolls what is under it (the card is outside the list's scroll box, so it would not).
function forwardWheel(e: WheelEvent) {
  const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !box?.contains(el));
  for (let el: Element | null = under ?? null; el; el = el.parentElement) {
    const st = getComputedStyle(el);
    if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) { el.scrollBy({ top: e.deltaY, left: e.deltaX }); return; }
  }
  scrollBy({ top: e.deltaY, left: e.deltaX });
}
function ensureLayer() {
  if (mounted || typeof document === "undefined") return;
  mounted = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  createRoot(host).render(<Layer />);
}

type Trigger = ReactElement<{ onPointerEnter?: (e: unknown) => void; onPointerMove?: (e: unknown) => void; onPointerLeave?: (e: unknown) => void; onPointerDown?: (e: unknown) => void }>;
export function ChartHover({ coin, children }: { coin: Coin; children: Trigger }) {
  const move = (e: unknown) => {
    const ev = e as PointerEvent;
    if (ev?.pointerType && ev.pointerType !== "mouse") return;
    if ((ev?.target as Element | null)?.closest?.(OWN)) return closeSoon();
    cancelClose();
    const s = useCard.getState();
    if (s.open) {
      // Another coin's row: the card swaps to it once the pointer has rested there a moment (SWAP_MS), so sweeping
      // down a column does not open and close a chart (its candles and trade stream) for every row passed over.
      if (s.mint !== coin.mint) {
        if (swapTimer) return;
        primeCandles(coin.mint, tfFor(coin));
        swapTimer = window.setTimeout(() => { swapTimer = 0; if (!useCard.getState().open) return; at = { x: ev.clientX, y: ev.clientY }; useCard.setState({ mint: coin.mint, tf: tfFor(coin) }); }, SWAP_MS);
      } else cancelSwap();
      return;
    }
    if (openTimer) return;
    ensureLayer();
    loadChart();
    primeCandles(coin.mint, tfFor(coin));
    openTimer = window.setTimeout(() => { openTimer = 0; useCard.setState({ mint: coin.mint, tf: tfFor(coin), open: true }); }, OPEN_MS);
  };
  const track = (e: unknown) => { const ev = e as PointerEvent; if (!useCard.getState().open) at = { x: ev.clientX, y: ev.clientY }; move(e); };
  const p = children.props;
  return cloneElement(children, {
    onPointerEnter: (e: unknown) => { p.onPointerEnter?.(e); track(e); },
    onPointerMove: (e: unknown) => { p.onPointerMove?.(e); track(e); },
    onPointerLeave: (e: unknown) => { p.onPointerLeave?.(e); closeSoon(); },
    onPointerDown: (e: unknown) => { p.onPointerDown?.(e); closeNow(); },
  });
}

// The one card on the page.
function Layer() {
  const { mint, tf, open } = useCard();
  const [shown, setShown] = useState<string | null>(null);   // kept while the card fades out
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null), last = useRef<string | null>(null);
  useLayoutEffect(() => { box = outer.current; });
  useLayoutEffect(() => {
    if (open && mint) {
      const was = shown;
      setShown(mint);
      place();
      if (!was) inner.current?.animate([{ opacity: 0, transform: "translateY(-6px) scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 170, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      else if (last.current !== mint) inner.current?.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: "ease-out" });
      last.current = mint;
    } else if (!open && shown) {
      const a = inner.current?.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-4px) scale(0.985)" }], { duration: 120, easing: "ease-in", fill: "forwards" });
      const done = () => { setShown(null); last.current = null; };
      if (a) a.onfinish = done; else done();
    }
  }, [open, mint]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The card's height is known only once its contents are drawn: placed again then, so it never hangs off the bottom.
  useLayoutEffect(() => { if (shown) place(); }, [shown]);
  useEffect(() => {
    if (!shown) return;
    const away = () => closeNow();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeNow(); };
    // A press outside the card closes it (a row's click opens its coin); one on the card is its own.
    const press = (e: PointerEvent) => { if (!inner.current?.contains(e.target as Node)) closeNow(); };
    const wheel = (e: WheelEvent) => forwardWheel(e);
    const el = inner.current;
    addEventListener("scroll", away, true); addEventListener("blur", away); addEventListener("hashchange", away); addEventListener("keydown", key); addEventListener("pointerdown", press, true);
    el?.addEventListener("wheel", wheel, { passive: true });
    return () => { removeEventListener("scroll", away, true); removeEventListener("blur", away); removeEventListener("hashchange", away); removeEventListener("keydown", key); removeEventListener("pointerdown", press, true); el?.removeEventListener("wheel", wheel); };
  }, [shown]);
  const m = open && mint ? mint : shown;
  return (
    <div ref={outer} className="pointer-events-none fixed top-0 left-0 z-50 will-change-transform" style={{ width: W, visibility: m ? "visible" : "hidden" }}>
      {m && (
        <div ref={inner} role="dialog" aria-label="Live chart" onPointerEnter={cancelClose} onPointerLeave={closeSoon}
          onClick={(e) => { e.stopPropagation(); location.hash = `#/coin/${m}`; }}
          className={cn("cursor-pointer overflow-hidden rounded-card border border-rule-2 bg-paper-2 text-left shadow-sheet ring-1 ring-white/[0.04] ring-inset", open && "pointer-events-auto")}>
          <Card key={m} mint={m} tf={tf} />
        </div>
      )}
    </div>
  );
}

function Card({ mint, tf }: { mint: string; tf: number }) {
  const coin = usePulse((s) => s.coins[mint]);
  const now = useNow();
  const [st, setSt] = useState<MiniState | null>(null);
  const [live, setLive] = useState(false);
  // The green dot: a trade from the stream in the last 10 s.
  useEffect(() => {
    if (!st?.liveAt) return;
    setLive(true);
    const t = window.setTimeout(() => setLive(false), 10_000);
    return () => clearTimeout(t);
  }, [st?.liveAt]);
  if (!coin) return null;
  const mc = st?.last?.close ?? coin.mcap ?? null;
  const chg = st?.last && st.first && st.first.open > 0 ? (st.last.close / st.first.open - 1) * 100 : null;
  const up = chg == null || chg >= 0;
  const H = coin.hl || {};
  const holders = H.h ?? coin.holders, top10 = H.t10 ?? coin.top10, dev = H.dev ?? coin.dev;
  const tx = (coin.buys || 0) + (coin.sells || 0), vol = coin.vol ?? coin.liveVol;
  const curve = !coin.graduated, prog = coin.graduated ? 100 : coin.progress != null ? Math.round(coin.progress * 100) : null;
  const pad = padOf(coin), padName = PADS[pad]?.name;
  return (
    <div className="relative flex flex-col">
      {/* a faint wash of the move's colour behind the header, so the card reads green or red at a glance */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-[0.14] transition-colors duration-500" style={{ background: `radial-gradient(120% 100% at 100% 0%, var(--color-${up ? "up" : "down"}) 0%, transparent 60%)` }} />
      <header className="relative flex items-center gap-3 px-3.5 pt-3 pb-2.5">
        <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-chip bg-paper-4 text-xs font-semibold text-muted uppercase ring-1 ring-white/10">
          {(coin.symbol || "?").slice(0, 3)}<CoinImg mint={mint} preview={false} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <b className="shrink-0 text-lg leading-tight font-bold text-ink">{(coin.symbol || "").trim() || "?"}</b>
            <span className="min-w-0 truncate text-sm text-muted">{coin.name}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span className={cn("size-1.5 rounded-full transition-[background-color,box-shadow] duration-300", live ? "bg-up shadow-[0_0_8px_var(--color-up)]" : "bg-rule-2")} aria-hidden />
            <span className="num rounded-md bg-paper-4 px-1.5 py-px font-semibold text-ink-2">{tfLabel(tf)}</span>
            <span className="num">{ageStr(now - coin.born)}</span>
            {PADS[pad] && <><span aria-hidden>·</span><span className="flex items-center gap-1"><PadLogo pad={pad} className="size-3 rounded-full" />{padName}</span></>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <b className="num text-xl leading-tight font-bold text-ink">{mc != null && mc > 0 ? usdP(mc) : "—"}</b>
          {chg != null
            ? <span className={cn("num rounded-full px-1.5 py-px text-xs leading-tight font-semibold", up ? "bg-up/15 text-up" : "bg-down/15 text-down")}>{up ? "▲" : "▼"} {pct(Math.abs(chg)).replace(/^[+-]/, "")}</span>
            : <span className="text-xs text-muted">market cap</span>}
        </div>
      </header>
      <div className="relative mx-2 overflow-hidden rounded-[6px] ring-1 ring-white/[0.05]" style={{ height: CHART_H, background: CHART_BG }}>
        <Suspense fallback={null}><MiniChart mint={mint} tf={tf} born={coin.born} onState={setSt} /></Suspense>
        {/* Before the first candles: a quiet word rather than a black box (1 s candles for a 20-minute coin take a moment). */}
        {!st && <span className="absolute inset-0 grid animate-pulse place-items-center text-xs text-muted">Loading chart…</span>}
        {st?.empty && <span className="absolute inset-0 grid place-items-center text-sm text-muted">{st.note || "No trades yet"}</span>}
      </div>
      {/* On the curve: how far to bonding, the same green the row's picture frame fills with. */}
      {curve && prog != null && (
        <div className="mx-3.5 mt-2.5 flex items-center gap-2 text-xs text-muted">
          <span className="shrink-0">Bonding</span>
          <i className="block h-1 flex-1 overflow-hidden rounded-full bg-paper-4"><i className="block h-full rounded-full bg-up transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, prog))}%` }} /></i>
          <b className="num shrink-0 font-semibold text-ink">{prog}%</b>
        </div>
      )}
      <dl className="grid grid-cols-4 gap-x-3 gap-y-2 px-3.5 pt-2.5 pb-3">
        <Fig k="Vol 1h" v={vol != null ? compact(vol) : "—"} />
        <Fig k="Liquidity" v={coin.liq != null && coin.liq > 0 ? compact(coin.liq) : "—"} />
        <Fig k="Holders" v={holders != null ? String(holders) : "—"} />
        <Fig k="Trades" v={tx > 0 ? String(tx) : "—"} />
        <Fig k="Top 10" v={top10 != null ? `${Math.round(top10)}%` : "—"} tone={top10 != null && top10 > 45 ? "text-down" : undefined} />
        <Fig k="Dev" v={dev != null ? `${(+dev).toFixed(dev < 10 ? 1 : 0)}%` : "—"} tone={dev != null && dev > 8 ? "text-down" : undefined} />
        <Fig k="Fees paid" v={coin.fees != null && coin.fees >= 0 ? <span className="flex items-center gap-1"><SolMark />{coin.fees.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> : "—"} />
        <Fig k="5m change" v={coin.chg5 != null ? pct(coin.chg5) : "—"} tone={tone(coin.chg5)} />
      </dl>
      <footer className="flex items-center gap-1.5 border-t border-rule px-3.5 py-2 text-xs text-muted">
        <Icon.candles className="size-3.5" />
        <span>Click to open the full chart</span>
      </footer>
    </div>
  );
}

function Fig({ k, v, tone: t }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={cn("num truncate text-sm font-semibold text-ink", t)}>{v}</dd>
    </div>
  );
}
