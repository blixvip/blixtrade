// Meme Radar — HTTP API + live event stream + dashboard.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, json, logEvent } from "./db.js";
import { start, bus, stats, launchLog } from "./engine.js";
import { computeNarratives } from "./narratives.js";
import { settings, saveSettings, DEFAULTS } from "./settings.js";
import { writeBrief, explainCoin } from "./ai.js";
import { notifySignal, notifyBrief, testNotify } from "./notify.js";
import * as wallets from "./wallets.js";
import * as fomo from "./fomo.js";
import * as research from "./research.js";
import { raise, adoptMint } from "./engine.js";

const fomoOverview = () => ({ ...fomo.status(), hot: fomo.hotCoins(60, 15), traders: fomo.topTraders(25) });
import { rpcStats } from "./solana.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const PORT = +(process.env.RADAR_PORT || 4420);
const MIN = 60_000;

const tokenOut = (t) => t && ({ ...t, links: json(t.links, []), safety: json(t.safety), themes: json(t.themes, []) });

// ---------- queries ----------
function perf() {
  const rows = db.prepare("SELECT kind, p15, p1h, p6h, p24h, peak FROM signals WHERE kind != 'dump' AND hidden = 0 AND t > ?").all(Date.now() - 14 * 24 * 60 * MIN);
  const group = new Map();
  for (const r of rows) {
    const k = r.kind.startsWith("mcap-") ? "milestone" : r.kind.startsWith("wallet:") ? "wallet" : r.kind;
    if (!group.has(k)) group.set(k, []);
    group.get(k).push(r);
  }
  const summarize = (list) => {
    const has1h = list.filter((r) => r.p1h != null);
    const peaks = list.filter((r) => r.peak != null).map((r) => r.peak).sort((a, b) => a - b);
    const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    return {
      count: list.length,
      scored: has1h.length,
      win1h: has1h.length ? has1h.filter((r) => r.p1h >= 1.2).length / has1h.length : null,   // up 20%+ after 1h
      rug1h: has1h.length ? has1h.filter((r) => r.p1h <= 0.5).length / has1h.length : null,   // down 50%+ after 1h
      avg1h: avg(has1h.map((r) => r.p1h)),
      medianPeak: peaks.length ? peaks[Math.floor(peaks.length / 2)] : null,
      twoX: peaks.length ? peaks.filter((p) => p >= 2).length / peaks.length : null,
    };
  };
  const byKind = [...group].map(([kind, list]) => ({ kind, ...summarize(list) })).sort((a, b) => b.count - a.count);
  const best = db.prepare(`SELECT s.*, t.symbol, t.name, t.image FROM signals s JOIN tokens t ON t.mint = s.mint
    WHERE s.kind != 'dump' AND s.hidden = 0 AND s.peak IS NOT NULL AND s.t > ? ORDER BY s.peak DESC LIMIT 10`).all(Date.now() - 7 * 24 * 60 * MIN);
  return { all: summarize(rows), byKind, best };
}

function signalsQuery({ kind, limit = 60, since = 0 } = {}) {
  const rows = db.prepare(`SELECT s.*, t.symbol, t.name, t.image, t.mcap AS mcap_now, t.price AS price_now, t.safety_score, t.pair
    FROM signals s LEFT JOIN tokens t ON t.mint = s.mint WHERE s.hidden = 0 AND s.t > ? ${kind ? "AND s.kind LIKE ?" : ""} ORDER BY s.t DESC LIMIT ?`)
    .all(...[since, ...(kind ? [`${kind}%`] : []), Math.min(+limit || 60, 300)]);
  return rows;
}

// Last ~6 hours of prices, thinned to 24 points, for the mini charts in tables.
const sparkQ = db.prepare("SELECT price FROM snapshots WHERE mint = ? AND t > ? AND price > 0 ORDER BY t");
function withSpark(list) {
  const since = Date.now() - 6 * 60 * MIN;
  for (const t of list) {
    const ps = sparkQ.all(t.mint, since).map((r) => r.price);
    const step = Math.max(1, Math.ceil(ps.length / 24));
    t.spark = ps.filter((_, i) => i % step === 0 || i === ps.length - 1);
  }
  return list;
}

