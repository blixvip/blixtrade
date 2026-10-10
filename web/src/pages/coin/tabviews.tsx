// The coin page's tabs, drawn properly: Holders, Top traders, Dev tokens, AI read and Safety (Tabs.tsx holds the
// tab bar and the trade lists; FomoTabs.tsx and Theses.tsx the Fomo ones). Every tab opens on a summary strip
// of the few figures that matter, then the detail. All of it comes from answers the page already polls every
// 2 s (/api/coin/<mint>) or 15 s (/api/token/<mint>), so switching tabs is instant and every figure moves on
// its own; a figure that changes flashes in the up or down colour.
import { useMemo, useState, type ReactNode } from "react";
import { CoinImg } from "@/components/page";
import { Flash } from "@/components/Live";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { post } from "@/lib/api";
import { pctN, solNum, usdK, usdSigned, type CoinData, type Holder, type TokenDetail } from "@/lib/coin";
import { ageStr, providerOf, shortAddr } from "@/lib/format";
import { useLiveMc } from "@/lib/livepx";
import { rowLink, useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Empty, SolAmt, Tags } from "./parts";

// ---------- the kit ----------
const hueOf = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
// A wallet's own colours, the same every time it shows anywhere on the page.
export function Identicon({ addr, size = 22 }: { addr: string; size?: number }) {
  const h = hueOf(addr), h2 = (h + 70) % 360;
  return <span aria-hidden className="shrink-0 rounded-full ring-1 ring-edge" style={{ width: size, height: size, background: `conic-gradient(from ${h}deg, oklch(64% 0.15 ${h}), oklch(48% 0.13 ${h2}), oklch(64% 0.15 ${h}))` }} />;
}

const copy = (text: string, what = "Address") => { navigator.clipboard?.writeText(text); toast(`${what} copied`); };

// A wallet: its colours, short address (Solscan), a copy button, and what it is on this coin.
export function WalletCell({ x, pool }: { x: Holder; pool?: string | null }) {
  if (pool) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="grid size-[22px] shrink-0 place-items-center rounded-full bg-info/15 text-info"><Icon.curve className="size-3.5" /></span>
        <b className="text-md font-semibold text-ink-2">{pool}</b>
        <a href={`https://solscan.io/account/${x.wallet}`} target="_blank" rel="noreferrer" className="font-outlier text-xs text-muted hover:text-accent">{shortAddr(x.wallet)}</a>
      </span>
    );
  }
  return (
    <span className="group/w flex min-w-0 items-center gap-2">
      <Identicon addr={x.wallet} />
      <a href={`https://solscan.io/account/${x.wallet}`} target="_blank" rel="noreferrer" title={x.wallet} className="font-outlier text-xs text-ink hover:text-accent">{shortAddr(x.wallet)}</a>
      <button onClick={() => copy(x.wallet)} aria-label="Copy address" className="text-muted opacity-0 transition-opacity group-hover/w:opacity-100 hover:text-ink focus-visible:opacity-100"><Icon.copy className="size-3.5" /></button>
      <Tags x={{ ...x, top10: false }} />
    </span>
  );
}

// One figure in a tab's summary strip.
export function Stat({ label, value, tone, sub, tip }: { label: string; value: ReactNode; tone?: "up" | "down" | "warn" | "muted" | null; sub?: ReactNode; tip?: string }) {
  const body = (
    <div className="flex min-w-[96px] flex-col gap-0.5 px-4 py-2.5">
      <span className="label">{label}</span>
      <b className={cn("num text-lg leading-tight font-semibold", tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "warn" ? "text-warn" : tone === "muted" ? "text-muted" : "text-ink")}>{value}</b>
      {sub != null && <span className="num text-xs text-muted">{sub}</span>}
    </div>
  );
  return tip ? <Tip tip={tip}>{body}</Tip> : body;
}
export const Strip = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="flex flex-wrap items-stretch divide-x divide-rule border-b border-rule">
    {children}
    {right && <div className="ml-auto flex items-center px-4 text-xs text-muted">{right}</div>}
  </div>
);
const toneOf = (bad: boolean | null, warn = false) => (bad == null ? null : bad ? "down" : warn ? "warn" : "up");

const th = "sticky top-0 z-[1] whitespace-nowrap border-b border-rule bg-paper-2 px-3 py-2 text-left label";
const td = "whitespace-nowrap border-b border-rule/50 px-3 py-2.5 align-middle";
// Plain "6.27 SOL" in the small lines under a figure: a coloured logo on every line of a long table was noise.
const solTxt = (v: number | null | undefined, signed = false) => (v == null || !isFinite(v) ? "" : `${solNum(v, signed)} SOL`);
// The rank: the first three a little brighter.
const Rank = ({ n }: { n: number }) => <span className={cn("num text-sm", n <= 3 ? "font-semibold text-ink-2" : "text-muted")}>{n}</span>;
const Dash = () => <span className="text-muted">—</span>;
const pnlPct = (x: Holder) => (x.pnlUsd != null && x.boughtUsd ? (x.pnlUsd / x.boughtUsd) * 100 : null);
const pctSigned = (n: number | null) => (n == null || !isFinite(n) ? "" : `${n >= 0 ? "+" : "−"}${Math.abs(n) >= 100 ? Math.abs(n).toFixed(0) : Math.abs(n).toFixed(1)}%`);

