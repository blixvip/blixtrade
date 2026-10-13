// Top devs (#/devs): the wallets that launched the coins that did best in the last day, week or month (server/devboard.js),
// ranked by what their coins earned in fees (pump.fun pays the creator from every trade: the dev of the day's biggest
// coin made the most), then by their best coin's peak. Each row: the dev (pump.fun name and picture when they have one,
// else the wallet), fees earned, their best coin with its peak and live market cap, launches and bonds in the window,
// bond rate, rugs (dev sold out of a coin that had reached $10K), and Track. A row opens to every coin they launched in
// the window with how each went; the wallet opens its own page (#/trader/<wallet>: holdings, trades, PnL). Read every
// 20 s while open, so the board moves as coins run.
import { useMemo, useState } from "react";
import { BrandLoader, CoinImg, Problem } from "@/components/page";
import { TrackWalletButton } from "@/components/TrackWalletButton";
import { Tip } from "@/components/ui/tooltip";
import { usdK, usePoll } from "@/lib/coin";
import { useLiveMc } from "@/lib/livepx";
import { ageStr, shortAddr } from "@/lib/format";
import { useNow } from "@/lib/route";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Avatar } from "./traders/parts";

type Range = "24h" | "7d" | "30d";
const RANGES: [Range, string][] = [["24h", "24H"], ["7d", "7D"], ["30d", "30D"]];
type DevCoin = { mint: string; symbol: string | null; name: string | null; image: string | null; created: number; bonded: boolean; bondedAt: number | null; peak: number | null; mcap: number | null; tracked: boolean; dead: boolean; quarantine: string | null; feesSol: number; feesUsd: number; devSold: "all" | "part" | null; devPct: number | null; vol24: number | null };
type Dev = { rank: number; wallet: string; launches: number; bonded: number; bondRate: number; rugs: number; dead: number; tracked: number; feesSol: number; feesUsd: number; best: DevCoin | null; latest: number; coins: DevCoin[]; serial: boolean; name: string | null; pic: string | null; bio: string | null; x: string | null; followers: number | null };
type Board = { range: Range; since: number; t: number; solUsd: number; devs: number; launches: number; top: Dev[] };

const sol = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(3));
const money = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(0)}`);
const th = "label whitespace-nowrap px-3 py-2 text-left text-muted";
const GRID = "grid grid-cols-[44px_minmax(220px,1.6fr)_120px_minmax(220px,1.5fr)_96px_90px_72px_112px] items-center gap-x-3";

// A coin's live market cap: the stream's figure when it has one, else the board's.
function LiveMc({ mint, mcap }: { mint: string; mcap: number | null }) {
  const live = useLiveMc(mint);
  const v = live ?? mcap;
  return <span className="num">{v != null ? usdK(v) : "—"}</span>;
}

function Outcome({ c }: { c: DevCoin }) {
  if (c.devSold === "all") return <Tip tip="The dev sold everything they held"><i className="rounded-chip bg-down/15 px-1.5 py-px text-[0.625rem] font-bold not-italic tracking-wide text-down">RUGGED</i></Tip>;
  if (c.bonded) return <Tip tip={`Bonded${c.bondedAt ? ` ${ageStr(Date.now() - c.bondedAt)} ago` : ""}: moved to its own pool`}><i className="rounded-chip bg-up/15 px-1.5 py-px text-[0.625rem] font-bold not-italic tracking-wide text-up">BONDED</i></Tip>;
  if (c.dead) return <i className="rounded-chip bg-paper-4 px-1.5 py-px text-[0.625rem] font-bold not-italic tracking-wide text-muted">DEAD</i>;
  if (!c.tracked) return <i className="rounded-chip bg-paper-4 px-1.5 py-px text-[0.625rem] font-bold not-italic tracking-wide text-muted">QUIET</i>;
  return <i className="rounded-chip bg-info/15 px-1.5 py-px text-[0.625rem] font-bold not-italic tracking-wide text-info">ON CURVE</i>;
}

function CoinLine({ c, now }: { c: DevCoin; now: number }) {
  return (
    <a href={`#/coin/${c.mint}`} className="grid grid-cols-[28px_minmax(140px,1fr)_90px_90px_90px_80px_72px] items-center gap-x-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-paper-3/60">
      <span className="relative size-7 overflow-hidden rounded-full bg-paper-4"><CoinImg mint={c.mint} fallback={c.image} preview={false} /></span>
      <span className="min-w-0 truncate"><b className="font-semibold text-ink">${c.symbol || shortAddr(c.mint)}</b>{c.name && <span className="ml-1.5 text-muted">{c.name}</span>}</span>
      <span className="num text-right text-ink-2" title="Peak market cap">{c.peak != null ? usdK(c.peak) : "—"}</span>
      <span className="text-right text-ink-2" title="Market cap now"><LiveMc mint={c.mint} mcap={c.mcap} /></span>
      <span className="num text-right text-ink-2" title="Fees the coin earned (estimate)">{c.feesSol ? `${sol(c.feesSol)} SOL` : "—"}</span>
      <span className="text-right"><Outcome c={c} /></span>
      <span className="num text-right text-xs text-muted">{ageStr(Math.max(0, now - c.created))}</span>
    </a>
  );
}

