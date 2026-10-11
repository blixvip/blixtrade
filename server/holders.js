import { heliusFetch as fetch } from "./heliuskeys.js";
// Holders: a live ledger for every pump.fun coin, built from the trade feed and nothing else.
// Every TradeEvent says who traded, how many tokens and in which block, so for a coin whose first
// trade the radar saw it knows, this second: who holds what (holders, top-10 share), what the dev
// bought and whether the dev has sold, who sniped the first blocks and whether they are still in, and
// how much was bought in the launch block itself (a bundle). Axiom and GMGN show these from their own
// indexers; here they come free from the same websocket that prices the Pulse page.
//
// Honesty rules: a coin whose first trade was missed (the radar started after it launched, or the
// socket dropped messages) is marked partial, and the sniper/bundle figures are not shown for it.
// A partial book on the Pulse page is seeded once from the chain (every token account of the coin, one
// getProgramAccounts on the public RPC): from then on its holders and top 10 are the chain's, kept current
// by the trades. The ledger also follows a coin into its PumpSwap pool (livetrades.js recordPoolTrade).
import fs from "node:fs";
import path from "node:path";
import { DATA, db, json } from "./db.js";
import * as jupdisc from "./jupdisc.js";
import { settings } from "./settings.js";
import { onLiveTrade, onPoolLedger, feed, b58 } from "./livetrades.js";
import { launchIndex } from "./engine.js";
import { onCurve } from "./holderslive.js";
import { recordLaunch } from "./snipe.js";
import { knownSupply } from "./jup.js";

const SUPPLY = 1e9;                      // every pump.fun coin
const CURVE_TOKENS = 793_100_000;        // tokens sold along the curve before it completes
const SNIPE_SLOTS = 2;                   // bought within this many blocks of the first trade = sniper
const SNIPE_MS = 1500;                   // or within this long, when the block number is missing
const MAX_WALLETS = 2500;                // per coin; beyond this new wallets are counted, not kept
const MAX_BOOKS = 3000;
const QUIET = 30 * 60_000;               // books for coins quiet this long are dropped
const now = () => Date.now();

export const books = new Map();          // mint -> book
export const holderStats = { books: 0, wallets: 0, trades: 0, genesis: 0, partial: 0, unknownSells: 0, seeded: 0, seedFails: 0, seedBig: 0, lastSeedMs: null, lastSeedError: null, seedQueue: 0 };

function book(mint) {
  let b = books.get(mint);
  if (!b) {
    b = { mint, t0: now(), slot0: null, genesis: false, trades: 0, last: 0, unknownSells: 0, over: 0,
      bal: new Map(), snipers: new Set(), bundle: new Set(), sum: null, sumT: 0 };
    books.set(mint, b);
  }
  return b;
}

// Transactions already put in a ledger from a block (lateTrade below): a live copy that comes after is not counted
// again (balances would double). Two generations, like livetrades.js sigGate.
let lateCur = new Set(), lateOld = new Set();
function onTrade(mint, s, sol, buy, x) {
  if (!x || !x.user || !(x.tokens >= 0)) return;
  if (x.sig && (lateCur.has(x.sig + mint) || lateOld.has(x.sig + mint))) return;
  const t = now();
  let b = books.get(mint);
  if (!b) {
    b = book(mint);
    b.slot0 = x.slot ?? null;
    // The first trade of a curve starts from zero tokens sold: if this trade began there, the radar has
    // the coin from its very first block and the ledger below is complete.
    const soldAfter = (s.progress || 0) * CURVE_TOKENS;
    const soldBefore = soldAfter - (buy ? x.tokens : -x.tokens);
    b.genesis = buy && soldBefore < 2_000_000;
    if (b.genesis) holderStats.genesis++; else holderStats.partial++;
  }
  b.trades++; b.last = t; holderStats.trades++;
  saveLaunch(mint, b, x.slot, t);
  let w = b.bal.get(x.user);
  if (!w) {
    if (b.bal.size >= MAX_WALLETS) { b.over++; b.sum = null; return; }
    w = { b: 0, max: 0, in: 0, out: 0, n: 0, first: t, slot: x.slot ?? null };
    b.bal.set(x.user, w);
    // Classified on their first trade only: a wallet is a sniper or bundler by when it first bought.
    if (b.genesis && buy) {
      const creator = launchIndex.get(mint)?.creator;
      const sameBlock = b.slot0 != null && x.slot != null ? x.slot === b.slot0 : t - b.t0 < 400;
      const early = b.slot0 != null && x.slot != null ? x.slot - b.slot0 <= SNIPE_SLOTS : t - b.t0 <= SNIPE_MS;
      if (x.user !== creator) { if (sameBlock && b.bal.size > 1) b.bundle.add(x.user); else if (early) b.snipers.add(x.user); }
    }
  }
  w.n++;
  if (buy) { w.b += x.tokens; w.in += sol; if (w.b > w.max) w.max = w.b; }
  else {
    // Selling more than the ledger saw bought: those tokens were bought before the radar was listening.
    if (x.tokens > w.b + 1) { b.unknownSells++; holderStats.unknownSells++; }
    w.b = Math.max(0, w.b - x.tokens); w.out += sol;
  }
  b.sum = null;
}

