// Fomo's view of a coin, as its own coin page shows it: the known holders (Fomo traders holding it, biggest
// first, with their position, PnL, average entry and pinned thesis) and the theses (why traders bought,
// with likes, the market cap when written and the author's position now). Data: /api/coin/<mint>/fomo
// (server/fomoboard.js reads Fomo through Aside, kept three minutes).
import { useRef, useState } from "react";
import { usdK, usdSigned } from "@/lib/coin";
import { toast } from "@/components/ui/toast";
import { Icon } from "@/shell/icons";
import { ageStr } from "@/lib/format";
import { useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Empty } from "./parts";
import { thumb, original } from "@/lib/thumb";
import { useLiveMc } from "@/lib/livepx";
import { Flash } from "@/components/Live";
import { FomoEyes } from "../traders/parts";

export interface FomoThesis { id: string; text: string; likes: number; mcap: number | null; price: number | null; t: string }
export interface FomoHolder {
  handle: string | null; name: string | null; pic: string | null; followers: number | null; verified: boolean; wallet: string | null;
  amount: number | null; value: number | null; pnl: number | null; unrealized: number | null; realized: number | null; cost: number | null; entry: number | null;
  external: boolean; dev: boolean; avgHold: number | null; thesis: FomoThesis | null;
}
export interface FomoPost extends FomoThesis {
  handle: string | null; name: string | null; pic: string | null; verified: boolean; dev: boolean; replies: number; wallet: string | null;
  position: { amount: number | null; value: number | null; unrealized: number | null; realized: number | null; pct: number | null; closed: string | null } | null;
}
export interface CoinFomo { read: number | null; loading: boolean; refreshing: boolean; error: string | null; signedOut: boolean; holders: FomoHolder[]; totalHolders: number | null; theses: FomoPost[];
  queue?: { running: boolean; waiting: number; paused: boolean; hasTab: boolean | null } }

const traderHref = (h: string | null) => (h ? `#/trader/${encodeURIComponent(h)}` : undefined);
const pct = (n: number | null | undefined) => (n == null || !isFinite(n) ? "" : `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(n >= 100 ? 0 : 1)}%`);
const hold = (s: number | null) => (s == null ? null : s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))}m`);
const amt = (n: number | null) => (n == null ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));

// The market cap at the holder's average entry: entry price times the coin's supply (market cap over price now).
function entryMc(x: FomoHolder, mc: number | null) {
  const price = x.value && x.amount ? x.value / x.amount : null;
  return x.entry != null && price && mc ? usdK((x.entry / price) * mc) : "—";
}

// A trader's face: the resized copy, then the original if that fails, then Fomo's own default picture (its eyes on a
// Fomo blue), as fomo.family shows an account with no picture.
function Avatar({ src, name, size = 32 }: { src: string | null; name?: string | null; size?: number }) {
  const [step, setStep] = useState(0);
  const [seen, setSeen] = useState(src);
  if (seen !== src) { setSeen(src); setStep(0); }
  const url = !src ? null : step === 0 ? thumb(src, size) : step === 1 ? src : null;
  if (url) return <img key={url} src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setStep(step === 0 && original(url) !== null ? 1 : 2)}
    className="shrink-0 rounded-full bg-paper-4 object-cover ring-1 ring-edge" style={{ width: size, height: size }} />;
  return <span aria-hidden className="relative block shrink-0 overflow-hidden rounded-full ring-1 ring-edge" style={{ width: size, height: size }}><FomoEyes id={name} /></span>;
}

// Fomo's data loads by itself (the radar reads it through Aside in a second or two). While it does, a few
// placeholder rows; if Aside has no Fomo tab to read through, one click opens one that stays (Blix reuses it).
function Skeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-t border-rule px-3 py-3">
          <span className="size-8 animate-pulse rounded-full bg-paper-4" />
          <span className="flex flex-1 flex-col gap-1.5"><span className="h-3 w-40 animate-pulse rounded bg-paper-4" /><span className="h-2.5 w-24 animate-pulse rounded bg-paper-3" /></span>
          <span className="h-3 w-16 animate-pulse rounded bg-paper-4" />
        </div>
      ))}
    </div>
  );
}
function ConnectFomo({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <b className="text-md font-semibold text-ink-2">{text}</b>
      <span className="max-w-md text-sm text-muted">Blix reads Fomo through a fomo.family tab in your browser. Open one once and leave it open: every coin then loads in about a second.</span>
      <a href="https://fomo.family/leaderboard?blix=fomo" target="_blank" rel="noopener" className="mt-1 h-8 rounded-full bg-ink px-4 text-md leading-8 font-semibold text-on-fill hover:bg-focus">Connect Fomo</a>
    </div>
  );
}

function Status({ f, what }: { f: CoinFomo | null; what: string }) {
  if (f?.signedOut) return <ConnectFomo text={`Sign in to Fomo to see this coin's ${what}`} />;
  if (f && !f.read && f.queue?.hasTab === false) return <ConnectFomo text={`Connect Fomo to see this coin's ${what}`} />;
  // A failed read says so, even while the next try is queued: a skeleton that never fills reads as broken.
  if (f?.error && !f.read) return <div title={f.error}><Empty title="Fomo isn't answering right now" text="Blix keeps trying by itself and fills this in the moment Fomo answers." /></div>;
  if (!f || f.loading || !f.read) return <Skeleton />;
  return null;
}

