import { useEffect, useRef, useState } from 'react';
import { fetchApi, streamFailed, streamInit, streamUrl } from '@/lib/api';
import type { HistoryPage, Message, Quote } from './types';
export const MAX_MESSAGES = 3000;
// An answer without its list (an older server, a cut-off read) is an empty page, not a crash.
const asPage = (j: unknown): HistoryPage => { const p = (j && typeof j === 'object' ? j : {}) as HistoryPage; return { ...p, items: Array.isArray(p.items) ? p.items : [], status: p.status && typeof p.status === 'object' ? p.status : {} as HistoryPage['status'] }; };
export function mergeMessages(old: Message[], incoming: Message[], keep: 'latest' | 'oldest' = 'latest') {
  const map = new Map(old.map(m => [m.id, m]));
  for (const m of incoming) { const prev = map.get(m.id); map.set(m.id, prev ? { ...m, seq: prev.seq, timelineAt: prev.timelineAt, t: prev.t } : m); }
  const rows = [...map.values()].sort((a, b) => a.seq - b.seq);
  return keep === 'latest' ? rows.slice(-MAX_MESSAGES) : rows.slice(0, MAX_MESSAGES);
}
export function useChat(query: string) {
  const [state, setState] = useState<{ query: string; rows: Message[]; loaded: boolean; status: HistoryPage['status']; error: string | null; live: boolean; gap: boolean; hasMore: boolean; start: number | null }>({ query, rows: [], loaded: false, status: {}, error: null, live: false, gap: false, hasMore: false, start: null });
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const cursor = useRef(0), before = useRef<number | null>(null), generation = useRef(0);
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    const gen = ++generation.current; cursor.current = 0; before.current = null;
    setState({ query, rows: [], loaded: false, status: {}, error: null, live: false, gap: false, hasMore: false, start: null }); setQuotes({});
    let stopped = false, busy = false, again = false, beat = Date.now(), stream: EventSource | null = null, reconnect = 0;
    const controller = new AbortController(), identities = new Map<string, string>();
    const load = async () => {
      if (stopped) return;
      if (busy) { again = true; return; } busy = true;
      try {
        const after = cursor.current;
        const r = await fetchApi(`api/feed/history?${query}${after ? `&after=${after}` : ''}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        if (!r.ok) throw Error('Messages are temporarily unavailable. Reconnecting…');
        const page = asPage(await r.json());
        if (stopped || gen !== generation.current) return;
        cursor.current = page.cursor;
        if (before.current == null) before.current = page.before;
        setState(s => {
          const known = new Set(s.rows.map(m => m.id)), newest = s.rows.at(-1)?.seq || 0;
          // An edit to unloaded old history is not an arrival. Inserting it here would also skip intervening
          // history on the next before-cursor request. It will be read when that history page is requested.
          const incoming = after ? page.items.filter(m => known.has(m.id) || m.seq > newest) : page.items;
          return { ...s, rows: mergeMessages(s.rows, incoming), loaded: true, status: page.status, error: null, gap: s.gap || Boolean(page.gap), hasMore: after ? s.hasMore : page.hasMore, start: !after && !page.hasMore ? page.items[0]?.seq ?? null : s.start };
        });
        setQuotes(old => {
          const next = { ...old };
          for (const m of page.items) if (m.mint && m.mc != null && (!next[m.mint] || next[m.mint].t < m.receivedAt)) next[m.mint] = { mc: m.mc, t: m.receivedAt };
          return Object.fromEntries(Object.entries(next).sort((a, b) => b[1].t - a[1].t).slice(0, 1500));
        });
        if (after && page.hasMore) again = true;
      } catch { if (!stopped) setState(s => ({ ...s, error: 'Messages are temporarily unavailable. Reconnecting…', live: false })); }
      finally { busy = false; if (again && !stopped) { again = false; void load(); } }
    };
    refresh.current = () => { void load(); };
    const alive = () => { beat = Date.now(); setState(s => s.live ? s : { ...s, live: true }); };
    const open = () => {
      if (stopped) return; stream?.close(); beat = Date.now();
      const es = stream = new EventSource(streamUrl(`api/feed/stream?${query}`), streamInit());
      let opened = false;
      es.onopen = () => { opened = true; alive(); void load(); };
      es.addEventListener('heartbeat', alive);
      es.addEventListener('feed', e => {
        alive(); void load();
        try {
          const d = JSON.parse((e as MessageEvent).data);
          const patches: [string, Quote][] = [];
          for (const p of d.up || []) {
            const key = `${d.src}:${p.id}`; if (p.mint) identities.set(key, p.mint);
            const mint = p.mint || identities.get(key);
            if (mint && typeof p.mc === 'number') patches.push([mint, { mc: p.mc, t: d.t || Date.now() }]);
          }
          while (identities.size > 1500) identities.delete(identities.keys().next().value!);
          if (patches.length) setQuotes(q => Object.fromEntries(Object.entries({ ...q, ...Object.fromEntries(patches) }).sort((a, b) => b[1].t - a[1].t).slice(0, 1500)));
        } catch { /* malformed source event: the cursor request remains authoritative */ }
      });
      es.onerror = () => {
        setState(s => ({ ...s, live: false }));
        if (!opened && streamFailed()) { clearTimeout(reconnect); reconnect = window.setTimeout(open, 250); }
        // Native EventSource reconnects automatically; the next open resumes from the durable cursor.
      };
    };
    open(); void load();
    const poll = setInterval(() => { if (!document.hidden) void load(); }, 2500);
    const watchdog = setInterval(() => {
      if (document.hidden || Date.now() - beat < 45000) return;
      setState(s => ({ ...s, live: false })); open();
    }, 5000);
    const focus = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', focus);
    return () => { stopped = true; controller.abort(); stream?.close(); clearTimeout(reconnect); clearInterval(poll); clearInterval(watchdog); document.removeEventListener('visibilitychange', focus); };
  }, [query]);
  const older = async (boundary?: number) => {
    const gen = generation.current, b = boundary ?? before.current;
    if (!b) return [];
    const r = await fetchApi(`api/feed/history?${query}&before=${b}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Error('Could not load older messages. Try again.');
    const page = asPage(await r.json());
    if (gen !== generation.current) return [];
    before.current = page.before; setState(s => ({ ...s, hasMore: page.hasMore, start: !page.hasMore ? page.items[0]?.seq ?? b : s.start }));
    return page.items;
  };
  return { ...state, rows: state.query === query ? state.rows : [], quotes, older, refresh: () => refresh.current() };
}
