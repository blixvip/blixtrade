// The watchlist: coins starred on their chart (pages/coin/Header.tsx), Discover's coin card (discover/hovercard.tsx) or
// the status bar's Watchlist window. Shown in the strip under the top bar (components/WatchTape.tsx) and in that
// window. Kept in this browser under the older "watchlist" key, so those two keep working as they are, and on the
// account when signed in (api/account/prefs, merged by key beside the trade presets), so every browser the person
// signs in from shows the same coins; the newer copy wins.
import { create } from "zustand";
import { post } from "./api";
import { useMe } from "./ui";
import { store } from "./utils";

export type Star = { mint: string; symbol: string; t?: number };
const MAX = 50;
const load = (): Star[] => { const l = store.get<Star[]>("watchlist", []); return Array.isArray(l) ? l.filter((s) => s && typeof s.mint === "string").slice(0, MAX) : []; };

export const useWatchlist = create<{ list: Star[]; at: number }>(() => ({ list: load(), at: store.get("watchlist-at", 0) }));

let syncTimer = 0;
const sync = () => {
  if (!useMe.getState().me?.signedIn) return;
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => { const s = useWatchlist.getState(); post("account/prefs", { watchlist: s.list, watchAt: s.at }).catch(() => {}); }, 600);
};
const keep = (list: Star[], at = Date.now(), announce = true) => {
  store.set("watchlist", list); store.set("watchlist-at", at);
  useWatchlist.setState({ list, at });
  if (announce) { quiet = true; dispatchEvent(new Event("blix:watchlist")); quiet = false; }
  sync();
};
export const isStarred = (mint: string) => useWatchlist.getState().list.some((s) => s.mint === mint);
export const useStarred = (mint: string | null | undefined) => useWatchlist((s) => Boolean(mint) && s.list.some((x) => x.mint === mint));
// Adds the coin (newest first), or takes it off when it is there. Returns whether it is on the list now.
export function toggleStar(mint: string, symbol: string): boolean {
  const list = useWatchlist.getState().list, on = list.some((s) => s.mint === mint);
  keep(on ? list.filter((s) => s.mint !== mint) : [{ mint, symbol, t: Date.now() }, ...list].slice(0, MAX));
  return !on;
}
export const removeStar = (mint: string) => keep(useWatchlist.getState().list.filter((s) => s.mint !== mint));

// A star pressed by the older code paths (they write the key and raise the event): taken in here.
let quiet = false;
addEventListener("blix:watchlist", () => { if (quiet) return; keep(load(), Date.now(), false); });

// The account's copy arrives with api/account/me: the newer wins; a browser with its own newer list sends it up.
type Prefs = { watchlist?: unknown; watchAt?: unknown } | null | undefined;
let seenFor: string | undefined;
useMe.subscribe((s) => {
  const me = s.me;
  if (!me?.signedIn || me.email === seenFor) return;
  seenFor = me.email;
  const prefs = (me as { prefs?: Prefs }).prefs;
  const theirs = prefs && Array.isArray(prefs.watchlist) ? (prefs.watchlist as Star[]).filter((x) => x && typeof x.mint === "string").slice(0, MAX) : null;
  const mine = useWatchlist.getState();
  if (theirs && Number(prefs!.watchAt || 0) >= mine.at) { store.set("watchlist", theirs); store.set("watchlist-at", Number(prefs!.watchAt) || Date.now()); useWatchlist.setState({ list: theirs, at: Number(prefs!.watchAt) || Date.now() }); quiet = true; dispatchEvent(new Event("blix:watchlist")); quiet = false; }
  else if (mine.at > 0) sync();
});
