// Discover (#/coins), laid out like Axiom's: Trending / Surge / New pairs / Bonded lists over a 5m, 1h or
// 24h window, Axiom's filters (protocols, keywords, audits, metrics, socials), hidden coins, and one row per
// coin with its links, figures, audit pills and a quick buy.
import { useEffect, useState } from "react";
import { SolanaLogo } from "@/components/brand";
import { Empty, Loading, Page, Panel, Problem } from "@/components/page";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { Checks, isSet, Ranges, Text, type Filters, type Range } from "@/components/filterbits";
import { prefetch, usePoll } from "@/lib/coin";
import { useTrade } from "@/lib/mode";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { FomoTab, type FomoKind } from "./discover/fomo";
import { DiscoverRow, GRID, withLive, type LiveFigures, type Row, type Tf } from "./discover/parts";

type Tab = "top" | "held" | "trending" | "surge" | "new" | "bonded";
type Section = "audits" | "metrics" | "socials";
const TABS: [Tab, string, string][] = [
  ["top", "Top", "Fomo's trending coins, exactly as fomo.family shows them"], ["held", "Most held", "The coins Fomo traders hold most, exactly as fomo.family shows them"],
  ["trending", "Trending", "Most traded in the window"], ["surge", "Surge", "Biggest movers in the window, with real volume"],
  ["new", "New pairs", "Newest pools first"], ["bonded", "Bonded", "Coins that finished their curve, newest first"],
];
const SORT: Record<Tab, Record<Tf, string>> = {
  top: { "5m": "vol5", "1h": "volume", "24h": "vol24" }, held: { "5m": "vol5", "1h": "volume", "24h": "vol24" },
  trending: { "5m": "vol5", "1h": "volume", "24h": "vol24" }, surge: { "5m": "chg5", "1h": "change", "24h": "chg24" },
  new: { "5m": "new", "1h": "new", "24h": "new" }, bonded: { "5m": "new", "1h": "new", "24h": "new" },
};
// Filters that follow the window: the key typed in the panel → the key the server knows for each window.
const WINDOWED: Record<string, Record<Tf, string>> = {
  minVol: { "5m": "minVol5", "1h": "minVol", "24h": "minVol24" }, maxVol: { "5m": "maxVol5", "1h": "maxVol", "24h": "maxVol24" },
  minTx: { "5m": "minTx5", "1h": "minTx", "24h": "minTx" }, maxTx: { "5m": "maxTx5", "1h": "maxTx", "24h": "maxTx" },
  minBuys: { "5m": "minBuys5", "1h": "minBuys", "24h": "minBuys" }, minSells: { "5m": "minSells5", "1h": "minSells", "24h": "minSells" },
};
const PROTOCOLS: [string, string][] = [
  ["pumpfun", "Pump"], ["pumpswap", "Pump AMM"], ["meteoradbc", "Meteora DBC"], ["meteora", "Meteora"], ["raydium", "Raydium"],
  ["orca", "Orca"], ["bags", "Bags"], ["fluxbeam", "FluxBeam"], ["other", "Other"],
];
const AUDITS: Range[] = [
  ["Age", "minAge", "maxAge", "min"], ["Top 10 holders", "minTop10", "maxTop10", "%"], ["Dev holding", "minDev", "maxDev", "%"],
  ["Insiders", "minInsider", "maxInsider", "%"], ["Holders", "minHolders", "maxHolders", ""], ["Dev coins launched", null, "maxDevLaunches", ""],
  ["LP locked", "minLp", null, "%"], ["Safety score", "minSafety", "maxSafety", "/100"],
];
const metrics = (tf: Tf): Range[] => [
  ["Market cap", "minMcap", "maxMcap", "$"], ["Liquidity", "minLiq", "maxLiq", "$"], [`Volume ${tf}`, "minVol", "maxVol", "$"],
  [`Txns ${tf === "5m" ? "5m" : "1h"}`, "minTx", "maxTx", ""], [`Buys ${tf === "5m" ? "5m" : "1h"}`, "minBuys", null, ""], [`Sells ${tf === "5m" ? "5m" : "1h"}`, "minSells", null, ""],
];
const AUDIT_CHECKS: [string, string][] = [["paid", "Dex paid"], ["pumpCa", "CA ends in \"pump\""], ["noDanger", "No danger flags"]];
const SOCIALS: [string, string][] = [["twitter", "X / Twitter"], ["website", "Website"], ["telegram", "Telegram"], ["social", "At least one social"]];
const STEP = 50, MAX_HIDDEN = 500;

