import { lazy, StrictMode, Suspense, useEffect, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { Exchange } from "@/components/Exchange";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { startPulse } from "@/lib/pulse";
import { useRoute, useRouteArg } from "@/lib/route";
import { Account } from "@/pages/Account";
import { Coins } from "@/pages/Coins";
import { Briefs, Health, Record as TrackRecord } from "@/pages/More";
import { Narratives } from "@/pages/Narratives";
import { Picks } from "@/pages/Picks";
import { Pulse } from "@/pages/Pulse";
import { Research } from "@/pages/Research";
import { Settings } from "@/pages/Settings";
import { Signals } from "@/pages/Signals";
import { Wallets } from "@/pages/Wallets";
import { ShaderField } from "@/shader/ShaderField";
import { BottomBar, NAV, Rail, TopBar } from "@/shell/Rail";
import "@/styles/app.css";

const Coin = lazy(() => import("@/pages/Coin").then((m) => ({ default: m.Coin })));

const Api = lazy(() => import("@/pages/Docs").then((m) => ({ default: m.Api })));
const Mcp = lazy(() => import("@/pages/Docs").then((m) => ({ default: m.Mcp })));
const PAGES: Record<string, ComponentType> = { api: Api, mcp: Mcp, settings: Settings, "": Pulse, account: Account, coins: Coins, wallets: Wallets, signals: Signals, picks: Picks, research: Research,
  narratives: Narratives, briefs: Briefs, record: TrackRecord, health: Health };

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
  return (
    <TooltipProvider>
      <ShaderField />
      <div className="flex h-dvh">
        <Rail route={route} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {route === "coin" && arg ? <Suspense fallback={null}><Coin mint={arg} /></Suspense> : View ? <Suspense fallback={null}><View /></Suspense> : <NotPorted route={route} />}
          </main>
          <BottomBar route={route} />
        </div>
      </div>
      <Exchange />
      <Toaster />
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
