import { Component, lazy, StrictMode, Suspense, useEffect, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Exchange } from "@/components/Exchange";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { startPulse } from "@/lib/pulse";
import { useRoute, useRouteArg } from "@/lib/route";
import { Account } from "@/pages/Account";
import { Coins } from "@/pages/Coins";
import { Feed } from "@/pages/Feed";
import { Health } from "@/pages/More";
import { Launch } from "@/pages/Launch";
import { Narratives } from "@/pages/Narratives";
import { Picks } from "@/pages/Picks";
import { Pulse } from "@/pages/Pulse";
import { Research } from "@/pages/Research";
import { Settings } from "@/pages/Settings";
import { Traders } from "@/pages/Traders";
import { XTracker } from "@/pages/XTracker";
import { BottomBar, NAV, Rail, TopBar } from "@/shell/Rail";
import { StatusBar } from "@/shell/StatusBar";
import "@/styles/app.css";

// A page loaded on demand. If its file cannot be fetched (the app was rebuilt while this tab was open, or the radar
// was restarting), try once more, then reload the page once so it picks up the new build; never a blank screen.
const load = <T,>(get: () => Promise<T>) => get().catch(async () => {
  await new Promise((ok) => setTimeout(ok, 800));
  try { return await get(); } catch (e) {
    if (!sessionStorage.getItem("blix:reloaded")) { sessionStorage.setItem("blix:reloaded", "1"); location.reload(); await new Promise(() => {}); }
    throw e;
  }
});
addEventListener("load", () => setTimeout(() => sessionStorage.removeItem("blix:reloaded"), 10_000));

const Coin = lazy(() => load(() => import("@/pages/Coin")).then((m) => ({ default: m.Coin })));
const Trader = lazy(() => load(() => import("@/pages/Trader")).then((m) => ({ default: m.Trader })));
const Profile = lazy(() => load(() => import("@/pages/Profile")).then((m) => ({ default: m.Profile })));

const Api = lazy(() => load(() => import("@/pages/Docs")).then((m) => ({ default: m.Api })));
const Mcp = lazy(() => load(() => import("@/pages/Docs")).then((m) => ({ default: m.Mcp })));

// One page failing (a render error, a page file that would not load) shows this card; the rail, bars and other
// pages keep working. It resets when you go to another page.
class PageGuard extends Component<{ route: string; children: ReactNode }, { error: Error | null; route: string }> {
  state = { error: null as Error | null, route: this.props.route };
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(p: { route: string }, s: { route: string }) { return p.route !== s.route ? { error: null, route: p.route } : null; }
  componentDidCatch(error: Error) { console.error("Blix page error:", error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="flex max-w-md flex-col items-center gap-3 rounded-card border border-rule bg-paper-2 px-6 py-8 text-center">
          <b className="text-lg font-semibold text-ink">This page did not load</b>
          <p className="text-sm text-muted">{/dynamically imported module|Failed to fetch|Importing a module/i.test(this.state.error.message) ? "Blix was updated or restarting while this tab was open." : this.state.error.message}</p>
          <button onClick={() => location.reload()} className="h-9 rounded-full bg-accent px-5 text-md font-semibold text-accent-ink hover:bg-focus">Reload</button>
        </div>
      </div>
    );
  }
}
const PAGES: Record<string, ComponentType> = { api: Api, mcp: Mcp, settings: Settings, "": Pulse, account: Account, coins: Coins, feed: Feed, picks: Picks, research: Research,
  launch: Launch, narratives: Narratives, health: Health, traders: Traders, x: XTracker, u: Profile };

// Pages still served by the classic front end on the radar's own port.
function NotPorted({ route }: { route: string }) {
  const label = NAV.flatMap((g) => g.items).find(([r]) => r === route)?.[1] ?? route;
  return (
    <div className="p-6">
      <h1 className="chrome-text font-display text-2xl font-semibold tracking-tight capitalize">{label}</h1>
      <p className="mt-3 text-ink-2">Not moved to the new front end yet.</p>
      <a className="mt-2 inline-block text-accent hover:text-focus" href={`${location.protocol}//${location.hostname}:4420/#/${route}`}>Open it in classic Blix ›</a>
    </div>
  );
}

function App() {
  const route = useRoute(), arg = useRouteArg(), View = PAGES[route];
  useEffect(() => startPulse(), []);
  // The Signals page is gone; old links land on Pulse.
  useEffect(() => { if (route === "signals") location.replace("#/"); }, [route]);
  return (
    <TooltipProvider>
      <div className="flex h-dvh">
        <Rail route={route} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <PageGuard route={`${route}/${arg || ""}`}>
            {route === "coin" && arg ? <Suspense fallback={null}><Coin mint={arg} /></Suspense> : route === "trader" && arg ? <Suspense fallback={null}><Trader handle={decodeURIComponent(arg)} /></Suspense> : View ? <Suspense fallback={null}><View /></Suspense> : <NotPorted route={route} />}
            </PageGuard>
          </main>
          <BottomBar route={route} />
          <StatusBar />
        </div>
      </div>
      <Exchange />
      <Toaster />
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
