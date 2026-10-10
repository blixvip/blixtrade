// The live PnL card of your position in one coin (components/PnlCard.tsx), opened from the Position card and the
// Quick buy / sell panel alike. Worked out again on every render while open, so it follows each trade and price;
// 0 before the first trade. Practice and paper results say so on the card.
import { useState } from "react";
import { PnlCardDialog, type CardData } from "@/components/PnlCard";
import { usePulse } from "@/lib/pulse";
import { practiceStats, useReplay } from "@/lib/replay";
import type { Pos } from "./position";

export function usePositionCard(pos: Pos, mint: string, symbol: string, solUsd?: number | null) {
  const practice = useReplay((st) => st.mint === mint);
  const liveSol = usePulse((s) => s.live.solUsd);
  const [open, setOpen] = useState(false);
  const data: CardData | null = open ? { kind: "trade", mint, symbol, mode: practice ? "practice" : pos.paper ? "paper" : "real", pnlSol: pos.pnl ?? 0, baseSol: pos.bought,
    // Practice: SOL's price at the replayed moment; otherwise today's.
    solUsd: (practice ? practiceStats()?.solUsd : null) || solUsd || liveSol || null } : null;
  return { open: () => setOpen(true), dialog: <PnlCardDialog data={data} open={open} onOpenChange={setOpen} /> };
}
