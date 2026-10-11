// Narratives "Today" (server/desk.js): the day's narratives and runners, researched on X and the web by Grok and
// written up to read. The front page: the day so far, the narratives running now (the strongest big), the runners
// of the day, and what was written earlier today. An article (#/narratives/<id>) reads like a short feature: what
// the thing is, what is happening, how it is trading, the coins and their roles, the case for and against, what to
// watch, the posts and the pages it came from. A subject not written yet shows Blix's own read of its numbers.
import { useEffect, useMemo, type ReactNode } from "react";
import { ago, money } from "@/components/page";
import { LiveMc } from "@/components/Live";
import { safeHref } from "@/lib/format";
import { thumb } from "@/lib/thumb";
import { useRole } from "@/lib/role";
import { cn } from "@/lib/utils";
import { CoinPic, GrokMark } from "./parts";

type Status = "new" | "heating" | "peaking" | "cooling" | "fading";
export type DeskCoin = { mint: string; symbol: string; name: string | null; mcap: number | null; peak: number | null; liq: number | null; volH1: number | null; volH24: number | null;
  chg5m: number | null; chg1h: number | null; chg24h: number | null; born: number | null; bonded: boolean };
export type Article = { headline: string; dek: string; tag: string; status: Status | null; what: string; happening: string[]; trading: string;
  coins: { symbol: string; role: string }[]; bull: string[]; bear: string[]; watch: string; posts: { handle: string; text: string; url: string | null }[]; sources: string[];
  t: number; upd: number; ver: number; model: string | null; searches: number | null; leadMcAt: number | null; leadAt: string | null };
export type Trader = { handle: string; name: string; pic: string | null; followers: number | null; verified: boolean; value: number; pnl: number; cost: number;
  bought: number; sold: number; buys: number; sells: number; last: number; coins: string[]; thesis: string | null; dev: boolean };
export type Traders = { top: Trader[]; known: number; holders: number; held: number; inProfit: number; coinsRead: number; coins: number; readAt: number | null;
  flow: { buyers: number; sellers: number; bought: number; sold: number } | null };
type Live = "heating" | "steady" | "cooling";
export type Entry = { id: string; key: string; kind: "story" | "runner"; name: string; rank: number | null; live: boolean; auto: string; heat: Live | null;
  stats: Record<string, number | null> | null; article: Article | null; coins: DeskCoin[]; traders?: Traders | null; now?: { state: Live; offHigh: number } | null };
export type Desk = { t: number; writer: { on: boolean; why: string | null; model: string; lastOk: number | null; writing: string[]; spentToday: number; budget: number; allowedNow?: number };
  lede: { headline: string; body: string[]; themes: string[]; upd: number } | null; stories: Entry[]; runners: Entry[]; earlier: Entry[] };

// The ticker without the "$" some coins put in their own symbol (the page adds one).
const bare = (s: string) => String(s || "").replace(/^\$+/, "");
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString()}%`);
const tone = (n: number | null | undefined) => (n == null ? "text-muted" : n >= 0 ? "text-up" : "text-down");
const words = (a: Article) => [a.what, ...a.happening, a.trading, a.watch, ...a.bull, ...a.bear].join(" ").split(/\s+/).length;
const readTime = (a: Article) => `${Math.max(1, Math.round(words(a) / 220))} min read`;
const STATUS: Record<Status, [string, string]> = {
  new: ["New today", "bg-info/12 text-info"], heating: ["Heating up", "bg-up/12 text-up"], peaking: ["Peaking", "bg-warn/12 text-warn"],
  cooling: ["Cooling", "bg-paper-5 text-ink-2"], fading: ["Fading", "bg-down/12 text-down"],
};
const open = (id: string) => { location.hash = `#/narratives/${id}`; };
const lead = (e: Entry) => e.coins[0] || null;

