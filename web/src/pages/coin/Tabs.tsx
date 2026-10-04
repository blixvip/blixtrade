// The tabs under the chart: recent trades, the holder ledger, top traders, early buyers, the dev's coins,
// your paper positions, the AI read, signals and the safety check.
import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { pctN, sinceMs, tokN, usdK, usdSigned, type CoinData, type Holder, type TokenDetail, type Trades } from "@/lib/coin";
import { ageStr, providerOf } from "@/lib/format";
import { useNow } from "@/lib/route";
import { cn, store } from "@/lib/utils";
import { Empty, SolAmt, Who } from "./parts";

type TabKey = "trades" | "holders" | "traders" | "early" | "dev" | "positions" | "ai" | "signals" | "safety";
const TABS: [TabKey, string][] = [["trades", "Trades"], ["holders", "Holders"], ["traders", "Top traders"], ["early", "Early buyers"], ["dev", "Dev tokens"], ["positions", "Positions"], ["ai", "AI read"], ["signals", "Signals"], ["safety", "Safety"]];
type Filter = "all" | "dev" | "sniper" | "bundle" | "top10" | "followed" | "big";
const FILTERS: [Filter, string][] = [["all", "All"], ["dev", "Dev"], ["sniper", "Snipers"], ["bundle", "Bundles"], ["top10", "Top 10"], ["followed", "Followed"], ["big", "≥ 1 SOL"]];

const th = "sticky top-0 z-[1] whitespace-nowrap border-b border-rule bg-paper-2 px-3 py-1.5 text-left label";
const td = "whitespace-nowrap border-b border-rule/70 px-3 py-1.5 text-ink-2";

