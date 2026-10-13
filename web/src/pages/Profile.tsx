// People (#/u) and one person's page (#/u/<username>): banner, picture, bio, follow button, then what their
// wallet holds, what it traded, who they follow (Blix accounts, Fomo traders, wallets) and who follows them.
// Talks to /api/account/* (server/social.js).
import { useMarkedHoldings } from "@/lib/live-wallet";
import { SiteLogo } from "@/components/logos";
import { useCallback, useEffect, useState } from "react";
import { ago, CoinImg, Empty, Page, Problem, td, tdR, th, thR } from "@/components/page";
import { FollowButton } from "@/components/follow";
import { TrackWalletButton } from "@/components/TrackWalletButton";
import { Segmented } from "@/components/ui/segmented";
import { shortAddr } from "@/lib/format";
import { useRouteArg } from "@/lib/route";
import { social, useCoinNames, type FollowRow, type Profile as P, type UserPage } from "@/lib/social";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Sol } from "@/shell/Rail";
import { Avatar, EditProfile, ProfileHero, userHref } from "./profile/parts";

const usd = (n: number | null | undefined) => n == null ? "—" : `$${(+n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 4 });
const panel = "overflow-hidden rounded-card border border-rule bg-paper-2";

export function Profile() {
  const arg = decodeURIComponent(useRouteArg());
  return arg ? <UserView username={arg} key={arg} /> : <People />;
}

function People() {
  const [q, setQ] = useState(""), [people, setPeople] = useState<P[] | null>(null), [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => social<{ people: P[] }>(`people${q ? `?q=${encodeURIComponent(q)}` : ""}`).then((r) => { setPeople(r.people); setError(""); }).catch((e) => setError(e.message)), q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Page title="People" sub="Everyone trading on Blix. Follow someone to keep their holdings and trades a click away."
      right={<SearchPeople value={q} onChange={setQ} />}>
      {error && <Problem text={error} />}
      {!people ? <div className="h-48 animate-pulse rounded-card border border-rule bg-paper-2" />
        : !people.length ? <p className={cn(panel, "px-4 py-12 text-center text-md text-muted")}>{q ? "Nobody matches." : "Nobody has signed in to Blix yet."}</p>
        : <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3 max-md:grid-cols-1">{people.map((p) => <PersonCard key={p.id} p={p} />)}</div>}
    </Page>
  );
}

const SearchPeople = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <label className="flex h-9 w-64 items-center gap-2 rounded-full border border-rule bg-paper px-3 focus-within:border-accent-dim max-sm:w-full">
    <Icon.search className="size-4 text-muted" />
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Search people" className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
  </label>
);

function PersonCard({ p }: { p: P }) {
  return (
    <a href={userHref(p.username)} className={cn(panel, "group flex flex-col transition-colors hover:border-rule-2")}>
      <div className="h-16 bg-paper-4 bg-cover bg-center" style={p.banner ? { backgroundImage: `url("${p.banner}")` } : undefined} />
      <div className="flex items-start gap-3 px-4 pb-4">
        <Avatar p={p} size={56} className="relative z-10 -mt-7 border-4 border-paper-2" />
        <div className="min-w-0 flex-1 pt-2">
          <b className="block truncate text-md font-semibold text-ink group-hover:text-focus">{p.display}</b>
          <span className="block truncate text-sm text-muted">@{p.username} · <span className="num">{p.followers}</span> followers</span>
          {p.bio && <p className="mt-1.5 line-clamp-2 text-sm text-ink-2">{p.bio}</p>}
        </div>
        <span className="pt-3">{p.isMe ? <span className="text-sm text-muted">You</span> : <FollowButton kind="user" target={p.id} initial={p.following} size="sm" />}</span>
      </div>
    </a>
  );
}

type Tab = "holdings" | "activity" | "following" | "followers";
export function UserView({ username, onMine }: { username: string; onMine?: boolean }) {
  const [d, setD] = useState<UserPage | null>(null), [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("holdings"), [editing, setEditing] = useState(false);
  const load = useCallback(() => social<UserPage>(`u/${encodeURIComponent(username)}`).then((r) => { if (!r?.profile) throw new Error("This profile came back unreadable. Try again."); setD(r); setError(""); }).catch((e) => setError(e.message)), [username]);
  useEffect(() => { load(); }, [load]);

  if (error && !d) return <div className="mx-auto w-full max-w-[1700px] p-3"><Problem text={error} /></div>;
  if (!d) return <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-3 p-3"><div className="h-80 animate-pulse rounded-card border border-rule bg-paper-2" /></div>;
  const p = d.profile, hidden = !p.showHoldings && !p.isMe;
  const tabs: [Tab, string][] = [["holdings", "Holdings"], ["activity", "Trades"], ["following", `Following ${p.follows}`], ["followers", `Followers ${p.followers}`]];

  return (
    <div className={cn("mx-auto flex w-full max-w-[1700px] flex-col gap-3", !onMine && "p-3 max-md:pb-6")}>
      <ProfileHero p={p} onEdit={() => setEditing(true)} tabs={setTab}
        onCounts={(followers) => setD({ ...d, profile: { ...p, followers } })}
        actions={p.isMe && !onMine ? <a href="#/account" className="flex h-8 items-center rounded-full border border-rule-2 px-3.5 text-md font-semibold text-ink-2 hover:text-ink">Wallet</a> : !p.isMe && p.address ? <TrackWalletButton address={p.address} name={p.display || p.username} /> : null} />
      {p.isMe && <EditProfile key={String(editing)} p={p} open={editing} onOpenChange={setEditing} onSaved={(np) => { setD({ ...d, profile: np }); if (np.username !== username) location.hash = userHref(np.username); }} />}
      <Segmented label="Profile section" value={tab} options={tabs} onChange={setTab} />
      {tab === "holdings" && (hidden ? <Private /> : <HoldingsTable d={d} />)}
      {tab === "activity" && (hidden ? <Private /> : <Trades d={d} />)}
      {(tab === "following" || tab === "followers") && <Follows username={p.username} dir={tab} key={`${tab}:${p.followers}:${p.follows}`} />}
    </div>
  );
}

const Private = () => <p className={cn(panel, "px-4 py-12 text-center text-md text-muted")}>This person keeps their holdings and trades private.</p>;

function HoldingsTable({ d }: { d: UserPage }) {
  const h = useMarkedHoldings(d.holdings), names = useCoinNames(h?.tokens.map((t) => t.mint) || []);
  if (!h) return <p className={cn(panel, "px-4 py-12 text-center text-md text-muted")}>{d.problem ? `The wallet could not be read right now (${d.problem}).` : "No wallet yet."}</p>;
  const tokens = [...h.tokens].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)), total = h.solUsd + h.tokensUsd;
  return (
    <section className={panel}>
      <div className="grid grid-cols-3 divide-x divide-rule border-b border-rule max-sm:grid-cols-1 max-sm:divide-x-0 max-sm:divide-y">
        {[["Total value", usd(total)], ["SOL", <span key="s" className="flex items-center gap-1.5"><Sol className="size-4" />{num(h.sol)}</span>], ["In coins", `${usd(h.tokensUsd)} · ${h.tokens.length}`]].map(([l, v]) => (
          <div key={String(l)} className="px-4 py-3"><span className="text-sm text-muted">{l}</span><b className="num mt-0.5 block text-xl font-semibold">{v}</b></div>
        ))}
      </div>
      {!tokens.length ? <Empty>No coins held right now.</Empty> : (
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr><th className={th}>Coin</th><th className={thR}>Amount</th><th className={thR}>Value</th><th className={thR}>Share</th></tr></thead>
          <tbody>{tokens.map((t) => { const n = names(t.mint); return (
            <tr key={t.mint} className="hover:bg-paper-3/50">
              <td className={td}><a href={`#/coin/${t.mint}`} className="flex items-center gap-2.5 hover:text-ink">
                <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-chip bg-paper-4 text-2xs font-semibold text-muted uppercase">{(n.symbol || "?").slice(0, 3)}<CoinImg mint={t.mint} /></span>
                <span className="min-w-0"><b className="block font-semibold text-ink">{n.symbol || shortAddr(t.mint)}</b><span className="block max-w-56 truncate text-sm text-muted">{n.name || ""}</span></span></a></td>
              <td className={tdR}>{num(t.ui)}</td><td className={tdR}>{usd(t.usd)}</td>
              <td className={tdR}>{total && t.usd != null ? `${((t.usd / total) * 100).toFixed(1)}%` : "—"}</td>
            </tr>); })}</tbody>
        </table></div>
      )}
    </section>
  );
}

