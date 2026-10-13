// Coin search for the launcher (web/src/components/Launcher.tsx): GET /api/tokens?q=… answered by the page server
// (webapp.js) from an index of the whole coin table kept in memory, in a few milliseconds, on its own process.
// Before this the radar ran two LIKE scans over 76k rows on its one thread for every keystroke (100-660 ms each,
// 2026-10-11), and the 60 rows it returned could leave out the biggest coin with the ticker typed.
//
// The index is read from radar.db on a read-only connection (WAL: the radar keeps writing untouched), in chunks so
// the first load never holds this process up, then refreshed every few seconds from the rows the radar updated
// since (`updated`) and the rows it added (rowid). Ranking: the contract itself, a major asset by its ticker, the
// exact ticker, the exact name, a ticker or name starting with it, a word of the name starting with it, anything
// containing it, then a contract starting with it; within a tier the live coin before dead ones, the bigger first.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAJOR_MINTS } from "./quality.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_FILE = path.join(process.env.RADAR_DATA ? path.resolve(process.env.RADAR_DATA) : path.join(ROOT, "data"), "radar.db");
const COLS = "rowid AS rid, mint, symbol, name, image, first_seen, pair_created, mcap, peak_mcap, vol_h24, liquidity, score, dex, graduated, links, status, quarantine, asset_class, updated";
const CHUNK = 4000, REFRESH_MS = 3000;
const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const searchStats = { rows: 0, loaded: false, loadMs: 0, refreshes: 0, lastRefreshMs: 0, queries: 0, lastQueryMs: 0, error: null };
const rows = new Map();   // mint -> row (the table's columns, plus lowered symbol/name for matching)
// Every row's ticker and name as one string, a line each: one native indexOf sweep over ~2.5 MB finds the matching
// lines in a millisecond or two, where a JavaScript loop over 76k rows took 50-120 ms on the VM.
let blob = "", starts = [], order = [], dirty = true;
function rebuild() {
  const parts = []; starts = []; order = [];
  let pos = 0;
  for (const r of rows.values()) { r.pos = order.length; starts.push(pos); order.push(r); parts.push(r.hay); pos += r.hay.length + 1; }
  blob = parts.join("\n"); dirty = false;
}
const lineOf = (pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
// The rows whose ticker or name contains `t`.
function scan(t) {
  if (dirty) rebuild();
  const out = [];
  let i = blob.indexOf(t);
  while (i >= 0) { out.push(order[lineOf(i)]); const end = blob.indexOf("\n", i); if (end < 0) break; i = blob.indexOf(t, end + 1); }
  return out;
}
let db = null, maxRid = 0, maxUpdated = 0, loading = null, timer = null;

const lower = (s) => String(s || "").toLowerCase();
function keep(r) {
  r.sym = lower(r.symbol).replace(/^\$/, ""); r.nm = lower(r.name);
  r.words = r.nm ? r.nm.split(/[^a-z0-9]+/).filter(Boolean) : [];
  r.hay = `${r.sym} ${r.nm}`.replace(/[\n\r]/g, " ");
  const had = rows.get(r.mint);
  rows.set(r.mint, r);
  // A new row joins the haystack at its end; a renamed one (rare) means a rebuild on the next search.
  if (!had) { if (!dirty) { r.pos = order.length; starts.push(blob.length + (blob ? 1 : 0)); order.push(r); blob = blob ? `${blob}\n${r.hay}` : r.hay; } }
  else if (had.hay !== r.hay) dirty = true;
  else { r.pos = had.pos; if (r.pos != null) order[r.pos] = r; }
  if (r.rid > maxRid) maxRid = r.rid;
  if ((r.updated || 0) > maxUpdated) maxUpdated = r.updated;
}
function open() {
  if (db) return db;
  db = new DatabaseSync(DB_FILE, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 2000");
  return db;
}
// The whole table, CHUNK rows a turn of the event loop.
function load() {
  if (loading) return loading;
  loading = (async () => {
    const t0 = performance.now();
    try {
      const q = open().prepare(`SELECT ${COLS} FROM tokens WHERE rowid > ? ORDER BY rowid LIMIT ${CHUNK}`);
      let after = 0;
      for (;;) {
        const part = q.all(after);
        for (const r of part) keep(r);
        if (part.length < CHUNK) break;
        after = part[part.length - 1].rid;
        await new Promise((go) => setImmediate(go));
      }
      searchStats.loaded = true; searchStats.error = null;
    } catch (e) { searchStats.error = e.message; }
    searchStats.rows = rows.size; searchStats.loadMs = Math.round(performance.now() - t0);
    if (!timer) { timer = setInterval(refresh, REFRESH_MS); timer.unref?.(); }
  })();
  return loading;
}
// What changed since the last look: rows the radar updated (its `updated` stamp) and rows it added.
function refresh() {
  if (!searchStats.loaded) return;
  const t0 = performance.now();
  try {
    const d = open();
    for (const r of d.prepare(`SELECT ${COLS} FROM tokens WHERE updated > ? LIMIT 5000`).all(maxUpdated)) keep(r);
    for (const r of d.prepare(`SELECT ${COLS} FROM tokens WHERE rowid > ? ORDER BY rowid LIMIT 5000`).all(maxRid)) keep(r);
    searchStats.refreshes++; searchStats.rows = rows.size; searchStats.error = null;
  } catch (e) { searchStats.error = e.message; }
  searchStats.lastRefreshMs = Math.round(performance.now() - t0);
}
export const warmSearch = () => { load().catch(() => {}); };

// Only a plain search is answered here (q, limit, offset): a search with filters or a sort goes to the radar.
export function searchable(url) {
  const p = url.searchParams;
  if (!p.get("q")) return false;
  for (const k of p.keys()) if (k !== "q" && k !== "limit" && k !== "offset") return false;
  return searchStats.loaded;
}

const ALIAS = { bitcoin: "btc", solana: "sol", ethereum: "eth", ether: "eth", hyperliquid: "hype", tether: "usdt" };
// How well a row answers the term: lower is better, null is no match.
const B58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
function tier(r, term, t, words, caLike) {
  if (r.mint === term) return 0;
  // One look at the ticker and name together first: most of the 76k rows end here.
  if (!r.hay.includes(t)) {
    if (words.length > 1 && words.every((w) => r.hay.includes(w))) return 4.5;
    return caLike && r.mint.startsWith(term) ? 5 : null;
  }
  const sym = r.sym, nm = r.nm;
  let k = sym === t ? 1 : nm === t ? 1.5 : sym.startsWith(t) ? 2 : nm.startsWith(t) ? 3 : r.words.some((w) => w.startsWith(t)) ? 3.5 : 4;
  // A major asset (SOL, USDC, BTC…) by its ticker comes before every namesake; its staked or wrapped forms after it.
  if (MAJOR_MINTS.has(r.mint)) k = k === 1 ? 0.2 : Math.min(k, 0.3);
  return k;
}
const liveFirst = (r) => (r.status === "active" ? 0 : 1) + (r.quarantine ? 2 : 0);
const links = (s) => { try { const a = JSON.parse(s || "null"); return Array.isArray(a) ? a : []; } catch { return []; } };
const out = (r) => ({ mint: r.mint, symbol: r.symbol, name: r.name, image: r.image, first_seen: r.first_seen, pair_created: r.pair_created, mcap: r.mcap, peak_mcap: r.peak_mcap,
  vol_h24: r.vol_h24, liquidity: r.liquidity, score: r.score, dex: r.dex, graduated: r.graduated, status: r.status, quarantine: r.quarantine, asset_class: r.asset_class, links: links(r.links) });

export function searchTokens(params) {
  const t0 = performance.now();
  const typed = String(params.get("q") || "").trim().slice(0, 64);
  const term = ALIAS[typed.toLowerCase()] ? typed : typed, t = (ALIAS[typed.toLowerCase()] || typed).toLowerCase().replace(/^\$/, "");
  const words = t.split(/\s+/).filter(Boolean);
  const limit = Math.max(1, Math.min(+params.get("limit") || 60, 200)), offset = Math.max(0, +params.get("offset") || 0);
  const hits = [];
  const caLike = term.length >= 4 && B58_RE.test(term);
  if (t) {
    const seen = new Set();
    const add = (r) => { if (seen.has(r.mint)) return; seen.add(r.mint); const k = tier(r, term, t, words, caLike); if (k != null) hits.push([k, r]); };
    for (const r of scan(t)) add(r);
    // Several words typed: the rows holding the rarest of them, then each must hold them all (tier).
    if (words.length > 1) { let best = null; for (const w of words) { const m = scan(w); if (!best || m.length < best.length) best = m; } for (const r of best) add(r); }
    if (caLike) { const exact = rows.get(term); if (exact) add(exact); else if (term.length < 32) for (const r of rows.values()) if (r.mint.startsWith(term)) add(r); }
  }
  // Within a tier: the coin still trading before dead ones, the bigger first, then the newer (a dead $3K copy from
  // today before one from last month).
  hits.sort((a, b) => a[0] - b[0] || liveFirst(a[1]) - liveFirst(b[1]) || (b[1].mcap || 0) - (a[1].mcap || 0) || (b[1].vol_h24 || 0) - (a[1].vol_h24 || 0) || (b[1].first_seen || 0) - (a[1].first_seen || 0));
  searchStats.queries++; searchStats.lastQueryMs = Math.round((performance.now() - t0) * 10) / 10;
  return { rows: hits.slice(offset, offset + limit).map(([, r]) => out(r)), total: hits.length, offset, limit, q: typed, index: true };
}
