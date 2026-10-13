// A coin's X link with Axiom's hover card: rest the pointer on the X icon and see who or what it points at (a
// profile: banner, picture, name, bio, followers; a post: its author, text, photo and counts; a community or a
// search: what the address says). Read from server/xcard.js (FxTwitter, free), once per link, shared by every
// card on the page. The card is read as soon as its icon is on screen, so it opens the instant the pointer
// arrives; a link X can no longer read (post deleted, account suspended) shows the last card Blix saw, with the
// reason. The icon says what the link is: a person for an account, a group for a community, X's mark for a post.
import { cloneElement, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Isolate } from "@/components/ui/isolate";
import { api } from "@/lib/api";
import { thumb } from "@/lib/thumb";
import { cn } from "@/lib/utils";

type Person = { handle: string; name: string; avatar: string | null; banner: string | null; bio: string; followers: number | null; following: number | null; posts: number | null; joined: number | null; verified: boolean; verifiedType: string | null };
type Seen = { seen?: number; gone?: string; missing?: boolean; reason?: string; retry?: boolean };
type Card =
  | ({ kind: "profile"; url: string; handle?: string } & Seen & Partial<Person>)
  | ({ kind: "post"; url: string; handle: string; author?: Person; text?: string; t?: number | null; likes?: number | null; reposts?: number | null; replies?: number | null; views?: number | null; photo?: string | null; video?: boolean } & Seen)
  | ({ kind: "community"; url: string; id: string; name?: string; description?: string; members?: number | null; created?: number | null; open?: boolean; banner?: string | null; faces?: string[]; rules?: string[];
      creator?: (Partial<Person> & { handle: string }) | null } & Seen)
  | { kind: "search"; url: string; q: string }
  | { kind: "other" | "invalid"; url?: string };

export type XKind = "profile" | "post" | "community" | "search" | "other";
// What an X link points at, from its address alone (the same reading as server/xcard.js parseX).
export function xKind(u: string): XKind {
  let url: URL;
  try { url = new URL(u); } catch { return "other"; }
  if (!/(^|\.)(x|twitter)\.com$/i.test(url.hostname)) return "other";
  const p = url.pathname.split("/").filter(Boolean);
  if (p[0] === "i" && p[1] === "communities" && /^\d{5,25}$/.test(p[2] || "")) return "community";
  if (p[0] === "search") return "search";
  if (/^\w{1,15}$/.test(p[0] || "") && (p[1] === "status" || p[1] === "statuses") && /^\d{5,25}$/.test(p[2] || "")) return "post";
  if (/^\w{1,15}$/.test(p[0] || "") && !["home", "explore", "i", "intent", "hashtag", "share", "search", "settings", "messages", "notifications", "compose"].includes(p[0].toLowerCase()) && p.length === 1) return "profile";
  return "other";
}
export const xKindLabel = (k: XKind) => (k === "profile" ? "X account" : k === "post" ? "X post" : k === "community" ? "X community" : k === "search" ? "X search" : "X");

// The icon for a link: a person (an account), a small group (a community), X's mark (a post or anything else).
const XMark = ({ className }: { className?: string }) => <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0 fill-current", className)}><path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.3zm-1.2 18h1.9L7.4 3.9H5.4z" /></svg>;
const PersonMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0 fill-current", className)}><path d="M12 12.5a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.6 0-9 2.4-9 5.6 0 .8.6 1.4 1.4 1.4h15.2c.8 0 1.4-.6 1.4-1.4 0-3.2-4.4-5.6-9-5.6z" /></svg>
);
const GroupMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0 fill-current", className)}>
    <path d="M12 11.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 1.7c-3.6 0-7 1.9-7 4.5 0 .7.5 1.3 1.2 1.3h11.6c.7 0 1.2-.6 1.2-1.3 0-2.6-3.4-4.5-7-4.5z" />
    <path d="M5 11a2.8 2.8 0 1 0 0-5.6A2.8 2.8 0 0 0 5 11zm14 0a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6z" opacity=".75" />
    <path d="M3.8 17.7c0-1.9 1.1-3.5 2.9-4.7A6.5 6.5 0 0 0 5 12.8c-2.6 0-5 1.4-5 3.4 0 .6.4 1 1 1h2.8zm16.4 0H23c.6 0 1-.4 1-1 0-2-2.4-3.4-5-3.4-.6 0-1.2.1-1.7.2 1.8 1.2 2.9 2.8 2.9 4.2z" opacity=".75" />
  </svg>
);
export function XLinkIcon({ href, kind, className }: { href?: string; kind?: XKind; className?: string }) {
  const k = kind ?? xKind(href || "");
  return k === "profile" ? <PersonMark className={className} /> : k === "community" ? <GroupMark className={className} /> : <XMark className={className} />;
}

