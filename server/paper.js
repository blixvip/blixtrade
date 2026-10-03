// The paper desk: one-click paper buys at preset sizes from any Pulse row, priced every second from the
// live trade feed (coins on the curve) or Jupiter/DexScreener (bonded coins), with an optional exit rule
// per position (take profit, stop, trailing stop). Nothing is ever sent to the chain: this is the trading
// terminal's buy button with the execution left out, so sizing and exits can be practised against real
// prices and the results are kept honestly.
//
// Fills: buys and sells from the trade panel are filled at a REAL quote (quote.js): the exact pump.fun
// curve math with its real fee for coins on the curve, Jupiter's route for bonded coins. Such a position
// holds a token amount and is valued at what selling it would return right now, price impact and fees
// included. Older positions without a token amount keep the flat model (3% cost each way).
import { db, logEvent } from "./db.js";
import { settings } from "./settings.js";
import { liveStats, feed } from "./livetrades.js";
import { dexTokens } from "./sources.js";
import { fastMcap } from "./pulse.js";
import { readingProblem } from "./quality.js";
import { PAPER } from "./brain.js";
import { quote, curveQuoteNow } from "./quote.js";

const now = () => Date.now();
const MIN = 60_000;
const COST = (1 - PAPER.costPctPerSide / 100) / (1 + PAPER.costPctPerSide / 100);

db.exec(`CREATE TABLE IF NOT EXISTS paper (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mint TEXT, symbol TEXT, name TEXT, t INTEGER,
  sol REAL, usd REAL, mcap0 REAL, src TEXT,
  peak REAL, low REAL, last REAL, last_t INTEGER,
  tp REAL, sl REAL, trail REAL,
  status TEXT DEFAULT 'open', exit_mcap REAL, exit_t INTEGER, exit_why TEXT, pnl REAL, note TEXT
)`);
db.exec("CREATE INDEX IF NOT EXISTS paper_status ON paper(status, t)");
// Quoted fills: tokens held, SOL received on exit, and what the fill looked like (impact, fee, route).
for (const col of ["tokens REAL", "exit_sol REAL", "fill TEXT"]) { try { db.exec(`ALTER TABLE paper ADD COLUMN ${col}`); } catch {} }

// ---------- prices ----------
const dexPx = new Map();      // mint -> { mcap, t }
let dexNext = 0, dexBusy = false;
export function priceNow(mint) {
  const ls = liveStats(mint);
  if (ls && ls.mc > 0 && feed.connected && now() - feed.lastMsg < 10_000 && now() - ls.last < 5 * MIN && (ls.progress ?? 0) < 0.995) return { mcap: ls.mc, src: "live" };
  const fast = fastMcap(mint);
  if (fast) return { mcap: fast, src: "jupiter" };
  const d = dexPx.get(mint);
  if (d && now() - d.t < 20_000) return d.mcap > 0 ? { mcap: d.mcap, src: "dex" } : null;
  const t = db.prepare("SELECT mcap, price_t, updated, quarantine, dex, liquidity FROM tokens WHERE mint = ?").get(mint);
  if (t && t.mcap > 0 && !t.quarantine && now() - (t.price_t || t.updated || 0) < 3 * MIN) return { mcap: t.mcap, src: "radar" };
  return null;
}
async function pollDex(mints) {
  if (dexBusy || now() < dexNext || !mints.length) return;
  dexBusy = true;
  try {
    const pairs = await dexTokens(mints.slice(0, 30));
    for (const m of mints) {
      const p = pairs.get(m), raw = p ? p.marketCap || p.fdv || 0 : 0;
      if (!raw) continue;
      const bad = readingProblem({ dex: p.dexId, liquidity: p.liquidity?.usd, mcap: raw }, settings.minExitLiq);
      dexPx.set(m, { mcap: bad ? 0 : raw, t: now() });
    }
    dexNext = now() + 4000;
  } catch (e) { dexNext = now() + (e.status === 429 ? 15_000 : 5000); } finally { dexBusy = false; }
}

// ---------- positions ----------
const sym = (mint) => db.prepare("SELECT symbol, name FROM tokens WHERE mint = ?").get(mint) || {};
let names = () => ({});
export const nameHook = (fn) => { names = fn; };

