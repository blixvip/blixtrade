import { heliusFetch as fetch } from "./heliuskeys.js";
// Holders straight from the chain while a coin's page is open: every token account of the coin, read once
// (getProgramAccounts by mint), then kept current by a subscription to the same accounts (programSubscribe at
// "processed"), so the holder count, top 10 and every wallet's balance move with each trade instead of waiting
// on Jupiter (30 s) or RugCheck (minutes). A holder is a wallet with any of the coin, the way Jupiter and the
// terminals count them; a wallet with several accounts counts once.
//
// The subscription opens before the snapshot is read; changes that arrive meanwhile are held and applied after
// it, newest slot wins, so nothing between the two is lost. Reads go to the per-coin RPC (Helius). Coins over
// BIG holders are left to Jupiter (see BIG); until the first read lands the page shows Jupiter's or RugCheck's.
import { settings } from "./settings.js";
import { coinRpcUrl } from "./txtrade.js";
import { streamSub } from "./chartstream.js";
import { startRpcStream } from "./rpc-stream.js";
import { rpcWsUrl, b58 } from "./livetrades.js";

const PUBLIC = "https://api.mainnet-beta.solana.com";
// A coin with more holders than this is not read from the chain at all: STONK's 106K holders are 262K
// accounts, a 75 MB answer that took 66 s on Helius and timed out on the public RPC, and a live subscription to
// a coin that size would spend the per-coin allowance in hours. Jupiter's figures (10 s) serve those coins.
const BIG = 10_000;
const WAIT_HINT = 10_000;      // how long to wait for a holder count before reading an unknown coin anyway
const IDLE_MS = 90_000;        // a page closed this long: its holders are dropped
const now = () => Date.now();
export const holderStats = { coins: 0, snapshots: 0, updates: 0, errors: 0, lastError: null, lastSnapMs: null };

const coins = new Map();       // mint -> state

// Is a wallet address a real key (on the ed25519 curve) or a program's account (off it)? Pools, bonding
// curves and vault authorities are program addresses; a person's wallet never is. They hold coins without being
// holders in the sense a trader means, and are left out of the top 10. The point's y is in the key; it is on
// the curve when (y² − 1) / (d·y² + 1) has a square root mod p, which Euler's criterion tells.
const P = 2n ** 255n - 19n;
const pow = (b, e) => { let r = 1n; b %= P; while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
const D = (P - 121665n) * pow(121666n, P - 2n) % P;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const curveMemo = new Map();
export function onCurve(addr) {
  const c = curveMemo.get(addr);
  if (c != null) return c;
  let n = 0n;
  for (const ch of addr) { const i = B58.indexOf(ch); if (i < 0) return false; n = n * 58n + BigInt(i); }
  // 32 bytes little-endian: y is the low 255 bits.
  const bytes = []; for (let i = 0; i < 32; i++) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]);
  y &= (1n << 255n) - 1n;
  let ok = false;
  if (y < P) {
    // u/v is a square exactly when u·v is (v ≠ 0 on this curve), so no inverse: one power instead of two,
    // and this ran on every new holder of every open coin (2 s of each 30 on the radar's thread, 2026-10-06).
    const y2 = y * y % P, u = (y2 - 1n + P) % P, v = (D * y2 + 1n) % P;
    ok = u === 0n || pow(u * v % P, (P - 1n) / 2n) === 1n;
  }
  curveMemo.set(addr, ok); if (curveMemo.size > 50_000) curveMemo.clear();
  return ok;
}
const fns = [];
// fn(mint) when a coin's holders changed (at most every 250 ms per coin).
export const onHolders = (fn) => fns.push(fn);
// fn(mint, wallet, tokensDelta, slot) for every change of a person's balance of an open coin (not pools').
function balanceFns() { return (balanceFns.list ||= []); }
export function onBalance(fn) { balanceFns().push(fn); }

async function call(url, method, params, timeout = 90_000) {

  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeout) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

