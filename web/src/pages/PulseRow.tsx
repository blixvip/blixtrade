import { useLiveMc } from "@/lib/livepx";
import { XHover, XLinkIcon, xKind, xKindLabel } from "@/components/XCard";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { padOf, PadLogo, PADS } from "@/components/logos";
// X links arrive as a URL or a bare handle.
const xUrl = (x?: string | null) => !x ? null : /^https?:/i.test(x) ? x : `https://x.com/${x.replace(/^@/, "")}`;
import { usePic } from "@/lib/pics";
import { previewHandlers } from "@/components/PicPreview";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { ageStr, ageTone, compact, pct, postTag, providerOf, safeHref, shortAddr, tone } from "@/lib/format";
import { usePulse, type Coin, type ColKey } from "@/lib/pulse";
import { useTrade } from "@/lib/mode";
import { trade } from "@/lib/trade";
import { prefetchCoin } from "@/lib/coin";
import { usePrefs } from "@/lib/prefs";
import { hideCoins, unhideCoin, useHidden } from "@/lib/hidden";
import { rowLink, useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Flash } from "@/components/Live";
import { KnownHolders } from "@/components/KnownHolders";
import { FeesPaid } from "@/components/FeesPaid";
import { useMetrics, useMetricVisibility, metricNumber, metricDescription } from '@/lib/metrics';
import { MigratingChip, migratingNow } from "@/components/Migrating";
import { ChartHover } from "./pulse/ChartHover";

// One Pulse row, laid out like the terminal in the owner's mockup (design.md "Pulse rows"): a large
// picture framed by bonding progress with the contract under it; ticker, name and copy; age, links and
// counts each with an icon; who posted it and the AI call; a strip of audit pills; and on the right
// volume, market cap, trades and the quick-buy pill.
const GRADE = (g?: string | null) => !g ? "text-muted" : g.startsWith("A") ? "text-up" : g.startsWith("B") ? "text-info" : g.startsWith("C") ? "text-warn" : g === "D" ? "text-caution" : "text-down";
const POOL: Record<string, [dot: string, name: string]> = {
  pump: ["bg-up", "pump.fun"], bonk: ["bg-caution", "letsbonk.fun"], launchlab: ["bg-info", "Raydium LaunchLab"], bags: ["bg-warn", "Bags"], moonshot: ["bg-ink-2", "Moonshot"],
};
// Market cap reads by size: small is cool, mid is gold, large is green.
const capTone = (n: number | null | undefined) => n == null ? "text-muted" : n < 30_000 ? "text-info" : n < 150_000 ? "text-warn" : "text-up";

// When the coin's tweet went out, read from the post's id (an X id carries its own time: id >> 22, plus X's epoch),
// so no lookup is needed. Shown beside the X icon, coloured like Axiom: green new, yellow a few hours, red old
// (lib/format.ts postTone). Only for a link to a post, not to a profile or community. (The user, 2026-10-13.)
const tweetTime = (href: string) => { const m = /\/status(?:es)?\/(\d{15,20})/.exec(href); return m ? Number(BigInt(m[1]) >> 22n) + 1288834974657 : null; };
function TweetAge({ href }: { href: string }) {
  const now = useNow(), t = tweetTime(href);
  if (!t || t > now + 60_000) return null;
  return <span className={cn("num -ml-1 rounded-[4px] px-1 py-px text-xs leading-none font-bold", postTag(now - t))} title={`Tweeted ${new Date(t).toLocaleString()}`}>{ageStr(Math.max(0, now - t))}</span>;
}
function Age({ born }: { born: number }) {
  const now = useNow();
  return <span className={cn("num text-lg font-medium", ageTone(now - born))}>{ageStr(now - born)}</span>;
}

