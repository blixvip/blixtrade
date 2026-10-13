import type { Row, Tf } from './parts';
import type { MetricCoin, MetricField } from '@/lib/metrics';

export const metricPrefix = (field?: MetricField, lowerBound = false) => !field?.estimated && field?.partial && lowerBound ? '≥' : '';

// The row and its open card resolve exactly the same numbers; missing is different from zero.
export function discoverNumbers(raw: Row, tf: Tf, metrics?: MetricCoin, liveMc?: number) {
  const number = (name: string, fallback?: number | null, signed = false): number | null => {
    const v = metrics?.fields[name]?.value;
    if (typeof v === 'number' && Number.isFinite(v) && (signed || v >= 0)) return v;
    return typeof fallback === 'number' && Number.isFinite(fallback) && (signed || fallback >= 0) ? fallback : null;
  };
  const k = tf === '5m' ? 'm5' : tf === '1h' ? 'h1' : 'h24';
  const row: Row = { ...raw, liquidity: number('liq', raw.liquidity), fees: number('fees', raw.fees), feesSince: number('feesSince', raw.feesSince),
    snipers: number('snipers', raw.snipers), bundlers: number('bundlers', raw.bundlers), safety_score: number('safety', raw.safety_score),
    safety: { ...raw.safety, totalHolders: number('holders', raw.safety?.totalHolders) ?? undefined, top10: number('top10', raw.safety?.top10) ?? undefined,
      devPct: number('dev', raw.safety?.devPct) ?? undefined, insiderPct: number('insiders', raw.safety?.insiderPct) ?? undefined } };
  const buys = number(`buys${tf}`, raw[`buys_${k}`]), sells = number(`sells${tf}`, raw[`sells_${k}`]);
  const tx = buys != null && sells != null ? buys + sells : null;
  const mc = liveMc ?? number('mc', raw.mc_live ?? raw.mcap), unit = number('priceUsd'), base = number('mc');
  const paired = metrics?.fields.mc?.observedAt === metrics?.fields.priceUsd?.observedAt;
  const price = mc != null && base != null && base > 0 && unit != null && paired ? unit * mc / base : unit;
  return { row, mc, price,
    vol: number(`vol${tf}`, raw[`vol_${k}`]), chg: number(`chg${tf}`, raw.spark_chg ?? raw[`chg_${k}`], true), buys, sells, tx,
    buyShare: tx != null && tx > 0 ? buys! / tx : null };
}
