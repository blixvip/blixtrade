// Wallet tracking: your watchlist, their live trades and PnL, and "smart money" discovery
// (wallets that keep showing up early or as top holders in coins that later ran).
import { db, q, json, logEvent } from "./db.js";
import { settings } from "./settings.js";
import * as sol from "./solana.js";
import * as src from "./sources.js";
import { traderByWallet } from "./fomo.js";

db.exec(`
CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  label TEXT,
  source TEXT,              -- you | smart
  watching INTEGER DEFAULT 1,
  added INTEGER,
  last_sig TEXT,
  last_poll INTEGER,
  last_trade INTEGER,
  backfilled INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS wallet_trades (
  sig TEXT, wallet TEXT, mint TEXT, side TEXT,
  tokens REAL, sol REAL, usd REAL, t INTEGER,
  PRIMARY KEY (sig, wallet, mint)
);
CREATE INDEX IF NOT EXISTS wt_wallet ON wallet_trades(wallet, t);
CREATE INDEX IF NOT EXISTS wt_mint ON wallet_trades(mint, t);
CREATE TABLE IF NOT EXISTS wallet_hits (
  wallet TEXT, mint TEXT, kind TEXT, t INTEGER,   -- kind: early | holder
  PRIMARY KEY (wallet, mint, kind)
);
CREATE TABLE IF NOT EXISTS winners (
  mint TEXT PRIMARY KEY, t INTEGER, multiple REAL, holders_done INTEGER DEFAULT 0, early_done INTEGER DEFAULT 0
);
`);

const MIN = 60_000;
const now = () => Date.now();
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;

// ---------- SOL price ----------
let solUsd = { v: 0, t: 0 };
export async function solPrice() {
  if (now() - solUsd.t < 60_000 && solUsd.v) return solUsd.v;
  try {
    const pairs = await src.dexTokens([sol.WSOL]);
    const p = pairs.get(sol.WSOL);
    if (p?.priceUsd) solUsd = { v: +p.priceUsd, t: now() };
  } catch {}
  return solUsd.v || 150;
}

// ---------- watchlist ----------
export function addWallet(address, label = "", source = "you") {
  if (!sol.validAddress(address)) throw Object.assign(new Error("That doesn't look like a Solana wallet address."), { status: 400 });
  const cur = db.prepare("SELECT * FROM wallets WHERE address = ?").get(address);
  if (cur) {
    // Your own follows win; a Fomo label beats an anonymous smart-money one.
    db.prepare(`UPDATE wallets SET label = CASE WHEN label IS NULL OR label = '' OR ? = 'fomo' THEN COALESCE(NULLIF(?, ''), label) ELSE label END, watching = 1,
      source = CASE WHEN ? = 'you' THEN 'you' WHEN ? = 'fomo' AND source = 'smart' THEN 'fomo' ELSE source END WHERE address = ?`).run(source, label, source, source, address);
  } else {
    db.prepare("INSERT INTO wallets (address, label, source, watching, added) VALUES (?, ?, ?, 1, ?)").run(address, label || null, source, now());
    logEvent("wallet", `Watching ${label || short(address)}`);
  }
  return db.prepare("SELECT * FROM wallets WHERE address = ?").get(address);
}

export function updateWallet(address, patch) {
  if (patch.label != null) db.prepare("UPDATE wallets SET label = ? WHERE address = ?").run(String(patch.label).slice(0, 60), address);
  if (patch.watching != null) db.prepare("UPDATE wallets SET watching = ? WHERE address = ?").run(patch.watching ? 1 : 0, address);
}

// Look at any wallet's recent trades without following it.
export async function scanWallet(address) {
  if (!sol.validAddress(address)) throw Object.assign(new Error("Not a Solana address."), { status: 400 });
  await pollOne({ address, backfilled: 0 });
}

export function removeWallet(address) {
  db.prepare("DELETE FROM wallets WHERE address = ?").run(address);
  db.prepare("DELETE FROM wallet_trades WHERE wallet = ?").run(address);
}

const nameOf = (w) => w?.label || short(w?.address || "????????");

