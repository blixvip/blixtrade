// Create coin (#/launch): make your own pump.fun coin in one screen. Picture, name, ticker, a line about it,
// optional links, and an optional first buy; the right side shows the coin as it will look and what it costs.
// Launch pins the picture to IPFS and the vault signs the create from the signed-in person's Blix wallet
// (POST /api/account/launch, server/accounts.js -> Blix Vault). Real SOL, always: there is no paper launch.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PumpLogo, SolanaLogo } from "@/components/brand";
import { CoinImg, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { toast, txToast } from "@/components/ui/toast";
import { openExchange } from "@/components/Exchange";
import { shortAddr } from "@/lib/format";
import { usePulse } from "@/lib/pulse";
import { useCoinNames } from "@/lib/social";
import { loadMe, useMe } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

const MIGRATE_MC_SOL = 410.9;  // pump.fun market cap at migration, in SOL (793.1M tokens sold off the curve)
const CREATE_SOL = 0.025;      // pump.fun's create rent + network fees, rounded up (vault LAUNCH_COST_SOL)
const BUYS = [0, 0.1, 0.25, 0.5, 1];
const MAX_BYTES = 4e6;
const DRAFT = "blix:launch:draft";

interface Draft { name: string; symbol: string; description: string; twitter: string; telegram: string; website: string; sol: number }
const EMPTY: Draft = { name: "", symbol: "", description: "", twitter: "", telegram: "", website: "", sol: 0 };
interface Launched { mint: string; signature: string; status: string; name: string; symbol: string; image: string }
interface Tx { t: number; kind: string; sol: number | null; mint: string | null; sig: string | null; status: string }

const loadDraft = (): Draft => { try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(DRAFT) || "{}") }; } catch { return EMPTY; } };
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

// pump.fun's curve at launch: 30 virtual SOL against 1.073B virtual tokens; 793.1M tokens sell before it bonds.
// The creator's first buy moves along it, so the card shows where the coin will start.
function curveAfter(sol: number) {
  const vSol = 30 + sol, vTok = (30 * 1.073e9) / vSol, bought = 1.073e9 - vTok;
  return { mcSol: (vSol / vTok) * 1e9, progress: (bought / 793.1e6) * 100, ownPct: (bought / 1e9) * 100 };
}

const fmt = (n: number, d = 3) => (+n || 0).toLocaleString(undefined, { maximumFractionDigits: d });
const usd = (n: number) => (n ? `$${n.toLocaleString(undefined, { maximumFractionDigits: n < 10 ? 2 : 0 })}` : "");

// A character count that only speaks up near the limit.
const Count = ({ n, max }: { n: number; max: number }) => n > max * 0.8 ? <span className={cn("num text-xs", n > max ? "text-down" : "text-muted")}>{max - n}</span> : null;

// One choice out of a few in a soft pill, like a browser's Search / Ask switch.
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

function Done({ r, onAgain }: { r: Launched; onAgain: () => void }) {
  const copy = () => navigator.clipboard.writeText(r.mint).then(() => toast("Contract address copied"));
  return (
    <Panel>
      <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
        <div className="relative size-28 overflow-hidden rounded-card border border-rule-2 bg-paper-3">{r.image && <img src={r.image} alt="" className="size-full object-cover" />}</div>
        <div><p className="text-sm text-up">{r.status === "confirmed" ? "Live on Solana" : "Sent — waiting for the network"}</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight">{r.name} <span className="text-ink-2">${r.symbol}</span></h2></div>
        <button onClick={copy} className="num flex items-center gap-2 rounded-control border border-rule-2 bg-paper px-3 py-2 text-sm text-ink-2 hover:border-muted hover:text-ink" title="Copy contract address">
          {r.mint}<Icon.copy className="size-3.5" /></button>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" size="lg" asChild><a href={`#/coin/${r.mint}`}>Open coin page</a></Button>
          <Button size="lg" asChild><a href={`https://pump.fun/coin/${r.mint}`} target="_blank" rel="noreferrer"><PumpLogo className="size-3.5" />pump.fun</a></Button>
          <Button size="lg" asChild><a href={`https://solscan.io/tx/${r.signature}`} target="_blank" rel="noreferrer">Transaction</a></Button>
          <Button size="lg" variant="ghost" onClick={onAgain}>Make another</Button>
        </div>
        <p className="max-w-md text-xs text-muted">The coin appears on Pulse within a few seconds of the first trade. You earn pump.fun's creator fee on every trade; claim it on pump.fun with this wallet.</p>
      </div>
    </Panel>
  );
}

