// Snipers and bundlers for any coin, from its first blocks on the chain: for coins the holder ledger did not
// see from their first trade (holders.js genesis), which is every older coin on Discover and Fomo's lists.
// No public API carries these (Jupiter, RugCheck, DexScreener, GeckoTerminal checked 2026-10-08); Axiom and GMGN
// have them from their own indexers. Helius's getTransactionsForAddress pages a coin's history oldest first
// (free key), so the launch is two calls away:
//   1. the first 100 signatures of the mint, oldest first: the launch slot S is the first one;
//   2. those in slots S..S+SNIPE_SLOTS in full: every wallet whose balance of the coin rose in them.
// Bundle = wallets other than the dev that bought in the launch slot itself; snipers = wallets that first bought
// in the next SNIPE_SLOTS slots (holders.js's rules). Who they are never changes, so it is kept on disk for good;
// what they still hold is read from their token accounts (one getMultipleAccounts on the public RPC) while the
// coin is on screen, at most once a minute.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA } from "./db.js";
import { settings } from "./settings.js";
import { keyUrls, monthUsed, noteCall } from "./heliuskeys.js";
import { onCurve } from "./holderslive.js";
import { b58 } from "./livetrades.js";
import * as jupdisc from "./jupdisc.js";

const SNIPE_SLOTS = 2;
const PUBLIC = "https://api.mainnet-beta.solana.com";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const FILE = path.join(DATA, "snipers.json");
const HOLD_MS = 120_000, WANT_MS = 60_000;
const now = () => Date.now();
export const snipeStats = { found: 0, reads: 0, errors: 0, lastError: null, queue: 0, known: 0 };

const who = new Map();       // mint -> { t, slot, dev, program, snipers: [wallet], bundle: [wallet] } | { t, fail }
const held = new Map();      // mint -> { t, sn, bd }  (percent of supply still held)
const wanted = new Map();    // mint -> last asked
let dirty = false;

// ---------- base58 and program addresses ----------
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function unb58(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; out.unshift(0); }
  while (out.length < 32) out.unshift(0);
  return Buffer.from(out);
}
// A program address from its seeds (Solana's find_program_address).
const pdaMemo = new Map();
export function pdaOf(seeds, programId) {
  const k = seeds.map((x) => Buffer.from(x).toString("hex")).join("|") + programId;
  if (pdaMemo.has(k)) return pdaMemo.get(k);
  const pid = unb58(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash("sha256");
    for (const sd of seeds) h.update(Buffer.from(sd));
    h.update(Buffer.from([bump])); h.update(pid); h.update("ProgramDerivedAddress");
    const addr = b58(h.digest());
    if (!onCurve(addr)) { pdaMemo.set(k, addr); if (pdaMemo.size > 20_000) pdaMemo.clear(); return addr; }
  }
  return null;
}
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
// A pump.fun coin's bonding curve account: every curve trade touches it and nothing after bonding does, so its
// history is the curve's alone (a few hundred to a few thousand transactions), where the mint's runs to millions.
const curveOf = (mint) => pdaOf([Buffer.from("bonding-curve"), unb58(mint)], PUMP);

// A wallet's associated token account for a coin (the address almost every wallet holds it in).
const ataMemo = new Map();
export function ataOf(owner, mint, program) {
  const k = `${owner}${mint}${program}`;
  if (ataMemo.has(k)) return ataMemo.get(k);
  const seeds = [unb58(owner), unb58(program), unb58(mint)], pid = unb58(ATA);
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash("sha256");
    for (const s of seeds) h.update(s);
    h.update(Buffer.from([bump])); h.update(pid); h.update("ProgramDerivedAddress");
    const addr = b58(h.digest());
    if (!onCurve(addr)) { ataMemo.set(k, addr); if (ataMemo.size > 20_000) ataMemo.clear(); return addr; }
  }
  return null;
}

async function call(url, method, params, timeout = 15_000) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(timeout) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}

