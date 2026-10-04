// The coin page header: the picture inside its bonding ring with the contract under the name, the live
// figures (market cap first), and quick paper buys plus the real-money route (Fomo).
import { loadPaperWallet, paperReady } from "@/lib/mode";
import { useState, type ReactNode } from "react";
import { PumpLogo, SolanaLogo } from "@/components/brand";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { post } from "@/lib/api";
import { pctN, tokN, usdK, type CoinData, type TokenDetail } from "@/lib/coin";
import { ageStr, fomoUrl, safeHref } from "@/lib/format";
import { useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { CIcon, CoinPic, CopyBtn, Price } from "./parts";

const POOL: Record<string, [string, string]> = { pump: ["bg-up", "pump.fun"], bonk: ["bg-caution", "letsbonk.fun"], launchlab: ["bg-accent", "Raydium LaunchLab"], bags: ["bg-warn", "Bags"], moonshot: ["bg-ink-2", "Moonshot"] };
const SOCIAL: Record<string, keyof typeof Icon> = { twitter: "x", telegram: "tg", website: "web" };

export function CoinHeader({ r, c, sizes, onPaper }: { r: TokenDetail; c: CoinData | null; sizes: number[]; onPaper: () => void }) {
  const now = useNow();
  const t = r.token, L = r.live;
  const graduated = Boolean(t.graduated);
  const mc = c?.mcUsd ?? (graduated ? t.mcap : L?.mcap ?? t.mcap) ?? null;
  const prog = c?.progress ?? r.progress ?? null;
  const curve = prog != null && !graduated && prog < 0.995;
  const ath = Math.max(c?.athUsd || 0, t.peak_mcap || 0, L?.ath || 0, mc || 0) || null;   // never below the price on screen
  const fromAth = mc && ath ? (mc / ath - 1) * 100 : null;
  const chg = L?.chg1m != null && !graduated ? [L.chg1m, "1m"] as const : t.chg_h1 != null ? [t.chg_h1, "1h"] as const : null;
  const born = t.pair_created || t.first_seen || c?.tradesSince || null;
  const pool = POOL[/bonk$/.test(t.mint) ? "bonk" : /pump$/.test(t.mint) ? "pump" : ""];
  const [busy, setBusy] = useState<number | null>(null);
  const buy = async (sol: number) => {
    setBusy(sol);
    if (!paperReady()) return;
    try { await post("paper/quoted", { mint: t.mint, sol }); toast(`Paper buy $${t.symbol || ""}: ${sol} SOL`); onPaper(); loadPaperWallet(); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(null); }
  };
  const stat = (label: string, value: ReactNode, tip?: string) => (
    <Tip tip={tip}><div className="flex min-w-0 flex-col gap-1"><span className="label">{label}</span><b className="num whitespace-nowrap text-lg font-semibold text-ink">{value}</b></div></Tip>
  );
  return (
    <header className="surface flex flex-wrap items-center gap-x-5 gap-y-3 px-3.5 py-2.5">
      <button onClick={() => (history.length > 1 ? history.back() : (location.hash = "#/"))} aria-label="Back"
        className="grid size-8 shrink-0 place-items-center rounded-control border border-rule-2 bg-paper-4 text-ink-2 hover:text-ink"><CIcon.back className="size-4" /></button>
      <div className="flex min-w-0 items-center gap-3">
        <CoinPic mint={t.mint} symbol={t.symbol} size={56} ring={curve ? prog : graduated ? 1 : null} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{t.symbol || "?"}</h1>
            <span className="max-w-56 truncate text-md text-muted" title={t.name || ""}>{t.name}</span>
            <CopyBtn text={t.mint} tip="Copy contract address" />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {born && <span className="num font-semibold text-up">{ageStr(now - born)}</span>}
            {pool && <span className="flex items-center gap-1 text-muted">{pool[1] === "pump.fun" ? <PumpLogo className="size-3.5" /> : <i className={cn("size-1.5 rounded-[1px]", pool[0])} />}{pool[1]}</span>}
            {graduated && <span className="text-muted">· bonded</span>}
            {(t.links || []).map((l) => {
              const href = safeHref(l.url);
              if (!href) return null;
              const key = SOCIAL[l.type || ""] || "link";
              const I = Icon[key];
              const site = !SOCIAL[l.type || ""] || l.type === "website";
              return <Tip key={href} tip={site ? `Set by the coin's creator, unverified: ${href}` : href}><a href={href} target="_blank" rel="noopener noreferrer nofollow" className="grid size-6 place-items-center rounded-chip text-muted hover:bg-paper-4 hover:text-ink"><I className="size-3.5" /></a></Tip>;
            })}
            <Tip tip="Search X for this contract"><a href={`https://x.com/search?q=${t.mint}&f=live`} target="_blank" rel="noreferrer" className="grid size-6 place-items-center rounded-chip text-muted hover:bg-paper-4 hover:text-ink"><Icon.search className="size-3.5" /></a></Tip>
          </div>
          <button onClick={() => navigator.clipboard?.writeText(t.mint).then(() => toast("Contract address copied"))} title="Copy contract address"
            className="flex max-w-full items-center gap-1.5 text-left text-muted hover:text-ink-2">
            <span className="truncate font-outlier text-[0.6875rem]">{t.mint}</span><Icon.copy className="size-3 shrink-0" />
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-[1_1_640px] flex-wrap items-end gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <span className="label">Market cap</span>
          <span className="flex items-baseline gap-2"><b className="num font-display text-[1.75rem] leading-none font-semibold tracking-tight text-ink">{usdK(mc)}</b>
            {chg && <span className={cn("num text-sm font-semibold", chg[0] >= 0 ? "text-up" : "text-down")}>{chg[0] >= 0 ? "+" : ""}{chg[0].toFixed(1)}% <i className="font-normal not-italic text-muted">{chg[1]}</i></span>}</span>
          {c?.priceAgeMs != null && c.priceAgeMs > 120_000 && <span className="text-xs font-semibold text-warn">price {Math.round(c.priceAgeMs / 60_000)} min old</span>}
        </div>
        {stat("Price", <Price value={c?.priceUsd ?? t.price} />)}
        {stat("Liquidity", curve ? "Curve" : t.liquidity && t.liquidity > 0 ? usdK(t.liquidity) : "—", curve ? "Still on the bonding curve: the curve is the market, there is no pool" : undefined)}
        {stat("Supply", tokN(c?.supply ?? (t.price && t.mcap ? t.mcap / t.price : null)))}
        {curve
          ? <div className="flex flex-col gap-1"><span className="label">B.Curve</span><b className="num text-lg font-semibold text-ink">{(prog! * 100).toFixed(2)}%</b><span className="block h-[3px] w-20 overflow-hidden rounded bg-rule-2"><i className="block h-full bg-up" style={{ width: `${Math.min(100, prog! * 100)}%` }} /></span></div>
          : stat("Status", graduated ? "Bonded" : t.status || "—")}
        {stat("ATH", <>{usdK(ath)}{fromAth != null && fromAth < -1 && <span className="ml-1 text-sm text-down">{fromAth.toFixed(0)}%</span>}</>)}
        {stat("Holders", c?.info.holders != null ? c.info.holders.toLocaleString() : "—", c?.info.source ? `From the ${c.info.source}` : undefined)}
        {stat("Top 10", pctN(c?.info.top10 ?? null))}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <Tip tip="Paper buys at the real quote: nothing is really bought"><span className="flex items-center gap-1 text-[0.625rem] font-bold tracking-wider text-warn"><Icon.bolt className="size-3.5" />PAPER</span></Tip>
        {sizes.map((s) => (
          <button key={s} disabled={busy != null} onClick={() => buy(s)}
            className="num inline-flex h-7 items-center gap-1.5 rounded-full border border-up/50 px-3 text-sm font-semibold text-up hover:bg-up/15 disabled:opacity-50"><SolanaLogo className="w-3" />{s}</button>
        ))}
        <a href={fomoUrl(t.mint)} target="_blank" rel="noreferrer" className="h-7 rounded-full bg-ink px-3 text-sm leading-7 font-semibold text-paper hover:bg-white">Buy on Fomo</a>
      </div>
    </header>
  );
}
