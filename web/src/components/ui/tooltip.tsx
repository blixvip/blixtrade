import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = ({ children }: { children: ReactNode }) => <T.Provider delayDuration={600} skipDelayDuration={200}>{children}</T.Provider>;

// A hint on hover or focus. `tip` empty = no tooltip, the child renders as is.
export function Tip({ tip, children, side = "top" }: { tip?: ReactNode; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  if (!tip) return <>{children}</>;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} collisionPadding={8}
          className="z-50 max-w-72 rounded-control border border-rule-2 bg-paper-4 px-2 py-1.5 text-xs leading-snug text-ink-2 shadow-sheet">
          {tip}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
