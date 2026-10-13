// Your position in one coin, worked out once for the page and read by the Position card, the instant trade
// panel and the chart's average buy and sell lines: the paper one while Paper is on, the real wallet's while
// it is off. Averages are per token (all SOL paid over all tokens bought), the way Axiom and GMGN show them.
import { useEffect } from "react";
import { usePoll, type CoinData, type Paper, type TokenDetail } from "@/lib/coin";
import { useTrade } from "@/lib/mode";
import { usePulse } from "@/lib/pulse";
import { useMe } from "@/lib/ui";
import { markValue } from '@/lib/position-value';
import { useFeeBps } from "@/components/ShareLink";

interface RealTx { kind: string; mint: string | null; sol: number | null; tokens: string | null; status: string; t: number }
export interface OwnTrade { t: number; side: "buy" | "sell"; sol: number | null }   // a live trade, for the chart's B / S bubbles
export interface Pos {
  paper: boolean;            // whose position this is: the paper wallet's, or the signed-in wallet's
  has: boolean;              // any trade in this coin
  bought: number; sold: number;
  holding: number | null;    // what is still held is worth now, in SOL (null: no live price)
  pnl: number | null;        // sold + holding − bought, in SOL
  entry: number | null;      // average market cap bought at
  exit: number | null;       // average market cap sold at (null before the first sell)
  mcapNow: number | null;
  open: Paper[];             // paper: the open rows (a sell goes through each)
  tokens: number | null;     // tokens held (paper: quoted rows only; real: the wallet's)
  canSell: boolean;
  estimated: boolean;
  trades: OwnTrade[];        // live: the wallet's buys and sells in this coin (paper rows carry their own)
}