// The picture, framed by the bonding progress, with the launchpad marked on its corner.
function Avatar({ coin, ring }: { coin: Coin; ring: number }) {
  const pic = usePic(coin.mint);
  // Later columns often arrive without the launchpad; a pump.fun coin still shows by its dex or its "…pump" mint.
  const pad = padOf(coin), pool = PADS[pad] ? [null, PADS[pad].name] as const : POOL[pad];
  return (
    // Resting the pointer on it shows the logo big, with what the frame means underneath (PicPreview).
    <span data-coin-pic className="block shrink-0" {...previewHandlers(coin.mint, { caption: `${ring}% of the way to bonding${pool ? ` · ${pool[1]}` : ""}${coin.mayhem ? " · Mayhem Mode" : ""}` })}>
      {/* Mayhem Mode coins wear gold, like Axiom; every other coin's frame fills green with its bonding progress. */}
      <span className="relative block size-17 shrink-0 rounded-control p-0.5" style={{ background: coin.mayhem ? `conic-gradient(var(--color-warn) ${Math.max(ring, 0)}%, color-mix(in oklch, var(--color-warn) 35%, var(--color-rule-2)) 0)` : `conic-gradient(var(--color-up) ${ring}%, var(--color-rule-2) 0)` }}>
        <span className="relative grid size-full place-items-center overflow-hidden rounded-chip bg-paper-3 text-sm font-semibold text-muted uppercase">
          {(coin.symbol || "?").slice(0, 4)}
          {pic.src && <img key={pic.key} src={pic.src} alt="" decoding="async" loading="lazy" fetchPriority="low" className={cn("absolute inset-0 size-full object-cover", !pic.ok && "invisible")} onLoad={pic.onLoad} onError={pic.onError} />}
        </span>
        {pool && <span className={cn("absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full border bg-paper", coin.mayhem ? "border-warn bg-warn/25 [&_img]:[filter:sepia(1)_saturate(4)_hue-rotate(-12deg)_brightness(1.15)]" : "border-rule-2")}>{PADS[pad] ? <PadLogo pad={pad} className="size-3 rounded-full" /> : <i className={cn("size-2 rounded-full", pool[0])} />}</span>}
      </span>
    </span>
  );
}

// An icon and its figure: holders, traders, rank.
function Count({ icon, value, tip, className }: { icon: ReactNode; value: ReactNode; tip: string; className?: string }) {
  return (
    <Tip tip={tip}>
      <span className={cn("flex items-center gap-1 text-ink-2 [&_svg]:size-4", className)}>{icon}<b className="num font-semibold text-ink">{value}</b></span>
    </Tip>
  );
}

// An audit pill: an icon, a figure, and a colour that says whether it passed.
function Chip({ icon, text, state, tip }: { icon: ReactNode; text: ReactNode; state: "ok" | "bad" | "info"; tip: string }) {
  return (
    <Tip tip={tip}>
      <span className={cn("num flex h-6 shrink-0 items-center gap-1 rounded-full border border-rule bg-paper-3 px-2 text-sm font-medium [&_svg]:size-3.5",
        state === "ok" ? "text-up" : state === "bad" ? "text-down" : "text-ink")}>{icon}{text}</span>
    </Tip>
  );
}

function IconLink({ href, icon, label, className }: { href?: string | null; icon: ReactNode; label: string; className?: string }) {
  const url = safeHref(href);
  if (!url) return null;
  return (
    <Tip tip={label}>
      <a href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={label} className={cn("text-ink-2 transition-colors duration-100 hover:text-ink [&_svg]:size-4", className)}>{icon}</a>
    </Tip>
  );
}

// "@handle" out of an X link, when the link names an account.
function xHandle(u?: string | null) {
  try {
    const url = new URL(u || "");
    if (!/(^|\.)(x|twitter)\.com$/.test(url.hostname)) return null;
    const seg = url.pathname.split("/")[1];
    return seg && !["i", "search", "hashtag", "home", "intent"].includes(seg) ? `@${seg}` : null;
  } catch { return null; }
}

function AiCall({ coin }: { coin: Coin }) {
  const a = coin.ai;
  const read = async () => {
    try { await post(`research/${coin.mint}`); toast(`${coin.symbol || "Coin"} queued first for an AI read`); } catch (e) { toast((e as Error).message); }
  };
  const base = "flex shrink-0 items-center gap-1 [&_svg]:size-3.5";
  if (!a || a.status === "error" || (!a.rated && !["queued", "running"].includes(a.status || "")))
    return coin.state === "faded" ? <span className="text-muted">faded</span>
      : <button onClick={read} className={cn(base, "text-ink-2 hover:text-ink")}><Icon.ai />{a ? "retry read" : "AI read"}</button>;
  if (a.status === "queued") return <span className={cn(base, "text-muted")}><Icon.ai />queued</span>;
  if (a.status === "running") return <span className={cn(base, "text-ink")}><Icon.ai />reading…</span>;
  return (
    <Tip tip={`${a.tier === "deep" ? "Deep" : "Fast"} read by ${providerOf(a.model)}${a.pwin != null ? `. Trade call: ${a.action || "none"}, ${a.pwin}% chance of 2x before −40%. The grade is for the narrative only.` : ""}`}>
      <span className={cn(base, "font-semibold", GRADE(a.grade))}>
        <Icon.ai />{a.action === "buy" && <span className="text-up">BUY</span>}{a.grade}
        {a.pwin != null && <span className={cn("num font-medium", a.action === "avoid" ? "text-down" : "text-ink-2")}>{a.action === "avoid" ? "avoid" : `${a.pwin}%`}</span>}
      </span>
    </Tip>
  );
}

