// The $10 wall (the user, 2026-10-10): AI picks, Narratives, Practice and every coin's AI read open once the visitor's
// Blix wallet holds UNLOCK_USD or more (SOL and coins together, as the wallet service values them). Until then the
// page runs faded behind blur with one small card on top: what it is and the one requirement (minimal, the user's
// ask). A "Dev" button in the corner takes the dev password and opens every wall on this browser. It re-reads the
// wallet every 10 s while shown, so a deposit opens the page by itself. A wall on the pages only: the APIs are open.
import { useEffect, useState, useSyncExternalStore, type ComponentType, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { openExchange } from "@/lib/modals";
import { loadMe, useMe, type Me } from "@/lib/ui";

export const UNLOCK_USD = 10;
export type Gated = "picks" | "read" | "narratives" | "practice";

const walletUsd = (me: Me | null) => !me?.wallet ? 0 : (me.wallet.solUsd || 0) + (me.wallet.tokens || []).reduce((n, t) => n + (t.usd || 0), 0);

// The dev pass: the password the user set, remembered on this browser. Client-side only, like the wall itself.
const DEV_PASS = "doodoo", DEV_KEY = "blix:dev-unlock";
let dev = (() => { try { return localStorage.getItem(DEV_KEY) === "1"; } catch { return false; } })();
const devSubs = new Set<() => void>();
const setDev = () => { dev = true; try { localStorage.setItem(DEV_KEY, "1"); } catch { /* the visit only */ } devSubs.forEach((f) => f()); };
const useDev = () => useSyncExternalStore((f) => { devSubs.add(f); return () => devSubs.delete(f); }, () => dev);

// "loading" until the account is read; "open" with UNLOCK_USD held or the dev pass entered.
export function useDepositUnlock() {
  const me = useMe((s) => s.me), devOpen = useDev();
  useEffect(() => { if (!me) void loadMe(); }, [me]);
  const have = walletUsd(me);
  const state: "loading" | "open" | "locked" = devOpen || have >= UNLOCK_USD ? "open" : !me ? "loading" : "locked";
  return { state, have, wallet: Boolean(me?.signedIn && !me.needsWallet), signedIn: Boolean(me?.signedIn) };
}

const TITLE: Record<Gated, string> = { picks: "AI picks", read: "AI read", narratives: "Narratives", practice: "Practice" };

// A page behind the wall (main.tsx: AI picks, Narratives, Practice).
export const gated = <P extends object>(page: Gated, Page: ComponentType<P>) => (props: P) => <DepositGate page={page}><Page {...props} /></DepositGate>;

// The page behind the wall: the real thing, or `preview` where running it would do work (a coin's AI read would
// start one). Inert, so it can't be clicked or tabbed into.
export function DepositGate({ page, children, preview, compact }: { page: Gated; children: ReactNode; preview?: ReactNode; compact?: boolean }) {
  const u = useDepositUnlock();
  // Locked: the wallet read again every 10 s, so a deposit that just landed opens the page without a reload.
  useEffect(() => {
    if (u.state !== "locked" || !u.wallet) return;
    const t = setInterval(() => { if (!document.hidden) void loadMe(); }, 10_000);
    return () => clearInterval(t);
  }, [u.state, u.wallet]);
  if (u.state === "open") return <>{children}</>;
  return (
    <div className={cn("relative isolate overflow-hidden", compact ? "min-h-[520px] rounded-card" : "min-h-[calc(100dvh-7rem)]")}>
      <div aria-hidden inert className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-60 blur-[8px] select-none">{preview ?? children}</div>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-paper/60" />
      <div className="grid min-h-[inherit] place-items-center p-4">
        {u.state === "loading" ? <span className="size-6 animate-spin rounded-full border-2 border-rule-2 border-t-ink" /> : <Wall page={page} u={u} />}
      </div>
      <DevButton />
    </div>
  );
}

// Apple's own type where the visitor has it (SF Pro), else the closest system face.
const SF = { fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", system-ui, sans-serif' };

// Plain text on the blur, nothing boxed: the page, its one requirement, one button (the user: simple, not slop).
function Wall({ page, u }: { page: Gated; u: ReturnType<typeof useDepositUnlock> }) {
  const [checking, setChecking] = useState(false);
  const left = Math.max(0, UNLOCK_USD - u.have);
  const check = async () => { setChecking(true); try { await loadMe(); } finally { setChecking(false); } };
  const btn = "inline-grid h-9 place-items-center rounded-full bg-ink px-5 text-[15px] font-medium text-on-fill transition-opacity duration-150 hover:opacity-85";
  return (
    <section style={SF} className="flex max-w-[320px] animate-brand-in flex-col items-center text-center antialiased">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mb-4 size-7 text-muted"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>
      <h2 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">{TITLE[page]}</h2>
      <p className="mt-1.5 text-[15px] text-muted">Requires ${UNLOCK_USD} in your Blix wallet.</p>
      <div className="mt-6 flex flex-col items-center gap-3">
        {u.wallet
          ? <button onClick={() => openExchange("deposit")} className={btn}>Deposit ${left.toFixed(left % 1 ? 2 : 0)}</button>
          : <a href="#/account" className={btn}>{u.signedIn ? "Set up wallet" : "Sign in"}</a>}
        {u.wallet && (
          <button onClick={() => void check()} disabled={checking} className="text-[13px] text-muted transition-colors hover:text-ink disabled:opacity-60">
            {checking ? "Checking…" : `You have $${u.have.toFixed(2)} · Check again`}
          </button>
        )}
      </div>
      <p className="mt-8 text-[12px] text-muted/70">Not a fee. It stays yours to trade or withdraw.</p>
    </section>
  );
}

// Bottom right, bare text: the dev password opens every wall on this browser.
function DevButton() {
  const [open, setOpen] = useState(false), [pw, setPw] = useState(""), [bad, setBad] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); if (pw.trim().toLowerCase() === DEV_PASS) setDev(); else { setBad(true); setPw(""); } };
  return (
    <div style={SF} className="absolute right-4 bottom-3 flex items-center gap-3 text-[12px]">
      {open && (
        <form onSubmit={submit}>
          <input autoFocus type="password" value={pw} placeholder={bad ? "Wrong password" : "Password"} aria-label="Dev password"
            onChange={(e) => { setPw(e.target.value); setBad(false); }} onBlur={() => !pw && setOpen(false)}
            className={cn("w-28 bg-transparent text-right text-ink outline-none placeholder:text-muted/60", bad && "placeholder:text-down")} />
        </form>
      )}
      <button onClick={() => { setOpen((v) => !v); setBad(false); }} className="text-muted/60 transition-colors hover:text-ink">Dev</button>
    </div>
  );
}
