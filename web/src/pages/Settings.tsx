// Settings (#/settings): every radar setting in plain words, grouped, each with what it does, its unit and a
// control that fits it (switch, number with unit, menu, time, alert chips, model with suggestions). A side
// list jumps between groups, a search box narrows them, and a bar at the bottom saves or discards the changes.
// Names, hints and grouping live in settings/spec.ts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Loading, Page, Problem } from "@/components/page";
import { api, post } from "@/lib/api";
import { cn } from "@/lib/utils";
import { loadPaperWallet, resetPaperWallet, setPaper, useTrade } from "@/lib/mode";
import { Icon } from "@/shell/icons";
import { GROUPS, HIDDEN, KEYS, MODEL_SUGGEST, NOTIFY, SPEC, type Spec } from "./settings/spec";

type J = any;
type Res = { settings: Record<string, J>; secrets: Record<string, { set: boolean; hint: string }>; defaults: Record<string, J> };
const same = (a: J, b: J) => JSON.stringify(a) === JSON.stringify(b);
// A setting's key as a plain label, for settings spec.ts doesn't know yet: "nurseryMinVol5m" → "Nursery min vol 5m".
const autoLabel = (k: string) => k.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase().replace(/^[a-z]/, (c) => c.toUpperCase());
const specOf = (k: string): Spec => SPEC[k] || { label: autoLabel(k) };
const box = "h-8 rounded-control border border-rule-2 bg-paper text-md text-ink outline-none transition-colors focus-within:border-accent-dim focus:border-accent-dim";
const fmtDef = (v: J) => Array.isArray(v) ? `${v.length} selected` : typeof v === "boolean" ? (v ? "on" : "off") : v === "" ? "blank" : String(v);

function Switch({ on, onChange, label, tone = "accent" }: { on: boolean; onChange: (v: boolean) => void; label: string; tone?: "accent" | "warn" }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn("relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-100", on ? (tone === "warn" ? "border-warn bg-warn" : "border-accent bg-accent") : "border-rule-2 bg-paper-4")}>
      <i className={cn("absolute top-0.5 size-4.5 rounded-full transition-[left] duration-100", on ? "left-[18px] bg-accent-ink" : "left-0.5 bg-ink-2")} />
    </button>
  );
}

