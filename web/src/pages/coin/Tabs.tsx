// The tabs under the chart: recent trades, the holder ledger, top traders, Fomo's known holders (FomoTabs.tsx),
// every thesis from pump.fun and Fomo (Theses.tsx), the dev's coins, the AI read and the safety check. Your position is in the right column.
import { AiGate } from "../AiPicks";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { tokN, usdK, type CoinData, type TokenDetail, type Trades } from "@/lib/coin";
import { ageStr } from "@/lib/format";
import { useNow } from "@/lib/route";
import { usePoll } from "@/lib/coin";
import { useReplay } from "@/lib/replay";
import { cn, store } from "@/lib/utils";
import { KnownHolders, type CoinFomo } from "./FomoTabs";
import { AllTheses } from "./Theses";
import { Empty, SolAmt, Who } from "./parts";
import { AiView, DevView, HoldersView, SafetyView, TradersView } from "./tabviews";

type TabKey = "trades" | "holders" | "traders" | "known" | "theses" | "dev" | "ai" | "safety";
const TABS: [TabKey, string][] = [["known", "Known holders"], ["trades", "Trades"], ["holders", "Holders"], ["traders", "Top traders"], ["theses", "Theses"], ["dev", "Dev tokens"], ["ai", "AI read"], ["safety", "Safety"]];
type Filter = "all" | "dev" | "sniper" | "bundle" | "top10" | "followed" | "big";
const FILTERS: [Filter, string][] = [["all", "All"], ["dev", "Dev"], ["sniper", "Snipers"], ["bundle", "Bundles"], ["top10", "Top 10"], ["followed", "Followed"], ["big", "≥ 1 SOL"]];

const th = "sticky top-0 z-[1] whitespace-nowrap border-b border-rule bg-paper-2 px-3 py-1.5 text-left label";
const td = "whitespace-nowrap border-b border-rule/70 px-3 py-1.5 text-ink-2";

