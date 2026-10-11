// Narratives (#/narratives), in four tabs:
//   Today         the day's narratives and runners researched by Grok and written up to read (narratives/desk.tsx,
//                 server/desk.js); #/narratives/<id> opens one article.
//   Running now   the stories running right now, where this hour's money is going, grouped by Claude or Blix's
//                 themes (narratives/running.tsx, server/running.js): a list to move through and the picked story.
//   Launch bursts new coins launched together around one word or X post, named by Grok when it can.
//   Themes        which themes are taking a bigger share of launches, the new words in coin names, every burst.
import { useEffect, useState, type ReactNode } from "react";
import { ago, Empty, Loading, money, Page, Panel, Problem, Scroll, Tag, td, tdR, th, thR } from "@/components/page";
import { Segmented } from "@/components/ui/segmented";
import { usePoll } from "@/lib/coin";
import { cn, store } from "@/lib/utils";
import { FormingRow, NarrativeCard, ScannerBar, type Feed, type Item } from "./narratives/parts";
import { LiveMc } from "@/components/Live";
import { RunningNow, type Running } from "./narratives/running";
import { ArticleView, DeskHome, type Desk } from "./narratives/desk";
import { useRouteArg } from "@/lib/route";

type J = any;
type Filter = "all" | "grok" | "live";
type TabId = "today" | "running" | "bursts" | "themes";

export function Narratives() {
  // Today opens first (a new key: the old one remembered Running now for everyone who had been here).
  const [tab, setTab] = useState<TabId>(() => store.get<TabId>("narratives:view", "today"));
  useEffect(() => { store.set("narratives:view", tab); }, [tab]);
  const arg = useRouteArg();
  useEffect(() => { if (arg) setTab("today"); }, [arg]);
  const pickTab = (id: TabId) => { setTab(id); if (arg) location.hash = "#/narratives"; };
  // Each tab reads only what it shows (the running stories are cheap; bursts and themes poll on their own tab).
  const { data: run, error: runError } = usePoll<Running>("running", 10_000);
  const tabs: [TabId, ReactNode, ReactNode][] = [
    ["today", "Today", null],
    ["running", <>Running<span className="max-sm:hidden"> now</span></>, run?.stories ? <Count n={run.stories.length} /> : null],
    ["bursts", <><span className="max-sm:hidden">Launch </span>Bursts</>, null],
    ["themes", <>Themes<span className="max-sm:hidden"> &amp; words</span></>, null],
  ];
  return (
    <Page title="Narratives" sub="The stories Solana traders are playing right now: where this hour's money is going, the new launches forming around one idea, and the themes heating up.">
      <div role="tablist" aria-label="Narratives" className="sticky top-0 z-10 -mx-1 flex items-center gap-1 overflow-x-auto bg-paper/90 px-1 py-1.5 backdrop-blur">
        {tabs.map(([id, label, aside]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => pickTab(id)}
            className={cn("flex h-9 shrink-0 items-center gap-2 rounded-full px-4 text-md font-semibold transition-colors",
              tab === id ? "bg-ink text-paper" : "text-muted hover:bg-paper-3 hover:text-ink")}>
            <span>{label}</span>{aside}
          </button>
        ))}
      </div>
      {tab === "today" && <Today arg={arg} />}
      {tab === "running" && <RunningNow d={run} error={runError} />}
      {tab === "bursts" && <Bursts />}
      {tab === "themes" && <Themes />}
    </Page>
  );
}

