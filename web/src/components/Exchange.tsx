// The Exchange window, opened by Deposit anywhere in the app: Convert (SOL and USDC), Deposit (from Solana,
// 10 other chains through Relay, or an exchange) and Buy (pay by card or bank through a payment provider, straight to
// the wallet). Real money. Talks to /api/account/* (server/accounts.js).
//
// Card providers without a partner key (none is set up, 2026-10-10) do not fill the wallet address in on their
// side (checked in a browser: Onramper's providers and MoonPay both ask for it), so opening one copies the address
// first and says so. Onramper wants `defaultCrypto=sol`: `sol_solana` fell back to USDC. Ramp, Coinbase and
// Transak refuse links without a key; Mercuryo ignores the coin asked for.
import { useEffect, useState, type ReactNode } from "react";
import { SolanaLogo } from "@/components/brand";
import { PayLogo, type PayMark } from "@/components/payLogos";
import { Dialog } from "@/components/ui/dialog";
import { toast, txToast } from "@/components/ui/toast";
import { connectWallet, sendSol, solBalance, useWallets, type StdWallet } from "@/lib/solwallet";
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
function Qr({ text, mark }: { text: string; mark?: string }) {
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
      {mark ? <img src={mark} alt="" className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white p-0.5 max-sm:size-8" />
        : <SolCoin className="absolute top-1/2 left-1/2 size-11 -translate-x-1/2 -translate-y-1/2 ring-0 max-sm:size-8" />}
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

// Onramper with SOL picked and the wallet filled in; the address is copied too, since keyless providers ask again.
const onramper = (address: string) => `https://buy.onramper.com/?${new URLSearchParams({ mode: "buy", defaultCrypto: "sol", onlyCryptos: "sol", networkWallets: `solana:${address}` })}`;

// Deposit: pick where the money is. Solana sends straight to the wallet (SOL, USDC or any SPL token). Every other
// chain gets its own deposit address from Relay (api.relay.link, no key, CORS open): whatever lands there in the
// picked token is bridged and swapped to SOL in this wallet, usually within a minute. Relay's "open" addresses take
// any amount (each deposit is quoted again; Bitcoin waits for a confirmation) and are fetched fresh each time the window opens; on EVM chains a
// refundTo of the zero address refunds the sender if a fill fails (not when the sender is an exchange). Deposits
// under ~$0.05 are never swept. The quote's sample amount is only used for the rate shown.
const Z = "0x0000000000000000000000000000000000000000", SOLANA_ID = 792703809, SOL_MINT = "11111111111111111111111111111111";
type Vm = "evm" | "btc" | "tron";
interface Tok { sym: string; cur: string; sample: string; dec: number; logo: string }
interface Net { id: string; name: string; logo: string; chain?: number; vm?: Vm; min?: string; tokens: Tok[] }
const ETH = (): Tok => ({ sym: "ETH", cur: Z, sample: "10000000000000000", dec: 18, logo: "brand/chains/ethereum.webp" });
const STABLE = (sym: "USDC" | "USDT", cur: string, dec = 6): Tok => ({ sym, cur, sample: String(20n * 10n ** BigInt(dec)), dec, logo: sym === "USDC" ? "brand/pay/usdc.png" : "brand/chains/usdt.webp" });
const NETS: Net[] = [
  { id: "solana", name: "Solana", logo: "", tokens: [] },
  { id: "ethereum", name: "Ethereum", logo: "brand/chains/ethereum.webp", chain: 1, vm: "evm", min: "$10", tokens: [ETH(), STABLE("USDC", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), STABLE("USDT", "0xdac17f958d2ee523a2206206994597c13d831ec7")] },
  { id: "base", name: "Base", logo: "brand/chains/base.webp", chain: 8453, vm: "evm", tokens: [ETH(), STABLE("USDC", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"), STABLE("USDT", "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2")] },
  { id: "bitcoin", name: "Bitcoin", logo: "brand/chains/bitcoin.webp", chain: 8253038, vm: "btc", min: "$10", tokens: [{ sym: "BTC", cur: "bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqmql8k8", sample: "30000", dec: 8, logo: "brand/chains/bitcoin.webp" }] },
  { id: "bnb", name: "BNB", logo: "brand/chains/bnb.webp", chain: 56, vm: "evm", tokens: [{ sym: "BNB", cur: Z, sample: "30000000000000000", dec: 18, logo: "brand/chains/bnb.webp" }, STABLE("USDT", "0x55d398326f99059ff775485246999027b3197955", 18)] },
  { id: "arbitrum", name: "Arbitrum", logo: "brand/chains/arbitrum.webp", chain: 42161, vm: "evm", tokens: [ETH(), STABLE("USDC", "0xaf88d065e77c8cc2239327c5edb3a432268e5831")] },
  { id: "tron", name: "Tron", logo: "brand/chains/tron.webp", chain: 728126428, vm: "tron", tokens: [STABLE("USDT", "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")] },
  { id: "polygon", name: "Polygon", logo: "brand/chains/polygon.webp", chain: 137, vm: "evm", tokens: [STABLE("USDC", "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359")] },
  { id: "optimism", name: "Optimism", logo: "brand/chains/optimism.webp", chain: 10, vm: "evm", tokens: [ETH()] },
  { id: "avalanche", name: "Avalanche", logo: "brand/chains/avalanche.webp", chain: 43114, vm: "evm", tokens: [STABLE("USDC", "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e")] },
  { id: "hyperevm", name: "HyperEVM", logo: "brand/chains/hyperevm.webp", chain: 999, vm: "evm", tokens: [{ sym: "HYPE", cur: Z, sample: "1000000000000000000", dec: 18, logo: "brand/chains/hyperevm.webp" }] },
];
// A quote needs a sender of the right kind; any well-formed one does for an open deposit address.
const SAMPLE_USER: Record<Vm, string> = { evm: "0x000000000000000000000000000000000000dEaD", btc: "bc1q4vxn43l44h30nkluqfxd9eckf45vr2awz38lwa", tron: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7" };

interface Route { address: string; rate: number | null; secs: number | null }
const routeAsk = new Map<string, Promise<Route>>();
function relayAddress(net: Net, tok: Tok, recipient: string): Promise<Route> {
  const key = `${net.id}:${tok.sym}:${recipient}`;
  let p = routeAsk.get(key);
  if (!p) {
    p = fetch("https://api.relay.link/quote", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000), body: JSON.stringify({
      user: SAMPLE_USER[net.vm!], originChainId: net.chain, destinationChainId: SOLANA_ID, originCurrency: tok.cur, destinationCurrency: SOL_MINT,
      recipient, amount: tok.sample, tradeType: "EXACT_INPUT", useDepositAddress: true, ...(net.vm === "evm" ? { refundTo: Z } : {}) }) })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        const address = j.steps?.find((s: { depositAddress?: string }) => s.depositAddress)?.depositAddress;
        if (!r.ok || !address) throw new Error(j.message || "No deposit address right now. Try again in a moment.");
        const out = Number(j.details?.currencyOut?.amountFormatted), inn = Number(tok.sample) / 10 ** tok.dec;
        return { address, rate: out > 0 ? out / inn : null, secs: Number(j.details?.timeEstimate) || null };
      });
    p.catch(() => routeAsk.delete(key));
    routeAsk.set(key, p);
  }
  return p;
}

const Logo = ({ src, className }: { src: string; className?: string }) => src ? <img src={src} alt="" className={cn("shrink-0 rounded-full", className)} /> : <SolCoin className={className} />;
const rateText = (r: number) => r >= 100 ? r.toFixed(0) : r >= 1 ? r.toFixed(2) : r.toFixed(4);
const tile = (on: boolean) => cn("flex h-10 min-w-0 items-center gap-2 rounded-xl border px-2.5 text-sm font-semibold transition-colors duration-100 max-sm:h-14 max-sm:flex-col max-sm:justify-center max-sm:gap-1 max-sm:px-1 max-sm:text-xs",
  on ? "border-ink/40 bg-paper-4 text-ink" : "border-rule-2 text-ink-2 hover:border-ink-2/40 hover:text-ink");

// Interac e-Transfer (Canada): the person sends CAD to the owner's own e-Transfer address with their Blix address
// in the message, and the owner sends the SOL by hand. Hidden until an address is set here.
const ETRANSFER = { email: "kuxrro@gmail.com", eta: "within 1 to 2 hours", min: "$20 CAD" };

type Method = "crypto" | "wallet" | "card" | "exchange" | "etransfer";
const M_ICON: Record<Method, ReactNode> = {
  crypto: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9 8h4.5a2 2 0 0 1 0 4H9h5a2 2 0 0 1 0 4H9zM10.5 6.5V8M10.5 16v1.5" /></svg>,
  wallet: <Icon.wallets className="size-4" />,
  card: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6.5 15h3" /></svg>,
  exchange: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden><path d="M3 21h18M5 21V10M19 21V10M9 21v-7M15 21v-7M2 10l10-6 10 6" /></svg>,
  etransfer: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>,
};
const METHODS: [Method, string][] = [["crypto", "Crypto"], ["wallet", "Wallet"], ["card", "Card"], ["exchange", "Exchange"], ["etransfer", "e-Transfer"]];
// Known wallets, shown even when not installed (with a way to get them). Detected ones come first.
const KNOWN_WALLETS: [name: string, site: string, open: (url: string) => string][] = [
  ["Phantom", "https://phantom.com", (u) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}`],
  ["Solflare", "https://solflare.com", (u) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}`],
  ["Backpack", "https://backpack.app", () => "https://backpack.app"],
];
const mobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-2.5 text-sm text-ink-2">
      {items.map((x, n) => <li key={n} className="flex gap-2.5"><span className="num grid size-5 shrink-0 place-items-center rounded-full bg-paper-4 text-2xs font-bold text-ink">{n + 1}</span><span>{x}</span></li>)}
    </ol>
  );
}

