// Coins / Discover (#/coins): every coin the radar tracks, sortable and searchable.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ago, CoinCell, Empty, money, Page, Panel, Problem, Scroll, td, tdR, th, thR } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { pct, tone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

type J = any;
const PER = 50;
const COLS: [key: string, label: string][] = [["score", "Score"], ["safety_score", "Safety"], ["mcap", "MCap"], ["liquidity", "Liquidity"], ["vol_h1", "Vol 1h"], ["chg_m5", "5m"], ["chg_h1", "1h"], ["chg_h24", "24h"], ["first_seen", "Age"]];

export function Coins() {
  const [sort, setSort] = useState("score"), [dir, setDir] = useState<"desc" | "asc">("desc"), [page, setPage] = useState(0), [q, setQ] = useState("");
  const qs = new URLSearchParams({ sort, dir, limit: String(PER), offset: String(page * PER), ...(q.trim() ? { q: q.trim() } : {}) });
  const { data: d, error } = usePoll<J>(`tokens?${qs}`, 6000);
  // First click sorts high to low; clicking the same column again reverses it.
  const by = (k: string) => { if (sort === k) setDir(dir === "desc" ? "asc" : "desc"); else { setSort(k); setDir("desc"); } setPage(0); };
  const pages = d ? Math.max(1, Math.ceil(d.total / PER)) : 1;
  return (
    <Page title="Discover" sub={d ? `${d.total.toLocaleString()} coins tracked` : "Every coin the radar tracks."}
      right={<label className="flex h-9 w-72 items-center gap-2 rounded-full border border-rule-2 bg-paper px-3 text-muted focus-within:border-accent-dim">
        <Icon.search className="size-4" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Ticker, name or contract" aria-label="Search coins" className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" /></label>}>
      {error && !d && <Problem text={error} />}
      <Panel>
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th>
          {COLS.map(([k, label]) => <th key={k} className={thR} aria-sort={sort === k ? (dir === "desc" ? "descending" : "ascending") : undefined}>
            <button onClick={() => by(k)} className={cn("hover:text-ink", sort === k && "font-semibold text-ink")}>{label}{sort === k ? (dir === "desc" ? " ↓" : " ↑") : ""}</button></th>)}
          <th className={th}>Themes</th></tr></thead><tbody>
          {d?.rows.length ? d.rows.map((t: J) => (
            <tr key={t.mint} className="hover:bg-paper-3/60"><td className={td}><CoinCell mint={t.mint} symbol={t.symbol} name={t.name} /></td>
              <td className={cn(tdR, "font-semibold")}>{t.score ?? "—"}</td>
              <td className={cn(tdR, t.safety_score == null ? "text-muted" : t.safety_score >= 70 ? "text-up" : t.safety_score >= 40 ? "text-warn" : "text-down")}>{t.safety_score ?? "—"}</td>
              <td className={cn(tdR, "font-semibold")}>{money(t.mcap)}</td><td className={tdR}>{money(t.liquidity)}</td><td className={tdR}>{money(t.vol_h1)}</td>
              <td className={cn(tdR, tone(t.chg_m5))}>{pct(t.chg_m5)}</td><td className={cn(tdR, tone(t.chg_h1))}>{pct(t.chg_h1)}</td><td className={cn(tdR, tone(t.chg_h24))}>{pct(t.chg_h24)}</td>
              <td className={cn(tdR, "text-muted")}>{ago(t.pair_created || t.first_seen).replace(" ago", "")}</td>
              <td className={cn(td, "text-ink-2")}>{(t.themes || []).slice(0, 2).join(", ") || "—"}</td></tr>))
            : <tr><td colSpan={COLS.length + 2}><Empty>{d ? "No coin matches." : "Loading…"}</Empty></td></tr>}
        </tbody></table></Scroll>
        <footer className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2.5 text-md text-muted">
          <span className="num">Page {page + 1} of {pages}</span>
          <span className="flex gap-2"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</Button></span>
        </footer>
      </Panel>
    </Page>
  );
}