// ---------- polling ----------
// Round-robin over watched wallets. New wallets get their last ~25 transactions backfilled once.
let polling = false;
async function pollWallets(emit) {
  if (polling) return;
  polling = true;
  try {
    const list = db.prepare("SELECT * FROM wallets WHERE watching = 1 ORDER BY source = 'you' DESC, source = 'fomo' DESC, COALESCE(last_poll, 0) ASC").all();
    const budget = sol.rpcStats && settings.rpcUrl ? 30 : 8;   // wallets per round
    for (const w of list.slice(0, budget)) await pollOne(w, emit).catch((e) => logEvent("error", `wallet ${short(w.address)}: ${e.message}`));
  } finally {
    polling = false;
  }
}

async function pollOne(w, emit) {
  const first = !w.backfilled;
  const sigs = (await sol.signatures(w.address, { limit: first ? 25 : 20, ...(w.last_sig && !first ? { until: w.last_sig } : {}) })) || [];
  db.prepare("UPDATE wallets SET last_poll = ?, last_sig = COALESCE(?, last_sig), backfilled = 1 WHERE address = ?").run(now(), sigs[0]?.signature || null, w.address);
  const fresh = sigs.filter((s) => !s.err);
  // Busy bots can do hundreds of txs a minute; only look at the newest few per round.
  const cap = settings.rpcUrl ? 15 : first ? 12 : 6;
  const price = await solPrice();
  const ins = db.prepare("INSERT OR IGNORE INTO wallet_trades (sig, wallet, mint, side, tokens, sol, usd, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const s of fresh.slice(0, cap)) {
    if (db.prepare("SELECT 1 FROM wallet_trades WHERE sig = ? AND wallet = ?").get(s.signature, w.address)) continue;
    const tx = await sol.transaction(s.signature).catch(() => null);
    for (const sw of sol.parseSwaps(tx, w.address)) {
      const usd = sw.usd ?? sw.sol * price;
      const r = ins.run(s.signature, w.address, sw.mint, sw.side, sw.tokens, sw.sol, usd, sw.t || (s.blockTime || 0) * 1000);
      if (!r.changes) continue;
      db.prepare("UPDATE wallets SET last_trade = MAX(COALESCE(last_trade, 0), ?) WHERE address = ?").run(sw.t, w.address);
      if (!first && now() - sw.t < 30 * MIN) emit?.({ wallet: w, trade: { ...sw, usd, sig: s.signature } });
    }
  }
}

// ---------- positions & PnL ----------
// Average-cost PnL per coin, in USD, marked to the radar's latest price when we track the coin.
export function walletPnl(address, prices = new Map()) {
  const trades = db.prepare("SELECT * FROM wallet_trades WHERE wallet = ? ORDER BY t").all(address);
  const by = new Map();
  for (const tr of trades) {
    const p = by.get(tr.mint) || { mint: tr.mint, bought: 0, sold: 0, cost: 0, proceeds: 0, buys: 0, sells: 0, first: tr.t, last: tr.t };
    if (tr.side === "buy") { p.bought += tr.tokens; p.cost += tr.usd || 0; p.buys++; }
    else { p.sold += tr.tokens; p.proceeds += tr.usd || 0; p.sells++; }
    p.last = tr.t;
    by.set(tr.mint, p);
  }
  const positions = [...by.values()].map((p) => {
    const t = q.getToken.get(p.mint) || prices.get(p.mint);
    const avg = p.bought ? p.cost / p.bought : 0;
    const soldKnown = Math.min(p.sold, p.bought);
    const realized = p.bought ? p.proceeds - avg * soldKnown : null;     // null: sold coins bought before we watched
    const held = Math.max(0, p.bought - p.sold);
    const value = t?.price ? held * t.price : null;
    const unrealized = value != null ? value - avg * held : null;
    return { ...p, symbol: t?.symbol || null, name: t?.name || null, image: t?.image || null, price: t?.price || null, mcap: t?.mcap || null, avg, held, value, realized, unrealized };
  }).sort((a, b) => b.last - a.last);
  const closed = positions.filter((p) => p.realized != null && p.sells > 0);
  return {
    positions,
    trades: trades.length,
    realized: closed.reduce((s, p) => s + p.realized, 0),
    unrealized: positions.reduce((s, p) => s + (p.unrealized || 0), 0),
    winRate: closed.length ? closed.filter((p) => p.realized > 0).length / closed.length : null,
    closed: closed.length,
  };
}