// `m`: the maps to change (the live ones, or a re-read being built). byOwner: owner -> its accounts.
function apply(m, pubkey, owner, amount) {
  const prev = m.accts.get(pubkey);
  if (prev) {
    const left = (m.owners.get(prev[0]) || 0) - prev[1];
    if (left > 1e-9) m.owners.set(prev[0], left); else m.owners.delete(prev[0]);
    m.byOwner.get(prev[0])?.delete(pubkey);
  }
  if (amount > 0) {
    m.accts.set(pubkey, [owner, amount]); m.owners.set(owner, (m.owners.get(owner) || 0) + amount);
    let set = m.byOwner.get(owner); if (!set) m.byOwner.set(owner, (set = new Set())); set.add(pubkey);
  } else m.accts.delete(pubkey);
  m.sorted = null;
}
const maps = () => ({ accts: new Map(), owners: new Map(), byOwner: new Map(), sorted: null });
// A token account's bytes: owner at 32, amount at 64 (the same in Token and Token-2022).
// A closed account (a seller emptying and closing it in one go) arrives with no data: it holds nothing now.
// A subscription filtered by mint never hears an account being closed (it stops matching the filter), which a
// seller emptying it usually does in the same transaction: soldOut() below and the regular re-read cover that.
function onChange(st, pubkey, buf, slot) {
  if (!buf) return;
  if (st.rereading) st.rereading.push([slot, pubkey, buf]);
  if (!st.ready) { st.held.push([slot, pubkey, buf]); return; }
  if (slot != null && slot < (st.slotOf.get(pubkey) ?? -1)) return;
  if (slot != null) st.slotOf.set(pubkey, slot);
  const prev = st.m.accts.get(pubkey);
  if (buf.length < 72) apply(st.m, pubkey, null, 0);
  else apply(st.m, pubkey, b58(buf.subarray(32, 64)), Number(buf.readBigUInt64LE(64)) / st.scale);
  // A real wallet's balance moved: the trade list can show it before the logs say who traded (server.js).
  const owner = st.m.accts.get(pubkey)?.[0] ?? prev?.[0], delta = (st.m.accts.get(pubkey)?.[1] ?? 0) - (prev?.[1] ?? 0);
  if (owner && delta && slot != null && onCurve(owner)) for (const fn of balanceFns()) try { fn(st.mint, owner, delta, slot); } catch {}
  holderStats.updates++;
  changed(st);
}
// A wallet sold (about) all it held: its accounts hold nothing now, whether or not they were closed.
export function soldOut(mint, wallet, tokens) {
  const st = coins.get(mint);
  if (!st?.ready || !wallet) return;
  const had = st.m.owners.get(wallet);
  if (!(had > 0) || tokens < had * 0.99) return;
  for (const pk of [...(st.m.byOwner.get(wallet) || [])]) apply(st.m, pk, wallet, 0);
  changed(st);
}
function changed(st) {
  if (st.tick) return;
  st.tick = setTimeout(() => { st.tick = null; for (const fn of fns) try { fn(st.mint); } catch {} }, 250);
}

async function start(st, hint) {
  try {
    // Which token program holds it, and its decimals.
    const a = await call(coinRpcUrl(), "getAccountInfo", [st.mint, { encoding: "base64", dataSlice: { offset: 44, length: 1 } }], 10_000);
    if (!a?.value) throw new Error("mint not found");
    st.program = a.value.owner; st.scale = 10 ** Buffer.from(a.value.data[0], "base64")[0];
    const sub = [st.program, { encoding: "base64", commitment: "processed", filters: [{ memcmp: { offset: 0, bytes: st.mint } }] }];
    const note = (res) => { const v = res?.value; if (v?.pubkey && v.account?.data?.[0] != null) onChange(st, v.pubkey, Buffer.from(v.account.data[0], "base64"), res.context?.slot ?? null); };
    // On the per-coin socket when there is one, else its own public subscription.
    st.stop = streamSub(`holders:${st.mint}`, "programSubscribe", sub, note)
      || startRpcStream({ url: rpcWsUrl, request: { method: "programSubscribe", params: sub }, silentMs: 300_000, onEvent: (m) => note(m.params?.result) });
    st.hint = hint;
    const { m, slot: snapSlot } = await snapshot(st);
    st.m = m; st.ready = true;
    // What changed while the snapshot was being read.
    for (const [slot, pubkey, buf] of st.held.sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0))) if (snapSlot == null || slot == null || slot > snapSlot) onChange(st, pubkey, buf, slot);
    st.held = [];
    changed(st);
  } catch (e) {
    holderStats.errors++; holderStats.lastError = e.message;
    st.failed = now();
  } finally { st.busy = false; }
}

