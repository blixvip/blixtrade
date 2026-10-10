// A new version of the app after a deploy. An open page keeps running the build it loaded, and blixvip.com keeps a
// copy of the page at the edge that is only refreshed behind a view (worker/index.js), so a plain reload can show the
// old build again. Every minute (and when the tab comes back) the page asks which build is on the server
// (GET /api/build, answered by the page server, webapp.js); when it differs from its own, a small bar offers the
// update. Updating asks for the page until it is the new one, clears the service worker's kept copy, then reloads.
// A page that opens on an old build updates itself straight away (below).
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Icon } from "@/shell/icons";
import { api } from "./api";
import { cn } from "./utils";

const own = () => (document.querySelector('script[type="module"][src*="assets/index-"]') as HTMLScriptElement | null)?.getAttribute("src")?.match(/assets\/index-[\w-]+\.js/)?.[0] ?? null;
let fresh: string | null = null;
const subs = new Set<() => void>();
async function check() {
  const mine = own();
  if (!mine || document.hidden) return;
  try {
    const b = await api<{ main?: string | null }>("build");
    if (b?.main && b.main !== mine && b.main !== fresh) { fresh = b.main; subs.forEach((fn) => fn()); }
  } catch { /* the next look */ }
}
// The service worker (public/sw.js) also draws the page it kept from the last visit, and that plain fetch never
// reaches it: the reload then showed the old build again and the bar came back. So: ask until the page names the
// new build (the edge copy refreshes behind the first ask), drop the worker's kept page, then reload from the network.
async function update() {
  for (let i = 0; i < 4; i++) {
    try {
      // no-cache: the Worker skips its edge copy and keeps this fresh one (worker/index.js hardReload).
      const html = await (await fetch(location.pathname, { cache: "no-store", credentials: "same-origin", headers: { "cache-control": "no-cache", pragma: "no-cache" } })).text();
      if (!fresh || html.includes(fresh)) break;
    } catch { /* reload anyway */ }
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  try { await caches.delete("blix-page-v2"); } catch { /* no service worker here */ }
  location.reload();
}

function UpdateBar() {
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { const fn = () => setReady(true); subs.add(fn); return () => { subs.delete(fn); }; }, []);
  if (!ready) return null;
  return (
    <div role="status" className="fixed bottom-12 left-1/2 z-[70] flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 animate-brand-in items-center gap-3 rounded-xl bg-paper-2/90 p-2.5 pl-3 shadow-sheet ring-1 ring-rule-2 backdrop-blur-md">
      <span aria-hidden className="relative grid size-9 shrink-0 place-items-center rounded-lg bg-up/12 text-up ring-1 ring-up/25 ring-inset">
        <Icon.refresh className={cn("size-4", busy && "animate-sweep")} />
        <i className="absolute -top-0.5 -right-0.5 size-2 animate-live-dot rounded-full bg-up ring-2 ring-paper-2" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <b className="block text-sm font-semibold text-ink">Update available</b>
        <span className="block truncate text-xs text-muted">{busy ? "Loading the new version…" : "A newer version of Blix is ready"}</span>
      </span>
      <button onClick={() => setReady(false)} disabled={busy} className="h-8 shrink-0 rounded-lg px-2.5 text-sm font-medium text-muted transition-colors hover:bg-paper-4 hover:text-ink disabled:opacity-40">Later</button>
      <button onClick={() => { setBusy(true); void update(); }} disabled={busy} className="h-8 shrink-0 rounded-lg bg-ink px-3.5 text-sm font-semibold text-on-fill shadow-[inset_0_1px_0_oklch(100%_0_0/0.4)] transition-colors hover:bg-focus disabled:opacity-70">{busy ? "Updating…" : "Update"}</button>
    </div>
  );
}

if (typeof window !== "undefined") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  createRoot(host).render(<UpdateBar />);
  // Opened on an old copy (the service worker or the edge drew the last visit's page): moved to the new build at
  // once, before anyone starts using it, instead of waiting for the bar. Once per build per tab, so it never loops.
  window.setTimeout(async () => {
    await check();
    const key = fresh && `blix:auto-update:${fresh}`;
    if (key && !sessionStorage.getItem(key)) { sessionStorage.setItem(key, "1"); void update(); }
  }, 1200);
  window.setTimeout(check, 15_000);
  window.setInterval(check, 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void check(); });
}
