// The right column: 5-minute flow, the paper trade panel at real quotes, your paper position,
// token info (an icon and a figure each, green when clean, red when not), addresses and links.
import { UNLOCK_USD, useAiUnlock } from "../AiPicks";
import { SolanaLogo } from "@/components/brand";
import { useFeeBps } from "@/components/ShareLink";
import { SiteLogo, PADS, padOf, type Site } from "@/components/logos";
import { depositPaper, loadPaperSizes, setCur, useCur, USDC_MINT, USDC_SIZES, useTrade, type Cur } from "@/lib/mode";
import { trade } from "@/lib/trade";
import { useMe } from "@/lib/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { api, post } from "@/lib/api";
import { pctN, sinceMs, tokN, usdK, usdSigned, type CoinData, type Quote, type TokenDetail } from "@/lib/coin";
import { shortAddr } from "@/lib/format";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { CIcon, copy, SolAmt } from "./parts";
import type { Pos } from "./position";
import { usePositionCard } from "./PnlShare";
import { MigratingNote, MIGRATING_TIP } from "@/components/Migrating";

const card = "surface p-3";
const H = ({ children }: { children: ReactNode }) => <h3 className="label mb-2 flex items-center gap-1.5">{children}</h3>;
const PaperTag = () => <span className="rounded-[5px] bg-info/15 px-1.5 py-px text-[10px] font-bold tracking-[0.08em] text-info shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-info)_25%,transparent)]">PAPER</span>;
const RealTag = () => <span className="flex items-center gap-1 rounded-[5px] bg-up/12 px-1.5 py-px text-[10px] font-bold tracking-[0.08em] text-up shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-up)_25%,transparent)]"><i className="size-1.5 animate-pulse rounded-full bg-up" />LIVE</span>;

export function Flow({ c }: { c: CoinData | null }) {
  const m = c?.m5;
  if (!m) return <div className={cn(card, "text-sm text-muted")}>No trades in the last 5 minutes.</div>;
  const total = m.buyUsd != null && m.sellUsd != null ? m.buyUsd + m.sellUsd : m.buys + m.sells;
  const share = total > 0 ? (m.buyUsd != null && m.sellUsd != null ? m.buyUsd : m.buys) / total : null;
  const net = m.netUsd ?? null, up = (net ?? 0) >= 0;
  // Volume and net flow on top, then the buy/sell split as one bar with each side's count and dollars under it.
  return (
    <div className={cn(card, "flex flex-col gap-3 p-3.5")}>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted"><i className="size-1.5 animate-pulse rounded-full bg-up" />5m volume</span>
          <b className="num text-xl leading-none font-semibold tracking-tight text-ink">{usdK(m.volUsd)}</b>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-xs font-medium text-muted">Net flow</span>
          <span className={cn("num flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold", net == null || net === 0 ? "bg-white/[0.06] text-ink-2" : up ? "bg-up/12 text-up" : "bg-down/12 text-down")}>
            {net != null && net !== 0 && <svg viewBox="0 0 12 12" className={cn("size-2.5", !up && "rotate-180")} fill="currentColor" aria-hidden><path d="M6 2l4 6H2z" /></svg>}
            {net == null ? "—" : usdSigned(net)}
          </span>
        </div>
      </div>
      {share != null && (
        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
          <i className="block h-full rounded-l-full bg-gradient-to-r from-up/70 to-up transition-[width] duration-500" style={{ width: `${share * 100}%` }} />
          <i className="block h-full flex-1 rounded-r-full bg-gradient-to-r from-down to-down/70" />
        </div>
      )}
      <div className="num flex items-center justify-between text-sm">
        <span className="flex items-baseline gap-1.5"><b className="font-semibold text-up">{m.buys}</b><span className="text-muted">buys{m.buyUsd != null && ` · ${usdK(m.buyUsd)}`}</span></span>
        {share != null && <span className="text-xs text-muted">{Math.round(share * 100)}% buy</span>}
        <span className="flex items-baseline gap-1.5"><span className="text-muted">{m.sellUsd != null && `${usdK(m.sellUsd)} · `}sells</span><b className="font-semibold text-down">{m.sells}</b></span>
      </div>
    </div>
  );
}

