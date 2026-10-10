// The API and MCP pages (#/api, #/mcp): how to read Blix from a script, a bot or an AI client.
// The endpoint, event and tool lists are the shared modules the classic pages, the public docs pages
// (worker/) and the MCP server load, so none of them can drift from what the server offers.
// main.tsx loads this lazily; keep the two exports.
import { pageHref } from "@/lib/route";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { API_DOCS, API_EVENTS } from "@shared/api-docs.js";
import { MCP_TOOLS } from "@shared/mcp-tools.js";
import { usePulse } from "@/lib/pulse";
import { cn } from "@/lib/utils";
import { card, Chip, CodeBlock, CopyButton, DI, Hero, JsonText, SearchBox, Section, SectionNav, Tile, useCopy, type IconName, type NavItem } from "./docs/parts";

type Endpoint = [method: string, path: string, desc: string, run?: number];
interface Tool { name: string; description: string; props?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[]; write?: boolean }
const GROUPS = API_DOCS as unknown as [string, Endpoint[]][];
const EVENTS = API_EVENTS as unknown as [string, string, string][];
const TOOLS = MCP_TOOLS as unknown as Tool[];

const GROUP_ICON: Record<string, IconName> = { "Market": "chart", "Signals, narratives, briefs": "bell", "Research and picks": "sparkles", "Paper desk": "clipboard", "Wallets and Fomo": "wallet", "Track record, health, ops": "pulse" };
const EVENT_ICON: Record<string, IconName> = { tick: "clock", launch: "rocket", live: "activity", signal: "zap", mig: "grad", pic: "image", paper: "clipboard", brief: "news" };
const TOOL_ICON: Record<string, IconName> = { overview: "layers", pulse: "activity", signals: "bell", coins: "coins", coin: "coin", holders: "users", candles: "candles", quote: "swap", narratives: "trend",
  briefs: "news", research: "sparkles", picks: "target", wallets: "wallet", wallet: "wallet", fomo: "eye", track_record: "trophy", health: "pulse", paper_desk: "clipboard", paper_buy: "buy", paper_sell: "sell" };
const slug = (s: string) => `doc-${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
// The radar's own address: this page may be the dev server on :4421, which only proxies it.
const BASE = typeof location === "undefined" ? "" : location.port === "4421" ? `${location.protocol}//${location.hostname}:4420` : location.origin;

function Layout({ nav, children }: { nav: NavItem[]; children: ReactNode }) {
  // A page opens at its top (the scroller is the app's <main>, shared with the page before).
  useEffect(() => { document.querySelector("main")?.scrollTo(0, 0); }, []);
  return (
    <div className="mx-auto grid w-full max-w-[1320px] grid-cols-[226px_minmax(0,1fr)] items-start gap-10 px-6 pt-5 pb-16 max-xl:grid-cols-1 max-xl:gap-3 max-md:px-3">
      <SectionNav items={nav} />
      <div className="@container flex min-w-0 flex-col gap-10 max-md:gap-8">{children}</div>
    </div>
  );
}

// A terminal-style panel for the hero: a title bar with three dots, then its body.
function Window({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[14px] border border-rule-2 bg-paper shadow-sheet">
      <div className="flex items-center gap-2 border-b border-rule bg-paper-3/70 px-3.5 py-2">
        <span className="flex gap-1.5" aria-hidden>{[0, 1, 2].map((i) => <i key={i} className="size-2.5 rounded-full bg-rule-2" />)}</span>
        <span className="ml-1.5 min-w-0 truncate font-outlier text-[11.5px] text-muted">{title}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted">{right}</span>
      </div>
      {children}
    </div>
  );
}

