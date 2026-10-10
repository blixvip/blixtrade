// Discover's Hot tab: the Feed page's "Hot right now" (server/feedhot.js: the coins Fomo and pump.fun traders posted
// about most in the last 5, 30 or 60 minutes), in that order, each drawn with the same row as every other Discover
// list (Blix's reading of the coin, its live line and market cap) behind a first cell with the posts, the traders and
// the money their posted trades moved. Read every 5 s, so the ranking moves as posts come in.
import { useEffect } from "react";
import { Empty, Loading, Panel, Problem } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { warmPics } from "@/lib/pics";
import { cn } from "@/lib/utils";
import { compact } from "@/lib/format";
import { Tip } from "@/components/ui/tooltip";
import { noteLive, sparkOrKeep } from "@/components/Spark";
import { Avatar } from "../traders/parts";
import { freshest, keptRow, takeRows, takeSparks } from "./fresh";
import { DiscoverRow, withLive, type LiveFigures, type Row, type Tf } from "./parts";

export type HotWin = "5" | "30" | "60";
export const HOT_WINS: [HotWin, string][] = [["5", "5m"], ["30", "30m"], ["60", "1h"]];
// The same sources and flag as the Feed's own Hot list (keep: the feeds keep being read while this tab is open).
export const hotPath = (w: HotWin) => `feed/hot?${new URLSearchParams({ w, src: "fomo,pump", keep: "1" })}`;
type HotCoin = { mint: string; ticker: string | null; img: string | null; mc: number | null; chain: number; n: number; buy: number; sell: number; people: [string, string | null][]; last: number; traders?: number };
export type HotAnswer = { w: number; since: number | null; top: HotCoin[] };
type Sparks = { w: Tf; rows: Record<string, { spark: [number, number][]; mc: number | null; chg: number | null; live: LiveFigures | null }> };

const SOLANA = 1399811149;
// Discover's grid (parts.tsx GRID) with a first column for the Feed's figures. Written out whole: Tailwind only
// sees class names that appear in the source.
export const HOT_GRID = "grid grid-cols-[124px_minmax(320px,2.2fr)_88px_minmax(92px,1fr)_minmax(84px,1fr)_minmax(84px,1fr)_minmax(84px,0.9fr)_minmax(240px,1.9fr)_118px] items-center gap-x-3";
const money = (n: number) => compact(Math.abs(n));   // compact writes the $

// A coin Blix has no row for yet: what the posts say about it.
function fromHot(h: HotCoin): Row {
  return {
    mint: h.mint, symbol: h.ticker, name: null, image: h.img, dex: null, pair_created: null, first_seen: h.last || Date.now(), mcap: h.mc, liquidity: null,
    vol_m5: null, vol_h1: null, vol_h24: null, buys_m5: null, sells_m5: null, buys_h1: null, sells_h1: null, chg_m5: null, chg_h1: null, chg_h24: null,
    links: null, boosts: null, header: null, graduated: 0, safety_score: null, score: null, safety: null,
  };
}

function Lead({ h, rank, heat }: { h: HotCoin; rank: number; heat: number }) {
  const net = h.buy - h.sell, traders = h.traders ?? h.people.length;
  return (
    <div className="relative flex min-w-0 items-center gap-2.5 self-stretch">
      <i aria-hidden className="pointer-events-none absolute inset-y-1 -left-4 rounded-r bg-gradient-to-r from-up/[0.08] to-transparent" style={{ width: `${Math.max(6, heat * 100)}%` }} />
      <span className={cn("num relative w-5 shrink-0 text-right text-md", rank <= 3 ? "font-bold text-ink" : "text-muted")}>{rank}</span>
      <div className="relative flex min-w-0 flex-col gap-1">
        <Tip tip={`${h.n} post${h.n === 1 ? "" : "s"} about it by ${traders} trader${traders === 1 ? "" : "s"} in the window`}>
          <span className="num text-md leading-none font-semibold text-ink">{h.n} <span className="text-xs font-normal text-muted">post{h.n === 1 ? "" : "s"}</span></span>
        </Tip>
        <span className="flex items-center gap-1.5">
          <span className="flex -space-x-1.5">{h.people.slice(0, 3).map(([name, pic]) => <Avatar key={name} src={pic} name={name} size={16} className="ring-1 ring-paper-2" />)}</span>
          {traders > Math.min(3, h.people.length) && <span className="num text-xs text-muted">+{traders - Math.min(3, h.people.length)}</span>}
        </span>
        {h.buy + h.sell > 0 && (
          <Tip tip={`${money(h.buy)} bought · ${money(h.sell)} sold in the posted trades`}>
            <span className={cn("num text-xs font-semibold", net > 0 ? "text-up" : net < 0 ? "text-down" : "text-muted")}>{net >= 0 ? "+" : "−"}{money(net)}</span>
          </Tip>
        )}
      </div>
    </div>
  );
}

