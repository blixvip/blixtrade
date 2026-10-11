// Create coin (#/launch): make your own pump.fun coin in one screen. Picture, name, ticker, a line about it,
// optional links, and an optional first buy; the right side shows the coin as it will look, what it costs, what is
// still missing, what happens once it is launched, and what people are posting about right now.
// Launch pins the picture to IPFS and the vault signs the create from the signed-in person's Blix wallet
// (POST /api/account/launch, server/accounts.js -> Blix Vault). Real SOL, always: there is no paper launch.
import { SiteLogo } from "@/components/logos";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PumpLogo, SolanaLogo } from "@/components/brand";
import { CreatorRewards } from "@/components/CreatorRewards";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { toast, txToast } from "@/components/ui/toast";
import { openExchange } from "@/lib/modals";
import { shortAddr } from "@/lib/format";
import { usePulse } from "@/lib/pulse";
import { loadMe, useMe } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";
import { Hot } from "./Feed";

const NO_POSTS: never[] = [], HOT_SOURCES: ("fomo" | "pump")[] = ["fomo", "pump"];
const MIGRATE_MC_SOL = 410.9;  // pump.fun market cap at migration, in SOL (793.1M tokens sold off the curve)
const CREATE_SOL = 0.025;      // pump.fun's create rent + network fees, rounded up (vault LAUNCH_COST_SOL)
const RESERVE_SOL = 0.005;     // left in the wallet for the network fee of later trades
const BUYS = [0, 0.1, 0.25, 0.5, 1];
const SLIPS = [1, 5, 10, 20];  // first-buy slippage choices, %
const DEV_WARN_PCT = 5;        // a dev holding above this is a red flag on most terminals
const MAX_BYTES = 4e6;
const DRAFT = "blix:launch:draft";

interface Draft { name: string; symbol: string; description: string; twitter: string; telegram: string; website: string; sol: number; slip: number }
const EMPTY: Draft = { name: "", symbol: "", description: "", twitter: "", telegram: "", website: "", sol: 0, slip: 5 };
interface Launched { mint: string; signature: string; status: string; name: string; symbol: string; image: string }
type LinkKey = "twitter" | "telegram" | "website";

// A saved draft, every field checked: an older or damaged one (nulls, numbers where text goes) must never stop the
// page from drawing.
const loadDraft = (): Draft => {
  let raw: Record<string, unknown> = {};
  try { const j = JSON.parse(localStorage.getItem(DRAFT) || "{}"); if (j && typeof j === "object" && !Array.isArray(j)) raw = j; } catch { /* not JSON */ }
  const text = (k: keyof Draft, max: number) => (typeof raw[k] === "string" || typeof raw[k] === "number" ? String(raw[k]).slice(0, max) : "");
  const num = (k: keyof Draft, def: number) => { const n = Number(raw[k]); return Number.isFinite(n) && n >= 0 ? n : def; };
  return { name: text("name", 32), symbol: text("symbol", 10).replace(/[^A-Za-z0-9]/g, "").toUpperCase(), description: text("description", 600),
    twitter: text("twitter", 220), telegram: text("telegram", 220), website: text("website", 220), sol: num("sol", 0), slip: SLIPS.includes(num("slip", 5)) ? num("slip", 5) : 5 };
};
const saveDraft = (d: Draft) => { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch { /* private window */ } };

// The picture as a data URL the server can forward: kept as is when small and a common type, otherwise
// redrawn to a 1000px WebP so a phone photo still fits.
async function readPicture(file: File): Promise<string> {
  const asUrl = (b: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(b); });
  if (file.size <= MAX_BYTES * 0.7 && /^image\/(png|jpeg|gif|webp)$/.test(file.type)) return asUrl(file);
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/webp", 0.9));
  if (!blob) throw new Error("That picture could not be read.");
  return asUrl(blob);
}
// Width and height of a picture, to say when it is not square or too small.
const sizeOf = (url: string) => new Promise<{ w: number; h: number } | null>((ok) => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ok(null); i.src = url; });

// pump.fun's curve at launch: 30 virtual SOL against 1.073B virtual tokens; 793.1M tokens sell before it bonds.
// The creator's first buy moves along it, so the card shows where the coin will start.
function curveAfter(sol: number) {
  const vSol = 30 + sol, vTok = (30 * 1.073e9) / vSol, bought = 1.073e9 - vTok;
  return { mcSol: (vSol / vTok) * 1e9, progress: (bought / 793.1e6) * 100, ownPct: (bought / 1e9) * 100, tokens: bought };
}

