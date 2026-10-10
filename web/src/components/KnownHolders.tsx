import { useKnownHolder, SOL_NETWORK, type Face } from "@/lib/known";
import { SiteLogo } from "@/components/logos";
import { thumb } from "@/lib/thumb";
import { Tip } from "@/components/ui/tooltip";
import { Icon } from "@/shell/icons";
import { FomoEyes } from "@/pages/traders/parts";

// `total`: the coin's holder count. With no known holder to show, the row shows that instead of a bare 0.
export function KnownHolders({ mint, network = SOL_NETWORK, total }: { mint: string; network?: number; total?: number | null }) {
  const known = useKnownHolder(mint, network);
  const count = known?.[0], shown = known?.[1].slice(0, 3) || [];
  if (!shown.length && total != null) return (
    <Tip tip={`${total.toLocaleString()} holder${total === 1 ? "" : "s"}${count === 0 ? " · no known Fomo traders yet" : ""}`}>
      <span role="img" aria-label={`${total.toLocaleString()} holders`} tabIndex={0} className="inline-flex h-6 shrink-0 items-center gap-1 align-middle text-muted outline-offset-2">
        <Icon.user className="size-3.5" /><span aria-hidden="true" className="num text-xs font-medium whitespace-nowrap text-ink-2">{total.toLocaleString()}</span>
      </span>
    </Tip>
  );
  const more = Math.max(0, (count || 0) - shown.length);
  const label = count == null ? "Known holders unavailable" : `${count.toLocaleString()} known holder${count === 1 ? "" : "s"}`;
  const names = shown.map(([name]) => name ? `@${name.replace(/^@/, "")}` : "Unnamed account").join(", ");
  const tip = count == null ? "Known holders · waiting for a Fomo reading" : <HoldersCard count={count} shown={shown} more={more} />;
  return (
    <Tip tip={tip}>
      <span data-known-holders={mint} role="img" aria-label={`${label}${names ? `: ${names}${more ? ` and ${more} more` : ""}` : ""}`} tabIndex={0}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full align-middle text-muted outline-offset-2">
        {shown.length ? <span className="flex -space-x-1.5" aria-hidden="true">
          {shown.map(([name, pic], i) => <span key={`${name}:${i}`} className="relative grid size-6 shrink-0 place-items-center overflow-hidden rounded-full border-2 border-paper-2 bg-paper-4 text-[9px] font-semibold text-ink-2 uppercase">
            <FomoEyes id={name} />
            {pic && <img key={pic} src={thumb(pic, 24)} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" onError={e => { e.currentTarget.style.display = "none"; }} />}
          </span>)}
        </span> : <Icon.users className="size-3.5" />}
        {(more > 0 || !shown.length) && <span aria-hidden="true" className="num text-xs font-medium whitespace-nowrap text-ink-2">{more > 0 ? `+${more.toLocaleString()}` : count == null ? "—" : "0"}</span>}
      </span>
    </Tip>
  );
}

const usd = (n: number) => `$${n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : n.toFixed(0)}`;

// The hover card: who on Fomo holds the coin, biggest position first, with what each holds.
function HoldersCard({ count, shown, more }: { count: number; shown: Face[]; more: number }) {
  return (
    <div className="flex w-56 flex-col gap-2 py-0.5">
      <div className="flex items-center gap-1.5">
        <SiteLogo site="fomo" className="size-3.5" />
        <span className="font-semibold text-ink">Known holders on Fomo</span>
        <span className="num ml-auto rounded-full bg-paper-3 px-1.5 py-px text-2xs font-semibold text-ink-2">{count.toLocaleString()}</span>
      </div>
      {shown.length ? (
        <div className="flex flex-col gap-1.5">
          {shown.map(([name, pic, value], i) => (
            <div key={`${name}:${i}`} className="flex items-center gap-2">
              <span className="relative grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-paper-3 text-[9px] font-semibold text-ink-2 uppercase">
                <FomoEyes id={name} />
                {pic && <img src={thumb(pic, 24)} alt="" className="absolute inset-0 size-full object-cover" onError={e => { e.currentTarget.style.display = "none"; }} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name ? `@${name.replace(/^@/, "")}` : "Unnamed account"}</span>
              {value != null && <span className="num shrink-0 text-sm font-semibold text-ink-2">{usd(value)}</span>}
            </div>
          ))}
        </div>
      ) : <p className="text-muted">No known Fomo traders hold it yet.</p>}
      {more > 0 && <p className="border-t border-rule-2 pt-1.5 text-muted">+{more.toLocaleString()} more holding it</p>}
    </div>
  );
}