const SORTS = { score: "score DESC", mcap: "mcap DESC", volume: "vol_h1 DESC", new: "first_seen DESC", change: "chg_h1 DESC", safety: "safety_score DESC" };
function tokensQuery(p) {
  const where = ["status = 'active'", "pair IS NOT NULL"];
  const args = [];
  if (p.theme) { where.push("themes LIKE ?"); args.push(`%"${p.theme}"%`); }
  if (p.minSafety) { where.push("safety_score >= ?"); args.push(+p.minSafety); }
  if (p.minMcap) { where.push("mcap >= ?"); args.push(+p.minMcap); }
  if (p.q) { where.push("(symbol LIKE ? OR name LIKE ? OR mint = ?)"); args.push(`%${p.q}%`, `%${p.q}%`, p.q); }
  if (p.graduated === "1") where.push("graduated = 1");
  const sql = `SELECT * FROM tokens WHERE ${where.join(" AND ")} ORDER BY ${SORTS[p.sort] || SORTS.score} LIMIT ?`;
  // Lists don't need each coin's full holder list and risk text; the coin page loads those.
  const slim = (t) => ({ ...t, description: undefined, safety: t.safety && { danger: t.safety.danger, warn: t.safety.warn, top10: t.safety.top10, devPct: t.safety.devPct, totalHolders: t.safety.totalHolders, lpLockedPct: t.safety.lpLockedPct } });
  return withSpark(db.prepare(sql).all(...args, Math.min(+p.limit || 100, 400)).map(tokenOut).map(slim));
}

function overview() {
  const count = (sql, ...a) => db.prepare(sql).get(...a).n;
  const hour = Date.now() - 60 * MIN;
  return {
    stats: { ...stats, launchesLastHour: launchLog.filter((l) => l.t > hour).length, launchDataMin: launchLog.length ? Math.round((Date.now() - launchLog[0].t) / MIN) : 0 },
    counts: {
      tracked: count("SELECT COUNT(*) n FROM tokens WHERE status = 'active' AND pair IS NOT NULL"),
      safe: count("SELECT COUNT(*) n FROM tokens WHERE status = 'active' AND safety_score >= ?", settings.minSafety),
      signals24h: count("SELECT COUNT(*) n FROM signals WHERE hidden = 0 AND t > ?", Date.now() - 24 * 60 * MIN),
      graduated24h: count("SELECT COUNT(*) n FROM tokens WHERE graduated = 1 AND first_seen > ?", Date.now() - 24 * 60 * MIN),
    },
    top: tokensQuery({ sort: "score", limit: 12, minSafety: settings.minSafety }),
    signals: signalsQuery({ limit: 25 }),
    brief: db.prepare("SELECT * FROM briefs ORDER BY t DESC LIMIT 1").get() || null,
  };
}

// ---------- AI ----------
let briefBusy = null;
async function makeBrief(reason = "scheduled") {
  if (briefBusy) return briefBusy;
  briefBusy = (async () => {
    const nar = computeNarratives({ launches: launchLog });
    const top = tokensQuery({ sort: "score", limit: 15, minSafety: settings.minSafety }).map((t) => ({
      ticker: t.symbol, name: t.name, mcap: Math.round(t.mcap), liq: Math.round(t.liquidity), vol1h: Math.round(t.vol_h1),
      chg1h: t.chg_h1, chg24h: t.chg_h24, score: t.score, safety: t.safety_score, themes: t.themes, graduated: !!t.graduated,
      buys1h: t.buys_h1, sells1h: t.sells_h1, ageMin: Math.round((Date.now() - (t.pair_created || t.first_seen)) / MIN),
    }));
    const uptime = launchLog.length ? Math.round((Date.now() - launchLog[0].t) / MIN) : 0;
    const data = {
      radarUptimeMinutes: uptime,
      note: uptime < 60 ? `The radar started ${uptime} minutes ago, so launch counts cover only that window. Do not call the launch pace slow or fast.` : undefined,
      launchesSeen: launchLog.filter((l) => l.t > Date.now() - 60 * MIN).length,
      graduatedCoinsTracked: overview().counts.graduated24h,
      narratives: nar.themes.slice(0, 8).map((t) => ({ theme: t.name, heat: t.heat, launchShare: +(t.launchShare * 100).toFixed(1), launchLift: t.launchLift == null ? null : +t.launchLift.toFixed(2), trackedVolume1h: Math.round(t.volume), leaders: t.top.slice(0, 3).map((x) => x.symbol) })),
      emergingWords: nar.emerging.slice(0, 10).map((e) => `${e.word} (${e.count})`),
      topCoins: top,
      recentSignals: signalsQuery({ limit: 15, since: Date.now() - 3 * 60 * MIN }).map((s) => ({ kind: s.kind, title: s.title })),
      hitRate: perf().all,
      researchGrades: research.desk().top.slice(0, 8).map((r) => ({ ticker: r.symbol, grade: r.grade, ceiling: r.ceiling, verdict: r.verdict })),
      fomoBuying: fomo.hotCoins(60, 8).map((c) => ({ ticker: c.symbol, fomoBuyers: c.buyers, fomoSellers: c.sellers, netUsd: Math.round((c.bought || 0) - (c.sold || 0)) })),
      followedWalletBuys: wallets.activity(40).filter((a) => a.side === "buy" && a.t > Date.now() - 2 * 60 * MIN).map((a) => ({ wallet: a.label || a.wallet.slice(0, 6), ticker: a.symbol, usd: Math.round(a.usd || 0) })).slice(0, 15),
    };
    const { text, model } = await writeBrief(data);
    db.prepare("INSERT INTO briefs (t, body, model) VALUES (?, ?, ?)").run(Date.now(), text, model);
    const b = db.prepare("SELECT * FROM briefs ORDER BY id DESC LIMIT 1").get();
    logEvent("brief", `Brief written (${reason})`);
    bus.emit("brief", b);
    notifyBrief(text).catch(() => {});
    return b;
  })().finally(() => { briefBusy = null; });
  return briefBusy;
}