const fmt = (n: number, d = 3) => (+n || 0).toLocaleString(undefined, { maximumFractionDigits: d });
const usd = (n: number) => (n ? `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 })}` : "");
const compact = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : fmt(n, 0);

// What people type into a link box, made into the full link when they leave it: "@blix" or "x.com/blix" for X,
// "@blix" or "t.me/blix" for Telegram, "blix.com" for a website. Anything with its own scheme is left as typed
// (so "http://..." still says it must start with https://).
function tidyLink(k: LinkKey, v: string) {
  v = v.trim();
  if (!v || /^[a-z]+:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  if (k === "twitter") return /^(www\.)?(x|twitter)\.com\//i.test(v) ? `https://${v.replace(/^www\./i, "")}` : /^@?[A-Za-z0-9_]{1,15}$/.test(v) ? `https://x.com/${handle}` : v;
  if (k === "telegram") return /^(www\.)?t\.me\//i.test(v) ? `https://${v.replace(/^www\./i, "")}` : /^@?[A-Za-z0-9_]{4,32}$/.test(v) ? `https://t.me/${handle}` : v;
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? `https://${v}` : v;
}
// A ticker from the name: the first letters of each word when the words run long, else the name itself.
function suggestTicker(name: string) {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const t = words.length > 1 && words.join("").length > 10 ? words.map((w) => w[0]).join("") : words.join("");
  return t.slice(0, 10);
}

// A character count, quiet until near the limit.
const Count = ({ n, max }: { n: number; max: number }) => <span className={cn("num text-xs", n > max ? "text-down" : n > max * 0.8 ? "text-warn" : "text-muted/70")}>{n}/{max}</span>;

// One choice out of a few in a soft pill.
function Choice<V extends string | number>({ value, options, onChange, label }: { value: V | null; options: [V, ReactNode][]; onChange: (v: V) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap items-center gap-0.5 rounded-full border border-rule bg-paper-3 p-1">
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} onClick={() => onChange(v)}
          className={cn("num flex h-8 items-center gap-1.5 rounded-full px-3.5 text-md transition-colors duration-100",
            v === value ? "bg-paper-5 font-semibold text-ink shadow-raised" : "text-muted hover:text-ink-2")}>{text}</button>
      ))}
    </div>
  );
}

// The marks of the three link kinds, in their own colours.
const LINKS: [LinkKey, string, string, ReactNode][] = [
  ["twitter", "X", "https://x.com/…", <span key="x" className="grid size-6 shrink-0 place-items-center rounded-full bg-black ring-1 ring-white/15"><Icon.x className="size-3 text-white" /></span>],
  ["telegram", "Telegram", "https://t.me/…", <span key="tg" className="grid size-6 shrink-0 place-items-center rounded-full bg-white"><Icon.tg className="size-6 text-[#229ED9]" /></span>],
  ["website", "Website", "https://…", <span key="web" className="grid size-6 shrink-0 place-items-center rounded-full bg-paper-5"><Icon.web className="size-3.5 text-ink-2" /></span>],
];