// Send SOL from a browser wallet: pick the wallet, the amount, approve in the wallet.
function FromWallet({ address }: { address: string }) {
  const found = useWallets();
  const [amount, setAmount] = useState(""), [busy, setBusy] = useState<string | null>(null), [from, setFrom] = useState<{ wallet: string; address: string; sol: number | null } | null>(null);
  const connect = async (w: StdWallet) => {
    setBusy(w.name);
    try {
      const a = await connectWallet(w);
      if (!a) throw new Error(`${w.name} did not share an account`);
      setFrom({ wallet: w.name, address: a.address, sol: null });
      solBalance(a.address).then((sol) => setFrom((f) => f && f.address === a.address ? { ...f, sol } : f), () => {});
    } catch (e) { toast((e as Error).message || "Connection cancelled"); }
    setBusy(null);
  };
  const send = async () => {
    const w = found.find((x) => x.name === from?.wallet);
    if (!w || !(+amount > 0)) return;
    setBusy("send");
    const t = txToast(`Sending ${amount} SOL`, `From ${w.name} to your Blix wallet`);
    try {
      const sig = await sendSol(w, address, +amount);
      t.ok("Deposit sent", `${amount} SOL is on its way`, `https://solscan.io/tx/${sig}`);
      setAmount("");
      window.dispatchEvent(new Event("blix:wallet-changed"));
    } catch (e) { t.fail("Deposit not sent", (e as Error).message || "Cancelled in the wallet"); }
    setBusy(null);
  };
  const rows = [...found.map((w) => ({ name: w.name, icon: w.icon, w })), ...KNOWN_WALLETS.filter(([n]) => !found.some((w) => w.name === n)).map(([n]) => ({ name: n, icon: `brand/wallets/${n.toLowerCase()}.webp`, w: null as StdWallet | null }))];
  if (from) return (
    <div className="flex flex-col gap-3">
      <div className={cn(card, "flex items-center gap-3 px-3.5 py-3")}>
        <img src={found.find((w) => w.name === from.wallet)?.icon} alt="" className="size-8 rounded-lg" />
        <span className="min-w-0 flex-1"><b className="block text-md font-semibold text-ink">{from.wallet}</b><span className="block truncate font-outlier text-xs text-muted">{short(from.address)}{from.sol != null && ` · ${from.sol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`}</span></span>
        <button onClick={() => setFrom(null)} className="text-sm text-muted hover:text-ink">Change</button>
      </div>
      <div className={cn(card, "flex items-center gap-3 px-4 py-3.5")}>
        <SolCoin className="size-8" />
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0.00" aria-label="Amount in SOL" autoFocus
          className="num min-w-0 flex-1 bg-transparent text-2xl font-semibold text-ink outline-none placeholder:text-muted/50" />
        <span className="text-md font-semibold text-muted">SOL</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {[0.1, 0.5, 1].map((v) => <button key={v} onClick={() => setAmount(String(v))} className="h-8 rounded-lg border border-rule-2 text-sm font-semibold text-ink-2 hover:text-ink">{v} SOL</button>)}
        <button disabled={!(from.sol && from.sol > 0.001)} onClick={() => from.sol && setAmount(String(Math.max(0, Math.floor((from.sol - 0.001) * 1e4) / 1e4)))} className="h-8 rounded-lg border border-rule-2 text-sm font-semibold text-ink-2 hover:text-ink disabled:opacity-40">Max</button>
      </div>
      <button onClick={send} disabled={busy !== null || !(+amount > 0) || (from.sol != null && +amount > from.sol)} className={big}>
        {busy === "send" ? "Approve in your wallet…" : from.sol != null && +amount > from.sol ? "Not enough SOL" : `Deposit ${+amount > 0 ? `${amount} SOL` : ""}`}
      </button>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ name, icon, w }) => {
        const known = KNOWN_WALLETS.find(([n]) => n === name);
        const go = w ? () => connect(w) : () => window.open(known && mobile() ? known[2](location.href) : known?.[1] ?? "https://phantom.com", "_blank", "noopener");
        return (
          <button key={name} onClick={go} disabled={busy !== null}
            className={cn(card, "group flex items-center gap-3 px-3.5 py-3 text-left transition-colors duration-150 hover:bg-paper-3/80 disabled:opacity-60")}>
            <img src={icon} alt="" className="size-9 rounded-xl bg-paper-4 object-contain" />
            <span className="min-w-0 flex-1"><b className="block text-md font-semibold text-ink">{name}</b>
              <span className="block text-xs text-muted">{w ? "Detected" : mobile() ? `Open Blix in ${name}` : "Not installed"}</span></span>
            <span className={cn("rounded-full px-3 py-1 text-sm font-semibold", w ? "bg-ink text-on-fill" : "bg-paper-4 text-ink-2")}>{busy === name ? "Connecting…" : w ? "Connect" : mobile() ? "Open" : "Get"}</span>
          </button>);
      })}
      <p className="text-xs text-muted">Any Solana wallet that supports the Wallet Standard shows up here. Or scan your address with the wallet's camera under Crypto.</p>
    </div>
  );
}