const explained = new Map(); // mint -> { t, text }
async function explain(mint) {
  const c = explained.get(mint);
  if (c && Date.now() - c.t < 15 * MIN) return c;
  const t = tokenOut(db.prepare("SELECT * FROM tokens WHERE mint = ?").get(mint));
  if (!t) throw Object.assign(new Error("Unknown coin"), { status: 404 });
  const sigs = db.prepare("SELECT kind, title, t FROM signals WHERE mint = ? AND hidden = 0 ORDER BY t DESC LIMIT 8").all(mint);
  const { text } = await explainCoin({
    ticker: t.symbol, name: t.name, description: t.description, themes: t.themes, links: t.links.map((l) => l.type),
    mcap: t.mcap, peakMcap: t.peak_mcap, liquidity: t.liquidity, vol5m: t.vol_m5, vol1h: t.vol_h1, vol24h: t.vol_h24,
    chg5m: t.chg_m5, chg1h: t.chg_h1, chg24h: t.chg_h24, buys1h: t.buys_h1, sells1h: t.sells_h1, graduated: !!t.graduated, dex: t.dex,
    ageMinutes: Math.round((Date.now() - (t.pair_created || t.first_seen)) / MIN), safetyScore: t.safety_score,
    safetyRisks: t.safety?.risks?.map((r) => `${r.level}: ${r.name}`), lpLockedPct: t.safety?.lpLockedPct, signals: sigs,
  });
  const out = { t: Date.now(), text };
  explained.set(mint, out);
  return out;
}

// ---------- http ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch { ok({}); } }); });