function NumberBox({ v, unit, onChange, label }: { v: number; unit?: string; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(String(v));
  useEffect(() => { if (+text !== v) setText(String(v)); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  const pre = unit === "$" ? "$" : "", post = unit && unit !== "$" ? (unit === "x" ? "×" : unit) : "";
  return (
    <span className={cn(box, "flex w-36 items-center gap-1 px-2.5")}>
      {pre && <span className="text-sm text-muted">{pre}</span>}
      <input inputMode="decimal" value={text} aria-label={label} onChange={(e) => { const t = e.target.value.replace(/[^\d.-]/g, ""); setText(t); if (t !== "" && Number.isFinite(+t)) onChange(+t); }}
        onBlur={() => { if (text === "" || !Number.isFinite(+text)) { setText("0"); onChange(0); } }}
        className="num min-w-0 flex-1 bg-transparent text-right outline-none" />
      {post && <span className="shrink-0 text-sm text-muted">{post}</span>}
    </span>
  );
}

function Control({ k, v, s, on }: { k: string; v: J; s: Spec; on: (v: J) => void }) {
  if (typeof v === "boolean") return <Switch on={v} onChange={on} label={s.label} />;
  if (typeof v === "number") return <NumberBox v={v} unit={s.unit} onChange={on} label={s.label} />;
  if (s.kind === "select") return (
    <select value={v} onChange={(e) => on(e.target.value)} aria-label={s.label} className={cn(box, "w-64 cursor-pointer px-2 [color-scheme:dark]")}>
      {!s.options!.some(([o]) => o === v) && <option value={v}>{v}</option>}
      {s.options!.map(([o, l]) => <option key={o} value={o}>{l}</option>)}
    </select>
  );
  if (s.kind === "time") return (
    <span className="flex items-center gap-1.5">
      <input type="time" value={v} onChange={(e) => on(e.target.value)} aria-label={s.label} className={cn(box, "w-32 px-2 [color-scheme:dark]")} />
      {v && <button onClick={() => on("")} aria-label={`Clear ${s.label}`} className="grid size-7 place-items-center rounded-control text-muted hover:bg-paper-4 hover:text-ink"><Icon.x className="size-3.5" /></button>}
    </span>
  );
  if (s.kind === "model") return (
    <>
      <input value={v} list={`models-${k}`} onChange={(e) => on(e.target.value)} aria-label={s.label} spellCheck={false} className={cn(box, "w-64 px-2.5 font-mono text-sm")} />
      <datalist id={`models-${k}`}>{(MODEL_SUGGEST[k] || []).map((m) => <option key={m} value={m} />)}</datalist>
    </>
  );
  if (s.kind === "sizes" && Array.isArray(v)) return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {v.map((x: string, i: number) => (
        <span key={i} className={cn(box, "flex w-20 items-center gap-0.5 pr-1 pl-2")}>
          <input value={x} inputMode="decimal" aria-label={`Quick-buy size ${i + 1}`} onChange={(e) => on(v.map((y: string, j: number) => (j === i ? e.target.value.replace(/[^\d.]/g, "") : y)))} className="num min-w-0 flex-1 bg-transparent text-right outline-none" />
          {v.length > 1 && <button onClick={() => on(v.filter((_: string, j: number) => j !== i))} aria-label={`Remove size ${x}`} className="grid size-5 place-items-center rounded text-muted hover:text-ink"><Icon.x className="size-3" /></button>}
        </span>
      ))}
      {v.length < 6 && <button onClick={() => on([...v, ""])} className="h-8 rounded-control border border-dashed border-rule-2 px-2.5 text-sm text-muted hover:border-muted hover:text-ink">+ Add</button>}
    </span>
  );
  if (Array.isArray(v)) return <input value={v.join(", ")} onChange={(e) => on(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} aria-label={s.label} className={cn(box, "w-72 px-2.5")} />;
  return <input value={v ?? ""} onChange={(e) => on(e.target.value)} aria-label={s.label} className={cn(box, "w-64 px-2.5")} />;
}

// Alert kinds as tick chips, full width under their label.
function Chips({ v, on }: { v: string[]; on: (v: string[]) => void }) {
  const set = new Set(v), known = new Set(NOTIFY.map(([k]) => k)), extra = v.filter((k) => !known.has(k));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {[...NOTIFY, ...extra.map((k) => [k, k] as [string, string])].map(([k, label]) => {
          const yes = set.has(k);
          return (
            <button key={k} aria-pressed={yes} onClick={() => on(yes ? v.filter((x) => x !== k) : [...v, k])}
              className={cn("flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-sm transition-colors duration-100", yes ? "border-ink/40 bg-paper-4 text-ink" : "border-rule-2 text-muted hover:text-ink-2")}>
              <span className={cn("grid size-3.5 place-items-center rounded-full border", yes ? "border-ink bg-ink text-paper" : "border-rule-2")}>
                {yes && <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M2.5 6.2l2.3 2.3 4.7-5" /></svg>}
              </span>{label}
            </button>
          );
        })}
      </div>
      <span className="flex gap-3 text-sm">
        <button onClick={() => on(NOTIFY.map(([k]) => k))} className="text-muted hover:text-ink">Select all</button>
        <button onClick={() => on([])} className="text-muted hover:text-ink">None</button>
      </span>
    </div>
  );
}

function Row({ label, hint, changed, onReset, wide, children }: { label: string; hint?: ReactNode; changed?: string | false; onReset?: () => void; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex gap-x-6 gap-y-2 border-t border-rule px-4 py-3 first:border-t-0 max-md:flex-col", wide ? "flex-col" : "items-center justify-between")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 text-md font-medium text-ink">
          {label}
          {changed && <button onClick={onReset} title="Put the default back" className="flex items-center gap-1 rounded-full bg-paper-4 px-2 py-0.5 text-xs font-normal text-ink-2 hover:text-ink"><Icon.refresh className="size-3" />default {changed}</button>}
        </div>
        {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      </div>
      <div className={cn("shrink-0", !wide && "flex justify-end max-md:justify-start")}>{children}</div>
    </div>
  );
}

function Card({ id, title, blurb, aside, children }: { id: string; title: string; blurb?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={`set-${id}`} className="scroll-mt-4 overflow-hidden rounded-card border border-rule bg-paper-2">
      <header className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
        <div><h2 className="text-lg font-semibold text-ink">{title}</h2>{blurb && <p className="mt-0.5 text-sm text-muted">{blurb}</p>}</div>
        {aside}
      </header>
      {children}
    </section>
  );
}

const Sub = ({ title }: { title: string }) => <h3 className="border-t border-rule bg-paper-3/50 px-4 pt-2.5 pb-1.5 text-xs font-semibold tracking-wider text-muted uppercase first:border-t-0">{title}</h3>;

// Paper trading: the switch, what is in the fake wallet, and starting it over.
function PaperCard() {
  const paper = useTrade((s) => s.paper), w = useTrade((s) => s.wallet);
  const [start, setStart] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { loadPaperWallet(); }, []);
  const sol = (n: number) => `${n.toFixed(3)} SOL`, usd = (n: number) => w ? `$${Math.round(n * w.solUsd).toLocaleString()}` : "";
  const reset = async () => {
    if (!confirm("Sell every open paper position and refill the wallet?")) return;
    setBusy(true);
    try { const r = await resetPaperWallet(start ? +start : undefined); setStart(""); toast(`Paper wallet reset to ${r.start} SOL`); } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const stat = (label: string, value: ReactNode, sub?: string, tone?: string) => (
    <div className="flex flex-col gap-0.5 px-4 py-3"><span className="text-sm text-muted">{label}</span><b className={cn("num text-xl font-semibold", tone)}>{value}</b>{sub && <span className="text-xs text-muted">{sub}</span>}</div>
  );
  return (
    <Card id="paper" title="Paper trading" blurb={paper ? "On: buys and sells use fake SOL at real prices; nothing is really bought" : "Off: buy buttons spend real SOL"}
      aside={<span className="flex items-center gap-2 text-sm font-medium">{paper ? <span className="text-warn">On</span> : <span className="text-down">Off</span>}<Switch on={paper} onChange={setPaper} label="Paper trading" tone="warn" /></span>}>
      <div className="grid grid-cols-3 divide-x divide-rule border-b border-rule max-md:grid-cols-1 max-md:divide-x-0 max-md:divide-y">
        {stat("Fake SOL to spend", w ? sol(w.cash) : "—", w ? usd(w.cash) : undefined)}
        {stat("Wallet value", w ? sol(w.equity) : "—", `cash + ${w?.open ?? 0} open position${w?.open === 1 ? "" : "s"}`)}
        {stat("Result", w ? `${w.pnl >= 0 ? "+" : ""}${sol(w.pnl)}` : "—", w ? `${(w.pnl / w.start * 100).toFixed(1)}% from ${w.start} SOL · ${w.trades} trades` : undefined, w && w.pnl > 0 ? "text-up" : w && w.pnl < 0 ? "text-down" : "")}
      </div>
      <Row label="Start over" hint="Sells what is open and refills the wallet; old trades stay in the history">
        <span className="flex items-center gap-2">
          <span className={cn(box, "flex w-28 items-center gap-1 px-2.5")}>
            <input inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value.replace(/[^\d.]/g, ""))} placeholder={String(w?.start ?? 10)} aria-label="Starting fake SOL" className="num min-w-0 flex-1 bg-transparent text-right outline-none placeholder:text-muted" />
            <span className="text-sm text-muted">SOL</span>
          </span>
          <Button size="lg" disabled={busy} onClick={reset}>{busy ? "Resetting…" : "Reset wallet"}</Button>
        </span>
      </Row>
    </Card>
  );
}

export function Settings() {
  const [res, setRes] = useState<Res | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, J>>({}), [keys, setKeys] = useState<Record<string, string>>({}), [clear, setClear] = useState<string[]>([]);
  const [q, setQ] = useState(""), [active, setActive] = useState("paper");
  const load = () => api<Res>("settings").then((r) => { setRes(r); setDraft({}); setKeys({}); setClear([]); }).catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, []);

  const other = useMemo(() => {
    if (!res) return [];
    const listed = new Set([...GROUPS.flatMap((g) => g.parts.flatMap((p) => p.keys)), ...KEYS]);
    return Object.keys(res.settings).filter((k) => !listed.has(k) && !HIDDEN.has(k) && !(k in (res.secrets || {})) && (typeof res.settings[k] !== "object" || Array.isArray(res.settings[k])));
  }, [res]);
  const groups = useMemo(() => [...GROUPS, ...(other.length ? [{ id: "other", title: "Other", parts: [{ keys: other }] }] : [])], [other]);
  const nav: [string, string][] = [["paper", "Paper trading"], ...groups.map((g) => [g.id, g.title] as [string, string]), ["keys", "Keys and webhooks"]];

  // Highlight the group in view in the side list.
  const io = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    if (!res) return;
    io.current?.disconnect();
    io.current = new IntersectionObserver((es) => { const e = es.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (e) setActive(e.target.id.slice(4)); }, { rootMargin: "0px 0px -70% 0px" });
    document.querySelectorAll("[id^='set-']").forEach((el) => io.current!.observe(el));
    return () => io.current?.disconnect();
  }, [res, q]);

  if (!res) return <Page title="Settings">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const val = (k: string) => (k in draft ? draft[k] : res.settings[k]);
  const dirty = Object.keys(draft).filter((k) => !same(draft[k], res.settings[k]));
  const keyEdits = Object.keys(keys).filter((k) => keys[k].trim());
  const nChanges = dirty.length + keyEdits.length + clear.length;
  const needle = q.trim().toLowerCase();
  const match = (k: string) => !needle || `${specOf(k).label} ${specOf(k).hint || ""} ${k}`.toLowerCase().includes(needle);
  const put = (k: string) => (v: J) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    const sizes = val("quickSizes");
    if (Array.isArray(sizes) && sizes.some((x: string) => !(+x > 0))) return toast("Each quick-buy size needs a number above 0");
    setBusy(true);
    try {
      const r = await post<Res>("settings", { settings: { ...Object.fromEntries(dirty.map((k) => [k, draft[k]])), ...Object.fromEntries(keyEdits.map((k) => [k, keys[k].trim()])) }, clear });
      setRes(r); setDraft({}); setKeys({}); setClear([]); toast("Settings saved");
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const discard = () => { setDraft({}); setKeys({}); setClear([]); };

  const row = (k: string) => {
    const s = specOf(k), v = val(k), def = res.defaults?.[k];
    const changed = def !== undefined && !same(v, def) && fmtDef(def);
    if (s.kind === "chips") return <Row key={k} label={s.label} hint={s.hint} wide changed={changed} onReset={() => put(k)(def)}><Chips v={v} on={put(k)} /></Row>;
    return <Row key={k} label={s.label} hint={s.hint} changed={changed} onReset={() => put(k)(def)}><Control k={k} v={v} s={s} on={put(k)} /></Row>;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-3 p-3 max-md:pb-6">
      <header><h1 className="text-2xl leading-none font-bold tracking-tight">Settings</h1><p className="mt-1.5 text-md text-muted">How Blix finds, rates, alerts on and trades coins. Changes apply as soon as they are saved.</p></header>
      <div className="grid grid-cols-[13rem_minmax(0,64rem)] items-start gap-6 max-lg:grid-cols-1">
        <aside className="sticky top-3 flex flex-col gap-3 max-lg:static">
          <label className={cn(box, "flex items-center gap-2 rounded-full px-3 text-muted")}>
            <Icon.search className="size-4 shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a setting" aria-label="Find a setting" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
          </label>
          <nav aria-label="Settings groups" className="flex flex-col gap-0.5 max-lg:flex-row max-lg:flex-wrap">
            {nav.map(([id, title]) => (
              <a key={id} href={`#/settings`} onClick={(e) => { e.preventDefault(); document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                aria-current={active === id ? "true" : undefined}
                className={cn("rounded-control px-3 py-1.5 text-md transition-colors duration-100", active === id ? "bg-paper-4 font-medium text-ink" : "text-muted hover:text-ink-2")}>{title}</a>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-4 pb-20">
          {!needle && <PaperCard />}
          {groups.map((g) => {
            const parts = g.parts.map((p) => ({ ...p, keys: p.keys.filter((k) => k in res.settings && match(k)) })).filter((p) => p.keys.length);
            if (!parts.length) return null;
            return (
              <Card key={g.id} id={g.id} title={g.title} blurb={g.blurb}>
                {parts.map((p, i) => <div key={i}>{p.title && <Sub title={p.title} />}{p.keys.map(row)}</div>)}
              </Card>
            );
          })}
          {KEYS.some((k) => k in (res.secrets || {}) && match(k)) && (
            <Card id="keys" title="Keys and webhooks" blurb="Stored only on this PC. The page never sees a saved key, just its last 4 characters">
              {KEYS.filter((k) => k in res.secrets && match(k)).map((k) => {
                const s = specOf(k), st = res.secrets[k], cleared = clear.includes(k);
                return (
                  <Row key={k} label={s.label} hint={s.hint}>
                    <span className="flex items-center gap-2">
                      <input type="password" autoComplete="off" value={keys[k] ?? ""} onChange={(e) => { setKeys((x) => ({ ...x, [k]: e.target.value })); setClear((c) => c.filter((x) => x !== k)); }}
                        placeholder={cleared ? "Will be removed" : st.set ? `Saved ${st.hint}` : "Not set"} aria-label={s.label} className={cn(box, "w-64 px-2.5 font-mono text-sm placeholder:font-sans placeholder:text-muted")} />
                      {st.set && !cleared && <button onClick={() => { setClear((c) => [...c, k]); setKeys((x) => ({ ...x, [k]: "" })); }} className="h-8 rounded-control px-2 text-sm text-muted hover:text-down">Remove</button>}
                      {cleared && <button onClick={() => setClear((c) => c.filter((x) => x !== k))} className="h-8 rounded-control px-2 text-sm text-muted hover:text-ink">Keep</button>}
                    </span>
                  </Row>
                );
              })}
            </Card>
          )}
          {needle && !groups.some((g) => g.parts.some((p) => p.keys.some((k) => k in res.settings && match(k)))) && !KEYS.some(match) && <p className="py-10 text-center text-md text-muted">No setting matches "{q}".</p>}
        </div>
      </div>

      {nChanges > 0 && (
        <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-rule-2 bg-paper-3/95 py-1.5 pr-1.5 pl-4 shadow-sheet backdrop-blur">
            <span className="text-md text-ink-2"><b className="num font-semibold text-ink">{nChanges}</b> unsaved change{nChanges === 1 ? "" : "s"}</span>
            <Button size="lg" disabled={busy} onClick={discard}>Discard</Button>
            <Button size="lg" variant="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
