// The two windows any page can open: Exchange (deposit, convert, buy) and the launcher (search). Their stores
// live here so the rail and pages can open them without pulling in their code; main.tsx fetches each window's
// own file on hover, focus, or opening.
import { create } from "zustand";

export const loadExchange = () => import("@/components/Exchange");
export const loadLauncher = () => import("@/components/Launcher");
export const warmExchange = () => { void loadExchange().catch(() => {}); };
export const warmLauncher = () => { void loadLauncher().catch(() => {}); };

export type ExchangeTab = "convert" | "deposit" | "buy";
export const useExchange = create<{ tab: ExchangeTab | null }>(() => ({ tab: null }));
export const openExchange = (tab: ExchangeTab = "deposit") => useExchange.setState({ tab });

export const useLauncher = create<{ open: boolean }>(() => ({ open: false }));
export const openLauncher = () => useLauncher.setState({ open: true });

// "/" or Ctrl+K opens the launcher over any page.
addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable;
  if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); openLauncher(); }
});

// The first-run tour (components/Welcome.tsx): opened once, when a new account's wallet has just been made.
// Remembered in this browser so a second wallet setup (another device's account reset) does not show it twice.
export const useWelcome = create<{ open: boolean }>(() => ({ open: /[?&]welcome\b/.test(location.search) }));
// On since 2026-10-10 (owner approved). Only a brand-new account reaches it (its wallet is made once), and this
// browser remembers it was shown. ?welcome previews it any time.
const WELCOME_ON = true;
export const openWelcome = () => {
  if (!WELCOME_ON) return;
  try { if (localStorage.getItem("blix:welcomed")) return; localStorage.setItem("blix:welcomed", "1"); } catch { /* storage blocked: show it anyway */ }
  useWelcome.setState({ open: true });
};
