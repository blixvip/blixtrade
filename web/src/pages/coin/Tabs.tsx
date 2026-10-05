// The tabs under the chart: recent trades, the holder ledger, top traders, Fomo's known holders and theses
// (FomoTabs.tsx), the dev's coins, the AI read and the safety check. Your position is in the right column.
import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { pctN, sinceMs, tokN, usdK, usdSigned, type CoinData, type Holder, type TokenDetail, type Trades } from "@/lib/coin";
import { ageStr, providerOf } from "@/lib/format";
import { useNow } from "@/lib/route";
import { usePoll } from "@/lib/coin";
import { cn, store } from "@/lib/utils";
import { KnownHolders, Theses, type CoinFomo } from "./FomoTabs";
import { Empty, SolAmt, Who } from "./parts";

type TabKey = "trades" | "holders" | "traders" | "known" | "theses" | "dev" | "ai" | "safety";
const TABS: [TabKey, string][] = [["trades", "Trades"], ["holders", "Holders"], ["traders", "Top traders"], ["known", "Known holders"], ["theses", "Theses"], ["dev", "Dev tokens"], ["ai", "AI read"], ["safety", "Safety"]];
type Filter = "all" | "dev" | "sniper" | "bundle" | "top10" | "followed" | "big";
const FILTERS: [Filter, string][] = [["all", "All"], ["dev", "Dev"], ["sniper", "Snipers"], ["bundle", "Bundles"], ["top10", "Top 10"], ["followed", "Followed"], ["big", "≥ 1 SOL"]];

const th = "sticky top-0 z-[1] whitespace-nowrap border-b border-rule bg-paper-2 px-3 py-1.5 text-left label";
const td = "whitespace-nowrap border-b border-rule/70 px-3 py-1.5 text-ink-2";

export function CoinTabs({ mint, r, c, trades, onPaper }: { mint: string; r: TokenDetail; c: CoinData | null; trades: Trades | null; onPaper: () => void }) {
  const [tab, setTabState] = useState<TabKey>(() => { const t = store.get<string>("coin:tab", "trades"); return (TABS.some(([k]) => k === t) ? t : "trades") as TabKey; });
  // Fomo's known holders and theses, for the two tabs and their counts (read through Aside, kept 3 min).
  const [fomoMs, setFomoMs] = useState(1500);
  const fomo = usePoll<CoinFomo>(`coin/${mint}/fomo`, fomoMs).data;
  // Every 1.5 s until Fomo's first answer is in, then every 15 s.
  useEffect(() => { setFomoMs(fomo?.read ? 15_000 : 1500); }, [Boolean(fomo?.read), mint]);   // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (t: TabKey) => { store.set("coin:tab", t); setTabState(t); };
  const count: Partial<Record<TabKey, number | null | undefined>> = {
    holders: c?.info.holders ?? c?.holders?.count, dev: c?.dev?.coins.others || null, known: fomo?.totalHolders ?? (fomo?.holders.length || null), theses: fomo?.theses.length || null,
  };
  return (
    <div className="flex min-w-0 flex-col">
      <div role="tablist" className="flex gap-0.5 overflow-x-auto border-y border-rule px-1.5 [scrollbar-width:none]">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn("relative whitespace-nowrap px-2.5 py-2.5 text-md font-semibold", tab === k ? "text-ink" : "text-muted hover:text-ink-2")}>
            {l}{count[k] != null && <span className="num ml-1 font-normal text-muted">{Number(count[k]).toLocaleString()}</span>}
            {tab === k && <i className="absolute inset-x-2.5 -bottom-px h-0.5 rounded bg-accent" />}
          </button>
        ))}
      </div>
      <div className="min-h-64">
        {tab === "trades" && <TradesTab trades={trades} />}
        {tab === "holders" && (c?.holders?.list.length ? <><LedgerNote c={c} /><WalletTable list={c.holders.list} lastLabel={c.holders.source === "jupiter" ? "Last trade" : undefined} /></> : <Empty title={c ? "Loading holders" : "Loading"} text="Reading this coin's holders. They appear here in a moment." />)}
        {tab === "traders" && (c?.traders.length ? <><TradersNote c={c} /><WalletTable list={c.traders} /></> : <Empty title={c ? "Loading top traders" : "Loading"} text="Reading this coin's trades. Traders appear here in a moment." />)}
        {tab === "known" && <KnownHolders f={fomo} mc={c?.mcUsd ?? r.token.mcap ?? null} />}
        {tab === "theses" && <Theses f={fomo} />}
        {tab === "dev" && <DevTab mint={mint} c={c} />}
        {tab === "ai" && <AiTab mint={mint} r={r} onRead={onPaper} />}
        {tab === "safety" && <SafetyTab r={r} c={c} />}
      </div>
    </div>
  );
}