// A trade the live feed skipped, found seconds later in a block (journalfeed.js): into the coin's ledger when the
// radar keeps one (a coin it never saw is not started from a trade in the middle of its life).
export function lateTrade(mint, { sol, buy, user, tokens, slot = null, sig = null }) {
  if (!books.has(mint) || !user || !(tokens >= 0)) return;
  onTrade(mint, { progress: 1 }, sol, buy, { user, tokens, slot, sig: null });
  if (sig) { lateCur.add(sig + mint); if (lateCur.size >= 100_000) { lateOld = lateCur; lateCur = new Set(); } }
  holderStats.late = (holderStats.late || 0) + 1;
}

// A book that cannot vouch for its holder count: it missed the coin's first trades, saw tokens sold that it never
// saw bought (a transfer, or a dropped message), or has more wallets than it keeps. Seeded from the chain, only
// the last still counts (the chain said what every wallet held).
const isPartial = (b) => b.seeded ? b.over > 0 : !b.genesis || b.unknownSells > 0 || b.over > 0;

// A tagged, sorted picture of one coin's holders, computed at most once a second per coin.
export function holdersFor(mint, { top = 10 } = {}) {
  const b = books.get(mint);
  if (!b) return null;
  if (b.sum && now() - b.sumT < 400) return b.sum;
  const creator = launchIndex.get(mint)?.creator || null;
  const held = [];
  let holders = 0;
  for (const [wallet, w] of b.bal) if (w.b > 0.5) { holders++; held.push([wallet, w]); }
  held.sort((a, c) => c[1].b - a[1].b);
  // Shares of the coin's own supply when Jupiter has said it (a coin that is not pump.fun's 1B), else of 1B.
  const sup = knownSupply(mint) || SUPPLY;
  const pct = (tokens) => +((tokens / sup) * 100).toFixed(2);
  const top10 = pct(held.slice(0, 10).reduce((s_, [, w]) => s_ + w.b, 0));
  const tag = (wallet) => wallet === creator ? "dev" : b.bundle.has(wallet) ? "bundle" : b.snipers.has(wallet) ? "sniper" : null;
  const list = held.slice(0, top).map(([wallet, w]) => ({ wallet, pct: pct(w.b), sol: +(w.in - w.out).toFixed(3), trades: w.n, tag: tag(wallet) }));
  const dev = creator ? b.bal.get(creator) : null;
  // "sold" is relative to the most the dev ever held: all = under 2% of it left, part = under half left.
  const devSold = dev && dev.max > 0 ? (dev.b < dev.max * 0.02 ? "all" : dev.b < dev.max * 0.5 ? "part" : null) : null;
  const group = (set) => {
    let tokens = 0, sold = 0, max = 0;
    for (const wallet of set) { const w = b.bal.get(wallet); if (!w) continue; tokens += w.b; max += w.max; if (w.b < w.max * 0.1) sold++; }
    return { n: set.size, pct: pct(tokens), maxPct: pct(max), sold };
  };
  b.sum = {
    holders, top10, top: list, trades: b.trades, since: b.t0, last: b.last, genesis: b.genesis, seeded: b.seeded || null, partial: isPartial(b),
    dev: creator ? { wallet: creator, pct: dev ? pct(dev.b) : 0, maxPct: dev ? pct(dev.max) : 0, sol: dev ? +(dev.in - dev.out).toFixed(3) : 0, sold: devSold, seen: Boolean(dev) } : null,
    snipers: b.genesis ? group(b.snipers) : null, bundle: b.genesis ? group(b.bundle) : null,
  };
  b.sumT = now();
  return b.sum;
}