export function CoinTabs({ mint, r, c, trades, onPaper }: { mint: string; r: TokenDetail; c: CoinData | null; trades: Trades | null; onPaper: () => void }) {
  const [tab, setTabState] = useState<TabKey>(() => store.get("coin:tab", "trades"));
  const setTab = (t: TabKey) => { store.set("coin:tab", t); setTabState(t); };
  const count: Partial<Record<TabKey, number | null | undefined>> = {
    holders: c?.info.holders ?? c?.holders?.count, dev: c?.dev?.coins.others || null, positions: r.paper?.length || null, signals: r.signals?.length || null,
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
        {tab === "holders" && (c?.holders ? <><LedgerNote c={c} /><WalletTable list={c.holders.list} /></> : <Empty title="No live ledger for this coin" text="Holders are built from the trade feed while a coin trades on its bonding curve. For bonded coins, the Safety tab has RugCheck's holder figures." />)}
        {tab === "traders" && (c?.traders.length ? <><p className="px-3 py-2 text-sm text-muted">Ranked by result so far: SOL from sells plus what they hold at the current price, minus SOL spent.</p><WalletTable list={c.traders} /></> : <Empty title="No traders yet" text="Top traders appear once Blix has a live ledger and a price for this coin." />)}
        {tab === "early" && (c?.early.length ? <><LedgerNote c={c} /><WalletTable list={c.early} early /></> : <Empty title="No early buyers known" text="Early buyers are only known for coins Blix read from their first trade." />)}
        {tab === "dev" && <DevTab mint={mint} c={c} />}
        {tab === "positions" && <PositionsTab r={r} />}
        {tab === "ai" && <AiTab mint={mint} r={r} onRead={onPaper} />}
        {tab === "signals" && <SignalsTab r={r} />}
        {tab === "safety" && <SafetyTab r={r} />}
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
        <span className="ml-auto text-xs text-muted">{trades.source === "live" ? "live trade feed" : trades.source === "pool" ? "pool trades · GeckoTerminal" : ""}</span>
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
  const text = h.frozen ? `Holders as of bonding (${ageStr(now - h.last)} ago). Blix reads trades on the bonding curve; trades in the pool since then are not in this list. The Holders and Top 10 tiles use RugCheck's current figures.`
    : h.genesis && !h.partial ? `Complete: Blix saw this coin from its first trade (${h.trades.toLocaleString()} trades).`
    : h.genesis ? "Mostly complete: a few sells were of tokens Blix never saw bought."
    : "Partial: Blix started reading this coin after it launched, so early holders may be missing and snipers and bundles are not tagged.";
  return <p className="px-3 py-2 text-sm text-muted">{text}</p>;
}

function WalletTable({ list, early = false }: { list: Holder[]; early?: boolean }) {
  const now = useNow();
  return (
    <div className="max-h-[560px] overflow-auto">
      <table className="num w-full border-collapse text-md">
        <thead><tr>
          <th className={th}>#</th><th className={th}>Wallet</th>{early && <th className={th}>Bought</th>}
          <th className={cn(th, "text-right")}>Holding</th><th className={cn(th, "text-right")}>Bought</th><th className={cn(th, "text-right")}>Sold</th><th className={cn(th, "text-right")}>PnL</th>
          <th className={th}>{early ? "Status" : "Held"}</th>
        </tr></thead>
        <tbody>
          {list.map((w, i) => (
            <tr key={w.wallet} className="hover:bg-paper-3">
              <td className={cn(td, "text-muted")}>{i + 1}</td>
              <td className={td}><Who wallet={w.wallet} x={w} /></td>
              {early && <td className={cn(td, "text-muted")}>{w.afterFirstMs != null ? `+${sinceMs(Math.max(0, w.afterFirstMs))}` : "—"}</td>}
              <td className={cn(td, "text-right")}>
                <span className="inline-grid justify-items-end gap-0.5 align-middle"><b className="font-semibold text-ink">{pctN(w.pct, 2)}</b>
                  <span className="block h-0.5 w-14 overflow-hidden rounded bg-rule-2"><i className="block h-full bg-accent" style={{ width: `${Math.min(100, (w.pct / Math.max(w.maxPct, 1e-4)) * 100)}%` }} /></span></span>
                <span className="text-muted"> {usdK(w.valueUsd)}</span>
              </td>
              <td className={cn(td, "text-right")}><SolAmt v={w.boughtSol} />{w.avgBuyMc ? <span className="text-muted"> @{usdK(w.avgBuyMc)}</span> : null}</td>
              <td className={cn(td, "text-right")}>{w.soldSol ? <SolAmt v={w.soldSol} /> : <span className="text-muted">—</span>}</td>
              <td className={cn(td, "text-right", w.pnlSol == null ? "" : w.pnlSol >= 0 ? "text-up" : "text-down")}>{w.pnlSol == null ? "—" : <><SolAmt v={w.pnlSol} signed /> <span className="text-muted">{usdSigned(w.pnlUsd)}</span></>}</td>
              <td className={cn(td, "text-muted")}>{early ? <span className={cn("font-semibold", w.status === "holding" ? "text-up" : w.status === "sold all" ? "text-down" : "text-ink-2")}>{w.status}</span> : ageStr(now - w.first)}</td>
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
  if (!d) return <Empty title="Dev unknown" text="Blix did not see who created this coin." />;
  return (
    <>
      <div className="flex flex-col gap-0.5 border-b border-rule px-3 py-2.5">
        <a href={`https://solscan.io/account/${d.wallet}`} target="_blank" rel="noreferrer" className="font-outlier text-xs text-ink-2 hover:text-accent">{d.wallet}</a>
        <span className="text-sm text-muted">{d.pct != null ? <>Holds {pctN(d.pct, 2)} (peak {pctN(d.maxPct ?? 0, 2)}){d.sold ? ` · ${d.sold === "all" ? "sold everything" : "selling"}` : ""} · spent <SolAmt v={d.boughtSol ?? 0} /> · got <SolAmt v={d.soldSol ?? 0} /></> : "No trades by the dev seen on this coin."}</span>
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

function PositionsTab({ r }: { r: TokenDetail }) {
  const now = useNow();
  const ps = r.paper || [];
  if (!ps.length) return <Empty title="No paper positions in this coin" text="Use the panel on the right or the ⚡ buttons up top. Paper only: nothing is really bought." />;
  return (
    <table className="num w-full border-collapse text-md">
      <thead><tr><th className={th}>Opened</th><th className={cn(th, "text-right")}>Spent</th><th className={cn(th, "text-right")}>Entry MC</th><th className={cn(th, "text-right")}>Now</th><th className={cn(th, "text-right")}>Result</th><th className={th}>Status</th></tr></thead>
      <tbody>
        {ps.map((p) => (
          <tr key={p.id} className="hover:bg-paper-3">
            <td className={cn(td, "text-muted")}>{ageStr(now - p.t)} ago</td>
            <td className={cn(td, "text-right")}><SolAmt v={p.sol} /></td>
            <td className={cn(td, "text-right")}>{usdK(p.mcap0)}</td>
            <td className={cn(td, "text-right")}>{usdK(p.status === "open" ? p.mcapNow : p.exit_mcap)}</td>
            <td className={cn(td, "text-right", (p.mult ?? 1) >= 1 ? "text-up" : "text-down")}>{p.mult != null ? `${p.mult.toFixed(2)}x` : "—"}</td>
            <td className={cn(td, "text-muted")}>{p.status === "open" ? "open" : p.exit_why || "closed"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const GRADE = (g?: string | null) => !g ? "text-muted" : g.startsWith("A") ? "text-up" : g.startsWith("B") ? "text-accent" : g.startsWith("C") ? "text-warn" : g === "D" ? "text-caution" : "text-down";
function AiTab({ mint, r, onRead }: { mint: string; r: TokenDetail; onRead: () => void }) {
  const now = useNow();
  const x = r.research, rep = x?.report;
  const read = async () => { try { await post(`research/${mint}`); toast("Queued for an AI read at top priority"); onRead(); } catch (e) { toast((e as Error).message); } };
  if (!x || !x.status || x.status === "expired" || !rep) {
    return <Empty title={x?.status === "running" ? "The AI is reading this coin" : x?.status === "queued" ? "Queued for an AI read" : "No AI read yet"}
      text={x?.status === "running" || x?.status === "queued" ? "It appears here when done." : "Ask for one: it takes a few seconds for a quick call."} />;
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

function SignalsTab({ r }: { r: TokenDetail }) {
  const now = useNow();
  const l = r.signals || [];
  if (!l.length) return <Empty title="No signals on this coin" text="Signals fire on launches, graduations, volume, momentum, dumps, dev sells and wallet buys." />;
  return (
    <div className="flex flex-col gap-2 p-3">
      {l.map((x, i) => (
        <div key={i} className="grid grid-cols-[8px_1fr] gap-2.5 text-md">
          <i className={cn("mt-1.5 size-2 rounded-[2px]", x.safe === 0 ? "bg-muted" : /dump|sold|rug|pulled/.test(x.kind) ? "bg-down" : "bg-accent")} />
          <div><b className="font-semibold text-ink">{x.title}</b> <span className="text-muted">{ageStr(now - x.t)} ago</span>{x.detail && <small className="block text-sm text-muted">{x.detail}</small>}</div>
        </div>
      ))}
    </div>
  );
}

function SafetyTab({ r }: { r: TokenDetail }) {
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
      ) : s ? <p className="text-up">RugCheck found no risks.</p> : <p className="text-sm text-muted">Not checked yet. Coins are checked when they first show real trading.</p>}
      {s && <p className="text-sm text-muted">RugCheck, read {read != null ? `${ageStr(read)} ago` : "at an unknown time"}: {s.totalHolders ? `${s.totalHolders.toLocaleString()} holders` : "holders not indexed yet"} · top 10 {pctN(s.top10 || null)} · insiders {pctN(s.insiderPct ?? null)} · dev {pctN(s.devPct ?? null)} · LP locked {pctN(s.lpLockedPct ?? null, 0)}
        {early && <span className="block text-warn">Read in the coin's first minutes in its pool, so these holder figures are out of date (devs often airdrop or move tokens right after bonding). The tiles on the right use a current reading.</span>}</p>}
      {t.description && <><h4 className="label">About, written by the creator</h4><p className="text-sm text-ink-2">{t.description}</p></>}
    </div>
  );
}
