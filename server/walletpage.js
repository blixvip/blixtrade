// A trader page for any Solana wallet (#/trader/<wallet>): pump.fun's leaderboard traders, Feed callers and anyone
// else Blix has no Fomo profile for. Nothing special is needed, it is all on chain:
//   - who: pump.fun's public profile for the address (name, picture, bio, followers), when they have one;
//   - holdings: the wallet's SOL and every token account (classic and Token-2022), priced from the radar's own
//     coins first and DexScreener for the rest;
//   - trades: the latest swaps, read from its newest transactions (solana.js parseSwaps: one token against SOL or
//     a dollar coin), and from them each position's cost and the best closed trades;
//   - ranks: where it stands on pump.fun's day, week and month boards right now (pumpboard.js).
// Kept per wallet: an open page is answered at once from the last build, which is rebuilt in the background
// once it is older than FRESH_MS (so a page never waits on the chain twice), and the first build is shared by
// everyone who opens it meanwhile.
import { db } from "./db.js";
import * as sol from "./solana.js";
import * as src from "./sources.js";
import { solPrice } from "./wallets.js";
import { pumpBoard, PERIODS } from "./pumpboard.js";
import { heliusFetch, activeUrl, keyUrls, noteBytes } from "./heliuskeys.js";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", TOKEN_2022 = "TokenzQdBNbLqP5VYzRBRT44hA3hGMSiYqt6vHu4x5Xm";
const FRESH_MS = 45_000, KEEP = 300, TX_READ = 30, ENH_READ = 60;
const WSOL = "So11111111111111111111111111111111111111112", USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCdTS8nfrY1";
const PUMP = { origin: "https://pump.fun", referer: "https://pump.fun/", "user-agent": "Mozilla/5.0" };
const now = () => Date.now();
const pages = new Map();   // wallet -> { data, t, building }

export async function pumpProfile(address) {
  try {
    const r = await fetch(`https://frontend-api-v3.pump.fun/users/${address}`, { headers: PUMP, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const u = await r.json();
    return { name: u.username || null, pic: u.profile_image || null, bio: u.bio || null, followers: u.followers ?? null, following: u.following ?? null, x: u.x_username || null,
      joined: u.created_at ? new Date(u.created_at).toISOString() : null };
  } catch { return null; }
}

// Reads go to Helius in small batches when a key has credit left (the chart key's budget, heliuskeys.js, admits
// about 8 calls a second, so 6 at a time, one batch after another). Whatever Helius defers goes to the radar's
// own paced RPC (solana.js).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function heliusBatch(http, calls) {
  const r = await heliusFetch(http, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: "2.0", id, method, params }))) });
  const j = await r.json();
  const out = new Array(calls.length).fill(undefined);
  for (const x of Array.isArray(j) ? j : []) if (x && x.id != null) out[x.id] = x.error ? null : x.result;
  return out;
}
async function batch(calls) {
  const out = new Array(calls.length).fill(undefined);
  const http = activeUrl()?.replace(/^ws/i, "http");
  for (let i = 0; http && i < calls.length; i += 6) {
    const part = calls.slice(i, i + 6);
    let got = null;
    try { got = await heliusBatch(http, part); } catch { /* paced out or down: the radar's own RPC below */ }
    if (!got) break;
    got.forEach((v, k) => { out[i + k] = v; });
    if (i + 6 < calls.length) await sleep(750);
  }
  // Anything Helius did not answer: the radar's RPC.
  await Promise.all(out.map(async (v, k) => { if (v === undefined) out[k] = await sol.rpc(calls[k][0], calls[k][1]).catch(() => null); }));
  return out;
}
const keyed = () => Boolean(activeUrl());