// One read per link, shared by every card on the page. A link X did not answer about just now is asked for
// again a moment later (the server tries another source), up to a few times, so the card gets there.
const cards = new Map<string, Promise<Card | null>>();
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
export const load = (u: string) => {
  let p = cards.get(u);
  if (!p) {
    p = (async () => {
      let c: Card | null = null;
      for (let i = 0; i < 4; i++) {
        c = await api<Card>(`xcard?u=${encodeURIComponent(u)}`).catch(() => null);
        if (c && !("retry" in c && c.retry)) break;
        await sleep(600 * (i + 1));
      }
      if (!c) cards.delete(u);   // nothing came back at all: the next hover asks again
      return c;
    })();
    cards.set(u, p); if (cards.size > 800) cards.delete(cards.keys().next().value!);
  }
  return p;
};
// Reads the card shortly after the icon is drawn (Pulse and Discover draw only the rows on screen), and the
// pictures it will show, so hovering opens it whole at once. An icon gone again within 200 ms (rows scrolling
// past) is not read.
const pics = new Set<string>();
const warmPic = (src: string | null | undefined, px: number, fit?: "inside") => {
  const u = src && thumb(src, px, fit ? { fit } : undefined);
  if (!u || pics.has(u)) return;
  pics.add(u); if (pics.size > 1500) pics.clear();
  const i = new Image(); i.decoding = "async"; i.src = u;
};
export function prefetch(href: string) {
  load(href).then((c) => {
    if (!c) return;
    if (c.kind === "profile") { warmPic(c.avatar, 52); warmPic(c.banner, 320, "inside"); }
    else if (c.kind === "post") { warmPic(c.author?.avatar, 44); warmPic(c.photo, 360, "inside"); }
    else if (c.kind === "community") { warmPic(c.banner, 320, "inside"); warmPic(c.creator?.avatar, 30); c.faces?.slice(0, 5).forEach((f) => warmPic(f, 18)); }
  });
}
function watch(href: string) {
  const t = window.setTimeout(() => prefetch(href), 200);
  return () => clearTimeout(t);
}

const n = (v: number | null | undefined) => (v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : v.toLocaleString());
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

