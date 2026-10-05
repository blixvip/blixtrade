// Portfolio (#/account): sign in with Google, then your wallet as a trader sees it: balance, profit and
// loss, open positions with quick sells, and history. Deposits, withdrawals, buying by contract and the
// key export open as small windows. Real money. Talks to /api/account/* (server/accounts.js).
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { openExchange } from "@/components/Exchange";
import { CoinImg } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import { usePulse } from "@/lib/pulse";
import { useRouteArg } from "@/lib/route";
import { loadMe } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Sol } from "@/shell/Rail";
import { MyProfile } from "./profile/parts";

interface Token { mint: string; ui: number; usd: number | null }
interface Wallet { sol: number; solUsd: number; tokensUsd: number; tokens: Token[] }
interface Me { signedIn: boolean; google?: boolean; email?: string; name?: string | null; picture?: string | null; address?: string; wallet?: Wallet | null; problem?: string | null }
interface Tx { t: number; kind: string; sol: number | null; mint: string | null; dest: string | null; sig: string | null; status: string }
class AccountError extends Error { confirm = false; missing = false }

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/account/${path}`, body === undefined ? { signal: AbortSignal.timeout(30_000) }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw Object.assign(new AccountError(j.error || String(r.status)), { confirm: Boolean(j.confirm), missing: r.status === 404 });
  return j as T;
}

const sol = (n: number, d = 4) => (+n || 0).toLocaleString(undefined, { maximumFractionDigits: d });
const usd = (n: number | null | undefined) => n == null ? "—" : `$${(+n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const signed = (n: number, d = 4) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${sol(Math.abs(n), d)}`;
const toneOf = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-ink-2");

// Google's "G" in its own four colours: a brand mark, not interface colour.
const GoogleG = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="size-4.5">
    <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.600-.2-2.300H12v4.400h6.200c-.3 1.400-1.100 2.600-2.300 3.400v2.900h3.700c2.200-2 3.400-5 3.400-8.400z" />
    <path fill="#34A853" d="M12 23.500c3.100 0 5.700-1 7.600-2.800l-3.700-2.900c-1 .7-2.300 1.100-3.900 1.100-3 0-5.500-2-6.400-4.700H1.800v3C3.700 21 7.500 23.500 12 23.500z" />
    <path fill="#FBBC05" d="M5.600 14.200c-.2-.7-.4-1.400-.4-2.200s.1-1.500.4-2.200v-3H1.800C1 8.400.5 10.100.5 12s.5 3.600 1.300 5.200l3.800-3z" />
    <path fill="#EA4335" d="M12 5.100c1.700 0 3.200.6 4.400 1.700l3.300-3.300C17.700 1.600 15.100.5 12 .5 7.500.5 3.700 3 1.800 6.800l3.800 3c.9-2.700 3.400-4.700 6.400-4.700z" />
  </svg>
);

const panel = "rounded-card border border-rule bg-paper-2";
const Field = ({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
  <label className="flex flex-col gap-1.5"><span className="label">{label}</span>
    <input {...props} className={cn("h-9 min-w-0 rounded-control border border-rule-2 bg-paper px-3 text-md outline-none focus:border-accent-dim", props.className)} /></label>
);
const Stat = ({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-1"><span className="text-sm text-muted">{label}</span><b className="num text-xl font-semibold whitespace-nowrap">{children}</b>{sub && <span className="num text-sm text-muted">{sub}</span>}</div>
);
const th = "px-4 py-2.5 text-left text-sm font-medium text-muted whitespace-nowrap", td = "border-t border-rule px-4 py-2.5 whitespace-nowrap";

// Names for the coins a wallet holds: from the live Pulse data when the coin is there, else asked once.
function useNames(mints: string[]) {
  const [names, setNames] = useState<Record<string, { symbol?: string; name?: string }>>({});
  const key = mints.join(",");
  useEffect(() => {
    for (const mint of mints) {
      if (names[mint]) continue;
      const live = usePulse.getState().coins[mint];
      if (live?.symbol) { setNames((n) => ({ ...n, [mint]: { symbol: live.symbol, name: live.name } })); continue; }
      api<{ token?: { symbol?: string; name?: string } }>(`token/${mint}`).then((r) => setNames((n) => ({ ...n, [mint]: { symbol: r.token?.symbol, name: r.token?.name } }))).catch(() => setNames((n) => ({ ...n, [mint]: {} })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return names;
}

function CoinCell({ mint, name }: { mint: string; name?: { symbol?: string; name?: string } }) {
  return (
    <a href={`#/coin/${mint}`} className="flex items-center gap-2.5 hover:text-ink">
      <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-chip bg-paper-4 text-2xs font-semibold text-muted uppercase">
        {(name?.symbol || "?").slice(0, 3)}
        <CoinImg mint={mint} />
      </span>
      <span className="flex min-w-0 flex-col"><b className="truncate font-semibold text-ink">{name?.symbol || shortAddr(mint)}</b><span className="text-xs text-muted">{shortAddr(mint)}</span></span>
    </a>
  );
}

