// Wallet tracking: your watchlist, their live trades and PnL, and "smart money" discovery
// (wallets that keep showing up early or as top holders in coins that later ran).
import { db, q, json, logEvent } from "./db.js";
import { settings } from "./settings.js";
import * as sol from "./solana.js";
import * as src from "./sources.js";
import { handleOf } from "./fomo.js";
import { exitState, onCurve } from "./quality.js";
import * as health from "./health.js";

db.exec(`
CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  label TEXT,
  source TEXT,              -- you | smart | fomo
  watching INTEGER DEFAULT 1,
  added INTEGER,
  last_sig TEXT,
  last_poll INTEGER,
  last_trade INTEGER,
  backfilled INTEGER DEFAULT 0,
  fomo INTEGER DEFAULT 0    -- trades on Fomo
);
CREATE TABLE IF NOT EXISTS wallet_trades (
  sig TEXT, wallet TEXT, mint TEXT, side TEXT,
  tokens REAL, sol REAL, usd REAL, t INTEGER,
  payer TEXT,               -- who paid the network fee (Fomo pays for its users)
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

try { db.exec("ALTER TABLE wallets ADD COLUMN fomo INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE wallet_trades ADD COLUMN payer TEXT"); } catch {}
// missed: transactions the radar knows it could not read (bot-speed wallets, RPC gaps).
try { db.exec("ALTER TABLE wallets ADD COLUMN missed INTEGER DEFAULT 0"); } catch {}
try { db.exec("ALTER TABLE wallets ADD COLUMN last_event INTEGER"); } catch {}

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
  const sigs = (await sol.signatures(address, { limit: 15 })) || [];
  for (const s of sigs.filter((x) => !x.err).slice(0, 12)) await readTx({ address, scan: true }, { sig: s.signature, t: (s.blockTime || 0) * 1000, quiet: true }).catch(() => {});
}

export function removeWallet(address) {
  db.prepare("DELETE FROM wallets WHERE address = ?").run(address);
  db.prepare("DELETE FROM wallet_trades WHERE wallet = ?").run(address);
}

const nameOf = (w) => w?.label || short(w?.address || "????????");

// ---------- reading trades ----------
// Two feeds find a wallet's new transactions: a live websocket subscription per wallet (seconds), and a
// slower poll that backfills new wallets and catches anything the stream dropped. Both only produce
// signatures; one reader then fetches each transaction, paced to what the RPC allows.
const backlog = new Map();   // address -> [{ sig, t, quiet, tries }], newest first
const readSigs = new Set();  // signatures already fetched that were not swaps (don't fetch them twice)
const lag = new Map();       // address -> ms between a trade landing and the radar reading it (rolling)
const BACKLOG_MAX = 120;

function miss(address, n, why) {
  if (!n) return;
  db.prepare("UPDATE wallets SET missed = COALESCE(missed, 0) + ? WHERE address = ?").run(n, address);
  logEvent("wallet", `${short(address)}: ${n} transaction${n > 1 ? "s" : ""} not read (${why})`);
}

function enqueue(address, sigs) {
  const list = backlog.get(address) || [];
  const have = new Set(list.map((x) => x.sig));
  for (const s of sigs) if (!have.has(s.sig) && !readSigs.has(`${address}:${s.sig}`)) list.push({ tries: 0, ...s });
  list.sort((a, b) => b.t - a.t);
  // A wallet trading faster than the RPC can be read: keep the newest, and say how many were skipped.
  if (list.length > BACKLOG_MAX) miss(address, list.splice(BACKLOG_MAX).length, "trading faster than the RPC can be read");
  backlog.set(address, list);
}

let reading = false;
async function drain(emit) {
  if (reading) return;
  reading = true;
  try {
    // One transaction per wallet per pass, your own wallets first, so a busy bot cannot starve the rest.
    for (let pass = 0; pass < 400; pass++) {
      const wallets = db.prepare("SELECT * FROM wallets WHERE watching = 1 ORDER BY source = 'you' DESC, source = 'fomo' DESC").all().filter((w) => backlog.get(w.address)?.length);
      for (const a of backlog.keys()) if (!wallets.some((w) => w.address === a)) backlog.delete(a);   // paused or unfollowed
      if (!wallets.length) break;
      for (const w of wallets) {
        const job = backlog.get(w.address).shift();
        try { await readTx(w, job, emit); }
        catch (e) {
          if (++job.tries < 3) backlog.get(w.address).push(job);
          else miss(w.address, 1, e.limited ? "RPC rate limit" : e.message);
          if (e.limited) return;   // the RPC needs a rest; the next tick picks the backlog up again
        }
      }
    }
  } finally { reading = false; }
}

async function readTx(w, job, emit) {
  const key = `${w.address}:${job.sig}`;
  if (readSigs.has(key) || db.prepare("SELECT 1 FROM wallet_trades WHERE sig = ? AND wallet = ?").get(job.sig, w.address)) return;
  const tx = await sol.transaction(job.sig);
  if (!tx) throw new Error("transaction not available yet");
  readSigs.add(key);
  if (readSigs.size > 20000) for (const k of [...readSigs].slice(0, 5000)) readSigs.delete(k);
  const price = await solPrice();
  for (const sw of sol.parseSwaps(tx, w.address)) {
    const usd = sw.usd ?? sw.sol * price;
    const k0 = tx.transaction.message.accountKeys[0];
    const payer = typeof k0 === "string" ? k0 : k0?.pubkey;
    const t = sw.t || job.t;
    const r = db.prepare("INSERT OR IGNORE INTO wallet_trades (sig, wallet, mint, side, tokens, sol, usd, t, payer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(job.sig, w.address, sw.mint, sw.side, sw.tokens, sw.sol, usd, t, payer || null);
    if (!r.changes || w.scan) continue;
    db.prepare("UPDATE wallets SET last_trade = MAX(COALESCE(last_trade, 0), ?) WHERE address = ?").run(t, w.address);
    if (!job.quiet) lag.set(w.address, Math.round((lag.get(w.address) ?? now() - t) * 0.6 + (now() - t) * 0.4));
    if (!job.quiet && now() - t < 30 * MIN) emit?.({ wallet: w, trade: { ...sw, t, usd, sig: job.sig }, lagMs: now() - t });
  }
}

// Backstop poll, round-robin. New wallets get their last ~25 transactions backfilled once (no alerts).
let polling = false;
async function pollWallets(emit) {
  if (polling) return;
  polling = true;
  try {
    const list = db.prepare("SELECT * FROM wallets WHERE watching = 1 ORDER BY backfilled ASC, source = 'you' DESC, source = 'fomo' DESC, COALESCE(last_poll, 0) ASC").all();
    // With the live stream up, polling only needs to sweep slowly for anything the stream dropped.
    const budget = settings.rpcUrl ? 30 : stream.connected ? 4 : 8;
    for (const w of list.slice(0, budget)) await pollOne(w).catch((e) => { if (!e.limited) logEvent("error", `wallet ${short(w.address)}: ${e.message}`); });
    pauseBots();
  } finally {
    polling = false;
    drain(emit).catch((e) => logEvent("error", `wallet reader: ${e.message}`));
  }
}

async function pollOne(w) {
  const first = !w.backfilled;
  const pages = first ? 1 : settings.rpcUrl ? 8 : 3;
  let all = [], before, reached = first || !w.last_sig;
  for (let p = 0; p < pages; p++) {
    const sigs = (await sol.signatures(w.address, { limit: first ? 25 : 50, ...(before ? { before } : {}), ...(w.last_sig && !first ? { until: w.last_sig } : {}) })) || [];
    all = all.concat(sigs);
    if (sigs.length < 50) { reached = true; break; }   // got everything back to the last one we saw
    before = sigs[sigs.length - 1].signature;
  }
  db.prepare("UPDATE wallets SET last_poll = ?, last_sig = COALESCE(?, last_sig), backfilled = 1 WHERE address = ?").run(now(), all[0]?.signature || null, w.address);
  // More activity than we could page through since the last look: the older part is a known gap.
  if (!reached) miss(w.address, 1, `more than ${all.length} transactions since the last check; the oldest were skipped`);
  enqueue(w.address, all.filter((s) => !s.err).map((s) => ({ sig: s.signature, t: (s.blockTime || 0) * 1000 || now(), quiet: first })));
}

// ---------- live stream ----------
// logsSubscribe{mentions:[wallet]} on the RPC websocket (the free public one allows it): every
// transaction touching a followed wallet arrives within a second or two of confirming.
export const stream = { connected: false, wallets: 0, events: 0, lastEvent: 0, url: null, since: 0, error: null };
function startStream(emit) {
  let ws, subs = new Map(), pending = new Map(), id = 0, alive = true, opened = 0;
  const wanted = () => db.prepare("SELECT address FROM wallets WHERE watching = 1 ORDER BY source = 'you' DESC, COALESCE(last_trade, 0) DESC LIMIT 60").all().map((r) => r.address);
  const sync = () => {
    if (ws?.readyState !== 1) return;
    const want = new Set(wanted()), have = new Set([...subs.values(), ...pending.values()]);
    for (const a of want) if (!have.has(a)) { pending.set(++id, a); ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "logsSubscribe", params: [{ mentions: [a] }, { commitment: "confirmed" }] })); }
    for (const [sub, a] of subs) if (!want.has(a)) { subs.delete(sub); ws.send(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "logsUnsubscribe", params: [sub] })); }
    stream.wallets = subs.size;
  };
  const connect = () => {
    if (!alive) return;
    const url = settings.rpcWsUrl?.trim() || (settings.rpcUrl?.trim() ? settings.rpcUrl.trim().replace(/^http/, "ws") : "wss://api.mainnet-beta.solana.com");
    stream.url = url.replace(/api-key=[^&]+/, "api-key=…");
    try { ws = new WebSocket(url); } catch (e) { stream.error = e.message; return setTimeout(connect, 10_000); }
    subs = new Map(); pending = new Map();
    ws.onopen = () => { stream.connected = true; stream.since = opened = now(); stream.error = null; health.ok("wallet-stream"); sync(); };
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d.id && pending.has(d.id)) {
        const a = pending.get(d.id); pending.delete(d.id);
        if (d.error) { stream.error = d.error.message; health.fail("wallet-stream", d.error.message); } else subs.set(d.result, a);
        stream.wallets = subs.size;
        return;
      }
      const a = subs.get(d.params?.subscription), v = d.params?.result?.value;
      if (!a || !v?.signature) return;
      stream.events++; stream.lastEvent = now();
      db.prepare("UPDATE wallets SET last_event = ? WHERE address = ?").run(now(), a);
      if (v.err) return;
      enqueue(a, [{ sig: v.signature, t: now() }]);
      drain(emit).catch((e) => logEvent("error", `wallet reader: ${e.message}`));
    };
    ws.onclose = () => { if (stream.connected) health.fail("wallet-stream", "disconnected"); stream.connected = false; stream.wallets = 0; if (alive) setTimeout(connect, 5000); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  };
  connect();
  const timer = setInterval(() => {
    sync();
    // Public endpoints silently drop long-lived sockets: replace one that has been quiet for 15 minutes.
    if (stream.connected && now() - Math.max(stream.lastEvent, opened) > 15 * MIN) { try { ws.close(); } catch {} }
  }, 30_000);
  return () => { alive = false; clearInterval(timer); try { ws?.close(); } catch {} };
}

// How current the wallet tracking really is, per wallet.
export function tracking() {
  const rows = db.prepare("SELECT address, label, source, last_poll, last_event, last_trade, missed FROM wallets WHERE watching = 1").all();
  return {
    stream: { ...stream }, rpc: { ...sol.rpcStats, public: sol.rpcPublic() },
    backlog: [...backlog.values()].reduce((s, l) => s + l.length, 0),
    wallets: rows.map((w) => ({ ...w, name: nameOf(w), backlog: backlog.get(w.address)?.length || 0, lagMs: lag.get(w.address) ?? null, checked: Math.max(w.last_poll || 0, w.last_event || 0) })),
  };
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
    const row = q.getToken.get(p.mint);
    const t = row?.price ? row : prices.get(p.mint) || row;
    const avg = p.bought ? p.cost / p.bought : 0;
    const soldKnown = Math.min(p.sold, p.bought);
    const realized = p.bought ? p.proceeds - avg * soldKnown : null;     // null: sold coins bought before we watched
    const held = Math.max(0, p.bought - p.sold);
    // "value" is the quoted price times the bag. It only counts as open PnL when the coin can be sold;
    // a bag in an emptied pool is worth nothing whatever the quote says.
    const exit = exitState(t, settings.minExitLiq);
    const value = t?.price && held > 0 ? held * t.price : held > 0 ? null : 0;
    // You cannot pull more out of a pool than a slice of what is in it.
    const sellable = value == null || !exit.ok ? 0 : onCurve(t) ? value : Math.min(value, (t.liquidity || 0) * 0.25);
    const unrealized = value != null && exit.ok ? value - avg * held : null;
    return { ...p, symbol: t?.symbol || null, name: t?.name || null, image: t?.image || null, price: t?.price || null, mcap: t?.mcap || null, liquidity: t?.liquidity ?? null,
      avg, held, value, sellable, realized, unrealized, exitable: exit.ok, exitWhy: exit.why, stale: row?.status === "dead" };
  }).sort((a, b) => b.last - a.last);
  const closed = positions.filter((p) => p.realized != null && p.sells > 0);
  const open = positions.filter((p) => p.held > 0 && (p.value == null || p.value > 1));
  const stuck = open.filter((p) => !p.exitable);
  const cost = (list) => list.reduce((s, p) => s + p.avg * p.held, 0);
  return {
    positions,
    trades: trades.length,
    realized: closed.reduce((s, p) => s + p.realized, 0),
    // Open positions at quoted prices, sellable coins only.
    unrealized: positions.reduce((s, p) => s + (p.unrealized || 0), 0),
    openValue: open.filter((p) => p.exitable).reduce((s, p) => s + (p.value || 0), 0),
    // What the open positions could plausibly be sold for, after pool depth.
    sellableValue: open.reduce((s, p) => s + p.sellable, 0),
    sellablePnl: open.reduce((s, p) => s + p.sellable, 0) - cost(open),
    // Bags in emptied or delisted pools: quoted value shown for reference, counted as zero.
    stuck: stuck.length, stuckQuoted: stuck.reduce((s, p) => s + (p.value || 0), 0), stuckCost: cost(stuck),
    winRate: closed.length ? closed.filter((p) => p.realized > 0).length / closed.length : null,
    closed: closed.length, open: open.length,
  };
}

export function listWallets() {
  const rows = db.prepare("SELECT * FROM wallets ORDER BY watching DESC, source = 'you' DESC, COALESCE(last_trade, 0) DESC").all();
  const groups = clusters();
  return rows.map((w) => {
    const p = walletPnl(w.address);
    const hits = db.prepare("SELECT COUNT(DISTINCT mint) n FROM wallet_hits WHERE wallet = ?").get(w.address).n;
    const g = groups.get(w.address);
    return { ...w, trades: p.trades, realized: p.realized, unrealized: p.unrealized, sellablePnl: p.sellablePnl, sellableValue: p.sellableValue, stuck: p.stuck, stuckQuoted: p.stuckQuoted,
      winRate: p.winRate, closed: p.closed, open: p.open, winners: hits, linked: g ? g.size - 1 : 0, group: g ? g.id : null, groupWhy: g?.why || null,
      backlog: backlog.get(w.address)?.length || 0, lagMs: lag.get(w.address) ?? null, checked: Math.max(w.last_poll || 0, w.last_event || 0), live: stream.connected };
  });
}

// ---------- linked wallets ----------
// Followed wallets that keep buying the same coins within two minutes of each other, or that share a
// fee payer, are treated as one actor: a single operator, a bundle, or copy-bots chasing each other.
// Three "smart" wallets in one group are one opinion, not three.
let groupCache = { t: 0, v: new Map() };
export function clusters() {
  if (now() - groupCache.t < 5 * MIN) return groupCache.v;
  const since = now() - 3 * 24 * 60 * MIN;
  const parent = new Map(), why = new Map();
  const find = (a) => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
  const join = (a, b, reason) => { for (const x of [a, b]) if (!parent.has(x)) parent.set(x, x); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); why.set(`${a}|${b}`, reason); };
  const co = db.prepare(`SELECT a.wallet w1, b.wallet w2, COUNT(DISTINCT a.mint) n FROM wallet_trades a JOIN wallet_trades b
    ON a.mint = b.mint AND a.wallet < b.wallet AND b.side = 'buy' AND ABS(a.t - b.t) < 120000
    JOIN wallets x ON x.address = a.wallet JOIN wallets y ON y.address = b.wallet
    WHERE a.side = 'buy' AND a.t > ? GROUP BY a.wallet, b.wallet HAVING n >= 3`).all(since);
  for (const r of co) join(r.w1, r.w2, `bought ${r.n} of the same coins within 2 minutes of each other`);
  // Same third-party fee payer on both wallets (and not Fomo's shared payer, which thousands of users have).
  const fomoPayers = new Set(db.prepare("SELECT address FROM fomo_payers").all().map((r) => r.address));
  const pay = db.prepare(`SELECT payer, GROUP_CONCAT(DISTINCT wallet) ws FROM wallet_trades WHERE payer IS NOT NULL AND payer != wallet AND t > ? GROUP BY payer HAVING COUNT(DISTINCT wallet) BETWEEN 2 AND 12`).all(since);
  for (const r of pay) { if (fomoPayers.has(r.payer)) continue; const ws = r.ws.split(","); for (let i = 1; i < ws.length; i++) join(ws[0], ws[i], "share a fee payer"); }
  const members = new Map();
  for (const a of parent.keys()) { const r = find(a); if (!members.has(r)) members.set(r, []); members.get(r).push(a); }
  const out = new Map();
  let id = 0;
  for (const list of members.values()) {
    if (list.length < 2) continue;
    id++;
    const reason = [...why].find(([k]) => list.includes(k.split("|")[0]))?.[1] || "move together";
    for (const a of list) out.set(a, { id, size: list.length, members: list, why: reason });
  }
  groupCache = { t: now(), v: out };
  return out;
}
// How many separate actors a set of wallets represents.
export function independent(addresses) {
  const g = clusters();
  return new Set(addresses.map((a) => (g.has(a) ? `g${g.get(a).id}` : a))).size;
}

export async function walletDetail(address) {
  const w = db.prepare("SELECT * FROM wallets WHERE address = ?").get(address) || { address, label: null, source: null, watching: 0 };
  // Price coins the radar doesn't track so open positions still get a value.
  const untracked = db.prepare(`SELECT DISTINCT wt.mint FROM wallet_trades wt LEFT JOIN tokens t ON t.mint = wt.mint
    WHERE wt.wallet = ? AND (t.mint IS NULL OR t.price IS NULL)`).all(address).map((r) => r.mint).slice(0, 60);
  const prices = new Map();
  if (untracked.length) {
    const pairs = await src.dexTokens(untracked).catch(() => new Map());
    for (const [m, p] of pairs) prices.set(m, { price: +p.priceUsd || 0, symbol: p.baseToken?.symbol, name: p.baseToken?.name, image: p.info?.imageUrl || null, mcap: p.marketCap || p.fdv || 0,
      pair: p.pairAddress, dex: p.dexId, liquidity: p.liquidity?.usd || 0 });
  }
  const pnl = walletPnl(address, prices);
  const g = clusters().get(address);
  if (g) w.group = { size: g.size, why: g.why, members: g.members.filter((a) => a !== address).map((a) => ({ address: a, name: nameOf(db.prepare("SELECT * FROM wallets WHERE address = ?").get(a) || { address: a }) })) };
  w.missed = w.missed || 0; w.lagMs = lag.get(address) ?? null; w.backlog = backlog.get(address)?.length || 0; w.checked = Math.max(w.last_poll || 0, w.last_event || 0);
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
    WHERE w.watching = 1 AND COALESCE(wt.usd, 0) >= 1 ORDER BY wt.t DESC LIMIT ?`).all(limit);
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
  // Trusted readings only (ok = 0 marks an emptied pool), and only real memecoins.
  const rows = db.prepare(`SELECT t.mint, t.peak_mcap, (SELECT mcap FROM snapshots s WHERE s.mint = t.mint AND s.mcap > 0 AND COALESCE(s.ok, 1) = 1 ORDER BY s.t LIMIT 1) first_mcap
    FROM tokens t WHERE t.peak_mcap >= 250000 AND COALESCE(t.asset_class, 'meme') = 'meme' AND t.mint NOT IN (SELECT mint FROM winners)`).all();
  for (const r of rows) {
    if (!r.first_mcap || r.peak_mcap / r.first_mcap < 3) continue;
    db.prepare("INSERT OR IGNORE INTO winners (mint, t, multiple) VALUES (?, ?, ?)").run(r.mint, now(), r.peak_mcap / r.first_mcap);
    logEvent("winner", `${q.getToken.get(r.mint)?.symbol || short(r.mint)} ran ${(r.peak_mcap / r.first_mcap).toFixed(1)}x; studying its wallets`);
  }
}

