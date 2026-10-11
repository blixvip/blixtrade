// The strip along the bottom of every page, laid out like Axiom's: connection, settings, Watchlist, Wallets,
// PnL, Activity, then Pulse, Discover and Alerts (named as the side rail names those pages),
// the live feed's pace, BTC/ETH/SOL prices, and links.
// Each item maps to the Blix page or figure that does the same job; the small windows (Watchlist, PnL, Feed,
// Alerts) open upward and only ask the server while they are open. Desktop only (phones keep the bottom tabs).
import { useEffect, useRef, useState, type ReactNode, type SVGProps } from "react";
import { PumpLogo, SolanaLogo } from "@/components/brand";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { ageStr, compact, pct, shortAddr, tone } from "@/lib/format";
import { loadPaperWallet, useTrade } from "@/lib/mode";
import { usePulse } from "@/lib/pulse";
import { useRoute, useRouteArg, pageHref } from "@/lib/route";
import { loadMe, useDesktop, useMe } from "@/lib/ui";
import { cn, store } from "@/lib/utils";
import { Icon } from "./icons";
import { LiveMc } from "@/components/Live";
import { thumb } from "@/lib/thumb";
import { useRole } from "@/lib/role";
import { SLOW_MS, useNet, watchNet } from "@/lib/net";

