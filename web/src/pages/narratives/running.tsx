// Narratives running right now (server/running.js): where the money is going this hour, grouped into stories.
// A list of the stories on the left (sortable, arrow keys move through it), each tagged heating up / steady /
// cooling off from the last 5 minutes, and the one picked on the right: what ties its coins together in plain words,
// the numbers in a sentence, four labelled stats, where its money is (a bar split by coin) and its coins in a table
// that sorts by any column. On a phone the picked story opens under the list.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ago, money } from "@/components/page";
import { LiveMc } from "@/components/Live";
import { Segmented } from "@/components/ui/segmented";
import { cn, store } from "@/lib/utils";
import { CoinPic } from "./parts";

export type RunCoin = { mint: string; symbol: string; name: string | null; mcap: number | null; liq: number | null; volH1: number; chg1h: number | null; chg5m: number | null; born: number | null; copies: number; wash?: boolean };
type Heat = "heating" | "steady" | "cooling";
export type Story = { id: string; name: string; why: string; link?: string; facts: string; heat?: Heat; source: "ai" | "theme" | "words" | "copies"; score: number;
  stats: { coins: number; copies: number; volH1: number; mcap: number; medChg1h: number | null; up: number; fresh: number; m5?: number | null; up5?: number; leadShare?: number }; coins: RunCoin[] };
export type Running = { t: number; ai: { at: number; model: string | null } | null; universe: { coins: number; families: number }; stories: Story[]; solo: RunCoin[]; soloHeat?: Heat };

