// The Feed page as it was before the chat-style rewrite (pages/feed/Chat.tsx, kept on disk): the user asked for this
// look back (2026-10-09). Feed.tsx re-exports it; Feed.tsx keeps Hot, which the Launch page uses.
// Feed (#/feed): Fomo's Feed tab, item for item and in Fomo's order: big buys and sells, closed positions, theses,
// profit milestones, new listings, price spikes, traders with a smart following, and Fomo's pinned posts.
// server/fomofeed.js reads it through Aside. The Filter menu is Fomo's (same entries, same order); each choice is
// its own read from Fomo, as on fomo.family. Coins on Ethereum and BNB Chain are left out (as on Discover).
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Empty, Problem } from "@/components/page";
import { Flash } from "@/components/Live";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { useLiveMc } from "@/lib/livepx";
import { cn } from "@/lib/utils";
import { Avatar, Check, exactUsd, SOLANA, TokenPic, traderHref, usd } from "./traders/parts";
import { Hot } from "./Feed";

type User = { handle: string | null; name: string; pic: string | null; clan?: { name: string; pic: string } | null; fomo?: boolean };
interface Item {
  id: string; type: string; t: number | null; pinned: boolean; likes: number; replies: number; user: User | null; chain: number | null; mint: string | null;
  ticker: string | null; img: string | null; mc: number | null; price: number | null; comment: string | null;
  side?: "buy" | "sell"; transfer?: boolean; usd?: number | null; firstBuy?: boolean; pnlUsd?: number | null; pnlPct?: number | null; sizeUsd?: number | null;
  entryMc?: number | null; dev?: boolean; users?: { handle: string; name: string; pic: string | null }[]; count?: number | null; notes?: string | null;
  chg?: number | null; smart?: number | null; followers?: number | null; followedBy?: { handle: string; name: string; pic: string | null }[];
  title?: string | null; text?: string | null; link?: string | null;
}
interface Feed { items: Item[] | null; t: number | null; loading: boolean; error: string | null; signedOut: boolean }

// The feed is trades and theses only (the user, 2026-10-10: All, Trades, Theses are the only tabs). Keys match
// server/fomofeed.js FEED_GROUPS; Fomo's other kinds (closed positions, wins, new listings, spikes...) are not shown.
const GROUPS: [string, string][] = [["trades", "Trades"], ["theses", "Theses"]];
const ALL = GROUPS.map(([k]) => k);
const KEY = "blix:feed:groups";
// A saved choice of kinds no longer offered (e.g. only "Wins") falls back to All instead of an empty feed.
const loadGroups = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); const ok = Array.isArray(v) ? v.filter((g) => ALL.includes(g)) : []; return ok.length ? ok : ALL; } catch { return ALL; } };

// Every number follows the market: the coins on screen are read together every 2 s (/api/sparks, the lists' live
// figures) and a coin with a live trade stream moves on each trade (useLiveMc). A post keeps the market cap it was
// made at ("at $X MC"); next to it, where the coin is now. Open positions (theses, profit milestones) are worth
// what the coin is worth now: their PnL is carried from the post's figures by the move in market cap since. A
// closed position's result is final and stays as Fomo gave it.
const LiveMcs = createContext<Record<string, number>>({});
function useMcNow(it: Item) {
  const fromList = useContext(LiveMcs)[it.mint || ""], fromTrades = useLiveMc(it.mint && it.chain === SOLANA ? it.mint : "");
  return it.mint && it.chain === SOLANA ? fromTrades ?? fromList ?? null : null;
}
// An open position's PnL now: its value at the post (cost + PnL) moved by the market cap since.
function livePnl(it: Item, mcNow: number | null) {
  if (it.pnlUsd == null || it.pnlPct == null || !it.mc || !mcNow || it.pnlPct <= -100) return { usd: it.pnlUsd ?? null, pct: it.pnlPct ?? null };
  const cost = it.pnlPct ? it.pnlUsd / (it.pnlPct / 100) : it.sizeUsd ?? null;
  if (!cost || !(cost > 0)) return { usd: it.pnlUsd, pct: it.pnlPct };
  const value = (cost + it.pnlUsd) * (mcNow / it.mc);
  return { usd: value - cost, pct: (value / cost - 1) * 100 };
}
// Where the coin is now against the post's market cap: "→ $108M −2.7%".
function NowChip({ it }: { it: Item }) {
  const now = useMcNow(it);
  if (!now || !it.mc) return null;
  const d = (now / it.mc - 1) * 100, flat = Math.abs(d) < 0.05;
  return (
    <span className="num inline-flex items-center gap-1 text-muted" title="Market cap now">
      <span aria-hidden className="text-rule-2">→</span><Flash value={now} className="text-ink-2">{usd(now)}</Flash>
      {!flat && <span className={cn("font-semibold", d > 0 ? "text-up" : "text-down")}>{d > 0 ? "+" : "−"}{pctTxt(d)}</span>}
    </span>
  );
}

