// The first-run tour: three picture cards shown once, right after a new account's wallet is made (pages/Account.tsx
// calls openWelcome): catching coins at launch, the AI reads, and claiming a blixvip.com/@<handle> invite link. Next
// walks through them, Skip or Escape closes, the last card's button opens the deposit window on the wallet page.
// The arrow keys move between cards. ?welcome on the address shows it again (for checking the copy).
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import * as D from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { openExchange, useWelcome } from "@/lib/modals";
import { cn } from "@/lib/utils";
import { HandleStatus, handleBorder, useHandleCheck } from "@/components/ShareLink";

interface Handle { handle: string | null; link: string | null; suggestion: string | null }

// The AIs behind AI picks, each with its own mark (public/brand/ai, from Lobe Icons): Blix's own first.
const MODELS: [name: string, logo: string][] = [["Blix AI", "brand/blix-eye.webp"], ["Claude", "brand/ai/claude.svg"], ["Grok", "brand/ai/grok.svg"],
  ["ChatGPT", "brand/ai/openai.svg"], ["DeepSeek", "brand/ai/deepseek.svg"], ["Gemini", "brand/ai/gemini.svg"]];

// Card three: claim a handle (server/handles.js, the same call as the Invite & earn card), then copy or share it.
function ClaimHandle() {
  const [h, setH] = useState<Handle | null>(null), [value, setValue] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);   // the pencil: change a handle already claimed
  const check = useHandleCheck(value, h?.handle ?? null);
  useEffect(() => {
    fetch("api/account/handle", { signal: AbortSignal.timeout(20_000) }).then((r) => (r.ok ? r.json() : null)).then((r: Handle | null) => {
      if (r) { setH(r); setValue(r.handle || r.suggestion || ""); }
    }).catch(() => {});
  }, []);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await fetch("api/account/handle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle: value }), signal: AbortSignal.timeout(30_000) });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) throw new Error(j.error || String(r.status));
      setH(j); setEditing(false);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const link = h?.handle ? h.link || `https://blixvip.com/@${h.handle}` : null;
  const copy = () => { if (link) navigator.clipboard.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }, () => toast("Couldn't copy the link")); };
  const share = () => {
    if (!link) return;
    const text = "Trading Solana memecoins on BLIX. Sign up with my link and pay less in fees";
    if (navigator.share) navigator.share({ title: "BLIX", text, url: link }).catch(() => {});
    else window.open(`https://x.com/intent/post?${new URLSearchParams({ text, url: link })}`, "_blank", "noopener");
  };
  if (link && !editing) return (
    <div className="flex items-center gap-1.5 rounded-xl border border-up/25 bg-paper py-1.5 pr-1.5 pl-3.5">
      <span className="flex min-w-0 flex-1 items-center text-md font-semibold text-ink">
        <img src="brand/blix-eye.webp" alt="" className="mr-2 size-5 shrink-0 rounded-full" /><span className="truncate"><span className="text-muted">blixvip.com/@</span>{h!.handle}</span>
        <button type="button" onClick={() => { setValue(h!.handle || ""); setError(""); setEditing(true); }} aria-label="Change your handle" title="Change your handle"
          className="ml-1.5 grid size-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-paper-4 hover:text-ink">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        </button>
      </span>
      <button onClick={copy} className={cn("h-8 min-w-[68px] rounded-full px-3.5 text-sm font-semibold transition-colors", copied ? "bg-up text-on-fill" : "bg-paper-4 text-ink hover:bg-paper-3")}>{copied ? "Copied" : "Copy"}</button>
      <button onClick={share} className="h-8 rounded-full bg-ink px-3.5 text-sm font-semibold text-on-fill hover:bg-focus">Share</button>
    </div>
  );
  return (
    <form onSubmit={save} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label className={cn("flex h-10 min-w-0 flex-1 items-center rounded-xl border bg-paper px-3.5 text-md transition-colors", handleBorder(check))}>
          <img src="brand/blix-eye.webp" alt="" className="mr-2 size-5 shrink-0 rounded-full" /><span className="text-muted">blixvip.com/@</span>
          <input value={value} onChange={(e) => { setValue(e.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20)); setError(""); }} aria-label="Handle" placeholder="yourname" autoComplete="off" spellCheck={false}
            className="min-w-0 flex-1 bg-transparent font-semibold text-ink outline-none" />
        </label>
        {editing && <button type="button" onClick={() => { setEditing(false); setValue(h?.handle || ""); setError(""); }} className="h-10 rounded-full px-3.5 text-md text-ink-2 hover:bg-paper-4 hover:text-ink">Cancel</button>}
        <button type="submit" disabled={busy || value.length < 3 || check.state === "taken" || (editing && value === h?.handle)} className="h-10 rounded-full bg-ink px-5 text-md font-semibold text-on-fill hover:bg-focus disabled:opacity-50">{busy ? "Saving…" : editing ? "Save" : "Claim"}</button>
      </div>
      <HandleStatus check={check} value={value} error={error} />
    </form>
  );
}

interface Card { pic: string; zoom?: number; alt: string; title: string; body: ReactNode; extra?: ReactNode }