function StatusChip({ s }: { s: Status | null | undefined }) {
  if (!s) return null;
  const [label, cls] = STATUS[s];
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs font-semibold tracking-wide uppercase", cls)}>{label}</span>;
}
// The state chip is live (Blix's numbers this minute); the article's own status was its state when Grok wrote it,
// and is shown only for a subject that is no longer in today's lists.
const LIVE: Record<Live, [string, string, string]> = {
  heating: ["Heating up", "bg-up/12 text-up", "Most of its money is rising in the last 5 minutes"],
  steady: ["Steady", "bg-paper-5 text-ink-2", "Moving sideways over the last 5 minutes"],
  cooling: ["Cooling off", "bg-down/12 text-down", "Falling in the last 5 minutes or down on the hour"],
};
function LiveChip({ e }: { e: Entry }) {
  const st = e.now?.state;
  if (!st) return <StatusChip s={e.article?.status} />;
  const [label, cls, tip] = LIVE[st];
  return (
    <span title={`${tip} (live)`} className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-2xs font-semibold tracking-wide uppercase", cls)}>
      <i className="size-1.5 rounded-full bg-current" />{label}{e.now?.offHigh ? <span className="font-medium normal-case opacity-80">· {e.now.offHigh}% off high</span> : null}
    </span>
  );
}
const Kicker = ({ e }: { e: Entry }) => (
  <span className="flex min-w-0 flex-wrap items-center gap-2">
    <span className="text-2xs font-semibold tracking-[0.08em] text-muted uppercase">{e.kind === "runner" ? "Runner of the day" : "Narrative"}{e.article?.tag ? ` · ${e.article.tag}` : ""}</span>
    <LiveChip e={e} />
  </span>
);
// A trader's face (their Fomo picture), initial under it for when it is missing.
function Face({ t, size = 28 }: { t: Pick<Trader, "pic" | "name" | "handle">; size?: number }) {
  const src = thumb(t.pic, size * 2);
  return (
    <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-paper-4 font-semibold text-muted uppercase" style={{ width: size, height: size, fontSize: Math.max(9, size * 0.34) }}>
      {(t.name || t.handle || "?").slice(0, 1)}
      {src && <img src={src} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" onError={(ev) => { ev.currentTarget.style.display = "none"; }} />}
    </span>
  );
}
const traderHref = (h: string) => `#/trader/${encodeURIComponent(h)}`;
const compact = (n: number | null | undefined) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${money(Math.abs(n))}`;
// The known traders on a card: their faces and what they hold.
function TradersLine({ e }: { e: Entry }) {
  const t = e.traders;
  if (!t || !t.known) return null;
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted">
      <span className="flex shrink-0 -space-x-1.5">{t.top.slice(0, 5).map((p) => <span key={p.handle} className="rounded-full ring-2 ring-paper-2"><Face t={p} size={18} /></span>)}</span>
      <span className="num truncate">{t.known} known trader{t.known === 1 ? "" : "s"}{t.holders ? ` · ${t.holders} holding ${money(t.held)}` : ""}{t.flow && t.flow.bought + t.flow.sold > 0 ? <> · <span className={tone(t.flow.bought - t.flow.sold)}>{signed(t.flow.bought - t.flow.sold)}</span> net 1h</> : null}</span>
    </span>
  );
}
const Faces = ({ coins, size = 24 }: { coins: DeskCoin[]; size?: number }) => (
  <span className="flex shrink-0 -space-x-2">{coins.slice(0, 5).map((c) => <span key={c.mint} className="rounded-full ring-2 ring-paper-2"><CoinPic c={c} size={size} /></span>)}</span>
);
// The numbers under a card: a story's hour of trading and typical move, a runner's day.
function CardNumbers({ e }: { e: Entry }) {
  const c = lead(e);
  if (e.kind === "runner" && c) return (
    <span className="num flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-muted">
      <b className={cn("text-md font-semibold", tone(c.chg24h))}>{pct(c.chg24h)}<span className="font-normal text-muted"> 24h</span></b>
      <span><LiveMc mint={c.mint} value={c.mcap} fmt={money} className="font-semibold text-ink-2" /> mc</span>
      {c.volH24 ? <span>{money(c.volH24)} vol</span> : null}
    </span>
  );
  const s = e.stats || {};
  return (
    <span className="num flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm text-muted">
      <span><b className="font-semibold text-ink-2">{money(s.volH1)}</b> traded 1h</span>
      <b className={cn("font-semibold", tone(s.medChg1h))}>{pct(s.medChg1h)}<span className="font-normal text-muted"> typical</span></b>
      <span>{s.coins} coins</span>
    </span>
  );
}
const Footer = ({ e }: { e: Entry }) => (
  <span className="flex items-center gap-2 text-xs text-muted">
    {e.article ? <><GrokMark size={14} /><span>{readTime(e.article)} · {e.article.ver > 1 ? "updated" : "written"} {ago(e.article.upd)}</span></> : <span>Blix's read of the numbers · full story being researched</span>}
  </span>
);

// The top story: big, two columns on a wide screen (the words, then its coins).
function LeadCard({ e }: { e: Entry }) {
  const a = e.article;
  return (
    <button type="button" onClick={() => open(e.id)} className="surface group grid w-full min-w-0 gap-5 p-5 text-left transition-colors hover:bg-paper-3/50 lg:grid-cols-[minmax(0,1fr)_300px] lg:p-6">
      <span className="flex min-w-0 flex-col gap-3">
        <Kicker e={e} />
        <span className="font-display text-[26px] leading-[1.15] font-semibold tracking-[-0.015em] text-ink group-hover:underline group-hover:decoration-rule-2 group-hover:underline-offset-4 max-sm:text-[22px]">{a?.headline || e.name}</span>
        <span className="max-w-[68ch] text-[15px] leading-relaxed text-ink-2">{a ? a.dek : e.auto}</span>
        {a?.what && <span className="line-clamp-3 max-w-[68ch] text-md leading-relaxed text-muted">{a.what}</span>}
        <span className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-1"><CardNumbers e={e} /><TradersLine e={e} /><Footer e={e} /></span>
      </span>
      <span className="flex min-w-0 flex-col gap-1.5 border-rule lg:border-l lg:pl-5">
        <span className="text-2xs font-semibold tracking-[0.08em] text-muted uppercase">Its coins</span>
        {e.coins.slice(0, 6).map((c) => (
          <span key={c.mint} className="flex min-w-0 items-center gap-2.5 py-1">
            <CoinPic c={c} size={28} />
            <span className="flex min-w-0 flex-1 flex-col leading-tight"><b className="truncate text-md font-semibold text-ink">${bare(c.symbol)}</b><span className="truncate text-xs text-muted">{c.name}</span></span>
            <span className="num flex flex-col items-end leading-tight"><LiveMc mint={c.mint} value={c.mcap} fmt={money} className="text-md text-ink-2" /><span className={cn("text-xs", tone(c.chg1h))}>{pct(c.chg1h)} 1h</span></span>
          </span>
        ))}
      </span>
    </button>
  );
}

function StoryCard({ e }: { e: Entry }) {
  const a = e.article;
  return (
    <button type="button" onClick={() => open(e.id)} className="surface group flex h-full w-full min-w-0 flex-col gap-2.5 p-4 text-left transition-colors hover:bg-paper-3/50">
      <span className="flex items-start justify-between gap-3"><Kicker e={e} /><Faces coins={e.coins} size={22} /></span>
      <span className="text-[17px] leading-snug font-semibold tracking-[-0.01em] text-ink group-hover:underline group-hover:decoration-rule-2 group-hover:underline-offset-4">{a?.headline || e.name}</span>
      <span className="line-clamp-4 text-md leading-relaxed text-ink-2">{a ? a.dek : e.auto}</span>
      <span className="mt-auto flex flex-col gap-1.5 pt-1"><CardNumbers e={e} /><TradersLine e={e} /><Footer e={e} /></span>
    </button>
  );
}

function RunnerCard({ e }: { e: Entry }) {
  const a = e.article, c = lead(e);
  return (
    <button type="button" onClick={() => open(e.id)} className="surface group flex h-full w-full min-w-0 flex-col gap-3 p-4 text-left transition-colors hover:bg-paper-3/50">
      <span className="flex min-w-0 items-center gap-3">
        {c && <CoinPic c={c} size={44} />}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="flex min-w-0 items-center gap-2"><b className="truncate text-lg font-semibold text-ink">{e.name}</b>{e.rank && <span className="num text-xs text-muted">#{e.rank}</span>}</span>
          <span className="truncate text-sm text-muted">{c?.name}</span>
        </span>
        {c && <span className="num flex flex-col items-end leading-tight"><b className={cn("text-lg font-semibold", tone(c.chg24h))}>{pct(c.chg24h)}</b><span className="text-xs text-muted">24h</span></span>}
      </span>
      <span className="flex items-center gap-2">{a?.tag && <span className="text-2xs font-semibold tracking-[0.08em] text-muted uppercase">{a.tag}</span>}<LiveChip e={e} /></span>
      <span className="text-[15px] leading-snug font-semibold text-ink group-hover:underline group-hover:decoration-rule-2 group-hover:underline-offset-4">{a?.headline || "Why it ran today"}</span>
      <span className="line-clamp-3 text-md leading-relaxed text-ink-2">{a ? a.dek : e.auto}</span>
      <span className="mt-auto flex flex-col gap-1.5 pt-1">
        {c && <span className="num flex flex-wrap gap-x-3 text-sm text-muted"><span><LiveMc mint={c.mint} value={c.mcap} fmt={money} className="font-semibold text-ink-2" /> mc</span>{c.peak && c.mcap && c.peak > c.mcap * 1.1 ? <span>high {money(c.peak)}</span> : null}{c.volH24 ? <span>{money(c.volH24)} vol 24h</span> : null}</span>}
        <TradersLine e={e} />
        <Footer e={e} />
      </span>
    </button>
  );
}

const Section = ({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2">
      <h2 className="font-display text-xl font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      {note && <span className="text-sm text-muted">{note}</span>}
    </header>
    {children}
  </section>
);

function Masthead({ d }: { d: Desk }) {
  const w = d.writer, date = new Date(d.t).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const written = [...d.stories, ...d.runners].filter((e) => e.article).length, all = d.stories.length + d.runners.length;
  const owner = useRole() === "owner";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-sm text-muted">
      <span><b className="font-semibold text-ink-2">{date}</b> · {d.stories.length} narratives · {d.runners.length} runners · {written} of {all} written up</span>
      <span className="flex items-center gap-2">
        <GrokMark size={16} />
        {w.writing.length ? <span>Grok is researching {w.writing.join(", ")}…</span>
          : w.on ? <span>Researched on X and the web by Grok{w.lastOk ? ` · last ${ago(w.lastOk)}` : ""}</span>
          : <span>{w.why ? (/pacing|budget/.test(w.why) ? "New write-ups resume shortly (daily Grok limit)" : "Write-ups paused") : "Starting"}{w.lastOk ? ` · last ${ago(w.lastOk)}` : ""}</span>}
        {owner && w.budget > 0 && <span className="num rounded-full bg-paper-3 px-2 py-0.5 text-xs" title={`Grok spend for the desk today. The day's budget opens up hour by hour: $${(w.allowedNow ?? w.budget).toFixed(2)} usable so far.`}>Grok today ${w.spentToday.toFixed(2)} / ${w.budget.toFixed(2)}</span>}
      </span>
    </div>
  );
}

