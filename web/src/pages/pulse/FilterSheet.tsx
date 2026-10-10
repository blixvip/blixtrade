// Inside the Pulse filter window (ColumnFilters.tsx PulseFilters), in a file of its own: it loads when the window
// first opens, not with the Pulse.
import * as D from "@/components/ui/modal";
import { useState, type ReactNode } from "react";
import { isSet, type Filters } from "@/components/filterbits";
import { toast } from "@/components/ui/toast";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { countFilters, DEFAULTS, PADS, useColFilters, type Col } from "./ColumnFilters";

type Section = "audits" | "metrics" | "socials";
const COLS: [Col, string][] = [["new", "New Pairs"], ["stretch", "Final Stretch"], ["migrated", "Migrated"]];
// [label, key stem, unit]: every figure gets a Min and a Max box (stem + "Min"/"Max").
type Row = [string, string, string];
const AUDITS: Row[] = [
  ["Age", "age", "m"], ["Top 10 holders", "top10", "%"], ["Dev holding", "dev", "%"], ["Snipers", "snipers", "%"], ["Sniper wallets", "snipersN", ""],
  ["Bundled", "bundle", "%"], ["Bundle wallets", "bundleN", ""], ["Holders", "holders", ""], ["Dev bought", "devSol", "SOL"],
  ["Dev coins launched", "devCoins", ""], ["AI score", "ai", ""], ["AI win chance", "pwin", "%"],
];
const METRICS: Row[] = [
  ["Market cap", "mcap", "$"], ["ATH market cap", "peak", "$"], ["Liquidity", "liq", "$"], ["Volume", "vol", "$"], ["Txns", "tx", ""], ["Buys", "buys", ""], ["Sells", "sells", ""],
  ["Traders", "traders", ""], ["Bonding curve", "curve", "%"], ["Change 1m", "chg1m", "%"], ["Change 5m", "chg5", "%"], ["Change 1h", "chg1h", "%"],
];
const AUDIT_CHECKS: [string, string][] = [["devKept", "Dev hasn't sold"], ["paid", "Dex paid"], ["pumpCa", "CA ends in pump"], ["noWarn", "No warnings"], ["aiRated", "AI rated"], ["aiBuy", "AI says buy"]];
const SOCIALS: [string, string][] = [["twitter", "X / Twitter"], ["website", "Website"], ["telegram", "Telegram"], ["tiktok", "TikTok"], ["social", "At least one social"], ["noSocial", "No socials"]];
const Count = ({ n }: { n: number }) => n > 0 ? <span className="num grid h-4 min-w-4 place-items-center rounded-full bg-info px-1 text-2xs font-bold text-on-fill">{n}</span> : null;
const keysOf = (rows: Row[]) => rows.flatMap(([, s]) => [`${s}Min`, `${s}Max`]);

