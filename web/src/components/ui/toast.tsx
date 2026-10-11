import { useEffect, useState } from "react";
import { create } from "zustand";
import { SolanaLogo } from "@/components/brand";
import { CoinImg } from "@/components/page";
import { cn } from "@/lib/utils";

// A toast is for a failure or for something that happened out of sight. Success on screen is silent.
// A transaction gets its own kind, at the top of the page: it is shown the moment it is sent (spinner and
// a running clock), then turns into a drawn tick with a link to the transaction, or shakes and says why not.
// A trade shows its coin's logo, the state riding on it as a small badge; `chip` is a short figure set apart on
// the right (how fast a real trade landed).
type Kind = "note" | "pending" | "unknown" | "ok" | "fail";
interface Item { id: number; kind: Kind; text: string; sub?: string; href?: string; chip?: string; t: number; paper?: boolean; mint?: string; symbol?: string }
const useToasts = create<{ items: Item[] }>(() => ({ items: [] }));
let seq = 0;
const drop = (id: number) => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }));
const patch = (id: number, p: Partial<Item>) => useToasts.setState((s) => ({ items: s.items.map((t) => (t.id === id ? { ...t, ...p } : t)) }));

export function toast(text: string) {
  const id = ++seq;
  useToasts.setState((s) => ({ items: [...s.items.filter((t) => t.kind !== "note").concat(s.items.filter((t) => t.kind === "note").slice(-2)), { id, kind: "note", text, t: Date.now() }] }));
  setTimeout(() => drop(id), 4000);
}

// One transaction, from sent to settled.
export function txToast(text: string, sub?: string, opts?: { paper?: boolean; mint?: string; symbol?: string }) {
  const id = ++seq;
  useToasts.setState((s) => ({ items: [...s.items, { id, kind: "pending", text, sub, t: Date.now(), ...opts }] }));
  const settle = (kind: Kind, ms: number) => (text: string, sub?: string, href?: string, chip?: string) => { patch(id, { kind, text, sub, href, chip }); setTimeout(() => drop(id), ms); };
  return { ok: settle("ok", 5000), fail: settle("fail", 7000), unknown: (text: string, sub?: string, href?: string) => patch(id, { kind: "unknown", text, sub, href }) };
}

function Clock({ from }: { from: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(t); }, []);
  return <span className="num shrink-0 rounded-full bg-ink/[0.06] px-2 py-0.5 text-xs text-muted tabular-nums">{((Date.now() - from) / 1000).toFixed(1)}s</span>;
}

// State colour: neutral while pending, then green, red or amber. Drives the glow, the ring, the badge and the bar.
const tone = { pending: "text-ink-2", ok: "text-up", fail: "text-down", unknown: "text-warn", note: "text-ink" } as const;
const badge = { pending: "", ok: "bg-up", fail: "bg-down", unknown: "bg-warn", note: "" } as const;
const ring = { pending: "", ok: "shadow-[0_0_0_2px_var(--color-up),0_0_20px_-3px_var(--color-up)]", fail: "shadow-[0_0_0_2px_var(--color-down),0_0_20px_-3px_var(--color-down)]",
  unknown: "shadow-[0_0_0_2px_var(--color-warn),0_0_20px_-3px_var(--color-warn)]", note: "" } as const;
// A finished sell reads red (money out of the coin), a finished buy green; the tick stays a tick.
const hue = (t: Item): Kind => (t.kind === "ok" && /^Sold/.test(t.text.replace(/^Paper · /, "")) ? "fail" : t.kind);
const glass = "border border-white/[0.07] bg-paper-3/85 shadow-[0_18px_50px_-12px_oklch(0%_0_0/0.75),inset_0_1px_0_oklch(100%_0_0/0.06)] backdrop-blur-xl";

function Glyph({ kind, className }: { kind: Kind; className?: string }) {
  return kind === "ok" ? <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5.5 12.5l4 4 9-9.5" className="animate-tx-tick" pathLength={1} strokeDasharray="1" /></svg>
    : kind === "fail" ? <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M7 7l10 10M17 7L7 17" /></svg>
    : kind === "unknown" ? <span className="text-[0.8em] leading-none font-black" aria-hidden>?</span>
    : null;
}

// The coin's logo (its ticker underneath until the picture loads). While pending an arc turns around it; once
// settled a ring in the state colour closes around it and a badge pops onto its corner.
function CoinMark({ t }: { t: Item }) {
  const settled = t.kind !== "pending";
  return (
    <span className="relative block size-11 shrink-0">
      <span className={cn("absolute inset-0 grid place-items-center overflow-hidden rounded-full bg-paper-4 text-xs font-bold text-muted uppercase transition-shadow duration-300",
        settled ? ring[hue(t)] : "shadow-[0_0_0_1px_oklch(100%_0_0/0.1)]")}>
        {(t.symbol || "?").slice(0, 3)}
        <CoinImg mint={t.mint!} />
      </span>
      {!settled && <i aria-hidden className="absolute -inset-[4px] animate-spin rounded-full border-2 border-transparent border-t-ink border-r-ink/30 [animation-duration:0.8s]" />}
      {settled && (
        <span key={t.kind} className={cn("absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full text-paper-2 shadow-[0_0_0_2.5px_var(--color-paper-3)] animate-tx-pop", badge[hue(t)])}>
          <Glyph kind={t.kind} className="size-3" />
        </span>
      )}
    </span>
  );
}

