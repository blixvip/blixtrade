// The Safety tab's parts (tabviews.tsx SafetyView, BubbleMap.tsx SafetyConnections), so both read as one sheet:
// a score gauge that draws itself, and checks as hairline rows (status dot, name, value on the right, a meter for
// a share of supply) that settle in one after another. Colour only where something is wrong.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type STone = "up" | "warn" | "down" | "muted";
export const TONE_VAR: Record<STone, string> = { up: "var(--color-up)", warn: "var(--color-warn)", down: "var(--color-down)", muted: "var(--color-muted)" };
const VALUE: Record<STone, string> = { up: "text-ink", warn: "text-warn", down: "text-down", muted: "text-ink-2" };
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// A number counting up to its value when it first shows (or straight to it with reduced motion).
export function useCountUp(target: number | null, ms = 900) {
  const [n, setN] = useState(() => (target == null || reduced() ? target : 0));
  useEffect(() => {
    if (target == null || reduced()) { setN(target); return; }
    let raf = 0; const t0 = performance.now(), from = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      setN(Math.round(from + (target - from) * e));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

// The 0-100 score as a ring that draws itself, its number counting up in the middle.
export function Gauge({ score, size = 96 }: { score: number | null; size?: number }) {
  const shown = useCountUp(score);
  const tone: STone = score == null ? "muted" : score >= 70 ? "up" : score >= 45 ? "warn" : "down";
  const r = 42, len = 2 * Math.PI * r, frac = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const [drawn, setDrawn] = useState(reduced());
  useEffect(() => { const t = requestAnimationFrame(() => setDrawn(true)); return () => cancelAnimationFrame(t); }, []);
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <span aria-hidden className="absolute inset-[12%] rounded-full blur-xl transition-opacity duration-700" style={{ background: TONE_VAR[tone], opacity: drawn ? 0.12 : 0 }} />
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-paper-4)" strokeWidth="6" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={TONE_VAR[tone]} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={len} strokeDashoffset={drawn ? len * (1 - frac) : len}
          style={{ transition: "stroke-dashoffset 1100ms cubic-bezier(0.16, 1, 0.3, 1)" }} />
      </svg>
      <span className="relative flex flex-col items-center leading-none">
        <b className="num text-[28px] font-semibold tracking-tight" style={{ color: TONE_VAR[tone] }}>{shown ?? "—"}</b>
        <span className="mt-1 text-2xs font-medium text-muted">/ 100</span>
      </span>
    </span>
  );
}

// How the checks came out, as one bar split by count (fine, watch, bad), each part growing in.
export function Tally({ fine, watch, bad }: { fine: number; watch: number; bad: number }) {
  const total = fine + watch + bad;
  if (!total) return null;
  const parts: [STone, number, string][] = [["up", fine, "fine"], ["warn", watch, "to watch"], ["down", bad, "bad"]];
  return (
    <div className="flex w-full max-w-sm flex-col gap-1.5">
      <div className="flex h-1.5 gap-[3px]">
        {parts.filter(([, n]) => n).map(([t, n], i) => (
          <i key={t} className="block h-full origin-left animate-meter-in rounded-full motion-reduce:animate-none"
            style={{ flexGrow: n, background: TONE_VAR[t], animationDelay: `${200 + i * 120}ms` } as CSSProperties} />))}
      </div>
      <span className="num flex gap-3 text-xs text-muted">
        {parts.map(([t, n, l]) => n > 0 && <span key={t} className="flex items-center gap-1.5"><i className="size-1.5 rounded-full" style={{ background: TONE_VAR[t] }} /><b className="font-semibold text-ink-2">{n}</b>{l}</span>)}
      </span>
    </div>
  );
}

export const Dot = ({ tone, className }: { tone: STone; className?: string }) => (
  <i aria-hidden className={cn("size-1.5 shrink-0 rounded-full", className)} style={{ background: TONE_VAR[tone], boxShadow: tone === "down" ? `0 0 0 3px color-mix(in oklch, ${TONE_VAR.down} 18%, transparent)` : undefined }} />
);

// A section: a quiet heading, then its rows in columns that wrap.
export function Sheet({ title, extra, children, index = 0 }: { title: string; extra?: ReactNode; children: ReactNode; index?: number }) {
  return (
    <section className="animate-safety-in border-b border-rule px-4 pt-4 pb-1 motion-reduce:animate-none" style={{ animationDelay: `${index * 60}ms` }}>
      <h4 className="flex items-baseline gap-2 text-xs font-semibold text-ink-2">{title}{extra && <span className="font-normal text-muted">{extra}</span>}</h4>
      <div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-8">{children}</div>
    </section>
  );
}

// One check: dot and name, the value on the right; a meter when the value is a share (0-100); a short note under.
export function Row({ name, value, tone, note, bar, i = 0 }: { name: string; value: ReactNode; tone: STone; note?: ReactNode; bar?: number | null; i?: number }) {
  return (
    <div className="flex animate-safety-in flex-col gap-1.5 border-t border-rule/60 py-3 motion-reduce:animate-none" style={{ animationDelay: `${80 + i * 40}ms` }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm text-ink-2"><Dot tone={tone} className="translate-y-[-1px]" /><span className="truncate">{name}</span></span>
        <b className={cn("num shrink-0 text-md font-semibold", VALUE[tone])}>{value}</b>
      </div>
      {bar != null && (
        <span className="block h-[3px] overflow-hidden rounded-full bg-paper-4">
          <i className="block h-full origin-left animate-meter-in rounded-full motion-reduce:animate-none"
            style={{ width: `${Math.max(1.5, Math.min(100, bar))}%`, background: tone === "up" ? "var(--color-ink-2)" : TONE_VAR[tone], opacity: tone === "up" ? 0.55 : 1, animationDelay: `${180 + i * 40}ms` }} />
        </span>
      )}
      {note && <span className="text-xs leading-snug text-muted">{note}</span>}
    </div>
  );
}
