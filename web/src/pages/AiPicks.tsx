// AI picks (#/ai-picks): what the AI's deep reads said today (buy, watch or avoid, with its reason), its buy calls
// this week, and how its picks have done. Read-only: nothing is bought.
import { useEffect, useState, type ReactNode } from "react";
import { Segmented } from "@/components/ui/segmented";
import { ago, CoinCell, Empty, gradeTone, Kpis, Loading, money, mult, Page, Panel, Problem, Scroll, td, tdR, th, thR, toneX } from "@/components/page";
import { usePoll } from "@/lib/coin";
import { rowLink } from "@/lib/route";
import { cn } from "@/lib/utils";
import { openExchange } from "@/lib/modals";
import { useRole } from "@/lib/role";
import { loadMe, useMe, type Me } from "@/lib/ui";

type J = any;
const pct = (x: number) => `${x >= 1 ? "+" : "−"}${Math.abs((x - 1) * 100).toFixed(1)}%`;
const actionTone = (a?: string) => (a === "buy" ? "text-up" : a === "avoid" ? "text-down" : "text-warn");

// Unlocked by a deposit: AI picks and every coin's AI read (pages/coin/Tabs.tsx, AiGate) open once the wallet
// holds UNLOCK_USD or more (SOL and coins together, as the wallet service values them). The owner sees the lock
// too (the user, 2026-10-10), with an owner-only link past it. A lock on the pages only: the APIs are open.
export const UNLOCK_USD = 10;
const walletUsd = (me: Me | null) => !me?.wallet ? 0 : (me.wallet.solUsd || 0) + (me.wallet.tokens || []).reduce((n, t) => n + (t.usd || 0), 0);
// "loading" until the account is read; "open" with UNLOCK_USD held (the owner never: they get the lock and its link).
export function useAiUnlock() {
  const role = useRole(), me = useMe((s) => s.me);
  useEffect(() => { if (!me) void loadMe(); }, [me]);
  const have = walletUsd(me);
  const state: "loading" | "open" | "locked" = !me ? "loading" : have >= UNLOCK_USD && role !== "owner" ? "open" : "locked";
  return { state, have, wallet: Boolean(me?.signedIn && !me.needsWallet), owner: role === "owner" };
}
// The same lock over one coin's AI read: nothing behind it is asked for (no read queued) until it opens.
let peeked = false;   // the owner's "open anyway" lasts for the visit
export function AiGate({ children }: { children: ReactNode }) {
  const u = useAiUnlock(), [peek, setPeek] = useState(peeked);
  if (peek || u.state === "open") return <>{children}</>;
  if (u.state === "loading") return <div className="p-4"><Loading /></div>;
  return (
    <div className="p-3">
      <Locked have={u.have} wallet={u.wallet} owner={u.owner} onPeek={() => { peeked = true; setPeek(true); }} what="read" />
    </div>
  );
}

export function AiPicks() {
  const u = useAiUnlock();
  const [peek, setPeek] = useState(false);
  if (peek || u.state === "open") return <Picks />;
  if (u.state === "loading") return <Page title="AI picks"><Loading /></Page>;
  return (
    <Page title="AI picks" sub="What the AI said about today's coins after reading them in depth, and how its picks have done. Not advice.">
      <Locked have={u.have} wallet={u.wallet} owner={u.owner} onPeek={() => setPeek(true)} />
    </Page>
  );
}

