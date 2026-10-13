// The coin page header: the picture inside its bonding ring, ticker and name, where it trades (the launchpad's own
// logo), its contract and links as real site marks, the market cap big (the chart's own figure), then the other
// figures a tile each; the coin's DexScreener banner faint behind it when it has one. Also the switch for the
// floating instant trade panel (./QuickTrade.tsx).
import { useChartMc } from "@/lib/chartMc";
import { XHover, XLinkIcon, xKind, xKindLabel } from "@/components/XCard";
import { PadLogo, PADS, padOf, SiteLogo } from "@/components/logos";
import { useEffect, type ReactNode } from "react";
import { PumpLogo } from "@/components/brand";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { pctN, tokN, usdK, usdP, type CoinData, type TokenDetail } from "@/lib/coin";
import { ageStr, safeHref } from "@/lib/format";
import { useNow } from "@/lib/route";
import { usePulse, useTradeMc } from "@/lib/pulse";
import { useRouteArg } from "@/lib/route";
import { api } from "@/lib/api";
import { toggleStar, useStarred } from "@/lib/watchlist";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { CIcon, CoinPic, Price } from "./parts";
import { toggleQuick, toggleSideTrades, useQuick, useSideTrades } from "@/lib/quick";
import { Flash } from "@/components/Live";

const POOL: Record<string, [string, string]> = { pump: ["bg-up", "pump.fun"], bonk: ["bg-caution", "letsbonk.fun"], launchlab: ["bg-accent", "Raydium LaunchLab"], bags: ["bg-warn", "Bags"], moonshot: ["bg-ink-2", "Moonshot"] };
const SOCIAL: Record<string, keyof typeof Icon> = { twitter: "x", x: "x", telegram: "tg", website: "web", tiktok: "tiktok", discord: "discord" };

