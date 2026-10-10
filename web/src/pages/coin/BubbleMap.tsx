// The coin page's Bubble map tab: the top 100 holders as rings sized by their share, coloured and joined when
// the wallets are connected (server/bubblemap.js: RugCheck's transfer networks, Blix's first-funder trace and the
// launch block). Live: the map is read every 8 s and the bubbles move, grow and shrink in place.
// A second tab shows trench.bot's bundle report for the coin (it allows being framed; InsightX, Bubblemaps,
// Faster100x and CabalSpy only frame on partners' domains).
import { useEffect, useMemo, useRef, useState, type PointerEvent as PE } from "react";
import { usePoll } from "@/lib/coin";
import { useNow } from "@/lib/route";
import { ageStr } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type Kind = "transfer" | "funded" | "launch";
interface Node { w: string; pct: number; tokens: number | null; tag: string | null; label: string | null; kind: "holder" | "pool" | "exchange"; cluster: number | null; via: string | null; traced: boolean; untraceable: boolean }
interface Link { a: number; b: number; hops: number; kinds: Kind[]; dir: number; via: string[] }
interface Cluster { n: number; pct: number; members: number[]; why: Kind[] }
interface Answer {
  mint: string; t: number; pending?: boolean; error?: string;
  nodes: Node[]; links: Link[]; clusters: Cluster[];
  sources: { holders: string | null; holderCount: number | null; rugcheck: { t: number | null; busy: boolean; error: string | null; networks: number; wallets: number }; trace: { traced: number; of: number; busy: boolean; done: number; total: number } };
}

// Cluster colours, in the order clusters are ranked (biggest share first).
const HUES = ["#3fd18b", "#f59e0b", "#4f8cff", "#f0609e", "#a78bfa", "#2dd4bf", "#facc15", "#f87171", "#22d3ee", "#a3e635", "#fb923c", "#e879f9"];
const RING = "#4b5263";
const GAP = 9;   // the room between two bubbles
const hue = (k: number | null) => (k == null ? RING : HUES[k % HUES.length]);
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const pctStr = (p: number) => (p >= 10 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p >= 0.01 ? p.toFixed(3) : "<0.01") + "%";
const WHY: Record<Kind, string> = { transfer: "Sent each other tokens or SOL", funded: "Same first funder", launch: "Bought in the launch block" };
const WHY_SHORT: Record<Kind, string> = { transfer: "Transfers", funded: "Same funder", launch: "Launch block" };
const tokStr = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));

export function BubbleMapTab({ mint }: { mint: string }) {
  const [view, setView] = useState<"blix" | "trench">("blix");
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 border-b border-rule px-2 py-1.5">
        {([["blix", "Blix map"], ["trench", "trench.bot"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={cn("rounded-full px-3 py-1 text-sm font-semibold transition-colors", view === k ? "bg-paper-4 text-ink" : "text-muted hover:text-ink-2")}>{l}</button>
        ))}
        <span className="ml-auto flex items-center gap-3 pr-1 text-xs text-muted">
          <a className="hover:text-ink" href={`https://v2.bubblemaps.io/map?address=${mint}&chain=solana`} target="_blank" rel="noopener">Bubblemaps ↗</a>
          <a className="hover:text-ink" href={`https://trench.bot/bundles/${mint}`} target="_blank" rel="noopener">trench.bot ↗</a>
        </span>
      </div>
      {view === "blix" ? <BlixMap mint={mint} /> : (
        <iframe key={mint} title="trench.bot bundles" src={`https://trench.bot/bundles/${mint}`} className="block h-[640px] w-full border-0 bg-paper" allow="clipboard-write" />
      )}
    </div>
  );
}

function BlixMap({ mint }: { mint: string }) {
  const { data } = usePoll<Answer>(`bubblemap?mint=${mint}`, 8000);
  const map = data && !data.pending && data.nodes ? data : null;
  if (!data) return <Wait text="Loading the bubble map…" />;
  if (data.error) return <Wait text={data.error} />;
  if (!map) return <Wait text="Reading this coin's holders…" sub="The map draws itself the moment the top holders are in." />;
  return <MapView key={mint} map={map} />;
}

