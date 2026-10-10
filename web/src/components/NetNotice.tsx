import { useEffect, useRef, useState } from "react";
import { useNet, watchNet, type NetState } from "@/lib/net";
import { cn } from "@/lib/utils";

// A small pill above the bottom bars when the connection is slow or gone, so lagging prices and slow fills have
// a reason on screen. It says "Back to full speed" for a moment when things recover. Closing it hides it until
// the connection has recovered and worsened again.
type Shown = NetState | "back";

function Bars({ lit, cut }: { lit: number; cut?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={1 + i * 4} y={12 - i * 3} width="2.6" height={3 + i * 3} rx="1"
          className={cn("fill-current", i < lit ? "" : cut ? "opacity-40" : "opacity-25", i === lit - 1 && "animate-pulse")} />
      ))}
      {cut && <path d="M2 2l12 12" className="stroke-current" strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

export function NetNotice() {
  const state = useNet((s) => s.state), ms = useNet((s) => s.ms);
  const [shown, setShown] = useState<Shown | null>(null);
  const closed = useRef(false), was = useRef<NetState>("ok");
  useEffect(watchNet, []);
  useEffect(() => {
    const before = was.current;
    was.current = state;
    if (state === "ok") {
      closed.current = false;
      if (before === "ok") return;
      setShown("back");
      const t = setTimeout(() => setShown(null), 2500);
      return () => clearTimeout(t);
    }
    if (!closed.current) setShown(state);
  }, [state]);
  if (!shown) return null;

  const look = {
    slow: { tone: "text-warn", icon: <Bars lit={2} />, title: "Slow connection", sub: `Prices and fills may lag${ms ? ` · ${(ms / 1000).toFixed(1)}s to the server` : ""}` },
    offline: { tone: "text-down", icon: <Bars lit={0} cut />, title: "You're offline", sub: "Reconnecting…" },
    back: { tone: "text-up", icon: <Bars lit={4} />, title: "Back to full speed", sub: "" },
    ok: null,
  }[shown];
  if (!look) return null;

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-11 left-1/2 z-[60] -translate-x-1/2 max-md:bottom-20">
      <div key={shown} className={cn("pointer-events-auto relative flex items-center gap-2.5 overflow-hidden rounded-full border border-white/[0.07] bg-paper-3/85 py-1.5 pr-1.5 pl-3 shadow-[0_14px_40px_-12px_oklch(0%_0_0/0.75),inset_0_1px_0_oklch(100%_0_0/0.06)] backdrop-blur-xl animate-tx-in", look.tone, !look.sub && "pr-3.5")}>
        <i aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_160%_at_0%_50%,currentColor,transparent_60%)] opacity-[0.1]" />
        <span className="relative grid size-6 shrink-0 place-items-center rounded-full bg-current/[0.13]">{look.icon}</span>
        <span className="relative flex items-baseline gap-2 whitespace-nowrap">
          <b className="text-sm font-semibold text-ink">{look.title}</b>
          {look.sub && <span className="num text-xs text-muted max-sm:hidden">{look.sub}</span>}
        </span>
        {shown !== "back" && (
          <button aria-label="Hide connection notice" onClick={() => { closed.current = true; setShown(null); }}
            className="relative grid size-6 place-items-center rounded-full text-muted transition-colors hover:bg-ink/[0.08] hover:text-ink">×</button>
        )}
      </div>
    </div>
  );
}
