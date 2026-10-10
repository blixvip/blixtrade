// The Exchange window, opened by Deposit anywhere in the app: Convert (SOL and USDC), Deposit (your
// wallet's address and its QR code) and Buy (pay by card or bank through a payment provider, straight to
// the wallet). Real money. Talks to /api/account/* (server/accounts.js).
//
// Card providers without a partner key (none is set up, 2026-10-10) do not fill the wallet address in on their
// side (checked in a browser: Onramper's providers and MoonPay both ask for it), so opening one copies the address
// first and says so. Onramper wants `defaultCrypto=sol`: `sol_solana` fell back to USDC. Ramp, Coinbase and
// Transak refuse links without a key; Mercuryo ignores the coin asked for.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SolanaLogo } from "@/components/brand";
import { PayLogo, type PayMark } from "@/components/payLogos";
import { Dialog } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { loadMe, useMe } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { walletAction } from "@/lib/wallet-action";

import { useExchange, type ExchangeTab as Tab } from "@/lib/modals";
export { openExchange, useExchange } from "@/lib/modals";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TABS: [Tab, string][] = [["convert", "Convert"], ["deposit", "Deposit"], ["buy", "Buy"]];
const big = "flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink text-md font-semibold text-paper transition-[opacity,transform] duration-100 hover:opacity-90 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4";
const card = "rounded-xl bg-paper-3/40 ring-1 ring-rule ring-inset";

