import { useEffect, useState } from "react";
import { create } from "zustand";
import { cn } from "@/lib/utils";

// A toast is for a failure or for something that happened out of sight. Success on screen is silent.
// A transaction gets its own kind, at the top of the page: it is shown the moment it is sent (spinner and
// a running clock), then turns into a drawn tick with a link to the transaction, or shakes and says why not.
type Kind = "note" | "pending" | "ok" | "fail";
interface Item { id: number; kind: Kind; text: string; sub?: string; href?: string; t: number }
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
export function txToast(text: string, sub?: string) {
  const id = ++seq;
  useToasts.setState((s) => ({ items: [...s.items, { id, kind: "pending", text, sub, t: Date.now() }] }));
  const settle = (kind: Kind, ms: number) => (text: string, sub?: string, href?: string) => { patch(id, { kind, text, sub, href }); setTimeout(() => drop(id), ms); };
  return { ok: settle("ok", 5000), fail: settle("fail", 7000) };
}

function Clock({ from }: { from: number }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 100); return () => clearInterval(t); }, []);
  return <span className="num text-sm text-muted">{((Date.now() - from) / 1000).toFixed(1)}s</span>;
}

function Tx({ t }: { t: Item }) {
  return (
    <div role="status" className={cn("pointer-events-auto relative flex w-[min(22rem,calc(100vw-1.5rem))] items-center gap-3 overflow-hidden rounded-card border bg-paper-3 py-2.5 pr-3 pl-3.5 shadow-sheet animate-tx-in",
      t.kind === "ok" ? "border-up/50" : t.kind === "fail" ? "animate-tx-shake border-down/60" : "border-rule-2")}>
      <span className="grid size-7 shrink-0 place-items-center">
        {t.kind === "pending" ? <i className="block size-5 animate-spin rounded-full border-2 border-rule-2 border-t-ink" />
          : t.kind === "ok" ? <svg viewBox="0 0 24 24" className="size-7 text-up" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9.5" className="animate-tx-ring" pathLength={1} strokeDasharray="1" /><path d="M7.5 12.5l3 3 6-6.5" className="animate-tx-tick" pathLength={1} strokeDasharray="1" /></svg>
          : <svg viewBox="0 0 24 24" className="size-7 text-down" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9.5" /><path d="M9 9l6 6M15 9l-6 6" /></svg>}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-md font-semibold text-ink">{t.text}</b>
        {t.sub && <span className={cn("block text-sm", t.kind === "fail" ? "text-ink-2" : "truncate text-muted")}>{t.sub}</span>}
      </span>
      {t.kind === "pending" ? <Clock from={t.t} /> : t.href ? <a href={t.href} target="_blank" rel="noreferrer" className="shrink-0 text-sm font-medium text-info hover:underline">View</a> : null}
      {t.kind !== "pending" && <i className={cn("absolute bottom-0 left-0 h-0.5 w-full origin-left", t.kind === "ok" ? "bg-up animate-tx-bar-ok" : "bg-down animate-tx-bar-fail")} />}
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
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2 max-md:right-2 max-md:bottom-16">
        {items.filter((t) => t.kind === "note").map((t) => (
          <div key={t.id} className="animate-row-in rounded-control border border-rule-2 bg-paper-4 px-3 py-2 text-sm text-ink shadow-sheet">{t.text}</div>
        ))}
      </div>
    </>
  );
}
