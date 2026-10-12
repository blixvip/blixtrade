import { toast, txToast } from "@/components/ui/toast";
import { post } from "./api";
import { loadPaperWallet, paperLocked, USDC_MINT, useTrade, type Cur } from "./mode";
import { loadMe, useMe } from "./ui";
import { store } from "./utils";
import { walletAction } from "./wallet-action";

// One buy or sell from any button. The Paper switch decides whose money it is: on, fake SOL from the
// paper wallet (the caller's own paper request); off, real SOL from the signed-in person's Blix wallet.
// Either way the transaction is shown from the moment it is sent until it settles.
// A buy is sized in SOL (`sol`) or in USDC (`usdc`); a sell is paid in SOL or, with `to: "USDC"`, in USDC.
export interface Order { side: "buy" | "sell"; mint: string; symbol: string; sol?: number; usdc?: number; to?: Cur; pct?: number; slippageBps?: number }
// What a buy spends, for its toasts: "0.25 SOL" or "25 USDC".
const spend = (o: Order) => (o.usdc != null ? `${o.usdc} USDC` : `${o.sol} SOL`);

let agreed = false;   // real money is confirmed once per page load, then quick buttons are quick

// Spam buying (the user, 2026-10-10): every press of a buy button counts. A press while trades are still going is
// lined up and runs the moment the one before it has settled, so ten presses are ten buys. They go one at a time
// because the wallet service refuses a second transaction while one is in flight (blix-vault walletAction, 409),
// which keeps the wallet's books straight. At most MAX_LINE wait; a buy that the SOL already lined up would leave
// unaffordable is refused at the press, and each real buy that waited reads the wallet again before it goes.
const MAX_LINE = 10;
let line: Promise<unknown> = Promise.resolve();
let waiting = 0, lineSol = 0;

// Resolves true when the trade went through. `paper` is the caller's paper request, run when the switch is on.
export async function trade(o: Order, paper: () => Promise<unknown>): Promise<boolean> {
  if (waiting >= MAX_LINE) { toast(`${MAX_LINE} trades are already lined up. Wait for some to finish.`); return false; }
  const sol = o.side === "buy" && o.usdc == null ? o.sol || 0 : 0, ahead = waiting, solAhead = lineSol;
  const isPaper = useTrade.getState().paper || paperLocked;
  const cash = useMe.getState().me?.wallet?.sol;
  if (!isPaper && sol && ahead && cash != null && sol + solAhead > cash) {
    toast(`Not enough SOL for another ${sol} SOL buy: ${+solAhead.toFixed(4)} SOL is already lined up.`);
    return false;
  }
  waiting++; lineSol += sol;
  if (ahead) toast(`${o.side === "buy" ? `Buy ${spend(o)}` : `Sell ${o.pct}%`} of ${o.symbol ? `$${o.symbol}` : "coin"} lined up (${ahead} ahead)`);
  const run = line.then(() => execute(o, paper, ahead > 0));
  line = run.catch(() => {});
  try { return await run; } finally { waiting--; lineSol -= sol; }
}

async function execute(o: Order, paper: () => Promise<unknown>, waited = false): Promise<boolean> {
  const isPaper = useTrade.getState().paper || paperLocked, name = o.symbol ? `$${o.symbol}` : "coin";
  const size = o.side === "buy" ? spend(o) : `${o.pct}%${o.to === "USDC" ? " for USDC" : ""}`;
  if (!isPaper) {
    // A trade that waited in line: the wallet as it is now (the ones before it spent from it).
    if (!useMe.getState().me || waited) await loadMe();
    const me = useMe.getState().me;
    if (!me?.signedIn) { toast("Sign in to trade with real SOL, or switch Paper on to use fake SOL."); location.hash = "#/account"; return false; }
    if (me.needsWallet) { toast("Create your hosted wallet before trading with real SOL."); location.hash = "#/account"; return false; }
    if (o.side === "buy" && o.usdc != null && me.wallet) {
      const have = me.wallet.tokens?.find((t) => t.mint === USDC_MINT)?.ui ?? 0;
      if (o.usdc > have) { txToast(`Buy ${name}`, undefined, { mint: o.mint, symbol: o.symbol }).fail("Not enough USDC", `This buy needs ${o.usdc} USDC and the wallet has ${have.toFixed(2)}. Convert some SOL to USDC (Deposit › Convert) or deposit USDC.`); return false; }
    } else if (o.side === "buy" && me.wallet && (o.sol || 0) > me.wallet.sol) { txToast(`Buy ${name}`, undefined, { mint: o.mint, symbol: o.symbol }).fail("Not enough SOL", `This buy needs ${o.sol} SOL and the wallet has ${me.wallet.sol.toFixed(4)}. Deposit to add more.`); return false; }
    if (!agreed && !confirm("Paper is off: this spends REAL SOL from your Blix wallet.\n\nAfter this, buy and sell buttons trade at once without asking again until you reload.")) return false;
    agreed = true;
    const slippageBps = o.slippageBps ?? store.get<number | undefined>("trade:slip", undefined);
    return walletAction(o.side, { mint: o.mint, ...(o.side === "buy" ? (o.usdc != null ? { usdc: o.usdc } : { sol: o.sol }) : { pct: o.pct, ...(o.to === "USDC" ? { to: "USDC" } : {}) }), slippageBps }, {
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