async function call<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`api/account/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error || String(r.status));
  return j as T;
}
const CheckIcon = ({ className }: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;
const UsdcLogo = ({ className }: { className?: string }) => <img src="brand/pay/usdc.png" alt="" className={cn("shrink-0 rounded-full", className)} />;
const SolCoin = ({ className }: { className?: string }) => <span className={cn("grid shrink-0 place-items-center rounded-full bg-black ring-1 ring-white/10", className)}><SolanaLogo className="w-[55%]" /></span>;

// Copy with a moment of "Copied" on the button that did it.
function useCopy() {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1600); return () => clearTimeout(t); }, [done]);
  return { done, copy: (text: string, note = "Address copied") => { navigator.clipboard?.writeText(text).then(() => { setDone(true); toast(note); }, () => toast("Couldn't copy: select the address and copy it")); } };
}

// The address as a QR code drawn as dots, with rounded finder eyes and the Solana coin in a cleared middle (the
// highest error correction covers the cleared modules). The QR library (50 KB) is fetched when a code is first
// drawn, not with the app.
const EYES = (n: number): [number, number][] => [[0, 0], [n - 7, 0], [0, n - 7]];
function Qr({ text }: { text: string }) {
  const [{ n, dots }, setQr] = useState({ n: 0, dots: "" });
  useEffect(() => {
    let alive = true;
    import("qrcode-generator").then(({ default: qrcode }) => {
      const q = qrcode(0, "H"); q.addData(text); q.make();
      const n = q.getModuleCount(), m = n / 2, hole = n * 0.15;
      const inEye = (r: number, c: number) => EYES(n).some(([x, y]) => c >= x && c < x + 7 && r >= y && r < y + 7);
      let dots = "";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if (!q.isDark(r, c) || inEye(r, c) || Math.hypot(c + 0.5 - m, r + 0.5 - m) < hole) continue;
        dots += `M${c + 0.1} ${r + 0.5}a.4 .4 0 1 0 .8 0a.4 .4 0 1 0 -.8 0`;
      }
      if (alive) setQr({ n, dots });
    }).catch(() => {});
    return () => { alive = false; };
  }, [text]);
  return (
    <span className="relative block size-[13.25rem] shrink-0 rounded-[18px] border-[5px] border-black bg-white p-2 max-sm:size-36 max-sm:rounded-[14px] max-sm:p-1.5">
      {n > 0 && (
        <svg viewBox={`0 0 ${n} ${n}`} role="img" aria-label="QR code of your deposit address" className="size-full">
          <path d={dots} fill="#000" />
          {EYES(n).map(([x, y]) => (
            <g key={`${x}.${y}`}>
              <rect x={x + 0.6} y={y + 0.6} width={5.8} height={5.8} rx={1.9} fill="none" stroke="#000" strokeWidth={1.2} />
              <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.9} fill="#000" />
            </g>))}
        </svg>
      )}
      <SolCoin className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2 ring-0 max-sm:size-8" />
    </span>
  );
}

// The wallet's address in a row: coin mark, the address (shortened on a phone), Copy.
function AddressRow({ address, label = "Your Solana address" }: { address: string; label?: string }) {
  const { done, copy } = useCopy();
  return (
    <div className={cn(card, "flex items-center gap-3 px-3.5 py-3")}>
      <SolCoin className="size-8" />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted">{label}</span>
        <span className="block truncate font-outlier text-md text-ink select-all max-sm:hidden">{address}</span>
        <span className="hidden font-outlier text-md text-ink sm:hidden max-sm:block">{short(address)}</span>
      </span>
      <button onClick={() => copy(address)} className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition-colors duration-150", done ? "bg-up/15 text-up" : "bg-paper-4 text-ink hover:bg-paper-5")}>
        {done ? <><CheckIcon className="size-3.5" />Copied</> : <><Icon.copy className="size-3.5" />Copy</>}
      </button>
    </div>
  );
}

// A labelled dropdown: the choice with its coin mark and a chevron, the list under it.
interface Choice { v: string; label: string; logo: ReactNode; note?: string }
function Picker({ label, value, choices, onChange }: { label: string; value: string; choices: Choice[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  const at = choices.find((c) => c.v === value) ?? choices[0];
  return (
    <div ref={box} className="relative flex min-w-0 flex-1 flex-col gap-3">
      <span className="text-lg text-ink-2">{label}</span>
      <button onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
        className={cn("flex h-12 items-center gap-2.5 rounded-lg border px-5 text-lg text-ink transition-colors duration-150 max-sm:px-3",
          open ? "border-ink-2/60" : "border-rule-2 hover:border-ink-2/40")}>
        {at.logo}<span className="min-w-0 flex-1 truncate text-left">{at.label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cn("size-4.5 shrink-0 text-ink-2 transition-transform duration-150", open && "rotate-180")} aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div role="listbox" aria-label={label} className="absolute top-full right-0 left-0 z-10 mt-1.5 flex flex-col gap-0.5 rounded-lg border border-rule-2 bg-paper-3 p-1 shadow-sheet">
          {choices.map((c) => (
            <button key={c.v} role="option" aria-selected={c.v === value} onClick={() => { onChange(c.v); setOpen(false); }}
              className={cn("flex h-10 items-center gap-2.5 rounded-md px-3 text-md text-ink transition-colors duration-100 hover:bg-paper-5", c.v === value && "bg-paper-4")}>
              {c.logo}<span className="flex-1 text-left">{c.label}</span>{c.note && <span className="text-xs text-muted">{c.note}</span>}
              {c.v === value && <CheckIcon className="size-3.5 text-ink-2" />}
            </button>))}
        </div>
      )}
    </div>
  );
}

// Onramper with SOL picked and the wallet filled in; the address is copied too, since keyless providers ask again.
const onramper = (address: string) => `https://buy.onramper.com/?${new URLSearchParams({ mode: "buy", defaultCrypto: "sol", onlyCryptos: "sol", networkWallets: `solana:${address}` })}`;

