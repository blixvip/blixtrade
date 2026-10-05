// Axiom's instant trade window: a small panel floating over the page with buy presets in SOL and sell presets
// in percent of the position, each one click. There is no quote step: it fills at the live quote, with fake
// or real SOL by the top bar's Paper switch, through lib/trade.ts like every other buy and sell button.
// Drag it by its title bar. Whether it is open, where it sits and its presets are kept in this browser.
import { useEffect, useRef, useState, type PointerEvent as PE, type ReactNode } from "react";
import { create } from "zustand";
import { SolanaLogo } from "@/components/brand";
import { Tip } from "@/components/ui/tooltip";
import { post } from "@/lib/api";
import { tokN, usdK } from "@/lib/coin";
import { useTrade } from "@/lib/mode";
import { trade } from "@/lib/trade";
import { useMe } from "@/lib/ui";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { CIcon, SolAmt } from "./parts";
import type { Pos } from "./position";

export const useQuick = create<{ open: boolean }>(() => ({ open: store.get("qt:open", false) }));
export const toggleQuick = () => { const open = !useQuick.getState().open; store.set("qt:open", open); useQuick.setState({ open }); };

const SELLS = [25, 50, 75, 100];
type At = { x: number; y: number };

// `docked`: the same panel sitting in the coin page's right column, always there; its pop-out button floats it
// (and the docked one steps aside until the floating one is closed).
export function QuickTrade({ mint, symbol, sizes, pos, onDone, docked = false }: { mint: string; symbol: string; sizes: number[]; pos: Pos; onDone: () => void; docked?: boolean }) {
  const open = useQuick((s) => s.open);
  const paperOn = useTrade((s) => s.paper), wallet = useTrade((s) => s.wallet), me = useMe((s) => s.me);
  const [buys, setBuys] = useState<number[]>(() => store.get("qt:buys", []));
  const [sells, setSells] = useState<number[]>(() => store.get("qt:sells", SELLS));
  const [edit, setEdit] = useState<string[] | null>(null);     // the eight preset fields while editing
  const [busy, setBusy] = useState<string | null>(null);
  const [at, setAt] = useState<At | null>(() => store.get<At | null>("qt:at", null));
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; at: At } | null>(null);
  // Until edited: the paper desk's sizes (the same as the header's quick buys), made up to four.
  const buyP = buys.length === 4 ? buys : [...new Set([...sizes, 0.1, 0.25, 0.5, 1])].slice(0, 4).sort((a, b) => a - b), sellP = sells.length === 4 ? sells : SELLS;

  // Kept inside the window: on first open over the chart's top left, and back in view after a resize.
  const clamp = (p: At): At => {
    const w = box.current?.offsetWidth || 300, h = box.current?.offsetHeight || 230;
    return { x: Math.round(Math.min(Math.max(8, p.x), innerWidth - w - 8)), y: Math.round(Math.min(Math.max(8, p.y), innerHeight - h - 8)) };
  };
  useEffect(() => {
    if (!open || docked) return;
    if (!at) {
      const c = document.querySelector("[data-coin-chart]")?.getBoundingClientRect();
      setAt(clamp(c ? { x: c.left + 12, y: Math.max(c.top + 44, 64) } : { x: 16, y: 120 }));
    }
    const fit = () => setAt((p) => (p ? clamp(p) : p));
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (docked ? open : !open) return null;

  const down = (e: PE<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button,input") || !at) return;
    drag.current = { dx: e.clientX - at.x, dy: e.clientY - at.y, at };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PE<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.at = clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
    setAt(drag.current.at);
  };
  const up = () => { if (drag.current) { store.set("qt:at", drag.current.at); drag.current = null; } };

  const go = async (key: string, buy: boolean, v: number) => {
    if (busy) return;
    setBusy(key);
    const slippageBps = store.get("trade:slip", 300);
    const ok = await trade(buy ? { side: "buy", mint, symbol, sol: v, slippageBps } : { side: "sell", mint, symbol, pct: v, slippageBps },
      // Paper: a buy opens a row at the live quote; a sell takes the same share of every open row.
      async () => {
        if (buy) return post("paper/quoted", { mint, sol: v, slippageBps });
        for (const p of pos.open) await post(`paper/${p.id}/sellq`, { pct: v, why: "instant trade" });
      });
    setBusy(null);
    if (ok) onDone();
  };
  const save = () => {
    if (!edit) return;
    const n = edit.map((x) => Number(x));
    const b = n.slice(0, 4), s = n.slice(4).map((x) => Math.min(100, Math.round(x)));
    if (b.every((x) => x > 0)) { setBuys(b); store.set("qt:buys", b); }
    if (s.every((x) => x > 0)) { setSells(s); store.set("qt:sells", s); }
    setEdit(null);
  };

  const cash = paperOn ? wallet?.cash ?? null : me?.signedIn ? me.wallet?.sol ?? 0 : null;
  const pnlPct = pos.pnl != null && pos.bought ? (pos.pnl / pos.bought) * 100 : null;
  const field = (i: number, suffix: ReactNode) => (
    <label key={i} className="flex h-8 min-w-0 items-center gap-0.5 rounded-control border border-accent/60 bg-paper-3 px-1.5 focus-within:border-accent">
      <input value={edit![i]} onChange={(e) => setEdit((x) => x && x.map((y, j) => (j === i ? e.target.value : y)))} onKeyDown={(e) => e.key === "Enter" && save()}
        inputMode="decimal" aria-label={i < 4 ? `Buy preset ${i + 1} in SOL` : `Sell preset ${i - 3} in percent`}
        className="num w-full min-w-0 bg-transparent text-center text-sm font-semibold text-ink outline-none" />
      <span className="text-[0.625rem] text-muted">{suffix}</span>
    </label>
  );
  const row = (label: string, right: ReactNode) => (
    <div className="flex items-baseline justify-between gap-2 text-xs"><span className="label">{label}</span><span className="num truncate text-muted">{right}</span></div>
  );
  return (
    <div ref={box} role={docked ? "region" : "dialog"} aria-label="Instant trade" style={docked ? undefined : { left: at?.x ?? -9999, top: at?.y ?? 0 }}
      className={docked ? "overflow-hidden rounded-card border border-rule bg-paper-2" : "fixed z-30 w-[min(300px,calc(100vw-16px))] overflow-hidden rounded-card border border-rule-2 bg-paper-2/95 shadow-sheet backdrop-blur-md"}>
      <div onPointerDown={docked ? undefined : down} onPointerMove={docked ? undefined : move} onPointerUp={docked ? undefined : up} onPointerCancel={docked ? undefined : up}
        className={cn("flex h-9 items-center gap-2 border-b border-rule px-3 select-none", !docked && "cursor-grab touch-none active:cursor-grabbing")}>
        <Icon.bolt className="size-3.5 text-accent" />
        <b className="text-sm font-semibold text-ink">Quick buy / sell</b>
        <span className={cn("rounded-chip border px-1 text-[0.625rem] font-bold", paperOn ? "border-warn/50 text-warn" : "border-up/50 text-up")}>{paperOn ? "PAPER" : "REAL"}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <Tip tip={edit ? "Save presets" : "Edit presets"}>
            <button onClick={() => (edit ? save() : setEdit([...buyP, ...sellP].map(String)))} aria-label={edit ? "Save presets" : "Edit presets"}
              className={cn("grid size-6 place-items-center rounded-chip hover:bg-paper-4", edit ? "text-accent" : "text-muted hover:text-ink")}>
              {edit ? <CIcon.check className="size-3.5" /> : <CIcon.pencil className="size-3.5" />}
            </button>
          </Tip>
          <Tip tip={docked ? "Pop out: float this panel over the chart" : "Dock it back in the side column"}>
            <button onClick={toggleQuick} aria-label={docked ? "Pop out quick trade" : "Dock quick trade"} className="grid size-6 place-items-center rounded-chip text-muted hover:bg-paper-4 hover:text-ink">
              {docked ? <CIcon.window className="size-3.5" /> : <Icon.x className="size-3.5" />}</button>
          </Tip>
        </span>
      </div>

      <div className="flex flex-col gap-2 p-3">
        {row("Buy", cash == null ? (paperOn ? "" : "not signed in") : <SolAmt v={cash} />)}
        <div className="grid grid-cols-4 gap-1.5">
          {edit ? buyP.map((_, i) => field(i, "SOL")) : buyP.map((v, i) => (
            <button key={i} disabled={busy != null} onClick={() => go(`b${i}`, true, v)}
              className="num inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-control border border-up/40 bg-up/10 text-sm font-semibold text-up transition-colors hover:bg-up/20 active:scale-[0.97] disabled:opacity-50">
              {busy === `b${i}` ? "…" : <><SolanaLogo className="w-[0.85em]" />{v}</>}
            </button>
          ))}
        </div>
        {row("Sell", pos.canSell ? (pos.tokens ? `${tokN(pos.tokens)} ${symbol}` : <SolAmt v={pos.holding} />) : "nothing held")}
        <div className="grid grid-cols-4 gap-1.5">
          {edit ? sellP.map((_, i) => field(i + 4, "%")) : sellP.map((v, i) => (
            <button key={i} disabled={busy != null || !pos.canSell} onClick={() => go(`s${i}`, false, v)}
              className="num h-8 min-w-0 rounded-control border border-down/40 bg-down/10 text-sm font-semibold text-down transition-colors hover:bg-down/20 active:scale-[0.97] disabled:opacity-40">
              {busy === `s${i}` ? "…" : `${v}%`}
            </button>
          ))}
        </div>
      </div>

      <div className="num flex items-center gap-x-3 gap-y-1 border-t border-rule px-3 py-2 text-xs text-muted">
        {pos.has ? (
          <>
            <span>Avg buy <b className="font-semibold text-ink-2">{usdK(pos.entry)}</b></span>
            {pos.exit != null && <span>Avg sell <b className="font-semibold text-ink-2">{usdK(pos.exit)}</b></span>}
            <span className="ml-auto">PnL <b className={cn("font-semibold", (pos.pnl ?? 0) >= 0 ? "text-up" : "text-down")}>{pos.pnl == null ? "—" : <SolAmt v={pos.pnl} signed />}</b>
              {pnlPct != null && <span className={(pos.pnl ?? 0) >= 0 ? "text-up" : "text-down"}> {pnlPct >= 0 ? "+" : "−"}{Math.abs(pnlPct).toFixed(0)}%</span>}</span>
          </>
        ) : <span>One click buys or sells at the live quote{paperOn ? " with fake SOL" : ""}.</span>}
      </div>
    </div>
  );
}
