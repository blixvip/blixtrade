// AI picks (#/ai-picks): what the AI's deep reads said today (buy, watch or avoid, with its reason), its buy calls
// this week, and how its picks have done. Read-only: nothing is bought.
import { useState, type ReactNode } from "react";
import { Segmented } from "@/components/ui/segmented";
import { ago, CoinCell, Empty, gradeTone, Kpis, Loading, money, mult, Page, Panel, Problem, Scroll, td, tdR, th, thR, toneX } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { rowLink } from "@/lib/route";
import { cn } from "@/lib/utils";
import { DepositGate } from "@/components/DepositGate";

type J = any;
const pct = (x: number) => `${x >= 1 ? "+" : "−"}${Math.abs((x - 1) * 100).toFixed(1)}%`;
const actionTone = (a?: string) => (a === "buy" ? "text-up" : a === "avoid" ? "text-down" : "text-warn");

// Behind the $10 wall (components/DepositGate.tsx): main.tsx wraps this page; AiGate wraps every coin's AI read
// (pages/coin/Tabs.tsx), over a stand-in so no read is queued until it opens.
export { UNLOCK_USD, useDepositUnlock as useAiUnlock } from "@/components/DepositGate";
export function AiGate({ children }: { children: ReactNode }) {
  return <DepositGate page="read" compact preview={<Preview />}>{children}</DepositGate>;
}
export const AiPicks = () => <Picks />;

