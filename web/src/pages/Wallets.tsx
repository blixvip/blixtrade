// Top wallets (#/traders, #/devs): one place for the two leaderboards, a tab each. Top traders is the merged
// Fomo + pump.fun PnL board (pages/Traders.tsx); Top devs is the wallets behind the window's best coins (pages/Devs.tsx).
// The address names the tab (#/traders, #/devs), so each is its own page to link to, with one rail entry.
import { Devs } from "./Devs";
import { Traders } from "./Traders";
import { useRoute } from "@/lib/route";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

const TABS: [string, string, string][] = [["traders", "Top traders", "The traders making the most, from Fomo's and pump.fun's boards"], ["devs", "Top devs", "The wallets behind the best coins, by the fees their coins earned"]];

export function Wallets() {
  const route = useRoute();
  const tab = route === "devs" ? "devs" : "traders";
  return (
    <div className="flex min-h-full flex-col">
      <div role="tablist" aria-label="Top wallets" className="flex items-center gap-1 border-b border-rule px-3 pt-2">
        <span className="mr-2 flex items-center gap-1.5 pb-2 text-sm font-semibold text-muted"><Icon.wallets className="size-4" />Top wallets</span>
        {TABS.map(([k, label, tip]) => (
          <a key={k} role="tab" aria-selected={tab === k} href={`#/${k}`} title={tip}
            className={cn("-mb-px rounded-t-lg border-b-2 px-3 pb-2 pt-1 text-sm font-semibold transition-colors", tab === k ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink-2")}>{label}</a>
        ))}
      </div>
      {tab === "devs" ? <Devs /> : <Traders />}
    </div>
  );
}