// Paper buys and sells filled at the real quote (Jupiter, or the curve's own math). Nothing is really bought.
const SLIPS: [number, string][] = [[100, "1%"], [300, "3%"], [500, "5%"], [1000, "10%"]];
const PCTS = [25, 50, 100];
export function TradePanel({ mint, symbol, r, onDone, pos, solUsd, migrating = null }: { mint: string; symbol: string; r: TokenDetail; onDone: () => void; pos: Pos; solUsd?: number | null; migrating?: number | null }) {
  // The live PnL card (./PnlShare.tsx), from the icon by the paper/real tag.
  const pnlCard = usePositionCard(pos, mint, symbol, solUsd);
  // Blix's fee on real-money trades (blix-vault feeBps), out of the SOL spent or received: less for an invited trader.
  const FEE = useFeeBps() / 10_000;
  const open = (r.paper || []).filter((p) => p.status === "open");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [sizes, setSizes] = useState<number[]>([0.1, 0.25, 0.5, 1]);
  const [sol, setSolState] = useState<number>(() => store.get("trade:sol", 0.25));
  // In USDC (Axiom's switch): the buy is sized in USDC and a sell is paid in USDC; its own amount, kept apart.
  const cur = useCur((st) => st.cur), inUsdc = cur === "USDC";
  const [usdc, setUsdcState] = useState<number>(() => store.get("trade:usdc", 25));
  const [pct, setPct] = useState(100);
  const [slip, setSlipState] = useState<number>(() => store.get("trade:slip", 300));
  const [q, setQ] = useState<{ key: string; quote?: Quote; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const setSol = (v: number) => { store.set("trade:sol", v); setSolState(v); };
  const setUsdc = (v: number) => { store.set("trade:usdc", v); setUsdcState(v); };
  const setSlip = (v: number) => { store.set("trade:slip", v); setSlipState(v); };
  const wallet = useTrade((st) => st.wallet), paperOn = useTrade((st) => st.paper);
  // Paper off: the same panel trades the signed-in wallet's real SOL (or USDC), and sells what that wallet holds.
  const me = useMe((st) => st.me), held = me?.wallet?.tokens?.find((x) => x.mint === mint)?.ui ?? 0;
  const usdcHeld = me?.wallet?.tokens?.find((x) => x.mint === USDC_MINT)?.ui ?? 0;
  const canSell = paperOn ? open.length > 0 : held > 0;
  const s = side === "sell" && !canSell ? "buy" : side;
  const realSell = !paperOn && s === "sell";
  const amount = inUsdc ? usdc : sol;   // what the buy spends, in `cur`
  const key = s === "buy" ? `buy:${mint}:${cur}:${amount}:${slip}:${paperOn ? "p" : "r"}` : realSell ? `sell:real:${pct}:${cur}` : `sell:${open.map((p) => p.id).join(",")}:${pct}:${cur}`;
  const keyRef = useRef(key); keyRef.current = key;

  useEffect(() => { loadPaperSizes().then((s) => s && setSizes(s)); }, []);
  // Quote now, then every 3 s; a newer request wins.
  useEffect(() => {
    let alive = true, timer = 0;
    const run = async () => {
      if (realSell || !(s === "buy" ? amount > 0 : open[0])) { setQ(null); return; }
      try {
        // A sell takes the same share of every open paper row (each buy is its own row): their previews summed.
        // A real buy trades the SOL less Blix's fee, so it is quoted on that (a USDC buy trades all its USDC; its fee
        // is SOL beside it).
        const quote = s === "buy" ? await api<Quote>(`quote?mint=${mint}&side=buy&amount=${paperOn || inUsdc ? amount : +(sol * (1 - FEE)).toFixed(9)}&slip=${slip}${inUsdc ? "&quote=usdc" : ""}`)
          : await Promise.all(open.map((p) => api<Quote>(`paper/${p.id}/preview?pct=${pct}`))).then((qs) => ({ ...qs[0], outSol: qs.reduce((a, x) => a + (x.outSol || 0), 0), impactPct: Math.max(...qs.map((x) => x.impactPct ?? 0)) }));
        if (alive && keyRef.current === key) setQ({ key, quote });
      } catch (e) { if (alive && keyRef.current === key) setQ({ key, error: (e as Error).message }); }
      // Again every 6 s while the tab is in view (it was 3 s: a panel left open on a bonded coin was a fifth of
      // the radar's Jupiter allowance by itself, 2026-10-11); a hidden tab waits until it is back.
      if (alive) timer = window.setTimeout(function again() { if (document.hidden) { timer = window.setTimeout(again, 2000); return; } run(); }, 6000);
    };
    const t = window.setTimeout(run, 250);
    return () => { alive = false; clearTimeout(t); clearTimeout(timer); };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy(true);
    const money = inUsdc ? { usdc } : { sol };
    const ok = await trade(s === "buy" ? { side: "buy", mint, symbol, ...money, slippageBps: slip } : { side: "sell", mint, symbol, pct, to: cur, slippageBps: slip },
      async () => { if (s === "buy") return post("paper/quoted", { mint, ...money, slippageBps: slip }); for (const p of open) await post(`paper/${p.id}/sellq`, { pct, why: "coin page" }); });
    if (ok) onDone();
    setBusy(false);
  };
  const quote = q?.key === key ? q.quote : undefined, error = q?.key === key ? q.error : undefined;
  const buy = s === "buy";
  // Buy is green, sell is red: the side colours the tabs, the picked chips, the amount box and the button.
  const sideOn = buy ? "border-up/45 bg-up/[0.1] text-ink shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-up)_20%,transparent)]" : "border-down/45 bg-down/[0.1] text-ink shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-down)_20%,transparent)]";
  const chip = (on: boolean) => cn("num h-8 rounded-lg border text-sm font-semibold transition-colors duration-150", on ? sideOn : "border-white/[0.07] bg-paper text-ink-2 hover:border-white/15 hover:text-ink");
  // The balance in the money picked: SOL, or USDC (the paper desk holds SOL: its worth in USDC at the live price).
  const usdcTxt = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2));
  const balance = inUsdc
    ? paperOn ? (wallet && wallet.solUsd > 0 ? usdcTxt(wallet.cash * wallet.solUsd) : null) : me?.signedIn ? usdcTxt(usdcHeld) : null
    : paperOn ? (wallet ? wallet.cash.toFixed(3) : null) : me?.signedIn ? (me.wallet?.sol ?? 0).toFixed(3) : null;
  const curBtn = (c: Cur) => cn("num h-5 rounded-md px-1.5 text-[11px] font-bold transition-colors duration-150", cur === c ? "bg-paper-5 text-ink shadow-[inset_0_1px_0_oklch(100%_0_0/0.08)]" : "text-muted hover:text-ink-2");
  const stat = (label: string, value: ReactNode, cls = "text-ink-2") => <div className="flex items-center justify-between gap-2"><span className="text-muted">{label}</span><b className={cn("truncate text-right font-semibold", cls)}>{value}</b></div>;
  // The gear: slippage and the quote's detail, out of the way like Fomo keeps them.
  const [more, setMore] = useState(false);
  const name = r.token.name || symbol;
  const zero = buy ? !(amount > 0) : false;
  const ok = r.verdict?.ok, unknown = r.verdict?.unknown || r.verdict == null, reasons = r.verdict?.reasons || [];
  const flag = unknown ? "Unverified token" : ok ? "Checks pass" : reasons[0] || "Flagged";
  // Fomo's trade panel, one to one, in Blix's colours: Buy / Sell tiles, one big amount, four round sizes, the worth
  // line, one big button, and the token's standing under it. Everything else sits behind the gear.
  const tileBase = "num flex h-12 items-center justify-center rounded-[12px] text-[17px] font-semibold transition-[background-color,color,transform] duration-150 active:scale-[0.98]";
  const sizeTile = (on: boolean) => cn(tileBase, on ? "bg-paper-5 text-ink" : "bg-paper-4 text-ink hover:bg-paper-5");
  const curBtn2 = (c: Cur) => cn("num rounded-[8px] px-2 py-1 text-[13px] font-semibold transition-colors duration-150", cur === c ? "bg-paper-5 text-ink" : "text-muted hover:text-ink-2");
  const worth = buy
    ? (amount > 0 ? (quote ? <>{tokN(quote.outTokens)} <span className="text-muted">{symbol}</span>{quote.usdIn != null && <span className="text-muted"> · {usdK(quote.usdIn)}</span>}</> : error ? <span className="text-down">{error}</span> : <span className="text-muted">Pricing…</span>) : <span className="text-muted">{inUsdc ? "$0" : "0 SOL"}</span>)
    : realSell ? <>{pct === 100 ? "All" : `${pct}%`} of {held.toLocaleString(undefined, { maximumFractionDigits: 0 })} <span className="text-muted">{symbol}</span></>
    : quote ? <>{inUsdc && quote.usdOut != null ? <>{quote.usdOut.toFixed(2)} <span className="text-muted">USDC</span></> : <SolAmt v={quote.outSol} />}{quote.usdOut != null && !inUsdc && <span className="text-muted"> · {usdK(quote.usdOut)}</span>}</> : error ? <span className="text-down">{error}</span> : <span className="text-muted">Pricing…</span>;
  return (
    <div className={cn(card, "flex flex-col gap-3 rounded-[18px] p-3.5")}>
      {/* Buy / Sell, Fomo's two tiles, and the gear */}
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2">
          <button onClick={() => setSide("buy")} aria-pressed={buy}
            className={cn("h-14 rounded-[14px] text-[19px] font-semibold transition-colors duration-150", buy ? "bg-up/[0.16] text-up" : "bg-paper-4 text-ink-2 hover:text-ink")}>Buy</button>
          <button onClick={() => setSide("sell")} disabled={!canSell} title={canSell ? undefined : "Nothing to sell yet"} aria-pressed={!buy}
            className={cn("h-14 rounded-[14px] text-[19px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40", !buy ? "bg-down/[0.16] text-down" : "bg-paper-4 text-ink-2 hover:text-ink")}>Sell</button>
        </div>
        <Tip tip={more ? "Hide slippage and the quote's detail" : "Slippage and the quote's detail"}>
          <button onClick={() => setMore((m) => !m)} aria-expanded={more} aria-label="Trade settings"
            className={cn("grid size-11 shrink-0 place-items-center rounded-[12px] transition-colors duration-150", more ? "bg-paper-5 text-ink" : "text-muted hover:bg-paper-4 hover:text-ink")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
          </button>
        </Tip>
      </div>

      {buy ? (
        <>
          {/* The amount: one big field, the figure huge on the left, the money on the right */}
          <label className="flex h-[88px] items-center gap-3 rounded-[14px] bg-paper-4 px-5 transition-colors duration-150 focus-within:bg-paper-5">
            <span className="flex min-w-0 flex-1 items-baseline gap-1">
              {inUsdc ? <span className={cn("num text-[34px] leading-none font-semibold", amount > 0 ? "text-ink" : "text-muted/70")}>$</span> : <SolanaLogo className={cn("mr-1 size-6 shrink-0 self-center", amount > 0 ? "" : "opacity-50")} />}
              <input type="number" min="0" step={inUsdc ? "1" : "0.01"} value={amount || ""} onChange={(e) => (inUsdc ? setUsdc : setSol)(Math.max(0, +e.target.value || 0))} aria-label={`${cur} to spend`} placeholder="0"
                className="num w-full min-w-0 bg-transparent text-[34px] leading-none font-semibold tracking-tight text-ink outline-none placeholder:text-muted/70 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {!(amount > 0) && <span className="text-[15px] text-muted">Enter amount</span>}
              <span role="radiogroup" aria-label="Trade in SOL or USDC" className="flex gap-0.5 rounded-[9px] bg-paper-3 p-0.5">
                <button role="radio" aria-checked={!inUsdc} onClick={(e) => { e.preventDefault(); setCur("SOL"); }} className={curBtn2("SOL")}>SOL</button>
                <button role="radio" aria-checked={inUsdc} onClick={(e) => { e.preventDefault(); setCur("USDC"); }} className={curBtn2("USDC")}>USDC</button>
              </span>
            </span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(inUsdc ? FOMO_USDC : sizes).map((v) => <button key={v} onClick={() => (inUsdc ? setUsdc : setSol)(v)} className={sizeTile(amount === v)}>{inUsdc ? `$${v.toLocaleString()}` : <><SolanaLogo className="mr-1.5 size-3.5 opacity-70" />{v}</>}</button>)}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">{PCTS.map((v) => <button key={v} onClick={() => setPct(v)} className={cn(sizeTile(pct === v), "h-14", pct === v && "bg-down/[0.16] text-down")}>{v === 100 ? "All" : `${v}%`}</button>)}</div>
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[15px] text-muted">Paid in</span>
            <span role="radiogroup" aria-label="Paid in SOL or USDC" className="flex gap-0.5 rounded-[9px] bg-paper-4 p-0.5">
              <button role="radio" aria-checked={!inUsdc} onClick={() => setCur("SOL")} className={curBtn2("SOL")}>SOL</button>
              <button role="radio" aria-checked={inUsdc} onClick={() => setCur("USDC")} className={curBtn2("USDC")}>USDC</button>
            </span>
          </div>
        </>
      )}

      {/* The worth line (Fomo's "$0"): what the amount gets, and whose money this is */}
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="num min-w-0 truncate text-[17px] font-medium text-ink">{worth}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-muted" title={paperOn && wallet ? `Paper wallet: ${wallet.cash.toFixed(4)} fake SOL left of ${wallet.start}` : undefined}>
          {balance != null ? <>{inUsdc ? <img src="brand/pay/usdc.png" alt="" title="USDC" className="size-3 shrink-0 rounded-full" /> : <SolanaLogo className="size-3 shrink-0" />}<b className="num font-semibold text-ink-2">{balance}</b></> : <span>Not signed in</span>}
          {paperOn ? <PaperTag /> : <RealTag />}
        </span>
      </div>

      {more && (
        <div className="flex flex-col gap-2.5 rounded-[14px] bg-paper-4 p-3 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-medium text-muted"><Icon.sliders className="size-3.5" />Slippage</span>
            <div role="radiogroup" aria-label="Slippage" className="flex gap-0.5 rounded-[9px] bg-paper-3 p-0.5">
              {SLIPS.map(([v, l]) => <button key={v} role="radio" aria-checked={slip === v} onClick={() => setSlip(v)}
                className={cn("num rounded-[7px] px-2.5 py-1 font-semibold transition-colors duration-150", slip === v ? "bg-paper-5 text-ink" : "text-muted hover:text-ink-2")}>{l}</button>)}
            </div>
          </div>
          {quote && !realSell && (
            <div className="num grid grid-cols-2 gap-x-4 gap-y-1 border-t border-rule pt-2.5">
              {stat("Avg fill MC", usdK(quote.avgMcapUsd))}
              {stat("Now MC", usdK(quote.spotMcapUsd))}
              {stat("Impact", quote.impactPct != null ? `${quote.impactPct.toFixed(2)}%` : "—", (quote.impactPct ?? 0) > 5 ? "text-down" : (quote.impactPct ?? 0) > 2 ? "text-warn" : "text-ink-2")}
              {stat("Route", quote.route?.join(" › ") || "—")}
              {!paperOn && stat("Blix fee", buy ? (inUsdc ? `${+(usdc * FEE).toFixed(2)} USDC, paid in SOL` : `${+(sol * FEE).toFixed(5)} SOL`) : `${+(FEE * 100).toFixed(2)}%`)}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-rule pt-2.5">
            {paperOn && wallet ? <button onClick={() => depositPaper(10).then((w) => toast(`Added 10 fake SOL. ${w.cash.toFixed(3)} SOL to spend.`), (e) => toast((e as Error).message))} className="rounded-[8px] bg-paper-3 px-2.5 py-1 font-semibold text-ink-2 transition-colors hover:text-ink">+10 fake SOL</button> : <span />}
            <button onClick={pnlCard.open} className="flex items-center gap-1.5 rounded-[8px] px-2 py-1 font-medium text-muted transition-colors hover:bg-paper-3 hover:text-ink"><Icon.image className="size-3.5" />PnL card</button>
          </div>
        </div>
      )}
      {pnlCard.dialog}

      {/* Curve full, pool not live yet: nothing trades until it is (components/Migrating.tsx). */}
      {migrating ? <MigratingNote since={migrating} /> : null}
      {/* Paper fills at once (the server prices it itself), so it never waits for the preview; real money does. */}
      <button onClick={submit} disabled={busy || zero || Boolean(migrating) || (!quote && !realSell && !paperOn)} title={migrating ? MIGRATING_TIP : undefined}
        className={cn("flex h-16 items-center justify-center gap-2 rounded-[14px] text-[19px] font-semibold transition-[background-color,color,transform,opacity] duration-150 active:scale-[0.99] disabled:cursor-not-allowed",
          zero || migrating ? "bg-paper-4 text-ink-2" : buy ? "bg-up text-on-fill hover:brightness-110" : "bg-down text-on-fill hover:brightness-110", busy && "opacity-70")}>
        {busy ? <><i className="size-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />Placing…</>
          : buy ? <>Buy {name}{amount > 0 && <span className="num font-medium opacity-80">· {inUsdc ? `$${amount.toLocaleString()}` : `${amount} SOL`}</span>}</> : <>Sell {pct === 100 ? "all" : `${pct}%`} of {name}</>}
        {paperOn && !busy && <span className="rounded-[6px] bg-black/15 px-1.5 py-px text-[10px] font-bold tracking-[0.08em] uppercase">Paper</span>}
      </button>

      {/* The token's standing, Fomo's "Unverified token" line */}
      <Tip tip={unknown ? "Blix has not read this coin's safety yet" : reasons.length ? reasons.join(" · ") : "No safety flags on Blix's checks"}>
        <div className={cn("flex items-center gap-2 px-1 text-[14px] font-medium", unknown ? "text-muted" : ok ? "text-ink-2" : "text-warn")}>
          {unknown || !ok ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-up" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>}
          <span className="truncate">{flag}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="ml-auto size-4 shrink-0 text-muted" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
        </div>
      </Tip>
    </div>
  );
}
const FOMO_USDC = [10, 100, 500, 1000];   // Fomo's four sizes

// About the coin, Fomo's card under its trade panel: who gets the fees, the change over 5m / 1h / 6h / 1d (one picked,
// its buys and sells, volumes and traders as bars), the coin's links, and its own line and themes on View more.
// Figures: Jupiter's per-window stats (GET /api/jup/<mint>, server/jupdisc.js windows), asked again every 25 s.
interface Win { chg: number | null; buys: number | null; sells: number | null; buyVol: number | null; sellVol: number | null; traders: number | null; netBuyers: number | null }
interface Jup { t: number | null; mcap?: number | null; holders?: number | null; launchpad?: string | null; dev?: string | null; windows: Record<"5m" | "1h" | "6h" | "24h", Win> | null }
const WINS: ["5m" | "1h" | "6h" | "24h", string][] = [["5m", "5M"], ["1h", "1H"], ["6h", "6H"], ["24h", "1D"]];
export function About({ r, c }: { r: TokenDetail; c: CoinData | null }) {
  const t = r.token, name = t.name || t.symbol || "this coin";
  const [j, setJ] = useState<Jup | null>(null);
  const [win, setWin] = useState<"5m" | "1h" | "6h" | "24h">("1h");
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    let on = true;
    const look = () => api<Jup>(`jup/${t.mint}`).then((x) => { if (on && x?.windows) setJ(x); }).catch(() => {});
    look();
    const timer = setInterval(() => { if (!document.hidden) look(); }, 25_000);
    return () => { on = false; clearInterval(timer); };
  }, [t.mint]);
  const w = j?.windows?.[win] || null;
  const dev = c?.dev?.wallet || t.creator || j?.dev || null;
  const pad = padOf({ mint: t.mint, pool: (t as { pool?: string | null }).pool, dex: (t as { dex?: string | null }).dex });
  const padName = PADS[pad]?.name || (j?.launchpad ?? null);
  const link = (type: string) => t.links?.find((l) => l.type === type)?.url || null;
  const site = link("website"), tw = link("twitter"), tg = link("telegram");
  const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString());
  const pctTxt = (v: number | null) => (v == null ? "—" : `${Math.abs(v) >= 1000 ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(2)}%`);
  // Two bars from one pair: each side's share of the pair's total, the green from the left and the red from the right.
  const bars = (left: number | null, right: number | null) => {
    const a = left ?? 0, b = right ?? 0, tot = a + b;
    const la = tot > 0 ? Math.max(4, Math.round((a / tot) * 100)) : 50;
    return (
      <div className="grid grid-cols-2 gap-2">
        <i className="block h-2 rounded-full bg-paper-4"><i className="block h-full rounded-full bg-up transition-[width] duration-500" style={{ width: `${la}%` }} /></i>
        <i className="block h-2 rounded-full bg-paper-4"><i className="ml-auto block h-full rounded-full bg-down transition-[width] duration-500" style={{ width: `${100 - la}%` }} /></i>
      </div>
    );
  };
  const row = (lv: ReactNode, ll: string, rv: ReactNode, rl: string, l: number | null, rr: number | null) => (
    <div className="flex flex-col gap-1.5">
      <div className="num flex items-baseline justify-between text-[17px] font-semibold text-ink">
        <span>{lv} <span className="text-[15px] font-normal text-muted">{ll}</span></span>
        <span>{rv} <span className="text-[15px] font-normal text-muted">{rl}</span></span>
      </div>
      {bars(l, rr)}
    </div>
  );
  const chipCls = "flex h-10 items-center gap-2 rounded-[12px] border border-rule-2 bg-paper-4 px-3.5 text-[15px] font-semibold text-ink transition-colors duration-150 hover:bg-paper-5";
  return (
    <div className={cn(card, "flex flex-col gap-3.5 rounded-[18px] p-4")}>
      <div className="flex flex-col gap-1">
        <h3 className="text-[19px] leading-tight font-semibold text-ink">About {name}</h3>
        <span className="truncate text-[14px] text-muted">
          {dev ? <>Creator fees to <button onClick={() => copy(dev, "Dev address copied")} className="num font-medium text-ink-2 hover:text-ink">{shortAddr(dev)}</button></> : "Creator unknown"}
          {padName ? ` via ${padName}` : ""}
        </span>
      </div>

      <div role="radiogroup" aria-label="Window" className="grid grid-cols-4 gap-2">
        {WINS.map(([k, label]) => {
          const v = j?.windows?.[k]?.chg ?? null, up = (v ?? 0) >= 0;
          return (
            <button key={k} role="radio" aria-checked={win === k} onClick={() => setWin(k)}
              className={cn("flex flex-col items-center gap-1 rounded-[12px] py-2.5 transition-colors duration-150", win === k ? "bg-paper-5" : "bg-paper-4 hover:bg-paper-5")}>
              <span className="text-[13px] font-medium text-muted">{label}</span>
              <span className={cn("num flex max-w-full items-center gap-0.5 truncate px-1 font-semibold", Math.abs(v ?? 0) >= 1000 ? "text-[12px]" : "text-[13px]", v == null ? "text-muted" : up ? "text-up" : "text-down")}>
                {v != null && <svg viewBox="0 0 12 12" className={cn("size-2.5", !up && "rotate-180")} fill="currentColor" aria-hidden><path d="M6 2l4 6H2z" /></svg>}{pctTxt(v)}
              </span>
            </button>
          );
        })}
      </div>

      {w ? (
        <div className="flex flex-col gap-3">
          {row(n(w.buys), "buys", n(w.sells), "sells", w.buys, w.sells)}
          {row(usdK(w.buyVol), "vol.", usdK(w.sellVol), "vol.", w.buyVol, w.sellVol)}
          <div className="num flex items-baseline justify-between text-[17px] font-semibold text-ink">
            <span>{n(w.traders)} <span className="text-[15px] font-normal text-muted">traders</span></span>
            <span className={cn((w.netBuyers ?? 0) >= 0 ? "text-up" : "text-down")}>{w.netBuyers == null ? "—" : `${w.netBuyers >= 0 ? "+" : "−"}${Math.abs(w.netBuyers).toLocaleString()}`} <span className="text-[15px] font-normal text-muted">net buyers</span></span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">{[0, 1].map((i) => <div key={i} className="flex flex-col gap-1.5"><i className="h-5 w-2/3 animate-pulse rounded bg-paper-4" /><i className="h-2 w-full animate-pulse rounded-full bg-paper-4" /></div>)}</div>
      )}

      <div className="flex flex-wrap gap-2">
        {site && <a href={site} target="_blank" rel="noopener noreferrer" className={chipCls}><Icon.web className="size-4" />Website</a>}
        {tw && <a href={tw} target="_blank" rel="noopener noreferrer" className={chipCls}><Icon.x className="size-3.5" />Twitter</a>}
        {tg && <a href={tg} target="_blank" rel="noopener noreferrer" className={chipCls}><Icon.tg className="size-4" />Telegram</a>}
        <a href={`https://x.com/search?q=${encodeURIComponent(`$${t.symbol || ""} OR ${t.mint}`)}&f=live`} target="_blank" rel="noopener noreferrer" className={chipCls}>Search on <Icon.x className="size-3.5" /></a>
      </div>

      {moreOpen && (
        <div className="flex flex-col gap-2 text-[14px] leading-relaxed text-ink-2">
          {t.description ? <p className="whitespace-pre-wrap">{t.description}</p> : <p className="text-muted">No description on this coin.</p>}
          {t.themes?.length ? <div className="flex flex-wrap gap-1.5">{t.themes.map((x) => <span key={x} className="rounded-full bg-paper-4 px-2.5 py-0.5 text-[13px] text-muted">{x}</span>)}</div> : null}
          {j?.holders != null && <span className="num text-[13px] text-muted">{j.holders.toLocaleString()} holders{j.mcap ? ` · ${usdK(j.mcap)} market cap` : ""}</span>}
        </div>
      )}
      <button onClick={() => setMoreOpen((m) => !m)} className="mx-auto rounded-[10px] bg-paper-4 px-4 py-2 text-[14px] font-semibold text-ink-2 transition-colors duration-150 hover:bg-paper-5 hover:text-ink">{moreOpen ? "View less" : "View more"}</button>
    </div>
  );
}

