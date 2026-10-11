// The real marks of what Blix shows and runs on: Solana's logomark next to SOL amounts, pump.fun's pill on
// pump.fun coins, and Jev and Grok (the AIs behind the reads) under the wordmark. Official artwork, served
// from public/brand; never redrawn.
import { cn } from "@/lib/utils";

// SOL. Sized by the caller (className), like the line icons it sits beside; colour classes do not apply.
export function SolanaLogo({ className }: { className?: string }) {
  return <img src="brand/solana.svg" alt="SOL" draggable={false} className={cn("inline-block aspect-[397.7/311.7] h-auto w-[1em] shrink-0 object-contain select-none", className)} />;
}

// pump.fun's pill (their own vector, pump.fun/pump-logomark.svg).
export function PumpLogo({ className }: { className?: string }) {
  return <img src="brand/pumpfun.svg" alt="pump.fun" draggable={false} className={cn("inline-block size-[1em] shrink-0 object-contain select-none", className)} />;
}

// xAI's Grok mark, white on a black disc. Sized by the caller.
function GrokMark({ className }: { className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full bg-black shadow-[0_0_0_1px_oklch(100%_0_0/0.18)]", className)}>
      <svg viewBox="0 0 24 24" aria-hidden className="size-[64.3%] fill-white">
        <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
      </svg>
    </span>
  );
}

// "Powered by Jev · Grok" under the wordmark: a small glass strip, the label on a line of its own with a hairline
// running out from it, the two marks under it as equal chips that come in one after the other. A glint travels the
// strip's top edge now and then; a chip lights up in its own colour under the pointer.
export function PoweredBy() {
  // One quiet line under the logo: the label, then each partner's mark and name. No box, no animation.
  const chip = "flex items-center gap-1 font-semibold text-ink-2";
  return (
    <div aria-label="Powered by Jev and Grok" className="mx-1.5 mb-4 flex items-center gap-2 text-[11px] whitespace-nowrap">
      <span className="text-muted">Powered by</span>
      <span className={chip}><img src="brand/jev.png" alt="" width={14} height={14} className="size-3.5 shrink-0 rounded-full" />Jev</span>
      <span aria-hidden className="size-0.5 rounded-full bg-muted/60" />
      <span className={chip}><GrokMark className="size-3.5 shrink-0" />Grok</span>
    </div>
  );
}
