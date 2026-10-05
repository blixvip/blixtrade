// Feed (#/feed): Fomo's Feed tab, item for item and in Fomo's order: big buys and sells, closed positions, theses,
// profit milestones, new listings, price spikes, traders with a smart following, and Fomo's pinned posts.
// server/fomofeed.js reads it through Aside. The Filter menu is Fomo's (same entries, same order); each choice is
// its own read from Fomo, as on fomo.family. Coins on Ethereum and BNB Chain are left out (as on Discover).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Empty, Loading, Problem } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { cn } from "@/lib/utils";
import { Avatar, Check, exactUsd, SOLANA, TokenPic, traderHref, usd } from "./traders/parts";

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

// Fomo's filter menu, in its order (keys match server/fomofeed.js FEED_GROUPS).
const GROUPS: [string, string][] = [["trades", "Trades"], ["closed", "Closed positions"], ["theses", "Theses"], ["multi", "Multi-user trades"],
  ["listings", "New listings"], ["spikes", "Price spikes"], ["milestones", "Profit milestones"], ["traders", "New traders"]];
const ALL = GROUPS.map(([k]) => k);
const KEY = "blix:feed:groups";
const loadGroups = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return Array.isArray(v) ? v.filter((g) => ALL.includes(g)) : ALL; } catch { return ALL; } };

// Fomo's clock: "now", "19s", "4m", "7h", "2d".
function since(t: number | null) {
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 10 ? "now" : s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}
const pctTxt = (n: number) => `${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`;
const coinHref = (it: { mint: string | null; chain: number | null }) => (it.mint && it.chain === SOLANA ? `#/coin/${it.mint}` : undefined);

function Pill({ tone, children }: { tone: "up" | "down" | "ink" | "info" | "warn"; children: ReactNode }) {
  const c = { up: "bg-up/15 text-up", down: "bg-down/15 text-down", ink: "bg-paper-4 text-ink-2", info: "bg-info/15 text-info", warn: "bg-warn/15 text-warn" }[tone];
  return <span className={cn("inline-flex h-6 items-center rounded-md px-1.5 text-sm font-semibold whitespace-nowrap", c)}>{children}</span>;
}

// The coin as Fomo writes it inline: picture, ticker underlined with dots. Opens the coin page on Solana.
function Coin({ it, size = 26 }: { it: Item; size?: number }) {
  const body = (
    <>
      <span className="block shrink-0" style={{ width: size, height: size }}><TokenPic mint={it.mint} chain={it.chain} img={it.img} /></span>
      <span className="font-semibold text-ink underline decoration-muted decoration-dotted underline-offset-[5px]">{it.ticker || "?"}</span>
    </>
  );
  const href = coinHref(it);
  return href ? <a href={href} className="inline-flex min-w-0 items-center gap-1.5 hover:opacity-80">{body}</a> : <span className="inline-flex min-w-0 items-center gap-1.5">{body}</span>;
}

// The position card under a closed position, thesis or milestone: coin, market cap, then the result.
function Card({ it, sub }: { it: Item; sub?: ReactNode }) {
  const up = (it.pnlUsd ?? 0) >= 0, href = coinHref(it);
  const inner = (
    <>
      <span className="block size-11 shrink-0"><TokenPic mint={it.mint} chain={it.chain} img={it.img} /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <b className="truncate text-lg font-semibold text-ink">{it.ticker || "?"}</b>
        <span className="num text-md text-muted">{sub ?? <>{usd(it.mc)} MC</>}</span>
      </span>
      {it.pnlUsd != null && (
        <span className="num flex flex-col items-end">
          <b className={cn("text-lg font-semibold", up ? "text-up" : "text-down")}>{up ? "+" : "−"} {exactUsd(Math.abs(it.pnlUsd), false)}</b>
          {it.pnlPct != null && <span className={cn("text-md", it.pnlPct >= 0 ? "text-up" : "text-down")}>{it.pnlPct >= 0 ? "▲" : "▼"} {pctTxt(it.pnlPct)}</span>}
        </span>
      )}
    </>
  );
  const cls = "mt-2 flex items-center gap-3 rounded-card border border-rule-2 bg-paper-3/60 px-3 py-2.5";
  return href ? <a href={href} className={cn(cls, "transition-colors duration-100 hover:border-muted")}>{inner}</a> : <div className={cls}>{inner}</div>;
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
    <div className="mt-2 overflow-hidden rounded-card border border-rule-2 bg-paper-3/60">
      {it.title && <div className="border-b border-rule bg-paper-3 px-3 py-2 text-md font-semibold text-ink">{it.title}</div>}
      <div className="px-3 py-2.5 text-md leading-relaxed whitespace-pre-line text-ink-2"><Rich text={open || !long ? text : `${text.slice(0, 200).replace(/\s+\S*$/, "")} …`} /></div>
      {long && <button onClick={() => setOpen(!open)} className="px-3 pb-2.5 text-md font-medium text-muted hover:text-ink">{open ? "Show less" : "Show more"}</button>}
    </div>
  );
}

