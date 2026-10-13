// The pieces of the Narratives page: a narrative card (story, coins with their pictures, the X post it
// came from), the top story, bursts still forming, and the scanner's live status line.
import { useState, type ReactNode } from "react";
import { ago, CoinImg, money, Tag } from "@/components/page";
import { cn } from "@/lib/utils";
import { postTone, safeHref } from "@/lib/format";
import { LiveMc } from "@/components/Live";
import { thumb } from "@/lib/thumb";

export type Coin = { mint: string; symbol: string; name: string | null; mcap: number | null; traders: number | null; chg1h: number | null; bonded: boolean; dead: boolean; via: "burst" | "match"; lead?: boolean };
export type Post = { id: string; url: string; text: string; author: { name: string; handle: string; avatar: string | null; verified: boolean; followers: number | null }; photos: string[]; video: boolean; likes: number; retweets: number; replies: number; views: number | null; t: number | null; quote: { handle: string; name: string; text: string; avatar: string | null } | null };
export type Burst = { n10: number; n60: number; devs: number; traders: number; volUsd?: number; state?: string; lift?: number };
export type Item = { id: number; name: string; stage: string; confidence: number; grok: boolean; thesis: string; risk: string | null; organic: string | null; real: boolean | null; keywords: string[]; searches: number; t: number; updated: number; detectMs: number | null; burst: Burst | null; coins: Coin[]; sources: { url: string; what: string; when: string }[]; posts: Post[]; heat: number };
export type Forming = { id: string; keys: string[]; n10: number; traders: number; volUsd: number; looking: boolean; since: number | null; coins: Coin[] };
export type Feed = { t: number; items: Item[]; forming: Forming[]; scanner: { launches: number; forming: number; armed: number; armedHits: number; cards: number; lastCardMs: number | null }; grok: { ready: boolean; installed: boolean; blocked: boolean; spentToday: number; budget: number }; scout: { lastOk: number | null; every: number } | null };

const compact = (n?: number | null) => n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
const STAGE: Record<string, ["up" | "down" | "warn" | "info" | "ink", string]> = { early: ["info", "Early"], running: ["up", "Running"], peaking: ["warn", "Peaking"], dead: ["down", "Fading"] };
export const StageTag = ({ stage }: { stage: string }) => { const [tone, text] = STAGE[stage] || ["ink", stage]; return <Tag tone={tone}>{text}</Tag>; };

// xAI's Grok mark, white on a black disc (same artwork as the rail's plate).
export function GrokMark({ size = 16 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-black shadow-[0_0_0_1px_oklch(100%_0_0/0.22)]" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" aria-hidden className="fill-white" style={{ width: Math.round(size * 0.6), height: Math.round(size * 0.6) }}>
        <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
      </svg>
    </span>
  );
}
export function GrokBadge({ item }: { item: Item }) {
  if (!item.grok) return <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full border border-rule-2 px-2 text-sm text-muted">On-chain only</span>;
  return (
    <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full border border-ink/15 bg-ink/5 pr-2 pl-0.5 text-sm font-medium text-ink-2" title={`Grok searched X ${item.searches || 0} time${item.searches === 1 ? "" : "s"}`}>
      <GrokMark size={18} />Grok · {item.confidence}%
    </span>
  );
}

// A coin's picture, ticker fallback underneath for when the picture is missing.
export function CoinPic({ c, size = 36, ring }: { c: Pick<Coin, "mint" | "symbol">; size?: number; ring?: boolean }) {
  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-paper-4 font-semibold text-muted uppercase", ring && "ring-2 ring-ink/70 ring-offset-2 ring-offset-paper-2")}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.26) }}>
      {(c.symbol || "?").slice(0, 3)}
      <CoinImg mint={c.mint} />
    </span>
  );
}

