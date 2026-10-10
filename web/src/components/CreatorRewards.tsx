// Creator rewards (on the Create coin page): what this wallet earns as the creator of pump.fun coins, like pump.fun's
// own rewards panel. Claimable now, lifetime earnings as a chart, one button to claim, and the coins it made.
// GET /api/account/rewards and POST /api/account/claim (server/accounts.js, server/creator.js -> Blix Vault).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PumpLogo, SolanaLogo } from "@/components/brand";
import { CoinImg } from "@/components/page";
import { Button } from "@/components/ui/button";
import { txToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import { usePulse } from "@/lib/pulse";
import { loadMe, useMe } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

interface Rewards {
  unclaimed: { curve: number; pool: number; total: number };
  earned: number; claimed: number; series: [number, number][]; partial: boolean;
  coins: { mint: string; t: number; status: string }[];
  claims: { t: number; sol: number; sig: string | null; status: string }[];
}
interface CoinInfo { symbol?: string; name?: string; mcap?: number | null; graduated?: boolean | number | null }

const POLL_MS = 30_000;
const sol = (n: number, d = 4) => (+n || 0).toLocaleString(undefined, { minimumFractionDigits: n ? Math.min(2, d) : 0, maximumFractionDigits: d });
const usd = (n: number) => (n >= 1 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 100 ? 2 : 0 })}` : n > 0 ? `$${n.toFixed(2)}` : "$0");
const mc = (n?: number | null) => (!n ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e4 ? 1 : 2)}K` : `$${Math.round(n)}`);
const day = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });

