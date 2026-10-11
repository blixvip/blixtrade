import { memo, type ReactNode } from 'react';
import { Avatar, Check, TokenPic, usd, traderHref } from '../traders/parts';
import { thumb } from '@/lib/thumb';
import { cn } from '@/lib/utils';
import { clockTime, senderName, sourceName, type Message, type Quote } from './types';
const clean = (s: string) => s.replace(/@\[([^\]]+)\]\([^)]*\)/g, '@$1');
export function LinkedText({ text }: { text: string }) {
  return <>{clean(text).split(/(https?:\/\/[^\s<>]+)/g).map((part, i) => /^https?:\/\//.test(part)
    ? <a key={i} href={part.replace(/[.,!?)]+$/, '')} target="_blank" rel="noopener noreferrer" className="text-info underline decoration-info/30 underline-offset-2 [overflow-wrap:anywhere]">{part}</a> : part)}</>;
}
function Text({ text, quote = false }: { text: string; quote?: boolean }) {
  const long = text.length > (quote ? 180 : 450) || text.split('\n').length > 5;
  const body = <p className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', quote && 'border-l-2 border-rule-2 pl-3 text-muted')}><LinkedText text={text} /></p>;
  return long ? <details className="mt-1"><summary className="cursor-pointer text-ink-2">{clean(text).slice(0, quote ? 130 : 220)}… <span className="text-info">Read {quote ? 'quotation' : 'more'}</span></summary><div className="mt-2">{body}</div></details> : body;
}
export const isActivity = (m: Message) => /^(large_|multi_user_|single_user_|price_since_listing|user_trade_profit_milestone|new_token_listing)/.test(m.type) && !m.comment;
export function sameSender(a: Message | undefined, b: Message) {
  if (!a || isActivity(a) || isActivity(b) || a.source !== b.source || Math.abs(b.t - a.t) > 120000) return false;
  const identity = (m: Message) => m.user?.handle || m.user?.pump;
  return Boolean(identity(a) && identity(a) === identity(b));
}
export const MessageRow = memo(function MessageRow({ message: m, grouped, fresh, quote, onToken, onThread }: { message: Message; grouped?: boolean; fresh?: boolean; quote?: Quote; onToken: (m: Message) => void; onThread: (m: Message) => void }) {
  const name = senderName(m), activity = isActivity(m);
  const profile = m.user?.handle ? traderHref(m.user.handle) : m.user?.wallet ? `#/trader/${m.user.wallet}` : null;   // a pump.fun caller opens their wallet's page on Blix
  const token = m.mint ? <button onClick={() => onToken(m)} aria-label={`Open ${m.ticker || 'token'} details`} className="inline-flex max-w-full items-center gap-1.5 rounded-control border border-rule px-2 py-0.5 align-middle text-[13px] font-semibold text-ink hover:border-muted"><span className="size-4 shrink-0 overflow-hidden rounded-full"><TokenPic mint={m.mint} chain={m.chain ?? 1399811149} img={m.img || null} /></span><span className="truncate">{m.ticker || `${m.mint.slice(0, 5)}…`}</span><span aria-hidden className="text-muted">↗</span></button> : null;
  const kind: Record<string, string> = { thesis_created: 'Thesis', pump_callout: 'Callout', pump_quote: 'Quote', reply: 'Reply', new_token_listing: 'New listing', user_trade_profit_milestone: 'Milestone' };
  const date = <time dateTime={new Date(m.timelineAt).toISOString()} title={`Stream time: ${new Date(m.timelineAt).toLocaleString()}`} className="shrink-0 text-[12px] tabular-nums text-muted">{clockTime(m.timelineAt)}</time>;
  const avatar: ReactNode = <Avatar src={m.user?.pic || null} name={name} size={32} />;
  return <article data-message-id={m.id} className={cn('chat-message rounded-control px-3 py-2 text-[15px] leading-[1.55]', fresh && 'chat-arrival', activity && 'py-1.5 text-[13px] text-muted')}>
    <div className="flex min-w-0 gap-3">
      <div className={cn('w-8 shrink-0', grouped && 'invisible')}>
        {profile ? <a href={profile} aria-label={`Open ${name}'s profile`} {...(profile.startsWith('https:') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{avatar}</a> : avatar}
      </div>
      <div data-message-content className="min-w-0 flex-1">
        {!grouped && <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
          <b className="font-semibold text-ink">{name}</b>
          {m.user?.verified && <span role="img" aria-label="Verified on source" className="text-info"><Check className="size-3" /></span>}
          <span className="text-[12px] text-muted">{sourceName(m.source)}</span>
          {!activity && kind[m.type] && <span className="text-[12px] text-muted">· {kind[m.type]}</span>}
          <span className="ml-auto">{date}</span>
        </header>}
        {grouped && <span className="float-right ml-2">{date}</span>}
        {m.late && <p className="text-[12px] text-warn">Imported late · posted <time dateTime={new Date(m.t).toISOString()}>{new Date(m.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></p>}
        {m.replyTo && <button onClick={() => onThread(m)} className="mb-1 block max-w-full truncate border-l-2 border-rule-2 pl-2 text-left text-[12px] text-muted hover:text-ink">Replying to {m.replyTo.name}: {m.replyTo.text}</button>}
        {m.comment || m.text ? <Text text={m.comment || m.text || ''} /> : null}
        {activity && <p>{m.side === 'sell' ? 'Sold' : m.side === 'buy' ? 'Bought' : kind[m.type] || m.type.replace(/_/g, ' ')} {m.usd ? <b className={m.side === 'sell' ? 'text-down' : 'text-up'}>{usd(m.usd)}</b> : ''} {token}</p>}
        {m.quoted && <div className="mt-2 text-[14px]"><Text text={m.quoted} quote /></div>}
        {m.media && <details className="mt-1 text-[13px] text-muted"><summary className="cursor-pointer">Show attached image</summary><img src={thumb(m.media, 680, { fit: 'inside' })} alt={`Image shared by ${name}`} loading="lazy" className="mt-2 max-h-64 max-w-full rounded-control" /></details>}
        {!activity && token && <div className="mt-1.5">{token}</div>}
        <details className="mt-1 text-[12px] text-muted">
          <summary className="w-fit cursor-pointer hover:text-ink">{activity ? 'Activity details' : 'Market & message details'}</summary>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 rounded-control border border-rule p-2">
            {m.mint && <div><dt>Market cap · shared quote</dt><dd className="text-ink-2">{usd(quote?.mc ?? null)} <span className="text-muted">{quote ? `· as of ${clockTime(quote.t)}` : '· unavailable'}</span></dd></div>}
            {m.entryMc != null && <div><dt>Call performance</dt><dd className="text-ink-2">Entry {usd(m.entryMc)}{quote && m.entryMc > 0 ? ` · ${(quote.mc / m.entryMc).toFixed(2)}×` : ''}</dd></div>}
            {m.pnlUsd != null && <div><dt>Trader position PnL · at import</dt><dd>{m.pnlUsd < 0 ? '−' : '+'}{usd(Math.abs(m.pnlUsd))}{m.pnlPct != null ? ` · ${m.pnlPct.toFixed(2)}%` : ''}</dd></div>}
            <div><dt>Source engagement · at import</dt><dd>{m.likes || 0} likes · {m.replies || 0} replies{m.views ? ` · ${m.views.toLocaleString()} views` : ''}</dd></div>
          </dl>
          <button className="mt-2 text-info hover:underline" onClick={() => onThread(m)}>Open discussion</button>
        </details>
      </div>
    </div>
  </article>;
});