type Tab = "positions" | "history";
type Open = null | "withdraw" | "buy" | "export";

export function Account() {
  const [me, setMe] = useState<Me | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [off, setOff] = useState<string | null>(null);     // the account service is not switched on / not reachable
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("positions");
  const [open, setOpen] = useState<Open>(null);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const failed = useRouteArg() === "e" ? decodeURIComponent(location.hash.split("/")[3] || "") : null;   // #/account/e/<why>

  const load = useCallback(async () => {
    try {
      const m = await call<Me>("me");
      setMe(m); setOff(null); loadMe();
      setTxs(m.signedIn ? await call<Tx[]>("txs").catch(() => []) : []);
    } catch (e) { setOff((e as AccountError).missing ? "Accounts are not switched on yet." : (e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const w = me?.wallet, solPrice = w && w.sol > 0 ? w.solUsd / w.sol : usePulse.getState().live.solUsd || 0;
  const names = useNames(useMemo(() => (w?.tokens || []).map((t) => t.mint), [w]));
  // What each coin cost and returned, from the wallet's own confirmed trades.
  const book = useMemo(() => {
    const by: Record<string, { bought: number; sold: number }> = {};
    let bought = 0, sold = 0, n = 0;
    for (const t of txs) {
      if (t.status !== "confirmed" || !t.mint || t.sol == null || !["buy", "sell"].includes(t.kind)) continue;
      const b = (by[t.mint] ??= { bought: 0, sold: 0 });
      if (t.kind === "buy") { b.bought += t.sol; bought += t.sol; } else { b.sold += t.sol; sold += t.sol; }
      n++;
    }
    return { by, bought, sold, n };
  }, [txs]);
  const heldSol = w && solPrice ? w.tokensUsd / solPrice : 0;
  const pnl = book.sold + heldSol - book.bought;

  const oops = (e: unknown) => { if ((e as AccountError).confirm) { setOpen(null); setConfirmAgain(true); } else toast((e as Error).message); };
  // A real transaction: say what happened, then read the wallet again.
  const act = async (kind: string, path: string, body: unknown, done: string) => {
    setBusy(kind);
    try { const r = await call<{ status: string; note?: string }>(path, body); toast(`${done} · ${r.status}${r.note ? ` (${r.note})` : ""}`); setOpen(null); } catch (e) { oops(e); }
    setBusy(null);
    load();
  };
  const form = (fn: (f: Record<string, string>) => void) => (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); fn(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>); };

  if (off) return <div className="mx-auto max-w-md p-6"><div className={cn(panel, "p-5 text-ink-2")}>{off}</div></div>;
  if (!me) return <div className="p-3"><div className={cn(panel, "h-24 animate-pulse")} /></div>;

  if (!me.signedIn) return (
    <div className="grid h-full place-items-center p-4">
      <div className={cn(panel, "flex w-full max-w-sm flex-col items-center gap-4 p-7 text-center shadow-sheet")}>
        <img src="/brand/blix-chrome.png" alt="Blix" className="h-14 w-auto mix-blend-screen" />
        <div><h1 className="text-xl font-semibold">Sign in to trade</h1><p className="mt-1.5 text-md text-muted">Your first sign-in creates your Solana wallet.</p></div>
        {me.google
          ? <a href="/api/account/google" className="flex h-11 w-full items-center justify-center gap-2.5 rounded-full bg-ink text-lg font-semibold text-on-fill transition-transform duration-100 hover:bg-focus active:scale-[0.98]"><GoogleG />Continue with Google</a>
          : <p className="text-ink-2">Google sign-in is not set up yet.</p>}
        {failed && <p className="text-md text-down">{failed}</p>}
        <p className="text-sm text-muted">Blix holds the wallet's key. You can export it at any time.</p>
      </div>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 p-3 max-md:pb-6">
      <MyProfile actions={<>
        <button onClick={() => openExchange("deposit")} className="flex h-8 items-center rounded-full bg-ink px-4 text-md font-semibold text-on-fill transition-transform duration-100 hover:bg-focus active:scale-[0.97]">Deposit</button>
        <Button size="lg" className="rounded-full" onClick={() => setOpen("withdraw")}><Icon.send />Withdraw</Button>
        <Button size="lg" className="rounded-full" onClick={() => setOpen("buy")}><Icon.bolt />Buy</Button>
        <Button size="lg" variant="ghost" className="rounded-full" onClick={load} aria-label="Refresh"><Icon.refresh /></Button>
        <Button size="lg" variant="ghost" className="rounded-full" onClick={async () => { await call("logout", {}); load(); }}>Sign out</Button>
      </>} />

      {me.problem && <p className="rounded-control border border-warn/40 bg-warn/10 px-3 py-2 text-md text-ink-2"><b className="text-ink">The wallet service did not answer.</b> {me.problem}</p>}
      {confirmAgain && <p className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-rule-2 bg-paper-3 px-3 py-2 text-md text-ink-2">
        <span><b className="text-ink">Confirm it is you.</b> Withdrawing or showing your key needs a Google sign-in from the last ten minutes.</span>
        <Button asChild><a href="/api/account/google?confirm=1"><GoogleG />Sign in again</a></Button></p>}

      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-3 max-lg:grid-cols-[minmax(0,1fr)]">
        <section className={cn(panel, "flex flex-col gap-4 p-4")}>
          <h2 className="text-md font-semibold text-ink-2">Balance</h2>
          <div><span className="text-sm text-muted">Total value</span><b className="num block text-[2rem] leading-tight font-semibold">{usd(w ? w.solUsd + w.tokensUsd : null)}</b></div>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Available" sub={w ? usd(w.solUsd) : undefined}><span className="flex items-center gap-1.5"><Sol className="size-4 text-ink-2" />{w ? sol(w.sol) : "—"}</span></Stat>
            <Stat label="In coins" sub={w ? `${w.tokens.length} held` : undefined}>{w ? usd(w.tokensUsd) : "—"}</Stat>
          </div>
        </section>
        <section className={cn(panel, "flex flex-col gap-4 p-4")}>
          <h2 className="text-md font-semibold text-ink-2">Profit and loss</h2>
          <div><span className="text-sm text-muted">All trades, in SOL</span>
            <b className={cn("num flex items-center gap-2 text-[2rem] leading-tight font-semibold", book.n ? toneOf(pnl) : "text-ink-2")}><Sol className="size-5" />{book.n ? signed(pnl, 3) : "0"}</b></div>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Bought"><span className="flex items-center gap-1.5"><Sol className="size-4 text-ink-2" />{sol(book.bought, 3)}</span></Stat>
            <Stat label="Sold"><span className="flex items-center gap-1.5"><Sol className="size-4 text-ink-2" />{sol(book.sold, 3)}</span></Stat>
          </div>
        </section>
        <section className={cn(panel, "flex flex-col gap-4 p-4")}>
          <h2 className="text-md font-semibold text-ink-2">Wallet</h2>
          <div><span className="text-sm text-muted">Deposit address · Solana</span><p className="mt-1 font-outlier text-md break-all text-ink">{me.address}</p></div>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button onClick={() => { navigator.clipboard?.writeText(me.address!); toast("Address copied"); }}><Icon.copy />Copy</Button>
            <Button asChild><a href={`https://solscan.io/account/${me.address}`} target="_blank" rel="noreferrer"><Icon.link />Solscan</a></Button>
            <Button onClick={() => { setSecret(null); setOpen("export"); }}><Icon.key />Export key</Button>
          </div>
        </section>
      </div>

      <section className={cn(panel, "overflow-hidden")}>
        <header className="flex h-12 items-center gap-3 border-b border-rule px-4">
          <Segmented value={tab} options={[["positions", `Active positions${w?.tokens.length ? ` · ${w.tokens.length}` : ""}`], ["history", `History${txs.length ? ` · ${txs.length}` : ""}`]]} onChange={setTab} label="Positions or history" />
        </header>
        <div className="overflow-x-auto">
          {tab === "positions" ? (
            <table className="w-full text-md"><thead><tr><th className={th}>Token</th><th className={th}>Bought</th><th className={th}>Sold</th><th className={th}>Remaining</th><th className={th}>PnL</th><th className={cn(th, "text-right")}>Sell</th></tr></thead><tbody>
              {w?.tokens.length ? w.tokens.map((t) => {
                const b = book.by[t.mint] || { bought: 0, sold: 0 }, worth = t.usd != null && solPrice ? t.usd / solPrice : 0, p = b.sold + worth - b.bought;
                return (
                  <tr key={t.mint} className="hover:bg-paper-3/60"><td className={td}><CoinCell mint={t.mint} name={names[t.mint]} /></td>
                    <td className={cn(td, "num")}>{b.bought ? sol(b.bought, 3) : "—"}</td><td className={cn(td, "num")}>{b.sold ? sol(b.sold, 3) : "—"}</td>
                    <td className={cn(td, "num")}><b className="font-semibold">{usd(t.usd)}</b><span className="ml-2 text-muted">{(+t.ui).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></td>
                    <td className={cn(td, "num font-semibold", b.bought ? toneOf(p) : "text-muted")}>{b.bought ? `${signed(p, 3)} (${b.bought ? `${p >= 0 ? "+" : "−"}${Math.abs((p / b.bought) * 100).toFixed(0)}%` : ""})` : "—"}</td>
                    <td className={td}><span className="flex justify-end gap-1.5">{[25, 50, 100].map((pc) => (
                      <button key={pc} disabled={!!busy} onClick={() => confirm(`Sell ${pc}% of ${names[t.mint]?.symbol || shortAddr(t.mint)} for SOL?`) && act("sell", "sell", { mint: t.mint, pct: pc }, "Sell sent")}
                        className="num h-7 rounded-full border border-rule-2 px-2.5 text-sm font-semibold text-down transition-colors duration-100 hover:border-down hover:bg-down hover:text-on-fill disabled:opacity-50">{pc}%</button>))}</span></td></tr>);
              }) : <tr><td colSpan={6} className="border-t border-rule px-4 py-12 text-center text-muted">No open positions. Deposit SOL, then buy from Pulse or with the Buy button.</td></tr>}
            </tbody></table>
          ) : (
            <table className="w-full text-md"><thead><tr>{["Time", "Type", "Token", "SOL", "Transaction", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead><tbody>
              {txs.length ? txs.map((t, i) => (
                <tr key={i} className="hover:bg-paper-3/60"><td className={cn(td, "text-muted")}>{when(t.t)}</td>
                  <td className={cn(td, "font-semibold capitalize", t.kind === "buy" ? "text-up" : t.kind === "sell" ? "text-down" : "text-ink")}>{t.kind}</td>
                  <td className={td}>{t.mint ? <a href={`#/coin/${t.mint}`} className="hover:text-ink">{names[t.mint]?.symbol || shortAddr(t.mint)}</a> : t.dest ? <span className="text-muted">to {shortAddr(t.dest)}</span> : "—"}</td>
                  <td className={cn(td, "num")}>{t.sol != null ? sol(t.sol) : "—"}</td>
                  <td className={td}>{t.sig ? <a href={`https://solscan.io/tx/${t.sig}`} target="_blank" rel="noreferrer" className="text-ink-2 underline decoration-rule-2 underline-offset-2 hover:text-ink">{shortAddr(t.sig)}</a> : "—"}</td>
                  <td className={cn(td, "capitalize", t.status === "confirmed" ? "text-up" : t.status === "failed" ? "text-down" : "text-warn")}>{t.status}</td></tr>))
                : <tr><td colSpan={6} className="border-t border-rule px-4 py-12 text-center text-muted">No trades yet.</td></tr>}
            </tbody></table>
          )}
        </div>
      </section>

      <Dialog open={open === "withdraw"} onOpenChange={(o) => setOpen(o ? "withdraw" : null)} title="Withdraw SOL">
        <form className="flex flex-col gap-3.5" onSubmit={form((f) => confirm(`Send ${f.sol} SOL to\n${f.to}?\n\nThis cannot be undone.`) && act("withdraw", "withdraw", { to: f.to.trim(), sol: +f.sol }, "Withdrawal sent"))}>
          <Field label="To address" name="to" required pattern="[1-9A-HJ-NP-Za-km-z]{32,44}" className="font-outlier" />
          <Field label={`Amount in SOL${w ? ` · ${sol(w.sol)} available` : ""}`} name="sol" inputMode="decimal" required />
          <button disabled={!!busy} className="flex h-10 items-center justify-center rounded-full bg-ink text-md font-semibold text-on-fill hover:bg-focus disabled:opacity-50">{busy === "withdraw" ? "Sending…" : "Withdraw"}</button>
        </form>
      </Dialog>

      <Dialog open={open === "buy"} onOpenChange={(o) => setOpen(o ? "buy" : null)} title="Buy a coin">
        <form className="flex flex-col gap-3.5" onSubmit={form((f) => act("buy", "buy", { mint: f.mint.trim(), sol: +f.sol }, "Buy sent"))}>
          <Field label="Contract address" name="mint" required pattern="[1-9A-HJ-NP-Za-km-z]{32,44}" placeholder="…pump" className="font-outlier" />
          <Field label={`SOL to spend${w ? ` · ${sol(w.sol)} available` : ""}`} name="sol" inputMode="decimal" defaultValue="0.05" required />
          <button disabled={!!busy} className="flex h-10 items-center justify-center gap-2 rounded-full bg-up text-md font-bold text-on-fill hover:brightness-110 disabled:opacity-50 [&_svg]:size-4 [&_svg]:fill-current"><Icon.bolt />{busy === "buy" ? "Buying…" : "Buy with real SOL"}</button>
        </form>
      </Dialog>

      <Dialog open={open === "export"} onOpenChange={(o) => { setOpen(o ? "export" : null); if (!o) setSecret(null); }} title="Export your key">
        <p className="text-md text-ink-2">This is the wallet's secret key, for importing into Phantom. Anyone who sees it can take everything in the wallet.</p>
        {secret ? <p className="rounded-control border border-rule-2 bg-paper p-3 font-outlier text-sm break-all select-all">{secret}</p>
          : <button onClick={async () => { try { setSecret((await call<{ secretKey: string }>("export", {})).secretKey); } catch (e) { oops(e); } }}
              className="flex h-10 items-center justify-center gap-2 rounded-full border border-down/60 text-md font-semibold text-down hover:bg-down hover:text-on-fill [&_svg]:size-4"><Icon.key />Show my secret key</button>}
      </Dialog>
    </div>
  );
}