export function Sheet({ start }: { start: Col }) {
  const [col, setCol] = useState<Col>(start);
  const [drafts, setDrafts] = useState<Record<Col, Filters>>(() => ({ ...useColFilters.getState().f }));
  const [section, setSection] = useState<Section>("audits");
  const draft = drafts[col];
  const put = (k: string, v: string) => setDrafts((d) => { const x = { ...d[col], [k]: v }; if (!isSet(v)) delete x[k]; return { ...d, [col]: x }; });
  const pads = (draft.pads || "").split(",").filter(Boolean);
  const count = (keys: string[]) => keys.filter((k) => isSet(draft[k])).length;
  const sections: [Section, string, number][] = [
    ["audits", "Audits", count([...keysOf(AUDITS), ...AUDIT_CHECKS.map(([k]) => k)])], ["metrics", "$ Metrics", count(keysOf(METRICS))], ["socials", "Socials", count(SOCIALS.map(([k]) => k))],
  ];
  const applyAll = () => {
    for (const [c] of COLS) store.set(`pulse:colf2:${c}`, drafts[c]);
    useColFilters.setState({ f: drafts, open: null });
  };
  const importF = async () => {
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { /* no permission */ }
    if (!text.trim().startsWith("{")) text = window.prompt("Paste exported filters") || "";
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
      // An export holds every column (Running Now since 2026-10-09; an older export leaves it as it is); an older
      // one-column export goes on the open column.
      const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, x]) => typeof x === "string" && x !== "")) as Filters;
      if (v.new || v.stretch || v.migrated) setDrafts((d) => ({ new: clean(v.new || {}), running: v.running ? clean(v.running) : d.running, stretch: clean(v.stretch || {}), migrated: clean(v.migrated || {}) }));
      else setDrafts((d) => ({ ...d, [col]: clean(v) }));
      toast("Filters imported, press Apply all");
    } catch { if (text) toast("Those aren't exported filters"); }
  };

  return (
    <>
      <header className="flex shrink-0 flex-col gap-3 border-b border-rule px-5 pt-4">
        <div className="flex items-center justify-between">
          <D.Title className="text-xl font-semibold text-ink">Filters</D.Title>
          <D.Close aria-label="Close" className="grid size-7 place-items-center rounded-control text-muted hover:bg-paper-4 hover:text-ink"><Icon.close className="size-4" /></D.Close>
        </div>
        <nav className="flex gap-5" aria-label="Columns">
          {COLS.map(([c, label]) => (
            <button key={c} onClick={() => setCol(c)} aria-current={c === col ? "page" : undefined}
              className={cn("-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-md font-semibold transition-colors", c === col ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink-2")}>
              {label}<Count n={countFilters(drafts[c])} />
            </button>
          ))}
        </nav>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-2">Launchpads</span>
            <button onClick={() => put("pads", pads.length ? "" : PADS.map(([k]) => k).join(","))} className="text-sm text-muted hover:text-ink">{pads.length ? "Unselect all" : "Select all"}</button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {PADS.map(([k, label, logo]) => {
              const on = pads.includes(k);
              return (
                <button key={k} aria-pressed={on} onClick={() => put("pads", (on ? pads.filter((x) => x !== k) : [...pads, k]).join(","))}
                  className={cn("flex h-8 items-center gap-2 rounded-control border px-2.5 text-sm font-medium transition-colors duration-100",
                    on ? "border-ink/45 bg-paper-4 text-ink shadow-[inset_0_1px_0_var(--color-edge)]" : "border-rule-2 bg-paper text-muted hover:border-muted hover:text-ink-2")}>
                  <span className="grid size-4 place-items-center">{logo}</span>{label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2">
          <Field label="Search keywords"><Input value={draft.kw} onChange={(v) => put("kw", v)} placeholder="keyword1, keyword2" /></Field>
          <Field label="Exclude keywords"><Input value={draft.xkw} onChange={(v) => put("xkw", v)} placeholder="keyword1, keyword2" /></Field>
        </section>

        <div className="flex gap-1 rounded-full border border-rule-2 bg-paper p-0.5" role="tablist" aria-label="Filter groups">
          {sections.map(([s, label, n]) => (
            <button key={s} role="tab" aria-selected={s === section} onClick={() => setSection(s)}
              className={cn("flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-colors duration-100", s === section ? "bg-paper-5 text-ink shadow-[inset_0_1px_0_var(--color-edge)]" : "text-muted hover:text-ink-2")}>
              {label}<Count n={n} />
            </button>
          ))}
        </div>

        {section === "audits" && <><Checks items={AUDIT_CHECKS} draft={draft} put={put} /><MinMax rows={AUDITS} draft={draft} put={put} /></>}
        {section === "metrics" && <MinMax rows={METRICS} draft={draft} put={put} />}
        {section === "socials" && <Checks items={SOCIALS} draft={draft} put={put} />}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-rule px-5 py-3">
        <button onClick={importF} className="flex h-8 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium text-ink-2 hover:bg-paper-4 hover:text-ink"><Icon.send className="size-3.5 rotate-180" />Import</button>
        <button onClick={() => { navigator.clipboard?.writeText(JSON.stringify(drafts)); toast("All three columns' filters copied"); }}
          className="flex h-8 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium text-ink-2 hover:bg-paper-4 hover:text-ink"><Icon.send className="size-3.5" />Export</button>
        <span className="ml-auto flex items-center gap-2">
          <button onClick={() => setDrafts((d) => ({ ...d, [col]: { ...DEFAULTS[col] } }))} title={countFilters(DEFAULTS[col]) ? "Back to the starting filters" : "Clear this column's filters"} className="h-8 rounded-control px-3 text-sm font-medium text-muted hover:text-ink">Reset</button>
          <button onClick={applyAll} className="chrome-fill h-8 rounded-full border px-5 text-sm font-semibold">Apply all</button>
        </span>
      </footer>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-w-0 flex-col gap-1.5"><span className="text-sm font-medium text-ink-2">{label}</span><span className="flex">{children}</span></label>;
}

function Input({ value, onChange, placeholder, unit, numeric, label }: { value?: string; onChange: (v: string) => void; placeholder: string; unit?: string; numeric?: boolean; label?: string }) {
  return (
    <span className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-control border border-rule-2 bg-paper px-2.5 transition-colors focus-within:border-accent-dim">
      {unit === "$" && <span className="text-sm text-muted">$</span>}
      <input value={value ?? ""} inputMode={numeric ? "decimal" : undefined} placeholder={placeholder} aria-label={label}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/[^\d.-]/g, "").replace(/(?!^)-/g, "") : e.target.value)}
        className={cn("min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted", numeric && "num")} />
      {unit && unit !== "$" && <span className="text-xs text-muted">{unit}</span>}
    </span>
  );
}

function MinMax({ rows, draft, put }: { rows: Row[]; draft: Filters; put: (k: string, v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map(([label, stem, unit]) => {
        const on = isSet(draft[`${stem}Min`]) || isSet(draft[`${stem}Max`]);
        return (
          <div key={stem} className="grid grid-cols-[8.5rem_1fr_1fr] items-center gap-2">
            <span className={cn("text-sm", on ? "font-medium text-ink" : "text-ink-2")}>{label}</span>
            <Input numeric unit={unit} value={draft[`${stem}Min`]} onChange={(v) => put(`${stem}Min`, v)} placeholder="Min" label={`${label} minimum`} />
            <Input numeric unit={unit} value={draft[`${stem}Max`]} onChange={(v) => put(`${stem}Max`, v)} placeholder="Max" label={`${label} maximum`} />
          </div>
        );
      })}
    </div>
  );
}

function Checks({ items, draft, put }: { items: [string, string][]; draft: Filters; put: (k: string, v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {items.map(([k, label]) => {
        const on = draft[k] === "1";
        return (
          <button key={k} role="checkbox" aria-checked={on} onClick={() => put(k, on ? "" : "1")} className={cn("flex items-center gap-2 text-sm", on ? "text-ink" : "text-ink-2 hover:text-ink")}>
            <span className={cn("grid size-4 place-items-center rounded-[4px] border transition-colors", on ? "border-ink bg-ink text-paper" : "border-rule-2 bg-paper")}>
              {on && <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
