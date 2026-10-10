// Top traders (#/traders): one leaderboard made of two. Fomo's board (24H, 7D, 30D, ALL; read by the server,
// server/fomoboard.js, each day kept) and pump.fun's PnL board (day, week, month; live, server/pumpboard.js) are
// merged and ranked together by PnL for the period; each trader carries the logo of the board they come from, and
// the source filter shows one board alone. The top three stand on a podium, the rest in one table. A Fomo trader
// opens their profile here (#/trader/<handle>); a pump.fun trader opens on pump.fun. Wallets are the traders' real
// ones (Fomo's found on chain), followed for wallet tracking.
import { useMemo, useState, type ReactNode } from "react";
import { ago, BrandLoader, Problem } from "@/components/page";
import { SiteLogo } from "@/components/logos";
import { PumpLogo } from "@/components/brand";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Avatar, Check, count, exactUsd, Pile, RANGES, signedShort, traderHref, usd, WalletChip, type Range } from "./traders/parts";

// ---------- the two boards as the server sends them ----------
interface Hold { mint: string; chain: number; img: string | null; value?: number | null; symbol?: string | null }
interface FomoRow {
  rank: number; handle: string | null; name: string | null; pic: string | null; pnl: number | null; volume: number | null; trades: number | null; followers: number | null;
  holdings: number | null; top: Hold[]; badge: string | null; verified: number | null; wallet: string | null; walletVerified?: boolean; walletNote: string | null; tracked?: boolean;
}
interface FomoBoard { rows: FomoRow[]; status: { running: boolean; error: string | null; signedOut: boolean; lastOk: number | null } }
interface PumpRow {
  rank: number; wallet: string; name: string | null; pic: string | null; x: string | null; verified: boolean; pnl: number | null; pnlPct: number | null;
  positions: number | null; top: Hold[]; tracked: boolean;
}
interface PumpBoardData { t: number | null; error: string | null; rows: PumpRow[] }

// ---------- one row of the merged board ----------
type Source = "fomo" | "pump";
interface Trader {
  key: string; source: Source; srcRank: number; name: string; sub: string; pic: string | null; verified: boolean; top100: boolean;
  pnl: number | null; stat: string; holds: Hold[]; more: number; wallet: string | null; walletVerified: boolean; walletNote: string | null; tracked: boolean;
  href?: string; external: boolean;
}
const fromFomo = (r: FomoRow): Trader => ({
  key: `fomo:${r.handle || r.rank}`, source: "fomo", srcRank: r.rank, name: r.name || r.handle || "anon", sub: r.handle ? `@${r.handle}` : "Fomo",
  pic: r.pic, verified: Boolean(r.verified), top100: Boolean(r.badge && /top/i.test(r.badge)), pnl: r.pnl,
  stat: [r.volume != null ? `${usd(r.volume)} vol` : null, r.trades != null ? `${count(r.trades)} trades` : null, r.followers != null ? `${count(r.followers)} followers` : null].filter(Boolean).join(" · "),
  holds: r.top, more: Math.max(0, (r.holdings ?? 0) - r.top.length), wallet: r.wallet, walletVerified: Boolean(r.walletVerified), walletNote: r.walletNote, tracked: Boolean(r.tracked),
  href: traderHref(r.handle), external: false,
});
const fromPump = (r: PumpRow): Trader => ({
  key: `pump:${r.wallet}`, source: "pump", srcRank: r.rank, name: r.name || "anon", sub: r.x ? `@${r.x}` : `${r.wallet.slice(0, 4)}…${r.wallet.slice(-4)}`,
  pic: r.pic, verified: r.verified, top100: false, pnl: r.pnl,
  stat: [r.pnlPct != null ? `${r.pnlPct >= 0 ? "+" : "−"}${Math.abs(r.pnlPct).toLocaleString("en-US", { maximumFractionDigits: 1 })}% return` : null, r.positions != null ? `${r.positions} coins` : null].filter(Boolean).join(" · "),
  holds: r.top, more: Math.max(0, (r.positions ?? 0) - r.top.length), wallet: r.wallet, walletVerified: true, walletNote: null, tracked: r.tracked,
  href: `https://pump.fun/profile/${encodeURIComponent(r.wallet)}`, external: true,
});