// Today: the desk's front page, or one article.
function Today({ arg }: { arg: string }) {
  const { data: raw, error } = usePoll<Desk>("desk", 15_000);
  const d = raw && Array.isArray(raw.stories) && Array.isArray(raw.runners) && raw.writer ? { ...raw, earlier: Array.isArray(raw.earlier) ? raw.earlier : [] } : null;
  if (!d) return error ? (/not found/i.test(error) ? <p className="surface px-4 py-3 text-md text-ink-2">Today's write-ups switch on at Blix's next server restart.</p> : <Problem text={error} />) : <Loading />;
  if (arg) {
    const e = [...d.stories, ...d.runners, ...d.earlier].find((x) => x.id === arg);
    return e ? <ArticleView e={e} d={d} /> : <div className="surface flex flex-col gap-2 px-4 py-6 text-md text-ink-2">This story is no longer on today's page.<a href="#/narratives" className="text-muted hover:text-ink">← All of today's narratives</a></div>;
  }
  return <DeskHome d={d} />;
}

const Count =({ n }: { n: number }) => <span className="num rounded-full bg-paper-5/80 px-1.5 text-xs font-semibold text-ink-2">{n}</span>;

// Launch bursts: Grok's cards (the strongest big), with what is forming this minute alongside.
function Bursts() {
  const { data: raw, error } = usePoll<Feed>("narrative-feed", 5000);
  // An answer without the feed's shape (an error body, an older server's) counts as not loaded: reading
  // feed.scanner.forming off one crashed this page for visitors on blixvip.com (2026-10-09).
  const feed = raw && raw.scanner && raw.grok && Array.isArray(raw.items) && Array.isArray(raw.forming) ? raw : null;
  const [filter, setFilter] = useState<Filter>("all");
  const [count, setCount] = useState(13);
  // A coin whose chart is dead (marked dead by the server and under 10 traders in the hour) is left out of every story.
  const items = (feed?.items || []).filter((i: Item) => filter === "all" || (filter === "grok" ? i.grok : i.stage === "early" || i.stage === "running"))
    .map((i: Item) => (i.coins.some((c) => c.dead && (c.traders ?? 0) < 10) ? { ...i, coins: i.coins.filter((c) => !(c.dead && (c.traders ?? 0) < 10)) } : i));
  const [top, ...rest] = items;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-sm text-muted">New coins launched together around one word or X post: the stories still forming.</p>
        <Segmented label="Show" value={filter} onChange={(v) => { setFilter(v); setCount(13); }} options={[["all", "All"], ["grok", "Read by Grok"], ["live", "Early & running"]]} />
      </div>
      {feed ? <ScannerBar feed={feed} /> : error ? (/not found/i.test(error) ? <p className="surface px-4 py-3 text-md text-ink-2">The live narrative feed switches on at Blix's next server restart.</p> : <Problem text={error} />) : <Loading />}
      <div className="grid items-start gap-3 grid-cols-[minmax(0,1fr)_360px] max-xl:grid-cols-[minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          {top ? <NarrativeCard item={top} rank={1} big /> : feed && <Panel><Empty>No launch bursts in the last 12 hours{filter !== "all" ? " for this filter" : ""}.</Empty></Panel>}
          {rest.length > 0 && <div className="grid items-start gap-3 grid-cols-2 max-lg:grid-cols-1">{rest.slice(0, count - 1).map((it, i) => <NarrativeCard key={it.id} item={it} rank={i + 2} />)}</div>}
          {items.length > count && <button onClick={() => setCount(count + 12)} className="surface h-10 text-md text-ink-2 hover:text-ink">Show more ({items.length - count} left)</button>}
        </div>
        <aside className="flex min-w-0 flex-col gap-3 xl:sticky xl:top-14">
          <Panel title="Forming now" aside={feed ? `${feed.forming.length} unnamed` : ""}>
            {feed?.forming.length ? feed.forming.map((f) => <FormingRow key={f.id} f={f} />) : <Empty>{feed ? "No new bursts this minute." : "Loading…"}</Empty>}
          </Panel>
        </aside>
      </div>
    </section>
  );
}

// Themes: which ones are taking a bigger share of launches than before, new words, and every burst being watched.
function Themes() {
  const { data: dRaw } = usePoll<J>("narratives", 20_000);
  const { data: cRaw } = usePoll<J>("clusters", 5000);
  // Only answers with the expected shape are drawn (see Bursts above).
  const d = dRaw && Array.isArray(dRaw.themes) && Array.isArray(dRaw.emerging) ? dRaw : null;
  const c = cRaw && cRaw.stats && Array.isArray(cRaw.clusters) ? cRaw : null;
  return (
    <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Panel title="Hot themes" aside="share of launches vs before">
        {d ? (
          <div className="flex flex-col py-1">
            {d.themes.slice(0, 14).map((t: J, i: number) => (
              <a key={t.name} href={t.top[0] ? `#/coin/${t.top[0].mint}` : undefined} className="flex items-center gap-3 px-4 py-2 hover:bg-paper-3/60">
                <span className="num w-5 text-right text-sm text-muted">{i + 1}</span>
                <span className="w-32 truncate font-semibold text-ink">{t.name}</span>
                <i className="block h-1.5 flex-1 overflow-hidden rounded-full bg-paper-4"><i className="block h-full rounded-full bg-gradient-to-r from-ink-2/60 to-ink" style={{ width: `${Math.min(100, t.heat)}%` }} /></i>
                <span className={cn("num w-14 text-right text-sm font-semibold", t.launchLift == null ? "text-muted" : t.launchLift > 1.1 ? "text-up" : t.launchLift < 0.9 ? "text-down" : "text-muted")}>{t.launchLift == null ? "—" : `${t.launchLift.toFixed(2)}×`}</span>
                <span className="w-20 truncate text-right text-sm text-muted">{t.top[0]?.symbol || ""}</span>
              </a>
            ))}
          </div>
        ) : <Loading />}
      </Panel>
      <Panel title="New words" aside="in launch names now, rare before">
        {d ? (
          <div className="flex flex-wrap gap-1.5 p-4">
            {d.emerging.map((w: J) => <span key={w.word} className="flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper px-3 text-md"><b className="font-semibold text-ink">{w.word}</b><span className="num text-muted">{w.count}</span></span>)}
            {!d.emerging.length && <span className="text-muted">Nothing new.</span>}
          </div>
        ) : <Loading />}
      </Panel>
      <div className="lg:col-span-2">
        <Panel title="Every burst being watched" aside={c ? `${c.stats.forming} forming · ${c.stats.launches} launches watched` : ""}>
          <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Burst</th><th className={th}>State</th><th className={thR}>Launches 10m</th><th className={thR}>Devs</th><th className={thR}>Traders</th><th className={thR}>Volume</th><th className={th}>Lead coin</th><th className={thR}>Since</th></tr></thead><tbody>
            {c?.clusters.length ? c.clusters.map((k: J) => (
              <tr key={k.id} className="hover:bg-paper-3/60"><td className={td}><b className="font-semibold">{k.name || k.keys[0]}</b><span className="ml-2 text-sm text-muted">{k.keys.slice(0, 3).join(", ")}</span></td>
                <td className={td}><Tag tone={k.state === "running" ? "up" : k.state === "forming" ? "warn" : "ink"}>{k.state}</Tag></td>
                <td className={tdR}>{k.n10}</td><td className={tdR}>{k.devs}</td><td className={tdR}>{k.traders.toLocaleString()}</td><td className={cn(tdR, "font-semibold")}>{money(k.volUsd)}</td>
                <td className={td}>{k.lead ? <a href={`#/coin/${k.lead.mint}`} className="hover:text-ink"><b className="font-semibold">{k.lead.symbol}</b> <LiveMc mint={k.lead.mint} value={k.lead.mcap} fmt={money} className="font-normal text-muted" /></a> : "—"}</td>
                <td className={cn(tdR, "text-muted")}>{ago(k.since)}</td></tr>))
              : <tr><td colSpan={8}><Empty>{c ? "No bursts right now." : "Loading…"}</Empty></td></tr>}
          </tbody></table></Scroll>
        </Panel>
      </div>
    </section>
  );
}
