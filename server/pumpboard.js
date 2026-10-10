// pump.fun's PnL leaderboard (pump.fun/leaderboard, Traders tab): daily, weekly and monthly, live. pump.fun
// serves it to anyone (GET frontend-api-v3.pump.fun/pnl-leaderboard), so it is read straight from the server,
// no browser needed. Each period is read only while someone has it open, at most once every REFRESH_MS, and
// the last good board is kept so the page never blanks while pump.fun is slow. Ranks move live: each row
// carries its rank from the read before (prevRank), so the page can show who climbed.
import { db } from "./db.js";
import { offChain } from "./chains.js";

const API = "https://frontend-api-v3.pump.fun/pnl-leaderboard";
export const PERIODS = { "24h": "daily", "7d": "weekly", "30d": "monthly" };
const LIMIT = 100, REFRESH_MS = 5_000;
const now = () => Date.now();
const num = (v) => (v == null || v === "" || !isFinite(+v) ? null : +v);
const boards = new Map(); // range -> { rows, prev: Map(wallet -> rank), t, windowStart, running, error }

function slim(e) {
  return {
    rank: e.rank, wallet: e.walletAddress, handle: e.username || null, name: e.username || null, pic: e.profileImage || null,
    x: e.xUsername || null, verified: Boolean(e.verifiedBadgeVisible), uid: e.userId || null,
    pnl: num(e.pnlUsd), pnlSol: num(e.pnlSol), pnlPct: num(e.pnlPercent), realized: num(e.realizedPnlUsd), unrealized: num(e.unrealizedPnlUsd),
    spentSol: num(e.buySpendSol), positions: num(e.positionsCount),
    top: (e.topPositions || []).map((p) => ({ mint: p.mint, chain: p.chainId, img: p.imageUri || null, symbol: p.symbol || null, value: null, pnl: null })),
  };
}

async function refresh(range) {
  const b = boards.get(range);
  b.running = true;
  try {
    const r = await fetch(`${API}?period=${PERIODS[range]}&limit=${LIMIT}`, { headers: { origin: "https://pump.fun", referer: "https://pump.fun/", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`pump.fun answered ${r.status}.`);
    const j = await r.json();
    if (!Array.isArray(j?.entries)) throw new Error("pump.fun did not send its leaderboard.");
    const windowStart = num(j.windowStartSec);
    // A new period window (pump.fun's day/week/month rolled over) starts the movement arrows fresh.
    if (b.rows && windowStart === b.windowStart) b.prev = new Map(b.rows.map((x) => [x.wallet, x.rank]));
    else b.prev = new Map();
    b.rows = j.entries.map(slim);
    b.windowStart = windowStart; b.t = now(); b.error = null;
  } catch (e) { b.error = e.name === "TimeoutError" ? "pump.fun took too long to answer." : e.message; }
  finally { b.running = false; }
}

// GET /api/pump/board?range=24h|7d|30d: pump.fun's top traders for that period. Waits for the first read.
export async function pumpBoard({ range = "24h" } = {}) {
  if (!PERIODS[range]) range = "24h";
  if (!boards.has(range)) boards.set(range, { rows: null, prev: new Map(), t: 0, windowStart: null, running: false, error: null });
  const b = boards.get(range);
  if (!b.running && now() - b.t > REFRESH_MS) {
    const p = refresh(range);
    if (!b.rows) await p;
  }
  const watched = new Set(db.prepare("SELECT address FROM wallets WHERE watching = 1").all().map((w) => w.address));
  return {
    range, ranges: Object.keys(PERIODS), t: b.t || null, windowStart: b.windowStart, loading: b.running, error: b.error,
    rows: (b.rows || []).map((r) => ({ ...r, top: (r.top || []).filter((p) => !offChain(p.chain)), prevRank: b.prev.size ? b.prev.get(r.wallet) ?? null : undefined, tracked: watched.has(r.wallet) })),
  };
}