export function CreatorRewards() {
  const me = useMe((s) => s.me);
  const solUsd = usePulse((s) => s.live.solUsd) || 0;
  const [r, setR] = useState<Rewards | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("api/account/rewards", { signal: AbortSignal.timeout(60_000) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      if (!j?.unclaimed || !Array.isArray(j.series) || !Array.isArray(j.coins)) throw new Error("Rewards came back unreadable. Retrying…");
      setR(j); setErr(null);
    } catch (e) { setErr(e instanceof Error && e.name !== "TimeoutError" ? e.message : "Rewards did not load. Retrying…"); }
  }, []);
  useEffect(() => {
    if (!me?.signedIn || me.needsWallet) return;
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [me?.signedIn, me?.needsWallet, load]);

  const claim = async () => {
    if (!r || claiming) return;
    setClaiming(true);
    const t = txToast(`Claiming ${sol(r.unclaimed.total)} SOL`, "Creator rewards → your Blix wallet");
    try {
      const res = await fetch("api/account/claim", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(120_000) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      const link = j.signature ? `https://solscan.io/tx/${j.signature}` : undefined;
      if (j.status === "confirmed") t.ok(`Claimed ${sol(r.unclaimed.total)} SOL`, "In your Blix wallet now", link);
      else t.unknown("Claim sent — waiting for the network", j.note, link);
      loadMe(); load();
    } catch (e) { t.fail("Claim failed", e instanceof Error ? e.message : String(e)); }
    finally { setClaiming(false); }
  };

  const head = (
    <h2 className="flex items-center justify-between border-b border-rule px-4 py-2.5 text-sm font-medium text-muted">
      <span className="flex items-center gap-2"><Icon.crown className="size-3.5" />Creator rewards</span>
      <span className="flex items-center gap-1 text-xs"><PumpLogo className="size-3" />pump.fun fees</span>
    </h2>
  );
  if (!me?.signedIn || me.needsWallet) {
    return (
      <section className="overflow-hidden rounded-card border border-rule bg-paper-2" data-testid="creator-rewards">
        {head}
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <p className="max-w-sm text-sm text-muted">Every trade on a coin you launch pays you a creator fee. Sign in to see what you've earned, claim it, and track your coins.</p>
          {me && <Button variant="primary" asChild><a href="#/account">{me.signedIn ? "Set up your wallet" : "Sign in"}</a></Button>}
        </div>
      </section>
    );
  }

  const total = r?.unclaimed.total ?? 0, canClaim = total >= 0.00001;
  return (
    <section className="overflow-hidden rounded-card border border-rule bg-paper-2" data-testid="creator-rewards">
      {head}
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <span className="text-sm text-muted">Ready to claim</span>
            <b className="num flex items-center gap-2 text-3xl font-bold tracking-tight text-ink">
              <SolanaLogo className="size-6" />{r ? sol(total) : <span className="h-8 w-28 animate-pulse rounded-control bg-paper-4" />}
            </b>
            <span className="num text-sm text-muted">{r && solUsd ? usd(total * solUsd) : " "}</span>
          </div>
          <Button variant="primary" size="lg" className="min-w-36" disabled={!canClaim || claiming} onClick={claim} data-testid="claim-rewards">
            {claiming ? "Claiming…" : canClaim ? "Claim" : "Nothing to claim"}
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Earned" value={r ? sol(r.earned) : "…"} sub={r && solUsd ? usd(r.earned * solUsd) : ""} sol />
          <Stat label="Claimed" value={r ? sol(r.claimed) : "…"} sub={r && solUsd ? usd(r.claimed * solUsd) : ""} sol />
          <Stat label="Coins made" value={r ? String(r.coins.length) : "…"} sub={r?.coins.length ? `last ${day(r.coins[0].t)}` : "none yet"} />
        </div>

        <Chart series={r?.series || []} loading={!r} partial={!!r?.partial} />
        {err && <p className="flex items-center gap-2 text-sm text-down"><Icon.shield className="size-3.5 shrink-0" />{err}</p>}
      </div>

      <div className="border-t border-rule">
        <h3 className="px-4 pt-3 pb-1.5 text-sm font-medium text-muted">Your coins</h3>
        {!r ? <div className="mx-4 mb-4 h-12 animate-pulse rounded-control bg-paper-3" />
          : r.coins.length ? <ul className="pb-1">{r.coins.slice(0, 12).map((c) => <CoinRow key={c.mint} c={c} />)}</ul>
          : <p className="px-4 pb-4 text-sm text-muted">Coins you launch from this wallet show here, with what each one is worth.</p>}
      </div>
    </section>
  );
}

function Stat({ label, value, sub, sol: isSol }: { label: string; value: string; sub?: string; sol?: boolean }) {
  return (
    <div className="min-w-0 rounded-control border border-rule bg-paper px-3 py-2">
      <span className="block truncate text-xs text-muted">{label}</span>
      <b className="num flex items-center gap-1 truncate text-md font-semibold text-ink">{isSol && <SolanaLogo className="size-3 shrink-0" />}{value}</b>
      <span className="num block truncate text-xs text-muted">{sub || " "}</span>
    </div>
  );
}

// Lifetime earnings as an area chart, with the value under the pointer.
function Chart({ series, loading, partial }: { series: [number, number][]; loading: boolean; partial: boolean }) {
  const W = 600, H = 140, box = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const pts = useMemo(() => {
    if (series.length < 1) return [];
    // A flat start just before the first payment, and the line carried on to now.
    const s: [number, number][] = [[series[0][0] - 1, 0], ...series, [Math.max(Date.now(), series.at(-1)![0]), series.at(-1)![1]]];
    const t0 = s[0][0], t1 = s.at(-1)![0], top = Math.max(...s.map((p) => p[1])) || 1;
    return s.map(([t, v]) => ({ t, v, x: ((t - t0) / (t1 - t0 || 1)) * W, y: H - 6 - (v / top) * (H - 16) }));
  }, [series]);
  if (loading) return <div className="h-[140px] animate-pulse rounded-control bg-paper-3" />;
  if (pts.length < 2) {
    return (
      <div className="grid h-[140px] place-items-center rounded-control border border-dashed border-rule-2 bg-paper px-6 text-center text-sm text-muted">
        Your earnings chart starts with the first trade on a coin you made.
      </div>
    );
  }
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(""), h = hover != null ? pts[hover] : null;
  const move = (e: React.PointerEvent) => {
    const b = box.current?.getBoundingClientRect();
    if (!b) return;
    const x = ((e.clientX - b.left) / b.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].x - x) < Math.abs(pts[best].x - x)) best = i;
    setHover(best);
  };
  return (
    <div className="relative">
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[140px] w-full touch-none rounded-control bg-paper" onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label="Creator rewards earned over time">
        <defs><linearGradient id="cr-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--color-up)" stopOpacity="0.28" /><stop offset="1" stopColor="var(--color-up)" stopOpacity="0" /></linearGradient></defs>
        <path d={`${line}L${W},${H}L0,${H}Z`} fill="url(#cr-fill)" />
        <path d={line} fill="none" stroke="var(--color-up)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {h && <line x1={h.x} x2={h.x} y1="0" y2={H} stroke="var(--color-rule-2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="pointer-events-none absolute top-2 left-2.5 rounded-chip bg-paper-2/90 px-2 py-1 text-xs">
        {h ? <><b className="num text-ink">{sol(h.v)} SOL</b> <span className="text-muted">· {new Date(h.t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></>
          : <span className="text-muted">Earned over time{partial ? " · loading older trades" : ""}</span>}
      </div>
    </div>
  );
}

const infoCache = new Map<string, CoinInfo>();
function CoinRow({ c }: { c: Rewards["coins"][number] }) {
  const [info, setInfo] = useState<CoinInfo>(() => infoCache.get(c.mint) || usePulse.getState().coins[c.mint] || {});
  useEffect(() => {
    let live = true;
    api<{ token?: CoinInfo }>(`token/${c.mint}`).then((j) => { const t = j.token || {}; infoCache.set(c.mint, t); if (live) setInfo(t); }).catch(() => {});
    return () => { live = false; };
  }, [c.mint]);
  return (
    <li>
      <a href={`#/coin/${c.mint}`} className="flex items-center gap-3 px-4 py-2 hover:bg-paper-3/50">
        <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-chip bg-paper-4 text-2xs font-semibold text-muted uppercase">{(info.symbol || "?").slice(0, 3)}<CoinImg mint={c.mint} /></span>
        <span className="min-w-0 flex-1">
          <b className="block truncate font-semibold text-ink">{info.symbol ? `$${info.symbol}` : shortAddr(c.mint)}</b>
          <span className="block truncate text-sm text-muted">{info.name || " "}</span>
        </span>
        <span className="shrink-0 text-right">
          <b className="num block text-sm font-semibold text-ink">{mc(info.mcap)}</b>
          <span className={cn("block text-xs", c.status === "confirmed" ? "text-muted" : "text-warn")}>{info.graduated ? "PumpSwap · " : ""}{day(c.t)}</span>
        </span>
      </a>
    </li>
  );
}
