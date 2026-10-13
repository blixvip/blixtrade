// Coins the trader hid on the Pulse (Axiom's eye button), and the columns they cleared. Hidden is for good: the
// list is kept in this browser (the newest 5,000) and on the account when signed in (api/account/prefs), so every
// device agrees. Clearing a column also draws a line at that moment: a coin created before it never shows in that
// column again, however late a feed gets round to it (the user, 2026-10-12: "when a coin's hidden it should never
// come back", "a four hour old coin will just show up").
import { create } from "zustand";
import { post } from "@/lib/api";
import { useMe } from "@/lib/ui";
import { store } from "@/lib/utils";

const MAX = 5000;
export type HiddenCol = "new" | "running" | "stretch" | "migrated";
interface Hidden { mints: string[]; cleared: Partial<Record<HiddenCol, number>>; at: number; showing: boolean }
type Kept = { mints?: unknown; cleared?: unknown; at?: unknown } | null | undefined;
const clean = (k: Kept): Pick<Hidden, "mints" | "cleared" | "at"> => ({
  mints: Array.isArray(k?.mints) ? [...new Set((k!.mints as unknown[]).filter((m): m is string => typeof m === "string"))].slice(0, MAX) : [],
  cleared: k?.cleared && typeof k.cleared === "object" ? Object.fromEntries(Object.entries(k.cleared as Record<string, unknown>).filter(([c, t]) => ["new", "running", "stretch", "migrated"].includes(c) && typeof t === "number" && t > 0)) : {},
  at: typeof k?.at === "number" ? k.at : 0,
});
const kept = clean({ mints: store.get<string[]>("pulse:hidden", []), cleared: store.get("pulse:cleared", {}), at: store.get("pulse:hidden-at", 0) });
export const useHidden = create<Hidden>(() => ({ ...kept, showing: false }));

let syncTimer = 0;
// The account's copy, a moment after the last change (one request for a burst of hides).
const sync = () => {
  if (!useMe.getState().me?.signedIn) return;
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => { const s = useHidden.getState(); post("account/prefs", { hidden: { mints: s.mints, cleared: s.cleared, at: s.at } }).catch(() => {}); }, 600);
};
const commit = (next: Partial<Pick<Hidden, "mints" | "cleared">>) => {
  const s = useHidden.getState();
  const mints = [...new Set(next.mints ?? s.mints)].slice(0, MAX), cleared = next.cleared ?? s.cleared, at = Date.now();
  useHidden.setState({ mints, cleared, at });
  store.set("pulse:hidden", mints); store.set("pulse:cleared", cleared); store.set("pulse:hidden-at", at);
  sync();
};

export const hideCoins = (mints: string[]) => commit({ mints: [...mints, ...useHidden.getState().mints] });
export const unhideCoin = (mint: string) => commit({ mints: useHidden.getState().mints.filter((m) => m !== mint) });
export const unhideAll = () => commit({ mints: [], cleared: {} });
export const showHidden = (showing: boolean) => useHidden.setState({ showing });
// Clearing a column: everything in it now is hidden, and anything older than this moment stays out of it.
export const clearColumn = (col: HiddenCol, mints: string[]) => commit({ mints: [...mints, ...useHidden.getState().mints], cleared: { ...useHidden.getState().cleared, [col]: Date.now() } });
// A coin that was already around when the column was cleared: `at` is when the coin came to be (its creation, or
// for Migrated its bonding), so a coin that only now arrives on a feed, hours old, is not news.
export const clearedOut = (cleared: Hidden["cleared"], col: HiddenCol, at: number | null | undefined) => Boolean(at && at > 0 && cleared[col] && at < cleared[col]!);

// Signing in: the account's list if it is newer, else this browser's goes up.
let seenFor: string | undefined;
useMe.subscribe((s) => {
  const me = s.me;
  if (!me?.signedIn || me.email === seenFor) return;
  seenFor = me.email;
  const theirs = clean((me as { prefs?: { hidden?: Kept } | null }).prefs?.hidden);
  const mine = useHidden.getState();
  if (theirs.at >= mine.at && (theirs.mints.length || Object.keys(theirs.cleared).length)) {
    useHidden.setState(theirs);
    store.set("pulse:hidden", theirs.mints); store.set("pulse:cleared", theirs.cleared); store.set("pulse:hidden-at", theirs.at);
  } else if (mine.at > 0) sync();
});