export function CoinHeader({ r, c, sizes, onPaper }: { r: TokenDetail; c: CoinData | null; sizes: number[]; onPaper: () => void }) {
  const now = useNow();
  const t = r.token, L = r.live;
  const graduated = Boolean(t.graduated);
  // The latest trade, live from the coin's own stream, for a coin in its first day; an older coin's figure follows
  // its Gecko chart (pushed in), so no per-coin chain subscription is held for it.
  const traded = useTradeMc(t.mint, false); // the visible chart owns the dedicated stream
  // The shared live mark also prices holdings and wallet PnL. Chart snapshots are the initial fallback.
  const chartMc = useChartMc((s) => s[t.mint]);
  const mc = c?.mcUsd ?? chartMc ?? traded ?? (graduated ? t.mcap : L?.mcap ?? t.mcap) ?? null;
  // The tab title follows the same live figure: "$52.21K CATE | Blix", market cap first so it reads in a narrow tab.
  const mcTab = mc != null ? usdP(mc) : null;
  useEffect(() => { document.title = `${mcTab ? `${mcTab} ` : ""}${t.symbol || "Coin"} | Blix`; }, [mcTab, t.symbol]);
  // The supply shown, and the price as the market cap over it, so price × supply is the market cap on screen.
  const shownSupply = c?.supply ?? (t.price && t.mcap ? t.mcap / t.price : null);
  const prog = c?.progress ?? r.progress ?? null;
  const curve = prog != null && !graduated && prog < 0.995;
  // The server's ATH is on the circulating-supply scale; the stored peak (DexScreener's) only until it answers.
  // SOL, stablecoins, wrapped BTC: Blix met them years after their real highs, so no "ATH" of its own for them.
  const major = Boolean(t.asset_class && t.asset_class !== "meme");
  const ath = major ? null : Math.max(c ? c.athUsd || 0 : t.peak_mcap || 0, L?.ath || 0, mc || 0) || null;   // never below the price on screen
  const fromAth = mc && ath ? (mc / ath - 1) * 100 : null;
  const chg = L?.chg1m != null && !graduated ? [L.chg1m, "1m"] as const : t.chg_h1 != null ? [t.chg_h1, "1h"] as const : null;
  // Jupiter's creation time first: first_seen is when Blix met the coin, days late for one it adopted after launch.
  const born = c?.created || t.pair_created || t.first_seen || c?.tradesSince || null;
  const pool = POOL[/bonk$/.test(t.mint) ? "bonk" : /pump$/.test(t.mint) ? "pump" : ""];
  const up = chg ? chg[0] >= 0 : true;
  const liq = !curve && t.liquidity && t.liquidity > 0 ? t.liquidity : null;
  const top10 = c?.info.top10 ?? null;   // percent (42 = 42%)
  const short = t.mint.length > 14 ? `${t.mint.slice(0, 5)}…${t.mint.slice(-5)}` : t.mint;
  const pad = padOf(t), padInfo = PADS[pad];
  const banner = typeof t.header === "string" && /^https:\/\//.test(t.header) ? t.header : null;
  const copyCa = () => navigator.clipboard?.writeText(t.mint).then(() => toast("Contract address copied"));
  // One figure: a small icon and label, the value, and an optional line or bar under it. A tile each, so the six read
  // as a set and none runs into the next.
  // One figure in the header's strip: a small label over the value, a short line or bar under it; no box, a hairline
  // between figures (one slim row, so the chart keeps the screen on a short window: the owner, 2026-10-10).
  const stat = (_icon: ReactNode, label: string, value: ReactNode, sub?: ReactNode, tip?: string) => (
    <Tip tip={tip}>
      <div className="flex min-w-[4.75rem] shrink-0 flex-col gap-1 border-l border-white/[0.06] px-3 py-0.5 first:border-l-0 first:pl-0 max-sm:border-l-0 max-sm:px-0">
        <span className="text-2xs font-semibold tracking-[0.06em] whitespace-nowrap text-muted uppercase">{label}</span>
        <b className="num truncate text-md leading-none font-semibold text-ink">{value}</b>
        <span className="num flex h-2.5 max-w-[11rem] items-center truncate text-2xs leading-none whitespace-nowrap text-muted" title={typeof sub === "string" ? sub : undefined}>{sub}</span>
      </div>
    </Tip>
  );
  const bar = (pct: number, tone: string) => <span className="block h-[3px] w-full max-w-20 overflow-hidden rounded-full bg-white/[0.07]"><i className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.min(100, Math.max(2, pct))}%` }} /></span>;
  const chip = "inline-flex h-6 items-center gap-1.5 rounded-full border border-white/[0.08] bg-paper-3/80 px-2.5 text-xs font-semibold whitespace-nowrap text-ink-2";
  // A round link with the site's own mark; it takes the site's colour on hover.
  const link = "grid size-7 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-paper-3/80 text-ink-2 transition-[color,background-color,border-color,scale] duration-150 hover:scale-105 hover:border-white/20 hover:bg-paper-4 hover:text-ink active:scale-95 [&_svg]:size-3.5";
  const BRAND: Record<string, string> = { x: "hover:text-white", tg: "hover:text-[#2AABEE]", discord: "hover:text-[#5865F2]", tiktok: "hover:text-white", web: "hover:text-ink", link: "hover:text-ink" };
  return (
    <header className="surface relative isolate overflow-hidden">
      {/* The coin's own DexScreener banner, faint behind its name, when it has one. No red or green wash behind the
          header (the owner, 2026-10-10): the colour stays on the figures. */}
      {banner && (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-[min(46rem,70%)] [mask-image:linear-gradient(to_right,black_10%,transparent)]">
          <img src={banner} alt="" referrerPolicy="no-referrer" className="size-full object-cover opacity-[0.16] blur-[1px] saturate-125" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-3.5 py-3">


        {/* Who it is: picture in its bonding ring, ticker and name, where it trades, its contract and links */}
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => (history.length > 1 ? history.back() : (location.hash = "#/"))} aria-label="Back"
            className="grid size-8 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-paper-3/80 text-ink-2 transition-colors hover:border-white/20 hover:text-ink max-sm:hidden"><CIcon.back className="size-4" /></button>
          <CoinPic mint={t.mint} symbol={t.symbol} size={52} ring={curve ? prog : graduated ? 1 : null} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              <h1 className="font-display text-[1.375rem] leading-none font-bold tracking-tight text-ink">{t.symbol || "?"}</h1>
              {t.name && t.name !== t.symbol && <span className="max-w-48 truncate text-sm text-muted" title={t.name}>{t.name}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {born && <Tip tip={`Launched ${new Date(born).toLocaleString()}`}><span className={cn(chip, "num border-up/25 bg-up/[0.08] text-up")}><i className="size-1.5 rounded-full bg-up" />{ageStr(now - born)}</span></Tip>}
              {padInfo
                ? <Tip tip={`Open on ${padInfo.name}`}><a href={padInfo.url(t.mint)} target="_blank" rel="noopener noreferrer" className={cn(chip, "transition-colors hover:border-white/20 hover:text-ink")}><PadLogo pad={pad} className="size-3.5 rounded-full" />{padInfo.name}</a></Tip>
                : pool && <span className={chip}><i className={cn("size-1.5 rounded-[1px]", pool[0])} />{pool[1]}</span>}
              {graduated
                ? <span className={cn(chip, "border-up/25 text-up")}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="size-3"><path d="M5 12l5 5L20 7" /></svg>Bonded</span>
                : curve && <Tip tip="How full the bonding curve is: it moves to its own pool at 100%"><span className={cn(chip, "num")}>Bonding {(prog! * 100).toFixed(0)}%<span className="block h-1 w-10 overflow-hidden rounded-full bg-white/[0.08]"><i className="block h-full rounded-full bg-up" style={{ width: `${Math.max(3, prog! * 100)}%` }} /></span></span></Tip>}
              <span className="flex h-7 items-center overflow-hidden rounded-full border border-white/[0.08] bg-paper-3/80">
                <Tip tip={`${t.mint} · copy`}>
                  <button onClick={copyCa} className="group flex h-full items-center gap-1.5 pr-2 pl-2.5 text-muted transition-colors hover:bg-paper-4 hover:text-ink">
                    <span className="font-outlier text-[0.6875rem] tracking-tight">{short}</span><Icon.copy className="size-3 shrink-0 opacity-70 group-hover:opacity-100" />
                  </button>
                </Tip>
                <Tip tip="Open on Solscan"><a href={`https://solscan.io/token/${t.mint}`} target="_blank" rel="noreferrer" aria-label="Open on Solscan" className="grid h-full w-7 place-items-center border-l border-white/[0.08] transition-colors hover:bg-paper-4"><SiteLogo site="solscan" className="size-3.5" /></a></Tip>
              </span>
              {(t.links || []).map((l) => {
                const href = safeHref(l.url);
                if (!href) return null;
                const key = SOCIAL[l.type || ""] || "link";
                const I = Icon[key];
                const site = !SOCIAL[l.type || ""] || l.type === "website";
                const a = <a href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={key === "x" ? xKindLabel(xKind(href)) : key === "tg" ? "Telegram" : key === "web" ? "Website" : key} className={cn(link, BRAND[key])}>{key === "x" ? <XLinkIcon href={href} /> : <I />}</a>;
                return key === "x" ? <XHover key={href} href={href}>{a}</XHover> : <Tip key={href} tip={site ? `Website, set by the coin's creator (unverified): ${href}` : href}>{a}</Tip>;
              })}
              <Tip tip="Open on DexScreener"><a href={`https://dexscreener.com/solana/${t.pair || t.mint}`} target="_blank" rel="noreferrer" aria-label="Open on DexScreener" className={link}><SiteLogo site="dexscreener" className="size-3.5" /></a></Tip>
              <Tip tip="Search X for this contract"><a href={`https://x.com/search?q=${t.mint}&f=live`} target="_blank" rel="noreferrer" aria-label="Search X for this contract" className={link}><Icon.search /></a></Tip>
            </div>
          </div>
        </div>


        {/* The market cap, big (the chart's own figure), its move, and how far under its high */}
        <div className="flex flex-col gap-1.5 xl:min-w-[11rem]">
          <span className="flex items-center gap-2.5">
            <b className="num font-display text-[1.75rem] leading-none font-bold tracking-tight text-ink"><Flash value={mc}>{mc != null ? usdP(mc) : "—"}</Flash></b>
            {chg && <span className={cn("num inline-flex h-6 items-center gap-1 rounded-full px-2 text-sm font-semibold", up ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
              {up ? "▲" : "▼"} {Math.abs(chg[0]).toFixed(1)}%<i className="font-medium not-italic opacity-60">{chg[1]}</i></span>}
          </span>
          {ath && mc ? (
            <Tip tip={`All-time high ${usdP(ath)}`}>
              <span className="flex items-center gap-2 text-2xs text-muted">
                <span className="block h-1 w-24 overflow-hidden rounded-full bg-white/[0.07]"><i className="block h-full rounded-full bg-gradient-to-r from-up/40 to-up" style={{ width: `${Math.min(100, (mc / ath) * 100)}%` }} /></span>
                <span className="num whitespace-nowrap">{fromAth != null && fromAth < -1 ? <><span className="text-ink-2">{fromAth.toFixed(0)}%</span> from ATH {usdK(ath)}</> : <span className="text-up">At its all-time high</span>}</span>
              </span>
            </Tip>
          ) : null}
          {c?.priceAgeMs != null && c.priceAgeMs > 120_000 && <span className="text-2xs font-semibold text-warn">{c.live ? `No trades for ${Math.round(c.priceAgeMs / 60_000)} min` : `Price ${Math.round(c.priceAgeMs / 60_000)} min old`}</span>}
        </div>

        {/* The rest of the figures, a tile each */}
        <div className="flex min-w-0 flex-[1_1_480px] items-center overflow-x-auto [scrollbar-width:none] max-sm:grid max-sm:grid-cols-3 max-sm:gap-x-3 max-sm:gap-y-2.5 [&::-webkit-scrollbar]:hidden">
          {stat(<Icon.candles />, "Price", <Price value={mc != null && shownSupply && shownSupply > 0 ? mc / shownSupply : c?.priceUsd ?? t.price} />, "USD per token")}
          {stat(<Icon.wallets />, "Liquidity", curve ? "Curve" : liq ? usdK(liq) : "—", curve ? "on the bonding curve" : liq && mc ? `${Math.round((liq / mc) * 100)}% of market cap` : undefined, curve ? "Still on the bonding curve: the curve is the market, there is no pool" : undefined)}
          {curve
            ? stat(<Icon.curve />, "Bonding", `${(prog! * 100).toFixed(1)}%`, bar(prog! * 100, "bg-up"), "How full the bonding curve is: it moves to its own pool at 100%")
            : major ? stat(<Icon.candles />, "24h", <span className={cn((t.chg_h24 ?? 0) >= 0 ? "text-up" : "text-down")}>{t.chg_h24 != null ? `${t.chg_h24 >= 0 ? "+" : ""}${t.chg_h24.toFixed(2)}%` : "—"}</span>, "price change")
            : stat(<Icon.crown />, "ATH", ath ? usdK(ath) : "—", fromAth != null && fromAth < -1 ? <span className="text-down">{fromAth.toFixed(0)}% from it</span> : <span className="text-up">now</span>)}
          {stat(<Icon.users />, "Holders", c?.info.holders != null ? c.info.holders.toLocaleString() : "—", c?.info.source ? `via ${c.info.source}` : undefined)}
          {stat(<Icon.userStar />, "Top 10", <span className={cn(top10 != null && top10 > 50 ? "text-down" : top10 != null && top10 > 30 ? "text-warn" : "")}>{pctN(top10)}</span>,
            top10 != null ? bar(top10, top10 > 50 ? "bg-down" : top10 > 30 ? "bg-warn" : "bg-up") : undefined, "Share of the supply held by the 10 biggest wallets")}
          {stat(<Icon.boxes />, "Supply", tokN(shownSupply), "tokens")}
        </div>
      </div>
    </header>
  );
}


