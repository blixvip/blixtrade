import { toast, txToast } from "@/components/ui/toast";
import { post } from "./api";
import { loadPaperWallet, paperLocked, useTrade } from "./mode";
import { loadMe, useMe } from "./ui";
import { store } from "./utils";
import { walletAction } from "./wallet-action";

// One buy or sell from any button. The Paper switch decides whose money it is: on, fake SOL from the
// paper wallet (the caller's own paper request); off, real SOL from the signed-in person's Blix wallet.
// Either way the transaction is shown from the moment it is sent until it settles.
export interface Order { side: "buy" | "sell"; mint: string; symbol: string; sol?: number; pct?: number; slippageBps?: number }

let agreed = false;   // real money is confirmed once per page load, then quick buttons are quick
let sending = false;

// Resolves true when the trade went through. `paper` is the caller's paper request, run when the switch is on.
export async function trade(o: Order, paper: () => Promise<unknown>): Promise<boolean> {
  if (sending) { toast("A trade is already being checked. Wait for its result."); return false; }
  sending = true;
  try { return await execute(o, paper); } finally { sending = false; }
}

async function execute(o: Order, paper: () => Promise<unknown>): Promise<boolean> {
  const isPaper = useTrade.getState().paper || paperLocked, name = o.symbol ? `$${o.symbol}` : "coin";
  const size = o.side === "buy" ? `${o.sol} SOL` : `${o.pct}%`;
  if (!isPaper) {
    if (!useMe.getState().me) await loadMe();
    const me = useMe.getState().me;
    if (!me?.signedIn) { toast("Sign in to trade with real SOL, or switch Paper on to use fake SOL."); location.hash = "#/account"; return false; }
    if (me.needsWallet) { toast("Create your hosted wallet before trading with real SOL."); location.hash = "#/account"; return false; }
    if (o.side === "buy" && me.wallet && (o.sol || 0) > me.wallet.sol) { txToast(`Buy ${name}`, undefined, { mint: o.mint, symbol: o.symbol }).fail("Not enough SOL", `This buy needs ${o.sol} SOL and the wallet has ${me.wallet.sol.toFixed(4)}. Deposit to add more.`); return false; }
    if (!agreed && !confirm("Paper is off: this spends REAL SOL from your Blix wallet.\n\nAfter this, buy and sell buttons trade at once without asking again until you reload.")) return false;
    agreed = true;
    const slippageBps = o.slippageBps ?? store.get<number | undefined>("trade:slip", undefined);
    return walletAction(o.side, { mint: o.mint, ...(o.side === "buy" ? { sol: o.sol } : { pct: o.pct }), slippageBps }, {
      pending: `${o.side === "buy" ? "Buying" : "Selling"} ${name}`,
      confirmed: `${o.side === "buy" ? "Bought" : "Sold"} ${name}`,
      failed: `${o.side === "buy" ? "Buy" : "Sell"} failed`, detail: size, mint: o.mint, symbol: o.symbol,
    });
  }
  const t = txToast(`${o.side === "buy" ? "Buying" : "Selling"} ${name}`, `${size} · ${isPaper ? "filling at the live quote" : "sent to Solana, waiting for confirmation"}`, { paper: isPaper, mint: o.mint, symbol: o.symbol });
  try {
    await paper(); loadPaperWallet(true); t.ok(`${o.side === "buy" ? "Bought" : "Sold"} ${name}`, size);
    return true;
  } catch (e) {
    t.fail(`${o.side === "buy" ? "Buy" : "Sell"} failed`, (e as Error).message);
    return false;
  }
}

// Kept for the paper-only helpers elsewhere.
export { post };
