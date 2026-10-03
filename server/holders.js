// Holders: a live ledger for every pump.fun coin, built from the trade feed and nothing else.
// Every TradeEvent says who traded, how many tokens and in which block, so for a coin whose first
// trade the radar saw it knows, this second: who holds what (holders, top-10 share), what the dev
// bought and whether the dev has sold, who sniped the first blocks and whether they are still in, and
// how much was bought in the launch block itself (a bundle). Axiom and GMGN show these from their own
// indexers; here they come free from the same websocket that prices the Pulse page.
//
// Honesty rules: a coin whose first trade was missed (the radar started after it launched, or the
// socket dropped messages) is marked partial, and the sniper/bundle figures are not shown for it.
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./db.js";
import { onLiveTrade, feed } from "./livetrades.js";
import { launchIndex } from "./engine.js";

const SUPPLY = 1e9;                      // every pump.fun coin
const CURVE_TOKENS = 793_100_000;        // tokens sold along the curve before it completes
const SNIPE_SLOTS = 2;                   // bought within this many blocks of the first trade = sniper
const SNIPE_MS = 1500;                   // or within this long, when the block number is missing
const MAX_WALLETS = 2500;                // per coin; beyond this new wallets are counted, not kept
const MAX_BOOKS = 3000;
const QUIET = 30 * 60_000;               // books for coins quiet this long are dropped
const now = () => Date.now();

export const books = new Map();          // mint -> book
export const holderStats = { books: 0, wallets: 0, trades: 0, genesis: 0, partial: 0, unknownSells: 0 };

function book(mint) {
  let b = books.get(mint);
  if (!b) {
    b = { mint, t0: now(), slot0: null, genesis: false, trades: 0, last: 0, unknownSells: 0, over: 0,
      bal: new Map(), snipers: new Set(), bundle: new Set(), sum: null, sumT: 0 };
    books.set(mint, b);
  }
  return b;
}

function onTrade(mint, s, sol, buy, x) {
  if (!x || !x.user || !(x.tokens >= 0)) return;
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

// A tagged, sorted picture of one coin's holders, computed at most once a second per coin.
export function holdersFor(mint, { top = 10 } = {}) {
  const b = books.get(mint);
  if (!b) return null;
  if (b.sum && now() - b.sumT < 1000) return b.sum;
  const creator = launchIndex.get(mint)?.creator || null;
  const held = [];
  let holders = 0;
  for (const [wallet, w] of b.bal) if (w.b > 0.5) { holders++; held.push([wallet, w]); }
  held.sort((a, c) => c[1].b - a[1].b);
  const pct = (tokens) => +((tokens / SUPPLY) * 100).toFixed(2);
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
    holders, top10, top: list, trades: b.trades, since: b.t0, last: b.last, genesis: b.genesis, partial: !b.genesis || b.unknownSells > 0 || b.over > 0,
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

// Coins that went quiet are forgotten; the newest books win when there are too many.
function prune() {
  const t = now();
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
    const out = [];
    for (const b of books.values()) if (now() - b.last < QUIET) out.push({ ...b, sum: undefined, bal: [...b.bal], snipers: [...b.snipers], bundle: [...b.bundle] });
    await fs.promises.writeFile(STATE_FILE + ".tmp", JSON.stringify({ t: now(), books: out }));
    await fs.promises.rename(STATE_FILE + ".tmp", STATE_FILE);
  } catch {} finally { saving = false; }
}
export function loadState() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (!(now() - j.t < RESUME_MS)) return;
    for (const b of j.books) books.set(b.mint, { ...b, sum: null, sumT: 0, bal: new Map(b.bal), snipers: new Set(b.snipers), bundle: new Set(b.bundle) });
    restored.books = books.size;
  } catch {}
}

// Exposed for tests: feed one trade by hand.
export const _onTrade = onTrade;

export function startHolders() {
  loadState();
  onLiveTrade(onTrade);
  setInterval(prune, 30_000);
  setInterval(saveState, 10_000);
}

export const solUsd = () => feed.solUsd;
