// Pieces of the API and MCP pages (Docs.tsx): line icons, icon tiles, code blocks with tabs and copy,
// JSON and code highlighting, the "on this page" nav that follows the reader, and section frames.
// The same design as the classic pages (public/docs.js, docs.css), drawn with this app's tokens.
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------- icons (24px grid, stroked with currentColor; static strings, drawn as markup) ----------
const P: Record<string, string> = {
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  pulse: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/><path d="M3.2 12h6.3l.5-1 2 4.5 2-7 1.5 3.5h5.3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0"/><path d="M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  grad: '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/><path d="M22 10v6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  news: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/>',
  play: '<polygon points="7 4 20 12 7 20 7 4" fill="currentColor"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9l-3.8 3.8z"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18"/><path d="M7 6h1v4"/><path d="m16.7 13.9.7.7-2.8 2.8"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9A2.5 2 0 0 0 12 8c-1.7 0-3 .9-3 2s1.3 2 3 2 3 .9 3 2-1.3 2-3 2a3 2.4 0 0 1-2.8-1"/><path d="M12 6v2"/><path d="M12 16v2"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  candles: '<path d="M9 5v4"/><rect x="7" y="9" width="4" height="6" rx="1"/><path d="M9 15v2"/><path d="M17 3v2"/><rect x="15" y="5" width="4" height="8" rx="1"/><path d="M17 13v3"/><path d="M3 21h18"/>',
  swap: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.7V17c0 .6-.5 1-1 1.2-1.2.5-2 2-2 3.8"/><path d="M14 14.7V17c0 .6.5 1 1 1.2 1.2.5 2 2 2 3.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  buy: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  sell: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  chevron: '<polyline points="6 9 12 15 18 9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>',
};
export type IconName = keyof typeof P;
export function DI({ name, className }: { name: IconName; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("size-4 shrink-0", className)} dangerouslySetInnerHTML={{ __html: P[name] ?? P.code }} />;
}
// A graphite tile with a lit top edge, holding one icon.
export function Tile({ name, small }: { name: IconName; small?: boolean }) {
  return (
    <span className={cn("inline-grid shrink-0 place-items-center border border-rule-2 text-ink shadow-raised", small ? "size-[30px] rounded-[9px] [&_svg]:size-[15px]" : "size-9 rounded-[11px] [&_svg]:size-[17px]")}
      style={{ background: "linear-gradient(180deg, var(--color-paper-5), var(--color-paper-3))" }}>
      <DI name={name} />
    </span>
  );
}

// ---------- copying ----------
// `copied` is the key of whatever was copied in the last 1.4 s (the copy icon turns into a check).
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(null), 1400); return () => clearTimeout(t); }, [copied]);
  const copy = (text: string, key = text) => { navigator.clipboard?.writeText(text).then(() => setCopied(key), () => {}); };
  return { copied, copy };
}

