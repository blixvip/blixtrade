// "Invite & earn": claim a handle and share blixvip.com/@<handle>, your page and invite link. Everyone who signs up
// through it is counted here; you earn a share of Blix's trading fee on everything they trade with real SOL (paid
// with Claim into your Blix wallet), and they pay less fee. The handle and the invites live on the server
// (server/handles.js, /api/account/handle); the earnings in the wallet service (/api/account/referral).
// Off blixvip.com there is no handle route and the card stays hidden.
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { SolanaLogo } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { toast, txToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface Handle { handle: string | null; link: string | null; joined: number; canChangeAt: number; suggestion: string | null; invited?: boolean; recent?: { who: string; t: number }[] }
interface Earn { on: boolean; feeBps: number; shareBps: number; discountBps?: number; yourFeeBps?: number; invited?: boolean; minClaimSol: number; traders: number; trades: number; volumeSol: number; earnedSol: number; claimableSol: number; paidSol: number }

async function call<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) } : { signal: AbortSignal.timeout(20_000) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { status: r.status });
  return j as T;
}
const sol = (v: number) => (v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v > 0 ? v.toFixed(5) : "0");
const pct = (bps: number) => `${+(bps / 100).toFixed(2)}%`;
const ago = (t: number) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

// This member's own fee on real trades, in basis points (an invited trader pays less): the trade panel quotes it.
let feeAsk: Promise<number | null> | null = null;
export function useFeeBps(fallback = 100) {
  const [bps, setBps] = useState<number | null>(null);
  useEffect(() => {
    if (!location.hostname.endsWith("blixvip.com")) return;
    feeAsk ??= call<Earn>("api/account/referral").then((e) => (e.on ? e.yourFeeBps ?? e.feeBps : null), () => { feeAsk = null; return null; });
    let alive = true;
    feeAsk.then((v) => { if (alive && v != null) setBps(v); });
    return () => { alive = false; };
  }, []);
  return bps ?? fallback;
}

// Whether a handle being typed is free, asked as the member types (server/handles.js ?check=, nothing written).
// "yours" is the handle they already have. Only the newest answer counts.
export type HandleCheck = { state: "idle" | "checking" | "free" | "taken" | "yours"; message?: string };
export function useHandleCheck(value: string, current: string | null): HandleCheck {
  const [c, setC] = useState<HandleCheck>({ state: "idle" });
  useEffect(() => {
    const v = value.toLowerCase();
    if (v.length < 3) { setC({ state: "idle" }); return; }
    if (v === current) { setC({ state: "yours" }); return; }
    setC({ state: "checking" });
    const ask = new AbortController(), t = setTimeout(() => {
      fetch(`api/account/handle?check=${encodeURIComponent(v)}`, { signal: ask.signal }).then((r) => r.json())
        .then((j: { available?: boolean; error?: string }) => setC(j.available ? { state: "free" } : { state: "taken", message: j.error || "That handle is taken." }))
        .catch(() => { if (!ask.signal.aborted) setC({ state: "idle" }); });
    }, 300);
    return () => { clearTimeout(t); ask.abort(); };
  }, [value, current]);
  return c;
}
// The line under the handle box: free, taken (and why), or still checking.
export function HandleStatus({ check, value, error }: { check: HandleCheck; value: string; error?: string }) {
  if (error) return <p role="alert" className="text-sm text-down">{error}</p>;
  const v = value.toLowerCase();
  if (check.state === "checking") return <p className="text-sm text-muted">Checking @{v}…</p>;
  if (check.state === "free") return (
    <p className="flex items-center gap-1.5 text-sm text-up">
      <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      @{v} is free
    </p>
  );
  if (check.state === "taken") return <p role="status" className="text-sm text-down">{check.message}</p>;
  if (check.state === "yours") return <p className="text-sm text-muted">That's your handle now.</p>;
  return null;
}
export const handleBorder = (c: HandleCheck) => (c.state === "free" ? "border-up/50" : c.state === "taken" ? "border-down/50" : "border-white/[0.1] focus-within:border-up/50");

function Stat({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div title={hint} className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-white/[0.05] bg-paper/60 px-3.5 py-3">
      <span className="text-xs font-medium text-muted">{label}</span>
      <b className="num flex items-center gap-1.5 truncate text-lg leading-none font-semibold text-ink">{children}</b>
    </div>
  );
}

function Step({ n, title, text }: { n: number; title: ReactNode; text: string }) {
  return (
    <li className="flex min-w-0 flex-1 items-start gap-2.5">
      <span className="num grid size-6 shrink-0 place-items-center rounded-full border border-up/30 bg-up/10 text-xs font-bold text-up">{n}</span>
      <span className="min-w-0"><b className="block text-sm leading-tight font-semibold text-ink">{title}</b><span className="mt-0.5 block text-xs text-muted">{text}</span></span>
    </li>
  );
}

