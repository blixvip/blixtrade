// Shared pieces of the Top traders pages (leaderboard and trader profile): money formats in Fomo's style,
// avatars with their rank badge, the token pile, and the wallet chip.
import type { ReactNode } from "react";
import { CoinImg } from "@/components/page";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

export type Range = "24h" | "7d" | "30d" | "all-time";
export const RANGES: [Range, string][] = [["24h", "24H"], ["7d", "7D"], ["30d", "30D"], ["all-time", "ALL"]];
export const SOLANA = 1399811149;   // Fomo's (Codex's) network id for Solana
export const QUOTES = new Set(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrajDsTVEb4f3xFeKbSkqvn9rk8Y3Y7xMhRzTsH"]);

// To the cent, as Fomo shows it: +$781,452.01.
export const exactUsd = (n: number | null | undefined, sign = true) =>
  n == null || !isFinite(n) ? "—" : `${sign ? (n >= 0 ? "+" : "−") : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const usd = (n: number | null | undefined) => {
  if (n == null || !isFinite(n)) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  return a >= 1e9 ? `${s}$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(1)}K` : `${s}$${a.toFixed(a >= 1 ? 2 : 4)}`;
};
export const signedShort = (n: number | null | undefined) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`);
export const pct = (n: number | null | undefined) => (n == null || !isFinite(n) ? "—" : `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`);
export const count = (n: number | null | undefined) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString());
export const amount = (n: number | null | undefined) => (n == null ? "—" : n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString("en-US", { maximumFractionDigits: 4 }));
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
export const tone = (n: number | null | undefined) => ((n ?? 0) >= 0 ? "text-up" : "text-down");
export const hold = (s: number | null | undefined) => (s == null ? "—" : s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))}m`);
export const traderHref = (handle?: string | null) => (handle ? `#/trader/${encodeURIComponent(handle)}` : undefined);
export const copy = (text: string, what = "Wallet") => { navigator.clipboard?.writeText(text); toast(`${what} copied`); };

export function Avatar({ src, size = 40, rank, className }: { src?: string | null; size?: number; rank?: number | null; className?: string }) {
  return (
    <span className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" loading="lazy" className="size-full rounded-full bg-paper-4 object-cover ring-1 ring-edge" /> : <span className="block size-full rounded-full bg-paper-4 ring-1 ring-edge" />}
      {rank != null && rank <= 100 && (
        <span className="num absolute -right-1 -bottom-1 grid h-4 min-w-4 place-items-center rounded-full border border-paper-2 bg-paper-5 px-1 text-[9px] font-bold text-ink">{rank}</span>
      )}
    </span>
  );
}

// Up to three token pictures, overlapping, then "+N" for the rest (Fomo's holdings pile).
export function Pile({ items, more, size = 22 }: { items: { img?: string | null; mint?: string; chain?: number; title?: string }[]; more?: number; size?: number }) {
  return (
    <span className="flex items-center">
      {items.map((h, i) => {
        const img = <TokenPic mint={h.mint} chain={h.chain} img={h.img} />;
        const cls = cn("block shrink-0 rounded-full ring-2 ring-paper-2", i && "-ml-1.5");
        return h.mint && h.chain === SOLANA
          ? <a key={i} href={`#/coin/${h.mint}`} onClick={(e) => e.stopPropagation()} title={h.title} className={cn(cls, "hover:z-10 hover:ring-ink")} style={{ width: size, height: size }}>{img}</a>
          : <span key={i} title={h.title} className={cls} style={{ width: size, height: size }}>{img}</span>;
      })}
      {more && more > 0 ? <span className="num -ml-1 grid h-[22px] min-w-[30px] place-items-center rounded-full bg-paper-4 px-1.5 text-[10px] font-semibold text-ink-2 ring-2 ring-paper-2">{more}+</span> : null}
    </span>
  );
}

export function Chip({ children, tone: t = "ink", className }: { children: ReactNode; tone?: "ink" | "up" | "down" | "warn" | "info"; className?: string }) {
  const c = { ink: "border-rule-2 bg-paper-3 text-ink-2", up: "border-up/40 bg-up/10 text-up", down: "border-down/40 bg-down/10 text-down", warn: "border-warn/40 bg-warn/10 text-warn", info: "border-info/40 bg-info/10 text-info" }[t];
  return <span className={cn("inline-flex h-5.5 items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap", c, className)}>{children}</span>;
}

// The trader's real Solana wallet (found on chain), or why there is none yet.
export function WalletChip({ wallet, verified, note, busy }: { wallet?: string | null; verified?: boolean; note?: string | null; busy?: boolean }) {
  if (!wallet) return <span className="text-sm text-muted" title={note || undefined}>{busy ? <span className="animate-pulse">finding wallet…</span> : "wallet not found yet"}</span>;
  return (
    <button onClick={(e) => { e.stopPropagation(); copy(wallet); }} title={`${wallet}\n${note || ""}`} className="flex items-center gap-1 font-outlier text-sm text-ink-2 hover:text-ink">
      {verified ? <Check className="size-3 text-up" /> : null}{short(wallet)}<Icon.copy className="size-3 text-muted" />
    </button>
  );
}

export const Check = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}><path d="M3.5 8.5l3 3 6-7" /></svg>
);

// A coin's picture: Solana coins through Blix's own image cache (CoinImg: small, cached, retried), other
// chains from the URL Fomo gave, a plain disc when there is neither. Fills its parent; size it from outside.
export function TokenPic({ mint, chain, img, className }: { mint?: string | null; chain?: number | null; img?: string | null; className?: string }) {
  return (
    <span className={`relative block size-full overflow-hidden rounded-full bg-paper-4 ${className || ""}`}>
      {mint && chain === SOLANA ? <CoinImg mint={mint} /> : img ? <img src={img} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" /> : null}
    </span>
  );
}
