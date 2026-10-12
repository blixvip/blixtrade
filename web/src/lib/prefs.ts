import { create } from "zustand";
import { store } from "./utils";

// How each visitor likes their Pulse: the size of everything, what a row shows, which columns are open and
// which coins are filtered out. Kept in this browser only, so everyone on the public site has their own.
export type PulseCol = "new" | "running" | "stretch" | "migrated";
// Rug guard: the simplest checks that clear most rugs off the Pulse, each one switch. Pages/Pulse.tsx rugGuard().
export type RugCheck = "devSold" | "top10" | "dev" | "snipers" | "bundle" | "serial" | "dead" | "socials";
export const RUG_CHECKS: [RugCheck, string, string][] = [
  ["devSold", "Dev sold", "Before it bonds: the creator has sold any of their coins"],
  ["top10", "Top 10 hold over 30%", "Once it has 10 holders: a few wallets can dump it"],
  ["dev", "Dev holds over 10%", "After its first minute"],
  ["snipers", "Snipers hold over 25%", "Bots that bought in the first blocks"],
  ["bundle", "Bundled over 25%", "Bought by the dev's own wallets in the launch block"],
  ["serial", "Dev launched 5+ coins", "Serial launchers mostly farm and dump"],
  ["dead", "Under 15 holders after 3 minutes", "Nobody is buying it"],
  ["socials", "No socials", "No X post, website or Telegram"],
];
export interface PulsePrefs {
  scale: number;               // size of the whole interface: 1 = normal (used when autoScale is off)
  // Auto size (the default): the interface is laid out for a 1920 px wide window; on a narrower one (a 1080p laptop at
  // Windows' 125% or 150% scaling gives the browser 1536 or 1280 px) everything shrinks together so the same layout fits,
  // never below 75%. Phones (under 900 px) keep their own layout at 100%.
  autoScale: boolean;
  fit: number;                 // the auto size for this window right now (kept in state so rows re-measure on resize)
  compact: boolean;            // shorter rows: no note line, no contract under the picture
  pills: boolean;              // the audit pills (top 10, dev, snipers, bundle)
  buy: boolean;                // the quick-buy button on each row
  cols: Record<PulseCol, boolean>;
  // filters; null = no limit
  minMcap: number | null; maxMcap: number | null; minVol: number | null; minHolders: number | null;
  maxTop10: number | null; maxDev: number | null; maxAgeMin: number | null;
  socials: boolean;            // only coins with an X post, a website or a Telegram
  rug: boolean;                // Rug guard on
  rugChecks: Record<RugCheck, boolean>;
}
// The size that fits this window: 1 at 1920 px and wider, down to 0.75 at 1440 px and narrower; phones stay at 1.
export const fitScale = () => (typeof window === "undefined" || window.innerWidth < 900 ? 1 : Math.min(1, Math.max(0.75, window.innerWidth / 1920)));
export const PREFS0: PulsePrefs = {
  scale: 1, autoScale: true, fit: fitScale(), compact: false, pills: true, buy: true, cols: { new: true, running: true, stretch: true, migrated: true },
  minMcap: null, maxMcap: null, minVol: null, minHolders: null, maxTop10: null, maxDev: null, maxAgeMin: null, socials: false,
  rug: false, rugChecks: { devSold: true, top10: true, dev: true, snipers: true, bundle: true, serial: true, dead: true, socials: false },
};
export const FILTER_KEYS = ["minMcap", "maxMcap", "minVol", "minHolders", "maxTop10", "maxDev", "maxAgeMin"] as const;

const saved = store.get<Partial<PulsePrefs>>("pulse:prefs", {});
// Someone who picked a size before Auto existed keeps it; everyone else starts on Auto.
const autoSaved = saved.autoScale ?? !(typeof saved.scale === "number" && saved.scale !== 1);
export const usePrefs = create<PulsePrefs>(() => ({ ...PREFS0, ...saved, autoScale: autoSaved, fit: fitScale(), cols: { ...PREFS0.cols, ...saved.cols }, rugChecks: { ...PREFS0.rugChecks, ...saved.rugChecks } }));

// The size in force: the window's fit on Auto, else the chosen one.
export const uiScale = (p: PulsePrefs) => (p.autoScale ? p.fit : p.scale);
// Everything in the app is sized in rem, so the root font size scales all of it at once.
const apply = (p: PulsePrefs) => { const s = uiScale(p); document.documentElement.style.fontSize = s === 1 ? "" : `${16 * s}px`; };
apply(usePrefs.getState());
// On Auto the size follows the window: a resize (or a browser zoom change) re-measures and re-applies.
if (typeof window !== "undefined") {
  let timer: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener("resize", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; const fit = fitScale(); if (fit !== usePrefs.getState().fit) { usePrefs.setState({ fit }); apply(usePrefs.getState()); } }, 120);
  });
}

export function setPrefs(patch: Partial<PulsePrefs>) {
  usePrefs.setState(patch);
  const p = usePrefs.getState();
  store.set("pulse:prefs", p);
  apply(p);
}

// How many filters are on, for the dot on the Settings button.
export const filterCount = (p: PulsePrefs) => FILTER_KEYS.filter((k) => p[k] != null).length + (p.socials ? 1 : 0) + (p.rug ? 1 : 0);
// A Pulse row's height in px for these settings (the list is virtual, so it must be known up front).
export const rowHeight = (p: PulsePrefs) => Math.round((p.compact ? 96 : 116) * uiScale(p));