function Row({ d, open, onOpen }: { d: Dev; open: boolean; onOpen: () => void }) {
  const now = useNow();
  const name = d.name || shortAddr(d.wallet);
  const best = d.best;
  return (
    <div className={cn("border-t border-rule", open && "bg-paper-3/30")}>
      <div className={cn(GRID, "px-3 py-2.5")}>
        <span className={cn("num text-right text-md", d.rank <= 3 ? "font-bold text-ink" : "text-muted")}>{d.rank}</span>
        <span className="flex min-w-0 items-center gap-2.5">
          <a href={`#/trader/${d.wallet}`} className="shrink-0"><Avatar src={d.pic} name={name} size={32} /></a>
          <span className="min-w-0">
            <a href={`#/trader/${d.wallet}`} className="block truncate text-md font-semibold text-ink hover:text-accent">{name}</a>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <a href={`#/trader/${d.wallet}`} className="font-outlier hover:text-ink" title={`${d.wallet} · the wallet's page`}>{shortAddr(d.wallet)}</a>
              {d.x && <a href={`https://x.com/${d.x.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="hover:text-ink" title={`@${d.x.replace(/^@/, "")} on X`}><Icon.x className="size-3" /></a>}
              {d.serial && <Tip tip={`${d.launches} launches in the window: a serial deployer`}><i className="rounded-chip bg-warn/15 px-1 text-[0.6rem] font-bold not-italic text-warn">SERIAL</i></Tip>}
            </span>
          </span>
        </span>
        <Tip tip={`${sol(d.feesSol)} SOL in fees across their coins in the window (estimate from the trades read)`}>
          <span className="num text-right"><b className="block text-md font-bold text-up">{money(d.feesUsd)}</b><span className="text-xs text-muted">{sol(d.feesSol)} SOL</span></span>
        </Tip>
        {best ? (
          <a href={`#/coin/${best.mint}`} className="flex min-w-0 items-center gap-2.5 hover:[&_b]:text-accent">
            <span className="relative size-8 shrink-0 overflow-hidden rounded-full bg-paper-4"><CoinImg mint={best.mint} fallback={best.image} preview={false} /></span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5"><b className="truncate text-md font-semibold text-ink">${best.symbol || shortAddr(best.mint)}</b><Outcome c={best} /></span>
              <span className="num flex items-center gap-2 text-xs text-muted"><span>peak <b className="font-semibold text-ink-2">{best.peak != null ? usdK(best.peak) : "—"}</b></span><span>now <b className="font-semibold text-ink-2"><LiveMc mint={best.mint} mcap={best.mcap} /></b></span></span>
            </span>
          </a>
        ) : <span className="text-muted">—</span>}
        <span className="num text-right text-md text-ink-2" title="Coins launched · bonded, in the window">{d.launches} <span className="text-muted">/</span> <b className="font-semibold text-up">{d.bonded}</b></span>
        <span className="num text-right text-md text-ink-2" title="Share of their launches that bonded">{d.launches ? `${Math.round(d.bondRate * 100)}%` : "—"}</span>
        <span className={cn("num text-right text-md", d.rugs ? "font-semibold text-down" : "text-muted")} title="Coins the dev sold out of after they reached $10K">{d.rugs || "0"}</span>
        <span className="flex items-center justify-end gap-1.5">
          <TrackWalletButton address={d.wallet} name={name} pic={d.pic} />
          <button onClick={onOpen} aria-expanded={open} aria-label={open ? "Hide their coins" : "Show their coins"} className="grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-paper-4 hover:text-ink">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")}><path d="m6 9 6 6 6-6" /></svg>
          </button>
        </span>
      </div>
      {open && (
        <div className="border-t border-rule/60 px-3 py-2 pl-[60px]">
          <div className="grid grid-cols-[28px_minmax(140px,1fr)_90px_90px_90px_80px_72px] gap-x-3 px-2 pb-1 text-[10px] font-bold tracking-[0.08em] text-muted uppercase"><span /><span>Coin</span><span className="text-right">Peak</span><span className="text-right">Now</span><span className="text-right">Fees</span><span className="text-right">Outcome</span><span className="text-right">Age</span></div>
          {d.coins.map((c) => <CoinLine key={c.mint} c={c} now={now} />)}
          {d.launches > d.coins.length && <p className="px-2 pt-1 text-xs text-muted">{d.launches - d.coins.length} more launch{d.launches - d.coins.length === 1 ? "" : "es"} in the window not shown.</p>}
        </div>
      )}
    </div>
  );
}

