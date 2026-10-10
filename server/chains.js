// Coins on chains Blix keeps off every page. Fomo's lists, feed, leaderboard and trader profiles carry coins on
// other chains (Fomo's numeric network ids); pump.fun's leaderboard tags them by name. BNB Chain and Robinhood
// Chain coins are removed everywhere (the owner's call, 2026-10-06). Ethereum stays off the Fomo lists and feed
// only, as before (ETH_TOO).
const ETH = 1;
const OFF = new Set([56, 4663]);                       // BNB Chain, Robinhood Chain
const OFF_NAMES = /^(bnb|bsc|binance|bnb[ -_]?chain|robinhood|robinhood[ -_]?chain|rh)$/i;

// Fomo network ids Blix shows at all: Solana, Ethereum, Base, Monad. Any other id (an unnamed EVM chain such as
// 5042, drawn as "Chain 5042") stays off everywhere (the owner's call, 2026-10-10).
const KNOWN = new Set([1399811149, ETH, 8453, 143]);

// True when a coin on `chain` must not be shown. `chain` is Fomo's network id (number or numeric string) or a
// chain name; a missing chain is shown, an unknown network id is not.
export function offChain(chain, { ethToo = false } = {}) {
  if (chain == null || chain === "") return false;
  const n = Number(chain);
  if (Number.isFinite(n)) return !KNOWN.has(n) || OFF.has(n) || (ethToo && n === ETH);
  return OFF_NAMES.test(String(chain).trim()) || (ethToo && /^(eth|ethereum)$/i.test(String(chain).trim()));
}
export const ETH_TOO = { ethToo: true };

// A trader's swap is off-chain when any side of it is.
export const offSwap = (s) => offChain(s?.chain) || offChain(s?.inChain) || offChain(s?.outChain);
