export type Source = 'fomo' | 'pump';
export interface Message {
  id: string; seq: number; source: Source; type: string; t: number; timelineAt: number; receivedAt: number; late?: boolean;
  user?: { handle?: string | null; pump?: string | null; name?: string; pic?: string | null; verified?: boolean; fomo?: boolean } | null;
  mint: string | null; chain?: number | null; ticker?: string | null; img?: string | null;
  comment?: string | null; text?: string | null; notes?: string | null; quoted?: string | null; media?: string | null; pinned?: boolean;
  side?: string; usd?: number | null; mc?: number | null; entryMc?: number | null; pnlUsd?: number | null; pnlPct?: number | null;
  likes?: number; replies?: number; views?: number; count?: number | null;
  replyTo?: { id: string; name: string; text: string };
}
export interface SourceStatus { t?: number | null; ready?: boolean; error?: boolean; signedOut?: boolean }
export interface HistoryPage { items: Message[]; cursor: number; before: number | null; hasMore: boolean; gap?: boolean; retained: number; status: Partial<Record<Source, SourceStatus | null>> }
export interface Quote { mc: number; t: number }
export const GROUPS = [['trades', 'Trades'], ['closed', 'Closed positions'], ['theses', 'Theses'], ['multi', 'Multi-user trades'], ['listings', 'New listings'], ['spikes', 'Price spikes'], ['milestones', 'Profit milestones'], ['traders', 'New traders']] as const;
export const sourceName = (source: Source) => source === 'pump' ? 'pump.fun' : 'Fomo';
export const senderName = (m: Message) => {
  const u = m.user;
  if (u?.name && !/^(user|anon|anonymous)$/i.test(u.name)) return u.name;
  return u?.handle || u?.pump || `${sourceName(m.source)} · ${m.id.replace(/^.*:/, '').slice(0, 8)}`;
};
export const clockTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const tokenSource = (m: Pick<Message, 'mint'>) => `https://pump.fun/coin/${encodeURIComponent(m.mint || '')}`;
