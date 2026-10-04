import { create } from "zustand";
import { store } from "./utils";

// How each visitor likes their Pulse: the size of everything, what a row shows, which columns are open and
// which coins are filtered out. Kept in this browser only, so everyone on the public site has their own.
export type PulseCol = "new" | "stretch" | "migrated";
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
}
export const PREFS0: PulsePrefs = {
  scale: 1, compact: false, pills: true, buy: true, cols: { new: true, stretch: true, migrated: true },
  minMcap: null, maxMcap: null, minVol: null, minHolders: null, maxTop10: null, maxDev: null, maxAgeMin: null, socials: false,
};
export const FILTER_KEYS = ["minMcap", "maxMcap", "minVol", "minHolders", "maxTop10", "maxDev", "maxAgeMin"] as const;

const saved = store.get<Partial<PulsePrefs>>("pulse:prefs", {});
export const usePrefs = create<PulsePrefs>(() => ({ ...PREFS0, ...saved, cols: { ...PREFS0.cols, ...saved.cols } }));

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
export const filterCount = (p: PulsePrefs) => FILTER_KEYS.filter((k) => p[k] != null).length + (p.socials ? 1 : 0);
// A Pulse row's height in px for these settings (the list is virtual, so it must be known up front).
export const rowHeight = (p: PulsePrefs) => Math.round((p.compact ? 96 : 116) * p.scale);