// ---------- API ----------
function PathText({ p }: { p: string }) {
  return <>{p.split(/(<[a-z]+>|\?…$)/i).map((x, i) => /^<[a-z]+>$/i.test(x) || x === "?…" ? <i key={i} className="text-muted">{x}</i> : x)}</>;
}
function Method({ m }: { m: string }) {
  return (
    <span className={cn("justify-self-start rounded-[6px] border px-2 py-0.5 font-outlier text-[10.5px] font-bold tracking-[0.07em]",
      m === "GET" ? "border-rule-2 bg-paper-3 text-ink-2" : m === "DELETE" ? "border-down/45 bg-down/8 text-down" : "chrome-fill border-transparent")}>{m}</span>
  );
}
interface Answer { ok: boolean; status: number | null; ms: number; kb: number; text: string }
async function callApi(path: string): Promise<Answer> {
  const t0 = performance.now();
  try {
    const r = await fetch(path, { signal: AbortSignal.timeout(20_000) });
    const body = await r.text();
    let text = body;
    try { text = JSON.stringify(JSON.parse(body), null, 2); } catch { /* not JSON: shown as it came */ }
    return { ok: r.ok, status: r.status, ms: Math.round(performance.now() - t0), kb: body.length / 1024, text };
  } catch (err) { return { ok: false, status: null, ms: Math.round(performance.now() - t0), kb: 0, text: (err as Error).message }; }
}

