// Quick launch: a small window from the status bar's Launch button, on any page, to put a coin on pump.fun in a few
// seconds. Picture (drop, paste or pick; cropped to the middle square), name, ticker (filled from the name until
// edited), an optional line and X link, the first buy, and the …pump address ending. Same launch as the Create page
// (POST api/account/launch: the Blix Vault signs it), real SOL always, so it asks once more before it sends. Clone a
// coin by pasting its contract address into the name. Drag it by its title bar; the draft is kept in this browser.
// The full Create page (plans, custom endings) is one click away. Edit opens the same photo editor window as the
// Create page (pages/launch/ForgeWindow.tsx, forge/): the picture goes in, "Use as coin picture" sends the art back.
import { useEffect, useRef, useState, type PointerEvent as PE } from "react";
import { ForgeWindow } from "@/pages/launch/ForgeWindow";
import { PumpLogo, SolanaLogo } from "@/components/brand";
import { toast, txToast } from "@/components/ui/toast";
import { closeQuickLaunch, useQuickLaunch } from "@/lib/quicklaunch";
import { shortAddr } from "@/lib/format";
import { loadMe, useMe } from "@/lib/ui";
import { cn, store } from "@/lib/utils";
import { Icon } from "@/shell/icons";

const RENT_SOL = 0.0055, FEE_SOL = 0.0001, BUY_ATA_SOL = 0.00204, BUY_VAULT_SOL = 0.00089, TRADE_FEE_PCT = 1.5, MAX_BYTES = 4_000_000;
const BUYS = [0, 0.1, 0.25, 0.5, 1];
const EASE = "cubic-bezier(.22,.9,.24,1)";
type Draft = { name: string; symbol: string; symbolEdited: boolean; description: string; twitter: string; sol: number; pump: boolean };
const EMPTY: Draft = { name: "", symbol: "", symbolEdited: false, description: "", twitter: "", sol: 0, pump: true };
const KEY = "ql:draft", PIC = "ql:pic", AT = "ql:at";
type Done = { mint: string; signature: string | null; symbol: string; name: string; image: string };

const tickerOf = (name: string) => {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const one = words.join("");
  return (one.length <= 8 ? one : words.length > 1 ? words.map((w) => w[0]).join("") : one.slice(0, 8)).toUpperCase().slice(0, 10);
};
const asUrl = (b: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(b); });
// The middle square, at most 1000 px, as WebP (what pump.fun and every terminal show anyway).
async function squarePicture(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const side = Math.min(bmp.width, bmp.height), out = Math.min(side, 1000);
  const c = document.createElement("canvas"); c.width = c.height = out;
  c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/webp", 0.92));
  if (!b) throw new Error("That picture could not be read.");
  return asUrl(b);
}

