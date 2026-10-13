// The watchlist strip (Axiom's top bar): under the top bar, the coins you starred (the star on a coin's chart, on
// Discover's coin card, or in the status bar's Watchlist window), newest on the left. Each chip: the coin's picture,
// its ticker, the live market cap (moving trade by trade from the stream) and the hour's change. Click one to open
// it; the × on hover takes it off the list. Shown only while the list has something on it.
import { useEffect, useMemo } from "react";
import { CoinImg } from "@/components/page";
import { Tip } from "@/components/ui/tooltip";
import { usdK, usePoll } from "@/lib/coin";
import { useLiveMc } from "@/lib/livepx";
import { warmPics } from "@/lib/pics";
import { shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { removeStar, useWatchlist, type Star } from "@/lib/watchlist";
import { Icon } from "@/shell/icons";

type Fig = { mc: number | null; chg: number | null; live?: { mc: number | null } | null };

function Chip({ s, fig, fresh }: { s: Star; fig: Fig | undefined; fresh: boolean }) {
  const live = useLiveMc(s.mint);
  const mc = live ?? fig?.live?.mc ?? fig?.mc ?? null, chg = fig?.chg ?? null;
  return (
    <a href={`#/coin/${s.mint}`} title={`$${s.symbol || shortAddr(s.mint)} · ${mc != null ? `${usdK(mc)} market cap` : "no price yet"}${chg != null ? ` · ${chg >= 0 ? "+" : ""}${chg.toFixed(1)}% in the last hour` : ""}`}
      className={cn("group flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-rule-2 bg-paper-3/60 pr-1 pl-1.5 text-sm whitespace-nowrap transition-colors hover:border-muted hover:bg-paper-4",
        fresh && "animate-[tape-in_400ms_var(--ease-out)]")}>
      <span className="relative size-4 shrink-0 overflow-hidden rounded-full bg-paper-4"><CoinImg mint={s.mint} preview={false} /></span>
      <b className="max-w-[7rem] truncate font-semibold text-ink">${s.symbol || shortAddr(s.mint)}</b>
      {mc != null && <span className="num text-ink-2">{usdK(mc)}</span>}
      {chg != null && <span className={cn("num text-xs font-semibold", chg > 0 ? "text-up" : chg < 0 ? "text-down" : "text-muted")}>{chg > 0 ? "+" : ""}{Math.abs(chg) >= 100 ? chg.toFixed(0) : chg.toFixed(1)}%</span>}
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeStar(s.mint); }} aria-label={`Remove $${s.symbol || shortAddr(s.mint)} from the watchlist`}
        className="grid size-4 place-items-center rounded-full text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-paper-5 hover:text-ink focus-visible:opacity-100">
        <Icon.close className="size-2.5" />
      </button>
    </a>
  );
}

export function WatchTape() {
  const list = useWatchlist((s) => s.list), at = useWatchlist((s) => s.at);
  const mints = useMemo(() => list.map((s) => s.mint).sort().join(","), [list]);
  // Market cap and the hour's change for every starred coin, every 15 s; the live stream moves the cap between reads.
  const { data } = usePoll<{ rows: Record<string, Fig> }>(mints ? `sparks?w=1h&m=${mints}` : null, 15_000, true);
  useEffect(() => { if (mints) warmPics(mints.split(",")); }, [mints]);
  if (!list.length) return null;
  const newest = list[0];
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-rule bg-paper-2/70 px-3 max-md:px-2">
      <Tip tip="Your watchlist: the coins you starred. Star a coin on its chart to add it here">
        <span className="flex shrink-0 items-center gap-1 text-muted">
          <Icon.star className="size-3.5 fill-current text-warn" /><span className="text-2xs font-semibold tracking-[0.045em] uppercase max-sm:hidden">Watchlist</span>
        </span>
      </Tip>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]">
        {list.map((s) => <Chip key={s.mint} s={s} fig={data?.rows?.[s.mint]} fresh={s === newest && Date.now() - at < 1500} />)}
      </div>
    </div>
  );
}
