// Fomo (fomo.family) connection. 100% free: no API keys, only public links and the Solana chain.
//
// - Links: every coin opens in Fomo at fomo.family/tokens/solana/<mint>; traders at fomo.family/profile/<handle>.
// - Fingerprint: Fomo pays its users' Solana network fees, so Fomo trades are signed by a Fomo fee-payer
//   account. The radar learns that account from the trades of any Fomo wallet you add (yours, or one from
//   fomowalletfinder.com), then reads the fee payer's transactions to see Fomo trades as they happen.
import { db, q, logEvent } from "./db.js";
import { settings } from "./settings.js";
import * as sol from "./solana.js";

export const fomoLink = (mint) => `https://fomo.family/tokens/solana/${mint}`;
export const profileLink = (handle) => `https://fomo.family/profile/${encodeURIComponent(handle)}`;

db.exec(`
CREATE TABLE IF NOT EXISTS fomo_payers (address TEXT PRIMARY KEY, learned INTEGER, trades INTEGER, last_sig TEXT, last_poll INTEGER);
CREATE TABLE IF NOT EXISTS fomo_flow (
  sig TEXT, wallet TEXT, mint TEXT, side TEXT, tokens REAL, sol REAL, usd REAL, t INTEGER,
  PRIMARY KEY (sig, wallet, mint)
);
CREATE INDEX IF NOT EXISTS fomo_flow_mint ON fomo_flow(mint, t);
CREATE INDEX IF NOT EXISTS fomo_flow_wallet ON fomo_flow(wallet, t);
CREATE TABLE IF NOT EXISTS fomo_handles (wallet TEXT PRIMARY KEY, handle TEXT);
`);
try { db.exec("ALTER TABLE wallet_trades ADD COLUMN payer TEXT"); } catch {}
try { db.exec("ALTER TABLE wallets ADD COLUMN fomo INTEGER DEFAULT 0"); } catch {}

const MIN = 60_000;
const now = () => Date.now();

// ---------- traders you add ----------
export function markFomo(address, handle, addWallet) {
  const h = String(handle || "").trim().replace(/^@/, "").replace(/^https?:\/\/fomo\.family\/(profile\/)?/i, "").replace(/\/.*$/, "");
  if (h && !/^[A-Za-z0-9_.]{1,40}$/.test(h)) throw Object.assign(new Error("That doesn't look like a Fomo handle."), { status: 400 });
  const w = addWallet(address, h ? `@${h}` : "Fomo trader", "you");
  db.prepare("UPDATE wallets SET fomo = 1 WHERE address = ?").run(address);
  if (h) db.prepare("INSERT INTO fomo_handles (wallet, handle) VALUES (?, ?) ON CONFLICT(wallet) DO UPDATE SET handle = excluded.handle").run(address, h);
  return w;
}

export const handleOf = (wallet) => db.prepare("SELECT handle FROM fomo_handles WHERE wallet = ?").get(wallet)?.handle || null;

// ---------- learning the fee payer ----------
// A Fomo fee payer shows up as the payer on at least two swaps by Fomo wallets.
function learnPayers() {
  const rows = db.prepare(`SELECT wt.payer, COUNT(*) n, COUNT(DISTINCT wt.wallet) w FROM wallet_trades wt JOIN wallets w ON w.address = wt.wallet
    WHERE w.fomo = 1 AND wt.payer IS NOT NULL AND wt.payer != wt.wallet GROUP BY wt.payer HAVING n >= 2`).all();
  for (const r of rows) {
    if (db.prepare("SELECT 1 FROM fomo_payers WHERE address = ?").get(r.payer)) continue;
    db.prepare("INSERT INTO fomo_payers (address, learned, trades) VALUES (?, ?, 0)").run(r.payer, now());
    logEvent("fomo", `Learned Fomo's fee payer ${r.payer.slice(0, 6)}… from ${r.n} trades; watching all Fomo trades now`);
  }
}

