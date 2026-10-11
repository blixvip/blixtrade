// The Pulse filter window, laid out like Axiom's: one window for all three columns (tabs across the top),
// launchpads, keywords, then Audits / $ Metrics / Socials, each figure a Min–Max row, and Import, Export,
// Reset and Apply all along the bottom. Apply all saves every column at once. The sliders button in a
// column header opens it on that column; a blue dot on the button means the column is filtered.
import * as D from "@/components/ui/modal";
import { lazy, Suspense, type ReactNode } from "react";
import { create } from "zustand";
import { isSet, type Filters } from "@/components/filterbits";
import { PadLogo, padOf } from "@/components/logos";
import { Tip } from "@/components/ui/tooltip";
import { metricNumber, metricsOf } from "@/lib/metrics";
import type { Coin, ColKey } from "@/lib/pulse";
import { store } from "@/lib/utils";
import { Icon } from "@/shell/icons";

export type Col = "new" | "running" | "stretch" | "migrated";

export const PADS: [string, string, ReactNode][] = [
  ...(["pump", "bonk", "launchlab", "bags", "moonshot", "meteora"] as const).map((k) => [k, { pump: "Pump", bonk: "Bonk", launchlab: "LaunchLab", bags: "Bags", moonshot: "Moonshot", meteora: "Meteora" }[k], <PadLogo key={k} pad={k} className="size-4 rounded-full" />] as [string, string, ReactNode]),
  ["other", "Other", <i key="o" className="size-2.5 rounded-full border border-muted" />],
];
const KNOWN = new Set(PADS.map(([k]) => k));
// The launchpad a coin is filtered by: its pool, else what its dex or mint says (components/logos.ts padOf).

// What a column starts with in a browser that has never saved filters (a new sign-up): Final Stretch shows coins
// at most 400 minutes old and worth at least $4K, and every column has a floor on the fees traders have paid to
// trade the coin (New Pairs 0.001 SOL, Final Stretch 0.05, Migrated 1), so a rug nobody traded never shows. Reset
// goes back to these.
export const DEFAULTS: Record<Col, Filters> = { new: { feesMin: "0.001" }, running: {}, stretch: { ageMax: "400", mcapMin: "4000", feesMin: "0.05" }, migrated: { feesMin: "1" } };
// Floors a browser may have been given before (2026-10-10 set them higher twice): replaced by the current one.
const OLD_FLOORS: Record<string, string[]> = { new: ["0.01", "0.005"], stretch: ["0.1"] };
export const countFilters = (f: Filters) => Object.values(f).filter(isSet).length;
const load = (c: Col) => {
  const f = store.get<Filters>(`pulse:colf2:${c}`, { ...DEFAULTS[c] });
  // The fee floors arrived on 2026-10-10: a browser with filters saved before gets its column's floor once per
  // floor value (the flag names it), on top of what it had, and an earlier floor moves to the current one;
  // clearing the box afterwards, or typing another number, sticks.
  const floor = DEFAULTS[c].feesMin;
  if (floor && !store.get<boolean>(`pulse:colf2:${c}:fees:${floor}`, false)) {
    store.set(`pulse:colf2:${c}:fees:${floor}`, true);
    if (!isSet(f.feesMin) || (OLD_FLOORS[c] || []).includes(f.feesMin!)) { f.feesMin = floor; store.set(`pulse:colf2:${c}`, f); }
  }
  return f;
};
export function resetColumn(c: Col) { store.set(`pulse:colf2:${c}`, { ...DEFAULTS[c] }); useColFilters.setState((s) => ({ f: { ...s.f, [c]: { ...DEFAULTS[c] } } })); }
interface State { f: Record<Col, Filters>; open: Col | null }
export const useColFilters = create<State>(() => ({ f: { new: load("new"), running: load("running"), stretch: load("stretch"), migrated: load("migrated") }, open: null }));

// The fees traders have paid to trade a coin, in SOL: the row's figure (server/coinfees.js, refreshed with every
// live trade) or the live metric, whichever is newer (fees only grow), so a coin whose fees cross the floor appears
// with the trade that lifts it there.
const feesPaid = (t: Coin) => { const m = metricNumber(metricsOf(t.mint), "fees"); return m == null ? t.fees : t.fees == null ? m : Math.max(m, t.fees); };

// New Pairs must show a coin the instant it is created (the owner: seconds matter), and its fees are only counted
// from blocks a few seconds later, by a follower that reads about half of them. So in that column the fee floor
// waits: a coin under FEE_GRACE old passes whatever its fees say; after that it needs the floor, or, when no fee
// figure has come yet, to have traded at all (a rug nobody touched goes; a coin whose blocks were missed stays).
const FEE_GRACE = 30_000;
function feesFit(t: Coin, lo: string | undefined, hi: string | undefined, col?: Col): boolean {
  const v = feesPaid(t);
  if (isSet(hi) && v != null && v > +hi!) return false;
  if (!isSet(lo)) return true;
  if (col === "new") {
    if (Date.now() - t.born < FEE_GRACE) return true;
    if (v == null) return (t.buys || 0) + (t.sells || 0) > 0;
  }
  return v != null && v >= +lo!;
}