function Deposit({ address, onBuy: _onBuy, stripe }: { address: string; onBuy: () => void; stripe: boolean }) {
  const [method, setMethod] = useState<Method>("crypto");
  const [netId, setNet] = useState("solana"), [sym, setSym] = useState("");
  const net = NETS.find((n) => n.id === netId) ?? NETS[0], tok = net.tokens.find((t) => t.sym === sym) ?? net.tokens[0];
  const [route, setRoute] = useState<Route | null>(null), [err, setErr] = useState("");
  const { done, copy } = useCopy();
  useEffect(() => {
    setRoute(null); setErr("");
    if (!tok || method !== "crypto") return;
    let alive = true;
    relayAddress(net, tok, address).then((r) => { if (alive) setRoute(r); }, (e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [net, tok, address, method]);
  const shown = method === "crypto" && tok ? route?.address : address;
  const pick = (id: string) => { setNet(id); setSym(""); };
  const methods = METHODS.filter(([m]) => m !== "etransfer" || ETRANSFER.email);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 px-6 pt-1 pb-5 max-sm:px-4">
        <div role="tablist" aria-label="Deposit method" className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {methods.map(([m, label]) => (
            <button key={m} role="tab" aria-selected={m === method} onClick={() => setMethod(m)}
              className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors duration-100",
                m === method ? "border-ink bg-ink text-on-fill" : "border-rule-2 text-ink-2 hover:border-ink-2/40 hover:text-ink")}>
              {M_ICON[m]}{label}
            </button>))}
        </div>

        {method === "crypto" && <>
          <div className="grid grid-cols-4 gap-1.5 max-sm:grid-cols-3">
            {NETS.map((n) => (
              <button key={n.id} onClick={() => pick(n.id)} aria-pressed={n.id === netId} className={tile(n.id === netId)}>
                <Logo src={n.logo} className="size-5" /><span className="truncate">{n.name}</span>
              </button>))}
          </div>
          <div className="flex h-8 items-center gap-1.5">
            {net.tokens.length > 1 ? net.tokens.map((t) => (
              <button key={t.sym} onClick={() => setSym(t.sym)} aria-pressed={t === tok}
                className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors duration-100",
                  t === tok ? "border-ink/40 bg-paper-4 text-ink" : "border-rule-2 text-ink-2 hover:text-ink")}>
                <Logo src={t.logo} className="size-4" />{t.sym}
              </button>)) : <span className="flex items-center gap-1.5 text-sm text-muted"><Logo src={tok ? tok.logo : ""} className="size-4" />{tok ? `${tok.sym} only` : "SOL, USDC or any Solana token"}</span>}
          </div>
          <div className="flex gap-5 rounded-2xl border border-rule-2 bg-paper-3/30 p-3 max-sm:gap-3 max-sm:p-2.5">
            {shown ? <Qr text={shown} mark={tok ? net.logo : undefined} /> : <span className="block size-[13.25rem] shrink-0 animate-pulse rounded-[18px] bg-paper-4 max-sm:size-36" />}
            <div className="flex min-w-0 flex-1 flex-col gap-2 py-2 pr-1">
              <span className="text-sm font-medium text-muted">{tok ? `${tok.sym} on ${net.name}` : "Your Solana address"}</span>
              {err ? <p className="text-sm text-down">{err}</p>
                : shown ? <p className="font-outlier text-md leading-[1.55] font-medium break-all text-ink select-all">{shown}</p>
                : <span className="flex flex-col gap-1.5"><i className="h-4 w-full animate-pulse rounded bg-paper-4" /><i className="h-4 w-2/3 animate-pulse rounded bg-paper-4" /></span>}
              <div className="mt-auto flex flex-col gap-1 text-xs text-muted">
                {tok ? <>
                  <span>Arrives as <b className="font-semibold text-ink-2">SOL</b>, usually within {net.id === "bitcoin" ? "about 20 minutes" : "a minute"}</span>
                  {route?.rate ? <span className="num">1 {tok.sym} ≈ {rateText(route.rate)} SOL</span> : null}
                </> : <span>Lands in your wallet in seconds</span>}
              </div>
            </div>
          </div>
          <p className="flex gap-2 text-xs leading-relaxed text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-px size-4 shrink-0" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
            {tok ? <span>Only send <b className="text-ink-2">{tok.sym}</b> on <b className="text-ink-2">{net.name}</b> here; anything else is lost. Send {net.min ?? "$2"} or more. Bridged by Relay.</span>
              : <span>Only send on the <b className="text-ink-2">Solana</b> network. Tokens other than SOL stay as they are; swap them in Convert.</span>}
          </p>
        </>}

        {method === "wallet" && <FromWallet address={address} />}
        {method === "card" && <Buy address={address} stripe={stripe} />}

        {method === "exchange" && <>
          <div className="flex flex-wrap gap-1.5">
            {["Coinbase", "Binance", "Kraken", "OKX", "Bybit", "Crypto.com", "Robinhood", "Wealthsimple"].map((x) => <span key={x} className="rounded-full border border-rule-2 px-3 py-1 text-sm font-medium text-ink-2">{x}</span>)}
          </div>
          <div className={cn(card, "flex flex-col gap-3 p-4")}>
            <Steps items={[<>Open <b className="text-ink">Withdraw</b> or <b className="text-ink">Send</b> and pick <b className="text-ink">SOL</b>.</>, <>Choose the <b className="text-ink">Solana</b> network, never ERC-20 or BEP-20.</>, <>Paste your Blix address and confirm. It lands in about a minute.</>]} />
          </div>
          <AddressRow address={address} />
          <p className="text-xs text-muted">Holding ETH, USDC or BTC on the exchange instead? Pick its network under Crypto and send it there: it arrives as SOL.</p>
        </>}

        {method === "etransfer" && ETRANSFER.email && <>
          <div className={cn(card, "flex flex-col gap-3 p-4")}>
            <b className="text-md font-semibold text-ink">Interac e-Transfer (Canada)</b>
            <Steps items={[<>Send an e-Transfer to <b className="text-ink select-all">{ETRANSFER.email}</b>.</>, <>Put your Blix address below in the <b className="text-ink">message</b>.</>, <>We send the SOL to your wallet {ETRANSFER.eta}, at the market price.</>]} />
            <span className="text-xs text-muted">Minimum {ETRANSFER.min}.</span>
          </div>
          <AddressRow address={address} label="Paste this in the e-Transfer message" />
        </>}
      </div>
      {(method === "crypto" || method === "exchange") && (
        <div className="sticky bottom-0 border-t border-rule-2 bg-paper-2 px-6 py-5 max-sm:px-4 max-sm:py-4">
          <button onClick={() => shown && copy(shown)} disabled={!shown}
            className={cn("flex h-12 w-full items-center justify-center gap-2 rounded-full text-lg font-semibold text-black transition-[background-color,transform] duration-150 active:scale-[0.99] disabled:opacity-50",
              done ? "bg-up" : "bg-ink hover:bg-white")}>
            {done ? <><CheckIcon className="size-4.5" />Copied</> : method === "crypto" && tok ? `Copy ${net.name} address` : "Copy address"}
          </button>
        </div>
      )}
    </div>
  );
}

