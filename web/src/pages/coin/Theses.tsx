// The coin's Theses tab: every thesis on this coin from pump.fun and Fomo in one list. pump.fun's are its callouts
// (a trader's thesis posted with their position: market cap when called, the multiple since, profit, updates);
// Fomo's are the theses written with a trade (likes, replies, the author's position now). Sorted by most liked
// or newest, filtered by source. Data: /api/coin/<mint>/callouts (server/pumpfeed.js, public pump.fun API, every few seconds)
// and the Fomo read the page already has (/api/coin/<mint>/fomo, through Aside). pump.fun's multiples and
// profits move with the coin's live market cap; new theses slide in once.
// Shown as cards (2026-10-10 redesign): a summary strip on top, each card leads with the multiple since the call,
// then the call/now/position chips, the thesis folded to five lines and its updates folded to the latest.
import { useRef, useState, type ReactNode } from "react";
import { usdK, usdSigned, usePoll } from "@/lib/coin";
import { ageStr } from "@/lib/format";
import { useNow } from "@/lib/route";
import { cn } from "@/lib/utils";
import { useMe } from "@/lib/ui";
import { Button } from "@/components/ui/button";
import { thumb } from "@/lib/thumb";
import { SiteLogo } from "@/components/logos";
import { movePosition, useArrivals, useMcNow } from "@/components/postLive";
import { Avatar, traderHref } from "../traders/parts";
import type { CoinFomo } from "./FomoTabs";
import { useLivePrice } from "@/lib/livepx";
import { markOpenHolding } from "@/lib/wallet-values";
import { CIcon, Empty } from "./parts";

interface Callout {
  id: string; posted: number | null; t: number | null; likes: number; replies: number; views?: number;
  user: { pump: string | null; wallet?: string | null; name: string; pic: string | null; verified: boolean; x: string | null };
  comment: string | null; media: string | null; updates?: { id: string; text: string; t: number | null; media: string | null }[];
  entryMc: number | null; multiple: number | null; maxMultiple: number | null; sizeUsd: number | null; pnlUsd: number | null; pnlPct: number | null;
}
interface Callouts { items: Callout[] | null; total: number | null; t: number | null; error: string | null }

// One thesis, whichever site it came from.
interface Post {
  id: string; src: "pump" | "fomo"; name: string; handle: string | null; href?: string; external?: boolean; pic: string | null; t: number; mc: number | null; text: string;
  likes: number; replies: number; views?: number; dev?: boolean; tracked?: boolean; verified?: boolean; media?: string | null; multiple?: number | null;
  updates?: Callout["updates"]; entryMc?: number | null; snapMc?: number | null; hold?: { value: number | null; pnl: number | null; pct: number | null; closed?: boolean } | null;
}

