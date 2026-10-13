import { heliusFetch as fetch } from "./heliuskeys.js";
import { canEnrich } from './coin-screen.js';
// Runs the trade journal (journal.js) against the radar's live feeds: every pump.fun curve trade and PumpSwap
// trade is recorded as it is heard, written once a second, confirmed a few seconds later, and kept a day. The
// feeds' outages (and the radar's own downtime) are recorded as gaps and repaired from the chain when the
// feed is back. The live candles are rebuilt from the journal at start, so a restart loses no trades.
import { onLiveTrade, feed, twin, pumpHeard, poolMigrated, b58 } from "./livetrades.js";
import { onPoolTrade, onPoolLearned, swapFeed, decodeKnown, knownMint, poolInfoOf } from "./pumpswap.js";
import { settings } from "./settings.js";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { setBook } from "./candles.js";
import { supplyOf, knownSupply } from "./jup.js";
import { rpc } from "./solana.js";
import { coinRpcUrl } from "./txtrade.js";
import { slotTime } from "./feedlag.js";
import { db, DATA } from "./db.js";
import * as J from "./journal.js";
import { quoteStats } from "./pumpquote.js";
import { addFee, feeStats, updateFeeCoverage } from "./coinfees.js";
import { createSolPoolResolver } from './pool-identity.js';

const now = () => Date.now();
const DOWN_MS = 15_000;   // a whole program's log stream (tens of trades a second) silent this long is down
const HOT_MS = 60 * 60_000;

// Rebuild one coin's live one-second candles from its journal (the last hour, as candles.js keeps).
export function rebuild(mint) { setBook(mint, J.buckets(J.trades(mint, now() - HOT_MS))); }
// A coin's rows change in bursts (every failed transaction of a busy coin is a revision): its rebuild runs
// once per 3 s, not once per revision. On the VM's one core the per-revision rebuilds were a fifth of the
// main thread (2026-10-06), reading a busy coin's whole hour of trades hundreds of times.
const dirty = new Map();   // mint -> timer
function rebuildSoon(mint) {
  if (dirty.has(mint)) return;
  dirty.set(mint, setTimeout(() => { dirty.delete(mint); try { rebuild(mint); } catch {} }, 3000));
}

// PumpSwap pool -> coin, for trades read back from the chain: the radar's known pairs, else the pool account.
const solPoolMint = createSolPoolResolver(rpc);
// What the live feed learned of a pool comes first (pumpswap.js: its sides too, so a pool quoted in another token
// is priced at that token's dollar price, not as SOL); a pool it never heard is read as a SOL pool, else unpriced.
export const poolMint = async (pool) => { const k = knownMint(pool); return k !== undefined ? k : solPoolMint(pool); };
export const poolInfo = (pool) => poolInfoOf(pool);

// Read-backs go to the fast per-coin RPC (the chart's free Helius key when set: a credit per call, spent
// only after an outage), paced to ~6 calls a second, with a retry after a rate limit.
// Paced to ~3 calls a second, and held for a minute after a rate limit: the live feeds share this RPC, and a
// read-back that crowds them out opens the next gap.
let nextCall = 0;
export async function repairCall(method, params, mint = null) {
  for (let i = 0; i < 4; i++) {
    const wait = nextCall - now(); nextCall = Math.max(now(), nextCall) + 330;
    if (wait > 0) await new Promise((go) => setTimeout(go, wait));
    try {
      const url = mint && canEnrich(mint) ? coinRpcUrl() : 'https://solana-rpc.publicnode.com';
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
      if (r.status === 429) { nextCall = now() + 60_000; continue; }
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || "RPC error");
      return j.result;
    } catch (e) { if (i === 3) throw e; }
  }
  throw new Error("rate limited");
}

