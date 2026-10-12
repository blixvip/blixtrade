// Discover's Top and Most held tabs: Fomo's own lists (fomo.family's Trending and Most held tabs), in Fomo's
// order with Fomo's figures, nothing filtered or re-sorted except coins on Ethereum, BNB Chain and Robinhood Chain (kept off Blix
// for now). server/fomolists.js reads the lists through Aside. Each coin is drawn with the same row as every
// other Discover list: Blix's own reading of it (audit pills, links, buys and sells) under Fomo's figures, and
// Blix's live feed on top (price line and market cap, every 1.5 s) so the list keeps moving between Fomo reads.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Empty, Loading, Panel, Problem } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { Icon } from "@/shell/icons";
import { noteLive, sparkOrKeep } from "@/components/Spark";
import { DiscoverRow, GRID, withLive, type ExtCoin, type LiveFigures, type Row } from "./parts";
import { freshest, keptRow, takeRows, takeSparks, withGrace } from "./fresh";

export type FomoKind = "top" | "held";
interface FomoRow {
  mint: string; chain: number; symbol: string; name: string; img: string | null; price: number | null; mcap: number | null; chg: number | null;
  liq: number | null; vol: number | null; holders: number | null; created: number | null; pad: string | null; padIcon: string | null;
  x: string | null; web: string | null; tg: string | null; verified: boolean; src?: "blix";
}
interface FomoList { rows: FomoRow[] | null; t: number | null; loading: boolean; error: string | null; signedOut: boolean }
type Sparks = { w: string; rows: Record<string, { spark: [number, number][]; mc: number | null; chg: number | null; live: LiveFigures | null }> };

const SOL = 1399811149;
// Fomo's chain ids (its chains module). Ethereum, BNB Chain and Robinhood Chain coins stay off Blix (the owner's
// call; the radar drops them too, server/chains.js).
const CHAINS: Record<number, string> = { [SOL]: "Solana", 1: "Ethereum", 8453: "Base", 56: "BNB Chain", 4663: "Robinhood Chain", 143: "Monad" };
const CHAIN_TAG: Record<number, string> = { 8453: "BASE", 4663: "RH", 143: "MON" };
const HIDE_CHAINS = new Set([1, 56, 4663]);
// Only chains Blix knows by name: an unnamed one (drawn as "Chain 5042") never shows (server/chains.js too).
const shownChain = (c: number) => c in CHAINS && !HIDE_CHAINS.has(c);
// Fomo lists SOL itself among the most held: not a coin to trade here.
const WSOL = "So11111111111111111111111111111111111111112";

// A Fomo row as a Discover row: Blix's reading of the coin when it has one, Fomo's figures over it.
function toRow(f: FomoRow, blix: Row | undefined): Row {
  const links = ([["twitter", f.x], ["website", f.web], ["telegram", f.tg]] as const).filter(([, u]) => u).map(([type, url]) => ({ type, url: url! }));
  const base: Row = blix ? { ...blix } : {
    mint: f.mint, symbol: f.symbol, name: f.name, image: f.img, dex: null, pair_created: f.created, first_seen: f.created || Date.now(), mcap: null, liquidity: null,
    vol_m5: null, vol_h1: null, vol_h24: null, buys_m5: null, sells_m5: null, buys_h1: null, sells_h1: null, chg_m5: null, chg_h1: null, chg_h24: null,
    links: null, boosts: null, header: null, graduated: 1, safety_score: null, score: null, safety: null,
  };
  return { ...base, image: base.image || f.img, symbol: f.symbol || base.symbol, name: f.name || base.name, mcap: f.mcap ?? base.mcap, liquidity: f.liq ?? base.liquidity,
    vol_h24: f.vol ?? base.vol_h24, chg_h24: f.chg ?? base.chg_h24, pair_created: f.created ?? base.pair_created, links: base.links?.length ? base.links : links,
    safety: { ...(base.safety || {}), totalHolders: f.holders ?? base.safety?.totalHolders }, fresh: undefined };
}

// The last list each tab showed, kept in this browser: a fresh page shows it at once (with its age) while
// the radar's answer is on its way, instead of a loading box. Fine to lose (private window, cleared data).
const KEEP = (kind: string) => `blix:fomo:${kind}`;
function kept(kind: string): FomoList | null {
  try { const j = JSON.parse(localStorage.getItem(KEEP(kind)) || "null"); return j?.rows?.length ? j : null; } catch { return null; }
}
function keep(kind: string, d: FomoList) {
  try { if (d.rows?.length) localStorage.setItem(KEEP(kind), JSON.stringify({ rows: d.rows, t: d.t, loading: false, error: null, signedOut: false })); } catch { /* storage full or off */ }
}