// Your position in this coin (worked out in ./position.ts): the paper one while Paper is on, the real
// wallet's while it is off. Average buy and sell are market caps per token, the chart's dashed lines.
export function Position({ pos, mint, symbol, solUsd }: { pos: Pos; mint: string; symbol: string; solUsd?: number | null }) {
  const me = useMe((st) => st.me);
  // The live PnL card of this position (./PnlShare.tsx).
  const pnlCard = usePositionCard(pos, mint, symbol, solUsd);
  const { paper: paperOn, has, bought, sold, holding, pnl, entry, exit, mcapNow } = pos;
  const cell = (label: ReactNode, value: ReactNode, cls = "") => (
    <div className="flex min-w-0 flex-col gap-0.5"><small className="flex items-center gap-1 text-xs whitespace-nowrap text-muted">{label}</small><b className={cn("num text-md font-semibold text-ink", cls)}>{value}</b></div>
  );
  // A square in the colour of the line the figure draws on the chart.
  const sq = (c: string) => <i className={cn("inline-block size-1.5", c)} />;
  const move = entry && mcapNow ? (mcapNow / entry - 1) * 100 : null;
  return (
    <div className={card}>
      <H>Your position {paperOn ? <PaperTag /> : <RealTag />}
        <button onClick={pnlCard.open} title="Your live PnL card, to save or share" className="ml-auto flex h-6 items-center gap-1 rounded-full bg-ink px-2.5 text-xs font-semibold tracking-normal text-on-fill normal-case hover:bg-focus"><Icon.image className="size-3" />Share PnL</button>
      </H>
      {pnlCard.dialog}
      <div className="grid grid-cols-4 gap-1.5">
        {cell("Bought", <SolAmt v={bought} />)}{cell("Sold", <SolAmt v={sold} />)}{cell("Holding", holding == null ? "—" : <><SolAmt v={holding} /></>)}
        <button onClick={pnlCard.open} title={pos.estimated ? "Estimated at the current price; sale proceeds depend on liquidity and fees. Open your PnL card." : "Open your PnL card"} className="min-w-0 text-left hover:opacity-80">{cell("PnL", pnl == null ? "—" : <><SolAmt v={pnl} signed />{bought ? <span className="text-xs font-normal"> {Math.round((pnl / bought) * 100)}%</span> : null}</>, pnl == null ? "" : pnl >= 0 ? "text-up" : "text-down")}</button>
      </div>
      {has && (
        <Tip tip="Market caps. Averages are per token: all the SOL paid (or got) over all the tokens bought (or sold).">
          <div className={cn("mt-2.5 grid gap-1.5 border-t border-rule pt-2.5", exit != null ? "grid-cols-4" : "grid-cols-3")}>
            {cell(<>{sq("bg-up")}Avg buy</>, entry ? usdK(entry) : "—")}
            {exit != null && cell(<>{sq("bg-down")}Avg sell</>, usdK(exit))}
            {cell("Now", mcapNow ? usdK(mcapNow) : "—")}
            {cell("Since buy", move == null ? "—" : `${move >= 0 ? "+" : "−"}${Math.abs(move).toFixed(0)}%`, move == null ? "" : move >= 0 ? "text-up" : "text-down")}
          </div>
        </Tip>
      )}
      {!paperOn && !me?.signedIn && <p className="mt-2 text-xs text-muted">Sign in to see your real position.</p>}
    </div>
  );
}

