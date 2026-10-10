// GET /api/admin/members (owner only, server.js): what Blix knows about each signed-in member for the owner's
// dashboard (blixvip.com/__admin, worker/site/admin.js): their paper desk (start, cash, equity, P&L, trades,
// open positions, last trade), and their hosted wallet with its real SOL balance. Kept 30 s: the dashboard asks
// every few minutes and one getMultipleAccounts covers every wallet.
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { db, DATA } from "./db.js";
import * as paper from "./paper.js";
import { rpc } from "./solana.js";

let adb = null;
function accountsDb() {
  if (adb) return adb;
  try { adb = new DatabaseSync(path.join(DATA, "accounts.db"), { readOnly: true }); } catch { adb = null; }
  return adb;
}
const all = (d, sql) => { try { return d ? d.prepare(sql).all() : []; } catch { return []; } };

let kept = { t: 0, body: null };
export async function membersReport() {
  if (kept.body && Date.now() - kept.t < 30_000) return kept.body;
  const out = {};
  const get = (email) => (out[email] ||= { email });
  // Paper desks: every member who has traded (who = their email; '' is the owner's own desk).
  for (const r of all(db, "SELECT who, COUNT(*) trades, SUM(status = 'open') open, MIN(t) first_t, MAX(t) last_t, SUM(sol) volume FROM paper WHERE who != '' GROUP BY who")) {
    const m = get(r.who.toLowerCase());
    let w = null;
    try { w = paper.asUser(r.who, () => paper.wallet()); } catch {}
    m.paper = { trades: r.trades, open: r.open, firstTrade: r.first_t, lastTrade: r.last_t, volume: +Number(r.volume || 0).toFixed(4),
      start: w?.start ?? null, cash: w?.cash ?? null, equity: w?.equity ?? null, pnl: w?.pnl ?? null, realized: w?.realized ?? null };
  }
  // Hosted wallets (real SOL, the Vault holds the key) and public profiles.
  const a = accountsDb();
  for (const r of all(a, "SELECT email, address, consented FROM hosted_accounts WHERE address IS NOT NULL")) get(String(r.email).toLowerCase()).wallet = r.address;
  for (const r of all(a, "SELECT a.email, p.username, p.display FROM accounts a JOIN profiles p ON p.account_id = a.id")) { const m = get(String(r.email).toLowerCase()); m.username = r.username || null; m.display = r.display || null; }
  const wallets = Object.values(out).filter((m) => m.wallet);
  for (let i = 0; i < wallets.length; i += 100) {
    const batch = wallets.slice(i, i + 100);
    try {
      const r = await rpc("getMultipleAccounts", [batch.map((m) => m.wallet), { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
      (r?.value || []).forEach((acct, k) => { batch[k].sol = acct ? acct.lamports / 1e9 : 0; });
    } catch { /* balances stay unknown; the rest still answers */ }
  }
  let solUsd = null;
  try { solUsd = paper.asUser("", () => paper.wallet()).solUsd ?? null; } catch {}
  kept = { t: Date.now(), body: { now: Date.now(), solUsd, members: out } };
  return kept.body;
}
