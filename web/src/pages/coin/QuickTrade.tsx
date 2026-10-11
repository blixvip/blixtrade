// Axiom's instant trade window: a small panel floating over the page with buy presets in SOL and sell presets
// in percent of the position, each one click. There is no quote step: it fills at the live quote, with fake
// or real SOL by the top bar's Paper switch, through lib/trade.ts like every other buy and sell button.
// Drag it by its title bar. Whether it is open, where it sits and its presets are kept in this browser.
import { useEffect, useRef, useState, type PointerEvent as PE, type ReactNode } from "react";
import { create } from "zustand";
import { Tip } from "@/components/ui/tooltip";
import { post } from "@/lib/api";
import { tokN, usdK } from "@/lib/coin";
import { setPaper, useTrade } from "@/lib/mode";
import { openExchange } from "@/lib/modals";
import { trade } from "@/lib/trade";
import { useMe } from "@/lib/ui";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { CIcon, SolAmt } from "./parts";
import { usePic } from "@/lib/pics";
import type { Pos } from "./position";
import { usePositionCard } from "./PnlShare";
import { MigratingNote, MIGRATING_TIP } from "@/components/Migrating";

import { useQuick, toggleQuick } from "@/lib/quick";

const SELLS = [25, 50, 75, 100];
type At = { x: number; y: number };
// Axiom's P1 / P2 / P3: three sets of presets, one picked at a time, each with its own buy sizes, sell shares and
// slippage. Empty buys: the paper desk's sizes (below). The first set starts from what the panel kept before.
type Preset = { buys: number[]; sells: number[]; slip: number };
const SLIP_DEFAULT = 300;
const loadPresets = (): Preset[] => {
  const kept = store.get<Preset[] | null>("qt:presets", null);
  if (Array.isArray(kept) && kept.length === 3) return kept;
  const first: Preset = { buys: store.get("qt:buys", []), sells: store.get("qt:sells", SELLS), slip: store.get("trade:slip", SLIP_DEFAULT) };
  return [first, { buys: [], sells: SELLS, slip: 1000 }, { buys: [], sells: SELLS, slip: 2500 }];
};
const slipTxt = (bps: number) => `${+(bps / 100).toFixed(2)}%`;
// One store for every copy of the panel (the docked one stays mounted while the floating one is out), so an edit
// or a pick in one is the same in the other.
const usePresets = create<{ list: Preset[]; pi: number }>(() => ({ list: loadPresets(), pi: Math.min(2, Math.max(0, store.get("qt:preset", 0))) }));
const pickPreset = (pi: number) => { store.set("qt:preset", pi); usePresets.setState({ pi }); };
const savePreset = (next: Preset) => { const list = usePresets.getState().list.map((p, i) => (i === usePresets.getState().pi ? next : p)); store.set("qt:presets", list); usePresets.setState({ list }); };
// A preset field's text is good: a buy above 0 SOL (at most 1000), a sell 1-100 %, slippage 0.1-50 %.
const fieldOk = (i: number, text: string) => {
  const v = Number(text);
  if (!text.trim() || !isFinite(v)) return false;
  return i < 4 ? v > 0 && v <= 1000 : i < 8 ? v >= 1 && v <= 100 : v >= 0.1 && v <= 50;
};

