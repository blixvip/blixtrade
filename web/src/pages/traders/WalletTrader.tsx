// A trader page for any Solana wallet (#/trader/<wallet>): pump.fun's leaderboard traders, Feed callers and anyone
// Blix has no Fomo profile for. Built by the server from the chain (server/walletpage.js): pump.fun's public
// profile when there is one, the wallet's SOL and every coin it holds (priced), the latest swaps read from its
// transactions, the best closed trades among them, and its rank on pump.fun's boards. Answered at once from the
// server's last build and polled, so it keeps up while open.
import { useEffect, useState } from "react";
import { SiteLogo } from "@/components/logos";
import { ago, Problem } from "@/components/page";
import { toast } from "@/components/ui/toast";
import { api, post } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { amount, Avatar, copy, count, exactUsd, pct, RANGES, short, SOLANA, tone, TokenPic, usd, type Range } from "./parts";

interface Position { mint: string; symbol: string | null; name: string | null; img: string | null; amount: number; price: number | null; value: number | null; mcap: number | null; change24: number | null; cost: number | null; entry: number | null; since: string | null }
interface Best { mint: string; symbol: string | null; img: string | null; pnl: number; cost: number; closed: string | null }
interface Swap { t: number; side: "buy" | "sell"; mint: string; tokens: number; usd: number | null; sol: number; sig: string; symbol: string | null; img: string | null }
interface Rank { rank: number; pnl: number | null; pct: number | null; realized: number | null; unrealized: number | null }
interface Page {
  wallet: string; name: string | null; pic: string | null; bio: string | null; x: string | null; followers: number | null; following: number | null; joined: string | null;
  solUsd: number; sol: number | null; value: number; tokensUsd: number; positions: Position[]; best: Best[]; recent: Swap[];
  readSince: number | null; volume: number; tradesRead: number; ranks: Partial<Record<Range, Rank | null>>; read: number; updating: boolean;
}

const card = "rounded-card border border-rule bg-paper-2";
const iconBtn = "grid size-8 place-items-center rounded-full border border-rule-2 bg-paper-3 text-ink-2 transition-colors hover:border-muted hover:text-ink";
const POS = "grid grid-cols-[minmax(160px,1.5fr)_120px_110px_minmax(90px,0.8fr)_80px_60px] gap-4";
// Two colours from the wallet itself, for its cover.
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360;