export function open(mint, sol, { symbol, name, tp, sl, trail, note } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint || ""))) throw Object.assign(new Error("That is not a Solana address."), { status: 400 });
  sol = Number(sol);
  if (!(sol > 0) || sol > 1000) throw Object.assign(new Error("Size must be between 0 and 1000 SOL."), { status: 400 });
  const px = priceNow(mint);
  if (!px) throw Object.assign(new Error("No live price for this coin right now, so a paper buy would be a guess."), { status: 409 });
  const t = sym(mint), n = names(mint) || {};
  const usd = sol * feed.solUsd;
  const rule = (v, d) => { const x = Number(v ?? d); return x > 0 ? x : null; };
  db.prepare(`INSERT INTO paper (mint, symbol, name, t, sol, usd, mcap0, src, peak, low, last, last_t, tp, sl, trail, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(mint, symbol || t.symbol || n.symbol || null, name || t.name || n.name || null, now(), sol, usd, px.mcap, px.src, px.mcap, px.mcap, px.mcap, now(),
      rule(tp, settings.paperTake), rule(sl, settings.paperStop), rule(trail, settings.paperTrail), note ? String(note).slice(0, 200) : null);
  const row = db.prepare("SELECT * FROM paper WHERE id = last_insert_rowid()").get();
  logEvent("paper", `Paper buy $${row.symbol || mint.slice(0, 6)}: ${sol} SOL at ${Math.round(px.mcap).toLocaleString()} mcap (${px.src})`);
  return out(row);
}

// A buy filled at a real quote for `sol` (the trade panel's buy button).
export async function openQuoted(mint, sol, { symbol, name, tp, sl, trail, note, slippageBps } = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(mint || ""))) throw Object.assign(new Error("That is not a Solana address."), { status: 400 });
  sol = Number(sol);
  if (!(sol > 0) || sol > 1000) throw Object.assign(new Error("Size must be between 0 and 1000 SOL."), { status: 400 });
  const q = await quote(mint, "buy", sol, { slippageBps });
  // Coins with a near-empty curve quote absurd price impact (thousands of %): a fill there is meaningless.
  if (q.impactPct > 50) throw Object.assign(new Error(`This buy would move the price ${Math.round(q.impactPct)}%: too thin to trade at this size.`), { status: 409 });
  const t = sym(mint), n = names(mint) || {};
  const spot = q.spotMcapUsd || q.avgMcapUsd;
  const rule = (v, d) => { const x = Number(v ?? d); return x > 0 ? x : null; };
  const fill = { side: "buy", solIn: sol, src: q.src, route: q.route, impactPct: +q.impactPct.toFixed(3), feeSol: q.feeSol ?? null, avgMcap: q.avgMcapUsd, spotMcap: spot, slippageBps: q.slippageBps, solUsd: q.solUsd };
  db.prepare(`INSERT INTO paper (mint, symbol, name, t, sol, usd, mcap0, src, peak, low, last, last_t, tp, sl, trail, note, tokens, fill)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(mint, symbol || t.symbol || n.symbol || null, name || t.name || n.name || null, now(), sol, sol * q.solUsd, q.avgMcapUsd, q.src, spot, spot, spot, now(),
      rule(tp, settings.paperTake), rule(sl, settings.paperStop), rule(trail, settings.paperTrail), note ? String(note).slice(0, 200) : null, q.outTokens, JSON.stringify(fill));
  const row = db.prepare("SELECT * FROM paper WHERE id = last_insert_rowid()").get();
  logEvent("paper", `Paper buy $${row.symbol || mint.slice(0, 6)}: ${sol} SOL -> ${Math.round(q.outTokens).toLocaleString()} tokens at ${Math.round(q.avgMcapUsd).toLocaleString()} avg mcap (${q.src}, impact ${q.impactPct.toFixed(2)}%)`);
  return out(row);
}

