// The card that opens when the pointer rests on a Trending row's Posts cell: every thesis, callout and posted trade
// about the coin in the window (server/feedhot.js feedHotPosts), newest first, live: read every 2 s while it is open,
// and a post that arrives while you look slides in at the top. It opens the instant the pointer arrives: the Trending
// list reads every row's newest posts in one batch (warmPosts, every 4 s), so the card draws from memory first and the
// full list lands a moment later. The card sits just below-right of the pointer (flipped
// near the window's edges), stays while the pointer is on it, and closes 150 ms after the pointer has left both the
// cell and the card. Drawn into the body (a portal) so the row under it is not stretched; its clicks stop there,
// and wrapped in <Isolate> (ui/isolate.tsx), so no pointer or click inside it reaches the row behind: a click on a
// trader's name opens the trader, not the row's coin.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Isolate } from "@/components/ui/isolate";
import { PumpLogo } from "@/components/brand";
import { usdK, usePoll } from "@/lib/coin";
import { ageStr, compact } from "@/lib/format";
import { useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { LinkedText } from "../feed/MessageRow";
import { Avatar } from "../traders/parts";

export type HotPost = {
  id: string; src: "fomo" | "pump"; t: number; side: "buy" | "sell" | null; usd: number; name: string | null; pic: string | null;
  handle: string | null; pump: string | null; wallet: string | null; verified: boolean; text: string | null; type: string | null;
  mc: number | null; entryMc: number | null; pnlUsd: number | null; likes: number; replies: number;
};
type Answer = { mint: string; w: number; n: number; traders: number; posts: HotPost[] };
export type Batch = { w: number; coins: Record<string, { n: number; traders: number; posts: HotPost[] }> };

// The newest posts per coin from the list's batch read, by coin and window: what the card shows at once.
const warm = new Map<string, Answer>();
export function warmPosts(b: Batch | null | undefined) {
  if (!b?.coins) return;
  for (const [mint, c] of Object.entries(b.coins)) warm.set(`${mint}:${b.w}`, { mint, w: b.w, ...c });
}

const W = 380, GAP = 12, CLOSE_MS = 120;
const traderHref = (p: HotPost) => (p.wallet ? `#/trader/${p.wallet}` : p.handle ? `#/trader/${encodeURIComponent(p.handle)}` : null);
// What a post is, in a word or two: a trade's side and size, else a thesis.
const kind = (p: HotPost) => (p.side === "buy" ? `Bought ${compact(p.usd)}` : p.side === "sell" ? `Sold ${compact(p.usd)}` : p.text ? "Thesis" : p.type ? p.type.replace(/_/g, " ") : "Post");

// `w`: the window in minutes ("5" | "30" | "60"); `n`: the row's post count (the card's header until its own answer lands).
export function PostsHover({ mint, w, n, traders, children }: { mint: string; w: string; n: number; traders: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const at = useRef({ x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const place = () => {
    const b = box.current; if (!b) return;
    const h = b.offsetHeight || 300;
    let x = at.current.x + GAP, y = at.current.y + GAP;
    if (x + W > innerWidth - 8) x = Math.max(8, at.current.x - GAP - W);
    if (y + h > innerHeight - 8) y = Math.max(8, Math.min(at.current.y - GAP - h, innerHeight - 8 - h));
    b.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  };
  const openNow = () => { clearTimeout(timer.current); setOpen(true); };
  const closeSoon = () => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), CLOSE_MS); };
  const stay = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (open) place(); });   // after every render while open: the card's height changes as posts arrive

  const { data: own } = usePoll<Answer>(open ? `feed/hot/posts?${new URLSearchParams({ mint, w, src: "fomo,pump" })}` : null, 2000);
  // The full list once it has landed, else the batch's newest few (in hand before the pointer arrived).
  const data = own?.mint === mint ? own : warm.get(`${mint}:${w}`) ?? null;
  // Posts newer than the newest the card has shown slide in; what it opened with (and the older ones the full
  // list adds below) are shown still.
  const newest = useRef<number | null>(null);
  const fresh = new Set<string>();
  if (data) {
    const top = data.posts.reduce((m, p) => Math.max(m, p.t), 0);
    if (newest.current != null) for (const p of data.posts) if (p.t > newest.current) fresh.add(p.id);
    newest.current = Math.max(newest.current ?? 0, top);
  }
  useEffect(() => { if (!open) newest.current = null; }, [open]);
  const now = useNow();
  const posts = data?.posts ?? null;
  const count = data ? data.n : n, people = data ? data.traders : traders;

  return (
    <>
      <span className="contents" onPointerEnter={(e) => { if (e.pointerType !== "mouse") return; at.current = { x: e.clientX, y: e.clientY }; openNow(); }}
        // A move while closed opens it too: the list re-sorts as posts come in, and a row that slides under a resting
        // pointer never gets an enter of its own.
        onPointerMove={(e) => { if (!open) { at.current = { x: e.clientX, y: e.clientY }; if (e.pointerType === "mouse") openNow(); } }} onPointerLeave={closeSoon}>
        {children}
      </span>
      {open && createPortal(<Isolate>
        <div ref={box} role="dialog" aria-label={`Posts about this coin in the last ${w} minutes`} onPointerEnter={stay} onPointerLeave={closeSoon}
          onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
          style={{ width: W }}
          className="fixed top-0 left-0 z-50 flex max-h-[460px] flex-col overflow-hidden rounded-[6px] border border-rule-2 bg-paper-2 text-ink shadow-[0_16px_40px_-8px_rgba(0,0,0,0.85)]">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-rule px-3 text-[12px] text-muted">
            <i className="size-1.5 shrink-0 bg-up motion-safe:animate-pulse" />
            <b className="num text-ink">{count}</b> post{count === 1 ? "" : "s"} · <b className="num text-ink">{people}</b> trader{people === 1 ? "" : "s"} · last {w === "60" ? "hour" : `${w} min`}
            <span className="ml-auto text-[10px] font-bold tracking-[0.08em] uppercase">Live</span>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {!posts ? <p className="px-3 py-4 text-sm text-muted">Reading the posts…</p>
              : !posts.length ? <p className="px-3 py-4 text-sm text-muted">No posts kept for this coin in the window yet.</p>
              : posts.map((p) => {
                const href = traderHref(p), name = p.name || p.handle || p.pump || "anon";
                const who = <span className="flex min-w-0 items-center gap-1.5"><Avatar src={p.pic} name={name} size={22} className="shrink-0 ring-1 ring-paper-2" /><b className="truncate text-[13px] font-semibold text-ink">{name}</b>{p.verified && <i aria-label="verified" className="size-1.5 shrink-0 rounded-full bg-info" />}</span>;
                return (
                  <article key={p.id} className={cn("flex flex-col gap-1.5 border-b border-rule/70 px-3 py-2.5 last:border-b-0", fresh.has(p.id) && "animate-row-in bg-up/[0.05]")}>
                    <div className="flex items-center gap-2">
                      {href ? <a href={href} className="min-w-0 hover:text-accent">{who}</a> : who}
                      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
                        {p.src === "pump" ? <PumpLogo className="size-3" /> : <span className="font-semibold">Fomo</span>}
                        <span className="num" title={new Date(p.t).toLocaleString()}>{ageStr(now - p.t)}</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                      <span className={cn("num rounded-[3px] border px-1.5 py-px font-bold", p.side === "buy" ? "border-up/35 bg-up/[0.08] text-up" : p.side === "sell" ? "border-down/35 bg-down/[0.08] text-down" : "border-rule-2 text-ink-2")}>{kind(p)}</span>
                      {(p.entryMc ?? p.mc) != null && <span className="num text-muted">at {usdK(p.entryMc ?? p.mc!)} mc</span>}
                      {p.pnlUsd != null && p.pnlUsd !== 0 && <span className={cn("num font-semibold", p.pnlUsd > 0 ? "text-up" : "text-down")}>{p.pnlUsd > 0 ? "+" : "−"}{compact(Math.abs(p.pnlUsd))}</span>}
                      {p.likes > 0 && <span className="num text-muted">♥ {p.likes}</span>}
                    </div>
                    {p.text && <p className="line-clamp-5 text-[13px] leading-snug break-words whitespace-pre-wrap text-ink-2"><LinkedText text={p.text} /></p>}
                  </article>
                );
              })}
          </div>
        </div></Isolate>, document.body)}
    </>
  );
}
