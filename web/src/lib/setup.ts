// The recommended setup, applied in one click (Pulse settings, first tab): the three trade presets for the three
// columns, Rug guard on with its checks, every column shown with its default filters, the tracker's one-click buy
// at 0.25 SOL docked to the right, and the quick trade panel floating. What syncs to the account (presets, hidden
// coins) follows the person to every device. (The user, 2026-10-12: "what's the best set up" → "set that up".)
import { setPrefs, PREFS0 } from "@/lib/prefs";
import { pickPreset, savePreset, SELLS, type Preset } from "@/lib/presets";
import { useQuick } from "@/lib/quick";
import { store } from "@/lib/utils";
import { setQuickSol, setTrackerDocked } from "@/lib/wtrack";
import { resetColumn } from "@/pages/pulse/ColumnFilters";

// Snipe: New Pairs, where the curve moves 20% between blocks and the fill matters more than the price.
// Stretch: Final Stretch coins with real volume, where a fill still matters but 20% slippage is money given away.
// Migrated: the pool, where sandwiches are the risk and the book takes tight slippage; MEV protection on.
// Priority fees sit at the vault's 0.003 SOL cap or under it.
export const RECOMMENDED: Preset[] = [
  { name: "Snipe", buys: [0.1, 0.25, 0.5, 1], sells: SELLS, slip: 2000, prio: 0.003, tip: 0.002, mev: false },
  { name: "Stretch", buys: [0.25, 0.5, 1, 2], sells: SELLS, slip: 800, prio: 0.003, tip: 0.001, mev: false },
  { name: "Migrated", buys: [0.5, 1, 2, 5], sells: SELLS, slip: 300, prio: 0.002, tip: 0, mev: true },
];
export const SETUP_LINES: [string, string][] = [
  ["Presets", "P1 Snipe 20% · P2 Stretch 8% · P3 Migrated 3% + MEV, sizes 0.1 to 5 SOL"],
  ["Rug guard", "On, with every check but No socials"],
  ["Columns", "New Pairs, Final Stretch and Migrated all on, at their default filters (no fee floors)"],
  ["Tracker", "One-click buy 0.25 SOL, the window docked to the right"],
  ["Quick trade", "Floating over the chart, following you to every coin"],
];

export function applyRecommendedSetup() {
  RECOMMENDED.forEach((p, i) => savePreset(i, { ...p }));
  pickPreset(0);
  setPrefs({ rug: true, rugChecks: { ...PREFS0.rugChecks, socials: false }, cols: { new: true, running: true, stretch: true, migrated: true }, pills: true, buy: true });
  for (const c of ["new", "running", "stretch", "migrated"] as const) resetColumn(c);
  setQuickSol(0.25);
  setTrackerDocked(true, "right");
  useQuick.setState({ open: true }); store.set("qt:open", true);
}