// A coin tile: picture, ticker, market cap, buyers. Opens the coin page.
export function CoinTile({ c }: { c: Coin }) {
  return (
    <a href={`#/coin/${c.mint}`} title={c.name || c.symbol}
      className={cn("group flex min-w-0 items-center gap-2 rounded-control border border-rule bg-paper/60 p-1.5 pr-2.5 transition-colors hover:border-rule-2 hover:bg-paper-3")}>
      <CoinPic c={c} size={30} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="flex items-center gap-1"><b className="truncate text-md font-semibold text-ink">${c.symbol}</b>{c.lead && <span className="rounded-sm bg-ink/10 px-1 text-2xs font-semibold text-ink-2 uppercase">lead</span>}</span>
        <span className="num truncate text-sm text-muted"><LiveMc mint={c.mint} value={c.mcap} fmt={money} className="font-normal" />{c.traders ? ` · ${c.traders} buyers` : ""}</span>
      </span>
      {c.chg1h != null && Math.abs(c.chg1h) >= 1 && <span className={cn("num ml-auto pl-1 text-sm font-medium", c.chg1h > 0 ? "text-up" : "text-down")}>{c.chg1h > 0 ? "+" : ""}{Math.round(c.chg1h)}%</span>}
    </a>
  );
}

const XLogo = () => <svg viewBox="0 0 24 24" aria-hidden className="size-3.5 fill-current"><path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.3zm-1.2 18h1.9L7.4 3.9H5.4z" /></svg>;