export function WalletTrader({ wallet }: { wallet: string }) {
  const { data: p, error, refresh } = usePoll<Page>(`wallet-page/${wallet}`, 15_000);
  const [busy, setBusy] = useState(false);
  const [dust, setDust] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [follow, setFollow] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, [wallet]);
  // While the server is reading the chain again, look back soon for the new answer.
  useEffect(() => { if (!p?.updating) return; const t = setTimeout(refresh, 4000); return () => clearTimeout(t); }, [p?.updating, p?.read]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !p) return <div className="p-4"><Problem text={error} /><a href="#/traders" className="mt-3 inline-block text-md text-ink-2 hover:text-ink">‹ Back to the leaderboard</a></div>;
  if (!p) return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-4 p-4">
      <div className="h-[220px] animate-pulse rounded-card border border-rule bg-paper-2" />
      <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-4 max-lg:grid-cols-1"><div className="h-96 animate-pulse rounded-card border border-rule bg-paper-2" /><div className="h-96 animate-pulse rounded-card border border-rule bg-paper-2" /></div>
      <p className="text-sm text-muted">Reading {short(wallet)} from the chain…</p>
    </div>
  );

  const again = async () => { setBusy(true); try { await api(`wallet-page/${wallet}?fresh=1`); setTimeout(refresh, 3500); } catch (e) { toast((e as Error).message); } setBusy(false); };
  const toggleFollow = async () => {
    const on = !follow, label = p.name || short(wallet);
    try { await post(`wallet/${wallet}`, on ? { follow: true, label } : { watching: false }); setFollow(on); toast(on ? `Following ${label}'s wallet` : `Stopped following ${label}'s wallet`); }
    catch (e) { toast((e as Error).message); }
  };

  const open = p.positions.filter((x) => (x.value ?? 0) >= (dust ? 0 : 1));
  const solValue = (p.sol ?? 0) * p.solUsd;
  const total = p.value;
  const unreal = open.reduce((s, x) => (x.value != null && x.cost != null ? s + (x.value - x.cost) : s), 0);
  const costed = open.some((x) => x.cost != null);
  const ranked = RANGES.filter(([r]) => p.ranks[r]).map(([r, l]) => [l, p.ranks[r]!] as const);
  const topRank = ranked.length ? ranked.reduce((a, b) => (b[1].rank < a[1].rank ? b : a)) : null;
  const best = p.best[0];
  const recent = showAll ? p.recent : p.recent.slice(0, 10);
  // The holdings mix: SOL and the five biggest coins, the rest together.
  const mix = [{ k: "SOL", v: solValue, img: null as string | null, mint: null as string | null }, ...open.slice(0, 5).map((x) => ({ k: x.symbol || short(x.mint), v: x.value ?? 0, img: x.img, mint: x.mint }))];
  const rest = Math.max(0, total - mix.reduce((s, m) => s + m.v, 0));
  if (rest > 0.5) mix.push({ k: "Other", v: rest, img: null, mint: null });
  const h = hue(wallet), title = p.name || short(wallet);

  return (
    <div className="mx-auto flex w-full max-w-[1300px] flex-col gap-4 p-4 max-md:p-3">
      <a href="#/traders" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-muted hover:text-ink">‹ Leaderboard</a>

      {/* Who: cover, picture, name, wallet and actions; then six figures and the bio. */}
      <section className={cn(card, "overflow-hidden")}>
        <div className="relative h-32 max-sm:h-20" style={{ background: `radial-gradient(120% 140% at 15% 0%, oklch(42% 0.09 ${h}) 0%, transparent 60%), radial-gradient(120% 140% at 90% 10%, oklch(36% 0.08 ${(h + 70) % 360}) 0%, transparent 55%), var(--color-paper-3)` }}>
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-paper-2 via-paper-2/30 to-transparent" />
        </div>
        <div className="relative -mt-10 flex flex-wrap items-end justify-between gap-4 px-5 pb-4">
          <div className="flex min-w-0 items-end gap-4">
            <span className="shrink-0 rounded-full ring-4 ring-paper-2"><Avatar src={p.pic} name={title} size={84} /></span>
            <div className="min-w-0 pb-1">
              <h1 className="truncate text-2xl leading-tight font-bold tracking-tight">{title}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-md text-muted">
                <button onClick={() => copy(wallet)} title={`${wallet}\nCopy`} className="flex items-center gap-1 rounded-full bg-paper-3 px-2 py-0.5 font-outlier text-sm text-ink-2 hover:text-ink">{short(wallet)}<Icon.copy className="size-3" /></button>
                {p.x && <a href={`https://x.com/${encodeURIComponent(p.x)}`} target="_blank" rel="noopener" className="flex items-center gap-1 text-sm hover:text-ink"><Icon.x className="size-3" />@{p.x}</a>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pb-1">
            <a href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noopener" title="Wallet on Solscan" className={iconBtn}><SiteLogo site="solscan" className="size-4" /></a>
            <button onClick={again} disabled={busy || p.updating} title="Read the wallet again now" className={cn(iconBtn, "disabled:opacity-60")}><Icon.refresh className={cn("size-3.5", (busy || p.updating) && "animate-spin")} /></button>
            <span aria-hidden className="mx-1 h-5 w-px bg-rule-2" />
            <button onClick={toggleFollow} title="Track every trade this wallet makes"
              className={cn("flex h-8 items-center rounded-full px-4 text-md font-semibold transition-colors", follow ? "border border-up/50 bg-up/10 text-up hover:border-down/60 hover:bg-down/10 hover:text-down" : "bg-ink text-on-fill hover:bg-focus")}>
              {follow ? "Following wallet" : "Follow wallet"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-6 border-t border-rule max-lg:grid-cols-3 max-sm:grid-cols-2">
          <Fig l="Followers" v={count(p.followers)} /><Fig l="Following" v={count(p.following)} /><Fig l="SOL" v={p.sol != null ? amount(+p.sol.toFixed(3)) : "—"} />
          <Fig l="Recent volume" v={usd(p.volume)} /><Fig l="Trades read" v={String(p.tradesRead)} />{p.joined ? <Fig l="Joined" v={new Date(p.joined).toLocaleDateString(undefined, { month: "short", year: "numeric" })} /> : <Fig l="Coins held" v={String(p.positions.filter((x) => (x.value ?? 0) >= 1).length)} />}
        </div>
        {p.bio && <p className="border-t border-rule px-5 py-3 text-md whitespace-pre-line text-ink-2">{p.bio}</p>}
      </section>

      <div className="grid items-start gap-4 grid-cols-[minmax(0,1fr)_380px] max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Portfolio: the value now, four quick facts, and what it is made of. */}
          <section className={cn(card, "p-5")}>
            <span className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Portfolio value</span>
            <div className="num mt-1 text-3xl font-bold tracking-tight">{exactUsd(total, false)}</div>
            <div className="mt-0.5 text-md text-muted"><span className="num font-semibold text-ink-2">{exactUsd(solValue, false)}</span> in SOL · <span className="num font-semibold text-ink-2">{exactUsd(p.tokensUsd, false)}</span> in coins</div>
            <div className="mt-4 grid grid-cols-4 gap-2 max-sm:grid-cols-2">
              <Mini l="Open positions" v={String(open.length)} sub={p.tokensUsd ? exactUsd(p.tokensUsd, false) : "—"} />
              <Mini l="Unrealized PnL" v={costed ? exactUsd(unreal) : "—"} cls={costed ? tone(unreal) : undefined} sub={costed ? "where the buys were read" : "buys older than the trades read"} />
              <Mini l="Best trade" v={best ? exactUsd(best.pnl) : "—"} cls={best ? tone(best.pnl) : undefined} sub={best ? (best.symbol || short(best.mint)) : "none in the trades read"} />
              <Mini l="Best rank" v={topRank ? `#${topRank[1].rank}` : "—"} sub={topRank ? `${topRank[0]} board` : "not on a board"} />
            </div>
            {total > 0 && (
              <div className="mt-5">
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-paper-4">
                  {mix.filter((m) => m.v > 0).map((m, i) => <span key={m.k + i} title={`${m.k} · ${exactUsd(m.v, false)}`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(m.v / total) * 100}%`, background: `oklch(${72 - i * 7}% ${i ? 0.11 : 0.13} ${i ? (h + i * 47) % 360 : 290})` }} />)}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                  {mix.filter((m) => m.v > 0).map((m, i) => (
                    <span key={m.k + i} className="flex items-center gap-1.5 text-ink-2">
                      <i className="size-2 rounded-full" style={{ background: `oklch(${72 - i * 7}% ${i ? 0.11 : 0.13} ${i ? (h + i * 47) % 360 : 290})` }} />
                      <b className="font-semibold">{m.k}</b><span className="num text-muted">{Math.round((m.v / total) * 100)}%</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Positions, biggest first. */}
          <section className={cn(card, "overflow-hidden")}>
            <header className="flex items-center justify-between px-5 py-3">
              <h2 className="text-lg font-semibold">Positions <span className="num ml-1 text-md font-normal text-muted">{open.length}</span></h2>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted hover:text-ink-2"><input type="checkbox" checked={dust} onChange={(e) => setDust(e.target.checked)} className="accent-[var(--color-ink)]" />Show dust</label>
            </header>
            <div className={cn(POS, "border-y border-rule bg-paper/40 px-5 py-2 text-xs font-semibold tracking-[0.04em] text-muted uppercase max-md:hidden")}>
              <span>Token</span><span className="text-right">Value</span><span className="text-right">PnL</span><span>Share</span><span className="text-right">24h</span><span className="text-right">Held</span>
            </div>
            {open.length ? open.slice(0, 80).map((x) => {
              const pnl = x.value != null && x.cost != null ? x.value - x.cost : null, ret = pnl != null && x.cost ? (pnl / x.cost) * 100 : null, share = p.tokensUsd && x.value ? x.value / p.tokensUsd : 0;
              return (
                <a key={x.mint} href={`#/coin/${x.mint}`} className={cn(POS, "items-center border-b border-rule/70 px-5 py-2.5 transition-colors last:border-b-0 hover:bg-paper-3/50 max-md:grid-cols-[minmax(0,1fr)_auto]")}>
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="size-8 shrink-0"><TokenPic mint={x.mint} chain={SOLANA} img={x.img} /></span>
                    <span className="min-w-0"><b className="block truncate font-semibold text-ink">{x.symbol || short(x.mint)}</b><span className="num block truncate text-xs text-muted">{amount(x.amount)}{x.mcap ? ` · ${usd(x.mcap)} MC` : ""}</span></span>
                  </span>
                  <span className="num text-right text-md font-semibold">{exactUsd(x.value, false)}</span>
                  <span className={cn("num text-right text-md leading-tight max-md:hidden", tone(pnl))}>{pnl == null ? <span className="text-muted">—</span> : <>{exactUsd(pnl)}<span className="block text-xs opacity-80">{pct(ret)}</span></>}</span>
                  <span className="flex items-center gap-2 max-md:hidden">
                    <i className="block h-1.5 flex-1 overflow-hidden rounded-full bg-paper-4"><i className="block h-full rounded-full bg-ink/70" style={{ width: `${Math.max(2, share * 100)}%` }} /></i>
                    <span className="num w-9 text-right text-xs text-muted">{Math.round(share * 100)}%</span>
                  </span>
                  <span className={cn("num text-right text-sm max-md:hidden", x.change24 == null ? "text-muted" : tone(x.change24))}>{x.change24 == null ? "—" : `${x.change24 >= 0 ? "+" : ""}${x.change24.toFixed(0)}%`}</span>
                  <span className="num text-right text-sm text-muted max-md:hidden">{x.since ? ago(Date.parse(x.since)).replace(" ago", "") : "—"}</span>
                </a>
              );
            }) : <p className="px-5 py-10 text-center text-md text-muted">No coins held{dust ? "" : " above $1"}.</p>}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          {/* Where it ranks on pump.fun's boards right now. */}
          <section className={cn(card, "p-4")}>
            <h2 className="mb-3 text-lg font-semibold">Leaderboard</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {RANGES.filter(([r]) => r !== "all-time").map(([r, l]) => {
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
          </section>

          {/* The best closed trades among those read. */}
          <section className={cn(card, "overflow-hidden")}>
            <h2 className="px-4 pt-4 pb-2 text-lg font-semibold">Best trades</h2>
            {p.best.length ? p.best.map((b, i) => (
              <a key={b.mint} href={`#/coin/${b.mint}`} className="flex items-center gap-3 border-t border-rule/70 px-4 py-2.5 transition-colors hover:bg-paper-3/50">
                <span className="num w-4 shrink-0 text-right text-xs text-muted">{i + 1}</span>
                <span className="size-8 shrink-0"><TokenPic mint={b.mint} chain={SOLANA} img={b.img} /></span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-md font-semibold">{b.symbol || short(b.mint)}</b>
                  <span className="block truncate text-xs text-muted">{b.closed ? `closed ${ago(Date.parse(b.closed))}` : "still held"}</span>
                </span>
                <span className="shrink-0 text-right leading-tight">
                  <b className={cn("num block text-md font-semibold", tone(b.pnl))}>{exactUsd(b.pnl)}</b>
                  <span className={cn("num text-xs opacity-80", tone(b.pnl))}>{b.cost ? pct((b.pnl / b.cost) * 100) : ""}</span>
                </span>
              </a>
            )) : <p className="px-4 pb-4 text-md text-muted">No closed trades in what was read.</p>}
          </section>

          {/* The latest swaps. */}
          <section className={cn(card, "overflow-hidden")}>
            <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
              <h2 className="text-lg font-semibold">Recent trades</h2>
              <span className="text-xs text-muted">{p.recent.length} shown</span>
            </div>
            {recent.length ? recent.map((s) => (
              <a key={s.sig + s.mint} href={`#/coin/${s.mint}`} className="grid grid-cols-[44px_24px_minmax(0,1fr)_auto_36px] items-center gap-2.5 border-t border-rule/70 px-4 py-2 transition-colors hover:bg-paper-3/50">
                <span className={cn("rounded px-1.5 py-0.5 text-center text-2xs font-bold tracking-wide", s.side === "buy" ? "bg-up/12 text-up" : "bg-down/12 text-down")}>{s.side === "buy" ? "BUY" : "SELL"}</span>
                <span className="size-6"><TokenPic mint={s.mint} chain={SOLANA} img={s.img} /></span>
                <span className="min-w-0 truncate text-md"><b className="font-semibold">{s.symbol || short(s.mint)}</b> <span className="num text-xs text-muted">{amount(s.tokens)}</span></span>
                <span className="num text-right text-md font-semibold">{usd(s.usd)}</span>
                <span className="num text-right text-xs text-muted">{ago(s.t).replace(" ago", "")}</span>
              </a>
            )) : <p className="px-4 pb-4 text-md text-muted">No swaps in its latest transactions.</p>}
            {p.recent.length > 10 && <button onClick={() => setShowAll(!showAll)} className="w-full border-t border-rule py-2.5 text-sm font-medium text-muted hover:bg-paper-3/50 hover:text-ink">{showAll ? "Show fewer" : `Show all ${p.recent.length}`}</button>}
          </section>
          <p className="px-1 text-xs leading-relaxed text-muted">Read from the chain {ago(p.read)}{p.updating ? ", reading again now" : ""}. Trades, costs and best trades come from the wallet's latest transactions{p.readSince ? ` (since ${ago(p.readSince)})` : ""}.</p>
        </aside>
      </div>
    </div>
  );
}

const Fig = ({ l, v }: { l: string; v: string }) => (
  <div className="flex flex-col gap-0.5 border-r border-rule px-5 py-3 last:border-r-0 max-lg:[&:nth-child(3n)]:border-r-0 max-sm:[&:nth-child(2n)]:border-r-0">
    <span className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">{l}</span>
    <b className="num text-lg font-semibold text-ink">{v}</b>
  </div>
);
const Mini = ({ l, v, sub, cls }: { l: string; v: string; sub: string; cls?: string }) => (
  <div className="flex min-w-0 flex-col gap-0.5 rounded-control border border-rule bg-paper px-3 py-2.5">
    <span className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">{l}</span>
    <b className={cn("num truncate text-md font-semibold text-ink", cls)}>{v}</b>
    <span className="truncate text-xs text-muted">{sub}</span>
  </div>
);
