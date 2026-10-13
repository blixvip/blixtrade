// Number and time formats, kept identical to the classic page so the two read the same.
export const compact = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : `$${Math.round(n)}`;

export const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(Math.abs(n) < 10 ? 1 : 0)}%`;

// How old a coin is, coloured like Axiom: green for its first 10 minutes, orange to an hour, red after.
export const ageTone = (ms: number) => (ms < 10 * 60_000 ? "text-up" : ms < 60 * 60_000 ? "text-caution" : "text-down");
// How old a post (a tweet) is, coloured like Axiom: green for its first 10 minutes, yellow to an hour, red after,
// the same clock as a coin's age (ageTone). (The user, 2026-10-13: "the older they are they should be red ... kinda
// old yellow and green newer"; an hour for green left every tweet on a minutes-old coin green.)
export const postTone = (ms: number) => (ms < 10 * 60_000 ? "text-up" : ms < 60 * 60_000 ? "text-warn" : "text-down");
// The same as a tinted tag (text and a faint fill of the colour).
export const postTag = (ms: number) => (ms < 10 * 60_000 ? "text-up bg-up/12" : ms < 60 * 60_000 ? "text-warn bg-warn/12" : "text-down bg-down/12");
export const ageStr = (ms: number) => {
  const s = ms / 1000;
  return s < 60 ? `${Math.max(0, Math.floor(s))}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};

export const tone = (n: number | null | undefined) => (n == null || n === 0 ? "text-muted" : n > 0 ? "text-up" : "text-down");

export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export const providerOf = (m?: string | null) =>
  /^grok/i.test(m || "") ? "Grok" : /haiku/i.test(m || "") ? "Claude Haiku" : /^claude/i.test(m || "") ? "Claude" : m ? "Groq" : "AI";

export const fomoUrl = (mint: string) => `https://fomo.family/tokens/solana/${mint}`;

// Links come from coin creators: only http(s) is ever turned into a link.
export const safeHref = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);