// The short form a Pulse row carries (and the live push updates): holders, top-10 %, dev % and whether
// the dev sold, sniper % and bundle % of supply still held. Null where the ledger cannot say.
export function rowHolders(mint) {
  const h = holdersFor(mint);
  if (!h) return null;
  return { h: h.holders, t10: h.top10, dev: h.dev?.seen ? h.dev.pct : null, ds: h.dev?.sold || null, devSol: h.dev?.seen ? h.dev.sol : null,
    sn: h.snipers ? h.snipers.pct : null, snN: h.snipers ? h.snipers.n : null, snOut: h.snipers ? h.snipers.sold : null,
    bd: h.bundle ? h.bundle.pct : null, bdN: h.bundle ? h.bundle.n : null, p: h.partial };
}
// Positional form for the 200ms live push: [holders, top10, devPct, devSold(0 none/1 part/2 all), snipersPct, bundlePct].
export function liveHolders(mint) {
  const r = rowHolders(mint);
  if (!r) return [];
  return [r.h, r.t10, r.dev, r.ds === "all" ? 2 : r.ds === "part" ? 1 : 0, r.sn, r.bd];
}

// A book that saw the coin's first trade knows its snipers and bundle for good once the sniping window has passed:
// handed to snipe.js, which keeps them after this book is dropped and keeps what they hold current.
function saveLaunch(mint, b, slot, t) {
  if (!b.genesis || b.launchSaved) return;
  const past = b.slot0 != null && slot != null ? slot > b.slot0 + SNIPE_SLOTS : t - b.t0 > SNIPE_MS * 3;
  if (!past) return;
  b.launchSaved = true;
  try { recordLaunch(mint, { snipers: b.snipers, bundle: b.bundle, dev: launchIndex.get(mint)?.creator || null, slot: b.slot0 }); } catch {}
}

// Coins that went quiet are forgotten; the newest books win when there are too many.
function prune() {
  const t = now();
  for (const [m, b] of books) if (b.genesis && !b.launchSaved && t - b.t0 > SNIPE_MS * 3) saveLaunch(m, b, null, t);
  for (const [m, b] of books) if (t - b.last > QUIET) books.delete(m);
  if (books.size > MAX_BOOKS) for (const [m] of [...books].sort((a, c) => a[1].last - c[1].last).slice(0, books.size - MAX_BOOKS)) books.delete(m);
  let wallets = 0;
  for (const b of books.values()) wallets += b.bal.size;
  holderStats.books = books.size; holderStats.wallets = wallets;
}

// The ledger only exists in memory. It is written to disk every 10 seconds and read back after a restart
// within two minutes, so a crash does not turn every coin's holders into "unknown".
const STATE_FILE = path.join(DATA, "holders-state.json");
const RESUME_MS = 2 * 60_000;
export const restored = { books: 0 };
let saving = false;
async function saveState() {
  if (saving || !books.size) return;
  saving = true;
  try {
    // Written a few books at a time: turning the whole ledger (tens of thousands of wallets) into text in
    // one go held the radar up for most of a second, every time.
    const out = [], t = now();
    let n = 0;
    for (const b of books.values()) {
      if (t - b.last >= QUIET) continue;
      out.push(JSON.stringify({ ...b, sum: undefined, seeding: undefined, seedFail: undefined, bal: [...b.bal], snipers: [...b.snipers], bundle: [...b.bundle] }));
      if (++n % 40 === 0) await new Promise((go) => setImmediate(go));
    }
    await fs.promises.writeFile(STATE_FILE + ".tmp", `{"t":${t},"books":[${out.join(",")}]}`);
    await fs.promises.rename(STATE_FILE + ".tmp", STATE_FILE);
  } catch {} finally { saving = false; }
}
export function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!(now() - j.t < RESUME_MS)) return;
    for (const b of j.books) books.set(b.mint, { ...b, sum: null, sumT: 0, seeding: false, seedFail: 0, bal: new Map(b.bal), snipers: new Set(b.snipers), bundle: new Set(b.bundle) });
    restored.books = books.size;
  } catch {}
}