// Every account of the coin, read whole: { m: maps, slot }.
async function snapshot(st) {
  const t0 = now();
  const url = coinRpcUrl();
  const r = await call(url, "getProgramAccounts", [st.program, { encoding: "base64", commitment: "processed", withContext: true, dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: st.mint } }] }]);
  const list = Array.isArray(r) ? r : r?.value || [];
  const m = maps();
  // Read in slices, yielding between them: a coin with tens of thousands of accounts held the event loop.
  let i = 0;
  for (const x of list) {
    if (++i % 2000 === 0) await new Promise((ok) => setImmediate(ok));
    const b = Buffer.from(x.account.data[0], "base64");
    if (b.length < 40) continue;
    const amount = Number(b.readBigUInt64LE(32)) / st.scale;
    if (amount > 0) apply(m, x.pubkey, b58(b.subarray(0, 32)), amount);
  }
  st.at = now(); st.accounts = list.length;
  holderStats.snapshots++; holderStats.lastSnapMs = now() - t0;
  return { m, slot: Array.isArray(r) ? null : r?.context?.slot ?? null };
}
// Read again now and then (every 20 s for a coin under 10K accounts, 2 min above) to drop the closed accounts
// the subscription cannot hear; changes heard during the read are laid over it.
const REREAD_SMALL = 20_000, REREAD_BIG = 120_000;
async function reread(st) {
  if (st.busy || !st.ready) return;
  st.busy = true; st.rereading = [];
  try {
    const { m, slot: snapSlot } = await snapshot(st);
    for (const [slot, pubkey, buf] of st.rereading) {
      if (snapSlot != null && slot != null && slot <= snapSlot) continue;
      if (buf.length < 72) apply(m, pubkey, null, 0); else apply(m, pubkey, b58(buf.subarray(32, 64)), Number(buf.readBigUInt64LE(64)) / st.scale);
    }
    st.m = m; st.lastRead = now();
    changed(st);
  } catch (e) { holderStats.errors++; holderStats.lastError = e.message; }
  finally { st.rereading = null; st.busy = false; }
}

// The coin's holders from the chain, or null while the first read is on its way (the caller shows another
// source meanwhile). Calling it keeps the coin watched. `hint`: a holder count already known, to choose the RPC.
// { count, top: [[wallet, tokens]] largest first (up to `n`), of(wallet), accounts, at, live }
const asked = new Map();       // mint -> first asked, while its holder count is unknown
export function holdersLive(mint, { hint = 0, n = 100 } = {}) {
  if (hint > BIG) return null;
  if (!hint && !coins.has(mint)) {
    const t = asked.get(mint) ?? (asked.set(mint, now()), now());
    if (asked.size > 500) asked.delete(asked.keys().next().value);
    if (now() - t < WAIT_HINT) return null;
  }
  let st = coins.get(mint);
  if (st?.failed && now() - st.failed > 60_000) { try { st.stop?.(); } catch {} coins.delete(mint); st = null; }
  if (!st) {
    st = { mint, t: now(), m: maps(), slotOf: new Map(), held: [], rereading: null, ready: false, busy: true, scale: 1e6, lastRead: now() };
    coins.set(mint, st); holderStats.coins = coins.size;
    start(st, hint);
  }
  st.t = now();
  if (!st.ready) return null;
  const m = st.m;
  if (!m.sorted || now() - (m.sortedAt || 0) > 250) { m.sorted = [...m.owners].sort((x, y) => y[1] - x[1]).slice(0, 300); m.sortedAt = now(); }
  return { count: m.owners.size, top: m.sorted.slice(0, n), of: (w) => m.owners.get(w) ?? 0, accounts: st.accounts, at: st.at, live: true };
}

setInterval(() => {
  for (const [m, st] of coins) {
    if (now() - st.t > IDLE_MS) { try { st.stop?.(); } catch {} clearTimeout(st.tick); coins.delete(m); continue; }
    if (now() - st.lastRead > ((st.accounts ?? 0) > 10_000 ? REREAD_BIG : REREAD_SMALL)) reread(st);
  }
  holderStats.coins = coins.size;
}, 5_000).unref?.();
