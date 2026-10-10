import { useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";

// Hash routes, identical to the classic page (#/signals, #/picks …) so existing links keep working.
const read = () => location.hash.replace(/^#\/?/, "").split("/")[0];
const subscribe = (fn: () => void) => { addEventListener("hashchange", fn); return () => removeEventListener("hashchange", fn); };
export const useRoute = () => useSyncExternalStore(subscribe, read);
// The part after the page name: the mint in #/coin/<mint>.
export const useRouteArg = () => useSyncExternalStore(subscribe, () => location.hash.replace(/^#\/?/, "").split("/")[1] || "");

// A clock for things that count up on screen (coin ages). One timer, however many readers. A replay
// (lib/replay.ts) sets it to the replay clock, so "3s ago" on a replayed trade reads as it did then.
let clock = () => Date.now();
let now = clock();
const ticks = new Set<() => void>();
const tickNow = () => { now = clock(); ticks.forEach((f) => f()); };
export const setClock = (fn: (() => number) | null) => { clock = fn || (() => Date.now()); tickNow(); };
export const nudgeClock = tickNow;
setInterval(() => { if (document.hidden) return; tickNow(); }, 1000);
export const useNow = () => useSyncExternalStore((fn) => { ticks.add(fn); return () => ticks.delete(fn); }, () => now);

// In-app page links. API and MCP stay inside the terminal (pages/Docs.tsx); the public blixvip.com/api and /mcp
// pages (worker/site) are for search engines and visitors who aren't in the app.
export const pageHref = (route: string) => `#/${route}`;

// A whole row that opens a page (a coin in Pulse, Discover, a table): it behaves as a link does. Tab reaches it,
// Enter opens it, Ctrl/Cmd/Shift-click and the middle button open it in a new tab. A click on a link, button or
// field inside the row is left to that control. `href` is an in-app "#/…" address or an outside https one.
const inner = (e: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
  const hit = (e.target as HTMLElement | null)?.closest?.("a,button,input,select,textarea,label,[role=button]");
  return Boolean(hit && hit !== e.currentTarget);
};
const go = (href: string, newTab: boolean) => {
  if (newTab || !href.startsWith("#")) window.open(href.startsWith("#") ? `${location.pathname}${location.search}${href}` : href, "_blank", "noopener");
  else location.hash = href;
};
export function rowLink(href: string) {
  return {
    role: "link" as const,
    tabIndex: 0,
    onClick: (e: MouseEvent) => { if (!inner(e)) go(href, e.ctrlKey || e.metaKey || e.shiftKey); },
    // Chrome on Windows starts autoscroll on a middle press over anything but a link, and the click never comes.
    onMouseDown: (e: MouseEvent) => { if (e.button === 1 && !inner(e)) e.preventDefault(); },
    onAuxClick: (e: MouseEvent) => { if (e.button === 1 && !inner(e)) { e.preventDefault(); go(href, true); } },
    onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" && e.target === e.currentTarget) go(href, e.ctrlKey || e.metaKey); },
  };
}
