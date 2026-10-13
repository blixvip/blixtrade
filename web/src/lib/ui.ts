import { useSyncExternalStore } from "react";
import { create } from "zustand";

// Desktop width (Tailwind's md, 768 px): parts hidden on phones are not mounted there at all, so they make no
// requests and subscribe to nothing.
const wide = typeof window !== "undefined" ? matchMedia("(min-width: 768px)") : null;
export const useDesktop = () => useSyncExternalStore((f) => { wide?.addEventListener("change", f); return () => wide?.removeEventListener("change", f); }, () => wide?.matches ?? true);

// What the top bar and the pages share: the search typed in the bar.
export const useUi = create<{ q: string; feedFocus: boolean }>(() => ({ q: "", feedFocus: false }));

// Who is signed in and what their wallet holds, for the top bar. Asked again every half minute.
export interface Me { signedIn: boolean; email?: string; name?: string | null; picture?: string | null; address?: string; needsWallet?: boolean; hosted?: boolean;
  wallet?: { sol: number; solUsd?: number; tokens?: { mint: string; ui: number; usd?: number | null }[] } | null; onramp?: { stripe?: boolean };
  prefs?: { presets?: unknown; pi?: unknown; at?: unknown } | null }   // the account's trade presets (lib/presets.ts)
export const useMe = create<{ me: Me | null }>(() => ({ me: null }));
export async function loadMe() {
  try {
    const r = await fetch("api/account/me", { signal: AbortSignal.timeout(20_000) });
    useMe.setState({ me: r.ok ? await r.json() : { signedIn: false } });
  } catch { useMe.setState({ me: { signedIn: false } }); }
}
