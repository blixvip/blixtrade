// Top traders (#/traders): one leaderboard made of two. Fomo's board (24H, 7D, 30D, ALL; read by the server,
// server/fomoboard.js, each day kept) and pump.fun's PnL board (day, week, month; live, server/pumpboard.js) are
// merged and ranked together by PnL for the period; each trader carries the logo of the board they come from, and
// every trader is shown as their wallet: no board names or logos, only traders whose real wallet is known, one row
// per wallet (a wallet on both boards keeps its best figure and its Fomo profile). The top three stand on a lit
// podium (traders/PodiumLights.tsx, motion in traders/board.css), the rest in one table. A wallet opens its
// trader's profile here: Fomo's (#/trader/<handle>), or the wallet's own page built from the chain (#/trader/<wallet>).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BrandLoader, Problem } from "@/components/page";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Avatar, copy, count, exactUsd, Pile, RANGES, short, signedShort, traderHref, usd, type Range } from "./traders/parts";
import { PodiumLights } from "./traders/PodiumLights";
import "./traders/board.css";

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
  href: `#/trader/${r.wallet}`, external: false,
});


type Filter = "all" | Source;

export function Traders() {
  const [range, setRangeState] = useState<Range>(() => store.get<Range>("traders:range", "24h"));
  const setRange = (r: Range) => { store.set("traders:range", r); setRangeState(r); };
  const filter = "all" as Filter;   // the board picker is off since 2026-10-10: both boards, shown as wallets
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
    // Wallets only, one row each: the better figure of the two boards, the Fomo profile when there is one.
    const byWallet = new Map<string, Trader>();
    for (const t of list) {
      if (!t.wallet) continue;
      const had = byWallet.get(t.wallet);
      if (!had) { byWallet.set(t.wallet, t); continue; }
      const fomoOne = had.source === "fomo" ? had : t.source === "fomo" ? t : null, best = (t.pnl ?? -Infinity) > (had.pnl ?? -Infinity) ? t : had;
      byWallet.set(t.wallet, fomoOne ? { ...fomoOne, pnl: best.pnl, holds: best.holds.length ? best.holds : fomoOne.holds, more: best.holds.length ? best.more : fomoOne.more } : best);
    }
    return [...byWallet.values()].sort((a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity));
  }, [fomo.data, pump.data, filter, pumpRange]);
  const ranked = useMemo(() => {
    const query = q.toLowerCase();
    return all.map((t, i) => ({ t, rank: i + 1 }))
      .filter(({ t }) => !query || `${t.name} ${t.sub} ${t.wallet || ""}`.toLowerCase().includes(query));
  }, [all, q]);
  const podium = q ? [] : ranked.slice(0, 3), rest = q ? ranked : ranked.slice(3);
  const best = Math.max(0, ...all.map((t) => t.pnl ?? 0));   // first place's profit, for each row's bar
  const loading = (filter !== "pump" && !fomo.data && !fomo.error) || (filter !== "fomo" && pumpRange && !pump.data && !pump.error);

  const fs = fomo.data?.status, reading = busy || fs?.running;
  const readNow = async () => {
    setBusy(true);
    try { const r = await post<FomoBoard>(`fomo/board/refresh?range=${range}`); toast(r.status.error || "Fomo leaderboard read"); fomo.refresh(); }
    catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const problems = [fomo.error, pump.error, pump.data?.error].filter(Boolean).length ? ["Some traders couldn't be read just now. Showing what came in."] : [];

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 p-4 max-md:p-3">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div>
            <h1 className="text-2xl leading-none font-bold tracking-tight text-ink">Leaderboard</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <Pills label="Period" value={range} onChange={setRange} options={RANGES.map(([v, l]) => [v, l] as [Range, ReactNode])} />
        </div>
        <label className="flex h-9 w-64 items-center gap-2 rounded-full border border-rule bg-paper-2 px-3.5 transition-colors focus-within:border-muted max-sm:w-full">
          <Icon.search className="size-4 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or wallet" className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
        </label>
      </div>

      {problems.map((p) => <Problem key={p} text={p} />)}

      {loading ? <div className="grid min-h-[55vh] place-items-center"><BrandLoader label="Loading top traders" /></div> : !ranked.length ? (
        <div className="grid place-items-center gap-2 rounded-card border border-rule bg-paper-2 px-4 py-16 text-center">
          <p className="text-md text-muted">{all.length ? "No wallet matches that search." : "No traders for this period yet."}</p>
        </div>
      ) : <>
        {podium.length > 0 && <Podium top={podium} />}
        {rest.length > 0 && (
          <section className="overflow-hidden rounded-[20px] border border-rule bg-paper-2/70 p-1.5 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.8)]">
            <div className={cn("grid items-center gap-4 px-4 pt-2.5 pb-2 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase max-lg:hidden", COLS)}>
              <span>Rank</span><span>Trader</span><span>Holding</span><span className="text-right">PnL · {RANGES.find(([v]) => v === range)?.[1]}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              {rest.map(({ t, rank }, i) => <TraderRow key={t.key} t={t} rank={rank} best={best} i={i} />)}
            </div>
          </section>
        )}
        <p className="text-center text-sm text-muted">Fomo's and pump.fun's top traders, ranked together by profit for the period.</p>
      </>}
    </div>
  );
}

