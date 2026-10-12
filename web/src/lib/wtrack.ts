// The wallet tracker's store and types (components/WalletTracker.tsx draws it; pages/Tracker.tsx is its page).
// Kept light so the rail and main.tsx can open the floating window without pulling the tracker's code in.
import { create } from "zustand";
import { store } from "@/lib/utils";

export type Tab = "manager" | "trades" | "transfers" | "monitor" | "kols";
export const TABS: [Tab, string][] = [["manager", "Manager"], ["trades", "Live Trades"], ["transfers", "Transfers"], ["monitor", "Monitor"], ["kols", "KOLs"]];

export interface TWallet { address: string; name: string; emoji: string | null; color: string | null; grp: number; alerts: number; added: number; last_trade: number | null; n24: number }
interface Named { name: string; emoji: string | null; color: string | null; grp: number }
interface Coin { symbol: string | null; tname: string | null; mcap: number | null; born: number | null }
export interface TTrade extends Named, Coin { id: number; wallet: string; sig: string; mint: string; side: "buy" | "sell"; sol: number | null; usd: number | null; tokens: number | null; mc_usd: number | null; t: number; src: string }
export interface TTransfer extends Named, Coin { id: number; wallet: string; sig: string; dir: "in" | "out"; mint: string | null; amount: number; usd: number | null; other: string | null; t: number }
export interface Overview { wallets: TWallet[]; feed: TTrade[]; transfers: TTransfer[]; status: { stream: boolean; streamWallets: number; backlog: number; live: boolean; lastLive: number; lastChain: number; fast?: boolean; fastWallets?: number; fastReads?: number; dropped?: number }; solUsd: number; groups: number[]; colors: string[]; max: number }
export interface Position { mint: string; symbol: string | null; held: number; value: number | null; unrealized: number | null; mcap: number | null; last: number }
export interface MonitorWallet extends TWallet { balance: number | null; pnl: { realized: number; unrealized: number; openValue: number; winRate: number | null; closed: number; open: number; trades: number; positions: Position[] } }
export interface Kol { rank: number; wallet: string; name: string | null; pic: string | null; x: string | null; pnl: number | null; pnlSol: number | null; pnlPct: number | null; positions: number | null; tracked: boolean }

export const EMOJIS = ["🐸", "🦍", "👻", "🐋", "🤖", "🧙", "🐂", "🐻", "🚀", "💎", "🔥", "👑", "🦊", "🐍", "🧠", "💰", "🎯", "🍕", "🐼", "👀", "⚡", "🍀", "🎲", "🦈"];
export const COLOR_HEX: Record<string, string> = { pink: "#f472b6", green: "#4ade80", blue: "#60a5fa", orange: "#fb923c", purple: "#c084fc", yellow: "#facc15", cyan: "#22d3ee", red: "#f87171" };
export const nameStyle = (color: string | null | undefined) => (color && COLOR_HEX[color] ? { color: COLOR_HEX[color] } : undefined);

// The floating window: open or not, where it sits, and which tab it is on. Remembered in this browser.
export interface Box { x: number; y: number; w: number; h: number }
export const useTracker = create<{ float: boolean; tab: Tab; grp: number | null; sol: number }>(() => ({
  float: store.get<boolean>("wtrack:float", false), tab: store.get<Tab>("wtrack:tab", "trades"), grp: null, sol: store.get<number>("wtrack:sol", 0.25),
}));
export const setTab = (tab: Tab) => { useTracker.setState({ tab }); store.set("wtrack:tab", tab); };
export const setQuickSol = (sol: number) => { useTracker.setState({ sol }); store.set("wtrack:sol", sol); };
export const openTrackerWindow = () => { useTracker.setState({ float: true }); store.set("wtrack:float", true); };
export const closeTrackerWindow = () => { useTracker.setState({ float: false }); store.set("wtrack:float", false); };
export const loadTracker = () => import("@/components/WalletTracker");
export const warmTracker = () => { void loadTracker().catch(() => {}); };