// ---------- who sniped and bundled ----------
// Helius credits: a launch read is one request; at most settings.snipeDailyReads (default 200) new coins a day.
// ~100 credits a request (measured 2026-10-08): 200 a day is ~20K credits. Launches the ledger watched cost nothing
// (recordLaunch), so these are only coins that launched before the radar was running.
// The count is kept on disk, so restarts do not reset it.
const SPEND_FILE = path.join(DATA, "snipers-spend.json");
let { day, spent } = (() => { try { const j = JSON.parse(fs.readFileSync(SPEND_FILE, "utf8")); return j.unit === "credits" ? j : { day: "", spent: 0 }; } catch { return { day: "", spent: 0 }; } })();
// In credits: 100 for an oldest-first page, 1 for each standard call. 25,000 a day by default (settings.snipeDailyCredits).
// The launch reads share both free Helius keys with the chart stream (heliuskeys.js books every call against the
// key's paced day): at 25,000 a day spent in the first hours (2026-10-09: ~20,000 by 01:20 UTC) they left the
// open charts on the slow fallback for the rest of the day. So a smaller share, paced through the day like the keys
// (the share up to this hour plus a 3-hour head start).
const DAY_CREDITS = () => +settings.snipeDailyCredits || 12_000;
const PACED_CREDITS = () => { const d = new Date(); return Math.round(DAY_CREDITS() * Math.min(1, (d.getUTCHours() + d.getUTCMinutes() / 60 + 3) / 24)); };
let spendSaved = 0;
function spendCredits(n) {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; spent = 0; }
  spent += n; snipeStats.today = spent;
  if (now() - spendSaved > 5000) { spendSaved = now(); fs.promises.writeFile(SPEND_FILE, JSON.stringify({ day, spent, unit: "credits" })).catch(() => {}); }
}
function spendFind() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; spent = 0; }
  if (spent + 100 > PACED_CREDITS()) return false;
  spendCredits(100);
  return true;
}
function hasBuyAndAfter(txs, mint) {
  let first = null;
  for (const t of txs) {
    if (first != null) { if (t.slot > first + SNIPE_SLOTS) return true; continue; }
    const pre = new Map((t.meta?.preTokenBalances || []).filter((b) => b.mint === mint).map((b) => [b.owner, b.uiTokenAmount?.uiAmount || 0]));
    if ((t.meta?.postTokenBalances || []).some((b) => b.mint === mint && b.owner && (b.uiTokenAmount?.uiAmount || 0) > (pre.get(b.owner) || 0) && onCurve(b.owner))) first = t.slot;
  }
  return false;
}
// The free way, for coins with under 1,000 transactions (nearly every coin under a few hours old): the public RPC
// lists a coin's whole history newest first in one call, so its oldest slots are known; their transactions are
// fetched in one batched request. Returns null when the coin is too busy for that (Helius's oldest-first read then).
// The public RPC's data allowance is per IP and shared with the live trade feeds: at most one free read every 4 s,
// none for a minute after it refuses anything.
let freeNext = 0;
// pump.fun's own coins: the vanity suffix, or Jupiter naming pump.fun as the launchpad.
const pumpish = (mint) => mint.endsWith("pump") || jupdisc.figures(mint, "24h")?.launchpad === "pump.fun";
const bigCoins = new Set();    // coins the free lane found too busy (1,000+ transactions): Helius reads them
function isBig(mint) {
  if (bigCoins.has(mint)) return true;
  if (pumpish(mint)) return false;   // its curve's history is small whatever the coin's trading since
  const fj = jupdisc.figures(mint, "24h");
  if (fj && (fj.buys || 0) + (fj.sells || 0) > 900) { bigCoins.add(mint); return true; }
  return false;
}
async function findLaunchFree(mint) {
  if (now() < freeNext) return "busy";
  freeNext = now() + 1500;
  const addr = pumpish(mint) ? curveOf(mint) : mint;
  let sigs = [], before = null;
  for (let page = 0; page < 6; page++) {
    const part = await cheapCall("getSignaturesForAddress", [addr, { limit: 1000, commitment: "confirmed", ...(before ? { before } : {}) }], 20_000);
    if (!Array.isArray(part)) throw new Error("no answer");
    sigs.push(...part);
    if (part.length < 1000) break;
    if (page === 5) return "big";
    before = part[part.length - 1].signature;
  }
  const ok = sigs.filter((x) => !x.err).reverse();           // oldest first
  if (!ok.length) return "none";
  const first = ok[0].slot;
  const early = ok.filter((x) => x.slot <= first + SNIPE_SLOTS + 1).slice(0, 60);
  const txs = [];
  for (let i = 0; i < early.length; i += 8) {
    const url = cheapUrl();
    const body = early.slice(i, i + 8).map((x, j) => ({ jsonrpc: "2.0", id: i + j, method: "getTransaction", params: [x.signature, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }] }));
    if (/helius/i.test(url)) { for (const _ of body) noteCall(url, "getTransaction"); spendCredits(body.length); }
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
    const arr = await r.json();
    if (!Array.isArray(arr)) throw new Error(arr?.error?.message || "batch refused");
    const got = arr.sort((a, b) => a.id - b.id).map((x) => x.result).filter((t) => t && !t.meta?.err);
    if (got.length < body.length * 0.8 && arr.some((x) => x.error)) throw new Error("rate limit (batch partly answered)");
    txs.push(...got);
    if (i + 8 < early.length) await new Promise((ok) => setTimeout(ok, 250));
  }
  const out = launchFrom(txs, mint);
  // Nobody bought in the first slots seen: the first buy is later than this window covers; Helius looks further.
  return out.slot == null ? "none" : out;
}
let keyTurn = 0;
// A Helius key's HTTP URL for standard calls (about 1 credit each), in turn; the public RPC when no key is set.
// The "free lane" reads (signatures, the first slots' transactions, holders' balances) go through a Helius key
// only while this file's paced day share lasts; after that the public RPC. Unchecked, they sent every read to
// Helius and cost ~15,000 credits a key by 02:20 UTC (2026-10-09), leaving the chart stream nothing.
function cheapUrl() {
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; spent = 0; }
  const keys = spent < PACED_CREDITS() ? keyUrls().filter((u) => !monthUsed(u)) : [];
  return keys.length ? keys[(keyTurn++) % keys.length].replace(/^ws/i, "http") : (String(settings.rpcUrl || "").trim() || PUBLIC);
}
async function cheapCall(method, params, timeout) {
  const url = cheapUrl();
  if (/helius/i.test(url)) { noteCall(url, method); spendCredits(1); }
  return call(url, method, params, timeout);
}
async function findLaunch(mint) {
  // Plainly busy already (900+ trades in Jupiter's last 24 h): past what the free lane can read in one call.
  const free = isBig(mint) ? "big" : await findLaunchFree(mint).catch((e) => { if (/rate limit|429|allowance|partly/i.test(e.message)) freeNext = now() + 10_000; return "busy"; });
  const out = snipeStats.out ||= {}; out[typeof free === "object" ? "freeOk" : "free_" + free] = (out[typeof free === "object" ? "freeOk" : "free_" + free] || 0) + 1;
  if (free && typeof free === "object") { snipeStats.free = (snipeStats.free || 0) + 1; return free; }
  // The free lane is resting or busy: a coin it can read (under 1,000 transactions) waits a few seconds for it
  // rather than spending a Helius request; one it already found too busy goes to Helius.
  if (free === "busy" && !bigCoins.has(mint)) throw new Error("wait: free lane");
  if (free === "big") bigCoins.add(mint);
  // Any configured Helius key not near its month's end, in turn (the chart stream's daily budget does not apply:
  // each request is booked against it below, so the stream sees what these cost).
  const keys = keyUrls().filter((u) => !monthUsed(u));
  if (!keys.length) throw new Error("needs a Helius key (Settings: chart stream URL)");
  const ws = keys[(keyTurn++) % keys.length], url = ws.replace(/^ws/i, "http");
  // One call (Helius bills per request): the first 100 transactions in full, which covers the launch slot and the
  // two after it for all but the most bundled launches.
  if (!spendFind()) throw new Error("daily allowance of launch reads used");
  let txs = [], token = null;
  for (let page = 0; page < 2; page++) {
    if (page && !spendFind()) break;
    noteCall(url, "getTransactionsForAddress");
    const full = await call(url, "getTransactionsForAddress", [mint, { transactionDetails: "full", sortOrder: "asc", limit: 100, encoding: "json", maxSupportedTransactionVersion: 1, ...(token ? { paginationToken: token } : {}) }], 25_000);
    txs.push(...(full?.data || []).filter((t) => !t.meta?.err));
    token = full?.paginationToken || null;
    // Enough once a wallet has bought and the history runs past the two slots after that buy.
    if (!token || hasBuyAndAfter(txs, mint)) break;
  }
  snipeStats.out.helius = (snipeStats.out.helius || 0) + 1;
  return launchFrom(txs, mint);
}
function launchFrom(txs, mint) {
  let program = null, dev = null, launch = null;
  const firstBuy = new Map();   // wallet -> slot of its first rise
  for (const t of txs) {
    const meta = t.meta || {};
    const pre = new Map();
    for (const b of meta.preTokenBalances || []) if (b.mint === mint) pre.set(b.owner, b.uiTokenAmount?.uiAmount || 0);
    for (const b of meta.postTokenBalances || []) {
      if (b.mint !== mint || !b.owner) continue;
      program ||= b.programId || null;
      const rise = (b.uiTokenAmount?.uiAmount || 0) - (pre.get(b.owner) || 0);
      if (!(rise > 0) || !onCurve(b.owner)) continue;    // pools, curves, vaults: program addresses, not buyers
      if (launch == null) { launch = t.slot; dev = t.transaction?.message?.accountKeys?.[0] || null; }
      if (t.slot > launch + SNIPE_SLOTS) continue;
      if (!firstBuy.has(b.owner)) firstBuy.set(b.owner, t.slot);
    }
  }
  if (launch == null) return { t: now(), slot: null, dev: null, program: program || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", snipers: [], bundle: [], none: true };
  const bundle = [], snipers = [];
  for (const [w, slot] of firstBuy) { if (w === dev) continue; (slot === launch ? bundle : snipers).push(w); }
  return { t: now(), slot: launch, dev, program: program || "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", snipers: snipers.slice(0, 100), bundle: bundle.slice(0, 100) };
}

// ---------- what they still hold ----------
// Many coins in one getMultipleAccounts (100 accounts a call): each coin's mint account (its supply, parsed) and
// its snipers' and bundlers' token accounts, so a list of 15-20 coins costs one call on the public RPC.
async function readHeldBatch(mints) {
  const keys = [], plan = [];
  for (const mint of mints) {
    const w = who.get(mint), wallets = w.program ? [...w.snipers, ...w.bundle, ...(w.dev ? [w.dev] : [])] : [];
    if (keys.length && keys.length + 1 + wallets.length > 100) break;
    plan.push({ mint, w, at: keys.length, wallets });
    keys.push(mint, ...wallets.slice(0, 99).map((o) => ataOf(o, mint, w.program)));
  }
  const r = await cheapCall("getMultipleAccounts", [keys, { encoding: "jsonParsed", commitment: "processed" }]);
  const v = r?.value || [];
  for (const p of plan) {
    const info = v[p.at]?.data?.parsed?.info, dec = info?.decimals ?? 6, supply = info?.supply ? Number(info.supply) / 10 ** dec : null;
    // The token program was not known (a launch the ledger recorded): learned from the mint, read again in a second.
    if (!p.w.program) { if (v[p.at]?.owner) { p.w.program = v[p.at].owner; dirty = true; } held.set(p.mint, { ...(held.get(p.mint) || {}), t: now() - HOLD_MS + 1000 }); continue; }
    // Unreadable this time: the last good figures stand (blanking them made 20 rows go empty at once), retried in 30 s.
    if (!(supply > 0)) { held.set(p.mint, { ...(held.get(p.mint) || {}), t: now() - HOLD_MS + 30_000 }); snipeStats.noSupply = (snipeStats.noSupply || 0) + 1; continue; }
    const amt = new Map();
    p.wallets.slice(0, 99).forEach((o, i) => amt.set(o, v[p.at + 1 + i]?.data?.parsed?.info?.tokenAmount?.uiAmount || 0));
    const pct = (list) => +((list.reduce((x, o) => x + (amt.get(o) || 0), 0) / supply) * 100).toFixed(2);
    held.set(p.mint, { t: now(), sn: pct(p.w.snipers), bd: pct(p.w.bundle), dev: p.w.dev ? pct([p.w.dev]) : null, snOut: p.w.snipers.filter((o) => !(amt.get(o) > 0)).length });
  }
  return plan.length;
}

// ---------- launches the trade ledger saw (holders.js) ----------
// Every pump.fun coin the radar watched from its first trade: who bundled and sniped is known there for free; kept
// here for good, so the figures outlive the ledger's book (dropped after 30 quiet minutes).
export function recordLaunch(mint, { snipers, bundle, dev, slot }) {
  const w = who.get(mint);
  if (w && !w.fail && !w.fromLedger) return;
  who.set(mint, { t: now(), slot: slot ?? null, dev: dev || null, program: null, snipers: [...snipers].slice(0, 100), bundle: [...bundle].slice(0, 100), fromLedger: true });
  held.delete(mint); dirty = true;
  snipeStats.ledger = (snipeStats.ledger || 0) + 1;
}

export function snipeDebug(mint) {
  return { who: who.get(mint) ? { ...who.get(mint), snipers: who.get(mint).snipers?.length, bundle: who.get(mint).bundle?.length } : null, held: held.get(mint) || null, wanted: wanted.has(mint), inflight: inflight.has(mint), big: bigCoins.has(mint) };
}

// ---------- asked by the pages ----------
// { sn, snN, bd, bdN } for a coin (percent still held, wallet counts), or null while unknown; asking queues it.
export function snipeFor(mint) {
  wanted.set(mint, now());
  const w = who.get(mint), h = held.get(mint);
  if (w && !w.fail && !w.snipers.length && !w.bundle.length && !w.dev) return { sn: 0, snN: 0, snOut: 0, bd: 0, bdN: 0, dev: null };
  if (!w || w.fail || !h?.t || h.sn == null) return null;
  return { sn: w.snipers.length ? h.sn : 0, snN: w.snipers.length, snOut: h.snOut, bd: w.bundle.length ? h.bd : 0, bdN: w.bundle.length, dev: h.dev ?? null };
}

// Two lanes: launch reads (Helius, one request each, every 0.5 s) and holding reads (public RPC, every 1.2 s), so a
// list of new coins is read in a minute or two while the holdings of those already known keep moving.
const lane = { find: { busy: false, last: 0, gap: 700 }, find2: { busy: false, last: 350, gap: 700 }, held: { busy: false, last: 0, gap: 600 } };
const inflight = new Set();
function nextJob(kind) {
  const t = now(), due = [];
  let waiting = null;
  for (const [m, at] of wanted) {
    if (t - at > WANT_MS) { wanted.delete(m); continue; }
    const w = who.get(m);
    if (kind === "find" && !inflight.has(m) && (!w || (w.fail && t - w.t > 10 * 60_000))) {
      if (now() >= freeNext || isBig(m)) return m;
      waiting ||= m;
    }
    if (kind === "held" && w && !w.fail && t - (held.get(m)?.t || 0) > HOLD_MS) due.push(m);
  }
  return kind === "held" ? (due.length ? due : null) : null;
}
async function run(name) {
  const L = lane[name], kind = name === "held" ? "held" : "find";
  if (L.busy || now() - L.last < L.gap) return;
  const mint = nextJob(kind);
  if (kind === "find" && mint) inflight.add(mint);
  snipeStats.queue = wanted.size; snipeStats.known = who.size;
  if (!mint) return;
  L.busy = true; L.last = now();
  try {
    if (kind === "find") { who.set(mint, await findLaunch(mint)); snipeStats.found++; dirty = true; held.delete(mint); }
    else { snipeStats.reads += await readHeldBatch(mint); }
  } catch (e) {
    snipeStats.errors++; snipeStats.lastError = e.message;
    const why = String(e.message).slice(0, 60); (snipeStats.why ||= {})[why] = (snipeStats.why[why] || 0) + 1;
    // Retried in 30 s after a rate limit, a minute after the day's allowance, 10 minutes after anything else.
    if (kind === "find" && /^wait/.test(e.message)) { who.delete(mint); snipeStats.errors--; (snipeStats.why || {})[String(e.message).slice(0, 60)]--; }
    else if (kind === "find") who.set(mint, { t: /rate limit|429|partly/i.test(e.message) ? now() - 10 * 60_000 + 30_000 : /allowance/.test(e.message) ? now() - 9 * 60_000 : now(), fail: e.message });
    else for (const m of mint) held.set(m, { ...(held.get(m) || {}), t: now() - HOLD_MS + 15_000 });   // retried in 15 s
    if (/rate limit|429/i.test(e.message)) L.last = now() + 15_000;
  } finally { L.busy = false; if (kind === "find") inflight.delete(mint); }
}
const tick = async () => { for (const n of ["find", "find2", "held"]) run(n).catch(() => {}); };

// What they hold is kept on disk too (every 30 s, taken back when under 10 minutes old): a restart used to leave
// every row's sniper and bundle pills empty until the holdings were read again.
const HELD_FILE = path.join(DATA, "snipers-held.json");
function load() {
  try { for (const [m, w] of JSON.parse(fs.readFileSync(FILE, "utf8"))) if (!w.fail) who.set(m, w); } catch {}
  try { const j = JSON.parse(fs.readFileSync(HELD_FILE, "utf8")); if (now() - j.t < 10 * 60_000) for (const [m, h] of j.held) if (h.sn != null) held.set(m, { ...h, t: Math.min(h.t, now() - HOLD_MS + 20_000) }); } catch {}
}
function save() {
  const live = [...held].filter(([, h]) => h.sn != null && now() - h.t < 10 * 60_000);
  if (live.length) fs.promises.writeFile(HELD_FILE + ".tmp", JSON.stringify({ t: now(), held: live })).then(() => fs.promises.rename(HELD_FILE + ".tmp", HELD_FILE)).catch(() => {});
  if (!dirty) return;
  dirty = false;
  const keep = [...who].filter(([, w]) => !w.fail).slice(-20_000);
  fs.promises.writeFile(FILE + ".tmp", JSON.stringify(keep)).then(() => fs.promises.rename(FILE + ".tmp", FILE)).catch(() => {});
}
if (process.env.RADAR_NO_TIMERS !== "1") {
  load();
  setInterval(() => { tick().catch(() => {}); }, 300).unref?.();
  setInterval(save, 30_000).unref?.();
  if (held.size > 5000) held.clear();
}
export const _findLaunch = findLaunch;
