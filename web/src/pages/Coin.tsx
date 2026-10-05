// The full coin page (#/coin/<mint>), laid out like Axiom's token page: the header with live figures,
// the candle chart with the dev's, snipers', bundles' and followed wallets' trades marked and your average
// buy and sell drawn across it, tabs under it, a trading column on the right, and the floating instant trade
// panel (one-click presets). main.tsx loads this lazily; keep the export and the prop.
// Data: /api/token/<mint> every 15 s, /api/coin/<mint> every 2 s, /api/coin/<mint>/trades every 1.5 s.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { usePoll, type CoinData, type TokenDetail, type Trades } from "@/lib/coin";
import { CoinChart, type ChartEvent, type Level, type Mark } from "./coin/Chart";
import { CoinHeader } from "./coin/Header";
import { usePosition } from "./coin/position";
import { QuickTrade } from "./coin/QuickTrade";
import { Addresses, Flow, Info, Links, Position, TradePanel } from "./coin/Side";
import { CoinTabs } from "./coin/Tabs";
import { Empty } from "./coin/parts";

// DexScreener order types, as the chart's pills say them.
const ORDER: Record<string, [string, string]> = {
  tokenProfile: ["DEX PAID", "DEX paid: the token's DexScreener profile was paid for"],
  communityTakeover: ["CTO", "Community takeover approved on DexScreener"],
  tokenAd: ["AD", "DexScreener ad paid"],
  trendingBarAd: ["AD", "DexScreener trending bar ad paid"],
};

const MIGRATE_MC_SOL = 410.9;   // pump.fun market cap at migration, in SOL (see the levels below)

