// Narratives (#/narratives): the stories Solana is launching coins about right now. Every launch is compared
// for bursts; Grok names each burst from X. Ranked by how alive each story is, with its coins and source posts.
import { useState } from "react";
import { ago, Empty, Loading, money, Page, Panel, Problem, Scroll, Tag, td, tdR, th, thR } from "@/components/page";
import { Segmented } from "@/components/ui/segmented";
import { usePoll } from "@/lib/coin";
import { cn } from "@/lib/utils";
import { FormingRow, NarrativeCard, ScannerBar, type Feed, type Item } from "./narratives/parts";

type J = any;
type Filter = "all" | "grok" | "live";

export function Narratives() {
  const { data: feed, error } = usePoll<Feed>("narrative-feed", 5000);
  const { data: d } = usePoll<J>("narratives", 20_000);
  const [filter, setFilter] = useState<Filter>("all");
  const [count, setCount] = useState(13);
  const items = (feed?.items || []).filter((i: Item) => filter === "all" || (filter === "grok" ? i.grok : i.stage === "early" || i.stage === "running"));
  const [top, ...rest] = items;
  return (
    <Page title="Narratives" sub="What Solana is launching coins about right now: every launch is scanned for bursts, and Grok reads X to name the story."
      right={<Segmented label="Show" value={filter} onChange={(v) => { setFilter(v); setCount(13); }} options={[["all", "All"], ["grok", "Read by Grok"], ["live", "Early & running"]]} />}>
      {feed ? <ScannerBar feed={feed} /> : error ? (/not found/i.test(error) ? <p className="surface px-4 py-3 text-md text-ink-2">The live narrative feed switches on at Blix's next server restart.</p> : <Problem text={error} />) : <Loading />}

      <div className="grid items-start gap-3 grid-cols-[minmax(0,1fr)_380px] max-xl:grid-cols-[minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          {top ? <NarrativeCard item={top} rank={1} big /> : feed && <Panel><Empty>No narratives in the last 12 hours{filter !== "all" ? " for this filter" : ""}.</Empty></Panel>}
          {rest.length > 0 && <div className="grid items-start gap-3 grid-cols-2 max-lg:grid-cols-1">{rest.slice(0, count - 1).map((it, i) => <NarrativeCard key={it.id} item={it} rank={i + 2} />)}</div>}
          {items.length > count && <button onClick={() => setCount(count + 12)} className="surface h-10 text-md text-ink-2 hover:text-ink">Show more ({items.length - count} left)</button>}
        </div>

        <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-3">
          <Panel title="Forming now" aside={feed ? `${feed.forming.length} unnamed` : ""}>
            {feed?.forming.length ? feed.forming.map((f) => <FormingRow key={f.id} f={f} />) : <Empty>{feed ? "No new bursts this minute." : "Loading…"}</Empty>}
          </Panel>
          {d && (
            <Panel title="Hot themes" aside="share of launches vs before">
              <div className="flex flex-col py-1">
                {d.themes.slice(0, 10).map((t: J) => (
                  <div key={t.name} className="flex items-center gap-3 px-4 py-1.5">
                    <span className="w-32 truncate font-medium">{t.name}</span>
                    <i className="block h-1.5 flex-1 overflow-hidden rounded-full bg-paper-4"><i className="block h-full rounded-full bg-ink-2" style={{ width: `${Math.min(100, t.heat)}%` }} /></i>
                    <span className={cn("num w-12 text-right text-sm", t.launchLift > 1.1 ? "text-up" : t.launchLift < 0.9 ? "text-down" : "text-muted")}>{t.launchLift.toFixed(2)}x</span>
                    <a href={t.top[0] ? `#/coin/${t.top[0].mint}` : undefined} className="w-20 truncate text-right text-sm text-muted hover:text-ink">{t.top[0]?.symbol || ""}</a>
                  </div>))}
              </div>
            </Panel>
          )}
          {d && (
            <Panel title="New words" aside="in launch names now, rare before">
              <div className="flex flex-wrap gap-1.5 p-4">
                {d.emerging.map((w: J) => <span key={w.word} className="flex h-7 items-center gap-1.5 rounded-full border border-rule-2 bg-paper px-2.5 text-md"><b className="font-semibold">{w.word}</b><span className="num text-muted">{w.count}</span></span>)}
                {!d.emerging.length && <span className="text-muted">Nothing new.</span>}
              </div>
            </Panel>
          )}
        </aside>
      </div>

      <Bursts />
    </Page>
  );
}

// Every burst the detector is tracking, named or not: the raw view behind the cards.
function Bursts() {
  const { data: c } = usePoll<J>("clusters", 5000);
  const [open, setOpen] = useState(false);
  return (
    <Panel title={<button onClick={() => setOpen(!open)} className="flex items-center gap-2">{open ? "▾" : "▸"} All bursts</button>} aside={c ? `${c.stats.forming} forming · ${c.stats.launches} launches watched` : ""}>
      {open && <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Burst</th><th className={th}>State</th><th className={thR}>Launches 10m</th><th className={thR}>Devs</th><th className={thR}>Traders</th><th className={thR}>Volume</th><th className={th}>Lead coin</th><th className={thR}>Since</th></tr></thead><tbody>
        {c?.clusters.length ? c.clusters.map((k: J) => (
          <tr key={k.id} className="hover:bg-paper-3/60"><td className={td}><b className="font-semibold">{k.name || k.keys[0]}</b><span className="ml-2 text-sm text-muted">{k.keys.slice(0, 3).join(", ")}</span></td>
            <td className={td}><Tag tone={k.state === "running" ? "up" : k.state === "forming" ? "warn" : "ink"}>{k.state}</Tag></td>
            <td className={tdR}>{k.n10}</td><td className={tdR}>{k.devs}</td><td className={tdR}>{k.traders.toLocaleString()}</td><td className={cn(tdR, "font-semibold")}>{money(k.volUsd)}</td>
            <td className={td}>{k.lead ? <a href={`#/coin/${k.lead.mint}`} className="hover:text-ink"><b className="font-semibold">{k.lead.symbol}</b> <span className="num text-muted">{money(k.lead.mcap)}</span></a> : "—"}</td>
            <td className={cn(tdR, "text-muted")}>{ago(k.since)}</td></tr>))
          : <tr><td colSpan={8}><Empty>{c ? "No bursts right now." : "Loading…"}</Empty></td></tr>}
      </tbody></table></Scroll>}
    </Panel>
  );
}
