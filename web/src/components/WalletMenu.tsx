import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { AccountAvatar } from "@/components/AccountAvatar";
import { SolanaLogo } from "@/components/brand";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toast";
import { openExchange, warmExchange } from "@/lib/modals";
import { usePulse } from "@/lib/pulse";
import { useMe } from "@/lib/ui";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";

// The top bar's two menus, as Axiom has them. The balance pill opens the wallet panel: total value (in SOL or USDC),
// the SOL and USDC held, copy the address, Deposit and Withdraw. The avatar opens the account menu: Account,
// Settings, MCP, API and Log out. Signed out, both still just open the account page (sign in).
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const UsdcLogo = ({ className }: { className?: string }) => <img src="brand/pay/usdc.png" alt="" className={cn("shrink-0 rounded-full", className)} />;
type Unit = "SOL" | "USDC";

// Withdraw lives on the account page (it needs a fresh sign-in check): the panel asks it to open its dialog.
let withdrawWanted = false;
export const takeWithdraw = () => { const w = withdrawWanted; withdrawWanted = false; return w; };
export const WITHDRAW_EVENT = "blix:withdraw";
const askWithdraw = () => {
  withdrawWanted = true;
  if (location.hash.startsWith("#/account")) window.dispatchEvent(new Event(WITHDRAW_EVENT));
  else location.hash = "#/account";
};

// Open/close for a menu under its button: a click elsewhere, Escape or a page change closes it.
function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const nav = () => setOpen(false);
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc); window.addEventListener("hashchange", nav);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); window.removeEventListener("hashchange", nav); };
  }, [open]);
  return { open, setOpen, box };
}
const panel = "absolute top-11 right-0 z-50 overflow-hidden rounded-card border border-rule-2 bg-paper-2 shadow-sheet";
const avatarCls = "grid size-9 shrink-0 place-items-center overflow-hidden rounded-full border border-rule-2 bg-black transition-colors duration-100 hover:border-muted";
const pillCls = "flex h-9 items-center gap-2 rounded-full border border-rule-2 bg-paper px-3 text-md font-medium whitespace-nowrap text-ink transition-colors duration-100 hover:border-muted max-sm:hidden";

const fmt = (n: number, max = 2) => n.toLocaleString(undefined, { maximumFractionDigits: max });