// Gaps, per feed: down when disconnected or silent DOWN_MS, back on the first message after reconnecting.
const feeds = [["pump", feed], ["pumpswap", swapFeed]];
const down = new Map();   // feed -> gap id
let watchedFn = () => [];
const repairs = [];   // gap ids, or { id, only: [mint] } for one coin someone is looking at (served first)
let repairing = false;
async function runRepairs() {
  if (repairing) return;
  repairing = true;
  while (repairs.length) {
    const job = repairs.shift();
    const id = typeof job === "object" ? job.id : job, only = typeof job === "object" ? job.only : null;
    try { await J.repairGap(id, { watched: watchedFn(), only, poolMint, poolInfo, supply: supplyOf, coinCall: mint => (method, params) => repairCall(method, params, mint) }); } catch {}
  }
  repairing = false;
}
// A chart opened over an outage this coin was not read back for: that coin, ahead of the queue. Asked at most
// once every 10 minutes per coin and gap, so a read-back the RPC cannot finish is not retried on every poll.
const asked = new Map();   // "gap:mint" -> when
export function repairCoin(mint, fromMs) {
  let ids;
  try { ids = J.gapIdsFor(mint, fromMs); } catch { return 0; }
  const t = now();
  if (asked.size > 5000) for (const [k, v] of asked) if (t - v > 10 * 60_000) asked.delete(k);
  let n = 0;
  for (const id of ids) {
    const k = `${id}:${mint}`;
    if (t - (asked.get(k) || 0) < 10 * 60_000) continue;
    asked.set(k, t); repairs.unshift({ id, only: [mint] }); n++;
  }
  if (n) runRepairs();
  return n;
}
// The public log streams deliver only about half of pump.fun's trades and never say which they skipped, so no
// gap is recorded for them (2026-10-09: publicnode heard 30-65% of the busiest coins' trades in a minute;
// FROMAGE's chart held 76 of its 136). Every coin with a chart open is checked against the chain every few
// seconds: its signature list and every transaction the journal lacks, both read on publicnode (free and fast:
// 40 getTransaction at once answered in 0.4 s; the signature list in 0.4 s against mainnet-beta's 3.8 s), then
// mainnet-beta (the shared read-back RPC's 60 s rate-limit holds stalled this loop for minutes). The first
// check reads the coin's whole kept day back (newest first, 8 pages at most).
// Endpoints in turn: one that rate limits rests 20 s; a Helius key with budget left is the last resort.
const FREE = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];
const resting = new Map();   // url -> until
async function pnCall(method, params, mint = null) {
  const urls = [...FREE, ...(mint && canEnrich(mint) ? [coinRpcUrl()] : [])].filter((u, i, a) => a.indexOf(u) === i);
  for (const url of urls) {
    if ((resting.get(url) || 0) > now()) continue;
    try {
            const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000) });
      const j = await r.json().catch(() => null);
      if (r.status === 429 || j?.error?.code === -32005 || j?.error?.code === 429) { resting.set(url, now() + 20_000); reconcileStats.limited++; continue; }
      if (j && !j.error && j.result !== undefined) return j.result;
    } catch {}
  }
  return null;
}
const pnTx = (sig, mint) => pnCall("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }], mint);
// Per coin: the newest signature checked, and the transactions still to read (newest first). A busy coin
// (18 trades a second on 2026-10-09) has far more history than free endpoints can read, so each run reads at
// most PER_RUN, newest first, and the queue keeps the newest TODO_MAX: the live end is always whole, then as
// much of the past as there is time for. A young coin's whole life fits.
const checked = new Map();   // mint -> { newest, todo: [{ signature, blockTime, tries }], t, read, hits, quietUntil }
const PER_RUN = 150, TODO_MAX = 8000;
export const reconcileStats = J.stats.reconcile = { runs: 0, coins: 0, sigs: 0, missed: 0, added: 0, failed: 0, limited: 0, backlog: 0, last: 0, lastError: null };
async function reconcile(mint) {
  let c = checked.get(mint);
  if (!c) checked.set(mint, (c = { newest: null, todo: [], t: 0, read: 0, hits: 0, quietUntil: 0 }));
  c.t = now();
  // Hundreds of bot transactions a second that touch the coin but trade on no venue the journal keeps (seen:
  // 290 a second on one PumpSwap coin, 450 read, 0 trades): not worth the free endpoints. Looked at again later.
  if (c.quietUntil > now()) return;
  if (c.read >= 300 && c.hits < c.read * 0.05) { c.quietUntil = now() + 10 * 60_000; c.read = c.hits = 0; c.todo = []; c.newest = null; return; }
  // Once its past is read, a coin's new trades come from the block follower below; while that keeps up, the
  // chain is asked about the coin once a minute (a net under the net), not every few seconds.
  if (c.newest && !c.todo.length && followerOk() && now() - (c.asked || 0) < 60_000) return;
  c.asked = now();
  const cut = Math.floor((now() - J.KEEP_MS) / 1000), fresh = [];
  let before = null, top = null;
  for (let page = 0; page < 8; page++) {
    const list = await pnCall("getSignaturesForAddress", [mint, { limit: 1000, commitment: "confirmed", ...(c.newest ? { until: c.newest } : {}), ...(before ? { before } : {}) }], mint);
    if (!list) return;   // every endpoint out: the next run asks again from the same place
    if (!list.length) break;
    top ??= list[0].signature;
    for (const s of list) if (!s.err && s.blockTime && s.blockTime >= cut && !J.heardTx(s.signature, mint)) fresh.push(s);
    before = list[list.length - 1].signature;
    if (list.length < 1000 || list[list.length - 1].blockTime < cut) break;
  }
  if (top) c.newest = top;
  reconcileStats.sigs += fresh.length;
  c.todo = [...fresh, ...c.todo].slice(0, TODO_MAX);
  // The last few seconds wait a run: the live feed is still delivering them.
  const batch = [], keep = [], soon = now() / 1000 - 4;
  for (const s of c.todo) {
    if (J.stored(s.signature, mint)) continue;
    (batch.length < PER_RUN && !(s.blockTime > soon) ? batch : keep).push(s);
  }
  c.todo = keep;
  if (!batch.length) return;
  const r = await J.readBack(mint, batch, { getTx: sig => pnTx(sig, mint), poolMint, poolInfo, supply: supplyOf, conc: 4 });
  // Unreadable (rate limited, or not on that node yet): back in the queue while the chart is open, 20 tries
  // (about a minute) before it is let go: three were used up in seconds when the endpoints were busy.
  const failed = new Set(r.failed);
  for (const s of batch) if (failed.has(s.signature) && (s.tries = (s.tries || 0) + 1) < 20) c.todo.push(s);
  c.read += r.read; c.hits += r.n;
  reconcileStats.missed += r.read; reconcileStats.added += r.n; reconcileStats.failed += r.failed.length;
}
// ---------- every block ----------
// The log streams skip trades at random (above); blockworker.js reads every confirmed block on publicnode and
// sends its pump.fun and PumpSwap transactions here, 2-5 s after the fact. A transaction whose trades of a coin
// are not in the journal (not heard live, not read back) is written whole, confirmed, at its slot's time. The
// candle roller (candleroll.js) waits 20 s before rolling a second, so these land in their candles; one that
// comes later than that (the follower catching up) has its coin's candles made again.
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const TRADE = "bddb7fd34ee661ee", BUY = "67f4521f2cf57777", SELL = "3e2f370aa503dc2a";
const MIGRATED = "bde95db95c94ea94";   // pump.fun CompletePumpAmmMigrationEvent (livetrades.js): the feeds drop some; the block has it
J.stats.twin = twin;
J.stats.quoted = quoteStats;   // curves quoted in another token (pumpquote.js)
J.stats.fees = feeStats;       // fees paid per coin (coinfees.js)
export const blockStats = J.stats.blocks = { on: false, added: 0, coins: 0, late: 0, jumps: 0, lost: 0, worker: null };
const lateCoins = new Map();   // mint -> timer (a late coin's candles remade once per 15 s at most)
// coin.js and holders.js, loaded once the radar is up (coin.js reads the live feed at load time, and loading it
// from here early would run it before livetrades.js has finished).
let side = null;
setTimeout(() => Promise.all([import("./coin.js"), import("./holders.js")]).then(([c, h]) => { side = { tape: c.addTape, ledger: h.lateTrade }; }).catch(() => {}), 5000).unref?.();
function onBlock({ slot, time, txs }) {
  const st = slotTime(slot), t0 = st && now() - st < 60_000 ? st : time ? time * 1000 + 500 : now();
  const sol = J.solUsdAt(t0) ?? feed.solUsd;
  const coins = new Set();
  for (const [sig, data, fee] of txs) {
    const per = new Map();   // mint -> its trades in this transaction, in log order
    for (const l of data) {
      const buf = Buffer.from(l.slice(14), "base64");
      if (buf.length < 8) continue;
      const disc = buf.toString("hex", 0, 8);
      let x = null;
      if (disc === MIGRATED) { if (buf.length >= 168) poolMigrated(b58(buf.subarray(40, 72)), b58(buf.subarray(136, 168)), t0, "block"); continue; }
      if (disc === TRADE) {
        const e = J.decodeCurveTrade(buf);
        if (e) x = { mint: e.mint, venue: J.VENUE.curve, sol: e.sol, tokens: e.tokens, buy: e.buy, wallet: e.user, mcUsd: e.mcSol * sol * ((knownSupply(e.mint) ?? 1e9) / 1e9) };
      } else if (disc === BUY || disc === SELL) {
        const e = decodeKnown(buf, disc === BUY);
        if (e) x = { mint: e.mint, venue: J.VENUE.pumpswap, sol: e.sol, tokens: e.tokens, buy: e.buy, wallet: e.user, mcUsd: e.mcSol * sol };
      }
      if (!x) continue;
      if (!per.has(x.mint)) per.set(x.mint, []);
      per.get(x.mint).push(x);
    }
    // What it paid (blocks only: the sweep's transactions are also in blocks, and would count twice).
    if (fee > 0 && per.size) for (const mint of per.keys()) addFee(mint, fee / 1e9 / per.size, t0, sig);
    for (const [mint, list] of per) {
      if (J.heardTx(sig, mint)) continue;
      list.forEach((x, n) => J.record({ ...x, sig, n, slot, t: t0 + n, usd: x.sol * sol, block: true }));
      // The coin page's trade list (in its place in time) and holder ledger get them too: they were fed by the
      // live stream alone, so a skipped buy left a holder short and their later sell counted as "never bought".
      if (side) for (const x of list) {
        try { side.tape(mint, { buy: x.buy, sol: x.sol, tokens: x.tokens, mcSol: x.mcUsd / sol, user: x.wallet, slot, sig, at: t0 }); } catch {}
        try { side.ledger(mint, { sol: x.sol, buy: x.buy, user: x.wallet, tokens: x.tokens, slot, sig }); } catch {}
      }
      blockStats.added += list.length; coins.add(mint);
    }
  }
  const late = now() - t0 > 12_000;
  for (const mint of coins) {
    blockStats.coins++;
    if (!late) { rebuildSoon(mint); continue; }
    blockStats.late++;
    if (lateCoins.has(mint)) continue;
    lateCoins.set(mint, setTimeout(() => { lateCoins.delete(mint); J.touch(mint); }, 15_000));
  }
}
// ---------- the pump.fun sweep ----------
// The trades both free log streams skip are mostly the big transactions (bots, bundles, calls through other
// programs: 54% of the skipped ones had over 60 log lines, against 12% of those heard, 2026-10-09), so a second
// stream does not bring them. The program's own signature list does (it lists every transaction, big ones too:
// checked against whole blocks): one call every 2 s (1,000 signatures cover ~3 s, 240 KB), and only the
// transactions no stream delivered within ~3 s are read (about 6 a second), then go the block reader's way
// (onBlock: journal, trade list, holder ledger). Much cheaper per trade than whole blocks.
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const sweepStats = J.stats.sweep = { runs: 0, listed: 0, unheard: 0, read: 0, added: 0, failed: 0, behind: 0, lastError: null };
const sweepWait = new Map();   // signature -> { slot, time, at: when listed, tries }
const swept = new Set();       // read already (kept 20k)
let sweepTop = null, sweeping2 = false;
async function sweep() {
  if (sweeping2) return;
  sweeping2 = true;
  try {
    sweepStats.runs++;
    // New signatures since the last look, newest first; three pages at most (a longer outage is the blocks' job).
    const fresh = [];
    let before = null, top = null, reached = !sweepTop;
    for (let page = 0; page < 3; page++) {
      const list = await pnCall("getSignaturesForAddress", [PUMP_PROGRAM, { limit: 1000, commitment: "confirmed", ...(sweepTop ? { until: sweepTop } : {}), ...(before ? { before } : {}) }]);
      if (!list) return;
      if (!list.length) { reached = true; break; }
      top ??= list[0].signature;
      for (const s of list) if (!s.err) fresh.push(s);
      before = list[list.length - 1].signature;
      if (list.length < 1000 || !sweepTop) { reached = true; break; }
    }
    if (!reached) sweepStats.behind++;
    if (top) sweepTop = top;
    sweepStats.listed += fresh.length;
    for (const s of fresh) if (!swept.has(s.signature) && !sweepWait.has(s.signature)) sweepWait.set(s.signature, { slot: s.slot, time: s.blockTime, at: now(), tries: 0 });
    // Ready: listed ~3 s ago and still not heard on any stream.
    const ready = [];
    for (const [sig, w] of sweepWait) {
      if (pumpHeard(sig)) { sweepWait.delete(sig); continue; }
      if (now() - w.at < 3000) continue;
      if (ready.length < 60) ready.push([sig, w]);
    }
    if (sweepWait.size > 5000) for (const k of [...sweepWait.keys()].slice(0, sweepWait.size - 5000)) sweepWait.delete(k);
    sweepStats.unheard += ready.length;
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < ready.length) {
        const [sig, w] = ready[next++];
        const tx = await pnCall("getTransaction", [sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }]);
        if (!tx) { if (++w.tries >= 5) { sweepWait.delete(sig); sweepStats.failed++; } continue; }
        sweepWait.delete(sig); swept.add(sig); if (swept.size > 20_000) swept.clear();
        sweepStats.read++;
        if (tx.meta?.err) continue;
        const data = (tx.meta?.logMessages || []).filter((l) => l.startsWith("Program data: "));
        const before2 = blockStats.added;
        if (data.length) onBlock({ slot: tx.slot ?? w.slot, time: tx.blockTime ?? w.time, txs: [[sig, data]] });
        sweepStats.added += blockStats.added - before2;
      }
    }));
  } catch (e) { sweepStats.lastError = e.message; } finally { sweeping2 = false; }
}