// A coin that is already a rug, the same idea as the Pulse's isRug: its pool was emptied or it can't be sold,
// it fell 90%+ from a real peak, the dev holds half of it (the fake "$40M, 30 holders" launches), or a
// handful of wallets hold nearly all of it. These never show on Discover; searching a ticker or contract
// (or the hidden view) still finds one.
export const isRug = (r: Row) => {
  const S = r.safety || {}, F = r.fresh || {};
  return Boolean(r.quarantine) || Boolean(F.dead) || Boolean(F.illiquid) || F.exitable === false
    || ((r.peak_mcap ?? 0) >= 20_000 && (r.mcap ?? 0) < (r.peak_mcap ?? 0) * 0.1)
    || (S.devPct ?? 0) >= 50
    || ((S.top10 ?? 0) >= 80 && (S.totalHolders ?? 0) >= 15);
};

export function Coins() {
  const [tab, setTab] = useState<Tab>(() => store.get<Tab>("discover:tab", "trending"));
  // Fomo's lists ahead of time: opening Top or Most held shows them at once (the radar keeps them read).
  useEffect(() => { prefetch("fomo/list?kind=trending"); prefetch("fomo/list?kind=held"); }, []);
  const [tf, setTf] = useState<Tf>(() => store.get<Tf>("discover:tf", "1h"));
  const [f, setF] = useState<Filters>(() => store.get<Filters>("discover:filters", {}));
  const [hidden, setHidden] = useState<string[]>(() => store.get<string[]>("discover:hidden", []));
  const [showHidden, setShowHidden] = useState(false);
  const [sol, setSol] = useState<number>(() => store.get<number>("discover:sol", 0.1));
  const [open, setOpen] = useState(false), [q, setQ] = useState(""), [limit, setLimit] = useState(STEP);
  const paper = useTrade((s) => s.paper);

  const params: Record<string, string> = { sort: SORT[tab][tf], dir: "desc", limit: String(limit) };
  for (const [k, v] of Object.entries(f)) if (isSet(v)) params[WINDOWED[k]?.[tf] ?? k] = v;
  if (tab === "bonded") params.graduated = "1";
  // Surge without a volume floor is a list of one-trade dust coins.
  if (tab === "surge" && !f.minVol) params[WINDOWED.minVol[tf]] = tf === "5m" ? "500" : tf === "1h" ? "5000" : "20000";
  if (tab === "trending" && !f.minLiq) params.minLiq = "5000";
  if (q.trim()) params.q = q.trim();
  if (hidden.length && !showHidden) params.hide = hidden.join(",");
  // The hidden view ignores tabs and filters: every hidden coin that is still live, biggest first.
  const query = showHidden ? { sort: "mcap", dir: "desc", limit: "400" } : params;
  const { data: d, error } = usePoll<{ rows: Row[]; total: number }>(`tokens?${new URLSearchParams({ ...query, spark: tf })}`, 5000);
  // The rows on screen re-read their line, market cap and change every 1.5 s from the live trade feed.
  const mints = (d?.rows || []).slice(0, 200).map((r) => r.mint).join(",");
  const { data: live } = usePoll<{ w: Tf; rows: Record<string, { spark: [number, number][]; mc: number | null; chg: number | null; live: LiveFigures | null }> }>(mints ? `sparks?${new URLSearchParams({ w: tf, m: mints })}` : null, 1500);

  const nFilters = Object.values(f).filter(isSet).length;
  const save = <T,>(key: string, setter: (v: T) => void) => (v: T) => { setter(v); store.set(`discover:${key}`, v); setLimit(STEP); };
  const saveHidden = save("hidden", setHidden);
  const hiddenSet = new Set(hidden);
  const toggleHide = (mint: string) => {
    if (hiddenSet.has(mint)) return saveHidden(hidden.filter((m) => m !== mint));
    saveHidden([mint, ...hidden].slice(0, MAX_HIDDEN));
    toast("Coin hidden. The eye button up top shows hidden coins.");
  };
  // Hide every coin on screen right now (Axiom's "hide all"), keeping the ones already hidden.
  const hideAll = () => {
    const shown = (d?.rows || []).map((r) => r.mint).filter((m) => !hiddenSet.has(m));
    if (!shown.length) return;
    saveHidden([...shown, ...hidden].slice(0, MAX_HIDDEN));
    toast(`${shown.length} coins hidden. The eye button up top brings them back.`);
  };
  const merged = d && live?.w === tf ? d.rows.map((r) => { const l = live.rows[r.mint]; return l ? withLive({ ...r, spark: l.spark, spark_chg: l.chg, mc_live: l.mc }, l.live, tf) : r; }) : d?.rows;
  const rugs = !showHidden && !q.trim() && merged ? merged.filter(isRug).length : 0;
  const rows = merged ? (showHidden ? merged.filter((r) => hiddenSet.has(r.mint)) : q.trim() ? merged : merged.filter((r) => !isRug(r))) : null;
  const fomo = tab === "top" || tab === "held";
  const sub = fomo ? TABS.find(([t]) => t === tab)![2] : showHidden ? `Hidden coins · ${hidden.length.toLocaleString()} hidden` : TABS.find(([t]) => t === tab)![2] + (d ? ` · ${d.total.toLocaleString()} coins match` : "") + (rugs ? ` · ${rugs} rugs hidden` : "");

  return (
    <Page title="Discover" sub={sub}>
      {/* tab strip and controls, as on Axiom */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <nav className="flex items-center gap-1" aria-label="Lists">
          {TABS.map(([t, label]) => (
            <button key={t} onClick={() => save("tab", setTab)(t)}
              className={cn("h-8 rounded-control px-3 text-lg font-semibold transition-colors", t === tab ? "bg-paper-4 text-ink shadow-[inset_0_1px_0_var(--color-edge)]" : "text-muted hover:text-ink-2")}>{label}</button>
          ))}
        </nav>
        {!fomo && <Segmented label="Window" value={tf} onChange={save("tf", setTf)} options={[["5m", "5m"], ["1h", "1h"], ["24h", "24h"]]} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex h-8 w-60 items-center gap-2 rounded-full border border-rule-2 bg-paper px-3 text-muted focus-within:border-accent-dim">
            <Icon.search className="size-4" /><input value={q} onChange={(e) => { setQ(e.target.value); setLimit(STEP); }} placeholder="Ticker, name or contract" aria-label="Search coins" className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
          </label>
          {!fomo && (<>
          <Tip tip={showHidden ? "Back to the list" : hidden.length ? `Show the ${hidden.length} hidden coin${hidden.length === 1 ? "" : "s"}` : "No hidden coins yet: hover a row and press its eye"}>
            <button onClick={() => setShowHidden(!showHidden)} aria-pressed={showHidden} aria-label="Hidden coins"
              className={cn("relative grid size-8 place-items-center rounded-control border transition-colors", showHidden ? "border-ink/50 bg-paper-4 text-ink" : "border-rule-2 text-ink-2 hover:text-ink")}>
              <Icon.eyeOff className="size-4.5" />
              {hidden.length > 0 && <span className="num absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-paper-5 px-1 text-2xs font-bold text-ink">{hidden.length > 99 ? "99+" : hidden.length}</span>}
            </button>
          </Tip>
          <Tip tip={nFilters ? `${nFilters} filter${nFilters === 1 ? "" : "s"} on` : "Filters"}>
            <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Filters"
              className={cn("relative grid size-8 place-items-center rounded-control border transition-colors", open ? "border-ink/50 bg-paper-4 text-ink" : "border-rule-2 text-ink-2 hover:text-ink")}>
              <Icon.sliders className="size-4.5" />
              {nFilters > 0 && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-paper bg-info" />}
            </button>
          </Tip>
          </>)}
          <label className="flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper pr-1 pl-3 text-muted" title={paper ? "Quick buy spends paper SOL" : "Quick buy spends REAL SOL"}>
            <Icon.bolt className="size-3.5" /><span className="text-sm">Quick buy</span>
            <input type="number" min={0.001} step={0.05} value={sol} onChange={(e) => { const v = Math.max(0.001, +e.target.value || 0.1); setSol(v); store.set("discover:sol", v); }}
              className="num w-14 bg-transparent text-right text-md font-semibold text-ink outline-none" aria-label="Quick buy amount in SOL" />
            <SolanaLogo className="w-3.5" />
            <span className={cn("rounded-full px-2 py-0.5 text-2xs font-bold uppercase", paper ? "bg-ink/10 text-ink-2" : "bg-down/15 text-down")}>{paper ? "Paper" : "Real"}</span>
          </label>
        </div>
      </div>

      {fomo ? <FomoTab kind={tab as FomoKind} q={q} sol={sol} /> : <>
      {open && <FilterPanel tf={tf} value={f} onApply={(v) => { save("filters", setF)(v); setOpen(false); }} onClose={() => setOpen(false)} />}

      {showHidden && (
        <div className="flex flex-wrap items-center gap-3 rounded-control border border-rule-2 bg-paper-2 px-4 py-2.5 text-md text-ink-2">
          <Icon.eyeOff className="size-4 text-muted" />
          <span>Showing your hidden coins (tabs and filters are off here). Press a coin's eye to bring it back.</span>
          <span className="ml-auto flex gap-2">
            {hidden.length > 0 && <button onClick={() => { if (confirm(`Unhide all ${hidden.length} hidden coins?`)) { saveHidden([]); toast("All coins unhidden"); } }} className="h-7 rounded-control border border-rule-2 px-3 text-sm hover:text-ink">Unhide all</button>}
            <button onClick={() => setShowHidden(false)} className="chrome-fill h-7 rounded-control border px-3 text-sm font-semibold">Done</button>
          </span>
        </div>
      )}

      {error && !d && <Problem text={error} />}
      <Panel>
        <div className="overflow-x-auto">
          <div className="min-w-[1180px]">
            <div className={cn(GRID, "metal-bar sticky top-0 z-10 px-4 py-2 text-sm font-medium text-muted")}>
              <span>Pair info</span><span>Price {tf}</span><span className="text-right">Market cap</span><span className="text-right">Liquidity</span>
              <span className="text-right">Volume {tf}</span><span className="text-right">Txns {tf === "24h" ? "1h" : tf}</span><span>Token info</span>
              <span className="flex items-center justify-end gap-2">
                {!showHidden && rows && rows.length > 0 && <Tip tip="Hide every coin on screen"><button onClick={hideAll} className="flex items-center gap-1 rounded-chip px-1.5 py-0.5 text-xs text-muted hover:bg-paper-4 hover:text-ink"><Icon.eyeOff className="size-3.5" />Hide all</button></Tip>}
                Action
              </span>
            </div>
            {!rows ? <div className="p-3"><Loading /></div>
              : rows.length ? rows.map((r) => <DiscoverRow key={r.mint} r={r} tf={tf} sol={sol} hidden={hiddenSet.has(r.mint)} onHide={toggleHide} />)
              : <Empty>{showHidden ? (hidden.length ? "None of your hidden coins are in the live list right now." : "No hidden coins. Hover a row and press its eye to hide it.") : `No coins match${nFilters ? " these filters" : ""}.`}</Empty>}
          </div>
        </div>
        {d && !showHidden && d.total > d.rows.length && limit < 400 && (
          <button onClick={() => setLimit(Math.min(400, limit + STEP))} className="h-11 w-full border-t border-rule text-md text-ink-2 hover:bg-paper-3/60 hover:text-ink">Load {Math.min(STEP, d.total - d.rows.length)} more</button>
        )}
      </Panel>
      </>}
    </Page>
  );
}

// Axiom's filter sheet: protocols and keywords on top, then Audits / Metrics / Socials, then import, export,
// reset and apply. Nothing changes the list until Apply.
function FilterPanel({ tf, value, onApply, onClose }: { tf: Tf; value: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<Filters>(value);
  const [section, setSection] = useState<Section>(() => store.get<Section>("discover:fsec", "audits"));
  const put = (k: string, v: string) => setDraft((d) => { const n = { ...d, [k]: v }; if (!isSet(v)) delete n[k]; return n; });
  const dex = (draft.dex || "").split(",").filter(Boolean);
  const count = (keys: string[]) => keys.filter((k) => isSet(draft[k])).length;
  const sections: [Section, string, number][] = [
    ["audits", "Audits", count([...AUDITS.flatMap(([, a, b]) => [a, b]).filter(Boolean) as string[], ...AUDIT_CHECKS.map(([k]) => k)])],
    ["metrics", "$ Metrics", count(metrics(tf).flatMap(([, a, b]) => [a, b]).filter(Boolean) as string[])],
    ["socials", "Socials", count(SOCIALS.map(([k]) => k))],
  ];
  const exportF = () => { navigator.clipboard?.writeText(JSON.stringify(draft)); toast("Filters copied"); };
  const importF = async () => {
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { /* no permission */ }
    if (!text.trim().startsWith("{")) text = window.prompt("Paste exported filters") || "";
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
      setDraft(Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string" && x !== "")) as Filters);
      toast("Filters imported, press Apply");
    } catch { if (text) toast("Those aren't exported filters"); }
  };

  return (
    <div className="surface flex flex-col gap-4 p-4" role="region" aria-label="Filters">
      <div className="flex flex-col gap-2">
        <span className="label">Protocols</span>
        <div className="flex flex-wrap gap-1.5">
          {PROTOCOLS.map(([k, label]) => {
            const on = dex.includes(k);
            return <button key={k} aria-pressed={on} onClick={() => put("dex", (on ? dex.filter((x) => x !== k) : [...dex, k]).join(","))}
              className={cn("h-7 rounded-full border px-3 text-sm font-medium transition-colors", on ? "border-ink/50 bg-paper-4 text-ink" : "border-rule-2 text-muted hover:text-ink-2")}>{label}</button>;
          })}
          {dex.length > 0 && <button onClick={() => put("dex", "")} className="h-7 px-2 text-sm text-muted hover:text-ink">Any protocol</button>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Text label="Search keywords" hint="Name or ticker has any of these, comma separated" value={draft.kw} onChange={(v) => put("kw", v)} placeholder="cat, dog, ai" />
        <Text label="Exclude keywords" hint="Hide coins whose name or ticker has any of these" value={draft.xkw} onChange={(v) => put("xkw", v)} placeholder="rug, scam" />
      </div>

      <nav className="flex gap-1 border-b border-rule" aria-label="Filter groups">
        {sections.map(([s, label, n]) => (
          <button key={s} onClick={() => { setSection(s); store.set("discover:fsec", s); }} aria-current={s === section ? "page" : undefined}
            className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 text-md font-semibold transition-colors", s === section ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink-2")}>
            {label}{n > 0 && <span className="num grid size-4.5 place-items-center rounded-full bg-info text-2xs font-bold text-on-fill">{n}</span>}
          </button>
        ))}
      </nav>

      {section === "audits" && (
        <div className="flex flex-col gap-3">
          <Checks items={AUDIT_CHECKS} draft={draft} put={put} />
          <Ranges items={AUDITS} draft={draft} put={put} />
        </div>
      )}
      {section === "metrics" && <Ranges items={metrics(tf)} draft={draft} put={put} note={tf === "24h" ? "Txns, buys and sells use the last hour; there is no 24h count." : undefined} />}
      {section === "socials" && <Checks items={SOCIALS} draft={draft} put={put} />}

      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <button onClick={importF} className="h-8 rounded-control border border-rule-2 px-3 text-md text-ink-2 hover:text-ink">Import</button>
        <button onClick={exportF} className="h-8 rounded-control border border-rule-2 px-3 text-md text-ink-2 hover:text-ink">Export</button>
        <span className="ml-auto flex gap-2">
          <button onClick={() => setDraft({})} className="h-8 rounded-control border border-rule-2 px-3 text-md text-ink-2 hover:text-ink">Reset</button>
          <button onClick={onClose} className="h-8 rounded-control px-3 text-md text-muted hover:text-ink">Cancel</button>
          <button onClick={() => onApply(draft)} className="chrome-fill h-8 rounded-control border px-4 text-md font-semibold">Apply all</button>
        </span>
      </div>
    </div>
  );
}
