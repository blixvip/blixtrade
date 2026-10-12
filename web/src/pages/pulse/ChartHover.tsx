// The card that opens when the pointer rests anywhere on a Pulse row (its free space: not on its links, buttons,
// picture or known-holder faces, which have their own hover): the coin's live chart in miniature (MiniChart.tsx,
// the real chart's candles, size, polls and trades), with its picture, ticker, launchpad, the market cap the chart
// is drawing this instant and the move across the candles on screen, its bonding progress while on the curve, and
// under the chart the row's own figures. It behaves exactly as the Discover card (pages/discover/hovercard.tsx):
// one card for the whole page in its own layer, opening the instant the pointer touches a row (no rest, no delay:
// the user, 2026-10-11, "the chart should show up instantly") with its top-left corner at the pointer, following the
// pointer frame by frame (moved directly, not through React). Its chart is drawn from memory in the same frame: every
// row on the page has its candles read ahead (hoverChart.ts warm) and the chart's chunk is loaded as the page opens,
// so the card never says "loading". Moving to
// another row swaps what it shows in place; it fades and slides in, fades out 150 ms after the pointer has left the
// row. The card takes no pointer events at all (the user, 2026-10-11: "you shouldn't be able to scroll onto it"):
// the pointer is never on it, the wheel scrolls the list under it, and a click goes to the row beneath, which opens
// the coin. Scrolling keeps it, showing the coin now under the pointer. Mouse only.
import { cloneElement, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { create } from "zustand";
import { SolMark } from "@/components/FeesPaid";
import { padOf, PadLogo, PADS } from "@/components/logos";
import { CoinImg } from "@/components/page";
import { ageStr, compact, pct } from "@/lib/format";
import { usdP } from "@/lib/coin";
import { usePulse, type Coin } from "@/lib/pulse";
import { useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { CHART_BG, OVERVIEW_TF, primeCandles, tfLabel, unwatchRow, watchRow } from "./hoverChart";
import type { MiniState } from "./MiniChart";

const loadChart = () => import("./MiniChart");
const MiniChart = lazy(() => loadChart().then((m) => ({ default: m.MiniChart })));
// The chart's chunk (lightweight-charts) is fetched as soon as the page is idle, not on the first hover.
// (...and at the latest 1.5 s in: a busy page may never go idle, and the first hover then paid ~400 ms for the chunk.)
if (typeof window !== "undefined") { const go = () => { loadChart().catch(() => {}); }; window.requestIdleCallback?.(go); setTimeout(go, 1500); }

const W = 360, CHART_H = 190, GAP = 14, CLOSE_MS = 150;
// Inside a row, these keep their own hover (links, buttons, the picture's big preview, the known-holder faces): no
// chart card from them. Popups too ([role=tooltip]: the tweet card, tooltips): they are drawn over the page but sit
// inside their row in React's event tree, so moving over a tweet card used to open the chart of the row beneath it.
const OWN = "a, button, [data-coin-pic], [data-known-holders], [role=tooltip]";

const useCard = create<{ mint: string | null; open: boolean }>(() => ({ mint: null, open: false }));
let box: HTMLDivElement | null = null;            // the card's outer layer, moved directly
let at = { x: 0, y: 0 }, frame = 0, closeTimer = 0, mounted = false;

// The card's top-left corner just below-right of the pointer; flipped to the other side near the window's edges.
function place() {
  frame = 0;
  if (!box) return;
  const w = box.offsetWidth || W, h = box.offsetHeight || CHART_H + 220;
  let x = at.x + GAP, y = at.y + GAP;
  if (x + w > innerWidth - 8) x = Math.max(8, at.x - GAP - w);
  if (y + h > innerHeight - 8) y = Math.max(8, Math.min(at.y - GAP - h, innerHeight - 8 - h));
  box.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}
const follow = (x: number, y: number) => { at = { x, y }; if (!frame) frame = requestAnimationFrame(place); };
const cancelClose = () => clearTimeout(closeTimer);
const closeSoon = () => { clearTimeout(closeTimer); closeTimer = window.setTimeout(() => useCard.setState({ open: false }), CLOSE_MS); };
// The rows on the page, by coin, so after a scroll the card can show whichever row is now under the pointer.
const cells = new Map<string, Coin>();
let scrollFrame = 0;
function underPointer() {
  scrollFrame = 0;
  if (!useCard.getState().open) return;
  const el = document.elementFromPoint(at.x, at.y);
  if (!el) return;
  if (el.closest(OWN)) return closeNow();
  const mint = el.closest<HTMLElement>("[data-coin-cell]")?.dataset.coinCell;
  const c = mint ? cells.get(mint) : undefined;
  if (!c) return closeSoon();
  cancelClose();
  if (useCard.getState().mint !== mint) { primeCandles(c.mint); useCard.setState({ mint: c.mint }); }
}
const onScroll = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(underPointer); };
const closeNow = () => { clearTimeout(closeTimer); if (useCard.getState().open) useCard.setState({ open: false }); };
function ensureLayer() {
  if (mounted || typeof document === "undefined") return;
  mounted = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  createRoot(host).render(<Layer />);
}

type Trigger = ReactElement<{ onPointerMove?: (e: unknown) => void; onPointerLeave?: (e: unknown) => void; onPointerDown?: (e: unknown) => void; "data-coin-cell"?: string }>;
export function ChartHover({ coin, children }: { coin: Coin; children: Trigger }) {
  useEffect(() => { cells.set(coin.mint, coin); return () => { if (cells.get(coin.mint) === coin) cells.delete(coin.mint); }; }, [coin]);
  // While the row is on the page its candles are read ahead, so the card opens on them at once.
  useEffect(() => { watchRow(coin.mint); return () => unwatchRow(coin.mint); }, [coin.mint]);
  const move = (e: unknown) => {
    const ev = e as PointerEvent;
    if (ev?.pointerType && ev.pointerType !== "mouse") return;
    if ((ev?.target as Element | null)?.closest?.(OWN)) return closeNow();
    cancelClose();
    follow(ev.clientX, ev.clientY);
    const s = useCard.getState();
    if (s.open) { if (s.mint !== coin.mint) { primeCandles(coin.mint); useCard.setState({ mint: coin.mint }); } return; }
    // Open now, on this very move: no wait for the pointer to rest.
    ensureLayer();
    primeCandles(coin.mint);
    useCard.setState({ mint: coin.mint, open: true });
  };
  const p = children.props;
  return cloneElement(children, {
    "data-coin-cell": coin.mint,
    onPointerMove: (e: unknown) => { p.onPointerMove?.(e); move(e); },
    onPointerLeave: (e: unknown) => { p.onPointerLeave?.(e); closeSoon(); },
    onPointerDown: (e: unknown) => { p.onPointerDown?.(e); closeNow(); },
  });
}

// The one card on the page.
function Layer() {
  const { mint, open } = useCard();
  const [shown, setShown] = useState<string | null>(null);   // kept while the card fades out
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null), last = useRef<string | null>(null);
  useLayoutEffect(() => { box = outer.current; });
  useLayoutEffect(() => {
    if (open && mint) {
      const was = shown;
      setShown(mint);
      place();
      // In: a short fade and slide down from the pointer. Another coin while open: the contents simply change (the
      // new chart is drawn in the same frame); a dip in opacity on the swap read as a blink.
      if (!was) inner.current?.animate([{ opacity: 0, transform: "translateY(-6px) scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 110, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
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
    // Scrolling keeps the card: it shows whichever coin's row is now under the pointer (or goes when none is).
    const away = () => closeNow();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeNow(); };
    addEventListener("scroll", onScroll, true); addEventListener("blur", away); addEventListener("hashchange", away); addEventListener("keydown", key);
    return () => { removeEventListener("scroll", onScroll, true); removeEventListener("blur", away); removeEventListener("hashchange", away); removeEventListener("keydown", key); };
  }, [shown]);
  const m = open && mint ? mint : shown;
  return (
    <div ref={outer} className="pointer-events-none fixed top-0 left-0 z-50 will-change-transform" style={{ width: W, visibility: m ? "visible" : "hidden" }}>
      {m && (
        // Never under the pointer: it takes no events, so the wheel and clicks reach the row beneath.
        <div ref={inner} role="dialog" aria-label="Live chart"
          className="overflow-hidden rounded-[14px] border border-rule-2 bg-paper-2 text-left shadow-sheet ring-1 ring-white/[0.05] ring-inset">
          <Card key={m} mint={m} />
        </div>
      )}
    </div>
  );
}

function Card({ mint }: { mint: string }) {
  const coin = usePulse((s) => s.coins[mint]);
  const now = useNow();
  const [st, setSt] = useState<MiniState | null>(null);
  const [live, setLive] = useState(false);
  // The LIVE badge lights for 10 s after each trade the stream brings.
  useEffect(() => {
    if (!st?.liveAt) return;
    setLive(true);
    const t = window.setTimeout(() => setLive(false), 10_000);
    return () => clearTimeout(t);
  }, [st?.liveAt]);
  if (!coin) return null;
  // The row's own figure first (the card hangs over that row: the two never disagree), the chart's last close when
  // the row has none yet.
  const mc = coin.mcap ?? st?.last?.close ?? null;
  const chg = st?.last && st.first && st.first.open > 0 ? (st.last.close / st.first.open - 1) * 100 : null;
  const up = chg == null || chg >= 0;
  const H = coin.hl || {};
  const holders = H.h ?? coin.holders, top10 = H.t10 ?? coin.top10, dev = H.dev ?? coin.dev;
  const tx = (coin.buys || 0) + (coin.sells || 0), vol = coin.vol ?? coin.liveVol;
  const curve = !coin.graduated, prog = coin.graduated ? 100 : coin.progress != null ? Math.round(coin.progress * 100) : null;
  const pad = padOf(coin), padName = PADS[pad]?.name;
  // How far back the candles on the card reach.
  const span = st?.first && st.last ? ageStr((st.last.time - st.first.time) * 1000) : null;
  return (
    <div className="relative flex flex-col">
      {/* a wash of the move's colour from the top-right corner, so the card reads green or red at a glance */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-[0.16] transition-colors duration-500" style={{ background: `radial-gradient(110% 95% at 100% 0%, var(--color-${up ? "up" : "down"}) 0%, transparent 62%)` }} />
      <header className="relative flex items-center gap-3 px-4 pt-3.5 pb-3">
        <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-[11px] bg-paper-4 text-xs font-semibold text-muted uppercase shadow-[0_2px_8px_-2px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
          {(coin.symbol || "?").slice(0, 3)}<CoinImg mint={mint} preview={false} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <b className="shrink-0 text-[17px] leading-none font-bold tracking-tight text-ink">{(coin.symbol || "").trim() || "?"}</b>
            <span className="min-w-0 truncate text-sm leading-none text-muted">{coin.name}</span>
          </div>
          <div className="flex items-center gap-1.5 overflow-hidden text-xs leading-none whitespace-nowrap text-muted">
            {PADS[pad] && <span className="flex shrink-0 items-center gap-1 text-ink-2"><PadLogo pad={pad} className="size-3 rounded-full" />{padName}</span>}
            {PADS[pad] && <span aria-hidden className="text-rule-2">•</span>}
            <span className="num whitespace-nowrap">{ageStr(now - coin.born)} old</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <b className="num text-[22px] leading-none font-bold tracking-tight text-ink">{mc != null && mc > 0 ? usdP(mc) : "—"}</b>
          {chg != null
            ? <span className={cn("num flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] leading-none font-bold", up ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
                <svg viewBox="0 0 8 8" className={cn("size-2", !up && "rotate-180")} aria-hidden><path d="M4 1.5 7 6H1z" fill="currentColor" /></svg>{pct(Math.abs(chg)).replace(/^[+-]/, "")}{span && <span className="ml-1 font-medium opacity-70">{span}</span>}
              </span>
            : <span className="text-[11px] leading-none text-muted">market cap</span>}
        </div>
      </header>
      <div className="relative mx-2.5 overflow-hidden rounded-[10px] ring-1 ring-white/[0.06]" style={{ height: CHART_H, background: `linear-gradient(180deg, ${CHART_BG[0]} 0%, ${CHART_BG[1]} 100%)` }}>
        <Suspense fallback={null}><MiniChart mint={mint} born={coin.born} onState={setSt} /></Suspense>
        {/* over the chart's top-left: LIVE (lit after a trade) and the candle size */}
        <span className="pointer-events-none absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-[3px] text-[10px] leading-none font-bold tracking-wide backdrop-blur-sm">
          <span className={cn("size-1.5 rounded-full transition-[background-color,box-shadow] duration-300", live ? "bg-up shadow-[0_0_6px_var(--color-up)]" : "bg-muted/60")} aria-hidden />
          <span className={cn(live ? "text-up" : "text-muted")}>{live ? 'LIVE' : st?.last ? 'LAST PRICE' : 'CHART'}</span>
          <span aria-hidden className="text-rule-2">·</span>
          <span className="num text-ink-2">{tfLabel(st?.tf ?? OVERVIEW_TF)}</span>
        </span>
        {/* Never a "loading" word (the user, 2026-10-11): before the first candles the chart's dark ground alone. No
            candles at all once read: nothing traded yet (a failed read is tried again quietly, with a growing wait). */}
        {st?.empty && <span className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-muted">{st.note ? 'Chart data unavailable; retrying' : 'No candles available yet'}</span>}
      </div>
      {/* On the curve: how far to bonding, the same green the row's picture frame fills with. */}
      {curve && prog != null && (
        <div className="mx-4 mt-3 flex items-center gap-2.5 text-xs leading-none text-muted">
          <span className="shrink-0">Bonding</span>
          <i className="relative block h-[5px] flex-1 overflow-hidden rounded-full bg-paper-4">
            <i className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, prog))}%`, background: "linear-gradient(90deg, color-mix(in oklch, var(--color-up) 55%, transparent), var(--color-up))" }} />
          </i>
          <b className="num shrink-0 font-semibold text-ink">{prog}%</b>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-5 gap-y-[7px] px-4 pt-3 pb-3.5 text-[13px]">
        <Line k="Volume 1h" v={vol != null ? compact(vol) : "—"} />
        <Line k="Liquidity" v={coin.liq != null && coin.liq > 0 ? compact(coin.liq) : "—"} />
        <Line k="Trades" v={tx > 0 ? tx.toLocaleString() : "—"} />
        <Line k="Holders" v={holders != null ? holders.toLocaleString() : "—"} />
        <Line k="Fees paid" v={coin.fees != null && coin.fees >= 0 ? <span className="flex items-center gap-1"><SolMark />{coin.fees.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> : "—"} />
        <Line k="Top 10" v={top10 != null ? `${Math.round(top10)}%` : "—"} tone={top10 != null && top10 > 45 ? "text-down" : undefined} />
        <Line k="Dev" v={dev != null ? `${(+dev).toFixed(dev < 10 ? 1 : 0)}%` : "—"} tone={dev != null && dev > 8 ? "text-down" : undefined} />
        <Line k="5m change" v={coin.chg5 != null ? pct(coin.chg5) : "—"} tone={coin.chg5 != null && coin.chg5 !== 0 ? (coin.chg5 > 0 ? "text-up" : "text-down") : undefined} />
      </dl>
    </div>
  );
}

// A label, a dotted leader, and the figure, as on the Discover card.
function Line({ k, v, tone: t }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-muted">{k}</dt>
      <span aria-hidden className="mb-1 min-w-3 flex-1 border-b border-dotted border-rule-2" />
      <dd className={cn("num shrink-0 font-semibold text-ink", t)}>{v}</dd>
    </div>
  );
}