let blockWorker = null;
// The share of blocks the follower read over the last ~10 minutes (not the skipped slots, which have none), for
// scaling each coin's fees (coinfees.js). Moves only on 50+ blocks.
const coverSnaps = [];   // [at, blocks read, blocks lost], one a minute
function coverage(w) {
  const t = now(), last = coverSnaps.at(-1);
  if (!last || t - last[0] >= 60_000) { coverSnaps.push([t, w.blocks || 0, w.lost || 0]); if (coverSnaps.length > 11) coverSnaps.shift(); }
  const [, b0, l0] = coverSnaps[0], read = (w.blocks || 0) - b0, lost = (w.lost || 0) - l0;
  if (read + lost >= 50 && read > 0) {
    feeStats.cover = Math.max(0.3, Math.min(1, read / (read + lost)));
    // Recent buckets can be recalculated as follower coverage becomes known. Older intervals keep their basis.
    updateFeeCoverage(t, feeStats.cover);
    updateFeeCoverage(t - 60_000, feeStats.cover);
  }
}
// The follower is on and within ~20 s of the chain tip.
const followerOk = () => blockStats.on && blockStats.worker && blockStats.worker.behind < 100 && blockStats.worker.backlog < 300 && now() - blockStats.worker.lastBlockAt < 15_000;
function startBlocks() {
  if (blockWorker || settings.marketFeeds === false || settings.blockFeed === false) return;
  blockStats.on = true;
  blockWorker = new Worker(new URL("./blockworker.js", import.meta.url), { workerData: { programs: [PUMP, AMM], conc: 8, cursorFile: path.join(DATA, "block-cursor.json") } });
  blockWorker.on("message", (m) => {
    try {
      if (m.op === "block") onBlock(m);
      else if (m.op === "stats") { const { op, ...w } = m; blockStats.worker = w; coverage(w); }
      else if (m.op === "jump") blockStats.jumps++;
      // Blocks the follower could not read (refused, or left in its backlog past ~10 minutes). The free sources give
      // about 2.5-3 blocks a second against the chain's ~4.6 (2026-10-09), so this is routine: those blocks' trades
      // are the ones the log stream also skipped (~5-10%). They are not marked as gaps (every chart would show holes
      // for trades it mostly has); a chart opened on a coin is checked against the chain itself (reconcile above,
      // every 3 s while the follower is behind), which reads that coin's missing trades back.
      else if (m.op === "lost") blockStats.lost += m.to - m.from + 1;
    } catch (e) { blockStats.lastError = e.message; }
  });
  blockWorker.on("error", (e) => { blockStats.lastError = e.message; });
  blockWorker.on("exit", () => { blockWorker = null; blockStats.on = false; setTimeout(startBlocks, 10_000).unref?.(); });
}