export function Coin({ mint }: { mint: string }) {
  const token = usePoll<TokenDetail>(`token/${mint}`, 15_000);
  const coin = usePoll<CoinData>(`coin/${mint}`, 2_000);
  const trades = usePoll<Trades>(`coin/${mint}/trades?limit=150`, 1_500);
  // Trades of $1,000+ over the whole history, for the chart's big-trade bubbles.
  const big = usePoll<Trades>(`coin/${mint}/big`, 60_000);
  const [sizes, setSizes] = useState<number[]>([0.1, 0.25, 0.5, 1]);
  useEffect(() => { api<{ sizes?: number[] }>("paper").then((d) => d.sizes?.length && setSizes(d.sizes)).catch(() => {}); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [mint]);
  const pos = usePosition(mint, token.data, coin.data);

  // Every tagged trade becomes a chart icon: the server's ring of them (from before the page opened) plus
  // each one seen in the trade list while it is open (bonded coins' pool trades too). Kept, not just the last 150.
  const seen = useRef<{ mint: string; map: Map<string, Mark> }>({ mint, map: new Map() });
  if (seen.current.mint !== mint) seen.current = { mint, map: new Map() };
  const marks = useMemo(() => {
    const map = seen.current.map;
    const add = (x: { t: number; side: "buy" | "sell"; wallet: string | null; tag: string | null; followed: boolean; label: string | null; sol: number | null; mcUsd: number | null; usd?: number | null }) => {
      // A followed wallet is the more useful name when it is also a sniper or bundler; the dev stays the dev.
      // Anyone else's trade of $1,000 or more is a big-trade bubble, like Fomo's chart.
      const kind = x.tag === "dev" ? "dev" : x.followed ? "tracked" : x.tag === "sniper" || x.tag === "bundle" ? x.tag : (x.usd ?? 0) >= 1000 ? "whale" : null;
      if (!kind) return;
      const id = `${x.t}:${x.wallet}:${x.side}`;
      if (!map.has(id)) map.set(id, { t: x.t, buy: x.side === "buy", kind, label: x.label, sol: x.sol, mc: x.mcUsd, usd: x.usd ?? null });
    };
    for (const x of coin.data?.marks || []) add(x);
    for (const x of trades.data?.trades || []) add(x);
    for (const x of big.data?.trades || []) add(x);
    return [...map.values()].sort((a, b) => a.t - b.t).slice(-600);
  }, [trades.data, big.data, coin.data?.marks]);
  const paid = coin.data?.paid;
  const events = useMemo<ChartEvent[]>(() => {
    if (!paid) return [];
    const out: ChartEvent[] = paid.orders.map((o) => {
      const [text, tip] = ORDER[o.type] || [o.type.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase(), `DexScreener order: ${o.type}`];
      return { t: o.t, text, tone: "info" as const, tip: o.status === "approved" ? tip : `${tip} (${o.status})` };
    });
    for (const b of paid.boosts) out.push({ t: b.t, text: `\u26A1${b.amount ?? ""}`, tone: "warn", tip: `${b.amount ?? "?"} DexScreener boosts bought` });
    return out;
  }, [paid]);

  const r = token.data;
  if (!r) {
    return token.error
      ? <div className="p-3"><div className="surface"><Empty title="Couldn't load this coin" text={token.error} /></div></div>
      : <div className="p-3"><div className="surface h-24 animate-pulse" /></div>;
  }
  const c = coin.data;
  const symbol = r.token.symbol || "?";
  // A coin in its first half hour opens on 1s candles, one still on the curve on 15s, everything else on 1m.
  // Its real launch time when Jupiter knows it: a coin Blix only found today can be weeks old (and quiet).
  const born = c?.created ? (typeof c.created === "number" ? c.created : Date.parse(String(c.created))) : NaN;
  const age = Date.now() - (Number.isFinite(born) ? born : r.token.first_seen || Date.now());
  const defaultTf = !r.token.graduated && age < 30 * 60_000 ? 1 : !r.token.graduated && age < 3 * 3600e3 ? 15 : 60;
  const refresh = () => { token.refresh(); coin.refresh(); };
  const levels: Level[] = pos.has ? [{ price: pos.entry || 0, buy: true, title: "Avg buy" }, { price: pos.exit || 0, buy: false, title: "Avg sell" }] : [];
  // pump.fun moves a coin to its pool when 793.1M tokens have sold off the curve (30 virtual SOL against 1.073B
  // virtual tokens at launch): the curve then holds 115 virtual SOL against 279.9M tokens, a 410.9 SOL market cap.
  if (c?.onCurve && c.solUsd && (mint.endsWith("pump") || /pump/i.test(c.audit?.launchpad || ""))) levels.push({ price: MIGRATE_MC_SOL * c.solUsd, buy: true, title: "Migration", migrate: true });
  const warn: [boolean, string][] = [];
  const f = r.token.fresh;
  if (r.untracked) warn.push([false, "Not tracked yet: live trade feed only. Safety, holder history and price history appear once Blix tracks it."]);
  // "dead" is the radar's tracking status; a coin it stopped watching can still trade, so only without a live price.
  if (f?.dead && !(c?.priceAgeMs != null && c.priceAgeMs < 5 * 60_000)) warn.push([true, "This coin is dead. The price shown is the last one read, not a live quote."]);
  if (f?.quarantine || f?.illiquid) warn.push([true, `The price shown cannot be traded at: ${f.exitWhy || f.quarantine}.`]);

  return (
    <div className="flex min-w-0 flex-col gap-2.5 p-3 max-md:pb-20">
      <CoinHeader r={r} c={c} sizes={sizes} onPaper={refresh} />
      {warn.map(([bad, text]) => <p key={text} className={bad ? "rounded-control border border-down/50 bg-down/10 px-3 py-2 text-sm text-ink-2" : "rounded-control border border-rule-2 bg-paper-3 px-3 py-2 text-sm text-ink-2"}>{text}</p>)}
      <div className="grid items-start gap-2.5 grid-cols-[minmax(0,1fr)_340px] max-xl:grid-cols-[minmax(0,1fr)_300px] max-lg:grid-cols-1">
        <section className="surface min-w-0 overflow-hidden">
          <CoinChart mint={mint} marks={marks} events={events} paper={pos.paper ? r.paper : undefined} signals={r.signals} levels={levels} defaultTf={defaultTf} />
          <CoinTabs mint={mint} r={r} c={c} trades={trades.data} onPaper={refresh} />
        </section>
        <aside className="sticky top-3 flex min-w-0 flex-col gap-2.5 max-lg:static">
          <QuickTrade docked mint={mint} symbol={symbol} sizes={sizes} pos={pos} onDone={refresh} />
          <Flow c={c} />
          <TradePanel mint={mint} symbol={symbol} r={r} onDone={refresh} />
          <Position pos={pos} />
          <Info r={r} c={c} />
          <Addresses r={r} c={c} />
          <Links r={r} />
        </aside>
      </div>
      <QuickTrade mint={mint} symbol={symbol} sizes={sizes} pos={pos} onDone={refresh} />
    </div>
  );
}
