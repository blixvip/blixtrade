import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { Icon } from "@/shell/icons";

// A small window over the page for one task (deposit, withdraw, buy). Escape or a click outside closes it.
export function Dialog({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <D.Content aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-card border border-rule-2 bg-paper-2 p-5 shadow-sheet">
          <div className="flex items-center justify-between gap-3">
            <D.Title className="text-xl font-semibold text-ink">{title}</D.Title>
            <D.Close aria-label="Close" className="grid size-7 place-items-center rounded-control text-muted hover:bg-paper-4 hover:text-ink"><Icon.x className="size-4" /></D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
