// One batched poll shared by mounted Discover and virtualized Pulse rows.
import { useEffect } from "react";
import { create } from "zustand";
import { api } from "@/lib/api";

export const SOL_NETWORK = 1399811149;
export type Face = [handle: string, pic: string, value: number | null];
type Known = Record<string, [count: number, faces: Face[]]>;
export const useKnown = create<{ by: Known }>(() => ({ by: {} }));

const targets = new Map<string, number>();
let timer = 0, soon = 0, busy = false, offset = 0;
const keyFor = (mint: string, network: number) => network === SOL_NETWORK ? mint : `${network}:${mint.toLowerCase()}`;
async function pull() {
  if (busy || !targets.size || document.visibilityState !== "visible") return;
  busy = true;
  const all = [...targets.keys()];
  if (offset >= all.length) offset = 0;
  const batch = all.slice(offset, offset + 100); offset = (offset + batch.length) % all.length;
  try {
    const by = await api<Known>(`fomo/known?${new URLSearchParams({ tokens: batch.join(",") })}`);
    if (by && typeof by === "object" && !Array.isArray(by)) {
      const merged = { ...useKnown.getState().by };
      // Missing means unknown/stale, not zero; never keep old faces indefinitely.
      for (const token of batch) { const [net, mint] = token.split(":"); delete merged[keyFor(mint, Number(net))]; }
      for (const [key, value] of Object.entries(by)) if (Array.isArray(value) && Number.isFinite(value[0]) && Array.isArray(value[1])) merged[key] = value;
      const keys = Object.keys(merged);
      for (const key of keys.slice(0, Math.max(0, keys.length - 2000))) delete merged[key];
      useKnown.setState({ by: merged });
    }
  } catch { /* Keep the last reading during a transient connection failure. */ }
  finally { busy = false; }
}
export function useKnownHolder(mint: string, network = SOL_NETWORK) {
  const key = keyFor(mint, network);
  useEffect(() => {
    const target = `${network}:${network === SOL_NETWORK ? mint : mint.toLowerCase()}`;
    targets.set(target, (targets.get(target) || 0) + 1);
    if (!timer) timer = window.setInterval(pull, 5000);
    clearTimeout(soon); soon = window.setTimeout(pull, 100);
    return () => {
      const n = (targets.get(target) || 1) - 1;
      if (n) targets.set(target, n); else targets.delete(target);
      if (!targets.size) { clearInterval(timer); clearTimeout(soon); timer = 0; offset = 0; }
    };
  }, [mint, network]);
  return useKnown(s => s.by[key]);
}
