// Briefs, Track record and Health: three reading pages.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ago, CoinCell, Empty, Kpis, Loading, Markdown, mult, Page, Panel, Problem, Scroll, share, Tag, td, tdR, th, thR, toneX } from "@/components/page";
import { post } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { providerOf } from "@/lib/format";
import { cn } from "@/lib/utils";

type J = any;

// ---------- Briefs (#/briefs) ----------
export function Briefs() {
  const { data: d, error, refresh } = usePoll<J[]>("briefs", 30_000);
  const [busy, setBusy] = useState(false);
  const write = async () => { setBusy(true); try { await post("brief"); toast("Brief ready"); refresh(); } catch (e) { toast((e as Error).message); } setBusy(false); };
  return (
    <Page title="Briefs" sub="The AI's read of the market, written every hour." right={<Button size="lg" variant="primary" className="rounded-full" disabled={busy} onClick={write}>{busy ? "Writing…" : "Write one now"}</Button>}>
      {!d ? (error ? <Problem text={error} /> : <Loading />) : d.length ? d.map((b) => (
        <Panel key={b.id} title={new Date(b.t).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} aside={`${providerOf(b.model)} · ${ago(b.t)}${b.status !== "complete" ? ` · ${b.status}` : ""}`}>
          <div className="p-4 xl:columns-2 xl:gap-10 [&_h3]:break-after-avoid [&_li]:break-inside-avoid [&_p]:break-inside-avoid"><Markdown src={b.body || ""} /></div>
        </Panel>)) : <Panel><Empty>No briefs yet.</Empty></Panel>}
    </Page>
  );
}

// ---------- Track record (#/record) ----------
const kindName = (k: string) => k.startsWith("mcap-") ? `${k.slice(5).toUpperCase()} cap` : k.startsWith("wallet") ? "Wallet buy" : k.replace(/[-_]/g, " ");
export function Record() {
  const { data: d, error } = usePoll<J>("perf", 60_000);
  const [unit, setUnit] = useState<"tokens" | "events">("tokens");
  if (!d) return <Page title="Track record">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const a = d.all[unit];
  const pctOf = (n: number) => share(n, a.eligible1h);
  return (
    <Page title="Track record" sub={`How alerts did over the last ${d.days} days, measured an hour after each one.`}
      right={<span className="flex gap-1"><Button variant={unit === "tokens" ? "primary" : "quiet"} onClick={() => setUnit("tokens")}>Per coin</Button><Button variant={unit === "events" ? "primary" : "quiet"} onClick={() => setUnit("events")}>Per alert</Button></span>}>
      <Kpis items={[
        ["Checked", a.eligible1h.toLocaleString(), `${a.pending1h} still waiting`],
        ["Up 20%+", pctOf(a.up20), `${a.up20} of ${a.eligible1h}`, "text-up"],
        ["Down 50%+", pctOf(a.down50), `${a.down50} of ${a.eligible1h}`, "text-down"],
        ["Could not be sold", pctOf(a.unsellable1h), `${a.unsellable1h}`, a.unsellable1h ? "text-down" : undefined],
        ["Typical after 1h", mult(a.median1h), `average ${mult(a.cappedMean1h)} (capped)`, toneX(a.median1h)],
        ["Reached 2x", share(a.twoX, a.peaks), `typical peak ${mult(a.medianPeak)}`, "text-up"],
      ]} />
      <Panel title="By alert type">
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Type</th><th className={thR}>Checked</th><th className={thR}>Up 20%+</th><th className={thR}>Down 50%+</th><th className={thR}>Unsellable</th><th className={thR}>Typical 1h</th><th className={thR}>Reached 2x</th></tr></thead><tbody>
          {d.byKind.map((k: J) => { const r = k[unit]; return (
            <tr key={k.kind} className="hover:bg-paper-3/60"><td className={cn(td, "font-semibold capitalize")}>{kindName(k.kind)}</td><td className={tdR}>{r.eligible1h}</td>
              <td className={cn(tdR, "text-up")}>{share(r.up20, r.eligible1h)}</td><td className={cn(tdR, "text-down")}>{share(r.down50, r.eligible1h)}</td><td className={tdR}>{share(r.unsellable1h, r.eligible1h)}</td>
              <td className={cn(tdR, "font-semibold", toneX(r.median1h))}>{mult(r.median1h)}</td><td className={tdR}>{share(r.twoX, r.peaks)}</td></tr>); })}
        </tbody></table></Scroll>
      </Panel>
      <div className="grid items-start gap-3 grid-cols-[repeat(2,minmax(0,1fr))] max-2xl:grid-cols-[minmax(0,1fr)]">
        {([["Best calls", d.best], ["Worst calls", d.worst]] as [string, J[]][]).map(([title, rows]) => (
          <Panel key={title} title={title}>
            <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={th}>Alert</th><th className={thR}>Peak</th><th className={thR}>After 1h</th><th className={thR}>Now</th><th className={thR}>When</th></tr></thead><tbody>
              {rows.map((r) => (
                <tr key={`${r.mint}${r.t}`} className="hover:bg-paper-3/60"><td className={td}><CoinCell mint={r.mint} symbol={r.symbol} name={r.name} /></td><td className={cn(td, "text-ink-2 capitalize")}>{kindName(r.kind)}</td>
                  <td className={cn(tdR, toneX(r.peak))}>{mult(r.peak)}</td><td className={cn(tdR, toneX(r.p1h))}>{mult(r.p1h)}</td>
                  <td className={cn(tdR, "font-semibold", r.exitable === false ? "text-down" : toneX(r.nowMult))}>{r.exitable === false ? "can't sell" : mult(r.nowMult)}</td><td className={cn(tdR, "text-muted")}>{ago(r.t)}</td></tr>))}
            </tbody></table></Scroll>
          </Panel>))}
      </div>
      <p className="max-w-[90ch] text-sm text-muted">{d.basis}</p>
    </Page>
  );
}

