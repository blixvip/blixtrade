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
  scale: number;               // size of the whole interface: 1 = normal
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
export const PREFS0: PulsePrefs = {
  scale: 1, compact: false, pills: true, buy: true, cols: { new: true, running: true, stretch: true, migrated: true },
  minMcap: null, maxMcap: null, minVol: null, minHolders: null, maxTop10: null, maxDev: null, maxAgeMin: null, socials: false,
  rug: false, rugChecks: { devSold: true, top10: true, dev: true, snipers: true, bundle: true, serial: true, dead: true, socials: false },
};
export const FILTER_KEYS = ["minMcap", "maxMcap", "minVol", "minHolders", "maxTop10", "maxDev", "maxAgeMin"] as const;

const saved = store.get<Partial<PulsePrefs>>("pulse:prefs", {});
export const usePrefs = create<PulsePrefs>(() => ({ ...PREFS0, ...saved, cols: { ...PREFS0.cols, ...saved.cols }, rugChecks: { ...PREFS0.rugChecks, ...saved.rugChecks } }));

// Everything in the app is sized in rem, so the root font size scales all of it at once.
const apply = (p: PulsePrefs) => { document.documentElement.style.fontSize = p.scale === 1 ? "" : `${16 * p.scale}px`; };
apply(usePrefs.getState());

export function setPrefs(patch: Partial<PulsePrefs>) {
  usePrefs.setState(patch);
  const p = usePrefs.getState();
  store.set("pulse:prefs", p);
  apply(p);
}

// How many filters are on, for the dot on the Settings button.
export const filterCount = (p: PulsePrefs) => FILTER_KEYS.filter((k) => p[k] != null).length + (p.socials ? 1 : 0) + (p.rug ? 1 : 0);
// A Pulse row's height in px for these settings (the list is virtual, so it must be known up front).
export const rowHeight = (p: PulsePrefs) => Math.round((p.compact ? 96 : 116) * p.scale);
