// Discover rows, laid out like Axiom's Discover table: pair info (picture, ticker, age, links, contract),
// a price line, market cap, liquidity, volume, transactions, token-info pills and a quick buy.
import { memo, useState } from "react";
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

export type Tf = "5m" | "1h" | "24h";
export type Row = {
  mint: string; symbol: string | null; name: string | null; image: string | null; dex: string | null; pair_created: number | null; first_seen: number;
  mcap: number | null; liquidity: number | null; vol_m5: number | null; vol_h1: number | null; vol_h24: number | null;
  buys_m5: number | null; sells_m5: number | null; buys_h1: number | null; sells_h1: number | null; chg_m5: number | null; chg_h1: number | null; chg_h24: number | null;
  links: { type: string; url: string }[] | null; boosts: number | null; header: string | null; graduated: number; safety_score: number | null; score: number | null;
  safety: { danger?: number; warn?: number; top10?: number; devPct?: number; insiderPct?: number; totalHolders?: number } | null;
  fresh?: { stale?: boolean; dead?: boolean; illiquid?: boolean; exitable?: boolean }; paid?: boolean | null; figSrc?: string | null; dupes?: number; dupTop?: boolean;
  peak_mcap?: number | null; quarantine?: string | null; status?: string | null;
  spark?: (number | [number, number])[]; spark_chg?: number | null; mc_live?: number | null;
  snipers?: number | null; bundlers?: number | null; liveSrc?: boolean;
};

// Figures from Blix's own pump.fun trade feed and holder ledger (server.js liveRow), null where it cannot say.
export type LiveFigures = { mc: number | null; liq: number | null; progress: number | null; vol: number | null; buys: number | null; sells: number | null;
  holders: number | null; top10: number | null; dev: number | null; devSold: string | null; snipers: number | null; bundlers: number | null };
// A row with the live figures laid over the DexScreener / RugCheck reading, field by field.
export function withLive(r: Row, l: LiveFigures | null, tf: Tf): Row {
  if (!l) return r;
  const k = tf === "5m" ? "m5" : tf === "1h" ? "h1" : "h24";
  const out: Row = { ...r, mc_live: l.mc ?? r.mc_live, liquidity: l.liq ?? r.liquidity, liveSrc: true, snipers: l.snipers, bundlers: l.bundlers,
    safety: { ...(r.safety || {}), top10: l.top10 ?? r.safety?.top10, devPct: l.dev ?? r.safety?.devPct, totalHolders: l.holders ?? r.safety?.totalHolders } };
  if (l.vol != null) out[`vol_${k}`] = l.vol;
  // DexScreener has buy/sell counts for 5m and 1h only; the 24h window shows the 1h counts (the header says so).
  if (l.buys != null && k !== "h24") { out[`buys_${k}` as "buys_m5"] = l.buys; out[`sells_${k}` as "sells_m5"] = l.sells; }
  return out;
}

export const GRID = "grid grid-cols-[minmax(250px,2.2fr)_88px_minmax(92px,1fr)_minmax(84px,1fr)_minmax(84px,1fr)_minmax(84px,0.9fr)_minmax(240px,1.9fr)_118px] items-center gap-x-3";
export const pick = (r: Row, tf: Tf) => ({
  vol: tf === "5m" ? r.vol_m5 : tf === "1h" ? r.vol_h1 : r.vol_h24,
  // Measured on the same line the row draws (live trades + snapshots) when there is one, so the two agree.
  chg: r.spark_chg ?? (tf === "5m" ? r.chg_m5 : tf === "1h" ? r.chg_h1 : r.chg_h24),
  buys: tf === "5m" ? r.buys_m5 : r.buys_h1, sells: tf === "5m" ? r.sells_m5 : r.sells_h1,
});

// One audit figure: an icon and a number, green when it is healthy and red when it is not.
function Pill({ tip, icon, v, bad, good }: { tip: string; icon: React.ReactNode; v: string; bad?: boolean; good?: boolean }) {
  return (
    <Tip tip={tip}>
      <span className={cn("inline-flex h-6 items-center gap-1 rounded-chip border px-1.5 text-xs font-medium num", bad ? "border-down/35 text-down" : good ? "border-up/30 text-up" : "border-rule-2 text-muted")}>
        {icon}{v}
      </span>
    </Tip>
  );
}
const fmtPct = (n?: number) => n == null ? "—" : `${n < 10 ? n.toFixed(1) : Math.round(n)}%`;