const pct = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString()}%`);
const tone = (n: number | null | undefined) => (n == null ? "text-muted" : n >= 0 ? "text-up" : "text-down");
// How each story was grouped, in plain words (the pill on the picked story).
const SOURCE: Record<Story["source"], string> = {
  ai: "Grouped by Claude",
  theme: "Grouped by theme",
  words: "Same word in the name",
  copies: "One coin and its copies",
};
const HEAT: Record<Heat, [string, string, string]> = {
  heating: ["Heating up", "text-up", "Most of its coins are rising in the last 5 minutes"],
  steady: ["Steady", "text-muted", "Moving sideways over the last 5 minutes"],
  cooling: ["Cooling off", "text-down", "Most of its coins are falling in the last 5 minutes"],
};
const SOLO = "__solo";
type Sort = "hot" | "vol" | "move" | "new";
type Col = "mcap" | "volH1" | "chg1h" | "chg5m" | "born";

// The stories, plus the coins running on their own as a story of their own at the end.
function withSolo(d: Running): Story[] {
  if (!d.solo?.length) return d.stories || [];
  const up = d.solo.filter((c) => (c.chg1h ?? 0) > 0).length, moves = d.solo.map((c) => c.chg1h).filter((x): x is number => x != null).sort((a, b) => a - b);
  const vol = d.solo.reduce((s, c) => s + c.volH1, 0);
  return [...d.stories, { id: SOLO, name: "Running on their own", why: "", facts: "", source: "theme", heat: d.soloHeat, score: -1, coins: d.solo,
    link: "The biggest movers this hour that don't belong to any story: each one is running on its own name, not a shared idea.",
    stats: { coins: d.solo.length, copies: d.solo.length, volH1: vol, mcap: 0, medChg1h: moves.length ? moves[Math.floor(moves.length / 2)] : null, up, fresh: d.solo.filter((c) => c.born && Date.now() - c.born < 3600e3).length,
      leadShare: vol ? Math.round((Math.max(...d.solo.map((c) => c.volH1)) / vol) * 100) : 0 } }];
}

const coinsLine = (s: Story) => `${s.stats.coins} coin${s.stats.coins === 1 ? "" : "s"}${s.stats.copies > s.stats.coins ? ` · ${s.stats.copies - s.stats.coins} cop${s.stats.copies - s.stats.coins === 1 ? "y" : "ies"}` : ""}`;

// A few coin pictures overlapping, for the list.
const Faces = ({ coins }: { coins: RunCoin[] }) => (
  <span className="flex shrink-0 -space-x-2">{coins.slice(0, 4).map((c) => <span key={c.mint} className="rounded-full ring-2 ring-paper-2"><CoinPic c={c} size={22} /></span>)}</span>
);

function HeatTag({ heat, small }: { heat?: Heat; small?: boolean }) {
  if (!heat) return null;
  const [label, cls, tip] = HEAT[heat];
  return (
    <span title={tip} className={cn("inline-flex shrink-0 items-center gap-1 font-medium", small ? "text-2xs" : "text-xs", cls)}>
      <svg viewBox="0 0 12 12" className={small ? "size-2.5" : "size-3"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {heat === "heating" ? <path d="M2 8.5 5 5.5l2 2L10 4.5M7.5 4.5H10V7" /> : heat === "cooling" ? <path d="M2 3.5 5 6.5l2-2 3 3M7.5 7.5H10V5" /> : <path d="M2 6h8" />}
      </svg>
      {label}
    </span>
  );
}

function StoryItem({ s, rank, on, onPick }: { s: Story; rank: number | null; on: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} aria-current={on || undefined} data-story={s.id}
      className={cn("group flex w-full min-w-0 items-center gap-3 border-l-2 px-3 py-3 text-left transition-colors",
        on ? "border-l-ink bg-paper-4" : "border-l-transparent hover:bg-paper-3")}>
      <span className={cn("num grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold", on ? "bg-ink text-paper" : "bg-paper-4 text-ink-2")}>
        {rank ?? <svg viewBox="0 0 12 12" className="size-3" fill="currentColor" aria-hidden><circle cx="6" cy="6" r="2" /></svg>}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <b className="truncate text-md font-semibold text-ink">{s.name}</b>
          {s.source === "ai" && <i className="size-1.5 shrink-0 rounded-full bg-info" title={SOURCE.ai} />}
        </span>
        <span className="flex min-w-0 items-center gap-2"><Faces coins={s.coins} /><span className="num truncate text-xs text-muted">{coinsLine(s)}</span></span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 leading-tight">
        <b className="num text-md font-semibold text-ink">{money(s.stats.volH1)}</b>
        <span className={cn("num text-xs font-medium", tone(s.stats.medChg1h))} title="Typical coin's move over the hour">{pct(s.stats.medChg1h)}</span>
        <HeatTag heat={s.heat} small />
      </span>
    </button>
  );
}

const Stat = ({ label, children, note, className }: { label: string; children: ReactNode; note: ReactNode; className?: string }) => (
  <div className="flex min-w-0 flex-col gap-1 rounded-control border border-rule bg-paper px-3.5 py-3">
    <span className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">{label}</span>
    <b className={cn("num truncate text-xl leading-tight font-semibold text-ink", className)}>{children}</b>
    <span className="text-xs leading-snug text-muted">{note}</span>
  </div>
);

// Where the story's money is: one bar split by coin (the biggest six, then the rest), each part its share of the
// hour's volume, with a legend under it.
const SHADES = ["bg-ink", "bg-ink/75", "bg-ink/55", "bg-ink/40", "bg-ink/28", "bg-ink/18"];
function MoneyBar({ coins, total }: { coins: RunCoin[]; total: number }) {
  if (!total || coins.length < 2) return null;
  const top = [...coins].sort((a, b) => b.volH1 - a.volH1).slice(0, 6);
  const rest = Math.max(0, total - top.reduce((s, c) => s + c.volH1, 0));
  const parts = [...top.map((c, i) => ({ key: c.mint, label: c.symbol, v: c.volH1, cls: SHADES[i] })), ...(rest / total > 0.01 ? [{ key: "rest", label: "Others", v: rest, cls: "bg-paper-5" }] : [])];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">Where the money is</span>
        <span className="text-xs text-muted">share of the hour's trading</span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-paper-4" role="img" aria-label="Share of the story's trading by coin">
        {parts.map((p) => <i key={p.key} className={cn("block h-full border-r border-paper-2 last:border-r-0", p.cls)} style={{ width: `${(p.v / total) * 100}%` }} title={`${p.label}: ${money(p.v)} (${Math.round((p.v / total) * 100)}%)`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5 text-xs text-ink-2">
            <i className={cn("size-2 rounded-full", p.cls)} /><b className="font-semibold">{p.label}</b><span className="num text-muted">{Math.round((p.v / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const COLS: [Col, string, string][] = [["mcap", "Market cap", "What the coin is worth now"], ["volH1", "Traded 1h", "Dollars traded in the last hour (copies included)"], ["chg1h", "1h", "Price change over the hour"], ["chg5m", "5m", "Price change over the last 5 minutes"], ["born", "Age", "Time since launch"]];
function CoinTable({ coins }: { coins: RunCoin[] }) {
  const [col, setCol] = useState<Col>("volH1");
  const [asc, setAsc] = useState(false);
  const rows = useMemo(() => {
    const v = (c: RunCoin) => (col === "born" ? (c.born ? -c.born : null) : c[col]);
    return [...coins].sort((a, b) => { const x = v(a), y = v(b); if (x == null) return 1; if (y == null) return -1; return asc ? x - y : y - x; });
  }, [coins, col, asc]);
  const most = Math.max(1, ...coins.map((c) => c.volH1));
  const head = (k: Col, label: string, tip: string, cls = "") => (
    <th key={k} className={cn("px-2 py-2 text-right text-xs font-medium whitespace-nowrap text-muted", cls)} title={tip}>
      <button type="button" onClick={() => (k === col ? setAsc(!asc) : (setCol(k), setAsc(false)))} className={cn("inline-flex items-center gap-1 hover:text-ink", k === col && "text-ink")}>
        {label}{k === col && <span aria-hidden>{asc ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-md">
        <thead><tr className="border-b border-rule"><th className="px-2 py-2 text-left text-xs font-medium text-muted">Coin</th>{COLS.map(([k, l, tip], i) => head(k, l, tip, i === 4 ? "max-sm:hidden" : ""))}</tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.mint} className="group border-b border-rule/60 last:border-0 hover:bg-paper-3/60">
              <td className="px-2 py-2">
                <a href={`#/coin/${c.mint}`} className="flex min-w-0 items-center gap-2.5" title={c.name || c.symbol}>
                  <CoinPic c={c} size={32} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="flex min-w-0 items-center gap-1.5"><b className="truncate font-semibold text-ink group-hover:underline">{c.symbol}</b>
                      {c.copies > 1 && <span className="num shrink-0 rounded-full bg-paper-5 px-1.5 text-2xs font-semibold text-ink-2" title={`${c.copies} coins trade under this name. This row is the most traded one; volume counts them all.`}>{c.copies} coins</span>}</span>
                    <span className="flex min-w-0 items-center gap-1.5"><span className="max-w-[200px] truncate text-xs text-muted">{c.name || ""}</span>
                      {c.wash && <span className="shrink-0 rounded-full bg-warn/12 px-1.5 text-2xs font-semibold text-warn" title="More than 20x its market cap was traded in the hour. That is almost always bots trading with themselves to look busy, so treat its volume with care.">Suspicious volume</span>}</span>
                  </span>
                </a>
              </td>
              <td className="num px-2 text-right"><LiveMc mint={c.mint} value={c.mcap} fmt={money} /></td>
              <td className="px-2 text-right">
                <span className="flex items-center justify-end gap-2">
                  <i className="block h-1 w-12 overflow-hidden rounded-full bg-paper-4 max-md:hidden"><i className="block h-full rounded-full bg-ink/60" style={{ width: `${(c.volH1 / most) * 100}%` }} /></i>
                  <span className="num text-ink-2">{money(c.volH1)}</span>
                </span>
              </td>
              <td className={cn("num px-2 text-right font-semibold", tone(c.chg1h))}>{pct(c.chg1h)}</td>
              <td className={cn("num px-2 text-right", tone(c.chg5m))}>{pct(c.chg5m)}</td>
              <td className="num px-2 text-right text-muted max-sm:hidden">{c.born ? ago(c.born).replace(" ago", "") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StoryDetail({ s }: { s: Story }) {
  const solo = s.id === SOLO;
  const what = s.source === "ai" && s.why ? s.why : s.link || "";
  const copies = s.stats.copies - s.stats.coins;
  return (
    <article className="surface flex min-w-0 flex-col gap-5 p-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-display text-2xl leading-tight font-semibold tracking-[-0.01em] text-ink">{s.name}</h2>
          <HeatTag heat={s.heat} />
          {!solo && <span className={cn("ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", s.source === "ai" ? "bg-info/12 text-info" : "bg-paper-4 text-ink-2")}>{SOURCE[s.source]}</span>}
        </div>
        {what && <p className="max-w-3xl text-lg leading-relaxed text-ink">{what}</p>}
        {s.facts && <p className="max-w-3xl text-md leading-relaxed text-ink-2">{s.facts}</p>}
      </header>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Traded, last hour" note={`across ${coinsLine(s)}`}>{money(s.stats.volH1)}</Stat>
        <Stat label="Typical move, 1h" className={tone(s.stats.medChg1h)} note="half its coins did better, half worse">{pct(s.stats.medChg1h)}</Stat>
        <Stat label="Up on the hour" note={s.stats.up5 != null && s.heat ? `${s.stats.up5} rising in the last 5 min` : "coins above their price an hour ago"}>
          {s.stats.up}<span className="text-md font-normal text-muted"> of {s.stats.coins}</span>
        </Stat>
        <Stat label="New launches" note={copies > 0 ? `launched this hour · ${copies} cop${copies === 1 ? "y" : "ies"} in total` : "launched in the last hour"}>{s.stats.fresh}</Stat>
      </div>
      <MoneyBar coins={s.coins} total={s.stats.volH1} />
      <CoinTable coins={s.coins} />
    </article>
  );
}

const SORTS: [Sort, string][] = [["hot", "Hot"], ["vol", "Volume"], ["move", "Move"], ["new", "New"]];
const SORT_TIP: Record<Sort, string> = { hot: "Money moving, how many coins carry it and how hard they move", vol: "Most dollars traded in the hour", move: "Biggest typical move in the hour", new: "Most coins launched in the last hour" };
const sortBy: Record<Sort, (s: Story) => number> = { hot: (s) => s.score, vol: (s) => s.stats.volH1, move: (s) => s.stats.medChg1h ?? -Infinity, new: (s) => s.stats.fresh * 1e12 + s.stats.volH1 };

export function RunningNow({ d, error }: { d: Running | null | undefined; error: string | null }) {
  const [sort, setSort] = useState<Sort>(() => store.get<Sort>("narratives:sort", "hot"));
  const [pick, setPick] = useState<string | null>(null);
  const [help, setHelp] = useState(() => store.get<boolean>("narratives:help", true));
  const detail = useRef<HTMLDivElement>(null);
  const all = useMemo(() => (d ? withSolo(d) : []), [d]);
  const list = useMemo(() => {
    const stories = all.filter((s) => s.id !== SOLO).sort((a, b) => sortBy[sort](b) - sortBy[sort](a));
    const solo = all.find((s) => s.id === SOLO);
    return solo ? [...stories, solo] : stories;
  }, [all, sort]);
  const current = list.find((s) => s.id === pick) || list[0];
  const choose = (id: string, scroll = false) => {
    setPick(id);
    if (scroll && matchMedia("(max-width: 1023px)").matches) requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  // Up and down arrows move through the stories while the list has focus.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = list.findIndex((s) => s.id === current?.id), next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) { setPick(next.id); (e.currentTarget.querySelector(`[data-story="${CSS.escape(next.id)}"]`) as HTMLElement | null)?.focus(); }
  };
  useEffect(() => { store.set("narratives:sort", sort); }, [sort]);
  useEffect(() => { store.set("narratives:help", help); }, [help]);

  if (!d) return <div className="surface px-4 py-6 text-md text-muted">{error ? `Couldn't read what is running: ${error}` : "Reading what is running…"}</div>;
  if (!list.length) return <div className="surface px-4 py-6 text-md text-muted">No story has two or more coins running right now.</div>;
  const heating = list.filter((s) => s.id !== SOLO && s.heat === "heating").length;
  return (
    <section className="flex flex-col gap-3">
      {help ? (
        <div className="surface flex items-start gap-3 px-4 py-3">
          <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-paper-4 text-2xs font-bold text-ink-2">i</span>
          <p className="min-w-0 flex-1 text-md leading-relaxed text-ink-2">
            <b className="font-semibold text-ink">How to read this.</b> Every Solana coin with real money moving this hour ($10K+ traded) is grouped into stories: coins with the same theme,
            the same word in their name, or copies of one coin. A story is ranked by the money flowing through it, how many coins carry it and how hard they move.
            <span className="text-up"> Heating up</span> means most of its coins are rising in the last 5 minutes; <span className="text-down">cooling off</span>, most are falling.
          </p>
          <button onClick={() => setHelp(false)} className="shrink-0 text-sm text-muted hover:text-ink" aria-label="Hide the explanation">Hide</button>
        </div>
      ) : null}
      <div className="grid items-start gap-3 lg:grid-cols-[380px_minmax(0,1fr)]">
        <nav aria-label="Stories" onKeyDown={onKey} className="surface flex min-w-0 flex-col overflow-hidden lg:sticky lg:top-14 lg:max-h-[calc(100dvh-8rem)]">
          <div className="flex flex-col gap-2 border-b border-rule px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">{d.universe.coins.toLocaleString()} coins moving · {list.length - (list.at(-1)?.id === SOLO ? 1 : 0)} stories{heating ? <> · <span className="text-up">{heating} heating up</span></> : null}</span>
              <span className="text-xs text-muted">{d.ai ? `Claude ${ago(d.ai.at)}` : `updated ${ago(d.t)}`}{!help && <> · <button onClick={() => setHelp(true)} className="underline decoration-rule-2 underline-offset-2 hover:text-ink">how it works</button></>}</span>
            </div>
            <span title={SORT_TIP[sort]}><Segmented label="Sort stories" value={sort} onChange={setSort} options={SORTS} /></span>
          </div>
          <div className="min-h-0 overflow-y-auto">
            {list.map((s, i) => <StoryItem key={s.id} s={s} rank={s.id === SOLO ? null : i + 1} on={s.id === current?.id} onPick={() => choose(s.id, true)} />)}
          </div>
        </nav>
        <div ref={detail} className="min-w-0 scroll-mt-3">{current && <StoryDetail s={current} />}</div>
      </div>
    </section>
  );
}
