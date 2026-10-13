// Wallet tracker (#/tracker, and the floating tracker window): every member keeps their own list of wallets
// (name, emoji, colour, group P1-P3) and sees what those wallets do as it happens, Axiom-style:
//   Live trades  every buy and sell, within a second for pump.fun curve and PumpSwap pool trades (they come
//                already decoded from the radar's live feeds, livetrades.js / pumpswap.js, with the trader's
//                address on each), and from the chain reader (wallets.js: a websocket per wallet plus a poll,
//                then one getTransaction each) for every other venue;
//   Transfers    SOL and token moves in and out (the chain reader's transactions that were not swaps);
//   Monitor      each wallet's SOL balance, PnL and open bags (wallets.js walletPnl over the trades read);
//   KOLs         pump.fun's leaderboard, one click to track.
// Lists are per member (who = the member's email, "" the owner); the chain work is shared: a wallet two members
// track is read once. A member's wallets are also followed in wallets.js (source "tracker") so its stream and
// poll cover them; they leave that list again when the last member drops them.
// Routes (server.js, members allowed: access.js):
//   GET    /api/wtrack                     { wallets, feed, transfers, status, solUsd }
//   GET    /api/wtrack/feed?since=<id>     { rows } newer than id (the page's catch-up after a stream gap)
//   GET    /api/wtrack/monitor             { wallets: [{ ...wallet, balance, pnl }] }
//   GET    /api/wtrack/kols?range=24h      { rows } pump.fun's board with `tracked` flags
//   POST   /api/wtrack/wallets             { address, name?, emoji?, color?, grp? } add or edit; { wallets: [...] } many
//   POST   /api/wtrack/wallets/<address>   { name?, emoji?, color?, grp?, alerts? } edit
//   DELETE /api/wtrack/wallets/<address>
//   POST   /api/wtrack/import              { text } Axiom's export (JSON) or "address name" lines
// Pushed on the member's own /api/stream: event wtrade { row } and wtransfer { row }.
import { db, logEvent } from "./db.js";
import * as sol from "./solana.js";
import * as wallets from "./wallets.js";
import { onLiveTrade, onPoolLedger, feed as liveFeed, live as liveStats } from "./livetrades.js";
import * as images from "./images.js";
import { handleOf } from "./fomo.js";
import { pumpProfile } from "./walletpage.js";
import { nameOf as coinName } from "./coinindex.js";
import { pumpBoard } from "./pumpboard.js";
import { heliusFetch, activeUrl } from "./heliuskeys.js";
import * as health from "./health.js";

const now = () => Date.now();
const MAX_WALLETS = 200, FEED_KEEP_DAYS = 7, FEED_LIMIT = 300, GROUPS = [1, 2, 3];
const COLORS = ["pink", "green", "blue", "orange", "purple", "yellow", "cyan", "red"];
const short = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;

db.exec(`
CREATE TABLE IF NOT EXISTS wt_wallets (
  who TEXT NOT NULL, address TEXT NOT NULL,
  name TEXT, emoji TEXT, color TEXT, grp INTEGER DEFAULT 1, alerts INTEGER DEFAULT 1,
  added INTEGER NOT NULL,
  PRIMARY KEY (who, address)
);
CREATE INDEX IF NOT EXISTS wtw_addr ON wt_wallets(address);
CREATE TABLE IF NOT EXISTS wt_feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL, sig TEXT NOT NULL, mint TEXT NOT NULL, side TEXT NOT NULL,
  sol REAL, usd REAL, tokens REAL, mc_usd REAL, t INTEGER NOT NULL, src TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS wtf_sig ON wt_feed(wallet, sig, mint);
CREATE INDEX IF NOT EXISTS wtf_t ON wt_feed(t);
CREATE TABLE IF NOT EXISTS wt_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL, sig TEXT NOT NULL, dir TEXT NOT NULL, mint TEXT, amount REAL, usd REAL, other TEXT, t INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS wtt_sig ON wt_transfers(wallet, sig, COALESCE(mint, ''));
CREATE INDEX IF NOT EXISTS wtt_t ON wt_transfers(t);
`);
// The wallet's picture (its pump.fun profile image), fetched once in the background; shown on every row of its trades.
try { db.exec("ALTER TABLE wt_wallets ADD COLUMN pic TEXT"); } catch { /* already there */ }

