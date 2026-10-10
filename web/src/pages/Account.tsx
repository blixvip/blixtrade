// Portfolio (#/account): sign in with Google, then your wallet as a trader sees it: balance, profit and
// loss, open positions with quick sells, and history. Deposits, withdrawals, buying by contract and the
// key export open as small windows. Real money. Talks to /api/account/* (server/accounts.js).
import { SiteLogo } from "@/components/logos";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { openExchange, openWelcome } from "@/lib/modals";
import { CoinImg, EmptyState, needsSignIn, SignInCard } from "@/components/page";
import { AccountAvatar } from "@/components/AccountAvatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import { usePulse } from "@/lib/pulse";
import { useRouteArg } from "@/lib/route";
import { useMe } from "@/lib/ui";
import { setPaper, useTrade } from "@/lib/mode";
import { walletAction } from "@/lib/wallet-action";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Sol } from "@/shell/Rail";
import { MyProfile } from "./profile/parts";
import { ShareLink } from "@/components/ShareLink";
import { takeWithdraw, WITHDRAW_EVENT } from "@/components/WalletMenu";

interface Token { mint: string; ui: number; usd: number | null }
interface Wallet { sol: number; solUsd: number; tokensUsd: number; tokens: Token[] }
interface Me { signedIn: boolean; google?: boolean; email?: string; name?: string | null; picture?: string | null; address?: string; wallet?: Wallet | null; problem?: string | null; needsWallet?: boolean; hosted?: boolean }
interface Tx { t: number; kind: string; sol: number | null; mint: string | null; dest: string | null; sig: string | null; status: string }
class AccountError extends Error { confirm = false; missing = false }

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`api/account/${path}`, body === undefined ? { signal: AbortSignal.timeout(30_000) }
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
// Log out of everything: the wallet session here, then (on blixvip.com) the site session at the edge
// (/logout clears blix_wait, blix_m and blix_wallet and lands on the home page).
async function logOut(reload: () => void) {
  // The wallet session ends at the server; never let a slow answer hold the site log-out up.
  await Promise.race([call("logout", {}).catch(() => {}), new Promise((r) => setTimeout(r, 2500))]);
  if (location.hostname.endsWith("blixvip.com")) location.replace("https://blixvip.com/logout"); else reload();
}

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