const SRC_NAME: Record<Source, string> = { fomo: "Fomo", pump: "pump.fun" };
const SrcLogo = ({ source, className }: { source: Source; className?: string }) =>
  source === "fomo" ? <SiteLogo site="fomo" className={cn("rounded-[4px]", className)} /> : <PumpLogo className={className} />;

type Filter = "all" | Source;
const FILTER_KEY = "traders:source";

export function Traders() {
  const [range, setRangeState] = useState<Range>(() => store.get<Range>("traders:range", "24h"));
  const setRange = (r: Range) => { store.set("traders:range", r); setRangeState(r); };
  const [filter, setFilterState] = useState<Filter>(() => { const v = store.get<string>(FILTER_KEY, "all"); return v === "fomo" || v === "pump" ? v : "all"; });
  const setFilter = (f: Filter) => { store.set(FILTER_KEY, f); setFilterState(f); };
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  // pump.fun has no all-time board: under ALL only Fomo's is shown.
  const pumpRange = range === "all-time" ? null : range;
  // Asked often: the server reads Fomo's board again every minute while it is asked for (fomoboard.js boardLive)
  // and pump.fun's every 5 s (pumpboard.js), so a change on either shows within seconds.
  const fomo = usePoll<FomoBoard>(filter !== "pump" ? `fomo/board?${new URLSearchParams({ range })}` : null, 10_000);
  const pump = usePoll<PumpBoardData>(filter !== "fomo" && pumpRange ? `pump/board?range=${pumpRange}` : null, 5_000);

  const all = useMemo(() => {
    const list = [...(filter !== "pump" ? (fomo.data?.rows || []).map(fromFomo) : []), ...(filter !== "fomo" && pumpRange ? (pump.data?.rows || []).map(fromPump) : [])];
    return list.sort((a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity));
  }, [fomo.data, pump.data, filter, pumpRange]);
  const ranked = useMemo(() => {
    const query = q.toLowerCase();
    return all.map((t, i) => ({ t, rank: i + 1 }))
      .filter(({ t }) => !query || `${t.name} ${t.sub} ${t.wallet || ""}`.toLowerCase().includes(query));
  }, [all, q]);
  const podium = q ? [] : ranked.slice(0, 3), rest = q ? ranked : ranked.slice(3);
  const loading = (filter !== "pump" && !fomo.data && !fomo.error) || (filter !== "fomo" && pumpRange && !pump.data && !pump.error);

  const fs = fomo.data?.status, reading = busy || fs?.running;
  const readNow = async () => {
    setBusy(true);
    try { const r = await post<FomoBoard>(`fomo/board/refresh?range=${range}`); toast(r.status.error || "Fomo leaderboard read"); fomo.refresh(); }
    catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const problems = [fomo.error && `Fomo: ${fomo.error}`, pump.error && `pump.fun: ${pump.error}`, pump.data?.error && `pump.fun: ${pump.data.error}`].filter(Boolean) as string[];

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-4 max-md:p-3">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-[14px] border border-warn/30 bg-[linear-gradient(160deg,color-mix(in_oklch,var(--color-warn)_22%,transparent),transparent)]"><CrownMark className="size-6" /></span>
          <div>
            <h1 className="text-2xl leading-none font-bold tracking-tight text-ink">Leaderboard</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-md text-muted">
              Top traders by profit on
              <span className="inline-flex items-center gap-1 font-medium text-ink-2"><SrcLogo source="fomo" className="size-4" />Fomo</span>
              and
              <span className="inline-flex items-center gap-1 font-medium text-ink-2"><SrcLogo source="pump" className="size-4" />pump.fun</span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Freshness fomoT={filter !== "pump" ? fs?.lastOk ?? null : null} pumpT={filter !== "fomo" && pumpRange ? pump.data?.t ?? null : null} />
          {filter !== "pump" && (
            <button onClick={readNow} disabled={reading} title="Read Fomo's board again now" aria-label="Read Fomo's board again"
              className="grid size-9 place-items-center rounded-full border border-rule-2 bg-paper-2 text-ink-2 transition-colors hover:border-muted hover:text-ink disabled:opacity-60">
              <Icon.refresh className={cn("size-4", reading && "animate-spin")} />
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pills label="Source" value={filter} onChange={setFilter} options={[
            ["all", <><span className="flex -space-x-1"><SrcLogo source="fomo" className="size-4 ring-2 ring-paper-4" /><SrcLogo source="pump" className="size-4" /></span>All</>],
            ["fomo", <><SrcLogo source="fomo" className="size-4" />Fomo</>],
            ["pump", <><SrcLogo source="pump" className="size-4" />pump.fun</>],
          ]} />
          <Pills label="Period" value={range} onChange={setRange} options={RANGES.map(([v, l]) => [v, l] as [Range, ReactNode])} />
        </div>
        <label className="flex h-9 w-64 items-center gap-2 rounded-full border border-rule bg-paper-2 px-3.5 transition-colors focus-within:border-muted max-sm:w-full">
          <Icon.search className="size-4 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search traders or wallets" className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
        </label>
      </div>

      {range === "all-time" && filter !== "fomo" && <p className="-mt-2 text-sm text-muted">pump.fun has no all-time board, so ALL shows Fomo's traders only.</p>}
      {problems.map((p) => <Problem key={p} text={p} />)}

      {loading ? <div className="grid min-h-[55vh] place-items-center"><BrandLoader label="Loading top traders" /></div> : !ranked.length ? (
        <div className="grid place-items-center gap-2 rounded-card border border-rule bg-paper-2 px-4 py-16 text-center">
          <CrownMark className="size-8 opacity-40" />
          <p className="text-md text-muted">{all.length ? "No trader matches that search." : "No traders for this period yet."}</p>
        </div>
      ) : <>
        {podium.length > 0 && (
          <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-1">
            {podium.map(({ t, rank }) => <PodiumCard key={t.key} t={t} rank={rank} />)}
          </div>
        )}
        {rest.length > 0 && (
          <section className="overflow-hidden rounded-card border border-rule bg-paper-2">
            <div className={cn("grid items-center gap-4 border-b border-rule px-5 py-3 text-xs font-semibold tracking-wider text-muted uppercase max-lg:hidden", COLS)}>
              <span>Rank</span><span>Trader</span><span className="text-right">PnL · {RANGES.find(([v]) => v === range)?.[1]}</span><span>Holding</span><span>Wallet</span><span className="text-right">Tracking</span>
            </div>
            {rest.map(({ t, rank }) => <TraderRow key={t.key} t={t} rank={rank} />)}
          </section>
        )}
        <p className="text-sm leading-relaxed text-muted">
          Both boards ranked together by profit for the period. Fomo's wallets are found on chain from each trader's swaps (<Check className="inline size-3 text-up" /> = matched by two or more); pump.fun's are the traders' own. Following a wallet puts it in Wallets.
        </p>
      </>}
    </div>
  );
}

const COLS = "grid-cols-[64px_minmax(240px,1.6fr)_minmax(170px,1fr)_minmax(120px,0.8fr)_150px_104px] max-lg:grid-cols-[44px_minmax(0,1fr)_auto]";

// ---------- pieces ----------

function Pills<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, ReactNode][] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5 rounded-full border border-rule bg-paper-2 p-0.5">
      {options.map(([v, node]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn("flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold whitespace-nowrap outline-none transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ink/25",
            value === v ? "bg-paper-4 text-ink shadow-[inset_0_0_0_1px_var(--color-rule-2)]" : "text-muted hover:text-ink-2")}>{node}</button>
      ))}
    </div>
  );
}

