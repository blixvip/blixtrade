import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { pageHref } from "@/lib/route";
import { openExchange, openLauncher, warmExchange, warmLauncher } from "@/lib/modals";
import { CoinImg } from "@/components/page";
import { AccountAvatar } from "@/components/AccountAvatar";
import { ClipCoin } from "@/components/ClipCoin";
import { AccountMenu, WalletMenu } from "@/components/WalletMenu";
import { compact, pct, tone } from "@/lib/format";
import { usePulse } from "@/lib/pulse";
import { loadMe, useDesktop, useMe } from "@/lib/ui";
import { depositPaper, loadPaperWallet, setPaper, setPaperBalance, useTrade, type PaperWallet } from "@/lib/mode";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useShallow } from "zustand/react/shallow";
import { PoweredBy, SolanaLogo } from "@/components/brand";
import { Icon } from "./icons";
import { NavIcon } from "./navIcons";
import { Flash } from "@/components/Live";
import { OWNER_ONLY, useRole, useLiveWallets } from "@/lib/role";

// The shell: a side rail with every page (the owner prefers the rail to a top nav), and a strip across
// the top of the page with what is moving, the search, Deposit and the wallet.
type Item = [route: string, label: string, icon: ComponentType<SVGProps<SVGSVGElement>>];
// Account's icon: the signed-in person's own picture (Google's), the plain icon for a visitor or a picture-less account.
function AccountIcon({ className }: SVGProps<SVGSVGElement>) {
  const me = useMe((s) => s.me);
  if (!me?.signedIn || !me.picture) return <NavIcon.account className={className} />;
  return <AccountAvatar me={me} className={cn(className, "size-5 ring-1 ring-rule-2")} />;
}
const MAIN: Item[] = [["coins", "Discover", NavIcon.discover], ["", "Pulse", NavIcon.pulse], ["feed", "Feed", NavIcon.feed], ["narratives", "Narratives", NavIcon.narratives],
  ["traders", "Top traders", NavIcon.traders], ["launch", "Create", NavIcon.launch], ["ai-picks", "AI early picks", NavIcon.picks], ["account", "Portfolio", AccountIcon]];
const MORE: Item[] = [["health", "Health", NavIcon.health], ["api", "API", NavIcon.api], ["mcp", "MCP", NavIcon.mcp], ["settings", "Settings", NavIcon.settings]];
// Every page, for anything that needs a page's name (main.tsx).
export const NAV: { group: string; items: Item[] }[] = [{ group: "Main", items: MAIN }, { group: "More", items: MORE }];

// The rail's lockup: the eye (Blix's app icon) on a raised tile, then the chrome BLIX wordmark (brand art, black
// background masked away by its own brightness). Static: no idle glow, blur or sheen.
const WORD_MASK = { maskImage: "url(brand/blix-chrome-sm.webp)", maskMode: "luminance", maskSize: "100% 100%", WebkitMaskImage: "url(brand/blix-chrome-sm.webp)", WebkitMaskSize: "100% 100%" } as const;
function Mark() {
  return (
    <span className="flex items-center gap-2">
      <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-[11px] bg-black shadow-[inset_0_1px_0_oklch(100%_0_0/0.16),0_0_0_1px_oklch(100%_0_0/0.09),0_6px_14px_-6px_oklch(0%_0_0/0.7)]">
        <img src="brand/blix-eye.webp" alt="" width={96} height={96} decoding="async" draggable={false} className="size-full scale-[1.08] object-cover select-none" />
      </span>
      <span style={WORD_MASK} className="block aspect-[300/130] h-10 shrink-0"><img src="brand/blix-chrome-sm.webp" alt="Blix" width={300} height={130} decoding="async" draggable={false} className="block size-full select-none" /></span>
    </span>
  );
}

// Solana's own logomark, wherever an amount is in SOL (components/brand.tsx).
export const Sol = SolanaLogo;