// Deposit, laid out as Axiom's: where from and where to, the address with its QR code, a way to buy, Copy Address.
// Everything is Solana, so both pickers move together: SOL or USDC (any SPL token lands on the same address).
const COINS: Choice[] = [
  { v: "SOL", label: "SOL", logo: <SolanaLogo className="w-4.5 shrink-0" />, note: "Solana" },
  { v: "USDC", label: "USDC", logo: <UsdcLogo className="size-5" />, note: "Solana" },
];
function Deposit({ address }: { address: string }) {
  const [asset, setAsset] = useState("SOL");
  const { done, copy } = useCopy();
  const small = useCopy();
  const buy = () => {
    navigator.clipboard?.writeText(address).catch(() => {});
    window.open(onramper(address), "_blank", "noopener");
    toast("Address copied: paste it when the provider asks for your wallet");
  };
  return (
    <>
      <div className="flex flex-col gap-5 px-6 pt-1 pb-6 max-sm:px-4">
        <div className="flex items-end gap-3">
          <Picker label="Deposit from" value={asset} choices={COINS} onChange={setAsset} />
          <Picker label="Receive on" value={asset} choices={COINS} onChange={setAsset} />
          <a href={`https://solscan.io/account/${address}#transfers`} target="_blank" rel="noopener" title="Deposit history" aria-label="Deposit history on Solscan"
            className="grid size-12 shrink-0 place-items-center rounded-lg border border-rule-2 text-ink-2 transition-colors duration-150 hover:border-ink-2/40 hover:text-ink">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.3" /><path d="M3 3.5v4.8h4.8" /><path d="M12 7.5V12l3 2" /></svg>
          </a>
        </div>
        <p className="text-md text-muted">Deposit SOL or SPL tokens directly to your wallet address.</p>
        <div className="flex gap-6 rounded-xl border border-rule-2 p-3 max-sm:gap-3 max-sm:p-2.5">
          <Qr text={address} />
          <div className="flex min-w-0 flex-1 flex-col py-3 pr-1">
            <span className="text-md text-muted">{asset} Deposit Address</span>
            <p className="mt-2 text-md leading-[1.55] font-medium break-all text-ink select-all">{address}</p>
            <button onClick={() => small.copy(address)} aria-label="Copy address"
              className={cn("mt-auto grid size-8 place-items-center self-end rounded-md transition-colors duration-150", small.done ? "text-up" : "text-muted hover:bg-paper-4 hover:text-ink")}>
              {small.done ? <CheckIcon className="size-4.5" /> : <Icon.copy className="size-4.5" />}
            </button>
          </div>
        </div>
        <p className="text-md text-ink-2">Don't have any SOL? <button onClick={buy} className="text-[#6b80ff] hover:underline">Buy through Onramper.</button></p>
      </div>
      <div className="border-t border-rule-2 px-6 py-6 max-sm:px-4 max-sm:py-4">
        <button onClick={() => copy(address)}
          className={cn("flex h-12 w-full items-center justify-center gap-2 rounded-full text-lg font-semibold text-black transition-[background-color,transform] duration-150 active:scale-[0.99]",
            done ? "bg-up" : "bg-[#526fff] hover:bg-[#6b80ff]")}>
          {done ? <><CheckIcon className="size-4.5" />Copied</> : "Copy Address"}
        </button>
      </div>
    </>
  );
}

// A payment mark as checkouts show it: the logo on a small white card (Visa in its blue).
const MARK_TONE: Partial<Record<PayMark, string>> = { visa: "text-[#1a1f71]" };
const Mark = ({ m }: { m: PayMark }) => <span className="grid h-[18px] w-[30px] place-items-center rounded-[4px] bg-white"><PayLogo mark={m} className={cn("size-5", MARK_TONE[m] ?? "text-black")} /></span>;

