import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

// A small window over the page for one task (deposit, withdraw, buy). Escape or a click outside closes it.
// `wide` makes it a large window; `aside` (a picture) then fills its left side, or its top on a phone.
// Overlay and window stay at z-40/50, under the transaction toasts (z-60).
export function Dialog({ open, onOpenChange, title, children, wide, aside }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; wide?: boolean; aside?: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={cn("fixed inset-0 z-40 bg-black/60", wide && "bg-black/70 backdrop-blur-[2px]")} />
        <D.Content aria-describedby={undefined}
          className={cn("fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 rounded-card border border-rule-2 bg-paper-2 shadow-sheet",
            wide ? "max-h-[calc(100dvh-1.5rem)] w-[min(60rem,calc(100vw-1.5rem))] overflow-hidden rounded-[16px] max-md:flex-col md:min-h-[min(560px,calc(100dvh-1.5rem))]" : "w-[min(26rem,calc(100vw-1.5rem))] flex-col p-5")}>
          {wide && aside && <div className="relative shrink-0 overflow-hidden max-md:h-44 md:w-[44%]">{aside}</div>}
          <div className={cn("flex min-w-0 flex-1 flex-col", wide && "overflow-y-auto p-7 max-md:p-5")}>
            {/* my-auto: short content sits in the middle of a tall window, long content still scrolls from its top */}
            <div className={cn("flex flex-col gap-4", wide && "md:my-auto")}>
              <div className="flex items-center justify-between gap-3">
                <D.Title className={cn("font-semibold text-ink", wide ? "text-2xl tracking-tight" : "text-xl")}>{title}</D.Title>
                <D.Close aria-label="Close" className="grid size-7 place-items-center rounded-control text-muted hover:bg-paper-4 hover:text-ink"><Icon.x className="size-4" /></D.Close>
              </div>
              {children}
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
