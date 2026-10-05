// Top traders (#/traders): Fomo's leaderboard as Fomo shows it (24H, 7D, 30D, ALL), read once a day through
// the user's Aside browser (server/fomoboard.js), each day kept. Clans on top, the top three as cards, then
// every trader on the board; a row opens the trader's profile (#/trader/<handle>). The best traders' real
// wallets (found on chain, not Fomo's account id) are followed for wallet tracking.
import { useState } from "react";
import { ago, Problem } from "@/components/page";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Avatar, Check, Chip, count, exactUsd, Pile, RANGES, signedShort, tone, traderHref, usd, WalletChip, type Range } from "./traders/parts";

interface Hold { mint: string; chain: number; img: string | null; value: number | null; pnl: number | null }
interface Row {
  rank: number; uid: string | null; address: string; handle: string | null; name: string | null; pic: string | null; pnl: number | null; volume: number | null;
  trades: number | null; followers: number | null; holdings: number | null; top: Hold[]; clan: string | null; badge: string | null; verified: number | null;
  prevRank: number | null; days: number; wallet: string | null; walletVerified?: boolean; walletNote: string | null; tracked?: boolean;
}
interface Clan { rank: number; id: string; name: string; icon: string | null; pnl: number | null; members: number | null; top: { handle?: string; name?: string; pic?: string }[] }
interface Board {
  range: Range; day: string | null; days: string[]; prevDay: string | null; rows: Row[]; clans: Clan[];
  status: { running: boolean; error: string | null; signedOut: boolean; lastRun: { t: number; ok: number } | null; lastOk: number | null; aside: boolean;
    profiles: { queued: number; done: number }; wallets: { queued: number; done: number; current: string | null }; working: boolean };
  follow: { top24h: number; top7d: number; pauseDays: number; picked: number; resolved: number; following: number };
}
const label = (r: Range) => RANGES.find(([v]) => v === r)?.[1] ?? r;
const COLS = "grid-cols-[52px_minmax(220px,1.6fr)_minmax(150px,1fr)_110px_90px_90px_150px_110px] max-lg:grid-cols-[40px_minmax(0,1fr)_auto]";

