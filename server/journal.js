import { validTrade } from "./chart-data.js";
// The trade journal: every pump.fun curve and PumpSwap trade the radar hears, kept in SQLite for a day, so a
// chart or a mini chart has the coin's real history the moment it opens and a restart loses nothing. All of
// it is free: the trades come from the radar's own log feeds (livetrades.js, pumpswap.js), confirmation and
// repair from ordinary RPC calls.
//
// - One row per trade, never two. A trade's identity is its transaction signature, the venue, the coin, the
//   amounts and side, and its place among identical events in that transaction: the same on every feed that
//   delivers it, on the open chart's own stream, and when the transaction is read back later. Inserts ignore
//   a key already there, so replays and repairs never double count.
// - Prices are fixed when the trade happens: market cap in USD at the SOL price of that moment (never redone at
//   today's price), volume in USD the same way.
// - Provisional, then confirmed. Trades arrive at "processed" (within a slot) and are stored at once (st 0).
//   Their signatures are checked at "confirmed" a few seconds later (getSignatureStatuses, 256 per call): a
//   confirmed one is marked st 1; one that failed, or that the chain still does not know after DROP_MS (its
//   block was abandoned), is removed and its coin's live candles rebuilt without it.
// - Outages are recorded, never painted over. When a feed disconnects or goes silent, or the radar itself is
//   down, the interval is stored as a gap. When the feed is back, the coins that were trading are read back
//   from the chain for that interval (getSignaturesForAddress + getTransaction, decoded the same way) and the
//   gap is marked repaired for each coin read in full. A gap not yet repaired for a coin stays a gap: charts
//   show it as missing, not as a flat price.
import crypto from "node:crypto";
import { db } from "./db.js";
import { rpc } from "./solana.js";
import { decode as decodeSwap, poolInfoOf } from "./pumpswap.js";
import { quotedTrade } from "./pumpquote.js";

const now = () => Date.now();
export const KEEP_MS = 24 * 3600e3;         // trades kept a day (the longest list window)
const CONFIRM_AFTER = 3000, DROP_MS = 90_000, CONFIRM_BATCH = 256, PENDING_MAX = 40_000;
// getSignatureStatuses without searchTransactionHistory only knows the node's recent status cache (about
// two minutes of slots). A signature older than this answers null whether or not it landed, so a null past
// it means "too late to tell", never "never landed" (2026-10-07: a sweep running minutes behind on the VM
// deleted a third of all trades, 37K of 114K, and every busy chart had holes).
const CACHE_MS = 100_000;
export const VENUE = { curve: 1, pumpswap: 2 };
export const ST = { processed: 0, confirmed: 1 };
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P", AMM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const TRADE = "bddb7fd34ee661ee", BUY = "67f4521f2cf57777", SELL = "3e2f370aa503dc2a";
const WSOL = "So11111111111111111111111111111111111111112";