function Lede({ d }: { d: Desk }) {
  const l = d.lede;
  if (!l) {
    const top = d.stories.slice(0, 3).map((e) => e.name).join(", "), run = d.runners.slice(0, 3).map((e) => e.name).join(", ");
    return (
      <div className="surface flex flex-col gap-2 p-5">
        <span className="text-2xs font-semibold tracking-[0.08em] text-muted uppercase">The day so far</span>
        <p className="max-w-[75ch] text-[15px] leading-relaxed text-ink-2">{top ? <>Money this hour is going to <b className="font-semibold text-ink">{top}</b>. </> : null}{run ? <>The day's biggest runners: <b className="font-semibold text-ink">{run}</b>. </> : null}The full column is written once the first stories are in.</p>
      </div>
    );
  }
  return (
    <div className="surface flex flex-col gap-3 p-5 lg:p-6">
      <span className="flex items-center justify-between gap-3"><span className="text-2xs font-semibold tracking-[0.08em] text-muted uppercase">The day so far</span><span className="text-xs text-muted">{ago(l.upd)}</span></span>
      <h2 className="font-display text-[24px] leading-tight font-semibold tracking-[-0.015em] text-ink max-sm:text-[20px]">{l.headline}</h2>
      <div className="grid gap-x-8 gap-y-3 lg:grid-cols-2">{l.body.map((p, i) => <p key={i} className="text-[15px] leading-relaxed text-ink-2">{p}</p>)}</div>
      {l.themes.length > 0 && <div className="flex flex-wrap gap-1.5 pt-1">{l.themes.map((t) => <span key={t} className="rounded-full border border-rule-2 px-2.5 py-1 text-sm text-ink-2">{t}</span>)}</div>}
    </div>
  );
}

function EarlierRow({ e }: { e: Entry }) {
  return (
    <button type="button" onClick={() => open(e.id)} className="group flex w-full min-w-0 items-center gap-3 border-t border-rule px-4 py-3 text-left first:border-t-0 hover:bg-paper-3/50">
      <Faces coins={e.coins} size={22} />
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        <b className="truncate text-md font-semibold text-ink group-hover:underline">{e.article?.headline || e.name}</b>
        <span className="truncate text-sm text-muted">{e.article?.dek}</span>
      </span>
      <span className="shrink-0 text-xs text-muted">{e.article ? ago(e.article.upd) : ""}</span>
    </button>
  );
}

export function DeskHome({ d }: { d: Desk }) {
  // Written stories first (the reader came to read), the strongest of them big.
  const stories = useMemo(() => [...d.stories].sort((a, b) => Number(Boolean(b.article)) - Number(Boolean(a.article)) || (a.rank ?? 99) - (b.rank ?? 99)), [d.stories]);
  const runners = useMemo(() => [...d.runners].sort((a, b) => Number(Boolean(b.article)) - Number(Boolean(a.article)) || (a.rank ?? 99) - (b.rank ?? 99)), [d.runners]);
  const [top, ...rest] = stories;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3"><Masthead d={d} /><Lede d={d} /></div>
      <Section title="Narratives running now" note="what this hour's money is playing">
        {top ? <LeadCard e={top} /> : <p className="surface px-4 py-6 text-md text-muted">No narrative has two or more coins running right now.</p>}
        {rest.length > 0 && <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3">{rest.map((e) => <StoryCard key={e.key} e={e} />)}</div>}
      </Section>
      <Section title="Runners of the day" note="the biggest moves of the last 24 hours, with real money behind them">
        {runners.length ? <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{runners.map((e) => <RunnerCard key={e.key} e={e} />)}</div>
          : <p className="surface px-4 py-6 text-md text-muted">No coin has run hard enough today yet.</p>}
      </Section>
      {d.earlier.length > 0 && (
        <Section title="Earlier today" note="written today, no longer leading">
          <div className="surface overflow-hidden">{d.earlier.map((e) => <EarlierRow key={e.key} e={e} />)}</div>
        </Section>
      )}
      <p className="px-1 text-xs leading-relaxed text-muted">Written by AI (Grok) from public posts on X, the web and Blix's market data. It can be wrong or late; check the posts and the chart yourself. Nothing here is advice to buy or sell.</p>
    </div>
  );
}

// ---------- one article ----------
// Article text with its coins and people picked out: a $TICKER of one of the story's coins becomes a chip (picture,
// ticker, live change, opens the coin), another $TICKER is set bold, and an @handle links to that person on X (or
// to their Blix trader page when they are one of the known traders here).
function Rich({ text, coins, traders }: { text: string; coins: Map<string, DeskCoin>; traders: Set<string> }) {
  const parts = text.split(/(\$[A-Za-z][A-Za-z0-9_]{1,19}|@[A-Za-z0-9_]{2,15})/g);
  return <>{parts.map((p, i) => {
    if (i % 2 === 0) return p;
    if (p[0] === "@") {
      const h = p.slice(1), known = traders.has(h.toLowerCase());
      return <a key={i} href={known ? traderHref(h) : `https://x.com/${h}`} target={known ? undefined : "_blank"} rel="noreferrer noopener"
        className="font-semibold text-info underline-offset-2 hover:underline" title={known ? "A known trader in this narrative" : "Open on X"}>{p}</a>;
    }
    const c = coins.get(p.slice(1).toLowerCase());
    if (!c) return <b key={i} className="font-semibold text-ink">{p}</b>;
    return (
      <a key={i} href={`#/coin/${c.mint}`} title={c.name || c.symbol} className="mx-0.5 inline-flex translate-y-[3px] items-center gap-1 rounded-full border border-rule bg-paper-3 py-px pr-2 pl-px align-baseline text-[0.9em] leading-tight font-semibold text-ink no-underline hover:border-rule-2">
        <CoinPic c={c} size={16} />${bare(c.symbol)}<span className={cn("num text-[0.85em] font-medium", tone(c.chg1h))}>{pct(c.chg1h)}</span>
      </a>
    );
  })}</>;
}

// The known traders in the narrative (Fomo): what they hold, their profit on it, what they did today.
function TradersPanel({ e }: { e: Entry }) {
  const t = e.traders;
  if (!t) return null;
  const f = t.flow;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <H>Traders in this narrative</H>
        <span className="text-xs text-muted">live · Fomo traders on {t.coinsRead} of {t.coins} coins{t.readAt ? ` · read ${ago(t.readAt)}` : ""}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label="Known traders" value={String(t.known)} note={t.holders ? `${t.holders} still holding` : "none holding"} />
        <MiniStat label="They hold" value={money(t.held)} note={t.holders ? `${t.inProfit} of ${t.holders} in profit` : "—"} />
        <MiniStat label="Bought, last hour" value={f ? money(f.bought) : "—"} note={f ? `${f.buyers} buyer${f.buyers === 1 ? "" : "s"}` : "followed wallets"} cls="text-up" />
        <MiniStat label="Sold, last hour" value={f ? money(f.sold) : "—"} note={f ? `${f.sellers} seller${f.sellers === 1 ? "" : "s"}` : "followed wallets"} cls="text-down" />
      </div>
      {t.top.length ? (
        <div className="surface flex flex-col overflow-x-auto px-1 py-1">
          <table className="w-full min-w-[520px] text-md">
            <thead><tr className="text-xs text-muted"><th className="px-3 py-2 text-left font-medium">Trader</th><th className="px-2 py-2 text-right font-medium">Holding</th><th className="px-2 py-2 text-right font-medium">PnL</th><th className="px-2 py-2 text-right font-medium">Today</th><th className="px-3 py-2 text-right font-medium">Coins</th></tr></thead>
            <tbody>
              {t.top.map((p) => (
                <tr key={p.handle} className="border-t border-rule hover:bg-paper-3/50">
                  <td className="px-3 py-2">
                    <a href={traderHref(p.handle)} className="group flex min-w-0 items-center gap-2.5">
                      <Face t={p} size={30} />
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="flex items-center gap-1.5"><b className="truncate font-semibold text-ink group-hover:underline">{p.name}</b>{p.verified && <span className="text-info" title="Verified">✓</span>}{p.dev && <span className="rounded-sm bg-warn/15 px-1 text-2xs font-semibold text-warn" title="Created one of these coins">DEV</span>}</span>
                        <span className="truncate text-xs text-muted">@{p.handle}{p.followers ? ` · ${compact(p.followers)} followers` : ""}</span>
                      </span>
                    </a>
                    {p.thesis && <p className="mt-1 max-w-[46ch] text-xs leading-snug text-ink-2">“{p.thesis}”</p>}
                  </td>
                  <td className="num px-2 text-right text-ink">{p.value >= 1 ? money(p.value) : <span className="text-muted">sold out</span>}</td>
                  <td className={cn("num px-2 text-right font-semibold", tone(p.pnl))}>{p.cost || p.pnl ? signed(p.pnl) : "—"}</td>
                  <td className="num px-2 text-right text-xs leading-tight">{p.bought ? <span className="block text-up">+{money(p.bought)} in</span> : null}{p.sold ? <span className="block text-down">−{money(p.sold)} out</span> : null}{!p.bought && !p.sold ? <span className="text-muted">held</span> : null}</td>
                  <td className="px-3 text-right text-xs text-ink-2">{p.coins.slice(0, 3).map((x) => `$${bare(x)}`).join(" ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="surface px-4 py-4 text-md text-muted">No known traders on these coins yet{t.coinsRead < t.coins ? " (their holder lists are still being read)" : ""}.</p>}
    </section>
  );
}
const MiniStat = ({ label, value, note, cls }: { label: string; value: string; note: string; cls?: string }) => (
  <div className="flex min-w-0 flex-col gap-0.5 rounded-control border border-rule bg-paper-2 px-3 py-2.5">
    <span className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">{label}</span>
    <b className={cn("num truncate text-lg font-semibold text-ink", cls)}>{value}</b>
    <span className="truncate text-xs text-muted">{note}</span>
  </div>
);
// Right now: Blix's own read of the numbers this minute (the article above was written at a moment; this is live).
function RightNow({ e }: { e: Entry }) {
  if (!e.auto) return null;
  return (
    <section className="flex flex-col gap-1.5 rounded-card border border-rule-2 bg-paper-2 p-4">
      <span className="flex items-center gap-2 text-2xs font-semibold tracking-[0.08em] text-muted uppercase"><i className="size-1.5 animate-pulse rounded-full bg-up" />Right now · live from Blix</span>
      <p className="text-[15px] leading-relaxed text-ink">{e.auto}</p>
    </section>
  );
}
const utc = (t: number) => `${new Date(t).toISOString().slice(11, 16)} UTC`;
const H = ({ children }: { children: ReactNode }) => <h2 className="font-display text-lg font-semibold tracking-[-0.005em] text-ink">{children}</h2>;
const P = ({ children }: { children: ReactNode }) => <p className="text-[16px] leading-[1.7] text-ink-2 max-sm:text-[15px]">{children}</p>;
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

function CoinRow({ c, role }: { c: DeskCoin; role?: string }) {
  return (
    <a href={`#/coin/${c.mint}`} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-rule py-2.5 first:border-t-0">
      <span className="flex min-w-0 items-center gap-3">
        <CoinPic c={c} size={34} />
        <span className="flex min-w-0 flex-col leading-snug">
          <span className="flex min-w-0 items-baseline gap-2"><b className="truncate font-semibold text-ink group-hover:underline">${bare(c.symbol)}</b><span className="truncate text-xs text-muted">{c.name}</span></span>
          {role ? <span className="text-sm text-ink-2">{role}</span> : null}
        </span>
      </span>
      <span className="num flex flex-col items-end leading-tight">
        <LiveMc mint={c.mint} value={c.mcap} fmt={money} className="text-md font-semibold text-ink" />
        <span className="text-xs"><span className={tone(c.chg1h)}>{pct(c.chg1h)} 1h</span> · <span className={tone(c.chg24h)}>{pct(c.chg24h)} 24h</span></span>
      </span>
    </a>
  );
}

function SideNumbers({ e }: { e: Entry }) {
  const c = lead(e), a = e.article;
  const rows: [string, ReactNode, string?][] = [];
  if (e.kind === "story" && e.stats) {
    const s = e.stats;
    rows.push(["Traded, last hour", money(s.volH1)], ["Typical move, 1h", pct(s.medChg1h), tone(s.medChg1h)], ["Up on the hour", `${s.up ?? "—"} of ${s.coins ?? "—"}`], ["New this hour", String(s.fresh ?? 0)]);
  }
  if (c) {
    rows.push(["Lead coin", `$${bare(c.symbol)}`], ["Market cap", <LiveMc key="mc" mint={c.mint} value={c.mcap} fmt={money} />]);
    if (c.peak && c.mcap && c.peak > c.mcap * 1.05) rows.push(["Recent high", money(c.peak)]);
    rows.push(["24h", pct(c.chg24h), tone(c.chg24h)], ["Volume 24h", money(c.volH24)]);
    if (c.born) rows.push(["Age", ago(c.born).replace(" ago", "")]);
  }
  // How far the lead coin has moved since the article was written.
  const since = a?.leadMcAt && c && a.leadAt === c.mint && c.mcap ? (c.mcap / a.leadMcAt - 1) * 100 : null;
  return (
    <div className="surface flex flex-col p-4">
      <span className="pb-2 text-2xs font-semibold tracking-[0.08em] text-muted uppercase">The numbers now</span>
      {rows.map(([k, v, cls]) => <span key={k} className="flex items-baseline justify-between gap-3 border-t border-rule py-1.5 text-md first:border-t-0"><span className="text-muted">{k}</span><b className={cn("num font-semibold text-ink", cls)}>{v}</b></span>)}
      {since != null && Math.abs(since) >= 1 && <span className="mt-2 rounded-control bg-paper-3 px-3 py-2 text-sm text-ink-2">Since this was written, ${bare(c!.symbol)} is <b className={cn("num font-semibold", tone(since))}>{pct(since)}</b>.</span>}
    </div>
  );
}

export function ArticleView({ e, d }: { e: Entry; d: Desk }) {
  const a = e.article;
  useEffect(() => { window.scrollTo?.(0, 0); document.querySelector("main")?.scrollTo?.(0, 0); }, [e.id]);
  const bySym = new Map(e.coins.map((c) => [bare(c.symbol).toLowerCase(), c]));
  const known = new Set((e.traders?.top || []).map((p) => p.handle.toLowerCase()));
  const rich = (x: string) => <Rich text={x} coins={bySym} traders={known} />;
  const roles = a?.coins.map((r) => ({ r, c: bySym.get(bare(r.symbol).toLowerCase()) })) || [];
  const listed = new Set(roles.map((x) => x.c?.mint).filter(Boolean));
  const others = e.coins.filter((c) => !listed.has(c.mint));
  const next = [...d.stories, ...d.runners, ...d.earlier].filter((x) => x.id !== e.id && x.article).slice(0, 5);
  return (
    <div className="flex flex-col gap-5">
      <a href="#/narratives" className="w-fit text-sm text-muted hover:text-ink">← All of today's narratives</a>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <article className="flex min-w-0 max-w-[760px] flex-col gap-6">
          <header className="flex flex-col gap-3">
            <Kicker e={e} />
            <h1 className="font-display text-[32px] leading-[1.12] font-semibold tracking-[-0.02em] text-ink max-sm:text-[25px]">{a?.headline || e.name}</h1>
            <p className="text-[18px] leading-relaxed text-ink-2 max-sm:text-[16px]">{a ? rich(a.dek) : e.auto}</p>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              {a ? <><GrokMark size={16} /><span>Blix desk · researched on X and the web by Grok{a.searches ? ` (${a.searches} searches)` : ""} · {a.ver > 1 ? `updated ${ago(a.upd)}, first written ${ago(a.t)}` : `written ${ago(a.upd)}`} · {readTime(a)}</span></>
                : <span>Grok has not written this one up yet. Below is Blix's read of the numbers; the story appears here when it is researched.</span>}
            </span>
            <div className="flex flex-wrap gap-2 pt-1">
              {e.coins.slice(0, 8).map((c) => (
                <a key={c.mint} href={`#/coin/${c.mint}`} className="flex items-center gap-2 rounded-full border border-rule bg-paper-2 py-1 pr-3 pl-1 hover:border-rule-2 hover:bg-paper-3">
                  <CoinPic c={c} size={24} /><b className="text-md font-semibold text-ink">${bare(c.symbol)}</b><LiveMc mint={c.mint} value={c.mcap} fmt={money} className="num text-sm text-muted" />
                </a>
              ))}
            </div>
          </header>
          {a && <RightNow e={e} />}
          {a ? (
            <>
              {a.what && <section className="flex flex-col gap-2"><H>What it is</H><P>{rich(a.what)}</P></section>}
              {a.happening.length > 0 && <section className="flex flex-col gap-3"><H>What's happening</H>{a.happening.map((p, i) => <P key={i}>{rich(p)}</P>)}</section>}
              {a.posts.length > 0 && (
                <section className="flex flex-col gap-2">
                  <H>On X</H>
                  {a.posts.map((p, i) => {
                    const href = safeHref(p.url);
                    const body = <><span className="text-sm font-semibold text-ink">{p.handle}</span><span className="text-[15px] leading-relaxed text-ink-2">“{p.text}”</span></>;
                    return href ? <a key={i} href={href} target="_blank" rel="noreferrer noopener" className="flex flex-col gap-1 border-l-2 border-rule-2 py-1 pl-4 hover:border-ink">{body}<span className="text-xs text-muted">Open on X ↗</span></a>
                      : <div key={i} className="flex flex-col gap-1 border-l-2 border-rule-2 py-1 pl-4">{body}</div>;
                  })}
                </section>
              )}
              {a.trading && <section className="flex flex-col gap-2"><H>How it was trading at {utc(a.upd)}</H><P>{rich(a.trading)}</P><span className="text-xs text-muted">The numbers in this paragraph are from when it was written. The live ones are under "Right now", in "The coins" and on the right.</span></section>}
              <TradersPanel e={e} />
              <section className="flex flex-col gap-1"><H>The coins</H>
                <div className="surface flex flex-col px-4 py-1.5">
                  {roles.map(({ r, c }) => c ? <CoinRow key={c.mint} c={c} role={r.role} /> : <div key={r.symbol} className="border-t border-rule py-2.5 text-md first:border-t-0"><b className="font-semibold text-ink">${bare(r.symbol)}</b> <span className="text-ink-2">{r.role}</span></div>)}
                  {others.map((c) => <CoinRow key={c.mint} c={c} />)}
                </div>
              </section>
              {(a.bull.length > 0 || a.bear.length > 0) && (
                <section className="grid gap-3 sm:grid-cols-2">
                  <div className="surface flex flex-col gap-2 p-4"><span className="text-2xs font-semibold tracking-[0.08em] text-up uppercase">Why it could keep going</span><ul className="flex flex-col gap-2">{a.bull.map((x, i) => <li key={i} className="text-md leading-relaxed text-ink-2">{rich(x)}</li>)}</ul></div>
                  <div className="surface flex flex-col gap-2 p-4"><span className="text-2xs font-semibold tracking-[0.08em] text-down uppercase">Why it could fade</span><ul className="flex flex-col gap-2">{a.bear.map((x, i) => <li key={i} className="text-md leading-relaxed text-ink-2">{rich(x)}</li>)}</ul></div>
                </section>
              )}
              {a.watch && <section className="flex flex-col gap-2 rounded-card border border-rule-2 bg-paper-2 p-4"><span className="text-2xs font-semibold tracking-[0.08em] text-muted uppercase">What to watch</span><p className="text-[15px] leading-relaxed text-ink">{rich(a.watch)}</p></section>}
              {a.sources.length > 0 && (
                <section className="flex flex-col gap-2"><span className="text-2xs font-semibold tracking-[0.08em] text-muted uppercase">Pages Grok read</span>
                  <div className="flex flex-wrap gap-1.5">{a.sources.map((u) => { const href = safeHref(u); return href ? <a key={u} href={href} target="_blank" rel="noreferrer noopener" className="max-w-[260px] truncate rounded-full border border-rule px-2.5 py-1 text-sm text-ink-2 hover:border-rule-2 hover:text-ink" title={u}>{host(u)}</a> : null; })}</div>
                </section>
              )}
            </>
          ) : (
            <><section className="flex flex-col gap-1"><H>The coins</H><div className="surface flex flex-col px-4 py-1.5">{e.coins.map((c) => <CoinRow key={c.mint} c={c} />)}</div></section><TradersPanel e={e} /></>
          )}
          <p className="text-xs leading-relaxed text-muted">Written by AI from public posts and Blix's market data. It can be wrong or out of date; check the posts and the chart yourself. Not advice to buy or sell.</p>
        </article>
        <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-14">
          <SideNumbers e={e} />
          {next.length > 0 && (
            <div className="surface flex flex-col overflow-hidden">
              <span className="px-4 pt-3 pb-1 text-2xs font-semibold tracking-[0.08em] text-muted uppercase">Read next</span>
              {next.map((x) => <EarlierRow key={x.key} e={x} />)}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