const LINK_ICON: Record<string, (p: { className?: string }) => React.ReactNode> = { twitter: Icon.x, x: Icon.x, telegram: Icon.tg, website: Icon.web };

// `ext`: a coin on another chain (Fomo's lists): its own picture and a chain tag, opens elsewhere, no Solana buy.
export type ExtCoin = { url: string; chain: string; tag: string; img: string | null };
export const DiscoverRow = memo(function DiscoverRow({ r, tf, sol, hidden, onHide, ext }: { r: Row; tf: Tf; sol: number; hidden?: boolean; onHide?: (mint: string) => void; ext?: ExtCoin }) {
  const { vol, chg, buys, sells } = pick(r, tf);
  const born = r.pair_created || r.first_seen, s = r.safety || {};
  const paper = useTrade((st) => st.paper);
  const [state, setState] = useState<null | "busy" | "filled">(null);
  const buy = async () => {
    if (state) return;
    setState("busy");
    const ok = await trade({ side: "buy", mint: r.mint, symbol: r.symbol || "", sol }, () => post("paper/quoted", { mint: r.mint, sol }));
    setState(ok ? "filled" : null);
    if (ok) setTimeout(() => setState(null), 900);
  };
  const links = (r.links || []).filter((l) => LINK_ICON[l.type] && safeHref(l.url)).slice(0, 3);
  const tx = (buys || 0) + (sells || 0), buyShare = tx ? (buys || 0) / tx : 0.5;
  // DexScreener orders API (server/dexpaid.js): a paid profile. Unknown until it answers, then exact.
  const paid = r.paid === true;
  return (
    <div onClick={(e) => { if ((e.target as HTMLElement).closest("a,button")) return; if (ext) window.open(ext.url, "_blank", "noopener"); else location.hash = `#/coin/${r.mint}`; }}
      className={cn(GRID, "group cursor-pointer border-b border-rule px-4 py-2.5 transition-colors duration-100 hover:bg-paper-3/60", (r.fresh?.stale || r.fresh?.dead || hidden) && "opacity-55")}>
      {/* pair info */}
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
          <span className="relative grid size-12 place-items-center overflow-hidden rounded-[10px] border border-rule-2 bg-paper-4 text-xs font-semibold text-muted uppercase">
            {(r.symbol || "?").slice(0, 3)}
            {ext ? ext.img && <img src={ext.img} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" /> : <CoinImg mint={r.mint} />}
          </span>
          <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full border border-paper-2 bg-paper-2">
            {ext ? <Tip tip={ext.chain}><span className="text-[7px] leading-none font-bold text-ink-2">{ext.tag}</span></Tip> : r.dex === "pumpswap" || r.dex === "pumpfun" ? <PumpLogo className="size-3" /> : <SolanaLogo className="w-2.5" />}
          </span>
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <b className="truncate text-lg font-semibold text-ink">{r.symbol || "?"}</b>
            <span className="truncate text-md text-muted">{r.name}</span>
            {(r.dupes || 1) > 1 && <Tip tip={`${r.dupes} tracked coins use this ticker${r.dupTop ? "; this is the biggest" : ""}`}><span className={cn("shrink-0 rounded-sm px-1 text-2xs font-semibold", r.dupTop ? "bg-up/15 text-up" : "bg-ink/10 text-muted")}>×{r.dupes}</span></Tip>}
          </span>
          <span className="flex items-center gap-2.5 text-sm text-muted">
            <span className={cn("num font-semibold", ageTone(Date.now() - born))}>{ageStr(Date.now() - born)}</span>
            {links.map((l) => { const I = LINK_ICON[l.type]; return <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="hover:text-ink" aria-label={l.type}><I className="size-3.5" /></a>; })}
            <a href={`https://x.com/search?q=${r.mint}`} target="_blank" rel="noopener noreferrer" aria-label="Search the contract on X" className="hover:text-ink"><Icon.search className="size-3.5" /></a>
            <button onClick={() => { navigator.clipboard?.writeText(r.mint); toast("Contract copied"); }} className="flex items-center gap-1 hover:text-ink" aria-label="Copy contract"><Icon.copy className="size-3.5" />{shortAddr(r.mint)}</button>
          </span>
        </div>
      </div>
      <Spark v={r.spark} chg={chg} />
      {/* market cap */}
      <div className="flex flex-col items-end"><b className="num text-md font-semibold text-ink">{compact(r.mc_live ?? r.mcap)}</b><span className={cn("num text-sm", tone(chg))}>{pct(chg)}</span></div>
      <div className="num text-right text-md text-ink-2">{compact(r.liquidity)}</div>
      <div className="num text-right text-md font-semibold text-ink">{compact(vol)}</div>
      {/* transactions: total, then buys over sells (not known for coins on other chains) */}
      {ext ? <div className="num text-right text-md text-muted">—</div> : <div className="flex flex-col items-end gap-1">
        <b className="num text-md font-semibold text-ink">{tx.toLocaleString()}</b>
        <span className="num flex gap-1 text-xs"><span className="text-up">{(buys || 0).toLocaleString()}</span><span className="text-muted">/</span><span className="text-down">{(sells || 0).toLocaleString()}</span></span>
        <i className="flex h-0.5 w-14 overflow-hidden rounded-full bg-down/70"><i className="h-full bg-up" style={{ width: `${buyShare * 100}%` }} /></i>
      </div>}
      {/* token info: Blix's audit figures; a coin on another chain has only its holder count (from Fomo) */}
      {ext ? <div className="flex flex-wrap gap-1"><Pill tip="Holders (Fomo)" icon={<Icon.user className="size-3" />} v={s.totalHolders != null ? s.totalHolders.toLocaleString() : "—"} good={(s.totalHolders ?? 0) >= 500} /></div> : <div className="flex flex-wrap gap-1">
        <Pill tip="Top 10 holders' share" icon={<Icon.users className="size-3" />} v={fmtPct(s.top10)} bad={(s.top10 ?? 0) > 30} good={s.top10 != null && s.top10 <= 15} />
        <Pill tip="Developer holds" icon={<Icon.chef className="size-3" />} v={fmtPct(s.devPct)} bad={(s.devPct ?? 0) > 5} good={s.devPct != null && s.devPct <= 1} />
        <Pill tip="Snipers hold (bought in the first 2 blocks)" icon={<Icon.crosshair className="size-3" />} v={fmtPct(r.snipers ?? undefined)} bad={(r.snipers ?? 0) > 10} good={r.snipers === 0} />
        <Pill tip="Insiders hold (RugCheck's insider networks; shown only when it finds some)" icon={<Icon.ghost className="size-3" />} v={(s.insiderPct ?? 0) > 0 ? fmtPct(s.insiderPct) : "—"} bad={(s.insiderPct ?? 0) > 10} />
        <Pill tip="Bundlers hold (bought in the launch block)" icon={<Icon.boxes className="size-3" />} v={fmtPct(r.bundlers ?? undefined)} bad={(r.bundlers ?? 0) > 10} good={r.bundlers === 0} />
        <Pill tip="Holders" icon={<Icon.user className="size-3" />} v={s.totalHolders != null ? s.totalHolders.toLocaleString() : "—"} good={(s.totalHolders ?? 0) >= 500} />
        <Pill tip={`Safety score${s.danger ? ` · ${s.danger} danger flag${s.danger === 1 ? "" : "s"}` : ""}`} icon={<Icon.health className="size-3" />} v={r.safety_score != null ? String(r.safety_score) : "—"} bad={r.safety_score != null && r.safety_score < 40} good={(r.safety_score ?? 0) >= 70} />
        {paid && <Pill tip="Paid DEX Screener profile or boost" icon={<Icon.bolt className="size-3" />} v="Paid" good />}
      </div>}
      {/* action */}
      <div className="flex justify-end">
        {ext ? <Tip tip={`On ${ext.chain}: Blix trades Solana only`}><span className="text-sm text-muted">{ext.chain}</span></Tip> : <button onClick={buy} disabled={state === "busy"} title={paper ? "Paper money" : "Real SOL"}
          className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-md font-semibold transition-colors",
            state === "filled" ? "border-up/60 bg-up/15 text-up" : "chrome-fill hover:brightness-110", state === "busy" && "opacity-60")}>
          <Icon.bolt className="size-3.5" />{state === "filled" ? "Filled" : `${sol}`}{state !== "filled" && <SolanaLogo className="w-3" />}
        </button>}
      </div>
    </div>
  );
});
