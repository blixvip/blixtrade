// Trader and wallet pages open at once: the moment the pointer rests on any link to one (#/trader/<handle> or
// #/trader/<wallet>, wherever it is: a coin's holders, its trades, a thesis, the wallet tracker's lists, the Feed),
// its page's answer is asked for, so by the click it is in the poll cache (lib/coin.ts) and the page draws from
// that instead of a skeleton. A Fomo handle's profile and a wallet's page are both kept by the server, so a prefetch
// also gets the server building a page it has not built yet, before anyone is waiting on it.
// One listener for the whole app, started from main.tsx; nothing to wire into each list.
import { prefetch, prefetchPage } from "./coin";

const isWallet = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const recent = new Map<string, number>();
function warm(arg: string) {
  const t = Date.now();
  if (t - (recent.get(arg) || 0) < 10_000) return;
  recent.set(arg, t);
  if (recent.size > 200) recent.delete(recent.keys().next().value!);
  prefetchPage("trader", arg);
  if (isWallet(arg)) prefetch(`wallet-page/${arg}`);
  else prefetch(`fomo/trader/${encodeURIComponent(decodeURIComponent(arg))}`);
}
let started = false;
export function startTraderLinks() {
  if (started) return;
  started = true;
  const on = (e: Event) => {
    const a = (e.target as Element | null)?.closest?.('a[href^="#/trader/"]') as HTMLAnchorElement | null;
    if (!a) return;
    const arg = a.getAttribute("href")!.slice("#/trader/".length).split(/[?#]/)[0];
    if (arg) warm(arg);
  };
  document.addEventListener("pointerover", on, { passive: true });
  document.addEventListener("focusin", on, { passive: true });
  document.addEventListener("touchstart", on, { passive: true });
}
