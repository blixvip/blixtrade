import { Component, lazy, StrictMode, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/toast";
import { NetNotice } from "@/components/NetNotice";
import { TrackerTape } from "@/components/TrackerTape";
import { gated } from "@/components/DepositGate";
import { PicPreview } from "@/components/PicPreview";
import { TooltipProvider } from "@/components/ui/tooltip";
import { earlyData, earlyReady, fetchApi } from "@/lib/api";
import { pageCode } from "@/lib/pages";
import { loadPulse, startPulse } from "@/lib/pulse";
import { useRoute, useRouteArg } from "@/lib/route";
import { BottomBar, NAV, Rail, TopBar } from "@/shell/Rail";
import { StatusBar } from "@/shell/StatusBar";
import "@/styles/app.css";
import { original } from "@/lib/thumb";
import { OWNER_ONLY, useRole, useRoleKnown } from "@/lib/role";
import { loadExchange, loadLauncher, useExchange, useLauncher, useWelcome } from "@/lib/modals";
import { closeQuick } from "@/lib/quick";
import { useMe, useUi } from "@/lib/ui";
import { loadTracker, useTracker } from "@/lib/wtrack";
import "@/lib/update";   // the "new version" bar after a deploy

// A page loaded on demand. If its file cannot be fetched (the app was rebuilt while this tab was open, or the radar
// was restarting), try once more, then reload the page once so it picks up the new build; never a blank screen.
// A restart of the server behind blixvip.com takes up to a minute, and a page opened meanwhile used to land on
// "This page did not load": its file is asked for again with growing gaps for 25 s first (the page shows its
// loading state meanwhile).
const load = <T,>(get: () => Promise<T>) => get().catch(async () => {
  for (const ms of [500, 1000, 2000, 3500, 6000, 12000]) {
    await new Promise((ok) => setTimeout(ok, ms));
    try { return await get(); } catch { /* still restarting */ }
  }
  try { return await get(); } catch (e) {
    if (!sessionStorage.getItem("blix:reloaded")) { sessionStorage.setItem("blix:reloaded", "1"); location.reload(); await new Promise(() => {}); }
    throw e;
  }
});
addEventListener("load", () => setTimeout(() => sessionStorage.removeItem("blix:reloaded"), 10_000));

// A post's photo (Feed, X tracker, Narratives) whose link has died folds away instead of leaving a sliver of
// border where the picture was (styles/app.css, img[data-broken]). Avatars and icons need nothing: a dead one
// with alt="" draws as its own placeholder disc.
addEventListener("error", (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && /\bmax-h-/.test(img.className)) img.dataset.broken = "";
}, true);
addEventListener("load", (e) => { if (e.target instanceof HTMLImageElement) delete e.target.dataset.broken; }, true);
// A picture asked for through the resizer (lib/thumb.ts) that it could not read: the original, once. Not for a
// small one (an avatar, a logo): the original can be megabytes (a 4.5 MB GIF for a 36 px face was measured), and
// a small picture that fails shows its initial instead.
addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.orig) return;
  if (Math.max(img.clientWidth, img.clientHeight) <= 96) return;
  const o = original(img.currentSrc || img.src);
  if (o) { img.dataset.orig = "1"; delete img.dataset.broken; img.src = o; }
}, true);