// What the lock opens, as shapes only: a blurred stand-in for the picks page, so the lock sits on what it guards.
const ACTS = ["buy", "watch", "avoid", "watch", "buy", "avoid", "watch", "buy", "watch"];
function Preview() {
  return (
    <div aria-hidden className="pointer-events-none flex flex-col gap-3 p-4 blur-[5px] select-none">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {["w-10", "w-8", "w-12", "w-9"].map((w, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-control border border-rule bg-paper-3 p-3">
            <i className="h-2 w-16 rounded-full bg-paper-5" /><i className={cn("h-5 rounded bg-ink-2/70", w)} /><i className="h-2 w-20 rounded-full bg-paper-4" />
          </div>
        ))}
      </div>
      <div className="flex flex-col rounded-control border border-rule bg-paper-3">
        {ACTS.map((a, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-rule px-3 py-2.5 last:border-0">
            <i className="size-7 shrink-0 rounded-full bg-paper-5" />
            <div className="flex w-28 flex-col gap-1.5"><i className="h-2.5 w-14 rounded-full bg-ink-2/60" /><i className="h-2 w-20 rounded-full bg-paper-5" /></div>
            <i className={cn("h-5 w-14 shrink-0 rounded-full", a === "buy" ? "bg-up/40" : a === "avoid" ? "bg-down/40" : "bg-warn/35")} />
            <i className="h-2 flex-1 rounded-full bg-paper-5" style={{ maxWidth: `${40 + ((i * 37) % 45)}%` }} />
            <i className="ml-auto h-2.5 w-12 shrink-0 rounded-full bg-paper-5 max-sm:hidden" />
          </div>
        ))}
      </div>
    </div>
  );
}

const Check = () => <svg viewBox="0 0 16 16" aria-hidden className="mt-0.5 size-4 shrink-0 text-up"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// what: "picks" (the AI picks page) or "read" (one coin's AI read tab, shorter).
const COPY = {
  picks: { title: "Unlock AI picks", lead: "and the AI's reads open up.", points: ["Buy, watch or avoid on today's coins, with the reason", "Every buy call this week, with entry and where it is now", "The full track record: win rate and average pick"] },
  read: { title: "Unlock AI reads", lead: "and every coin's AI read opens up, along with AI picks.", points: ["A full read of this coin: dev history, holders, socials and red flags", "Buy, watch or avoid, with the reason and a grade", "AI picks: today's calls and the AI's track record"] },
};
function Locked({ have, wallet, owner, onPeek, what = "picks" }: { have: number; wallet: boolean; owner: boolean; onPeek: () => void; what?: "picks" | "read" }) {
  const c = COPY[what];
  const [checking, setChecking] = useState(false);
  const left = Math.max(0, UNLOCK_USD - have), done = Math.min(1, have / UNLOCK_USD);
  const check = async () => { setChecking(true); try { await loadMe(); } finally { setChecking(false); } };
  return (
    <div className={cn("relative isolate overflow-hidden rounded-card border border-rule bg-paper-2", what === "read" ? "min-h-[520px]" : "min-h-[600px]")}>
      <Preview />
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--color-paper-2)_85%,transparent)_25%,color-mix(in_oklch,var(--color-paper-2)_30%,transparent)_100%)]" />
      <div className="absolute inset-0 grid place-items-center p-4">
        <section className="flex w-full max-w-[420px] flex-col gap-5 rounded-card border border-rule-2 bg-paper-2/95 p-6 shadow-sheet backdrop-blur-sm">
          <div className="flex flex-col gap-2">
            <span className="flex w-fit items-center gap-1.5 rounded-full border border-rule-2 bg-paper-3 px-2.5 py-1 text-xs font-medium text-ink-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-3"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
              Locked
            </span>
            <h2 className="text-2xl leading-tight font-bold tracking-tight">{c.title}</h2>
            <p className="text-md text-ink-2">Hold ${UNLOCK_USD} in your Blix wallet {c.lead} The money stays yours to trade with.</p>
          </div>
          <ul className="flex flex-col gap-2 text-md text-ink-2">
            {c.points.map((x) => <li key={x} className="flex gap-2.5"><Check />{x}</li>)}
          </ul>
          {wallet && (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted">Your wallet</span>
                <span className="num"><b className="font-semibold text-ink">${have.toFixed(2)}</b><span className="text-muted"> / ${UNLOCK_USD.toFixed(2)}</span></span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-paper-4"><div className="h-full rounded-full bg-up transition-[width] duration-500" style={{ width: `${done * 100}%` }} /></div>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {wallet
              ? <button onClick={() => openExchange("deposit")} className="flex h-11 w-full items-center justify-center rounded-full bg-ink text-md font-semibold text-on-fill transition-[background-color,transform] duration-100 hover:bg-focus active:scale-[0.98]">Deposit ${left.toFixed(left % 1 ? 2 : 0)}</button>
              : <a href="#/account" className="flex h-11 w-full items-center justify-center rounded-full bg-ink text-md font-semibold text-on-fill transition-[background-color,transform] duration-100 hover:bg-focus active:scale-[0.98]">Set up your wallet</a>}
            {wallet && (
              <button onClick={() => void check()} disabled={checking} className="flex h-10 w-full items-center justify-center gap-2 rounded-full border border-rule-2 text-sm font-medium text-ink-2 transition-colors duration-100 hover:bg-paper-3 hover:text-ink disabled:opacity-60">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("size-3.5", checking && "animate-spin")}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 4v5h-5" /></svg>
                {checking ? "Checking…" : "I've deposited, check again"}
              </button>
            )}
          </div>
          {owner && <button onClick={onPeek} className="-mt-1 self-center text-xs text-muted transition-colors hover:text-ink">Owner: open anyway</button>}
        </section>
      </div>
    </div>
  );
}