const COLS = "grid-cols-[64px_minmax(240px,1.6fr)_minmax(150px,0.9fr)_minmax(200px,1fr)] max-lg:grid-cols-[44px_minmax(0,1fr)_auto]";

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

// The trader's picture.
function Face({ t, size }: { t: Trader; size: number }) {
  return <Avatar src={t.pic} name={t.name} size={size} />;
}

// The wallet, short, in the mono face; copied on a press (without opening the trader).
function WalletLine({ wallet, className }: { wallet: string | null; className?: string }) {
  if (!wallet) return null;
  return (
    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); copy(wallet); }} title={`${wallet}\nCopy`}
      className={cn("flex items-center gap-1 font-outlier text-sm text-muted transition-colors hover:text-ink", className)}>
      {short(wallet)}<Icon.copy className="size-3 opacity-60" />
    </button>
  );
}

function NameLine({ t, className }: { t: Trader; className?: string }) {
  return (
    <b className={cn("flex min-w-0 items-center gap-1.5 font-semibold text-ink", className)}>
      <span className="truncate">{t.name}</span>
      {t.verified && <VerifiedMark className="size-4 shrink-0" />}
    </b>
  );
}

// ---------- the podium ----------

// Each place's metal: ring light and dark, its glow, the pedestal's lit top, the numeral's fill, the pedestal's height.
const METAL: Record<number, { a: string; b: string; glow: string; top: string; num: string; h: string; face: number; faceSm: number }> = {
  1: { a: "#ffe9a8", b: "#b4832a", glow: "rgba(255, 196, 84, 0.5)", top: "rgba(255, 204, 110, 0.30)", num: "linear-gradient(180deg, #fff6d6, #d6a03c)", h: "h-40 max-sm:h-28", face: 96, faceSm: 64 },
  2: { a: "#f3f6fb", b: "#7d889a", glow: "rgba(200, 214, 240, 0.34)", top: "rgba(205, 216, 236, 0.20)", num: "linear-gradient(180deg, #ffffff, #98a3b6)", h: "h-28 max-sm:h-20", face: 78, faceSm: 52 },
  3: { a: "#ffc9a0", b: "#8c4c28", glow: "rgba(232, 140, 78, 0.34)", top: "rgba(234, 150, 96, 0.20)", num: "linear-gradient(180deg, #ffdcbd, #ad643a)", h: "h-20 max-sm:h-14", face: 78, faceSm: 52 },
};
// The pedestals rise left, middle, right; each trader drops onto theirs as it lands.
const RISE: Record<number, number> = { 2: 0, 1: 140, 3: 280 };

function useSmall() {
  const [small, setSmall] = useState(() => matchMedia("(max-width: 640px)").matches);
  useEffect(() => { const m = matchMedia("(max-width: 640px)"), on = () => setSmall(m.matches); m.addEventListener("change", on); return () => m.removeEventListener("change", on); }, []);
  return small;
}