// `sideTrades`: the trades are beside the chart (SideTrades), so the Trades tab is left out here.
export function CoinTabs({ mint, r, c, trades, onPaper, sideTrades = false, end }: { mint: string; r: TokenDetail; c: CoinData | null; trades: Trades | null; onPaper: () => void; sideTrades?: boolean; end?: ReactNode }) {
  // A coin opens on Known holders when Fomo knows any of its holders, else on Holders (the user, 2026-10-10): Holders
  // while Fomo's answer is on its way, Known holders the moment it has some. Known holders, once shown, stays. A tab
  // someone picks lasts while this coin is open.
  const [pick, setTabState] = useState<{ mint: string; tab: TabKey } | null>(null);
  const auto = useRef<{ mint: string; known: boolean }>({ mint, known: false });
  if (auto.current.mint !== mint) auto.current = { mint, known: false };
  const tabs = sideTrades ? TABS.filter(([k]) => k !== "trades") : TABS;
  // Fomo's known holders and theses, for the two tabs and their counts (read through Aside, kept 3 min).
  const [fomoMs, setFomoMs] = useState(1500);
  const fomoPoll = usePoll<CoinFomo>(`coin/${mint}/fomo`, fomoMs), fomo = fomoPoll.data;
  // Every 1.5 s while Fomo's first answer is on its way, every 15 s once it is in. Fomo saying it could not answer
  // (signed out, not answering) is not on its way: then every 10 s, instead of every 1.5 s for as long as the page
  // is open.
  const fomoWait = fomo?.read ? 15_000 : fomo?.error ? 10_000 : 1500;
  useEffect(() => { setFomoMs(fomoWait); }, [fomoWait, mint]);
  // pump.fun's callouts on this coin, for the Theses tab and its count (with Fomo's theses).
  const calloutsPoll = usePoll<{ items: unknown[] | null }>(`coin/${mint}/callouts`, 4_000), callouts = calloutsPoll.data;
  // A replay jump (lib/replay.ts): Fomo's holders and the theses as of the new moment, now.
  const replayEpoch = useReplay((st) => (st.mint === mint ? st.epoch : 0));
  const replayRev = useReplay((st) => (st.mint === mint ? st.rev : 0));
  useEffect(() => { if (replayEpoch) { fomoPoll.refresh(); calloutsPoll.refresh(); } }, [replayEpoch, replayRev]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (t: TabKey) => setTabState({ mint, tab: t });
  if ((fomo?.holders?.length || fomo?.totalHolders || 0) > 0) auto.current.known = true;
  const picked: TabKey = pick?.mint === mint ? pick.tab : auto.current.known ? "known" : "holders";
  const tab: TabKey = sideTrades && picked === "trades" ? "holders" : picked;
  // The last answer that had rows, per coin: an answer caught between sources (an empty list for a moment) never
  // blanks a tab that was showing them.
  const kept = useRef<{ mint: string; h: CoinData | null; t: CoinData | null }>({ mint, h: null, t: null });
  if (kept.current.mint !== mint) kept.current = { mint, h: null, t: null };
  if (c?.holders?.list?.length) kept.current.h = c;
  if (c?.traders?.length) kept.current.t = c;
  // In a replay the kept lists are another moment's (or today's): only the replay's own.
  const hc = c?.holders?.list?.length ? c : replayEpoch ? null : kept.current.h, tc = c?.traders?.length ? c : replayEpoch ? null : kept.current.t;
  const finding = <Empty title="Finding who held it then" text="Blix is matching this day's older trades to their wallets. Holders and top traders at this moment show here the moment that is done." />;
  const count: Partial<Record<TabKey, number | null | undefined>> = {
    holders: c?.info?.holders ?? c?.holders?.count, dev: c?.dev?.coins?.others || null, known: fomo?.totalHolders ?? (fomo?.holders?.length || null), theses: (fomo?.theses?.length || 0) + (callouts?.items?.length || 0) || null,
  };
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-center gap-2 border-b border-rule pr-2">
      <div role="tablist" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto px-1.5 [scrollbar-width:none]">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("relative whitespace-nowrap px-2.5 py-2.5 text-md font-semibold", tab === k ? "text-ink" : "text-muted hover:text-ink-2")}>
            {l}{count[k] != null && <span className="num ml-1 font-normal text-muted">{Number(count[k]).toLocaleString()}</span>}
            {tab === k && <i className="absolute inset-x-2.5 -bottom-px h-0.5 rounded bg-accent" />}
          </button>
        ))}
      </div>
      {end}
      </div>
      <div className="min-h-64">
        {tab === "trades" && <TradesTab trades={trades} />}
        {tab === "holders" && (hc ? <HoldersView c={hc} bonding={!r.token?.graduated && (hc.onCurve || (r.progress ?? r.live?.progress ?? hc.progress ?? 1) < 1)} /> : replayEpoch && c ? finding : <Ghost />)}
        {tab === "traders" && (tc ? <TradersView c={tc} /> : replayEpoch && c ? finding : <Ghost />)}
        {tab === "known" && <KnownHolders f={fomo} mint={mint} mc={c?.mcUsd ?? r.token?.mcap ?? null} supply={c?.supply ?? null} />}
        {tab === "theses" && <AllTheses mint={mint} f={fomo} />}
        {tab === "dev" && (c?.dev ? <DevView mint={mint} c={c} /> : c ? <Empty title="Dev unknown" text="Neither Blix nor Jupiter knows who created this coin." /> : <Ghost />)}
        {tab === "ai" && <AiGate><AiView mint={mint} r={r} onRead={onPaper} /></AiGate>}
        {tab === "safety" && <SafetyView r={r} c={c} withMap={!sideTrades} />}
      </div>
    </div>
  );
}