// The top-bar search opens the launcher (components/Launcher.tsx); "/" and Ctrl+K open it from anywhere.
function Search() {
  return (
    <button onPointerEnter={warmLauncher} onFocus={warmLauncher} onClick={openLauncher} aria-label="Search coins"
      className="flex h-9 w-64 min-w-0 items-center gap-2 rounded-full border border-rule-2 bg-paper px-3 text-muted transition-colors duration-100 hover:border-muted max-xl:w-48 max-lg:w-28 max-md:w-9 max-md:justify-center max-md:px-0">
      <Icon.search className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left text-md max-md:hidden">Search by token or CA</span>
      <kbd className="rounded-chip border border-rule-2 px-1.5 text-xs text-muted max-md:hidden">/</kbd>
    </button>
  );
}

function Wallet() {
  if (!useLiveWallets()) return null;
  return <OwnerWallet />;
}
function OwnerWallet() {
  const owner = useRole() === "owner";
  useEffect(() => { loadMe(); const t = setInterval(() => { if (!document.hidden) loadMe(); }, 30_000); return () => clearInterval(t); }, []);
  return (
    <>
      <button onPointerEnter={warmExchange} onFocus={warmExchange} onClick={() => openExchange("deposit")} className="flex h-9 items-center rounded-full bg-ink px-4 text-md font-semibold whitespace-nowrap text-on-fill max-sm:px-3 transition-transform duration-100 hover:bg-focus active:scale-[0.97]">Deposit</button>
      <WalletMenu />
      <AccountMenu items={shown(FOOT, owner)} />
    </>
  );
}

// What is moving right now: the first few coins of the "running" list. Desktop only (not mounted on phones). It
// reads just the four figures it shows, flat, so a coin changing anything else does not draw the tape again.
const TAPE = 24, TAPE_FIELDS = 4;
function Tape() {
  const desktop = useDesktop();
  return desktop ? <TapeRow /> : <div className="min-w-0 flex-1" />;
}
function TapeRow() {
  const flat = usePulse(useShallow((s) => {
    const out: (string | number | null)[] = [];
    for (const m of s.cols.running.slice(0, TAPE)) { const c = s.coins[m]; if (c) out.push(m, c.symbol || null, c.mcap ?? null, c.chg1m ?? c.chg5 ?? null); }
    return out;
  }));
  const coins: { mint: string; symbol: string | null; mcap: number | null; chg: number | null }[] = [];
  for (let i = 0; i < flat.length; i += TAPE_FIELDS) coins.push({ mint: flat[i] as string, symbol: flat[i + 1] as string | null, mcap: flat[i + 2] as number | null, chg: flat[i + 3] as number | null });
  if (!coins.length) return <div className="min-w-0 flex-1" />;
  return (
    <div className="flex h-5 min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-4 overflow-hidden text-md whitespace-nowrap">
      <Icon.pulse className="size-3.5 shrink-0 text-muted" />
      {coins.map((c) => {
        const chg = c.chg;
        return (
          <a key={c.mint} href={`#/coin/${c.mint}`} className="flex items-center gap-1.5 text-ink-2 hover:text-ink">
            <span className="relative size-4 shrink-0 overflow-hidden rounded-chip bg-paper-4"><CoinImg mint={c.mint} /></span>
            <b className="font-semibold text-ink">{c.symbol || "?"}</b><Flash value={c.mcap} className="font-normal text-muted">{compact(c.mcap)}</Flash>
            {chg != null && <span className={cn("num", tone(chg))}>{pct(chg)}</span>}
          </a>
        );
      })}
    </div>
  );
}

