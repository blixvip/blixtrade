import { useEffect, useRef, type ComponentType, type SVGProps } from "react";
import { openExchange } from "@/components/Exchange";
import { compact, pct, tone } from "@/lib/format";
import { usePulse } from "@/lib/pulse";
import { loadMe, useMe, useUi } from "@/lib/ui";
import { loadPaperWallet, setPaper, useTrade } from "@/lib/mode";
import { cn } from "@/lib/utils";
import { useFx, type FxMode } from "@/shader/ShaderField";
import { useShallow } from "zustand/react/shallow";
import { PoweredBy, SolanaLogo } from "@/components/brand";
import { Icon } from "./icons";

// The shell: a side rail with every page (the owner prefers the rail to a top nav), and a strip across
// the top of the page with what is moving, the search, Deposit and the wallet.
type Item = [route: string, label: string, icon: ComponentType<SVGProps<SVGSVGElement>>];
const MAIN: Item[] = [["coins", "Discover", Icon.coins], ["", "Pulse", Icon.pulse], ["wallets", "Trackers", Icon.wallets], ["signals", "Signals", Icon.signals],
  ["picks", "Picks", Icon.picks], ["research", "Research", Icon.research], ["account", "Portfolio", Icon.user]];
const MORE: Item[] = [["narratives", "Narratives", Icon.narratives], ["briefs", "Briefs", Icon.briefs], ["record", "Track record", Icon.record],
  ["health", "Health", Icon.health], ["api", "API", Icon.api], ["mcp", "MCP", Icon.mcp], ["settings", "Settings", Icon.settings]];
// Every page, for anything that needs a page's name (main.tsx).
export const NAV: { group: string; items: Item[] }[] = [{ group: "Main", items: MAIN }, { group: "More", items: MORE }];
const FX: [FxMode, string][] = [["full", "Live"], ["static", "Still"], ["off", "Off"]];
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// The liquid-chrome BLIX wordmark (public/brand). Its black ground is dropped by the screen blend.
function Mark() {
  return (
    <picture>
      <source srcSet="/brand/blix-chrome.webp" type="image/webp" />
      <img src="/brand/blix-chrome.png" alt="Blix" width={600} height={260} decoding="async" className="h-auto w-full mix-blend-screen select-none" draggable={false} />
    </picture>
  );
}

// Solana's own logomark, wherever an amount is in SOL (components/brand.tsx).
export const Sol = SolanaLogo;