// `hidden`, `onHide`, `onHideAll`: the page's hidden coins (Coins.tsx): hidden Solana coins are left out, and a
// Solana row's eye (on hover) hides it.
export function FomoTab({ kind, q, sol, hidden, onHide, onHideAll }: { kind: FomoKind; q: string; sol: number; hidden?: Set<string>; onHide?: (mint: string) => void; onHideAll?: (mints: string[]) => void }) {
  const list = kind === "top" ? "trending" : kind;
  const { data: fresh, error } = usePoll<FomoList>(`fomo/list?kind=${list}`, 3000);
  const saved = useMemo(() => kept(list), [list]);
  useEffect(() => { if (fresh?.rows?.length) keep(list, fresh); }, [fresh, list]);
  const d = fresh?.rows?.length ? fresh : saved && !fresh?.signedOut ? { ...saved, error: fresh?.error ?? null } : fresh;
  // Most held: every Solana coin Fomo lists (only ~12), then Blix's own most-held coins (src "blix", fomolists.js).
  const listed = d?.rows?.filter((r) => shownChain(r.chain) && (kind !== "held" || (r.chain === SOL && r.mint !== WSOL)) && !(r.chain === SOL && hidden?.has(r.mint))) || null;
  const shown = listed && withGrace(`fomo:${list}`, listed, (r) => `${r.chain}:${r.mint}`);
  // In a fixed order: these addresses then only change when the coins do (answers are kept by address).
  const mints = shown?.filter((r) => r.chain === SOL).map((r) => r.mint).sort().join(",") || "";
  const { data: blix } = usePoll<{ rows: Row[] }>(mints ? `tokens?${new URLSearchParams({ mints, limit: "200" })}` : null, 5000);
  const { data: live } = usePoll<Sparks>(mints ? `sparks?${new URLSearchParams({ w: "24h", m: mints })}` : null, 3000);
  // Coins on other chains: their day's line and market cap from DexScreener (server/extsparks.js).
  const ext = shown?.filter((r) => r.chain !== SOL).map((r) => r.mint).sort().join(",") || "";
  const { data: extLive } = usePoll<{ rows: Record<string, { spark: [number, number][]; mc: number | null; chg: number | null }> }>(ext ? `ext-sparks?${new URLSearchParams({ m: ext })}` : null, 4000);
  takeSparks(live);   // newest figures per coin, whichever answer lands last (fresh.ts)
  takeRows(blix);     // and Blix's row per coin, kept across reads (a new set of coins asks a new address)
  const byMint = { get: (m: string) => keptRow<Row>(m) };
  const needle = q.trim().toLowerCase();
  const rows = shown?.filter((r) => !needle || `${r.symbol} ${r.name} ${r.mint}`.toLowerCase().includes(needle)).map((f) => {
    const r = toRow(f, f.chain === SOL ? byMint.get(f.mint) : undefined), l = f.chain === SOL ? freshest(f.mint, "24h") : undefined;
    if (l) noteLive(`${f.mint}:24h`, l.chg);
    const e = f.chain !== SOL ? extLive?.rows[f.mint] : undefined;
    if (e) noteLive(`${f.mint}:24h`, e.chg);
    const row = l ? withLive({ ...r, spark: l.spark ?? r.spark, spark_chg: l.chg, mc_live: l.mc ?? r.mc_live }, l.live, "24h")
      : e ? { ...r, spark: e.spark, spark_chg: e.chg, mc_live: e.mc ?? r.mc_live } : sparkOrKeep(r, `${f.mint}:24h`);
    const ext: ExtCoin | undefined = f.chain === SOL ? undefined
      : { url: `https://dexscreener.com/search?q=${encodeURIComponent(f.mint)}`, chain: CHAINS[f.chain] || `Chain ${f.chain}`, network: f.chain, tag: CHAIN_TAG[f.chain] || "EVM", img: f.img };
    return { row, ext, key: `${f.chain}:${f.mint}`, blix: f.src === "blix" };
  }) || null;
  // An older Fomo list is shown as it is, without a notice: prices and market caps under each coin move live anyway.

  return (
    <Panel>
      <div className="overflow-x-auto">
        <div className="min-w-[1240px]">
          <div className={cn(GRID, "metal-bar sticky top-0 z-10 px-4 py-2 text-sm font-medium text-muted")}>
            <span>Pair info</span><span>Price 24h</span><span className="text-right">Market cap</span><span className="text-right">Liquidity</span>
            <span className="text-right">Volume 24h</span><span className="text-right">Txns 24h</span><span>Token info</span>
            <span className="flex items-center justify-end">
              {onHideAll && rows && rows.some((r) => !r.ext) && <Tip tip="Hide every coin on screen"><button onClick={() => onHideAll(rows.filter((r) => !r.ext).map((r) => r.row.mint))} className="flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-xs text-muted hover:bg-paper-4 hover:text-ink"><Icon.eyeOff className="size-3.5" />Hide all</button></Tip>}
            </span>
          </div>
          {d?.signedOut ? <Problem text="Nothing to show right now. This list fills in by itself." />
            : !rows ? (error || d?.error ? <Problem text="Nothing to show right now. This list fills in by itself." /> : <div className="p-3"><Loading /><p className="px-1 pt-2 text-sm text-muted">Loading…</p></div>)
            : rows.length ? rows.map(({ row, ext, key }) => (
              <Fragment key={key}>
                <DiscoverRow r={row} tf="24h" sol={sol} ext={ext} onHide={ext ? undefined : onHide} />
              </Fragment>))
            : <Empty>{needle ? "No coin in Fomo's list matches." : kind === "held" ? "Fomo's Most held list is empty right now." : "Fomo's list is empty right now."}</Empty>}
        </div>
      </div>
    </Panel>
  );
}