function Wait({ text, sub }: { text: string; sub?: string }) {
  const dots = Array.from({ length: 26 }, (_, i) => {
    const a = (i / 26) * Math.PI * 2, d = 58 + ((i * 37) % 23);
    return <circle key={i} cx={100 + Math.cos(a) * d} cy={100 + Math.sin(a) * d} r={3 + ((i * 7) % 5) * 1.6} fill="none" stroke="currentColor" strokeWidth="1" opacity={0.25 + ((i * 13) % 10) / 25} />;
  });
  return (
    <div className="grid h-[440px] place-items-center p-6 sm:h-[600px]">
      <div className="flex flex-col items-center gap-3 text-center">
        <svg viewBox="0 0 200 200" className="size-40 animate-[spin_18s_linear_infinite] text-muted">{dots}</svg>
        <p className="text-md font-semibold text-ink-2">{text}</p>
        {sub && <p className="max-w-sm text-sm text-muted">{sub}</p>}
      </div>
    </div>
  );
}

// ---- Layout: a small force simulation kept across reads, so a live update moves bubbles instead of redrawing.
interface P { x: number; y: number; vx: number; vy: number; r: number; tr: number; held?: boolean }
interface Sim { ps: Map<string, P>; alpha: number; w: number; h: number; sig?: string }

function radii(nodes: Node[], w: number, h: number) {
  const sum = nodes.reduce((s, n) => s + n.pct, 0) || 1;
  const k = Math.sqrt((0.2 * w * h) / (Math.PI * sum));
  const max = Math.min(w, h) * 0.15;
  return nodes.map((n) => Math.max(6, Math.min(max, k * Math.sqrt(n.pct))));
}

function place(sim: Sim, map: Answer) {
  const { w, h } = sim, rs = radii(map.nodes, w, h), seen = new Set<string>();
  const R = Math.min(w, h) * 0.42, n = map.nodes.length;
  let fresh = map.nodes.filter((x) => !sim.ps.has(x.w)).length;
  const many = fresh;
  map.nodes.forEach((x, i) => {
    seen.add(x.w);
    const p = sim.ps.get(x.w);
    if (p) { p.tr = rs[i]; return; }
    // New: beside a cluster mate already on the map, else on the spiral by rank (biggest in the middle).
    const mate = x.cluster != null ? map.clusters[x.cluster].members.map((j) => sim.ps.get(map.nodes[j].w)).find(Boolean) : null;
    // On the first draw every bubble starts tight around the middle and flows out to its place as it grows.
    const first = many > n / 2;
    const a = i * 2.39996, d = (first ? 0.18 : 1) * R * Math.sqrt((i + 0.5) / n);
    const at = mate ? { x: mate.x + Math.cos(a) * (mate.r + rs[i] + 10), y: mate.y + Math.sin(a) * (mate.r + rs[i] + 10) } : { x: w / 2 + Math.cos(a) * d, y: h / 2 + Math.sin(a) * d };
    sim.ps.set(x.w, { ...at, vx: 0, vy: 0, r: 0.5, tr: rs[i] });
  });
  for (const k of [...sim.ps.keys()]) if (!seen.has(k)) sim.ps.delete(k);
  // A cluster that formed or changed since the last read (the funder trace finishing, say) gets room to gather.
  const sig = map.clusters.map((c) => c.members.map((i) => map.nodes[i].w.slice(0, 6)).sort().join(",")).sort().join("|");
  const regroup = sim.sig != null && sig !== sim.sig;
  sim.sig = sig;
  sim.alpha = Math.max(sim.alpha, many > n / 2 ? 1 : regroup ? 0.7 : many ? 0.35 : 0.15);
}