function Search() {
  const q = useUi((s) => s.q);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
      e.preventDefault(); ref.current?.focus();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  // A contract address opens that coin; anything else filters the Pulse columns as you type.
  const go = () => { const v = q.trim(); if (MINT.test(v)) { useUi.setState({ q: "" }); location.hash = `#/coin/${v}`; } else if (location.hash.replace(/^#\/?/, "")) location.hash = "#/"; };
  return (
    <label className="flex h-9 w-64 min-w-0 items-center gap-2 rounded-full border border-rule-2 bg-paper px-3 text-muted transition-colors duration-100 focus-within:border-accent-dim max-xl:w-48 max-md:hidden">
      <Icon.search className="size-4 shrink-0" />
      <input ref={ref} value={q} onChange={(e) => useUi.setState({ q: e.target.value })} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="Search by token or CA" aria-label="Search by token or contract address"
        className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
      <kbd className="rounded-chip border border-rule-2 px-1.5 text-xs text-muted">/</kbd>
    </label>
  );
}

function Wallet() {
  const me = useMe((s) => s.me);
  useEffect(() => { loadMe(); const t = setInterval(() => { if (!document.hidden) loadMe(); }, 30_000); return () => clearInterval(t); }, []);
  const initial = (me?.name || me?.email || "?").slice(0, 1).toUpperCase();
  return (
    <>
      <button onClick={() => openExchange("deposit")} className="flex h-9 items-center rounded-full bg-ink px-4 text-md font-semibold whitespace-nowrap text-on-fill transition-transform duration-100 hover:bg-focus active:scale-[0.97]">Deposit</button>
      <a href="#/account" aria-label="Your wallet" className="flex h-9 items-center gap-2 rounded-full border border-rule-2 bg-paper px-3 text-md font-medium whitespace-nowrap text-ink transition-colors duration-100 hover:border-muted max-sm:hidden">
        <Icon.wallets className="size-4 text-muted" />
        {me?.signedIn ? <><Sol className="size-3.5 text-ink-2" /><span className="num">{me.wallet ? me.wallet.sol.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}</span></> : "Sign in"}
      </a>
      <a href="#/account" aria-label="Account" title={me?.signedIn ? me.name || me.email || "Account" : "Sign in"} className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-rule-2 bg-black transition-colors duration-100 hover:border-muted">
        <picture><source srcSet="/brand/bx.webp" type="image/webp" /><img src="/brand/bx.png" alt="" width={36} height={36} draggable={false} className="size-full scale-[1.3] object-cover select-none" /></picture>
      </a>
    </>
  );
}

// What is moving right now: the first few coins of the "running" list.
function Tape() {
  const coins = usePulse(useShallow((s) => s.cols.running.slice(0, 24).map((m) => s.coins[m]).filter(Boolean)));
  if (!coins.length) return <div className="min-w-0 flex-1" />;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-5 overflow-hidden text-md whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-40px),transparent)] max-md:hidden">
      <Icon.pulse className="size-3.5 shrink-0 text-muted" />
      {coins.map((c) => {
        const chg = c.chg1m ?? c.chg5;
        return (
          <a key={c.mint} href={`#/coin/${c.mint}`} className="flex items-center gap-1.5 text-ink-2 hover:text-ink">
            <img src={`/img/${c.mint}`} alt="" className="size-4 rounded-chip bg-paper-4 object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
            <b className="font-semibold text-ink">{c.symbol || "?"}</b><span className="num text-muted">{compact(c.mcap)}</span>
            {chg != null && <span className={cn("num", tone(chg))}>{pct(chg)}</span>}
          </a>
        );
      })}
    </div>
  );
}

// The rail, in the same order as classic Blix. Settings sits apart at the bottom.
const SIDE: (Item | [...Item, string])[] = [["", "Pulse", Icon.pulse, "LIVE"], ["signals", "Signals", Icon.signals], ["picks", "Picks", Icon.picks, "AI"], ["research", "Research", Icon.research],
  ["narratives", "Narratives", Icon.narratives], ["coins", "Discover", Icon.coins], ["wallets", "Trackers", Icon.wallets], ["briefs", "Briefs", Icon.briefs], ["record", "Track record", Icon.record],
  ["health", "Health", Icon.health], ["api", "API", Icon.api], ["mcp", "MCP", Icon.mcp], ["account", "Account", Icon.user]];

function RailLink({ item: [route, label, Ic, badge], active }: { item: Item | [...Item, string]; active: boolean }) {
  return (
    <a href={`#/${route}`} aria-current={active ? "page" : undefined}
      className={cn("group flex h-9 items-center gap-3 rounded-control px-3 text-lg whitespace-nowrap transition-colors duration-100",
        active ? "bg-paper-4 font-semibold text-ink shadow-raised" : "text-ink-2 hover:bg-paper-3 hover:text-ink")}>
      <Ic className={cn("size-4.5 shrink-0", active ? "text-ink" : "text-muted group-hover:text-ink-2")} />
      <span>{label}</span>
      {badge && <em className={cn("ml-auto rounded-chip border px-1.5 text-2xs font-semibold not-italic", badge === "LIVE" ? "border-up/40 text-up" : "border-rule-2 text-muted")}>{badge}</em>}
    </a>
  );
}

