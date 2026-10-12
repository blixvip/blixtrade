// Axiom's instant trade window: a small panel floating over the page with buy presets in SOL and sell presets
// in percent of the position, each one click. There is no quote step: it fills at the live quote, with fake
// or real SOL by the top bar's Paper switch, through lib/trade.ts like every other buy and sell button.
// Drag it by its title bar. Whether it is open, where it sits and its presets are kept in this browser.
// The look (the user, 2026-10-12: "take inspiration from the apple design"): iOS dark grouped surfaces, segmented
// controls on a dim track, tinted green and red fills for the tiles, round grey corner buttons, blue for the one action.
import { useEffect, useRef, useState, type PointerEvent as PE, type ReactNode } from "react";
import { create } from "zustand";
import { Tip } from "@/components/ui/tooltip";
import { SolanaLogo } from "@/components/brand";
import { post } from "@/lib/api";
import { tokN, usdK } from "@/lib/coin";
import { setCur, setPaper, useCur, USDC_MINT, USDC_SIZES, useTrade } from "@/lib/mode";
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
type Preset = { buys: number[]; buysUsdc?: number[]; sells: number[]; slip: number };   // buysUsdc: the buy sizes while trading in USDC
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
  return i < 4 ? v > 0 && v <= 100_000 : i < 8 ? v >= 1 && v <= 100 : v >= 0.1 && v <= 50;   // a USDC preset can run to five figures
};