// A payment mark as checkouts show it: the logo on a small white card (Visa in its blue).
const MARK_TONE: Partial<Record<PayMark, string>> = { visa: "text-[#1a1f71]" };
const Mark = ({ m }: { m: PayMark }) => <span className="grid h-[18px] w-[30px] place-items-center rounded-[4px] bg-white"><PayLogo mark={m} className={cn("size-5", MARK_TONE[m] ?? "text-black")} /></span>;

// Card and bank payments are taken by a payment provider on its own page; the SOL it buys is sent to this wallet.
// Interac e-Transfer (Canada) is the owner's own: CAD to ETRANSFER.email with the Blix address in the message, the
// SOL sent by hand.
interface Provider { id: string; name: string; logo: ReactNode; how: string; marks: PayMark[]; badge?: [string, string]; go: () => void }
const Tile = ({ children, className }: { children: ReactNode; className?: string }) =>
  <span className={cn("grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl ring-1 ring-white/10 ring-inset", className)}>{children}</span>;
const MoonPayMark = () => (
  <Tile className="bg-[#7715f5]"><svg viewBox="0 0 24 24" className="size-6" aria-hidden><circle cx="10.5" cy="13.5" r="7" fill="#fff" /><circle cx="18.5" cy="5.5" r="3" fill="#fff" /></svg></Tile>
);

