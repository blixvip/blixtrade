// The Feed page is the classic one (./FeedClassic.tsx; the chat-style ./feed/Chat.tsx is kept, not shown).
// This file keeps the hot ranking the Launch page reuses.
export { Feed } from './FeedClassic';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { prefetch, usePoll } from '@/lib/coin';
import { cn, store } from '@/lib/utils';
import { useMcNow } from '@/components/postLive';
import { Avatar, SOLANA, TokenPic, usd } from './traders/parts';
type Source = 'fomo' | 'pump';
interface Item { id: string; t: number | null; mint: string | null; chain: number | null; ticker: string | null; img: string | null; mc: number | null; side?: string; usd?: number | null; user?: { name: string; pic: string | null } | null }
const clock = { now: Date.now(), fns: new Set<() => void>(), timer: 0 };
const listen = (f: () => void) => {
  clock.fns.add(f);
  if (!clock.timer) clock.timer = window.setInterval(() => { clock.now = Date.now(); clock.fns.forEach((g) => g()); }, 1000);
  return () => { clock.fns.delete(f); if (!clock.fns.size) { clearInterval(clock.timer); clock.timer = 0; } };
};
const useNow = () => useSyncExternalStore(listen, () => clock.now);

// Fomo's clock: "now", "19s", "4m", "7h", "2d".
function since(t: number | null, now = Date.now()) {
  if (!t) return "";
  const s = Math.max(0, (now - t) / 1000);
  return s < 10 ? "now" : s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}

// A live figure: just updates (no green/red flash, 2026-10-10).
function Tick({ children, className }: { value?: number | null; children: ReactNode; className?: string }) {
  return <span className={cn("num", className)}>{children}</span>;
}

const WINDOWS: [string, number][] = [["1m", 1], ["5m", 5], ["15m", 15], ["30m", 30], ["1h", 60]];
type HotCoin = { it: Item; n: number; buy: number; sell: number; people: Map<string, string | null>; last: number; traders?: number };
type HotAnswer = { w: number; since: number | null; top: { mint: string; ticker: string | null; img: string | null; mc: number | null; chain: number; n: number; buy: number; sell: number; people: [string, string | null][]; last: number; traders?: number }[] };
// `keep`: shown away from the Feed (pages/Launch.tsx), so the server keeps the feeds reading while it is asked for.
// Always SLOTS rows tall, so the box never changes size: while a window loads, the last list it had (kept in this
// browser) or the previous window's, dimmed; every window is asked for ahead, so a switch is usually instant.
const SLOTS = 10, ROW = 52;
const hotPath = (w: number, sources: Source[], keep: boolean) =>
  `feed/hot?${new URLSearchParams({ w: String(w), src: [...sources].sort().join(","), ...(keep ? { keep: "1" } : {}) })}`;