// Every page is its own file, fetched when first opened: the first load carries only the shell and the page on
// screen. Other pages warm on navigation intent (lib/coin.ts), keeping unused charts and tools out of startup.
//
// A page whose code is already here is drawn in the same pass as everything around it. React.lazy on its own
// suspends once more even then, and React holds a page back 300 ms once its (empty) fallback has shown: every
// first visit to a page, and the first coin opened, started a third of a second late. Only a page whose code is
// still on its way goes through React.lazy.
type AnyPage = ComponentType<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
type PageOf = AnyPage & { code: () => Promise<void> };
function page<M>(get: () => Promise<M>, pick: (m: M) => AnyPage): PageOf {
  let Here: AnyPage | null = null, asked: Promise<AnyPage> | null = null;
  const fetched = () => (asked ||= load(get).then((m) => (Here = pick(m)), (e) => { asked = null; throw e; }));
  const Later = lazy(() => fetched().then((C) => ({ default: C })));
  // Chosen once per visit: changing from the lazy page to the loaded one part-way would draw the page twice.
  const Page = (props: Record<string, unknown>) => { const [Now] = useState(() => Here); return Now ? <Now {...props} /> : <Later {...props} />; };
  Page.code = () => fetched().then(() => {}, () => {});
  return Page;
}
// Code loads on navigation intent or opening; unopened tools do no background work.
const Exchange = lazy(() => load(loadExchange).then((m) => ({ default: m.Exchange })));
const Launcher = lazy(() => load(loadLauncher).then((m) => ({ default: m.Launcher })));
const Welcome = lazy(() => load(() => import("@/components/Welcome")).then((m) => ({ default: m.Welcome })));
function Modals() {
  const ever = useRef({ x: false, l: false }), xOpen = useExchange((s) => s.tab !== null), lOpen = useLauncher((s) => s.open), wOpen = useWelcome((s) => s.open);
  const x = (ever.current.x ||= xOpen), l = (ever.current.l ||= lOpen);
  return <Suspense fallback={null}>{x && <Exchange />}{l && <Launcher />}{wOpen && <Welcome />}</Suspense>;
}

const Pulse = page(() => import("@/pages/Pulse"), (m) => m.Pulse);
const Coins = page(() => import("@/pages/Coins"), (m) => m.Coins);
const Feed = page(() => import("@/pages/Feed"), (m) => m.Feed);
const Account = page(() => import("@/pages/Account"), (m) => m.Account);
const Health = page(() => import("@/pages/More"), (m) => m.Health);
const Launch = page(() => import("@/pages/Launch"), (m) => m.Launch);
const Narratives = page(() => import("@/pages/Narratives"), (m) => gated("narratives", m.Narratives));
const AiPicks = page(() => import("@/pages/AiPicks"), (m) => gated("picks", m.AiPicks));
const Settings = page(() => import("@/pages/Settings"), (m) => m.Settings);
const Traders = page(() => import("@/pages/Traders"), (m) => m.Traders);
const XTracker = page(() => import("@/pages/XTracker"), (m) => m.XTracker);
const Tracker = page(() => import("@/pages/Tracker"), (m) => m.Tracker);
// The wallet tracker's floating window (components/WalletTracker.tsx): its code loads only once it is opened.
const TrackerWindow = lazy(() => load(loadTracker).then((m) => ({ default: m.TrackerWindow })));
const Coin = page(() => import("@/pages/Coin"), (m) => m.Coin);
const Trader = page(() => import("@/pages/Trader"), (m) => m.Trader);
const Profile = page(() => import("@/pages/Profile"), (m) => m.Profile);
const Practice = page(() => import("@/pages/Practice"), (m) => gated("practice", m.Practice));

const Api = page(() => import("@/pages/Docs"), (m) => m.Api);
const Mcp = page(() => import("@/pages/Docs"), (m) => m.Mcp);

// Every caught error goes to the server's log (POST api/client-error), so a crash anyone sees can be found and fixed.
// At most 10 per visit.
let reported = 0;
function reportError(where: string, route: string, e: Error) {
  if (++reported > 10) return;
  const at = String(e?.stack || "").split("\n").find((l) => /\bat\b|@/.test(l))?.trim() || "";
  fetchApi("api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ where, route, message: String(e?.message || e), at }) }).catch(() => {});
}

// The rail, the bars and the floating windows: one of them failing (an answer with a missing figure while the server
// restarts) must never take the whole page down. It steps aside and is drawn again 3 s later.
class ShellGuard extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  timer = 0;
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`Blix ${this.props.name} error:`, error); reportError(this.props.name, location.hash.slice(2), error); this.timer = window.setTimeout(() => this.setState({ error: null }), 3000); }
  componentWillUnmount() { clearTimeout(this.timer); }
  render() { return this.state.error ? null : this.props.children; }
}