db.exec(`
CREATE TABLE IF NOT EXISTS j_mints (id INTEGER PRIMARY KEY, mint TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS j_trades (
  mid INTEGER NOT NULL, t INTEGER NOT NULL, k INTEGER NOT NULL, slot INTEGER, mc REAL NOT NULL, usd REAL NOT NULL,
  buy INTEGER NOT NULL, venue INTEGER NOT NULL, st INTEGER NOT NULL DEFAULT 0, src INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mid, t, k)
) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS j_trades_k ON j_trades(k);
CREATE TABLE IF NOT EXISTS j_gaps (id INTEGER PRIMARY KEY, feed TEXT NOT NULL, t0 INTEGER NOT NULL, t1 INTEGER, why TEXT);
CREATE TABLE IF NOT EXISTS j_repairs (gap INTEGER NOT NULL, mid INTEGER NOT NULL, t INTEGER, n INTEGER, full INTEGER, PRIMARY KEY (gap, mid));
CREATE TABLE IF NOT EXISTS j_sol (t INTEGER PRIMARY KEY, px REAL NOT NULL);
CREATE TABLE IF NOT EXISTS j_meta (k TEXT PRIMARY KEY, v);
`);
// Each trade's wallet (2026-10-09, for the coin page's replay: holders and traders at any moment): an id into
// j_wallets. Ids are handed out per 12-hour generation (a wallet seen again in a new one gets a new row), so a
// generation's rows can be dropped once every trade that could point at them is past the journal's day.
try { db.exec("ALTER TABLE j_trades ADD COLUMN wid INTEGER"); } catch {}
db.exec("CREATE TABLE IF NOT EXISTS j_wallets (id INTEGER PRIMARY KEY, w TEXT NOT NULL)");
db.exec("CREATE TABLE IF NOT EXISTS j_wgen (start INTEGER PRIMARY KEY, first_id INTEGER NOT NULL)");
// Each coin's newest stored trade, so "which coins traded since" never scans the trades (no index on time).
try { db.exec("ALTER TABLE j_mints ADD COLUMN last INTEGER"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS j_mints_last ON j_mints(last)"); } catch {}

export const stats = { written: 0, dupes: 0, flushes: 0, flushMs: 0, lastFlush: 0, pending: 0, confirmed: 0, dropped: 0, failed: 0, unverified: 0,
  confirmCalls: 0, confirmErrors: 0, repairs: 0, repaired: 0, repairErrors: 0, repairing: null, pruned: 0 };

// ---------- identity ----------
// 63 bits of SHA-1 over the trade's identity, a signed 64-bit SQLite integer (collision odds negligible at
// millions of rows): its transaction, its coin, and `n`, its place among that coin's trades in the
// transaction (the decoders hand them over in log order, live and on read-back alike). Knowing a
// transaction's signature is enough to tell whether its trades are already stored, before fetching it.
export function tradeKey(sig, mint, n = 0) {
  const h = crypto.createHash("sha1").update(`${sig}|${mint}|${n}`).digest();
  return h.readBigInt64LE(0) & 0x7fffffffffffffffn;
}
// Keys from before 2026-10-06 also hashed the venue and amounts; those rows are cleared once, at start.
if (db.prepare("SELECT v FROM j_meta WHERE k = 'keyv'").get()?.v !== 2) {
  db.exec("DELETE FROM j_trades; DELETE FROM j_repairs; DELETE FROM j_gaps;");
  db.prepare("INSERT OR REPLACE INTO j_meta (k, v) VALUES ('keyv', 2)").run();
}
const seenInTx = new Map();   // `${sig}|${mint}` -> trades of that coin heard in that transaction
function occurrence(sig, ident) {
  const k = `${sig}|${ident}`, n = seenInTx.get(k) || 0;
  seenInTx.set(k, n + 1);
  if (seenInTx.size > 50_000) seenInTx.clear();
  return n;
}

const mids = new Map();
const getMid = db.prepare("SELECT id FROM j_mints WHERE mint = ?"), addMid = db.prepare("INSERT OR IGNORE INTO j_mints (mint) VALUES (?)");
export function midOf(mint, create = true) {
  let id = mids.get(mint);
  if (id != null) return id;
  id = getMid.get(mint)?.id;
  if (id == null && create) { addMid.run(mint); id = getMid.get(mint).id; }
  if (id != null) { mids.set(mint, id); if (mids.size > 200_000) mids.clear(); }
  return id ?? null;
}

// ---------- writing ----------
const queue = [];
const pending = new Map();    // sig -> { t, ks: [k], mints: Set }
const ins = db.prepare("INSERT OR IGNORE INTO j_trades (mid, t, k, slot, mc, usd, buy, venue, st, src, wid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
const addW = db.prepare("INSERT INTO j_wallets (w) VALUES (?)"), addGen = db.prepare("INSERT OR REPLACE INTO j_wgen (start, first_id) VALUES (?, ?)");
const GEN_MS = 12 * 3600e3;
let wids = new Map(), genAt = 0;
function widOf(w) {
  if (!w || typeof w !== "string") return null;
  if (now() - genAt >= GEN_MS) { wids = new Map(); genAt = now(); genFirst = null; }
  let id = wids.get(w);
  if (id == null) { id = Number(addW.run(w).lastInsertRowid); wids.set(w, id); if (genFirst == null) { genFirst = id; addGen.run(genAt, id); } }
  return id;
}
let genFirst = null;
const listeners = [];
// fn(mint) when a coin's stored trades changed after the fact (a provisional trade dropped, a gap repaired).
export const onRevised = (fn) => listeners.push(fn);
const revised = (mint) => { for (const fn of listeners) { try { fn(mint); } catch {} } };
// A coin's rows changed behind the candle roller (journalfeed.js, a block read late): its candles made again.
export const touch = (mint) => revised(mint);

// Transactions the block follower (journalfeed.js) wrote whole for a coin: a live copy heard after it is not
// written again (its place among the coin's trades would count from 0 again, under new keys). Two generations.
let blockCur = new Set(), blockOld = new Set();
// Whether a transaction's trades of a coin are in the journal or on their way to it (heard live, or read).
export const heardTx = (sig, mint) => seenInTx.has(`${sig}|${mint}`) || blockCur.has(`${sig}|${mint}`) || blockOld.has(`${sig}|${mint}`) || stored(sig, mint);
// One trade as heard live: { mint, sig, venue, sol, tokens, buy, mcUsd, usd, slot, t }. `block`: read from a
// confirmed block (written confirmed, src 2); the caller writes all of a transaction's trades of the coin.
export function record(x) {
  if (!x?.mint || !validTrade(x.mcUsd, x.usd ?? 0, x.t ?? now())) return;
  if (x.sig && !x.block && (blockCur.has(`${x.sig}|${x.mint}`) || blockOld.has(`${x.sig}|${x.mint}`))) { stats.blockFirst = (stats.blockFirst || 0) + 1; return; }
  if (x.block) {
    const id = `${x.sig}|${x.mint}`;
    if (!blockCur.has(id)) { blockCur.add(id); if (blockCur.size >= 200_000) { blockOld = blockCur; blockCur = new Set(); } }
    queue.push([x.mint, x.t ?? now(), tradeKey(x.sig, x.mint, x.n ?? 0), x.slot ?? null, x.mcUsd, x.usd || 0, x.buy ? 1 : 0, x.venue, ST.confirmed, 2, x.wallet || null]);
    queued++;
    return;
  }
  const n = x.sig ? occurrence(x.sig, x.mint) : 0;
  const k = x.sig ? tradeKey(x.sig, x.mint, n) : BigInt(Math.floor(Math.random() * 2 ** 52));
  if (x.sig) hint(x.mint, x.t ?? now(), x.sig);
  queue.push([x.mint, x.t ?? now(), k, x.slot ?? null, x.mcUsd, x.usd || 0, x.buy ? 1 : 0, x.venue, ST.processed, 0, x.wallet || null]);
  queued++;
  if (x.sig) {
    let p = pending.get(x.sig);
    if (!p) { p = { t: now(), ks: [], mints: new Set() }; pending.set(x.sig, p); }
    p.seq = queued;
    p.ks.push(k); p.mints.add(x.mint);
    if (pending.size > PENDING_MAX) { const old = pending.keys().next().value; pending.delete(old); stats.unverified++; }
  }
}

// Writes up to `max` of the trades heard since the last flush in one transaction (so one write never holds
// the radar up: a backlog after a pause is written in slices, see journalfeed.js), and the radar's heartbeat
// once a second (so a restart knows how long the radar was away). Returns how many are still waiting.
// `budgetMs`: a write stops after this long and leaves the rest queued (a cold disk after a restart, or
// thousands of coins seen for the first time, can make each row slow).
let queued = 0, written = 0, beat = 0;
export function flush(t = now(), max = 500, budgetMs = 10) {
  // Another process may be checkpointing/backing up. Never freeze live feeds for SQLite's 5 s default wait.
  // Failed batches stay queued; journalfeed's next drain retries them after releasing the event loop.
  const timeout = db.prepare("PRAGMA busy_timeout").get().timeout;
  try {
    if (timeout > 25) db.exec("PRAGMA busy_timeout = 25");
    return flushBatch(t, max, budgetMs);
  } finally {
    if (timeout > 25) db.exec(`PRAGMA busy_timeout = ${timeout}`);
  }
}
function flushBatch(t, max, budgetMs) {
  const t0 = performance.now();
  if (queue.length) {
    const rows = queue.slice(0, max), newest = new Map();
    let done = 0, inserted = 0, dupes = 0, began = false;
    const oldGenAt = genAt, oldGenFirst = genFirst;
    try {
      db.exec("BEGIN IMMEDIATE"); began = true;
      for (const r of rows) {
        if (done % 25 === 0 && done && performance.now() - t0 > budgetMs) break;
        done++;
        const mid = midOf(r[0]);
        const res = ins.run(mid, r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], widOf(r[10]));
        if (res.changes) inserted++; else dupes++;
        if (!(newest.get(mid) >= r[1])) newest.set(mid, r[1]);
      }
      for (const [mid, t] of newest) setLast.run(t, mid, t);
      if (t - beat >= 1000) setMeta.run("alive", t);
      db.exec("COMMIT"); began = false;
      queue.splice(0, done);
      written += done; stats.written += inserted; stats.dupes += dupes;
      if (t - beat >= 1000) beat = t;
    } catch (e) {
      if (began) {
        try { db.exec("ROLLBACK"); } catch {}
        // IDs allocated in the rolled-back transaction no longer exist. The queue stays intact for retry.
        mids.clear(); wids.clear(); genAt = oldGenAt; genFirst = oldGenFirst;
      }
      throw e;
    }
  } else if (t - beat >= 1000) { setMeta.run("alive", t); beat = t; }
  const ms = performance.now() - t0;
  stats.flushes++; stats.flushMs = +ms.toFixed(1); stats.flushMsMax = Math.max(stats.flushMsMax || 0, +ms.toFixed(1)); stats.lastFlush = t;
  stats.pending = pending.size; stats.queued = queue.length;
  return queue.length;
}
const setLast = db.prepare("UPDATE j_mints SET last = ? WHERE id = ? AND (last IS NULL OR last < ?)");
const setMeta = db.prepare("INSERT INTO j_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");
const getMeta = db.prepare("SELECT v FROM j_meta WHERE k = ?");

// ---------- confirmation ----------
const delK = db.prepare("DELETE FROM j_trades WHERE k = ?"), okK = db.prepare("UPDATE j_trades SET st = 1 WHERE k = ?");
// `statusFn(sigs)` -> array of { err, confirmationStatus } | null, as getSignatureStatuses answers.
export async function confirmSweep(statusFn = rpcStatuses, t = now()) {
  const sigs = [];
  // Only trades already on disk (a backlog still being written is asked about on a later sweep).
  for (const [sig, p] of pending) { if (t - p.t < CONFIRM_AFTER) break; if (p.seq > written) continue; sigs.push(sig); if (sigs.length >= CONFIRM_BATCH) break; }
  if (!sigs.length) return 0;
  let res;
  try { res = await statusFn(sigs); stats.confirmCalls++; } catch { stats.confirmErrors++; return 0; }
  const touched = new Set();
  db.exec("BEGIN");
  try {
    sigs.forEach((sig, i) => {
      const p = pending.get(sig), s = res?.[i];
      if (!p) return;
      if (s && !s.err && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
        for (const k of p.ks) okK.run(k);
        stats.confirmed += p.ks.length; pending.delete(sig);
      } else if (!s && t - p.t > CACHE_MS) {
        // Too old for the status cache: kept as heard (unverified), not deleted.
        stats.unverified += p.ks.length; pending.delete(sig);
      } else if (s?.err || (!s && t - p.t > DROP_MS)) {
        // Failed after all, or never landed (its block was abandoned): it did not happen.
        for (const k of p.ks) delK.run(k);
        s?.err ? (stats.failed += p.ks.length) : (stats.dropped += p.ks.length);
        for (const m of p.mints) touched.add(m);
        pending.delete(sig);
      } else {
        // Still processed only: asked again on the next sweep, behind the newer ones.
        pending.delete(sig); pending.set(sig, p);
      }
    });
    db.exec("COMMIT");
  } catch { try { db.exec("ROLLBACK"); } catch {} }
  stats.pending = pending.size;
  for (const m of touched) revised(m);
  return sigs.length;
}
async function rpcStatuses(sigs) {
  const r = await rpc("getSignatureStatuses", [sigs, { searchTransactionHistory: false }], 1);
  return r?.value || [];
}

// ---------- reading ----------
const rowsQ = db.prepare("SELECT t, mc, usd, buy, st FROM j_trades WHERE mid = ? AND t >= ? AND t < ? ORDER BY t, k");
// A coin's trades in [fromMs, toMs), oldest first: { t, mc, usd, buy, st }.
export function trades(mint, fromMs, toMs = Infinity) {
  flush();
  const mid = midOf(mint, false);
  return mid == null ? [] : rowsQ.all(mid, Math.floor(fromMs), toMs === Infinity ? Number.MAX_SAFE_INTEGER : Math.ceil(toMs));
}
// The same with each trade's wallet (null for trades journaled before wallets were kept): { t, mc, usd, buy, w }.
const rowsWQ = db.prepare("SELECT j.t, j.mc, j.usd, j.buy, w.w FROM j_trades j LEFT JOIN j_wallets w ON w.id = j.wid WHERE j.mid = ? AND j.t >= ? ORDER BY j.t, j.k");
export function tradesWithWallets(mint, fromMs) {
  flush();
  const mid = midOf(mint, false);
  return mid == null ? [] : rowsWQ.all(mid, Math.floor(fromMs));
}
// One-second buckets the way the live candle book builds them (candles.js addTrade): [t, o, h, l, c, vUsd,
// buys, sells]; a new bucket opens at the previous close. Live and replayed trades give identical buckets.
export function buckets(rows, step = 1) {
  const out = [];
  for (const r of rows) {
    const t = Math.floor(r.t / 1000 / step) * step, last = out[out.length - 1], mc = r.mc;
    if (last && last[0] === t) { last[2] = Math.max(last[2], mc); last[3] = Math.min(last[3], mc); last[4] = mc; last[5] += r.usd; r.buy ? last[6]++ : last[7]++; }
    else { const o = last ? last[4] : mc; out.push([t, o, Math.max(o, mc), Math.min(o, mc), mc, r.usd, r.buy ? 1 : 0, r.buy ? 0 : 1]); }
  }
  return out;
}
// Coins with trades since `fromMs` (for rebuilding the live candles after a restart).
export function activeMints(fromMs) {
  flush();
  return db.prepare("SELECT mint FROM j_mints WHERE last >= ?").all(fromMs).map((r) => r.mint);
}

// ---------- gaps ----------
const openGap = db.prepare("INSERT INTO j_gaps (feed, t0, why) VALUES (?, ?, ?)"), closeGap = db.prepare("UPDATE j_gaps SET t1 = ? WHERE id = ?");
const open = new Map();   // feed -> gap id
export function gapStart(feed, t0, why) {
  if (open.has(feed)) return open.get(feed);
  const id = Number(openGap.run(feed, Math.floor(t0), why).lastInsertRowid);
  open.set(feed, id);
  return id;
}
export function gapEnd(feed, t1 = now()) {
  const id = open.get(feed);
  if (id == null) return null;
  closeGap.run(Math.ceil(t1), id); open.delete(feed);
  return id;
}
// Gaps overlapping [fromMs, toMs) that are not repaired for this coin: [[t0, t1], ...] in ms (t1 = now while open).
export function gapsFor(mint, fromMs, toMs = now()) {
  const mid = midOf(mint, false);
  return db.prepare(`SELECT g.id, g.t0, g.t1 FROM j_gaps g WHERE g.t0 < ? AND COALESCE(g.t1, ?) > ?
      AND NOT EXISTS (SELECT 1 FROM j_repairs r WHERE r.gap = g.id AND r.mid = ? AND r.full = 1) ORDER BY g.t0`)
    .all(toMs, toMs, fromMs, mid ?? -1).map((g) => [g.t0, g.t1 ?? toMs])
    // Overlapping outages (a feed down while the radar restarted) are one interval.
    .reduce((out, g) => { const l = out[out.length - 1]; if (l && g[0] <= l[1]) l[1] = Math.max(l[1], g[1]); else out.push(g); return out; }, []);
}
// At start: gaps a previous run left open (it stopped mid-outage) end where that run's heartbeat stopped,
// inside the new run's own downtime gap.
export function closeDangling(t) { return Number(db.prepare("UPDATE j_gaps SET t1 = MAX(t0, ?) WHERE t1 IS NULL").run(Math.floor(t)).changes); }
// Closed gaps of the last `ms` that no coin has been read back for yet (their repair was cut off by a restart).
// Closed, repairable gaps overlapping [fromMs, now) that this coin has not been fully read back for: their ids.
// Only the last two hours' gaps (older ones are already past the journal's repair reach for a busy coin, and a
// chart spanning days would otherwise queue hundreds), newest first, at most 12.
export function gapIdsFor(mint, fromMs) {
  const mid = midOf(mint, false);
  return db.prepare(`SELECT g.id FROM j_gaps g WHERE g.t1 IS NOT NULL AND g.t1 > ? AND g.t1 - g.t0 <= ?
      AND NOT EXISTS (SELECT 1 FROM j_repairs r WHERE r.gap = g.id AND r.mid = ? AND r.full = 1) ORDER BY g.t1 DESC LIMIT 12`).all(Math.max(fromMs, now() - 2 * 3600e3), 2 * 3600e3, mid ?? -1).map((g) => g.id);
}
// A gap's repair run writes a row with mid -1 when it has been through every coin it meant to; a run cut off
// by a restart (no such row) is taken up again at the next start, skipping the coins already read back.
// (Unread blocks, feed "blocks", are read back per coin when a chart opens on them, not for every busy coin.)
export const unrepaired = (ms = 2 * 3600e3) => db.prepare("SELECT id FROM j_gaps WHERE feed != 'blocks' AND t1 IS NOT NULL AND t1 > ? AND NOT EXISTS (SELECT 1 FROM j_repairs r WHERE r.gap = j_gaps.id AND r.mid = -1) ORDER BY t1 DESC").all(now() - ms).map((g) => g.id);
export const openGaps = () => [...open.entries()].map(([feed, id]) => ({ feed, id }));
export const recentGaps = (n = 20) => db.prepare("SELECT g.*, (SELECT COUNT(*) FROM j_repairs r WHERE r.gap = g.id AND r.mid > 0 AND r.full = 1) repaired FROM j_gaps g ORDER BY id DESC LIMIT ?").all(n);

// The SOL price, a sample a minute, so a trade read back later is priced at its own moment.
const solIns = db.prepare("INSERT OR REPLACE INTO j_sol (t, px) VALUES (?, ?)"), solAt = db.prepare("SELECT px FROM j_sol WHERE t <= ? ORDER BY t DESC LIMIT 1"), solAfter = db.prepare("SELECT px FROM j_sol WHERE t > ? ORDER BY t LIMIT 1");
export function noteSol(px, t = now()) { if (px > 10 && px < 10_000) solIns.run(Math.floor(t / 60_000) * 60_000, px); }
export const solUsdAt = (t) => solAt.get(Math.floor(t))?.px ?? solAfter.get(Math.floor(t))?.px ?? null;

// ---------- decoding (read-back) ----------
// pump.fun's TradeEvent, as livetrades.js reads it: market cap in SOL from the curve's virtual reserves (1B supply).
export function decodeCurveTrade(buf) {
  if (buf.length < 8 + 32 + 8 + 8 + 1 + 32 + 8 + 8 + 8 + 8 + 8) return null;
  let o = 8;
  const mint = b58(buf.subarray(o, o += 32));
  const sol = Number(buf.readBigUInt64LE(o)) / 1e9; o += 8;
  const tokens = Number(buf.readBigUInt64LE(o)) / 1e6; o += 8;
  const buy = buf[o] === 1; o += 1;
  const user = b58(buf.subarray(o, o += 32)); o += 8;
  const vSol = Number(buf.readBigUInt64LE(o)) / 1e9; o += 8;
  const vTok = Number(buf.readBigUInt64LE(o)) / 1e6;
  if (!vTok) return null;
  // A curve quoted in another token (pumpquote.js): SOL-equivalents at the SOL price of now (the journal's, else 0).
  if (!vSol) {
    const q = quotedTrade(buf, solUsdAt(now()));
    return q && !q.pending ? { venue: VENUE.curve, mint, sol: q.sol, tokens, buy, mcSol: q.mcSol, user } : null;
  }
  const mcSol = (vSol / vTok) * 1e9;
  if (!(mcSol > 0) || mcSol > 5e6 || sol > 5000) return null;
  return { venue: VENUE.curve, mint, sol, tokens, buy, mcSol, user };
}
// PumpSwap's BuyEvent / SellEvent: pumpswap.js's own decoder (the executed price), so a trade read back
// is priced exactly as the live feed priced it. Side pools (under 3 SOL deep) are left out, as live.
export function decodeSwapEvent(buf, buy) {
  const e = decodeSwap(buf, buy);
  return e && e.depth >= 3 ? { venue: VENUE.pumpswap, pool: e.pool, buy, sol: e.sol, tokens: e.tokens, mcSol: e.mcSol, raw: buf } : null;
}
// Every trade event in a transaction's logs, in log order. Failed transactions say nothing happened.
export function eventsFromLogs(logs, err = null) {
  if (err) return [];
  const out = [];
  for (const l of logs || []) {
    if (!l.startsWith("Program data: ")) continue;
    const buf = Buffer.from(l.slice(14), "base64");
    if (buf.length < 8) continue;
    const disc = buf.toString("hex", 0, 8);
    const e = disc === TRADE ? decodeCurveTrade(buf) : disc === BUY ? decodeSwapEvent(buf, true) : disc === SELL ? decodeSwapEvent(buf, false) : null;
    if (e) out.push(e);
  }
  return out;
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf) {
  let n = 0n;
  for (const b of buf) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b) break; s = "1" + s; }
  return s;
}