export function listWallets() {
  const rows = db.prepare("SELECT * FROM wallets ORDER BY source = 'you' DESC, COALESCE(last_trade, 0) DESC").all();
  return rows.map((w) => {
    const p = walletPnl(w.address);
    const hits = db.prepare("SELECT COUNT(DISTINCT mint) n FROM wallet_hits WHERE wallet = ?").get(w.address).n;
    return { ...w, trades: p.trades, realized: p.realized, unrealized: p.unrealized, winRate: p.winRate, closed: p.closed, winners: hits };
  });
}

export async function walletDetail(address) {
  const w = db.prepare("SELECT * FROM wallets WHERE address = ?").get(address) || { address, label: null, source: null, watching: 0 };
  // Price coins the radar doesn't track so open positions still get a value.
  const untracked = db.prepare(`SELECT DISTINCT wt.mint FROM wallet_trades wt LEFT JOIN tokens t ON t.mint = wt.mint
    WHERE wt.wallet = ? AND (t.mint IS NULL OR t.price IS NULL)`).all(address).map((r) => r.mint).slice(0, 60);
  const prices = new Map();
  if (untracked.length) {
    const pairs = await src.dexTokens(untracked).catch(() => new Map());
    for (const [m, p] of pairs) prices.set(m, { price: +p.priceUsd || 0, symbol: p.baseToken?.symbol, name: p.baseToken?.name, image: p.info?.imageUrl || null, mcap: p.marketCap || p.fdv || 0 });
  }
  const pnl = walletPnl(address, prices);
  const trades = db.prepare(`SELECT wt.*, t.symbol, t.name, t.image FROM wallet_trades wt LEFT JOIN tokens t ON t.mint = wt.mint
    WHERE wt.wallet = ? ORDER BY wt.t DESC LIMIT 120`).all(address)
    .map((tr) => tr.symbol ? tr : { ...tr, symbol: prices.get(tr.mint)?.symbol || null, name: prices.get(tr.mint)?.name || null, image: prices.get(tr.mint)?.image || null });
  const hits = db.prepare(`SELECT h.*, t.symbol, t.name, t.image, t.peak_mcap, t.mcap, w.multiple FROM wallet_hits h
    LEFT JOIN tokens t ON t.mint = h.mint LEFT JOIN winners w ON w.mint = h.mint WHERE h.wallet = ? ORDER BY h.t DESC`).all(address);
  return { wallet: w, pnl, trades, hits };
}

export function activity(limit = 60) {
  return db.prepare(`SELECT wt.*, w.label, w.source, t.symbol, t.name, t.image, t.mcap FROM wallet_trades wt
    JOIN wallets w ON w.address = wt.wallet LEFT JOIN tokens t ON t.mint = wt.mint
    ORDER BY wt.t DESC LIMIT ?`).all(limit);
}

// Watched wallets that traded this coin.
export function coinWallets(mint) {
  return db.prepare(`SELECT wt.wallet, w.label, w.source, SUM(CASE WHEN side = 'buy' THEN usd ELSE 0 END) bought,
    SUM(CASE WHEN side = 'sell' THEN usd ELSE 0 END) sold, MIN(wt.t) first, MAX(wt.t) last, COUNT(*) n
    FROM wallet_trades wt JOIN wallets w ON w.address = wt.wallet WHERE wt.mint = ? GROUP BY wt.wallet ORDER BY first`).all(mint);
}