export const wtStats = { live: 0, chain: 0, transfers: 0, pushed: 0, lastLive: 0, lastChain: 0, dropped: 0, checked: 0 };
let emit = () => {};
const fail = (status, message) => Object.assign(new Error(message), { status });

// ---------- who tracks what (in memory, rebuilt from the table) ----------
const tracked = new Map();   // address -> Set(who)
function reload() {
  tracked.clear();
  for (const r of db.prepare("SELECT who, address FROM wt_wallets").all()) {
    if (!tracked.has(r.address)) tracked.set(r.address, new Set());
    tracked.get(r.address).add(r.who);
  }
}
export const trackedBy = (address) => tracked.get(address) || null;
export const trackedCount = () => tracked.size;

// ---------- the member's list ----------
const cleanName = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || null;
const cleanEmoji = (s) => { const v = String(s ?? "").trim(); return v && [...v].length <= 2 ? v.slice(0, 8) : null; };
const cleanColor = (s) => (COLORS.includes(String(s || "")) ? String(s) : null);
const cleanGrp = (g) => (GROUPS.includes(Number(g)) ? Number(g) : 1);
const cleanPic = (s) => { const v = String(s ?? "").trim(); return /^https:\/\/\S{8,300}$/.test(v) ? v : null; };
const row = (who, address) => db.prepare("SELECT * FROM wt_wallets WHERE who = ? AND address = ?").get(who, address);

export function list(who) {
  const rows = db.prepare(`SELECT w.*, (SELECT MAX(t) FROM wt_feed f WHERE f.wallet = w.address) last_trade,
    (SELECT COUNT(*) FROM wt_feed f WHERE f.wallet = w.address AND f.t > ?) n24 FROM wt_wallets w WHERE who = ? ORDER BY added DESC`).all(now() - 86400_000, who);
  return rows.map((r) => ({ ...r, name: r.name || short(r.address) }));
}