// When each board was last read, as a quiet pill.
function Freshness({ fomoT, pumpT }: { fomoT: number | null; pumpT: number | null }) {
  const parts: [Source, number][] = ([["fomo", fomoT], ["pump", pumpT]] as [Source, number | null][]).filter((p): p is [Source, number] => p[1] != null);
  if (!parts.length) return null;
  return (
    <span className="flex h-9 items-center gap-3 rounded-full border border-rule bg-paper-2 px-3.5 text-sm text-muted">
      {parts.map(([s, t]) => <span key={s} className="flex items-center gap-1.5" title={`${SRC_NAME[s]} read ${ago(t)}`}><SrcLogo source={s} className="size-3.5" /><span className="num">{ago(t)}</span></span>)}
    </span>
  );
}

// The trader's picture with their board's logo on its corner.
function Face({ t, size }: { t: Trader; size: number }) {
  const badge = Math.round(size * 0.4);
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <Avatar src={t.pic} name={t.name} size={size} />
      <span title={SRC_NAME[t.source]} className="absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-paper-2 p-[2px]" style={{ width: badge + 4, height: badge + 4 }}>
        <SrcLogo source={t.source} className="size-full" />
      </span>
    </span>
  );
}

function NameLine({ t, className }: { t: Trader; className?: string }) {
  return (
    <b className={cn("flex min-w-0 items-center gap-1.5 font-semibold text-ink", className)}>
      <span className="truncate">{t.name}</span>
      {t.verified && <VerifiedMark className="size-4 shrink-0" />}
      {t.top100 && <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-warn/35 bg-warn/10 px-1.5 text-[10px] font-bold tracking-wide text-warn uppercase">Top 100</span>}
    </b>
  );
}

const MEDAL: Record<number, { ring: string; glow: string; text: string; from: string; to: string }> = {
  1: { ring: "border-warn/45", glow: "bg-warn/18", text: "text-warn", from: "oklch(88% 0.15 90)", to: "oklch(68% 0.14 70)" },
  2: { ring: "border-ink/20", glow: "bg-ink/10", text: "text-ink-2", from: "oklch(92% 0.01 250)", to: "oklch(66% 0.02 250)" },
  3: { ring: "border-[oklch(62%_0.11_50)]/40", glow: "bg-[oklch(62%_0.11_50)]/14", text: "text-[oklch(72%_0.11_55)]", from: "oklch(78% 0.11 55)", to: "oklch(55% 0.1 40)" },
};

function PodiumCard({ t, rank }: { t: Trader; rank: number }) {
  const m = MEDAL[rank] || MEDAL[3];
  return (
    <a href={t.href} target={t.external ? "_blank" : undefined} rel={t.external ? "noreferrer" : undefined}
      className={cn("group relative flex flex-col gap-4 overflow-hidden rounded-card border bg-paper-2 p-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5", m.ring)}>
      <span aria-hidden className={cn("pointer-events-none absolute -top-20 -right-16 size-48 rounded-full blur-3xl", m.glow)} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <Face t={t} size={56} />
          <div className="min-w-0">
            <NameLine t={t} className="text-lg" />
            <span className="mt-0.5 block truncate text-sm text-muted">{t.sub}</span>
          </div>
        </div>
        <Medal rank={rank} from={m.from} to={m.to} />
      </div>
      <div className="relative">
        <div className="text-xs font-semibold tracking-wider text-muted uppercase">Profit</div>
        <div className={cn("num mt-1 text-[28px] leading-none font-bold tracking-tight", (t.pnl ?? 0) >= 0 ? "text-up" : "text-down")}>{exactUsd(t.pnl)}</div>
      </div>
      <div className="relative flex items-center justify-between gap-3 border-t border-rule pt-3.5">
        {t.holds.length ? <Pile items={t.holds.map((h) => ({ ...h, title: h.symbol || (h.value != null ? `${usd(h.value)} held` : undefined) }))} more={t.more} /> : <span />}
        <span className="num truncate text-sm text-muted">{t.stat}</span>
      </div>
    </a>
  );
}

function TraderRow({ t, rank }: { t: Trader; rank: number }) {
  return (
    <a href={t.href} target={t.external ? "_blank" : undefined} rel={t.external ? "noreferrer" : undefined}
      className={cn("group grid [content-visibility:auto] [contain-intrinsic-size:auto_65px] items-center gap-4 border-b border-rule px-5 py-3 transition-colors duration-100 last:border-b-0 hover:bg-paper-3/50 max-lg:gap-3 max-lg:px-3.5", COLS)}>
      <span className="num text-md font-semibold text-muted">{rank}</span>
      <span className="flex min-w-0 items-center gap-3">
        <Face t={t} size={40} />
        <span className="min-w-0">
          <NameLine t={t} className="text-md" />
          <span className="block truncate text-sm text-muted">{t.sub}</span>
        </span>
      </span>
      <span className="flex flex-col items-end gap-0.5">
        <b className={cn("num text-md font-semibold", (t.pnl ?? 0) >= 0 ? "text-up" : "text-down")}>{exactUsd(t.pnl)}</b>
        <span className="num truncate text-xs text-muted max-lg:hidden">{t.stat}</span>
        <span className="num text-xs text-muted lg:hidden">{signedShort(t.pnl)}</span>
      </span>
      <span className="max-lg:hidden">{t.holds.length ? <Pile items={t.holds.map((h) => ({ ...h, title: h.symbol || (h.value != null ? `${usd(h.value)} held` : undefined) }))} more={t.more} size={20} /> : <span className="text-sm text-muted">—</span>}</span>
      <span className="max-lg:hidden"><WalletChip wallet={t.wallet} verified={t.walletVerified} note={t.walletNote} /></span>
      <span className="flex justify-end max-lg:hidden">{t.wallet ? <Tracking on={t.tracked} /> : <span className="text-sm text-muted">—</span>}</span>
    </a>
  );
}

function Tracking({ on }: { on: boolean }) {
  return on
    ? <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-up/35 bg-up/10 px-2.5 text-xs font-semibold text-up"><EyeDot className="size-3.5" />Following</span>
    : <span className="inline-flex h-7 items-center rounded-full border border-rule-2 px-2.5 text-xs font-semibold text-muted">Not followed</span>;
}

// ---------- marks ----------

function CrownMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs><linearGradient id="crown-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="oklch(90% 0.15 92)" /><stop offset="1" stopColor="oklch(70% 0.15 70)" /></linearGradient></defs>
      <path d="M3.2 8.2l4.6 3.6L12 5l4.2 6.8 4.6-3.6-1.7 9.3H4.9z" fill="url(#crown-g)" stroke="oklch(60% 0.13 65)" strokeWidth="0.8" strokeLinejoin="round" />
      <rect x="4.9" y="18.4" width="14.2" height="2.2" rx="1.1" fill="url(#crown-g)" />
      <circle cx="12" cy="4.4" r="1.3" fill="oklch(92% 0.13 95)" /><circle cx="3" cy="7.6" r="1.1" fill="oklch(92% 0.13 95)" /><circle cx="21" cy="7.6" r="1.1" fill="oklch(92% 0.13 95)" />
    </svg>
  );
}