export function Launch() {
  const me = useMe((s) => s.me);
  const solUsd = usePulse((s) => s.live.solUsd) || 0;
  const [d, setD] = useState<Draft>(loadDraft);
  const [image, setImage] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [custom, setCustom] = useState(!BUYS.includes(loadDraft().sol));
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Launched | null>(null);
  const [mine, setMine] = useState<Tx[]>([]);
  const file = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((o) => { const n = { ...o, [k]: v }; saveDraft(n); return n; });
  const loadMine = useCallback(() => {
    fetch("/api/account/txs", { signal: AbortSignal.timeout(20_000) }).then((r) => (r.ok ? r.json() : [])).then((t: Tx[]) => setMine(Array.isArray(t) ? t.filter((x) => x.kind === "launch") : [])).catch(() => {});
  }, []);
  useEffect(() => { if (!me) loadMe(); }, [me]);
  useEffect(() => { if (me?.signedIn) loadMine(); }, [me?.signedIn, loadMine]);

  const pick = async (f?: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast("That file is not a picture.");
    try { const url = await readPicture(f); if (url.length * 0.75 > MAX_BYTES * 1.05) return toast("That picture is too big even after shrinking it."); setImage(url); }
    catch (e) { toast((e as Error).message); }
  };

  const total = CREATE_SOL + (d.sol || 0);
  const bal = me?.wallet?.sol ?? null;
  const short = bal != null && bal < total + 0.005;
  const problems = [
    !image && "Add a picture",
    !d.name.trim() && "Name your coin",
    !/^[A-Za-z0-9]{1,10}$/.test(d.symbol) && "Ticker: 1-10 letters or numbers",
    d.description.length > 500 && "Description over 500 characters",
    d.sol < 0 || d.sol > 2 ? "First buy is 0 to 2 SOL" : null,
  ].filter(Boolean) as string[];

  const launch = async () => {
    if (!me?.signedIn) { location.hash = "#/account"; return toast("Sign in first: the coin is made from your Blix wallet."); }
    if (problems.length) return toast(problems[0]);
    if (short) return toast(`Your wallet has ${fmt(bal!, 4)} SOL; this launch needs about ${fmt(total + 0.005)}. Deposit first.`);
    if (!confirm(`Launch $${d.symbol.toUpperCase()} on pump.fun?\n\nThis spends REAL SOL from your Blix wallet: about ${fmt(CREATE_SOL)} SOL to create${d.sol ? ` + ${d.sol} SOL first buy` : ""}.\nA launched coin cannot be edited or deleted.`)) return;
    const t = txToast(`Launching $${d.symbol.toUpperCase()}`, "Uploading the picture to IPFS");
    setBusy("Uploading picture");
    const step = setTimeout(() => setBusy("Signing and sending"), 2500);
    try {
      const r = await fetch("/api/account/launch", { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(150_000),
        body: JSON.stringify({ ...d, symbol: d.symbol.toUpperCase(), image }) });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) throw new Error(r.status === 404 ? "Accounts are not switched on." : j.error || String(r.status));
      t.ok(`$${d.symbol.toUpperCase()} is live`, shortAddr(j.mint), j.signature ? `https://solscan.io/tx/${j.signature}` : undefined);
      setDone({ mint: j.mint, signature: j.signature, status: j.status, name: d.name.trim(), symbol: d.symbol.toUpperCase(), image: image! });
      setD(EMPTY); saveDraft(EMPTY); setImage(null); loadMe(); loadMine();
    } catch (e) { t.fail("Launch failed", (e as Error).message); }
    finally { clearTimeout(step); setBusy(null); }
  };

  if (done) return <div className="mx-auto w-full max-w-[760px] px-4 pt-8 pb-16"><Done r={done} onAgain={() => setDone(null)} /></div>;

  const c = curveAfter(d.sol || 0);
  const startUsd = solUsd ? c.mcSol * solUsd : 0, migrateUsd = solUsd ? MIGRATE_MC_SOL * solUsd : 0;
  const linkBad = (k: "twitter" | "telegram" | "website") => {
    const v = d[k]; if (!v) return null;
    if (!/^https:\/\/\S{3,200}$/.test(v)) return "Starts with https://";
    if (k === "twitter" && !/^https:\/\/(x|twitter)\.com\//.test(v)) return "An x.com link";
    if (k === "telegram" && !/^https:\/\/t\.me\//.test(v)) return "A t.me link";
    return null;
  };
  for (const [k, label] of [["twitter", "X"], ["telegram", "Telegram"], ["website", "Website"]] as const) { const bad = linkBad(k); if (bad) problems.push(`${label} link: ${bad.toLowerCase()}`); }
  const ready = problems.length === 0;
  const cta = "h-12 w-full rounded-full text-lg font-semibold";

  return (
    <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4 p-3 pb-16">
      <header className="flex max-w-[1240px] flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl leading-none font-bold tracking-tight">Create a coin</h1>
          <p className="mt-1.5 max-w-xl text-md text-muted">Live on pump.fun in under a minute. It trades on the bonding curve right away and moves to its own pool when the curve fills.</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-rule px-3 py-1 text-sm text-muted"><PumpLogo className="size-3.5" />Launches on pump.fun</span>
      </header>

      <div className="grid max-w-[1240px] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* the form */}
        <div className="flex flex-col gap-4">
          <Section n={1} title="The coin" sub="What people see on Pulse, pump.fun and every terminal.">
            <div className="flex gap-5 max-sm:flex-col max-sm:items-center">
              <div className="flex flex-col items-center gap-2">
                <button type="button" onClick={() => file.current?.click()} aria-label={image ? "Change picture" : "Add a picture"}
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
                  className={cn("group relative grid size-40 shrink-0 place-items-center overflow-hidden rounded-[18px] border transition-colors duration-100",
                    drag ? "border-ink-2 bg-paper-4" : image ? "border-rule-2" : "border-dashed border-rule-2 bg-paper-3 hover:border-muted hover:bg-paper-4")}>
                  {image ? <><img src={image} alt="" className="size-full object-cover" /><span className="absolute inset-0 grid place-items-center bg-black/55 text-sm font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">Change picture</span></>
                    : <span className="flex flex-col items-center gap-2 px-3 text-center text-muted"><span className="grid size-11 place-items-center rounded-full bg-paper-5 text-ink-2"><Icon.image className="size-5" /></span><span className="text-md font-semibold text-ink-2">Add picture</span><span className="text-xs leading-snug">Drop it here or click</span></span>}
                </button>
                <span className="text-center text-xs text-muted">Square, 500px+<br />PNG, JPG, GIF, WebP</span>
              </div>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
              <div className="flex w-full min-w-0 flex-1 flex-col gap-3.5">
                <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_170px]">
                  <Field label="Name" aside={<Count n={d.name.length} max={32} />}>
                    <input value={d.name} maxLength={32} placeholder="Doge Coin" onChange={(e) => set("name", e.target.value)} className={field} />
                  </Field>
                  <Field label="Ticker">
                    <span className={cn(field, "flex items-center gap-0.5 focus-within:border-ink-2")}><span className="font-semibold text-muted">$</span>
                      <input value={d.symbol} maxLength={10} placeholder="DOGE" onChange={(e) => set("symbol", e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())}
                        className="min-w-0 flex-1 bg-transparent font-semibold tracking-wide uppercase outline-none placeholder:font-normal placeholder:text-muted/60" /></span>
                  </Field>
                </div>
                <Field label="Description" hint="optional" aside={<Count n={d.description.length} max={500} />}>
                  <textarea value={d.description} rows={4} placeholder="What is it? One or two lines people will read before they buy." onChange={(e) => set("description", e.target.value)}
                    className={cn(field, "h-auto resize-none py-2.5 leading-relaxed")} />
                </Field>
              </div>
            </div>
          </Section>

          <Section n={2} title="Links" sub="Optional. Coins with real socials get more buyers.">
            <div className="grid gap-3 sm:grid-cols-3">
              {([["twitter", "X", "https://x.com/…", Icon.x], ["telegram", "Telegram", "https://t.me/…", Icon.tg], ["website", "Website", "https://…", Icon.web]] as const).map(([k, label, ph, Ic]) => (
                <Field key={k} label={label} error={linkBad(k)}>
                  <span className={cn(field, "flex items-center gap-2 focus-within:border-ink-2", linkBad(k) && "border-down/60")}><Ic className="size-4 shrink-0 text-muted" />
                    <input value={d[k]} placeholder={ph} onChange={(e) => set(k, e.target.value.trim())} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted/60" /></span>
                </Field>
              ))}
            </div>
          </Section>

          <Section n={3} title="First buy" sub="Bought in the same transaction as the create, so nobody can snipe ahead of you.">
            <div className="flex flex-wrap items-center gap-2">
              <Choice label="First buy" value={custom ? "custom" : d.sol} onChange={(v) => { if (v === "custom") setCustom(true); else { setCustom(false); set("sol", v as number); } }}
                options={[...BUYS.map((v) => [v, v === 0 ? "None" : <><SolanaLogo className="size-3.5" />{v}</>] as [number, ReactNode]), ["custom", "Custom"]]} />
              {custom && <span className={cn(field, "flex w-32 items-center gap-1.5 focus-within:border-ink-2")}><SolanaLogo className="size-3.5" />
                <input type="number" min={0} max={2} step={0.01} autoFocus aria-label="First buy in SOL" value={d.sol || ""} placeholder="0.00" onChange={(e) => set("sol", Math.max(0, +e.target.value || 0))}
                  className="num min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted/60" /></span>}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 max-sm:grid-cols-1">
              <Fig label="Starts at" value={startUsd ? usd(startUsd) : `${fmt(c.mcSol, 1)} SOL`} sub="market cap" />
              <Fig label="You hold" value={d.sol > 0 ? `${c.ownPct.toFixed(2)}%` : "—"} sub={d.sol > 0 ? "of the 1B supply" : "no first buy"} />
              <Fig label="Migrates at" value={migrateUsd ? usd(migrateUsd) : `${MIGRATE_MC_SOL} SOL`} sub="when the curve fills" />
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm text-muted">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-4"><span className="block h-full rounded-full bg-up transition-[width] duration-200" style={{ width: `${Math.max(0.8, Math.min(100, c.progress))}%` }} /></span>
              <span className="num shrink-0">{c.progress.toFixed(1)}% of the curve</span>
            </div>
          </Section>
        </div>

        {/* preview and launch */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <div className="overflow-hidden rounded-card border border-rule bg-paper-2">
            <div className="border-b border-rule px-4 py-2.5 text-sm font-medium text-muted">Preview · how it shows on Pulse</div>
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
          </div>

          <div className="flex flex-col gap-3.5 rounded-card border border-rule bg-paper-2 p-4">
            <div className="flex flex-col gap-2 text-md">
              <Row k="Create (rent + fees)" v={<><SolanaLogo className="size-3.5" />{fmt(CREATE_SOL)}</>} />
              <Row k="First buy" v={d.sol ? <><SolanaLogo className="size-3.5" />{fmt(d.sol)}</> : "—"} />
              <div className="my-0.5 h-px bg-rule" />
              <Row k={<b className="font-semibold text-ink">Total</b>} v={<b className="flex items-center gap-1.5 text-lg font-semibold text-ink"><SolanaLogo className="size-4" />~{fmt(total)}{solUsd ? <span className="text-md font-normal text-muted">{usd(total * solUsd)}</span> : null}</b>} />
              <Row k="Your wallet" v={<span className={short ? "text-down" : "text-ink-2"}>{!me ? "…" : me.signedIn ? <span className="flex items-center gap-1.5"><SolanaLogo className="size-3.5" />{fmt(bal ?? 0, 4)}</span> : "not signed in"}</span>} />
            </div>
            {!me?.signedIn ? <Button variant="primary" className={cta} asChild><a href="#/account">Sign in to launch</a></Button>
              : short ? <Button variant="primary" className={cta} onClick={() => openExchange()}>Deposit SOL</Button>
              : <Button variant="primary" className={cta} disabled={!!busy || !ready} onClick={launch}>{busy ? `${busy}…` : d.symbol ? `Launch $${d.symbol}` : "Launch"}</Button>}
            {me?.signedIn && !short && !ready && (
              <ul className="flex flex-col gap-1 text-sm text-muted">{problems.map((x) => <li key={x} className="flex items-center gap-2"><i className="size-1.5 rounded-full bg-rule-2" />{x}</li>)}</ul>
            )}
            <p className="text-xs leading-relaxed text-muted">Real SOL, even with Paper on. A launched coin can't be edited or deleted. You earn pump.fun's creator fee on every trade.</p>
          </div>

          {mine.length > 0 && (
            <section className="overflow-hidden rounded-card border border-rule bg-paper-2">
              <h2 className="border-b border-rule px-4 py-2.5 text-sm font-medium text-muted">Your launches</h2>
              <ul>{mine.slice(0, 8).map((x) => <Mine key={x.sig || x.t} x={x} />)}</ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

const field = "h-10 w-full min-w-0 rounded-control border border-rule-2 bg-paper px-3 text-md text-ink outline-none transition-colors duration-100 placeholder:text-muted/60 hover:border-muted/60 focus:border-ink-2";

// One numbered step of the form.
function Section({ n, title, sub, children }: { n: number; title: string; sub: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-rule bg-paper-2 p-5 max-sm:p-4">
      <div className="mb-4 flex items-start gap-3">
        <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-paper-5 text-xs font-bold text-ink-2">{n}</span>
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

const Fig = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <div className="rounded-control border border-rule bg-paper px-3 py-2.5"><span className="text-xs text-muted">{label}</span><b className="num block text-lg font-semibold text-ink">{value}</b>{sub && <span className="text-xs text-muted">{sub}</span>}</div>
);
const Row = ({ k, v }: { k: ReactNode; v: ReactNode }) => <div className="num flex items-center justify-between gap-3"><span className="text-muted">{k}</span><span className="flex items-center gap-1.5 text-ink-2">{v}</span></div>;

// One of your launched coins, with its picture and name.
function Mine({ x }: { x: Tx }) {
  const names = useCoinNames(x.mint ? [x.mint] : []), n = x.mint ? names(x.mint) : {};
  return (
    <li className="border-t border-rule first:border-t-0">
      <a href={x.mint ? `#/coin/${x.mint}` : undefined} className="flex items-center gap-3 px-4 py-2.5 hover:bg-paper-3/50">
        <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-chip bg-paper-4 text-2xs font-semibold text-muted uppercase">{(n.symbol || "?").slice(0, 3)}{x.mint && <CoinImg mint={x.mint} />}</span>
        <span className="min-w-0 flex-1"><b className="block truncate font-semibold text-ink">{n.symbol ? `$${n.symbol}` : x.mint ? shortAddr(x.mint) : "—"}</b><span className="block truncate text-sm text-muted">{n.name || ""}</span></span>
        <span className={cn("text-sm", x.status === "confirmed" ? "text-up" : x.status === "failed" ? "text-down" : "text-muted")}>{new Date(x.t).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
      </a>
    </li>
  );
}
