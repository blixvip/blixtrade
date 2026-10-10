// The right column: 5-minute flow, the paper trade panel at real quotes, your paper position,
// token info (an icon and a figure each, green when clean, red when not), addresses and links.
import { UNLOCK_USD, useAiUnlock } from "../AiPicks";
import { SolanaLogo } from "@/components/brand";
import { useFeeBps } from "@/components/ShareLink";
import { SiteLogo, PADS, padOf, type Site } from "@/components/logos";
import { depositPaper, loadPaperSizes, useTrade } from "@/lib/mode";
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
export function TradePanel({ mint, symbol, r, onDone, pos, solUsd }: { mint: string; symbol: string; r: TokenDetail; onDone: () => void; pos: Pos; solUsd?: number | null }) {
  // The live PnL card (./PnlShare.tsx), from the icon by the paper/real tag.
  const pnlCard = usePositionCard(pos, mint, symbol, solUsd);
  // Blix's fee on real-money trades (blix-vault feeBps), out of the SOL spent or received: less for an invited trader.
  const FEE = useFeeBps() / 10_000;
  const open = (r.paper || []).filter((p) => p.status === "open");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [sizes, setSizes] = useState<number[]>([0.1, 0.25, 0.5, 1]);
  const [sol, setSolState] = useState<number>(() => store.get("trade:sol", 0.25));
  const [pct, setPct] = useState(100);
  const [slip, setSlipState] = useState<number>(() => store.get("trade:slip", 300));
  const [q, setQ] = useState<{ key: string; quote?: Quote; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const setSol = (v: number) => { store.set("trade:sol", v); setSolState(v); };
  const setSlip = (v: number) => { store.set("trade:slip", v); setSlipState(v); };
  const wallet = useTrade((st) => st.wallet), paperOn = useTrade((st) => st.paper);
  // Paper off: the same panel trades the signed-in wallet's real SOL, and sells what that wallet holds.
  const me = useMe((st) => st.me), held = me?.wallet?.tokens?.find((x) => x.mint === mint)?.ui ?? 0;
  const canSell = paperOn ? open.length > 0 : held > 0;
  const s = side === "sell" && !canSell ? "buy" : side;
  const realSell = !paperOn && s === "sell";
  const key = s === "buy" ? `buy:${mint}:${sol}:${slip}:${paperOn ? "p" : "r"}` : realSell ? `sell:real:${pct}` : `sell:${open.map((p) => p.id).join(",")}:${pct}`;
  const keyRef = useRef(key); keyRef.current = key;

  useEffect(() => { loadPaperSizes().then((s) => s && setSizes(s)); }, []);
  // Quote now, then every 3 s; a newer request wins.
  useEffect(() => {
    let alive = true, timer = 0;
    const run = async () => {
      if (realSell || !(s === "buy" ? sol > 0 : open[0])) { setQ(null); return; }
      try {
        // A sell takes the same share of every open paper row (each buy is its own row): their previews summed.
        // A real buy trades the SOL less Blix's fee, so it is quoted on that.
        const quote = s === "buy" ? await api<Quote>(`quote?mint=${mint}&side=buy&amount=${paperOn ? sol : +(sol * (1 - FEE)).toFixed(9)}&slip=${slip}`)
          : await Promise.all(open.map((p) => api<Quote>(`paper/${p.id}/preview?pct=${pct}`))).then((qs) => ({ ...qs[0], outSol: qs.reduce((a, x) => a + (x.outSol || 0), 0), impactPct: Math.max(...qs.map((x) => x.impactPct ?? 0)) }));
        if (alive && keyRef.current === key) setQ({ key, quote });
      } catch (e) { if (alive && keyRef.current === key) setQ({ key, error: (e as Error).message }); }
      if (alive) timer = window.setTimeout(run, 3000);
    };
    const t = window.setTimeout(run, 250);
    return () => { alive = false; clearTimeout(t); clearTimeout(timer); };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy(true);
    const ok = await trade(s === "buy" ? { side: "buy", mint, symbol, sol, slippageBps: slip } : { side: "sell", mint, symbol, pct, slippageBps: slip },
      async () => { if (s === "buy") return post("paper/quoted", { mint, sol, slippageBps: slip }); for (const p of open) await post(`paper/${p.id}/sellq`, { pct, why: "coin page" }); });
    if (ok) onDone();
    setBusy(false);
  };
  const quote = q?.key === key ? q.quote : undefined, error = q?.key === key ? q.error : undefined;
  const buy = s === "buy";
  // Buy is green, sell is red: the side colours the tabs, the picked chips, the amount box and the button.
  const sideOn = buy ? "border-up/45 bg-up/[0.1] text-ink shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-up)_20%,transparent)]" : "border-down/45 bg-down/[0.1] text-ink shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-down)_20%,transparent)]";
  const chip = (on: boolean) => cn("num h-8 rounded-lg border text-sm font-semibold transition-colors duration-150", on ? sideOn : "border-white/[0.07] bg-paper text-ink-2 hover:border-white/15 hover:text-ink");
  const balance = paperOn ? (wallet ? wallet.cash.toFixed(3) : null) : me?.signedIn ? (me.wallet?.sol ?? 0).toFixed(3) : null;
  const stat = (label: string, value: ReactNode, cls = "text-ink-2") => <div className="flex items-center justify-between gap-2"><span className="text-muted">{label}</span><b className={cn("truncate text-right font-semibold", cls)}>{value}</b></div>;
  return (
    <div className={cn(card, "flex flex-col gap-3 p-3.5")}>
      {/* Buy / Sell, then whose money: balance, PAPER or LIVE, the PnL card */}
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.06] bg-paper p-1">
        <button onClick={() => setSide("buy")} className={cn("h-8 rounded-lg text-sm font-bold transition-all duration-150", buy ? "bg-up text-on-fill shadow-[0_2px_12px_-2px_color-mix(in_oklch,var(--color-up)_60%,transparent)]" : "text-muted hover:text-ink")}>Buy</button>
        <button onClick={() => setSide("sell")} disabled={!canSell} title={canSell ? undefined : "Nothing to sell yet"} className={cn("h-8 rounded-lg text-sm font-bold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-35", !buy ? "bg-down text-on-fill shadow-[0_2px_12px_-2px_color-mix(in_oklch,var(--color-down)_60%,transparent)]" : "text-muted hover:text-ink")}>Sell</button>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted" title={paperOn && wallet ? `Paper wallet: ${wallet.cash.toFixed(4)} fake SOL left of ${wallet.start}` : undefined}>
          <Icon.wallets className="size-3.5 shrink-0" />
          {balance != null ? <><SolanaLogo className="size-3 shrink-0" /><b className="num font-semibold text-ink">{balance}</b><span>SOL</span></> : <span>Not signed in</span>}
        </span>
        {paperOn && wallet && <button onClick={() => depositPaper(10).then((w) => toast(`Added 10 fake SOL. ${w.cash.toFixed(3)} SOL to spend.`), (e) => toast((e as Error).message))}
          title="Add 10 fake SOL to the paper wallet (positions stay)" className="num rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-white/[0.12] hover:text-ink">+10</button>}
        <span className="ml-auto flex items-center gap-1.5">
          {paperOn ? <PaperTag /> : <RealTag />}
          <Tip tip="PnL card: your live result as a picture to save or share">
            <button onClick={pnlCard.open} aria-label="PnL card" className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.07] hover:text-ink"><Icon.image className="size-3.5" /></button>
          </Tip>
        </span>
        {pnlCard.dialog}
      </div>

      {buy ? (
        <div className="flex flex-col gap-2">
          <label className={cn("flex h-12 items-center gap-2.5 rounded-xl border bg-paper px-3.5 transition-colors duration-150 focus-within:border-up/50", "border-white/[0.08] hover:border-white/15")}>
            <SolanaLogo className="size-4.5 shrink-0" />
            <input type="number" min="0" step="0.01" value={sol || ""} onChange={(e) => setSol(Math.max(0, +e.target.value || 0))} aria-label="SOL to spend" placeholder="0.0"
              className="num w-full min-w-0 bg-transparent text-xl font-semibold tracking-tight text-ink outline-none placeholder:text-muted/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
            <span className="text-sm font-semibold text-muted">SOL</span>
          </label>
          <div className="grid grid-cols-4 gap-1.5">{sizes.map((v) => <button key={v} onClick={() => setSol(v)} className={chip(sol === v)}>{v}</button>)}</div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">{PCTS.map((v) => <button key={v} onClick={() => setPct(v)} className={cn(chip(pct === v), "h-10 text-md")}>{v === 100 ? "All" : `${v}%`}</button>)}</div>
      )}
      {buy && (
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted"><Icon.sliders className="size-3.5" />Slippage</span>
          <div role="radiogroup" aria-label="Slippage" className="flex gap-0.5 rounded-lg bg-paper p-0.5">
            {SLIPS.map(([v, l]) => <button key={v} role="radio" aria-checked={slip === v} onClick={() => setSlip(v)}
              className={cn("num h-6 rounded-md px-2 text-xs font-semibold transition-colors duration-150", slip === v ? "bg-paper-5 text-ink shadow-[inset_0_1px_0_oklch(100%_0_0/0.08)]" : "text-muted hover:text-ink-2")}>{l}</button>)}
          </div>
        </div>
      )}

      <div className="min-h-[5.5rem] rounded-xl border border-white/[0.06] bg-paper/60 p-3 text-sm">
        {realSell ? <span className="text-ink-2">Sells {pct}% of the {held.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${symbol} in your wallet for SOL, at the market price.</span>
          : error ? <span className="text-down">{error}</span>
          : !quote ? <div className="flex flex-col gap-2"><i className="h-5 w-2/3 animate-pulse rounded bg-white/[0.06]" /><i className="h-3 w-full animate-pulse rounded bg-white/[0.04]" /><i className="h-3 w-5/6 animate-pulse rounded bg-white/[0.04]" /></div>
          : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-muted">You get</span>
              {quote.usdIn != null && <span className="num text-xs text-muted">≈ {usdK(buy ? quote.usdIn : quote.usdOut)}</span>}
            </div>
            <b className="num mt-0.5 mb-2.5 block truncate text-xl font-semibold tracking-tight text-ink">{buy ? <>{tokN(quote.outTokens)} <span className="text-ink-2">{symbol}</span></> : <SolAmt v={quote.outSol} />}</b>
            <div className="num grid grid-cols-2 gap-x-4 gap-y-1 border-t border-white/[0.06] pt-2.5 text-xs">
              {stat("Avg fill MC", usdK(quote.avgMcapUsd))}
              {stat("Now MC", usdK(quote.spotMcapUsd))}
              {stat("Impact", quote.impactPct != null ? `${quote.impactPct.toFixed(2)}%` : "—", (quote.impactPct ?? 0) > 5 ? "text-down" : (quote.impactPct ?? 0) > 2 ? "text-warn" : "text-ink-2")}
              {stat("Route", quote.route?.join(" › ") || "—")}
              {!paperOn && stat("Blix fee", buy ? `${+(sol * FEE).toFixed(5)} SOL` : `${+(FEE * 100).toFixed(2)}%`)}
            </div>
          </>
        )}
      </div>
      {/* Paper fills at once (the server prices it itself), so it never waits for the preview; real money does. */}
      <button onClick={submit} disabled={busy || (!quote && !realSell && !paperOn)}
        className={cn("group relative h-12 overflow-hidden rounded-xl text-md font-bold text-on-fill transition-[transform,filter] duration-150 hover:brightness-110 active:scale-[0.985] disabled:opacity-45 disabled:hover:brightness-100",
          buy ? "bg-gradient-to-b from-up to-[color-mix(in_oklch,var(--color-up)_82%,black)] shadow-[0_8px_24px_-10px_var(--color-up),inset_0_1px_0_oklch(100%_0_0/0.25)]"
            : "bg-gradient-to-b from-down to-[color-mix(in_oklch,var(--color-down)_82%,black)] shadow-[0_8px_24px_-10px_var(--color-down),inset_0_1px_0_oklch(100%_0_0/0.25)]")}>
        <span className="relative flex items-center justify-center gap-2">
          {busy ? <><i className="size-4 animate-spin rounded-full border-2 border-on-fill/30 border-t-on-fill" />Placing…</>
            : <span>{buy ? <>Buy <span className="num">{sol}</span> SOL of ${symbol}</> : <>Sell {pct === 100 ? "all" : `${pct}%`} of ${symbol}</>}</span>}
          {paperOn && !busy && <span className="rounded-[5px] bg-black/15 px-1.5 py-px text-[10px] font-bold tracking-[0.08em] uppercase">Paper</span>}
        </span>
      </button>
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
  const dash = (c: string) => <i className={cn("inline-block w-2.5 border-t border-dashed", c)} />;
  const move = entry && mcapNow ? (mcapNow / entry - 1) * 100 : null;
  return (
    <div className={card}>
      <H>Your position {paperOn ? <PaperTag /> : <RealTag />}
        <button onClick={pnlCard.open} title="Your live PnL card, to save or share" className="ml-auto flex h-6 items-center gap-1 rounded-full bg-ink px-2.5 text-xs font-semibold tracking-normal text-on-fill normal-case hover:bg-focus"><Icon.image className="size-3" />Share PnL</button>
      </H>
      {pnlCard.dialog}
      <div className="grid grid-cols-4 gap-1.5">
        {cell("Bought", <SolAmt v={bought} />)}{cell("Sold", <SolAmt v={sold} />)}{cell("Holding", holding == null ? "—" : <SolAmt v={holding} />)}
        <button onClick={pnlCard.open} title="Open your PnL card" className="min-w-0 text-left hover:opacity-80">{cell("PnL", pnl == null ? "—" : <><SolAmt v={pnl} signed />{bought ? <span className="text-xs font-normal"> {Math.round((pnl / bought) * 100)}%</span> : null}</>, pnl == null ? "" : pnl >= 0 ? "text-up" : "text-down")}</button>
      </div>
      {has && (
        <Tip tip="Market caps. Averages are per token: all the SOL paid (or got) over all the tokens bought (or sold).">
          <div className={cn("mt-2.5 grid gap-1.5 border-t border-rule pt-2.5", exit != null ? "grid-cols-4" : "grid-cols-3")}>
            {cell(<>{dash("border-up")}Avg buy</>, entry ? usdK(entry) : "—")}
            {exit != null && cell(<>{dash("border-down")}Avg sell</>, usdK(exit))}
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
