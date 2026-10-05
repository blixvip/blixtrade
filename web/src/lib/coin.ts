// Data for the coin page (#/coin/<mint>): the radar's stored detail (/api/token), the live ledger
// (/api/coin), recent trades (/api/coin/<mint>/trades), candles and quotes. Plain polling hooks: each
// endpoint is re-read on its own clock, paused while the tab is hidden, and keeps the last good answer
// through a failed read.
import { useEffect, useState } from "react";
import { api } from "./api";

export type Tag = "dev" | "sniper" | "bundle" | null;
export interface WalletTags { tag: Tag; top10: boolean; label: string | null; followed: boolean; fomo: boolean }
export interface Holder extends WalletTags {
  wallet: string; tokens: number; pct: number; maxPct: number;
  boughtSol: number | null; soldSol: number | null; valueSol: number | null; pnlSol: number | null; realizedSol: number | null;
  boughtUsd: number | null; soldUsd: number | null; valueUsd: number | null; pnlUsd: number | null;
  avgBuyMc: number | null; avgSellMc: number | null; trades: number; first: number;
  status: "holding" | "sold some" | "sold all" | "outside top 100"; slot?: number | null; afterFirstMs?: number;
}
export interface Group { n: number; pct: number; maxPct: number; sold: number }
export interface DevCoin { mint: string; name?: string | null; symbol?: string | null; t?: number | null; mcap?: number | null; peak?: number | null; status?: string | null; graduated?: boolean; progress?: number }
export interface CoinData {
  mint: string; symbol: string | null; name: string | null; solUsd: number | null; live: boolean; onCurve: boolean;
  mcUsd: number | null; priceUsd: number | null; athUsd: number | null; progress: number | null; supply: number;
  priceAgeMs?: number | null;   // how old mcUsd is (0 = priced this second by the Pulse)
  m5: { source: "live" | "tracked"; buys: number; sells: number; buyUsd: number | null; sellUsd: number | null; volUsd: number | null; netUsd: number | null; traders: number | null } | null;
  holders: { count: number; wallets: number; trades: number; since: number | null; last: number; genesis: boolean; partial: boolean; frozen: boolean; top10: number; list: Holder[]; source?: "jupiter" } | null;
  // Tabs filled from the Jupiter data API when the ledger cannot cover the coin (bonded, or met after launch).
  jupiter?: { tabs: ("holders" | "traders" | "early")[]; tradersWindow: { trades: number; since: number | null } | null } | null;
  // The Jupiter audit: authorities, top holders, bots, bundles, the dev's launches.
  audit?: { mintAuthorityDisabled?: boolean; freezeAuthorityDisabled?: boolean; topHoldersPercentage?: number; botHoldersPercentage?: number; botHoldersCount?: number; devMints?: number; devMigrations?: number;
    bundlerStats?: { totalBundles?: number; holdingPct?: number; holdingPctATH?: number }; holders?: number | null; launchpad?: string | null; organic?: string | null } | null;
  traders: Holder[]; early: Holder[];
  dev: { wallet: string; pct: number | null; maxPct?: number; boughtSol?: number; soldSol?: number; sold?: "all" | "part" | null; coins: { count: number; others: number; list: DevCoin[]; window: string } } | null;
  // Current figures only: the live ledger on the curve, RugCheck after bonding (checked = when it read it); null = unknown now.
  info: { holders: number | null; top10: number | null; devPct: number | null; snipers: Group | null; bundle: Group | null; insiders: number | null; lpLocked: number | null; safety: number | null; traders: number | null; source: string | null; checked: number | null };
  tradesSince: number | null;
  created?: number | null;   // the coin's real creation time (Jupiter), when known
  // Tagged trades in the server's ring (dev, snipers, bundles, followed wallets), for the chart's icons.
  marks?: { t: number; side: "buy" | "sell"; sol: number; mcUsd: number | null; wallet: string; tag: Tag; followed: boolean; label: string | null }[];
  // DexScreener orders: paid profile ("DEX paid"), ads, takeovers, boosts. null until DexScreener answers.
  paid?: { orders: { type: string; status: string; t: number }[]; boosts: { amount: number | null; t: number }[] } | null;
}
export interface Trade extends WalletTags { t: number; side: "buy" | "sell"; sol: number | null; usd: number | null; tokens: number | null; mcUsd: number | null; wallet: string | null; tx?: string | null }
export interface Trades { mint: string; source: "live" | "pool" | "none"; trades: Trade[]; note?: string; since?: number | null }
export interface Risk { name: string; value?: string; description?: string; level?: string }
export interface Paper {
  id: number; mint: string; symbol?: string; t: number; sol: number; mcap0?: number | null; status: "open" | "closed";
  exit_sol?: number | null; exit_mcap?: number | null; exit_t?: number | null; exit_why?: string | null; valueSol?: number | null; mcapNow?: number | null; mult?: number | null;
  tokens?: number | null;   // quoted rows: tokens bought (an open row) or sold (a closed one)
}
export interface TokenDetail {
  token: {
    mint: string; symbol?: string | null; name?: string | null; description?: string | null; image?: string | null; first_seen?: number | null; pair?: string | null; dex?: string | null;
    pair_created?: number | null; price?: number | null; mcap?: number | null; liquidity?: number | null; vol_m5?: number | null; chg_h1?: number | null;
    links?: { type?: string; url?: string }[]; boosts?: number | null; header?: string | null; safety?: { risks?: Risk[]; lpLockedPct?: number | null; totalHolders?: number | null; top10?: number | null; insiderPct?: number | null; devPct?: number | null } | null;
    safety_score?: number | null; safety_checked?: number | null; status?: string | null; graduated?: boolean | number | null; peak_mcap?: number | null; creator?: string | null; themes?: string[] | null;
    fresh?: { dead?: boolean; quarantine?: string | null; illiquid?: boolean; exitWhy?: string | null; stale?: boolean; ageMs?: number | null; source?: string | null } | null;
  };
  untracked?: boolean;
  verdict?: { ok: boolean; unknown?: boolean; reasons?: string[] } | null;
  live?: { mcap?: number; ath?: number; buys?: number; sells?: number; traders?: number; progress?: number; chg1m?: number | null } | null;
  triage?: { label: string; score: number; why?: string } | null;
  signals?: { kind: string; title: string; detail?: string; t: number; safe?: number }[];
  research?: { status?: string; grade?: string | null; verdict?: string | null; model?: string | null; t?: number | null; report?: { grade?: string; verdict?: string; why?: string; thesis?: string; risks?: string[]; trade?: { action?: string; pWin?: number | null; why?: string } | null } | null } | null;
  paper?: Paper[];
  progress?: number | null;
}
export interface Quote { outTokens?: number; outSol?: number; impactPct?: number | null; minOut?: number; route?: string[]; avgMcapUsd?: number | null; spotMcapUsd?: number | null; usdIn?: number | null; usdOut?: number | null; feeSol?: number | null; src?: string }

