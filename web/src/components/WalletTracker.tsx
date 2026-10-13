import "./wallet-tracker.css";
import { fitTrackerBox, fitTrackerDockWidth, trackerDockTarget, TRACKER_DOCK_MIN_VIEWPORT, type TrackerDockSide } from "@/lib/tracker-window";
// The wallet tracker (server/wtrack.js): the member's own list of wallets and what they do as it happens.
// Drawn in two places from one component: the page (#/tracker, pages/Tracker.tsx) and the floating window
// (TrackerWindow below, mounted by main.tsx while lib/wtrack.ts says it is open) that stays over every page.
// Tabs, Axiom's: Manager (the list, add, import, export), Live Trades, Transfers, Monitor (balance, PnL, bags),
// Find traders (leaderboards and followed profiles, one click to track). Live rows arrive on the app's stream (lib/pulse.ts onTracker)
// and are merged with the polled answer by id, so a row is never shown twice and nothing is lost in a gap.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as PE, type ReactNode } from "react";
import { SolanaLogo } from "@/components/brand";
import { CoinImg, Problem } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { fetchApi, post } from "@/lib/api";
import { solNum, tokN, usdK, usePoll } from "@/lib/coin";
import { ageStr, shortAddr } from "@/lib/format";
import { useTrade } from "@/lib/mode";
import { onTracker } from "@/lib/pulse";
import { useLivePrices } from '@/lib/livepx';
import { markMonitor } from '@/lib/wallet-values';
import { useNow } from "@/lib/route";
import { thumb } from "@/lib/thumb";
import { trade } from "@/lib/trade";
import { cn, store } from "@/lib/utils";
import { setTrackerDocked, setTrackerDockWidth, closeTrackerWindow, COLOR_HEX, EMOJIS, nameStyle, setQuickSol, setTab, TABS, useTracker, type Box, type MonitorWallet, type Overview, type Tab, type TTrade, type TTransfer, type TWallet } from "@/lib/wtrack";
import { Icon } from "@/shell/icons";
import { TraderPicker } from "./TraderPicker";
import { refreshTracking, saveTrackedWallet, trackerChanged, useTracking } from "@/lib/tracking";

type Grp = 0 | 1 | 2 | 3;
const GRPS: [string, string][] = [["0", "All"], ["1", "P1"], ["2", "P2"], ["3", "P3"]];
const SIZES = [0.1, 0.25, 0.5, 1];
const field = "wt-field";
const copy = (text: string, what = "Address") => { navigator.clipboard?.writeText(text); toast(`${what} copied`); };
const solscan = (sig: string) => `https://solscan.io/tx/${sig}`;

