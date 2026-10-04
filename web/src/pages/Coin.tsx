// The full coin page (#/coin/<mint>), laid out like Axiom's token page: the header with live figures,
// the candle chart with the dev's, snipers', bundles' and followed wallets' trades marked, tabs under
// it, and a trading column on the right. main.tsx loads this lazily; keep the export and the prop.
// Data: /api/token/<mint> every 15 s, /api/coin/<mint> every 2 s, /api/coin/<mint>/trades every 1.5 s.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { usePoll, type CoinData, type TokenDetail, type Trades } from "@/lib/coin";
import { CoinChart, type Mark } from "./coin/Chart";
import { CoinHeader } from "./coin/Header";
import { Addresses, Flow, Info, Links, Position, TradePanel } from "./coin/Side";
import { CoinTabs } from "./coin/Tabs";
import { Empty } from "./coin/parts";

const MARK: Record<string, string> = { dev: "D", sniper: "S", bundle: "B" };

export function Coin({ mint }: { mint: string }) {
  const token = usePoll<TokenDetail>(`token/${mint}`, 15_000);
  const coin = usePoll<CoinData>(`coin/${mint}`, 2_000);
  const trades = usePoll<Trades>(`coin/${mint}/trades?limit=150`, 1_500);
  const [sizes, setSizes] = useState<number[]>([0.1, 0.25, 0.5, 1]);
  useEffect(() => { api<{ sizes?: number[] }>("paper").then((d) => d.sizes?.length && setSizes(d.sizes)).catch(() => {}); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [mint]);

  // Every tagged trade seen while the page is open becomes a chart marker (kept, not just the last 150).
  const seen = useRef<{ mint: string; map: Map<string, Mark> }>({ mint, map: new Map() });
  if (seen.current.mint !== mint) seen.current = { mint, map: new Map() };
  const marks = useMemo(() => {
    const map = seen.current.map;
    for (const x of trades.data?.trades || []) {
      const tag = x.tag ? MARK[x.tag] : null;
      if (!tag && !x.followed) continue;
      // A followed wallet shows its label's first letters, or a bare dot (a busy coin has dozens).
      const text = tag ? `${tag}${x.side === "buy" ? "B" : "S"}` : x.label ? x.label.slice(0, 3) : "";
      const id = `${x.t}:${x.wallet}:${x.side}`;
      if (!map.has(id)) map.set(id, { t: x.t, buy: x.side === "buy", text });
    }
    return [...map.values()].sort((a, b) => a.t - b.t).slice(-200);
  }, [trades.data]);

  const r = token.data;
  if (!r) {
    return token.error
      ? <div className="p-3"><div className="surface"><Empty title="Couldn't load this coin" text={token.error} /></div></div>
      : <div className="p-3"><div className="surface h-24 animate-pulse" /></div>;
  }
  const c = coin.data;
  const symbol = r.token.symbol || "?";
  // A coin in its first half hour opens on 1s candles, one still on the curve on 15s, everything else on 1m.
  const age = Date.now() - (r.token.first_seen || Date.now());
  const defaultTf = !r.token.graduated && age < 30 * 60_000 ? 1 : !r.token.graduated && age < 3 * 3600e3 ? 15 : 60;
  const refresh = () => { token.refresh(); coin.refresh(); };
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
          <CoinChart mint={mint} marks={marks} paper={r.paper} signals={r.signals} defaultTf={defaultTf} />
          <CoinTabs mint={mint} r={r} c={c} trades={trades.data} onPaper={refresh} />
        </section>
        <aside className="sticky top-3 flex min-w-0 flex-col gap-2.5 max-lg:static">
          <Flow c={c} />
          <TradePanel mint={mint} symbol={symbol} r={r} onDone={refresh} />
          <Position r={r} />
          <Info r={r} c={c} />
          <Addresses r={r} c={c} />
          <Links r={r} />
        </aside>
      </div>
    </div>
  );
}
