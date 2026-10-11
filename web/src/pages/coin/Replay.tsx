// Practice on a coin's chart (lib/replay.ts): replay the coin's last day from any moment and paper-trade it: play,
// pause, change speed, step one trade, or drag to any moment. Everything else on the page is the live coin page fed
// from the replay clock, so it looks and trades exactly as it would have then.
// The controls float over the chart: a small "Practice" pill in the chart's corner is always there while a replay
// runs, and a click on it opens the control panel above it; a click anywhere else, Escape, the × or H closes the
// panel again (the pill stays, so the controls are always one click away).
import { useEffect, useRef, useState } from "react";
import { cn, store } from "@/lib/utils";
import { fromBeginning, jumpTo, practiceStats, refreshReplayWallet, setPicking, setPlaying, setSkipQuiet, setSpeed, SPEEDS, startReplay, stepTrade, stopReplay, useReplay } from "@/lib/replay";
import { PnlCardDialog, type CardData } from "@/components/PnlCard";
import { useShallow } from "zustand/react/shallow";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const span = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
// A link to #/coin/<mint>/replay (the Practice page's list) opens the coin straight into practice.
const ASKED = /\/replay$/;
type Pos = { x: number; y: number };

const quiet = "h-7 rounded-control border border-rule px-3 text-sm font-semibold text-ink-2 hover:text-ink";
const chip = (active: boolean) => cn("h-7 min-w-9 rounded-control border px-2 text-sm font-semibold num", active ? "border-accent bg-accent/15 text-ink" : "border-rule text-ink-2 hover:text-ink");

