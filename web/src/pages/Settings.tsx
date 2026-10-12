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
import { depositPaper, loadPaperWallet, resetPaperWallet, setPaper, useTrade } from "@/lib/mode";
import { Icon } from "@/shell/icons";
import { Segmented } from "@/components/ui/segmented";
import { setPrefs, usePrefs, type PulseCol } from "@/lib/prefs";
import { unhideAll, useHidden } from "@/lib/hidden";
import { store } from "@/lib/utils";
import { GROUPS, HIDDEN, KEYS, MODEL_SUGGEST, NOTIFY, SPEC, type Spec } from "./settings/spec";

type J = any;
type Res = { settings: Record<string, J>; secrets: Record<string, { set: boolean; hint: string }>; defaults: Record<string, J> };
const same = (a: J, b: J) => JSON.stringify(a) === JSON.stringify(b);
// A setting's key as a plain label, for settings spec.ts doesn't know yet: "nurseryMinVol5m" → "Nursery min vol 5m".
const autoLabel = (k: string) => k.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase().replace(/^[a-z]/, (c) => c.toUpperCase());
const specOf = (k: string): Spec => SPEC[k] || { label: autoLabel(k) };
const box = "h-9 rounded-lg border border-white/[0.08] bg-[oklch(14%_0_0)] text-md text-ink outline-none transition-[border-color,box-shadow] duration-150 hover:border-white/[0.14] focus-within:border-accent-dim focus-within:shadow-[0_0_0_3px_oklch(100%_0_0/0.06)] focus:border-accent-dim";
const fmtDef = (v: J) => Array.isArray(v) ? `${v.length} selected` : typeof v === "boolean" ? (v ? "on" : "off") : v === "" ? "blank" : String(v);

function Switch({ on, onChange, label, tone = "accent" }: { on: boolean; onChange: (v: boolean) => void; label: string; tone?: "accent" | "warn" }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ink/30", on ? (tone === "warn" ? "bg-warn" : "bg-up") : "bg-white/[0.12] hover:bg-white/[0.18]")}>
      <i className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.4)] transition-[left] duration-200 ease-out", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

