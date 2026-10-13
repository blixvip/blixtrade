import { TrackWalletButton } from "@/components/TrackWalletButton";
// A Fomo trader's profile (#/trader/<handle>), laid out like Fomo's: cover and avatar, name, badges, bio and
// stats; portfolio value with the PnL chart (24H / 7D / 30D / ALL); best trades; open positions; recent
// swaps; where they rank on today's boards. Data: /api/fomo/trader/<handle> (server/fomoboard.js reads the
// profile through Aside and keeps it six hours). The real Solana wallet is found on chain from their swaps;
// it can be followed for wallet tracking from here.
import { SiteLogo } from "@/components/logos";
import { AreaSeries, ColorType, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { ago, Problem } from "@/components/page";
import { FollowButton } from "@/components/follow";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { peekAnswer } from "@/lib/coin";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { amount, Avatar, Check, Chip, copy, count, exactUsd, hold, pct, QUOTES, RANGES, short, SOLANA, tone, TokenPic, usd, type Range } from "./traders/parts";
import { thumb } from "@/lib/thumb";
import { WalletTrader } from "./traders/WalletTrader";

interface Best { mint: string; chain: number; symbol: string | null; img: string | null; opened: string; closed: string | null; realized: number | null; unrealized?: number | null; cost: number | null; entry: number | null; exit: number | null; price: number | null; comment: string | null }
interface Pos { mint: string; chain: number; symbol: string | null; name: string | null; img: string | null; amount: number | null; price: number | null; mcap: number | null; change24: number | null; entry: number | null; cost: number | null; realized: number | null; since: string | null; launchpad: string | null }
interface Swap { t: string; in: string; inAmt: number; out: string; outAmt: number; usd: number | null; chain: number }
interface Profile {
  uid: string; handle: string; name: string | null; pic: string | null; cover: string | null; bio: string | null; address: string; evm: string | null; joined: string; verified: boolean;
  followers: number | null; following: number | null; trades: number | null; swaps: number | null; volume: number | null; avgHold: number | null;
  clan: { id: string; name: string; icon: string | null } | null; badge: { title: string; rank: number | null; pnl: number | null } | null;
  best: Best[]; positions: Pos[]; recent: Swap[]; chart: Record<Range, [number, number, number][]>;
  read: number | null; ranks: Record<Range, { rank: number; pnl: number } | null>; day: string | null; history: { day: string; range: Range; rank: number; pnl: number }[];
  wallet: string | null; walletVerified?: boolean; walletNote: string | null; tracked?: boolean; resolving: boolean; updating?: boolean;
}

const value = (p: Pos) => (p.amount != null && p.price != null ? p.amount * p.price : null);

// A wallet address opens the wallet's own page, built from the chain (traders/WalletTrader.tsx); a handle, Fomo's.
const isWallet = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export function Trader({ handle }: { handle: string }) {
  return isWallet(handle) ? <WalletTrader wallet={handle} /> : <FomoTrader handle={handle} />;
}

function FomoTrader({ handle }: { handle: string }) {
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<Range>("24h");
  const [dust, setDust] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = async (fresh = false) => {
    // Already in hand (the link was hovered, lib/traderlinks.ts prefetched it): shown now, the read below refreshes it.
    if (!fresh) { const k = peekAnswer<Profile>(`fomo/trader/${encodeURIComponent(handle)}`); if (k?.chart && typeof k.chart === "object") setP((cur) => cur ?? k); }
    setBusy(true);
    try { const d = await api<Profile>(`fomo/trader/${encodeURIComponent(handle)}${fresh ? "?fresh=1" : ""}`); if (!d?.chart || typeof d.chart !== "object") throw new Error("This trader came back unreadable. Try again."); setP(d); setErr(null); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  useEffect(() => { setP(null); setErr(null); load(); window.scrollTo(0, 0); }, [handle]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The server answers from its last read and reads Fomo again behind it when that is old: look back for the new one.
  useEffect(() => { if (!p?.updating) return; const t = setTimeout(() => load(), 6000); return () => clearTimeout(t); }, [p?.updating, p?.read]);   // eslint-disable-line react-hooks/exhaustive-deps
  // While the wallet is being found, look again every 20 s.
  useEffect(() => { if (!p?.resolving) return; const t = setInterval(() => load(), 20_000); return () => clearInterval(t); }, [p?.resolving]);   // eslint-disable-line react-hooks/exhaustive-deps

  const symbols = useMemo(() => {
    const m = new Map<string, { symbol: string | null; img: string | null }>();
    for (const x of [...(p?.positions || []), ...(p?.best || [])]) if (x.mint && !m.has(x.mint)) m.set(x.mint, { symbol: x.symbol, img: x.img });
    return m;
  }, [p]);

  if (err && !p) return <div className="p-4"><Problem text={err} /><a href="#/traders" className="mt-3 inline-block text-md text-ink-2 hover:text-ink">‹ Back to the leaderboard</a></div>;
  if (!p) return <div className="mx-auto w-full max-w-[1300px] p-4"><div className="h-56 animate-pulse rounded-card border border-rule bg-paper-2" /><p className="mt-3 text-sm text-muted">Reading @{handle} from Fomo through Aside…</p></div>;

  const pts = p.chart[range] || [];
  const last = pts[pts.length - 1], first = pts[0];
  const equity = last?.[2] ?? null;
  const change = last && first ? last[1] - first[1] : null;
  const open = p.positions.filter((x) => (value(x) ?? 0) >= (dust ? 0 : 1)).sort((a, b) => (value(b) ?? 0) - (value(a) ?? 0));
  const best = [...p.best].map((b) => ({ ...b, pnl: (b.realized ?? 0) + (b.unrealized ?? 0) })).sort((a, b) => b.pnl - a.pnl).slice(0, 5);



  const total = open.reduce((s, x) => s + (value(x) ?? 0), 0);
  const unreal = open.reduce((s, x) => { const v = value(x); return v != null && x.cost != null ? s + (v - x.cost) : s; }, 0);
  const ranked = RANGES.map(([r, l]) => [l, p.ranks[r]] as const).filter(([, x]) => x);
  const topRank = ranked.length ? ranked.reduce((a, b) => (b[1]!.rank < a[1]!.rank ? b : a)) : null;
  const recent = showAll ? p.recent.slice(0, 60) : p.recent.slice(0, 10);
  const card = "rounded-card border border-rule bg-paper-2";
  const iconBtn = "grid size-8 place-items-center rounded-full border border-rule-2 bg-paper-3 text-ink-2 transition-colors hover:border-muted hover:text-ink";

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-4 p-4 max-md:p-3">
      <a href="#/traders" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted hover:text-ink">‹ Leaderboard</a>

      {/* Who they are: cover, picture, name and the actions, then six figures, the wallet and the bio. */}
      <section className={cn(card, "overflow-hidden")}>
        <div className="relative h-32 bg-paper-4 max-sm:h-20">
          {p.cover ? <img src={thumb(p.cover, 1200, { fit: "inside" })} alt="" className="size-full object-cover" /> : <span className="block size-full bg-gradient-to-br from-paper-5 via-paper-3 to-paper-2" />}
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-paper-2 via-paper-2/30 to-transparent" />
        </div>
        <div className="relative -mt-10 flex flex-wrap items-end justify-between gap-4 px-5 pb-4">
          <div className="flex min-w-0 items-end gap-4">
            <span className="shrink-0 rounded-full ring-4 ring-paper-2"><Avatar src={p.pic} size={84} /></span>
            <div className="min-w-0 pb-1">
              <h1 className="flex flex-wrap items-center gap-2 text-2xl leading-tight font-bold tracking-tight">
                {p.name || p.handle}{p.verified && <Check className="size-5 text-info" />}
              </h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-md text-muted">
                @{p.handle}
                {p.badge && <Chip tone="warn"><Icon.crown className="size-3" />{p.badge.title}</Chip>}
                {p.clan && <Chip>{p.clan.icon && <img src={thumb(p.clan.icon, 14)} alt="" className="size-3.5 rounded-full" />}{p.clan.name}</Chip>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pb-1">
            {p.wallet && <a href={`https://solscan.io/account/${p.wallet}`} target="_blank" rel="noopener" title="Wallet on Solscan" className={iconBtn}><SiteLogo site="solscan" className="size-4" /></a>}
            <button onClick={() => load(true)} disabled={busy} title="Read the profile from Fomo again" className={cn(iconBtn, "disabled:opacity-60")}><Icon.refresh className={cn("size-3.5", busy && "animate-spin")} /></button>
            <span aria-hidden className="mx-1 h-5 w-px bg-rule-2" />
            <FollowButton kind="trader" target={p.handle} />
            <TrackWalletButton address={p.wallet} name={p.name || `@${p.handle}`} />
          </div>
        </div>
        <div className="grid grid-cols-6 border-t border-rule max-lg:grid-cols-3 max-sm:grid-cols-2">
          <Fig l="Followers" v={count(p.followers)} /><Fig l="Following" v={count(p.following)} /><Fig l="Trades" v={count(p.trades)} />
          <Fig l="Volume" v={usd(p.volume)} /><Fig l="Avg. hold" v={hold(p.avgHold)} /><Fig l="Joined" v={p.joined ? new Date(p.joined).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—"} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-rule px-5 py-3">
          {p.bio && <p className="min-w-0 flex-1 text-md whitespace-pre-line text-ink-2">{p.bio}</p>}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-sm text-muted">
            <Icon.wallets className="size-3.5" />Trading wallet
            {p.wallet ? (
              <button onClick={() => copy(p.wallet!)} title={p.walletNote || "Copy"} className="flex items-center gap-1 rounded-full bg-paper-3 px-2 py-0.5 font-outlier text-ink-2 hover:text-ink">
                {p.walletVerified && <Check className="size-3 text-up" />}{short(p.wallet)}<Icon.copy className="size-3" />
              </button>
            ) : <span className={cn("text-ink-2", p.resolving && "animate-pulse")}>{p.resolving ? "finding it on chain…" : p.walletNote || "not found yet"}</span>}
          </span>
        </div>
      </section>

      <div className="grid items-start gap-4 grid-cols-[minmax(0,1fr)_380px] max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Portfolio: the value and its change over the range, four quick facts, then the chart. */}
          <section className={cn(card, "p-5")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Portfolio value</span>
                <div className="num mt-1 text-3xl font-bold tracking-tight">{exactUsd(equity, false)}</div>
                <div className={cn("num mt-0.5 text-md font-semibold", tone(change))}>{exactUsd(change)} <span className="font-normal text-muted">{RANGES.find(([v]) => v === range)?.[1]}</span></div>
              </div>
              <Segmented label="Chart range" value={range} options={RANGES} onChange={setRange} />
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 max-sm:grid-cols-2">
              <Mini l="Open positions" v={String(open.length)} sub={total ? exactUsd(total, false) : "—"} />
              <Mini l="Unrealized PnL" v={exactUsd(unreal)} cls={tone(unreal)} sub="on open positions" />
              <Mini l="Best trade" v={best[0] ? exactUsd(best[0].pnl) : "—"} cls={best[0] ? tone(best[0].pnl) : undefined} sub={best[0] ? (best[0].symbol || short(best[0].mint)) : "none yet"} />
              <Mini l="Best rank" v={topRank ? `#${topRank[1]!.rank}` : "—"} sub={topRank ? `${topRank[0]} board` : "not on a board"} />
            </div>
            <PnlChart points={pts} range={range} />
          </section>

          {/* Positions, biggest first, each with its share of the portfolio. */}
          <section className={cn(card, "overflow-hidden")}>
            <header className="flex items-center justify-between px-5 py-3">
              <h2 className="text-lg font-semibold">Positions <span className="num ml-1 text-md font-normal text-muted">{open.length}</span></h2>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted hover:text-ink-2"><input type="checkbox" checked={dust} onChange={(e) => setDust(e.target.checked)} className="accent-[var(--color-ink)]" />Show dust</label>
            </header>
            <div className={cn(POS_GRID, "border-y border-rule bg-paper/40 px-5 py-2 text-xs font-semibold tracking-[0.04em] text-muted uppercase max-md:hidden")}>
              <span>Token</span><span className="text-right">Value</span><span className="text-right">PnL</span><span>Share</span><span className="text-right">Avg entry</span><span className="text-right">Held</span>
            </div>
            {open.length ? open.slice(0, 60).map((x) => {
              const v = value(x), pnl = v != null && x.cost != null ? v - x.cost : null, ret = pnl != null && x.cost ? (pnl / x.cost) * 100 : null, share = total && v ? v / total : 0;
              const tok = (
                <span className="flex min-w-0 items-center gap-3">
                  <span className="size-8 shrink-0"><TokenPic mint={x.mint} chain={x.chain} img={x.img} /></span>
                  <span className="min-w-0"><b className="block truncate font-semibold text-ink">{x.symbol || short(x.mint)}</b><span className="num block truncate text-xs text-muted">{amount(x.amount)}{x.mcap ? ` · ${usd(x.mcap)} MC` : ""}</span></span>
                </span>
              );
              return (
                <div key={x.mint} className={cn(POS_GRID, "items-center border-b border-rule/70 px-5 py-2.5 last:border-b-0 hover:bg-paper-3/50 max-md:grid-cols-[minmax(0,1fr)_auto]")}>
                  {x.chain === SOLANA ? <a href={`#/coin/${x.mint}`} className="min-w-0 hover:text-focus">{tok}</a> : <span className="min-w-0 opacity-90">{tok}</span>}
                  <span className="num text-right text-md font-semibold">{exactUsd(v, false)}</span>
                  <span className={cn("num text-right text-md leading-tight max-md:hidden", tone(pnl))}>{pnl == null ? <span className="text-muted">—</span> : <>{exactUsd(pnl)}<span className="block text-xs opacity-80">{pct(ret)}</span></>}</span>
                  <span className="flex items-center gap-2 max-md:hidden">
                    <i className="block h-1.5 flex-1 overflow-hidden rounded-full bg-paper-4"><i className="block h-full rounded-full bg-ink/70" style={{ width: `${Math.max(2, share * 100)}%` }} /></i>
                    <span className="num w-9 text-right text-xs text-muted">{Math.round(share * 100)}%</span>
                  </span>
                  <span className="num text-right text-sm text-ink-2 max-md:hidden">{x.entry != null ? `$${x.entry.toPrecision(3)}` : "—"}</span>
                  <span className="num text-right text-sm text-muted max-md:hidden">{x.since ? ago(Date.parse(x.since)).replace(" ago", "") : "—"}</span>
                </div>
              );
            }) : <p className="px-5 py-10 text-center text-md text-muted">No open positions{dust ? "" : " above $1"}.</p>}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          {/* Where they rank on Fomo's boards today. */}
          <section className={cn(card, "p-4")}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Leaderboard</h2>
              {p.day && <span className="text-xs text-muted">{p.day}</span>}
            </div>
            {ranked.length ? (
              <div className="grid grid-cols-4 gap-1.5">
                {RANGES.map(([r, l]) => {
                  const x = p.ranks[r];
                  return (
                    <div key={r} className={cn("flex flex-col items-center gap-0.5 rounded-control px-1 py-2", x ? "bg-paper-3" : "bg-paper/50")}>
                      <span className="text-2xs font-semibold tracking-wider text-muted uppercase">{l}</span>
                      <b className={cn("num text-md font-bold", x ? "text-ink" : "text-muted")}>{x ? `#${x.rank}` : "—"}</b>
                      {x && <span className={cn("num text-2xs", tone(x.pnl))}>{usd(x.pnl)}</span>}
                    </div>
                  );
                })}
              </div>
            ) : <p className="rounded-control bg-paper/50 px-3 py-3 text-sm text-muted">Not on any of today's boards (24H, 7D, 30D or All).</p>}
            {p.history.length > 4 && <p className="mt-2.5 text-xs text-muted">On the board {new Set(p.history.map((h) => h.day)).size} days since Blix started reading it.</p>}
          </section>

          {/* Their five biggest wins. */}
          <section className={cn(card, "overflow-hidden")}>
            <h2 className="px-4 pt-4 pb-2 text-lg font-semibold">Best trades</h2>
            {best.length ? best.map((b, i) => (
              <a key={b.mint + i} href={b.chain === SOLANA ? `#/coin/${b.mint}` : undefined} title={b.comment || undefined}
                className="flex items-center gap-3 border-t border-rule/70 px-4 py-2.5 transition-colors hover:bg-paper-3/50">
                <span className="num w-4 shrink-0 text-right text-xs text-muted">{i + 1}</span>
                <span className="size-8 shrink-0"><TokenPic mint={b.mint} chain={b.chain} img={b.img} /></span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-md font-semibold">{b.symbol || short(b.mint)}</b>
                  <span className="block truncate text-xs text-muted">{b.closed ? `closed ${ago(Date.parse(b.closed))}` : "still held"}{b.comment ? ` · “${b.comment}”` : ""}</span>
                </span>
                <span className="shrink-0 text-right leading-tight">
                  <b className={cn("num block text-md font-semibold", tone(b.pnl))}>{exactUsd(b.pnl)}</b>
                  <span className={cn("num text-xs opacity-80", tone(b.pnl))}>{b.cost ? pct((b.pnl / b.cost) * 100) : ""}</span>
                </span>
              </a>
            )) : <p className="px-4 pb-4 text-md text-muted">No trades shown yet.</p>}
          </section>

          {/* Their latest swaps. */}
          <section className={cn(card, "overflow-hidden")}>
            <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
              <h2 className="text-lg font-semibold">Recent trades</h2>
              <span className="text-xs text-muted">{p.recent.length} shown</span>
            </div>
            {recent.length ? recent.map((s, i) => {
              const buy = QUOTES.has(s.in), mint = buy ? s.out : s.in, amt = buy ? s.outAmt : s.inAmt, tk = symbols.get(mint);
              return (
                <a key={i} href={s.chain === SOLANA ? `#/coin/${mint}` : undefined} className="grid grid-cols-[44px_24px_minmax(0,1fr)_auto_36px] items-center gap-2.5 border-t border-rule/70 px-4 py-2 transition-colors hover:bg-paper-3/50">
                  <span className={cn("rounded px-1.5 py-0.5 text-center text-2xs font-bold tracking-wide", buy ? "bg-up/12 text-up" : "bg-down/12 text-down")}>{buy ? "BUY" : "SELL"}</span>
                  <span className="size-6"><TokenPic mint={mint} chain={s.chain} img={tk?.img} /></span>
                  <span className="min-w-0 truncate text-md"><b className="font-semibold">{tk?.symbol || short(mint)}</b> <span className="num text-xs text-muted">{amount(amt)}</span></span>
                  <span className="num text-right text-md font-semibold">{usd(s.usd)}</span>
                  <span className="num text-right text-xs text-muted">{ago(Date.parse(s.t)).replace(" ago", "")}</span>
                </a>
              );
            }) : <p className="px-4 pb-4 text-md text-muted">No recent trades.</p>}
            {p.recent.length > 10 && <button onClick={() => setShowAll(!showAll)} className="w-full border-t border-rule py-2.5 text-sm font-medium text-muted hover:bg-paper-3/50 hover:text-ink">{showAll ? "Show fewer" : `Show all ${Math.min(60, p.recent.length)}`}</button>}
          </section>
          <p className="px-1 text-xs leading-relaxed text-muted">Read from Fomo {ago(p.read)}. Fomo's own address for this account ({short(p.address)}) is not the wallet that trades; Blix finds the trading wallet on chain from these swaps.</p>
        </aside>
      </div>
    </div>
  );
}

const POS_GRID = "grid grid-cols-[minmax(160px,1.5fr)_110px_110px_minmax(90px,0.8fr)_90px_60px] gap-4";
// One of the six figures under the header.
const Fig = ({ l, v }: { l: string; v: string }) => (
  <div className="flex flex-col gap-0.5 border-r border-rule px-5 py-3 last:border-r-0 max-lg:[&:nth-child(3n)]:border-r-0 max-sm:[&:nth-child(2n)]:border-r-0">
    <span className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">{l}</span>
    <b className="num text-lg font-semibold text-ink">{v}</b>
  </div>
);
// A quick fact above the portfolio chart.
const Mini = ({ l, v, sub, cls }: { l: string; v: string; sub: string; cls?: string }) => (
  <div className="flex min-w-0 flex-col gap-0.5 rounded-control border border-rule bg-paper px-3 py-2.5">
    <span className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">{l}</span>
    <b className={cn("num truncate text-md font-semibold text-ink", cls)}>{v}</b>
    <span className="truncate text-xs text-muted">{sub}</span>
  </div>
);

// Equity over time (the area), coloured by whether PnL rose over the range.
function PnlChart({ points, range }: { points: [number, number, number][]; range: Range }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!box.current) return;
    const css = getComputedStyle(document.documentElement);
    const muted = css.getPropertyValue("--color-muted").trim() ? "rgb(140,147,161)" : "#8b93a1";
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: muted, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.05 } },
      timeScale: { borderVisible: false, timeVisible: range === "24h" || range === "7d", secondsVisible: false },
      crosshair: { mode: 0 }, handleScroll: false, handleScale: false,
      localization: { priceFormatter: (v: number) => usd(v) },
    });
    chart.current = c;
    return () => { c.remove(); chart.current = null; };
  }, [range]);
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const up = (points[points.length - 1]?.[1] ?? 0) >= (points[0]?.[1] ?? 0);
    const line = up ? "rgb(46,189,133)" : "rgb(246,70,93)";
    const s = c.addSeries(AreaSeries, { lineColor: line, topColor: up ? "rgba(46,189,133,0.28)" : "rgba(246,70,93,0.28)", bottomColor: "rgba(0,0,0,0)", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    const seen = new Set<number>();
    s.setData(points.filter(([t]) => !seen.has(t) && seen.add(t)).map(([t, , eq]) => ({ time: t as UTCTimestamp, value: eq })));
    c.timeScale().fitContent();
    return () => { try { c.removeSeries(s); } catch { /* chart already removed */ } };
  }, [points, range]);
  return points.length ? <div ref={box} className="mt-3 h-64 w-full max-sm:h-48" /> : <p className="mt-6 mb-4 text-center text-md text-muted">No history for this range.</p>;
}
