// Follows every confirmed block of the chain, on a thread of its own, and hands the main thread the pump.fun
// curve and PumpSwap transactions in it (signature, slot, and the "Program data" log lines only). The free
// log websockets skip a third to a half of a busy coin's trades and never say which (2026-10-09); a block
// holds every transaction, so a trade they skipped is found here a few seconds later (journalfeed.js).
// A block is ~4 MB of JSON (brotli on the wire, ~0.9 s on publicnode); parsing 2.5 of them a second is kept
// off the radar's thread. Two free sources serve whole blocks (of eleven tried, 2026-10-09): publicnode first,
// mainnet-beta when publicnode rate limits (each rests on its own). Node built-ins only.
import { parentPort, workerData } from "node:worker_threads";
import fs from "node:fs";

const { urls = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"], conc = 4, programs = [], cursorFile = null } = workerData || {};
const now = () => Date.now();
const post = (m) => { try { parentPort.postMessage(m); } catch {} };
const stats = { tip: 0, next: 0, behind: 0, blocks: 0, skipped: 0, txs: 0, limited: 0, errors: 0, lastError: null, mb: 0, lastBlockAt: 0, jumped: 0 };
const invokes = programs.map((p) => `Program ${p} invoke`);
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// (the same as livetrades.js b58)
function b58(buf) {
  let zeros = 0;
  while (zeros < buf.length && buf[zeros] === 0) zeros++;
  const d = new Uint8Array(((buf.length * 138) / 100 + 1) | 0);
  let len = 0;
  for (let i = zeros; i < buf.length; i++) {
    let c = buf[i];
    for (let j = 0; j < len; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; }
    while (c > 0) { d[len++] = c % 58; c = (c / 58) | 0; }
  }
  let s = "1".repeat(zeros);
  for (let j = len - 1; j >= 0; j--) s += B58[d[j]];
  return s;
}
// v1 transactions (first byte 0x81) keep their signatures at the END, their count in byte 1 (checked against
// the json encoding: 143 of 143, 2026-10-09); legacy and v0 start with the count, then the signatures.
function sigOf(t) {
  if (!Array.isArray(t)) return t?.signatures?.[0] ?? null;
  const b = Buffer.from(t[0], "base64");
  if (b[0] >= 0x80) { const n = b[1]; return n > 0 && b.length >= 64 * n + 2 ? b58(b.subarray(b.length - 64 * n, b.length - 64 * n + 64)) : null; }
  return b.length >= 65 && b[0] > 0 ? b58(b.subarray(1, 65)) : null;
}
// What a transaction paid on top of its trade, in lamports: the network fee (base + priority, meta.fee) and the
// SOL its signers sent straight to an account that did not sign (top-level System transfers: Jito and the other
// landing services' tips, trading bots' and terminals' fees). Not wrapped SOL (an account a SyncNative tops up
// is the trader's own), and not a single transfer over 2 SOL (a payment, not a fee). For "fees paid" on a coin
// (coinfees.js). Checked against the jsonParsed encoding on live pump.fun transactions, both layouts (2026-10-10).
function feeOf(t, meta) {
  let fee = Number(meta.fee) || 0;
  if (!Array.isArray(t)) return fee;
  try {
    const b = Buffer.from(t[0], "base64"), ixs = [];   // [program index, accounts at, count, data at, length]
    let o = 0, signers, nk, keys;
    const cu = () => { let v = 0, s = 0, x; do { x = b[o++]; v |= (x & 0x7f) << s; s += 7; } while (x & 0x80); return v; };
    if (b[0] === 0x81) {
      // v1: version, the 3 header counts, a u32 mask of compute settings (4 bytes each), blockhash, instruction
      // and key counts, the keys, the settings, 4-byte instruction heads (program, accounts, u16 data length),
      // then each instruction's accounts and data; the signatures at the end.
      signers = b[1]; const mask = b.readUInt32LE(4), ni = b[40]; nk = b[41]; keys = 42;
      let bits = 0; for (let m = mask; m; m &= m - 1) bits++;
      let h = keys + nk * 32 + bits * 4; o = h + ni * 4;
      for (let n = 0; n < ni; n++, h += 4) { const na = b[h + 1], dl = b.readUInt16LE(h + 2); ixs.push([b[h], o, na, o + na, dl]); o += na + dl; }
    } else if (b[0] < 0x80) {
      const ns = cu(); o += ns * 64;
      if (b[o] & 0x80) o++;
      signers = b[o]; o += 3;
      nk = cu(); keys = o; o += nk * 32 + 32;
      for (let n = cu(); n > 0; n--) { const prog = b[o++], na = cu(), at = o; o += na; const dl = cu(); ixs.push([prog, at, na, o, dl]); o += dl; }
    } else return fee;
    const sys = (i) => { if (i >= nk) return false; for (let k = 0; k < 32; k++) if (b[keys + i * 32 + k]) return false; return true; };
    const wrapped = new Set();
    for (const [, acc, na, d, dl] of ixs) if (dl === 1 && b[d] === 17 && na) wrapped.add(b[acc]);
    for (const [prog, acc, na, d, dl] of ixs) {
      if (dl !== 12 || na < 2 || b.readUInt32LE(d) !== 2 || !sys(prog)) continue;
      const from = b[acc], to = b[acc + 1], lam = Number(b.readBigUInt64LE(d + 4));
      if (from < signers && to >= signers && !wrapped.has(to) && lam <= 2e9) fee += lam;
    }
  } catch { /* a layout this does not know: the network fee alone */ }
  return fee;
}

// Each source is paced (calls a second) rather than run into its limits: slots are ~215 ms now (4.6 blocks a
// second, 2026-10-09), and publicnode alone refuses that many getBlock calls. A rate limit rests the source
// (mainnet-beta's "data allowance" longer) and cuts its pace by a tenth; 20 clean seconds raise it by a twentieth,
// up to its cap. { limited: true } when no source has a call to give: the caller waits; it is not a failed try.
// Kept under what publicnode would give (~4/s): the rest is left for an open chart's own check against the chain
// (journalfeed.js reconcile), which must always get through; at 4.2 it starved (2538 of 3305 reads refused, 2026-10-09).
const CAPS = { "solana-rpc.publicnode.com": 2.6, "api.mainnet-beta.solana.com": 1.2 };
const src = new Map(urls.map((u) => { const host = new URL(u).hostname, cap = CAPS[host] ?? 2; return [u, { host, cap, rate: cap * 0.8, next: 0, rest: 0, calls: 0, limited: 0, cleanSince: now() }]; }));
stats.bySource = {};
const pick = () => { const t = now(); for (const [u, x] of src) if (x.rest <= t && x.next <= t) return u; return null; };
const awake = () => [...src.values()].some((x) => x.rest <= now());
// The next call a source can make: waited for here (its pace), unless every source is resting after a limit.
async function slotFor() {
  for (;;) {
    const url = pick();
    if (url) return url;
    const up = [...src.values()].filter((x) => x.rest <= now());
    if (!up.length) return null;
    await new Promise((ok) => setTimeout(ok, Math.max(5, Math.min(...up.map((x) => x.next)) - now())));
  }
}
async function call(method, params) {
  for (let i = 0; i < src.size; i++) {
    const url = await slotFor();
    if (!url) return { limited: true };
    const x = src.get(url);
    x.next = Math.max(now(), x.next) + 1000 / x.rate;
    x.calls++;
    let r, text;
    try {
      r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
      text = await r.text();
    } catch (e) { stats.errors++; stats.lastError = e.message; continue; }
    stats.mb += text.length / 1e6;
    let j = null;
    try { j = JSON.parse(text); } catch {}
    const msg = j?.error?.message || (j ? "" : text.slice(0, 120));
    if (r.status === 429 || j?.error?.code === -32005 || j?.error?.code === 429 || /rate limit|too many|allowance/i.test(msg)) {
      stats.limited++; x.limited++;
      x.rest = now() + (/allowance/i.test(msg) ? 30_000 : 3000);
      x.rate = Math.max(0.3, x.rate * 0.9); x.cleanSince = now();
      continue;
    }
    if (now() - x.cleanSince > 20_000) { x.rate = Math.min(x.cap, x.rate * 1.05); x.cleanSince = now(); }
    return j ?? { error: { message: msg } };
  }
  return { limited: true };
}
setInterval(() => { for (const x of src.values()) stats.bySource[x.host] = { rate: +x.rate.toFixed(2), calls: x.calls, limited: x.limited }; }, 2000);

// The chain tip at "confirmed", every second.
async function tipLoop() {
  for (;;) {
    try {
      const j = await call("getSlot", [{ commitment: "confirmed" }]);
      if (j.result > stats.tip) { stats.tip = j.result; tipAt = now(); }
    } catch (e) { stats.errors++; stats.lastError = e.message; }
    await new Promise((ok) => setTimeout(ok, 3000));
  }
}
let tipAt = 0;
// Where the tip is now: the last one read, moved on ~215 ms a slot (never more than 3 s ahead of a reading).
// Two slots short of the guess: a slot asked for before it is confirmed is a wasted call ("not available").
const tipNow = () => stats.tip ? stats.tip + Math.max(0, Math.floor(Math.min(3000, now() - tipAt) / 215) - 2) : 0;

// One block: its trade transactions to the main thread. Returns true when done with the slot (read, or the
// slot has no block), "limited" when every source is resting (not counted as a try), false to try it again
// later (too fresh, or a network error).
async function block(slot) {
  let j;
  // base64: the transaction itself comes as one string (its signature is read from the first bytes below), not a
  // tree of thousands of objects per block: 12 ms to parse instead of 29, and far less garbage (2026-10-09).
  try { j = await call("getBlock", [slot, { encoding: "base64", transactionDetails: "full", maxSupportedTransactionVersion: 1, rewards: false, commitment: "confirmed" }]); }
  catch (e) { stats.errors++; stats.lastError = e.message; return false; }
  if (j.limited) return "limited";
  if (j.error) {
    // -32007 skipped by its leader, -32009 missing from long-term storage: nothing to read, ever.
    if (j.error.code === -32007 || j.error.code === -32009 || /skipped/i.test(j.error.message)) { stats.skipped++; return true; }
    stats.lastError = j.error.message; return false;   // -32004 "not available" yet, or a passing error
  }
  const b = j.result;
  if (!b) return false;
  const txs = [];
  for (const tx of b.transactions || []) {
    const logs = tx.meta?.logMessages;
    if (!logs || tx.meta.err) continue;
    if (!logs.some((l) => invokes.some((p) => l.startsWith(p)))) continue;
    const data = logs.filter((l) => l.startsWith("Program data: "));
    const sig = sigOf(tx.transaction);
    if (data.length && sig) txs.push([sig, data, feeOf(tx.transaction, tx.meta)]);
  }
  stats.blocks++; stats.txs += txs.length; stats.lastBlockAt = now();
  if (txs.length) post({ op: "block", slot, time: b.blockTime ?? null, txs });
  return true;
}

// Order: the newest blocks first, so the live end of every chart is whole within seconds; anything older
// that is not read yet waits in a backlog, read newest first with the capacity left over. The free sources give
// about as many blocks a second as the chain makes (2026-10-09), so after a restart or a rate-limited stretch the
// backlog can stay. A slot that leaves the backlog unread (older than BACK_MAX, or refused 40 times) is said as
// "lost": the radar records that moment as a gap, and a chart opened on it reads its coin back from the chain.
// LAG_MAX: the free sources read ~2 of the chain's ~4.6 blocks a second (2026-10-11), so the follower can never
// catch up; chasing in order it fell 60 slots (~13 s) behind before jumping, and every fee (coinfees.js) and missed
// trade was that late. It now jumps after 10 slots (~2 s): the same share of blocks is read, always the newest.
const LAG_MAX = 10, BACK_MAX = 2800;   // slots (~2 s, ~10 min at ~215 ms a slot)
const inflight = new Set();
const backlog = [];                    // [from, to] slot ranges (inclusive), oldest first
const retry = new Map();               // slot -> { n: tries, at: when to try again }
const backlogSize = () => backlog.reduce((n, [a, b]) => n + b - a + 1, 0);
function toBacklog(from, to) { if (to >= from) backlog.push([from, to]); }
function lose(from, to) { if (to >= from) { stats.lost = (stats.lost || 0) + to - from + 1; post({ op: "lost", from, to }); } }
function takeBacklog() {
  const r = backlog[backlog.length - 1];
  if (!r) return null;
  const slot = r[1]--;
  if (r[1] < r[0]) backlog.pop();
  return slot;
}
// Where to start: the first slot not yet read when the radar stopped (saved every 2 s), so a restart misses no
// block: the time it was away goes to the backlog. A cursor older than BACK_MAX is too old to read; lost.
function resumeFrom() {
  try {
    const c = JSON.parse(fs.readFileSync(cursorFile, "utf8"));
    if (c.slot > 0 && c.slot < stats.tip) {
      stats.resumedFrom = c.slot;
      const keep = Math.max(c.slot, stats.tip - BACK_MAX);
      lose(c.slot, keep - 1);
      toBacklog(keep, stats.tip - 1);
    }
  } catch {}
  return stats.tip;
}
function saveCursor() {
  if (!cursorFile || !stats.next) return;
  const low = Math.min(stats.next, ...inflight, ...retry.keys(), ...backlog.map((r) => r[0]));
  try { fs.writeFileSync(cursorFile + ".tmp", JSON.stringify({ slot: low, t: now() })); fs.renameSync(cursorFile + ".tmp", cursorFile); } catch {}
}
function prune() {
  const cut = tipNow() - BACK_MAX;
  while (backlog.length && backlog[0][0] < cut) {
    const r = backlog[0];
    if (r[1] < cut) { lose(r[0], r[1]); backlog.shift(); } else { lose(r[0], cut - 1); r[0] = cut; }
  }
  for (const [s] of retry) if (s < cut) { retry.delete(s); lose(s, s); }
}
function nextSlot() {
  const tip = tipNow();
  for (const [s, r] of retry) if (r.at <= now()) { retry.delete(s); return s; }
  // Fallen more than LAG_MAX behind: jump to the tip, the slots between go to the backlog.
  if (tip - stats.next > LAG_MAX) { toBacklog(stats.next, tip - 6); stats.next = tip - 5; }
  if (stats.next <= tip) return stats.next++;
  return takeBacklog();
}
async function worker() {
  for (;;) {
    if (!awake() || !stats.tip) { await new Promise((ok) => setTimeout(ok, 250)); continue; }
    if (!stats.next) stats.next = resumeFrom();
    const slot = nextSlot();
    if (slot == null) { await new Promise((ok) => setTimeout(ok, 100)); continue; }
    inflight.add(slot);
    const done = await block(slot).finally(() => inflight.delete(slot));
    if (done === true) continue;
    const r = retry.get(slot) || { n: 0 };
    if (done === "limited") { retry.set(slot, { n: r.n, at: now() + 500 }); continue; }
    // A slot that will not come (40 tries over ~minutes) is said, not waited on forever.
    if (++r.n > 40) { lose(slot, slot); continue; }
    retry.set(slot, { n: r.n, at: now() + Math.min(5000, 300 * r.n) });
  }
}

tipLoop();
// Enough readers for the paced rate (a block takes ~0.9 s); the pacing, not the reader count, sets the speed.
for (let i = 0; i < conc; i++) worker();
setInterval(saveCursor, 2000);
setInterval(prune, 5000);
setInterval(() => { stats.behind = Math.max(0, tipNow() - stats.next); stats.backlog = backlogSize() + retry.size; post({ op: "stats", ...stats, pending: retry.size }); }, 2000);