const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const params = Object.fromEntries(url.searchParams);
  try {
    if (!p.startsWith("/api/")) {
      const file = path.join(PUBLIC, p === "/" ? "index.html" : p);
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(200, { "content-type": TYPES[".html"] }); return res.end(fs.readFileSync(path.join(PUBLIC, "index.html")));
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      return res.end(fs.readFileSync(file));
    }
    if (p === "/api/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: hello\ndata: {}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (p === "/api/overview") return send(res, 200, overview());
    if (p === "/api/tokens") return send(res, 200, tokensQuery(params));
    if (p === "/api/signals") return send(res, 200, signalsQuery(params));
    if (p === "/api/narratives") return send(res, 200, computeNarratives({ launches: launchLog }));
    if (p === "/api/perf") return send(res, 200, perf());
    if (p === "/api/briefs") return send(res, 200, db.prepare("SELECT * FROM briefs ORDER BY t DESC LIMIT 20").all());
    if (p === "/api/events") return send(res, 200, db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 80").all());
    if (p === "/api/brief" && req.method === "POST") return send(res, 200, await makeBrief("on demand"));
    if (p === "/api/settings") {
      if (req.method === "POST") saveSettings(await readBody(req));
      return send(res, 200, { settings, defaults: DEFAULTS });
    }
    if (p === "/api/test-notify" && req.method === "POST") return send(res, 200, { errors: await testNotify() });
    if (p === "/api/wallets") {
      if (req.method === "POST") { const b = await readBody(req); return send(res, 200, wallets.addWallet(String(b.address || "").trim(), String(b.label || "").trim())); }
      return send(res, 200, { wallets: wallets.listWallets(), smart: wallets.smartMoney(40), activity: wallets.activity(80), rpc: { ...rpcStats, custom: !!settings.rpcUrl }, fomo: fomoOverview() });
    }
    if (p === "/api/fomo") return send(res, 200, fomoOverview());
    if (p === "/api/research") return send(res, 200, research.desk());
    const rm = p.match(/^\/api\/research\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (rm) {
      if (req.method === "POST") {
        const t = db.prepare("SELECT graduated FROM tokens WHERE mint = ?").get(rm[1]);
        if (!t) return send(res, 404, { error: "The radar isn't tracking this coin." });
        db.prepare("DELETE FROM research WHERE mint = ? AND status != 'running'").run(rm[1]);
        research.enqueue(rm[1], t.graduated ? "bonded" : "near", 1e12);
      }
      return send(res, 200, research.researchFor(rm[1]) || {});
    }
    if (p === "/api/fomo/trader" && req.method === "POST") {
      const b = await readBody(req);
      const w = fomo.markFomo(String(b.wallet || "").trim(), b.handle, wallets.addWallet);
      return send(res, 200, { wallet: w, fomo: fomoOverview() });
    }
    const wm = p.match(/^\/api\/wallet\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
    if (wm) {
      if (req.method === "DELETE") { wallets.removeWallet(wm[1]); return send(res, 200, { ok: true }); }
      if (req.method === "POST") {
        const b = await readBody(req);
        if (b.scan) await wallets.scanWallet(wm[1]);
        else if (b.follow) wallets.addWallet(wm[1], b.label || "", "you");
        else wallets.updateWallet(wm[1], b);
      }
      return send(res, 200, await wallets.walletDetail(wm[1]));
    }
    const m = p.match(/^\/api\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})(\/explain)?$/);
    if (m) {
      if (m[2]) return send(res, 200, await explain(m[1]));
      const t = tokenOut(db.prepare("SELECT * FROM tokens WHERE mint = ?").get(m[1]));
      if (!t) return send(res, 404, { error: "Unknown coin" });
      const snaps = db.prepare("SELECT t, price, mcap, liquidity, vol_m5 FROM snapshots WHERE mint = ? AND t > ? ORDER BY t").all(m[1], Date.now() - 24 * 60 * MIN);
      const sigs = db.prepare("SELECT * FROM signals WHERE mint = ? AND hidden = 0 ORDER BY t DESC").all(m[1]);
      return send(res, 200, { token: t, snapshots: snaps, signals: sigs, wallets: wallets.coinWallets(m[1]), fomo: fomo.coinFlow(m[1]), research: research.researchFor(m[1]), progress: research.bondingProgress(t) });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
});

bus.on("signal", (s) => { broadcast("signal", s); notifySignal(s).catch((e) => logEvent("error", `notify: ${e.message}`)); });
bus.on("tick", (s) => broadcast("tick", s));
bus.on("brief", (b) => broadcast("brief", b));
bus.on("walletTrade", (ev) => broadcast("walletTrade", ev));

// A bad API response should never take the radar down.
process.on("unhandledRejection", (e) => logEvent("error", `unhandled: ${e?.message || e}`));
process.on("uncaughtException", (e) => logEvent("error", `uncaught: ${e?.message || e}`));

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Meme Radar on http://localhost:${PORT}`);
  start();
  research.startResearch(raise);
  const syncSol = () => wallets.solPrice().then(research.setSolPrice).catch(() => {});
  syncSol(); setInterval(syncSol, 5 * MIN);
  fomo.startFomo({
    addWallet: wallets.addWallet,
    raise, adoptMint,
    onTrade: (tr) => broadcast("fomoTrade", { ...tr, handle: fomo.handleOf(tr.wallet) }),
  });
  // First brief once there's data to talk about, then on schedule.
  const tryBrief = () => settings.aiBriefs && makeBrief().catch((e) => logEvent("error", `brief: ${e.message}`));
  setTimeout(tryBrief, 12 * MIN);
  setInterval(() => {
    const last = db.prepare("SELECT t FROM briefs ORDER BY t DESC LIMIT 1").get();
    if (!last || Date.now() - last.t >= settings.briefEveryMin * MIN) tryBrief();
  }, 5 * MIN);
});
