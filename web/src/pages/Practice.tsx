// Practice (#/practice): pick a coin that is trending now, or paste any coin's address, and it opens as its
// normal coin page replayed from its last day (lib/replay.ts), ready to rewind on 1s candles and paper-trade.
import { useMemo, useState } from "react";
import { Panel } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { compact } from "@/lib/format";
import { usePulse, type Coin } from "@/lib/pulse";
import { isDeadCoin } from "./Pulse";

interface Peak { ath: number; athAt: number | null; mc: number; n: number; partial?: boolean }
interface FomoRow { mint: string; chain: number; symbol: string; name: string; img: string | null; mcap: number | null; chg: number | null; vol: number | null }
const SOL = 1399811149;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const open = (mint: string) => { location.hash = `#/coin/${mint}/replay`; };
const age = (ms: number) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

// Each row shows the coin's high of the replayable day (from the radar's own trades, /api/replay/peaks), when it
// was, and where it is now: the moment worth practising, not a list's stale market cap.
function Row({ mint, img, symbol, name, peak, sub }: { mint: string; img?: string | null; symbol?: string; name?: string; peak?: Peak; sub?: string }) {
  return (
    <button onClick={() => open(mint)} className="flex w-full items-center gap-3 border-b border-rule px-4 py-2.5 text-left hover:bg-paper-3/60">
      <img src={img || `img/${mint}.webp`} alt="" className="size-9 shrink-0 rounded-full bg-paper-3 object-cover" loading="lazy" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{symbol || "?"} <span className="font-normal text-muted">{name}</span></span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </span>
      <span className="num text-right">
        <span className="block text-ink"><span className="text-xs text-muted">ATH </span>{peak ? compact(peak.ath) : "–"}</span>
        {peak && <span className="block text-xs text-muted">{peak.athAt ? `${age(Date.now() - peak.athAt)} ago · ` : ""}now <span className={peak.mc >= peak.ath * 0.5 ? "text-up" : "text-down"}>{compact(peak.mc)}</span></span>}
      </span>
      <span className="h-7 rounded-control border border-rule px-3 text-sm leading-7 font-semibold text-ink-2">Practice</span>
    </button>
  );
}

export function Practice() {
  const [ca, setCa] = useState("");
  const trending = usePoll<{ rows: FomoRow[] | null }>("fomo/list?kind=trending", 10_000);
  const cols = usePulse((s) => s.cols), coins = usePulse((s) => s.coins);
  // Coins moving on Blix right now: running and just migrated, the busiest first.
  const live = useMemo(() => [...new Set([...cols.running, ...cols.migrated])].map((m) => coins[m]).filter((c): c is Coin => Boolean(c) && !isDeadCoin(c!))
    .sort((a, b) => (b.liveVol ?? b.vol ?? 0) - (a.liveVol ?? a.vol ?? 0)).slice(0, 30), [cols, coins]);
  const fomoAll = (trending.data?.rows || []).filter((r) => r.chain === SOL && MINT.test(r.mint)).slice(0, 40);
  // Highs of the day for both lists, from the trades Practice replays. A coin the radar has (almost) no trades for,
  // or stopped hearing while it kept trading, can't be replayed whole, so it is left out once the highs are in.
  const want = [...new Set([...fomoAll.map((r) => r.mint), ...live.map((c) => c.mint)])].sort().join(",");
  const peaks = usePoll<Record<string, Peak>>(want ? `replay/peaks?m=${want}` : null, 30_000, true).data;
  const ok = (m: string) => !peaks || (peaks[m]?.n ?? 0) >= 20 && !peaks[m].partial;
  const seen = new Set<string>();
  const fomo = fomoAll.filter((r) => ok(r.mint) && !seen.has(r.mint) && seen.add(r.mint)).slice(0, 30);
  const go = () => { const m = ca.trim(); if (MINT.test(m)) open(m); };
  return (
    <div className="flex min-w-0 flex-col gap-3 p-3 max-md:pb-20">
      <div>
        <h1 className="chrome-text font-display text-2xl font-semibold tracking-tight">Practice</h1>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); go(); }} className="flex gap-2">
        <input value={ca} onChange={(e) => setCa(e.target.value)} placeholder="Paste a coin's address (CA)" spellCheck={false}
          className="h-10 min-w-0 flex-1 rounded-control border border-rule bg-paper-2 px-3 font-mono text-sm text-ink outline-none focus:border-accent" />
        <button disabled={!MINT.test(ca.trim())} className="h-10 rounded-control bg-accent px-5 font-semibold text-accent-ink hover:bg-focus disabled:opacity-40">Practice</button>
      </form>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Trending on Fomo">
          {fomo.length ? fomo.map((r) => <Row key={r.mint} mint={r.mint} img={r.img} symbol={r.symbol} name={r.name} peak={peaks?.[r.mint]} sub={r.vol ? `${compact(r.vol)} volume 24h` : undefined} />)
            : <p className="p-4 text-sm text-muted">{trending.error ? "Fomo's list isn't reachable right now." : "Loading Fomo's trending list…"}</p>}
        </Panel>
        <Panel title="Moving on Blix now">
          {live.some((c) => ok(c.mint)) ? live.filter((c) => ok(c.mint)).map((c) => <Row key={c.mint} mint={c.mint} symbol={c.symbol} name={c.name} peak={peaks?.[c.mint]} sub={`${age(Date.now() - c.born)} old${c.graduated ? " · bonded" : ""}`} />)
            : <p className="p-4 text-sm text-muted">Loading the Pulse board…</p>}
        </Panel>
      </div>
    </div>
  );
}