// What the lock opens, as shapes only: a blurred stand-in for the picks page, so the lock sits on what it guards.
const ACTS = ["buy", "watch", "avoid", "watch", "buy", "avoid", "watch", "buy", "watch"];
function Preview() {
  return (
    <div aria-hidden className="pointer-events-none flex flex-col gap-3 p-4 blur-[5px] select-none">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {["w-10", "w-8", "w-12", "w-9"].map((w, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-control border border-rule bg-paper-3 p-3">
            <i className="h-2 w-16 rounded-full bg-paper-5" /><i className={cn("h-5 rounded bg-ink-2/70", w)} /><i className="h-2 w-20 rounded-full bg-paper-4" />
          </div>
        ))}
      </div>
      <div className="flex flex-col rounded-control border border-rule bg-paper-3">
        {ACTS.map((a, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-rule px-3 py-2.5 last:border-0">
            <i className="size-7 shrink-0 rounded-full bg-paper-5" />
            <div className="flex w-28 flex-col gap-1.5"><i className="h-2.5 w-14 rounded-full bg-ink-2/60" /><i className="h-2 w-20 rounded-full bg-paper-5" /></div>
            <i className={cn("h-5 w-14 shrink-0 rounded-full", a === "buy" ? "bg-up/40" : a === "avoid" ? "bg-down/40" : "bg-warn/35")} />
            <i className="h-2 flex-1 rounded-full bg-paper-5" style={{ maxWidth: `${40 + ((i * 37) % 45)}%` }} />
            <i className="ml-auto h-2.5 w-12 shrink-0 rounded-full bg-paper-5 max-sm:hidden" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Picks() {
  const { data: raw, error } = usePoll<J>("picks", 10000);
  const d = raw && { ...raw, watch: Array.isArray(raw.watch) ? raw.watch : [], calls: Array.isArray(raw.calls) ? raw.calls : [] };   // a list-less answer draws as empty
  const { data: all } = usePoll<J>("picks/all", 15000);
  const [say, setSay] = useState<"all" | "buy" | "watch" | "avoid">("all");
  if (!d) return <Page title="AI early picks">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const s = d.status?.calls ?? {}, t = all?.totals;
  const reads = (d.watch as J[]).filter((w) => say === "all" || w.trade?.action === say);
  return (
    <Page title="AI early picks" sub="What the AI said about today's coins after reading them in depth, and how its picks have done. Not advice.">
      <Kpis items={[
        ["Deep reads", s.deepReads24h ?? 0, "last 24 hours"],
        ["Said buy", s.saidBuy ?? 0, s.topConviction != null ? `best conviction ${s.topConviction} / ${s.threshold}` : `needs conviction ${s.threshold ?? "—"}`, s.saidBuy ? "text-up" : undefined],
        ["Said watch", s.saidWatch ?? 0, "wait for a better entry"],
        ["Said avoid", s.saidAvoid ?? 0, "skipped", s.saidAvoid ? "text-down" : undefined],
        ["Picks won", t ? `${t.winPct}%` : "—", t ? `${t.wins} of ${t.closed} closed above entry` : "", t ? (t.winPct >= 50 ? "text-up" : "text-down") : undefined],
        ["Average pick", t ? pct(t.avg) : "—", t ? `typical ${pct(t.median)}` : "", t ? toneX(t.avg) : undefined],
      ]} />
      {s.why && <p className="rounded-control border border-rule bg-paper-2 px-3 py-2 text-md text-ink-2">{s.why}</p>}

      <Panel title="Today's reads" aside={<Segmented value={say} options={[["all", "All"], ["buy", "Buy"], ["watch", "Watch"], ["avoid", "Avoid"]]} onChange={setSay} label="Which reads to show" />}>
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={th}>Grade</th><th className={th}>AI says</th><th className={thR}>Win odds</th><th className={th}>Why</th><th className={thR}>Cap now</th><th className={thR}>Read</th></tr></thead><tbody>
          {reads.length ? reads.map((w) => (
            <tr key={`${w.mint}${w.t}`} {...rowLink(`#/coin/${w.mint}`)} className="cursor-pointer hover:bg-paper-3/60">
              <td className={td}><CoinCell mint={w.mint} symbol={w.symbol} name={w.name} sub={w.tag} /></td>
              <td className={td}><b className={cn("font-semibold", gradeTone(w.grade))}>{w.grade || "—"}</b> <span className="num text-muted">{w.score}</span></td>
              <td className={cn(td, "font-semibold capitalize", actionTone(w.trade?.action))}>{w.trade?.action || "—"}</td>
              <td className={tdR}>{w.trade?.pWin != null ? `${w.trade.pWin}%` : "—"}</td>
              <td className={cn(td, "max-w-[34rem] whitespace-normal text-ink-2")}>{w.trade?.why || w.verdict}</td>
              <td className={tdR}>{money(w.mcap)}</td>
              <td className={cn(tdR, "text-muted")}>{ago(w.t)}</td>
            </tr>))
            : <tr><td colSpan={7}><Empty>{d.watch.length ? "No reads match." : "No deep reads yet today."}</Empty></td></tr>}
        </tbody></table></Scroll>
      </Panel>

      <Panel title="Buy calls" aside="last 7 days">
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={th}>Grade</th><th className={thR}>Conviction</th><th className={thR}>Entry cap</th><th className={thR}>Peak</th><th className={thR}>Now</th><th className={th}>Status</th><th className={thR}>Called</th></tr></thead><tbody>
          {d.calls.length ? (d.calls as J[]).map((c) => (
            <tr key={c.id} {...rowLink(`#/coin/${c.mint}`)} className="cursor-pointer hover:bg-paper-3/60">
              <td className={td}><CoinCell mint={c.mint} symbol={c.symbol} name={c.name} sub={c.tag} /></td>
              <td className={td}><b className={cn("font-semibold", gradeTone(c.grade))}>{c.grade || "—"}</b></td>
              <td className={tdR}>{c.conviction ?? "—"}</td>
              <td className={tdR}>{money(c.entry_mcap)}</td>
              <td className={cn(tdR, toneX(c.peak_mult))}>{mult(c.peak_mult)}</td>
              <td className={cn(tdR, "font-semibold", toneX(c.exit_mult ?? c.now_mult))}>{mult(c.exit_mult ?? c.now_mult)}</td>
              <td className={cn(td, "text-ink-2")}>{c.status === "open" ? "open" : c.exit_reason || c.status}</td>
              <td className={cn(tdR, "text-muted")}>{ago(c.t)}</td>
            </tr>))
            : <tr><td colSpan={8}><Empty>No buy calls this week. The AI only calls a buy above its conviction bar.</Empty></td></tr>}
        </tbody></table></Scroll>
      </Panel>

      <Panel title="Latest picks" aside={t ? `${t.n} picks · ${t.open} open` : undefined}>
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={th}>AI call</th><th className={thR}>Entry cap</th><th className={thR}>Peak</th><th className={thR}>Result</th><th className={th}>How it ended</th><th className={thR}>Picked</th></tr></thead><tbody>
          {all?.picks?.length ? (all.picks as J[]).slice(0, 40).map((p) => (
            <tr key={`${p.mint}${p.t}`} {...rowLink(`#/coin/${p.mint}`)} className="cursor-pointer hover:bg-paper-3/60">
              <td className={td}><CoinCell mint={p.mint} symbol={p.symbol} name={p.name} sub={p.tag} /></td>
              <td className={td}><b className={cn("font-semibold", gradeTone(p.grade))}>{p.grade || "—"}</b> <span className="text-muted">{p.action}</span></td>
              <td className={tdR}>{money(p.entry)}</td>
              <td className={cn(tdR, toneX(p.peak))}>{mult(p.peak)}</td>
              <td className={cn(tdR, "font-semibold", toneX(p.ruleX))}>{mult(p.ruleX)}</td>
              <td className={cn(td, "text-ink-2")}>{p.ruleClosed ? p.ruleWhy : "still open"}</td>
              <td className={cn(tdR, "text-muted")}>{ago(p.t)}</td>
            </tr>))
            : <tr><td colSpan={7}>{all ? <Empty>No picks yet.</Empty> : <Loading />}</td></tr>}
        </tbody></table></Scroll>
      </Panel>
    </Page>
  );
}
