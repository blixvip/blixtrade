// The pieces every page is built from: the page frame, panels, a figure strip, table cells, a coin cell.
import { type CSSProperties, type ReactNode, useState } from "react";
import { ageStr } from "@/lib/format";
import { usePic } from "@/lib/pics";
import { thumb } from "@/lib/thumb";
import { previewHandlers } from "@/components/PicPreview";
import { cn } from "@/lib/utils";

export const ago = (t?: number | null) => (t ? `${ageStr(Date.now() - t)} ago` : "never");
export const money = (n?: number | null) => n == null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`;
export const mult = (x?: number | null) => (x == null ? "—" : `${x >= 10 ? x.toFixed(0) : x.toFixed(2)}x`);
export const toneX = (x?: number | null) => (x == null ? "text-muted" : x > 1.001 ? "text-up" : x < 0.999 ? "text-down" : "text-ink-2");
export const share = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

export function Page({ title, sub, right, children }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-3 p-3 max-md:pb-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl leading-none font-bold tracking-tight">{title}</h1>{sub && <p className="mt-1.5 text-md text-muted">{sub}</p>}</div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </header>
      {children}
    </div>
  );
}

export function Panel({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 overflow-hidden rounded-card border border-rule bg-paper-2", className)}>
      {title && <header className="flex min-h-11 items-center justify-between gap-3 border-b border-rule px-4 py-2"><h2 className="text-lg font-semibold whitespace-nowrap">{title}</h2>{aside && <span className="text-sm text-muted">{aside}</span>}</header>}
      {children}
    </section>
  );
}

// A strip of lead figures across the top of a page.
export function Kpis({ items }: { items: [label: string, value: ReactNode, sub?: ReactNode, tone?: string][] }) {
  // Tiles wrap and the last row stretches across, so an odd count never leaves an empty cell.
  return (
    <div className="flex flex-wrap overflow-hidden rounded-card border border-rule bg-paper-2">
      {items.map(([label, value, sub, tone]) => (
        <div key={label} className="flex min-w-0 flex-[1_1_150px] flex-col gap-1 border-r border-b border-rule px-4 py-3 -mr-px -mb-px">
          <span className="text-sm text-muted">{label}</span>
          <b className={cn("num truncate text-xl font-semibold", tone)}>{value}</b>
          {sub && <span className="num truncate text-sm text-muted">{sub}</span>}
        </div>
      ))}
    </div>
  );
}

export const th = "px-4 py-2.5 text-left text-sm font-medium whitespace-nowrap text-muted";
export const thR = cn(th, "text-right");
export const td = "border-t border-rule px-4 py-2.5 whitespace-nowrap";
export const tdR = cn(td, "num text-right");
export const Scroll = ({ children }: { children: ReactNode }) => <div className="overflow-x-auto">{children}</div>;
// Empty and waiting states: centered in whatever box they sit in (a Pulse column, a chart, a panel), a quiet
// icon in a ring, one line saying what is going on, an optional hint and an optional way out.
type StateIcon = "search" | "filter" | "chart" | "inbox" | "eye" | "bolt" | "spark" | "shield";
const ICONS: Record<StateIcon, ReactNode> = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  filter: <path d="M4 5h16l-6.2 7.4V19l-3.6-1.8v-4.8L4 5Z" />,
  chart: <><path d="M4 19h16" /><path d="M7 15v-4M12 15V7M17 15v-6" /></>,
  inbox: <><path d="M4 13h4l1.5 2.5h5L16 13h4" /><path d="M5.5 6h13L20 13v5H4v-5l1.5-7Z" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.6" /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />,
  spark: <path d="M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5ZM18.5 15.5c.3 1.8.9 2.4 2.5 2.7-1.6.3-2.2.9-2.5 2.7-.3-1.8-.9-2.4-2.5-2.7 1.6-.3 2.2-.9 2.5-2.7Z" />,
  shield: <><path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6l-7-2.5Z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
};
export const Spinner = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={cn("size-5 animate-spin text-muted", className)} fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".18" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);
const StateGlyph = ({ icon, className }: { icon: StateIcon; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon]}</svg>
);
export function EmptyState({ title, hint, icon = "inbox", loading, action, brand, className }: {
  title: ReactNode; hint?: ReactNode; icon?: StateIcon; loading?: boolean;
  action?: { label: string; onClick: () => void } | null; brand?: boolean; className?: string;
}) {
  // brand (Pulse columns): the state's glyph on a lit tile, title, hint and one way out. The action row is kept
  // even when empty, so columns side by side line their empty states up at the same height.
  if (brand) return (
    <div role="status" className={cn("flex h-full min-h-56 w-full flex-col items-center justify-center px-6 py-10 text-center animate-brand-in", className)}>
      <div className="relative mb-4 grid size-14 place-items-center">
        <span aria-hidden="true" className="absolute -inset-6 rounded-full bg-[radial-gradient(closest-side,oklch(100%_0_0/0.06),transparent)]" />
        <span className="relative grid size-14 place-items-center rounded-2xl border border-rule-2 bg-[linear-gradient(180deg,var(--color-paper-4),var(--color-paper-2))] text-ink-2 shadow-[inset_0_1px_0_oklch(100%_0_0/0.08),0_8px_20px_-8px_oklch(0%_0_0/0.7)]">
          {loading ? <Spinner /> : <StateGlyph icon={icon} className="size-6" />}
        </span>
      </div>
      <b className="text-md font-semibold tracking-tight text-ink">{title}</b>
      {hint && <span className="mt-1.5 max-w-64 text-sm leading-snug text-balance text-muted">{hint}</span>}
      <div className="mt-4 flex h-8 items-center">
        {action && (
          <button onClick={action.onClick}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-rule-2 bg-paper-3/70 pr-3.5 pl-3 text-xs font-semibold text-ink-2 transition-[color,border-color,background-color,scale] duration-150 hover:border-ink/35 hover:bg-paper-3 hover:text-ink active:scale-[0.97]">
            <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.6" /><path d="M3 2.5v2.8h2.8" /></svg>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
  return (
    <div role="status" className={cn("flex h-full min-h-40 w-full flex-col items-center justify-center gap-2.5 px-6 py-8 text-center", className)}>
      <span className="grid size-11 place-items-center rounded-full border border-rule-2 bg-paper-3/60 text-muted">
        {loading ? <Spinner /> : <StateGlyph icon={icon} className="size-5" />}
      </span>
      <b className="text-md font-semibold text-ink-2">{title}</b>
      {hint && <span className="max-w-72 text-sm leading-snug text-muted">{hint}</span>}
      {action && <button onClick={action.onClick} className="mt-1 h-7 rounded-full border border-rule-2 px-3.5 text-xs font-semibold text-ink-2 transition-colors duration-100 hover:border-ink/40 hover:text-ink">{action.label}</button>}
    </div>
  );
}
// The full-page loading screen: Blix's chrome wordmark with a light sweeping across it, a slow glow behind and a
// thin bar under it. The wordmark is drawn through a luminance mask of itself, so its black backdrop is fully
// transparent on any page colour, and the sheen goes through the same mask, lighting only the chrome.
const LOGO_MASK: CSSProperties = { maskImage: "url(brand/blix-chrome.webp)", maskMode: "luminance", maskSize: "100% 100%", WebkitMaskImage: "url(brand/blix-chrome.webp)", WebkitMaskSize: "100% 100%" } as CSSProperties;
export function BrandLoader({ label, className }: { label?: ReactNode; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col items-center justify-center gap-5 animate-brand-in", className)}>
      <div className="relative w-44 sm:w-52">
        <span aria-hidden="true" className="absolute inset-[-35%] rounded-full bg-[radial-gradient(closest-side,oklch(100%_0_0/0.09),transparent)] blur-2xl animate-brand-glow motion-reduce:animate-none" />
        <div className="relative aspect-[600/260]" style={LOGO_MASK}>
          <img src="brand/blix-chrome.webp" crossOrigin="anonymous" alt="Blix" width={600} height={260} draggable={false} className="block size-full select-none" />
          <span aria-hidden="true" className="absolute inset-0 animate-brand-sheen motion-reduce:animate-none bg-[linear-gradient(100deg,transparent_42%,oklch(100%_0_0/0.75)_50%,transparent_58%)] bg-size-[250%_100%] bg-no-repeat" />
        </div>
      </div>
      <div className="h-0.5 w-28 overflow-hidden rounded-full bg-paper-4">
        <div className="h-full w-2/5 rounded-full bg-gradient-to-r from-transparent via-ink to-transparent animate-brand-bar motion-reduce:animate-none" />
      </div>
      {label && <span className="text-xs font-medium tracking-[0.18em] text-muted uppercase">{label}</span>}
    </div>
  );
}
export const Empty = ({ children }: { children: ReactNode }) => <EmptyState title={children} className="min-h-36" />;
export const Loading = () => <div className="h-24 animate-pulse rounded-card border border-rule bg-paper-2" />;
// The server's and the Worker's answer to a visitor who is not signed in (server/webapp.js, worker/index.js).
export const needsSignIn = (text?: string | null) => !!text && /^Sign in (at blixvip\.com )?to use Blix/.test(text);
// What a visitor who is not signed in sees instead of an error: the wordmark, one line on what Blix is, and the
// way in. Signing in happens on blixvip.com (its /login and /start), so from any other host the links go there.
export function SignInCard({ onRetry, className }: { onRetry?: () => void; className?: string }) {
  const home = location.hostname.endsWith("blixvip.com") ? "" : "https://blixvip.com";
  return (
    <div className={cn("grid w-full place-items-center px-4 py-10", className)}>
      <div className="relative flex w-full max-w-sm flex-col items-center gap-5 overflow-hidden rounded-card border border-rule-2 bg-paper-2 px-7 pt-9 pb-7 text-center shadow-sheet animate-brand-in">
        <span aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(100%_0_0/0.07),transparent)] blur-2xl" />
        <img src="brand/blix-chrome.webp" alt="Blix" width={600} height={260} draggable={false} className="relative h-12 w-auto select-none mix-blend-screen" />
        <div className="relative">
          <h1 className="text-xl font-semibold tracking-tight">Sign in to use Blix</h1>
          <p className="mx-auto mt-2 max-w-64 text-md leading-snug text-muted">Live pump.fun launches, AI coin ratings and paper trading. Free with a Google account.</p>
        </div>
        <div className="relative flex w-full flex-col gap-2">
          <a href={`${home}/login`} className="flex h-11 w-full items-center justify-center rounded-full bg-ink text-lg font-semibold text-on-fill transition-transform duration-100 hover:bg-focus active:scale-[0.98]">Log in</a>
          <a href={`${home}/start`} className="flex h-11 w-full items-center justify-center rounded-full border border-rule-2 text-lg font-semibold text-ink-2 transition-colors duration-100 hover:border-ink/40 hover:text-ink">Create a free account</a>
        </div>
        {onRetry && <button onClick={onRetry} className="relative text-sm text-muted underline decoration-rule-2 underline-offset-2 transition-colors duration-100 hover:text-ink">Already signed in? Check again</button>}
      </div>
    </div>
  );
}
export const Problem = ({ text }: { text: string }) => needsSignIn(text) ? <SignInCard />
  : <p className="rounded-control border border-down/40 bg-down/10 px-3 py-2 text-md text-ink-2">Blix did not answer: {text}</p>;

// A coin's picture, laid over its ticker letters (lib/pics.ts loads it and retries a miss). Hidden until
// loaded: never a broken-image box.
// The first screenful of logos after a navigation loads at once, alongside the page's data (lazy + low priority
// had Chrome queue them behind everything else: a visible wait even for cached ones); the rest, further down,
// lazily and behind the rest.
const EAGER = 40;
let eagerLeft = EAGER;
if (typeof window !== "undefined") addEventListener("hashchange", () => { eagerLeft = EAGER; });
// A new list in place (a Discover tab or window): its first screenful is again the one to load first.
export const eagerAgain = () => { eagerLeft = EAGER; };
// `fallback`: the picture link a list carried for the coin (Fomo's, pump.fun's), drawn underneath while Blix's own
// copy has not loaded after a first try, so a coin is never shown without its logo for long.
// `preview`: false where a hover already shows something else (Discover rows open their coin card instead).
export function CoinImg({ mint, className, fallback, preview = true }: { mint: string; className?: string; fallback?: string | null; preview?: boolean }) {
  const pic = usePic(mint);
  const [eager] = useState(() => eagerLeft > 0 && (eagerLeft--, true));
  const [fbBad, setFbBad] = useState(false);
  const fb = fallback && !fbBad && pic.missed ? thumb(fallback, 48) : null;
  // Resting the pointer on it shows it big (PicPreview).
  const big = preview ? previewHandlers(mint, { fallback }) : {};
  return (
    <>
      {fb && <img src={fb} alt="" decoding="async" draggable={false} onError={() => setFbBad(true)} {...big} className={cn("absolute inset-0 size-full object-cover", className)} />}
      {pic.src && <img {...big} key={pic.key} src={pic.src} alt="" decoding="async" loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "auto" : "low"} draggable={false} onLoad={pic.onLoad} onError={pic.onError}
        className={cn("absolute inset-0 size-full object-cover transition-opacity duration-150", pic.ok ? "opacity-100" : "opacity-0", className)} />}
    </>
  );
}

// A coin: picture, ticker and name. Opens the coin page.
export function CoinCell({ mint, symbol, name, sub }: { mint: string; symbol?: string | null; name?: string | null; sub?: ReactNode }) {
  return (
    <a href={`#/coin/${mint}`} className="flex min-w-0 items-center gap-2.5 hover:text-ink">
      <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-chip bg-paper-4 text-2xs font-semibold text-muted uppercase">
        {(symbol || "?").slice(0, 3)}
        <CoinImg mint={mint} />
      </span>
      <span className="flex min-w-0 flex-col"><b className="truncate font-semibold text-ink">{symbol || "?"}</b><span className="max-w-56 truncate text-sm text-muted">{sub ?? name}</span></span>
    </a>
  );
}

