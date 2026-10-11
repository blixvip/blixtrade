// Discover rows, laid out like Axiom's Discover table: pair info (picture, ticker, age, links, contract),
// a price line, market cap, liquidity, volume, transactions, token-info pills and a quick buy.
import { rowLink, useNow } from "@/lib/route";
import { XHover, XLinkIcon, xKind, xKindLabel } from "@/components/XCard";
import { memo, useRef, useState } from "react";
import { PumpLogo, SolanaLogo } from "@/components/brand";
import { CoinImg } from "@/components/page";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { ageStr, ageTone, compact, pct, safeHref, shortAddr, tone } from "@/lib/format";
import { useTrade } from "@/lib/mode";
import { Spark } from "@/components/Spark";
import { trade } from "@/lib/trade";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { LiveMc } from "@/components/Live";
import { useLiveMc } from "@/lib/livepx";
import { prefetchCoin } from "@/lib/coin";
import { KnownHolders } from "@/components/KnownHolders";
import { FeesPaid } from "@/components/FeesPaid";
import { useMetrics, useMetricVisibility, metricDescription } from '@/lib/metrics';
import { discoverNumbers, metricPrefix } from './numbers';
import { CoinHover } from "./hovercard";
import { MigratingChip, migratingNow } from "@/components/Migrating";

export type Tf = "5m" | "1h" | "24h";
export type Row = {
  mint: string; symbol: string | null; name: string | null; image: string | null; dex: string | null; pair_created: number | null; first_seen: number;
  mcap: number | null; liquidity: number | null; vol_m5: number | null; vol_h1: number | null; vol_h24: number | null;
  buys_m5: number | null; sells_m5: number | null; buys_h1: number | null; sells_h1: number | null; chg_m5: number | null; chg_h1: number | null; chg_h24: number | null;
  buys_h24?: number | null; sells_h24?: number | null;
  links: { type: string; url: string }[] | null; boosts: number | null; header: string | null; graduated: number; safety_score: number | null; score: number | null;
  safety: { danger?: number; warn?: number; top10?: number; devPct?: number; insiderPct?: number; totalHolders?: number } | null;
  fresh?: { stale?: boolean; dead?: boolean; illiquid?: boolean; exitable?: boolean }; paid?: boolean | null; figSrc?: string | null; dupes?: number; dupTop?: boolean;
  peak_mcap?: number | null; quarantine?: string | null; status?: string | null;
  spark?: (number | [number, number])[]; spark_chg?: number | null; mc_live?: number | null;
  snipers?: number | null; bundlers?: number | null; liveSrc?: boolean; safetyProv?: boolean; insidersProv?: boolean;
  fees?: number | null; feesSince?: number | null;   // fees paid to trade it, SOL (server/coinfees.js)
  migrating?: number | null;   // curve full, pool not trading yet (server livetrades.js migrationOf)
};

// Figures from Blix's own pump.fun trade feed and holder ledger (server.js liveRow), null where it cannot say.
export type LiveFigures = { mc: number | null; liq: number | null; progress: number | null; vol: number | null; buys: number | null; sells: number | null;
  holders: number | null; top10: number | null; dev: number | null; devSold: string | null; snipers: number | null; bundlers: number | null;
  // Until RugCheck has indexed a coin: a provisional score on its formula, and the launch-block wallets' share for insiders.
  safety?: number | null; safetyProv?: boolean; insiders?: number | null; insidersProv?: boolean; fees?: number | null; feesSince?: number | null; migrating?: number | null };
// A row with the live figures laid over the DexScreener / RugCheck reading, field by field.
export function withLive(r: Row, l: LiveFigures | null, tf: Tf): Row {
  if (!l) return r;
  const k = tf === "5m" ? "m5" : tf === "1h" ? "h1" : "h24";
  const provSafety = r.safety_score == null && l.safety != null, provIns = r.safety?.insiderPct == null && l.insiders != null;
  const out: Row = { ...r, mc_live: l.mc ?? r.mc_live, liquidity: l.liq ?? r.liquidity, liveSrc: true, snipers: l.snipers ?? r.snipers, bundlers: l.bundlers ?? r.bundlers, fees: l.fees ?? r.fees, feesSince: l.feesSince ?? r.feesSince, migrating: l.migrating ?? null,
    safety_score: r.safety_score ?? l.safety ?? null, safetyProv: provSafety, insidersProv: provIns,
    safety: { ...(r.safety || {}), top10: l.top10 ?? r.safety?.top10, devPct: l.dev ?? r.safety?.devPct, totalHolders: l.holders ?? r.safety?.totalHolders,
      insiderPct: r.safety?.insiderPct ?? l.insiders ?? undefined } };
  if (l.vol != null) out[`vol_${k}`] = l.vol;
  if (l.buys != null) out[`buys_${k}`] = l.buys;
  if (l.sells != null) out[`sells_${k}`] = l.sells;
  return out;
}

