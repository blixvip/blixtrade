import { create } from "zustand";
import { toast } from "@/components/ui/toast";
import { api, post } from "./api";
import { store } from "./utils";

// Paper trading: a wallet of fake SOL kept by Blix. Buys are filled at the real quote and take fake SOL
// out; sells put back what the sale would really have returned. Nothing touches the chain or real money.
// The switch is remembered in this browser; the wallet itself lives on the Blix server.
export interface PaperWallet { start: number; cash: number; equity: number; pnl: number; realized: number; open: number; trades: number; unpriced: number; solUsd: number }

export const useTrade = create<{ paper: boolean; wallet: PaperWallet | null }>(() => ({ paper: store.get<boolean>("trade:paper", true), wallet: null }));

export async function loadPaperWallet() {
  try { useTrade.setState({ wallet: await api<PaperWallet>("paper/wallet") }); } catch { /* the bar keeps the last figure */ }
}
export function setPaper(on: boolean) {
  store.set("trade:paper", on);
  useTrade.setState({ paper: on });
  if (on) loadPaperWallet();
}
export async function resetPaperWallet(sol?: number) {
  const d = await post<{ wallet: PaperWallet }>("paper/reset", sol && sol > 0 ? { sol } : {});
  useTrade.setState({ wallet: d.wallet });
  return d.wallet;
}

// Every paper buy and sell button asks this first. With the switch off the buttons do nothing but say so:
// they are paper buttons, and real trades are made from the wallet (Deposit / Portfolio), not from here.
export function paperReady(): boolean {
  if (useTrade.getState().paper) return true;
  toast("Paper trading is off. Switch Paper on in the top bar to trade with fake SOL.");
  return false;
}