// Fomo's clock: "now", "19s", "4m", "7h", "2d".
function since(t: number | null) {
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 10 ? "now" : s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}
const pctTxt = (n: number) => `${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`;
const coinHref = (it: { mint: string | null; chain: number | null }) => (it.mint && it.chain === SOLANA ? `#/coin/${it.mint}` : undefined);

function Pill({ tone, children }: { tone: "up" | "down" | "ink" | "info" | "warn"; children: ReactNode }) {
  const c = { up: "bg-up/10 text-up", down: "bg-down/10 text-down", ink: "bg-paper-4 text-ink-2", info: "bg-info/10 text-info", warn: "bg-warn/10 text-warn" }[tone];
  return <span className={cn("inline-flex h-[18px] shrink-0 items-center rounded-[5px] px-1.5 text-2xs font-bold tracking-wider whitespace-nowrap uppercase", c)}>{children}</span>;
}

// The coin inline: picture and ticker. Opens the coin page on Solana.
function Coin({ it, size = 18 }: { it: Item; size?: number }) {
  const body = (
    <>
      <span className="block shrink-0" style={{ width: size, height: size }}><TokenPic mint={it.mint} chain={it.chain} img={it.img} /></span>
      <span className="truncate font-semibold text-ink">{it.ticker || "?"}</span>
    </>
  );
  const href = coinHref(it);
  return href ? <a href={href} className="inline-flex min-w-0 items-center gap-1.5 transition-colors duration-100 hover:[&>span:last-child]:text-accent">{body}</a> : <span className="inline-flex min-w-0 items-center gap-1.5">{body}</span>;
}

// The position card under a closed position, thesis or milestone: coin, market cap, then the result.
function Card({ it, extra, open = false }: { it: Item; extra?: ReactNode; open?: boolean }) {
  const href = coinHref(it), now = useMcNow(it), mc = now ?? it.mc;
  const pnl = open ? livePnl(it, now) : { usd: it.pnlUsd ?? null, pct: it.pnlPct ?? null };
  const up = (pnl.usd ?? 0) >= 0;
  const inner = (
    <>
      <span className="block size-9 shrink-0"><TokenPic mint={it.mint} chain={it.chain} img={it.img} /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="flex items-center gap-1.5 truncate text-md font-semibold text-ink">{it.ticker || "?"}
          {now != null && <span className="size-1.5 shrink-0 rounded-full bg-up motion-safe:animate-pulse" title="Live market cap" />}</b>
        <span className="num truncate text-sm text-muted"><Flash value={mc} className="text-ink-2">{usd(mc)}</Flash> MC{extra}</span>
      </span>
      {pnl.usd != null && (
        <span className="num flex flex-col items-end">
          <Flash value={Math.round(pnl.usd * 100)} className={cn("text-md font-bold", up ? "text-up" : "text-down")}>{up ? "+" : "−"}{exactUsd(Math.abs(pnl.usd), false)}</Flash>
          {pnl.pct != null && <span className={cn("text-xs font-semibold", pnl.pct >= 0 ? "text-up/80" : "text-down/80")}>{pnl.pct >= 0 ? "+" : "−"}{pctTxt(pnl.pct)}</span>}
        </span>
      )}
    </>
  );
  const cls = "mt-2 flex max-w-md items-center gap-3 rounded-xl border border-rule bg-paper-3/40 px-3 py-2.5";
  return href ? <a href={href} className={cn(cls, "transition-colors duration-150 hover:border-rule-2 hover:bg-paper-3/70")}>{inner}</a> : <div className={cls}>{inner}</div>;
}