export const GRID = "grid grid-cols-[minmax(320px,2.2fr)_88px_minmax(92px,1fr)_minmax(84px,1fr)_minmax(84px,1fr)_minmax(84px,0.9fr)_minmax(240px,1.9fr)_118px] items-center gap-x-3";
export const pick = (r: Row, tf: Tf) => ({
  vol: tf === "5m" ? r.vol_m5 : tf === "1h" ? r.vol_h1 : r.vol_h24,
  // Measured on the same line the row draws (live trades + snapshots) when there is one, so the two agree.
  chg: r.spark_chg ?? (tf === "5m" ? r.chg_m5 : tf === "1h" ? r.chg_h1 : r.chg_h24),
  // 24h counts arrive through metrics; a 1h count cannot stand in for a missing 24h count.
  buys: tf === "5m" ? r.buys_m5 : tf === "1h" ? r.buys_h1 : r.buys_h24 ?? null, sells: tf === "5m" ? r.sells_m5 : tf === "1h" ? r.sells_h1 : r.sells_h24 ?? null,
});

// One audit figure: a small icon and its number, in a tidy grid with the others. Only the number is coloured:
// red when it is a warning, green when it is healthy, grey when nobody knows it yet.
function Pill({ tip, icon, v, bad, good }: { tip: string; icon: React.ReactNode; v: string; bad?: boolean; good?: boolean }) {
  const unknown = v === "—";
  return (
    <Tip tip={tip}>
      <span className="inline-flex h-5 items-center gap-1 whitespace-nowrap">
        <span className={cn("grid place-items-center [&_svg]:size-3", bad ? "text-down/80" : "text-muted")}>{icon}</span>
        <span className={cn("num text-xs font-semibold", unknown ? "text-muted/70" : bad ? "text-down" : good ? "text-up/90" : "text-ink-2")}>{v}</span>
      </span>
    </Tip>
  );
}
// Equal columns, so the same figure sits in the same place on every row.
const INFO = "grid grid-cols-[repeat(4,62px)] gap-x-2 gap-y-1";
const fmtPct = (n?: number) => n == null ? "—" : `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;

const LINK_ICON: Record<string, (p: { className?: string }) => React.ReactNode> = { twitter: Icon.x, x: Icon.x, telegram: Icon.tg, website: Icon.web, tiktok: Icon.tiktok, discord: Icon.discord };

// `ext`: a coin on another chain (Fomo's lists): its own picture and a chain tag, opens elsewhere, no Solana buy.
export type ExtCoin = { url: string; chain: string; network: number; tag: string; img: string | null };
// `fresh`: it just arrived (New pairs, Bonded): it slides in, as on the Pulse.
// `lead`, `grid`: an extra first cell and the grid that makes room for it (the Hot tab: posts, traders, money in).
export const DiscoverRow = memo(function DiscoverRow({ r, tf, sol, hidden, onHide, ext, fresh, lead, grid = GRID }: { r: Row; tf: Tf; sol: number; hidden?: boolean; onHide?: (mint: string) => void; ext?: ExtCoin; fresh?: boolean; lead?: React.ReactNode; grid?: string }) {
  const now = useNow();
  const metrics = useMetrics(ext ? null : r.mint), visibleRef = useMetricVisibility(ext ? null : r.mint);
  const liveEnd = useLiveMc(ext ? null : r.mint);
  const numbers = discoverNumbers(r, tf, metrics, liveEnd);
  r = numbers.row;
  const { vol, chg, buys, sells, tx, buyShare } = numbers;
  const prefix = (field: string, lowerBound = false) => metricPrefix(metrics?.fields[field], lowerBound);
  const detail = (field: string, label: string) => `${label}${metrics?.fields[field] ? ` · ${metricDescription(metrics.fields[field])}` : ''}`;
  // The line's right end is the live market cap (the same figure as the cap beside it), so it moves trade by trade.
  const born = r.pair_created || r.first_seen, s = r.safety || {};
  const paper = useTrade((st) => st.paper);
  const [state, setState] = useState<null | "busy" | "filled">(null);
  const pending = useRef(0);
  // Every press is a buy (spam buying: lib/trade.ts lines them up); busy while any are going, "filled" after the last.
  const buy = async () => {
    pending.current++;
    setState("busy");
    const ok = await trade({ side: "buy", mint: r.mint, symbol: r.symbol || "", sol }, () => post("paper/quoted", { mint: r.mint, sol }));
    if (--pending.current > 0) return;
    setState(ok ? "filled" : null);
    if (ok) setTimeout(() => { if (!pending.current) setState(null); }, 900);
  };
  // One button per kind (a coin often lists its X account and an X post).
  const links = (r.links || []).filter((l, i, all) => LINK_ICON[l.type] && safeHref(l.url) && all.findIndex((x) => LINK_ICON[x.type] === LINK_ICON[l.type]) === i).slice(0, 4);
  // DexScreener orders API (server/dexpaid.js): a paid profile. Unknown until it answers, then exact.
  const paid = r.paid === true;
  return (
    <div ref={visibleRef} {...rowLink(ext ? ext.url : `#/coin/${r.mint}`)}
      onPointerEnter={ext ? undefined : () => prefetchCoin(r.mint, born)}
      // content-visibility: a row off screen is not laid out or painted until it comes near (its last height is kept,
    // so the scrollbar does not jump): opening and scrolling a 50-row list costs only the rows on screen.
    className={cn(grid, "group cursor-pointer border-b border-rule px-4 py-2.5 transition-colors duration-100 [contain-intrinsic-size:auto_74px] [content-visibility:auto] hover:bg-paper-3/60", fresh && "animate-row-in")}>
      {lead}
      {/* pair info: resting anywhere on it opens the coin card (hovercard.tsx), except on its own buttons and faces; the picture shows itself big instead */}
      {(() => { const cell = (
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative shrink-0">
          {onHide && (
            <Tip tip={hidden ? "Unhide" : "Hide this coin"}>
              <button onClick={() => onHide(r.mint)} aria-label={hidden ? "Unhide coin" : "Hide coin"}
                className={cn("absolute -top-1.5 -left-1.5 z-10 grid size-5.5 place-items-center rounded-full border border-rule-2 bg-paper-2 text-ink-2 shadow-[var(--shadow-raised)] transition-opacity hover:text-ink", hidden ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}>
                {hidden ? <Icon.eye className="size-3.5" /> : <Icon.eyeOff className="size-3.5" />}
              </button>
            </Tip>
          )}
          {(() => {
            const pic = (
              <span data-coin-pic className="relative grid size-12 place-items-center overflow-hidden rounded-[10px] border border-rule-2 bg-paper-4 text-xs font-semibold text-muted uppercase">
                {(r.symbol || "?").slice(0, 3)}
                {ext ? ext.img && <img src={ext.img} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" /> : <CoinImg mint={r.mint} fallback={r.image} />}
              </span>
            );
            return pic;
          })()}
          <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full border border-paper-2 bg-paper-2">
            {ext ? <Tip tip={ext.chain}><span className="text-[7px] leading-none font-bold text-ink-2">{ext.tag}</span></Tip> : r.dex === "pumpswap" || r.dex === "pumpfun" ? <PumpLogo className="size-3" /> : <SolanaLogo className="w-2.5" />}
          </span>
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {(() => { const line = (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <b className="max-w-36 shrink-0 truncate text-lg font-semibold text-ink">{r.symbol || "?"}</b>
            <span className="truncate text-md text-muted">{r.name}</span>
            {(r.dupes || 1) > 1 && <Tip tip={`${r.dupes} tracked coins use this ticker${r.dupTop ? "; this is the biggest" : ""}`}><span className={cn("shrink-0 rounded-sm px-1 text-2xs font-semibold", r.dupTop ? "bg-up/15 text-up" : "bg-ink/10 text-muted")}>×{r.dupes}</span></Tip>}
          </span>
          ); return line; })()}
          <span className="flex min-w-0 items-center gap-2.5 text-sm text-muted">
            <span className={cn("num font-semibold", ageTone(now - born))}>{ageStr(now - born)}</span>
            {links.length > 0 && <span className="flex items-center gap-1">{links.map((l) => { const I = LINK_ICON[l.type]; const isX = l.type === "twitter" || l.type === "x"; const a = <a href={l.url} target="_blank" rel="noopener noreferrer" className="grid size-5 place-items-center rounded-full bg-paper-4 text-ink-2 transition-colors hover:bg-paper-5 hover:text-ink" aria-label={isX ? xKindLabel(xKind(l.url)) : l.type}>{isX ? <XLinkIcon href={l.url} className="size-3" /> : <I className="size-3" />}</a>; return isX ? <XHover key={l.url} href={l.url}>{a}</XHover> : <Tip key={l.url} tip={l.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}>{a}</Tip>; })}</span>}
            <a href={`https://x.com/search?q=${r.mint}`} target="_blank" rel="noopener noreferrer" aria-label="Search the contract on X" className="hover:text-ink"><Icon.search className="size-3.5" /></a>
            <button onClick={() => { navigator.clipboard?.writeText(r.mint); toast("Contract copied"); }} className="flex min-w-0 items-center gap-1 hover:text-ink" aria-label="Copy contract"><Icon.copy className="size-3.5" /><span className="truncate">{shortAddr(r.mint)}</span></button>
          </span>
        </div>
        <KnownHolders mint={r.mint} network={ext?.network} total={s.totalHolders ?? null} />
      </div>
      ); return ext ? cell : <CoinHover r={r} tf={tf}>{cell}</CoinHover>; })()}
      <Spark v={r.spark} chg={chg} k={`${r.mint}:${tf}`} end={liveEnd ?? r.mc_live} />
      {/* market cap */}
      <div className="flex flex-col items-end">{ext ? <b className="num text-md font-semibold text-ink">{compact(r.mc_live ?? r.mcap)}</b> : <LiveMc mint={r.mint} value={r.mc_live ?? r.mcap} className="text-md font-semibold text-ink" />}<span title={detail(`chg${tf}`, `Change ${tf}`)} className={cn("num text-sm", tone(chg))}>{chg != null ? prefix(`chg${tf}`) : ''}{pct(chg)}</span></div>
      <div title={detail('liq', 'Liquidity')} className="num text-right text-md text-ink-2">{r.liquidity != null ? prefix('liq') : ''}{compact(r.liquidity)}</div>
      {/* volume, and under it what traders paid in fees to trade it (Axiom's "F") */}
      <div className="flex flex-col items-end gap-1"><span title={detail(`vol${tf}`, `Volume ${tf}`)} className="num text-md font-semibold text-ink">{vol != null ? prefix(`vol${tf}`, true) : ''}{compact(vol)}</span>{!ext && <FeesPaid mint={r.mint} sol={r.fees} since={r.feesSince} born={born} />}</div>
      {/* transactions: total, then buys over sells (not known for coins on other chains) */}
      {ext ? <div className="num text-right text-md text-muted">—</div> : <div className="flex flex-col items-end gap-1">
        <b title={`${detail(`buys${tf}`, `Buys ${tf}`)} · ${detail(`sells${tf}`, `Sells ${tf}`)}`} className="num text-md font-semibold text-ink">{tx == null ? "—" : `${prefix(`buys${tf}`, true) || prefix(`sells${tf}`, true)}${tx.toLocaleString()}`}</b>
        <span className="num flex gap-1 text-xs"><span className="text-up">{buys == null ? '—' : `${prefix(`buys${tf}`, true)}${buys.toLocaleString()}`}</span><span className="text-muted">/</span><span className="text-down">{sells == null ? '—' : `${prefix(`sells${tf}`, true)}${sells.toLocaleString()}`}</span></span>
        <i className={cn("flex h-0.5 w-14 overflow-hidden rounded-full", buyShare == null ? 'bg-rule' : 'bg-down/70')}>{buyShare != null && <i className="h-full bg-up" style={{ width: `${buyShare * 100}%` }} />}</i>
      </div>}
      {/* token info: Blix's audit figures; a coin on another chain has only its holder count (from Fomo) */}
      {ext ? <div className={INFO}><Pill tip="Holders (Fomo)" icon={<Icon.user className="size-3" />} v={s.totalHolders != null ? `${prefix("holders", true)}${s.totalHolders.toLocaleString()}` : "—"} good={(s.totalHolders ?? 0) >= 500} /></div> : <div className={INFO}>
        <Pill tip={detail("top10", "Top 10 holders' share")} icon={<Icon.users className="size-3" />} v={`${s.top10 != null ? prefix("top10") : ""}${fmtPct(s.top10)}`} bad={(s.top10 ?? 0) > 30} good={s.top10 != null && s.top10 <= 15} />
        <Pill tip={detail("dev", "Developer holds")} icon={<Icon.chef className="size-3" />} v={`${s.devPct != null ? prefix("dev") : ""}${fmtPct(s.devPct)}`} bad={(s.devPct ?? 0) > 5} good={s.devPct != null && s.devPct <= 1} />
        <Pill tip={r.snipers == null ? "Snipers (bought in the first 2 blocks): known for coins Blix watched from their launch; no public source has it for the rest" : "Snipers hold (bought in the first 2 blocks)"} icon={<Icon.crosshair className="size-3" />} v={fmtPct(r.snipers ?? undefined)} bad={(r.snipers ?? 0) > 10} good={r.snipers === 0} />
        <Pill tip={r.insidersProv ? "Insiders: RugCheck has not indexed this coin yet, so this is the share the launch-block wallets still hold" : "Insiders hold (RugCheck's insider networks: wallets funded together)"} icon={<Icon.ghost className="size-3" />} v={s.insiderPct != null ? `${prefix("insiders")}${fmtPct(s.insiderPct)}` : "—"} bad={(s.insiderPct ?? 0) > 10} good={s.insiderPct === 0} />
        <Pill tip={r.bundlers == null ? "Bundlers (bought in the launch block): known for coins Blix watched from their launch; no public source has it for the rest" : "Bundlers hold (bought in the launch block)"} icon={<Icon.boxes className="size-3" />} v={fmtPct(r.bundlers ?? undefined)} bad={(r.bundlers ?? 0) > 10} good={r.bundlers === 0} />
        <Pill tip={detail("holders", "Holders")} icon={<Icon.user className="size-3" />} v={s.totalHolders != null ? `${prefix("holders", true)}${s.totalHolders.toLocaleString()}` : "—"} good={(s.totalHolders ?? 0) >= 500} />
        <Pill tip={r.safetyProv ? "Safety score, provisional: RugCheck has not indexed this coin yet, so it is scored on RugCheck's formula from the holder, dev and authority figures in hand" : `Safety score${s.danger ? ` · ${s.danger} danger flag${s.danger === 1 ? "" : "s"}` : ""}`} icon={<Icon.health className="size-3" />} v={r.safety_score != null ? `${prefix("safety")}${r.safety_score}` : "—"} bad={r.safety_score != null && r.safety_score < 40} good={(r.safety_score ?? 0) >= 70} />
        {paid && <Pill tip="Paid DEX Screener profile or boost" icon={<Icon.dexscreener className="size-3" />} v="DEX paid" good />}
      </div>}
      {/* action */}
      <div className="flex justify-end">
        {ext ? <Tip tip={`On ${ext.chain}: Blix trades Solana only`}><span className="text-sm text-muted">{ext.chain}</span></Tip> : migratingNow(r.migrating) ? <MigratingChip className="h-8" /> : <button onClick={buy} aria-busy={state === "busy"} title={paper ? "Paper money" : "Real SOL"}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-md font-semibold transition-colors",
            state === "filled" ? "border-up/60 bg-up/15 text-up" : "chrome-fill hover:brightness-110 active:scale-95", state === "busy" && "[&_svg]:animate-pulse")}>
          <Icon.bolt className="size-3.5" />{state === "filled" ? "Filled" : `${sol}`}{state !== "filled" && <SolanaLogo className="w-3" />}
        </button>}
      </div>
    </div>
  );
});
