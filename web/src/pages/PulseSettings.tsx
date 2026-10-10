import { lazy, Suspense, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { filterCount, usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

// The Pulse settings window: size, what a row shows, which columns are open, and filters. Every change
// applies at once and is remembered in this browser.
// What is inside it (pulse/SettingsPanel.tsx) loads when it first opens, not with the Pulse.
const SettingsPanel = lazy(() => import("./pulse/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));

// One look for every Pulse toolbar control: same height, radius and surface as the Display switch beside them.
export const CTL = "flex h-8 shrink-0 items-center rounded-lg bg-paper-3/60 text-sm font-medium ring-1 ring-rule ring-inset transition-colors duration-150 hover:bg-paper-4 hover:text-ink";

export function PulseSettings() {
  const [open, setOpen] = useState(false);
  const p = usePrefs(), n = filterCount(p);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Pulse settings" className={cn(CTL, "gap-1.5 px-3 text-ink-2 max-md:px-2.5")}>
        <Icon.settings className="size-4" /><span className="max-md:sr-only">Settings</span>
        {n > 0 && <em className="num grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-2xs font-bold text-on-fill not-italic">{n}</em>}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Pulse settings" large>
        <Suspense fallback={null}><SettingsPanel onDone={() => setOpen(false)} /></Suspense>
      </Dialog>
    </>
  );
}
