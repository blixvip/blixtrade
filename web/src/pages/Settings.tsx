// Settings (#/settings): every radar setting, grouped. Keys and webhooks stay on the classic page.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { Loading, Page, Panel, Problem, Tag } from "@/components/page";
import { api, post } from "@/lib/api";
import { cn } from "@/lib/utils";
import { loadPaperWallet, resetPaperWallet, setPaper, useTrade } from "@/lib/mode";

type J = any;
type Res = { settings: Record<string, J>; secrets: Record<string, J>; defaults: Record<string, J> };
// Not edited here: secrets, one-time flags, and the public switch.
const HIDDEN = /^(buyMigrated|publicHost|publicMode|remoteKey|tunnelKey)$/;
const GROUPS: [name: string, match: RegExp][] = [
  ["What gets tracked", /^(nursery|maxTracked|minSafety|launchScore|momentumScore|spikeMinVol|minExitLiq)/],
  ["Alerts", /^(notifyKinds|quiet(Start|End)|alertCooldownMin|pushUnscreened|briefEveryMin|aiBriefs|telegramChat)/],
  ["Wallets", /^(autoFollowSmart|maxSmartWallets|walletMinSol|fomo)/],
  ["Picks", /^(pick|earlyMin|entry|guard|buyConviction)/],
  ["Trading", /^(quickSizes|paper)/],
  ["AI reads", /^(research|queueMax|fast|grok|triage|earlyAuto|claudeFast|deep|quick|aiInGate|scout|narrative|reviewMinNew)/],
];
const label = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/\b(Mcap|Pct|Min|Pwin|Ai|Rpc|Liq|Vol)\b/gi, (w) => (({ mcap: "market cap", pct: "%", min: "min", pwin: "win chance", ai: "AI", rpc: "RPC", liq: "liquidity", vol: "volume" }) as Record<string, string>)[w.toLowerCase()]);
const same = (a: J, b: J) => JSON.stringify(a) === JSON.stringify(b);
const field = "h-8 rounded-control border border-rule-2 bg-paper px-2.5 text-md text-ink outline-none focus:border-accent-dim";

function Field({ k, v, def, on }: { k: string; v: J; def: J; on: (v: J) => void }) {
  const changed = def !== undefined && !same(v, def);
  return (
    <label className="flex min-h-11 items-center justify-between gap-4 border-t border-rule px-4 py-1.5 first:border-t-0">
      <span className="min-w-0 text-md text-ink-2">{label(k)}{changed && <span className="ml-2 text-sm text-muted">default {Array.isArray(def) ? def.join(", ") : String(def === "" ? "empty" : def)}</span>}</span>
      {typeof v === "boolean" ? (
        <button type="button" role="switch" aria-checked={v} aria-label={label(k)} onClick={() => on(!v)} className={cn("relative h-6 w-10 shrink-0 rounded-full border transition-colors", v ? "border-accent bg-accent" : "border-rule-2 bg-paper-4")}>
          <i className={cn("absolute top-0.5 size-4.5 rounded-full transition-[left]", v ? "left-[18px] bg-accent-ink" : "left-0.5 bg-ink-2")} /></button>
      ) : typeof v === "number" ? <input type="number" step="any" value={v} onChange={(e) => on(e.target.value === "" ? 0 : +e.target.value)} className={cn(field, "num w-28 text-right")} />
        : Array.isArray(v) ? <input value={v.join(", ")} onChange={(e) => on(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} className={cn(field, "w-[min(28rem,55%)]")} />
        : <input value={v ?? ""} onChange={(e) => on(e.target.value)} className={cn(field, "w-56")} />}
    </label>
  );
}

// Paper trading: the switch, what is in the fake wallet, and starting it over.
function PaperCard() {
  const paper = useTrade((s) => s.paper), w = useTrade((s) => s.wallet);
  const [start, setStart] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { loadPaperWallet(); }, []);
  const row = "flex min-h-11 items-center justify-between gap-4 border-t border-rule px-4 py-1.5 first:border-t-0";
  const sol = (n: number) => `${n.toFixed(3)} SOL`, usd = (n: number) => w ? `$${Math.round(n * w.solUsd).toLocaleString()}` : "";
  const reset = async () => {
    setBusy(true);
    try { const r = await resetPaperWallet(start ? +start : undefined); setStart(""); toast(`Paper wallet reset to ${r.start} SOL`); } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Panel title="Paper trading" aside="fake money, real prices">
      <div className={row}>
        <span className="min-w-0 text-md text-ink-2">Paper trading<span className="ml-2 text-sm text-muted">buys and sells use fake SOL; nothing is really bought</span></span>
        <button type="button" role="switch" aria-checked={paper} aria-label="Paper trading" onClick={() => setPaper(!paper)} className={cn("relative h-6 w-10 shrink-0 rounded-full border transition-colors", paper ? "border-warn bg-warn" : "border-rule-2 bg-paper-4")}>
          <i className={cn("absolute top-0.5 size-4.5 rounded-full transition-[left]", paper ? "left-[18px] bg-paper" : "left-0.5 bg-ink-2")} /></button>
      </div>
      <div className={row}><span className="text-md text-ink-2">Fake SOL left to spend</span><b className="num text-md font-semibold">{w ? `${sol(w.cash)} · ${usd(w.cash)}` : "—"}</b></div>
      <div className={row}><span className="text-md text-ink-2">Wallet value<span className="ml-2 text-sm text-muted">cash plus {w?.open ?? 0} open position{w?.open === 1 ? "" : "s"} at what they would sell for</span></span><b className="num text-md font-semibold">{w ? sol(w.equity) : "—"}</b></div>
      <div className={row}><span className="text-md text-ink-2">Result since the wallet started<span className="ml-2 text-sm text-muted">from {w?.start ?? "…"} SOL, {w?.trades ?? 0} trades</span></span>
        <b className={cn("num text-md font-semibold", w && w.pnl > 0 ? "text-up" : w && w.pnl < 0 ? "text-down" : "")}>{w ? `${w.pnl >= 0 ? "+" : ""}${sol(w.pnl)} · ${(w.pnl / w.start * 100).toFixed(1)}%` : "—"}</b></div>
      <div className={row}>
        <span className="min-w-0 text-md text-ink-2">Start over<span className="ml-2 text-sm text-muted">sells what is open and refills the wallet; old trades stay in the history</span></span>
        <span className="flex shrink-0 items-center gap-2">
          <input type="number" min="0" step="any" value={start} onChange={(e) => setStart(e.target.value)} placeholder={`${w?.start ?? 10} SOL`} aria-label="Starting fake SOL" className={cn(field, "num w-28 text-right")} />
          <Button size="lg" disabled={busy} onClick={reset}>{busy ? "Resetting…" : "Reset wallet"}</Button>
        </span>
      </div>
    </Panel>
  );
}