function Source({ f }: { f: CoinFomo }) {
  const now = useNow();
  return <span className="text-sm text-muted">From Fomo{f.read ? ` · updated ${ageStr(now - f.read)} ago` : ""}</span>;
}

// Fomo's figures are as of its last read (every few minutes); between reads each holder's value and PnL move with
// the coin's live market cap, the same as the chart: value x (MC now / MC at the read), the difference added to PnL.
export function KnownHolders({ f, mc, mint, supply }: { f: CoinFomo | null; mc: number | null; mint?: string; supply?: number | null }) {
  const live = useLiveMc(mint) ?? mc;
  const base = useRef<{ read: number | null; mc: number | null } | null>(null);
  if (f?.read && (!base.current || base.current.read !== f.read)) base.current = { read: f.read, mc: live };
  if (base.current && !base.current.mc && live) base.current.mc = live;
  const scale = base.current?.mc && live ? live / base.current.mc : 1;
  const s = Status({ f, what: "known holders" });
  if (s || !f) return s;
  if (!f.holders.length) return <Empty title="No Fomo traders hold this coin" text="Known holders are traders on Fomo who hold it now." />;
  const rows = f.holders.map((x) => {
    const move = x.value != null ? x.value * (scale - 1) : 0;
    const value = x.value != null ? x.value * scale : null, pnl = x.pnl != null || x.value != null ? (x.pnl ?? 0) + move : null;
    return { x, value, pnl, ret: x.cost && pnl != null ? (pnl / x.cost) * 100 : null };
  });
  const top = Math.max(1, ...rows.map((r) => r.value || 0));
  const cell = "border-b border-rule px-4 py-3";
  // Share of the supply each holds: their tokens over the coin's supply (or, without it, value over market cap).
  const share = (x: FomoHolder, v: number | null) => (x.amount != null && supply ? (x.amount / supply) * 100 : v != null && live ? (v / live) * 100 : null);
  const copy = (w: string) => { navigator.clipboard?.writeText(w); toast("Wallet copied"); };
  // Straight into the list: rank 1 first, nothing above it (the user, 2026-10-10).
  return (
    <div className="m-2 overflow-hidden rounded-xl border border-rule bg-paper-2 font-tight">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-md">
          <tbody>
            {rows.map(({ x, value, pnl, ret }, i) => {
              const up = (pnl ?? 0) >= 0, sh = share(x, value);
              return (
                <tr key={`${x.handle}-${i}`} className="group align-middle transition-colors duration-150 last:[&>td]:border-b-0 hover:bg-paper-3/60">
                  <td className={cell}>
                    <a href={traderHref(x.handle)} className="flex min-w-0 items-center gap-3">
                      <span className={cn("num w-5 shrink-0 text-right text-sm font-semibold", i < 3 ? "text-ink" : "text-ink-2")}>{i + 1}</span>
                      <span className="rounded-full ring-1 ring-rule-2 transition-transform duration-200 group-hover:scale-105"><Avatar src={x.pic} name={x.name || x.handle} size={36} /></span>
                      <span className="min-w-0">
                        <b className="flex items-center gap-1.5 truncate text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink group-hover:text-focus">{x.name || x.handle}
                          {x.dev && <span className="rounded-full bg-warn/15 px-1.5 py-px text-[9px] font-bold tracking-wide text-warn">DEV</span>}
                          {x.wallet && <span title={`Real wallet ${x.wallet}`} className="rounded-full bg-up/10 px-1.5 py-px text-[9px] font-bold tracking-wide text-up">TRACKED</span>}</b>
                        <span className="mt-0.5 block truncate text-sm text-ink-2">@{x.handle}{hold(x.avgHold) ? <span className="text-muted"> · holds {hold(x.avgHold)}</span> : ""}{x.external ? " · received from outside" : ""}</span>
                      </span>
                    </a>
                    {x.wallet && (
                      <span className="mt-1.5 ml-[68px] flex items-center gap-1">
                        <a href={`https://solscan.io/account/${x.wallet}`} target="_blank" rel="noreferrer" title={`Their wallet ${x.wallet} on Solscan`}
                          className="font-outlier inline-flex h-6 items-center gap-1.5 rounded-full bg-paper-4/70 px-2 text-xs text-ink-2 ring-1 ring-rule-2 transition-colors hover:text-ink hover:ring-muted">
                          <i className="size-1.5 rounded-full bg-up" />{x.wallet.slice(0, 4)}…{x.wallet.slice(-4)}</a>
                        <button onClick={() => copy(x.wallet!)} aria-label="Copy their wallet" title="Copy wallet" className="grid size-6 place-items-center rounded-full text-muted transition-colors hover:bg-paper-4 hover:text-ink"><Icon.copy className="size-3.5" /></button>
                      </span>
                    )}
                  </td>
                  <td className={cn(cell, "text-right")}>
                    <Flash value={value == null ? null : Math.round(value)} className="num text-[15px] font-semibold tracking-[-0.01em] text-ink">{usdK(value)}</Flash>
                    <span className="mt-1 flex items-center justify-end gap-2 text-sm text-ink-2">
                      <span className="h-1 w-12 overflow-hidden rounded-full bg-paper-4"><span className="block h-full rounded-full bg-accent" style={{ width: `${((value || 0) / top) * 100}%` }} /></span>
                      {sh != null && <b className="num font-semibold text-ink">{sh >= 1 ? sh.toFixed(2) : sh.toFixed(3)}%</b>}
                      <span className="num text-muted">{amt(x.amount)}</span>
                    </span>
                  </td>
                  <td className={cn(cell, "text-right")}>
                    <Flash value={pnl == null ? null : Math.round(pnl)} className={cn("num text-[15px] font-semibold tracking-[-0.01em]", up ? "text-up" : "text-down")}>{usdSigned(pnl)}</Flash>
                    {ret != null && <span className={cn("num mt-1 ml-auto block w-fit rounded-full px-1.5 py-px text-xs font-semibold", up ? "bg-up/10 text-up" : "bg-down/10 text-down")}>{ret >= 0 ? "+" : "−"}{Math.abs(ret).toFixed(Math.abs(ret) >= 100 ? 0 : 1)}%</span>}
                  </td>
                  <td className={cn(cell, "num text-right")}>
                    <span className="text-[15px] font-medium text-ink">{entryMc(x, mc)}</span>
                    <span className="mt-1 block text-sm text-muted">{x.entry != null ? `$${x.entry.toPrecision(3)}` : ""}</span>
                  </td>
                  <td className={cn(cell, "max-w-[420px] text-sm")}>
                    {x.thesis ? <span className="line-clamp-2 border-l-2 border-rule-2 pl-2.5 leading-snug whitespace-pre-line text-ink">{x.thesis.text}</span> : <span className="text-muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Theses({ f }: { f: CoinFomo | null }) {
  const [sort, setSort] = useState<"top" | "new">("top");
  const now = useNow();
  const s = Status({ f, what: "theses" });
  if (s || !f) return s;
  if (!f.theses.length) return <Empty title="No theses yet" text="A thesis is why a trader bought, posted on Fomo with their trade." />;
  const list = [...f.theses].sort((a, b) => (sort === "new" ? Date.parse(b.t) - Date.parse(a.t) : (b.likes || 0) - (a.likes || 0) || Date.parse(b.t) - Date.parse(a.t)));
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div role="radiogroup" aria-label="Sort theses" className="inline-flex overflow-hidden rounded-control border border-rule">
          {([["top", "Most liked"], ["new", "Newest"]] as const).map(([v, l]) => (
            <button key={v} role="radio" aria-checked={sort === v} onClick={() => setSort(v)} className={cn("h-6 px-2.5 text-xs font-semibold", sort === v ? "bg-accent/20 text-ink" : "text-muted hover:text-ink")}>{l}</button>
          ))}
        </div>
        <Source f={f} />
      </div>
      <div className="flex flex-col">
        {list.map((x) => {
          const p = x.position;
          return (
            <article key={x.id} className="flex gap-3 border-t border-rule px-3 py-3">
              <a href={traderHref(x.handle)} className="shrink-0"><Avatar src={x.pic} name={x.name || x.handle} size={36} /></a>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  <a href={traderHref(x.handle)} className="font-semibold text-ink hover:text-focus">{x.name || x.handle}</a>
                  <span className="text-muted">@{x.handle}</span>
                  {x.dev && <span className="rounded-chip bg-warn/15 px-1 text-[10px] font-bold text-warn">DEV</span>}
                  {x.wallet && <span className="rounded-chip bg-up/10 px-1 text-[10px] font-bold text-up">TRACKED</span>}
                  <span className="text-muted">· {ageStr(now - Date.parse(x.t))} ago{x.mcap ? ` at ${usdK(x.mcap)} MC` : ""}</span>
                </div>
                <p className="mt-1 text-md leading-relaxed whitespace-pre-line text-ink-2">{x.text}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-muted">
                  <span>♥ <b className="num font-semibold text-ink-2">{x.likes}</b></span>
                  {x.replies > 0 && <span>{x.replies} replies</span>}
                  {p && (p.closed ? <span>closed the trade{p.realized != null ? <> · <b className={cn("num font-semibold", p.realized >= 0 ? "text-up" : "text-down")}>{usdSigned(p.realized)}</b></> : null}</span>
                    : p.value != null ? <span>holds <b className="num font-semibold text-ink-2">{usdK(p.value)}</b>{p.unrealized != null ? <> · <b className={cn("num font-semibold", p.unrealized >= 0 ? "text-up" : "text-down")}>{usdSigned(p.unrealized)} {pct(p.pct)}</b></> : null}</span> : null)}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