// ---------- Health (#/health) ----------
const STATE: Record<string, ["up" | "down" | "warn" | "ink", string]> = { ok: ["up", "Working"], degraded: ["warn", "Degraded"], down: ["down", "Down"], off: ["ink", "Off"], idle: ["ink", "Idle"] };
export function Health() {
  const { data: h, error } = usePoll<J>("health", 10_000);
  if (!h) return <Page title="Health">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const rank = (s: string) => ({ down: 0, degraded: 1, ok: 2 } as Record<string, number>)[s] ?? 3;
  return (
    <Page title="Health" sub={`Everything the radar depends on. Running ${ago(h.startedAt).replace(" ago", "")}.`} right={<Tag tone={h.issues ? "warn" : "up"}>{h.issues ? `${h.issues} issue${h.issues > 1 ? "s" : ""}` : "No issues"}</Tag>}>
      <Panel>
        {[...h.parts].sort((a: J, b: J) => rank(a.state) - rank(b.state)).map((p: J) => {
          const [tone, label] = STATE[p.state] || ["ink", p.state];
          return (
            <div key={p.key} className="flex flex-wrap items-start gap-x-4 gap-y-1 border-t border-rule px-4 py-3 first:border-t-0">
              <span className="w-24 shrink-0"><Tag tone={tone}>{label}</Tag></span>
              <div className="min-w-0 flex-1 basis-80"><b className="font-semibold">{p.name}</b><p className="text-md text-ink-2">{p.summary}</p>{p.fix && p.state !== "ok" && <p className="mt-1 text-md text-ink"><b className="font-semibold">What to do:</b> {p.fix}</p>}</div>
              <div className="num flex shrink-0 flex-col items-end text-sm text-muted">{p.lastOk && <span>last success {ago(p.lastOk)}</span>}{p.lastFail && <span>last failure {ago(p.lastFail)}</span>}</div>
            </div>);
        })}
      </Panel>
      <Panel title="Recent problems and events" aside="newest first">
        {h.events.length ? h.events.map((e: J) => (
          <div key={e.id} className="flex items-start gap-3 border-t border-rule px-4 py-2.5 text-md first:border-t-0">
            <i className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", e.kind === "error" ? "bg-down" : "bg-ink-2")} /><span className="min-w-0 flex-1 text-ink-2">{e.text}</span><span className="num shrink-0 text-sm text-muted">{ago(e.t)}</span>
          </div>)) : <Empty>Nothing logged.</Empty>}
      </Panel>
    </Page>
  );
}