// Card and bank payments are taken by a payment provider on its own page; the SOL it buys is sent to this wallet.
interface Provider { name: string; logo: ReactNode; how: string; marks: PayMark[]; badge?: string; go: () => void }
function Buy({ address, stripe }: { address: string; stripe: boolean }) {
  const [busy, setBusy] = useState(false);
  // Opened on the click itself (so the browser allows the tab), the address already on the clipboard.
  const open = (url: string, name: string) => {
    navigator.clipboard?.writeText(address).catch(() => {});
    window.open(url, "_blank", "noopener");
    toast(`Address copied: paste it when ${name} asks for your wallet`);
  };
  const providers: Provider[] = [
    ...(stripe ? [{ name: "Stripe", logo: <span className="grid size-10 place-items-center rounded-xl bg-[#635bff] text-lg font-bold text-white">S</span>, how: "Card, Apple Pay, Google Pay", marks: ["visa", "mastercard", "applepay", "googlepay"] as PayMark[], badge: "Fastest", go: async () => {
      setBusy(true);
      const tab = window.open("about:blank", "_blank");
      try { const { url } = await call<{ url: string }>("onramp", { provider: "stripe" }); if (tab) tab.location.href = url; else location.href = url; }
      catch (e) { tab?.close(); toast((e as Error).message); }
      setBusy(false);
    } }] : []),
    { name: "Onramper", logo: <img src="brand/pay/onramper.png" alt="" className="size-10 rounded-xl" />, how: "Compares Banxa, MoonPay and more for the best rate", marks: ["visa", "mastercard", "applepay", "googlepay"], badge: "Best rate",
      go: () => open(onramper(address), "the provider") },
    { name: "MoonPay", logo: <img src="brand/pay/moonpay.png" alt="" className="size-10 rounded-xl bg-white" />, how: "Card, Apple Pay, Google Pay, PayPal, bank", marks: ["visa", "mastercard", "applepay", "googlepay"],
      go: () => open(`https://buy.moonpay.com/?${new URLSearchParams({ currencyCode: "sol", walletAddress: address })}`, "MoonPay") },
  ];
  return (
    <>
      <div className="flex flex-col gap-2">
        {providers.map((p) => (
          <button key={p.name} disabled={busy} onClick={p.go}
            className={cn(card, "group flex w-full items-center gap-3.5 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-paper-3/80 hover:ring-rule-2 disabled:opacity-50")}>
            <span className="shrink-0">{p.logo}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2"><b className="text-lg font-semibold text-ink">{p.name}</b>{p.badge && <span className="rounded-md bg-up/12 px-1.5 py-0.5 text-2xs font-semibold text-up">{p.badge}</span>}</span>
              <span className="block truncate text-sm text-muted">{p.how}</span>
              <span className="mt-2 flex items-center gap-1.5">{p.marks.map((m) => <Mark key={m} m={m} />)}</span>
            </span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden><path d="M7 17L17 7M9 7h8v8" /></svg>
          </button>))}
      </div>
      <AddressRow address={address} label="Paste this when the provider asks for your wallet" />
      <ol className="grid grid-cols-3 gap-2 text-xs text-muted max-sm:grid-cols-1">
        {["Pick a provider: it opens in a new tab", "Paste your address (already copied)", "SOL arrives in a few minutes"].map((t, i) => (
          <li key={t} className="flex items-start gap-2"><span className="num grid size-4.5 shrink-0 place-items-center rounded-full bg-paper-4 text-2xs font-bold text-ink-2">{i + 1}</span>{t}</li>))}
      </ol>
      <p className="flex items-center gap-1.5 text-xs text-muted"><Icon.shield className="size-3 shrink-0" />The provider checks your ID and sets its fee. Blix never sees your card.</p>
    </>
  );
}

