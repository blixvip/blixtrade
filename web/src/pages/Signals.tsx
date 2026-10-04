// Signals (#/signals): what the radar is alerting on, beside the coins moving most.
import { ago, CoinCell, Empty, Kpis, Loading, money, mult, Page, Panel, Problem, Scroll, Tag, td, tdR, th, thR, toneX } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { pct, tone } from "@/lib/format";
import { cn } from "@/lib/utils";

type J = any;   // the radar's JSON, read as it comes
const BAD = /^(dump|devsold|dev-sold|rug|liq|liquidity|unsellable|dead)/;
const kindName = (k: string) => k.startsWith("mcap-") ? `${k.slice(5).toUpperCase()} cap` : k.startsWith("wallet:") ? "Wallet buy" : ({ dump: "Dump warning", devsold: "Dev sold", launch: "New launch", momentum: "Momentum", volume: "Volume spike", graduated: "Graduated", rug: "Rugged", fomo: "Fomo buys", pick: "AI pick" } as Record<string, string>)[k] || k.replace(/[-_]/g, " ");

export function Signals() {
  const { data: o, error } = usePoll<J>("overview", 5000);
  if (!o) return <Page title="Signals">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const s = o.stats, c = o.counts;
  return (
    <Page title="Signals" sub="Alerts as they fire, and the coins moving most.">
      <Kpis items={[
        ["Launches / hr", (s.launchesLastHour ?? 0).toLocaleString(), `${s.launchDataMin ?? 0}m of data`],
        ["Tracking", c.tracked.toLocaleString(), `${s.nursery} waiting`],
        ["Pass safety", c.safe.toLocaleString(), `of ${c.tracked}`],
        ["Signals 24h", c.signals24h.toLocaleString(), `+${c.unscreened24h} unscreened`],
        ["Graduations", c.graduated24h.toLocaleString(), "last 24h"],
        ["Health", o.health.issues ? `${o.health.issues} issue${o.health.issues > 1 ? "s" : ""}` : "All good", o.health.issues ? o.health.summary.slice(0, 2).join(", ") : `scanned ${ago(s.lastCycle)}`, o.health.issues ? "text-warn" : "text-up"],
      ]} />
      <div className="grid items-start gap-3 grid-cols-[minmax(0,5fr)_minmax(0,7fr)] max-xl:grid-cols-[minmax(0,1fr)]">
        <Panel title="Live signals" aside="passed the safety check when they fired">
          {o.signals.length ? o.signals.map((g: J) => {
            const bad = BAD.test(g.kind);
            return (
              <a key={g.id} href={`#/coin/${g.mint}`} className="flex items-start gap-3 border-t border-rule px-4 py-3 first:border-t-0 hover:bg-paper-3/60">
                <span className="relative mt-0.5 grid size-9 shrink-0 place-items-center overflow-hidden rounded-chip bg-paper-4 text-2xs font-semibold text-muted uppercase">
                  {(g.symbol || "?").slice(0, 3)}<img src={`/img/${g.mint}`} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} /></span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2"><Tag tone={bad ? "down" : "up"}>{kindName(g.kind)}</Tag><span className="text-sm text-muted">{ago(g.t)}</span></span>
                  <b className="truncate font-semibold text-ink">{g.title}</b>
                  <span className="truncate text-sm text-muted">{g.detail}</span>
                </span>
                <span className={cn("num shrink-0 text-md font-semibold", g.exitable === false ? "text-down" : toneX(g.since))}>{g.exitable === false ? "can't sell" : g.since != null ? `${mult(g.since)} since` : ""}</span>
              </a>
            );
          }) : <Empty>No signals yet.</Empty>}
        </Panel>
        <Panel title="Top movers" aside={<a href="#/coins" className="hover:text-ink">All coins ›</a>}>
          <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={thR}>Score</th><th className={thR}>Safety</th><th className={thR}>MCap</th><th className={thR}>Vol 1h</th><th className={thR}>1h</th></tr></thead><tbody>
            {o.top.map((t: J) => (
              <tr key={t.mint} className="hover:bg-paper-3/60"><td className={td}><CoinCell mint={t.mint} symbol={t.symbol} name={t.name} /></td>
                <td className={cn(tdR, "font-semibold")}>{t.score ?? "—"}</td>
                <td className={cn(tdR, t.safety_score >= 70 ? "text-up" : t.safety_score >= 40 ? "text-warn" : "text-down")}>{t.safety_score ?? "—"}</td>
                <td className={cn(tdR, "font-semibold")}>{money(t.mcap)}</td><td className={tdR}>{money(t.vol_h1)}</td><td className={cn(tdR, tone(t.chg_h1))}>{pct(t.chg_h1)}</td></tr>))}
          </tbody></table></Scroll>
        </Panel>
      </div>
    </Page>
  );
}
