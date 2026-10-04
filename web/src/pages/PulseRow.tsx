import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { PumpLogo } from "@/components/brand";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import { ageStr, compact, pct, providerOf, safeHref, shortAddr, tone } from "@/lib/format";
import { usePulse, type Coin, type ColKey } from "@/lib/pulse";
import { loadPaperWallet, paperReady } from "@/lib/mode";
import { useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

// One Pulse row, laid out like the terminal in the owner's mockup (design.md "Pulse rows"): a large
// picture framed by bonding progress with the contract under it; ticker, name and copy; age, links and
// counts each with an icon; who posted it and the AI call; a strip of audit pills; and on the right
// volume, market cap, trades and the quick-buy pill.
export const ROW_H = 116;
const GRADE = (g?: string | null) => !g ? "text-muted" : g.startsWith("A") ? "text-up" : g.startsWith("B") ? "text-info" : g.startsWith("C") ? "text-warn" : g === "D" ? "text-caution" : "text-down";
const POOL: Record<string, [dot: string, name: string]> = {
  pump: ["bg-up", "pump.fun"], bonk: ["bg-caution", "letsbonk.fun"], launchlab: ["bg-info", "Raydium LaunchLab"], bags: ["bg-warn", "Bags"], moonshot: ["bg-ink-2", "Moonshot"],
};
// Market cap reads by size: small is cool, mid is gold, large is green.
const capTone = (n: number | null | undefined) => n == null ? "text-muted" : n < 30_000 ? "text-info" : n < 150_000 ? "text-warn" : "text-up";

// A number that flashes once in the direction it moved.
function Flash({ value, children, className }: { value: number | null | undefined; children: ReactNode; className?: string }) {
  const prev = useRef(value), key = useRef(0);
  const dir = value != null && prev.current != null && value !== prev.current ? (value > prev.current ? "up" : "down") : null;
  if (dir) key.current++;
  useEffect(() => { prev.current = value; });
  return <b key={key.current} className={cn("num", dir === "up" && "animate-flash-up", dir === "down" && "animate-flash-down", className)}>{children}</b>;
}

function Age({ born }: { born: number }) {
  const now = useNow();
  return <span className="num text-lg font-medium text-up">{ageStr(now - born)}</span>;
}

// The radar answers 404 for a picture it is still fetching (a coin made seconds ago), so a miss is retried
// a few times before the ticker is shown instead. What is known is remembered across scrolling.
const picKnown = new Map<string, "ok" | "dead">();
const PIC_RETRY_MS = [1500, 4000, 10_000];
function usePicture(mint: string) {
  const [state, setState] = useState<{ n: number; dead: boolean }>(() => ({ n: 0, dead: picKnown.get(mint) === "dead" }));
  const [shown, setShown] = useState(false);   // hidden until it has loaded, so a miss never shows a broken-image box
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    shown,
    src: state.dead ? null : `/img/${mint}${state.n ? `?r=${state.n}` : ""}`,
    onLoad: () => { picKnown.set(mint, "ok"); setShown(true); },
    onError: () => {
      const wait = PIC_RETRY_MS[state.n];
      if (wait == null) { picKnown.set(mint, "dead"); if (picKnown.size > 3000) picKnown.clear(); return setState({ n: state.n, dead: true }); }
      timer.current = window.setTimeout(() => setState({ n: state.n + 1, dead: false }), wait);
    },
  };
}