function Convert({ sol, usdc }: { sol: number; usdc: number }) {
  const [toUsdc, setToUsdc] = useState(true), [amount, setAmount] = useState(""), [pct, setPct] = useState(100), [busy, setBusy] = useState(false);
  const from = toUsdc ? "SOL" : "USDC", to = toUsdc ? "USDC" : "SOL";
  const go = async () => {
    setBusy(true);
    try {
      const ok = await walletAction(toUsdc ? "buy" : "sell", { mint: USDC, ...(toUsdc ? { sol: +amount } : { pct }) }, { pending: `Converting ${from} to ${to}`, confirmed: "Conversion confirmed", failed: "Conversion failed" });
      if (ok) setAmount("");
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  };
  const fmt = (n: number, d: number) => n.toLocaleString(undefined, { maximumFractionDigits: d });
  const Coin = ({ c }: { c: string }) => c === "SOL" ? <SolCoin className="size-7" /> : <UsdcLogo className="size-7" />;
  const has = toUsdc ? sol : usdc;
  return (
    <>
      <div className="relative flex flex-col gap-1.5">
        <div className={cn(card, "flex items-center gap-3 px-4 py-3.5")}>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-muted">You pay</span>
            {toUsdc ? <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0.00" aria-label="Amount in SOL" className="num w-full bg-transparent text-2xl font-semibold text-ink outline-none placeholder:text-muted/50" />
              : <b className="num block text-2xl font-semibold text-ink">{pct}%</b>}
            <span className="num block text-xs text-muted">{fmt(has, toUsdc ? 4 : 2)} {from} available</span>
          </span>
          <span className="flex items-center gap-2 rounded-full bg-paper-4 py-1 pr-3 pl-1 text-md font-semibold text-ink"><Coin c={from} />{from}</span>
        </div>
        <button onClick={() => setToUsdc(!toUsdc)} aria-label="Swap direction" className="absolute top-1/2 left-1/2 z-[1] grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xl border-4 border-paper-2 bg-paper-4 text-ink-2 transition-colors hover:text-ink">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" /></svg>
        </button>
        <div className={cn(card, "flex items-center gap-3 px-4 py-3.5")}>
          <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-muted">You get</span><b className="block text-2xl font-semibold text-ink-2">{to}</b><span className="num block text-xs text-muted">{fmt(toUsdc ? usdc : sol, toUsdc ? 2 : 4)} {to} held</span></span>
          <span className="flex items-center gap-2 rounded-full bg-paper-4 py-1 pr-3 pl-1 text-md font-semibold text-ink"><Coin c={to} />{to}</span>
        </div>
      </div>
      {toUsdc ? (
        <div className="grid grid-cols-4 gap-2">{[0.25, 0.5, 0.75, 1].map((f) => (
          <button key={f} onClick={() => setAmount(String(+(Math.max(0, sol - 0.01) * f).toFixed(4)))} className="num h-8 rounded-lg bg-paper-3/50 text-sm font-semibold text-ink-2 ring-1 ring-rule ring-inset hover:bg-paper-3 hover:text-ink">{f === 1 ? "Max" : `${f * 100}%`}</button>))}</div>
      ) : (
        <div className="grid grid-cols-4 gap-2">{[25, 50, 75, 100].map((p) => (
          <button key={p} onClick={() => setPct(p)} aria-pressed={pct === p} className={cn("num h-8 rounded-lg text-sm font-semibold ring-1 ring-inset", pct === p ? "bg-ink text-paper ring-ink" : "bg-paper-3/50 text-ink-2 ring-rule hover:bg-paper-3 hover:text-ink")}>{p === 100 ? "Max" : `${p}%`}</button>))}</div>
      )}
      <button disabled={busy || (toUsdc ? !(+amount > 0) || +amount > sol : !(usdc > 0))} onClick={go} className={big}>{busy ? "Converting…" : `Convert ${from} to ${to}`}</button>
      <p className="text-center text-xs text-muted">Market rate through Jupiter. A little SOL stays behind for network fees.</p>
    </>
  );
}

export function Exchange() {
  const tab = useExchange((s) => s.tab);
  const me = useMe((s) => s.me);
  useEffect(() => { if (tab) loadMe(); }, [tab]);
  const usdc = me?.wallet?.tokens?.find((t) => t.mint === USDC)?.ui ?? 0;
  const at = TABS.findIndex(([t]) => t === tab);
  const pad = "flex flex-col gap-4 px-6 pt-1 pb-6 max-sm:px-4";
  return (
    <Dialog open={tab !== null} onOpenChange={(o) => !o && useExchange.setState({ tab: null })} title="Exchange" flush>
      {tab && (!me ? <div className="p-6"><div className="h-40 animate-pulse rounded-xl bg-paper-3" /></div> : !me.signedIn || !me.address ? (
        <div className={cn(pad, "pt-6")}>
          <p className="text-md text-ink-2">{me.signedIn ? "Create your wallet to get a deposit address." : "Sign in to set up your wallet."}</p>
          <a href="#/account" onClick={() => useExchange.setState({ tab: null })} className={big}>{me.signedIn ? "Set up wallet" : "Sign in"}</a>
        </div>
      ) : (
        <>
          <div className="px-6 pt-6 pb-5 max-sm:px-4">
            <div role="tablist" aria-label="Exchange" className="relative grid grid-cols-3 rounded-xl border border-rule-2 p-1.5">
              <span aria-hidden className="absolute top-1.5 bottom-1.5 left-1.5 rounded-lg bg-paper-4 transition-transform duration-200 ease-out"
                style={{ width: "calc((100% - 0.75rem) / 3)", transform: `translateX(${Math.max(0, at) * 100}%)` }} />
              {TABS.map(([t, text]) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => useExchange.setState({ tab: t })}
                  className={cn("relative h-10 rounded-lg text-xl transition-colors duration-150 max-sm:text-lg", tab === t ? "font-semibold text-ink" : "font-medium text-muted hover:text-ink-2")}>{text}</button>))}
            </div>
          </div>
          {tab === "deposit" ? <Deposit address={me.address} />
            : <div className={pad}>{tab === "buy" ? <Buy address={me.address} stripe={Boolean(me.onramp?.stripe)} /> : <Convert sol={me.wallet?.sol ?? 0} usdc={+usdc} />}</div>}
        </>
      ))}
    </Dialog>
  );
}