// A holding: its share with a bar scaled to the biggest holder, and what it is worth.
// wide: the Holders table, where the share is the point: a long quiet bar across the row with the figures at its end.
function Holding({ x, scale, wide }: { x: Holder; scale: number; wide?: boolean }) {
  if (x.status === "outside top 100") return <span className="text-sm text-muted">not in top 100</span>;
  if (x.pct <= 0 && (x.boughtSol || x.soldSol)) return <span className="text-sm text-muted">Sold all</span>;
  const w = Math.max(1.5, Math.min(100, (x.pct / Math.max(scale, 1e-4)) * 100));
  return (
    <span className={cn("inline-flex items-center justify-end gap-3", wide && "w-full")}>
      <span className={cn("relative block h-1.5 overflow-hidden rounded-full bg-paper-4", wide ? "max-w-[260px] min-w-16 flex-1 max-sm:hidden" : "w-14 max-sm:hidden")}>
        <i className="absolute inset-y-0 left-0 rounded-full bg-ink-2/55" style={{ width: `${w}%` }} />
      </span>
      <Flash value={x.pct} className="w-14 text-right text-md font-semibold text-ink">{pctN(x.pct, 2)}</Flash>
    </span>
  );
}
function Flow({ sol, usd, mc, side }: { sol: number | null; usd: number | null; mc?: number | null; side: "buy" | "sell" }) {
  if (!sol && !usd) return <Dash />;
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={cn("num font-semibold", side === "buy" ? "text-up" : "text-down")}>{usd != null ? usdK(usd) : solTxt(sol)}</span>
      <span className="num text-xs text-muted">{[usd != null ? solTxt(sol) : "", mc ? `at ${usdK(mc)}` : ""].filter(Boolean).join(" · ")}</span>
    </span>
  );
}
function Pnl({ x }: { x: Holder }) {
  if (x.pnlUsd == null && x.pnlSol == null) return <Dash />;
  const up = (x.pnlUsd ?? x.pnlSol ?? 0) >= 0, p = pnlPct(x);
  return (
    <span className={cn("inline-flex flex-col items-end leading-tight", up ? "text-up" : "text-down")}>
      <Flash value={x.pnlUsd ?? x.pnlSol} className="text-md font-semibold">{x.pnlUsd != null ? usdSigned(x.pnlUsd) : solTxt(x.pnlSol, true)}</Flash>
      <span className="num text-xs opacity-75">{[pctSigned(p), x.pnlSol != null && x.pnlUsd != null ? solTxt(x.pnlSol, true) : ""].filter(Boolean).join(" · ")}</span>
    </span>
  );
}