type Kept = HotAnswer["top"];
const keptKey = (w: number, sources: Source[]) => `feed:hot:${w}:${[...sources].sort().join(",")}`;
const fromAnswer = (top: Kept): HotCoin[] => top.map((g) => ({ it: { mint: g.mint, ticker: g.ticker, img: g.img, mc: g.mc, chain: g.chain } as Item, n: g.n, buy: g.buy, sell: g.sell, people: new Map(g.people), last: g.last, traders: g.traders }));
export function Hot({ items, sources, keep = false, className }: { items: Item[]; sources: Source[]; keep?: boolean; className?: string }) {
  const now = useNow();
  const [win, setWinState] = useState<number>(() => { const v = store.get<number>("feed:hotwin", 30); return WINDOWS.some((w) => w[1] === v) ? v : 30; });
  const setWin = (v: number) => { store.set("feed:hotwin", v); setWinState(v); };
  // Re-counted every 10 s (a 1-minute window moves fast), and whenever posts arrive.
  const tick = Math.floor(now / 10_000);
  const oldest = useMemo(() => items.reduce((m, x) => (x.t && x.t < m ? x.t : m), Infinity), [items]);
  const server = usePoll<HotAnswer>(hotPath(win, sources, keep), 5_000, true).data;
  const fresh = server && server.w === win ? server : null;
  // The other windows, asked for once the box is up and again when the pointer rests on one.
  useEffect(() => { const t = window.setTimeout(() => { for (const [, w] of WINDOWS) if (w !== win) prefetch(hotPath(w, sources, keep)); }, 600); return () => clearTimeout(t); }, [win, sources.join(), keep]); // eslint-disable-line react-hooks/exhaustive-deps
  // This window's list as it was last seen in this browser: the first frame, before the server answers.
  const kept = useMemo(() => store.get<Kept | null>(keptKey(win, sources), null), [win, sources.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fresh) store.set(keptKey(win, sources), fresh.top.slice(0, SLOTS)); }, [fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const localReach = Number.isFinite(oldest) && oldest > Date.now() - win * 60_000 && items.length >= 150 ? oldest : null;
  const reach = fresh ? fresh.since : localReach;
  const local = useMemo(() => {
    const since30 = Date.now() - win * 60_000;
    const by = new Map<string, HotCoin>();
    for (const x of items) {
      if (!x.mint || x.chain !== SOLANA || (x.t || 0) < since30) continue;
      const g = by.get(x.mint) || { it: x, n: 0, buy: 0, sell: 0, people: new Map(), last: 0 };
      g.n++; g.last = Math.max(g.last, x.t || 0);
      if (x.side === "buy") g.buy += x.usd || 0; else if (x.side === "sell") g.sell += x.usd || 0;
      if (x.user?.name && g.people.size < 6) g.people.set(x.user.name, x.user.pic);
      if (!g.it.img && x.img) g.it = x;
      by.set(x.mint, g);
    }
    return [...by.values()].sort((a, b) => b.n - a.n || b.people.size - a.people.size || b.last - a.last).slice(0, SLOTS);
  }, [items, tick, win]); // eslint-disable-line react-hooks/exhaustive-deps
  // Best first: this window from the server, the posts on this page, this window as last kept, the last window.
  const [top, settled, shownWin]: [HotCoin[], boolean, number] = fresh ? [fromAnswer(fresh.top), true, win]
    : local.length ? [local, true, win]
    : kept?.length ? [fromAnswer(kept), false, win]
    : server ? [fromAnswer(server.top), false, server.w]
    : [[], false, win];
  const rows = top.slice(0, SLOTS);
  const label = win === 60 ? "hour" : `${win} minute${win === 1 ? "" : "s"}`;
  const waiting = !rows.length && !server;
  // Several coins under one ticker (copies): each shows the end of its contract so they can be told apart.
  const dupes = new Set<string>();
  { const seen = new Set<string>(); for (const g of rows) { const k = (g.it.ticker || "").toLowerCase(); if (seen.has(k)) dupes.add(k); seen.add(k); } }
  const most = Math.max(1, ...rows.map((g) => g.n));
  const at = WINDOWS.findIndex((w) => w[1] === win);
  return (
    <aside aria-label="Hot right now" className={className ?? "sticky top-4 hidden min-w-0 xl:block"}>
      <div className="flex flex-col gap-3 px-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2 items-center justify-center"><span className="absolute inset-0 animate-ping rounded-full bg-up/50 [animation-duration:2s]" /><span className="relative size-1.5 rounded-full bg-up" /></span>
            <h2 className="text-md leading-none font-semibold text-ink">Hot right now</h2>
          </div>
          <span className="num truncate text-xs text-muted" title={reach ? "Blix started reading the feeds then; the count fills in as posts arrive" : undefined}>
            {reach ? `counting from ${since(reach, now)} ago` : "most posted about"}
          </span>
        </div>
        <div role="radiogroup" aria-label="Time window" className="relative grid grid-cols-5 rounded-full border border-rule bg-paper p-0.5">
          <span aria-hidden className="absolute inset-y-0.5 left-0.5 rounded-full bg-paper-4 shadow-sm ring-1 ring-rule-2 transition-transform duration-300 ease-[var(--ease-out)]"
            style={{ width: `calc((100% - 4px) / ${WINDOWS.length})`, transform: `translateX(${at * 100}%)` }} />
          {WINDOWS.map(([w, m]) => (
            <button key={m} role="radio" aria-checked={win === m} onClick={() => setWin(m)} onPointerEnter={() => prefetch(hotPath(m, sources, keep))}
              className={cn("num relative h-7 rounded-full text-xs font-semibold outline-none transition-colors duration-200 focus-visible:ring-1 focus-visible:ring-ink/30",
                win === m ? "text-ink" : "text-muted hover:text-ink-2")}>{w}</button>
          ))}
        </div>
      </div>
      <div className="relative border-t border-rule py-1" style={{ height: SLOTS * ROW + 8 }}>
        {rows.length ? <HotList key={shownWin} rows={rows} most={most} dupes={dupes} dim={!settled} />
          : waiting ? <div className="flex flex-col">{Array.from({ length: SLOTS }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-4" style={{ height: ROW, opacity: 1 - i * 0.08 }}><span className="h-2.5 w-3 animate-pulse rounded bg-paper-4" /><span className="size-8 shrink-0 animate-pulse rounded-full bg-paper-4" /><span className="flex flex-1 flex-col gap-1.5"><span className="h-3 w-1/2 animate-pulse rounded bg-paper-4" /><span className="h-2.5 w-1/3 animate-pulse rounded bg-paper-3" /></span><span className="h-3 w-12 animate-pulse rounded bg-paper-4" /></div>
            ))}</div>
          : <div className="grid h-full animate-row-in place-items-center px-6 text-center"><p className="text-sm text-muted">Quiet out there: no coin talk in the last {label}.</p></div>}
      </div>
    </aside>
  );
}