// The three holdings reads straight to the Helius RPC with the key, outside the day's pacing (a wallet page is
// someone waiting; three credits), noted against the budget; the paced batch (and the radar's RPC) if that fails.
async function directBatch(calls) {
  const url = activeUrl() || keyUrls()[0];
  if (!url) return null;
  try {
    const r = await fetch(url.replace(/^ws/i, "http"), { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify(calls.map(([method, params], id) => ({ jsonrpc: "2.0", id, method, params }))) });
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j)) return null;
    noteBytes(url, calls.length * 50_000, "metrics");
    const out = new Array(calls.length).fill(null);
    for (const x of j) if (x && x.id != null) out[x.id] = x.error ? null : x.result;
    return out;
  } catch { return null; }
}
async function holdings(address) {
  const opt = { encoding: "jsonParsed", commitment: "confirmed" };
  const reads = [["getBalance", [address, { commitment: "confirmed" }]], ["getTokenAccountsByOwner", [address, { programId: TOKEN }, opt]], ["getTokenAccountsByOwner", [address, { programId: TOKEN_2022 }, opt]]];
  const [lamports, a, b] = (await directBatch(reads)) || await batch([["getBalance", [address, { commitment: "confirmed" }]], ["getTokenAccountsByOwner", [address, { programId: TOKEN }, opt]], ["getTokenAccountsByOwner", [address, { programId: TOKEN_2022 }, opt]]]);
  const amounts = new Map();
  let wrapped = 0;
  for (const acc of [...(a?.value || []), ...(b?.value || [])]) {
    const info = acc.account?.data?.parsed?.info;
    const ui = +info?.tokenAmount?.uiAmountString || 0;
    if (!info?.mint || ui <= 0) continue;
    if (info.mint === sol.WSOL) wrapped += ui;   // wrapped SOL is SOL
    else amounts.set(info.mint, (amounts.get(info.mint) || 0) + ui);
  }
  return { sol: lamports?.value != null ? lamports.value / 1e9 + wrapped : null, amounts };
}

// Price, symbol, picture and market cap for each mint: the radar's coins first, DexScreener for the rest.
async function priced(mints) {
  const out = new Map(), miss = [];
  const tok = db.prepare("SELECT mint, symbol, name, image, price, mcap FROM tokens WHERE mint = ?");
  for (const m of mints) {
    const t = tok.get(m);
    if (t?.price) out.set(m, { symbol: t.symbol, name: t.name, img: t.image, price: t.price, mcap: t.mcap, change24: null });
    else miss.push(m);
  }
  const dex = await src.dexTokens(miss.slice(0, 120)).catch(() => new Map());
  for (const m of miss) {
    const p = dex.get(m), t = tok.get(m);
    out.set(m, { symbol: p?.baseToken?.symbol || t?.symbol || null, name: p?.baseToken?.name || t?.name || null, img: p?.info?.imageUrl || t?.image || null,
      price: p?.priceUsd ? +p.priceUsd : null, mcap: p?.marketCap || p?.fdv || t?.mcap || null, change24: p?.priceChange?.h24 ?? null });
  }
  return out;
}