// The coin's holdings in one bar: the ten biggest wallets, the pool or curve, everyone else.
function ShareBar({ list }: { list: Holder[] }) {
  const pools = list.filter((x) => x.label === "Pool"), people = list.filter((x) => x.label !== "Pool").slice(0, 10);
  const poolPct = pools.reduce((s, x) => s + x.pct, 0), topPct = people.reduce((s, x) => s + x.pct, 0);
  const rest = Math.max(0, 100 - poolPct - topPct);
  return (
    <div className="flex flex-col gap-1.5 border-b border-rule px-4 py-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-paper-4">
        {poolPct > 0 && <Tip tip={`Pool / curve ${pctN(poolPct, 1)}`}><i className="block h-full bg-info/70" style={{ width: `${poolPct}%` }} /></Tip>}
        {people.map((x, i) => (
          <Tip key={x.wallet} tip={`#${i + 1} ${shortAddr(x.wallet)} · ${pctN(x.pct, 2)}`}>
            <i className="block h-full border-r border-paper-2" style={{ width: `${x.pct}%`, background: `oklch(${72 - i * 3}% ${x.tag === "dev" ? 0.16 : 0.12} ${x.tag === "dev" ? 70 : x.tag === "sniper" || x.tag === "bundle" ? 25 : 150})` }} />
          </Tip>
        ))}
        <i className="block h-full bg-paper-5" style={{ width: `${rest}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {poolPct > 0 && <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-info/70" />Pool / curve <b className="num font-semibold text-ink-2">{pctN(poolPct, 1)}</b></span>}
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: "oklch(68% 0.12 150)" }} />Top 10 wallets <b className="num font-semibold text-ink-2">{pctN(topPct, 1)}</b></span>
        <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-paper-5" />Everyone else <b className="num font-semibold text-ink-2">{pctN(rest, 1)}</b></span>
      </div>
    </div>
  );
}

const SOURCE: Record<string, string> = { ledger: "Blix's own ledger, live", chain: "Read from the chain, live", jupiter: "From Jupiter", rugcheck: "From RugCheck" };
function sourceNote(c: CoinData) {
  const h = c.holders!;
  if (h.source === "ledger" || !h.source) return h.frozen ? "As of bonding" : h.genesis && !h.partial ? "Complete ledger · every trade since launch" : h.genesis ? "Ledger · a few early sells unseen" : "Partial ledger · started after launch";
  return SOURCE[h.source] || h.source;
}

// ---------- Holders ----------
type HFilter = "all" | "tagged" | "followed";
export function HoldersView({ c, bonding }: { c: CoinData; bonding: boolean }) {
  const now = useNow();
  const [f, setF] = useState<HFilter>("all");
  const h = c.holders!, info = c.info;
  const list = h.list;
  const scale = Math.max(...list.filter((x) => x.label !== "Pool").map((x) => x.pct), 0.0001);
  // The curve or pool first (it is not a person, so it gets no rank), then the wallets biggest first.
  const ordered = [...list.filter((x) => x.label === "Pool"), ...list.filter((x) => x.label !== "Pool")];
  const shown = ordered.filter((x) => f === "all" || (f === "tagged" ? Boolean(x.tag) || x.top10 : x.followed || x.fomo));
  const flows = list.filter((w) => w.boughtSol || w.soldSol).length > list.length * 0.3;
  const snip = info.snipers, bund = info.bundle;
  let rank = 0;
  return (
    <div className="flex flex-col">
      <Strip right={sourceNote(c)}>
        <Stat label="Holders" value={<Flash value={h.count}>{h.count.toLocaleString()}</Flash>} />
        <Stat label="Top 10" value={pctN(info.top10 ?? h.top10, 1)} tone={toneOf((info.top10 ?? h.top10) > 50, (info.top10 ?? h.top10) > 30)} tip="Share held by the ten biggest wallets, pools and the curve left out" />
        <Stat label="Dev" value={info.devPct != null ? pctN(info.devPct, 2) : "—"} tone={info.devPct == null ? "muted" : toneOf(info.devPct > 15, info.devPct > 5)} />
        <Stat label="Snipers" value={snip ? pctN(snip.pct, 1) : "—"} sub={snip ? `${snip.n} wallets${snip.sold ? ` · ${snip.sold} sold` : ""}` : undefined} tone={snip ? toneOf(snip.pct > 20, snip.pct > 8) : "muted"} />
        <Stat label="Bundles" value={bund ? pctN(bund.pct, 1) : "—"} sub={bund ? `${bund.n} wallets` : undefined} tone={bund ? toneOf(bund.pct > 20, bund.pct > 8) : "muted"} />
        <Stat label="Insiders" value={info.insiders != null ? pctN(info.insiders, 1) : "—"} tone={info.insiders == null ? "muted" : toneOf(info.insiders > 20, info.insiders > 8)} />
      </Strip>
      {list.length > 0 && <ShareBar list={list} />}
      <div className="flex items-center gap-1 px-3 py-2">
        {([["all", "All"], ["tagged", "Dev, snipers, bundles"], ["followed", "Followed"]] as [HFilter, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setF(k)} className={cn("h-6 rounded-chip border px-2 text-xs font-semibold", f === k ? "border-accent bg-accent/15 text-ink" : "border-rule text-muted hover:text-ink")}>{l}</button>
        ))}
        <span className="ml-auto text-xs text-muted">The {list.filter((x) => x.label !== "Pool").length} biggest of {h.count.toLocaleString()}</span>
      </div>
      {!shown.length ? <Empty title="No holder matches" text="Try All." /> : (
        <div className="max-h-[620px] overflow-auto">
          <table className="num w-full border-collapse text-md">
            <thead><tr>
              <th className={cn(th, "w-10")}>#</th><th className={th}>Wallet</th><th className={cn(th, "w-[38%] text-right max-sm:w-auto")}>Share</th><th className={cn(th, "text-right")}>Value</th>
              {flows && <><th className={cn(th, "text-right")}>Bought</th><th className={cn(th, "text-right")}>Sold</th><th className={cn(th, "text-right")}>PnL</th></>}
              <th className={cn(th, "text-right max-sm:hidden")}>{h.source === "jupiter" ? "Last active" : "First buy"}</th>
            </tr></thead>
            <tbody>
              {shown.map((x) => {
                const pool = x.label === "Pool" ? (bonding ? "Bonding curve" : "Liquidity pool") : null;
                if (!pool) rank++;
                return (
                  <tr key={x.wallet} className={cn("transition-colors hover:bg-paper-3", pool && "bg-info/[0.04]", x.tag === "dev" && "bg-warn/[0.05]")}>
                    <td className={td}>{pool ? "" : <Rank n={rank} />}</td>
                    <td className={td}><WalletCell x={x} pool={pool} /></td>
                    <td className={cn(td, "text-right")}>{pool ? <span className="num text-md font-semibold text-ink-2">{pctN(x.pct, 1)}</span> : <Holding x={x} scale={scale} wide />}</td>
                    <td className={cn(td, "text-right text-ink-2")}>{x.valueUsd != null ? usdK(x.valueUsd) : <Dash />}</td>
                    {flows && <>
                      <td className={cn(td, "text-right")}>{pool ? null : <Flow sol={x.boughtSol} usd={x.boughtUsd} mc={x.avgBuyMc} side="buy" />}</td>
                      <td className={cn(td, "text-right")}>{pool ? null : <Flow sol={x.soldSol} usd={x.soldUsd} mc={x.avgSellMc} side="sell" />}</td>
                      <td className={cn(td, "text-right")}>{pool ? null : <Pnl x={x} />}</td>
                    </>}
                    <td className={cn(td, "text-right text-sm text-muted max-sm:hidden")}>{pool || !x.first ? "" : `${ageStr(now - x.first)} ago`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Top traders ----------
type TSort = "pnl" | "volume" | "bought";
export function TradersView({ c }: { c: CoinData }) {
  const now = useNow();
  const [sort, setSort] = useState<TSort>("pnl");
  const w = c.jupiter?.tradersWindow, viaJup = Boolean(w && c.jupiter?.tabs.includes("traders"));
  const list = useMemo(() => {
    const v = c.traders.filter((x) => x.label !== "Pool");
    const key = (x: Holder) => sort === "pnl" ? (x.pnlUsd ?? -Infinity) : sort === "bought" ? (x.boughtUsd ?? 0) : (x.boughtUsd ?? 0) + (x.soldUsd ?? 0);
    return [...v].sort((a, b) => key(b) - key(a));
  }, [c.traders, sort]);
  const known = list.filter((x) => x.pnlUsd != null);
  const winners = known.filter((x) => (x.pnlUsd ?? 0) > 0).length;
  const best = known.length ? Math.max(...known.map((x) => x.pnlUsd!)) : null, worst = known.length ? Math.min(...known.map((x) => x.pnlUsd!)) : null;
  const vol = list.reduce((s, x) => s + (x.boughtUsd ?? 0) + (x.soldUsd ?? 0), 0);
  const scale = Math.max(...list.map((x) => x.pct), 0.0001);
  return (
    <div className="flex flex-col">
      <Strip right={viaJup ? `From Jupiter · last ${w!.trades.toLocaleString()} trades of $25+${w!.since ? ` (${ageStr(now - w!.since)})` : ""}` : "Blix's own ledger, live"}>
        <Stat label="Traders" value={list.length.toLocaleString()} />
        <Stat label="In profit" value={known.length ? `${winners} of ${known.length}` : "—"} tone={known.length ? (winners / known.length >= 0.5 ? "up" : "down") : "muted"} />
        <Stat label="Best" value={best != null ? usdSigned(best) : "—"} tone={best != null && best > 0 ? "up" : "muted"} />
        <Stat label="Worst" value={worst != null ? usdSigned(worst) : "—"} tone={worst != null && worst < 0 ? "down" : "muted"} />
        <Stat label="Their volume" value={usdK(vol)} />
      </Strip>
      <div className="flex items-center gap-1 px-3 py-2">
        <span className="mr-1 text-xs text-muted">Sort</span>
        {([["pnl", "Profit"], ["volume", "Volume"], ["bought", "Bought"]] as [TSort, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setSort(k)} className={cn("h-6 rounded-chip border px-2 text-xs font-semibold", sort === k ? "border-accent bg-accent/15 text-ink" : "border-rule text-muted hover:text-ink")}>{l}</button>
        ))}
        {viaJup && <span className="ml-auto max-w-[60%] truncate text-xs text-muted" title="A wallet that bought before that window shows no PnL: what it paid is outside it.">PnL counts buys inside that window only</span>}
      </div>
      <div className="max-h-[620px] overflow-auto">
        <table className="num w-full border-collapse text-md">
          <thead><tr>
            <th className={cn(th, "w-10")}>#</th><th className={th}>Wallet</th><th className={cn(th, "text-right")}>Bought</th><th className={cn(th, "text-right")}>Sold</th>
            <th className={cn(th, "text-right")}>Still holds</th><th className={cn(th, "text-right")}>PnL</th><th className={cn(th, "text-right")}>Trades</th>
          </tr></thead>
          <tbody>
            {list.map((x, i) => (
              <tr key={x.wallet} className="transition-colors hover:bg-paper-3">
                <td className={td}><Rank n={i + 1} /></td>
                <td className={td}><WalletCell x={x} /></td>
                <td className={cn(td, "text-right")}><Flow sol={x.boughtSol} usd={x.boughtUsd} mc={x.avgBuyMc} side="buy" /></td>
                <td className={cn(td, "text-right")}><Flow sol={x.soldSol} usd={x.soldUsd} mc={x.avgSellMc} side="sell" /></td>
                <td className={cn(td, "text-right")}><Holding x={x} scale={scale} /></td>
                <td className={cn(td, "text-right")}><Pnl x={x} /></td>
                <td className={cn(td, "text-right text-sm text-muted")}>{x.trades || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Dev tokens ----------
const devStatus = (d: NonNullable<CoinData["dev"]>) => d.sold === "all" ? ["Sold everything", "down"] as const : d.sold === "part" ? ["Selling", "warn"] as const : d.pct != null && d.pct > 0 ? ["Holding", "up"] as const : ["Not holding", "muted"] as const;
export function DevView({ mint, c }: { mint: string; c: CoinData }) {
  const now = useNow();
  const d = c.dev!, a = c.audit;
  const made = a?.devMints ?? d.coins.count, bonded = a?.devMigrations ?? d.coins.list.filter((x) => x.graduated).length;
  const rate = made ? (bonded / made) * 100 : null;
  const [status, tone] = devStatus(d);
  const others = d.coins.list.filter((x) => x.mint !== mint);
  const toneCls = (t: string) => t === "down" ? "bg-down/12 text-down ring-down/30" : t === "warn" ? "bg-warn/12 text-warn ring-warn/30" : t === "up" ? "bg-up/12 text-up ring-up/30" : "bg-paper-4 text-ink-2 ring-rule-2";
  const dot = (t: string) => t === "down" ? "bg-down" : t === "warn" ? "bg-warn" : t === "up" ? "bg-up" : "bg-muted";
  // One line on who this creator is, from the same figures as the tiles.
  const verdict = made == null ? null : made >= 10 ? (rate != null && rate >= 25 ? "Serial launcher with a real hit rate" : "Serial launcher: most of their coins never bond")
    : made >= 4 ? "Has launched a few coins before" : made <= 1 ? "First coin from this wallet" : "Launched once before";
  const tile = (label: string, value: ReactNode, sub?: ReactNode, t?: string | null, extra?: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-rule bg-gradient-to-b from-paper-3/70 to-paper-3/30 px-3.5 py-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
      <span className="text-2xs font-bold tracking-wider text-muted uppercase">{label}</span>
      <b className={cn("num text-xl leading-tight font-semibold", t === "down" ? "text-down" : t === "warn" ? "text-warn" : t === "up" ? "text-up" : "text-ink")}>{value}</b>
      {extra}
      {sub && <span className="num truncate text-xs text-muted">{sub}</span>}
    </div>
  );
  return (
    <div className="flex flex-col">
      {/* The creator: who they are and what they are doing with this coin. */}
      <div className="flex flex-wrap items-center gap-3.5 px-4 pt-4 pb-3">
        <span className="grid shrink-0 rounded-full p-0.5 ring-2 ring-rule-2"><Identicon addr={d.wallet} size={44} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-lg font-semibold tracking-tight text-ink">Creator</b>
            <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-2xs font-bold tracking-wider uppercase ring-1 ring-inset", toneCls(tone))}><i className={cn("size-1.5 rounded-full", dot(tone))} />{status}</span>
            {verdict && <span className="text-sm text-ink-2">{verdict}</span>}
          </span>
          <span className="flex items-center gap-1">
            <span className="font-outlier truncate text-sm text-ink-2" title={d.wallet}>{shortAddr(d.wallet)}</span>
            <Tip tip="Copy the creator's address"><button onClick={() => copy(d.wallet)} aria-label="Copy the creator's address" className="grid size-7 place-items-center rounded-full text-muted transition-colors hover:bg-paper-4 hover:text-ink"><Icon.copy className="size-3.5" /></button></Tip>
            <a href={`https://solscan.io/account/${d.wallet}`} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold text-ink-2 ring-1 ring-rule-2 transition-colors hover:text-ink hover:ring-muted">Solscan ↗</a>
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1">
        {tile("Holds now", d.pct != null ? pctN(d.pct, 2) : "—", d.maxPct ? `peak ${pctN(d.maxPct, 2)}` : undefined, d.pct == null ? "muted" : toneOf(d.pct > 15, d.pct > 5))}
        {tile("Spent", d.boughtSol != null ? <SolAmt v={d.boughtSol} /> : "—")}
        {tile("Took out", d.soldSol != null ? <SolAmt v={d.soldSol} /> : "—", undefined, d.soldSol ? "down" : null)}
        {tile("Coins made", made != null ? made.toLocaleString() : "—", made != null && made > d.coins.count ? `${d.coins.count} seen by Blix` : undefined, made != null ? toneOf(made >= 10, made >= 4) : "muted")}
        {tile("Bonded", bonded != null ? bonded.toLocaleString() : "—", rate != null ? `${rate.toFixed(0)}% bond rate` : undefined, bonded ? "up" : "muted",
          rate != null ? <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-paper-4"><i className={cn("block h-full rounded-full", rate >= 25 ? "bg-up" : rate >= 10 ? "bg-warn" : "bg-down")} style={{ width: `${Math.max(3, Math.min(100, rate))}%` }} /></span> : null)}
      </div>
      {d.coins.list.length ? (
        <div className="border-t border-rule">
          <div className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1.5">
            <b className="text-sm font-semibold text-ink">Their coins</b>
            <span className="text-xs text-muted">newest first · tap one to open it</span>
          </div>
          <div className="max-h-[560px] overflow-auto px-2 pb-2">
            {[...d.coins.list.filter((x) => x.mint === mint), ...others].map((x) => <DevCoin key={x.mint} x={x} here={x.mint === mint} now={now} />)}
          </div>
          <p className="border-t border-rule px-4 py-2.5 text-xs text-muted">{d.coins.count} coin{d.coins.count === 1 ? "" : "s"} from this wallet that Blix knows of ({d.coins.window}){made != null && made > d.coins.count ? `; Jupiter counts ${made} in all` : ""}.</p>
        </div>
      ) : <Empty title="No other coins seen" text="Blix keeps 6 hours of launches plus every coin it tracked." />}
    </div>
  );
}

// One of the creator's coins: picture, name, age, market cap now (live) against its peak, and where it ended up.
type DevCoinRow = NonNullable<CoinData["dev"]>["coins"]["list"][number];
function DevCoin({ x, here, now }: { x: DevCoinRow; here: boolean; now: number }) {
  const live = useLiveMc(x.mint), mc = live ?? x.mcap ?? null, peak = x.peak != null && mc != null ? Math.max(x.peak, mc) : x.peak ?? null;
  const ofPeak = mc != null && peak ? Math.min(1, mc / peak) : null;
  const died = !here && mc != null && peak != null && mc < peak * 0.1;
  const pill = (cls: string, dotCls: string, text: string) => <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-2xs font-bold tracking-wider whitespace-nowrap uppercase ring-1 ring-inset", cls)}><i className={cn("size-1.5 rounded-full", dotCls)} />{text}</span>;
  const end = x.graduated ? pill("bg-up/12 text-up ring-up/30", "bg-up", "Bonded")
    : died ? pill("bg-down/12 text-down ring-down/30", "bg-down", `Died −${Math.round((1 - mc! / peak!) * 100)}%`)
    : x.progress != null ? (
      <span className="flex items-center gap-2"><span className="block h-1.5 w-16 overflow-hidden rounded-full bg-paper-4"><i className="block h-full rounded-full bg-up" style={{ width: `${Math.round(x.progress * 100)}%` }} /></span><span className="num text-xs font-semibold text-ink-2">{Math.round(x.progress * 100)}%</span></span>)
    : x.status === "dead" ? pill("bg-paper-4 text-muted ring-rule-2", "bg-muted", "Dead")
    : <span className="text-sm text-muted">{x.status || "—"}</span>;
  const body = (
    <>
      <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-paper-4 text-2xs font-semibold text-muted uppercase ring-1 ring-rule-2">{(x.symbol || "?").slice(0, 3)}<CoinImg mint={x.mint} /></span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <b className="truncate font-semibold text-ink">{x.symbol || "?"}</b>
          {here && <i className="shrink-0 rounded-full bg-accent/15 px-2 py-px text-2xs font-bold tracking-wider text-accent not-italic ring-1 ring-accent/30 ring-inset">THIS COIN</i>}
        </span>
        <span className="truncate text-xs text-muted">{x.name || ""}{x.t ? `${x.name ? " · " : ""}${ageStr(now - x.t)} ago` : ""}</span>
      </span>
      <span className="num flex w-36 shrink-0 flex-col items-end gap-1 max-sm:w-24">
        <span className="flex items-baseline gap-1.5"><Flash value={mc} className="font-semibold text-ink">{usdK(mc)}</Flash><span className="text-xs text-muted max-sm:hidden">/ {usdK(peak)} peak</span></span>
        {ofPeak != null && <span className="block h-1 w-full overflow-hidden rounded-full bg-paper-4" title={`${Math.round(ofPeak * 100)}% of its peak`}><i className={cn("block h-full rounded-full", ofPeak >= 0.5 ? "bg-up" : ofPeak >= 0.15 ? "bg-warn" : "bg-down")} style={{ width: `${Math.max(2, ofPeak * 100)}%` }} /></span>}
      </span>
      <span className="flex w-32 shrink-0 justify-end max-sm:w-auto">{end}</span>
    </>
  );
  const cls = cn("flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors", here ? "bg-accent/[0.07] ring-1 ring-accent/20 ring-inset" : "cursor-pointer hover:bg-paper-3/70");
  return here ? <div className={cls}>{body}</div> : <div {...rowLink(`#/coin/${x.mint}`)} className={cls}>{body}</div>;
}

// ---------- AI read ----------
const GRADE_TONE = (g?: string | null) => !g ? "text-muted border-rule-2" : g.startsWith("A") ? "text-up border-up/50" : g.startsWith("B") ? "text-accent border-accent/50" : g.startsWith("C") ? "text-warn border-warn/50" : g === "D" ? "text-caution border-caution/50" : "text-down border-down/50";
const CALL: Record<string, [string, string]> = { buy: ["BUY", "bg-up/15 text-up"], watch: ["WATCH", "bg-info/15 text-info"], wait: ["WAIT", "bg-info/15 text-info"], avoid: ["AVOID", "bg-down/15 text-down"], skip: ["SKIP", "bg-down/15 text-down"], sell: ["SELL", "bg-down/15 text-down"] };
export function AiView({ mint, r, onRead }: { mint: string; r: TokenDetail; onRead: () => void }) {
  const now = useNow();
  const [asked, setAsked] = useState(false);
  const x = r.research, rep = x?.report;
  const read = async () => { setAsked(true); try { await post(`research/${mint}`); toast("Queued for an AI read at top priority"); onRead(); } catch (e) { setAsked(false); toast((e as Error).message); } };
  const waiting = asked || x?.status === "running" || x?.status === "queued";
  if (!x || !x.status || x.status === "expired" || !rep) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className={cn("grid size-12 place-items-center rounded-full bg-paper-3 text-accent", waiting && "animate-pulse")}><Icon.ai className="size-6" /></span>
        <b className="text-lg font-semibold text-ink">{x?.status === "running" ? "The AI is reading this coin" : x?.paused ? "AI reads are paused" : waiting ? "Queued for an AI read" : "No AI read yet"}</b>
        <p className="max-w-sm text-sm text-muted">{x?.paused ? "No AI is available right now. Reads start again by themselves when one is back; anything queued is kept." : waiting ? "It shows here by itself when done, usually within a minute." : "The AI looks at the chart, holders, dev, socials and safety, then grades the coin and says what it would do."}</p>
        {!waiting && <button onClick={read} className="h-9 rounded-full bg-accent px-5 text-md font-semibold text-accent-ink hover:bg-focus">Get an AI read</button>}
      </div>
    );
  }
  const grade = rep.grade || x.grade || "—", act = (rep.trade?.action || "").toLowerCase(), call = CALL[act];
  const p = rep.trade?.pWin;
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-start gap-4 border-b border-rule px-4 py-4">
        <span className={cn("grid size-16 shrink-0 place-items-center rounded-card border-2 font-display text-3xl font-bold", GRADE_TONE(grade))}>{grade}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="text-lg leading-snug font-semibold text-ink">{rep.verdict || x.verdict}</p>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {call && <span className={cn("rounded-chip px-1.5 py-0.5 text-2xs font-bold tracking-wide", call[1])}>{call[0]}</span>}
            <span>Read by {providerOf(x.model)}{x.t ? ` · ${ageStr(now - x.t)} ago` : ""}</span>
          </span>
        </div>
        <button onClick={read} disabled={waiting} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-rule-2 bg-paper-3 px-3 text-sm font-medium text-ink-2 hover:text-ink disabled:opacity-50"><Icon.refresh className={cn("size-3.5", waiting && "animate-spin")} />{waiting ? "Reading…" : "Read again"}</button>
      </div>
      {p != null && (
        <div className="flex flex-col gap-1.5 border-b border-rule px-4 py-3">
          <span className="flex items-baseline justify-between text-sm"><span className="text-ink-2">Chance it doubles before it drops 40%</span><b className={cn("num text-md font-semibold", p >= 50 ? "text-up" : p >= 25 ? "text-warn" : "text-down")}>{p}%</b></span>
          <span className="block h-1.5 w-full overflow-hidden rounded-full bg-paper-4"><i className={cn("block h-full rounded-full", p >= 50 ? "bg-up" : p >= 25 ? "bg-warn" : "bg-down")} style={{ width: `${Math.max(2, Math.min(100, p))}%` }} /></span>
        </div>
      )}
      <div className={cn("grid divide-rule max-md:divide-y", (rep.why || rep.thesis) && rep.risks?.length ? "md:grid-cols-2 md:divide-x" : "")}>
        {(rep.why || rep.thesis) && <section className="flex flex-col gap-1.5 px-4 py-3"><h4 className="label">Why</h4><p className="text-md leading-relaxed text-ink-2">{rep.why || rep.thesis}</p>{rep.trade?.why && rep.trade.why !== rep.why && <p className="text-sm text-muted">{rep.trade.why}</p>}</section>}
        {rep.risks?.length ? (
          <section className="flex flex-col gap-1.5 px-4 py-3"><h4 className="label">Risks</h4>
            <ul className="flex flex-col gap-1.5">{rep.risks.map((k) => <li key={k} className="flex gap-2 text-md text-ink-2"><i className="mt-2 size-1.5 shrink-0 rounded-full bg-down" />{k}</li>)}</ul>
          </section>
        ) : null}
      </div>
      <p className="border-t border-rule px-4 py-2 text-xs text-muted">An AI's opinion, not financial advice.</p>
    </div>
  );
}

// ---------- Safety ----------
// Two separate answers, never mixed up: Blix's policy (pass / fail, with its reasons: what the bot trades by) and the
// safety score (0-100, 100 = clean, built from RugCheck's report). Then every check, grouped (the contract, who holds
// it, the dev and the trading), each with what its number means, then RugCheck's own warnings.
type Tone = "up" | "warn" | "down" | "muted";
type Check = { name: string; value: string; tone: Tone; note?: string; group: "Contract" | "Holders" | "Dev & trading" };
const level = (ok: boolean, watch: boolean): Tone => (ok ? "up" : watch ? "warn" : "down");
const TONE_TEXT: Record<Tone, string> = { up: "text-ink", warn: "text-warn", down: "text-down", muted: "text-ink-2" };
function Mark({ tone, className }: { tone: Tone; className?: string }) {
  const cls = tone === "up" ? "bg-up/15 text-up" : tone === "warn" ? "bg-warn/15 text-warn" : tone === "down" ? "bg-down/15 text-down" : "bg-paper-4 text-muted";
  return (
    <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-full", cls, className)}>
      <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {tone === "up" ? <path d="m2.5 6.2 2.3 2.3 4.7-5" /> : tone === "warn" ? <path d="M6 2.5v4M6 9.3v.2" /> : tone === "down" ? <path d="m3 3 6 6M9 3 3 9" /> : <path d="M3 6h6" />}
      </svg>
    </span>
  );
}
export function SafetyView({ r, c }: { r: TokenDetail; c: CoinData | null }) {
  const t = r.token, s = t.safety, v = r.verdict, a = c?.audit, info = c?.info;
  const read = t.safety_checked ? Date.now() - t.safety_checked : null;
  const early = Boolean(t.graduated) && read != null && read > 3 * 60_000 && (!t.pair_created || t.safety_checked! - t.pair_created < 15 * 60_000);
  const score = info?.safety ?? t.safety_score ?? null;
  const pct = (x?: number | null) => (x == null ? "—" : `${x.toFixed(1)}%`);
  const checks: Check[] = [];
  // The contract.
  if (a?.mintAuthorityDisabled != null) checks.push({ group: "Contract", name: "Mint authority", value: a.mintAuthorityDisabled ? "Disabled" : "Enabled", tone: a.mintAuthorityDisabled ? "up" : "down", note: a.mintAuthorityDisabled ? "No more tokens can ever be minted" : "The creator can mint more tokens" });
  if (a?.freezeAuthorityDisabled != null) checks.push({ group: "Contract", name: "Freeze authority", value: a.freezeAuthorityDisabled ? "Disabled" : "Enabled", tone: a.freezeAuthorityDisabled ? "up" : "down", note: a.freezeAuthorityDisabled ? "Nobody can freeze your tokens" : "The creator can freeze your tokens" });
  const lp = info?.lpLocked ?? s?.lpLockedPct ?? null;
  if (lp != null) checks.push({ group: "Contract", name: "Liquidity locked", value: `${lp.toFixed(0)}%`, tone: level(lp >= 90, lp >= 50), note: c?.onCurve ? "Still on the curve: there is no pool to pull" : lp >= 90 ? "The pool can't be pulled" : "Part of the pool can be pulled" });
  // Who holds it.
  const top10 = info?.top10 ?? a?.topHoldersPercentage ?? null;
  if (top10 != null) checks.push({ group: "Holders", name: "Top 10 holders", value: pct(top10), tone: level(top10 < 30, top10 < 50), note: "Share of supply, pools and the curve left out" });
  if (info?.devPct != null) checks.push({ group: "Holders", name: "Dev holds", value: pct(info.devPct), tone: level(info.devPct < 5, info.devPct < 15), note: info.devPct < 0.05 ? "The creator holds none" : "The creator's own share" });
  if (info?.insiders != null) checks.push({ group: "Holders", name: "Insiders", value: pct(info.insiders), tone: level(info.insiders < 8, info.insiders < 20), note: "Wallets linked to the dev or to each other" });
  if (info?.snipers) checks.push({ group: "Holders", name: "Snipers", value: pct(info.snipers.pct), tone: level(info.snipers.pct < 8, info.snipers.pct < 20), note: `${info.snipers.n} wallets that bought in the first blocks` });
  const bh = a?.bundlerStats?.holdingPct ?? info?.bundle?.pct ?? null;
  if (bh != null) checks.push({ group: "Holders", name: "Bundles still held", value: pct(bh), tone: level(bh < 8, bh < 20), note: a?.bundlerStats?.totalBundles != null ? `${a.bundlerStats.totalBundles} bundled buys${a.bundlerStats.holdingPctATH != null ? `, at most ${pct(a.bundlerStats.holdingPctATH)} held` : ""}` : "Bought together with the launch" });
  if (a?.botHoldersPercentage != null) checks.push({ group: "Holders", name: "Bot holders", value: pct(a.botHoldersPercentage), tone: level(a.botHoldersPercentage < 10, a.botHoldersPercentage < 20), note: `${a.botHoldersCount != null ? `${a.botHoldersCount.toLocaleString()} bot wallets` : "Bot wallets"} holding supply` });
  // The dev and the trading. A dev's record is judged by how many of their coins ever bonded, not by whether one
  // did: 58 bonded out of 3,452 launched is a serial launcher, not a good dev.
  if (a?.devMints != null) {
    const made = a.devMints, bonded = a.devMigrations ?? 0, rate = made ? bonded / made : 0;
    checks.push({ group: "Dev & trading", name: "Dev's launches", value: `${made.toLocaleString()} coin${made === 1 ? "" : "s"} · ${bonded.toLocaleString()} bonded`, tone: made < 5 ? "up" : level(rate >= 0.2, rate >= 0.05),
      note: made < 5 ? "A new or occasional creator" : `${(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}% of their coins bonded${made >= 100 ? " · a serial launcher" : ""}` });
  }
  if (a?.organic) checks.push({ group: "Dev & trading", name: "Organic trading", value: a.organic[0].toUpperCase() + a.organic.slice(1), tone: a.organic === "high" ? "up" : a.organic === "medium" ? "warn" : "down", note: a.organic === "high" ? "Mostly real traders" : a.organic === "medium" ? "A mix of real traders and bots" : "Mostly bots and wash trading" });
  const fine = checks.filter((k) => k.tone === "up").length, watch = checks.filter((k) => k.tone === "warn").length, bad = checks.filter((k) => k.tone === "down").length;
  const ring = score == null ? null : Math.max(0, Math.min(100, score));
  const scoreTone = ring == null ? "var(--color-muted)" : ring >= 70 ? "var(--color-up)" : ring >= 45 ? "var(--color-warn)" : "var(--color-down)";
  const state = !v ? null : v.ok ? "pass" : v.unknown ? "unknown" : "fail";
  const groups = (["Contract", "Holders", "Dev & trading"] as const).map((g) => [g, checks.filter((k) => k.group === g)] as const).filter(([, l]) => l.length);
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-stretch gap-3 border-b border-rule p-4">
        {/* Blix's policy: what the bot itself would do. */}
        <div className={cn("flex min-w-0 flex-1 items-start gap-3 rounded-card border p-4", state === "pass" ? "border-up/25 bg-up/[0.05]" : state === "fail" ? "border-down/25 bg-down/[0.05]" : "border-rule bg-paper")}>
          <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", state === "pass" ? "bg-up/15 text-up" : state === "fail" ? "bg-down/15 text-down" : "bg-paper-4 text-muted")}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6L12 3Z" />{state === "pass" ? <path d="m8.8 12 2.2 2.2 4.2-4.4" /> : state === "fail" ? <path d="m9.5 9.5 5 5m0-5-5 5" /> : <path d="M12 8.5v4M12 15.5v.2" />}
            </svg>
          </span>
          <div className="min-w-0">
            <span className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">Blix's safety policy</span>
            <b className={cn("block text-lg leading-tight font-semibold", state === "pass" ? "text-up" : state === "fail" ? "text-down" : "text-ink")}>{!state ? "Not judged yet" : state === "pass" ? "Passes" : state === "unknown" ? "Not checked yet" : "Fails"}</b>
            {v?.reasons?.length ? <ul className="mt-1.5 flex flex-col gap-0.5">{v.reasons.map((x) => <li key={x} className="flex gap-1.5 text-sm text-ink-2"><span className="text-down">•</span>{x[0].toUpperCase() + x.slice(1)}</li>)}</ul>
              : <p className="mt-1 text-sm text-muted">{state === "pass" ? "Clear on every rule the bot trades by." : "Blix judges a coin once it has real trading."}</p>}
          </div>
        </div>
        {/* The score, and how the checks below came out. */}
        <div className="flex items-center gap-4 rounded-card border border-rule bg-paper p-4 max-sm:w-full">
          <span className="relative grid size-16 shrink-0 place-items-center rounded-full" style={{ background: ring == null ? "var(--color-paper-4)" : `conic-gradient(${scoreTone} ${ring * 3.6}deg, var(--color-paper-4) 0)` }}>
            <span className="grid size-[54px] place-items-center rounded-full bg-paper"><b className="num text-xl font-bold" style={{ color: scoreTone }}>{ring ?? "—"}</b></span>
          </span>
          <div className="flex flex-col gap-1.5">
            <span className="text-2xs font-semibold tracking-[0.06em] text-muted uppercase">Safety score</span>
            <span className="text-xs text-muted">out of 100 · 100 is clean</span>
            {checks.length > 0 && <span className="num flex gap-1.5 text-xs font-semibold">
              <span className="rounded-full bg-up/12 px-2 py-0.5 text-up">{fine} fine</span>
              {watch > 0 && <span className="rounded-full bg-warn/12 px-2 py-0.5 text-warn">{watch} watch</span>}
              {bad > 0 && <span className="rounded-full bg-down/12 px-2 py-0.5 text-down">{bad} bad</span>}
            </span>}
          </div>
        </div>
      </div>

      {groups.map(([g, list]) => (
        <section key={g} className="border-b border-rule px-4 py-3.5">
          <h4 className="mb-2.5 text-2xs font-semibold tracking-[0.06em] text-muted uppercase">{g}</h4>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2">
            {list.map((k) => (
              <div key={k.name} className={cn("flex items-start gap-2.5 rounded-control border px-3 py-2.5", k.tone === "down" ? "border-down/20 bg-down/[0.04]" : k.tone === "warn" ? "border-warn/20 bg-warn/[0.04]" : "border-rule bg-paper")}>
                <Mark tone={k.tone} className="mt-0.5" />
                <div className="min-w-0">
                  <span className="block text-xs text-muted">{k.name}</span>
                  <b className={cn("num block text-md leading-snug font-semibold", TONE_TEXT[k.tone])}>{k.value}</b>
                  {k.note && <span className="block text-xs leading-snug text-muted">{k.note}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {!checks.length && <p className="border-b border-rule px-4 py-6 text-center text-md text-muted">No checks in yet. They fill in once the coin has real trading.</p>}

      {s?.risks?.length ? (
        <section className="border-b border-rule px-4 py-3.5">
          <h4 className="mb-2.5 text-2xs font-semibold tracking-[0.06em] text-muted uppercase">RugCheck's warnings</h4>
          <div className="flex flex-col gap-2">
            {s.risks.map((x, i) => (
              <div key={i} className="flex items-start gap-2.5 text-md">
                <Mark tone={x.level === "danger" ? "down" : x.level === "warn" ? "warn" : "muted"} className="mt-0.5" />
                <div><b className="font-semibold text-ink">{x.name}</b>{x.value && <span className="text-muted"> · {x.value}</span>}{x.description && <small className="block text-sm text-muted">{x.description}</small>}</div>
              </div>
            ))}
          </div>
        </section>
      ) : s ? <p className="flex items-center gap-2.5 border-b border-rule px-4 py-3 text-md text-ink-2"><Mark tone="up" />RugCheck found no risks.</p> : null}
      <p className="px-4 py-2.5 text-xs text-muted">
        {s ? `RugCheck read it ${read != null ? `${ageStr(read)} ago` : "at an unknown time"}` : "RugCheck hasn't checked it yet (Blix asks once a coin shows real trading)"}{a ? " · Jupiter's audit" : ""}{info?.source ? ` · live figures from ${info.source}` : ""}.
        {early && <span className="block text-warn">RugCheck read it in its first minutes in the pool; holder figures move a lot right after bonding, so the live ones above are used.</span>}
      </p>
      {t.description && <div className="flex flex-col gap-1 border-t border-rule px-4 py-3"><h4 className="label">About, written by the creator</h4><p className="text-md text-ink-2">{t.description}</p></div>}
    </div>
  );
}

