// Fomo (fomo.family) connection.
// - Links: every coin opens in Fomo at fomo.family/tokens/solana/<mint> (no key needed).
// - Traders: fomoapi.io (unofficial; free key = 250k credits/month). The leaderboard includes each
//   trader's Solana wallet, so the radar follows those wallets on-chain itself instead of paying
//   125 credits per streamed trade.
import { db, logEvent } from "./db.js";
import { settings } from "./settings.js";

const BASE = "https://api.fomoapi.io";
const COST = { leaderboard: 250, user: 2500, holders: 250 };
const MONTHLY = 250_000;

export const fomoLink = (mint) => `https://fomo.family/tokens/solana/${mint}`;

db.exec(`
CREATE TABLE IF NOT EXISTS fomo_traders (
  handle TEXT PRIMARY KEY, display TEXT, user_id TEXT, rank INTEGER, win TEXT,
  pnl REAL, volume REAL, trades INTEGER, followers INTEGER, verified INTEGER,
  wallet TEXT, avatar TEXT, top_tokens TEXT, updated INTEGER
);
CREATE INDEX IF NOT EXISTS fomo_wallet ON fomo_traders(wallet);
CREATE TABLE IF NOT EXISTS fomo_usage (month TEXT PRIMARY KEY, credits INTEGER);
`);

const month = () => new Date().toISOString().slice(0, 7);
export function creditsUsed() {
  return db.prepare("SELECT credits FROM fomo_usage WHERE month = ?").get(month())?.credits || 0;
}
function spend(n) {
  db.prepare("INSERT INTO fomo_usage (month, credits) VALUES (?, ?) ON CONFLICT(month) DO UPDATE SET credits = credits + ?").run(month(), n, n);
}

