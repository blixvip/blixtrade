// Who made each replayed trade, for trades the journal recorded before it kept wallets (journal.js, 2026-10-09):
// pump.fun's public trade list (swap-api.pump.fun, every curve and PumpSwap trade with its wallet, 100 a page) is
// paged back over the replay's day, one coin at a time and slowly (it answers 429 past ~1 page a second), and
// kept in replay_wallets. replay.js then gives each journal trade without a wallet the wallet of the pump.fun trade
// that matches it (same side, within 3 s, nearest size), so the replay's Holders, Top traders and Early buyers can
// be rebuilt at any moment of the day.
import { db } from "./db.js";
import * as journal from "./journal.js";

const now = () => Date.now();
const H = { origin: "https://pump.fun", referer: "https://pump.fun/", "user-agent": "Mozilla/5.0" };
const PAGE_GAP = 1100, BUSY_WAIT = 12_000, MAX_PAGES = 1500, WANTED_MS = 10 * 60_000;
db.exec("CREATE TABLE IF NOT EXISTS replay_wallets (mint TEXT PRIMARY KEY, data TEXT, t INTEGER)");
const getQ = db.prepare("SELECT data, t FROM replay_wallets WHERE mint = ?");
const putQ = db.prepare("INSERT INTO replay_wallets (mint, data, t) VALUES (?, ?, ?) ON CONFLICT(mint) DO UPDATE SET data = excluded.data, t = excluded.t");
db.prepare("DELETE FROM replay_wallets WHERE t < ?").run(now() - 2 * journal.KEEP_MS);

const wanted = new Map();   // mint -> { since (ms), at (last asked) }
const kept = new Map();     // mint -> parsed row (the one being read, and recent answers)
let running = null;

function load(mint) {
  let d = kept.get(mint);
  if (!d) { const row = getQ.get(mint); d = row ? JSON.parse(row.data) : { wallets: [], trades: [], cursor: null, done: false, pages: 0, oldest: null }; kept.set(mint, d); }
  if (kept.size > 20) kept.delete(kept.keys().next().value);
  return d;
}
const save = (mint, d) => putQ.run(mint, JSON.stringify(d), now());

async function readCoin(mint) {
  const d = load(mint), w = wanted.get(mint), at = new Map(d.wallets.map((x, i) => [x, i]));
  const seen = new Set(d.trades.map((x) => x[5]));
  // Starts at the newest trade the journal has no wallet for (its cursor is "<slot+index>-<ms>"; the time part is
  // what places it), not at the coin's newest trade: everything after that already carries its wallet.
  if (!d.cursor && !d.pages && w?.until) d.cursor = `${"9".repeat(22)}-${w.until}`;
  while (!d.done && w && now() - w.at < WANTED_MS) {
    const r = await fetch(`https://swap-api.pump.fun/v2/coins/${mint}/trades?limit=100${d.cursor ? `&cursor=${encodeURIComponent(d.cursor)}` : ""}`, { headers: H, signal: AbortSignal.timeout(12_000) }).catch(() => null);
    if (!r || r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, BUSY_WAIT)); continue; }
    if (!r.ok) { d.done = true; d.error = `pump.fun answered ${r.status}`; break; }
    const j = await r.json();
    for (const x of j.trades || []) {
      if (!x.userAddress || seen.has(x.slotIndexId)) continue;
      seen.add(x.slotIndexId);
      let i = at.get(x.userAddress);
      if (i == null) { i = d.wallets.length; d.wallets.push(x.userAddress); at.set(x.userAddress, i); }
      // [ms, wallet index, tokens, usd, buy, id]
      d.trades.push([Date.parse(x.timestamp), i, Math.round(+x.baseAmount || 0), Math.round((+x.amountUsd || 0) * 100) / 100, x.type === "buy" ? 1 : 0, x.slotIndexId]);
    }
    d.pages++;
    const last = j.trades?.length ? Date.parse(j.trades[j.trades.length - 1].timestamp) : null;
    if (last) d.oldest = last;
    d.cursor = j.pagination?.hasMore ? j.pagination.nextCursor : null;
    if (!d.cursor || (last && last < w.since) || d.pages >= MAX_PAGES) d.done = true;
    if (d.pages % 10 === 0 || d.done) save(mint, d);
    await new Promise((ok) => setTimeout(ok, PAGE_GAP));
  }
  save(mint, d);
}
async function loop() {
  if (running) return;
  running = (async () => {
    for (;;) {
      const next = [...wanted].filter(([m, w]) => now() - w.at < WANTED_MS && !load(m).done).sort((a, b) => b[1].at - a[1].at)[0];
      if (!next) break;
      try { await readCoin(next[0]); } catch { await new Promise((ok) => setTimeout(ok, BUSY_WAIT)); }
    }
  })().finally(() => { running = null; });
}

// The pump.fun trades read so far for `mint` (oldest first), starting a read from `until` (ms, null: now) back to
// `since` when asked for:
// { done, oldest, pages, wallets, trades: [[ms, wallet index, tokens, usd, buy]] }.
export function pumpTrades(mint, since, until = null) {
  wanted.set(mint, { since, until, at: now() });
  void loop();
  const d = load(mint);
  return { done: d.done, oldest: d.oldest, pages: d.pages, error: d.error || null, wallets: d.wallets, trades: [...d.trades].sort((a, b) => a[0] - b[0]) };
}