// `docked`: the same panel sitting in the coin page's right column, always there; its pop-out button floats it
// (and the docked one steps aside until the floating one is closed).
// `migrating`: when the coin's curve filled while its pool is not live yet (components/Migrating.tsx): nothing trades.
export function QuickTrade({ mint, symbol, sizes, pos, onDone, docked = false, away = false, migrating = null }: { mint: string; symbol: string; sizes: number[]; pos: Pos; onDone: () => void; docked?: boolean; away?: boolean; migrating?: number | null }) {
  const open = useQuick((s) => s.open);
  const paperOn = useTrade((s) => s.paper), wallet = useTrade((s) => s.wallet), me = useMe((s) => s.me);
  const presets = usePresets((s) => s.list), pi = usePresets((s) => s.pi);
  const pick = (i: number) => { pickPreset(i); setEdit(null); };
  const { buys, sells, slip } = presets[pi];
  const [edit, setEdit] = useState<string[] | null>(null);     // the nine preset fields while editing (4 buys, 4 sells, slippage %)
  const [busy, setBusy] = useState<string | null>(null);
  const pendingBuys = useRef(0);   // buys pressed and not settled yet
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
  // The live PnL card (./PnlShare.tsx): the header's card icon and the PnL figure open it. (A hook: above the
  // early return below, so the panel calls the same hooks whether it is showing or not.)
  const pnlCard = usePositionCard(pos, mint, symbol);
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

  // Buys can be pressed again and again (spam buying: lib/trade.ts lines them up, one after another); a sell waits
  // until nothing is going. The pressed button spins until the last of its buys has settled.
  const go = async (key: string, buy: boolean, v: number) => {
    if (busy && !buy) return;
    if (buy) pendingBuys.current++;
    setBusy(key);
    const slippageBps = slip;
    const ok = await trade(buy ? { side: "buy", mint, symbol, sol: v, slippageBps } : { side: "sell", mint, symbol, pct: v, slippageBps },
      // Paper: a buy opens a row at the live quote; a sell takes the same share of every open row.
      async () => {
        if (buy) return post("paper/quoted", { mint, sol: v, slippageBps });
        for (const p of pos.open) await post(`paper/${p.id}/sellq`, { pct: v, why: "instant trade" });
      });
    if (buy && --pendingBuys.current > 0) { if (ok) onDone(); return; }
    setBusy(null);
    if (ok) onDone();
  };
  // Saved only when every field is good; a bad one stays open, outlined red, with what it takes in its tooltip.
  const save = () => {
    if (!edit || !edit.every((x, i) => fieldOk(i, x))) return;
    const n = edit.map((x) => Number(x));
    savePreset({ buys: n.slice(0, 4).sort((x, y) => x - y), sells: n.slice(4, 8).map((x) => Math.round(x)), slip: Math.round(n[8] * 100) });
    setEdit(null);
  };

  const cash = paperOn ? wallet?.cash ?? null : me?.signedIn ? me.wallet?.sol ?? 0 : null;
  const pnlPct = pos.pnl != null && pos.bought ? (pos.pnl / pos.bought) * 100 : null;
  const field = (i: number, suffix: ReactNode) => (
    <label key={i} title={fieldOk(i, edit![i]) ? undefined : i < 4 ? "More than 0 SOL" : i < 8 ? "1 to 100 %" : "0.1 to 50 %"}
      className={cn("flex h-10 min-w-0 items-center gap-0.5 rounded-lg border bg-paper px-1.5 transition-colors", fieldOk(i, edit![i]) ? "border-white/15 focus-within:border-white/35" : "border-down/70")}>
      <input value={edit![i]} onChange={(e) => setEdit((x) => x && x.map((y, j) => (j === i ? e.target.value : y)))}
        onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }}
        inputMode="decimal" aria-label={i < 4 ? `Buy preset ${i + 1} in SOL` : i < 8 ? `Sell preset ${i - 3} in percent` : "Slippage in percent"}
        className="num w-full min-w-0 bg-transparent text-center text-sm font-semibold text-ink outline-none" />
      <span className="text-[0.625rem] text-muted">{suffix}</span>
    </label>
  );
  // Buttons: calm dark tiles, the figure in its side's colour (green buys, red sells); hovering lights the tile in
  // that colour. One that can't trade right now (not enough SOL, nothing held) stays dim; a buy short of SOL opens
  // Deposit instead (live), a sell with nothing held does nothing.
  const btn = (side: "buy" | "sell", can: boolean) => cn("num group relative inline-flex h-10 min-w-0 items-center justify-center gap-1 overflow-hidden rounded-lg border border-white/[0.06] bg-paper text-[0.9375rem] leading-none font-semibold",
    "transition-[background-color,border-color,box-shadow,transform,color] duration-150 active:scale-[0.96]",
    side === "buy" ? "text-up" : "text-down",
    can ? (side === "buy" ? "hover:border-up/45 hover:bg-up/[0.1] hover:shadow-[0_0_16px_-6px_var(--color-up)]" : "hover:border-down/45 hover:bg-down/[0.1] hover:shadow-[0_0_16px_-6px_var(--color-down)]")
      : "cursor-default opacity-40 active:scale-100");
  const broke = !paperOn && cash != null && cash < Math.min(...buyP);
  const row = (label: string, tone: string, right: ReactNode) => (
    <div className="flex items-center justify-between gap-2 px-0.5 text-xs">
      <span className={cn("font-semibold", tone)}>{label}</span>
      <span className="num truncate text-muted">{right}</span>
    </div>
  );
  const spin = <i className="size-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current" />;
  return (
    <div ref={box} role={docked ? "region" : "dialog"} aria-label="Instant trade" style={docked ? undefined : { left: at?.x ?? -9999, top: at?.y ?? 0 }}
      className={cn("overflow-hidden rounded-2xl border border-white/[0.07] bg-paper-2",
        docked ? "" : "fixed z-30 w-[min(312px,calc(100vw-16px))] bg-paper-2/90 shadow-[0_24px_60px_-16px_oklch(0%_0_0/0.8),inset_0_1px_0_oklch(100%_0_0/0.05)] backdrop-blur-xl")}>
      <div onPointerDown={docked ? undefined : down} onPointerMove={docked ? undefined : move} onPointerUp={docked ? undefined : up} onPointerCancel={docked ? undefined : up}
        className={cn("flex h-11 items-center gap-2 border-b border-white/[0.05] pr-2 pl-3.5 select-none", !docked && "cursor-grab touch-none active:cursor-grabbing")}>
        <Icon.bolt className="size-4 shrink-0 text-ink-2" />
        {away ? (
          <a href={`#/coin/${mint}`} title={`Open ${symbol}`} className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink hover:text-accent">
            <CoinPic mint={mint} symbol={symbol} className="size-5" /><span className="truncate">{symbol}</span>
            {pos.mcapNow != null && <span className="num text-xs font-medium text-muted">{usdK(pos.mcapNow)}</span>}
          </a>
        ) : <b className="text-sm font-semibold tracking-tight text-ink">Quick trade</b>}
        <span className={cn("flex items-center gap-1 rounded-[5px] px-1.5 py-px text-[10px] font-bold tracking-[0.08em]",
          paperOn ? "bg-info/15 text-info shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-info)_25%,transparent)]" : "bg-up/12 text-up shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-up)_25%,transparent)]")}>
          {!paperOn && <i className="size-1.5 rounded-full bg-up motion-safe:animate-pulse" />}{paperOn ? "PAPER" : "LIVE"}</span>
        <span className="ml-auto flex items-center">
          <Tip tip="PnL card: your live result as a picture to save or share">
            <button onClick={pnlCard.open} aria-label="PnL card" className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.07] hover:text-ink"><Icon.image className="size-3.5" /></button>
          </Tip>
          <Tip tip={edit ? "Save presets" : "Edit presets"}>
            <button onClick={() => (edit ? save() : setEdit([...buyP, ...sellP, slip / 100].map(String)))} aria-label={edit ? "Save presets" : "Edit presets"}
              disabled={edit != null && !edit.every((x, i) => fieldOk(i, x))}
              className={cn("grid size-7 place-items-center rounded-lg transition-colors hover:bg-white/[0.07] disabled:opacity-40", edit ? "bg-up/15 text-up" : "text-muted hover:text-ink")}>
              {edit ? <CIcon.check className="size-3.5" /> : <CIcon.pencil className="size-3.5" />}
            </button>
          </Tip>
          <Tip tip={docked ? "Pop out: float this panel over the chart (it closes when you leave the coin)" : away ? "Close" : "Dock it back in the side column"}>
            <button onClick={toggleQuick} aria-label={docked ? "Pop out quick trade" : away ? "Close quick trade" : "Dock quick trade"} className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.07] hover:text-ink">
              {docked ? <CIcon.window className="size-3.5" /> : <Icon.close className="size-3.5" />}</button>
          </Tip>
        </span>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <div role="tablist" aria-label="Preset set" className="flex items-center gap-0.5 rounded-lg bg-paper p-0.5">
            {presets.map((_, i) => (
              <button key={i} role="tab" aria-selected={pi === i} onClick={() => pick(i)}
                className={cn("h-6 rounded-md px-2.5 text-xs font-semibold transition-colors duration-150", pi === i ? "bg-paper-5 text-ink shadow-[inset_0_1px_0_oklch(100%_0_0/0.08)]" : "text-muted hover:text-ink-2")}>P{i + 1}</button>
            ))}
          </div>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Icon.sliders className="size-3.5" />Slippage
            {edit ? <span className="w-16">{field(8, "%")}</span> : <b className="num font-semibold text-ink-2">{slipTxt(slip)}</b>}
          </span>
        </div>

        {migrating ? <MigratingNote since={migrating} /> : null}
        <div className="flex flex-col gap-1.5">
          {row("Buy", "text-up", cash == null ? (paperOn ? "" : "Not signed in") : <SolAmt v={cash} />)}
          <div className="grid grid-cols-4 gap-1.5">
            {edit ? buyP.map((_, i) => field(i, "SOL")) : buyP.map((v, i) => {
              const short = cash != null && v > cash;
              if (migrating) return <button key={i} aria-disabled title={MIGRATING_TIP} className={btn("buy", false)}>{v}</button>;
              return (
                <button key={i} aria-disabled={short || undefined} title={short ? (paperOn ? `Only ${+cash!.toFixed(3)} SOL to spend` : "Not enough SOL: deposit to buy") : `Buy ${v} SOL of ${symbol} · ${slipTxt(slip)} slippage`}
                  onClick={() => { if (short) { if (!paperOn) openExchange("deposit"); return; } void go(`b${i}`, true, v); }}
                  className={btn("buy", !short)}>
                  {busy === `b${i}` ? spin : v}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          {row("Sell", "text-down", pos.canSell ? (pos.tokens ? `${tokN(pos.tokens)} ${symbol}` : <SolAmt v={pos.holding} />) : "Nothing held")}
          <div className="grid grid-cols-4 gap-1.5">
            {edit ? sellP.map((_, i) => field(i + 4, "%")) : sellP.map((v, i) => (
              migrating ? <button key={i} aria-disabled title={MIGRATING_TIP} className={btn("sell", false)}>{`${v}%`}</button> :
              <button key={i} aria-disabled={!pos.canSell || undefined} title={pos.canSell ? `Sell ${v}% of your ${symbol} · ${slipTxt(slip)} slippage` : "Buy first, then sell from here"}
                onClick={() => { if (!busy && pos.canSell) void go(`s${i}`, false, v); }}
                className={btn("sell", pos.canSell)}>
                {busy === `s${i}` ? spin : `${v}%`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pnlCard.dialog}
      <div className="num flex min-h-10 items-center gap-x-3 gap-y-1 border-t border-white/[0.05] px-3.5 py-2 text-xs text-muted">
        {pos.has ? (
          <>
            <span>Avg buy <b className="font-semibold text-ink-2">{usdK(pos.entry)}</b></span>
            {pos.exit != null && <span>Avg sell <b className="font-semibold text-ink-2">{usdK(pos.exit)}</b></span>}
            <button onClick={pnlCard.open} title="Open your PnL card"
              className={cn("ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold transition-colors", (pos.pnl ?? 0) >= 0 ? "bg-up/10 text-up hover:bg-up/15" : "bg-down/10 text-down hover:bg-down/15")}>
              {pos.pnl == null ? "—" : <><SolAmt v={pos.pnl} signed /></>}
              {pnlPct != null && <span className="opacity-80">{pnlPct >= 0 ? "+" : "−"}{Math.abs(pnlPct).toFixed(0)}%</span>}
            </button>
          </>
        ) : broke ? (
          <span className="flex w-full items-center gap-1.5"><span className="mr-auto">No SOL yet</span>
            <button onClick={() => setPaper(true)} className="h-7 rounded-full px-2.5 font-semibold text-info transition-colors hover:bg-info/10">Try paper</button>
            <button onClick={() => openExchange("deposit")} className="h-7 rounded-full bg-ink px-3 font-semibold text-paper transition-transform duration-100 hover:bg-white active:scale-[0.97]">Deposit</button></span>
        ) : <span>One click trades at the live quote{paperOn ? " with fake SOL" : ""}.</span>}
      </div>
    </div>
  );
}

function CoinPic({ mint, symbol, className }: { mint: string; symbol: string; className?: string }) {
  const pic = usePic(mint);
  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-paper-4 text-[0.5rem] font-bold text-muted uppercase", className)}>
      {symbol.slice(0, 2)}
      {pic.src && <img key={pic.key} src={pic.src} alt="" className={cn("absolute inset-0 size-full object-cover", !pic.ok && "invisible")} onLoad={pic.onLoad} onError={pic.onError} />}
    </span>
  );
}

