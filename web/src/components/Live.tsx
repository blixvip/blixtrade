// Restored 2026-10-06 from the compiled build after warp-9b overwrote it by accident (Windows paths ignore case).
// Behaviour matches the build exactly; the original comments were lost.
import { type ReactNode } from "react";
import { compact } from "@/lib/format";
import { useLiveMc } from "@/lib/livepx";
import { cn } from "@/lib/utils";

// A live number. It used to flash green or red on each change; the user wants figures to just update, as fast
// as they come, with no colour flash (2026-10-10). `value` is kept so callers need not change.
export function Flash({ children, className }: { value?: number | null; children: ReactNode; className?: string }) {
  return <b className={cn("num", className)}>{children}</b>;
}

// A coin's market cap from the live trade stream (or `value` until a trade comes in).
export function LiveMc({ mint, value, fmt = compact, className }: { mint: string; value?: number | null; fmt?: (n: number | null | undefined) => string; className?: string }) {
  const v = useLiveMc(mint) ?? value ?? null;
  return <Flash value={v} className={className}>{fmt(v)}</Flash>;
}
