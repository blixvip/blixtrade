// A pump.fun coin between its full bonding curve and its first PumpSwap trade (server livetrades.js migrationOf):
// pump.fun is moving it to its pool, and every buy and sell fails until the pool is live. The chart says so over
// its candles, the trade buttons wait, and coin rows carry a chip. `since`: when the curve filled (ms).
// Drawn in cyan (the owner did not like the yellow, 2026-10-11): a calm "in transit" colour, not a warning.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export const MIGRATING_TIP = "Migrating to PumpSwap: the bonding curve is full and pump.fun is moving the coin to its pool. Trading opens as soon as the pool is live, usually within seconds.";

// A real migration takes seconds. Past this the page stops saying "Migrating" whatever the server last said (the
// server gives up at the same age: livetrades.js MIGRATE_MAX_MS), so a stuck state can never hold a row.
export const MIGRATE_MAX_MS = 3 * 60_000;
export const migratingNow = (since?: number | null) => (since && Date.now() - since < MIGRATE_MAX_MS ? since : null);

// The cyan, as one value for the pieces below.
const CY = "oklch(84% 0.12 205)";

function useElapsed(since?: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!since) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [since]);
  if (!since) return null;
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

// Two arcs turning: the coin on its way from the curve to the pool.
function Orbit({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden className="shrink-0 animate-spin [animation-duration:1.4s]" style={{ color: CY }}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 14a6 6 0 0 1-6-6" fill="none" stroke="currentColor" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// The moving bar: a light running along a cyan track, for as long as nobody knows how long it takes.
function Bar({ className }: { className?: string }) {
  return (
    <span className={cn("relative block h-[3px] overflow-hidden rounded-full", className)} style={{ background: `color-mix(in oklch, ${CY} 14%, transparent)` }}>
      <i className="absolute inset-y-0 left-0 w-2/5 animate-brand-bar rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${CY}, transparent)` }} />
    </span>
  );
}

// Curve → pool, the two ends of the move, with the light travelling between them.
function Route() {
  return (
    <span className="flex w-full items-center gap-2 text-2xs font-semibold tracking-[0.08em] uppercase">
      <span className="text-muted">Curve</span>
      <Bar className="flex-1" />
      <span style={{ color: CY }}>PumpSwap</span>
    </span>
  );
}

// Over the chart: the candles stay visible, a little dimmed, with one small card in the middle.
export function MigratingOverlay({ since }: { since: number }) {
  const t = useElapsed(since);
  if (!migratingNow(since)) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-0 z-[2] grid place-items-center bg-paper/35">
      <div className="relative flex w-72 animate-brand-in flex-col items-center gap-3 overflow-hidden rounded-2xl bg-paper-2/90 px-5 pt-5 pb-4 text-center shadow-sheet backdrop-blur-md"
        style={{ boxShadow: `0 0 0 1px color-mix(in oklch, ${CY} 30%, transparent), 0 18px 50px -18px color-mix(in oklch, ${CY} 45%, transparent)` }}>
        <span aria-hidden className="absolute inset-x-0 -top-16 h-32 rounded-full blur-2xl" style={{ background: `radial-gradient(closest-side, color-mix(in oklch, ${CY} 22%, transparent), transparent)` }} />
        <span className="relative grid size-11 place-items-center rounded-full" style={{ background: `color-mix(in oklch, ${CY} 12%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${CY} 30%, transparent)` }}>
          <Orbit size={22} />
        </span>
        <span className="relative flex flex-col gap-1">
          <b className="text-md font-semibold text-ink">Migrating to PumpSwap</b>
          <span className="text-xs text-muted">Trading opens the moment the pool is live{t ? <> · <span className="num font-medium text-ink-2">{t}</span></> : null}</span>
        </span>
        <span className="relative w-full"><Route /></span>
      </div>
    </div>
  );
}

// In a trade panel, above its buttons (which wait).
export function MigratingNote({ since, className }: { since: number; className?: string }) {
  const t = useElapsed(since);
  if (!migratingNow(since)) return null;
  return (
    <div role="status" title={MIGRATING_TIP} className={cn("flex flex-col gap-2 rounded-xl px-3 py-2.5", className)}
      style={{ background: `linear-gradient(180deg, color-mix(in oklch, ${CY} 10%, transparent), color-mix(in oklch, ${CY} 4%, transparent))`, boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${CY} 24%, transparent)` }}>
      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Orbit />
        Migrating · trading paused{t && <span className="num ml-auto text-xs font-medium text-muted">{t}</span>}
      </span>
      <Route />
    </div>
  );
}

// On a coin row (Pulse, Discover): a cyan pill with a light passing through it.
export function MigratingChip({ className }: { className?: string }) {
  return (
    <span title={MIGRATING_TIP} className={cn("relative flex h-6 shrink-0 items-center gap-1.5 overflow-hidden rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", className)}
      style={{ color: CY, background: `color-mix(in oklch, ${CY} 11%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${CY} 32%, transparent), 0 0 14px -6px ${CY}` }}>
      <i aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/2 animate-brand-bar" style={{ background: `linear-gradient(90deg, transparent, color-mix(in oklch, ${CY} 22%, transparent), transparent)` }} />
      <Orbit size={12} />
      <span className="relative">Migrating</span>
    </span>
  );
}