// The star at the end of the tab row: this coin on or off the watchlist (lib/watchlist.ts), which shows in the strip
// under the top bar (components/WatchTape.tsx). Lit gold while it is on.
function WatchButton({ pill }: { pill: (on: boolean) => string }) {
  const mint = useRouteArg();
  const on = useStarred(mint);
  const symbol = usePulse((st) => (mint ? st.coins[mint]?.symbol : null));
  const press = async () => {
    if (!mint) return;
    const sym = symbol || (await api<{ token?: { symbol?: string | null } }>(`token/${mint}`).then((r) => r.token?.symbol || null).catch(() => null)) || mint.slice(0, 4);
    toast(toggleStar(mint, sym) ? `$${sym} added to your watchlist` : `$${sym} removed from your watchlist`);
  };
  return (
    <Tip tip={on ? "On your watchlist (in the strip up top). Press to take it off" : "Add to your watchlist: it shows in the strip up top with its live market cap"}>
      <button onClick={press} aria-pressed={on} aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
        className={cn(pill(on), "w-8 justify-center px-0 pr-0 pl-0", on && "bg-warn text-paper shadow-[0_0_0_1px_oklch(100%_0_0/0.15),0_4px_14px_-4px_var(--color-warn)]")}>
        <Icon.star className={cn("size-4 transition-colors duration-150", on ? "fill-current" : "text-ink-2 group-hover:text-ink")} />
      </button>
    </Tip>
  );
}

