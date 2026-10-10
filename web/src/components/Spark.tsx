// A coin's price over the list's window (5m / 1h / 24h) as a small line. Points are [time 0..1 of the window,
// price] from /api/tokens or /api/sparks. A coin younger than the window is drawn across its whole life (full width,
// as Fomo and Axiom draw it) instead of as a sliver at the right edge. The colour follows `chg`, the change figure
// shown beside it, so the line and the number never disagree. Old servers sent plain prices; those are drawn evenly.
//
// Drawn smooth and steady: the points are resampled to N even steps, eased with a short moving average (the
// server holds quiet stretches flat, which read as hard stairs at this size) and joined by a monotone curve, so
// the line never overshoots the real high or low. With the same N on every update, a new answer morphs the
// line into its new shape (CSS transition on `d`) instead of redrawing it. Each coin (`k`) keeps its last good
// line, so a poll that comes back without one never blanks it; a coin with no line yet shows a faint baseline.
// `end`: the coin's live market cap, which moves the right end as it trades.
//
// The lines last drawn are also kept in this browser (KEEP below), so a page opened fresh draws every coin's line
// in its first frame and the live answer then moves it, rather than a column of blanks filling in.
import { useId } from "react";
import { cn } from "@/lib/utils";

type Pt = number | [number, number];
const N = 44;
const last = new Map<string, Pt[]>();
// key -> the N steps it was last drawn with, the most recent last; written at most every 10 s and when the page
// is left. Fine to lose (a private window, cleared data): the lines then come with the first answer as before.
const KEEP = "blix:sparks", KEEP_MAX = 400;
const drawn = new Map<string, number[]>();
let saving = 0;
function save() {
  clearTimeout(saving); saving = 0;
  try { localStorage.setItem(KEEP, JSON.stringify(Object.fromEntries([...drawn].map(([k, ys]) => [k, ys.map((y) => +y.toPrecision(5))])))); } catch { /* storage full or off */ }
}
function keepDrawn(k: string, ys: number[]) {
  drawn.delete(k); drawn.set(k, ys);
  if (drawn.size > KEEP_MAX) drawn.delete(drawn.keys().next().value!);
  // Written when the browser has a free moment: 400 lines take a few milliseconds to put into text.
  saving ||= window.setTimeout(() => ("requestIdleCallback" in window ? requestIdleCallback(save, { timeout: 3000 }) : save()), 10_000);
}
if (typeof window !== "undefined") {
  try {
    const kept = JSON.parse(localStorage.getItem(KEEP) || "null") as Record<string, number[]> | null;
    for (const [k, ys] of Object.entries(kept || {})) if (Array.isArray(ys) && ys.length === N && ys.every((y) => typeof y === "number" && isFinite(y))) { last.set(k, ys); drawn.set(k, ys); }
  } catch { /* storage off */ }
  addEventListener("pagehide", () => { if (saving) save(); });
}
// Coins (`mint:window`) that have had a live line from /api/sparks. A list row for one of them that comes back
// without its live line keeps the remembered live one, rather than flipping to the list's own (different) line.
// Its change figure is kept the same way (the list's own 24h change can disagree with the line by a lot).
const liveLines = new Map<string, number | null>();
export const noteLive = (key: string, chg: number | null) => { liveLines.set(key, chg); if (liveLines.size > 5000) liveLines.delete(liveLines.keys().next().value!); };
export const sparkOrKeep = <T extends { spark?: Pt[]; spark_chg?: number | null }>(r: T, key: string): T =>
  (liveLines.has(key) ? { ...r, spark: undefined, spark_chg: liveLines.get(key) ?? r.spark_chg } : r);

function resample(v: Pt[]): number[] {
  const raw: [number, number][] = v.map((p, i) => (Array.isArray(p) ? p : [i / (v.length - 1), p]));
  const x0 = raw[0][0], xs = raw[raw.length - 1][0] - x0 || 1;
  const pts = raw.map(([x, p]) => [(x - x0) / xs, p] as [number, number]);
  // The price at each of N even steps: the last point at or before it (the line holds between trades).
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    while (j + 1 < pts.length && pts[j + 1][0] <= x) j++;
    out.push(pts[j][1]);
  }
  out[N - 1] = pts[pts.length - 1][1];
  // A 3-step moving average softens the stairs; both ends stay exact.
  const sm = out.map((y, i) => (i === 0 || i === N - 1 ? y : (out[i - 1] + 2 * y + out[i + 1]) / 4));
  return sm;
}

// Fritsch-Carlson monotone cubic through evenly spaced points: smooth, and never beyond a neighbouring value.
function curve(xs: number[], ys: number[]) {
  const n = xs.length, d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const f = (n: number) => n.toFixed(2);
  let p = `M${f(xs[0])},${f(ys[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (xs[i + 1] - xs[i]) / 3;
    p += `C${f(xs[i] + h)},${f(ys[i] + m[i] * h)} ${f(xs[i + 1] - h)},${f(ys[i + 1] - m[i + 1] * h)} ${f(xs[i + 1])},${f(ys[i + 1])}`;
  }
  return p;
}

const morph = { transition: "d 420ms cubic-bezier(0.16, 1, 0.3, 1), cy 420ms cubic-bezier(0.16, 1, 0.3, 1), stroke 300ms, fill 300ms" } as const;

export function Spark({ v, chg, w = 88, h = 34, className, k, end }: { v?: Pt[]; chg?: number | null; w?: number; h?: number; className?: string; k?: string; end?: number | null }) {
  const uid = useId().replace(/:/g, "");
  if (v && v.length >= 2) { if (k) { last.delete(k); last.set(k, v); if (last.size > 3000) last.delete(last.keys().next().value!); } }
  else if (k && last.has(k)) v = last.get(k);
  const pad = 2, base = h - 2;
  if (!v || v.length < 2) {
    // No line yet: a faint baseline in its place, so the column keeps its shape and nothing jumps when it comes.
    return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={cn("shrink-0", className)} aria-hidden><path d={`M${pad},${h / 2}H${w - pad}`} stroke="var(--color-rule-2)" strokeWidth="1.5" strokeDasharray="2 3" strokeLinecap="round" /></svg>;
  }
  const ys = resample(v);
  // The live figure moves the line's end (and its last step) between answers.
  if (end && end > 0) { ys[N - 1] = end; ys[N - 2] = (ys[N - 2] * 2 + end) / 3; }
  if (k) keepDrawn(k, ys);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || hi || 1;
  const up = chg != null ? chg >= 0 : ys[N - 1] >= ys[0];
  const col = `var(--color-${up ? "up" : "down"})`;
  const X = ys.map((_, i) => pad + (i / (N - 1)) * (w - 2 * pad));
  const Y = ys.map((y) => base - 2 - ((y - lo) / span) * (h - 8));
  const line = curve(X, Y);
  const id = `spk${uid}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={cn("shrink-0 overflow-visible", className)} aria-hidden>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={col} stopOpacity="0.3" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line}L${X[N - 1].toFixed(2)},${base}L${X[0].toFixed(2)},${base}Z`} fill={`url(#${id})`} style={morph} />
      <path d={line} fill="none" stroke={col} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" style={morph} />
      {/* The latest price: the line's live end. */}
      <circle cx={X[N - 1]} cy={Y[N - 1]} r="2.2" fill={col} style={morph} />
    </svg>
  );
}
