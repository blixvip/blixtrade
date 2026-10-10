import { useEffect, useRef, useState } from 'react';
import { usePoll, type CoinData, type TokenDetail } from '@/lib/coin';
import { TokenPic, usd } from '../traders/parts';
import { LinkedText } from './MessageRow';
import { clockTime, senderName, tokenSource, type Message, type Quote, type HistoryPage } from './types';
export function DetailPanel({ selected, onClose, quotes }: { selected: { kind: 'token' | 'thread'; message: Message }; onClose: () => void; quotes: Record<string, Quote> }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { const prior = document.activeElement as HTMLElement | null; close.current?.focus(); const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; addEventListener('keydown', escape); return () => { removeEventListener('keydown', escape); prior?.focus(); }; }, [onClose]);
  return <aside aria-label={selected.kind === 'token' ? 'Token details' : 'Discussion'} className="flex min-h-0 flex-col border-l border-rule bg-paper-2 lg:w-[360px] lg:shrink-0 max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:max-h-[58%] max-lg:border-t max-lg:shadow-sheet">
    <div className="flex items-center justify-between border-b border-rule px-4 py-3"><span className="text-[13px] font-semibold text-muted">{selected.kind === 'token' ? 'Token details' : 'Discussion'}</span><button ref={close} onClick={onClose} aria-label={selected.kind === 'token' ? 'Close token details' : 'Close discussion'} className="grid size-8 place-items-center rounded-control text-xl hover:bg-paper-4">×</button></div>
    <div className="min-h-0 overflow-y-auto p-4">{selected.kind === 'token' ? <TokenDetails key={selected.message.mint} message={selected.message} quote={selected.message.mint ? quotes[selected.message.mint] : undefined} /> : <Thread key={selected.message.id} message={selected.message} />}</div>
  </aside>;
}
function TokenDetails({ message: m, quote }: { message: Message; quote?: Quote }) {
  const token = usePoll<TokenDetail>(m.mint ? `token/${m.mint}` : null, 15000);
  const coin = usePoll<CoinData>(m.mint ? `coin/${m.mint}` : null, 5000);
  const [copied, setCopied] = useState(false);
  const mc = coin.data?.mcUsd ?? quote?.mc ?? token.data?.token?.mcap;
  return <div className="flex flex-col gap-4">
    <div className="flex items-center gap-3"><span className="size-12 shrink-0 overflow-hidden rounded-full"><TokenPic mint={m.mint} chain={m.chain ?? 1399811149} img={m.img || null} /></span><div className="min-w-0"><h2 className="break-words text-xl font-semibold">{token.data?.token?.symbol || m.ticker || 'Token'}</h2><p className="text-[13px] text-muted">{token.data?.token?.name || 'Solana'}</p></div></div>
    <dl className="grid grid-cols-2 gap-3 text-[13px]"><div><dt className="text-muted">Market cap</dt><dd className="mt-1 text-xl font-semibold">{usd(mc)}</dd></div><div><dt className="text-muted">Quote freshness</dt><dd className="mt-1">{coin.data?.priceAgeMs != null ? `${Math.round(coin.data.priceAgeMs / 1000)}s old` : quote ? `As of ${clockTime(quote.t)}` : 'Unavailable'}</dd></div></dl>
    <p className="text-[12px] text-muted [overflow-wrap:anywhere]">{m.mint}</p>
    <button onClick={async () => { try { await navigator.clipboard.writeText(m.mint || ''); setCopied(true); } catch { setCopied(false); } }} className="rounded-control border border-rule-2 px-3 py-2 text-[13px] hover:bg-paper-3">{copied ? 'Address copied' : 'Copy token address'}</button>
    {token.error ? <p role="status" className="rounded-control border border-rule p-3 text-[14px] text-ink-2">Blix hasn’t indexed this token yet. Open its source page below; your conversation stays here.</p> : !token.data ? <p role="status" className="text-[13px] text-muted">Looking up token details…</p> : token.data.token?.description ? <p className="text-[14px] text-ink-2 [overflow-wrap:anywhere]"><LinkedText text={token.data.token.description} /></p> : null}
    <a href={tokenSource(m)} target="_blank" rel="noopener noreferrer" className="rounded-control bg-ink px-3 py-2 text-center text-[14px] font-semibold text-on-fill">Open on pump.fun</a>
    <a href={`https://dexscreener.com/solana/${m.mint}`} target="_blank" rel="noopener noreferrer" className="text-center text-[13px] text-info hover:underline">View market on DexScreener</a>
    {token.data?.token && <a href={`#/coin/${m.mint}/feed`} className="text-center text-[13px] text-info hover:underline">Open full trading view</a>}
  </div>;
}
function Thread({ message: m }: { message: Message }) {
  const parent = m.replyTo?.id || m.id;
  const { data, error } = usePoll<HistoryPage>(`feed/history?thread=${encodeURIComponent(parent)}&limit=200`, 5000);
  const rows = data?.items || [m];
  return <div className="flex flex-col gap-4"><p className="text-[12px] text-muted">Imported discussion · read-only</p>{rows.map(x => <article key={x.id} className="border-b border-rule pb-3 text-[14px]"><header className="mb-1 flex justify-between gap-2 text-[12px] text-muted"><b>{senderName(x)}</b><time>{clockTime(x.t)}</time></header><p className="whitespace-pre-wrap [overflow-wrap:anywhere]"><LinkedText text={x.comment || x.text || x.ticker || 'Activity'} /></p></article>)}{error && <p className="text-[13px] text-warn">Couldn’t load the full discussion. Retrying…</p>}</div>;
}
export function HotList({ onToken, sources }: { onToken: (m: Message) => void; sources: string }) {
  const [window, setWindow] = useState(30);
  const { data } = usePoll<{ since?: number; top: { mint: string; ticker: string; img: string | null; mc: number; n: number; chain: number }[] }>(`feed/hot?w=${window}&src=${sources}`, 5000);
  return <section className="p-4"><h2 className="text-[15px] font-semibold">Hot right now</h2><div role="group" aria-label="Ranking time window" className="mt-3 flex gap-1">{[1, 5, 15, 30, 60].map(n => <button key={n} aria-pressed={n === window} onClick={() => setWindow(n)} className="flex-1 rounded-control border border-rule px-1 py-1 text-[12px] aria-pressed:bg-paper-4">{n === 60 ? '1h' : `${n}m`}</button>)}</div><p className="mt-3 text-[12px] text-muted">Most mentioned in imported messages{data?.since ? ` · collecting since ${clockTime(data.since)}` : ''}.</p><div className="mt-3 flex flex-col gap-1">{data?.top?.map((x, i) => <button key={x.mint} onClick={() => onToken({ ...x, id: `hot:${x.mint}`, seq: 0, source: 'pump', type: 'token', t: Date.now(), timelineAt: Date.now(), receivedAt: Date.now() })} className="flex items-center gap-2 rounded-control py-3 text-left hover:bg-paper-3"><span className="w-4 text-[12px] text-muted">{i + 1}</span><span className="size-8 shrink-0 overflow-hidden rounded-full"><TokenPic mint={x.mint} chain={x.chain} img={x.img} /></span><span className="min-w-0 flex-1"><b className="block truncate text-[14px]">{x.ticker || x.mint.slice(0, 6)}</b><span className="text-[12px] text-muted">{x.n} messages</span></span><span className="text-[13px] text-ink-2">{usd(x.mc)}</span></button>)}</div>{!data?.top?.length && <p className="py-4 text-[13px] text-muted">No recent mentions in this window.</p>}</section>;
}