// ---------- discovery ----------
// A "winner" is a coin the radar saw at least 3x from its first reading, peaking at $250k+.
function findWinners() {
  const rows = db.prepare(`SELECT t.mint, t.peak_mcap, (SELECT mcap FROM snapshots s WHERE s.mint = t.mint AND s.mcap > 0 ORDER BY s.t LIMIT 1) first_mcap
    FROM tokens t WHERE t.peak_mcap >= 250000 AND t.mint NOT IN (SELECT mint FROM winners)`).all();
  for (const r of rows) {
    if (!r.first_mcap || r.peak_mcap / r.first_mcap < 3) continue;
    db.prepare("INSERT OR IGNORE INTO winners (mint, t, multiple) VALUES (?, ?, ?)").run(r.mint, now(), r.peak_mcap / r.first_mcap);
    logEvent("winner", `${q.getToken.get(r.mint)?.symbol || short(r.mint)} ran ${(r.peak_mcap / r.first_mcap).toFixed(1)}x; studying its wallets`);
  }
}

// Top holders (not pools, not insiders) of each winner, from its safety report.
function harvestHolders() {
  const list = db.prepare("SELECT w.mint, t.safety FROM winners w JOIN tokens t ON t.mint = w.mint WHERE w.holders_done = 0 AND t.safety IS NOT NULL").all();
  const ins = db.prepare("INSERT OR IGNORE INTO wallet_hits (wallet, mint, kind, t) VALUES (?, ?, 'holder', ?)");
  for (const r of list) {
    const s = json(r.safety);
    for (const h of s?.holders || []) if (!h.insider && !h.known && h.pct < 8) ins.run(h.owner, r.mint, now());
    db.prepare("UPDATE winners SET holders_done = 1 WHERE mint = ?").run(r.mint);
  }
}

// The first ~40 buyers of a winner, found by walking its transaction history back to the start.
async function harvestEarly() {
  const w = db.prepare("SELECT mint FROM winners WHERE early_done = 0 ORDER BY t LIMIT 1").get();
  if (!w) return;
  db.prepare("UPDATE winners SET early_done = 1 WHERE mint = ?").run(w.mint);
  let before, oldest = [];
  for (let page = 0; page < (settings.rpcUrl ? 25 : 8); page++) {
    const sigs = await sol.signatures(w.mint, { limit: 1000, ...(before ? { before } : {}) });
    if (!sigs?.length) break;
    oldest = sigs;
    before = sigs[sigs.length - 1].signature;
    if (sigs.length < 1000) break;
  }
  if (oldest.length >= 1000) return; // history too long to reach the start on this RPC
  const early = oldest.filter((s) => !s.err).reverse().slice(1, 45);
  const ins = db.prepare("INSERT OR IGNORE INTO wallet_hits (wallet, mint, kind, t) VALUES (?, ?, 'early', ?)");
  let found = 0;
  for (const s of early) {
    const tx = await sol.transaction(s.signature).catch(() => null);
    if (!tx) continue;
    const signer = tx.transaction.message.accountKeys.find((k) => k.signer)?.pubkey;
    if (!signer) continue;
    const sw = sol.parseSwaps(tx, signer).find((x) => x.mint === w.mint && x.side === "buy");
    if (sw) { ins.run(signer, w.mint, now()); found++; }
  }
  logEvent("discover", `Found ${found} early buyers of ${q.getToken.get(w.mint)?.symbol || short(w.mint)}`);
}

// Wallets that hit several different winners. Bots and pools that touch everything are filtered out.
export function smartMoney(limit = 50) {
  const winners = db.prepare("SELECT COUNT(*) n FROM winners").get().n;
  const rows = db.prepare(`SELECT wallet, COUNT(DISTINCT mint) coins, SUM(kind = 'early') early, SUM(kind = 'holder') holder,
    GROUP_CONCAT(DISTINCT mint) mints, MAX(t) last FROM wallet_hits GROUP BY wallet HAVING coins >= 2 ORDER BY early * 2 + holder DESC, coins DESC LIMIT ?`).all(limit * 2);
  const out = [];
  for (const r of rows) {
    if (winners >= 10 && r.coins / winners > 0.4) continue;
    const mints = r.mints.split(",");
    const coins = mints.map((m) => q.getToken.get(m)).filter(Boolean).map((t) => ({ mint: t.mint, symbol: t.symbol, image: t.image }));
    const w = db.prepare("SELECT label, watching, source FROM wallets WHERE address = ?").get(r.wallet);
    out.push({ address: r.wallet, coins: r.coins, early: r.early, holder: r.holder, score: r.early * 2 + r.holder, tokens: coins, last: r.last, watching: w?.watching || 0, label: w?.label || null });
    if (out.length >= limit) break;
  }
  return { winners, wallets: out };
}