// Add (or edit, when already on the list). Nameless wallets get their Fomo handle or pump.fun name in the background.
export function add(who, { address, name, emoji, color, grp, pic } = {}) {
  address = String(address || "").trim();
  if (!sol.validAddress(address)) throw fail(400, "That doesn't look like a Solana wallet address.");
  const cur = row(who, address);
  if (!cur && db.prepare("SELECT COUNT(*) n FROM wt_wallets WHERE who = ?").get(who).n >= MAX_WALLETS) throw fail(400, `At most ${MAX_WALLETS} wallets.`);
  if (cur) {
    db.prepare("UPDATE wt_wallets SET name = COALESCE(?, name), emoji = COALESCE(?, emoji), color = COALESCE(?, color), grp = ?, pic = COALESCE(?, pic) WHERE who = ? AND address = ?")
      .run(cleanName(name), cleanEmoji(emoji), cleanColor(color), grp == null ? cur.grp : cleanGrp(grp), cleanPic(pic), who, address);
  } else {
    db.prepare("INSERT INTO wt_wallets (who, address, name, emoji, color, grp, added, pic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(who, address, cleanName(name), cleanEmoji(emoji), cleanColor(color), cleanGrp(grp), now(), cleanPic(pic));
    reload(); if (cleanName(name) && !cleanPic(pic)) autoName(who, address);   // a named wallet still gets its picture
    // The shared chain reader follows it from now on (its stream and poll); what it already read shows at once.
    if (!cleanName(name)) autoName(who, address);
  }
  return { ...row(who, address), name: row(who, address).name || short(address) };
}

export function update(who, address, patch = {}) {
  const cur = row(who, address);
  if (!cur) throw fail(404, "Not on your list.");
  if ("name" in patch) db.prepare("UPDATE wt_wallets SET name = ? WHERE who = ? AND address = ?").run(cleanName(patch.name), who, address);
  if ("emoji" in patch) db.prepare("UPDATE wt_wallets SET emoji = ? WHERE who = ? AND address = ?").run(cleanEmoji(patch.emoji), who, address);
  if ("color" in patch) db.prepare("UPDATE wt_wallets SET color = ? WHERE who = ? AND address = ?").run(cleanColor(patch.color), who, address);
  if ("grp" in patch) db.prepare("UPDATE wt_wallets SET grp = ? WHERE who = ? AND address = ?").run(cleanGrp(patch.grp), who, address);
  if ("alerts" in patch) db.prepare("UPDATE wt_wallets SET alerts = ? WHERE who = ? AND address = ?").run(patch.alerts === false ? 0 : 1, who, address);
  return { ...row(who, address), name: row(who, address).name || short(address) };
}

export function remove(who, address) {
  db.prepare("DELETE FROM wt_wallets WHERE who = ? AND address = ?").run(who, address);
  reload();
  // Nobody else tracks it and the owner never followed it themselves: the chain reader lets it go.
  if (!tracked.has(address)) {
    const w = db.prepare("SELECT source FROM wallets WHERE address = ?").get(address);
    if (w?.source === "tracker") wallets.removeWallet(address);
  }
  return { ok: true };
}

// Axiom's export is a JSON array of { trackedWalletAddress, name, emoji, groups? }; plain lists are "address[, name]"
// one per line. Up to the member's cap.
export function importText(who, text) {
  const items = [];
  const t = String(text || "").trim();
  if (!t) throw fail(400, "Nothing to import.");
  let parsed = null;
  try { parsed = JSON.parse(t); } catch {}
  if (Array.isArray(parsed)) {
    for (const x of parsed) {
      if (!x || typeof x !== "object") continue;
      const address = x.trackedWalletAddress || x.address || x.wallet || x.walletAddress;
      const grp = Array.isArray(x.groups) ? Number(String(x.groups[0] || "").replace(/\D/g, "")) || 1 : x.grp ?? x.group ?? 1;
      items.push({ address, name: x.name || x.label || null, emoji: x.emoji || null, color: x.color || null, grp });
    }
  } else {
    for (const line of t.split(/\r?\n/)) {
      const m = line.trim().match(/^([1-9A-HJ-NP-Za-km-z]{32,44})(?:[\s,;|]+(.*))?$/);
      if (m) items.push({ address: m[1], name: (m[2] || "").trim() || null });
    }
  }
  let added = 0, skipped = 0;
  for (const it of items) { try { add(who, it); added++; } catch { skipped++; } }
  if (!added && !skipped) throw fail(400, "No wallet addresses found in that text.");
  return { added, skipped };
}

export const exportList = (who) => db.prepare("SELECT address trackedWalletAddress, name, emoji, color, grp FROM wt_wallets WHERE who = ? ORDER BY added").all(who).map((r) => ({ ...r, groups: [`P${r.grp || 1}`] }));

// The name and the picture, from its Fomo handle (name) and its pump.fun profile (name and picture), filled in
// only where the member left them blank.
async function autoName(who, address) {
  try {
    let name = handleOf(address);
    const p = await pumpProfile(address);
    if (!name) name = p?.name || null;
    if (name && !row(who, address)?.name) db.prepare("UPDATE wt_wallets SET name = ? WHERE who = ? AND address = ? AND name IS NULL").run(cleanName(name), who, address);
    const pic = cleanPic(p?.pic);
    if (pic) db.prepare("UPDATE wt_wallets SET pic = ? WHERE address = ? AND pic IS NULL").run(pic, address);
  } catch {}
}
// Wallets tracked before pictures were kept: one profile read each, spaced out, after a start.
function backfillPics() {
  const rows = db.prepare("SELECT DISTINCT address FROM wt_wallets WHERE pic IS NULL LIMIT 100").all();
  rows.forEach((r, i) => { const t = setTimeout(() => autoName("", r.address), 3000 + i * 1500); t.unref?.(); });
}

// What the chain reader already knows of the wallet (the owner followed it, or another member did): into the feed.
function seedHistory(address) {
  const rows = db.prepare("SELECT sig, mint, side, tokens, sol, usd, t FROM wallet_trades WHERE wallet = ? ORDER BY t DESC LIMIT 60").all(address);
  const ins = db.prepare("INSERT OR IGNORE INTO wt_feed (wallet, sig, mint, side, sol, usd, tokens, mc_usd, t, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'history')");
  for (const r of rows) ins.run(address, r.sig, r.mint, r.side, r.sol, r.usd, r.tokens, null, r.t);
}

// ---------- trades ----------
// The coin's cap for a chain-read trade: the indexed one, else the live feed's last reading of the curve or pool.
const mcOf = (mint) => {
  const kept = db.prepare("SELECT mcap FROM tokens WHERE mint = ?").get(mint)?.mcap;
  if (kept > 0) return kept;
  const s = liveStats.get(mint);
  return s && s.mc > 0 ? s.mc * (liveFeed.solUsd || 150) * ((s.supply > 0 ? s.supply : 1e9) / 1e9) : null;
};
// One trade by a tracked wallet, from whichever path saw it first (the live feeds or the chain reader): kept once
// (wallet, sig, mint), into wallets.js's ledger too when the live feed got there first, and pushed to every member
// tracking the wallet.
function record({ wallet, sig, mint, side, solAmt, usd, tokens, mcUsd, t, src }) {
  // The same trade seen twice: the live feed hears it first (sometimes without its signature, under a slot key),
  // the chain reader a second later with the signature. Same wallet, coin and side within six seconds for about
  // the same SOL, one of them slot-keyed, is one trade: the first row keeps the feed, and gets the signature and
  // the cap it lacked.
  // (The user, 2026-10-12: "the numbers should be accurate".)
  if (src !== "history") {
    const twin = db.prepare("SELECT id, sig, sol, mc_usd FROM wt_feed WHERE wallet = ? AND mint = ? AND side = ? AND src != 'history' AND ABS(t - ?) <= 6000 ORDER BY ABS(t - ?) LIMIT 1").get(wallet, mint, side, t, t);
    // Two real signatures are two trades (a bot buying the same size twice): only a slot-keyed row can be the twin.
    if (twin && twin.sig !== sig && (twin.sig.startsWith("slot:") || sig.startsWith("slot:")) && (solAmt == null || twin.sol == null || Math.abs(twin.sol - solAmt) <= Math.max(0.002, 0.03 * Math.max(twin.sol, solAmt)))) {
      try {
        if (twin.sig.startsWith("slot:") && !sig.startsWith("slot:")) db.prepare("UPDATE wt_feed SET sig = ?, mc_usd = COALESCE(mc_usd, ?) WHERE id = ?").run(sig, mcUsd, twin.id);
        else if (twin.mc_usd == null && mcUsd > 0) db.prepare("UPDATE wt_feed SET mc_usd = ? WHERE id = ?").run(mcUsd, twin.id);
      } catch {}
      return;
    }
  }
  const r = db.prepare("INSERT OR IGNORE INTO wt_feed (wallet, sig, mint, side, sol, usd, tokens, mc_usd, t, src) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(wallet, sig, mint, side, solAmt, usd, tokens, mcUsd, t, src);
  if (!r.changes) return;
  // The coin's picture, fetched now if the radar has none yet (a coin minutes old): the row shows it on arrival.
  if (src !== "history") { try { images.eager(mint); } catch {} }
  if (src !== "chain" && !sig.startsWith("slot:")) {
    try {
      const w = db.prepare("INSERT OR IGNORE INTO wallet_trades (sig, wallet, mint, side, tokens, sol, usd, t, payer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)").run(sig, wallet, mint, side, tokens, solAmt, usd, t);
      if (w.changes) db.prepare("UPDATE wallets SET last_trade = MAX(COALESCE(last_trade, 0), ?) WHERE address = ?").run(t, wallet);
    } catch {}
  }
  const id = Number(r.lastInsertRowid);
  push("wtrade", feedRows({ ids: [id] }));
}

function push(event, rows) {
  for (const base of rows) {
    const whos = tracked.get(base.wallet);
    if (!whos) continue;
    for (const who of whos) {
      const w = row(who, base.wallet);
      if (!w) continue;
      wtStats.pushed++;
      emit(who, event, { row: { ...base, name: w.name || short(base.wallet), emoji: w.emoji, color: w.color, grp: w.grp } });
    }
  }
}

// A curve or pool trade from the radar's live feeds: (mint, stats, sol, buy, { user, tokens, slot, sig }).
function fromLive(mint, s, solAmt, buy, x = {}) {
  const user = x.user;
  if (!user || !tracked.has(user)) return;
  const solUsd = liveFeed.solUsd || 150;
  const supply = s.supply > 0 ? s.supply : 1e9;
  wtStats.live++; wtStats.lastLive = now();
  health.ok("wtrack");
  record({ wallet: user, sig: x.sig || `slot:${x.slot ?? now()}:${mint}:${buy ? "b" : "s"}`, mint, side: buy ? "buy" : "sell", solAmt, usd: solAmt * solUsd, tokens: x.tokens ?? null,
    mcUsd: s.mc > 0 ? s.mc * solUsd * (supply / 1e9) : null, t: now(), src: s.pool ? "pool" : "curve" });
}

// A swap the chain reader decoded (engine.js bus "walletTrade"): { wallet: row, trade: { mint, side, tokens, sol, usd, t, sig } }.
export function fromEngine(ev) {
  const a = ev?.wallet?.address, tr = ev?.trade;
  if (!a || !tr?.sig || !tracked.has(a)) return;
  wtStats.chain++; wtStats.lastChain = now();
  record({ wallet: a, sig: tr.sig, mint: tr.mint, side: tr.side, solAmt: tr.sol, usd: tr.usd ?? null, tokens: tr.tokens ?? null, mcUsd: mcOf(tr.mint), t: tr.t || now(), src: "chain" });
}

// ---------- transfers ----------
const SYSTEM = new Set(["11111111111111111111111111111111", "ComputeBudget111111111111111111111111111111", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VYzRBRT44hA3hGMSiYqt6vHu4x5Xm", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"]);
// A transaction of a tracked wallet that was not a swap: SOL or one token moved in or out. The counterparty is the
// account whose balance moved the other way the most (for SOL) or the other owner of the token (for a token).
export function parseTransfer(tx, wallet) {
  if (!tx || tx.meta?.err) return null;
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === "string" ? k : k.pubkey));
  const i = keys.indexOf(wallet);
  if (i < 0) return null;
  const payer = keys[0] === wallet;
  const lam = tx.meta.postBalances.map((b, k) => b - tx.meta.preBalances[k]);
  let solDelta = (lam[i] + (payer ? tx.meta.fee : 0)) / 1e9;
  const tokens = new Map(), owners = new Map();
  const add = (b, sign) => {
    if (b.mint === sol.WSOL && b.owner === wallet) { solDelta += (Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals) * sign; return; }
    const v = (Number(b.uiTokenAmount.amount) / 10 ** b.uiTokenAmount.decimals) * sign;
    if (b.owner === wallet) tokens.set(b.mint, (tokens.get(b.mint) || 0) + v);
    else if (b.owner && !SYSTEM.has(b.owner)) { const k = `${b.mint}|${b.owner}`; owners.set(k, (owners.get(k) || 0) + v); }
  };
  for (const b of tx.meta.preTokenBalances || []) add(b, -1);
  for (const b of tx.meta.postTokenBalances || []) add(b, +1);
  const moved = [...tokens].filter(([, d]) => Math.abs(d) > 0);
  const t = (tx.blockTime || 0) * 1000 || now();
  if (moved.length === 1 && Math.abs(solDelta) < 0.01) {
    const [mint, d] = moved[0];
    const other = [...owners].filter(([k, v]) => k.startsWith(`${mint}|`) && Math.sign(v) === -Math.sign(d)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0].split("|")[1] || null;
    return { dir: d > 0 ? "in" : "out", mint, amount: Math.abs(d), other, t };
  }
  if (!moved.length && Math.abs(solDelta) >= 0.01) {
    let other = null, best = 0;
    for (let k = 0; k < keys.length; k++) {
      if (k === i || SYSTEM.has(keys[k])) continue;
      if (Math.sign(lam[k]) === -Math.sign(solDelta) && Math.abs(lam[k]) > best) { best = Math.abs(lam[k]); other = keys[k]; }
    }
    return { dir: solDelta > 0 ? "in" : "out", mint: null, amount: Math.abs(solDelta), other, t };
  }
  return null;
}

