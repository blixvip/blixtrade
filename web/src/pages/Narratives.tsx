// Narratives (#/narratives): which themes are hot, the new words showing up in launches, and live bursts.
import { ago, Empty, Loading, money, Page, Panel, Problem, Scroll, Tag, td, tdR, th, thR } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { cn } from "@/lib/utils";

type J = any;

export function Narratives() {
  const { data: d, error } = usePoll<J>("narratives", 20_000);
  const { data: c } = usePoll<J>("clusters", 5000);
  if (!d) return <Page title="Narratives">{error ? <Problem text={error} /> : <Loading />}</Page>;
  return (
    <Page title="Narratives" sub={`Themes across the last ${d.sample.recent.toLocaleString()} launches, against the ${d.sample.older.toLocaleString()} before them.`}>
      <Panel title="Bursts right now" aside={c ? `${c.stats.forming} forming · ${c.stats.launches} launches watched` : ""}>
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Burst</th><th className={th}>State</th><th className={thR}>Launches 10m</th><th className={thR}>Devs</th><th className={thR}>Traders</th><th className={thR}>Volume</th><th className={th}>Lead coin</th><th className={thR}>Since</th></tr></thead><tbody>
          {c?.clusters.length ? c.clusters.map((k: J) => (
            <tr key={k.id} className="hover:bg-paper-3/60"><td className={td}><b className="font-semibold">{k.name}</b><span className="ml-2 text-sm text-muted">{k.keys.slice(0, 3).join(", ")}</span></td>
              <td className={td}><Tag tone={k.state === "running" ? "up" : k.state === "forming" ? "warn" : "ink"}>{k.state}</Tag></td>
              <td className={tdR}>{k.n10}</td><td className={tdR}>{k.devs}</td><td className={tdR}>{k.traders.toLocaleString()}</td><td className={cn(tdR, "font-semibold")}>{money(k.volUsd)}</td>
              <td className={td}>{k.lead ? <a href={`#/coin/${k.lead.mint}`} className="hover:text-ink"><b className="font-semibold">{k.lead.symbol}</b> <span className="num text-muted">{money(k.lead.mcap)}</span></a> : "—"}</td>
              <td className={cn(tdR, "text-muted")}>{ago(k.since)}</td></tr>))
            : <tr><td colSpan={8}><Empty>{c ? "No bursts right now." : "Loading…"}</Empty></td></tr>}
        </tbody></table></Scroll>
      </Panel>
      <div className="grid items-start gap-3 grid-cols-[minmax(0,8fr)_minmax(0,4fr)] max-xl:grid-cols-[minmax(0,1fr)]">
        <Panel title="Themes" aside="heat = share of launches, volume and momentum">
          <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Theme</th><th className={th}>Heat</th><th className={thR}>Launch share</th><th className={thR}>Against before</th><th className={thR}>Volume</th><th className={th}>Lead coins</th></tr></thead><tbody>
            {d.themes.map((t: J) => (
              <tr key={t.name} className="hover:bg-paper-3/60"><td className={cn(td, "font-semibold")}>{t.name}</td>
                <td className={td}><span className="flex items-center gap-2"><i className="block h-1.5 w-24 overflow-hidden rounded-full bg-paper-4"><i className="block h-full rounded-full bg-ink-2" style={{ width: `${Math.min(100, t.heat)}%` }} /></i><b className="num font-semibold">{t.heat}</b></span></td>
                <td className={tdR}>{(t.launchShare * 100).toFixed(1)}%</td><td className={cn(tdR, t.launchLift > 1.1 ? "text-up" : t.launchLift < 0.9 ? "text-down" : "text-ink-2")}>{t.launchLift.toFixed(2)}x</td>
                <td className={tdR}>{money(t.volume)}</td>
                <td className={td}><span className="flex gap-3">{t.top.slice(0, 3).map((k: J) => <a key={k.mint} href={`#/coin/${k.mint}`} className="hover:text-ink"><b className="font-semibold">{k.symbol}</b> <span className="num text-muted">{money(k.mcap)}</span></a>)}</span></td></tr>))}
          </tbody></table></Scroll>
        </Panel>
        <Panel title="New words" aside="in launch names now, rare before">
          <div className="flex flex-wrap gap-1.5 p-4">
            {d.emerging.map((w: J) => <span key={w.word} className="flex h-7 items-center gap-1.5 rounded-full border border-rule-2 bg-paper px-2.5 text-md"><b className="font-semibold">{w.word}</b><span className="num text-muted">{w.count}</span></span>)}
            {!d.emerging.length && <span className="text-muted">Nothing new.</span>}
          </div>
        </Panel>
      </div>
    </Page>
  );
}