async function call(path, cost) {
  if (!settings.fomoApiKey) throw Object.assign(new Error("Add a free fomoapi.io key in Settings to use Fomo trader data."), { status: 400 });
  // Leave headroom so a busy month never locks you out of on-demand lookups.
  if (creditsUsed() + cost > MONTHLY * 0.9) throw Object.assign(new Error("Fomo credit budget for this month is nearly used up."), { status: 429 });
  const r = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${settings.fomoApiKey}`, accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  const body = await r.json().catch(() => ({}));
  if (r.ok) spend(cost);
  if (!r.ok) throw Object.assign(new Error(body.message || body.error || `Fomo API ${r.status}`), { status: r.status });
  return body;
}

// ---------- traders ----------
export async function refreshLeaderboard(onWallet) {
  const win = settings.fomoWindow || "7d";
  const d = await call(`/v2/leaderboard/${win}?limit=50`, COST.leaderboard);
  const up = db.prepare(`INSERT INTO fomo_traders (handle, display, user_id, rank, win, pnl, volume, trades, followers, verified, wallet, avatar, top_tokens, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(handle) DO UPDATE SET display = excluded.display, user_id = excluded.user_id, rank = excluded.rank, win = excluded.win,
      pnl = excluded.pnl, volume = excluded.volume, trades = excluded.trades, followers = excluded.followers, verified = excluded.verified,
      wallet = COALESCE(excluded.wallet, fomo_traders.wallet), avatar = COALESCE(excluded.avatar, fomo_traders.avatar), top_tokens = excluded.top_tokens, updated = excluded.updated`);
  db.prepare("UPDATE fomo_traders SET rank = NULL WHERE win = ?").run(win);
  for (const t of d.traders || []) {
    up.run(t.handle, t.displayName || null, t.userId || null, t.rank ?? null, win, t.pnlUsd ?? null, t.volumeUsd ?? null, t.trades ?? null,
      t.followers ?? null, t.verified ? 1 : 0, t.wallets?.solana || null, t.profilePictureLink || null, JSON.stringify(t.topTokens || []), Date.now());
  }
  logEvent("fomo", `Fomo ${win} leaderboard refreshed (${(d.traders || []).length} traders)`);
  // Follow the top traders' Solana wallets (on-chain tracking is free).
  const top = db.prepare("SELECT * FROM fomo_traders WHERE win = ? AND rank IS NOT NULL AND wallet IS NOT NULL ORDER BY rank LIMIT ?").all(win, settings.fomoFollowTop);
  for (const t of top) onWallet?.(t.wallet, `@${t.handle}`, "fomo");
  return leaderboard();
}

export function leaderboard() {
  return db.prepare("SELECT * FROM fomo_traders WHERE rank IS NOT NULL ORDER BY rank").all()
    .map((t) => ({ ...t, top_tokens: JSON.parse(t.top_tokens || "[]") }));
}

// Look up a Fomo @handle and return its Solana wallet.
export async function resolveHandle(handle) {
  const h = String(handle).trim().replace(/^@/, "").replace(/^https?:\/\/fomo\.family\/(r\/)?/i, "");
  if (!/^[A-Za-z0-9_.]{1,40}$/.test(h)) throw Object.assign(new Error("That doesn't look like a Fomo handle."), { status: 400 });
  const cached = db.prepare("SELECT * FROM fomo_traders WHERE lower(handle) = lower(?) AND wallet IS NOT NULL").get(h);
  if (cached) return cached;
  const u = await call(`/v2/users/${encodeURIComponent(h)}`, COST.user);
  if (!u.wallets?.solana) throw Object.assign(new Error(`@${h} has no Solana wallet on Fomo.`), { status: 404 });
  db.prepare(`INSERT INTO fomo_traders (handle, display, user_id, pnl, volume, trades, followers, verified, wallet, avatar, top_tokens, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(handle) DO UPDATE SET wallet = excluded.wallet, pnl = excluded.pnl, updated = excluded.updated`)
    .run(u.handle || h, u.displayName || null, u.userId || null, u.pnlUsd ?? null, u.volumeUsd ?? u.totalVolume ?? null, u.numTrades ?? u.trades ?? null,
      u.followers ?? null, u.verified ? 1 : 0, u.wallets.solana, u.profilePictureLink || null, JSON.stringify(u.topTokens || []), Date.now());
  return db.prepare("SELECT * FROM fomo_traders WHERE lower(handle) = lower(?)").get(u.handle || h);
}

// Which Fomo traders hold a coin. Cached 30 minutes per coin to save credits.
const holderCache = new Map();
export async function tokenHolders(mint) {
  const c = holderCache.get(mint);
  if (c && Date.now() - c.t < 30 * 60_000) return c.data;
  const d = await call(`/token/${mint}/holders?limit=25`, COST.holders);
  const data = (d.holders || []).map((h) => {
    const known = db.prepare("SELECT wallet, rank FROM fomo_traders WHERE lower(handle) = lower(?)").get(h.handle || "");
    return { handle: h.handle, valueUsd: h.valueUsd ?? null, amount: h.amount ?? null, wallet: known?.wallet || null, rank: known?.rank ?? null };
  });
  holderCache.set(mint, { t: Date.now(), data });
  return data;
}

export const traderByWallet = (wallet) => db.prepare("SELECT * FROM fomo_traders WHERE wallet = ?").get(wallet);

export function status() {
  return { connected: !!settings.fomoApiKey, creditsUsed: creditsUsed(), monthly: MONTHLY, window: settings.fomoWindow, followTop: settings.fomoFollowTop, traders: db.prepare("SELECT COUNT(*) n FROM fomo_traders").get().n };
}

export function startFomo(onWallet) {
  const run = () => settings.fomoApiKey && refreshLeaderboard(onWallet).catch((e) => logEvent("error", `fomo: ${e.message}`));
  setTimeout(run, 20_000);
  // Twice a day: ~15k of the 250k monthly credits.
  const t = setInterval(() => {
    const last = db.prepare("SELECT MAX(updated) t FROM fomo_traders WHERE rank IS NOT NULL").get().t || 0;
    if (Date.now() - last > 12 * 3600e3) run();
  }, 15 * 60_000);
  return () => clearInterval(t);
}