function StateMark({ t }: { t: Item }) {
  const settled = t.kind !== "pending";
  return (
    <span key={t.kind} className={cn("grid size-11 shrink-0 place-items-center rounded-full bg-current/[0.14] shadow-[inset_0_0_0_1px_color-mix(in_oklch,currentColor_30%,transparent)]", settled && "animate-tx-pop")}>
      {settled ? <Glyph kind={t.kind} className="size-5" /> : <i className="block size-5 animate-spin rounded-full border-2 border-current/20 border-t-ink [animation-duration:0.8s]" />}
    </span>
  );
}

// "Bought $GNB": the action in the state colour, the coin in full white. Older callers wrote "Paper · " into the
// text itself; that becomes the badge.
function Title({ t }: { t: Item }) {
  const text = t.text.replace(/^Paper · /, "");
  const m = /^(\S+) (\$\S+)$/.exec(text);
  return (
    <b className="truncate text-md font-semibold tracking-[-0.01em] text-ink">
      {m ? <><span className={tone[hue(t)]}>{m[1]}</span> {m[2]}</> : text}
    </b>
  );
}

// "0.25 SOL" gets the Solana mark in front of it.
function Sub({ t }: { t: Item }) {
  const plain = t.kind === "fail" || t.kind === "unknown";
  const m = !plain && t.sub ? /^([\d.,]+) SOL(.*)$/.exec(t.sub) : null;
  return (
    <span className={cn("mt-0.5 flex min-w-0 items-center gap-1 text-sm", plain ? "text-ink-2" : "num text-muted")}>
      {m ? <><SolanaLogo className="size-3 shrink-0" /><span className="text-ink-2">{m[1]}</span><span className="truncate">SOL{m[2]}</span></> : <span className={plain ? "" : "truncate"}>{t.sub}</span>}
    </span>
  );
}

function Tx({ t }: { t: Item }) {
  const paper = t.paper || t.text.startsWith("Paper · "), settled = t.kind !== "pending";
  return (
    <div role="status" className={cn("pointer-events-auto relative flex w-[min(24rem,calc(100vw-1.5rem))] items-center gap-3 overflow-hidden rounded-2xl py-3 pr-3 pl-3 animate-tx-in", glass,
      tone[hue(t)], t.kind === "fail" && "animate-tx-shake")}>
      {/* the state colour washing in from the logo's side, and a hairline of light along the top edge */}
      <i aria-hidden className={cn("pointer-events-none absolute inset-0 bg-[radial-gradient(110%_150%_at_0%_50%,currentColor,transparent_55%)] transition-opacity duration-500", settled ? "opacity-[0.13]" : "opacity-[0.05]")} />
      <i aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      {!settled && <i aria-hidden className="pointer-events-none absolute inset-0 animate-tx-sheen bg-[linear-gradient(100deg,transparent_35%,oklch(100%_0_0/0.06)_50%,transparent_65%)]" />}
      <span className="relative flex shrink-0">{t.mint ? <CoinMark t={t} /> : <StateMark t={t} />}</span>
      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Title t={t} />
          {paper && <span className="shrink-0 rounded-[5px] bg-info/15 px-1.5 py-px text-[10px] font-bold tracking-[0.08em] text-info uppercase shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-info)_25%,transparent)]">Paper</span>}
        </span>
        {t.sub && <Sub t={t} />}
      </span>
      <span className="relative flex shrink-0 items-center gap-1.5">
        {t.kind === "pending" ? <Clock from={t.t} />
          : t.chip ? <span className="num flex items-center gap-1 rounded-full bg-current/[0.12] px-2 py-0.5 text-xs font-semibold shadow-[inset_0_0_0_1px_color-mix(in_oklch,currentColor_22%,transparent)]">
              <svg viewBox="0 0 12 12" className="size-2.5" fill="currentColor" aria-hidden><path d="M7 .5 2 7h3.2L4.6 11.5 10 4.8H6.6z" /></svg>{t.chip}</span> : null}
        {settled && t.href && <a href={t.href} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-full bg-ink/[0.07] px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ink/[0.12] hover:text-ink">
            View<svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M4 2.5h5.5V8M9.5 2.5L3 9" /></svg></a>}
        {(t.kind === "unknown" || t.kind === "fail") && <button aria-label="Dismiss transaction notice" onClick={() => drop(t.id)} className="grid size-6 place-items-center rounded-full text-muted transition-colors hover:bg-ink/[0.08] hover:text-ink">×</button>}
      </span>
      {(t.kind === "ok" || t.kind === "fail") && (
        <i aria-hidden className={cn("absolute bottom-0 left-0 h-[2px] w-full origin-left bg-[linear-gradient(90deg,currentColor,color-mix(in_oklch,currentColor_35%,transparent))]", t.kind === "ok" ? "animate-tx-bar-ok" : "animate-tx-bar-fail")} />
      )}
    </div>
  );
}

export function Toaster() {
  const items = useToasts((s) => s.items);
  return (
    <>
      <div aria-live="polite" className="pointer-events-none fixed top-3 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {items.filter((t) => t.kind !== "note").slice(-4).map((t) => <Tx key={t.id} t={t} />)}
      </div>
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-11 z-[60] flex flex-col items-end gap-2 max-md:right-2 max-md:bottom-20">
        {items.filter((t) => t.kind === "note").map((t) => (
          <div key={t.id} className={cn("pointer-events-auto max-w-[min(22rem,calc(100vw-1rem))] animate-tx-in rounded-xl px-3.5 py-2.5 text-sm text-ink", glass)}>{t.text}</div>
        ))}
      </div>
    </>
  );
}
