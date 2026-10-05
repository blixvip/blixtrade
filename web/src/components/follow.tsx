// The follow button, for a Blix account, a Fomo trader (by handle) or a wallet. Asks the server once for
// the current state unless the caller already knows it. Signed out, it sends you to sign in.
import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import { follow, social, type FollowKind } from "@/lib/social";
import { cn } from "@/lib/utils";

export function FollowButton({ kind, target, initial, onChange, size = "md", className }: {
  kind: FollowKind; target: string | number; initial?: boolean; onChange?: (on: boolean, counts?: { followers?: number }) => void; size?: "sm" | "md"; className?: string;
}) {
  const [on, setOn] = useState<boolean | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initial != null) { setOn(initial); return; }
    social<{ following: boolean }>(`follow?kind=${kind}&target=${encodeURIComponent(String(target))}`).then((r) => setOn(r.following)).catch(() => setOn(false));
  }, [kind, target, initial]);

  const click = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const r = await follow(kind, target, !on);
      setOn(r.following); onChange?.(r.following, r);
    } catch (err) {
      if ((err as { status?: number }).status === 401) { toast("Sign in to follow people"); location.hash = "#/account"; }
      else toast((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <button onClick={click} disabled={on == null || busy} aria-pressed={Boolean(on)}
      className={cn("group/f shrink-0 rounded-full border font-semibold whitespace-nowrap transition-colors duration-100 disabled:opacity-60",
        size === "sm" ? "h-7 px-3 text-sm" : "h-9 px-4 text-md",
        on ? "border-rule-2 bg-transparent text-ink hover:border-down/50 hover:text-down" : "border-ink bg-ink text-on-fill hover:bg-focus", className)}>
      {on ? <><span className="group-hover/f:hidden">Following</span><span className="hidden group-hover/f:inline">Unfollow</span></> : "Follow"}
    </button>
  );
}
