// A Fomo trader's profile (#/trader/<handle>), laid out like Fomo's: cover and avatar, name, badges, bio and
// stats; portfolio value with the PnL chart (24H / 7D / 30D / ALL); best trades; open positions; recent
// swaps; where they rank on today's boards. Data: /api/fomo/trader/<handle> (server/fomoboard.js reads the
// profile through Aside and keeps it six hours). The real Solana wallet is found on chain from their swaps;
// it can be followed for wallet tracking from here.
import { AreaSeries, ColorType, createChart, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { ago, Problem } from "@/components/page";
import { FollowButton } from "@/components/follow";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { api, post } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { amount, Avatar, Check, Chip, copy, count, exactUsd, hold, pct, QUOTES, RANGES, short, SOLANA, tone, TokenPic, usd, type Range } from "./traders/parts";

interface Best { mint: string; chain: number; symbol: string | null; img: string | null; opened: string; closed: string | null; realized: number | null; unrealized?: number | null; cost: number | null; entry: number | null; exit: number | null; price: number | null; comment: string | null }
interface Pos { mint: string; chain: number; symbol: string | null; name: string | null; img: string | null; amount: number | null; price: number | null; mcap: number | null; change24: number | null; entry: number | null; cost: number | null; realized: number | null; since: string | null; launchpad: string | null }
interface Swap { t: string; in: string; inAmt: number; out: string; outAmt: number; usd: number | null; chain: number }
interface Profile {
  uid: string; handle: string; name: string | null; pic: string | null; cover: string | null; bio: string | null; address: string; evm: string | null; joined: string; verified: boolean;
  followers: number | null; following: number | null; trades: number | null; swaps: number | null; volume: number | null; avgHold: number | null;
  clan: { id: string; name: string; icon: string | null } | null; badge: { title: string; rank: number | null; pnl: number | null } | null;
  best: Best[]; positions: Pos[]; recent: Swap[]; chart: Record<Range, [number, number, number][]>;
  read: number | null; ranks: Record<Range, { rank: number; pnl: number } | null>; day: string | null; history: { day: string; range: Range; rank: number; pnl: number }[];
  wallet: string | null; walletVerified?: boolean; walletNote: string | null; tracked?: boolean; resolving: boolean;
}

const value = (p: Pos) => (p.amount != null && p.price != null ? p.amount * p.price : null);

export function Trader({ handle }: { handle: string }) {
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<Range>("24h");
  const [dust, setDust] = useState(false);
  const [follow, setFollow] = useState<boolean | null>(null);

  const load = async (fresh = false) => {
    setBusy(true);
    try { const d = await api<Profile>(`fomo/trader/${encodeURIComponent(handle)}${fresh ? "?fresh=1" : ""}`); setP(d); setFollow(Boolean(d.tracked)); setErr(null); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  useEffect(() => { setP(null); setErr(null); load(); window.scrollTo(0, 0); }, [handle]);   // eslint-disable-line react-hooks/exhaustive-deps
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

  const toggleFollow = async () => {
    if (!p.wallet) return;
    const on = !follow;
    try {
      await post(`wallet/${p.wallet}`, on ? { follow: true, label: `@${p.handle}` } : { watching: false });
      setFollow(on); toast(on ? `Following @${p.handle}'s wallet` : `Stopped following @${p.handle}'s wallet`);
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-4 p-4 max-md:p-3">
      <a href="#/traders" className="text-sm font-medium text-muted hover:text-ink">‹ Leaderboard</a>

      {/* Header card */}
      <section className="overflow-hidden rounded-card border border-rule bg-paper-2">
        <div className="relative h-36 bg-paper-4 max-sm:h-24">
          {p.cover ? <img src={p.cover} alt="" className="size-full object-cover" /> : <span className="block size-full bg-gradient-to-br from-paper-5 via-paper-3 to-paper-2" />}
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-paper-2 via-transparent to-transparent" />
        </div>
        <div className="relative -mt-12 flex flex-wrap items-end justify-between gap-4 px-5 pb-5">
          <div className="flex min-w-0 items-end gap-4 max-sm:flex-col max-sm:items-start max-sm:gap-2">
            <span className="rounded-full ring-4 ring-paper-2"><Avatar src={p.pic} size={96} /></span>
            <div className="min-w-0 pb-1">
              <h1 className="flex flex-wrap items-center gap-2 text-2xl leading-tight font-bold tracking-tight">
                {p.name || p.handle}{p.verified && <Check className="size-5 text-info" />}
                {p.badge && <Chip tone="warn"><Icon.crown className="size-3" />{p.badge.title}</Chip>}
                {p.clan && <Chip>{p.clan.icon && <img src={p.clan.icon} alt="" className="size-3.5 rounded-full" />}{p.clan.name}</Chip>}
              </h1>
              <p className="mt-0.5 text-md text-muted">@{p.handle}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <a href={`https://fomo.family/profile/${encodeURIComponent(p.handle)}`} target="_blank" rel="noopener" className="flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper-3 px-3.5 text-md font-semibold text-ink hover:border-muted"><Icon.link className="size-3.5" />Fomo</a>
            {p.wallet && <a href={`https://solscan.io/account/${p.wallet}`} target="_blank" rel="noopener" className="flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper-3 px-3.5 text-md font-semibold text-ink hover:border-muted"><Icon.link className="size-3.5" />Solscan</a>}
            <button onClick={() => load(true)} disabled={busy} title="Read the profile from Fomo again" className="grid size-8 place-items-center rounded-full border border-rule-2 bg-paper-3 text-ink-2 hover:text-ink disabled:opacity-60"><Icon.refresh className={cn("size-3.5", busy && "animate-spin")} /></button>
            <FollowButton kind="trader" target={p.handle} />
            <button onClick={toggleFollow} disabled={!p.wallet} title={p.wallet ? undefined : "The wallet has not been found on chain yet"}
              className={cn("flex h-8 items-center rounded-full px-4 text-md font-semibold transition-colors disabled:opacity-50", follow ? "border border-up/50 bg-up/10 text-up hover:border-down/60 hover:bg-down/10 hover:text-down" : "bg-ink text-on-fill hover:bg-focus")}>
              {follow ? "Following wallet" : "Follow wallet"}
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-rule px-5 py-3 text-md">
          <Stat n={count(p.followers)} l="Followers" /><Stat n={count(p.following)} l="Following" /><Stat n={count(p.trades)} l="Trades" /><Stat n={usd(p.volume)} l="Volume" />
          <Stat n={hold(p.avgHold)} l="avg. hold" /><Stat n={p.joined ? new Date(p.joined).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—"} l="Joined" />
          <span className="ml-auto flex items-center gap-2 text-sm text-muted max-md:ml-0">
            Wallet
            {p.wallet ? (
              <button onClick={() => copy(p.wallet!)} title={p.walletNote || undefined} className="flex items-center gap-1 font-outlier text-ink-2 hover:text-ink">
                {p.walletVerified && <Check className="size-3 text-up" />}{short(p.wallet)}<Icon.copy className="size-3" />
              </button>
            ) : <span className={cn(p.resolving && "animate-pulse")}>{p.resolving ? "finding it on chain…" : p.walletNote || "not found yet"}</span>}
          </span>
        </div>
        {p.bio && <p className="border-t border-rule px-5 py-3 text-md whitespace-pre-line text-ink-2">{p.bio}</p>}
      </section>

      <div className="grid items-start gap-4 grid-cols-[minmax(0,1fr)_360px] max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Portfolio */}
          <section className="rounded-card border border-rule bg-paper-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className="text-sm text-muted">Portfolio value</span>
                <div className="num text-3xl font-bold tracking-tight">{exactUsd(equity, false)}</div>
                <div className={cn("num mt-0.5 text-md font-semibold", tone(change))}>{exactUsd(change)} <span className="font-normal text-muted">{RANGES.find(([v]) => v === range)?.[1]}</span></div>
              </div>
              <Segmented label="Chart range" value={range} options={RANGES} onChange={setRange} />
            </div>
            <PnlChart points={pts} range={range} />
          </section>

          {/* Positions */}
          <section className="overflow-hidden rounded-card border border-rule bg-paper-2">
            <header className="flex items-center justify-between border-b border-rule px-4 py-2.5">
              <h2 className="text-lg font-semibold">Positions <span className="num ml-1 text-md font-normal text-muted">{open.length}</span></h2>
              <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={dust} onChange={(e) => setDust(e.target.checked)} className="accent-[var(--color-ink)]" />Show dust</label>
            </header>
            <div className="grid grid-cols-[minmax(160px,1.4fr)_110px_120px_120px_100px_90px] gap-3 border-b border-rule px-4 py-2 text-sm text-muted max-md:hidden">
              <span>Token</span><span className="text-right">Amount</span><span className="text-right">Value</span><span className="text-right">PnL</span><span className="text-right">Avg entry</span><span className="text-right">Held</span>
            </div>
            {open.length ? open.slice(0, 60).map((x) => {
              const v = value(x), pnl = v != null && x.cost != null ? v - x.cost : null, ret = pnl != null && x.cost ? (pnl / x.cost) * 100 : null;
              const tok = (
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="size-8 shrink-0"><TokenPic mint={x.mint} chain={x.chain} img={x.img} /></span>
                  <span className="min-w-0"><b className="block truncate font-semibold text-ink">{x.symbol || short(x.mint)}</b><span className="block truncate text-sm text-muted">{x.mcap ? `${usd(x.mcap)} MC` : x.name}</span></span>
                </span>
              );
              return (
                <div key={x.mint} className="grid grid-cols-[minmax(160px,1.4fr)_110px_120px_120px_100px_90px] items-center gap-3 border-b border-rule px-4 py-2.5 last:border-b-0 hover:bg-paper-3/50 max-md:grid-cols-[minmax(0,1fr)_auto]">
                  {x.chain === SOLANA ? <a href={`#/coin/${x.mint}`} className="min-w-0 hover:text-focus">{tok}</a> : <span className="min-w-0 opacity-90">{tok}</span>}
                  <span className="num text-right text-md text-ink-2 max-md:hidden">{amount(x.amount)}</span>
                  <span className="num text-right text-md font-semibold">{exactUsd(v, false)}</span>
                  <span className={cn("num text-right text-md max-md:hidden", tone(pnl))}>{pnl == null ? "—" : <>{exactUsd(pnl)}<span className="block text-xs">{pct(ret)}</span></>}</span>
                  <span className="num text-right text-sm text-ink-2 max-md:hidden">{x.entry != null ? `$${x.entry.toPrecision(3)}` : "—"}</span>
                  <span className="num text-right text-sm text-muted max-md:hidden">{x.since ? ago(Date.parse(x.since)).replace(" ago", "") : "—"}</span>
                </div>
              );
            }) : <p className="px-4 py-8 text-center text-md text-muted">No open positions{dust ? "" : " above $1"}.</p>}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          {/* Ranks */}
          <section className="rounded-card border border-rule bg-paper-2 p-4">
            <h2 className="mb-3 text-lg font-semibold">Leaderboard{p.day ? <span className="ml-2 text-sm font-normal text-muted">{p.day}</span> : null}</h2>
            <div className="grid grid-cols-2 gap-2">
              {RANGES.map(([r, l]) => {
                const x = p.ranks[r];
                return (
                  <div key={r} className="rounded-control border border-rule bg-paper px-3 py-2">
                    <span className="text-xs font-semibold text-muted">{l}</span>
                    <div className="num text-lg font-bold">{x ? `#${x.rank}` : "—"}</div>
                    <div className={cn("num text-sm", x ? tone(x.pnl) : "text-muted")}>{x ? exactUsd(x.pnl) : "not on the board"}</div>
                  </div>
                );
              })}
            </div>
            {p.history.length > 4 && <p className="mt-2 text-sm text-muted">On the board {new Set(p.history.map((h) => h.day)).size} days since Blix started reading it.</p>}
          </section>

          {/* Best trades */}
          <section className="rounded-card border border-rule bg-paper-2 p-4">
            <h2 className="mb-3 text-lg font-semibold">Best trades</h2>
            {best.length ? <div className="flex flex-col gap-2">
              {best.map((b, i) => (
                <a key={b.mint + i} href={b.chain === SOLANA ? `#/coin/${b.mint}` : undefined} className="flex items-center gap-3 rounded-control border border-rule bg-paper px-3 py-2.5 hover:border-rule-2">
                  <span className="relative shrink-0">
                    <span className="block size-9"><TokenPic mint={b.mint} chain={b.chain} img={b.img} /></span>
                    <span className="num absolute -top-1 -left-1 grid h-4 min-w-4 place-items-center rounded-full bg-paper-5 px-1 text-[9px] font-bold">#{i + 1}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-semibold">{b.symbol || short(b.mint)}</b>
                    <span className="block truncate text-xs text-muted">{b.closed ? `closed ${ago(Date.parse(b.closed))}` : "still held"}{b.comment ? ` · “${b.comment}”` : ""}</span>
                  </span>
                  <span className="text-right">
                    <b className={cn("num block text-md font-semibold", tone(b.pnl))}>{exactUsd(b.pnl)}</b>
                    <span className={cn("num text-xs", tone(b.pnl))}>{b.cost ? pct((b.pnl / b.cost) * 100) : ""}</span>
                  </span>
                </a>
              ))}
            </div> : <p className="text-md text-muted">No trades shown yet.</p>}
          </section>

          {/* Recent swaps */}
          <section className="overflow-hidden rounded-card border border-rule bg-paper-2">
            <h2 className="border-b border-rule px-4 py-2.5 text-lg font-semibold">Recent trades</h2>
            {p.recent.length ? p.recent.slice(0, 20).map((s, i) => {
              const buy = QUOTES.has(s.in), mint = buy ? s.out : s.in, amt = buy ? s.outAmt : s.inAmt, tk = symbols.get(mint);
              return (
                <div key={i} className="flex items-center gap-3 border-b border-rule px-4 py-2 last:border-b-0">
                  <span className={cn("w-9 text-xs font-bold", buy ? "text-up" : "text-down")}>{buy ? "BUY" : "SELL"}</span>
                  <span className="size-6 shrink-0"><TokenPic mint={mint} chain={s.chain} img={tk?.img} /></span>
                  <a href={s.chain === SOLANA ? `#/coin/${mint}` : undefined} className="min-w-0 flex-1 truncate text-md hover:text-focus">{amount(amt)} <b className="font-semibold">{tk?.symbol || short(mint)}</b></a>
                  <span className="num text-md font-semibold">{usd(s.usd)}</span>
                  <span className="w-14 text-right text-xs text-muted">{ago(Date.parse(s.t)).replace(" ago", "")}</span>
                </div>
              );
            }) : <p className="px-4 py-6 text-center text-md text-muted">No recent trades.</p>}
          </section>
          <p className="text-xs text-muted">Read from Fomo {ago(p.read)}. Fomo's own address for this account ({short(p.address)}) is not the wallet that trades; Blix finds the trading wallet on chain from these swaps.</p>
        </aside>
      </div>
    </div>
  );
}

const Stat = ({ n, l }: { n: string; l: string }) => <span><b className="num font-semibold text-ink">{n}</b> <span className="text-muted">{l}</span></span>;

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