function ETransfer({ address }: { address: string }) {
  const mail = useCopy(), addr = useCopy();
  return (
    <div className="flex flex-col gap-3 border-t border-rule px-3.5 pt-3.5 pb-4">
      <Steps items={[
        <span key="1" className="flex flex-wrap items-center gap-x-2 gap-y-1">Send an e-Transfer in CAD to
          <button onClick={() => mail.copy(ETRANSFER.email, "Email copied")} className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg px-2 font-semibold transition-colors", mail.done ? "bg-up/15 text-up" : "bg-paper-4 text-ink hover:bg-paper-5")}>
            {ETRANSFER.email}{mail.done ? <CheckIcon className="size-3.5" /> : <Icon.copy className="size-3.5" />}
          </button></span>,
        <span key="2" className="flex flex-col gap-1.5">Paste your Blix address in the message:
          <button onClick={() => addr.copy(address)} className={cn("flex h-8 min-w-0 items-center gap-2 rounded-lg px-2.5 text-left font-outlier text-xs transition-colors", addr.done ? "bg-up/15 text-up" : "bg-paper-4 text-ink hover:bg-paper-5")}>
            <span className="min-w-0 flex-1 truncate">{address}</span>{addr.done ? <CheckIcon className="size-3.5 shrink-0" /> : <Icon.copy className="size-3.5 shrink-0" />}
          </button></span>,
        <>We send the SOL to your wallet {ETRANSFER.eta}, at the market price.</>,
      ]} />
      <span className="text-xs text-muted">Minimum {ETRANSFER.min}. Canadian bank accounts only.</span>
    </div>
  );
}

