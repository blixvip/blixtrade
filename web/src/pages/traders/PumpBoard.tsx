// pump.fun's top traders (the Leaderboard page's pump.fun source): pump.fun's PnL leaderboard for the day,
// week or month, read live by the server (server/pumpboard.js) and polled here every few seconds. The top
// three as cards, then the rest; a row opens the trader on pump.fun. Each wallet is the trader's real one.
import { useState, type ReactNode } from "react";
import { ago, Problem } from "@/components/page";
import { Segmented } from "@/components/ui/segmented";
import { usePoll } from "@/lib/coin";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Avatar, Chip, exactUsd, Pile, pct, RANGES, signedShort, tone, WalletChip, type Range } from "./parts";

interface Row {
  rank: number; wallet: string; handle: string | null; name: string | null; pic: string | null; x: string | null; verified: boolean;
  pnl: number | null; pnlSol: number | null; pnlPct: number | null; realized: number | null; unrealized: number | null; spentSol: number | null;
  positions: number | null; top: { mint: string; chain: number; img: string | null; symbol: string | null }[]; prevRank?: number | null; tracked: boolean;
}
interface Board { range: Range; t: number | null; loading: boolean; error: string | null; rows: Row[] }
type PumpRange = Exclude<Range, "all-time">;
const PUMP_RANGES = RANGES.filter(([v]) => v !== "all-time") as [PumpRange, string][];
const label = (r: Range) => RANGES.find(([v]) => v === r)?.[1] ?? r;
const profile = (r: Row) => `https://pump.fun/profile/${encodeURIComponent(r.wallet)}`;
// Under a dollar to the cent (+$0.00, not +$0.0000), otherwise short (+$162.4K).
const money = (n: number | null) => (n != null && Math.abs(n) < 1 ? exactUsd(n) : signedShort(n));
const COLS = "grid-cols-[44px_minmax(200px,1.5fr)_minmax(130px,1fr)_90px_95px_95px_56px_130px_100px] max-lg:grid-cols-[40px_minmax(0,1fr)_auto]";

export function PumpBoard({ source, range: shared, onRange }: { source: ReactNode; range: Range; onRange: (r: Range) => void }) {
  // pump.fun has no all-time board: ALL on Fomo shows the day here.
  const range: PumpRange = shared === "all-time" ? "24h" : shared;
  const [q, setQ] = useState("");
  const { data: d, error } = usePoll<Board>(`pump/board?range=${range}`, 15_000);

  const rows = (d?.rows || []).filter((r) => !q || `${r.name} ${r.x || ""} ${r.wallet}`.toLowerCase().includes(q.toLowerCase()));
  const podium = !q ? rows.slice(0, 3) : [];
  const rest = !q ? rows.slice(3) : rows;

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 max-md:p-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl leading-none font-bold tracking-tight"><Icon.crown className="size-6 text-warn" />Leaderboard</h1>
          <p className="mt-2 flex items-center text-md text-muted">
            <span className={cn("mr-2 inline-block size-1.5 rounded-full bg-up", d?.loading && "animate-pulse")} />
            pump.fun's top traders by profit · live · read {ago(d?.t)}
          </p>
        </div>
        {source}
      </header>

      {error && <Problem text={error} />}
      {d?.error && <Problem text={`reading pump.fun: ${d.error}`} />}
      {!d ? <div className="h-96 animate-pulse rounded-card border border-rule bg-paper-2" /> : <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented label="Leaderboard range" value={range} options={PUMP_RANGES} onChange={onRange} />
          <label className="flex h-8 w-56 items-center gap-2 rounded-full border border-rule bg-paper px-3 focus-within:border-accent-dim max-sm:w-40">
            <Icon.search className="size-3.5 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search traders" className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
          </label>
        </div>

        {!rows.length ? <p className="rounded-card border border-rule bg-paper-2 px-4 py-12 text-center text-md text-muted">{d.rows.length ? "No trader matches." : "pump.fun sent no traders for this period."}</p> : <>
          {podium.length > 0 && (
            <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
              {podium.map((r) => (
                <a key={r.wallet} href={profile(r)} target="_blank" rel="noreferrer" className={cn("group relative overflow-hidden rounded-card border bg-paper-2 p-4 transition-colors hover:border-rule-2", r.rank === 1 ? "border-warn/40" : "border-rule")}>
                  <span aria-hidden className={cn("pointer-events-none absolute -top-16 -right-16 size-40 rounded-full blur-3xl", r.rank === 1 ? "bg-warn/15" : r.rank === 2 ? "bg-ink/10" : "bg-caution/10")} />
                  <div className="relative flex items-center gap-3">
                    <Avatar src={r.pic} size={52} />
                    <div className="min-w-0 flex-1">
                      <span className={cn("num text-xs font-bold tracking-wider", r.rank === 1 ? "text-warn" : "text-muted")}>#{r.rank}</span>
                      <b className="block truncate text-lg font-semibold text-ink group-hover:text-focus">{r.name || "anon"}</b>
                      <span className="block truncate text-sm text-muted">{r.x ? `@${r.x} on X` : "pump.fun"}</span>
                    </div>
                  </div>
                  <div className={cn("num relative mt-4 text-2xl font-bold tracking-tight", tone(r.pnl))}>{exactUsd(r.pnl)}</div>
                  <div className="relative mt-2 flex items-center justify-between">
                    <Pile items={r.top.map((h) => ({ ...h, title: h.symbol || undefined }))} more={(r.positions ?? 0) - r.top.length} />
                    <span className="num text-sm text-muted">{pct(r.pnlPct)}</span>
                  </div>
                </a>
              ))}
            </div>
          )}

          <section className="overflow-hidden rounded-card border border-rule bg-paper-2">
            <div className={cn("grid items-center gap-3 border-b border-rule px-4 py-2.5 text-sm font-medium text-muted max-lg:hidden", COLS)}>
              <span>#</span><span>Trader</span><span className="text-right">{label(range)} PnL</span><span className="text-right">PnL %</span><span className="text-right">Realized</span><span className="text-right">Unrealized</span><span className="text-right">Coins</span><span>Wallet</span><span className="text-right">Tracking</span>
            </div>
            {rest.map((r) => <PumpRow key={r.wallet} r={r} />)}
          </section>
          <p className="text-sm text-muted">
            Straight from pump.fun's leaderboard, refreshed every 15 seconds while this page is open. PnL is realized plus unrealized on coins bought in the period; the wallet is the trader's own, so it can be followed in Wallets.
          </p>
        </>}
      </>}
    </div>
  );
}