// ---------- repair ----------
// The first few transactions heard for each coin after each moment: where reading a coin back starts (the
// chain lists a coin's transactions newest first; starting just after the outage skips everything since).
const heard = new Map();   // mint -> [[t, sig], ...] (a sample a second, last 20 minutes)
function hint(mint, t, sig) {
  let a = heard.get(mint);
  if (!a) { if (heard.size > 20_000) heard.clear(); heard.set(mint, (a = [])); }
  if (a.length && t - a[a.length - 1][0] < 1000) return;
  a.push([t, sig]);
  while (a.length && t - a[0][0] > 20 * 60_000) a.shift();
}
export const heardAfter = (mint, t) => heard.get(mint)?.find((x) => x[0] >= t) ?? null;
const hasK = db.prepare("SELECT 1 FROM j_trades WHERE k = ?");
// Whether a transaction's trades of this coin are stored (its first is enough: they are written together).
export const stored = (sig, mint) => Boolean(hasK.get(tradeKey(sig, mint, 0)));
// Reads a coin's transactions in [t0, t1] back from the chain and stores the trades the feeds missed.
// `poolMint(pool)` -> the coin a PumpSwap pool trades (or null), `supply(mint)` -> its supply for the market cap.
// Returns { n: trades added, seen: transactions read, full: whether the whole interval was read }.
export async function repairMint(mint, t0, t1, { poolMint = async () => null, poolInfo = () => null, supply = () => 1e9, maxTx = 400, call = rpc } = {}) {
  const from = Math.floor(t0 / 1000) - 5, to = Math.ceil(t1 / 1000) + 5;
  const sigs = [];
  // Start from the first transaction heard after the outage when there is one (everything newer is stored).
  let before = heardAfter(mint, t1)?.[1], full = false;
  for (let page = 0; page < 10 && sigs.length < maxTx; page++) {
    const list = await call("getSignaturesForAddress", [mint, { limit: 1000, commitment: "confirmed", ...(before ? { before } : {}) }]);
    if (!list?.length) { full = true; break; }
    for (const s of list) if (s.blockTime && s.blockTime >= from && s.blockTime <= to && !s.err) sigs.push(s);
    const oldest = list[list.length - 1];
    before = oldest.signature;
    if (!oldest.blockTime || oldest.blockTime < from) { full = true; break; }
    if (list.length < 1000) { full = true; break; }
  }
  if (sigs.length > maxTx) { sigs.length = maxTx; full = false; }
  let seenTx = 0;
  const r = await readBack(mint, sigs, { poolMint, poolInfo, supply,
    getTx: (sig) => { if ((++seenTx & 15) === 0) stats.repairStep = `${mint.slice(0, 8)} tx ${seenTx}/${sigs.length}`; return call("getTransaction", [sig, TX_OPTS]); } });
  return { n: r.n, seen: sigs.length, full: full && !r.incomplete };
}
const TX_OPTS = { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" };
// Stores the trades of `mint` in the transactions ({ signature, blockTime }) the journal lacks, read with
// `getTx(signature)` `conc` at a time. Returns { n: trades added, read: transactions fetched, failed:
// signatures that could not be read, incomplete: whether anything was left out (unreadable or unpriced) }.
// `poolInfo(pool)` -> the pool's sides when it is quoted in another token ({ qmint, qdec }: pumpswap.js decode
// prices its trades at the quote's dollar price), null for a SOL pool.
export async function readBack(mint, sigs, { getTx, poolMint = async () => null, poolInfo = () => null, supply = () => 1e9, conc = 1 } = {}) {
  const todo = sigs.filter((s) => !hasK.get(tradeKey(s.signature, mint, 0)));   // heard live: its trades are stored
  const rows = [], failed = [];
  let incomplete = false, next = 0;
  const one = async (s) => {
    let tx;
    // One transaction that cannot be read leaves the read-back incomplete (a gap stays), not abandoned.
    try { tx = await getTx(s.signature); } catch { tx = null; }
    if (!tx) { failed.push(s.signature); incomplete = true; return; }
    if (!tx.meta || tx.meta.err) return;
    let i = 0, occ = 0;
    for (let e of eventsFromLogs(tx.meta.logMessages, tx.meta.err)) {
      const coin = e.venue === VENUE.curve ? e.mint : await poolMint(e.pool);
      if (coin !== mint) continue;
      const nth = occ++;   // its place among this coin's trades in the transaction, kept or not
      // A pool quoted in another token: decoded again with its sides, in SOL-equivalents (as the live feed prices it).
      if (e.venue === VENUE.pumpswap) {
        const info = poolInfo(e.pool) ?? poolInfoOf(e.pool);
        if (info?.qmint) { const d = decodeSwap(e.raw, e.buy, info); if (!d) { incomplete = true; continue; } e = { ...e, sol: d.sol, tokens: d.tokens, mcSol: d.mcSol }; }
      }
      const mcSol = e.mcSol * ((supply(mint) ?? 1e9) / 1e9);   // both venues on the circulating supply, as live
      const t = (tx.blockTime ?? s.blockTime) * 1000 + 500 + i++;
      const px = solUsdAt(t);
      if (!px) { incomplete = true; continue; }   // no SOL price for that moment: not priced at today's
      rows.push([mint, t, tradeKey(s.signature, mint, nth), tx.slot ?? null, mcSol * px, e.sol * px, e.buy ? 1 : 0, e.venue, ST.confirmed, 1, e.user || null]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, conc) }, async () => { while (next < todo.length) await one(todo[next++]); }));
  let n = 0;
  flush();
  db.exec("BEGIN");
  try { for (const r of rows) { const res = ins.run(midOf(r[0]), ...r.slice(1, 10), widOf(r[10])); if (res.changes) n++; } db.exec("COMMIT"); }
  catch (e) { try { db.exec("ROLLBACK"); } catch {} throw e; }
  if (n) revised(mint);
  return { n, read: todo.length, failed, incomplete };
}
const putRepair = db.prepare("INSERT OR REPLACE INTO j_repairs (gap, mid, t, n, full) VALUES (?, ?, ?, ?, ?)");
export function markRepaired(gap, mint, n, full) { putRepair.run(gap, midOf(mint), now(), n, full ? 1 : 0); }

