// A coin's price over the list's window (5m / 1h / 24h) as a small line. Points are [time 0..1 of the window,
// price] from /api/tokens. A coin younger than the window is drawn across its whole life (full width, as Fomo
// and Axiom draw it) instead of as a sliver at the right edge. The colour follows `chg`, the change figure shown beside it,
// so the line and the number never disagree. Old servers sent plain prices; those are drawn evenly.
import { cn } from "@/lib/utils";

type Pt = number | [number, number];

export function Spark({ v, chg, w = 88, h = 34, className }: { v?: Pt[]; chg?: number | null; w?: number; h?: number; className?: string }) {
  if (!v || v.length < 2) return <span className={cn("text-sm text-muted", className)}>—</span>;
  const raw: [number, number][] = v.map((p, i) => (Array.isArray(p) ? p : [i / (v.length - 1), p]));
  const x0 = raw[0][0], xs = raw[raw.length - 1][0] - x0 || 1;
  const pts: [number, number][] = raw.map(([x, p]) => [(x - x0) / xs, p]);
  const ps = pts.map((p) => p[1]), lo = Math.min(...ps), hi = Math.max(...ps), span = hi - lo || hi || 1;
  const up = chg != null ? chg >= 0 : ps[ps.length - 1] >= ps[0];
  const col = `var(--color-${up ? "up" : "down"})`, pad = 2, base = h - 2;
  const xy = pts.map(([x, p]) => `${(pad + x * (w - 2 * pad)).toFixed(1)},${(base - 2 - ((p - lo) / span) * (h - 8)).toFixed(1)}`);
  const xa = (pad + pts[0][0] * (w - 2 * pad)).toFixed(1), xb = (pad + pts[pts.length - 1][0] * (w - 2 * pad)).toFixed(1);
  const id = `spk${up ? "u" : "d"}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={cn("shrink-0", className)} aria-hidden>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={col} stopOpacity="0.28" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
      <polygon points={`${xa},${base} ${xy.join(" ")} ${xb},${base}`} fill={`url(#${id})`} />
      <polyline points={xy.join(" ")} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* The latest price: the line's live end. */}
      <circle cx={xy[xy.length - 1].split(",")[0]} cy={xy[xy.length - 1].split(",")[1]} r="2" fill={col} />
    </svg>
  );
}