let reconciling = false;
async function reconcileWatched() {
  if (reconciling) return;
  reconciling = true;
  try {
    const mints = watchedFn().slice(0, 6);
    for (const mint of mints) {
      try { await reconcile(mint); } catch (e) { reconcileStats.lastError = `${mint.slice(0, 6)}…: ${e.message}`; }
    }
    for (const [m, c] of checked) if (now() - c.t > 10 * 60_000) checked.delete(m);   // closed charts start over
    reconcileStats.runs++; reconcileStats.coins = mints.length; reconcileStats.last = now();
    reconcileStats.backlog = [...checked.values()].reduce((n, c) => n + c.todo.length, 0);
  } finally { reconciling = false; }
}

let startedAt = 0;
function watchFeeds() {
  const t = now();
  // The feeds take a few seconds to connect after a start; that time is the radar's own gap (when it was away).
  if (t - startedAt < 20_000) return;
  for (const [name, f] of feeds) {
    // While the radar's own downtime gap is still open it covers every feed: one gap, one repair.
    if (down.has("radar") && !down.has(name)) continue;
    const quiet = !f.connected || !f.lastMsg || t - f.lastMsg > DOWN_MS;
    if (quiet && !down.has(name)) down.set(name, J.gapStart(name, f.lastMsg && t - f.lastMsg < 10 * 60_000 ? f.lastMsg : t, f.connected ? "feed went silent" : f.lastError || f.error || "disconnected"));
    else if (!quiet && down.has(name) && t - f.lastMsg < 3000) {
      const id = J.gapEnd(name, f.lastMsg);
      down.delete(name);
      if (id != null) { repairs.push(id); runRepairs(); }
    }
  }
  // The radar's own downtime closes when the curve feed is back.
  if (down.has("radar") && feed.connected && t - feed.lastMsg < 3000) {
    const id = J.gapEnd("radar", feed.lastMsg);
    down.delete("radar");
    if (id != null) { repairs.push(id); runRepairs(); }
  }
}

