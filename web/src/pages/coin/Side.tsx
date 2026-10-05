// The right column: 5-minute flow, the paper trade panel at real quotes, your paper position,
// token info (an icon and a figure each, green when clean, red when not), addresses and links.
import { useTrade } from "@/lib/mode";
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

const card = "surface p-3";
const H = ({ children }: { children: ReactNode }) => <h3 className="label mb-2 flex items-center gap-1.5">{children}</h3>;
const PaperTag = () => <span className="rounded-chip border border-warn/50 px-1 text-[0.625rem] font-bold text-warn">PAPER</span>;
const RealTag = () => <span className="rounded-chip border border-up/50 px-1 text-[0.625rem] font-bold text-up">REAL</span>;

export function Flow({ c }: { c: CoinData | null }) {
  const m = c?.m5;
  if (!m) return <div className={cn(card, "text-sm text-muted")}>No trades in the last 5 minutes.</div>;
  const total = m.buyUsd != null && m.sellUsd != null ? m.buyUsd + m.sellUsd : m.buys + m.sells;
  const share = total > 0 ? (m.buyUsd != null && m.sellUsd != null ? m.buyUsd : m.buys) / total : null;
  const cell = (label: string, value: ReactNode, cls = "") => <div className="flex min-w-0 flex-col gap-0.5"><small className="text-xs text-muted">{label}</small><b className={cn("num truncate text-md font-semibold text-ink", cls)}>{value}</b></div>;
  return (
    <div className={card}>
      <div className="grid grid-cols-4 gap-1.5">
        {cell("5m Vol", usdK(m.volUsd))}
        {cell("Buys", <>{m.buys}{m.buyUsd != null && <span className="font-normal"> / {usdK(m.buyUsd)}</span>}</>, "text-up")}
        {cell("Sells", <>{m.sells}{m.sellUsd != null && <span className="font-normal"> / {usdK(m.sellUsd)}</span>}</>, "text-down")}
        {cell("Net Vol", m.netUsd == null ? "—" : usdSigned(m.netUsd), (m.netUsd ?? 0) >= 0 ? "text-up" : "text-down")}
      </div>
      {share != null && <div className="mt-2 h-[3px] overflow-hidden rounded bg-down"><i className="block h-full bg-up" style={{ width: `${share * 100}%` }} /></div>}
    </div>
  );
}

