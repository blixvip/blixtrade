import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Solana's mark (three slanted bars), the "≡" in Axiom's "F ≡ 4.832".
export function SolMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 14" aria-hidden="true" className={cn("size-3 shrink-0", className)} fill="currentColor">
      <path d="M3.2 0h12.3l-2.7 3H.5zM.5 5.5h12.3l2.7 3H3.2zM3.2 11h12.3l-2.7 3H.5z" />
    </svg>
  );
}

const amount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : n >= 100 ? n.toFixed(1) : n >= 10 ? n.toFixed(2) : n.toFixed(3);

// What traders have paid to trade the coin, in SOL: network and priority fees plus tips (server/coinfees.js).
// `since`: when Blix started counting it (a coin older than that shows what it paid since).
export function FeesPaid({ sol, since, born, className }: { sol?: number | null; since?: number | null; born?: number | null; className?: string }) {
  if (sol == null || !(sol > 0)) return null;
  const partial = since != null && born != null && since - born > 5 * 60_000;
  const from = partial ? ` since ${new Date(since!).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
  return (
    <Tip tip={`Fees paid${from}: ${sol.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL in network, priority and tip fees by everyone trading it (estimated from the blocks Blix reads)`}>
      <span className={cn("flex shrink-0 items-center gap-1 text-xs text-muted", className)}>
        F<SolMark className="text-ink-2" /><b className="num text-md font-semibold text-ink">{amount(sol)}</b>
      </span>
    </Tip>
  );
}
