import { XHover } from "@/components/XCard";
import * as D from "@/components/ui/modal";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { api, post } from "@/lib/api";
import { ageStr, compact, safeHref, shortAddr } from "@/lib/format";
import { useTrade } from "@/lib/mode";
import { usePulse, type Coin } from "@/lib/pulse";
import { trade } from "@/lib/trade";
import { cn, store } from "@/lib/utils";
import { CoinImg } from "@/components/page";
import { LiveMc } from "@/components/Live";
import { toast } from "@/components/ui/toast";
import { Icon } from "@/shell/icons";

// The launcher (Axiom's search window): "/", Ctrl+K or the top-bar search opens it over any page. Live Pulse
// coins answer as you type, the radar's whole coin table answers a moment later (/api/tokens?q=). Up/Down pick
// a row, Enter opens it, the bolt buys it. With nothing typed it shows the coins opened from here before.
import { useLauncher } from "@/lib/modals";
export { openLauncher, useLauncher } from "@/lib/modals";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HISTORY = "launcher:history", SIZE = "launcher:sol";
// History is every coin page you open, from anywhere (a Pulse row, a link, a search), newest first.
const rememberCoin = (mint: string) => {
  if (!MINT.test(mint)) return;
  const h = store.get<string[]>(HISTORY, []);
  if (h[0] !== mint) store.set(HISTORY, [mint, ...h.filter((m) => m !== mint)].slice(0, 40));
};
if (typeof window !== "undefined") {
  const seen = () => { const m = location.hash.match(/^#\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/); if (m) rememberCoin(m[1]); };
  window.addEventListener("hashchange", seen);
  seen();
}
// A pasted link (pump.fun, Axiom, GMGN, Solscan…) searches by the contract in it.
const termOf = (q: string) => {
  const t = q.trim();
  if (!/^(https?:\/\/|www\.)|\.(fun|com|io|trade|xyz|app)\//i.test(t)) return t;
  return t.split(/[/?#&=.]/).filter((s) => MINT.test(s)).pop() ?? t;
};
// How well a row answers the search: the CA, the exact ticker, a ticker or name starting with it, anything else.
const relevance = (r: { mint: string; symbol?: string | null; name?: string | null }, term: string, lower: string) => {
  const sym = (r.symbol || "").toLowerCase(), name = (r.name || "").toLowerCase();
  return r.mint === term ? 0 : sym === lower ? 1 : sym.startsWith(lower) ? 2 : name.startsWith(lower) ? 3 : 4;
};
const matches = (r: { mint: string; symbol?: string | null; name?: string | null }, term: string, lower: string) =>
  r.mint === term || (term.length >= 6 && r.mint.startsWith(term)) || `${r.symbol || ""} ${r.name || ""}`.toLowerCase().includes(lower);

interface Row { mint: string; symbol?: string | null; name?: string | null; image?: string | null; born?: number | null; mcap?: number | null; ath?: number | null;
  vol?: number | null; liq?: number | null; score?: number | null; dex?: string | null; graduated?: boolean; x?: string | null; web?: string | null; tg?: string | null }
interface ApiRow { mint: string; symbol?: string; name?: string; image?: string | null; pair_created?: number | null; first_seen?: number; mcap?: number | null; peak_mcap?: number | null;
  vol_h24?: number | null; liquidity?: number | null; score?: number | null; dex?: string | null; graduated?: number; links?: { type: string; url: string }[] }

const fromApi = (t: ApiRow): Row => {
  const link = (...k: string[]) => t.links?.find((l) => k.includes(l.type))?.url ?? null;
  return { mint: t.mint, symbol: t.symbol, name: t.name, image: t.image || null, born: t.pair_created || t.first_seen, mcap: t.mcap, ath: t.peak_mcap, vol: t.vol_h24, liq: t.liquidity,
    score: t.score, dex: t.dex, graduated: Boolean(t.graduated), x: link("twitter", "x"), web: link("website"), tg: link("telegram") };
};
const fromPulse = (c: Coin, solUsd: number): Row => ({ mint: c.mint, symbol: c.symbol, name: c.name, born: c.born, mcap: c.mcap ?? (c.startMcapSol ? c.startMcapSol * solUsd : null),
  vol: c.liveVol ?? c.vol, dex: c.dex, graduated: c.graduated, x: c.x, web: c.web, tg: c.tg, score: c.ai?.score ?? null });

// Launchpad filters along the top. `dex` values are the radar's (server DEXES).
const PADS: [key: string, label: string, dex: string[] | null][] = [["all", "All", null], ["pump", "Pump", ["pumpfun", "pumpswap"]],
  ["bonk", "Bonk", ["launchlab"]], ["meteora", "Meteora", ["meteoradbc", "meteora"]], ["bags", "Bags", ["bags"]], ["raydium", "Raydium", ["raydium"]]];
type Sort = "score" | "new" | "mcap" | "vol" | "liq";
const SORTS: [Sort, string, ReactNode][] = [["score", "Trending", <Icon.pulse />], ["new", "Newest", <Icon.refresh />], ["mcap", "Market cap", <Icon.candles />],
  ["vol", "Volume", <Icon.rank />], ["liq", "Liquidity", <Icon.curve />]];
const key = (s: Sort, r: Row) => (s === "new" ? r.born : s === "mcap" ? r.mcap : s === "vol" ? r.vol : s === "liq" ? r.liq : r.score) ?? -Infinity;
// A coin the radar has no dex for yet still shows under its launchpad by its contract's vanity suffix.
const onPad = (r: Row, dex: string[]) => dex.includes(r.dex || "") || (!r.dex && ((dex.includes("pumpfun") && r.mint.endsWith("pump")) || (dex.includes("launchlab") && r.mint.endsWith("bonk"))));
const padTone = (r: Row) => r.graduated ? "border-info" : r.dex === "pumpfun" || r.dex === "pumpswap" ? "border-up" : "border-caution";

export function Launcher() {
  const open = useLauncher((s) => s.open);
  const close = () => useLauncher.setState({ open: false });
  return (
    <D.Root open={open} onOpenChange={(o) => !o && close()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]" />
        <D.Content aria-describedby={undefined}
          className="fixed top-[8vh] left-1/2 z-50 flex h-[min(820px,84dvh)] w-[min(68rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-[16px] border border-rule-2 bg-paper-2 shadow-sheet">
          <D.Title className="sr-only">Search coins</D.Title>
          {open && <Body close={close} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Body({ close }: { close: () => void }) {
  const [q, setQ] = useState(""), [pad, setPad] = useState(() => store.get("launcher:pad", "all"));
  const [sort, setSort] = useState<Sort>(() => store.get("launcher:sort", "score"));
  const [sol, setSol] = useState(() => store.get(SIZE, 0.25)), [editSize, setEditSize] = useState(false);
  const [found, setFound] = useState<{ term: string; rows: Row[]; hist?: boolean }>({ term: "", rows: [] }), [loading, setLoading] = useState(false), [sel, setSel] = useState(0);
  const [failed, setFailed] = useState(false);
  const [history, setHistory] = useState<string[]>(() => store.get<string[]>(HISTORY, []));
  const listRef = useRef<HTMLDivElement>(null);
  const term = termOf(q), lower = term.toLowerCase();

  // Live coins answer at once.
  const solUsd = usePulse((s) => s.live.solUsd || 150);
  const live = usePulse(useShallow((s) => {
    if (!lower) return [] as Coin[];
    return Object.values(s.coins).filter((c) => matches(c, term, lower)).slice(0, 60);
  }));

  // The whole coin table answers after a short pause; with nothing typed, the history's coins are looked up.
  const histKey = history.slice(0, 30).join(",");
  useEffect(() => {
    setFailed(false);
    if (!term && !histKey) { setFound({ term: "", rows: [] }); setLoading(false); return; }
    let gone = false;
    setLoading(true);
    const t = setTimeout(() => {
      api<{ rows: ApiRow[] }>(term ? `tokens?q=${encodeURIComponent(term)}&limit=60` : `tokens?mints=${histKey}&limit=30`)
        .then((r) => { if (!gone) setFound({ term, rows: r.rows.map(fromApi), hist: !term }); })
        .catch(() => { if (!gone) { setFound({ term, rows: [], hist: !term }); setFailed(true); } })
        .finally(() => { if (!gone) setLoading(false); });
    }, term ? 160 : 0);
    return () => { gone = true; clearTimeout(t); };
  }, [term, histKey]);

  const rows = useMemo(() => {
    const by = new Map<string, Row>();
    // While the table looks up a new search, the last answer stays only where it still matches what is typed.
    for (const r of found.rows) if (!term || found.term === term || matches(r, term, lower)) by.set(r.mint, r);
    for (const c of live) { const p = fromPulse(c, solUsd), r = by.get(c.mint); by.set(c.mint, r ? { ...r, mcap: p.mcap ?? r.mcap, x: r.x ?? p.x, web: r.web ?? p.web, tg: r.tg ?? p.tg } : p); }
    const dex = PADS.find(([k]) => k === pad)?.[2];
    let out = [...by.values()].filter((r) => !dex || onPad(r, dex));
    // Best match first, then the chosen sort among equally good matches.
    // Among exact ticker matches the real coin comes first (the biggest), not a $3K copy with the same ticker.
    const exact = (r: Row) => relevance(r, term, lower) <= 1;
    if (term) out.sort((a, b) => relevance(a, term, lower) - relevance(b, term, lower) || (exact(a) && exact(b) && sort === "score" ? (b.mcap ?? -1) - (a.mcap ?? -1) : 0) || (key(sort, b) as number) - (key(sort, a) as number));
    else {
      // A coin from history the coin table does not know (SOL, an old or brand-new one) stays in the list by its contract.
      if (found.hist) for (const m of history.slice(0, 30)) if (!by.has(m) && (!dex || onPad({ mint: m }, dex))) out.push({ mint: m, symbol: null, name: shortAddr(m) });
      out.sort((a, b) => history.indexOf(a.mint) - history.indexOf(b.mint));
    }
    // A pasted contract the radar has never seen still opens.
    if (MINT.test(term) && !by.has(term)) out = [{ mint: term, symbol: null, name: "Open this contract" }, ...out];
    return out;
  }, [found, live, solUsd, pad, sort, term, lower, history]);

  useEffect(() => setSel(0), [term, pad, sort]);
  useEffect(() => setSel((i) => Math.min(i, Math.max(0, rows.length - 1))), [rows.length]);
  useEffect(() => { listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const remember = (mint: string) => {
    const h = [mint, ...history.filter((m) => m !== mint)].slice(0, 40);
    store.set(HISTORY, h); setHistory(h);
  };
  const go = (r: Row) => { remember(r.mint); close(); location.hash = `#/coin/${r.mint}`; };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && rows[sel]) { e.preventDefault(); go(rows[sel]); }
  };
  const pickPad = (k: string) => { setPad(k); store.set("launcher:pad", k); };
  const pickSort = (s: Sort) => { setSort(s); store.set("launcher:sort", s); };
  const clearHistory = () => { store.set(HISTORY, []); setHistory([]); };

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-5 pt-4">
        <div role="radiogroup" aria-label="Launchpad" className="flex min-w-0 flex-wrap items-center gap-2">
          {PADS.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={pad === k} onClick={() => pickPad(k)}
              className={cn("h-8 rounded-control border px-3 text-md font-semibold transition-colors duration-100",
                pad === k ? "border-accent bg-accent/15 text-ink" : "border-rule-2 bg-paper-3 text-ink-2 hover:border-muted hover:text-ink")}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {editSize
            ? <input autoFocus defaultValue={sol} inputMode="decimal" aria-label="Quick-buy size in SOL"
                onBlur={(e) => { const n = Math.min(10, Math.max(0.001, +e.target.value || 0.25)); setSol(n); store.set(SIZE, n); setEditSize(false); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.stopPropagation(); (e.target as HTMLInputElement).blur(); } }}
                className="num h-8 w-20 rounded-control border border-accent bg-paper px-2 text-md text-ink outline-none" />
            : <button onClick={() => setEditSize(true)} title="Quick-buy size" className="num flex h-8 items-center gap-1 rounded-control border border-rule-2 bg-paper-3 px-2.5 text-md font-semibold text-ink-2 hover:text-ink [&_svg]:size-3.5 [&_svg]:fill-current"><Icon.bolt />{sol} SOL</button>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-rule px-5 py-4">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} spellCheck={false}
          placeholder="Search by name, ticker or CA" aria-label="Search by name, ticker or contract address"
          className="min-w-0 flex-1 bg-transparent text-2xl text-ink outline-none placeholder:text-muted" />
        <D.Close className="rounded-control border border-rule-2 bg-paper px-2.5 py-1 text-md font-semibold text-ink-2 hover:text-ink">Esc</D.Close>
      </div>

      <div className="flex shrink-0 items-center gap-3 px-5 py-3">
        <span className="text-md font-medium text-ink-2">{term ? `Results${rows.length ? ` · ${rows.length}` : ""}` : "History"}</span>
        {!term && history.length > 0 && <button onClick={clearHistory} className="text-sm text-muted hover:text-ink-2">Clear</button>}
        {loading && <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-label="Searching" />}
        {term && (
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-md text-muted max-sm:hidden">Sort results by</span>
            {SORTS.map(([s, label, ic]) => (
              <button key={s} onClick={() => pickSort(s)} title={label} aria-label={`Sort by ${label}`} aria-pressed={sort === s}
                className={cn("grid size-8 place-items-center rounded-control transition-colors duration-100 [&_svg]:size-4", sort === s ? "bg-accent/20 text-accent" : "text-muted hover:bg-paper-3 hover:text-ink")}>{ic}</button>
            ))}
          </div>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {rows.length ? rows.map((r, i) => <LRow key={r.mint} r={r} i={i} active={i === sel} sol={sol} onHover={() => setSel(i)} onOpen={() => go(r)} onBuy={() => remember(r.mint)} />)
          : <p className="px-3 py-16 text-center text-md text-muted">{term ? (loading ? "Searching…" : failed ? "Search is not answering right now. Try again in a moment." : `No coin matches “${term}”${pad !== "all" ? " on this launchpad" : ""}.`) : history.length && pad !== "all" ? `None of the coins you opened are on ${PADS.find(([k]) => k === pad)?.[1]}. Pick All to see your whole history.` : loading && history.length ? "Loading your history…" : "Coins you open show up here. Type a name, ticker or paste a contract."}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-4 border-t border-rule px-5 py-2 text-sm text-muted max-sm:hidden">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> pick</span><span><Kbd>Enter</Kbd> open</span><span><Kbd>Esc</Kbd> close</span><span className="ml-auto"><Kbd>/</Kbd> or <Kbd>Ctrl K</Kbd> from anywhere</span>
      </div>
    </>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => <kbd className="mr-1 rounded-chip border border-rule-2 px-1.5 text-xs text-ink-2">{children}</kbd>;

function Fig({ k, v, sub, mint }: { k: string; v?: number | null; sub?: ReactNode; mint?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-baseline gap-1.5 whitespace-nowrap"><span className="text-sm text-muted">{k}</span>{mint ? <LiveMc mint={mint} value={v} className="text-xl font-semibold text-ink" /> : <b className="num text-xl font-semibold text-ink">{v == null ? "—" : compact(v)}</b>}</span>
      {sub && <span className="num text-xs whitespace-nowrap text-muted">{sub}</span>}
    </div>
  );
}

function LRow({ r, i, active, sol, onHover, onOpen, onBuy }: { r: Row; i: number; active: boolean; sol: number; onHover: () => void; onOpen: () => void; onBuy: () => void }) {
  const paper = useTrade((s) => s.paper);
  const [busy, setBusy] = useState(false);
  const age = r.born ? Date.now() - r.born : null;
  const buy = async () => {
    if (busy) return;
    setBusy(true); onBuy();
    await trade({ side: "buy", mint: r.mint, symbol: r.symbol || "", sol }, () => post("paper/quoted", { mint: r.mint, sol }));
    setBusy(false);
  };
  const copy = () => { navigator.clipboard?.writeText(r.mint); toast("Contract copied"); };
  const social = (href: string | null | undefined, ic: ReactNode, label: string) => href && <a href={href} target="_blank" rel="noreferrer" aria-label={label} className="text-muted hover:text-ink [&_svg]:size-4">{ic}</a>;

  return (
    <div data-i={i} onMouseMove={onHover} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) onOpen(); }}
      className={cn("grid cursor-pointer grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_6.5rem_auto] items-center gap-4 rounded-card px-3 py-3 transition-colors duration-75 max-md:grid-cols-[minmax(0,1fr)_auto]",
        active ? "bg-paper-4" : "hover:bg-paper-3")}>
      <div className="flex min-w-0 items-center gap-3.5">
        <span className={cn("relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-control border-2 bg-paper-4 text-xs font-semibold text-muted uppercase", padTone(r))}>
          {(r.symbol || "?").slice(0, 3)}<CoinImg mint={r.mint} fallback={r.image} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            {r.symbol && <b className="shrink-0 text-xl font-semibold text-ink">{r.symbol}</b>}
            <span className="truncate text-lg text-muted">{r.name}</span>
            <button onClick={copy} aria-label="Copy contract address" title={r.mint} className="shrink-0 text-muted hover:text-ink [&_svg]:size-3.5"><Icon.copy /></button>
          </div>
          <div className="flex items-center gap-2.5 text-md">
            {age != null && <span className="num font-medium text-up">{ageStr(age)}</span>}
            <span className="num text-xs text-muted">{shortAddr(r.mint)}</span>
            {r.x && safeHref(r.x) && <XHover href={safeHref(r.x)!}><a href={safeHref(r.x)!} target="_blank" rel="noreferrer" aria-label="X" className="text-muted hover:text-ink [&_svg]:size-4"><Icon.x /></a></XHover>}{social(r.web, <Icon.web />, "Website")}{social(r.tg, <Icon.tg />, "Telegram")}
          </div>
        </div>
      </div>
      <div className="max-md:hidden"><Fig k="MC" mint={r.mint} v={r.mcap} sub={r.ath ? <>ATH {compact(r.ath)}</> : null} /></div>
      <div className="max-md:hidden"><Fig k="V" v={r.vol} sub="24h" /></div>
      <div className="max-md:hidden"><Fig k="L" v={r.liq} /></div>
      <button onClick={buy} aria-busy={busy} title={paper ? `Paper buy ${sol} SOL` : `Buy ${sol} SOL with real SOL`}
        className={cn("num flex h-10 items-center gap-1.5 justify-self-end rounded-full bg-accent px-4 text-lg font-bold whitespace-nowrap text-accent-ink transition-[filter,transform] duration-100 hover:brightness-110 active:scale-95 [&_svg]:size-4 [&_svg]:fill-current", busy && "[&_svg]:animate-pulse")}>
        <Icon.bolt />{sol} SOL
      </button>
    </div>
  );
}