export function Devs() {
  const [range, setRangeState] = useState<Range>(() => store.get<Range>("devs:range", "24h"));
  const setRange = (r: Range) => { store.set("devs:range", r); setRangeState(r); };
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [serial, setSerialState] = useState<boolean>(() => store.get<boolean>("devs:serial", false));
  const setSerial = (v: boolean) => { store.set("devs:serial", v); setSerialState(v); };
  const { data, error } = usePoll<Board>(`devs?range=${range}`, 20_000, true);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.top || []).filter((d) => (serial || !d.serial) && (!needle || `${d.name || ""} ${d.wallet} ${d.x || ""} ${d.coins.map((c) => `${c.symbol} ${c.name}`).join(" ")}`.toLowerCase().includes(needle)))
      .map((d, i) => ({ ...d, rank: i + 1 }));
  }, [data, q, serial]);
  const serialCount = (data?.top || []).filter((d) => d.serial).length;
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl leading-none font-bold tracking-tight text-ink">Top devs</h1>
        <span className="text-sm text-muted">The wallets behind the best coins{data ? ` · ${data.devs.toLocaleString()} devs, ${data.launches.toLocaleString()} launches in the window` : ""}</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex h-8 w-56 items-center rounded-full border border-rule-2 bg-paper px-3 focus-within:border-accent-dim">
            <Icon.search className="size-3.5 shrink-0 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dev, wallet or coin" className="w-full bg-transparent pl-2 text-sm text-ink outline-none placeholder:text-muted" />
          </label>
          <Tip tip={serial ? "Serial deployers (10+ launches a day) are on the board. Press to hide them" : `${serialCount} serial deployer${serialCount === 1 ? "" : "s"} (10+ launches a day) hidden. Press to show them`}>
            <button role="switch" aria-checked={serial} onClick={() => setSerial(!serial)} className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors", serial ? "border-warn/50 bg-warn/10 text-warn" : "border-rule-2 text-muted hover:text-ink")}>
              <span className={cn("size-1.5 rounded-full", serial ? "bg-warn" : "bg-rule-2")} />Serial{serialCount ? ` ${serialCount}` : ""}
            </button>
          </Tip>
          <div role="radiogroup" aria-label="Window" className="flex items-center gap-px rounded-full border border-rule bg-paper p-px">
            {RANGES.map(([r, l]) => <button key={r} role="radio" aria-checked={range === r} onClick={() => setRange(r)} className={cn("num h-7 rounded-full px-3 text-xs font-bold transition-colors", range === r ? "bg-paper-5 text-ink" : "text-muted hover:text-ink-2")}>{l}</button>)}
          </div>
        </div>
      </header>
      <div className="overflow-x-auto rounded-card border border-rule bg-paper-2">
        <div className="min-w-[1180px]">
          <div className={cn(GRID, "metal-bar px-3 py-2")}>
            <span className={cn(th, "text-right")}>#</span><span className={th}>Dev</span><span className={cn(th, "text-right")}>Fees earned</span><span className={th}>Best coin</span>
            <span className={cn(th, "text-right")}>Launched / bonded</span><span className={cn(th, "text-right")}>Bond rate</span><span className={cn(th, "text-right")}>Rugs</span><span className={cn(th, "text-right")}>Track</span>
          </div>
          {!data ? (error ? <Problem text={error} /> : <div className="p-6"><BrandLoader /></div>)
            : !rows.length ? <p className="p-6 text-sm text-muted">{q ? "No dev or coin matches." : "No dev with a coin that bonded or reached $20K in this window yet."}</p>
            : rows.map((d) => <Row key={d.wallet} d={d} open={open === d.wallet} onOpen={() => setOpen(open === d.wallet ? null : d.wallet)} />)}
        </div>
      </div>
      <p className="px-1 text-xs leading-relaxed text-muted">Ranked by the fees their coins earned in the window (pump.fun pays a coin's creator from every trade, so the dev of the biggest coin earned the most), then by their best coin's peak. Fees are estimated from the trades Blix read. Devs whose launches never bonded or passed $20K are left out, as are serial deployers with nothing to show. A wallet opens its page: what it holds, its trades and PnL.</p>
    </div>
  );
}
