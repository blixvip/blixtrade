// The coin page header: the picture inside its bonding ring with the contract under the name, the live
// figures (market cap first), and the switch for
// the floating instant trade panel (./QuickTrade.tsx).
import { XHover } from "@/components/XCard";
import { PadLogo, PADS, padOf } from "@/components/logos";
import { type ReactNode } from "react";
import { PumpLogo } from "@/components/brand";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { pctN, tokN, usdK, type CoinData, type TokenDetail } from "@/lib/coin";
import { ageStr, safeHref } from "@/lib/format";
import { useNow } from "@/lib/route";
import { useTradeMc } from "@/lib/pulse";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { CIcon, CoinPic, Price } from "./parts";
import { toggleQuick, useQuick } from "@/lib/quick";
import { Flash } from "@/components/Live";

const POOL: Record<string, [string, string]> = { pump: ["bg-up", "pump.fun"], bonk: ["bg-caution", "letsbonk.fun"], launchlab: ["bg-accent", "Raydium LaunchLab"], bags: ["bg-warn", "Bags"], moonshot: ["bg-ink-2", "Moonshot"] };
const SOCIAL: Record<string, keyof typeof Icon> = { twitter: "x", x: "x", telegram: "tg", website: "web", tiktok: "tiktok", discord: "discord" };

