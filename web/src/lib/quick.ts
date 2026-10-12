// Lightweight state shared by the shell and the coin's trading panel.
import { create } from "zustand";
import { store } from "./utils";

// Remember the last chart's coin. Open stays open: a floating panel follows the trader to every coin they open
// (the user, 2026-10-12), and only its own close button or the dock button puts it away.
type QCoin = { mint: string; symbol: string };
export const useQuick = create<{ open: boolean; coin: QCoin | null }>(() => ({ open: store.get("qt:open", false), coin: store.get<QCoin | null>("qt:coin", null) }));
export const setQuickCoin = (coin: QCoin) => { if (useQuick.getState().coin?.mint === coin.mint && useQuick.getState().coin?.symbol === coin.symbol) return; store.set("qt:coin", coin); useQuick.setState({ coin }); };
export const toggleQuick = () => { const open = !useQuick.getState().open; store.set("qt:open", open); useQuick.setState({ open }); };

export const closeQuick = () => {
  if (!useQuick.getState().open) return;
  store.set("qt:open", false);
  useQuick.setState({ open: false });
};
