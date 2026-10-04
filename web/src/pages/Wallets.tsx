// Trackers / Wallets (#/wallets): the wallets Blix follows, what they just did, and the smart money it found.
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ago, Empty, Kpis, Loading, money, Page, Panel, Problem, Scroll, Tag, td, tdR, th, thR } from "@/components/page";
import { api, post } from "@/lib/api";
import { usePoll } from "@/lib/coin";
import { shortAddr } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Icon } from "@/shell/icons";

type J = any;
const signedUsd = (n: number | null | undefined) => n == null ? "—" : `${n < 0 ? "−" : "+"}${money(Math.abs(n))}`;
const pnlTone = (n: number | null | undefined) => (!n ? "text-ink-2" : n > 0 ? "text-up" : "text-down");
const Who = ({ w, short }: { w: J; short?: boolean }) => <a href={`https://solscan.io/account/${w.address || w.wallet}`} target="_blank" rel="noreferrer" title={w.address || w.wallet} className="hover:text-ink"><b className="font-semibold">{w.label || shortAddr(w.address || w.wallet)}</b>{w.label && !short && <span className="ml-2 text-sm text-muted">{shortAddr(w.address || w.wallet)}</span>}</a>;

export function Wallets() {
  const { data: d, error, refresh } = usePoll<J>("wallets", 8000);
  const [busy, setBusy] = useState(false);
  if (!d) return <Page title="Trackers">{error ? <Problem text={error} /> : <Loading />}</Page>;
  const tr = d.tracking;
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = e.currentTarget, address = String(new FormData(f).get("address") || "").trim();
    setBusy(true);
    try { await post("wallets", { address }); toast("Following wallet"); f.reset(); refresh(); } catch (err) { toast((err as Error).message); }
    setBusy(false);
  };
  const follow = async (address: string) => { try { await post(`wallet/${address}`, { follow: true }); toast("Following wallet"); refresh(); } catch (e) { toast((e as Error).message); } };
  const unfollow = async (address: string) => { if (!confirm("Stop following this wallet and delete its trade history?")) return; try { await api(`wallet/${address}`, { method: "DELETE" }); refresh(); } catch (e) { toast((e as Error).message); } };
  return (
    <Page title="Trackers" sub="Wallets Blix follows trade by trade."
      right={<form onSubmit={add} className="flex gap-2"><input name="address" required pattern="[1-9A-HJ-NP-Za-km-z]{32,44}" placeholder="Wallet address" aria-label="Wallet address to follow"
        className="h-9 w-80 rounded-full border border-rule-2 bg-paper px-3.5 text-md outline-none focus:border-accent-dim max-md:w-52" /><Button size="lg" variant="primary" className="rounded-full" disabled={busy}>Follow</Button></form>}>
      <Kpis items={[
        ["Following", d.wallets.length, `${tr.stream.wallets} on the live stream`],
        ["Live stream", tr.stream.connected ? "Connected" : "Down", `${tr.stream.events.toLocaleString()} events · last ${ago(tr.stream.lastEvent)}`, tr.stream.connected ? "text-up" : "text-down"],
        ["RPC", d.rpc.public ? "Free public" : "Private", `${d.rpc.limited} rate limits · ${d.rpc.errors} errors`, d.rpc.public ? "text-warn" : "text-up"],
        ["Behind", tr.backlog, "wallets waiting to be read"],
        ["Smart wallets found", d.smart.winners, "early in coins that ran"],
      ]} />
      <div className="grid items-start gap-3 grid-cols-[minmax(0,7fr)_minmax(0,5fr)] max-xl:grid-cols-[minmax(0,1fr)]">
        <Panel title="Followed wallets" aside="by realized profit">
          <Scroll><table className="w-full text-md [&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-4 [&_th:first-child]:pl-4"><thead><tr><th className={th}>Wallet</th><th className={thR}>Trades</th><th className={thR}>Realized</th><th className={thR}>Open</th><th className={thR}>Win rate</th><th className={thR}>Last trade</th><th className={th}></th></tr></thead><tbody>
            {d.wallets.length ? [...d.wallets].sort((a: J, b: J) => (b.realized || 0) - (a.realized || 0)).map((w: J) => (
              <tr key={w.address} className="hover:bg-paper-3/60"><td className={td}><span className="flex max-w-64 items-center gap-2"><i title={w.live ? "On the live stream" : "Read on a timer"} className={cn("size-1.5 shrink-0 rounded-full", w.live ? "bg-up" : "bg-paper-5")} /><span className="truncate"><Who w={w} short /></span></span></td>
                <td className={tdR}>{w.trades}</td><td className={cn(tdR, "font-semibold", pnlTone(w.realized))}>{signedUsd(w.realized)}</td><td className={cn(tdR, pnlTone(w.unrealized))}>{signedUsd(w.unrealized)}</td>
                <td className={tdR}>{w.closed ? `${Math.round(w.winRate * 100)}%` : "—"}</td><td className={cn(tdR, "text-muted")}>{ago(w.last_trade)}</td>
                <td className={cn(td, "text-right")}><button onClick={() => unfollow(w.address)} aria-label="Unfollow this wallet" title="Unfollow" className="ml-auto grid size-6 place-items-center rounded-control text-muted hover:bg-paper-4 hover:text-down"><Icon.x className="size-3.5" /></button></td></tr>))
              : <tr><td colSpan={7}><Empty>Not following any wallet yet. Paste an address above.</Empty></td></tr>}
          </tbody></table></Scroll>
        </Panel>
        <Panel title="Just traded" aside="newest first">
          <div className="max-h-[70vh] overflow-y-auto">
            {d.activity.length ? d.activity.map((a: J) => (
              <a key={a.sig} href={`#/coin/${a.mint}`} className="flex items-center gap-3 border-t border-rule px-4 py-2.5 text-md first:border-t-0 hover:bg-paper-3/60">
                <b className={cn("w-9 font-semibold uppercase", a.side === "buy" ? "text-up" : "text-down")}>{a.side}</b>
                <span className="min-w-0 flex-1 truncate"><b className="font-semibold text-ink">{a.symbol || shortAddr(a.mint)}</b> <span className="text-muted">by {a.label || shortAddr(a.wallet)}</span></span>
                <span className="num text-ink-2">{(+a.sol).toFixed(2)} SOL</span><span className="num w-16 text-right text-muted">{ago(a.t).replace(" ago", "")}</span>
              </a>)) : <Empty>No trades seen yet.</Empty>}
          </div>
        </Panel>
      </div>
      <Panel title="Smart money" aside="wallets that were early in coins that ran">
        <Scroll><table className="w-full text-md"><thead><tr><th className={th}>Wallet</th><th className={thR}>Winning coins</th><th className={thR}>Bought early</th><th className={thR}>Score</th><th className={thR}>Last seen</th><th className={th}></th></tr></thead><tbody>
          {d.smart.wallets.map((w: J) => (
            <tr key={w.address} className="hover:bg-paper-3/60"><td className={td}><Who w={w} /></td><td className={tdR}>{w.coins}</td><td className={tdR}>{w.early}</td><td className={cn(tdR, "font-semibold")}>{Math.round(w.score)}</td>
              <td className={cn(tdR, "text-muted")}>{ago(w.last)}</td>
              <td className={cn(td, "text-right")}>{w.watching ? <span className="text-sm text-muted">following</span> : <Button size="sm" onClick={() => follow(w.address)}>Follow</Button>}</td></tr>))}
        </tbody></table></Scroll>
      </Panel>
    </Page>
  );
}