// Re-read `path` every `ms` while it is non-null. A new path starts empty; a refresh keeps what is shown.
// The last good answer for each path, so reopening a view or switching a tab shows it at once while the
// fresh request runs. Keyed by the exact path (one coin's answer never stands in for another's).
const lastAnswer = new Map<string, unknown>();
const remember = (path: string, data: unknown) => {
  lastAnswer.delete(path); lastAnswer.set(path, data);
  if (lastAnswer.size > 200) lastAnswer.delete(lastAnswer.keys().next().value!);
};
const known = <T,>(path: string | null) => (path ? (lastAnswer.get(path) as T | undefined) ?? null : null);
// Ask for a path ahead of time (a tab the reader is likely to open next); usePoll then starts with it.
export function prefetch(path: string) { api(path).then((d) => remember(path, d)).catch(() => {}); }

export function usePoll<T>(path: string | null, ms: number) {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null }>(() => ({ path, data: known<T>(path), error: null }));
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true, timer = 0;
    let ctl: AbortController | null = null;
    const run = async () => {
      if (!document.hidden) {
        ctl = new AbortController();
        const t = setTimeout(() => ctl?.abort(), 20_000);
        try {
          const data = await api<T>(path, { signal: ctl.signal });
          remember(path, data);
          if (alive) setState({ path, data, error: null });
        } catch (e) {
          if (alive && !ctl.signal.aborted) setState((s) => ({ ...s, path, error: (e as Error).message, data: s.path === path ? s.data : null }));
        } finally { clearTimeout(t); }
      }
      if (alive) timer = window.setTimeout(run, ms);
    };
    run();
    return () => { alive = false; ctl?.abort(); clearTimeout(timer); };
  }, [path, ms, nonce]);
  return { data: state.path === path ? state.data : known<T>(path), error: state.path === path ? state.error : null, refresh: () => setNonce((n) => n + 1) };
}

// ---------- formats (in the classic coin page's style) ----------
export const usdK = (n: number | null | undefined) => {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n);
  return a >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K` : `$${a >= 10 ? Math.round(n) : n.toFixed(2)}`;
};
export const usdSigned = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${usdK(Math.abs(n))}`);
// A SOL amount's number; on screen it follows the Solana logomark (SolAmt in pages/coin/parts.tsx).
export const solNum = (n: number, signed = false) => {
  const a = Math.abs(n);
  return `${signed ? (n >= 0 ? "+" : "−") : ""}${a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a >= 1 ? a.toFixed(2) : a >= 0.001 || a === 0 ? a.toFixed(3) : a.toPrecision(2)}`;
};
// The same as plain text, where a logo cannot go (tooltips, toasts).
export const solN = (n: number | null | undefined, signed = false) => (n == null || !isFinite(n) ? "—" : `${solNum(n, signed)} SOL`);
export const tokN = (n: number | null | undefined) =>
  n == null ? "—" : n >= 9.995e8 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));
export const pctN = (n: number | null | undefined, d = 1) => (n == null || !isFinite(n) ? "—" : `${n.toFixed(n < 10 && d ? d : 0)}%`);
export const sinceMs = (ms: number | null | undefined) =>
  ms == null ? "—" : ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s` : ms < 3600_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3600_000)}h`;
// $0.0₄398: zeros after the point shown as a count, like Axiom and GMGN.
export function priceParts(p: number | null | undefined): [string, number | null, string] | null {
  if (!p || !isFinite(p)) return null;
  if (p >= 1) return [`$${p.toFixed(3)}`, null, ""];
  const m = p.toFixed(12).match(/^0\.(0+)(\d{3})/);
  return m && m[1].length >= 4 ? ["$0.0", m[1].length, m[2]] : [`$${p.toPrecision(3)}`, null, ""];
}