function NumberBox({ v, unit, onChange, label }: { v: number; unit?: string; onChange: (v: number) => void; label: string }) {
  const [text, setText] = useState(String(v)), [focus, setFocus] = useState(false);
  useEffect(() => { if (+text !== v) setText(String(v)); }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  // Big numbers read with separators (250,000) except while being typed.
  const shown = !focus && text !== "" && Number.isFinite(+text) && Math.abs(+text) >= 10000 ? (+text).toLocaleString("en-US", { maximumFractionDigits: 6 }) : text;
  const pre = unit === "$" ? "$" : "", post = unit && unit !== "$" ? (unit === "x" ? "×" : unit) : "";
  return (
    <span className={cn(box, "flex w-40 items-center gap-1 px-3")}>
      {pre && <span className="text-sm text-muted">{pre}</span>}
      <input inputMode="decimal" value={shown} aria-label={label} onFocus={() => setFocus(true)} onChange={(e) => { const t = e.target.value.replace(/[^\d.-]/g, ""); setText(t); if (t !== "" && Number.isFinite(+t)) onChange(+t); }}
        onBlur={() => { setFocus(false); if (text === "" || !Number.isFinite(+text)) { setText("0"); onChange(0); } }}
        className="num min-w-0 flex-1 bg-transparent text-right font-tight font-medium outline-none" />
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
      {v && <button onClick={() => on("")} aria-label={`Clear ${s.label}`} className="grid size-7 place-items-center rounded-control text-muted hover:bg-paper-4 hover:text-ink"><Icon.close className="size-3.5" /></button>}
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
          {v.length > 1 && <button onClick={() => on(v.filter((_: string, j: number) => j !== i))} aria-label={`Remove size ${x}`} className="grid size-5 place-items-center rounded text-muted hover:text-ink"><Icon.close className="size-3" /></button>}
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

// `inline`: a switch stays beside its label on a phone instead of dropping under it.
function Row({ label, hint, changed, onReset, wide, inline, children }: { label: string; hint?: ReactNode; changed?: string | false; onReset?: () => void; wide?: boolean; inline?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex gap-x-8 gap-y-2.5 border-t border-white/[0.05] px-5 py-3.5 transition-colors duration-150 first:border-t-0 hover:bg-white/[0.015]", !inline && "max-md:flex-col", wide ? "flex-col" : cn("items-center justify-between", !inline && "max-md:items-start"))}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-md font-medium text-ink">
          {changed && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />}
          {label}
          {changed && <button onClick={onReset} title="Put the default back" className="flex items-center gap-1 rounded-full border border-white/[0.08] px-2 py-px text-xs font-normal text-muted transition-colors hover:border-white/20 hover:text-ink"><Icon.refresh className="size-3" />default {changed}</button>}
        </div>
        {hint && <p className="mt-1 max-w-xl text-sm leading-snug text-muted">{hint}</p>}
      </div>
      <div className={cn("shrink-0", !wide && "flex justify-end", !wide && !inline && "max-md:justify-start")}>{children}</div>
    </div>
  );
}

// A group's icon (shell/icons names), for its card and its line in the side list.
const iconOf = (name?: string) => (name && (Icon as Record<string, typeof Icon.settings>)[name]) || Icon.sliders;

function Card({ id, title, blurb, icon, aside, children }: { id: string; title: string; blurb?: string; icon?: string; aside?: ReactNode; children: ReactNode }) {
  const I = iconOf(icon);
  return (
    <section id={`set-${id}`} className="scroll-mt-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-paper-2">
      <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-ink-2"><I className="size-4.5" /></span>
          <div className="min-w-0"><h2 className="text-lg leading-tight font-semibold tracking-[-0.01em] text-ink">{title}</h2>{blurb && <p className="mt-1 text-sm text-muted">{blurb}</p>}</div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

const Sub = ({ title }: { title: string }) => (
  <h3 className="flex items-center gap-3 border-t border-white/[0.05] px-5 pt-5 pb-1.5 text-[10px] font-semibold tracking-[0.12em] text-muted uppercase first:border-t-0">
    {title}<span aria-hidden className="h-px flex-1 bg-white/[0.05]" />
  </h3>
);

// Paper trading: the switch, what is in the fake wallet, and starting it over.
function PaperCard() {
  const paper = useTrade((s) => s.paper), w = useTrade((s) => s.wallet);
  const [start, setStart] = useState(""), [busy, setBusy] = useState(false), [add, setAdd] = useState("");
  // Add fake SOL without starting over: positions and history stay.
  const deposit = async (amount: number) => {
    if (!(amount > 0)) return;
    setBusy(true);
    try { const r = await depositPaper(amount); setAdd(""); toast(`Added ${amount} SOL. ${r.cash.toFixed(3)} SOL to spend.`); } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  useEffect(() => { loadPaperWallet(); }, []);
  const sol = (n: number) => `${n.toFixed(3)} SOL`, usd = (n: number) => w ? `$${Math.round(n * w.solUsd).toLocaleString()}` : "";
  const reset = async () => {
    if (!confirm("Sell every open paper position and refill the wallet?")) return;
    setBusy(true);
    try { const r = await resetPaperWallet(start ? +start : undefined); setStart(""); toast(`Paper wallet reset to ${r.start} SOL`); } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const stat = (label: string, value: ReactNode, sub?: string, tone?: string) => (
    <div className="flex flex-col gap-1 px-5 py-4"><span className="text-[10px] font-semibold tracking-[0.1em] text-muted uppercase">{label}</span><b className={cn("num font-tight text-2xl leading-tight font-semibold tracking-[-0.02em]", tone)}>{value}</b>{sub && <span className="text-xs text-muted">{sub}</span>}</div>
  );
  return (
    <Card id="paper" icon="record" title="Paper trading" blurb={paper ? "On: buys and sells use fake SOL at real prices; nothing is really bought" : "Off: buy buttons spend real SOL"}
      aside={<span className="flex items-center gap-2 text-sm font-medium">{paper ? <span className="text-warn">On</span> : <span className="text-down">Off</span>}<Switch on={paper} onChange={setPaper} label="Paper trading" tone="warn" /></span>}>
      <div className="grid grid-cols-3 divide-x divide-white/[0.05] border-b border-white/[0.06] bg-[oklch(17%_0_0)] max-md:grid-cols-1 max-md:divide-x-0 max-md:divide-y">
        {stat("Fake SOL to spend", w ? sol(w.cash) : "—", w ? usd(w.cash) : undefined)}
        {stat("Wallet value", w ? sol(w.equity) : "—", `cash + ${w?.open ?? 0} open position${w?.open === 1 ? "" : "s"}`)}
        {stat("Result", w ? `${w.pnl >= 0 ? "+" : ""}${sol(w.pnl)}` : "—", w ? `${(w.pnl / w.start * 100).toFixed(1)}% from ${w.start} SOL · ${w.trades} trades` : undefined, w && w.pnl > 0 ? "text-up" : w && w.pnl < 0 ? "text-down" : "")}
      </div>
      <Row label="Add SOL" hint="Tops up the fake wallet; open positions and history stay as they are">
        <span className="flex flex-wrap items-center gap-2">
          {[1, 5, 10].map((n) => <Button key={n} size="lg" disabled={busy} onClick={() => deposit(n)}>+{n}</Button>)}
          <span className={cn(box, "flex w-28 items-center gap-1 px-2.5")}>
            <input inputMode="decimal" value={add} onChange={(e) => setAdd(e.target.value.replace(/[^\d.]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") deposit(+add); }} placeholder="Other" aria-label="Fake SOL to add" className="num min-w-0 flex-1 bg-transparent text-right outline-none placeholder:text-muted" />
            <span className="text-sm text-muted">SOL</span>
          </span>
          <Button size="lg" disabled={busy || !(+add > 0)} onClick={() => deposit(+add)}>Add</Button>
        </span>
      </Row>
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

// This browser's own choices (kept here, not on the server, so each person on the public site has their own):
// the size of everything, the Pulse's columns and rows, the default slippage, hidden coins.
const SIZES: [string, string][] = [["auto", "Auto"], ["0.9", "Small"], ["1", "Normal"], ["1.15", "Large"], ["1.3", "Larger"]];
const PULSE_COLS: [PulseCol, string, string][] = [["new", "New Pairs", "Coins that just launched"], ["stretch", "Final Stretch", "Close to bonding"], ["migrated", "Migrated", "Bonded and trading in the pool"]];
const SLIPS: [string, string][] = [["100", "1%"], ["300", "3%"], ["500", "5%"], ["1000", "10%"]];

function DisplayCard() {
  const p = usePrefs();
  const open = PULSE_COLS.filter(([c]) => p.cols[c]).length;
  return (
    <Card id="display" icon="sliders" title="Display" blurb="How Blix looks in this browser. Saved here, right away">
      <Row label="Interface size" hint={`Everything grows or shrinks together. Auto fits the full layout to this window (now ${Math.round(p.fit * 100)}%)`}>
        <Segmented label="Interface size" value={p.autoScale ? "auto" : String(p.scale)} options={SIZES} onChange={(v) => (v === "auto" ? setPrefs({ autoScale: true }) : setPrefs({ autoScale: false, scale: +v }))} />
      </Row>
      <Sub title="Pulse columns" />
      {PULSE_COLS.map(([c, label, hint]) => (
        <Row inline key={c} label={label} hint={hint}>
          <Switch on={p.cols[c]} label={`${label} column`} onChange={(v) => { if (!v && open <= 1) return toast("Keep at least one column on"); setPrefs({ cols: { ...p.cols, [c]: v } }); }} />
        </Row>
      ))}
      <Sub title="Pulse rows" />
      <Row inline label="Compact rows" hint="More coins on screen: no note line, no contract under the picture"><Switch on={p.compact} label="Compact rows" onChange={(v) => setPrefs({ compact: v })} /></Row>
      <Row inline label="Audit pills" hint="Top 10, dev, snipers and bundle shares on each row"><Switch on={p.pills} label="Audit pills" onChange={(v) => setPrefs({ pills: v })} /></Row>
      <Row inline label="Quick-buy button" hint="The one-click buy on each row"><Switch on={p.buy} label="Quick-buy button" onChange={(v) => setPrefs({ buy: v })} /></Row>
      <Row inline label="Hide likely rugs" hint="Rug guard: its checks are under Pulse, Display"><Switch on={p.rug} label="Hide likely rugs" onChange={(v) => setPrefs({ rug: v })} /></Row>
    </Card>
  );
}

function BrowserCard() {
  const hidden = useHidden((s) => s.mints.length);
  const [slip, setSlip] = useState(() => String(store.get<number>("trade:slip", 300)));
  const forget = () => {
    if (!confirm("Forget everything this browser remembers about Blix (display, filters, hidden coins, presets)? You stay signed in.")) return;
    try { for (const k of Object.keys(localStorage)) if (k.startsWith("blix:") && k !== "blix:role") localStorage.removeItem(k); } catch { /* storage off */ }
    location.reload();
  };
  return (
    <Card id="browser" icon="eye" title="This browser" blurb="Trading defaults and what Blix remembers on this device">
      <Row label="Default slippage" hint="How far the price may move before a trade is refused. Each coin page can change it">
        <Segmented label="Default slippage" value={SLIPS.some(([v]) => v === slip) ? slip : "300"} options={SLIPS} onChange={(v) => { store.set("trade:slip", +v); setSlip(v); toast(`Slippage ${+v / 100}%`); }} />
      </Row>
      <Row label="Hidden coins" hint={hidden ? `${hidden.toLocaleString()} coin${hidden === 1 ? "" : "s"} hidden from the Pulse` : "None. Press the eye on a Pulse row to hide a coin"}>
        <Button size="lg" disabled={!hidden} onClick={() => { if (confirm(`Unhide all ${hidden} hidden coins?`)) { unhideAll(); toast("All coins unhidden"); } }}>Unhide all</Button>
      </Row>
      <Row label="Start fresh here" hint="Clears this browser's display, filters, hidden coins and trade presets. Your account and paper wallet stay">
        <Button size="lg" onClick={forget} className="hover:text-down">Clear this browser</Button>
      </Row>
    </Card>
  );
}

export function Settings() {
  const [res, setRes] = useState<Res | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, J>>({}), [keys, setKeys] = useState<Record<string, string>>({}), [clear, setClear] = useState<string[]>([]);
  const [q, setQ] = useState(""), [active, setActive] = useState("paper");
  const load = () => api<Res>("settings").then((r) => { if (!r?.settings || typeof r.settings !== "object") throw new Error("Settings came back unreadable. Reload to try again."); setRes(r); setDraft({}); setKeys({}); setClear([]); }).catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, []);

  const other = useMemo(() => {
    if (!res) return [];
    const listed = new Set([...GROUPS.flatMap((g) => g.parts.flatMap((p) => p.keys)), ...KEYS]);
    return Object.keys(res.settings).filter((k) => !listed.has(k) && !HIDDEN.has(k) && !(k in (res.secrets || {})) && (typeof res.settings[k] !== "object" || Array.isArray(res.settings[k])));
  }, [res]);
  const groups = useMemo(() => [...GROUPS, ...(other.length ? [{ id: "other", icon: "sliders", title: "Other", parts: [{ keys: other }] }] : [])], [other]);
  const nav: [string, string, string | undefined][] = [["paper", "Paper trading", "record"], ["display", "Display", "sliders"], ["browser", "This browser", "eye"], ...groups.map((g) => [g.id, g.title, g.icon] as [string, string, string | undefined]), ["keys", "Keys and webhooks", "key"]];

  // Highlight the group in view in the side list: the last card whose top has passed the top fifth of the scroller
  // (the page scrolls inside <main>, not the window).
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!res) return;
    let el: HTMLElement | null = top.current;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    const scroller: HTMLElement | Window = el || window;
    const pick = () => {
      const edge = (el ? el.getBoundingClientRect().top : 0) + (el ? el.clientHeight : innerHeight) * 0.2;
      const cards = [...document.querySelectorAll<HTMLElement>("[id^='set-']")];
      let at = cards[0]?.id.slice(4);
      for (const c of cards) if (c.getBoundingClientRect().top <= edge) at = c.id.slice(4);
      // At the very bottom the last card counts, however short.
      if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) at = cards[cards.length - 1]?.id.slice(4);
      if (at) setActive(at);
    };
    pick();
    scroller.addEventListener("scroll", pick, { passive: true });
    return () => scroller.removeEventListener("scroll", pick);
  }, [res, q]);

  if (!res && error) return (
    <div ref={top} className="mx-auto flex w-full max-w-[880px] flex-col gap-5 px-4 pt-6 pb-24 max-md:px-3 max-md:pt-4">
      <header>
        <h1 className="text-3xl leading-none font-bold tracking-[-0.03em]">Settings</h1>
      </header>
      <PaperCard /><DisplayCard /><BrowserCard />
      {/members can|sign in|401|403|forbidden|refused/i.test(error)
        ? <p className="flex items-center gap-2 px-1 text-sm text-muted"><Icon.shield className="size-4 shrink-0" />Radar, alert, AI and key settings belong to the owner of this Blix.</p>
        : <Problem text={error} />}
    </div>
  );
  if (!res) return <Page title="Settings"><Loading /></Page>;
  const val = (k: string) => (k in draft ? draft[k] : res.settings[k]);
  const dirty = Object.keys(draft).filter((k) => !same(draft[k], res.settings[k]));
  const keyEdits = Object.keys(keys).filter((k) => keys[k].trim());
  const nChanges = dirty.length + keyEdits.length + clear.length;
  const needle = q.trim().toLowerCase();
  const match = (k: string) => !needle || `${specOf(k).label} ${specOf(k).hint || ""} ${k}`.toLowerCase().includes(needle);
  const put = (k: string) => (v: J) => setDraft((d) => ({ ...d, [k]: v }));
  // Settings moved off their default, per group: a count next to the group in the side list.
  const offDefault = (k: string) => res.defaults?.[k] !== undefined && !same(val(k), res.defaults[k]);
  const changedIn = (id: string) => groups.find((g) => g.id === id)?.parts.reduce((n, p) => n + p.keys.filter((k) => k in res.settings && offDefault(k)).length, 0) || 0;

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
    return <Row key={k} label={s.label} hint={s.hint} changed={changed} inline={typeof v === "boolean"} onReset={() => put(k)(def)}><Control k={k} v={v} s={s} on={put(k)} /></Row>;
  };

  return (
    <div ref={top} className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-4 pt-6 pb-3 max-md:px-3 max-md:pt-4 max-md:pb-6">
      <header>
        <h1 className="text-3xl leading-none font-bold tracking-[-0.03em]">Settings</h1>
      </header>
      <div className="grid grid-cols-[15rem_minmax(0,1fr)] items-start gap-8 max-lg:grid-cols-1 max-lg:gap-4">
        <aside className="sticky top-4 flex flex-col gap-3 max-lg:static">
          <label className={cn(box, "flex items-center gap-2 rounded-full px-3.5 text-muted")}>
            <Icon.search className="size-4 shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a setting" aria-label="Find a setting" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
          </label>
          <nav aria-label="Settings groups" className="flex flex-col gap-0.5 max-lg:flex-row max-lg:gap-1 max-lg:overflow-x-auto max-lg:pb-1 max-lg:[scrollbar-width:none]">
            {nav.map(([id, title, icon]) => {
              const I = iconOf(icon), n = changedIn(id), on = active === id;
              return (
                <a key={id} href={`#/settings`} onClick={(e) => { e.preventDefault(); setActive(id); document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                  aria-current={on ? "true" : undefined}
                  className={cn("group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-md whitespace-nowrap transition-colors duration-150 max-lg:shrink-0 max-lg:rounded-full max-lg:border max-lg:border-white/[0.06] max-lg:py-1.5",
                    on ? "bg-white/[0.07] font-medium text-ink" : "text-muted hover:bg-white/[0.03] hover:text-ink-2")}>
                  {on && <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-ink max-lg:hidden" />}
                  <I className={cn("size-4 shrink-0 transition-colors", on ? "text-ink" : "text-muted group-hover:text-ink-2")} />
                  <span className="flex-1">{title}</span>
                  {n > 0 && <span title={`${n} changed from the default`} className="num rounded-full bg-white/[0.06] px-1.5 text-[10px] font-semibold text-ink-2">{n}</span>}
                </a>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-col gap-5 pb-24">
          {!needle && <><PaperCard /><DisplayCard /><BrowserCard /></>}
          {groups.map((g) => {
            const parts = g.parts.map((p) => ({ ...p, keys: p.keys.filter((k) => k in res.settings && match(k)) })).filter((p) => p.keys.length);
            if (!parts.length) return null;
            return (
              <Card key={g.id} id={g.id} icon={g.icon} title={g.title} blurb={g.blurb}
                aside={changedIn(g.id) > 0 && (
                  <button onClick={() => { for (const p of g.parts) for (const k of p.keys) if (k in res.settings && offDefault(k)) put(k)(res.defaults[k]); toast(`${g.title}: defaults put back. Save to keep them`); }}
                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] px-3 text-sm text-muted transition-colors hover:border-white/20 hover:text-ink">
                    <Icon.refresh className="size-3.5" />Reset to defaults
                  </button>
                )}>
                {parts.map((p, i) => <div key={i}>{p.title && <Sub title={p.title} />}{p.keys.map(row)}</div>)}
              </Card>
            );
          })}
          {KEYS.some((k) => k in (res.secrets || {}) && match(k)) && (
            <Card id="keys" icon="key" title="Keys and webhooks" blurb="Stored only on this PC. The page never sees a saved key, just its last 4 characters">
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
        <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center max-md:bottom-[4.75rem]">
          <div className="pointer-events-auto flex animate-brand-in items-center gap-3 rounded-full border border-white/[0.1] bg-[oklch(20%_0_0/0.92)] py-1.5 pr-1.5 pl-5 shadow-[0_12px_40px_rgb(0_0_0/0.55)] backdrop-blur-xl">
            <span className="flex items-center gap-2 text-md text-ink-2"><span className="size-1.5 rounded-full bg-accent" /><span><b className="num font-semibold text-ink">{nChanges}</b> unsaved change{nChanges === 1 ? "" : "s"}</span></span>
            <Button size="lg" disabled={busy} onClick={discard}>Discard</Button>
            <Button size="lg" variant="primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