// ---------- highlighting ----------
// JSON: keys, strings, numbers and literals marked; the rest is plain text.
export function JsonText({ text }: { text: string }) {
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const out: ReactNode[] = [];
  let i = 0, k = 0;
  for (const m of text.matchAll(re)) {
    const [all, str, colon, lit] = m;
    if (m.index! > i) out.push(text.slice(i, m.index));
    if (str) out.push(<span key={k++} className={colon ? "text-ink" : "text-info"}>{str}</span>, colon || "");
    else out.push(<span key={k++} className={lit ? "text-[oklch(80%_0.08_300)]" : "text-warn"}>{all}</span>);
    i = m.index! + all.length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}
// Code samples: strings and comments picked out; the <blix folder> placeholder marked as one to replace.
export function CodeText({ text }: { text: string }) {
  const re = /(#[^\n]*|\/\/[^\n]*)|("[^"\n]*"|'[^'\n]*')|(<blix folder>)/g;
  const out: ReactNode[] = [];
  let i = 0, k = 0;
  for (const m of text.matchAll(re)) {
    const [all, comment, str, ph] = m;
    // A "//" inside a URL is not a comment.
    if (comment && comment.startsWith("//") && m.index! > 0 && !/\s/.test(text[m.index! - 1])) continue;
    if (m.index! > i) out.push(text.slice(i, m.index));
    if (comment) out.push(<span key={k++} className="text-muted italic">{all}</span>);
    else if (str) out.push(<span key={k++} className="text-info"><Placeholders text={str} /></span>);
    else if (ph) out.push(<Ph key={k++} />);
    i = m.index! + all.length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}
const Ph = () => <span className="rounded-chip bg-warn/15 px-1 text-warn">{"<blix folder>"}</span>;
function Placeholders({ text }: { text: string }) {
  const parts = text.split("<blix folder>");
  return <>{parts.map((p, i) => <span key={i}>{i > 0 && <Ph />}{p}</span>)}</>;
}

// ---------- code block ----------
export interface Sample { label: string; icon: IconName; code: string }
export function CodeBlock({ samples, className }: { samples: Sample[]; className?: string }) {
  const [tab, setTab] = useState(0);
  const { copied, copy } = useCopy();
  const s = samples[Math.min(tab, samples.length - 1)];
  return (
    <div className={cn("overflow-hidden rounded-[14px] border border-rule bg-paper shadow-panel", className)}>
      <div className="metal-bar flex items-center gap-2 border-b border-rule py-1.5 pr-2 pl-2.5">
        {samples.length > 1 ? (
          <div role="tablist" className="flex min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {samples.map((x, i) => (
              <button key={x.label} role="tab" aria-selected={i === tab} onClick={() => setTab(i)}
                className={cn("inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-md font-semibold whitespace-nowrap transition-colors duration-150 [&_svg]:size-3.5",
                  i === tab ? "bg-ink/8 text-ink shadow-[inset_0_1px_0_var(--color-edge)]" : "text-muted hover:text-ink")}>
                <DI name={x.icon} />{x.label}
              </button>
            ))}
          </div>
        ) : <span className="inline-flex items-center gap-1.5 px-1 text-md font-semibold text-ink-2 [&_svg]:size-3.5"><DI name={s.icon} />{s.label}</span>}
        <CopyButton done={copied === s.code} onClick={() => copy(s.code)} />
      </div>
      <pre className="m-0 max-h-[440px] overflow-auto px-5 py-4 font-outlier text-[12.5px] leading-[1.7] whitespace-pre text-ink-2"><CodeText text={s.code} /></pre>
    </div>
  );
}
export function CopyButton({ done, onClick, label = "Copy" }: { done: boolean; onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} aria-label={label}
      className={cn("ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border border-transparent px-2.5 py-1 text-sm font-semibold transition-colors duration-150 [&_svg]:size-3.5",
        done ? "text-up" : "text-muted hover:border-rule-2 hover:text-ink")}>
      <DI name={done ? "check" : "copy"} />{done ? "Copied" : label}
    </button>
  );
}

// ---------- page frame ----------
export interface NavItem { id: string; label: string; icon: IconName; n?: number }
// "On this page": a column on wide screens, a row of chips on narrow ones. Lights the section being read.
export function SectionNav({ items }: { items: NavItem[] }) {
  const [on, setOn] = useState(items[0]?.id);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) setOn(e.target.id); }, { rootMargin: "-15% 0px -70% 0px" });
    for (const it of items) { const el = document.getElementById(it.id); if (el) io.observe(el); }
    return () => io.disconnect();
  }, [items]);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <nav aria-label="On this page" className="sticky top-4 flex flex-col gap-0.5 pt-2 max-xl:top-0 max-xl:z-10 max-xl:-mx-1 max-xl:flex-row max-xl:gap-1.5 max-xl:overflow-x-auto max-xl:bg-paper/90 max-xl:px-1 max-xl:py-2 max-xl:backdrop-blur max-xl:[scrollbar-width:none]">
      <span className="label px-3 pb-2.5 tracking-[0.14em] max-xl:hidden">On this page</span>
      {items.map((it) => (
        <button key={it.id} onClick={() => go(it.id)}
          className={cn("flex items-center gap-2.5 rounded-[9px] px-3 py-1.5 text-left text-md transition-colors duration-150 [&_svg]:size-[15px]",
            "max-xl:shrink-0 max-xl:rounded-full max-xl:border max-xl:border-rule max-xl:whitespace-nowrap",
            on === it.id ? "bg-gradient-to-r from-ink/10 to-transparent text-ink shadow-[inset_2px_0_0_var(--color-ink)] max-xl:border-rule-2 max-xl:bg-paper-4 max-xl:shadow-none" : "text-ink-2 hover:bg-ink/5 hover:text-ink")}>
          <DI name={it.icon} className={on === it.id ? "" : "opacity-75"} />
          <span className="min-w-0 flex-1 leading-snug">{it.label}</span>
          {it.n != null && <em className="text-xs font-semibold text-muted not-italic num">{it.n}</em>}
        </button>
      ))}
    </nav>
  );
}

