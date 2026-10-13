import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from './api';
import { setPx } from './livepx';

export type MetricField = { value: number; source: string; observedAt: number; receivedAt: number; calculatedAt: number; maxAgeMs: number; estimated: boolean; partial: boolean; provisional: boolean; coverage?: number | null };
export type MetricCoin = { mint: string; revision: number; fields: Record<string, MetricField> };
const values = new Map<string, MetricCoin>(), listeners = new Map<string, Set<() => void>>();
export const metricSession = crypto.randomUUID();
let boot = 0;
export function receiveMetrics(data: { boot?: number; coins?: MetricCoin[] }, excluded: (mint: string) => boolean = () => false) {
  if (data.boot && data.boot < boot) return;
  if (data.boot && data.boot > boot) { boot = data.boot; values.clear(); }
  for (const coin of data.coins || []) {
    if (!coin?.mint || !coin.fields || excluded(coin.mint) || (values.get(coin.mint)?.revision ?? -1) >= coin.revision) continue;
    values.set(coin.mint, { ...coin, fields: { ...values.get(coin.mint)?.fields, ...coin.fields } });
    const mc = coin.fields.mc?.value;
    const field = coin.fields.mc;
    if (Number.isFinite(mc) && mc > 0 && Date.now() - field.observedAt <= field.maxAgeMs) setPx([[coin.mint, mc]], false, true, field.observedAt);
    listeners.get(coin.mint)?.forEach(fn => fn());
  }
  if (values.size > 30_000) for (const mint of values.keys()) { if (!listeners.has(mint)) values.delete(mint); if (values.size <= 20_000) break; }
}
export function useMetrics(mint?: string | null) {
  return useSyncExternalStore(useCallback((fn: () => void) => {
    if (!mint) return () => {};
    let set = listeners.get(mint); if (!set) listeners.set(mint, (set = new Set()));
    set.add(fn); return () => { set.delete(fn); if (!set.size) listeners.delete(mint); };
  }, [mint]), () => mint ? values.get(mint) : undefined);
}
// The latest metrics of a coin outside React (a column filter deciding whether a row shows).
export const metricsOf = (mint?: string | null) => mint ? values.get(mint) : undefined;
export const metricNumber = (coin: MetricCoin | undefined, field: string, fallback?: number | null) => {
  const value = coin?.fields[field]?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
export function metricDescription(field?: MetricField) {
  if (!field) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - field.observedAt) / 1000));
  return `${field.estimated ? 'Estimated · ' : ''}${field.partial ? 'Partial coverage · ' : ''}${field.provisional ? 'Awaiting confirmation · ' : ''}${seconds > field.maxAgeMs / 1000 ? 'Stale · ' : ''}${seconds}s since source update · ${field.source}`;
}

const interests = new Map<symbol, { mint: string; active: boolean }>();
let timer: number | undefined, soon: number | undefined, busy = false, pending = false;
async function refresh() {
  soon = undefined; if (busy) { pending = true; return; }
  const rows = [...interests.values()];   // a background tab keeps its interests: its coin stays collected
  const mints = [...new Set(rows.sort((a, b) => Number(b.active) - Number(a.active)).map(x => x.mint))].slice(0, 200), active = rows.find(x => x.active)?.mint || '';
  busy = true;
  try { receiveMetrics(await api(`metrics?session=${metricSession}&m=${mints.join(',')}&active=${active}`), replayed); } catch {} finally {
    busy = false;
    if (pending) { pending = false; changed(); }
  }
}
let replayed: (mint: string) => boolean = () => false;
export const metricReplayGuard = (fn: (mint: string) => boolean) => { replayed = fn; };
function changed() {
  if (!soon) soon = window.setTimeout(refresh, 150);
  if (interests.size && !timer) timer = window.setInterval(refresh, 5000);
  if (!interests.size && timer) { clearInterval(timer); timer = undefined; }
}
document.addEventListener('visibilitychange', changed);
// Ref-counted by component, intersection-observed, and shared through one browser request.
export function useMetricVisibility(mint?: string | null, active = false) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!mint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;
    const key = Symbol(mint);
    const update = (visible: boolean) => { if (visible) interests.set(key, { mint, active }); else interests.delete(key); changed(); };
    const observer = new IntersectionObserver(entries => update(entries.some(x => x.isIntersecting)), { rootMargin: '80px' });
    if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); interests.delete(key); changed(); };
  }, [mint, active]);
  return useCallback((element: HTMLElement | null) => { ref.current = element; }, []);
}
