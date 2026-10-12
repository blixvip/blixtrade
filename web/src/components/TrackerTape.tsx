// The tracker tape (Axiom's top ticker): a strip under the top bar that shows what the wallets you track just did,
// newest on the left, as it happens. Each chip: the wallet's mark and name, bought or sold, the coin, the size.
// Fed by the same pushes as the tracker (lib/pulse.ts onTracker) with the polled feed catching up on any gap. Shown
// only to a signed-in member with tracked wallets that have traded; a visitor or an empty list gets nothing.
// A buy by a wallet whose alerts are on also raises a quiet toast, at most one every few seconds.
import { useEffect, useMemo, useRef, useState } from "react";
import { SolanaLogo } from "@/components/brand";
import { CoinImg } from "@/components/page";
import { toast } from "@/components/ui/toast";
import { Tip } from "@/components/ui/tooltip";
import { post } from "@/lib/api";
import { solNum, usePoll } from "@/lib/coin";
import { ageStr, shortAddr } from "@/lib/format";
import { onTracker } from "@/lib/pulse";
import { useRole, useRoleKnown } from "@/lib/role";
import { useNow } from "@/lib/route";
import { trade } from "@/lib/trade";
import { cn } from "@/lib/utils";
import { COLOR_HEX, nameStyle, openTrackerWindow, useTracker, type Overview, type TTrade } from "@/lib/wtrack";
import { Icon } from "@/shell/icons";

const KEEP = 24;
const sizeOf = (r: TTrade) => (r.sol != null ? `${solNum(r.sol)}` : r.usd != null ? `$${Math.round(r.usd)}` : "");

function Chip({ r, fresh }: { r: TTrade; fresh: boolean }) {
  const now = useNow();
  const sol = useTracker((s) => s.sol);
  const [busy, setBusy] = useState(false);
  const buy = r.side === "buy";
  const hex = (r.color && COLOR_HEX[r.color]) || "oklch(40% 0.01 255)";
  const quick = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setBusy(true);
    await trade({ side: "buy", mint: r.mint, symbol: r.symbol || "", sol }, () => post("paper/quoted", { mint: r.mint, sol }));
    setBusy(false);
  };
  return (
    <a href={`#/coin/${r.mint}`} title={`${r.name} ${buy ? "bought" : "sold"} ${r.symbol ? `$${r.symbol}` : shortAddr(r.mint)}${r.sol != null ? ` for ${solNum(r.sol)} SOL` : ""} · ${new Date(r.t).toLocaleTimeString()}`}
      className={cn("group flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-1.5 pr-2 text-sm whitespace-nowrap transition-colors hover:border-muted",
        buy ? "border-up/30 bg-up/8" : "border-down/30 bg-down/8", fresh && "animate-[tape-in_400ms_var(--ease-out)]")}>
      <span className="grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-black select-none" style={{ background: r.emoji ? "transparent" : hex }} aria-hidden>
        {r.emoji || r.name.replace(/^[@$]/, "").charAt(0).toUpperCase()}
      </span>
      <b className="max-w-[9rem] truncate font-semibold" style={nameStyle(r.color)}>{r.name}</b>
      <span className={cn("num text-xs font-bold", buy ? "text-up" : "text-down")}>{buy ? "B" : "S"}</span>
      <span className="relative size-4 shrink-0 overflow-hidden rounded-full bg-paper-4"><CoinImg mint={r.mint} /></span>
      <b className="font-semibold text-ink">${r.symbol || shortAddr(r.mint)}</b>
      {sizeOf(r) && <span className="num flex items-center gap-0.5 text-ink-2">{sizeOf(r)}{r.sol != null && <SolanaLogo className="w-2" />}</span>}
      <span className="num text-xs text-muted">{ageStr(Math.max(0, now - r.t))}</span>
      <button onClick={quick} disabled={busy} aria-label={`Buy ${sol} SOL of ${r.symbol || "this coin"}`} className="chrome-fill hidden h-4.5 items-center gap-0.5 rounded-full px-1.5 text-2xs font-semibold group-hover:inline-flex disabled:opacity-60">
        <Icon.bolt className="size-2.5" />{sol}
      </button>
    </a>
  );
}

export function TrackerTape() {
  const role = useRole(), known = useRoleKnown();
  const path = known && role !== "visitor" ? `wtrack?limit=${KEEP}` : null;
  const { data } = usePoll<Overview>(path, 30_000, true);
  const [live, setLive] = useState<TTrade[]>([]);
  const [freshId, setFreshId] = useState<number | null>(null);
  const alerts = useRef<Map<string, boolean>>(new Map());
  const lastToast = useRef(0);
  useEffect(() => { alerts.current = new Map((data?.wallets || []).map((w) => [w.address, Boolean(w.alerts)])); }, [data]);
  useEffect(() => onTracker((kind, row) => {
    if (kind !== "trade") return;
    const r = row as TTrade;
    setLive((l) => (l.some((x) => x.id === r.id) ? l : [r, ...l].slice(0, KEEP)));
    setFreshId(r.id);
    if (r.side === "buy" && alerts.current.get(r.wallet) !== false && Date.now() - lastToast.current > 4000) {
      lastToast.current = Date.now();
      toast(`${r.name} bought $${r.symbol || shortAddr(r.mint)}${r.sol != null ? ` · ${solNum(r.sol)} SOL` : ""}`);
    }
  }), []);
  const rows = useMemo(() => {
    const by = new Map<number, TTrade>();
    for (const r of [...live, ...(data?.feed || [])]) if (!by.has(r.id)) by.set(r.id, r);
    return [...by.values()].sort((a, b) => b.id - a.id).slice(0, KEEP);
  }, [live, data]);
  if (!path || !data?.wallets?.length || !rows.length) return null;
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-rule bg-paper-2/70 px-3 max-md:px-2">
      <Tip tip="Open the wallet tracker">
        <button onClick={openTrackerWindow} aria-label="Open the wallet tracker" className="flex shrink-0 items-center gap-1 text-muted hover:text-ink">
          <Icon.wallets className="size-3.5" /><span className="text-2xs font-semibold tracking-[0.045em] uppercase max-sm:hidden">Tracker</span>
        </button>
      </Tip>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]">
        {rows.map((r) => <Chip key={r.id} r={r} fresh={r.id === freshId} />)}
      </div>
    </div>
  );
}