function Buy({ address, stripe }: { address: string; stripe: boolean }) {
  const [busy, setBusy] = useState(false), [open, setOpen] = useState<string | null>(null);
  // Opened on the click itself (so the browser allows the tab), the address already on the clipboard.
  const go = (url: string, name: string) => {
    navigator.clipboard?.writeText(address).catch(() => {});
    window.open(url, "_blank", "noopener");
    toast(`Address copied: paste it when ${name} asks for your wallet`);
  };
  const cards: PayMark[] = ["visa", "mastercard", "applepay", "googlepay"];
  const providers: Provider[] = [
    ...(ETRANSFER.email ? [{ id: "etransfer", name: "Interac e-Transfer", logo: <Tile className="bg-[#fdb913]"><img src="brand/pay/interac.webp" alt="" className="size-full object-cover" /></Tile>,
      how: `From any Canadian bank · SOL in 1 to 2 hours`, marks: [] as PayMark[], badge: ["Canada", "bg-down/12 text-[#ff6b6b]"] as [string, string], go: () => setOpen(open === "etransfer" ? null : "etransfer") }] : []),
    ...(stripe ? [{ id: "stripe", name: "Stripe", logo: <Tile className="bg-[#635bff] text-lg font-bold text-white">S</Tile>, how: "Card, Apple Pay, Google Pay", marks: cards, badge: ["Fastest", "bg-up/12 text-up"] as [string, string], go: async () => {
      setBusy(true);
      const tab = window.open("about:blank", "_blank");
      try { const { url } = await call<{ url: string }>("onramp", { provider: "stripe" }); if (tab) tab.location.href = url; else location.href = url; }
      catch (e) { tab?.close(); toast((e as Error).message); }
      setBusy(false);
    } }] : []),
    { id: "onramper", name: "Onramper", logo: <Tile><img src="brand/pay/onramper-tile.webp" alt="" className="size-full object-cover" /></Tile>, how: "Compares Banxa, MoonPay and more", marks: cards, badge: ["Best rate", "bg-up/12 text-up"],
      go: () => go(onramper(address), "the provider") },
    { id: "moonpay", name: "MoonPay", logo: <MoonPayMark />, how: "Card, PayPal or bank transfer", marks: cards,
      go: () => go(`https://buy.moonpay.com/?${new URLSearchParams({ currencyCode: "sol", walletAddress: address })}`, "MoonPay") },
  ];
  return (
    <div className="flex min-h-full flex-1 flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold text-ink">Buy SOL with cash</h3>
        <p className="mt-0.5 text-sm text-muted">Pick how you pay. The SOL lands straight in your Blix wallet.</p>
      </div>
      <div className="flex flex-col gap-2">
        {providers.map((p) => {
          const expanded = open === p.id;
          return (
            <div key={p.id} className={cn("overflow-hidden rounded-2xl border bg-paper-3/30 transition-colors duration-150", expanded ? "border-ink/25 bg-paper-3/60" : "border-rule-2 hover:border-ink-2/30 hover:bg-paper-3/50")}>
              <button disabled={busy} onClick={p.go} aria-expanded={p.id === "etransfer" ? expanded : undefined}
                className="group flex w-full items-center gap-3.5 px-3.5 py-3.5 text-left disabled:opacity-50">
                {p.logo}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2"><b className="text-md font-semibold text-ink">{p.name}</b>
                    {p.badge && <span className={cn("rounded-full px-2 py-0.5 text-2xs font-semibold", p.badge[1])}>{p.badge[0]}</span>}</span>
                  <span className="mt-0.5 block truncate text-sm text-muted">{p.how}</span>
                </span>
                {p.marks.length > 0 && <span className="flex shrink-0 items-center gap-1 max-sm:hidden">{p.marks.map((m) => <Mark key={m} m={m} />)}</span>}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden
                  className={cn("size-4 shrink-0 text-muted transition-transform duration-150 group-hover:text-ink", p.id === "etransfer" ? expanded && "rotate-180" : "group-hover:translate-x-0.5")}>
                  {p.id === "etransfer" ? <path d="m6 9 6 6 6-6" /> : <path d="M7 17L17 7M9 7h8v8" />}
                </svg>
              </button>
              {expanded && p.id === "etransfer" && <ETransfer address={address} />}
            </div>
          );
        })}
      </div>
      <div className="mt-auto flex flex-col gap-3">
        <AddressRow address={address} label="Your Blix wallet: providers ask for it" />
        <p className="flex items-center gap-1.5 text-xs text-muted"><Icon.shield className="size-3.5 shrink-0" />Card providers check your ID and set their own fee. Blix never sees your card.</p>
      </div>
    </div>
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
          {/* One height for every tab and method, so the window does not jump as you click through; long content scrolls. */}
          <div className="flex h-[min(40rem,calc(100dvh-13rem))] flex-col overflow-y-auto">
            {tab === "deposit" ? <Deposit address={me.address} onBuy={() => useExchange.setState({ tab: "buy" })} stripe={Boolean(me.onramp?.stripe)} />
              : <div className={cn(pad, "flex-1")}>{tab === "buy" ? <Buy address={me.address} stripe={Boolean(me.onramp?.stripe)} /> : <Convert sol={me.wallet?.sol ?? 0} usdc={+usdc} />}</div>}
          </div>
        </>
      ))}
    </Dialog>
  );
}
