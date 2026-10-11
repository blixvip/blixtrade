import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SolanaLogo } from "@/components/brand";
import { useMetrics, metricNumber, metricDescription } from '@/lib/metrics';
import { useNow } from '@/lib/route';

// Solana's official logomark (public/brand/solana.svg), the "≡" in Axiom's "F ≡ 4.832".
export function SolMark({ className }: { className?: string }) {
  return <SolanaLogo className={cn("w-3", className)} />;
}

const amount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : n >= 100 ? n.toFixed(1) : n >= 10 ? n.toFixed(2) : n.toFixed(3);

// What traders have paid to trade the coin, in SOL: network and priority fees plus tips (server/coinfees.js).
// `since`: when Blix started counting it (a coin older than that shows what it paid since).
export function FeesPaid({ mint, sol, since, born, className }: { mint?: string; sol?: number | null; since?: number | null; born?: number | null; className?: string }) {
  useNow();
  const metrics = useMetrics(mint);
  // The row's figure arrives with every trade and fee the stream pushes; the metric every 5 s: the larger is the newer (fees only grow).
  const m = metricNumber(metrics, 'fees'); sol = m == null ? sol : sol == null ? m : Math.max(m, sol); since = metricNumber(metrics, 'feesSince', since);
  if (sol == null || !(sol > 0)) return null;
  const partial = since != null && born != null && since - born > 5 * 60_000;
  const from = partial ? ` since ${new Date(since!).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "";
  return (
    <Tip tip={`Estimated fees paid${from}: ${sol.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL. ${metrics?.fields.feesObserved ? `${metrics.fields.feesObserved.value.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL observed; remainder estimates unread blocks. ` : ''}${metricDescription(metrics?.fields.fees) || 'Estimated from the blocks Blix reads; coverage is incomplete.'}`}>
      <span className={cn("flex shrink-0 items-center gap-1 text-xs text-muted", className)}>
        F<SolMark /><b className="num text-md font-semibold text-ink">{amount(sol)}</b>
      </span>
    </Tip>
  );
}
