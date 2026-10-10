// Each Discover coin's newest live figures (line, market cap, change, live row), per window. Two kinds of answer
// carry them: /api/sparks (asked every 3 s for the rows on screen) and the shared /api/discover lists (every row's
// own `live`). Both are kept answers too (the page server's, lib/coin.ts's), and a new set of rows asks a new
// sparks address, so an older answer often lands after a newer one: drawn as it came, a market cap went
// $846K → $838K → $846K and a row's figures fell back to the list's for a beat. Here every answer is weighed by
// when the server worked it out (`t`), and a coin's figures only ever move forward.
import type { LiveFigures, Tf } from "./parts";

export type Fig = { spark?: (number | [number, number])[]; chg: number | null; mc: number | null; live: LiveFigures | null };
type Kept = Fig & { t: number };
const newest = new Map<string, Kept>();
const taken = new WeakSet<object>();

function put(mint: string, w: string, t: number, f: Fig) {
  const k = `${mint}:${w}`, had = newest.get(k);
  if (had && had.t > t) return;
  // Field by field: an answer that has no line or change for a coin (a Pulse launch in the shared lists) keeps the
  // ones in hand, so the change does not flip between "—" and a figure.
  newest.set(k, had ? { spark: f.spark?.length ? f.spark : had.spark, chg: f.chg ?? had.chg, mc: f.mc ?? had.mc, live: f.live ?? had.live, t } : { ...f, t });
  if (newest.size > 4000) newest.delete(newest.keys().next().value!);
}

// A /api/sparks answer: { w, t, rows: { mint: { spark, mc, chg, live } } }. Each answer object is read once.
export function takeSparks(a: { w: string; t?: number; rows: Record<string, { spark: [number, number][]; mc: number | null; chg: number | null; live: LiveFigures | null }> } | null | undefined) {
  if (!a?.rows || taken.has(a)) return;
  taken.add(a);
  const t = a.t ?? 0;
  for (const [m, x] of Object.entries(a.rows)) put(m, a.w, t, { spark: x.spark, chg: x.chg, mc: x.mc, live: x.live });
}

// A /api/discover answer: { tf, t, tabs: { name: { rows } } }, each row with its line, live cap and `live`.
type SnapRow = { mint: string; spark?: (number | [number, number])[]; spark_chg?: number | null; mc_live?: number | null; live?: LiveFigures | null };
export function takeSnapshot(s: { tf: string; t: number; tabs: Record<string, { rows: SnapRow[] }> } | null | undefined) {
  if (!s?.tabs || taken.has(s)) return;
  taken.add(s);
  for (const tab of Object.values(s.tabs)) for (const r of tab.rows) {
    if (r.live === undefined && !r.spark) continue;
    put(r.mint, s.tf, s.t, { spark: r.spark, chg: r.spark_chg ?? null, mc: r.mc_live ?? null, live: r.live ?? null });
  }
}

export const freshest = (mint: string, tf: Tf | string): Kept | undefined => newest.get(`${mint}:${tf}`);

// Blix's own row per coin (/api/tokens?mints=...), from every answer seen. A list whose coins change asks a new
// address, and until it answers each row lost its audit pills and counts for a beat (txns 0/0, pills "—").
const rowsKept = new Map<string, unknown>();
export function takeRows(a: { rows: { mint: string }[] } | null | undefined) {
  if (!a?.rows || taken.has(a)) return;
  taken.add(a);
  for (const r of a.rows) { rowsKept.delete(r.mint); rowsKept.set(r.mint, r); }
  while (rowsKept.size > 3000) rowsKept.delete(rowsKept.keys().next().value!);
}
export const keptRow = <T,>(mint: string) => rowsKept.get(mint) as T | undefined;

// A list read from elsewhere (Fomo's) that comes back a few coins short for one read: a coin that was in it within the
// last 20 s keeps its place at the end instead of vanishing and coming back.
const seenIn = new Map<string, Map<string, { v: unknown; t: number; i: number }>>();
export function withGrace<T>(list: string, rows: T[], keyOf: (r: T) => string, ms = 20_000): T[] {
  const now = Date.now(), seen = seenIn.get(list) ?? new Map<string, { v: unknown; t: number; i: number }>();
  seenIn.set(list, seen);
  const here = new Set<string>();
  rows.forEach((r, i) => { const k = keyOf(r); here.add(k); seen.set(k, { v: r, t: now, i }); });
  const late: { v: unknown; i: number }[] = [];
  for (const [k, s] of seen) { if (here.has(k)) continue; if (now - s.t > ms) seen.delete(k); else late.push(s); }
  return late.length ? [...rows, ...late.sort((a, b) => a.i - b.i).map((s) => s.v as T)] : rows;
}