export function QuickLaunch() {
  const open = useQuickLaunch((s) => s.open);
  const me = useMe((s) => s.me);
  const [d, setD] = useState<Draft>(() => ({ ...EMPTY, ...store.get<Partial<Draft>>(KEY, {}) }));
  const [image, setImage] = useState<string | null>(() => { try { return sessionStorage.getItem(`blix:${PIC}`); } catch { return null; } });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [hot, setHot] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(() => store.get(AT, null));
  const [shown, setShown] = useState(false);
  const file = useRef<HTMLInputElement>(null), box = useRef<HTMLDivElement>(null), drag = useRef<{ dx: number; dy: number } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // The editor window: mounted on first Edit (or on hovering it), then only hidden, so the work survives.
  // forge-ready / forge-load / forge-picture: forge/js/ui.js, the end.
  const [forge, setForge] = useState<"closed" | "open" | "hidden">("closed");
  const [forgeUp, setForgeUp] = useState(false);
  const [forgeFrom, setForgeFrom] = useState<{ x: number; y: number } | null>(null);
  const forgeFrame = useRef<HTMLIFrameElement>(null), forgeReady = useRef(false), sentToForge = useRef<string | null>(null);
  const imageNow = useRef<string | null>(null), nameNow = useRef(""), fromForge = useRef(false);
  imageNow.current = image; nameNow.current = d.name;
  // The art that just came back counts as already in the editor: reopening must not add it again as a layer.
  useEffect(() => { if (fromForge.current && image) { sentToForge.current = image; fromForge.current = false; } }, [image]);
  const sendToForge = () => {
    const w = forgeFrame.current?.contentWindow, url = imageNow.current;
    if (!w || !forgeReady.current || !url || url === sentToForge.current) return;
    sentToForge.current = url;
    w.postMessage({ type: "forge-load", dataUrl: url, name: nameNow.current.trim() || "Coin" }, location.origin);
  };
  const openForge = (from?: Element | null) => {
    const r = from?.getBoundingClientRect();
    if (r) setForgeFrom({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    setForge("open"); if (forgeReady.current) sendToForge();
  };
  const warmForge = () => setForge((f) => (f === "closed" ? "hidden" : f));
  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== forgeFrame.current?.contentWindow || !e.data || typeof e.data.type !== "string") return;
      if (e.data.type === "forge-ready") { forgeReady.current = true; setForgeUp(true); sendToForge(); }
      if (e.data.type === "forge-picture" && typeof e.data.dataUrl === "string") {
        try {
          const b = await (await fetch(e.data.dataUrl)).blob();
          fromForge.current = true;
          await pick(new File([b], "forge.png", { type: b.type || "image/png" }));
          setForge("hidden");
          toast("The art is the coin's picture. Edit again to keep working on it.");
        } catch { toast("The art could not be read."); }
      }
    };
    addEventListener("message", onMsg);
    return () => removeEventListener("message", onMsg);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const editing = forge === "open";
  const forgeOpen = useRef(false); forgeOpen.current = editing;

  useEffect(() => { if (open) { const f = requestAnimationFrame(() => setShown(true)); setTimeout(() => nameRef.current?.focus(), 120); if (!me) loadMe(); return () => cancelAnimationFrame(f); } setShown(false); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy && !editing) closeQuickLaunch(); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [open, busy, editing]);
  const set = (p: Partial<Draft>) => setD((o) => { const n = { ...o, ...p }; store.set(KEY, n); return n; });
  const keepPic = (url: string | null) => { setImage(url); try { if (url) sessionStorage.setItem(`blix:${PIC}`, url); else sessionStorage.removeItem(`blix:${PIC}`); } catch { /* storage full */ } };

  const pick = async (b?: Blob | null) => {
    if (!b) return;
    if (!b.type.startsWith("image/")) return toast("That file is not a picture.");
    try { const url = await squarePicture(b); if (url.length * 0.75 > MAX_BYTES) return toast("That picture is too big."); keepPic(url); } catch (e) { toast((e as Error).message); }
  };
  // A picture pasted while the window is open (and no other field wants it) is the coin's picture.
  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const it = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith("image/"));
      if (!it || forgeOpen.current) return;
      e.preventDefault(); e.stopPropagation(); pick(it.getAsFile());
    };
    addEventListener("paste", onPaste, true);
    return () => removeEventListener("paste", onPaste, true);
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  // A contract address pasted into the name clones that coin (its name, ticker, line, X and picture).
  const clone = async (ca: string) => {
    setBusy("Cloning");
    try {
      const r = await fetch(`api/launch/clone?mint=${ca}`, { signal: AbortSignal.timeout(20_000) });
      const c = await r.json();
      if (!r.ok) throw new Error(c.error || `HTTP ${r.status}`);
      set({ name: (c.name || "").slice(0, 32), symbol: (c.symbol || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10), symbolEdited: true, description: (c.description || "").slice(0, 500), twitter: c.twitter || "" });
      if (c.image) { try { await pick(await (await fetch(c.image)).blob()); } catch { toast("The picture could not be copied; add one."); } }
      toast(`Cloned ${c.symbol ? `$${c.symbol}` : "the coin"}. Change what you like, then launch.`);
    } catch (e) { toast((e as Error).message || "Could not clone that coin"); }
    finally { setBusy(null); }
  };
  const onName = (v: string) => {
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.trim())) { clone(v.trim()); return; }
    set({ name: v.slice(0, 32), ...(d.symbolEdited ? {} : { symbol: tickerOf(v) }) });
  };

  const sym = d.symbol.toUpperCase();
  const buyExtra = d.sol > 0 ? BUY_ATA_SOL + BUY_VAULT_SOL + (d.sol * TRADE_FEE_PCT) / 100 : 0;
  const total = RENT_SOL + FEE_SOL + d.sol + buyExtra;
  const wallet = me?.wallet?.sol ?? null;
  const missing = !image ? "Add a picture" : !d.name.trim() ? "Name it" : !/^[A-Za-z0-9]{1,10}$/.test(sym) ? "Give it a ticker" : null;
  const short = wallet != null && wallet < total + 0.001;

  const launch = async () => {
    setConfirm(false);
    const t = txToast(`Launching $${sym}`, "Uploading the picture to IPFS");
    setBusy("Uploading");
    const step = setTimeout(() => setBusy("Signing and sending"), 2500);
    try {
      const r = await fetch("api/account/launch", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(300_000),
        body: JSON.stringify({ name: d.name.trim(), symbol: sym, description: d.description.trim(), twitter: d.twitter.trim(), telegram: "", website: "", sol: d.sol, image, priorityFeeSol: FEE_SOL, ...(d.sol > 0 ? { slippageBps: 500 } : {}), ...(d.pump ? { suffix: "pump" } : {}) }) });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) throw new Error(r.status === 404 ? "Accounts are not switched on." : j.error || String(r.status));
      t.ok(`$${sym} is live`, shortAddr(j.mint), j.signature ? `https://solscan.io/tx/${j.signature}` : undefined);
      setDone({ mint: j.mint, signature: j.signature || null, symbol: sym, name: d.name.trim(), image: image! });
      set({ ...EMPTY, pump: d.pump, sol: d.sol }); keepPic(null); loadMe();
    } catch (e) { t.fail("Launch failed", (e as Error).message); }
    finally { clearTimeout(step); setBusy(null); }
  };

  // Dragging by the title bar; kept inside the window.
  const down = (e: PE<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button,a,input")) return;
    const r = box.current!.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PE<HTMLDivElement>) => {
    if (!drag.current || !box.current) return;
    const w = box.current.offsetWidth, h = box.current.offsetHeight;
    setAt({ x: Math.min(Math.max(8, e.clientX - drag.current.dx), innerWidth - w - 8), y: Math.min(Math.max(8, e.clientY - drag.current.dy), innerHeight - h - 8) });
  };
  const up = () => { if (drag.current) { drag.current = null; setAt((a) => { store.set(AT, a); return a; }); } };

  const editor = forge !== "closed" && (
    <ForgeWindow shown={editing} onClose={() => setForge("hidden")} frameRef={forgeFrame} ready={forgeUp} origin={forgeFrom}
      hint="Drop or paste a photo, or Find one. Then Use as coin picture and it goes back to Quick launch." />
  );
  if (!open) return editor || null;
  const field = "h-9 w-full min-w-0 rounded-[6px] border border-rule-2 bg-paper px-2.5 text-[14px] text-ink outline-none transition-colors placeholder:text-muted focus:border-ink-2";
  const label = "text-[10px] font-bold tracking-[0.08em] text-muted uppercase";
  const seg = (on: boolean) => cn("num h-8 flex-1 rounded-[4px] text-[12px] font-bold transition-colors duration-100", on ? "bg-paper-5 text-ink" : "text-muted hover:text-ink-2");
  const signedIn = Boolean(me?.signedIn);

  return (<>
    <div ref={box} role="dialog" aria-label="Quick launch"
      style={{ ...(at ? { left: at.x, top: at.y } : { left: 72, bottom: 44 }), transform: shown ? "none" : "translateY(14px) scale(.97)", opacity: shown ? 1 : 0, transformOrigin: "bottom left", transition: `transform 260ms ${EASE}, opacity 180ms ease` }}
      className="fixed z-40 w-[min(380px,calc(100vw-16px))] overflow-hidden rounded-xl border border-rule-2 bg-paper-2 text-ink shadow-[0_24px_60px_-12px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className="flex h-10 cursor-grab touch-none select-none items-center gap-2 border-b border-rule bg-gradient-to-b from-paper-3 to-paper-2 pr-1.5 pl-3 active:cursor-grabbing">
        <span className="grid size-6 place-items-center rounded-md bg-up/15 text-up"><Icon.launch className="size-3.5" /></span>
        <b className="text-[13px] font-semibold">Quick launch</b>
        <span className="flex items-center gap-1 text-[11px] text-muted"><PumpLogo className="size-3" />pump.fun</span>
        <span className="grow" />
        <a href="#/launch" onClick={() => closeQuickLaunch()} title="The full Create page: make the picture in the editor, plans, custom address endings" className="rounded-md px-2 py-1 text-[11px] font-semibold text-muted transition-colors hover:bg-white/[0.06] hover:text-ink">Full page</a>
        <button type="button" onClick={() => !busy && closeQuickLaunch()} aria-label="Close quick launch" className="grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.08] hover:text-ink"><Icon.close className="size-3.5" /></button>
      </div>

      {done ? (
        <div className="flex flex-col items-center gap-3 p-5 text-center motion-safe:animate-fade-in">
          <span className="relative">
            <img src={done.image} alt="" className="size-20 rounded-2xl border border-rule-2 object-cover" />
            <span className="absolute -right-1.5 -bottom-1.5 grid size-7 place-items-center rounded-full bg-up text-[#06130b] ring-4 ring-paper-2"><svg viewBox="0 0 12 12" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2.5 6.3l2.3 2.3 4.7-5" /></svg></span>
          </span>
          <div><b className="block text-lg">${done.symbol} is live</b><span className="text-sm text-muted">{done.name}</span></div>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(done.mint); toast("Contract address copied"); }} className="num flex items-center gap-1.5 rounded-full border border-rule-2 px-3 py-1 text-xs text-ink-2 hover:text-ink"><Icon.copy className="size-3" />{shortAddr(done.mint)}</button>
          <div className="flex w-full gap-2">
            <a href={`#/coin/${done.mint}`} onClick={() => closeQuickLaunch()} className="flex h-10 flex-1 items-center justify-center rounded-full bg-ink text-sm font-semibold text-paper hover:bg-white">Open the chart</a>
            <button type="button" onClick={() => setDone(null)} className="h-10 flex-1 rounded-full border border-rule-2 text-sm font-semibold text-ink-2 hover:text-ink">Launch another</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          <div className="flex gap-3">
            <div className="flex shrink-0 flex-col gap-1.5">
            <button type="button" onClick={() => file.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setHot(true); }} onDragLeave={() => setHot(false)}
              onDrop={(e) => { e.preventDefault(); setHot(false); pick(e.dataTransfer.files[0]); }}
              title="Drop, paste (Ctrl+V) or pick a picture"
              className={cn("group relative grid size-[92px] shrink-0 place-items-center overflow-hidden rounded-xl border transition-colors",
                hot ? "border-up bg-up/10" : image ? "border-rule-2" : "border-dashed border-rule-2 bg-paper hover:border-muted")}>
              {image ? <><img src={image} alt="" className="size-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/55 text-[11px] font-semibold opacity-0 transition-opacity group-hover:opacity-100">Change</span></>
                : <span className="flex flex-col items-center gap-1 px-2 text-center text-[11px] leading-tight text-muted"><svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="1.6" /><path d="M21 15l-5-5L5 21" /></svg>Drop or paste</span>}
            </button>
            <button type="button" onClick={(e) => openForge(e.currentTarget)} onPointerEnter={warmForge} onFocus={warmForge}
              title="Open the photo editor: cut the subject out, backdrops, glow, text. Use as coin picture sends it back here."
              className={cn("flex h-7 items-center justify-center gap-1.5 rounded-[6px] border text-[12px] font-semibold transition-colors",
                editing ? "border-up/50 bg-up/10 text-up" : "border-rule-2 bg-paper-3 text-ink-2 hover:border-muted hover:text-ink")}>
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10.5 2.5l3 3L6 13H3v-3z" /><path d="M9 4l3 3" /></svg>
              {image ? "Edit" : "Make it"}
            </button>
            </div>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <label className="flex flex-col gap-1"><span className={label}>Name</span>
                <input ref={nameRef} value={d.name} onChange={(e) => onName(e.target.value)} placeholder="Doge Coin, or paste a CA to clone" className={field} maxLength={44} /></label>
              <label className="flex flex-col gap-1"><span className={label}>Ticker</span>
                <span className={cn(field, "flex items-center gap-0.5 focus-within:border-ink-2")}><span className="text-muted">$</span>
                  <input value={d.symbol} onChange={(e) => set({ symbol: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10), symbolEdited: true })} placeholder="DOGE" className="num w-full min-w-0 bg-transparent font-semibold uppercase outline-none placeholder:text-muted placeholder:normal-case" /></span></label>
            </div>
          </div>
          <input value={d.description} onChange={(e) => set({ description: e.target.value.slice(0, 500) })} placeholder="One line about it (optional)" className={field} />
          <span className={cn(field, "flex items-center gap-2 focus-within:border-ink-2")}><Icon.x className="size-3.5 shrink-0 text-muted" />
            <input value={d.twitter} onChange={(e) => set({ twitter: e.target.value.slice(0, 200) })} placeholder="X link or @handle (optional)" className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted" /></span>

          <div className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between"><span className={label}>First buy</span><span className="text-[11px] text-muted">bought in the same transaction</span></span>
            <div role="radiogroup" aria-label="First buy" className="flex gap-px rounded-[6px] border border-rule bg-paper p-px">
              {BUYS.map((v) => <button key={v} type="button" role="radio" aria-checked={d.sol === v} onClick={() => set({ sol: v })} className={seg(d.sol === v)}>{v === 0 ? "None" : <span className="inline-flex items-center gap-1"><SolanaLogo className="size-2.5" />{v}</span>}</button>)}
            </div>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-2 text-[12px] text-ink-2">
            <span>Address ends in <b className="num font-semibold text-ink">…pump</b> <span className="text-muted">like pump.fun's own</span></span>
            <button type="button" role="switch" aria-checked={d.pump} onClick={() => set({ pump: !d.pump })} className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", d.pump ? "bg-up" : "bg-paper-5")}>
              <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left] duration-150", d.pump ? "left-[18px]" : "left-0.5")} /></button>
          </label>

          <div className="num flex items-center justify-between rounded-[6px] border border-rule bg-paper px-3 py-2 text-[13px]">
            <span className="text-muted">Total</span>
            <span className="flex items-center gap-1.5 font-semibold"><SolanaLogo className="size-3" />{total.toFixed(4)}{wallet != null && <span className={cn("font-normal", short ? "text-down" : "text-muted")}>· wallet {wallet.toFixed(3)}</span>}</span>
          </div>

          {!signedIn ? (
            <a href="#/account" onClick={() => closeQuickLaunch()} className="flex h-11 items-center justify-center rounded-full bg-ink text-[15px] font-semibold text-paper hover:bg-white">Sign in to launch</a>
          ) : confirm ? (
            <div className="flex flex-col gap-2 rounded-[8px] border border-warn/40 bg-warn/[0.07] p-3 motion-safe:animate-fade-in">
              <p className="text-[13px] leading-snug text-ink-2">This spends <b className="text-ink">{total.toFixed(4)} REAL SOL</b> from your Blix wallet to put <b className="text-ink">${sym}</b> on pump.fun. It can't be undone, and the name, ticker and picture can't be changed after.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirm(false)} className="h-10 flex-1 rounded-full border border-rule-2 text-sm font-semibold text-ink-2 hover:text-ink">Cancel</button>
                <button type="button" onClick={launch} className="h-10 flex-[1.4] rounded-full bg-up text-sm font-bold text-[#06130b] transition-transform hover:brightness-110 active:scale-[0.98]">Launch ${sym} now</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={Boolean(missing) || Boolean(busy) || short} onClick={() => setConfirm(true)}
              className="flex h-11 items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-semibold text-paper transition-[background-color,transform] hover:bg-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45">
              {busy ? <><i className="size-4 animate-spin rounded-full border-2 border-paper/30 border-t-paper" />{busy}…</> : missing || (short ? "Not enough SOL: deposit first" : <><Icon.launch className="size-4" />Launch ${sym}</>)}
            </button>
          )}
        </div>
      )}
    </div>
    {editor}
  </>);
}