function tick(sim: Sim, map: Answer) {
  const ps = map.nodes.map((n) => sim.ps.get(n.w)!), a = sim.alpha, cx = sim.w / 2, cy = sim.h / 2;
  let moving = false;
  for (const p of ps) { const d = p.tr - p.r; if (Math.abs(d) > 0.05) { p.r += d * 0.08; moving = true; } }
  // Clusters hold together: each member drifts to its cluster's centre.
  for (const c of map.clusters) {
    let sx = 0, sy = 0; for (const i of c.members) { sx += ps[i].x; sy += ps[i].y; }
    sx /= c.members.length; sy /= c.members.length;
    for (const i of c.members) { ps[i].vx += (sx - ps[i].x) * 0.07 * a; ps[i].vy += (sy - ps[i].y) * 0.07 * a; }
  }
  for (const l of map.links) {
    const p = ps[l.a], q = ps[l.b], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 0.01, want = p.r + q.r + GAP + 10;
    const f = ((d - want) / d) * 0.12 * a; p.vx += dx * f; p.vy += dy * f; q.vx -= dx * f; q.vy -= dy * f;
  }
  // A gentle pull to the middle (a touch stronger up and down, the box is wide), so the map packs into a disc.
  for (const p of ps) { p.vx += (cx - p.x) * 0.004 * a; p.vy += (cy - p.y) * 0.0055 * a; }
  for (const p of ps) { if (p.held) { p.vx = p.vy = 0; continue; } p.x += p.vx; p.y += p.vy; p.vx *= 0.6; p.vy *= 0.6; }
  // No overlaps: pushed apart directly, three passes a frame so a packed map still resolves (stable at any alpha).
  for (let pass = 0; pass < 3; pass++) for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const p = ps[i], q = ps[j], dx = q.x - p.x, dy = q.y - p.y, min = p.r + q.r + GAP;
    if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
    const d = Math.hypot(dx, dy) || 0.01;
    if (d >= min) continue;
    const s = ((min - d) / d) * 0.5; let wp = q.r / (p.r + q.r), wq = 1 - wp;
    if (p.held) { wp = 0; wq = 1; } else if (q.held) { wp = 1; wq = 0; }
    p.x -= dx * s * wp; p.y -= dy * s * wp; q.x += dx * s * wq; q.y += dy * s * wq;
  }
  for (const p of ps) { if (p.held) continue; p.x = Math.min(sim.w - p.r - 2, Math.max(p.r + 2, p.x)); p.y = Math.min(sim.h - p.r - 2, Math.max(p.r + 2, p.y)); }
  sim.alpha *= ps.some((p) => p.held) ? 1 : 0.985;
  return moving || sim.alpha > 0.02;
}

