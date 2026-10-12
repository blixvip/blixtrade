// The Blix trade API (v1): members' API keys, the quote / build / send endpoints for a bot's own wallet, a
// PumpPortal-shaped WebSocket stream, and the usage ledger. Runs in the page server (webapp.js), never on the
// radar's thread: every trade call is one HTTP round trip to the wallet service (blix-vault, local.js), which holds
// the fee rail and builds the transaction; the live stream is one shared connection to the radar's firehose.
//
// Keys: `blx_live_<token>`, shown once, kept hashed. Every key belongs to a member (their Google email); a key
// pays the member's fee (2%, 1.6% when they joined through an invite) and credits their inviter like a trade in
// the terminal does. The signer is always the caller: Blix never sees a private key.
//
// Routes (member = signed in on blixvip.com; key = Authorization: Bearer blx_live_…):
//   member  GET  /api/v1/keys · POST /api/v1/keys {label} · DELETE /api/v1/keys/<id> · GET /api/v1/usage
//   key     GET  /api/v1/me · POST /api/v1/quote · POST /api/v1/trade/build · POST /api/v1/trade/send
//           GET  /api/v1/trade/<signature> · GET /api/v1/stream (WebSocket; ?key= for browsers)
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { accept, refuse, isUpgrade } from "./ws-lite.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.RADAR_DATA ? path.resolve(process.env.RADAR_DATA) : path.join(ROOT, "data");
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const KEY_RE = /^blx_live_[A-Za-z0-9_-]{32,64}$/;
export const LIMITS = { keysPerMember: 5, quotesPerMin: 120, sendsPerMin: 60, streamsPerKey: 3, subsPerStream: 200 };
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const day = (t) => new Date(t).toISOString().slice(0, 10);