function fromTx(w, tx, job) {
  const a = w?.address;
  if (!a || w.scan || !tracked.has(a)) return;
  if (sol.parseSwaps(tx, a).length) return;
  const tr = parseTransfer(tx, a);
  if (!tr) return;
  const usd = tr.mint ? null : tr.amount * (liveFeed.solUsd || 150);
  const r = db.prepare("INSERT OR IGNORE INTO wt_transfers (wallet, sig, dir, mint, amount, usd, other, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(a, job.sig, tr.dir, tr.mint, tr.amount, usd, tr.other, tr.t);
  if (!r.changes) return;
  wtStats.transfers++;
  push("wtransfer", transferRows({ ids: [Number(r.lastInsertRowid)] }));
}

// ---------- reads ----------
const meta = (mint) => {
  const t = db.prepare("SELECT symbol, name, mcap, first_seen, pair_created FROM tokens WHERE mint = ?").get(mint);
  if (t) return { symbol: t.symbol || null, tname: t.name || null, mcap: t.mcap ?? null, born: t.pair_created || t.first_seen || null };
  const c = coinName(mint);
  return { symbol: c?.symbol || null, tname: c?.name || null, mcap: null, born: null };
};
function feedRows({ who = null, ids = null, since = 0, limit = FEED_LIMIT, grp = null, wallet = null } = {}) {
  const where = [], args = [];
  if (ids) { where.push(`f.id IN (${ids.map(() => "?").join(",")})`); args.push(...ids); }
  if (who != null) { where.push("f.wallet IN (SELECT address FROM wt_wallets WHERE who = ?" + (grp ? " AND grp = ?" : "") + ")"); args.push(who); if (grp) args.push(grp); }
  if (since) { where.push("f.id > ?"); args.push(since); }
  if (wallet) { where.push("f.wallet = ?"); args.push(wallet); }
  const rows = db.prepare(`SELECT f.* FROM wt_feed f ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY f.id DESC LIMIT ?`).all(...args, Math.min(500, Math.max(1, limit | 0)));
  return rows.map((r) => ({ ...r, ...meta(r.mint) }));
}
function transferRows({ who = null, ids = null, limit = 150 } = {}) {
  const where = [], args = [];
  if (ids) { where.push(`x.id IN (${ids.map(() => "?").join(",")})`); args.push(...ids); }
  if (who != null) { where.push("x.wallet IN (SELECT address FROM wt_wallets WHERE who = ?)"); args.push(who); }
  const rows = db.prepare(`SELECT x.* FROM wt_transfers x ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY x.id DESC LIMIT ?`).all(...args, limit);
  return rows.map((r) => ({ ...r, ...(r.mint ? meta(r.mint) : { symbol: "SOL", tname: "Solana", mcap: null, born: null }) }));
}
const named = (who, rows) => {
  const by = new Map(list(who).map((w) => [w.address, w]));
  return rows.map((r) => { const w = by.get(r.wallet); return { ...r, name: w?.name || short(r.wallet), emoji: w?.emoji || null, color: w?.color || null, grp: w?.grp || 1, pic: w?.pic || null }; });
};

export function overview(who, { grp = null, limit = FEED_LIMIT } = {}) {
  const tr = wallets.tracking();
  return {
    wallets: list(who),
    feed: named(who, feedRows({ who, grp: grp ? cleanGrp(grp) : null, limit })),
    transfers: named(who, transferRows({ who })),
    status: { stream: tr.stream.connected, streamWallets: tr.stream.wallets, backlog: tr.backlog, live: liveFeed.connected, lastLive: wtStats.lastLive, lastChain: wtStats.lastChain,
      fast: Boolean(tr.fast?.connected), fastWallets: tr.fast?.wallets || 0, fastReads: tr.fast?.reads || 0, dropped: wtStats.dropped },
    solUsd: liveFeed.solUsd || 150,
    groups: GROUPS, colors: COLORS, max: MAX_WALLETS,
  };
}
export const feedSince = (who, since, limit = 200) => ({ rows: named(who, feedRows({ who, since: Number(since) || 0, limit })) });

// ---------- monitor: balances and PnL ----------
const balances = new Map();   // address -> { v, t }
async function readBalances(addresses) {
  const want = addresses.filter((a) => now() - (balances.get(a)?.t || 0) > 60_000).slice(0, 100);
  if (!want.length) return;
  const http = activeUrl()?.replace(/^ws/i, "http");
  let got = null;
  if (http) {
    try {
      const r = await heliusFetch(http, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [want, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }] }) });
      got = (await r.json())?.result?.value || null;
    } catch {}
  }
  if (!got) { try { got = (await sol.rpc("getMultipleAccounts", [want, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]))?.value || null; } catch {} }
  if (!got) return;
  got.forEach((acc, i) => balances.set(want[i], { v: acc ? acc.lamports / 1e9 : 0, t: now() }));
}
const pnlCache = new Map();   // address -> { v, t }
function pnlOf(address) {
  const c = pnlCache.get(address);
  if (c && now() - c.t < 30_000) return c.v;
  const p = wallets.walletPnl(address);
  const v = { realized: p.realized, unrealized: p.unrealized, openValue: p.openValue, winRate: p.winRate, closed: p.closed, open: p.open, trades: p.trades,
    positions: p.positions.filter((x) => x.held > 0 && (x.value == null || x.value > 1)).slice(0, 6).map((x) => ({ mint: x.mint, symbol: x.symbol, held: x.held, value: x.value, unrealized: x.unrealized, mcap: x.mcap, last: x.last })) };
  pnlCache.set(address, { v, t: now() });
  if (pnlCache.size > 2000) pnlCache.clear();
  return v;
}
export async function monitor(who) {
  const ws = list(who);
  await readBalances(ws.map((w) => w.address));
  return { wallets: ws.map((w) => ({ ...w, balance: balances.get(w.address)?.v ?? null, pnl: pnlOf(w.address) })), solUsd: liveFeed.solUsd || 150 };
}

