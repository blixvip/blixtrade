// Discover's Top and Most held tabs: Fomo's own lists (fomo.family's Trending and Most held tabs), in Fomo's
// order with Fomo's figures, nothing filtered or re-sorted except coins on Ethereum and BNB Chain (kept off Blix
// for now). server/fomolists.js reads the lists through Aside. Each coin is drawn with the same row as every
// other Discover list: Blix's own reading of it (audit pills, links, buys and sells) under Fomo's figures, and
// Blix's live feed on top (price line and market cap, every 1.5 s) so the list keeps moving between Fomo reads.
import { useEffect, useMemo, useState } from "react";
import { Empty, Loading, Panel, Problem } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { cn } from "@/lib/utils";
import { DiscoverRow, GRID, withLive, type ExtCoin, type LiveFigures, type Row } from "./parts";

export type FomoKind = "top" | "held";
interface FomoRow {
  mint: string; chain: number; symbol: string; name: string; img: string | null; price: number | null; mcap: number | null; chg: number | null;
  liq: number | null; vol: number | null; holders: number | null; created: number | null; pad: string | null; padIcon: string | null;
  x: string | null; web: string | null; tg: string | null; verified: boolean;
}
interface FomoList { rows: FomoRow[] | null; t: number | null; loading: boolean; error: string | null; signedOut: boolean }
type Sparks = { w: string; rows: Record<string, { spark: [number, number][]; mc: number | null; chg: number | null; live: LiveFigures | null }> };

const SOL = 1399811149;
// Fomo's chain ids (its chains module). Ethereum and BNB Chain coins stay off Blix for now (the owner's call).
const CHAINS: Record<number, string> = { [SOL]: "Solana", 1: "Ethereum", 8453: "Base", 56: "BNB Chain", 4663: "Robinhood Chain", 143: "Monad" };
const CHAIN_TAG: Record<number, string> = { 8453: "BASE", 4663: "RH", 143: "MON" };
const HIDE_CHAINS = new Set([1, 56]);

// A Fomo row as a Discover row: Blix's reading of the coin when it has one, Fomo's figures over it.
function toRow(f: FomoRow, blix: Row | undefined): Row {
  const links = ([["twitter", f.x], ["website", f.web], ["telegram", f.tg]] as const).filter(([, u]) => u).map(([type, url]) => ({ type, url: url! }));
  const base: Row = blix ? { ...blix } : {
    mint: f.mint, symbol: f.symbol, name: f.name, image: f.img, dex: null, pair_created: f.created, first_seen: f.created || Date.now(), mcap: null, liquidity: null,
    vol_m5: null, vol_h1: null, vol_h24: null, buys_m5: null, sells_m5: null, buys_h1: null, sells_h1: null, chg_m5: null, chg_h1: null, chg_h24: null,
    links: null, boosts: null, header: null, graduated: 1, safety_score: null, score: null, safety: null,
  };
  return { ...base, symbol: f.symbol || base.symbol, name: f.name || base.name, mcap: f.mcap ?? base.mcap, liquidity: f.liq ?? base.liquidity,
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

export function FomoTab({ kind, q, sol }: { kind: FomoKind; q: string; sol: number }) {
  const list = kind === "top" ? "trending" : kind;
  const { data: fresh, error } = usePoll<FomoList>(`fomo/list?kind=${list}`, 3000);
  const saved = useMemo(() => kept(list), [list]);
  useEffect(() => { if (fresh?.rows?.length) keep(list, fresh); }, [fresh, list]);
  // A tab switch draws the rows on screen first and the rest a frame later, so the switch is immediate.
  const [upTo, setUpTo] = useState(15);
  useEffect(() => { setUpTo(15); const f = requestAnimationFrame(() => requestAnimationFrame(() => setUpTo(Infinity))); return () => cancelAnimationFrame(f); }, [list]);
  const d = fresh?.rows?.length ? fresh : saved && !fresh?.signedOut ? { ...saved, error: fresh?.error ?? null } : fresh;
  const shown = d?.rows?.filter((r) => !HIDE_CHAINS.has(r.chain)) || null;
  const mints = shown?.filter((r) => r.chain === SOL).map((r) => r.mint).join(",") || "";
  const { data: blix } = usePoll<{ rows: Row[] }>(mints ? `tokens?${new URLSearchParams({ mints, limit: "200" })}` : null, 5000);
  const { data: live } = usePoll<Sparks>(mints ? `sparks?${new URLSearchParams({ w: "24h", m: mints })}` : null, 1500);
  const byMint = new Map((blix?.rows || []).map((r) => [r.mint, r]));
  const needle = q.trim().toLowerCase();
  const rows = shown?.filter((r) => !needle || `${r.symbol} ${r.name} ${r.mint}`.toLowerCase().includes(needle)).map((f) => {
    const r = toRow(f, byMint.get(f.mint)), l = f.chain === SOL ? live?.rows[f.mint] : undefined;
    const row = l ? withLive({ ...r, spark: l.spark, spark_chg: l.chg, mc_live: l.mc }, l.live, "24h") : r;
    const ext: ExtCoin | undefined = f.chain === SOL ? undefined
      : { url: `https://dexscreener.com/search?q=${encodeURIComponent(f.mint)}`, chain: CHAINS[f.chain] || `Chain ${f.chain}`, tag: CHAIN_TAG[f.chain] || "EVM", img: f.img };
    return { row, ext, key: `${f.chain}:${f.mint}` };
  }) || null;
  const age = d?.t ? Math.max(0, Math.round((Date.now() - d.t) / 1000)) : null;

  return (
    <Panel>
      <div className="overflow-x-auto">
        <div className="min-w-[1180px]">
          <div className={cn(GRID, "metal-bar sticky top-0 z-10 px-4 py-2 text-sm font-medium text-muted")}>
            <span>Pair info</span><span>Price 24h</span><span className="text-right">Market cap</span><span className="text-right">Liquidity</span>
            <span className="text-right">Volume 24h</span><span className="text-right">Txns 1h</span><span>Token info</span>
            <span className="text-right text-xs" title="Fomo's list is read every few seconds; prices and market caps move live in between">{age != null ? `fomo.family · ${age}s` : "fomo.family"}</span>
          </div>
          {d?.signedOut ? <Problem text="Aside is signed out of Fomo. Sign in at fomo.family in your Aside browser and this list fills in by itself." />
            : !rows ? (error || d?.error ? <Problem text={d?.error || error || "Couldn't reach Fomo."} /> : <div className="p-3"><Loading /><p className="px-1 pt-2 text-sm text-muted">Reading Fomo's list through Aside (a few seconds the first time)…</p></div>)
            : rows.length ? rows.slice(0, upTo).map(({ row, ext, key }) => <DiscoverRow key={key} r={row} tf="24h" sol={sol} ext={ext} />)
            : <Empty>{needle ? "No coin in Fomo's list matches." : "Fomo's list is empty right now."}</Empty>}
        </div>
      </div>
    </Panel>
  );
}