export function createTradeApi({ dataDir = DATA, vault = defaultVault, refOf = defaultRefOf(dataDir), radarPort = 4420, now = Date.now, log = console.error } = {}) {
  let db = null;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(path.join(dataDir, "tradeapi.db"));
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE, label TEXT,
        created INTEGER NOT NULL, last_used INTEGER, calls INTEGER NOT NULL DEFAULT 0, revoked INTEGER);
      CREATE INDEX IF NOT EXISTS api_keys_email ON api_keys(email);
      CREATE TABLE IF NOT EXISTS api_usage (key_id INTEGER NOT NULL, day TEXT NOT NULL, quotes INTEGER NOT NULL DEFAULT 0, builds INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 0,
        confirmed INTEGER NOT NULL DEFAULT 0, sol REAL NOT NULL DEFAULT 0, fee REAL NOT NULL DEFAULT 0, PRIMARY KEY (key_id, day));
      CREATE TABLE IF NOT EXISTS api_trades (id INTEGER PRIMARY KEY, key_id INTEGER NOT NULL, email TEXT NOT NULL COLLATE NOCASE, side TEXT NOT NULL, mint TEXT NOT NULL, wallet TEXT NOT NULL,
        sol REAL, tokens TEXT, fee REAL, sig TEXT UNIQUE, status TEXT NOT NULL, error TEXT, slot INTEGER, landed_ms INTEGER, route TEXT, t INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS api_trades_email ON api_trades(email, t);
    `);
  } catch (e) { db = null; log("[tradeapi] database unavailable:", e.message); }
  const need = () => { if (!db) throw fail(503, "The trade API is temporarily unavailable."); };

  const send = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }); res.end(JSON.stringify(body)); };
  const readBody = (req, max = 8192) => new Promise((ok, no) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > max) { req.destroy(); no(fail(413, "Request too large.")); } });
    req.on("end", () => { try { const j = JSON.parse(b || "{}"); if (!j || typeof j !== "object" || Array.isArray(j)) throw 0; ok(j); } catch { no(fail(400, "Body must be a JSON object.")); } });
    req.on("error", () => no(fail(400, "Unable to read request.")));
  });

  // ---------- pacing per key ----------
  const pace = new Map();
  function over(key, perMin) {
    const t = now(), e = pace.get(key);
    if (!e || t - e.t > 60_000) { pace.set(key, { t, n: 1 }); if (pace.size > 20_000) pace.clear(); return false; }
    return ++e.n > perMin;
  }

  // ---------- keys ----------
  const keyRow = (token) => (db && KEY_RE.test(token) ? db.prepare("SELECT * FROM api_keys WHERE hash = ? AND revoked IS NULL").get(sha(token)) : null) || null;
  const bearer = (req, url) => (/^Bearer\s+(blx_live_[A-Za-z0-9_-]+)$/.exec(String(req.headers.authorization || "")) || [])[1] || (url && url.searchParams.get("key")) || "";
  const keyOf = (req, url) => { const k = keyRow(bearer(req, url)); if (!k) throw fail(401, "Missing or revoked API key. Create one on blixvip.com/trade-api (sign in first) and send it as: Authorization: Bearer blx_live_…"); return k; };
  const publicKey = (k) => ({ id: k.id, prefix: k.prefix, label: k.label, created: k.created, lastUsed: k.last_used, calls: k.calls });
  function createKey(email, label) {
    need();
    const live = db.prepare("SELECT COUNT(*) n FROM api_keys WHERE email = ? AND revoked IS NULL").get(email).n;
    if (live >= LIMITS.keysPerMember) throw fail(409, `You already have ${LIMITS.keysPerMember} keys. Revoke one first.`);
    const token = `blx_live_${crypto.randomBytes(24).toString("base64url")}`;
    const prefix = token.slice(0, 17);
    const id = Number(db.prepare("INSERT INTO api_keys (hash, prefix, email, label, created) VALUES (?, ?, ?, ?, ?)").run(sha(token), prefix, email, String(label || "").slice(0, 60) || null, now()).lastInsertRowid);
    return { id, prefix, label: label || null, key: token, created: now() };
  }
  const bump = db && db.prepare("UPDATE api_keys SET last_used = ?, calls = calls + 1 WHERE id = ?");
  const useStmt = db && db.prepare(`INSERT INTO api_usage (key_id, day, quotes, builds, sends, confirmed, sol, fee) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key_id, day) DO UPDATE SET quotes = quotes + excluded.quotes, builds = builds + excluded.builds, sends = sends + excluded.sends, confirmed = confirmed + excluded.confirmed, sol = sol + excluded.sol, fee = fee + excluded.fee`);
  const used = (k, { quotes = 0, builds = 0, sends = 0, confirmed = 0, sol = 0, fee = 0 } = {}) => { try { bump.run(now(), k.id); useStmt.run(k.id, day(now()), quotes, builds, sends, confirmed, sol, fee); } catch {} };

  // ---------- the member's routes (signed in on blixvip.com) ----------
  async function member(req, res, url, email) {
    const p = url.pathname, m = req.method;
    if (p === "/api/v1/keys" && m === "GET") { need(); return send(res, 200, { keys: db.prepare("SELECT * FROM api_keys WHERE email = ? AND revoked IS NULL ORDER BY created DESC").all(email).map(publicKey), limits: LIMITS, email }); }
    if (p === "/api/v1/keys" && m === "POST") { const body = await readBody(req); if (over(`mk:${email}`, 10)) throw fail(429, "Too many new keys. Try again in a minute."); return send(res, 200, createKey(email, body.label)); }
    const del = /^\/api\/v1\/keys\/(\d{1,12})$/.exec(p);
    if (del && m === "DELETE") { need(); const r = db.prepare("UPDATE api_keys SET revoked = ? WHERE id = ? AND email = ? AND revoked IS NULL").run(now(), Number(del[1]), email); return send(res, 200, { revoked: r.changes > 0 }); }
    if (p === "/api/v1/usage" && m === "GET") {
      need();
      const since = day(now() - 30 * 864e5);
      const days = db.prepare("SELECT u.day, u.key_id, k.prefix, u.quotes, u.builds, u.sends, u.confirmed, u.sol, u.fee FROM api_usage u JOIN api_keys k ON k.id = u.key_id WHERE k.email = ? AND u.day >= ? ORDER BY u.day DESC").all(email, since);
      const trades = db.prepare("SELECT id, key_id, side, mint, wallet, sol, tokens, fee, sig, status, error, slot, landed_ms, route, t FROM api_trades WHERE email = ? ORDER BY t DESC LIMIT 50").all(email);
      const totals = db.prepare("SELECT COUNT(*) trades, COALESCE(SUM(CASE WHEN status = 'confirmed' THEN ABS(sol) END), 0) volumeSol, COALESCE(SUM(CASE WHEN status = 'confirmed' THEN fee END), 0) feeSol FROM api_trades WHERE email = ?").get(email);
      return send(res, 200, { email, days, trades, totals, limits: LIMITS });
    }
    throw fail(404, "Not found.");
  }

  // ---------- a key's routes ----------
  async function keyed(req, res, url) {
    const p = url.pathname, m = req.method, k = keyOf(req, url);
    if (p === "/api/v1/me" && m === "GET") { used(k); return send(res, 200, { key: publicKey(k), account: mask(k.email), fee: feeInfo(k.email), limits: LIMITS, docs: "https://blixvip.com/trade-api" }); }
    if (p === "/api/v1/quote" && m === "POST") {
      if (over(`q:${k.id}`, LIMITS.quotesPerMin)) throw fail(429, `Over ${LIMITS.quotesPerMin} quotes and builds a minute on this key. Slow down a little.`);
      const body = await readBody(req);
      const out = await vault("/local/quote", { ...body, trader: k.email, referrer: refOf(k.email) || undefined });
      used(k, { quotes: 1 });
      return send(res, 200, out);
    }
    if (p === "/api/v1/trade/build" && m === "POST") {
      if (over(`q:${k.id}`, LIMITS.quotesPerMin)) throw fail(429, `Over ${LIMITS.quotesPerMin} quotes and builds a minute on this key. Slow down a little.`);
      const body = await readBody(req);
      const out = await vault("/local/build", { ...body, trader: k.email, referrer: refOf(k.email) || undefined });
      used(k, { builds: 1 });
      return send(res, 200, out);
    }
    if (p === "/api/v1/trade/send" && m === "POST") {
      if (over(`s:${k.id}`, LIMITS.sendsPerMin)) throw fail(429, `Over ${LIMITS.sendsPerMin} sends a minute on this key.`);
      const body = await readBody(req);
      let out;
      try { out = await vault("/local/send", { transaction: body.transaction, waitMs: body.waitMs }); }
      catch (e) { used(k, { sends: 1 }); throw e; }
      used(k, { sends: 1, confirmed: out.status === "confirmed" ? 1 : 0, sol: out.status === "confirmed" ? Math.abs(out.sol || 0) : 0, fee: out.status === "confirmed" ? out.feeSol || 0 : 0 });
      // node:sqlite refuses an undefined binding: every optional field goes in as null.
      const nn = (v) => (v === undefined ? null : v);
      try { db.prepare("INSERT OR IGNORE INTO api_trades (key_id, email, side, mint, wallet, sol, tokens, fee, sig, status, error, slot, landed_ms, route, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(k.id, k.email, nn(out.side), nn(out.mint), nn(out.wallet), nn(out.sol), nn(out.tokens), nn(out.feeSol), nn(out.signature), String(out.status || "unknown"), out.error || null, nn(out.slot), nn(out.landedMs), nn(out.route), now()); }
      catch (e) { log("[tradeapi] trade ledger:", e.message); }
      return send(res, 200, out);
    }
    const tx = /^\/api\/v1\/trade\/([1-9A-HJ-NP-Za-km-z]{64,90})$/.exec(p);
    if (tx && m === "GET") {
      const out = await vault(`/local/tx/${tx[1]}`);
      try { db.prepare("UPDATE api_trades SET status = ?, error = ? WHERE sig = ? AND email = ?").run(String(out.status || "unknown"), out.error || null, String(out.signature || tx[1]), k.email); } catch {}
      used(k);
      return send(res, 200, out);
    }
    throw fail(404, "Not found. The trade API is documented at https://blixvip.com/trade-api");
  }

  function feeInfo(email) { const invited = Boolean(refOf(email)); return { bps: invited ? 160 : 200, invited, note: "Blix's fee rides inside every transaction built here, paid to Blix's fee wallet; your inviter earns 40% of it." }; }
  const mask = (email) => String(email).replace(/^(.{2}).*(@.*)$/, "$1…$2");

  // ---------- the live stream (WebSocket) ----------
  // One connection to the radar's firehose (server/firehose.js) for every WebSocket, (re)opened while any is open.
  const streams = new Set();              // { ws, keyId, newToken, migration, mints: Set, accounts: Set }
  const perKey = new Map();
  let upstream = null, upstreamTimer = null;
  function wantUpstream() {
    if (upstream || !streams.size) return;
    const req = http.get({ host: "127.0.0.1", port: radarPort, path: "/api/v1/firehose", headers: { host: `localhost:${radarPort}`, accept: "text/event-stream" } }, (res) => {
      if (res.statusCode !== 200) { res.destroy(); return retry(); }
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        buf += c;
        let at;
        while ((at = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, at); buf = buf.slice(at + 2);
          const ev = /^event: (\w+)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
          if (ev && data && ev !== "hello") { try { fanout(ev, JSON.parse(data)); } catch {} }
        }
        if (buf.length > 1e6) buf = "";
      });
      res.on("close", retry); res.on("error", retry);
    });
    req.on("error", retry);
    upstream = req;
  }
  function retry() { if (upstream) { try { upstream.destroy(); } catch {} } upstream = null; if (!streams.size || upstreamTimer) return; upstreamTimer = setTimeout(() => { upstreamTimer = null; wantUpstream(); }, 1500); upstreamTimer.unref?.(); }
  const fanout = (ev, d) => {
    let msg = null;
    for (const s of streams) {
      let want = false;
      if (ev === "launch") want = s.newToken;
      else if (ev === "migrate") want = s.migration || s.mints.has(d.mint);
      else if (ev === "trade") want = s.mints.has(d.mint) || (d.user && s.accounts.has(d.user));
      if (!want) continue;
      msg ||= JSON.stringify(shape(ev, d));
      s.ws.send(msg);
    }
  };
  // PumpPortal's field names, so a bot written against its stream can point at Blix instead.
  function shape(ev, d) {
    if (ev === "launch") return { txType: "create", mint: d.mint, name: d.name ?? null, symbol: d.symbol ?? null, traderPublicKey: d.dev ?? d.creator ?? null, marketCapSol: d.mcapSol ?? null, solAmount: d.devSol ?? null, pool: "pump", t: d.t };
    if (ev === "migrate") return { txType: "migrate", mint: d.mint, pool: "pump-amm", poolAddress: d.pool, t: d.t };
    return { signature: d.sig, mint: d.mint, traderPublicKey: d.user, txType: d.buy ? "buy" : "sell", tokenAmount: d.tokens, solAmount: d.sol, vTokensInBondingCurve: d.vTok, vSolInBondingCurve: d.vSol,
      marketCapSol: d.mcSol, bondingCurveProgress: d.progress, pool: d.pool, slot: d.slot, solUsd: d.solUsd, t: d.t };
  }
  function onMessage(s, text) {
    let m;
    try { m = JSON.parse(text); } catch { return s.ws.send({ error: "Messages are JSON: { method, keys? }" }); }
    const keys = Array.isArray(m.keys) ? m.keys.filter((k) => typeof k === "string" && MINT.test(k)).slice(0, LIMITS.subsPerStream) : [];
    switch (m.method) {
      case "subscribeNewToken": s.newToken = true; break;
      case "unsubscribeNewToken": s.newToken = false; break;
      case "subscribeMigration": s.migration = true; break;
      case "unsubscribeMigration": s.migration = false; break;
      case "subscribeTokenTrade": for (const k of keys) if (s.mints.size < LIMITS.subsPerStream) s.mints.add(k); break;
      case "unsubscribeTokenTrade": for (const k of keys) s.mints.delete(k); break;
      case "subscribeAccountTrade": for (const k of keys) if (s.accounts.size < LIMITS.subsPerStream) s.accounts.add(k); break;
      case "unsubscribeAccountTrade": for (const k of keys) s.accounts.delete(k); break;
      case "ping": return s.ws.send({ pong: now() });
      default: return s.ws.send({ error: `Unknown method ${String(m.method).slice(0, 40)}. Methods: subscribeNewToken, subscribeTokenTrade, subscribeAccountTrade, subscribeMigration and their unsubscribe forms.` });
    }
    s.ws.send({ ok: true, method: m.method, newToken: s.newToken, migration: s.migration, mints: s.mints.size, accounts: s.accounts.size });
  }
  // `allowed(req)`: the caller's say on whether this socket may be served at all (the edge key, or this machine).
  function upgrade(req, socket, { allowed = () => true } = {}) {
    let url;
    try { url = new URL(req.url, "http://x"); } catch { return false; }
    if (url.pathname !== "/api/v1/stream") return false;
    if (!isUpgrade(req)) { refuse(socket, 400, "WebSocket upgrade required."); return true; }
    if (!allowed(req)) { refuse(socket, 403, "Use https://blixvip.com"); return true; }
    const k = keyRow(bearer(req, url));
    if (!k) { refuse(socket, 401, "Missing or revoked API key: Authorization: Bearer blx_live_… (or ?key= from a browser)."); return true; }
    if ((perKey.get(k.id) || 0) >= LIMITS.streamsPerKey || streams.size >= 500) { refuse(socket, 429, `At most ${LIMITS.streamsPerKey} live connections per key.`); return true; }
    const ws = accept(req, socket);
    if (!ws) return true;
    const s = { ws, keyId: k.id, newToken: false, migration: false, mints: new Set(), accounts: new Set() };
    streams.add(s); perKey.set(k.id, (perKey.get(k.id) || 0) + 1); used(k);
    ws.on("message", (t) => onMessage(s, t));
    ws.on("close", () => { streams.delete(s); const n = (perKey.get(k.id) || 1) - 1; if (n) perKey.set(k.id, n); else perKey.delete(k.id); if (!streams.size) retry(); });
    ws.send({ hello: "Blix trade API stream", methods: ["subscribeNewToken", "subscribeTokenTrade", "subscribeAccountTrade", "subscribeMigration"], docs: "https://blixvip.com/trade-api#stream" });
    wantUpstream();
    return true;
  }

  // true = answered here. `email`: the signed-in member (the Worker vouched), if any. `hasKey`: a bearer key is on the request.
  async function handle(req, res, url, { email = null } = {}) {
    if (!url.pathname.startsWith("/api/v1/")) return false;
    try {
      if (url.pathname === "/api/v1/stream") throw fail(426, "GET /api/v1/stream is a WebSocket: connect with a WebSocket client and your key.");
      if (/^\/api\/v1\/(keys|usage)(\/|$)/.test(url.pathname)) {
        if (!email) throw fail(401, "Sign in at blixvip.com to manage API keys.");
        await member(req, res, url, email);
      } else await keyed(req, res, url);
    } catch (e) {
      const status = e.status >= 400 && e.status < 600 ? e.status : 503;
      const { status: _s, message, stack, ...extra } = e;
      send(res, status, { error: status >= 500 && !e.status ? "The trade API hit an error. Try again." : message, ...extra });
      if (!e.status) log("[tradeapi]", e);
    }
    return true;
  }
  const stats = () => ({ db: Boolean(db), streams: streams.size, upstream: Boolean(upstream), keys: db ? db.prepare("SELECT COUNT(*) n FROM api_keys WHERE revoked IS NULL").get().n : null });
  return { handle, upgrade, stats, createKey, keyRow, LIMITS, _db: db };
}

// ---------- the wallet service ----------
// Its address and service token are read from the vault's config file (BLIX_VAULT_CONFIG, as accounts.js).
const VAULT_CONFIG = process.env.BLIX_VAULT_CONFIG || path.join(process.env.APPDATA || os.homedir(), "blix-vault", "config.json");
async function defaultVault(pathname, body) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(VAULT_CONFIG, "utf8")); } catch { throw fail(503, "The wallet service is not set up here."); }
  let r;
  try {
    r = await fetch(`http://127.0.0.1:${cfg.port || 4470}/v1${pathname}`, { method: body ? "POST" : "GET", signal: AbortSignal.timeout(100_000),
      headers: { authorization: `Bearer ${cfg.serviceToken}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw fail(503, "The wallet service did not answer. Try again in a moment."); }
  const j = await r.json().catch(() => null);
  if (!r.ok) { const { error, ...rest } = j || {}; throw fail(r.status === 401 ? 503 : r.status, error || `Wallet service error ${r.status}`, rest); }
  return j;
}
// Who invited a member (server/handles.js keeps it in accounts.db), read-only; nothing if that database is not here.
function defaultRefOf(dataDir) {
  let adb = null, tried = false;
  return (email) => {
    if (!email) return null;
    if (!tried) { tried = true; try { adb = new DatabaseSync(path.join(dataDir, "accounts.db"), { readOnly: true }); } catch { adb = null; } }
    if (!adb) return null;
    try { return adb.prepare("SELECT ref FROM invites WHERE email = ?").get(email)?.ref || null; } catch { return null; }
  };
}