// After a data repair: drop "winners" whose run only existed in readings from an emptied pool, forget
// the wallets credited for them, and pause wallets that were auto-followed on that evidence alone.
export function revalidateWinners(trusted) {
  let winners = 0, paused = 0;
  for (const w of db.prepare("SELECT mint FROM winners").all()) {
    const s = trusted.get(w.mint);
    if (!s) continue;   // no price history left to check against
    const meme = (q.getToken.get(w.mint)?.asset_class || "meme") === "meme";   // a tokenized stock "running" is not a memecoin win
    if (meme && s.first && s.peak >= 250000 && s.peak / s.first >= 3) { db.prepare("UPDATE winners SET multiple = ? WHERE mint = ?").run(s.peak / s.first, w.mint); continue; }
    db.prepare("DELETE FROM winners WHERE mint = ?").run(w.mint);
    db.prepare("DELETE FROM wallet_hits WHERE mint = ?").run(w.mint);
    winners++;
  }
  if (winners) {
    const still = new Set(smartMoney(500).wallets.filter((w) => w.score >= 3).map((w) => w.address));
    for (const w of db.prepare("SELECT address, label FROM wallets WHERE source = 'smart' AND watching = 1").all()) {
      if (still.has(w.address)) continue;
      db.prepare("UPDATE wallets SET watching = 0, label = ? WHERE address = ?").run(`${w.label || short(w.address)} (unverified, paused)`, w.address);
      paused++;
    }
  }
  return { winners, paused };
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
    // Dust buys (fractions of a cent) are bots spraying every new coin; skip them.
    const sw = sol.parseSwaps(tx, signer).find((x) => x.mint === w.mint && x.side === "buy" && x.sol >= 0.05);
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
    out.push({ address: r.wallet, coins: r.coins, early: r.early, holder: r.holder, score: r.early * 2 + r.holder, tokens: coins, last: r.last, watching: w?.watching || 0, label: w?.label || null, known: !!w });
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
    // Never re-add a wallet that's already known: paused bots and wallets you paused stay paused.
    if (w.known || w.score < 3) continue;
    addWallet(w.address, "", "smart");
    room--;
  }
}