function Done({ r, onAgain }: { r: Launched; onAgain: () => void }) {
  const copy = () => navigator.clipboard.writeText(r.mint).then(() => toast("Contract address copied"));
  return (
    <div className="overflow-hidden rounded-card border border-rule bg-paper-2">
      <div className="h-1 bg-gradient-to-r from-up/0 via-up to-up/0" />
      <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <div className="relative size-28 overflow-hidden rounded-[22px] border border-rule-2 bg-paper-3 shadow-sheet">{r.image && <img src={r.image} alt="" className="size-full object-cover" />}
          <span className="absolute right-1.5 bottom-1.5 grid size-6 place-items-center rounded-full border border-rule-2 bg-paper"><PumpLogo className="size-4" /></span></div>
        <div><p className="text-sm font-medium text-up">{r.status === "confirmed" ? "Live on Solana" : "Sent — waiting for the network"}</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{r.name} <span className="text-ink-2">${r.symbol}</span></h2></div>
        <button onClick={copy} className="num flex max-w-full items-center gap-2 rounded-control border border-rule-2 bg-paper px-3 py-2 text-sm text-ink-2 hover:border-muted hover:text-ink" title="Copy contract address">
          <span className="truncate">{r.mint}</span><Icon.copy className="size-3.5 shrink-0" /></button>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" size="lg" asChild><a href={`#/coin/${r.mint}`}>Open coin page</a></Button>
          <Button size="lg" asChild><a href={`https://pump.fun/coin/${r.mint}`} target="_blank" rel="noreferrer"><PumpLogo className="size-3.5" />pump.fun</a></Button>
          <Button size="lg" asChild><a href={`https://solscan.io/tx/${r.signature}`} target="_blank" rel="noreferrer"><SiteLogo site="solscan" className="size-4" />Transaction</a></Button>
          <Button size="lg" variant="ghost" onClick={onAgain}>Make another</Button>
        </div>
        <ul className="mt-2 grid max-w-xl gap-2 text-left text-sm text-muted sm:grid-cols-3">
          <li className="rounded-control border border-rule bg-paper px-3 py-2.5"><b className="block text-ink-2">Share it</b>Post the contract address on your X and Telegram first.</li>
          <li className="rounded-control border border-rule bg-paper px-3 py-2.5"><b className="block text-ink-2">Watch it</b>It shows on Pulse under New pairs within seconds of the first trade.</li>
          <li className="rounded-control border border-rule bg-paper px-3 py-2.5"><b className="block text-ink-2">Get paid</b>Claim your creator fees under Creator rewards on this page.</li>
        </ul>
      </div>
    </div>
  );
}