// The picture, framed by the bonding progress, with the launchpad marked on its corner.
function Avatar({ coin, ring }: { coin: Coin; ring: number }) {
  const pic = usePicture(coin.mint);
  const pool = POOL[(coin.pool || "").toLowerCase()];
  return (
    <Tip tip={`${ring}% of the way to bonding${pool ? ` · launched on ${pool[1]}` : ""}`} side="right">
      <span className="relative block size-17 shrink-0 rounded-control p-0.5" style={{ background: `conic-gradient(var(--color-up) ${ring}%, var(--color-rule-2) 0)` }}>
        <span className="relative grid size-full place-items-center overflow-hidden rounded-chip bg-paper-3 text-sm font-semibold text-muted uppercase">
          {(coin.symbol || "?").slice(0, 4)}
          {pic.src && <img key={pic.src} src={pic.src} alt="" decoding="async" className={cn("absolute inset-0 size-full object-cover", !pic.shown && "invisible")} onLoad={pic.onLoad} onError={pic.onError} />}
        </span>
        {pool && <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full border border-rule-2 bg-paper">{(coin.pool || "").toLowerCase() === "pump" ? <PumpLogo className="size-3" /> : <i className={cn("size-2 rounded-full", pool[0])} />}</span>}
      </span>
    </Tip>
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
  const t = usePulse((s) => s.coins[mint]);
  if (!t) return null;
  const migrated = col === "migrated", curve = !t.graduated && !migrated;
  const prog = migrated || t.graduated ? 100 : t.progress != null ? Math.round(t.progress * 100) : 0;
  const H = t.hl || {};
  // On the curve the live trade ledger is fresher; after bonding the safety report is.
  const holders = curve ? (H.h ?? t.holders) : (t.holders ?? H.h);
  const top10 = curve ? (H.t10 ?? t.top10) : (t.top10 ?? H.t10);
  const dev = curve ? (H.dev ?? t.dev) : (t.dev ?? H.dev);
  const tx = (t.buys || 0) + (t.sells || 0);
  const vol = t.vol ?? t.liveVol;
  const chg = t.chg1m ?? t.chg5;
  const mcap = t.mcap || (t.startMcapSol ? t.startMcapSol * (usePulse.getState().live.solUsd || 150) : null);
  const a = t.ai, rated = a?.verdict && ["done", "deep"].includes(a.status || "");
  const note = rated ? `${a!.tag ? `${a!.tag} · ` : ""}${a!.verdict}` : col === "new" ? [t.tri?.why, t.desc].filter(Boolean).join(" · ") : "";
  const slop = t.tri?.label === "slop" && !a;
  const handle = xHandle(t.x);
  const devSold = H.ds === "all" || H.ds === 2, devSelling = Boolean(H.ds) && !devSold;

  const buy = async () => {
    if (!paperReady()) return;
    try { await post("paper/quoted", { mint, sol }); toast(`Paper bought ${sol} SOL of ${t.symbol || "coin"}`); loadPaperWallet(); } catch (e) { toast((e as Error).message); }
  };
  const copy = () => { navigator.clipboard?.writeText(mint); toast("Contract copied"); };

  return (
    <div onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) location.hash = `#/coin/${mint}`; }}
      className={cn("flex h-full cursor-pointer gap-3.5 border-b border-rule px-3.5 py-2.5 transition-colors duration-100 hover:bg-paper-3/60",
        a?.status === "running" && "bg-ink/[0.03]", (t.state === "faded" || slop) && "opacity-55")}>
      <div className="flex flex-col items-center gap-1">
        <Avatar coin={t} ring={prog} />
        <button onClick={copy} aria-label="Copy contract address" className="text-xs text-muted hover:text-ink-2">{shortAddr(mint)}</button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div className="flex items-center gap-1.5">
          <b className="text-lg leading-tight font-bold whitespace-nowrap text-ink">{t.symbol || "?"}</b>
          <span className="min-w-0 truncate text-lg leading-tight text-muted">{t.name}</span>
          <Tip tip="Copy contract address"><button onClick={copy} aria-label="Copy contract address" className="shrink-0 text-muted hover:text-ink [&_svg]:size-3.5"><Icon.copy /></button></Tip>
          <span className="ml-auto flex shrink-0 items-baseline gap-2.5 pl-2 whitespace-nowrap">
            {vol != null && <span className="flex items-baseline gap-1"><span className="text-xs text-muted">V</span><b className="num text-lg leading-tight font-semibold text-ink">{compact(vol)}</b></span>}
            <span className="flex items-baseline gap-1"><span className="text-xs text-muted">MC</span>
              <Flash value={mcap} className={cn("text-xl leading-tight font-semibold", capTone(mcap), t.warn && t.warn.kind !== "odd-curve" && "opacity-45")}>{compact(mcap)}</Flash></span>
          </span>
        </div>

        <div className="flex items-center gap-3 text-md whitespace-nowrap">
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]">
            <Age born={t.born} />
            <span className="flex items-center gap-2.5">
              <IconLink href={`https://pump.fun/coin/${mint}`} icon={<Icon.link />} label="Open on the launchpad" />
              <IconLink href={t.web} icon={<Icon.web />} label="Website (set by the creator, unverified)" />
              <IconLink href={t.tg} icon={<Icon.tg />} label="Telegram" />
              <IconLink href={`https://x.com/search?q=${mint}`} icon={<Icon.search />} label="Search the contract on X" />
            </span>
            {holders != null && <Count icon={<Icon.users />} value={holders} tip={curve ? "Holders now, from the live trade feed" : "Holders (RugCheck)"} />}
            {t.traders != null && <Count icon={<Icon.candles />} value={t.traders} tip="Wallets seen trading it live" />}
            {t.tr != null && <Count icon={<Icon.rank />} value={t.tr} tip="Live rank 0–100: real demand this second. 60+ is the pick line." className={t.tr >= 60 ? "text-up" : undefined} />}
          </div>
          {chg != null && <span className={cn("num shrink-0 font-medium", tone(chg))}>{pct(chg)}</span>}
          {tx > 0 && (
            <Tip tip={`${t.buys || 0} buys / ${t.sells || 0} sells`}>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">TX<Flash value={tx} className="text-md font-semibold text-ink">{tx}</Flash>
                <i className="block h-0.5 w-7 rounded-full bg-down"><i className="block h-full rounded-full bg-up" style={{ width: `${Math.round(((t.buys || 0) / tx) * 100)}%` }} /></i>
              </span>
            </Tip>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          {handle && <IconLink href={t.x} icon={<span className="font-medium">{handle}</span>} label="Open the X post" className="shrink-0 text-info hover:text-ink" />}
          <AiCall coin={t} />
          <span className="min-w-0 flex-1 truncate text-muted" title={note}>{note}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden [mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]">
            {t.warn && <Chip icon={<Icon.ghost />} text={t.warn.kind === "emptied" ? "emptied" : t.warn.kind === "stale" ? "stale price" : "check price"} state="bad" tip={t.warn.text} />}
            {top10 != null && <Chip icon={<Icon.userStar />} text={`${Math.round(top10)}%`} state={top10 > 45 ? "bad" : "ok"} tip="Top 10 holders' share of the supply" />}
            {devSold ? <Chip icon={<Icon.chef />} text="DS" state="info" tip="The dev wallet sold everything it held" />
              : devSelling ? <Chip icon={<Icon.chef />} text="selling" state="bad" tip="The dev wallet has sold more than half of what it held" />
              : dev != null ? <Chip icon={<Icon.chef />} text={`${(+dev).toFixed(dev < 10 ? 1 : 0)}%`} state={dev > 8 ? "bad" : "ok"} tip="Dev wallet's share of the supply" />
              : t.devSol != null ? <Chip icon={<Icon.chef />} text={`${(+t.devSol).toFixed(2)} SOL`} state="info" tip="What the dev bought at launch" /> : null}
            {H.snN ? <Chip icon={<Icon.crosshair />} text={`${Math.round(H.sn ?? 0)}%`} state={(H.sn ?? 0) > 20 ? "bad" : "ok"} tip={`Snipers: ${H.snN} wallets bought within 2 blocks of the first trade; share of the supply they still hold`} /> : null}
            {H.bdN ? <Chip icon={<Icon.boxes />} text={`${Math.round(H.bd ?? 0)}%`} state={(H.bd ?? 0) > 15 ? "bad" : "ok"} tip={`Bundle: ${H.bdN} other wallets bought in the launch block; share of the supply they still hold`} /> : null}
            {(t.devCount ?? 0) >= 4 && <Chip icon={<Icon.ghost />} text={`×${t.devCount}`} state={(t.devCount ?? 0) >= 10 ? "bad" : "info"} tip="Coins this dev wallet launched in the last 6 hours" />}
            {t.win && <Chip icon={<Icon.curve />} text={`${t.win.netSol >= 0 ? "+" : ""}${t.win.netSol}`} state={t.win.netSol < 0 ? "bad" : "ok"} tip={`Last 5 minutes: ${t.win.trades} trades by ${t.win.traders} wallets, net SOL bought`} />}
          </div>
          <Tip tip={`Paper buy ${sol} SOL at the price this second. Nothing is really bought.`}>
            <button onClick={buy} className="num flex h-7 shrink-0 items-center gap-1 rounded-full bg-ink-2 px-3 text-md font-bold whitespace-nowrap text-on-fill transition-[background-color,transform] duration-100 hover:bg-ink active:scale-95 [&_svg]:size-3.5 [&_svg]:fill-current">
              <Icon.bolt />{sol} SOL
            </button>
          </Tip>
        </div>
      </div>
    </div>
  );
}

export const PulseRow = memo(PulseRowInner);