// A figure that counts up to its value (and glides to each new one), eased out; at once for reduced motion.
function useCountUp(v: number | null, delay = 0) {
  const [shown, setShown] = useState<number>(0);
  const from = useRef(0), first = useRef(true);
  useEffect(() => {
    if (v == null) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { from.current = v; setShown(v); return; }
    const a = from.current, wait = first.current ? delay : 0, D = first.current ? 1600 : 700;
    first.current = false;
    let f = 0, t0 = 0;
    const step = (now: number) => {
      t0 ||= now + wait;
      const k = Math.max(0, Math.min(1, (now - t0) / D)), x = a + (v - a) * (1 - Math.pow(1 - k, 4));
      from.current = x; setShown(x);
      if (k < 1) f = requestAnimationFrame(step);
    };
    f = requestAnimationFrame(step);
    return () => cancelAnimationFrame(f);
  }, [v]);   // eslint-disable-line react-hooks/exhaustive-deps
  return v == null ? null : shown;
}

function Podium({ top }: { top: { t: Trader; rank: number }[] }) {
  return (
    <section className="relative -mx-4 -mt-2 overflow-hidden px-4 pt-12 max-md:-mx-3 max-md:px-3">
      <PodiumLights className="pointer-events-none absolute inset-0 size-full" />
      <div className="relative mx-auto grid max-w-[980px] grid-cols-3 items-end gap-5 max-sm:gap-2">
        {[1, 0, 2].map((i) => (top[i] ? <Step key={top[i].t.key} t={top[i].t} rank={top[i].rank} /> : <span key={i} />))}
      </div>
      {/* the stage's floor */}
      <div aria-hidden className="relative mx-auto h-px max-w-[1040px] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)]" />
    </section>
  );
}

function Step({ t, rank }: { t: Trader; rank: number }) {
  const m = METAL[rank] || METAL[3], small = useSmall(), first = rank === 1;
  const rise = RISE[rank] ?? 0, land = rise + 520;
  const pnl = useCountUp(t.pnl, land);
  const ring = { "--a": m.a, "--b": m.b, "--glow": m.glow } as CSSProperties;
  return (
    <a href={t.href} target={t.external ? "_blank" : undefined} rel={t.external ? "noreferrer" : undefined} className="group flex min-w-0 flex-col items-center text-center outline-none">
      <div className="lb-drop flex w-full min-w-0 flex-col items-center [text-shadow:0_1px_12px_rgba(0,0,0,0.85)]" style={{ animationDelay: `${land}ms` }}>
        <span className="lb-ring transition-transform duration-300 ease-out group-hover:-translate-y-1.5 group-focus-visible:-translate-y-1.5" style={ring}>
          <span className="block rounded-full bg-paper p-[3px]"><Face t={t} size={small ? m.faceSm : m.face} /></span>
        </span>
        <NameLine t={t} className={cn("mt-3.5 max-w-full justify-center", first ? "text-xl max-sm:text-md" : "text-lg max-sm:text-sm")} />
        <WalletLine wallet={t.wallet} className="mt-1 max-sm:text-xs" />
        <Shine value={t.pnl} className={cn("num mt-3 leading-none font-extrabold tracking-tight", first ? "text-[38px] max-sm:text-xl" : "text-[28px] max-sm:text-base")} delay={land / 1000 + 1.4}>
          {small ? signedShort(pnl) : exactUsd(pnl)}
        </Shine>
      </div>
      <div className={cn("lb-rise lb-sheen mt-5 w-full rounded-t-[18px] border-x border-t backdrop-blur-[2px] max-sm:mt-3", m.h)}
        style={{ animationDelay: `${rise}ms`, "--sheen-delay": `${1.2 + rise / 400}s`, borderColor: `${m.a}55`, background: `linear-gradient(180deg, ${m.top}, rgba(255,255,255,0.025) 65%, transparent)`, boxShadow: `inset 0 1px 0 ${m.a}88, 0 -18px 50px -24px ${m.glow}` } as CSSProperties}>
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] rounded-t-[18px]" style={{ background: `linear-gradient(90deg, transparent, ${m.a}, transparent)`, opacity: 0.9 }} />
        <span className="lb-shine relative block pt-4 text-6xl leading-none font-black tracking-tighter [text-shadow:none] max-sm:pt-2 max-sm:text-3xl"
          style={{ "--c": `color-mix(in oklch, ${m.a} 78%, ${m.b})`, "--c2": "#fff", "--shine-delay": `${2 + rise / 300}s`, filter: `drop-shadow(0 4px 18px ${m.glow})` } as CSSProperties}>{rank}</span>
      </div>
    </a>
  );
}