// pump.fun writes mentions as @[name](user id); shown as @name.
const clean = (t: string) => t.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, "@$1");
const pct = (n: number | null | undefined) => (n == null || !isFinite(n) ? "" : `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`);
const mult = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 1 })}x`;
// The multiple since a thesis was posted, at the live market cap (pump.fun's own figure until the live one is in).
const sinceCall = (x: Post, mcNow: number | null) => {
  const at = x.entryMc ?? x.mc;
  return mcNow && at ? mcNow / at : x.multiple ?? null;
};
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

export function AllTheses({ mint, f }: { mint: string; f: CoinFomo | null }) {
  const account = useMe((s) => s.me?.address || s.me?.email || "guest");
  const [sort, setSort] = useState<"top" | "new">("top");
  const [src, setSrc] = useState<"all" | "pump" | "fomo">("all");
  const now = useNow();
  const { data: pc } = usePoll<Callouts>(`coin/${mint}/callouts`, 4_000);
  const price = useLivePrice(mint);

  const pump: Post[] = (pc?.items || []).map((x) => ({
    id: x.id, src: "pump", name: x.user.name, handle: x.user.pump, href: x.user.wallet ? `#/trader/${x.user.wallet}` : undefined, external: false,
    pic: x.user.pic, t: x.posted || x.t || 0, mc: x.entryMc, text: clean(x.comment || ""), likes: x.likes, replies: x.replies, views: x.views, verified: x.user.verified,
    media: x.media, multiple: x.multiple, entryMc: x.entryMc, snapMc: x.entryMc && x.multiple ? x.entryMc * x.multiple : null, updates: (x.updates || []).map((u) => ({ ...u, text: clean(u.text) })), hold: { value: x.sizeUsd, pnl: x.pnlUsd, pct: x.pnlPct },
  }));
  const fomo: Post[] = (f?.theses || []).map((original) => {
    const x = { ...original, position: original.position ? markOpenHolding(original.position, price, now) : null };
    return ({
    id: `fomo:${x.id}`, src: "fomo", name: x.name || x.handle || "anon", handle: x.handle, href: traderHref(x.handle), pic: x.pic, t: Date.parse(x.t) || 0, mc: x.mcap, text: x.text,
    likes: x.likes || 0, replies: x.replies || 0, dev: x.dev, tracked: Boolean(x.wallet), verified: x.verified,
    hold: x.position ? { value: x.position.value, pnl: x.position.closed ? x.position.realized : x.position.unrealized, pct: x.position.pct, closed: Boolean(x.position.closed) } : null,
  }); });
  const mcNow = useMcNow(mint, null);
  const all = [...(src !== "fomo" ? pump : []), ...(src !== "pump" ? fomo : [])]
    .sort((a, b) => (sort === "new" ? b.t - a.t : b.likes - a.likes || b.t - a.t));

  const fresh = useArrivals(all.map((x) => x.id));
  // Nothing in hand yet from either site: the list's outline, no words.
  const waiting = !pc?.items && !(f?.error && !f.read) && (!f || f.loading || !f.read);
  const fomoNote: string | null = null; // no outside-site prompts or Fomo outage notes (the user's rule)

  // The room at a glance: how pump.fun's calls are doing at the live market cap, the best one, who still holds.
  const calls = [...pump, ...fomo].map((x) => sinceCall(x, mcNow)).filter((m): m is number => m != null && isFinite(m) && m > 0);
  const up = calls.filter((m) => m >= 1).length;
  const best = calls.length ? Math.max(...calls) : null;
  const sorted = [...calls].sort((a, b) => a - b), median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const likes = [...pump, ...fomo].reduce((t, x) => t + x.likes, 0);
  const total = pump.length + fomo.length;

  return (
    <div className="flex flex-col">
      {total > 0 && (
        <div className="grid grid-cols-2 gap-px border-b border-rule bg-rule sm:grid-cols-4">
          <Sum k="Theses" v={String(total)} sub={`${pump.length} pump.fun · ${fomo.length} Fomo`} />
          <Sum k="Calls in profit" v={calls.length ? `${up} of ${calls.length}` : "—"} sub={calls.length ? `${Math.round((up / calls.length) * 100)}% are up since the call` : "No calls with a market cap yet"} tone={calls.length ? (up * 2 >= calls.length ? "up" : "down") : undefined} />
          <Sum k="Best call" v={best != null ? mult(best) : "—"} sub="since it was called" tone={best != null ? (best >= 1 ? "up" : "down") : undefined} />
          <Sum k="Median call" v={median != null ? mult(median) : "—"} sub={`${compact(likes)} likes in all`} tone={median != null ? (median >= 1 ? "up" : "down") : undefined} />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Seg value={sort} onChange={setSort} label="Sort theses" options={[["top", "Most liked"], ["new", "Newest"]]} />
          <Seg value={src} onChange={setSrc} label="Source" options={[["all", "All"], ["pump", "pump.fun"], ["fomo", "Fomo"]]} counts={{ all: total, pump: pump.length, fomo: fomo.length }} />
        </div>
        {fomoNote && <span className="text-sm text-muted">{fomoNote}</span>}
      </div>
      <CalloutDraft key={`${account}:${mint}`} storageKey={`blix:callout:${account}:${mint}`} mint={mint} />
      {all.length ? (
        <div className="grid grid-cols-1 items-start gap-2.5 px-3 pb-3 2xl:grid-cols-2">
          {all.map((x) => <Card key={x.id} x={x} now={now} mcNow={mcNow} fresh={fresh.has(x.id)} />)}
        </div>
      ) : waiting ? <Ghost />
        : <Empty title="No theses yet" text="A thesis is why a trader bought, posted with their trade on pump.fun or Fomo. New ones show up here by themselves." />}
    </div>
  );
}

function CalloutDraft({ mint, storageKey }: { mint: string; storageKey: string }) {
  const [draft, setDraft] = useState(() => {
    try { return sessionStorage.getItem(storageKey) || ""; } catch { return ""; }
  });
  const [destination, setDestination] = useState<"pump" | "fomo" | "both">(() => {
    try {
      const saved = sessionStorage.getItem(`${storageKey}:destination`);
      return saved === "fomo" || saved === "both" ? saved : "pump";
    } catch { return "pump"; }
  });
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const editVersion = useRef(0);
  const destinations = [
    { id: "pump", name: "Pump.fun", href: `https://pump.fun/coin/${encodeURIComponent(mint)}` },
    { id: "fomo", name: "FOMO", href: `https://fomo.family/tokens/solana/${encodeURIComponent(mint)}` },
  ].filter((site) => destination === "both" || site.id === destination);
  const destinationNames = destinations.map((site) => site.name).join(" and ");
  async function copy() {
    const version = ++editVersion.current;
    setStatus("copying");
    try { await navigator.clipboard.writeText(draft); if (version === editVersion.current) setStatus("copied"); }
    catch { if (version === editVersion.current) setStatus("error"); }
  }
  return (
    <div className="mx-3 mb-3 rounded-card border border-rule bg-paper-2/60 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="callout-draft" className="text-sm font-semibold text-ink">Write a thesis</label>
        <fieldset aria-label="Post destination" className="inline-flex gap-0.5 rounded-full bg-paper-3 p-0.5">
          {([["pump", "Pump.fun"], ["fomo", "FOMO"], ["both", "Both"]] as const).map(([value, label]) => (
            <label key={value} className="cursor-pointer">
              <input type="radio" name="thesis-destination" value={value} checked={destination === value}
                className="peer sr-only" onChange={() => {
                  setDestination(value);
                  try { sessionStorage.setItem(`${storageKey}:destination`, value); } catch { /* Selection works without storage. */ }
                }} />
              <span className="flex min-h-8 items-center rounded-full px-3 text-sm font-semibold text-muted transition-colors hover:text-ink peer-checked:bg-paper-4 peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">{label}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <p id="callout-help" className="mt-2 text-sm text-muted">Copy your draft, then paste and publish on {destinationNames}.</p>
      <textarea id="callout-draft" aria-describedby="callout-help" rows={3} value={draft}
        placeholder="What’s your take on this coin?"
        onChange={(e) => {
          const value = e.target.value;
          editVersion.current++;
          setDraft(value); setStatus("idle");
          try { if (value) sessionStorage.setItem(storageKey, value); else sessionStorage.removeItem(storageKey); } catch { /* Typing still works without storage. */ }
        }}
        className="mt-2 block min-h-24 w-full resize-y rounded-control border border-rule-2 bg-paper px-3 py-2 text-md text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="lg" className="min-h-9 rounded-full" disabled={!draft.trim() || status === "copying"} onClick={copy}>
          {status === "copying" ? "Copying…" : status === "copied" ? "Copied" : "Copy draft"}
        </Button>
        {destinations.map((site) => <a key={site.id} href={site.href} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-rule-2 bg-paper-3 px-3 text-sm font-semibold text-ink transition-colors hover:bg-paper-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          Open {site.name}<CIcon.external className="size-3.5" />
        </a>)}
      </div>
      {destination !== "pump" && <p className="mt-2 text-sm text-muted">FOMO theses attach to an eligible trade in your FOMO account.</p>}
      <p role="status" className={cn("mt-2 text-sm", status === "error" ? "text-down" : "text-muted")}>
        {status === "error" ? "Couldn’t copy. Select the text and copy it manually." : status === "copied" ? `Copied. Open ${destinationNames} to paste and publish.` : "Draft only · nothing posted yet"}
      </p>
    </div>
  );
}

function Sum({ k, v, sub, tone }: { k: string; v: string; sub: string; tone?: "up" | "down" }) {
  return (
    <div className="bg-paper px-3.5 py-2.5">
      <p className="label text-muted">{k}</p>
      <p className={cn("num mt-0.5 text-lg font-bold", tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink")}>{v}</p>
      <p className="truncate text-xs text-muted">{sub}</p>
    </div>
  );
}

function Seg<T extends string>({ value, onChange, options, label, counts }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string; counts?: Partial<Record<T, number>> }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-0.5 rounded-full bg-paper-2 p-0.5 shadow-[inset_0_0_0_1px_var(--color-rule)]">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn("flex h-7 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors", value === v ? "bg-paper-4 text-ink" : "text-muted hover:text-ink-2")}>
          {l}{counts?.[v] ? <span className="num text-xs font-medium text-muted">{counts[v]}</span> : null}
        </button>
      ))}
    </div>
  );
}

// Web addresses in a thesis open in a new tab (updates are often a bare x.com link).
const URL_RE = /(https?:\/\/[^\s]+)/g;
function linkify(text: string) {
  return text.split(URL_RE).map((part, i) => i % 2
    ? <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="break-all text-info hover:underline">{part.replace(/^https?:\/\/(www\.)?/, "").replace(/\?s=\d+$/, "")}</a>
    : part);
}

// Long text folds to a few lines, with Show more.
function Text({ text, lines, className }: { text: string; lines: 2 | 5; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 95 || text.split("\n").length > lines;
  return (
    <div className={className}>
      <p className={cn("break-words whitespace-pre-line", !open && long && (lines === 2 ? "line-clamp-2" : "line-clamp-5"))}>{linkify(text)}</p>
      {long && <button onClick={() => setOpen(!open)} className="mt-0.5 text-sm font-semibold text-muted hover:text-ink">{open ? "Show less" : "Show more"}</button>}
    </div>
  );
}

function Card({ x, now, mcNow, fresh }: { x: Post; now: number; mcNow: number | null; fresh?: boolean }) {
  const [allUpdates, setAllUpdates] = useState(false);
  const link = (body: ReactNode, cls?: string) => x.href ? <a href={x.href} target={x.external ? "_blank" : undefined} rel={x.external ? "noreferrer" : undefined} className={cls}>{body}</a> : <span className={cls}>{body}</span>;
  // pump.fun's figures were read at snapMc: the multiple and an open position follow the live market cap.
  const live = x.src === "pump" && mcNow && x.snapMc;
  const m = sinceCall(x, mcNow);
  const h = x.hold && live && !x.hold.closed ? { ...x.hold, ...movePosition(x.hold, x.snapMc, mcNow) } : x.hold;
  const ups = x.updates || [];
  const shown = allUpdates ? ups : ups.slice(-1);
  return (
    <article className={cn("flex min-w-0 flex-col gap-3 rounded-card border border-rule bg-paper-2/60 p-3.5 transition-colors duration-150 hover:border-rule-2 hover:bg-paper-2", fresh && "animate-row-in")}>
      <header className="flex items-start gap-3">
        {link(<Avatar src={x.pic} name={x.name} size={40} className="rounded-full" />, "shrink-0 rounded-full")}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {link(x.name, "truncate text-md font-semibold text-ink hover:text-focus")}
            {x.dev && <span className="rounded-chip bg-warn/15 px-1 text-[10px] font-bold text-warn">DEV</span>}
            {x.tracked && <span className="rounded-chip bg-up/10 px-1 text-[10px] font-bold text-up">TRACKED</span>}
          </div>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <SiteLogo site={x.src === "pump" ? "pumpfun" : "fomo"} className="size-3" />
            <span className="truncate">{x.src === "pump" ? "pump.fun" : x.handle ? `@${x.handle}` : "Fomo"}</span>
            <span>·</span><span className="shrink-0">{x.t ? `${ageStr(now - x.t)} ago` : "just now"}</span>
          </p>
        </div>
        {m ? (
          <div className="flex shrink-0 flex-col items-end">
            <span className={cn("num rounded-full px-2.5 py-0.5 text-md font-bold", m >= 1 ? "bg-up/12 text-up" : "bg-down/12 text-down")}>{mult(m)}</span>
            <span className="mt-0.5 text-2xs text-muted">since the call</span>
          </div>
        ) : null}
      </header>

      {(x.mc || h) && (
        <div className="flex flex-wrap gap-1.5">
          {x.mc ? <Chip k="Called at" v={usdK(x.mc)} /> : null}
          {x.mc && mcNow ? <Chip k="Now" v={usdK(mcNow)} /> : null}
          {h && (h.closed ? <Chip k="Closed" v={h.pnl != null ? usdSigned(h.pnl) : "—"} tone={h.pnl != null ? (h.pnl >= 0 ? "up" : "down") : undefined} />
            : h.value != null ? <>
                <Chip k="Holds" v={usdK(h.value)} />
                {h.pnl != null && <Chip k="PnL" v={`${usdSigned(h.pnl)}${h.pct != null && isFinite(h.pct) ? ` ${pct(h.pct)}` : ""}`} tone={h.pnl >= 0 ? "up" : "down"} />}
              </>
            : h.pnl != null ? <Chip k="PnL" v={`${usdSigned(h.pnl)} ${pct(h.pct)}`} tone={h.pnl >= 0 ? "up" : "down"} /> : null)}
        </div>
      )}

      {x.text && <Text text={x.text} lines={5} className="text-md leading-relaxed text-ink" />}
      {x.media && <img src={thumb(x.media, 480, { fit: "inside" })} alt="" loading="lazy" decoding="async" className="max-h-64 w-fit max-w-full rounded-control border border-rule-2 object-cover" />}

      {ups.length > 0 && (
        <div className="flex flex-col gap-2 rounded-control bg-paper-3/50 p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-ink-2">{ups.length === 1 ? "Update" : allUpdates ? `${ups.length} updates` : `Latest of ${ups.length} updates`}</span>
            {ups.length > 1 && <button onClick={() => setAllUpdates(!allUpdates)} className="font-semibold text-muted hover:text-ink">{allUpdates ? "Show latest" : "Show all"}</button>}
          </div>
          <ol className="flex flex-col gap-2.5">
            {shown.map((u) => (
              <li key={u.id} className="relative pl-4 before:absolute before:top-1.5 before:left-0.5 before:size-1.5 before:rounded-full before:bg-accent after:absolute after:top-4 after:-bottom-2.5 after:left-[4.5px] after:w-px after:bg-rule-2 last:after:hidden">
                <span className="text-2xs text-muted">{u.t ? `${ageStr(now - u.t)} ago` : ""}</span>
                {u.text && <Text text={u.text} lines={2} className="text-sm leading-snug text-ink-2" />}
                {u.media && <img src={thumb(u.media, 320, { fit: "inside" })} alt="" loading="lazy" decoding="async" className="mt-1 max-h-40 rounded-control border border-rule-2 object-cover" />}
              </li>
            ))}
          </ol>
        </div>
      )}

      <footer className="flex items-center gap-4 text-sm text-muted">
        <span className="flex items-center gap-1" title="Likes"><svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.9 4.5c2.1 0 3.6 1.1 4.6 2.6.9-1.5 2.5-2.6 4.6-2.6 3.9 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21z" /></svg><b className="num font-semibold text-ink-2">{compact(x.likes)}</b></span>
        {x.replies > 0 && <span className="flex items-center gap-1" title="Replies"><svg viewBox="0 0 24 24" className="size-3.5 fill-none stroke-current stroke-2" aria-hidden><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg><span className="num">{compact(x.replies)}</span></span>}
        {x.views ? <span className="flex items-center gap-1" title="Views"><svg viewBox="0 0 24 24" className="size-3.5 fill-none stroke-current stroke-2" aria-hidden><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg><span className="num">{compact(x.views)}</span></span> : null}
      </footer>
    </article>
  );
}

function Chip({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-paper-3 px-2.5 py-1 text-xs">
      <span className="text-muted">{k}</span>
      <b className={cn("num font-semibold", tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink-2")}>{v}</b>
    </span>
  );
}

function Ghost() {
  return (
    <div aria-hidden className="grid grid-cols-1 gap-2.5 p-3 2xl:grid-cols-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-card border border-rule p-3.5">
          <div className="flex items-center gap-3"><span className="size-10 shrink-0 rounded-full bg-paper-3" /><div className="flex flex-1 flex-col gap-1.5"><span className="h-3 w-32 rounded bg-paper-3" /><span className="h-2.5 w-20 rounded bg-paper-3" /></div></div>
          <div className="flex gap-1.5"><span className="h-6 w-24 rounded-full bg-paper-3" /><span className="h-6 w-20 rounded-full bg-paper-3" /></div>
          <span className="h-3 w-full rounded bg-paper-3" /><span className="h-3 w-2/3 rounded bg-paper-3" />
        </div>
      ))}
    </div>
  );
}