function autoFollow() {
  if (!settings.autoFollowSmart) return;
  const followed = db.prepare("SELECT COUNT(*) n FROM wallets WHERE source = 'smart' AND watching = 1").get().n;
  let room = settings.maxSmartWallets - followed;
  for (const w of smartMoney(40).wallets) {
    if (room <= 0) break;
    if (w.watching || w.score < 3) continue;
    addWallet(w.address, "", "smart");
    room--;
  }
}

// ---------- signals from wallet activity ----------
export function walletSignals(event, raise, adopt) {
  const { wallet: w, trade } = event;
  if (trade.side !== "buy") return;
  adopt(trade.mint);
  const t = q.getToken.get(trade.mint);
  const tk = { mint: trade.mint, symbol: t?.symbol || short(trade.mint), score: t?.score || 0, price: t?.price || null, mcap: t?.mcap || null };
  const usd = trade.usd ? `$${Math.round(trade.usd).toLocaleString()}` : `${trade.sol.toFixed(2)} SOL`;
  const safety = t?.safety_score != null ? ` Safety ${t.safety_score}/100.` : "";
  const cool = (kind, ms) => { const l = q.lastSignal.get(trade.mint, kind); return !l || now() - l.t > ms; };

  if ((w.source === "you" || trade.sol >= settings.walletMinSol) && cool(`wallet:${w.address}`, 6 * 60 * MIN))
    raise(tk, `wallet:${w.address}`, `${nameOf(w)} bought $${tk.symbol}`, `${usd} buy${t?.mcap ? ` at ${fmtUsd(t.mcap)} mcap` : ""}.${fomoNote(w.address)}${safety}`);

  const buyers = db.prepare(`SELECT DISTINCT wt.wallet FROM wallet_trades wt JOIN wallets w ON w.address = wt.wallet
    WHERE wt.mint = ? AND wt.side = 'buy' AND wt.t > ? AND w.watching = 1`).all(trade.mint, now() - 2 * 60 * MIN);
  const danger = json(t?.safety)?.danger > 0;
  if (buyers.length >= 2 && !danger && cool("smart", 6 * 60 * MIN)) {
    const names = buyers.map((b) => nameOf(db.prepare("SELECT * FROM wallets WHERE address = ?").get(b.wallet))).slice(0, 4).join(", ");
    raise(tk, "smart", `Smart money piling into $${tk.symbol}`, `${buyers.length} wallets you follow bought in the last 2 hours: ${names}.${safety}`);
  }
}
// "Fomo #3 on the 7d board, +$41k" when the wallet belongs to a Fomo trader.
function fomoNote(address) {
  const f = traderByWallet(address);
  if (!f) return "";
  const rank = f.rank ? ` #${f.rank} on the ${f.win} board` : "";
  const pnl = f.pnl != null ? `, ${f.pnl >= 0 ? "+" : "−"}${fmtUsd(Math.abs(f.pnl))} PnL` : "";
  return ` Fomo trader @${f.handle}${rank}${pnl}.`;
}
const fmtUsd = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n || 0)}`;

// ---------- loop ----------
export function startWallets(onTrade) {
  const timers = [
    setInterval(() => pollWallets(onTrade), 20_000),
    setInterval(() => { findWinners(); harvestHolders(); autoFollow(); }, 3 * MIN),
    setInterval(() => harvestEarly().catch((e) => logEvent("error", `early buyers: ${e.message}`)), 4 * MIN),
  ];
  setTimeout(() => pollWallets(onTrade), 3000);
  return () => timers.forEach(clearInterval);
}