function Trades({ d }: { d: UserPage }) {
  const names = useCoinNames(d.activity.map((t) => t.mint).filter(Boolean) as string[]);
  if (!d.activity.length) return <p className={cn(panel, "px-4 py-12 text-center text-md text-muted")}>No trades yet.</p>;
  return (
    <section className={panel}><div className="overflow-x-auto"><table className="w-full">
      <thead><tr><th className={th}>Trade</th><th className={th}>Coin</th><th className={thR}>SOL</th><th className={thR}>When</th><th className={thR}></th></tr></thead>
      <tbody>{d.activity.map((t, i) => { const n = t.mint ? names(t.mint) : {}; return (
        <tr key={t.sig || i} className="hover:bg-paper-3/50">
          <td className={td}><span className={cn("font-semibold capitalize", t.kind === "buy" ? "text-up" : t.kind === "sell" ? "text-down" : "text-info")}>{t.kind === "launch" ? "Created" : t.kind}</span></td>
          <td className={td}>{t.mint ? <a href={`#/coin/${t.mint}`} className="flex items-center gap-2 hover:text-ink">
            <span className="relative grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-paper-4 text-[9px] font-semibold text-muted uppercase">{(n.symbol || "?").slice(0, 2)}<CoinImg mint={t.mint} /></span>
            <b className="font-semibold text-ink">{n.symbol || shortAddr(t.mint)}</b></a> : "—"}</td>
          <td className={tdR}><span className="inline-flex items-center gap-1.5"><Sol className="size-3.5" />{t.sol == null ? "—" : num(Math.abs(t.sol))}</span></td>
          <td className={cn(tdR, "text-muted")}>{ago(t.t)}</td>
          <td className={tdR}>{t.sig && <a href={`https://solscan.io/tx/${t.sig}`} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" aria-label="View on Solscan" title="View on Solscan"><SiteLogo site="solscan" className="inline size-4" /></a>}</td>
        </tr>); })}</tbody>
    </table></div></section>
  );
}

function Follows({ username, dir }: { username: string; dir: "following" | "followers" }) {
  const [list, setList] = useState<FollowRow[] | null>(null), [error, setError] = useState("");
  useEffect(() => { social<{ list: FollowRow[] }>(`u/${encodeURIComponent(username)}/follows?dir=${dir}`).then((r) => setList(r.list)).catch((e) => setError(e.message)); }, [username, dir]);
  if (error) return <Problem text={error} />;
  if (!list) return <div className="h-32 animate-pulse rounded-card border border-rule bg-paper-2" />;
  if (!list.length) return <p className={cn(panel, "px-4 py-12 text-center text-md text-muted")}>{dir === "followers" ? "No followers yet." : "Not following anyone yet. Follow people from their profile, or traders from the leaderboard."}</p>;
  return (
    <section className={cn(panel, "divide-y divide-rule")}>
      {list.map((f) => f.kind === "user" ? (
        <a key={`u${f.id}`} href={userHref(f.username)} className="flex items-center gap-3 px-4 py-3 hover:bg-paper-3/50">
          <Avatar p={f} size={42} />
          <span className="min-w-0 flex-1"><b className="block truncate font-semibold text-ink">{f.display}</b><span className="block truncate text-sm text-muted">@{f.username}{f.bio ? ` · ${f.bio}` : ""}</span></span>
          {!f.isMe && <FollowButton kind="user" target={f.id} initial={f.following} size="sm" />}
        </a>
      ) : (
        <a key={`${f.kind}${f.target}`} href={f.kind === "trader" ? `#/trader/${encodeURIComponent(f.target)}` : `https://solscan.io/account/${f.target}`}
          {...(f.kind === "wallet" ? { target: "_blank", rel: "noreferrer" } : {})} className="flex items-center gap-3 px-4 py-3 hover:bg-paper-3/50">
          <span className="grid size-[42px] shrink-0 place-items-center rounded-full bg-paper-4 text-ink-2">{f.kind === "trader" ? <Icon.crown className="size-5" /> : <Icon.wallets className="size-5" />}</span>
          <span className="min-w-0 flex-1"><b className="block truncate font-semibold text-ink">{f.kind === "trader" ? `@${f.target}` : shortAddr(f.target)}</b>
            <span className="block text-sm text-muted">{f.kind === "trader" ? "Fomo trader" : "Wallet"} · followed {ago(f.t)}</span></span>
          <FollowButton kind={f.kind} target={f.target} initial={f.following} size="sm" />
        </a>
      ))}
    </section>
  );
}