// The X post a narrative came from, as it looks on X: author, text, picture, counts.
export function PostCard({ p, big }: { p: Post; big?: boolean }) {
  return (
    <a href={safeHref(p.url) || undefined} target="_blank" rel="noopener noreferrer" className="block rounded-card border border-rule bg-paper/70 p-3 transition-colors hover:border-rule-2 hover:bg-paper-3/70">
      <div className="flex items-center gap-2.5">
        <span className="relative size-9 shrink-0 overflow-hidden rounded-full bg-paper-4">{p.author.avatar && <img src={thumb(p.author.avatar, 36)} alt="" loading="lazy" className="size-full object-cover" />}</span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="flex items-center gap-1"><b className="truncate font-semibold text-ink">{p.author.name || p.author.handle}</b>{p.author.verified && <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 fill-info" aria-label="verified"><path d="M22.5 12.5c0-1.6-.9-2.9-2.2-3.6.5-1.4.2-3-.9-4.1s-2.7-1.4-4.1-.9C14.6 2.6 13.3 1.7 11.7 1.7s-2.9.9-3.6 2.2c-1.4-.5-3-.2-4.1.9s-1.4 2.7-.9 4.1C1.8 9.6.9 10.9.9 12.5s.9 2.9 2.2 3.6c-.5 1.4-.2 3 .9 4.1s2.7 1.4 4.1.9c.7 1.3 2 2.2 3.6 2.2s2.9-.9 3.6-2.2c1.4.5 3 .2 4.1-.9s1.4-2.7.9-4.1c1.3-.7 2.2-2 2.2-3.6zm-12.4 4.6L6 13l1.4-1.4 2.7 2.7 6.4-6.4L18 9.3z" /></svg>}</span>
          <span className="truncate text-sm text-muted">@{p.author.handle}{p.author.followers != null ? ` · ${compact(p.author.followers)} followers` : ""}{p.t ? <> · <span className={cn("font-medium", postTone(Date.now() - p.t))}>{ago(p.t)}</span></> : ""}</span>
        </span>
        <span className="ml-auto text-muted"><XLogo /></span>
      </div>
      {p.text && <p className={cn("mt-2 text-md leading-snug whitespace-pre-line text-ink-2 [overflow-wrap:anywhere]", big ? "line-clamp-6" : "line-clamp-4")}>{p.text}</p>}
      {p.quote && (
        <div className="mt-2 rounded-control border border-rule p-2">
          <span className="flex items-center gap-1.5 text-sm"><span className="size-4 overflow-hidden rounded-full bg-paper-4">{p.quote.avatar && <img src={thumb(p.quote.avatar, 16)} alt="" loading="lazy" className="size-full object-cover" />}</span><b className="font-semibold text-ink-2">{p.quote.name}</b><span className="text-muted">@{p.quote.handle}</span></span>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{p.quote.text}</p>
        </div>
      )}
      {p.photos.length > 0 && (
        <div className={cn("relative mt-2 grid gap-1 overflow-hidden rounded-control", p.photos.length > 1 && "grid-cols-2")}>
          {p.photos.slice(0, big ? 4 : 2).map((src) => <img key={src} src={thumb(src, 480, { fit: "inside" })} alt="" loading="lazy" decoding="async" className={cn("w-full bg-paper-4 object-cover", big ? "max-h-72" : "max-h-44", p.photos.length > 1 && "aspect-square max-h-none")} />)}
          {p.video && <span className="absolute inset-0 grid place-items-center"><span className="grid size-11 place-items-center rounded-full bg-black/60 backdrop-blur-sm"><svg viewBox="0 0 24 24" className="ml-0.5 size-5 fill-white"><path d="M8 5v14l11-7z" /></svg></span></span>}
        </div>
      )}
      <div className="num mt-2 flex gap-4 text-sm text-muted">
        <span>{compact(p.replies)} replies</span><span>{compact(p.retweets)} reposts</span><span>{compact(p.likes)} likes</span>{p.views != null && <span>{compact(p.views)} views</span>}
      </div>
    </a>
  );
}

// A source Grok cited that has not been read yet (or is not an X post).
function SourceLink({ s }: { s: Item["sources"][number] }) {
  let host = "", path = ""; try { const u = new URL(s.url); host = u.hostname.replace(/^www\./, ""); path = u.pathname; } catch { /* shown as given */ }
  // Links the launches shared carry no description of their own: name them by where they point.
  const xUser = /x\.com|twitter\.com/.test(host) ? path.split("/").filter(Boolean)[0] : "";
  const where = xUser && xUser !== "i" ? `@${xUser}${/\/status\//.test(path) ? "'s post" : ""}` : /x\.com|twitter\.com/.test(host) ? "a post on X" : host || s.url;
  const generic = !s.what || s.what === "linked by the launches";
  return (
    <a href={safeHref(s.url) || undefined} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-control border border-rule bg-paper/60 px-2.5 py-2 text-sm text-ink-2 hover:border-rule-2">
      {/x\.com|twitter\.com/.test(host) ? <XLogo /> : <span className="size-1.5 rounded-full bg-muted" />}
      <span className="truncate"><b className="font-medium">{generic ? where : s.what}</b>{generic && s.what ? <span className="text-muted"> · {s.what}</span> : s.when ? <span className="text-muted"> · {s.when}</span> : null}</span>
    </a>
  );
}

const Stat = ({ k, v }: { k: string; v: ReactNode }) => <span className="flex flex-col"><span className="label">{k}</span><b className="num mt-1 text-md font-semibold text-ink">{v}</b></span>;

function HeatMeter({ heat, rank }: { heat: number; rank: number }) {
  const pct = Math.min(100, heat);
  return (
    <span className="ml-auto flex shrink-0 flex-col items-end gap-1" title="Heat: buyers, volume, launch pace, Grok's confidence and freshness">
      <span className="num text-sm text-muted">#{rank}</span>
      <span className="flex items-center gap-1.5"><i className="block h-1 w-14 overflow-hidden rounded-full bg-paper-4"><i className="block h-full rounded-full bg-gradient-to-r from-ink-2/60 to-ink" style={{ width: `${pct}%` }} /></i><b className="num text-md font-semibold">{heat}</b></span>
    </span>
  );
}

// One narrative: what it is, its coins, and where it came from.
export function NarrativeCard({ item, rank, big }: { item: Item; rank: number; big?: boolean }) {
  const [more, setMore] = useState(false);
  const burstCoins = item.coins.filter((c) => c.via === "burst"), matches = item.coins.filter((c) => c.via === "match");
  const shown = more ? item.coins : (burstCoins.length ? burstCoins : item.coins).slice(0, big ? 6 : 4);
  const post = item.posts[0], other = item.sources.filter((s) => !item.posts.some((p) => s.url.includes(p.id)));
  const b = item.burst;
  return (
    <article className={cn("@container surface flex min-w-0 flex-col gap-3 p-4 animate-row-in", big && "lg:p-5")}>
      {/* narrow card: pictures and heat share the top line, the title gets the full width under them */}
      <header className="flex items-start gap-3 @max-md:flex-wrap">
        <div className="flex -space-x-2.5 pt-0.5">{item.coins.slice(0, 3).map((c, i) => <span key={c.mint} style={{ zIndex: 3 - i }} className="rounded-full ring-2 ring-paper-2"><CoinPic c={c} size={big ? 44 : 34} /></span>)}</div>
        <div className="min-w-0 flex-1 @max-md:order-last @max-md:basis-full">
          <h3 className={cn("font-bold tracking-tight text-ink [overflow-wrap:break-word]", big ? "chrome-text text-2xl leading-tight" : "text-lg leading-snug")}>{item.name}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><StageTag stage={item.stage} /><GrokBadge item={item} />{item.organic && <Tag tone={item.organic === "organic" ? "up" : "warn"}>{item.organic}</Tag>}<span className="text-sm text-muted">{ago(item.t)}</span></div>
        </div>
        <HeatMeter heat={item.heat} rank={rank} />
      </header>

      <p className={cn("leading-relaxed text-ink-2", big ? "text-lg" : "line-clamp-3 text-md")}>{item.thesis}</p>
      {item.risk && <p className="rounded-control border border-warn/30 bg-warn/5 px-2.5 py-1.5 text-sm text-ink-2"><b className="font-semibold text-warn">Risk </b>{item.risk}</p>}

      {b && <div className="grid grid-cols-4 gap-2 border-y border-rule py-2.5 @max-md:grid-cols-2 @max-md:gap-y-3"><Stat k="Launches 10m" v={b.n10} /><Stat k="Launches 1h" v={b.n60} /><Stat k="Buyers" v={compact(b.traders)} />{b.volUsd != null ? <Stat k="Volume" v={money(b.volUsd)} /> : <Stat k="Launchers" v={b.devs} />}</div>}

      {shown.length > 0 && (
        <div>
          <div className={cn("grid gap-1.5", big ? "grid-cols-3 max-md:grid-cols-2" : "grid-cols-2")}>{shown.map((c) => <CoinTile key={c.mint} c={c} />)}</div>
          {(item.coins.length > shown.length || more) && <button onClick={() => setMore(!more)} className="mt-1.5 text-sm text-muted hover:text-ink-2">{more ? "Fewer coins" : `All ${item.coins.length} coins${matches.length ? ` (${matches.length} by keyword)` : ""}`}</button>}
        </div>
      )}

      {post ? <PostCard p={post} big={big} /> : null}
      {(post ? other.slice(0, 1) : other.slice(0, 2)).map((s) => <SourceLink key={s.url} s={s} />)}

      {item.keywords.length > 0 && <div className="mt-auto flex flex-wrap gap-1">{item.keywords.slice(0, 6).map((k) => <span key={k} className="rounded-full border border-rule px-2 py-0.5 text-sm text-muted">{k}</span>)}</div>}
    </article>
  );
}

// A burst the detector sees but nobody has named yet.
export function FormingRow({ f }: { f: Forming }) {
  return (
    <div className="flex items-center gap-3 border-t border-rule px-4 py-2.5 first:border-t-0">
      <div className="flex -space-x-2">{f.coins.slice(0, 4).map((c) => <span key={c.mint} className="rounded-full ring-2 ring-paper-2"><CoinPic c={c} size={26} /></span>)}</div>
      <div className="min-w-0 flex-1"><b className="block truncate font-semibold">{f.keys.slice(0, 2).join(" · ")}</b><span className="num text-sm text-muted">{f.n10} launches in 10m · {compact(f.traders)} buyers · {money(f.volUsd)}</span></div>
      {f.looking ? <span className="flex items-center gap-1.5 text-sm text-ink-2"><GrokMark size={16} />reading X…</span> : <span className="text-sm text-muted">{ago(f.since)}</span>}
    </div>
  );
}

// "Scanning" line: the detector is always on; Grok is on while its budget lasts.
export function ScannerBar({ feed }: { feed: Feed }) {
  const g = feed.grok, over = g.budget > 0 && g.spentToday >= g.budget;
  const grokText = !g.installed ? "Grok is not signed in" : g.ready ? "Grok is reading new bursts on X" : over ? `Grok's daily budget is used ($${g.spentToday.toFixed(2)} of $${g.budget.toFixed(2)}), X lookups resume tomorrow` : g.blocked ? "Grok is rate limited, retrying" : "Grok is paused";
  return (
    <div className="surface flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-md">
      <span className="flex items-center gap-2 font-semibold"><span className="relative flex size-2.5"><span className="absolute inset-0 animate-ping rounded-full bg-up/70" /><span className="relative size-2.5 rounded-full bg-up" /></span>Scanning every launch</span>
      <span className="num text-muted">{feed.scanner.launches.toLocaleString()} launches compared · {feed.scanner.forming} bursts forming · {feed.scanner.armed} narratives armed</span>
      <span className={cn("flex items-center gap-2", g.ready ? "text-ink-2" : "text-warn")}><GrokMark size={18} />{grokText}</span>
      <span className="num ml-auto text-sm text-muted">updated {ago(feed.t)}</span>
    </div>
  );
}