function TradesTab({ trades }: { trades: Trades | null }) {
  const now = useNow();
  const [f, setFState] = useState<Filter>(() => store.get("coin:filter", "all"));
  const setF = (v: Filter) => { store.set("coin:filter", v); setFState(v); };
  if (!trades) return <Empty title="Loading trades" />;
  const keep: Record<Filter, (x: Trades["trades"][number]) => boolean> = {
    all: () => true, dev: (x) => x.tag === "dev", sniper: (x) => x.tag === "sniper", bundle: (x) => x.tag === "bundle", top10: (x) => x.top10, followed: (x) => x.followed, big: (x) => (x.sol ?? 0) >= 1,
  };
  const list = trades.trades.filter(keep[f]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-rule px-3 py-2">
        {FILTERS.map(([k, l]) => (
          <button key={k} onClick={() => setF(k)} className={cn("h-6 rounded-chip border px-2 text-xs font-semibold", f === k ? "border-accent bg-accent/15 text-ink" : "border-rule text-muted hover:text-ink")}>{l}</button>
        ))}
        <span className="ml-auto text-xs text-muted">{trades.source === "live" ? "live trade feed" : trades.source === "pool" ? `pool trades · ${/GeckoTerminal/.test(trades.note || "") ? "GeckoTerminal" : "Jupiter"}` : ""}</span>
      </div>
      {!trades.trades.length ? <Empty title="No trades yet" text={trades.note} />
        : !list.length ? <Empty title="No trades match this filter" text="Try All." />
        : (
          <div className="max-h-[560px] overflow-auto">
            <table className="num w-full border-collapse text-md">
              <thead><tr><th className={th}>Age</th><th className={th}>Type</th><th className={cn(th, "text-right")}>MC</th><th className={cn(th, "text-right")}>Amount</th><th className={cn(th, "text-right")}>Total</th><th className={th}>Trader</th></tr></thead>
              <tbody>
                {list.slice(0, 150).map((x, i) => (
                  <tr key={`${x.t}:${x.wallet}:${i}`} className="hover:bg-paper-3">
                    <td className={cn(td, "text-muted")}>{ageStr(now - x.t)}</td>
                    <td className={cn(td, "font-semibold", x.side === "buy" ? "text-up" : "text-down")}>{x.side === "buy" ? "Buy" : "Sell"}</td>
                    <td className={cn(td, "text-right")}>{usdK(x.mcUsd)}</td>
                    <td className={cn(td, "text-right")}>{tokN(x.tokens)}</td>
                    <td className={cn(td, "text-right", x.side === "buy" ? "text-up" : "text-down")}>{usdK(x.usd)} <SolAmt v={x.sol} className="ml-1 text-muted" /></td>
                    <td className={td}><Who wallet={x.wallet} x={x} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}

function LedgerNote({ c }: { c: CoinData }) {
  const h = c.holders, now = useNow();
  if (!h) return null;
  if (h.source === "jupiter") return <p className="px-3 py-2 text-sm text-muted">The {h.list.length} largest of {h.count.toLocaleString()} holders right now, from Jupiter. Bought, sold and PnL cover each wallet's trades in the last {h.trades.toLocaleString()} trades only.</p>;
  const text = h.frozen ? `Holders as of bonding (${ageStr(now - h.last)} ago). Blix reads trades on the bonding curve; trades in the pool since then are not in this list. The Holders and Top 10 tiles use RugCheck's current figures.`
    : h.genesis && !h.partial ? `Complete: Blix saw this coin from its first trade (${h.trades.toLocaleString()} trades).`
    : h.genesis ? "Mostly complete: a few sells were of tokens Blix never saw bought."
    : "Partial: Blix started reading this coin after it launched, so early holders may be missing and snipers and bundles are not tagged.";
  return <p className="px-3 py-2 text-sm text-muted">{text}</p>;
}

function TradersNote({ c }: { c: CoinData }) {
  const now = useNow(), w = c.jupiter?.tradersWindow;
  if (w && c.jupiter?.tabs.includes("traders")) return <p className="px-3 py-2 text-sm text-muted">The wallets that traded the most in the last {w.trades.toLocaleString()} trades of $25 or more{w.since ? ` (${ageStr(now - w.since)})` : ""}, from Jupiter. PnL shows only for wallets that bought inside that window: for the rest, what they paid is earlier.</p>;
  return <p className="px-3 py-2 text-sm text-muted">Ranked by result: what they got from sells plus what they hold at the current price, minus what they spent.</p>;
}

function WalletTable({ list, early = false, lastLabel }: { list: Holder[]; early?: boolean; lastLabel?: string }) {
  const now = useNow();
  // Jupiter's holder list carries no trade totals for most wallets: leave those columns out rather than a wall of dashes.
  const flows = list.filter((w) => w.boughtSol || w.soldSol).length > list.length * 0.3;
  return (
    <div className="max-h-[560px] overflow-auto">
      <table className="num w-full border-collapse text-md">
        <thead><tr>
          <th className={th}>#</th><th className={th}>Wallet</th>{early && <th className={th}>Entry</th>}
          <th className={cn(th, "text-right")}>Holding</th>
          {flows && <><th className={cn(th, "text-right")}>Bought</th><th className={cn(th, "text-right")}>Sold</th><th className={cn(th, "text-right")}>PnL</th></>}
          <th className={th}>{early ? "Status" : lastLabel || "Held"}</th>
        </tr></thead>
        <tbody>
          {list.map((w, i) => (
            <tr key={w.wallet} className="hover:bg-paper-3">
              <td className={cn(td, "text-muted")}>{i + 1}</td>
              <td className={td}><Who wallet={w.wallet} x={w} /></td>
              {early && <td className={cn(td, "text-muted")}>{w.afterFirstMs == null ? "—" : w.afterFirstMs < 1000 ? "first second" : `+${sinceMs(w.afterFirstMs)}`}</td>}
              <td className={cn(td, "text-right")}>{w.status === "outside top 100" ? <span className="text-muted">—</span> : <>
                <span className="inline-grid justify-items-end gap-0.5 align-middle"><b className="font-semibold text-ink">{pctN(w.pct, 2)}</b>
                  <span className="block h-0.5 w-14 overflow-hidden rounded bg-rule-2"><i className="block h-full bg-accent" style={{ width: `${Math.min(100, (w.pct / Math.max(w.maxPct, 1e-4)) * 100)}%` }} /></span></span>
                <span className="text-muted"> {usdK(w.valueUsd)}</span></>}
              </td>
{flows && <>
              <td className={cn(td, "text-right")}>{w.boughtSol ? <><SolAmt v={w.boughtSol} />{w.avgBuyMc ? <span className="text-muted"> @{usdK(w.avgBuyMc)}</span> : null}</> : <span className="text-muted">—</span>}</td>
              <td className={cn(td, "text-right")}>{w.soldSol ? <SolAmt v={w.soldSol} /> : <span className="text-muted">—</span>}</td>
              <td className={cn(td, "text-right", w.pnlSol == null ? "" : w.pnlSol >= 0 ? "text-up" : "text-down")}>{w.pnlSol == null ? "—" : <><SolAmt v={w.pnlSol} signed /> <span className="text-muted">{usdSigned(w.pnlUsd)}</span></>}</td>
              </>}
              <td className={cn(td, "text-muted")}>{early ? <span className={cn("font-semibold", w.status === "holding" ? "text-up" : w.status === "sold all" ? "text-down" : w.status === "outside top 100" ? "font-normal text-muted" : "text-ink-2")}>{w.status}</span> : w.first ? ageStr(now - w.first) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DevTab({ mint, c }: { mint: string; c: CoinData | null }) {
  const now = useNow();
  const d = c?.dev;
  if (!d) return <Empty title={c ? "Dev unknown" : "Loading"} text={c ? "Neither Blix nor Jupiter knows who created this coin." : undefined} />;
  const a = c?.audit;
  return (
    <>
      <div className="flex flex-col gap-0.5 border-b border-rule px-3 py-2.5">
        {a?.devMints != null && <span className="text-md text-ink"><b className="font-semibold">{a.devMints.toLocaleString()}</b> coin{a.devMints === 1 ? "" : "s"} launched by this wallet, <b className={cn("font-semibold", (a.devMigrations ?? 0) > 0 ? "text-up" : "")}>{(a.devMigrations ?? 0).toLocaleString()}</b> bonded <span className="text-sm text-muted">(Jupiter, all time)</span></span>}
        <a href={`https://solscan.io/account/${d.wallet}`} target="_blank" rel="noreferrer" className="font-outlier text-xs text-ink-2 hover:text-accent">{d.wallet}</a>
        <span className="text-sm text-muted">{d.pct != null || d.boughtSol != null ? <>Holds {d.pct != null ? pctN(d.pct, 2) : "—"}{d.maxPct ? ` (peak ${pctN(d.maxPct, 2)})` : ""}{d.sold ? ` · ${d.sold === "all" ? "sold everything" : "selling"}` : ""} · spent <SolAmt v={d.boughtSol ?? 0} /> · got <SolAmt v={d.soldSol ?? 0} /></> : "No trades by the dev seen on this coin."}</span>
      </div>
      {d.coins.list.length ? (
        <>
          <div className="max-h-[560px] overflow-auto">
            <table className="num w-full border-collapse text-md">
              <thead><tr><th className={th}>Coin</th><th className={th}>Launched</th><th className={cn(th, "text-right")}>MC</th><th className={cn(th, "text-right")}>Peak</th><th className={th}>Status</th></tr></thead>
              <tbody>
                {d.coins.list.map((x) => (
                  <tr key={x.mint} onClick={() => { if (x.mint !== mint) location.hash = `#/coin/${x.mint}`; }} className={cn("cursor-pointer hover:bg-paper-3", x.mint === mint && "bg-accent/10")}>
                    <td className={td}><b className="font-semibold text-ink">{x.symbol || "?"}</b> <span className="text-muted">{x.name || ""}</span>{x.mint === mint && <i className="ml-1.5 rounded-chip bg-accent/15 px-1.5 py-px text-[0.625rem] font-bold not-italic text-accent">THIS COIN</i>}</td>
                    <td className={cn(td, "text-muted")}>{x.t ? `${ageStr(now - x.t)} ago` : "—"}</td>
                    <td className={cn(td, "text-right")}>{usdK(x.mcap)}</td>
                    <td className={cn(td, "text-right")}>{usdK(x.peak)}</td>
                    <td className={cn(td, "text-muted")}>{x.graduated ? "bonded" : x.progress != null ? `curve ${Math.round(x.progress * 100)}%` : x.status || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-2 text-sm text-muted">{d.coins.count} coin{d.coins.count === 1 ? "" : "s"} from this wallet: {d.coins.window}.</p>
        </>
      ) : <Empty title="No other coins seen" text="Blix keeps 6 hours of launches plus every coin it tracked." />}
    </>
  );
}

const GRADE = (g?: string | null) => !g ? "text-muted" : g.startsWith("A") ? "text-up" : g.startsWith("B") ? "text-accent" : g.startsWith("C") ? "text-warn" : g === "D" ? "text-caution" : "text-down";
function AiTab({ mint, r, onRead }: { mint: string; r: TokenDetail; onRead: () => void }) {
  const now = useNow();
  const x = r.research, rep = x?.report;
  const read = async () => { try { await post(`research/${mint}`); toast("Queued for an AI read at top priority"); onRead(); } catch (e) { toast((e as Error).message); } };
  if (!x || !x.status || x.status === "expired" || !rep) {
    const waiting = x?.status === "running" || x?.status === "queued";
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <b className="text-lg font-semibold text-ink">{x?.status === "running" ? "The AI is reading this coin" : x?.status === "queued" ? "Queued for an AI read" : "No AI read yet"}</b>
        <p className="max-w-sm text-sm text-muted">{waiting ? "It appears here when done, usually within a minute." : "The AI looks at the chart, holders, dev, socials and safety, then grades the coin and says what it would do."}</p>
        {!waiting && <button onClick={read} className="h-9 rounded-full bg-accent px-5 text-md font-semibold text-accent-ink hover:bg-focus">Get an AI read</button>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-start gap-3">
        <b className={cn("font-display text-3xl font-semibold", GRADE(rep.grade || x.grade))}>{rep.grade || x.grade || "—"}</b>
        <div className="min-w-0">
          <p className="text-ink">{rep.verdict || x.verdict}</p>
          <p className="mt-1 text-xs text-muted">Read by {providerOf(x.model)}{x.t ? ` · ${ageStr(now - x.t)} ago` : ""}{rep.trade?.action ? ` · call: ${rep.trade.action}` : ""}{rep.trade?.pWin != null ? ` · ${rep.trade.pWin}% chance of 2x before −40%` : ""}</p>
        </div>
        <button onClick={read} className="ml-auto h-7 shrink-0 rounded-control border border-rule-2 bg-paper-3 px-2.5 text-sm text-ink-2 hover:text-ink">Read again</button>
      </div>
      {(rep.why || rep.thesis) && <p className="text-sm text-ink-2">{rep.why || rep.thesis}</p>}
      {rep.risks?.length ? <div><h4 className="label mb-1.5">Risks</h4><ul className="list-disc pl-5 text-sm text-ink-2">{rep.risks.map((k) => <li key={k}>{k}</li>)}</ul></div> : null}
      <p className="text-xs text-muted">An AI's opinion, not financial advice.</p>
    </div>
  );
}

function Audit({ a }: { a: NonNullable<CoinData["audit"]> }) {
  const row = (ok: boolean | null, name: string, value: string) => (
    <div className="grid grid-cols-[8px_1fr_auto] items-center gap-2.5 text-md">
      <i className={cn("size-2 rounded-[2px]", ok == null ? "bg-muted" : ok ? "bg-up" : "bg-down")} /><span className="text-ink-2">{name}</span><b className="num font-semibold text-ink">{value}</b>
    </div>
  );
  const pct = (x?: number) => (x == null ? "—" : `${x.toFixed(1)}%`);
  const b = a.bundlerStats;
  return (
    <div className="flex flex-col gap-2 rounded-control border border-rule bg-paper-3 p-3">
      <b className="text-md text-ink">Jupiter's audit</b>
      {row(a.mintAuthorityDisabled ?? null, "Mint authority", a.mintAuthorityDisabled ? "disabled" : a.mintAuthorityDisabled === false ? "ENABLED: more can be minted" : "—")}
      {row(a.freezeAuthorityDisabled ?? null, "Freeze authority", a.freezeAuthorityDisabled ? "disabled" : a.freezeAuthorityDisabled === false ? "ENABLED: wallets can be frozen" : "—")}
      {row(a.topHoldersPercentage == null ? null : a.topHoldersPercentage < 30, "Top 10 holders", pct(a.topHoldersPercentage))}
      {row(a.botHoldersPercentage == null ? null : a.botHoldersPercentage < 20, "Bot holders", `${pct(a.botHoldersPercentage)}${a.botHoldersCount != null ? ` · ${a.botHoldersCount.toLocaleString()} wallets` : ""}`)}
      {b && row(b.holdingPct == null ? null : b.holdingPct < 10, "Bundles still held", `${pct(b.holdingPct)}${b.holdingPctATH != null ? ` (peak ${pct(b.holdingPctATH)})` : ""}${b.totalBundles != null ? ` · ${b.totalBundles} bundles` : ""}`)}
      {a.devMints != null && row((a.devMigrations ?? 0) > 0 || a.devMints < 5, "Dev's launches", `${a.devMints} made · ${a.devMigrations ?? 0} bonded`)}
      {a.organic && row(a.organic === "high" ? true : a.organic === "low" ? false : null, "Organic trading", a.organic)}
    </div>
  );
}

function SafetyTab({ r, c }: { r: TokenDetail; c: CoinData | null }) {
  const t = r.token, s = t.safety, v = r.verdict;
  // A bonded coin's report from its first minutes in the pool dates within minutes (see rugFigures, server/pulse.js).
  const read = t.safety_checked ? Date.now() - t.safety_checked : null;
  const early = Boolean(t.graduated) && read != null && read > 3 * 60_000 && (!t.pair_created || t.safety_checked! - t.pair_created < 15 * 60_000);
  return (
    <div className="flex flex-col gap-3 p-3">
      {v && (
        <div className={cn("rounded-control border bg-paper-3 p-3 text-md", v.ok ? "border-up/50" : v.unknown ? "border-rule-2" : "border-down/60")}>
          <b className="text-ink">{v.ok ? "Passes Blix's safety policy" : v.unknown ? "Not safety-checked yet" : "Fails Blix's safety policy"}</b>
          {v.reasons?.length ? <ul className="mt-1.5 list-disc pl-5 text-ink-2">{v.reasons.map((x) => <li key={x}>{x}</li>)}</ul> : null}
        </div>
      )}
      {s?.risks?.length ? (
        <div className="flex flex-col gap-2">
          {s.risks.map((x, i) => (
            <div key={i} className="grid grid-cols-[8px_1fr] gap-2.5 text-md">
              <i className={cn("mt-1.5 size-2 rounded-[2px]", x.level === "danger" ? "bg-down" : x.level === "warn" ? "bg-warn" : "bg-accent")} />
              <div><b className="font-semibold text-ink">{x.name}</b>{x.value && <span className="text-muted"> {x.value}</span>}{x.description && <small className="block text-sm text-muted">{x.description}</small>}</div>
            </div>
          ))}
        </div>
      ) : s ? <p className="text-up">RugCheck found no risks.</p> : <p className="text-sm text-muted">RugCheck has not checked this coin yet (Blix checks coins when they first show real trading).{c?.audit ? " Jupiter's audit is below." : ""}</p>}
      {c?.audit && <Audit a={c.audit} />}
      {s && <p className="text-sm text-muted">RugCheck, read {read != null ? `${ageStr(read)} ago` : "at an unknown time"}: {s.totalHolders ? `${s.totalHolders.toLocaleString()} holders` : "holders not indexed yet"} · top 10 {pctN(s.top10 || null)} · insiders {pctN(s.insiderPct ?? null)} · dev {pctN(s.devPct ?? null)} · LP locked {pctN(s.lpLockedPct ?? null, 0)}
        {early && <span className="block text-warn">Read in the coin's first minutes in its pool, so these holder figures are out of date (devs often airdrop or move tokens right after bonding). The tiles on the right use a current reading.</span>}</p>}
      {t.description && <><h4 className="label">About, written by the creator</h4><p className="text-sm text-ink-2">{t.description}</p></>}
    </div>
  );
}