// Fomo's post text: [$TICKER](token://solana/<mint>) links become coin links (Solana) or plain tickers.
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return <>{parts.map((p, i) => {
    const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (!m) return p;
    const sol = m[2].match(/^token:\/\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    return sol ? <a key={i} href={`#/coin/${sol[1]}`} className="font-semibold text-ink hover:text-accent">{m[1]}</a> : <b key={i} className="font-semibold text-ink">{m[1]}</b>;
  })}</>;
}

function Pinned({ it }: { it: Item }) {
  const [open, setOpen] = useState(false);
  const text = it.text || "", long = text.length > 220;
  return (
    <div className="mt-1.5 rounded-xl border border-rule bg-paper-3/40 px-3.5 py-3">
      {it.title && <div className="text-md font-semibold text-ink">{it.title}</div>}
      <div className="mt-1 text-md leading-relaxed whitespace-pre-line text-ink-2"><Rich text={open || !long ? text : `${text.slice(0, 200).replace(/\s+\S*$/, "")} …`} /></div>
      {long && <button onClick={() => setOpen(!open)} className="mt-1.5 text-sm font-semibold text-muted transition-colors duration-100 hover:text-ink">{open ? "Show less" : "Show more"}</button>}
    </div>
  );
}

// Likes given on Blix (server/feedviews.js), on top of Fomo's own. Read back every 10 s (not in a hidden tab: each read
// is a Worker request): every post's Blix likes and which ones this viewer liked.
interface Social { likes: Record<string, number>; liked: Set<string> }
const SocialCtx = createContext<{ s: Social; like: (id: string) => void }>({ s: { likes: {}, liked: new Set() }, like: () => {} });
function useSocial(ids: string[]) {
  const [s, setS] = useState<Social>({ likes: {}, liked: new Set() });
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const idKey = ids.slice(0, 300).join(",");
  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (document.hidden) return;
      post<{ likes: Record<string, number>; liked: string[] }>("feed/views", { ids: idsRef.current.slice(0, 300) })
        .then((r) => alive && setS({ likes: r.likes || {}, liked: new Set(r.liked || []) })).catch(() => {});
    };
    sync();
    const t = setInterval(sync, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, [idKey]);
  const like = (id: string) => {
    const on = !s.liked.has(id);
    setS((x) => { const liked = new Set(x.liked); on ? liked.add(id) : liked.delete(id); return { ...x, liked, likes: { ...x.likes, [id]: Math.max(0, (x.likes[id] || 0) + (on ? 1 : -1)) } }; });
    post<{ likes: number; liked: boolean }>("feed/like", { id, on })
      .then((r) => setS((x) => { const liked = new Set(x.liked); r.liked ? liked.add(id) : liked.delete(id); return { ...x, liked, likes: { ...x.likes, [id]: r.likes } }; }))
      .catch(() => toast("Couldn't save that like. Try again."));
  };
  return { s, like };
}
const compact = (n: number) => n < 1000 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "")}K` : `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;

// Under every post: "Trade" for a Solana coin (shown on hover on a desktop, always on a phone). The like, reply and
// share buttons were taken off (the owner, 2026-10-10).
function Actions({ it }: { it: Item }) {
  const href = coinHref(it);
  if (!href) return null;
  return (
    <div className="mt-1.5 flex items-center">
      <a href={href} className="ml-auto inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs font-semibold text-ink-2 ring-1 ring-rule-2 ring-inset transition-[opacity,background-color,color] duration-150 hover:bg-ink hover:text-paper focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100">
        Trade<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg>
      </a>
    </div>
  );
}