// A small filled tag: a signal kind, a state.
export function Tag({ children, tone = "ink" }: { children: ReactNode; tone?: "up" | "down" | "warn" | "ink" | "info" }) {
  const c = { up: "border-up/40 text-up", down: "border-down/40 text-down", warn: "border-warn/40 text-warn", info: "border-info/40 text-info", ink: "border-rule-2 text-ink-2" }[tone];
  return <span className={cn("inline-flex h-5.5 items-center rounded-full border px-2 text-sm font-medium whitespace-nowrap", c)}>{children}</span>;
}

export const gradeTone = (g?: string | null) => !g ? "text-muted" : g.startsWith("A") ? "text-up" : g.startsWith("B") ? "text-info" : g.startsWith("C") ? "text-warn" : g === "D" ? "text-caution" : "text-down";

// The AI's markdown, kept simple: headings, bullets, bold.
export function Markdown({ src }: { src: string }) {
  const bold = (s: string) => s.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <b key={i} className="font-semibold text-ink">{p}</b> : p));
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { out.push(<ul key={out.length} className="ml-5 flex list-disc flex-col gap-1">{list.map((l, i) => <li key={i}>{bold(l)}</li>)}</ul>); list = []; } };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^[-*] /.test(line)) { list.push(line.slice(2)); continue; }
    flush();
    if (!line) continue;
    if (/^#{1,4} /.test(line)) out.push(<h3 key={out.length} className="mt-2 text-lg font-semibold text-ink first:mt-0">{line.replace(/^#+ /, "")}</h3>);
    else out.push(<p key={out.length}>{bold(line)}</p>);
  }
  flush();
  return <div className="flex flex-col gap-2 text-md leading-relaxed text-ink-2">{out}</div>;
}
