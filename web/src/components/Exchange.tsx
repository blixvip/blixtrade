// The Exchange window, opened by Deposit anywhere in the app: Convert (SOL and USDC), Deposit (your
// wallet's address and its QR code) and Buy (pay by card or bank through a payment provider, straight to
// the wallet). Real money. Talks to /api/account/* (server/accounts.js).
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { SolanaLogo } from "@/components/brand";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { loadMe, useMe } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

type Tab = "convert" | "deposit" | "buy";
export const useExchange = create<{ tab: Tab | null }>(() => ({ tab: null }));
export const openExchange = (tab: Tab = "deposit") => useExchange.setState({ tab });

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TABS: [Tab, string][] = [["convert", "Convert"], ["deposit", "Deposit"], ["buy", "Buy"]];
const big = "flex h-11 w-full items-center justify-center gap-2 rounded-full bg-ink text-lg font-semibold text-on-fill transition-transform duration-100 hover:bg-focus active:scale-[0.98] disabled:opacity-50 [&_svg]:size-4";
const box = "rounded-card border border-rule-2 bg-paper";

async function call<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/account/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error || String(r.status));
  return j as T;
}
const copy = (text: string) => { navigator.clipboard?.writeText(text); toast("Address copied"); };

// The address as a QR code, with Solana's mark in the middle (the highest error correction leaves room for it).
function Qr({ text }: { text: string }) {
  const { n, d } = useMemo(() => {
    const q = qrcode(0, "H"); q.addData(text); q.make();
    const n = q.getModuleCount(); let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n, d };
  }, [text]);
  return (
    <span className="relative block size-48 shrink-0 rounded-[14px] bg-white p-3 max-sm:size-36 max-sm:p-2.5">
      <svg viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="QR code of your deposit address" className="size-full"><path d={d} fill="#000" /></svg>
      <span className="absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black ring-[3px] ring-white max-sm:size-9"><SolanaLogo className="w-5.5 max-sm:w-4.5" /></span>
    </span>
  );
}

// The window's left side (its top on a phone): a Solana coin in hand, falling to the window's colour at the
// edge so the picture sits in the window rather than on it, with a caption over its foot.
function Art() {
  return (
    <>
      <img src="/brand/deposit-sol.webp" alt="" draggable={false} className="absolute inset-0 size-full object-cover object-[50%_36%] select-none" />
      <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent" />
      <span aria-hidden className="absolute inset-y-0 right-0 w-16 bg-gradient-to-r from-transparent to-paper-2 max-md:hidden" />
      <div className="absolute inset-x-0 bottom-0 p-7 max-md:hidden">
        <span className="label tracking-[0.16em] text-ink-2">Your Blix wallet</span>
        <p className="chrome-text mt-1.5 font-display text-[28px] leading-tight font-bold tracking-tight">Fund it in a minute</p>
        <p className="mt-2 max-w-[32ch] text-md leading-relaxed text-ink-2">Send SOL, USDC or any Solana token, or buy SOL with a card. It shows in your wallet within a minute.</p>
      </div>
    </>
  );
}

function Deposit({ address, toBuy }: { address: string; toBuy: () => void }) {
  const [asset, setAsset] = useState("SOL");
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-md text-ink-2">Deposit
          <select value={asset} onChange={(e) => setAsset(e.target.value)} className={cn(box, "h-10 px-3 text-lg font-medium text-ink outline-none focus:border-accent-dim")}>
            <option>SOL</option><option>USDC</option><option value="token">Any Solana token</option></select></label>
        <div className="flex flex-col gap-1.5 text-md text-ink-2">Network
          <span className={cn(box, "flex h-10 items-center gap-2 px-3 text-lg font-medium text-ink")}><SolanaLogo className="w-4" />Solana</span></div>
      </div>
      <p className="text-md text-muted">Send {asset === "token" ? "SOL or any Solana token" : asset} on the Solana network to this address. It shows in your wallet within a minute.</p>
      <div className={cn(box, "flex items-stretch gap-4 p-2.5")}>
        <Qr text={address} />
        <div className="flex min-w-0 flex-1 flex-col py-1.5 pr-1.5">
          <span className="text-md text-muted">Your deposit address</span>
          <p className="mt-1 font-outlier text-md leading-snug break-all text-ink select-all">{address}</p>
          <button onClick={() => copy(address)} aria-label="Copy address" className="mt-auto ml-auto grid size-8 place-items-center rounded-control text-muted hover:bg-paper-4 hover:text-ink"><Icon.copy className="size-4" /></button>
        </div>
      </div>
      <p className="text-md text-ink-2">Don't have any SOL? <button onClick={toBuy} className="text-info hover:underline">Buy it with a card.</button></p>
      <button onClick={() => copy(address)} className={big}><Icon.copy />Copy address</button>
    </>
  );
}

