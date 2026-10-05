// Fomo's view of a coin, as its own coin page shows it: the known holders (Fomo traders holding it, biggest
// first, with their position, PnL, average entry and pinned thesis) and the theses (why traders bought,
// with likes, the market cap when written and the author's position now). Data: /api/coin/<mint>/fomo
// (server/fomoboard.js reads Fomo through Aside, kept three minutes).
import { useState } from "react";
import { usdK, usdSigned } from "@/lib/coin";
import { ageStr } from "@/lib/format";
import { useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Empty } from "./parts";

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

function Avatar({ src, size = 32 }: { src: string | null; size?: number }) {
  return src ? <img src={src} alt="" loading="lazy" className="shrink-0 rounded-full bg-paper-4 object-cover ring-1 ring-edge" style={{ width: size, height: size }} />
    : <span className="shrink-0 rounded-full bg-paper-4" style={{ width: size, height: size }} />;
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
  if (!f || f.loading || (!f.read && !f.error)) return <Skeleton />;
  if (f.error && !f.read) return <Empty title="Couldn't read Fomo just now" text={`${f.error.replace(/\.$/, "")}. Blix tries again by itself.`} />;
  return null;
}

function Source({ f }: { f: CoinFomo }) {
  const now = useNow();
  return <span className="text-sm text-muted">From Fomo{f.read ? ` · updated ${ageStr(now - f.read)} ago` : ""}</span>;
}

export function KnownHolders({ f, mc }: { f: CoinFomo | null; mc: number | null }) {
  const s = Status({ f, what: "known holders" });
  if (s || !f) return s;
  if (!f.holders.length) return <Empty title="No Fomo traders hold this coin" text="Known holders are traders on Fomo who hold it now." />;
  const total = f.holders.reduce((a, x) => a + (x.value || 0), 0);
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="text-sm text-ink-2"><b className="num font-semibold text-ink">{(f.totalHolders ?? f.holders.length).toLocaleString()}</b> Fomo traders hold it · the top {f.holders.length} hold <b className="num font-semibold text-ink">{usdK(total)}</b></span>
        <Source f={f} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-md">
          <thead><tr className="label">
            <th className="sticky top-0 border-b border-rule bg-paper-2 px-3 py-1.5 text-left">Trader</th>
            <th className="sticky top-0 border-b border-rule bg-paper-2 px-3 py-1.5 text-right">Value</th>
            <th className="sticky top-0 border-b border-rule bg-paper-2 px-3 py-1.5 text-right">PnL</th>
            <th className="sticky top-0 border-b border-rule bg-paper-2 px-3 py-1.5 text-right">Entry MC</th>
            <th className="sticky top-0 border-b border-rule bg-paper-2 px-3 py-1.5 text-left">Thesis</th>
          </tr></thead>
          <tbody>
            {f.holders.map((x, i) => {
              const ret = x.cost ? ((x.pnl ?? 0) / x.cost) * 100 : null;
              return (
                <tr key={`${x.handle}-${i}`} className="align-top hover:bg-paper-3/50">
                  <td className="border-b border-rule/70 px-3 py-2">
                    <a href={traderHref(x.handle)} className="flex min-w-0 items-center gap-2.5 hover:text-focus">
                      <span className="num w-5 shrink-0 text-right text-sm text-muted">{i + 1}</span>
                      <Avatar src={x.pic} />
                      <span className="min-w-0">
                        <b className="flex items-center gap-1.5 truncate font-semibold text-ink">{x.name || x.handle}{x.dev && <span className="rounded-chip bg-warn/15 px-1 text-[10px] font-bold text-warn">DEV</span>}{x.wallet && <span title={`Real wallet ${x.wallet}`} className="rounded-chip bg-up/10 px-1 text-[10px] font-bold text-up">TRACKED</span>}</b>
                        <span className="block truncate text-sm text-muted">@{x.handle}{hold(x.avgHold) ? ` · ${hold(x.avgHold)} avg. hold` : ""}{x.external ? " · received from outside" : ""}</span>
                      </span>
                    </a>
                  </td>
                  <td className="num border-b border-rule/70 px-3 py-2 text-right"><b className="font-semibold text-ink">{usdK(x.value)}</b><span className="block text-sm text-muted">{amt(x.amount)}</span></td>
                  <td className={cn("num border-b border-rule/70 px-3 py-2 text-right", (x.pnl ?? 0) >= 0 ? "text-up" : "text-down")}>{usdSigned(x.pnl)}<span className="block text-sm">{pct(ret)}</span></td>
                  <td className="num border-b border-rule/70 px-3 py-2 text-right text-ink-2">{entryMc(x, mc)}<span className="block text-sm text-muted">{x.entry != null ? `$${x.entry.toPrecision(3)}` : ""}</span></td>
                  <td className="max-w-[420px] border-b border-rule/70 px-3 py-2 text-sm text-ink-2">{x.thesis ? <span className="line-clamp-2 whitespace-pre-line">{x.thesis.text}</span> : <span className="text-muted">—</span>}</td>
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
              <a href={traderHref(x.handle)} className="shrink-0"><Avatar src={x.pic} size={36} /></a>
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
