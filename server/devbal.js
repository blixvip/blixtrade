import { heliusFetch as fetch } from "./heliuskeys.js";
import { canEnrich } from './coin-screen.js';
// The developer's share of a coin, from the chain, for coins where neither Jupiter's audit nor RugCheck says it
// (Jupiter names the dev wallet for most coins but leaves devBalancePercentage out for some). One
// getTokenAccountsByOwner on the public RPC per coin, at most one every 3 s, kept 5 minutes; asked only for
// coins on screen (server.js liveRow), so Discover's dev pill fills in instead of showing a dash.
import { settings } from "./settings.js";

const PUBLIC = "https://api.mainnet-beta.solana.com";
const KEEP = 5 * 60_000, GAP = 3000;
const cache = new Map();     // mint -> { t, pct }
const queue = new Map();     // mint -> { wallet, supply }
export const devStats = { reads: 0, errors: 0 };
let busy = false, last = 0;
const now = () => Date.now();

// The dev's share now (percent of `supply`), or null while unknown; asking queues the read.
export function devShare(mint, wallet, supply) {
  const c = cache.get(mint);
  if (c && now() - c.t < KEEP) return c.pct;
  if (canEnrich(mint) && wallet && supply > 0 && !queue.has(mint)) { queue.set(mint, { wallet, supply }); if (queue.size > 200) queue.delete(queue.keys().next().value); }
  return c?.pct ?? null;
}

async function tick() {
  if (busy || now() - last < GAP || !queue.size) return;
  const [mint, { wallet, supply }] = queue.entries().next().value;
  queue.delete(mint);
  if (!canEnrich(mint)) return;
  busy = true; last = now();
  try {
    const url = String(settings.rpcUrl || "").trim() || PUBLIC;
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [wallet, { mint }, { encoding: "jsonParsed", commitment: "processed" }] }) });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "RPC error");
    const held = (j.result?.value || []).reduce((s, a) => s + (a.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0), 0);
    cache.set(mint, { t: now(), pct: +((held / supply) * 100).toFixed(2) });
    devStats.reads++;
  } catch (e) {
    devStats.errors++;
    cache.set(mint, { t: now() - KEEP + 30_000, pct: cache.get(mint)?.pct ?? null });   // asked again in 30 s
    if (/rate limit|429/i.test(e.message)) last = now() + 20_000;   // the public RPC is shared: rest
    else last = now() + 2000;
  } finally {
    busy = false;
    if (cache.size > 2000) for (const [k, v] of cache) if (now() - v.t > KEEP) cache.delete(k);
  }
}
setInterval(() => { tick().catch(() => {}); }, 500).unref?.();
// Kept on disk (every 30 s, taken back when under 10 minutes old), so a restart does not empty the dev pills.
import fs from "node:fs";
import path from "node:path";
import { DATA } from "./db.js";
const DEV_FILE = path.join(DATA, "devbal.json");
try { const j = JSON.parse(fs.readFileSync(DEV_FILE, "utf8")); if (now() - j.t < 10 * 60_000) { for (const [m, c] of j.dev) cache.set(m, c); for (const [m, c] of j.qh || []) qh.set(m, c); } } catch {}
setInterval(() => { fs.promises.writeFile(DEV_FILE + ".tmp", JSON.stringify({ t: now(), dev: [...cache].filter(([, c]) => c.pct != null), qh: [...qh].filter(([, c]) => !c.fail) })).then(() => fs.promises.rename(DEV_FILE + ".tmp", DEV_FILE)).catch(() => {}); }, 30_000).unref?.();

// ---------- holders for a coin nothing else can count yet ----------
// A coin minutes old that is not pump.fun's (no trade ledger), not yet on Jupiter and not yet on RugCheck: its
// holders and top-10 share from one getProgramAccounts on the public RPC (a new coin has a few dozen accounts, a
// few KB). Program addresses (pools, curves, vaults) are not holders, as in holders.js. Kept 60 s; one read every
// 2 s; a coin with more than 3,000 accounts is not read this way (Jupiter has it long before it gets there).
import { onCurve } from "./holderslive.js";
import { b58 } from "./livetrades.js";
const qh = new Map();        // mint -> { t, h, t10 } | { t, fail }
const qhWant = new Map();    // mint -> asked
let qhBusy = false, qhLast = 0;
export const quickStats = { reads: 0, errors: 0, lastError: null };
export function quickHolders(mint) {
  const c = qh.get(mint);
  if (c && now() - c.t < 60_000) return c.fail ? null : c;
  if (canEnrich(mint)) qhWant.set(mint, now()); if (qhWant.size > 300) qhWant.delete(qhWant.keys().next().value);
  return c && !c.fail ? c : null;
}
async function qhTick() {
  if (qhBusy || now() - qhLast < 2000 || !qhWant.size) return;
  const [mint, at] = qhWant.entries().next().value;
  qhWant.delete(mint);
  if (now() - at > 30_000 || !canEnrich(mint)) return;
  qhBusy = true; qhLast = now();
  const url = String(settings.rpcUrl || "").trim() || PUBLIC;
  const rpc = async (method, params) => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000), body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message || "RPC error"); return j.result; };
  try {
    const m = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "processed" }]);
    const info = m?.value?.data?.parsed?.info, program = m?.value?.owner;
    if (!info || !program) throw new Error("mint not found");
    const supply = Number(info.supply) / 10 ** (info.decimals ?? 6);
    const list = await rpc("getProgramAccounts", [program, { encoding: "base64", commitment: "processed", dataSlice: { offset: 32, length: 40 }, filters: [{ memcmp: { offset: 0, bytes: mint } }] }]);
    if (!Array.isArray(list) || list.length > 3000) throw new Error("too many accounts");
    const owners = new Map();
    for (const x of list) {
      const d = Buffer.from(x.account.data[0], "base64");
      if (d.length < 40) continue;
      const amt = Number(d.readBigUInt64LE(32)) / 10 ** (info.decimals ?? 6);
      if (amt > 0) { const o = b58(d.subarray(0, 32)); owners.set(o, (owners.get(o) || 0) + amt); }
    }
    const people = [...owners].filter(([o]) => onCurve(o)).sort((x, y) => y[1] - x[1]);
    const t10 = supply > 0 ? +((people.slice(0, 10).reduce((s, [, v]) => s + v, 0) / supply) * 100).toFixed(2) : null;
    qh.set(mint, { t: now(), h: people.length, t10 });
    quickStats.reads++;
  } catch (e) {
    quickStats.errors++; quickStats.lastError = e.message;
    qh.set(mint, { t: now() - 30_000, fail: e.message });
    if (/rate limit|429|allowance/i.test(e.message)) qhLast = now() + 20_000;
  } finally {
    qhBusy = false;
    if (qh.size > 2000) for (const [k, v] of qh) if (now() - v.t > 10 * 60_000) qh.delete(k);
  }
}
setInterval(() => { qhTick().catch(() => {}); }, 400).unref?.();