export function ShareLink({ className }: { className?: string }) {
  const [h, setH] = useState<Handle | null>(null), [editing, setEditing] = useState(false), [value, setValue] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [earn, setEarn] = useState<Earn | null>(null), [claiming, setClaiming] = useState(false), [copied, setCopied] = useState(false);
  const loadEarn = () => call<Earn>("api/account/referral").then(setEarn, () => {});
  const check = useHandleCheck(value, h?.handle ?? null);
  useEffect(() => {
    if (!location.hostname.endsWith("blixvip.com")) return;
    call<Handle>("api/account/handle").then((r) => { setH(r); setValue(r.handle || r.suggestion || ""); }).catch(() => {});
    loadEarn();
  }, []);
  if (!h) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try { const r = await call<Handle>("api/account/handle", { handle: value }); setH(r); setValue(r.handle || ""); setEditing(false); toast(`Your link is ${r.link?.replace(/^https:\/\//, "")}`); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const copy = () => {
    if (!h.link) return;
    navigator.clipboard.writeText(h.link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }, () => toast("Couldn't copy the link"));
  };
  const share = () => {
    if (!h.link) return;
    const text = `Trade Solana memecoins on BLIX and save ${pct(discount)} on fees with my link`;
    if (navigator.share) navigator.share({ title: "BLIX", text, url: h.link }).catch(() => {});
    else window.open(`https://x.com/intent/post?${new URLSearchParams({ text, url: h.link })}`, "_blank", "noopener");
  };
  // Paid from Blix's fee wallet into this member's own Blix wallet, shown like any other transaction.
  const claim = async () => {
    if (!earn || claiming) return;
    setClaiming(true);
    const t = txToast("Claiming referral earnings", `${sol(earn.claimableSol)} SOL → your Blix wallet`);
    try {
      const r = await call<{ status: string; signature?: string; sol: number; landedMs?: number }>("api/account/referral/claim", {});
      const link = r.signature ? `https://solscan.io/tx/${r.signature}` : undefined;
      if (r.status === "confirmed") t.ok("Earnings claimed", `${sol(r.sol)} SOL`, link, r.landedMs ? `${(r.landedMs / 1000).toFixed(1)}s` : undefined);
      else t.unknown("Payout sent", "It may take a moment to land. Check your wallet's history.", link);
      window.dispatchEvent(new Event("blix:wallet-changed"));
    } catch (e) { t.fail("Claim failed", (e as Error).message); }
    finally { setClaiming(false); loadEarn(); }
  };
  const form = !h.handle || editing;
  const share_ = earn?.shareBps ?? 4000, discount = earn?.discountBps ?? 2000;
  const canClaim = earn ? earn.claimableSol >= earn.minClaimSol : false;
  const invited = earn?.invited ?? h.invited;

  return (
    <section className={cn("relative flex flex-col gap-4 overflow-hidden rounded-2xl border border-white/[0.07] bg-paper-2 p-5 max-sm:p-4", className)}>
      <i aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_120%_at_0%_0%,color-mix(in_oklch,var(--color-up)_10%,transparent),transparent_60%)]" />
      <div className="relative flex items-start gap-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-up/15 text-up">
          <svg viewBox="0 0 24 24" className="size-5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z" /></svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-lg leading-tight font-semibold text-ink">Invite &amp; earn</h2>
          <p className="mt-1 text-sm text-muted">
            Earn <b className="font-semibold text-up">{pct(share_)}</b> of the fees on every real-SOL trade your friends make. They save <b className="font-semibold text-ink-2">{pct(discount)}</b> on every fee.
          </p>
        </div>
      </div>

      <ol className="relative flex flex-col gap-2.5 rounded-xl border border-white/[0.05] bg-paper/40 p-3.5">
        <Step n={1} title="Share your link" text="Anyone who signs up through it is yours." />
        <Step n={2} title={<>They save {pct(discount)}</>} text={earn?.on ? `Their fee is ${pct(Math.round((earn.feeBps * (10_000 - discount)) / 10_000))} instead of ${pct(earn.feeBps)}.` : "Lower fees on every trade."} />
        <Step n={3} title={<>You earn {pct(share_)}</>} text="Of every fee they pay, forever. Claim any time." />
      </ol>

      {form ? (
        <form onSubmit={save} className="relative flex flex-col gap-1.5">
          <p className="text-sm text-muted">{h.handle ? "Pick a new handle (you can change it once a day)." : "Claim your handle to get your own page and invite link."}</p>
          <div className="flex items-center gap-2 max-sm:flex-wrap">
            <label className={cn("flex h-11 min-w-0 flex-1 items-center rounded-xl border bg-paper px-3.5 text-md transition-colors", handleBorder(check))}>
              <span className="text-muted">blixvip.com/@</span>
              <input value={value} onChange={(e) => { setValue(e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20)); setError(""); }} aria-label="Handle" placeholder="yourname" autoComplete="off" spellCheck={false}
                className="min-w-0 flex-1 bg-transparent font-semibold text-ink outline-none" />
            </label>
            <Button type="submit" size="lg" disabled={busy || value.length < 3 || check.state === "taken" || check.state === "yours"} className="h-11 rounded-full bg-ink px-6 text-paper hover:bg-white">{busy ? "Saving…" : h.handle ? "Save" : "Claim"}</Button>
            {editing && <Button type="button" size="lg" variant="ghost" className="h-11 rounded-full" onClick={() => { setEditing(false); setValue(h.handle || ""); setError(""); }}>Cancel</Button>}
          </div>
          <HandleStatus check={check} value={value} error={error} />
        </form>
      ) : (
        <div className="relative flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Your invite link</span>
          <div className="flex items-center gap-2 rounded-xl border border-up/25 bg-paper py-1.5 pr-1.5 pl-3.5 max-sm:flex-wrap">
            <span className="min-w-0 flex-1 truncate text-md font-semibold text-ink"><span className="text-muted">blixvip.com/@</span>{h.handle}</span>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" className={cn("h-8 min-w-[76px] rounded-full px-4 transition-colors", copied ? "bg-up text-on-fill hover:bg-up" : "bg-ink text-paper hover:bg-white")} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
              <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={share}>Share</Button>
              <Button size="sm" variant="ghost" className="h-8 rounded-full" disabled={Date.now() < h.canChangeAt} title={Date.now() < h.canChangeAt ? "You can change your handle once a day" : undefined} onClick={() => setEditing(true)}>Change</Button>
            </div>
          </div>
        </div>
      )}

      <div className="relative grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Joined" hint="People who signed up through your link">{h.joined}</Stat>
        <Stat label="Trading" hint="Of them, people who made a real-SOL trade">{earn?.traders ?? "—"}</Stat>
        <Stat label="Their volume"><SolanaLogo className="size-3.5 shrink-0" />{earn ? sol(earn.volumeSol) : "—"}</Stat>
        <Stat label="Earned"><SolanaLogo className="size-3.5 shrink-0" />{earn ? sol(earn.earnedSol) : "—"}</Stat>
      </div>

      {earn?.on && (
        <div className={cn("relative flex items-center justify-between gap-3 rounded-xl border p-3.5 max-sm:flex-wrap", canClaim ? "border-up/30 bg-up/[0.07]" : "border-white/[0.06] bg-paper/60")}>
          <div className="min-w-0">
            <span className="text-xs font-medium text-muted">Ready to claim</span>
            <b className="num mt-1 flex items-center gap-1.5 text-xl leading-none font-semibold text-ink"><SolanaLogo className="size-4 shrink-0" />{sol(earn.claimableSol)} <span className="text-sm font-medium text-muted">SOL</span></b>
            <span className="num mt-1.5 block text-xs text-muted">{earn.paidSol > 0 ? `${sol(earn.paidSol)} SOL paid out so far · ` : ""}{canClaim ? "Paid straight into your Blix wallet" : `Payouts start at ${earn.minClaimSol} SOL`}</span>
          </div>
          <Button size="lg" disabled={!canClaim || claiming} onClick={claim}
            className="h-11 rounded-full bg-up px-7 font-bold text-on-fill shadow-[0_6px_20px_-8px_var(--color-up)] hover:brightness-110 disabled:bg-paper-5 disabled:text-muted disabled:shadow-none">
            {claiming ? "Claiming…" : "Claim"}
          </Button>
        </div>
      )}

      {h.recent && h.recent.length > 0 && (
        <div className="relative flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Recent sign-ups</span>
          <ul className="flex flex-col divide-y divide-white/[0.05] rounded-xl border border-white/[0.05] bg-paper/40">
            {h.recent.map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3.5 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2.5"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-paper-4 text-[0.6875rem] font-semibold text-ink-2 uppercase">{r.who[0]}</span><span className="truncate text-ink-2">{r.who}</span></span>
                <span className="num shrink-0 text-xs text-muted">{ago(r.t)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {invited && earn?.on && (
        <p className="relative flex items-center gap-2 rounded-xl border border-up/20 bg-up/[0.06] px-3.5 py-2.5 text-sm text-ink-2">
          <svg viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0 text-up"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          You joined through an invite: your fee is <b className="font-semibold text-up">{pct(earn.yourFeeBps ?? earn.feeBps)}</b> instead of {pct(earn.feeBps)}.
        </p>
      )}
    </section>
  );
}
