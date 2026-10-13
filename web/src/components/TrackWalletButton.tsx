import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { saveTrackedWallet, useTracking } from "@/lib/tracking";

export function TrackWalletButton({ address, name, pic, grp = 1, className }: { address: string | null; name: string; pic?: string | null; grp?: number; className?: string }) {
  const { wallets, pending, role, known, ready, error } = useTracking();
  const tracked = wallets.some(w => w.address === address), busy = Boolean(address && pending[address]);
  const loading = !known || (role !== "visitor" && !ready && !error);
  return <button type="button" aria-label={`${tracked ? "Stop tracking" : "Track"} ${name}`} aria-pressed={tracked}
    disabled={!address || busy || loading} title={!address ? "Trading wallet not available yet" : tracked ? "Remove from your wallet tracker" : "Add to your wallet tracker"}
    onClick={async e => {
      e.preventDefault(); e.stopPropagation();
      if (role === "visitor") { toast("Sign in to track traders"); location.hash = "#/account"; return; }
      if (!address) return;
      try { await saveTrackedWallet({ address, name, grp, pic }, !tracked); toast(tracked ? `Stopped tracking ${name}` : `Tracking ${name}`); }
      catch (err) { toast((err as Error).message); }
    }} className={cn("wt-track-button h-8 shrink-0 rounded-control border px-3 text-sm font-semibold whitespace-nowrap transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ink/40", tracked ? "border-up/30 bg-up/10 text-up hover:border-down/40 hover:text-down" : "border-rule-2 bg-paper-4 text-ink hover:bg-paper-5", className)}>
    {busy ? "Saving…" : tracked ? "Tracking" : "Track"}
  </button>;
}