// A post, laid out for reading: the author with their badge and when it was posted, the text at a comfortable size
// with its paragraphs kept (runs of blank lines folded to one), the photo, then the counts as X shows them, each with
// its icon. A long post fades out at the bottom rather than ending mid-word with dots.
const Stat = ({ d, v, label }: { d: string; v: number | null | undefined; label: string }) => (
  <span className="flex items-center gap-1.5" title={`${v == null ? "—" : v.toLocaleString()} ${label}`}>
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
    <span className="font-semibold text-ink-2">{n(v)}</span>
  </span>
);
const when = (t: number) => {
  const s = (Date.now() - t) / 1000;
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : s < 7 * 86400 ? `${Math.floor(s / 86400)}d`
    : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
function Post({ c }: { c: Extract<Card, { kind: "post" }> }) {
  const a = c.author;
  const text = (c.text || "").replace(/\n{3,}/g, "\n\n").trim();
  const long = text.length > 280 || text.split("\n").length > 7;
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-3 px-4 pt-4">
        <Pic src={a?.avatar} size={44} className="ring-1 ring-edge" />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex min-w-0 items-center gap-1"><b className="truncate text-[15px] leading-tight font-bold text-ink">{a?.name || c.handle}</b>{a?.verified && <Badge type={a.verifiedType} />}</div>
          <div className="num mt-0.5 truncate text-sm text-muted">@{a?.handle || c.handle}{a?.followers != null ? <> · <span className="text-ink-2">{n(a.followers)}</span> followers</> : null}</div>
        </div>
        <span className="flex shrink-0 items-center gap-2 pt-0.5 text-sm text-muted">
          {c.t ? <span className="num" title={new Date(c.t).toLocaleString()}>{when(c.t)}</span> : null}
          <XMark className="size-4 text-ink-2" />
        </span>
      </div>
      {text && (
        <div className="relative px-4 pt-3">
          <p className={cn("text-[15px] leading-[1.5] break-words whitespace-pre-line text-ink", long && "max-h-[13.5em] overflow-hidden")}>{text}</p>
          {long && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-paper-2 to-transparent" />}
        </div>
      )}
      {c.photo && <div className="px-4 pt-3"><img src={thumb(c.photo, 360, { fit: "inside" })} alt="" decoding="async" className="max-h-52 w-full rounded-[14px] object-cover ring-1 ring-rule" /></div>}
      <div className="num mt-3 flex items-center justify-between border-t border-rule px-4 py-2.5 text-sm text-muted">
        <Stat label="replies" v={c.replies} d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.7 8.7 0 0 1-4-1L3 20l1.3-4.6A8.1 8.1 0 0 1 3.5 11.5 8.4 8.4 0 0 1 12 3.2a8.4 8.4 0 0 1 9 8.3z" />
        <Stat label="reposts" v={c.reposts} d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />
        <Stat label="likes" v={c.likes} d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21.2l8.8-8.8a5.5 5.5 0 0 0 0-7.8z" />
        <Stat label="views" v={c.views} d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </div>
    </div>
  );
}

// A community: its banner, name and member count with a few members' faces, what it says about itself, who made
// it (picture, followers) and its rules. Read as a logged-out visitor (server/xcard.js).
function Community({ c }: { c: Extract<Card, { kind: "community" }> }) {
  const by = c.creator;
  return (
    <>
      <div className="relative h-20 bg-paper-4">
        {c.banner && <img src={thumb(c.banner, 320, { fit: "inside" })} alt="" decoding="async" className="size-full object-cover" />}
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-2xs font-semibold text-white backdrop-blur-sm"><XMark className="size-2.5" />Community</span>
      </div>
      <div className="flex flex-col gap-2.5 px-3.5 pt-2.5 pb-3.5">
        <div className="min-w-0">
          <b className="block truncate text-lg leading-tight font-semibold text-ink">{c.name || "X Community"}</b>
          <div className="num mt-1 flex items-center gap-2 text-sm text-muted">
            {!!c.faces?.length && <span className="flex">{c.faces.slice(0, 5).map((f, i) => <Pic key={f} src={f} size={18} className={cn("ring-2 ring-paper-2", i && "-ml-1.5")} />)}</span>}
            <span><b className="font-semibold text-ink">{n(c.members)}</b> {c.members === 1 ? "member" : "members"}</span>
            {c.created ? <span>· since {new Date(c.created).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span> : null}
          </div>
        </div>
        {c.description && <p className="line-clamp-3 text-sm leading-snug break-words whitespace-pre-line text-ink-2">{c.description}</p>}
        {by && (
          <div className="flex min-w-0 items-center gap-2.5 rounded-card bg-paper-3/70 px-2.5 py-2">
            <Pic src={by.avatar} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1"><b className="truncate text-sm font-semibold text-ink">{by.name || by.handle}</b>{by.verified && <Badge type={by.verifiedType ?? null} />}</div>
              <div className="num truncate text-xs text-muted">@{by.handle}{by.followers != null ? ` · ${n(by.followers)} followers` : ""}</div>
            </div>
            <span className="shrink-0 text-2xs font-semibold tracking-wider text-muted uppercase">Creator</span>
          </div>
        )}
        {!!c.rules?.length && (
          <div className="flex flex-wrap gap-1">
            {c.rules.map((r) => <span key={r} className="max-w-full truncate rounded-full bg-paper-3/70 px-2 py-0.5 text-xs text-ink-2">{r}</span>)}
          </div>
        )}
      </div>
    </>
  );
}

// A link with no card to draw: what it is (icon, title), the reason, and the address. Never a bare error.
function Plain({ kind, title, sub, url }: { kind?: XKind; title: string; sub?: string; url?: string }) {
  return (
    <div className="flex items-center gap-3 p-3.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-black text-white ring-1 ring-edge"><XLinkIcon kind={kind || "other"} className="size-4.5" /></span>
      <div className="min-w-0">
        <b className="block text-md font-semibold text-ink">{title}</b>
        {sub && <span className="block text-sm leading-snug text-muted">{sub}</span>}
        {url && <span className="mt-0.5 block truncate text-xs text-muted">{url.replace(/^https:\/\//, "")}</span>}
      </div>
    </div>
  );
}
// X can no longer show this link: the card is the last one Blix saw, and this says so.
const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const Gone = ({ c }: { c: Extract<Card, { kind: "profile" | "post" | "community" }> }) => c.gone ? (
  <div className="flex items-center gap-2 border-b border-warn/25 bg-warn/[0.08] px-3.5 py-1.5 text-xs text-warn">
    <svg viewBox="0 0 24 24" aria-hidden className="size-3.5 shrink-0 fill-none stroke-current" strokeWidth="2" strokeLinecap="round"><path d="M12 8v5M12 16.5v.5M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
    <span className="min-w-0 truncate">{c.gone.replace(/\.$/, "")}{c.seen ? ` · as seen ${ago(c.seen)}` : ""}</span>
  </div>
) : null;

function Body({ c, href }: { c: Card | null | undefined; href: string }) {
  const k = xKind(href);
  if (c === undefined) return (
    <div className="flex flex-col gap-2 p-3.5" aria-hidden>
      <span className="h-10 w-10 animate-pulse rounded-full bg-paper-4" /><span className="h-3 w-40 animate-pulse rounded-full bg-paper-4" /><span className="h-3 w-56 animate-pulse rounded-full bg-paper-4" />
    </div>
  );
  if (!c || c.kind === "invalid") return <Plain kind={k} title={xKindLabel(k)} sub="X didn't answer just now. The link still opens on X." url={href} />;
  if (c.kind === "profile") return c.missing ? <Plain kind="profile" title={`@${c.handle ?? ""}`} sub={c.reason || "This account couldn't be read."} url={c.url} /> : <><Gone c={c} /><Profile c={c} /></>;
  if (c.kind === "post") return c.missing ? <Plain kind="post" title={`Post by @${c.handle}`} sub={c.reason || "This post couldn't be read."} url={c.url} /> : <><Gone c={c} /><Post c={c} /></>;
  if (c.kind === "community") return c.missing || !c.name ? <Plain kind="community" title="X Community" sub={c.reason || "This community couldn't be read right now."} url={c.url} /> : <><Gone c={c} /><Community c={c} /></>;
  if (c.kind === "search") return <Plain kind="search" title="X search" sub={`"${c.q}"`} url={c.url} />;
  return <Plain title="X link" url={c.url} />;
}

// Wraps the X link (an <a>): the card is read when the icon comes on screen and opens the moment the pointer (or
// keyboard focus) arrives, below the icon (above it near the bottom of the window), stays open while the pointer
// is on the icon or the card (its links work), and closes 150 ms after it has left both. One card at a time.
let closeOthers: (() => void) | null = null;
export function XHover({ href, children }: { href: string; children: ReactElement<{ onPointerEnter?: (e: unknown) => void; onPointerLeave?: (e: unknown) => void; onFocus?: (e: unknown) => void; onBlur?: (e: unknown) => void; ref?: unknown }> }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const anchor = useRef<HTMLElement | null>(null), timer = useRef(0), open = useRef(false);
  useEffect(() => () => { clearTimeout(timer.current); open.current = false; }, []);
  useEffect(() => watch(href), [href]);
  const close = () => { clearTimeout(timer.current); open.current = false; setPos(null); };
  const show = () => {
    clearTimeout(timer.current);
    open.current = true;
    load(href).then((c) => { if (open.current) setCard(c); });
    const el = anchor.current;
    if (!el) return;
    if (closeOthers && closeOthers !== close) closeOthers();
    closeOthers = close;
    const r = el.getBoundingClientRect(), W = 360;
    const left = Math.max(10, Math.min(r.left, innerWidth - W - 10));
    setPos(r.bottom + 360 > innerHeight && r.top > 360 ? { left, bottom: innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
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
      {pos && createPortal(<Isolate>
        <div role="tooltip" onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={leave}
          className="fixed z-50 w-[360px] max-w-[calc(100vw-20px)] animate-row-in overflow-hidden rounded-[16px] border border-rule-2 bg-paper-2 text-left shadow-sheet" style={pos}>
          <Body c={card} href={href} />
        </div></Isolate>, document.body)}
    </>
  );
}
