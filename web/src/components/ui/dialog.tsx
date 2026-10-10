import * as D from "@/components/ui/modal";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

// A small window over the page for one task (deposit, withdraw, buy). Escape or a click outside closes it.
// `wide` makes it a large window; `aside` (a picture) then fills its left side, or its top on a phone.
// Overlay and window stay at z-40/50, under the transaction toasts (z-60).
// `large`: a roomy window for settings (wider, more padding), without the picture side of `wide`.
// `flush`: a title bar ruled off from the body, and no padding: the children lay out their own sections (Exchange).
export function Dialog({ open, onOpenChange, title, children, wide, aside, large, flush }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; wide?: boolean; aside?: ReactNode; large?: boolean; flush?: boolean }) {
  if (flush) return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <D.Content aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-1.5rem)] w-[min(32.5rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[8px] border border-rule-2 bg-paper-2 shadow-sheet">
          <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-rule-2 pr-4 pl-6 max-sm:pl-4">
            <D.Title className="text-xl font-semibold text-ink">{title}</D.Title>
            <D.Close aria-label="Close" className="grid size-8 place-items-center rounded-full text-ink-2 transition-colors hover:bg-white/[0.08] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"><Icon.close className="size-4.5" /></D.Close>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={cn("fixed inset-0 z-40 bg-black/60", wide && "bg-black/70 backdrop-blur-[2px]")} />
        <D.Content aria-describedby={undefined}
          className={cn("fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 rounded-card border border-rule-2 bg-paper-2 shadow-sheet",
            wide ? "max-h-[calc(100dvh-1.5rem)] w-[min(60rem,calc(100vw-1.5rem))] overflow-hidden rounded-[16px] max-md:flex-col md:min-h-[min(560px,calc(100dvh-1.5rem))]"
              : large ? "max-h-[calc(100dvh-1.5rem)] w-[min(56rem,calc(100vw-1.5rem))] flex-col rounded-[20px] border-white/[0.08] p-6 shadow-[0_40px_100px_-30px_oklch(0%_0_0/0.85),inset_0_1px_0_oklch(100%_0_0/0.05)] max-md:p-4"
              : "w-[min(26rem,calc(100vw-1.5rem))] flex-col p-5")}>
          {wide && aside && <div className="relative shrink-0 overflow-hidden max-md:h-44 md:w-[44%]">{aside}</div>}
          <div className={cn("flex min-w-0 flex-1 flex-col", wide && "overflow-y-auto p-7 max-md:p-5")}>
            {/* my-auto: short content sits in the middle of a tall window, long content still scrolls from its top */}
            <div className={cn("flex flex-col gap-4", wide && "md:my-auto")}>
              <div className="flex items-center justify-between gap-3">
                <D.Title className={cn("font-semibold text-ink", wide || large ? "text-2xl tracking-tight" : "text-xl")}>{title}</D.Title>
                <D.Close aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-white/[0.08] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25"><Icon.close className="size-4" /></D.Close>
              </div>
              {children}
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