function PumpRow({ r }: { r: Row }) {
  const move = r.prevRank === undefined ? undefined : r.prevRank == null ? null : r.prevRank - r.rank;
  return (
    <a href={profile(r)} target="_blank" rel="noreferrer" className={cn("grid items-center gap-3 border-b border-rule px-4 py-2.5 transition-colors last:border-b-0 hover:bg-paper-3/60 max-lg:gap-2.5", COLS)}>
      <span className="flex flex-col">
        <span className="num text-md font-semibold text-ink-2">{r.rank}.</span>
        {move !== undefined && <span className={cn("num text-[10px] font-semibold", move == null ? "text-info" : move > 0 ? "text-up" : move < 0 ? "text-down" : "text-muted")}>{move == null ? "NEW" : move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : "–"}</span>}
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar src={r.pic} size={38} />
        <span className="min-w-0">
          <b className="flex items-center gap-1.5 truncate text-md font-semibold text-ink">{r.name || "anon"}{r.x && <Icon.x className="size-3 text-muted" />}</b>
          <span className="block truncate text-sm text-muted">{r.x ? `@${r.x}` : "pump.fun"}</span>
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <b className={cn("num text-md font-semibold", tone(r.pnl))}>{exactUsd(r.pnl)}</b>
        <Pile items={r.top.map((h) => ({ ...h, title: h.symbol || undefined }))} more={(r.positions ?? 0) - r.top.length} size={18} />
      </span>
      <span className={cn("num text-right text-md max-lg:hidden", tone(r.pnlPct))}>{pct(r.pnlPct)}</span>
      <span className={cn("num text-right text-md max-lg:hidden", tone(r.realized))}>{money(r.realized)}</span>
      <span className={cn("num text-right text-md max-lg:hidden", tone(r.unrealized))}>{money(r.unrealized)}</span>
      <span className="num text-right text-md text-ink-2 max-lg:hidden">{r.positions ?? "—"}</span>
      <span className="max-lg:hidden"><WalletChip wallet={r.wallet} verified /></span>
      <span className="text-right max-lg:hidden">{r.tracked ? <Chip tone="up">Following</Chip> : <Chip>Not followed</Chip>}</span>
    </a>
  );
}