export function Launch() {
  const me = useMe((s) => s.me);
  const solUsd = usePulse((s) => s.live.solUsd) || 0;
  const [d, setD] = useState<Draft>(loadDraft);
  const [image, setImage] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [custom, setCustom] = useState(!BUYS.includes(loadDraft().sol));
  // The custom amount as typed ("0", "0.", "0.0" are on the way to 0.05 and must stay in the box).
  const [customText, setCustomText] = useState(() => { const s = loadDraft().sol; return s && !BUYS.includes(s) ? String(s) : ""; });
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [done, setDone] = useState<Launched | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((o) => { const n = { ...o, [k]: v }; saveDraft(n); return n; });
  useEffect(() => { if (!me) loadMe(); }, [me]);
  useEffect(() => { setImgSize(null); if (image) sizeOf(image).then(setImgSize); }, [image]);

  const pick = async (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast("That file is not a picture.");
    try { const url = await readPicture(f); if (url.length * 0.75 > MAX_BYTES * 1.05) return toast("That picture is too big even after shrinking it."); setImage(url); }
    catch (e) { toast((e as Error).message); }
  };

  const total = CREATE_SOL + (d.sol || 0);
  const bal = me?.wallet?.sol ?? null;
  // Not enough SOL only counts for an amount that is allowed at all: over the 2 SOL cap, that is what is said.
  const short = bal != null && d.sol >= 0 && d.sol <= 2 && bal < total + RESERVE_SOL;
  const linkBad = (k: LinkKey) => {
    const v = d[k]; if (!v) return null;
    if (!/^https:\/\/\S{3,200}$/.test(v)) return "Starts with https://";
    if (k === "twitter" && !/^https:\/\/(x|twitter)\.com\//.test(v)) return "An x.com link";
    if (k === "telegram" && !/^https:\/\/t\.me\//.test(v)) return "A t.me link";
    return null;
  };
  const problems = [
    !image && "Add a picture",
    !d.name.trim() && "Name your coin",
    !/^[A-Za-z0-9]{1,10}$/.test(d.symbol) && "Ticker: 1-10 letters or numbers",
    d.description.length > 500 && "Description over 500 characters",
    d.sol < 0 || d.sol > 2 ? "First buy is 0 to 2 SOL" : null,
    ...LINKS.map(([k, label]) => { const bad = linkBad(k); return bad ? `${label} link: ${bad.toLowerCase()}` : null; }),
  ].filter(Boolean) as string[];
  const ready = problems.length === 0;
  const sym = d.symbol.toUpperCase();

  const ask = () => {
    if (!me?.signedIn) { location.hash = "#/account"; return toast("Sign in first: the coin is made from your Blix wallet."); }
    if (problems.length) return toast(problems[0]);
    if (short) return toast(`Your wallet has ${fmt(bal!, 4)} SOL; this launch needs about ${fmt(total + RESERVE_SOL)}. Deposit first.`);
    setUnderstood(false); setAsking(true);
  };
  const launch = async () => {
    setAsking(false);
    const t = txToast(`Launching $${sym}`, "Uploading the picture to IPFS");
    setBusy("Uploading picture");
    const step = setTimeout(() => setBusy("Signing and sending"), 2500);
    try {
      const r = await fetch("api/account/launch", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(150_000),
        body: JSON.stringify({ name: d.name, symbol: sym, description: d.description, twitter: d.twitter, telegram: d.telegram, website: d.website, sol: d.sol, image, ...(d.sol > 0 ? { slippageBps: Math.round(d.slip * 100) } : {}) }) });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) throw new Error(r.status === 404 ? "Accounts are not switched on." : j.error || String(r.status));
      t.ok(`$${sym} is live`, shortAddr(j.mint), j.signature ? `https://solscan.io/tx/${j.signature}` : undefined);
      setDone({ mint: j.mint, signature: j.signature, status: j.status, name: d.name.trim(), symbol: sym, image: image! });
      setD(EMPTY); saveDraft(EMPTY); setImage(null); setCustom(false); setCustomText(""); loadMe();
    } catch (e) { t.fail("Launch failed", (e as Error).message); }
    finally { clearTimeout(step); setBusy(null); }
  };

  if (done) return <div className="mx-auto w-full max-w-[860px] px-4 pt-8 pb-16"><Done r={done} onAgain={() => setDone(null)} /></div>;

  const c = curveAfter(d.sol || 0);
  const startUsd = solUsd ? c.mcSol * solUsd : 0, migrateUsd = solUsd ? MIGRATE_MC_SOL * solUsd : 0;
  const cta = "h-12 w-full rounded-full text-lg font-semibold";
  const suggestion = suggestTicker(d.name);
  const squareOff = imgSize && Math.abs(imgSize.w / imgSize.h - 1) > 0.08;
  const smallPic = imgSize && Math.min(imgSize.w, imgSize.h) < 400;
  const tickerOk = /^[A-Za-z0-9]{1,10}$/.test(d.symbol);
  const steps: [string, boolean][] = [["Picture", Boolean(image)], ["Name", Boolean(d.name.trim())], ["Ticker", tickerOk], ["Links", LINKS.every(([k]) => !linkBad(k))], ["First buy", d.sol >= 0 && d.sol <= 2]];
  const doneSteps = steps.filter(([, ok]) => ok).length;

  return (
    <div className="mx-auto flex w-full max-w-[1264px] flex-col gap-4 p-3 pb-16">
      <header className="relative overflow-hidden rounded-card border border-rule bg-gradient-to-br from-paper-3 via-paper-2 to-paper-2 p-5 max-sm:p-4">
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-[16px] border border-rule-2 bg-paper shadow-raised max-sm:size-12"><PumpLogo className="size-8 max-sm:size-7" /></span>
            <div className="min-w-0">
              <h1 className="text-2xl leading-none font-bold tracking-tight">Create a coin</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Chip icon={<SolanaLogo className="size-3.5" />} k="To launch" v={`~${fmt(CREATE_SOL)} SOL${solUsd ? ` · ${usd(CREATE_SOL * solUsd)}` : ""}`} />
            <Chip icon={<Icon.curve className="size-3.5 text-up" />} k="Migrates at" v={migrateUsd ? usd(migrateUsd) : `${MIGRATE_MC_SOL} SOL`} />
            <Chip icon={<Icon.crown className="size-3.5 text-warn" />} k="You earn" v="creator fee on every trade" />
          </div>
        </div>
        {/* how far along the form is */}
        <div className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {steps.map(([label, ok]) => (
            <span key={label} className={cn("flex items-center gap-1.5", ok ? "text-ink-2" : "text-muted")}>
              <span className={cn("grid size-4 place-items-center rounded-full border", ok ? "border-up bg-up text-paper" : "border-rule-2")}>{ok && <Check />}</span>{label}
            </span>
          ))}
          <span className="num ml-auto text-muted">{doneSteps}/{steps.length} ready</span>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* the form */}
        <div className="flex flex-col gap-4">
          <Section n={1} title="The coin" sub="What people see on Pulse, pump.fun and every terminal." done={Boolean(image && d.name.trim() && tickerOk)}>
            <div className="flex gap-5 max-sm:flex-col max-sm:items-center">
              <div className="flex w-40 shrink-0 flex-col items-center gap-2">
                <button type="button" onClick={() => file.current?.click()} aria-label={image ? "Change picture" : "Add a picture"}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
                  className={cn("group relative grid size-40 shrink-0 place-items-center overflow-hidden rounded-[18px] border transition-colors duration-100",
                    drag ? "border-up bg-up/10" : image ? "border-rule-2" : "border-dashed border-rule-2 bg-paper-3 hover:border-muted hover:bg-paper-4")}>
                  {image ? <><img src={image} alt="" className="size-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/55 text-sm font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">Change picture</span></>
                    : <span className="flex flex-col items-center gap-2 px-3 text-center text-muted"><span className="grid size-11 place-items-center rounded-full bg-paper-5 text-ink-2"><Icon.image className="size-5" /></span><span className="text-md font-semibold text-ink-2">Add picture</span><span className="text-xs leading-snug">Drop it here or click</span></span>}
                </button>
                {image ? (
                  <div className="flex w-full flex-col items-center gap-1 text-center text-xs">
                    {imgSize && <span className="num text-muted">{imgSize.w} × {imgSize.h}</span>}
                    {squareOff && <span className="text-warn">Not square: the edges get cut off</span>}
                    {smallPic && <span className="text-warn">Small: 500px or more looks sharper</span>}
                    <button type="button" onClick={() => setImage(null)} className="text-muted underline-offset-2 hover:text-down hover:underline">Remove</button>
                  </div>
                ) : <span className="text-center text-xs text-muted">Square, 500px+<br />PNG, JPG, GIF, WebP · up to 4 MB</span>}
              </div>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
              <div className="flex w-full min-w-0 flex-1 flex-col gap-3.5">
                <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_170px]">
                  <Field label="Name" aside={<Count n={d.name.length} max={32} />}>
                    <input value={d.name} maxLength={32} placeholder="Doge Coin" onChange={(e) => set("name", e.target.value)} className={field} />
                  </Field>
                  <Field label="Ticker" aside={<Count n={d.symbol.length} max={10} />}>
                    <span className={cn(field, "flex items-center gap-0.5 focus-within:border-ink-2")}><span className="font-semibold text-muted">$</span>
                      <input value={d.symbol} maxLength={10} placeholder="DOGE" onChange={(e) => set("symbol", e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())}
                        className="min-w-0 flex-1 bg-transparent font-semibold tracking-wide uppercase outline-none placeholder:font-normal placeholder:text-muted/60" /></span>
                  </Field>
                </div>
                {!d.symbol && suggestion && (
                  <button type="button" onClick={() => set("symbol", suggestion)} className="-mt-1.5 self-end rounded-full border border-rule px-2.5 py-1 text-xs text-muted hover:border-muted hover:text-ink">Use <b className="font-semibold text-ink-2">${suggestion}</b></button>
                )}
                <Field label="Description" hint="optional" aside={<Count n={d.description.length} max={500} />}>
                  <textarea value={d.description} rows={4} placeholder="What is it? One or two lines people will read before they buy." onChange={(e) => set("description", e.target.value)}
                    className={cn(field, "h-auto resize-none py-2.5 leading-relaxed")} />
                </Field>
                <p className="flex items-start gap-2 text-xs leading-relaxed text-muted"><Icon.bolt className="mt-px size-3.5 shrink-0 text-warn" />Short tickers (3-5 letters) and a clear, square picture stand out on Pulse and pump.fun. The name, ticker and picture can't be changed after launch.</p>
              </div>
            </div>
          </Section>

          <Section n={2} title="Links" sub="Optional. Coins with real socials get more buyers. Paste a link, or just @handle for X and Telegram." done={LINKS.some(([k]) => d[k] && !linkBad(k)) && LINKS.every(([k]) => !linkBad(k))}>
            <div className="grid gap-3 sm:grid-cols-3">
              {LINKS.map(([k, label, ph, mark]) => {
                const bad = linkBad(k), good = Boolean(d[k]) && !bad;
                return (
                  <Field key={k} label={label} error={bad}>
                    <span className={cn(field, "flex items-center gap-2 pl-2 focus-within:border-ink-2", bad && "border-down/60", good && "border-up/40")}>{mark}
                      <input value={d[k]} placeholder={ph} onChange={(e) => set(k, e.target.value.trim())} onBlur={(e) => { const t = tidyLink(k, e.target.value); if (t !== d[k]) set(k, t); }}
                        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted/60" />
                      {good && <span className="grid size-4 shrink-0 place-items-center rounded-full bg-up text-paper"><Check /></span>}</span>
                  </Field>
                );
              })}
            </div>
          </Section>

          <Section n={3} title="First buy" sub="Bought in the same transaction as the create, so nobody can snipe ahead of you." done={d.sol > 0 && d.sol <= 2}>
            <div className="flex flex-wrap items-center gap-2">
              <Choice label="First buy" value={custom ? "custom" : d.sol} onChange={(v) => { if (v === "custom") { setCustom(true); set("sol", Math.max(0, +customText || 0)); } else { setCustom(false); set("sol", v as number); } }}
                options={[...BUYS.map((v) => [v, v === 0 ? "None" : <><SolanaLogo className="size-3.5" />{v}</>] as [number, ReactNode]), ["custom", "Custom"]]} />
              {custom && <span className={cn(field, "flex w-32 items-center gap-1.5 focus-within:border-ink-2")}><SolanaLogo className="size-3.5" />
                <input type="text" inputMode="decimal" autoFocus aria-label="First buy in SOL" value={customText} placeholder="0.00"
                  onChange={(e) => { const t = e.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"); setCustomText(t); set("sol", Math.max(0, +t || 0)); }}
                  className="num min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted/60" /></span>}
              {d.sol > 0 && solUsd > 0 && <span className="num text-sm text-muted">{usd(d.sol * solUsd)}</span>}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Fig label="Starts at" value={startUsd ? usd(startUsd) : `${fmt(c.mcSol, 1)} SOL`} sub="market cap" />
              <Fig label="You get" value={d.sol > 0 ? compact(c.tokens) : "—"} sub={d.sol > 0 ? `$${sym || "TICKER"} tokens` : "no first buy"} />
              <Fig label="You hold" value={d.sol > 0 ? `${c.ownPct.toFixed(2)}%` : "—"} sub={d.sol > 0 ? "of the 1B supply" : "no first buy"} warn={c.ownPct > DEV_WARN_PCT} />
              <Fig label="Migrates at" value={migrateUsd ? usd(migrateUsd) : `${MIGRATE_MC_SOL} SOL`} sub="when the curve fills" />
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm text-muted">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-4"><span className="block h-full rounded-full bg-up transition-[width] duration-200" style={{ width: `${Math.max(0.8, Math.min(100, c.progress))}%` }} /></span>
              <span className="num shrink-0">{c.progress.toFixed(1)}% of the curve</span>
            </div>
            {c.ownPct > DEV_WARN_PCT && d.sol <= 2 && (
              <p className="mt-3 flex items-start gap-2 rounded-control border border-warn/30 bg-warn/8 px-3 py-2 text-sm text-warn"><Icon.shield className="mt-0.5 size-4 shrink-0" />Holding over {DEV_WARN_PCT}% as the dev is flagged on most terminals and scares buyers off. A smaller first buy looks safer.</p>
            )}
            {d.sol > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
                <span className="text-sm text-ink-2">Slippage <span className="text-muted">on the first buy</span></span>
                <Choice label="Slippage" value={d.slip} onChange={(v) => set("slip", v)} options={SLIPS.map((v) => [v, `${v}%`] as [number, ReactNode])} />
              </div>
            )}
          </Section>

          <CreatorRewards />
        </div>

        {/* preview, cost and launch */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <div className="overflow-hidden rounded-card border border-rule bg-paper-2">
            <div className="flex items-center justify-between border-b border-rule px-4 py-2.5 text-sm font-medium text-muted">Preview · how it shows on Pulse<span className="flex items-center gap-1 text-xs"><PumpLogo className="size-3" />New pair</span></div>
            <div className="flex gap-3.5 p-4">
              <span className="relative block size-17 shrink-0 rounded-control p-0.5" style={{ background: `conic-gradient(var(--color-up) ${Math.min(100, c.progress)}%, var(--color-rule-2) 0)` }}>
                <span className="grid size-full place-items-center overflow-hidden rounded-chip bg-paper-3 text-sm font-semibold text-muted uppercase">
                  {image ? <img src={image} alt="" className="size-full object-cover" /> : (d.symbol || "?").slice(0, 4)}</span>
                <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full border border-rule-2 bg-paper"><PumpLogo className="size-3" /></span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5"><b className="truncate text-lg font-semibold text-ink">{d.symbol || "TICKER"}</b><span className="truncate text-md text-muted">{d.name || "Coin name"}</span></div>
                <div className="mt-0.5 flex items-center gap-2.5 text-muted [&_svg]:size-3.5">
                  <span className="num text-lg font-medium text-up">0s</span>
                  {d.twitter && <Icon.x />}{d.telegram && <Icon.tg />}{d.website && <Icon.web />}
                  <span className="num ml-auto text-sm">MC <b className="text-md font-semibold text-info">{startUsd ? usd(startUsd) : "—"}</b></span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-ink-2">{d.description || <span className="text-muted">Your description shows here.</span>}</p>
              </div>
            </div>
            <div className="num flex items-center justify-between gap-2 border-t border-rule px-4 py-2 text-xs text-muted">
              <span>Dev <b className={cn("font-semibold", c.ownPct > DEV_WARN_PCT ? "text-warn" : "text-ink-2")}>{d.sol > 0 ? `${c.ownPct.toFixed(2)}%` : "0%"}</b></span>
              <span>Bonding <b className="font-semibold text-ink-2">{c.progress.toFixed(1)}%</b></span>
              <span>Holders <b className="font-semibold text-ink-2">{d.sol > 0 ? 1 : 0}</b></span>
            </div>
          </div>

          <div className="flex flex-col gap-3.5 rounded-card border border-rule bg-paper-2 p-4">
            <div className="flex flex-col gap-2 text-md">
              <Row k="Create (rent + fees)" v={<><SolanaLogo className="size-3.5" />{fmt(CREATE_SOL)}</>} sub={solUsd ? usd(CREATE_SOL * solUsd) : ""} />
              <Row k="First buy" v={d.sol ? <><SolanaLogo className="size-3.5" />{fmt(d.sol)}</> : "—"} sub={d.sol && solUsd ? usd(d.sol * solUsd) : ""} />
              <Row k="IPFS upload" v="free" />
              <div className="my-0.5 h-px bg-rule" />
              <Row k={<b className="font-semibold text-ink">Total</b>} v={<b className="flex items-center gap-1.5 text-lg font-semibold text-ink"><SolanaLogo className="size-4" />~{fmt(total)}{solUsd ? <span className="text-md font-normal text-muted">{usd(total * solUsd)}</span> : null}</b>} />
              <Row k="Your wallet" v={<span className={short ? "text-down" : "text-ink-2"}>{!me ? "…" : me.signedIn ? <span className="flex items-center gap-1.5"><SolanaLogo className="size-3.5" />{fmt(bal ?? 0, 4)}</span> : "not signed in"}</span>} />
            </div>
            {!me?.signedIn ? <Button variant="primary" className={cta} asChild><a href="#/account">Sign in to launch</a></Button>
              : short ? <Button variant="primary" className={cta} onClick={() => openExchange()}>Deposit SOL</Button>
              : <Button variant="primary" className={cta} disabled={!!busy || !ready} onClick={ask}>{busy ? `${busy}…` : d.symbol ? `Launch $${d.symbol}` : "Launch"}</Button>}
            {short && <p className="text-sm text-down">Needs about {fmt(total + RESERVE_SOL)} SOL in your Blix wallet: the launch plus a little for fees.</p>}
            {me?.signedIn && !short && !ready && (
              <ul className="flex flex-col gap-1 text-sm text-muted">{problems.map((x) => <li key={x} className="flex items-center gap-2"><i className="size-1.5 rounded-full bg-rule-2" />{x}</li>)}</ul>
            )}
          </div>

          {/* What people are posting about right now (the Feed's panel), to launch into what is hot. */}
          <Hot items={NO_POSTS} sources={HOT_SOURCES} keep className="min-w-0 rounded-card border border-rule bg-paper-2 px-1 pt-3.5 pb-1" />

        </aside>
      </div>

      <Dialog open={asking} onOpenChange={setAsking} title={`Launch $${sym}?`}>
        <div className="flex items-center gap-3">
          <span className="size-14 shrink-0 overflow-hidden rounded-[14px] border border-rule-2 bg-paper-3">{image && <img src={image} alt="" className="size-full object-cover" />}</span>
          <div className="min-w-0"><b className="block truncate text-lg font-semibold text-ink">{d.name}</b><span className="flex items-center gap-1 text-sm text-muted"><PumpLogo className="size-3" />${sym} on pump.fun</span></div>
        </div>
        <div className="flex flex-col gap-1.5 rounded-control border border-rule bg-paper px-3 py-2.5 text-md">
          <Row k="Create" v={<><SolanaLogo className="size-3.5" />{fmt(CREATE_SOL)}</>} />
          {d.sol > 0 && <Row k="First buy" v={<><SolanaLogo className="size-3.5" />{fmt(d.sol)} <span className="text-muted">· {d.slip}% slippage</span></>} />}
          <Row k={<b className="font-semibold text-ink">Total</b>} v={<b className="flex items-center gap-1.5 font-semibold text-ink"><SolanaLogo className="size-3.5" />~{fmt(total)}{solUsd ? <span className="font-normal text-muted">{usd(total * solUsd)}</span> : null}</b>} />
        </div>
        <p className="text-sm leading-relaxed text-ink-2">This spends <b className="text-ink">REAL SOL</b> from your Blix wallet: about {fmt(CREATE_SOL)} SOL to create{d.sol ? ` + ${fmt(d.sol)} SOL first buy` : ""}. The name, ticker and picture are permanent: a launched coin can't be edited or deleted.</p>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-2">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--color-up)]" />
          I understand this uses real SOL and can't be undone.
        </label>
        <div className="flex gap-2">
          <Button size="lg" variant="ghost" className="flex-1" onClick={() => setAsking(false)}>Cancel</Button>
          <Button size="lg" variant="primary" className="flex-1" disabled={!understood} onClick={launch}>Launch now</Button>
        </div>
      </Dialog>
    </div>
  );
}