// Does a coin pass a column's filters? A figure that is not known yet passes a "Max" limit and fails a "Min" one
// (New Pairs' fee floor excepted: feesFit).
export function fitsColumn(t: Coin, f: Filters, col?: Col): boolean {
  if (!countFilters(f)) return true;
  const H = t.hl || {};
  const name = `${t.symbol || ""} ${t.name || ""}`.toLowerCase();
  const words = (k: string) => (f[k] || "").toLowerCase().split(",").map((w) => w.trim()).filter(Boolean);
  const kw = words("kw"), xkw = words("xkw");
  if (kw.length && !kw.some((w) => name.includes(w))) return false;
  if (xkw.some((w) => name.includes(w))) return false;
  const pads = (f.pads || "").split(",").filter(Boolean);
  if (pads.length) { const pool = padOf(t), p = KNOWN.has(pool) ? pool : "other"; if (!pads.includes(p)) return false; }
  const figure: Record<string, number | null | undefined> = {
    age: (Date.now() - t.born) / 60_000, top10: H.t10 ?? t.top10, dev: H.dev ?? t.dev, snipers: H.sn, bundle: H.bd, holders: H.h ?? t.holders,
    devCoins: t.devCount, ai: t.ai?.score, mcap: t.mcap, vol: t.vol ?? t.liveVol, tx: (t.buys || 0) + (t.sells || 0), buys: t.buys, sells: t.sells,
    curve: t.graduated ? 100 : t.progress != null ? t.progress * 100 : null,
    snipersN: H.snN, bundleN: H.bdN, devSol: t.devSol, pwin: t.ai?.pwin != null ? t.ai.pwin * (t.ai.pwin <= 1 ? 100 : 1) : null,
    peak: t.peak, liq: t.liq, traders: t.traders, chg1m: t.chg1m, chg5: t.chg5, chg1h: t.chg1h,
  };
  if (!feesFit(t, f.feesMin, f.feesMax, col)) return false;
  // Fees are counted from the chain a little behind the launch: a coin under 5 minutes old with none counted yet
  // is not held back by a fee floor (it would be hidden exactly while it is new).
  const young = Date.now() - t.born < 5 * 60_000;
  for (const [stem, v] of Object.entries(figure)) {
    const lo = f[`${stem}Min`], hi = f[`${stem}Max`];
    if (stem === "fees" && v == null && young && isSet(lo)) continue;
    if (isSet(lo) && (v == null || v < +lo)) return false;
    if (isSet(hi) && v != null && v > +hi) return false;
  }
  if (f.devKept === "1" && H.ds) return false;
  if (f.aiRated === "1" && !t.ai?.rated) return false;
  if (f.aiBuy === "1" && t.ai?.action !== "buy") return false;
  if (f.twitter === "1" && !t.x) return false;
  if (f.website === "1" && !t.web) return false;
  if (f.telegram === "1" && !t.tg) return false;
  if (f.social === "1" && !(t.x || t.web || t.tg || t.tiktok)) return false;
  if (f.noSocial === "1" && (t.x || t.web || t.tg || t.tiktok)) return false;
  if (f.tiktok === "1" && !t.tiktok) return false;
  if (f.paid === "1" && !t.paid) return false;
  if (f.pumpCa === "1" && !t.mint.endsWith("pump")) return false;
  if (f.noWarn === "1" && t.warn) return false;
  return true;
}

// The sliders button in a column header.
export function FilterButton({ col, title }: { col: ColKey; title: string }) {
  const n = useColFilters((s) => countFilters(s.f[col as Col] || {}));
  return (
    <Tip tip={n ? `${n} filter${n === 1 ? "" : "s"} on ${title}` : `Filter ${title}`}>
      <button onClick={() => useColFilters.setState({ open: col as Col })} aria-label={`Filters for ${title}`}
        className="relative grid size-8 shrink-0 place-items-center rounded-control border border-rule-2 text-ink-2 transition-colors duration-100 hover:border-muted hover:text-ink">
        <Icon.sliders className="size-4.5" />
        {n > 0 && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-paper-2 bg-info" />}
      </button>
    </Tip>
  );
}

// The window itself, rendered once on the Pulse; what is inside it (FilterSheet.tsx) loads when it first opens.
const Sheet = lazy(() => import("./FilterSheet").then((m) => ({ default: m.Sheet })));
export function PulseFilters() {
  const open = useColFilters((s) => s.open);
  return (
    <D.Root open={open != null} onOpenChange={(o) => { if (!o) useColFilters.setState({ open: null }); }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <D.Content aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex h-[min(46rem,calc(100dvh-1.5rem))] w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-card border border-rule-2 bg-paper-2 shadow-sheet">
          {open && <Suspense fallback={null}><Sheet start={open} /></Suspense>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

