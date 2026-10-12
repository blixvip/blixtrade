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
import { heliusFetch, activeUrl } from "./heliuskeys.js";

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", TOKEN_2022 = "TokenzQdBNbLqP5VYzRBRT44hA3hGMSiYqt6vHu4x5Xm";
const FRESH_MS = 45_000, KEEP = 300, TX_READ = 30;
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
    for (let tries = 0; tries < 3 && !got; tries++) {
      try { got = await heliusBatch(http, part); } catch (e) { if (e.code !== "HELIUS_BUDGET") break; await sleep(800); }
    }
    if (!got) break;
    got.forEach((v, k) => { out[i + k] = v; });
    if (i + 6 < calls.length) await sleep(750);
  }
  // Anything Helius did not answer: the radar's RPC.
  await Promise.all(out.map(async (v, k) => { if (v === undefined) out[k] = await sol.rpc(calls[k][0], calls[k][1]).catch(() => null); }));
  return out;
}
const keyed = () => Boolean(activeUrl());

async function holdings(address) {
  const opt = { encoding: "jsonParsed", commitment: "confirmed" };
  const [lamports, a, b] = await batch([["getBalance", [address, { commitment: "confirmed" }]], ["getTokenAccountsByOwner", [address, { programId: TOKEN }, opt]], ["getTokenAccountsByOwner", [address, { programId: TOKEN_2022 }, opt]]]);
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

async function swaps(address, solUsd) {
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

async function build(address) {
  const solUsd = await solPrice();
  const [who, held, trades, board] = await Promise.all([pumpProfile(address), holdings(address), swaps(address, solUsd), ranks(address)]);
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
  const e = pages.get(address) || { data: null, t: 0, building: null };
  pages.set(address, e);
  if (!e.building) e.building = build(address).then((d) => { e.data = d; e.t = now(); return d; }).finally(() => { e.building = null; });
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
  const d = await rebuild(address);
  return { ...d, read: pages.get(address)?.t ?? now(), updating: false };
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
