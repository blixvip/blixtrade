import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MessageRow, sameSender } from './MessageRow';
import { clockTime, type Message, type Quote } from './types';
const indexAt = (offsets: number[], y: number) => { let lo = 0, hi = offsets.length - 1; while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (offsets[mid] <= y) lo = mid; else hi = mid - 1; } return lo; };
export function VirtualLog({ rows, follow, onReading, onToken, onThread, quotes, freshAfter }: { rows: Message[]; follow: boolean; onReading: () => void; onToken: (m: Message) => void; onThread: (m: Message) => void; quotes: Record<string, Quote>; freshAfter: number }) {
  const el = useRef<HTMLDivElement>(null), sizes = useRef(new Map<string, number>()), previous = useRef<{ rows: Message[]; offsets: number[] } | null>(null), ignore = useRef(false);
  const [measured, measure] = useState(0), [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [announced] = useState(() => new Set<string>());
  const interaction = useRef(0);
  // Keep the first loaded row's separator after prepending history; removing it moves the text being read.
  const boundaries = useRef(new Set<string>());
  if (rows[0]) boundaries.current.add(rows[0].id);
  const offsets = useMemo(() => { const values = [0]; for (const row of rows) values.push(values.at(-1)! + (sizes.current.get(row.id) || 125)); return values; }, [rows, measured]);
  const top = follow ? Math.max(0, offsets.at(-1)! - viewport.height) : viewport.top;
  const start = Math.max(0, indexAt(offsets, Math.max(0, top - 700)) - 1), end = follow ? rows.length : Math.min(rows.length, indexAt(offsets, top + viewport.height + 700) + 2);
  useLayoutEffect(() => {
    const node = el.current; if (!node) return;
    const prev = previous.current; ignore.current = true;
    if (follow) node.scrollTop = node.scrollHeight;
    else if (prev?.rows.length) {
      const i = Math.min(prev.rows.length - 1, indexAt(prev.offsets, node.scrollTop));
      const id = prev.rows[i]?.id, next = rows.findIndex(m => m.id === id);
      if (next >= 0) node.scrollTop = offsets[next] + node.scrollTop - prev.offsets[i];
    }
    previous.current = { rows, offsets };
    setViewport(v => v.top === node.scrollTop && v.height === node.clientHeight ? v : { top: node.scrollTop, height: node.clientHeight });
    const raf = requestAnimationFrame(() => { ignore.current = false; });
    const keep = new Set(rows.map(m => m.id)); for (const id of sizes.current.keys()) if (!keep.has(id)) sizes.current.delete(id);
    for (const id of announced) if (!keep.has(id)) announced.delete(id);
    for (const id of boundaries.current) if (!keep.has(id)) boundaries.current.delete(id);
    return () => cancelAnimationFrame(raf);
  }, [rows, offsets, follow, announced, viewport.height]);
  useLayoutEffect(() => {
    const node = el.current; if (!node) return;
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.measureId;
        if (!id) { setViewport(v => ({ ...v, height: node.clientHeight })); continue; }
        const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (Math.abs((sizes.current.get(id) || 125) - h) > 0.5) { sizes.current.set(id, h); changed = true; }
      }
      if (changed) measure(n => n + 1);
    });
    observer.observe(node); node.querySelectorAll('[data-measure-id]').forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [start, end, rows]);
  return <div ref={el} role="log" aria-label="Imported messages" aria-live="off" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-rule-2"
    onWheel={e => { interaction.current = Date.now(); if (follow && e.deltaY < 0) onReading(); }}
    onTouchMove={() => { interaction.current = Date.now(); }}
    onPointerDown={e => { if (e.target === e.currentTarget) interaction.current = Date.now(); }}
    onKeyDown={e => { if (follow && ['ArrowUp', 'PageUp', 'Home'].includes(e.key)) onReading(); }}
    onScroll={() => {
    const node = el.current; if (!node) return;
    setViewport({ top: node.scrollTop, height: node.clientHeight });
    if (!ignore.current && follow && Date.now() - interaction.current < 1200 && node.scrollHeight - node.scrollTop - node.clientHeight > 60) onReading();
  }}>
    <div style={{ height: offsets[start] }} aria-hidden />
    {rows.slice(start, end).map((m, local) => {
      const i = start + local, prev = rows[i - 1];
      const boundary = boundaries.current.has(m.id);
      const minute = boundary || !prev || Math.floor(prev.timelineAt / 60000) !== Math.floor(m.timelineAt / 60000);
      const day = boundary || !prev || new Date(prev.timelineAt).toDateString() !== new Date(m.timelineAt).toDateString();
      const fresh = m.seq > freshAfter && !announced.has(m.id) && !m.late && follow;
      announced.add(m.id);
      return <div key={m.id} data-measure-id={m.id}>
        {minute && <div className="flex items-center gap-3 px-4 py-2 text-[12px] text-muted"><span className="h-px flex-1 bg-rule" /><span>{day ? new Date(m.timelineAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' : ''}{clockTime(m.timelineAt)}</span><span className="h-px flex-1 bg-rule" /></div>}
        <MessageRow message={m} grouped={!minute && sameSender(prev, m)} fresh={fresh} quote={m.mint ? quotes[m.mint] : undefined} onToken={onToken} onThread={onThread} />
      </div>;
    })}
    <div style={{ height: Math.max(0, offsets.at(-1)! - offsets[end]) }} aria-hidden />
    <div className="h-3" />
  </div>;
}
