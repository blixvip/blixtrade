import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useUi } from '@/lib/ui';
import { Dialog } from '@/components/ui/dialog';
import { GROUPS, senderName, sourceName, type Message, type Quote, type Source } from './types';
import { mergeMessages, useChat } from './useChat';
import { VirtualLog } from './VirtualLog';
import { DetailPanel, HotList } from './Details';
const allGroups = GROUPS.map(([key]) => key);
function saved(key: string, defaults: string[]) { try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(value) ? value.filter(x => defaults.includes(x)) : defaults; } catch { return defaults; } }
const control = 'rounded-control border border-rule-2 px-3 py-1.5 text-[13px] font-medium hover:bg-paper-3 focus-visible:outline-2 focus-visible:outline-info';
export function Feed() {
  const [groups, setGroups] = useState<string[]>(() => saved('blix:feed:groups', allGroups));
  const [sources, setSources] = useState<Source[]>(() => { const s = saved('blix:feed:sources', ['fomo', 'pump']) as Source[]; return s.length ? s : ['fomo', 'pump']; });
  const [filters, setFilters] = useState(false), [ranking, setRanking] = useState(false);
  const focus = useUi(s => s.feedFocus);
  const [search, setSearch] = useState(''), [sender, setSender] = useState(''), [token, setToken] = useState(''), [textQuery, setTextQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setTextQuery(search), 200); return () => clearTimeout(t); }, [search]);
  const query = new URLSearchParams({ groups: groups.join(','), sources: sources.join(','), ...(textQuery ? { q: textQuery } : {}), ...(sender ? { sender } : {}), ...(token ? { token } : {}) }).toString();
  const chat = useChat(query);
  const [held, setHeld] = useState<{ rows: Message[]; quotes: Record<string, Quote>; mode: 'paused' | 'reading' } | null>(null);
  const [historyRows, setHistoryRows] = useState<Message[]>([]), [loadingHistory, setLoadingHistory] = useState(false), [historyError, setHistoryError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ kind: 'token' | 'thread'; message: Message } | null>(null);
  const firstSeq = useRef<number | null>(null), previousQuery = useRef(query), heldAfter = useRef(0);
  const announcedAt = useRef(0);
  const [announcement, setAnnouncement] = useState('');
  const merged = useMemo(() => mergeMessages(historyRows, chat.rows), [historyRows, chat.rows]);
  const visible = held?.rows || merged;
  const canLoadOlder = chat.hasMore || (chat.start != null && Boolean(visible.length) && visible[0].seq > chat.start);
  if (firstSeq.current == null && chat.rows.length) firstSeq.current = Math.max(...chat.rows.map(m => m.seq));
  useEffect(() => { if (previousQuery.current !== query) { previousQuery.current = query; firstSeq.current = null; announcedAt.current = 0; setAnnouncement(''); setHeld(null); setHistoryRows([]); setHistoryError(null); } }, [query]);
  useEffect(() => {
    const latest = chat.rows.at(-1); if (!latest) return;
    if (announcedAt.current && latest.seq > announcedAt.current) {
      const n = chat.rows.filter(m => m.seq > announcedAt.current).length;
      setAnnouncement(`${n} incoming message${n === 1 ? '' : 's'}. ${senderName(latest)}: ${(latest.comment || latest.text || latest.ticker || 'Activity').slice(0, 90)}`);
    }
    announcedAt.current = Math.max(announcedAt.current, latest.seq);
  }, [chat.rows]);
  const hold = (mode: 'paused' | 'reading') => {
    if (held) return;
    heldAfter.current = Math.max(0, ...chat.rows.map(m => m.seq));
    setHeld({ rows: visible, quotes: chat.quotes, mode });
  };
  const waiting = held ? chat.rows.filter(m => m.seq > heldAfter.current).length : 0;
  const jump = () => { setHeld(null); firstSeq.current = Math.max(0, ...chat.rows.map(m => m.seq)); };
  const openToken = useCallback((message: Message) => { setSelected({ kind: 'token', message }); setRanking(false); }, []);
  const openThread = useCallback((message: Message) => setSelected({ kind: 'thread', message }), []);
  const closeDetails = useCallback(() => setSelected(null), []);
  const loadOlder = async () => {
    if (loadingHistory) return;
    hold('reading'); setLoadingHistory(true); setHistoryError(null);
    try {
      const older = await chat.older(visible[0]?.seq);
      setHistoryRows(old => mergeMessages(older, old, 'oldest'));
      setHeld(h => h ? { ...h, rows: mergeMessages(older, h.rows, 'oldest') } : h);
    } catch (e) { setHistoryError((e as Error).message); }
    finally { setLoadingHistory(false); }
  };
  const pickGroup = (g: string[]) => { setGroups(g); try { localStorage.setItem('blix:feed:groups', JSON.stringify(g)); } catch {} };
  const toggleSource = (s: Source) => { const next = sources.includes(s) ? sources.filter(x => x !== s) : [...sources, s]; if (!next.length) return; setSources(next); try { localStorage.setItem('blix:feed:sources', JSON.stringify(next)); } catch {} };
  const status = (src: Source) => {
    const s = chat.status[src];
    if (!sources.includes(src)) return 'Off';
    if (chat.error) return chat.loaded ? 'Reconnecting' : 'Offline';
    if (s?.error || s?.signedOut) return 'Offline';
    if (!s?.ready) return 'Connecting';
    if (s.t && Date.now() - s.t > 30000) return 'Delayed';
    return chat.live ? 'Live' : 'Reconnecting';
  };
  const pins = visible.filter(m => m.pinned).slice(-3);
  const identities = [...new Set(chat.rows.map(senderName))].sort();
  const tokens = [...new Map(chat.rows.filter(m => m.mint).map(m => [m.mint!, m.ticker || m.mint!.slice(0, 8)])).entries()];
  const mode = held ? held.mode === 'paused' ? 'Paused' : 'Reading history' : 'Following live';
  return <div className="relative flex h-full min-h-0 w-full flex-col bg-paper">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
      <div><h1 className="text-xl font-semibold tracking-tight">Feed</h1><p className="mt-0.5 text-[13px] text-muted">Read-only live stream</p></div>
      <div className="flex flex-wrap items-center gap-2"><button onClick={() => held ? jump() : hold('paused')} aria-label={held ? 'Resume feed' : 'Pause feed'} className={control}>{held ? 'Resume' : 'Pause'}</button><button aria-pressed={focus} onClick={() => useUi.setState({ feedFocus: !focus })} className={control}>{focus ? 'Exit focus' : 'Focus chat'}</button><button onClick={() => setRanking(true)} className={cn(control, 'lg:hidden')}>Hot list</button></div>
    </header>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule px-4 py-2">
      <div role="group" aria-label="Sources" className="flex flex-wrap gap-2">{(['fomo', 'pump'] as Source[]).map(src => <button key={src} aria-pressed={sources.includes(src)} onClick={() => toggleSource(src)} disabled={sources.length === 1 && sources.includes(src)} className="flex items-center gap-1.5 rounded-control border border-rule px-2 py-1.5 text-[12px] text-muted aria-pressed:bg-paper-3 aria-pressed:text-ink"><span aria-hidden className={cn('size-1.5 rounded-full', status(src) === 'Live' ? 'bg-up' : status(src) === 'Offline' ? 'bg-down' : 'bg-warn')} /><b>{sourceName(src)}</b><span>· {status(src)}</span></button>)}</div>
      <span className="text-[12px] text-muted">{visible.length.toLocaleString()} loaded</span>
      {sources.includes('fomo') && <button className={cn(control, 'ml-auto')} onClick={() => setFilters(true)}>Fomo filters</button>}
    </div>
    <div className="flex min-h-0 flex-1">
      <section aria-label="Conversation" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-rule px-4 py-2">
          <input aria-label="Search messages" placeholder="Search conversation…" value={search} onChange={e => setSearch(e.target.value)} className="min-w-32 flex-1 rounded-control border border-rule bg-paper-2 px-3 py-2 text-[14px] outline-none focus:border-muted max-sm:basis-full" />
          <select aria-label="Filter by sender" value={sender} onChange={e => setSender(e.target.value)} className="max-w-[160px] rounded-control border border-rule bg-paper-2 px-2 py-1 text-[13px]"><option value="">All senders</option>{[...new Set([...(sender ? [sender] : []), ...identities])].map(name => <option key={name}>{name}</option>)}</select>
          <select aria-label="Filter by token" value={token} onChange={e => setToken(e.target.value)} className="max-w-[140px] rounded-control border border-rule bg-paper-2 px-2 py-1 text-[13px]"><option value="">All tokens</option>{token && !tokens.some(([mint]) => mint === token) && <option value={token}>{token.slice(0, 8)}</option>}{tokens.map(([mint, ticker]) => <option key={mint} value={mint}>{ticker}</option>)}</select>
        </div>
        {pins.length > 0 && <details className="shrink-0 border-b border-rule px-4 py-2 text-[13px] text-muted"><summary className="cursor-pointer">Pinned messages · {pins.length}</summary>{pins.map(m => <p key={m.id} className="mt-1 truncate">{senderName(m)}: {m.comment || m.text}</p>)}</details>}
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2 text-[12px] text-muted" data-loading-history={loadingHistory}>
          <span>{mode}</span>{canLoadOlder ? <button onClick={loadOlder} disabled={loadingHistory} className="text-info hover:underline disabled:opacity-50">{loadingHistory ? 'Loading history…' : 'Load older messages'}</button> : <span>{chat.loaded ? 'Start of retained history' : 'Loading messages…'}</span>}
        </div>
        {(chat.error || historyError || chat.gap) && <p role="status" className="px-4 py-2 text-[13px] text-warn">{historyError || chat.error || 'Some earlier events have left retained history. Load older messages to inspect what is available.'}{historyError && <button onClick={loadOlder} className="ml-2 underline">Retry</button>}</p>}
        {!chat.loaded && !chat.error ? <div role="status" className="grid flex-1 place-items-center text-[14px] text-muted">Connecting to the conversation…</div> : !visible.length ? <div className="grid flex-1 place-items-center px-6 text-center text-[14px] text-muted">{chat.error ? <button onClick={chat.refresh} className={control}>Retry connection</button> : 'No messages match these filters. New matching messages will appear here.'}</div> : <VirtualLog rows={visible} follow={!held} onReading={() => hold('reading')} onToken={openToken} onThread={openThread} quotes={held?.quotes || chat.quotes} freshAfter={firstSeq.current ?? Infinity} />}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-rule bg-paper-2 px-4 py-3 text-[12px] text-muted">
          {held ? <button onClick={jump} className="mx-auto rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-on-fill">{waiting ? `${waiting} new message${waiting === 1 ? '' : 's'} · ` : ''}Jump to live ↓</button> : <><span>Imported from Fomo and pump.fun</span><span className="max-sm:hidden">Scroll up to read · Pause to inspect</span></>}
        </footer>
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">{held ? waiting ? `${waiting} new messages available. Jump to live when ready.` : mode : announcement || mode}</span>
      </section>
      {selected ? <DetailPanel selected={selected} onClose={closeDetails} quotes={chat.quotes} /> : !focus && <aside aria-label="Hot list" className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-rule bg-paper-2/40 lg:block"><HotList sources={sources.join(',')} onToken={openToken} /></aside>}
    </div>
    <Dialog open={filters} onOpenChange={setFilters} title="Fomo filters"><p className="text-[13px] text-muted">These filters apply to Fomo. Use the pump.fun source switch to hide callouts.</p><button onClick={() => pickGroup(groups.length === allGroups.length ? [] : allGroups)} className="text-left text-[13px] text-info">{groups.length === allGroups.length ? 'Deselect all' : 'Select all'}</button><div className="flex flex-col gap-2">{GROUPS.map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-3 py-1 text-[14px]"><input type="checkbox" checked={groups.includes(key)} onChange={() => pickGroup(groups.includes(key) ? groups.filter(x => x !== key) : [...groups, key])} className="size-4 accent-white" />{label}</label>)}</div></Dialog>
    <Dialog open={ranking} onOpenChange={setRanking} title="Hot right now"><HotList sources={sources.join(',')} onToken={openToken} /></Dialog>
  </div>;
}