// A wallet's mark: its profile picture in a ring of its colour; without one, its emoji, else its initial on its colour.
function Mark({ w, size = 24 }: { w: { name: string; emoji: string | null; color: string | null; pic?: string | null }; size?: number }) {
  const hex = (w.color && COLOR_HEX[w.color]) || "oklch(40% 0.01 255)";
  const [dead, setDead] = useState(false);   // a picture that will not load: back to the initial
  if (w.pic && !dead) return <img src={w.pic} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setDead(true)} className="wt-mark shrink-0 rounded-full object-cover select-none" style={{ width: size, height: size, boxShadow: `0 0 0 1.5px color-mix(in srgb, ${hex} 55%, transparent)` }} aria-hidden />;
  return (
    <span className="wt-mark grid shrink-0 place-items-center rounded-full select-none" style={{ width: size, height: size, fontSize: Math.round(size * 0.55), background: `color-mix(in srgb, ${hex} 16%, var(--color-paper-3))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 40%, transparent)`, color: hex, fontWeight: 700 }} aria-hidden>
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
const Grp = ({ g }: { g: number }) => <span className="wt-group" data-group={g || 1}>P{g || 1}</span>;
const Age = ({ t }: { t: number }) => { const now = useNow(); return <span className="num text-xs whitespace-nowrap text-muted" title={new Date(t).toLocaleString()}>{ageStr(Math.max(0, now - t))}</span>; };
const Empty = ({ children }: { children: ReactNode }) => <div className="wt-empty"><span className="wt-empty-icon"><Icon.wallets /></span><div>{children}</div></div>;

// Emoji and colour pickers, shared by the add form and a row's edit.
function Pickers({ emoji, color, onEmoji, onColor }: { emoji: string | null; color: string | null; onEmoji: (e: string | null) => void; onColor: (c: string | null) => void }) {
  return <div className="wt-pickers">
    <div><span className="wt-label">Wallet color</span><div className="wt-swatches">
      <button type="button" aria-label="Default colour" aria-pressed={!color} onClick={() => onColor(null)} className="wt-swatch wt-default">A</button>
      {Object.entries(COLOR_HEX).map(([c, hex]) => <button key={c} type="button" title={c} aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => onColor(color === c ? null : c)} className="wt-swatch" style={{ background: hex }}>{color === c && <svg viewBox="0 0 16 16" aria-hidden><path d="m4 8 3 3 5-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}</button>)}
    </div></div>
    <details className="wt-emoji-picker"><summary>Wallet icon <span>{emoji || "Choose"}</span></summary><div className="wt-emojis">
      <button type="button" aria-label="No emoji" aria-pressed={!emoji} onClick={() => onEmoji(null)}>—</button>
      {EMOJIS.map(e => <button key={e} type="button" aria-pressed={emoji === e} aria-label={`Emoji ${e}`} onClick={() => onEmoji(emoji === e ? null : e)}>{e}</button>)}
    </div></details>
  </div>;
}

// ---------- Manager ----------
function Manager({ wallets, max, refresh }: { wallets: TWallet[]; max: number; refresh: () => void }) {
  const [address, setAddress] = useState(""), [name, setName] = useState(""), [emoji, setEmoji] = useState<string | null>(null), [color, setColor] = useState<string | null>(null), [grp, setGrp] = useState(1);
  const [editing, setEditing] = useState<string | null>(null), [importOpen, setImportOpen] = useState(false), [importText, setImportText] = useState(""), [busy, setBusy] = useState(false);
  const [q, setQ] = useState(""), [adding, setAdding] = useState(wallets.length === 0);
  const add = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!address.trim()) return;
    setBusy(true);
    try { await saveTrackedWallet({ address: address.trim(), name, emoji, color, grp }); setAddress(""); setName(""); setEmoji(null); setColor(null); setAdding(false); refresh(); }
    catch (err) { toast((err as Error).message); }
    setBusy(false);
  };
  const remove = async (w: TWallet) => {
    try { await saveTrackedWallet({ address: w.address }, false); refresh(); } catch (err) { toast((err as Error).message); }
  };
  const doImport = async () => {
    setBusy(true);
    try { const r = await post<{ added: number; skipped: number }>("wtrack/import", { text: importText }); toast(`${r.added} wallet${r.added === 1 ? "" : "s"} added${r.skipped ? `, ${r.skipped} skipped` : ""}`); setImportOpen(false); setImportText(""); refresh(); void refreshTracking(); trackerChanged(); }
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
      <div className="wt-manager-head"><div><b>Your wallets</b><span>{wallets.length} of {max} tracked</span></div><Button onClick={() => setTab("kols")}>Find traders</Button><Button className="wt-primary" onClick={() => setAdding(!adding)} aria-expanded={adding}>{adding ? "Close form" : "+ Add wallet"}</Button></div>
      <form onSubmit={add} className="wt-add-form" hidden={!adding}>
        <div className="wt-wallet-preview"><Mark w={{ name: name || "Wallet", emoji, color }} size={34} /><div><b style={nameStyle(color)}>{name || "Your wallet"}</b><span>Make it easy to spot in your feed</span></div><Grp g={grp} /></div>
        <div className="wt-add-fields">
          <input aria-label="Wallet address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Wallet address" spellCheck={false} className={cn(field, "flex-[2] font-outlier text-sm")} />
          <input aria-label="Wallet name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" maxLength={40} className={cn(field, "flex-1")} />
          <select value={grp} onChange={(e) => setGrp(+e.target.value)} aria-label="Group" className={cn(field, "w-16 px-1.5")}>{[1, 2, 3].map((g) => <option key={g} value={g}>P{g}</option>)}</select>
          <Button className="wt-primary" size="lg" type="submit" disabled={busy || !address.trim()}>{busy ? "Saving…" : "Track"}</Button>
        </div>
        <Pickers emoji={emoji} color={color} onEmoji={setEmoji} onColor={setColor} />
      </form>
      <div className="wt-manager-search">
        <Icon.search className="size-4 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a wallet" className={cn(field, "h-7 flex-1 text-sm")} />
        <Button size="md" onClick={() => setImportOpen(true)}>Import</Button>
        <Button size="md" onClick={doExport} disabled={!wallets.length}>Export</Button>
      </div>
      {!wallets.length ? <Empty>No wallets yet. Paste an address above, import Axiom's export, or choose from Find traders.</Empty>
        : !shown.length ? <Empty>Nothing matches.</Empty>
        : shown.map((w) => editing === w.address
          ? <EditRow key={w.address} w={w} onDone={() => { setEditing(null); refresh(); }} />
          : (
            <div key={w.address} className="wt-wallet-row">
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
                <button onClick={() => post(`wtrack/wallets/${w.address}`, { alerts: !w.alerts }).then(() => { refresh(); void refreshTracking(); trackerChanged(); }).catch(err => toast(err.message))} aria-label="Toggle alerts" aria-pressed={Boolean(w.alerts)} className={cn("wt-icon-button", w.alerts && "wt-alerts-on")}>
                  {w.alerts ? <Icon.eye className="size-3.5" /> : <Icon.eyeOff className="size-3.5" />}
                </button>
              </Tip>
              <Button size="sm" variant="ghost" onClick={() => setEditing(w.address)}>Edit</Button>
              <Tip tip="Stop tracking"><button onClick={() => remove(w)} aria-label={`Stop tracking ${w.name}`} className="wt-icon-button wt-remove">×</button></Tip>
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
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await post(`wtrack/wallets/${w.address}`, { name, emoji, color, grp }); trackerChanged(); await refreshTracking(); onDone(); } catch (err) { toast((err as Error).message); } finally { setBusy(false); } };
  return (
    <div className="wt-edit-row">
      <div className="flex flex-wrap items-center gap-1.5">
        <Mark w={{ name: name || w.name, emoji, color }} size={28} />
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Wallet name" placeholder={shortAddr(w.address)} maxLength={40} autoFocus className={cn(field, "flex-1")} />
        <select value={grp} onChange={(e) => setGrp(+e.target.value)} aria-label="Group" className={cn(field, "w-16 px-1.5")}>{[1, 2, 3].map((g) => <option key={g} value={g}>P{g}</option>)}</select>
        <Button className="wt-primary" size="lg" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button><Button size="lg" onClick={onDone} disabled={busy}>Cancel</Button>
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
    <button onClick={buy} disabled={busy} title={paper ? "Paper money" : "Real SOL"} aria-label={`Buy ${sol} SOL of ${r.symbol || "this token"}`} className="wt-quick-buy">
      <Icon.bolt className="size-3" />{sol}<SolanaLogo className="w-2.5" />
    </button>
  );
}
function Trades({ rows, sol }: { rows: TTrade[]; sol: number; compact: boolean }) {
  if (!rows.length) return <Empty><b className="wt-empty-title">Your next signal starts here</b><p>Track a wallet to see its buys and sells as they happen.</p><Button className="wt-primary mt-3" onClick={() => setTab("kols")}>Find traders to track</Button></Empty>;
  // A table, as a terminal shows a tape: coin (logo, ticker, name), trader (face, name), side, the SOL and dollars,
  // the cap it filled at, age, and the one-click buy. Rows tinted by side. (The user, 2026-10-12.)
  return <div className="wt-trades">
    <div className="wt-trade-columns"><span>Coin</span><span>Trader</span><span>Side</span><span>Amount</span><span>Market cap</span><span>Age</span><span></span></div>
    {rows.map(r => <div key={r.id} className="wt-trade-row" data-side={r.side}>
      <a href={`#/coin/${r.mint}`} className="wt-coin" title={r.tname || r.symbol || r.mint}>
        <span className="wt-coin-logo">{(r.symbol || "?").slice(0, 2)}<CoinImg mint={r.mint} /></span>
        <span className="min-w-0"><b>{r.symbol ? `$${r.symbol}` : shortAddr(r.mint)}</b>{r.tname && r.tname.toLowerCase() !== (r.symbol || "").toLowerCase() ? <small>{r.tname}</small> : null}</span>
      </a>
      <a href={`#/trader/${r.wallet}`} className="wt-trader" style={nameStyle(r.color)}><Mark w={r} size={20} /><span>{r.name}</span></a>
      <span className="wt-side" data-side={r.side}>{r.side === "buy" ? "BUY" : "SELL"}</span>
      <span className="wt-amount"><b className={r.side === "buy" ? "text-up" : "text-down"}>{r.sol != null ? solNum(r.sol) : "—"}<SolanaLogo /></b><small>{r.usd != null ? usdK(r.usd) : "—"}</small></span>
      <span className="wt-mc">{r.mc_usd ? usdK(r.mc_usd) : "—"}</span>
      <Age t={r.t} />
      <QuickBuy r={r} sol={sol} />
    </div>)}
  </div>;
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
  const prices = useLivePrices(active ? (data?.wallets || []).flatMap(w => (w.pnl.valuationPositions ?? w.pnl.positions).map(p => p.mint)) : []);
  const wallets = data?.wallets.map(w => markMonitor(w, prices, Date.now())) || [];
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
          {wallets.map((w) => (
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

// ---------- the tracker ----------
export function WalletTracker({ compact = false, right }: { compact?: boolean; right?: ReactNode }) {
  const tracking = useTracking();
  const wallets = tracking.ready ? tracking.wallets : [];
  const tracked = useMemo(() => new Map(wallets.map(w => [w.address, w])), [wallets]);
  const tab = useTracker((s) => s.tab), sol = useTracker((s) => s.sol);
  const [grp, setGrp] = useState<Grp>(0);
  const { data, error, refresh } = usePoll<Overview>("wtrack?limit=300", 20_000, true);
  useEffect(() => { const changed = () => refresh(); addEventListener("blix:tracker-change", changed); return () => removeEventListener("blix:tracker-change", changed); }, [refresh]);
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
    for (const r of [...live.trades, ...(data?.feed || [])]) if (!by.has(r.id) && !gone.has(r.id) && tracked.has(r.wallet)) by.set(r.id, { ...r, ...tracked.get(r.wallet) });
    const all = [...by.values()].sort((a, b) => b.t - a.t || b.id - a.id);
    return grp ? all.filter((r) => (r.grp || 1) === grp) : all;
  }, [live.trades, data, grp, gone, tracked]);
  const transfers = useMemo(() => {
    const by = new Map<number, TTransfer>();
    for (const r of [...live.transfers, ...(data?.transfers || [])]) if (!by.has(r.id) && tracked.has(r.wallet)) by.set(r.id, { ...r, ...tracked.get(r.wallet) });
    const all = [...by.values()].sort((a, b) => b.t - a.t || b.id - a.id);
    return grp ? all.filter((r) => (r.grp || 1) === grp) : all;
  }, [live.transfers, data, grp, tracked]);
  const s = data?.status;
  const ok = Boolean(s && (s.stream || s.live));
  const today = wallets.reduce((n, w) => n + (w.n24 || 0), 0);
  return <div className="wt-theme wt-root">
    <div className="wt-tabs" role="tablist" aria-label="Tracker">{TABS.map(([v, text]) => <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}>{text}{v === "manager" && wallets.length > 0 && <span>{wallets.length}</span>}</button>)}</div>
    <div className="wt-overview"><div><span>Tracking</span><b>{wallets.length}<small>wallets</small></b></div><div><span>Activity · 24h</span><b>{today}<small>trades</small></b></div><span className={cn("wt-live", ok ? "is-live" : "is-paused")}><i />{ok ? "Live feed" : data ? "Feed paused" : "Connecting"}</span>{right}</div>
    {(tab === "trades" || tab === "transfers") && <div className="wt-toolbar">
      <div className="wt-groups" role="radiogroup" aria-label="Group">{GRPS.map(([v, label]) => <button key={v} role="radio" aria-checked={grp === Number(v)} data-group={v} onClick={() => setGrp(Number(v) as Grp)}>{v !== "0" && <i />}{label}</button>)}</div>
      {tab === "trades" && <div className="wt-buy-size" role="radiogroup" aria-label="Quick buy amount"><Icon.bolt /><span>Buy</span>{SIZES.map(v => <button key={v} role="radio" aria-checked={sol === v} onClick={() => setQuickSol(v)}>{v}</button>)}<SolanaLogo /></div>}
    </div>}
    <div className="wt-content">
      {tab === "kols" ? <TraderPicker />
        : tracking.role === "visitor" ? <Empty><a href="#/account" className="underline">Sign in to track your favourite wallets.</a></Empty>
        : error && !data ? <div className="p-3"><Problem text={error} /><Button onClick={refresh}>Retry</Button></div>
        : !data ? <Empty>Loading wallets…</Empty>
        : tab === "manager" ? <Manager wallets={wallets} max={data.max} refresh={refresh} />
        : tab === "trades" ? <Trades rows={trades} sol={sol} compact={compact} />
        : tab === "transfers" ? <Transfers rows={transfers} />
        : <Monitor active={tab === "monitor"} />}
    </div>
    <div className="wt-footnote"><span><SolanaLogo />Solana</span><span>Wallet colors follow you across the tracker</span></div>
  </div>;
}

// The same mounted window floats or takes space beside the page; pointer capture survives undocking.
const defaultBox = (): Box => fitTrackerBox({ x: innerWidth - 656, y: 72, w: 640, h: 580 }, innerWidth, innerHeight);
export function TrackerWindow() {
  const [box, setBox] = useState<Box>(() => fitTrackerBox(store.get<Box | null>("wtrack:box", null) || defaultBox(), innerWidth, innerHeight));
  const storedDocked = useTracker(s => s.docked), storedWidth = useTracker(s => s.dockWidth), dockSide = useTracker(s => s.dockSide);
  const [wide, setWide] = useState(innerWidth >= TRACKER_DOCK_MIN_VIEWPORT);
  const [available, setAvailable] = useState(innerWidth - 64);
  const [dragging, setDragging] = useState(false), [target, setTarget] = useState<TrackerDockSide | null>(null);
  const docked = storedDocked && wide, dockWidth = fitTrackerDockWidth(storedWidth, available);
  const el = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "move" | "size" | "dock-size"; dx: number; dy: number; box: Box; docked: boolean; width: number; side: TrackerDockSide; target: TrackerDockSide | null } | null>(null);
  const motion = useRef<Animation[]>([]);
  const before = useRef<{ panel: DOMRect; page?: DOMRect } | null>(null);
  const stopMotion = () => { motion.current.forEach(a => a.cancel()); motion.current = []; };
  const captureLayout = () => {
    if (el.current) before.current = { panel: el.current.getBoundingClientRect(), page: document.querySelector("#tracker-workspace > main")?.getBoundingClientRect() };
    stopMotion();
  };
  const place = (side: TrackerDockSide | null) => { captureLayout(); setTrackerDocked(side !== null, side ?? dockSide); };
  useLayoutEffect(() => {
    const from = before.current; before.current = null;
    if (!from || !el.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animate = (node: HTMLElement, rect: DOMRect) => {
      const next = node.getBoundingClientRect();
      if (!next.width || !next.height) return;
      motion.current.push(node.animate([
        { transform: `translate(${rect.left - next.left}px, ${rect.top - next.top}px) scale(${rect.width / next.width}, ${rect.height / next.height})`, transformOrigin: "0 0" },
        { transform: "none", transformOrigin: "0 0" },
      ], { duration: 300, easing: "cubic-bezier(.22, 1, .36, 1)" }));
    };
    animate(el.current, from.panel);
    const page = document.querySelector<HTMLElement>("#tracker-workspace > main");
    if (page && from.page) animate(page, from.page);
  }, [docked, dockSide, dockWidth]);
  const clamp = (b: Box) => fitTrackerBox(b, innerWidth, innerHeight);
  const save = (b: Box) => { const fitted = clamp(b); setBox(fitted); store.set("wtrack:box", fitted); };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    el.current?.focus({ preventScroll: true });
    const workspace = document.getElementById("tracker-workspace");
    const fit = () => {
      setBox(b => fitTrackerBox(b, innerWidth, innerHeight));
      setWide(innerWidth >= TRACKER_DOCK_MIN_VIEWPORT);
      setAvailable(workspace?.clientWidth || innerWidth - 64);
    };
    const observer = new ResizeObserver(fit); if (workspace) observer.observe(workspace);
    fit(); addEventListener("resize", fit);
    return () => { stopMotion(); observer.disconnect(); removeEventListener("resize", fit); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const down = (kind: "move" | "size" | "dock-size") => (e: PE<HTMLElement>) => {
    if (e.button !== 0) return;
    stopMotion();
    drag.current = { kind, dx: e.clientX, dy: e.clientY, box, docked, width: dockWidth, side: dockSide, target: null };
    e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault();
  };
  const move = (e: PE<HTMLElement>) => {
    const d = drag.current; if (!d) return;
    let dx = e.clientX - d.dx, dy = e.clientY - d.dy;
    if (d.kind === "dock-size") { setTrackerDockWidth(fitTrackerDockWidth(d.width + (d.side === "left" ? dx : -dx), available)); return; }
    if (d.kind === "move") {
      if (!dragging && Math.hypot(dx, dy) < 5) return;
      if (d.docked) {
        const rect = el.current!.getBoundingClientRect();
        d.box = clamp({ ...box, x: e.clientX - Math.min(d.dx - rect.left, box.w - 40), y: e.clientY - (d.dy - rect.top) });
        d.dx = e.clientX; d.dy = e.clientY; dx = 0; dy = 0; d.docked = false;
        setTrackerDocked(false);
      }
      setDragging(true); d.target = trackerDockTarget(e.clientX, innerWidth, document.getElementById("tracker-workspace")?.getBoundingClientRect().left); setTarget(d.target);
    }
    setBox(clamp(d.kind === "move" ? { ...d.box, x: d.box.x + dx, y: d.box.y + dy } : { ...d.box, w: d.box.w + dx, h: d.box.h + dy }));
  };
  const end = (cancel = false) => {
    const d = drag.current; if (!d) return;
    drag.current = null; setDragging(false); setTarget(null);
    if (!cancel && d.kind === "move" && d.target) place(d.target);
    setBox(b => { store.set("wtrack:box", b); return b; });
  };
  const keyboard = (e: React.KeyboardEvent, resize = false) => {
    const n = e.shiftKey ? 40 : 10, dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0, dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    if (docked && resize) { captureLayout(); setTrackerDockWidth(fitTrackerDockWidth(dockWidth + (dockSide === "left" ? dx : -dx), available)); return; }
    if (docked) place(null);
    save(resize ? { ...box, w: box.w + dx, h: box.h + dy } : { ...box, x: box.x + dx, y: box.y + dy });
  };
  return <>
    {dragging && wide && (["left", "right"] as const).map(side => <div key={side} data-side={side} className={`wt-dock-target ${target === side ? "is-active" : ""}`} style={{ width: target === side ? dockWidth : 72 }} aria-hidden><span>{target === side ? "Release to dock" : `Dock ${side}`}</span></div>)}
    <span className="wt-announcement" role="status" aria-live="polite">{target ? `Release to dock on ${target}` : docked ? `Wallet tracker docked on ${dockSide}` : ""}</span>
    <div ref={el} id="wallet-tracker-window" role="dialog" aria-label="Wallet tracker" aria-modal="false" tabIndex={-1} data-docked={docked} data-side={dockSide} data-dragging={dragging}
      onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); closeTrackerWindow(); } }}
      style={docked ? { width: dockWidth } : { left: box.x, top: box.y, width: box.w, height: box.h }}
      className={`wt-theme wt-window ${docked ? "wt-docked relative" : "fixed"} z-40 flex flex-col outline-none`}>
      <div className="wt-window-header">
        <button aria-label="Move wallet tracker" title={docked ? "Drag away to undock" : "Drag to either edge to dock. Arrow keys move the window."} onPointerDown={down("move")} onPointerMove={move} onPointerUp={() => end()} onPointerCancel={() => end(true)} onLostPointerCapture={() => end(true)} onKeyDown={e => keyboard(e)}
          className="wt-drag-handle">
          <svg className="wt-grip" viewBox="0 0 12 20" aria-hidden>{[4,10,16].map(y => <g key={y}><circle cx="3" cy={y} r="1" /><circle cx="9" cy={y} r="1" /></g>)}</svg><span className="wt-header-icon"><Icon.wallets /></span><b>Wallet tracker</b><span className="wt-drag-hint">{docked ? "Drag to detach" : "Drag to dock"}</span>
        </button>
        {wide && (["left", "right"] as const).map(side => <button key={side} onClick={() => place(docked && dockSide === side ? null : side)} aria-label={docked && dockSide === side ? "Undock wallet tracker" : `Dock wallet tracker on ${side}`} aria-pressed={docked && dockSide === side} title={docked && dockSide === side ? "Float window" : `Dock on ${side}`} className={`wt-icon-button ${docked && dockSide === side ? "wt-alerts-on" : ""}`}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="16" height="14" rx="2" /><path d={side === "left" ? "M8 3v14" : "M12 3v14"} /><path d={side === "left" ? "M12 7l-3 3 3 3" : "M8 7l3 3-3 3"} /></svg></button>)}
        <button onClick={() => { place(null); save(defaultBox()); }} aria-label="Reset tracker position" title="Reset size and position" className="wt-icon-button"><Icon.refresh className="size-3.5" /></button>
        <a href="#/tracker" onClick={closeTrackerWindow} aria-label="Open the tracker page" title="Open full page" className="wt-icon-button"><Icon.link className="size-3.5" /></a>
        <button onClick={closeTrackerWindow} aria-label="Close wallet tracker" className="wt-icon-button"><Icon.close className="size-3.5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden"><WalletTracker compact /></div>
      <button onPointerDown={down(docked ? "dock-size" : "size")} onPointerMove={move} onPointerUp={() => end()} onPointerCancel={() => end(true)} onLostPointerCapture={() => end(true)} onKeyDown={e => keyboard(e, true)} aria-label="Resize wallet tracker" title={docked ? "Drag divider to resize, or use left/right arrow keys" : "Drag to resize, or use arrow keys"}
        className={docked ? "wt-dock-resize" : "wt-resize"}>{!docked && <svg viewBox="0 0 16 16" className="size-4"><path d="M15 9v6H9M15 13v2h-2" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>}</button>
    </div>
  </>;
}