// After a gap closes: the coins that were trading just before it, and any being looked at, read back one at
// a time (the RPC is shared with everything else), busiest first, up to `limit` coins.
// `only`: just these coins (a chart opened on an outage), instead of the busiest ones.
export async function repairGap(gapId, { watched = [], limit = null, only = null, ...opts } = {}) {
  const g = db.prepare("SELECT * FROM j_gaps WHERE id = ?").get(gapId);
  stats.repairStep = `gap ${gapId}: choosing coins`;
  if (!g || g.t1 == null) return 0;
  // How many coins a gap is worth reading back: a few seconds' gap, the dozen busiest; a long one, up to 120.
  // Reading 120 coins back for every 4-second gap starved the RPC, which made the feeds fall behind, which
  // opened the next gap (2026-10-07 overnight: 40 gaps, the pump feed 26 slots behind).
  if (limit == null) limit = Math.max(12, Math.min(120, Math.round((g.t1 - g.t0) / 1000) * 2));
  // Longer than two hours (the PC was off): too many transactions to read back on a free RPC. Those coins'
  // charts keep Jupiter's history for the interval, and the gap stays recorded.
  if (g.t1 - g.t0 > 2 * 3600e3) return 0;
  const count = db.prepare("SELECT COUNT(*) n FROM j_trades WHERE mid = ? AND t >= ? AND t < ?");
  // Coins trading both before the outage and since it (one that stopped trading lost nothing to it).
  const busy = only ? [] : db.prepare("SELECT id, mint FROM j_mints WHERE last >= ?").all(g.t1)
    .map((m) => ({ mint: m.mint, n: count.get(m.id, g.t0 - 10 * 60_000, g.t0).n })).filter((m) => m.n).sort((a, b) => b.n - a.n).slice(0, limit).map((m) => m.mint);
  const mints = only ? [...only] : [...new Set([...watched, ...busy])].slice(0, limit);
  const fullQ = db.prepare("SELECT 1 FROM j_repairs WHERE gap = ? AND mid = ? AND full = 1");
  let done = 0;
  for (const mint of mints) {
    if (fullQ.get(g.id, midOf(mint))) { done++; continue; }   // read back in full on an earlier run
    stats.repairing = mint; stats.repairStep = `gap ${gapId}: ${mint.slice(0, 8)} signatures`;
    try {
      const r = await repairMint(mint, g.t0, g.t1, opts);
      markRepaired(g.id, mint, r.n, r.full);
      stats.repaired += r.n; done++;
    } catch (e) { stats.repairErrors++; stats.lastRepairError = `${mint.slice(0, 6)}…: ${e.message}`; }
  }
  stats.repairing = null; stats.repairs++; stats.repairStep = `gap ${gapId}: done (${done} coins)`;
  if (!only) putRepair.run(g.id, -1, now(), done, 1);   // this gap's run is complete (see unrepaired)
  return done;
}

