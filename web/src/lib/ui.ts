import { create } from "zustand";

// What the top bar and the pages share: the search typed in the bar.
export const useUi = create<{ q: string }>(() => ({ q: "" }));

// Who is signed in and what their wallet holds, for the top bar. Asked again every half minute.
export interface Me { signedIn: boolean; email?: string; name?: string | null; picture?: string | null; address?: string;
  wallet?: { sol: number; solUsd?: number; tokens?: { mint: string; ui: number; usd?: number | null }[] } | null; onramp?: { stripe?: boolean } }
export const useMe = create<{ me: Me | null }>(() => ({ me: null }));
export async function loadMe() {
  try {
    const r = await fetch("/api/account/me", { signal: AbortSignal.timeout(20_000) });
    useMe.setState({ me: r.ok ? await r.json() : { signedIn: false } });
  } catch { useMe.setState({ me: { signedIn: false } }); }
}
