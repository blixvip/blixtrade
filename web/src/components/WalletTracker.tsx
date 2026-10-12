// The wallet tracker (server/wtrack.js): the member's own list of wallets and what they do as it happens.
// Drawn in two places from one component: the page (#/tracker, pages/Tracker.tsx) and the floating window
// (TrackerWindow below, mounted by main.tsx while lib/wtrack.ts says it is open) that stays over every page.
// Tabs, Axiom's: Manager (the list, add, import, export), Live Trades, Transfers, Monitor (balance, PnL, bags),
// KOLs (pump.fun's board, one click to track). Live rows arrive on the app's stream (lib/pulse.ts onTracker)
// and are merged with the polled answer by id, so a row is never shown twice and nothing is lost in a gap.
import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as PE, type ReactNode } from "react";
import { SolanaLogo } from "@/components/brand";
import { CoinImg, Problem } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { fetchApi, post } from "@/lib/api";
import { solNum, tokN, usdK, usePoll } from "@/lib/coin";
import { ageStr, shortAddr } from "@/lib/format";
import { useTrade } from "@/lib/mode";
import { onTracker } from "@/lib/pulse";
import { useNow } from "@/lib/route";
import { thumb } from "@/lib/thumb";
import { trade } from "@/lib/trade";
import { cn, store } from "@/lib/utils";
import { closeTrackerWindow, COLOR_HEX, EMOJIS, nameStyle, setQuickSol, setTab, TABS, useTracker, type Box, type Kol, type MonitorWallet, type Overview, type Tab, type TTrade, type TTransfer, type TWallet } from "@/lib/wtrack";
import { Icon } from "@/shell/icons";
import { Avatar } from "@/pages/traders/parts";

type Grp = 0 | 1 | 2 | 3;
const GRPS: [string, string][] = [["0", "All"], ["1", "P1"], ["2", "P2"], ["3", "P3"]];
const SIZES = [0.1, 0.25, 0.5, 1];
const field = "h-8 min-w-0 rounded-control border border-rule-2 bg-paper px-2.5 text-md text-ink outline-none placeholder:text-muted focus:border-accent-dim";
const copy = (text: string, what = "Address") => { navigator.clipboard?.writeText(text); toast(`${what} copied`); };
const solscan = (sig: string) => `https://solscan.io/tx/${sig}`;

// A wallet's mark: its emoji, else its initial on its colour.
function Mark({ w, size = 24 }: { w: { name: string; emoji: string | null; color: string | null }; size?: number }) {
  const hex = (w.color && COLOR_HEX[w.color]) || "oklch(40% 0.01 255)";
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-paper-4 ring-1 ring-edge select-none" style={{ width: size, height: size, fontSize: Math.round(size * 0.55), ...(w.emoji ? {} : { background: hex, color: "#000", fontWeight: 700 }) }} aria-hidden>
      {w.emoji || w.name.replace(/^[@$]/, "").charAt(0).toUpperCase()}
    </span>
  );
}
const Name = ({ w, className }: { w: { name: string; emoji: string | null; color: string | null; wallet?: string; address?: string }; className?: string }) => (
  <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
    <Mark w={w} size={20} />
    <b className="truncate text-sm font-semibold" style={nameStyle(w.color)}>{w.name}</b>
  </span>
);
const Grp = ({ g }: { g: number }) => <span className="num rounded-[4px] bg-paper-4 px-1 text-2xs font-semibold text-ink-2">P{g || 1}</span>;
const Age = ({ t }: { t: number }) => { const now = useNow(); return <span className="num text-xs whitespace-nowrap text-muted" title={new Date(t).toLocaleString()}>{ageStr(Math.max(0, now - t))}</span>; };
const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-10 text-center text-md text-muted">{children}</p>;

