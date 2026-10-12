// Axiom's instant trade window: a small panel floating over the page with buy presets in SOL and sell presets
// in percent of the position, each one click. There is no quote step: it fills at the live quote, with fake
// or real SOL by the top bar's Paper switch, through lib/trade.ts like every other buy and sell button.
// Drag it by its title bar. Whether it is open, where it sits and its presets are kept in this browser.
// The look (the user, 2026-10-12: "proper, strong, like a real trading terminal"): 6px corners, hairlines, uppercase
// micro-labels, tabular figures, tiles outlined in their side's colour that fill solid under the pointer. No pills.
// The floating copy has a grip in its corner that scales the whole panel.
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
const SCALE_MIN = 0.7, SCALE_MAX = 1.8;   // how small and how big the floating panel's grip lets it go
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
  // How big the floating panel is: a scale from the grip in its corner, kept in this browser (1 = the docked size).
  const [scale, setScale] = useState<number>(() => Math.min(SCALE_MAX, Math.max(SCALE_MIN, store.get("qt:scale", 1))));
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number; at: At } | null>(null);
  const grip = useRef<{ x: number; w: number; scale: number } | null>(null);
  // Until edited: the paper desk's sizes (the same as the header's quick buys), made up to four.
  const buyP = inUsdc ? (buysUsdc?.length === 4 ? buysUsdc : USDC_SIZES) : buys.length === 4 ? buys : [...new Set([...sizes, 0.1, 0.25, 0.5, 1])].slice(0, 4).sort((a, b) => a - b), sellP = sells.length === 4 ? sells : SELLS;

  // Kept inside the window: on first open over the chart's top left, and back in view after a resize.
  const clamp = (p: At): At => {
    const w = (box.current?.offsetWidth || 320) * scale, h = (box.current?.offsetHeight || 300) * scale;
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
  }, [open, scale]);   // eslint-disable-line react-hooks/exhaustive-deps
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
  // The grip in the bottom right corner: pull it out to make the whole panel bigger, in to make it smaller
  // (everything scales together, so the tiles stay in proportion). Double-click puts it back to its normal size.
  const gripDown = (e: PE<HTMLElement>) => {
    grip.current = { x: e.clientX, w: box.current?.offsetWidth || 320, scale };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const gripMove = (e: PE<HTMLElement>) => {
    if (!grip.current) return;
    const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, (grip.current.w * grip.current.scale + e.clientX - grip.current.x) / grip.current.w));
    setScale(Math.round(next * 100) / 100);
  };
  const gripUp = () => { if (grip.current) { store.set("qt:scale", scale); grip.current = null; } };
  const gripReset = () => { setScale(1); store.set("qt:scale", 1); };

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
  // The money's mark, in front of a figure: the Solana logomark or the USDC coin.
  const mark = (cls: string) => (inUsdc ? <img src="brand/pay/usdc.png" alt="" className={cn("shrink-0 rounded-full", cls)} /> : <SolanaLogo className={cn("shrink-0", cls)} />);
  // A terminal's segmented control: a hairline box, the picked segment lifted a shade.
  const seg = (on: boolean) => cn("num flex h-6 items-center justify-center gap-1 rounded-[3px] px-2.5 text-[12px] font-semibold transition-colors duration-100",
    on ? "bg-paper-5 text-ink" : "text-muted hover:text-ink-2");
  const track = "flex items-center gap-px rounded-[4px] border border-rule bg-paper p-px";
  const label = "text-[11px] font-bold tracking-[0.08em] uppercase";
  // A preset field while editing: the tile's shape, the figure typed in ink, the unit beside it.
  const field = (i: number, suffix: ReactNode) => (
    <label key={i} title={fieldOk(i, edit![i]) ? undefined : i < 4 ? `More than 0 ${cur}` : i < 8 ? "1 to 100 %" : "0.1 to 50 %"}
      className={cn("num flex h-9 min-w-0 items-center gap-0.5 rounded-[4px] border bg-paper px-1.5 transition-colors duration-100",
        fieldOk(i, edit![i]) ? "border-rule-2 focus-within:border-ink-2" : "border-down")}>
      <input value={edit![i]} onChange={(e) => setEdit((x) => x && x.map((y, j) => (j === i ? e.target.value : y)))}
        onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }}
        inputMode="decimal" aria-label={i < 4 ? `Buy preset ${i + 1} in ${cur}` : i < 8 ? `Sell preset ${i - 3} in percent` : "Slippage in percent"}
        className="w-full min-w-0 bg-transparent text-center text-[14px] font-bold text-ink outline-none" />
      {suffix != null && <span className="text-[10px] font-semibold text-muted">{suffix}</span>}
    </label>
  );
  // Tiles: a hairline in the side's colour over a faint tint, the figure bold in that colour; under the pointer the
  // tile fills solid. One that can't trade right now (not enough SOL, nothing held) is dim; a buy short of SOL
  // opens Deposit instead (live), a sell with nothing held does nothing.
  const tile = (side: "buy" | "sell", can: boolean) => cn("num flex h-9 min-w-0 items-center justify-center gap-1 rounded-[4px] border text-[14px] leading-none font-bold transition-[background-color,border-color,color,transform] duration-100",
    side === "buy" ? "border-up/35 bg-up/[0.08] text-up" : "border-down/35 bg-down/[0.08] text-down",
    can ? cn("active:scale-[0.97]", side === "buy" ? "hover:border-up hover:bg-up hover:text-[#06130b]" : "hover:border-down hover:bg-down hover:text-white") : "cursor-not-allowed opacity-35");
  const broke = !paperOn && cash != null && cash < Math.min(...buyP);
  const spin = <i className="size-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current" />;
  const iconBtn = "grid size-6 place-items-center rounded-[4px] text-muted transition-colors duration-100 hover:bg-paper-4 hover:text-ink";
  // A figure with its name over it in the small capitals, and a square in a line's colour when it is one.
  const stat = (name: string, value: ReactNode, square?: string) => (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className={cn(label, "flex items-center gap-1.5 text-[10px] whitespace-nowrap text-muted")}>{square && <i className={cn("size-1.5 shrink-0", square)} />}{name}</span>
      <b className="text-[13px] font-bold text-ink">{value}</b>
    </span>
  );
  // A group's top line: its side, then what there is on that side (the balance, or the holding).
  const line = (left: ReactNode, right: ReactNode) => (
    <div className="flex h-5 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">{left}</span>
      <span className="num flex min-w-0 items-center gap-1 truncate text-[12px] text-muted">{right}</span>
    </div>
  );
  // The money: buys sized in SOL or in USDC, sells paid in it (one setting with the coin page's panel). A two-way
  // switch with both names showing, beside the buy sizes it changes, so it reads as a choice and not as a label.
  const curSwitch = (
    <div role="radiogroup" aria-label="Trade in SOL or USDC" className={cn(track, "shrink-0")}>
      {(["SOL", "USDC"] as const).map((c) => (
        <Tip key={c} tip={c === "SOL" ? "Buys sized in SOL, sells paid in SOL" : "Buys sized in USDC, sells paid in USDC"}>
          <button role="radio" aria-checked={cur === c} onClick={() => setCur(c)} className={cn(seg(cur === c), "h-[22px] gap-1.5 px-1.5 text-[11px] font-bold tracking-[0.03em]")}>
            {c === "USDC" ? <img src="brand/pay/usdc.png" alt="" className={cn("size-3.5 rounded-full", cur !== c && "opacity-45 grayscale")} /> : <SolanaLogo className={cn("size-3.5", cur !== c && "opacity-45 grayscale")} />}{c}
          </button>
        </Tip>
      ))}
    </div>
  );
  return (
    <div ref={box} role={docked ? "region" : "dialog"} aria-label="Instant trade"
      style={docked ? undefined : { left: at?.x ?? -9999, top: at?.y ?? 0, transform: scale === 1 ? undefined : `scale(${scale})`, transformOrigin: "top left" }}
      className={cn("relative overflow-hidden rounded-[6px] border border-rule-2 bg-paper-2 text-ink",
        !docked && "fixed z-30 w-[min(320px,calc(100vw-16px))] shadow-[0_16px_40px_-8px_rgba(0,0,0,0.85)]")}>
      {/* The title bar: what this is, whose money, and the three small controls. Drag it when floating. */}
      <div onPointerDown={docked ? undefined : down} onPointerMove={docked ? undefined : move} onPointerUp={docked ? undefined : up} onPointerCancel={docked ? undefined : up}
        className={cn("flex h-9 items-center gap-2.5 border-b border-rule pr-1.5 pl-3 select-none", !docked && "cursor-grab touch-none active:cursor-grabbing")}>
        {away ? (
          <a href={`#/coin/${mint}`} title={`Open ${symbol}`} className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-ink hover:text-accent">
            <CoinPic mint={mint} symbol={symbol} className="size-4.5" /><span className="truncate">{symbol}</span>
            {pos.mcapNow != null && <span className="num text-[12px] font-medium text-muted">{usdK(pos.mcapNow)}</span>}
          </a>
        ) : <b className="min-w-0 truncate text-[13px] font-semibold text-ink">Quick trade</b>}
        <span className="ml-auto flex items-center gap-1.5">
          {/* The money the panel trades in, right where the eye goes: the Solana mark and the USDC coin, one lit. */}
          {curSwitch}
          <Tip tip="PnL card: your live result as a picture to save or share">
            <button onClick={pnlCard.open} aria-label="PnL card" className={iconBtn}><Icon.image className="size-3.5" /></button>
          </Tip>
          <Tip tip={edit ? "Save presets" : "Edit presets"}>
            <button onClick={() => (edit ? save() : setEdit([...buyP, ...sellP, slip / 100].map(String)))} aria-label={edit ? "Save presets" : "Edit presets"}
              disabled={edit != null && !edit.every((x, i) => fieldOk(i, x))}
              className={cn(iconBtn, "disabled:cursor-not-allowed disabled:opacity-40", edit && "bg-up text-[#06130b] hover:bg-up hover:text-[#06130b]")}>
              {edit ? <CIcon.check className="size-3.5" /> : <CIcon.pencil className="size-3.5" />}
            </button>
          </Tip>
          <Tip tip={docked ? "Pop out: float this panel over the chart (it closes when you leave the coin)" : away ? "Close" : "Dock it back in the side column"}>
            <button onClick={toggleQuick} aria-label={docked ? "Pop out quick trade" : away ? "Close quick trade" : "Dock quick trade"} className={iconBtn}>
              {docked ? <CIcon.window className="size-3.5" /> : <Icon.close className="size-3.5" />}</button>
          </Tip>
        </span>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {/* Which set of presets, and its slippage (the slippage opens the editor: it is a preset field too). */}
        <div className="flex items-center justify-between gap-2">
          <div role="tablist" aria-label="Preset set" className={track}>
            {presets.map((_, i) => (
              <button key={i} role="tab" aria-selected={pi === i} onClick={() => pick(i)} className={seg(pi === i)}>P{i + 1}</button>
            ))}
          </div>
          {edit ? (
            <span className="flex items-center gap-1.5 text-[12px] text-muted">Slippage<span className="w-16 [&>label]:h-7">{field(8, "%")}</span></span>
          ) : (
            <Tip tip="Max slippage for this preset set (click to change)">
              <button onClick={() => setEdit([...buyP, ...sellP, slip / 100].map(String))} className="num flex h-6 items-center gap-1.5 rounded-[4px] px-1.5 text-[12px] text-muted transition-colors duration-100 hover:bg-paper-4 hover:text-ink">
                <Icon.sliders className="size-3.5" />Slippage <b className="font-bold text-ink">{slipTxt(slip)}</b>
              </button>
            </Tip>
          )}
        </div>

        {migrating ? <MigratingNote since={migrating} /> : null}

        <div className="flex flex-col gap-1.5">
          {line(<span className={cn(label, "text-up")}>Buy</span>,
            <><span className={cn(label, "mr-1 flex items-center gap-1.5", paperOn ? "text-info" : "text-up")}><i className={cn("size-1.5", paperOn ? "bg-info" : "bg-up motion-safe:animate-pulse")} />{paperOn ? "Paper" : "Live"}</span>
              {cash == null ? (paperOn ? null : "Not signed in") : <>{mark("size-3")}<span className="truncate font-semibold text-ink">{inUsdc ? usdcTxt(cash) : cash.toFixed(3)}</span><span>{cur}</span></>}</>)}
          <div className="grid grid-cols-4 gap-1.5">
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

        <div className="flex flex-col gap-1.5">
          {line(<span className={cn(label, "text-down")}>Sell</span>,
            pos.canSell ? <>{pos.tokens != null && <span className="truncate font-semibold text-ink">{tokN(pos.tokens)} {symbol}</span>}{pos.holding != null && <span>{pos.tokens != null && "· "}<SolAmt v={pos.holding} /></span>}</> : "Nothing held")}
          <div className="grid grid-cols-4 gap-1.5">
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
      {/* The foot, only when there is something to say: the position's averages and result, or how to get money in. */}
      {(pos.has || broke) && (
        <div className="num flex min-h-10 items-center gap-x-3.5 border-t border-rule px-3 py-1.5 text-[12px] text-muted">
          {pos.has ? (
            <>
              {/* Each average as a stat: a square in the colour of its line on the chart, the name, the cap. */}
              {stat("Avg buy", usdK(pos.entry), "bg-up")}
              {pos.exit != null && stat("Avg sell", usdK(pos.exit), "bg-down")}
              {stat("Now", usdK(pos.mcapNow))}
              <button onClick={pnlCard.open} title="Open your PnL card"
                className={cn("ml-auto flex items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-[13px] font-bold transition-colors duration-100 hover:bg-paper-4", (pos.pnl ?? 0) >= 0 ? "text-up" : "text-down")}>
                {pos.pnl == null ? "—" : <SolAmt v={pos.pnl} signed />}
                {pnlPct != null && <span className="opacity-80">{pnlPct >= 0 ? "+" : "−"}{Math.abs(pnlPct).toFixed(0)}%</span>}
              </button>
            </>
          ) : (
            <span className="flex w-full items-center gap-1.5"><span className="mr-auto">No {cur} yet</span>
              <button onClick={() => setPaper(true)} className="h-7 rounded-[4px] px-2.5 font-semibold text-info transition-colors duration-100 hover:bg-info/10">Try paper</button>
              <button onClick={() => openExchange("deposit")} className="h-7 rounded-[4px] bg-ink px-3 font-semibold text-paper transition-[background-color,transform] duration-100 hover:bg-white active:scale-[0.97]">Deposit</button></span>
          )}
        </div>
      )}
      {/* The resize grip (floating only): two short diagonal strokes in the corner, the way a terminal window shows one. */}
      {!docked && (
        <span role="separator" aria-label="Resize quick trade" title="Drag to resize · double-click for the normal size"
          onPointerDown={gripDown} onPointerMove={gripMove} onPointerUp={gripUp} onPointerCancel={gripUp} onDoubleClick={gripReset}
          className="absolute right-0 bottom-0 grid size-5 cursor-nwse-resize touch-none place-items-end p-1 text-muted/60 transition-colors hover:text-ink">
          <svg viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
            <path d="M9 1L1 9M9 5L5 9" />
          </svg>
        </span>
      )}
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

