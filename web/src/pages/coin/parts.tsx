// Small pieces shared by the coin page: icons the shell set lacks, the price with counted zeros,
// wallet chips with their role tags, a copy button and the coin's picture.
import { EmptyState } from "@/components/page";
import { useState, type ReactNode, type SVGProps } from "react";
import { SolanaLogo } from "@/components/brand";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { priceParts, solNum, type WalletTags } from "@/lib/coin";
import { shortAddr } from "@/lib/format";
import { usePic } from "@/lib/pics";
import { previewHandlers } from "@/components/PicPreview";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

const I = (d: ReactNode) => ({ className, ...p }: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("shrink-0", className)} {...p}>{d}</svg>
);
export const CIcon = {
  back: I(<path d="M15 5l-7 7 7 7" />),
  shield: I(<><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></>),
  external: I(<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />),
  pencil: I(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>),
  check: I(<path d="M5 12.5l4.5 4.5L19 7" />),
  window: I(<><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 9h17M7 13h4M7 16h7" /></>),
};

export function Price({ value, className }: { value: number | null | undefined; className?: string }) {
  const p = priceParts(value);
  if (!p) return <span className={className}>—</span>;
  return <span className={cn("num", className)}>{p[0]}{p[1] != null && <sub className="text-[0.7em]">{p[1]}</sub>}{p[2]}</span>;
}

export function copy(text: string, what = "Copied") {
  navigator.clipboard?.writeText(text).then(() => toast(what), () => toast("Copy failed"));
}
export function CopyBtn({ text, tip = "Copy", className }: { text: string; tip?: string; className?: string }) {
  return (
    <Tip tip={tip}>
      <button onClick={(e) => { e.stopPropagation(); copy(text); }} aria-label={tip}
        className={cn("grid size-6 place-items-center rounded-chip text-muted hover:bg-paper-4 hover:text-ink", className)}>
        <Icon.copy className="size-3.5" />
      </button>
    </Tip>
  );
}

const TAG: Record<string, [string, string]> = {
  dev: ["DEV", "text-warn bg-warn/15"], sniper: ["SNIPER", "text-caution bg-caution/15"], bundle: ["BUNDLE", "text-down bg-down/15"],
};
export function Tags({ x }: { x: WalletTags }) {
  return (
    <>
      {x.tag && <i className={cn("rounded-chip px-1.5 py-px text-[0.625rem] font-bold not-italic tracking-wide", TAG[x.tag][1])}>{TAG[x.tag][0]}</i>}
      {x.top10 && <i className="rounded-chip bg-accent/15 px-1.5 py-px text-[0.625rem] font-bold not-italic tracking-wide text-accent">TOP 10</i>}
      {x.followed && <i className="max-w-28 truncate rounded-chip bg-up/15 px-1.5 py-px text-[0.625rem] font-bold not-italic tracking-wide text-up">{x.label || "FOLLOWED"}</i>}
    </>
  );
}

// A wallet: short address (opens Solscan) and its role on this coin.
export function Who({ wallet, x }: { wallet: string | null; x: WalletTags }) {
  if (!wallet) return <span className="text-muted">not named by the feed</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <a href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noreferrer" title={wallet}
        className="font-outlier text-xs text-ink-2 hover:text-accent">{shortAddr(wallet)}</a>
      <Tags x={x} />
    </span>
  );
}

// The coin's picture from the radar's image cache, the ticker underneath until it loads.
export function CoinPic({ mint, symbol, size = 56, ring }: { mint: string; symbol?: string | null; size?: number; ring?: number | null }) {
  const pic = usePic(mint);
  // A picture that failed in this <img> stays hidden even when the coin loaded fine elsewhere (no broken-image icon).
  const [broken, setBroken] = useState<string | null>(null);
  const pad = ring == null ? 0 : 3;
  return (
    <div className="relative shrink-0 rounded-[13px]" style={{ width: size + pad * 2, height: size + pad * 2, padding: pad,
      background: ring == null ? undefined : `conic-gradient(var(--color-up) ${Math.min(1, Math.max(0, ring)) * 360}deg, var(--color-rule-2) 0)` }}>
      <div className="relative grid size-full place-items-center overflow-hidden rounded-[10px] bg-paper-4" {...previewHandlers(mint)}>
        <span className="font-display text-xs font-semibold text-muted">{(symbol || "?").slice(0, 4).toUpperCase()}</span>
        {pic.src && broken !== pic.key && (
          <img key={pic.key} src={pic.src} alt="" decoding="async" fetchPriority="low" onLoad={pic.onLoad} onError={() => { setBroken(pic.key); pic.onError(); }}
            className={cn("absolute inset-0 size-full object-cover transition-opacity duration-200", pic.ok ? "opacity-100" : "opacity-0")} />
        )}
      </div>
    </div>
  );
}

// A SOL amount: the Solana logomark, then the number ("—" when unknown).
export function SolAmt({ v, signed, className }: { v: number | null | undefined; signed?: boolean; className?: string }) {
  if (v == null || !isFinite(v)) return <>—</>;
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", className)}><SolanaLogo className="w-[0.85em]" />{solNum(v, signed)}</span>;
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return <EmptyState title={title} hint={text} icon={/couldn|failed|error/i.test(title) ? "search" : "inbox"} className="min-h-40" />;
}