export function Traders() {
  const [range, setRange] = useState<Range>("24h");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [allClans, setAllClans] = useState(false);
  const [q, setQ] = useState("");
  const { data: d, error, refresh } = usePoll<Board>(`fomo/board?${new URLSearchParams({ range, ...(day ? { day } : {}) })}`, 20_000);

  const readNow = async () => {
    setBusy(true);
    try {
      const r = await post<Board>(`fomo/board/refresh?range=${range}`);
      toast(r.status.error || "Fomo leaderboard read");
      setDay(""); refresh();
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };

  const s = d?.status, reading = busy || s?.running;
  const rows = (d?.rows || []).filter((r) => !q || `${r.name} ${r.handle} ${r.wallet || ""}`.toLowerCase().includes(q.toLowerCase()));
  const podium = !q ? rows.slice(0, 3) : [];
  const rest = !q ? rows.slice(3) : rows;
  const work = s?.working ? (s.wallets.queued ? `finding real wallets ${s.wallets.done}/${s.wallets.queued}${s.wallets.current ? ` (@${s.wallets.current})` : ""}` : s.profiles.queued ? `reading profiles ${s.profiles.done}/${s.profiles.queued}` : "working") : null;

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 max-md:p-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl leading-none font-bold tracking-tight"><Icon.crown className="size-6 text-warn" />Leaderboard</h1>
          <p className="mt-2 text-md text-muted">
            Fomo's top traders{d?.day ? <> · {d.day}</> : null} · read {ago(s?.lastOk)} through Aside
            {work && <span className="ml-2 text-ink-2"><span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-info align-middle" />{work}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {d && d.days.length > 1 && (
            <select value={day || d.day || ""} onChange={(e) => setDay(e.target.value === d.days[0] ? "" : e.target.value)} aria-label="Day"
              className="h-8 rounded-control border border-rule bg-paper px-2 text-md text-ink outline-none focus:border-accent-dim">
              {d.days.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          <button onClick={readNow} disabled={reading} className="flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper-3 px-3.5 text-md font-semibold text-ink hover:border-muted disabled:opacity-60">
            <Icon.refresh className={cn("size-3.5", reading && "animate-spin")} />{reading ? "Reading Fomo…" : "Read now"}
          </button>
        </div>
      </header>

      {error && <Problem text={error} />}
      {s?.signedOut && <p className="rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-md text-ink-2">Aside is signed out of Fomo, so the board could not be read. Sign in at fomo.family in Aside, then press Read now.</p>}
      {s && !s.signedOut && s.error && <Problem text={`reading Fomo: ${s.error}`} />}
      {!d ? <div className="h-96 animate-pulse rounded-card border border-rule bg-paper-2" /> : <>

        {d.clans.length > 0 && (
          <section className="rounded-card border border-rule bg-paper-2 p-3">
            <div className="mb-2.5 flex items-center justify-between px-1">
              <h2 className="flex items-center gap-2 text-lg font-semibold">Clans <Chip tone="info">{label(range)}</Chip></h2>
              {d.clans.length > 6 && <button onClick={() => setAllClans(!allClans)} className="text-sm font-medium text-ink-2 hover:text-ink">{allClans ? "Show fewer" : `View all ${d.clans.length}`} ›</button>}
            </div>
            <div className="grid grid-cols-3 gap-2 max-lg:grid-cols-2 max-sm:grid-cols-1">
              {(allClans ? d.clans : d.clans.slice(0, 6)).map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-control border border-rule bg-paper px-3 py-2.5 transition-colors hover:border-rule-2">
                  <span className="relative shrink-0">
                    {c.icon ? <img src={c.icon} alt="" loading="lazy" className="size-11 rounded-[10px] bg-paper-4 object-cover" /> : <span className="block size-11 rounded-[10px] bg-paper-4" />}
                    <span className="num absolute -right-1.5 -bottom-1.5 grid h-5 min-w-5 place-items-center rounded-full border border-paper-2 bg-paper-5 px-1 text-[10px] font-bold">{c.rank}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-md font-semibold text-ink">{c.name}</b>
                    <span className="num mt-0.5 flex items-center gap-1.5 text-sm text-muted"><Icon.users className="size-3.5" />{c.members ?? "—"}<b className={cn("font-semibold", tone(c.pnl))}>{signedShort(c.pnl)}</b></span>
                  </span>
                  <span className="flex -space-x-1.5" title={c.top.map((m) => (m.handle ? `@${m.handle}` : m.name)).join(", ")}>
                    {c.top.map((m, i) => m.pic ? <img key={i} src={m.pic} alt="" loading="lazy" className="size-5 rounded-full object-cover ring-2 ring-paper" /> : null)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented label="Leaderboard range" value={range} options={RANGES} onChange={setRange} />
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">{d.follow.resolved}/{d.follow.picked} top wallets found · {d.follow.following} followed</span>
            <label className="flex h-8 w-56 items-center gap-2 rounded-full border border-rule bg-paper px-3 focus-within:border-accent-dim max-sm:w-40">
              <Icon.search className="size-3.5 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search traders" className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
            </label>
          </div>
        </div>

        {!rows.length ? <p className="rounded-card border border-rule bg-paper-2 px-4 py-12 text-center text-md text-muted">{d.rows.length ? "No trader matches." : "Fomo's leaderboard has not been read yet. Press Read now (Aside must be signed in to Fomo)."}</p> : <>
          {podium.length > 0 && (
            <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
              {podium.map((r) => (
                <a key={r.rank} href={traderHref(r.handle)} className={cn("group relative overflow-hidden rounded-card border bg-paper-2 p-4 transition-colors hover:border-rule-2", r.rank === 1 ? "border-warn/40" : "border-rule")}>
                  <span aria-hidden className={cn("pointer-events-none absolute -top-16 -right-16 size-40 rounded-full blur-3xl", r.rank === 1 ? "bg-warn/15" : r.rank === 2 ? "bg-ink/10" : "bg-caution/10")} />
                  <div className="relative flex items-center gap-3">
                    <Avatar src={r.pic} size={52} />
                    <div className="min-w-0 flex-1">
                      <span className={cn("num text-xs font-bold tracking-wider", r.rank === 1 ? "text-warn" : "text-muted")}>#{r.rank}</span>
                      <b className="block truncate text-lg font-semibold text-ink group-hover:text-focus">{r.name || r.handle}</b>
                      <span className="block truncate text-sm text-muted">@{r.handle}{r.clan ? ` · ${r.clan}` : ""}</span>
                    </div>
                  </div>
                  <div className={cn("num relative mt-4 text-2xl font-bold tracking-tight", tone(r.pnl))}>{exactUsd(r.pnl)}</div>
                  <div className="relative mt-2 flex items-center justify-between">
                    <Pile items={r.top.map((h) => ({ ...h, title: `${usd(h.value)} held` }))} more={(r.holdings ?? 0) - r.top.length} />
                    <span className="num text-sm text-muted">{count(r.followers)} followers</span>
                  </div>
                </a>
              ))}
            </div>
          )}

          <section className="overflow-hidden rounded-card border border-rule bg-paper-2">
            <div className={cn("grid items-center gap-3 border-b border-rule px-4 py-2.5 text-sm font-medium text-muted max-lg:hidden", COLS)}>
              <span>#</span><span>Trader</span><span className="text-right">{label(range)} PnL</span><span className="text-right">Volume</span><span className="text-right">Trades</span><span className="text-right">Followers</span><span>Wallet</span><span className="text-right">Tracking</span>
            </div>
            {rest.map((r) => <TraderRow key={`${r.rank}-${r.handle}`} r={r} prevDay={d.prevDay} />)}
          </section>
          <p className="text-sm text-muted">
            Volume and trades are each trader's totals on Fomo. Blix follows the real wallets of the top {d.follow.top24h} by 24H PnL and top {d.follow.top7d} by 7D PnL. The address Fomo shows is its own account id, so each wallet is found on chain from the trader's swaps (<Check className="inline size-3 text-up" /> = matched by two or more swaps). A followed wallet is dropped after {d.follow.pauseDays} days off both lists.
          </p>
        </>}
      </>}
    </div>
  );
}

function TraderRow({ r, prevDay }: { r: Row; prevDay: string | null }) {
  const move = r.prevRank == null ? null : r.prevRank - r.rank;
  return (
    <a href={traderHref(r.handle)} className={cn("grid items-center gap-3 border-b border-rule px-4 py-2.5 transition-colors last:border-b-0 hover:bg-paper-3/60 max-lg:gap-2.5", COLS)}>
      <span className="flex flex-col">
        <span className="num text-md font-semibold text-ink-2">{r.rank}.</span>
        {prevDay && <span className={cn("num text-[10px] font-semibold", move == null ? "text-info" : move > 0 ? "text-up" : move < 0 ? "text-down" : "text-muted")}>{move == null ? "NEW" : move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : "–"}</span>}
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar src={r.pic} size={38} />
        <span className="min-w-0">
          <b className="flex items-center gap-1.5 truncate text-md font-semibold text-ink">{r.name || r.handle}{r.verified ? <Check className="size-3.5 text-info" /> : null}{r.badge && /Top/.test(r.badge) && <Chip tone="warn" className="h-4.5 px-1.5 text-[10px]">{r.badge}</Chip>}</b>
          <span className="block truncate text-sm text-muted">@{r.handle}{r.clan ? ` · ${r.clan}` : ""}</span>
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <b className={cn("num text-md font-semibold", tone(r.pnl))}>{exactUsd(r.pnl)}</b>
        <Pile items={r.top.map((h) => ({ ...h, title: `${usd(h.value)} held` }))} more={(r.holdings ?? 0) - r.top.length} size={18} />
      </span>
      <span className="num text-right text-md text-ink-2 max-lg:hidden">{usd(r.volume)}</span>
      <span className="num text-right text-md text-ink-2 max-lg:hidden">{count(r.trades)}</span>
      <span className="num text-right text-md text-ink-2 max-lg:hidden">{count(r.followers)}</span>
      <span className="max-lg:hidden"><WalletChip wallet={r.wallet} verified={r.walletVerified} note={r.walletNote} /></span>
      <span className="text-right max-lg:hidden">{r.wallet ? (r.tracked ? <Chip tone="up">Following</Chip> : <Chip>Not followed</Chip>) : <span className="text-sm text-muted">—</span>}</span>
    </a>
  );
}