// The paper balance in the top bar: exact under 1,000, then short (9.99K, 123.5K, 1.23M; the exact figure is its
// tooltip) so the bar never runs off a phone.
const paperSol = (n: number) => { const a = Math.abs(n); return a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(a >= 1e4 ? 1 : 2)}K` : n.toFixed(2); };

// The rail: Discover, Pulse and Feed first (the owner's order), then the rest, Narratives under Create. API, MCP, Account and
// Settings sit apart at the bottom. Health is off the rail (still at #/health).
const SIDE: (Item | [...Item, string])[] = [["coins", "Discover", NavIcon.discover], ["", "Pulse", NavIcon.pulse, "LIVE"], ["feed", "Feed", NavIcon.feed],
  ["traders", "Top traders", NavIcon.traders],
  ["launch", "Create", NavIcon.launch, "NEW"],
  ["ai-picks", "AI early picks", NavIcon.picks],
  // Under Create (the owner, 2026-10-10); AI early picks stays right under Create as its sub-item.
  ["narratives", "Narratives", NavIcon.narratives],
  ["practice", "Practice", NavIcon.replay]];
const FOOT: Item[] = [["api", "API", NavIcon.api], ["mcp", "MCP", NavIcon.mcp], ["account", "Account", AccountIcon], ["settings", "Settings", NavIcon.settings]];

// One page in the rail. The page you are on sits on a raised tile with its icon filled in; the rest are outlines.
function RailLink({ item: [route, label, Ic, badge], active }: { item: Item | [...Item, string]; active: boolean }) {
  return (
    <a href={pageHref(route)} aria-current={active ? "page" : undefined}
      className={cn("group relative flex h-9 min-w-0 items-center gap-2.5 rounded-[10px] px-2.5 text-[0.9375rem] font-medium tracking-[-0.01em] whitespace-nowrap transition-[background-color,color] duration-150",
        active ? "bg-paper-4 text-ink shadow-[inset_0_1px_0_oklch(100%_0_0/0.06),0_1px_2px_oklch(0%_0_0/0.35)]" : "text-ink-2 hover:bg-paper-3/70 hover:text-ink")}>
      <Ic className={cn("size-[18px] shrink-0 transition-colors duration-150 [&_.duo]:transition-opacity [&_.duo]:duration-150", active ? "text-ink [&_.duo]:opacity-25" : "text-muted group-hover:text-ink-2")} />
      <span className="min-w-0 truncate">{label}</span>
      {badge === "LIVE" ? (
        <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] font-bold tracking-[0.06em] text-up">
          <i className="relative flex size-1.5"><i className="absolute inset-0 animate-ping rounded-full bg-up/60 motion-reduce:animate-none" /><i className="relative size-1.5 rounded-full bg-up" /></i>LIVE
        </span>
      ) : badge ? (
        <span className="ml-auto shrink-0 rounded-full bg-ink/[0.08] px-1.5 py-px text-[10px] font-bold tracking-[0.06em] text-ink-2 shadow-[inset_0_0_0_1px_oklch(100%_0_0/0.08)]">{badge}</span>
      ) : null}
    </a>
  );
}

// The rail's foot: who is signed in (to the account page), then API, MCP and Settings as a row of icon buttons.
function RailFoot({ route, owner }: { route: string; owner: boolean }) {
  const me = useMe((s) => s.me);
  const tools = shown(FOOT.filter(([r]) => r !== "account"), owner);
  const name = me?.signedIn ? me.name || me.email?.split("@")[0] || "Account" : "Sign in";
  return (
    <div className="mt-auto flex flex-col gap-1.5 border-t border-rule pt-2.5">
      <a href={pageHref("account")} aria-current={route === "account" ? "page" : undefined}
        className={cn("flex min-w-0 items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors duration-150", route === "account" ? "bg-paper-4" : "hover:bg-paper-3/70")}>
        <AccountIcon className="size-7 shrink-0 text-muted" />
        <span className="flex min-w-0 flex-col leading-tight">
          <b className="truncate text-sm font-semibold text-ink">{name}</b>
          <span className="truncate text-xs text-muted">{me?.signedIn ? "Portfolio & wallet" : "Save trades and theses"}</span>
        </span>
      </a>
      <div className="flex items-center gap-1 px-0.5">
        {tools.map(([r, label, Ic]) => (
          <Tip key={r} tip={label}>
            <a href={pageHref(r)} aria-label={label} aria-current={route === r ? "page" : undefined}
              className={cn("grid h-8 flex-1 place-items-center rounded-[9px] transition-colors duration-150", route === r ? "bg-paper-4 text-ink" : "text-muted hover:bg-paper-3/70 hover:text-ink")}>
              <Ic className="size-[17px]" />
            </a>
          </Tip>
        ))}
      </div>
    </div>
  );
}

// Practice on phones, at the end of the bottom bar (on desktop it is a rail item).
function ReplayLink() {
  return (
    <a href="#/practice" className="flex w-1/5 shrink-0 snap-start flex-col items-center gap-1 py-2 text-2xs whitespace-nowrap text-muted">
      <NavIcon.replay className="size-4.5" />Practice
    </a>
  );
}

// What this person's rail shows: a member or visitor does not get the owner's pages.
const shown = <T extends Item | [...Item, string]>(items: T[], owner: boolean) => owner ? items : items.filter((it) => !OWNER_ONLY.has(it[0]));

export function Rail({ route }: { route: string }) {
  const owner = useRole() === "owner";
  return (
    <aside className="flex h-dvh w-52 shrink-0 flex-col border-r border-rule bg-paper/80 px-2.5 pt-4 pb-2.5 max-md:hidden">
      <a href="#/" aria-label="Blix, home" className="mb-3 block self-start rounded-[10px] px-1.5 py-0.5"><Mark /></a>
      <PoweredBy />
      <nav aria-label="Pages" className="flex min-h-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto [scrollbar-width:none]">
        {shown(SIDE, owner).map((it) => <RailLink key={it[0]} item={it} active={route === it[0]} />)}
      </nav>
      <RailFoot route={route} owner={owner} />
    </aside>
  );
}

// The paper-trading switch: on, every buy and sell button trades fake SOL from the paper wallet, and the
// SOL left in it shows here. Remembered in this browser.
function PaperSwitch() {
  const paper = useTrade((s) => s.paper), w = useTrade((s) => s.wallet);
  const owner = useLiveWallets();
  useEffect(() => {
    if (!paper) return;
    loadPaperWallet();
    const t = window.setInterval(() => { if (!document.hidden) loadPaperWallet(); }, 8000);
    return () => clearInterval(t);
  }, [paper]);
  // A two-way mode picker (Real | Paper), as trading terminals show it: the side in use is filled, and paper
  // carries its fake balance inside it. Members without real wallets see Real greyed out, with the reason.
  const seg = "flex h-full items-center gap-1.5 rounded-full px-3 transition-colors duration-100 max-sm:gap-1 max-sm:px-2";
  // In paper mode, clicking Paper (or its balance) opens the balance editor: set an exact amount or top up.
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  useEffect(() => { if (!paper) setOpen(false); }, [paper]);
  return (
    <div ref={box} className="relative shrink-0">
      <div role="radiogroup" aria-label="Trading mode" className="flex h-9 items-center rounded-full border border-rule-2 bg-paper-2 p-0.5 text-sm font-semibold whitespace-nowrap">
        <button role="radio" aria-checked={!paper} disabled={!owner} onClick={() => setPaper(false)}
          title={owner ? "Trade with real SOL from your Blix wallet" : "Live trading is not open to members yet"}
          className={cn(seg, !paper ? "bg-paper-4 text-ink" : "text-muted hover:text-ink-2", !owner && "cursor-not-allowed opacity-40 hover:text-muted")}>Live</button>
        <button role="radio" aria-checked={paper} aria-haspopup="dialog" aria-expanded={paper ? open : undefined} onClick={() => (paper ? setOpen(!open) : setPaper(true))}
          title={paper ? "Change your paper balance" : "Paper trading: fake SOL at real prices"}
          className={cn(seg, paper ? "bg-warn/15 text-warn hover:bg-warn/20" : "text-muted hover:text-ink-2")}>
          Paper
          {paper && w && <span className="num flex items-center gap-1 border-l border-warn/25 pl-1.5 font-medium max-sm:pl-1 text-ink"><SolanaLogo className="size-3 max-sm:hidden" />{paperSol(w.cash)}
            <svg viewBox="0 0 10 6" aria-hidden className={cn("size-2 text-warn transition-transform duration-100 max-sm:hidden", open && "rotate-180")}><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>}
        </button>
      </div>
      {open && w && <PaperBalance w={w} onDone={() => setOpen(false)} />}
    </div>
  );
}

// The paper balance editor under the switch: type the SOL you want to have, or top up in one tap. Neither resets
// anything: open positions, history and the profit and loss stay (server/paper.js setPaperBalance, depositPaper).
function PaperBalance({ w, onDone }: { w: PaperWallet; onDone: () => void }) {
  const [v, setV] = useState(() => String(+w.cash.toFixed(3))), [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<PaperWallet>, done: (x: PaperWallet) => string) => {
    setBusy(true);
    try { const x = await fn(); toast(done(x)); setV(String(+x.cash.toFixed(3))); } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const target = Number(v), ok = v.trim() !== "" && Number.isFinite(target) && target >= 0 && Math.abs(target - +w.cash.toFixed(3)) > 1e-9;   // the box shows 3 decimals
  const set = () => { if (ok) run(() => setPaperBalance(target), (x) => `Paper balance set to ${+x.cash.toFixed(3)} SOL`).then(onDone); };
  const usdOf = (sol: number) => (w.solUsd > 0 ? `$${(sol * w.solUsd).toLocaleString("en-US", { maximumFractionDigits: sol * w.solUsd >= 100 ? 0 : 2 })}` : null);
  const dollars = usdOf(w.cash);
  return (
    <div role="dialog" aria-label="Paper balance"
      className="absolute top-11 right-0 z-50 w-80 overflow-hidden rounded-2xl border border-warn/25 bg-gradient-to-b from-paper-3 to-paper-2 shadow-sheet max-sm:fixed max-sm:inset-x-3 max-sm:top-14 max-sm:w-auto">
      {/* What you have to spend, big, with a soft amber glow: this is the paper desk, not your wallet. */}
      <div className="relative px-4 pt-4 pb-3.5">
        <span aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-40 rounded-full bg-warn/20 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-full bg-warn/15 ring-1 ring-warn/40"><SolanaLogo className="size-4" /></span>
          <span className="flex min-w-0 flex-col leading-tight">
            <b className="text-sm font-semibold text-ink">Paper balance</b>
            <span className="text-xs text-ink-2">Fake SOL · real prices</span>
          </span>
          <span className="ml-auto rounded-full bg-warn/15 px-2 py-0.5 text-2xs font-bold tracking-wider text-warn ring-1 ring-warn/30 ring-inset">PAPER</span>
        </div>
        <div className="relative mt-3.5 flex items-baseline gap-2">
          <Flash value={w.cash} className="num text-[2rem] leading-none font-bold tracking-tight text-ink">{(+w.cash.toFixed(3)).toLocaleString("en-US", { maximumFractionDigits: 3 })}</Flash>
          <span className="text-sm font-semibold text-ink-2">SOL</span>
          {dollars && <span className="num ml-auto text-sm text-ink-2">{dollars}</span>}
        </div>
      </div>
      <div className="border-t border-rule bg-paper/50 px-4 pt-3 pb-4">
        <span className="text-2xs font-bold tracking-wider text-ink-2 uppercase">Set balance to</span>
        <form onSubmit={(e) => { e.preventDefault(); set(); }} className="mt-1.5 flex items-center gap-2">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-rule-2 bg-paper px-3 transition-colors focus-within:border-warn/70 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-warn)_18%,transparent)]">
            <SolanaLogo className="size-4 shrink-0" />
            <input autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))} onFocus={(e) => e.target.select()}
              aria-label="Paper balance in SOL" className="num min-w-0 flex-1 bg-transparent text-lg font-semibold text-ink outline-none" />
            <span className="text-sm font-medium text-ink-2">SOL</span>
          </label>
          <button type="submit" aria-disabled={busy || !ok || undefined}
            className={cn("h-11 rounded-xl px-5 text-sm font-bold transition-[background-color,transform] duration-100 active:scale-[0.97]",
              ok && !busy ? "bg-warn text-on-fill hover:brightness-110" : "cursor-default bg-warn/20 text-warn ring-1 ring-warn/30 ring-inset active:scale-100")}>{busy ? "…" : "Set"}</button>
        </form>
        <span className="mt-3.5 block text-2xs font-bold tracking-wider text-ink-2 uppercase">Top up</span>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {[1, 5, 10, 50].map((n) => (
            <button key={n} onClick={() => { if (!busy) void run(() => depositPaper(n), (x) => `Added ${n} SOL · ${+x.cash.toFixed(3)} SOL to spend`); }}
              className="num flex h-10 flex-col items-center justify-center rounded-xl border border-warn/25 bg-warn/[0.07] leading-none text-warn transition-[background-color,border-color,transform] duration-100 hover:border-warn/60 hover:bg-warn/15 active:scale-[0.96]">
              <b className="text-sm font-bold">+{n}</b><span className="mt-0.5 text-[0.5625rem] font-semibold tracking-wider text-warn/70">SOL</span>
            </button>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-snug text-ink-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-px size-3.5 shrink-0 text-muted" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
          Your open positions and trade history stay as they are.
        </p>
      </div>
    </div>
  );
}

// Across the top of the page: what is moving, then the coin on the clipboard (if any), the search, the paper switch, Deposit and the wallet.
export function TopBar() {
  return (
    <header className="flex h-13 shrink-0 items-center gap-3 border-b border-rule bg-paper/80 px-3 max-md:gap-2">
      <a href="#/" aria-label="Blix" className="hidden shrink-0 max-md:block max-[379px]:hidden!"><img src="brand/blix-chrome-sm.webp" alt="Blix" width={300} height={130} draggable={false} className="h-6 w-auto mix-blend-screen select-none" /></a>
      <Tape />
      <div className="ml-auto flex shrink-0 items-center gap-2.5 max-md:gap-2">
        <ClipCoin />
        <Search />
        <PaperSwitch />
        <Wallet />
      </div>
    </header>
  );
}

// Phones: the rail does not fit, so the main pages sit along the bottom.
export function BottomBar({ route }: { route: string }) {
  const [end, setEnd] = useState(false);
  const owner = useRole() === "owner";
  return (
    <nav aria-label="Pages" onScroll={(e) => { const n = e.currentTarget; setEnd(n.scrollLeft + n.clientWidth >= n.scrollWidth - 2); }}
      className={cn("hidden shrink-0 snap-x overflow-x-auto border-t border-rule bg-paper-2 [scrollbar-width:none] max-md:flex", !end && "[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)]")}>
      {/* Every page, the main ones first; it scrolls sideways for the rest. */}
      {shown([...SIDE, ...FOOT] as Item[], owner).map(([r, label, Ic]) => (
        <a key={r} href={pageHref(r)} aria-current={route === r ? "page" : undefined}
          className={cn("flex w-1/5 shrink-0 snap-start flex-col items-center gap-1 py-2 text-2xs whitespace-nowrap", route === r ? "text-ink" : "text-muted")}>
          <Ic className="size-4.5" />{label}
        </a>
      ))}
      <ReplayLink />
    </nav>
  );
}