const field = "h-10 w-full min-w-0 rounded-control border border-rule-2 bg-paper px-3 text-md text-ink outline-none transition-colors duration-100 placeholder:text-muted/60 hover:border-muted/60 focus:border-ink-2";

const Check = () => <svg viewBox="0 0 12 12" aria-hidden className="size-2.5"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const Chip = ({ icon, k, v }: { icon: ReactNode; k: string; v: string }) => (
  <span className="flex items-center gap-1.5 rounded-full border border-rule bg-paper/60 px-3 py-1.5 text-muted">{icon}{k} <b className="num font-semibold text-ink-2">{v}</b></span>
);

// One numbered step of the form; the number turns into a check once the step is filled in.
function Section({ n, title, sub, done, children }: { n: number; title: string; sub: string; done?: boolean; children: ReactNode }) {
  return (
    <section className="rounded-card border border-rule bg-paper-2 p-5 max-sm:p-4">
      <div className="mb-4 flex items-start gap-3">
        <span className={cn("num grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors", done ? "bg-up text-paper" : "bg-paper-5 text-ink-2")}>{done ? <Check /> : n}</span>
        <div><h2 className="text-lg leading-tight font-semibold text-ink">{title}</h2><p className="mt-0.5 text-sm text-muted">{sub}</p></div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, aside, error, children }: { label: string; hint?: string; aside?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center justify-between gap-2 text-sm"><span className="font-medium text-ink-2">{label}{hint && <span className="ml-1.5 font-normal text-muted">{hint}</span>}</span>{error ? <span className="text-down">{error}</span> : aside}</span>
      {children}
    </label>
  );
}

const Fig = ({ label, value, sub, warn }: { label: string; value: ReactNode; sub?: string; warn?: boolean }) => (
  <div className={cn("rounded-control border bg-paper px-3 py-2.5", warn ? "border-warn/40" : "border-rule")}><span className="text-xs text-muted">{label}</span><b className={cn("num block text-lg font-semibold", warn ? "text-warn" : "text-ink")}>{value}</b>{sub && <span className="text-xs text-muted">{sub}</span>}</div>
);
const Row = ({ k, v, sub }: { k: ReactNode; v: ReactNode; sub?: string }) => <div className="num flex items-center justify-between gap-3"><span className="text-muted">{k}</span><span className="flex items-center gap-1.5 text-ink-2">{v}{sub && <span className="text-sm text-muted">{sub}</span>}</span></div>;

// One of your launched coins, with its picture and name.