// ---------- signals from wallet activity ----------
// Wallets that buy dozens of different coins every few hours are bots or snipers, not signal.
const BOT_MINTS_6H = 25;
export function isBot(address) {
  return db.prepare("SELECT COUNT(DISTINCT mint) n FROM wallet_trades WHERE wallet = ? AND side = 'buy' AND t > ?").get(address, now() - 6 * 60 * MIN).n >= BOT_MINTS_6H;
}
function pauseBots() {
  const rows = db.prepare("SELECT address, label FROM wallets WHERE watching = 1 AND source IN ('smart', 'fomo')").all();
  for (const w of rows) if (isBot(w.address)) {
    db.prepare("UPDATE wallets SET watching = 0, label = ? WHERE address = ?").run(`${w.label || short(w.address)} (bot, paused)`, w.address);
    logEvent("wallet", `Paused ${short(w.address)}: buys ${BOT_MINTS_6H}+ coins every 6h, looks like a bot`);
  }
}

// A followed wallet buying is a fact about that wallet, not a recommendation. The coin goes through the
// same safety policy as every other signal: if it passes, the alert is a normal one; if it fails (or
// cannot be checked), the buy is stored as unscreened wallet activity with the reasons attached.
export async function walletSignals(event, raise, adopt, vet) {
  const { wallet: w, trade } = event;
  if (trade.side !== "buy") return;
  if (w.source !== "you" && isBot(w.address)) return;
  adopt(trade.mint);
  // Price and safety-check the coin first, so the alert carries its ticker and an honest verdict.
  const v = await vet(trade.mint).catch(() => null);
  const t = v?.token || q.getToken.get(trade.mint);
  if (!t?.pair) return;                                        // no market found: nothing to alert on
  if (t.asset_class && t.asset_class !== "meme") return;      // swaps into stablecoins / wrapped assets
  const ok = Boolean(v?.ok);
  const why = ok ? null : (v?.reasons || ["safety could not be checked"]).join("; ");
  const mark = ok ? {} : { safe: false, why };
  const tk = { mint: trade.mint, symbol: t.symbol || short(trade.mint), score: t.score || 0, price: t.price || null, mcap: t.mcap || null };
  const usd = trade.usd ? `$${Math.round(trade.usd).toLocaleString()}` : `${trade.sol.toFixed(2)} SOL`;
  const safety = ok ? ` Passed safety (${t.safety_score}/100).` : ` Not safety-screened: ${why}.`;
  const cool = (kind, ms) => { const l = q.lastSignal.get(trade.mint, kind); return !l || now() - l.t > ms; };

  if ((w.source === "you" || trade.sol >= settings.walletMinSol) && cool(`wallet:${w.address}`, 6 * 60 * MIN))
    raise(tk, `wallet:${w.address}`, `${nameOf(w)} bought $${tk.symbol}`, `${usd} buy${t.mcap ? ` at ${fmtUsd(t.mcap)} mcap` : ""}.${fomoNote(w.address)}${safety}`, 0, mark);

  const buyers = db.prepare(`SELECT wt.wallet, MIN(wt.t) t FROM wallet_trades wt JOIN wallets w ON w.address = wt.wallet
    WHERE wt.mint = ? AND wt.side = 'buy' AND wt.t > ? AND w.watching = 1 AND wt.sol >= 0.1 GROUP BY wt.wallet`).all(trade.mint, now() - 2 * 60 * MIN)
    .filter((b) => !isBot(b.wallet));
  // Linked wallets count once: several wallets of one operator buying together is not confirmation.
  const actors = independent(buyers.map((b) => b.wallet));
  if (actors >= 2 && cool("smart", 6 * 60 * MIN)) {
    const names = buyers.map((b) => nameOf(db.prepare("SELECT * FROM wallets WHERE address = ?").get(b.wallet))).slice(0, 4).join(", ");
    const ts = buyers.map((b) => b.t).sort((a, b) => a - b);
    const burst = buyers.length >= 3 && ts[ts.length - 1] - ts[0] < 90_000 ? " They all bought within 90 seconds, which usually means one operator or copy-bots rather than separate decisions." : "";
    const linked = actors < buyers.length ? ` ${buyers.length - actors} of them move together with another and are counted as one.` : "";
    raise(tk, "smart", ok ? `${actors} followed wallets bought $${tk.symbol}` : `${actors} followed wallets bought $${tk.symbol} (failed safety)`,
      `${buyers.length} wallets you follow bought in the last 2 hours (${actors} independent): ${names}.${linked}${burst} Followed-wallet buying is a heuristic, not a safety check.${safety}`, 0, mark);
  }
}
// " Trades on Fomo as @handle." when the wallet is a known Fomo trader.
function fomoNote(address) {
  const w = db.prepare("SELECT fomo FROM wallets WHERE address = ?").get(address);
  if (!w?.fomo) return "";
  const h = handleOf(address);
  return h ? ` Trades on Fomo as @${h}.` : " Trades on Fomo.";
}
const fmtUsd = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${Math.round(n || 0)}`;

// ---------- loop ----------
export function startWallets(onTrade) {
  const stopStream = startStream(onTrade);
  const timers = [
    setInterval(() => pollWallets(onTrade), 20_000),
    setInterval(() => { findWinners(); harvestHolders(); autoFollow(); }, 3 * MIN),
    setInterval(() => harvestEarly().catch((e) => logEvent("error", `early buyers: ${e.message}`)), 4 * MIN),
  ];
  setTimeout(() => pollWallets(onTrade), 3000);
  return () => { stopStream(); timers.forEach(clearInterval); };
}