export function ReplayBar({ mint, symbol, onTick }: { mint: string; symbol: string; onTick: () => void }) {
  // The clock is shown to the quarter second: the bar re-renders (and the page paints it) four times a second
  // while a run plays, not on every 50 ms tick of the replay clock.
  const s = useReplay(useShallow((st) => ({ ...st, at: Math.floor(st.at / 250) * 250 })));
  const on = s.mint === mint;
  // The session card: the replay wallet since the run started (components/PnlCard.tsx), live while open (the bar
  // re-renders with the replay clock, so the card follows the run as it plays).
  const [cardOpen, setCardOpen] = useState(false);
  const ps = cardOpen ? practiceStats() : null;
  const card: CardData | null = ps ? { kind: "session", mint, symbol, mode: "practice", pnlSol: ps.pnl, baseSol: ps.start, solUsd: ps.solUsd || null } : null;
  // The control panel over the chart: open as soon as a run is ready to play, closed by a click elsewhere.
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Where the pill sits over the chart (px from the chart box's top-left; null = its home at the bottom-left). The
  // pill and the panel's title row drag it anywhere; the spot is kept for next time.
  const [pos, setPosState] = useState<Pos | null>(() => store.get<Pos | null>("replay:pos", null));
  const setPos = (p: Pos | null) => { store.set("replay:pos", p); setPosState(p); };
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const clamp = (p: Pos): Pos => {
    const host = box.current?.parentElement?.getBoundingClientRect(), me = box.current?.getBoundingClientRect();
    if (!host || !me) return p;
    return { x: Math.min(Math.max(0, p.x), Math.max(0, host.width - me.width)), y: Math.min(Math.max(0, p.y), Math.max(0, host.height - me.height)) };
  };
  const grab = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const host = box.current?.parentElement?.getBoundingClientRect(), me = box.current?.getBoundingClientRect();
    if (!host || !me) return;
    drag.current = { x: e.clientX, y: e.clientY, px: me.left - host.left, py: me.top - host.top, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true; setPos(clamp({ x: d.px + dx, y: d.py + dy }));
  };
  // Lets go: a plain press (no move) on the pill is its click, which toggles the panel.
  const drop = (e: React.PointerEvent, toggle: boolean) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (!d.moved && toggle) setOpen((v) => !v);
  };
  // A stored spot outside the chart box (a narrower window) comes back inside.
  useEffect(() => { if (pos && box.current) { const c = clamp(pos); if (c.x !== pos.x || c.y !== pos.y) setPos(c); } }, [pos?.x, pos?.y]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ready = on && !s.loading && !s.error && !s.picking;
  useEffect(() => { if (ready) setOpen(true); }, [ready]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !(e.target as HTMLElement)?.closest?.("[role=dialog]")) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  useEffect(() => { if (ASKED.test(location.hash) && useReplay.getState().mint !== mint) startReplay(mint); }, [mint]);
  // Leaving the coin (or the page) ends its practice run.
  useEffect(() => () => { if (useReplay.getState().mint === mint) stopReplay(); }, [mint]);
  // While it plays, the position, wallet and figures that are read on a slow poll follow the clock.
  useEffect(() => {
    if (!on || !s.playing) return;
    const t = window.setInterval(() => { onTick(); refreshReplayWallet(); }, 2000);
    return () => clearInterval(t);
  }, [on, s.playing]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Keys: space plays or pauses, the right arrow steps one trade, H opens or closes the panel.
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.code === "Space") { e.preventDefault(); if (!useReplay.getState().picking) setPlaying(!useReplay.getState().playing); }
      else if (e.code === "ArrowRight") { e.preventDefault(); stepTrade(); onTick(); }
      else if (e.code === "KeyH") { e.preventDefault(); setOpen((v) => !v); }
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [on]);   // eslint-disable-line react-hooks/exhaustive-deps

  const exit = () => { stopReplay(); if (ASKED.test(location.hash)) location.replace(location.hash.replace(ASKED, "")); };
  // Practice is reached only from its own page (#/practice opens the coin at #/coin/<mint>/replay): no button or
  // empty row on a coin page, or anywhere that shows one (the Pulse's coin view).
  if (!on) return null;
  if (s.loading || s.error) {
    return (
      <div className="flex items-center gap-2 border-b border-rule bg-paper-2 px-3 py-2 text-sm">
        <b className="text-accent">Practice</b>
        <span className={s.error ? "text-down" : "text-muted"}>{s.error || "Loading the coin's last day of trades…"}</span>
        <button onClick={exit} className={cn(quiet, "ml-auto")}>Close</button>
      </div>
    );
  }
  // Choosing where to start (lib/replay.ts setPicking): the whole day is on the chart; a click on a candle starts
  // there, with everything after it hidden again.
  if (s.picking) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-accent/40 bg-accent/10 px-3 py-2 text-sm">
        <b className="text-accent">Practice</b>
        <span className="font-medium text-ink">Click the candle you want to start from.</span>
        <span className="text-ink-2">Everything after it is hidden, then press Play to watch the next candles come in.</span>
        <span className="ml-auto flex gap-2">
          <button onClick={() => { fromBeginning(); onTick(); }} className={quiet} title="Start at the coin's first trade of the day">From the start</button>
          <button onClick={exit} className={quiet} title="Back to the live coin">Exit</button>
        </span>
      </div>
    );
  }
  const ended = s.at >= s.t1;
  const playLabel = s.playing ? "Pause" : ended ? "Ended" : "Play";
  // The panel opens above the pill unless the pill sits near the top of the chart, and hangs off whichever side
  // of the pill has the room.
  const host = box.current?.parentElement, me = box.current;
  const below = Boolean(pos && pos.y < 230);
  const toRight = Boolean(pos && host && me && pos.x + 420 > host.clientWidth && pos.x + me.offsetWidth >= 420);
  return (
    <div ref={box} style={pos ? { left: pos.x, top: pos.y } : undefined} className={cn("absolute z-20", !pos && "bottom-9 left-3")}>
      {open && (
        <div className={cn("absolute w-[min(26rem,calc(100vw-2rem))] rounded-card border border-rule-2 bg-paper-2 p-3 shadow-sheet", below ? "top-full mt-2" : "bottom-full mb-2", toRight ? "right-0" : "left-0")}>
          <div onPointerDown={grab} onPointerMove={move} onPointerUp={(e) => drop(e, false)} onPointerCancel={(e) => drop(e, false)} className="mb-2 flex cursor-grab touch-none items-center gap-2 select-none active:cursor-grabbing" title="Drag to move">
            <b className="text-accent">Practice</b>
            <span className="text-xs text-ink-2">Replaying {symbol}'s last day. Paper-trade it as it plays.</span>
            <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(false)} aria-label="Close the controls" title="Close (H opens them again)" className="ml-auto grid size-7 place-items-center rounded-control text-ink-2 hover:bg-paper-4 hover:text-ink">×</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { fromBeginning(); onTick(); }} className={chip(false)} title="Back to the first trade">⏮</button>
            <button onClick={() => setPlaying(!s.playing)} disabled={ended && !s.playing} className="h-7 min-w-20 rounded-control bg-accent px-3 font-semibold text-accent-ink hover:bg-focus disabled:opacity-50" title="Space">{s.playing ? "❚❚ Pause" : ended ? "Ended" : "▶ Play"}</button>
            <button onClick={() => { stepTrade(); onTick(); }} className={chip(false)} title="Next trade (→)">Step</button>
            <span className="ml-1 text-xs text-ink-2">Speed</span>
            <span className="flex gap-1">{SPEEDS.map((v) => <button key={v} onClick={() => setSpeed(v)} className={chip(s.speed === v)}>{v}×</button>)}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input type="range" min={s.t0} max={s.t1} step={1000} value={s.at} aria-label="Replay time"
              onChange={(e) => { jumpTo(Number(e.target.value)); onTick(); }} className="min-w-0 flex-1 accent-[var(--color-accent)]" />
            <span className="num shrink-0 text-xs text-ink-2" title={`${span(s.at - s.t0)} into the ${span(s.t1 - s.t0)} replayed`}>{when(s.at)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
            <label className="flex cursor-pointer items-center gap-1.5" title="A stretch with no trades is skipped in a moment instead of waited out">
              <input type="checkbox" checked={s.skipQuiet} onChange={(e) => setSkipQuiet(e.target.checked)} className="accent-[var(--color-accent)]" />Skip quiet stretches
            </label>
            <span className="num text-muted">Space play · → next trade · H hide</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button onClick={() => { setPicking(true); onTick(); }} className="h-7 rounded-control border border-accent/50 px-3 text-sm font-semibold text-ink hover:bg-accent/10" title="Show the whole day and click the candle to start from">Pick start</button>
            <button onClick={() => setCardOpen(true)} className={quiet} title="A live picture of this practice run's result to save or share">PnL card</button>
            <button onClick={exit} className={cn(quiet, "ml-auto")} title="Back to the live coin">Exit practice</button>
          </div>
        </div>
      )}
      <button onPointerDown={grab} onPointerMove={move} onPointerUp={(e) => drop(e, true)} onPointerCancel={(e) => drop(e, false)} aria-expanded={open} title={open ? "Close the practice controls (H). Drag to move." : "Open the practice controls (H). Drag to move."}
        className={cn("flex h-8 cursor-grab touch-none items-center gap-2 rounded-full border px-3 text-sm font-semibold whitespace-nowrap shadow-sheet transition-colors duration-100 select-none active:cursor-grabbing", open ? "border-accent bg-paper-3 text-ink" : "border-rule-2 bg-paper-2 text-ink hover:border-accent")}>
        <span className={cn("size-2 rounded-full", s.playing ? "bg-accent" : "bg-muted")} />
        <span className="text-accent">Practice</span>
        <span className="num text-ink-2">{playLabel === "Pause" ? `${s.speed}×` : playLabel} · {clock(s.at)}</span>
        <span className="text-ink-2">{open ? "▾" : "▴"}</span>
      </button>
      <PnlCardDialog data={card} open={cardOpen && card != null} onOpenChange={setCardOpen} />
    </div>
  );
}