function PulseRowInner({ mint, col, sol }: { mint: string; col: ColKey; sol: number }) {
  const raw = usePulse((s) => s.coins[mint]);
  const sharedMc = useLiveMc(mint);
  const metrics = useMetrics(mint), visibleRef = useMetricVisibility(mint);
  const t = raw ? { ...raw, mcap: sharedMc ?? metricNumber(metrics, 'mc', raw.mcap), liq: metricNumber(metrics, 'liq', raw.liq), progress: metricNumber(metrics, 'progress', raw.progress),
    vol: metricNumber(metrics, 'vol1h', raw.vol), buys: metricNumber(metrics, 'buys1h', raw.buys) ?? undefined, sells: metricNumber(metrics, 'sells1h', raw.sells) ?? undefined,
    hl: { ...raw.hl, h: metricNumber(metrics, 'holders', raw.hl?.h ?? raw.holders), t10: metricNumber(metrics, 'top10', raw.hl?.t10 ?? raw.top10), dev: metricNumber(metrics, 'dev', raw.hl?.dev ?? raw.dev) } } : raw;
  const hover = useRef(0);
  // Every hook before the early return: a mounted row whose coin leaves the store must not change the hook count.
  const paper = useTrade((st) => st.paper), prefs = usePrefs();
  const isHidden = useHidden((s) => s.showing && s.mints.includes(mint));
  const [buying, setBuying] = useState<null | "busy" | "filled">(null);
  const pending = useRef(0);
  if (!t) return null;
  const migrated = col === "migrated", curve = !t.graduated && !migrated;
  const prog = migrated || t.graduated ? 100 : t.progress != null ? Math.round(t.progress * 100) : 0;
  const H = t.hl || {};
  // The live ledger (trades, seeded from the chain) is fresher than the safety report wherever the radar has it;
  // the server already puts RugCheck's count in its place when the ledger is known to undercount.
  const holders = H.h ?? t.holders;
  const top10 = H.t10 ?? t.top10;
  const dev = H.dev ?? t.dev;
  const tx = (t.buys || 0) + (t.sells || 0);
  const vol = t.vol ?? t.liveVol;
  const chg = t.chg1m ?? t.chg5;
  const mcap = t.mcap || (t.startMcapSol ? t.startMcapSol * (usePulse.getState().live.solUsd || 150) : null);
  const a = t.ai, rated = a?.verdict && ["done", "deep"].includes(a.status || "");
  const note = rated ? `${a!.tag ? `${a!.tag} · ` : ""}${a!.verdict}` : col === "new" ? [t.tri?.why, t.desc].filter(Boolean).join(" · ") : "";
  const handle = xHandle(t.x);
  const devSold = H.ds === "all" || H.ds === 2, devSelling = Boolean(H.ds) && !devSold;

  // Every press is a buy (spam buying: lib/trade.ts lines them up); busy while any are going, "filled" after the last.
  const buy = async () => {
    pending.current++;
    setBuying("busy");
    const ok = await trade({ side: "buy", mint, symbol: t.symbol || "", sol }, () => post("paper/quoted", { mint, sol }));
    if (--pending.current > 0) return;
    setBuying(ok ? "filled" : null);
    if (ok) setTimeout(() => { if (!pending.current) setBuying(null); }, 900);
  };
  const copy = () => { navigator.clipboard?.writeText(mint); toast("Contract copied"); };

  return (
    // Resting the pointer anywhere on the row (not on its links, buttons, picture or faces, which have their own
    // hover) opens the coin's live chart in a card (pulse/ChartHover.tsx).
    <ChartHover coin={t}>
    <div ref={visibleRef} {...rowLink(`#/coin/${mint}`)}
      onPointerEnter={() => { hover.current = window.setTimeout(() => prefetchCoin(mint), 150); }}
      onPointerLeave={() => clearTimeout(hover.current)}
      className={cn("group relative flex h-full cursor-pointer gap-3.5 border-b border-rule px-3.5 py-2.5 transition-colors duration-100 hover:bg-paper-3/60",
        a?.status === "running" && "bg-ink/[0.03]")}>
      <Tip tip={isHidden ? "Unhide" : "Hide this coin"}>
        <button onClick={() => (isHidden ? unhideCoin(mint) : hideCoins([mint]))} aria-label={isHidden ? "Unhide coin" : "Hide coin"}
          className={cn("absolute top-1.5 left-1.5 z-10 grid size-6 place-items-center rounded-full border border-rule-2 bg-paper-2 text-ink-2 shadow-[var(--shadow-raised)] transition-opacity duration-100 hover:text-ink", isHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}>
          {isHidden ? <Icon.eye className="size-3.5" /> : <Icon.eyeOff className="size-3.5" />}
        </button>
      </Tip>
      <div className="flex flex-col items-center gap-1">
        <Avatar coin={t} ring={prog} />
        {!prefs.compact && <button onClick={copy} aria-label="Copy contract address" className="text-xs text-muted hover:text-ink-2">{shortAddr(mint)}</button>}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <b className="min-w-0 truncate text-lg leading-tight font-bold text-ink">{(t.symbol || "").trim() || "?"}</b>
          <span className="min-w-0 truncate text-lg leading-tight text-muted @max-[580px]:hidden">{t.name}</span>
          <Tip tip="Copy contract address"><button onClick={copy} aria-label="Copy contract address" className="shrink-0 text-muted hover:text-ink @max-[480px]:hidden [&_svg]:size-3.5"><Icon.copy /></button></Tip>
          </div>
          {/* No known Fomo holder: the coin's own holder count there instead of a 0 (live from the trades stream). */}
          <KnownHolders mint={mint} total={holders} />
          <span className="ml-auto flex shrink-0 items-baseline gap-2.5 pl-1 whitespace-nowrap">
            {t.liq != null && t.liq > 0 && <Tip tip="Liquidity: both sides of the pool (on the curve, its SOL reserve), from the chain"><span className="hidden items-baseline gap-1 @min-[580px]:flex"><span className="text-xs text-muted">L</span><b className="num text-lg leading-tight font-semibold text-ink">{compact(t.liq)}</b></span></Tip>}
            {vol != null && <span title={metricDescription(metrics?.fields.vol1h)} className="hidden items-baseline gap-1 @min-[480px]:flex"><span className="text-xs text-muted">V</span><b className="num text-lg leading-tight font-semibold text-ink">{metrics?.fields.vol1h?.partial ? '≥' : ''}{compact(vol)}</b></span>}
            <span title={`Market cap ${compact(mcap)} · ${metricDescription(metrics?.fields.mc)} · Liquidity ${compact(t.liq)} · Volume ${compact(vol)}`} className="flex items-baseline gap-1"><span className="text-xs text-muted">MC</span>
              <Flash value={mcap} className={cn("text-xl leading-tight font-semibold", capTone(mcap))}>{compact(mcap)}</Flash></span>
          </span>
        </div>

        <div className="flex items-center gap-3 text-md whitespace-nowrap">
          <div className="flex h-5 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-4 overflow-hidden">
            <Age born={t.born} />
            <span className="flex items-center gap-2.5">
              {/* No launchpad link here: the badge on the picture already says where it launched (user, 2026-10-11). */}
              {safeHref(xUrl(t.x)) && <XHover href={safeHref(xUrl(t.x))!}><a href={safeHref(xUrl(t.x))!} target="_blank" rel="noopener noreferrer nofollow" aria-label={`${xKindLabel(xKind(safeHref(xUrl(t.x))!))} (set by the creator, unverified)`} className="text-ink-2 transition-colors duration-100 hover:text-ink [&_svg]:size-3.5"><XLinkIcon href={safeHref(xUrl(t.x))!} /></a></XHover>}
              {safeHref(xUrl(t.x)) && <TweetAge href={safeHref(xUrl(t.x))!} />}
              <IconLink href={t.web} icon={<Icon.web />} label="Website (set by the creator, unverified)" />
              <IconLink href={t.tg} icon={<Icon.tg />} label="Telegram" />
              <IconLink href={t.tiktok} icon={<Icon.tiktok />} label="TikTok" />
              <IconLink href={`https://x.com/search?q=${mint}`} icon={<Icon.search />} label="Search the contract on X" />
            </span>
            {holders != null && <Count icon={<Icon.users />} value={holders} tip={H.h != null ? "Holders now, from the chain's trades" : "Holders (RugCheck)"} />}
            {t.traders != null && <Count icon={<Icon.candles />} value={t.traders} tip="Wallets seen trading it live" />}
            {/* The live rank figure was taken off the row (user, 2026-10-11: "I don't like this"). */}
            {prefs.compact && <span className="text-sm"><AiCall coin={t} /></span>}
          </div>
          {chg != null && <span className={cn("num shrink-0 font-medium", tone(chg))}>{pct(chg)}</span>}
          <FeesPaid mint={mint} sol={t.fees} since={t.feesSince} born={t.born} />
          {tx > 0 && (
            <Tip tip={`${t.buys || 0} buys / ${t.sells || 0} sells`}>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">TX<Flash value={tx} className="text-md font-semibold text-ink">{tx}</Flash>
                <i className="block h-0.5 w-7 rounded-full bg-down"><i className="block h-full rounded-full bg-up" style={{ width: `${Math.round(((t.buys || 0) / tx) * 100)}%` }} /></i>
              </span>
            </Tip>
          )}
        </div>

        {!prefs.compact && <div className="flex min-w-0 items-center gap-2.5 text-sm">
          {handle && <IconLink href={t.x} icon={<span className="font-medium">{handle}</span>} label="Open the X post" className="shrink-0 text-info hover:text-ink" />}
          <AiCall coin={t} />
          <span className="min-w-0 flex-1 truncate text-muted" title={note}>{note}</span>
        </div>}

        <div className="flex items-center gap-2">
          {/* one line of whole chips: one that does not fit wraps onto a second line that is clipped away, never cut in half */}
          <div className="flex h-6 min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-2 overflow-hidden">
            {prefs.pills && <>
            {t.warn && <Chip icon={<Icon.ghost />} text={t.warn.kind === "stale" ? "stale price" : "check price"} state="info" tip={t.warn.kind === "emptied" ? "Previous price warning; liquidity needs rechecking. This is not confirmation of a rug." : t.warn.text} />}
            {top10 != null && <Chip icon={<Icon.userStar />} text={`${Math.round(top10)}%`} state={top10 > 45 ? "bad" : "ok"} tip="Top 10 holders' share of the supply" />}
            {devSold ? <Chip icon={<Icon.chef />} text="DS" state="info" tip="The dev wallet sold everything it held" />
              : devSelling ? <Chip icon={<Icon.chef />} text="selling" state="bad" tip="The dev wallet has sold more than half of what it held" />
              : dev != null ? <Chip icon={<Icon.chef />} text={`${(+dev).toFixed(dev < 10 ? 1 : 0)}%`} state={dev > 8 ? "bad" : "ok"} tip="Dev wallet's share of the supply" />
              : t.devSol != null ? <Chip icon={<Icon.chef />} text={`${(+t.devSol).toFixed(2)} SOL`} state="info" tip="What the dev bought at launch" /> : null}
            {H.snN ? <Chip icon={<Icon.crosshair />} text={`${Math.round(H.sn ?? 0)}%`} state={(H.sn ?? 0) > 20 ? "bad" : "ok"} tip={`Snipers: ${H.snN} wallets bought within 2 blocks of the first trade; share of the supply they still hold`} /> : null}
            {H.bdN ? <Chip icon={<Icon.boxes />} text={`${Math.round(H.bd ?? 0)}%`} state={(H.bd ?? 0) > 15 ? "bad" : "ok"} tip={`Bundle: ${H.bdN} other wallets bought in the launch block; share of the supply they still hold`} /> : null}
            {(t.devCount ?? 0) >= 4 && <Chip icon={<Icon.ghost />} text={`×${t.devCount}`} state={(t.devCount ?? 0) >= 10 ? "bad" : "info"} tip="Coins this dev wallet launched in the last 6 hours" />}
            {t.win && <Chip icon={<Icon.curve />} text={`${t.win.netSol >= 0 ? "+" : ""}${t.win.netSol}`} state={t.win.netSol < 0 ? "bad" : "ok"} tip={`Last 5 minutes: ${t.win.trades} trades by ${t.win.traders} wallets, net SOL bought`} />}
            </>}
          </div>
          {prefs.buy && migratingNow(t.migrating) ? <MigratingChip /> : prefs.buy && <Tip tip={paper ? `Paper buy ${sol} SOL at the price this second. Nothing is really bought.` : `Buy ${sol} SOL of it now with real SOL from your wallet.`}>
            <button onClick={buy} aria-busy={buying === "busy"} className={cn(buying === "filled" && "animate-tx-fill", buying === "busy" && "[&_svg]:animate-pulse", "num flex h-7 shrink-0 items-center gap-1 rounded-full bg-ink-2 px-3 text-md font-bold whitespace-nowrap text-on-fill transition-[background-color,transform] duration-100 hover:bg-ink active:scale-95 [&_svg]:size-3.5 [&_svg]:fill-current")}>
              <Icon.bolt />{sol} SOL
            </button>
          </Tip>}
        </div>
      </div>
    </div>
    </ChartHover>
  );
}

export const PulseRow = memo(PulseRowInner);
