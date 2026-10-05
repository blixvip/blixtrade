// The pieces every page is built from: the page frame, panels, a figure strip, table cells, a coin cell.
import { type ReactNode } from "react";
import { ageStr } from "@/lib/format";
import { usePic } from "@/lib/pics";
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
  return (
    <div className="grid overflow-hidden rounded-card border border-rule bg-paper-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
      {items.map(([label, value, sub, tone]) => (
        <div key={label} className="flex min-w-0 flex-col gap-1 border-r border-b border-rule px-4 py-3 -mr-px -mb-px">
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
export const Empty = ({ children }: { children: ReactNode }) => <p className="px-4 py-10 text-center text-md text-muted">{children}</p>;
export const Loading = () => <div className="h-24 animate-pulse rounded-card border border-rule bg-paper-2" />;
export const Problem = ({ text }: { text: string }) => <p className="rounded-control border border-down/40 bg-down/10 px-3 py-2 text-md text-ink-2">Blix did not answer: {text}</p>;

// A coin's picture, laid over its ticker letters (lib/pics.ts loads it and retries a miss). Hidden until
// loaded: never a broken-image box.
export function CoinImg({ mint, className }: { mint: string; className?: string }) {
  const pic = usePic(mint);
  if (!pic.src) return null;
  return (
    <img key={pic.key} src={pic.src} alt="" decoding="async" draggable={false} onLoad={pic.onLoad} onError={pic.onError}
      className={cn("absolute inset-0 size-full object-cover transition-opacity duration-150", pic.ok ? "opacity-100" : "opacity-0", className)} />
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