function Who({ u }: { u: User | null }) {
  if (!u) return null;
  const name = <b className="truncate text-lg font-semibold text-ink">{u.name}</b>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {u.handle ? <a href={traderHref(u.handle)} className="min-w-0 truncate hover:underline">{name}</a> : name}
      {u.fomo && <span className="grid size-4 shrink-0 place-items-center rounded-full bg-info text-white"><Check className="size-3" /></span>}
      {u.clan?.pic && <img src={u.clan.pic} alt="" title={u.clan.name} loading="lazy" className="size-4 shrink-0 rounded-[4px] object-cover" />}
    </span>
  );
}

function Row({ it }: { it: Item }) {
  const u = it.user;
  const pic = u?.fomo
    ? <span className="grid size-10 shrink-0 place-items-center rounded-full bg-info text-lg font-black text-white">f</span>
    : u?.handle ? <a href={traderHref(u.handle)} className="shrink-0"><Avatar src={u.pic} size={40} /></a> : <span className="block size-10 shrink-0"><TokenPic mint={it.mint} chain={it.chain} img={it.img} /></span>;
  let pill: ReactNode = null, body: ReactNode = null;
  switch (it.type) {
    case "large_buy": case "large_sell": case "large_transfer_in": case "large_transfer_out":
      pill = <Pill tone={it.side === "buy" ? "up" : "down"}>{it.transfer ? (it.side === "buy" ? "Received" : "Sent") : it.side === "buy" ? (it.firstBuy ? "First buy" : "Buy") : "Sell"}</Pill>;
      body = (
        <div className="num mt-1 flex flex-wrap items-center gap-x-1.5 text-lg">
          <Coin it={it} /><b className="font-semibold text-ink">{usd(it.usd)}</b><span className="text-muted">at</span><b className="font-semibold text-ink">{usd(it.mc)}</b><span className="text-muted">MC</span>
          {it.side === "sell" && it.pnlUsd ? <span className={cn("ml-1 text-md font-semibold", it.pnlUsd >= 0 ? "text-up" : "text-down")}>{it.pnlUsd >= 0 ? "+" : "−"}{usd(Math.abs(it.pnlUsd))} realized</span> : null}
        </div>
      );
      break;
    case "single_user_sell": case "single_user_transfer_out":
      pill = <Pill tone="ink">Closed</Pill>; body = <><Card it={it} /></>; break;
    case "thesis_created":
      pill = <Pill tone="info">Thesis</Pill>;
      body = <Card it={it} sub={<>{usd(it.mc)} MC{it.entryMc ? <span> · entry {usd(it.entryMc)}</span> : null}</>} />; break;
    case "user_trade_profit_milestone":
      pill = <Pill tone="up">Profit milestone</Pill>; body = <Card it={it} sub={<>{usd(it.mc)} MC{it.sizeUsd ? <span> · cost {usd(it.sizeUsd)}</span> : null}</>} />; break;
    case "multi_user_buy": case "multi_user_sell":
      pill = <Pill tone={it.side === "buy" ? "up" : "down"}>{it.side === "buy" ? "Buying" : "Selling"}</Pill>;
      body = (
        <div className="num mt-1 flex flex-wrap items-center gap-x-1.5 text-lg">
          <span className="flex">{(it.users || []).map((x, i) => <a key={x.handle} href={traderHref(x.handle)} title={x.name} className={cn(i && "-ml-2")}><Avatar src={x.pic} size={24} /></a>)}</span>
          <span className="text-ink-2">{it.count ?? it.users?.length ?? "Several"} traders</span><Coin it={it} />{it.usd ? <b className="font-semibold text-ink">{usd(it.usd)}</b> : null}
          <span className="text-muted">at</span><b className="font-semibold text-ink">{usd(it.mc)}</b><span className="text-muted">MC</span>
        </div>
      );
      break;
    case "new_token_listing":
      pill = <Pill tone="warn">New listing</Pill>;
      body = <><div className="num mt-1 flex items-center gap-x-1.5 text-lg"><Coin it={it} /><span className="text-muted">listed at</span><b className="font-semibold text-ink">{usd(it.mc)}</b><span className="text-muted">MC</span></div>
        {it.notes && <p className="mt-1 text-md text-ink-2">{it.notes}</p>}</>;
      break;
    case "price_since_listing":
      pill = <Pill tone={(it.chg ?? 0) >= 0 ? "up" : "down"}>Price spike</Pill>;
      body = <div className="num mt-1 flex flex-wrap items-center gap-x-1.5 text-lg"><Coin it={it} />{it.chg != null && <b className={cn("font-semibold", it.chg >= 0 ? "text-up" : "text-down")}>{it.chg >= 0 ? "▲" : "▼"} {pctTxt(it.chg)}</b>}<span className="text-muted">since listing ·</span><b className="font-semibold text-ink">{usd(it.mc)}</b><span className="text-muted">MC</span></div>;
      break;
    case "user_with_smart_following":
      pill = <Pill tone="info">New trader</Pill>;
      body = (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-md text-ink-2">
          <span className="flex">{(it.followedBy || []).map((x, i) => <a key={x.handle} href={traderHref(x.handle)} title={x.name} className={cn(i && "-ml-2")}><Avatar src={x.pic} size={24} /></a>)}</span>
          <span>Followed by <b className="num font-semibold text-ink">{(it.smart ?? 0).toLocaleString()}</b> smart traders{it.followers ? <> · {it.followers.toLocaleString()} followers</> : null}</span>
        </div>
      );
      break;
    case "manual":
      body = <Pinned it={it} />; break;
  }
  return (
    <article className="flex gap-3 border-b border-rule px-4 py-4 last:border-b-0">
      {pic}
      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-2">
          <Who u={u} />{pill}
          <span className="ml-auto flex shrink-0 items-center gap-2 text-md text-muted">{since(it.t)}{it.pinned && <span className="flex items-center gap-1">📌 Pinned</span>}</span>
        </header>
        {it.comment && it.type !== "manual" && <p className="mt-1 text-lg leading-snug break-words text-ink">{it.comment}</p>}
        {body}
        {(it.pinned || it.likes > 0) && (
          <span className="num mt-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-rule-2 px-3 text-md text-ink-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>{it.likes}
          </span>
        )}
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
  const all = groups.length === ALL.length;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className={cn("flex h-8 items-center gap-1.5 rounded-full px-2 text-md transition-colors duration-100 hover:text-ink", all ? "text-muted" : "text-ink")}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="size-4" aria-hidden><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" /></svg>
        Filter{!all && <span className="num rounded-full bg-paper-4 px-1.5 text-xs">{groups.length}</span>}
      </button>
      {open && (
        <div className="absolute top-9 left-0 z-30 w-72 overflow-hidden rounded-card border border-rule-2 bg-paper-2 shadow-2xl">
          <button onClick={() => onChange(all ? [] : ALL)} className="w-full border-b border-rule px-4 py-3 text-left text-lg font-semibold text-accent hover:text-focus">{all ? "Deselect all" : "Select all"}</button>
          {GROUPS.map(([k, label]) => {
            const on = groups.includes(k);
            return (
              <button key={k} onClick={() => onChange(on ? groups.filter((g) => g !== k) : ALL.filter((g) => g === k || groups.includes(g)))}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-lg text-ink hover:bg-paper-3">
                {label}
                <span className={cn("grid size-5 place-items-center rounded-md border", on ? "border-accent bg-accent text-accent-ink" : "border-rule-2")}>{on && <Check className="size-3.5" />}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Feed() {
  const [groups, setGroups] = useState<string[]>(loadGroups);
  const pick = (g: string[]) => { setGroups(g); try { localStorage.setItem(KEY, JSON.stringify(g)); } catch {} };
  const { data: d, error } = usePoll<Feed>(groups.length ? `fomo/feed?groups=${groups.join(",")}` : null, 3000);
  // Re-draw the clocks ("19s") between reads.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const items = d?.items;
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 p-3 max-md:pb-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl leading-none font-bold tracking-tight">Feed</h1>
          <p className="mt-1.5 text-md text-muted">What Fomo traders are buying, selling and saying, live from Fomo.</p>
        </div>
        {d?.t ? <span className="flex items-center gap-1.5 text-sm text-muted"><span className={cn("size-1.5 rounded-full", d.error ? "bg-warn" : "bg-up")} />{d.error ? "Last read" : "Live"} · {since(d.t)}</span> : null}
      </header>
      <section className="min-w-0 rounded-card border border-rule bg-paper-2">
        <div className="border-b border-rule px-2 py-1.5"><Filter groups={groups} onChange={pick} /></div>
        {!groups.length ? <Empty>Pick something in Filter to see the feed.</Empty>
          : d?.signedOut ? <Empty>Aside is signed out of Fomo. Sign in at fomo.family in Aside and the feed fills in.</Empty>
          : items ? (items.length ? items.map((it) => <Row key={it.id} it={it} />) : <Empty>Nothing on Fomo's feed for this filter right now.</Empty>)
          : error ? <div className="p-3"><Problem text={error} /></div>
          : d?.error ? <div className="p-3"><Problem text={d.error} /></div>
          : <div className="flex flex-col gap-2 p-3"><Loading /><p className="text-center text-sm text-muted">Reading Fomo's feed through Aside…</p></div>}
      </section>
    </div>
  );
}