function WalletSetup({ onCreated }: { onCreated: (address: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pending = useRef<Promise<{ address: string }> | null>(null);
  useEffect(() => {
    let active = true;
    // Reuse the request if React replays this effect. The server also deduplicates setup.
    pending.current ??= call<{ address: string }>("setup", {});
    const pause = new Promise(resolve => setTimeout(resolve, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1400));
    Promise.all([pending.current, pause]).then(([result]) => {
      if (active) onCreated(result.address);
    }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [attempt, onCreated]);
  return (
    <div className="grid min-h-96 place-items-center p-4">
      <section className={cn(panel, "flex w-full max-w-sm flex-col items-center gap-5 p-7 text-center")} aria-busy={!error}>
        <div aria-hidden className="relative grid size-20 place-items-center">
          <span className={cn("absolute inset-0 rounded-full border-2 border-rule-2", !error && "border-t-ink motion-safe:animate-spin")} />
          <Icon.wallets className={cn("size-8 text-ink", !error && "motion-safe:animate-pulse")} />
        </div>
        <div role={error ? "alert" : "status"}>
          <h1 className="text-xl font-semibold">{error ? "Wallet creation paused" : "Creating your wallet"}</h1>
          <p className="mt-2 text-md text-muted">{error || "Setting up your Solana address. You’ll be ready to fund it in a moment."}</p>
        </div>
        {error && <Button onClick={() => { pending.current = null; setError(null); setAttempt(n => n + 1); }}>Try again</Button>}
      </section>
    </div>
  );
}

export function Account() {
  const [me, setMe] = useState<Me | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [off, setOff] = useState<string | null>(null);     // the account service is not switched on / not reachable
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("positions");
  const [open, setOpen] = useState<Open>(null);
  // Withdraw pressed in the top bar's wallet panel (components/WalletMenu.tsx).
  useEffect(() => { if (takeWithdraw()) setOpen("withdraw"); const ask = () => { if (takeWithdraw()) setOpen("withdraw"); }; window.addEventListener(WITHDRAW_EVENT, ask); return () => window.removeEventListener(WITHDRAW_EVENT, ask); }, []);
  const [confirmAgain, setConfirmAgain] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState(false);
  const paperOn = useTrade(s => s.paper);
  const loading = useRef(false), actionPending = useRef(false);
  const failed = useRouteArg() === "e" ? decodeURIComponent(location.hash.split("/")[3] || "") : null;   // #/account/e/<why>

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const m = await call<Me>("me");
      setMe(m); setOff(null); useMe.setState({ me: m });
      if (!m.signedIn || (m.wallet?.sol || 0) > 0) setJustCreated(false);
      setTxs(m.signedIn && !m.needsWallet ? await call<Tx[]>("txs").catch(() => []) : []);
    } catch (e) { setOff((e as AccountError).missing ? "Accounts are not switched on yet." : (e as Error).message); }
    finally { loading.current = false; }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!me?.signedIn || !me.address) return;
    const refresh = () => { if (!document.hidden) load(); };
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("blix:wallet-changed", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("blix:wallet-changed", refresh); };
  }, [me?.signedIn, me?.address, load]);
  const onCreated = useCallback((address: string) => {
    setMe(current => current ? { ...current, address, needsWallet: false } : current);
    setJustCreated(true);
    openWelcome();
    load();
  }, [load]);

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
  const act = async (kind: string, path: "buy" | "sell" | "withdraw", body: unknown, done: string) => {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(kind);
    try {
      const label = done.replace(/ sent$/, "");
      if (await walletAction(path, body, { pending: `${label} in progress`, confirmed: `${label} confirmed`, failed: `${label} failed`, onReauth: () => { setOpen(null); setConfirmAgain(true); } })) setOpen(null);
    } finally { actionPending.current = false; setBusy(null); }
  };
  const form = (fn: (f: Record<string, string>) => void) => (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); fn(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>); };

  if (off && !me && needsSignIn(off)) return <div className="grid h-full place-items-center"><SignInCard onRetry={load} /></div>;
  if (off && !me) return <div className="grid h-full place-items-center p-4"><div className={cn(panel, "w-full max-w-sm shadow-sheet")}><EmptyState icon="eye" title="Couldn’t reach your account" hint={off} action={{ label: "Try again", onClick: load }} /></div></div>;
  if (!me) return <div className="p-3"><div className={cn(panel, "h-24 animate-pulse")} /></div>;

  if (!me.signedIn) return (
    <div className="grid h-full place-items-center p-4">
      <div className={cn(panel, "flex w-full max-w-sm flex-col items-center gap-4 p-7 text-center shadow-sheet")}>
        <img src="brand/blix-chrome.webp" alt="Blix" className="h-14 w-auto mix-blend-screen" />
        <div><h1 className="text-xl font-semibold">Sign in to trade</h1><p className="mt-1.5 text-md text-muted">Your first sign-in creates your Solana wallet.</p></div>
        {me.google
          ? <a href="api/account/google" className="flex h-11 w-full items-center justify-center gap-2.5 rounded-full bg-ink text-lg font-semibold text-on-fill transition-transform duration-100 hover:bg-focus active:scale-[0.98]"><GoogleG />Continue with Google</a>
          : <p className="text-ink-2">Google sign-in is not set up yet.</p>}
        {failed && <p className="text-md text-down">{failed}</p>}
        {location.hostname.endsWith("blixvip.com") && <a href="/logout" className="text-md text-muted underline decoration-rule-2 underline-offset-2 hover:text-ink">Log out of Blix</a>}
      </div>
    </div>
  );

  if (me.needsWallet) return <WalletSetup key={me.email} onCreated={onCreated} />;

  const total = w ? w.solUsd + w.tokensUsd : null, empty = Boolean(justCreated || (w && w.sol === 0 && w.tokens.length === 0));
  const accountActions = <>
    <button onClick={() => openExchange("deposit")} className="flex h-9 items-center rounded-full bg-ink px-5 text-md font-semibold text-on-fill transition-transform duration-100 hover:bg-focus active:scale-[0.97]">Deposit</button>
    <Button size="lg" className="h-9 rounded-full px-4" onClick={() => setOpen("withdraw")}><Icon.send />Withdraw</Button>
    <Button size="lg" className="h-9 rounded-full px-4" onClick={() => setOpen("buy")}><Icon.bolt />Buy</Button>
    <Button size="lg" variant="ghost" className="size-9 rounded-full p-0" onClick={load} aria-label="Refresh" title="Refresh"><Icon.refresh /></Button>
  </>;
  const Fig = ({ label, children, sub, cls }: { label: string; children: ReactNode; sub?: ReactNode; cls?: string }) => (
    <div className="flex min-w-0 flex-col gap-1 border-rule px-5 py-4 max-sm:px-4 [&:not(:first-child)]:border-l max-md:[&:nth-child(3)]:border-l-0">
      <span className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">{label}</span>
      <b className={cn("num flex items-center gap-1.5 truncate text-xl leading-tight font-semibold text-ink", cls)}>{children}</b>
      {sub && <span className="num truncate text-xs text-muted">{sub}</span>}
    </div>
  );
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 p-4 max-md:p-3 max-md:pb-6">
      {off && <p role="alert" className="rounded-control border border-warn/40 px-3 py-2 text-md text-ink-2">Couldn’t refresh your wallet. Showing the last balance. {off}</p>}

      {/* Who you are, what you can do, and what your wallet holds: one card. */}
      {me.hosted ? (
        <section className={cn(panel, "overflow-hidden")}>
          <div className="flex flex-wrap items-center justify-between gap-4 px-5 pt-5 pb-4 max-sm:px-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <AccountAvatar me={me} className="size-12" />
              <div className="min-w-0"><h1 className="truncate text-xl leading-tight font-semibold">{me.name || "Your wallet"}</h1><p className="mt-0.5 truncate text-md text-muted">{me.email}</p></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">{accountActions}</div>
          </div>
          <div className="grid grid-cols-4 border-t border-rule max-md:grid-cols-2">
            <Fig label="Total value" sub={w ? `${w.tokens.length} coin${w.tokens.length === 1 ? "" : "s"} held` : undefined}>{usd(total)}</Fig>
            <Fig label="Available" sub={w ? usd(w.solUsd) : undefined}><Sol className="size-4 text-ink-2" />{w ? sol(w.sol) : "—"}</Fig>
            <Fig label="In coins" sub={w && solPrice ? `≈ ${sol(heldSol, 3)} SOL` : undefined}>{w ? usd(w.tokensUsd) : "—"}</Fig>
            <Fig label="Profit & loss" cls={book.n ? toneOf(pnl) : "text-ink-2"} sub={book.n ? `${sol(book.bought, 3)} bought · ${sol(book.sold, 3)} sold` : "no trades yet"}><Sol className="size-4" />{book.n ? signed(pnl, 3) : "0"}</Fig>
          </div>
          {empty && (
            <div role="status" className="flex flex-wrap items-center gap-3 border-t border-rule bg-up/[0.05] px-5 py-3 max-sm:px-4">
              <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-up/15 text-up"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="size-3.5"><path d="m5 12 4 4L19 6" /></svg></span>
              <p className="min-w-0 flex-1 text-md text-ink-2"><b className="font-semibold text-ink">Your wallet is ready.</b> Deposit SOL to start trading.</p>
              <button onClick={() => { setJustCreated(false); openExchange("deposit"); }} className="h-8 rounded-full bg-up px-4 text-sm font-bold text-on-fill hover:brightness-110">Fund wallet</button>
            </div>
          )}
          {w && w.sol > 0 && paperOn && (
            <div role="status" className="flex flex-wrap items-center gap-3 border-t border-rule bg-warn/[0.05] px-5 py-3 max-sm:px-4">
              <p className="min-w-0 flex-1 text-md text-ink-2"><b className="font-semibold text-ink">You're on Paper.</b> Your wallet has {sol(w.sol)} SOL: switch to trade it for real.</p>
              <button onClick={() => { setPaper(false); location.hash = "#/coins"; }} className="h-8 rounded-full bg-ink px-4 text-sm font-semibold text-on-fill hover:bg-focus">Trade with real SOL</button>
            </div>
          )}
        </section>
      ) : <MyProfile actions={<>{accountActions}<Button size="lg" variant="ghost" className="rounded-full" onClick={() => logOut(load)}>Log out</Button></>} />}

      {me.problem && <p className="rounded-control border border-warn/40 bg-warn/10 px-3 py-2 text-md text-ink-2"><b className="text-ink">The wallet service did not answer.</b> {me.problem}</p>}
      {confirmAgain && <p className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-rule-2 bg-paper-3 px-3 py-2 text-md text-ink-2">
        <span><b className="text-ink">Confirm it is you.</b> Withdrawing or showing your key needs a Google sign-in from the last ten minutes.</span>
        <Button asChild><a href="api/account/google?confirm=1"><GoogleG />Sign in again</a></Button></p>}

      <div className="grid items-start gap-4 grid-cols-[minmax(0,1fr)_400px] max-xl:grid-cols-[minmax(0,1fr)]">
        {/* Positions and history. */}
        <section className={cn(panel, "min-w-0 overflow-hidden")}>
          <header className="flex h-14 items-center justify-between gap-3 border-b border-rule px-5 max-sm:px-4">
            <Segmented value={tab} options={[["positions", `Positions${w?.tokens.length ? ` · ${w.tokens.length}` : ""}`], ["history", `History${txs.length ? ` · ${txs.length}` : ""}`]]} onChange={setTab} label="Positions or history" />
            {tab === "positions" && w?.tokens.length ? <span className="num text-sm text-muted">{usd(w.tokensUsd)} in coins</span> : null}
          </header>
          <div className="overflow-x-auto">
            {tab === "positions" ? (
              w?.tokens.length ? (
                <table className="w-full text-md"><thead><tr><th className={th}>Token</th><th className={cn(th, "text-right")}>Value</th><th className={cn(th, "text-right")}>Bought</th><th className={cn(th, "text-right")}>Sold</th><th className={cn(th, "text-right")}>PnL</th><th className={cn(th, "text-right")}>Sell</th></tr></thead><tbody>
                  {w.tokens.map((t) => {
                    const b = book.by[t.mint] || { bought: 0, sold: 0 }, worth = t.usd != null && solPrice ? t.usd / solPrice : 0, p = b.sold + worth - b.bought;
                    return (
                      <tr key={t.mint} className="hover:bg-paper-3/60"><td className={td}><CoinCell mint={t.mint} name={names[t.mint]} /></td>
                        <td className={cn(td, "num text-right")}><b className="block font-semibold">{usd(t.usd)}</b><span className="text-xs text-muted">{(+t.ui).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></td>
                        <td className={cn(td, "num text-right text-ink-2")}>{b.bought ? sol(b.bought, 3) : "—"}</td><td className={cn(td, "num text-right text-ink-2")}>{b.sold ? sol(b.sold, 3) : "—"}</td>
                        <td className={cn(td, "num text-right font-semibold", b.bought ? toneOf(p) : "text-muted")}>{b.bought ? <>{signed(p, 3)}<span className="block text-xs font-medium opacity-80">{`${p >= 0 ? "+" : "−"}${Math.abs((p / b.bought) * 100).toFixed(0)}%`}</span></> : "—"}</td>
                        <td className={td}><span className="flex justify-end gap-1">{[25, 50, 100].map((pc) => (
                          <button key={pc} disabled={!!busy} onClick={() => confirm(`Sell ${pc}% of ${names[t.mint]?.symbol || shortAddr(t.mint)} for SOL?`) && act("sell", "sell", { mint: t.mint, pct: pc }, "Sell sent")}
                            className="num h-7 rounded-full bg-down/10 px-2.5 text-xs font-semibold text-down transition-colors duration-100 hover:bg-down hover:text-on-fill disabled:opacity-50">{pc}%</button>))}</span></td></tr>);
                  })}
                </tbody></table>
              ) : (
                <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                  <span aria-hidden className="grid size-12 place-items-center rounded-full border border-rule-2 bg-paper-3 text-muted"><Icon.wallets className="size-5" /></span>
                  <div><p className="text-md font-semibold text-ink">No open positions</p><p className="mt-1 text-sm text-muted">Deposit SOL, then buy from Pulse or paste a contract.</p></div>
                  <div className="flex gap-2">
                    <button onClick={() => openExchange("deposit")} className="h-8 rounded-full bg-ink px-4 text-sm font-semibold text-on-fill hover:bg-focus">Deposit</button>
                    <a href="#/pulse" className="flex h-8 items-center rounded-full border border-rule-2 px-4 text-sm font-semibold text-ink-2 hover:text-ink">Open Pulse</a>
                  </div>
                </div>
              )
            ) : (
              txs.length ? (
                <table className="w-full text-md"><thead><tr>{["Time", "Type", "Token", "SOL", "Transaction", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead><tbody>
                  {txs.map((t, i) => (
                    <tr key={i} className="hover:bg-paper-3/60"><td className={cn(td, "text-muted")}>{when(t.t)}</td>
                      <td className={td}><span className={cn("rounded px-1.5 py-0.5 text-2xs font-bold tracking-wide uppercase", t.kind === "buy" ? "bg-up/12 text-up" : t.kind === "sell" ? "bg-down/12 text-down" : "bg-paper-4 text-ink-2")}>{t.kind}</span></td>
                      <td className={td}>{t.mint ? <a href={`#/coin/${t.mint}`} className="font-semibold hover:text-ink">{names[t.mint]?.symbol || shortAddr(t.mint)}</a> : t.dest ? <span className="text-muted">to {shortAddr(t.dest)}</span> : "—"}</td>
                      <td className={cn(td, "num")}>{t.sol != null ? sol(t.sol) : "—"}</td>
                      <td className={td}>{t.sig ? <a href={`https://solscan.io/tx/${t.sig}`} target="_blank" rel="noreferrer" className="font-outlier text-xs text-ink-2 underline decoration-rule-2 underline-offset-2 hover:text-ink">{shortAddr(t.sig)}</a> : "—"}</td>
                      <td className={cn(td, "capitalize", t.status === "confirmed" ? "text-up" : t.status === "failed" ? "text-down" : "text-warn")}>{t.status}</td></tr>))}
                </tbody></table>
              ) : <p className="px-6 py-14 text-center text-md text-muted">No trades yet.</p>
            )}
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          {/* Your deposit address. */}
          <section className={cn(panel, "flex flex-col gap-3 p-5 max-sm:p-4")}>
            <div className="flex items-center justify-between"><h2 className="text-md font-semibold">Wallet</h2><span className="text-xs text-muted">Solana · deposit address</span></div>
            <button onClick={() => { navigator.clipboard?.writeText(me.address!); toast("Address copied"); }} title="Copy address"
              className="group flex items-center gap-2 rounded-control border border-rule bg-paper px-3 py-2.5 text-left transition-colors hover:border-rule-2">
              <span className="min-w-0 flex-1 font-outlier text-sm break-all text-ink">{me.address}</span>
              <Icon.copy className="size-4 shrink-0 text-muted group-hover:text-ink" />
            </button>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="lg" className="h-8 rounded-full"><a href={`https://solscan.io/account/${me.address}`} target="_blank" rel="noreferrer"><SiteLogo site="solscan" className="size-4" />Solscan</a></Button>
              <Button size="lg" className="h-8 rounded-full" onClick={() => { setSecret(null); setOpen("export"); }}><Icon.key />Export key</Button>
            </div>
          </section>

          <ShareLink />

          <section className={cn(panel, "flex items-center justify-between gap-3 px-5 py-3.5 max-sm:px-4")}>
            <p className="min-w-0 text-sm text-muted">Signed in as <b className="font-semibold text-ink-2">{me.email}</b></p>
            <button onClick={() => logOut(load)} className="shrink-0 text-sm font-semibold text-down hover:underline">Log out</button>
          </section>
        </aside>
      </div>

      <Dialog open={open === "withdraw"} onOpenChange={(o) => setOpen(o ? "withdraw" : null)} title="Withdraw SOL">
        <form className="flex flex-col gap-3.5" onSubmit={form((f) => confirm(`Send ${f.sol} SOL to\n${f.to}?\n\nThis cannot be undone.`) && act("withdraw", "withdraw", { to: f.to.trim(), sol: +f.sol }, "Withdrawal sent"))}>
          <Field label="To address" name="to" required pattern="[1-9A-HJ-NP-Za-km-z]{32,44}" className="font-outlier" />
          <Field label={`Amount in SOL${w ? ` · ${sol(w.sol)} available` : ""}`} name="sol" type="number" min="0.000000001" step="any" inputMode="decimal" required />
          <button disabled={!!busy} className="flex h-10 items-center justify-center rounded-full bg-ink text-md font-semibold text-on-fill hover:bg-focus disabled:opacity-50">{busy === "withdraw" ? "Sending…" : "Withdraw"}</button>
        </form>
      </Dialog>

      <Dialog open={open === "buy"} onOpenChange={(o) => setOpen(o ? "buy" : null)} title="Buy a coin">
        <form className="flex flex-col gap-3.5" onSubmit={form((f) => act("buy", "buy", { mint: f.mint.trim(), sol: +f.sol }, "Buy sent"))}>
          <Field label="Contract address" name="mint" required pattern="[1-9A-HJ-NP-Za-km-z]{32,44}" placeholder="…pump" className="font-outlier" />
          <Field label={`SOL to spend${w ? ` · ${sol(w.sol)} available` : ""}`} name="sol" type="number" min="0.000000001" step="any" inputMode="decimal" defaultValue="0.05" required />
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
