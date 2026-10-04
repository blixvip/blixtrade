import { toast, txToast } from "@/components/ui/toast";
import { post } from "./api";
import { loadPaperWallet, useTrade } from "./mode";
import { loadMe, useMe } from "./ui";

// One buy or sell from any button. The Paper switch decides whose money it is: on, fake SOL from the
// paper wallet (the caller's own paper request); off, real SOL from the signed-in person's Blix wallet.
// Either way the transaction is shown from the moment it is sent until it settles.
export interface Order { side: "buy" | "sell"; mint: string; symbol: string; sol?: number; pct?: number; slippageBps?: number }

let agreed = false;   // real money is confirmed once per page load, then quick buttons are quick

async function real(o: Order): Promise<{ signature?: string; status: string; note?: string }> {
  const r = await fetch(`/api/account/${o.side}`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(120_000),
    body: JSON.stringify(o.side === "buy" ? { mint: o.mint, sol: o.sol, slippageBps: o.slippageBps } : { mint: o.mint, pct: o.pct, slippageBps: o.slippageBps }) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(r.status === 404 ? "Accounts are not switched on." : j.error || String(r.status));
  return j;
}

// Resolves true when the trade went through. `paper` is the caller's paper request, run when the switch is on.
export async function trade(o: Order, paper: () => Promise<unknown>): Promise<boolean> {
  const isPaper = useTrade.getState().paper, name = o.symbol ? `$${o.symbol}` : "coin";
  const size = o.side === "buy" ? `${o.sol} SOL` : `${o.pct}%`;
  if (!isPaper) {
    if (!useMe.getState().me) await loadMe();
    const me = useMe.getState().me;
    if (!me?.signedIn) { toast("Sign in to trade with real SOL, or switch Paper on to use fake SOL."); location.hash = "#/account"; return false; }
    if (o.side === "buy" && me.wallet && (o.sol || 0) > me.wallet.sol) { txToast(`Buy ${name}`).fail("Not enough SOL", `This buy needs ${o.sol} SOL and the wallet has ${me.wallet.sol.toFixed(4)}. Deposit to add more.`); return false; }
    if (!agreed && !confirm("Paper is off: this spends REAL SOL from your Blix wallet.\n\nAfter this, buy and sell buttons trade at once without asking again until you reload.")) return false;
    agreed = true;
  }
  const tag = isPaper ? "Paper · " : "";
  const t = txToast(`${tag}${o.side === "buy" ? "Buying" : "Selling"} ${name}`, `${size} · ${isPaper ? "filling at the live quote" : "sent to Solana, waiting for confirmation"}`);
  try {
    if (isPaper) { await paper(); loadPaperWallet(); t.ok(`${tag}${o.side === "buy" ? "Bought" : "Sold"} ${name}`, size); }
    else {
      const r = await real(o);
      loadMe();
      t.ok(`${o.side === "buy" ? "Bought" : "Sold"} ${name}`, r.status === "confirmed" ? size : `${size} · ${r.note || r.status}`, r.signature ? `https://solscan.io/tx/${r.signature}` : undefined);
    }
    return true;
  } catch (e) { t.fail(`${tag}${o.side === "buy" ? "Buy" : "Sell"} failed`, (e as Error).message); return false; }
}

// Kept for the paper-only helpers elsewhere.
export { post };