const KEEP: Record<Filter, (x: Trades["trades"][number]) => boolean> = {
  all: () => true, dev: (x) => x.tag === "dev", sniper: (x) => x.tag === "sniper", bundle: (x) => x.tag === "bundle", top10: (x) => x.top10, followed: (x) => x.followed, big: (x) => (x.sol ?? 0) >= 1,
};
const useTradeFilter = () => {
  const [f, setFState] = useState<Filter>(() => store.get("coin:filter", "all"));
  return [f, (v: Filter) => { store.set("coin:filter", v); setFState(v); }] as const;
};

// The live trades beside the chart, as tall as it (Coin.tsx shows it when the page is wide enough): every trade
// as it lands, newest on top, with the same filters as the Trades tab. Narrow pages keep the Trades tab instead.
// Drawn the way Axiom's trade feed reads: a buy / sell pressure bar for the last 5 minutes on top, then one row per
// trade with a coloured edge for its side, a tint that grows with its size, the amount in bold, the market cap it
// traded at and who traded it (their role on this coin as a small tag). A trade that just landed lights up briefly.
const PILL = "h-6 shrink-0 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent";
const ROLE: Record<string, [string, string, string]> = {
  dev: ["DEV", "bg-warn/15 text-warn", "The coin's creator"], sniper: ["SNIPE", "bg-caution/15 text-caution", "Bought in the coin's first blocks"], bundle: ["BUNDLE", "bg-down/15 text-down", "Bought in the same transaction as the launch"],
};
type TradeRowData = Trades["trades"][number];
const tradeKey = (x: TradeRowData, i: number) => (x.tx ? `${x.tx}:${x.wallet}:${x.side}` : `${x.t}:${x.wallet}:${x.side}:${x.usd}:${i}`);

export function SideTrades({ trades }: { trades: Trades | null }) {
  const now = useNow();
  const [f, setF] = useTradeFilter();
  const list = trades?.trades.filter(KEEP[f]) ?? null;
  // Rows already shown: a row not seen before slides in as it lands (not on the first draw; no colour flash).
  const seen = useRef<Set<string> | null>(null);
  const shown = (list || []).slice(0, 150), keys = shown.map(tradeKey);
  const fresh = new Set<string>();
  if (list) {
    if (seen.current) for (const k of keys) if (!seen.current.has(k)) fresh.add(k);
    seen.current = new Set(keys);
  }
  // Buy and sell pressure: dollars and trades each way in the last 5 minutes (every trade, whatever the filter).
  let buy = 0, sell = 0, nBuy = 0, nSell = 0;
  for (const x of trades?.trades || []) if (now - x.t <= 300_000) { if (x.side === "buy") { buy += x.usd || 0; nBuy++; } else { sell += x.usd || 0; nSell++; } }
  const flow = buy + sell, buyPct = flow ? Math.round((buy / flow) * 100) : 50;
  const big = Math.max(1, ...shown.map((x) => x.usd || 0));
  return (
    <div className="relative w-[340px] shrink-0 bg-paper-2/40 max-2xl:w-[290px] max-xl:w-[264px]">
      <div className="absolute inset-0 flex flex-col">
        <div className="flex flex-col gap-3 px-3.5 pt-3 pb-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className="text-md font-semibold text-ink">Trades</span>
              {trades?.source === "live" && <i aria-label="Live" className="relative flex size-1.5"><i className="absolute inset-0 animate-ping rounded-full bg-up/60" /><i className="relative size-1.5 rounded-full bg-up" /></i>}
            </span>
            <span className="rounded-full bg-paper-3 px-2 py-0.5 text-2xs font-semibold text-muted">{trades?.source === "live" ? "Live feed" : trades?.source === "pool" ? "Pool trades" : "5m"}</span>
          </div>
          {flow > 0 && (
            <div className="flex flex-col gap-1.5" title="Dollars bought vs sold in the last 5 minutes">
              <div className="num flex items-end justify-between text-xs">
                <span className="flex flex-col"><b className="text-md font-semibold text-up">{usdK(buy)}</b><span className="text-muted">{nBuy} buys</span></span>
                <span className="mb-0.5 rounded bg-paper-3 px-1.5 text-2xs font-semibold text-muted">5m</span>
                <span className="flex flex-col items-end"><b className="text-md font-semibold text-down">{usdK(sell)}</b><span className="text-muted">{nSell} sells</span></span>
              </div>
              <div className="flex h-1 gap-0.5">
                <i className="block h-full rounded-full bg-up transition-[width] duration-500" style={{ width: `${buyPct}%` }} />
                <i className="block h-full flex-1 rounded-full bg-down" />
              </div>
            </div>
          )}
        </div>
        <div className="relative border-y border-rule">
          <div className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
            {FILTERS.map(([k, l]) => (
              <button key={k} onClick={() => setF(k)} aria-pressed={f === k}
                className={cn(PILL, f === k ? "bg-paper-5 text-ink shadow-[inset_0_0_0_1px_oklch(100%_0_0/0.08)]" : "text-muted hover:bg-paper-3 hover:text-ink-2")}>{l}</button>
            ))}
          </div>
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-paper-2 to-transparent" />
        </div>
        <div className="grid grid-cols-[30px_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.5fr)] gap-2 border-b border-rule bg-paper-2 px-3.5 py-1.5 text-2xs font-semibold tracking-[0.06em] text-muted uppercase">
          <span>Age</span><span className="text-right">MC</span><span className="text-right">Amount</span><span className="pl-1">Trader</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)] [scrollbar-width:thin]">
          {!trades ? <Ghost />
            : !trades.trades.length ? <Empty title="No trades yet" text={trades.note} />
            : !list?.length ? <Empty title="No trades match this filter" text="Try All." />
            : shown.map((x, i) => <TradeRow key={keys[i]} x={x} now={now} share={(x.usd || 0) / big} fresh={fresh.has(keys[i])} />)}
        </div>
      </div>
    </div>
  );
}