// `side`: a live panel on the right on wide screens (a real call, a sample conversation), below on narrow ones.
export function Hero({ icon, title, lead, children, side }: { icon: IconName; title: string; lead: ReactNode; children?: ReactNode; side?: ReactNode }) {
  return (
    <header className="relative isolate grid items-center gap-x-8 gap-y-6 overflow-hidden rounded-[18px] border border-rule px-8 py-7 shadow-panel max-md:px-5 max-md:py-6 @min-[900px]:grid-cols-[minmax(0,1fr)_390px]"
      style={{ background: "radial-gradient(640px 240px at 0% 0%, color-mix(in oklch, var(--color-ink) 8%, transparent), transparent 70%), linear-gradient(180deg, var(--color-paper-3), var(--color-paper-2))" }}>
      {/* plotting-paper grid fading in from the top right */}
      <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-35"
        style={{ backgroundImage: "linear-gradient(var(--color-rule-2) 1px, transparent 1px), linear-gradient(90deg, var(--color-rule-2) 1px, transparent 1px)", backgroundSize: "28px 28px",
          maskImage: "radial-gradient(520px 260px at 100% 0%, black, transparent 75%)", WebkitMaskImage: "radial-gradient(520px 260px at 100% 0%, black, transparent 75%)" }} />
      <div className="flex min-w-0 gap-6 max-md:flex-col max-md:gap-4">
      <span className="chrome-fill grid size-[66px] shrink-0 place-items-center rounded-[19px] [&_svg]:size-[31px] [&_svg]:stroke-[1.9] max-md:size-[52px] max-md:rounded-[15px] max-md:[&_svg]:size-[25px]">
        <DI name={icon} />
      </span>
      <div className="min-w-0">
        <span className="label tracking-[0.16em]">Developers</span>
        <h1 className="chrome-text mt-1 font-display text-[42px] leading-[1.05] font-extrabold tracking-[-0.04em] max-md:text-[34px]">{title}</h1>
        <p className="mt-3 max-w-[66ch] text-[14.5px] leading-relaxed text-ink-2">{lead}</p>
        {children && <div className="mt-5 flex flex-wrap gap-2">{children}</div>}
      </div>
      </div>
      {side && <div className="min-w-0">{side}</div>}
    </header>
  );
}

// A pill with an icon: a fact about the page, or a value to copy.
export function Chip({ icon, children, onClick, done, mono }: { icon: IconName; children: ReactNode; onClick?: () => void; done?: boolean; mono?: boolean }) {
  const cls = cn("inline-flex items-center gap-2 rounded-full border border-rule-2 bg-paper-4/75 px-3 py-1 text-md text-ink-2 [&_svg]:size-3.5 [&_svg]:text-ink max-md:whitespace-normal",
    mono && "font-outlier text-sm text-ink", onClick && "cursor-pointer transition-colors duration-150 hover:border-ink-2 hover:bg-paper-4", done && "border-up text-up [&_svg]:text-up");
  return onClick
    ? <button onClick={onClick} className={cls}><DI name={done ? "check" : icon} />{children}</button>
    : <span className={cls}><DI name={icon} />{children}</span>;
}

export function Section({ id, icon, title, aside, children }: { id: string; icon: IconName; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 max-xl:scroll-mt-16">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Tile name={icon} />
        <h2 className="font-display text-[19px] font-bold tracking-[-0.02em] text-ink">{title}</h2>
        {aside && <span className="ml-auto inline-flex flex-wrap items-center gap-2 text-md text-muted max-md:ml-0 max-md:w-full">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

// A search box for long lists (endpoints, tools). "/" focuses it.
export function SearchBox({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={cn("flex h-9 min-w-0 items-center gap-2 rounded-full border border-rule-2 bg-paper px-3.5 transition-colors duration-150 focus-within:border-ink-2", className)}>
      <DI name="search" className="size-[15px] text-muted" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-md text-ink outline-none placeholder:text-muted" />
      {value && <button onClick={() => onChange("")} aria-label="Clear" className="text-muted hover:text-ink"><DI name="x" className="size-3.5" /></button>}
    </label>
  );
}

// A raised card for small blocks of the page (events, steps, prompts, tools).
export const card = "rounded-[14px] border border-rule bg-paper-2/90 shadow-raised transition-colors duration-150 hover:border-rule-2 hover:bg-paper-3/80";