// ---------- KOLs: pump.fun's leaderboard, as suggestions ----------
export async function kols(who, range = "24h") {
  const b = await pumpBoard({ range: ["24h", "7d", "30d"].includes(range) ? range : "24h" });
  const mine = new Set(list(who).map((w) => w.address));
  return { range: b?.range || range, error: b?.error || null, rows: (b?.rows || []).slice(0, 60).map((r) => ({ rank: r.rank, wallet: r.wallet, name: r.name, pic: r.pic, x: r.x, pnl: r.pnl, pnlSol: r.pnlSol, pnlPct: r.pnlPct, positions: r.positions, tracked: mine.has(r.wallet) })) };
}

// ---------- the confirmation sweep ----------
// The live feeds hear a trade at "processed", a slot or two before it is confirmed; now and then one never lands
// (its block was abandoned). Rows from those feeds are checked at "confirmed" 6 s to 2 min after they were recorded
// (getSignatureStatuses, one call for up to 256); a row whose transaction failed or is unknown by then is deleted and
// every member tracking the wallet hears wtdrop { id } so the chip leaves their screen.
const verified = new Set();
export async function confirmSweep(statusFn = (sigs) => sol.rpc("getSignatureStatuses", [sigs, { searchTransactionHistory: false }]).then((r) => r?.value || [])) {
  const t = now();
  const rows = db.prepare("SELECT id, wallet, sig FROM wt_feed WHERE src IN ('curve', 'pool') AND sig NOT LIKE 'slot:%' AND t BETWEEN ? AND ? ORDER BY id DESC LIMIT 256").all(t - 120_000, t - 6_000)
    .filter((r) => !verified.has(r.id));
  if (!rows.length) return { checked: 0, dropped: 0 };
  let st;
  try { st = await statusFn(rows.map((r) => r.sig)); } catch { return { checked: 0, dropped: 0 }; }
  let dropped = 0;
  rows.forEach((r, i) => {
    const x = st[i];
    // Known and fine: done. Unknown this early can still mean "the node's cache is behind": it is asked again next pass
    // until the row is 2 minutes old; failed, or still unknown at the end, is gone.
    if (x && !x.err) { verified.add(r.id); return; }
    if (!x && t - 60_000 < (db.prepare("SELECT t FROM wt_feed WHERE id = ?").get(r.id)?.t ?? 0)) return;
    db.prepare("DELETE FROM wt_feed WHERE id = ?").run(r.id);
    db.prepare("DELETE FROM wallet_trades WHERE sig = ? AND wallet = ?").run(r.sig, r.wallet);
    verified.add(r.id); dropped++; wtStats.dropped++;
    const whos = tracked.get(r.wallet) || [];
    for (const who of whos) emit(who, "wtdrop", { id: r.id, wallet: r.wallet, sig: r.sig });
  });
  wtStats.checked += rows.length;
  if (verified.size > 5000) for (const k of [...verified].slice(0, 2500)) verified.delete(k);
  return { checked: rows.length, dropped };
}