// A wallet's colour: the same few hues every time for the same wallet, so a repeat trader is easy to spot.
const HUES = [25, 60, 150, 195, 230, 270, 310, 350];
const hueOf = (w: string) => { let h = 0; for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) | 0; return HUES[Math.abs(h) % HUES.length]; };

function TradeRow({ x, now, share, fresh }: { x: TradeRowData; now: number; share: number; fresh: boolean }) {
  const buy = x.side === "buy", usd = x.usd || 0;
  const role = x.tag ? ROLE[x.tag] : null, whale = usd >= 1000;
  const tip = `${buy ? "Buy" : "Sell"} · $${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}${x.sol != null ? ` · ${x.sol.toFixed(3)} SOL` : ""} · ${tokN(x.tokens)} tokens${x.mcUsd ? ` · at ${usdK(x.mcUsd)} MC` : ""}`;
  return (
    <div title={tip} className={cn("group relative grid h-[30px] grid-cols-[30px_minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.5fr)] items-center gap-2 px-3.5 hover:bg-paper-3/60", fresh && "animate-row-in")}>
      {/* The trade's size as a soft bar from the right (its share of the biggest in view). */}
      <i aria-hidden className={cn("pointer-events-none absolute inset-y-[3px] right-0 rounded-l-[3px]", buy ? "bg-up/[0.09]" : "bg-down/[0.09]", whale && (buy ? "bg-up/[0.16]" : "bg-down/[0.16]"))} style={{ width: `${Math.max(2, Math.min(100, share * 100))}%` }} />
      <span className="num relative text-xs text-muted">{ageStr(now - x.t)}</span>
      <span className="num relative truncate text-right text-sm text-ink-2">{usdK(x.mcUsd)}</span>
      <span className={cn("num relative truncate text-right text-sm", buy ? "text-up" : "text-down", whale ? "font-bold" : "font-semibold")}>{buy ? "+" : "−"}{usdK(usd)}</span>
      <span className="relative flex min-w-0 items-center gap-1.5 pl-1">
        {x.wallet
          ? <>
              <i aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: `oklch(72% 0.13 ${hueOf(x.wallet)})` }} />
              <a href={`https://solscan.io/account/${x.wallet}`} target="_blank" rel="noreferrer" title={x.wallet} className="truncate font-outlier text-xs text-ink-2 hover:text-ink hover:underline">{x.wallet.slice(0, 4)}…{x.wallet.slice(-4)}</a>
            </>
          : <span className="text-xs text-muted">—</span>}
        {role && <i title={role[2]} className={cn("shrink-0 rounded px-1 text-[0.58rem] leading-4 font-bold not-italic tracking-wide", role[1])}>{role[0]}</i>}
        {x.top10 && <i title="One of the 10 biggest holders" className="shrink-0 rounded bg-accent/15 px-1 text-[0.58rem] leading-4 font-bold not-italic tracking-wide text-accent">TOP10</i>}
        {x.followed && <i title={x.label || "A wallet you follow"} className="max-w-16 shrink-0 truncate rounded bg-up/15 px-1 text-[0.58rem] leading-4 font-bold not-italic tracking-wide text-up">{x.label || "FOLLOW"}</i>}
      </span>
    </div>
  );
}

