import { create } from "zustand";
import { toast } from "@/components/ui/toast";
import { api, post } from "./api";
import { store } from "./utils";

// Paper trading: a wallet of fake SOL kept by Blix. Buys are filled at the real quote and take fake SOL
// out; sells put back what the sale would really have returned. Nothing touches the chain or real money.
// The switch is remembered in this browser; the wallet itself lives on the Blix server.
export interface PaperWallet { start: number; cash: number; equity: number; pnl: number; realized: number; open: number; trades: number; unpriced: number; solUsd: number }

export const useTrade = create<{ paper: boolean; wallet: PaperWallet | null }>(() => ({ paper: store.get<boolean>("trade:paper", true), wallet: null }));

// One read at a time, and none within 2 s of the last (the rail's poll and the role check both ask at startup).
// `fresh`: after a trade, always read again (once any read already under way is done).
let walletAsk: Promise<void> | null = null, walletAt = 0;
// Only a whole wallet replaces the one shown: an answer without its figures (the server mid-restart) once reached
// the rail's paper switch, whose `cash.toFixed` then took the page down.
const isWallet = (w: unknown): w is PaperWallet => Boolean(w) && typeof (w as PaperWallet).cash === "number" && typeof (w as PaperWallet).start === "number";
export function loadPaperWallet(fresh = false): Promise<void> {
  if (walletAsk) return fresh ? walletAsk.then(() => loadPaperWallet(true)) : walletAsk;
  if (!fresh && Date.now() - walletAt < 2000) return Promise.resolve();
  return (walletAsk = api<PaperWallet>("paper/wallet").then((wallet) => { walletAt = Date.now(); if (isWallet(wallet)) useTrade.setState({ wallet }); }, () => { /* the bar keeps the last figure */ }).finally(() => { walletAsk = null; }));
}
// The paper buy sizes (the coin page, its side panel and the quick trade window all want them): one read, shared
// for 30 s.
let sizesAsk: Promise<number[] | null> | null = null;
export function loadPaperSizes(): Promise<number[] | null> {
  if (!sizesAsk) {
    sizesAsk = api<{ sizes?: number[] }>("paper").then((d) => (d.sizes?.length ? d.sizes : null), () => null);
    sizesAsk.then((s) => setTimeout(() => { sizesAsk = null; }, s ? 30_000 : 0));
  }
  return sizesAsk;
}
// A replay (lib/replay.ts) holds Paper on while it runs: switching it off there let the next buy spend real SOL at
// today's price on a coin someone thought they were practising on. Every trade counts as paper meanwhile (trade.ts).
export let paperLocked = false;
export const lockPaper = (on: boolean) => { paperLocked = on; };
export function setPaper(on: boolean) {
  if (!on && paperLocked) { toast("Paper stays on during Practice. Stop the replay to trade with real SOL."); return; }
  store.set("trade:paper", on);
  useTrade.setState({ paper: on });
  if (on) loadPaperWallet();
}
export async function resetPaperWallet(sol?: number) {
  const d = await post<{ wallet: PaperWallet }>("paper/reset", sol && sol > 0 ? { sol } : {});
  if (isWallet(d.wallet)) useTrade.setState({ wallet: d.wallet });
  return d.wallet;
}
// Set the fake SOL left to spend to an exact figure (server/paper.js setPaperBalance): positions and history stay.
export async function setPaperBalance(sol: number) {
  const d = await post<{ wallet: PaperWallet }>("paper/balance", { sol });
  if (isWallet(d.wallet)) useTrade.setState({ wallet: d.wallet });
  return d.wallet;
}
// Add fake SOL without a reset (server/paper.js depositPaper): positions and history stay.
export async function depositPaper(sol: number) {
  const d = await post<{ wallet: PaperWallet }>("paper/deposit", { sol });
  if (isWallet(d.wallet)) useTrade.setState({ wallet: d.wallet });
  return d.wallet;
}

// Every paper buy and sell button asks this first. With the switch off the buttons do nothing but say so:
// they are paper buttons, and real trades are made from the wallet (Deposit / Portfolio), not from here.
export function paperReady(): boolean {
  if (useTrade.getState().paper) return true;
  toast("Paper trading is off. Switch Paper on in the top bar to trade with fake SOL.");
  return false;
}