// Paper buys and sells filled at the real quote (Jupiter, or the curve's own math). Nothing is really bought.
const SLIPS: [number, string][] = [[100, "1%"], [300, "3%"], [500, "5%"], [1000, "10%"]];
const PCTS = [25, 50, 100];
export function TradePanel({ mint, symbol, r, onDone }: { mint: string; symbol: string; r: TokenDetail; onDone: () => void }) {
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
  const key = s === "buy" ? `buy:${mint}:${sol}:${slip}` : realSell ? `sell:real:${pct}` : `sell:${open.map((p) => p.id).join(",")}:${pct}`;
  const keyRef = useRef(key); keyRef.current = key;

  useEffect(() => { api<{ sizes?: number[] }>("paper").then((d) => d.sizes?.length && setSizes(d.sizes)).catch(() => {}); }, []);
  // Quote now, then every 3 s; a newer request wins.
  useEffect(() => {
    let alive = true, timer = 0;
    const run = async () => {
      if (realSell || !(s === "buy" ? sol > 0 : open[0])) { setQ(null); return; }
      try {
        // A sell takes the same share of every open paper row (each buy is its own row): their previews summed.
        const quote = s === "buy" ? await api<Quote>(`quote?mint=${mint}&side=buy&amount=${sol}&slip=${slip}`)
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
  const chip = (on: boolean) => cn("h-7 min-w-12 rounded-control border px-2 text-sm font-semibold num", on ? "border-accent bg-accent/15 text-ink" : "border-rule text-ink-2 hover:text-ink");
  return (
    <div className={cn(card, "flex flex-col gap-2.5")}>
      <div className="flex items-center gap-1.5">
        <button onClick={() => setSide("buy")} className={cn("h-7 rounded-control px-4 text-sm font-bold", s === "buy" ? "bg-up text-on-fill" : "text-muted hover:text-ink")}>Buy</button>
        <button onClick={() => setSide("sell")} disabled={!canSell} className={cn("h-7 rounded-control px-4 text-sm font-bold disabled:opacity-40", s === "sell" ? "bg-down text-on-fill" : "text-muted hover:text-ink")}>Sell</button>
        <span className="ml-auto flex items-center gap-2">
          {paperOn && wallet && <span className="num text-xs text-muted" title={`Paper wallet: ${wallet.cash.toFixed(4)} fake SOL left of ${wallet.start}`}>{wallet.cash.toFixed(3)} SOL</span>}
          {!paperOn && <span className="num text-xs text-muted">{me?.signedIn ? `${(me.wallet?.sol ?? 0).toFixed(3)} SOL` : "not signed in"}</span>}
          {paperOn ? <PaperTag /> : <RealTag />}
        </span>
      </div>
      {s === "buy" ? (
        <div className="flex flex-wrap gap-1.5">
          {sizes.map((v) => <button key={v} onClick={() => setSol(v)} className={chip(sol === v)}>{v}</button>)}
          <label className="flex h-7 flex-1 items-center gap-1 rounded-control border border-rule px-2 focus-within:border-accent">
            <input type="number" min="0" step="0.01" value={sol || ""} onChange={(e) => setSol(Math.max(0, +e.target.value || 0))} aria-label="SOL to spend"
              className="num w-full min-w-0 bg-transparent text-sm text-ink outline-none" />
            <span className="text-xs text-muted">SOL</span>
          </label>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">{PCTS.map((v) => <button key={v} onClick={() => setPct(v)} className={chip(pct === v)}>{v}%</button>)}</div>
      )}
      {s === "buy" && (
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="mr-1">Slippage</span>
          {SLIPS.map(([v, l]) => <button key={v} onClick={() => setSlip(v)} className={cn("h-5 rounded-chip border px-1.5 font-semibold", slip === v ? "border-accent text-ink" : "border-rule hover:text-ink")}>{l}</button>)}
        </div>
      )}
      <div className="min-h-16 rounded-control border border-rule p-2.5 text-sm">
        {realSell ? <span className="text-ink-2">Sells {pct}% of the {held.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${symbol} in your wallet for SOL, at the market price.</span> : error ? <span className="text-down">{error}</span> : !quote ? <span className="text-muted">Quoting…</span> : (
          <>
            <div className="mb-1.5 flex items-baseline gap-2 text-muted">You get <b className="num text-lg font-semibold text-ink">{s === "buy" ? `${tokN(quote.outTokens)} ${symbol}` : <SolAmt v={quote.outSol} />}</b>{quote.usdIn != null && <span>≈ {usdK(s === "buy" ? quote.usdIn : quote.usdOut)}</span>}</div>
            <div className="num grid grid-cols-[auto_1fr_auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted">
              <span>Avg fill MC</span><b className="text-right font-semibold text-ink-2">{usdK(quote.avgMcapUsd)}</b>
              <span>Now MC</span><b className="text-right font-semibold text-ink-2">{usdK(quote.spotMcapUsd)}</b>
              <span>Price impact</span><b className={cn("text-right font-semibold", (quote.impactPct ?? 0) > 5 ? "text-down" : "text-ink-2")}>{quote.impactPct != null ? `${quote.impactPct.toFixed(2)}%` : "—"}</b>
              <span>Route</span><b className="truncate text-right font-semibold text-ink-2">{quote.route?.join(" › ") || "—"}</b>
            </div>
          </>
        )}
      </div>
      <button onClick={submit} disabled={busy || (!quote && !realSell)}
        className={cn("h-10 rounded-control text-md font-bold text-on-fill transition-transform active:scale-[0.99] disabled:opacity-45", s === "buy" ? "bg-up" : "bg-down")}>
        {busy ? "Placing…" : `${paperOn ? "Paper " : ""}${s === "buy" ? `${paperOn ? "buy" : "Buy"} ${sol} SOL of $${symbol}` : `${paperOn ? "sell" : "Sell"} ${pct}%`}`}
      </button>
    </div>
  );
}

// Your position in this coin (worked out in ./position.ts): the paper one while Paper is on, the real
// wallet's while it is off. Average buy and sell are market caps per token, the chart's dashed lines.
export function Position({ pos }: { pos: Pos }) {
  const me = useMe((st) => st.me);
  const { paper: paperOn, has, bought, sold, holding, pnl, entry, exit, mcapNow } = pos;
  const cell = (label: ReactNode, value: ReactNode, cls = "") => (
    <div className="flex min-w-0 flex-col gap-0.5"><small className="flex items-center gap-1 text-xs whitespace-nowrap text-muted">{label}</small><b className={cn("num text-md font-semibold text-ink", cls)}>{value}</b></div>
  );
  const dash = (c: string) => <i className={cn("inline-block w-2.5 border-t border-dashed", c)} />;
  const move = entry && mcapNow ? (mcapNow / entry - 1) * 100 : null;
  return (
    <div className={card}>
      <H>Your position {paperOn ? <PaperTag /> : <RealTag />}</H>
      <div className="grid grid-cols-4 gap-1.5">
        {cell("Bought", <SolAmt v={bought} />)}{cell("Sold", <SolAmt v={sold} />)}{cell("Holding", holding == null ? "—" : <SolAmt v={holding} />)}
        {cell("PnL", pnl == null ? "—" : <><SolAmt v={pnl} signed />{bought ? <span className="text-xs font-normal"> {Math.round((pnl / bought) * 100)}%</span> : null}</>, pnl == null ? "" : pnl >= 0 ? "text-up" : "text-down")}
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
function Tile({ icon, value, label, bad, tip }: { icon: ReactNode; value: ReactNode; label: string; bad: Tone; tip?: string }) {
  return (
    <Tip tip={tip}>
      <div className={cn("flex min-w-0 flex-col items-center gap-0.5 rounded-control border bg-paper-3 px-1 pb-2 pt-2.5 text-center",
        bad === true ? "border-down/40 [&_b]:text-down [&_svg]:text-down" : bad === false ? "border-rule [&_b]:text-up [&_svg]:text-up" : "border-rule")}>
        <span className="text-muted [&_svg]:size-4">{icon}</span>
        <b className="num max-w-full truncate text-lg font-semibold text-ink">{value}</b>
        <small className="whitespace-nowrap text-xs text-muted">{label}</small>
      </div>
    </Tip>
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
  const grade = r.research?.report?.grade || r.research?.grade || null;
  const tone = (v: number | null, max: number): Tone => v == null ? null : v > max;
  return (
    <div className={card}>
      <H>Token info</H>
      <div className="grid grid-cols-3 gap-1.5">
        <Tile icon={<Icon.crown />} value={pctN(top10)} label="Top 10 H." bad={tone(top10, 30)} tip={`Share held by the 10 largest wallets. ${from || ""}`} />
        <Tile icon={<Icon.chef />} value={dev == null ? "—" : `${pctN(dev)}${c?.dev?.sold ? (c.dev.sold === "all" ? " sold" : " selling") : ""}`} label="Dev H." bad={tone(dev, 10)} tip={`Share the dev still holds. ${from || ""}`} />
        <Tile icon={<Icon.crosshair />} value={pctN(sn)} label="Snipers H." bad={tone(sn, 10)} tip={i?.snipers ? `${i.snipers.n} wallets bought within 2 blocks of the first trade; ${i.snipers.sold} sold out` : ledgerOnly} />
        <Tile icon={<Icon.ghost />} value={pctN(ins)} label="Insiders" bad={tone(ins, 20)} tip={`RugCheck insider networks. ${from || ""}`} />
        <Tile icon={<Icon.boxes />} value={pctN(bd)} label="Bundlers" bad={tone(bd, 20)} tip={i?.bundle ? `${i.bundle.n} wallets bought in the launch block` : ledgerOnly} />
        <Tile icon={<Icon.curve />} value={curve ? "Curve" : lp == null ? "—" : pctN(lp, 0)} label={curve ? "No LP yet" : "LP locked"} bad={curve || lp == null ? null : lp < 90} />
        <Tile icon={<Icon.users />} value={i?.holders != null ? i.holders.toLocaleString() : "—"} label="Holders" bad={null} tip={from} />
        <Tile icon={<Icon.userStar />} value={i?.traders != null ? i.traders.toLocaleString() : "—"} label="Traders" bad={null} tip={curve ? "Wallets that traded it on the live feed" : "Unknown after bonding: Blix reads the curve, not the pool"} />
        <Tile icon={<Icon.bolt />} value={paid ? "Paid" : "Unpaid"} label="Dex paid" bad={!paid} tip="A DexScreener profile or boost was bought for this coin" />
        <Tile icon={<CIcon.shield />} value={safety != null ? String(safety) : "—"} label="Safety" bad={safety == null ? null : safety < 50} tip={`RugCheck score out of 100. ${from || ""}`} />
        <Tile icon={<Icon.ai />} value={grade || (r.research?.status === "running" ? "…" : "—")} label="AI grade" bad={grade ? /^[DF]/.test(grade) : null} tip={r.research?.report?.verdict || undefined} />
        <Tile icon={<Icon.candles />} value={r.triage ? String(r.triage.score) : "—"} label="Triage" bad={r.triage ? r.triage.label === "slop" : null} tip={r.triage?.why} />
      </div>
    </div>
  );
}

export function Addresses({ r, c }: { r: TokenDetail; c: CoinData | null }) {
  const t = r.token, dev = c?.dev?.wallet || t.creator || null;
  const row = (label: string, a: string, kind: "token" | "account") => (
    <div className="flex items-center gap-1.5">
      <span className="label w-6">{label}</span>
      <button onClick={() => copy(a, `${label === "CA" ? "Contract" : "Dev"} address copied`)} title={a}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-control border border-rule bg-paper-3 px-2 py-1 text-ink-2 hover:border-rule-2 hover:text-ink">
        <span className="font-outlier text-xs">{shortAddr(a)}</span><Icon.copy className="ml-auto size-3 text-muted" />
      </button>
      <a href={`https://solscan.io/${kind}/${a}`} target="_blank" rel="noreferrer" aria-label="Open on Solscan" className="grid size-7 place-items-center rounded-chip text-muted hover:bg-paper-4 hover:text-ink"><CIcon.external className="size-3.5" /></a>
    </div>
  );
  return <div className={cn(card, "flex flex-col gap-1.5")}>{row("CA", t.mint, "token")}{dev && row("DA", dev, "account")}</div>;
}

export function Links({ r }: { r: TokenDetail }) {
  const t = r.token;
  const list: [string, string][] = [
    ["DexScreener", `https://dexscreener.com/solana/${t.pair || t.mint}`], ["pump.fun", `https://pump.fun/coin/${t.mint}`], ["RugCheck", `https://rugcheck.xyz/tokens/${t.mint}`],
    ["GMGN", `https://gmgn.ai/sol/token/${t.mint}`], ["Axiom", `https://axiom.trade/meme/${t.pair || t.mint}`], ["Solscan", `https://solscan.io/token/${t.mint}`],
  ];
  return (
    <div className={cn(card, "flex flex-wrap gap-x-3 gap-y-1 text-sm")}>
      {list.map(([l, href]) => <a key={l} href={href} target="_blank" rel="noreferrer" className="text-ink-2 hover:text-accent">{l}</a>)}
    </div>
  );
}
