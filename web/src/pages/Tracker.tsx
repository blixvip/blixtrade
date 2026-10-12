// Wallet tracker (#/tracker): your own list of wallets and what they do as it happens (server/wtrack.js). The
// same tracker opens as a floating window over any page (components/WalletTracker.tsx TrackerWindow).
import { Page } from "@/components/page";
import { Button } from "@/components/ui/button";
import { WalletTracker } from "@/components/WalletTracker";
import { openTrackerWindow, useTracker } from "@/lib/wtrack";
import { Icon } from "@/shell/icons";

export function Tracker() {
  const float = useTracker((s) => s.float);
  return (
    <Page title="Wallet tracker" right={
      <Button size="lg" onClick={openTrackerWindow} disabled={float} title="Keep the tracker over every page"><Icon.boxes className="size-3.5" />{float ? "Window open" : "Open as window"}</Button>
    }>
      <section className="flex min-h-[70dvh] min-w-0 flex-col overflow-hidden rounded-card border border-rule bg-paper-2">
        <WalletTracker />
      </section>
    </Page>
  );
}
