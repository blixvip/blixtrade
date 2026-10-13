import { useMemo } from "react";
import { usePoll } from "@/lib/coin";
import { usd, count, traderHref, type Range } from "@/pages/traders/parts";
// ---------- the two boards as the server sends them ----------
export interface Hold { mint: string; chain: number; img: string | null; value?: number | null; symbol?: string | null }
export interface FomoRow {
  rank: number; handle: string | null; name: string | null; pic: string | null; pnl: number | null; volume: number | null; trades: number | null; followers: number | null;
  holdings: number | null; top: Hold[]; badge: string | null; verified: number | null; wallet: string | null; walletVerified?: boolean; walletNote: string | null; tracked?: boolean;
}
export interface FomoBoard { rows: FomoRow[]; status: { running: boolean; error: string | null; signedOut: boolean; lastOk: number | null } }
export interface PumpRow {
  rank: number; wallet: string; name: string | null; pic: string | null; x: string | null; verified: boolean; pnl: number | null; pnlPct: number | null;
  positions: number | null; top: Hold[]; tracked: boolean;
}
export interface PumpBoardData { t: number | null; error: string | null; rows: PumpRow[] }

// ---------- one row of the merged board ----------
export type Source = "fomo" | "pump";
export interface Trader {
  key: string; source: Source; srcRank: number; name: string; sub: string; pic: string | null; verified: boolean; top100: boolean;
  pnl: number | null; stat: string; holds: Hold[]; more: number; wallet: string | null; walletVerified: boolean; walletNote: string | null; tracked: boolean;
  href?: string; external: boolean;
}
export const fromFomo = (r: FomoRow): Trader => ({
  key: `fomo:${r.handle || r.rank}`, source: "fomo", srcRank: r.rank, name: r.name || r.handle || "anon", sub: r.handle ? `@${r.handle}` : "Fomo",
  pic: r.pic, verified: Boolean(r.verified), top100: Boolean(r.badge && /top/i.test(r.badge)), pnl: r.pnl,
  stat: [r.volume != null ? `${usd(r.volume)} vol` : null, r.trades != null ? `${count(r.trades)} trades` : null, r.followers != null ? `${count(r.followers)} followers` : null].filter(Boolean).join(" · "),
  holds: r.top, more: Math.max(0, (r.holdings ?? 0) - r.top.length), wallet: r.wallet, walletVerified: Boolean(r.walletVerified), walletNote: r.walletNote, tracked: Boolean(r.tracked),
  href: traderHref(r.handle), external: false,
});
export const fromPump = (r: PumpRow): Trader => ({
  key: `pump:${r.wallet}`, source: "pump", srcRank: r.rank, name: r.name || "anon", sub: r.x ? `@${r.x}` : `${r.wallet.slice(0, 4)}…${r.wallet.slice(-4)}`,
  pic: r.pic, verified: r.verified, top100: false, pnl: r.pnl,
  stat: [r.pnlPct != null ? `${r.pnlPct >= 0 ? "+" : "−"}${Math.abs(r.pnlPct).toLocaleString("en-US", { maximumFractionDigits: 1 })}% return` : null, r.positions != null ? `${r.positions} coins` : null].filter(Boolean).join(" · "),
  holds: r.top, more: Math.max(0, (r.positions ?? 0) - r.top.length), wallet: r.wallet, walletVerified: true, walletNote: null, tracked: r.tracked,
  href: `#/trader/${r.wallet}`, external: false,
});



export function useTraderDirectory(range: Range, enabled = true) {
  const filter = "all" as "all" | Source;
  const pumpRange = range === "all-time" ? null : range;
  const fomo = usePoll<FomoBoard>(enabled ? `fomo/board?${new URLSearchParams({ range })}` : null, 30_000);
  const pump = usePoll<PumpBoardData>(enabled && pumpRange ? `pump/board?range=${pumpRange}` : null, 30_000);
  const all = useMemo(() => {
    const list = [...(filter !== "pump" ? (fomo.data?.rows || []).map(fromFomo) : []), ...(filter !== "fomo" && pumpRange ? (pump.data?.rows || []).map(fromPump) : [])];
    // Wallets only, one row each: the better figure of the two boards, the Fomo profile when there is one.
    const byWallet = new Map<string, Trader>();
    for (const t of list) {
      if (!t.wallet) continue;
      const had = byWallet.get(t.wallet);
      if (!had) { byWallet.set(t.wallet, t); continue; }
      const fomoOne = had.source === "fomo" ? had : t.source === "fomo" ? t : null, best = (t.pnl ?? -Infinity) > (had.pnl ?? -Infinity) ? t : had;
      byWallet.set(t.wallet, fomoOne ? { ...fomoOne, pnl: best.pnl, holds: best.holds.length ? best.holds : fomoOne.holds, more: best.holds.length ? best.more : fomoOne.more } : best);
    }
    return [...byWallet.values()].sort((a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity));
  }, [fomo.data, pump.data, pumpRange]);
  return { all, fomo, pump };
}
