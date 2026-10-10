// Health: the reading page for what is working.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ago, CoinCell, Empty, Kpis, Loading, Markdown, mult, Page, Panel, Problem, Scroll, share, Tag, td, tdR, th, thR, toneX } from "@/components/page";
import { post } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { providerOf } from "@/lib/format";
import { cn } from "@/lib/utils";

type J = any;

// ---------- Health (#/health) ----------
const STATE: Record<string, ["up" | "down" | "warn" | "ink", string]> = { ok: ["up", "Working"], degraded: ["warn", "Degraded"], down: ["down", "Down"], off: ["ink", "Off"], idle: ["ink", "Idle"] };
export function Health() {
  const { data: h, error } = usePoll<J>("health", 10_000);
  if (!h) return <Page title="Health">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const rank = (s: string) => ({ down: 0, degraded: 1, ok: 2 } as Record<string, number>)[s] ?? 3;
  return (
    <Page title="Health" sub={h.startedAt ? `Everything the radar depends on. Running ${ago(h.startedAt).replace(" ago", "")}.` : "Everything the radar depends on."} right={<Tag tone={h.issues ? "warn" : "up"}>{h.issues ? `${h.issues} issue${h.issues > 1 ? "s" : ""}` : "No issues"}</Tag>}>
      <Panel>
        {[...(h.parts || [])].sort((a: J, b: J) => rank(a.state) - rank(b.state)).map((p: J) => {
          const [tone, label] = STATE[p.state] || ["ink", p.state];
          return (
            <div key={p.key} className="flex flex-wrap items-start gap-x-4 gap-y-1 border-t border-rule px-4 py-3 first:border-t-0">
              <span className="w-24 shrink-0"><Tag tone={tone}>{label}</Tag></span>
              <div className="min-w-0 flex-1 basis-80"><b className="font-semibold">{p.name}</b><p className="text-md text-ink-2">{p.summary}</p>
                {typeof p.pct === "number" && <span className="mt-1.5 block h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-rule" title={`${p.pct}% used`}><i className={cn("block h-full rounded-full", p.pct >= 100 ? "bg-down" : p.pct >= 80 ? "bg-warn" : "bg-up")} style={{ width: `${Math.min(100, Math.max(0, p.pct))}%` }} /></span>}{p.fix && p.state !== "ok" && <p className="mt-1 text-md text-ink"><b className="font-semibold">What to do:</b> {p.fix}</p>}</div>
              <div className="num flex shrink-0 flex-col items-end text-sm text-muted">{p.lastOk && <span>last success {ago(p.lastOk)}</span>}{p.lastFail && <span>last failure {ago(p.lastFail)}</span>}</div>
            </div>);
        })}
      </Panel>
      {/* A member's or visitor's report has no event log (server/access.js visitorHealth): the panel is the owner's. */}
      {Array.isArray(h.events) && <Panel title="Recent problems and events" aside="newest first">
        {h.events.length ? h.events.map((e: J) => (
          <div key={e.id} className="flex items-start gap-3 border-t border-rule px-4 py-2.5 text-md first:border-t-0">
            <i className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", e.kind === "error" ? "bg-down" : "bg-ink-2")} /><span className="min-w-0 flex-1 text-ink-2">{e.text}</span><span className="num shrink-0 text-sm text-muted">{ago(e.t)}</span>
          </div>)) : <Empty>Nothing logged.</Empty>}
      </Panel>}
    </Page>
  );
}