export function usePosition(mint: string, r: TokenDetail | null, c: CoinData | null): Pos {
  const paper = useTrade((st) => st.paper), me = useMe((st) => st.me);
  const feeRate = useFeeBps() / 10_000;   // Blix's fee, inside every live trade's SOL figure
  const txs = usePoll<RealTx[]>(!paper && me?.signedIn ? "account/txs" : null, 5_000);
  const walletKey = me?.signedIn ? `${me.wallet?.sol}:${me.wallet?.tokens?.length}` : "";
  useEffect(() => { if (!paper && walletKey) txs.refresh(); }, [paper, walletKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const mcapNow = c?.mcUsd ?? r?.live?.mcap ?? r?.token?.mcap ?? null;
  const solUsd = usePulse(st => st.live.solUsd) || c?.solUsd || (me?.wallet && me.wallet.sol > 0 && me.wallet.solUsd ? me.wallet.solUsd / me.wallet.sol : 0);
  const pos: Pos = { paper, has: false, bought: 0, sold: 0, holding: 0, pnl: null, entry: null, exit: null, mcapNow, open: [], tokens: null, canSell: false, estimated: false, trades: [] };
  if (paper) {
    // A partial sell splits a row: the sold part becomes a closed row with the same entry, so summing every
    // row counts each buy once. Tokens per row are SOL over entry market cap (the same units throughout).
    const ps = r?.paper || [], open = ps.filter((p) => p.status === "open");
    const valueOf = (p: Paper) => (p.status === 'open' ? markValue(p.tokens, c?.priceUsd, solUsd, c?.priceAgeMs) : null) ?? p.valueSol ?? (p.mult != null ? p.sol * p.mult : null);
    pos.open = open;
    pos.bought = ps.reduce((a, p) => a + (p.sol || 0), 0);
    pos.sold = ps.filter((p) => p.status === "closed").reduce((a, p) => a + (p.exit_sol ?? valueOf(p) ?? 0), 0);
    pos.holding = open.every((p) => valueOf(p) != null) ? open.reduce((a, p) => a + (valueOf(p) || 0), 0) : null;
    pos.tokens = open.length && open.every((p) => (p.tokens || 0) > 0) ? open.reduce((a, p) => a + (p.tokens || 0), 0) : null;
    pos.has = ps.length > 0;
    pos.canSell = open.length > 0;
    pos.estimated = open.length > 0;
    const w = (p: Paper) => (p.sol > 0 && (p.mcap0 || 0) > 0 ? p.sol / (p.mcap0 as number) : 0);
    const bw = ps.reduce((a, p) => a + w(p), 0), paid = ps.reduce((a, p) => a + (w(p) ? p.sol : 0), 0);
    pos.entry = bw ? paid / bw : null;
    const sells = ps.filter((p) => p.status === "closed" && (p.exit_mcap || 0) > 0 && w(p));
    const sw = sells.reduce((a, p) => a + w(p), 0);
    pos.exit = sw ? sells.reduce((a, p) => a + w(p) * (p.exit_mcap as number), 0) / sw : null;
  } else {
    const list = (Array.isArray(txs.data) ? txs.data : []).filter(t => t.mint === mint && t.status !== "failed" && (t.kind === "buy" || t.kind === "sell"));
    const raw = (t: RealTx) => Number(t.tokens) || 0;
    const buys = list.filter((t) => t.kind === "buy"), sells = list.filter((t) => t.kind === "sell");
    pos.bought = buys.reduce((a, t) => a + (t.sol || 0), 0); pos.sold = sells.reduce((a, t) => a + (t.sol || 0), 0);
    const boughtRaw = buys.reduce((a, t) => a + raw(t), 0), soldRaw = sells.reduce((a, t) => a + raw(t), 0), heldRaw = boughtRaw - soldRaw;
    const held = me?.wallet?.tokens?.find((x) => x.mint === mint);
    pos.holding = !held ? Array.isArray(me?.wallet?.tokens) ? 0 : null
      : markValue(held.ui, c?.priceUsd, solUsd, c?.priceAgeMs) ?? (held.usd != null && solUsd ? held.usd / solUsd : null);
    pos.estimated = Boolean(held && held.ui > 0);
    pos.tokens = held?.ui ?? (Array.isArray(me?.wallet?.tokens) ? 0 : null);
    pos.has = list.length > 0 || Boolean(held);
    pos.canSell = (held?.ui ?? 0) > 0;
    pos.trades = list.filter((t) => t.t > 0).map((t) => ({ t: t.t, side: t.kind as "buy" | "sell", sol: t.sol }));
    // The averages as market caps: SOL paid (or got) per token, times the SOL price, times the supply. The vault
    // reports tokens in raw units; the wallet's own figure (ui) gives the decimals when both are there and agree
    // on a power of ten, otherwise pump.fun's six. This holds after selling out too (nothing held to divide by).
    const supply = c?.supply && c.supply > 0 ? c.supply : null;
    const derived = held && held.ui > 0 && heldRaw > 0 ? Math.log10(heldRaw / held.ui) : null;
    const rawPerUi = derived != null && Math.abs(derived - Math.round(derived)) < 0.05 ? 10 ** Math.round(derived) : 1e6;
    // A buy's SOL figure includes Blix's fee and a sell's is net of it: the averages are at the market, so the fee
    // comes off a buy (and goes back on a sell) before the SOL meets the tokens. Otherwise the buy line sat a fee
    // above where the coin was bought (the user, 2026-10-12: "presenting the line at the wrong market cap").
    const capOf = (sol: number, raw: number) => (sol > 0 && raw > 0 && solUsd > 0 && supply ? (sol / raw) * rawPerUi * solUsd * supply : null);
    pos.entry = capOf(pos.bought * (1 - feeRate), boughtRaw);
    pos.exit = capOf(pos.sold / (1 - feeRate), soldRaw);
    // Without a supply or a SOL price: what was paid per token against what a token is worth now, on the cap now.
    const nowPer = pos.holding && heldRaw > 0 ? pos.holding / heldRaw : null;
    if (mcapNow && nowPer) {
      if (pos.entry == null && pos.bought && boughtRaw) pos.entry = (mcapNow * (pos.bought / boughtRaw)) / nowPer;
      if (pos.exit == null && pos.sold && soldRaw) pos.exit = (mcapNow * (pos.sold / soldRaw)) / nowPer;
    }
  }
  pos.pnl = pos.has && pos.holding != null ? pos.sold + pos.holding - pos.bought : null;
  return pos;
}