const I = (d: ReactNode) => ({ className, ...p }: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("shrink-0", className)} {...p}>{d}</svg>
);
const Ico = {
  bars: I(<path d="M5 18v-3M10 18v-6M15 18v-9M20 18V6" />),
  bell: I(<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />),
  pnl: I(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  feed: I(<><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" /></>),
  trend: I(<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />),
  alpha: I(<path d="M18 6c-2 0-3.5 2.5-5 6s-3 6-5.5 6A3.5 3.5 0 0 1 4 14.5C4 10 7 6 10.5 6c3 0 4 4 5 8s1.5 4 2.5 4" />),
  callout: I(<path d="M3 11l14-6v14L3 13zM11.6 16.8a3 3 0 1 1-5.8-1.6" />),
  docs: I(<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />),
  x: I(<path fill="currentColor" stroke="none" d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.47 21H2.4l7.17-8.2L2 3h6.33l4.37 5.77zm-1.08 16.18h1.7L7.4 4.73H5.58z" />),
  discord: I(<path fill="currentColor" stroke="none" d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.85a13.7 13.7 0 0 0-.63 1.29 18.4 18.4 0 0 0-5.53 0 13 13 0 0 0-.64-1.29 19.7 19.7 0 0 0-4.92 1.52C.57 9.05-.27 13.6.15 18.1a19.9 19.9 0 0 0 6.03 3.05c.49-.66.92-1.36 1.29-2.1a12.9 12.9 0 0 1-2.03-.97c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.12 0c.16.13.33.26.5.38-.65.38-1.33.71-2.04.97.37.74.8 1.44 1.29 2.1a19.8 19.8 0 0 0 6.04-3.05c.5-5.2-.84-9.72-3.53-13.73M8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42s.96-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.34-.96 2.42-2.16 2.42m7.97 0c-1.18 0-2.15-1.08-2.15-2.42s.95-2.42 2.15-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42" />),
};

// BTC and ETH in their own colours, like Axiom's strip (brand marks, not interface colour).
const Btc = () => <span className="grid size-3.5 place-items-center rounded-full bg-[#F7931A] text-[9px] font-bold text-black">₿</span>;
const Eth = () => <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden><path fill="#8A92B2" d="M12 2 5.5 12.3 12 16l6.5-3.7z" /><path fill="#62688F" d="M12 17.2 5.5 13.5 12 22l6.5-8.5z" /></svg>;

// Blix's socials, at the end of the bar. The Discord invite is still to come: until then its icon only says so.
const X_URL = "https://x.com/blix_vip";
const DISCORD_URL = "https://discord.gg/3VWHBP6paA";
const item = "flex h-full items-center gap-1.5 px-2 text-xs whitespace-nowrap text-ink-2 transition-colors duration-100 hover:bg-paper-3 hover:text-ink";

// A small window that opens upward from its button and closes on a click anywhere else.
function Pop({ label, icon, children, width = "w-80", badge }: { label: string; icon: ReactNode; children: (open: boolean) => ReactNode; width?: string; badge?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative h-full">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className={cn(item, open && "bg-paper-3 text-ink")}>{icon}<span className="max-xl:sr-only">{label}</span>{badge}</button>
      {open && (
        <div className={cn("absolute bottom-full left-0 z-50 mb-1 overflow-hidden rounded-card border border-rule-2 bg-paper-2 shadow-raised", width)}>
          <header className="border-b border-rule px-3 py-2 text-sm font-semibold">{label}</header>
          <div className="max-h-96 overflow-y-auto">{children(open)}</div>
        </div>
      )}
    </div>
  );
}
const Empty = ({ children }: { children: ReactNode }) => <p className="px-3 py-6 text-center text-sm text-muted">{children}</p>;

// ---------- connection ----------
function Connection() {
  const connected = usePulse((s) => s.connected), polling = usePulse((s) => s.polling);
  const ms = useNet((s) => s.ms), net = useNet((s) => s.state);
  useEffect(watchNet, []);
  const state = (!connected && !polling) || ms == null || net === "offline" ? "Offline" : net === "slow" || ms > SLOW_MS ? "Slow" : connected ? "Stable" : "Polling";
  const col = state === "Stable" || state === "Polling" ? "text-up" : state === "Slow" ? "text-warn" : "text-down";
  return (
    <Tip tip={state === "Offline" ? "Not connected to the radar" : state === "Polling" ? `Live, refreshed every 2 s (the live stream cannot get through this connection) · ${ms} ms to the server` : `Live feed connected · ${ms} ms to the server`}>
      <span className={cn(item, col, "hover:bg-transparent")}><Ico.bars className="size-3.5" />{state}</span>
    </Tip>
  );
}

// ---------- watchlist ----------
type Star = { mint: string; symbol: string };
const loadStars = () => store.get<Star[]>("watchlist", []);
function Watchlist() {
  const [stars, setStars] = useState<Star[]>(loadStars);
  const route = useRoute(), arg = useRouteArg();
  const here = route === "coin" && arg ? arg : null;
  const coin = usePulse((s) => (here ? s.coins[here] : undefined));
  const save = (v: Star[]) => { setStars(v); store.set("watchlist", v); };
  // A star pressed elsewhere (Discover's coin card) shows here at once.
  useEffect(() => { const on = () => setStars(loadStars()); addEventListener("blix:watchlist", on); return () => removeEventListener("blix:watchlist", on); }, []);
  return (
    <Pop label="Watchlist" icon={<Icon.star className="size-3.5" />} badge={stars.length ? <em className="num text-2xs not-italic text-muted">{stars.length}</em> : null}>
      {(open) => <WatchRows open={open} stars={stars} here={here} hereSymbol={coin?.symbol || null} onSave={save} />}
    </Pop>
  );
}
function WatchRows({ open, stars, here, hereSymbol, onSave }: { open: boolean; stars: Star[]; here: string | null; hereSymbol: string | null; onSave: (v: Star[]) => void }) {
  const { data } = usePoll<{ rows: Record<string, { mc: number | null; chg: number | null; live?: { mc: number | null } | null }> }>(open && stars.length ? `sparks?w=1h&m=${stars.map((s) => s.mint).join(",")}` : null, 3000);
  const has = here && stars.some((s) => s.mint === here);
  return (
    <>
      {here && (
        <button onClick={async () => {
          if (has) return onSave(stars.filter((s) => s.mint !== here));
          // The ticker from the live Pulse data, else asked once (a coin page can be open for a coin Pulse never listed).
          const symbol = hereSymbol || (await api<{ token?: { symbol?: string } }>(`token/${here}`).then((r) => r.token?.symbol).catch(() => null)) || shortAddr(here);
          onSave([{ mint: here, symbol }, ...stars].slice(0, 50));
        }}
          className="flex w-full items-center gap-2 border-b border-rule px-3 py-2 text-left text-sm text-accent hover:bg-paper-3">
          <Icon.star className="size-3.5" />{has ? "Remove this coin" : "Add this coin"}
        </button>
      )}
      {!stars.length ? <Empty>No coins yet. Open a coin and add it here.</Empty> : stars.map((s) => {
        const r = data?.rows[s.mint], mc = r?.live?.mc ?? r?.mc ?? null;
        return (
          <div key={s.mint} className="group flex items-center gap-2 px-3 py-2 text-sm hover:bg-paper-3">
            <a href={`#/coin/${s.mint}`} className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <b className="truncate font-semibold">${s.symbol}</b>
              <span className="num flex gap-2"><LiveMc mint={s.mint} value={mc} className="font-normal text-ink-2" /><span className={tone(r?.chg)}>{pct(r?.chg)}</span></span>
            </a>
            <button aria-label="Remove" onClick={() => onSave(stars.filter((x) => x.mint !== s.mint))} className="text-muted opacity-0 group-hover:opacity-100 hover:text-down">×</button>
          </div>
        );
      })}
    </>
  );
}

// ---------- PnL ----------
function Pnl() {
  const wallet = useTrade((s) => s.wallet), me = useMe((s) => s.me);
  return (
    <Pop label="PnL" icon={<Ico.pnl className="size-3.5" />} width="w-72">
      {() => <PnlBody wallet={wallet} me={me} />}
    </Pop>
  );
}
function PnlBody({ wallet, me }: { wallet: ReturnType<typeof useTrade.getState>["wallet"]; me: ReturnType<typeof useMe.getState>["me"] }) {
  useEffect(() => { loadPaperWallet(); if (!me) loadMe(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const row = (k: string, v: ReactNode) => <div className="flex justify-between px-3 py-1.5 text-sm"><span className="text-muted">{k}</span><span className="num">{v}</span></div>;
  return (
    <div className="py-1">
      <p className="px-3 pt-1 text-2xs font-semibold tracking-wide text-muted uppercase">Paper</p>
      {wallet ? <>
        {row("Value", `${wallet.equity.toFixed(3)} of ${wallet.start} SOL`)}
        {row("Profit / loss", <span className={tone(wallet.pnl)}>{wallet.pnl >= 0 ? "+" : "−"}{Math.abs(wallet.pnl).toFixed(3)} SOL</span>)}
        {row("Open positions", wallet.open)}
      </> : <Empty>Loading…</Empty>}
      <p className="border-t border-rule px-3 pt-2 text-2xs font-semibold tracking-wide text-muted uppercase">Real wallet</p>
      {me?.signedIn && me.wallet ? row("Balance", `${me.wallet.sol.toFixed(4)} SOL`) : <p className="px-3 py-1.5 text-sm text-muted">Not signed in</p>}
      <a href="#/account" className="mt-1 block border-t border-rule px-3 py-2 text-sm text-accent hover:bg-paper-3">Open Portfolio ›</a>
    </div>
  );
}

// ---------- feed (what the radar just did) and alerts (its latest signals) ----------
type Ev = { id: number; t: number; kind: string; text: string };
const KIND: Record<string, string> = { research: "AI read", discover: "Found", brief: "Brief", wallet: "Wallet", signal: "Signal" };
// The radar's log lines, readable: "$X fast D in 3357ms (model, sources 129ms): Too early" → "$X graded D: Too early".
const plain = (t: string) => t.replace(/ in \d+ms \([^)]*\)/, "").replace(/^(\$\S+) (?:fast|deep) ([A-F][+-]?):/, "$1 graded $2:");
// What the radar itself just did (AI reads, discovery, briefs): its activity log, not a social feed.
function Feed() {
  return <Pop label="Activity" icon={<Ico.feed className="size-3.5" />} width="w-[26rem]">{(open) => <FeedRows open={open} />}</Pop>;
}
type XP = { id: string; handle: string; name: string; avatar: string | null; t: number; text: string; mints: string[] };
// Feed: posts from the accounts in the X tracker (like Axiom's), and what the radar itself just did.
function FeedRows({ open }: { open: boolean }) {
  const [tab, setTab] = useState<"x" | "radar">(() => store.get("feed:tab", "x"));
  const pick = (t: "x" | "radar") => { setTab(t); store.set("feed:tab", t); };
  return (
    <>
      <div className="flex gap-1 border-b border-rule px-2 py-1.5">
        {(["x", "radar"] as const).map((t) => <button key={t} onClick={() => pick(t)} className={cn("rounded-chip px-2 py-0.5 text-xs", tab === t ? "bg-paper-4 font-semibold text-ink" : "text-muted hover:text-ink")}>{t === "x" ? "X posts" : "Radar"}</button>)}
      </div>
      {tab === "x" ? <XRows open={open} /> : <RadarRows open={open} />}
    </>
  );
}
function XRows({ open }: { open: boolean }) {
  const { data } = usePoll<{ posts: XP[]; accounts: unknown[] }>(open ? "x?limit=30" : null, 5000);
  if (!data) return <Empty>Loading…</Empty>;
  if (!data.accounts.length) return <Empty><a href="#/x" className="text-accent">Add X accounts to track ›</a></Empty>;
  if (!data.posts.length) return <Empty>No posts yet.</Empty>;
  return <>
    {data.posts.map((p) => (
      <a key={p.id} href={p.mints[0] ? `#/coin/${p.mints[0]}` : `https://x.com/${p.handle}/status/${p.id}`} target={p.mints[0] ? undefined : "_blank"} rel="noopener noreferrer" className="flex gap-2 border-b border-rule px-3 py-2 text-sm hover:bg-paper-3">
        {p.avatar ? <img src={thumb(p.avatar, 24)} alt="" className="size-6 shrink-0 rounded-full" /> : <span className="size-6 shrink-0 rounded-full bg-paper-4" />}
        <span className="min-w-0 flex-1"><b className="font-semibold">@{p.handle}</b>{p.mints.length > 0 && <em className="ml-1.5 rounded bg-up/15 px-1 text-2xs font-semibold not-italic text-up">COIN</em>}
          <span className="line-clamp-2 text-xs text-ink-2">{p.text}</span></span>
        <span className="num shrink-0 text-2xs text-muted">{ageStr(Date.now() - p.t)}</span>
      </a>
    ))}
    <a href="#/x" className="block px-3 py-2 text-sm text-accent hover:bg-paper-3">Open X tracker ›</a>
  </>;
}
function RadarRows({ open }: { open: boolean }) {
  const { data } = usePoll<Ev[]>(open ? "events" : null, 5000);
  const rows = (data || []).filter((e) => !["error", "system"].includes(e.kind)).slice(0, 30);
  if (!data) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>Nothing yet.</Empty>;
  return <>{rows.map((e) => (
    <div key={e.id} className="flex gap-2 border-b border-rule px-3 py-2 text-sm last:border-0">
      <span className="w-14 shrink-0 text-2xs text-muted uppercase">{KIND[e.kind] || e.kind}</span>
      <span className="min-w-0 flex-1 text-ink-2">{plain(e.text)}</span>
      <span className="num shrink-0 text-2xs text-muted">{ageStr(Date.now() - e.t)}</span>
    </div>
  ))}</>;
}
type Sig = { id: number; mint: string; t: number; title: string; detail: string; symbol?: string };
function Alerts() {
  return <Pop label="Alerts" icon={<Ico.bell className="size-3.5" />} width="w-[26rem]">{(open) => <AlertRows open={open} />}</Pop>;
}
function AlertRows({ open }: { open: boolean }) {
  const { data } = usePoll<Sig[]>(open ? "signals?limit=20" : null, 5000);
  if (!data) return <Empty>Loading…</Empty>;
  if (!data.length) return <Empty>No alerts yet.</Empty>;
  return <>
    {data.slice(0, 20).map((s) => (
      <a key={s.id} href={`#/coin/${s.mint}`} className="flex gap-2 border-b border-rule px-3 py-2 text-sm hover:bg-paper-3">
        <span className="min-w-0 flex-1"><b className="font-semibold">{s.title}</b><span className="block truncate text-xs text-muted">{s.detail}</span></span>
        <span className="num shrink-0 text-2xs text-muted">{ageStr(Date.now() - s.t)}</span>
      </a>
    ))}
    <a href="#/settings" className="block px-3 py-2 text-sm text-accent hover:bg-paper-3">Alert settings (Discord, Telegram) ›</a>
  </>;
}

// ---------- prices ----------
type Px = { usd: number; chg24: number | null } | null;
const priceWhole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const priceCents = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
function Prices() {
  const { data } = usePoll<{ btc: Px; eth: Px; sol: Px }>("market", 15_000);
  const live = usePulse((s) => s.live.solUsd);
  const fmt = (n?: number | null) => (n != null && Number.isFinite(n) && n > 0 ? `$${(n >= 1000 ? priceWhole : priceCents).format(n)}` : "—");
  const one = (icon: ReactNode, name: string, p: Px, usd: number | null | undefined, col: string) => (
    <Tip tip={`${name}${p?.chg24 != null ? ` · ${pct(p.chg24)} in 24h` : ""}`}><span className={cn("num flex items-center gap-1 px-1.5 text-xs font-medium", col)}>{icon}{fmt(usd)}</span></Tip>
  );
  // On a tablet only Solana's price stays (the one every figure here is in); Bitcoin and Ether need the room.
  return (
    <span className="flex h-full items-center">
      <span className="flex h-full items-center max-lg:hidden">
        {one(<Btc />, "Bitcoin", data?.btc ?? null, data?.btc?.usd, "text-[#F7931A]")}
        {one(<Eth />, "Ether", data?.eth ?? null, data?.eth?.usd, "text-[#8A92B2]")}
      </span>
      {one(<SolanaLogo className="w-3.5" />, "Solana", data?.sol ?? null, data?.sol?.usd ?? live, "text-up")}
    </span>
  );
}

// ---------- the bar ----------
// Anywhere in Blix: a tracked X account posting a coin pops up (once per post).
function XAlerts() {
  const since = useRef(Date.now());
  const { data } = usePoll<{ posts: XP[] }>(`x?coins=1&limit=5&since=${since.current}`, 10_000);
  const shown = useRef(new Set<string>());
  useEffect(() => {
    for (const p of data?.posts || []) {
      if (shown.current.has(p.id)) continue;
      shown.current.add(p.id);
      toast(`@${p.handle} posted a coin: ${p.text.slice(0, 100)}`);
    }
  }, [data]);
  return null;
}

export function StatusBar() {
  const desktop = useDesktop();
  // Alerts remain active on phones; invisible desktop controls need no subscriptions or requests.
  return <><XAlerts />{desktop && <DesktopStatusBar />}</>;
}

function DesktopStatusBar() {
  const tradesPerSec = usePulse((s) => s.live.tradesPerSec);
  const launchesPerMin = usePulse((s) => s.live.launchesPerMin);
  const owner = useRole() === "owner";
  const go = (route: string, label: string, icon: ReactNode, tip: string) => (
    <Tip tip={tip}><a href={pageHref(route)} className={item}>{icon}<span className="max-xl:sr-only">{label}</span></a></Tip>
  );
  return (
    // On a tablet the bar has ~580 px beside the rail: the launch rate and the documentation links step aside
    // below 1024 px, and anything still too wide is clipped rather than pushed past the edge.
    <footer className="flex h-8 shrink-0 items-stretch overflow-hidden border-t border-rule bg-paper-2 max-md:hidden">
      <Connection />
      {owner && <Tip tip="Settings"><a href="#/settings" aria-label="Settings" className={item}><Icon.settings className="size-3.5" /></a></Tip>}
      <span className="my-2 w-px bg-rule" />
      <Watchlist />
      {owner && go("account", "Wallets", <Icon.wallets className="size-3.5" />, "Your Blix wallet: deposit, withdraw, holdings")}
      <Pnl />
      <Feed />
      {go("", "Pulse", <Icon.pulse className="size-3.5" />, "Every new pump.fun coin, live")}
      {go("coins", "Discover", <Ico.trend className="size-3.5" />, "The most traded coins right now")}
      <Alerts />
      <span className="my-2 w-px bg-rule" />
      <Tip tip="pump.fun trades per second, from the live feed">
        <span className="mx-1.5 my-1.5 flex items-center gap-1.5 rounded-full border border-rule-2 px-2 text-2xs text-ink-2">
          <PumpLogo className="size-3" /><span className="num">{tradesPerSec != null ? `${Math.round(tradesPerSec)}/s` : "—"}</span>
        </span>
      </Tip>
      <Prices />
      <span className="flex-1" />
      <span className="flex items-stretch max-lg:hidden">
        <Tip tip="New pump.fun coins per minute"><span className="num flex items-center gap-1 px-2 text-xs text-ink-2"><Icon.launch className="size-3.5" />{launchesPerMin != null ? `${Math.round(launchesPerMin)}/min` : "—"}</span></Tip>
        <span className="my-2 w-px bg-rule" />
        <Tip tip="API docs"><a href={pageHref("api")} aria-label="API docs" className={item}><Ico.docs className="size-3.5" /></a></Tip>
        <Tip tip="Blix on X"><a href={X_URL} target="_blank" rel="noopener noreferrer" aria-label="Blix on X" className={item}><Ico.x className="size-3.5" /></a></Tip>
        <Tip tip={DISCORD_URL ? "Blix Discord" : "Blix Discord: coming soon"}>{DISCORD_URL
          ? <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" aria-label="Blix Discord" className={item}><Ico.discord className="size-3.5" /></a>
          : <span role="img" tabIndex={0} aria-label="Blix Discord, coming soon" className={cn(item, "cursor-default")}><Ico.discord className="size-3.5" /></span>}</Tip>
      </span>
    </footer>
  );
}
