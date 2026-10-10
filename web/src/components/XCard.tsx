// A coin's X link with Axiom's hover card: rest the pointer on the X icon and see who or what it points at (a
// profile: banner, picture, name, bio, followers; a post: its author, text, photo and counts; a community or a
// search: what the address says). Read from server/xcard.js (FxTwitter, free), once per link, shared by every
// card on the page. The read starts the moment the pointer arrives; the card opens a moment later, so a pointer
// passing over a row of icons opens nothing.
import { cloneElement, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { thumb } from "@/lib/thumb";
import { cn } from "@/lib/utils";

type Person = { handle: string; name: string; avatar: string | null; banner: string | null; bio: string; followers: number | null; following: number | null; posts: number | null; joined: number | null; verified: boolean; verifiedType: string | null };
type Card =
  | ({ kind: "profile"; url: string; missing?: boolean } & Partial<Person>)
  | { kind: "post"; url: string; handle: string; missing?: boolean; author?: Person; text?: string; t?: number | null; likes?: number | null; reposts?: number | null; replies?: number | null; views?: number | null; photo?: string | null; video?: boolean }
  | { kind: "community"; url: string; id: string }
  | { kind: "search"; url: string; q: string }
  | { kind: "other" | "invalid"; url?: string };

const cards = new Map<string, Promise<Card | null>>();
const load = (u: string) => {
  let p = cards.get(u);
  if (!p) { p = api<Card>(`xcard?u=${encodeURIComponent(u)}`).catch(() => null); cards.set(u, p); if (cards.size > 500) cards.delete(cards.keys().next().value!); }
  return p;
};

const n = (v: number | null | undefined) => (v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : v.toLocaleString());
const XMark = ({ className }: { className?: string }) => <svg viewBox="0 0 24 24" aria-hidden className={cn("fill-current", className)}><path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.3zm-1.2 18h1.9L7.4 3.9H5.4z" /></svg>;
const Badge = ({ type }: { type: string | null }) => (
  <svg viewBox="0 0 22 22" aria-label="Verified" className={cn("size-4 shrink-0", type === "Business" ? "fill-warn" : type === "Government" ? "fill-muted" : "fill-info")}><path d="M20.4 11c0-1.3-.8-2.5-2-3 .4-1.2.1-2.6-.8-3.5-.9-.9-2.3-1.2-3.5-.8-.5-1.2-1.7-2-3.1-2s-2.5.8-3 2c-1.2-.4-2.6-.1-3.5.8-.9.9-1.2 2.3-.8 3.5-1.2.5-2 1.7-2 3s.8 2.6 2 3.1c-.4 1.2-.1 2.6.8 3.5.9.9 2.3 1.2 3.5.8.5 1.2 1.7 2 3 2 1.4 0 2.6-.8 3.1-2 1.2.4 2.6.1 3.5-.8.9-.9 1.2-2.3.8-3.5 1.2-.5 2-1.7 2-3.1zm-11.3 4.4L5.6 12l1.4-1.4 2.1 2.1 4.9-5.3 1.5 1.3-6.4 6.7z" /></svg>
);
const Pic = ({ src, size, className }: { src: string | null | undefined; size: number; className?: string }) => (
  <span className={cn("block shrink-0 overflow-hidden rounded-full bg-paper-4", className)} style={{ width: size, height: size }}>
    {src && <img src={thumb(src, size)} alt="" decoding="async" className="size-full object-cover" />}
  </span>
);

function Profile({ c }: { c: Extract<Card, { kind: "profile" }> }) {
  return (
    <>
      <div className="h-16 bg-paper-4">{c.banner && <img src={thumb(c.banner, 320, { fit: "inside" })} alt="" decoding="async" className="size-full object-cover" />}</div>
      <div className="px-3.5 pb-3.5">
        <Pic src={c.avatar} size={52} className="-mt-6 ring-4 ring-paper-2" />
        <div className="mt-1.5 flex min-w-0 items-center gap-1"><b className="truncate text-md font-semibold text-ink">{c.name}</b>{c.verified && <Badge type={c.verifiedType ?? null} />}</div>
        <div className="text-sm text-muted">@{c.handle}</div>
        {c.bio && <p className="mt-2 line-clamp-4 text-sm leading-snug break-words whitespace-pre-line text-ink-2">{c.bio}</p>}
        <div className="num mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-muted">
          <span><b className="font-semibold text-ink">{n(c.followers)}</b> followers</span>
          <span><b className="font-semibold text-ink">{n(c.following)}</b> following</span>
          {c.joined ? <span>joined {new Date(c.joined).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span> : null}
        </div>
      </div>
    </>
  );
}

function Post({ c }: { c: Extract<Card, { kind: "post" }> }) {
  const a = c.author;
  return (
    <div className="flex flex-col gap-2 p-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Pic src={a?.avatar} size={36} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1"><b className="truncate text-md font-semibold text-ink">{a?.name || c.handle}</b>{a?.verified && <Badge type={a.verifiedType} />}</div>
          <div className="num truncate text-sm text-muted">@{a?.handle || c.handle}{a?.followers != null ? ` · ${n(a.followers)} followers` : ""}</div>
        </div>
      </div>
      {c.text && <p className="line-clamp-6 text-sm leading-snug break-words whitespace-pre-line text-ink">{c.text}</p>}
      {c.photo && <img src={thumb(c.photo, 320, { fit: "inside" })} alt="" decoding="async" className="max-h-44 w-full rounded-card object-cover ring-1 ring-rule" />}
      <div className="num flex flex-wrap gap-x-3 text-xs text-muted">
        {c.t ? <span>{new Date(c.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> : null}
        <span>{n(c.replies)} replies</span><span>{n(c.reposts)} reposts</span><span>{n(c.likes)} likes</span>{c.views != null && <span>{n(c.views)} views</span>}
      </div>
    </div>
  );
}

function Plain({ title, sub, url }: { title: string; sub?: string; url?: string }) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-black text-white ring-1 ring-edge"><XMark className="size-4.5" /></span>
      <div className="min-w-0">
        <b className="block text-md font-semibold text-ink">{title}</b>
        {sub && <span className="block truncate text-sm text-muted">{sub}</span>}
        {url && <span className="mt-0.5 block truncate text-xs text-muted">{url.replace(/^https:\/\//, "")}</span>}
      </div>
    </div>
  );
}

function Body({ c }: { c: Card | null | undefined }) {
  if (c === undefined) return (
    <div className="flex flex-col gap-2 p-3.5" aria-hidden>
      <span className="h-10 w-10 animate-pulse rounded-full bg-paper-4" /><span className="h-3 w-40 animate-pulse rounded-full bg-paper-4" /><span className="h-3 w-56 animate-pulse rounded-full bg-paper-4" />
    </div>
  );
  if (!c || c.kind === "invalid") return <Plain title="X link" sub="Couldn't read this link." />;
  if (c.kind === "profile") return c.missing ? <Plain title={`@${c.handle ?? ""}`} sub="This account couldn't be read (suspended, renamed or private)." url={c.url} /> : <Profile c={c} />;
  if (c.kind === "post") return c.missing ? <Plain title={`Post by @${c.handle}`} sub="This post couldn't be read (deleted or private)." url={c.url} /> : <Post c={c} />;
  if (c.kind === "community") return <Plain title="X Community" sub="Open it on X to see its members and posts." url={c.url} />;
  if (c.kind === "search") return <Plain title="X search" sub={`"${c.q}"`} url={c.url} />;
  return <Plain title="X link" url={c.url} />;
}

// Wraps the X link (an <a>): the card opens 280 ms after the pointer (or keyboard focus) arrives, below the icon
// (above it near the bottom of the window), stays open while the pointer is on the icon or the card (its links
// work), and closes 150 ms after it has left both. One card at a time on the page.
let closeOthers: (() => void) | null = null;
export function XHover({ href, children }: { href: string; children: ReactElement<{ onPointerEnter?: (e: unknown) => void; onPointerLeave?: (e: unknown) => void; onFocus?: (e: unknown) => void; onBlur?: (e: unknown) => void; ref?: unknown }> }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const anchor = useRef<HTMLElement | null>(null), timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = () => { clearTimeout(timer.current); setPos(null); };
  const show = () => {
    clearTimeout(timer.current);
    load(href).then((c) => setCard(c));
    timer.current = window.setTimeout(() => {
      const el = anchor.current;
      if (!el) return;
      if (closeOthers && closeOthers !== close) closeOthers();
      closeOthers = close;
      const r = el.getBoundingClientRect(), W = 320;
      const left = Math.max(10, Math.min(r.left, innerWidth - W - 10));
      setPos(r.bottom + 360 > innerHeight && r.top > 360 ? { left, bottom: innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
    }, 280);
  };
  const leave = () => { clearTimeout(timer.current); timer.current = window.setTimeout(close, 150); };
  // The icon's own pointer and focus handlers are kept; scrolling closes the card (it would be left behind).
  useEffect(() => { if (!pos) return; const s = () => close(); addEventListener("scroll", s, true); return () => removeEventListener("scroll", s, true); }, [pos]);
  const p = children.props;
  const trigger = cloneElement(children, {
    ref: (el: HTMLElement | null) => { anchor.current = el; },
    onPointerEnter: (e: unknown) => { p.onPointerEnter?.(e); show(); }, onPointerLeave: (e: unknown) => { p.onPointerLeave?.(e); leave(); },
    onFocus: (e: unknown) => { p.onFocus?.(e); show(); }, onBlur: (e: unknown) => { p.onBlur?.(e); leave(); },
  });
  return (
    <>
      {trigger}
      {pos && createPortal(
        <div role="tooltip" onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={leave}
          className="fixed z-50 w-80 animate-row-in overflow-hidden rounded-card border border-rule-2 bg-paper-2 text-left shadow-sheet" style={pos}>
          <Body c={card} />
        </div>, document.body)}
    </>
  );
}