// ---------- start ----------
export function status() {
  return { wallets: tracked.size, members: db.prepare("SELECT COUNT(DISTINCT who) n FROM wt_wallets").get().n, ...wtStats };
}
const timers = [];
export function stop() { for (const t of timers.splice(0)) clearTimeout(t); }
export function start(emitFn) {
  stop();
  emit = emitFn || emit;
  reload();
  onLiveTrade(fromLive);
  onPoolLedger(fromLive);
  wallets.onTx(fromTx);
  // Every wallet on a member's list is followed by the chain reader (a restart, or lists made before this ran).
  for (const a of tracked.keys()) {
    wallets.addWallet(a, "", "tracker");
    seedHistory(a);
  }
  wallets.resyncFast();
  backfillPics();
  const prune = () => {
    try {
      db.prepare("DELETE FROM wt_feed WHERE t < ?").run(now() - FEED_KEEP_DAYS * 86400_000);
      db.prepare("DELETE FROM wt_transfers WHERE t < ?").run(now() - FEED_KEEP_DAYS * 86400_000);
    } catch (e) { logEvent("error", `wallet tracker prune: ${e.message}`); }
  };
  timers.push(setTimeout(prune, 60_000), setInterval(prune, 6 * 3600_000));
  const sweep = () => { if (tracked.size) confirmSweep().catch(() => {}); };
  timers.push(setInterval(sweep, 10_000));
  for (const t of timers) t.unref?.();
}