// A profit (or loss) in its colour with a glint of light crossing it now and then.
function Shine({ value, className, delay = 0, children }: { value: number | null; className?: string; delay?: number; children: ReactNode }) {
  const up = (value ?? 0) >= 0;
  return (
    <span className={cn("lb-shine [text-shadow:none]", className)}
      style={{ "--c": up ? "var(--color-up)" : "var(--color-down)", "--c2": up ? "color-mix(in oklch, var(--color-up) 55%, white)" : "color-mix(in oklch, var(--color-down) 60%, white)", "--shine-delay": `${delay}s`,
        filter: up ? "drop-shadow(0 0 14px color-mix(in oklch, var(--color-up) 35%, transparent))" : undefined } as CSSProperties}>{children}</span>
  );
}

// ---------- the table ----------

function TraderRow({ t, rank, best, i }: { t: Trader; rank: number; best: number; i: number }) {
  const share = best > 0 && (t.pnl ?? 0) > 0 ? Math.max(0.03, Math.min(1, (t.pnl ?? 0) / best)) : 0;
  return (
    <a href={t.href} target={t.external ? "_blank" : undefined} rel={t.external ? "noreferrer" : undefined}
      style={{ animationDelay: `${Math.min(i, 18) * 35 + 250}ms` }}
      className={cn("lb-up group grid [content-visibility:auto] [contain-intrinsic-size:auto_68px] items-center gap-4 rounded-[14px] px-4 py-3 transition-colors duration-150 hover:bg-white/[0.04] max-lg:gap-3 max-lg:px-3", COLS)}>
      <span className={cn("num grid h-8 min-w-8 place-items-center justify-self-start rounded-[10px] px-2 text-sm font-bold", rank <= 10 ? "bg-paper-4 text-ink" : "text-muted")}>{rank}</span>
      <span className="flex min-w-0 items-center gap-3">
        <span className="transition-transform duration-200 group-hover:scale-105"><Face t={t} size={42} /></span>
        <span className="min-w-0">
          <NameLine t={t} className="text-md" />
          <WalletLine wallet={t.wallet} />
        </span>
      </span>
      <span className="max-lg:hidden">{t.holds.length ? <Pile items={t.holds.map((h) => ({ ...h, title: h.symbol || (h.value != null ? `${usd(h.value)} held` : undefined) }))} more={t.more} size={22} /> : <span className="text-sm text-muted/60">—</span>}</span>
      <span className="flex min-w-0 flex-col items-end gap-1">
        <Shine value={t.pnl} className="num text-lg font-bold tracking-tight max-lg:text-md" delay={1 + (i % 12) * 0.35}><span className="max-lg:hidden">{exactUsd(t.pnl)}</span><span className="lg:hidden">{signedShort(t.pnl)}</span></Shine>
        {/* how close to first place */}
        <span aria-hidden className="h-[3px] w-28 overflow-hidden rounded-full bg-white/[0.05] max-lg:w-16">
          <span className="lb-grow block h-full rounded-full bg-[linear-gradient(90deg,color-mix(in_oklch,var(--color-up)_35%,transparent),var(--color-up))]" style={{ width: `${share * 100}%`, animationDelay: `${Math.min(i, 18) * 35 + 450}ms` }} />
        </span>
      </span>
    </a>
  );
}

// ---------- marks ----------


function VerifiedMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Verified">
      <path d="M12 1.8l2.4 1.9 3-.3 1 2.9 2.7 1.4-.6 3 1.6 2.6-2 2.3.2 3-2.9.9-1.3 2.7-3-.5L12 22.2l-2.4-1.9-3 .3-1-2.9-2.7-1.4.6-3L1.9 10.7l2-2.3-.2-3 2.9-.9 1.3-2.7 3 .5z" fill="oklch(66% 0.15 245)" />
      <path d="M7.8 12.2l2.8 2.8 5.6-6" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
