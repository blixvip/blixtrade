import { useEffect } from "react";
import { create } from "zustand";
import { api, post } from "./api";
import { memberEmail, useRole, useRoleKnown } from "./role";
import type { Overview, TWallet } from "./wtrack";

const useList = create<{ wallets: TWallet[]; pending: Record<string, boolean>; ready: boolean; error: string | null }>(() => ({ wallets: [], pending: {}, ready: false, error: null }));
let session = "", revision = 0, request: Promise<void> | null = null, readers = 0, timer = 0, lastRead = 0;
export const trackerChanged = () => { revision++; window.dispatchEvent(new Event("blix:tracker-change")); };
export function refreshTracking() {
  if (request) return request;
  const version = revision, identity = session;
  request = api<Overview>("wtrack?limit=1").then(data => {
    if (version === revision && identity === session) useList.setState({ wallets: data.wallets, ready: true, error: null });
  }).catch((e: Error) => {
    if (version === revision && identity === session) useList.setState({ error: e.message });
  }).finally(() => {
    request = null; lastRead = Date.now();
    // A response started before a save must never restore a removed wallet.
    if ((version !== revision || identity !== session) && readers && !session.startsWith("visitor:") && !Object.keys(useList.getState().pending).length) void refreshTracking();
  });
  return request;
}
export function useTracking() {
  const state = useList(), role = useRole(), known = useRoleKnown();
  const identity = `${role}:${memberEmail() || ""}`;
  useEffect(() => {
    if (!known) return;
    if (session !== identity) {
      session = identity; revision++; lastRead = 0;
      useList.setState({ wallets: [], pending: {}, ready: false, error: null });
    }
    if (role === "visitor") return;
    if (Date.now() - lastRead > 2000) void refreshTracking();
    if (++readers === 1) timer = window.setInterval(() => { if (!document.hidden) void refreshTracking(); }, 30_000);
    return () => { if (--readers === 0) clearInterval(timer); };
  }, [known, identity, role]);
  return { ...state, role, known };
}

export async function saveTrackedWallet(wallet: { address: string; name?: string; grp?: number; emoji?: string | null; color?: string | null; pic?: string | null }, on = true) {
  const address = wallet.address;
  if (useList.getState().pending[address]) return;
  const identity = session;
  revision++;
  useList.setState(s => ({ pending: { ...s.pending, [address]: true } }));
  try {
    const row = on ? await post<TWallet>("wtrack/wallets", wallet) : await api<TWallet>(`wtrack/wallets/${address}`, { method: "DELETE" });
    if (identity !== session) return;
    revision++;
    useList.setState(s => ({ wallets: on ? [row, ...s.wallets.filter(w => w.address !== address)] : s.wallets.filter(w => w.address !== address), error: null }));
    trackerChanged();
  } finally {
    if (identity === session) {
      revision++;
      useList.setState(s => { const pending = { ...s.pending }; delete pending[address]; return { pending }; });
      if (!Object.keys(useList.getState().pending).length) void refreshTracking();
    }
  }
}