// ---------- reading Fomo trades ----------
let reading = false;
async function readFlow(onTrade) {
  if (reading) return;
  reading = true;
  try {
    const cap = settings.rpcUrl ? 40 : 8;   // transactions per payer per round
    const price = await solUsd();
    for (const p of db.prepare("SELECT * FROM fomo_payers").all()) {
      const sigs = ((await sol.signatures(p.address, { limit: 100, ...(p.last_sig ? { until: p.last_sig } : {}) })) || []).filter((s) => !s.err);
      db.prepare("UPDATE fomo_payers SET last_poll = ?, last_sig = COALESCE(?, last_sig) WHERE address = ?").run(now(), sigs[0]?.signature || null, p.address);
      // Fomo moves faster than a free RPC can read, so take an even sample across the new batch.
      const step = Math.max(1, Math.floor(sigs.length / cap));
      for (const s of sigs.filter((_, i) => i % step === 0).slice(0, cap)) {
        const tx = await sol.transaction(s.signature).catch(() => null);
        if (!tx) continue;
        for (const user of candidates(tx, p.address)) {
          const sw = sol.parseSwaps(tx, user)[0];
          if (!sw) continue;
          const usd = sw.usd ?? sw.sol * price;
          const r = db.prepare("INSERT OR IGNORE INTO fomo_flow (sig, wallet, mint, side, tokens, sol, usd, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .run(s.signature, user, sw.mint, sw.side, sw.tokens, sw.sol, usd, sw.t || now());
          if (r.changes) { db.prepare("UPDATE fomo_payers SET trades = trades + 1 WHERE address = ?").run(p.address); onTrade?.({ wallet: user, ...sw, usd }); }
          break;
        }
      }
    }
  } finally {
    reading = false;
  }
}

// The Fomo user in a fee-payer transaction: another signer, or an owner whose tokens moved.
function candidates(tx, payer) {
  const keys = tx.transaction.message.accountKeys;
  const signers = keys.filter((k) => k.signer).map((k) => k.pubkey).filter((k) => k !== payer);
  const owners = [...(tx.meta.postTokenBalances || []), ...(tx.meta.preTokenBalances || [])].map((b) => b.owner).filter((o) => o && o !== payer);
  return [...new Set([...signers, ...owners])];
}

let solPrice = { v: 150, t: 0 };
async function solUsd() {
  if (now() - solPrice.t < 60_000) return solPrice.v;
  try {
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${sol.WSOL}`, { signal: AbortSignal.timeout(10000) }).then((x) => x.json());
    const best = r.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
    if (best?.priceUsd) solPrice = { v: +best.priceUsd, t: now() };
  } catch {}
  return solPrice.v;
}

// ---------- what Fomo is doing ----------
export function status() {
  const payers = db.prepare("SELECT * FROM fomo_payers").all();
  const hour = now() - 60 * MIN;
  return {
    connected: payers.length > 0,
    payers: payers.map((p) => ({ address: p.address, learned: p.learned, trades: p.trades, last_poll: p.last_poll })),
    fomoWallets: db.prepare("SELECT COUNT(*) n FROM wallets WHERE fomo = 1").get().n,
    tradesLastHour: db.prepare("SELECT COUNT(*) n FROM fomo_flow WHERE t > ?").get(hour).n,
    tradersLastHour: db.prepare("SELECT COUNT(DISTINCT wallet) n FROM fomo_flow WHERE t > ?").get(hour).n,
    sampled: !settings.rpcUrl,
  };
}

// Coins Fomo users are buying right now.
export function hotCoins(minutes = 60, limit = 20) {
  return db.prepare(`SELECT f.mint, COUNT(DISTINCT CASE WHEN side = 'buy' THEN wallet END) buyers, COUNT(DISTINCT CASE WHEN side = 'sell' THEN wallet END) sellers,
      SUM(CASE WHEN side = 'buy' THEN usd ELSE 0 END) bought, SUM(CASE WHEN side = 'sell' THEN usd ELSE 0 END) sold, MAX(f.t) last,
      t.symbol, t.name, t.image, t.mcap, t.chg_h1, t.safety_score
    FROM fomo_flow f LEFT JOIN tokens t ON t.mint = f.mint WHERE f.t > ? GROUP BY f.mint ORDER BY buyers DESC, bought DESC LIMIT ?`).all(now() - minutes * MIN, limit);
}

export function coinFlow(mint) {
  const hour = now() - 60 * MIN;
  const agg = db.prepare(`SELECT COUNT(DISTINCT CASE WHEN side = 'buy' THEN wallet END) buyers, COUNT(DISTINCT CASE WHEN side = 'sell' THEN wallet END) sellers,
    SUM(CASE WHEN side = 'buy' THEN usd ELSE 0 END) bought, SUM(CASE WHEN side = 'sell' THEN usd ELSE 0 END) sold FROM fomo_flow WHERE mint = ? AND t > ?`).get(mint, hour);
  const recent = db.prepare("SELECT wallet, side, usd, t FROM fomo_flow WHERE mint = ? ORDER BY t DESC LIMIT 12").all(mint)
    .map((r) => ({ ...r, handle: handleOf(r.wallet) }));
  return { ...agg, recent };
}

// Fomo traders the radar has watched, ranked by realized profit on the trades it saw.
export function topTraders(limit = 25) {
  const rows = db.prepare("SELECT wallet, mint, side, tokens, usd FROM fomo_flow WHERE t > ? ORDER BY t").all(now() - 7 * 24 * 60 * MIN);
  const by = new Map();
  for (const r of rows) {
    const w = by.get(r.wallet) || { wallet: r.wallet, trades: 0, mints: new Map(), volume: 0 };
    w.trades++; w.volume += r.usd || 0;
    const m = w.mints.get(r.mint) || { bought: 0, cost: 0, sold: 0, proceeds: 0 };
    if (r.side === "buy") { m.bought += r.tokens; m.cost += r.usd || 0; } else { m.sold += r.tokens; m.proceeds += r.usd || 0; }
    w.mints.set(r.mint, m);
    by.set(r.wallet, w);
  }
  const out = [];
  for (const w of by.values()) {
    let realized = 0, closed = 0, wins = 0;
    for (const m of w.mints.values()) {
      if (!m.bought || !m.sold) continue;
      const pnl = m.proceeds - (m.cost / m.bought) * Math.min(m.sold, m.bought);
      realized += pnl; closed++; if (pnl > 0) wins++;
    }
    const f = db.prepare("SELECT watching, label FROM wallets WHERE address = ?").get(w.wallet);
    out.push({ wallet: w.wallet, handle: handleOf(w.wallet), trades: w.trades, coins: w.mints.size, volume: w.volume, realized, closed, winRate: closed ? wins / closed : null, watching: f?.watching || 0, label: f?.label || null, known: !!f });
  }
  return out.filter((t) => t.closed > 0).sort((a, b) => b.realized - a.realized).slice(0, limit);
}

function autoFollow(addWallet) {
  if (!settings.fomoAutoFollow) return;
  const following = db.prepare("SELECT COUNT(*) n FROM wallets WHERE source = 'fomo' AND watching = 1").get().n;
  let room = settings.fomoFollowTop - following;
  for (const t of topTraders(40)) {
    if (room <= 0) break;
    if (t.known || t.realized < 300 || t.closed < 3 || (t.winRate ?? 0) < 0.5) continue;
    addWallet(t.wallet, "", "fomo");
    db.prepare("UPDATE wallets SET fomo = 1 WHERE address = ?").run(t.wallet);
    room--;
  }
}

// "Fomo crowd buying $X": 3+ different Fomo users bought in the last 30 minutes, and buying beats selling.
// Only coins that pass the safety policy alert; a crowd buying an unsafe coin is not an opportunity.
export async function crowdSignals(raise, adoptMint, vet) {
  const rows = db.prepare(`SELECT mint, COUNT(DISTINCT CASE WHEN side = 'buy' THEN wallet END) buyers,
    SUM(CASE WHEN side = 'buy' THEN usd ELSE 0 END) - SUM(CASE WHEN side = 'sell' THEN usd ELSE 0 END) net
    FROM fomo_flow WHERE t > ? GROUP BY mint HAVING buyers >= 3 AND net > 0`).all(now() - 30 * MIN);
  for (const r of rows) {
    const last = q.lastSignal.get(r.mint, "fomo");
    if (last && now() - last.t < 3 * 60 * MIN) continue;
    adoptMint(r.mint);
    const v = await vet(r.mint).catch(() => null);
    const t = v?.token;
    if (!t?.pair || !v.ok) continue;
    const tk = { mint: r.mint, symbol: t.symbol || r.mint.slice(0, 4), score: t.score || 0, price: t.price || null, mcap: t.mcap || null };
    raise(tk, "fomo", `Fomo crowd buying $${tk.symbol}`, `${r.buyers} Fomo traders bought in the last 30 minutes, net $${Math.round(r.net).toLocaleString()} in.${t.mcap ? ` Mcap $${Math.round(t.mcap).toLocaleString()}.` : ""} Passed safety (${t.safety_score}/100).`);
  }
}

export function startFomo({ addWallet, raise, adoptMint, vet, onTrade }) {
  const timers = [
    setInterval(learnPayers, 60_000),
    setInterval(() => readFlow(onTrade).catch((e) => logEvent("error", `fomo flow: ${e.message}`)), 25_000),
    setInterval(() => { autoFollow(addWallet); crowdSignals(raise, adoptMint, vet).catch((e) => logEvent("error", `fomo crowd: ${e.message}`)); }, 2 * MIN),
    setInterval(() => db.prepare("DELETE FROM fomo_flow WHERE t < ?").run(now() - 7 * 24 * 60 * MIN), 60 * MIN),
  ];
  setTimeout(learnPayers, 5000);
  return () => timers.forEach(clearInterval);
}