let started = false;
// `watched()` -> coins someone is looking at (repaired first after an outage).
export function startJournal({ watched = () => [] } = {}) {
  if (started) return;
  started = true;
  startedAt = now();
  watchedFn = () => { try { return [...watched()]; } catch { return []; } };
  // The radar was away: from its last heartbeat until the feed is back is a gap.
  const alive = J.lastAlive();
  J.closeDangling(alive ?? now());
  for (const id of J.unrepaired()) repairs.push(id);
  // Run them once the feeds are up, whether or not this start opened a gap of its own (a restart under 5 s
  // opens none, and the queue used to wait on that gap closing: it never ran, 2026-10-07).
  if (repairs.length) setTimeout(runRepairs, 8000).unref?.();
  if (alive && now() - alive > 5000) down.set("radar", J.gapStart("radar", alive, "radar was not running"));
  // Live candles from the journal: every trade of the last hour, exactly as heard.
  // (Never replacing what the saved state restored with nothing: a coin whose rows are gone keeps it.) Ten
  // milliseconds at a time, so the radar answers while hundreds are rebuilt.
  (async () => {
    let n = 0, t0 = performance.now();
    for (const mint of J.activeMints(now() - HOT_MS)) {
      const b = J.buckets(J.trades(mint, now() - HOT_MS));
      if (b.length) { setBook(mint, b); n++; }
      if (performance.now() - t0 > 10) { await new Promise((go) => setImmediate(go)); t0 = performance.now(); }
    }
    J.stats.restored = n;
  })();

  onLiveTrade((mint, s, sol, buy, x) => {
    if (s.pad) return;   // other launchpads' curves (LaunchLab) are not pump.fun's
    // On the circulating supply, as the live candles and Jupiter's history (the curve's own figure is on 1B).
    J.record({ mint, sig: x?.sig, venue: J.VENUE.curve, sol, tokens: x?.tokens ?? null, buy, mcUsd: s.mc * feed.solUsd * ((knownSupply(mint) ?? 1e9) / 1e9), usd: sol * feed.solUsd, slot: x?.slot, t: slotTime(x?.slot) ?? now(), wallet: x?.user || null });
  });
  onPoolTrade((mint, e) => J.record({ mint, sig: e.sig, venue: J.VENUE.pumpswap, sol: e.sol, tokens: e.tokens ?? null, buy: e.buy, mcUsd: e.mcSol * feed.solUsd, usd: e.sol * feed.solUsd, slot: e.slot, t: slotTime(e.slot) ?? now(), wallet: e.user || null }));
  J.onRevised(rebuildSoon);
  // A pool that read as "not ours" and then turned out to be a coin's: the trades skipped meanwhile are read back.
  onPoolLearned((mint, since) => {
    const feed = `pool:${mint.slice(0, 8)}`;
    J.gapStart(feed, since, "pool not recognised yet (fresh migration)");
    const id = J.gapEnd(feed, now());
    if (id != null) { repairs.unshift({ id, only: [mint] }); runRepairs(); }
  });

  // Four times a second, 500 rows at most per write; a backlog continues on the next turn of the event loop.
  let draining = false;
  const drain = () => {
    try { if (J.flush() > 0) { draining = true; setImmediate(drain); return; } } catch (e) { J.stats.flushError = e.message; }
    draining = false;
  };
  // Once a second, not four times: every commit writes each index page it dirtied to the write-ahead log, and the
  // trade key index scatters inserts over the whole 550 MB index, so four small commits a second wrote ~4x the log
  // of one (≈300 MB/min, the checkpointer and disk behind it, stalls; 2026-10-11). The chart's newest seconds come
  // from the live book, not the journal, so nothing on screen waits on this.
  setInterval(() => { if (!draining) drain(); }, 1000).unref?.();
  // Behind (a burst, or the RPC was out): several batches a sweep, so a backlog clears before it ages out.
  let sweeping = false;
  setInterval(async () => {
    if (sweeping) return;
    sweeping = true;
    try { for (let i = 0; i < 6; i++) { const n = await J.confirmSweep(); if (n < 256 || J.stats.pending < 1500) break; } } catch {} finally { sweeping = false; }
  }, 2000).unref?.();
  setInterval(watchFeeds, 1000).unref?.();
  setInterval(() => { reconcileWatched().catch(() => {}); }, 3000).unref?.();
  startBlocks();
  if (settings.marketFeeds !== false && settings.pumpSweep !== false) setInterval(() => { sweep().catch(() => {}); }, 2000).unref?.();
  const sol = () => { if (feed.solKnown) J.noteSol(feed.solUsd); };
  sol(); setInterval(sol, 30_000).unref?.();
  setInterval(() => { J.prune().catch(() => {}); }, 10 * 60_000).unref?.();
}
