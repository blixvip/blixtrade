// Picks (#/picks): every coin Blix picked and what its one exit rule would have returned. Paper only.
import { useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { ago, CoinCell, Empty, gradeTone, Kpis, Loading, money, mult, Page, Panel, Problem, Scroll, td, tdR, th, thR, toneX } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { cn } from "@/lib/utils";

type J = any;
const usd = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n) >= 1000 ? `${(Math.abs(n) / 1000).toFixed(1)}K` : Math.abs(n).toFixed(0)}`;

// The running result of $100 into every pick, as one line against break-even.
function Curve({ pts }: { pts: { t: number; v: number }[] }) {
  if (pts.length < 2) return <Empty>The line appears after the second pick closes.</Empty>;
  const W = 1000, H = 180, vs = pts.map((p) => p.v), lo = Math.min(0, ...vs), hi = Math.max(0, ...vs), span = hi - lo || 1;
  const x = (i: number) => (i / (pts.length - 1)) * W, y = (v: number) => H - 8 - ((v - lo) / span) * (H - 16);
  const last = vs[vs.length - 1], line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  return (
    <div className="px-4 py-3">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-44 w-full" role="img" aria-label={`Running result: ${usd(last)} after ${pts.length} picks, high ${usd(hi)}, low ${usd(lo)}`}>
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-rule-2)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <path d={`${line}L${W},${y(0)}L0,${y(0)}Z`} fill={last >= 0 ? "var(--color-up)" : "var(--color-down)"} opacity="0.1" />
        <path d={line} fill="none" stroke={last >= 0 ? "var(--color-up)" : "var(--color-down)"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="num flex justify-between text-sm text-muted"><span>{new Date(pts[0].t).toLocaleDateString([], { month: "short", day: "numeric" })}</span><span>high {usd(hi)} · low {usd(lo)}</span><span>now</span></div>
    </div>
  );
}

function Split({ title, rows }: { title: string; rows: J[] }) {
  return (
    <Panel title={title}>
      <table className="w-full text-md"><tbody>{rows.map((r) => (
        <tr key={r.key}><td className={cn(td, "capitalize first:border-t-0")}>{r.key}</td><td className={cn(tdR, "text-muted")}>{r.wins}/{r.n} won</td><td className={cn(tdR, "font-semibold", toneX(r.avg))}>{`${r.avg >= 1 ? "+" : "−"}${Math.abs((r.avg - 1) * 100).toFixed(0)}%`}</td></tr>))}
      </tbody></table>
    </Panel>
  );
}

export function Picks() {
  const { data: d, error } = usePoll<J>("picks/all", 8000);
  const [show, setShow] = useState<"all" | "open" | "won" | "lost">("all");
  if (!d) return <Page title="Picks">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const t = d.totals, r = d.rule;
  const picks = d.picks.filter((p: J) => show === "all" || (show === "open" ? !p.ruleClosed : show === "won" ? p.ruleClosed && p.ruleX >= 1 : p.ruleClosed && p.ruleX < 1));
  return (
    <Page title="Picks" sub="Every coin Blix picked, sold by one exit rule. Paper only: nothing is bought.">
      {d.guard?.until > Date.now() && <p className="rounded-control border border-warn/40 bg-warn/10 px-3 py-2 text-md text-ink-2"><b className="text-warn">New picks paused.</b> {d.guard.why}</p>}
      <Kpis items={[
        ["Picks", t.n, `${t.open} open · ${t.closed} closed`],
        ["Won", `${t.winPct}%`, `${t.wins} of ${t.closed} above entry`, t.winPct >= 50 ? "text-up" : "text-down"],
        ["Average result", `${t.avg >= 1 ? "+" : "−"}${Math.abs((t.avg - 1) * 100).toFixed(1)}%`, `typical pick ${t.median >= 1 ? "+" : "−"}${Math.abs((t.median - 1) * 100).toFixed(1)}%`, toneX(t.avg)],
        ["$100 in every pick", usd(t.pnl), `after ${d.paper?.costPctPerSide ?? 0}% costs each side`, t.pnl >= 0 ? "text-up" : "text-down"],
        ["Best", t.best ? mult(t.best.x) : "—", t.best ? `$${t.best.symbol}` : "", "text-up"],
        ["Stopped out", `${t.closed ? Math.round((t.stops / t.closed) * 100) : 0}%`, `${t.stops} stop losses`],
      ]} />
      <Panel title="Running result" aside={`$100 into every pick · half at ${r.takeProfit}x, ${r.trailPct}% trailing stop, ${r.stopPct}% stop, ${r.maxHours}h limit`}><Curve pts={d.curve} /></Panel>
      <div className="grid gap-3 grid-cols-[repeat(3,minmax(0,1fr))] max-lg:grid-cols-[minmax(0,1fr)]">
        <Split title="By stage when picked" rows={d.byStage} /><Split title="By what the AI said" rows={d.byAction} /><Split title="By what made it a pick" rows={d.byVia} />
      </div>
      <Panel title="Every pick" aside={<Segmented value={show} options={[["all", "All"], ["open", "Open"], ["won", "Won"], ["lost", "Lost"]]} onChange={setShow} label="Which picks to show" />}>
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={th}>AI call</th><th className={th}>Why picked</th><th className={thR}>Entry cap</th><th className={thR}>Peak</th><th className={thR}>Now</th><th className={thR}>Rule result</th><th className={th}>How it ended</th><th className={thR}>Picked</th></tr></thead><tbody>
          {picks.length ? picks.slice(0, 150).map((p: J) => (
            <tr key={`${p.mint}${p.t}`} className="hover:bg-paper-3/60"><td className={td}><CoinCell mint={p.mint} symbol={p.symbol} name={p.name} sub={p.tag} /></td>
              <td className={td}><b className={cn("font-semibold", gradeTone(p.grade))}>{p.grade || "—"}</b> <span className="text-muted">{p.action}</span></td>
              <td className={cn(td, "text-ink-2")}>{p.via}</td><td className={tdR}>{money(p.entry)}</td><td className={cn(tdR, toneX(p.peak))}>{mult(p.peak)}</td>
              <td className={cn(tdR, p.unsellable ? "text-down" : toneX(p.now))}>{p.unsellable ? "can't sell" : mult(p.now)}</td>
              <td className={cn(tdR, "font-semibold", toneX(p.ruleX))}>{mult(p.ruleX)}</td><td className={cn(td, "text-ink-2")}>{p.ruleClosed ? p.ruleWhy : "still open"}</td><td className={cn(tdR, "text-muted")}>{ago(p.t)}</td></tr>))
            : <tr><td colSpan={9}><Empty>No picks match.</Empty></td></tr>}
        </tbody></table></Scroll>
      </Panel>
    </Page>
  );
}