// ---------- upkeep ----------
// In slices of 200 coins with a pause between, so the radar keeps answering while a day of trades goes.
// Bounded per pass (PRUNE_ROWS rows, then the next pass carries on where this one stopped): a pass that deleted a
// day of trades for every coin at once dirtied index pages all over a 1.7 GB table and wrote ~2 GB of write-ahead
// log in two minutes (2026-10-11 04:37); the checkpointer and the disk fell behind, every write waited seconds and
// the charts froze with them. Smaller transactions, a real pause between them, and the cursor goes round the coins.
const PRUNE_ROWS = 40_000, PRUNE_COINS = 50, PRUNE_PAUSE_MS = 40;
let pruneAt = 0;   // where the last pass stopped in the coin list
export async function prune(t = now()) {
  const cut = t - KEEP_MS;
  const del = db.prepare("DELETE FROM j_trades WHERE mid = ? AND t < ?");
  let n = 0;
  const ids = db.prepare("SELECT id FROM j_mints ORDER BY id").all();
  if (pruneAt >= ids.length) pruneAt = 0;
  const start = pruneAt;
  for (let done = 0; done < ids.length && n < PRUNE_ROWS; done += PRUNE_COINS) {
    const i = (start + done) % ids.length;
    db.exec("BEGIN");
    try { for (const { id } of ids.slice(i, i + PRUNE_COINS)) n += Number(del.run(id, cut).changes); db.exec("COMMIT"); }
    catch { try { db.exec("ROLLBACK"); } catch {} }
    pruneAt = (i + PRUNE_COINS) % ids.length;
    await new Promise((go) => setTimeout(go, PRUNE_PAUSE_MS));
  }
  // Coins with nothing left: forgotten (their ids are not reused while any row could still point at them).
  db.prepare("DELETE FROM j_mints WHERE last < ? AND NOT EXISTS (SELECT 1 FROM j_trades WHERE mid = j_mints.id)").run(cut);
  mids.clear();
  db.prepare("DELETE FROM j_sol WHERE t < ?").run(cut - 3600e3);
  // A generation's wallet rows are used only by trades made while it was current (12 h), so once the next
  // generation began before the cut, every row below that next generation's first id can go.
  const gens = db.prepare("SELECT start, first_id FROM j_wgen ORDER BY start").all();
  for (let i = 0; i + 1 < gens.length && gens[i + 1].start < cut; i++) {
    // A generation is hundreds of thousands of wallet rows: deleted 2,000 at a time with a pause, not in one statement.
    const old = db.prepare("DELETE FROM j_wallets WHERE id IN (SELECT id FROM j_wallets WHERE id < ? LIMIT 2000)");
    for (let k = 0; k < 2000; k++) { if (Number(old.run(gens[i + 1].first_id).changes) < 2000) break; await new Promise((go) => setTimeout(go, PRUNE_PAUSE_MS)); }
    db.prepare("DELETE FROM j_wgen WHERE start = ?").run(gens[i].start);
  }
  db.prepare("DELETE FROM j_repairs WHERE gap IN (SELECT id FROM j_gaps WHERE t1 IS NOT NULL AND t1 < ?)").run(cut);
  db.prepare("DELETE FROM j_gaps WHERE t1 IS NOT NULL AND t1 < ?").run(cut);
  stats.pruned += n;
  return n;
}
// Counting millions of rows takes a moment: counted at most once a minute.
let counted = { t: 0, n: 0 };
export function summary() {
  if (now() - counted.t > 60_000) counted = { t: now(), n: db.prepare("SELECT COUNT(*) n FROM j_trades").get().n };
  return { ...stats, rows: counted.n, keepHours: KEEP_MS / 3600e3, open: openGaps(), gaps: recentGaps(8) };
}
export const lastAlive = () => getMeta.get("alive")?.v ?? null;