// What selling a quoted position's tokens would return right now, in SOL: exact for curve coins (local
// math, every second), else the last Jupiter quote scaled by how far the price moved since (refreshed every
// 10 seconds by tick()), else an estimate from the market cap.
const exitQuotes = new Map();   // position id -> { outSol, mcap, t }
// The position's own buy, for valuing it as if it had really happened (see curveQuoteNow): the SOL that went
// into the curve (after the fee) and the tokens it took out, for whatever is still held.
function ownBuy(p) {
  const f = JSON.parse(p.fill || "{}"), net = p.sol - (f.feeSol != null ? f.feeSol * (p.sol / (f.solIn || p.sol)) : p.sol * 0.0125 / 1.0125);
  return { solNet: net, tokens: p.tokens, impactPct: f.impactPct || 0 };
}
function exitSol(p, part = 1) {
  if (!(p.tokens > 0)) return null;
  const own = ownBuy(p);
  const c = curveQuoteNow(p.mint, "sell", p.tokens * part, 300, own);
  if (c) return { sol: c.outSol, how: "curve" };
  const px = priceNow(p.mint), e = exitQuotes.get(p.id);
  // Jupiter's quote does not include our own (paper) buy either: add back the impact that buy would have had.
  if (e && now() - e.t < 60_000) return { sol: e.outSol * part * (px && e.mcap ? px.mcap / e.mcap : 1) * (1 + Math.max(0, own.impactPct) / 100), how: "jupiter" };
  if (px && p.mcap0 > 0) return { sol: p.sol * part * (px.mcap / p.mcap0) * (1 - 0.0125), how: "estimate" };
  return null;
}
let refreshing = false;
async function refreshExitQuotes() {
  if (refreshing) return;
  refreshing = true;
  try { await refreshAll(); } finally { refreshing = false; }
}
async function refreshAll() {
  for (const p of db.prepare("SELECT * FROM paper WHERE status = 'open' AND tokens > 0").all()) {
    if (curveQuoteNow(p.mint, "sell", p.tokens)) continue;
    const e = exitQuotes.get(p.id);
    if (e && now() - e.t < 10_000) continue;
    try { const q = await quote(p.mint, "sell", p.tokens); exitQuotes.set(p.id, { outSol: q.outSol, mcap: priceNow(p.mint)?.mcap || null, t: now() }); } catch {}
  }
}

// What selling `part` of a quoted position returns right now (curve: exact, as if its own buy were on chain;
// bonded: Jupiter's route with that buy's impact added back).
async function quoteSell(p, part) {
  const own = ownBuy(p);
  const c = curveQuoteNow(p.mint, "sell", p.tokens * part, 300, own);
  if (c) return { ...c, avgMcapUsd: c.avgSol * 1e9 * feed.solUsd, route: ["pump.fun curve"] };
  const q = await quote(p.mint, "sell", p.tokens * part);
  return { ...q, outSol: q.outSol * (1 + Math.max(0, own.impactPct) / 100) };
}
// The sell buttons' preview: what each would return, without selling.
export async function previewSell(id, pct = 100) {
  const p = db.prepare("SELECT * FROM paper WHERE id = ? AND status = 'open'").get(id);
  if (!p) throw Object.assign(new Error("No open paper position with that id."), { status: 404 });
  if (!(p.tokens > 0)) { const o = out(p); return { id, pct, outSol: o.mult != null ? p.sol * (pct / 100) * o.mult : null, src: "flat", solIn: p.sol * (pct / 100) }; }
  const part = Math.max(1, Math.min(100, Number(pct) || 100)) / 100;
  const q = await quoteSell(p, part);
  return { id, pct, outSol: q.outSol, solIn: p.sol * part, tokens: p.tokens * part, src: q.src, route: q.route, impactPct: q.impactPct, feeSol: q.feeSol ?? null, solUsd: feed.solUsd };
}

// A sell filled at a real quote (the trade panel's sell buttons). Older positions fall back to sell().
export async function sellQuoted(id, pct = 100, { why = "sold" } = {}) {
  const p = db.prepare("SELECT * FROM paper WHERE id = ? AND status = 'open'").get(id);
  if (!p) throw Object.assign(new Error("No open paper position with that id."), { status: 404 });
  if (!(p.tokens > 0)) return sell(id, pct, { why });
  pct = Math.max(1, Math.min(100, Number(pct) || 100));
  const part = pct / 100;
  const q = await quoteSell(p, part);
  return closePart(p, part, q.outSol, priceNow(p.mint)?.mcap || q.spotMcapUsd || q.avgMcapUsd, why, { src: q.src, route: q.route, impactPct: +q.impactPct.toFixed(3), feeSol: q.feeSol ?? null });
}