export function HotTab({ win, q, sol }: { win: HotWin; q: string; sol: number }) {
  const { data, error } = usePoll<HotAnswer>(hotPath(win), 5000, true);
  const fresh = data && String(data.w) === win ? data : null;
  const top = fresh?.top.filter((h) => h.chain === SOLANA) ?? null;
  const tf: Tf = win === "5" ? "5m" : "1h";
  // In a fixed order: these addresses then only change when the coins do (answers are kept by address).
  const mints = top?.map((h) => h.mint).sort().join(",") || "";
  const { data: blix } = usePoll<{ rows: Row[] }>(mints ? `tokens?${new URLSearchParams({ mints, limit: "200" })}` : null, 5000, true);
  const { data: live } = usePoll<Sparks>(mints ? `sparks?${new URLSearchParams({ w: tf, m: mints })}` : null, 3000);
  useEffect(() => { if (mints) warmPics(mints.split(",")); }, [mints]);
  takeSparks(live);   // newest figures per coin, whichever answer lands last (fresh.ts)
  takeRows(blix);   // Blix's row per coin, kept across reads (fresh.ts)
  const byMint = { get: (m: string) => keptRow<Row>(m) };
  const needle = q.trim().toLowerCase();
  const most = Math.max(1, ...(top || []).map((h) => h.n));
  const rows = top?.map((h, i) => ({ h, rank: i + 1 })).filter(({ h }) => {
    const b = byMint.get(h.mint);
    return !needle || `${h.ticker} ${b?.symbol} ${b?.name} ${h.mint}`.toLowerCase().includes(needle);
  }).map(({ h, rank }) => {
    const b = byMint.get(h.mint), base: Row = b ? { ...b, image: b.image || h.img, symbol: b.symbol || h.ticker } : fromHot(h);
    const l = freshest(h.mint, tf);
    if (l) noteLive(`${h.mint}:${tf}`, l.chg);
    const row = l ? withLive({ ...base, spark: l.spark ?? base.spark, spark_chg: l.chg, mc_live: l.mc ?? base.mc_live }, l.live, tf) : sparkOrKeep(base, `${h.mint}:${tf}`);
    return { h, rank, row };
  }) ?? null;
  const label = win === "60" ? "hour" : `${win} minutes`;

  return (
    <>
      {fresh?.since && <p className="-mb-1 text-sm text-muted">Counting from {Math.max(1, Math.round((Date.now() - fresh.since) / 60_000))}m ago (the server's post ledger fills in up to an hour as posts arrive).</p>}
      <Panel>
        <div className="overflow-x-auto">
          <div className="min-w-[1370px]">
            <div className={cn(HOT_GRID, "metal-bar sticky top-0 z-10 px-4 py-2 text-sm font-medium text-muted")}>
              <span className="pl-7">Posts</span><span>Pair info</span><span>Price {tf}</span><span className="text-right">Market cap</span><span className="text-right">Liquidity</span>
              <span className="text-right">Volume {tf}</span><span className="text-right">Txns {tf}</span><span>Token info</span><span className="text-right">Action</span>
            </div>
            {!rows ? (error && !data ? <Problem text={error} /> : <div className="p-3"><Loading /></div>)
              : rows.length ? rows.map(({ h, rank, row }) => <DiscoverRow key={h.mint} r={row} tf={tf} sol={sol} grid={HOT_GRID} lead={<Lead h={h} rank={rank} heat={h.n / most} />} />)
              : <Empty>{needle ? "No hot coin matches." : `Quiet out there: no coin talk in the last ${label}.`}</Empty>}
          </div>
        </div>
      </Panel>
    </>
  );
}