function Who({ u, t }: { u: User | null; t: number | null }) {
  const time = t ? <span className="num shrink-0 text-muted" title={new Date(t).toLocaleString()}>{since(t)}</span> : null;
  if (!u) return time;
  const name = <b className="truncate font-semibold text-ink">{u.fomo ? "blixvip" : u.name}</b>;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-md">
      {u.handle ? <a href={traderHref(u.handle)} className="min-w-0 truncate hover:underline">{name}</a> : name}
      {u.fomo && <span className="grid size-3.5 shrink-0 place-items-center rounded-full bg-info text-white"><Check className="size-2.5" /></span>}
      {u.clan?.pic && <img src={u.clan.pic} alt="" title={u.clan.name} loading="lazy" className="size-3.5 shrink-0 rounded-[4px] object-cover" />}
      {u.handle && u.handle.toLowerCase() !== u.name.toLowerCase() && <span className="hidden min-w-0 truncate text-muted sm:inline">@{u.handle}</span>}
      {time && <><span aria-hidden className="text-muted">·</span>{time}</>}
    </span>
  );
}

// While the feed loads: placeholder posts shaped like real rows (picture, name and pill, a line or two, the
// action bar), softly pulsing, newest first. No "reading Fomo" text (the user, 2026-10-10).
const SKEL: [number, number][] = [[62, 44], [48, 70], [70, 0], [55, 38], [40, 62], [66, 0]];
function FeedSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the feed" className="divide-y divide-rule/70">
      {SKEL.map(([w1, w2], i) => (
        <div key={i} className="flex animate-pulse gap-3 px-4 pt-3.5 pb-3" style={{ animationDelay: `${i * 120}ms` }}>
          <span className="size-9 shrink-0 rounded-full bg-paper-4" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
            <div className="flex items-center gap-2"><span className="h-3 w-24 rounded-full bg-paper-4" /><span className="h-3 w-10 rounded-full bg-paper-3" /><span className="h-4 w-12 rounded-md bg-paper-4" /></div>
            <span className="h-3 rounded-full bg-paper-3" style={{ width: `${w1}%` }} />
            {w2 > 0 && <span className="h-3 rounded-full bg-paper-3" style={{ width: `${w2}%` }} />}
            <div className="mt-1 flex gap-5"><span className="h-2.5 w-8 rounded-full bg-paper-3" /><span className="h-2.5 w-8 rounded-full bg-paper-3" /><span className="h-2.5 w-8 rounded-full bg-paper-3" /></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Row({ it }: { it: Item }) {
  const u = it.user;
  const pic = u?.fomo
    ? <img src="brand/apple-touch-icon.png?v=eye" alt="blixvip" className="size-9 shrink-0 rounded-full bg-black object-cover" />
    : u?.handle ? <a href={traderHref(u.handle)} className="h-fit shrink-0 rounded-full transition-opacity duration-150 hover:opacity-85"><Avatar src={u.pic} size={36} /></a> : <span className="block size-9 shrink-0"><TokenPic mint={it.mint} chain={it.chain} img={it.img} /></span>;
  const line = "num mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-md";
  let pill: ReactNode = null, body: ReactNode = null;
  switch (it.type) {
    case "large_buy": case "large_sell": case "large_transfer_in": case "large_transfer_out":
      pill = <Pill tone={it.side === "buy" ? "up" : "down"}>{it.transfer ? (it.side === "buy" ? "Received" : "Sent") : it.side === "buy" ? (it.firstBuy ? "First buy" : "Buy") : "Sell"}</Pill>;
      body = (
        <div className={line}>
          <b className={cn("font-semibold", it.side === "buy" ? "text-up" : "text-down")}>{usd(it.usd)}</b><span className="text-muted">of</span><Coin it={it} />
          <span className="text-muted">at {usd(it.mc)}</span><NowChip it={it} />
          {it.side === "sell" && it.pnlUsd ? <span className={cn("rounded-[5px] px-1.5 text-sm font-semibold", it.pnlUsd >= 0 ? "bg-up/10 text-up" : "bg-down/10 text-down")}>{it.pnlUsd >= 0 ? "+" : "−"}{usd(Math.abs(it.pnlUsd))} PnL</span> : null}
        </div>
      );
      break;
    case "single_user_sell": case "single_user_transfer_out":
      pill = <Pill tone="ink">Closed</Pill>; body = <Card it={it} />; break;
    case "thesis_created":
      pill = <Pill tone="info">Thesis</Pill>;
      body = <Card it={it} open extra={it.entryMc ? <span> · entry {usd(it.entryMc)}</span> : null} />; break;
    case "user_trade_profit_milestone":
      pill = <Pill tone="up">Milestone</Pill>; body = <Card it={it} open extra={it.sizeUsd ? <span> · cost {usd(it.sizeUsd)}</span> : null} />; break;
    case "multi_user_buy": case "multi_user_sell":
      pill = <Pill tone={it.side === "buy" ? "up" : "down"}>{it.side === "buy" ? "Buying" : "Selling"}</Pill>;
      body = (
        <div className={line}>
          <span className="flex">{(it.users || []).map((x, i) => <a key={x.handle} href={traderHref(x.handle)} title={x.name} className={cn("rounded-full ring-2 ring-paper-2", i && "-ml-1.5")}><Avatar src={x.pic} size={20} /></a>)}</span>
          <span className="text-ink-2">{it.count ?? it.users?.length ?? "Several"} traders</span><Coin it={it} />{it.usd ? <b className="font-semibold text-ink">{usd(it.usd)}</b> : null}
          <span className="text-muted">at {usd(it.mc)}</span><NowChip it={it} />
        </div>
      );
      break;
    case "new_token_listing":
      pill = <Pill tone="warn">New</Pill>;
      body = <><div className={line}><Coin it={it} /><span className="text-muted">listed at {usd(it.mc)}</span><NowChip it={it} /></div>
        {it.notes && <p className="mt-1 text-md text-ink-2">{it.notes}</p>}</>;
      break;
    case "price_since_listing":
      pill = <Pill tone={(it.chg ?? 0) >= 0 ? "up" : "down"}>Spike</Pill>;
      body = <div className={line}><Coin it={it} />{it.chg != null && <b className={cn("font-semibold", it.chg >= 0 ? "text-up" : "text-down")}>{it.chg >= 0 ? "+" : "−"}{pctTxt(it.chg)}</b>}<span className="text-muted">since listing · {usd(it.mc)}</span><NowChip it={it} /></div>;
      break;
    case "user_with_smart_following":
      pill = <Pill tone="info">New trader</Pill>;
      body = (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-md text-ink-2">
          <span className="flex">{(it.followedBy || []).map((x, i) => <a key={x.handle} href={traderHref(x.handle)} title={x.name} className={cn("rounded-full ring-2 ring-paper-2", i && "-ml-1.5")}><Avatar src={x.pic} size={20} /></a>)}</span>
          <span>Followed by <b className="num font-semibold text-ink">{(it.smart ?? 0).toLocaleString()}</b> smart traders{it.followers ? <> · {it.followers.toLocaleString()} followers</> : null}</span>
        </div>
      );
      break;
    case "manual":
      body = <Pinned it={it} />; break;
  }
  return (
    <article className="group flex gap-3 px-4 pt-3.5 pb-2 transition-colors duration-150 hover:bg-paper-3/25">
      {pic}
      <div className="min-w-0 flex-1">
        <header className="flex min-w-0 items-center gap-2">
          <Who u={u} t={it.t} />{pill}
          {it.pinned && <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-semibold text-muted"><svg viewBox="0 0 24 24" fill="currentColor" className="size-3" aria-hidden><path d="M15 3l6 6-3 1-4 4 1 5-2 2-4-5-5 5-1-1 5-5-5-4 2-2 5 1 4-4z" /></svg>Pinned</span>}
        </header>
        {it.comment && it.type !== "manual" && <p className="mt-1 text-md leading-relaxed break-words text-ink">{it.comment}</p>}
        {body}
        {/* Buys and sells are a ticker, not a conversation: the like/reply/share bar only goes under posts people wrote. */}
        {(it.type === "thesis_created" || it.type === "manual") && <Actions it={it} />}
      </div>
    </article>
  );
}

// Fomo's Filter menu: Deselect all / Select all, then one checkbox per kind of post.
function Filter({ groups, onChange }: { groups: string[]; onChange: (g: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("mousedown", off); return () => removeEventListener("mousedown", off);
  }, [open]);
  const all = groups.length === ALL.length, custom = !all && groups.length !== 1;
  return (
    <div ref={ref} className="relative shrink-0">
      <button onClick={() => setOpen(!open)} aria-expanded={open} title="Filter" className={cn("flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-colors duration-100 hover:bg-paper-3 hover:text-ink", custom ? "text-ink" : "text-muted")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden><path d="M4 7h16M7 12h10M10 17h4" /></svg>
        <span className="max-sm:hidden">Filter</span>{custom && <span className="num rounded-full bg-paper-4 px-1.5 text-2xs">{groups.length}</span>}
      </button>
      {open && (
        <div className="absolute top-10 right-0 z-30 w-64 overflow-hidden rounded-xl border border-rule-2 bg-paper-2 py-1 shadow-2xl">
          <button onClick={() => onChange(all ? [] : ALL)} className="w-full px-3.5 py-2 text-left text-sm font-semibold text-accent hover:text-focus">{all ? "Deselect all" : "Select all"}</button>
          {GROUPS.map(([k, label]) => {
            const on = groups.includes(k);
            return (
              <button key={k} onClick={() => onChange(on ? groups.filter((g) => g !== k) : ALL.filter((g) => g === k || groups.includes(g)))}
                className="flex w-full items-center justify-between px-3.5 py-2 text-left text-md text-ink hover:bg-paper-3">
                {label}
                <span className={cn("grid size-4 place-items-center rounded-[5px] border", on ? "border-accent bg-accent text-accent-ink" : "border-rule-2")}>{on && <Check className="size-3" />}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Tabs over the feed: everything, or one kind of post. Other mixes are made in Filter.
const TABS: [string, string][] = [["all", "All"], ["trades", "Trades"], ["theses", "Theses"]];
function Tabs({ groups, onChange }: { groups: string[]; onChange: (g: string[]) => void }) {
  const at = groups.length === ALL.length ? "all" : groups.length === 1 ? groups[0] : null;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" role="tablist">
      {TABS.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={at === k} onClick={() => onChange(k === "all" ? ALL : [k])}
          className={cn("relative h-11 shrink-0 px-3 text-md font-semibold transition-colors duration-150", at === k ? "text-ink" : "text-muted hover:text-ink-2")}>
          {label}
          <span aria-hidden className={cn("absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-ink transition-opacity duration-150", at === k ? "opacity-100" : "opacity-0")} />
        </button>
      ))}
    </div>
  );
}

export function Feed() {
  const [groups, setGroups] = useState<string[]>(loadGroups);
  const pick = (g: string[]) => { setGroups(g); try { localStorage.setItem(KEY, JSON.stringify(g)); } catch {} };
  const { data: d, error } = usePoll<Feed>(groups.length ? `fomo/feed?groups=${groups.join(",")}` : null, 1000);
  // Re-draw the clocks ("19s") between reads.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const items = d?.items;
  const social = useSocial(useMemo(() => (items || []).map((x) => x.id), [items]));
  const mints = useMemo(() => [...new Set((items || []).filter((x) => x.mint && x.chain === SOLANA).map((x) => x.mint!))].slice(0, 120).sort().join(","), [items]);
  const { data: sp } = usePoll<{ rows: Record<string, { mc: number | null; live?: { mc: number | null } | null }> }>(mints ? `sparks?w=1h&m=${mints}` : null, 2000, true);
  const liveMcs = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [m, x] of Object.entries(sp?.rows || {})) { const v = x.live?.mc ?? x.mc; if (v && v > 0) out[m] = v; }
    return out;
  }, [sp]);
  // Posts that arrived after the first read slide in and glow for a moment; the first screenful just appears.
  const seen = useRef<{ key: string; ids: Set<string>; at: Map<string, number> } | null>(null);
  const fresh = useMemo(() => {
    const key = groups.join(",");
    if (!items) return new Set<string>();
    if (!seen.current || seen.current.key !== key) { seen.current = { key, ids: new Set(items.map((x) => x.id)), at: new Map() }; return new Set<string>(); }
    const s = seen.current, t = Date.now();
    for (const x of items) if (!s.ids.has(x.id)) { s.ids.add(x.id); s.at.set(x.id, t); }
    for (const [id, at] of s.at) if (t - at > 3000) s.at.delete(id);
    return new Set(s.at.keys());
  }, [items, groups]);
  return (
    <div className="mx-auto grid w-full max-w-[1080px] items-start gap-5 px-3 pt-4 pb-6 lg:grid-cols-[minmax(0,1fr)_320px]">
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl leading-none font-bold tracking-tight">Feed</h1>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs font-medium text-muted">
          {d?.t ? <span className={cn("flex items-center gap-1.5", d.error ? "text-warn" : "text-ink-2")}><span className={cn("size-1.5 rounded-full motion-safe:animate-pulse", d.error ? "bg-warn" : "bg-up")} />{d.error ? `Last read ${since(d.t)}` : "Live"}</span> : null}
        </div>
      </header>
      <SocialCtx.Provider value={social}>
      <LiveMcs.Provider value={liveMcs}>
      <section className="min-w-0 rounded-xl border border-rule bg-paper-2">
        <div className="sticky top-0 z-20 flex items-center gap-2 rounded-t-xl border-b border-rule bg-paper-2/90 pr-2 pl-1 backdrop-blur-md">
          <Tabs groups={groups} onChange={pick} /><Filter groups={groups} onChange={pick} />
        </div>
        <div className="divide-y divide-rule/70">
        {!groups.length ? <Empty>Pick something in Filter to see the feed.</Empty>
          : d?.signedOut ? <Empty>Nothing here right now. The feed fills in by itself.</Empty>
          : items ? (items.length ? items.map((it) => fresh.has(it.id) ? <div key={it.id} className="grid animate-post-in"><div className="min-h-0 overflow-hidden"><Row it={it} /></div></div> : <Row key={it.id} it={it} />) : <Empty>Nothing on Fomo's feed for this filter right now.</Empty>)
          : error ? <div className="p-3"><Problem text={error} /></div>
          // Blix answered, Fomo did not yet (a refused first read after a restart; it is asked again within seconds):
          // the skeleton stays, with the reason in small print, instead of a red box for something that fixes itself.
          : d?.error ? <><p role="status" className="px-3 pt-3 text-sm text-muted">Fomo is still loading. Last try: {d.error} Trying again.</p><FeedSkeleton /></>
          : <FeedSkeleton />}
        </div>
      </section>
      </LiveMcs.Provider>
      </SocialCtx.Provider>
    </div>
    <Hot items={items ?? []} sources={["fomo", "pump"]} className="sticky top-4 hidden max-h-[calc(100dvh-2rem)] min-w-0 overflow-y-auto rounded-xl border border-rule bg-paper-2 py-4 [scrollbar-width:thin] lg:block" />
    </div>
  );
}