// The wallet's latest swaps in ONE call: Helius's parsed transactions (type SWAP, newest first), instead of a
// signature list and a transaction read each (31 calls that crawled through a rate-limited public RPC whenever
// Helius's pacing had the day's RPC allowance spent: a cold page took 42 s on 2026-10-13). 100 credits a call,
// noted against the key's budget. null when there is no key or the call fails: the old path then.
async function enhancedSwaps(address, solUsd) {
  const url = activeUrl() || keyUrls()[0];
  let key = null;
  try { key = url ? new URL(url.replace(/^ws/i, "http")).searchParams.get("api-key") : null; } catch {}
  if (!key) return null;
  let list;
  try {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${key}&type=SWAP&limit=${ENH_READ}`, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    list = await r.json();
    noteBytes(url, 100 * 50_000, "metrics");   // the call's 100 credits, in the budget's own unit (50 KB a credit)
  } catch { return null; }
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const x of list) {
    if (!x || x.transactionError) continue;
    const s = parseEnhanced(x, address);
    if (s) out.push({ ...s, sig: x.signature, usd: s.usd ?? s.sol * solUsd });
  }
  return { list: out.sort((a, b) => b.t - a.t), oldest: list.length ? (list[list.length - 1].timestamp || 0) * 1000 : null };
}
// One parsed transaction as a swap for `wallet` (the same reading as solana.js parseSwaps, from Helius's transfer
// lists): the one coin the wallet's balance moved in, against SOL (native or wrapped) or a dollar coin the other way.
function parseEnhanced(x, wallet) {
  let solMoved = 0, stable = 0;
  const tokens = new Map();
  for (const t of x.tokenTransfers || []) {
    const sign = t.toUserAccount === wallet ? 1 : t.fromUserAccount === wallet ? -1 : 0;
    if (!sign) continue;
    const v = (Number(t.tokenAmount) || 0) * sign;
    if (t.mint === WSOL) solMoved += v; else if (t.mint === USDC || t.mint === USDT) stable += v; else tokens.set(t.mint, (tokens.get(t.mint) || 0) + v);
  }
  for (const n of x.nativeTransfers || []) {
    const sign = n.toUserAccount === wallet ? 1 : n.fromUserAccount === wallet ? -1 : 0;
    if (sign) solMoved += (sign * (Number(n.amount) || 0)) / 1e9;
  }
  const moved = [...tokens].filter(([, d]) => Math.abs(d) > 0);
  if (moved.length !== 1) return null;
  const [mint, d] = moved[0], side = d > 0 ? "buy" : "sell";
  const quoteSol = Math.abs(solMoved) > 0.0005 ? Math.abs(solMoved) : 0, quoteUsd = Math.abs(stable) > 0.01 ? Math.abs(stable) : 0;
  if (!quoteSol && !quoteUsd) return null;
  if (side === "buy" && solMoved > 0.0005 && !quoteUsd) return null;
  if (side === "sell" && solMoved < -0.0005 && !quoteUsd) return null;
  return { mint, side, tokens: Math.abs(d), sol: quoteSol, usd: quoteUsd || null, t: (x.timestamp || 0) * 1000 };
}

async function swaps(address, solUsd) {
  const fast = await enhancedSwaps(address, solUsd);
  if (fast) return fast;
  const n = keyed() ? TX_READ : 10;
  const [sigs] = await batch([["getSignaturesForAddress", [address, { limit: n }]]]);
  const ok = (sigs || []).filter((s) => !s.err).slice(0, n);
  const out = [];
  const txs = await batch(ok.map((x) => ["getTransaction", [x.signature, { maxSupportedTransactionVersion: 1, encoding: "jsonParsed", commitment: "confirmed" }]]));
  txs.forEach((tx, k) => {
    for (const s of sol.parseSwaps(tx, address)) out.push({ ...s, sig: ok[k].signature, usd: s.usd ?? s.sol * solUsd });
  });
  return { list: out.sort((a, b) => b.t - a.t), oldest: ok.length ? (ok[ok.length - 1].blockTime || 0) * 1000 : null };
}

async function ranks(address) {
  const res = {};
  await Promise.all(Object.keys(PERIODS).map(async (r) => {
    try {
      const b = await pumpBoard({ range: r });
      const row = b.rows.find((x) => x.wallet === address);
      res[r] = row ? { rank: row.rank, pnl: row.pnl, pct: row.pnlPct, realized: row.realized, unrealized: row.unrealized, name: row.name, pic: row.pic, x: row.x } : null;
    } catch { res[r] = null; }
  }));
  return res;
}

// `onPartial(page)`: called as soon as the wallet's SOL and holdings are priced (one batched read, well under a
// second), with the page as far as it goes then (no trades, costs, best trades or ranks yet; `partial: true`), so an
// opened page shows what the wallet holds at once while the slower reads (its transactions, pump.fun's profile and
// boards) finish behind it.
async function build(address, onPartial = null) {
  const solUsd = await solPrice();
  const heldP = holdings(address);
  const whoP = pumpProfile(address), tradesP = swaps(address, solUsd), boardP = ranks(address);
  if (onPartial) {
    heldP.then(async (held) => {
      const info = await priced([...held.amounts.keys()]);
      const positions = [...held.amounts].map(([mint, amt]) => { const i = info.get(mint) || {}; return { mint, symbol: i.symbol || null, name: i.name || null, img: i.img || null, amount: amt, price: i.price ?? null, value: i.price != null ? amt * i.price : null, mcap: i.mcap ?? null, change24: i.change24 ?? null, cost: null, entry: null, since: null }; })
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 200);
      const tokensUsd = positions.reduce((s, p) => s + (p.value ?? 0), 0);
      onPartial({ wallet: address, name: null, pic: null, bio: null, x: null, followers: null, following: null, joined: null, solUsd, sol: held.sol, value: (held.sol ?? 0) * solUsd + tokensUsd, tokensUsd,
        positions, best: [], recent: [], readSince: null, volume: 0, tradesRead: 0, ranks: {}, partial: true });
    }).catch(() => {});
  }
  const [who, held, trades, board] = await Promise.all([whoP, heldP, tradesP, boardP]);
  const mints = [...new Set([...held.amounts.keys(), ...trades.list.map((s) => s.mint)])];
  const info = await priced(mints);
  // What the trades Blix read say about each coin: bought and sold, in dollars and tokens.
  const flow = new Map();
  for (const s of trades.list) {
    const f = flow.get(s.mint) || { bought: 0, sold: 0, tBought: 0, tSold: 0, first: s.t, last: s.t };
    if (s.side === "buy") { f.bought += s.usd; f.tBought += s.tokens; } else { f.sold += s.usd; f.tSold += s.tokens; }
    f.first = Math.min(f.first, s.t); f.last = Math.max(f.last, s.t);
    flow.set(s.mint, f);
  }
  const positions = [...held.amounts].map(([mint, amt]) => {
    const i = info.get(mint) || {}, f = flow.get(mint), value = i.price != null ? amt * i.price : null;
    // Cost only when every token held was bought in the trades read (otherwise it would be a guess).
    const cost = f && f.tBought > 0 && f.tBought - f.tSold >= amt * 0.98 ? (f.bought * amt) / f.tBought : null;
    return { mint, symbol: i.symbol || null, name: i.name || null, img: i.img || null, amount: amt, price: i.price ?? null, value, mcap: i.mcap ?? null, change24: i.change24 ?? null,
      cost, entry: cost != null && amt ? cost / amt : null, since: f ? new Date(f.first).toISOString() : null };
  }).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 200);
  // Closed or partly closed trades with both legs in what was read: realized profit on what was sold.
  const best = [...flow].filter(([, f]) => f.tBought > 0 && f.tSold > 0).map(([mint, f]) => {
    const i = info.get(mint) || {}, soldCost = (f.bought * Math.min(f.tSold, f.tBought)) / f.tBought;
    const pnl = f.sold - soldCost;
    return { mint, symbol: i.symbol || null, img: i.img || null, pnl, cost: soldCost, closed: held.amounts.has(mint) ? null : new Date(f.last).toISOString() };
  }).sort((a, b) => b.pnl - a.pnl).slice(0, 5);
  const tokensUsd = positions.reduce((s, p) => s + (p.value ?? 0), 0);
  const top = Object.values(board).find(Boolean);
  return {
    wallet: address,
    name: who?.name || top?.name || null, pic: who?.pic || top?.pic || null, bio: who?.bio || null, x: who?.x || top?.x || null,
    followers: who?.followers ?? null, following: who?.following ?? null, joined: who?.joined || null,
    solUsd, sol: held.sol, value: (held.sol ?? 0) * solUsd + tokensUsd, tokensUsd,
    positions, best,
    recent: trades.list.slice(0, 60).map((s) => ({ t: s.t, side: s.side, mint: s.mint, tokens: s.tokens, usd: s.usd, sol: s.sol, sig: s.sig, symbol: info.get(s.mint)?.symbol || null, img: info.get(s.mint)?.img || null })),
    readSince: trades.oldest, volume: trades.list.reduce((s, x) => s + (x.usd || 0), 0), tradesRead: trades.list.length,
    ranks: board,
  };
}

function rebuild(address) {
  const e = pages.get(address) || { data: null, t: 0, building: null, partial: null };
  pages.set(address, e);
  if (!e.building) {
    // The first build of a page: its holdings are shown the moment they are read (partial), the rest when it is done.
    let gotPartial;
    e.partial = e.data ? null : new Promise((res) => { gotPartial = res; });
    e.building = build(address, e.data ? null : (d) => { if (!e.data) { e.data = d; e.t = now(); } gotPartial?.(d); }).then((d) => { e.data = d; e.t = now(); return d; })
      .finally(() => { e.building = null; e.partial = null; gotPartial?.(null); });
  }
  if (pages.size > KEEP) for (const [k, v] of pages) { if (!v.building && k !== address) { pages.delete(k); break; } }
  return e.building;
}

// GET /api/wallet-page/<wallet>[?fresh=1]: the page, at once when there is one to show.
export async function walletPage(address, { fresh = false } = {}) {
  if (!sol.validAddress(address)) throw Object.assign(new Error("That isn't a Solana wallet."), { status: 400 });
  const e = pages.get(address);
  if (e?.data) {
    if (fresh || now() - e.t > FRESH_MS) rebuild(address).catch(() => {});
    return { ...e.data, read: e.t, updating: Boolean(pages.get(address)?.building) };
  }
  // Nothing built yet: answer with the holdings as soon as they are read (the page polls for the rest), else the whole page.
  const built = rebuild(address), p = pages.get(address);
  const d = await (p?.partial ? Promise.race([built, p.partial.then((x) => x || built)]) : built);
  return { ...d, read: pages.get(address)?.t ?? now(), updating: Boolean(pages.get(address)?.building) };
}

// Warm the pages of the wallets on a board (the top few), so opening one from the leaderboard is instant.
const warmed = new Map();
export function warmWalletPages(addresses) {
  for (const a of addresses.slice(0, 3)) {
    if (!sol.validAddress(a) || now() - (warmed.get(a) || 0) < 10 * 60_000) continue;
    warmed.set(a, now());
    rebuild(a).catch(() => {});
  }
}
