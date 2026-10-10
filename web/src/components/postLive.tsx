// Live numbers for posts about a coin (the Feed, a coin's Theses): its market cap from the trade stream
// (lib/livepx.ts, every trade the radar sees, once a frame) in place of the snapshot the post came with, a
// position's value and profit moved with it, and new posts sliding in once. (Flash is in Live.tsx.)
import { useEffect, useRef } from "react";
import { useLiveMc } from "@/lib/livepx";

// The coin's market cap now: the stream's, or the post's own figure until a trade comes in.
export function useMcNow(mint: string | null | undefined, snap: number | null | undefined) {
  const live = useLiveMc(mint || null);
  return live && live > 0 ? live : snap ?? null;
}

// A position read at `snapMc`, valued at `mcNow`: its value, profit and percent move with the price.
export function movePosition(p: { value?: number | null; pnl?: number | null; pct?: number | null }, snapMc: number | null | undefined, mcNow: number | null) {
  const k = snapMc && mcNow ? mcNow / snapMc : 1;
  if (k === 1 || !p.value) return p;
  const value = p.value * k, pnl = p.pnl != null ? p.pnl + (value - p.value) : null;
  const pct = p.pct != null ? ((1 + p.pct / 100) * k - 1) * 100 : null;
  return { value, pnl, pct };
}

// Rows that arrived after the list was first drawn slide in once; the first draw stands still.
export function useArrivals(ids: string[]) {
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const id of ids) if (!seen.current.has(id)) fresh.add(id);
  useEffect(() => {
    if (!ids.length) return;
    if (!seen.current) seen.current = new Set();
    for (const id of ids) seen.current.add(id);
    if (seen.current.size > 3000) seen.current = new Set(ids);
  });
  return fresh;
}