type Tone = boolean | null;   // true = bad (red), false = clean (green), null = neutral
// One reading: the figure big and coloured by how it reads, the icon and name small under it. A bad one gets a red
// wash rather than a red outline, so a column of warnings reads at a glance without the grid turning into boxes.
function Tile({ icon, value, label, bad, tip }: { icon: ReactNode; value: ReactNode; label: string; bad: Tone; tip?: string }) {
  return (
    <Tip tip={tip}>
      <div className={cn("flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-control px-1 py-2.5 text-center",
        bad === true ? "bg-down/[0.09] [&_b]:text-down" : bad === false ? "bg-paper-3/70 [&_b]:text-up" : "bg-paper-3/70")}>
        <b className="num max-w-full truncate text-md leading-none font-semibold text-ink">{value}</b>
        <small className={cn("flex max-w-full items-center gap-1 truncate text-xs leading-none text-muted [&_svg]:size-3 [&_svg]:shrink-0", bad === true && "text-down/80")}>{icon}{label}</small>
      </div>
    </Tip>
  );
}

// The DexScreener banner, like Axiom's: the coin's paid header image across the top of Token info, opening its
// DexScreener page. A picture that fails to load takes the banner away with it.
function DexBanner({ src, href, symbol }: { src: string; href: string; symbol: string }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => setOk(null), [src]);
  if (ok === false) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={`${symbol} on DexScreener`}
      className={cn("group relative -mx-3 -mt-3 mb-3 block aspect-[3/1] overflow-hidden bg-paper-3", ok === null && "animate-pulse")}>
      <img src={src} alt={`${symbol} banner`} loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false}
        onLoad={() => setOk(true)} onError={() => setOk(false)}
        className={cn("size-full object-cover transition-[opacity,scale] duration-500 group-hover:scale-[1.02]", ok ? "opacity-100" : "opacity-0")} />
      <span className="absolute top-2 right-2 flex h-5.5 items-center gap-1 rounded-full bg-black/60 pr-2 pl-1 text-xs font-bold tracking-wide text-white backdrop-blur-sm">
        <SiteLogo site="dexscreener" className="size-3.5" />DEX PAID
      </span>
    </a>
  );
}