// The Instant panel toggle: floats the quick buy / sell panel over the chart. Sits at the end of the tab row (Tabs.tsx).
// The two pills at the end of the tab bar: Instant Trade (the floating quick trade panel) and Live Trades (the
// trades column beside the chart, folded away or brought back). Both lit while on.
export function InstantButton() {
  const quick = useQuick((st) => st.open), trades = useSideTrades((st) => st.on);
  const pill = (on: boolean) => cn("group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full pr-3.5 pl-2.5 text-sm font-semibold whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-150 active:scale-[0.97]",
    on ? "bg-ink text-paper shadow-[0_0_0_1px_oklch(100%_0_0/0.25),0_4px_14px_-4px_oklch(100%_0_0/0.35)]"
      : "bg-paper-3 text-ink shadow-[inset_0_0_0_1px_var(--color-rule-2),inset_0_1px_0_oklch(100%_0_0/0.06)] hover:bg-paper-4");
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <WatchButton pill={pill} />
      <Tip tip="Float the quick buy / sell panel over the chart (drag it anywhere)">
        <button onClick={toggleQuick} aria-pressed={quick} className={pill(quick)}>
          <Icon.bolt className={cn("size-3.5 transition-colors duration-150", quick ? "fill-current" : "fill-current text-ink-2 group-hover:text-ink")} />Instant Trade
        </button>
      </Tip>
      <Tip tip={trades ? "Hide the live trades column beside the chart" : "Show the live trades column beside the chart"}>
        <button onClick={toggleSideTrades} aria-pressed={trades} className={pill(trades)}>
          <Icon.pulse className={cn("size-3.5 transition-colors duration-150", !trades && "text-ink-2 group-hover:text-ink")} />Live Trades
        </button>
      </Tip>
    </span>
  );
}