export function CoinHeader({ r, c, sizes, onPaper }: { r: TokenDetail; c: CoinData | null; sizes: number[]; onPaper: () => void }) {
  const now = useNow();
  const t = r.token, L = r.live;
  const graduated = Boolean(t.graduated);
  // The latest trade, live from the coin's own stream, for a coin in its first day; an older coin's figure follows
  // its Gecko chart (pushed in), so no per-coin chain subscription is held for it.
  const bornAt = c?.created ? (typeof c.created === "number" ? c.created : Date.parse(String(c.created))) : (t.pair_created || t.first_seen || NaN);
  const firstDay = Number.isFinite(bornAt) && bornAt > 0 && Date.now() - bornAt < 24 * 3600e3;
  const traded = useTradeMc(t.mint, firstDay);
  const mc = traded ?? c?.mcUsd ?? (graduated ? t.mcap : L?.mcap ?? t.mcap) ?? null;
  const prog = c?.progress ?? r.progress ?? null;
  const curve = prog != null && !graduated && prog < 0.995;
  // The server's ATH is on the circulating-supply scale; the stored peak (DexScreener's) only until it answers.
  const ath = Math.max(c ? c.athUsd || 0 : t.peak_mcap || 0, L?.ath || 0, mc || 0) || null;   // never below the price on screen
  const fromAth = mc && ath ? (mc / ath - 1) * 100 : null;
  const chg = L?.chg1m != null && !graduated ? [L.chg1m, "1m"] as const : t.chg_h1 != null ? [t.chg_h1, "1h"] as const : null;
  // Jupiter's creation time first: first_seen is when Blix met the coin, days late for one it adopted after launch.
  const born = c?.created || t.pair_created || t.first_seen || c?.tradesSince || null;
  const pool = POOL[/bonk$/.test(t.mint) ? "bonk" : /pump$/.test(t.mint) ? "pump" : ""];
  const up = chg ? chg[0] >= 0 : true;
  const liq = !curve && t.liquidity && t.liquidity > 0 ? t.liquidity : null;
  const top10 = c?.info.top10 ?? null;   // percent (42 = 42%)
  const short = t.mint.length > 14 ? `${t.mint.slice(0, 6)}…${t.mint.slice(-6)}` : t.mint;
  // One figure in the strip: a small caps label, the value, and an optional line or bar under it.
  const stat = (label: string, value: ReactNode, sub?: ReactNode, tip?: string) => (
    <Tip tip={tip}>
      <div className="flex min-w-0 flex-col gap-1.5 px-4 first:pl-0 max-sm:px-0">
        <span className="label text-muted">{label}</span>
        <b className="num text-lg leading-none font-semibold whitespace-nowrap text-ink">{value}</b>
        {sub && <span className="num text-2xs leading-none whitespace-nowrap text-muted">{sub}</span>}
      </div>
    </Tip>
  );
  const bar = (pct: number, tone: string) => <span className="mt-0.5 block h-[3px] w-16 overflow-hidden rounded-full bg-rule-2"><i className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} /></span>;
  const chip = "inline-flex h-6 items-center gap-1.5 rounded-full border border-rule-2 bg-paper-3 px-2 text-xs font-medium whitespace-nowrap text-ink-2";
  const iconBtn = "grid h-full w-7 place-items-center text-muted transition-colors hover:bg-paper-5 hover:text-ink";
  return (
    <header className="surface relative flex flex-wrap items-center gap-x-6 gap-y-4 overflow-hidden px-4 py-3">
      {/* A faint wash in the direction the coin is moving. */}
      <div aria-hidden className={cn("pointer-events-none absolute -top-24 left-1/3 h-44 w-[42rem] rounded-full blur-3xl", up ? "bg-up/[0.07]" : "bg-down/[0.07]")} />
      <button onClick={() => (history.length > 1 ? history.back() : (location.hash = "#/"))} aria-label="Back"
        className="relative grid size-8 shrink-0 place-items-center rounded-full border border-rule-2 bg-paper-3 text-ink-2 transition-colors hover:border-muted hover:text-ink"><CIcon.back className="size-4" /></button>

      {/* Who it is */}
      <div className="relative flex min-w-0 items-center gap-3.5">
        <CoinPic mint={t.mint} symbol={t.symbol} size={58} ring={curve ? prog : graduated ? 1 : null} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="font-display text-[1.6rem] leading-none font-bold tracking-tight text-ink">{t.symbol || "?"}</h1>
            {t.name && t.name !== t.symbol && <span className="max-w-56 truncate text-md text-muted" title={t.name}>{t.name}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {born && <Tip tip="Age"><span className={cn(chip, "num border-up/30 bg-up/10 text-up")}>{ageStr(now - born)}</span></Tip>}
            {pool && <span className={chip}>{PADS[padOf(t)] ? <PadLogo pad={padOf(t)} className="size-3.5 rounded-full" /> : <i className={cn("size-1.5 rounded-[1px]", pool[0])} />}{pool[1]}</span>}
            {graduated && <span className={cn(chip, "border-up/30 text-up")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="size-3"><path d="M5 12l5 5L20 7" /></svg>Bonded</span>}
            <span className="flex h-6 items-center overflow-hidden rounded-full border border-rule-2 bg-paper-3 [&>*+*]:border-l [&>*+*]:border-rule-2">
              {(t.links || []).map((l) => {
                const href = safeHref(l.url);
                if (!href) return null;
                const key = SOCIAL[l.type || ""] || "link";
                const I = Icon[key];
                const site = !SOCIAL[l.type || ""] || l.type === "website";
                const a = <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={iconBtn}><I className="size-3.5" /></a>;
                return key === "x" ? <XHover key={href} href={href}>{a}</XHover> : <Tip key={href} tip={site ? `Set by the coin's creator, unverified: ${href}` : href}>{a}</Tip>;
              })}
              <Tip tip="Search X for this contract"><a href={`https://x.com/search?q=${t.mint}&f=live`} target="_blank" rel="noreferrer" className={iconBtn}><Icon.search className="size-3.5" /></a></Tip>
            </span>
          </div>
          <button onClick={() => navigator.clipboard?.writeText(t.mint).then(() => toast("Contract address copied"))} title={`${t.mint}\nCopy contract address`}
            className="group -mx-1 flex w-fit items-center gap-1.5 rounded-md border border-transparent px-1 text-left text-muted transition-colors hover:border-rule-2 hover:bg-paper-3 hover:text-ink-2">
            <span className="font-outlier text-[0.6875rem] tracking-tight">{short}</span><Icon.copy className="size-3 shrink-0 opacity-70 group-hover:opacity-100" />
          </button>
        </div>
      </div>

      <span aria-hidden className="relative hidden h-14 w-px bg-rule xl:block" />

      {/* The market cap, big, with its move and how far it sits under its high */}
      <div className="relative flex flex-col gap-1.5">
        <span className="label text-muted">Market cap</span>
        <span className="flex items-center gap-2.5">
          <b className="num font-display text-[2rem] leading-none font-bold tracking-tight text-ink"><Flash value={mc}>{usdK(mc)}</Flash></b>
          {chg && <span className={cn("num inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-sm font-semibold", up ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
            {up ? "+" : "−"}{Math.abs(chg[0]).toFixed(1)}%<i className="font-normal not-italic opacity-70">{chg[1]}</i></span>}
        </span>
        {ath && mc ? (
          <Tip tip={`All-time high ${usdK(ath)}`}>
            <span className="flex items-center gap-2 text-2xs text-muted">
              <span className="block h-1 w-28 overflow-hidden rounded-full bg-rule-2"><i className="block h-full rounded-full bg-gradient-to-r from-up/50 to-up" style={{ width: `${Math.min(100, (mc / ath) * 100)}%` }} /></span>
              <span className="num">{fromAth != null && fromAth < -1 ? `${fromAth.toFixed(0)}% from ATH` : "at ATH"}</span>
            </span>
          </Tip>
        ) : null}
        {c?.priceAgeMs != null && c.priceAgeMs > 120_000 && <span className="text-xs font-semibold text-warn">{c.live ? `no trades for ${Math.round(c.priceAgeMs / 60_000)} min` : `price ${Math.round(c.priceAgeMs / 60_000)} min old`}</span>}
      </div>

      {/* The rest of the figures, split by thin rules */}
      <div className="relative flex min-w-0 flex-[1_1_520px] flex-wrap items-start gap-y-3 max-sm:gap-x-6 sm:divide-x sm:divide-rule">
        {stat("Price", <Price value={c?.priceUsd ?? t.price} />)}
        {stat("Liquidity", curve ? "Curve" : liq ? usdK(liq) : "—", liq && mc ? `${Math.round((liq / mc) * 100)}% of MC` : undefined, curve ? "Still on the bonding curve: the curve is the market, there is no pool" : undefined)}
        {curve
          ? stat("B.Curve", `${(prog! * 100).toFixed(2)}%`, bar(prog! * 100, "bg-up"))
          : stat("ATH", usdK(ath), fromAth != null && fromAth < -1 ? <span className="text-down">{fromAth.toFixed(0)}%</span> : "now")}
        {stat("Holders", c?.info.holders != null ? c.info.holders.toLocaleString() : "—", undefined, c?.info.source ? `From the ${c.info.source}` : undefined)}
        {stat("Top 10", <span className={cn(top10 != null && top10 > 50 ? "text-down" : top10 != null && top10 > 30 ? "text-warn" : "")}>{pctN(top10)}</span>,
          top10 != null ? bar(top10, top10 > 50 ? "bg-down" : top10 > 30 ? "bg-warn" : "bg-up") : undefined, "Share of the supply held by the 10 biggest wallets")}
        {stat("Supply", tokN(c?.supply ?? (t.price && t.mcap ? t.mcap / t.price : null)))}
      </div>

    </header>
  );
}


// The Instant panel toggle: floats the quick buy / sell panel over the chart. Sits at the end of the tab row (Tabs.tsx).
export function InstantButton() {
  const quick = useQuick((st) => st.open);
  return (
    <Tip tip="Float the quick buy / sell panel over the chart (drag it anywhere)">
      <button onClick={toggleQuick} aria-pressed={quick}
        className={cn("group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full pr-3.5 pl-2.5 text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-150 active:scale-[0.97]",
          quick ? "bg-ink text-paper shadow-[0_0_0_1px_oklch(100%_0_0/0.25),0_4px_14px_-4px_oklch(100%_0_0/0.35)]"
            : "bg-paper-3 text-ink shadow-[inset_0_0_0_1px_var(--color-rule-2),inset_0_1px_0_oklch(100%_0_0/0.06)] hover:bg-paper-4")}>
        <Icon.bolt className={cn("size-3.5 transition-colors duration-150", quick ? "fill-current" : "fill-current text-ink-2 group-hover:text-ink")} />Instant Trade
      </button>
    </Tip>
  );
}