// The hero's live panel: a real call to /api/overview, trimmed to the figures a bot would read first.
function LiveCall() {
  const [res, setRes] = useState<(Answer & { short: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const a = await callApi("api/overview");
    let short = a.text;
    try {
      const j = JSON.parse(a.text);
      short = JSON.stringify({ stats: { launchesLastHour: j.stats?.launchesLastHour, tracked: j.stats?.tracked, signals: j.stats?.signals, pump: j.stats?.pump },
        counts: j.counts, top: (j.top || []).slice(0, 2).map((c: { symbol?: string; mcap?: number }) => ({ symbol: c.symbol, mcap: c.mcap != null ? Math.round(c.mcap) : undefined })) }, null, 2);
    } catch { /* shown as it came */ }
    setRes({ ...a, short }); setBusy(false);
  };
  useEffect(() => { run(); }, []);
  return (
    <Window title={<><b className="font-semibold text-ink-2">GET</b> /api/overview</>}
      right={<>
        {res && <span className={cn("num flex items-center gap-1.5", res.ok ? "text-up" : "text-down")}><i className={cn("size-1.5 rounded-full", res.ok ? "bg-up" : "bg-down")} />{res.status ?? "offline"} · {res.ms} ms</span>}
        <button onClick={run} disabled={busy} aria-label="Run again" className="grid size-6 place-items-center rounded-[6px] text-muted hover:bg-paper-4 hover:text-ink disabled:opacity-50"><DI name="refresh" className={cn("size-3.5", busy && "animate-spin")} /></button>
      </>}>
      <div className="relative">
        <pre className="m-0 h-[236px] overflow-hidden px-4 py-3 font-outlier text-[11.5px] leading-[1.65] whitespace-pre text-ink-2">
          {res ? <JsonText text={res.short} /> : <span className="animate-pulse text-muted">calling the radar…</span>}
        </pre>
        {/* the answer runs on below: fade it out rather than cut a line in half */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-paper to-transparent" />
      </div>
    </Window>
  );
}

function EndpointRow({ e }: { e: Endpoint }) {
  const [m, p, d, run] = e;
  const [res, setRes] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopy();
  const url = BASE + p.replace(/\?…$/, "");
  const call = async () => {
    if (res) return setRes(null);
    setBusy(true);
    setRes(await callApi(p.split("?")[0]));
    setBusy(false);
  };
  const MAX = 6000;
  return (
    <div className="border-t border-rule first:border-t-0">
      <div className={cn("grid grid-cols-[60px_minmax(220px,320px)_minmax(0,1fr)_82px] items-center gap-x-4 gap-y-1.5 px-[18px] py-3 transition-colors duration-150 hover:bg-ink/[0.035] max-xl:grid-cols-[60px_minmax(0,1fr)_auto] max-md:px-3.5", res && "bg-ink/[0.035]")}>
        <Method m={m} />
        <button onClick={() => copy(url, "url")} title="Copy the full URL" className="group inline-flex min-w-0 items-center gap-2 justify-self-start text-left">
          <code className="min-w-0 font-outlier text-[12.5px] leading-normal break-all text-ink"><PathText p={p} /></code>
          <DI name={copied ? "check" : "copy"} className={cn("size-[13px] transition-opacity duration-150", copied ? "text-up opacity-100" : "text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100")} />
        </button>
        <p className="m-0 text-md leading-normal text-ink-2 max-xl:order-last max-xl:col-span-3">{d}</p>
        {run ? (
          <button onClick={call} disabled={busy} aria-expanded={Boolean(res)}
            className={cn("inline-flex items-center gap-1.5 justify-self-end rounded-[8px] border border-rule-2 px-3 py-1 text-sm font-semibold text-ink shadow-raised transition-[border-color,opacity] duration-150 hover:border-ink-2 [&_svg]:size-[11px]", busy && "opacity-55")}
            style={{ background: "linear-gradient(180deg, var(--color-paper-5), var(--color-paper-4))" }}>
            <DI name={res ? "x" : "play"} />{res ? "Hide" : busy ? "Running" : "Run"}
          </button>
        ) : <span />}
      </div>
      {res && (
        <div className="border-t border-dashed border-rule-2 bg-paper">
          <div className="flex items-center gap-3 border-b border-rule py-2 pr-2.5 pl-[18px] text-sm text-muted num [&_svg]:size-[15px]">
            <DI name={res.ok ? "check" : "alert"} className={res.ok ? "text-up" : "text-down"} />
            <b className={res.ok ? "text-up" : "text-down"}>{res.status ?? "failed"}</b>
            <span>{res.ms} ms</span>
            {res.kb > 0 && <span>{res.kb.toFixed(1)} KB</span>}
            {res.text.length > MAX && <span>first {MAX.toLocaleString()} characters</span>}
            <CopyButton done={copied === "res"} onClick={() => copy(res.text, "res")} />
          </div>
          <pre className="m-0 max-h-[400px] overflow-auto px-5 py-4 font-outlier text-[12.5px] leading-[1.7] whitespace-pre text-ink-2"><JsonText text={res.text.slice(0, MAX)} /></pre>
        </div>
      )}
    </div>
  );
}

const METHODS = ["All", "GET", "POST", "DELETE"] as const;

export function Api() {
  const { copied, copy } = useCopy();
  const [q, setQ] = useState(""), [method, setMethod] = useState<(typeof METHODS)[number]>("All");
  const n = GROUPS.reduce((a, [, rows]) => a + rows.length, 0);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return GROUPS.map(([t, rows]) => [t, rows.filter(([m, p, d]) => (method === "All" || m === method) && words.every((w) => `${m} ${p} ${d} ${t}`.toLowerCase().includes(w)))] as [string, Endpoint[]])
      .filter(([, rows]) => rows.length);
  }, [q, method]);
  const matches = shown.reduce((a, [, rows]) => a + rows.length, 0), filtering = Boolean(q) || method !== "All";
  const nav: NavItem[] = [
    { id: "doc-start", label: "Quick start", icon: "zap" }, { id: "doc-stream", label: "Live stream", icon: "radio", n: EVENTS.length },
    { id: "doc-endpoints", label: "Find an endpoint", icon: "search", n },
    ...GROUPS.map(([t, rows]): NavItem => ({ id: slug(t), label: t, icon: GROUP_ICON[t] ?? "code", n: rows.length })),
    { id: "doc-errors", label: "Errors and caching", icon: "alert" },
  ];
  return (
    <Layout nav={nav}>
      <Hero icon="code" title="API" side={<LiveCall />}
        lead="Blix serves JSON over plain HTTP and one live event stream. This app is just a client of it, so anything shown here can be read from a script, a bot or your own front end.">
        <Chip icon="link" mono onClick={() => copy(BASE, "base")} done={copied === "base"}>{BASE}</Chip>
        <Chip icon="layers">{n} endpoints</Chip>
        <Chip icon="radio">1 event stream</Chip>
        <Chip icon="lock"><span>No key on this PC · Google sign-in at <code className="font-outlier text-ink">blixvip.com</code> remotely</span></Chip>
      </Hero>

      <Section id="doc-start" icon="zap" title="Quick start" aside="two calls cover most bots">
        <CodeBlock samples={[
          { label: "curl", icon: "terminal", code: `# a snapshot of the market\ncurl -s ${BASE}/api/overview\n\n# every event as it happens\ncurl -N ${BASE}/api/stream` },
          { label: "JavaScript", icon: "code", code: `const overview = await (await fetch("${BASE}/api/overview")).json();\n\nconst es = new EventSource("${BASE}/api/stream");\nes.addEventListener("signal", (e) => console.log(JSON.parse(e.data)));` },
          { label: "Python", icon: "code", code: `import json, requests\n\noverview = requests.get("${BASE}/api/overview").json()\n\nwith requests.get("${BASE}/api/stream", stream=True) as r:\n    for line in r.iter_lines():\n        if line.startswith(b"data:"):\n            print(json.loads(line[5:]))` },
        ]} />
      </Section>

      <Section id="doc-stream" icon="radio" title="Live stream" aside={<>
        <Chip icon="copy" mono onClick={() => copy(`${BASE}/api/stream`, "stream")} done={copied === "stream"}>GET /api/stream</Chip><span>text/event-stream</span></>}>
        <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
          {EVENTS.map(([e, p, w]) => (
            <div key={e} className={cn(card, "flex gap-3 px-4 py-3.5")}>
              <Tile name={EVENT_ICON[e] ?? "activity"} small />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="font-outlier text-[12.5px] font-semibold text-ink">{e}</code>
                  <span className="ml-auto inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted [&_svg]:size-3"><DI name="clock" />{w}</span>
                </div>
                <p className="mt-1 text-md leading-normal text-ink-2">{p}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* the endpoint finder sticks to the top while the list scrolls under it */}
      <div id="doc-endpoints" className="sticky top-0 z-[5] -my-5 scroll-mt-4 bg-paper/90 py-4 backdrop-blur max-xl:top-12">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchBox value={q} onChange={setQ} placeholder={`Search ${n} endpoints: holders, paper, /api/coin…`} className="min-w-64 flex-1" />
          <div role="radiogroup" aria-label="Method" className="flex rounded-full border border-rule-2 bg-paper p-0.5">
            {METHODS.map((m) => (
              <button key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                className={cn("h-8 rounded-full px-3 font-outlier text-[11.5px] font-bold tracking-[0.05em] transition-colors duration-150", method === m ? "bg-paper-5 text-ink shadow-raised" : "text-muted hover:text-ink")}>{m}</button>
            ))}
          </div>
          {filtering && <span className="num text-sm text-muted">{matches} of {n}</span>}
        </div>
      </div>

      {shown.length ? shown.map(([title, rows]) => (
        <Section key={title} id={slug(title)} icon={GROUP_ICON[title] ?? "code"} title={title} aside={`${rows.length} endpoint${rows.length === 1 ? "" : "s"}`}>
          <div className="overflow-hidden rounded-[14px] border border-rule bg-paper-2/90 shadow-panel">
            {rows.map((e) => <EndpointRow key={e[0] + e[1]} e={e} />)}
          </div>
        </Section>
      )) : (
        <div className={cn(card, "flex flex-col items-center gap-2 px-6 py-12 text-center")}>
          <DI name="search" className="size-6 text-muted" />
          <b className="text-ink">No endpoint matches{q ? ` “${q}”` : ""}{method !== "All" ? ` with ${method}` : ""}</b>
          <button onClick={() => { setQ(""); setMethod("All"); }} className="text-md text-ink-2 underline decoration-muted underline-offset-[3px] hover:text-ink">Show all {n}</button>
        </div>
      )}

      <Section id="doc-errors" icon="alert" title="Errors and caching">
        <div className="grid grid-cols-3 gap-2.5 max-lg:grid-cols-1">
          {([
            ["alert", "Errors are JSON", <><code className="font-outlier text-ink">{'{ "error": "a human sentence" }'}</code> with a 4xx or 5xx status.</>],
            ["clock", "Cached 1 to 60 seconds", "Polling faster than an endpoint's cache returns the same body."],
            ["pulse", "Upstream limits are on Health", <>Rate-limited sources (public RPC, DexScreener) show on <a className="text-accent hover:text-focus" href="#/health">Health</a>, not as request errors.</>],
          ] as [IconName, string, ReactNode][]).map(([icon, t, body]) => (
            <div key={t} className={cn(card, "flex gap-3 p-4")}>
              <Tile name={icon} small />
              <div className="min-w-0"><b className="text-[13.5px] text-ink">{t}</b><p className="mt-1 text-md leading-normal text-ink-2">{body}</p></div>
            </div>
          ))}
        </div>
      </Section>
    </Layout>
  );
}

// ---------- MCP ----------
const PLACEHOLDER = "<blix folder>/mcp/blix-mcp.mjs";
const ASK: [string, string[]][] = [
  ["What's moving on the Pulse right now, and which coins has the AI rated well?", ["blix_pulse"]],
  ["Why was this coin flagged? Show its holders and the dev's other launches.", ["blix_coin", "blix_holders"]],
  ["Paper buy 0.25 SOL of the best-rated coin, then show my desk.", ["blix_paper_buy", "blix_paper_desk"]],
  ["How has Blix's track record been this week?", ["blix_track_record"]],
];

// Where the MCP script is on this PC (the radar tells this PC only), with forward slashes: node takes them
// on Windows too, and they need no escaping in JSON or TOML.
function useScript() {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => { fetch("api/me").then((r) => r.json()).then((j) => { if (j.mcpScript) setPath(String(j.mcpScript).replace(/\\/g, "/")); }).catch(() => {}); }, []);
  return path;
}

// The hero's sample conversation, answered with what is on the Pulse right now.
function ChatDemo() {
  const stretch = usePulse((s) => s.cols.stretch), coins = usePulse((s) => s.coins);
  const top = stretch.slice(0, 3).map((m) => coins[m]).filter(Boolean);
  const fmt = (n?: number | null) => n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`;
  return (
    <Window title="Claude · blix" right={<span className="flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-up" />connected</span>}>
      <div className="flex h-[236px] flex-col gap-2.5 overflow-hidden px-4 py-3.5 text-[12.5px]">
        <div className="ml-auto max-w-[85%] rounded-[12px] rounded-br-[4px] bg-paper-4 px-3 py-2 text-ink">What's closest to bonding on the Pulse?</div>
        <div className="flex items-center gap-2 text-muted [&_svg]:size-3.5">
          <DI name="wrench" /><code className="rounded-[6px] border border-rule-2 bg-paper-3 px-1.5 py-px font-outlier text-[11px] text-ink-2">blix_pulse</code>
          <span className="truncate font-outlier text-[11px]">{"{ limit: 3 }"}</span><DI name="check" className="text-up" />
        </div>
        <div className="max-w-[92%] rounded-[12px] rounded-bl-[4px] border border-rule bg-paper-2 px-3 py-2 leading-relaxed text-ink-2">
          {top.length ? <>
            These three are nearest the end of the curve:
            <ul className="mt-1.5 flex flex-col gap-1">
              {top.map((c) => (
                <li key={c.mint} className="num flex items-center gap-2">
                  <b className="font-semibold text-ink">${c.symbol || "?"}</b>
                  <span className="text-muted">{fmt(c.mcap)} MC</span>
                  {c.progress != null && <span className="ml-auto text-up">{Math.round(c.progress * 100)}% bonded</span>}
                </li>
              ))}
            </ul>
          </> : <span className="animate-pulse text-muted">reading the Pulse…</span>}
        </div>
      </div>
    </Window>
  );
}

function ToolCard({ t }: { t: Tool }) {
  const { copied, copy } = useCopy();
  const [open, setOpen] = useState(false);
  const args = Object.entries(t.props || {});
  return (
    <article className={cn(card, "flex flex-col gap-2.5 px-4 py-3.5")}>
      <div className="flex min-w-0 items-center gap-3">
        <Tile name={TOOL_ICON[t.name.replace(/^blix_/, "")] ?? "wrench"} small />
        <button onClick={() => copy(t.name)} title="Copy the tool name" className="min-w-0 truncate text-left font-outlier text-[12.5px] font-semibold text-ink underline-offset-[3px] hover:underline hover:decoration-muted">
          {copied ? "copied" : t.name}
        </button>
        {t.write && (
          <span title="Changes the paper desk (never real funds)" className="chrome-fill ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold tracking-[0.08em] uppercase [&_svg]:size-[11px]">
            <DI name="clipboard" />paper
          </span>
        )}
      </div>
      <p className="m-0 flex-1 text-md leading-normal text-ink-2">{t.description}</p>
      {args.length ? (
        <>
          <button onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Hide the arguments" : "What each argument takes"} className="flex items-center gap-1.5 self-start text-sm text-muted hover:text-ink [&>svg]:size-3.5">
            <span className="flex flex-wrap gap-1.5">
              {args.map(([k]) => {
                const req = (t.required || []).includes(k);
                return <span key={k} className={cn("rounded-[6px] border px-2 py-px font-outlier text-[11.5px]", req ? "border-rule-2 bg-paper-4 text-ink" : "border-dashed border-rule-2 text-ink-2")}>{k}{req ? "" : "?"}</span>;
              })}
            </span>
            <DI name="chevron" className={cn("transition-transform duration-150", open && "rotate-180")} />
          </button>
          {open && (
            <dl className="m-0 flex flex-col gap-2 rounded-[10px] border border-rule bg-paper px-3 py-2.5">
              {args.map(([k, p]) => (
                <div key={k} className="flex flex-col gap-0.5 text-sm">
                  <dt className="font-outlier text-[11.5px] text-ink">{k}<span className="ml-1.5 text-muted">{p.enum ? "one of" : p.type || "any"}{(t.required || []).includes(k) ? " · required" : " · optional"}</span></dt>
                  <dd className="m-0 text-ink-2">{p.description || ""}{p.enum && <span className="mt-0.5 block font-outlier text-[11px] text-muted">{p.enum.join(" | ")}</span>}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      ) : <span className="text-sm text-muted">no arguments</span>}
    </article>
  );
}

export function Mcp() {
  const real = useScript(), script = real || PLACEHOLDER;
  const [q, setQ] = useState("");
  const { copied, copy } = useCopy();
  const tools = useMemo(() => { const w = q.toLowerCase().trim(); return w ? TOOLS.filter((t) => `${t.name} ${t.description} ${Object.keys(t.props || {}).join(" ")}`.toLowerCase().includes(w)) : TOOLS; }, [q]);
  const nav: NavItem[] = [{ id: "doc-how", label: "How it works", icon: "layers" }, { id: "doc-connect", label: "Connect a client", icon: "plug" },
    { id: "doc-ask", label: "Things to ask", icon: "message" }, { id: "doc-tools", label: "Tools", icon: "wrench", n: TOOLS.length }];
  return (
    <Layout nav={nav}>
      <Hero icon="plug" title="MCP" side={<ChatDemo />}
        lead={<>Plug Claude, Cursor or Codex into Blix. The MCP server is one small script with no dependencies that turns the <a className="text-ink underline decoration-muted underline-offset-[3px] hover:text-focus" href={pageHref("api")}>API</a> into tools an AI can call: ask what is running, why a coin was flagged, or paper trade a call.</>}>
        <Chip icon="wrench">{TOOLS.length} tools</Chip>
        <Chip icon="terminal">stdio</Chip>
        <Chip icon="shield">Reads only, plus the paper desk</Chip>
        <Chip icon="box">No dependencies</Chip>
      </Hero>

      <Section id="doc-how" icon="layers" title="How it works">
        <ol className="m-0 grid list-none grid-cols-3 gap-2.5 p-0 max-lg:grid-cols-1">
          {([
            ["activity", "Blix runs on this PC", <>The MCP script talks to the server at <code className="font-outlier text-ink">{BASE}</code> and nothing else.</>],
            ["plug", "Your AI client starts the script", "Add it once (below). It speaks MCP over stdio: nothing to host, no key."],
            ["message", "Ask in plain words", "The client picks the tools. Nothing it can call spends real funds."],
          ] as [IconName, string, ReactNode][]).map(([icon, t, body], i) => (
            <li key={t} className={cn(card, "relative flex gap-3 p-4")}>
              <Tile name={icon} />
              <div className="min-w-0 pr-5"><b className="text-[13.5px] text-ink">{t}</b><p className="mt-1 text-md leading-normal text-ink-2">{body}</p></div>
              <span className="absolute top-3 right-3.5 font-outlier text-[11px] font-bold text-muted">0{i + 1}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="doc-connect" icon="plug" title="Connect a client" aside={real
        ? <span className="inline-flex items-center gap-1.5 text-up [&_svg]:size-3.5"><DI name="check" />filled in for this PC, ready to paste</span>
        : <>replace <span className="rounded-chip bg-warn/15 px-1 font-outlier text-warn">{"<blix folder>"}</span> with where Blix is installed</>}>
        <CodeBlock samples={[
          { label: "Claude Code", icon: "terminal", code: `# run once in a terminal\nclaude mcp add blix -- node "${script}"` },
          { label: "Claude Desktop · Cursor", icon: "monitor", code: JSON.stringify({ mcpServers: { blix: { command: "node", args: [script] } } }, null, 2) },
          { label: "Codex", icon: "code", code: `# ~/.codex/config.toml\n[mcp_servers.blix]\ncommand = "node"\nargs = ["${script}"]` },
        ]} />
        <p className="mt-3 flex items-center gap-2 px-0.5 text-md leading-normal text-muted [&_svg]:size-3.5">
          <DI name="link" /><span>Another install or port: set <code className="font-outlier text-ink-2">BLIX_URL</code> (for example <code className="font-outlier text-ink-2">http://localhost:4420</code>) in the client's environment for this server.</span>
        </p>
      </Section>

      <Section id="doc-ask" icon="message" title="Things to ask" aside="click one to copy it">
        <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
          {ASK.map(([text, tools]) => (
            <button key={text} onClick={() => copy(text)} className={cn(card, "group flex gap-3 px-4 py-3.5 text-left")} style={{ background: "linear-gradient(180deg, var(--color-paper-3), var(--color-paper-2))" }}>
              <DI name={copied === text ? "check" : "message"} className={cn("mt-0.5 size-[18px]", copied === text ? "text-up" : "text-muted")} />
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[13.5px] leading-relaxed text-ink">“{text}”</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {tools.map((x) => <code key={x} className="rounded-chip bg-paper-4 px-1.5 py-px font-outlier text-[11px] text-muted">{x}</code>)}
                  <span className={cn("ml-auto text-xs transition-opacity duration-150", copied === text ? "text-up" : "text-muted opacity-0 group-hover:opacity-100")}>{copied === text ? "Copied" : "Copy"}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </Section>

      <Section id="doc-tools" icon="wrench" title="Tools" aside={<SearchBox value={q} onChange={setQ} placeholder={`Search ${TOOLS.length} tools`} className="w-64 max-md:w-full" />}>
        <p className="-mt-1 mb-3 text-md text-muted">Click a tool's arguments to see what each takes. Every tool also takes <code className="rounded-chip bg-paper-4 px-1.5 font-outlier text-xs text-ink-2">limit</code> (rows per list, default 10, max 50).</p>
        {tools.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-2.5 max-md:grid-cols-1">
            {tools.map((t) => <ToolCard key={t.name} t={t} />)}
          </div>
        ) : <p className={cn(card, "px-6 py-10 text-center text-md text-muted")}>No tool matches “{q}”.</p>}
      </Section>
    </Layout>
  );
}
