// The card that opens when the pointer rests on a Discover coin's pair cell, like Axiom's: the coin's
// DexScreener banner (its own picture, blurred, when it has none), picture, ticker, market cap and change, then
// volume, liquidity, holders, top 10, dev, age and the contract with a copy button, and a watchlist star.
// It opens 220 ms after the pointer rests on the pair cell (not on its own links, buttons or faces), beside it, stays while
// the pointer is on the cell or the card, and closes
// 150 ms after it has left both. One card at a time on the page; scrolling closes it.
import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PumpLogo, SolanaLogo } from "@/components/brand";
import { CoinImg } from "@/components/page";
import { toast } from "@/components/ui/toast";
import { ageStr, compact, pct, shortAddr, tone } from "@/lib/format";
import { useLiveMc } from "@/lib/livepx";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { pick, type Row, type Tf } from "./parts";

const W = 300, H = 400;   // the card's width and (about) its height
let closeOthers: (() => void) | null = null;

type Trigger = ReactElement<{ onPointerMove?: (e: unknown) => void; onPointerLeave?: (e: unknown) => void; ref?: unknown }>;
// Inside the trigger, these keep their own hover (links, the X card, buttons, the known-holder faces): no coin card there.
const OWN = "a, button, [data-known-holders]";
export function CoinHover({ r, tf, children }: { r: Row; tf: Tf; children: Trigger }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const anchor = useRef<HTMLElement | null>(null), timer = useRef(0), waiting = useRef(false), open = useRef(false);
  open.current = pos != null;
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = () => { clearTimeout(timer.current); waiting.current = false; setPos(null); };
  // Every move over the trigger: on one of its own controls the card goes away; anywhere else it opens after a pause.
  const move = (e: unknown) => {
    const ev = e as PointerEvent;
    if (ev?.pointerType && ev.pointerType !== "mouse") return;
    if ((ev?.target as Element | null)?.closest?.(OWN)) { if (open.current || waiting.current) close(); return; }
    if (open.current) { clearTimeout(timer.current); return; }
    if (waiting.current) return;
    waiting.current = true;
    timer.current = window.setTimeout(() => {
      waiting.current = false;
      const el = anchor.current;
      if (!el) return;
      if (closeOthers && closeOthers !== close) closeOthers();
      closeOthers = close;
      // Beside the cell, level with its row, so moving down the column goes from coin to coin (not onto the card).
      const b = el.getBoundingClientRect();
      const left = b.right + 8 + W <= innerWidth - 10 ? b.right + 8 : Math.max(10, b.left - W - 8);
      setPos({ left, top: Math.max(10, Math.min(b.top - 6, innerHeight - H - 10)) });
    }, 220);
  };
  const leave = () => { clearTimeout(timer.current); waiting.current = false; timer.current = window.setTimeout(close, 150); };
  useEffect(() => { if (!pos) return; const s = () => close(); addEventListener("scroll", s, true); return () => removeEventListener("scroll", s, true); }, [pos]);
  const p = children.props;
  const trigger = cloneElement(children, {
    ref: (el: HTMLElement | null) => { anchor.current = el; },
    onPointerMove: (e: unknown) => { p.onPointerMove?.(e); move(e); },
    onPointerLeave: (e: unknown) => { p.onPointerLeave?.(e); leave(); },
  });
  return (
    <>
      {trigger}
      {pos && createPortal(
        // Clicks inside the card stay in it (the row under the trigger opens the coin on click).
        <div role="dialog" aria-label={`${r.symbol || "Coin"} details`} onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={leave} onClick={(e) => e.stopPropagation()}
          className="fixed z-50 animate-row-in overflow-hidden rounded-card border border-rule-2 bg-paper-2 text-left shadow-sheet" style={{ ...pos, width: W }}>
          <Card r={r} tf={tf} />
        </div>, document.body)}
    </>
  );
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
  const copy = () => navigator.clipboard?.writeText(r.mint).then(() => toast("Contract copied"), () => toast("Couldn't copy the contract"));
  return (
    <div className="flex flex-col">
      {/* banner: DexScreener's header when the coin paid for one, else its own picture blurred */}
      <div className="relative h-[88px] overflow-hidden bg-paper-4">
        {r.header
          ? <img src={r.header} alt="" className="absolute inset-0 size-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
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