export function WalletMenu() {
  const me = useMe((s) => s.me);
  const liveSolUsd = usePulse((s) => s.live.solUsd) || 0;
  const { open, setOpen, box } = usePopover();
  const [unit, setUnitState] = useState<Unit>(() => store.get<Unit>("wallet:unit", "SOL"));
  const setUnit = (u: Unit) => { store.set("wallet:unit", u); setUnitState(u); };
  if (!me?.signedIn) return <a href="#/account" aria-label="Sign in" className={pillCls}><Icon.wallets className="size-4 text-muted" />Sign in</a>;

  const w = me.wallet, sol = w?.sol ?? 0;
  const solPrice = w && w.sol > 0 && w.solUsd ? w.solUsd / w.sol : liveSolUsd;
  const usdc = w?.tokens?.find((t) => t.mint === USDC)?.ui ?? 0;
  const totalUsd = w ? (w.solUsd ?? sol * solPrice) + (w.tokens || []).reduce((a, t) => a + (t.usd ?? 0), 0) : null;
  const total = totalUsd == null ? "—" : unit === "USDC" ? `$${fmt(totalUsd)}` : solPrice ? fmt(totalUsd / solPrice, 3) : "—";
  const copy = async () => {
    if (!me.address) return;
    try { await navigator.clipboard.writeText(me.address); toast("Solana address copied"); } catch { toast(me.address); }
  };
  const go = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div ref={box} className="relative shrink-0">
      <button aria-label="Your wallet" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} onPointerEnter={warmExchange}
        className={cn(pillCls, open && "border-muted")}>
        <Icon.wallets className="size-4 text-muted" /><SolanaLogo className="size-3.5" /><span className="num">{w ? fmt(sol, 3) : "—"}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Your wallet" className={cn(panel, "w-80 max-w-[calc(100vw-1.5rem)]")}>
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="text-md text-ink-2 underline decoration-rule-2 decoration-dashed underline-offset-4">Total Value</span>
              {me.address && <button onClick={copy} title={`Copy ${me.address}`} className="ml-auto flex items-center gap-1 text-md text-ink-2 transition-colors duration-100 hover:text-ink">
                <Icon.copy className="size-3.5" />Sol</button>}
            </div>
            <div className="num flex items-center gap-2 text-2xl font-semibold text-ink">
              {unit === "SOL" && total !== "—" && <SolanaLogo className="size-5" />}{total}
            </div>
            <div className="flex items-center gap-2">
              <Segmented value={unit} options={[["SOL", "SOL"], ["USDC", "USDC"]]} onChange={setUnit} label="Show the total in" />
              <a href="#/settings" onClick={() => setOpen(false)} aria-label="Settings" title="Settings" className="ml-auto grid size-8 place-items-center rounded-full text-ink-2 transition-colors duration-100 hover:bg-paper-3 hover:text-ink">
                <Icon.settings className="size-4.5" /></a>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-rule border-y border-rule">
            <div className="flex flex-col gap-1 p-4"><span className="num flex items-center gap-2 text-xl font-semibold text-ink"><SolanaLogo className="size-4" />{w ? fmt(sol, 4) : "—"}</span><span className="text-md text-muted">SOL</span></div>
            <div className="flex flex-col gap-1 p-4"><span className="num flex items-center gap-2 text-xl font-semibold text-ink"><UsdcLogo className="size-4" />{w ? fmt(usdc) : "—"}</span><span className="text-md text-muted">USDC</span></div>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4">
            <button onClick={go(() => openExchange("deposit"))} className="flex h-10 items-center justify-center rounded-full bg-ink text-md font-semibold text-on-fill transition-transform duration-100 hover:bg-focus active:scale-[0.97]">Deposit</button>
            <button onClick={go(askWithdraw)} className="flex h-10 items-center justify-center rounded-full bg-paper-4 text-md font-semibold text-ink transition-colors duration-100 hover:bg-paper-5 active:scale-[0.97]">Withdraw</button>
          </div>
        </div>
      )}
    </div>
  );
}

// The avatar's menu: who is signed in, then the account pages (the rail's footer items) and Log out.
export type MenuItem = [route: string, label: string, icon: ComponentType<SVGProps<SVGSVGElement>>];
const ORDER = ["account", "settings", "mcp", "api"];
export function AccountMenu({ items }: { items: MenuItem[] }) {
  const me = useMe((s) => s.me);
  const { open, setOpen, box } = usePopover();
  if (!me?.signedIn) return <a href="#/account" aria-label="Sign in" title="Sign in" className={avatarCls}><AccountAvatar me={me} /></a>;
  const row = "flex h-10 items-center gap-3 rounded-control px-3 text-md text-ink-2 transition-colors duration-100 hover:bg-paper-3 hover:text-ink";
  return (
    <div ref={box} className="relative shrink-0">
      <button aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} title={me.name || me.email || "Account"} onClick={() => setOpen(!open)}
        className={cn(avatarCls, open && "border-muted")}>
        <AccountAvatar me={me} />
      </button>
      {open && (
        <div role="menu" aria-label="Account" className={cn(panel, "w-64 max-w-[calc(100vw-1.5rem)]")}>
          <div className="flex items-center gap-3 border-b border-rule p-3.5">
            <span className="size-9 shrink-0 overflow-hidden rounded-full"><AccountAvatar me={me} /></span>
            <span className="flex min-w-0 flex-col"><span className="truncate text-md font-semibold text-ink">{me.name || "Account"}</span>{me.email && <span className="truncate text-sm text-muted">{me.email}</span>}</span>
          </div>
          <nav className="flex flex-col p-1.5">
            {[...items].sort((x, y) => ORDER.indexOf(x[0]) - ORDER.indexOf(y[0])).map(([route, label, Ic]) => <a key={route} role="menuitem" href={`#/${route}`} onClick={() => setOpen(false)} className={row}><Ic className="size-4.5 shrink-0" />{label}</a>)}
            {location.hostname.endsWith("blixvip.com") && <a role="menuitem" href="/logout" className={cn(row, "border-t border-rule mt-1 pt-1 rounded-t-none")}><svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-4.5 shrink-0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>Log out</a>}
          </nav>
        </div>
      )}
    </div>
  );
}