function TradesTab({ trades }: { trades: Trades | null }) {
  const now = useNow();
  const [f, setF] = useTradeFilter();
  if (!trades) return <Ghost />;
  const list = trades.trades.filter(KEEP[f]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-rule px-3 py-2">
        {FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setF(k)} className={cn("h-6 rounded-chip border px-2 text-xs font-semibold", f === k ? "border-accent bg-accent/15 text-ink" : "border-rule text-muted hover:text-ink")}>{l}</button>
        ))}
        <span className="ml-auto text-xs text-muted">{trades.source === "live" ? "live trade feed" : trades.source === "pool" ? `pool trades · ${/GeckoTerminal/.test(trades.note || "") ? "GeckoTerminal" : "Jupiter"}` : ""}</span>
      </div>
      {!trades.trades.length ? <Empty title="No trades yet" text={trades.note} />
        : !list.length ? <Empty title="No trades match this filter" text="Try All." />
        : (
          <div className="max-h-[560px] overflow-auto">
            <table className="num w-full border-collapse text-md">
              <thead><tr><th className={th}>Age</th><th className={th}>Type</th><th className={cn(th, "text-right")}>MC</th><th className={cn(th, "text-right")}>Amount</th><th className={cn(th, "text-right")}>Total</th><th className={th}>Trader</th></tr></thead>
              <tbody>
                {list.slice(0, 150).map((x, i) => (
                  <tr key={`${x.t}:${x.wallet}:${i}`} className="hover:bg-paper-3">
                    <td className={cn(td, "text-muted")}>{ageStr(now - x.t)}</td>
                    <td className={cn(td, "font-semibold", x.side === "buy" ? "text-up" : "text-down")}>{x.side === "buy" ? "Buy" : "Sell"}</td>
                    <td className={cn(td, "text-right")}>{usdK(x.mcUsd)}</td>
                    <td className={cn(td, "text-right")}>{tokN(x.tokens)}</td>
                    <td className={cn(td, "text-right", x.side === "buy" ? "text-up" : "text-down")}>{usdK(x.usd)} <SolAmt v={x.sol} className="ml-1 text-muted" /></td>
                    <td className={td}><Who wallet={x.wallet} x={x} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}

// The table's shape while its first rows are on their way (well under a second): no words, nothing that says
// "loading", just the rows' outline, so the tab never looks empty or stuck.
function Ghost() {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-rule px-4 py-3" style={{ opacity: 1 - i * 0.1 }}>
          <span className="size-6 shrink-0 rounded-full bg-paper-3" />
          <span className="h-3 w-28 rounded bg-paper-3" />
          <span className="ml-auto h-3 w-16 rounded bg-paper-3" />
          <span className="h-3 w-20 rounded bg-paper-3" />
          <span className="h-3 w-14 rounded bg-paper-3" />
        </div>
      ))}
    </div>
  );
}
