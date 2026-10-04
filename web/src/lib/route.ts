import { useSyncExternalStore } from "react";

// Hash routes, identical to the classic page (#/signals, #/picks …) so existing links keep working.
const read = () => location.hash.replace(/^#\/?/, "").split("/")[0];
const subscribe = (fn: () => void) => { addEventListener("hashchange", fn); return () => removeEventListener("hashchange", fn); };
export const useRoute = () => useSyncExternalStore(subscribe, read);
// The part after the page name: the mint in #/coin/<mint>.
export const useRouteArg = () => useSyncExternalStore(subscribe, () => location.hash.replace(/^#\/?/, "").split("/")[1] || "");

// A clock for things that count up on screen (coin ages). One timer, however many readers.
let now = Date.now();
const ticks = new Set<() => void>();
setInterval(() => { if (document.hidden) return; now = Date.now(); ticks.forEach((f) => f()); }, 1000);
export const useNow = () => useSyncExternalStore((fn) => { ticks.add(fn); return () => ticks.delete(fn); }, () => now);
