// The Practice bar over a coin's chart (lib/replay.ts): replay the coin's last day from any moment and paper-trade
// it: play, pause, change speed, step one trade, or drag to any moment. Everything else on the page is the live
// coin page fed from the replay clock, so it looks and trades exactly as it would have then. The bar can be hidden
// (H brings it back) so the page looks like any live coin's.
import { useEffect, useState } from "react";
import { cn, store } from "@/lib/utils";
import { fromBeginning, jumpTo, practiceStats, refreshReplayWallet, setPicking, setPlaying, setSpeed, SPEEDS, startReplay, stepTrade, stopReplay, useReplay } from "@/lib/replay";
import { PnlCardDialog, type CardData } from "@/components/PnlCard";

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const span = (ms: number) => { const m = Math.round(ms / 60000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`; };
// A link to #/coin/<mint>/replay (the Practice page's list) opens the coin straight into practice.
const ASKED = /\/replay$/;

export function ReplayBar({ mint, symbol, onTick }: { mint: string; symbol: string; onTick: () => void }) {
  const s = useReplay();
  const on = s.mint === mint;
  // The session card: the replay wallet since the run started (components/PnlCard.tsx), live while open (the bar
  // re-renders with the replay clock, so the card follows the run as it plays).
  const [cardOpen, setCardOpen] = useState(false);
  const ps = cardOpen ? practiceStats() : null;
  const card: CardData | null = ps ? { kind: "session", mint, symbol, mode: "practice", pnlSol: ps.pnl, baseSol: ps.start, solUsd: ps.solUsd || null } : null;
  const [hidden, setHiddenState] = useState(() => store.get<boolean>("replay:hidden", false));
  const setHidden = (v: boolean) => { store.set("replay:hidden", v); setHiddenState(v); };
  useEffect(() => { if (ASKED.test(location.hash) && useReplay.getState().mint !== mint) startReplay(mint); }, [mint]);
  // Leaving the coin (or the page) ends its practice run.
  useEffect(() => () => { if (useReplay.getState().mint === mint) stopReplay(); }, [mint]);
  // While it plays, the position, wallet and figures that are read on a slow poll follow the clock.
  useEffect(() => {
    if (!on || !s.playing) return;
    const t = window.setInterval(() => { onTick(); refreshReplayWallet(); }, 1500);
    return () => clearInterval(t);
  }, [on, s.playing]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Keys: space plays or pauses, the right arrow steps one trade, H hides or shows the controls.
  useEffect(() => {
    if (!on) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.code === "Space") { e.preventDefault(); if (!useReplay.getState().picking) setPlaying(!useReplay.getState().playing); }
      else if (e.code === "ArrowRight") { e.preventDefault(); stepTrade(); onTick(); }
      else if (e.code === "KeyH") { e.preventDefault(); setHidden(!store.get<boolean>("replay:hidden", false)); }
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
        <button onClick={exit} className="ml-auto h-7 rounded-control border border-rule px-3 font-semibold text-ink-2 hover:text-ink">Close</button>
      </div>
    );
  }
  // Choosing where to start (lib/replay.ts setPicking): the whole day is on the chart; a click on a candle starts
  // there, with everything after it hidden again. Shown even with the controls hidden.
  if (s.picking) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-accent/40 bg-accent/10 px-3 py-2 text-sm">
        <b className="text-accent">Practice</b>
        <span className="font-medium text-ink">Click the candle you want to start from.</span>
        <span className="text-ink-2">Everything after it is hidden, then press Play to watch the next candles come in.</span>
        <span className="ml-auto flex gap-2">
          <button onClick={() => { fromBeginning(); onTick(); }} className="h-7 rounded-control border border-rule px-3 font-semibold text-ink-2 hover:text-ink" title="Start at the coin's first trade of the day">From the start</button>
          <button onClick={exit} className="h-7 rounded-control border border-rule px-3 font-semibold text-ink-2 hover:text-ink" title="Back to the live coin">Exit</button>
        </span>
      </div>
    );
  }
  if (hidden) return null;
  const chip = (active: boolean) => cn("h-7 min-w-10 rounded-control border px-2 text-sm font-semibold num", active ? "border-accent bg-accent/15 text-ink" : "border-rule text-ink-2 hover:text-ink");
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-paper-2 px-3 py-2 text-sm">
      <b className="text-accent">Practice</b>
      <button onClick={() => { setPicking(true); onTick(); }} className="h-7 rounded-control border border-accent/50 px-3 font-semibold text-ink hover:bg-accent/10" title="Show the whole day and click the candle to start from">Pick start</button>
      <button onClick={() => { fromBeginning(); onTick(); }} className={chip(false)} title="Back to the first trade">⏮</button>
      <button onClick={() => setPlaying(!s.playing)} className="h-7 min-w-16 rounded-control bg-accent px-3 font-semibold text-accent-ink hover:bg-focus" title="Space">{s.playing ? "Pause" : s.at >= s.t1 ? "Ended" : "Play"}</button>
      <button onClick={() => { stepTrade(); onTick(); }} className={chip(false)} title="Next trade (→)">Step</button>
      <span className="flex gap-1">{SPEEDS.map((v) => <button key={v} onClick={() => setSpeed(v)} className={chip(s.speed === v)}>{v}×</button>)}</span>
      <input type="range" min={s.t0} max={s.t1} step={1000} value={s.at} aria-label="Replay time"
        onChange={(e) => { jumpTo(Number(e.target.value)); onTick(); }} className="min-w-40 flex-1 accent-[var(--color-accent)]" />
      <span className="num text-xs text-ink-2" title={`${span(s.at - s.t0)} into the ${span(s.t1 - s.t0)} replayed`}>{when(s.at)}</span>
      <button onClick={() => setCardOpen(true)} className="h-7 rounded-control border border-rule px-3 font-semibold text-ink-2 hover:text-ink" title="A live picture of this practice run's result to save or share">PnL card</button>
      <PnlCardDialog data={card} open={cardOpen && card != null} onOpenChange={setCardOpen} />
      <button onClick={() => setHidden(true)} className="h-7 rounded-control border border-rule px-3 font-semibold text-ink-2 hover:text-ink" title="Hide the controls so the page looks live (H shows them again)">Hide</button>
      <button onClick={exit} className="h-7 rounded-control border border-rule px-3 font-semibold text-ink-2 hover:text-ink" title="Back to the live coin">Exit</button>
    </div>
  );
}