// Emoji and colour pickers, shared by the add form and a row's edit.
function Pickers({ emoji, color, onEmoji, onColor }: { emoji: string | null; color: string | null; onEmoji: (e: string | null) => void; onColor: (c: string | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex flex-wrap gap-0.5">
        {EMOJIS.map((e) => <button key={e} type="button" onClick={() => onEmoji(emoji === e ? null : e)} aria-pressed={emoji === e} aria-label={`Emoji ${e}`}
          className={cn("grid size-7 place-items-center rounded-[6px] text-base", emoji === e ? "bg-paper-5 ring-1 ring-accent" : "hover:bg-paper-4")}>{e}</button>)}
      </span>
      <span className="flex items-center gap-1">
        {Object.entries(COLOR_HEX).map(([c, hex]) => <button key={c} type="button" onClick={() => onColor(color === c ? null : c)} aria-pressed={color === c} aria-label={`Colour ${c}`}
          className={cn("size-5 rounded-full ring-2 ring-paper-2 transition-transform", color === c ? "scale-110 ring-ink" : "hover:scale-105")} style={{ background: hex }} />)}
      </span>
    </div>
  );
}

// ---------- Manager ----------
function Manager({ wallets, max, refresh }: { wallets: TWallet[]; max: number; refresh: () => void }) {
  const [address, setAddress] = useState(""), [name, setName] = useState(""), [emoji, setEmoji] = useState<string | null>(null), [color, setColor] = useState<string | null>(null), [grp, setGrp] = useState(1);
  const [editing, setEditing] = useState<string | null>(null), [importOpen, setImportOpen] = useState(false), [importText, setImportText] = useState(""), [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const add = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!address.trim()) return;
    setBusy(true);
    try { await post("wtrack/wallets", { address: address.trim(), name, emoji, color, grp }); setAddress(""); setName(""); setEmoji(null); setColor(null); refresh(); }
    catch (err) { toast((err as Error).message); }
    setBusy(false);
  };
  const remove = async (w: TWallet) => {
    try { await fetchApi(`api/wtrack/wallets/${w.address}`, { method: "DELETE" }); refresh(); } catch (err) { toast((err as Error).message); }
  };
  const doImport = async () => {
    setBusy(true);
    try { const r = await post<{ added: number; skipped: number }>("wtrack/import", { text: importText }); toast(`${r.added} wallet${r.added === 1 ? "" : "s"} added${r.skipped ? `, ${r.skipped} skipped` : ""}`); setImportOpen(false); setImportText(""); refresh(); }
    catch (err) { toast((err as Error).message); }
    setBusy(false);
  };
  const doExport = async () => {
    try {
      const r = await (await fetchApi("api/wtrack/export")).json();
      const blob = new Blob([JSON.stringify(r.wallets, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "blix-tracked-wallets.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) { toast((err as Error).message); }
  };
  const shown = q ? wallets.filter((w) => `${w.name} ${w.address}`.toLowerCase().includes(q.toLowerCase())) : wallets;
  return (
    <div className="flex flex-col">
      <form onSubmit={add} className="flex flex-col gap-2 border-b border-rule p-3">
        <div className="flex flex-wrap gap-1.5">
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Wallet address" spellCheck={false} className={cn(field, "flex-[2] font-outlier text-sm")} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" maxLength={40} className={cn(field, "flex-1")} />
          <select value={grp} onChange={(e) => setGrp(+e.target.value)} aria-label="Group" className={cn(field, "w-16 px-1.5")}>{[1, 2, 3].map((g) => <option key={g} value={g}>P{g}</option>)}</select>
          <Button variant="primary" size="lg" type="submit" disabled={busy || !address.trim()}>Track</Button>
        </div>
        <Pickers emoji={emoji} color={color} onEmoji={setEmoji} onColor={setColor} />
      </form>
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a wallet" className={cn(field, "h-7 flex-1 text-sm")} />
        <span className="num text-xs whitespace-nowrap text-muted">{wallets.length} / {max}</span>
        <Button size="md" onClick={() => setImportOpen(true)}>Import</Button>
        <Button size="md" onClick={doExport} disabled={!wallets.length}>Export</Button>
      </div>
      {!wallets.length ? <Empty>No wallets yet. Paste an address above, import Axiom's export, or pick a KOL.</Empty>
        : !shown.length ? <Empty>Nothing matches.</Empty>
        : shown.map((w) => editing === w.address
          ? <EditRow key={w.address} w={w} onDone={() => { setEditing(null); refresh(); }} />
          : (
            <div key={w.address} className="group flex items-center gap-2.5 border-b border-rule px-3 py-2 last:border-0 hover:bg-paper-3/60">
              <Mark w={w} size={28} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5"><b className="truncate text-sm font-semibold" style={nameStyle(w.color)}>{w.name}</b><Grp g={w.grp} />
                  {!w.alerts && <Tip tip="Alerts off"><Icon.eyeOff className="size-3 text-muted" /></Tip>}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <a href={`#/trader/${w.address}`} className="font-outlier hover:text-ink">{shortAddr(w.address)}</a>
                  <button onClick={() => copy(w.address)} aria-label="Copy address" className="hover:text-ink"><Icon.copy className="size-3" /></button>
                  <span>·</span><span className="num">{w.n24} today</span>
                  {w.last_trade ? <><span>·</span><Age t={w.last_trade} /></> : null}
                </span>
              </span>
              <Tip tip={w.alerts ? "Alerts on" : "Alerts off"}>
                <button onClick={() => post(`wtrack/wallets/${w.address}`, { alerts: !w.alerts }).then(refresh)} aria-label="Toggle alerts" className={cn("text-muted hover:text-ink", !w.alerts && "opacity-50")}>
                  {w.alerts ? <Icon.eye className="size-3.5" /> : <Icon.eyeOff className="size-3.5" />}
                </button>
              </Tip>
              <Button size="sm" variant="ghost" onClick={() => setEditing(w.address)}>Edit</Button>
              <Tip tip="Stop tracking"><button onClick={() => remove(w)} aria-label={`Stop tracking ${w.name}`} className="text-muted opacity-0 group-hover:opacity-100 hover:text-down">×</button></Tip>
            </div>
          ))}
      <Dialog open={importOpen} onOpenChange={setImportOpen} title="Import wallets">
        <p className="mb-2 text-sm text-ink-2">Paste Axiom's tracked-wallets export (JSON) or one wallet per line: <span className="font-outlier">address name</span>.</p>
        <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8} spellCheck={false} placeholder='[{"trackedWalletAddress":"…","name":"…","emoji":"🐸"}]' className={cn(field, "h-auto w-full py-2 font-outlier text-sm")} />
        <div className="mt-3 flex justify-end gap-2"><Button onClick={() => setImportOpen(false)}>Cancel</Button><Button variant="primary" onClick={doImport} disabled={busy || !importText.trim()}>Import</Button></div>
      </Dialog>
    </div>
  );
}
function EditRow({ w, onDone }: { w: TWallet; onDone: () => void }) {
  const [name, setName] = useState(w.name.startsWith(w.address.slice(0, 4)) ? "" : w.name), [emoji, setEmoji] = useState(w.emoji), [color, setColor] = useState(w.color), [grp, setGrp] = useState(w.grp || 1);
  const save = async () => { try { await post(`wtrack/wallets/${w.address}`, { name, emoji, color, grp }); onDone(); } catch (err) { toast((err as Error).message); } };
  return (
    <div className="flex flex-col gap-2 border-b border-rule bg-paper-3/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Mark w={{ name: name || w.name, emoji, color }} size={28} />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={shortAddr(w.address)} maxLength={40} autoFocus className={cn(field, "flex-1")} />
        <select value={grp} onChange={(e) => setGrp(+e.target.value)} aria-label="Group" className={cn(field, "w-16 px-1.5")}>{[1, 2, 3].map((g) => <option key={g} value={g}>P{g}</option>)}</select>
        <Button variant="primary" size="lg" onClick={save}>Save</Button><Button size="lg" onClick={onDone}>Cancel</Button>
      </div>
      <Pickers emoji={emoji} color={color} onEmoji={setEmoji} onColor={setColor} />
    </div>
  );
}

// ---------- Live trades ----------
function QuickBuy({ r, sol }: { r: TTrade; sol: number }) {
  const paper = useTrade((s) => s.paper);
  const [busy, setBusy] = useState(false);
  const buy = async () => {
    setBusy(true);
    await trade({ side: "buy", mint: r.mint, symbol: r.symbol || "", sol }, () => post("paper/quoted", { mint: r.mint, sol }));
    setBusy(false);
  };
  return (
    <button onClick={buy} disabled={busy} title={paper ? "Paper money" : "Real SOL"} className="chrome-fill inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold disabled:opacity-60">
      <Icon.bolt className="size-3" />{sol}<SolanaLogo className="w-2.5" />
    </button>
  );
}
function Trades({ rows, sol, compact }: { rows: TTrade[]; sol: number; compact: boolean }) {
  if (!rows.length) return <Empty>Trades show here the moment a tracked wallet buys or sells.</Empty>;
  return (
    <div className="flex flex-col">
      {rows.map((r) => {
        const buy = r.side === "buy";
        return (
          <div key={r.id} className={cn("flex items-center gap-2.5 border-b border-rule px-3 py-2 last:border-0 hover:bg-paper-3/60", r.id < 0 && "animate-[rowin_300ms_var(--ease-out)]")}>
            <Name w={r} className="w-[118px] shrink-0 max-sm:w-[76px]" />
            <span className={cn("num w-6 shrink-0 text-center text-xs font-bold max-sm:w-4", buy ? "text-up" : "text-down")}>{buy ? "B" : "S"}</span>
            <a href={`#/coin/${r.mint}`} className="flex min-w-0 flex-1 items-center gap-2 hover:text-ink">
              <span className="relative size-7 shrink-0 overflow-hidden rounded-full bg-paper-4"><CoinImg mint={r.mint} /></span>
              <span className="min-w-0"><b className="block truncate text-sm font-semibold">${r.symbol || shortAddr(r.mint)}</b>{!compact && <span className="block truncate text-xs text-muted">{r.tname || ""}</span>}</span>
            </a>
            <span className="num shrink-0 text-right">
              <span className={cn("flex items-center justify-end gap-1 text-sm font-semibold", buy ? "text-up" : "text-down")}>{r.sol != null ? solNum(r.sol) : "—"}<SolanaLogo className="w-2.5" /></span>
              <span className="block text-xs text-muted">{r.usd != null ? usdK(r.usd) : ""}{r.tokens != null && !compact ? <span className="max-sm:hidden"> · {tokN(r.tokens)}</span> : null}</span>
            </span>
            {!compact && <span className="num w-16 shrink-0 text-right text-xs text-ink-2 max-md:hidden" title="Market cap at the trade">{r.mc_usd ? usdK(r.mc_usd) : <span className="text-muted">—</span>}</span>}
            <span className="w-11 shrink-0 text-right max-sm:w-8"><Age t={r.t} /></span>
            <QuickBuy r={r} sol={sol} />
          </div>
        );
      })}
    </div>
  );
}

// ---------- Transfers ----------
function Transfers({ rows }: { rows: TTransfer[] }) {
  if (!rows.length) return <Empty>SOL and token moves in and out of tracked wallets show here.</Empty>;
  return (
    <div className="flex flex-col">
      {rows.map((r) => {
        const inn = r.dir === "in";
        return (
          <div key={r.id} className="flex items-center gap-2.5 border-b border-rule px-3 py-2 last:border-0 hover:bg-paper-3/60">
            <Name w={r} className="w-[118px] shrink-0 max-sm:w-[76px]" />
            <span className={cn("num w-8 shrink-0 text-center text-2xs font-bold", inn ? "text-up" : "text-down")}>{inn ? "IN" : "OUT"}</span>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {r.mint ? <span className="relative size-6 shrink-0 overflow-hidden rounded-full bg-paper-4"><CoinImg mint={r.mint} /></span> : <SolanaLogo className="w-4 shrink-0" />}
              <span className="min-w-0"><b className="num block truncate text-sm font-semibold">{r.mint ? `${tokN(r.amount)} ${r.symbol ? `$${r.symbol}` : shortAddr(r.mint)}` : `${solNum(r.amount)} SOL`}</b>
                <span className="block truncate text-xs text-muted">{r.usd != null ? `${usdK(r.usd)} · ` : ""}{inn ? "from" : "to"} {r.other ? <button onClick={() => copy(r.other!)} className="font-outlier hover:text-ink">{shortAddr(r.other)}</button> : "unknown"}</span></span>
            </span>
            <a href={solscan(r.sig)} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-ink" aria-label="Open on Solscan"><Icon.link className="size-3.5" /></a>
            <span className="w-11 shrink-0 text-right"><Age t={r.t} /></span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Monitor ----------
function Monitor({ active }: { active: boolean }) {
  const { data, error } = usePoll<{ wallets: MonitorWallet[]; solUsd: number }>(active ? "wtrack/monitor" : null, 30_000, true);
  if (error && !data) return <Problem text={error} />;
  if (!data) return <Empty>Loading…</Empty>;
  if (!data.wallets.length) return <Empty>Track a wallet to see its balance, PnL and open bags.</Empty>;
  const signed = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${usdK(Math.abs(n))}`);
  const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-muted" : n > 0 ? "text-up" : "text-down");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="px-3 py-2 font-medium">Wallet</th><th className="px-3 py-2 text-right font-medium">Balance</th><th className="px-3 py-2 text-right font-medium">Realized</th><th className="px-3 py-2 text-right font-medium">Open PnL</th><th className="px-3 py-2 text-right font-medium">Win rate</th><th className="px-3 py-2 font-medium">Bags</th></tr></thead>
        <tbody>
          {data.wallets.map((w) => (
            <tr key={w.address} className="border-t border-rule hover:bg-paper-3/60">
              <td className="px-3 py-2"><a href={`#/trader/${w.address}`} className="hover:text-ink"><Name w={w} /></a></td>
              <td className="num px-3 py-2 text-right whitespace-nowrap">{w.balance == null ? <span className="text-muted">—</span> : <><b className="font-semibold">{solNum(w.balance)}</b> <span className="text-muted">SOL · {usdK(w.balance * data.solUsd)}</span></>}</td>
              <td className={cn("num px-3 py-2 text-right whitespace-nowrap", tone(w.pnl.realized))}>{signed(w.pnl.realized)}<span className="block text-2xs text-muted">{w.pnl.closed} closed</span></td>
              <td className={cn("num px-3 py-2 text-right whitespace-nowrap", tone(w.pnl.unrealized))}>{signed(w.pnl.unrealized)}<span className="block text-2xs text-muted">{w.pnl.openValue ? `${usdK(w.pnl.openValue)} held` : `${w.pnl.open} open`}</span></td>
              <td className="num px-3 py-2 text-right whitespace-nowrap">{w.pnl.winRate == null ? <span className="text-muted">—</span> : `${Math.round(w.pnl.winRate * 100)}%`}<span className="block text-2xs text-muted">{w.pnl.trades} trades</span></td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap gap-1">
                  {!w.pnl.positions.length && <span className="text-xs text-muted">none</span>}
                  {w.pnl.positions.map((p) => (
                    <a key={p.mint} href={`#/coin/${p.mint}`} title={`${tokN(p.held)} ${p.symbol || ""} · ${p.value != null ? usdK(p.value) : "unpriced"}`}
                      className="inline-flex h-6 items-center gap-1 rounded-full border border-rule-2 bg-paper-3 pr-2 pl-0.5 text-xs hover:border-muted">
                      <span className="relative size-5 overflow-hidden rounded-full bg-paper-4"><CoinImg mint={p.mint} /></span>
                      <b className="font-semibold">{p.symbol || shortAddr(p.mint)}</b>
                      <span className={cn("num", tone(p.unrealized))}>{p.value != null ? usdK(p.value) : "—"}</span>
                    </a>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- KOLs ----------
function Kols({ active, refresh }: { active: boolean; refresh: () => void }) {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");
  const { data, error } = usePoll<{ rows: Kol[]; error: string | null; range: string }>(active ? `wtrack/kols?range=${range}` : null, 60_000, true);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const track = async (k: Kol) => {
    try { await post("wtrack/wallets", { address: k.wallet, name: k.name || "", grp: 1 }); setAdded((s) => new Set(s).add(k.wallet)); refresh(); toast(`Tracking ${k.name || shortAddr(k.wallet)}`); }
    catch (err) { toast((err as Error).message); }
  };
  const signed = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${usdK(Math.abs(n))}`);
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-rule px-3 py-2">
        <span className="text-sm text-muted">pump.fun's top traders. One click to track.</span>
        <Segmented value={range} options={[["24h", "24H"], ["7d", "7D"], ["30d", "30D"]]} onChange={setRange} label="Range" />
      </div>
      {error && !data ? <Problem text={error} /> : !data ? <Empty>Loading…</Empty> : data.error && !data.rows.length ? <Empty>{data.error}</Empty> : !data.rows.length ? <Empty>No board right now.</Empty>
        : data.rows.map((k) => {
          const on = k.tracked || added.has(k.wallet);
          return (
            <div key={k.wallet} className="flex items-center gap-2.5 border-b border-rule px-3 py-2 last:border-0 hover:bg-paper-3/60">
              <span className="num w-6 shrink-0 text-right text-xs text-muted">{k.rank}</span>
              <Avatar src={k.pic} name={k.name || k.wallet} size={30} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5"><b className="truncate text-sm font-semibold">{k.name || shortAddr(k.wallet)}</b>
                  {k.x && <a href={`https://x.com/${k.x}`} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-ink" aria-label={`@${k.x} on X`}><Icon.x className="size-3" /></a>}</span>
                <span className="flex items-center gap-1 text-xs text-muted"><a href={`#/trader/${k.wallet}`} className="font-outlier hover:text-ink">{shortAddr(k.wallet)}</a><button onClick={() => copy(k.wallet)} aria-label="Copy address" className="hover:text-ink"><Icon.copy className="size-3" /></button></span>
              </span>
              <span className="num shrink-0 text-right"><b className={cn("block text-sm font-semibold", (k.pnl ?? 0) >= 0 ? "text-up" : "text-down")}>{signed(k.pnl)}</b>
                <span className="block text-xs text-muted">{k.pnlSol != null ? `${solNum(k.pnlSol, true)} SOL` : ""}{k.pnlPct != null ? ` · ${k.pnlPct >= 0 ? "+" : ""}${k.pnlPct.toFixed(1)}%` : ""}</span></span>
              <Button size="sm" variant={on ? "ghost" : "outline"} disabled={on} onClick={() => track(k)}>{on ? "Tracked" : "Track"}</Button>
            </div>
          );
        })}
    </div>
  );
}

// ---------- the tracker ----------
export function WalletTracker({ compact = false, right }: { compact?: boolean; right?: ReactNode }) {
  const tab = useTracker((s) => s.tab), sol = useTracker((s) => s.sol);
  const [grp, setGrp] = useState<Grp>(0);
  const { data, error, refresh } = usePoll<Overview>("wtrack?limit=300", 20_000, true);
  // Rows pushed on the stream since the page opened, newest first; the polled answer catches up on any gap.
  const [live, setLive] = useState<{ trades: TTrade[]; transfers: TTransfer[] }>({ trades: [], transfers: [] });
  const [gone, setGone] = useState<Set<number>>(new Set());
  useEffect(() => onTracker((kind, row) => {
    if (kind === "drop") { const id = (row as { id: number }).id; setLive((s) => ({ ...s, trades: s.trades.filter((x) => x.id !== id) })); setGone((g) => new Set(g).add(id)); return; }
    setLive((s) => kind === "trade" ? { ...s, trades: [row as TTrade, ...s.trades].slice(0, 300) } : { ...s, transfers: [row as TTransfer, ...s.transfers].slice(0, 150) });
  }), []);
  useEffect(() => { const f = () => { if (!document.hidden) refresh(); }; document.addEventListener("visibilitychange", f); return () => document.removeEventListener("visibilitychange", f); }, [refresh]);
  const trades = useMemo(() => {
    const by = new Map<number, TTrade>();
    for (const r of [...live.trades, ...(data?.feed || [])]) if (!by.has(r.id) && !gone.has(r.id)) by.set(r.id, r);
    const all = [...by.values()].sort((a, b) => b.id - a.id);
    return grp ? all.filter((r) => (r.grp || 1) === grp) : all;
  }, [live.trades, data, grp, gone]);
  const transfers = useMemo(() => {
    const by = new Map<number, TTransfer>();
    for (const r of [...live.transfers, ...(data?.transfers || [])]) if (!by.has(r.id)) by.set(r.id, r);
    const all = [...by.values()].sort((a, b) => b.id - a.id);
    return grp ? all.filter((r) => (r.grp || 1) === grp) : all;
  }, [live.transfers, data, grp]);
  const wallets = data?.wallets || [];
  const s = data?.status;
  const ok = Boolean(s && (s.stream || s.live));
  if (error && !data) return <Problem text={error} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
        <div role="tablist" aria-label="Tracker" className="flex items-center gap-0.5 overflow-x-auto">
          {TABS.map(([v, text]) => (
            <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
              className={cn("h-7 shrink-0 rounded-control px-2.5 text-sm whitespace-nowrap transition-colors", tab === v ? "bg-paper-5 font-semibold text-ink" : "text-muted hover:text-ink-2")}>
              {text}{v === "manager" && wallets.length ? <span className="num ml-1 text-xs text-muted">{wallets.length}</span> : null}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {(tab === "trades" || tab === "transfers") && <Segmented value={String(grp) as "0" | "1" | "2" | "3"} options={GRPS} onChange={(v) => setGrp(+v as Grp)} label="Group" />}
        {tab === "trades" && (
          <span className="flex items-center gap-1 rounded-full border border-rule-2 bg-paper-3 py-0.5 pr-1.5 pl-2 text-xs" title="Quick buy size">
            <Icon.bolt className="size-3 text-muted" />
            {SIZES.map((v) => <button key={v} onClick={() => setQuickSol(v)} className={cn("num rounded-full px-1.5", sol === v ? "bg-paper-5 font-semibold text-ink" : "text-muted hover:text-ink")}>{v}</button>)}
            <SolanaLogo className="w-2.5" />
          </span>
        )}
        {s && <Tip tip={ok ? `Live: ${s.live ? "pump.fun and PumpSwap feeds" : "no live feed"} · ${s.fast ? `fast lane on ${s.fastWallets} wallets (every venue, about a second)` : "fast lane off"} · ${s.stream ? `chain stream on ${s.streamWallets} wallets` : "chain stream off"}${s.backlog ? ` · ${s.backlog} waiting to be read` : ""}` : "Not live: the radar's feeds are off"}>
          <span className="flex items-center gap-1.5 text-xs text-muted"><i className={cn("size-2 rounded-full", ok ? "bg-up" : "bg-warn")} />{ok ? "Live" : "Paused"}</span>
        </Tip>}
        {right}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!data ? <Empty>Loading…</Empty>
          : tab === "manager" ? <Manager wallets={wallets} max={data.max} refresh={refresh} />
          : tab === "trades" ? <Trades rows={trades} sol={sol} compact={compact} />
          : tab === "transfers" ? <Transfers rows={transfers} />
          : tab === "monitor" ? <Monitor active={tab === "monitor"} />
          : <Kols active={tab === "kols"} refresh={refresh} />}
      </div>
    </div>
  );
}

// ---------- the floating window ----------
// Over every page, dragged by its title bar and sized from its corner; where it sits is remembered in this browser.
const MIN = { w: 400, h: 300 };
const defaultBox = (): Box => ({ x: Math.max(8, innerWidth - 580), y: 72, w: Math.min(560, innerWidth - 16), h: Math.min(520, innerHeight - 120) });
export function TrackerWindow() {
  const [box, setBox] = useState<Box>(() => store.get<Box | null>("wtrack:box", null) || defaultBox());
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "move" | "size"; dx: number; dy: number; box: Box } | null>(null);
  const clamp = (b: Box): Box => {
    const w = Math.max(MIN.w, Math.min(b.w, innerWidth - 16)), h = Math.max(MIN.h, Math.min(b.h, innerHeight - 16));
    return { w, h, x: Math.round(Math.min(Math.max(8, b.x), innerWidth - w - 8)), y: Math.round(Math.min(Math.max(8, b.y), innerHeight - h - 8)) };
  };
  useEffect(() => {
    const fit = () => setBox((b) => clamp(b));
    fit(); addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);
  const down = (kind: "move" | "size") => (e: PE<HTMLElement>) => {
    if (kind === "move" && (e.target as HTMLElement).closest("button,input,a")) return;
    drag.current = { kind, dx: e.clientX, dy: e.clientY, box };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PE<HTMLElement>) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.dx, dy = e.clientY - d.dy;
    setBox(clamp(d.kind === "move" ? { ...d.box, x: d.box.x + dx, y: d.box.y + dy } : { ...d.box, w: d.box.w + dx, h: d.box.h + dy }));
  };
  const up = () => { if (drag.current) { drag.current = null; setBox((b) => { store.set("wtrack:box", b); return b; }); } };
  return (
    <div ref={el} role="dialog" aria-label="Wallet tracker" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      className="fixed z-40 flex flex-col overflow-hidden rounded-card border border-rule-2 bg-paper-2 shadow-[0_24px_60px_-16px_oklch(0%_0_0/0.85),inset_0_1px_0_oklch(100%_0_0/0.06)]">
      <div onPointerDown={down("move")} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className="metal-bar flex h-9 shrink-0 cursor-move items-center gap-2 border-b border-rule px-3 select-none">
        <Icon.wallets className="size-4 text-ink-2" />
        <b className="text-sm font-semibold">Wallet tracker</b>
        <span className="flex-1" />
        <Tip tip="Open the page"><a href="#/tracker" onClick={closeTrackerWindow} aria-label="Open the tracker page" className="grid size-6 place-items-center rounded-[6px] text-muted hover:bg-paper-4 hover:text-ink"><Icon.link className="size-3.5" /></a></Tip>
        <button onClick={closeTrackerWindow} aria-label="Close" className="grid size-6 place-items-center rounded-[6px] text-muted hover:bg-paper-4 hover:text-ink"><Icon.close className="size-3.5" /></button>
      </div>
      <div className="min-h-0 flex-1"><WalletTracker compact /></div>
      <div onPointerDown={down("size")} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden className="absolute right-0 bottom-0 size-4 cursor-nwse-resize">
        <svg viewBox="0 0 16 16" className="size-4 text-muted"><path d="M15 9v6H9M15 13v2h-2" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
      </div>
    </div>
  );
}
