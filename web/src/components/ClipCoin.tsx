// The coin on the clipboard, beside the top-bar search: copy a coin address anywhere (X, Telegram, another site)
// and come back to Blix, and its logo and ticker sit there to click, instead of opening search, pasting and
// pressing Enter.
//
// Reading the clipboard: Chrome and Edge ask once ("See text and images copied to the clipboard"); the request
// is made on the first click or key press on the page, then it is read every time the tab comes back to the
// front and every 1.5 s while it has focus. Firefox and Safari only let a page read the clipboard through
// their own Paste prompt, so there only addresses copied inside Blix show (the copy event).
import { useEffect, useState } from "react";
import { CoinImg } from "@/components/page";
import { compact } from "@/lib/format";
import { usePulse } from "@/lib/pulse";
import { useRouteArg } from "@/lib/route";
import { cn } from "@/lib/utils";

// A Solana address alone (pasted text often carries spaces or a line break), or a pump.fun / DEX link with one.
const ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function mintIn(text: string): string | null {
  const t = text.trim();
  if (t.length > 300) return null;
  if (ADDR.test(t)) return t;
  const m = t.match(/(?:pump\.fun\/(?:coin\/)?|dexscreener\.com\/solana\/|axiom\.trade\/meme\/|gmgn\.ai\/sol\/token\/(?:[A-Za-z0-9]+_)?|birdeye\.so\/token\/|solscan\.io\/token\/|#\/coin\/)([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : null;
}

type Info = { symbol: string | null; mcap: number | null; image: string | null };
const known = new Map<string, Info | null>();
const DISMISS = "clipcoin:dismissed";
const dismissed = () => { try { return sessionStorage.getItem(DISMISS) || ""; } catch { return ""; } };

export function ClipCoin() {
  const [mint, setMint] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [gone, setGone] = useState(dismissed);
  const open = useRouteArg();
  const pulse = usePulse((s) => (mint ? s.coins[mint] : undefined));

  useEffect(() => {
    // asked starts true: nothing is asked until the browser says it can be (a Firefox read would pop its Paste menu).
    let alive = true, granted = false, asked = true;
    const take = (text: string) => { const m = mintIn(text); if (m && alive) setMint(m); };
    const read = async () => {
      if (!granted || document.hidden || !document.hasFocus()) return;
      try { take(await navigator.clipboard.readText()); } catch { /* blurred, or permission taken back */ }
    };
    // Chromium answers this query; Firefox and Safari throw, and stay on copy events only.
    navigator.permissions?.query({ name: "clipboard-read" as PermissionName }).then((p) => {
      const set = () => { granted = p.state === "granted"; asked = p.state !== "prompt"; if (granted) void read(); };
      set(); p.onchange = set;
    }).catch(() => {});
    // The one-time ask rides on the visitor's first click or key press (a prompt out of nowhere on load is rude).
    const ask = () => {
      if (asked || granted) return;
      asked = true;
      navigator.clipboard?.readText?.().then((t) => { granted = true; take(t); }, () => {});
    };
    const onCopy = () => take(String(window.getSelection() || ""));
    const onFront = () => { void read(); };
    const t = setInterval(read, 1500);
    document.addEventListener("copy", onCopy);
    document.addEventListener("visibilitychange", onFront);
    window.addEventListener("focus", onFront);
    window.addEventListener("pointerdown", ask);
    window.addEventListener("keydown", ask);
    return () => {
      alive = false; clearInterval(t);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("visibilitychange", onFront);
      window.removeEventListener("focus", onFront);
      window.removeEventListener("pointerdown", ask);
      window.removeEventListener("keydown", ask);
    };
  }, []);

  // Its ticker and market cap: from the live board when Blix already has it, else asked once.
  useEffect(() => {
    if (!mint) return;
    if (known.has(mint)) { setInfo(known.get(mint) ?? null); return; }
    setInfo(null);
    let alive = true;
    fetch(`api/token/${mint}`, { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const t = j?.token;
      const v: Info | null = t ? { symbol: t.symbol || null, mcap: t.mcap ?? null, image: t.image || null } : null;
      known.set(mint, v);
      if (alive) setInfo(v);
    }).catch(() => {});
    return () => { alive = false; };
  }, [mint]);

  if (!mint || mint === gone || mint === open) return null;
  const symbol = pulse?.symbol || info?.symbol, mcap = pulse?.mcap ?? info?.mcap ?? null;
  const dismiss = () => { setGone(mint); try { sessionStorage.setItem(DISMISS, mint); } catch { /* private window */ } };
  return (
    <div className="group relative flex shrink-0 animate-brand-in items-center max-md:hidden">
      <a href={`#/coin/${mint}`} title={`Open the coin you copied: ${mint}`}
        className="flex h-9 items-center gap-2 rounded-full border border-rule-2 bg-paper-2 pr-3 pl-1 transition-[border-color,background-color] duration-150 hover:border-muted hover:bg-paper-3">
        <span className="relative size-7 shrink-0 overflow-hidden rounded-full bg-paper-4 ring-1 ring-white/10">
          <CoinImg mint={mint} fallback={info?.image} />
        </span>
        <span className="flex min-w-0 flex-col leading-none">
          <b className={cn("max-w-24 truncate text-sm font-semibold", symbol ? "text-ink" : "font-outlier text-ink-2")}>{symbol ? `$${symbol}` : `${mint.slice(0, 4)}…${mint.slice(-4)}`}</b>
          <span className="mt-0.5 flex items-center gap-1 text-2xs text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-2.5" aria-hidden><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></svg>
            {mcap ? compact(mcap) : "Copied"}
          </span>
        </span>
      </a>
      <button onClick={dismiss} aria-label="Hide the copied coin"
        className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full border border-rule-2 bg-paper-3 text-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-2" aria-hidden><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </div>
  );
}