export function Settings() {
  const [res, setRes] = useState<Res | null>(null), [draft, setDraft] = useState<Record<string, J>>({}), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const load = () => api<Res>("settings").then((r) => { setRes(r); setDraft({}); }).catch((e) => setError((e as Error).message));
  useEffect(() => { load(); }, []);
  if (!res) return <Page title="Settings">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const secret = new Set(Object.keys(res.secrets || {}));
  const keys = Object.keys(res.settings).filter((k) => !HIDDEN.test(k) && !secret.has(k) && (typeof res.settings[k] !== "object" || Array.isArray(res.settings[k])));
  const groups = [...GROUPS.map(([name, m]) => [name, keys.filter((k) => m.test(k) && GROUPS.find(([, x]) => x.test(k))![0] === name)] as const),
    ["Other", keys.filter((k) => !GROUPS.some(([, m]) => m.test(k)))] as const].filter(([, ks]) => ks.length);
  const dirty = Object.keys(draft).filter((k) => !same(draft[k], res.settings[k]));
  const save = async () => {
    setBusy(true);
    try { setRes(await post<Res>("settings", { settings: Object.fromEntries(dirty.map((k) => [k, draft[k]])), clear: [] })); setDraft({}); toast("Saved"); } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  return (
    <Page title="Settings" sub="Changes apply as soon as they are saved."
      right={<span className="flex items-center gap-2">{dirty.length > 0 && <Tag tone="warn">{dirty.length} unsaved</Tag>}<Button size="lg" disabled={!dirty.length || busy} onClick={() => setDraft({})}>Discard</Button>
        <Button size="lg" variant="primary" disabled={!dirty.length || busy} onClick={save}>{busy ? "Saving…" : "Save"}</Button></span>}>
      <div className="grid items-start gap-3 grid-cols-[repeat(2,minmax(0,1fr))] max-xl:grid-cols-[minmax(0,1fr)]">
        <PaperCard />
        {groups.map(([name, ks]) => (
          <Panel key={name} title={name}>{ks.map((k) => <Field key={k} k={k} v={k in draft ? draft[k] : res.settings[k]} def={res.defaults?.[k]} on={(v) => setDraft((d) => ({ ...d, [k]: v }))} />)}</Panel>))}
        <Panel title="Keys and webhooks" aside="stored on this PC">
          {[...secret].map((k) => <div key={k} className="flex min-h-11 items-center justify-between gap-4 border-t border-rule px-4 py-1.5 first:border-t-0"><span className="text-md text-ink-2">{label(k)}</span><Tag tone={res.secrets[k]?.set ? "up" : "ink"}>{res.secrets[k]?.set ? "Saved" : "Not set"}</Tag></div>)}
          <p className="border-t border-rule px-4 py-3 text-md text-muted">Keys, alert rules, tests and backups are changed in <a className="text-accent hover:text-focus" href={`${location.protocol}//${location.hostname}:4420/#/settings`}>classic Blix ›</a></p>
        </Panel>
      </div>
    </Page>
  );
}