// Card and bank payments are taken by a payment provider on its own page; the SOL it buys is sent to this wallet.
function Buy({ address, stripe }: { address: string; stripe: boolean }) {
  const [busy, setBusy] = useState(false);
  const methods: { name: string; how: string; go: () => void }[] = [
    ...(stripe ? [{ name: "Stripe", how: "Card, Apple Pay, Google Pay", go: async () => {
      setBusy(true);
      const tab = window.open("about:blank", "_blank");   // opened on the click itself, so the browser allows it
      try { const { url } = await call<{ url: string }>("onramp", { provider: "stripe" }); if (tab) tab.location.href = url; else location.href = url; }
      catch (e) { tab?.close(); toast((e as Error).message); }
      setBusy(false);
    } }] : []),
    { name: "Onramper", how: "Card, bank transfer, Apple Pay, Google Pay and local methods", go: () => { window.open(`https://buy.onramper.com/?${new URLSearchParams({ mode: "buy", defaultCrypto: "sol_solana", onlyCryptos: "sol_solana,usdc_solana", networkWallets: `solana:${address}` })}`, "_blank", "noopener"); } },
    { name: "MoonPay", how: "Card, PayPal, bank transfer", go: () => { window.open(`https://buy.moonpay.com/?${new URLSearchParams({ currencyCode: "sol", walletAddress: address })}`, "_blank", "noopener"); } },
  ];
  return (
    <>
      <p className="text-md text-muted">Pay with a card or your bank. The provider opens in a new tab, and the SOL it buys is sent to your Blix wallet.</p>
      <div className={cn(box, "overflow-hidden")}>
        {methods.map((m) => (
          <button key={m.name} disabled={busy} onClick={m.go} className="flex w-full items-center gap-3 border-t border-rule px-3.5 py-3 text-left transition-colors duration-100 first:border-t-0 hover:bg-paper-3 disabled:opacity-50">
            <span className="min-w-0 flex-1"><b className="block text-lg font-semibold text-ink">{m.name}</b><span className="block text-md text-muted">{m.how}</span></span>
            <Icon.link className="size-4 shrink-0 text-muted" />
          </button>))}
      </div>
      <div className={cn(box, "flex items-center gap-3 px-3.5 py-2.5")}>
        <span className="min-w-0 flex-1"><span className="block text-sm text-muted">If the provider asks for a wallet address, paste this one</span><span className="block truncate font-outlier text-md text-ink">{address}</span></span>
        <button onClick={() => copy(address)} aria-label="Copy address" className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-paper-4 hover:text-ink"><Icon.copy className="size-4" /></button>
      </div>
      <p className="text-sm text-muted">The provider checks your identity and sets its own fees. Blix never sees your card.</p>
    </>
  );
}