// Book `part` of a quoted position as sold for `outSol`.
function closePart(p, part, outSol, mcap, why, fillOut = null) {
  const solIn = p.sol * part, usdIn = p.usd * part;
  const pnl = (outSol - solIn) * feed.solUsd;
  const fill = JSON.stringify({ ...(JSON.parse(p.fill || "{}")), exit: fillOut });
  if (part >= 0.999) {
    db.prepare("UPDATE paper SET status = 'closed', exit_mcap = ?, exit_t = ?, exit_why = ?, pnl = ?, exit_sol = ?, last = ?, last_t = ?, fill = ? WHERE id = ?").run(mcap, now(), why, pnl, outSol, mcap, now(), fill, p.id);
    exitQuotes.delete(p.id);
  } else {
    db.prepare(`INSERT INTO paper (mint, symbol, name, t, sol, usd, mcap0, src, peak, low, last, last_t, tp, sl, trail, status, exit_mcap, exit_t, exit_why, pnl, note, tokens, exit_sol, fill)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.mint, p.symbol, p.name, p.t, solIn, usdIn, p.mcap0, p.src, p.peak, p.low, mcap, now(), p.tp, p.sl, p.trail, mcap, now(), why, pnl, p.note, p.tokens * part, outSol, fill);
    db.prepare("UPDATE paper SET sol = sol * ?, usd = usd * ?, tokens = tokens * ?, last = ?, last_t = ? WHERE id = ?").run(1 - part, 1 - part, 1 - part, mcap, now(), p.id);
    exitQuotes.delete(p.id);
  }
  logEvent("paper", `Paper sell $${p.symbol || p.mint.slice(0, 6)} ${Math.round(part * 100)}% for ${outSol.toFixed(4)} SOL (${(outSol / solIn).toFixed(2)}x, ${why}): ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}`);
  return out(db.prepare("SELECT * FROM paper WHERE id = ?").get(p.id));
}

// Close all or part of a position at the price now (or at a given market cap, for rule exits).
export function sell(id, pct = 100, { why = "sold", mcap } = {}) {
  const p = db.prepare("SELECT * FROM paper WHERE id = ? AND status = 'open'").get(id);
  if (!p) throw Object.assign(new Error("No open paper position with that id."), { status: 404 });
  pct = Math.max(1, Math.min(100, Number(pct) || 100));
  if (p.tokens > 0) {
    const ex = exitSol(p, pct / 100);
    if (!ex) throw Object.assign(new Error("No live price for this coin right now."), { status: 409 });
    return closePart(p, pct / 100, ex.sol, mcap > 0 ? mcap : priceNow(p.mint)?.mcap || p.last, why);
  }
  const px = mcap > 0 ? { mcap, src: "rule" } : priceNow(p.mint);
  if (!px) throw Object.assign(new Error("No live price for this coin right now."), { status: 409 });
  const mult = (px.mcap / p.mcap0) * COST;
  const part = pct / 100, usd = p.usd * part;
  const pnl = usd * (mult - 1);
  if (pct >= 100) {
    db.prepare("UPDATE paper SET status = 'closed', exit_mcap = ?, exit_t = ?, exit_why = ?, pnl = ?, last = ?, last_t = ? WHERE id = ?").run(px.mcap, now(), why, pnl, px.mcap, now(), id);
  } else {
    // The sold part becomes its own closed row; the rest stays open with the same entry.
    db.prepare(`INSERT INTO paper (mint, symbol, name, t, sol, usd, mcap0, src, peak, low, last, last_t, tp, sl, trail, status, exit_mcap, exit_t, exit_why, pnl, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?, ?)`)
      .run(p.mint, p.symbol, p.name, p.t, p.sol * part, usd, p.mcap0, p.src, p.peak, p.low, px.mcap, now(), p.tp, p.sl, p.trail, px.mcap, now(), why, pnl, p.note);
    db.prepare("UPDATE paper SET sol = sol * ?, usd = usd * ?, last = ?, last_t = ? WHERE id = ?").run(1 - part, 1 - part, px.mcap, now(), id);
  }
  logEvent("paper", `Paper sell $${p.symbol || p.mint.slice(0, 6)} ${pct}% at ${mult.toFixed(2)}x (${why}): ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}`);
  return out(db.prepare("SELECT * FROM paper WHERE id = ?").get(id));
}

export function setRule(id, { tp, sl, trail }) {
  const rule = (v) => { const x = Number(v); return x > 0 ? x : null; };
  db.prepare("UPDATE paper SET tp = ?, sl = ?, trail = ? WHERE id = ? AND status = 'open'").run(rule(tp), rule(sl), rule(trail), id);
  return out(db.prepare("SELECT * FROM paper WHERE id = ?").get(id));
}

export function remove(id) { db.prepare("DELETE FROM paper WHERE id = ? AND status = 'closed'").run(id); }

function out(p) {
  if (!p) return null;
  if (p.tokens > 0) {
    const open = p.status === "open";
    const live = open ? priceNow(p.mint) : null, ex = open ? exitSol(p) : null;
    const mult = open ? (ex ? ex.sol / p.sol : null) : p.exit_sol > 0 ? p.exit_sol / p.sol : null;
    return { ...p, fill: JSON.parse(p.fill || "null"), quoted: true, valueSol: open ? ex?.sol ?? null : p.exit_sol, valuedBy: ex?.how || null,
      mcapNow: live ? live.mcap : open ? p.last : p.exit_mcap, src: live ? live.src : p.src, mult,
      pnl: open ? (ex ? (ex.sol - p.sol) * feed.solUsd : null) : p.pnl,
      peakX: p.peak > 0 && p.fill ? p.peak / (JSON.parse(p.fill).spotMcap || p.mcap0) : null, lowX: p.low > 0 && p.fill ? p.low / (JSON.parse(p.fill).spotMcap || p.mcap0) : null, stale: open && !ex };
  }
  const live = p.status === "open" ? priceNow(p.mint) : null;
  const mcapNow = live ? live.mcap : p.status === "open" ? p.last : p.exit_mcap;
  const mult = p.mcap0 > 0 && mcapNow > 0 ? (mcapNow / p.mcap0) * (p.status === "open" ? COST : 1) : null;
  const raw = p.status === "open" ? mult : (p.exit_mcap / p.mcap0) * COST;
  return { ...p, mcapNow, src: live ? live.src : p.src, mult: raw, pnl: p.status === "open" ? (mult != null ? p.usd * (mult - 1) : null) : p.pnl,
    peakX: p.peak > 0 ? p.peak / p.mcap0 : null, lowX: p.low > 0 ? p.low / p.mcap0 : null, stale: p.status === "open" && !live };
}

// Every second: re-price open positions, keep their high and low, and apply each one's exit rule.
let onExit = null;
export const exitHook = (fn) => { onExit = fn; };
export function tick() {
  const open = db.prepare("SELECT * FROM paper WHERE status = 'open'").all();
  if (!open.length) return;
  const need = [];
  for (const p of open) {
    const px = priceNow(p.mint);
    if (!px) { need.push(p.mint); continue; }
    const m = px.mcap;
    db.prepare("UPDATE paper SET last = ?, last_t = ?, peak = MAX(COALESCE(peak, 0), ?), low = MIN(COALESCE(low, ?), ?) WHERE id = ?").run(m, now(), m, m, m, p.id);
    const peak = Math.max(p.peak || 0, m);
    // A quoted position's take profit and stop look at what it would really sell for, not the headline price.
    const ex = p.tokens > 0 ? exitSol(p) : null;
    const mult = ex ? ex.sol / p.sol : m / p.mcap0;
    let why = null;
    if (p.tp && mult >= p.tp) why = `take profit at ${p.tp}x`;
    else if (p.sl && mult <= 1 - p.sl / 100) why = `stop at -${p.sl}%`;
    else if (p.trail && peak > p.mcap0 && m <= peak * (1 - p.trail / 100)) why = `trailing stop ${p.trail}% below its high (${(peak / p.mcap0).toFixed(2)}x)`;
    if (why) {
      const r = sell(p.id, 100, { why, mcap: m });
      try { onExit?.(r); } catch {}
    }
  }
  if (need.length) pollDex(need).catch(() => {});
  refreshExitQuotes().catch(() => {});
}

// The preset sizes, whether Settings holds them as a list or as one comma-separated line from the form.
export const sizes = () => [...new Set(String([].concat(settings.quickSizes || []).join(",")).split(",").map((x) => Number(x.trim())).filter((x) => x > 0 && x <= 1000))].sort((a, b) => a - b).slice(0, 6);

export function desk() {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const open = db.prepare("SELECT * FROM paper WHERE status = 'open' ORDER BY t DESC").all().map(out);
  const closed = db.prepare("SELECT * FROM paper WHERE status = 'closed' ORDER BY exit_t DESC LIMIT 60").all().map(out);
  const today = closed.filter((p) => p.exit_t >= d0.getTime());
  const sum = (list, f) => list.reduce((s, p) => s + (f(p) || 0), 0);
  return {
    open, closed, sol: feed.solUsd, sizes: sizes(),
    rule: { tp: settings.paperTake || 0, sl: settings.paperStop || 0, trail: settings.paperTrail || 0 }, cost: PAPER.costPctPerSide,
    summary: { open: open.length, openUsd: sum(open, (p) => p.usd), openPnl: sum(open, (p) => p.pnl), todayN: today.length, todayPnl: sum(today, (p) => p.pnl),
      todayWins: today.filter((p) => p.pnl > 0).length, allPnl: sum(closed, (p) => p.pnl), allN: db.prepare("SELECT COUNT(*) n FROM paper WHERE status = 'closed'").get().n },
  };
}

export function positionsFor(mint) { return db.prepare("SELECT * FROM paper WHERE mint = ? ORDER BY t DESC LIMIT 10").all(mint).map(out); }

export function startPaper() { setInterval(() => { try { tick(); } catch (e) { logEvent("error", `paper: ${e.message}`); } }, 1000); }