export function Info({ r, c }: { r: TokenDetail; c: CoinData | null }) {
  // Every figure comes from /api/coin, which only passes on a reading that can still be true (unknown is "—").
  const t = r.token, i = c?.info;
  const pv = (x: number | { pct: number } | null | undefined) => x == null ? null : typeof x === "object" ? x.pct : x;
  const top10 = pv(i?.top10), dev = pv(i?.devPct), sn = pv(i?.snipers), bd = pv(i?.bundle), ins = pv(i?.insiders), safety = i?.safety ?? null;
  const curve = c?.onCurve ?? (r.progress != null && !t.graduated);
  const lp = curve ? null : (i?.lpLocked ?? null);
  const from = i?.source ? `From ${i.source}${i.checked ? `, read ${sinceMs(Date.now() - i.checked)} ago` : ""}` : c && !curve ? "RugCheck has no current reading yet (a bonded coin's first reports go stale within minutes); asking it again" : undefined;
  const ledgerOnly = curve ? "Only known for coins Blix saw from the first trade" : "Unknown after bonding: Blix reads the curve, not the pool";
  const paid = Boolean(t.header) || (t.boosts || 0) > 0;
  // The AI's grade is part of its read: behind the same $10 lock (AiPicks.tsx).
  const ai = useAiUnlock(), aiOpen = ai.state === "open";
  const grade = aiOpen ? r.research?.report?.grade || r.research?.grade || null : null;
  const tone = (v: number | null, max: number): Tone => v == null ? null : v > max;
  const banner = typeof t.header === "string" && /^https:\/\//.test(t.header) ? t.header : null;
  const devSold = c?.dev?.sold;
  return (
    <div className={cn(card, "overflow-hidden")}>
      {banner && <DexBanner src={banner} href={`https://dexscreener.com/solana/${t.pair || t.mint}`} symbol={t.symbol || "Coin"} />}
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="label">Token info</h3>
        {i?.checked ? <span className="truncate text-xs text-muted">{i.source ? `${i.source} · ` : ""}{sinceMs(Date.now() - i.checked)} ago</span> : null}
      </div>
      <div className="grid grid-cols-3 gap-1">
        <Tile icon={<Icon.crown />} value={pctN(top10)} label="Top 10" bad={tone(top10, 30)} tip={`Share held by the 10 largest wallets. ${from || ""}`} />
        <Tile icon={<Icon.chef />} value={pctN(dev)} label={devSold === "all" ? "Dev sold" : devSold ? "Dev selling" : "Dev"} bad={tone(dev, 10)} tip={`Share the dev still holds. ${from || ""}`} />
        <Tile icon={<Icon.crosshair />} value={pctN(sn)} label="Snipers" bad={tone(sn, 10)} tip={i?.snipers ? `${i.snipers.n} wallets bought within 2 blocks of the first trade; ${i.snipers.sold} sold out` : ledgerOnly} />
        <Tile icon={<Icon.ghost />} value={pctN(ins)} label="Insiders" bad={tone(ins, 20)} tip={`RugCheck insider networks. ${from || ""}`} />
        <Tile icon={<Icon.boxes />} value={pctN(bd)} label="Bundlers" bad={tone(bd, 20)} tip={i?.bundle ? `${i.bundle.n} wallets bought in the launch block` : ledgerOnly} />
        <Tile icon={<Icon.curve />} value={curve ? "Curve" : lp == null ? "—" : pctN(lp, 0)} label={curve ? "No LP yet" : "LP locked"} bad={curve || lp == null ? null : lp < 90} />
        <Tile icon={<Icon.users />} value={i?.holders != null ? i.holders.toLocaleString() : "—"} label="Holders" bad={null} tip={from} />
        <Tile icon={<Icon.userStar />} value={i?.traders != null ? i.traders.toLocaleString() : "—"} label="Traders" bad={null} tip={curve ? "Wallets that traded it on the live feed" : "Unknown after bonding: Blix reads the curve, not the pool"} />
        <Tile icon={<Icon.bolt />} value={paid ? "Paid" : "Unpaid"} label="Dex" bad={paid ? false : null} tip={paid ? "A DexScreener profile or boost was bought for this coin" : "No DexScreener profile or boost bought yet"} />
        <Tile icon={<CIcon.shield />} value={safety != null ? String(safety) : "—"} label="Safety" bad={safety == null ? null : safety < 50} tip={`RugCheck score out of 100. ${from || ""}`} />
        {aiOpen
          ? <Tile icon={<Icon.ai />} value={grade || (r.research?.status === "running" ? "…" : "—")} label="AI grade" bad={grade ? /^[DF]/.test(grade) : null} tip={r.research?.report?.verdict || undefined} />
          : <Tile icon={<Icon.ai />} value={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Locked" className="mx-auto size-4 text-muted"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>} label="AI grade" bad={null} tip={`Hold $${UNLOCK_USD} in your Blix wallet to unlock AI reads`} />}
        <Tile icon={<Icon.candles />} value={r.triage ? String(r.triage.score) : "—"} label="Triage" bad={r.triage ? r.triage.label === "slop" : null} tip={r.triage?.why} />
      </div>
    </div>
  );
}

export function Addresses({ r, c }: { r: TokenDetail; c: CoinData | null }) {
  const t = r.token, dev = c?.dev?.wallet || t.creator || null;
  const row = (name: string, a: string, kind: "token" | "account") => (
    <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
      <span className="w-14 shrink-0 text-xs font-medium text-muted">{name}</span>
      <Tip tip={`Copy ${a}`}>
        <button onClick={() => copy(a, `${name} address copied`)}
          className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-chip px-1.5 py-1 text-ink-2 transition-colors hover:bg-paper-3 hover:text-ink">
          <span className="font-outlier truncate text-xs">{shortAddr(a)}</span><Icon.copy className="ml-auto size-3.5 shrink-0 text-muted group-hover:text-ink" />
        </button>
      </Tip>
      <Tip tip="Open on Solscan">
        <a href={`https://solscan.io/${kind}/${a}`} target="_blank" rel="noreferrer" aria-label="Open on Solscan" className="grid size-7 shrink-0 place-items-center rounded-chip transition-colors hover:bg-paper-3"><SiteLogo site="solscan" className="size-4" /></a>
      </Tip>
    </div>
  );
  return <div className={cn(card, "flex flex-col divide-y divide-rule p-0")}>{row("Contract", t.mint, "token")}{dev && row("Dev", dev, "account")}</div>;
}

// Where else to look at this coin: one logo per site in an even grid, its name on hover.
export function Links({ r }: { r: TokenDetail }) {
  const t = r.token;
  const pad = padOf({ mint: t.mint, pool: (t as { pool?: string | null }).pool, dex: (t as { dex?: string | null }).dex });
  const list: [string, string, Site][] = [
    ["DexScreener", `https://dexscreener.com/solana/${t.pair || t.mint}`, "dexscreener"],
    ...(PADS[pad] ? [[PADS[pad].name, PADS[pad].url(t.mint), PADS[pad].logo] as [string, string, Site]] : []),
    ["GeckoTerminal", `https://www.geckoterminal.com/solana/pools/${t.pair || t.mint}`, "geckoterminal"], ["Birdeye", `https://birdeye.so/token/${t.mint}?chain=solana`, "birdeye"],
    ["RugCheck", `https://rugcheck.xyz/tokens/${t.mint}`, "rugcheck"], ["Bubblemaps", `https://app.bubblemaps.io/sol/token/${t.mint}`, "bubblemaps"],
    ["GMGN", `https://gmgn.ai/sol/token/${t.mint}`, "gmgn"], ["Axiom", `https://axiom.trade/meme/${t.pair || t.mint}`, "axiom"], ["Photon", `https://photon-sol.tinyastro.io/en/lp/${t.pair || t.mint}`, "photon"],
    ["Jupiter", `https://jup.ag/swap/SOL-${t.mint}`, "jupiter"], ["Solscan", `https://solscan.io/token/${t.mint}`, "solscan"],
  ];
  return (
    <div className={card}>
      <h3 className="label mb-2">Open on</h3>
      <div className="grid grid-cols-6 gap-1">
        {list.map(([l, href, logo]) => (
          <Tip key={l} tip={l}>
            <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open on ${l}`}
              className="grid aspect-square place-items-center rounded-control bg-paper-3/70 transition-[background-color,scale] duration-150 hover:bg-paper-4 active:scale-95">
              <SiteLogo site={logo} className="size-5" />
            </a>
          </Tip>
        ))}
      </div>
    </div>
  );
}