// One page failing (a render error, a page file that would not load) is drawn again twice, a moment apart, before
// this card shows: a failure that came from one bad answer (the server mid-restart) clears by itself and nobody
// sees it. The rail, bars and other pages keep working. It resets when you go to another page.
const RETRIES = 2;
class PageGuard extends Component<{ route: string; children: ReactNode }, { error: Error | null; route: string; tries: number }> {
  state = { error: null as Error | null, route: this.props.route, tries: 0 };
  timer = 0;
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(p: { route: string }, s: { route: string }) { return p.route !== s.route ? { error: null, route: p.route, tries: 0 } : null; }
  componentDidCatch(error: Error) {
    console.error("Blix page error:", error);
    reportError("page", this.props.route, error);
    // A page file that would not load is not retried here (main's load() already tried for 25 s).
    if (this.state.tries < RETRIES && !/dynamically imported module|Failed to fetch|Importing a module/i.test(error.message)) {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.setState((s) => ({ error: null, tries: s.tries + 1 })), 700 + this.state.tries * 1500);
    }
  }
  componentWillUnmount() { clearTimeout(this.timer); }
  render() {
    if (!this.state.error) return this.props.children;
    // Being drawn again in a moment: the page area stays empty meanwhile instead of flashing the card.
    if (this.state.tries < RETRIES && !/dynamically imported module|Failed to fetch|Importing a module/i.test(this.state.error.message)) return null;
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
const PAGES: Record<string, PageOf> = { api: Api, mcp: Mcp, settings: Settings, "": Pulse, account: Account, coins: Coins, feed: Feed,
  launch: Launch, narratives: Narratives, "ai-picks": AiPicks, health: Health, traders: Traders, tracker: Tracker, x: XTracker, u: Profile, practice: Practice };
for (const [route, P] of Object.entries({ ...PAGES, coin: Coin, trader: Trader })) pageCode[route] = P.code;

// Tab names for pages that aren't in the rail.
const TITLES: Record<string, string> = { coin: "Coin", trader: "Trader", u: "Profile", x: "X tracker", practice: "Practice", account: "Portfolio" };

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
  const needsWallet = useMe(s => Boolean(s.me?.signedIn && s.me?.needsWallet));
  const focusFeed = useUi(s => s.feedFocus) && route === 'feed';
  // The wallet tracker's floating window stays over every page but its own.
  const trackerFloat = useTracker((s) => s.float) && route !== "tracker";
  // Google sign-in may land on any page. Start onboarding once the missing wallet is known.
  useEffect(() => { if (needsWallet) location.replace("#/account"); }, [needsWallet]);
  useEffect(() => {
    performance.mark("blix:mounted");
    return startPulse();
  }, []);
  // Leaving the chart closes its floating panel without loading the panel code.
  useEffect(() => { if (route !== "coin") closeQuick(); }, [route]);
  // The tab says which page this is ("Blix | Discover"). A coin's tab is set by its header, live market cap first.
  useEffect(() => {
    if (route === "coin" && arg) return;
    const name = route === "trader" || route === "u" ? decodeURIComponent(arg) : NAV.flatMap((g) => g.items).find(([r]) => r === route)?.[1] ?? TITLES[route];
    document.title = name ? `Blix | ${name}` : "Blix";
  }, [route, arg]);
  // The Signals page is gone; old links land on Pulse.
  // Pulse lives at #/; classic Blix and old bookmarks say #/pulse.
  // Picks and Research were taken out (2026-10-08); their old links land on Pulse too.
  useEffect(() => { if (route === "signals" || route === "pulse" || route === "picks" || route === "research") location.replace("#/"); }, [route]);
  // A member's or visitor's old link to an owner page (settings, wallet, coin launcher) goes to Discover.
  // Only once the server has said who this is: on the guessed role the owner, opening #/settings in a fresh
  // browser on blixvip.com (guessed "member"), was sent away before api/me answered.
  const role = useRole(), roleKnown = useRoleKnown();
  useEffect(() => { if (roleKnown && role !== "owner" && OWNER_ONLY.has(route)) location.replace("#/coins"); }, [role, roleKnown, route]);
  return (
    <TooltipProvider>
      <div className="flex h-dvh">
        {!focusFeed && <ShellGuard name="rail"><Rail route={route} /></ShellGuard>}
        <div className="flex min-w-0 flex-1 flex-col">
          {!focusFeed && <ShellGuard name="topbar"><TopBar /></ShellGuard>}
          {!focusFeed && <ShellGuard name="trackertape"><TrackerTape /></ShellGuard>}
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <PageGuard route={`${route}/${arg || ""}`}>
            {route === "coin" && arg ? <Suspense fallback={null}><Coin mint={arg} /></Suspense> : route === "trader" && arg ? <Suspense fallback={null}><Trader handle={decodeURIComponent(arg)} /></Suspense> : View ? <Suspense fallback={null}><View /></Suspense> : <NotPorted route={route} />}
            </PageGuard>
          </main>
          {!focusFeed && <ShellGuard name="bottombar"><BottomBar route={route} /></ShellGuard>}
          {!focusFeed && <ShellGuard name="statusbar"><StatusBar /></ShellGuard>}
        </div>
      </div>
      {trackerFloat && <ShellGuard name="tracker"><Suspense fallback={null}><TrackerWindow /></Suspense></ShellGuard>}
      <ShellGuard name="modals"><Modals /></ShellGuard>
      <ShellGuard name="toasts"><Toaster /></ShellGuard>
      <ShellGuard name="netnotice"><NetNotice /></ShellGuard>
      <ShellGuard name="picpreview"><PicPreview /></ShellGuard>
    </TooltipProvider>
  );
}