// The rows, sliding to their new places when the order changes, new ones easing in. A window switch draws a
// fresh list (keyed by window), its rows arriving one after another.
function HotList({ rows, most, dupes, dim }: { rows: HotCoin[]; most: number; dupes: Set<string>; dim: boolean }) {
  const refs = useRef(new Map<string, HTMLLIElement>()), was = useRef(new Map<string, number>()), first = useRef(true);
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const [k, el] of refs.current) {
      const y = el.offsetTop, from = was.current.get(k);
      next.set(k, y);
      if (from != null && from !== y) el.animate([{ transform: `translateY(${from - y}px)` }, { transform: "translateY(0)" }], { duration: 450, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
    }
    was.current = next; first.current = false;
  });
  return (
    <ol className={cn("flex flex-col transition-opacity duration-300", dim && "opacity-55")}>
      {rows.map((g, i) => (
        <li key={g.it.mint} ref={(el) => { if (el) refs.current.set(g.it.mint!, el); else refs.current.delete(g.it.mint!); }}
          className="animate-row-in [animation-fill-mode:backwards]" style={first.current ? { animationDelay: `${i * 30}ms` } : undefined}>
          <HotRow g={g} rank={i + 1} heat={g.n / most} dupe={dupes.has((g.it.ticker || "").toLowerCase())} />
        </li>
      ))}
    </ol>
  );
}

// One coin: rank, picture, ticker (with the contract's end when another coin shares it), who is posting, its market
// cap and the net money in or out. A faint bar behind the row is how much it is talked about against the top coin.
function HotRow({ g, rank, heat, dupe }: { g: HotCoin; rank: number; heat: number; dupe: boolean }) {
  const mc = useMcNow(g.it.mint, g.it.mc);
  const flow = g.buy + g.sell, net = g.buy - g.sell;
  const people = [...g.people.values()], traders = g.traders ?? g.people.size;
  return (
    <a href={`#/coin/${g.it.mint}`} title={flow ? `${usd(g.buy)} bought · ${usd(g.sell)} sold in posted trades` : undefined}
      className="group relative flex items-center gap-3 overflow-hidden px-4 outline-none transition-colors duration-150 hover:bg-paper-3/70 focus-visible:bg-paper-3/70" style={{ height: ROW }}>
      <i aria-hidden className="pointer-events-none absolute inset-y-1 left-0 rounded-r-md bg-gradient-to-r from-up/[0.07] to-transparent transition-[width] duration-700 ease-[var(--ease-out)]" style={{ width: `${Math.max(4, heat * 100)}%` }} />
      <span className={cn("num relative w-4 shrink-0 text-right text-xs tabular-nums", rank <= 3 ? "font-bold text-ink" : "text-muted")}>{rank}</span>
      <span className="relative block size-8 shrink-0 overflow-hidden rounded-full ring-1 ring-edge transition-transform duration-200 group-hover:scale-105"><TokenPic mint={g.it.mint} chain={g.it.chain} img={g.it.img} /></span>
      <span className="relative flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <b className="truncate text-sm leading-tight font-semibold text-ink">{g.it.ticker ? `$${g.it.ticker}` : "?"}</b>
          {dupe && g.it.mint && <span className="shrink-0 font-outlier text-[0.625rem] text-muted">…{g.it.mint.replace(/pump$/, "").slice(-4)}</span>}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-muted">
          {people.length > 0 && <span className="flex shrink-0">{people.slice(0, 3).map((pic, j) => <span key={j} className={cn("rounded-full ring-[1.5px] ring-paper-2", j && "-ml-1")}><Avatar src={pic} size={14} /></span>)}</span>}
          <span className="num truncate">{g.n} {g.n === 1 ? "post" : "posts"}{traders > 1 ? ` · ${traders} traders` : ""}</span>
        </span>
      </span>
      <span className="relative flex shrink-0 flex-col items-end gap-0.5">
        <Tick value={mc} className="text-sm leading-tight font-semibold text-ink">{usd(mc)}</Tick>
        {flow > 0 && <span className={cn("num text-[0.6875rem] font-medium", net >= 0 ? "text-up" : "text-down")}>{net >= 0 ? "+" : "−"}{usd(Math.abs(net))}</span>}
      </span>
    </a>
  );
}
