// X tracker (#/x): follow X accounts and see their posts within about a minute, with every coin they name
// (contract addresses, pump.fun / trading links, $tickers) as a chip with its live market cap and a quick buy.
// Free: Blix reads X through the owner's Aside browser in one tab kept open for it (server/xtrack.js).
import { useMemo, useState, type FormEvent } from "react";
import { SolanaLogo } from "@/components/brand";
import { Page, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { post } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { ageStr, compact, pct, postTone, safeHref, shortAddr, tone } from "@/lib/format";
import { useTrade } from "@/lib/mode";
import { trade } from "@/lib/trade";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { LiveMc } from "@/components/Live";
import { thumb } from "@/lib/thumb";

type User = { handle: string; name: string; avatar: string | null };
type Media = { type: string; url: string; video: string | null };
type Inner = { id: string; t: number; user: User; text: string; media?: Media[] };
type XPost = { id: string; handle: string; name: string; avatar: string | null; t: number; text: string; mints: string[]; tickers: string[];
  data: { urls?: string[]; media?: Media[]; replyTo?: string | null; likes?: number; reposts?: number; replies?: number; views?: number | null; quote?: Inner | null; repost?: Inner | null } };
type Account = { handle: string; name: string | null; avatar: string | null; bio: string | null; followers: number | null; added: number; last_post: number | null };
type Change = { id: number; t: number; handle: string; field: string; old: string; new: string };
type Status = { state: "empty" | "no-tab" | "error" | "ok" | "starting" | "fallback"; tab: boolean | null; lastAsideError: string | null; asidePausedFor: number; lastOk: number; lastRun: number; lastError: string | null; running: boolean; tabUrl: string; everySec: number; accounts: number };
type Resp = { status: Status; accounts: Account[]; posts: XPost[]; changes: Change[]; coins: Record<string, { symbol: string | null; name: string | null; mcap: number | null }> };

const SUGGEST = ["blknoiz06", "MustStopMurad", "aeyakovenko", "a1lon9", "pumpdotfun", "notthreadguy", "frankdegods", "theunipcs", "Cupseyy", "orangie"];
const num = (n?: number | null) => (n == null ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

// Post text with links, @handles, $tickers and contract addresses made clickable.
function Rich({ text, mints }: { text: string; mints: string[] }) {
  const parts = text.split(/(https?:\/\/\S+|@[A-Za-z0-9_]{1,15}|\$[A-Za-z][A-Za-z0-9]{1,11}|[1-9A-HJ-NP-Za-km-z]{32,44})/g);
  return (
    <p className="text-md leading-relaxed whitespace-pre-wrap break-words text-ink">
      {parts.map((s, i) => {
        if (/^https?:\/\//.test(s)) return <a key={i} href={s} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{s.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}{s.length > 56 ? "…" : ""}</a>;
        if (/^@/.test(s)) return <a key={i} href={`https://x.com/${s.slice(1)}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{s}</a>;
        if (mints.includes(s)) return <a key={i} href={`#/coin/${s}`} className="rounded bg-up/15 px-1 font-mono text-sm text-up hover:underline">{shortAddr(s)}</a>;
        if (/^\$[A-Za-z]/.test(s)) return <b key={i} className="font-semibold text-accent">{s}</b>;
        return <span key={i}>{s}</span>;
      })}
    </p>
  );
}

function MediaGrid({ media }: { media?: Media[] }) {
  if (!media?.length) return null;
  return (
    <div className={cn("mt-2 grid gap-1 overflow-hidden rounded-card border border-rule", media.length > 1 && "grid-cols-2")}>
      {media.slice(0, 4).map((m) => m.video
        ? <video key={m.url} src={m.video} poster={m.url} controls muted preload="none" className="max-h-80 w-full bg-black object-contain" />
        : <a key={m.url} href={safeHref(m.url) || undefined} target="_blank" rel="noopener noreferrer"><img src={thumb(m.url, 640, { fit: "inside" })} alt="" loading="lazy" decoding="async" className="max-h-80 w-full object-cover" /></a>)}
    </div>
  );
}

// A coin a post names: ticker, live market cap and change, and a quick buy at the Discover amount.
function CoinChip({ mint, info, live }: { mint: string; info?: { symbol: string | null; mcap: number | null }; live?: { mc: number | null; chg: number | null } }) {
  const paper = useTrade((s) => s.paper);
  const [busy, setBusy] = useState(false);
  const sol = store.get<number>("discover:sol", 0.1);
  const symbol = info?.symbol || shortAddr(mint);
  const buy = async () => {
    setBusy(true);
    await trade({ side: "buy", mint, symbol: info?.symbol || "", sol }, () => post("paper/quoted", { mint, sol }));
    setBusy(false);
  };
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full border border-rule-2 bg-paper pr-1 pl-1">
      <a href={`#/coin/${mint}`} className="flex items-center gap-1.5 pl-1 hover:text-ink">
        <img src={`img/${mint}`} alt="" loading="lazy" decoding="async" className="size-5 rounded-full bg-paper-4 object-cover" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
        <b className="text-sm font-semibold">${symbol}</b>
        <LiveMc mint={mint} value={live?.mc ?? info?.mcap ?? null} className="text-sm font-normal text-ink-2" />
        {live?.chg != null && <span className={cn("num text-xs", tone(live.chg))}>{pct(live.chg)}</span>}
      </a>
      <button onClick={buy} disabled={busy} title={paper ? "Paper money" : "Real SOL"}
        className="chrome-fill inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold disabled:opacity-60">
        <Icon.bolt className="size-3" />{sol}<SolanaLogo className="w-2.5" />
      </button>
    </span>
  );
}

function PostCard({ p, coins, live }: { p: XPost; coins: Resp["coins"]; live: Record<string, { mc: number | null; chg: number | null }> }) {
  const shown = p.data.repost || null;
  const author: User = shown ? shown.user : { handle: p.handle, name: p.name, avatar: p.avatar };
  const text = shown ? shown.text : p.text;
  return (
    <article className="border-b border-rule px-4 py-3.5 transition-colors hover:bg-paper-3/40">
      {shown && <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted"><Icon.refresh className="size-3" />{p.name} reposted</p>}
      <div className="flex gap-3">
        <a href={`https://x.com/${author.handle}`} target="_blank" rel="noopener noreferrer" className="shrink-0">
          {author.avatar ? <img src={thumb(author.avatar, 40)} alt="" loading="lazy" decoding="async" className="size-10 rounded-full bg-paper-4" /> : <span className="grid size-10 place-items-center rounded-full bg-paper-4 text-sm">{author.handle[0]}</span>}
        </a>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 text-sm">
            <b className="truncate font-semibold text-ink">{author.name}</b>
            <span className="truncate text-muted">@{author.handle}</span>
            <span className="text-muted">·</span>
            <a href={`https://x.com/${p.handle}/status/${p.id}`} target="_blank" rel="noopener noreferrer" className={cn("num shrink-0 font-medium hover:underline", postTone(Date.now() - p.t))} title={new Date(p.t).toLocaleString()}>{ageStr(Date.now() - p.t)}</a>
          </div>
          {p.data.replyTo && !shown && <p className="text-xs text-muted">Replying to <a href={`https://x.com/${p.data.replyTo}`} target="_blank" rel="noopener noreferrer" className="text-accent">@{p.data.replyTo}</a></p>}
          <div className="mt-1"><Rich text={text} mints={p.mints} /></div>
          <MediaGrid media={shown ? shown.media : p.data.media} />
          {p.data.quote && (
            <div className="mt-2 rounded-card border border-rule p-3">
              <p className="mb-1 flex items-center gap-1.5 text-sm">
                {p.data.quote.user?.avatar && <img src={thumb(p.data.quote.user.avatar, 16)} alt="" loading="lazy" decoding="async" className="size-4 rounded-full" />}
                <b className="font-semibold">{p.data.quote.user?.name}</b><span className="text-muted">@{p.data.quote.user?.handle}</span>
              </p>
              <Rich text={p.data.quote.text} mints={p.mints} />
              <MediaGrid media={p.data.quote.media} />
            </div>
          )}
          {(p.mints.length > 0 || p.tickers.length > 0) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {p.mints.map((m) => <CoinChip key={m} mint={m} info={coins[m] ? { symbol: coins[m].symbol, mcap: coins[m].mcap } : undefined} live={live[m]} />)}
              {p.tickers.filter((t) => !p.mints.some((m) => coins[m]?.symbol?.toUpperCase() === t)).map((t) => (
                <a key={t} href={`#/coins`} onClick={() => store.set("discover:q", t)} className="rounded-full border border-rule-2 px-2.5 py-1 text-xs font-semibold text-accent hover:border-muted">${t}</a>
              ))}
            </div>
          )}
          <div className="num mt-2 flex gap-5 text-xs text-muted">
            <span>{num(p.data.replies)} replies</span><span>{num(p.data.reposts)} reposts</span><span>{num(p.data.likes)} likes</span>{p.data.views ? <span>{num(p.data.views)} views</span> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function Setup({ s }: { s: Status }) {
  if (s.state === "fallback") {
    const noTab = s.tab === false;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-warn/40 bg-warn/10 px-4 py-3">
        <div className="min-w-0">
          <b className="text-md font-semibold">Reading through FxTwitter for now: posts can arrive up to an hour late</b>
          <p className="mt-0.5 text-sm text-ink-2">{noTab ? "Open the X tab in Aside and leave it in the background for posts within a minute." : `Aside could not be read (${s.lastAsideError || "unknown error"}). Blix tries Aside again ${s.asidePausedFor > 0 ? `in ${Math.ceil(s.asidePausedFor / 60_000)} min` : "on the next check"}; if it keeps failing, restart Aside.`}</p>
        </div>
        {noTab && <Button variant="primary" size="lg" asChild><a href={s.tabUrl} target="_blank" rel="noopener">Open the X tab</a></Button>}
      </div>
    );
  }
  if (s.state === "ok" || s.state === "starting" || s.state === "empty") return null;
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-card border px-4 py-3", s.state === "no-tab" ? "border-warn/40 bg-warn/10" : "border-down/40 bg-down/10")}>
      <div className="min-w-0">
        <b className="text-md font-semibold">{s.state === "no-tab" ? "Open the X tab in Aside" : "X could not be read"}</b>
        <p className="mt-0.5 text-sm text-ink-2">
          {s.state === "no-tab"
            ? "Blix reads X for free through one x.com tab in your Aside browser (signed in as you). Open it with this button and leave it open in the background; Blix never reloads it or brings it forward."
            : s.lastError}
        </p>
      </div>
      {s.state === "no-tab" && <Button variant="primary" size="lg" asChild><a href={s.tabUrl} target="_blank" rel="noopener">Open the X tab</a></Button>}
    </div>
  );
}

export function XTracker() {
  const [handle, setHandle] = useState<string | null>(null);
  const [onlyCoins, setOnlyCoins] = useState(() => store.get<boolean>("x:coins", false));
  const [adding, setAdding] = useState("");
  const q = new URLSearchParams({ limit: "150", ...(handle ? { handle } : {}), ...(onlyCoins ? { coins: "1" } : {}) });
  const { data: raw, refresh } = usePoll<Resp>(`x?${q}`, 4000);
  // An answer missing its lists (an older server, a cut-off read) draws as empty rather than taking the page down.
  const data = useMemo(() => raw && { ...raw, accounts: raw.accounts || [], posts: raw.posts || [], changes: raw.changes || [], coins: raw.coins || {} }, [raw]);
  const mints = useMemo(() => [...new Set((data?.posts || []).slice(0, 60).flatMap((p) => p.mints))], [data]);
  const { data: sp } = usePoll<{ rows: Record<string, { mc: number | null; chg: number | null; live?: { mc: number | null } | null }> }>(mints.length ? `sparks?w=1h&m=${mints.join(",")}` : null, 3000);
  const live = useMemo(() => Object.fromEntries(Object.entries(sp?.rows || {}).map(([m, r]) => [m, { mc: r.live?.mc ?? r.mc, chg: r.chg }])), [sp]);
  const s = data?.status;


  const add = async (h: string, e?: FormEvent) => {
    e?.preventDefault();
    if (!h.trim()) return;
    try { await post("x/accounts", { handle: h }); setAdding(""); refresh(); toast(`Tracking @${h.replace(/^@/, "")}`); }
    catch (err) { toast((err as Error).message); }
  };
  const remove = async (h: string) => {
    await fetch(`api/x/accounts/${h}`, { method: "DELETE" }); if (handle === h) setHandle(null); refresh();
  };
  const tracked = new Set((data?.accounts || []).map((a) => a.handle.toLowerCase()));

  return (
    <Page title="X tracker" sub="Posts from the accounts you follow, within about a minute, with every coin they mention. Free: read through your Aside browser."
      right={s && <span className="flex items-center gap-2 text-sm text-muted">
        <i className={cn("size-2 rounded-full", s.state === "ok" ? "bg-up" : s.state === "no-tab" || s.state === "fallback" ? "bg-warn" : s.state === "error" ? "bg-down" : "bg-muted")} />
        {s.state === "ok" || s.state === "fallback" ? `${s.state === "fallback" ? "FxTwitter · " : ""}Read ${ageStr(Date.now() - s.lastOk)} ago${s.running ? " · reading" : ""}` : s.state === "starting" ? "First read soon" : s.state === "empty" ? "Add an account to start" : s.state === "no-tab" ? "Waiting for the X tab" : "Read failed"}
        <Button size="md" onClick={() => post("x/refresh", {}).then(refresh)} disabled={s.running || !s.accounts}><Icon.refresh className="size-3.5" />Read now</Button>
      </span>}>
      {s && <Setup s={s} />}
      <div className="grid items-start gap-3 lg:grid-cols-[300px_minmax(0,1fr)_280px]">
        <Panel title="Accounts" aside={data ? data.accounts.length : ""}>
          <form onSubmit={(e) => add(adding, e)} className="flex gap-1.5 border-b border-rule p-3">
            <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="@handle or x.com link" className="h-8 min-w-0 flex-1 rounded-control border border-rule-2 bg-paper px-3 text-md outline-none focus:border-accent-dim" />
            <Button variant="primary" size="lg" type="submit">Add</Button>
          </form>
          <button onClick={() => setHandle(null)} className={cn("flex w-full items-center justify-between px-4 py-2 text-left text-md", !handle ? "bg-paper-4 font-semibold" : "hover:bg-paper-3")}>All accounts</button>
          {(data?.accounts || []).map((a) => (
            <div key={a.handle} className={cn("group flex items-center gap-2.5 px-4 py-2", handle === a.handle ? "bg-paper-4" : "hover:bg-paper-3")}>
              <button onClick={() => setHandle(a.handle)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                {a.avatar ? <img src={thumb(a.avatar, 32)} alt="" loading="lazy" decoding="async" className="size-8 rounded-full bg-paper-4" /> : <span className="grid size-8 place-items-center rounded-full bg-paper-4 text-xs">{a.handle[0]}</span>}
                <span className="min-w-0"><b className="block truncate text-sm font-semibold">{a.name || a.handle}</b>
                  <span className="block truncate text-xs text-muted">@{a.handle}{a.followers != null ? ` · ${num(a.followers)}` : ""}{a.last_post ? ` · ${ageStr(Date.now() - a.last_post)}` : ""}</span></span>
              </button>
              <Tip tip="Stop tracking"><button onClick={() => remove(a.handle)} aria-label={`Stop tracking @${a.handle}`} className="text-muted opacity-0 group-hover:opacity-100 hover:text-down">×</button></Tip>
            </div>
          ))}
          <div className="border-t border-rule p-3">
            <p className="label mb-2">Popular on Solana</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGEST.filter((h) => !tracked.has(h.toLowerCase())).map((h) => <button key={h} onClick={() => add(h)} className="rounded-full border border-rule-2 px-2 py-0.5 text-xs text-ink-2 hover:border-muted hover:text-ink">+ @{h}</button>)}
            </div>
          </div>
        </Panel>

        <Panel title={handle ? `@${handle}` : "Feed"} aside={
          <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={onlyCoins} onChange={(e) => { setOnlyCoins(e.target.checked); store.set("x:coins", e.target.checked); }} />Only posts with coins</label>}>
          {!data ? <p className="p-6 text-center text-muted">Loading…</p>
            : !data.posts.length ? <p className="p-10 text-center text-md text-muted">{data.accounts.length ? (s?.state === "ok" ? "No posts yet from these accounts." : "Posts appear here after the first read.") : "Add an account on the left, or pick one from Popular on Solana."}</p>
            : data.posts.map((p) => <PostCard key={p.id} p={p} coins={data.coins} live={live} />)}
        </Panel>

        <div className="flex flex-col gap-3 lg:sticky lg:top-3">
          <Panel title="Coins mentioned" aside="newest first">
            {!mints.length ? <p className="px-4 py-6 text-center text-sm text-muted">No coins posted yet.</p> : mints.slice(0, 20).map((m) => {
              const c = data?.coins[m], l = live[m], by = data?.posts.find((p) => p.mints.includes(m));
              return (
                <a key={m} href={`#/coin/${m}`} className="flex items-center gap-2.5 border-b border-rule px-4 py-2 last:border-0 hover:bg-paper-3">
                  <img src={`img/${m}`} alt="" loading="lazy" decoding="async" className="size-7 rounded-full bg-paper-4 object-cover" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
                  <span className="min-w-0 flex-1"><b className="block truncate text-sm font-semibold">${c?.symbol || shortAddr(m)}</b><span className="block truncate text-xs text-muted">@{by?.handle} · {by ? ageStr(Date.now() - by.t) : ""}</span></span>
                  <span className="num text-right text-sm"><LiveMc mint={m} value={l?.mc ?? c?.mcap ?? null} className="block font-normal" /><span className={cn("block text-xs", tone(l?.chg))}>{pct(l?.chg)}</span></span>
                </a>
              );
            })}
          </Panel>
          <Panel title="Profile changes">
            {!data?.changes.length ? <p className="px-4 py-6 text-center text-sm text-muted">Name, picture and bio changes show here.</p> : data.changes.slice(0, 12).map((c) => (
              <div key={c.id} className="border-b border-rule px-4 py-2 text-sm last:border-0">
                <b className="font-semibold">@{c.handle}</b> <span className="text-muted">changed {c.field === "avatar" ? "picture" : c.field} · {ageStr(Date.now() - c.t)}</span>
                {c.field === "avatar" ? <span className="mt-1 flex items-center gap-2"><img src={thumb(c.old, 24)} alt="" loading="lazy" decoding="async" className="size-6 rounded-full opacity-60" />→<img src={thumb(c.new, 24)} alt="" loading="lazy" decoding="async" className="size-6 rounded-full" /></span>
                  : <p className="mt-0.5 text-xs text-ink-2"><s className="text-muted">{c.old}</s> → {c.new}</p>}
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </Page>
  );
}

