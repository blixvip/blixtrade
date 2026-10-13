// The full coin page (#/coin/<mint>), laid out like Axiom's token page: the header with live figures,
// the candle chart with the dev's, snipers', bundles' and followed wallets' trades marked and your average
// buy and sell drawn across it, tabs under it, a trading column on the right, and the floating instant trade
// panel (one-click presets). main.tsx loads this lazily; keep the export and the prop.
// Data: /api/token/<mint> every 15 s, /api/coin/<mint> every 3 s, /api/coin/<mint>/trades every 2 s, and from
// the stream, every trade the moment the radar reads it from the chain (`ctrade`) and the holder figures each
// time the chain changes them (`cholders`).
import { coinFlow, currentMetric, markHolder, type MarketWindows } from "@/lib/coin-numbers";
import { useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { useMetrics } from '@/lib/metrics';
import { useLivePrice, setPx } from '@/lib/livepx';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { loadPaperSizes } from "@/lib/mode";
import { usePoll, type CoinData, type TokenDetail, type Trade, type Trades } from "@/lib/coin";
import { onCoinRows, useCoinHolders, useCoinFlow, usePulse } from "@/lib/pulse";
import type { ChartEvent, ChartPeople, Level, Mark } from "./coin/Chart";
import { CoinHeader, InstantButton } from "./coin/Header";
import { usePosition } from "./coin/position";
import { QuickTrade } from "./coin/QuickTrade";
import { ResizeHandle, useSize } from "@/components/Resize";
import { setQuickCoin, useSideTrades } from "@/lib/quick";
import { Addresses, Flow, Info, Links, Position, TradePanel, About } from "./coin/Side";
import { CoinTabs, SideTrades } from "./coin/Tabs";
import { BubbleMapTab } from "./coin/BubbleMap";
import { Empty } from "./coin/parts";
import { ReplayBar } from "./coin/Replay";
import { useReplay } from "@/lib/replay";
import { BrandLoader, EmptyState } from "@/components/page";
import { migratingNow } from "@/components/Migrating";

// DexScreener order types, as the chart's pills say them.
const ORDER: Record<string, [string, string]> = {
  tokenProfile: ["DEX PAID", "DEX paid: the token's DexScreener profile was paid for"],
  communityTakeover: ["CTO", "Community takeover approved on DexScreener"],
  tokenAd: ["AD", "DexScreener ad paid"],
  trendingBarAd: ["AD", "DexScreener trending bar ad paid"],
};

// The chart is its own file with the charting library (~70 KB gz): the header, trades and trade panel draw while
// it arrives (index.html asks for it with the page, lib/coin.ts on hover). The space it takes is held meanwhile.
const CoinChart = lazy(() => import("./coin/Chart").then((m) => ({ default: m.CoinChart })));
const ChartSpace = () => <div className="flex flex-col gap-1.5 p-2.5" aria-hidden><div className="h-7" /><div className="h-[var(--chart-h,clamp(340px,52vh,760px))]" /></div>;

// The three-column page (chart | live trades and bubble map | trade panel) from this content width: every PC
// screen from 1366 px wide (and 1920 px at 125% scaling) gets it, the columns narrowing on smaller screens.
const WIDE = 1100;

const MIGRATE_MC_SOL = 410.9;   // pump.fun market cap at migration, in SOL (see the levels below)

const NO_INFO: CoinData["info"] = { holders: null, top10: null, devPct: null, snipers: null, bundle: null, insiders: null, lpLocked: null, safety: null, traders: null, source: null, checked: null };

export function Coin({ mint }: { mint: string }) {
  const metrics = useMetrics(mint), now = useNow();
  const chartPrice = useLivePrice(mint), streamedFlow = useCoinFlow(mint);
  const liveSolUsd = usePulse(s => s.live.solUsd);
  const market = usePoll<MarketWindows>(`jup/${mint}`, 5_000);
  const token = usePoll<TokenDetail>(`token/${mint}`, 15_000);
  // Every trade arrives on the stream the moment the radar reads it (ctrade, below); these reads fill in the rest.
  const coinPolled = usePoll<CoinData>(`coin/${mint}`, 3_000);
  const coinReadAt = useMemo(() => Date.now(), [coinPolled.data]);
  useEffect(() => {
    const c = coinPolled.data;
    if (!c || c.priceAgeMs == null || c.priceAgeMs < 0 || c.priceAgeMs >= 30_000 || !(c.mcUsd! > 0) || useReplay.getState().mint === mint) return;
    setPx([[mint, c.mcUsd!, c.supply]], false, true, coinReadAt - c.priceAgeMs);
  }, [coinPolled.data, coinReadAt, mint]);
  // Read every 2 s: a bonded coin's pool trades come only from this read (Jupiter's list, the chain's rows on top),
  // and trades the radar recovers late from a block land here, not on the stream.
  const polled = usePoll<Trades>(`coin/${mint}/trades?limit=150`, 2_000);
  // Trades pushed by the stream as the radar reads them, newest first, applied once a frame.
  const [pushed, setPushed] = useState<{ mint: string; rows: Trade[] }>({ mint, rows: [] });
  // A replay jump (lib/replay.ts) starts the pushed list over: rows from after the new moment must go.
  const replayEpoch = useReplay((st) => (st.mint === mint ? st.epoch : 0));
  useEffect(() => {
    setPushed({ mint, rows: [] });
    // Rows landing in a burst (a replay at speed, a busy launch) reach the list a few times a second, not once a
    // frame: each landing re-renders the list.
    let timer = 0, wait: Trade[] = [], flushed = 0;
    const un = onCoinRows(mint, (rows) => {
      wait.push(...rows);
      if (!timer) timer = window.setTimeout(() => { timer = 0; flushed = performance.now(); const add = wait.reverse(); wait = []; setPushed((s) => ({ mint, rows: [...add, ...(s.mint === mint ? s.rows : [])].slice(0, 300) })); }, Math.max(0, 200 - (performance.now() - flushed)));
    });
    return () => { un(); clearTimeout(timer); };
  }, [mint, replayEpoch]);
  // Every trade with a signature that any read brought is kept while the page is open, so a read that comes back
  // short or empty (a pool source answering with nothing for a while) never takes rows off the list.
  const held = useRef<{ key: string; rows: Map<string, Trade> }>({ key: "", rows: new Map() });
  // The list: the kept rows (a transaction Jupiter has indexed shows as it lists it, every leg exact), the latest
  // read's rows without a signature, and the pushed rows of transactions not in either yet.
  const trades = useMemo(() => {
    const key = `${mint}:${replayEpoch}`;
    if (held.current.key !== key) held.current = { key, rows: new Map() };
    const h = held.current.rows, p = polled.data?.mint === mint || !polled.data?.mint ? polled.data : null;
    const leg = (x: Trade) => `${x.tx}:${x.side}:${x.tokens ?? ""}:${x.wallet ?? ""}`;
    for (const x of p?.trades || []) if (x.tx) h.set(leg(x), x);
    if (h.size > 400) [...h.entries()].sort((a, b) => a[1].t - b[1].t).slice(0, h.size - 300).forEach(([k]) => h.delete(k));
    const kept = [...h.values()], untagged = (p?.trades || []).filter((x) => !x.tx);
    const seen = new Set(kept.map((x) => x.tx));
    const newest = kept.reduce((m, x) => Math.max(m, x.t), 0);
    const rows = pushed.mint === mint ? pushed.rows : [];
    const fresh = rows.filter((x) => (x.tx ? !seen.has(x.tx) : x.t > newest));
    const list = [...fresh, ...kept, ...untagged].sort((a, b) => b.t - a.t).slice(0, 150);
    if (!p && !list.length) return polled;
    return { ...polled, data: { mint, source: p?.source ?? "live", note: p?.note, ...p, trades: list } as Trades };
  }, [polled, pushed, mint, replayEpoch]);
  // Holder figures from the chain the moment they change, over the polled ones.
  // (Not in a replay: the chain's holder figures are today's, the replay's come from its own ledger.)
  const liveHolders = useCoinHolders(mint), liveH = replayEpoch ? null : liveHolders;
  const coin = useMemo(() => {
    // A partial answer (no `info`: a coin the server could not read yet) must not take the page down.
    const raw = coinPolled.data;
    let d = raw && !raw.info ? { ...raw, info: NO_INFO } : raw;
    if (d && !replayEpoch) {
      const priceAt = d.priceAgeMs == null ? 0 : coinReadAt - d.priceAgeMs;
      const price = currentMetric(metrics, 'mc', now, priceAt);
      const holderAt = Math.max(d.info.checked ?? 0, d.holders?.last ?? 0);
      const holder = (key: string, fallback: number | null) => currentMetric(metrics, key, now, holderAt)?.value ?? fallback;
      const freshChart = chartPrice && chartPrice.t >= Math.max(priceAt, price?.observedAt ?? 0) && now - chartPrice.t < 30_000 ? chartPrice : null;
      const mc = freshChart?.mc ?? price?.value ?? d.mcUsd, priceUsd = mc != null && d.supply > 0 ? mc / d.supply : d.priceUsd;
      const markedAt = freshChart?.t ?? price?.observedAt ?? priceAt;
      const age = markedAt ? Math.max(0, now - markedAt) : d.priceAgeMs;
      const solUsd = liveSolUsd && Number.isFinite(liveSolUsd) && liveSolUsd > 0 ? liveSolUsd : d.solUsd;
      const mark = (h: CoinData['traders'][number]) => markHolder(h, priceUsd, solUsd, d!.supply, age);
      d = { ...d, mcUsd: mc, priceUsd, solUsd, priceAgeMs: age,
        m5: coinFlow(d.m5, market.data, now, !d.onCurve, streamedFlow),
        info: { ...d.info, holders: holder('holders', d.info.holders), top10: holder('top10', d.info.top10), devPct: holder('dev', d.info.devPct) },
        holders: d.holders ? { ...d.holders, list: d.holders.list.map(mark) } : d.holders,
        traders: (d.traders || []).map(mark), early: (d.early || []).map(mark) };
      // Delayed holder events must not pin a newer poll/metric to an older reading.
      if (liveH && liveH.t >= holderAt && now - liveH.t <= 30_000) {
        const value = (key: string, next: number | null, fallback: number | null) => next != null && liveH.t >= (currentMetric(metrics, key, now, holderAt)?.observedAt ?? 0) ? next : fallback;
        d = { ...d, info: { ...d.info, holders: value('holders', liveH.holders, d.info.holders), top10: value('top10', liveH.top10, d.info.top10), devPct: value('dev', liveH.devPct, d.info.devPct) } };
      }
    }
    return d === raw ? coinPolled : { ...coinPolled, data: d };
  }, [coinPolled, coinReadAt, liveH, metrics, market.data, replayEpoch, now, chartPrice, streamedFlow, liveSolUsd]);
  // Trades of $1,000+ over the whole history, for the chart's big-trade bubbles.
  const big = usePoll<Trades>(`coin/${mint}/big`, 60_000);
  // Faces on the chart: pump.fun accounts and Fomo traders who traded or called this coin.
  const people = usePoll<ChartPeople>(`coin/${mint}/people`, 5_000);
  // A replay starting or jumping (lib/replay.ts): every read answered as of the new moment at once, not on its next turn.
  useEffect(() => { if (replayEpoch) { token.refresh(); coinPolled.refresh(); polled.refresh(); big.refresh(); people.refresh(); } }, [replayEpoch]);   // eslint-disable-line react-hooks/exhaustive-deps
  // More of the replayed day arrived (Fomo's history, who made the older trades): the figures built from it again.
  const replayRev = useReplay((st) => (st.mint === mint ? st.rev : 0));
  useEffect(() => { if (replayRev) { coinPolled.refresh(); polled.refresh(); people.refresh(); } }, [replayRev]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [sizes, setSizes] = useState<number[]>([0.1, 0.25, 0.5, 1]);
  useEffect(() => { loadPaperSizes().then((s) => s && setSizes(s)); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [mint]);
  const pos = usePosition(mint, token.data, coin.data);
  // The floating quick trade window keeps this coin when you move on to Pulse or any other page.
  const sym = token.data?.token?.symbol;
  useEffect(() => { if (sym) setQuickCoin({ mint, symbol: sym }); }, [mint, sym]);
  // The live trades go beside the chart when the main column has room for both (a chart under ~720 px is cramped).
  // ... and when the trades column is switched on (the button beside Instant Trade, lib/quick.ts).
  const [roomy, setRoomy] = useState(false);
  const tradesOn = useSideTrades((s) => s.on), wide = roomy && tradesOn;
  const ro = useRef<ResizeObserver | null>(null);
  const mainRef = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect(); ro.current = null;
    if (!el) return;
    ro.current = new ResizeObserver(([e]) => setRoomy(e.contentRect.width >= WIDE));
    ro.current.observe(el);
  }, []);
  // The wide trade list runs from the top of the page down to the line under the tab bar (Known holders …
  // Instant Trade), not to the foot of the tall trade column: measured, as that bar moves with the chart.
  const tabsRef = useRef<HTMLElement>(null), tradesRef = useRef<HTMLDivElement>(null);
  // Drag to resize (components/Resize.tsx): the trade column's width, the live trades column's width, the chart's
  // height. Kept in this browser; double-click a handle for the page's own size again.
  const [asideW, setAsideW] = useSize("coin:aside", 260, 620);
  const [tradesW, setTradesW] = useSize("coin:trades", 220, 560);
  const [chartH, setChartH] = useSize("coin:chart", 260, 1400);
  const asideRef = useRef<HTMLElement>(null), tradesColRef = useRef<HTMLDivElement>(null), chartRef = useRef<HTMLElement>(null);
  const sizeVars = { ...(asideW ? { "--cw-aside": `${asideW}px` } : {}), ...(tradesW ? { "--cw-trades": `${tradesW}px` } : {}), ...(chartH ? { "--chart-h": `${chartH}px` } : {}) } as CSSProperties;
  const [tradesH, setTradesH] = useState<number | undefined>();
  useEffect(() => {
    const sec = tabsRef.current, tr = tradesRef.current;
    if (!wide || !sec || !tr) return;
    const fit = () => {
      const bar = sec.querySelector('[role="tablist"]')?.parentElement;
      if (bar) setTradesH(Math.round(bar.getBoundingClientRect().bottom - tr.getBoundingClientRect().top));
    };
    const obs = new ResizeObserver(fit);
    // Every other box in the grid: the tall trade column fixes the grid's height, so the chart growing moves the bar without resizing it.
    const col = tr.parentElement;
    for (const el of Array.from(col?.parentElement?.children || [])) if (el !== col) obs.observe(el);
    fit();
    return () => obs.disconnect();
  }, [wide, !!token.data?.token]);

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

  // An answer without the token (an edge error body, a coin not yet known) shows as still loading, not a crash.
  const r = token.data?.token ? token.data : null;
  // An address that cannot be a coin (a typo, a broken link) says so, with no pump.fun link or retry that cannot help.
  const validMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint);
  if (!r && !validMint) {
    return <div className="grid h-[calc(100dvh-140px)] place-items-center p-3"><div><EmptyState icon="search" title="That isn't a coin address" hint="Solana coin addresses are 32 to 44 letters and numbers. Check the link or paste the address again." action={{ label: "Go to Discover", onClick: () => { location.hash = "#/coins"; } }} /></div></div>;
  }
  if (!r) {
    return token.error
      ? <div className="grid h-[calc(100dvh-140px)] place-items-center p-3"><div><EmptyState icon="search" title="Couldn't load this coin" hint="Blix hasn’t indexed this token yet, or its market data is unavailable." action={{ label: location.hash.endsWith('/feed') ? "Back to Feed" : "Go back", onClick: () => { if (location.hash.endsWith('/feed')) location.hash = '#/feed'; else if (history.length > 1) history.back(); else location.hash = '#/coins'; } }} /><button onClick={token.refresh} className="mx-auto mt-3 block text-sm text-muted hover:text-ink">Try again</button></div></div>
      : <div className="grid h-[calc(100dvh-140px)] place-items-center p-3"><BrandLoader label="Loading coin" /></div>;
  }
  const c = coin.data;
  const symbol = r.token.symbol || "?";
  // A coin in its first half hour opens on 1s candles, one still on the curve on 15s, everything else on 1m.
  // Its real launch time when Jupiter knows it: a coin Blix only found today can be weeks old (and quiet).
  const born = c?.created ? (typeof c.created === "number" ? c.created : Date.parse(String(c.created))) : NaN;
  const age = Date.now() - (Number.isFinite(born) ? born : r.token.first_seen || Date.now());
  // When a pump.fun coin moved to its pool: its PumpSwap pair is made at migration.
  const migratedAt = r.token.graduated && r.token.pair_created && (r.token.dex === "pumpswap" || mint.endsWith("pump")) ? r.token.pair_created : null;
  const defaultTf = !r.token.graduated && age < 30 * 60_000 ? 1 : !r.token.graduated && age < 3 * 3600e3 ? 15 : 60;
  const refresh = () => { token.refresh(); coin.refresh(); };
  const levels: Level[] = pos.has ? [{ price: pos.entry || 0, buy: true, title: "Avg buy" }, { price: pos.exit || 0, buy: false, title: "Avg sell" }] : [];
  // pump.fun moves a coin to its pool when 793.1M tokens have sold off the curve (30 virtual SOL against 1.073B
  // virtual tokens at launch): the curve then holds 115 virtual SOL against 279.9M tokens, a 410.9 SOL market cap.
  if (c?.onCurve && c.solUsd && (mint.endsWith("pump") || /pump/i.test(c.audit?.launchpad || ""))) levels.push({ price: MIGRATE_MC_SOL * c.solUsd, buy: true, title: "Migration", migrate: true });
  const warn: [boolean, string][] = [];
  const f = r.token.fresh;
  if (r.untracked) warn.push([false, "Blix just started tracking this coin from its live trades. Its safety read, holder ledger and price history fill in over the next minute."]);
  // "dead" is the radar's tracking status; a coin it stopped watching can still trade, so only without a live price.
  if (f?.dead && !(c?.priceAgeMs != null && c.priceAgeMs < 5 * 60_000)) warn.push([true, "This coin is dead. The price shown is the last one read, not a live quote."]);
  if (f?.quarantine || f?.illiquid) warn.push([true, `The price shown cannot be traded at: ${f.exitWhy || f.quarantine}.`]);

  return (
    <div className="flex min-w-0 flex-col p-3 max-md:pb-20">
      {/* The header, chart and tabs on the left; the live trades (wide) run down to the tab bar with the coin's live
          bubble map under them, filling the rest of that column; the trade column from the top of the page. */}
      <div ref={mainRef} style={sizeVars} className={cn("grid items-start gap-2.5 lg:grid-rows-[auto_1fr] grid-cols-[minmax(0,1fr)_var(--cw-aside,340px)] max-xl:grid-cols-[minmax(0,1fr)_var(--cw-aside,300px)] max-lg:grid-cols-1", wide && "grid-cols-[minmax(0,1fr)_var(--cw-trades,340px)_var(--cw-aside,340px)] max-2xl:grid-cols-[minmax(0,1fr)_var(--cw-trades,290px)_var(--cw-aside,310px)] max-xl:grid-cols-[minmax(0,1fr)_var(--cw-trades,264px)_var(--cw-aside,290px)]")}>
        <div className="flex min-w-0 flex-col gap-2.5 lg:col-start-1 lg:row-start-1">
          <CoinHeader r={r} c={c} sizes={sizes} onPaper={refresh} />
          {warn.map(([bad, text]) => <p key={text} className={bad ? "rounded-control border border-down/50 bg-down/10 px-3 py-2 text-sm text-ink-2" : "rounded-control border border-rule-2 bg-paper-3 px-3 py-2 text-sm text-ink-2"}>{text}</p>)}
          <section ref={chartRef} className="surface relative min-w-0 overflow-visible [&>*]:rounded-[inherit]">
            <ResizeHandle axis="y" label="Chart height" className="-bottom-[9px]" start={() => chartRef.current?.querySelector<HTMLElement>("[data-coin-chart]")?.offsetHeight || 500}
              onSize={(v) => setChartH(v, false)} onDone={() => setChartH(chartH)} onReset={() => setChartH(null)} />
            <ReplayBar mint={mint} symbol={symbol} onTick={() => { refresh(); polled.refresh(); big.refresh(); people.refresh(); }} />
            <Suspense fallback={<ChartSpace />}><CoinChart mint={mint} exact={Boolean(r.token.asset_class && r.token.asset_class !== "meme")} marks={marks} people={people.data} events={events} paper={pos.paper ? r.paper : pos.trades} ownPaper={pos.paper} signals={r.signals} levels={levels} defaultTf={defaultTf} migrated={migratedAt} migrating={migratingNow(c?.migrating?.since)} born={Number.isFinite(born) ? born : r.token.first_seen || null} /></Suspense>
          </section>
        </div>
        {wide && (
          <div ref={tradesColRef} className="relative col-start-2 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col gap-2.5 self-stretch">
            <ResizeHandle axis="x" dir={-1} label="Trades width" className="-left-[10px]" start={() => tradesColRef.current?.offsetWidth || 320}
              onSize={(v) => setTradesW(v, false)} onDone={() => setTradesW(tradesW)} onReset={() => setTradesW(null)} />
            <div ref={tradesRef} style={{ height: tradesH }} className="surface flex shrink-0 overflow-hidden [&>div]:w-full [&>div]:border-l-0"><SideTrades trades={trades.data} flow={c?.m5} /></div>
            {/* A square as wide as the trades above it; it does not stretch down with the page. */}
            <section aria-label="Bubble map" className="surface flex aspect-square w-full shrink-0 flex-col overflow-hidden"><BubbleMapTab mint={mint} compact /></section>
          </div>
        )}
        <section ref={tabsRef} className="surface min-w-0 overflow-hidden lg:col-start-1 lg:row-start-2">
          <CoinTabs mint={mint} r={r} c={c} trades={trades.data} onPaper={refresh} sideTrades={wide} end={<InstantButton />} />
        </section>
        {/* The trade column scrolls on its own (screen height less the top bar, status bar and margins), so its lower
            cards are reachable without scrolling the chart and the holders away. */}
        {/* the trade column's resize handle: its own layer over the column's left edge, so it stays put while the column scrolls */}
        <div className="pointer-events-none relative self-stretch max-lg:hidden lg:[grid-column:-2/-1] lg:[grid-row:1/span_2]">
          <ResizeHandle axis="x" dir={-1} label="Trade column width" className="pointer-events-auto -left-[10px]" start={() => asideRef.current?.offsetWidth || 340}
            onSize={(v) => setAsideW(v, false)} onDone={() => setAsideW(asideW)} onReset={() => setAsideW(null)} />
        </div>
        <aside ref={asideRef} className="sticky top-3 flex min-w-0 flex-col gap-2.5 max-lg:static lg:max-h-[calc(100dvh-6.75rem)] lg:overflow-y-auto lg:overscroll-contain lg:[scrollbar-width:thin] lg:[&>*]:shrink-0 lg:[grid-column:-2/-1] lg:[grid-row:1/span_2]">
          <QuickTrade docked mint={mint} symbol={symbol} sizes={sizes} pos={pos} onDone={refresh} migrating={migratingNow(c?.migrating?.since)} />
          <Flow c={c} />
          <TradePanel mint={mint} symbol={symbol} r={r} onDone={refresh} pos={pos} solUsd={c?.solUsd} priceUsd={c?.priceUsd} priceAgeMs={c?.priceAgeMs} migrating={migratingNow(c?.migrating?.since)} />
          <About r={r} c={c} market={market.data} error={market.error} refresh={market.refresh} />
          <Position pos={pos} mint={mint} symbol={symbol} solUsd={c?.solUsd} />
          <Info r={r} c={c} />
          <Addresses r={r} c={c} />
          <Links r={r} />
        </aside>
      </div>
      <QuickTrade mint={mint} symbol={symbol} sizes={sizes} pos={pos} onDone={refresh} migrating={migratingNow(c?.migrating?.since)} />
    </div>
  );
}