// `docked`: the same panel sitting in the coin page's right column, always there; its pop-out button floats it
// (and the docked one steps aside until the floating one is closed).
// `migrating`: when the coin's curve filled while its pool is not live yet (components/Migrating.tsx): nothing trades.
export function QuickTrade({ mint, symbol, sizes, pos, onDone, docked = false, away = false, migrating = null }: { mint: string; symbol: string; sizes: number[]; pos: Pos; onDone: () => void; docked?: boolean; away?: boolean; migrating?: number | null }) {
  const open = useQuick((s) => s.open);
  const paperOn = useTrade((s) => s.paper), wallet = useTrade((s) => s.wallet), me = useMe((s) => s.me);
  const presets = usePresets((s) => s.list), pi = usePresets((s) => s.pi);
  const pick = (i: number) => { pickPreset(i); setEdit(null); };
  const { buys, buysUsdc, sells, slip } = presets[pi];
  // In USDC (Axiom's switch, shared with the coin page's panel): the buys are USDC sizes with presets of their own,
  // and a sell is paid in USDC.
  const cur = useCur((s) => s.cur), inUsdc = cur === "USDC";
  const [edit, setEdit] = useState<string[] | null>(null);     // the nine preset fields while editing (4 buys, 4 sells, slippage %)
  const [busy, setBusy] = useState<string | null>(null);
  const pendingBuys = useRef(0);   // buys pressed and not settled yet
  const [at, setAt] = useState<At | null>(() => store.get<At | null>("qt:at", null));
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; at: At } | null>(null);
  // Until edited: the paper desk's sizes (the same as the header's quick buys), made up to four.
  const buyP = inUsdc ? (buysUsdc?.length === 4 ? buysUsdc : USDC_SIZES) : buys.length === 4 ? buys : [...new Set([...sizes, 0.1, 0.25, 0.5, 1])].slice(0, 4).sort((a, b) => a - b), sellP = sells.length === 4 ? sells : SELLS;

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
    const money = inUsdc ? { usdc: v } : { sol: v };
    const ok = await trade(buy ? { side: "buy", mint, symbol, ...money, slippageBps } : { side: "sell", mint, symbol, pct: v, to: cur, slippageBps },
      // Paper: a buy opens a row at the live quote; a sell takes the same share of every open row.
      async () => {
        if (buy) return post("paper/quoted", { mint, ...money, slippageBps });
        for (const p of pos.open) await post(`paper/${p.id}/sellq`, { pct: v, why: "instant trade" });
      });
    if (buy && --pendingBuys.current > 0) { if (ok) onDone(); return; }
    setBusy(null);
    if (ok) onDone();
  };
  // Saved only when every field is good; a bad one stays open, outlined red, with what it takes in its tooltip.
  const save = () => {
    if (!edit || !edit.every((x, i) => fieldOk(i, x))) return;
    const n = edit.map((x) => Number(x)), sized = n.slice(0, 4).sort((x, y) => x - y);
    // The buy sizes edited are the money shown: SOL ones, or the USDC ones, the other kept.
    savePreset({ buys: inUsdc ? buys : sized, buysUsdc: inUsdc ? sized : buysUsdc, sells: n.slice(4, 8).map((x) => Math.round(x)), slip: Math.round(n[8] * 100) });
    setEdit(null);
  };

  // What there is to buy with, in the money picked: SOL, or USDC (the paper desk's SOL as USDC at the live price).
  const cash = inUsdc
    ? paperOn ? (wallet && wallet.solUsd > 0 ? wallet.cash * wallet.solUsd : null) : me?.signedIn ? me.wallet?.tokens?.find((t) => t.mint === USDC_MINT)?.ui ?? 0 : null
    : paperOn ? wallet?.cash ?? null : me?.signedIn ? me.wallet?.sol ?? 0 : null;
  const usdcTxt = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2));
  const pnlPct = pos.pnl != null && pos.bought ? (pos.pnl / pos.bought) * 100 : null;
  // The money's mark, in front of every size and figure: the Solana logomark or the USDC coin.
  const mark = (cls: string) => (inUsdc ? <img src="brand/pay/usdc.png" alt="" className={cn("shrink-0 rounded-full", cls)} /> : <SolanaLogo className={cn("shrink-0", cls)} />);
  // An iOS segmented control: a dim track, the picked segment lifted on a grey thumb.
  const seg = (on: boolean, h = "h-7") => cn("num flex items-center justify-center gap-1 rounded-[7px] px-2.5 text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-200 ease-out", h,
    on ? "bg-[#636366] text-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)]" : "text-[#ebebf5]/60 hover:text-[#ebebf5]/85");
  const track = "flex items-center gap-0.5 rounded-[9px] bg-[rgba(118,118,128,0.24)] p-[2px]";
  // A preset field while editing: the same rounded fill as a tile, the figure typed in white, the unit beside it.
  const field = (i: number, suffix: ReactNode) => (
    <label key={i} title={fieldOk(i, edit![i]) ? undefined : i < 4 ? `More than 0 ${cur}` : i < 8 ? "1 to 100 %" : "0.1 to 50 %"}
      className={cn("num flex h-12 min-w-0 items-center gap-0.5 rounded-[12px] px-2 transition-shadow duration-150",
        fieldOk(i, edit![i]) ? "bg-[rgba(120,120,128,0.2)] focus-within:shadow-[0_0_0_2px_#0a84ff]" : "bg-[rgba(255,69,58,0.14)] shadow-[0_0_0_2px_rgba(255,69,58,0.6)]")}>
      <input value={edit![i]} onChange={(e) => setEdit((x) => x && x.map((y, j) => (j === i ? e.target.value : y)))}
        onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }}
        inputMode="decimal" aria-label={i < 4 ? `Buy preset ${i + 1} in ${cur}` : i < 8 ? `Sell preset ${i - 3} in percent` : "Slippage in percent"}
        className="w-full min-w-0 bg-transparent text-center text-[17px] font-semibold text-white outline-none" />
      {suffix != null && <span className="text-[11px] font-medium text-[#ebebf5]/50">{suffix}</span>}
    </label>
  );
  // Tiles: Apple's tinted fills, green for a buy and red for a sell, the figure in the same colour. Hover deepens the
  // tint, the press shrinks it. One that can't trade right now (not enough SOL, nothing held) is faded; a buy short
  // of SOL opens Deposit instead (live), a sell with nothing held does nothing.
  const tile = (side: "buy" | "sell", can: boolean) => cn("num flex h-12 min-w-0 items-center justify-center gap-1 rounded-[12px] text-[17px] leading-none font-semibold tracking-[-0.01em] transition-[background-color,transform,opacity] duration-150 ease-out",
    side === "buy" ? "bg-[rgba(48,209,88,0.15)] text-[#30d158]" : "bg-[rgba(255,69,58,0.15)] text-[#ff453a]",
    can ? cn("active:scale-[0.96]", side === "buy" ? "hover:bg-[rgba(48,209,88,0.26)]" : "hover:bg-[rgba(255,69,58,0.26)]") : "cursor-not-allowed opacity-30");
  const broke = !paperOn && cash != null && cash < Math.min(...buyP);
  const spin = <i className="size-4 animate-spin rounded-full border-2 border-current/25 border-t-current" />;
  // The round grey buttons of a sheet's corner.
  const roundBtn = "grid size-7 place-items-center rounded-full bg-[rgba(120,120,128,0.24)] text-[#ebebf5]/70 transition-[background-color,color,transform] duration-150 hover:bg-[rgba(120,120,128,0.4)] hover:text-white active:scale-95";
  const secondary = "text-[13px] text-[#ebebf5]/60";
  // A group's top line: its side, then what there is on that side (the balance, or the holding).
  const line = (left: ReactNode, right: ReactNode) => (
    <div className="flex h-7 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2.5">{left}</span>
      <span className={cn("num flex min-w-0 items-center gap-1 truncate", secondary)}>{right}</span>
    </div>
  );
  // The money: buys sized in SOL or in USDC, sells paid in it (one setting with the coin page's panel). A two-way
  // switch with both names showing, beside the buy sizes it changes, so it reads as a choice and not as a label.
  const curSwitch = (
    <div role="radiogroup" aria-label="Trade in SOL or USDC" className={cn(track, "shrink-0")}>
      {(["SOL", "USDC"] as const).map((c) => (
        <Tip key={c} tip={c === "SOL" ? "Buys sized in SOL, sells paid in SOL" : "Buys sized in USDC, sells paid in USDC"}>
          <button role="radio" aria-checked={cur === c} onClick={() => setCur(c)} className={cn(seg(cur === c, "h-6"), "px-2 text-[12px]")}>
            {c === "USDC" ? <img src="brand/pay/usdc.png" alt="" className={cn("size-3.5 rounded-full", cur !== c && "opacity-50 grayscale")} /> : <SolanaLogo className={cn("size-3.5", cur !== c && "opacity-50 grayscale")} />}{c}
          </button>
        </Tip>
      ))}
    </div>
  );
  return (
    <div ref={box} role={docked ? "region" : "dialog"} aria-label="Instant trade" style={docked ? undefined : { left: at?.x ?? -9999, top: at?.y ?? 0 }}
      className={cn("overflow-hidden rounded-[18px] bg-[#1c1c1e] font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Text','Segoe_UI_Variable_Text','Segoe_UI',system-ui,sans-serif] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]",
        !docked && "fixed z-30 w-[min(324px,calc(100vw-16px))] shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_30px_60px_-12px_rgba(0,0,0,0.75)]")}>
      {/* The title bar: what this is, whose money, and the round controls. Drag it when floating. */}
      <div onPointerDown={docked ? undefined : down} onPointerMove={docked ? undefined : move} onPointerUp={docked ? undefined : up} onPointerCancel={docked ? undefined : up}
        className={cn("flex h-13 items-center gap-2.5 px-4 select-none", !docked && "cursor-grab touch-none active:cursor-grabbing")}>
        {away ? (
          <a href={`#/coin/${mint}`} title={`Open ${symbol}`} className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-white hover:text-[#0a84ff]">
            <CoinPic mint={mint} symbol={symbol} className="size-6" /><span className="truncate">{symbol}</span>
            {pos.mcapNow != null && <span className={cn("num font-medium", secondary)}>{usdK(pos.mcapNow)}</span>}
          </a>
        ) : <b className="text-[15px] font-semibold tracking-[-0.01em]">Quick trade</b>}
        <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-semibold", paperOn ? "bg-[rgba(10,132,255,0.18)] text-[#64aaff]" : "bg-[rgba(48,209,88,0.18)] text-[#30d158]")}>
          <i className={cn("size-1.5 rounded-full", paperOn ? "bg-[#0a84ff]" : "bg-[#30d158] motion-safe:animate-pulse")} />{paperOn ? "Paper" : "Live"}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <Tip tip="PnL card: your live result as a picture to save or share">
            <button onClick={pnlCard.open} aria-label="PnL card" className={roundBtn}><Icon.image className="size-3.5" /></button>
          </Tip>
          <Tip tip={edit ? "Save presets" : "Edit presets"}>
            <button onClick={() => (edit ? save() : setEdit([...buyP, ...sellP, slip / 100].map(String)))} aria-label={edit ? "Save presets" : "Edit presets"}
              disabled={edit != null && !edit.every((x, i) => fieldOk(i, x))}
              className={cn(roundBtn, "disabled:cursor-not-allowed disabled:opacity-40", edit && "bg-[#0a84ff] text-white hover:bg-[#2b95ff] hover:text-white")}>
              {edit ? <CIcon.check className="size-3.5" /> : <CIcon.pencil className="size-3.5" />}
            </button>
          </Tip>
          <Tip tip={docked ? "Pop out: float this panel over the chart (it closes when you leave the coin)" : away ? "Close" : "Dock it back in the side column"}>
            <button onClick={toggleQuick} aria-label={docked ? "Pop out quick trade" : away ? "Close quick trade" : "Dock quick trade"} className={roundBtn}>
              {docked ? <CIcon.window className="size-3.5" /> : <Icon.close className="size-3.5" />}</button>
          </Tip>
        </span>
      </div>

      <div className="flex flex-col gap-4 px-4 pb-4">
        {/* Which set of presets, and its slippage (the slippage opens the editor: it is a preset field too). */}
        <div className="flex items-center justify-between gap-3">
          <div role="tablist" aria-label="Preset set" className={cn(track, "flex-1 [&>button]:flex-1")}>
            {presets.map((_, i) => (
              <button key={i} role="tab" aria-selected={pi === i} onClick={() => pick(i)} className={seg(pi === i)}>P{i + 1}</button>
            ))}
          </div>
          {edit ? (
            <span className={cn("flex items-center gap-2", secondary)}>Slippage<span className="w-[4.5rem] [&>label]:h-8 [&>label]:rounded-[9px] [&_input]:text-[15px]">{field(8, "%")}</span></span>
          ) : (
            <Tip tip="Max slippage for this preset set (tap to change)">
              <button onClick={() => setEdit([...buyP, ...sellP, slip / 100].map(String))} className={cn("num flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-[rgba(120,120,128,0.2)] px-2.5 transition-colors hover:bg-[rgba(120,120,128,0.32)]", secondary)}>
                <Icon.sliders className="size-3.5" />Slippage <b className="font-semibold text-white">{slipTxt(slip)}</b>
              </button>
            </Tip>
          )}
        </div>

        {migrating ? <MigratingNote since={migrating} /> : null}

        <div className="flex flex-col gap-2">
          {line(<><span className="text-[15px] font-semibold">Buy</span>{curSwitch}</>,
            cash == null ? (paperOn ? null : "Not signed in") : <>{mark("size-3.5")}<span className="truncate font-medium text-white/90">{inUsdc ? usdcTxt(cash) : cash.toFixed(3)}</span><span>{cur}</span></>)}
          <div className="grid grid-cols-4 gap-2">
            {edit ? buyP.map((_, i) => field(i, null)) : buyP.map((v, i) => {
              const short = cash != null && v > cash;
              if (migrating) return <button key={i} aria-disabled title={MIGRATING_TIP} className={tile("buy", false)}>{v}</button>;
              return (
                <button key={i} aria-disabled={short || undefined}
                  title={short ? (paperOn ? `Only ${inUsdc ? usdcTxt(cash!) : +cash!.toFixed(3)} ${cur} to spend` : `Not enough ${cur}: deposit${inUsdc ? " or convert" : ""} to buy`) : `Buy ${v} ${cur} of ${symbol} · ${slipTxt(slip)} slippage`}
                  onClick={() => { if (short) { if (!paperOn) openExchange("deposit"); return; } void go(`b${i}`, true, v); }}
                  className={tile("buy", !short)}>
                  {busy === `b${i}` ? spin : v}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {line(<span className="text-[15px] font-semibold">Sell</span>,
            pos.canSell ? <>{pos.tokens != null && <span className="truncate font-medium text-white/90">{tokN(pos.tokens)} {symbol}</span>}{pos.holding != null && <span>{pos.tokens != null && "· "}<SolAmt v={pos.holding} /></span>}</> : "Nothing held")}
          <div className="grid grid-cols-4 gap-2">
            {edit ? sellP.map((_, i) => field(i + 4, "%")) : sellP.map((v, i) => (
              migrating ? <button key={i} aria-disabled title={MIGRATING_TIP} className={tile("sell", false)}>{v}%</button> :
              <button key={i} aria-disabled={!pos.canSell || undefined} title={pos.canSell ? `Sell ${v}% of your ${symbol} · ${slipTxt(slip)} slippage` : "Buy first, then sell from here"}
                onClick={() => { if (!busy && pos.canSell) void go(`s${i}`, false, v); }}
                className={tile("sell", pos.canSell)}>
                {busy === `s${i}` ? spin : `${v}%`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pnlCard.dialog}
      {/* The foot: the position's averages and result, or how to get money in, or what a click does. */}
      <div className={cn("num flex min-h-11 items-center gap-x-3 gap-y-1 border-t border-[rgba(84,84,88,0.5)] px-4 py-2", secondary)}>
        {pos.has ? (
          <>
            <span>Avg buy <b className="font-semibold text-white">{usdK(pos.entry)}</b></span>
            {pos.exit != null && <span>Avg sell <b className="font-semibold text-white">{usdK(pos.exit)}</b></span>}
            <button onClick={pnlCard.open} title="Open your PnL card"
              className={cn("ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold transition-colors", (pos.pnl ?? 0) >= 0 ? "bg-[rgba(48,209,88,0.15)] text-[#30d158] hover:bg-[rgba(48,209,88,0.25)]" : "bg-[rgba(255,69,58,0.15)] text-[#ff453a] hover:bg-[rgba(255,69,58,0.25)]")}>
              {pos.pnl == null ? "—" : <SolAmt v={pos.pnl} signed />}
              {pnlPct != null && <span className="opacity-80">{pnlPct >= 0 ? "+" : "−"}{Math.abs(pnlPct).toFixed(0)}%</span>}
            </button>
          </>
        ) : broke ? (
          <span className="flex w-full items-center gap-2"><span className="mr-auto">No {cur} yet</span>
            <button onClick={() => setPaper(true)} className="h-8 rounded-full px-3 text-[13px] font-semibold text-[#0a84ff] transition-colors hover:bg-[rgba(10,132,255,0.12)]">Try paper</button>
            <button onClick={() => openExchange("deposit")} className="h-8 rounded-full bg-[#0a84ff] px-4 text-[13px] font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-[#2b95ff] active:scale-[0.97]">Deposit</button></span>
        ) : <span>One tap fills at the live quote{paperOn ? ` with fake ${cur}` : ""}.</span>}
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