// Exposed for tests: feed one trade by hand, seed one book from a (mock) RPC.
export const _onTrade = onTrade;
export const _seedBook = seedBook;

// ---------- seeding a partial book from the chain ----------
// Every token account of the coin, read once on the public RPC (free; it indexes the token program by mint,
// and the answer for a coin with a few hundred holders is tens of KB). Pools and the bonding curve itself are
// program addresses (off the ed25519 curve), not holders, and are left out; a wallet with dust is taken as a
// person without the check (the check is the costly part). Coins past SEED_MAX wallets are left to RugCheck.
const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";
const SEED_MAX = 6000;
const SEED_GAP = 2500;           // one read every 2.5 s at most (the public RPC's allowance is shared with the feeds)
const SEED_RETRY = 60_000;       // a mint the node does not know yet (seconds old): asked again after this
const SEED_WANT_MS = 30_000;     // a page that stopped asking: its coins are not read
const RESEED_MS = 90_000;        // an open coin page's book is read again this often (balances drift on missed trades)
const wantSeed = new Map();      // mint -> when a page last showed it
let seedBusy = false, seedLast = 0;
// Coins on a page right now (pulse.js `watched`): the partial ones among them are seeded, busiest first.
export function seedWanted(mints) {
  const t = now();
  for (const m of mints) {
    const b = books.get(m);
    if (!b || !isPartial(b) || b.seeded || b.seeding || (b.seedFail || 0) >= 2 || t < (b.seedAfter || 0)) continue;
    wantSeed.set(m, t);
  }
  holderStats.seedQueue = wantSeed.size;
}
// Coins whose page is open right now (server.js chartFocus): a book seeded more than RESEED_MS ago is read from the
// chain again, so the holder list and top-10 share stay what the chain says while someone looks at them. The free log
// sockets miss a share of trades, and a book moved only by trades drifted (ZPAD, 2026-10-11: top wallet 19% drawn, 8%
// on chain). Genesis books too: their sniper/bundle sets stay, only balances are set.
export function reseedWanted(mints) {
  const t = now();
  for (const m of mints) {
    const b = books.get(m);
    if (!b || b.seeding || (b.seedFail || 0) >= 2 || t < (b.seedAfter || 0)) continue;
    if (b.seeded && t - b.seeded < RESEED_MS) continue;
    if (!b.seeded && !isPartial(b) && t - b.t0 < RESEED_MS) continue;   // a genesis book minutes old is exact
    b.reseed = true; wantSeed.set(m, t);
  }
  holderStats.seedQueue = wantSeed.size;
}
async function seedOne() {
  if (seedBusy || now() - seedLast < SEED_GAP || !wantSeed.size) return;
  const t = now();
  let pick = null;
  for (const [m, at] of wantSeed) {
    const b = books.get(m);
    if (!b || t - at > SEED_WANT_MS || (!b.reseed && (b.seeded || !isPartial(b))) || (b.seedFail || 0) >= 2 || t < (b.seedAfter || 0)) { wantSeed.delete(m); continue; }
    // An open coin page (reseedWanted) goes before the board: its holders are being looked at right now.
    if (!pick || (Boolean(b.reseed) !== Boolean(pick.reseed) ? b.reseed : b.trades > pick.trades)) pick = b;
  }
  holderStats.seedQueue = wantSeed.size;
  if (!pick) return;
  // A coin already known to have more holders than SEED_MAX (Jupiter's or RugCheck's count) is not read at all:
  // its answer would be megabytes for nothing.
  if (holdersHint(pick.mint) > SEED_MAX) { pick.seedFail = 9; holderStats.seedBig++; wantSeed.delete(pick.mint); return; }
  seedBusy = true; seedLast = t; pick.seeding = true; wantSeed.delete(pick.mint);
  try {
    await seedBook(pick);
  } catch (e) {
    pick.seedFail = (pick.seedFail || 0) + 1; holderStats.seedFails++; holderStats.lastSeedError = e.message;
    // The public RPC's allowance is shared with the feeds: a limit hit rests the reads for a while (the coin is retried).
    if (/rate limit|429|too many/i.test(e.message)) { seedLast = now() + 20_000; pick.seedFail--; }
    // A coin seconds old is not on the node yet: not a failure, just asked again a minute later.
    else if (/mint not found/.test(e.message)) { pick.seedFail--; pick.seedAfter = now() + SEED_RETRY; }
  } finally { pick.seeding = false; pick.reseed = false; seedBusy = false; }
}
const hintQ = db.prepare("SELECT safety FROM tokens WHERE mint = ?");
function holdersHint(mint) {
  let n = jupdisc.figures(mint)?.holders || 0;
  try { n = Math.max(n, json(hintQ.get(mint)?.safety)?.totalHolders || 0); } catch {}
  return n;
}
async function rpcCall(url, method, params, timeout = 25_000) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeout) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}
async function seedBook(b) {
  const t0 = now();
  const url = String(settings.rpcUrl || "").trim() || PUBLIC_RPC;
  // Which token program holds the coin (pump.fun mints are Token-2022 since 2025; the index is per program) and
  // its decimals. Owner and amount sit at the same offsets in both programs' accounts.
  const a = await rpcCall(url, "getAccountInfo", [b.mint, { encoding: "base64", commitment: "processed", dataSlice: { offset: 44, length: 1 } }], 10_000);
  if (!a?.value) throw new Error("mint not found");
  const scale = 10 ** Buffer.from(a.value.data[0], "base64")[0];
  const r = await rpcCall(url, "getProgramAccounts", [a.value.owner, { encoding: "base64", commitment: "processed", dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: b.mint } }] }]);
  const list = Array.isArray(r) ? r : r?.value || [];
  // Balance per wallet (a wallet can hold the coin in more than one account).
  const owners = new Map();
  let i = 0;
  for (const x of list) {
    if (++i % 1000 === 0) await new Promise((ok) => setImmediate(ok));
    const d = Buffer.from(x.account.data[0], "base64");
    if (d.length < 40) continue;
    const amount = Number(d.readBigUInt64LE(32)) / scale;
    if (!(amount > 0)) continue;
    const owner = b58(d.subarray(0, 32));
    owners.set(owner, (owners.get(owner) || 0) + amount);
  }
  if (owners.size > SEED_MAX) { b.seedFail = 9; holderStats.seedBig++; return; }
  for (const [owner, amount] of owners) if (amount >= 1e6 && !onCurve(owner)) owners.delete(owner);   // the curve, pools, vaults
  const t = now();
  // Wallets the trades never showed start here; ones they did are set to what the chain says they hold.
  for (const [owner, amount] of owners) {
    let w = b.bal.get(owner);
    if (!w) { w = { b: 0, max: 0, in: 0, out: 0, n: 0, first: t, slot: null }; b.bal.set(owner, w); }
    w.b = amount; if (amount > w.max) w.max = amount;
  }
  for (const [owner, w] of b.bal) if (!owners.has(owner)) w.b = 0;
  b.seeded = t; b.unknownSells = 0; b.over = 0; b.sum = null;
  holderStats.seeded++; holderStats.lastSeedMs = now() - t0;
}

export function startHolders() {
  loadState();
  onLiveTrade(onTrade);
  // A bonded coin's pool trades carry on its ledger (the curve is done: progress 1, no genesis question).
  onPoolLedger((mint, s, sol, buy, x) => onTrade(mint, { progress: 1 }, sol, buy, x));
  setInterval(prune, 30_000);
  setInterval(saveState, 40_000);   // a save is ~1 s of main-thread work spread over yields; a resume reads it back within 2 min
  setInterval(() => { seedOne().catch(() => {}); }, 500);
}

export const solUsd = () => feed.solUsd;