// A medal with its ribbon and the rank on it.
function Medal({ rank, from, to }: { rank: number; from: string; to: string }) {
  const id = `medal-${rank}`;
  return (
    <svg viewBox="0 0 40 48" className="h-12 w-10 shrink-0 drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]" aria-label={`Rank ${rank}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={from} /><stop offset="1" stopColor={to} /></linearGradient>
      </defs>
      <path d="M11 0h7l4 14h-7z" fill="oklch(45% 0.12 260)" /><path d="M29 0h-7l-4 14h7z" fill="oklch(52% 0.14 25)" />
      <circle cx="20" cy="30" r="15" fill={`url(#${id})`} />
      <circle cx="20" cy="30" r="11.5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1" />
      <text x="20" y="35" textAnchor="middle" fontSize="14" fontWeight="800" fill="rgba(20,16,8,0.82)" fontFamily="inherit">{rank}</text>
    </svg>
  );
}

function VerifiedMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Verified">
      <path d="M12 1.8l2.4 1.9 3-.3 1 2.9 2.7 1.4-.6 3 1.6 2.6-2 2.3.2 3-2.9.9-1.3 2.7-3-.5L12 22.2l-2.4-1.9-3 .3-1-2.9-2.7-1.4.6-3L1.9 10.7l2-2.3-.2-3 2.9-.9 1.3-2.7 3 .5z" fill="oklch(66% 0.15 245)" />
      <path d="M7.8 12.2l2.8 2.8 5.6-6" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EyeDot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
