import { Icon } from "@/shell/icons";
import { useEffect, useMemo, useState } from "react";
import { Avatar, RANGES, short, signedShort, type Range } from "@/pages/traders/parts";
import { TrackWalletButton } from "./TrackWalletButton";
import { fromFomo, fromPump, useTraderDirectory } from "@/lib/traders";
import { social, type FollowRow, type Profile } from "@/lib/social";
import { api } from "@/lib/api";
import { saveTrackedWallet, useTracking } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { toast } from "./ui/toast";

type Source = "all" | "fomo" | "pump" | "following";
type Choice = { key: string; name: string; sub: string; wallet: string | null; pic: string | null; pnl: number | null; href: string; source: string; handle?: string };
export function TraderPicker() {
  const [range, setRange] = useState<Range>("24h"), [source, setSource] = useState<Source>("all"), [query, setQuery] = useState("");
  const [grp, setGrp] = useState(1), [limit, setLimit] = useState(40);
  const { all, fomo, pump } = useTraderDirectory(range);
  const { role } = useTracking();
  const [following, setFollowing] = useState<FollowRow[] | null>(null), [followError, setFollowError] = useState<string | null>(null), [retry, setRetry] = useState(0);
  const [resolved, setResolved] = useState<Record<string, string>>({}), [resolving, setResolving] = useState<string | null>(null);
  useEffect(() => {
    if (source !== "following" || role === "visitor") return;
    let active = true; setFollowError(null);
    social<Profile>("profile").then(p => social<{ list: FollowRow[] }>(`u/${encodeURIComponent(p.username)}/follows?dir=following`))
      .then(r => { if (active) setFollowing(r.list); }).catch((e: Error) => { if (active) setFollowError(e.message); });
    return () => { active = false; };
  }, [source, role, retry]);
  useEffect(() => { setLimit(40); }, [query, source, range]);
  const choices = useMemo(() => {
    const fomoRows = (fomo.data?.rows || []).map(fromFomo);
    const pool = source === "fomo" ? fomoRows : source === "pump" ? (range === "all-time" ? [] : (pump.data?.rows || []).map(fromPump)) : [...all, ...fomoRows.filter(t => !t.wallet)];
    let rows: Choice[] = pool.map(t => ({ ...t, wallet: t.wallet || resolved[t.sub.replace(/^@/, "")] || null, href: t.href || `#/trader/${t.wallet}`, handle: t.source === "fomo" && t.sub.startsWith("@") ? t.sub.slice(1) : undefined }));
    if (source === "following") rows = (following || []).map(f => {
      if (f.kind === "user") return { key: `user:${f.id}`, name: f.display || f.username, sub: `@${f.username}`, pic: f.avatar, wallet: f.address, pnl: null, href: `#/u/${f.username}`, source: "Blix" };
      if (f.kind === "wallet") {
        const known = all.find(t => t.wallet === f.target);
        return { key: f.target, name: known?.name || short(f.target), sub: short(f.target), pic: known?.pic || null, wallet: f.target, pnl: known?.pnl ?? null, href: `#/trader/${f.target}`, source: "Wallet" };
      }
      const known = all.find(t => t.sub.toLowerCase() === `@${f.target}`.toLowerCase());
      return { key: `trader:${f.target}`, name: known?.name || `@${f.target}`, sub: `@${f.target}`, pic: known?.pic || null, wallet: known?.wallet || resolved[f.target] || null, pnl: known?.pnl ?? null, href: `#/trader/${f.target}`, source: "Fomo", handle: f.target };
    });
    const unique = new Map<string, Choice>();
    for (const row of rows) if (!unique.has(row.wallet || row.key)) unique.set(row.wallet || row.key, row);
    const q = query.trim().toLowerCase();
    return [...unique.values()].filter(t => !q || `${t.name} ${t.sub} ${t.wallet || ""}`.toLowerCase().includes(q));
  }, [all, fomo.data, pump.data, range, source, following, resolved, query]);
  const waiting = source === "following" ? !following && !followError && role !== "visitor" : !fomo.data && !pump.data && !fomo.error && !pump.error;
  const problems = source === "following" ? followError : [fomo.error, fomo.data?.status?.error, pump.error, pump.data?.error].filter(Boolean).join(" · ");
  return <section aria-label="Find traders" className="flex flex-col">
    <div className="wt-picker-head"><div className="wt-picker-heading"><b>Find your next trader</b><span>{choices.length} to explore</span><a href="#/traders">Full leaderboard ↗</a></div>
      <div className="wt-picker-search">
        <label><Icon.search /><input aria-label="Search traders" placeholder="Search name, handle or wallet" value={query} onChange={e => setQuery(e.target.value)} className="wt-field" /></label>
        <select aria-label="Trader period" value={range} onChange={e => setRange(e.target.value as Range)} className="wt-field">{RANGES.map(([r, label]) => <option key={r} value={r}>{label}</option>)}</select>
        <select aria-label="Add to group" value={grp} onChange={e => setGrp(Number(e.target.value))} className="wt-field">{[1, 2, 3].map(g => <option key={g} value={g}>Add to P{g}</option>)}</select>
      </div>
      <div className="wt-picker-filters">{([["all", "All traders"], ["fomo", "Fomo"], ["pump", "pump.fun"], ["following", "Following"]] as const).map(([id, text]) => <button key={id} aria-pressed={source === id} onClick={() => setSource(id)} className={cn("rounded-control px-2.5 py-1.5 text-xs font-semibold", source === id ? "bg-paper-5 text-ink" : "text-muted hover:text-ink")}>{text}</button>)}</div>
    </div>
    {problems && <p role="alert" className="px-3 py-2 text-sm text-warn">{source === "following" ? problems : "Some trader data is unavailable. Showing the traders we could load."} <button className="underline" onClick={() => { setRetry(x => x + 1); fomo.refresh(); pump.refresh(); }}>Retry</button></p>}
    {waiting ? <p role="status" className="p-6 text-center text-sm text-muted">Finding traders…</p> : !choices.length ? <div className="p-6 text-center text-sm text-muted">{source === "following" ? role === "visitor" ? <a href="#/account" className="underline">Sign in to see people you follow.</a> : "People you follow on their profiles appear here." : query ? "No traders match. Try another name or paste a wallet in Manager." : "No traders available for this period yet."}</div> : choices.slice(0, limit).map((t, index) => <div key={t.key} className="wt-picker-row">
      <span className="wt-rank">{index + 1}</span>
      <Avatar src={t.pic} name={t.name} size={30} />
      <a href={t.href} className="min-w-0 flex-1"><b className="block truncate text-sm font-semibold">{t.name}</b><span className="block truncate text-xs text-muted">{t.sub}{t.wallet && t.sub !== short(t.wallet) ? ` · ${short(t.wallet)}` : !t.wallet ? " · Find trading wallet" : ""}</span></a>
      {t.pnl != null && <span className={cn("wt-picker-pnl", t.pnl >= 0 ? "text-up" : "text-down")}>{signedShort(t.pnl)}<small>{RANGES.find(([r]) => r === range)?.[1]} PnL</small></span>}
      {t.wallet ? <TrackWalletButton address={t.wallet} name={t.name} pic={t.pic} grp={grp} /> : t.handle ? <button className="wt-track-button disabled:opacity-50" disabled={resolving === t.handle} onClick={async () => {
        if (role === "visitor") { toast("Sign in to track wallets"); location.hash = "/account"; return; }
        setResolving(t.handle!);
        try { const p = await api<{ wallet: string | null }>(`fomo/trader/${encodeURIComponent(t.handle!)}`); if (!p.wallet) throw new Error("Their trading wallet is not available yet. Try their profile later."); setResolved(s => ({ ...s, [t.handle!]: p.wallet! })); await saveTrackedWallet({ address: p.wallet, name: t.name, grp }); toast(`Tracking ${t.name}`); }
        catch (e) { toast((e as Error).message); } finally { setResolving(null); }
      }}>{resolving === t.handle ? "Finding…" : "Track"}</button> : <span className="text-xs text-muted">No public wallet</span>}
    </div>)}
    {choices.length > limit && <button onClick={() => setLimit(n => n + 40)} className="p-3 text-sm font-semibold text-ink-2 hover:bg-paper-3">Show more traders ({choices.length - limit} remaining)</button>}
  </section>;
}