function MapView({ map }: { map: Answer }) {
  const box = useRef<HTMLDivElement>(null);
  const sim = useRef<Sim>({ ps: new Map(), alpha: 1, w: 0, h: 0 });
  const [size, setSize] = useState({ w: 0, h: 600 });
  const [, setFrame] = useState(0);
  const wake = useRef(() => {});
  const [glide, setGlide] = useState(false);   // the camera eases to a cluster or back, but follows the wheel and drags at once
  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [pick, setPick] = useState<string | null>(null);         // a selected wallet
  const [focus, setFocus] = useState<number | null>(null);       // a highlighted cluster
  const [side, setSide] = useState<"clusters" | "wallets">("clusters");
  const [q, setQ] = useState("");
  const now = useNow();

  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // Each read (and each resize) places new wallets and wakes the simulation; it runs until it settles.
  useEffect(() => {
    if (!size.w) return;
    const s = sim.current;
    if (s.w && (s.w !== size.w || s.h !== size.h)) { const fx = size.w / s.w, fy = size.h / s.h; for (const p of s.ps.values()) { p.x *= fx; p.y *= fy; } s.alpha = Math.max(s.alpha, 0.3); }
    s.w = size.w; s.h = size.h;
    place(s, map);
    let raf = 0;
    const loop = () => { const more = tick(s, map); setFrame((f) => f + 1); raf = more ? requestAnimationFrame(loop) : 0; };
    wake.current = () => { if (!raf) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); raf = 0; };
  }, [map, size.w, size.h]);

  // Zoom with the wheel about the pointer; drag the background to pan.
  useEffect(() => {
    const el = box.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = el.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top;
      setGlide(false);
      setCam((c) => { const k = Math.min(8, Math.max(0.6, c.k * Math.exp(-e.deltaY * 0.0015))); return { k, x: mx - ((mx - c.x) / c.k) * k, y: my - ((my - c.y) / c.k) * k }; });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const ease = (c: typeof cam | ((c: typeof cam) => typeof cam)) => { setGlide(true); setCam(c); };
  // Drag a bubble: it follows the pointer and the others make room; let go and it settles back in.
  const held = useRef<{ w: string; id: number; moved: boolean; x: number; y: number } | null>(null);
  const world = (e: PE) => { const b = box.current!.getBoundingClientRect(); return { x: (e.clientX - b.left - cam.x) / cam.k, y: (e.clientY - b.top - cam.y) / cam.k }; };
  const grab = (e: PE, w: string) => { e.stopPropagation(); held.current = { w, id: e.pointerId, moved: false, x: e.clientX, y: e.clientY }; (e.currentTarget as Element).setPointerCapture(e.pointerId); };
  const pull = (e: PE) => {
    const h = held.current; if (!h) return;
    if (!h.moved && Math.abs(e.clientX - h.x) + Math.abs(e.clientY - h.y) < 4) return;
    h.moved = true; setHover(null);
    const p = sim.current.ps.get(h.w); if (!p) return;
    const at = world(e); p.x = at.x; p.y = at.y; p.held = true;
    sim.current.alpha = Math.max(sim.current.alpha, 0.5); wake.current();
  };
  const drop = (i: number) => {
    const h = held.current; held.current = null; if (!h) return;
    const p = sim.current.ps.get(h.w); if (p) p.held = false;
    sim.current.alpha = Math.max(sim.current.alpha, 0.4); wake.current();
    if (!h.moved && i >= 0) choose(i);
  };
  const down = (e: PE) => { setGlide(false); drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; (e.currentTarget as Element).setPointerCapture(e.pointerId); };
  const move = (e: PE) => {
    const d = drag.current;
    if (d) { const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true; if (d.moved) setCam((c) => ({ ...c, x: d.cx + dx, y: d.cy + dy })); }
  };
  const up = () => { const d = drag.current; drag.current = null; if (d && !d.moved) { setPick(null); setFocus(null); } };

  const at = map.nodes.map((n) => sim.current.ps.get(n.w));
  const picked = pick != null ? map.nodes.findIndex((n) => n.w === pick) : -1;
  const hi = hover?.i ?? (picked >= 0 ? picked : null);
  const hiCluster = focus ?? (hi != null ? map.nodes[hi].cluster : null);
  const lit = (i: number) => (hiCluster != null ? map.nodes[i].cluster === hiCluster : hi != null ? i === hi : true);
  const linkLit = (l: Link) => (hiCluster != null ? map.nodes[l.a].cluster === hiCluster : hi == null);
  const linked = map.clusters.reduce((s, c) => s + c.pct, 0);

  const fit = (idx: number[]) => {
    const ps = idx.map((i) => at[i]).filter(Boolean) as P[]; if (!ps.length || !size.w) return;
    const x0 = Math.min(...ps.map((p) => p.x - p.r)), x1 = Math.max(...ps.map((p) => p.x + p.r)), y0 = Math.min(...ps.map((p) => p.y - p.r)), y1 = Math.max(...ps.map((p) => p.y + p.r));
    const k = Math.min(4, Math.max(1, Math.min(size.w / (x1 - x0 + 120), size.h / (y1 - y0 + 120))));
    ease({ k, x: size.w / 2 - ((x0 + x1) / 2) * k, y: size.h / 2 - ((y0 + y1) / 2) * k });
  };
  const choose = (i: number) => { setPick(map.nodes[i].w); setFocus(map.nodes[i].cluster); };
  const s = map.sources;

  return (
    <div className="flex flex-col lg:flex-row">
      <div className="relative min-w-0 flex-1">
        <div ref={box} className="relative h-[440px] cursor-grab sm:h-[600px] touch-none overflow-hidden bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--color-paper-3)_70%,transparent),transparent_70%)] active:cursor-grabbing"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => (drag.current = null)} onDoubleClick={() => ease({ x: 0, y: 0, k: 1 })} onMouseLeave={() => setHover(null)}>
          {size.w > 0 && (
            <svg width={size.w} height={size.h} className="block select-none">
              <defs>
                {HUES.map((c, k) => <marker key={k} id={`bm-arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill={c} /></marker>)}
              </defs>
              <g style={{ transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.k})`, transformOrigin: "0 0", transition: glide ? "transform 520ms cubic-bezier(0.22,1,0.36,1)" : "none" }}>
                {map.links.map((l, k) => {
                  const p = at[l.a], q = at[l.b]; if (!p || !q) return null;
                  // From the sender / funder to the other, edge to edge, so an arrow lands on the ring.
                  const [s0, s1] = l.dir < 0 ? [q, p] : [p, q];
                  const dx = s1.x - s0.x, dy = s1.y - s0.y, d = Math.hypot(dx, dy) || 1;
                  const c = map.nodes[l.a].cluster;
                  return <line key={k} x1={s0.x + (dx / d) * (s0.r + 2)} y1={s0.y + (dy / d) * (s0.r + 2)} x2={s1.x - (dx / d) * (s1.r + 3)} y2={s1.y - (dy / d) * (s1.r + 3)}
                    stroke={hue(c)} strokeWidth={1.3 / Math.sqrt(cam.k)} strokeDasharray={l.hops > 1 ? "1.5 4" : "3 3"} strokeLinecap="round"
                    markerEnd={l.dir !== 0 && c != null ? `url(#bm-arrow-${c % HUES.length})` : undefined} opacity={linkLit(l) ? 0.9 : 0.1} className="transition-opacity duration-300" />;
                })}
                {map.nodes.map((x, i) => {
                  const p = at[i]; if (!p) return null;
                  const c = hue(x.cluster), on = lit(i), sel = i === picked || i === hover?.i;
                  return (
                    <g key={x.w} transform={`translate(${p.x},${p.y})`} opacity={on ? 1 : 0.2} className="cursor-pointer transition-opacity duration-300"
                      onPointerDown={(e) => grab(e, x.w)} onPointerMove={pull} onPointerUp={() => drop(i)} onPointerCancel={() => drop(-1)}
                      onMouseMove={(e) => { if (held.current?.moved) return; const b = box.current!.getBoundingClientRect(); setHover({ i, x: e.clientX - b.left, y: e.clientY - b.top }); }} onMouseLeave={() => setHover(null)}>
                      {sel && <circle r={p.r + 5} fill="none" stroke={x.cluster == null ? "#9aa3b5" : c} strokeOpacity={0.45} strokeWidth={1} />}
                      <circle r={p.r} fill={x.cluster == null ? "rgba(255,255,255,0.025)" : c} fillOpacity={x.cluster == null ? 1 : 0.16}
                        stroke={x.kind === "pool" ? "#6b7385" : x.cluster == null ? RING : c} strokeWidth={(sel ? 2 : 1.2) / Math.sqrt(cam.k)} strokeDasharray={x.kind === "pool" ? "4 3" : undefined} />
                      {p.r * cam.k > 17 && <text y={x.kind !== "holder" || x.tag === "dev" ? -1 : 3.5} textAnchor="middle" className="num pointer-events-none fill-ink-2 font-semibold" style={{ fontSize: Math.min(13, p.r / 2.6) }}>{pctStr(x.pct)}</text>}
                      {p.r * cam.k > 17 && (x.kind !== "holder" || x.tag === "dev") && <text y={Math.min(13, p.r / 2.6) + 1} textAnchor="middle" className="pointer-events-none fill-muted font-semibold uppercase" style={{ fontSize: Math.min(10, p.r / 3.4), letterSpacing: "0.06em" }}>{x.kind === "pool" ? "Pool" : x.kind === "exchange" ? "Exchange" : "Dev"}</text>}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
          {/* What is connected, at a glance. */}
          <div className="pointer-events-none absolute top-3 left-3 rounded-control border border-rule bg-paper/85 px-3 py-2 backdrop-blur">
            <p className="label text-muted">Connected supply</p>
            <p className="num text-xl font-bold text-ink">{linked.toFixed(linked >= 10 ? 1 : 2)}%</p>
            <p className="text-xs text-muted">{map.clusters.length ? `${map.clusters.length} cluster${map.clusters.length === 1 ? "" : "s"} · ${map.clusters.reduce((t, c) => t + c.n, 0)} wallets` : "No clusters among the top holders"}</p>
          </div>
          <div className="absolute top-3 right-3 flex flex-col gap-1">
            {[["+", () => ease((c) => zoomAt(c, 1.4, size))], ["−", () => ease((c) => zoomAt(c, 1 / 1.4, size))], ["⟲", () => ease({ x: 0, y: 0, k: 1 })]].map(([l, f]) => (
              <button key={l as string} onPointerDown={(e) => e.stopPropagation()} onClick={f as () => void} className="grid size-8 place-items-center rounded-control border border-rule bg-paper/85 text-md font-semibold text-ink-2 backdrop-blur hover:text-ink">{l as string}</button>
            ))}
          </div>
          <Live t={map.t} now={now} busy={s.rugcheck.busy || s.trace.busy} />
          {hover && <Tip map={map} i={hover.i} x={hover.x} y={hover.y} w={size.w} />}
        </div>
        <Legend map={map} now={now} />
      </div>
      <aside className="flex w-full shrink-0 flex-col border-rule lg:h-[640px] lg:w-68 lg:border-l">
        {picked >= 0 ? <Wallet map={map} i={picked} onPick={choose} onClose={() => { setPick(null); setFocus(null); }} /> : (
          <>
            <div className="flex gap-1 border-b border-rule p-2">
              {(["clusters", "wallets"] as const).map((k) => (
                <button key={k} onClick={() => setSide(k)} className={cn("flex-1 rounded-full py-1 text-sm font-semibold capitalize", side === k ? "bg-paper-4 text-ink" : "text-muted hover:text-ink-2")}>{k}</button>
              ))}
            </div>
            {side === "clusters" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2">
                {map.clusters.length ? map.clusters.map((c, k) => (
                  <div key={k} role="button" tabIndex={0} onClick={() => { const on = focus === k; setFocus(on ? null : k); if (!on) fit(c.members); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { const on = focus === k; setFocus(on ? null : k); if (!on) fit(c.members); } }}
                    className={cn("flex cursor-pointer flex-col gap-1 rounded-control px-2.5 py-2 text-left transition-colors", focus === k ? "bg-paper-4" : "hover:bg-paper-3")}>
                    <span className="flex items-center gap-2 text-sm">
                      <i className="size-2.5 shrink-0 rounded-full" style={{ background: hue(k) }} />
                      <span className="font-semibold text-ink-2">Cluster {k + 1}</span><span className="text-muted">{c.n} wallets</span>
                      <b className="num ml-auto font-semibold text-ink">{pctStr(c.pct)}</b>
                    </span>
                    <span className="flex flex-wrap gap-1 pl-4.5">{c.why.map((y) => <span key={y} title={WHY[y]} className="rounded-full bg-paper-3 px-1.5 py-px text-2xs text-muted">{WHY_SHORT[y]}</span>)}</span>
                    {focus === k && (
                      <span className="mt-1 flex flex-col pl-4.5">
                        {[...c.members].sort((x, y) => map.nodes[y].pct - map.nodes[x].pct).map((j) => (
                          <span key={j} role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); choose(j); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); choose(j); } }}
                            className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-paper-3">
                            <span className="num text-muted">#{j + 1}</span><span className="num text-ink-2">{map.nodes[j].label || short(map.nodes[j].w)}</span>
                            {map.nodes[j].tag && <Chip>{map.nodes[j].tag}</Chip>}<span className="num ml-auto text-ink">{pctStr(map.nodes[j].pct)}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                )) : <p className="p-3 text-sm text-muted">None of the top holders are connected{s.rugcheck.t ? "" : " so far"}. Every holder is drawn as its own grey ring.</p>}
                <div className="mt-auto flex flex-col gap-1.5 rounded-control bg-paper-2 p-3 text-xs leading-relaxed text-muted">
                  <p className="font-semibold text-ink-2">Reading the map</p>
                  <p>Each bubble is one of the top {map.nodes.length} holders, sized by its share. Coloured bubbles are connected wallets, often one person or team.</p>
                  <p>Wallets join when they sent each other the coin or SOL (RugCheck), share a first funder, or bought in the launch block with the dev. Exchanges and the pool never join.</p>
                  <p>Drag a bubble, scroll to zoom, click one for its links.</p>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a wallet" className="m-2 h-8 rounded-control border border-rule bg-paper-2 px-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-muted" />
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                  {map.nodes.map((x, i) => [x, i] as const).filter(([x]) => !q || x.w.toLowerCase().includes(q.toLowerCase()) || (x.label || "").toLowerCase().includes(q.toLowerCase())).map(([x, i]) => (
                    <button key={x.w} onClick={() => { choose(i); fit([i]); }} onMouseEnter={() => { const p = at[i]; if (p) setHover({ i, x: cam.x + p.x * cam.k, y: cam.y + p.y * cam.k }); }} onMouseLeave={() => setHover(null)}
                      className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm hover:bg-paper-3">
                      <span className="num w-6 shrink-0 text-right text-xs text-muted">{i + 1}</span>
                      <i className="size-2 shrink-0 rounded-full" style={{ background: x.cluster == null ? "transparent" : hue(x.cluster), boxShadow: x.cluster == null ? `inset 0 0 0 1px ${RING}` : undefined }} />
                      <span className="num truncate text-ink-2">{x.label || short(x.w)}</span>
                      {x.kind !== "holder" ? <Chip>{x.kind === "pool" ? "Pool" : "CEX"}</Chip> : x.tag && <Chip>{x.tag}</Chip>}
                      <span className="num ml-auto shrink-0 text-ink">{pctStr(x.pct)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

const zoomAt = (c: { x: number; y: number; k: number }, f: number, s: { w: number; h: number }) => {
  const k = Math.min(8, Math.max(0.6, c.k * f)), mx = s.w / 2, my = s.h / 2;
  return { k, x: mx - ((mx - c.x) / c.k) * k, y: my - ((my - c.y) / c.k) * k };
};

const Chip = ({ children }: { children: React.ReactNode }) => <span className="shrink-0 rounded bg-paper-3 px-1 py-px text-2xs font-semibold text-muted uppercase">{children}</span>;

function Live({ t, now, busy }: { t: number; now: number; busy: boolean }) {
  const age = Math.max(0, now - t);
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-full border border-rule bg-paper/85 px-2.5 py-1 text-xs text-muted backdrop-blur">
      <span className="relative flex size-2"><span className={cn("absolute inset-0 rounded-full bg-up", age < 20_000 && "animate-ping opacity-60")} /><span className="relative size-2 rounded-full bg-up" /></span>
      <span>Live · {age < 5000 ? "just now" : `${ageStr(age)} ago`}{busy ? " · checking links" : ""}</span>
    </div>
  );
}

function Tip({ map, i, x, y, w }: { map: Answer; i: number; x: number; y: number; w: number }) {
  const n = map.nodes[i], c = n.cluster != null ? map.clusters[n.cluster] : null;
  const left = x + 260 > w ? x - 256 : x + 16;
  return (
    <div className="pointer-events-none absolute z-10 w-60 rounded-control border border-rule-2 bg-paper/95 px-3 py-2 text-sm shadow-sheet backdrop-blur" style={{ left, top: Math.max(8, y - 12) }}>
      <p className="flex items-center gap-2"><span className="num font-semibold text-ink">{n.label || short(n.w)}</span><span className="num ml-auto font-semibold text-ink">{pctStr(n.pct)}</span></p>
      <p className="text-xs text-muted">#{i + 1} holder{n.tokens != null ? ` · ${tokStr(n.tokens)} tokens` : ""}{n.tag ? ` · ${n.tag}` : ""}</p>
      <p className="mt-1 text-xs" style={{ color: c ? hue(n.cluster) : undefined }}>
        {n.kind === "pool" ? "Liquidity pool" : n.kind === "exchange" ? "Exchange wallet" : c ? `Cluster ${n.cluster! + 1} · ${c.n} wallets · ${pctStr(c.pct)}` : n.via ? `Funded from ${n.via}, not linked` : <span className="text-muted">{n.untraceable ? "Long history, no links found" : "No links to other top holders"}</span>}
      </p>
    </div>
  );
}

function Wallet({ map, i, onPick, onClose }: { map: Answer; i: number; onPick: (i: number) => void; onClose: () => void }) {
  const n = map.nodes[i], c = n.cluster != null ? map.clusters[n.cluster] : null;
  const mine = map.links.filter((l) => l.a === i || l.b === i);
  const copy = () => navigator.clipboard?.writeText(n.w).then(() => toast("Address copied"), () => toast("Couldn't copy the address"));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <p className="label text-muted">#{i + 1} holder</p>
          <p className="num truncate text-md font-semibold text-ink">{n.label || short(n.w)}</p>
        </div>
        <button onClick={onClose} className="ml-auto rounded-full px-2 text-lg leading-none text-muted hover:text-ink" aria-label="Close">×</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat k="Holds" v={pctStr(n.pct)} />
        <Stat k="Tokens" v={n.tokens != null ? tokStr(n.tokens) : "—"} />
      </div>
      <div className="flex gap-2">
        <button onClick={copy} className="h-8 flex-1 rounded-full border border-rule-2 text-sm font-semibold text-ink-2 hover:border-muted hover:text-ink">Copy</button>
        <a href={`https://solscan.io/account/${n.w}`} target="_blank" rel="noopener" className="grid h-8 flex-1 place-items-center rounded-full border border-rule-2 text-sm font-semibold text-ink-2 hover:border-muted hover:text-ink">Solscan ↗</a>
      </div>
      {c ? (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-2 text-sm"><i className="size-2.5 rounded-full" style={{ background: hue(n.cluster) }} /><span className="font-semibold text-ink-2">Cluster {n.cluster! + 1}</span><span className="num ml-auto text-ink">{pctStr(c.pct)}</span></p>
          <p className="label mt-1 text-muted">Linked to</p>
          {mine.map((l, k) => {
            const j = l.a === i ? l.b : l.a, m = map.nodes[j];
            const out = (l.a === i) === (l.dir > 0);
            return (
              <button key={k} onClick={() => onPick(j)} className="flex flex-col rounded-control px-2 py-1.5 text-left hover:bg-paper-3">
                <span className="flex items-center gap-2 text-sm"><span className="num text-ink-2">{m.label || short(m.w)}</span><span className="num ml-auto text-ink">{pctStr(m.pct)}</span></span>
                <span className="text-xs text-muted">{linkWords(l, out)}</span>
              </button>
            );
          })}
          {!mine.length && <p className="text-xs text-muted">Joined through another member of the cluster.</p>}
        </div>
      ) : <p className="text-sm text-muted">{n.kind === "pool" ? "The coin's liquidity pool. Pools never join a cluster." : n.kind === "exchange" ? "An exchange wallet. Exchanges never join a cluster." : n.via ? `First funded from ${n.via}. Exchange funding doesn't link wallets.` : n.untraceable ? "This wallet's history is too long to find its first funder, and RugCheck shows no transfers with other top holders." : "Not linked to any other top holder."}</p>}
    </div>
  );
}

// How a line joins two wallets, from the open wallet's side.
function linkWords(l: Link, out: boolean) {
  if (l.hops === 1) {
    if (l.kinds.includes("transfer")) return out ? "Sent it the coin or SOL" : "Got the coin or SOL from it";
    if (l.kinds.includes("funded")) return out ? "Funded it first" : "Its first funder";
    return "Bought in the launch block together";
  }
  if (l.hops === 2 && l.kinds.length === 1 && l.kinds[0] === "funded") return "Same first funder";
  return `${l.kinds.map((y) => WHY[y]).join(" · ")} · through ${l.hops - 1} wallet${l.hops > 2 ? "s" : ""}`;
}

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-control bg-paper-3 px-2.5 py-1.5"><p className="label text-muted">{k}</p><p className="num text-md font-semibold text-ink">{v}</p></div>
);

function Legend({ map, now }: { map: Answer; now: number }) {
  const s = map.sources, rc = s.rugcheck, tr = s.trace;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule px-3 py-2 text-xs text-muted">
      <span className="flex items-center gap-1.5"><svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="#9aa3b5" strokeDasharray="3 3" /></svg>Direct link</span>
      <span className="flex items-center gap-1.5"><svg width="22" height="6"><line x1="1" y1="3" x2="21" y2="3" stroke="#9aa3b5" strokeDasharray="1.5 4" strokeLinecap="round" /></svg>Through other wallets</span>
      <span className="flex items-center gap-1.5"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="none" stroke={RING} /></svg>Not linked</span>
      <span className="ml-auto">
        Top {map.nodes.length} of {s.holderCount != null ? s.holderCount.toLocaleString() : "?"} holders
        {" · "}RugCheck {rc.error ? <span className="text-warn">{rc.error.toLowerCase()}</span> : rc.t ? `${rc.networks} network${rc.networks === 1 ? "" : "s"} (${ageStr(Math.max(0, now - rc.t))} ago)` : "checking…"}
        {" · "}Funders {tr.busy ? `tracing ${tr.done}/${tr.total}` : `${tr.traced}/${tr.of} traced`}
      </span>
    </div>
  );
}