// The page being opened gets its code first (index.html asked for it beside this file; already cached after the
// first visit), so the first frame is the whole page rather than the shell with a hole in it. Never waited on for
// long: index.html's own drawn shell is on screen meanwhile.
// (The marks are for measuring a start: performance.getEntriesByType("mark").)
const first = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
performance.mark("blix:main");
// The same for the answers index.html asked for: they are a few milliseconds away, and drawing without them is a
// skeleton now and the page again a moment later. Given 120 ms from when they were asked, no more.
// And the Pulse board (the home page, and the ticker along the top of every page) goes into its store before
// the first frame when its answer is already here.
Promise.race([pageCode[first]?.() ?? Promise.resolve(), new Promise((ok) => setTimeout(ok, 400))]).then(() => { performance.mark("blix:code"); return earlyReady(120); })
  .then(() => { performance.mark("blix:answers"); return first === "" || earlyData("pulse") ? Promise.race([loadPulse().catch(() => {}), new Promise((ok) => setTimeout(ok, 60))]) : null; })
  .then(() => { performance.mark("blix:render"); createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>); });

// Discover's code comes down a few seconds after start, whatever page opened: it is the page opened most often next.
addEventListener("load", () => { setTimeout(() => { pageCode.coins?.(); }, 3000); }, { once: true });

// Repeat visits on blixvip.com draw from this device's copy of the page and its files (public/sw.js); it asks for a
// reload when it finds this browser signed out behind a kept page.
if (import.meta.env.PROD && "serviceWorker" in navigator && location.hostname === "blixvip.com" && location.pathname === "/app") {
  navigator.serviceWorker.addEventListener("message", (m) => { if (m.data === "blix:reload") location.reload(); });
  addEventListener("load", () => { navigator.serviceWorker.register("/sw.js", { scope: "/app" }).catch(() => {}); }, { once: true });
}