export function Rail({ route }: { route: string }) {
  const connected = usePulse((s) => s.connected);
  const { mode, auto, set } = useFx();
  return (
    <aside className="flex h-dvh w-48 shrink-0 flex-col gap-1 border-r border-rule bg-paper/80 px-2 py-3 max-md:hidden">
      <a href="#/" aria-label="Blix, home" className="mb-2 block px-1"><Mark /></a>
      <PoweredBy />
      <nav aria-label="Pages" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {SIDE.map((it) => <RailLink key={it[0]} item={it} active={route === it[0]} />)}
      </nav>
      <div className="mt-auto flex flex-col gap-2 pt-2">
        <RailLink item={["settings", "Settings", Icon.settings]} active={route === "settings"} />
        <div className="flex items-center justify-between gap-2 px-3 text-sm">
          <span className={cn("flex items-center gap-1.5", connected ? "text-up" : "text-warn")}><i className={cn("size-1.5 rounded-full", connected ? "bg-up" : "bg-warn")} />{connected ? "connected" : "connecting"}</span>
          <span className="flex gap-1.5 text-xs" role="radiogroup" aria-label={`Background effect${auto ? " (paused itself: the graphics card was busy)" : ""}`}>
            {FX.map(([m, text]) => (
              <button key={m} role="radio" aria-checked={mode === m} onClick={() => set(m)} className={cn("transition-colors duration-100", mode === m ? "text-ink" : "text-muted hover:text-ink-2")}>{text}</button>
            ))}
          </span>
        </div>
      </div>
    </aside>
  );
}

// The paper-trading switch: on, every buy and sell button trades fake SOL from the paper wallet, and the
// SOL left in it shows here. Remembered in this browser.
function PaperSwitch() {
  const paper = useTrade((s) => s.paper), w = useTrade((s) => s.wallet);
  useEffect(() => {
    if (!paper) return;
    loadPaperWallet();
    const t = window.setInterval(() => { if (!document.hidden) loadPaperWallet(); }, 8000);
    return () => clearInterval(t);
  }, [paper]);
  return (
    <button role="switch" aria-checked={paper} onClick={() => setPaper(!paper)}
      title={paper ? `Paper trading is on: buys and sells use fake SOL (${w ? w.cash.toFixed(3) : "…"} left of ${w ? w.start : "…"}). Click to switch it off.` : "Paper trading is off. Click to trade with fake SOL."}
      className={cn("flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-md font-semibold whitespace-nowrap transition-colors duration-100",
        paper ? "border-warn/60 text-warn" : "border-rule-2 text-muted hover:text-ink-2")}>
      <i className={cn("relative block h-4 w-7 rounded-full transition-colors duration-100", paper ? "bg-warn" : "bg-paper-5")}>
        <i className={cn("absolute top-0.5 block size-3 rounded-full bg-paper transition-[left] duration-100", paper ? "left-3.5" : "left-0.5")} />
      </i>
      Paper
      {paper && w && <span className="num flex items-center gap-1 text-ink"><SolanaLogo className="size-3" />{w.cash.toFixed(2)}</span>}
    </button>
  );
}

// Across the top of the page: what is moving, then the search, the paper switch, Deposit and the wallet.
export function TopBar() {
  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-rule bg-paper/80 px-3">
      <Tape />
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <Search />
        <PaperSwitch />
        <Wallet />
      </div>
    </header>
  );
}

// Phones: the rail does not fit, so the main pages sit along the bottom.
export function BottomBar({ route }: { route: string }) {
  return (
    <nav aria-label="Pages" className="hidden shrink-0 overflow-x-auto border-t border-rule bg-paper-2 [scrollbar-width:none] max-md:flex">
      {/* Every page, the main ones first; it scrolls sideways for the rest. */}
      {([...SIDE, ["settings", "Settings", Icon.settings]] as Item[]).map(([r, label, Ic]) => (
        <a key={r} href={`#/${r}`} aria-current={route === r ? "page" : undefined}
          className={cn("flex w-[4.6rem] shrink-0 flex-col items-center gap-1 py-2 text-2xs whitespace-nowrap", route === r ? "text-ink" : "text-muted")}>
          <Ic className="size-4.5" />{label}
        </a>
      ))}
    </nav>
  );
}