function Picks() {
  const { data: raw, error } = usePoll<J>("picks", 10000);
  const d = raw && { ...raw, watch: Array.isArray(raw.watch) ? raw.watch : [], calls: Array.isArray(raw.calls) ? raw.calls : [] };   // a list-less answer draws as empty
  const { data: all } = usePoll<J>("picks/all", 15000);
  const [say, setSay] = useState<"all" | "buy" | "watch" | "avoid">("all");
  if (!d) return <Page title="AI picks">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const s = d.status?.calls ?? {}, t = all?.totals;
  const reads = (d.watch as J[]).filter((w) => say === "all" || w.trade?.action === say);
  return (
    <Page title="AI picks" sub="What the AI said about today's coins after reading them in depth, and how its picks have done. Not advice.">
      <Kpis items={[
        ["Deep reads", s.deepReads24h ?? 0, "last 24 hours"],
        ["Said buy", s.saidBuy ?? 0, s.topConviction != null ? `best conviction ${s.topConviction} / ${s.threshold}` : `needs conviction ${s.threshold ?? "—"}`, s.saidBuy ? "text-up" : undefined],
        ["Said watch", s.saidWatch ?? 0, "wait for a better entry"],
        ["Said avoid", s.saidAvoid ?? 0, "skipped", s.saidAvoid ? "text-down" : undefined],
        ["Picks won", t ? `${t.winPct}%` : "—", t ? `${t.wins} of ${t.closed} closed above entry` : "", t ? (t.winPct >= 50 ? "text-up" : "text-down") : undefined],
        ["Average pick", t ? pct(t.avg) : "—", t ? `typical ${pct(t.median)}` : "", t ? toneX(t.avg) : undefined],
      ]} />
      {s.why && <p className="rounded-control border border-rule bg-paper-2 px-3 py-2 text-md text-ink-2">{s.why}</p>}

      <Panel title="Today's reads" aside={<Segmented value={say} options={[["all", "All"], ["buy", "Buy"], ["watch", "Watch"], ["avoid", "Avoid"]]} onChange={setSay} label="Which reads to show" />}>
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={th}>Grade</th><th className={th}>AI says</th><th className={thR}>Win odds</th><th className={th}>Why</th><th className={thR}>Cap now</th><th className={thR}>Read</th></tr></thead><tbody>
          {reads.length ? reads.map((w) => (
            <tr key={`${w.mint}${w.t}`} {...rowLink(`#/coin/${w.mint}`)} className="cursor-pointer hover:bg-paper-3/60">
              <td className={td}><CoinCell mint={w.mint} symbol={w.symbol} name={w.name} sub={w.tag} /></td>
              <td className={td}><b className={cn("font-semibold", gradeTone(w.grade))}>{w.grade || "—"}</b> <span className="num text-muted">{w.score}</span></td>
              <td className={cn(td, "font-semibold capitalize", actionTone(w.trade?.action))}>{w.trade?.action || "—"}</td>
              <td className={tdR}>{w.trade?.pWin != null ? `${w.trade.pWin}%` : "—"}</td>
              <td className={cn(td, "max-w-[34rem] whitespace-normal text-ink-2")}>{w.trade?.why || w.verdict}</td>
              <td className={tdR}>{money(w.mcap)}</td>
              <td className={cn(tdR, "text-muted")}>{ago(w.t)}</td>
            </tr>))
            : <tr><td colSpan={7}><Empty>{d.watch.length ? "No reads match." : "No deep reads yet today."}</Empty></td></tr>}
        </tbody></table></Scroll>
      </Panel>

      <Panel title="Buy calls" aside="last 7 days">
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={th}>Grade</th><th className={thR}>Conviction</th><th className={thR}>Entry cap</th><th className={thR}>Peak</th><th className={thR}>Now</th><th className={th}>Status</th><th className={thR}>Called</th></tr></thead><tbody>
          {d.calls.length ? (d.calls as J[]).map((c) => (
            <tr key={c.id} {...rowLink(`#/coin/${c.mint}`)} className="cursor-pointer hover:bg-paper-3/60">
              <td className={td}><CoinCell mint={c.mint} symbol={c.symbol} name={c.name} sub={c.tag} /></td>
              <td className={td}><b className={cn("font-semibold", gradeTone(c.grade))}>{c.grade || "—"}</b></td>
              <td className={tdR}>{c.conviction ?? "—"}</td>
              <td className={tdR}>{money(c.entry_mcap)}</td>
              <td className={cn(tdR, toneX(c.peak_mult))}>{mult(c.peak_mult)}</td>
              <td className={cn(tdR, "font-semibold", toneX(c.exit_mult ?? c.now_mult))}>{mult(c.exit_mult ?? c.now_mult)}</td>
              <td className={cn(td, "text-ink-2")}>{c.status === "open" ? "open" : c.exit_reason || c.status}</td>
              <td className={cn(tdR, "text-muted")}>{ago(c.t)}</td>
            </tr>))
            : <tr><td colSpan={8}><Empty>No buy calls this week. The AI only calls a buy above its conviction bar.</Empty></td></tr>}
        </tbody></table></Scroll>
      </Panel>

      <Panel title="Latest picks" aside={t ? `${t.n} picks · ${t.open} open` : undefined}>
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Coin</th><th className={th}>AI call</th><th className={thR}>Entry cap</th><th className={thR}>Peak</th><th className={thR}>Result</th><th className={th}>How it ended</th><th className={thR}>Picked</th></tr></thead><tbody>
          {all?.picks?.length ? (all.picks as J[]).slice(0, 40).map((p) => (
            <tr key={`${p.mint}${p.t}`} {...rowLink(`#/coin/${p.mint}`)} className="cursor-pointer hover:bg-paper-3/60">
              <td className={td}><CoinCell mint={p.mint} symbol={p.symbol} name={p.name} sub={p.tag} /></td>
              <td className={td}><b className={cn("font-semibold", gradeTone(p.grade))}>{p.grade || "—"}</b> <span className="text-muted">{p.action}</span></td>
              <td className={tdR}>{money(p.entry)}</td>
              <td className={cn(tdR, toneX(p.peak))}>{mult(p.peak)}</td>
              <td className={cn(tdR, "font-semibold", toneX(p.ruleX))}>{mult(p.ruleX)}</td>
              <td className={cn(td, "text-ink-2")}>{p.ruleClosed ? p.ruleWhy : "still open"}</td>
              <td className={cn(tdR, "text-muted")}>{ago(p.t)}</td>
            </tr>))
            : <tr><td colSpan={7}>{all ? <Empty>No picks yet.</Empty> : <Loading />}</td></tr>}
        </tbody></table></Scroll>
      </Panel>
    </Page>
  );
}
