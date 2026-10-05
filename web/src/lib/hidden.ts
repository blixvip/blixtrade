// Coins the visitor hid on the Pulse (Axiom's eye button). Remembered in this browser; the newest 1,000.
import { create } from "zustand";
import { store } from "@/lib/utils";

const MAX = 1000;
interface Hidden { mints: string[]; showing: boolean }
export const useHidden = create<Hidden>(() => ({ mints: store.get<string[]>("pulse:hidden", []), showing: false }));
const save = (mints: string[]) => { const m = [...new Set(mints)].slice(0, MAX); useHidden.setState({ mints: m }); store.set("pulse:hidden", m); };

export const hideCoins = (mints: string[]) => save([...mints, ...useHidden.getState().mints]);
export const unhideCoin = (mint: string) => save(useHidden.getState().mints.filter((m) => m !== mint));
export const unhideAll = () => save([]);
export const showHidden = (showing: boolean) => useHidden.setState({ showing });
