// Research (#/research): what the AI is reading, what it rated best, and the coins near or just past bonding.
import { toast } from "@/components/ui/toast";
import { ago, CoinCell, Empty, gradeTone, Kpis, Loading, money, Page, Panel, Problem, Scroll, td, tdR, th, thR } from "@/components/page";
import { post } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { pct, tone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { LiveMc } from "@/components/Live";

type J = any;
const read = async (mint: string, symbol: string) => { try { await post(`research/${mint}`); toast(`${symbol || "Coin"} queued first for an AI read`); } catch (e) { toast((e as Error).message); } };

function Grade({ r, mint, symbol }: { r: J; mint: string; symbol: string }) {
  if (!r || !r.grade) return r?.status === "queued" || r?.status === "running" ? <span className="text-muted">{r.status === "running" ? "reading…" : "queued"}</span>
    : <button onClick={() => read(mint, symbol)} className="flex items-center gap-1 text-ink-2 hover:text-ink [&_svg]:size-3.5"><Icon.ai />Read</button>;
  return <span className="flex items-baseline gap-1.5"><b className={cn("font-semibold", gradeTone(r.grade))}>{r.grade}</b><span className="num text-muted">{r.score}</span></span>;
}

function CoinTable({ rows, empty, bonded }: { rows: J[]; empty: string; bonded?: boolean }) {
  return (
    <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={th}>AI read</th><th className={thR}>MCap</th><th className={thR}>Vol 1h</th><th className={thR}>1h</th><th className={thR}>{bonded ? "Bonded" : "To bonding"}</th></tr></thead><tbody>
      {rows.length ? rows.map((t) => (
        <tr key={t.mint} className="hover:bg-paper-3/60"><td className={td}><CoinCell mint={t.mint} symbol={t.symbol} name={t.name} sub={t.research?.verdict} /></td>
          <td className={td}><Grade r={t.research} mint={t.mint} symbol={t.symbol} /></td><td className={cn(tdR, "font-semibold")}><LiveMc mint={t.mint} value={t.mcap} fmt={money} /></td><td className={tdR}>{money(t.vol_h1)}</td>
          <td className={cn(tdR, tone(t.chg_h1))}>{pct(t.chg_h1)}</td><td className={cn(tdR, "text-muted")}>{bonded ? ago(t.bonded_at) : t.progress != null ? `${Math.round(t.progress * 100)}%` : "—"}</td></tr>))
        : <tr><td colSpan={6}><Empty>{empty}</Empty></td></tr>}
    </tbody></table></Scroll>
  );
}

export function Research() {
  const { data: d, error } = usePoll<J>("research", 8000);
  if (!d) return <Page title="Research">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const p = d.providers, q = d.queue;
  return (
    <Page title="Research" sub="The AI reads every coin that gets traction: a fast first read, then a deep read for the best.">
      <Kpis items={[
        ["First reads", p.fast.actualName, p.fast.fallback ? `standing in for ${p.fast.configuredName}` : `${d.hour.fast} this hour`, p.fast.fallback ? "text-warn" : undefined],
        ["Deep reads", p.deep.actualName, `${d.hour.deep} this hour · limit ${d.perHour}`],
        ["Queue", q.size, q.size ? `oldest ${q.oldestMin}m · about ${q.etaMin}m to clear` : "nothing waiting"],
        ["Deep waiting", q.deepWaiting, `${q.expiredHour} expired this hour`],
        ["Read automatically", d.auto ? "On" : "Off", `score ${d.deepMin}+ earns a deep read`, d.auto ? "text-up" : "text-warn"],
      ]} />
      <Panel title="Best reads" aside="highest scores, newest first">
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={th}>Grade</th><th className={th}>Verdict</th><th className={thR}>Cap when read</th><th className={thR}>Now</th><th className={thR}>1h</th><th className={thR}>Read</th></tr></thead><tbody>
          {d.top.length ? d.top.map((t: J) => (
            <tr key={t.mint} className="hover:bg-paper-3/60"><td className={td}><CoinCell mint={t.mint} symbol={t.symbol} name={t.name} sub={t.tag} /></td>
              <td className={td}><span className="flex items-baseline gap-1.5"><b className={cn("font-semibold", gradeTone(t.grade))}>{t.grade}</b><span className="num text-muted">{t.score}</span><span className="text-sm text-muted">{t.tier}</span></span></td>
              <td className={cn(td, "max-w-[34rem] truncate text-ink-2")} title={t.verdict}>{t.verdict}</td><td className={tdR}>{money(t.mcap_at)}</td><td className={cn(tdR, "font-semibold")}><LiveMc mint={t.mint} value={t.mcap} fmt={money} /></td>
              <td className={cn(tdR, tone(t.chg_h1))}>{pct(t.chg_h1)}</td><td className={cn(tdR, "text-muted")}>{ago(t.t)}</td></tr>))
            : <tr><td colSpan={7}><Empty>No reads yet.</Empty></td></tr>}
        </tbody></table></Scroll>
      </Panel>
      <div className="grid items-start gap-3 grid-cols-[repeat(2,minmax(0,1fr))] max-xl:grid-cols-[minmax(0,1fr)]">
        <Panel title="Close to bonding" aside={`${d.near.length} coins`}><CoinTable rows={d.near} empty="Nothing close to bonding right now." /></Panel>
        <Panel title="Just bonded" aside={`${d.bonded.length} coins`}><CoinTable rows={d.bonded.slice(0, 20)} empty="Nothing bonded recently." bonded /></Panel>
      </div>
      <Panel title="Narratives the AI rates" aside="by its average grade">
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Theme</th><th className={thR}>Coins read</th><th className={thR}>Strong reads</th><th className={thR}>Average score</th><th className={th}>Best coin</th></tr></thead><tbody>
          {d.narratives.map((n: J) => (
            <tr key={n.theme} className="hover:bg-paper-3/60"><td className={cn(td, "font-semibold")}>{n.theme}</td><td className={tdR}>{n.coins.toLocaleString()}</td><td className={tdR}>{n.strong}</td><td className={tdR}>{n.avg}</td>
              <td className={td}>{n.best ? <a href={`#/coin/${n.best.mint}`} className="hover:text-ink"><b className="font-semibold">{n.best.symbol}</b> <span className={gradeTone(n.best.grade)}>{n.best.grade}</span></a> : "—"}</td></tr>))}
        </tbody></table></Scroll>
      </Panel>
    </Page>
  );
}