const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-ink">{children}</b>;

export function Welcome() {
  const [i, setI] = useState(0);
  const close = () => useWelcome.setState({ open: false });
  const cards: Card[] = [
    { pic: "brand/welcome-1.webp", zoom: 1.15, alt: "The Blix coin", title: "Catch coins the second they launch",
      body: <><B>Pulse</B> shows every new coin live the moment it's made, and <B>Discover</B> ranks what's moving right now. Open any coin for its chart, holders and trades, and buy in one tap.</> },
    { pic: "brand/welcome-2c.webp", zoom: 1.3, alt: "Blix AI and the AIs it works with", title: "AI reads every coin for you",
      body: <><B>AI picks</B> runs every coin past <B>Blix AI</B>, our own model, and the best models out there, then calls buy, watch or avoid.</>,
      extra: (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-1.5">
            {MODELS.map(([m, logo], n) => (
              <span key={m} className={cn("flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-full border px-2 text-sm font-semibold",
                n === 0 ? "border-[oklch(62%_0.19_258)]/50 bg-[oklch(62%_0.19_258)]/15 text-ink" : "border-rule-2 bg-paper-3 text-ink-2")}>
                <img src={logo} alt="" className={cn("size-4 shrink-0", n === 0 && "rounded-full")} /><span className="truncate">{m}</span>
              </span>
            ))}
          </div>
        </div>
      ) },
    { pic: "brand/welcome-3.webp", alt: "Coins from every launchpad", title: "Claim your handle",
      body: <>Your own page at blixvip.com/<B>@yourname</B>. Friends who join through it pay less in fees, and you earn on every trade they make.</>,
      extra: <ClaimHandle /> },
  ];
  const last = i === cards.length - 1;
  const next = () => {
    if (!last) return setI(i + 1);
    close(); location.hash = "#/account"; openExchange("deposit");
  };
  return (
    <D.Root open onOpenChange={(o) => { if (!o) close(); }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px]" />
        <D.Content aria-describedby={undefined}
          onKeyDown={(e) => { if ((e.target as HTMLElement).tagName === "INPUT") return; if (e.key === "ArrowRight") next(); else if (e.key === "ArrowLeft" && i > 0) setI(i - 1); }}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-1.5rem)] w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[20px] border border-white/[0.08] bg-paper-2 shadow-[0_40px_100px_-30px_oklch(0%_0_0/0.85),inset_0_1px_0_oklch(100%_0_0/0.05)]">
          <div className="relative aspect-[3/2] shrink-0 overflow-hidden border-b border-rule bg-paper-3">
            {cards.map((x, n) => (
              <img key={x.pic} src={x.pic} alt={n === i ? x.alt : ""} aria-hidden={n !== i} decoding="async"
                style={{ transform: x.zoom ? `scale(${x.zoom})` : undefined }}
                className={cn("absolute inset-0 size-full origin-[50%_40%] object-cover object-[50%_35%] transition-opacity duration-300", n === i ? "opacity-100" : "opacity-0")} />
            ))}
            <i aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-paper-2/70 to-transparent" />
            <D.Close className="absolute top-2.5 right-3 rounded-full bg-black/45 px-3 py-1 text-sm text-white/85 backdrop-blur-sm transition-colors hover:bg-black/65 hover:text-white">Skip</D.Close>
          </div>
          {/* Every card's text sits in the same grid cell, the others hidden, so all three cards are the height of the tallest. */}
          <div className="grid grid-cols-[minmax(0,1fr)]">
            {cards.map((x, n) => (
              <div key={n} aria-hidden={n !== i} inert={n !== i}
                className={cn("flex flex-col gap-3 px-6 pt-5 pb-2 [grid-area:1/1] max-sm:px-5", n === i ? "motion-safe:animate-[welcome-in_220ms_ease-out]" : "invisible")}>
                {n === i ? <D.Title className="text-2xl leading-tight font-semibold tracking-tight text-ink">{x.title}</D.Title> : <h2 className="text-2xl leading-tight font-semibold tracking-tight">{x.title}</h2>}
                <p className="text-md leading-relaxed text-ink-2">{x.body}</p>
                {x.extra}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 px-6 pt-3 pb-5 max-sm:px-5">
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Tour steps">
              {cards.map((x, n) => (
                <button key={n} role="tab" aria-selected={n === i} aria-label={`Step ${n + 1}: ${x.title}`} onClick={() => setI(n)}
                  className={cn("h-1.5 rounded-full transition-[width,background-color] duration-200", n === i ? "w-5 bg-ink" : "w-1.5 bg-rule-2 hover:bg-muted")} />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {i > 0 && <button onClick={() => setI(i - 1)} className="h-9 rounded-full px-4 text-md text-ink-2 transition-colors hover:bg-paper-4 hover:text-ink">Back</button>}
              <button onClick={next} className="h-9 rounded-full bg-ink px-5 text-md font-semibold text-on-fill outline-none transition-transform duration-100 hover:bg-focus focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-paper-2 active:scale-[0.97]">{last ? "Deposit SOL" : "Next"}</button>
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