function Convert({ sol, usdc }: { sol: number; usdc: number }) {
  const [toUsdc, setToUsdc] = useState(true), [amount, setAmount] = useState(""), [pct, setPct] = useState(100), [busy, setBusy] = useState(false);
  const from = toUsdc ? "SOL" : "USDC", to = toUsdc ? "USDC" : "SOL";
  const go = async () => {
    setBusy(true);
    try {
      const r = toUsdc ? await call<{ status: string }>("buy", { mint: USDC, sol: +amount }) : await call<{ status: string }>("sell", { mint: USDC, pct });
      toast(`Conversion sent · ${r.status}`); setAmount(""); loadMe();
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const fmt = (n: number, d: number) => n.toLocaleString(undefined, { maximumFractionDigits: d });
  return (
    <>
      <div className={cn(box, "flex items-center gap-3 p-3")}>
        <span className="min-w-0 flex-1"><span className="block text-sm text-muted">From</span><b className="block text-xl font-semibold">{from}</b><span className="num block text-sm text-muted">{toUsdc ? `${fmt(sol, 4)} available` : `${fmt(usdc, 2)} available`}</span></span>
        <button onClick={() => setToUsdc(!toUsdc)} aria-label="Swap direction" className="grid size-9 shrink-0 place-items-center rounded-full border border-rule-2 bg-paper-3 text-ink-2 hover:border-muted hover:text-ink"><Icon.refresh className="size-4" /></button>
        <span className="min-w-0 flex-1 text-right"><span className="block text-sm text-muted">To</span><b className="block text-xl font-semibold">{to}</b><span className="num block text-sm text-muted">{toUsdc ? `${fmt(usdc, 2)} held` : `${fmt(sol, 4)} held`}</span></span>
      </div>
      {toUsdc ? (
        <label className="flex flex-col gap-1.5 text-md text-ink-2">Amount in SOL
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.0" className={cn(box, "num h-11 px-3 text-xl text-ink outline-none focus:border-accent-dim")} /></label>
      ) : (
        <div className="flex flex-col gap-1.5 text-md text-ink-2">How much of your USDC
          <div className="grid grid-cols-4 gap-2">{[25, 50, 75, 100].map((p) => (
            <button key={p} onClick={() => setPct(p)} aria-pressed={pct === p} className={cn("num h-10 rounded-control border text-md font-semibold", pct === p ? "border-ink bg-paper-4 text-ink" : "border-rule-2 text-ink-2 hover:border-muted")}>{p}%</button>))}</div>
        </div>
      )}
      <p className="text-sm text-muted">Converted at the market rate through Jupiter. A little SOL stays behind to pay network fees.</p>
      <button disabled={busy || (toUsdc ? !(+amount > 0) || +amount > sol : !(usdc > 0))} onClick={go} className={big}>{busy ? "Converting…" : `Convert ${from} to ${to}`}</button>
    </>
  );
}

export function Exchange() {
  const tab = useExchange((s) => s.tab);
  const me = useMe((s) => s.me);
  useEffect(() => { if (tab) loadMe(); }, [tab]);
  const usdc = me?.wallet?.tokens?.find((t) => t.mint === USDC)?.ui ?? 0;
  return (
    <Dialog open={tab !== null} onOpenChange={(o) => !o && useExchange.setState({ tab: null })} title="Exchange" wide aside={<Art />}>
      {tab && (!me ? <div className="h-40 animate-pulse rounded-card bg-paper-3" /> : !me.signedIn || !me.address ? (
        <>
          <p className="text-md text-ink-2">Sign in to get your wallet. Your first sign-in creates it.</p>
          <a href="#/account" onClick={() => useExchange.setState({ tab: null })} className={big}>Sign in</a>
        </>
      ) : (
        <>
          <div role="tablist" aria-label="Exchange" className={cn(box, "grid grid-cols-3 gap-1 p-1")}>
            {TABS.map(([t, text]) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => useExchange.setState({ tab: t })}
                className={cn("h-9 rounded-control text-lg font-semibold transition-colors duration-100", tab === t ? "bg-paper-4 text-ink shadow-raised ring-1 ring-ink/70" : "text-muted hover:text-ink-2")}>{text}</button>))}
          </div>
          {tab === "deposit" ? <Deposit address={me.address} toBuy={() => useExchange.setState({ tab: "buy" })} />
            : tab === "buy" ? <Buy address={me.address} stripe={Boolean(me.onramp?.stripe)} />
            : <Convert sol={me.wallet?.sol ?? 0} usdc={+usdc} />}
        </>
      ))}
    </Dialog>
  );
}
